/**
 * NAS 连接管理服务
 */
import { readFileSync, writeFileSync, existsSync } from 'fs'
import { readdir, stat, open } from 'fs/promises'
import { join, extname } from 'path'
import { app, BrowserWindow, safeStorage, shell } from 'electron'
import { exec } from 'child_process'
import { promisify } from 'util'
import { scanDirectory, type ScannedResource } from './mountPathService'

const execAsync = promisify(exec)

export interface NasConfig {
  protocol: 'smb'
  host: string
  share: string
  username?: string
  password?: string
  port?: number
  path?: string
}

export interface NasConnection {
  id: string
  name: string
  config: NasConfig
  resourceCount: number
  lastScanned?: Date
  autoScan?: boolean
  status?: 'connected' | 'disconnected' | 'error'
  error?: string
}

/**
 * 构建 SMB 路径
 */
function buildSmbPath(config: NasConfig): string {
  const { host, share, username, password, port, path } = config
  
  // 构建基础路径：smb://host/share
  let smbPath = `smb://${host}`
  
  // 添加端口（如果不是默认端口）
  if (port && port !== 445) {
    smbPath += `:${port}`
  }
  
  // 添加共享名称
  smbPath += `/${share}`
  
  // 添加子路径
  if (path) {
    const normalizedPath = path.replace(/^\/+|\/+$/g, '') // 移除首尾斜杠
    if (normalizedPath) {
      smbPath += `/${normalizedPath}`
    }
  }
  
  // 如果有用户名，添加到路径中
  if (username) {
    // SMB URL 格式：smb://username:password@host/share/path
    const authPart = password ? `${username}:${password}` : username
    smbPath = smbPath.replace(`smb://${host}`, `smb://${authPart}@${host}`)
  }
  
  return smbPath
}

/**
 * 测试 NAS 连接
 * 注意：在 macOS 上，SMB 路径需要先挂载才能访问
 * 这里我们尝试通过构建的路径来测试连接
 */
async function testNasConnection(config: NasConfig): Promise<{ success: boolean; error?: string }> {
  try {
    const smbPath = buildSmbPath(config)
    
    // 在 macOS 上，SMB 路径需要通过系统挂载才能访问
    // 这里我们只验证配置的有效性，实际连接需要系统支持
    // 如果路径格式正确，认为配置有效
    
    if (!config.host || !config.share) {
      return { success: false, error: '主机地址和共享名称不能为空' }
    }
    
    // 验证主机地址格式（简单验证）
    const hostPattern = /^([a-zA-Z0-9]([a-zA-Z0-9\-]{0,61}[a-zA-Z0-9])?\.)*[a-zA-Z0-9]([a-zA-Z0-9\-]{0,61}[a-zA-Z0-9])?$|^(\d{1,3}\.){3}\d{1,3}$/
    if (!hostPattern.test(config.host)) {
      return { success: false, error: '主机地址格式无效' }
    }
    
    // 验证端口范围
    if (config.port && (config.port < 1 || config.port > 65535)) {
      return { success: false, error: '端口号必须在 1-65535 之间' }
    }
    
    // 配置验证通过
    return { success: true }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : '连接测试失败'
    }
  }
}

/**
 * 加密密码
 */
function encryptPassword(password: string): string | null {
  try {
    if (safeStorage.isEncryptionAvailable()) {
      const buffer = safeStorage.encryptString(password)
      return buffer.toString('base64')
    }
    // 如果加密不可用，返回原密码（不推荐，但作为降级方案）
    console.warn('密码加密不可用，将使用明文存储（不安全）')
    return password
  } catch (error) {
    console.error('加密密码失败:', error)
    return null
  }
}

/**
 * 解密密码
 */
function decryptPassword(encryptedPassword: string): string | null {
  try {
    if (safeStorage.isEncryptionAvailable()) {
      const buffer = Buffer.from(encryptedPassword, 'base64')
      return safeStorage.decryptString(buffer)
    }
    // 如果加密不可用，假设是明文
    return encryptedPassword
  } catch (error) {
    console.error('解密密码失败:', error)
    return null
  }
}

/**
 * NAS 服务
 */
export class NasService {
  private nasConnections: Map<string, NasConnection> = new Map()
  private mainWindow: BrowserWindow | null = null
  private readonly configPath: string

