import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { resolveAgents } from '../src/dispatch.js';
import { slugify, agentKey, buildSubtaskDescription, buildAggregateSummary } from '../src/templates.js';
import { resolveRuntime } from '../src/config.js';

const ROOT = path.resolve(import.meta.dirname, '..');
const FAKE = path.join(ROOT, 'test', 'fake-multica.mjs');
const SPY = path.join(ROOT, 'test', 'spy-multica.mjs');
let tmpDir;

/** 模拟用户运行 fanout CLI（封装层内部通过 MULTICA_BIN 调 fake） */
function runFanout(args, extraEnv = {}) {
  const res = spawnSync(process.execPath, [path.join(ROOT, 'bin', 'fanout.js'), ...args], {
    encoding: 'utf8',
    env: {
      ...process.env,
      MULTICA_BIN: `${process.execPath} ${FAKE}`, // node fake.mjs（带前缀）
      FAKE_STATE_FILE: path.join(tmpDir, 'state.json'),
      ...extraEnv,
    },
  });
  return res;
}

/** 直接操作 fake（模拟 Agent 回写评论等） */
function fake(args, { input } = {}) {
  return spawnSync(process.execPath, [FAKE, ...args], {
    encoding: 'utf8',
    input,
    env: { ...process.env, FAKE_STATE_FILE: path.join(tmpDir, 'state.json') },
  });
}

before(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fanout-test-'));
});

after(() => {
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch {}
});

// ------------------------------------------------------------
// 单元测试：工具函数
// ------------------------------------------------------------
test('slugify / agentKey 生成安全文件名', () => {
  assert.equal(slugify('竞品调研 2026'), '竞品调研-2026');
  assert.equal(agentKey('Codex 实现组'), 'codex');
  assert.equal(agentKey('codex'), 'codex');
});

test('resolveAgents：精确/前缀/包含/歧义', () => {
  const list = [
    { id: 'a1', name: 'codex' },
    { id: 'a2', name: 'claude' },
    { id: 'a3', name: 'gemini' },
    { id: 'a4', name: 'gemini-pro' },
  ];
  assert.deepEqual(resolveAgents(['codex'], list).map((a) => a.name), ['codex']);
  assert.deepEqual(resolveAgents(['clau'], list).map((a) => a.name), ['claude']);
  assert.throws(() => resolveAgents(['gem'], list), /多个候选/);
  assert.throws(() => resolveAgents(['nobody'], list), /找不到/);
});

test('buildSubtaskDescription 包含隔离目录与产出规范', () => {
  const desc = buildSubtaskDescription({
    title: '调研',
    background: '背景A',
    viewpoint: '视角X',
    agentName: 'codex',
    index: 1,
    outputSpec: { dir: 'output', filePrefix: 'view' },
  });
  assert.ok(desc.includes('output/codex/'));
  assert.ok(desc.includes('view-1-codex.md'));
  assert.ok(desc.includes('视角X'));
  assert.ok(desc.includes('结论摘要'));
});

test('buildAggregateSummary 合并 N 份产出', () => {
  const s = buildAggregateSummary({
    title: '调研',
    items: [
      { index: 1, viewpoint: '视角 1', agentName: 'codex', issueKey: 'MUL-1', status: 'done', content: '产出A' },
      { index: 2, viewpoint: '视角 2', agentName: 'claude', issueKey: 'MUL-2', status: 'in_review', content: '' },
    ],
  });
  assert.ok(s.includes('**2** 份独立产出'));
  assert.ok(s.includes('产出A'));
  assert.ok(s.includes('未在评论中提供产出'));
});

// ------------------------------------------------------------
// 配置接入：resolveRuntime 优先级 + 全局 flag 注入
// ------------------------------------------------------------
test('config：resolveRuntime 优先级 CLI > env > 配置文件', () => {
  const cfgFile = path.join(tmpDir, 'cfg.json');
  fs.writeFileSync(
    cfgFile,
    JSON.stringify({ profile: 'file-profile', workspaceId: 'file-ws', serverUrl: 'https://file.example.com', multicaBin: 'file-bin' }),
    'utf8',
  );

  // 只有配置文件
  const only = resolveRuntime({ config: cfgFile });
  assert.equal(only.profile, 'file-profile');
  assert.equal(only.workspaceId, 'file-ws');
  assert.equal(only.serverUrl, 'https://file.example.com');

  // env 覆盖文件
  const oldEnv = { ...process.env };
  process.env.MULTICA_PROFILE = 'env-profile';
  process.env.MULTICA_WORKSPACE_ID = 'env-ws';
  const withEnv = resolveRuntime({ config: cfgFile });
  assert.equal(withEnv.profile, 'env-profile');
  assert.equal(withEnv.workspaceId, 'env-ws');
  assert.equal(withEnv.serverUrl, 'https://file.example.com'); // env 未设置 → 文件值
  Object.assign(process.env, oldEnv);

  // CLI 覆盖 env
  const withCli = resolveRuntime({ config: cfgFile, profile: 'cli-profile', serverUrl: 'https://cli.example.com' });
  assert.equal(withCli.profile, 'cli-profile');
  assert.equal(withCli.serverUrl, 'https://cli.example.com');
});

