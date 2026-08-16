import React from 'react';
import { StatusDot } from './ui.jsx';

/** 侧边栏：品牌 + 工具菜单（支持二级）+ 连接状态 */
export default function Sidebar({ tools, activeToolId, onSelect, health, healthLoading }) {
  // 一级工具（无 parent）；有子工具的作为分组头
  const topTools = tools.filter((t) => !t.parent);
  const childrenByParent = new Map();
  for (const t of tools) {
    if (t.parent) {
      const list = childrenByParent.get(t.parent) || [];
      list.push(t);
      childrenByParent.set(t.parent, list);
    }
  }

  return (
    <aside className="flex h-[100dvh] w-60 shrink-0 flex-col border-r border-white/5 bg-[#141413] text-slate-300">
      {/* 品牌 */}
      <div className="flex items-center gap-2.5 px-5 pb-5 pt-6">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#d97757] text-white">
          <svg className="h-4.5 w-4.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path strokeLinecap="round" strokeLinejoin="round" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
          </svg>
        </div>
        <div className="leading-tight">
          <div className="text-sm font-semibold tracking-tight text-white">VectorDev</div>
          <div className="text-[11px] text-slate-500">Agent 控制台</div>
        </div>
      </div>

      {/* 工具菜单 */}
      <nav className="flex-1 overflow-y-auto px-3" aria-label="工具菜单">
        <div className="mb-2 px-2 text-[11px] font-medium uppercase tracking-wider text-slate-500">工具</div>
        <ul className="space-y-1">
          {tools.length === 0 && <li className="px-2 py-2 text-xs text-slate-500">加载中…</li>}
          {topTools.map((tool) => {
            const children = childrenByParent.get(tool.id) || [];
            if (children.length === 0) {
              const active = tool.id === activeToolId;
              return (
                <li key={tool.id}>
                  <MenuItem tool={tool} active={active} onClick={() => onSelect(tool.id)} />
                </li>
              );
            }
            // 分组：自身 + 子工具
            const groupActive = tool.id === activeToolId || children.some((c) => c.id === activeToolId);
            return (
              <li key={tool.id} className="mb-1">
                <button
                  type="button"
                  onClick={() => onSelect(tool.id)}
                  className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm transition-colors duration-150 ${
                    groupActive ? 'bg-white/10 text-white' : 'text-slate-400 hover:bg-white/5 hover:text-slate-200'
                  }`}
                >
                  <ToolIcon id={tool.id} active={groupActive} />
                  <span className="truncate">{tool.name}</span>
                  <Chevron open={groupActive} />
                </button>
                {groupActive && (
                  <ul className="mt-0.5 space-y-0.5 pl-4">
                    <li>
                      <SubItem label={tool.name} active={tool.id === activeToolId} onClick={() => onSelect(tool.id)} />
                    </li>
                    {children.map((c) => (
                      <li key={c.id}>
                        <SubItem label={c.name} active={c.id === activeToolId} onClick={() => onSelect(c.id)} />
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>

        <div className="mt-6 px-2 text-[11px] font-medium uppercase tracking-wider text-slate-500">工作区</div>
        <div className="mt-1 rounded-lg border border-white/5 bg-white/[0.03] px-3 py-2.5">
          <div className="text-xs text-slate-300">开放能力</div>
          <div className="mt-0.5 text-[11px] text-slate-500">vector</div>
        </div>
      </nav>

      {/* 底部连接状态 */}
      <div className="border-t border-white/5 px-5 py-4">
        <div className="flex items-center gap-2">
          <StatusDot tone={health?.ok ? 'ok' : healthLoading ? 'muted' : 'err'} />
          <span className="text-xs font-medium text-slate-300">
            {healthLoading ? '连接中…' : health?.ok ? '已连接 Multica' : '未连接'}
          </span>
        </div>
        <div className="mt-1 truncate text-[11px] text-slate-500">
          {health?.ok ? 'multica.clouddeveloper.club' : health?.error || '—'}
        </div>
      </div>
    </aside>
  );
}

function MenuItem({ tool, active, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm transition-colors duration-150 ${
        active ? 'bg-white/10 text-white' : 'text-slate-400 hover:bg-white/5 hover:text-slate-200'
      }`}
    >
      <ToolIcon id={tool.id} active={active} />
      <span className="truncate">{tool.name}</span>
    </button>
  );
}

function SubItem({ label, active, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      className={`flex w-full items-center gap-2 rounded-md px-3 py-1.5 text-left text-[13px] transition-colors duration-150 ${
        active ? 'bg-[#d97757]/15 text-[#f0a184]' : 'text-slate-400 hover:bg-white/5 hover:text-slate-200'
      }`}
    >
      <span className="h-1 w-1 shrink-0 rounded-full bg-current opacity-60" />
      <span className="truncate">{label}</span>
    </button>
  );
}

function Chevron({ open }) {
  return (
    <svg
      className={`ml-auto h-3.5 w-3.5 shrink-0 transition-transform duration-150 ${open ? 'rotate-90' : ''}`}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      aria-hidden="true"
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
    </svg>
  );
}

function ToolIcon({ id, active }) {
  const cls = active ? 'text-[#d97757]' : 'text-slate-500';
  const icons = {
    'plugin-test': (
      <path strokeLinecap="round" strokeLinejoin="round" d="M4 5a1 1 0 011-1h14a1 1 0 011 1v3a1 1 0 01-1 1H5a1 1 0 01-1-1V5zm0 7a1 1 0 011-1h6a1 1 0 011 1v7a1 1 0 01-1 1H5a1 1 0 01-1-1v-7zm10 0a1 1 0 011-1h4a1 1 0 011 1v3a1 1 0 01-1 1h-4a1 1 0 01-1-1v-3zm0 6a1 1 0 011-1h4a1 1 0 011 1v1a1 1 0 01-1 1h-4a1 1 0 01-1-1v-1z" />
    ),
    'task-monitor': (
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 17v-6m3 6v-9m3 9V8M4 5h16a1 1 0 011 1v13a1 1 0 01-1 1H4a1 1 0 01-1-1V6a1 1 0 011-1z" />
    ),
  };
  return (
    <svg className={`h-4 w-4 shrink-0 ${cls}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      {icons[id] || <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6m0 0v6m0-6h6m-6 0H6" />}
    </svg>
  );
}
