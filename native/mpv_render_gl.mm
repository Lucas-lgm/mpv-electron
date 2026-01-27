#import <Cocoa/Cocoa.h>
#import <QuartzCore/QuartzCore.h>
#import <objc/message.h>
#import <OpenGL/gl3.h>
#import <OpenGL/OpenGL.h>
#import <CoreVideo/CoreVideo.h>
#import <CoreFoundation/CoreFoundation.h>

#include <map>
#include <mutex>
#include <atomic>
#include <dlfcn.h>
#include <cmath>
#include <algorithm>  // for std::max, std::min
#include <unistd.h>  // for usleep
#include <thread>
#include <chrono>
#include <memory>
#include <vector>

extern "C" {
#include <mpv/client.h>
#include <mpv/render.h>
#include <mpv/render_gl.h>
}

// ------------------ Context struct ------------------
struct GLRenderContext {
    NSView *view = nil;
    CAOpenGLLayer *glLayer = nil;
    CGLContextObj cglContext = nil;
    CGLPixelFormatObj cglPixelFormat = nil;
    mpv_render_context *mpvRenderCtx = nullptr;
    mpv_handle *mpvHandle = nullptr;
    int64_t instanceId = 0;
    
    // pixel size (width/height) used for rendering (单位：像素)
    int width = 0;
    int height = 0;
    std::mutex sizeMutex;
    
    // 上次渲染的尺寸（用于检测尺寸变化）
    int lastRenderedWidth = 0;
    int lastRenderedHeight = 0;
    
    // render scheduling flag (atomic)
    std::atomic<bool> needRedraw;
    std::atomic<bool> displayScheduled;
    std::atomic<bool> resizeScheduled;
    std::atomic<bool> isDestroying;
    
    // CVDisplayLink
    CVDisplayLinkRef displayLink = nullptr;
    
    // NSView frame observer
    id frameObserver = nil;
    
    std::atomic<bool> forceBlackFrame;
    std::atomic<bool> forceBlackMode;
    
    std::atomic<bool> hdrUserEnabled;
    bool hdrActive;
    std::atomic<uint64_t> lastHdrUpdateMs;
    
    std::atomic<uint64_t> lastRenderTimeMs;
    // 视频帧率（fps），用于动态计算渲染间隔
    std::atomic<double> videoFps;
    // 最小渲染间隔（毫秒），根据视频帧率动态计算
    // 默认值 16ms (~60fps)，如果视频帧率更高则相应调整
    static constexpr uint64_t DEFAULT_MIN_RENDER_INTERVAL_MS = 16; // ~60fps max
    
    // JavaScript 驱动渲染模式标志
    // true: 渲染由 JavaScript 端（如 requestAnimationFrame）驱动
    // false: 渲染由 CVDisplayLink 自动驱动（默认）
    std::atomic<bool> jsDrivenRenderMode;

    std::mutex iccMutex;
    std::vector<uint8_t> iccProfileBytes;
    
