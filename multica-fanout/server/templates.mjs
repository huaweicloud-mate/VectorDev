/**
 * 模板注册表（Template Registry）
 *
 * 模板 = 预定义的执行编排结构。当前提供「总-分-总」：
 *   - 总（开始）：标志节点，无 Agent
 *   - 分：N 个并行 Agent 节点（前端可增删）
 *   - 总（汇总）：选择一个 Agent 汇总所有产出，生成完整测试报告
 *
 * 模板只读，不做在线编辑；新增模板 = 在此 registerTemplate + 前端注册对应编排 UI。
 */

const templates = new Map();

export function registerTemplate(t) {
  if (!t?.id || !t?.name) throw new Error('registerTemplate 需要 id 与 name');
  templates.set(t.id, t);
}

export function listTemplates() {
  return [...templates.values()].map(({ id, name, description, stages, input }) => ({
    id,
    name,
    description: description || '',
    stages: stages || [],
    input: input || null,
  }));
}

export function getTemplate(id) {
  return templates.get(id) || null;
}

registerTemplate({
  id: 'summary',
  name: '总-分-总',
  description: '起点标志 → 多个 Agent 并行执行 → 汇总 Agent 生成完整测试报告',
  stages: [
    { role: 'start', label: '总 · 开始', note: '标志节点，无 Agent 执行' },
    { role: 'parallel', label: '分 · 并行执行', note: '在页面上自由增删并行 Agent 节点' },
    { role: 'summary', label: '总 · 汇总', note: '选择一个 Agent，汇总所有产出生成完整测试报告' },
  ],
  input: {
    requireSummaryAgent: true,
  },
});
