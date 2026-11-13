import Dexie, { type Table } from 'dexie';
import type { ContainerRecord, ImportBatch } from '../lib/types';

export interface MetaRow {
  key: string;
  value: unknown;
}

export class StockDB extends Dexie {
  containers!: Table<ContainerRecord, string>;
  imports!: Table<ImportBatch, string>;
  meta!: Table<MetaRow, string>;

  constructor(name = 'container-stock-tracker') {
    super(name);
    this.version(1).stores({
      containers: '&container_no, shipping_line, type, grade, size, condition, updated_at',
      imports: '&id, created_at',
      meta: '&key',
    });
  }

  async getMeta<T>(key: string): Promise<T | undefined> {
    return (await this.meta.get(key))?.value as T | undefined;
  }
  async setMeta(key: string, value: unknown): Promise<void> {
    await this.meta.put({ key, value });
  }
}
