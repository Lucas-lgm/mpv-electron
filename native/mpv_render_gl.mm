#import <Cocoa/Cocoa.h>
#import <OpenGL/gl3.h>
#import <OpenGL/OpenGL.h>
#import <CoreVideo/CoreVideo.h>

#include <map>
#include <mutex>
#include <atomic>
#include <dlfcn.h>
#include <cmath>
#include <unistd.h>  // for usleep
#include <thread>
#include <memory>

extern "C" {
#include <mpv/client.h>
#include <mpv/render.h>
#include <mpv/render_gl.h>
}

// ------------------ Context struct ------------------
struct GLRenderContext {
    NSView *view = nil;
    NSOpenGLContext *glContext = nil;
    mpv_render_context *mpvRenderCtx = nullptr;
    mpv_handle *mpvHandle = nullptr;
    
    // pixel size (width/height) used for rendering (单位：像素)
    int width = 0;
    int height = 0;
    std::mutex sizeMutex; // protect width/height
    
    // 上次渲染的尺寸（用于检测尺寸变化）
    int lastRenderedWidth = 0;
    int lastRenderedHeight = 0;
    
    // render scheduling flag (atomic)
    std::atomic<bool> needRedraw;
    std::atomic<bool> isDestroying;
    
    // CVDisplayLink
    CVDisplayLinkRef displayLink = nullptr;
    
    // NSView frame observer
    id frameObserver = nil;
    
    std::atomic<bool> forceBlackFrame;
    std::atomic<bool> forceBlackMode;
    
    GLRenderContext()
        : needRedraw(false),
          isDestroying(false),
          displayLink(nullptr),
          frameObserver(nil),
          forceBlackFrame(false),
          forceBlackMode(false) {}
};

struct ScopedCGLock {
    CGLContextObj ctx;
    ScopedCGLock(CGLContextObj c) : ctx(c) {
        if (ctx) CGLLockContext(ctx);
    }
    ~ScopedCGLock() {
        if (ctx) CGLUnlockContext(ctx);
    }
};

// globals
static std::map<int64_t, std::shared_ptr<GLRenderContext>> g_renderContexts;
static std::mutex g_renderMutex;

// forward declarations
extern "C" void mpv_render_frame_for_instance(int64_t instanceId);
extern "C" void mpv_request_render(int64_t instanceId);
extern "C" void mpv_set_force_black_mode(int64_t instanceId, int enabled);
static void render_internal(GLRenderContext *rc);

// ------------------ helper: dlsym for mpv GL ------------------
static void *get_proc_address(void *ctx, const char *name) {
    (void)ctx;
    return dlsym(RTLD_DEFAULT, name);
}

// ------------------ helper: ensure main thread execution ------------------
static bool isMainThread() {
    return [NSThread isMainThread];
}

// run a block on main thread synchronously or asynchronously
static void runOnMainAsync(dispatch_block_t block) {
    if (!block) return;
    if (isMainThread()) {
        block();
    } else {
        dispatch_async(dispatch_get_main_queue(), block);
    }
}

// ------------------ mpv update callback ------------------
// Called by mpv on arbitrary thread. We must not do GL here.
// Just mark needRedraw, CVDisplayLink will handle it.
static void on_mpv_redraw(void *ctx) {
    int64_t instanceId = (int64_t)(intptr_t)ctx;
    std::shared_ptr<GLRenderContext> rc = nullptr;
    {
        std::lock_guard<std::mutex> lock(g_renderMutex);
        auto it = g_renderContexts.find(instanceId);
        if (it == g_renderContexts.end()) return;
        rc = it->second;
    }
    
    if (!rc || rc->isDestroying.load()) return;
    
    // 只标记需要重绘，DisplayLink 会处理
    rc->needRedraw.store(true);
}