    GLRenderContext()
        : width(0),
          height(0),
          lastRenderedWidth(0),
          lastRenderedHeight(0),
          needRedraw(false),
          displayScheduled(false),
          resizeScheduled(false),
          isDestroying(false),
          displayLink(nullptr),
          frameObserver(nil),
          forceBlackFrame(false),
          forceBlackMode(false),
          hdrUserEnabled(true),
          hdrActive(false),
          lastHdrUpdateMs(0),
          lastRenderTimeMs(0),
          videoFps(0.0),
          jsDrivenRenderMode(false) {}
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

static std::map<int64_t, std::shared_ptr<GLRenderContext>> g_renderContexts;
static std::mutex g_renderMutex;

extern "C" void mpv_render_frame_for_instance(int64_t instanceId);
extern "C" void mpv_request_render(int64_t instanceId);
extern "C" void mpv_set_force_black_mode(int64_t instanceId, int enabled);
extern "C" void mpv_set_hdr_mode(int64_t instanceId, int enabled);
static void update_hdr_mode(GLRenderContext *rc, bool forceApply = false);
static void set_render_icc_profile(GLRenderContext *rc);
static void init_default_sdr_config(GLRenderContext *rc);
static uint64_t calculateMinRenderInterval(GLRenderContext *rc);
static bool check_dolby_vision_track(mpv_handle *mpv);

@interface MPVOpenGLLayer : CAOpenGLLayer
@property(nonatomic, assign) GLRenderContext *renderCtx;
@end

@implementation MPVOpenGLLayer
- (BOOL)canDrawInCGLContext:(CGLContextObj)ctx
                pixelFormat:(CGLPixelFormatObj)pf
               forLayerTime:(CFTimeInterval)t
                displayTime:(const CVTimeStamp *)ts {
    (void)ctx;
    (void)pf;
    (void)t;
    (void)ts;
    GLRenderContext *rc = self.renderCtx;
    if (!rc) return NO;
    
    // 一次性加载原子变量，减少重复访问
    bool isDestroying = rc->isDestroying.load();
    if (isDestroying) return NO;
    if (!rc->mpvRenderCtx) return YES;
    
    // JavaScript 驱动模式下，只有当 displayScheduled 为 true 时才允许渲染
    // displayScheduled 由 mpv_request_render 设置，表示 JavaScript 端请求了渲染
    bool jsDrivenMode = rc->jsDrivenRenderMode.load();
    if (jsDrivenMode) {
        bool displayScheduled = rc->displayScheduled.load();
        bool needRedraw = rc->needRedraw.load();
        return displayScheduled && needRedraw;
    }
    
    // 渲染节流：检查是否距离上次渲染时间太短
    uint64_t nowMs = (uint64_t)(CACurrentMediaTime() * 1000.0);
    uint64_t lastRenderMs = rc->lastRenderTimeMs.load();
    uint64_t minIntervalMs = calculateMinRenderInterval(rc);
    
    if (lastRenderMs > 0 && (nowMs - lastRenderMs) < minIntervalMs) {
        return NO; // 跳过本次渲染
    }
    
    return rc->needRedraw.load();
}

- (void)drawInCGLContext:(CGLContextObj)ctx
             pixelFormat:(CGLPixelFormatObj)pf
            forLayerTime:(CFTimeInterval)t
             displayTime:(const CVTimeStamp *)ts {
    (void)pf;
    (void)t;
    (void)ts;

    GLRenderContext *rc = self.renderCtx;
    if (!rc || !ctx) return;
    
    // 一次性加载原子变量
    bool isDestroying = rc->isDestroying.load();
    if (isDestroying) return;

    ScopedCGLock lock(ctx);
    CGLSetCurrentContext(ctx);

    rc->needRedraw.store(false);
    rc->displayScheduled.store(false);

    glClearColor(0.0f, 0.0f, 0.0f, 1.0f);
    glClear(GL_COLOR_BUFFER_BIT);

    if (!rc->mpvRenderCtx) {
        glFlush();
        return;
    }

    // 一次性加载原子变量
    bool forceBlackFrame = rc->forceBlackFrame.load();
    bool forceBlackMode = rc->forceBlackMode.load();
    bool forceBlack = forceBlackFrame || forceBlackMode;
    if (forceBlack) {
        rc->forceBlackFrame.store(false);
        glFlush();
        return;
    }

    // 渲染节流：避免过度渲染阻塞主线程
    uint64_t nowMs = (uint64_t)(CACurrentMediaTime() * 1000.0);
    uint64_t lastRenderMs = rc->lastRenderTimeMs.load();
    uint64_t minIntervalMs = calculateMinRenderInterval(rc);
    
    if (lastRenderMs > 0 && (nowMs - lastRenderMs) < minIntervalMs) {
        // 渲染太频繁，跳过本次渲染，让 RunLoop 处理其他事件（如 Electron UI）
        glFlush();
        return;
    }
    rc->lastRenderTimeMs.store(nowMs);

    // HDR 更新和视频帧率更新：延迟到 RunLoop 的下一个周期，避免阻塞当前渲染
    // 只在首次调用或超过 250ms 时更新
    uint64_t lastHdrMs = rc->lastHdrUpdateMs.load();
    bool isFirstCall = (lastHdrMs == 0);
    if (isFirstCall || nowMs - lastHdrMs > 250) {
        rc->lastHdrUpdateMs.store(nowMs);
        // 延迟 HDR 更新和帧率更新到下一个 RunLoop 周期，让当前渲染先完成
        dispatch_async(dispatch_get_main_queue(), ^{
            // 再次检查，避免在延迟期间 context 被销毁
            std::shared_ptr<GLRenderContext> asyncRc = nullptr;
            {
                std::lock_guard<std::mutex> lock(g_renderMutex);
                auto it = g_renderContexts.find(rc->instanceId);
                if (it != g_renderContexts.end()) asyncRc = it->second;
            }
            if (asyncRc && !asyncRc->isDestroying.load()) {
                // 更新视频帧率
                double estimatedFps = 0.0;
                if (asyncRc->mpvHandle) {
                    int err = mpv_get_property(asyncRc->mpvHandle, "estimated-vf-fps", MPV_FORMAT_DOUBLE, &estimatedFps);
                    if (err >= 0 && estimatedFps > 0.1) {
                        asyncRc->videoFps.store(estimatedFps);
                    } else {
                        // 如果 estimated-vf-fps 不可用，尝试 container-fps
                        double containerFps = 0.0;
                        if (mpv_get_property(asyncRc->mpvHandle, "container-fps", MPV_FORMAT_DOUBLE, &containerFps) >= 0 && containerFps > 0.1) {
                            asyncRc->videoFps.store(containerFps);
                        }
                    }
                }
                // 更新 HDR 模式
                update_hdr_mode(asyncRc.get(), isFirstCall);
            }
        });
    }

    GLint fboBinding = 0;
    glGetIntegerv(GL_DRAW_FRAMEBUFFER_BINDING, &fboBinding);

    GLint viewport[4] = {0, 0, 0, 0};
    glGetIntegerv(GL_VIEWPORT, viewport);
    int w = (int)viewport[2];
    int h = (int)viewport[3];
    if (w <= 0 || h <= 0) {
        glFlush();
        return;
    }

    {
        std::lock_guard<std::mutex> sl(rc->sizeMutex);
        rc->width = w;
        rc->height = h;
    }

    mpv_opengl_fbo fbo;
    memset(&fbo, 0, sizeof(fbo));
    fbo.fbo = fboBinding != 0 ? (int)fboBinding : 0;
    fbo.w = w;
    fbo.h = h;

    int flip_y = 1;

    int block_for_target_time = 0;

    mpv_render_param params[] = {
        { MPV_RENDER_PARAM_OPENGL_FBO, &fbo },
        { MPV_RENDER_PARAM_FLIP_Y, &flip_y },
        { MPV_RENDER_PARAM_BLOCK_FOR_TARGET_TIME, &block_for_target_time },
        { MPV_RENDER_PARAM_INVALID, nullptr }
    };

    bool sizeChanged = (w != rc->lastRenderedWidth || h != rc->lastRenderedHeight);

    CFRunLoopRef runLoop = CFRunLoopGetCurrent();
    if (runLoop) {
        CFRunLoopRunInMode(kCFRunLoopDefaultMode, 0.0, false);
    }
    
    int res = mpv_render_context_render(rc->mpvRenderCtx, params);
    if (res < 0) {
        NSLog(@"[mpv_render_gl] ❌ mpv_render_context_render failed: %d (win %dx%d, FBO %dx%d)",
              res, w, h, fbo.w, fbo.h);
    } else if (sizeChanged) {
        rc->lastRenderedWidth = w;
        rc->lastRenderedHeight = h;
    }

    glFlush();
}

- (CGLPixelFormatObj)copyCGLPixelFormatForDisplayMask:(uint32_t)mask {
    (void)mask;
    GLRenderContext *rc = self.renderCtx;
    if (!rc || !rc->cglPixelFormat) return [super copyCGLPixelFormatForDisplayMask:mask];
    CGLRetainPixelFormat(rc->cglPixelFormat);
    return rc->cglPixelFormat;
}

- (CGLContextObj)copyCGLContextForPixelFormat:(CGLPixelFormatObj)pf {
    (void)pf;
    GLRenderContext *rc = self.renderCtx;
    if (!rc || !rc->cglContext) return [super copyCGLContextForPixelFormat:pf];
    CGLRetainContext(rc->cglContext);
    return rc->cglContext;
}
@end

static void set_layer_colorspace_if_supported(CALayer *layer, CGColorSpaceRef cs) {
    if (!layer || !cs) return;
    if ([layer respondsToSelector:@selector(setColorspace:)]) {
        typedef void (*SetColorSpaceIMP)(id, SEL, CGColorSpaceRef);
        SetColorSpaceIMP imp = (SetColorSpaceIMP)[layer methodForSelector:@selector(setColorspace:)];
        if (imp) {
            imp(layer, @selector(setColorspace:), cs);
        }
    }
}

static CFStringRef get_colorspace_name_by_symbol(const char *symbolName) {
    if (!symbolName) return nullptr;
    void *sym = dlsym(RTLD_DEFAULT, symbolName);
    if (!sym) return nullptr;
    CFStringRef *p = (CFStringRef *)sym;
    return p ? *p : nullptr;
}

static CGColorSpaceRef create_hdr_pq_colorspace_for_primaries(const char *primaries) {
    if (!primaries) return nullptr;

    if (strcmp(primaries, "display-p3") == 0) {
        CFStringRef name = get_colorspace_name_by_symbol("kCGColorSpaceDisplayP3_PQ");
        if (!name) {
            name = get_colorspace_name_by_symbol("kCGColorSpaceDisplayP3_PQ_EOTF");
        }
        if (name) return CGColorSpaceCreateWithName(name);
        return nullptr;
    }

    if (strcmp(primaries, "bt.2020") == 0) {
        CFStringRef name = get_colorspace_name_by_symbol("kCGColorSpaceITUR_2100_PQ");
        if (!name) {
            name = get_colorspace_name_by_symbol("kCGColorSpaceITUR_2020_PQ");
        }
        if (!name) {
            name = get_colorspace_name_by_symbol("kCGColorSpaceITUR_2020_PQ_EOTF");
        }
        if (name) return CGColorSpaceCreateWithName(name);
        return nullptr;
    }

    return nullptr;
}

static CALayer *get_render_layer(GLRenderContext *rc) {
    if (!rc || !rc->view) return nil;
    if (rc->glLayer) return rc->glLayer;
    return rc->view.layer;
}

/**
 * 计算最小渲染间隔（毫秒）
 * 根据视频帧率动态计算，避免过度渲染
 * @param rc 渲染上下文
 * @return 最小渲染间隔（毫秒）
 */
static uint64_t calculateMinRenderInterval(GLRenderContext *rc) {
    if (!rc) return GLRenderContext::DEFAULT_MIN_RENDER_INTERVAL_MS;
    
    double fps = rc->videoFps.load();
    uint64_t minIntervalMs = GLRenderContext::DEFAULT_MIN_RENDER_INTERVAL_MS;
    
    if (fps > 0.1) {
        // 根据视频帧率计算：1000ms / fps，但至少 8ms（120fps），最多 33ms（30fps）
        uint64_t calculatedMs = (uint64_t)(1000.0 / fps);
        minIntervalMs = std::max(8ULL, std::min(calculatedMs, 33ULL));
    }
    
    return minIntervalMs;
}

/**
 * 检查当前选中的视频轨道是否为 Dolby Vision
 * @param mpv MPV 句柄
 * @return 如果当前视频是 Dolby Vision 则返回 true，否则返回 false
 */
static bool check_dolby_vision_track(mpv_handle *mpv) {
    if (!mpv) return false;
    
    mpv_node tracks;
    if (mpv_get_property(mpv, "track-list", MPV_FORMAT_NODE, &tracks) < 0) {
        return false;
    }
    
    bool hasDolbyVision = false;
    if (tracks.format == MPV_FORMAT_NODE_ARRAY) {
        for (int i = 0; i < tracks.u.list->num; i++) {
            mpv_node track = tracks.u.list->values[i];
            if (track.format != MPV_FORMAT_NODE_MAP) continue;
            
            bool is_video = false;
            bool is_selected = false;
            bool has_dv = false;
            
            mpv_node_list *list = track.u.list;
            for (int j = 0; j < list->num; j++) {
                char *key = list->keys[j];
                mpv_node value = list->values[j];
                
                if (strcmp(key, "type") == 0 && value.format == MPV_FORMAT_STRING) {
                    if (strcmp(value.u.string, "video") == 0) is_video = true;
                } else if (strcmp(key, "selected") == 0 && value.format == MPV_FORMAT_FLAG) {
                    is_selected = value.u.flag;
                } else if (strcmp(key, "dolby-vision-profile") == 0 && value.format == MPV_FORMAT_INT64) {
                    if (value.u.int64 > 0) has_dv = true;
                }
            }
            
            if (is_video && is_selected && has_dv) {
                hasDolbyVision = true;
                break;
            }
        }
    }
    
    mpv_free_node_contents(&tracks);
    return hasDolbyVision;
}

static void log_hdr_config(GLRenderContext *rc) {
    if (!rc || !rc->mpvHandle) return;
    
    int iccAuto = -1;
    int screenshotTag = -1;
    int targetPeakInt = 0;
    char *targetPrim = nullptr;
    char *targetTrc = nullptr;
    char *targetPeakStr = nullptr;
    char *toneMapping = nullptr;
    
    mpv_get_property(rc->mpvHandle, "icc-profile-auto", MPV_FORMAT_FLAG, &iccAuto);
    mpv_get_property(rc->mpvHandle, "screenshot-tag-colorspace", MPV_FORMAT_FLAG, &screenshotTag);
    mpv_get_property(rc->mpvHandle, "target-peak", MPV_FORMAT_INT64, &targetPeakInt);
    targetPrim = mpv_get_property_string(rc->mpvHandle, "target-prim");
    targetTrc = mpv_get_property_string(rc->mpvHandle, "target-trc");
    targetPeakStr = mpv_get_property_string(rc->mpvHandle, "target-peak");
    toneMapping = mpv_get_property_string(rc->mpvHandle, "tone-mapping");
    
    const char *primariesCfg = targetPrim ? targetPrim : "(null)";
    const char *trcCfg = targetTrc ? targetTrc : "(null)";
    const char *peakCfg = targetPeakStr ? targetPeakStr : "(null)";
    const char *toneCfg = toneMapping ? toneMapping : "(null)";
    
    CGFloat edr = 1.0;
    NSScreen *screen = nil;
    if (rc->view && rc->view.window) {
        screen = rc->view.window.screen;
    }
    if (screen) {
        if (@available(macOS 10.15, *)) {
            edr = screen.maximumPotentialExtendedDynamicRangeColorComponentValue;
        } else {
            edr = 1.0;
        }
    }
    
    BOOL wantsEDR = NO;
    CGFloat contentsScale = 0.0;
    CALayer *layer = get_render_layer(rc);
    if (layer) {
        if (@available(macOS 14.0, *)) {
            wantsEDR = layer.wantsExtendedDynamicRangeContent;
        }
        contentsScale = layer.contentsScale;
    }
    
    // NSLog(@"[mpv_hdr_cfg] icc-profile-auto=%d target-prim=%s target-trc=%s screenshot-tag-colorspace=%d target-peak-int=%d target-peak-str=%s tone-mapping=%s edr=%.3f wantsEDR=%d contentsScale=%.2f hdrActive=%d",
    //       iccAuto,
    //       primariesCfg,
    //       trcCfg,
    //       screenshotTag,
    //       targetPeakInt,
    //       peakCfg,
    //       toneCfg,
    //       edr,
    //       wantsEDR ? 1 : 0,
    //       contentsScale,
    //       rc->hdrActive ? 1 : 0);
    
    if (targetPrim) mpv_free(targetPrim);
    if (targetTrc) mpv_free(targetTrc);
    if (targetPeakStr) mpv_free(targetPeakStr);
    if (toneMapping) mpv_free(toneMapping);
}

static const char* get_optimal_tone_mapping(mpv_handle *mpv) {
    if (check_dolby_vision_track(mpv)) {
        return "st2094-10";
    }
    return "bt.2390";
}

static void update_hdr_mode(GLRenderContext *rc, bool forceApply) {
    if (!rc || !rc->mpvHandle || !rc->view) return;
    
    bool userEnabled = rc->hdrUserEnabled.load();
    bool shouldEnable = false;
    
    char *primaries = nullptr;
    char *gamma = nullptr;
    double sigPeak = 0.0;
    int sigPeakErr = mpv_get_property(rc->mpvHandle, "video-params/sig-peak", MPV_FORMAT_DOUBLE, &sigPeak);
    
    if (userEnabled) {
        primaries = mpv_get_property_string(rc->mpvHandle, "video-params/primaries");
        gamma = mpv_get_property_string(rc->mpvHandle, "video-params/gamma");
        
        if (primaries && gamma) {
            bool isHdrGamma = strcmp(gamma, "hlg") == 0 || strcmp(gamma, "pq") == 0;
            bool isSdrPrimaries = strcmp(primaries, "bt.709") == 0;
            
            if (isHdrGamma && !isSdrPrimaries) {
                CGFloat edr = 1.0;
                NSScreen *screen = nil;
                if (rc->view.window) {
                    screen = rc->view.window.screen;
                }
                if (screen) {
                    if (@available(macOS 10.15, *)) {
                        edr = screen.maximumPotentialExtendedDynamicRangeColorComponentValue;
                    } else {
                        edr = 1.0;
                    }
                }
                if (edr > 1.0) {
                    shouldEnable = true;
                }
            }
        }
    }
    
    
    // 如果状态匹配且不是首次调用，直接返回，避免重复设置属性
    // 首次调用时（forceApply=true）必须强制应用，确保 SDR 视频也能正确配置
    if (shouldEnable == rc->hdrActive && !forceApply) {
        // 状态已匹配，无需重新设置属性
        if (primaries) mpv_free(primaries);
        if (gamma) mpv_free(gamma);
        return;
    }
    
    if (shouldEnable) {
        // macOS 系统级 HDR (EDR) 设置流程：
        // 优化：先配置 mpv 属性，再更新 layer 属性，减少闪烁
        // 这样可以确保渲染时使用正确的配置，避免显示中间状态
        
        // 1. 先配置 mpv HDR 选项（在 layer 属性改变之前）
        // 注意：icc-profile-auto 必须禁用，因为 HDR 使用 PQ 传输函数，不应通过 ICC 进行色彩转换
        // macOS EDR 系统会直接处理 HDR 信号，ICC 会干扰这个过程
        int iccAuto = 0;
        mpv_set_property(rc->mpvHandle, "icc-profile-auto", MPV_FORMAT_FLAG, &iccAuto);
        
        // 设置目标色彩空间
        if (primaries) {
            mpv_set_property_string(rc->mpvHandle, "target-prim", primaries);
        } else {
            mpv_set_property_string(rc->mpvHandle, "target-prim", "auto");
        }
        mpv_set_property_string(rc->mpvHandle, "target-trc", "pq");
        mpv_set_property_string(rc->mpvHandle, "target-colorspace-hint", "yes");
        
        // 禁用动态峰值检测（hdr-compute-peak），让系统使用静态峰值
        // 这可以避免动态检测导致的过曝问题
        int hdrComputePeak = 0;
        mpv_set_property(rc->mpvHandle, "hdr-compute-peak", MPV_FORMAT_FLAG, &hdrComputePeak);
        
        // 手动设置 target-peak 以避免过曝
        // macOS 的 auto 模式可能使用了过高的峰值亮度值（如 10000 nits 的标称值）
        // 我们需要基于实际的显示器能力设置更保守的值
        CGFloat edr = 1.0;
        NSScreen *screen = nil;
        if (rc->view.window) {
            screen = rc->view.window.screen;
        }
        if (screen && @available(macOS 10.15, *)) {
            edr = screen.maximumPotentialExtendedDynamicRangeColorComponentValue;
        }
        
        // 检测是否是 Dolby Vision 视频
        // Dolby Vision 需要特殊处理，因为它有动态色调映射，target-peak 过高会导致过曝
        bool isDolbyVision = check_dolby_vision_track(rc->mpvHandle);
        
        // 根据 EDR 值和视频实际参数计算 target-peak
        // 不根据容器格式区分，因为格式本身不影响 HDR 渲染
        // 真正影响亮度的是：视频的 sig-peak、Dolby Vision 特性、显示器能力
        int64_t targetPeakNits = 0;
        if (edr > 1.0) {
            // 根据 EDR 值映射到显示器的实际峰值亮度（nits）
            // EDR 值表示相对于 sRGB (100 nits) 的倍数，但实际 HDR 显示器的峰值通常更高
            // 使用更准确的映射，让普通 HDR 视频能够充分利用显示器的峰值亮度
            int64_t displayPeakNits = 0;
            if (edr <= 1.5) {
                displayPeakNits = 400; // HDR400 级别
            } else if (edr <= 2.0) {
                displayPeakNits = 600; // HDR600 级别
            } else if (edr <= 2.5) {
                displayPeakNits = 800; // HDR800 级别
            } else if (edr <= 3.0) {
                displayPeakNits = 1000; // HDR1000 级别
            } else if (edr <= 4.0) {
                displayPeakNits = 1400; // 高端 HDR 显示器
            } else {
                displayPeakNits = 2000; // 顶级 HDR 显示器（如 OLED）
            }
            
            // 对于普通 HDR 视频，使用显示器的实际峰值亮度
            // 这样可以充分利用显示器的能力，获得更好的对比度和亮度表现
            if (isDolbyVision) {
                // Dolby Vision 需要更保守的设置，因为它本身已经有动态色调映射
                // 使用显示器峰值的 55%，稍微提高亮度（从 50% 提升）
                // Dolby Vision 的动态色调映射已经处理了亮度映射，target-peak 过高会导致过曝
                targetPeakNits = (int64_t)(displayPeakNits * 0.55);
                // 确保最小值，但不要太高
                if (targetPeakNits < 350) {
                    targetPeakNits = 350;
                }
                // 设置最大值上限，稍微提高（从 600 提升到 650）
                if (targetPeakNits > 650) {
                    targetPeakNits = 650;
                }
                
                // 对于 Dolby Vision，如果视频的 sig-peak 可用且较低，进一步限制 target-peak
                // 这样可以避免低峰值 Dolby Vision 视频过亮
                if (sigPeakErr >= 0 && sigPeak > 0.1) {
                    if (sigPeak < 2000.0) {
                        // sig-peak 较低，使用更保守的值
                        // 对于 Dolby Vision，使用 sig-peak 的 85% 作为上限（从 80% 提升）
                        int64_t maxFromSigPeak = (int64_t)(sigPeak * 0.85);
                        if (maxFromSigPeak < targetPeakNits) {
                            targetPeakNits = maxFromSigPeak;
                        }
                        // 确保最小值，避免过低导致画面过暗
                        if (targetPeakNits < 400) {
                            targetPeakNits = 400;
                        }
                    }
                }
            } else {
                // 普通 HDR：使用显示器的实际峰值亮度
                targetPeakNits = displayPeakNits;
            }
        } else {
            // 没有 EDR 支持，使用 SDR 标准值
            targetPeakNits = 203;
        }
        
        mpv_set_property(rc->mpvHandle, "target-peak", MPV_FORMAT_INT64, &targetPeakNits);
        
        // 显式设置色调映射算法
        // gpu-next 默认使用 spline，但这可能导致过曝
        // 使用 bt.2390（ITU-R 标准）更保守，适合大多数 HDR 内容
        const char *algo = get_optimal_tone_mapping(rc->mpvHandle);
        if (strcmp(algo, "st2094-10") == 0) {
            // Dolby Vision 需要使用特定的色调映射算法
            mpv_set_property_string(rc->mpvHandle, "tone-mapping", "st2094-10");
        } else {
            // 对于普通 HDR，使用 bt.2390 避免默认 spline 导致的过曝
            mpv_set_property_string(rc->mpvHandle, "tone-mapping", "bt.2390");
        }
        
        rc->hdrActive = true;
        
        // 2. 使用 CATransaction 批量更新 layer 属性，减少重绘次数
        // 这样可以避免在属性更新过程中触发多次重绘，减少闪烁
        CALayer *layer = get_render_layer(rc);
        if (layer) {
            [CATransaction begin];
            [CATransaction setDisableActions:YES]; // 禁用动画，立即应用
            [CATransaction setAnimationDuration:0]; // 设置动画时长为 0
            
            // 确保 view 启用 layer-backed rendering
            if (![rc->view wantsLayer]) {
                [rc->view setWantsLayer:YES];
            }
            
            // 启用 layer 的 EDR 支持 (macOS 14.0+)
            if (@available(macOS 14.0, *)) {
                // 只在状态真的改变时才更新，避免不必要的重绘
                if (layer.wantsExtendedDynamicRangeContent != YES) {
                    layer.wantsExtendedDynamicRangeContent = YES;
                }
            }
            
            // 设置正确的 HDR 色彩空间（PQ）
            CGColorSpaceRef cs = create_hdr_pq_colorspace_for_primaries(primaries);
            if (cs) {
                set_layer_colorspace_if_supported(layer, cs);
                CGColorSpaceRelease(cs);
            }
            
            // 确保 layer 的 contentsScale 匹配窗口的 backingScaleFactor
            // 这对于正确的 HDR 渲染很重要
            if (rc->view.window) {
                CGFloat scale = rc->view.window.backingScaleFactor;
                if (scale > 0.0 && layer.contentsScale != scale) {
                    layer.contentsScale = scale;
                }
            }
            
            [CATransaction commit];
        }
    } else {
        // 优化：先配置 mpv 属性，再更新 layer 属性，减少闪烁
        // 恢复 SDR 模式配置（在 layer 属性改变之前）
        // 启用 ICC 配置文件以进行正确的显示器色彩管理
        set_render_icc_profile(rc);
        int iccAuto = 1;
        mpv_set_property(rc->mpvHandle, "icc-profile-auto", MPV_FORMAT_FLAG, &iccAuto);
        
        // 明确设置 SDR 色彩空间，避免 auto 模式导致的偏灰问题
        // 对于 SDR，明确指定 transfer function 很重要
        NSScreen *screen = nil;
        if (rc->view.window) {
            screen = rc->view.window.screen;
        }
        
        // 检测显示器的 primaries（通常是 bt.709 或 display-p3）
        const char *targetPrim = "bt.709";  // 默认使用 bt.709
        if (screen && screen.colorSpace) {
            NSString *csName = screen.colorSpace.localizedName;
            // macOS 的 Display P3 显示器应该使用 display-p3
            if ([csName containsString:@"P3"] || [csName containsString:@"Display P3"]) {
                targetPrim = "display-p3";
            }
        }
        
        // 明确设置 SDR 的 transfer function 为 sRGB
        // 这确保正确的 gamma 曲线，避免画面偏灰
        mpv_set_property_string(rc->mpvHandle, "target-prim", targetPrim);
        mpv_set_property_string(rc->mpvHandle, "target-trc", "srgb");
        mpv_set_property_string(rc->mpvHandle, "target-peak", "auto");
        mpv_set_property_string(rc->mpvHandle, "target-colorspace-hint", "yes");
        mpv_set_property_string(rc->mpvHandle, "hdr-compute-peak", "auto");
        
        rc->hdrActive = false;
        
        // 使用 CATransaction 批量更新 layer 属性，减少重绘次数
        CALayer *layer = get_render_layer(rc);
        if (layer) {
            [CATransaction begin];
            [CATransaction setDisableActions:YES]; // 禁用动画，立即应用
            [CATransaction setAnimationDuration:0]; // 设置动画时长为 0
            
            if (@available(macOS 14.0, *)) {
                // 只在状态真的改变时才更新，避免不必要的重绘
                if (layer.wantsExtendedDynamicRangeContent != NO) {
                    layer.wantsExtendedDynamicRangeContent = NO;
                }
            }

            CGColorSpaceRef cs = nullptr;
            NSScreen *screen = nil;
            if (rc->view.window) {
                screen = rc->view.window.screen;
            }
            if (screen && screen.colorSpace) {
                cs = screen.colorSpace.CGColorSpace;
            } else {
                cs = CGColorSpaceCreateWithName(kCGColorSpaceSRGB);
            }
            if (cs) {
                set_layer_colorspace_if_supported(layer, cs);
                if (!(screen && screen.colorSpace && cs == screen.colorSpace.CGColorSpace)) {
                    CGColorSpaceRelease(cs);
                }
            }
            
            [CATransaction commit];
        }
    }
    
    if (primaries) mpv_free(primaries);
    if (gamma) mpv_free(gamma);
    
    log_hdr_config(rc);
}

/**
 * 初始化默认 SDR 色彩空间配置
 * 在创建渲染上下文时调用，确保首次打开 SDR 视频时就有正确的色彩空间设置
 */
static void init_default_sdr_config(GLRenderContext *rc) {
    if (!rc || !rc->mpvHandle || !rc->view) return;
    
    // 设置 layer 的色彩空间
    CALayer *layer = get_render_layer(rc);
    if (layer) {
        if (@available(macOS 14.0, *)) {
            layer.wantsExtendedDynamicRangeContent = NO;
        }
        
        CGColorSpaceRef cs = nullptr;
        NSScreen *screen = nil;
        if (rc->view.window) {
            screen = rc->view.window.screen;
        }
        if (screen && screen.colorSpace) {
            cs = screen.colorSpace.CGColorSpace;
        } else {
            cs = CGColorSpaceCreateWithName(kCGColorSpaceSRGB);
        }
        if (cs) {
            set_layer_colorspace_if_supported(layer, cs);
            if (!(screen && screen.colorSpace && cs == screen.colorSpace.CGColorSpace)) {
                CGColorSpaceRelease(cs);
            }
        }
    }
    
    // 设置默认 SDR MPV 配置
    int iccAuto = 1;
    mpv_set_property(rc->mpvHandle, "icc-profile-auto", MPV_FORMAT_FLAG, &iccAuto);
    
    NSScreen *screen = nil;
    if (rc->view.window) {
        screen = rc->view.window.screen;
    }
    
    // 检测显示器的 primaries（通常是 bt.709 或 display-p3）
    const char *targetPrim = "bt.709";
    if (screen && screen.colorSpace) {
        NSString *csName = screen.colorSpace.localizedName;
        if ([csName containsString:@"P3"] || [csName containsString:@"Display P3"]) {
            targetPrim = "display-p3";
        }
    }
    
    // 明确设置 SDR 的 transfer function 为 sRGB
    // 这确保正确的 gamma 曲线，避免画面偏灰
    mpv_set_property_string(rc->mpvHandle, "target-prim", targetPrim);
    mpv_set_property_string(rc->mpvHandle, "target-trc", "srgb");
    mpv_set_property_string(rc->mpvHandle, "target-peak", "auto");
    mpv_set_property_string(rc->mpvHandle, "target-colorspace-hint", "yes");
    mpv_set_property_string(rc->mpvHandle, "hdr-compute-peak", "auto");
}

static void set_render_icc_profile(GLRenderContext *rc) {
    if (!rc || !rc->mpvRenderCtx || !rc->view) return;
    NSScreen *screen = nil;
    if (rc->view.window) {
        screen = rc->view.window.screen;
    }
    if (!screen) {
        screen = [NSScreen mainScreen];
    }
    NSColorSpace *cs = nil;
    if (screen && screen.colorSpace) {
        cs = screen.colorSpace;
    } else {
        cs = [NSColorSpace sRGBColorSpace];
    }
    NSData *icc = cs.ICCProfileData;
    if (!icc || icc.length <= 0) return;

    {
        std::lock_guard<std::mutex> lock(rc->iccMutex);
        rc->iccProfileBytes.assign((const uint8_t *)icc.bytes, (const uint8_t *)icc.bytes + icc.length);
    }

    mpv_byte_array arr;
    memset(&arr, 0, sizeof(arr));
    {
        std::lock_guard<std::mutex> lock(rc->iccMutex);
        if (rc->iccProfileBytes.empty()) return;
        arr.data = rc->iccProfileBytes.data();
        arr.size = rc->iccProfileBytes.size();
    }
    mpv_render_param param = { MPV_RENDER_PARAM_ICC_PROFILE, &arr };
    mpv_render_context_set_parameter(rc->mpvRenderCtx, param);
}

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

// 使用用户交互优先级调度渲染请求，确保与 Electron UI 同步
// 这样可以让 Electron 的 UI 事件优先处理，视频渲染不会阻塞用户交互
static void runOnMainAsyncForRender(dispatch_block_t block) {
    if (!block) return;
    if (isMainThread()) {
        // 使用 dispatch_async 而不是直接执行，让当前 RunLoop 先处理其他事件
        // 这样可以确保 Electron UI 事件优先处理
        dispatch_async(dispatch_get_main_queue(), block);
    } else {
        dispatch_async(dispatch_get_main_queue(), block);
    }
}

// ------------------ mpv update callback ------------------
// Called by mpv on arbitrary thread. We must not do GL here.
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
    
