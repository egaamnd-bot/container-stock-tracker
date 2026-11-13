import { FIELD_KEYS, type ContainerRecord, type FieldKey, type ImportMode } from './types';
import type { ParsedRow } from './excel';

/** Minimal shape of an incoming row (ParsedRow satisfies it). */
export type IncomingRow = Pick<ParsedRow, 'container_no' | 'display_no' | FieldKey>;

export interface FieldChange {
  field: FieldKey;
  from: string;
  to: string;
}

export interface UpdatePlan<R extends IncomingRow = IncomingRow> {
  row: R;
  before: ContainerRecord;
  changes: FieldChange[];
}

export interface ImportPlan<R extends IncomingRow = IncomingRow> {
  mode: ImportMode;
  toAdd: R[];
  toUpdate: UpdatePlan<R>[];
  unchanged: R[];
  toRemove: ContainerRecord[];
  /** Replace mode only: existing containers kept because their row in the file was invalid. */
  keptBecauseInvalid: ContainerRecord[];
  counts: { added: number; updated: number; unchanged: number; removed: number; keptBecauseInvalid: number };
}

/**
 * Compares an incoming snapshot with the current inventory.
 * Replace mode removes containers absent from the file, EXCEPT ones whose row
 * exists in the file but failed validation — those are protected, because
 * "row was broken" is not evidence that the container left the depot.
 */
export function computeImportPlan<R extends IncomingRow>(
  existing: Map<string, ContainerRecord>,
  incoming: R[],
  mode: ImportMode,
  invalidRows: Array<{ container_no: string }> = [],
): ImportPlan<R> {
  const toAdd: R[] = [];
  const toUpdate: UpdatePlan<R>[] = [];
  const unchanged: R[] = [];
  const seen = new Set<string>();

  for (const row of incoming) {
    seen.add(row.container_no);
    const before = existing.get(row.container_no);
    if (!before) {
      toAdd.push(row);
      continue;
    }
    const changes: FieldChange[] = [];
    for (const f of FIELD_KEYS) {
      if (before[f] !== row[f]) changes.push({ field: f, from: before[f], to: row[f] });
    }
    if (changes.length) toUpdate.push({ row, before, changes });
    else unchanged.push(row);
  }

  const toRemove: ContainerRecord[] = [];
  const keptBecauseInvalid: ContainerRecord[] = [];
  if (mode === 'replace') {
    const protectedNos = new Set(invalidRows.map((r) => r.container_no).filter(Boolean));
    for (const [no, rec] of existing) {
      if (seen.has(no)) continue;
      if (protectedNos.has(no)) keptBecauseInvalid.push(rec);
      else toRemove.push(rec);
    }
  }

  return {
    mode,
    toAdd,
    toUpdate,
    unchanged,
    toRemove,
    keptBecauseInvalid,
    counts: {
      added: toAdd.length,
      updated: toUpdate.length,
      unchanged: unchanged.length,
      removed: toRemove.length,
      keptBecauseInvalid: keptBecauseInvalid.length,
    },
  };
}