test('config：fanout config 命令能生成模板并显示生效配置', () => {
  const cfgPath = path.join(tmpDir, 'multica.config.json');
  const r1 = runFanout(['config', '--init', cfgPath]);
  assert.equal(r1.status, 0, r1.stderr + r1.stdout);
  assert.ok(fs.existsSync(cfgPath));
  const parsed = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
  assert.ok('multicaBin' in parsed && 'workspaceId' in parsed && 'serverUrl' in parsed);

  const r2 = runFanout(['config', '--json']);
  assert.equal(r2.status, 0, r2.stderr);
  const shown = JSON.parse(r2.stdout);
  assert.ok('configFile' in shown && 'profile' in shown && 'workspaceId' in shown);
});

test('config：连接配置注入到每条 multica 命令（spy 验证）', () => {
  // 通过 spy 记录完整 argv（写入 SPY_LOG），验证 --profile/--workspace-id 注入
  const spyLog = path.join(tmpDir, 'spy.log');
  const res = spawnSync(
    process.execPath,
    [path.join(ROOT, 'bin', 'fanout.js'), 'agents', '--profile', 'staging', '--workspace-id', 'ws-123', '--json'],
    {
      encoding: 'utf8',
      env: {
        ...process.env,
        MULTICA_BIN: `${process.execPath} ${SPY}`,
        SPY_LOG: spyLog,
        FAKE_STATE_FILE: path.join(tmpDir, 'state.json'),
      },
    },
  );
  assert.equal(res.status, 0, res.stderr);
  const log = fs.readFileSync(spyLog, 'utf8');
  assert.ok(log.includes('--profile staging --workspace-id ws-123 agent list'), log);
  const agents = JSON.parse(res.stdout);
  assert.ok(Array.isArray(agents) && agents.length >= 6);
});

// ------------------------------------------------------------
// 集成测试：fake multica 环境跑通完整流程
// ------------------------------------------------------------
test('集成：doctor 能发现 fake CLI 与智能体', () => {
  const r = runFanout(['doctor']);
  assert.equal(r.status, 0, r.stderr + r.stdout);
  assert.ok(r.stdout.includes('multica v0.4.26 (fake)'));
  assert.ok(r.stdout.includes('codex'));
  assert.ok(r.stdout.includes('6 个'));
});

test('集成：dispatch 创建 1 父 + 6 子并行派发', () => {
  const r = runFanout([
    'dispatch',
    '--title', '竞品调研',
    '--description', '分析三家竞品',
    '--agents', 'codex,claude,gemini,hermes,opencode,cursor',
    '--json',
  ]);
  assert.equal(r.status, 0, r.stderr + r.stdout);
  const report = JSON.parse(r.stdout);
  assert.equal(report.childCount, 6);
  assert.ok(report.parent.id);
  assert.equal(report.children.length, 6);
  assert.equal(report.children[0].agentName, 'codex');
  assert.equal(report.children[5].agentName, 'cursor');
  // 每个子 issue 都有 id
  assert.ok(report.children.every((c) => c.issueId));

  // status 能看到 6 个子任务
  const r2 = runFanout(['status', report.parent.id, '--json']);
  assert.equal(r2.status, 0, r2.stderr);
  const s = JSON.parse(r2.stdout);
  assert.equal(s.total, 6);
  assert.ok(s.rows.every((r) => r.assignee));
});

test('集成：aggregate 收集产出并回写父 Issue', () => {
  const r1 = runFanout([
    'dispatch',
    '--title', '聚合测试',
    '--description', '测试聚合',
    '--agents', 'codex,claude',
    '--json',
  ]);
  const report = JSON.parse(r1.stdout);
  const parentId = report.parent.id;

  // 模拟 2 个 Agent 各自提交产出评论
  const out1 = fake(['issue', 'comment', 'add', report.children[0].issueId, '--content-stdin'], {
    input: '## 结论摘要\ncodex 视角产出\n## 论据与理由\n...',
  });
  assert.equal(out1.status, 0);
  const out2 = fake(['issue', 'comment', 'add', report.children[1].issueId, '--content-stdin'], {
    input: '## 结论摘要\nclaude 视角产出\n## 建议\n...',
  });
  assert.equal(out2.status, 0);

  const r2 = runFanout(['aggregate', parentId, '--no-wait', '--out-dir', path.join(tmpDir, 'results'), '--json']);
  assert.equal(r2.status, 0, r2.stderr + r2.stdout);
  const agg = JSON.parse(r2.stdout);
  assert.equal(agg.total, 2);

  // 本地产出文件已落盘
  const files = fs.readdirSync(path.join(tmpDir, 'results'));
  assert.equal(files.length, 2);
  assert.ok(files.some((f) => f.includes('codex')));
  assert.ok(files.some((f) => f.includes('claude')));

  // 父 Issue 评论已回写汇总
  const comments = fake(['issue', 'comment', 'list', parentId, '--output', 'json']);
  const parsed = JSON.parse(comments.stdout);
  assert.ok(parsed.some((c) => c.content.includes('多 Agent 并行产出聚合')));
  assert.ok(parsed.some((c) => c.content.includes('codex 视角产出')));
});
