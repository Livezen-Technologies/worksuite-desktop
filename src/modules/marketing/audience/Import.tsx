import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useId, useRef, useState } from 'react';
import { ApiError } from '../../../core/api';
import { errorMessage } from '../../../core/bridge';
import { useTab } from '../../../core/tab-context';
import { toast } from '../../../core/toasts';
import { Checkbox } from '../../../components/Checkbox';
import { Icon } from '../../../components/Icon';
import { Select, type SelectOption } from '../../../components/Select';
import { Button, cx, ErrorNote, Spinner } from '../../../components/ui';
import {
  commitImport,
  fetchImport,
  MK,
  NOT_OFFERED,
  previewImport,
  rejectedRowsCsv,
  uploadImport,
  useLists,
  type Basis,
  type Channel,
  type ImportCommit,
  type ImportPreview,
  type ImportPreviewRow,
  type ImportResult,
  type ImportStatus,
  type ImportUpload,
} from '../api';
import { BASIS } from '../lib/consent';
import { assignField, checkFile, checkRows, dataRows, decodeCsv, fileSize, IMPORT_FIELDS, initialMapping, mapsContactKey, parseCsv, splitTags } from '../lib/csv';
import { count, maskPhone } from '../lib/format';
import { useMarketingOrg } from '../org';
import { Bar, Field, Input, Kpi, Loaded, Mono, Notice, PageBody, PageHeader, Pager, Panel, Planned, saveCsv, Status, TD, TH, Table, Tabs, useAction } from '../parts';

/**
 * DK05 · Import contacts (W05; MKT-IMP-01..06, MKT-AUD-02, AC-07; WF-03). Upload a CSV — refused here, before anything
 * is sent, when it is not a .csv, over 10 MB, not UTF-8 or over 10,000 rows — map its columns (the server remembers a
 * mapping per header set), read the preview of new, updated, duplicate-in-file and rejected rows with the key each
 * matched on (nothing is written yet), decide consent for the batch when the file has no consent column
 * (MKT-IMP-03: a lawful basis, or unknown on purpose), pick lists and tags, then import. A large import runs in the
 * background with its progress where the server reports it (MKT-IMP-06); suppressed people stay suppressed (AC-07).
 */
export default function Import() {
  // Cancel and "Import another file" start over with nothing kept.
  const [attempt, setAttempt] = useState(0);
  return <Flow key={attempt} restart={() => setAttempt((a) => a + 1)} />;
}

type Step = 1 | 2 | 3 | 4 | 5;

const STEPS: Array<{ n: Step; label: string }> = [
  { n: 1, label: 'Upload' },
  { n: 2, label: 'Map columns' },
  { n: 3, label: 'Preview' },
  { n: 4, label: 'Consent & lists' },
  { n: 5, label: 'Import' },
];

/** The batch's consent for one channel: a lawful basis, or unknown on purpose; nothing until the person picks. */
interface Decision {
  mode: 'basis' | 'unknown' | null;
  basis: Basis | '';
}

const UNDECIDED: Decision = { mode: null, basis: '' };

const decided = (d: Decision) => d.mode === 'unknown' || (d.mode === 'basis' && d.basis !== '');

function batchConsent(email: Decision, phone: Decision): NonNullable<ImportCommit['consent']> {
  return {
    email: email.mode === 'basis' && email.basis ? { state: 'subscribed', basis: email.basis } : { state: 'unknown', basis: 'unknown' },
    phone: phone.mode === 'basis' && phone.basis ? { state: 'consented', basis: phone.basis } : { state: 'unknown', basis: 'unknown' },
  };
}

function readBytes(file: File): Promise<ArrayBuffer> {
  if (typeof file.arrayBuffer === 'function') return file.arrayBuffer();
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as ArrayBuffer);
    r.onerror = () => reject(r.error ?? new Error('This file could not be read.'));
    r.readAsArrayBuffer(file);
  });
}