// ------------------ CVDisplayLink Callback ------------------
static CVReturn DisplayLinkCallback(CVDisplayLinkRef displayLink,
                                    const CVTimeStamp *now,
                                    const CVTimeStamp *outputTime,
                                    CVOptionFlags flagsIn,
                                    CVOptionFlags *flagsOut,
                                    void *displayLinkContext) {
    GLRenderContext *rc = (GLRenderContext *)displayLinkContext;
    if (!rc || rc->isDestroying.load()) return kCVReturnSuccess;
    
    @autoreleasepool {
        // Check if we need to render
        bool forceRender = false;
        
        // Check mpv update
        if (rc->mpvRenderCtx) {
            uint64_t flags = mpv_render_context_update(rc->mpvRenderCtx);
            if (flags & MPV_RENDER_UPDATE_FRAME) {
                forceRender = true;
            }
        }
        
        if (rc->needRedraw.load() || forceRender) {
            // Reset flag if it was true
            rc->needRedraw.store(false);
            
            // Set context current for this thread (safe with ScopedCGLock in render_internal)
            if (rc->glContext) {
                [rc->glContext makeCurrentContext];
            }
            
            render_internal(rc);
        }
    }
    
    return kCVReturnSuccess;
}

// ------------------ create GL (must be on main thread) ------------------
static bool createGLForView(GLRenderContext *rc) {
    if (!rc || !rc->view) return false;
    
    NSOpenGLPixelFormatAttribute attrs[] = {
        NSOpenGLPFAOpenGLProfile, NSOpenGLProfileVersion3_2Core,
        NSOpenGLPFAColorSize,     24,
        NSOpenGLPFADepthSize,     16,
        NSOpenGLPFAAccelerated,
        NSOpenGLPFADoubleBuffer,
        0
    };
    
    NSOpenGLPixelFormat *pf = [[NSOpenGLPixelFormat alloc] initWithAttributes:attrs];
    if (!pf) return false;
    
    NSOpenGLContext *ctx = [[NSOpenGLContext alloc] initWithFormat:pf shareContext:nil];
    if (!ctx) {
        [pf release];
        return false;
    }
    
    // Associate the context with the view (must be on main thread)
    [ctx setView:rc->view];
    [ctx makeCurrentContext];
    
    // Enable vsync swap to synchronize with display refresh rate
    {
        GLint swapInt = 1;
        [ctx setValues:&swapInt forParameter:NSOpenGLCPSwapInterval];
    }
    
    // 关键：开启 Retina 支持，并更新 context
    [rc->view setWantsBestResolutionOpenGLSurface:YES];
    [ctx update];
    
    rc->glContext = ctx;
    
    // Read initial backing size on main thread
    @try {
        NSRect bounds = [rc->view bounds];
        NSSize backing = [rc->view convertSizeToBacking:bounds.size]; // consider Retina
        int initialW = (int)backing.width;
        int initialH = (int)backing.height;
        if (initialW <= 0 || initialH <= 0) {
            initialW = (int)bounds.size.width;
            initialH = (int)bounds.size.height;
        }
        if (initialW <= 0) initialW = 1;
        if (initialH <= 0) initialH = 1;
        {
            std::lock_guard<std::mutex> sl(rc->sizeMutex);
            rc->width = initialW;
            rc->height = initialH;
        }
        NSLog(@"[mpv_render_gl] GL context created, initial pixel size %dx%d", rc->width, rc->height);
    } @catch (NSException *ex) {
        NSLog(@"[mpv_render_gl] Warning: failed to read initial view size");
    }
    
    // Setup CVDisplayLink
    CVReturn cvRet = CVDisplayLinkCreateWithActiveCGDisplays(&rc->displayLink);
    if (cvRet == kCVReturnSuccess) {
        CVDisplayLinkSetOutputCallback(rc->displayLink, DisplayLinkCallback, rc);
        
        CGLContextObj cglCtx = [rc->glContext CGLContextObj];
        CGLPixelFormatObj cglPix = [pf CGLPixelFormatObj];
        CVDisplayLinkSetCurrentCGDisplayFromOpenGLContext(rc->displayLink, cglCtx, cglPix);
        
        CVDisplayLinkStart(rc->displayLink);
        NSLog(@"[mpv_render_gl] CVDisplayLink started");
    } else {
        NSLog(@"[mpv_render_gl] Failed to create CVDisplayLink: %d", cvRet);
    }
    
    [pf release];
    return true;
}

