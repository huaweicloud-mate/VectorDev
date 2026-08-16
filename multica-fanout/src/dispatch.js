import fs from 'node:fs';
import path from 'node:path';
import * as m from './multica.js';
import {
  slugify,
  agentKey,
  buildParentDescription,
  buildSubtaskDescription,
  buildAggregateSummary,
} from './templates.js';

/**
 * 核心业务：fan-out 并行派发
 * 1 个父 Issue（聚合点）+ N 个子 Issue（每个分配一个 Agent，全部 todo 并行执行）
 */

/** 从 multica agent list 解析出的智能体，按名称模糊匹配（精确 > 前缀 > 包含） */
export function resolveAgents(agentNames, agentList) {
  const byName = new Map(agentList.map((a) => [String(a.name).toLowerCase(), a]));
  const resolved = [];

  for (const raw of agentNames) {
    const name = String(raw).trim();
    const lower = name.toLowerCase();

    // 1. 精确匹配
    if (byName.has(lower)) {
      resolved.push({ requested: name, ...byName.get(lower) });
      continue;
    }

    // 2. 前缀 / 包含匹配，取唯一结果
    const hits = agentList.filter(
      (a) =>
        String(a.name).toLowerCase().startsWith(lower) ||
        String(a.name).toLowerCase().includes(lower),
    );
    if (hits.length === 1) {
      resolved.push({ requested: name, ...hits[0] });
      continue;
    }
    if (hits.length > 1) {
      throw new Error(
        `Agent「${name}」匹配到多个候选（${hits.map((h) => h.name).join('、')}），请用精确名称，或用 --agents-file 指定。`,
      );
    }
    throw new Error(
      `工作区中找不到 Agent「${name}」。可用：multica agent list 查看，或 ${agentList.map((a) => a.name).join('、')}`,
    );
  }
  return resolved;
}

/**
 * 派发：创建父 Issue + N 个子 Issue（并行）
 * @returns 派发报告
 */
export function dispatch(opts) {
  const { title, description, viewpoints, status, stage, priority, project, parentOnly } = opts;

  m.checkAvailable();

  // 1. 获取工作区智能体
  const agents = m.agentList();
  if (!agents.length) {
    throw new Error('工作区中没有可用智能体，请先在 Multica 中创建 Agent。');
  }
  const selected = resolveAgents(opts.agents, agents);
  const count = selected.length;

  // 2. 视角列表：显式提供 > 默认编号
  let vp = [];
  if (viewpoints && viewpoints.length) {
    vp = viewpoints;
  } else {
    vp = selected.map((_, i) => `第 ${i + 1} 个专业视角：从独立角度给出评估`);
  }
  if (vp.length < count) {
    vp = [...vp, ...Array(count - vp.length).fill('')];
  }

  const parentDesc = buildParentDescription({ title, background: description, agentCount: count });

  // 3. 创建父 Issue（聚合点，不 assign）
  const parent = m.issueCreate({
    title: `[并行] ${title}`,
    description: parentDesc,
    status: status || 'todo',
    priority,
    project,
  });
  const parentId = parent.id || parent.key || parent.issue?.id;
  if (!parentId) {
    throw new Error(`父 Issue 创建失败，返回异常：${JSON.stringify(parent)}`);
  }

  // 打任务标记：父 issue 记为 fanout 任务（任务监控页用 metadata 过滤）
  try {
    m.issueMetadataSet(parentId, 'fanout_task', 'true');
  } catch (e) {
    console.error(`  ⚠ 任务标记写入失败（不影响派发）：${e.message}`);
  }

  // 4. 逐个子 Issue（全部 todo → 并行认领执行）
  const children = [];
  for (let i = 0; i < count; i++) {
    const agent = selected[i];
    const childDesc = buildSubtaskDescription({
      title,
      background: description,
      viewpoint: vp[i],
      agentName: agent.name,
      index: i + 1,
      outputSpec: { dir: 'output', filePrefix: opts.outputFilePrefix || 'view' },
    });

    let child;
    try {
      child = m.issueCreate({
        title: `[${i + 1}/${count}] ${title}（${agent.name}）`,
        description: childDesc,
        status: status || 'todo',
        assignee: agent.name,
        parent: parentId,
        stage,
        priority,
        project,
      });
    } catch (e) {
      // assignee 名称歧义等导致失败时，退化为：先创建、再用 ID 精确分配
      console.error(`  子 Issue ${i + 1}（${agent.name}）用名称分配失败，尝试 create + assign(by id)…`);
      child = m.issueCreate({
        title: `[${i + 1}/${count}] ${title}（${agent.name}）`,
        description: childDesc,
        status: status || 'todo',
        parent: parentId,
        stage,
        priority,
        project,
      });
      const childId = child.id || child.key;
      if (agent.id && agent.id !== childId) {
        m.issueAssign(childId, { toId: agent.id });
      }
    }
    const childId = child?.id || child?.key;
    children.push({
      index: i + 1,
      agentName: agent.name,
      agentId: agent.id || null,
      viewpoint: vp[i],
      issueId: childId || null,
      issueKey: child?.key || null,
    });
    // 进度日志走 stderr，保证 stdout 只输出最终 JSON（--json 模式可干净解析）
    console.error(`  ✓ 已派发 ${i + 1}/${count}：${agent.name} → ${child?.key || child?.id || '(创建失败)'}`);
  }

  const report = {
    parent: { id: parentId, key: parent.key || null, title: `[并行] ${title}` },
    childCount: count,
    children,
    note: '子 Issue 均为 todo，已入队并行执行；执行进度用 `fanout status <parent-id>` 查看，完成后用 `fanout aggregate <parent-id>` 聚合。',
  };
  return report;
}

