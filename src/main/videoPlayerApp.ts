import { app, BrowserWindow, BrowserView, screen } from 'electron'
import { readFileSync, writeFileSync, existsSync } from 'fs'
import { join } from 'path'
import { WindowManager } from './windowManager'
import { corePlayer } from './corePlayer'
import { setupIpcHandlers } from './ipcHandlers'

export interface PlaylistItem {
  path: string
  name: string
}

class PlaylistManager {
  private list: PlaylistItem[] = []
  private index: number = -1

  setList(items: PlaylistItem[]) {
    this.list = items
    this.index = items.length > 0 ? 0 : -1
  }

  getList(): PlaylistItem[] {
    return this.list.slice()
  }

  setCurrentByPath(path: string) {
    const idx = this.list.findIndex((item) => item.path === path)
    if (idx >= 0) {
      this.index = idx
    }
  }

  getCurrent(): PlaylistItem | null {
    if (this.index < 0 || this.index >= this.list.length) {
      return null
    }
    return this.list[this.index]
  }

  next(): PlaylistItem | null {
    if (this.list.length === 0 || this.index < 0) {
      return null
    }
    if (this.index >= this.list.length - 1) {
      return null
    }
    this.index += 1
    return this.getCurrent()
  }

  prev(): PlaylistItem | null {
    if (this.list.length === 0 || this.index <= 0) {
      return null
    }
    this.index -= 1
    return this.getCurrent()
  }
}

class ConfigManager {
  private volume: number = 100
  private readonly configPath: string

  constructor() {
    const userData = app.getPath('userData')
    const legacyPath = join(userData, 'mpv-player-config.json')
    const newPath = join(userData, 'video-player-config.json')

    if (existsSync(newPath)) {
      this.configPath = newPath
    } else {
      this.configPath = newPath
      if (existsSync(legacyPath)) {
        try {
          const raw = readFileSync(legacyPath, 'utf-8')
          const data = JSON.parse(raw)
          if (typeof data.volume === 'number') {
            this.volume = data.volume
          }
          writeFileSync(this.configPath, JSON.stringify({ volume: this.volume }), 'utf-8')
        } catch {
        }
      }
    }
    this.load()
  }

  private load() {
    try {
      if (!existsSync(this.configPath)) {
        return
      }
      const raw = readFileSync(this.configPath, 'utf-8')
      const data = JSON.parse(raw)
      if (typeof data.volume === 'number') {
        this.volume = data.volume
      }
    } catch {
    }
  }

  private save() {
    try {
      const data = {
        volume: this.volume
      }
      writeFileSync(this.configPath, JSON.stringify(data), 'utf-8')
    } catch {
    }
  }

  getVolume() {
    return this.volume
  }

  setVolume(value: number) {
    this.volume = value
    this.save()
  }
}

export class VideoPlayerApp {
  readonly windowManager: WindowManager
  readonly playlist: PlaylistManager
  readonly config: ConfigManager
  private controlView: BrowserView | null = null

  constructor() {
    this.windowManager = new WindowManager()
    this.playlist = new PlaylistManager()
    this.config = new ConfigManager()
    corePlayer.onPlayerState((state) => {
      if (state.phase === 'ended') {
        this.playNextFromPlaylist().catch(() => {})
      }
    })
  }

  async play(target: PlaylistItem) {
    const mainWindow = this.windowManager.getWindow('main')
    if (mainWindow && mainWindow.isVisible()) {
      mainWindow.hide()
    }

    const videoWindow = this.createVideoWindow()
    if (!videoWindow) {
      return
    }

    if (!videoWindow.isVisible()) {
      videoWindow.show()
    }
    videoWindow.focus()
    videoWindow.moveTop()

    await new Promise(resolve => setTimeout(resolve, 500))

    if (!videoWindow.isVisible()) {
      videoWindow.show()
      videoWindow.focus()
    }

    corePlayer.setVideoWindow(videoWindow)

    corePlayer.broadcastToPlaybackUIs('play-video', {
      name: target.name,
      path: target.path
    })

    try {
      await corePlayer.play(target.path)
      const volume = this.config.getVolume()
      await corePlayer.setVolume(volume)
      await corePlayer.resume()
      const isEmbedded = corePlayer.isUsingEmbeddedMode()
      videoWindow.webContents.send('player-embedded', {
        embedded: isEmbedded,
        mode: isEmbedded ? 'native' : 'ipc'
      })
    } catch (error) {
      videoWindow.webContents.send('player-error', {
        message: error instanceof Error ? error.message : 'Unknown error'
      })
      videoWindow.webContents.send('player-embedded', {
        embedded: false,
        mode: 'none'
      })
    }
  }

