import { app, BrowserWindow, BrowserView, screen } from 'electron'
import { readFileSync, writeFileSync, existsSync } from 'fs'
import { join } from 'path'
import { WindowManager } from './windowManager'
import { corePlayer } from './corePlayer'
import { setupIpcHandlers } from './ipcHandlers'
import { ApplicationService } from './application/ApplicationService'
import { Playlist } from './domain/models/Playlist'
import { Media } from './domain/models/Media'

export interface PlaylistItem {
  path: string
  name: string
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
  readonly playlist: Playlist
  readonly config: ConfigManager
  readonly appService: ApplicationService
  private controlView: BrowserView | null = null
  private controlWindow: BrowserWindow | null = null
  private isQuitting: boolean = false
  private windowSyncTimer: NodeJS.Timeout | null = null

  constructor() {
    this.windowManager = new WindowManager()
    this.config = new ConfigManager()
    this.playlist = new Playlist()
    this.appService = new ApplicationService(
      corePlayer.getMediaPlayer(),
      this.playlist
    )
    corePlayer.onPlayerState((state) => {
      if (state.phase === 'ended') this.playNextFromPlaylist().catch(() => {})
    })
  }

  getList(): PlaylistItem[] {
    return this.playlist.getAll().map((e) => ({
      path: e.media.uri,
      name: e.media.displayName
    }))
  }

  setList(items: PlaylistItem[]): void {
    this.playlist.clear()
    for (const it of items) {
      this.playlist.add(Media.create(it.path, { title: it.name }))
    }
    if (items.length > 0) this.playlist.setCurrentByIndex(0)
  }

  setCurrentByPath(path: string): void {
    this.playlist.setCurrentByUri(path)
  }

  getCurrent(): PlaylistItem | null {
    const cur = this.playlist.getCurrent()
    return cur ? { path: cur.media.uri, name: cur.media.displayName } : null
  }

  next(): PlaylistItem | null {
    const n = this.playlist.next()
    return n ? { path: n.media.uri, name: n.media.displayName } : null
  }

