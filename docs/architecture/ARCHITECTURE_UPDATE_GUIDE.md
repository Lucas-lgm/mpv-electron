# 架构文档更新指南

> **目的**: 确保 `ARCHITECTURE.md` 文档与代码保持同步  
> **原则**: 代码变更时同步更新文档

## 📋 快速检查清单

在提交代码前，快速检查是否需要更新架构文档：

- [ ] 是否新增/修改/删除了接口？
- [ ] 是否新增/修改了数据结构？
- [ ] 是否新增/修改了IPC通道？
- [ ] 是否新增/重命名/移动了文件？
- [ ] 是否修改了状态机逻辑？
- [ ] 是否修改了架构设计？

**如果以上任何一项为"是"，则需要更新架构文档。**

## 🎯 常见更新场景

### 场景1：新增接口方法

**代码变更**：
```typescript
// src/main/corePlayer.ts
export interface CorePlayer {
  // 新增方法
  setPlaybackSpeed(speed: number): Promise<void>
}
```

**文档更新**：
1. 更新 `docs/ARCHITECTURE.md` 第3.3节（CorePlayer接口）
2. 添加方法说明
3. 添加使用示例（如需要）

### 场景2：修改数据结构

**代码变更**：
```typescript
// src/main/playerState.ts
export interface PlayerState {
  phase: PlayerPhase
  currentTime: number
  duration: number
  // 新增字段
  playbackSpeed: number
}
```

**文档更新**：
1. 更新 `docs/ARCHITECTURE.md` 第4.2节（PlayerState接口）
2. 添加新字段说明
3. 更新相关接口说明

### 场景3：新增IPC通道

**代码变更**：
```typescript
// src/main/ipcHandlers.ts
ipcMain.on('set-playback-speed', async (event, speed: number) => {
  // 处理逻辑
})
```

**文档更新**：
1. 更新 `docs/ARCHITECTURE.md` 第5.3节（IPC消息通道）
2. 添加到"渲染进程 → 主进程消息"表格
3. 添加通信示例（如需要）

### 场景4：新增文件

**代码变更**：
- 新增 `src/main/playbackSpeed.ts`

**文档更新**：
1. 更新 `docs/ARCHITECTURE.md` 第12.2节（文件路径参考）
2. 添加文件路径、功能描述、行数

### 场景5：文件重命名/移动

**代码变更**：
- `src/main/corePlayer.ts` → `src/main/mediaPlayer.ts`

**文档更新**：
1. 更新所有引用该文件的章节
2. 更新第12.2节（文件路径参考）
3. 更新架构图中的文件名

## 📝 更新步骤

### 步骤1：识别变更影响

根据代码变更，确定需要更新的章节：

| 代码变更 | 影响的章节 |
|---------|-----------|
| 接口变更 | 第3章（核心接口） |
| 数据结构变更 | 第4章（数据结构定义） |
| IPC变更 | 第5章（IPC通信设计） |
| 文件变更 | 第12.2节（文件路径参考） |
| 状态机变更 | 第8章（状态机设计） |
| 架构变更 | 第2章（整体分层架构） |

### 步骤2：更新文档内容

1. 打开 `docs/ARCHITECTURE.md`
2. 定位到相关章节
3. 更新内容，保持格式一致
4. 确保示例代码准确

### 步骤3：更新元数据

在文档末尾更新：
- **最后更新日期**
- **文档版本号**（如有重大变更）
- **更新历史**（第13.6节）

### 步骤4：验证一致性

- [ ] 文档内容与代码一致
- [ ] 示例代码可以运行
- [ ] 文件路径正确
- [ ] 行数统计准确

## 🔍 验证方法

### 方法1：对比代码和文档

```bash
# 检查接口是否一致
grep -r "export interface CorePlayer" src/main/
# 对比文档中的接口定义
```

### 方法2：检查文件路径

```bash
# 检查文档中列出的文件是否存在
grep "src/main/" docs/ARCHITECTURE.md | while read line; do
  file=$(echo $line | grep -o 'src/main/[^ ]*')
  if [ ! -f "$file" ]; then
    echo "文件不存在: $file"
  fi
done
```

### 方法3：检查行数

```bash
# 检查文件行数是否匹配
wc -l src/main/corePlayer.ts
# 对比文档中记录的行数
```

## ⚠️ 常见错误

### 错误1：忘记更新文档

**问题**：代码已变更，但文档未更新

**解决**：在 `.cursorrules` 中添加检查规则，代码变更时提醒更新文档

### 错误2：文档与代码不一致

**问题**：文档中的示例代码已过时

**解决**：定期审查文档，确保示例代码可以运行

### 错误3：文件路径错误

**问题**：文件已移动，但文档中的路径未更新

**解决**：使用脚本自动检查文件路径

## 🛠️ 自动化工具（可选）

可以创建脚本自动检查文档一致性：

```bash
#!/bin/bash
# scripts/check_architecture_doc.sh

# 检查文件是否存在
echo "检查文件路径..."
grep -o 'src/main/[^ ]*\.ts' docs/ARCHITECTURE.md | while read file; do
  if [ ! -f "$file" ]; then
    echo "❌ 文件不存在: $file"
  fi
done

# 检查行数是否匹配
echo "检查行数..."
# 实现行数检查逻辑
```

## 📚 参考

- 架构文档：`docs/ARCHITECTURE.md`
- 更新检查清单：`docs/ARCHITECTURE.md` 第13.3节
- 工作流规则：`.cursorrules`

## 🔄 更新记录

| 日期 | 更新内容 |
|------|---------|
| 2026-01-25 | 创建更新指南 |
