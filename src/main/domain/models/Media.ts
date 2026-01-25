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