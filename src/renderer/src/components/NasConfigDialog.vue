<template>
  <el-dialog
    v-model="dialogVisible"
    title="添加 NAS 连接"
    width="600px"
    :close-on-click-modal="false"
    @close="handleCancel"
  >
    <el-form
      ref="formRef"
      :model="form"
      :rules="rules"
      label-width="100px"
      label-position="left"
    >
      <el-form-item label="连接名称" prop="name">
        <el-input
          v-model="form.name"
          placeholder="例如：家庭 NAS"
          clearable
        />
      </el-form-item>
      
      <el-form-item label="协议" prop="protocol">
        <el-select
          v-model="form.protocol"
          placeholder="选择协议"
          style="width: 100%"
          disabled
        >
          <el-option label="SMB/CIFS" value="smb" />
        </el-select>
      </el-form-item>
      
      <el-form-item label="主机地址" prop="host">
        <div style="display: flex; gap: 8px; width: 100%;">
          <el-input
            v-model="form.host"
            placeholder="例如：192.168.1.100 或 nas.example.com"
            clearable
            style="flex: 1"
          />
          <el-button
            size="small"
            @click="handleBrowseNetwork"
            title="打开 Finder 浏览网络上的服务器"
          >
            🌐 浏览网络
          </el-button>
        </div>
        <div class="form-item-hint">
          💡 提示：在 Finder 的网络窗口中，可以查看服务器地址，然后回到这里输入
        </div>
      </el-form-item>
      
      <el-form-item label="共享名称" prop="share">
        <div style="display: flex; gap: 8px; width: 100%;">
          <el-input
            v-model="form.share"
            placeholder="例如：Movies"
            clearable
            style="flex: 1"
          />
          <el-button
            v-if="form.host"
            size="small"
            :loading="loadingShares"
            @click="handleListShares"
            title="列出服务器上的可用共享（需要安装 smbclient 工具）"
          >
            📋 列出共享
          </el-button>
        </div>
        <div v-if="availableShares.length > 0" class="shares-list">
          <div class="shares-list-title">可用共享（点击选择）：</div>
          <div class="shares-list-items">
            <div
              v-for="share in availableShares"
              :key="share.name"
              class="share-item"
              @click="handleSelectShare(share.name)"
            >
              <span class="share-icon">📁</span>
              <span class="share-name">{{ share.name }}</span>
              <span v-if="share.comment" class="share-comment">{{ share.comment }}</span>
            </div>
          </div>
        </div>
        <div v-else-if="loadingShares" class="form-item-hint">
          ⏳ 正在列出共享，请稍候...（可能需要几秒钟）
        </div>
        <div v-else class="form-item-hint">
          💡 提示：
          <ul style="margin: 4px 0; padding-left: 20px; line-height: 1.6;">
            <li>点击"列出共享"按钮查看服务器上的可用共享</li>
            <li>如果提示需要 smbclient，请安装：<code style="background: rgba(74,158,255,0.2); padding: 2px 4px; border-radius: 2px;">brew install samba</code></li>
            <li>或者可以在 Finder 中连接到 <code style="background: rgba(74,158,255,0.2); padding: 2px 4px; border-radius: 2px;">smb://{{ form.host || "服务器地址" }}</code> 查看可用共享</li>
          </ul>
        </div>
      </el-form-item>
      
      <el-form-item label="路径" prop="path">
        <el-input
          v-model="form.path"
          placeholder="可选，共享内的子路径，例如：/Videos/Movies"
          clearable
        />
      </el-form-item>
      
      <el-form-item label="端口" prop="port">
        <el-input-number
          v-model="form.port"
          :min="1"
          :max="65535"
          placeholder="默认 445"
          style="width: 100%"
        />
      </el-form-item>
      
      <el-form-item label="用户名" prop="username">
        <el-input
          v-model="form.username"
          placeholder="可选"
          clearable
        />
      </el-form-item>
      
      <el-form-item label="密码" prop="password">
        <el-input
          v-model="form.password"
          type="password"
          placeholder="可选"
          show-password
          clearable
        />
      </el-form-item>
      
      <el-form-item v-if="testResult" label="连接测试">
        <div :class="['test-result', testResult.success ? 'success' : 'error']">
          <span v-if="testResult.success">✓ 配置验证通过</span>
          <span v-else>✗ {{ testResult.error }}</span>
        </div>
      </el-form-item>
    </el-form>
    
    <template #footer>
      <span class="dialog-footer">
        <el-button @click="handleCancel">取消</el-button>
        <el-button
          :loading="testing"
          @click="handleTest"
        >
          测试连接
        </el-button>
        <el-button
          type="primary"
          :loading="submitting"
          @click="handleConfirm"
        >
          确定
        </el-button>
      </span>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { ref, reactive, computed } from 'vue'
