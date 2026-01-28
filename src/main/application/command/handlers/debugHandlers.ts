import { ipcMain } from 'electron'
import type { CorePlayer } from '../../core/corePlayer'
import { createLogger } from '../../../infrastructure/logging'
import { createIpcHandler } from '../ipcErrorHandler'
import { IPC_CHANNELS } from '../ipcConstants'

const logger = createLogger('DebugHandlers')

/**
 * 调试功能相关的 IPC handlers
 */
export function setupDebugHandlers(corePlayer: CorePlayer): void {
  ipcMain.on(IPC_CHANNELS.DEBUG_HDR_STATUS, createIpcHandler(
    async () => {
      await corePlayer.debugVideoState()
      await corePlayer.debugHdrStatus()
    },
    undefined,
    IPC_CHANNELS.DEBUG_HDR_STATUS
  ))

  // 测试（开发模式，路由到测试模块）
  ipcMain.on(IPC_CHANNELS.TEST_SEMANTIC_REFACTORING, createIpcHandler(
    async () => {
      if (process.env.NODE_ENV === 'development') {
        const { testDomainModels } = await import('../../../test_semantic_refactoring')
        await testDomainModels()
        logger.info('语义化重构测试完成，查看控制台输出')
      } else {
        logger.warn('测试功能仅在开发模式下可用')
      }
    },
    undefined,
    IPC_CHANNELS.TEST_SEMANTIC_REFACTORING
  ))
}
