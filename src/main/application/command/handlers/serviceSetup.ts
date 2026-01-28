import { BrowserWindow } from 'electron'
import { mountPathService } from '../../services/mountPathService'
import { nasService } from '../../services/nasService'
import { createLogger } from '../../../infrastructure/logging'
import { WINDOW_CHECK_CONFIG } from '../ipcConstants'
import type { VideoPlayerApp } from '../../videoPlayerApp'

const logger = createLogger('ServiceSetup')

/**
 * 设置服务的主窗口
 * 
 * 当主窗口创建或准备好时，将窗口实例设置到相关服务中。
 * 
 * @param mainWindow 主窗口实例
 */
function setupServicesMainWindow(mainWindow: BrowserWindow | undefined): void {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return
  }

  try {
    mountPathService.setMainWindow(mainWindow)
    nasService.setMainWindow(mainWindow)
    logger.debug('Services main window set successfully')
  } catch (error) {
    logger.error('Failed to set services main window', {
      error: error instanceof Error ? error.message : String(error)
    })
  }
}

/**
 * 初始化服务的主窗口设置
 * 
 * 监听主窗口创建事件，使用事件而不是硬编码延迟。
 * 这样更可靠，避免了竞态条件和不确定的延迟时间。
 * 
 * @param videoPlayerApp VideoPlayerApp 实例
 */
export function setupServices(videoPlayerApp: VideoPlayerApp): void {
  // 立即尝试设置主窗口（如果已创建）
  const mainWindow = videoPlayerApp.windowManager.getWindow('main')
  setupServicesMainWindow(mainWindow)
  
  const windowManager = videoPlayerApp.windowManager
  
  // 如果窗口还未创建，监听窗口创建事件
  if (!mainWindow) {
    // 使用轮询检查窗口是否已创建（临时方案，直到有更好的事件机制）
    // 但限制最大尝试次数，避免无限循环
    
    let retryCount = 0
    const checkWindow = setInterval(() => {
      retryCount++
      const window = windowManager.getWindow('main')
      
      if (window) {
        clearInterval(checkWindow)
        setupServicesMainWindow(window)
        
        // 监听窗口的 ready-to-show 事件，确保窗口完全准备好
        window.once('ready-to-show', () => {
          setupServicesMainWindow(window)
        })
      } else if (retryCount >= WINDOW_CHECK_CONFIG.MAX_RETRIES) {
        clearInterval(checkWindow)
        logger.warn('Main window not created after maximum retries', {
          maxRetries: WINDOW_CHECK_CONFIG.MAX_RETRIES
        })
      }
    }, WINDOW_CHECK_CONFIG.RETRY_INTERVAL_MS)
  } else {
    // 如果窗口已存在，监听 ready-to-show 事件确保完全准备好
    mainWindow.once('ready-to-show', () => {
      setupServicesMainWindow(mainWindow)
    })
  }
}
