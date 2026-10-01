import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { apiDelete, apiGet, apiPost, apiPut, request } from '../../core/api';
import { app } from '../../core/app-state';
import { errorMessage } from '../../core/bridge';
import { useStore } from '../../core/store';
import { relative } from '../../core/time';
import { toast } from '../../core/toasts';
import { Icon } from '../../components/Icon';
import { Select } from '../../components/Select';
import { ErrorNote, Spinner, cx } from '../../components/ui';
import { btn, btnPrimary, btnSmall, Caps, Field, input, PageHead, Sheet, SidePanel } from '../hr/parts';
import { useOwners } from './Leads';
import { crmCan } from './parts';
import { Checkbox } from '../../components/Checkbox';

/**
 * Lead intake (CrmIntake, CrmIntakeSheet): web forms that post leads here —
 * each source has its own address, which can be copied, changed (the old one
 * stops at once) or removed — what each delivery was judged to be, and a
 * spreadsheet of leads, previewed before anything is written. Sources need
 * CRM settings; importing needs lead rights.
 */
interface Source {
  id: number;
  org_id: number;
  name: string;
  url: string;
  owner_id: number | null;
  owner_name: string | null;
  source: string | null;
  field_map: Record<string, string> | null;
  active: boolean;
  received: number;
  last_received_at: string | null;
}
interface Delivery {
  id: number;
  outcome: 'created' | 'duplicate' | 'refused' | 'failed' | 'unknown';
  lead_id: number | null;
  note: string | null;
  body: string | null;
  ip: string | null;
  at: string;
}
interface ImportResult {
  preview: boolean;
  counts: { created: number; duplicate: number; refused: number };
  rows: Array<{ line: number; outcome: 'created' | 'duplicate' | 'refused'; label: string; why: string | null }>;
  more: number;
  columns: string[];
}

const OUTCOME: Record<string, [string, string]> = {
  created: ['New lead', 'bg-[#E4F4EA] text-[#145C39] dark:bg-success-bg dark:text-success'],
  duplicate: ['Already here', 'bg-selection text-primary'],
  refused: ['Refused', 'bg-[#FCE9E4] text-[#8C2A14] dark:bg-danger-bg dark:text-danger'],
  failed: ['Failed', 'bg-[#FCE9E4] text-[#8C2A14] dark:bg-danger-bg dark:text-danger'],
  unknown: ['Unknown', 'bg-subtle text-ink-2'],
};

function Outcome({ o }: { o: string }) {
  const [label, cls] = OUTCOME[o] ?? OUTCOME.unknown!;
  return <span className={cx('rounded-full px-2 py-0.5 text-[11px] font-bold', cls)}>{label}</span>;
}

const masked = (url: string) => url.replace(/[a-f0-9]{40}$/i, '••••••••');

