import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import * as XLSX from 'xlsx';
import { readWorkbook, detectHeaderRow, autoMapColumns, parseRows, missingMappings, type WorkbookData } from '../../src/lib/excel';
import { computeImportPlan } from '../../src/lib/diff';
import type { ContainerRecord } from '../../src/lib/types';

const REAL = 'tests/fixtures/Stock now.xlsx';

function toBuffer(aoa: unknown[][], sheet = 'Sheet1'): Uint8Array {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), sheet);
  return XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as Uint8Array;
}
const toRecord = (r: { container_no: string; display_no: string; shipping_line: string; type: string; grade: string; size: string; condition: string }): ContainerRecord => ({
  container_no: r.container_no, display_no: r.display_no, shipping_line: r.shipping_line, type: r.type, grade: r.grade,
  size: r.size, condition: r.condition, updated_at: '2026-11-12T00:00:00Z',
});

const HAS_REAL = existsSync(REAL); // private data: present locally, absent in the public repo/CI

describe.skipIf(!HAS_REAL)('real workbook: Stock now.xlsx', () => {
  let wb: WorkbookData;
  beforeAll(() => {
    wb = readWorkbook(readFileSync(REAL));
  });

  it('has one sheet named "Sheet" with headers on row 1', () => {
    expect(wb.sheetNames).toEqual(['Sheet']);
    expect(detectHeaderRow(wb.sheets.Sheet.rows)).toBe(0);
  });

  it('auto-maps Cont/Owner/Type/Grade/Size/Condition (and not "Grade Remark")', () => {
    const headers = wb.sheets.Sheet.rows[0];
    const m = autoMapColumns(headers);
    expect(missingMappings(m)).toEqual([]);
    expect(headers[m.container_no]).toBe('Cont');
    expect(headers[m.shipping_line]).toBe('Owner');
    expect(headers[m.type]).toBe('Type');
    expect(headers[m.grade]).toBe('Grade');
    expect(headers[m.size]).toBe('Size');
    expect(headers[m.condition]).toBe('Condition');
  });

  it('parses 7,397 valid containers; the footer total row is reported as invalid, not dropped', () => {
    const rows = wb.sheets.Sheet.rows;
    const res = parseRows(rows, 0, autoMapColumns(rows[0]));
    expect(res.valid.length).toBe(7397);
    expect(res.duplicates).toEqual([]);
    expect(res.invalid.length).toBe(1);
    expect(res.invalid[0].raw).toBe('7397');
    expect(res.invalid[0].rowNumber).toBe(7399);
  });

  it('finds AXIU1498450 and normalizes the lowercase grade "k"', () => {
    const rows = wb.sheets.Sheet.rows;
    const res = parseRows(rows, 0, autoMapColumns(rows[0]));
    const ax = res.valid.find((r) => r.container_no === 'AXIU1498450');
    expect(ax).toBeTruthy();
    expect(ax!.display_no).toBe('AXIU 149 845 0');
    expect(res.valid.every((r) => r.grade === r.grade.toUpperCase())).toBe(true);
    expect(res.valid.filter((r) => r.warnings.some((w) => w.startsWith('Grade'))).length).toBe(1);
  });

  it('first import into empty inventory = 7,397 added; re-import = all unchanged', () => {
    const rows = wb.sheets.Sheet.rows;
    const res = parseRows(rows, 0, autoMapColumns(rows[0]));
    const p1 = computeImportPlan(new Map(), res.valid, 'replace', res.invalid);
    expect(p1.counts).toMatchObject({ added: 7397, updated: 0, unchanged: 0, removed: 0 });
    const existing = new Map(res.valid.map((r) => [r.container_no, toRecord(r)]));
    const p2 = computeImportPlan(existing, res.valid, 'replace', res.invalid);
    expect(p2.counts).toMatchObject({ added: 0, updated: 0, unchanged: 7397, removed: 0 });
  });
});

