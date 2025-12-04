import { BrowserWindow } from 'electron'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))

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
    
    // 如果窗口不透明，设置黑色背景（这样底层 OpenGL 渲染会更明显）
    if (!config.transparent && config.id === 'video') {
      windowOptions.backgroundColor = '#000000'
    }
    
    const window = new BrowserWindow(windowOptions)

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
      // 开发模式：确保路由以 # 开头
      const route = config.route || '#/'
      const url = `http://localhost:5173/${route.startsWith('#') ? route : '#' + route}`
      window.loadURL(url)
      // 只在主窗口打开 DevTools
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

