import type { ContainerRecord, ImportBatch, ImportMode, ContainerFields } from '../lib/types';
import type { ImportPlan } from '../lib/diff';

export interface ImportRequest {
  mode: ImportMode;
  filename: string;
  sheetName: string;
  totalRows: number;
  invalid: number;
  duplicates: number;
  plan: ImportPlan;
  /** Full list of valid rows in the file (server recomputes the diff authoritatively). */
  rows: Array<Pick<ContainerRecord, 'container_no' | 'display_no'> & ContainerFields>;
  /** Replace mode: numbers whose rows were invalid — must not be removed. */
  protectedNos: string[];
}

export interface RemoteSnapshot {
  records: ContainerRecord[];
  version: number;
}

/** Server-side operations. Only implemented for Supabase (cloud) mode. */
export interface RemoteBackend {
  fetchVersion(): Promise<number>;
  fetchSnapshot(): Promise<RemoteSnapshot>;
  insert(rec: Omit<ContainerRecord, 'updated_at'>): Promise<ContainerRecord>;
  update(no: string, fields: ContainerFields, expectedUpdatedAt: string): Promise<ContainerRecord>;
  remove(no: string, expectedUpdatedAt: string): Promise<void>;
  applyImport(req: ImportRequest): Promise<ImportBatch>;
  logFailedImport(req: ImportRequest, error: string): Promise<void>;
  listImports(limit?: number): Promise<ImportBatch[]>;
}

export class ConflictError extends Error {
  constructor(message = 'This record was changed on the server since you loaded it. Refresh and try again.') {
    super(message);
    this.name = 'ConflictError';
  }
}
