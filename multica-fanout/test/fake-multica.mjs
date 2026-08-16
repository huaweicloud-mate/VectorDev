#!/usr/bin/env node
/**
 * Fake Multica CLI —— 用于无真实环境的开发/自测。
 * 通过 MULTICA_BIN=node test/fake-multica.mjs 注入到封装层。
 *
 * 状态持久化到 FAKE_STATE_FILE（JSON），因为每次调用都是独立进程。
 */
import fs from 'node:fs';

const STATE_FILE = process.env.FAKE_STATE_FILE || './.fake-multica-state.json';

function loadState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  } catch {
    return { issues: {}, comments: {}, seq: 100 };
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
// 命令键：issue comment add/list 是 3 段，其余用前 2 段
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

function newIssue(fields) {
  const id = uuid();
  // 模拟真实 API：编号字段是 identifier（VC-xxx），不是 key
  const identifier = `VC-${state.seq++}`;
  const issue = {
    id,
    identifier,
    title: fields.title || '',
    description: fields.description || '',
    status: fields.status || 'todo',
    assignee: fields.assignee || null,
    assigneeId: fields.assigneeId || null,
    parent: fields.parent || null,
    stage: fields.stage != null ? String(fields.stage) : null,
    priority: fields.priority || null,
    project: fields.project || null,
    createdAt: new Date().toISOString(),
  };
  state.issues[id] = issue;
  state.issues[identifier] = issue;
  saveState(state);
  return issue;
}

const AGENTS = [
  { id: 'ag-0001', name: 'codex' },
  { id: 'ag-0002', name: 'claude' },
  { id: 'ag-0003', name: 'gemini' },
  { id: 'ag-0004', name: 'hermes' },
  { id: 'ag-0005', name: 'opencode' },
  { id: 'ag-0006', name: 'cursor' },
];

function out(obj) {
  process.stdout.write(JSON.stringify(obj, null, 2) + '\n');
}

// 3 段命令特判：issue comment add / issue comment list
// 评论按 issue 的 id 与 identifier 双键存储，保证用任一引用都能读写
function commentKeys(ref) {
  const issue = state.issues[ref];
  return issue ? [issue.id, issue.identifier] : [ref];
}
if (head3 === 'issue comment add') {
  const id = args[3];
  let content = '';
  if (has('--content-stdin')) content = readStdin();
  else if (flag('--content-file')) content = fs.readFileSync(flag('--content-file'), 'utf8');
  const comment = { id: 'c-' + Math.random().toString(16).slice(2, 8), content, createdAt: new Date().toISOString() };
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
    const issue = newIssue(fields);
    // 记录父子关系，供 children 使用
    if (fields.parent) {
      const parent = state.issues[fields.parent];
      if (parent) {
        parent._children = parent._children || [];
        parent._children.push(issue);
        state.issues[parent.id] = parent;
        state.issues[parent.identifier] = parent;
        saveState(state);
      }
    }
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
    // 模拟真实返回：{ stages, total, unstaged }
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
    // id 键与 identifier 键同步，保证任意引用都读到最新状态
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
    } else if (has('--to-id')) {
      issue.assigneeId = flag('--to-id');
      issue.assignee = AGENTS.find((a) => a.id === issue.assigneeId)?.name || issue.assigneeId;
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