describe('synthetic import scenarios', () => {
  const H = ['Owner', 'Cont', 'Size', 'Type', 'Grade', 'Condition'];

  it('reports missing columns', () => {
    const wb = readWorkbook(toBuffer([['Owner', 'Cont', 'Size'], ['MSL', 'AXIU 149 845 0', '40']]));
    const m = autoMapColumns(wb.sheets.Sheet1.rows[0]);
    expect(missingMappings(m)).toEqual(['type', 'grade', 'condition']);
    expect(() => parseRows(wb.sheets.Sheet1.rows, 0, m)).toThrow(/Columns not mapped: Type, Grade, Condition/);
  });

  it('detects a header row that is not the first row (title rows above)', () => {
    const wb = readWorkbook(toBuffer([['DAILY STOCK REPORT'], ['Printed 13-Nov'], [], H, ['MSL', 'AXIU 149 845 0', '40', 'HU', 'K', 'DM']]));
    expect(detectHeaderRow(wb.sheets.Sheet1.rows)).toBe(3);
  });

  it('counts empty rows, reports invalid rows, never silently drops anything', () => {
    const wb = readWorkbook(
      toBuffer([
        H,
        ['MSL', 'AXIU 149 845 0', '40', 'HU', 'K', 'DM'],
        [],
        ['', '', '', '', '', ''],
        ['MSL', 'BAD123', '40', 'HU', 'K', 'DM'],
        ['MSL', 'MSKU 123456 5', '20', 'GP', '', 'AV'],
        ['MSL', '', '20', 'GP', 'A', 'AV'],
      ]),
    );
    const rows = wb.sheets.Sheet1.rows;
    const res = parseRows(rows, 0, autoMapColumns(rows[0]));
    expect(res.valid.map((r) => r.container_no)).toEqual(['AXIU1498450']);
    expect(res.emptyRows).toBe(2);
    expect(res.totalRows).toBe(4);
    expect(res.invalid.map((r) => r.rowNumber)).toEqual([5, 6, 7]);
    expect(res.invalid[1].errors).toContain('Grade is empty');
  });

  it('identical duplicates keep one; conflicting duplicates are excluded and reported', () => {
    const wb = readWorkbook(
      toBuffer([
        H,
        ['MSL', 'AXIU 149 845 0', '40', 'HU', 'K', 'DM'],
        ['MSL', 'AXIU1498450', '40', 'HU', 'K', 'DM'],
        ['MSL', 'MSKU 123456 5', '20', 'GP', 'A', 'AV'],
        ['MSL', 'msku1234565', '20', 'GP', 'B', 'AV'],
      ]),
    );
    const rows = wb.sheets.Sheet1.rows;
    const res = parseRows(rows, 0, autoMapColumns(rows[0]));
    expect(res.valid.map((r) => r.container_no)).toEqual(['AXIU1498450']);
    expect(res.duplicates).toEqual([
      { container_no: 'AXIU1498450', rowNumbers: [2, 3], conflicting: false },
      { container_no: 'MSKU1234565', rowNumbers: [4, 5], conflicting: true },
    ]);
    expect(res.invalid.filter((i) => i.container_no === 'MSKU1234565').length).toBe(2);
  });

  it('warns (but imports) on a check-digit mismatch', () => {
    const wb = readWorkbook(toBuffer([H, ['MSL', 'AXIU 149 845 1', '40', 'HU', 'K', 'DM']]));
    const rows = wb.sheets.Sheet1.rows;
    const res = parseRows(rows, 0, autoMapColumns(rows[0]));
    expect(res.valid[0].warnings[0]).toMatch(/check digit/);
  });

  it('reads numeric cells (Size as a number) as text', () => {
    const wb = readWorkbook(toBuffer([H, ['MSL', 'AXIU 149 845 0', 40, 'HU', 'K', 'DM']]));
    const rows = wb.sheets.Sheet1.rows;
    expect(parseRows(rows, 0, autoMapColumns(rows[0])).valid[0].size).toBe('40');
  });

  it('supports manual mapping with unknown headers', () => {
    const wb = readWorkbook(toBuffer([['A', 'B', 'C', 'D', 'E', 'F'], ['AXIU 149 845 0', 'MSL', 'HU', 'K', '40', 'DM']]));
    const rows = wb.sheets.Sheet1.rows;
    expect(missingMappings(autoMapColumns(rows[0])).length).toBe(6);
    const res = parseRows(rows, 0, { container_no: 0, shipping_line: 1, type: 2, grade: 3, size: 4, condition: 5 });
    expect(res.valid[0]).toMatchObject({ container_no: 'AXIU1498450', shipping_line: 'MSL', size: '40' });
  });

  it('reports true Excel row numbers when the used range starts below row 1', () => {
    const ws = XLSX.utils.aoa_to_sheet([H, ['MSL', 'BAD', '40', 'HU', 'K', 'DM']], { origin: 'A5' } as unknown as XLSX.AOA2SheetOpts);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'S');
    const data = readWorkbook(XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as Uint8Array);
    const s = data.sheets.S;
    const h = detectHeaderRow(s.rows);
    const res = parseRows(s.rows, h, autoMapColumns(s.rows[h]), s.rowOffset);
    expect(res.invalid[0].rowNumber).toBe(6);
  });

  it('reads legacy .xls (BIFF8) files', () => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([H, ['MSL', 'AXIU 149 845 0', '40', 'HU', 'K', 'DM']]), 'Stock');
    const buf = XLSX.write(wb, { type: 'array', bookType: 'biff8' }) as Uint8Array;
    const data = readWorkbook(buf);
    expect(data.sheetNames).toEqual(['Stock']);
    expect(parseRows(data.sheets.Stock.rows, 0, autoMapColumns(data.sheets.Stock.rows[0])).valid.length).toBe(1);
  });
});

