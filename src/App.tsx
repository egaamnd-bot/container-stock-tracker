import { Suspense, lazy, useCallback, useEffect, useState } from 'react';
import { Search, Boxes, Upload, BarChart3, Settings, Loader2 } from 'lucide-react';
import type { Session } from '@supabase/supabase-js';
import { StoreProvider, getStore, useStoreState } from './state/StoreContext';
import { ToastProvider, useTheme } from './state/ui';
import { getSupabase, isCloudConfigured, type AccessRole } from './data/supabase';
import { SearchScreen } from './screens/SearchScreen';
import { InventoryScreen } from './screens/InventoryScreen';
const ImportScreen = lazy(() => import('./screens/ImportScreen').then((m) => ({ default: m.ImportScreen })));
const DashboardScreen = lazy(() => import('./screens/DashboardScreen').then((m) => ({ default: m.DashboardScreen })));
const SettingsScreen = lazy(() => import('./screens/SettingsScreen').then((m) => ({ default: m.SettingsScreen })));
import { LoginScreen } from './screens/LoginScreen';

const TABS = [
  { id: 'search', label: 'Search', Icon: Search },
  { id: 'inventory', label: 'Inventory', Icon: Boxes },
  { id: 'import', label: 'Import', Icon: Upload },
  { id: 'dashboard', label: 'Dashboard', Icon: BarChart3 },
  { id: 'settings', label: 'Settings', Icon: Settings },
] as const;
type TabId = (typeof TABS)[number]['id'];

function useHashTab(): [TabId, (t: TabId) => void] {
  const read = (): TabId => {
    const h = window.location.hash.replace('#/', '') as TabId;
    return TABS.some((t) => t.id === h) ? h : 'search';
  };
  const [tab, setTab] = useState<TabId>(read);
  useEffect(() => {
    const f = () => setTab(read());
    window.addEventListener('hashchange', f);
    return () => window.removeEventListener('hashchange', f);
  }, []);
  const go = useCallback((t: TabId) => {
    if (t === 'search') history.replaceState(null, '', window.location.pathname + window.location.search);
    else window.location.hash = `/${t}`;
    setTab(t);
    window.scrollTo(0, 0);
  }, []);
  return [tab, go];
}

function Shell({ userEmail, onSignOut }: { userEmail: string | null; onSignOut?: () => Promise<void> }) {
  const [tab, go] = useHashTab();
  const state = useStoreState();
  // Viewers never see Import (server RLS blocks it anyway; this keeps the UI honest).
  const readOnly = state.mode === 'cloud' && state.role !== 'admin' && state.role !== 'editor';
  const tabs = TABS.filter((t) => !(readOnly && t.id === 'import'));
  useEffect(() => {
    if (readOnly && tab === 'import') go('search');
  }, [readOnly, tab, go]);
  if (!state.ready)
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="animate-spin text-brand-600" size={32} />
      </div>
    );
  return (
    <div className="min-h-screen max-w-xl mx-auto pb-[calc(env(safe-area-inset-bottom)+72px)]">
      <main>
        <Suspense fallback={<div className="flex justify-center py-20"><Loader2 className="animate-spin text-brand-600" size={28} /></div>}>
        {tab === 'search' && <SearchScreen onOpenSettings={() => go('settings')} />}
        {tab === 'inventory' && <InventoryScreen />}
        {tab === 'import' && !readOnly && <ImportScreen />}
        {tab === 'dashboard' && <DashboardScreen />}
        {tab === 'settings' && <SettingsScreen userEmail={userEmail} onSignOut={onSignOut} />}
        </Suspense>
      </main>
      <nav className="fixed bottom-0 inset-x-0 z-40 bg-white/95 dark:bg-slate-900/95 backdrop-blur border-t border-slate-200 dark:border-slate-800 pb-[env(safe-area-inset-bottom)]" aria-label="Main">
        <div className={`max-w-xl mx-auto grid ${tabs.length === 5 ? 'grid-cols-5' : 'grid-cols-4'}`}>
          {tabs.map(({ id, label, Icon }) => (
            <button
              key={id}
              onClick={() => go(id)}
              aria-current={tab === id ? 'page' : undefined}
              data-testid={`nav-${id}`}
              className={`flex flex-col items-center justify-center gap-0.5 h-[64px] text-[11px] font-semibold ${tab === id ? 'text-brand-600 dark:text-brand-100' : 'text-slate-500 dark:text-slate-400'}`}
            >
              <span className={`flex items-center justify-center w-14 h-8 rounded-full ${tab === id ? 'bg-brand-100 dark:bg-brand-700/40' : ''}`}>
                <Icon size={22} />
              </span>
              {label}
            </button>
          ))}
        </div>
      </nav>
    </div>
  );
}

const AUTH_FLAG = 'cst.authorized';
const ROLE_FLAG = 'cst.role';

/** Cloud mode: requires sign-in + membership in authorized_users. Works offline with a cached session. */
function CloudGate() {
  const sb = getSupabase()!;
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [authz, setAuthz] = useState<'checking' | 'ok' | 'denied'>('checking');

  useEffect(() => {
    void sb.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = sb.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, [sb]);

  useEffect(() => {
    if (!session) return;
    const uid = session.user.id;
    const cachedOk = () => {
      if (localStorage.getItem(AUTH_FLAG) !== uid) return false;
      getStore().setRole((localStorage.getItem(ROLE_FLAG) as AccessRole | null) ?? 'viewer');
      setAuthz('ok');
      return true;
    };
    if (!navigator.onLine && cachedOk()) return;
    void sb
      .from('authorized_users')
      .select('role')
      .eq('user_id', uid)
      .maybeSingle()
      .then(({ data, error }) => {
        if (error && cachedOk()) return; // network hiccup: trust last check
        if (data) {
          localStorage.setItem(AUTH_FLAG, uid);
          localStorage.setItem(ROLE_FLAG, data.role);
          getStore().setRole(data.role as AccessRole);
          setAuthz('ok');
        } else setAuthz('denied');
      });
  }, [session, sb]);

  const signOut = async () => {
    await getStore().clearLocal();
    localStorage.removeItem(AUTH_FLAG);
    localStorage.removeItem(ROLE_FLAG);
    getStore().setRole(null);
    await sb.auth.signOut();
  };

  if (session === undefined) return null;
  if (!session) return <LoginScreen />;
  if (authz === 'checking')
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="animate-spin text-brand-600" size={32} />
      </div>
    );
  if (authz === 'denied')
    return (
      <LoginScreen
        notice={`Signed in as ${session.user.email}.\nYour access request is waiting for admin approval. Reopen the app once you've been approved.`}
        onSignOut={signOut}
      />
    );
  return (
    <StoreProvider autoSync>
      <Shell userEmail={session.user.email ?? null} onSignOut={signOut} />
    </StoreProvider>
  );
}

export default function App() {
  useTheme();
  return (
    <ToastProvider>
      {isCloudConfigured ? (
        <CloudGate />
      ) : (
        <StoreProvider autoSync={false}>
          <Shell userEmail={null} />
        </StoreProvider>
      )}
    </ToastProvider>
  );
}
