#!/usr/bin/env node
import { Command, Option } from 'commander';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as m from '../src/multica.js';
import { dispatch, status, aggregate, resolveAgents } from '../src/dispatch.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));

const program = new Command();

function printJson(data) {
  process.stdout.write(JSON.stringify(data, null, 2) + '\n');
}

function parseList(value) {
  return value
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function loadAgentsFile(file) {
  const abs = path.resolve(file);
  const data = JSON.parse(fs.readFileSync(abs, 'utf8'));
  if (Array.isArray(data)) return data.map((a) => (typeof a === 'string' ? a : a.name)).filter(Boolean);
  if (data.agents) return data.agents.map((a) => (typeof a === 'string' ? a : a.name)).filter(Boolean);
  throw new Error(`agents 文件格式不正确：${file}`);
}

function loadDescription(opts) {
  if (opts.descriptionFile) return fs.readFileSync(path.resolve(opts.descriptionFile), 'utf8');
  return opts.description || '';
}

program
  .name('fanout')
  .description('Multica 多 Agent 并行派发工具：1 父 Issue + N 子 Issue 多视角并行')
  .version(pkg.version);

// ------------------------------------------------------------
// doctor：环境体检
// ------------------------------------------------------------
program
  .command('doctor')
  .description('检查 multica CLI、登录状态与工作区智能体')
  .action(() => {
    try {
      console.log('✓ multica CLI：', m.checkAvailable());
    } catch (e) {
      console.error('✗ ' + e.message);
      process.exit(1);
    }
    try {
      const auth = m.authStatus();
      console.log('✓ 登录状态：', JSON.stringify(auth));
    } catch {
      console.warn('⚠ 无法读取登录状态（部分版本需用 multica auth status 查看）');
    }
    try {
      const agents = m.agentList();
      console.log(`✓ 工作区智能体（${agents.length} 个）：`);
      for (const a of agents) console.log(`   - ${a.name} (${a.id})`);
    } catch (e) {
      console.error('✗ 读取智能体失败：' + e.message);
      process.exit(1);
    }
  });

// ------------------------------------------------------------
// agents：列出备选智能体
// ------------------------------------------------------------
program
  .command('agents')
  .description('列出工作区可派发的智能体')
  .option('--json', 'JSON 输出')
  .action((opts) => {
    const agents = m.agentList();
    if (opts.json) return printJson(agents);
    for (const a of agents) console.log(`${a.name}\t${a.id}`);
  });

// ------------------------------------------------------------
// dispatch：fan-out 派发
// ------------------------------------------------------------
program
  .command('dispatch')
  .description('创建父 Issue + N 个子 Issue，多视角并行派发给多个 Agent')
  .requiredOption('--title <title>', '任务标题')
  .option('--description <text>', '任务背景描述')
  .option('--description-file <file>', '从文件读取任务背景描述')
  .option('--agents <names>', 'Agent 名称，逗号分隔（如 "codex,claude,gemini"）', parseList)
  .option('--agents-file <file>', '从 JSON 文件读取 Agent 列表')
  .option('--viewpoints <texts>', '各 Agent 的视角，逗号分隔；数量可与 Agent 数不同', parseList)
  .option('--status <status>', '初始状态（默认 todo）', 'todo')
  .option('--stage <stage>', '子 Issue 阶段（默认不设，视为同一批并行）')
  .option('--priority <priority>', '优先级')
  .option('--project <project>', '项目')
  .option('--json', 'JSON 输出')
  .action((opts) => {
    try {
      if (!opts.agents?.length && !opts.agentsFile) {
        console.error('错误：需要 --agents 或 --agents-file 指定至少一个 Agent。');
        process.exit(1);
      }
      const agents = opts.agentsFile ? loadAgentsFile(opts.agentsFile) : opts.agents;
      const description = loadDescription(opts);
      const report = dispatch({
        title: opts.title,
        description,
        agents,
        viewpoints: opts.viewpoints,
        status: opts.status,
        stage: opts.stage,
        priority: opts.priority,
        project: opts.project,
      });
      if (opts.json) return printJson(report);
      console.log('\n=== 派发完成 ===');
      console.log(`父 Issue：${report.parent.key || report.parent.id} | ${report.parent.title}`);
      for (const c of report.children) {
        console.log(`  [${c.index}] ${c.agentName} → ${c.issueKey || c.issueId}（${c.viewpoint?.slice(0, 30) || ''}）`);
      }
      console.log(`\n下一步：\n  fanout status ${report.parent.id}    # 查看并行进度\n  fanout aggregate ${report.parent.id}  # 全部完成后聚合`);
    } catch (e) {
      console.error('✗ ' + e.message);
      process.exit(1);
    }
  });

// ------------------------------------------------------------
// status：子任务进度
// ------------------------------------------------------------
program
  .command('status')
  .description('查看父 Issue 下所有子 Issue 的并行执行进度')
  .argument('<parent-id>', '父 Issue key 或 UUID')
  .option('--json', 'JSON 输出')
  .action((parentId, opts) => {
    try {
      const data = status(parentId);
      if (opts.json) return printJson(data);
      console.log(`父 Issue：${data.parentKey} | ${data.parentTitle} | 状态：${data.parentStatus}`);
      console.log(`子任务：${data.total} 个\n`);
      for (const r of data.rows) {
        const mark = { done: '✅', in_review: '👀', in_progress: '🔄', todo: '⏳', backlog: '📦', cancelled: '🚫', blocked: '⛔' }[r.status] || '❓';
        console.log(`  ${mark} ${r.key} [${r.status}] ${r.title} → ${r.assignee || '未分配'}`);
      }
    } catch (e) {
      console.error('✗ ' + e.message);
      process.exit(1);
    }
  });

// ------------------------------------------------------------
// aggregate：聚合产出
// ------------------------------------------------------------
program
  .command('aggregate')
  .description('等待子 Issue 完成，收集各 Agent 评论产出，汇总回写父 Issue')
  .argument('<parent-id>', '父 Issue key 或 UUID')
  .option('--out-dir <dir>', '产出目录（默认 ./output）', 'output')
  .option('--no-wait', '不等待，立即收集当前已有产出')
  .option('--poll-interval <ms>', '轮询间隔毫秒（默认 10000）', (v) => Number(v), 10000)
  .option('--timeout <ms>', '等待超时毫秒，0 表示不限（默认 0）', (v) => Number(v), 0)
  .option('--json', 'JSON 输出')
  .action((parentId, opts) => {
    try {
      const result = aggregate(parentId, {
        outDir: opts.outDir,
        wait: opts.wait !== false,
        pollInterval: opts.pollInterval,
        timeoutMs: opts.timeout,
      });
      if (opts.json) {
        printJson({
          parentId: result.parentId,
          parentKey: result.parentKey,
          total: result.total,
          items: result.items.map((it) => ({ ...it, summary: undefined })),
        });
      } else {
        console.log(`\n=== 聚合完成（${result.total} 份产出）===`);
        console.log(`产出目录：${path.resolve(opts.outDir)}`);
        console.log(`父 Issue 评论已更新：${result.parentKey || result.parentId}`);
      }
    } catch (e) {
      console.error('✗ ' + e.message);
      process.exit(1);
    }
  });

// ------------------------------------------------------------
// 帮助信息里给出示例
// ------------------------------------------------------------
program.on('--help', () => {
  console.log(`
示例：
  fanout doctor                                   # 体检：multica 是否可用、登录、智能体
  fanout dispatch --title "竞品调研" --description-file ctx.md \\
      --agents "codex,claude,gemini,hermes,opencode,cursor" --json
  fanout status MUL-100                           # 查看 6 个子任务进度
  fanout aggregate MUL-100 --out-dir ./results    # 聚合 6 份产出回写父 Issue
`);
});

program.parse(process.argv);
