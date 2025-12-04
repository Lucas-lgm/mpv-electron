#import <Cocoa/Cocoa.h>
#import <OpenGL/gl3.h>
#import <OpenGL/OpenGL.h>
#import <CoreVideo/CoreVideo.h>

#include <map>
#include <mutex>
#include <atomic>
#include <dlfcn.h>
#include <cmath>

extern "C" {
#include <mpv/client.h>
#include <mpv/render_gl.h>
}

struct GLRenderContext {
    NSView *view = nil;
    NSOpenGLContext *glContext = nil;
    mpv_render_context *mpvRenderCtx = nullptr;
    CVDisplayLinkRef displayLink = nullptr;
    int width = 0;
    int height = 0;
    std::atomic<bool> needRedraw;
    std::mutex sizeMutex;  // 保护尺寸更新的互斥锁
    
    GLRenderContext() : needRedraw(false) {}
    
    ~GLRenderContext() {
        stopDisplayLink();
    }
    
    void stopDisplayLink() {
        if (displayLink) {
            CVDisplayLinkStop(displayLink);
            CVDisplayLinkRelease(displayLink);
            displayLink = nullptr;
        }
    }
};

static std::map<int64_t, GLRenderContext*> g_renderContexts;
static std::mutex g_renderMutex;

// 前向声明
extern "C" void mpv_render_frame_for_instance(int64_t instanceId);

// mpv 更新回调（当 mpv 需要重绘时调用）
static void on_mpv_redraw(void *ctx) {
    int64_t instanceId = (int64_t)(intptr_t)ctx;
    std::lock_guard<std::mutex> lock(g_renderMutex);
    auto it = g_renderContexts.find(instanceId);
    if (it != g_renderContexts.end()) {
        it->second->needRedraw = true;
    }
}

// CVDisplayLink 回调（在屏幕刷新时调用）
static CVReturn displayLinkCallback(
    CVDisplayLinkRef displayLink,
    const CVTimeStamp *inNow,
    const CVTimeStamp *inOutputTime,
    CVOptionFlags flagsIn,
    CVOptionFlags *flagsOut,
    void *displayLinkContext)
{
    int64_t instanceId = (int64_t)(intptr_t)displayLinkContext;
    
    // 检查是否需要重绘
    bool shouldRender = false;
    {
        std::lock_guard<std::mutex> lock(g_renderMutex);
        auto it = g_renderContexts.find(instanceId);
        if (it != g_renderContexts.end()) {
            // 即使 needRedraw 为 false，也检查窗口大小是否变化（强制更新尺寸）
            shouldRender = it->second->needRedraw.load();
            if (shouldRender) {
                it->second->needRedraw = false;
            } else {
                // 即使不需要重绘，也检查尺寸变化（确保尺寸始终是最新的）
                // 这样即使 KVO 没有触发，我们也能检测到窗口大小变化
                shouldRender = true; // 总是渲染，让 mpv_render_frame_for_instance 检查尺寸
            }
        }
    }
    
    if (shouldRender) {
        // 直接在 CVDisplayLink 回调中执行渲染
        // OpenGL context 操作可以在任何线程执行（只要 context 已正确设置）
        // 注意：我们已经移除了 [glContext update] 调用，所以不需要主线程
        mpv_render_frame_for_instance(instanceId);
    }
    
    return kCVReturnSuccess;
}

static void *get_proc_address(void *ctx, const char *name) {
    (void)ctx;
    return dlsym(RTLD_DEFAULT, name);
}

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

    [ctx setView:rc->view];
    [ctx makeCurrentContext];

    rc->glContext = ctx;

    // 获取视图的实际像素尺寸（考虑 Retina）
    // 尝试获取窗口的 contentView 尺寸，确保获取整个窗口大小
    NSWindow *window = [rc->view window];
    NSView *contentView = window ? [window contentView] : nil;
    NSRect viewBounds = [rc->view bounds];
    
    // 如果 contentView 存在，优先使用它的尺寸
    if (contentView && contentView != rc->view) {
        viewBounds = [contentView bounds];
        NSLog(@"[mpv_render_gl] Using contentView for initial size");
    }
    
    NSSize backingSize = [rc->view convertSizeToBacking:viewBounds.size];
    rc->width  = (int)backingSize.width;
    rc->height = (int)backingSize.height;
    
    // 如果转换失败，使用 bounds 的尺寸
    if (rc->width <= 0 || rc->height <= 0) {
        rc->width = (int)viewBounds.size.width;
        rc->height = (int)viewBounds.size.height;
    }
    
    // 确保尺寸有效（至少为 1）
    if (rc->width <= 0) rc->width = 1;
    if (rc->height <= 0) rc->height = 1;
    
    NSLog(@"[mpv_render_gl] Initial window size: %dx%d (bounds: %.0fx%.0f, backing: %.0fx%.0f, view: %@)", 
          rc->width, rc->height, 
          viewBounds.size.width, viewBounds.size.height,
          backingSize.width, backingSize.height,
          rc->view);

    glViewport(0, 0, rc->width, rc->height);

    [pf release];
    return true;
}

