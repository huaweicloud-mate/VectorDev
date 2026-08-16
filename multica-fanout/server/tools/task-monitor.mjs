/**
 * 工具：任务监控（Task Monitor）
 *
 * 把一次多 Agent 并行派发抽象为「任务」：从起点 → N 个 Agent 并行 → 汇总结果。
 * 提供任务列表、任务详情（进展图数据）、Agent 实时工作查看。
 *
 * actions:
 *   GET  tasks          → 任务列表（metadata 标记的 fanout 任务 + 各自进度）
 *   GET  task/:id       → 任务详情（父 + 子 + Agent 在线/工作状态 + 实时执行）
 *   GET  agent/:id      → Agent 实时情况（runtime 在线 + 运行中/最近任务）
 *   GET  presence       → 工作区 Agent 存在状态（在线/离线/工作中）
 */
import { listTasks, taskDetail, agentDetail, agentPresence } from '../../src/dispatch.js';
import { registerTool } from '../gateway.mjs';

registerTool({
  id: 'task-monitor',
  name: '任务监控',
  description: '任务进展可视化：一次派发从起点到多 Agent 并行再到汇总的整体进展与实时工作查看',
  actions: {
    tasks: {
      method: 'GET',
      run: () => listTasks(),
    },
    task: {
      method: 'GET',
      run: ({ params }) => {
        if (!params.parentId) throw Object.assign(new Error('缺少任务 id'), { status: 400 });
        return taskDetail(params.parentId);
      },
    },
    agent: {
      method: 'GET',
      run: ({ params }) => {
        if (!params.parentId) throw Object.assign(new Error('缺少 agent id'), { status: 400 });
        return agentDetail(params.parentId);
      },
    },
    presence: {
      method: 'GET',
      run: () => agentPresence(),
    },
  },
});
