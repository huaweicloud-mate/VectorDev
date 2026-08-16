# multica-fanout

基于 [Multica CLI](https://multica.ai/docs/zh) 的**团队多 Agent 并行派发工具**：1 个父 Issue + N 个子 Issue，多视角并行执行，最后自动聚合。

> Multica 原生**不支持**「一个 Issue 同时派发给多个 Agent」（分配模型是 1:1）。
> 本工具实现官方认可的并行模式：**父 Issue 聚合 + 子 Issue 并行（全 `todo`）**。

## 解决的问题

| 场景 | 说明 |
| --- | --- |
| 一个任务，多个 Agent 并行跑 | 创建 1 个父 Issue + N 个子 Issue，各分配给一个 Agent，全部 `todo` 并行执行 |
| 多视角产出（同一目标） | 每个子 Issue 注入独立「视角」与统一产出规范，避免文件冲突 |
| 进度可视化 | `fanout status` 实时查看 N 个子任务状态（done/in_review/in_progress/todo） |
| 结果聚合 | `fanout aggregate` 收集各 Agent 评论产出 → 本地文件 + 回写父 Issue 汇总报告 |

## 快速开始

### 1. 安装 Multica CLI（如已安装可跳过）

```bash
# macOS / Linux
curl -fsSL https://raw.githubusercontent.com/multica-ai/multica/main/scripts/install.sh | bash
# Windows PowerShell
irm https://raw.githubusercontent.com/multica-ai/multica/main/scripts/install.ps1 | iex

multica setup   # 登录（自托管用 multica setup self-host）
```

### 2. 安装本工具

```bash
npm install          # 安装依赖
npm link             # 可选：全局暴露 `fanout` 命令
```

### 3. 体检环境

```bash
fanout doctor
# ✓ multica CLI：multica v0.4.x
# ✓ 工作区智能体（6 个）：codex / claude / gemini / ...
```

### 4. 一键派发：1 个任务 → 6 个 Agent 并行

```bash
fanout dispatch \
  --title "竞品调研" \
  --description-file context.md \
  --agents "codex,claude,gemini,hermes,opencode,cursor" \
  --json
```

- 父 Issue `MUL-100`（聚合点）自动创建；
- 6 个子 Issue（`MUL-101..106`）各分配一个 Agent，全部 `todo` **立即并行执行**；
- 每个子 Issue 描述含：完整背景 + 独立视角编号 + 产出规范（隔离目录 `output/<agent>/`、统一文件名 `view-<n>-<agent>.md`、评论回贴要求）。

### 5. 查看并行进度

```bash
fanout status MUL-100
# ✅ MUL-101 [done] ... codex
# 👀 MUL-103 [in_review] ... gemini
# ⏳ MUL-106 [todo] ... cursor
```

### 6. 聚合结果

```bash
fanout aggregate MUL-100 --out-dir ./results
```

- 默认**轮询等待**全部子 Issue 到 `done/in_review/cancelled`（`--no-wait` 跳过）；
- 把每份产出写入 `results/<标题>-<agent>.md`；
- 生成对比汇总报告，回写父 Issue 评论。

## 命令一览

| 命令 | 说明 |
| --- | --- |
| `fanout doctor` | 体检：multica 是否可用、登录、工作区智能体 |
| `fanout agents [--json]` | 列出可派发的智能体 |
| `fanout dispatch --title <t> --agents a,b,c [--description-file f] [--viewpoints v1,v2] [--status todo] [--stage 1] [--priority P] [--project P] [--json]` | fan-out 并行派发 |
| `fanout status <parent-id> [--json]` | 子任务进度聚合 |
| `fanout aggregate <parent-id> [--out-dir d] [--no-wait] [--poll-interval ms] [--timeout ms] [--json]` | 收集产出并回写父 Issue |

参数说明：

- `--agents`：Agent 名称（逗号分隔），支持精确/前缀/包含匹配，歧义会报错；
- `--agents-file`：从 JSON 文件加载 Agent 列表（参考 `agents.example.json`）；
- `--viewpoints`：各 Agent 视角，逗号分隔；数量少于 Agent 数时自动补齐编号；
- `--stage`：子 Issue 阶段（1/2/3）。**不设 = 同一批并行**；设不同 stage 可分批推进；
- `--description-stdin` 长描述建议用 `--description-file` 传入，避免转义问题。

## 多视角并行设计（避免冲突）

子 Issue 描述模板自动注入：

1. **工作目录隔离**：每个 Agent 只写 `output/<agent-key>/`，禁止改其他文件；
2. **统一产出文件名**：`view-<n>-<agent-key>.md`，格式一致便于对比；
3. **统一内容结构**：结论摘要 / 论据与理由 / 建议 / 风险；
4. **评论回贴**：产出同时粘贴到子 Issue 评论（聚合脚本从评论收集）。

## 测试（无需真实 Multica）

内置 fake CLI mock，可在无 Multica 环境跑通完整流程：

```bash
npm test
```

覆盖：dispatch（1 父 + 6 子）、status 聚合、aggregate 收集/回写、Agent 名称匹配、模板生成。

## 技术栈

- Node.js ≥ 18（ESM）
- [commander](https://github.com/tj/commander.js) CLI 框架
- 通过 `MULTICA_BIN` 环境变量可替换/代理 multica 命令（测试注入 mock）

## 路线图

- [ ] 前端管理面板（批量派发 UI + 实时看板 + 结果对比视图）
- [ ] WebSocket 实时进度推送（复用 Multica /ws 事件）
- [ ] 结果差异对比（多视角 diff 高亮）
- [ ] 子 Issue 复用同一仓库时的工作区隔离策略
