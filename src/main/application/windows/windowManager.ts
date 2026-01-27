import { BrowserWindow } from 'electron'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { createLogger } from '../../infrastructure/logging'

const __dirname = dirname(fileURLToPath(import.meta.url))
const logger = createLogger('WindowManager')

export interface WindowConfig {
  id: string
  width: number
  height: number
  title: string
  route?: string
  frame?: boolean
  alwaysOnTop?: boolean
  transparent?: boolean
  x?: number
  y?: number
  show?: boolean // 是否立即显示窗口
  titleBarStyle?: 'default' | 'hidden' | 'hiddenInset' | 'customButtonsOnHover' // macOS 标题栏样式
}

export class WindowManager {
  private windows: Map<string, BrowserWindow> = new Map()

  createWindow(config: WindowConfig): BrowserWindow {
    // 如果窗口已存在，先关闭
    if (this.windows.has(config.id)) {
      const existingWindow = this.windows.get(config.id)!
      if (!existingWindow.isDestroyed()) {
        existingWindow.close()
      }
    }

    const windowOptions: Electron.BrowserWindowConstructorOptions = {
      width: config.width,
      height: config.height,
      x: config.x,
      y: config.y,
      title: config.title,
      frame: config.frame !== false,
      alwaysOnTop: config.alwaysOnTop || false,
      transparent: config.transparent || false,
      show: config.show !== undefined ? config.show : false,
      resizable: true, // 允许调整窗口大小
      maximizable: true, // 允许最大化
      minimizable: true, // 允许最小化
      closable: true, // 允许关闭
      webPreferences: {
        preload: join(__dirname, '../preload/preload.js'),
        nodeIntegration: false,
        contextIsolation: true
      }
    }
    
    // macOS 特定选项
    if (process.platform === 'darwin') {
      if (config.titleBarStyle) {
        windowOptions.titleBarStyle = config.titleBarStyle
      }
    }
    
    // Windows 特定选项
    if (process.platform === 'win32') {
      if (config.transparent) {
        logger.warn('Windows: Transparent windows cannot be resized on Windows (Electron limitation)')
      } else {
        windowOptions.resizable = true
        windowOptions.maximizable = true
        windowOptions.minimizable = true
      }
    }
    
    // 视频窗口设置黑色背景（行业标准做法）
    // Windows 上：不透明窗口 + 黑色背景，MPV 子窗口会显示在 Electron 窗口之上
    // macOS 上：透明窗口或黑色背景都可以
    if (config.id === 'video') {
      if (!config.transparent) {
        windowOptions.backgroundColor = '#000000'
      } else if (process.platform === 'darwin') {
        // macOS 透明窗口也可以设置背景色作为后备
        windowOptions.backgroundColor = '#00000000'
      }
    }
    
    const window = new BrowserWindow(windowOptions)

    // 确保窗口可以调整大小和最大化（显式设置，避免某些情况下默认值不生效）
    // Windows 上透明窗口无法调整大小（Electron 限制），其他情况都可以调整
    if (!(config.transparent && process.platform === 'win32')) {
      window.setResizable(true)
      window.setMaximizable(true)
      window.setMinimizable(true)
    }
    window.setClosable(true)
    
    // 添加调试日志
    logger.debug('Window created', {
      id: config.id,
      resizable: windowOptions.resizable,
      maximizable: windowOptions.maximizable,
      transparent: config.transparent,
      frame: config.frame,
      platform: process.platform,
      actualResizable: window.isResizable(),
      actualMaximizable: window.isMaximizable()
    })
    
    // 在 Windows 上，非透明窗口可能需要延迟再次设置
    if (process.platform === 'win32' && !config.transparent) {
      // 窗口显示后再次确保设置生效
      window.once('show', () => {
        if (!window.isDestroyed()) {
          window.setResizable(true)
          window.setMaximizable(true)
          window.setMinimizable(true)
          window.setClosable(true)
          logger.debug('Windows: Re-set after show', {
            resizable: window.isResizable(),
            maximizable: window.isMaximizable()
          })
        }
      })
      
      // 也尝试在 ready-to-show 时设置
      window.once('ready-to-show', () => {
        if (!window.isDestroyed()) {
          window.setResizable(true)
          window.setMaximizable(true)
          window.setMinimizable(true)
          window.setClosable(true)
          logger.debug('Windows: Re-set after ready-to-show', {
            resizable: window.isResizable(),
            maximizable: window.isMaximizable()
          })
        }
      })
    }

    // 窗口准备好后显示（如果没有配置立即显示，则等待 ready-to-show 事件）
    if (!config.show && config.id !== 'video') {
      window.once('ready-to-show', () => {
        if (!window.isDestroyed()) {
          window.show()
        }
      })
    }

    // 设置 Content Security Policy
    window.webContents.on('did-finish-load', () => {
      window.webContents.executeJavaScript(`
        const meta = document.createElement('meta');
        meta.httpEquiv = 'Content-Security-Policy';
        meta.content = "default-src 'self' 'unsafe-inline' 'unsafe-eval' data: blob: file:; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline';";
        document.getElementsByTagName('head')[0].appendChild(meta);
      `).catch(() => {})
    })

    // 根据路由加载不同的页面（hash 模式）
    if (process.env.NODE_ENV === 'development') {
      const route = config.route || '#/'
      const url = `http://localhost:5173/${route.startsWith('#') ? route : '#' + route}`
      window.loadURL(url)
      if (config.id === 'main') {
        window.webContents.openDevTools()
      }
    } else {
      // 生产模式：使用 hash 参数
      const route = config.route || '#/'
      window.loadFile(join(__dirname, '../renderer/index.html'), {
        hash: route.startsWith('#') ? route : '#' + route
      })
    }

    // 窗口关闭时从管理器中移除
    window.on('closed', () => {
      this.windows.delete(config.id)
    })

    this.windows.set(config.id, window)
    return window
  }

  getWindow(id: string): BrowserWindow | undefined {
    return this.windows.get(id)
  }

  getAllWindows(): BrowserWindow[] {
    return Array.from(this.windows.values())
  }

  closeWindow(id: string): void {
    const window = this.windows.get(id)
    if (window && !window.isDestroyed()) {
      window.close()
    }
  }

  closeAllWindows(): void {
    this.windows.forEach((window) => {
      if (!window.isDestroyed()) {
        window.close()
      }
    })
    this.windows.clear()
  }
}