  prev(): PlaylistItem | null {
    const p = this.playlist.previous()
    return p ? { path: p.media.uri, name: p.media.displayName } : null
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
      // 发送到视频窗口和控制窗口
      corePlayer.broadcastToPlaybackUIs('player-embedded', {
        embedded: isEmbedded,
        mode: isEmbedded ? 'native' : 'ipc'
      })
    } catch (error) {
      // 发送错误消息到所有窗口
      corePlayer.broadcastToPlaybackUIs('player-error', {
        message: error instanceof Error ? error.message : 'Unknown error'
      })
      corePlayer.broadcastToPlaybackUIs('player-embedded', {
        embedded: false,
        mode: 'none'
      })
    }
  }

  async playCurrentFromPlaylist() {
    const current = this.getCurrent()
    if (!current) return
    await this.play(current)
  }

  async playNextFromPlaylist() {
    const item = this.next()
    if (!item) return
    await this.play(item)
  }

  async playPrevFromPlaylist() {
    const item = this.prev()
    if (!item) return
    await this.play(item)
  }

  async pause() {
    await this.appService.pausePlayback({})
  }

  async resume() {
    const state = corePlayer.getPlayerState()
    if (state.phase === 'ended' || state.phase === 'stopped') {
      await this.playCurrentFromPlaylist()
    } else {
      await this.appService.resumePlayback({})
    }
  }

  async stop() {
    await this.appService.stopPlayback({})
  }

  async seek(time: number) {
    await this.appService.seek({ time })
  }

  async setVolume(volume: number) {
    this.config.setVolume(volume)
    await this.appService.setVolume({ volume })
  }

  async setHdrEnabled(enabled: boolean) {
    corePlayer.setHdrEnabled(enabled)
  }

  async sendKey(key: string) {
    await corePlayer.sendKey(key)
  }

  createMainWindow() {
    const mainWindow = this.windowManager.createWindow({
      id: 'main',
      width: 1200,
      height: 800,
      title: '视频播放器 - 视频列表',
      route: '#/'
    })

    // 监听主窗口关闭事件（使用 once 确保只触发一次）
    mainWindow.once('close', async (event) => {
      if (this.isQuitting) {
        return
      }
      console.log('[VideoPlayerApp] Main window closing')
      this.isQuitting = true
      // 清理资源
      await corePlayer.cleanup().catch(() => {})
      // 退出应用
      app.quit()
      // 注意：在开发模式下，app.quit() 只会退出 Electron 应用，
      // Vite 开发服务器会继续运行。要完全退出开发环境，请在终端按 Ctrl+C
    })

    return mainWindow
  }

  createVideoWindow(): BrowserWindow | undefined {
    const existing = this.windowManager.getWindow('video')
    if (existing && !existing.isDestroyed()) {
      existing.show()
      existing.focus()
      existing.moveTop()
      this.ensureControlWindow(existing)
      return existing
    }

    const primaryDisplay = screen.getPrimaryDisplay()
    const size = primaryDisplay.workAreaSize
    const videoWidth = 1280
    const videoHeight = 720
    const videoX = Math.floor((size.width - videoWidth) / 2)
    const videoY = Math.floor((size.height - videoHeight) / 2)

    // 视频窗口：透明，用于 MPV 渲染
    const windowConfig: any = {
      id: 'video',
      width: videoWidth,
      height: videoHeight,
      x: videoX,
      y: videoY,
      title: '视频播放器 - 视频播放',
      route: '#/video',
      frame: false, // 无边框，更干净
      alwaysOnTop: false,
      show: true,
      transparent: true // 透明，让 MPV 视频可见
    }
    
    const window = this.windowManager.createWindow(windowConfig)

    // 创建控制窗口（透明，跟随视频窗口）
    this.ensureControlWindow(window)

    // 将按键事件转发到控制窗口（如果存在）
    const forwardKeyToControl = (input: Electron.Input) => {
      if (this.controlWindow && !this.controlWindow.isDestroyed()) {
        // 控制窗口会处理按键
        return
      }
    }

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
      // 如果控制窗口存在，优先让控制窗口处理（比如 UI 交互）
      // 否则发送给 MPV
      if (this.controlWindow && !this.controlWindow.isDestroyed() && 
          this.controlWindow.isFocused()) {
        // 控制窗口有焦点时，不发送给 MPV（让 UI 处理）
        return
      }
      corePlayer.sendKey(key)
    })


    window.on('close', async (event) => {
      // 如果应用正在退出，允许窗口关闭
      if (this.isQuitting) {
        // 关闭控制窗口
        if (this.controlWindow && !this.controlWindow.isDestroyed()) {
          this.controlWindow.close()
        }
        if (this.windowSyncTimer) {
          clearInterval(this.windowSyncTimer)
          this.windowSyncTimer = null
        }
        return
      }
      
      event.preventDefault()
      await corePlayer.stop()
      
      // 关闭控制窗口
      if (this.controlWindow && !this.controlWindow.isDestroyed()) {
        this.controlWindow.close()
      }
      if (this.windowSyncTimer) {
        clearInterval(this.windowSyncTimer)
        this.windowSyncTimer = null
      }
      
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

  private ensureControlWindow(videoWindow: BrowserWindow) {
    const videoBounds = videoWindow.getBounds()

    // macOS：单窗口模式，在 videoWindow 上挂一个 BrowserView 作为控制层
    if (process.platform === 'darwin') {
      // 如果 BrowserView 已存在且未销毁，直接复用
      if (this.controlView && !this.controlView.webContents.isDestroyed()) {
        // 更新 bounds 以匹配当前窗口大小
        const bounds = videoWindow.getContentBounds()
        this.controlView.setBounds({ x: 0, y: 0, width: bounds.width, height: bounds.height })
        // 确保 BrowserView 已设置到窗口
        if (videoWindow.getBrowserView() !== this.controlView) {
          videoWindow.setBrowserView(this.controlView)
        }
        // 发送播放列表（如果已加载）
        const items = this.getList()
        if (items.length > 0) {
          this.controlView.webContents.send('playlist-updated', items)
        }
        return
      }

      // 清理旧的 BrowserView（如果存在但已销毁）
      if (this.controlView) {
        try {
          if (!this.controlView.webContents.isDestroyed()) {
            videoWindow.setBrowserView(null)
          }
        } catch {
          // 忽略错误
        }
        this.controlView = null
      }

      // 创建新的 BrowserView
      const preloadPath = join(__dirname, '../preload/preload.js')
      const view = new BrowserView({
        webPreferences: {
          preload: preloadPath,
          nodeIntegration: false,
          contextIsolation: true,
          backgroundThrottling: false,
          enableWebSQL: false
        }
      })
      view.setBackgroundColor('#00000000')
      videoWindow.setBrowserView(view)
      const bounds = videoWindow.getContentBounds()
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

      // 播放列表初始化
      view.webContents.on('did-finish-load', () => {
        const items = this.getList()
        if (items.length > 0) {
          view.webContents.send('playlist-updated', items)
        }
      })

      this.controlView = view
      this.controlWindow = null
      corePlayer.setControlView(view)

      // 注意：不设置 setIgnoreMouseEvents，让 BrowserView 正常接收鼠标事件
      // BrowserView 覆盖整个窗口，可以正常接收所有鼠标事件
      // 设置控制栏自动隐藏（统一处理）
      this.setupControlBarAutoHideForWebContents(view.webContents)
      
      return
    }

    // Windows：双窗口模式，一个视频窗口，一个控制窗口
    if (process.platform === 'win32') {
      // 如果控制窗口已存在且未销毁，直接复用
      if (this.controlWindow && !this.controlWindow.isDestroyed()) {
        // 更新位置和大小以匹配视频窗口
        this.controlWindow.setBounds(videoBounds)
        // 确保控制窗口显示
        if (!this.controlWindow.isVisible()) {
          this.controlWindow.show()
        }
        // 发送播放列表（如果已加载）
        const items = this.getList()
        if (items.length > 0) {
          this.controlWindow.webContents.send('playlist-updated', items)
        }
        // 确保焦点和鼠标事件设置
        setTimeout(() => {
          if (!this.controlWindow?.isDestroyed()) {
            this.controlWindow.focus()
            if (!videoWindow.isDestroyed()) {
              videoWindow.setIgnoreMouseEvents(true)
            }
          }
        }, 100)
        return
      }

      // 清理旧的控制窗口（如果存在但已销毁）
      if (this.controlWindow) {
        try {
          if (!this.controlWindow.isDestroyed()) {
            this.controlWindow.close()
          }
        } catch {
          // 忽略错误
        }
        this.controlWindow = null
      }

      // 创建新的控制窗口（用户操作的主窗口）
      // 使用 parent 字段建立父子关系：videoWindow 是父，controlWindow 是子
      const controlWindow = new BrowserWindow({
        parent: videoWindow,
        width: videoBounds.width,
        height: videoBounds.height,
        x: videoBounds.x,
        y: videoBounds.y,
        transparent: true,
        frame: false,
        focusable: true,
        resizable: true,
        maximizable: true,   // 允许最大化，由同步逻辑带动视频窗口一起变化
        minimizable: true,
        closable: false,
        skipTaskbar: true,
        webPreferences: {
          preload: join(__dirname, '../preload/preload.js'),
          nodeIntegration: false,
          contextIsolation: true,
          backgroundThrottling: false
        }
      })

      // 加载控制界面
      if (process.env.NODE_ENV === 'development') {
        const url = 'http://localhost:5173/#/control'
        controlWindow.loadURL(url).catch(() => {})
        controlWindow.webContents.openDevTools({ mode: 'detach' })
      } else {
        controlWindow.loadFile(join(__dirname, '../renderer/index.html'), {
          hash: 'control'
        }).catch(() => {})
      }

      // 控制窗口加载完成后发送播放列表，并设置焦点
      controlWindow.webContents.on('did-finish-load', () => {
        const items = this.getList()
        if (items.length > 0) {
          controlWindow.webContents.send('playlist-updated', items)
        }
        if (!controlWindow.isDestroyed()) {
          controlWindow.focusable = true
          setTimeout(() => {
            if (!controlWindow.isDestroyed()) {
              controlWindow.focus()
              // 让视频窗口忽略鼠标事件，事件交给控制窗口
              if (!videoWindow.isDestroyed()) {
                videoWindow.setIgnoreMouseEvents(true)
              }
            }
          }, 200)
        }
      })

      // 同步窗口位置和大小：控制窗口 -> 视频窗口
      const syncVideoToControl = () => {
        if (videoWindow.isDestroyed() || controlWindow.isDestroyed()) {
          return
        }
        const bounds = controlWindow.getBounds()
        videoWindow.setBounds(bounds)
        corePlayer.setVideoWindow(videoWindow)
      }

      // 初始同步一次
      syncVideoToControl()

      // 监听控制窗口的位置和大小变化（先移除旧的监听器，避免重复注册）
      controlWindow.removeAllListeners('move')
      controlWindow.removeAllListeners('resize')
      controlWindow.removeAllListeners('moved')
      controlWindow.removeAllListeners('resized')
      controlWindow.on('move', syncVideoToControl)
      controlWindow.on('resize', syncVideoToControl)
      controlWindow.on('moved', syncVideoToControl)
      controlWindow.on('resized', syncVideoToControl)

      // 监听视频窗口显示/隐藏（先移除旧的监听器，避免重复注册）
      videoWindow.removeAllListeners('show')
      videoWindow.removeAllListeners('hide')
      videoWindow.on('show', () => {
        if (!controlWindow.isDestroyed()) {
          controlWindow.show()
          setTimeout(() => {
            if (!controlWindow.isDestroyed()) {
              controlWindow.focus()
              if (!videoWindow.isDestroyed()) {
                videoWindow.setIgnoreMouseEvents(true)
              }
            }
          }, 100)
        }
      })
      videoWindow.on('hide', () => {
        if (!controlWindow.isDestroyed()) {
          controlWindow.hide()
        }
      })

      // 视频窗口关闭时关闭控制窗口（使用 once 避免重复注册）
      videoWindow.removeAllListeners('closed')
      videoWindow.once('closed', () => {
        if (controlWindow && !controlWindow.isDestroyed()) {
          controlWindow.close()
        }
        this.controlWindow = null
      })

      // 控制窗口关闭时清理引用（使用 once 避免重复注册）
      controlWindow.removeAllListeners('closed')
      controlWindow.once('closed', () => {
        this.controlWindow = null
      })

      this.controlWindow = controlWindow
      this.controlView = null
      corePlayer.setControlWindow(controlWindow)

      // 设置控制栏自动隐藏（统一处理）
      this.setupControlBarAutoHideForWebContents(controlWindow.webContents)

      // 启动窗口同步定时器（兜底）
      if (this.windowSyncTimer) {
        clearInterval(this.windowSyncTimer)
      }
      this.windowSyncTimer = setInterval(() => {
        if (videoWindow && !videoWindow.isDestroyed() &&
            controlWindow && !controlWindow.isDestroyed()) {
          syncVideoToControl()
        } else {
          if (this.windowSyncTimer) {
            clearInterval(this.windowSyncTimer)
            this.windowSyncTimer = null
          }
        }
      }, 100)

      return
    }

    // 其他平台：暂时不创建单独的控制窗口（保持简单行为）
  }

  /**
   * 设置控制栏自动隐藏（统一处理，不区分平台）
   * 通过注入 JavaScript 代码监听鼠标事件
   */
  private setupControlBarAutoHideForWebContents(webContents: Electron.WebContents) {
    if (!webContents) return
    
    // 等待页面加载完成后注入鼠标事件监听代码
    webContents.once('did-finish-load', () => {
      webContents.executeJavaScript(`
        (function() {
          let mouseMoveTimer = null;
          const MOUSE_MOVE_DELAY = 100;
          
          // 监听整个窗口的鼠标移动
          document.addEventListener('mousemove', () => {
            if (mouseMoveTimer) {
              clearTimeout(mouseMoveTimer);
            }
            mouseMoveTimer = setTimeout(() => {
              window.electronAPI.send('control-bar-mouse-move');
            }, MOUSE_MOVE_DELAY);
          });
          
          document.addEventListener('mouseleave', () => {
            if (mouseMoveTimer) {
              clearTimeout(mouseMoveTimer);
              mouseMoveTimer = null;
            }
            setTimeout(() => {
              window.electronAPI.send('control-bar-mouse-leave');
            }, 100);
          });
        })();
      `).catch(() => {})
    })
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
      console.log('window-all-closed')
      if (!this.isQuitting) {
        this.isQuitting = true
        corePlayer.cleanup().catch(() => {})
      }
      // 所有平台都退出应用
      app.quit()
    })

    app.on('before-quit', () => {
      this.isQuitting = true
      // corePlayer.cleanup().catch(() => {})
    })

    const handleSignal = async (signal: NodeJS.Signals) => {
      console.log(`[Main] Received ${signal}, quitting app...`)
      this.isQuitting = true
      // 清理资源
      await corePlayer.cleanup().catch(() => {})
      // 关闭所有窗口
      const windows = BrowserWindow.getAllWindows()
      windows.forEach(window => {
        if (!window.isDestroyed()) {
          window.destroy()
        }
      })
      // 强制退出
      app.exit(0)
    }

    process.on('SIGINT', handleSignal)
    process.on('SIGTERM', handleSignal)
  }
}

export const videoPlayerApp = new VideoPlayerApp()
