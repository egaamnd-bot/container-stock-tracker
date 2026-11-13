import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { InventoryStore } from '../../src/data/store';
import { StockDB } from '../../src/data/db';
import { ConflictError, type RemoteBackend, type ImportRequest } from '../../src/data/backend';
import { computeImportPlan } from '../../src/lib/diff';
import { readWorkbook, autoMapColumns, parseRows } from '../../src/lib/excel';
import { searchContainer } from '../../src/lib/search';
import type { ContainerRecord, ImportBatch, ImportMode } from '../../src/lib/types';

let dbn = 0;
const freshDB = () => new StockDB(`test-${++dbn}`);
const row = (no: string, condition = 'DM') => ({ container_no: no, display_no: no, shipping_line: 'MSL', type: 'HU', grade: 'K', size: '40', condition });

function req(rows: ReturnType<typeof row>[], mode: ImportMode, existing = new Map<string, ContainerRecord>(), protectedNos: string[] = []): ImportRequest {
  return {
    mode, filename: 't.xlsx', sheetName: 'S', totalRows: rows.length, invalid: 0, duplicates: 0,
    plan: computeImportPlan(existing, rows, mode), rows, protectedNos,
  };
}

/** In-memory fake of the Supabase backend (mirrors apply_import semantics). */
class FakeRemote implements RemoteBackend {
  data = new Map<string, ContainerRecord>();
  version = 1;
  batches: ImportBatch[] = [];
  down = false;
  tick = 0;
  private ts() { return `2026-11-13T00:00:${String(++this.tick).padStart(2, '0')}.000000+00:00`; }
  private check() { if (this.down) throw new TypeError('Failed to fetch'); }
  async fetchVersion() { this.check(); return this.version; }
  async fetchSnapshot() { this.check(); return { records: [...this.data.values()], version: this.version }; }
  async insert(r: Omit<ContainerRecord, 'updated_at'>) { this.check(); const s = { ...r, updated_at: this.ts() }; this.data.set(r.container_no, s); this.version++; return s; }
  async update(no: string, f: Partial<ContainerRecord>, exp: string) {
    this.check(); const cur = this.data.get(no);
    if (!cur || cur.updated_at !== exp) throw new ConflictError();
    const s = { ...cur, ...f, updated_at: this.ts() }; this.data.set(no, s); this.version++; return s;
  }
  async remove(no: string, exp: string) { this.check(); const cur = this.data.get(no); if (!cur || cur.updated_at !== exp) throw new ConflictError(); this.data.delete(no); this.version++; }
  async applyImport(r: ImportRequest) {
    this.check();
    const plan = computeImportPlan(this.data, r.rows, r.mode, r.protectedNos.map((n) => ({ container_no: n })));
    for (const x of [...plan.toAdd, ...plan.toUpdate.map((u) => u.row)]) this.data.set(x.container_no, { ...x, updated_at: this.ts() });
    if (r.mode === 'replace') for (const x of plan.toRemove) this.data.delete(x.container_no);
    this.version++;
    const b: ImportBatch = { id: `b${this.batches.length}`, created_at: this.ts(), mode: r.mode, filename: r.filename, sheet_name: r.sheetName, total_rows: r.totalRows, ...plan.counts, invalid: 0, duplicates: 0, status: 'completed' };
    this.batches.unshift(b);
    return b;
  }
  async logFailedImport() {}
  async listImports() { this.check(); return this.batches; }
}

