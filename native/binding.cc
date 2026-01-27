/**
 * Node.js 原生模块绑定层（Native Module Binding Layer）
 * 
 * 提供 Node.js 与 MPV 播放器之间的桥接，包括：
 * - MPV 实例管理
 * - 事件循环和回调
 * - 属性访问和命令执行
 * - 渲染上下文管理（macOS）
 * 
 * 架构说明：
 * - 使用 N-API 与 Node.js 交互
 * - 使用 ThreadSafeFunction 实现线程安全的事件回调
 * - 通过事件循环线程处理 MPV 事件
 */

// ==================== Node.js N-API ====================
#include <napi.h>

// ==================== MPV 库 ====================
#include <mpv/client.h>
#include <mpv/render.h>
#include <mpv/render_gl.h>

// ==================== C++ 标准库 ====================
#include <iostream>
#include <thread>
#include <mutex>
#include <map>
#include <string>

/**
 * 播放器实例（Player Instance）
 * 
 * 管理播放器实例的所有资源，包括：
 * - MPV 客户端句柄和事件循环
 * - JavaScript 事件回调（ThreadSafeFunction）
 * - 渲染上下文（macOS）
 * 
 * 注意：此结构体使用技术实现名称 MPVInstance 以保持与底层 MPV 库的对应关系。
 * 在代码中可以使用 PlayerInstance 类型别名以获得更好的语义。
 */
struct MPVInstance {
    mpv_handle* ctx;
    std::thread eventThread;
    bool running;
    Napi::ThreadSafeFunction tsfn;
    bool hasTsfn;
    struct GLRenderContext* glCtx;
    
    MPVInstance() : ctx(nullptr), running(false), hasTsfn(false), glCtx(nullptr) {}
    
    ~MPVInstance() {
        // TSFN 应该在 Destroy() 中显式释放，而不是在析构函数中
        // 这样可以确保在 eventLoop 线程退出后再释放，避免竞态条件
        // 如果这里还有 hasTsfn，说明 Destroy() 没有正确调用，强制释放以避免泄漏
        if (hasTsfn) {
            tsfn.Release();
            hasTsfn = false;
        }
    }
};

// 语义化类型别名：使用 PlayerInstance 获得更好的语义
using PlayerInstance = MPVInstance;

// 来自 mpv_render_gl.mm（仅 macOS）
#ifdef __APPLE__
extern "C" struct GLRenderContext *mpv_create_gl_context_for_view(int64_t instanceId, void *nsViewPtr, mpv_handle *mpv);
extern "C" void mpv_destroy_gl_context(int64_t instanceId);
// mpv_render_frame_for_instance 已废弃：渲染现在完全由 CVDisplayLink 驱动
extern "C" void mpv_set_window_size(int64_t instanceId, int width, int height);
extern "C" void mpv_set_force_black_mode(int64_t instanceId, int enabled);
extern "C" void mpv_set_hdr_mode(int64_t instanceId, int enabled);
extern "C" void mpv_debug_hdr_status(int64_t instanceId);
extern "C" void mpv_set_js_driven_render_mode(int64_t instanceId, int enabled);
extern "C" int mpv_get_js_driven_render_mode(int64_t instanceId);
extern "C" void mpv_request_render(int64_t instanceId);
#endif

/**
 * 播放事件消息（Playback Event Message）
 * 
 * 封装从 MPV 传递到 JavaScript 的事件数据，包括：
 * - 属性变更事件（PROPERTY_CHANGE）
 * - 日志消息事件（LOG_MESSAGE）
 * - 文件结束事件（END_FILE）
 * 
 * 注意：此结构体使用技术实现名称 MPVEventMessage 以保持与底层 MPV 库的对应关系。
 * 在代码中可以使用 PlaybackEventMessage 类型别名以获得更好的语义。
 */
struct MPVEventMessage {
    mpv_event_id event_id;        // 事件类型
    std::string property_name;     // 对于 PROPERTY_CHANGE 事件：属性名称
    mpv_format property_format;    // 数据格式
    double double_value;           // 用于 MPV_FORMAT_DOUBLE
    int64_t int_value;            // 用于 MPV_FORMAT_INT64
    int flag_value;               // 用于 MPV_FORMAT_FLAG
    std::string log_prefix;       // 对于 LOG_MESSAGE 事件：日志前缀
    std::string log_level;         // 对于 LOG_MESSAGE 事件：日志级别
    std::string log_text;          // 对于 LOG_MESSAGE 事件：日志文本
    int end_file_reason;           // 对于 END_FILE 事件：结束原因
    int end_file_error;            // 对于 END_FILE 事件：错误代码
    bool has_end_file;             // 是否包含文件结束信息
    
