import { useEffect, useState } from 'react';
import { Database, RefreshCw, Download, History, Palette, Info, LogOut, Trash2, Smartphone, CheckCircle2, XCircle } from 'lucide-react';
import { useStore, useStoreState } from '../state/StoreContext';
import { buildInventoryWorkbook, downloadWorkbook, downloadCsv, stamp } from '../lib/export';
import { formatDateTime, n, timeAgo } from '../lib/format';
import { useTheme, useToast, type Theme } from '../state/ui';
import { Button, Card, PageHeader, SyncBadge } from '../components/ui';
import type { ImportBatch } from '../lib/types';
import { useInstallPrompt } from '../state/install';
import { UsersAdmin } from '../components/UsersAdmin';

export function SettingsScreen({ userEmail, onSignOut }: { userEmail: string | null; onSignOut?: () => Promise<void> }) {
  const store = useStore();
  const state = useStoreState();
  const toast = useToast();
  const [theme, setTheme] = useTheme();
  const [history, setHistory] = useState<ImportBatch[]>([]);
  const [confirmClear, setConfirmClear] = useState(false);
  const install = useInstallPrompt();

  useEffect(() => {
    void store.listImports().then(setHistory);
  }, [store, state.lastImport?.id, state.lastSyncAt]);

  const exportXlsx = () => {
    const wb = buildInventoryWorkbook(store.records(), {
      'Exported at': new Date().toISOString(),
      Containers: String(state.count),
      Source: state.mode === 'cloud' ? `Supabase (synced ${state.lastSyncAt ?? 'never'})` : 'This device (local mode)',
      'App version': __APP_VERSION__,
    });
    downloadWorkbook(wb, `container-inventory-${stamp()}.xlsx`);
    toast('Backup downloaded');
  };

  const Row = ({ label, children }: { label: string; children: React.ReactNode }) => (
    <div className="flex items-center justify-between gap-3 py-2.5 text-sm">
      <span className="text-slate-500 dark:text-slate-400">{label}</span>
      <span className="font-medium text-right text-slate-900 dark:text-white">{children}</span>
    </div>
  );

  return (
    <div className="pb-24">
      <PageHeader title="Settings" />
      <div className="px-4 pt-4 space-y-4">
        <Card className="p-4">
          <h2 className="font-semibold flex items-center gap-2 mb-1"><Database size={18} /> Database</h2>
          <div className="divide-y divide-slate-100 dark:divide-slate-800">
            <Row label="Mode">{state.mode === 'cloud' ? 'Supabase (shared)' : 'Local only (this device)'}</Row>
            <Row label="Status"><SyncBadge state={state.sync} /></Row>
            {userEmail && <Row label="Signed in as">{userEmail}</Row>}
            {state.mode === 'cloud' && <Row label="Access"><span className="capitalize">{state.role ?? '—'}</span></Row>}
            <Row label="Network">{state.online ? 'Online' : 'Offline'}</Row>
            <Row label={state.mode === 'cloud' ? 'Last synchronization' : 'Last import'}>
              {state.mode === 'cloud' ? `${formatDateTime(state.lastSyncAt)} (${timeAgo(state.lastSyncAt)})` : formatDateTime(state.lastImport?.created_at)}
            </Row>
            <Row label="Containers on this device">{n(state.count)}</Row>
            {state.serverVersion !== null && <Row label="Server version">#{state.serverVersion}</Row>}
          </div>
          {state.error && <p className="text-xs text-red-600 mt-2" role="alert">{state.error}</p>}
          {state.mode === 'local' && (
            <p className="text-xs text-amber-700 dark:text-amber-400 mt-2">
              Local mode: data lives only in this browser on this phone. It is not shared and not backed up — export regularly, or connect Supabase (see README).
            </p>
          )}
          {state.mode === 'cloud' && (
            <Button className="w-full mt-3" variant="secondary" onClick={() => store.sync(true)} disabled={state.sync === 'syncing' || !state.online}>
              <RefreshCw size={18} className={state.sync === 'syncing' ? 'animate-spin' : ''} /> Refresh data now
            </Button>
          )}
        </Card>

        {state.mode === 'cloud' && state.role === 'admin' && state.online && <UsersAdmin selfEmail={userEmail} />}

        <Card className="p-4">
          <h2 className="font-semibold flex items-center gap-2 mb-3"><Download size={18} /> Backup / export</h2>
          <div className="grid grid-cols-2 gap-2">
            <Button variant="secondary" onClick={exportXlsx} disabled={!state.count}>Excel (.xlsx)</Button>
            <Button variant="secondary" onClick={() => downloadCsv(store.records(), `container-inventory-${stamp()}.csv`)} disabled={!state.count}>CSV</Button>
          </div>
          <p className="text-xs text-slate-500 mt-2">The Excel backup can be re-imported into this app as-is.</p>
        </Card>

        <Card className="p-4">
          <h2 className="font-semibold flex items-center gap-2 mb-2"><History size={18} /> Import history</h2>
          {history.length === 0 ? (
            <p className="text-sm text-slate-500">No imports yet.</p>
          ) : (
            <ul className="divide-y divide-slate-100 dark:divide-slate-800" data-testid="import-history">
              {history.map((b) => (
                <li key={b.id} className="py-2.5 text-sm">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold truncate flex items-center gap-1.5">
                      {b.status === 'completed' ? <CheckCircle2 size={15} className="text-green-600 shrink-0" /> : <XCircle size={15} className="text-red-600 shrink-0" />}
                      {b.filename}
                    </span>
                    <span className="text-xs text-slate-500 shrink-0">{formatDateTime(b.created_at)}</span>
                  </div>
                  {b.status === 'completed' ? (
                    <div className="text-xs text-slate-500 mt-0.5 capitalize">
                      {b.mode} · +{n(b.added)} new · {n(b.updated)} upd · {n(b.removed)} removed · {n(b.invalid)} invalid
                    </div>
                  ) : (
                    <div className="text-xs text-red-600 mt-0.5">Failed — rolled back. {b.error}</div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card className="p-4">
          <h2 className="font-semibold flex items-center gap-2 mb-3"><Palette size={18} /> Theme</h2>
          <div className="grid grid-cols-3 gap-2">
            {(['light', 'dark', 'system'] as Theme[]).map((t) => (
              <Button key={t} variant={theme === t ? 'primary' : 'secondary'} onClick={() => setTheme(t)} className="capitalize">{t}</Button>
            ))}
          </div>
        </Card>

        {install.available && (
          <Card className="p-4">
            <h2 className="font-semibold flex items-center gap-2 mb-2"><Smartphone size={18} /> Install app</h2>
            <p className="text-sm text-slate-500 mb-3">Add to your home screen for full-screen, offline use.</p>
            <Button className="w-full" onClick={install.prompt}>Install</Button>
          </Card>
        )}

        <Card className="p-4 space-y-2">
          {onSignOut && (
            <Button variant="secondary" className="w-full" onClick={onSignOut}><LogOut size={18} /> Sign out (clears offline copy)</Button>
          )}
          {!confirmClear ? (
            <Button variant="ghost" className="w-full text-red-600" onClick={() => setConfirmClear(true)}>
              <Trash2 size={18} /> {state.mode === 'cloud' ? 'Clear offline copy' : 'Delete all local data'}
            </Button>
          ) : (
            <div className="rounded-xl bg-red-50 dark:bg-red-950/40 p-3">
              <p className="text-sm text-red-800 dark:text-red-300 mb-3">
                {state.mode === 'cloud' ? 'Removes the cached inventory from this phone. The server is not affected; it will re-download on next sync.' : 'This permanently deletes the whole inventory stored on this device. Export a backup first.'}
              </p>
              <div className="grid grid-cols-2 gap-2">
                <Button variant="secondary" onClick={() => setConfirmClear(false)}>Cancel</Button>
                <Button variant="danger" onClick={async () => { await store.clearLocal(); setConfirmClear(false); toast('Local data cleared'); if (state.mode === 'cloud') void store.sync(true); }}>Delete</Button>
              </div>
            </div>
          )}
        </Card>

        <div className="text-center text-xs text-slate-400 pb-4 flex flex-col items-center gap-0.5">
          <Info size={14} />
          <span>Container Stock Tracker v{__APP_VERSION__}</span>
          <span>Build {formatDateTime(__BUILD_TIME__)}</span>
        </div>
      </div>
    </div>
  );
}
