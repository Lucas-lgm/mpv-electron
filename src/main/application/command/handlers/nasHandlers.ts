import { ipcMain } from 'electron'
import { nasService } from '../../services/nasService'
import { createIpcHandler } from '../ipcErrorHandler'
import { IPC_CHANNELS, IPC_RESPONSE_CHANNELS } from '../ipcConstants'
import type {
  NasTestConnectionRequest,
  NasAddRequest,
  NasRemoveRequest,
  NasRefreshRequest,
  NasReadDirectoryRequest,
  NasOpenShareRequest,
  NasListSharesRequest
} from '../ipcTypes'

/**
 * NAS 连接管理相关的 IPC handlers
 */
export function setupNasHandlers(): void {
  // NAS 连接管理
  ipcMain.on(IPC_CHANNELS.NAS_TEST_CONNECTION, createIpcHandler<[NasTestConnectionRequest]>(
    async (event, data: NasTestConnectionRequest) => {
      const result = await nasService.testConnection(data.config)
      event.reply(IPC_RESPONSE_CHANNELS.NAS_TEST_CONNECTION_RESULT, result)
    },
    IPC_RESPONSE_CHANNELS.NAS_TEST_CONNECTION_RESULT,
    IPC_CHANNELS.NAS_TEST_CONNECTION
  ))

  ipcMain.on(IPC_CHANNELS.NAS_ADD, createIpcHandler<[NasAddRequest]>(
    async (event, data: NasAddRequest) => {
      await nasService.addNasConnection(data.name, data.config)
      // 成功消息通过 nas-connection-added 事件发送
    },
    IPC_RESPONSE_CHANNELS.NAS_CONNECTION_ERROR,
    IPC_CHANNELS.NAS_ADD
  ))

  ipcMain.on(IPC_CHANNELS.NAS_REMOVE, createIpcHandler<[NasRemoveRequest]>(
    (_event, data: NasRemoveRequest) => {
      nasService.removeNasConnection(data.id)
    },
    IPC_RESPONSE_CHANNELS.NAS_CONNECTION_ERROR,
    IPC_CHANNELS.NAS_REMOVE
  ))

  ipcMain.on(IPC_CHANNELS.NAS_REFRESH, createIpcHandler<[NasRefreshRequest]>(
    async (event, data: NasRefreshRequest) => {
      await nasService.refreshNasConnection(data.id)
      // 成功消息通过 nas-connection-scanned 事件发送
    },
    IPC_RESPONSE_CHANNELS.NAS_CONNECTION_ERROR,
    IPC_CHANNELS.NAS_REFRESH
  ))

  ipcMain.on(IPC_CHANNELS.GET_NAS_CONNECTIONS, (event) => {
    const connections = nasService.getAllNasConnections()
    event.reply(IPC_RESPONSE_CHANNELS.NAS_CONNECTIONS_UPDATED, { connections })
  })

  // NAS 文件系统操作
  ipcMain.on(IPC_CHANNELS.NAS_READ_DIRECTORY, createIpcHandler<[NasReadDirectoryRequest]>(
    async (event, data: NasReadDirectoryRequest) => {
      const result = await nasService.readNasDirectory(data.connectionId, data.path)
      event.reply(IPC_RESPONSE_CHANNELS.NAS_DIRECTORY_READ_RESULT, result)
    },
    IPC_RESPONSE_CHANNELS.NAS_DIRECTORY_READ_RESULT,
    IPC_CHANNELS.NAS_READ_DIRECTORY
  ))

  // NAS 打开/挂载共享
  ipcMain.on(IPC_CHANNELS.NAS_OPEN_SHARE, createIpcHandler<[NasOpenShareRequest]>(
    async (event, data: NasOpenShareRequest) => {
      const result = await nasService.openSmbShare(data.connectionId)
      event.reply(IPC_RESPONSE_CHANNELS.NAS_OPEN_SHARE_RESULT, result)
    },
    IPC_RESPONSE_CHANNELS.NAS_OPEN_SHARE_RESULT,
    IPC_CHANNELS.NAS_OPEN_SHARE
  ))

  // NAS 网络发现
  ipcMain.on(IPC_CHANNELS.NAS_DISCOVER_SERVERS, createIpcHandler(
    async (event) => {
      const result = await nasService.discoverNetworkServers()
      event.reply(IPC_RESPONSE_CHANNELS.NAS_DISCOVER_SERVERS_RESULT, result)
    },
    IPC_RESPONSE_CHANNELS.NAS_DISCOVER_SERVERS_RESULT,
    IPC_CHANNELS.NAS_DISCOVER_SERVERS
  ))

  // NAS 列出服务器共享
  ipcMain.on(IPC_CHANNELS.NAS_LIST_SHARES, createIpcHandler<[NasListSharesRequest]>(
    async (event, data: NasListSharesRequest) => {
      const result = await nasService.listServerShares(
        data.protocol,
        data.host,
        data.username,
        data.password,
        data.useHttps,
        data.port
      )
      event.reply(IPC_RESPONSE_CHANNELS.NAS_LIST_SHARES_RESULT, result)
    },
    IPC_RESPONSE_CHANNELS.NAS_LIST_SHARES_RESULT,
    IPC_CHANNELS.NAS_LIST_SHARES
  ))

  // NAS 打开网络浏览
  ipcMain.on(IPC_CHANNELS.NAS_OPEN_NETWORK_BROWSER, createIpcHandler(
    async (event) => {
      const result = await nasService.openNetworkBrowser()
      event.reply(IPC_RESPONSE_CHANNELS.NAS_OPEN_NETWORK_BROWSER_RESULT, result)
    },
    IPC_RESPONSE_CHANNELS.NAS_OPEN_NETWORK_BROWSER_RESULT,
    IPC_CHANNELS.NAS_OPEN_NETWORK_BROWSER
  ))
}