    MPVEventMessage()
        : event_id(MPV_EVENT_NONE),
          property_format(MPV_FORMAT_NONE),
          double_value(0.0),
          int_value(0),
          flag_value(0),
          end_file_reason(0),
          end_file_error(0),
          has_end_file(false) {}
};

// 语义化类型别名：使用 PlaybackEventMessage 获得更好的语义
using PlaybackEventMessage = MPVEventMessage;

// ==================== 全局状态 ====================
static std::map<int64_t, MPVInstance*> instances;
static std::mutex instancesMutex;
static int64_t nextInstanceId = 1;

// ==================== 事件循环 ====================
/**
 * 事件循环线程函数
 * 
 * 在独立线程中运行，监听 MPV 事件并通过 ThreadSafeFunction 传递给 JavaScript。
 * 
 * @param instance 播放器实例
 */
void eventLoop(MPVInstance* instance) {
    while (instance->running && instance->ctx) {
        mpv_event* event = mpv_wait_event(instance->ctx, 1.0);
        if (event->event_id == MPV_EVENT_NONE) {
            continue;
        }
        
        // 构造事件消息
        MPVEventMessage* msg = new MPVEventMessage();
        msg->event_id = event->event_id;
        
        if (event->event_id == MPV_EVENT_PROPERTY_CHANGE && event->data) {
            mpv_event_property* prop = static_cast<mpv_event_property*>(event->data);
            if (prop->name) {
                msg->property_name = prop->name;
            }
            msg->property_format = prop->format;
            
            if (prop->format == MPV_FORMAT_DOUBLE && prop->data) {
                msg->double_value = *static_cast<double*>(prop->data);
            } else if (prop->format == MPV_FORMAT_INT64 && prop->data) {
                msg->int_value = *static_cast<int64_t*>(prop->data);
            } else if (prop->format == MPV_FORMAT_FLAG && prop->data) {
                msg->flag_value = *static_cast<int*>(prop->data);
            }
        } else if (event->event_id == MPV_EVENT_LOG_MESSAGE && event->data) {
            mpv_event_log_message* log_msg = static_cast<mpv_event_log_message*>(event->data);
            if (log_msg->prefix) {
                msg->log_prefix = log_msg->prefix;
            }
            if (log_msg->level) {
                msg->log_level = log_msg->level;
            }
            if (log_msg->text) {
                msg->log_text = log_msg->text;
            }
        } else if (event->event_id == MPV_EVENT_END_FILE && event->data) {
            mpv_event_end_file* eef = static_cast<mpv_event_end_file*>(event->data);
            msg->end_file_reason = static_cast<int>(eef->reason);
            msg->end_file_error = static_cast<int>(eef->error);
            msg->has_end_file = true;
        }
        
        // 通过 ThreadSafeFunction 发送事件到主线程（非阻塞，避免退出时死锁）
        auto callback = [](Napi::Env env, Napi::Function jsCallback, MPVEventMessage* msg) {
            Napi::Object obj = Napi::Object::New(env);
            obj.Set("eventId", Napi::Number::New(env, msg->event_id));
            
            if (!msg->property_name.empty()) {
                obj.Set("name", Napi::String::New(env, msg->property_name));
                obj.Set("format", Napi::Number::New(env, static_cast<int>(msg->property_format)));
                
                switch (msg->property_format) {
                    case MPV_FORMAT_DOUBLE:
                        obj.Set("value", Napi::Number::New(env, msg->double_value));
                        break;
                    case MPV_FORMAT_INT64:
                        obj.Set("value", Napi::Number::New(env, static_cast<double>(msg->int_value)));
                        break;
                    case MPV_FORMAT_FLAG:
                        obj.Set("value", Napi::Boolean::New(env, msg->flag_value != 0));
                        break;
                    default:
                        break;
                }
            }
            
            // 处理日志消息
            if (!msg->log_prefix.empty() || !msg->log_text.empty()) {
                obj.Set("logPrefix", Napi::String::New(env, msg->log_prefix));
                obj.Set("logLevel", Napi::String::New(env, msg->log_level));
                obj.Set("logText", Napi::String::New(env, msg->log_text));
            }

            if (msg->has_end_file) {
                obj.Set("endFileReason", Napi::Number::New(env, msg->end_file_reason));
                obj.Set("endFileError", Napi::Number::New(env, msg->end_file_error));
            }
            
            jsCallback.Call({obj});
            delete msg;
        };
        
        // 使用局部变量保存 tsfn 和 hasTsfn，避免在检查和使用之间被其他线程修改
        bool hasTsfn = instance->hasTsfn;
        if (hasTsfn) {
            // 再次检查 running，确保在释放 tsfn 之前不会继续使用
            if (!instance->running) {
                delete msg;
                break;
            }
            napi_status s = instance->tsfn.NonBlockingCall(msg, callback);
            if (s != napi_ok) {
                // JS 侧已经退出或队列满，丢弃事件避免卡住
                delete msg;
            }
        } else {
            delete msg;
        }
        
        if (event->event_id == MPV_EVENT_SHUTDOWN) {
            break;
        }
    }
}

