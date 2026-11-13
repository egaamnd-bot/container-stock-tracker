import { useMemo, useRef, useState } from 'react';
import { FileSpreadsheet, Upload, AlertTriangle, CheckCircle2, Loader2, Download, RotateCcw, Replace, Merge, ShieldAlert } from 'lucide-react';
import { useStore, useStoreState } from '../state/StoreContext';
import { readWorkbook, detectHeaderRow, autoMapColumns, parseRows, missingMappings, MAPPING_KEYS, MAPPING_LABELS, type WorkbookData, type ColumnMapping, type ParseResult } from '../lib/excel';
import { computeImportPlan } from '../lib/diff';
import { FIELD_LABELS, type ImportBatch, type ImportMode } from '../lib/types';
import { buildIssuesWorkbook, downloadWorkbook, stamp } from '../lib/export';
import { n } from '../lib/format';
import { Button, Card, PageHeader, Stat, Sheet, selectCls, inputCls } from '../components/ui';

type Stage = 'pick' | 'review' | 'applying' | 'done';
type Tab = 'invalid' | 'duplicates' | 'added' | 'updated' | 'removed' | 'warnings';

export function ImportScreen() {
  const store = useStore();
  const state = useStoreState();
  const fileRef = useRef<HTMLInputElement>(null);
  const [stage, setStage] = useState<Stage>('pick');
  const [file, setFile] = useState<File | null>(null);
  const [wb, setWb] = useState<WorkbookData | null>(null);
  const [sheet, setSheet] = useState('');
  const [headerRow, setHeaderRow] = useState(0);
  const [mapping, setMapping] = useState<ColumnMapping | null>(null);
  const [mode, setMode] = useState<ImportMode>('replace');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('invalid');
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [typed, setTyped] = useState('');
  const [result, setResult] = useState<ImportBatch | null>(null);
  const [previewCounts, setPreviewCounts] = useState<ReturnType<typeof computeImportPlan>['counts'] | null>(null);

  const reset = () => {
    setStage('pick'); setFile(null); setWb(null); setSheet(''); setMapping(null); setError(null);
    setResult(null); setTyped(''); setConfirmOpen(false);
    if (fileRef.current) fileRef.current.value = '';
  };

  const selectSheet = (data: WorkbookData, name: string) => {
    const rows = data.sheets[name].rows;
    const h = detectHeaderRow(rows);
    setSheet(name);
    setHeaderRow(h);
    setMapping(autoMapColumns(rows[h] ?? []));
  };

  const onFile = async (f: File) => {
    setError(null);
    setLoading(true);
    setFile(f);
    try {
      await new Promise((r) => setTimeout(r, 30)); // let the spinner paint
      const data = readWorkbook(new Uint8Array(await f.arrayBuffer()));
      if (!data.sheetNames.length) throw new Error('The file has no worksheets.');
      setWb(data);
      // Pick the sheet that looks most like inventory.
      const best = [...data.sheetNames].sort((a, b) => {
        const score = (s: string) => { const rows = data.sheets[s].rows; const m = autoMapColumns(rows[detectHeaderRow(rows)] ?? []); return MAPPING_KEYS.filter((k) => m[k] >= 0).length * 1e6 + rows.length; };
        return score(b) - score(a);
      })[0];
      selectSheet(data, best);
      setStage('review');
    } catch (e) {
      setError(`Could not read "${f.name}": ${(e as Error).message}. Make sure it is an .xlsx or .xls Excel file.`);
      setFile(null);
    } finally {
      setLoading(false);
    }
  };

  const rows = wb && sheet ? wb.sheets[sheet].rows : [];
  const headers = rows[headerRow] ?? [];
  const missing = mapping ? missingMappings(mapping) : MAPPING_KEYS;
  const dupMapping = mapping ? MAPPING_KEYS.filter((k) => mapping[k] >= 0 && MAPPING_KEYS.some((j) => j !== k && mapping[j] === mapping[k])) : [];

  const parsed: ParseResult | null = useMemo(() => {
    if (!wb || !mapping || missing.length || dupMapping.length) return null;
    try {
      return parseRows(rows, headerRow, mapping, wb.sheets[sheet].rowOffset);
    } catch {
      return null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wb, sheet, headerRow, mapping]);

  const plan = useMemo(() => (parsed ? computeImportPlan(store.index, parsed.valid, mode, parsed.invalid) : null), [parsed, mode, store.index, state.rev]);
  const removalShare = plan && state.count ? plan.counts.removed / state.count : 0;
  const bigRemoval = mode === 'replace' && removalShare > 0.2;
  const needsTyped = mode === 'replace' && (plan?.counts.removed ?? 0) > 0;

  const apply = async () => {
    if (!parsed || !plan || !file) return;
    setConfirmOpen(false);
    setStage('applying');
    setError(null);
    setPreviewCounts(plan.counts);
    try {
      const batch = await store.applyImport({
        mode,
        filename: file.name,
        sheetName: sheet,
        totalRows: parsed.totalRows,
        invalid: parsed.invalid.length,
        duplicates: parsed.duplicates.length,
        plan,
        rows: parsed.valid.map(({ container_no, display_no, shipping_line, type, grade, size, condition }) => ({ container_no, display_no, shipping_line, type, grade, size, condition })),
        protectedNos: [...new Set(parsed.invalid.map((r) => r.container_no).filter(Boolean))],
      });
      setResult(batch);
      setStage('done');
    } catch (e) {
      setError((e as Error).message);
      setStage('review');
    }
  };

  const downloadIssues = () => {
    if (!parsed) return;
    downloadWorkbook(buildIssuesWorkbook(parsed.invalid, parsed.duplicates, parsed.valid.filter((v) => v.warnings.length)), `import-issues-${stamp()}.xlsx`);
  };

  const canEdit = store.canEdit();

  return (
    <div className="pb-28">
      <PageHeader title="Import Excel" right={stage !== 'pick' && stage !== 'applying' ? <Button variant="ghost" className="min-h-[40px] px-3" onClick={reset}><RotateCcw size={16} /> Start over</Button> : undefined} />
      <div className="px-4 pt-4 space-y-4">
        {!canEdit && (
          <Card className="p-4 flex gap-3 border-amber-300 bg-amber-50 dark:bg-amber-950/30">
            <AlertTriangle className="text-amber-600 shrink-0" />
            <p className="text-sm text-amber-800 dark:text-amber-300">You are offline. You can preview a file, but importing is disabled until you reconnect.</p>
          </Card>
        )}
        {error && (
          <Card className="p-4 flex gap-3 border-red-300 bg-red-50 dark:bg-red-950/30" >
            <AlertTriangle className="text-red-600 shrink-0" />
            <p className="text-sm text-red-800 dark:text-red-300 whitespace-pre-line" role="alert" data-testid="import-error">{error}</p>
          </Card>
        )}

        {stage === 'pick' && (
          <Card className="p-6 text-center">
            <div className="mx-auto w-14 h-14 rounded-2xl bg-brand-50 dark:bg-brand-700/20 flex items-center justify-center mb-3">
              <FileSpreadsheet className="text-brand-600" size={28} />
            </div>
            <p className="font-semibold text-slate-900 dark:text-white">Upload today's stock file</p>
            <p className="text-sm text-slate-500 mt-1 mb-5">.xlsx or .xls. Nothing changes until you review and confirm.</p>
            <input ref={fileRef} type="file" accept=".xlsx,.xls,.xlsm,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel" className="hidden" data-testid="file-input" onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />
            <Button className="w-full h-14" onClick={() => fileRef.current?.click()} disabled={loading}>
              {loading ? <Loader2 className="animate-spin" size={20} /> : <Upload size={20} />} {loading ? 'Reading file…' : 'Choose Excel file'}
            </Button>
            {state.lastImport && <p className="text-xs text-slate-400 mt-4">Last import: {state.lastImport.filename} · {new Date(state.lastImport.created_at).toLocaleString()}</p>}
          </Card>
        )}

        {stage === 'review' && wb && mapping && (
          <>
            <Card className="p-4 space-y-3">
              <div className="flex items-center gap-2 text-sm">
                <FileSpreadsheet size={18} className="text-green-600" />
                <span className="font-semibold truncate" data-testid="import-filename">{file?.name}</span>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <label className="block">
                  <span className="text-sm font-medium text-slate-600 dark:text-slate-300">Worksheet</span>
                  <select className={selectCls} value={sheet} onChange={(e) => selectSheet(wb, e.target.value)} data-testid="sheet-select">
                    {wb.sheetNames.map((s) => <option key={s} value={s}>{s} ({n(wb.sheets[s].rows.length)} rows)</option>)}
                  </select>
                </label>
                <label className="block">
                  <span className="text-sm font-medium text-slate-600 dark:text-slate-300">Header row</span>
                  <input type="number" min={1} max={Math.max(1, rows.length)} className={inputCls} value={headerRow + 1 + (wb.sheets[sheet].rowOffset ?? 0)}
                    onChange={(e) => { const h = Math.max(0, Number(e.target.value) - 1 - (wb.sheets[sheet].rowOffset ?? 0)); setHeaderRow(h); setMapping(autoMapColumns(rows[h] ?? [])); }} />
                </label>
              </div>
            </Card>

            <Card className="p-4">
              <h2 className="font-semibold text-slate-900 dark:text-white mb-1">Column mapping</h2>
              <p className="text-xs text-slate-500 mb-3">{missing.length ? 'Some columns could not be detected. Pick them manually.' : 'All columns detected automatically. Check they are right.'}</p>
              <div className="grid grid-cols-2 gap-3">
                {MAPPING_KEYS.map((k) => (
                  <label key={k} className="block">
                    <span className={`text-sm font-medium ${mapping[k] < 0 || dupMapping.includes(k) ? 'text-red-600' : 'text-slate-600 dark:text-slate-300'}`}>{MAPPING_LABELS[k]}</span>
                    <select className={selectCls} value={mapping[k]} onChange={(e) => setMapping({ ...mapping, [k]: Number(e.target.value) })} data-testid={`map-${k}`}>
                      <option value={-1}>— select column —</option>
                      {headers.map((h, i) => <option key={i} value={i}>{h || `(column ${i + 1})`}</option>)}
                    </select>
                  </label>
                ))}
              </div>
              {dupMapping.length > 0 && <p className="text-sm text-red-600 mt-2">Two fields are mapped to the same column.</p>}
            </Card>

            {parsed && plan && (
              <>
                <Card className="p-4">
                  <h2 className="font-semibold text-slate-900 dark:text-white mb-3">File check</h2>
                  <div className="grid grid-cols-3 gap-2" data-testid="file-check">
                    <Stat label="Total rows" value={n(parsed.totalRows)} />
                    <Stat label="Valid" value={n(parsed.valid.length)} tone="green" />
                    <Stat label="Invalid" value={n(parsed.invalid.length)} tone={parsed.invalid.length ? 'red' : 'default'} />
                    <Stat label="Duplicates" value={n(parsed.duplicates.length)} tone={parsed.duplicates.length ? 'amber' : 'default'} />
                    <Stat label="Warnings" value={n(parsed.warnings)} tone={parsed.warnings ? 'amber' : 'default'} />
                    <Stat label="Empty rows" value={n(parsed.emptyRows)} sub="skipped" />
                  </div>
                  {(parsed.invalid.length > 0 || parsed.duplicates.length > 0 || parsed.warnings > 0) && (
                    <Button variant="ghost" className="w-full mt-2 min-h-[40px]" onClick={downloadIssues}><Download size={16} /> Download issues report</Button>
                  )}
                </Card>

                <Card className="p-4">
                  <h2 className="font-semibold text-slate-900 dark:text-white mb-3">Import mode</h2>
                  <div className="grid grid-cols-2 gap-2">
                    {([['replace', Replace, 'Replace', 'New daily snapshot. Containers not in the file are removed.'], ['merge', Merge, 'Merge', 'Add & update only. Nothing is removed.']] as const).map(([m, Icon, label, desc]) => (
                      <button key={m} onClick={() => setMode(m)} data-testid={`mode-${m}`} className={`text-left rounded-xl border-2 p-3 ${mode === m ? 'border-brand-600 bg-brand-50 dark:bg-brand-700/20' : 'border-slate-200 dark:border-slate-700'}`}>
                        <div className="flex items-center gap-2 font-semibold text-slate-900 dark:text-white"><Icon size={18} /> {label}</div>
                        <p className="text-xs text-slate-500 mt-1">{desc}</p>
                      </button>
                    ))}
                  </div>
                </Card>

                <Card className="p-4">
                  <h2 className="font-semibold text-slate-900 dark:text-white mb-3">What will change</h2>
                  <div className="grid grid-cols-2 gap-2" data-testid="plan-counts">
                    <Stat label="New records" value={n(plan.counts.added)} tone="green" />
                    <Stat label="Updated records" value={n(plan.counts.updated)} tone="blue" />
                    <Stat label="Unchanged" value={n(plan.counts.unchanged)} />
                    <Stat label="Removed" value={n(plan.counts.removed)} tone={plan.counts.removed ? 'red' : 'default'} sub={mode === 'merge' ? 'merge never removes' : undefined} />
                  </div>
                  {plan.counts.keptBecauseInvalid > 0 && (
                    <p className="text-xs text-amber-700 dark:text-amber-400 mt-3">{n(plan.counts.keptBecauseInvalid)} existing container(s) have an invalid row in this file and will be <b>kept unchanged</b>, not removed.</p>
                  )}
                  {bigRemoval && (
                    <div className="mt-3 flex gap-2 rounded-xl bg-red-50 dark:bg-red-950/40 p-3 text-sm text-red-800 dark:text-red-300">
                      <ShieldAlert size={18} className="shrink-0" />
                      <span>This removes <b>{(removalShare * 100).toFixed(0)}%</b> of the current inventory. Make sure this is the full stock file, not a partial export.</span>
                    </div>
                  )}
                </Card>

                <Card className="overflow-hidden">
                  <div className="flex overflow-x-auto border-b border-slate-200 dark:border-slate-800 text-sm">
                    {([['invalid', parsed.invalid.length], ['duplicates', parsed.duplicates.length], ['added', plan.counts.added], ['updated', plan.counts.updated], ['removed', plan.counts.removed], ['warnings', parsed.warnings]] as [Tab, number][]).map(([t, c]) => (
                      <button key={t} onClick={() => setTab(t)} className={`px-3 py-3 whitespace-nowrap font-semibold capitalize border-b-2 ${tab === t ? 'border-brand-600 text-brand-700 dark:text-brand-100' : 'border-transparent text-slate-500'}`}>
                        {t} <span className="tabular-nums">({n(c)})</span>
                      </button>
                    ))}
                  </div>
                  <div className="max-h-80 overflow-y-auto text-sm divide-y divide-slate-100 dark:divide-slate-800">
                    <PreviewList tab={tab} parsed={parsed} plan={plan} />
                  </div>
                </Card>
              </>
            )}
          </>
        )}

        {stage === 'applying' && (
          <Card className="p-8 text-center" >
            <Loader2 className="mx-auto animate-spin text-brand-600" size={36} />
            <p className="font-semibold mt-3">Applying import…</p>
            <p className="text-sm text-slate-500 mt-1">This runs as a single transaction. If anything fails, nothing is changed.</p>
          </Card>
        )}

        {stage === 'done' && result && (
          <Card className="p-5" >
            <div className="flex items-center gap-2 text-green-700 dark:text-green-400 font-bold text-lg" data-testid="import-done"><CheckCircle2 /> Import complete</div>
            <p className="text-sm text-slate-500 mt-1">{result.filename} · {result.mode === 'replace' ? 'Replace' : 'Merge'} mode</p>
            <div className="grid grid-cols-2 gap-2 mt-4" data-testid="import-report">
              <Stat label="Total rows" value={n(result.total_rows)} />
              <Stat label="New records" value={n(result.added)} tone="green" />
              <Stat label="Updated records" value={n(result.updated)} tone="blue" />
              <Stat label="Unchanged records" value={n(result.unchanged)} />
              <Stat label="Invalid records" value={n(result.invalid)} tone={result.invalid ? 'red' : 'default'} />
              <Stat label="Removed records" value={n(result.removed)} tone={result.removed ? 'red' : 'default'} />
            </div>
            {previewCounts && (previewCounts.added !== result.added || previewCounts.updated !== result.updated || previewCounts.removed !== result.removed) && (
              <p className="text-xs text-amber-700 mt-3">Final counts differ from the preview because the inventory changed (e.g. another edit) between preview and import. The numbers above are what was actually applied.</p>
            )}
            <p className="text-sm text-slate-600 dark:text-slate-300 mt-4">Inventory now has <b>{n(state.count)}</b> containers.</p>
            <Button className="w-full mt-4" onClick={reset}>Done</Button>
          </Card>
        )}
      </div>

      {stage === 'review' && parsed && plan && (
        <div className="fixed inset-x-0 bottom-[calc(env(safe-area-inset-bottom)+68px)] z-30 px-4 pb-2">
          <Button className="w-full h-14 shadow-lg" variant={needsTyped ? 'danger' : 'primary'} disabled={!canEdit || parsed.valid.length === 0} onClick={() => { setTyped(''); setConfirmOpen(true); }} data-testid="review-confirm">
            {parsed.valid.length === 0 ? 'No valid rows to import' : `Review & confirm ${mode === 'replace' ? 'replace' : 'merge'}`}
          </Button>
        </div>
      )}

      <Sheet open={confirmOpen} onClose={() => setConfirmOpen(false)} title={mode === 'replace' ? 'Confirm replace' : 'Confirm merge'}>
        {plan && parsed && (
          <div className="space-y-4">
            <ul className="text-sm space-y-1.5 text-slate-700 dark:text-slate-200">
              <li>• <b>{n(plan.counts.added)}</b> new containers will be added</li>
              <li>• <b>{n(plan.counts.updated)}</b> containers will be updated</li>
              <li>• <b>{n(plan.counts.unchanged)}</b> unchanged</li>
              {mode === 'replace' && <li className={plan.counts.removed ? 'text-red-700 dark:text-red-400' : ''}>• <b>{n(plan.counts.removed)}</b> containers not in this file will be <b>removed</b></li>}
              {parsed.invalid.length > 0 && <li className="text-amber-700">• <b>{n(parsed.invalid.length)}</b> invalid rows will be skipped (listed in the report)</li>}
            </ul>
            {needsTyped && (
              <label className="block">
                <span className="text-sm font-medium">Type <b className="font-mono">REPLACE</b> to confirm removing {n(plan.counts.removed)} containers</span>
                <input className={inputCls + ' font-mono uppercase mt-1'} value={typed} onChange={(e) => setTyped(e.target.value)} autoCapitalize="characters" autoComplete="off" data-testid="confirm-typed" />
              </label>
            )}
            <div className="grid grid-cols-2 gap-2">
              <Button variant="secondary" onClick={() => setConfirmOpen(false)}>Cancel</Button>
              <Button variant={needsTyped ? 'danger' : 'success'} disabled={needsTyped && typed.trim().toUpperCase() !== 'REPLACE'} onClick={apply} data-testid="apply-import">
                Apply import
              </Button>
            </div>
          </div>
        )}
      </Sheet>
    </div>
  );
}

function PreviewList({ tab, parsed, plan }: { tab: Tab; parsed: ParseResult; plan: NonNullable<ReturnType<typeof computeImportPlan>> }) {
  const LIMIT = 200;
  const more = (total: number) => total > LIMIT && <div className="p-3 text-xs text-slate-400">Showing first {LIMIT} of {n(total)}. Download the issues report for the full list.</div>;
  const empty = <div className="p-4 text-slate-400">Nothing here.</div>;
  switch (tab) {
    case 'invalid':
      return parsed.invalid.length ? <>{parsed.invalid.slice(0, LIMIT).map((r) => (
        <div key={r.rowNumber} className="p-3"><div className="flex justify-between"><span className="font-mono font-semibold">{r.raw || '(blank)'}</span><span className="text-xs text-slate-400">row {r.rowNumber}</span></div><div className="text-xs text-red-600 mt-0.5">{r.errors.join(' · ')}</div></div>
      ))}{more(parsed.invalid.length)}</> : empty;
    case 'duplicates':
      return parsed.duplicates.length ? <>{parsed.duplicates.slice(0, LIMIT).map((d) => (
        <div key={d.container_no} className="p-3"><span className="font-mono font-semibold">{d.container_no}</span> <span className="text-xs text-slate-500">rows {d.rowNumbers.join(', ')}</span><div className={`text-xs ${d.conflicting ? 'text-red-600' : 'text-slate-500'}`}>{d.conflicting ? 'Conflicting values — all excluded' : 'Identical — first row kept'}</div></div>
      ))}{more(parsed.duplicates.length)}</> : empty;
    case 'added':
      return plan.toAdd.length ? <>{plan.toAdd.slice(0, LIMIT).map((r) => (
        <div key={r.container_no} className="p-3 flex justify-between"><span className="font-mono font-semibold">{r.container_no}</span><span className="text-xs text-slate-500">{r.shipping_line} · {r.size} {r.type} · {r.grade} · {r.condition}</span></div>
      ))}{more(plan.toAdd.length)}</> : empty;
    case 'updated':
      return plan.toUpdate.length ? <>{plan.toUpdate.slice(0, LIMIT).map((u) => (
        <div key={u.row.container_no} className="p-3"><span className="font-mono font-semibold">{u.row.container_no}</span><div className="text-xs text-slate-600 dark:text-slate-300">{u.changes.map((c) => `${FIELD_LABELS[c.field]}: ${c.from} → ${c.to}`).join(' · ')}</div></div>
      ))}{more(plan.toUpdate.length)}</> : empty;
    case 'removed':
      return plan.toRemove.length ? <>{plan.toRemove.slice(0, LIMIT).map((r) => (
        <div key={r.container_no} className="p-3 flex justify-between"><span className="font-mono font-semibold text-red-700 dark:text-red-400">{r.container_no}</span><span className="text-xs text-slate-500">{r.shipping_line} · {r.size} {r.type} · {r.condition}</span></div>
      ))}{more(plan.toRemove.length)}</> : empty;
    case 'warnings': {
      const w = parsed.valid.filter((v) => v.warnings.length);
      return w.length ? <>{w.slice(0, LIMIT).map((r) => (
        <div key={r.rowNumber} className="p-3"><div className="flex justify-between"><span className="font-mono font-semibold">{r.container_no}</span><span className="text-xs text-slate-400">row {r.rowNumber}</span></div><div className="text-xs text-amber-700">{r.warnings.join(' · ')}</div></div>
      ))}{more(w.length)}</> : empty;
    }
  }
}