    // JavaScript 驱动模式下，只标记需要重绘，不自动触发渲染
    // 渲染由 JavaScript 端的渲染循环控制
    rc->needRedraw.store(true);
    
    // 在 JavaScript 驱动模式下，不自动调用 mpv_request_render
    // 让 JavaScript 端的渲染循环来控制何时渲染
    if (!rc->jsDrivenRenderMode.load()) {
        // CVDisplayLink 驱动模式下，可以自动触发渲染
        // 但这里不触发，让 DisplayLink 回调来处理
    }
}

// ------------------ CVDisplayLink Callback ------------------
// CVDisplayLink 在显示刷新时调用（通常 60Hz 或 120Hz）
// 这个回调必须非常轻量，不能阻塞主线程，否则会影响 Electron UI 响应性
// 与 Electron 渲染同步的关键：
// 1. 只做必要的操作（report_swap 和标记需要渲染）
// 2. 不在这里执行实际的渲染（渲染在 drawInCGLContext 中异步执行）
// 3. 使用异步调度，让 Electron UI 事件优先处理
static CVReturn DisplayLinkCallback(CVDisplayLinkRef displayLink,
                                    const CVTimeStamp *now,
                                    const CVTimeStamp *outputTime,
                                    CVOptionFlags flagsIn,
                                    CVOptionFlags *flagsOut,
                                    void *displayLinkContext) {
    GLRenderContext *rc = (GLRenderContext *)displayLinkContext;
    if (!rc) return kCVReturnSuccess;
    
    // 一次性加载原子变量
    bool isDestroying = rc->isDestroying.load();
    if (isDestroying) return kCVReturnSuccess;

    @autoreleasepool {
        // 报告交换完成（必须，用于音视频同步）
        // 即使在 JavaScript 驱动模式下，也需要调用 report_swap 来保持音视频同步
        if (rc->mpvRenderCtx) {
            mpv_render_context_report_swap(rc->mpvRenderCtx);
        }
        
        // JavaScript 驱动模式下，不在这里触发渲染，由 JavaScript 端控制
        bool jsDrivenMode = rc->jsDrivenRenderMode.load();
        if (jsDrivenMode) {
            return kCVReturnSuccess;
        }
        
        // CVDisplayLink 驱动模式：检查是否需要渲染
        // 渲染节流：检查是否距离上次渲染时间太短
        uint64_t nowMs = (uint64_t)(CACurrentMediaTime() * 1000.0);
        uint64_t lastRenderMs = rc->lastRenderTimeMs.load();
        uint64_t minIntervalMs = calculateMinRenderInterval(rc);
        
        bool needRedraw = rc->needRedraw.load();
        bool shouldRender = needRedraw && 
                           (lastRenderMs == 0 || (nowMs - lastRenderMs) >= minIntervalMs);
        if (shouldRender) {
            mpv_request_render(rc->instanceId);
        }
    }
    return kCVReturnSuccess;
}

