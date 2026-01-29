import { PlayerStateMachine, PlayerPhase } from '../state/playerState'
import { TaskQueue, Task, AddStrategy } from '../../infrastructure/scheduling/TaskQueue'
import { createLogger } from '../../infrastructure/logging'

const logger = createLogger('PlaybackScheduler')

type StatePredicate = (phase: PlayerPhase) => boolean

interface ScheduledTask extends Task<any> {
  condition?: StatePredicate
}

/**
 * 播放调度器
 * 负责协调状态机和任务队列，实现基于状态的任务调度
 */
export class PlaybackScheduler {
  private isProcessing: boolean = false

  constructor(
    private readonly queue: TaskQueue,
    private readonly stateMachine: PlayerStateMachine
  ) {
    // 监听状态变化，驱动任务执行
    this.stateMachine.on('state', () => {
      this.tryProcessNext()
    })
  }

  /**
   * 提交任务
   * @param task 任务定义
   * @param condition 执行该任务所需的状态条件（可选）
   * @param strategy 任务添加策略：'append' | 'replace' | 'clear_all'
   */
  async schedule<T>(task: Task<T>, condition?: StatePredicate, strategy: AddStrategy = 'append'): Promise<T> {
    // 包装任务，附带条件
    const scheduledTask: ScheduledTask = { ...task, condition }
    
    // 入队
    const promise = this.queue.add(scheduledTask, strategy)
    
    // 尝试驱动
    this.tryProcessNext()
    
    return promise
  }

  /**
   * 尝试处理下一个任务
   * 仅当当前未在处理中，且队头任务满足条件时执行
   */
  private async tryProcessNext(): Promise<void> {
    if (this.isProcessing || this.queue.isEmpty) {
      return
    }

    const task = this.queue.peek() as ScheduledTask | undefined
    if (!task) return

    const currentPhase = this.stateMachine.getState().phase
    
    // 检查条件
    if (task.condition && !task.condition(currentPhase)) {
      logger.debug(`Task blocked: ${task.type} (waiting for state match, current: ${currentPhase})`, { 
        meta: task.meta 
      })
      // 条件不满足，不执行，直接返回
      // 等待下一次状态变化触发 tryProcessNext
      return
    }

    // 条件满足，开始执行
    this.isProcessing = true
    try {
      await this.queue.processNext()
    } finally {
      this.isProcessing = false
      // 任务执行完毕后，状态可能已经改变，或者队列里还有其他任务
      // 继续尝试处理下一个（递归驱动）
      this.tryProcessNext()
    }
  }

  clear(): void {
    this.queue.clear()
  }
}