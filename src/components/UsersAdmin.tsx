import { useCallback, useEffect, useState } from 'react';
import { Users, Loader2, RefreshCw, UserCheck, UserX } from 'lucide-react';
import { adminListUsers, adminSetRole, type AppUser, type AccessRole } from '../data/supabase';
import { formatDateTime } from '../lib/format';
import { useToast } from '../state/ui';
import { Button, Card, selectCls } from './ui';

/** Admin-only: approve sign-ups, change roles, revoke access. Guarded server-side by admin_* RPCs. */
export function UsersAdmin({ selfEmail }: { selfEmail: string | null }) {
  const toast = useToast();
  const [users, setUsers] = useState<AppUser[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setErr(null);
    try {
      setUsers(await adminListUsers());
    } catch (e) {
      setErr((e as Error).message);
    }
  }, []);
  useEffect(() => void load(), [load]);

  const change = async (u: AppUser, role: AccessRole | null) => {
    setBusy(u.user_id);
    try {
      await adminSetRole(u.user_id, role);
      toast(role ? `${u.email} → ${role}` : `Access removed for ${u.email}`);
      await load();
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const pending = users?.filter((u) => !u.role) ?? [];
  const active = users?.filter((u) => u.role) ?? [];

  return (
    <Card className="p-4" data-testid="users-admin">
      <div className="flex items-center justify-between mb-2">
        <h2 className="font-semibold flex items-center gap-2"><Users size={18} /> Users</h2>
        <Button variant="ghost" className="min-h-[36px] px-2" onClick={() => void load()} aria-label="Reload users"><RefreshCw size={16} /></Button>
      </div>
      {err && <p className="text-sm text-red-600" role="alert">{err}</p>}
      {!users && !err && <div className="flex justify-center py-4"><Loader2 className="animate-spin text-brand-600" /></div>}

      {pending.length > 0 && (
        <div className="mb-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-amber-700 mb-1">Waiting for approval ({pending.length})</p>
          <ul className="divide-y divide-slate-100 dark:divide-slate-800">
            {pending.map((u) => (
              <li key={u.user_id} className="py-2.5 text-sm">
                <div className="font-medium truncate">{u.email}</div>
                <div className="text-xs text-slate-500 mb-2">Signed up {formatDateTime(u.signed_up_at)}</div>
                <div className="grid grid-cols-2 gap-2">
                  <Button disabled={busy === u.user_id} onClick={() => change(u, 'viewer')}><UserCheck size={16} /> Approve as viewer</Button>
                  <Button variant="secondary" disabled={busy === u.user_id} onClick={() => change(u, 'admin')}>Make admin</Button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {active.length > 0 && (
        <ul className="divide-y divide-slate-100 dark:divide-slate-800">
          {active.map((u) => {
            const self = !!selfEmail && u.email === selfEmail;
            return (
              <li key={u.user_id} className="py-2.5 text-sm flex items-center gap-2">
                <div className="min-w-0 flex-1">
                  <div className="font-medium truncate">{u.email}{self && <span className="text-slate-400"> (you)</span>}</div>
                  <div className="text-xs text-slate-500">Last sign-in {u.last_sign_in_at ? formatDateTime(u.last_sign_in_at) : 'never'}</div>
                </div>
                {self ? (
                  <span className="text-xs font-semibold capitalize text-brand-600">{u.role}</span>
                ) : (
                  <>
                    <select
                      aria-label={`Role for ${u.email}`}
                      className={`${selectCls} !w-auto !min-h-[36px] text-sm`}
                      value={u.role ?? ''}
                      disabled={busy === u.user_id}
                      onChange={(e) => change(u, e.target.value as AccessRole)}
                    >
                      <option value="viewer">Viewer</option>
                      <option value="editor">Editor</option>
                      <option value="admin">Admin</option>
                    </select>
                    <Button variant="ghost" className="min-h-[36px] px-2 text-red-600" disabled={busy === u.user_id} onClick={() => change(u, null)} aria-label={`Remove access for ${u.email}`}>
                      <UserX size={16} />
                    </Button>
                  </>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <p className="text-xs text-slate-500 mt-2">Coworkers open the app link, tap <b>Request access</b>, then appear here. Viewers can search and browse only.</p>
    </Card>
  );
}
