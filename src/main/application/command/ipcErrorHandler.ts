/**
 * IPC 错误处理工具
 * 
 * 提供统一的 IPC handler 错误处理机制，减少重复代码，
 * 确保错误处理的一致性和可维护性。
 */

import { IpcMainEvent } from 'electron'
import { createLogger } from '../../infrastructure/logging'

const logger = createLogger('IPCErrorHandler')

/**
 * IPC 错误响应接口
 */
export interface IpcErrorResponse {
  success: false
  error: string
}

/**
 * IPC 成功响应接口
 */
export interface IpcSuccessResponse<T = any> {
  success: true
  data?: T
}

/**
 * IPC 响应类型（成功或失败）
 */
export type IpcResponse<T = any> = IpcSuccessResponse<T> | IpcErrorResponse

/**
 * IPC Handler 函数类型定义
 * 
 * @template TArgs IPC 消息参数类型
 * @template TResponse 响应数据类型
 */
export type IpcHandler<TArgs extends any[] = any[], TResponse = any> = (
  event: IpcMainEvent,
  ...args: TArgs
) => Promise<TResponse> | TResponse

/**
 * 创建带错误处理的 IPC Handler
 * 
 * 自动包装 handler 函数，统一处理错误并返回标准化的错误响应。
 * 
 * @template TArgs IPC 消息参数类型
 * @template TResponse 响应数据类型
 * @param handler 原始的 IPC handler 函数
 * @param errorChannel 错误响应通道名称（可选，默认使用原通道名 + '-error'）
 * @param handlerName handler 名称（用于日志记录）
 * @returns 包装后的 IPC handler 函数
 * 
 * @example
 * ```typescript
 * // 原始 handler
 * ipcMain.on('nas-add', async (event, data: { name: string; config: any }) => {
 *   await nasService.addNasConnection(data.name, data.config)
 * })
 * 
 * // 使用统一错误处理
 * ipcMain.on('nas-add', createIpcHandler(
 *   async (event, data: { name: string; config: any }) => {
 *     await nasService.addNasConnection(data.name, data.config)
 *   },
 *   'nas-connection-error',
 *   'nas-add'
 * ))
 * ```
 */
export function createIpcHandler<TArgs extends any[] = any[], TResponse = any>(
  handler: IpcHandler<TArgs, TResponse>,
  errorChannel?: string,
  handlerName?: string
): (event: IpcMainEvent, ...args: TArgs) => void {
  const handlerDisplayName = handlerName || 'unknown-handler'

  return async (event: IpcMainEvent, ...args: TArgs): Promise<void> => {
    try {
      const result = await handler(event, ...args)
      
      // 如果 handler 返回了结果且需要回复，可以在这里处理
      // 大多数情况下，handler 会自己调用 event.reply
    } catch (error) {
      // 统一错误处理
      const errorMessage = error instanceof Error ? error.message : String(error)
      
      // 记录错误日志
      logger.error(`IPC handler "${handlerDisplayName}" failed`, {
        error: errorMessage,
        args: args.length > 0 ? args : undefined
      })

      // 发送错误响应
      const channel = errorChannel || `${event.sender.id}-error`
      const errorResponse: IpcErrorResponse = {
        success: false,
        error: errorMessage
      }

      // 尝试发送错误响应
      try {
        event.reply(channel, errorResponse)
      } catch (replyError) {
        // 如果 event.reply 失败（例如窗口已关闭），记录但不抛出
        logger.warn(`Failed to send error response for "${handlerDisplayName}"`, {
          error: replyError instanceof Error ? replyError.message : String(replyError)
        })
      }
    }
  }
}

/**
 * 创建带错误处理和自动回复的 IPC Handler
 * 
 * 与 createIpcHandler 类似，但会自动将 handler 的返回值作为成功响应发送。
 * 
 * @template TArgs IPC 消息参数类型
 * @template TResponse 响应数据类型
 * @param handler 原始的 IPC handler 函数
 * @param successChannel 成功响应通道名称
 * @param errorChannel 错误响应通道名称（可选）
 * @param handlerName handler 名称（用于日志记录）
 * @returns 包装后的 IPC handler 函数
 * 
 * @example
 * ```typescript
 * ipcMain.on('get-nas-connections', createIpcHandlerWithReply(
 *   (event) => {
 *     return nasService.getAllNasConnections()
 *   },
 *   'nas-connections-updated',
 *   'nas-connection-error',
 *   'get-nas-connections'
 * ))
 * ```
 */
export function createIpcHandlerWithReply<TArgs extends any[] = any[], TResponse = any>(
  handler: IpcHandler<TArgs, TResponse>,
  successChannel: string,
  errorChannel?: string,
  handlerName?: string
): (event: IpcMainEvent, ...args: TArgs) => void {
  const handlerDisplayName = handlerName || 'unknown-handler'

  return async (event: IpcMainEvent, ...args: TArgs): Promise<void> => {
    try {
      const result = await handler(event, ...args)
      
      // 发送成功响应
      const successResponse: IpcSuccessResponse<TResponse> = {
        success: true,
        data: result
      }

      try {
        event.reply(successChannel, successResponse)
      } catch (replyError) {
        logger.warn(`Failed to send success response for "${handlerDisplayName}"`, {
          error: replyError instanceof Error ? replyError.message : String(replyError)
        })
      }
    } catch (error) {
      // 统一错误处理（与 createIpcHandler 相同）
      const errorMessage = error instanceof Error ? error.message : String(error)
      
      logger.error(`IPC handler "${handlerDisplayName}" failed`, {
        error: errorMessage,
        args: args.length > 0 ? args : undefined
      })

      const channel = errorChannel || `${event.sender.id}-error`
      const errorResponse: IpcErrorResponse = {
        success: false,
        error: errorMessage
      }

      try {
        event.reply(channel, errorResponse)
      } catch (replyError) {
        logger.warn(`Failed to send error response for "${handlerDisplayName}"`, {
          error: replyError instanceof Error ? replyError.message : String(replyError)
        })
      }
    }
  }
}
