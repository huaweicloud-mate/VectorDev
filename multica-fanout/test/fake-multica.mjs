#!/usr/bin/env node
/**
 * Fake Multica CLI —— 用于无真实环境的开发/自测。
 * 通过 MULTICA_BIN=node test/fake-multica.mjs 注入到封装层。
 *
 * 模拟真实 v0.4.x 结构：
 *   - issue 编号字段是 identifier（VC-xxx），没有 key
 *   - issue children 返回 { stages, total, unstaged }
 *   - issue list 返回 { has_more, issues }
 *   - 支持 runtime list / agent tasks / issue runs / issue metadata set
 *
 * 状态持久化到 FAKE_STATE_FILE（JSON），因为每次调用都是独立进程。
 */
import fs from 'node:fs';

const STATE_FILE = process.env.FAKE_STATE_FILE || './.fake-multica-state.json';

function loadState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  } catch {
    return { issues: {}, comments: {}, metadata: {}, tasksByIssue: {}, seq: 100 };
  }
}
function saveState(s) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(s, null, 2), 'utf8');
}
function uuid() {
  return '00000000-0000-4000-8000-' + Math.random().toString(16).slice(2, 14);
}

const args0 = process.argv.slice(2);
// 过滤前置的全局连接 flag（--profile/--workspace-id/--server-url 由 fanout 注入到命令前）
const GLOBAL_FLAGS = new Set(['--profile', '--workspace-id', '--server-url']);
const args = [];
for (let i = 0; i < args0.length; i++) {
  if (GLOBAL_FLAGS.has(args0[i])) {
    i++; // 跳过 flag 及其值
    continue;
  }
  args.push(args0[i]);
}
// 命令键：3 段命令特判（issue comment add/list、issue metadata set），其余用前 2 段
const head2 = args.slice(0, 2).join(' ');
const head3 = args.slice(0, 3).join(' ');

function readStdin() {
  try {
    return fs.readFileSync(0, 'utf8');
  } catch {
    return '';
  }
}
function flag(name, fallback) {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : fallback;
}
function has(name) {
  return args.includes(name);
}

const state = loadState();

const RUNTIMES = [
  { id: 'rt-0001', name: 'Codex (vector-public)', status: 'online', last_seen_at: new Date().toISOString() },
  { id: 'rt-0002', name: 'Opencode (ubuntu)', status: 'offline', last_seen_at: '2026-08-13T14:29:28Z' },
];

const AGENTS = [
  { id: 'ag-0001', name: 'codex', model: 'gpt-5.5', status: 'idle', runtime_bound: true, runtime_id: 'rt-0001', runtime_mode: 'local', max_concurrent_tasks: 6 },
  { id: 'ag-0002', name: 'claude', model: 'claude-4', status: 'idle', runtime_bound: true, runtime_id: 'rt-0002', runtime_mode: 'local', max_concurrent_tasks: 4 },
  { id: 'ag-0003', name: 'gemini', model: 'gemini-2.5', status: 'idle', runtime_bound: true, runtime_id: 'rt-0001', runtime_mode: 'local', max_concurrent_tasks: 4 },
  { id: 'ag-0004', name: 'hermes', model: '', status: 'idle', runtime_bound: false, runtime_id: null, runtime_mode: null, max_concurrent_tasks: 2 },
  { id: 'ag-0005', name: 'opencode', model: 'qwen3-coder', status: 'idle', runtime_bound: false, runtime_id: null, runtime_mode: null, max_concurrent_tasks: 2 },
  { id: 'ag-0006', name: 'cursor', model: 'gpt-4.1', status: 'idle', runtime_bound: true, runtime_id: 'rt-0002', runtime_mode: 'local', max_concurrent_tasks: 4 },
];

function out(obj) {
  process.stdout.write(JSON.stringify(obj, null, 2) + '\n');
}

function newIssue(fields) {
  const id = uuid();
  const identifier = `VC-${state.seq++}`;
  const issue = {
    id,
    identifier,
    title: fields.title || '',
    description: fields.description || '',
    status: fields.status || 'todo',
    assignee: fields.assignee || null,
    assigneeId: fields.assigneeId || null,
    assignee_type: fields.assigneeId ? 'agent' : null,
    parent_issue_id: fields.parent || null,
    parent: fields.parent || null,
    stage: fields.stage != null ? String(fields.stage) : null,
    priority: fields.priority || 'none',
    project: fields.project || null,
    created_at: new Date().toISOString(),
    metadata: {},
  };
  state.issues[id] = issue;
  state.issues[identifier] = issue;

  // 子 issue 自动生成一条模拟执行记录（completed），供任务监控展示
  if (fields.parent) {
    const agent = AGENTS.find((a) => a.name === fields.assignee) || null;
    const now = new Date().toISOString();
    const task = {
      id: uuid(),
      agent_id: agent?.id || 'ag-0001',
      issue_id: id,
      status: 'completed',
      attempt: 1,
      kind: 'direct',
      created_at: now,
      dispatched_at: now,
      started_at: now,
      completed_at: now,
      work_dir: `C:\\fake\\workspaces\\${id}\\workdir`,
      result: { output: `（fake）${agent?.name || 'agent'} 已完成视角产出，见评论。` },
      error: null,
    };
    state.tasksByIssue[id] = [task];
    // 记录父子关系
    const parent = state.issues[fields.parent];
    if (parent) {
      parent._children = parent._children || [];
      parent._children.push(issue);
      state.issues[parent.id] = parent;
      state.issues[parent.identifier] = parent;
    }
  }
  saveState(state);
  return issue;
}