  async playCurrentFromPlaylist() {
    const current = this.playlist.getCurrent()
    if (!current) {
      return
    }
    await this.play(current)
  }

  async playNextFromPlaylist() {
    const item = this.playlist.next()
    if (!item) {
      return
    }
    await this.play(item)
  }

  async playPrevFromPlaylist() {
    const item = this.playlist.prev()
    if (!item) {
      return
    }
    await this.play(item)
  }

  async pause() {
    await corePlayer.pause()
  }

  async resume() {
    const state = corePlayer.getPlayerState()
    if (state.phase === 'ended' || state.phase === 'stopped') {
      await this.playCurrentFromPlaylist()
    } else {
      await corePlayer.resume()
    }
  }

  async stop() {
    await corePlayer.stop()
  }

  async seek(time: number) {
    await corePlayer.seek(time)
  }

  async setVolume(volume: number) {
    this.config.setVolume(volume)
    await corePlayer.setVolume(volume)
  }

  async setHdrEnabled(enabled: boolean) {
    corePlayer.setHdrEnabled(enabled)
  }

  async sendKey(key: string) {
    await corePlayer.sendKey(key)
  }

  createMainWindow() {
    this.windowManager.createWindow({
      id: 'main',
      width: 1200,
      height: 800,
      title: '视频播放器 - 视频列表',
      route: '#/'
    })
  }

  createVideoWindow(): BrowserWindow | undefined {
    const existing = this.windowManager.getWindow('video')
    if (existing && !existing.isDestroyed()) {
      existing.show()
      existing.focus()
      existing.moveTop()
      this.ensureControlView(existing)
      return existing
    }

    const primaryDisplay = screen.getPrimaryDisplay()
    const size = primaryDisplay.workAreaSize
    const videoWidth = 1280
    const videoHeight = 720
    const videoX = Math.floor((size.width - videoWidth) / 2)
    const videoY = Math.floor((size.height - videoHeight) / 2)

    const window = this.windowManager.createWindow({
      id: 'video',
      width: videoWidth,
      height: videoHeight,
      x: videoX,
      y: videoY,
      title: '视频播放器 - 视频播放',
      route: '#/video',
      titleBarStyle: 'hiddenInset',
      frame: true,
      alwaysOnTop: false,
      show: true,
      transparent: true
    })

    this.ensureControlView(window)

    // 在主进程处理按键，避免前端焦点问题
    window.webContents.on('before-input-event', (event, input) => {
      if (input.type !== 'keyDown') return

      // 忽略单独的修饰键
      if (['Control', 'Shift', 'Alt', 'Meta'].includes(input.key)) return
      // 忽略 F12 (开发者工具) 和 F5 (刷新)
      if (input.key === 'F12' || input.key === 'F5') return

      const keyMap: Record<string, string> = {
        ' ': 'SPACE',
        'ArrowLeft': 'LEFT',
        'ArrowRight': 'RIGHT',
        'ArrowUp': 'UP',
        'ArrowDown': 'DOWN',
        'Enter': 'ENTER',
        'Escape': 'ESC',
        'Backspace': 'BS',
        'Tab': 'TAB',
        'Insert': 'INS',
        'Delete': 'DEL',
        'Home': 'HOME',
        'End': 'END',
        'PageUp': 'PGUP',
        'PageDown': 'PGDWN',
        // 媒体键
        'MediaPlayPause': 'PLAYPAUSE',
        'MediaStop': 'STOP',
        'MediaTrackNext': 'NEXT',
        'MediaTrackPrevious': 'PREV',
        'MediaVolumeUp': 'VOLUME_UP',
        'MediaVolumeDown': 'VOLUME_DOWN',
        'MediaVolumeMute': 'MUTE'
      }

      let key = keyMap[input.key] || input.key

      // 处理修饰键
      const modifiers: string[] = []
      if (input.control) modifiers.push('Ctrl')
      if (input.alt) modifiers.push('Alt')
      if (input.meta) modifiers.push('Meta')
      if (input.shift && (key.length > 1 || key === 'SPACE' || key === 'TAB')) {
        modifiers.push('Shift')
      }

      if (modifiers.length > 0) {
        key = `${modifiers.join('+')}+${key}`
      }
      
      // 仅在视频播放界面且不与系统快捷键冲突时发送给 MPV
      if (input.shift && (input.key === 'H' || input.key === 'h')) {
        corePlayer.debugVideoState().catch(() => {})
        return
      }
      corePlayer.sendKey(key)
    })

    window.on('close', async (event) => {
      event.preventDefault()
      await corePlayer.stop()
      window.hide()
      const mainWindow = this.windowManager.getWindow('main')
      if (!mainWindow || mainWindow.isDestroyed()) {
        this.createMainWindow()
      } else {
        if (!mainWindow.isVisible()) {
          mainWindow.show()
        }
        mainWindow.focus()
      }
    })

    if (window && !window.isDestroyed()) {
      window.once('ready-to-show', () => {
        if (!window.isDestroyed()) {
          window.show()
          window.focus()
        }
      })
      if (window.isVisible()) {
        window.focus()
      }
    }

    return window
  }