import { ElMessage, type FormInstance, type FormRules } from 'element-plus'
import type { NasConfig } from '../types/mount'

interface Props {
  modelValue: boolean
}

interface Emits {
  (e: 'update:modelValue', value: boolean): void
  (e: 'confirm', config: { name: string; config: NasConfig }): void
}

const props = defineProps<Props>()
const emit = defineEmits<Emits>()

const formRef = ref<FormInstance>()
const testing = ref(false)
const submitting = ref(false)
const testResult = ref<{ success: boolean; error?: string } | null>(null)
const loadingShares = ref(false)
const availableShares = ref<Array<{ name: string; type: string; comment?: string }>>([])

const form = reactive({
  name: '',
  protocol: 'smb' as const,
  host: '',
  share: '',
  path: '',
  port: 445,
  username: '',
  password: ''
})

const rules: FormRules = {
  name: [
    { required: true, message: '请输入连接名称', trigger: 'blur' }
  ],
  host: [
    { required: true, message: '请输入主机地址', trigger: 'blur' },
    {
      pattern: /^([a-zA-Z0-9]([a-zA-Z0-9\-]{0,61}[a-zA-Z0-9])?\.)*[a-zA-Z0-9]([a-zA-Z0-9\-]{0,61}[a-zA-Z0-9])?$|^(\d{1,3}\.){3}\d{1,3}$/,
      message: '请输入有效的主机地址（IP 或域名）',
      trigger: 'blur'
    }
  ],
  share: [
    { required: true, message: '请输入共享名称', trigger: 'blur' }
  ],
  port: [
    { type: 'number', min: 1, max: 65535, message: '端口号必须在 1-65535 之间', trigger: 'blur' }
  ]
}

// 使用 computed 处理双向绑定，避免循环更新
const dialogVisible = computed({
  get: () => props.modelValue,
  set: (val: boolean) => {
    emit('update:modelValue', val)
    if (val) {
      // 打开对话框时重置表单
      resetForm()
    }
  }
})

// 重置表单
const resetForm = () => {
  form.name = ''
  form.protocol = 'smb'
  form.host = ''
  form.share = ''
  form.path = ''
  form.port = 445
  form.username = ''
  form.password = ''
  testResult.value = null
  availableShares.value = []
  formRef.value?.clearValidate()
}

// 测试连接
const handleTest = async () => {
  if (!formRef.value) return
  
  await formRef.value.validate(async (valid: boolean) => {
    if (!valid) return
    
    if (!window.electronAPI) {
      ElMessage.error('无法连接到主进程')
      return
    }
    
    testing.value = true
    testResult.value = null
    
    try {
      const config: NasConfig = {
        protocol: form.protocol,
        host: form.host,
        share: form.share,
        path: form.path || undefined,
        port: form.port || undefined,
        username: form.username || undefined,
        password: form.password || undefined
      }
      
      // 发送测试连接请求
      const result = await new Promise<{ success: boolean; error?: string }>((resolve) => {
        const handler = (data: { success: boolean; error?: string }) => {
          window.electronAPI.removeListener('nas-test-connection-result', handler)
          resolve(data)
        }
        window.electronAPI.on('nas-test-connection-result', handler)
        window.electronAPI.send('nas-test-connection', { config })
        
        // 超时处理
        setTimeout(() => {
          window.electronAPI.removeListener('nas-test-connection-result', handler)
          resolve({ success: false, error: '连接测试超时' })
        }, 10000)
      })
      
      testResult.value = result
      
      if (result.success) {
        ElMessage.success('配置验证通过')
      } else {
        ElMessage.error(result.error || '连接测试失败')
      }
    } catch (error) {
      ElMessage.error('测试连接时发生错误')
      console.error('测试连接失败:', error)
    } finally {
      testing.value = false
    }
  })
}

// 确认添加
const handleConfirm = async () => {
  if (!formRef.value) return
  
  await formRef.value.validate(async (valid: boolean) => {
    if (!valid) return
    
    if (!testResult.value || !testResult.value.success) {
      ElMessage.warning('请先测试连接')
      return
    }
    
    submitting.value = true
    
    try {
      const config: NasConfig = {
        protocol: form.protocol,
        host: form.host,
        share: form.share,
        path: form.path || undefined,
        port: form.port || undefined,
        username: form.username || undefined,
        password: form.password || undefined
      }
      
      emit('confirm', {
        name: form.name,
        config
      })
      
      dialogVisible.value = false
      resetForm()
    } catch (error) {
      ElMessage.error('添加 NAS 连接失败')
      console.error('添加 NAS 连接失败:', error)
    } finally {
      submitting.value = false
    }
  })
}

