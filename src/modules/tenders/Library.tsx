import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { useCanOpen } from '../../core/access';
import { errorMessage } from '../../core/bridge';
import { dayWords } from '../../core/time';
import { toast } from '../../core/toasts';
import { uploadBlob } from '../../core/upload';
import { DriveFilePicker } from '../../components/DriveFilePicker';
import { Icon } from '../../components/Icon';
import { Select } from '../../components/Select';
import { ErrorNote, Spinner, cx } from '../../components/ui';
import { btn, btnPrimary, btnSmall, Empty, Field, input, Kpi, PageHead, Sheet } from '../hr/parts';
import { Pill } from '../inventory/parts';
import { K, type Company } from './api';
import { fetchLibrary, filterLibrary, KA, LIBRARY_KINDS, libraryBody, libraryDraft, libraryKind, removeLibraryDoc, removeLibraryDocs, saveLibraryDoc, type LibraryDoc, type LibraryDraft, type LibraryFilter } from './admin';
import { saveTenderFile } from './files';
import { Checkbox } from '../../components/Checkbox';

/**
 * The company's own documents — registration, tax clearance, audited
 * financials, certificates — kept once and filed against every bid's
 * checklist from here. What this screen is for is the expiry: a certificate
 * that lapses quietly fails every bid it is filed on, so the list runs from
 * the soonest to lapse and says how long each has. A document with only its
 * details recorded, and no paper, is called out too — it satisfies nothing.
 */
const FILTERS: Array<[LibraryFilter, string]> = [
  ['all', 'All'],
  ['expired', 'Expired'],
  ['expiring', 'Expiring within 60 days'],
  ['valid', 'Valid'],
  ['nofile', 'No file'],
];