describe('LOCAL mode store', () => {
  let store: InventoryStore;
  beforeEach(async () => {
    store = new InventoryStore({ db: freshDB(), remote: null });
    await store.init();
  });

  it('starts empty and local-only', () => {
    expect(store.state.sync).toBe('local-only');
    expect(store.state.count).toBe(0);
  });

  it.skipIf(!existsSync('tests/fixtures/Stock now.xlsx'))('imports the real workbook, persists to IndexedDB, and survives a reload', async () => {
    const wb = readWorkbook(readFileSync('tests/fixtures/Stock now.xlsx'));
    const rows = wb.sheets.Sheet.rows;
    const p = parseRows(rows, 0, autoMapColumns(rows[0]));
    const r: ImportRequest = { ...req(p.valid, 'replace'), totalRows: p.totalRows, invalid: p.invalid.length };
    const b = await store.applyImport(r);
    expect(b).toMatchObject({ added: 7397, removed: 0, invalid: 1, status: 'completed' });

    const reloaded = new InventoryStore({ db: store.db, remote: null });
    await reloaded.init();
    expect(reloaded.state.count).toBe(7397);
    const s = searchContainer(reloaded.index, 'AXIU 149 8450');
    expect(s.kind).toBe('found');
    if (s.kind === 'found') expect(s.record).toMatchObject({ shipping_line: 'MSL', type: 'HU', grade: 'K', size: '40', condition: 'DM' });
    expect(reloaded.state.lastImport?.added).toBe(7397);
  });

  it('replace vs merge', async () => {
    await store.applyImport(req([row('AAAU0000001'), row('BBBU0000002'), row('CCCU0000003')], 'replace'));
    const m = await store.applyImport(req([row('AAAU0000001', 'AV'), row('DDDU0000004')], 'merge'));
    expect(m).toMatchObject({ added: 1, updated: 1, unchanged: 0, removed: 0 });
    expect(store.state.count).toBe(4);
    const r = await store.applyImport(req([row('AAAU0000001', 'AV'), row('DDDU0000004')], 'replace', undefined, ['CCCU0000003']));
    expect(r).toMatchObject({ added: 0, updated: 0, unchanged: 2, removed: 1 });
    expect([...store.index.keys()].sort()).toEqual(['AAAU0000001', 'CCCU0000003', 'DDDU0000004']);
  });

  it('failed import rolls back completely and is logged as failed', async () => {
    await store.applyImport(req([row('AAAU0000001'), row('BBBU0000002')], 'replace'));
    const failing = new InventoryStore({ db: store.db, remote: null, beforeLocalImportCommit: () => { throw new Error('disk full'); } });
    await failing.init();
    await expect(failing.applyImport(req([row('ZZZU0000009')], 'replace'))).rejects.toThrow(/rolled back/);
    const after = await store.db.containers.toArray();
    expect(after.map((r) => r.container_no).sort()).toEqual(['AAAU0000001', 'BBBU0000002']);
    const hist = await failing.listImports();
    expect(hist[0].status).toBe('failed');
    expect(hist.filter((h) => h.status === 'completed').length).toBe(1);
  });

  it('refuses an import with zero valid rows', async () => {
    await expect(store.applyImport(req([], 'replace'))).rejects.toThrow(/No valid rows/);
  });

  it('create / update / delete with validation', async () => {
    await expect(store.createRecord({ container_no: 'BAD', shipping_line: 'MSL', type: 'HU', grade: 'K', size: '40', condition: 'DM' })).rejects.toThrow(/4 letters/);
    await expect(store.createRecord({ container_no: 'AXIU1498450', shipping_line: '', type: 'HU', grade: 'K', size: '40', condition: 'DM' })).rejects.toThrow(/Shipping line is required/);
    const c = await store.createRecord({ container_no: 'axiu 149 845 0', shipping_line: 'msl', type: 'hu', grade: 'k', size: '40', condition: 'dm' });
    expect(c).toMatchObject({ container_no: 'AXIU1498450', display_no: 'AXIU 149 845 0', shipping_line: 'MSL', grade: 'K' });
    await expect(store.createRecord({ container_no: 'AXIU1498450', shipping_line: 'MSL', type: 'HU', grade: 'K', size: '40', condition: 'DM' })).rejects.toThrow(/already exists/);
    const u = await store.updateRecord(c, { shipping_line: 'MSL', type: 'HU', grade: 'K', size: '40', condition: 'AV' });
    expect(u.condition).toBe('AV');
    await store.deleteRecord(u);
    expect(store.index.has('AXIU1498450')).toBe(false);
    expect(await store.db.containers.get('AXIU1498450')).toBeUndefined();
  });
});

