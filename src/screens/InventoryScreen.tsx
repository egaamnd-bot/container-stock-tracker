import { useEffect, useMemo, useRef, useState } from 'react';
import { Plus, SlidersHorizontal, Search, Boxes, X } from 'lucide-react';
import { useStore, useStoreState } from '../state/StoreContext';
import { filterInventory, countBy, type InventoryFilter, type SortKey } from '../lib/search';
import { FIELD_KEYS, FIELD_LABELS, type ContainerRecord } from '../lib/types';
import { n } from '../lib/format';
import { Button, Card, PageHeader, Empty, inputCls, selectCls } from '../components/ui';
import { ContainerSheet } from '../components/ContainerSheet';
import { ResultCard } from '../components/ResultCard';
import { Sheet } from '../components/ui';

const EMPTY: InventoryFilter = { text: '', shipping_line: '', type: '', grade: '', size: '', condition: '' };
const PAGE = 60;

export function InventoryScreen() {
  const store = useStore();
  const state = useStoreState();
  const [f, setF] = useState<InventoryFilter>(EMPTY);
  const [sort, setSort] = useState<SortKey>('container_no');
  const [dir, setDir] = useState<'asc' | 'desc'>('asc');
  const [limit, setLimit] = useState(PAGE);
  const [showFilters, setShowFilters] = useState(false);
  const [viewing, setViewing] = useState<ContainerRecord | null>(null);
  const [editing, setEditing] = useState<ContainerRecord | null>(null);
  const [adding, setAdding] = useState(false);
  const sentinel = useRef<HTMLDivElement>(null);

  const all = useMemo(() => store.records(), [store, state.rev]);
  const options = useMemo(() => Object.fromEntries(FIELD_KEYS.map((k) => [k, countBy(all, k)])) as Record<(typeof FIELD_KEYS)[number], [string, number][]>, [all]);
  const rows = useMemo(() => filterInventory(all, f, sort, dir), [all, f, sort, dir]);
  const activeFilters = FIELD_KEYS.filter((k) => f[k]).length;

  useEffect(() => setLimit(PAGE), [f, sort, dir]);
  useEffect(() => {
    const el = sentinel.current;
    if (!el) return;
    const io = new IntersectionObserver((e) => e[0].isIntersecting && setLimit((l) => l + PAGE), { rootMargin: '400px' });
    io.observe(el);
    return () => io.disconnect();
  }, [rows.length]);

  return (
    <div className="pb-24">
      <PageHeader
        title="Inventory"
        right={<span className="text-sm text-slate-500 tabular-nums" data-testid="inv-count">{n(rows.length)} / {n(all.length)}</span>}
      />
      <div className="px-4 pt-3 space-y-2 sticky top-[60px] z-10 bg-slate-50 dark:bg-slate-950 pb-2">
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              className={inputCls + ' pl-10 font-mono uppercase placeholder:normal-case placeholder:font-sans'}
              placeholder="Filter by number…"
              value={f.text}
              onChange={(e) => setF({ ...f, text: e.target.value })}
              autoCapitalize="characters"
              autoComplete="off"
              spellCheck={false}
              aria-label="Filter by container number"
            />
          </div>
          <Button variant={activeFilters ? 'primary' : 'secondary'} onClick={() => setShowFilters(true)} aria-label="Filters and sort" className="px-3">
            <SlidersHorizontal size={18} />
            {activeFilters > 0 && <span className="tabular-nums">{activeFilters}</span>}
          </Button>
        </div>
        {activeFilters > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {FIELD_KEYS.filter((k) => f[k]).map((k) => (
              <button key={k} onClick={() => setF({ ...f, [k]: '' })} className="inline-flex items-center gap-1 rounded-full bg-brand-100 text-brand-700 dark:bg-brand-700/30 dark:text-brand-100 px-3 py-1 text-xs font-semibold">
                {FIELD_LABELS[k]}: {f[k]} <X size={12} />
              </button>
            ))}
            <button onClick={() => setF({ ...EMPTY, text: f.text })} className="text-xs text-slate-500 underline px-1">Clear all</button>
          </div>
        )}
      </div>

      <div className="px-4 space-y-2">
        {all.length === 0 ? (
          <Empty icon={<Boxes size={22} />} title="No containers yet">Import your stock Excel file to fill the inventory.</Empty>
        ) : rows.length === 0 ? (
          <Empty icon={<Search size={22} />} title="No matches">Try removing a filter.</Empty>
        ) : (
          rows.slice(0, limit).map((r) => (
            <button key={r.container_no} onClick={() => setViewing(r)} className="w-full text-left" data-testid="inv-row">
              <Card className="px-4 py-3 active:bg-slate-50 dark:active:bg-slate-800">
                <div className="flex items-center justify-between">
                  <span className="font-mono font-bold text-slate-900 dark:text-white">{r.container_no}</span>
                  <span className="text-xs font-semibold text-slate-500">{r.shipping_line}</span>
                </div>
                <div className="mt-1.5 flex gap-1.5 text-xs">
                  {(['size', 'type', 'grade'] as const).map((k) => (
                    <span key={k} className="rounded-md bg-slate-100 dark:bg-slate-800 px-2 py-0.5 font-semibold text-slate-700 dark:text-slate-200">{r[k]}</span>
                  ))}
                  <span className={`rounded-md px-2 py-0.5 font-semibold ${r.condition === 'AV' ? 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300' : 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300'}`}>{r.condition}</span>
                </div>
              </Card>
            </button>
          ))
        )}
        {limit < rows.length && <div ref={sentinel} className="py-4 text-center text-sm text-slate-400">Loading more…</div>}
      </div>

      {store.canEdit() && (
        <button
          onClick={() => setAdding(true)}
          aria-label="Add container"
          className="fixed right-4 bottom-[calc(env(safe-area-inset-bottom)+84px)] z-30 w-14 h-14 rounded-2xl bg-brand-600 text-white shadow-lg flex items-center justify-center active:bg-brand-700"
        >
          <Plus size={26} />
        </button>
      )}

      <Sheet open={showFilters} onClose={() => setShowFilters(false)} title="Filter & sort">
        <div className="space-y-3">
          {FIELD_KEYS.map((k) => (
            <label key={k} className="block">
              <span className="text-sm font-medium text-slate-600 dark:text-slate-300">{FIELD_LABELS[k]}</span>
              <select className={selectCls} value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} aria-label={`Filter ${FIELD_LABELS[k]}`}>
                <option value="">All</option>
                {options[k].map(([v, c]) => (
                  <option key={v} value={v}>{v} ({n(c)})</option>
                ))}
              </select>
            </label>
          ))}
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="text-sm font-medium text-slate-600 dark:text-slate-300">Sort by</span>
              <select className={selectCls} value={sort} onChange={(e) => setSort(e.target.value as SortKey)}>
                <option value="container_no">Container no.</option>
                <option value="updated_at">Last updated</option>
                <option value="shipping_line">Shipping line</option>
                <option value="size">Size</option>
                <option value="type">Type</option>
              </select>
            </label>
            <label className="block">
              <span className="text-sm font-medium text-slate-600 dark:text-slate-300">Order</span>
              <select className={selectCls} value={dir} onChange={(e) => setDir(e.target.value as 'asc' | 'desc')}>
                <option value="asc">Ascending</option>
                <option value="desc">Descending</option>
              </select>
            </label>
          </div>
          <div className="grid grid-cols-2 gap-2 pt-2">
            <Button variant="secondary" onClick={() => setF({ ...EMPTY, text: f.text })}>Reset</Button>
            <Button onClick={() => setShowFilters(false)}>Show {n(rows.length)}</Button>
          </div>
        </div>
      </Sheet>

      <Sheet open={!!viewing} onClose={() => setViewing(null)} title="Container details">
        {viewing && (
          <ResultCard
            record={viewing}
            asOf={state.mode === 'cloud' ? state.lastSyncAt : state.lastImport?.created_at ?? null}
            stale={state.mode === 'cloud' && state.sync !== 'synced'}
            onEdit={store.canEdit() ? () => { setEditing(viewing); setViewing(null); } : undefined}
          />
        )}
      </Sheet>
      <ContainerSheet open={!!editing} record={editing} onClose={() => setEditing(null)} />
      <ContainerSheet open={adding} record={null} onClose={() => setAdding(false)} />
    </div>
  );
}
