# 功能规划：播放器语义化重构

> **创建日期**: 2026-01-25  
> **状态**: 执行中（阶段1-4已完成，阶段5待执行）  
> **最后更新**: 2026-01-25  
> **优先级**: 中

## 📋 需求描述

### 背景
当前播放器代码使用技术实现名称（如 `CorePlayer`、`LibMPVController`），缺乏清晰的领域语义。数据结构混合了多个关注点（播放状态、媒体信息、网络状态），导致代码可读性和可维护性下降。

### 目标
1. **提升语义化**：使用领域模型替代技术实现名称
2. **清晰职责分离**：分离播放控制、状态管理、窗口管理等职责
3. **改善可维护性**：通过明确的领域概念，使代码更易理解和扩展
4. **保持向后兼容**：分阶段实施，不破坏现有功能

### 成功标准
- [ ] 领域模型清晰，命名语义化
- [ ] 职责分离明确，单一职责原则
- [ ] 现有功能正常运行
- [ ] 代码可读性和可维护性提升
- [ ] 新功能易于添加

## 🔍 影响分析

### 涉及的文件

#### 新增文件（领域层）
- `src/main/domain/models/Media.ts` - 媒体资源领域模型
- `src/main/domain/models/Playback.ts` - 播放会话领域模型
- `src/main/domain/models/Playlist.ts` - 播放列表领域模型
- `src/main/domain/models/Player.ts` - 播放器领域模型（可选）
- `src/main/domain/services/MediaPlayer.ts` - 媒体播放器服务接口
- `src/main/domain/events/PlaybackEvents.ts` - 播放领域事件

#### 新增文件（应用层）
- `src/main/application/commands/PlayMediaCommand.ts` - 播放媒体命令
- `src/main/application/commands/PausePlaybackCommand.ts` - 暂停播放命令
- `src/main/application/commands/SeekCommand.ts` - 跳转命令
- `src/main/application/queries/GetPlaylistQuery.ts` - 获取播放列表查询
- `src/main/application/queries/GetPlaybackStatusQuery.ts` - 获取播放状态查询
- `src/main/application/ApplicationService.ts` - 应用服务协调器

#### 新增文件（基础设施层）
- `src/main/infrastructure/mpv/MpvMediaPlayer.ts` - MPV 实现的媒体播放器
- `src/main/infrastructure/mpv/MpvAdapter.ts` - MPV 适配器（将技术模型转换为领域模型）
- `src/main/infrastructure/storage/PlaylistStorage.ts` - 播放列表持久化

#### 修改的文件
- `src/main/corePlayer.ts` - 重构为使用领域模型
- `src/main/videoPlayerApp.ts` - 重构为使用领域模型和应用服务
- `src/main/ipcHandlers.ts` - 重构为使用命令/查询模式
- `src/main/playerState.ts` - 重构为使用领域模型（Playback）
- `src/main/libmpv.ts` - 保持不变，但添加适配器层

### 架构影响

- [x] 需要新增领域模型层
- [x] 需要新增应用服务层
- [x] 需要重构 IPC 处理逻辑
- [x] 需要重构状态管理
- [ ] 涉及 HDR/EDR 渲染（保持不变）
- [ ] 需要原生模块支持（保持不变）
- [ ] 影响性能（预期无负面影响，可能略有提升）

### 依赖关系

```
领域层 (domain)
    ↓
应用层 (application) 
    ↓
基础设施层 (infrastructure)
    ↓
表现层 (presentation/ipc)
```

## 🎨 设计方案

### 领域模型设计

#### 1. Media（媒体资源）

