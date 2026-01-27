# Cursor AI 工作流规则

> **版本**: 1.5.0  
> **最后更新**: 2026-01-26  
> **维护**: 如有问题请更新相应规则文件

## 📋 规则文件说明

本目录包含 MPV Player 项目的 Cursor AI 工作流规则，按主题拆分为多个文件：

- **core-principles.md** - 核心原则和强制规则
- **workflow.md** - 标准工作流程和规划模板
- **architecture.md** - 项目架构理解和特殊注意事项
- **code-standards.md** - 代码规范和最佳实践
- **code-reuse.md** - 代码模块管理和复用规则
- **documentation.md** - 文档管理规则
- **code-cleanup.md** - 代码清理规则

## 🎯 快速参考

### 核心原则
1. **先规划，再执行** - 任何代码修改必须先提供详细计划
   - 强制规则：对于任何代码修改请求，必须先提供详细的实现计划，只有在用户明确说"开始实现"、"执行"、"implement"、"go"等指令时，才进行代码修改。

2. **实时更新架构文档** - 代码变更时同步更新 `docs/ARCHITECTURE.md`
   - 强制规则：架构文档（`docs/ARCHITECTURE.md`）须随代码/架构变更在同一轮工作中实时更新，禁止等用户提醒后再补。凡涉及接口、数据结构、IPC、分层、状态机、文件路径等变更，必须在完成代码修改的同时更新架构文档相应章节与图表。

### 工作流程
1. 需求理解（Understand）
2. 代码分析（Analyze）
3. 规划制定（Plan）
4. 等待确认（Wait）
5. 执行实现（Implement）

### 重要规则
- ❌ 禁止创建重复代码/文档
- ✅ 必须先搜索现有实现
- ✅ 复用或扩展现有代码
- ✅ 定期清理无用代码

## 📚 相关文档

- **架构文档**：`docs/ARCHITECTURE.md`（**必须保持实时更新**）
- 规划模板：`docs/workflow/PLANNING_TEMPLATE.md`
- 提示词模板：`docs/workflow/PROMPT_TEMPLATES.md`
- 工作流检查清单：`docs/workflow/WORKFLOW_CHECKLIST.md`
- 更新日志：`docs/workflow/CHANGELOG.md`