  constructor() {
    // 获取配置文件路径
    const userData = app.getPath('userData')
    this.configPath = join(userData, 'nas-connections.json')
    
    // 加载已保存的 NAS 连接
    this.loadNasConnections()
  }

  /**
   * 加载已保存的 NAS 连接
   */
  private loadNasConnections(): void {
    try {
      if (!existsSync(this.configPath)) {
        return
      }
      const raw = readFileSync(this.configPath, 'utf-8')
      const data = JSON.parse(raw)
      if (Array.isArray(data.connections)) {
        data.connections.forEach((conn: any) => {
          // 解密密码
          const config: NasConfig = {
            ...conn.config,
            password: conn.config.encryptedPassword
              ? decryptPassword(conn.config.encryptedPassword)
              : undefined
          }
          
          const nasConnection: NasConnection = {
            id: conn.id,
            name: conn.name,
            config,
            resourceCount: conn.resourceCount || 0,
            lastScanned: conn.lastScanned ? new Date(conn.lastScanned) : undefined,
            autoScan: conn.autoScan !== undefined ? conn.autoScan : true,
            status: conn.status || 'disconnected',
            error: conn.error
          }
          this.nasConnections.set(nasConnection.id, nasConnection)
        })
      }
    } catch (error) {
      console.error('加载 NAS 连接失败:', error)
    }
  }

  /**
   * 保存 NAS 连接到文件
   */
  private saveNasConnections(): void {
    try {
      const connectionsArray = Array.from(this.nasConnections.values())
      const data = {
        connections: connectionsArray.map(conn => {
          // 加密密码
          const encryptedPassword = conn.config.password
            ? encryptPassword(conn.config.password)
            : undefined
          
          return {
            id: conn.id,
            name: conn.name,
            config: {
              ...conn.config,
              password: undefined, // 不保存明文密码
              encryptedPassword // 保存加密后的密码
            },
            resourceCount: conn.resourceCount,
            lastScanned: conn.lastScanned?.toISOString(),
            autoScan: conn.autoScan,
            status: conn.status,
            error: conn.error
          }
        })
      }
      writeFileSync(this.configPath, JSON.stringify(data, null, 2), 'utf-8')
    } catch (error) {
      console.error('保存 NAS 连接失败:', error)
    }
  }

  /**
   * 设置主窗口（用于发送IPC消息）
   */
  setMainWindow(window: BrowserWindow | null) {
    this.mainWindow = window
    // 窗口设置后，发送当前 NAS 连接列表
    if (window && !window.isDestroyed()) {
      const connections = this.getAllNasConnections()
      window.webContents.send('nas-connections-updated', { connections })
    }
  }

  /**
   * 测试 NAS 连接
   */
  async testConnection(config: NasConfig): Promise<{ success: boolean; error?: string }> {
    return await testNasConnection(config)
  }