describe('CLOUD mode store (fake Supabase)', () => {
  let remote: FakeRemote;
  let online: boolean;
  let store: InventoryStore;
  beforeEach(async () => {
    remote = new FakeRemote();
    for (const r of [row('AXIU1498450', 'DM'), row('MSKU1234565', 'AV')]) remote.data.set(r.container_no, { ...r, updated_at: 't0' });
    online = true;
    store = new InventoryStore({ db: freshDB(), remote, isOnline: () => online });
    await store.init();
  });

  it('syncs the server inventory into the offline cache', async () => {
    expect(store.state.sync).toBe('sync-required');
    await store.sync();
    expect(store.state.sync).toBe('synced');
    expect(store.state.count).toBe(2);
    expect(await store.db.containers.count()).toBe(2);
  });

  it('offline: searches the cached snapshot, reports offline, blocks editing', async () => {
    await store.sync();
    online = false;
    remote.down = true;
    const cold = new InventoryStore({ db: store.db, remote, isOnline: () => online });
    await cold.init(); // app opened with no network
    expect(cold.state.sync).toBe('offline');
    expect(cold.state.lastSyncAt).not.toBeNull();
    expect(searchContainer(cold.index, 'axiu 149 845 0').kind).toBe('found');
    expect(cold.canEdit()).toBe(false);
    await expect(cold.updateRecord(cold.index.get('AXIU1498450')!, { ...row('X'), condition: 'AV' })).rejects.toThrow(/offline/i);
    await expect(cold.applyImport(req([row('ZZZU0000001')], 'merge'))).rejects.toThrow(/offline/i);
  });

  it('reconnection: detects a newer server version and re-synchronizes', async () => {
    await store.sync();
    store.setOnline(false);
    expect(store.state.sync).toBe('offline');
    remote.data.set('NEWU0000001', { ...row('NEWU0000001'), updated_at: 'tx' });
    remote.version++;
    online = true;
    store.setOnline(true);
    await store.sync();
    expect(store.state.sync).toBe('synced');
    expect(store.index.has('NEWU0000001')).toBe(true);
  });

  it('checkForUpdates pulls only when the server version changed', async () => {
    await store.sync();
    let snaps = 0;
    const orig = remote.fetchSnapshot.bind(remote);
    remote.fetchSnapshot = async () => { snaps++; return orig(); };
    await store.checkForUpdates();
    expect(snaps).toBe(0);
    remote.version++;
    await store.checkForUpdates();
    expect(snaps).toBe(1);
  });

  it('server error (online) → sync-failed with a message; cache preserved', async () => {
    await store.sync();
    remote.down = true;
    await store.sync(true);
    expect(store.state.sync).toBe('sync-failed');
    expect(store.state.error).toMatch(/Failed to fetch/);
    expect(store.state.count).toBe(2);
  });

  it('optimistic concurrency: stale edit is rejected with a conflict', async () => {
    await store.sync();
    const stale = store.index.get('AXIU1498450')!;
    await remote.update('AXIU1498450', { grade: 'A' }, stale.updated_at); // someone else edits
    await expect(store.updateRecord(stale, { shipping_line: 'MSL', type: 'HU', grade: 'K', size: '40', condition: 'AV' })).rejects.toBeInstanceOf(ConflictError);
  });

  it('cloud import goes through the server, then re-syncs', async () => {
    await store.sync();
    const b = await store.applyImport(req([row('AXIU1498450', 'AV'), row('NEWU0000002')], 'replace'));
    expect(b).toMatchObject({ added: 1, updated: 1, removed: 1 });
    expect([...store.index.keys()].sort()).toEqual(['AXIU1498450', 'NEWU0000002']);
    expect(store.index.get('AXIU1498450')!.condition).toBe('AV');
    expect(store.state.lastImport?.id).toBe(b.id);
  });
});
