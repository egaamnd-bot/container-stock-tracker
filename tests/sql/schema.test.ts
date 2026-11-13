/**
 * Runs the real Supabase migration inside PGlite (Postgres 17 in WASM) and exercises
 * constraints, RLS, the transactional import RPC, rollback, audit and versioning.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { readFileSync, existsSync } from 'node:fs';
import { readWorkbook, autoMapColumns, parseRows } from '../../src/lib/excel';

const EDITOR = '11111111-1111-1111-1111-111111111111';
const VIEWER = '22222222-2222-2222-2222-222222222222';
const STRANGER = '33333333-3333-3333-3333-333333333333';

let db: PGlite;

async function as<T>(uid: string | null, fn: () => Promise<T>): Promise<T> {
  await db.exec(`set role ${uid ? 'authenticated' : 'anon'}; select set_config('request.jwt.claim.sub', '${uid ?? ''}', false);`);
  try {
    return await fn();
  } finally {
    await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false);`);
  }
}
const row = (no: string, condition = 'DM') => ({
  container_no: no, display_no: no, shipping_line: 'MSL', type: 'HU', grade: 'K', size: '40', condition,
});
async function importRows(rows: object[], mode: 'replace' | 'merge', prot: string[] = []) {
  const r = await db.query<{ added: number; updated: number; unchanged: number; removed: number }>(
    `select * from public.apply_import($1, $2::jsonb, 'test.xlsx', 'Sheet', $3, 0, 0, $4::text[])`,
    [mode, JSON.stringify(rows), rows.length, prot],
  );
  return r.rows[0];
}
const count = async () => (await db.query<{ n: number }>('select count(*)::int n from public.containers')).rows[0].n;
const version = async () => Number((await db.query<{ v: string }>('select version v from public.inventory_state')).rows[0].v);

beforeAll(async () => {
  db = new PGlite({ extensions: { pgcrypto } });
  await db.exec(readFileSync('tests/sql/auth-stub.sql', 'utf8'));
  await db.exec(readFileSync('supabase/migrations/001_init.sql', 'utf8'));
  await db.exec(readFileSync('supabase/migrations/002_roles_admin.sql', 'utf8'));
  await db.exec(`insert into auth.users values ('${EDITOR}'), ('${VIEWER}'), ('${STRANGER}');
                 insert into public.authorized_users values ('${EDITOR}', 'editor'), ('${VIEWER}', 'viewer');`);
});

describe('schema + RLS', () => {
  it('migration is re-runnable (idempotent)', async () => {
    await db.exec(readFileSync('supabase/migrations/001_init.sql', 'utf8'));
  });

  it('rejects non-normalized container numbers at the database level', async () => {
    await expect(
      as(EDITOR, () => db.query(`insert into public.containers (container_no, display_no, shipping_line, type, grade, size, condition) values ('AXIU 1498450','x','MSL','HU','K','40','DM')`)),
    ).rejects.toThrow(/check constraint/);
    await expect(
      as(EDITOR, () => db.query(`insert into public.containers (container_no, display_no, shipping_line, type, grade, size, condition) values ('axiu1498450','x','MSL','HU','K','40','DM')`)),
    ).rejects.toThrow(/check constraint/);
  });

  it('enforces unique normalized numbers', async () => {
    await as(EDITOR, () => db.query(`insert into public.containers (container_no, display_no, shipping_line, type, grade, size, condition) values ('UNIQ0000001','x','MSL','HU','K','40','DM')`));
    await expect(
      as(EDITOR, () => db.query(`insert into public.containers (container_no, display_no, shipping_line, type, grade, size, condition) values ('UNIQ0000001','y','MSL','HU','K','40','DM')`)),
    ).rejects.toThrow(/duplicate key/);
    await as(EDITOR, () => db.query(`delete from public.containers where container_no='UNIQ0000001'`));
  });

  it('anon and unauthorized users see nothing and cannot write', async () => {
    await as(EDITOR, () => importRows([row('AAAU0000001')], 'merge'));
    await expect(as(null, () => db.query('select * from public.containers'))).rejects.toThrow(/permission denied/);
    const r = await as(STRANGER, () => db.query('select * from public.containers'));
    expect(r.rows.length).toBe(0);
    await expect(as(STRANGER, () => importRows([row('ZZZU0000009')], 'merge'))).rejects.toThrow(/Not authorized/);
    const del = await as(STRANGER, () => db.query(`delete from public.containers`));
    expect(del.affectedRows).toBe(0);
    expect(await count()).toBe(1);
  });

  it('viewer can read but not write', async () => {
    const r = await as(VIEWER, () => db.query('select * from public.containers'));
    expect(r.rows.length).toBe(1);
    await expect(as(VIEWER, () => importRows([row('ZZZU0000009')], 'merge'))).rejects.toThrow(/Not authorized/);
    const upd = await as(VIEWER, () => db.query(`update public.containers set grade='X'`));
    expect(upd.affectedRows).toBe(0);
  });

  it('nobody can write audit_log directly', async () => {
    await expect(as(EDITOR, () => db.query(`insert into public.audit_log (action, container_no) values ('insert','X')`))).rejects.toThrow();
  });
});

describe('apply_import', () => {
  it('merge: adds/updates, never removes; counts are correct; audit + version recorded', async () => {
    await db.exec('delete from public.containers; delete from public.audit_log; delete from public.import_batches;');
    const v0 = await version();
    const b1 = await as(EDITOR, () => importRows([row('AAAU0000001'), row('BBBU0000002'), row('CCCU0000003')], 'merge'));
    expect(b1).toMatchObject({ added: 3, updated: 0, unchanged: 0, removed: 0 });
    const b2 = await as(EDITOR, () => importRows([row('AAAU0000001'), row('BBBU0000002', 'AV'), row('DDDU0000004')], 'merge'));
    expect(b2).toMatchObject({ added: 1, updated: 1, unchanged: 1, removed: 0 });
    expect(await count()).toBe(4);
    expect(await version()).toBeGreaterThan(v0);
    const audit = await db.query<{ action: string; source: string }>(`select action, source from public.audit_log where container_no='BBBU0000002' order by id`);
    expect(audit.rows).toEqual([{ action: 'insert', source: 'import' }, { action: 'update', source: 'import' }]);
  });

  it('replace: removes absent containers except protected (invalid-row) ones', async () => {
    const b = await as(EDITOR, () => importRows([row('AAAU0000001'), row('EEEU0000005')], 'replace', ['CCCU0000003']));
    expect(b).toMatchObject({ added: 1, updated: 0, unchanged: 1, removed: 2 });
    const nos = (await db.query<{ container_no: string }>('select container_no from public.containers order by 1')).rows.map((r) => r.container_no);
    expect(nos).toEqual(['AAAU0000001', 'CCCU0000003', 'EEEU0000005']);
  });

  it('refuses an empty payload (would wipe inventory)', async () => {
    await expect(as(EDITOR, () => importRows([], 'replace'))).rejects.toThrow(/no valid rows/);
    expect(await count()).toBe(3);
  });

  it('rolls back EVERYTHING when any row fails (no partial import, no history row)', async () => {
    const before = await db.query('select * from public.containers order by container_no');
    const batches = (await db.query('select count(*)::int n from public.import_batches')).rows;
    const bad = [row('FFFU0000006'), row('AAAU0000001', 'AV'), { ...row('GGGU0000007'), grade: '' }];
    await expect(as(EDITOR, () => importRows(bad, 'replace'))).rejects.toThrow(/check constraint/);
    const after = await db.query('select * from public.containers order by container_no');
    expect(after.rows).toEqual(before.rows);
    expect((await db.query('select count(*)::int n from public.import_batches')).rows).toEqual(batches);
  });

  it('rejects duplicates in the payload', async () => {
    await expect(as(EDITOR, () => importRows([row('AAAU0000001'), row('AAAU0000001')], 'merge'))).rejects.toThrow(/duplicate/);
  });

  it.skipIf(!existsSync('tests/fixtures/Stock now.xlsx'))('imports the full real workbook (7,397 rows) and re-import is all-unchanged', async () => {
    const wb = readWorkbook(readFileSync('tests/fixtures/Stock now.xlsx'));
    const rows = wb.sheets.Sheet.rows;
    const parsed = parseRows(rows, 0, autoMapColumns(rows[0]));
    const payload = parsed.valid.map(({ container_no, display_no, shipping_line, type, grade, size, condition }) => ({
      container_no, display_no, shipping_line, type, grade, size, condition,
    }));
    const t0 = Date.now();
    const b = await as(EDITOR, () => importRows(payload, 'replace'));
    const ms = Date.now() - t0;
    expect(b).toMatchObject({ added: 7397, removed: 3 });
    expect(await count()).toBe(7397);
    const b2 = await as(EDITOR, () => importRows(payload, 'replace'));
    expect(b2).toMatchObject({ added: 0, updated: 0, unchanged: 7397, removed: 0 });
    const ax = await as(VIEWER, () => db.query(`select shipping_line, type, grade, size, condition from public.containers where container_no='AXIU1498450'`));
    expect(ax.rows.length).toBe(1);
    console.log(`full import in PGlite: ${ms} ms; AXIU1498450 =`, ax.rows[0]);
  });
});

describe('002: admin / viewer roles', () => {
  const ADMIN = '44444444-4444-4444-4444-444444444444';
  const NEWBIE = '55555555-5555-5555-5555-555555555555';
  beforeAll(async () => {
    await db.exec(`insert into auth.users (id, email) values ('${ADMIN}', 'ega@sbs.test'), ('${NEWBIE}', 'new@sbs.test');
                   insert into public.authorized_users (user_id, role) values ('${ADMIN}', 'admin');`);
  });

  it('migration 002 is re-runnable', async () => {
    await db.exec(readFileSync('supabase/migrations/002_roles_admin.sql', 'utf8'));
  });

  it('new rows default to viewer (least privilege)', async () => {
    const r = await db.query<{ d: string }>(`select column_default d from information_schema.columns where table_name='authorized_users' and column_name='role'`);
    expect(r.rows[0].d).toMatch(/viewer/);
  });

  it('admin lists users, pending sign-ups first', async () => {
    const r = await as(ADMIN, () => db.query<{ user_id: string; role: string | null }>('select * from public.admin_list_users()'));
    expect(r.rows.length).toBeGreaterThanOrEqual(5);
    expect(r.rows[0].role).toBeNull();
    expect(r.rows.find((u) => u.user_id === NEWBIE)?.role).toBeNull();
  });

  it('viewers, editors and strangers cannot list or grant', async () => {
    for (const uid of [VIEWER, EDITOR, STRANGER, NEWBIE]) {
      await expect(as(uid, () => db.query('select * from public.admin_list_users()'))).rejects.toThrow(/Admins only/);
      await expect(as(uid, () => db.query(`select public.admin_set_role('${NEWBIE}', 'admin')`))).rejects.toThrow(/Admins only/);
    }
  });

  it('admin approves → viewer can read but not write; admin revokes → reads nothing', async () => {
    await as(ADMIN, () => db.query(`select public.admin_set_role('${NEWBIE}', 'viewer')`));
    const g = await db.query<{ role: string; granted_by: string }>(`select role, granted_by from public.authorized_users where user_id='${NEWBIE}'`);
    expect(g.rows[0]).toEqual({ role: 'viewer', granted_by: ADMIN });
    expect((await as(NEWBIE, () => db.query('select * from public.containers'))).rows.length).toBeGreaterThan(0);
    await expect(as(NEWBIE, () => importRows([row('NEWU0000009')], 'merge'))).rejects.toThrow(/Not authorized/);
    await as(ADMIN, () => db.query(`select public.admin_set_role('${NEWBIE}', null)`));
    expect((await as(NEWBIE, () => db.query('select * from public.containers'))).rows.length).toBe(0);
  });

  it('admin can import (admin ⊇ editor)', async () => {
    await expect(as(ADMIN, () => importRows([row('ADMU0000001')], 'merge'))).resolves.toMatchObject({ added: 1 });
  });

  it('admin cannot change their own role (no self-lockout) and rejects bad roles', async () => {
    await expect(as(ADMIN, () => db.query(`select public.admin_set_role('${ADMIN}', 'viewer')`))).rejects.toThrow(/own access/);
    await expect(as(ADMIN, () => db.query(`select public.admin_set_role('${NEWBIE}', 'superuser')`))).rejects.toThrow(/Invalid role/);
  });
});
