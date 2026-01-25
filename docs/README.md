# 项目文档索引

> **最后更新**: 2026-01-25  
> **文档状态**: 活跃维护  
> **同步策略**: 代码变更时同步更新文档

## 📚 文档结构

```
docs/
├── ARCHITECTURE.md                    # 核心架构文档（详细）
├── ARCHITECTURE_UPDATE_GUIDE.md       # 架构文档更新指南
├── BUILD.md                           # 快速构建指南
├── README.md                          # 本文件，文档索引
├── development/                       # 开发相关文档
│   ├── SETUP_GUIDE.md                 # 开发环境设置指南
│   ├── API_REFERENCE.md               # API快速参考手册
│   └── TROUBLESHOOTING.md             # 故障排除指南
├── deployment/                        # 部署相关文档
│   └── DEPLOYMENT.md                  # 完整部署指南（已整合所有部署相关内容）
├── features/                          # 特性文档
│   └── GPU_NEXT_INTEGRATION.md        # GPU-Next集成指南
├── plans/                             # 规划文档
│   └── PLANNING_SEMANTIC_REFACTORING.md # 语义化重构规划
└── workflow/                          # 开发工作流
    ├── README.md                      # 工作流介绍
    ├── PROMPT_TEMPLATES.md            # 提示词模板
    ├── WORKFLOW_CHECKLIST.md          # 工作流检查清单
    ├── EXAMPLES.md                    # 使用示例
    ├── PLANNING_TEMPLATE.md           # 规划文档模板
    └── CHANGELOG.md                   # 工作流更新日志
```

## 🎯 文档用途指南

### 新开发者
1. **快速构建**: 查看 [BUILD.md](BUILD.md) - 构建流程快速参考
2. **开始开发**: 阅读 [SETUP_GUIDE.md](development/SETUP_GUIDE.md)
3. **了解架构**: 阅读 [ARCHITECTURE.md](ARCHITECTURE.md)
4. **API参考**: 查看 [API_REFERENCE.md](development/API_REFERENCE.md)
5. **解决问题**: 参考 [TROUBLESHOOTING.md](development/TROUBLESHOOTING.md)

### 架构师/维护者
1. **系统设计**: 详细阅读 [ARCHITECTURE.md](ARCHITECTURE.md)
2. **架构更新**: 遵循 [ARCHITECTURE_UPDATE_GUIDE.md](ARCHITECTURE_UPDATE_GUIDE.md)
3. **重构规划**: 查看 [PLANNING_SEMANTIC_REFACTORING.md](plans/PLANNING_SEMANTIC_REFACTORING.md)

### 部署工程师
1. **打包部署**: 完整指南 [DEPLOYMENT.md](deployment/DEPLOYMENT.md)
2. **HDR配置**: 特性文档 [GPU_NEXT_INTEGRATION.md](features/GPU_NEXT_INTEGRATION.md)

### AI辅助开发
1. **工作流**: [workflow/README.md](workflow/README.md)
2. **模板**: [PROMPT_TEMPLATES.md](workflow/PROMPT_TEMPLATES.md)
3. **示例**: [EXAMPLES.md](workflow/EXAMPLES.md)

## 📖 核心文档说明

### 1. 架构文档 (ARCHITECTURE.md)
- **内容**: 完整的系统架构设计，1700+行详细说明
- **包含**: 分层架构、核心接口、数据结构、IPC设计、状态机、平台抽象
- **用途**: 理解系统设计、接口定义、数据流、模块关系
- **维护**: 代码变更时必须同步更新

### 2. 开发指南 (development/)
- **SETUP_GUIDE.md**: 开发环境设置，从零开始配置
- **VENDOR_MANAGEMENT.md**: Vendor 依赖管理，MPV 库构建和管理
- **API_REFERENCE.md**: 核心API快速参考，使用示例
- **TESTING_GUIDE.md**: 测试指南
- **TROUBLESHOOTING.md**: 常见问题解决方案，调试方法

