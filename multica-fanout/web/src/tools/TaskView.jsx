import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { runTool, runToolWithPath } from '../api.js';
import { Badge, Button, Spinner, StatusDot, EmptyState, ErrorState, Skeleton } from '../components/ui.jsx';

const ISSUE_TONE = {
  done: 'ok',
  in_review: 'warn',
  in_progress: 'accent',
  todo: 'neutral',
  backlog: 'neutral',
  cancelled: 'neutral',
  blocked: 'err',
};
const TASK_TONE = {
  running: 'accent',
  claimed: 'accent',
  dispatched: 'accent',
  completed: 'ok',
  failed: 'err',
  cancelled: 'neutral',
  queued: 'neutral',
};

function fmtTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return `${d.toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' })} ${d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}`;
}

function NodeBox({ x, y, width, children, tone = 'default', onClick, className = '' }) {
  const tones = {
    start: 'border-slate-300 bg-slate-800 text-white',
    agent: 'border-slate-200 bg-white',
    agentBusy: 'border-[#d97757]/40 bg-[#d97757]/5',
    agentDone: 'border-emerald-200 bg-emerald-50/60',
    sink: 'border-slate-300 bg-white',
    summary: 'border-[#d97757]/40 bg-[#fff7f2] shadow-[0_0_0_3px_rgba(217,119,87,0.12)]',
  };
  return (
    <div
      className={`absolute -translate-x-1/2 -translate-y-1/2 rounded-xl border px-3 py-2.5 shadow-sm transition-transform ${
        onClick ? 'cursor-pointer hover:scale-[1.03]' : ''
      } ${tones[tone]} ${className}`}
      style={{ left: `${x}%`, top: `${y}%`, width: `${width}%` }}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? (e) => e.key === 'Enter' && onClick() : undefined}
    >
      {children}
    </div>
  );
}