```typescript
// src/main/domain/models/Media.ts

/**
 * 媒体资源标识符（值对象）
 */
export interface MediaId {
  readonly value: string
}

/**
 * 媒体资源元数据
 */
export interface MediaMetadata {
  readonly title?: string
  readonly duration?: number
  readonly format?: string
  readonly size?: number
  readonly thumbnail?: string
  readonly codec?: string
  readonly resolution?: { width: number; height: number }
}

/**
 * 媒体资源领域模型
 */
export class Media {
  constructor(
    public readonly id: MediaId,
    public readonly uri: string,
    public readonly metadata: MediaMetadata = {}
  ) {}

  /**
   * 获取显示名称
   */
  get displayName(): string {
    return this.metadata.title || this.extractFileName() || '未知媒体'
  }

  /**
   * 是否为本地文件
   */
  get isLocalFile(): boolean {
    return !this.uri.startsWith('http://') && 
           !this.uri.startsWith('https://') &&
           !this.uri.startsWith('file://')
  }

  /**
   * 是否为网络流
   */
  get isNetworkStream(): boolean {
    return this.uri.startsWith('http://') || 
           this.uri.startsWith('https://')
  }

  /**
   * 是否为 HLS 流
   */
  get isHlsStream(): boolean {
    return this.uri.endsWith('.m3u8') || 
           this.uri.includes('m3u8')
  }

  private extractFileName(): string {
    try {
      const url = new URL(this.uri)
      return url.pathname.split('/').pop() || ''
    } catch {
      return this.uri.split(/[/\\]/).pop() || ''
    }
  }

  /**
   * 创建媒体实例
   */
  static create(uri: string, metadata?: MediaMetadata): Media {
    return new Media(
      { value: `media-${Date.now()}-${Math.random().toString(36).substr(2, 9)}` },
      uri,
      metadata || {}
    )
  }
}
```

#### 2. Playback（播放会话）

```typescript
// src/main/domain/models/Playback.ts

/**
 * 播放状态枚举（语义化）
 */
export enum PlaybackStatus {
  IDLE = 'idle',           // 空闲
  LOADING = 'loading',     // 加载中
  PLAYING = 'playing',     // 播放中
  PAUSED = 'paused',       // 已暂停
  STOPPED = 'stopped',     // 已停止
  ENDED = 'ended',         // 播放结束
  ERROR = 'error'          // 错误
}

/**
 * 播放进度值对象
 */
export interface PlaybackProgress {
  readonly currentTime: number  // 当前时间（秒）
  readonly duration: number     // 总时长（秒）
  readonly percentage: number  // 进度百分比 (0-100)
  readonly updatedAt: number   // 更新时间戳
}

/**
 * 网络缓冲状态
 */
export interface NetworkBufferingState {
  readonly isBuffering: boolean
  readonly bufferingPercent: number
}

/**
 * 播放会话领域模型
 */
export class PlaybackSession {
  constructor(
    public readonly media: Media | null,
    public readonly status: PlaybackStatus,
    public readonly progress: PlaybackProgress,
    public readonly volume: number,
    public readonly networkBuffering: NetworkBufferingState,
    public readonly error: string | null = null,
    public readonly isSeeking: boolean = false
  ) {}

  /**
   * 是否处于活动状态
   */
  get isActive(): boolean {
    return this.status === PlaybackStatus.PLAYING || 
           this.status === PlaybackStatus.PAUSED
  }

  /**
   * 是否可以跳转
   */
  get canSeek(): boolean {
    return this.progress.duration > 0 && 
           this.isActive &&
           !this.isSeeking
  }

  /**
   * 是否正在播放
   */
  get isPlaying(): boolean {
    return this.status === PlaybackStatus.PLAYING
  }

  /**
   * 是否已暂停
   */
  get isPaused(): boolean {
    return this.status === PlaybackStatus.PAUSED
  }

  /**
   * 是否处于错误状态
   */
  get hasError(): boolean {
    return this.status === PlaybackStatus.ERROR
  }

  /**
   * 创建新的播放会话
   */
  static create(
    media: Media | null,
    status: PlaybackStatus,
    progress: Partial<PlaybackProgress>,
    volume: number,
    networkBuffering?: Partial<NetworkBufferingState>,
    error?: string | null,
    isSeeking?: boolean
  ): PlaybackSession {
    const fullProgress: PlaybackProgress = {
      currentTime: progress.currentTime ?? 0,
      duration: progress.duration ?? 0,
      percentage: progress.duration && progress.currentTime
        ? (progress.currentTime / progress.duration) * 100
        : 0,
      updatedAt: progress.updatedAt ?? Date.now()
    }

    const buffering: NetworkBufferingState = {
      isBuffering: networkBuffering?.isBuffering ?? false,
      bufferingPercent: networkBuffering?.bufferingPercent ?? 0
    }

    return new PlaybackSession(
      media,
      status,
      fullProgress,
      volume,
      buffering,
      error ?? null,
      isSeeking ?? false
    )
  }
}
```

#### 3. Playlist（播放列表）

