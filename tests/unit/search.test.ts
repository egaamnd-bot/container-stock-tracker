import { describe, it, expect } from 'vitest';
import { searchContainer, filterInventory, countBy } from '../../src/lib/search';
import type { ContainerRecord } from '../../src/lib/types';

const rec = (no: string, extra: Partial<ContainerRecord> = {}): ContainerRecord => ({
  container_no: no, display_no: no, shipping_line: 'MSL', type: 'HU', grade: 'K', size: '40', condition: 'DM',
  updated_at: '2026-11-13T00:00:00Z', ...extra,
});
const index = new Map<string, ContainerRecord>(
  [rec('AXIU1498450'), rec('AXIU1441136'), rec('MSKU1234565', { size: '20', type: 'GP' })].map((r) => [r.container_no, r]),
);

describe('searchContainer', () => {
  it('finds an existing container exactly', () => {
    const r = searchContainer(index, 'AXIU1498450');
    expect(r.kind).toBe('found');
    if (r.kind === 'found') expect(r.record.container_no).toBe('AXIU1498450');
  });
  it.each(['AXIU 1498450', 'AXIU 149 8450', 'AXIU149 8450', 'axiu1498450', ' AXIU\t149\n8450 '])('pasted/spaced "%s"', (q) => {
    const r = searchContainer(index, q);
    expect(r.kind).toBe('found');
  });
  it('returns not-found (no fake result) for a non-existing container', () => {
    const r = searchContainer(index, 'ZZZU0000000');
    expect(r.kind).toBe('not-found');
    if (r.kind === 'not-found') expect(r.suggestions).toEqual([]);
  });
  it('empty search returns empty', () => {
    expect(searchContainer(index, '   ').kind).toBe('empty');
    expect(searchContainer(index, '').kind).toBe('empty');
  });
  it('exact match wins — partial matches are never returned as the result', () => {
    // "AXIU" is a prefix of two records, but AXIU1498450 is an exact match for its own query.
    const r = searchContainer(index, 'AXIU1498450');
    expect(r.kind === 'found' && r.via).toBe('exact');
  });
  it('partial query yields labelled suggestions only, never a found result', () => {
    const r = searchContainer(index, 'AXIU');
    expect(r.kind).toBe('not-found');
    if (r.kind === 'not-found') expect(r.suggestions.length).toBe(2);
  });
  it('extracts a number from a pasted sentence', () => {
    const r = searchContainer(index, 'Please check container MSKU 123456 5 urgently');
    expect(r.kind === 'found' && r.via).toBe('extracted');
  });
  it('suggests the full number when the check digit was left off', () => {
    const r = searchContainer(index, 'AXIU149845');
    expect(r.kind).toBe('not-found');
    if (r.kind === 'not-found') expect(r.suggestions[0].container_no).toBe('AXIU1498450');
  });
});

describe('filterInventory / countBy', () => {
  const all = [...index.values()];
  it('filters by field and text', () => {
    expect(filterInventory(all, { text: '', shipping_line: '', type: 'GP', grade: '', size: '', condition: '' }).length).toBe(1);
    expect(filterInventory(all, { text: 'axiu 14', shipping_line: '', type: '', grade: '', size: '', condition: '' }).length).toBe(2);
  });
  it('counts', () => {
    expect(countBy(all, 'size')).toEqual([['40', 2], ['20', 1]]);
  });
});
