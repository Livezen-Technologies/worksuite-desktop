import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { toast } from '../../../core/toasts';
import { Icon } from '../../../components/Icon';
import { Select } from '../../../components/Select';
import { ErrorNote, Modal, Spinner, cx } from '../../../components/ui';
import { btn, btnPrimary, btnSmall, Field, input, Panel } from '../../hr/parts';
import { OFFLINE_WRITE, refusalOf, tempId } from '../api';
import {
  addRemoved,
  cancelPart,
  fetchParts,
  fetchPartsCatalogue,
  fetchPartsOptions,
  issueRequest,
  KB3,
  markUsed,
  orderPart,
  requestPart,
  reserveApproved,
  reservePart,
  returnPart,
  setDisposition,
  type PartRequest,
} from '../api-b3';
import { Pill } from '../parts';
import type { JobTabProps } from '../registry';

/**
 * Parts on the job (SRS §17, FR-PRT-01..08, SM-06), stage B3: what the
 * customer approved against what was requested, reserved, issued, used and
 * returned — every figure a copy of what Inventory did. Request a part,
 * reserve (all that was approved, or one), note an order, issue at the job
 * (the parts counter does the same by scan), mark what was used and return
 * the rest in its condition, and give every removed part a disposition.
 */
const TONE = (s: string): 'blue' | 'amber' | 'green' | 'grey' => (s === 'consumed' || s === 'issued' || s === 'partially_returned' ? 'green' : s === 'reserved' ? 'blue' : s === 'cancelled' ? 'grey' : 'amber');
type Ask = { kind: 'request' } | { kind: 'order' | 'cancel' | 'issue' | 'used' | 'return'; r: PartRequest } | { kind: 'removed' };

