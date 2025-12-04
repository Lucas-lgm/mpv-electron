import { app, BrowserWindow, screen } from 'electron'
import { WindowManager } from './windowManager'
import { setupIpcHandlers } from './ipcHandlers'

const windowManager = new WindowManager()

// 导出 windowManager 供 IPC 使用
export { windowManager }

function createMainWindow() {
  // 主窗口 - 显示所有视频文件
  windowManager.createWindow({
    id: 'main',
    width: 1200,
    height: 800,
    title: 'MPV Player - 视频列表',
    route: '#/'
  })
}

function createVideoWindow() {
  // 视频窗口 - 用于渲染视频（包含控制面板 overlay）
  if (!windowManager.getWindow('video')) {
    const primaryDisplay = screen.getPrimaryDisplay()
    const { width, height } = primaryDisplay.workAreaSize
    
    // 视频窗口居中
    const videoWidth = 680
    const videoHeight = 200
    const videoX = Math.floor((width - videoWidth) / 2)
    const videoY = Math.floor((height - videoHeight) / 2)
    
    const window = windowManager.createWindow({
      id: 'video',
      width: videoWidth,
      height: videoHeight,
      x: videoX,
      y: videoY,
      title: 'MPV Player - 视频播放',
      route: '#/video',
      titleBarStyle: 'hiddenInset',
      frame: true,
      alwaysOnTop: false,
      show: true, // 立即显示窗口
      transparent: true // 必须透明才能看到底层 OpenGL 渲染（macOS 上透明窗口会失去边框，这是系统限制）
    })
    
    // 确保窗口显示
    if (window && !window.isDestroyed()) {
      window.once('ready-to-show', () => {
        if (!window.isDestroyed()) {
          window.show()
          window.focus()
          console.log('[Main] Video window ready and shown')
        }
      })
      
      // 如果窗口已经准备好了，立即显示
      if (window.isVisible()) {
        window.focus()
      }
    }
    
    return window
  } else {
    // 如果窗口已存在，确保它显示
    const existingWindow = windowManager.getWindow('video')
    if (existingWindow && !existingWindow.isDestroyed()) {
      existingWindow.show()
      existingWindow.focus()
      existingWindow.moveTop()
    }
  }
}

app.whenReady().then(() => {
  setupIpcHandlers()
  createMainWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow()
    }
  })
})

// 导出函数供 IPC 使用
export { createVideoWindow }

app.on('window-all-closed', () => {
  // 异步清理 mpv，不阻塞主线程退出
  import('./mpvManager')
    .then(({ mpvManager }) => mpvManager.cleanup().catch(err => {
      console.error('[Main] mpv cleanup error:', err)
    }))

  // 不再区分 macOS，关掉最后一个窗口就退出
  app.quit()
})

app.on('before-quit', () => {
  // 应用退出前清理 mpv，同样异步甩出去
  import('./mpvManager')
    .then(({ mpvManager }) => mpvManager.cleanup().catch(err => {
      console.error('[Main] mpv cleanup error (before-quit):', err)
    }))
})

// 在开发环境下，终端发来的 SIGINT/SIGTERM 也主动退出应用
const handleSignal = (signal: NodeJS.Signals) => {
  console.log(`[Main] Received ${signal}, quitting app...`)
  app.quit()
}

process.on('SIGINT', handleSignal)
process.on('SIGTERM', handleSignal)
