/**
 * CLI 集成基座（Gateway）
 *
 * 这是所有前端工具的「统一执行入口」：
 *  - 工具（tool）以注册表形式挂载，每个工具定义一组白名单 action；
 *  - action 是显式编写的 handler（内部调用 src/ 封装的 multica CLI），
 *    不执行任意命令 —— 保证安全与可审计；
 *  - 前端菜单数据（GET /api/cli/tools）来自本注册表，未来新增工具
 *    只需在 server/tools/ 新增文件并 registerTool，前端无需改代码。
 *
 * 约定：
 *  - action.run(ctx) 返回可 JSON 序列化的数据；
 *  - ctx = { params: URL 路径参数, body: 请求体, query: URL 查询参数 }；
 *  - 抛错时携带 { status } 映射 HTTP 状态码。
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const tools = new Map();

/**
 * 注册一个工具
 * @param {{id:string, name:string, description?:string, actions:Object<string,{method?:string, run:(ctx)=>any}>}} tool
 */
export function registerTool(tool) {
  if (!tool?.id || !tool?.name) throw new Error('registerTool 需要 id 与 name');
  if (!tool.actions || typeof tool.actions !== 'object') throw new Error(`工具 ${tool.id} 缺少 actions`);
  tools.set(tool.id, tool);
}

/** 列出工具（供前端菜单渲染） */
export function listTools() {
  return [...tools.values()].map(({ id, name, description, actions }) => ({
    id,
    name,
    description: description || '',
    actions: Object.entries(actions).map(([action, def]) => ({
      id: action,
      method: def.method || 'GET',
    })),
  }));
}

export function getTool(id) {
  return tools.get(id) || null;
}

/** 白名单执行一个工具 action */
export async function runAction(toolId, action, ctx = {}) {
  const tool = tools.get(toolId);
  if (!tool) {
    const err = new Error(`未知工具：${toolId}`);
    err.status = 404;
    throw err;
  }
  const def = tool.actions[action];
  if (!def) {
    const err = new Error(`工具「${tool.name}」无此动作：${action}`);
    err.status = 404;
    throw err;
  }
  if (typeof def.run !== 'function') {
    const err = new Error(`动作 ${toolId}.${action} 未实现 run()`);
    err.status = 500;
    throw err;
  }
  const result = await def.run({
    params: ctx.params || {},
    query: ctx.query || {},
    body: ctx.body || {},
  });
  return { tool: toolId, action, data: result };
}

/** 自动加载 server/tools/ 下的所有工具定义（*.mjs） */
export function loadToolsDir(dir) {
  if (!fs.existsSync(dir)) return;
  const entries = fs.readdirSync(dir).filter((f) => f.endsWith('.mjs'));
  for (const entry of entries) {
    // Windows 下绝对路径必须转 file:// URL
    import(pathToFileURL(path.join(dir, entry)).href);
  }
}
