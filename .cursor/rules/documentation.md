# 文档管理规则

> **版本**: 1.5.0  
> **最后更新**: 2026-01-26

## 📄 文档管理规则

**强制规则：任何时候都不能生成重复文档。如果发现已有相关文档，必须更新现有文档，而不是创建新文档。**

### 文档创建前检查

在创建任何文档之前，必须：

1. **搜索现有文档**：
   - 使用 `glob_file_search` 或 `grep` 搜索相关主题的文档
   - 检查 `docs/` 目录下的所有子目录
   - 检查文件名是否相似（如 `TEST.md`, `TESTING.md`, `HOW_TO_TEST.md` 等）

2. **识别重复内容**：
   - 如果发现主题相似的文档，必须合并内容
   - 更新现有文档而不是创建新文档
   - 删除重复或过时的文档

3. **文档命名规范**：
   - 使用清晰、描述性的文件名
   - 避免创建多个功能相似的文档
   - 优先更新现有文档

### 文档更新流程

1. **发现需要创建文档时**：
   - 先搜索是否已有相关文档
   - 如果有，更新现有文档
   - 如果没有，创建新文档

2. **发现重复文档时**：
   - 合并内容到最合适的文档
   - 更新文档的"最后更新"日期
   - 删除重复的文档

3. **文档更新检查清单**：
   - [ ] 已搜索现有文档
   - [ ] 已合并重复内容
   - [ ] 已更新"最后更新"日期
   - [ ] 已删除重复文档
   - [ ] 文档内容完整且准确

### 示例

**错误做法**：
- 创建 `docs/development/TEST.md`
- 创建 `docs/development/TESTING.md`
- 创建 `docs/development/HOW_TO_TEST.md`
- 创建 `docs/development/QUICK_TEST.md`

**正确做法**：
- 搜索发现已有 `docs/development/TESTING_GUIDE.md`
- 更新 `TESTING_GUIDE.md` 添加新内容
- 删除其他重复文档

## 📚 参考文档

- 规划模板：`docs/workflow/PLANNING_TEMPLATE.md`
- 提示词模板：`docs/workflow/PROMPT_TEMPLATES.md`
- 工作流检查清单：`docs/workflow/WORKFLOW_CHECKLIST.md`
- 更新日志：`docs/workflow/CHANGELOG.md`
- **架构文档**：`docs/ARCHITECTURE.md`（**必须保持实时更新**）