// ==================== 公共 API 函数 ====================
/**
 * 绑定视图并创建渲染上下文
 * 
 * macOS: 创建 OpenGL 渲染上下文和渲染层
 * Windows: 设置窗口 ID（wid）用于嵌入
 * 
 * @param info N-API 回调信息
 * @return undefined
 */
Napi::Value AttachView(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    
    if (info.Length() < 2 || !info[0].IsNumber() || !info[1].IsNumber()) {
        Napi::TypeError::New(env, "Expected (instanceId: number, viewPtr: number)")
            .ThrowAsJavaScriptException();
        return env.Null();
    }
    
    int64_t id = info[0].As<Napi::Number>().Int64Value();
    int64_t viewPtr = info[1].As<Napi::Number>().Int64Value();
    
    std::lock_guard<std::mutex> lock(instancesMutex);
    auto it = instances.find(id);
    if (it == instances.end() || !it->second->ctx) {
        Napi::Error::New(env, "Invalid mpv instance").ThrowAsJavaScriptException();
        return env.Null();
    }
    
    MPVInstance* inst = it->second;
    
#ifdef __APPLE__
    // macOS: 使用 render API，创建 GL 上下文
    if (!inst->glCtx) {
        inst->glCtx = mpv_create_gl_context_for_view(id, (void*)viewPtr, inst->ctx);
        if (!inst->glCtx) {
            Napi::Error::New(env, "Failed to create GL context for view").ThrowAsJavaScriptException();
            return env.Null();
        }
    }
#elif defined(_WIN32)
    // Windows: 使用 wid 嵌入方式
    // viewPtr 是 HWND，通过 SetWindowId 设置
    int err = mpv_set_option(inst->ctx, "wid", MPV_FORMAT_INT64, &viewPtr);
    if (err < 0) {
        Napi::Error::New(env, std::string("Failed to set window ID: ") + mpv_error_string(err))
            .ThrowAsJavaScriptException();
        return env.Null();
    }
#endif
    
    return env.Undefined();
}

/**
 * 设置渲染视口大小
 * 
 * 当窗口大小改变时调用，更新渲染视口的像素大小。
 * 
 * @param info N-API 回调信息
 * @return undefined
 */
Napi::Value SetWindowSize(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    
    if (info.Length() < 3 || !info[0].IsNumber() || !info[1].IsNumber() || !info[2].IsNumber()) {
        Napi::TypeError::New(env, "Expected (instanceId: number, width: number, height: number)")
            .ThrowAsJavaScriptException();
        return env.Null();
    }
    
    int64_t id = info[0].As<Napi::Number>().Int64Value();
    int width = info[1].As<Napi::Number>().Int32Value();
    int height = info[2].As<Napi::Number>().Int32Value();
    
#ifdef __APPLE__
    mpv_set_window_size(id, width, height);
#elif defined(_WIN32)
    // Windows 使用 wid 方式，MPV 会自动适应窗口大小
    // 但可以通过设置属性来触发更新，确保视频正确缩放
    std::lock_guard<std::mutex> lock(instancesMutex);
    auto it = instances.find(id);
    if (it != instances.end() && it->second->ctx && it->second->running) {
        mpv_handle* ctx = it->second->ctx;
        // 通过设置 window-scale 属性来触发窗口大小更新
        // 这会强制 MPV 重新计算窗口大小
        double scale = 1.0;
        mpv_set_property(ctx, "window-scale", MPV_FORMAT_DOUBLE, &scale);
        // 也可以尝试触发重绘
        const char* cmd[] = { "show-text", " ", NULL };
        mpv_command(ctx, cmd);
    }
#endif
    
    return env.Undefined();
}

Napi::Value SetForceBlackMode(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    
    if (info.Length() < 2 || !info[0].IsNumber() || !info[1].IsBoolean()) {
        Napi::TypeError::New(env, "Expected (instanceId: number, enabled: boolean)")
            .ThrowAsJavaScriptException();
        return env.Null();
    }
    
    int64_t id = info[0].As<Napi::Number>().Int64Value();
    bool enabled = info[1].As<Napi::Boolean>().Value();
    
    {
        std::lock_guard<std::mutex> lock(instancesMutex);
        auto it = instances.find(id);
        if (it == instances.end() || !it->second->ctx) {
            Napi::Error::New(env, "Invalid mpv instance").ThrowAsJavaScriptException();
            return env.Null();
        }
    }
    
#ifdef __APPLE__
    mpv_set_force_black_mode(id, enabled ? 1 : 0);
#elif defined(_WIN32)
    // Windows 使用 wid 方式，不支持 force black mode
    // 可以忽略或通过其他方式实现
#endif
    
    return env.Undefined();
}

