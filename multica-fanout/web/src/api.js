/**
 * API 客户端：统一调用 CLI 集成基座（/api/cli/*）
 */

async function request(url, options = {}) {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  let data = null;
  try {
    data = await res.json();
  } catch {
    /* 非 JSON 响应 */
  }
  if (!res.ok) {
    throw new Error(data?.error || `请求失败（${res.status}）：${url}`);
  }
  return data;
}

/** 列出全部工具（侧边栏菜单数据源） */
export function listTools() {
  return request('/api/cli/tools').then((d) => d.tools);
}

/** 执行工具 action（统一入口） */
export function runTool(toolId, action, params = {}) {
  return request(`/api/cli/tools/${toolId}/${action}/run`, {
    method: 'POST',
    body: JSON.stringify({ action, params }),
  }).then((d) => d.data);
}

/** 工具 action 带路径参数（如 status/:parentId） */
export function runToolWithPath(toolId, action, pathParam, params = {}) {
  return request(`/api/cli/tools/${toolId}/${action}/${encodeURIComponent(pathParam)}`, {
    method: 'POST',
    body: JSON.stringify(params),
  }).then((d) => d.data);
}

/** 健康检查 */
export function health() {
  return request('/api/health');
}
