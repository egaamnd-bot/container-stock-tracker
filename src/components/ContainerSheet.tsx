import { useMemo, useState, useEffect } from 'react';
import { Trash2, Save, AlertTriangle } from 'lucide-react';
import { FIELD_KEYS, FIELD_LABELS, type ContainerRecord, type ContainerFields } from '../lib/types';
import { normalizeContainerNumber, isValidFormat, isCheckDigitValid } from '../lib/normalize';
import { countBy } from '../lib/search';
import { useStore, useStoreState } from '../state/StoreContext';
import { useToast } from '../state/ui';
import { Button, Sheet, inputCls } from './ui';
import { ConflictError } from '../data/backend';

const EMPTY: ContainerFields = { shipping_line: '', type: '', grade: '', size: '', condition: '' };

/** Create (record = null) or edit/delete an existing record. */
export function ContainerSheet({ open, record, onClose, initialNo = '' }: { open: boolean; record: ContainerRecord | null; onClose: () => void; initialNo?: string }) {
  const store = useStore();
  const state = useStoreState();
  const toast = useToast();
  const [no, setNo] = useState('');
  const [fields, setFields] = useState<ContainerFields>(EMPTY);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setNo(record?.container_no ?? initialNo);
    setFields(record ? { shipping_line: record.shipping_line, type: record.type, grade: record.grade, size: record.size, condition: record.condition } : EMPTY);
    setConfirmDelete(false);
    setErr(null);
  }, [open, record, initialNo]);

  // Suggestions from existing values = minimal typing on mobile.
  const options = useMemo(() => {
    const recs = store.records();
    return Object.fromEntries(FIELD_KEYS.map((k) => [k, countBy(recs, k).map(([v]) => v).slice(0, 30)])) as Record<keyof ContainerFields, string[]>;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, state.count]);

  const normNo = normalizeContainerNumber(no);
  const noWarning = !record && normNo && isValidFormat(normNo) && !isCheckDigitValid(normNo) ? 'Check digit does not match — double-check the number.' : null;
  const canEdit = store.canEdit();

  const save = async () => {
    setBusy(true);
    setErr(null);
    try {
      if (record) await store.updateRecord(record, fields);
      else await store.createRecord({ container_no: no, ...fields });
      toast(record ? 'Record updated' : 'Container added');
      onClose();
    } catch (e) {
      setErr(e instanceof ConflictError ? e.message : (e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const del = async () => {
    if (!record) return;
    setBusy(true);
    try {
      await store.deleteRecord(record);
      toast(`${record.container_no} deleted`);
      onClose();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet open={open} onClose={onClose} title={record ? `Edit ${record.container_no}` : 'Add container'}>
      {!canEdit && (
        <div className="mb-4 flex gap-2 rounded-xl bg-amber-50 dark:bg-amber-950/40 p-3 text-sm text-amber-800 dark:text-amber-300">
          <AlertTriangle size={18} className="shrink-0" /> You are offline. Editing is disabled until you reconnect.
        </div>
      )}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
        className="space-y-3"
      >
        <label className="block">
          <span className="text-sm font-medium text-slate-600 dark:text-slate-300">Container number</span>
          <input
            className={inputCls + ' font-mono uppercase'}
            value={no}
            onChange={(e) => setNo(e.target.value)}
            disabled={!!record}
            autoCapitalize="characters"
            autoComplete="off"
            spellCheck={false}
            placeholder="AXIU1498450"
            name="container_no"
          />
          {normNo && !record && <span className="text-xs text-slate-500">Saved as {normNo}</span>}
          {noWarning && <span className="block text-xs text-amber-700">{noWarning}</span>}
        </label>
        <div className="grid grid-cols-2 gap-3">
          {FIELD_KEYS.map((k) => (
            <label key={k} className="block">
              <span className="text-sm font-medium text-slate-600 dark:text-slate-300">{FIELD_LABELS[k]}</span>
              <input
                className={inputCls + ' uppercase'}
                list={`opts-${k}`}
                value={fields[k]}
                onChange={(e) => setFields((f) => ({ ...f, [k]: e.target.value }))}
                autoCapitalize="characters"
                autoComplete="off"
                name={k}
              />
              <datalist id={`opts-${k}`}>
                {options[k].map((v) => (
                  <option key={v} value={v} />
                ))}
              </datalist>
            </label>
          ))}
        </div>
        {err && <p className="text-sm text-red-600 whitespace-pre-line" role="alert">{err}</p>}
        <Button type="submit" className="w-full" disabled={busy || !canEdit}>
          <Save size={18} /> {record ? 'Save changes' : 'Add container'}
        </Button>
      </form>
      {record && (
        <div className="mt-6 pt-4 border-t border-slate-200 dark:border-slate-800">
          {!confirmDelete ? (
            <Button variant="ghost" className="w-full text-red-600 dark:text-red-400" onClick={() => setConfirmDelete(true)} disabled={!canEdit}>
              <Trash2 size={18} /> Delete container
            </Button>
          ) : (
            <div className="rounded-xl bg-red-50 dark:bg-red-950/40 p-3">
              <p className="text-sm text-red-800 dark:text-red-300 mb-3">
                Delete <b className="font-mono">{record.container_no}</b> from the inventory? {store.remote ? 'This is recorded in the audit log.' : ''}
              </p>
              <div className="grid grid-cols-2 gap-2">
                <Button variant="secondary" onClick={() => setConfirmDelete(false)}>Cancel</Button>
                <Button variant="danger" onClick={del} disabled={busy}>Delete</Button>
              </div>
            </div>
          )}
        </div>
      )}
    </Sheet>
  );
}