/**
 * 展平 issue children 返回（兼容多种结构）：
 *   - 真实：{ stages: [{stage, children?}], total, unstaged: [...] }
 *   - fake ：{ 1: [...] }（按 stage 分组）
 *   - 纯数组
 */
function flattenChildren(raw) {
  if (Array.isArray(raw)) return raw;
  if (!raw || typeof raw !== 'object') return [];
  const out = [];
  if (Array.isArray(raw.unstaged)) out.push(...raw.unstaged);
  if (Array.isArray(raw.stages)) {
    for (const s of raw.stages) {
      if (Array.isArray(s.children)) out.push(...s.children);
      else if (Array.isArray(s.issues)) out.push(...s.issues);
      else if (s && typeof s === 'object' && s.issue) out.push(s.issue);
    }
  }
  // 兜底：其余数组字段（如 fake 的 {1:[...]}）
  for (const [k, v] of Object.entries(raw)) {
    if (k === 'unstaged' || k === 'stages') continue;
    if (Array.isArray(v)) out.push(...v);
  }
  return out;
}

/**
 * 状态聚合：列出父 Issue 下所有子 Issue 及状态
 */
export function status(parentId) {
  m.checkAvailable();
  const parent = m.issueGet(parentId);
  const raw = m.issueChildren(parentId);
  const kids = flattenChildren(raw);

  // agent id → name 映射（真实 children 只有 assignee_id，没有名字）
  let nameById = new Map();
  try {
    nameById = new Map(m.agentList().map((a) => [String(a.id), a.name]));
  } catch {
    /* 拉不到时用 id 兜底 */
  }

  const rows = kids.map((c) => {
    const n = m.normalizeIssue(c);
    const assigneeId = n.assigneeId || n.assignee_id || null;
    return {
      stage: n.stage ?? '-',
      key: n.key || n.id || null,
      title: n.title || '',
      assignee: n.assigneeName || n.assignee || (assigneeId ? nameById.get(String(assigneeId)) || assigneeId : null),
      assigneeId,
      status: n.status || '',
    };
  });

  return {
    parentKey: parent?.key || parentId,
    parentTitle: parent?.title || '',
    parentStatus: parent?.status || '',
    total: rows.length,
    rows,
  };
}

/**
 * 聚合：等待所有子 Issue 结束，收集各自评论产出，汇总回写父 Issue
 */
