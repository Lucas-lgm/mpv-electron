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
    const videoWidth = 1280
    const videoHeight = 720
    const videoX = Math.floor((width - videoWidth) / 2)
    const videoY = Math.floor((height - videoHeight) / 2)
    
    windowManager.createWindow({
      id: 'video',
      width: videoWidth,
      height: videoHeight,
      x: videoX,
      y: videoY,
      title: 'MPV Player - 视频播放',
      route: '#/video',
      frame: true,
      alwaysOnTop: false
    })
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

app.on('window-all-closed', async () => {
  // 清理 mpv
  const { mpvManager } = await import('./mpvManager')
  await mpvManager.cleanup()
  
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('before-quit', async () => {
  // 应用退出前清理 mpv
  const { mpvManager } = await import('./mpvManager')
  await mpvManager.cleanup()
})