Napi::Value SetHdrMode(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    
    if (info.Length() < 2 || !info[0].IsNumber() || !info[1].IsBoolean()) {
        Napi::TypeError::New(env, "Expected (instanceId: number, enabled: boolean)")
            .ThrowAsJavaScriptException();
        return env.Null();
    }
    
    int64_t id = info[0].As<Napi::Number>().Int64Value();
    bool enabled = info[1].As<Napi::Boolean>().Value();
    
    std::lock_guard<std::mutex> lock(instancesMutex);
    auto it = instances.find(id);
    if (it == instances.end() || !it->second->ctx) {
        Napi::Error::New(env, "Invalid mpv instance").ThrowAsJavaScriptException();
        return env.Null();
    }
    
#ifdef __APPLE__
    mpv_set_hdr_mode(id, enabled ? 1 : 0);
#elif defined(_WIN32)
    // Windows 使用 wid 方式，HDR 可以通过 mpv 选项设置
    // 这里可以设置相关选项，但需要根据实际需求调整
    // 暂时忽略，后续可以扩展
#endif
    
    return env.Undefined();
}

Napi::Value SetJsDrivenRenderMode(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    
    if (info.Length() < 2 || !info[0].IsNumber() || !info[1].IsBoolean()) {
        Napi::TypeError::New(env, "Expected (instanceId: number, enabled: boolean)")
            .ThrowAsJavaScriptException();
        return env.Null();
    }
    
    int64_t id = info[0].As<Napi::Number>().Int64Value();
    bool enabled = info[1].As<Napi::Boolean>().Value();
    
    std::lock_guard<std::mutex> lock(instancesMutex);
    auto it = instances.find(id);
    if (it == instances.end() || !it->second->ctx) {
        Napi::Error::New(env, "Invalid mpv instance").ThrowAsJavaScriptException();
        return env.Null();
    }
    
#ifdef __APPLE__
    mpv_set_js_driven_render_mode(id, enabled ? 1 : 0);
#elif defined(_WIN32)
    // Windows 暂不支持 JavaScript 驱动渲染模式
#endif
    
    return env.Undefined();
}

Napi::Value GetJsDrivenRenderMode(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    
    if (info.Length() < 1 || !info[0].IsNumber()) {
        Napi::TypeError::New(env, "Expected (instanceId: number)")
            .ThrowAsJavaScriptException();
        return env.Null();
    }
    
    int64_t id = info[0].As<Napi::Number>().Int64Value();
    
    std::lock_guard<std::mutex> lock(instancesMutex);
    auto it = instances.find(id);
    if (it == instances.end() || !it->second->ctx) {
        Napi::Error::New(env, "Invalid mpv instance").ThrowAsJavaScriptException();
        return env.Null();
    }
    
#ifdef __APPLE__
    int enabled = mpv_get_js_driven_render_mode(id);
    return Napi::Boolean::New(env, enabled != 0);
#elif defined(_WIN32)
    // Windows 暂不支持 JavaScript 驱动渲染模式
    return Napi::Boolean::New(env, false);
#endif
}

Napi::Value RequestRender(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    
    if (info.Length() < 1 || !info[0].IsNumber()) {
        Napi::TypeError::New(env, "Expected (instanceId: number)")
            .ThrowAsJavaScriptException();
        return env.Null();
    }
    
    int64_t id = info[0].As<Napi::Number>().Int64Value();
    
    std::lock_guard<std::mutex> lock(instancesMutex);
    auto it = instances.find(id);
    if (it == instances.end() || !it->second->ctx) {
        Napi::Error::New(env, "Invalid mpv instance").ThrowAsJavaScriptException();
        return env.Null();
    }
    
#ifdef __APPLE__
    mpv_request_render(id);
#elif defined(_WIN32)
    // Windows 暂不支持 JavaScript 驱动渲染模式
#endif
    
    return env.Undefined();
}

Napi::Value DebugHdrStatus(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (info.Length() < 1 || !info[0].IsNumber()) {
        Napi::TypeError::New(env, "Expected (instanceId: number)")
            .ThrowAsJavaScriptException();
        return env.Null();
    }

    int64_t id = info[0].As<Napi::Number>().Int64Value();

    {
        std::lock_guard<std::mutex> lock(instancesMutex);
        auto it = instances.find(id);
        if (it == instances.end() || !it->second->ctx) {
            Napi::Error::New(env, "Invalid mpv instance").ThrowAsJavaScriptException();
            return env.Null();
        }
    }

#ifdef __APPLE__
    mpv_debug_hdr_status(id);
#elif defined(_WIN32)
    // Windows 使用 wid 方式，HDR 调试功能暂不支持
#endif

    return env.Undefined();
}

