import React, { useEffect, useMemo, useState } from 'react';
import { runTool, runToolWithPath } from '../api.js';
import { Button, Badge, Field, inputCls, Spinner, EmptyState, ErrorState, Skeleton, StatusDot } from '../components/ui.jsx';

const STATUS_META = {
  done: { label: 'done', tone: 'ok' },
  in_review: { label: 'in_review', tone: 'warn' },
  in_progress: { label: 'running', tone: 'accent' },
  todo: { label: 'todo', tone: 'neutral' },
  backlog: { label: 'backlog', tone: 'neutral' },
  blocked: { label: 'blocked', tone: 'err' },
  cancelled: { label: 'cancelled', tone: 'neutral' },
};

/** 工具页：插件测试（多 Agent 分发） */
export default function PluginTest() {
  const [agents, setAgents] = useState(null);
  const [agentsError, setAgentsError] = useState(null);
  const [selected, setSelected] = useState([]);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [formError, setFormError] = useState(null);

  const [dispatching, setDispatching] = useState(false);
  const [report, setReport] = useState(null);
  const [dispatchError, setDispatchError] = useState(null);

  const [rows, setRows] = useState(null);
  const [statusLoading, setStatusLoading] = useState(false);

  const loadAgents = () => {
    setAgents(null);
    setAgentsError(null);
    runTool('plugin-test', 'agents')
      .then((list) => setAgents(list || []))
      .catch((e) => setAgentsError(e.message));
  };
  useEffect(loadAgents, []);

  const available = useMemo(() => (agents || []).filter((a) => !a.archived), [agents]);
  const isAllSelected = available.length > 0 && selected.length === available.length;

  const toggle = (id) =>
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  const toggleAll = () => setSelected(isAllSelected ? [] : available.map((a) => a.id));

  async function handleDispatch() {
    setFormError(null);
    setDispatchError(null);
    if (!title.trim()) return setFormError('请填写任务标题');
    if (selected.length === 0) return setFormError('请至少选择一个 Agent');
    setDispatching(true);
    setReport(null);
    setRows(null);
    try {
      const rep = await runTool('plugin-test', 'dispatch', {
        title: title.trim(),
        description: description.trim(),
        agents: available.filter((a) => selected.includes(a.id)).map((a) => a.name),
      });
      setReport(rep);
    } catch (e) {
      setDispatchError(e.message);
    } finally {
      setDispatching(false);
    }
  }

  async function refreshStatus() {
    if (!report?.parent?.id) return;
    setStatusLoading(true);
    try {
      const s = await runToolWithPath('plugin-test', 'status', report.parent.id);
      setRows(s.rows || []);
    } catch (e) {
      setDispatchError(`刷新状态失败：${e.message}`);
    } finally {
      setStatusLoading(false);
    }
  }

  async function handleAggregate() {
    if (!report?.parent?.id) return;
    setStatusLoading(true);
    setDispatchError(null);
    try {
      const agg = await runToolWithPath('plugin-test', 'aggregate', report.parent.id, { wait: false });
      setRows(
        (agg.items || []).map((it) => ({
          key: it.issueKey,
          title: it.agentName,
          assignee: it.agentName,
          status: it.status,
          _content: it.content,
        })),
      );
    } catch (e) {
      setDispatchError(`聚合失败：${e.message}`);
    } finally {
      setStatusLoading(false);
    }
  }

  return (
    <div className="mx-auto max-w-[1200px] px-8 py-8">
      {/* 页头 */}
      <header className="mb-8">
        <div className="flex items-center gap-2">
          <Badge tone="accent">工具 01</Badge>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">插件测试</h1>
        </div>
        <p className="mt-1.5 text-sm leading-relaxed text-slate-500 max-w-[65ch]">
          多 Agent 并行分发：一个任务同时派发给多个 Agent，各自从独立视角执行，完成后聚合对比。
        </p>
      </header>

      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        {/* 左列：派发表单 */}
        <section className="space-y-6">
          {/* Agent 选择 */}
          <div className="rounded-2xl border border-slate-200/60 bg-white p-6 shadow-sm">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-slate-800">选择 Agent</h2>
              <div className="flex items-center gap-3">
                <span className="text-xs text-slate-400">
                  已选 <span className="font-semibold text-[#d97757]">{selected.length}</span> / {available.length}
                </span>
                <button
                  type="button"
                  onClick={toggleAll}
                  className="text-xs font-medium text-[#b4542f] hover:underline"
                >
                  {isAllSelected ? '取消全选' : '全选'}
                </button>
              </div>
            </div>

            {agentsError ? (
              <ErrorState message={agentsError} onRetry={loadAgents} />
            ) : !agents ? (
              <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
                {Array.from({ length: 6 }).map((_, i) => (
                  <Skeleton key={i} className="h-16" />
                ))}
              </div>
            ) : agents.length === 0 ? (
              <EmptyState title="工作区暂无 Agent" description="请先在 Multica 工作区创建 Agent。" />
            ) : (
              <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3" role="group" aria-label="选择 Agent">
                {available.map((a) => {
                  const on = selected.includes(a.id);
                  return (
                    <label
                      key={a.id}
                      className={`flex cursor-pointer items-start gap-2.5 rounded-xl border p-3 transition-all duration-150 ${
                        on
                          ? 'border-[#d97757]/50 bg-[#d97757]/5 ring-1 ring-[#d97757]/30'
                          : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50'
                      }`}
                    >
                      <input
                        type="checkbox"
                        className="mt-0.5 h-4 w-4 accent-[#d97757]"
                        checked={on}
                        onChange={() => toggle(a.id)}
                      />
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium text-slate-800">{a.name}</span>
                        <span className="block truncate text-[11px] text-slate-400">{a.model || a.id.slice(0, 8)}</span>
                      </span>
                    </label>
                  );
                })}
              </div>
            )}
          </div>

          {/* 任务表单 */}
          <div className="rounded-2xl border border-slate-200/60 bg-white p-6 shadow-sm">
            <h2 className="mb-4 text-sm font-semibold text-slate-800">任务信息</h2>
            <div className="space-y-4">
              <Field label="任务标题" error={formError === '请填写任务标题' ? formError : null}>
                <input
                  className={inputCls}
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="例如：调研 MCP 生态发展趋势"
                />
              </Field>
              <Field label="任务背景" hint="可选，将注入到每个 Agent 的子任务">
                <textarea
                  className={`${inputCls} min-h-24 resize-y`}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="描述任务背景、目标与验收期望…"
                />
              </Field>
              {formError === '请至少选择一个 Agent' && (
                <p className="text-xs text-rose-600">{formError}</p>
              )}
              <div className="flex items-center gap-3 pt-1">
                <Button loading={dispatching} disabled={!agents} onClick={handleDispatch}>
                  {dispatching ? '派发中…' : '一键并行派发'}
                </Button>
                <span className="text-xs text-slate-400">
                  每个 Agent 自动获得独立视角与隔离产出目录
                </span>
              </div>
            </div>
          </div>

          {dispatchError && (
            <div className="rounded-xl border border-rose-200 bg-rose-50/60 px-4 py-3 text-sm text-rose-700">
              {dispatchError}
            </div>
          )}
        </section>

        {/* 右列：派发结果 / 状态 */}
        <section className="space-y-4">
          <div className="rounded-2xl border border-slate-200/60 bg-white p-6 shadow-sm">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-slate-800">执行结果</h2>
              {report && (
                <button
                  type="button"
                  onClick={refreshStatus}
                  disabled={statusLoading}
                  className="inline-flex items-center gap-1.5 text-xs font-medium text-[#b4542f] hover:underline disabled:opacity-50"
                >
                  {statusLoading && <Spinner className="h-3.5 w-3.5" />}
                  刷新状态
                </button>
              )}
            </div>

            {!report && !dispatchError && (
              <p className="py-10 text-center text-sm text-slate-400">派发后，子任务与状态将显示在这里</p>
            )}

            {report && (
              <div className="space-y-4">
                <div className="rounded-xl bg-slate-50 px-4 py-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-slate-500">父 Issue（聚合点）</span>
                    <Badge tone="accent">{report.parent.key || report.parent.id}</Badge>
                  </div>
                  <div className="mt-1 text-sm font-medium text-slate-800">{report.parent.title}</div>
                  <div className="mt-0.5 text-xs text-slate-400">已并行派发 {report.childCount} 个 Agent</div>
                </div>

                {/* 子任务列表 */}
                {rows ? (
                  <ul className="divide-y divide-slate-100 rounded-xl border border-slate-100">
                    {rows.map((r, i) => {
                      const meta = STATUS_META[r.status] || { label: r.status, tone: 'neutral' };
                      return (
                        <li key={i} className="flex items-center justify-between gap-3 px-4 py-2.5">
                          <div className="min-w-0">
                            <div className="truncate text-sm text-slate-700">{r.assignee || r.title}</div>
                            <div className="text-[11px] text-slate-400">{r.key}</div>
                          </div>
                          <Badge tone={meta.tone}>{meta.label}</Badge>
                        </li>
                      );
                    })}
                  </ul>
                ) : (
                  <ul className="divide-y divide-slate-100 rounded-xl border border-slate-100">
                    {report.children.map((c) => (
                      <li key={c.index} className="flex items-center justify-between gap-3 px-4 py-2.5">
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5">
                            <StatusDot tone="warn" />
                            <span className="truncate text-sm text-slate-700">{c.agentName}</span>
                          </div>
                          <div className="mt-0.5 text-[11px] text-slate-400">
                            {c.issueKey || c.issueId} · 视角 {c.index}
                          </div>
                        </div>
                        <Badge tone="neutral">todo</Badge>
                      </li>
                    ))}
                  </ul>
                )}

                {report && (
                  <div className="flex justify-end border-t border-slate-100 pt-3">
                    <Button variant="secondary" size="sm" disabled={statusLoading} onClick={handleAggregate}>
                      聚合产出
                    </Button>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* 提示卡 */}
          <div className="rounded-2xl border border-slate-200/60 bg-white p-5 text-xs leading-relaxed text-slate-500 shadow-sm">
            <div className="mb-1.5 flex items-center gap-1.5 text-slate-700">
              <StatusDot tone="accent" />
              <span className="font-medium">多视角并行说明</span>
            </div>
            派发后每个 Agent 从独立视角产出，写入隔离目录（output/&lt;agent&gt;/），
            评论回贴后由聚合步骤汇总对比。
          </div>
        </section>
      </div>
    </div>
  );
}
