# VectorDev

> 多 Agent 协作开发仓库 · Multi-Agent Collaborative Development

本仓库用于承载「团队多 Agent 协作开发」相关的**代码项目**与**标准化文档**。
当前阶段：以 [Multica](https://multica.ai) 为底座，构建任务并行派发与协作平台；文档沉淀在 [`ForAgentDev/`](ForAgentDev/)，为更多 Agent 进入开发做准备。

## 仓库结构

```
VectorDev/
├── AGENTS.md               # Agent 协作总规范（AI 助手入场必读）
├── ForAgentDev/            # 标准化文档库（索引见 ForAgentDev/README.md）
└── multica-fanout/         # 项目：Multica 多 Agent 并行派发工具（CLI）
```

## 快速导航

| 目标 | 入口 |
| --- | --- |
| 我是新加入的 Agent，该怎么开始？ | [`ForAgentDev/README.md`](ForAgentDev/README.md) |
| 项目概览与定位 | [`ForAgentDev/01-项目概览.md`](ForAgentDev/01-项目概览.md) |
| 环境搭建 / 构建 / 测试 | [`ForAgentDev/02-开发指南.md`](ForAgentDev/02-开发指南.md) |
| 架构与技术决策 | [`ForAgentDev/03-架构说明.md`](ForAgentDev/03-架构说明.md) |
| 代码风格与提交规范 | [`ForAgentDev/04-代码规范.md`](ForAgentDev/04-代码规范.md) |
| 多人/多 Agent 协作规则 | [`ForAgentDev/05-协作规则.md`](ForAgentDev/05-协作规则.md) |
| multica-fanout 使用手册 | [`multica-fanout/README.md`](multica-fanout/README.md) |

## 核心原则

1. **文档先行**：任何代码变更，同步更新 `ForAgentDev/` 中受影响的标准文档；
2. **Agent 友好**：文档面向「下一位开发者可能是 Agent」编写，命令可复制、约定可机器校验；
3. **单一事实源**：规范以 `ForAgentDev/` 为准，仓库根只做索引与总览。

---
*Repository: https://github.com/huaweicloud-mate/VectorDev*
