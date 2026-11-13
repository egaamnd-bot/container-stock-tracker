import { Copy, ClipboardCopy, Pencil, AlertTriangle } from 'lucide-react';
import { FIELD_KEYS, FIELD_LABELS, type ContainerRecord } from '../lib/types';
import { fieldsText, fullText, formatDateTime } from '../lib/format';
import { copyText, useToast } from '../state/ui';
import { Button, Card } from './ui';

export function ResultCard({ record, asOf, stale, onEdit, via }: { record: ContainerRecord; asOf: string | null; stale: boolean; onEdit?: () => void; via?: 'exact' | 'extracted' }) {
  const toast = useToast();
  const copy = async (text: string, what: string) => toast((await copyText(text)) ? `${what} copied` : 'Copy failed', 'success');
  return (
    <Card className="overflow-hidden border-green-300 dark:border-green-800" >
      <div data-testid="result-card" className="bg-green-50 dark:bg-green-950/40 px-4 py-3 border-b border-green-200 dark:border-green-900">
        <div className="text-xs font-semibold uppercase tracking-wide text-green-700 dark:text-green-400">Container found{via === 'extracted' ? ' (extracted from pasted text)' : ''}</div>
        <div className="font-mono text-2xl font-bold text-slate-900 dark:text-white tracking-wide" data-testid="result-container">{record.container_no}</div>
      </div>
      <dl className="divide-y divide-slate-100 dark:divide-slate-800">
        {FIELD_KEYS.map((k) => (
          <div key={k} className="flex items-center justify-between px-4 py-3">
            <dt className="text-slate-500 dark:text-slate-400 font-medium">{FIELD_LABELS[k]}</dt>
            <dd className="text-xl font-bold text-slate-900 dark:text-white tabular-nums" data-testid={`field-${k}`}>{record[k]}</dd>
          </div>
        ))}
      </dl>
      {stale && (
        <div className="mx-4 mb-3 flex gap-2 rounded-xl bg-amber-50 dark:bg-amber-950/40 px-3 py-2 text-xs text-amber-800 dark:text-amber-300">
          <AlertTriangle size={16} className="shrink-0" />
          <span>Offline copy as of {formatDateTime(asOf)}. Changes made since then are not shown.</span>
        </div>
      )}
      <div className="px-4 pb-1 text-xs text-slate-400">Record updated {formatDateTime(record.updated_at)}</div>
      <div className="grid grid-cols-2 gap-2 p-4 pt-2">
        <Button variant="secondary" onClick={() => copy(fieldsText(record), '5 fields')} data-testid="copy-fields">
          <Copy size={18} /> Copy fields
        </Button>
        <Button variant="secondary" onClick={() => copy(fullText(record, asOf), 'Container info')} data-testid="copy-all">
          <ClipboardCopy size={18} /> Copy all
        </Button>
        {onEdit && (
          <Button variant="ghost" className="col-span-2" onClick={onEdit}>
            <Pencil size={18} /> Edit record
          </Button>
        )}
      </div>
    </Card>
  );
}