export default function Parts({ job, company, online, onChanged }: JobTabProps) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: KB3.parts(job.id), queryFn: ({ signal }) => fetchParts(job.id, signal) });
  const opts = useQuery({ queryKey: KB3.partsOptions, queryFn: ({ signal }) => fetchPartsOptions(signal), staleTime: 10 * 60_000 });
  const [ask, setAsk] = useState<Ask | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: KB3.parts(job.id) });
    onChanged();
  };
  const act = async (key: string, fn: () => Promise<{ message?: string | null }>, done: string) => {
    if (!online) {
      toast('error', OFFLINE_WRITE);
      return false;
    }
    setBusy(key);
    try {
      const r = await fn();
      toast('success', r.message || done);
      refresh();
      return true;
    } catch (e) {
      toast('error', refusalOf(e).message);
      return false;
    } finally {
      setBusy(null);
    }
  };

  if (q.isLoading) return <Spinner />;
  if (q.error || !q.data) return <ErrorNote error={q.error} onRetry={() => void q.refetch()} />;
  const p = q.data.parts;
  const mayUse = !!company?.can.work || p.can.issue || p.can.return;
  const labels = opts.data;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="flex-1 text-[12.5px] text-ink-2">{p.warehouse_id ? 'From the branch’s warehouse.' : 'This branch takes its parts from no warehouse yet (Set-up → Branches).'}</span>
        {p.can.reserve && (p.unrequested.length || p.requests.some((r) => r.status === 'requested' || r.status === 'purchase_requested')) ? (
          <button
            type="button"
            className={btnPrimary}
            disabled={!online || !!busy}
            onClick={() =>
              void act(
                'reserve-all',
                () =>
                  reserveApproved(job.id).then((r) => {
                    for (const s of r.data.result.short) toast('warning', `${s.product}: ${s.why}`);
                    return r;
                  }),
                'Reserved what Inventory has.',
              )
            }
          >
            <Icon name="package" size={15} /> Reserve what was approved
          </button>
        ) : null}
        {p.can.request ? (
          <button type="button" className={btnSmall} disabled={!online} onClick={() => setAsk({ kind: 'request' })}>
            <Icon name="plus" size={13} /> Request a part
          </button>
        ) : null}
      </div>

      {p.balance.length ? (
        <Panel title="By part" sub="Approved against what Inventory did">
          <div className="grid grid-cols-[minmax(0,1fr)_repeat(6,64px)] gap-2 border-b border-line px-3.5 py-1.5 text-[11px] font-bold tracking-[.4px] text-ink-3 uppercase">
            <span>Part</span>
            <span>Approved</span>
            <span>Asked</span>
            <span>Reserved</span>
            <span>Issued</span>
            <span>Used</span>
            <span>Back</span>
          </div>
          {p.balance.map((b) => (
            <div key={b.product_id} className="grid grid-cols-[minmax(0,1fr)_repeat(6,64px)] items-center gap-2 border-b border-line/70 px-3.5 py-1.5 text-[12.5px] tabular-nums last:border-b-0">
              <span className="min-w-0 truncate">
                <b className="text-ink">{b.name}</b> {b.code ? <span className="text-ink-3">· {b.code}</span> : null} {b.beyond_approved > 0 ? <Pill tone="amber">{b.beyond_approved} beyond approval</Pill> : null}
              </span>
              <span>{b.approved}</span>
              <span>{b.requested}</span>
              <span>{b.reserved}</span>
              <span>{b.issued}</span>
              <span>{b.used}</span>
              <span>{b.returned}</span>
            </div>
          ))}
        </Panel>
      ) : null}

      {p.unrequested.length ? (
        <Panel title="Approved, not requested yet">
          {p.unrequested.map((u) => (
            <div key={u.estimate_item_id} className="border-b border-line/70 px-3.5 py-1.5 text-[12.5px] last:border-b-0">
              <b className="text-ink">{u.description}</b> <span className="text-ink-3">× {u.qty}</span>
            </div>
          ))}
        </Panel>
      ) : null}

      <Panel title="Requests" sub={`${p.requests.length}`}>
        {p.requests.map((r) => {
          const u = r.usage;
          const open = u ? u.issued - u.used - u.returned : 0;
          return (
            <div key={r.id} className="flex flex-col gap-1 border-b border-line/70 px-3.5 py-2 text-[12.5px] last:border-b-0">
              <span className="flex flex-wrap items-center gap-2">
                <b className="min-w-0 flex-1 truncate text-ink">
                  {r.product.name} <span className="font-normal text-ink-3">× {r.qty}</span>
                </b>
                {r.urgency === 'urgent' ? <Pill tone="red">Urgent</Pill> : null}
                <Pill tone={TONE(r.status)}>{r.status_label}</Pill>
              </span>
              <span className="text-ink-3">
                {[r.reason, r.requisition_ref ? `order ${r.requisition_ref}` : null, u ? `issued ${u.issued}, used ${u.used}, back ${u.returned}${u.serial_no ? ` · ${u.serial_no}` : ''}${u.batch_no ? ` · batch ${u.batch_no}` : ''}` : null, r.requested_by?.name].filter(Boolean).join(' · ')}
              </span>
              <span className="flex flex-wrap gap-1">
                {p.can.reserve && (r.status === 'requested' || r.status === 'purchase_requested') ? (
                  <button type="button" className={btnSmall} disabled={!online || !!busy} onClick={() => void act(`res:${r.id}`, () => reservePart(r.id), 'Reserved.')}>
                    Reserve
                  </button>
                ) : null}
                {p.can.reserve && r.status === 'requested' ? (
                  <button type="button" className={btnSmall} disabled={!online} onClick={() => setAsk({ kind: 'order', r })}>
                    Ordered…
                  </button>
                ) : null}
                {p.can.issue && (r.status === 'reserved' || r.status === 'requested') ? (
                  <button type="button" className={btnSmall} disabled={!online} onClick={() => setAsk({ kind: 'issue', r })}>
                    Issue
                  </button>
                ) : null}
                {mayUse && r.status === 'issued' && open > 0 ? (
                  <button type="button" className={btnSmall} disabled={!online} onClick={() => setAsk({ kind: 'used', r })}>
                    Used…
                  </button>
                ) : null}
                {p.can.return && r.status === 'issued' && open > 0 ? (
                  <button type="button" className={btnSmall} disabled={!online} onClick={() => setAsk({ kind: 'return', r })}>
                    Return…
                  </button>
                ) : null}
                {(p.can.reserve || p.can.issue) && ['requested', 'purchase_requested', 'reserved'].includes(r.status) ? (
                  <button type="button" className={btnSmall} disabled={!online} onClick={() => setAsk({ kind: 'cancel', r })}>
                    Cancel
                  </button>
                ) : null}
              </span>
            </div>
          );
        })}
        {!p.requests.length ? <div className="px-3.5 py-4 text-[12.5px] text-ink-3">No part requested yet. Approved parts are requested — and reserved — when the customer approves.</div> : null}
      </Panel>

      <Panel
        title="Removed parts"
        sub="Each needs a disposition before delivery"
        action={
          p.can.removed ? (
            <button type="button" className={btnSmall} disabled={!online} onClick={() => setAsk({ kind: 'removed' })}>
              <Icon name="plus" size={13} /> Add
            </button>
          ) : null
        }
      >
        {p.removed.map((x) => (
          <div key={x.id} className="flex items-center gap-2 border-b border-line/70 px-3.5 py-1.5 text-[12.5px] last:border-b-0">
            <b className="min-w-0 flex-1 truncate text-ink">{x.description}</b>
            {p.can.removed ? (
              <Select aria-label={`${x.description} disposition`} value={x.disposition ?? ''} onValueChange={(v) => v && void act(`disp:${x.id}`, () => setDisposition(x.id, { disposition: v }), 'Disposition recorded.')} options={[{ value: '', label: 'No disposition yet' }, ...Object.entries(labels?.dispositions ?? {}).map(([value, label]) => ({ value, label }))]} />
            ) : (
              <span className="text-ink-2">{x.disposition_label ?? 'No disposition yet'}</span>
            )}
          </div>
        ))}
        {!p.removed.length ? <div className="px-3.5 py-3 text-[12.5px] text-ink-3">None recorded.</div> : null}
      </Panel>

      {ask?.kind === 'request' ? <RequestSheet jobId={job.id} onClose={() => setAsk(null)} onSave={(body) => void act('request', () => requestPart(job.id, { ...body, client_temp_id: tempId() }), 'Requested.').then((ok) => ok && setAsk(null))} /> : null}
      {ask?.kind === 'order' ? <OneField title={`${ask.r.product.name}: ordered`} label="Order or requisition reference" onClose={() => setAsk(null)} onSave={(t) => void act('order', () => orderPart(ask.r.id, t), 'Noted as ordered.').then((ok) => ok && setAsk(null))} /> : null}
      {ask?.kind === 'cancel' ? <OneField title={`Cancel the request for ${ask.r.product.name}`} label="Why" onClose={() => setAsk(null)} onSave={(t) => void act('cancel', () => cancelPart(ask.r.id, t), 'Cancelled; the reservation went back to Inventory.').then((ok) => ok && setAsk(null))} /> : null}
      {ask?.kind === 'issue' ? <IssueSheet r={ask.r} mayOverride={p.can.override} onClose={() => setAsk(null)} onSave={(body) => void act('issue', () => issueRequest(ask.r.id, body), 'Issued.').then((ok) => ok && setAsk(null))} /> : null}
      {ask?.kind === 'used' ? <OneField title={`${ask.r.product.name}: used on the vehicle`} label={`How many (of ${ask.r.usage ? ask.r.usage.issued - ask.r.usage.returned : ask.r.qty})`} numeric onClose={() => setAsk(null)} onSave={(t) => void act('used', () => markUsed(ask.r.id, Number(t)), 'Recorded.').then((ok) => ok && setAsk(null))} /> : null}
      {ask?.kind === 'return' ? <ReturnSheet r={ask.r} conditions={labels?.return_conditions ?? { new: 'New', opened: 'Opened', damaged: 'Damaged' }} onClose={() => setAsk(null)} onSave={(body) => void act('return', () => returnPart(ask.r.id, body), 'Returned to Inventory.').then((ok) => ok && setAsk(null))} /> : null}
      {ask?.kind === 'removed' ? <RemovedSheet dispositions={labels?.dispositions ?? {}} requests={p.requests} onClose={() => setAsk(null)} onSave={(body) => void act('removed', () => addRemoved(job.id, body), 'Recorded.').then((ok) => ok && setAsk(null))} /> : null}
    </div>
  );
}

