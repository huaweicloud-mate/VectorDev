#!/usr/bin/env node
import { Command } from 'commander';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as m from '../src/multica.js';
import { dispatch, status, aggregate } from '../src/dispatch.js';
import { configureRuntime, resolveRuntime, findConfigFile, configTemplate } from '../src/config.js';

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

// ============ 全局连接配置（连 Multica 用） ============
program
  .option('--config <file>', '配置文件路径（默认 ./multica.config.json 或 ~/.multica-fanout.json）')
  .option('--profile <name>', 'multica CLI profile 名（对应 ~/.multica/profiles/<name>）')
  .option('--workspace-id <id>', 'workspace ID（multica workspace list 查询）')
  .option('--server-url <url>', '自托管 Multica 服务地址（如 https://api.example.com）')
  .option('--multica-bin <cmd>', 'multica 命令（默认 multica，支持带前缀如 "node fake.mjs"）');

// ------------------------------------------------------------
// config：查看 / 初始化连接配置
// ------------------------------------------------------------
program
  .command('config')
  .description('查看当前生效的 Multica 连接配置，或生成配置文件模板')
  .option('--init [file]', '生成配置文件模板到指定路径（默认 ./multica.config.json）')
  .option('--json', 'JSON 输出')
  .action((opts) => {
    if (opts.init) {
      const target = path.resolve(typeof opts.init === 'string' ? opts.init : 'multica.config.json');
      if (fs.existsSync(target)) {
        console.error(`✗ 文件已存在：${target}（如需重置请先删除）`);
        process.exit(1);
      }
      fs.writeFileSync(target, configTemplate() + '\n', 'utf8');
      console.log(`✓ 已生成配置模板：${target}\n请填写后运行：fanout doctor 验证连接。`);
      return;
    }
    const resolved = resolveRuntime(program.opts());
    const visible = {
      configFile: resolved.file,
      multicaBin: resolved.multicaBin,
      profile: resolved.profile,
      workspaceId: resolved.workspaceId,
      serverUrl: resolved.serverUrl,
      hint: 'token 不在此处展示，请用 multica login 登录（不推荐写入配置文件）。',
    };
    if (opts.json) return printJson(visible);
    console.log('当前生效的 Multica 连接配置：');
    console.log(`  配置文件 : ${visible.configFile || '(未使用，走默认)'}`);
    console.log(`  multica  : ${visible.multicaBin || 'multica'}`);
    console.log(`  profile  : ${visible.profile || '(默认)'}`);
    console.log(`  workspace: ${visible.workspaceId || '(默认)'}`);
    console.log(`  server   : ${visible.serverUrl || '(Multica Cloud)'}`);
    console.log('\n提示：');
    console.log('  1. token 用 multica login 登录，不写入配置文件；');
    console.log('  2. 配置文件优先级：命令行 > 环境变量(MULTICA_*) > 配置文件；');
    console.log('  3. 生成模板：fanout config --init');
  });

// ------------------------------------------------------------
// doctor：环境体检
// ------------------------------------------------------------
program
  .command('doctor')
  .description('检查 multica CLI、登录状态与工作区智能体')
  .action(() => {
    configureRuntime(program.opts());
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
    configureRuntime(program.opts());
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
    configureRuntime(program.opts());
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
    configureRuntime(program.opts());
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
    configureRuntime(program.opts());
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
  fanout config --init                           # 生成 multica.config.json 模板
  fanout config                                  # 查看当前生效的连接配置
  fanout doctor                                  # 体检：multica 可用、登录、智能体
  fanout dispatch --title "竞品调研" --description-file ctx.md \\
      --agents "codex,claude,gemini,hermes,opencode,cursor" --json
  fanout status MUL-100                          # 查看 6 个子任务进度
  fanout aggregate MUL-100 --out-dir ./results   # 聚合 6 份产出回写父 Issue

连接配置优先级：命令行 > 环境变量(MULTICA_PROFILE/workspace/server) > multica.config.json
`);
});

program.parse(process.argv);
