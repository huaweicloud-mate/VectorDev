import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * 配置接入层
 *
 * 负责加载「连 Multica 所需的连接配置」，并提供给 CLI 封装层注入到每条 multica 命令。
 *
 * 优先级（高 → 低）：
 *   1. 命令行参数（--profile / --workspace-id / --server-url / --multica-bin）
 *   2. 环境变量（MULTICA_PROFILE / MULTICA_WORKSPACE_ID / MULTICA_SERVER_URL / MULTICA_BIN）
 *   3. 配置文件（multica.config.json）
 *
 * 配置文件查找顺序（取第一个存在的）：
 *   1. --config <file> 显式指定
 *   2. 当前目录 ./multica.config.json
 *   3. 用户目录 ~/.multica-fanout.json
 */

const DEFAULT_FILE_NAME = 'multica.config.json';

/** 运行时状态（单例），由 configureRuntime() 写入，multica.js 读取 */
const runtime = {
  multicaBin: null,   // multica 命令（含前缀），默认 'multica'
  profile: null,      // multica CLI profile 名
  workspaceId: null,  // workspace ID（--workspace-id 只接受 ID，不接受 slug）
  serverUrl: null,    // 自托管服务地址（--server-url）
  source: null,       // 用于诊断：配置来自哪里
};

export function findConfigFile(explicit) {
  const candidates = explicit ? [path.resolve(explicit)] : [path.join(process.cwd(), DEFAULT_FILE_NAME)];
  if (!explicit) candidates.push(path.join(os.homedir(), '.multica-fanout.json'));
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return null;
}

export function readConfigFile(file) {
  if (!file) return {};
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    return {
      multicaBin: raw.multicaBin ?? raw.multica_bin ?? null,
      profile: raw.profile ?? null,
      workspaceId: raw.workspaceId ?? raw.workspace_id ?? null,
      serverUrl: raw.serverUrl ?? raw.server_url ?? null,
    };
  } catch (e) {
    throw new Error(`配置文件解析失败：${file}（${e.message}）`);
  }
}

/**
 * 解析运行时配置：CLI > env > 配置文件
 * @param {object} cliOpts 来自 commander 的全局选项（config/profile/workspaceId/serverUrl/multicaBin）
 */
export function resolveRuntime(cliOpts = {}) {
  const file = findConfigFile(cliOpts.config);
  const fileCfg = readConfigFile(file);

  const env = {
    multicaBin: process.env.MULTICA_BIN || null,
    profile: process.env.MULTICA_PROFILE || null,
    workspaceId: process.env.MULTICA_WORKSPACE_ID || null,
    serverUrl: process.env.MULTICA_SERVER_URL || null,
  };

  const cli = {
    multicaBin: cliOpts.multicaBin || null,
    profile: cliOpts.profile || null,
    workspaceId: cliOpts.workspaceId || null,
    serverUrl: cliOpts.serverUrl || null,
  };

  const pick = (key) => cli[key] || env[key] || fileCfg[key] || null;

  return {
    file,
    multicaBin: pick('multicaBin'),
    profile: pick('profile'),
    workspaceId: pick('workspaceId'),
    serverUrl: pick('serverUrl'),
  };
}

/** 把解析结果写入全局 runtime（multica.js 依赖） */
export function configureRuntime(cliOpts = {}) {
  const resolved = resolveRuntime(cliOpts);
  runtime.multicaBin = resolved.multicaBin;
  runtime.profile = resolved.profile;
  runtime.workspaceId = resolved.workspaceId;
  runtime.serverUrl = resolved.serverUrl;
  runtime.source = resolved.file ? `file:${resolved.file}` : 'default';
  return resolved;
}

export function getRuntime() {
  return { ...runtime };
}

/** 拼出要附加到每条 multica 命令前的全局 flag */
export function globalFlags() {
  const flags = [];
  if (runtime.profile) flags.push('--profile', runtime.profile);
  if (runtime.workspaceId) flags.push('--workspace-id', runtime.workspaceId);
  if (runtime.serverUrl) flags.push('--server-url', runtime.serverUrl);
  return flags;
}

/** 生成配置文件模板内容（供用户填写） */
export function configTemplate() {
  return JSON.stringify(
    {
      $comment: 'multica-fanout 连接配置。复制本文件为 multica.config.json 后填写。token 不要写在这里，用 multica login 登录。',
      multicaBin: 'multica',
      profile: '',
      workspaceId: '',
      serverUrl: '',
    },
    null,
    2,
  );
}