/**
 * 创建播放器实例
 * 
 * 创建 MPV 实例但不立即初始化，允许先设置选项。
 * 调用者需要手动调用 initialize() 方法。
 * 
 * @param info N-API 回调信息
 * @return 实例 ID（number）
 */
Napi::Value Create(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    
    mpv_handle* ctx = mpv_create();
    if (!ctx) {
        Napi::Error::New(env, "Failed to create mpv instance").ThrowAsJavaScriptException();
        return env.Null();
    }
    
    // 不立即初始化，允许先设置选项
    // 调用者需要手动调用 initialize() 方法
    
    MPVInstance* instance = new MPVInstance();
    instance->ctx = ctx;
    instance->running = false; // 未初始化，不运行事件循环
    
    std::lock_guard<std::mutex> lock(instancesMutex);
    int64_t id = nextInstanceId++;
    instances[id] = instance;
    
    return Napi::Number::New(env, id);
}

/**
 * 初始化播放器实例
 * 
 * 初始化 MPV 实例，启动事件循环，并设置属性观察。
 * 
 * @param info N-API 回调信息
 * @return 成功返回 true
 */
Napi::Value Initialize(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    
    if (info.Length() < 1 || !info[0].IsNumber()) {
        Napi::TypeError::New(env, "Expected (instanceId: number)")
            .ThrowAsJavaScriptException();
        return env.Null();
    }
    
    int64_t id = info[0].As<Napi::Number>().Int64Value();
    
    std::lock_guard<std::mutex> lock(instancesMutex);
    auto it = instances.find(id);
    if (it == instances.end() || !it->second->ctx) {
        Napi::Error::New(env, "Invalid mpv instance").ThrowAsJavaScriptException();
        return env.Null();
    }
    
    MPVInstance* instance = it->second;
    if (instance->running) {
        Napi::Error::New(env, "MPV instance already initialized").ThrowAsJavaScriptException();
        return env.Null();
    }
    
    int err = mpv_initialize(instance->ctx);
    if (err < 0) {
        Napi::Error::New(env, std::string("Failed to initialize mpv: ") + mpv_error_string(err))
            .ThrowAsJavaScriptException();
        return env.Null();
    }
    
    // Request info level logs to see debug messages (can use "v" for verbose)
    mpv_request_log_messages(instance->ctx, "v");
    
    mpv_observe_property(instance->ctx, 0, "pause", MPV_FORMAT_FLAG);
    mpv_observe_property(instance->ctx, 0, "time-pos", MPV_FORMAT_DOUBLE);
    mpv_observe_property(instance->ctx, 0, "duration", MPV_FORMAT_DOUBLE);
    mpv_observe_property(instance->ctx, 0, "volume", MPV_FORMAT_DOUBLE);
    mpv_observe_property(instance->ctx, 0, "core-idle", MPV_FORMAT_FLAG);
    mpv_observe_property(instance->ctx, 0, "idle-active", MPV_FORMAT_FLAG);
    mpv_observe_property(instance->ctx, 0, "paused-for-cache", MPV_FORMAT_FLAG);
    mpv_observe_property(instance->ctx, 0, "cache-buffering-state", MPV_FORMAT_INT64);
    mpv_observe_property(instance->ctx, 0, "estimated-vf-fps", MPV_FORMAT_DOUBLE);
    
    instance->running = true;
    
    return Napi::Boolean::New(env, true);
}

// 设置选项（必须在初始化前调用）
Napi::Value SetOption(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    
    if (info.Length() < 3 || !info[0].IsNumber() || !info[1].IsString()) {
        Napi::TypeError::New(env, "Expected (instanceId: number, name: string, value: any)")
            .ThrowAsJavaScriptException();
        return env.Null();
    }
    
    int64_t id = info[0].As<Napi::Number>().Int64Value();
    std::string name = info[1].As<Napi::String>().Utf8Value();
    
    std::lock_guard<std::mutex> lock(instancesMutex);
    auto it = instances.find(id);
    if (it == instances.end() || !it->second->ctx) {
        Napi::Error::New(env, "Invalid mpv instance").ThrowAsJavaScriptException();
        return env.Null();
    }
    
    // 选项只能在初始化前设置
    if (it->second->running) {
        Napi::Error::New(env, "Options can only be set before initialization")
            .ThrowAsJavaScriptException();
        return env.Null();
    }
    
    mpv_handle* ctx = it->second->ctx;
    int err;
    
    if (info[2].IsString()) {
        std::string value = info[2].As<Napi::String>().Utf8Value();
        err = mpv_set_option_string(ctx, name.c_str(), value.c_str());
    } else if (info[2].IsNumber()) {
        int64_t value = info[2].As<Napi::Number>().Int64Value();
        err = mpv_set_option(ctx, name.c_str(), MPV_FORMAT_INT64, &value);
    } else if (info[2].IsBoolean()) {
        int flag = info[2].As<Napi::Boolean>().Value() ? 1 : 0;
        err = mpv_set_option(ctx, name.c_str(), MPV_FORMAT_FLAG, &flag);
    } else {
        Napi::TypeError::New(env, "Unsupported value type").ThrowAsJavaScriptException();
        return env.Null();
    }
    
    if (err < 0) {
        Napi::Error::New(env, std::string("Failed to set option: ") + mpv_error_string(err))
            .ThrowAsJavaScriptException();
        return env.Null();
    }
    
    return Napi::Boolean::New(env, true);
}

