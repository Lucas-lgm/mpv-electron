#include <napi.h>
#include <mpv/client.h>
#include <mpv/render.h>
#include <mpv/render_gl.h>
#include <iostream>
#include <thread>
#include <mutex>
#include <map>
#include <string>

// MPV 实例管理
struct MPVInstance {
    mpv_handle* ctx;
    std::thread eventThread;
    bool running;
    Napi::ThreadSafeFunction tsfn;
    bool hasTsfn;
    struct GLRenderContext* glCtx;
    
    MPVInstance() : ctx(nullptr), running(false), hasTsfn(false), glCtx(nullptr) {}
    
    ~MPVInstance() {
        // 这里只负责释放 TSFN，不在析构里做重型的 mpv 销毁，
        // 避免在 JS 主线程上触发 mpv 的 vo_destroy 造成卡死。
        if (hasTsfn) {
            tsfn.Release();
            hasTsfn = false;
        }
    }
};

// 来自 mpv_render_gl.mm
extern "C" struct GLRenderContext *mpv_create_gl_context_for_view(int64_t instanceId, void *nsViewPtr, mpv_handle *mpv);
extern "C" void mpv_destroy_gl_context(int64_t instanceId);
extern "C" void mpv_render_frame_for_instance(int64_t instanceId);
extern "C" void mpv_set_window_size(int64_t instanceId, int width, int height);
extern "C" void mpv_force_black_frame(int64_t instanceId);

// 发送到 JS 的事件数据
struct MPVEventMessage {
    mpv_event_id event_id;
    std::string property_name;   // 对于 PROPERTY_CHANGE 事件
    mpv_format property_format;  // 数据格式
    double double_value;         // 用于 MPV_FORMAT_DOUBLE
    int64_t int_value;           // 用于 MPV_FORMAT_INT64
    int flag_value;              // 用于 MPV_FORMAT_FLAG
    std::string log_prefix;      // 对于 LOG_MESSAGE 事件
    std::string log_level;       // 对于 LOG_MESSAGE 事件
    std::string log_text;        // 对于 LOG_MESSAGE 事件
    
    MPVEventMessage()
        : event_id(MPV_EVENT_NONE),
          property_format(MPV_FORMAT_NONE),
          double_value(0.0),
          int_value(0),
          flag_value(0) {}
};

static std::map<int64_t, MPVInstance*> instances;
static std::mutex instancesMutex;
static int64_t nextInstanceId = 1;

// 事件循环线程函数
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
            
            jsCallback.Call({obj});
            delete msg;
        };
        
        if (instance->hasTsfn) {
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

// 绑定 NSView 并创建 GL + mpv_render_context
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
    
    // 避免重复创建
    if (!inst->glCtx) {
        inst->glCtx = mpv_create_gl_context_for_view(id, (void*)viewPtr, inst->ctx);
        if (!inst->glCtx) {
            Napi::Error::New(env, "Failed to create GL context for view").ThrowAsJavaScriptException();
            return env.Null();
        }
    }
    
    return env.Undefined();
}

// 渲染一帧（已废弃：渲染循环现在在原生代码中自动运行）
// 保留此函数以保持 API 兼容性，但实际不做任何操作
Napi::Value RenderFrame(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    // 渲染循环现在在原生代码中自动运行，不需要从 JS 调用
    return env.Undefined();
}

// 设置窗口尺寸（由 Electron 调用）
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
    
    mpv_set_window_size(id, width, height);
    
    return env.Undefined();
}

Napi::Value ClearToBlack(const Napi::CallbackInfo& info) {
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
    
    mpv_force_black_frame(id);
    
    return env.Undefined();
}

// 创建 MPV 实例（不立即初始化，允许先设置选项）
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

// 初始化 MPV 实例
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
    
    // 启用 mpv 日志（verbose 级别，可以看到 letterbox 计算等详细信息）
    mpv_request_log_messages(instance->ctx, "v");
    
    // 在初始化后订阅我们关心的属性变化（忽略错误）
    mpv_observe_property(instance->ctx, 0, "pause", MPV_FORMAT_FLAG);
    mpv_observe_property(instance->ctx, 0, "time-pos", MPV_FORMAT_DOUBLE);
    mpv_observe_property(instance->ctx, 0, "duration", MPV_FORMAT_DOUBLE);
    mpv_observe_property(instance->ctx, 0, "volume", MPV_FORMAT_DOUBLE);
    
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
    int err = mpv_set_option(ctx, "wid", MPV_FORMAT_INT64, &windowId);
    
    if (err < 0) {
        Napi::Error::New(env, std::string("Failed to set window ID: ") + mpv_error_string(err))
            .ThrowAsJavaScriptException();
        return env.Null();
    }
    
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
        
        // 停止事件循环
        instance->running = false;
        if (instance->ctx) {
            mpv_wakeup(instance->ctx);
        }
        
        // 等事件线程自然退出
        if (instance->eventThread.joinable()) {
            instance->eventThread.join();
        }

        // 销毁渲染上下文
        mpv_destroy_gl_context(id);
        
        // 销毁 mpv 实例
        if (instance->ctx) {
            mpv_terminate_destroy(instance->ctx);
            instance->ctx = nullptr;
        }
        
        delete instance;
    }).detach();
    
    return Napi::Boolean::New(env, true);
}

// 初始化模块
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
    exports.Set(Napi::String::New(env, "renderFrame"), Napi::Function::New(env, RenderFrame));
    exports.Set(Napi::String::New(env, "setWindowSize"), Napi::Function::New(env, SetWindowSize));
    exports.Set(Napi::String::New(env, "clearToBlack"), Napi::Function::New(env, ClearToBlack));
    
    return exports;
}

NODE_API_MODULE(mpv_binding, Init)
