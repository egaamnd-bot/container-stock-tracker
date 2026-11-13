import { useEffect, type ReactNode, type ButtonHTMLAttributes } from 'react';
import { X, Cloud, CloudOff, RefreshCw, AlertTriangle, HardDrive, CheckCircle2 } from 'lucide-react';
import type { SyncState } from '../lib/types';
import { timeAgo } from '../lib/format';

type Variant = 'primary' | 'secondary' | 'danger' | 'ghost' | 'success';
const VARIANTS: Record<Variant, string> = {
  primary: 'bg-brand-600 text-white hover:bg-brand-700 active:bg-brand-700 disabled:bg-brand-600/50',
  secondary: 'bg-white text-slate-800 border border-slate-300 hover:bg-slate-50 dark:bg-slate-800 dark:text-slate-100 dark:border-slate-600 dark:hover:bg-slate-700',
  danger: 'bg-red-600 text-white hover:bg-red-700 disabled:bg-red-600/50',
  success: 'bg-green-600 text-white hover:bg-green-700',
  ghost: 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800',
};

export function Button({ variant = 'primary', className = '', children, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return (
    <button
      {...rest}
      className={`inline-flex items-center justify-center gap-2 rounded-xl px-4 min-h-[48px] font-semibold text-[15px] transition-colors disabled:cursor-not-allowed disabled:opacity-60 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 ${VARIANTS[variant]} ${className}`}
    >
      {children}
    </button>
  );
}

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-2xl bg-white border border-slate-200 shadow-sm dark:bg-slate-900 dark:border-slate-800 ${className}`}>{children}</div>;
}

export function PageHeader({ title, right }: { title: string; right?: ReactNode }) {
  return (
    <header className="sticky top-0 z-20 bg-slate-50/95 dark:bg-slate-950/95 backdrop-blur border-b border-slate-200 dark:border-slate-800 px-4 pt-[max(env(safe-area-inset-top),12px)] pb-3 flex items-center justify-between gap-3">
      <h1 className="text-xl font-bold text-slate-900 dark:text-white">{title}</h1>
      {right}
    </header>
  );
}

const SYNC_META: Record<SyncState, { label: string; cls: string; Icon: typeof Cloud }> = {
  'local-only': { label: 'Local only', cls: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300', Icon: HardDrive },
  synced: { label: 'Online · synced', cls: 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300', Icon: CheckCircle2 },
  syncing: { label: 'Syncing…', cls: 'bg-brand-100 text-brand-700 dark:bg-brand-700/30 dark:text-brand-100', Icon: RefreshCw },
  'sync-required': { label: 'Sync required', cls: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300', Icon: RefreshCw },
  'sync-failed': { label: 'Sync failed', cls: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300', Icon: AlertTriangle },
  offline: { label: 'Offline', cls: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300', Icon: CloudOff },
};

export function SyncBadge({ state, lastSyncAt, onClick }: { state: SyncState; lastSyncAt?: string | null; onClick?: () => void }) {
  const m = SYNC_META[state];
  return (
    <button
      type="button"
      onClick={onClick}
      data-testid="sync-badge"
      data-state={state}
      className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold ${m.cls}`}
      title={lastSyncAt ? `Last sync ${timeAgo(lastSyncAt)}` : undefined}
    >
      <m.Icon size={14} className={state === 'syncing' ? 'animate-spin' : ''} />
      {m.label}
    </button>
  );
}

export function Sheet({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', k);
      document.body.style.overflow = '';
    };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center" role="dialog" aria-modal="true" aria-label={title}>
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative w-full sm:max-w-lg max-h-[92vh] overflow-y-auto rounded-t-3xl sm:rounded-3xl bg-white dark:bg-slate-900 p-5 pb-[max(env(safe-area-inset-bottom),20px)] shadow-2xl">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold text-slate-900 dark:text-white">{title}</h2>
          <button onClick={onClose} aria-label="Close" className="p-2 -m-2 rounded-full text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800">
            <X size={22} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Stat({ label, value, sub, tone = 'default' }: { label: string; value: ReactNode; sub?: ReactNode; tone?: 'default' | 'green' | 'red' | 'amber' | 'blue' }) {
  const toneCls = { default: 'text-slate-900 dark:text-white', green: 'text-green-700 dark:text-green-400', red: 'text-red-600 dark:text-red-400', amber: 'text-amber-700 dark:text-amber-400', blue: 'text-brand-700 dark:text-brand-100' }[tone];
  return (
    <div className="rounded-xl bg-slate-50 dark:bg-slate-800/60 px-3 py-2.5">
      <div className="text-xs font-medium text-slate-500 dark:text-slate-400">{label}</div>
      <div className={`text-xl font-bold tabular-nums ${toneCls}`}>{value}</div>
      {sub && <div className="text-xs text-slate-500 dark:text-slate-400">{sub}</div>}
    </div>
  );
}

export function BarList({ data, total, max = 10 }: { data: [string, number][]; total: number; max?: number }) {
  const shown = data.slice(0, max);
  const rest = data.slice(max).reduce((a, [, v]) => a + v, 0);
  const top = Math.max(1, ...shown.map(([, v]) => v));
  return (
    <ul className="space-y-2">
      {shown.map(([k, v]) => (
        <li key={k} className="text-sm">
          <div className="flex justify-between mb-1">
            <span className="font-semibold text-slate-800 dark:text-slate-100">{k || '—'}</span>
            <span className="tabular-nums text-slate-600 dark:text-slate-300">
              {v.toLocaleString('en-US')} <span className="text-slate-400">· {total ? ((v / total) * 100).toFixed(1) : 0}%</span>
            </span>
          </div>
          <div className="h-2 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
            <div className="h-full rounded-full bg-brand-500" style={{ width: `${(v / top) * 100}%` }} />
          </div>
        </li>
      ))}
      {rest > 0 && <li className="text-xs text-slate-500">+ {data.length - max} more ({rest.toLocaleString('en-US')})</li>}
    </ul>
  );
}

export function Empty({ icon, title, children }: { icon: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="text-center py-10 px-6 text-slate-500 dark:text-slate-400">
      <div className="mx-auto mb-3 w-12 h-12 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center">{icon}</div>
      <p className="font-semibold text-slate-700 dark:text-slate-200">{title}</p>
      {children && <div className="mt-1 text-sm">{children}</div>}
    </div>
  );
}

export const inputCls =
  'w-full rounded-xl border border-slate-300 bg-white px-3 min-h-[48px] text-base text-slate-900 placeholder:text-slate-400 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30 dark:bg-slate-800 dark:border-slate-600 dark:text-white';
export const selectCls = inputCls + ' pr-8';
