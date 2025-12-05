#import <Cocoa/Cocoa.h>
#import <OpenGL/gl3.h>
#import <OpenGL/OpenGL.h>

#include <map>
#include <mutex>
#include <atomic>
#include <dlfcn.h>
#include <cmath>
#include <unistd.h>  // for usleep
#include <thread>

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
    
    // render scheduling flag (atomic)
    std::atomic<bool> needRedraw;
    std::atomic<bool> isDestroying;
    
    // 渲染线程（后台线程，避免阻塞主线程）
    std::thread* renderThread = nullptr;
    std::atomic<bool> renderThreadRunning;
    
    GLRenderContext() : needRedraw(false), isDestroying(false), renderThreadRunning(false) {}
};

// globals
static std::map<int64_t, GLRenderContext*> g_renderContexts;
static std::mutex g_renderMutex;

// forward declarations
extern "C" void mpv_render_frame_for_instance(int64_t instanceId);
extern "C" void mpv_request_render(int64_t instanceId);

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
// Just mark needRedraw, render thread will handle it.
static void on_mpv_redraw(void *ctx) {
    int64_t instanceId = (int64_t)(intptr_t)ctx;
    GLRenderContext *rc = nullptr;
    {
        std::lock_guard<std::mutex> lock(g_renderMutex);
        auto it = g_renderContexts.find(instanceId);
        if (it == g_renderContexts.end()) return;
        rc = it->second;
    }
    
    if (!rc || rc->isDestroying.load()) return;
    
    // 只标记需要重绘，渲染线程会处理
    rc->needRedraw.store(true);
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
    
    rc->glContext = ctx;
    
    // Read initial backing size on main thread as fallback initial value
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
    
    [pf release];
    return true;
}

// ------------------ render thread function ------------------
// 在后台线程中运行，避免阻塞主线程
static void renderThreadFunc(GLRenderContext *rc, int64_t instanceId) {
    // 在渲染线程中设置 OpenGL context 为 current
    @autoreleasepool {
        [rc->glContext makeCurrentContext];
        
        // 渲染循环
        while (rc->renderThreadRunning.load() && !rc->isDestroying.load()) {
            // 检查是否需要渲染
            if (rc->needRedraw.load()) {
                mpv_render_frame_for_instance(instanceId);
            }
            
            // 短暂休眠，避免 CPU 占用过高
            usleep(1000); // 1ms，约 1000fps 检查频率
        }
        
        // 清理：清除当前 context
        [NSOpenGLContext clearCurrentContext];
    }
}

// ------------------ destroy GL ------------------
static void destroyGL(GLRenderContext *rc) {
    if (!rc) return;
    
    rc->isDestroying.store(true);
    
    // 停止渲染线程
    if (rc->renderThread) {
        rc->renderThreadRunning.store(false);
        if (rc->renderThread->joinable()) {
            rc->renderThread->join();
        }
        delete rc->renderThread;
        rc->renderThread = nullptr;
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
    });
    
    rc->view = nil;
    rc->mpvHandle = nullptr;
}

