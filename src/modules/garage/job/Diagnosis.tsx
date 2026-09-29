import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { toast } from '../../../core/toasts';
import { Icon } from '../../../components/Icon';
import { Select } from '../../../components/Select';
import { ErrorNote, Modal, Spinner, cx } from '../../../components/ui';
import { btn, btnPrimary, btnSmall, Field, input } from '../../hr/parts';
import { OFFLINE_WRITE, refusalOf } from '../api';
import { addCode, addDiagnostic, diagnosticToEstimate, fetchDiagnostics, fetchEstimate, KB1, lookupParts, removeCode, signOff, updateDiagnostic, type Diagnostic } from '../api-b1';
import { Pill } from '../parts';
import type { JobTabProps } from '../registry';
import { AddFiles, Thumb, useJobUpload } from './media-kit';

/**
 * Diagnosis (SRS §3.11, WF-06, FR-DIA-01..05), stage B1: every complaint became
 * an open item at check-in. Record the finding, the cause, the repair, the
 * parts and hours it needs, and trouble codes as read; resolve it (or "no fault
 * found"); sign it off where the company asks for that; and put it on the
 * estimate. When the last item is resolved the server moves the job on.
 */
export default function Diagnosis({ job, company, online, onChanged }: JobTabProps) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: KB1.diagnostics(job.id), queryFn: ({ signal }) => fetchDiagnostics(job.id, signal) });
  const est = useQuery({ queryKey: KB1.estimate(job.id), queryFn: ({ signal }) => fetchEstimate(job.id, signal), enabled: !!company?.can.estimates });
  const mayDiagnose = !!company?.can.diagnose && !['draft', 'completed', 'cancelled'].includes(job.status);
  const mayEstimate = !!est.data?.estimate.can.create;
  const [editing, setEditing] = useState<Diagnostic | 'new' | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: KB1.diagnostics(job.id) });
    void qc.invalidateQueries({ queryKey: KB1.estimate(job.id) });
    onChanged();
  };
  const upload = useJobUpload(job.id, online, refresh);
  const act = async (key: string, fn: () => Promise<{ message?: string | null }>, done: string) => {
    if (!online) return toast('error', OFFLINE_WRITE);
    setBusy(key);
    try {
      const r = await fn();
      toast('success', r.message || done);
      refresh();
    } catch (e) {
      toast('error', refusalOf(e).message);
    } finally {
      setBusy(null);
    }
  };

  if (q.isLoading) return <Spinner />;
  if (q.error || !q.data) return <ErrorNote error={q.error} onRetry={() => void q.refetch()} />;
  const { items, priorities } = q.data;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <span className="flex-1 text-[12.5px] text-ink-2">
          {items.filter((x) => x.status === 'open').length} open of {items.length}
        </span>
        {mayDiagnose ? (
          <button type="button" className={btnSmall} disabled={!online} onClick={() => setEditing('new')}>
            <Icon name="plus" size={14} /> Add a finding
          </button>
        ) : null}
      </div>
      {!items.length ? <p className="m-0 text-[12.5px] text-ink-3">Nothing to diagnose yet: complaints become items when the vehicle is checked in.</p> : null}
      {items.map((d) => (
        <section key={d.id} aria-label={d.complaint ?? 'Finding'} className="flex flex-col gap-1.5 rounded-[12px] border border-line bg-surface px-4 py-3 text-[12.5px]">
          <div className="flex flex-wrap items-center gap-2">
            <b className="min-w-0 flex-1 text-[13.5px] text-ink">{d.complaint ?? 'Finding'}</b>
            {d.priority ? <Pill tone={d.priority === 'urgent' ? 'red' : d.priority === 'high' ? 'amber' : 'grey'}>{priorities[d.priority] ?? d.priority}</Pill> : null}
            <Pill tone={d.status === 'resolved' ? 'green' : 'amber'}>{d.status_label}</Pill>
            {d.signed_off_at ? <Pill tone="green">Signed off</Pill> : null}
            {d.on_estimate ? <Pill tone="blue">On the estimate</Pill> : null}
          </div>
          {d.finding ? (
            <p className="m-0 text-ink">
              <b>Found:</b> {d.finding}
              {d.cause ? ` — ${d.cause}` : ''}
            </p>
          ) : (
            <p className="m-0 text-ink-3">Not diagnosed yet.</p>
          )}
          {d.recommended_repair ? (
            <p className="m-0 text-ink-2">
              <b>Repair:</b> {d.recommended_repair}
              {d.estimated_labour_hours ? ` · ${d.estimated_labour_hours} h` : ''}
            </p>
          ) : null}
          {d.required_parts.length ? <p className="m-0 text-ink-2">Parts: {d.required_parts.map((p) => `${p.name ?? `#${p.product_id}`} × ${Number(p.qty)}`).join(', ')}</p> : null}
          {d.codes.length ? (
            <div className="flex flex-wrap gap-1">
              {d.codes.map((c) => (
                <span key={c.id} className="inline-flex items-center gap-1 rounded-[6px] bg-subtle px-1.5 py-0.5 font-mono text-[11.5px] text-ink" title={c.description ?? undefined}>
                  {c.code}
                  {mayDiagnose ? (
                    <button type="button" aria-label={`Remove ${c.code}`} className="text-ink-3 hover:text-danger" onClick={() => void act(`code:${c.id}`, () => removeCode(d.id, c.id), 'Code removed.')}>
                      <Icon name="x" size={11} />
                    </button>
                  ) : null}
                </span>
              ))}
            </div>
          ) : null}
          {d.media.length ? (
            <div className="flex flex-wrap gap-1">
              {d.media.map((m) => (
                <Thumb key={m.id} m={m} size={48} />
              ))}
            </div>
          ) : null}
          {mayDiagnose || mayEstimate ? (
            <div className="flex flex-wrap items-center gap-1.5 pt-1">
              {mayDiagnose ? (
                <>
                  <button type="button" className={btnSmall} disabled={!online} onClick={() => setEditing(d)}>
                    <Icon name="compose" size={13} /> Record
                  </button>
                  <CodeAdder disabled={!online || busy === `add:${d.id}`} onAdd={(code, description) => void act(`add:${d.id}`, () => addCode(d.id, { code, description }), `${code} recorded.`)} />
                  <AddFiles small disabled={!online} accept="image/*,video/*" label="Photo" onFiles={(files) => void upload.send(files.map((f) => ({ blob: f, name: f.name })), { context: 'diagnostic', context_id: d.id })} onPhoto={(blob, name) => void upload.send([{ blob, name }], { context: 'diagnostic', context_id: d.id })} />
                  {d.status === 'resolved' && !d.signed_off_at ? (
                    <button type="button" className={btnSmall} disabled={!online || !!busy} onClick={() => void act(`sign:${d.id}`, () => signOff(d.id), 'Signed off.')}>
                      Sign off
                    </button>
                  ) : null}
                </>
              ) : null}
              {mayEstimate && d.status === 'resolved' && !d.no_fault_found && d.recommended_repair && !d.on_estimate ? (
                <button type="button" className={btnSmall} disabled={!online || !!busy} onClick={() => void act(`est:${d.id}`, () => diagnosticToEstimate(d.id), 'On the estimate.')}>
                  <Icon name="receipt" size={13} /> Put on the estimate
                </button>
              ) : null}
            </div>
          ) : null}
        </section>
      ))}
      {editing ? <FindingSheet d={editing === 'new' ? null : editing} jobId={job.id} priorities={priorities} onClose={() => setEditing(null)} onSaved={() => (setEditing(null), refresh())} /> : null}
    </div>
  );
}

function CodeAdder({ disabled, onAdd }: { disabled: boolean; onAdd: (code: string, description: string) => void }) {
  const [code, setCode] = useState('');
  return (
    <span className="flex items-center gap-1">
      <input aria-label="Trouble code" placeholder="P0301" value={code} onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9-]/g, ''))} className={cx(input, 'h-[28px] w-[90px] font-mono text-[12px]')} maxLength={20} />
      <button type="button" className={btnSmall} disabled={disabled || code.length < 2} onClick={() => (onAdd(code, ''), setCode(''))}>
        Add code
      </button>
    </span>
  );
}

