import { BrowserWindow } from 'electron'

/**
 * 获取窗口的句柄（macOS）
 * 直接使用 Electron 返回的窗口句柄，不进行编译
 * 将窗口句柄传递给 MPV，让 MPV 在指定的窗口中渲染
 * 
 * @param window Electron BrowserWindow 实例
 * @returns 窗口句柄（数字），直接返回给 MPV 使用
 */
export function getNSViewPointer(window: BrowserWindow): number | null {
  if (process.platform !== 'darwin') {
    console.warn('[NativeHelper] Only supported on macOS')
    return null
  }

  try {
    // 确保窗口存在
    if (!window || window.isDestroyed()) {
      console.error('[NativeHelper] Window is destroyed or invalid')
      return null
    }

    // 获取窗口句柄（Electron 返回的 native handle）
    // 在 macOS 上，getNativeWindowHandle() 返回的是 NSView* (content view)
    const nativeHandle = window.getNativeWindowHandle()
    if (!nativeHandle || nativeHandle.length < 8) {
      console.error('[NativeHelper] Failed to get native window handle')
      return null
    }

    // 直接读取指针值（这是 NSView* 的指针值）
    const viewPtr = nativeHandle.readBigUInt64LE(0)
    const viewId = Number(viewPtr)
    
    console.log('[NativeHelper] ✅ Got NSView pointer:', viewId)
    console.log('[NativeHelper] This is the content view of the Electron window')
    console.log('[NativeHelper] Will attach OpenGL context to this view for mpv rendering')
    
    return viewId
  } catch (error) {
    console.error('[NativeHelper] Error getting window handle:', error)
    return null
  }
}

/**
 * 获取窗口的句柄（Windows）
 * 获取 HWND 并传递给 MPV，用于 wid 嵌入模式
 * 
 * @param window Electron BrowserWindow 实例
 * @returns 窗口句柄（HWND，数字），用于设置 mpv 的 wid 选项
 */
export function getHWNDPointer(window: BrowserWindow): number | null {
  if (process.platform !== 'win32') {
    console.warn('[NativeHelper] Only supported on Windows')
    return null
  }

  try {
    // 确保窗口存在
    if (!window || window.isDestroyed()) {
      console.error('[NativeHelper] Window is destroyed or invalid')
      return null
    }

    // 获取窗口句柄（Electron 返回的 native handle）
    // 在 Windows 上，getNativeWindowHandle() 返回的是 HWND
    const nativeHandle = window.getNativeWindowHandle()
    if (!nativeHandle || nativeHandle.length < 4) {
      console.error('[NativeHelper] Failed to get native window handle')
      return null
    }

    // Windows 上，HWND 是 32 位或 64 位指针
    // 在 64 位系统上，使用 readBigUInt64LE，在 32 位系统上使用 readUInt32LE
    let hwnd: number
    if (process.arch === 'x64' || process.arch === 'arm64') {
      hwnd = Number(nativeHandle.readBigUInt64LE(0))
    } else {
      hwnd = nativeHandle.readUInt32LE(0)
    }
    
    console.log('[NativeHelper] ✅ Got HWND:', hwnd)
    console.log('[NativeHelper] Will use wid mode for mpv rendering')
    
    return hwnd
  } catch (error) {
    console.error('[NativeHelper] Error getting window handle:', error)
    return null
  }
}