function RequestSheet({ jobId, onClose, onSave }: { jobId: number; onClose: () => void; onSave: (body: { product_id: number; qty: number; urgency: string; reason?: string }) => void }) {
  const [term, setTerm] = useState('');
  const [hits, setHits] = useState<Array<{ id: number; name: string; code: string | null; available: number | null; approved: number }>>([]);
  const [picked, setPicked] = useState<{ id: number; name: string } | null>(null);
  const [qty, setQty] = useState('1');
  const [urgent, setUrgent] = useState(false);
  const [reason, setReason] = useState('');
  useEffect(() => {
    if (term.trim().length < 2) return;
    const ctl = new AbortController();
    const h = setTimeout(() => {
      fetchPartsCatalogue(jobId, term.trim(), ctl.signal).then(
        (r) => setHits(r.items),
        () => undefined,
      );
    }, 250);
    return () => {
      clearTimeout(h);
      ctl.abort();
    };
  }, [term, jobId]);
  return (
    <Modal
      title="Request a part"
      width={520}
      onClose={onClose}
      footer={
        <>
          <button type="button" className={btn} onClick={onClose}>
            Cancel
          </button>
          <button type="button" className={btnPrimary} disabled={!picked || !(Number(qty) > 0)} onClick={() => picked && onSave({ product_id: picked.id, qty: Number(qty), urgency: urgent ? 'urgent' : 'normal', ...(reason.trim() ? { reason: reason.trim() } : {}) })}>
            Request
          </button>
        </>
      }
    >
      <div className="flex flex-col gap-2.5">
        {picked ? (
          <span className="flex items-center gap-2 text-[13px]">
            <b className="flex-1">{picked.name}</b>
            <button type="button" className={btnSmall} onClick={() => setPicked(null)}>
              Change
            </button>
          </span>
        ) : (
          <>
            <input autoFocus aria-label="Find a part" placeholder="Name, code or barcode" value={term} onChange={(e) => setTerm(e.target.value)} className={input} />
            {term.trim().length >= 2 ? (
              <div className="flex max-h-[180px] flex-col overflow-y-auto rounded-[8px] border border-line scroll-thin">
                {hits.map((h) => (
                  <button key={h.id} type="button" className="flex gap-2 px-2.5 py-1.5 text-left text-[12.5px] hover:bg-subtle" onClick={() => setPicked({ id: h.id, name: h.name })}>
                    <span className="min-w-0 flex-1 truncate">
                      {h.name} {h.code ? <span className="text-ink-3">· {h.code}</span> : null}
                    </span>
                    <span className="text-ink-3">{[h.available !== null ? `${h.available} here` : null, h.approved ? `${h.approved} approved` : null].filter(Boolean).join(' · ')}</span>
                  </button>
                ))}
                {!hits.length ? <span className="px-2.5 py-1.5 text-[12px] text-ink-3">Nothing matches.</span> : null}
              </div>
            ) : null}
          </>
        )}
        <div className="grid grid-cols-2 gap-2">
          <Field label="Quantity">
            <input aria-label="Quantity" inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value.replace(/[^\d.]/g, ''))} className={input} />
          </Field>
          <label className="flex items-end gap-1.5 pb-2 text-[12.5px] font-semibold">
            <input type="checkbox" checked={urgent} onChange={(e) => setUrgent(e.target.checked)} /> Urgent
          </label>
        </div>
        <Field label="Why (optional)">
          <input aria-label="Why" value={reason} onChange={(e) => setReason(e.target.value)} className={input} maxLength={255} />
        </Field>
      </div>
    </Modal>
  );
}

