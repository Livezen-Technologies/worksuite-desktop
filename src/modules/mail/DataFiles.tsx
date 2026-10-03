import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { apiGet, apiPost } from '../../core/api';
import { app } from '../../core/app-state';
import { call, errorMessage, on } from '../../core/bridge';
import { text } from '../../core/i18n';
import { useStore } from '../../core/store';
import { navigate } from '../../core/tabs';
import { bytes } from '../../core/time';
import { toast } from '../../core/toasts';
import { Checkbox } from '../../components/Checkbox';
import { Select } from '../../components/Select';
import { Button, Chip, ErrorNote, Modal, Spinner } from '../../components/ui';
import type { DataFolder, ExportProgress, ImportProgress, MailFileHandle } from '@shared/mail-files';
import { useMailboxes } from './api';

/**
 * Import a data file — .pst, .mbox, a folder of .eml or .msg (ENH-MAIL-03
 * DMO-DAT-01/02, WF-DO09, design D08 extended). The file is read on this
 * computer by the sandboxed data-file worker and its mail is copied into the
 * chosen mailbox on the server, so it is on every device afterwards. The same
 * file imported twice copies nothing the second time.
 *
 * And export (DMO-DAT-03): a folder or a search result to an .mbox file or a
 * zip of .eml files, when the organisation allows it.
 */

export interface DataFilePolicy {
  import: boolean;
  export: boolean;
  max_mb: number;
}

export interface PlannedFolder {
  source: string;
  destination: string | null;
  /** The destination as the server's separator and encoding make it readable. */
  destination_label?: string | null;
  skip_reason: string | null;
  label: string;
}

export interface DataFileImportRow {
  id: number;
  name: string;
  kind: string;
  state: string;
  found: number;
  copied: number;
  skipped: number;
  failed: number;
  bytes: number;
  unreadable: string[];
  created_at: string;
  finished_at: string | null;
}

export function useDataFilePolicy(enabled = true) {
  return useQuery({
    queryKey: ['mail', 'datafile-policy'],
    queryFn: async () => {
      try {
        return await apiGet<DataFilePolicy>('/api/mail/imports/datafile/policy');
      } catch {
        // An older server has no data-file import: neither is offered.
        return { import: false, export: false, max_mb: 0 } satisfies DataFilePolicy;
      }
    },
    enabled,
    staleTime: 5 * 60_000,
  });
}

/** The plan entries the worker is given: each folder of the file that goes somewhere, by its id. */
export function planEntries(folders: DataFolder[], plan: PlannedFolder[]): Array<{ folder: number; source: string; destination: string }> {
  const byPath = new Map(folders.map((f) => [f.path, f]));
  return plan.flatMap((p) => {
    const f = byPath.get(p.source);
    return f && p.destination && !p.skip_reason ? [{ folder: f.id, source: p.source, destination: p.destination }] : [];
  });
}

/** How far an import has got, in words. */
export function progressWords(p: ImportProgress): string {
  if (p.state === 'done') return text('Done: {copied} copied, {skipped} already there or left out, {failed} could not be copied.', { copied: p.copied.toLocaleString(), skipped: p.skipped.toLocaleString(), failed: p.failed.toLocaleString() });
  if (p.state === 'cancelled') return text('Stopped after {n} messages.', { n: p.done.toLocaleString() });
  if (p.state === 'paused') return text('Paused after {n} of {total}: {reason}', { n: p.done.toLocaleString(), total: p.total.toLocaleString(), reason: p.error ?? '' });
  return text('{n} of {total} read · {copied} copied', { n: p.done.toLocaleString(), total: p.total.toLocaleString(), copied: p.copied.toLocaleString() });
}