```typescript
// src/main/domain/models/Playlist.ts

import { Media, MediaId } from './Media'

/**
 * 播放列表项
 */
export interface PlaylistEntry {
  readonly id: string
  readonly media: Media
  readonly addedAt: Date
  readonly playedAt?: Date
}

/**
 * 播放列表领域模型
 */
export class Playlist {
  private entries: PlaylistEntry[] = []
  private currentIndex: number = -1

  /**
   * 添加媒体到播放列表
   */
  add(media: Media): PlaylistEntry {
    const entry: PlaylistEntry = {
      id: `entry-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      media,
      addedAt: new Date()
    }
    this.entries.push(entry)
    return entry
  }

  /**
   * 移除播放列表项
   */
  remove(id: string): boolean {
    const index = this.entries.findIndex(e => e.id === id)
    if (index === -1) return false
    
    this.entries.splice(index, 1)
    if (this.currentIndex >= index) {
      this.currentIndex = Math.max(0, this.currentIndex - 1)
    }
    return true
  }

  /**
   * 获取当前播放项
   */
  getCurrent(): PlaylistEntry | null {
    if (this.currentIndex < 0 || this.currentIndex >= this.entries.length) {
      return null
    }
    return this.entries[this.currentIndex]
  }

  /**
   * 设置当前播放项
   */
  setCurrent(id: string): boolean {
    const index = this.entries.findIndex(e => e.id === id)
    if (index === -1) return false
    this.currentIndex = index
    return true
  }

  /**
   * 设置当前播放项（通过索引）
   */
  setCurrentByIndex(index: number): boolean {
    if (index < 0 || index >= this.entries.length) return false
    this.currentIndex = index
    return true
  }

  /**
   * 设置当前播放项（通过媒体 URI）
   */
  setCurrentByUri(uri: string): boolean {
    const index = this.entries.findIndex(e => e.media.uri === uri)
    if (index === -1) return false
    this.currentIndex = index
    return true
  }

  /**
   * 下一首
   */
  next(): PlaylistEntry | null {
    if (this.currentIndex < this.entries.length - 1) {
      this.currentIndex++
      return this.getCurrent()
    }
    return null
  }

  /**
   * 上一首
   */
  previous(): PlaylistEntry | null {
    if (this.currentIndex > 0) {
      this.currentIndex--
      return this.getCurrent()
    }
    return null
  }

  /**
   * 获取所有条目
   */
  getAll(): readonly PlaylistEntry[] {
    return [...this.entries]
  }

  /**
   * 获取条目数量
   */
  get size(): number {
    return this.entries.length
  }

  /**
   * 是否为空
   */
  get isEmpty(): boolean {
    return this.entries.length === 0
  }

  /**
   * 清空播放列表
   */
  clear(): void {
    this.entries = []
    this.currentIndex = -1
  }

  /**
   * 移动条目位置
   */
  moveEntry(fromIndex: number, toIndex: number): boolean {
    if (fromIndex < 0 || fromIndex >= this.entries.length ||
        toIndex < 0 || toIndex >= this.entries.length) {
      return false
    }
    
    const [entry] = this.entries.splice(fromIndex, 1)
    this.entries.splice(toIndex, 0, entry)
    
    // 调整当前索引
    if (this.currentIndex === fromIndex) {
      this.currentIndex = toIndex
    } else if (fromIndex < this.currentIndex && toIndex >= this.currentIndex) {
      this.currentIndex--
    } else if (fromIndex > this.currentIndex && toIndex <= this.currentIndex) {
      this.currentIndex++
    }
    
    return true
  }
}
```

### 服务接口设计

#### MediaPlayer 服务接口

```typescript
// src/main/domain/services/MediaPlayer.ts

import { Media } from '../models/Media'
import { PlaybackSession } from '../models/Playback'
import { EventEmitter } from 'events'

/**
 * 媒体播放器服务接口
 */
export interface MediaPlayer extends EventEmitter {
  /**
   * 播放媒体
   */
  play(media: Media): Promise<void>

  /**
   * 暂停播放
   */
  pause(): Promise<void>

  /**
   * 恢复播放
   */
  resume(): Promise<void>

  /**
   * 停止播放
   */
  stop(): Promise<void>

  /**
   * 跳转到指定时间
   */
  seek(time: number): Promise<void>

