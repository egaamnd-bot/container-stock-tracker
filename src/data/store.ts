import { StockDB } from './db';
import type { RemoteBackend, ImportRequest } from './backend';
import { computeImportPlan } from '../lib/diff';
import { normalizeContainerNumber, normalizeField, isValidFormat } from '../lib/normalize';
import { FIELD_KEYS, FIELD_LABELS, type ContainerRecord, type ContainerFields, type ImportBatch, type SyncState } from '../lib/types';

export interface StoreState {
  ready: boolean;
  mode: 'local' | 'cloud';
  sync: SyncState;
  online: boolean;
  lastSyncAt: string | null;
  serverVersion: number | null;
  error: string | null;
  count: number;
  lastImport: ImportBatch | null;
  /** Increments on every state change — use as a dependency to refresh derived views. */
  rev: number;
}

export interface StoreOptions {
  db?: StockDB;
  remote?: RemoteBackend | null;
  isOnline?: () => boolean;
  now?: () => string;
  /** Test hook: throw inside the local import transaction to prove rollback. */
  beforeLocalImportCommit?: () => void;
}

export interface RecordInput extends ContainerFields {
  container_no: string;
}

export function validateRecordInput(input: RecordInput): { record: Omit<ContainerRecord, 'updated_at'>; errors: string[] } {
  const no = normalizeContainerNumber(input.container_no);
  const errors: string[] = [];
  if (!no) errors.push('Container number is required');
  else if (!isValidFormat(no)) errors.push('Container number must be 4 letters + 7 digits (e.g. AXIU1498450)');
  const fields = {} as ContainerFields;
  for (const k of FIELD_KEYS) {
    fields[k] = normalizeField(input[k]);
    if (!fields[k]) errors.push(`${FIELD_LABELS[k]} is required`);
  }
  const display = isValidFormat(no) ? `${no.slice(0, 4)} ${no.slice(4, 7)} ${no.slice(7, 10)} ${no[10]}` : no;
  return { record: { container_no: no, display_no: display, ...fields }, errors };
}

type Listener = (s: StoreState) => void;

/**
 * Single source of in-app inventory state.
 *  - LOCAL mode (no Supabase configured): IndexedDB on this device is the database.
 *  - CLOUD mode: Supabase is the database; IndexedDB is the offline cache (read-only while offline).
 * The full inventory is held in memory as a Map for O(1) normalized lookups.
 */
export class InventoryStore {
  readonly db: StockDB;
  readonly remote: RemoteBackend | null;
  index = new Map<string, ContainerRecord>();
  private listeners = new Set<Listener>();
  private opts: StoreOptions;
  private syncing: Promise<void> | null = null;
  state: StoreState;

  constructor(opts: StoreOptions = {}) {
    this.opts = opts;
    this.db = opts.db ?? new StockDB();
    this.remote = opts.remote ?? null;
    this.state = {
      ready: false,
      mode: this.remote ? 'cloud' : 'local',
      sync: this.remote ? 'sync-required' : 'local-only',
      online: this.isOnline(),
      lastSyncAt: null,
      serverVersion: null,
      error: null,
      count: 0,
      lastImport: null,
      rev: 0,
    };
  }