function Flow({ restart }: { restart: () => void }) {
  const org = useMarketingOrg();
  const [busy, run] = useAction();
  const [step, setStep] = useState<Step>(1);
  const [picked, setPicked] = useState<{ name: string; size: number; rows: number | null } | null>(null);
  const [refusal, setRefusal] = useState<{ text: string; sent: boolean } | null>(null);
  const [phase, setPhase] = useState<'reading' | 'uploading' | null>(null);
  const [upload, setUpload] = useState<ImportUpload | null>(null);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [remembered, setRemembered] = useState(false);
  const [email, setEmail] = useState<Decision>(UNDECIDED);
  const [phone, setPhone] = useState<Decision>(UNDECIDED);
  const [listIds, setListIds] = useState<number[]>([]);
  const [newList, setNewList] = useState('');
  const [tags, setTags] = useState('');
  const [committed, setCommitted] = useState<ImportStatus | null>(null);

  // WF-03 step 3: the preview writes nothing; asked again only when the mapping changes.
  const preview = useQuery({
    queryKey: ['marketing', 'import', org, upload?.id ?? 0, 'preview', mapping],
    queryFn: () => (upload ? previewImport(upload.id, mapping) : Promise.reject(new Error('No file is uploaded.'))),
    enabled: !!upload && (step === 3 || step === 4),
    staleTime: Infinity,
  });
  const p = preview.data;
  const hasConsent = p?.has_consent_column ?? false;

  /** WF-03 step 1: limits and encoding are checked before anything is sent; then the file goes up. */
  const choose = async (file: File | null | undefined) => {
    if (!file || phase) return;
    setRefusal(null);
    setUpload(null);
    setPicked({ name: file.name, size: file.size, rows: null });
    const bad = checkFile(file);
    if (bad) {
      setRefusal({ text: bad, sent: false });
      return;
    }
    setPhase('reading');
    try {
      const decoded = decodeCsv(new Uint8Array(await readBytes(file)));
      if (decoded.error !== null) {
        setRefusal({ text: decoded.error, sent: false });
        return;
      }
      const rows = dataRows(parseCsv(decoded.text)).length;
      setPicked({ name: file.name, size: file.size, rows });
      const tooMany = checkRows(rows);
      if (tooMany) {
        setRefusal({ text: tooMany, sent: false });
        return;
      }
      setPhase('uploading');
      const up = await uploadImport(org, file);
      setUpload(up);
      setRemembered(up.headers.some((h) => !!up.mapping?.[h]));
      setMapping(initialMapping(up.headers, up.mapping));
      setStep(2);
    } catch (e) {
      setRefusal({ text: e instanceof ApiError && e.forbidden ? `You don’t have permission to import contacts. ${e.message}` : errorMessage(e), sent: true });
    } finally {
      setPhase(null);
    }
  };

  const ready =
    step === 1 ? !!upload && !phase : step === 2 ? mapsContactKey(mapping) : step === 3 ? !!p && p.new + p.updated > 0 : step === 4 ? !!p && (hasConsent || (decided(email) && decided(phone))) : false;

  /** WF-03 step 7: rows are written in one job, on confirm. */
  const commit = () =>
    run('commit', async () => {
      if (!upload) return;
      const status = await commitImport(upload.id, { consent: hasConsent ? null : batchConsent(email, phone), list_ids: listIds, new_list: newList.trim() || null, tags: splitTags(tags) });
      setCommitted(status);
      setStep(5);
    });

  const next = () => {
    if (!ready) return;
    if (step === 4) void commit();
    else setStep((s) => (s < 5 ? ((s + 1) as Step) : s));
  };

  const rows = upload?.rows ?? picked?.rows ?? null;
  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader
        crumb="Marketing / Audience"
        title="Import contacts"
        sub={
          picked
            ? `${picked.name} · ${rows === null ? '' : `${count(rows)} rows · `}${fileSize(picked.size)} (limit 10 MB / 10,000 rows)`
            : 'CSV up to 10 MB / 10,000 rows. Nothing is written until you have seen the preview.'
        }
        actions={
          step < 5 ? (
            <>
              <Button variant="ghost" disabled={busy === 'commit'} onClick={restart}>
                Cancel
              </Button>
              <Button variant="primary" icon={step === 4 ? 'upload' : 'chevron-right'} disabled={!ready} loading={busy === 'commit'} onClick={next}>
                {step === 4 ? 'Import' : 'Continue'}
              </Button>
            </>
          ) : null
        }
      />
      <PageBody>
        <div className="mx-auto flex max-w-[1100px] flex-col gap-4">
          <Stepper step={step} onBack={step < 5 && busy !== 'commit' && !phase ? setStep : null} />
          {step === 1 ? (
            <Upload phase={phase} refusal={refusal} upload={upload} onChoose={(f) => void choose(f)} />
          ) : step === 2 && upload ? (
            <Mapping upload={upload} mapping={mapping} remembered={remembered} onChange={setMapping} />
          ) : step === 3 && upload ? (
            preview.isLoading ? (
              <Spinner label="Reading every row and matching it against your contacts…" />
            ) : (
              <Loaded q={preview} what="The import preview">
                {(data) => <PreviewStep p={data} uploadId={upload.id} fileName={upload.file || picked?.name || 'import'} />}
              </Loaded>
            )
          ) : step === 4 && p ? (
            <ConsentAndLists
              p={p}
              email={email}
              phone={phone}
              onEmail={setEmail}
              onPhone={setPhone}
              listIds={listIds}
              onLists={setListIds}
              newList={newList}
              onNewList={setNewList}
              tags={tags}
              onTags={setTags}
            />
          ) : step === 5 && committed && upload ? (
            <Outcome committed={committed} uploadId={upload.id} fileName={upload.file || picked?.name || 'import'} onAgain={restart} />
          ) : null}
        </div>
      </PageBody>
    </div>
  );
}