  /**
   * 设置音量
   */
  setVolume(volume: number): Promise<void>

  /**
   * 获取当前播放会话
   */
  getCurrentSession(): PlaybackSession | null

  /**
   * 监听播放会话变化
   */
  onSessionChange(listener: (session: PlaybackSession) => void): void

  /**
   * 移除监听器
   */
  offSessionChange(listener: (session: PlaybackSession) => void): void

  /**
   * 清理资源
   */
  cleanup(): Promise<void>
}
```

### 应用层设计

#### 命令模式

```typescript
// src/main/application/commands/PlayMediaCommand.ts

import { Media } from '../../domain/models/Media'

export interface PlayMediaCommand {
  readonly mediaUri: string
  readonly mediaName?: string
  readonly metadata?: {
    title?: string
    duration?: number
    format?: string
  }
}

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
```

#### 查询模式

```typescript
// src/main/application/queries/GetPlaylistQuery.ts

import { PlaylistEntry } from '../../domain/models/Playlist'

export interface GetPlaylistQuery {
  // 可以添加过滤条件
}

export interface PlaylistQueryResult {
  readonly entries: readonly PlaylistEntry[]
  readonly currentIndex: number
  readonly currentEntry: PlaylistEntry | null
}

export class GetPlaylistQueryHandler {
  constructor(private playlist: Playlist) {}

  handle(query: GetPlaylistQuery): PlaylistQueryResult {
    const entries = this.playlist.getAll()
    const current = this.playlist.getCurrent()
    
    return {
      entries,
      currentIndex: this.playlist['currentIndex'],
      currentEntry: current
    }
  }
}
```

### 适配器层设计

#### MPV 适配器

```typescript
// src/main/infrastructure/mpv/MpvAdapter.ts

import { MPVStatus } from '../../libmpv'
import { PlaybackSession, PlaybackStatus } from '../../domain/models/Playback'
import { Media } from '../../domain/models/Media'

/**
 * MPV 状态到领域模型的适配器
 */
export class MpvAdapter {
  /**
   * 将 MPVStatus 转换为 PlaybackSession
   */
  static toPlaybackSession(
    mpvStatus: MPVStatus,
    media: Media | null
  ): PlaybackSession {
    const status = this.mapPhaseToStatus(mpvStatus.phase)
    
    return PlaybackSession.create(
      media,
      status,
      {
        currentTime: mpvStatus.position,
        duration: mpvStatus.duration,
        updatedAt: Date.now()
      },
      mpvStatus.volume,
      {
        isBuffering: mpvStatus.isNetworkBuffering ?? false,
        bufferingPercent: mpvStatus.networkBufferingPercent ?? 0
      },
      null,
      mpvStatus.isSeeking ?? false
    )
  }

