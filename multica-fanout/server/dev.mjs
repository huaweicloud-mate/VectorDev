#!/usr/bin/env node
/**
 * 一键开发：同时启动 API 服务（8787）与 Vite dev server（5173，代理 /api）。
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const isWin = process.platform === 'win32';

function run(name, cmd, args, opts = {}) {
  const child = spawn(cmd, args, {
    cwd: ROOT,
    shell: isWin,
    stdio: ['ignore', 'inherit', 'inherit'],
    ...opts,
  });
  child.on('exit', (code) => {
    console.log(`[${name}] 退出（code=${code}）`);
  });
  return child;
}

const api = run('api', 'node', [path.join('server', 'api.mjs')]);
const web = run('web', 'npm', ['--prefix', 'web', 'run', 'dev']);

console.log('VectorDev Console 开发模式：');
console.log('  API  : http://localhost:8787');
console.log('  Web  : http://localhost:5173 （Ctrl+C 退出）');

process.on('SIGINT', () => {
  api.kill();
  web.kill();
  process.exit(0);
});