// 评论按 issue 的 id 与 identifier 双键存储
function commentKeys(ref) {
  const issue = state.issues[ref];
  return issue ? [issue.id, issue.identifier] : [ref];
}

// ============ 3 段命令特判 ============
if (head3 === 'issue comment add') {
  const id = args[3];
  let content = '';
  if (has('--content-stdin')) content = readStdin();
  else if (flag('--content-file')) content = fs.readFileSync(flag('--content-file'), 'utf8');
  const comment = { id: 'c-' + Math.random().toString(16).slice(2, 8), content, created_at: new Date().toISOString() };
  for (const k of commentKeys(id)) {
    state.comments[k] = state.comments[k] || [];
    state.comments[k].push(comment);
  }
  saveState(state);
  out(comment);
} else if (head3 === 'issue comment list') {
  const id = args[3];
  const all = commentKeys(id).flatMap((k) => state.comments[k] || []);
  out(all);
} else if (head3 === 'issue metadata set') {
  const id = args[3];
  const key = flag('--key');
  const value = flag('--value');
  const issue = state.issues[id];
  if (!issue || !key) {
    process.stderr.write('metadata set: 缺少 issue 或 --key\n');
    process.exit(1);
  }
  issue.metadata = issue.metadata || {};
  issue.metadata[key] = value === 'true' ? true : value === 'false' ? false : value;
  state.issues[issue.id] = issue;
  state.issues[issue.identifier] = issue;
  saveState(state);
  out({ id: issue.id, metadata: issue.metadata });
} else
switch (head2) {
  case 'version':
    process.stdout.write('multica v0.4.26 (fake)\n');
    break;
  case 'auth status':
    out({ authenticated: true, user: { email: 'tester@example.com' } });
    break;
  case 'agent list':
    out(AGENTS);
    break;
  case 'agent tasks': {
    const agentId = args[2];
    const all = Object.values(state.tasksByIssue || {}).flat();
    const list = all.filter((t) => t.agent_id === agentId);
    out(list.slice(0, Number(flag('--limit', 20)) || 20));
    break;
  }
  case 'runtime list':
    out(RUNTIMES);
    break;
  case 'issue runs': {
    const id = args[2];
    const issue = state.issues[id];
    out((issue && state.tasksByIssue[issue.id]) || []);
    break;
  }
  case 'issue list': {
    const md = flag('--metadata', null);
    let list = Object.values(state.issues).filter(
      (i) => i && i.identifier && i.parent_issue_id == null, // 只列父 issue
    );
    if (md && md.includes('=')) {
      const [k, v] = md.split('=');
      list = list.filter((i) => String(i.metadata?.[k]) === v);
    }
    out({ has_more: false, issues: list });
    break;
  }
  case 'issue create': {
    const fields = { title: flag('--title', '') };
    if (has('--description-stdin')) fields.description = readStdin();
    else if (flag('--description')) fields.description = flag('--description');
    if (flag('--description-file')) fields.description = fs.readFileSync(flag('--description-file'), 'utf8');
    fields.status = flag('--status', 'todo');
    fields.assignee = flag('--assignee', null);
    fields.parent = flag('--parent', null);
    fields.stage = flag('--stage', null);
    fields.priority = flag('--priority', null);
    fields.project = flag('--project', null);
    const agent = AGENTS.find((a) => a.name === fields.assignee);
    if (agent) fields.assigneeId = agent.id;
    const issue = newIssue(fields);
    out(issue);
    break;
  }
  case 'issue get': {
    const id = args[2];
    const issue = state.issues[id];
    if (!issue) {
      process.stderr.write('issue not found\n');
      process.exit(1);
    }
    out(issue);
    break;
  }
  case 'issue children': {
    const id = args[2];
    const issue = state.issues[id];
    if (!issue) {
      process.stderr.write('issue not found\n');
      process.exit(1);
    }
    const kids = (issue._children || []).map((k) => state.issues[k.id] || state.issues[k.identifier] || k);
    out({ stages: [], total: kids.length, unstaged: kids });
    break;
  }
  case 'issue status': {
    const id = args[2];
    const status = args[3];
    const issue = state.issues[id];
    if (!issue) {
      process.stderr.write('issue not found\n');
      process.exit(1);
    }
    issue.status = status;
    state.issues[issue.id] = issue;
    state.issues[issue.identifier] = issue;
    saveState(state);
    out(issue);
    break;
  }
  case 'issue assign': {
    const id = args[2];
    const issue = state.issues[id];
    if (!issue) {
      process.stderr.write('issue not found\n');
      process.exit(1);
    }
    if (has('--unassign')) {
      issue.assignee = null;
      issue.assigneeId = null;
      issue.assignee_type = null;
    } else if (has('--to-id')) {
      issue.assigneeId = flag('--to-id');
      issue.assignee = AGENTS.find((a) => a.id === issue.assigneeId)?.name || issue.assigneeId;
      issue.assignee_type = 'agent';
    } else if (flag('--to')) {
      issue.assignee = flag('--to');
    }
    state.issues[issue.id] = issue;
    state.issues[issue.identifier] = issue;
    saveState(state);
    out(issue);
    break;
  }
  default:
    process.stderr.write(`unknown fake command: ${args.join(' ')}\n`);
    process.exit(1);
}
