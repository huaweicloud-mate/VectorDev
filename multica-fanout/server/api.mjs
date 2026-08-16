#!/usr/bin/env node
/**
 * VectorDev 控制台 HTTP 服务（零依赖，Node 原生 http）
 *
 * 职责：
 *  1. 挂载 CLI 集成基座（gateway）→ /api/cli/* 路由
 *  2. 静态托管 web/dist（生产构建产物）
 *
 * 用法：
 *   node server/api.mjs            # 默认端口 8787
 *   PORT=9000 node server/api.mjs
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { configureRuntime } from '../src/config.js';
import { listTools, runAction, loadToolsDir } from './gateway.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DIST = path.join(ROOT, 'web', 'dist');
const TOOLS_DIR = path.join(__dirname, 'tools');
const PORT = Number(process.env.PORT || 8787);

// 连接配置（multica.config.json）
configureRuntime({});

// 自动注册 tools/ 下的所有工具
loadToolsDir(TOOLS_DIR);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

function sendJson(res, code, data) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
  res.end(JSON.stringify(data));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => (data += c));
    req.on('end', () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch {
        reject(Object.assign(new Error('请求体不是合法 JSON'), { status: 400 }));
      }
    });
    req.on('error', reject);
  });
}

function serveStatic(req, res) {
  if (!fs.existsSync(DIST)) return false;
  let urlPath;
  try {
    urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  } catch {
    return false;
  }
  if (urlPath === '/') urlPath = '/index.html';
  const file = path.join(DIST, urlPath);
  if (!file.startsWith(DIST) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return false;
  const ext = path.extname(file).toLowerCase();
  res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
  return true;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const p = url.pathname;

  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    });
    return res.end();
  }

  try {
    // ---- 基础健康检查 ----
    if (p === '/api/health') {
      let info = { ok: false, error: null };
      try {
        const { agentList } = await import('../src/multica.js');
        const agents = agentList();
        info = { ok: true, tools: listTools().length, agents: agents.length };
      } catch (e) {
        info = { ok: false, error: e.message };
      }
      return sendJson(res, 200, info);
    }

    // ---- CLI 集成基座路由 ----
    if (p === '/api/cli/tools' && req.method === 'GET') {
      return sendJson(res, 200, { tools: listTools() });
    }

    const runMatch = p.match(/^\/api\/cli\/tools\/([^/]+)\/run$/);
    if (runMatch && req.method === 'POST') {
      const body = await readBody(req);
      const result = await runAction(runMatch[1], body.action, {
        body: body.params || body, // 兼容：直接传 params，或包一层
      });
      return sendJson(res, 200, result);
    }

    // 工具 action 带路径参数：/api/cli/tools/:id/:action/:param1
    const actionMatch = p.match(/^\/api\/cli\/tools\/([^/]+)\/([^/]+)(?:\/(.+))?$/);
    if (actionMatch) {
      const [, toolId, action, rest] = actionMatch;
      const body = req.method === 'POST' ? await readBody(req) : {};
      const result = await runAction(toolId, action, {
        params: rest ? { parentId: decodeURIComponent(rest) } : {},
        query: Object.fromEntries(url.searchParams),
        body,
      });
      return sendJson(res, 200, result);
    }

    // ---- 静态托管（生产构建） ----
    if (serveStatic(req, res)) return;

    sendJson(res, 404, { error: `未找到端点：${req.method} ${p}` });
  } catch (e) {
    sendJson(res, e.status || 500, { error: e.message });
  }
});

server.listen(PORT, () => {
  console.log(`VectorDev Console 已启动：http://localhost:${PORT}`);
  console.log(`  工具（${listTools().length}）：${listTools().map((t) => `${t.id}(${t.name})`).join(', ') || '无'}`);
  console.log(`  API 基座：/api/cli/tools | /api/cli/tools/:id/:action`);
  console.log(`  静态: ${fs.existsSync(DIST) ? DIST : '(未构建 web/dist，开发请另开 Vite dev server)'}`);
});
