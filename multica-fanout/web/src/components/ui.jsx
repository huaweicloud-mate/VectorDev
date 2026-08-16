import React from 'react';

/** 状态点（呼吸动画，用于连接/运行指示） */
export function StatusDot({ tone = 'muted', className = '' }) {
  const colors = {
    ok: 'bg-emerald-500',
    warn: 'bg-amber-500',
    err: 'bg-rose-500',
    muted: 'bg-slate-400',
    accent: 'bg-[#d97757]',
  };
  return (
    <span className={`relative inline-flex h-2 w-2 ${className}`} aria-hidden="true">
      <span
        className={`absolute inline-flex h-full w-full animate-ping rounded-full ${colors[tone]} opacity-60`}
      />
      <span className={`relative inline-flex h-2 w-2 rounded-full ${colors[tone]}`} />
    </span>
  );
}

/** 徽标 */
export function Badge({ children, tone = 'neutral' }) {
  const tones = {
    neutral: 'bg-slate-100 text-slate-600 border-slate-200',
    accent: 'bg-[#d97757]/10 text-[#b4542f] border-[#d97757]/25',
    ok: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    warn: 'bg-amber-50 text-amber-700 border-amber-200',
    err: 'bg-rose-50 text-rose-700 border-rose-200',
  };
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${tones[tone]}`}
    >
      {children}
    </span>
  );
}

/** 按钮 */
export function Button({ children, variant = 'primary', loading = false, disabled = false, onClick, className = '', type = 'button' }) {
  const base =
    'inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors duration-150 disabled:opacity-50 disabled:pointer-events-none';
  const variants = {
    primary: 'bg-[#d97757] text-white hover:bg-[#c56540]',
    secondary: 'bg-white text-slate-700 border border-slate-200 hover:bg-slate-50',
    ghost: 'text-slate-500 hover:bg-slate-100 hover:text-slate-700',
  };
  return (
    <button type={type} className={`${base} ${variants[variant]} ${className}`} disabled={disabled || loading} onClick={onClick}>
      {loading && <Spinner className="h-4 w-4" />}
      {children}
    </button>
  );
}

/** 加载指示 */
export function Spinner({ className = 'h-5 w-5' }) {
  return (
    <svg className={`animate-spin ${className}`} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
    </svg>
  );
}

/** 表单字段：label 在上，error 在下 */
export function Field({ label, hint, error, children }) {
  return (
    <label className="block">
      <span className="mb-1.5 flex items-baseline gap-2 text-sm font-medium text-slate-700">
        {label}
        {hint && <span className="text-xs font-normal text-slate-400">{hint}</span>}
      </span>
      {children}
      {error && <span className="mt-1 block text-xs text-rose-600">{error}</span>}
    </label>
  );
}

export const inputCls =
  'w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 placeholder:text-slate-400 focus:border-[#d97757] focus:outline-none focus:ring-2 focus:ring-[#d97757]/20 transition-colors';

/** 空状态 */
export function EmptyState({ title, description }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-slate-300 py-14 text-center">
      <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-xl bg-slate-100 text-slate-400">
        <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
          <path strokeLinecap="round" strokeLinejoin="round" d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4" />
        </svg>
      </div>
      <p className="text-sm font-medium text-slate-700">{title}</p>
      {description && <p className="mt-1 max-w-[36ch] text-xs text-slate-500">{description}</p>}
    </div>
  );
}

/** 错误状态 */
export function ErrorState({ message, onRetry }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-rose-200 bg-rose-50/50 py-12 text-center">
      <p className="text-sm font-medium text-rose-700">加载失败</p>
      <p className="mt-1 max-w-[50ch] break-all text-xs text-rose-600/80">{message}</p>
      {onRetry && (
        <Button variant="secondary" className="mt-4" onClick={onRetry}>
          重试
        </Button>
      )}
    </div>
  );
}

/** 加载骨架 */
export function Skeleton({ className = '' }) {
  return <div className={`animate-pulse rounded-lg bg-slate-200/70 ${className}`} />;
}
