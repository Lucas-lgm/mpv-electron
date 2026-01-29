import { EventEmitter } from 'events'
import { createLogger } from '../logging'

const logger = createLogger('TaskQueue')

export interface Task<T = void> {
  type: string
  id?: string
  execute: () => Promise<T>
  meta?: any
}

interface QueuedTask<T> {
  task: Task<T>
  resolve: (value: T | PromiseLike<T>) => void
  reject: (reason?: any) => void
}

export type AddStrategy = 'append' | 'replace' | 'clear_all'

/**
 * 基础任务队列（被动式）
 * 仅负责存储任务和执行指定的任务，不再包含自动调度逻辑
 */
export class TaskQueue {
  private queue: QueuedTask<any>[] = []

  /**
   * 添加任务到队列
   * @param task 任务对象
   * @param strategy 添加策略：'append' (默认), 'replace' (替换同ID), 'clear_all' (清空队列)
   * @returns 任务执行结果的 Promise
   */
  add<T>(task: Task<T>, strategy: AddStrategy = 'append'): Promise<T> {
    if (strategy === 'clear_all') {
      this.clear('Queue cleared by new task')
    } else if (strategy === 'replace' && task.id) {
      this.removeById(task.id, 'Task replaced by new task')
    }

    return new Promise<T>((resolve, reject) => {
      this.queue.push({
        task,
        resolve,
        reject
      })
    })
  }

  /**
   * 获取队头任务（不移除）
   */
  peek(): Task<any> | undefined {
    return this.queue[0]?.task
  }

  /**
   * 移除并执行队头任务
   */
  async processNext(): Promise<void> {
    const item = this.queue.shift()
    if (!item) return

    const { task, resolve, reject } = item
    try {
      logger.debug(`Executing task: ${task.type}`, { meta: task.meta })
      const result = await task.execute()
      resolve(result)
    } catch (error) {
      logger.error(`Task failed: ${task.type}`, {
        error: error instanceof Error ? error.message : String(error),
        meta: task.meta
      })
      reject(error)
    }
  }

  /**
   * 根据 ID 移除任务
   */
  private removeById(id: string, reason: string): void {
    // 过滤出需要保留的任务，被移除的任务触发 reject
    const kept: QueuedTask<any>[] = []
    
    for (const item of this.queue) {
      if (item.task.id === id) {
        item.reject(new Error(reason))
      } else {
        kept.push(item)
      }
    }
    
    this.queue = kept
  }

  /**
   * 清空队列
   */
  clear(reason: string = 'Task queue cleared'): void {
    while (this.queue.length > 0) {
      const item = this.queue.shift()
      if (item) {
        item.reject(new Error(reason))
      }
    }
  }

  get length(): number {
    return this.queue.length
  }

  get isEmpty(): boolean {
    return this.queue.length === 0
  }
}