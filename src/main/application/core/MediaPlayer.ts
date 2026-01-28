// src/main/application/core/MediaPlayer.ts

import { EventEmitter } from 'events'
import { Media } from '../../domain/models/Media'
import { PlaybackSession, PlaybackStatus } from '../../domain/models/Playback'

/**
 * 通用播放器状态接口
 * 
 * 统一的状态表示，用于：
 * - MediaPlayer 接口的状态返回
 * - 跨进程通信（替代原来的 PlayerState）
 * - 状态机状态输出
 */
export interface PlayerStatus {
  phase: PlaybackStatus
  currentTime: number
  duration: number
  volume: number
  path: string | null
  isPaused: boolean
  isSeeking: boolean
  isNetworkBuffering: boolean
  networkBufferingPercent: number
  errorMessage?: string
  isSwitching?: boolean
}

/**
 * 媒体播放器服务接口（与 CorePlayer 同属应用核心，约定播放契约）
 */
export interface MediaPlayer extends EventEmitter {
  // 播放控制
  /**
   * 播放媒体
   * @param media 媒体对象
   * @param startTime 起播时间（秒，可选）。如果提供，则从指定时间开始播放。
   */
  play(media: Media, startTime?: number): Promise<void>
  pause(): Promise<void>
  resume(): Promise<void>
  stop(): Promise<void>
  seek(time: number): Promise<void>
  setVolume(volume: number): Promise<void>
  
  // 会话管理
  getCurrentSession(): PlaybackSession | null
  onSessionChange(listener: (session: PlaybackSession) => void): void
  offSessionChange(listener: (session: PlaybackSession) => void): void
  
  // 状态获取
  /**
   * 获取播放器状态
   * @returns 通用播放器状态，如果未初始化则返回 null
   */
  getStatus(): PlayerStatus | null
  
  // 状态变化事件（用于状态更新优化）
  /**
   * 监听播放器状态变化
   * 当播放器状态更新时，会直接发出 PlayerStatus 事件
   * 这是状态更新的主要事件，比 session-change 更直接
   */
  onStatusChange(listener: (status: PlayerStatus) => void): void
  
  /**
   * 移除状态变化监听
   */
  offStatusChange(listener: (status: PlayerStatus) => void): void
  
  // 渲染能力
  /**
   * 请求渲染一帧
   * 对于需要 JS 驱动渲染的播放器（如 MPV），调用此方法触发渲染
   * 对于原生渲染的播放器（如 VLC），此方法可能为空操作
   */
  requestRender(): void
  
  /**
   * 获取渲染模式
   * @returns 'js-driven' | 'native' | 'none'
   *   - 'js-driven': 需要 JS 驱动渲染（如 MPV gpu-next）
   *   - 'native': 原生渲染（如 VLC）
   *   - 'none': 不支持渲染
   */
  getRenderMode(): 'js-driven' | 'native' | 'none'
  
  /**
   * 设置窗口大小（用于窗口大小同步）
   * @param width 窗口宽度（物理像素）
   * @param height 窗口高度（物理像素）
   */
  setWindowSize(width: number, height: number): Promise<void>
  
  /**
   * 监听视频帧率变化
   * @param listener 帧率变化回调，参数为 fps (number | null)
   */
  onFpsChange(listener: (fps: number | null) => void): void
  
  /**
   * 移除 FPS 变化监听
   */
  offFpsChange(listener: (fps: number | null) => void): void
  
  // 播放器特定功能
  /**
   * 设置 HDR 启用状态
   * @param enabled 是否启用 HDR
   */
  setHdrEnabled(enabled: boolean): void
  
  /**
   * 发送按键事件
   * @param key 按键名称
   */
  sendKey(key: string): Promise<void>
  
  /**
   * 调试：输出视频状态信息
   */
  debugVideoState(): Promise<void>
  
  /**
   * 调试：输出 HDR 状态信息
   */
  debugHdrStatus(): Promise<void>
  
  // 生命周期
  cleanup(): Promise<void>
}
