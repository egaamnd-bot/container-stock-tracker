import { useEffect, useMemo, useRef, useState } from 'react';
import { Search, X, ClipboardPaste, History, SearchX, Plus } from 'lucide-react';
import { useStore, useStoreState } from '../state/StoreContext';
import { searchContainer, type SearchOutcome } from '../lib/search';
import { normalizeContainerNumber } from '../lib/normalize';
import { formatDateTime, n, timeAgo } from '../lib/format';
import { loadRecent, pushRecent, clearRecent, type RecentSearch } from '../state/ui';
import { Button, Card, SyncBadge } from '../components/ui';
import { ResultCard } from '../components/ResultCard';
import { ContainerSheet } from '../components/ContainerSheet';
import { Logo } from '../components/Logo';
import type { ContainerRecord } from '../lib/types';

export function SearchScreen({ onOpenSettings }: { onOpenSettings: () => void }) {
  const store = useStore();
  const state = useStoreState();
  const [q, setQ] = useState('');
  const [outcome, setOutcome] = useState<SearchOutcome>({ kind: 'empty' });
  const [recent, setRecent] = useState<RecentSearch[]>(loadRecent);
  const [editing, setEditing] = useState<ContainerRecord | null>(null);
  const [adding, setAdding] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const stale = state.mode === 'cloud' && state.sync !== 'synced' && state.sync !== 'syncing';

  const run = (raw: string, record = true) => {
    const o = searchContainer(store.index, raw);
    setOutcome(o);
    if (record && o.kind !== 'empty') setRecent(pushRecent(o.kind === 'found' ? o.record.container_no : o.query, o.kind === 'found'));
    return o;
  };

  // Live search: as soon as an 11-character number is typed/pasted, look it up.
  const onChange = (v: string) => {
    setQ(v);
    const norm = normalizeContainerNumber(v);
    if (norm.length >= 11) {
      const o = run(v, false);
      if (o.kind === 'found') setRecent(pushRecent(o.record.container_no, true));
    }
    else if (outcome.kind !== 'empty') setOutcome({ kind: 'empty' });
  };

  // Re-evaluate the displayed result when the inventory changes (sync/edit).
  useEffect(() => {
    if (outcome.kind === 'empty') return;
    setOutcome(searchContainer(store.index, outcome.kind === 'found' ? outcome.record.container_no : q));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.rev]);

  const paste = async () => {
    try {
      const t = await navigator.clipboard.readText();
      setQ(t.trim());
      run(t, true);
    } catch {
      inputRef.current?.focus();
    }
  };
  const clear = () => {
    setQ('');
    setOutcome({ kind: 'empty' });
    inputRef.current?.focus();
  };

  const asOf = state.mode === 'cloud' ? state.lastSyncAt : state.lastImport?.created_at ?? null;
  const freshness = useMemo(() => (state.mode === 'cloud' ? `Synced ${timeAgo(state.lastSyncAt)}` : state.lastImport ? `Imported ${timeAgo(state.lastImport.created_at)}` : 'No import yet'), [state]);

  return (
    <div className="pb-6">
      <header className="px-4 pt-[max(env(safe-area-inset-top),16px)] pb-2 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <Logo className="w-9 h-9" />
          <div>
            <div className="text-lg font-bold leading-tight text-slate-900 dark:text-white">Container Stock Tracker</div>
            <div className="text-xs text-slate-500 dark:text-slate-400">{freshness}</div>
          </div>
        </div>
        <SyncBadge state={state.sync} lastSyncAt={state.lastSyncAt} onClick={onOpenSettings} />
      </header>

      <form
        className="px-4 pt-2"
        onSubmit={(e) => {
          e.preventDefault();
          run(q);
          inputRef.current?.blur();
        }}
      >
        <div className="relative">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={22} />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => onChange(e.target.value)}
            onPaste={(e) => {
              const t = e.clipboardData.getData('text');
              if (t) {
                e.preventDefault();
                setQ(t.trim());
                run(t, true);
              }
            }}
            placeholder="Container no. e.g. AXIU 149 845 0"
            aria-label="Container number"
            data-testid="search-input"
            className="w-full h-16 rounded-2xl border-2 border-slate-300 bg-white pl-12 pr-12 font-mono text-xl tracking-wide uppercase text-slate-900 placeholder:normal-case placeholder:font-sans placeholder:text-base placeholder:tracking-normal placeholder:text-slate-400 focus:border-brand-500 focus:outline-none focus:ring-4 focus:ring-brand-500/20 dark:bg-slate-900 dark:border-slate-700 dark:text-white"
            autoCapitalize="characters"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            enterKeyHint="search"
            inputMode="text"
          />
          {q && (
            <button type="button" onClick={clear} aria-label="Clear" data-testid="clear-btn" className="absolute right-2 top-1/2 -translate-y-1/2 p-3 rounded-full text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800">
              <X size={22} />
            </button>
          )}
        </div>
        <div className="grid grid-cols-[1fr_auto] gap-2 mt-3">
          <Button type="submit" className="h-14 text-base" data-testid="search-btn">
            <Search size={20} /> Search
          </Button>
          <Button type="button" variant="secondary" className="h-14 px-5" onClick={paste} aria-label="Paste and search">
            <ClipboardPaste size={20} /> Paste
          </Button>
        </div>
      </form>

      <div className="px-4 mt-4 space-y-4">
        {outcome.kind === 'found' && (
          <ResultCard record={outcome.record} asOf={asOf} stale={stale} via={outcome.via} onEdit={store.canEdit() ? () => setEditing(outcome.record) : undefined} />
        )}

        {outcome.kind === 'not-found' && (
          <Card className="border-red-200 dark:border-red-900 overflow-hidden">
            <div className="p-4 flex gap-3" data-testid="not-found">
              <SearchX className="text-red-500 shrink-0" size={28} />
              <div>
                <p className="font-bold text-red-700 dark:text-red-400">Container not found in current inventory.</p>
                <p className="text-sm text-slate-600 dark:text-slate-300 mt-1">
                  Searched for <span className="font-mono font-semibold">{outcome.query}</span>
                  {asOf && <> · inventory as of {formatDateTime(asOf)}</>}
                </p>
                {stale && <p className="text-xs text-amber-700 dark:text-amber-400 mt-1">You are viewing an offline copy — it may have arrived after your last sync.</p>}
              </div>
            </div>
            {outcome.suggestions.length > 0 && (
              <div className="border-t border-slate-100 dark:border-slate-800 p-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-2">Similar numbers — not exact matches</p>
                <div className="flex flex-wrap gap-2">
                  {outcome.suggestions.map((s) => (
                    <button key={s.container_no} onClick={() => { setQ(s.container_no); run(s.container_no); }} className="font-mono text-sm rounded-lg border border-slate-300 dark:border-slate-700 px-3 py-2 hover:bg-slate-50 dark:hover:bg-slate-800">
                      {s.container_no}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {store.canEdit() && /^[A-Z]{4}\d{7}$/.test(outcome.query) && (
              <div className="border-t border-slate-100 dark:border-slate-800 p-2">
                <Button variant="ghost" className="w-full" onClick={() => setAdding(outcome.query)}>
                  <Plus size={18} /> Add {outcome.query} to inventory
                </Button>
              </div>
            )}
          </Card>
        )}

        <div className="grid grid-cols-2 gap-3">
          <Card className="p-4">
            <div className="text-xs font-medium text-slate-500 dark:text-slate-400">Total inventory</div>
            <div className="text-2xl font-bold tabular-nums text-slate-900 dark:text-white" data-testid="total-count">{n(state.count)}</div>
          </Card>
          <Card className="p-4">
            <div className="text-xs font-medium text-slate-500 dark:text-slate-400">{state.mode === 'cloud' ? 'Last sync' : 'Last import'}</div>
            <div className="text-sm font-semibold text-slate-900 dark:text-white mt-1">{formatDateTime(asOf)}</div>
          </Card>
        </div>

        {state.count === 0 && state.ready && (
          <Card className="p-4 text-sm text-slate-600 dark:text-slate-300">
            The inventory is empty. Go to <b>Import</b> and upload your stock Excel file to get started.
          </Card>
        )}

        {recent.length > 0 && (
          <section>
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-sm font-semibold text-slate-600 dark:text-slate-300 flex items-center gap-1.5"><History size={16} /> Recent searches</h2>
              <button className="text-xs text-slate-500 underline" onClick={() => { clearRecent(); setRecent([]); }}>Clear</button>
            </div>
            <div className="flex flex-wrap gap-2">
              {recent.map((r) => (
                <button
                  key={r.no}
                  onClick={() => { setQ(r.no); run(r.no); }}
                  className={`font-mono text-sm rounded-full px-3 py-2 border ${r.found ? 'border-slate-300 bg-white dark:bg-slate-900 dark:border-slate-700' : 'border-red-200 bg-red-50 text-red-700 dark:bg-red-950/30 dark:border-red-900 dark:text-red-400'}`}
                >
                  {r.no}
                </button>
              ))}
            </div>
          </section>
        )}
      </div>

      <ContainerSheet open={!!editing} record={editing} onClose={() => setEditing(null)} />
      <ContainerSheet open={adding !== null} record={null} initialNo={adding ?? ''} onClose={() => { setAdding(null); if (q) run(q, false); }} />
    </div>
  );
}
