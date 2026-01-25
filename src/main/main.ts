import { videoPlayerApp } from './videoPlayerApp'

// 开发模式下自动运行领域模型测试
if (process.env.NODE_ENV === 'development') {
  import('./test_semantic_refactoring').then(({ testDomainModels }) => {
    console.log('\n🧪 ========== 自动运行领域模型测试 ==========\n')
    testDomainModels()
  }).catch((err) => {
    console.error('❌ 测试加载失败:', err.message)
  })
}

videoPlayerApp.init()

export const windowManager = videoPlayerApp.windowManager
export const createVideoWindow = () => videoPlayerApp.createVideoWindow()