export function DataFileImport() {
  const qc = useQueryClient();
  const offline = useStore(app, (s) => s.status?.network === 'OFFLINE');
  const policy = useDataFilePolicy();
  const boxes = useMailboxes();
  const own = (boxes.data?.mailboxes ?? []).filter((b) => !b.shared && !b.archived);
  const history = useQuery({ queryKey: ['mail', 'datafile-imports'], queryFn: () => apiGet<{ imports: DataFileImportRow[] }>('/api/mail/imports/datafile'), retry: false, enabled: policy.data?.import === true });
  const [file, setFile] = useState<MailFileHandle | null>(null);
  const [scan, setScan] = useState<{ folders: DataFolder[]; unreadable: string[] } | null>(null);
  const [into, setInto] = useState('');
  const [ownFolder, setOwnFolder] = useState(true);
  const [skipJunk, setSkipJunk] = useState(true);
  const [skipTrash, setSkipTrash] = useState(true);
  const [plan, setPlan] = useState<PlannedFolder[] | null>(null);
  const [busy, setBusy] = useState<'pick' | 'scan' | 'plan' | 'start' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<ImportProgress | null>(null);

  useEffect(() => on<ImportProgress>('mailfile:changed', (p) => {
    if (file && p.handle === file.id) setProgress(p);
    if (p.state === 'done') void qc.invalidateQueries({ queryKey: ['mail'] });
  }), [file, qc]);

  if (policy.isLoading) return null;
  if (!policy.data?.import) {
    return (
      <section aria-label={text('Import a data file')} className="mb-6 rounded-[12px] border border-line bg-surface p-4 text-[13px] text-ink-2">
        <h3 className="text-[15px] font-bold text-ink">Import a data file</h3>
        <p className="mt-1">Your organisation does not allow importing .pst, .mbox or .eml files. Ask a mail administrator.</p>
      </section>
    );
  }
  const dest = into || String(own.find((b) => b.is_default)?.id ?? own[0]?.id ?? '');
  const reset = () => {
    setPlan(null);
    setError(null);
  };
  const pick = async (mode: 'file' | 'folder') => {
    setBusy('pick');
    setError(null);
    try {
      const h = await call('mailfile:pick', { mode });
      if (!h) return;
      if (file) void call('mailfile:close', { handle: file.id }).catch(() => undefined);
      setFile(h);
      setScan(null);
      setPlan(null);
      setProgress(null);
      setBusy('scan');
      setScan(await call('mailfile:scan', { handle: h.id }));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };
  /** One message file, to read (DMO-DAT-04): it opens in a tab of its own. */
  const openOne = async () => {
    try {
      const h = await call('mailfile:pick', { mode: 'view' });
      if (h) navigate(`/mail?file=${h.id}`);
    } catch (e) {
      setError(errorMessage(e));
    }
  };
  const makePlan = async () => {
    if (!file || !scan || !dest) return;
    setBusy('plan');
    setError(null);
    try {
      const r = await apiPost<{ folders: PlannedFolder[] }>('/api/mail/imports/datafile/plan', {
        connection_id: Number(dest), name: file.name, own_folder: ownFolder, skip_junk: skipJunk, skip_trash: skipTrash,
        folders: scan.folders.map((f) => ({ path: f.path, count: f.count, mail: f.mail })),
      });
      setPlan(r.folders);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };
  const start = async () => {
    if (!file || !scan || !plan) return;
    const entries = planEntries(scan.folders, plan);
    if (!entries.length) return setError(text('Nothing in this file would be imported.'));
    setBusy('start');
    try {
      const imp = await apiPost<{ id: number }>('/api/mail/imports/datafile', { connection_id: Number(dest), name: file.name, kind: file.kind });
      setProgress(await call('mailfile:import', { handle: file.id, importId: imp.id, plan: entries }));
      void qc.invalidateQueries({ queryKey: ['mail', 'datafile-imports'] });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };
  const resume = async () => {
    if (!file || !progress || !scan || !plan) return;
    try {
      setProgress(await call('mailfile:import', { handle: file.id, importId: progress.importId, plan: planEntries(scan.folders, plan) }));
    } catch (e) {
      toast('error', errorMessage(e));
    }
  };
  const counted = scan ? scan.folders.filter((f) => f.mail).reduce((n, f) => n + f.count, 0) : 0;
  const running = progress?.state === 'running';
  const percent = progress && progress.total > 0 ? Math.min(100, Math.round((progress.done / progress.total) * 100)) : 0;

  return (
    <section aria-label={text('Import a data file')} className="mb-6 rounded-[12px] border border-line bg-surface p-4 text-[13px] text-ink">
      <h3 className="text-[15px] font-bold text-ink">Import a data file</h3>
      <p className="mt-1 text-ink-2">An Outlook data file (.pst), an .mbox file from Thunderbird, Apple Mail or Gmail Takeout, or a folder of .eml or .msg files. It is read on this computer and its mail is copied into your mailbox on the server, so it is on all your devices. Importing the same file again copies nothing twice.</p>
      {offline ? <p className="mt-2 rounded-[8px] bg-warning-bg px-3 py-2 text-[12.5px] text-warning">Importing needs the WorkSuite server. You are offline.</p> : null}
      <div className="mt-3 flex flex-wrap gap-2">
        <Button icon="upload" onClick={() => void pick('file')} disabled={offline || !!busy || running} loading={busy === 'pick' || busy === 'scan'}>
          Choose a .pst or .mbox file…
        </Button>
        <Button icon="folder" onClick={() => void pick('folder')} disabled={offline || !!busy || running}>
          Choose a folder of .eml files…
        </Button>
        <Button icon="file-text" onClick={() => void openOne()} disabled={!!busy}>
          Open an .eml or .msg file…
        </Button>
      </div>
      {error ? <p role="alert" className="mt-2 text-[12.5px] text-danger">{error}</p> : null}
      {file && scan ? (
        <div className="mt-4 flex flex-col gap-3">
          <p className="font-semibold">
            {file.name}
            <span className="ml-2 font-normal text-ink-3">{text('{n} messages in {f} folders', { n: counted.toLocaleString(), f: scan.folders.filter((f) => f.mail).length })}{file.size ? ` · ${bytes(file.size)}` : ''}</span>
          </p>
          {scan.unreadable.length ? (
            <p role="note" className="rounded-[8px] bg-warning-bg px-3 py-2 text-[12.5px] text-warning">{text('These parts of the file could not be read and are left out: {list}', { list: scan.unreadable.join(', ') })}</p>
          ) : null}
          {!progress ? (
            <>
              <div className="grid max-w-[520px] gap-2">
                <Select label={text('Into mailbox')} value={dest} options={own.map((b) => ({ value: String(b.id), label: b.email }))} onValueChange={(v) => (setInto(String(v)), reset())} />
                <label className="flex items-center gap-2">
                  <Checkbox checked={ownFolder} onChange={(e) => (setOwnFolder(e.target.checked), reset())} />
                  {text('In a folder of its own: Imported › {name}', { name: file.name })}
                </label>
                <label className="flex items-center gap-2">
                  <Checkbox checked={skipJunk} onChange={(e) => (setSkipJunk(e.target.checked), reset())} />
                  Leave out Junk
                </label>
                <label className="flex items-center gap-2">
                  <Checkbox checked={skipTrash} onChange={(e) => (setSkipTrash(e.target.checked), reset())} />
                  Leave out Deleted Items
                </label>
              </div>
              {!plan ? (
                <div>
                  <Button variant="primary" onClick={() => void makePlan()} disabled={offline || !dest || !!busy} loading={busy === 'plan'}>
                    See where each folder goes
                  </Button>
                </div>
              ) : (
                <>
                  <table className="w-full max-w-[720px] text-left text-[12.5px]">
                    <caption className="sr-only">{text('Where each folder goes')}</caption>
                    <thead>
                      <tr className="border-b border-line text-ink-3">
                        <th scope="col" className="py-1.5 font-semibold">Folder in the file</th>
                        <th scope="col" className="py-1.5 font-semibold">Messages</th>
                        <th scope="col" className="py-1.5 font-semibold">Goes to</th>
                      </tr>
                    </thead>
                    <tbody>
                      {plan.map((p) => (
                        <tr key={p.source} className="border-b border-line last:border-b-0">
                          <td className="py-1.5 pr-3">{p.label}</td>
                          <td className="py-1.5 pr-3">{(scan.folders.find((f) => f.path === p.source)?.count ?? 0).toLocaleString()}</td>
                          <td className="py-1.5">{p.destination && !p.skip_reason ? (p.destination_label ?? folderLabel(p.destination)) : <span className="text-ink-3">{text('Left out — {reason}', { reason: p.skip_reason ?? '' })}</span>}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <div className="flex gap-2">
                    <Button variant="primary" icon="download" onClick={() => void start()} disabled={offline || !!busy} loading={busy === 'start'}>
                      Import
                    </Button>
                    <Button onClick={reset}>Change</Button>
                  </div>
                </>
              )}
            </>
          ) : (
            <div className="flex max-w-[620px] flex-col gap-2">
              <div role="progressbar" aria-label={text('Import progress')} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} className="h-2 overflow-hidden rounded-full bg-subtle">
                <div className="h-full bg-primary transition-[width] motion-reduce:transition-none" style={{ width: `${progress.state === 'done' ? 100 : percent}%` }} />
              </div>
              <p aria-live="polite" className={progress.state === 'paused' ? 'text-warning' : 'text-ink-2'}>
                {progressWords(progress)}
                {running && progress.folder ? ` · ${progress.folder}` : ''}
              </p>
              {progress.unreadable.length ? <p className="text-[12.5px] text-ink-3">{text('Not read: {list}', { list: progress.unreadable.join(', ') })}</p> : null}
              <div className="flex gap-2">
                {running ? <Button onClick={() => void call('mailfile:cancel', { handle: file.id })}>Stop</Button> : null}
                {progress.state === 'paused' ? <Button variant="primary" onClick={() => void resume()} disabled={offline}>Resume</Button> : null}
                {running ? <span className="self-center text-[12px] text-ink-3">You can keep working; it carries on in the background.</span> : null}
              </div>
            </div>
          )}
        </div>
      ) : null}
      {history.data?.imports.length ? (
        <ul role="list" aria-label={text('Earlier data-file imports')} className="mt-4 border-t border-line pt-2">
          {history.data.imports.slice(0, 5).map((i) => (
            <li key={i.id} className="flex items-center gap-3 py-1.5 text-[12.5px]">
              <span className="min-w-0 flex-1 truncate">{i.name}</span>
              <span className="text-ink-3">{text('{n} copied · {s} skipped · {f} failed', { n: i.copied.toLocaleString(), s: i.skipped.toLocaleString(), f: i.failed.toLocaleString() })}</span>
              <Chip tone={i.state === 'done' ? (i.failed ? 'warning' : 'success') : i.state === 'running' ? 'indigo' : 'muted'}>{i.state === 'done' ? text('Done') : i.state === 'running' ? text('Importing') : text('Stopped')}</Chip>
            </li>
          ))}
        </ul>
      ) : null}
      <p className="mt-3 text-[12px] text-ink-3">Exporting to .pst is not possible: it is Outlook’s own format. A folder can be exported as .mbox or as .eml files from its menu.</p>
    </section>
  );
}

/** "Imported/old.pst/Clients" as the reader sees it. */
export function folderLabel(path: string): string {
  const decoded = path.replace(/&([^-]*)-/g, (_m, b64: string) => {
    if (!b64) return '&';
    try {
      const bin = atob(b64.replace(/,/g, '/'));
      let s = '';
      for (let i = 0; i + 1 < bin.length; i += 2) s += String.fromCharCode((bin.charCodeAt(i) << 8) | bin.charCodeAt(i + 1));
      return s;
    } catch {
      return b64;
    }
  });
  return decoded === 'INBOX' ? text('Inbox') : decoded.replace(/^INBOX\//, '').split('/').join(' › ');
}

/** Export a folder or a search result (DMO-DAT-03). */
export function ExportDialog({ mailbox, folder, folderName, items, onClose }: { mailbox: string | null; folder: string; folderName: string; items?: Array<{ uid: string; folder: string; mailbox: string | null }>; onClose: () => void }) {
  const policy = useDataFilePolicy();
  const [format, setFormat] = useState<'mbox' | 'eml'>('mbox');
  const [progress, setProgress] = useState<ExportProgress | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => on<ExportProgress>('mail:exportChanged', (p) => setProgress(p)), []);
  const run = async () => {
    setBusy(true);
    try {
      const r = await call('mail:export', { mailbox, folder, folderName, format, ...(items?.length ? { items } : {}) });
      if (r) {
        toast(r.failed ? 'warning' : 'success', r.cancelled ? text('Export stopped: {n} messages saved in {name}.', { n: r.count, name: r.name }) : r.failed ? text('{n} messages exported to {name}; {f} could not be read.', { n: r.count, name: r.name, f: r.failed }) : text('{n} messages exported to {name}.', { n: r.count, name: r.name }));
        onClose();
      }
    } catch (e) {
      toast('error', errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title={items?.length ? text('Export {n} messages', { n: items.length }) : text('Export {folder}', { folder: folderName })}
      labelledBy="mail-export-title"
      onClose={busy ? undefined : onClose}
      footer={
        <>
          {busy ? <Button onClick={() => void call('mail:exportCancel')}>Stop</Button> : <Button onClick={onClose}>Cancel</Button>}
          <Button variant="primary" icon="download" onClick={() => void run()} disabled={!policy.data?.export || busy} loading={busy}>
            Export…
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3 p-4 text-[13px] text-ink">
        {policy.isLoading ? <Spinner /> : !policy.data?.export ? (
          <p role="note" className="rounded-[8px] bg-warning-bg px-3 py-2 text-warning">Your organisation does not allow exporting mail to a file. Ask a mail administrator.</p>
        ) : (
          <>
            <fieldset className="flex flex-col gap-2">
              <legend className="mb-1 font-semibold">Save as</legend>
              <label className="flex items-center gap-2">
                <input type="radio" name="mail-export-format" checked={format === 'mbox'} onChange={() => setFormat('mbox')} />
                One .mbox file (Thunderbird, Apple Mail and most mail apps read it)
              </label>
              <label className="flex items-center gap-2">
                <input type="radio" name="mail-export-format" checked={format === 'eml'} onChange={() => setFormat('eml')} />
                A zip of .eml files, one per message
              </label>
            </fieldset>
            <p className="text-[12px] text-ink-3">Each message is exported exactly as the server keeps it. .pst cannot be written: it is Outlook’s own format. Exports are recorded in your organisation’s activity log.</p>
            {progress && busy ? <p aria-live="polite" className="text-ink-2">{text('{n} of {total}', { n: progress.done, total: progress.total })}</p> : null}
          </>
        )}
        {policy.error ? <ErrorNote error={policy.error} /> : null}
      </div>
    </Modal>
  );
}
