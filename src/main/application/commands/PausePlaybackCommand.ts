// src/main/application/commands/PausePlaybackCommand.ts

import type { MediaPlayer } from '../core/MediaPlayer'

/**
 * 暂停播放命令
 */
export interface PausePlaybackCommand {
  // 无参数
}

/**
 * 暂停播放命令处理器
 */
export class PausePlaybackCommandHandler {
  constructor(private player: MediaPlayer) {}

  async handle(command: PausePlaybackCommand): Promise<void> {
    await this.player.pause()
  }
}
