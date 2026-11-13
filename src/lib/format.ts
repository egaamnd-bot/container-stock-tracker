import { FIELD_KEYS, FIELD_LABELS, type ContainerRecord } from './types';

export function fieldsText(r: ContainerRecord): string {
  return FIELD_KEYS.map((k) => `${FIELD_LABELS[k]} : ${r[k]}`).join('\n');
}

export function fullText(r: ContainerRecord, asOf?: string | null): string {
  const lines = [`CONTAINER: ${r.container_no}`, '', fieldsText(r)];
  if (asOf) lines.push('', `Inventory as of: ${formatDateTime(asOf)}`);
  return lines.join('\n');
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString(undefined, { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function timeAgo(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return 'never';
  const s = Math.round((now - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86400)} d ago`;
}

export function n(x: number): string {
  return x.toLocaleString('en-US');
}
