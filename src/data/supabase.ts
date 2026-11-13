import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { RemoteBackend, ImportRequest, RemoteSnapshot } from './backend';
import { ConflictError } from './backend';
import type { ContainerRecord, ContainerFields, ImportBatch } from '../lib/types';

const URL = import.meta.env.VITE_SUPABASE_URL?.trim();
const KEY = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim();

export const isCloudConfigured = Boolean(URL && KEY);

let client: SupabaseClient | null = null;
export function getSupabase(): SupabaseClient | null {
  if (!isCloudConfigured) return null;
  client ??= createClient(URL!, KEY!, {
    auth: { persistSession: true, autoRefreshToken: true, storageKey: 'cst-auth' },
  });
  return client;
}

const COLS = 'container_no, display_no, shipping_line, type, grade, size, condition, updated_at';
const PAGE = 1000;

function fail(error: { message: string } | null, what: string): never | void {
  if (error) throw new Error(`${what}: ${error.message}`);
}

export class SupabaseBackend implements RemoteBackend {
  constructor(private sb: SupabaseClient) {}

  async fetchVersion(): Promise<number> {
    const { data, error } = await this.sb.from('inventory_state').select('version').eq('id', 1).maybeSingle();
    fail(error, 'Version check failed');
    return Number(data?.version ?? 0);
  }

  /** Downloads the whole inventory. Retries if the inventory changed mid-download (consistent snapshot). */
  async fetchSnapshot(): Promise<RemoteSnapshot> {
    for (let attempt = 0; attempt < 3; attempt++) {
      const v1 = await this.fetchVersion();
      const records: ContainerRecord[] = [];
      for (let from = 0; ; from += PAGE) {
        const { data, error } = await this.sb.from('containers').select(COLS).order('container_no').range(from, from + PAGE - 1);
        fail(error, 'Download failed');
        records.push(...((data ?? []) as ContainerRecord[]));
        if (!data || data.length < PAGE) break;
      }
      const v2 = await this.fetchVersion();
      if (v1 === v2) return { records, version: v2 };
    }
    throw new Error('Inventory kept changing during download. Try again in a moment.');
  }

  async insert(rec: Omit<ContainerRecord, 'updated_at'>): Promise<ContainerRecord> {
    const { data, error } = await this.sb.from('containers').insert(rec).select(COLS).single();
    if (error?.code === '23505') throw new Error(`Container ${rec.container_no} already exists.`);
    fail(error, 'Save failed');
    return data as ContainerRecord;
  }

  async update(no: string, fields: ContainerFields, expectedUpdatedAt: string): Promise<ContainerRecord> {
    const { data, error } = await this.sb
      .from('containers')
      .update(fields)
      .eq('container_no', no)
      .eq('updated_at', expectedUpdatedAt)
      .select(COLS);
    fail(error, 'Save failed');
    if (!data || data.length === 0) throw new ConflictError();
    return data[0] as ContainerRecord;
  }

  async remove(no: string, expectedUpdatedAt: string): Promise<void> {
    const { data, error } = await this.sb
      .from('containers')
      .delete()
      .eq('container_no', no)
      .eq('updated_at', expectedUpdatedAt)
      .select('container_no');
    fail(error, 'Delete failed');
    if (!data || data.length === 0) throw new ConflictError();
  }

  async applyImport(req: ImportRequest): Promise<ImportBatch> {
    const { data, error } = await this.sb.rpc('apply_import', {
      p_mode: req.mode,
      p_rows: req.rows,
      p_filename: req.filename,
      p_sheet_name: req.sheetName,
      p_total_rows: req.totalRows,
      p_invalid: req.invalid,
      p_duplicates: req.duplicates,
      p_protected: req.protectedNos,
    });
    fail(error, 'Import failed and was rolled back — no changes were made');
    return data as ImportBatch;
  }

  async logFailedImport(req: ImportRequest, message: string): Promise<void> {
    await this.sb.from('import_batches').insert({
      mode: req.mode,
      filename: req.filename,
      sheet_name: req.sheetName,
      total_rows: req.totalRows,
      invalid: req.invalid,
      duplicates: req.duplicates,
      status: 'failed',
      error: message.slice(0, 1000),
    });
  }

  async listImports(limit = 30): Promise<ImportBatch[]> {
    const { data, error } = await this.sb.from('import_batches').select('*').order('created_at', { ascending: false }).limit(limit);
    fail(error, 'Could not load import history');
    return (data ?? []) as ImportBatch[];
  }
}