// 浏览网络
const handleBrowseNetwork = async () => {
  if (!window.electronAPI) {
    ElMessage.error('无法连接到主进程')
    return
  }

  try {
    const result = await new Promise<{ success: boolean; error?: string }>((resolve) => {
      const handler = (data: { success: boolean; error?: string }) => {
        window.electronAPI.removeListener('nas-open-network-browser-result', handler)
        resolve(data)
      }
      window.electronAPI.on('nas-open-network-browser-result', handler)
      window.electronAPI.send('nas-open-network-browser')
      
      setTimeout(() => {
        window.electronAPI.removeListener('nas-open-network-browser-result', handler)
        resolve({ success: false, error: '操作超时' })
      }, 5000)
    })

    if (result.success) {
      ElMessage({
        message: '已打开网络浏览窗口。提示：在 Finder 中选择服务器后，可以查看服务器地址，然后回到这里输入地址并点击"列出共享"按钮',
        type: 'info',
        duration: 5000,
        showClose: true
      })
    } else {
      ElMessage.error(result.error || '打开网络浏览失败')
    }
  } catch (error) {
    ElMessage.error('打开网络浏览时发生错误')
    console.error('打开网络浏览失败:', error)
  }
}

// 列出共享
const handleListShares = async () => {
  if (!window.electronAPI || !form.host) {
    ElMessage.warning('请先输入主机地址')
    return
  }

  loadingShares.value = true
  availableShares.value = []

  try {
    const result = await new Promise<{ shares: Array<{ name: string; type: string; comment?: string }>; error?: string }>((resolve) => {
      const handler = (data: { shares: Array<{ name: string; type: string; comment?: string }>; error?: string }) => {
        window.electronAPI.removeListener('nas-list-shares-result', handler)
        resolve(data)
      }
      window.electronAPI.on('nas-list-shares-result', handler)
      window.electronAPI.send('nas-list-shares', {
        host: form.host,
        username: form.username || undefined,
        password: form.password || undefined
      })
      
      setTimeout(() => {
        window.electronAPI.removeListener('nas-list-shares-result', handler)
        resolve({ shares: [], error: '操作超时（可能需要安装 smbclient 工具）' })
      }, 15000)
    })

    if (result.error) {
      // 如果错误信息提到 smbclient，提供更详细的帮助
      if (result.error.includes('smbclient') || result.error.includes('需要安装')) {
        ElMessage({
          message: '需要安装 smbclient 工具才能自动列出共享。安装方法：在终端运行 "brew install samba"。或者可以在 Finder 中连接到 smb://' + form.host + ' 查看可用共享，然后手动输入共享名称',
          type: 'warning',
          duration: 8000,
          showClose: true
        })
      } else if (result.error.includes('认证') || result.error.includes('密码') || result.error.includes('denied')) {
        ElMessage.warning('认证失败，请检查用户名和密码。如果服务器需要认证，请先填写用户名和密码字段')
      } else {
        ElMessage.warning(result.error)
      }
    }

    availableShares.value = result.shares

    if (result.shares.length > 0) {
      ElMessage.success(`找到 ${result.shares.length} 个共享，点击共享名称即可选择`)
    } else if (!result.error) {
      ElMessage.info('未找到可用共享，请检查服务器地址和认证信息')
    } else if (result.error && !result.error.includes('smbclient')) {
      // 如果有错误但不是 smbclient 相关的，可能是有共享但解析失败
      ElMessage.info('如果服务器上有共享，可以在 Finder 中手动查看：smb://' + form.host)
    }
  } catch (error) {
    ElMessage.error('列出共享时发生错误')
    console.error('列出共享失败:', error)
  } finally {
    loadingShares.value = false
  }
}

// 选择共享
const handleSelectShare = (shareName: string) => {
  form.share = shareName
  ElMessage.success(`已选择共享：${shareName}`)
}

// 取消
const handleCancel = () => {
  dialogVisible.value = false
  resetForm()
}
</script>

<style scoped>
.dialog-footer {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
}

.test-result {
  padding: 8px 12px;
  border-radius: 4px;
  font-size: 0.9rem;
}

.test-result.success {
  background: rgba(67, 160, 71, 0.1);
  color: #43a047;
  border: 1px solid rgba(67, 160, 71, 0.3);
}

.test-result.error {
  background: rgba(244, 67, 54, 0.1);
  color: #f44336;
  border: 1px solid rgba(244, 67, 54, 0.3);
}

