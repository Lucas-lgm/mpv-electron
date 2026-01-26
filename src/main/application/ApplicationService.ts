// src/main/application/ApplicationService.ts

import type { MediaPlayer } from './core/MediaPlayer'
import type { Playlist } from '../domain/models/Playlist'
import { PlayMediaCommand, PlayMediaCommandHandler } from './commands/PlayMediaCommand'
import { PausePlaybackCommand, PausePlaybackCommandHandler } from './commands/PausePlaybackCommand'
import { ResumePlaybackCommand, ResumePlaybackCommandHandler } from './commands/ResumePlaybackCommand'
import { SeekCommand, SeekCommandHandler } from './commands/SeekCommand'
import { SetVolumeCommand, SetVolumeCommandHandler } from './commands/SetVolumeCommand'
import { StopPlaybackCommand, StopPlaybackCommandHandler } from './commands/StopPlaybackCommand'
import { GetPlaylistQuery, GetPlaylistQueryHandler, type PlaylistQueryResult } from './queries/GetPlaylistQuery'
import { GetPlaybackStatusQuery, GetPlaybackStatusQueryHandler, type PlaybackStatusQueryResult } from './queries/GetPlaybackStatusQuery'

/**
 * 应用服务协调器
 * 
 * 负责协调命令和查询处理器，管理领域对象生命周期
 */
export class ApplicationService {
  // 命令处理器
  private playMediaHandler: PlayMediaCommandHandler
  private pauseHandler: PausePlaybackCommandHandler
  private resumeHandler: ResumePlaybackCommandHandler
  private seekHandler: SeekCommandHandler
  private setVolumeHandler: SetVolumeCommandHandler
  private stopHandler: StopPlaybackCommandHandler

  // 查询处理器
  private getPlaylistHandler: GetPlaylistQueryHandler
  private getPlaybackStatusHandler: GetPlaybackStatusQueryHandler

  constructor(
    private player: MediaPlayer,
    private playlist: Playlist
  ) {
    // 初始化命令处理器
    this.playMediaHandler = new PlayMediaCommandHandler(player, playlist)
    this.pauseHandler = new PausePlaybackCommandHandler(player)
    this.resumeHandler = new ResumePlaybackCommandHandler(player)
    this.seekHandler = new SeekCommandHandler(player)
    this.setVolumeHandler = new SetVolumeCommandHandler(player)
    this.stopHandler = new StopPlaybackCommandHandler(player)

    // 初始化查询处理器
    this.getPlaylistHandler = new GetPlaylistQueryHandler(playlist)
    this.getPlaybackStatusHandler = new GetPlaybackStatusQueryHandler(player)
  }

  // ========== 命令方法 ==========

  /**
   * 播放媒体
   */
  async playMedia(command: PlayMediaCommand): Promise<void> {
    await this.playMediaHandler.handle(command)
  }

  /**
   * 暂停播放
   */
  async pausePlayback(command: PausePlaybackCommand): Promise<void> {
    await this.pauseHandler.handle(command)
  }

  /**
   * 恢复播放
   */
  async resumePlayback(command: ResumePlaybackCommand): Promise<void> {
    await this.resumeHandler.handle(command)
  }

  /**
   * 跳转
   */
  async seek(command: SeekCommand): Promise<void> {
    await this.seekHandler.handle(command)
  }

  /**
   * 设置音量
   */
  async setVolume(command: SetVolumeCommand): Promise<void> {
    await this.setVolumeHandler.handle(command)
  }

  /**
   * 停止播放
   */
  async stopPlayback(command: StopPlaybackCommand): Promise<void> {
    await this.stopHandler.handle(command)
  }

  // ========== 查询方法 ==========

  /**
   * 获取播放列表
   */
  getPlaylist(query: GetPlaylistQuery): PlaylistQueryResult {
    return this.getPlaylistHandler.handle(query)
  }

  /**
   * 获取播放状态
   */
  getPlaybackStatus(query: GetPlaybackStatusQuery): PlaybackStatusQueryResult {
    return this.getPlaybackStatusHandler.handle(query)
  }

  // ========== 领域对象访问 ==========

  /**
   * 获取播放器实例（用于高级操作）
   */
  getPlayer(): MediaPlayer {
    return this.player
  }

  /**
   * 获取播放列表实例（用于高级操作）
   */
  getPlaylistInstance(): Playlist {
    return this.playlist
  }
}
