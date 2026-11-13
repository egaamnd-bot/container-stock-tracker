/**
 * Builds seed/initial-inventory.csv from an Excel stock file using the app's own parser.
 * Usage: npx vite-node scripts/build-seed.ts -- "path/to/Stock now.xlsx"
 * The CSV columns match public.containers, so it can be loaded via Supabase Table Editor → Import CSV
 * (the in-app Import screen is the recommended path; this is a fallback).
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { readWorkbook, detectHeaderRow, autoMapColumns, parseRows, missingMappings } from '../src/lib/excel';

const file = process.argv.slice(2).find((a) => a !== '--') ?? 'tests/fixtures/Stock now.xlsx';
const wb = readWorkbook(readFileSync(file));
const sheet = wb.sheets[wb.sheetNames[0]];
const h = detectHeaderRow(sheet.rows);
const mapping = autoMapColumns(sheet.rows[h]);
const missing = missingMappings(mapping);
if (missing.length) throw new Error(`Could not detect columns: ${missing.join(', ')}`);
const res = parseRows(sheet.rows, h, mapping, sheet.rowOffset);

const esc = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
const lines = ['container_no,display_no,shipping_line,type,grade,size,condition'];
for (const r of res.valid) lines.push([r.container_no, r.display_no, r.shipping_line, r.type, r.grade, r.size, r.condition].map(esc).join(','));
mkdirSync('seed', { recursive: true });
writeFileSync('seed/initial-inventory.csv', lines.join('\n') + '\n');
const report = [
  `Source: ${file} (sheet "${sheet.name}", header row ${h + 1 + sheet.rowOffset})`,
  `Data rows: ${res.totalRows}  Valid: ${res.valid.length}  Invalid: ${res.invalid.length}  Duplicates: ${res.duplicates.length}  Empty: ${res.emptyRows}`,
  ...res.invalid.map((r) => `INVALID row ${r.rowNumber}: "${r.raw}" — ${r.errors.join('; ')}`),
  ...res.valid.filter((v) => v.warnings.length).map((v) => `WARNING row ${v.rowNumber}: ${v.container_no} — ${v.warnings.join('; ')}`),
];
writeFileSync('seed/initial-inventory-report.txt', report.join('\n') + '\n');
console.log(report.join('\n'));