describe('computeImportPlan: replace vs merge', () => {
  const base = (no: string, condition = 'DM') => ({
    container_no: no, display_no: no, shipping_line: 'MSL', type: 'HU', grade: 'K', size: '40', condition,
  });
  const existing = new Map<string, ContainerRecord>(
    [base('AAAU0000001'), base('BBBU0000002'), base('CCCU0000003'), base('DDDU0000004')].map((r) => [r.container_no, toRecord(r)]),
  );
  const incoming = [
    { ...base('AAAU0000001'), rowNumber: 2, warnings: [] }, // unchanged
    { ...base('BBBU0000002', 'AV'), rowNumber: 3, warnings: [] }, // updated DM->AV
    { ...base('EEEU0000005'), rowNumber: 4, warnings: [] }, // new
  ];

  it('replace: adds, updates, removes absent records', () => {
    const p = computeImportPlan(existing, incoming, 'replace');
    expect(p.counts).toEqual({ added: 1, updated: 1, unchanged: 1, removed: 2, keptBecauseInvalid: 0 });
    expect(p.toUpdate[0].changes).toEqual([{ field: 'condition', from: 'DM', to: 'AV' }]);
    expect(p.toRemove.map((r) => r.container_no).sort()).toEqual(['CCCU0000003', 'DDDU0000004']);
  });

  it('merge: never removes', () => {
    const p = computeImportPlan(existing, incoming, 'merge');
    expect(p.counts).toEqual({ added: 1, updated: 1, unchanged: 1, removed: 0, keptBecauseInvalid: 0 });
  });

  it('replace: a container whose row is INVALID in the new file is kept, not deleted', () => {
    const invalid = [{ rowNumber: 9, raw: 'CCCU 000000 3', container_no: 'CCCU0000003', errors: ['Grade is empty'] }];
    const p = computeImportPlan(existing, incoming, 'replace', invalid);
    expect(p.toRemove.map((r) => r.container_no)).toEqual(['DDDU0000004']);
    expect(p.keptBecauseInvalid.map((r) => r.container_no)).toEqual(['CCCU0000003']);
  });
});

describe.skipIf(!HAS_REAL)('backup export round-trip', () => {
  it('an exported backup re-imports with zero changes', async () => {
    const { buildInventoryWorkbook } = await import('../../src/lib/export');
    const src = readWorkbook(readFileSync(REAL));
    const p = parseRows(src.sheets.Sheet.rows, 0, autoMapColumns(src.sheets.Sheet.rows[0]));
    const records = p.valid.map(toRecord);
    const wb = buildInventoryWorkbook(records, { note: 'test' });
    const back = readWorkbook(XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as Uint8Array);
    expect(back.sheetNames[0]).toBe('Inventory');
    const rows = back.sheets.Inventory.rows;
    const m = autoMapColumns(rows[detectHeaderRow(rows)]);
    expect(missingMappings(m)).toEqual([]);
    const re = parseRows(rows, 0, m);
    expect(re.invalid).toEqual([]);
    const plan = computeImportPlan(new Map(records.map((r) => [r.container_no, r])), re.valid, 'replace');
    expect(plan.counts).toMatchObject({ added: 0, updated: 0, removed: 0, unchanged: 7397 });
  });
});
