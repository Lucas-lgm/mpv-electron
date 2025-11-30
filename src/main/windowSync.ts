import { BrowserWindow, app } from 'electron'
import { spawn, ChildProcess } from 'child_process'

/**
 * 窗口同步管理器
 * 用于同步 MPV 窗口和 Electron 窗口的位置和大小
 */

export class WindowSync {
  private videoWindow: BrowserWindow | null = null
  private mpvProcess: ChildProcess | null = null
  private syncInterval: NodeJS.Timeout | null = null

  /**
   * 设置 video 窗口
   */
  setVideoWindow(window: BrowserWindow | null) {
    this.videoWindow = window
    if (window && !window.isDestroyed()) {
      // 监听窗口移动和调整大小
      window.on('move', () => this.syncWindows())
      window.on('resize', () => this.syncWindows())
    }
  }

  /**
   * 设置 MPV 进程
   */
  setMPVProcess(process: ChildProcess | null) {
    this.mpvProcess = process
  }

  /**
   * 同步窗口位置和大小
   * 使用 AppleScript 控制 MPV 窗口位置
   */
  private async syncWindows() {
    if (!this.videoWindow || this.videoWindow.isDestroyed()) {
      return
    }

    try {
      const bounds = this.videoWindow.getBounds()
      
      // 通过 AppleScript 同步 MPV 窗口位置
      // 找到标题包含视频文件名的 MPV 窗口
      const script = `
        tell application "System Events"
          set mpvProcess to first process whose name is "mpv"
          if exists mpvProcess then
            set mpvWindows to windows of mpvProcess
            if (count of mpvWindows) > 0 then
              set mpvWindow to item 1 of mpvWindows
              set position of mpvWindow to {${bounds.x}, ${bounds.y}}
              set size of mpvWindow to {${bounds.width}, ${bounds.height}}
            end if
          end if
        end tell
      `
      
      spawn('osascript', ['-e', script], { stdio: 'ignore' })
    } catch (error) {
      // 忽略错误，避免日志噪音
    }
  }

  /**
   * 开始同步
   */
  start() {
    if (this.syncInterval) {
      clearInterval(this.syncInterval)
    }
    
    // 每 100ms 同步一次
    this.syncInterval = setInterval(() => {
      this.syncWindows()
    }, 100)
  }

  /**
   * 停止同步
   */
  stop() {
    if (this.syncInterval) {
      clearInterval(this.syncInterval)
      this.syncInterval = null
    }
  }

  /**
   * 清理
   */
  cleanup() {
    this.stop()
    this.videoWindow = null
    this.mpvProcess = null
  }
}

export const windowSync = new WindowSync()