  private ensureControlView(window: BrowserWindow) {
    if (this.controlView && !this.controlView.webContents.isDestroyed()) {
      return
    }
    const preloadPath = join(__dirname, '../preload/preload.js')
    const view = new BrowserView({
      webPreferences: {
        preload: preloadPath,
        nodeIntegration: false,
        contextIsolation: true,
        backgroundThrottling: false
      }
    })
    view.setBackgroundColor('#00000000')
    window.setBrowserView(view)
    const bounds = window.getContentBounds()
    view.setBounds({ x: 0, y: 0, width: bounds.width, height: bounds.height })
    view.setAutoResize({ width: true, height: true })

    if (process.env.NODE_ENV === 'development') {
      const url = 'http://localhost:5173/#/control'
      view.webContents.loadURL(url).catch(() => {})
      view.webContents.openDevTools({ mode: 'detach' })
    } else {
      view.webContents.loadFile(join(__dirname, '../renderer/index.html'), {
        hash: 'control'
      }).catch(() => {})
    }

    view.webContents.on('did-finish-load', () => {
      const items = this.playlist.getList()
      if (items.length > 0) {
        corePlayer.broadcastToPlaybackUIs('playlist-updated', items)
      }
    })

    window.on('resize', () => {
      const b = window.getContentBounds()
      view.setBounds({ x: 0, y: 0, width: b.width, height: b.height })
    })

    this.controlView = view
    corePlayer.setControlView(view)
  }

  init() {
    app.whenReady().then(() => {
      setupIpcHandlers()
      this.createMainWindow()

      app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
          this.createMainWindow()
        }
      })
    })

    app.on('window-all-closed', () => {
      corePlayer.cleanup().catch(() => {})
      if (process.platform !== 'darwin') {
        app.quit()
      }
    })

    app.on('before-quit', () => {
      corePlayer.cleanup().catch(() => {})
    })

    const handleSignal = (signal: NodeJS.Signals) => {
      console.log(`[Main] Received ${signal}, quitting app...`)
      app.quit()
    }

    process.on('SIGINT', handleSignal)
    process.on('SIGTERM', handleSignal)
  }
}

export const videoPlayerApp = new VideoPlayerApp()
