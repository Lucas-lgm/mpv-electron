// src/main/application/commands/PlayMediaCommand.ts

import { Media } from '../../domain/models/Media'
import type { MediaPlayer } from '../../domain/services/MediaPlayer'
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
    
    // 添加到播放列表
    this.playlist.add(media)
    this.playlist.setCurrentByUri(media.uri)
    
    // 播放
    await this.player.play(media)
  }
}