// ------------------ create GL (must be on main thread) ------------------
static bool createGLForView(GLRenderContext *rc) {
    if (!rc || !rc->view) return false;

    if (![rc->view wantsLayer]) {
        [rc->view setWantsLayer:YES];
    }
    if ([rc->view respondsToSelector:@selector(setLayerContentsRedrawPolicy:)]) {
        rc->view.layerContentsRedrawPolicy = NSViewLayerContentsRedrawDuringViewResize;
    }

    CGLPixelFormatObj pix = nil;
    GLint npix = 0;
    CGLPixelFormatAttribute attrsFloat[] = {
        kCGLPFAOpenGLProfile, (CGLPixelFormatAttribute)kCGLOGLPVersion_3_2_Core,
        kCGLPFAColorSize, (CGLPixelFormatAttribute)64,
        kCGLPFAColorFloat,
        kCGLPFADepthSize, (CGLPixelFormatAttribute)16,
        kCGLPFAAccelerated,
        kCGLPFADoubleBuffer,
        (CGLPixelFormatAttribute)0
    };
    CGLError err = CGLChoosePixelFormat(attrsFloat, &pix, &npix);
    if (err != kCGLNoError || !pix) {
        CGLPixelFormatAttribute attrsFallback[] = {
            kCGLPFAOpenGLProfile, (CGLPixelFormatAttribute)kCGLOGLPVersion_3_2_Core,
            kCGLPFAColorSize, (CGLPixelFormatAttribute)32,
            kCGLPFADepthSize, (CGLPixelFormatAttribute)16,
            kCGLPFAAccelerated,
            kCGLPFADoubleBuffer,
            (CGLPixelFormatAttribute)0
        };
        err = CGLChoosePixelFormat(attrsFallback, &pix, &npix);
        if (err != kCGLNoError || !pix) return false;
    }

    CGLContextObj cglCtx = nil;
    err = CGLCreateContext(pix, nil, &cglCtx);
    if (err != kCGLNoError || !cglCtx) {
        CGLReleasePixelFormat(pix);
        return false;
    }

    GLint swapInt = 1;
    CGLSetParameter(cglCtx, kCGLCPSwapInterval, &swapInt);
    CGLEnable(cglCtx, kCGLCEMPEngine);
    CGLSetCurrentContext(cglCtx);

    rc->cglContext = cglCtx;
    rc->cglPixelFormat = pix;

    MPVOpenGLLayer *layer = [[MPVOpenGLLayer alloc] init];
    layer.renderCtx = rc;
    // 关键：启用异步渲染，确保与 Electron UI 同步
    // asynchronous=YES 让 Core Animation 在后台线程准备渲染内容
    // 这样主线程可以优先处理 Electron UI 事件（如点击、滚动等）
    layer.asynchronous = YES;
    layer.needsDisplayOnBoundsChange = YES;
    layer.autoresizingMask = kCALayerWidthSizable | kCALayerHeightSizable;

    CGFloat scale = 1.0;
    if (rc->view.window) {
        scale = rc->view.window.backingScaleFactor;
    } else {
        NSScreen *screen = [NSScreen mainScreen];
        if (screen) scale = screen.backingScaleFactor;
    }
    if (scale <= 0.0) scale = 1.0;
    layer.contentsScale = scale;

    [rc->view setLayer:layer];
    layer.frame = rc->view.bounds;

    rc->glLayer = layer;
    
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
    
    // init mpv render context (GL) using this OpenGL context
    mpv_opengl_init_params gl_init_params = {};
    gl_init_params.get_proc_address = get_proc_address;
    gl_init_params.get_proc_address_ctx = nullptr;

    mpv_render_param params[] = {
        { MPV_RENDER_PARAM_API_TYPE, (void*)MPV_RENDER_API_TYPE_OPENGL },
        { MPV_RENDER_PARAM_OPENGL_INIT_PARAMS, &gl_init_params },
        { MPV_RENDER_PARAM_INVALID, nullptr }
    };

    int createErr = mpv_render_context_create(&rc->mpvRenderCtx, rc->mpvHandle, params);
    if (createErr < 0) {
        NSLog(@"[mpv_render_gl] ❌ mpv_render_context_create failed: %d", createErr);
        if (rc->glLayer) {
            MPVOpenGLLayer *layer = (MPVOpenGLLayer *)rc->glLayer;
            layer.renderCtx = nullptr;
            [layer release];
            rc->glLayer = nil;
        }
        if (rc->cglContext) {
            CGLSetCurrentContext(nil);
            CGLReleaseContext(rc->cglContext);
            rc->cglContext = nil;
        }
        if (rc->cglPixelFormat) {
            CGLReleasePixelFormat(rc->cglPixelFormat);
            rc->cglPixelFormat = nil;
        }
        return false;
    }

    mpv_render_context_set_update_callback(rc->mpvRenderCtx, on_mpv_redraw, (void*)(intptr_t)rc->instanceId);
    set_render_icc_profile(rc);
    
    // 初始化默认 SDR 色彩空间配置
    // 这样即使首次打开的是 SDR 视频，也能有正确的色彩空间设置
    init_default_sdr_config(rc);

    // Setup CVDisplayLink (for mpv_render_context_report_swap timing)
    CVReturn cvRet = CVDisplayLinkCreateWithActiveCGDisplays(&rc->displayLink);
    if (cvRet == kCVReturnSuccess) {
        CVDisplayLinkSetOutputCallback(rc->displayLink, DisplayLinkCallback, rc);

        CVDisplayLinkSetCurrentCGDisplayFromOpenGLContext(rc->displayLink, rc->cglContext, rc->cglPixelFormat);
        
        CVDisplayLinkStart(rc->displayLink);
        NSLog(@"[mpv_render_gl] CVDisplayLink started");
    } else {
        NSLog(@"[mpv_render_gl] Failed to create CVDisplayLink: %d", cvRet);
    }

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
    
    // release GL resources (必须在主线程，并且必须在正确的 OpenGL 上下文中)
    // 关键：mpv_render_context_free 会调用 OpenGL 函数，必须在正确的上下文中执行
    auto cleanupBlock = ^{
        @autoreleasepool {
            // 设置 OpenGL 上下文（如果存在）
            CGLContextObj savedContext = nil;
            if (rc->cglContext) {
                CGLLockContext(rc->cglContext);
                savedContext = CGLGetCurrentContext();
                CGLSetCurrentContext(rc->cglContext);
            }
            
            // Free mpv render context（必须在正确的 OpenGL 上下文中）
            if (rc->mpvRenderCtx) {
                mpv_render_context_set_update_callback(rc->mpvRenderCtx, nullptr, nullptr);
                mpv_render_context_free(rc->mpvRenderCtx);
                rc->mpvRenderCtx = nullptr;
            }
            
            // 恢复之前的上下文
            if (rc->cglContext) {
                CGLSetCurrentContext(savedContext);
                CGLUnlockContext(rc->cglContext);
            }
            
            // 先断开 layer 与 view 的关联，再释放 layer
            if (rc->glLayer && rc->view) {
                MPVOpenGLLayer *layer = (MPVOpenGLLayer *)rc->glLayer;
                layer.renderCtx = nullptr;
                if (rc->view.layer == layer) {
                    rc->view.layer = nil;
                }
                [layer release];
                rc->glLayer = nil;
            } else if (rc->glLayer) {
                MPVOpenGLLayer *layer = (MPVOpenGLLayer *)rc->glLayer;
                layer.renderCtx = nullptr;
                [layer release];
                rc->glLayer = nil;
            }
            
            if (rc->cglContext) {
                CGLSetCurrentContext(nil);
                CGLReleaseContext(rc->cglContext);
                rc->cglContext = nil;
            }
            if (rc->cglPixelFormat) {
                CGLReleasePixelFormat(rc->cglPixelFormat);
                rc->cglPixelFormat = nil;
            }
            
            if (rc->view) {
                [rc->view release];
                rc->view = nil;
            }
        }
    };
    
    if (isMainThread()) {
        cleanupBlock();
    } else {
        dispatch_sync(dispatch_get_main_queue(), cleanupBlock);
    }
    
    rc->mpvHandle = nullptr;
}