export default function Library({ org, companies, canManage }: { org: string; companies: Company[]; canManage: boolean }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: KA.library(org), queryFn: ({ signal }) => fetchLibrary(org, signal) });
  const [filter, setFilter] = useState<LibraryFilter>('all');
  const [search, setSearch] = useState('');
  const [picked, setPicked] = useState<number[]>([]);
  const [editing, setEditing] = useState<LibraryDoc | 'new' | null>(null);
  const [removing, setRemoving] = useState<LibraryDoc[] | null>(null);
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: KA.library(org) });
    void qc.invalidateQueries({ queryKey: K.all });
  };
  if (q.isLoading) return <Spinner />;
  if (q.error || !q.data) return <ErrorNote error={q.error} onRetry={() => void q.refetch()} />;
  const lib = q.data;
  const rows = filterLibrary(lib.items, filter, search);
  const several = companies.length > 1 && !org;
  const nameOf = (id: number | null) => companies.find((c) => c.id === id)?.name ?? null;
  const noFile = lib.items.filter((d) => !d.file).length;

  return (
    <div className="flex flex-col gap-3.5 px-6 py-5">
      <PageHead title="Document library" sub="The company’s own certificates, kept once and filed against every bid">
        {canManage ? (
          <button type="button" className={btnPrimary} onClick={() => setEditing('new')}>
            <Icon name="plus" size={15} /> Add a document
          </button>
        ) : null}
      </PageHead>
      <div className="grid grid-cols-4 gap-3">
        <Kpi label="In the library" value={lib.summary.total} onClick={() => setFilter('all')} />
        <Kpi label="Expired" value={lib.summary.expired} tone={lib.summary.expired ? 'red' : undefined} sub="Fails every bid it is filed on" onClick={() => setFilter('expired')} />
        <Kpi label="Expiring within 60 days" value={lib.summary.expiring} tone={lib.summary.expiring ? 'amber' : undefined} sub="Renewing takes time" onClick={() => setFilter('expiring')} />
        <Kpi label="No file" value={noFile} tone={noFile ? 'amber' : undefined} sub="Details only — satisfies nothing" onClick={() => setFilter('nofile')} />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name, reference, kind" aria-label="Search the library" className={input + ' !w-[240px]'} />
        <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Show">
          {FILTERS.map(([f, label]) => (
            <button
              key={f}
              type="button"
              role="tab"
              aria-selected={filter === f}
              onClick={() => (setFilter(f), setPicked([]))}
              className={cx('h-7 rounded-[14px] border px-2.5 text-[12px] font-semibold', filter === f ? 'border-primary bg-selection text-primary' : 'border-line bg-surface text-ink-2 hover:bg-subtle')}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      {picked.length && canManage ? (
        <div className="flex items-center gap-2 self-start rounded-[9px] border border-[#C7D0F5] bg-[#EEF1FC] px-2.5 py-1.5 dark:border-primary/40 dark:bg-selection">
          <b className="text-[12.5px] text-primary">{picked.length} selected</b>
          <button type="button" className={btnSmall + ' !h-7 !text-danger'} onClick={() => setRemoving(lib.items.filter((d) => picked.includes(d.id)))}>
            Remove
          </button>
          <button type="button" className="text-[12px] font-semibold text-primary hover:underline" onClick={() => setPicked([])}>
            Clear the selection
          </button>
        </div>
      ) : null}
      <div className="overflow-hidden rounded-[12px] border border-line bg-surface" aria-label="Library">
        {rows.length ? (
          rows.map((d) => (
            <div key={d.id} data-library={d.id} className={cx('flex items-center gap-3 border-b border-line/60 px-3.5 py-2.5 text-[12.5px] last:border-b-0', picked.includes(d.id) && 'bg-[#F4F6FE] dark:bg-selection/40')}>
              {canManage ? <Checkbox aria-label={`Choose ${d.name}`} checked={picked.includes(d.id)} onChange={() => setPicked((p) => (p.includes(d.id) ? p.filter((x) => x !== d.id) : [...p, d.id]))} /> : null}
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="flex flex-wrap items-center gap-1.5">
                  <b className="text-[13px] text-ink">{d.name}</b>
                  <Pill>{libraryKind(d.kind)}</Pill>
                  {several && nameOf(d.org_id) ? <Pill tone="blue">{nameOf(d.org_id)}</Pill> : null}
                </span>
                <span className="truncate text-[11.5px] text-ink-3">
                  {[d.reference, d.file ? (d.file.name ?? 'File on record') : 'No file — details only', d.issued_on ? `issued ${dayWords(d.issued_on, { year: true })}` : null].filter(Boolean).join(' · ')}
                </span>
                {d.note ? <span className="text-[12px] text-ink-2">{d.note}</span> : null}
              </span>
              <span className={cx('flex w-[150px] shrink-0 flex-col items-end', d.state === 'expired' ? 'text-danger' : d.state === 'expiring' ? 'text-[#9A4A06] dark:text-warning' : 'text-ink-2')}>
                {d.expires_on ? (
                  <>
                    <span className={cx(d.state !== 'valid' && 'font-bold')}>{d.state === 'expired' ? 'Expired' : `Until ${dayWords(d.expires_on, { year: true })}`}</span>
                    <span className="text-[11.5px]">
                      {d.days_left === null ? '' : d.days_left < 0 ? `${-d.days_left} ${d.days_left === -1 ? 'day' : 'days'} ago` : d.days_left === 0 ? 'lapses today' : `${d.days_left} ${d.days_left === 1 ? 'day' : 'days'} left`}
                    </span>
                  </>
                ) : (
                  <span className="text-ink-3">Does not expire</span>
                )}
              </span>
              <span className="flex shrink-0 items-center gap-1.5">
                {d.file ? (
                  <button type="button" className={btnSmall + ' !h-7'} onClick={() => void saveTenderFile({ tenderLibrary: d.id }, d.file!.name ?? d.name, true)}>
                    Open
                  </button>
                ) : null}
                {canManage ? (
                  <>
                    <button type="button" aria-label={`Edit ${d.name}`} title="Edit" className={btnSmall + ' !h-7 !w-7 justify-center !px-0'} onClick={() => setEditing(d)}>
                      <Icon name="compose" size={13} />
                    </button>
                    <button type="button" aria-label={`Remove ${d.name}`} title="Remove" className={btnSmall + ' !h-7 !w-7 justify-center !px-0 !text-danger'} onClick={() => setRemoving([d])}>
                      <Icon name="trash" size={13} />
                    </button>
                  </>
                ) : null}
              </span>
            </div>
          ))
        ) : (
          <Empty
            text={
              lib.items.length ? 'Nothing matches.' : canManage ? 'The library is empty. Add the company’s registration, tax clearance and other standing documents once, and every bid’s checklist can be filed from here.' : 'The library is empty.'
            }
          />
        )}
      </div>
      {editing ? <DocSheet doc={editing === 'new' ? null : editing} org={org} companies={companies} onClose={() => setEditing(null)} onSaved={refresh} /> : null}
      {removing ? <RemoveSheet docs={removing} org={org} onClose={() => setRemoving(null)} onDone={() => (setPicked([]), refresh())} /> : null}
    </div>
  );
}

function DocSheet({ doc, org, companies, onClose, onSaved }: { doc: LibraryDoc | null; org: string; companies: Company[]; onClose: () => void; onSaved: () => void }) {
  const [d, setD] = useState<LibraryDraft>(() => libraryDraft(doc));
  const [company, setCompany] = useState(doc?.org_id ? String(doc.org_id) : org || (companies.length === 1 ? String(companies[0]!.id) : ''));
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState<number | null>(null);
  const [drive, setDrive] = useState(false);
  // "From Drive…" browses Files: only for whoever has it.
  const files = useCanOpen('files');
  const [error, setError] = useState<string | null>(null);
  const picker = useRef<HTMLInputElement>(null);
  const needsCompany = !doc && !org && companies.length > 1;
  const upload = async (f: File) => {
    setUploading(0);
    setError(null);
    try {
      const r = await uploadBlob(f, f.name, { kind: 'files', folderId: null }, (x) => setUploading(Math.round(x * 100)));
      if (!r.fileId) throw new Error('The file was stored but WorkSuite did not say where.');
      setD((x) => ({ ...x, file: { id: r.fileId!, name: f.name } }));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setUploading(null);
    }
  };
  const save = async () => {
    const out = libraryBody(d, company ? Number(company) : null);
    if (!out.body) return setError(out.error);
    if (needsCompany && !company) return setError('Choose the company this document belongs to.');
    setBusy(true);
    setError(null);
    try {
      await saveLibraryDoc(out.body, doc?.id ?? null);
      toast('success', doc ? 'Saved.' : 'Added to the library.');
      onSaved();
      onClose();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const set = (k: keyof LibraryDraft) => (e: { target: { value: string } }) => setD({ ...d, [k]: e.target.value });
  return (
    <Sheet
      title={doc ? 'Edit the document' : 'Add a document'}
      width={540}
      onClose={onClose}
      footer={
        <>
          <button type="button" className={btn} onClick={onClose}>
            Cancel
          </button>
          <button type="button" className={btnPrimary} disabled={busy || uploading !== null || !d.name.trim()} onClick={() => void save()}>
            {busy ? 'Saving…' : doc ? 'Save' : 'Add'}
          </button>
        </>
      }
    >
      {needsCompany ? (
        <Field label="Company">
          <Select<string> aria-label="Company" value={company} onValueChange={setCompany} options={[{ value: '', label: 'Choose a company' }, ...companies.map((c) => ({ value: String(c.id), label: c.name }))]} className={input} />
        </Field>
      ) : null}
      <Field label="Name">
        <input aria-label="Name" autoFocus value={d.name} onChange={set('name')} maxLength={200} placeholder="Tax clearance certificate 2026" className={input} />
      </Field>
      <div className="grid grid-cols-2 gap-2.5">
        <Field label="Kind">
          <Select<string>
            aria-label="Kind"
            value={d.kind}
            onValueChange={(v) => setD({ ...d, kind: v })}
            options={[...LIBRARY_KINDS, ...(LIBRARY_KINDS.some(([k]) => k === d.kind) ? [] : [[d.kind, libraryKind(d.kind)] as [string, string]])].map(([value, label]) => ({ value, label }))}
            className={input}
          />
        </Field>
        <Field label="Reference">
          <input aria-label="Reference" value={d.reference} onChange={set('reference')} maxLength={120} placeholder="The certificate’s own number" className={input} />
        </Field>
        <Field label="Issued on">
          <input type="date" aria-label="Issued on" value={d.issued_on} onChange={set('issued_on')} className={input} />
        </Field>
        <Field label="Expires on" hint="Checklist lines filed from it stop counting after this.">
          <input type="date" aria-label="Expires on" value={d.expires_on} onChange={set('expires_on')} className={input} />
        </Field>
      </div>
      <Field label="The file" hint="Without one, only the details are recorded — and a line filed from it is not satisfied.">
        <span className="flex flex-wrap items-center gap-2">
          <span className="min-w-0 flex-1 truncate text-[12.5px] text-ink" aria-label="Chosen file">
            {uploading !== null ? `Uploading… ${uploading}%` : d.file ? (d.file.name ?? 'A file on record') : <span className="text-ink-3">None</span>}
          </span>
          <button type="button" className={btnSmall} disabled={uploading !== null} onClick={() => picker.current?.click()}>
            Choose a file…
          </button>
          {files ? (
            <button type="button" className={btnSmall} disabled={uploading !== null} onClick={() => setDrive(true)}>
              From Drive…
            </button>
          ) : null}
          {d.file ? (
            <button type="button" className={btnSmall + ' !text-danger'} onClick={() => setD({ ...d, file: null })}>
              Take it off
            </button>
          ) : null}
          <input
            ref={picker}
            type="file"
            aria-label="Upload the file"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (f) void upload(f);
            }}
          />
        </span>
      </Field>
      <Field label="Note">
        <input aria-label="Note" value={d.note} onChange={set('note')} maxLength={500} className={input} />
      </Field>
      {error ? <p className="m-0 text-[12.5px] text-danger">{error}</p> : null}
      {drive ? (
        <DriveFilePicker
          title="Choose the file from Drive"
          confirmLabel="Choose"
          onChoose={(files) => {
            const f = files[0];
            if (f) setD({ ...d, file: { id: Number(f.id), name: f.name } });
            setDrive(false);
          }}
          onClose={() => setDrive(false)}
        />
      ) : null}
    </Sheet>
  );
}

function RemoveSheet({ docs, org, onClose, onDone }: { docs: LibraryDoc[]; org: string; onClose: () => void; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const go = async () => {
    setBusy(true);
    setError(null);
    try {
      if (docs.length === 1) {
        await removeLibraryDoc(docs[0]!.id);
        toast('success', `${docs[0]!.name} was removed from the library.`);
      } else {
        const r = await removeLibraryDocs(
          docs.map((d) => d.id),
          org,
        );
        if (r.done.length) toast('success', `${r.done.length} removed from the library.`);
        for (const f of r.failed.slice(0, 4)) toast('error', `${docs.find((d) => d.id === f.id)?.name ?? `#${f.id}`}: ${f.why}`);
      }
      onDone();
      onClose();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet
      title={docs.length === 1 ? `Remove ${docs[0]!.name}?` : `Remove ${docs.length} documents?`}
      width={460}
      onClose={onClose}
      footer={
        <>
          <button type="button" className={btn} onClick={onClose}>
            Cancel
          </button>
          <button type="button" className={btnPrimary + ' !bg-danger hover:!opacity-90'} disabled={busy} onClick={() => void go()}>
            {busy ? 'Removing…' : 'Remove'}
          </button>
        </>
      }
    >
      <p className="m-0 text-[13px] text-ink-2">A document that a live bid’s checklist is filed from is refused and named — replace it on those lines first. The file stays in Drive.</p>
      {error ? <p className="m-0 text-[12.5px] text-danger">{error}</p> : null}
    </Sheet>
  );
}
