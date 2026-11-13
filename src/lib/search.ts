import type { ContainerRecord } from './types';
import { normalizeContainerNumber, extractContainerCandidates, computeCheckDigit } from './normalize';

export type SearchOutcome =
  | { kind: 'empty' }
  | { kind: 'found'; query: string; record: ContainerRecord; via: 'exact' | 'extracted' }
  | { kind: 'not-found'; query: string; suggestions: ContainerRecord[] };

/**
 * Exact normalized lookup first (O(1)). Only when there is NO exact match do we try:
 *   1. extracting a container number from pasted free text,
 *   2. a 10-character number missing its check digit,
 *   3. clearly-labelled "similar" suggestions (never presented as a result).
 */
export function searchContainer(index: Map<string, ContainerRecord>, rawQuery: string): SearchOutcome {
  const query = normalizeContainerNumber(rawQuery);
  if (!query) return { kind: 'empty' };

  const exact = index.get(query);
  if (exact) return { kind: 'found', query, record: exact, via: 'exact' };

  const candidates = extractContainerCandidates(rawQuery);
  for (const c of candidates) {
    const rec = index.get(c);
    if (rec) return { kind: 'found', query: c, record: rec, via: 'extracted' };
  }

  const suggestions: ContainerRecord[] = [];
  if (/^[A-Z]{4}\d{6}$/.test(query)) {
    const cd = computeCheckDigit(query);
    const rec = cd === null ? undefined : index.get(query + cd);
    if (rec) suggestions.push(rec);
  }
  if (query.length >= 4) {
    for (const rec of index.values()) {
      if (suggestions.length >= 5) break;
      if (rec.container_no !== suggestions[0]?.container_no && rec.container_no.includes(query)) suggestions.push(rec);
    }
  }
  return { kind: 'not-found', query, suggestions };
}

export interface InventoryFilter {
  text: string;
  shipping_line: string;
  type: string;
  grade: string;
  size: string;
  condition: string;
}

export type SortKey = 'container_no' | 'updated_at' | 'shipping_line' | 'size' | 'type';

export function filterInventory(
  records: ContainerRecord[],
  f: InventoryFilter,
  sort: SortKey = 'container_no',
  dir: 'asc' | 'desc' = 'asc',
): ContainerRecord[] {
  const q = normalizeContainerNumber(f.text);
  const out = records.filter(
    (r) =>
      (!q || r.container_no.includes(q)) &&
      (!f.shipping_line || r.shipping_line === f.shipping_line) &&
      (!f.type || r.type === f.type) &&
      (!f.grade || r.grade === f.grade) &&
      (!f.size || r.size === f.size) &&
      (!f.condition || r.condition === f.condition),
  );
  const mul = dir === 'asc' ? 1 : -1;
  out.sort((a, b) => {
    const c = String(a[sort]).localeCompare(String(b[sort]), undefined, { numeric: true });
    return c !== 0 ? c * mul : a.container_no.localeCompare(b.container_no);
  });
  return out;
}

export function countBy<K extends keyof ContainerRecord>(records: ContainerRecord[], key: K): [string, number][] {
  const m = new Map<string, number>();
  for (const r of records) m.set(String(r[key]), (m.get(String(r[key])) ?? 0) + 1);
  return [...m.entries()].sort((a, b) => b[1] - a[1]);
}
