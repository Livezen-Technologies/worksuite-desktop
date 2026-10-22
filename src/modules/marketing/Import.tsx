import { useQuery } from '@tanstack/react-query';
import { useRef, useState, type ReactNode } from 'react';
import { apiGet } from '../../core/api';
import { bytes, dateLabel } from '../../core/time';
import { toast } from '../../core/toasts';
import { Checkbox } from '../../components/Checkbox';
import { Icon } from '../../components/Icon';
import { Select } from '../../components/Select';
import { cx, Spinner } from '../../components/ui';
import { refreshMarketing, send, withOrg } from './api';
import { SAVE_REFUSED, saveServerFile, useMaySave } from './audience-files';
import { firstCompany, Refused, TABLE, TD, TH, useLists } from './audience-parts';
import { btn, btnPrimary, btnSmall, Card, Field, input, Kpi, n, PageHeader, Pill, type PillTone } from './parts';
import { companiesWhere, LAWFUL_BASIS, MATCH_WORD, peopleOf, refusal, type ImportCounts, type ImportPreview, type ImportProgress, type ImportRecord, type ImportRow, type LawfulBasis, type Options } from './types';

const STEPS = ['Upload', 'Map columns', 'Preview', 'Consent & lists', 'Import'] as const;
type Step = 1 | 2 | 3 | 4 | 5;

const FLAG: Record<string, string> = {
  invalid_email: 'address not valid', invalid_phone: 'number not valid', unknown_country: 'country not known',
  suppressed: 'suppressed', missing_consent: 'no consent said',
};

/**
 * Import contacts (DK05, the web's W05; MKT-IMP-01 – MKT-IMP-04): a
 * spreadsheet in, with nothing written until it has been looked at.
 *
 * The file goes to the server as it was saved — whatever Excel's code page,
 * whatever its separator — and comes back judged row by row: who is new, who
 * is already a contact and on which key they matched, who is in the file twice
 * and which row they merge into, and who cannot be imported and why. A "yes"
 * in a consent column never re-subscribes somebody who withdrew or is
 * suppressed; the server holds that line, and this screen says so. A file with
 * no consent column is imported with consent unknown unless a lawful basis is
 * chosen for the batch (MKT-IMP-03).
 */
