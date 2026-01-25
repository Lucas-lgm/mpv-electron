// src/main/application/commands/SetVolumeCommand.ts

import type { MediaPlayer } from '../../domain/services/MediaPlayer'

/**
 * 设置音量命令
 */
export interface SetVolumeCommand {
  readonly volume: number  // 音量值 (0-100)
}

/**
 * 设置音量命令处理器
 */
export class SetVolumeCommandHandler {
  constructor(private player: MediaPlayer) {}

  async handle(command: SetVolumeCommand): Promise<void> {
    const volume = Math.max(0, Math.min(100, command.volume))
    await this.player.setVolume(volume)
  }
}
