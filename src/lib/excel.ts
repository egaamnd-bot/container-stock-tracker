import * as XLSX from 'xlsx';
import { FIELD_KEYS, type FieldKey } from './types';
import {
  normalizeContainerNumber,
  normalizeField,
  isValidFormat,
  isCheckDigitValid,
} from './normalize';

export type MappingKey = 'container_no' | FieldKey;
export const MAPPING_KEYS: MappingKey[] = ['container_no', ...FIELD_KEYS];
export const MAPPING_LABELS: Record<MappingKey, string> = {
  container_no: 'Container number',
  shipping_line: 'Shipping line',
  type: 'Type',
  grade: 'Grade',
  size: 'Size',
  condition: 'Condition',
};

/** Column index per field; -1 = not mapped. */
export type ColumnMapping = Record<MappingKey, number>;

export interface SheetData {
  name: string;
  rows: string[][];
  /** 0-based Excel row index of rows[0] (sheets whose used range doesn't start at row 1). */
  rowOffset: number;
}

export interface WorkbookData {
  sheetNames: string[];
  sheets: Record<string, SheetData>;
}

export function readWorkbook(data: ArrayBuffer | Uint8Array): WorkbookData {
  const wb = XLSX.read(data, { type: 'array', cellDates: false, dense: true });
  const sheets: Record<string, SheetData> = {};
  for (const name of wb.SheetNames) {
    const ws = wb.Sheets[name];
    const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, {
      header: 1,
      raw: false, // formatted text: "40" stays "40", leading zeros kept
      defval: '',
      blankrows: true,
    });
    const rowOffset = ws['!ref'] ? XLSX.utils.decode_range(ws['!ref']).s.r : 0;
    sheets[name] = { name, rowOffset, rows: rows.map((r) => r.map((c) => (c === null || c === undefined ? '' : String(c)))) };
  }
  return { sheetNames: wb.SheetNames, sheets };
}

const SYNONYMS: Record<MappingKey, string[]> = {
  container_no: [
    'cont', 'container', 'container no', 'container number', 'container nbr', 'cont no', 'cont number',
    'cntr', 'cntr no', 'ctnr', 'ctnr no', 'container id', 'unit', 'unit no', 'unit number', 'equipment',
    'equipment no', 'equipment number', 'no container', 'nomor container', 'nomor kontainer', 'kontainer',
  ],
  shipping_line: [
    'shipping line', 'owner', 'line', 'operator', 'line operator', 'carrier', 'liner', 'sl', 'shipping',
    'shipping company', 'principal', 'pelayaran',
  ],
  type: ['type', 'cont type', 'container type', 'cntr type', 'iso type', 'tipe'],
  grade: ['grade', 'cont grade', 'container grade'],
  size: ['size', 'cont size', 'container size', 'cntr size', 'length', 'ukuran'],
  condition: ['condition', 'cond', 'cont condition', 'container condition', 'kondisi'],
};