function IssueSheet({ r, mayOverride, onClose, onSave }: { r: PartRequest; mayOverride: boolean; onClose: () => void; onSave: (body: Record<string, unknown>) => void }) {
  const [qty, setQty] = useState(String(r.qty));
  const [serial, setSerial] = useState('');
  const [batch, setBatch] = useState('');
  const [override, setOverride] = useState(false);
  const [reason, setReason] = useState('');
  const serialised = r.product.tracking === 'serial';
  return (
    <Modal
      title={`Issue ${r.product.name}`}
      width={460}
      onClose={onClose}
      footer={
        <>
          <button type="button" className={btn} onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className={btnPrimary}
            disabled={(serialised && !serial.trim()) || (override && !reason.trim())}
            onClick={() => onSave({ qty: serialised ? 1 : Number(qty) || 1, ...(serial.trim() ? { serial_no: serial.trim() } : {}), ...(batch.trim() ? { batch_no: batch.trim() } : {}), ...(override ? { override: true, override_reason: reason.trim() } : {}) })}
          >
            Issue
          </button>
        </>
      }
    >
      <div className="flex flex-col gap-2.5">
        {serialised ? (
          <Field label="Serial number" hint="One unit at a time.">
            <input autoFocus aria-label="Serial number" value={serial} onChange={(e) => setSerial(e.target.value)} className={input} maxLength={120} />
          </Field>
        ) : (
          <Field label="Quantity">
            <input autoFocus aria-label="Quantity" inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value.replace(/[^\d.]/g, ''))} className={input} />
          </Field>
        )}
        {r.product.tracking === 'batch' ? (
          <Field label="Batch" hint="Empty: Inventory picks the one to use first.">
            <input aria-label="Batch" value={batch} onChange={(e) => setBatch(e.target.value)} className={input} maxLength={120} />
          </Field>
        ) : null}
        {mayOverride ? (
          <>
            <label className="flex items-center gap-1.5 text-[12.5px] font-semibold">
              <input type="checkbox" checked={override} onChange={(e) => setOverride(e.target.checked)} /> More than the customer approved
            </label>
            {override ? <input aria-label="Why more than approved" placeholder="Why" value={reason} onChange={(e) => setReason(e.target.value)} className={input} maxLength={255} /> : null}
          </>
        ) : null}
      </div>
    </Modal>
  );
}

