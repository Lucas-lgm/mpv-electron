import { MPVController } from './mpvController'
import { BrowserWindow } from 'electron'

class MPVManager {
  private controller: MPVController | null = null
  private videoWindow: BrowserWindow | null = null

  /**
   * 设置视频窗口
   */
  setVideoWindow(window: BrowserWindow | null) {
    this.videoWindow = window
  }

  /**
   * 获取或创建 MPV 控制器
   */
  getController(): MPVController | null {
    return this.controller
  }

  /**
   * 启动 MPV 并播放视频
   */
  async playVideo(filePath: string): Promise<void> {
    // 如果已有控制器，先关闭
    if (this.controller) {
      await this.controller.quit()
      this.controller = null
    }

    // 获取视频窗口的 native 窗口 ID（用于嵌入 mpv）
    let windowId: number | undefined
    if (this.videoWindow && !this.videoWindow.isDestroyed()) {
      // macOS 上，需要等待窗口准备好
      await new Promise(resolve => setTimeout(resolve, 200))
      
      // 在 macOS 上，Electron 的 getNativeWindowHandle 返回的是 NSWindow 的指针
      // 但 mpv 的 --wid 需要的是 NSView 的指针（通常是 contentView）
      // 我们需要通过 native API 获取 contentView
      try {
        // 使用 Electron 的 nativeImage 或其他方式获取 contentView
        // 实际上，在 macOS 上，我们可以直接使用窗口的 webContents 的 native view
        const nativeHandle = this.videoWindow.getNativeWindowHandle()
        if (nativeHandle && nativeHandle.length >= 8) {
          // macOS 上，尝试获取 contentView
          // 注意：这需要 native 模块支持，或者我们可以尝试直接使用窗口句柄
          // 对于 mpv，在 macOS 上 --wid 需要的是 NSView 指针
          // Electron 返回的是 NSWindow，我们需要获取其 contentView
          // 暂时先尝试使用窗口句柄，如果不行再调整
          const windowPtr = nativeHandle.readBigUInt64LE(0)
          // 在 macOS 上，mpv 可能需要 contentView，但我们可以先尝试窗口句柄
          windowId = Number(windowPtr)
          console.log('Window ID for mpv (NSWindow pointer):', windowId)
        }
      } catch (error) {
        console.error('Failed to get window ID:', error)
      }
    }

    // 创建新的控制器（不尝试嵌入，让 mpv 使用独立窗口）
    this.controller = new MPVController()

    // 监听状态更新（状态会通过 IPC 在主进程中转发到控制窗口）

    // 启动 mpv
    await this.controller.start(filePath)
  }

  /**
   * 暂停/播放
   */
  async togglePause(): Promise<void> {
    if (this.controller) {
      await this.controller.togglePause()
    }
  }

  /**
   * 暂停
   */
  async pause(): Promise<void> {
    if (this.controller) {
      await this.controller.pause()
    }
  }

  /**
   * 播放
   */
  async play(): Promise<void> {
    if (this.controller) {
      await this.controller.play()
    }
  }

  /**
   * 跳转
   */
  async seek(time: number): Promise<void> {
    if (this.controller) {
      await this.controller.seek(time)
    }
  }

  /**
   * 设置音量
   */
  async setVolume(volume: number): Promise<void> {
    if (this.controller) {
      await this.controller.setVolume(volume)
    }
  }

  /**
   * 停止
   */
  async stop(): Promise<void> {
    if (this.controller) {
      await this.controller.stop()
    }
  }

  /**
   * 获取状态
   */
  getStatus() {
    return this.controller?.getStatus() || null
  }

  /**
   * 清理
   */
  async cleanup(): Promise<void> {
    if (this.controller) {
      await this.controller.quit()
      this.controller = null
    }
  }
}

export const mpvManager = new MPVManager()

