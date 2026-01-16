import { BrowserWindow, BrowserView, screen } from 'electron'
import { PlayerStateMachine, type PlayerState, type PlayerPhase } from './playerState'
import type { MPVStatus } from './libmpv'
import { LibMPVController, isLibMPVAvailable } from './libmpv'
import { getNSViewPointer } from './nativeHelper'
import { Timeline } from './timeline'

export interface CorePlayer {
  setVideoWindow(window: BrowserWindow | null): void
  setControlView(view: BrowserView | null): void
  play(filePath: string): Promise<void>
  pause(): Promise<void>
  resume(): Promise<void>
  stop(): Promise<void>
  seek(time: number): Promise<void>
  setVolume(volume: number): Promise<void>
  isUsingEmbeddedMode(): boolean
  cleanup(): Promise<void>
  getPlayerState(): PlayerState
  onPlayerState(listener: (state: PlayerState) => void): void
  offPlayerState(listener: (state: PlayerState) => void): void
  broadcastToPlaybackUIs(channel: string, payload?: any): void
}

class CorePlayerImpl implements CorePlayer {
  private controller: LibMPVController | null = null
  private videoWindow: BrowserWindow | null = null
  private useLibMPV: boolean = false
  private isCleaningUp: boolean = false
  private initPromise: Promise<void> | null = null
  private stateMachine = new PlayerStateMachine()
  private timeline: Timeline | null = null
  private pendingResizeTimer: NodeJS.Timeout | null = null
  private lastPhysicalWidth: number = -1
  private lastPhysicalHeight: number = -1
  private controlView: BrowserView | null = null

  constructor() {
    if (isLibMPVAvailable()) {
      this.controller = new LibMPVController()
      this.initPromise = this.controller.initialize().catch(() => {
        this.controller = null
        this.initPromise = null
      })
    }
    this.timeline = new Timeline({
      interval: 100,
      getStatus: () => this.getStatus(),
      send: (payload) => {
        this.sendToPlaybackUIs('video-time-update', payload)
      }
    })
    this.stateMachine.on('state', (st) => {
      this.timeline?.handlePlayerStateChange(st.phase)
    })
  }

  setVideoWindow(window: BrowserWindow | null) {
    if (this.videoWindow && !this.videoWindow.isDestroyed()) {
      this.videoWindow.removeAllListeners('resize')
    }
    this.videoWindow = window
  }
  setControlView(view: BrowserView | null) {
    this.controlView = view
  }

  isUsingEmbeddedMode(): boolean {
    return this.useLibMPV
  }

  async play(filePath: string): Promise<void> {
    if (this.isCleaningUp) {
      return
    }
    let windowId: number | undefined
    this.stateMachine.setPhase('loading')
    if (this.videoWindow && !this.videoWindow.isDestroyed()) {
      try {
        if (!this.videoWindow.isVisible()) {
          this.videoWindow.show()
        }
        this.videoWindow.focus()
        await new Promise(resolve => setTimeout(resolve, 300))
        if (this.videoWindow.isDestroyed()) {
        } else {
          const windowHandle = getNSViewPointer(this.videoWindow)
          if (windowHandle) {
            windowId = windowHandle
          }
        }
      } catch {
      }
    }
    if (isLibMPVAvailable() && windowId) {
      this.useLibMPV = true
      try {
        if (!this.controller) {
          this.controller = new LibMPVController()
          this.initPromise = this.controller.initialize()
        }
        if (this.initPromise) {
          await this.initPromise
          this.initPromise = null
        }
        await this.controller.setWindowId(windowId)
        await this.syncWindowSize()
        this.setupResizeHandler()
        await this.controller.loadFile(filePath)
        await this.syncWindowSize()
        this.setupEventHandlers()
        this.stateMachine.setPhase('playing')
        return
      } catch {
        this.useLibMPV = false
      }
    }
  }

  private async syncWindowSize(): Promise<void> {
    if (!this.videoWindow || this.videoWindow.isDestroyed() || !this.controller) {
      return
    }
    const bounds = this.videoWindow.getContentBounds()
    const display = screen.getDisplayMatching(this.videoWindow.getBounds())
    const scaleFactor = display.scaleFactor
    const width = Math.round(bounds.width * scaleFactor)
    const height = Math.round(bounds.height * scaleFactor)
    if (this.controller instanceof LibMPVController) {
      await this.controller.setWindowSize(width, height)
    }
  }

  private setupResizeHandler(): void {
    if (!this.videoWindow || this.videoWindow.isDestroyed()) {
      return
    }
    this.videoWindow.removeAllListeners('resize')
    this.videoWindow.on('resize', () => {
      this.scheduleWindowSizeSync()
    })
  }

  private scheduleWindowSizeSync(): void {
    if (this.pendingResizeTimer) {
      clearTimeout(this.pendingResizeTimer)
    }
    this.pendingResizeTimer = setTimeout(() => {
      this.pendingResizeTimer = null
      this.syncWindowSizeThrottled().catch(() => {})
    }, 16)
  }

  private async syncWindowSizeThrottled(): Promise<void> {
    if (!this.videoWindow || this.videoWindow.isDestroyed() || !this.controller) {
      return
    }
    const bounds = this.videoWindow.getContentBounds()
    const display = screen.getDisplayMatching(this.videoWindow.getBounds())
    const scaleFactor = display.scaleFactor
    const width = Math.round(bounds.width * scaleFactor)
    const height = Math.round(bounds.height * scaleFactor)
    if (width === this.lastPhysicalWidth && height === this.lastPhysicalHeight) {
      return
    }
    this.lastPhysicalWidth = width
    this.lastPhysicalHeight = height
    if (this.controller instanceof LibMPVController) {
      await this.controller.setWindowSize(width, height)
    }
  }