// ------------------ public: create context ------------------
extern "C" GLRenderContext *mpv_create_gl_context_for_view(int64_t instanceId, void *nsViewPtr, mpv_handle *mpv) {
    if (!nsViewPtr || !mpv) return nullptr;
    
    auto rc = std::make_shared<GLRenderContext>();
    NSView *view = reinterpret_cast<NSView*>(nsViewPtr);
    rc->view = view;
    rc->instanceId = instanceId;
    if (rc->view) {
        [rc->view retain]; // Retain view to prevent dangling pointer
        
        if (![rc->view wantsLayer]) {
            [rc->view setWantsLayer:YES];
        }
    }
    rc->mpvHandle = mpv;
    
    // create GL layer + context and read initial size - must be on main thread
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
            destroyGL(rc);
            return nullptr;
        }
    } else {
        if (!createGLForView(rc.get())) {
            destroyGL(rc);
            return nullptr;
        }
    }
    
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

    bool wasScheduled = rc->resizeScheduled.exchange(true);
    if (wasScheduled) return;

    runOnMainAsync(^{
        rc->resizeScheduled.store(false);
        if (rc->isDestroying) return;
        if (!rc->view) return;
        
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
            if (rc->glLayer) {
                rc->glLayer.frame = rc->view.bounds;
                CGFloat scale = 1.0;
                if (rc->view.window) {
                    scale = rc->view.window.backingScaleFactor;
                } else {
                    NSScreen *screen = [NSScreen mainScreen];
                    if (screen) scale = screen.backingScaleFactor;
                }
                if (scale <= 0.0) scale = 1.0;
                rc->glLayer.contentsScale = scale;
                [rc->glLayer setNeedsDisplay];
            }
        }
    });
}