// ------------------ destroy GL ------------------
static void destroyGL(std::shared_ptr<GLRenderContext> rc) {
    if (!rc) return;
    
    rc->isDestroying.store(true);
    
    // Stop DisplayLink
    if (rc->displayLink) {
        CVDisplayLinkStop(rc->displayLink);
        CVDisplayLinkRelease(rc->displayLink);
        rc->displayLink = nullptr;
    }
    
    // Free mpv render context
    if (rc->mpvRenderCtx) {
        mpv_render_context_set_update_callback(rc->mpvRenderCtx, nullptr, nullptr);
        mpv_render_context_free(rc->mpvRenderCtx);
        rc->mpvRenderCtx = nullptr;
    }
    
    // release GL context (必须在主线程)
    runOnMainAsync(^{
        if (rc->glContext) {
            @try {
                [NSOpenGLContext clearCurrentContext];
                [rc->glContext clearDrawable];
            } @catch (NSException *ex) {}
            [rc->glContext release];
            rc->glContext = nil;
        }
        
        if (rc->view) {
            [rc->view release];
            rc->view = nil;
        }
    });
    
    rc->mpvHandle = nullptr;
}

// ------------------ public: create context ------------------
extern "C" GLRenderContext *mpv_create_gl_context_for_view(int64_t instanceId, void *nsViewPtr, mpv_handle *mpv) {
    if (!nsViewPtr || !mpv) return nullptr;
    
    auto rc = std::make_shared<GLRenderContext>();
    NSView *view = reinterpret_cast<NSView*>(nsViewPtr);
    rc->view = view;
    if (rc->view) [rc->view retain]; // Retain view to prevent dangling pointer
    rc->mpvHandle = mpv;
    
    // create GL and read initial size - must be on main thread
    if (!isMainThread()) {
        std::atomic<bool>* ok = new std::atomic<bool>(false);
        GLRenderContext* rawRc = rc.get();
        runOnMainAsync(^{
            bool result = createGLForView(rawRc);
            ok->store(result);
        });
        int waitCount = 0;
        while (!ok->load() && waitCount < 100) {
            usleep(10000); // 等待 10ms
            waitCount++;
        }
        bool result = ok->load();
        delete ok;
        if (!result) {
            return nullptr;
        }
    } else {
        if (!createGLForView(rc.get())) {
            return nullptr;
        }
    }
    
    // init mpv render context (GL)
    mpv_opengl_init_params gl_init_params = {};
    gl_init_params.get_proc_address = get_proc_address;
    gl_init_params.get_proc_address_ctx = nullptr;
    
    mpv_render_param params[] = {
        { MPV_RENDER_PARAM_API_TYPE, (void*)MPV_RENDER_API_TYPE_OPENGL },
        { MPV_RENDER_PARAM_OPENGL_INIT_PARAMS, &gl_init_params },
        { MPV_RENDER_PARAM_INVALID, nullptr }
    };
    
    int err = mpv_render_context_create(&rc->mpvRenderCtx, mpv, params);
    if (err < 0) {
        destroyGL(rc);
        return nullptr;
    }
    
    // Set mpv update callback
    mpv_render_context_set_update_callback(rc->mpvRenderCtx, on_mpv_redraw, (void*)(intptr_t)instanceId);
    
    // 注册到全局 map
    {
        std::lock_guard<std::mutex> lock(g_renderMutex);
        g_renderContexts[instanceId] = rc;
    }
    
    return rc.get();
}

// ------------------ public: destroy context ------------------
extern "C" void mpv_destroy_gl_context(int64_t instanceId) {
    std::shared_ptr<GLRenderContext> rc = nullptr;
    {
        std::lock_guard<std::mutex> lock(g_renderMutex);
        auto it = g_renderContexts.find(instanceId);
        if (it == g_renderContexts.end()) return;
        rc = it->second;
        g_renderContexts.erase(it);
    }
    
    if (rc) {
        destroyGL(rc);
    }
}

