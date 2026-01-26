// src/main/application/commands/ResumePlaybackCommand.ts

import type { MediaPlayer } from '../core/MediaPlayer'

/**
 * 恢复播放命令
 */
export interface ResumePlaybackCommand {
  // 无参数
}

/**
 * 恢复播放命令处理器
 */
export class ResumePlaybackCommandHandler {
  constructor(private player: MediaPlayer) {}

  async handle(command: ResumePlaybackCommand): Promise<void> {
    await this.player.resume()
  }
}
