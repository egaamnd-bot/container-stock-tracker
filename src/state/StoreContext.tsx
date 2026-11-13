import { createContext, useContext, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { InventoryStore, type StoreState } from '../data/store';
import { SupabaseBackend, getSupabase } from '../data/supabase';

const StoreCtx = createContext<InventoryStore | null>(null);

let singleton: InventoryStore | null = null;
export function getStore(): InventoryStore {
  if (!singleton) {
    const sb = getSupabase();
    singleton = new InventoryStore({ remote: sb ? new SupabaseBackend(sb) : null });
  }
  return singleton;
}

export function StoreProvider({ children, autoSync }: { children: ReactNode; autoSync: boolean }) {
  const store = getStore();
  const [initError, setInitError] = useState<string | null>(null);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    store.init().catch((e) => setInitError(String(e?.message ?? e)));
  }, [store]);

  useEffect(() => {
    const on = () => store.setOnline(true);
    const off = () => store.setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, [store]);

  useEffect(() => {
    if (!autoSync || !store.remote) return;
    let cancelled = false;
    const wait = () =>
      new Promise<void>((res) => {
        const t = setInterval(() => {
          if (store.state.ready || cancelled) {
            clearInterval(t);
            res();
          }
        }, 50);
      });
    void wait().then(() => { if (!cancelled) void store.sync(); });
    const vis = () => document.visibilityState === 'visible' && void store.checkForUpdates();
    document.addEventListener('visibilitychange', vis);
    const poll = setInterval(() => document.visibilityState === 'visible' && void store.checkForUpdates(), 60_000);
    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', vis);
      clearInterval(poll);
    };
  }, [store, autoSync]);

  if (initError)
    return (
      <div className="p-6 text-red-700">
        <p className="font-semibold">Could not open the on-device database.</p>
        <p className="text-sm mt-2">{initError}</p>
        <p className="text-sm mt-2">Private/incognito browsing can block storage. Open the app in a normal Chrome tab.</p>
      </div>
    );
  return <StoreCtx.Provider value={store}>{children}</StoreCtx.Provider>;
}

export function useStore(): InventoryStore {
  const s = useContext(StoreCtx);
  if (!s) throw new Error('StoreProvider missing');
  return s;
}

export function useStoreState(): StoreState {
  const store = useStore();
  return useSyncExternalStore(
    (cb) => store.subscribe(cb),
    () => store.state,
  );
}
