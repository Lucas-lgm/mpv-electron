import { ipcMain, dialog } from 'electron'
import { mountPathService } from '../../services/mountPathService'
import { createIpcHandler } from '../ipcErrorHandler'
import { IPC_CHANNELS, IPC_RESPONSE_CHANNELS } from '../ipcConstants'
import type {
  MountPathAddRequest,
  MountPathRemoveRequest,
  MountPathRefreshRequest,
  ScanDirectoryRequest
} from '../ipcTypes'

/**
 * 挂载路径管理相关的 IPC handlers
 */
export function setupMountPathHandlers(): void {
  ipcMain.on(IPC_CHANNELS.SELECT_MOUNT_PATH, createIpcHandler(
    async () => {
      const result = await dialog.showOpenDialog({
        properties: ['openDirectory'],
        title: '选择要挂载的文件夹'
      })

      if (!result.canceled && result.filePaths.length > 0) {
        const path = result.filePaths[0]
        await mountPathService.addMountPath(path)
      }
    },
    IPC_RESPONSE_CHANNELS.MOUNT_PATH_ERROR,
    IPC_CHANNELS.SELECT_MOUNT_PATH
  ))

  ipcMain.on(IPC_CHANNELS.MOUNT_PATH_ADD, createIpcHandler<[MountPathAddRequest]>(
    async (_event, data: MountPathAddRequest) => {
      await mountPathService.addMountPath(data.path)
    },
    IPC_RESPONSE_CHANNELS.MOUNT_PATH_ERROR,
    IPC_CHANNELS.MOUNT_PATH_ADD
  ))

  ipcMain.on(IPC_CHANNELS.MOUNT_PATH_REMOVE, createIpcHandler<[MountPathRemoveRequest]>(
    (_event, data: MountPathRemoveRequest) => {
      mountPathService.removeMountPath(data.id)
    },
    IPC_RESPONSE_CHANNELS.MOUNT_PATH_ERROR,
    IPC_CHANNELS.MOUNT_PATH_REMOVE
  ))

  ipcMain.on(IPC_CHANNELS.MOUNT_PATH_REFRESH, createIpcHandler<[MountPathRefreshRequest]>(
    async (_event, data: MountPathRefreshRequest) => {
      await mountPathService.refreshMountPath(data.id)
    },
    IPC_RESPONSE_CHANNELS.MOUNT_PATH_ERROR,
    IPC_CHANNELS.MOUNT_PATH_REFRESH
  ))

  ipcMain.on(IPC_CHANNELS.GET_MOUNT_PATHS, (event) => {
    const mountPaths = mountPathService.getAllMountPaths()
    event.reply(IPC_RESPONSE_CHANNELS.MOUNT_PATHS_UPDATED, { mountPaths })
  })

  // 扫描目录（独立功能，不挂载）
  ipcMain.on(IPC_CHANNELS.SCAN_DIRECTORY, createIpcHandler<[ScanDirectoryRequest]>(
    async (event, data: ScanDirectoryRequest) => {
      // 使用mountPathService的内部方法扫描
      const mountPath = await mountPathService.addMountPath(data.path)
      if (mountPath) {
        // 获取扫描到的资源（通过mount-path-added事件已经发送）
        event.reply(IPC_RESPONSE_CHANNELS.DIRECTORY_SCANNED, { path: data.path, mountPathId: mountPath.id })
      }
    },
    IPC_RESPONSE_CHANNELS.DIRECTORY_SCAN_ERROR,
    IPC_CHANNELS.SCAN_DIRECTORY
  ))
}
