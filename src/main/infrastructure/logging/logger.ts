/**
 * 日志系统
 * 
 * 提供统一的日志记录功能，支持不同日志级别和输出方式。
 * 开发环境输出到控制台，生产环境可选文件输出。
 */

/**
 * 日志级别枚举
 */
export enum LogLevel {
  /** 调试信息，仅在开发环境使用 */
  DEBUG = 0,
  /** 一般信息 */
  INFO = 1,
  /** 警告信息 */
  WARN = 2,
  /** 错误信息 */
  ERROR = 3
}

/**
 * 日志元数据接口
 */
export interface LogMeta {
  [key: string]: any
}

/**
 * 日志配置接口
 */
export interface LoggerConfig {
  /** 最小日志级别，低于此级别的日志将被忽略 */
  minLevel: LogLevel
  /** 是否启用控制台输出 */
  enableConsole: boolean
  /** 是否启用文件输出（生产环境） */
  enableFile?: boolean
  /** 日志文件路径（如果启用文件输出） */
  logFilePath?: string
}

/**
 * 日志器类
 * 
 * 提供结构化的日志记录功能，支持不同级别和输出方式。
 * 所有日志都包含时间戳、级别、模块名和消息内容。
 */
export class Logger {
  private config: LoggerConfig
  private moduleName: string

  /**
   * 创建日志器实例
   * 
   * @param moduleName 模块名称，用于标识日志来源
   * @param config 日志配置
   */
  constructor(moduleName: string, config?: Partial<LoggerConfig>) {
    this.moduleName = moduleName
    this.config = {
      minLevel: process.env.NODE_ENV === 'development' ? LogLevel.DEBUG : LogLevel.INFO,
      enableConsole: true,
      enableFile: false,
      ...config
    }
  }

  /**
   * 记录调试日志
   * 
   * @param message 日志消息
   * @param meta 可选的元数据
   */
  debug(message: string, meta?: LogMeta): void {
    this.log(LogLevel.DEBUG, message, meta)
  }

  /**
   * 记录信息日志
   * 
   * @param message 日志消息
   * @param meta 可选的元数据
   */
  info(message: string, meta?: LogMeta): void {
    this.log(LogLevel.INFO, message, meta)
  }

  /**
   * 记录警告日志
   * 
   * @param message 日志消息
   * @param meta 可选的元数据
   */
  warn(message: string, meta?: LogMeta): void {
    this.log(LogLevel.WARN, message, meta)
  }

  /**
   * 记录错误日志
   * 
   * @param message 日志消息
   * @param meta 可选的元数据
   */
  error(message: string, meta?: LogMeta): void {
    this.log(LogLevel.ERROR, message, meta)
  }

  /**
   * 内部日志记录方法
   * 
   * @param level 日志级别
   * @param message 日志消息
   * @param meta 可选的元数据
   */
  private log(level: LogLevel, message: string, meta?: LogMeta): void {
    // 如果日志级别低于配置的最小级别，则忽略
    if (level < this.config.minLevel) {
      return
    }

    const timestamp = new Date().toISOString()
    const levelName = LogLevel[level]
    const logEntry = this.formatLogEntry(timestamp, levelName, message, meta)

    // 输出到控制台
    if (this.config.enableConsole) {
      this.outputToConsole(level, logEntry)
    }

    // 输出到文件（如果启用）
    if (this.config.enableFile && this.config.logFilePath) {
      // TODO: 实现文件输出（如果需要）
      // 可以使用 fs.appendFile 或第三方日志库
    }
  }

  /**
   * 格式化日志条目
   * 
   * @param timestamp 时间戳
   * @param level 日志级别名称
   * @param message 日志消息
   * @param meta 可选的元数据
   * @returns 格式化后的日志字符串
   */
  private formatLogEntry(timestamp: string, level: string, message: string, meta?: LogMeta): string {
    const parts = [
      `[${timestamp}]`,
      `[${level}]`,
      `[${this.moduleName}]`,
      message
    ]

    if (meta && Object.keys(meta).length > 0) {
      parts.push(JSON.stringify(meta))
    }

    return parts.join(' ')
  }

  /**
   * 输出到控制台
   * 
   * @param level 日志级别
   * @param logEntry 格式化后的日志条目
   */
  private outputToConsole(level: LogLevel, logEntry: string): void {
    switch (level) {
      case LogLevel.DEBUG:
        console.debug(logEntry)
        break
      case LogLevel.INFO:
        console.log(logEntry)
        break
      case LogLevel.WARN:
        console.warn(logEntry)
        break
      case LogLevel.ERROR:
        console.error(logEntry)
        break
    }
  }
}

/**
 * 创建日志器实例的工厂函数
 * 
 * @param moduleName 模块名称
 * @param config 可选的日志配置
 * @returns 日志器实例
 */
export function createLogger(moduleName: string, config?: Partial<LoggerConfig>): Logger {
  return new Logger(moduleName, config)
}

/**
 * 默认日志器实例（用于快速日志记录）
 */
export const defaultLogger = createLogger('Main')