export default function TaskView() {
  const [tasks, setTasks] = useState(null);
  const [tasksError, setTasksError] = useState(null);
  const [activeId, setActiveId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [detailError, setDetailError] = useState(null);

  const [agentDrawer, setAgentDrawer] = useState(null);
  const [agentLoading, setAgentLoading] = useState(false);
  const [acting, setActing] = useState(false); // 审核/启动汇总进行中

  const loadTasks = useCallback(() => {
    setTasksError(null);
    runTool('task-monitor', 'tasks')
      .then((list) => {
        setTasks(list || []);
        setActiveId((prev) => prev || (list && list[0]?.id) || null);
      })
      .catch((e) => setTasksError(e.message));
  }, []);

  useEffect(loadTasks, [loadTasks]);

  const refreshDetail = useCallback((id) => {
    if (!id) return;
    runToolWithPath('task-monitor', 'task', id)
      .then((d) => {
        setDetail(d);
        setDetailError(null);
      })
      .catch((e) => setDetailError(e.message));
  }, []);

  // 加载/轮询选中任务的详情
  useEffect(() => {
    if (!activeId) {
      setDetail(null);
      return;
    }
    refreshDetail(activeId);
    const timer = setInterval(() => refreshDetail(activeId), 6000);
    return () => clearInterval(timer);
  }, [activeId, refreshDetail]);

  const openAgent = async (agentId, context = null) => {
    if (!agentId) return;
    // context: 当前任务中的子任务 { issueId, issueKey, agentName, status }
    setAgentDrawer({ id: agentId, context });
    setAgentLoading(true);
    try {
      const [d, rv] = await Promise.all([
        runToolWithPath('task-monitor', 'agent', agentId),
        context?.issueId
          ? runToolWithPath('task-monitor', 'review', context.issueId).catch(() => null)
          : Promise.resolve(null),
      ]);
      setAgentDrawer({ id: agentId, context, data: d, review: rv });
    } catch (e) {
      setAgentDrawer({ id: agentId, context, error: e.message });
    } finally {
      setAgentLoading(false);
    }
  };

  const doApprove = async (c) => {
    setActing(true);
    try {
      await runToolWithPath('task-monitor', 'approve', c.id, { comment: '' });
      refreshDetail(activeId);
    } catch (e) {
      setDetailError(`审核失败：${e.message}`);
    } finally {
      setActing(false);
    }
  };

  const doReject = async (c) => {
    const comment = window.prompt(`驳回「${c.agentName}」的产出，请填写修改意见：`, '请补充说明');
    if (comment === null) return;
    setActing(true);
    try {
      await runToolWithPath('task-monitor', 'reject', c.id, { comment });
      refreshDetail(activeId);
    } catch (e) {
      setDetailError(`驳回失败：${e.message}`);
    } finally {
      setActing(false);
    }
  };

  const doStartSummary = async () => {
    setActing(true);
    try {
      await runToolWithPath('task-monitor', 'start-summary', activeId);
      refreshDetail(activeId);
    } catch (e) {
      setDetailError(`启动汇总失败：${e.message}`);
    } finally {
      setActing(false);
    }
  };

  const doActivate = async (c) => {
    setActing(true);
    try {
      await runToolWithPath('task-monitor', 'activate', c.id);
      refreshDetail(activeId);
    } catch (e) {
      setDetailError(`激活失败：${e.message}`);
    } finally {
      setActing(false);
    }
  };

  const doArchiveTask = async (t) => {
    if (!window.confirm(`归档任务「${t.title}」？\n将把该任务所有子 Issue 置为 cancelled（保留记录）。`)) return;
    setActing(true);
    try {
      await runToolWithPath('task-monitor', 'archive', t.id);
      if (activeId === t.id) setActiveId(null);
      loadTasks();
    } catch (e) {
      setDetailError(`归档失败：${e.message}`);
    } finally {
      setActing(false);
    }
  };

  const doDeleteTask = async (t) => {
    if (!window.confirm(`彻底删除任务「${t.title}」？\nMultica 侧不可恢复，将删除父 Issue 与所有子 Issue。`)) return;
    setActing(true);
    try {
      await runToolWithPath('task-monitor', 'delete', t.id);
      if (activeId === t.id) setActiveId(null);
      loadTasks();
    } catch (e) {
      setDetailError(`删除失败：${e.message}`);
    } finally {
      setActing(false);
    }
  };

  const activeTask = useMemo(() => (tasks || []).find((t) => t.id === activeId) || null, [tasks, activeId]);
  const nodeY = (i, n) => (n <= 1 ? 50 : 12 + (i * 76) / (n - 1));

  // 任务过滤：进行中 / 已完成 / 已归档
  const TASK_FILTERS = [
    { key: 'all', label: '全部' },
    { key: 'active', label: '进行中' },
    { key: 'done', label: '已完成' },
    { key: 'archived', label: '已归档' },
  ];
  const [taskFilter, setTaskFilter] = useState('all');
  const filteredTasks = useMemo(() => {
    const list = tasks || [];
    if (taskFilter === 'all') return list;
    return list.filter((t) => {
      const s = t.status;
      if (taskFilter === 'active') return ['todo', 'in_progress', 'in_review', 'backlog'].includes(s);
      if (taskFilter === 'done') return s === 'done';
      if (taskFilter === 'archived') return s === 'cancelled';
      return true;
    });
  }, [tasks, taskFilter]);
  const taskCount = useMemo(() => {
    const c = { all: (tasks || []).length, active: 0, done: 0, archived: 0 };
    for (const t of tasks || []) {
      if (['todo', 'in_progress', 'in_review', 'backlog'].includes(t.status)) c.active += 1;
      else if (t.status === 'done') c.done += 1;
      else if (t.status === 'cancelled') c.archived += 1;
    }
    return c;
  }, [tasks]);

  // 总-分-总 布局计算
  const layout = useMemo(() => {
    if (!detail) return null;
    const all = detail.children || [];
    const workers = all.filter((c) => c.role !== 'summarizer');
    const summarizer = all.find((c) => c.role === 'summarizer') || null;
    const workerDone = workers.length > 0 && workers.every((c) => c.status === 'done');
    const canStartSummary = summarizer && summarizer.status === 'backlog' && workerDone;
    return { workers, summarizer, workerDone, canStartSummary, total: all.length };
  }, [detail]);

  return (
    <div className="mx-auto max-w-[1240px] px-8 py-8">
      <header className="mb-6">
        <div className="flex items-center gap-2">
          <Badge tone="accent">工具 02</Badge>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">任务监控</h1>
        </div>
        <p className="mt-1.5 text-sm leading-relaxed text-slate-500 max-w-[65ch]">
          一次派发 = 一个任务。自由派发：起点 → 多 Agent 并行 → 汇总；「总-分-总」模板在此基础上增加汇总 Agent 节点。点击 Agent 节点查看实时工作，in_review 可直接在本页审核。
        </p>
      </header>

      {/* 任务选择器 */}
      <div className="mb-5">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div className="flex rounded-lg border border-slate-200 bg-white p-0.5">
            {TASK_FILTERS.map((f) => (
              <button
                key={f.key}
                type="button"
                onClick={() => setTaskFilter(f.key)}
                className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                  taskFilter === f.key ? 'bg-slate-800 text-white' : 'text-slate-500 hover:bg-slate-100'
                }`}
              >
                {f.label} {taskCount[f.key] ?? 0}
              </button>
            ))}
          </div>
          <Button variant="secondary" onClick={loadTasks} className="!py-1.5 !px-3 text-xs">
            刷新
          </Button>
        </div>

        <div className="flex min-w-0 gap-2 overflow-x-auto pb-1">
          {tasksError ? (
            <ErrorState message={tasksError} onRetry={loadTasks} />
          ) : !tasks ? (
            <div className="flex gap-2">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-12 w-56" />
              ))}
            </div>
          ) : filteredTasks.length === 0 ? (
            <div className="w-full rounded-xl border border-dashed border-slate-300 py-8 text-center text-sm text-slate-400">
              {taskFilter === 'all' ? '还没有任务，去「插件测试」派发一个吧' : '当前筛选下没有任务'}
            </div>
          ) : (
            filteredTasks.map((t) => {
              const on = t.id === activeId;
              const p = t.progress;
              const archived = t.status === 'cancelled';
              return (
                <div
                  key={t.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => setActiveId(t.id)}
                  onKeyDown={(e) => e.key === 'Enter' && setActiveId(t.id)}
                  className={`group relative shrink-0 cursor-pointer rounded-xl border px-4 py-2.5 pr-9 text-left transition-all ${
                    on ? 'border-[#d97757]/50 bg-[#d97757]/5 ring-1 ring-[#d97757]/25' : 'border-slate-200 bg-white hover:border-slate-300'
                  } ${archived ? 'opacity-60' : ''}`}
                >
                  <div className="max-w-56 truncate text-sm font-medium text-slate-800">
                    {t.title}
                    {archived && <Badge tone="neutral">已归档</Badge>}
                  </div>
                  <div className="mt-1 flex items-center gap-2 text-[11px] text-slate-400">
                    <span>{t.key}</span>
                    {p && (
                      <span className="text-slate-500">
                        <span className="font-semibold text-[#d97757]">{p.done}</span>/{p.total} 完成
                      </span>
                    )}
                  </div>
                  {/* 删除操作 */}
                  <div className="absolute right-1.5 top-1.5 hidden gap-1 group-hover:flex" onClick={(e) => e.stopPropagation()}>
                    {!archived && (
                      <button
                        type="button"
                        title="归档（全部置 cancelled）"
                        onClick={() => doArchiveTask(t)}
                        className="rounded-md bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-500 hover:bg-slate-200"
                      >
                        归档
                      </button>
                    )}
                    <button
                      type="button"
                      title="彻底删除（不可恢复）"
                      onClick={() => doDeleteTask(t)}
                      className="rounded-md bg-rose-50 px-1.5 py-0.5 text-[10px] text-rose-600 hover:bg-rose-100"
                    >
                      删除
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* 进展图 */}
      <div className="relative rounded-2xl border border-slate-200/60 bg-white shadow-sm">
        {detailError && !detail ? (
          <div className="p-8">
            <ErrorState message={detailError} onRetry={() => refreshDetail(activeId)} />
          </div>
        ) : !detail ? (
          <div className="flex h-72 items-center justify-center">
            {activeId ? <Spinner className="h-6 w-6 text-slate-400" /> : <span className="text-sm text-slate-400">请选择一个任务</span>}
          </div>
        ) : (
          <>
            <div className="relative h-[460px]">
              <svg className="absolute inset-0 h-full w-full" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
                <defs>
                  <marker id="arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="5" markerHeight="5" orient="auto">
                    <path d="M0,0 L8,4 L0,8 z" fill="#cbd5e1" />
                  </marker>
                </defs>
                {layout.workers.map((c, i) => {
                  const y = nodeY(i, layout.workers.length);
                  const done = c.status === 'done';
                  const stroke = done ? '#10b981' : '#cbd5e1';
                  return (
                    <g key={c.id}>
                      <path d={`M 18 50 L 34 ${y}`} fill="none" stroke={stroke} strokeWidth="0.7" markerEnd="url(#arrow)" />
                      {layout.summarizer ? (
                        <path d={`M 58 ${y} L 64 50`} fill="none" stroke={stroke} strokeWidth="0.7" markerEnd="url(#arrow)" />
                      ) : (
                        <path d={`M 68 ${y} L 82 50`} fill="none" stroke={stroke} strokeWidth="0.7" markerEnd="url(#arrow)" />
                      )}
                    </g>
                  );
                })}
                {layout.summarizer && (
                  <path d={`M 74 50 L 86 50`} fill="none" stroke={layout.summarizer.status === 'done' ? '#10b981' : '#cbd5e1'} strokeWidth="0.7" markerEnd="url(#arrow)" />
                )}
              </svg>

              {/* 起点 */}
              <NodeBox x={4} y={50} width={13} tone="start">
                <div className="truncate text-[10px] font-medium uppercase tracking-wide text-slate-400">起点</div>
                <div className="mt-0.5 truncate text-xs font-semibold text-white">{detail.parent.key}</div>
                <div className="truncate text-[10px] text-slate-300">{detail.parent.title.replace(/^\[(并行|总分总)\] /, '')}</div>
                {detail.parent.template === 'summary' && <div className="mt-1 text-[10px] text-[#d97757]">总-分-总</div>}
              </NodeBox>

              {/* 并行 worker 节点 */}
              {layout.workers.map((c, i) => {
                const y = nodeY(i, layout.workers.length);
                const busy = c.task && ['running', 'claimed', 'dispatched'].includes(c.task.status);
                const tone = c.status === 'done' ? 'agentDone' : busy ? 'agentBusy' : 'agent';
                return (
                  <NodeBox key={c.id} x={layout.summarizer ? 46 : 51} y={y} width={16} tone={tone} onClick={() => openAgent(c.agentId, { issueId: c.id, issueKey: c.key, agentName: c.agentName, status: c.status })}>
                    <div className="flex items-center gap-1.5">
                      <StatusDot tone={busy ? 'accent' : c.status === 'done' ? 'ok' : c.agentOnline ? 'ok' : 'muted'} />
                      <span className="truncate text-xs font-medium text-slate-800">{c.agentName || '未分配'}</span>
                    </div>
                    <div className="mt-1 flex items-center justify-between">
                      <span className="text-[10px] text-slate-400">{c.key}</span>
                      <Badge tone={ISSUE_TONE[c.status] || 'neutral'}>{c.status}</Badge>
                    </div>
                    {busy && (
                      <div className="mt-1 flex items-center gap-1 text-[10px] text-[#b4542f]">
                        <Spinner className="h-2.5 w-2.5" />
                        执行中…
                      </div>
                    )}
                    {c.status === 'backlog' && (
                      <div className="mt-1.5" onClick={(e) => e.stopPropagation()}>
                        <button
                          type="button"
                          disabled={acting}
                          onClick={() => doActivate(c)}
                          className="rounded-md bg-slate-800 px-2 py-0.5 text-[10px] font-medium text-white hover:bg-slate-700 disabled:opacity-50"
                        >
                          开始执行
                        </button>
                      </div>
                    )}
                    {c.status === 'in_review' && (
                      <div className="mt-1.5 flex gap-1.5" onClick={(e) => e.stopPropagation()}>
                        <button
                          type="button"
                          disabled={acting}
                          onClick={() => doApprove(c)}
                          className="rounded-md bg-emerald-600 px-2 py-0.5 text-[10px] font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
                        >
                          通过
                        </button>
                        <button
                          type="button"
                          disabled={acting}
                          onClick={() => doReject(c)}
                          className="rounded-md bg-white px-2 py-0.5 text-[10px] font-medium text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50 disabled:opacity-50"
                        >
                          驳回
                        </button>
                      </div>
                    )}
                  </NodeBox>
                );
              })}

              {/* 汇总节点（第二个总） */}
              {layout.summarizer && (
                <NodeBox x={69} y={50} width={15} tone="summary" onClick={() => openAgent(layout.summarizer.agentId, { issueId: layout.summarizer.id, issueKey: layout.summarizer.key, agentName: layout.summarizer.agentName, status: layout.summarizer.status })}>
                  <div className="flex items-center gap-1.5">
                    <StatusDot
                      tone={
                        layout.summarizer.status === 'done'
                          ? 'ok'
                          : layout.summarizer.status === 'backlog'
                            ? 'muted'
                            : 'accent'
                      }
                    />
                    <span className="truncate text-xs font-semibold text-slate-800">汇总</span>
                    <Badge tone="accent">总</Badge>
                  </div>
                  <div className="mt-1 truncate text-[10px] text-slate-500">{layout.summarizer.agentName || '未分配'}</div>
                  <div className="mt-1 flex items-center justify-between">
                    <span className="text-[10px] text-slate-400">{layout.summarizer.key}</span>
                    <Badge tone={ISSUE_TONE[layout.summarizer.status] || 'neutral'}>{layout.summarizer.status}</Badge>
                  </div>
                  {layout.summarizer.status === 'in_review' && (
                    <div className="mt-1.5 flex gap-1.5" onClick={(e) => e.stopPropagation()}>
                      <button
                        type="button"
                        disabled={acting}
                        onClick={() => doApprove(layout.summarizer)}
                        className="rounded-md bg-emerald-600 px-2 py-0.5 text-[10px] font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
                      >
                        通过
                      </button>
                      <button
                        type="button"
                        disabled={acting}
                        onClick={() => doReject(layout.summarizer)}
                        className="rounded-md bg-white px-2 py-0.5 text-[10px] font-medium text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50 disabled:opacity-50"
                      >
                        驳回
                      </button>
                    </div>
                  )}
                </NodeBox>
              )}

              {/* 汇点 */}
              <NodeBox x={layout.summarizer ? 91 : 86} y={50} width={layout.summarizer ? 8 : 13} tone="sink" className={layout.summarizer ? 'px-1.5' : ''}>
                <div className="truncate text-center text-[10px] font-medium uppercase tracking-wide text-slate-400">
                  {layout.summarizer ? '报告' : '汇总'}
                </div>
                <div className="mt-0.5 text-center text-xs font-semibold text-slate-800">
                  {detail.counts.done}/{detail.counts.total}
                </div>
              </NodeBox>
            </div>

            {/* 操作条 */}
            <div className="flex flex-wrap items-center gap-3 border-t border-slate-100 px-5 py-3">
              <div className="flex flex-wrap items-center gap-4 text-[11px] text-slate-500">
                <span className="flex items-center gap-1.5"><StatusDot tone="ok" /> 在线 / 完成</span>
                <span className="flex items-center gap-1.5"><StatusDot tone="accent" /> 工作中</span>
                <span className="flex items-center gap-1.5"><StatusDot tone="muted" /> 离线 / 待启动</span>
              </div>
              <div className="ml-auto flex items-center gap-3">
                {layout.canStartSummary && (
                  <Button variant="primary" disabled={acting} onClick={doStartSummary} className="!py-1.5 !px-3 text-xs">
                    {acting ? '启动中…' : '并行完成，启动汇总 Agent'}
                  </Button>
                )}
                <span className="text-[11px] text-slate-400">自动每 6s 刷新 · 点击节点查看实时工作</span>
              </div>
            </div>
          </>
        )}
      </div>

      {/* Agent 实时工作抽屉 */}
      {agentDrawer && (
        <div className="fixed inset-0 z-40" role="dialog" aria-modal="true">
          <div className="absolute inset-0 bg-slate-900/30" onClick={() => setAgentDrawer(null)} />
          <aside className="absolute right-0 top-0 flex h-full w-[440px] max-w-[94vw] flex-col border-l border-slate-200 bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
              <h2 className="text-sm font-semibold text-slate-800">Agent 实时工作</h2>
              <button type="button" onClick={() => setAgentDrawer(null)} className="text-slate-400 hover:text-slate-600" aria-label="关闭">
                <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path strokeLinecap="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="flex-1 overflow-y-auto px-5 py-4">
              {agentLoading && (
                <div className="flex items-center gap-2 py-8 text-sm text-slate-400">
                  <Spinner className="h-4 w-4" /> 加载中…
                </div>
              )}
              {agentDrawer.error && <ErrorState message={agentDrawer.error} />}
              {agentDrawer.data && (
                <AgentDetailPanel
                  data={agentDrawer.data}
                  context={agentDrawer.context}
                  review={agentDrawer.review}
                  acting={acting}
                  onApprove={(ctx) => doApprove({ id: ctx.issueId, agentName: ctx.agentName })}
                  onReject={(ctx) => doReject({ id: ctx.issueId, agentName: ctx.agentName })}
                />
              )}
            </div>
          </aside>
        </div>
      )}
    </div>
  );
}

function AgentDetailPanel({ data, context, review, acting, onApprove, onReject }) {
  const { agent, runtime, online, busy, runningTasks, recentTasks } = data;
  const [review2, setReview] = useState({}); // 最近任务里展开的完整结果 { taskId, data }
  const [reviewLoading, setReviewLoading] = useState(null);

  const loadReview = async (issueId) => {
    setReviewLoading(issueId);
    try {
      const d = await runToolWithPath('task-monitor', 'review', issueId);
      setReview((prev) => ({ ...prev, [issueId]: d }));
    } catch (e) {
      setReview((prev) => ({ ...prev, [issueId]: { error: e.message } }));
    } finally {
      setReviewLoading(null);
    }
  };

  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <StatusDot tone={busy ? 'accent' : online ? 'ok' : 'muted'} />
            <span className="text-base font-semibold text-slate-800">{agent.name}</span>
          </div>
          <Badge tone={busy ? 'accent' : online ? 'ok' : 'neutral'}>{busy ? '工作中' : online ? '在线' : '离线'}</Badge>
        </div>
        <dl className="mt-3 space-y-1.5 text-xs">
          <Row k="模型" v={agent.model || '—'} />
          <Row k="运行环境" v={runtime ? `${runtime.name}（${runtime.status}）` : '未绑定'} />
          <Row k="最近心跳" v={fmtTime(runtime?.lastSeen)} />
          <Row k="并发上限" v={String(agent.max_concurrent_tasks ?? '—')} />
        </dl>
      </div>

      {/* 当前任务中的执行情况（点击节点时上下文） */}
      {context && (
        <InTaskExecution
          context={context}
          review={review}
          acting={acting}
          onApprove={onApprove}
          onReject={onReject}
        />
      )}

      <section>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
          运行中 {runningTasks.length > 0 && <span className="text-[#d97757]">({runningTasks.length})</span>}
        </h3>
        {runningTasks.length === 0 ? (
          <p className="rounded-lg border border-dashed border-slate-200 px-3 py-4 text-center text-xs text-slate-400">当前无运行中任务</p>
        ) : (
          <ul className="space-y-2">
            {runningTasks.map((t) => (
              <li key={t.id} className="rounded-lg border border-[#d97757]/25 bg-[#d97757]/5 p-3">
                <div className="flex items-center justify-between">
                  <Badge tone="accent">{t.status}</Badge>
                  <span className="text-[10px] text-slate-400">开始 {fmtTime(t.startedAt)}</span>
                </div>
                <div className="mt-2 truncate text-[11px] text-slate-500">Issue {t.issueId || '—'}</div>
                {t.workDir && <div className="mt-1 break-all text-[10px] text-slate-400">工作目录 {t.workDir}</div>}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">最近任务</h3>
        {recentTasks.length === 0 ? (
          <p className="text-xs text-slate-400">暂无记录</p>
        ) : (
          <ul className="divide-y divide-slate-100 rounded-xl border border-slate-100">
            {recentTasks.map((t) => {
              const rv = review2?.[t.issueId];
              return (
                <li key={t.id} className="px-3 py-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <Badge tone={TASK_TONE[t.status] || 'neutral'}>{t.status}</Badge>
                    <span className="text-[10px] text-slate-400">
                      {t.completedAt ? `完成 ${fmtTime(t.completedAt)}` : t.startedAt ? `开始 ${fmtTime(t.startedAt)}` : fmtTime(t.createdAt)}
                    </span>
                  </div>
                  {t.error && <div className="mt-1.5 break-all text-[11px] text-rose-600">{String(t.error).slice(0, 160)}</div>}
                  {t.resultPreview && <div className="mt-1.5 line-clamp-2 whitespace-pre-line text-[11px] text-slate-500">{t.resultPreview}</div>}
                  {t.issueId && (
                    <div className="mt-2">
                      <button
                        type="button"
                        onClick={() => loadReview(t.issueId)}
                        className="inline-flex items-center gap-1 text-[11px] font-medium text-[#b4542f] hover:underline"
                      >
                        {reviewLoading === t.issueId ? '加载中…' : rv ? '收起完整结果' : '查看完整结果'}
                      </button>
                      {rv && !rv.error && <ReviewContent data={rv} />}
                      {rv?.error && <p className="mt-1 text-[11px] text-rose-600">{rv.error}</p>}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}

/** 当前任务中的执行情况：子 Issue 状态 + 执行记录 + 完整产出 + 审核 */
function InTaskExecution({ context, review, acting, onApprove, onReject }) {
  const runs = review?.runs || [];
  const issue = review?.issue || null;
  return (
    <section className="rounded-xl border border-[#d97757]/20 bg-[#d97757]/[0.03] p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-600">当前任务中的执行</h3>
        <Badge tone={ISSUE_TONE[context.status] || 'neutral'}>{context.status}</Badge>
      </div>
      <div className="mt-1 text-[11px] text-slate-400">
        {context.issueKey} · {context.agentName}
      </div>

      {!review ? (
        <p className="mt-3 text-xs text-slate-400">加载执行记录…</p>
      ) : runs.length === 0 ? (
        <p className="mt-3 rounded-lg border border-dashed border-slate-200 px-3 py-4 text-center text-xs text-slate-400">
          该子任务尚无执行记录（可能未开始或已排队）
        </p>
      ) : (
        <ul className="mt-3 space-y-2">
          {runs.map((r) => (
            <li key={r.id} className="rounded-lg bg-white p-3 ring-1 ring-slate-100">
              <div className="flex items-center justify-between gap-2">
                <Badge tone={TASK_TONE[r.status] || 'neutral'}>
                  {r.status}
                  {r.attempt > 1 ? ` · 第${r.attempt}次` : ''}
                </Badge>
                <span className="text-[10px] text-slate-400">
                  {r.completedAt ? `完成 ${fmtTime(r.completedAt)}` : r.startedAt ? `开始 ${fmtTime(r.startedAt)}` : fmtTime(r.createdAt)}
                </span>
              </div>
              {r.error && <div className="mt-2 break-all text-[11px] text-rose-600">{String(r.error).slice(0, 200)}</div>}
              {r.resultOutput ? (
                <pre className="mt-2 max-h-52 overflow-y-auto whitespace-pre-wrap break-words text-[11px] leading-relaxed text-slate-700">
                  {r.resultOutput}
                </pre>
              ) : (
                r.resultPreview && (
                  <div className="mt-2 whitespace-pre-line text-[11px] text-slate-500">{r.resultPreview}</div>
                )
              )}
            </li>
          ))}
        </ul>
      )}

      {/* 评论（Agent 回贴的产出） */}
      {review?.comments?.length > 0 && (
        <div className="mt-3 space-y-1.5">
          {review.comments.map((c, i) => (
            <div key={c.id || i} className="rounded-md bg-white px-2.5 py-2 text-[11px] text-slate-600 ring-1 ring-slate-100">
              {String(c.content || '').slice(0, 600)}
            </div>
          ))}
        </div>
      )}

      {/* 审核操作（in_review 时） */}
      {context.status === 'in_review' && (
        <div className="mt-3 flex gap-2">
          <button
            type="button"
            disabled={acting}
            onClick={() => onApprove(context)}
            className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
          >
            审核通过
          </button>
          <button
            type="button"
            disabled={acting}
            onClick={() => onReject(context)}
            className="rounded-lg bg-white px-3 py-1.5 text-xs font-medium text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50 disabled:opacity-50"
          >
            驳回
          </button>
        </div>
      )}
    </section>
  );
}

function ReviewContent({ data }) {
  const latest = data.latest;
  return (
    <div className="mt-2 rounded-lg border border-slate-100 bg-slate-50/60 p-3">
      {latest?.resultOutput && (
        <pre className="max-h-64 overflow-y-auto whitespace-pre-wrap break-words text-[11px] leading-relaxed text-slate-700">
          {latest.resultOutput}
        </pre>
      )}
      {data.comments?.length > 0 && (
        <div className="mt-2 space-y-1.5">
          {data.comments.map((c, i) => (
            <div key={c.id || i} className="rounded-md bg-white px-2 py-1.5 text-[11px] text-slate-600 ring-1 ring-slate-100">
              {String(c.content || '').slice(0, 500)}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Row({ k, v }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-slate-400">{k}</dt>
      <dd className="truncate text-slate-700">{v}</dd>
    </div>
  );
}