// ------------------ public: set window size (pixel) ------------------
// External code (Electron main/renderer) calls this when the window size changes.
// 为了避免 JS 侧的缩放因子和 macOS 实际 backing 尺寸不一致，这里不直接使用传入的 width/height，
// 而是在主线程上从 NSView 的 backing 尺寸读取真实像素大小。
extern "C" void mpv_set_window_size(int64_t instanceId, int width, int height) {
    if (width <= 0 || height <= 0) return;
    
    std::shared_ptr<GLRenderContext> rc = nullptr;
    {
        std::lock_guard<std::mutex> lock(g_renderMutex);
        auto it = g_renderContexts.find(instanceId);
        if (it == g_renderContexts.end()) return;
        rc = it->second;
    }
    
    if (!rc) return;
    
    runOnMainAsync(^{
        if (rc->isDestroying) return;
        if (!rc->view) return;
        
        // 关键：通知 OpenGL context 视图几何形状已更改
        // 这必须在主线程上调用，否则会导致画面不更新或缩放错误（如只显示在左下角）
        if (rc->glContext) {
            ScopedCGLock lock([rc->glContext CGLContextObj]);
            [rc->glContext update];
        }
        
        int pixelW = 0;
        int pixelH = 0;
        
        @try {
            NSRect bounds = [rc->view bounds];
            NSSize backing = [rc->view convertSizeToBacking:bounds.size];
            pixelW = (int)backing.width;
            pixelH = (int)backing.height;
        } @catch (NSException *ex) {
            return;
        }
        
        if (pixelW <= 0 || pixelH <= 0) return;
        
        bool sizeChanged = false;
        {
            std::lock_guard<std::mutex> sl(rc->sizeMutex);
            if (rc->width != pixelW || rc->height != pixelH) {
                rc->width = pixelW;
                rc->height = pixelH;
                sizeChanged = true;
            }
        }
        
        if (sizeChanged) {
            rc->needRedraw.store(true);
        }
    });
}

