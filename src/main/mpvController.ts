import { spawn, ChildProcess } from 'child_process'
import { unlinkSync, existsSync } from 'fs'
import { createConnection, Socket } from 'net'
import { join } from 'path'
import { tmpdir } from 'os'
import { EventEmitter } from 'events'

export interface MPVStatus {
  paused: boolean
  position: number
  duration: number
  volume: number
  path: string | null
}

export class MPVController extends EventEmitter {
  private mpvProcess: ChildProcess | null = null
  
  /**
   * 获取 MPV 进程（用于窗口同步）
   */
  getProcess(): ChildProcess | null {
    return this.mpvProcess
  }
  private socketPath: string
  private socket: Socket | null = null
  private requestId: number = 0
  private pendingRequests: Map<number, { resolve: (value: any) => void; reject: (error: any) => void }> = new Map()
  private statusInterval: NodeJS.Timeout | null = null
  private responseBuffer: string = ''
  private currentStatus: MPVStatus = {
    paused: false,
    position: 0,
    duration: 0,
    volume: 100,
    path: null
  }

  constructor() {
    super()
    // 创建唯一的 socket 路径
    const timestamp = Date.now()
    const random = Math.random().toString(36).substring(7)
    this.socketPath = join(tmpdir(), `mpv-socket-${timestamp}-${random}`)
  }

  /**
   * 启动 mpv 进程
   * @param videoPath 视频文件路径
   * @param windowId 可选的窗口 ID（NSView 指针），如果提供则嵌入到该窗口，否则创建独立窗口
   */
  async start(videoPath: string, windowId?: number): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        // 清理旧的 socket 文件
        if (existsSync(this.socketPath)) {
          unlinkSync(this.socketPath)
        }

        const args = [
          '--input-ipc-server=' + this.socketPath,
          '--no-terminal',
          '--no-osc', // 禁用默认的 OSC 控制器
          '--no-osd-bar', // 禁用 OSD 条
          '--keep-open=yes', // 播放结束后保持窗口
        ]

        // 如果提供了 windowId，则尝试嵌入到指定窗口
        if (windowId && process.platform === 'darwin') {
          // macOS 上使用 --wid 参数尝试嵌入到指定窗口
          // 注意：macOS 可能不允许跨进程窗口嵌入，这里尝试传递窗口句柄
          args.push('--wid=' + windowId.toString())
          args.push('--vo=gpu') // macOS 上使用 gpu 输出
          // 尝试禁用窗口相关的自动行为
          args.push('--no-window-dragging') // 禁用窗口拖拽
          args.push('--ontop=no') // 不在顶层
          console.log('[MPVController] Attempting to embed into window with handle:', windowId)
          console.log('[MPVController] Note: macOS may not allow cross-process window embedding')
          console.log('[MPVController] If this doesn\'t work, MPV will create a standalone window')
        } else {
          // 创建独立窗口
          args.push('--no-border') // 无边框
          console.log('[MPVController] Creating standalone window')
        }
        
        // 视频文件路径放在最后
        args.push(videoPath)

        // 启动 mpv 进程
        console.log('Starting mpv with args:', args)
        this.mpvProcess = spawn('mpv', args, {
          stdio: ['ignore', 'pipe', 'pipe']
        })

        // 监听进程输出
        this.mpvProcess.stdout?.on('data', (data) => {
          const output = data.toString()
          console.log('[MPV] stdout:', output)
          // 检查是否有关于窗口嵌入的信息
          if (output.includes('wid') || output.includes('window') || output.includes('embed')) {
            console.log('[MPV] ⚠️ Window-related output:', output)
          }
        })

        this.mpvProcess.stderr?.on('data', (data) => {
          const errorMsg = data.toString()
          console.error('[MPV] stderr:', errorMsg)
          
          // 检查窗口相关的错误
          if (errorMsg.includes('wid') || errorMsg.includes('window') || errorMsg.includes('embed')) {
            console.error('[MPV] ⚠️ Window embedding error:', errorMsg)
          }
          
          // 某些 stderr 输出是正常的，但如果是致命错误需要处理
          if (errorMsg.includes('Failed to') || errorMsg.includes('Error:') || errorMsg.includes('FATAL')) {
            console.error('[MPV] ❌ Fatal error:', errorMsg)
            reject(new Error(`MPV error: ${errorMsg}`))
          }
        })