export function aggregate(parentId, opts = {}) {
  const {
    outDir = 'output',
    wait = opts.wait ?? true,
    pollInterval = 10000,
    timeoutMs = 0, // 0 = 不限时
    statuses = ['done', 'in_review', 'cancelled'],
    writeSummary = true,
  } = opts;

  m.checkAvailable();

  const parent = m.issueGet(parentId);
  const parentTitle = parent?.title || parentId;

  const isDone = (s) => statuses.includes(s);

  // 轮询等待全部子 Issue 到达终态
  if (wait) {
    const started = Date.now();
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const { rows, total } = status(parentId);
      const doneCount = rows.filter((r) => isDone(r.status)).length;
      const running = rows.filter((r) => !isDone(r.status));
      console.error(
        `  进度：${doneCount}/${total} 完成` +
          (running.length ? `，等待：${running.map((r) => `${r.key}(${r.status})`).join('、')}` : ''),
      );
      if (doneCount === total) break;
      if (timeoutMs && Date.now() - started > timeoutMs) {
        throw new Error(`等待超时（${Math.round(timeoutMs / 1000)}s），已完成的子 Issue 产出仍会写入。`);
      }
      sleepSync(pollInterval);
    }
  }

  // 收集每个子 Issue 的评论产出
  const { rows } = status(parentId);
  const items = [];
  for (const r of rows) {
    const comments = m.issueCommentList(r.key, { tail: 3 });
    // 取最后一条"内容较多的"评论作为产出
    const contents = (comments || [])
      .map((c) => c.content || c.body || '')
      .filter((t) => t && t.trim().length > 20);
    const content = contents.length ? contents[contents.length - 1] : '';
    items.push({
      index: rows.indexOf(r) + 1,
      agentName: r.assignee || '?',
      issueKey: r.key,
      status: r.status,
      content,
    });
  }

  // 写入本地目录
  const dir = path.resolve(outDir);
  fs.mkdirSync(dir, { recursive: true });
  for (const item of items) {
    const file = path.join(dir, `${slugify(parentTitle)}-${agentKey(item.agentName)}.md`);
    fs.writeFileSync(
      file,
      `# ${parentTitle}\n负责人：${item.agentName} | ${item.issueKey} | 状态：${item.status}\n\n${item.content || '_（无评论产出）_'}\n`,
      'utf8',
    );
    console.error(`  ✓ 已保存：${file}`);
  }

  // 汇总回写父 Issue 评论
  const summary = buildAggregateSummary({
    title: parentTitle,
    items: items.map((it, i) => ({ ...it, index: i + 1, viewpoint: `视角 ${i + 1}` })),
  });

  if (writeSummary) {
    m.issueCommentAdd(parentId, { content: summary });
    console.error(`  ✓ 聚合报告已回写父 Issue ${parent?.key || parentId} 评论`);
  }

  return { parentId, parentKey: parent?.key || null, total: items.length, items, summary };
}

function sleepSync(ms) {
  const buf = Buffer.alloc(1);
  const end = Date.now() + ms;
  try {
    while (Date.now() < end) {
      // 同步 sleep：用 Atomics.wait 不占 CPU
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, Math.min(100, end - Date.now()));
    }
  } catch {
    // 降级：busy-wait 极短间隔
    while (Date.now() < end) {
      /* noop */
    }
  }
}

// ============================================================
// 任务监控（Task Monitor）：任务列表 / 任务详情进展图 / Agent 实时情况
// ============================================================

function normalizeAgentForMonitor(a) {
  return {
    id: a.id,
    name: a.name,
    status: a.status || 'unknown',
    archived: !!a.archived,
    runtime_bound: !!a.runtime_bound,
    runtime_id: a.runtime_id || null,
    runtime_mode: a.runtime_mode || null,
    model: a.model || null,
    max_concurrent_tasks: a.max_concurrent_tasks || null,
  };
}

function summarizeTask(t) {
  return {
    id: t.id,
    status: t.status,
    attempt: t.attempt,
    issueId: t.issue_id || null,
    createdAt: t.created_at || null,
    dispatchedAt: t.dispatched_at || null,
    startedAt: t.started_at || null,
    completedAt: t.completed_at || null,
    workDir: t.work_dir || t.relative_work_dir || null,
    error: t.error || null,
    resultPreview: (t.result?.output || '').slice(0, 300) || null,
  };
}

const ACTIVE_TASK_STATUS = new Set(['dispatched', 'claimed', 'running']);

/** 任务列表：metadata 标记的 fanout 父任务（并行拉取各任务进度） */
export async function listTasks() {
  m.checkAvailable();
  const issues = m.issueList({ metadata: 'fanout_task=true' });
  // 并行计算每个任务的子任务进度
  const tasks = await Promise.all(
    issues.map(async (i) => {
      let progress = null;
      try {
        const kids = flattenChildren(m.issueChildren(i.id));
        const done = kids.filter((k) => k.status === 'done').length;
        progress = { total: kids.length, done };
      } catch {
        progress = null;
      }
      return {
        id: i.id,
        key: i.key,
        title: i.title,
        status: i.status,
        createdAt: i.created_at || null,
        progress,
      };
    }),
  );
  // 最新在前
  tasks.sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
  return tasks;
}

