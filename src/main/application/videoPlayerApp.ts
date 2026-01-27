import { app, BrowserWindow, BrowserView, screen } from 'electron'
import { readFileSync, writeFileSync, existsSync } from 'fs'
import { join } from 'path'
import { WindowManager } from './windows/windowManager'
import type { CorePlayer } from './core/corePlayer'
import { Playlist } from '../domain/models/Playlist'
import { Media } from '../domain/models/Media'
import { createLogger } from '../infrastructure/logging'
import { VIDEO_PLAYER_DELAYS, WINDOW_DELAYS, UI_DELAYS } from './constants'

const logger = createLogger('VideoPlayerApp')

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
  private controlView: BrowserView | null = null
  private controlWindow: BrowserWindow | null = null
  private isQuitting: boolean = false
  private windowSyncTimer: NodeJS.Timeout | null = null

  private readonly onEndedPlayNext = (state: { phase: string }) => {
    if (state.phase === 'ended') this.playNextFromPlaylist().catch(() => {})
  }
  private readonly onVideoTimeUpdate = (payload: unknown) => {
    this.sendToPlaybackUIs('video-time-update', payload)
  }
  private readonly onPlayerStateBroadcast = (state: unknown) => {
    this.sendToPlaybackUIs('player-state', state)
  }

  constructor(private readonly corePlayer: CorePlayer) {
    this.windowManager = new WindowManager()
    this.config = new ConfigManager()
    this.playlist = new Playlist()
    this.corePlayer.onPlayerState(this.onEndedPlayNext)
    this.corePlayer.on('video-time-update', this.onVideoTimeUpdate)
    this.corePlayer.on('player-state', this.onPlayerStateBroadcast)
  }

  private get mediaPlayer() {
    return this.corePlayer.getMediaPlayer()
  }

  /** 播放媒体（原 ApplicationService.playMedia 逻辑内联） */
  async playMedia(opts: {
    mediaUri: string
    mediaName?: string
    options?: { volume?: number; autoResume?: boolean; addToPlaylist?: boolean }
  }): Promise<void> {
    const media = Media.create(opts.mediaUri, { title: opts.mediaName })
    const addToPlaylist = opts.options?.addToPlaylist !== false
    if (addToPlaylist) {
      this.playlist.add(media)
      this.playlist.setCurrentByUri(media.uri)
    }
    await this.mediaPlayer.play(media)
    if (opts.options) {
      if (opts.options.volume !== undefined) {
        await this.mediaPlayer.setVolume(opts.options.volume)
      }
      if (opts.options.autoResume !== false) {
        const session = this.mediaPlayer.getCurrentSession()
        if (session && session.status !== 'playing') {
          await this.mediaPlayer.resume()
        }
      }
    }
  }

  async pausePlayback(): Promise<void> {
    await this.mediaPlayer.pause()
  }

  async resumePlayback(): Promise<void> {
    await this.mediaPlayer.resume()
  }

  async seek(time: number): Promise<void> {
    await this.mediaPlayer.seek(time)
  }

  async setVolume(volume: number): Promise<void> {
    await this.mediaPlayer.setVolume(volume)
    this.config.setVolume(volume)
  }

  async stopPlayback(): Promise<void> {
    await this.mediaPlayer.stop()
  }

  /**
   * 检查当前是否有视频在播放
   * @returns true 如果有视频在播放、加载中、暂停
   */
  private hasActiveVideo(): boolean {
    const state = this.corePlayer.getPlayerState()
    const phase = state.phase
    return phase === 'loading' || 
           phase === 'playing' || 
           phase === 'paused'
  }

  /** 移除对 CorePlayer 的监听，在 cleanup 前调用，避免泄漏 */
  private releaseCorePlayerListeners(): void {
    this.corePlayer.offPlayerState(this.onEndedPlayNext)
    this.corePlayer.off('video-time-update', this.onVideoTimeUpdate)
    this.corePlayer.off('player-state', this.onPlayerStateBroadcast)
  }

  getControlWindow(): BrowserWindow | null {
    return this.controlWindow
  }

  getControlView(): BrowserView | null {
    return this.controlView
  }

  /** 向播放 UI（视频窗口 + 控制栏）广播；职责归 VideoPlayerApp，不经过 CorePlayer */
  private sendToPlaybackUIs(channel: string, payload?: unknown): void {
    const vw = this.windowManager.getWindow('video')
    if (vw && !vw.isDestroyed() && !vw.webContents.isDestroyed()) {
      try {
        vw.webContents.send(channel, payload)
      } catch (error) {
        // 忽略发送失败（窗口可能正在关闭）
      }
    }
    const cw = this.getControlWindow()
    if (cw && !cw.isDestroyed() && !cw.webContents.isDestroyed()) {
      try {
        cw.webContents.send(channel, payload)
      } catch (error) {
        // 忽略发送失败（窗口可能正在关闭）
      }
    }
    const cv = this.getControlView()
    if (cv && !cv.webContents.isDestroyed()) {
      try {
        cv.webContents.send(channel, payload)
      } catch (error) {
        // 忽略发送失败（视图可能正在销毁）
      }
    }
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
    // 如果当前有视频在播放，先停止
    if (this.hasActiveVideo()) {
      try {
        await this.stopPlayback()
        // 等待一小段时间，确保停止操作完成
        await new Promise(resolve => setTimeout(resolve, VIDEO_PLAYER_DELAYS.STOP_WAIT_MS))
      } catch (error) {
        // 停止失败不影响新视频播放，记录错误即可
        logger.error('Failed to stop current video', {
          error: error instanceof Error ? error.message : String(error)
        })
      }
    }

    // UI 层职责：窗口管理
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

    await new Promise(resolve => setTimeout(resolve, VIDEO_PLAYER_DELAYS.VIDEO_WINDOW_SHOW_WAIT_MS))

    if (!videoWindow.isVisible()) {
      videoWindow.show()
      videoWindow.focus()
    }

    // 设置视频窗口（同时设置 MpvMediaPlayer 的 windowId）
    await this.corePlayer.setVideoWindow(videoWindow)

    // 初始化 controller、挂载窗口、setExternalController，供 RenderManager / Timeline 使用
    await this.corePlayer.ensureControllerReadyForPlayback()

    this.sendToPlaybackUIs('play-video', {
      name: target.name,
      path: target.path
    })

    try {
      await this.playMedia({
        mediaUri: target.path,
        mediaName: target.name,
        options: {
          volume: this.config.getVolume(),
          autoResume: true,
          addToPlaylist: false
        }
      })

      const isEmbedded = this.corePlayer.isUsingEmbeddedMode()
      this.sendToPlaybackUIs('player-embedded', {
        embedded: isEmbedded,
        mode: isEmbedded ? 'native' : 'ipc'
      })
    } catch (error) {
      this.sendToPlaybackUIs('player-error', {
        message: error instanceof Error ? error.message : 'Unknown error'
      })
      this.sendToPlaybackUIs('player-embedded', {
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

  async setHdrEnabled(enabled: boolean) {
    this.corePlayer.setHdrEnabled(enabled)
  }

  /** 向播放 UI 广播当前播放列表（ipcHandlers 仅触发） */
  broadcastPlaylistUpdated(): void {
    this.sendToPlaybackUIs('playlist-updated', this.getList())
  }

  async sendKey(key: string) {
    await this.corePlayer.sendKey(key)
  }

  // ========== IPC 层调用的业务方法（封装业务逻辑，避免 ipcHandlers 包含业务） ==========

  /** 处理 play-video IPC：添加到列表（如不存在）、设为当前、播放、广播列表更新 */
  async handlePlayVideo(file: { name: string; path: string }): Promise<void> {
    const currentList = this.getList()
    if (!currentList.some(item => item.path === file.path)) {
      this.setList([...currentList, { name: file.name, path: file.path }])
    }
    this.setCurrentByPath(file.path)
    await this.play({ path: file.path, name: file.name })
    this.broadcastPlaylistUpdated()
  }

  /** 处理 play-url IPC：设置列表、播放、广播列表更新 */
  async handlePlayUrl(url: string): Promise<void> {
    const item: PlaylistItem = { path: url, name: url }
    this.setList([item])
    this.setCurrentByPath(item.path)
    await this.play(item)
    this.broadcastPlaylistUpdated()
  }

  /** 处理 control-play IPC：根据状态决定是播放当前项还是恢复播放 */
  async handleControlPlay(): Promise<void> {
    const state = this.corePlayer.getPlayerState()
    if (state.phase === 'ended' || state.phase === 'stopped') {
      await this.playCurrentFromPlaylist()
    } else {
      await this.resumePlayback()
    }
  }

  /** 处理文件选择结果：广播到主窗口 */
  handleFileSelected(file: { name: string; path: string }): void {
    const mainWindow = this.windowManager.getWindow('main')
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('video-file-selected', file)
    }
  }

  /** 切换全屏（封装窗口操作逻辑） */
  toggleFullscreen(): void {
    const videoWindow = this.windowManager.getWindow('video')
    if (!videoWindow) return

    const controlWindow = this.getControlWindow()
    const isFullscreen = !videoWindow.isFullScreen()

    videoWindow.setFullScreen(isFullscreen)

    if (process.platform === 'win32' && controlWindow && !controlWindow.isDestroyed()) {
      controlWindow.setFullScreen(isFullscreen)
    }
  }

  /** 窗口操作（封装窗口操作逻辑） */
  windowAction(action: 'close' | 'minimize' | 'maximize'): void {
    const videoWindow = this.windowManager.getWindow('video')
    if (!videoWindow) {
      logger.warn('windowAction: video window not found', { action })
      return
    }

    const controlWindow = this.getControlWindow()
    
    // Windows 上：操作控制窗口（它会同步到视频窗口）
    // 其他平台：直接操作视频窗口
    const targetWindow =
      process.platform === 'win32' && controlWindow && !controlWindow.isDestroyed()
        ? controlWindow
        : videoWindow

    logger.debug('windowAction', {
      action,
      platform: process.platform,
      hasControlWindow: !!controlWindow,
      targetWindow: targetWindow === controlWindow ? 'controlWindow' : 'videoWindow',
      videoWindowDestroyed: videoWindow.isDestroyed(),
      controlWindowDestroyed: controlWindow ? controlWindow.isDestroyed() : 'N/A'
    })

    switch (action) {
      case 'close':
        // Windows 上：关闭控制窗口，它会触发关闭父窗口（videoWindow）
        // 其他平台：直接关闭视频窗口
        if (process.platform === 'win32' && targetWindow === controlWindow && controlWindow) {
          logger.debug('Closing control window (Windows)')
          controlWindow.close()
        } else {
          logger.debug('Closing video window')
          videoWindow.close()
        }
        break
      case 'minimize':
        if (targetWindow.isMinimizable()) {
          logger.debug('Minimizing window', { target: targetWindow === controlWindow ? 'controlWindow' : 'videoWindow' })
          targetWindow.minimize()
          // Windows 上，如果控制窗口最小化，视频窗口也应该最小化
          if (process.platform === 'win32' && targetWindow === controlWindow && videoWindow.isMinimizable()) {
            logger.debug('Also minimizing video window (Windows)')
            videoWindow.minimize()
          }
        } else {
          logger.warn('Window is not minimizable', { target: targetWindow === controlWindow ? 'controlWindow' : 'videoWindow' })
        }
        break
      case 'maximize':
        if (targetWindow.isMaximizable()) {
          if (targetWindow.isMaximized()) {
            logger.debug('Unmaximizing window', { target: targetWindow === controlWindow ? 'controlWindow' : 'videoWindow' })
            targetWindow.unmaximize()
            // Windows 上，如果控制窗口取消最大化，视频窗口也应该取消最大化
            if (process.platform === 'win32' && targetWindow === controlWindow && videoWindow.isMaximizable()) {
              logger.debug('Also unmaximizing video window (Windows)')
              videoWindow.unmaximize()
            }
          } else {
            logger.debug('Maximizing window', { target: targetWindow === controlWindow ? 'controlWindow' : 'videoWindow' })
            targetWindow.maximize()
            // Windows 上，如果控制窗口最大化，视频窗口也应该最大化
            if (process.platform === 'win32' && targetWindow === controlWindow && videoWindow.isMaximizable()) {
              logger.debug('Also maximizing video window (Windows)')
              videoWindow.maximize()
            }
          }
        } else {
          logger.warn('Window is not maximizable', { target: targetWindow === controlWindow ? 'controlWindow' : 'videoWindow' })
        }
        break
    }
  }

  /** 控制栏显示（封装广播逻辑） */
  showControlBar(): void {
    const controlView = this.getControlView()
    const controlWindow = this.getControlWindow()
    if (process.platform === 'darwin' && controlView && !controlView.webContents.isDestroyed()) {
      controlView.webContents.send('control-bar-show')
    } else if (process.platform === 'win32' && controlWindow && !controlWindow.isDestroyed() && controlWindow.webContents) {
      controlWindow.webContents.send('control-bar-show')
    }
  }

  /** 控制栏计划隐藏（封装广播逻辑） */
  scheduleHideControlBar(): void {
    const controlView = this.getControlView()
    const controlWindow = this.getControlWindow()
    if (process.platform === 'darwin' && controlView && !controlView.webContents.isDestroyed()) {
      controlView.webContents.send('control-bar-schedule-hide')
    } else if (process.platform === 'win32' && controlWindow && !controlWindow.isDestroyed() && controlWindow.webContents) {
      controlWindow.webContents.send('control-bar-schedule-hide')
    }
  }

  /** 转发视频时间更新到视频窗口（用于 renderer → main → video window 的转发） */
  forwardVideoTimeUpdate(data: { currentTime: number; duration: number }): void {
    const videoWindow = this.windowManager.getWindow('video')
    if (videoWindow) {
      videoWindow.webContents.send('video-time-update', data)
    }
  }

  /** 转发视频结束到视频窗口 */
  forwardVideoEnded(): void {
    const videoWindow = this.windowManager.getWindow('video')
    if (videoWindow) {
      videoWindow.webContents.send('video-ended')
    }
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
      logger.debug('Main window closing')
      this.isQuitting = true
      this.releaseCorePlayerListeners()
      await this.corePlayer.cleanup().catch(() => {})
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
        this.corePlayer.debugVideoState().catch(() => {})
        return
      }
      // 如果控制窗口存在，优先让控制窗口处理（比如 UI 交互）
      // 否则发送给 MPV
      if (this.controlWindow && !this.controlWindow.isDestroyed() && 
          this.controlWindow.isFocused()) {
        // 控制窗口有焦点时，不发送给 MPV（让 UI 处理）
        return
      }
      this.corePlayer.sendKey(key)
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
      await this.corePlayer.stop()
      
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
      this.corePlayer.setControlView(view)

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
        }, UI_DELAYS.CONTROL_BAR_HIDE_DELAY_MS)
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
        closable: true,      // 允许关闭（通过 windowAction 处理）
        skipTaskbar: true,
        webPreferences: {
          preload: join(__dirname, '../preload/preload.js'),
          nodeIntegration: false,
          contextIsolation: true,
          backgroundThrottling: false
        }
      })
      
      // 显式设置窗口控制属性（确保在 Windows 上生效）
      controlWindow.setClosable(true)
      controlWindow.setMinimizable(true)
      controlWindow.setMaximizable(true)
      controlWindow.setResizable(true)

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
        if (items.length > 0 && !controlWindow.isDestroyed() && !controlWindow.webContents.isDestroyed()) {
          try {
            controlWindow.webContents.send('playlist-updated', items)
          } catch (error) {
            // 忽略发送失败
          }
        }
        if (!controlWindow.isDestroyed()) {
          // 再次确保窗口控制属性已设置（在窗口加载完成后）
          controlWindow.setClosable(true)
          controlWindow.setMinimizable(true)
          controlWindow.setMaximizable(true)
          controlWindow.setResizable(true)
          
          controlWindow.focusable = true
          setTimeout(() => {
            if (!controlWindow.isDestroyed()) {
              controlWindow.focus()
              // 让视频窗口忽略鼠标事件，事件交给控制窗口
              if (!videoWindow.isDestroyed()) {
                videoWindow.setIgnoreMouseEvents(true)
              }
            }
          }, WINDOW_DELAYS.FOCUS_DELAY_MS)
        }
      })
      
      // 监听窗口的 ready-to-show 事件，再次确保属性设置
      controlWindow.once('ready-to-show', () => {
        if (!controlWindow.isDestroyed()) {
          controlWindow.setClosable(true)
          controlWindow.setMinimizable(true)
          controlWindow.setMaximizable(true)
          controlWindow.setResizable(true)
        }
      })

      // 同步窗口位置和大小：控制窗口 -> 视频窗口
      const syncVideoToControl = () => {
        if (videoWindow.isDestroyed() || controlWindow.isDestroyed()) {
          return
        }
        const bounds = controlWindow.getBounds()
        videoWindow.setBounds(bounds)
        // 注意：不需要重新设置 windowId，窗口已通过 setVideoWindow 设置
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
          }, UI_DELAYS.CONTROL_BAR_HIDE_DELAY_MS)
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

      // 控制窗口关闭时关闭父窗口（videoWindow）并清理引用
      // 注意：在 Electron 中，子窗口关闭时不会自动关闭父窗口，需要手动处理
      controlWindow.removeAllListeners('closed')
      controlWindow.once('closed', () => {
        this.controlWindow = null
        // 关闭父窗口（videoWindow）
        if (videoWindow && !videoWindow.isDestroyed()) {
          videoWindow.close()
        }
      })
      
      // 监听控制窗口的 close 事件（在窗口实际关闭前触发）
      // 这样可以确保在窗口关闭前清理资源
      controlWindow.removeAllListeners('close')
      controlWindow.on('close', (event) => {
        // 在 Windows 上，如果控制窗口关闭，确保父窗口也关闭
        if (process.platform === 'win32' && videoWindow && !videoWindow.isDestroyed()) {
          // 不阻止默认行为，让窗口正常关闭
          // 父窗口会在 closed 事件中关闭
        }
      })

      this.controlWindow = controlWindow
      this.controlView = null
      this.corePlayer.setControlWindow(controlWindow)

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
      }, WINDOW_DELAYS.SYNC_INTERVAL_MS)

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
          const MOUSE_MOVE_DELAY = ${UI_DELAYS.MOUSE_MOVE_DELAY_MS};
          
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
            }, ${UI_DELAYS.CONTROL_BAR_HIDE_DELAY_MS});
          });
        })();
      `).catch(() => {})
    })
  }

  /** 注册 app 生命周期与进程信号监听（由 bootstrap 在 whenReady 之后调用） */
  registerAppListeners() {
    app.on('window-all-closed', () => {
      if (!this.isQuitting) {
        this.isQuitting = true
        this.releaseCorePlayerListeners()
        this.corePlayer.cleanup().catch(() => {})
      }
      app.quit()
    })
    app.on('before-quit', () => {
      this.isQuitting = true
    })
    const handleSignal = async (signal: NodeJS.Signals) => {
      logger.info(`Received ${signal}, quitting app`)
      this.isQuitting = true
      this.releaseCorePlayerListeners()
      await this.corePlayer.cleanup().catch(() => {})
      const windows = BrowserWindow.getAllWindows()
      windows.forEach((w) => {
        if (!w.isDestroyed()) w.destroy()
      })
      app.exit(0)
    }
    process.on('SIGINT', handleSignal)
    process.on('SIGTERM', handleSignal)
  }
}