/** The body of `PATCH diagnostics/{id}` for what was typed. */
export function findingBody(f: { complaint: string; finding: string; cause: string; repair: string; hours: string; priority: string; resolved: boolean; noFault: boolean; parts: Array<{ product_id: number; qty: string; name: string }> }, isNew: boolean): Record<string, unknown> {
  const t = (v: string) => v.trim() || null;
  return {
    ...(isNew ? { complaint: f.complaint.trim() } : {}),
    finding: f.noFault ? 'No fault found' : t(f.finding),
    cause: t(f.cause),
    recommended_repair: t(f.repair),
    estimated_labour_hours: f.hours.trim() ? f.hours.trim() : null,
    priority: f.priority || null,
    no_fault_found: f.noFault,
    status: f.resolved || f.noFault ? 'resolved' : 'open',
    required_parts: f.parts.map((p) => ({ product_id: p.product_id, qty: p.qty || '1' })),
  };
}

function FindingSheet({ d, jobId, priorities, onClose, onSaved }: { d: Diagnostic | null; jobId: number; priorities: Record<string, string>; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState(() => ({
    complaint: d?.complaint ?? '',
    finding: d?.finding ?? '',
    cause: d?.cause ?? '',
    repair: d?.recommended_repair ?? '',
    hours: d?.estimated_labour_hours ?? '',
    priority: d?.priority ?? 'normal',
    resolved: d?.status === 'resolved',
    noFault: d?.no_fault_found ?? false,
    parts: (d?.required_parts ?? []).map((p) => ({ product_id: p.product_id, qty: String(Number(p.qty)), name: p.name ?? `#${p.product_id}` })),
  }));
  const [busy, setBusy] = useState(false);
  const [term, setTerm] = useState('');
  const [hits, setHits] = useState<Array<{ id: number; name: string; code: string | null }>>([]);
  const [partsNote, setPartsNote] = useState<string | null>(null);
  const set = (patch: Partial<typeof f>) => setF((x) => ({ ...x, ...patch }));

  useEffect(() => {
    if (term.trim().length < 2) return;
    const ctl = new AbortController();
    const h = setTimeout(() => {
      lookupParts(term.trim(), ctl.signal).then(
        (r) => (setHits(r.products ?? []), setPartsNote(null)),
        (e) => !ctl.signal.aborted && setPartsNote(refusalOf(e).status === 403 ? 'Finding a part needs the Inventory app.' : refusalOf(e).message),
      );
    }, 250);
    return () => {
      clearTimeout(h);
      ctl.abort();
    };
  }, [term]);

  const save = async () => {
    setBusy(true);
    try {
      const body = findingBody(f, !d);
      const r = d ? await updateDiagnostic(d.id, body) : await addDiagnostic(jobId, body);
      toast('success', r.message || 'Saved.');
      onSaved();
    } catch (e) {
      toast('error', refusalOf(e).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title={d ? d.complaint ?? 'Finding' : 'Add a finding'}
      width={620}
      onClose={onClose}
      footer={
        <>
          <button type="button" className={btn} onClick={onClose}>
            Cancel
          </button>
          <button type="button" className={btnPrimary} disabled={busy || (!d && !f.complaint.trim()) || ((f.resolved || f.noFault) && !f.finding.trim() && !f.noFault)} onClick={() => void save()}>
            Save
          </button>
        </>
      }
    >
      <div className="flex flex-col gap-2.5">
        {!d ? (
          <Field label="What was reported">
            <input autoFocus aria-label="Complaint" value={f.complaint} onChange={(e) => set({ complaint: e.target.value })} className={input} maxLength={500} />
          </Field>
        ) : null}
        <Field label="Finding">
          <textarea aria-label="Finding" value={f.finding} disabled={f.noFault} onChange={(e) => set({ finding: e.target.value })} rows={2} className={cx(input, 'h-auto py-2')} maxLength={2000} />
        </Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Cause">
            <input aria-label="Cause" value={f.cause} onChange={(e) => set({ cause: e.target.value })} className={input} maxLength={500} />
          </Field>
          <Field label="Priority">
            <Select aria-label="Priority" value={f.priority} onValueChange={(v) => set({ priority: v })} options={Object.entries(priorities).map(([value, label]) => ({ value, label }))} />
          </Field>
        </div>
        <div className="grid grid-cols-[1fr_120px] gap-2">
          <Field label="Recommended repair">
            <input aria-label="Recommended repair" value={f.repair} onChange={(e) => set({ repair: e.target.value })} className={input} maxLength={500} />
          </Field>
          <Field label="Labour hours">
            <input aria-label="Labour hours" inputMode="decimal" value={f.hours} onChange={(e) => set({ hours: e.target.value.replace(/[^\d.]/g, '') })} className={input} />
          </Field>
        </div>
        <Field label="Parts it needs">
          <div className="flex flex-col gap-1">
            {f.parts.map((p, i) => (
              <span key={`${p.product_id}-${i}`} className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate">{p.name}</span>
                <input aria-label={`${p.name} quantity`} inputMode="decimal" value={p.qty} onChange={(e) => set({ parts: f.parts.map((x, j) => (j === i ? { ...x, qty: e.target.value.replace(/[^\d.]/g, '') } : x)) })} className={cx(input, 'h-8 w-[70px]')} />
                <button type="button" aria-label={`Remove ${p.name}`} className="text-ink-3 hover:text-danger" onClick={() => set({ parts: f.parts.filter((_, j) => j !== i) })}>
                  <Icon name="x" size={14} />
                </button>
              </span>
            ))}
            <input aria-label="Find a part" placeholder="Find a part by name or code" value={term} onChange={(e) => setTerm(e.target.value)} className={input} />
            {partsNote ? <span className="text-[12px] text-warning">{partsNote}</span> : null}
            {term.trim().length >= 2 && hits.length ? (
              <div className="flex max-h-[140px] flex-col overflow-y-auto rounded-[8px] border border-line scroll-thin">
                {hits.slice(0, 20).map((h) => (
                  <button key={h.id} type="button" className="px-2.5 py-1.5 text-left text-[12.5px] hover:bg-subtle" onClick={() => (set({ parts: [...f.parts, { product_id: h.id, qty: '1', name: h.name }] }), setTerm(''), setHits([]))}>
                    {h.name} {h.code ? <span className="text-ink-3">· {h.code}</span> : null}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        </Field>
        <div className="flex flex-wrap gap-4 text-[12.5px] font-semibold text-ink">
          <label className="flex items-center gap-1.5">
            <input type="checkbox" checked={f.resolved} onChange={(e) => set({ resolved: e.target.checked })} /> Diagnosed (resolved)
          </label>
          <label className="flex items-center gap-1.5">
            <input type="checkbox" checked={f.noFault} onChange={(e) => set({ noFault: e.target.checked })} /> No fault found
          </label>
        </div>
      </div>
    </Modal>
  );
}
