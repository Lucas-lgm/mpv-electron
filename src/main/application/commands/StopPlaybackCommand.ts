// src/main/application/commands/StopPlaybackCommand.ts

import type { MediaPlayer } from '../core/MediaPlayer'

/**
 * 停止播放命令
 */
export interface StopPlaybackCommand {
  // 无参数
}

/**
 * 停止播放命令处理器
 */
export class StopPlaybackCommandHandler {
  constructor(private player: MediaPlayer) {}

  async handle(command: StopPlaybackCommand): Promise<void> {
    await this.player.stop()
  }
}
