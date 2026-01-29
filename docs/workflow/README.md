# Cursor AI 工作流文档

> **目的**: 沉淀和标准化 Cursor AI 辅助开发的工作流程  
> **原则**: 先规划，再执行  
> **维护**: 发现问题请及时更新相关文档

## 📁 文档结构

```
docs/workflow/
├── README.md                    # 本文件，工作流文档索引
├── PLANNING_TEMPLATE.md         # 规划文档模板
├── PROMPT_TEMPLATES.md          # 提示词模板库
├── TRAE_CONFIG.md               # Trae 环境配置与使用指南
├── WORKFLOW_CHECKLIST.md        # 工作流检查清单
├── CHANGELOG.md                 # 工作流文档更新日志
└── EXAMPLES.md                   # 实际使用示例
```

## 🚀 快速开始

1. **阅读核心规则**: 查看项目根目录的 `.cursorrules` 文件
2. **选择模板**: 根据任务类型选择 `PROMPT_TEMPLATES.md` 中的模板
3. **制定规划**: 使用 `PLANNING_TEMPLATE.md` 创建规划文档
4. **执行检查**: 使用 `WORKFLOW_CHECKLIST.md` 确保流程完整

## 📖 文档说明

### `.cursorrules`
项目根目录的 Cursor 配置文件，定义 AI 行为规则。**这是最重要的文件**。

### PLANNING_TEMPLATE.md
标准化的规划文档模板，用于记录功能开发计划。

### PROMPT_TEMPLATES.md
常用提示词模板，快速启动不同类型的任务。

### WORKFLOW_CHECKLIST.md
工作流检查清单，确保每个步骤都完成。

### CHANGELOG.md
工作流文档的更新历史，记录改进和修正。

### EXAMPLES.md
实际使用示例，展示如何应用工作流。

## 🔄 更新流程

当发现工作流文档有问题时：

1. **识别问题**: 明确问题所在（规则、模板、流程等）
2. **更新文档**: 修改相应的文档文件
3. **记录变更**: 在 `CHANGELOG.md` 中记录更新
4. **验证效果**: 在实际使用中验证更新是否有效

## 💡 最佳实践

- **保持更新**: 发现问题时及时更新文档
- **记录经验**: 将好的实践沉淀到模板中
- **持续改进**: 根据实际使用情况优化工作流
- **团队共享**: 确保团队成员都了解工作流

## 📝 贡献

如果你发现工作流有问题或可以改进的地方：

1. 更新相应的文档
2. 在 `CHANGELOG.md` 中记录变更
3. 如果涉及核心规则，更新 `.cursorrules` 的版本号