export function normalizeHeader(h: string): string {
  return String(h ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Exact synonym matching only — no fuzzy "contains", so "Grade Remark" never maps to Grade. */
export function autoMapColumns(headers: string[]): ColumnMapping {
  const norm = headers.map(normalizeHeader);
  const mapping = Object.fromEntries(MAPPING_KEYS.map((k) => [k, -1])) as ColumnMapping;
  const used = new Set<number>();
  for (const key of MAPPING_KEYS) {
    // Earlier synonyms are stronger: iterate synonyms first, then columns.
    for (const syn of SYNONYMS[key]) {
      const idx = norm.findIndex((h, i) => h === syn && !used.has(i));
      if (idx >= 0) {
        mapping[key] = idx;
        used.add(idx);
        break;
      }
    }
  }
  return mapping;
}

/** Finds the header row: the row (within the first 30) that matches the most known column names. */
export function detectHeaderRow(rows: string[][]): number {
  let best = 0;
  let bestScore = -1;
  const limit = Math.min(rows.length, 30);
  for (let i = 0; i < limit; i++) {
    const m = autoMapColumns(rows[i] ?? []);
    const score = MAPPING_KEYS.filter((k) => m[k] >= 0).length;
    if (score > bestScore) {
      best = i;
      bestScore = score;
    }
  }
  return best;
}

export function missingMappings(mapping: ColumnMapping): MappingKey[] {
  return MAPPING_KEYS.filter((k) => mapping[k] < 0);
}

export interface ParsedRow {
  rowNumber: number; // 1-based Excel row number
  container_no: string;
  display_no: string;
  shipping_line: string;
  type: string;
  grade: string;
  size: string;
  condition: string;
  warnings: string[];
}

export interface InvalidRow {
  rowNumber: number;
  raw: string; // original container cell
  container_no: string; // normalized (may be empty / malformed)
  errors: string[];
}

export interface DuplicateGroup {
  container_no: string;
  rowNumbers: number[];
  conflicting: boolean; // true if the duplicate rows disagree on any field
}

export interface ParseResult {
  totalRows: number; // data rows after header, excluding fully empty rows
  emptyRows: number;
  valid: ParsedRow[];
  invalid: InvalidRow[];
  duplicates: DuplicateGroup[];
  warnings: number;
}

/**
 * Parses data rows under the header. Never silently drops anything:
 *  - fully blank rows are counted in `emptyRows`
 *  - bad rows go to `invalid` with reasons
 *  - identical duplicates keep the first occurrence and are reported
 *  - conflicting duplicates are ALL excluded (moved to invalid) and reported
 */
export function parseRows(rows: string[][], headerRow: number, mapping: ColumnMapping, rowOffset = 0): ParseResult {
  const missing = missingMappings(mapping);
  if (missing.length) {
    throw new Error(`Columns not mapped: ${missing.map((k) => MAPPING_LABELS[k]).join(', ')}`);
  }
  const candidates: ParsedRow[] = [];
  const invalid: InvalidRow[] = [];
  let emptyRows = 0;
  let totalRows = 0;

  for (let i = headerRow + 1; i < rows.length; i++) {
    const r = rows[i] ?? [];
    const rowNumber = i + 1 + rowOffset;
    if (r.every((c) => String(c ?? '').trim() === '')) {
      emptyRows++;
      continue;
    }
    totalRows++;
    const rawNo = String(r[mapping.container_no] ?? '');
    const container_no = normalizeContainerNumber(rawNo);
    const errors: string[] = [];
    const warnings: string[] = [];

    if (!container_no) errors.push('Container number is empty');
    else if (!isValidFormat(container_no)) errors.push(`"${rawNo.trim()}" is not a valid container number (expected 4 letters + 7 digits)`);
    else if (!isCheckDigitValid(container_no)) warnings.push('ISO 6346 check digit does not match — verify the number');

    const fields = {} as Record<FieldKey, string>;
    for (const key of FIELD_KEYS) {
      const raw = String(r[mapping[key]] ?? '');
      const v = normalizeField(raw);
      if (!v) errors.push(`${MAPPING_LABELS[key]} is empty`);
      else if (v !== raw.trim()) warnings.push(`${MAPPING_LABELS[key]} "${raw.trim()}" normalized to "${v}"`);
      fields[key] = v;
    }

    if (errors.length) {
      invalid.push({ rowNumber, raw: rawNo, container_no, errors });
      continue;
    }
    candidates.push({
      rowNumber,
      container_no,
      display_no: rawNo.replace(/\s+/g, ' ').trim().toUpperCase(),
      ...fields,
      warnings,
    });
  }

  // Duplicate detection on the normalized number.
  const groups = new Map<string, ParsedRow[]>();
  for (const row of candidates) {
    const g = groups.get(row.container_no);
    if (g) g.push(row);
    else groups.set(row.container_no, [row]);
  }
  const valid: ParsedRow[] = [];
  const duplicates: DuplicateGroup[] = [];
  for (const [no, g] of groups) {
    if (g.length === 1) {
      valid.push(g[0]);
      continue;
    }
    const first = g[0];
    const conflicting = g.some((x) => FIELD_KEYS.some((k) => x[k] !== first[k]));
    duplicates.push({ container_no: no, rowNumbers: g.map((x) => x.rowNumber), conflicting });
    if (conflicting) {
      for (const x of g) {
        invalid.push({
          rowNumber: x.rowNumber,
          raw: x.display_no,
          container_no: no,
          errors: [`Duplicate container with conflicting values (rows ${g.map((y) => y.rowNumber).join(', ')})`],
        });
      }
    } else {
      valid.push({ ...first, warnings: [...first.warnings, `Identical duplicate on rows ${g.slice(1).map((y) => y.rowNumber).join(', ')} ignored`] });
    }
  }
  valid.sort((a, b) => a.rowNumber - b.rowNumber);
  invalid.sort((a, b) => a.rowNumber - b.rowNumber);
  return {
    totalRows,
    emptyRows,
    valid,
    invalid,
    duplicates,
    warnings: valid.filter((v) => v.warnings.length).length,
  };
}
