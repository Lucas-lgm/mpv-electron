# 项目文档索引

> **最后更新**: 2026-01-29
> **文档状态**: 活跃维护
> **同步策略**: 代码变更时同步更新文档

## 📚 文档目录结构

为保持职责单一和简洁，项目文档被组织为以下目录：

```
docs/
├── analysis/              # 深度分析与模式研究 (复杂问题的分析记录)
├── architecture/          # 核心架构与设计 (系统的"真理来源")
├── build/                 # 构建、部署与依赖管理
├── design/                # 功能设计方案与 UI 规范
├── guides/                # 开发者指南 (环境、测试、调试)
├── plans/                 # 路线图与重构计划
├── reference/             # API 参考与速查手册
└── workflow/              # 项目流程与 AI 协作规范
```

## 🎯 快速导航

### 新手入门
1. **环境搭建**: [Setup Guide](guides/SETUP_GUIDE.md)
2. **快速构建**: [Build Guide](build/BUILD.md)
3. **架构概览**: [Architecture](architecture/ARCHITECTURE.md)
4. **常见问题**: [Troubleshooting](guides/TROUBLESHOOTING.md)

### 核心开发
1. **架构规范**: [Architecture](architecture/ARCHITECTURE.md) (修改代码前必读)
2. **API 速查**: [API Reference](reference/API_REFERENCE.md)
3. **测试规范**: [Testing Guide](guides/TESTING_GUIDE.md)
4. **复杂分析**: [Analysis](analysis/) (查阅并发/状态机相关分析)

### 运维与发布
1. **部署发布**: [Deployment](build/DEPLOYMENT.md)
2. **依赖管理**: [Vendor Management](build/VENDOR_MANAGEMENT.md)
3. **Windows构建**: [Windows Build](build/BUILD_WINDOWS_MPV.md)

## 📖 目录详细说明

### 1. Architecture (`docs/architecture/`)
系统的核心设计文档。包含分层架构、IPC 通信、状态机设计、数据流向等全局性设计。
- **ARCHITECTURE.md**: 完整架构设计文档。**维护规则**: 任何接口、数据结构、文件路径的变更，必须立即同步到此文档。
- **ARCHITECTURE_UPDATE_GUIDE.md**: 架构文档更新操作指南。

### 2. Analysis (`docs/analysis/`)
针对特定难题或复杂模块的深度分析文档。记录了"为什么要这样做"的思考过程。
- 包含：并发模式、竞争条件分析、播放器核心关系分析等。

### 3. Build (`docs/build/`)
涵盖从源码编译 (libmpv) 到应用打包发布的全过程。
- **BUILD.md**: 通用构建指南。
- **DEPLOYMENT.md**: 打包与分发指南。
- **VENDOR_MANAGEMENT.md**: 第三方依赖管理。

### 4. Design (`docs/design/`)
具体功能的详细设计文档、UI 设计稿及草图。
- 包含：UI 重构草稿、新特性设计方案。

### 5. Guides (`docs/guides/`)
面向开发者的操作手册，包括环境配置、调试技巧和测试方法。
- **SETUP_GUIDE.md**: 从零开始的环境搭建。
- **TROUBLESHOOTING.md**: 故障排查手册。

### 6. Plans (`docs/plans/`)
未来的重构计划、路线图和待办事项。

### 7. Reference (`docs/reference/`)
代码和 API 的参考文档。
- **API_REFERENCE.md**: 核心接口的定义和使用说明。

### 8. Workflow (`docs/workflow/`)
团队协作规范、AI 辅助开发流程及模板。