// 设置窗口 ID（用于嵌入）
Napi::Value SetWindowId(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    
    if (info.Length() < 2 || !info[0].IsNumber() || !info[1].IsNumber()) {
        Napi::TypeError::New(env, "Expected (instanceId: number, windowId: number)")
            .ThrowAsJavaScriptException();
        return env.Null();
    }
    
    int64_t id = info[0].As<Napi::Number>().Int64Value();
    int64_t windowId = info[1].As<Napi::Number>().Int64Value();
    
    std::lock_guard<std::mutex> lock(instancesMutex);
    auto it = instances.find(id);
    if (it == instances.end() || !it->second->ctx) {
        Napi::Error::New(env, "Invalid mpv instance").ThrowAsJavaScriptException();
        return env.Null();
    }
    
    mpv_handle* ctx = it->second->ctx;
    
    // 在 Windows 上，wid 必须是有效的 HWND
    // 注意：wid 必须在 mpv_initialize() 之前设置
    int err = mpv_set_option(ctx, "wid", MPV_FORMAT_INT64, &windowId);
    
    if (err < 0) {
        std::string errorMsg = std::string("Failed to set window ID (wid): ") + mpv_error_string(err);
        std::cerr << "[binding] SetWindowId error: " << errorMsg << " (HWND: " << windowId << ")" << std::endl;
        Napi::Error::New(env, errorMsg)
            .ThrowAsJavaScriptException();
        return env.Null();
    }
    
    std::cerr << "[binding] SetWindowId success: wid=" << windowId << std::endl;
    return Napi::Boolean::New(env, true);
}

// 加载文件
Napi::Value LoadFile(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    
    if (info.Length() < 2 || !info[0].IsNumber() || !info[1].IsString()) {
        Napi::TypeError::New(env, "Expected (instanceId: number, path: string)")
            .ThrowAsJavaScriptException();
        return env.Null();
    }
    
    int64_t id = info[0].As<Napi::Number>().Int64Value();
    std::string path = info[1].As<Napi::String>().Utf8Value();
    
    std::lock_guard<std::mutex> lock(instancesMutex);
    auto it = instances.find(id);
    if (it == instances.end() || !it->second->ctx) {
        Napi::Error::New(env, "Invalid mpv instance").ThrowAsJavaScriptException();
        return env.Null();
    }
    
    mpv_handle* ctx = it->second->ctx;
    const char* args[] = {"loadfile", path.c_str(), "replace", nullptr};
    int err = mpv_command(ctx, args);
    
    if (err < 0) {
        Napi::Error::New(env, std::string("Failed to load file: ") + mpv_error_string(err))
            .ThrowAsJavaScriptException();
        return env.Null();
    }
    
    return Napi::Boolean::New(env, true);
}

// 获取属性
Napi::Value GetProperty(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    
    if (info.Length() < 2 || !info[0].IsNumber() || !info[1].IsString()) {
        Napi::TypeError::New(env, "Expected (instanceId: number, name: string)")
            .ThrowAsJavaScriptException();
        return env.Null();
    }
    
    int64_t id = info[0].As<Napi::Number>().Int64Value();
    std::string name = info[1].As<Napi::String>().Utf8Value();
    
    std::lock_guard<std::mutex> lock(instancesMutex);
    auto it = instances.find(id);
    if (it == instances.end() || !it->second->ctx) {
        Napi::Error::New(env, "Invalid mpv instance").ThrowAsJavaScriptException();
        return env.Null();
    }
    
    mpv_handle* ctx = it->second->ctx;
    
    // 尝试获取字符串属性
    char* result = mpv_get_property_string(ctx, name.c_str());
    if (result) {
        Napi::String str = Napi::String::New(env, result);
        mpv_free(result);
        return str;
    }
    
    // 尝试获取数字属性
    int64_t intValue;
    if (mpv_get_property(ctx, name.c_str(), MPV_FORMAT_INT64, &intValue) >= 0) {
        return Napi::Number::New(env, intValue);
    }
    
    // 尝试获取浮点数属性
    double doubleValue;
    if (mpv_get_property(ctx, name.c_str(), MPV_FORMAT_DOUBLE, &doubleValue) >= 0) {
        return Napi::Number::New(env, doubleValue);
    }
    
    // 尝试获取布尔属性
    int flag;
    if (mpv_get_property(ctx, name.c_str(), MPV_FORMAT_FLAG, &flag) >= 0) {
        return Napi::Boolean::New(env, flag != 0);
    }
    
    return env.Null();
}

