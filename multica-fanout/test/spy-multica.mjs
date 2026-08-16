#!/usr/bin/env node
/**
 * Spy Multica CLI —— 记录每条 multica 命令的完整 argv（含注入的全局 flag），
 * 然后透传给 fake-multica.mjs。用于测试「配置注入」是否正确生效。
 * 注入方式：MULTICA_BIN="node test/spy-multica.mjs"
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fake = path.join(__dirname, 'fake-multica.mjs');
const args = process.argv.slice(2);

// 记录到 stderr（人工调试用）+ SPY_LOG 文件（测试断言用）
const line = `[SPY] multica ${args.join(' ')}`;
process.stderr.write(line + '\n');
if (process.env.SPY_LOG) {
  try {
    fs.appendFileSync(process.env.SPY_LOG, line + '\n', 'utf8');
  } catch {}
}

let input;
try {
  input = fs.readFileSync(0, 'utf8');
} catch {
  input = undefined;
}

const res = spawnSync(process.execPath, [fake, ...args], {
  encoding: 'utf8',
  input,
  env: process.env,
  maxBuffer: 32 * 1024 * 1024,
  windowsHide: true,
});
process.stdout.write(res.stdout || '');
process.stderr.write(res.stderr || '');
process.exit(res.status ?? 1);
