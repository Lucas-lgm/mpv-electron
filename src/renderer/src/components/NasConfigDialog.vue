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
        <el-input
          v-model="form.host"
          placeholder="例如：192.168.1.100 或 nas.example.com"
          clearable
        />
      </el-form-item>
      
      <el-form-item label="共享名称" prop="share">
        <el-input
          v-model="form.share"
          placeholder="例如：Movies"
          clearable
        />
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
import { ref, reactive, watch } from 'vue'
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

const dialogVisible = ref(props.modelValue)
const formRef = ref<FormInstance>()
const testing = ref(false)
const submitting = ref(false)
const testResult = ref<{ success: boolean; error?: string } | null>(null)

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

// 监听 modelValue 变化
watch(() => props.modelValue, (val) => {
  dialogVisible.value = val
  if (val) {
    // 重置表单
    resetForm()
  }
})

// 监听 dialogVisible 变化
watch(dialogVisible, (val) => {
  emit('update:modelValue', val)
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
  formRef.value?.clearValidate()
}

// 测试连接
const handleTest = async () => {
  if (!formRef.value) return
  
  await formRef.value.validate(async (valid) => {
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
  
  await formRef.value.validate(async (valid) => {
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