export default function Intake() {
  const qc = useQueryClient();
  const perms = useStore(app, (s) => s.bootstrap?.permissions);
  const orgId = useStore(app, (s) => s.organizationId);
  const canSources = crmCan(perms, 'crm.settings');
  const canImport = crmCan(perms, 'crm.lead');
  const [editing, setEditing] = useState<Source | 'new' | null>(null);
  const [log, setLog] = useState<Source | null>(null);
  const [rotating, setRotating] = useState<Source | null>(null);
  const [removing, setRemoving] = useState<Source | null>(null);
  const [importing, setImporting] = useState(false);
  const q = useQuery({ queryKey: ['crm', 'intake', orgId], queryFn: ({ signal }) => apiGet<{ sources: Source[]; fields: string[] }>('/api/crm/intake-sources', { org: orgId ?? undefined }, signal), enabled: canSources, retry: false });
  const refresh = () => void qc.invalidateQueries({ queryKey: ['crm', 'intake'] });
  const sources = q.data?.sources ?? [];
  const act = async (fn: () => Promise<unknown>, done: string) => {
    try {
      await fn();
      toast('success', done);
      refresh();
      return true;
    } catch (e) {
      toast('error', errorMessage(e));
      return false;
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto scroll-thin">
      <PageHead title="Lead intake" sub="Web forms that post leads here, and spreadsheets of them.">
        {canImport ? (
          <button type="button" className={btn} onClick={() => setImporting(true)}>
            <Icon name="upload" size={14} />
            Import a spreadsheet
          </button>
        ) : null}
        {canSources ? (
          <button type="button" className={btnPrimary} onClick={() => setEditing('new')}>
            New source
          </button>
        ) : null}
      </PageHead>
      {!canSources ? (
        <p className="m-0 rounded-[10px] border border-line bg-surface px-4 py-3 text-[13px] text-ink-2">Web-form sources are set up by someone with CRM settings. You can still import a spreadsheet of leads.</p>
      ) : q.isLoading ? (
        <Spinner />
      ) : q.error ? (
        <ErrorNote error={q.error} onRetry={() => void q.refetch()} />
      ) : !sources.length ? (
        <div className="flex max-w-[520px] flex-col items-start gap-2 rounded-[12px] border border-line bg-surface p-5">
          <b className="text-[15px] text-ink">No source yet</b>
          <p className="m-0 text-[13px] text-ink-2">A source gives a website its own address to post enquiries to. Leads that arrive through one are numbered, assigned and scored exactly like a lead somebody typed.</p>
          <button type="button" className={btnPrimary} onClick={() => setEditing('new')}>
            New source
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
          {sources.map((s) => (
            <div key={s.id} data-source={s.id} className="flex flex-col gap-2.5 rounded-[12px] border border-line bg-surface p-4">
              <div className="flex items-center gap-2">
                <b className="min-w-0 flex-1 truncate text-[14px] text-ink">{s.name}</b>
                {!s.active ? <span className="rounded-full bg-subtle px-2 py-0.5 text-[11px] font-bold text-ink-2">Paused</span> : null}
                <button type="button" className={btnSmall} onClick={() => setLog(s)}>
                  Deliveries
                </button>
                <button type="button" className={btnSmall} onClick={() => setEditing(s)}>
                  Edit
                </button>
              </div>
              <span className="text-[12.5px] text-ink-2">
                {s.received} {s.received === 1 ? 'lead' : 'leads'} received{s.last_received_at ? ` · last ${relative(s.last_received_at)}` : ''} · owned by {s.owner_name ?? 'nobody'}
                {s.source ? ` · source "${s.source}"` : ''}
              </span>
              <div className="flex items-center gap-2 rounded-[8px] bg-subtle px-2.5 py-2">
                <code className="min-w-0 flex-1 truncate font-mono text-[12px] text-ink">{masked(s.url)}</code>
                <button type="button" className={btnSmall} onClick={() => void navigator.clipboard.writeText(s.url).then(() => toast('success', 'Address copied. Paste it into the form that will post here.'))}>
                  Copy
                </button>
                <button type="button" className={btnSmall} onClick={() => setRotating(s)}>
                  Change
                </button>
                <button type="button" className={cx(btnSmall, 'text-danger')} onClick={() => setRemoving(s)}>
                  Remove
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {editing ? <SourceEditor source={editing === 'new' ? null : editing} fields={q.data?.fields ?? []} orgId={orgId} onClose={() => setEditing(null)} onSaved={() => (setEditing(null), refresh())} /> : null}
      {log ? <Deliveries source={log} onClose={() => setLog(null)} /> : null}
      {rotating ? (
        <Sheet
          title="New address for this source"
          width={420}
          onClose={() => setRotating(null)}
          footer={
            <>
              <button type="button" className={btn} onClick={() => setRotating(null)}>
                Cancel
              </button>
              <button type="button" className={btnPrimary} onClick={() => void act(() => apiPost(`/api/crm/intake-sources/${rotating.id}/token`), 'The address changed. Give the form the new one.').then((ok) => ok && setRotating(null))}>
                Change it
              </button>
            </>
          }
        >
          <p className="m-0 text-[13px] text-ink-2">Whatever is posting to {rotating.name} stops working the moment this changes, until it is given the new address. Nothing that already arrived is affected.</p>
        </Sheet>
      ) : null}
      {removing ? (
        <Sheet
          title="Remove this source"
          width={420}
          onClose={() => setRemoving(null)}
          footer={
            <>
              <button type="button" className={btn} onClick={() => setRemoving(null)}>
                Cancel
              </button>
              <button type="button" className={cx(btnPrimary, 'bg-danger hover:bg-danger')} onClick={() => void act(() => apiDelete(`/api/crm/intake-sources/${removing.id}`), 'Source removed.').then((ok) => ok && setRemoving(null))}>
                Remove
              </button>
            </>
          }
        >
          <p className="m-0 text-[13px] text-ink-2">{removing.name} stops accepting anything at once. Leads that already arrived through it stay where they are.</p>
        </Sheet>
      ) : null}
      {importing ? <ImportSheet orgId={orgId} onClose={() => setImporting(false)} onDone={() => void qc.invalidateQueries({ queryKey: ['crm'] })} /> : null}
    </div>
  );
}

function SourceEditor({ source, fields, orgId, onClose, onSaved }: { source: Source | null; fields: string[]; orgId: string | number | null | undefined; onClose: () => void; onSaved: () => void }) {
  const owners = useOwners();
  const [name, setName] = useState(source?.name ?? '');
  const [from, setFrom] = useState(source?.source ?? '');
  const [owner, setOwner] = useState(source?.owner_id ? String(source.owner_id) : '');
  const [active, setActive] = useState(source?.active ?? true);
  const [maps, setMaps] = useState<Array<{ a: string; b: string }>>(Object.entries(source?.field_map ?? {}).map(([a, b]) => ({ a, b })));
  const [busy, setBusy] = useState(false);
  const save = async () => {
    if (!name.trim() || busy) return;
    setBusy(true);
    const field_map = Object.fromEntries(maps.filter((m) => m.a.trim() && m.b).map((m) => [m.a.trim(), m.b]));
    const body = { name: name.trim(), source: from.trim() || null, owner_id: owner ? Number(owner) : null, field_map, active };
    try {
      if (source) await apiPut(`/api/crm/intake-sources/${source.id}`, body);
      else await apiPost('/api/crm/intake-sources', { ...body, org_id: orgId ? Number(orgId) : undefined });
      toast('success', source ? 'Saved.' : 'Source made. Copy its address into the form.');
      onSaved();
    } catch (e) {
      toast('error', errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet
      title={source ? `Edit ${source.name}` : 'New intake source'}
      width={480}
      onClose={onClose}
      footer={
        <>
          <button type="button" className={btn} onClick={onClose}>
            Cancel
          </button>
          <button type="button" className={btnPrimary} disabled={!name.trim() || busy} onClick={() => void save()}>
            Save
          </button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        {!source ? <p className="m-0 text-[13px] text-ink-2">A website posts its enquiries to this source's own address.</p> : null}
        <Field label="What to call it">
          <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Contact form on the website" aria-label="Source name" className={input} />
        </Field>
        <Field label="Where it came from" hint="Written on each lead as its source">
          <input value={from} maxLength={40} onChange={(e) => setFrom(e.target.value)} placeholder="Website" aria-label="Where it came from" className={input} />
        </Field>
        <Field label="Who gets the leads">
          <Select label="Owner" value={owner} onValueChange={setOwner} options={[{ value: '', label: 'Nobody (unassigned)' }, ...(owners.data?.owners ?? []).map((o) => ({ value: String(o.id), label: o.name }))]} />
        </Field>
        <label className="flex items-center gap-2 text-[13px] text-ink">
          <Checkbox checked={active} onChange={(e) => setActive(e.target.checked)} />
          Accepting submissions
        </label>
        <div className="flex flex-col gap-1.5">
          <b className="text-[13px] text-ink">What the form calls its fields</b>
          <span className="text-[12px] text-ink-3">Only needed when the form uses names other than name, email, message.</span>
          {maps.map((m, i) => (
            <div key={i} className="flex items-center gap-2">
              <input value={m.a} onChange={(e) => setMaps(maps.map((x, j) => (j === i ? { ...x, a: e.target.value } : x)))} placeholder="what the form sends" aria-label={`Form field ${i + 1}`} className={input} />
              <span className="text-ink-3">→</span>
              <Select<string> label={`Lead field ${i + 1}`} placeholder="Choose a field" value={m.b || null} onValueChange={(v) => setMaps(maps.map((x, j) => (j === i ? { ...x, b: v } : x)))} options={fields.map((f) => ({ value: f, label: f.replace(/_/g, ' ') }))} />
              <button type="button" aria-label={`Remove mapping ${i + 1}`} onClick={() => setMaps(maps.filter((_, j) => j !== i))} className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[6px] text-ink-3 hover:bg-subtle hover:text-danger">
                <Icon name="x" size={13} />
              </button>
            </div>
          ))}
          <button type="button" className={cx(btnSmall, 'self-start')} onClick={() => setMaps([...maps, { a: '', b: '' }])}>
            Add a mapping
          </button>
        </div>
      </div>
    </Sheet>
  );
}

function Deliveries({ source, onClose }: { source: Source; onClose: () => void }) {
  const q = useQuery({ queryKey: ['crm', 'intake', 'events', source.id], queryFn: ({ signal }) => apiGet<{ events: Delivery[] }>(`/api/crm/intake-sources/${source.id}/events`, undefined, signal), staleTime: 0, refetchOnMount: 'always' });
  return (
    <SidePanel
      label="Deliveries"
      width={520}
      onClose={onClose}
      head={
        <span className="flex flex-col">
          <b className="text-[15px] text-ink">{source.name}</b>
          <span className="text-[12px] text-ink-3">Every delivery, and what it was judged to be.</span>
        </span>
      }
    >
      {q.isLoading ? <Spinner /> : q.error ? <ErrorNote error={q.error} onRetry={() => void q.refetch()} /> : null}
      {q.data && !q.data.events.length ? <p className="m-0 text-[13px] text-ink-3">Nothing has arrived yet.</p> : null}
      <div className="flex flex-col gap-2">
        {(q.data?.events ?? []).map((e) => (
          <div key={e.id} className="flex flex-col gap-1.5 rounded-[10px] border border-line p-3 text-[12.5px]">
            <div className="flex items-center gap-2">
              <Outcome o={e.outcome} />
              <span className="text-ink-2">{relative(e.at)}</span>
              <span className="flex-1" />
              {e.ip ? <span className="font-mono text-[11.5px] text-ink-3">{e.ip}</span> : null}
            </div>
            {e.note ? <span className="text-ink">{e.note}</span> : null}
            {e.body ? (
              <details>
                <summary className="cursor-pointer text-[12px] font-semibold text-primary">What arrived</summary>
                <pre className="mt-1.5 max-h-[220px] overflow-auto rounded-[8px] bg-subtle p-2 font-mono text-[11.5px] whitespace-pre-wrap text-ink-2">{e.body}</pre>
              </details>
            ) : null}
          </div>
        ))}
      </div>
    </SidePanel>
  );
}

function ImportSheet({ orgId, onClose, onDone }: { orgId: string | number | null | undefined; onClose: () => void; onDone: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const picker = useRef<HTMLInputElement>(null);
  const [source, setSource] = useState('');
  const [result, setResult] = useState<ImportResult | null>(null);
  const [busy, setBusy] = useState(false);
  const choose = (f: File | undefined) => {
    if (!f) return;
    if (f.size > 5 * 1024 * 1024) return toast('error', 'That file is larger than 5 MB. Split it and import the parts.');
    setFile(f);
    setResult(null);
  };
  const send = async (preview: boolean) => {
    if (!file || busy) return;
    setBusy(true);
    try {
      const form = new FormData();
      form.append('file', file, file.name);
      form.append('preview', preview ? '1' : '0');
      if (orgId) form.append('org_id', String(orgId));
      if (source.trim()) form.append('source', source.trim());
      const r = await request<{ data: ImportResult; message: string }>('POST', '/api/crm/leads/import', { body: form });
      const data = (r as unknown as { data?: ImportResult }).data ?? (r as unknown as ImportResult);
      setResult(data);
      if (!preview) {
        toast('success', `${data.counts.created} imported, ${data.counts.duplicate} already here, ${data.counts.refused} refused.`);
        onDone();
      }
    } catch (e) {
      toast('error', errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const written = result && !result.preview;
  return (
    <Sheet
      title="Import leads from a spreadsheet"
      width={600}
      onClose={onClose}
      footer={
        <>
          <button type="button" className={btn} onClick={onClose}>
            {written ? 'Done' : 'Close'}
          </button>
          {!written ? (
            <button type="button" className={btn} disabled={!file || busy} onClick={() => void send(true)}>
              See what would happen
            </button>
          ) : null}
          {result?.preview && result.counts.created > 0 ? (
            <button type="button" className={btnPrimary} disabled={busy} onClick={() => void send(false)}>
              Import {result.counts.created}
            </button>
          ) : null}
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <p className="m-0 text-[13px] text-ink-2">Nothing is written until you have seen what would happen. The first row must name the columns — first_name, last_name, company, email, phone, notes and the like.</p>
        <Field label="The file" hint="CSV up to 5 MB">
          <input ref={picker} type="file" hidden accept=".csv,text/csv" aria-label="CSV file" onChange={(e) => (choose(e.target.files?.[0]), (e.target.value = ''))} />
          <button type="button" onClick={() => picker.current?.click()} className={cx(input, 'flex items-center gap-2 text-left')}>
            <Icon name="file-sheet" size={15} className="text-ink-3" />
            {file ? (
              <>
                <b className="min-w-0 flex-1 truncate">{file.name}</b>
                <span className="text-ink-3">· {Math.max(1, Math.round(file.size / 1024))} KB</span>
              </>
            ) : (
              <span className="text-ink-3">Choose a CSV…</span>
            )}
          </button>
        </Field>
        <Field label="Where they came from">
          <input value={source} maxLength={40} onChange={(e) => setSource(e.target.value)} placeholder="Trade show, March" aria-label="Where they came from" className={input} />
        </Field>
        {result ? (
          <div className="flex flex-col gap-2">
            <div className="flex gap-3 text-[13px] font-semibold">
              <span className="text-[#145C39] dark:text-success">{result.counts.created} new</span>
              <span className="text-primary">{result.counts.duplicate} already here</span>
              <span className="text-danger">{result.counts.refused} refused</span>
            </div>
            <span className="text-[12px] text-ink-3">
              {result.preview ? 'Nothing has been written yet. ' : ''}Columns read: {result.columns.join(', ') || '—'}
            </span>
            <div className="max-h-[260px] overflow-y-auto rounded-[10px] border border-line scroll-thin">
              <div className="flex gap-2 border-b border-line bg-[#F7F8FB] px-2.5 py-1.5 text-[11px] font-bold tracking-[.4px] text-ink-3 uppercase dark:bg-well">
                <span className="w-[50px]">Line</span>
                <span className="min-w-0 flex-1">Who</span>
                <span className="w-[200px]">What happens</span>
              </div>
              {result.rows.map((r) => (
                <div key={r.line} className="flex items-center gap-2 border-b border-line/60 px-2.5 py-1.5 text-[12.5px] last:border-b-0">
                  <span className="w-[50px] text-ink-3 tabular-nums">{r.line}</span>
                  <span className="min-w-0 flex-1 truncate text-ink">{r.label}</span>
                  <span className="flex w-[200px] items-center gap-1.5">
                    <Outcome o={r.outcome} />
                    {r.why ? <span className="truncate text-[11.5px] text-ink-3" title={r.why}>{r.why}</span> : null}
                  </span>
                </div>
              ))}
            </div>
            {result.more ? <span className="text-[12px] text-ink-3">and {result.more} more lines, not listed.</span> : null}
            <Caps>{written ? 'Imported' : 'Preview'}</Caps>
          </div>
        ) : null}
      </div>
    </Sheet>
  );
}
