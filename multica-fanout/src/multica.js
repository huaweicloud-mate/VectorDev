import { spawnSync } from 'node:child_process';
import { getRuntime, globalFlags } from './config.js';

/**
 * Multica CLI 封装层
 * 通过 spawn 调用本机已安装的 `multica` 命令，统一 JSON 解析与错误处理。
 * 所有函数均为同步（CLI 场景，简单可靠）。
 *
 * 连接配置（profile/workspace/server-url）由 src/config.js 注入，
 * 会附加到每条 multica 命令的全局 flag 上。
 */

let BIN = process.env.MULTICA_BIN || 'multica';
// 支持 MULTICA_BIN="node /path/fake.mjs" 这种带前缀的形式（测试/代理场景）
const [BIN_CMD, ...BIN_PREFIX] = BIN.split(/\s+/).filter(Boolean);

/**
 * 解析出最终的可执行命令与 argv。
 * 注意：必须在 spawn 之前一次性求值（不能把 BIN_CMD 作为参数在 buildArgs 之后读取，
 * 否则读到的还是更新前的旧值）。
 */
function resolveInvocation(args) {
  const rt = getRuntime();
  let cmd = BIN_CMD;
  let prefix = BIN_PREFIX;
  if (rt.multicaBin) {
    const parts = String(rt.multicaBin).split(/\s+/).filter(Boolean);
    cmd = parts[0];
    prefix = parts.slice(1);
  }
  return { cmd, argv: [...prefix, ...globalFlags(), ...args] };
}

class MulticaError extends Error {
  constructor(message, { cmd, code, stderr } = {}) {
    super(message);
    this.name = 'MulticaError';
    this.cmd = cmd;
    this.code = code;
    this.stderr = stderr;
  }
}

/** 执行 multica 命令，返回 stdout 文本（不解析 JSON） */
export function run(args, { input } = {}) {
  const { cmd, argv } = resolveInvocation(args);
  const res = spawnSync(cmd, argv, {
    encoding: 'utf8',
    input,
    maxBuffer: 32 * 1024 * 1024,
    windowsHide: true,
  });

  if (res.error) {
    throw new MulticaError(`无法执行 ${cmd}：${res.error.message}`, { cmd: args.join(' ') });
  }
  if (res.status !== 0) {
    throw new MulticaError(
      `命令失败 (${res.status})：multica ${args.join(' ')}\n${(res.stderr || res.stdout || '').trim()}`,
      { cmd: args.join(' '), code: res.status, stderr: res.stderr },
    );
  }
  return (res.stdout || '').trim();
}

/** 执行命令并解析 JSON 输出 */
export function runJson(args) {
  const stdout = run(args);
  if (!stdout) return null;
  try {
    return JSON.parse(stdout);
  } catch {
    throw new MulticaError(`输出不是合法 JSON：multica ${args.join(' ')}\n${stdout.slice(0, 500)}`, {
      cmd: args.join(' '),
    });
  }
}

/** 把输出归一化为数组（list 类命令可能是数组，也可能包一层） */
function asArray(data) {
  if (Array.isArray(data)) return data;
  if (data && typeof data === 'object') {
    for (const key of ['issues', 'items', 'results', 'agents', 'comments', 'children', 'data']) {
      if (Array.isArray(data[key])) return data[key];
    }
  }
  return [];
}

/**
 * 归一化 issue 对象：真实 API 用 `identifier`（如 VC-234）展示编号，
 * 兼容我们代码中统一使用的 `key` 字段。
 */
export function normalizeIssue(issue) {
  if (!issue || typeof issue !== 'object') return issue;
  return {
    ...issue,
    id: issue.id,
    key: issue.key || issue.identifier || null,
    identifier: issue.identifier || issue.key || null,
  };
}

// ------------------------------------------------------------
// 基础能力检查
// ------------------------------------------------------------

export function checkAvailable() {
  try {
    return run(['version']);
  } catch (e) {
    throw new MulticaError(
      [
        '未检测到 multica CLI。请先安装并登录：',
        '  macOS/Linux: curl -fsSL https://raw.githubusercontent.com/multica-ai/multica/main/scripts/install.sh | bash',
        '  Windows PowerShell: irm https://raw.githubusercontent.com/multica-ai/multica/main/scripts/install.ps1 | iex',
        '  然后运行 multica setup 完成登录。',
      ].join('\n'),
    );
  }
}

export function authStatus() {
  const data = runJson(['auth', 'status', '--output', 'json']);
  return data;
}

// ------------------------------------------------------------
// Agent
// ------------------------------------------------------------

/** 列出工作区智能体：multica agent list --output json */
export function agentList() {
  const data = runJson(['agent', 'list', '--output', 'json']);
  return asArray(data);
}

// ------------------------------------------------------------
// Issue
// ------------------------------------------------------------