// ------------------ core render (must run on main thread) ------------------
static void render_internal(GLRenderContext *rc) {
    if (!rc || !rc->mpvRenderCtx || !rc->glContext) return;
    
    ScopedCGLock lock([rc->glContext CGLContextObj]);
    
    // 使用存储的尺寸（由 Electron 通过 mpv_set_window_size 更新）
    // 如果存储的尺寸无效，才从 NSView 读取作为 fallback
    int w = 0, h = 0;
    {
        std::lock_guard<std::mutex> sl(rc->sizeMutex);
        w = rc->width;
        h = rc->height;
    }
    
    // fallback: 如果存储的尺寸无效，从 NSView 读取（仅作为最后手段）
    if (w <= 0 || h <= 0) {
        @try {
            NSRect bounds = [rc->view bounds];
            NSSize backing = [rc->view convertSizeToBacking:bounds.size];
            int bw = (int)backing.width;
            int bh = (int)backing.height;
            if (bw > 0 && bh > 0) {
                w = bw;
                h = bh;
                // 更新存储的尺寸
                rc->width = w;
                rc->height = h;
            }
        } @catch (NSException *ex) {
            return;
        }
    }
    
    if (w <= 0 || h <= 0) return;
    
    bool forceBlack = rc->forceBlackFrame.load() || rc->forceBlackMode.load();
    
    // 渲染在后台线程执行，不需要检查主线程
    // 确保 OpenGL context 在当前线程是 current 的（渲染线程已经设置）
    // 注意：render_internal 现在在渲染线程中调用，context 已经是 current 的
    
    // 关键参数说明：
    // 1. 窗口大小（w, h）：Electron 传入的像素尺寸
    // 2. 视口大小（viewport）：OpenGL 渲染区域，应该等于窗口大小
    // 3. 视频大小：mpv 视频的原始尺寸（从 mpv 属性获取）
    // 4. keepaspect：mpv 属性，控制是否保持宽高比
    // 
    glClearColor(0.0f, 0.0f, 0.0f, 1.0f);
    glClear(GL_COLOR_BUFFER_BIT);
    
    GLint drawFbo = 0;
    glGetIntegerv(GL_DRAW_FRAMEBUFFER_BINDING, &drawFbo);
    
    mpv_opengl_fbo fbo;
    memset(&fbo, 0, sizeof(fbo));
    fbo.fbo = drawFbo != 0 ? (int)drawFbo : 0;
    fbo.w = w;  // 窗口宽度（像素）
    fbo.h = h;  // 窗口高度（像素）
    
    int flip_y = 1;
    
    mpv_render_param params[] = {
        { MPV_RENDER_PARAM_OPENGL_FBO, &fbo },
        { MPV_RENDER_PARAM_FLIP_Y, &flip_y },
        { MPV_RENDER_PARAM_INVALID, nullptr }
    };
    
    // 检查尺寸是否变化（通过比较当前尺寸和上次渲染尺寸）
    bool sizeChanged = (w != rc->lastRenderedWidth || h != rc->lastRenderedHeight);
    
    // 通知 mpv 尺寸/状态变化
    uint64_t flags = mpv_render_context_update(rc->mpvRenderCtx);
    bool hasNewFrame = (flags & MPV_RENDER_UPDATE_FRAME) != 0;
    
    if (forceBlack) {
        rc->forceBlackFrame.store(false);
        
        if (sizeChanged) {
            rc->lastRenderedWidth = w;
            rc->lastRenderedHeight = h;
        }
        
        @try {
            [rc->glContext flushBuffer];
        } @catch (NSException *ex) {
            NSLog(@"[mpv_render_gl] flushBuffer failed: %@", ex);
        }
        
        return;
    }
    
    if (hasNewFrame || sizeChanged) {
        int res = mpv_render_context_render(rc->mpvRenderCtx, params);
        
        if (res < 0) {
            NSLog(@"[mpv_render_gl] ❌ mpv_render_context_render failed: %d (win %dx%d, FBO %dx%d)", 
                  res, w, h, fbo.w, fbo.h);
        } else {
            // 更新上次渲染的尺寸
            if (sizeChanged) {
                rc->lastRenderedWidth = w;
                rc->lastRenderedHeight = h;
            }
            
            // 只有在成功渲染后才 flush（在渲染线程中执行，不会阻塞主线程）
            @try {
                [rc->glContext flushBuffer];
            } @catch (NSException *ex) {
                NSLog(@"[mpv_render_gl] flushBuffer failed: %@", ex);
            }
        }
    }
}

extern "C" void mpv_request_render(int64_t instanceId) {
    std::shared_ptr<GLRenderContext> rc = nullptr;
    {
        std::lock_guard<std::mutex> lock(g_renderMutex);
        auto it = g_renderContexts.find(instanceId);
        if (it == g_renderContexts.end()) return;
        rc = it->second;
    }
    
    if (!rc || rc->isDestroying.load()) return;
    
    rc->needRedraw.store(true);
}

// ------------------ render entry (exposed) ------------------
// Called from render thread (background thread, not main thread)
extern "C" void mpv_render_frame_for_instance(int64_t instanceId) {
    std::shared_ptr<GLRenderContext> rc = nullptr;
    {
        std::lock_guard<std::mutex> lock(g_renderMutex);
        auto it = g_renderContexts.find(instanceId);
        if (it == g_renderContexts.end()) return;
        rc = it->second;
    }
    
    if (!rc || rc->isDestroying.load() || !rc->glContext || !rc->mpvRenderCtx) return;
    
    bool expected = true;
    if (!rc->needRedraw.compare_exchange_strong(expected, false)) {
        return;
    }
    
    render_internal(rc.get());
}

extern "C" void mpv_set_force_black_mode(int64_t instanceId, int enabled) {
    std::shared_ptr<GLRenderContext> rc = nullptr;
    {
        std::lock_guard<std::mutex> lock(g_renderMutex);
        auto it = g_renderContexts.find(instanceId);
        if (it == g_renderContexts.end()) return;
        rc = it->second;
    }
    
    if (!rc || rc->isDestroying.load()) return;
    
    rc->forceBlackMode.store(enabled != 0);
    rc->needRedraw.store(true);
}
