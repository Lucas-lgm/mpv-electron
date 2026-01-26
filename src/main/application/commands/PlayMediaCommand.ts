// src/main/application/commands/PlayMediaCommand.ts

import { Media } from '../../domain/models/Media'
import type { MediaPlayer } from '../core/MediaPlayer'
import type { Playlist } from '../../domain/models/Playlist'

/**
 * 播放媒体命令
 */
export interface PlayMediaCommand {
  readonly mediaUri: string
  readonly mediaName?: string
  readonly metadata?: {
    title?: string
    duration?: number
    format?: string
  }
  /**
   * 播放选项
   */
  readonly options?: {
    /**
     * 音量（0-100），如果提供则设置音量
     */
    volume?: number
    /**
     * 是否自动恢复播放（默认 true）
     */
    autoResume?: boolean
    /**
     * 是否加入播放列表并设为当前项（默认 true）。
     * 当调用方已管理列表（如 videoPlayerApp.play）时传 false，仅执行播放。
     */
    addToPlaylist?: boolean
  }
}

/**
 * 播放媒体命令处理器
 */
export class PlayMediaCommandHandler {
  constructor(
    private player: MediaPlayer,
    private playlist: Playlist
  ) {}

  async handle(command: PlayMediaCommand): Promise<void> {
    const media = Media.create(command.mediaUri, {
      title: command.mediaName,
      ...command.metadata
    })
    
    const addToPlaylist = command.options?.addToPlaylist !== false
    if (addToPlaylist) {
      this.playlist.add(media)
      this.playlist.setCurrentByUri(media.uri)
    }
    
    // 播放
    await this.player.play(media)
    
    // 处理播放选项
    if (command.options) {
      // 设置音量
      if (command.options.volume !== undefined) {
        await this.player.setVolume(command.options.volume)
      }
      
      // 自动恢复播放
      if (command.options.autoResume !== false) {
        const session = this.player.getCurrentSession()
        if (session && session.status !== 'playing') {
          await this.player.resume()
        }
      }
    }
  }
}