// ------------------ public: create context ------------------
extern "C" GLRenderContext *mpv_create_gl_context_for_view(int64_t instanceId, void *nsViewPtr, mpv_handle *mpv) {
    if (!nsViewPtr || !mpv) return nullptr;
    
    GLRenderContext *rc = new GLRenderContext();
    NSView *view = reinterpret_cast<NSView*>(nsViewPtr);
    rc->view = view;
    rc->mpvHandle = mpv;
    
    // create GL and read initial size - must be on main thread
    if (!isMainThread()) {
        // ensure createGLForView runs on main thread
        // 使用指针来避免 block 捕获 const 的问题
        std::atomic<bool>* ok = new std::atomic<bool>(false);
        runOnMainAsync(^{
            bool result = createGLForView(rc);
            ok->store(result);
        });
        // 等待主线程执行完成（简单等待，实际应该用更好的同步机制）
        int waitCount = 0;
        while (!ok->load() && waitCount < 100) {
            usleep(10000); // 等待 10ms
            waitCount++;
        }
        bool result = ok->load();
        delete ok;
        if (!result) {
            delete rc;
            return nullptr;
        }
    } else {
        if (!createGLForView(rc)) {
            delete rc;
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
        delete rc;
        return nullptr;
    }
    
    // Set mpv update callback (thread may be arbitrary)
    mpv_render_context_set_update_callback(rc->mpvRenderCtx, on_mpv_redraw, (void*)(intptr_t)instanceId);
    
    // 注册到全局 map
    {
        std::lock_guard<std::mutex> lock(g_renderMutex);
        g_renderContexts[instanceId] = rc;
    }
    
    // 创建渲染线程（后台线程，避免阻塞主线程）
    rc->renderThreadRunning.store(true);
    rc->renderThread = new std::thread(renderThreadFunc, rc, instanceId);
    
    return rc;
}

// ------------------ public: destroy context ------------------
extern "C" void mpv_destroy_gl_context(int64_t instanceId) {
    GLRenderContext *rc = nullptr;
    {
        std::lock_guard<std::mutex> lock(g_renderMutex);
        auto it = g_renderContexts.find(instanceId);
        if (it == g_renderContexts.end()) return;
        rc = it->second;
        g_renderContexts.erase(it);
    }
    
    if (rc) {
        destroyGL(rc);
        delete rc;
    }
}

// ------------------ public: set window size (pixel) ------------------
// External code (Electron main/renderer on main thread) may call this to inform us of new pixel sizes.
// If not called, we fall back to initial size read at creation.
extern "C" void mpv_set_window_size(int64_t instanceId, int width, int height) {
    if (width <= 0 || height <= 0) return;
    
    GLRenderContext *rc = nullptr;
    {
        std::lock_guard<std::mutex> lock(g_renderMutex);
        auto it = g_renderContexts.find(instanceId);
        if (it == g_renderContexts.end()) return;
        rc = it->second;
    }
    
    if (!rc) return;
    
    // 检查尺寸是否真的变化了，避免不必要的渲染
    bool sizeChanged = false;
    {
        std::lock_guard<std::mutex> sl(rc->sizeMutex);
        if (rc->width != width || rc->height != height) {
            rc->width = width;
            rc->height = height;
            sizeChanged = true;
            NSLog(@"[mpv_render_gl] Window size changed to %dx%d", width, height);
        }
    }
    
    // 尺寸变化时，立即通知 mpv 更新（在渲染线程中）
    // 按照 mpv render API 的要求：
    // 1. 更新 FBO 尺寸（在渲染时传递新的 width/height）
    // 2. 传递 MPV_RENDER_PARAM_SW_SIZE（在渲染时）
    // 3. 调用 mpv_render_context_update()（在渲染时，但尺寸变化后立即标记需要更新）
    if (sizeChanged) {
        // 标记需要重绘
        rc->needRedraw.store(true);
    }
}

// 不再需要查询视频尺寸，让 mpv 自己处理 keepaspect

// ------------------ core render (must run on main thread) ------------------
static void render_internal(GLRenderContext *rc) {
    if (!rc || !rc->mpvRenderCtx || !rc->glContext) return;
    
    // get pixel target size (from stored fields)
    int w = 0, h = 0;
    {
        std::lock_guard<std::mutex> sl(rc->sizeMutex);
        w = rc->width;
        h = rc->height;
    }
    
    // fallback: one-off read from view (only if stored sizes are 0)
    if (w <= 0 || h <= 0) {
        @try {
            NSRect bounds = [rc->view bounds];
            NSSize backing = [rc->view convertSizeToBacking:bounds.size];
            int bw = (int)backing.width;
            int bh = (int)backing.height;
            if (bw > 0 && bh > 0) { 
                w = bw; 
                h = bh; 
                // 更新存储的尺寸，避免下次再读取
                rc->width = w;
                rc->height = h;
            }
        } @catch (NSException *ex) {
            return;
        }
    }
    
    if (w <= 0 || h <= 0) return;
    
    // 调试：记录渲染尺寸
    static int lastRenderW = 0, lastRenderH = 0;
    if (w != lastRenderW || h != lastRenderH) {
        NSLog(@"[mpv_render_gl] Rendering at %dx%d", w, h);
        lastRenderW = w;
        lastRenderH = h;
    }
    
    // 渲染在后台线程执行，不需要检查主线程
    // 确保 OpenGL context 在当前线程是 current 的（渲染线程已经设置）
    // 注意：render_internal 现在在渲染线程中调用，context 已经是 current 的
    
    // 设置 viewport 为整个窗口（mpv 会根据 keepaspect 自动处理 letterbox）
    glViewport(0, 0, w, h);
    glClearColor(0.0f, 0.0f, 0.0f, 1.0f);
    glClear(GL_COLOR_BUFFER_BIT);
    
    // 不手动计算 letterbox，让 mpv 根据 keepaspect 自动处理
    // mpv 会根据 FBO 尺寸和视频宽高比自动计算并渲染
    mpv_opengl_fbo fbo;
    memset(&fbo, 0, sizeof(fbo));
    fbo.fbo = 0;
    fbo.w = w;  // 使用窗口完整尺寸
    fbo.h = h;  // mpv 会自动处理 letterbox
    
    int flip_y = 1;
    // 注意：对于 OpenGL 渲染，SW_SIZE 可能不需要，但参考实现中有，保留
    int sw_size[2] = { w, h };
    
    // 按照 mpv render API 的正确顺序：
    // 1. 创建/更新 OpenGL FBO（已创建 fbo 结构）
    // 2. 在 MPV_RENDER_PARAM_OPENGL_FBO 中传递新的 width/height（fbo.w 和 fbo.h）
    // 3. 传递 MPV_RENDER_PARAM_SW_SIZE（当底层渲染目标尺寸变化时）
    // 4. 调用 mpv_render_context_update() 通知 mpv 尺寸变化
    mpv_render_param params[] = {
        { MPV_RENDER_PARAM_OPENGL_FBO, &fbo },
        { MPV_RENDER_PARAM_FLIP_Y, &flip_y },
        { MPV_RENDER_PARAM_SW_SIZE, sw_size },  // 当底层渲染目标尺寸变化时传递
        { MPV_RENDER_PARAM_INVALID, nullptr }
    };
    
    // 先通知 mpv 尺寸/状态变化（在渲染前调用）
    mpv_render_context_update(rc->mpvRenderCtx);
    
    // 然后渲染（传递新的 FBO 尺寸）
    int res = mpv_render_context_render(rc->mpvRenderCtx, params);
    if (res < 0) {
        NSLog(@"[mpv_render_gl] mpv_render_context_render failed: %d (win %dx%d)", res, w, h);
    }
    
    // flush/swap (在渲染线程中执行，不会阻塞主线程)
    @try {
        [rc->glContext flushBuffer];
    } @catch (NSException *ex) {}
}

// ------------------ request render (exposed) ------------------
// Mark needRedraw, render thread will handle it
extern "C" void mpv_request_render(int64_t instanceId) {
    GLRenderContext *rc = nullptr;
    {
        std::lock_guard<std::mutex> lock(g_renderMutex);
        auto it = g_renderContexts.find(instanceId);
        if (it == g_renderContexts.end()) return;
        rc = it->second;
    }
    
    if (!rc || rc->isDestroying.load()) return;
    
    // 只标记需要重绘，渲染线程会处理
    rc->needRedraw.store(true);
}

// ------------------ render entry (exposed) ------------------
// Called from render thread (background thread, not main thread)
extern "C" void mpv_render_frame_for_instance(int64_t instanceId) {
    GLRenderContext *rc = nullptr;
    {
        std::lock_guard<std::mutex> lock(g_renderMutex);
        auto it = g_renderContexts.find(instanceId);
        if (it == g_renderContexts.end()) return;
        rc = it->second;
    }
    
    if (!rc || rc->isDestroying.load() || !rc->glContext || !rc->mpvRenderCtx) return;
    
    // 检查是否需要渲染（避免重复渲染）
    bool expected = true;
    if (!rc->needRedraw.compare_exchange_strong(expected, false)) {
        // needRedraw 已经是 false，说明已经在渲染或刚渲染完，跳过
        return;
    }
    
    // call internal renderer (在渲染线程中执行，context 已经是 current 的)
    render_internal(rc);
}
