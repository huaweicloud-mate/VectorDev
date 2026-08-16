import path from 'node:path';

/**
 * 描述模板：多视角并行模式下，每个子 Issue 的上下文、视角与产出规范。
 *
 * 关键设计（避免 6 个 Agent 互相冲突）：
 * 1. 每个 Agent 只允许写自己的独立输出目录 output/<agentKey>/，禁止改公共文件；
 * 2. 产出文件名统一为 <slug>-<agentKey>.md，格式统一，方便最终聚合对比；
 * 3. 子任务描述 = 完整背景 + 该 Agent 的视角 + 产出规范（同一套模板，视角不同）。
 */

/** 生成 slug：标题 → 安全的文件名片段 */
export function slugify(title) {
  return title
    .trim()
    .toLowerCase()
    .replace(/[^\w\u4e00-\u9fa5]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'task';
}

/** Agent key（用于目录/文件名）：名称 → 小写字母数字短串 */
export function agentKey(name) {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 24) || 'agent';
}

/**
 * 构建父 Issue 描述：聚合点，说明这是 fan-out 多视角任务
 */
export function buildParentDescription({ title, background, agentCount }) {
  return [
    `# ${title}`,
    '',
    '> 这是一个 **多 Agent 并行派发（fan-out）** 任务：同一目标，多视角产出，最后聚合对比。',
    '',
    `共派发给 **${agentCount} 个 Agent** 并行执行（各自独立子 Issue）。`,
    '',
    '---',
    '',
    '## 任务背景',
    '',
    background ? background : '（请补充任务背景）',
    '',
    '---',
    '',
    '## 聚合说明',
    '',
    '所有子 Issue 完成后，由派发脚本汇总各 Agent 产出并回写本 Issue 评论。',
    '请勿直接在本 Issue 下修改任务描述。',
    '',
  ].join('\n');
}

/**
 * 构建单个子 Issue 描述
 */
export function buildSubtaskDescription({ title, background, viewpoint, agentName, index, outputSpec }) {
  const key = agentKey(agentName);
  const dir = path.posix.join(outputSpec.dir || 'output', key);
  const file = `${outputSpec.filePrefix || 'view'}-${index}-${key}.md`;

  return [
    `# [${index}] ${title}`,
    '',
    `> 本任务属于多 Agent 并行派发（fan-out），你负责**视角 ${index}**，请只从自己的视角输出。`,
    '',
    '---',
    '',
    '## 任务背景',
    '',
    background ? background : '（请阅读父 Issue 获取完整背景）',
    '',
    '---',
    '',
    `## 你的视角（第 ${index} 个）`,
    '',
    viewpoint || `从第 ${index} 个专业视角给出独立评估`,
    '',
    '---',
    '',
    '## 产出要求（必须遵守，避免与其他 Agent 冲突）',
    '',
    `1. **工作目录隔离**：所有产出写入 \`${dir}/\`，不要创建或修改该目录之外的任何文件；`,
    `2. **产出文件**：统一命名为 \`${file}\`（Markdown），并**把完整内容粘贴到本 Issue 的评论**（脚本会从评论聚合结果）；`,
    '3. **内容结构**（Markdown）：',
    '   - `## 结论摘要`：200 字以内的核心结论；',
    '   - `## 论据与理由`：支撑结论的关键事实与推理；',
    '   - `## 建议`：可执行的下一步；',
    '   - `## 风险`：你视角下的主要风险与缓解；',
    '4. **完成后**：把本 Issue 状态置为 `in_review`，并在评论中 @ 父 Issue 说明已完成。',
    '',
    '---',
    '',
    '## 交付标准',
    '',
    '- 产出文件存在且内容完整；',
    '- 结论可独立阅读，不依赖其他 Agent 的产出；',
    '- 明确标注你负责的视角编号。',
    '',
  ].join('\n');
}

/**
 * 构建聚合汇总评论：把 N 份产出合并成一份对比报告
 */
export function buildAggregateSummary({ title, items }) {
  const lines = [
    `# 多 Agent 并行产出聚合：${title}`,
    '',
    `共 **${items.length}** 份独立产出，聚合时间：${new Date().toLocaleString('zh-CN')}`,
    '',
    '---',
    '',
  ];

  for (const item of items) {
    lines.push(
      `## ${item.index}. ${item.viewpoint || '视角'}`,
      '',
      `- 负责人：${item.agentName}（${item.issueKey || item.issueId}）`,
      `- 状态：${item.status}`,
      '',
    );
    if (item.content) {
      lines.push('```markdown');
      lines.push(item.content.trim().slice(0, 6000));
      lines.push('```');
      lines.push('');
    } else {
      lines.push('_（该 Agent 未在评论中提供产出）_');
      lines.push('');
    }
    lines.push('---', '');
  }

  lines.push('> 本汇总由 multica-fanout 自动生成，各子 Issue 中保留了每份产出的原始记录。', '');
  return lines.join('\n');
}
