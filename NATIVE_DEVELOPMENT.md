# Native Module Development Notes

This document summarizes the architecture and critical implementation details of the native mpv integration module (`native/mpv_render_gl.mm`).

## Architecture

The native module uses **Node-API (via `node-addon-api`)** to bridge Node.js (Electron Main Process) and `libmpv`.

- **Main Thread (Node.js/Electron)**: Handles window management, input events, and lifecycle calls (`create`, `destroy`, `resize`).
- **Render Thread (`pthread`)**: A dedicated background thread created for each mpv instance to handle the render loop (`mpv_render_context_render`).

## Threading & Synchronization

Proper synchronization between the Main Thread and Render Thread is critical to prevent crashes, especially on macOS where OpenGL contexts are sensitive to multithreaded access.

### 1. Context Lifecycle (`std::shared_ptr`)

**Problem:** Previously, `GLRenderContext` was managed with raw pointers. When closing the window, `mpv_destroy_gl_context` would `delete` the context immediately. However, asynchronous tasks (scheduled via `runOnMainAsync`) or the render thread might still be trying to access it, leading to **Use-After-Free** crashes (Segmentation Fault).

**Solution:**
- We now use `std::shared_ptr<GLRenderContext>` to manage the context.
- The global map `g_renderContexts` holds shared pointers.
- Async tasks capture the `shared_ptr`, ensuring the context remains alive until the task completes, even if removed from the global map.

### 2. OpenGL Context Locking (`CGLLockContext`)

**Problem:** On macOS, if a background thread is using an OpenGL context (drawing) while the main thread updates it (e.g., resizing window calls `[nsOpenGLContext update]`), a **Race Condition** occurs, leading to crashes inside the graphics driver or WindowServer.

**Solution:**
- We use `CGLContextObj` and `CGLLockContext` to enforce mutual exclusion.
- A helper class `ScopedCGLock` is used.
- **Render Thread**: Locks before `mpv_render_context_render`.
- **Main Thread**: Locks before `[nsOpenGLContext update]` (inside `mpv_set_window_size`).

```cpp
// Example: Scoped locking
{
    ScopedCGLock lock([rc->glContext CGLContextObj]);
    // Safe to perform GL operations
}
```

## Troubleshooting History

### Segmentation Fault on Window Close/Resize (Fixed 2026-01-14)

- **Symptoms**: App crashes with "Segmentation Fault: 11" when closing the window or resizing.
- **Root Cause**:
  1.  **Race Condition**: Simultaneous GL access during resize.
  2.  **Use-After-Free**: `GLRenderContext` deleted while async cleanup pending.
- **Fixes**:
  - Adopted `std::shared_ptr` for automatic memory management.
  - Implemented `ScopedCGLock` for thread-safe GL access.
  - Added `isDestroying` atomic flag to early-exit render loops during shutdown.
