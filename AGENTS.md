# AGENTS.md — Agent 协作总规范

> 本文件面向「进入本仓库工作的 AI Agent / 人类开发者」。
> GitHub 会将本文件自动注入给仓库内的 AI 辅助工具，是最高优先级的协作约定。

## 1. 你是谁

你是一名加入 **VectorDev** 仓库的开发者（可能是人类，也可能是 AI Agent）。
你的任务是完成被指派（通常经 Multica Issue 分配）的工作，并遵守本仓库的全部约定。

## 2. 入场必读（按顺序）

1. 本文件（AGENTS.md）
2. [`ForAgentDev/README.md`](ForAgentDev/README.md) — 文档索引
3. [`ForAgentDev/01-项目概览.md`](ForAgentDev/01-项目概览.md) — 项目是什么、为什么存在
4. [`ForAgentDev/02-开发指南.md`](ForAgentDev/02-开发指南.md) — 环境、命令、构建、测试
5. [`ForAgentDev/05-协作规则.md`](ForAgentDev/05-协作规则.md) — 任务、分支、提交、PR 约定

## 3. 硬性约定（必须遵守）

- **不改动职责范围外的代码**：任务边界在 Issue 中定义，超出范围先评论确认；
- **文档同步**：改了行为/接口/命令，必须同步更新 `ForAgentDev/` 对应文档；
- **不提交敏感信息**：token、密钥、`.env` 一律不提交（见 `.gitignore`）；
- **提交前自测**：运行 `npm test`，确保通过后再提交；
- **一次一个职责**：一个 PR 只做一件事，便于人类审查。

## 4. 任务流转（与 Multica 联动）

- 本仓库的开发任务通过 Multica Issue 分配与跟踪；
- Agent 领取任务后：`backlog/todo → in_progress → in_review → done`；
- 产出/结论写回 Issue 评论，跨 Agent 沟通用评论 @mention；
- 并行任务（多 Agent 同时工作）遵循 `ForAgentDev/05-协作规则.md` 的隔离约定。

## 5. 冲突规避（多 Agent 并行）

- 每个 Agent 的产出写入**自己的独立路径**（Issue 描述中会指定）；
- 修改共享文件（本 AGENTS.md、`ForAgentDev/` 文档）前，先确认无人在改（看 Issue 状态 / PR）；
- 分支命名：`feat/<issue-key>-<简述>`（如 `feat/MUL-42-batch-dispatch`）。

## 6. 质量红线

| 检查项 | 要求 |
| --- | --- |
| 测试 | `npm test` 全绿（每个项目目录内） |
| 文档 | 受影响文档已更新 |
| 保密 | 无密钥/敏感信息入库 |
| 可读性 | 命名清晰、有注释、面向「下一个开发者」 |

---
*冲突时：AGENTS.md > ForAgentDev/ 文档 > 项目内 README。*
