import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { resolveAgents } from '../src/dispatch.js';
import { slugify, agentKey, buildSubtaskDescription, buildAggregateSummary } from '../src/templates.js';

const ROOT = path.resolve(import.meta.dirname, '..');
const FAKE = path.join(ROOT, 'test', 'fake-multica.mjs');
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
