import * as XLSX from 'xlsx';
import type { ContainerRecord } from './types';
import type { InvalidRow, DuplicateGroup } from './excel';

export const EXPORT_HEADERS = ['Container', 'Shipping Line', 'Type', 'Grade', 'Size', 'Condition', 'Updated At', 'Original Number'];

export function inventoryToAoa(records: ContainerRecord[]): (string | number)[][] {
  const sorted = [...records].sort((a, b) => a.container_no.localeCompare(b.container_no));
  return [EXPORT_HEADERS, ...sorted.map((r) => [r.container_no, r.shipping_line, r.type, r.grade, r.size, r.condition, r.updated_at, r.display_no])];
}

/** Builds an .xlsx backup that can be re-imported by this app as-is. */
export function buildInventoryWorkbook(records: ContainerRecord[], meta: Record<string, string>): XLSX.WorkBook {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(inventoryToAoa(records));
  ws['!cols'] = [{ wch: 14 }, { wch: 13 }, { wch: 6 }, { wch: 6 }, { wch: 6 }, { wch: 10 }, { wch: 26 }, { wch: 18 }];
  XLSX.utils.book_append_sheet(wb, ws, 'Inventory');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Key', 'Value'], ...Object.entries(meta)]), 'Export info');
  return wb;
}

export function downloadWorkbook(wb: XLSX.WorkBook, filename: string) {
  XLSX.writeFile(wb, filename, { compression: true });
}

export function downloadCsv(records: ContainerRecord[], filename: string) {
  const ws = XLSX.utils.aoa_to_sheet(inventoryToAoa(records));
  const csv = XLSX.utils.sheet_to_csv(ws);
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export function buildIssuesWorkbook(invalid: InvalidRow[], duplicates: DuplicateGroup[], warnings: { rowNumber: number; container_no: string; warnings: string[] }[]): XLSX.WorkBook {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet([['Excel row', 'Container (as in file)', 'Normalized', 'Problems'], ...invalid.map((r) => [r.rowNumber, r.raw, r.container_no, r.errors.join('; ')])]),
    'Invalid rows',
  );
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet([['Container', 'Excel rows', 'Conflicting values?'], ...duplicates.map((d) => [d.container_no, d.rowNumbers.join(', '), d.conflicting ? 'YES — excluded' : 'No — first kept'])]),
    'Duplicates',
  );
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet([['Excel row', 'Container', 'Warnings'], ...warnings.map((w) => [w.rowNumber, w.container_no, w.warnings.join('; ')])]),
    'Warnings',
  );
  return wb;
}

export function stamp(d = new Date()): string {
  const p = (x: number) => String(x).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}
