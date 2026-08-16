/**
 * 工具：插件测试（多 Agent 分发）
 *
 * 第一个接入 CLI 集成基座的工具：把一个任务并行派发给多个 Agent，
 * 多视角执行后聚合产出。全部复用 src/ 的 dispatch/status/aggregate 能力。
 *
 * actions:
 *   GET  agents          → 工作区可派发的 Agent 列表
 *   POST dispatch        → 并行派发 { title, description, agents, viewpoints, status, stage }
 *   GET  status/:parentId→ 子任务进度
 *   POST aggregate/:id   → 聚合产出
 */
import * as m from '../../src/multica.js';
import { dispatch, status, aggregate, agentPresence } from '../../src/dispatch.js';
import { registerTool } from '../gateway.mjs';

registerTool({
  id: 'plugin-test',
  name: '插件测试',
  description: '多 Agent 并行分发：一个任务派给多个 Agent，多视角并行执行后聚合',
  actions: {
    agents: {
      method: 'GET',
      // 带存在状态：在线/离线/工作中（runtime 在线 + 运行中任务探测）
      run: () => agentPresence(),
    },
    dispatch: {
      method: 'POST',
      run: ({ body }) => {
        if (!body.title) throw Object.assign(new Error('缺少 title'), { status: 400 });
        if (!Array.isArray(body.agents) || !body.agents.length) {
          throw Object.assign(new Error('缺少 agents（至少 1 个）'), { status: 400 });
        }
        return dispatch({
          title: body.title,
          description: body.description || '',
          agents: body.agents,
          viewpoints: body.viewpoints,
          status: body.status || 'todo',
          stage: body.stage,
          priority: body.priority,
          project: body.project,
        });
      },
    },
    status: {
      method: 'GET',
      run: ({ params }) => {
        if (!params.parentId) throw Object.assign(new Error('缺少 parentId'), { status: 400 });
        return status(params.parentId);
      },
    },
    aggregate: {
      method: 'POST',
      run: ({ params, body }) => {
        if (!params.parentId) throw Object.assign(new Error('缺少 parentId'), { status: 400 });
        const result = aggregate(params.parentId, {
          outDir: body.outDir || 'output',
          wait: body.wait !== false,
          pollInterval: Number(body.pollInterval) || 10000,
          timeoutMs: Number(body.timeoutMs) || 0,
        });
        return {
          parentId: result.parentId,
          parentKey: result.parentKey,
          total: result.total,
          items: result.items.map((it) => ({ ...it, summary: undefined })),
        };
      },
    },
  },
});
