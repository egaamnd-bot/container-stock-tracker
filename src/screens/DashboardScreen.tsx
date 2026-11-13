import { useMemo } from 'react';
import { BarChart3, FileSpreadsheet } from 'lucide-react';
import { useStore, useStoreState } from '../state/StoreContext';
import { countBy } from '../lib/search';
import { formatDateTime, n } from '../lib/format';
import { Card, PageHeader, Stat, BarList, Empty } from '../components/ui';

export function DashboardScreen() {
  const store = useStore();
  const state = useStoreState();
  const recs = useMemo(() => store.records(), [store, state.rev]);
  const total = recs.length;
  const by = useMemo(
    () => ({
      line: countBy(recs, 'shipping_line'),
      size: countBy(recs, 'size'),
      type: countBy(recs, 'type'),
      condition: countBy(recs, 'condition'),
      grade: countBy(recs, 'grade'),
    }),
    [recs],
  );
  const recent = useMemo(() => [...recs].sort((a, b) => b.updated_at.localeCompare(a.updated_at)).slice(0, 10), [recs]);
  const get = (list: [string, number][], k: string) => list.find(([x]) => x === k)?.[1] ?? 0;
  const li = state.lastImport;

  if (!total)
    return (
      <div>
        <PageHeader title="Dashboard" />
        <Empty icon={<BarChart3 size={22} />} title="No data yet">Import an inventory file to see statistics.</Empty>
      </div>
    );

  return (
    <div className="pb-24">
      <PageHeader title="Dashboard" />
      <div className="px-4 pt-4 space-y-4">
        <Card className="p-4">
          <div className="grid grid-cols-2 gap-2">
            <Stat label="Total containers" value={n(total)} tone="blue" />
            <Stat label="Available (AV)" value={n(get(by.condition, 'AV'))} tone="green" sub={`${((get(by.condition, 'AV') / total) * 100).toFixed(1)}%`} />
            <Stat label="20 ft" value={n(get(by.size, '20'))} />
            <Stat label="40 ft" value={n(get(by.size, '40'))} />
            <Stat label="45 ft" value={n(get(by.size, '45'))} />
            <Stat label="Damaged (DM)" value={n(get(by.condition, 'DM'))} tone="amber" />
          </div>
        </Card>
        {([['By shipping line', by.line], ['By size', by.size], ['By type', by.type], ['By condition', by.condition], ['By grade', by.grade]] as const).map(([title, data]) => (
          <Card key={title} className="p-4">
            <h2 className="font-semibold text-slate-900 dark:text-white mb-3">{title}</h2>
            <BarList data={data} total={total} />
          </Card>
        ))}
        <Card className="p-4">
          <h2 className="font-semibold text-slate-900 dark:text-white mb-3 flex items-center gap-2"><FileSpreadsheet size={18} /> Latest import</h2>
          {li ? (
            <div className="text-sm space-y-2">
              <div className="flex justify-between"><span className="text-slate-500">File</span><span className="font-semibold truncate ml-4">{li.filename}</span></div>
              <div className="flex justify-between"><span className="text-slate-500">When</span><span>{formatDateTime(li.created_at)}</span></div>
              <div className="flex justify-between"><span className="text-slate-500">Mode</span><span className="capitalize">{li.mode}</span></div>
              <div className="grid grid-cols-4 gap-2 pt-1">
                <Stat label="New" value={n(li.added)} tone="green" />
                <Stat label="Upd." value={n(li.updated)} tone="blue" />
                <Stat label="Rem." value={n(li.removed)} tone={li.removed ? 'red' : 'default'} />
                <Stat label="Inv." value={n(li.invalid)} tone={li.invalid ? 'red' : 'default'} />
              </div>
            </div>
          ) : (
            <p className="text-sm text-slate-500">No imports yet.</p>
          )}
        </Card>
        <Card className="p-4">
          <h2 className="font-semibold text-slate-900 dark:text-white mb-2">Recently updated</h2>
          <ul className="divide-y divide-slate-100 dark:divide-slate-800 text-sm">
            {recent.map((r) => (
              <li key={r.container_no} className="py-2 flex justify-between gap-2">
                <span className="font-mono font-semibold">{r.container_no}</span>
                <span className="text-slate-500 text-xs text-right">{r.shipping_line} · {r.size}{r.type} · {r.condition}<br />{formatDateTime(r.updated_at)}</span>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </div>
  );
}