extern "C" void mpv_request_render(int64_t instanceId) {
    std::shared_ptr<GLRenderContext> rc = nullptr;
    {
        std::lock_guard<std::mutex> lock(g_renderMutex);
        auto it = g_renderContexts.find(instanceId);
        if (it == g_renderContexts.end()) return;
        rc = it->second;
    }
    
    if (!rc) return;
    
    // 一次性加载原子变量
    bool isDestroying = rc->isDestroying.load();
    if (isDestroying) return;
    
    rc->needRedraw.store(true);
    bool wasScheduled = rc->displayScheduled.exchange(true);
    if (wasScheduled) return;
    
    // 使用专门的渲染调度函数，确保与 Electron UI 同步
    // 这样可以让 Electron 的 UI 事件（如点击）优先处理
    runOnMainAsyncForRender(^{
        std::shared_ptr<GLRenderContext> inner = nullptr;
        {
            std::lock_guard<std::mutex> lock(g_renderMutex);
            auto it = g_renderContexts.find(instanceId);
            if (it != g_renderContexts.end()) inner = it->second;
        }
        if (!inner) return;
        
        // 一次性加载原子变量
        bool innerDestroying = inner->isDestroying.load();
        if (innerDestroying) return;
        if (inner->glLayer) {
            [inner->glLayer setNeedsDisplay];
        }
    });
}

