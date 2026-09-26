import { useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { request } from '../../core/api';
import { call, errorMessage } from '../../core/bridge';
import { toast } from '../../core/toasts';
import { Button, Modal, cx } from '../../components/ui';
import { Select } from '../../components/Select';

interface Column {
  index: number;
  name: string;
  sample: string[];
}
interface Field {
  key: string;
  label: string;
  required: boolean;
  read_only: boolean;
  example: string | null;
  help: string | null;
}
interface Inspected {
  columns: Column[];
  total: number;
  mapping: Record<string, number>;
  fields: Field[];
  required: string[];
}
interface Problem {
  row: number;
  field: string;
  label: string;
  value?: string;
  error?: string;
  warning?: string;
  fix?: string;
}
interface Checked {
  total: number;
  valid: number;
  invalid: number;
  warnings: number;
  errors: Problem[];
  warning_list: Problem[];
}
interface Done {
  created: number;
  updated: number;
  skipped: number;
  failed: number;
  errors: Problem[];
  job_id: number;
}

type Mode = 'upsert' | 'create' | 'update';
const MODES: Array<[Mode, string]> = [
  ['upsert', 'Update it'],
  ['create', 'Leave it alone'],
  ['update', 'Only update — add nothing new'],
];
const STEPS = ['Choose a file', 'Match the columns', 'Check', 'Done'];
/** What the server takes (DataController::MAX_BYTES). */
export const MAX_BYTES = 8 * 1024 * 1024;

async function post<T>(path: string, file: File, extra: Record<string, string> = {}): Promise<T> {
  const form = new FormData();
  form.append('file', file, file.name);
  for (const [k, v] of Object.entries(extra)) form.append(k, v);
  return (await request<T>('POST', path, { body: form })).data;
}

/**
 * Import contacts (ContactsImport): choose a file, match its columns to the
 * fields, check what would happen, then import; the rows that did not go in
 * can be downloaded with why. The server reads CSV and JSON, up to 2,000 rows.
 */
export function ImportWizard({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [over, setOver] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [sheet, setSheet] = useState<Inspected | null>(null);
  const [mapping, setMapping] = useState<Record<string, number>>({});
  const [mode, setMode] = useState<Mode>('upsert');
  const [checked, setChecked] = useState<Checked | null>(null);
  const [done, setDone] = useState<Done | null>(null);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const choose = (f: File | undefined) => {
    if (!f) return;
    if (f.size > MAX_BYTES) return setError('That file is larger than 8 MB.');
    void run(async () => {
      const r = await post<Inspected>('/api/data/contacts/inspect', f);
      setFile(f);
      setSheet(r);
      setMapping(r.mapping ?? {});
      setStep(1);
    });
  };

  const check = () =>
    void run(async () => {
      setChecked(await post<Checked>('/api/data/contacts/preview', file!, { mapping: JSON.stringify(mapping) }));
      setStep(2);
    });

  const importNow = () =>
    void run(async () => {
      const r = await post<Done>('/api/data/contacts/import', file!, { mapping: JSON.stringify(mapping), mode });
      setDone(r);
      setStep(3);
      void qc.invalidateQueries({ queryKey: ['contacts'] });
    });

  const download = async (what: { export: 'contacts-template' } | { importErrors: number }, name: string) => {
    try {
      await call('transfers:download', { ...what, name });
      toast('info', `Saving ${name} to your downloads…`);
    } catch (e) {
      toast('error', errorMessage(e));
    }
  };

  const fields = (sheet?.fields ?? []).filter((f) => !f.read_only);
  const missing = (sheet?.required ?? []).filter((k) => mapping[k] === undefined);
  const warnRows = new Set((checked?.warning_list ?? []).map((w) => w.row)).size;
  const problems = [...(checked?.errors ?? []).map((e) => ({ ...e, bad: true })), ...(checked?.warning_list ?? []).map((w) => ({ ...w, bad: false }))].sort((a, b) => a.row - b.row);
  const failedRows = done?.failed ?? 0;

  return (
    <Modal title="Import contacts" onClose={onClose} width={step === 1 ? 600 : step === 3 ? 480 : 560}>
      <div className="flex flex-col gap-2.5 text-[13px]">
        <ol aria-label="Steps" className="mb-1.5 flex flex-wrap gap-1.5">
          {STEPS.map((l, i) => (
            <li key={l} aria-current={i === step ? 'step' : undefined} className={cx('rounded-xl px-2.5 py-1 text-[11.5px] font-bold whitespace-nowrap', i === step ? 'bg-primary text-white' : i < step ? 'bg-success-bg text-success' : 'bg-subtle text-ink-2')}>
              {i + 1}. {l}
            </li>
          ))}
        </ol>

        {step === 0 ? (
          <>
            <button type="button" onClick={() => void download({ export: 'contacts-template' }, 'contacts-template.csv')} className="self-start text-[12.5px] font-semibold text-primary hover:underline">
              Download a template
            </button>
            <div
              onDragOver={(e) => (e.preventDefault(), setOver(true))}
              onDragLeave={() => setOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setOver(false);
                choose(e.dataTransfer.files[0]);
              }}
              className={cx('flex h-[120px] flex-col items-center justify-center gap-1 rounded-[12px] border-2 border-dashed', over ? 'border-primary bg-selection' : 'border-[#B8C2DA] bg-ground dark:border-line')}
            >
              <b className="text-ink">
                {busy ? 'Reading the file…' : (
                  <>
                    Drop a file here, or{' '}
                    <button type="button" onClick={() => input.current?.click()} className="font-bold text-primary hover:underline">choose one</button>
                  </>
                )}
              </b>
              <span className="text-[12px] text-ink-2">CSV, JSON, or a spreadsheet exported as either.</span>
            </div>
            <input ref={input} type="file" hidden accept=".csv,.json,.txt,text/csv,application/json" aria-label="File to import" onChange={(e) => (choose(e.target.files?.[0]), (e.target.value = ''))} />
          </>
        ) : null}

        {step === 1 && sheet ? (
          <>
            <span className="text-ink-2">
              {sheet.total.toLocaleString()} {sheet.total === 1 ? 'row' : 'rows'} found. These are matched already — change any that are wrong.
            </span>
            <div className="max-h-[360px] overflow-y-auto rounded-[9px] border border-line scroll-thin">
              <div className="sticky top-0 flex bg-ground px-2.5 py-[7px] text-[11px] font-bold tracking-[0.4px] text-ink-2 uppercase">
                <span className="w-[190px]">Field in WorkSuite</span>
                <span className="flex-1">Column in your file</span>
              </div>
              {fields.map((f) => {
                const col = mapping[f.key];
                const sample = col !== undefined ? sheet.columns.find((c) => c.index === col)?.sample.find((x) => x !== '') : undefined;
                return (
                  <div key={f.key} className="flex items-center border-t border-line/60 px-2.5 py-1.5">
                    <span className="flex w-[190px] flex-col pr-2">
                      <b className="text-[12.5px] text-ink">
                        {f.label}
                        {f.required ? <span className="text-danger"> *</span> : null}
                      </b>
                      {f.help ? <span className="text-[11px] text-ink-3">{f.help}</span> : null}
                    </span>
                    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <Select
                        aria-label={f.label}
                        value={col === undefined ? '' : String(col)}
                        onChange={(e) => {
                          const next = { ...mapping };
                          if (e.target.value === '') delete next[f.key];
                          else next[f.key] = Number(e.target.value);
                          setMapping(next);
                        }}
                        className="h-[30px] w-full rounded-[8px] border border-line bg-surface px-2 text-ink outline-none focus:border-primary"
                      >
                        <option value="">— not imported —</option>
                        {sheet.columns.map((c) => (
                          <option key={c.index} value={c.index}>{c.name}</option>
                        ))}
                      </Select>
                      {sample ? <span className="truncate text-[11px] text-ink-2">e.g. {sample}</span> : null}
                    </span>
                  </div>
                );
              })}
            </div>
            <b className="mt-1 text-ink">If a record already exists</b>
            <div role="radiogroup" aria-label="If a record already exists" className="flex flex-wrap gap-3.5">
              {MODES.map(([m, l]) => (
                <label key={m} className="flex cursor-pointer items-center gap-1.5 text-ink">
                  <input type="radio" name="mode" checked={mode === m} onChange={() => setMode(m)} className="accent-[var(--color-primary)]" />
                  {l}
                </label>
              ))}
            </div>
            {missing.length ? <p className="text-[12px] text-danger">Match a column to {missing.map((k) => fields.find((f) => f.key === k)?.label ?? k).join(', ')} first.</p> : null}
          </>
        ) : null}

        {step === 2 && checked ? (
          <>
            <div className="flex gap-2">
              {[
                [Math.max(0, checked.valid - warnRows), 'ready', 'bg-success-bg text-success'],
                [warnRows, 'warnings', 'bg-warning-bg text-warning'],
                [checked.invalid, 'will not import', 'bg-danger-bg text-danger'],
              ].map(([v, l, tone]) => (
                <div key={l as string} className={cx('flex-1 rounded-[9px] p-2.5', tone as string)}>
                  <div className="text-[20px] font-bold">{(v as number).toLocaleString()}</div>
                  <div className="text-[11.5px]">{l}</div>
                </div>
              ))}
            </div>
            {problems.length ? (
              <div className="max-h-[300px] overflow-y-auto rounded-[9px] border border-line scroll-thin">
                <div className="sticky top-0 flex bg-ground px-2.5 py-[7px] text-[11px] font-bold tracking-[0.4px] text-ink-2 uppercase">
                  <span className="w-[50px]">Row</span>
                  <span className="w-[110px]">Field</span>
                  <span className="flex-1">Problem</span>
                </div>
                {problems.map((p, i) => (
                  <div key={`${p.row}-${p.field}-${i}`} className="flex border-t border-line/60 px-2.5 py-[7px] text-[12.5px]">
                    <span className="w-[50px] font-mono">{p.row}</span>
                    <span className="w-[110px] pr-2 font-semibold break-words">{p.label || p.field || '—'}</span>
                    <span className={cx('flex-1', p.bad ? 'text-ink' : 'text-warning')}>
                      {p.error ?? p.warning}
                      {p.fix ? <span className="block text-success">{p.fix}</span> : null}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-ink-2">Every row reads cleanly.</p>
            )}
          </>
        ) : null}

        {step === 3 && done ? (
          <>
            <div className="grid grid-cols-4 gap-1.5">
              {(
                [
                  [done.created, 'created'],
                  [done.updated, 'updated'],
                  [done.skipped, 'skipped'],
                  [done.failed, 'failed'],
                ] as const
              ).map(([v, l]) => (
                <div key={l} className="rounded-[8px] bg-ground p-2 text-center">
                  <div className="text-[18px] font-bold text-ink">{v.toLocaleString()}</div>
                  <div className="text-[11px] text-ink-2">{l}</div>
                </div>
              ))}
            </div>
            {failedRows > 0 ? (
              <button type="button" onClick={() => void download({ importErrors: done.job_id }, `contacts-import-${done.job_id}-errors.csv`)} className="self-start text-[12.5px] font-semibold text-primary hover:underline">
                Download the {failedRows} {failedRows === 1 ? 'row' : 'rows'} that did not import
              </button>
            ) : null}
            <span className="text-[12px] text-ink-2">This run is in Import history as job #{done.job_id}{failedRows > 0 ? ', with the rows that failed and why' : ''}.</span>
          </>
        ) : null}

        {error ? <p role="alert" className="rounded-[8px] bg-danger-bg px-3 py-2 text-[12.5px] text-danger">{error}</p> : null}

        {step > 0 ? (
          <div className="mt-1 flex justify-end gap-2">
            {step === 3 ? (
              <Button variant="primary" onClick={onClose}>Close</Button>
            ) : (
              <>
                <Button disabled={busy} onClick={() => (setError(null), setStep(step - 1))}>Back</Button>
                {step === 1 ? (
                  <Button variant="primary" loading={busy} disabled={busy || missing.length > 0} onClick={check}>Check the file</Button>
                ) : (
                  <Button variant="primary" loading={busy} disabled={busy || !checked?.valid} onClick={importNow}>
                    Import {checked?.valid.toLocaleString()} {checked?.valid === 1 ? 'record' : 'records'}
                  </Button>
                )}
              </>
            )}
          </div>
        ) : null}
      </div>
    </Modal>
  );
}
