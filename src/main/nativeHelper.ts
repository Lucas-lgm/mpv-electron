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
    const nativeHandle = window.getNativeWindowHandle()
    if (!nativeHandle || nativeHandle.length < 8) {
      console.error('[NativeHelper] Failed to get native window handle')
      return null
    }

    // 直接读取指针值（这是窗口句柄）
    const windowPtr = nativeHandle.readBigUInt64LE(0)
    const windowId = Number(windowPtr)
    
    console.log('[NativeHelper] ✅ Got window handle:', windowId)
    console.log('[NativeHelper] Will pass this handle to MPV via --wid parameter')
    
    return windowId
  } catch (error) {
    console.error('[NativeHelper] Error getting window handle:', error)
    return null
  }
}