// 设置属性
Napi::Value SetProperty(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    
    if (info.Length() < 3 || !info[0].IsNumber() || !info[1].IsString()) {
        Napi::TypeError::New(env, "Expected (instanceId: number, name: string, value: any)")
            .ThrowAsJavaScriptException();
        return env.Null();
    }
    
    int64_t id = info[0].As<Napi::Number>().Int64Value();
    std::string name = info[1].As<Napi::String>().Utf8Value();
    
    std::lock_guard<std::mutex> lock(instancesMutex);
    auto it = instances.find(id);
    if (it == instances.end() || !it->second->ctx) {
        Napi::Error::New(env, "Invalid mpv instance").ThrowAsJavaScriptException();
        return env.Null();
    }
    
    mpv_handle* ctx = it->second->ctx;
    int err;
    
    if (info[2].IsString()) {
        std::string value = info[2].As<Napi::String>().Utf8Value();
        err = mpv_set_property_string(ctx, name.c_str(), value.c_str());
    } else if (info[2].IsNumber()) {
        double value = info[2].As<Napi::Number>().DoubleValue();
        err = mpv_set_property(ctx, name.c_str(), MPV_FORMAT_DOUBLE, &value);
    } else if (info[2].IsBoolean()) {
        int flag = info[2].As<Napi::Boolean>().Value() ? 1 : 0;
        err = mpv_set_property(ctx, name.c_str(), MPV_FORMAT_FLAG, &flag);
    } else {
        Napi::TypeError::New(env, "Unsupported value type").ThrowAsJavaScriptException();
        return env.Null();
    }
    
    if (err < 0) {
        Napi::Error::New(env, std::string("Failed to set property: ") + mpv_error_string(err))
            .ThrowAsJavaScriptException();
        return env.Null();
    }
    
    return Napi::Boolean::New(env, true);
}

// 执行命令
Napi::Value Command(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    
    if (info.Length() < 2 || !info[0].IsNumber() || !info[1].IsArray()) {
        Napi::TypeError::New(env, "Expected (instanceId: number, args: string[])")
            .ThrowAsJavaScriptException();
        return env.Null();
    }
    
    int64_t id = info[0].As<Napi::Number>().Int64Value();
    Napi::Array arr = info[1].As<Napi::Array>();
    
    std::lock_guard<std::mutex> lock(instancesMutex);
    auto it = instances.find(id);
    if (it == instances.end() || !it->second->ctx) {
        Napi::Error::New(env, "Invalid mpv instance").ThrowAsJavaScriptException();
        return env.Null();
    }
    
    mpv_handle* ctx = it->second->ctx;
    
    std::vector<std::string> args;
    std::vector<const char*> cArgs;
    
    for (uint32_t i = 0; i < arr.Length(); i++) {
        Napi::Value val = arr[i];
        if (val.IsString()) {
            args.push_back(val.As<Napi::String>().Utf8Value());
        }
    }
    
    for (const auto& arg : args) {
        cArgs.push_back(arg.c_str());
    }
    cArgs.push_back(nullptr);
    
    int err = mpv_command(ctx, cArgs.data());
    
    if (err < 0) {
        Napi::Error::New(env, std::string("Command failed: ") + mpv_error_string(err))
            .ThrowAsJavaScriptException();
        return env.Null();
    }
    
    return Napi::Boolean::New(env, true);
}

// 设置事件回调
Napi::Value SetEventCallback(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    
    if (info.Length() < 2 || !info[0].IsNumber() || !info[1].IsFunction()) {
        Napi::TypeError::New(env, "Expected (instanceId: number, callback: function)")
            .ThrowAsJavaScriptException();
        return env.Null();
    }
    
    int64_t id = info[0].As<Napi::Number>().Int64Value();
    Napi::Function callback = info[1].As<Napi::Function>();
    
    std::lock_guard<std::mutex> lock(instancesMutex);
    auto it = instances.find(id);
    if (it == instances.end() || !it->second->ctx) {
        Napi::Error::New(env, "Invalid mpv instance").ThrowAsJavaScriptException();
        return env.Null();
    }
    
    MPVInstance* instance = it->second;
    
    // 如果已有回调，先释放
    if (instance->hasTsfn) {
        instance->tsfn.Release();
        instance->hasTsfn = false;
    }
    
    // 创建 ThreadSafeFunction
    instance->tsfn = Napi::ThreadSafeFunction::New(
        env,
        callback,
        "MPV Event Callback",
        0,
        1,
        [](Napi::Env) {}
    );
    instance->hasTsfn = true;
    
    // 启动事件循环线程
    if (!instance->eventThread.joinable()) {
        instance->eventThread = std::thread(eventLoop, instance);
    }
    
    return Napi::Boolean::New(env, true);
}