static void destroyGL(GLRenderContext *rc) {
    if (!rc) return;
    
    // 停止 display link
    rc->stopDisplayLink();
    
    if (rc->mpvRenderCtx) {
        // 清除更新回调
        mpv_render_context_set_update_callback(rc->mpvRenderCtx, nullptr, nullptr);
        mpv_render_context_free(rc->mpvRenderCtx);
        rc->mpvRenderCtx = nullptr;
    }
    if (rc->glContext) {
        [NSOpenGLContext clearCurrentContext];
        [rc->glContext clearDrawable];
        [rc->glContext release];
        rc->glContext = nil;
    }
}

extern "C" GLRenderContext *mpv_create_gl_context_for_view(int64_t instanceId, void *nsViewPtr, mpv_handle *mpv) {
    if (!nsViewPtr || !mpv) return nullptr;

    GLRenderContext *rc = new GLRenderContext();
    // 将指针值转换为 NSView*（从 Electron 传过来的是 NSView* 的数值）
    rc->view = reinterpret_cast<NSView*>(nsViewPtr);

    if (!createGLForView(rc)) {
        delete rc;
        return nullptr;
    }
    
    // 不再监听窗口大小变化，尺寸由外部（Electron）传入

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

    // 设置 mpv 更新回调（当 mpv 需要重绘时通知我们）
    mpv_render_context_set_update_callback(rc->mpvRenderCtx, on_mpv_redraw, (void*)(intptr_t)instanceId);

    // 创建 CVDisplayLink 来同步屏幕刷新
    CVDisplayLinkCreateWithActiveCGDisplays(&rc->displayLink);
    CVDisplayLinkSetOutputCallback(rc->displayLink, displayLinkCallback, (void*)(intptr_t)instanceId);
    CVDisplayLinkStart(rc->displayLink);

    std::lock_guard<std::mutex> lock(g_renderMutex);
    g_renderContexts[instanceId] = rc;
    return rc;
}

extern "C" void mpv_destroy_gl_context(int64_t instanceId) {
    GLRenderContext *rc = nullptr;
    {
    std::lock_guard<std::mutex> lock(g_renderMutex);
    auto it = g_renderContexts.find(instanceId);
    if (it == g_renderContexts.end()) return;
        rc = it->second;
    g_renderContexts.erase(it);
    }
    
    // 停止 display link 并清理（在锁外执行，避免死锁）
    if (rc) {
    destroyGL(rc);
    delete rc;
    }
}

// 从外部设置窗口尺寸（由 Electron 调用）
// 注意：这个函数现在主要用于初始设置，实际渲染时从 view 直接获取尺寸
extern "C" void mpv_set_window_size(int64_t instanceId, int width, int height) {
    if (width <= 0 || height <= 0) {
        NSLog(@"[mpv_render_gl] ⚠️ Invalid size from external: %dx%d", width, height);
        return;
    }
    
    // 验证尺寸合理性
    if (width < 10 || height < 10 || width > 20000 || height > 20000) {
        NSLog(@"[mpv_render_gl] ⚠️ Suspicious size from external: %dx%d, ignoring", width, height);
        return;
    }
    
    std::lock_guard<std::mutex> lock(g_renderMutex);
    auto it = g_renderContexts.find(instanceId);
    if (it == g_renderContexts.end()) {
        NSLog(@"[mpv_render_gl] ⚠️ Instance %lld not found for size update", instanceId);
        return;
    }
    
    GLRenderContext *rc = it->second;
    if (!rc) return;
    
    {
        std::lock_guard<std::mutex> sizeLock(rc->sizeMutex);
        
        // 检查尺寸是否变化（只有当变化超过 2 像素时才更新，避免频繁更新）
        int widthDiff = std::abs(rc->width - width);
        int heightDiff = std::abs(rc->height - height);
        
        if (widthDiff > 2 || heightDiff > 2) {
            NSLog(@"[mpv_render_gl] ✅ External size update: %dx%d -> %dx%d", 
                  rc->width, rc->height, width, height);
            
            rc->width = width;
            rc->height = height;
            
            // 通知 mpv render context 窗口大小变化了
            if (rc->mpvRenderCtx) {
                mpv_render_context_update(rc->mpvRenderCtx);
            }
            
            rc->needRedraw = true;
        }
    }
}

