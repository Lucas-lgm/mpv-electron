// src/main/application/commands/SeekCommand.ts

import type { MediaPlayer } from '../core/MediaPlayer'

/**
 * 跳转命令
 */
export interface SeekCommand {
  readonly time: number  // 跳转时间（秒）
}

/**
 * 跳转命令处理器
 */
export class SeekCommandHandler {
  constructor(private player: MediaPlayer) {}

  async handle(command: SeekCommand): Promise<void> {
    if (command.time < 0) {
      throw new Error('Seek time must be non-negative')
    }
    await this.player.seek(command.time)
  }
}
