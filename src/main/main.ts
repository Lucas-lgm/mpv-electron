import { runApp, getWindowManager } from './application/bootstrap'

if (process.env.NODE_ENV === 'development') {
  import('./test_semantic_refactoring').then(async ({ testDomainModels }) => {
    console.log('\n🧪 ========== 自动运行领域模型测试 ==========\n')
    await testDomainModels()
  }).catch((err) => {
    console.error('❌ 测试加载失败:', err.message)
  })
}

runApp()

export { getWindowManager }