  private static mapPhaseToStatus(
    phase?: 'idle' | 'loading' | 'playing' | 'paused' | 'stopped' | 'ended' | 'error'
  ): PlaybackStatus {
    switch (phase) {
      case 'idle': return PlaybackStatus.IDLE
      case 'loading': return PlaybackStatus.LOADING
      case 'playing': return PlaybackStatus.PLAYING
      case 'paused': return PlaybackStatus.PAUSED
      case 'stopped': return PlaybackStatus.STOPPED
      case 'ended': return PlaybackStatus.ENDED
      case 'error': return PlaybackStatus.ERROR
      default: return PlaybackStatus.IDLE
    }
  }
}
```

## 📝 实现步骤

### 阶段 1：创建领域模型（不破坏现有代码）

#### 步骤 1.1: 创建目录结构
- [x] 创建 `src/main/domain/models/` 目录
- [x] 创建 `src/main/domain/services/` 目录
- [x] 创建 `src/main/domain/events/` 目录

#### 步骤 1.2: 实现 Media 模型
- [x] 创建 `src/main/domain/models/Media.ts`
- [x] 实现 `MediaId` 接口
- [x] 实现 `MediaMetadata` 接口
- [x] 实现 `Media` 类
- [ ] 添加单元测试（可选）

#### 步骤 1.3: 实现 Playback 模型
- [x] 创建 `src/main/domain/models/Playback.ts`
- [x] 定义 `PlaybackStatus` 枚举
- [x] 实现 `PlaybackProgress` 接口
- [x] 实现 `NetworkBufferingState` 接口
- [x] 实现 `PlaybackSession` 类
- [ ] 添加单元测试（可选）

#### 步骤 1.4: 实现 Playlist 模型
- [x] 创建 `src/main/domain/models/Playlist.ts`
- [x] 实现 `PlaylistEntry` 接口
- [x] 实现 `Playlist` 类
- [ ] 添加单元测试（可选）

**预期结果**: 领域模型创建完成，但不影响现有代码

### 阶段 2：创建适配器层

#### 步骤 2.1: 创建 MPV 适配器
- [x] 创建 `src/main/infrastructure/mpv/MpvAdapter.ts`
- [x] 实现 `toPlaybackSession` 方法
- [x] 实现状态映射方法

#### 步骤 2.2: 创建 MediaPlayer 接口
- [x] 创建 `src/main/domain/services/MediaPlayer.ts`
- [x] 定义接口方法

**预期结果**: 适配器层创建完成，可以转换技术模型到领域模型

### 阶段 3：实现 MediaPlayer（并行实现，不替换现有代码）

#### 步骤 3.1: 创建 MpvMediaPlayer
- [x] 创建 `src/main/infrastructure/mpv/MpvMediaPlayer.ts`
- [x] 实现 `MediaPlayer` 接口
- [x] 内部使用现有的 `LibMPVController`
- [x] 使用 `MpvAdapter` 转换状态

#### 步骤 3.2: 集成测试
- [ ] 测试播放功能
- [ ] 测试状态转换
- [ ] 测试错误处理

**预期结果**: 新的 MediaPlayer 实现完成，可以独立使用

### 阶段 4：创建应用层

#### 步骤 4.1: 实现命令处理器
- [x] 创建 `src/main/application/commands/` 目录
- [x] 实现 `PlayMediaCommand` 和 `PlayMediaCommandHandler`
- [x] 实现 `PausePlaybackCommand` 和处理器
- [x] 实现 `ResumePlaybackCommand` 和处理器
- [x] 实现 `SeekCommand` 和处理器
- [x] 实现 `SetVolumeCommand` 和处理器
- [x] 实现 `StopPlaybackCommand` 和处理器

#### 步骤 4.2: 实现查询处理器
- [x] 创建 `src/main/application/queries/` 目录
- [x] 实现 `GetPlaylistQuery` 和处理器
- [x] 实现 `GetPlaybackStatusQuery` 和处理器

#### 步骤 4.3: 创建应用服务
- [x] 创建 `src/main/application/ApplicationService.ts`
- [x] 协调命令和查询处理器
- [x] 管理领域对象生命周期

**预期结果**: 应用层创建完成，提供统一的业务操作接口

### 阶段 5：重构现有代码（逐步迁移）

#### 步骤 5.1: 重构 videoPlayerApp
- [ ] 修改 `videoPlayerApp.ts` 使用领域模型
- [ ] 使用 `ApplicationService` 替代直接操作
- [ ] 保持向后兼容（保留旧接口，内部使用新实现）

#### 步骤 5.2: 重构 corePlayer
- [ ] 修改 `corePlayer.ts` 使用 `MediaPlayer` 接口
- [ ] 内部实现使用 `MpvMediaPlayer`
- [ ] 保持接口兼容

#### 步骤 5.3: 重构 playerState
- [ ] 修改 `playerState.ts` 使用 `PlaybackSession`
- [ ] 保持事件兼容性

**预期结果**: 现有代码逐步迁移到新架构，保持功能正常

### 阶段 6：重构 IPC 层

#### 步骤 6.1: 重构 IPC Handlers
- [x] 修改 `ipcHandlers.ts` 使用命令/查询模式
- [x] 使用 `ApplicationService` 处理请求（pause/resume/stop/seek/volume/get-playlist）
- [x] 保持 IPC 消息格式兼容（窗口管理和播放列表管理保留现有逻辑）

#### 步骤 6.2: 测试 IPC 通信
- [ ] 测试所有 IPC 消息
- [ ] 确保 UI 正常工作

**预期结果**: IPC 层使用新架构，功能正常

**说明**: 
- 播放控制类 IPC（pause/resume/stop/seek/volume）已迁移到 `ApplicationService`
- `get-playlist` 已使用 `appService.getPlaylist()` 查询
- `play-video`、`play-url`、`set-playlist` 等涉及窗口管理或复杂播放列表逻辑的保留现有实现（通过 `videoPlayerApp` 方法）

### 阶段 7：清理和优化

#### 步骤 7.1: 移除旧代码
- [x] 确认所有功能已迁移
- [x] **移除阶段 5–6 引入的过渡性适配层**：删除 `adapters/PlayerStateAdapter`、`adapters/PlaylistAdapter`；`sessionToPlayerState`/`phaseToStatus` 内联至 `playerState.ts`，播放列表逻辑以 `PlaylistFacade` 形式内联至 `videoPlayerApp`
- [x] 移除未使用的旧代码、空 `adapters/` 目录
- [x] 更新导入路径

#### 步骤 7.2: 文档更新
- [ ] 更新代码注释（如需要）
- [x] 更新架构文档（4.4 PlaylistItem、4.5 领域模型与应用层）
- [ ] 更新 README（如需要）

**预期结果**: 代码清理完成，文档更新

## ⚠️ 风险评估

| 风险 | 影响 | 概率 | 应对方案 |
|------|------|------|----------|
| 重构范围大，可能引入 Bug | 高 | 中 | 分阶段实施，充分测试，保持向后兼容 |
| 性能影响 | 低 | 低 | 适配器层很薄，预期无性能影响 |
| 学习曲线 | 低 | 中 | 提供清晰的文档和代码注释 |
| 时间成本 | 中 | 高 | 分阶段实施，可以暂停和恢复 |

### 潜在问题

1. **状态同步问题**: 领域模型状态和 MPV 状态可能不同步
   - **应对**: 使用适配器层统一转换，确保单一数据源

2. **事件系统兼容**: 现有的事件监听器可能依赖旧的数据结构
   - **应对**: 在适配器层转换事件数据，保持兼容

3. **测试覆盖**: 重构后需要充分测试
   - **应对**: 每个阶段完成后进行测试，确保功能正常

## 🧪 测试方案

### 功能测试

- [ ] **播放功能测试**
  - 步骤: 使用新架构播放视频
  - 预期: 视频正常播放，状态正确

- [ ] **播放列表测试**
  - 步骤: 添加多个视频，切换播放
  - 预期: 播放列表正常工作，当前项正确

- [ ] **播放控制测试**
  - 步骤: 暂停、恢复、跳转、音量控制
  - 预期: 所有控制功能正常

- [ ] **状态管理测试**
  - 步骤: 观察播放状态变化
  - 预期: 状态转换正确，事件正常触发

### 边界情况

- [ ] **空播放列表**: 尝试播放空列表
- [ ] **无效媒体**: 播放不存在的文件
- [ ] **网络流**: 播放网络流媒体
- [ ] **快速切换**: 快速切换多个视频

### 回归测试

- [ ] **现有功能**: 确保所有现有功能正常
- [ ] **IPC 通信**: 确保 IPC 消息正常
- [ ] **窗口管理**: 确保窗口功能正常
- [ ] **HDR 渲染**: 确保 HDR 功能正常

### 测试命令

```bash
# 开发环境测试
npm run dev

# 构建测试
npm run build

# 类型检查
npm run type-check  # 如果有这个脚本
```

## 📚 参考资料

- 领域驱动设计（DDD）原则
- CQRS 模式（命令查询分离）
- 适配器模式
- 现有代码: `src/main/corePlayer.ts`, `src/main/videoPlayerApp.ts`

## ✅ 确认清单

- [x] 计划已审核
- [x] 架构影响已评估
- [x] 风险评估已完成
- [x] 测试方案已制定
- [ ] 可以开始实现

## 📝 执行记录

### 2026-01-25 - 规划完成
- 完成详细规划文档
- 等待确认后开始实施

### [未来执行记录]
- [日期] - 阶段 X 完成
- [日期] - 遇到的问题和解决方案
- [日期] - 最终完成

## 🔄 后续改进

### 可能的优化方向

1. **事件溯源**: 可以考虑使用事件溯源模式记录播放历史
2. **领域事件**: 更丰富的领域事件系统
3. **聚合根**: 如果复杂度增加，可以考虑引入聚合根
4. **仓储模式**: 如果需要持久化，可以引入仓储模式

### 更新记录

- **2026-01-25**: 初始规划文档创建
