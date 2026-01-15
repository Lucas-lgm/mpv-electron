import { BrowserWindow } from 'electron'
import { mpvManager } from './mpvManager'

export interface CorePlayer {
  setVideoWindow(window: BrowserWindow | null): void
  play(filePath: string): Promise<void>
  pause(): Promise<void>
  resume(): Promise<void>
  stop(): Promise<void>
  seek(time: number): Promise<void>
  setVolume(volume: number): Promise<void>
  isUsingEmbeddedMode(): boolean
  cleanup(): Promise<void>
}

let backend: CorePlayer = {
  setVideoWindow(window: BrowserWindow | null) {
    mpvManager.setVideoWindow(window)
  },
  async play(filePath: string) {
    await mpvManager.play(filePath)
  },
  async pause() {
    await mpvManager.pause()
  },
  async resume() {
    await mpvManager.resume()
  },
  async stop() {
    await mpvManager.stop()
  },
  async seek(time: number) {
    await mpvManager.seek(time)
  },
  async setVolume(volume: number) {
    await mpvManager.setVolume(volume)
  },
  isUsingEmbeddedMode() {
    return mpvManager.isUsingLibMPV()
  },
  async cleanup() {
    await mpvManager.cleanup()
  }
}

export const corePlayer: CorePlayer = {
  setVideoWindow(window: BrowserWindow | null) {
    backend.setVideoWindow(window)
  },
  async play(filePath: string) {
    await backend.play(filePath)
  },
  async pause() {
    await backend.pause()
  },
  async resume() {
    await backend.resume()
  },
  async stop() {
    await backend.stop()
  },
  async seek(time: number) {
    await backend.seek(time)
  },
  async setVolume(volume: number) {
    await backend.setVolume(volume)
  },
  isUsingEmbeddedMode() {
    return backend.isUsingEmbeddedMode()
  },
  async cleanup() {
    await backend.cleanup()
  }
}

export function setCorePlayerBackend(impl: CorePlayer) {
  backend = impl
}