function ReturnSheet({ r, conditions, onClose, onSave }: { r: PartRequest; conditions: Record<string, string>; onClose: () => void; onSave: (body: { qty?: number; condition: string; serial_no?: string; note?: string }) => void }) {
  const open = r.usage ? r.usage.issued - r.usage.used - r.usage.returned : r.qty;
  const [qty, setQty] = useState(String(open));
  const [condition, setCondition] = useState('');
  const [note, setNote] = useState('');
  return (
    <Modal
      title={`Return ${r.product.name}`}
      width={440}
      onClose={onClose}
      footer={
        <>
          <button type="button" className={btn} onClick={onClose}>
            Cancel
          </button>
          <button type="button" className={btnPrimary} disabled={!condition || !(Number(qty) > 0)} onClick={() => onSave({ qty: Number(qty), condition, ...(r.usage?.serial_no ? { serial_no: r.usage.serial_no } : {}), ...(note.trim() ? { note: note.trim() } : {}) })}>
            Return
          </button>
        </>
      }
    >
      <div className="flex flex-col gap-2.5">
        <Field label={`Quantity (up to ${open})`}>
          <input aria-label="Quantity" inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value.replace(/[^\d.]/g, ''))} className={input} />
        </Field>
        <div role="radiogroup" aria-label="Condition" className="flex gap-1">
          {Object.entries(conditions).map(([k, label]) => (
            <button key={k} type="button" role="radio" aria-checked={condition === k} onClick={() => setCondition(k)} className={cx('h-8 rounded-[7px] px-3 text-[12.5px] font-semibold', condition === k ? 'bg-primary text-white' : 'border border-line bg-surface text-ink-2')}>
              {label}
            </button>
          ))}
        </div>
        <input aria-label="Note" placeholder="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)} className={input} maxLength={255} />
      </div>
    </Modal>
  );
}

function RemovedSheet({ dispositions, requests, onClose, onSave }: { dispositions: Record<string, string>; requests: PartRequest[]; onClose: () => void; onSave: (body: { description: string; request_id?: number; disposition?: string; note?: string }) => void }) {
  const [description, setDescription] = useState('');
  const [request, setRequest] = useState('');
  const [disposition, setDispo] = useState('');
  const [note, setNote] = useState('');
  return (
    <Modal
      title="A removed part"
      width={480}
      onClose={onClose}
      footer={
        <>
          <button type="button" className={btn} onClick={onClose}>
            Cancel
          </button>
          <button type="button" className={btnPrimary} disabled={!description.trim()} onClick={() => onSave({ description: description.trim(), ...(request ? { request_id: Number(request) } : {}), ...(disposition ? { disposition } : {}), ...(note.trim() ? { note: note.trim() } : {}) })}>
            Save
          </button>
        </>
      }
    >
      <div className="flex flex-col gap-2.5">
        <input autoFocus aria-label="What was removed" placeholder="Old front brake pads" value={description} onChange={(e) => setDescription(e.target.value)} className={input} maxLength={255} />
        <Select aria-label="Replaced by" value={request} onValueChange={setRequest} options={[{ value: '', label: 'Not tied to a part issued' }, ...requests.filter((r) => r.usage).map((r) => ({ value: String(r.id), label: r.product.name }))]} />
        <Select aria-label="Disposition" value={disposition} onValueChange={setDispo} options={[{ value: '', label: 'Decide later' }, ...Object.entries(dispositions).map(([value, label]) => ({ value, label }))]} />
        <input aria-label="Note" placeholder="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)} className={input} maxLength={255} />
      </div>
    </Modal>
  );
}

function OneField({ title, label, numeric, onClose, onSave }: { title: string; label: string; numeric?: boolean; onClose: () => void; onSave: (t: string) => void }) {
  const [t, setT] = useState('');
  return (
    <Modal
      title={title}
      width={440}
      onClose={onClose}
      footer={
        <>
          <button type="button" className={btn} onClick={onClose}>
            Cancel
          </button>
          <button type="button" className={btnPrimary} disabled={!t.trim()} onClick={() => onSave(t.trim())}>
            Save
          </button>
        </>
      }
    >
      <Field label={label}>
        <input autoFocus aria-label={label} inputMode={numeric ? 'decimal' : undefined} value={t} onChange={(e) => setT(numeric ? e.target.value.replace(/[^\d.]/g, '') : e.target.value)} className={input} maxLength={120} />
      </Field>
    </Modal>
  );
}
