import { app, BrowserWindow } from 'electron'
import { createCorePlayer } from './core/corePlayer'
import { VideoPlayerApp } from './videoPlayerApp'
import { setupIpcHandlers } from './presentation/ipcHandlers'

let _app: VideoPlayerApp | null = null

export function getVideoPlayerApp(): VideoPlayerApp {
  if (!_app) throw new Error('VideoPlayerApp not initialized. Run runApp() after app.whenReady().')
  return _app
}

export function getWindowManager() {
  return getVideoPlayerApp().windowManager
}

/**
 * 在 app.whenReady 之后创建 CorePlayer、VideoPlayerApp，注册 IPC 与 app 监听。
 * 避免在 import 时初始化 MPV/渲染。
 */
export function runApp() {
  app.whenReady().then(() => {
    const core = createCorePlayer()
    _app = new VideoPlayerApp(core)
    setupIpcHandlers(_app, core)
    _app.createMainWindow()
    _app.registerAppListeners()

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        _app!.createMainWindow()
      }
    })
  })
}