/**
 * 创建 issue
 * @param {object} opts
 * @param {string} opts.title 必填
 * @param {string} [opts.description] 描述（与 descriptionFile 二选一）
 * @param {string} [opts.descriptionFile] 从文件读描述
 * @param {string} [opts.status] backlog|todo|in_progress|...
 * @param {string} [opts.assignee] 负责人名称（成员/智能体/小队，模糊匹配）
 * @param {string} [opts.parent] 父 issue key 或 UUID
 * @param {string} [opts.stage] 子 issue 阶段（1/2/3）
 * @param {string} [opts.priority] 优先级
 * @param {string} [opts.project] 项目
 */
export function issueCreate(opts = {}) {
  const args = ['issue', 'create', '--title', opts.title];
  if (opts.description) {
    // 长描述走 stdin，避免引号/换行转义问题
    return runWithInput(args, { description: opts.description, ...opts });
  }
  if (opts.descriptionFile) {
    args.push('--description-file', opts.descriptionFile);
  }
  if (opts.status) args.push('--status', opts.status);
  if (opts.assignee) args.push('--assignee', opts.assignee);
  if (opts.parent) args.push('--parent', opts.parent);
  if (opts.stage != null) args.push('--stage', String(opts.stage));
  if (opts.priority) args.push('--priority', opts.priority);
  if (opts.project) args.push('--project', opts.project);
  return normalizeIssue(runJson(args));
}

function runWithInput(args, { description, ...opts }) {
  const out = [...args];
  out.push('--description-stdin');
  if (opts.status) out.push('--status', opts.status);
  if (opts.assignee) out.push('--assignee', opts.assignee);
  if (opts.parent) out.push('--parent', opts.parent);
  if (opts.stage != null) out.push('--stage', String(opts.stage));
  if (opts.priority) out.push('--priority', opts.priority);
  if (opts.project) out.push('--project', opts.project);
  return normalizeIssue(runJsonWithInput(out, description));
}

function runJsonWithInput(args, input) {
  const stdout = run(args, { input });
  try {
    return stdout ? JSON.parse(stdout) : null;
  } catch {
    throw new MulticaError(`输出不是合法 JSON：multica ${args.join(' ')}\n${stdout.slice(0, 500)}`);
  }
}

/**
 * 分配负责人
 * @param {string} id issue key 或 UUID
 * @param {object} opts { to: 名称, toId: UUID } 优先 toId
 */
export function issueAssign(id, opts = {}) {
  const args = ['issue', 'assign', id];
  if (opts.toId) args.push('--to-id', opts.toId);
  else if (opts.to) args.push('--to', opts.to);
  else args.push('--unassign');
  return runJson(args);
}

/** 查看单个 issue */
export function issueGet(id) {
  return normalizeIssue(runJson(['issue', 'get', id]));
}

/** 列出 issue（可按状态/负责人过滤；metadata 形如 'fanout_task=true'） */
export function issueList(opts = {}) {
  const args = ['issue', 'list', '--output', 'json'];
  if (opts.status) args.push('--status', opts.status);
  if (opts.assignee) args.push('--assignee', opts.assignee);
  if (opts.limit) args.push('--limit', String(opts.limit));
  if (opts.metadata) args.push('--metadata', opts.metadata);
  const data = runJson(args);
  return asArray(data).map(normalizeIssue);
}

/** 设置 issue 级 metadata（value 会被 JSON 解析；如 'true' → bool） */
export function issueMetadataSet(id, key, value) {
  return runJson(['issue', 'metadata', 'set', id, '--key', key, '--value', String(value)]);
}

/** 列出子 issue（真实 CLI 需 --output json；返回 { stages, total, unstaged }） */
export function issueChildren(id) {
  return runJson(['issue', 'children', id, '--output', 'json']);
}

/** 评论列表 */
export function issueCommentList(id, opts = {}) {
  const args = ['issue', 'comment', 'list', id, '--output', 'json'];
  if (opts.tail) args.push('--tail', String(opts.tail));
  const data = runJson(args);
  return asArray(data);
}

/** 添加评论（长内容走 stdin） */
export function issueCommentAdd(id, { content, contentFile } = {}) {
  const args = ['issue', 'comment', 'add', id];
  if (content != null) {
    args.push('--content-stdin');
    return runJsonWithInput(args, content);
  }
  if (contentFile) {
    args.push('--content-file', contentFile);
    return runJson(args);
  }
  throw new MulticaError('issueCommentAdd 需要 content 或 contentFile');
}

/** 修改状态 */
export function issueStatus(id, status) {
  return runJson(['issue', 'status', id, status]);
}

// ------------------------------------------------------------
// Agent / Runtime / Task（实时工作监控）
// ------------------------------------------------------------

/** 某个 agent 的 task 列表（含运行中/历史；最新在前） */
export function agentTasks(agentId, { limit } = {}) {
  const args = ['agent', 'tasks', agentId, '--output', 'json'];
  if (limit) args.push('--limit', String(limit));
  const data = runJson(args);
  return asArray(data);
}

/** 某个 issue 的执行历史（task） */
export function issueRuns(issueId) {
  const data = runJson(['issue', 'runs', issueId, '--output', 'json']);
  return asArray(data);
}

/** runtime 列表（online/offline 判定依据） */
export function runtimeList() {
  const data = runJson(['runtime', 'list', '--output', 'json']);
  return asArray(data);
}

export { MulticaError };