### 3. 部署指南 (deployment/)
- **DEPLOYMENT.md**: 合并的部署指南，包含打包、分发、验证
- **archive/**: 历史文档，供参考

### 4. 特性文档 (features/)
- **GPU_NEXT_INTEGRATION.md**: gpu-next后端集成，HDR处理

### 5. 规划文档 (plans/)
- **PLANNING_SEMANTIC_REFACTORING.md**: 语义化重构详细规划

### 6. 工作流文档 (workflow/)
- **标准化开发流程**: "先规划，再执行"的工作流
- **模板化提示词**: 提高AI辅助开发效率
- **检查清单**: 确保开发质量

## 🔄 文档维护

### 更新原则
- **代码变更时同步更新文档**
- **接口变更更新ARCHITECTURE.md**
- **新增功能更新对应指南**
- **问题解决更新TROUBLESHOOTING.md**

### 更新检查清单
在提交代码前检查：
- [ ] 是否新增/修改/删除了接口？ → 更新ARCHITECTURE.md
- [ ] 是否新增/修改了数据结构？ → 更新ARCHITECTURE.md
- [ ] 是否新增/修改了IPC通道？ → 更新ARCHITECTURE.md
- [ ] 是否新增/重命名/移动了文件？ → 更新ARCHITECTURE.md
- [ ] 是否修改了架构设计？ → 更新ARCHITECTURE.md
- [ ] 是否解决了已知问题？ → 更新TROUBLESHOOTING.md
- [ ] 是否新增了配置步骤？ → 更新SETUP_GUIDE.md

### 版本兼容性
- 重大变更时更新文档版本号
- 保持向后兼容的文档引用
- 废弃的API标记为已弃用

## 📝 文档质量标准

### 完整性
- [ ] 有明确的目的和受众
- [ ] 包含必要的背景信息
- [ ] 提供完整的步骤说明
- [ ] 包含示例代码
- [ ] 有更新记录

### 准确性
- [ ] 与代码实现一致
- [ ] 示例代码可以运行
- [ ] 文件路径正确
- [ ] 版本信息准确

### 可读性
- [ ] 结构清晰，层次分明
- [ ] 使用适当的标题和列表
- [ ] 代码示例格式正确
- [ ] 链接有效

## 🤝 贡献文档

### 发现文档问题
1. **内容过时**: 文档与代码不一致
2. **信息缺失**: 缺少必要的说明
3. **错误信息**: 文档内容错误
4. **难以理解**: 表达不清或结构混乱

### 提交改进
1. **直接修改**: 提交Pull Request更新文档
2. **报告问题**: 创建Issue描述文档问题
3. **讨论改进**: 在相关讨论区提出建议

### 贡献流程
1. Fork仓库
2. 创建特性分支
3. 更新文档
4. 提交Pull Request
5. 等待审核合并

## 🔗 相关资源

- **项目主页**: [README.md](../README.md)
- **代码仓库**: GitHub仓库
- **问题跟踪**: GitHub Issues
- **讨论区**: GitHub Discussions

## 📊 文档状态

| 文档 | 状态 | 最后更新 | 维护者 |
|------|------|----------|--------|
| ARCHITECTURE.md | ✅ 活跃 | 2026-01-25 | 核心团队 |
| SETUP_GUIDE.md | ✅ 活跃 | 2026-01-25 | 核心团队 |
| API_REFERENCE.md | ✅ 活跃 | 2026-01-25 | 核心团队 |
| TROUBLESHOOTING.md | ✅ 活跃 | 2026-01-25 | 核心团队 |
| DEPLOYMENT.md | ✅ 活跃 | 2026-01-25 | 核心团队 |
| GPU_NEXT_INTEGRATION.md | ✅ 活跃 | 2026-01-25 | 核心团队 |
| PLANNING_SEMANTIC_REFACTORING.md | 📋 规划中 | 2026-01-25 | 核心团队 |
| workflow/文档 | ✅ 活跃 | 2026-01-25 | 核心团队 |

## 🆘 获取帮助

- **文档问题**: 提交Issue或PR
- **技术问题**: 查看TROUBLESHOOTING.md
- **架构问题**: 查看ARCHITECTURE.md
- **开发问题**: 查看SETUP_GUIDE.md

---

**保持文档更新是项目健康的重要指标！**  
**好文档 = 可维护的代码 + 高效的团队协作**