  private isOnline() {
    return this.opts.isOnline ? this.opts.isOnline() : typeof navigator === 'undefined' ? true : navigator.onLine;
  }
  private now() {
    return this.opts.now ? this.opts.now() : new Date().toISOString();
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  private set(patch: Partial<StoreState>) {
    this.state = { ...this.state, ...patch, count: this.index.size, rev: this.state.rev + 1 };
    for (const l of this.listeners) l(this.state);
  }

  /** Loads the cached inventory from IndexedDB (works fully offline). */
  async init(): Promise<void> {
    const all = await this.db.containers.toArray();
    this.index = new Map(all.map((r) => [r.container_no, r]));
    const [lastSyncAt, serverVersion, lastImport] = await Promise.all([
      this.db.getMeta<string>('lastSyncAt'),
      this.db.getMeta<number>('serverVersion'),
      this.db.getMeta<ImportBatch>('lastImport'),
    ]);
    const online = this.isOnline();
    this.set({
      ready: true,
      online,
      lastSyncAt: lastSyncAt ?? null,
      serverVersion: serverVersion ?? null,
      lastImport: lastImport ?? null,
      sync: this.remote ? (online ? 'sync-required' : 'offline') : 'local-only',
    });
  }

  records(): ContainerRecord[] {
    return [...this.index.values()];
  }

  canEdit(): boolean {
    if (!this.remote) return true;
    return this.state.online && this.state.sync !== 'offline';
  }

  setOnline(online: boolean) {
    if (!this.remote) return this.set({ online });
    this.set({ online, sync: online ? (this.state.sync === 'offline' ? 'sync-required' : this.state.sync) : 'offline' });
    if (online) void this.sync();
  }

  /** Cloud mode: pulls the server inventory if it changed (or always when force=true). */
  sync(force = false): Promise<void> {
    if (!this.remote) return Promise.resolve();
    if (this.syncing) return this.syncing;
    this.syncing = this.doSync(force).finally(() => {
      this.syncing = null;
    });
    return this.syncing;
  }

  private async doSync(force: boolean): Promise<void> {
    const remote = this.remote!;
    if (!this.isOnline()) {
      this.set({ online: false, sync: 'offline' });
      return;
    }
    this.set({ sync: 'syncing', error: null, online: true });
    try {
      const v = await remote.fetchVersion();
      if (!force && v === this.state.serverVersion && this.state.lastSyncAt) {
        await this.refreshImports();
        const at = this.now();
        await this.db.setMeta('lastSyncAt', at);
        this.set({ sync: 'synced', lastSyncAt: at });
        return;
      }
      const snap = await remote.fetchSnapshot();
      await this.db.transaction('rw', this.db.containers, this.db.meta, async () => {
        await this.db.containers.clear();
        await this.db.containers.bulkPut(snap.records);
        await this.db.setMeta('serverVersion', snap.version);
      });
      this.index = new Map(snap.records.map((r) => [r.container_no, r]));
      await this.refreshImports();
      const at = this.now();
      await this.db.setMeta('lastSyncAt', at);
      this.set({ sync: 'synced', lastSyncAt: at, serverVersion: snap.version });
    } catch (e) {
      const offline = !this.isOnline();
      this.set({ sync: offline ? 'offline' : 'sync-failed', online: !offline, error: offline ? null : (e as Error).message });
    }
  }

  /** Lightweight poll: flags "sync required" when the server has a newer version, then pulls it. */
  async checkForUpdates(): Promise<void> {
    if (!this.remote || !this.isOnline() || this.syncing) return;
    try {
      const v = await this.remote.fetchVersion();
      if (v !== this.state.serverVersion) {
        this.set({ sync: 'sync-required' });
        await this.sync();
      }
    } catch {
      /* next poll will retry; sync() reports real failures */
    }
  }

  private async refreshImports() {
    if (!this.remote) return;
    const list = await this.remote.listImports(30);
    await this.db.transaction('rw', this.db.imports, this.db.meta, async () => {
      await this.db.imports.clear();
      await this.db.imports.bulkPut(list);
      await this.db.setMeta('lastImport', list.find((b) => b.status === 'completed') ?? null);
    });
    this.set({ lastImport: list.find((b) => b.status === 'completed') ?? null });
  }

  async listImports(): Promise<ImportBatch[]> {
    return (await this.db.imports.orderBy('created_at').reverse().toArray()).slice(0, 50);
  }

  private assertCanEdit() {
    if (!this.canEdit()) throw new Error('You are offline. Editing is disabled until you reconnect, so the shared inventory never gets out of sync.');
  }

  async createRecord(input: RecordInput): Promise<ContainerRecord> {
    this.assertCanEdit();
    const { record, errors } = validateRecordInput(input);
    if (errors.length) throw new Error(errors.join('\n'));
    if (this.index.has(record.container_no)) throw new Error(`Container ${record.container_no} already exists.`);
    const saved = this.remote ? await this.remote.insert(record) : { ...record, updated_at: this.now() };
    await this.db.containers.put(saved);
    this.index.set(saved.container_no, saved);
    this.set({});
    if (this.remote) void this.sync();
    return saved;
  }

  async updateRecord(original: ContainerRecord, fields: ContainerFields): Promise<ContainerRecord> {
    this.assertCanEdit();
    const { record, errors } = validateRecordInput({ ...fields, container_no: original.container_no });
    if (errors.length) throw new Error(errors.join('\n'));
    const clean = Object.fromEntries(FIELD_KEYS.map((k) => [k, record[k]])) as ContainerFields;
    let saved: ContainerRecord;
    if (this.remote) {
      saved = await this.remote.update(original.container_no, clean, original.updated_at);
    } else {
      const current = this.index.get(original.container_no);
      if (!current) throw new Error('Record no longer exists.');
      saved = { ...current, ...clean, updated_at: this.now() };
    }
    await this.db.containers.put(saved);
    this.index.set(saved.container_no, saved);
    this.set({});
    if (this.remote) void this.sync();
    return saved;
  }

  async deleteRecord(rec: ContainerRecord): Promise<void> {
    this.assertCanEdit();
    if (this.remote) await this.remote.remove(rec.container_no, rec.updated_at);
    await this.db.containers.delete(rec.container_no);
    this.index.delete(rec.container_no);
    this.set({});
    if (this.remote) void this.sync();
  }

  /**
   * Applies an import atomically.
   * Local: one IndexedDB transaction (all-or-nothing). Cloud: one Postgres transaction via RPC,
   * then a forced re-sync so this device reflects exactly what the server committed.
   */
  async applyImport(req: ImportRequest): Promise<ImportBatch> {
    this.assertCanEdit();
    if (req.rows.length === 0) throw new Error('No valid rows to import. Nothing was changed.');

    if (this.remote) {
      try {
        const batch = await this.remote.applyImport(req);
        await this.sync(true);
        return batch;
      } catch (e) {
        await this.remote.logFailedImport(req, (e as Error).message).catch(() => undefined);
        throw e;
      }
    }

    // Local mode: recompute against the current inventory to avoid acting on a stale preview.
    const plan = computeImportPlan(this.index, req.rows, req.mode, req.protectedNos.map((n) => ({ container_no: n })));
    const at = this.now();
    const batch: ImportBatch = {
      id: crypto.randomUUID(),
      created_at: at,
      mode: req.mode,
      filename: req.filename,
      sheet_name: req.sheetName,
      total_rows: req.totalRows,
      added: plan.counts.added,
      updated: plan.counts.updated,
      unchanged: plan.counts.unchanged,
      removed: plan.counts.removed,
      invalid: req.invalid,
      duplicates: req.duplicates,
      status: 'completed',
    };
    try {
      await this.db.transaction('rw', this.db.containers, this.db.imports, this.db.meta, async () => {
        const put = [...plan.toAdd, ...plan.toUpdate.map((u) => u.row)].map((r) => ({
          container_no: r.container_no,
          display_no: r.display_no,
          shipping_line: r.shipping_line,
          type: r.type,
          grade: r.grade,
          size: r.size,
          condition: r.condition,
          updated_at: at,
        }));
        await this.db.containers.bulkPut(put);
        if (req.mode === 'replace') await this.db.containers.bulkDelete(plan.toRemove.map((r) => r.container_no));
        await this.db.imports.put(batch);
        await this.db.setMeta('lastImport', batch);
        this.opts.beforeLocalImportCommit?.();
      });
    } catch (e) {
      const failed: ImportBatch = { ...batch, id: crypto.randomUUID(), added: 0, updated: 0, unchanged: 0, removed: 0, status: 'failed', error: (e as Error).message };
      await this.db.imports.put(failed).catch(() => undefined);
      throw new Error(`Import failed and was rolled back — no changes were made. (${(e as Error).message})`);
    }
    const all = await this.db.containers.toArray();
    this.index = new Map(all.map((r) => [r.container_no, r]));
    this.set({ lastImport: batch });
    return batch;
  }

  /** Removes the local cache (e.g. on sign-out). */
  async clearLocal(): Promise<void> {
    await this.db.transaction('rw', this.db.containers, this.db.imports, this.db.meta, async () => {
      await this.db.containers.clear();
      await this.db.imports.clear();
      await this.db.meta.clear();
    });
    this.index = new Map();
    this.set({ lastSyncAt: null, serverVersion: null, lastImport: null, sync: this.remote ? 'sync-required' : 'local-only' });
  }
}