/** 任务详情：父任务 + 各子任务 + Agent 在线/工作状态 + 实时执行 */
export function taskDetail(parentId) {
  m.checkAvailable();
  const parent = m.issueGet(parentId);
  const kids = flattenChildren(m.issueChildren(parentId));

  let agents = [];
  let runtimes = [];
  try { agents = m.agentList(); } catch { /* 兜底 */ }
  try { runtimes = m.runtimeList(); } catch { /* 兜底 */ }
  const agentById = new Map(agents.map((a) => [String(a.id), a]));
  const rtById = new Map(runtimes.map((r) => [String(r.id), r]));

  const children = kids.map((c) => {
    const n = m.normalizeIssue(c);
    const agentId = n.assigneeId || n.assignee_id || null;
    const agent = agentId ? agentById.get(String(agentId)) : null;
    const rt = agent?.runtime_id ? rtById.get(String(agent.runtime_id)) : null;
    let task = null;
    try {
      const runs = m.issueRuns(n.id);
      task = runs[0] || null;
    } catch { /* 无执行记录 */ }
    return {
      key: n.key,
      id: n.id,
      title: n.title,
      status: n.status,
      agentId,
      agentName: agent?.name || null,
      agentOnline: !!agent?.runtime_bound && rt?.status === 'online',
      agentRuntime: rt ? { name: rt.name, status: rt.status } : null,
      task: task ? summarizeTask(task) : null,
    };
  });

  const counts = { total: children.length, done: 0, inReview: 0, todo: 0, cancelled: 0, running: 0, failed: 0 };
  for (const c of children) {
    if (c.status === 'done') counts.done += 1;
    else if (c.status === 'in_review') counts.inReview += 1;
    else if (c.status === 'todo' || c.status === 'backlog') counts.todo += 1;
    else if (c.status === 'cancelled') counts.cancelled += 1;
    if (c.task && ACTIVE_TASK_STATUS.has(c.task.status)) counts.running += 1;
    if (c.task?.status === 'failed') counts.failed += 1;
  }

  return {
    parent: {
      id: parent.id,
      key: parent.key,
      title: parent.title,
      status: parent.status,
      createdAt: parent.created_at || null,
    },
    children,
    counts,
    allDone: children.length > 0 && counts.done === children.length,
  };
}

/** Agent 实时情况：基本信息 + runtime 在线 + 运行中/最近任务 */
export function agentDetail(agentId) {
  m.checkAvailable();
  const agents = m.agentList();
  const agent = agents.find((a) => String(a.id) === String(agentId));
  if (!agent) {
    const err = new Error(`找不到 Agent：${agentId}`);
    err.status = 404;
    throw err;
  }
  let runtimes = [];
  try { runtimes = m.runtimeList(); } catch { /* 兜底 */ }
  const rt = agent.runtime_id ? runtimes.find((r) => String(r.id) === String(agent.runtime_id)) : null;

  let tasks = [];
  try { tasks = m.agentTasks(agentId, { limit: 20 }); } catch { /* 无任务 */ }
  const running = tasks.filter((t) => ACTIVE_TASK_STATUS.has(t.status));

  return {
    agent: normalizeAgentForMonitor(agent),
    runtime: rt
      ? { id: rt.id, name: rt.name, status: rt.status, lastSeen: rt.last_seen_at || rt.last_heartbeat_at || null }
      : null,
    online: !!agent.runtime_bound && rt?.status === 'online',
    busy: running.length > 0,
    runningTasks: running.map(summarizeTask),
    recentTasks: tasks.slice(0, 10).map(summarizeTask),
  };
}

/** 工作区全部 Agent 的存在状态（在线/离线 + 运行中标记） */
export async function agentPresence() {
  m.checkAvailable();
  const agents = m.agentList();
  let runtimes = [];
  try { runtimes = m.runtimeList(); } catch { /* 兜底 */ }
  const rtById = new Map(runtimes.map((r) => [String(r.id), r]));

  const rows = agents.map((a) => {
    const rt = a.runtime_id ? rtById.get(String(a.runtime_id)) : null;
    const online = !!a.runtime_bound && rt?.status === 'online';
    return {
      ...normalizeAgentForMonitor(a),
      online,
      runtimeStatus: rt?.status || null,
      runtimeName: rt?.name || null,
      lastSeen: rt?.last_seen_at || rt?.last_heartbeat_at || null,
    };
  });

  // 对在线 Agent 并行探测运行中任务（离线 Agent 不可能在跑，跳过）
  const busyIds = new Set();
  await Promise.all(
    rows
      .filter((r) => r.online)
      .map(async (r) => {
        try {
          const tasks = m.agentTasks(r.id, { limit: 5 });
          if (tasks.some((t) => ACTIVE_TASK_STATUS.has(t.status))) busyIds.add(String(r.id));
        } catch { /* 忽略 */ }
      }),
  );
  for (const r of rows) {
    r.busy = busyIds.has(String(r.id));
  }
  return rows;
}
