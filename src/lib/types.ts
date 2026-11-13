export const FIELD_KEYS = ['shipping_line', 'type', 'grade', 'size', 'condition'] as const;
export type FieldKey = (typeof FIELD_KEYS)[number];

export const FIELD_LABELS: Record<FieldKey, string> = {
  shipping_line: 'Shipping line',
  type: 'Type',
  grade: 'Grade',
  size: 'Size',
  condition: 'Condition',
};

export interface ContainerRecord {
  /** Normalized number: uppercase, no whitespace/separators. Primary key. */
  container_no: string;
  /** Original formatting from the source (e.g. "AXIU 149 845 0"). Display only. */
  display_no: string;
  shipping_line: string;
  type: string;
  grade: string;
  size: string;
  condition: string;
  updated_at: string; // ISO timestamp
}

export type ContainerFields = Pick<ContainerRecord, FieldKey>;

export type ImportMode = 'replace' | 'merge';

export interface ImportBatch {
  id: string;
  created_at: string;
  mode: ImportMode;
  filename: string;
  sheet_name: string;
  total_rows: number;
  added: number;
  updated: number;
  unchanged: number;
  removed: number;
  invalid: number;
  duplicates: number;
  status: 'completed' | 'failed';
  error?: string | null;
}

export type SyncState =
  | 'local-only' // no Supabase configured: device is the database
  | 'synced' // online and cache == server version
  | 'syncing'
  | 'sync-required' // server has newer data than this device
  | 'sync-failed'
  | 'offline'; // no network: showing last synchronized snapshot