extern "C" void mpv_render_frame_for_instance(int64_t instanceId) {
    GLRenderContext *rc = nullptr;
    {
    std::lock_guard<std::mutex> lock(g_renderMutex);
    auto it = g_renderContexts.find(instanceId);
    if (it == g_renderContexts.end()) return;
        rc = it->second;
    }
    
    // 在锁外执行渲染，避免长时间持有锁
    if (!rc || !rc->glContext || !rc->mpvRenderCtx || !rc->view) return;

    // 安全检查：确保 view 还没有被释放（通过检查 window 是否存在）
    @try {
        NSWindow *window = [rc->view window];
        if (!window) {
            // view 的 window 已经被释放，说明 view 即将或已经被销毁
            return;
        }
    } @catch (NSException *exception) {
        // 访问已释放的对象会抛出异常，直接返回
        return;
    }

    // 简化：直接从 view 获取窗口尺寸（每次渲染时都获取最新尺寸）
    int renderWidth = 0;
    int renderHeight = 0;
    
    @try {
        NSRect bounds = [rc->view bounds];
        
        // 使用 convertSizeToBacking 获取实际像素尺寸（考虑 Retina）
        NSSize backingSize = [rc->view convertSizeToBacking:bounds.size];
        renderWidth = (int)backingSize.width;
        renderHeight = (int)backingSize.height;
        
        // 如果转换失败，使用 bounds（非 Retina 显示器）
        if (renderWidth <= 0 || renderHeight <= 0) {
            renderWidth = (int)bounds.size.width;
            renderHeight = (int)bounds.size.height;
        }
        
        // 确保尺寸有效
        if (renderWidth <= 0) renderWidth = 1;
        if (renderHeight <= 0) renderHeight = 1;
        
        // 检查尺寸是否变化，如果变化则更新并通知 mpv
        {
            std::lock_guard<std::mutex> sizeLock(rc->sizeMutex);
            int widthDiff = std::abs(rc->width - renderWidth);
            int heightDiff = std::abs(rc->height - renderHeight);
            
            // 只有当尺寸变化超过 2 像素时才更新
            if (widthDiff > 2 || heightDiff > 2) {
                if (rc->width > 0 && rc->height > 0) {
                    NSLog(@"[mpv_render_gl] Size changed: %dx%d -> %dx%d", 
                          rc->width, rc->height, renderWidth, renderHeight);
                }
                rc->width = renderWidth;
                rc->height = renderHeight;
                
                // 通知 mpv 窗口大小变化了
                if (rc->mpvRenderCtx) {
                    mpv_render_context_update(rc->mpvRenderCtx);
                }
                rc->needRedraw = true;
            } else {
                // 尺寸没变化，使用存储的尺寸（避免重复计算）
                renderWidth = rc->width;
                renderHeight = rc->height;
            }
        }
    } @catch (NSException *exception) {
        // 如果获取失败，使用存储的尺寸
        std::lock_guard<std::mutex> sizeLock(rc->sizeMutex);
        if (rc->width > 0 && rc->height > 0) {
            renderWidth = rc->width;
            renderHeight = rc->height;
        } else {
            return; // 没有有效尺寸，跳过渲染
        }
    }
    
    if (renderWidth <= 0 || renderHeight <= 0) {
        return;
    }

    @try {
    // OpenGL context 操作可以在任何线程执行（只要 context 已正确设置）
    // 注意：我们已经移除了 [glContext update] 调用，所以不需要主线程
    // makeCurrentContext 可以在任何线程调用
    [rc->glContext makeCurrentContext];

        // 设置 viewport 为整个窗口大小（使用像素尺寸）
        glViewport(0, 0, renderWidth, renderHeight);
        glClearColor(0.0f, 0.0f, 0.0f, 1.0f);
        glClear(GL_COLOR_BUFFER_BIT);

    // 设置 FBO（OpenGL 帧缓冲对象）
    mpv_opengl_fbo fbo = {};
    fbo.fbo = 0;  // 0 表示使用默认帧缓冲
    fbo.w   = renderWidth;
    fbo.h   = renderHeight;

    int flip_y = 1;  // 翻转 Y 轴（macOS 坐标系需要）
    
    // 告诉 mpv 窗口大小（像素尺寸）
    // 重要：FBO 尺寸和 SW_SIZE 必须完全匹配，mpv 用这个计算视频缩放和宽高比
    int win_size[2] = { renderWidth, renderHeight };
    
    mpv_render_param r_params[] = {
        { MPV_RENDER_PARAM_OPENGL_FBO, &fbo },      // OpenGL 帧缓冲
        { MPV_RENDER_PARAM_FLIP_Y, &flip_y },       // 翻转 Y 轴
        { MPV_RENDER_PARAM_SW_SIZE, win_size },     // 窗口大小（像素），mpv 用这个计算视频缩放
        { MPV_RENDER_PARAM_INVALID, nullptr }
    };

        // 渲染视频帧
        // mpv 会根据 SW_SIZE（窗口大小）和 keepaspect 设置自动缩放视频：
        // - keepaspect=true: 保持视频原始宽高比，在窗口内居中显示（可能有黑边）
        // - keepaspect=false: 拉伸视频填满整个窗口（可能变形）
        int render_result = mpv_render_context_render(rc->mpvRenderCtx, r_params);
        if (render_result < 0) {
            NSLog(@"[mpv_render_gl] ⚠️ Render failed: %d, size: %dx%d", render_result, renderWidth, renderHeight);
        }
    [rc->glContext flushBuffer];
    } @catch (NSException *exception) {
        // GL context 或 view 已被释放，静默返回
        return;
    }
}

