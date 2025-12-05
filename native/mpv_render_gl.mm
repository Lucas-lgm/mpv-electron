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

extern "C" {
#include <mpv/client.h>
#include <mpv/render.h>
#include <mpv/render_gl.h>
}

struct GLRenderContext {
    NSView *view = nil;
    NSOpenGLContext *glContext = nil;
    mpv_render_context *mpvRenderCtx = nullptr;
    CVDisplayLinkRef displayLink = nullptr;
    int width = 0;           // 当前使用的尺寸（已通知 mpv）
    int height = 0;
    std::atomic<bool> needRedraw;
    std::atomic<bool> isDestroying;  // 标记正在销毁，回调应该立即退出
    std::mutex sizeMutex;  // 保护尺寸更新的互斥锁
    
    GLRenderContext() : needRedraw(false), isDestroying(false) {}
    
    ~GLRenderContext() {
        stopDisplayLink();
    }
    
    void stopDisplayLink() {
        // 这个方法现在由 destroyGL 直接处理，保留用于兼容性
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
    
    // 简单检查：context 是否存在且未在销毁
    {
        std::lock_guard<std::mutex> lock(g_renderMutex);
        auto it = g_renderContexts.find(instanceId);
        if (it == g_renderContexts.end()) return kCVReturnSuccess;
        GLRenderContext *rc = it->second;
        if (!rc || rc->isDestroying.load() || rc->displayLink != displayLink) {
            return kCVReturnSuccess;
        }
    }
    
    // 直接渲染，不做其他判断
    mpv_render_frame_for_instance(instanceId);
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

    // 初始化时不设置尺寸，等待 Electron 通过 mpv_set_window_size 传入
    // 这样可以确保初始尺寸和后续尺寸来源一致
    rc->width = 0;
    rc->height = 0;
    
    NSLog(@"[mpv_render_gl] GL context created, waiting for Electron to set window size");

    [pf release];
    return true;
}

static void destroyGL(GLRenderContext *rc) {
    if (!rc) return;
    
    // 关键：先设置销毁标志，让所有正在执行或即将执行的回调立即退出
    rc->isDestroying = true;
    
    // 然后停止 display link
    if (rc->displayLink) {
        CVDisplayLinkStop(rc->displayLink);
        // 等待 displayLink 完全停止（最多等待 50ms）
        // 设置 isDestroying 后，回调会立即退出，所以不需要等待太久
        int waitCount = 0;
        while (CVDisplayLinkIsRunning(rc->displayLink) && waitCount < 50) {
            usleep(1000); // 等待 1ms
            waitCount++;
        }
        CVDisplayLinkRelease(rc->displayLink);
        rc->displayLink = nullptr;
    }
    
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
    // view 不需要释放，它由 Electron 管理
    rc->view = nil;
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
// 这是唯一可靠的尺寸来源，直接更新，不做复杂判断
extern "C" void mpv_set_window_size(int64_t instanceId, int width, int height) {
    std::lock_guard<std::mutex> lock(g_renderMutex);
    auto it = g_renderContexts.find(instanceId);
    if (it == g_renderContexts.end()) return;
    
    GLRenderContext *rc = it->second;
    if (!rc) return;
    
    std::lock_guard<std::mutex> sizeLock(rc->sizeMutex);
    int oldWidth = rc->width;
    int oldHeight = rc->height;
    
    // 只有尺寸真正变化时才更新
    if (oldWidth != width || oldHeight != height) {
        rc->width = width;
        rc->height = height;
        rc->needRedraw = true;
        NSLog(@"[mpv_render_gl] Size updated: %dx%d -> %dx%d", oldWidth, oldHeight, width, height);
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
    
    if (!rc || rc->isDestroying.load() || !rc->glContext || !rc->mpvRenderCtx) return;

    // 直接使用 Electron 传入的尺寸，不做任何判断
    int renderWidth, renderHeight;
    {
        std::lock_guard<std::mutex> sizeLock(rc->sizeMutex);
        renderWidth = rc->width;
        renderHeight = rc->height;
    }
    
    if (renderWidth <= 0 || renderHeight <= 0) return;

    // 更新 mpv（必须在渲染线程调用）
    mpv_render_context_update(rc->mpvRenderCtx);

    // 渲染
    [rc->glContext makeCurrentContext];
    glViewport(0, 0, renderWidth, renderHeight);
    glClearColor(0.0f, 0.0f, 0.0f, 1.0f);
    glClear(GL_COLOR_BUFFER_BIT);

    // 关键：FBO 和 viewport 必须完全一致
    // mpv 会根据 FBO 的尺寸（fbo.w, fbo.h）自动重新配置渲染器（文档说明）
    // 注意：MPV_RENDER_PARAM_SW_SIZE 只用于软件渲染，OpenGL 渲染不需要
    mpv_opengl_fbo fbo = {0, renderWidth, renderHeight};
    int flip_y = 1;
    
    mpv_render_param r_params[] = {
        {MPV_RENDER_PARAM_OPENGL_FBO, &fbo},  // mpv 根据 fbo.w/h 自动重新配置
        {MPV_RENDER_PARAM_FLIP_Y, &flip_y},
        {MPV_RENDER_PARAM_INVALID, nullptr}
    };

    // 定期输出渲染信息（每 60 帧一次，避免日志过多）
    static int frameCount = 0;
    static int lastLoggedWidth = 0;
    static int lastLoggedHeight = 0;
    bool shouldLog = false;
    
    if (++frameCount % 60 == 0 || renderWidth != lastLoggedWidth || renderHeight != lastLoggedHeight) {
        shouldLog = true;
        lastLoggedWidth = renderWidth;
        lastLoggedHeight = renderHeight;
    }
    
    int result = mpv_render_context_render(rc->mpvRenderCtx, r_params);
    if (result < 0) {
        NSLog(@"[mpv_render_gl] ⚠️ Render failed: %d (size: %dx%d)", result, renderWidth, renderHeight);
    } else if (shouldLog) {
        NSLog(@"[mpv_render_gl] Rendering: viewport=%dx%d, FBO=%dx%d", 
              renderWidth, renderHeight, fbo.w, fbo.h);
    }
    [rc->glContext flushBuffer];
}

