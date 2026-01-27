import { createLogger } from '../../infrastructure/logging'

const logger = createLogger('LastWriteWinsTaskRunner')

/**
 * 通用 Last-Write-Wins 异步任务执行器。
 *
 * 适用场景：
 * - 对同一资源的高频控制命令（如 seek、刷新等），只关心「最后一次」意图
 * - 任务之间没有强依赖关系，允许中间任务被合并/覆盖
 *
 * 行为：
 * - 所有 submit(payload) 都不会丢弃，只是不断覆盖 latestPayload
 * - 若当前没有任务在执行，则立刻启动 runNext()
 * - 若当前有任务在执行，新提交只更新 latestPayload，待当前任务完成后只执行「最新的那一个」
 */
export class LastWriteWinsTaskRunner<T> {
  private latestPayload: T | null = null
  private isRunning = false
  private isDisposed = false
  private readonly debugLabel?: string

  constructor(
    private readonly task: (payload: T) => Promise<void>,
    options?: { debugLabel?: string }
  ) {
    this.debugLabel = options?.debugLabel
  }

  /**
   * 提交一次任务。
   * 新的 payload 会覆盖尚未开始执行的旧 payload，保证最终执行的是「最后一次提交」。
   */
  submit(payload: T): void {
    if (this.isDisposed) {
      if (this.debugLabel) {
        logger.debug(
          `${this.debugLabel} submit ignored because runner is disposed`
        )
      }
      return
    }

    this.latestPayload = payload

    if (this.debugLabel) {
      logger.debug(
        `${this.debugLabel} submit payload`,
        { payload }
      )
    }

    if (!this.isRunning) {
      // 不 await，避免阻塞调用方
      void this.runNext()
    }
  }

  /**
   * 停止后不再接受新任务，丢弃尚未执行的 payload。
   * 已在执行中的任务仍会正常完成。
   */
  dispose(): void {
    this.isDisposed = true
    this.latestPayload = null
  }

  private async runNext(): Promise<void> {
    if (this.isDisposed) return

    const payload = this.latestPayload
    if (payload === null) {
      // 没有待执行的任务
      return
    }

    // 取出当前要执行的 payload，并清空 latestPayload
    this.latestPayload = null
    this.isRunning = true

    if (this.debugLabel) {
      logger.debug(
        `${this.debugLabel} start task`,
        { payload }
      )
    }

    try {
      await this.task(payload)
    } catch (error) {
      const label = this.debugLabel ?? 'LastWriteWinsTaskRunner'
      logger.error(`${label} task failed`, {
        error: error instanceof Error ? error.message : String(error)
      })
    } finally {
      this.isRunning = false

      // 如果在执行期间有新的 payload 被提交（latestPayload 被重新赋值），继续执行最新的那一个
      if (!this.isDisposed && this.latestPayload !== null) {
        void this.runNext()
      }
    }
  }
}

