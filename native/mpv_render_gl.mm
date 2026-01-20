#import <Cocoa/Cocoa.h>
#import <QuartzCore/QuartzCore.h>
#import <objc/message.h>
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
          lastHdrUpdateMs(0) {}
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
static void update_hdr_mode(GLRenderContext *rc);
static void set_render_icc_profile(GLRenderContext *rc);

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
    if (!rc || rc->isDestroying.load()) return NO;
    if (!rc->mpvRenderCtx) return YES;
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
    if (!rc || rc->isDestroying.load() || !ctx) return;

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

    bool forceBlack = rc->forceBlackFrame.load() || rc->forceBlackMode.load();
    if (forceBlack) {
        rc->forceBlackFrame.store(false);
        glFlush();
        return;
    }

    uint64_t nowMs = (uint64_t)(CACurrentMediaTime() * 1000.0);
    uint64_t lastMs = rc->lastHdrUpdateMs.load();
    if (lastMs == 0 || nowMs - lastMs > 250) {
        rc->lastHdrUpdateMs.store(nowMs);
        update_hdr_mode(rc);
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

    mpv_render_param params[] = {
        { MPV_RENDER_PARAM_OPENGL_FBO, &fbo },
        { MPV_RENDER_PARAM_FLIP_Y, &flip_y },
        { MPV_RENDER_PARAM_INVALID, nullptr }
    };

    bool sizeChanged = (w != rc->lastRenderedWidth || h != rc->lastRenderedHeight);
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
    
    NSLog(@"[mpv_hdr_cfg] icc-profile-auto=%d target-prim=%s target-trc=%s screenshot-tag-colorspace=%d target-peak-int=%d target-peak-str=%s tone-mapping=%s edr=%.3f wantsEDR=%d contentsScale=%.2f hdrActive=%d",
          iccAuto,
          primariesCfg,
          trcCfg,
          screenshotTag,
          targetPeakInt,
          peakCfg,
          toneCfg,
          edr,
          wantsEDR ? 1 : 0,
          contentsScale,
          rc->hdrActive ? 1 : 0);
    
    if (targetPrim) mpv_free(targetPrim);
    if (targetTrc) mpv_free(targetTrc);
    if (targetPeakStr) mpv_free(targetPeakStr);
    if (toneMapping) mpv_free(toneMapping);
}

static const char* get_optimal_tone_mapping(mpv_handle *mpv) {
    const char* algorithm = "bt.2390"; 
    
    mpv_node tracks;
    if (mpv_get_property(mpv, "track-list", MPV_FORMAT_NODE, &tracks) < 0) {
        return algorithm;
    }
    
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
            
            if (is_video && is_selected) {
                if (has_dv) {
                    algorithm = "hable";
                }
                break;
            }
        }
    }
    
    mpv_free_node_contents(&tracks);
    return algorithm;
}

