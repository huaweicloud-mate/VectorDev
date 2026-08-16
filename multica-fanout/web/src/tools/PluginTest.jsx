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

/** Agent 存在状态：offline / online / busy / archived */
function agentState(a) {
  if (a.archived) return { key: 'archived', label: '归档', tone: 'neutral' };
  if (a.online && a.busy) return { key: 'busy', label: '工作中', tone: 'accent' };
  if (a.online) return { key: 'online', label: '在线', tone: 'ok' };
  return { key: 'offline', label: '离线', tone: 'neutral' };
}

const FILTERS = [
  { key: 'all', label: '全部' },
  { key: 'online', label: '在线' },
  { key: 'busy', label: '工作中' },
  { key: 'offline', label: '离线' },
];

/** 工具页：插件测试（多 Agent 分发） */
export default function PluginTest() {
  const [agents, setAgents] = useState(null);
  const [agentsError, setAgentsError] = useState(null);
  const [selected, setSelected] = useState([]);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [formError, setFormError] = useState(null);
  const [mode, setMode] = useState('free'); // free | summary（总-分-总模板）
  const [summaryAgent, setSummaryAgent] = useState('');

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
  const filtered = useMemo(() => {
    const kw = search.trim().toLowerCase();
    return available.filter((a) => {
      if (filter !== 'all' && agentState(a).key !== filter) return false;
      if (kw && !String(a.name).toLowerCase().includes(kw) && !String(a.model || '').toLowerCase().includes(kw)) return false;
      return true;
    });
  }, [available, search, filter]);

  const counts = useMemo(() => {
    const c = { all: available.length, online: 0, busy: 0, offline: 0 };
    for (const a of available) c[agentState(a).key] += 1;
    return c;
  }, [available]);

  const isAllSelected = filtered.length > 0 && filtered.every((a) => selected.includes(a.id));
  const toggle = (id) => setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  const toggleAll = () =>
    setSelected((prev) => {
      const ids = filtered.map((a) => a.id);
      return isAllSelected ? prev.filter((x) => !ids.includes(x)) : [...new Set([...prev, ...ids])];
    });

  async function handleDispatch() {
    setFormError(null);
    setDispatchError(null);
    if (!title.trim()) return setFormError('请填写任务标题');
    if (selected.length === 0) return setFormError('请至少选择一个 Agent');
    if (mode === 'summary' && !summaryAgent) return setFormError('请选择汇总 Agent');
    setDispatching(true);
    setReport(null);
    setRows(null);
    try {
      const agentNames = available.filter((a) => selected.includes(a.id)).map((a) => a.name);
      const rep =
        mode === 'summary'
          ? await runTool('plugin-test', 'dispatch-summary', {
              template: 'summary',
              title: title.trim(),
              description: description.trim(),
              agents: agentNames,
              summaryAgent,
            })
          : await runTool('plugin-test', 'dispatch', {
              title: title.trim(),
              description: description.trim(),
              agents: agentNames,
            });
      setReport(rep);
      setSelected([]);
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
      <header className="mb-6">
        <div className="flex items-center gap-2">
          <Badge tone="accent">工具 01</Badge>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">插件测试</h1>
        </div>
        <p className="mt-1.5 text-sm leading-relaxed text-slate-500 max-w-[65ch]">
          多 Agent 并行分发：一个任务同时派发给多个 Agent，各自从独立视角执行。派发后到「任务监控」查看整体进展图。
        </p>
      </header>

      {/* 派发模式 / 模板选择 */}
      <section className="mb-5 grid gap-3 md:grid-cols-2">
        <button
          type="button"
          onClick={() => setMode('free')}
          className={`rounded-2xl border p-4 text-left transition-all ${
            mode === 'free' ? 'border-[#d97757]/50 bg-[#d97757]/5 ring-1 ring-[#d97757]/25' : 'border-slate-200 bg-white hover:border-slate-300'
          }`}
        >
          <div className="text-sm font-semibold text-slate-800">自由派发</div>
          <div className="mt-1 text-xs leading-relaxed text-slate-500">
            一个任务派给 N 个 Agent 并行执行，之后手动聚合结果。
          </div>
        </button>
        <button
          type="button"
          onClick={() => setMode('summary')}
          className={`rounded-2xl border p-4 text-left transition-all ${
            mode === 'summary' ? 'border-[#d97757]/50 bg-[#d97757]/5 ring-1 ring-[#d97757]/25' : 'border-slate-200 bg-white hover:border-slate-300'
          }`}
        >
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-800">
            总-分-总 模板
            <Badge tone="accent">模板</Badge>
          </div>
          <div className="mt-1 text-xs leading-relaxed text-slate-500">
            起点 → N 个并行 Agent → 汇总 Agent 自动生成完整测试报告。
          </div>
        </button>
      </section>

      {/* Agent 选择（紧凑表格） */}
      <section className="rounded-2xl border border-slate-200/60 bg-white shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-5 py-3">
          <div className="flex items-center gap-1.5 text-sm font-semibold text-slate-800">
            选择 Agent
            <span className="text-xs font-normal text-slate-400">
              已选 <span className="font-semibold text-[#d97757]">{selected.length}</span> / {available.length}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex rounded-lg border border-slate-200 p-0.5">
              {FILTERS.map((f) => (
                <button
                  key={f.key}
                  type="button"
                  onClick={() => setFilter(f.key)}
                  className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                    filter === f.key ? 'bg-slate-800 text-white' : 'text-slate-500 hover:bg-slate-100'
                  }`}
                >
                  {f.label} {counts[f.key] ?? 0}
                </button>
              ))}
            </div>
            <input
              className="w-40 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs text-slate-700 placeholder:text-slate-400 focus:border-[#d97757] focus:outline-none"
              placeholder="搜索名称 / 模型…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <button type="button" onClick={toggleAll} className="text-xs font-medium text-[#b4542f] hover:underline">
              {isAllSelected ? '取消全选' : '全选'}
            </button>
          </div>
        </div>

        {agentsError ? (
          <div className="p-5">
            <ErrorState message={agentsError} onRetry={loadAgents} />
          </div>
        ) : !agents ? (
          <div className="space-y-2 p-5">
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="h-9" />
            ))}
          </div>
        ) : agents.length === 0 ? (
          <div className="p-5">
            <EmptyState title="工作区暂无 Agent" description="请先在 Multica 工作区创建 Agent。" />
          </div>
        ) : (
          <div className="max-h-[340px] overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-slate-50 text-left text-xs text-slate-500">
                <tr className="border-b border-slate-100">
                  <th className="w-10 px-4 py-2">
                    <input type="checkbox" className="accent-[#d97757]" checked={isAllSelected} onChange={toggleAll} />
                  </th>
                  <th className="px-2 py-2 font-medium">Agent</th>
                  <th className="hidden px-2 py-2 font-medium sm:table-cell">模型</th>
                  <th className="px-4 py-2 text-right font-medium">状态</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {filtered.map((a) => {
                  const on = selected.includes(a.id);
                  const st = agentState(a);
                  return (
                    <tr key={a.id} className={`transition-colors ${on ? 'bg-[#d97757]/5' : 'hover:bg-slate-50/60'}`}>
                      <td className="px-4 py-2">
                        <input
                          type="checkbox"
                          className="accent-[#d97757]"
                          checked={on}
                          onChange={() => toggle(a.id)}
                          aria-label={`选择 ${a.name}`}
                        />
                      </td>
                      <td className="px-2 py-2">
                        <div className="flex items-center gap-2">
                          <StatusDot tone={st.key === 'busy' ? 'accent' : st.key === 'online' ? 'ok' : 'muted'} />
                          <span className="font-medium text-slate-800">{a.name}</span>
                        </div>
                      </td>
                      <td className="hidden px-2 py-2 text-xs text-slate-400 sm:table-cell">{a.model || '—'}</td>
                      <td className="px-4 py-2 text-right">
                        <Badge tone={st.tone}>{st.label}</Badge>
                      </td>
                    </tr>
                  );
                })}
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-4 py-8 text-center text-sm text-slate-400">
                      没有符合筛选条件的 Agent
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* 任务表单 */}
      <section className="mt-5 rounded-2xl border border-slate-200/60 bg-white p-5 shadow-sm">
        <div className="grid gap-4 md:grid-cols-[1fr_1fr_auto] md:items-end">
          <Field label="任务标题">
            <input
              className={inputCls}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="例如：调研 MCP 生态发展趋势"
            />
          </Field>
          <Field label="任务背景" hint="可选">
            <input
              className={inputCls}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="任务背景、目标与验收期望…"
            />
          </Field>
          <div className={mode === 'summary' ? 'md:col-span-3' : ''}>
            {mode === 'summary' && (
              <Field label="汇总 Agent（第二个总）" hint="并行全部完成后启动" error={formError === '请选择汇总 Agent' ? formError : null}>
                <select className={inputCls} value={summaryAgent} onChange={(e) => setSummaryAgent(e.target.value)}>
                  <option value="">请选择汇总 Agent…</option>
                  {available
                    .filter((a) => a.online)
                    .map((a) => (
                      <option key={a.id} value={a.name}>
                        {a.name}
                        {a.model ? ` · ${a.model}` : ''}
                      </option>
                    ))}
                </select>
              </Field>
            )}
          </div>
          <div>
            <Button loading={dispatching} disabled={!agents} onClick={handleDispatch} className="w-full md:w-auto">
              {dispatching ? '派发中…' : mode === 'summary' ? '按模板派发' : '一键并行派发'}
            </Button>
          </div>
        </div>
        {formError && <p className="mt-2 text-xs text-rose-600">{formError}</p>}
        {dispatchError && (
          <div className="mt-3 rounded-lg border border-rose-200 bg-rose-50/60 px-3 py-2 text-sm text-rose-700">
            {dispatchError}
          </div>
        )}
      </section>

      {/* 派发结果 */}
      {report && (
        <section className="mt-5 rounded-2xl border border-slate-200/60 bg-white p-5 shadow-sm">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-800">执行结果</h2>
            <div className="flex items-center gap-3">
              <span className="text-xs text-slate-400">
                父 <Badge tone="accent">{report.parent.key || report.parent.id}</Badge>
              </span>
              <button
                type="button"
                onClick={refreshStatus}
                disabled={statusLoading}
                className="inline-flex items-center gap-1.5 text-xs font-medium text-[#b4542f] hover:underline disabled:opacity-50"
              >
                {statusLoading && <Spinner className="h-3.5 w-3.5" />}
                刷新状态
              </button>
              <button
                type="button"
                onClick={() => (window.location.hash = `#/tools/task-monitor`)}
                className="text-xs font-medium text-[#b4542f] hover:underline"
              >
                查看任务进展 →
              </button>
            </div>
          </div>

          <ul className="divide-y divide-slate-100 rounded-xl border border-slate-100">
            {(rows || report.children).map((c, i) => {
              const status = rows ? c.status : 'todo';
              const meta = STATUS_META[status] || { label: status, tone: 'neutral' };
              const name = c.assignee || c.agentName || c.title;
              return (
                <li key={c.key || i} className="flex items-center justify-between gap-3 px-4 py-2">
                  <div className="min-w-0">
                    <div className="truncate text-sm text-slate-700">{name}</div>
                    <div className="text-[11px] text-slate-400">{c.key || c.issueKey || c.issueId}</div>
                  </div>
                  <Badge tone={meta.tone}>{meta.label}</Badge>
                </li>
              );
            })}
          </ul>

          <div className="mt-3 flex justify-end">
            <Button variant="secondary" disabled={statusLoading} onClick={handleAggregate}>
              聚合产出
            </Button>
          </div>
        </section>
      )}
    </div>
  );
}