        this.mpvProcess.on('error', (error) => {
          console.error('MPV spawn error:', error)
          this.emit('error', error)
          reject(error)
        })

        this.mpvProcess.on('exit', (code, signal) => {
          console.log('MPV exited with code:', code, 'signal:', signal)
          this.emit('stopped')
          this.cleanup()
        })

        // 等待 socket 文件创建并连接
        this.waitForSocket().then(() => {
          this.connectSocket().then(() => {
            this.startStatusPolling()
            resolve()
          }).catch(reject)
        }).catch(reject)
      } catch (error) {
        reject(error)
      }
    })
  }

  /**
   * 等待 socket 文件创建
   */
  private waitForSocket(maxAttempts: number = 100): Promise<void> {
    return new Promise((resolve, reject) => {
      let attempts = 0
      const checkSocket = () => {
        if (existsSync(this.socketPath)) {
          console.log('MPV socket file created:', this.socketPath)
          resolve()
        } else if (attempts >= maxAttempts) {
          console.error('MPV socket file not created after', maxAttempts * 100, 'ms')
          console.error('Socket path:', this.socketPath)
          console.error('MPV process alive:', this.mpvProcess?.killed === false)
          reject(new Error('MPV socket file not created'))
        } else {
          attempts++
          setTimeout(checkSocket, 100)
        }
      }
      checkSocket()
    })
  }

  /**
   * 连接到 socket
   */
  private async connectSocket(): Promise<void> {
    return new Promise((resolve, reject) => {
      console.log('Connecting to MPV socket:', this.socketPath)
      this.socket = createConnection(this.socketPath)
      
      const timeout = setTimeout(() => {
        if (this.socket && !this.socket.destroyed) {
          this.socket.destroy()
        }
        reject(new Error('Socket connection timeout'))
      }, 5000)
      
      this.socket.on('connect', () => {
        console.log('Connected to MPV socket')
        clearTimeout(timeout)
        resolve()
      })

      this.socket.on('data', (data) => {
        this.responseBuffer += data.toString()
        const lines = this.responseBuffer.split('\n')
        this.responseBuffer = lines.pop() || ''

        for (const line of lines) {
          if (line.trim()) {
            try {
              const response = JSON.parse(line)
              this.handleResponse(response)
            } catch (error) {
              console.error('Failed to parse MPV response:', error, line)
            }
          }
        }
      })

      this.socket.on('error', (error) => {
        console.error('Socket error:', error)
        clearTimeout(timeout)
        reject(error)
      })

      this.socket.on('close', () => {
        console.log('Socket closed')
        this.socket = null
        this.emit('disconnected')
      })
    })
  }

  /**
   * 发送 JSON IPC 命令
   */
  private async sendCommand(command: any[]): Promise<any> {
    return new Promise((resolve, reject) => {
      if (!this.socket) {
        reject(new Error('MPV socket is not connected'))
        return
      }
      
      if (this.socket.destroyed || !this.socket.writable) {
        reject(new Error('MPV socket is closed or not writable'))
        return
      }

      const id = this.requestId++
      const request = {
        command,
        request_id: id
      }

      this.pendingRequests.set(id, { resolve, reject })

      try {
        this.socket.write(JSON.stringify(request) + '\n')
        
        // 设置超时
        setTimeout(() => {
          if (this.pendingRequests.has(id)) {
            this.pendingRequests.delete(id)
            reject(new Error('Command timeout'))
          }
        }, 5000)
      } catch (error) {
        this.pendingRequests.delete(id)
        reject(error)
      }
    })
  }

  /**
   * 处理响应
   */
  private handleResponse(response: any): void {
    if (response.request_id !== undefined) {
      const pending = this.pendingRequests.get(response.request_id)
      if (pending) {
        this.pendingRequests.delete(response.request_id)
        if (response.error !== 'success') {
          pending.reject(new Error(response.error || 'Unknown error'))
        } else {
          pending.resolve(response.data)
        }
      }
    } else if (response.event) {
      // 处理事件
      this.handleEvent(response)
    }
  }

  /**
   * 处理事件
   */
  private handleEvent(event: any): void {
    if (event.event === 'property-change') {
      const { name, data } = event
      switch (name) {
        case 'pause':
          this.currentStatus.paused = data
          this.emit('status', this.currentStatus)
          break
        case 'time-pos':
          this.currentStatus.position = data || 0
          this.emit('status', this.currentStatus)
          break
        case 'duration':
          this.currentStatus.duration = data || 0
          this.emit('status', this.currentStatus)
          break
        case 'volume':
          this.currentStatus.volume = data || 100
          this.emit('status', this.currentStatus)
          break
      }
    }
  }

  /**
   * 开始轮询状态
   */
  private startStatusPolling(): void {
    this.statusInterval = setInterval(async () => {
      try {
        await this.updateStatus()
      } catch (error) {
        console.error('Failed to update status:', error)
      }
    }, 500) // 每 500ms 更新一次状态
  }

  /**
   * 更新状态
   */
  private async updateStatus(): Promise<void> {
    try {
      const [paused, position, duration, volume] = await Promise.all([
        this.getProperty('pause'),
        this.getProperty('time-pos'),
        this.getProperty('duration'),
        this.getProperty('volume')
      ])

      this.currentStatus = {
        paused: paused || false,
        position: position || 0,
        duration: duration || 0,
        volume: volume || 100,
        path: this.currentStatus.path
      }

      this.emit('status', this.currentStatus)
    } catch (error) {
      // 忽略错误，可能 mpv 还未完全启动
    }
  }

  /**
   * 获取属性
   */
  async getProperty(name: string): Promise<any> {
    return this.sendCommand(['get_property', name])
  }

  /**
   * 设置属性
   */
  async setProperty(name: string, value: any): Promise<void> {
    await this.sendCommand(['set_property', name, value])
  }

  /**
   * 执行命令
   */
  async executeCommand(command: string, ...args: any[]): Promise<any> {
    return this.sendCommand([command, ...args])
  }

  /**
   * 播放/暂停切换
   */
  async togglePause(): Promise<void> {
    await this.executeCommand('cycle', 'pause')
  }

  /**
   * 暂停
   */
  async pause(): Promise<void> {
    await this.setProperty('pause', true)
  }

  /**
   * 播放
   */
  async play(): Promise<void> {
    await this.setProperty('pause', false)
  }

  /**
   * 跳转到指定时间
   */
  async seek(time: number): Promise<void> {
    await this.setProperty('time-pos', time)
  }

  /**
   * 设置音量
   */
  async setVolume(volume: number): Promise<void> {
    await this.setProperty('volume', Math.max(0, Math.min(100, volume)))
  }

  /**
   * 停止播放
   */
  async stop(): Promise<void> {
    if (this.mpvProcess) {
      await this.executeCommand('stop')
    }
  }

  /**
   * 加载文件
   */
  async loadFile(path: string): Promise<void> {
    await this.executeCommand('loadfile', path, 'replace')
    this.currentStatus.path = path
  }

  /**
   * 获取当前状态
   */
  getStatus(): MPVStatus {
    return { ...this.currentStatus }
  }

  /**
   * 清理资源
   */
  private cleanup(): void {
    if (this.statusInterval) {
      clearInterval(this.statusInterval)
      this.statusInterval = null
    }

    if (this.socket) {
      this.socket.destroy()
      this.socket = null
    }

    if (existsSync(this.socketPath)) {
      try {
        unlinkSync(this.socketPath)
      } catch (error) {
        // 忽略清理错误
      }
    }
  }

  /**
   * 关闭 mpv
   */
  async quit(): Promise<void> {
    if (this.mpvProcess) {
      try {
        await this.executeCommand('quit')
      } catch (error) {
        // 如果命令失败，直接杀死进程
        this.mpvProcess.kill()
      }
      this.mpvProcess = null
    }
    this.cleanup()
  }
}