static void update_hdr_mode(GLRenderContext *rc) {
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
    
    const char *primariesLog = primaries ? primaries : "(null)";
    const char *gammaLog = gamma ? gamma : "(null)";
    if (sigPeakErr < 0) {
        sigPeak = -1.0;
    }
    // 获取显示器信息用于调试
    CGFloat edr = 1.0;
    NSScreen *screen = nil;
    if (rc->view.window) {
        screen = rc->view.window.screen;
    }
    if (screen) {
        if (@available(macOS 10.15, *)) {
            edr = screen.maximumPotentialExtendedDynamicRangeColorComponentValue;
        }
    }
    
    // NSLog(@"[mpv_hdr] update_hdr_mode: userEnabled=%d primaries=%s gamma=%s sig-peak=%.2f shouldEnable=%d hdrActive=%d edr=%.2f",
    //       userEnabled ? 1 : 0,
    //       primariesLog,
    //       gammaLog,
    //       sigPeak,
    //       shouldEnable ? 1 : 0,
    //       rc->hdrActive ? 1 : 0,
    //       edr);
    
    if (shouldEnable == rc->hdrActive) {
        // Even if state matches, we force re-apply if it's enabled
        // This handles cases where user toggles button but internal state was already true
        if (!shouldEnable) {
            if (primaries) mpv_free(primaries);
            if (gamma) mpv_free(gamma);
            return;
        }
    }
    
    if (shouldEnable) {
        CALayer *layer = get_render_layer(rc);
        if (!layer) {
            [rc->view setWantsLayer:YES];
            layer = get_render_layer(rc);
        }
        if (layer) {
            if (@available(macOS 14.0, *)) {
                layer.wantsExtendedDynamicRangeContent = YES;
            }
            CGColorSpaceRef cs = create_hdr_pq_colorspace_for_primaries(primaries);
            if (cs) {
                set_layer_colorspace_if_supported(layer, cs);
                CGColorSpaceRelease(cs);
            }
        }
        
        int iccAuto = 0;
        int screenshotTag = 1;
        mpv_set_property(rc->mpvHandle, "icc-profile-auto", MPV_FORMAT_FLAG, &iccAuto);
        if (primaries) {
            mpv_set_property_string(rc->mpvHandle, "target-prim", primaries);
        } else {
            mpv_set_property_string(rc->mpvHandle, "target-prim", "auto");
        }
        mpv_set_property_string(rc->mpvHandle, "target-trc", "pq");
        mpv_set_property(rc->mpvHandle, "screenshot-tag-colorspace", MPV_FORMAT_FLAG, &screenshotTag);

        int64_t targetPeak = (int64_t)(edr * 100.0);
        if (targetPeak < 100) targetPeak = 100;
        mpv_set_property(rc->mpvHandle, "target-peak", MPV_FORMAT_INT64, &targetPeak);
        
        // mpv_set_property_string(rc->mpvHandle, "target-peak", "auto");

        const char *algo = get_optimal_tone_mapping(rc->mpvHandle);
        mpv_set_property_string(rc->mpvHandle, "tone-mapping", algo);
        
        rc->hdrActive = true;
    } else {
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
        
        set_render_icc_profile(rc);
        int iccAuto = 1;
        int screenshotTag = 0;
        mpv_set_property(rc->mpvHandle, "icc-profile-auto", MPV_FORMAT_FLAG, &iccAuto);
        mpv_set_property_string(rc->mpvHandle, "target-prim", "auto");
        mpv_set_property_string(rc->mpvHandle, "target-trc", "auto");
        mpv_set_property(rc->mpvHandle, "screenshot-tag-colorspace", MPV_FORMAT_FLAG, &screenshotTag);
        mpv_set_property_string(rc->mpvHandle, "target-peak", "auto");
        mpv_set_property_string(rc->mpvHandle, "tone-mapping", "");
        
        rc->hdrActive = false;
    }
    
    if (primaries) mpv_free(primaries);
    if (gamma) mpv_free(gamma);
    
    log_hdr_config(rc);
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
        if (rc->mpvRenderCtx) {
            mpv_render_context_report_swap(rc->mpvRenderCtx);
        }
        if (rc->needRedraw.load()) {
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
    
    // Free mpv render context
    if (rc->mpvRenderCtx) {
        mpv_render_context_set_update_callback(rc->mpvRenderCtx, nullptr, nullptr);
        mpv_render_context_free(rc->mpvRenderCtx);
        rc->mpvRenderCtx = nullptr;
    }
    
    // release GL resources (必须在主线程)
    runOnMainAsync(^{
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
    
    if (!rc || rc->isDestroying.load()) return;
    
    rc->needRedraw.store(true);
    bool wasScheduled = rc->displayScheduled.exchange(true);
    if (wasScheduled) return;
    runOnMainAsync(^{
        std::shared_ptr<GLRenderContext> inner = nullptr;
        {
            std::lock_guard<std::mutex> lock(g_renderMutex);
            auto it = g_renderContexts.find(instanceId);
            if (it != g_renderContexts.end()) inner = it->second;
        }
        if (!inner || inner->isDestroying.load()) return;
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
    NSLog(@"[mpv_hdr] mpv_set_hdr_mode: instanceId=%lld enabled=%d", (long long)instanceId, enabled ? 1 : 0);
    mpv_request_render(instanceId);
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