.shares-list {
  margin-top: 12px;
  padding: 12px;
  background: rgba(74, 158, 255, 0.05);
  border: 1px solid rgba(74, 158, 255, 0.2);
  border-radius: 6px;
  max-height: 200px;
  overflow-y: auto;
}

.shares-list-title {
  font-size: 0.85rem;
  color: #4a9eff;
  font-weight: 500;
  margin-bottom: 8px;
}

.shares-list-items {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.share-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  background: rgba(74, 158, 255, 0.1);
  border: 1px solid rgba(74, 158, 255, 0.2);
  border-radius: 4px;
  cursor: pointer;
  transition: all 0.2s;
}

.share-item:hover {
  background: rgba(74, 158, 255, 0.2);
  border-color: rgba(74, 158, 255, 0.4);
  transform: translateX(2px);
}

.share-icon {
  font-size: 1rem;
}

.share-name {
  flex: 1;
  font-weight: 500;
  color: #fff;
  font-size: 0.9rem;
}

.share-comment {
  font-size: 0.75rem;
  color: #888;
  font-style: italic;
}

.form-item-hint {
  margin-top: 6px;
  font-size: 0.75rem;
  color: #888;
  line-height: 1.4;
}

.form-item-hint ul {
  margin: 4px 0;
  padding-left: 20px;
}

.form-item-hint li {
  margin-bottom: 2px;
}

.form-item-hint code {
  background: rgba(74, 158, 255, 0.2);
  padding: 2px 6px;
  border-radius: 3px;
  font-family: 'Monaco', 'Menlo', 'Courier New', monospace;
  font-size: 0.85em;
  color: #4a9eff;
}
</style>

<style>
/* 全局样式覆盖 - 统一项目风格 */
:deep(.el-dialog) {
  background: #25252d;
  border: 1px solid #2d2d35;
  border-radius: 8px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4);
}

:deep(.el-dialog__header) {
  background: #25252d;
  border-bottom: 1px solid #2d2d35;
  padding: 16px 20px;
}

:deep(.el-dialog__title) {
  color: #ffffff;
  font-weight: 600;
  font-size: 1rem;
}

:deep(.el-dialog__headerbtn) {
  top: 16px;
  right: 20px;
}

:deep(.el-dialog__close) {
  color: #ccc;
  font-size: 18px;
}

:deep(.el-dialog__close:hover) {
  color: #ffffff;
}

:deep(.el-dialog__body) {
  background: #25252d;
  padding: 20px;
  color: #ffffff;
}

:deep(.el-form-item__label) {
  color: #cccccc;
  font-size: 0.9rem;
}

:deep(.el-input__wrapper) {
  background: #1e1e24;
  border: 1px solid #2d2d35;
  border-radius: 6px;
  box-shadow: none;
}

:deep(.el-input__wrapper:hover) {
  border-color: #4a9eff;
}

:deep(.el-input__wrapper.is-focus) {
  border-color: #4a9eff;
  box-shadow: 0 0 0 1px #4a9eff inset;
}

:deep(.el-input__inner) {
  color: #ffffff;
  background: transparent;
}

:deep(.el-input__inner::placeholder) {
  color: #888888;
}

:deep(.el-select) {
  width: 100%;
}

:deep(.el-select .el-input__wrapper) {
  background: #1e1e24;
  border: 1px solid #2d2d35;
}

:deep(.el-input-number) {
  width: 100%;
}

:deep(.el-input-number .el-input__wrapper) {
  background: #1e1e24;
  border: 1px solid #2d2d35;
}

:deep(.el-dialog__footer) {
  background: #25252d;
  border-top: 1px solid #2d2d35;
  padding: 12px 20px;
}

:deep(.el-button) {
  border-radius: 6px;
  padding: 8px 16px;
  font-weight: 500;
  transition: all 0.2s;
}

:deep(.el-button--default),
:deep(.el-button:not(.el-button--primary)) {
  background: #2a2a32 !important;
  border-color: #2d2d35 !important;
  color: #cccccc !important;
}

:deep(.el-button--default:hover),
:deep(.el-button:not(.el-button--primary):hover) {
  background: #2d2d35 !important;
  border-color: #3a3a42 !important;
  color: #ffffff !important;
}

:deep(.el-button--primary) {
  background: #4a9eff;
  border-color: #4a9eff;
  color: #ffffff;
}

:deep(.el-button--primary:hover) {
  background: #5aaaff;
  border-color: #5aaaff;
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(74, 158, 255, 0.3);
}

:deep(.el-button--primary:active) {
  transform: translateY(0);
}
</style>