// 销毁实例（在后台线程中完成重型销毁，避免阻塞 JS 主线程）
Napi::Value Destroy(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    
    if (info.Length() < 1 || !info[0].IsNumber()) {
        Napi::TypeError::New(env, "Expected (instanceId: number)")
            .ThrowAsJavaScriptException();
        return env.Null();
    }
    
    int64_t id = info[0].As<Napi::Number>().Int64Value();
    
    MPVInstance* instance = nullptr;
    {
        std::lock_guard<std::mutex> lock(instancesMutex);
        auto it = instances.find(id);
        if (it == instances.end()) {
            Napi::Error::New(env, "Invalid mpv instance").ThrowAsJavaScriptException();
            return env.Null();
        }
        
        instance = it->second;
        // 从全局表中摘掉，后续生命周期交给后台线程
        instances.erase(it);
    }
    
    // 在后台线程里做真正的销毁（停止事件循环、join、mpv_terminate_destroy），
    // 避免在 JS 主线程上同步阻塞，导致窗口关闭卡死。
    std::thread([instance, id]() {
        if (!instance) return;
        
        // 先释放 ThreadSafeFunction，确保 eventLoop 线程不会继续使用它
        // 必须在停止事件循环之前释放，避免竞态条件
        if (instance->hasTsfn) {
            instance->tsfn.Release();
            instance->hasTsfn = false;
        }
        
        // 停止事件循环
        instance->running = false;
        if (instance->ctx) {
            mpv_wakeup(instance->ctx);
        }
        
        // 等事件线程自然退出
        if (instance->eventThread.joinable()) {
            instance->eventThread.join();
        }

        // 销毁渲染上下文（仅 macOS）
#ifdef __APPLE__
        mpv_destroy_gl_context(id);
#endif
        
        // 销毁 mpv 实例
        if (instance->ctx) {
            mpv_terminate_destroy(instance->ctx);
            instance->ctx = nullptr;
        }
        
        delete instance;
    }).detach();
    
    return Napi::Boolean::New(env, true);
}

// ==================== 模块初始化 ====================
/**
 * 初始化 Node.js 模块
 * 
 * 注册所有公共 API 函数到 exports 对象。
 * 
 * @param env N-API 环境
 * @param exports 导出对象
 * @return exports 对象
 */
Napi::Object Init(Napi::Env env, Napi::Object exports) {
    exports.Set(Napi::String::New(env, "create"), Napi::Function::New(env, Create));
    exports.Set(Napi::String::New(env, "initialize"), Napi::Function::New(env, Initialize));
    exports.Set(Napi::String::New(env, "setOption"), Napi::Function::New(env, SetOption));
    exports.Set(Napi::String::New(env, "setWindowId"), Napi::Function::New(env, SetWindowId));
    exports.Set(Napi::String::New(env, "loadFile"), Napi::Function::New(env, LoadFile));
    exports.Set(Napi::String::New(env, "getProperty"), Napi::Function::New(env, GetProperty));
    exports.Set(Napi::String::New(env, "setProperty"), Napi::Function::New(env, SetProperty));
    exports.Set(Napi::String::New(env, "command"), Napi::Function::New(env, Command));
    exports.Set(Napi::String::New(env, "setEventCallback"), Napi::Function::New(env, SetEventCallback));
    exports.Set(Napi::String::New(env, "destroy"), Napi::Function::New(env, Destroy));
    exports.Set(Napi::String::New(env, "attachView"), Napi::Function::New(env, AttachView));
    // renderFrame 已废弃：渲染现在完全由 CVDisplayLink 驱动
    exports.Set(Napi::String::New(env, "setWindowSize"), Napi::Function::New(env, SetWindowSize));
    exports.Set(Napi::String::New(env, "setForceBlackMode"), Napi::Function::New(env, SetForceBlackMode));
    exports.Set(Napi::String::New(env, "setHdrMode"), Napi::Function::New(env, SetHdrMode));
    exports.Set(Napi::String::New(env, "debugHdrStatus"), Napi::Function::New(env, DebugHdrStatus));
    exports.Set(Napi::String::New(env, "setJsDrivenRenderMode"), Napi::Function::New(env, SetJsDrivenRenderMode));
    exports.Set(Napi::String::New(env, "getJsDrivenRenderMode"), Napi::Function::New(env, GetJsDrivenRenderMode));
    exports.Set(Napi::String::New(env, "requestRender"), Napi::Function::New(env, RequestRender));
    
    return exports;
}

NODE_API_MODULE(mpv_binding, Init)