  private setupEventHandlers(): void {
    if (!this.controller) return
    const videoWindow = this.videoWindow
    if (!videoWindow) return
    this.controller.on('status', (status: MPVStatus) => {
      this.updateFromMPVStatus(status)
      this.sendToPlaybackUIs('player-state', this.getPlayerState())
    })
    ;(this.controller as any).on('error', (error: any) => {
      if (error instanceof Error && error.message) {
        this.setError(error.message)
      } else {
        this.setError('Unknown error')
      }
      this.sendToPlaybackUIs('player-error', {
        message: error instanceof Error ? error.message : 'Unknown error'
      })
      this.sendToPlaybackUIs('player-state', this.getPlayerState())
    })
    ;(this.controller as any).on('ended', () => {
      this.stateMachine.setPhase('ended')
      this.sendToPlaybackUIs('video-ended')
      this.sendToPlaybackUIs('player-state', this.getPlayerState())
    })
    ;(this.controller as any).on('stopped', () => {
      this.stateMachine.setPhase('stopped')
      this.sendToPlaybackUIs('player-state', this.getPlayerState())
    })
  }

  async togglePause(): Promise<void> {
    if (this.controller) {
      await this.controller.togglePause()
      const status = this.controller.getStatus()
      if (status) {
        this.updateFromMPVStatus(status as MPVStatus)
      }
    }
  }

  async pause(): Promise<void> {
    if (this.controller) {
      await this.controller.pause()
      this.stateMachine.setPhase('paused')
    }
  }

  async resume(): Promise<void> {
    if (this.controller) {
      await this.controller.play()
      this.stateMachine.setPhase('playing')
    }
  }

  async seek(time: number): Promise<void> {
    if (!this.controller) {
      return
    }
    this.timeline?.markSeek(time)
    await this.controller.seek(time)
    const status = this.controller.getStatus()
    if (status) {
      this.updateFromMPVStatus(status as MPVStatus)
      await this.timeline?.broadcastTimeline({ currentTime: time, duration: status.duration })
      this.sendToPlaybackUIs('player-state', this.getPlayerState())
    }
  }

  async setVolume(volume: number): Promise<void> {
    if (this.controller) {
      await this.controller.setVolume(volume)
      const status = this.controller.getStatus()
      if (status) {
        this.updateFromMPVStatus(status as MPVStatus)
      }
    }
  }

  async stop(): Promise<void> {
    if (this.controller) {
      await this.controller.stop()
      this.stateMachine.setPhase('stopped')
    }
  }

  getStatus() {
    return this.controller?.getStatus() || null
  }

  async cleanup(): Promise<void> {
    if (this.isCleaningUp) {
      return
    }
    this.isCleaningUp = true
    try {
      if (this.pendingResizeTimer) {
        clearTimeout(this.pendingResizeTimer)
        this.pendingResizeTimer = null
      }
      this.timeline?.dispose()
      if (this.controller) {
        if (this.controller instanceof LibMPVController) {
          await this.controller.destroy()
        }
        this.controller = null
      }
      this.controlView = null
    } finally {
      this.isCleaningUp = false
    }
  }

  updateFromMPVStatus(status: MPVStatus) {
    console.log('status', status);
    this.stateMachine.updateFromStatus(status)
  }

  setPhase(phase: PlayerPhase) {
    this.stateMachine.setPhase(phase)
  }

  setError(message: string) {
    this.stateMachine.setError(message)
  }

  getPlayerState(): PlayerState {
    return this.stateMachine.getState()
  }

  onPlayerState(listener: (state: PlayerState) => void) {
    this.stateMachine.on('state', listener)
  }

  offPlayerState(listener: (state: PlayerState) => void) {
    this.stateMachine.off('state', listener)
  }

  private sendToPlaybackUIs(channel: string, payload?: any) {
    const vw = this.videoWindow
    if (vw && !vw.isDestroyed()) {
      vw.webContents.send(channel, payload)
    }
    const cv = this.controlView
    if (cv && !cv.webContents.isDestroyed()) {
      cv.webContents.send(channel, payload)
    }
  }

  broadcastToPlaybackUIs(channel: string, payload?: any) {
    this.sendToPlaybackUIs(channel, payload)
  }
}

export const corePlayer: CorePlayer = new CorePlayerImpl()

export function setCorePlayerBackend(impl: CorePlayer) {
  Object.assign(corePlayer, impl)
}

export function updateFromMPVStatus(status: MPVStatus) {
  ;(corePlayer as CorePlayerImpl).updateFromMPVStatus(status)
}

export function setPhase(phase: PlayerPhase) {
  ;(corePlayer as CorePlayerImpl).setPhase(phase)
}

export function getPlayerState(): PlayerState {
  return corePlayer.getPlayerState()
}

export function onPlayerState(listener: (state: PlayerState) => void) {
  corePlayer.onPlayerState(listener)
}

export function offPlayerState(listener: (state: PlayerState) => void) {
  corePlayer.offPlayerState(listener)
}

export function setError(message: string) {
  ;(corePlayer as CorePlayerImpl).setError(message)
}
