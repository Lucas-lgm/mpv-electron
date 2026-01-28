import { app, BrowserWindow } from 'electron'
import { createCorePlayer } from './core/corePlayer'
import { VideoPlayerApp } from './videoPlayerApp'
import { setupIpcHandlers } from './command/ipcHandlers'


export function runApp() {
  app.whenReady().then(() => {
    const core = createCorePlayer()
    const videoPlayerApp = new VideoPlayerApp(core)
    setupIpcHandlers(videoPlayerApp, core)
    videoPlayerApp.createMainWindow()
    videoPlayerApp.registerAppListeners()

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        videoPlayerApp.createMainWindow()
      }
    })
  })
}