// ------------------ render entry (exposed) ------------------
// Called from render thread (background thread, not main thread)
extern "C" void mpv_render_frame_for_instance(int64_t instanceId) {
    mpv_request_render(instanceId);
}

// ------------------ JavaScript 驱动渲染模式控制 ------------------
// 设置是否使用 JavaScript 驱动渲染模式
// enabled: 1 = JavaScript 驱动模式（渲染由 JS 端控制），0 = CVDisplayLink 驱动模式（默认）
extern "C" void mpv_set_js_driven_render_mode(int64_t instanceId, int enabled) {
    std::shared_ptr<GLRenderContext> rc = nullptr;
    {
        std::lock_guard<std::mutex> lock(g_renderMutex);
        auto it = g_renderContexts.find(instanceId);
        if (it == g_renderContexts.end()) return;
        rc = it->second;
    }
    
    if (!rc || rc->isDestroying.load()) return;
    
    bool jsMode = (enabled != 0);
    bool wasJsMode = rc->jsDrivenRenderMode.exchange(jsMode);
    
    if (jsMode != wasJsMode) {
        NSLog(@"[mpv_render_gl] JavaScript 驱动渲染模式: %s", jsMode ? "启用" : "禁用");
        
        // 如果切换到 JavaScript 驱动模式，立即触发一次渲染
        // 这样 JavaScript 端可以立即开始控制渲染循环
        if (jsMode) {
            rc->needRedraw.store(true);
            mpv_request_render(instanceId);
        }
    }
}