export default function Import({ org, options }: { org: string; options: Options }) {
  const importers = companiesWhere(options, 'import');
  const maySave = useMaySave();
  const [chosen, setChosen] = useState('');
  const orgId = chosen || firstCompany(options, 'import', org);
  const company = importers.find((c) => String(c.id) === orgId) ?? null;
  const [step, setStep] = useState<Step>(1);
  const [file, setFile] = useState<File | null>(null);
  const [mapping, setMapping] = useState<string[] | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [checking, setChecking] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [existing, setExisting] = useState('fill');
  const [listId, setListId] = useState('');
  const [owner, setOwner] = useState('');
  const [tags, setTags] = useState('');
  const [basis, setBasis] = useState<'none' | 'granted'>('none');
  /* CON-01: the lawful basis the grants are recorded under. */
  const [lawful, setLawful] = useState<LawfulBasis>('consent');
  /* IMP-06: a large file runs in the background; its progress is followed here. */
  const [jobId, setJobId] = useState<number | null>(null);
  const [channels, setChannels] = useState<string[]>(['email']);
  const [done, setDone] = useState<{ message: string; counts: Partial<ImportCounts> } | null>(null);
  const [busy, setBusy] = useState(false);
  const picker = useRef<HTMLInputElement>(null);
  // Only the latest judgement counts: a column changed twice quickly must not show the first answer last.
  const asked = useRef(0);
  const lists = useLists(orgId);
  const history = useQuery({ queryKey: ['marketing', 'imports', org], queryFn: ({ signal }) => apiGet<{ items: ImportRecord[] }>('/api/marketing/imports', withOrg(org), signal) });
  const limits = options.import_limits;
  const c = preview?.counts ?? null;
  const shown = mapping ?? preview?.mapping ?? [];
  const noConsentColumn = preview !== null && !shown.some((m) => m.startsWith('consent_'));

  const form = (f: File, o: string, m: string[] | null, extra: Record<string, string> = {}) => {
    const fd = new FormData();
    fd.append('file', f);
    fd.append('org_id', o);
    if (m) fd.append('mapping', JSON.stringify(m));
    Object.entries(extra).forEach(([k, v]) => fd.append(k, v));
    return fd;
  };

  /* Judged again whenever the file, the company or a column's meaning changes — never written. */
  const judge = async (f: File, o: string, m: string[] | null) => {
    const mine = ++asked.current;
    setChecking(true);
    setProblem(null);
    try {
      const r = await send<ImportPreview>('POST', '/api/marketing/imports/preview', form(f, o, m));
      if (mine !== asked.current) return;
      setPreview(r.data);
      setMapping(r.data.mapping);
      setStep((s) => (s === 1 ? 2 : s));
    } catch (e) {
      if (mine !== asked.current) return;
      // A mapping the server refuses keeps the columns on screen, so the column at fault can be changed.
      setPreview((p) => (p ? { ...p, counts: null, sample: [] } : null));
      setProblem(refusal(e));
    } finally {
      if (mine === asked.current) setChecking(false);
    }
  };

  const choose = (f: File | null) => {
    asked.current++;
    setMapping(null);
    setPreview(null);
    setDone(null);
    if (f) setJobId(null);
    setProblem(null);
    setChecking(false);
    setStep(1);
    if (f && f.size > limits.bytes) {
      setFile(null);
      setProblem(`The file is larger than ${Math.round(limits.bytes / 1048576)} MB. Split it and import the parts.`);
      return;
    }
    setFile(f);
    if (f && orgId) void judge(f, orgId, null);
  };

  const reset = () => {
    choose(null);
    if (picker.current) picker.current.value = '';
  };

  const remap = (i: number, v: string) => {
    const next = shown.map((m, j) => (j === i ? v : m));
    setMapping(next);
    if (file) void judge(file, orgId, next);
  };

  const rejected = async () => {
    if (!file) return;
    try {
      const name = await saveServerFile({ method: 'POST', path: '/api/marketing/imports/rejected', body: form(file, orgId, shown) }, `${file.name.replace(/\.[^.]+$/, '')}-rejected.csv`);
      if (name) toast('success', `Saved ${name}.`);
    } catch (e) {
      toast('error', refusal(e));
    }
  };

  const commit = async () => {
    if (!file) return;
    setBusy(true);
    const opts = {
      existing, list_id: listId === '' ? null : Number(listId), owner_id: owner === '' ? null : Number(owner),
      tags: tags.split(',').map((t) => t.trim()).filter(Boolean),
      consent: basis, consent_channels: channels, lawful_basis: lawful,
    };
    try {
      const r = await send<{ counts?: ImportCounts; background?: boolean; id?: number } | null>('POST', '/api/marketing/imports', form(file, orgId, shown, { options: JSON.stringify(opts) }));
      toast('success', r.message ?? 'Imported.');
      await refreshMarketing();
      reset();
      if (r.data?.background && r.data.id) setJobId(r.data.id);
      else setDone({ message: r.message ?? 'Imported.', counts: r.data?.counts ?? {} });
    } catch (e) {
      toast('error', refusal(e));
    } finally {
      setBusy(false);
    }
  };

  const toAdd = c ? c.new + (existing === 'skip' ? 0 : c.existing) : 0;
  const canContinue = step === 1 ? false : step === 2 ? Boolean(c) : step === 3 ? Boolean(c) : step === 4 ? Boolean(c) && (basis === 'none' || channels.length > 0) : toAdd > 0;
  const next = () => (step === 5 ? void commit() : setStep((step + 1) as Step));

  if (importers.length === 0) {
    return (
      <div className="flex flex-col gap-3">
        <PageHeader crumbs={['Audience']} title="Import contacts" />
        <p className="m-0 text-[13px] text-ink-2">You may not import contacts in any of your companies.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        crumbs={['Audience']}
        title="Import contacts"
        sub={
          file
            ? `${file.name} · ${preview ? `${n(preview.rows)} rows · ` : ''}${bytes(file.size)} (limit ${Math.round(limits.bytes / 1048576)} MB / ${n(limits.rows)} rows)`
            : `A spreadsheet saved as CSV, up to ${n(limits.rows)} rows and ${Math.round(limits.bytes / 1048576)} MB. Nothing is written until you import what the check shows.`
        }
        actions={
          file ? (
            <>
              <button type="button" className={btn} onClick={reset}>
                Cancel
              </button>
              <button type="button" className={btnPrimary} disabled={!canContinue || checking || busy} onClick={next}>
                <Icon name={step === 5 ? 'upload' : 'chevron-right'} size={15} /> {step === 5 ? (busy ? 'Importing…' : 'Import') : 'Continue'}
              </button>
            </>
          ) : null
        }
      />

      <Stepper step={step} reached={preview ? (c ? 5 : 2) : 1} onStep={setStep} />

      {done ? (
        <p role="status" className="m-0 rounded-[10px] border border-success/30 bg-success-bg px-3 py-2 text-[13px] font-semibold text-success">
          {done.message}
          {(done.counts.duplicates ?? 0) + (done.counts.refused ?? 0) > 0 ? ` ${n((done.counts.duplicates ?? 0) + (done.counts.refused ?? 0))} rows were left out.` : ''}
        </p>
      ) : null}
      {jobId !== null ? <Background id={jobId} onEnd={() => void refreshMarketing()} /> : null}
      {problem ? <Refused error={null} fallback={problem} /> : null}

      {step === 1 ? (
        <Card title="Upload">
          <div className="flex flex-wrap items-end gap-3">
            {importers.length > 1 ? (
              <Field label="Into" className="w-[240px]">
                <Select<string> aria-label="Import into" value={orgId} placeholder="Which company?" onValueChange={(v) => (setChosen(v), setListId(''), setOwner(''), file ? void judge(file, v, null) : undefined)} options={importers.map((co) => ({ value: String(co.id), label: co.name }))} className={input} />
              </Field>
            ) : null}
            <input ref={picker} type="file" accept=".csv,text/csv,text/plain" aria-label="Spreadsheet" className="hidden" onChange={(e) => choose(e.target.files?.[0] ?? null)} />
            <button type="button" className={btn} disabled={orgId === ''} onClick={() => picker.current?.click()}>
              <Icon name="file-sheet" size={15} /> {file ? 'Choose another file' : 'Choose a CSV file'}
            </button>
            {file ? <span className="text-[13px] text-ink">{file.name}</span> : null}
            {checking ? <Working label="Checking the file…" /> : null}
          </div>
          <p className="m-0 mt-2.5 text-[12px] text-ink-3">The file is checked row by row against your contacts and the suppression list: email first, then the phone&apos;s last nine digits, then name at organisation.</p>
        </Card>
      ) : null}

      {step === 2 && preview ? (
        <Card title="Map columns" action={checking ? <Working label="Checking…" /> : null}>
          {preview.message && !c ? <p className="m-0 mb-2.5 text-[12.5px] text-[#9A4A06] dark:text-warning">{preview.message}</p> : null}
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {preview.columns.map((col, i) => (
              <div key={`${i}-${col}`} className="rounded-[10px] border border-line p-2.5">
                <span className="mb-1 block truncate text-[12px] font-semibold text-ink" title={col}>
                  {col || `Column ${i + 1}`}
                </span>
                <Select<string>
                  aria-label={`Column ${col || i + 1}`}
                  value={shown[i] ?? ''}
                  onValueChange={(v) => remap(i, v)}
                  options={[{ value: '', label: 'Leave out' }, ...options.import_targets, { value: `custom:${col || `Column ${i + 1}`}`, label: 'Keep as a custom field' }]}
                  className={input}
                />
              </div>
            ))}
          </div>
        </Card>
      ) : null}

      {step === 3 && preview && c ? (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Kpi label="New contacts" value={n(c.new)} sub={<span className="text-success">Will be created</span>} />
            <Kpi label="Updates" value={n(c.existing)} sub={existing === 'skip' ? 'Already here — left as they are' : 'Matched on email or phone'} />
            <Kpi label="Duplicates in file" value={n(c.duplicates)} tone={c.duplicates ? 'amber' : undefined} sub={<span className={c.duplicates ? 'text-[#9A4A06] dark:text-warning' : undefined}>Merged before import</span>} />
            <Kpi label="Rejected rows" value={n(c.refused)} tone={c.refused ? 'red' : undefined} sub={<span className={c.refused ? 'text-danger' : undefined}>Cannot be imported</span>} />
          </div>
          <p className="m-0 text-[12px] text-ink-3">
            {n(c.invalid_emails)} addresses not valid · {n(c.invalid_phones)} numbers not valid · {n(c.suppressed)} suppressed · {n(c.missing_consent)} with nothing said about consent
          </p>
          <Card
            title="Preview"
            padded={false}
            action={
              <button type="button" className={btnSmall} disabled={c.refused === 0 || !maySave} title={!maySave ? SAVE_REFUSED : c.refused === 0 ? 'No row is rejected' : 'Save the rejected rows, with why, as a CSV'} onClick={() => void rejected()}>
                <Icon name="download" size={14} />
                <span className="ml-1">Download rejected rows</span>
              </button>
            }
          >
            <PreviewTable rows={preview.sample} existing={existing} />
          </Card>
          {c.suppressed > 0 ? <p className="m-0 text-[12px] text-ink-2">Suppressed people are imported as they are — unsubscribed, or not to be called — and a consent column saying yes does not change that.</p> : null}
          {noConsentColumn ? <NoConsent /> : null}
        </>
      ) : null}

      {step === 4 && preview && c ? (
        <Card title="Consent & lists">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="People already here">
              <Select<string> aria-label="People already here" value={existing} onValueChange={setExisting} options={options.import_existing} className={input} />
            </Field>
            {company?.can.lists ? (
              <Field label="Put them on a list">
                <Select<string> aria-label="List" value={listId} onValueChange={setListId} options={[{ value: '', label: 'No list' }, ...(lists.data?.items ?? []).filter((l) => String(l.org_id) === orgId).map((l) => ({ value: String(l.id), label: l.name }))]} className={input} />
              </Field>
            ) : null}
            <Field label="Owner of the new contacts">
              <Select<string> aria-label="Owner" value={owner} onValueChange={setOwner} options={[{ value: '', label: 'Me' }, ...peopleOf(options, Number(orgId) || null)]} className={input} />
            </Field>
            <Field label="Tag everybody in the file" hint="Separated by commas.">
              <input className={input} value={tags} onChange={(e) => setTags(e.target.value)} placeholder="expo-2026, retail" />
            </Field>
          </div>
          <fieldset className="m-0 mt-3.5 flex flex-col gap-2 rounded-[10px] border border-line px-3 pt-1 pb-3">
            <legend className="px-1 text-[12.5px] font-semibold text-ink">Consent for this batch</legend>
            {noConsentColumn ? <p className="m-0 text-[12px] text-ink-3">The file has no consent column, so without a basis everybody in it is imported with consent unknown.</p> : <p className="m-0 text-[12px] text-ink-3">The file&apos;s consent columns are read row by row; a basis here fills only the rows that say nothing.</p>}
            <label className="flex items-start gap-2 text-[13px] text-ink">
              <input type="radio" name="basis" className="mt-1" checked={basis === 'none'} onChange={() => setBasis('none')} />
              <span>
                <b className="block">Leave consent unknown</b>
                <span className="text-[12px] text-ink-3">They are kept, but never mailed or called until consent is recorded.</span>
              </span>
            </label>
            <label className="flex items-start gap-2 text-[13px] text-ink">
              <input type="radio" name="basis" className="mt-1" checked={basis === 'granted'} onChange={() => setBasis('granted')} />
              <span>
                <b className="block">Everybody in this file agreed to be contacted</b>
                <span className="text-[12px] text-ink-3">Only when you hold their consent — they signed up, or opted in. It is recorded as this import&apos;s, and never overrides anybody who withdrew or is suppressed.</span>
              </span>
            </label>
            {basis === 'granted' ? (
              <div className="ml-6 flex flex-wrap gap-4 text-[13px] text-ink" role="group" aria-label="Agreed to">
                {[
                  ['email', 'By email'],
                  ['phone', 'By phone'],
                ].map(([v, label]) => (
                  <label key={v} className="flex items-center gap-2">
                    <Checkbox checked={channels.includes(v!)} onChange={(e) => setChannels(e.target.checked ? [...channels, v!] : channels.filter((x) => x !== v))} />
                    {label}
                  </label>
                ))}
              </div>
            ) : null}
          </fieldset>
          <Field label="Lawful basis for the consent in the file" className="mt-3 max-w-[320px]">
            <Select<string> aria-label="Lawful basis" value={lawful} onValueChange={(v) => setLawful(v as LawfulBasis)} options={(Object.keys(LAWFUL_BASIS) as LawfulBasis[]).map((k) => ({ value: k, label: LAWFUL_BASIS[k] }))} className={input} />
          </Field>
        </Card>
      ) : null}

      {step === 5 && preview && c ? (
        <Card title="Import">
          <ul className="m-0 flex list-none flex-col gap-1 p-0 text-[13px] text-ink">
            <li>
              <b>{n(c.new)}</b> new contacts will be created.
            </li>
            <li>{existing === 'skip' ? `${n(c.existing)} already here are left as they are.` : `${n(c.existing)} already here are updated (${options.import_existing.find((o) => o.value === existing)?.label.toLowerCase() ?? existing}).`}</li>
            <li>{n(c.duplicates + c.refused)} rows are left out: duplicates merge into the first row, rejected rows are not written.</li>
            <li>{basis === 'granted' ? `Consent is recorded as given by ${channels.join(' and ')} for rows that say nothing.` : 'Consent stays unknown for rows that say nothing.'}</li>
            {listId ? <li>Everybody goes on {lists.data?.items.find((l) => String(l.id) === listId)?.name ?? 'the chosen list'}.</li> : null}
          </ul>
          <div className="mt-3.5 flex items-center justify-end gap-3">
            <span className="text-[12px] text-ink-3">{n(toAdd)} to write</span>
            <button type="button" className={btnPrimary} disabled={busy || checking || toAdd === 0} onClick={() => void commit()}>
              <Icon name="upload" size={15} /> {busy ? 'Importing…' : 'Import'}
            </button>
          </div>
        </Card>
      ) : null}

      <Card title="Recent imports" padded={false}>
        {history.isLoading ? <Spinner /> : null}
        {history.error ? (
          <div className="px-4 pb-4">
            <Refused error={history.error} onRetry={() => void history.refetch()} />
          </div>
        ) : null}
        {history.data && history.data.items.length === 0 ? <p className="m-0 px-4 pb-4 text-[12.5px] text-ink-3">No imports yet.</p> : null}
        {history.data && history.data.items.length > 0 ? (
          <div className="overflow-x-auto scroll-thin">
            <table className={cx(TABLE, 'min-w-[640px]')}>
              <thead>
                <tr>
                  <th scope="col" className={cx(TH, 'pl-4')}>
                    File
                  </th>
                  {['Rows', 'Added', 'Updated', 'Left out'].map((h) => (
                    <th key={h} scope="col" className={cx(TH, 'text-right')}>
                      {h}
                    </th>
                  ))}
                  <th scope="col" className={TH}>
                    List
                  </th>
                  <th scope="col" className={cx(TH, 'pr-4')}>
                    When
                  </th>
                </tr>
              </thead>
              <tbody>
                {history.data.items.map((h) => (
                  <tr key={h.id}>
                    <td className={cx(TD, 'pl-4')}>
                      {h.file_name}
                      {h.status === 'failed' ? (
                        <span className="ml-1.5">
                          <Pill tone="red">stopped part way</Pill>
                        </span>
                      ) : h.status === 'running' || h.status === 'queued' ? (
                        <span className="ml-1.5">
                          <Pill tone="blue">{h.status === 'queued' ? 'waiting' : `running ${h.rows ? Math.floor(((h.rows_done ?? 0) * 100) / h.rows) : 0}%`}</Pill>
                        </span>
                      ) : h.status === 'cancelled' ? (
                        <span className="ml-1.5">
                          <Pill tone="amber">cancelled</Pill>
                        </span>
                      ) : null}
                    </td>
                    <td className={cx(TD, 'text-right tabular-nums')}>{n(h.rows)}</td>
                    <td className={cx(TD, 'text-right tabular-nums')}>{n(h.created)}</td>
                    <td className={cx(TD, 'text-right tabular-nums')}>{n(h.updated)}</td>
                    <td className={cx(TD, 'text-right tabular-nums')}>{n(h.skipped)}</td>
                    <td className={cx(TD, 'text-ink-2')}>{h.list?.name ?? '—'}</td>
                    <td className={cx(TD, 'pr-4 text-ink-2')}>
                      {dateLabel(h.created_at)}
                      {h.by ? ` · ${h.by}` : ''}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </Card>
    </div>
  );
}

/** A small "working" line beside a control, where a full spinner would push the page about. */
function Working({ label }: { label: string }) {
  return (
    <span role="status" className="flex items-center gap-1.5 text-[12.5px] text-ink-3">
      <Icon name="spinner" size={14} className="animate-spin-slow" /> {label}
    </span>
  );
}

/** Where the import is: the steps done (ticked, and a way back), the one being done, and those to come. */
function Stepper({ step, reached, onStep }: { step: Step; reached: number; onStep: (s: Step) => void }) {
  return (
    <ol aria-label="Import steps" className="m-0 flex list-none flex-wrap items-center gap-x-5 gap-y-2 rounded-[12px] border border-line bg-surface px-4 py-3">
      {STEPS.map((label, i) => {
        const s = (i + 1) as Step;
        const doneStep = s < step;
        const current = s === step;
        const body: ReactNode = (
          <>
            <span className={cx('flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full text-[11.5px] font-bold', doneStep || current ? 'bg-primary text-white' : 'bg-subtle text-ink-3')}>{doneStep ? <Icon name="check" size={13} /> : s}</span>
            <span className={cx('text-[13px] whitespace-nowrap', current ? 'font-bold text-primary' : doneStep ? 'font-semibold text-ink' : 'text-ink-3')}>{label}</span>
          </>
        );
        return (
          <li key={label} aria-current={current ? 'step' : undefined}>
            {s !== step && s <= reached && s > 1 ? (
              <button type="button" className="flex items-center gap-2 hover:underline" onClick={() => onStep(s)}>
                {body}
              </button>
            ) : (
              <span className="flex items-center gap-2">{body}</span>
            )}
          </li>
        );
      })}
    </ol>
  );
}

const MATCH_TONE: Record<string, PillTone> = { email_key: 'blue', phone_key: 'violet', name_org: 'blue' };

/** The first rows as the server judged them: which key matched, and what becomes of each. */
function PreviewTable({ rows, existing }: { rows: ImportRow[]; existing: string }) {
  if (rows.length === 0) return <p className="m-0 px-4 pb-4 text-[12.5px] text-ink-3">The server sent no rows to show.</p>;
  return (
    <div className="overflow-x-auto scroll-thin">
      <table className={cx(TABLE, 'min-w-[720px]')}>
        <caption className="sr-only">The first {rows.length} rows, as they would be imported</caption>
        <thead>
          <tr>
            <th scope="col" className={cx(TH, 'pl-4')}>
              Row
            </th>
            {['Name', 'Email', 'Phone', 'Match'].map((h) => (
              <th key={h} scope="col" className={TH}>
                {h}
              </th>
            ))}
            <th scope="col" className={cx(TH, 'pr-4')}>
              Result
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const [tone, word] = result(r, existing);
            const noticed = r.flags.map((f) => FLAG[f] ?? f).join('; ');
            return (
              <tr key={r.line}>
                <td className={cx(TD, 'pl-4 text-ink-3 tabular-nums')}>{r.line}</td>
                <td className={TD}>{r.label}</td>
                <td className={cx(TD, 'text-ink-2')}>{r.email ?? '—'}</td>
                <td className={cx(TD, 'text-ink-2')}>{r.phone ?? '—'}</td>
                <td className={TD}>
                  {r.match ? <Pill tone={MATCH_TONE[r.match] ?? 'blue'}>{MATCH_WORD[r.match] ?? r.match}</Pill> : r.outcome === 'duplicate' ? <Pill tone="amber">in-file dup</Pill> : <span className="text-ink-3">—</span>}
                </td>
                <td className={cx(TD, 'pr-4')}>
                  <Pill tone={tone}>{word}</Pill>
                  {noticed ? <span className="mt-0.5 block text-[11.5px] text-ink-3">{noticed}</span> : null}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function result(r: ImportRow, existing: string): [PillTone, string] {
  if (r.outcome === 'new') return ['green', 'New'];
  if (r.outcome === 'existing') return existing === 'skip' ? ['slate', 'Left as is'] : ['blue', 'Update'];
  if (r.outcome === 'duplicate') return ['amber', r.merged_into ? `Merged into row ${r.merged_into}` : 'Twice in the file'];
  return ['red', `Rejected${r.why ? ` · ${r.why.replace(/\.$/, '')}` : ''}`];
}

/** The design's warning when the file says nothing about consent (MKT-IMP-03). */
function NoConsent() {
  return (
    <Card tone="warning">
      <p className="m-0 flex items-start gap-2 text-[13px] text-ink">
        <Icon name="warning" size={17} className="mt-0.5 shrink-0 text-[#B45309] dark:text-warning" />
        <span>
          This file has <b>no consent column</b>. Contacts will be imported as <b>email: unknown</b> and <b>phone: unknown</b>, and are excluded from sends and call queues until consent is recorded. Choose a lawful basis on the next step.
        </span>
      </p>
    </Card>
  );
}

/**
 * A background import (MKT-IMP-06): its progress, read every two seconds
 * until it ends, and a Cancel that stops it between chunks — what is already
 * in stays in. Whoever started it is also told by notification.
 */
export function Background({ id, onEnd }: { id: number; onEnd: () => void }) {
  const [ended, setEnded] = useState(false);
  const q = useQuery({
    queryKey: ['marketing', 'import', id],
    queryFn: ({ signal }) => apiGet<ImportProgress>(`/api/marketing/imports/${id}`, undefined, signal),
    refetchInterval: ended ? false : 2000,
    retry: false,
  });
  const p = q.data;
  const live = p ? p.status === 'queued' || p.status === 'running' : true;
  if (p && !live && !ended) {
    setEnded(true);
    onEnd();
  }
  const stop = async () => {
    try {
      const r = await send('POST', `/api/marketing/imports/${id}/cancel`);
      toast('success', r.message ?? 'Stopping.');
      await q.refetch();
    } catch (e) {
      toast('error', refusal(e));
    }
  };
  return (
    <Card title="Importing in the background" action={live ? <button type="button" className={btnSmall} disabled={p?.cancel_requested} onClick={() => void stop()}>Cancel</button> : undefined}>
      {!p ? <Spinner /> : (
        <>
          <div className="h-2 overflow-hidden rounded-full bg-subtle" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={p.percent} aria-label="Import progress">
            <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${p.percent}%` }} />
          </div>
          <p role="status" className="m-0 mt-2 text-[13px] text-ink">
            {p.status === 'queued' ? 'Waiting to start…'
              : p.status === 'running' ? `${n(p.rows_done)} of ${n(p.rows)} rows${p.cancel_requested ? ' · stopping…' : ''}`
                : p.status === 'done' ? `Done: ${n(p.created)} added, ${n(p.updated)} updated.`
                  : p.status === 'cancelled' ? `Cancelled: ${n(p.created)} added, ${n(p.updated)} updated before it stopped.`
                    : `Stopped: ${p.error ?? 'the import failed'}.`}
          </p>
          <p className="m-0 mt-1 text-[11.5px] text-ink-3">You can leave this screen: you will be told when it is done.</p>
        </>
      )}
    </Card>
  );
}