/** "✓ Upload · ✓ Map columns · 3 Preview · 4 Consent & lists · 5 Import"; a done step can be gone back to. */
function Stepper({ step, onBack }: { step: Step; onBack: ((s: Step) => void) | null }) {
  return (
    <ol aria-label="Import steps" className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-[12px] border border-line bg-surface px-4 py-3">
      {STEPS.map((s) => {
        const done = s.n < step;
        const current = s.n === step;
        const body = (
          <>
            <span
              className={cx(
                'flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full text-[11.5px] font-bold',
                done ? 'bg-primary text-white' : current ? 'bg-selection text-primary ring-1 ring-primary/40' : 'bg-subtle text-ink-3',
              )}
            >
              {done ? <Icon name="check" size={13} strokeWidth={3} /> : s.n}
            </span>
            <span className={cx('text-[12.5px] font-semibold whitespace-nowrap', done || current ? 'text-primary' : 'text-ink-3')}>{s.label}</span>
            {done ? <span className="sr-only">(done)</span> : null}
          </>
        );
        return (
          <li key={s.n} aria-current={current ? 'step' : undefined}>
            {done && onBack ? (
              <button type="button" onClick={() => onBack(s.n)} className="flex items-center gap-2 rounded-[8px] hover:opacity-80" title={`Back to ${s.label}`}>
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

/* ------------------------------------------------------------------------ *
 * 1 · Upload
 * ------------------------------------------------------------------------ */

function Upload({ phase, refusal, upload, onChoose }: { phase: 'reading' | 'uploading' | null; refusal: { text: string; sent: boolean } | null; upload: ImportUpload | null; onChoose: (f: File | undefined) => void }) {
  const picker = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  return (
    <Panel title="Upload a CSV file" sub="The first row must name the columns. Nothing is written until you have seen the preview.">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(false);
        }}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          onChoose(e.dataTransfer.files[0]);
        }}
        className={cx('flex flex-col items-center justify-center gap-2 rounded-[12px] border-2 border-dashed px-6 py-10 text-center transition-colors', over ? 'border-primary bg-selection' : 'border-line bg-ground')}
      >
        <span className="flex h-11 w-11 items-center justify-center rounded-full bg-selection text-primary">
          <Icon name="upload" size={20} />
        </span>
        <div className="text-[14px] font-semibold text-ink">Drop a CSV file here</div>
        <div className="text-[12px] text-ink-3">or</div>
        <Button variant="primary" icon="file-sheet" loading={!!phase} onClick={() => picker.current?.click()}>
          Choose a CSV file
        </Button>
        <input
          ref={picker}
          type="file"
          accept=".csv,text/csv"
          hidden
          aria-label="CSV file"
          onChange={(e) => {
            onChoose(e.currentTarget.files?.[0]);
            e.currentTarget.value = '';
          }}
        />
        <p className="mt-1 max-w-md text-[11.5px] text-ink-3">Up to 10 MB / 10,000 rows. Save a spreadsheet as “CSV UTF-8” so names in Sinhala and Tamil come through intact.</p>
      </div>
      <div role="status" className="mt-3 text-[12.5px] text-ink-3 empty:hidden">
        {phase === 'reading' ? 'Reading the file…' : phase === 'uploading' ? 'Uploading…' : ''}
      </div>
      {refusal ? (
        <Notice tone="danger" className="mt-3">
          {refusal.text} {refusal.sent ? 'Nothing was written.' : 'Nothing was sent.'}
        </Notice>
      ) : upload && !phase ? (
        <Notice tone="success" icon="check-circle" className="mt-3">
          {`“${upload.file}” is uploaded: ${count(upload.rows)} rows in ${upload.headers.length} columns. Continue to map the columns.`}
        </Notice>
      ) : null}
    </Panel>
  );
}

/* ------------------------------------------------------------------------ *
 * 2 · Map columns
 * ------------------------------------------------------------------------ */

function Mapping({ upload, mapping, remembered, onChange }: { upload: ImportUpload; mapping: Record<string, string>; remembered: boolean; onChange: (m: Record<string, string>) => void }) {
  const samples = (i: number) =>
    (upload.sample ?? [])
      .map((r) => (r[i] ?? '').trim())
      .filter(Boolean)
      .slice(0, 3);
  const known = new Set<string>(IMPORT_FIELDS.map((f) => f.value));
  const holder = (field: string, except: string) => (field === 'ignore' ? undefined : Object.entries(mapping).find(([h, f]) => f === field && h !== except)?.[0]);
  const optionsFor = (header: string): Array<SelectOption<string>> => {
    // A field this desktop does not name, remembered by the server, stays choosable as the server's own.
    const extra = [...new Set(Object.values(mapping))].filter((v) => v && !known.has(v)).map((v) => ({ value: v, label: v.replace(/_/g, ' ') }));
    return [...IMPORT_FIELDS, ...extra].map((f) => {
      const from = holder(f.value, header);
      return { value: f.value, label: f.label, hint: from ? `Now on “${from}”` : undefined };
    });
  };
  return (
    <Panel title="Map columns" sub="Say what each column holds. Contacts are matched on email, then phone, then name at organisation.">
      {remembered ? (
        <Notice className="mb-3" icon="history">
          Using the mapping saved the last time a file with these columns was imported.
        </Notice>
      ) : null}
      <Table
        label="Column mapping"
        head={
          <tr>
            <th className={TH}>Column in file</th>
            <th className={TH}>Sample values</th>
            <th className={TH}>Maps to</th>
          </tr>
        }
      >
        {upload.headers.map((h, i) => {
          const s = samples(i);
          return (
            <tr key={`${i}-${h}`}>
              <td className={cx(TD, 'font-semibold whitespace-nowrap')}>{h || <span className="text-ink-3">(no name)</span>}</td>
              <td className={cx(TD, 'max-w-[340px] text-ink-2')}>
                <div className="truncate" title={s.join(' · ')}>
                  {s.length ? s.join(' · ') : '—'}
                </div>
              </td>
              <td className={TD}>
                <Select value={mapping[h] ?? 'ignore'} onValueChange={(f) => onChange(assignField(mapping, h, f))} options={optionsFor(h)} aria-label={`Maps to · ${h}`} className="w-[210px]" />
              </td>
            </tr>
          );
        })}
      </Table>
      {mapsContactKey(mapping) ? null : (
        <Notice tone="warning" className="mt-3">
          Map an Email or a Phone column to continue: contacts are matched on them.
        </Notice>
      )}
    </Panel>
  );
}

/* ------------------------------------------------------------------------ *
 * 3 · Preview
 * ------------------------------------------------------------------------ */

const PER_PAGE = 50;

function MatchChip({ match }: { match: ImportPreviewRow['match'] }) {
  if (!match) return <span className="text-ink-3">—</span>;
  const look = { email_key: { tone: 'indigo', text: 'email_key' }, phone_key: { tone: 'violet', text: 'phone_key' }, name_org: { tone: 'indigo', text: 'name@org' }, in_file: { tone: 'warning', text: 'in-file dup' } } as const;
  const m = look[match] ?? { tone: 'muted' as const, text: String(match) };
  return (
    <Status tone={m.tone}>
      <span className="font-mono">{m.text}</span>
    </Status>
  );
}

function ResultChip({ row }: { row: ImportPreviewRow }) {
  if (row.result === 'new') return <Status tone="success">New</Status>;
  if (row.result === 'update') return <Status tone="indigo">Update</Status>;
  if (row.result === 'merged') return <Status tone="warning">{row.merged_into ? `Merged into row ${row.merged_into}` : 'Merged'}</Status>;
  return <Status tone="danger">{row.reason ? `Rejected · ${row.reason}` : 'Rejected'}</Status>;
}

/** MKT-IMP-04 (Target): the rejected rows with their reasons, where the server offers them. */
function RejectedRows({ uploadId, fileName, rejected }: { uploadId: number; fileName: string; rejected: number }) {
  const [busy, run] = useAction();
  const [offered, setOffered] = useState<boolean | null>(null);
  const download = () =>
    run('rejected', async () => {
      const r = await rejectedRowsCsv(uploadId);
      setOffered(r.offered);
      if (!r.offered) {
        toast('info', NOT_OFFERED);
        return;
      }
      await saveCsv(`${fileName.replace(/\.csv$/i, '')} rejected rows`, r.data);
    });
  return (
    <span className="flex flex-wrap items-center gap-2">
      {offered === false ? <Planned>Planned · download rejected rows</Planned> : null}
      <Button size="sm" variant="ghost" icon="download" disabled={rejected === 0 || offered === false} loading={busy === 'rejected'} onClick={() => void download()}>
        Download rejected rows
      </Button>
    </span>
  );
}

function PreviewStep({ p, uploadId, fileName }: { p: ImportPreview; uploadId: number; fileName: string }) {
  const [filter, setFilter] = useState<'all' | ImportResult>('all');
  const [page, setPage] = useState(1);
  const all = p.rows ?? [];
  const rows = filter === 'all' ? all : all.filter((r) => r.result === filter);
  const pages = Math.max(1, Math.ceil(rows.length / PER_PAGE));
  const at = Math.min(page, pages);
  const shown = rows.slice((at - 1) * PER_PAGE, at * PER_PAGE);
  const total = p.new + p.updated + p.duplicates_in_file + p.rejected;
  return (
    <>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi label="New contacts" value={count(p.new)} sub="Will be created" subTone="success" />
        <Kpi label="Updates" value={count(p.updated)} sub="Matched on email or phone" />
        <Kpi label="Duplicates in file" value={count(p.duplicates_in_file)} sub="Merged before import" subTone="warning" />
        <Kpi label="Rejected rows" value={count(p.rejected)} sub="Invalid email and no phone" subTone="danger" />
      </div>
      {p.suppressed ? (
        <Notice icon="shield-check">
          {`${count(p.suppressed)} ${p.suppressed === 1 ? 'row belongs to a suppressed email or phone' : 'rows belong to suppressed emails or phones'}. Suppressed people stay suppressed after the import.`}
        </Notice>
      ) : null}
      <Panel title="Preview" action={<RejectedRows uploadId={uploadId} fileName={fileName} rejected={p.rejected} />}>
        <Tabs
          value={filter}
          onChange={(v) => {
            setFilter(v);
            setPage(1);
          }}
          label="Rows to show"
          className="mb-3"
          tabs={[
            { id: 'all', label: 'All rows' },
            { id: 'new', label: 'New' },
            { id: 'update', label: 'Updates' },
            { id: 'merged', label: 'Merged' },
            { id: 'rejected', label: 'Rejected' },
          ]}
        />
        {shown.length === 0 ? (
          <p className="py-4 text-center text-[12.5px] text-ink-3">No row of this kind.</p>
        ) : (
          <Table
            label="Rows in the file"
            head={
              <tr>
                <th className={TH}>Row</th>
                <th className={TH}>Name</th>
                <th className={TH}>Email</th>
                <th className={TH}>Phone</th>
                <th className={TH}>Match</th>
                <th className={TH}>Result</th>
              </tr>
            }
          >
            {shown.map((r) => (
              <tr key={r.row}>
                <td className={TD}>
                  <Mono className="text-ink-3">{r.row}</Mono>
                </td>
                <td className={cx(TD, 'font-medium')}>{r.name || '—'}</td>
                <td className={cx(TD, 'text-ink-2')}>{r.email || '—'}</td>
                <td className={cx(TD, 'whitespace-nowrap text-ink-2')}>{r.phone ? (r.phone.includes('*') ? r.phone : maskPhone(r.phone)) : '—'}</td>
                <td className={TD}>
                  <MatchChip match={r.match} />
                </td>
                <td className={TD}>
                  <span className="inline-flex flex-wrap items-center gap-1">
                    <ResultChip row={r} />
                    {r.suppressed ? (
                      <Status tone="danger" dot={false}>
                        Suppressed
                      </Status>
                    ) : null}
                  </span>
                </td>
              </tr>
            ))}
          </Table>
        )}
        {rows.length > PER_PAGE ? <Pager page={at} pages={pages} total={rows.length} perPage={PER_PAGE} onPage={setPage} /> : null}
        {all.length < total ? <p className="mt-2 text-[11.5px] text-ink-3">{`The server previewed ${count(all.length)} of the ${count(total)} rows; the counts above cover them all.`}</p> : null}
      </Panel>
      {p.has_consent_column ? null : (
        <Notice tone="warning">
          This file has <b>no consent column</b>. Contacts will be imported as <b>email: unknown</b> and <b>phone: unknown</b>, and are excluded from sends and call queues until consent is recorded. Choose a lawful
          basis on the next step.
        </Notice>
      )}
      {p.new + p.updated === 0 ? <Notice tone="danger">No row in this file can be imported. Fix the rows above and upload the file again.</Notice> : null}
    </>
  );
}

/* ------------------------------------------------------------------------ *
 * 4 · Consent & lists
 * ------------------------------------------------------------------------ */

function ConsentChoice({ channel, value, onChange }: { channel: Channel; value: Decision; onChange: (d: Decision) => void }) {
  const group = useId();
  const isEmail = channel === 'email';
  const bases = BASIS.filter((b) => b.value !== 'unknown');
  const box = (on: boolean) => cx('rounded-[10px] border px-3 py-2.5', on ? 'border-primary bg-selection' : 'border-line');
  return (
    <fieldset className="flex min-w-0 flex-col gap-2">
      <legend className="mb-1.5 text-[12.5px] font-bold text-ink">{isEmail ? 'Email' : 'Phone'}</legend>
      <div className={box(value.mode === 'basis')}>
        <label className="flex cursor-pointer items-start gap-2.5">
          <input type="radio" name={group} checked={value.mode === 'basis'} onChange={() => onChange({ mode: 'basis', basis: value.basis })} className="mt-[3px] accent-primary" />
          <span className="text-[13px] font-semibold text-ink">{isEmail ? 'Subscribed, on a lawful basis' : 'Consented, on a lawful basis'}</span>
        </label>
        <div className="mt-2 pl-6">
          <Select
            value={value.basis}
            onValueChange={(b) => onChange({ mode: 'basis', basis: b })}
            options={bases}
            placeholder="Choose the lawful basis"
            aria-label={isEmail ? 'Email lawful basis' : 'Phone lawful basis'}
            className="w-full"
          />
        </div>
      </div>
      <label className={cx(box(value.mode === 'unknown'), 'flex cursor-pointer items-start gap-2.5')}>
        <input type="radio" name={group} checked={value.mode === 'unknown'} onChange={() => onChange({ mode: 'unknown', basis: value.basis })} className="mt-[3px] accent-primary" />
        <span className="flex min-w-0 flex-col">
          <span className="text-[13px] font-semibold text-ink">{isEmail ? 'Leave email consent unknown' : 'Leave phone consent unknown'}</span>
          <span className="text-[12px] text-ink-3">{isEmail ? 'Excluded from sends until consent is recorded.' : 'Excluded from call queues until consent is recorded.'}</span>
        </span>
      </label>
    </fieldset>
  );
}

function ConsentAndLists({
  p,
  email,
  phone,
  onEmail,
  onPhone,
  listIds,
  onLists,
  newList,
  onNewList,
  tags,
  onTags,
}: {
  p: ImportPreview;
  email: Decision;
  phone: Decision;
  onEmail: (d: Decision) => void;
  onPhone: (d: Decision) => void;
  listIds: number[];
  onLists: (ids: number[]) => void;
  newList: string;
  onNewList: (s: string) => void;
  tags: string;
  onTags: (s: string) => void;
}) {
  const lists = useLists();
  const chosenTags = splitTags(tags);
  return (
    <>
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Panel title="Consent" sub={p.has_consent_column ? 'From the file' : 'Required for this file'}>
          {p.has_consent_column ? (
            <Notice>Consent comes from the file’s consent column. A channel without a column of its own is imported as unknown.</Notice>
          ) : (
            <div className="flex flex-col gap-4">
              <p className="text-[12.5px] text-ink-2">This file has no consent column. Decide for each channel what everyone in it gets; the decision is written to each contact’s consent ledger with this import.</p>
              <ConsentChoice channel="email" value={email} onChange={onEmail} />
              <ConsentChoice channel="phone" value={phone} onChange={onPhone} />
            </div>
          )}
        </Panel>
        <Panel title="Lists and tags" sub="Optional: everyone in the file is added">
          <div className="flex flex-col gap-3">
            <div>
              <div className="mb-1 text-[12px] font-semibold text-ink-2">Add to lists</div>
              <Loaded q={lists} what="Lists">
                {(rows) =>
                  rows.length === 0 ? (
                    <p className="text-[12.5px] text-ink-3">No lists yet. Name a new one below to keep this file’s contacts together.</p>
                  ) : (
                    <div className="flex max-h-[220px] flex-col overflow-y-auto rounded-[10px] border border-line py-1 scroll-thin">
                      {rows.map((l) => (
                        <label key={l.id} className="flex cursor-pointer items-center gap-2.5 px-3 py-1.5 hover:bg-subtle">
                          <Checkbox
                            checked={listIds.includes(l.id)}
                            onChange={(e) => {
                              const on = e.currentTarget.checked;
                              onLists(on ? [...listIds, l.id] : listIds.filter((x) => x !== l.id));
                            }}
                          />
                          <span className="min-w-0 flex-1 truncate text-[13px] text-ink">{l.name}</span>
                          <Mono className="text-[11.5px] text-ink-3">{count(l.members_count)}</Mono>
                        </label>
                      ))}
                    </div>
                  )
                }
              </Loaded>
            </div>
            <Field label="New list" hint="Created with everyone in this file.">
              <Input value={newList} onChange={(e) => onNewList(e.target.value)} placeholder="Vendors October 2026" maxLength={150} />
            </Field>
            <Field label="Tags" hint={chosenTags.length ? `Adds ${chosenTags.map((t) => `“${t}”`).join(', ')}` : 'Separate tags with commas.'}>
              <Input value={tags} onChange={(e) => onTags(e.target.value)} placeholder="vendor, oct-2026" />
            </Field>
          </div>
        </Panel>
      </div>
      <Notice icon="info">
        {`Importing creates ${count(p.new)} and updates ${count(p.updated)} contacts; ${count(p.duplicates_in_file)} duplicates in the file are merged and ${count(p.rejected)} rows are rejected. Suppressed people stay suppressed.`}
      </Notice>
    </>
  );
}

/* ------------------------------------------------------------------------ *
 * 5 · Import
 * ------------------------------------------------------------------------ */

function Outcome({ committed, uploadId, fileName, onAgain }: { committed: ImportStatus; uploadId: number; fileName: string; onAgain: () => void }) {
  const org = useMarketingOrg();
  const { go } = useTab();
  const qc = useQueryClient();
  const background = committed.status === 'queued' || committed.status === 'running';
  // MKT-IMP-06 (Target): a background import's progress, every 2 s while the server reports it.
  const live = useQuery({
    queryKey: ['marketing', 'import', org, committed.id || uploadId, 'status'],
    queryFn: ({ signal }) => fetchImport(committed.id || uploadId, signal),
    enabled: background,
    refetchInterval: (q) => {
      const d = q.state.data;
      return d?.offered && (d.data.status === 'queued' || d.data.status === 'running') ? 2000 : false;
    },
  });
  const status = live.data?.offered ? live.data.data : committed;
  const running = status.status === 'queued' || status.status === 'running';
  const finished = status.status === 'done';

  useEffect(() => {
    if (!finished) return;
    for (const queryKey of [['marketing', 'contacts'], ['marketing', 'contact'], ['marketing', 'organisations'], MK.lists(org), MK.dashboard(org), MK.segments(org), MK.topics(org)]) void qc.invalidateQueries({ queryKey });
  }, [finished, org, qc]);

  if (running) {
    return (
      <Panel title="Importing" sub={fileName}>
        {live.data && !live.data.offered ? (
          <div className="flex flex-col gap-2">
            <p className="text-[12.5px] text-ink-2">The server is importing this file in the background. It doesn’t report progress yet; the contacts appear in Contacts as they are written.</p>
            <div>
              <Planned>Planned · import progress</Planned>
            </div>
          </div>
        ) : live.error ? (
          <ErrorNote error={live.error} onRetry={() => void live.refetch()} />
        ) : (
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between text-[12.5px] text-ink-2">
              <span>{status.status === 'queued' ? 'Waiting to start…' : 'Writing contacts, consent and timelines…'}</span>
              <Mono>{`${Math.round(status.progress)}%`}</Mono>
            </div>
            <Bar value={status.progress} />
            <p className="text-[11.5px] text-ink-3">{`${count(status.created)} created · ${count(status.updated)} updated · ${count(status.merged)} merged · ${count(status.rejected)} rejected so far`}</p>
          </div>
        )}
        <div className="mt-4 flex flex-wrap gap-2">
          <Button onClick={() => go('/marketing/contacts')}>Open contacts</Button>
        </div>
      </Panel>
    );
  }

  if (status.status === 'failed') {
    return (
      <Panel title="The import failed" sub={fileName}>
        <Notice tone="danger">{status.message || 'The server could not finish this import.'}</Notice>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button variant="primary" icon="upload" onClick={onAgain}>
            Import another file
          </Button>
          <Button onClick={() => go('/marketing/contacts')}>Open contacts</Button>
        </div>
      </Panel>
    );
  }

  return (
    <>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi label="Created" value={count(status.created)} sub="New contacts" subTone="success" />
        <Kpi label="Updated" value={count(status.updated)} sub="Matched on email or phone" />
        <Kpi label="Merged" value={count(status.merged)} sub="Duplicates in the file" subTone="warning" />
        <Kpi label="Rejected" value={count(status.rejected)} sub="Not imported" subTone="danger" />
      </div>
      <Panel title="Import report" sub={fileName} action={<RejectedRows uploadId={uploadId} fileName={fileName} rejected={status.rejected} />}>
        <div className="flex flex-col gap-3">
          {status.message ? <p className="text-[12.5px] text-ink-2">{status.message}</p> : null}
          <Notice icon="shield-check">Suppressed people stay suppressed even if they appear in a new file.</Notice>
          <div className="flex flex-wrap gap-2">
            <Button variant="primary" icon="users" onClick={() => go('/marketing/contacts')}>
              Open contacts
            </Button>
            <Button icon="upload" onClick={onAgain}>
              Import another file
            </Button>
          </div>
        </div>
      </Panel>
    </>
  );
}