// 获取当前是否使用 JavaScript 驱动渲染模式
extern "C" int mpv_get_js_driven_render_mode(int64_t instanceId) {
    std::shared_ptr<GLRenderContext> rc = nullptr;
    {
        std::lock_guard<std::mutex> lock(g_renderMutex);
        auto it = g_renderContexts.find(instanceId);
        if (it == g_renderContexts.end()) return 0;
        rc = it->second;
    }
    
    if (!rc || rc->isDestroying.load()) return 0;
    
    return rc->jsDrivenRenderMode.load() ? 1 : 0;
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
    mpv_request_render(instanceId);
}

extern "C" void mpv_set_hdr_mode(int64_t instanceId, int enabled) {
    std::shared_ptr<GLRenderContext> rc = nullptr;
    {
        std::lock_guard<std::mutex> lock(g_renderMutex);
        auto it = g_renderContexts.find(instanceId);
        if (it == g_renderContexts.end()) return;
        rc = it->second;
    }
    
    if (!rc || rc->isDestroying.load()) return;
    
    rc->hdrUserEnabled.store(enabled != 0);
    rc->lastHdrUpdateMs.store(0);
    // NSLog(@"[mpv_hdr] mpv_set_hdr_mode: instanceId=%lld enabled=%d", (long long)instanceId, enabled ? 1 : 0);
    
    // 立即应用 HDR 配置（在主线程上执行）
    // 这样可以确保在暂停状态下切换 HDR 时，配置能立即生效
    // 而不是等待渲染时异步更新，导致渲染效果不正确
    // 注意：update_hdr_mode 需要访问 NSView，必须在主线程执行
    if (isMainThread()) {
        // 在主线程上直接同步执行，确保立即生效
        update_hdr_mode(rc.get(), true); // forceApply=true 确保立即应用
        // 触发渲染以显示 HDR 效果
        mpv_request_render(instanceId);
    } else {
        // 不在主线程，同步切换到主线程执行
        // 使用 dispatch_sync 确保 HDR 配置立即应用，避免异步延迟导致渲染效果不正确
        dispatch_sync(dispatch_get_main_queue(), ^{
            std::shared_ptr<GLRenderContext> inner = nullptr;
            {
                std::lock_guard<std::mutex> lock(g_renderMutex);
                auto it = g_renderContexts.find(instanceId);
                if (it != g_renderContexts.end()) inner = it->second;
            }
            if (inner && !inner->isDestroying.load()) {
                update_hdr_mode(inner.get(), true); // forceApply=true 确保立即应用
                // 触发渲染以显示 HDR 效果
                mpv_request_render(instanceId);
            }
        });
    }
}

// ------------------ HDR 调试函数 ------------------
extern "C" void mpv_debug_hdr_status(int64_t instanceId) {
    std::shared_ptr<GLRenderContext> rc = nullptr;
    {
        std::lock_guard<std::mutex> lock(g_renderMutex);
        auto it = g_renderContexts.find(instanceId);
        if (it == g_renderContexts.end()) return;
        rc = it->second;
    }
    
    if (!rc || !rc->mpvHandle) return;
    
    // 获取当前视频参数
    char *primaries = mpv_get_property_string(rc->mpvHandle, "video-params/primaries");
    char *gamma = mpv_get_property_string(rc->mpvHandle, "video-params/gamma");
    double sigPeak = 0.0;
    mpv_get_property(rc->mpvHandle, "video-params/sig-peak", MPV_FORMAT_DOUBLE, &sigPeak);
    
    // 获取当前 mpv 配置
    char *targetPrim = mpv_get_property_string(rc->mpvHandle, "target-prim");
    char *targetTrc = mpv_get_property_string(rc->mpvHandle, "target-trc");
    char *targetPeak = mpv_get_property_string(rc->mpvHandle, "target-peak");
    char *toneMapping = mpv_get_property_string(rc->mpvHandle, "tone-mapping");
    
    // 获取显示器信息
    CGFloat edr = 1.0;
    if (rc->view.window && rc->view.window.screen) {
        if (@available(macOS 10.15, *)) {
            edr = rc->view.window.screen.maximumPotentialExtendedDynamicRangeColorComponentValue;
        }
    }
    
    NSLog(@"[mpv_hdr_debug] ======= HDR 状态调试信息 =======");
    NSLog(@"[mpv_hdr_debug] 视频参数: primaries=%s, gamma=%s, sig-peak=%.2f", 
          primaries ? primaries : "(null)", 
          gamma ? gamma : "(null)", 
          sigPeak);
    NSLog(@"[mpv_hdr_debug] MPV 配置: target-prim=%s, target-trc=%s, target-peak=%s, tone-mapping=%s",
          targetPrim ? targetPrim : "(null)",
          targetTrc ? targetTrc : "(null)", 
          targetPeak ? targetPeak : "(null)",
          toneMapping ? toneMapping : "(null)");
    NSLog(@"[mpv_hdr_debug] 显示器 EDR 能力: %.2f", edr);
    NSLog(@"[mpv_hdr_debug] 用户设置: enabled=%d, active=%d", 
          rc->hdrUserEnabled.load() ? 1 : 0, 
          rc->hdrActive ? 1 : 0);
    NSLog(@"[mpv_hdr_debug] ================================");
    
    // 清理内存
    if (primaries) mpv_free(primaries);
    if (gamma) mpv_free(gamma);
    if (targetPrim) mpv_free(targetPrim);
    if (targetTrc) mpv_free(targetTrc);
    if (targetPeak) mpv_free(targetPeak);
    if (toneMapping) mpv_free(toneMapping);
}
