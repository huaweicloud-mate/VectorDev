import React, { useEffect, useState, useCallback } from 'react';
import Sidebar from './components/Sidebar.jsx';
import PluginTest from './tools/PluginTest.jsx';
import { listTools, health } from './api.js';

/** 工具 ID → 页面组件映射（未来新增工具在此登记） */
const TOOL_VIEWS = {
  'plugin-test': PluginTest,
};

function parseHash() {
  const m = window.location.hash.match(/^#\/tools\/([^/?]+)/);
  return m ? m[1] : null;
}

export default function App() {
  const [tools, setTools] = useState([]);
  const [healthInfo, setHealthInfo] = useState(null);
  const [healthLoading, setHealthLoading] = useState(true);
  const [activeTool, setActiveTool] = useState(null);

  // 加载工具菜单 + 健康状态
  useEffect(() => {
    let alive = true;
    Promise.all([listTools(), health()])
      .then(([t, h]) => {
        if (!alive) return;
        setTools(t);
        setHealthInfo(h);
        setHealthLoading(false);
        // 默认选中第一个工具（或 hash 指定）
        const fromHash = parseHash();
        const initial = t.find((x) => x.id === fromHash) || t[0] || null;
        setActiveTool(initial?.id || null);
        if (initial && fromHash !== initial.id) {
          window.location.hash = `#/tools/${initial.id}`;
        }
      })
      .catch((e) => {
        if (!alive) return;
        setHealthInfo({ ok: false, error: e.message });
        setHealthLoading(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  // hash 变化 → 切换工具
  const onHashChange = useCallback(() => {
    setActiveTool(parseHash());
  }, []);
  useEffect(() => {
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, [onHashChange]);

  const selectTool = (id) => {
    window.location.hash = `#/tools/${id}`;
    setActiveTool(id);
  };

  const ToolView = activeTool ? TOOL_VIEWS[activeTool] : null;

  return (
    <div className="flex min-h-[100dvh] bg-[#faf9f5]">
      <Sidebar
        tools={tools}
        activeToolId={activeTool}
        onSelect={selectTool}
        health={healthInfo}
        healthLoading={healthLoading}
      />

      <main className="min-w-0 flex-1 overflow-y-auto">
        {ToolView ? (
          <ToolView />
        ) : (
          <div className="flex h-[100dvh] items-center justify-center text-sm text-slate-400">
            请从左侧选择工具
          </div>
        )}
      </main>
    </div>
  );
}