  /**
   * 添加 NAS 连接
   */
  async addNasConnection(name: string, config: NasConfig): Promise<NasConnection> {
    // 先测试连接
    const testResult = await testNasConnection(config)
    if (!testResult.success) {
      throw new Error(testResult.error || '连接测试失败')
    }

    const id = `nas-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
    
    // 构建 SMB 路径并扫描
    const smbPath = buildSmbPath(config)
    
    // 注意：在 macOS 上，SMB 路径需要系统挂载才能访问
    // 这里我们只保存配置，实际扫描需要用户手动触发或系统已挂载
    let resources: ScannedResource[] = []
    let status: 'connected' | 'disconnected' | 'error' = 'disconnected'
    let error: string | undefined = undefined
    
    // 尝试扫描（如果路径可访问）
    try {
      // 在 macOS 上，SMB 路径通常挂载在 /Volumes 下
      // 或者用户已经通过 Finder 挂载
      // 这里我们尝试直接访问 smb:// 路径（如果系统支持）
      // 实际上，Node.js 的 fs API 可能无法直接访问 smb:// 路径
      // 需要系统先挂载，然后访问挂载点
      
      // 暂时不自动扫描，等待用户手动触发
      status = 'disconnected'
    } catch (err) {
      status = 'error'
      error = err instanceof Error ? err.message : '扫描失败'
    }
    
    const nasConnection: NasConnection = {
      id,
      name,
      config,
      resourceCount: resources.length,
      lastScanned: resources.length > 0 ? new Date() : undefined,
      autoScan: true,
      status,
      error
    }

    this.nasConnections.set(id, nasConnection)
    
    // 保存到文件
    this.saveNasConnections()

    // 发送IPC消息到渲染进程
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send('nas-connection-added', {
        connection: nasConnection,
        resources
      })
      // 同时发送更新后的列表
      this.mainWindow.webContents.send('nas-connections-updated', {
        connections: this.getAllNasConnections()
      })
    }

    return nasConnection
  }

  /**
   * 移除 NAS 连接
   */
  removeNasConnection(id: string): boolean {
    const removed = this.nasConnections.delete(id)
    
    if (removed) {
      // 保存到文件
      this.saveNasConnections()
      
      if (this.mainWindow && !this.mainWindow.isDestroyed()) {
        this.mainWindow.webContents.send('nas-connection-removed', { id })
        // 同时发送更新后的列表
        this.mainWindow.webContents.send('nas-connections-updated', {
          connections: this.getAllNasConnections()
        })
      }
    }

    return removed
  }

  /**
   * 刷新扫描 NAS 连接
   */
  async refreshNasConnection(id: string): Promise<void> {
    const connection = this.nasConnections.get(id)
    if (!connection) {
      throw new Error(`NAS 连接不存在: ${id}`)
    }

    // 构建 SMB 路径
    const smbPath = buildSmbPath(connection.config)
    
    // 尝试扫描
    // 注意：在 macOS 上，需要系统先挂载 SMB 共享
    // 这里我们尝试访问路径，如果失败则提示用户需要先挂载
    
    let resources: ScannedResource[] = []
    let status: 'connected' | 'disconnected' | 'error' = 'disconnected'
    let error: string | undefined = undefined
    
    try {
      // 尝试访问路径
      // 在 macOS 上，SMB 路径可能需要先通过 Finder 或 mount_smbfs 挂载
      // 挂载后，路径通常在 /Volumes/ShareName 下
      
      // 检查是否可以通过 smb:// 路径访问（需要系统支持）
      // 如果不行，尝试查找 /Volumes 下的挂载点
      const volumesPath = '/Volumes'
      const shareName = connection.config.share
      const mountedPath = join(volumesPath, shareName)
      
      // 检查挂载点是否存在
      if (existsSync(mountedPath)) {
        // 如果存在挂载点，扫描该路径
        const subPath = connection.config.path
          ? join(mountedPath, connection.config.path)
          : mountedPath
        
        if (existsSync(subPath)) {
          resources = await scanDirectory(subPath)
          status = 'connected'
        } else {
          status = 'error'
          error = `路径不存在: ${subPath}`
        }
      } else {
        // 挂载点不存在，提示用户需要先挂载
        status = 'disconnected'
        error = `SMB 共享未挂载。请先在 Finder 中连接到 smb://${connection.config.host}/${connection.config.share}`
      }
    } catch (err) {
      status = 'error'
      error = err instanceof Error ? err.message : '扫描失败'
    }
    
    // 更新连接信息
    connection.resourceCount = resources.length
    connection.lastScanned = new Date()
    connection.status = status
    connection.error = error
    
    // 保存到文件
    this.saveNasConnections()

    // 发送IPC消息到渲染进程
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send('nas-connection-scanned', {
        id,
        resources,
        status,
        error
      })
      // 同时发送更新后的列表
      this.mainWindow.webContents.send('nas-connections-updated', {
        connections: this.getAllNasConnections()
      })
    }
  }

  /**
   * 获取所有 NAS 连接
   */
  getAllNasConnections(): NasConnection[] {
    return Array.from(this.nasConnections.values())
  }

  /**
   * 获取 NAS 连接
   */
  getNasConnection(id: string): NasConnection | undefined {
    return this.nasConnections.get(id)
  }

  /**
   * 发现网络上的 SMB 服务器
   * 使用 macOS 的 dns-sd 或 smbclient 来发现网络上的服务器
   */
  async discoverNetworkServers(): Promise<{ servers: NetworkServer[]; error?: string }> {
    try {
      // 方法 1: 使用 smbclient 发现（如果可用）
      try {
        const { stdout } = await execAsync('which smbclient', { timeout: 5000 })
        if (stdout.trim()) {
          // smbclient 可用，使用它来发现服务器
          // 注意：smbclient -L 需要认证，这里我们只尝试列出
          // 实际上，macOS 的网络发现主要通过 Finder 的"网络"功能
          // 我们可以通过打开 smb:// 来让系统显示可用的服务器
          return {
            servers: [],
            error: '请使用 Finder 的"网络"功能查看可用服务器，或手动输入服务器地址'
          }
        }
      } catch {
        // smbclient 不可用，继续使用其他方法
      }

      // 方法 2: 使用 macOS 的网络浏览功能
      // 在 macOS 上，可以通过打开 smb:// 让系统显示网络上的服务器
      // 但无法直接获取列表，需要用户交互
      
      return {
        servers: [],
        error: 'macOS 上的网络发现需要通过 Finder 的"网络"功能。请手动输入服务器地址，或使用"浏览网络"按钮'
      }
    } catch (error) {
      return {
        servers: [],
        error: error instanceof Error ? error.message : '网络发现失败'
      }
    }
  }

  /**
   * 列出服务器上的可用共享
   * 使用 smbclient 或通过系统 API 获取
   */
  async listServerShares(host: string, username?: string, password?: string): Promise<{ shares: NetworkShare[]; error?: string }> {
    try {
      // 检查是否有 smbclient
      // 在 macOS 上，Electron 应用的 PATH 可能不包含 Homebrew 路径
      // 所以我们需要尝试多个可能的路径，或者直接尝试执行命令
      let smbclientPath = ''
      
      // 方法1: 优先尝试常见的 Homebrew 路径（Electron 的 PATH 可能不完整）
      const possiblePaths = [
        '/opt/homebrew/bin/smbclient',  // Apple Silicon Mac
        '/usr/local/bin/smbclient',      // Intel Mac
        '/opt/homebrew/opt/samba/bin/smbclient',  // 某些 Homebrew 安装路径
      ]
      
      for (const path of possiblePaths) {
        try {
          // 使用绝对路径执行，避免 PATH 问题
          const { stdout } = await execAsync(`"${path}" --version 2>&1`, { timeout: 5000 })
          if (stdout.trim() && !stdout.includes('command not found') && !stdout.includes('No such file')) {
            smbclientPath = path
            break
          }
        } catch (error: any) {
          // 检查错误信息，如果是文件不存在，继续尝试下一个
          const errorMsg = error.message || error.stderr || ''
          if (!errorMsg.includes('ENOENT') && !errorMsg.includes('No such file')) {
            // 其他错误可能表示命令存在但执行失败，也尝试使用
            try {
              const { stdout } = await execAsync(`"${path}" --version 2>&1`, { timeout: 5000 })
              if (stdout.trim()) {
                smbclientPath = path
                break
              }
            } catch {
              // 继续尝试下一个路径
            }
          }
        }
      }
      
      // 方法2: 尝试直接使用 smbclient 命令（如果 PATH 中有）
      if (!smbclientPath) {
        try {
          const { stdout } = await execAsync('smbclient --version 2>&1', { timeout: 5000 })
          if (stdout.trim() && !stdout.includes('command not found')) {
            smbclientPath = 'smbclient' // 使用命令名，让系统查找
          }
        } catch {
          // 继续尝试其他方法
        }
      }
      
      // 方法3: 尝试使用 which（如果 PATH 配置正确）
      if (!smbclientPath) {
        try {
          // 设置 PATH 环境变量，包含常见的 Homebrew 路径
          const env = {
            ...process.env,
            PATH: `${process.env.PATH || ''}:/opt/homebrew/bin:/usr/local/bin`
          }
          const { stdout } = await execAsync('which smbclient', { timeout: 5000, env })
          const path = stdout.trim()
          if (path && path.length > 0) {
            smbclientPath = path
          }
        } catch {
          // which 也找不到
        }
      }

      if (!smbclientPath) {
        // 如果没有 smbclient，提示用户安装或使用 Finder
        return {
          shares: [],
          error: '需要安装 smbclient 工具才能自动列出共享。安装方法：brew install samba。或者可以在 Finder 中连接到 smb://' + host + ' 查看可用共享'
        }
      }

      // 使用 smbclient 列出共享
      // 转义特殊字符，防止命令注入
      const safeHost = host.replace(/[;&|`$()]/g, '')
      const safeUsername = username ? username.replace(/[;&|`$()]/g, '') : undefined
      const safePassword = password ? password.replace(/[;&|`$()]/g, '') : undefined
      
      // 构建命令，使用检测到的 smbclient 路径
      // 注意：某些版本的 smbclient 不支持 --no-config，所以不使用该参数
      // 配置文件警告不会影响功能，会在 stderr 中过滤掉
      const smbclientCmd = smbclientPath === 'smbclient' ? 'smbclient' : `"${smbclientPath}"`
      let command = `${smbclientCmd} -L "${safeHost}" -N`
      if (safeUsername) {
        command = `${smbclientCmd} -L "${safeHost}" -U "${safeUsername}"`
        if (safePassword) {
          command += `%${safePassword}`
        }
      }

      try {
        // 设置环境变量，确保能找到 smbclient（如果使用相对路径）
        const env = {
          ...process.env,
          PATH: `${process.env.PATH || ''}:/opt/homebrew/bin:/usr/local/bin`
        }
        
        const { stdout, stderr } = await execAsync(command, {
          timeout: 10000,
          maxBuffer: 1024 * 1024, // 1MB
          env
        })

        // 过滤掉配置文件相关的警告信息
        // 这些警告不影响功能，但会在 stderr 中显示
        const filteredStderr = stderr
          ? stderr
              .split('\n')
              .filter(line => !line.includes('Can\'t load') && !line.includes('smb.conf') && !line.includes('testparm'))
              .join('\n')
          : ''

        // 解析 smbclient 输出
        const shares: NetworkShare[] = []
        const lines = stdout.split('\n')
        let inShareList = false

        for (const line of lines) {
          const trimmed = line.trim()
          
          // 跳过空行、配置文件警告和其他无关信息
          if (!trimmed || 
              trimmed.includes('Can\'t load') || 
              trimmed.includes('smb.conf') || 
              trimmed.includes('testparm') ||
              trimmed.includes('SMB1 disabled') ||
              trimmed.includes('no workgroup')) {
            continue
          }
          
          // 检测共享列表开始
          if (trimmed.startsWith('Sharename') || trimmed.startsWith('---------')) {
            if (trimmed.startsWith('Sharename')) {
              inShareList = true
            }
            continue
          }

          // 如果遇到分隔线，继续（不是结束）
          if (inShareList && trimmed.match(/^-+$/)) {
            continue
          }

          // 如果遇到其他部分（如 "SMB1 disabled"），停止解析
          if (inShareList && trimmed.includes('SMB')) {
            break
          }

          if (inShareList) {
            // 解析共享信息
            // 格式通常是: Sharename      Type      Comment
            // 例如: Teams           Disk      ZettLab shared folder
            const parts = trimmed.split(/\s{2,}/)
            if (parts.length >= 2) {
              const shareName = parts[0].trim()
              const shareType = parts[1].trim()
              
              // 跳过系统共享（通常以 $ 结尾，如 IPC$）
              if (!shareName.endsWith('$') && shareName !== 'IPC$' && shareName.length > 0) {
                shares.push({
                  name: shareName,
                  type: shareType,
                  comment: parts[2]?.trim() || ''
                })
              }
            }
          }
        }

        return { shares }
      } catch (execError: any) {
        // smbclient 可能返回错误，但可能仍然有输出
        if (execError.stdout) {
          // 尝试解析输出
          const shares: NetworkShare[] = []
          const lines = execError.stdout.split('\n')
          let inShareList = false

          for (const line of lines) {
            const trimmed = line.trim()
            if (trimmed.startsWith('Sharename')) {
              inShareList = true
              continue
            }
            if (inShareList && trimmed.includes('---')) {
              break
            }
            if (inShareList) {
              const parts = trimmed.split(/\s{2,}/)
              if (parts.length >= 2) {
                const shareName = parts[0].trim()
                const shareType = parts[1].trim()
                if (!shareName.endsWith('$') && shareName !== 'IPC$') {
                  shares.push({
                    name: shareName,
                    type: shareType,
                    comment: parts[2]?.trim()
                  })
                }
              }
            }
          }

          if (shares.length > 0) {
            return { shares }
          }
        }

        // 检查是否是认证错误
        const errorMsg = execError.stderr || execError.message || ''
        const stdoutMsg = execError.stdout || ''
        
        // 如果错误信息提到找不到命令，说明 smbclient 路径有问题
        if (errorMsg.includes('command not found') || errorMsg.includes('No such file') || errorMsg.includes('ENOENT')) {
          return {
            shares: [],
            error: '无法找到 smbclient 工具。请确保已安装：brew install samba。如果已安装，请重启应用'
          }
        }
        
        if (errorMsg.includes('NT_STATUS_LOGON_FAILURE') || errorMsg.includes('NT_STATUS_ACCESS_DENIED')) {
          return {
            shares: [],
            error: '认证失败，请检查用户名和密码。如果服务器允许匿名访问，请留空用户名和密码字段'
          }
        }
        
        if (errorMsg.includes('NT_STATUS_HOST_UNREACHABLE') || errorMsg.includes('Connection refused')) {
          return {
            shares: [],
            error: '无法连接到服务器，请检查服务器地址和网络连接'
          }
        }

        // 如果 stdout 中有内容，尝试解析（即使有错误）
        if (stdoutMsg && stdoutMsg.includes('Sharename')) {
          // 尝试解析输出
          const shares: NetworkShare[] = []
          const lines = stdoutMsg.split('\n')
          let inShareList = false

          for (const line of lines) {
            const trimmed = line.trim()
            if (trimmed.startsWith('Sharename')) {
              inShareList = true
              continue
            }
            if (inShareList && trimmed.includes('---')) {
              break
            }
            if (inShareList) {
              const parts = trimmed.split(/\s{2,}/)
              if (parts.length >= 2) {
                const shareName = parts[0].trim()
                const shareType = parts[1].trim()
                if (!shareName.endsWith('$') && shareName !== 'IPC$') {
                  shares.push({
                    name: shareName,
                    type: shareType,
                    comment: parts[2]?.trim()
                  })
                }
              }
            }
          }

          if (shares.length > 0) {
            return { shares }
          }
        }

        return {
          shares: [],
          error: errorMsg || '无法列出共享，请检查服务器地址和认证信息'
        }
      }
    } catch (error) {
      return {
        shares: [],
        error: error instanceof Error ? error.message : '列出共享失败'
      }
    }
  }

  /**
   * 打开网络浏览（让用户选择服务器和共享）
   * 在 macOS 上，打开 smb:// 让系统显示网络上的服务器
   */
  async openNetworkBrowser(): Promise<{ success: boolean; error?: string }> {
    try {
      // 打开 smb:// 让 macOS 显示网络上的服务器
      await shell.openExternal('smb://')
      return { success: true }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : '打开网络浏览失败'
      }
    }
  }

  /**
   * 打开/挂载 SMB 共享
   * 在 macOS 上，使用 shell.openExternal 打开 smb:// URL，系统会自动处理挂载
   */
  async openSmbShare(connectionId: string): Promise<{ success: boolean; error?: string }> {
    const connection = this.nasConnections.get(connectionId)
    if (!connection) {
      return { success: false, error: 'NAS 连接不存在' }
    }

    try {
      // 构建 SMB URL
      const smbUrl = buildSmbPath(connection.config)
      
      // 使用 shell.openExternal 打开 SMB URL
      // macOS 会自动处理挂载，如果已挂载则打开 Finder
      await shell.openExternal(smbUrl)
      
      return { success: true }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : '打开共享失败'
      }
    }
  }

  /**
   * 构建 NAS 资源的播放路径
   */
  buildResourcePath(connection: NasConnection, resourcePath: string): string {
    // 如果资源路径已经是完整路径，直接返回
    if (resourcePath.startsWith('smb://')) {
      return resourcePath
    }
    
    // 构建完整的 SMB 路径
    const smbPath = buildSmbPath(connection.config)
    
    // 如果资源路径是相对路径，拼接上去
    if (resourcePath.startsWith('/')) {
      return `${smbPath}${resourcePath}`
    } else {
      return `${smbPath}/${resourcePath}`
    }
  }

  /**
   * 读取 NAS 目录内容
   * @param connectionId NAS 连接ID
   * @param path 相对路径。如果为 undefined 或空字符串，访问配置的路径；如果为 '/'，访问挂载点根目录
   */
  async readNasDirectory(connectionId: string, path?: string): Promise<{ items: any[]; error?: string }> {
    const connection = this.nasConnections.get(connectionId)
    if (!connection) {
      throw new Error(`NAS 连接不存在: ${connectionId}`)
    }

    // 在 macOS 上，SMB 共享需要先挂载
    const volumesPath = '/Volumes'
    const shareName = connection.config.share
    const mountedPath = join(volumesPath, shareName)

    // 检查挂载点是否存在
    if (!existsSync(mountedPath)) {
      return {
        items: [],
        error: `SMB 共享未挂载。请先在 Finder 中连接到 smb://${connection.config.host}/${connection.config.share}`
      }
    }

    // 构建要读取的路径
    let targetPath = mountedPath
    
    // 如果 path 为 '/'，表示访问挂载点根目录
    if (path === '/') {
      targetPath = mountedPath
    } else if (path) {
      // 如果提供了路径，检查是否是相对于挂载点的路径
      if (path.startsWith('/Volumes/')) {
        targetPath = path
      } else if (path.startsWith('/')) {
        // 以 / 开头，相对于挂载点根目录
        targetPath = join(mountedPath, path)
      } else {
        // 相对路径，相对于配置的路径
        const basePath = connection.config.path || ''
        targetPath = join(mountedPath, basePath, path)
      }
    } else {
      // path 为 undefined 或空，使用配置的路径（如果存在）
      if (connection.config.path) {
        targetPath = join(mountedPath, connection.config.path)
      } else {
        targetPath = mountedPath
      }
    }

    // 检查路径是否存在
    if (!existsSync(targetPath)) {
      return {
        items: [],
        error: `路径不存在: ${targetPath}`
      }
    }

    try {
      // 读取目录结构（包含文件夹和文件）
      const { readdir, stat } = await import('fs/promises')
      const entries = await readdir(targetPath, { withFileTypes: true })

      const items: any[] = []
      for (const entry of entries) {
        const fullPath = join(targetPath, entry.name)
        try {
          const stats = await stat(fullPath)
          const isDirectory = entry.isDirectory()
          
          items.push({
            name: entry.name,
            path: fullPath,
            type: isDirectory ? 'directory' : 'file',
            size: isDirectory ? undefined : stats.size,
            modifiedAt: stats.mtime,
            isVideo: !isDirectory && isVideoFile(entry.name),
            extension: isDirectory ? undefined : extname(entry.name).toLowerCase().slice(1)
          })
        } catch (error) {
          // 忽略无法访问的文件/目录
          console.warn(`无法访问 ${fullPath}:`, error)
        }
      }

      // 排序：文件夹在前，然后按名称排序
      items.sort((a, b) => {
        if (a.type !== b.type) {
          return a.type === 'directory' ? -1 : 1
        }
        return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })
      })

      return { items }
    } catch (error) {
      return {
        items: [],
        error: error instanceof Error ? error.message : '读取目录失败'
      }
    }
  }
}

/**
 * 检查文件扩展名是否为视频文件
 */
function isVideoFile(fileName: string): boolean {
  const VIDEO_EXTENSIONS = [
    'mp4', 'avi', 'mkv', 'mov', 'wmv', 'flv', 'webm', 'm4v',
    'ts', 'm2ts', 'mts', 'm3u8', 'mpg', 'mpeg', 'vob', 'ogv',
    'rmvb', '3gp', 'asf', 'divx', 'xvid', 'f4v', 'rm', 'rmvb'
  ]
  const ext = extname(fileName).toLowerCase().slice(1)
  return VIDEO_EXTENSIONS.includes(ext)
}

/**
 * 网络服务器信息
 */
export interface NetworkServer {
  name: string
  address: string
  type: 'smb' | 'unknown'
}

/**
 * 网络共享信息
 */
export interface NetworkShare {
  name: string
  type: string
  comment?: string
}

// 单例
export const nasService = new NasService()
