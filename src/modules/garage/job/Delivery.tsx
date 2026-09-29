import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useCanOpen } from '../../../core/access';
import { call } from '../../../core/bridge';
import { openWebLink } from '../../../core/tab-context';
import { dateLabel, timeLabel } from '../../../core/time';
import { toast } from '../../../core/toasts';
import { FileViewer } from '../../../components/FileViewer';
import { Icon } from '../../../components/Icon';
import { Modal, Spinner, cx } from '../../../components/ui';
import { btnPrimary, btnSmall, Field, input, Panel } from '../../hr/parts';
import { amount, distance, OFFLINE_WRITE, refusalOf } from '../api';
import { fetchInvoice, fetchReview, handOver, handoverBody, KB3, markReady, raiseInvoice, type DeliveryTab, type ReviewItem } from '../api-b3';
import { Pill } from '../parts';
import type { JobTabProps } from '../registry';
import { SignaturePad } from './SignaturePad';

/**
 * Invoice & handover (SRS §19, §28.10–11, FR-DLV-01..06, WF-17/18), stage B3,
 * in the order the counter works: the final review and "ready for delivery";
 * the invoice raised once through Billing from approved work only (parts at
 * what was used, labour at the timer's time — WorkSuite's figures, shown as
 * sent); the release check (paid, or on credit terms — else an override with
 * a reason, for those who may); and the handover signed by whoever collects,
 * kept as a delivery note the server hashes. Payment itself is Billing's.
 */
const STATE_TONE: Record<ReviewItem['state'], 'green' | 'red' | 'amber' | 'grey'> = { ok: 'green', blocked: 'red', confirm: 'amber', not_required: 'grey' };
const STATE_WORD: Record<ReviewItem['state'], string> = { ok: 'Done', blocked: 'Not yet', confirm: 'Confirm', not_required: 'Not needed' };
const stamp = (s: string | null | undefined) => (s ? `${dateLabel(s)} ${timeLabel(s)}` : '—');

export default function Delivery({ job, company, options, online, onChanged }: JobTabProps) {
  const d = job.delivery as DeliveryTab;
  const [present, setPresent] = useState(false);
  const inReview = job.status === 'quality_check' || job.status === 'road_test';
  const review = useQuery({ queryKey: KB3.review(job.id, present), queryFn: ({ signal }) => fetchReview(job.id, present, signal), enabled: inReview, placeholderData: (p) => p });
  const inv = useQuery({ queryKey: KB3.invoice(job.id), queryFn: ({ signal }) => fetchInvoice(job.id, signal), enabled: job.status === 'ready_for_delivery' || job.status === 'invoice_pending' || job.status === 'completed' });
  const billing = useCanOpen('billing');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState(false);
  const act = async (fn: () => Promise<{ message?: string | null }>, done: string) => {
    if (!online) {
      toast('error', OFFLINE_WRITE);
      return false;
    }
    setBusy(true);
    try {
      const r = await fn();
      toast('success', r.message || done);
      onChanged();
      return true;
    } catch (e) {
      toast('error', refusalOf(e).message);
      return false;
    } finally {
      setBusy(false);
    }
  };
  const rv = review.data?.review ?? d.final_review;
  const invoice = inv.data?.invoice ?? d.invoice;
  const preview = inv.data?.preview ?? d.invoice_preview;

  return (
    <div className="flex flex-col gap-3">
      {inReview && rv ? (
        <Panel title="Final review" sub={rv.clear ? 'Everything is ready.' : 'What stands before delivery'}>
          {rv.items.map((i) => (
            <div key={i.key} className="flex items-center gap-2.5 border-b border-line/70 px-3.5 py-2 text-[12.5px] last:border-b-0">
              <Pill tone={STATE_TONE[i.state]}>{STATE_WORD[i.state]}</Pill>
              <b className="w-[180px] shrink-0 text-ink">{i.label}</b>
              <span className="min-w-0 flex-1 text-ink-2">{i.detail ?? ''}</span>
            </div>
          ))}
          {(review.data?.belongings ?? d.belongings).length ? (
            <label className="flex items-start gap-2 border-t border-line px-3.5 py-2.5 text-[12.5px] font-semibold text-ink">
              <input type="checkbox" checked={present} onChange={(e) => setPresent(e.target.checked)} className="mt-0.5" /> These are in the vehicle: {(review.data?.belongings ?? d.belongings).join(', ')}.
            </label>
          ) : null}
          {d.can.ready ? (
            <div className="flex justify-end border-t border-line px-3.5 py-2.5">
              <button type="button" className={btnPrimary} disabled={!online || busy} onClick={() => void act(() => markReady(job.id, { customer_items_present: present }), 'Ready for delivery.')}>
                <Icon name="check" size={15} /> Mark ready for delivery
              </button>
            </div>
          ) : null}
        </Panel>
      ) : null}

      {job.status === 'ready_for_delivery' ? (
        inv.isLoading ? (
          <Spinner />
        ) : (
          <InvoicePreviewPanel preview={preview} currency={job.currency} can={{ create: d.can.invoice, issue: d.can.issue, terms: !!inv.data?.can.terms }} busy={busy} online={online} onRaise={(body) => void act(() => raiseInvoice(job.id, body), 'The invoice is raised.')} />
        )
      ) : null}

      {invoice ? (
        <Panel
          title={`Invoice ${invoice.number ?? '(draft)'}`}
          sub={`${invoice.status}${invoice.due_date ? ` · due ${dateLabel(invoice.due_date)}` : ''}`}
          action={
            billing ? (
              <button type="button" className={btnSmall} onClick={() => openWebLink(`/billing?invoice=${invoice.id}`)}>
                Open in Invoices
              </button>
            ) : null
          }
        >
          <dl className="m-0 flex flex-wrap gap-x-6 gap-y-1 px-3.5 py-2.5 text-[12.5px]">
            {(
              [
                ['Total', invoice.total],
                ['Paid', invoice.paid],
                ['Credited', invoice.credited],
                ['Outstanding', invoice.outstanding],
              ] as Array<[string, string | undefined]>
            )
              .filter(([, v]) => v !== undefined)
              .map(([k, v]) => (
                <div key={k} className="flex flex-col">
                  <dt className="text-[11.5px] text-ink-3">{k}</dt>
                  <dd className="m-0 font-bold text-ink tabular-nums">{amount(v, invoice.currency)}</dd>
                </div>
              ))}
          </dl>
          {invoice.payments?.length ? <div className="border-t border-line px-3.5 py-2 text-[12px] text-ink-2">{invoice.payments.map((p) => `${amount(p.amount, invoice.currency)} ${p.method ?? ''} ${p.paid_on ? dateLabel(p.paid_on) : ''}`).join(' · ')}</div> : null}
          <p className="m-0 border-t border-line px-3.5 py-2 text-[12px] text-ink-3">Payments are taken in Invoices; this reads them back.</p>
        </Panel>
      ) : null}

      {job.status === 'invoice_pending' && d.release ? (
        <p className={cx('m-0 rounded-[9px] px-3 py-2 text-[12.5px] font-semibold', d.release.basis ? 'bg-success-bg text-success' : 'bg-warning-bg text-warning')}>
          {d.release.basis === 'paid' ? 'Paid: the vehicle may be released.' : d.release.basis === 'credit' ? 'On the customer’s credit terms: the vehicle may be released.' : `Not released yet: ${d.release.why ?? 'the invoice is not paid.'}`}
        </p>
      ) : null}

      {job.status === 'invoice_pending' && d.can.handover ? (
        <HandoverForm job={job} options={options} belongings={d.belongings} blocked={!d.release?.basis} mayOverride={d.can.override_release} mayOverrideOdometer={!!company?.can.override_odometer} busy={busy} online={online} onSave={(body) => void act(() => handOver(job.id, body), 'Handed over. The delivery note is signed.')} />
      ) : null}

      {d.handover ? (
        <Panel
          title="Handed over"
          sub={stamp(d.handover.handed_over_at)}
          action={
            <span className="flex gap-1">
              <button type="button" className={btnSmall} onClick={() => setNote(true)}>
                <Icon name="file-text" size={13} /> The delivery note
              </button>
              <button type="button" className={btnSmall} onClick={() => void call('transfers:download', { garageFile: { kind: 'delivery-note', job: job.id }, name: `delivery-note-${job.number}.pdf` }).catch((e) => toast('error', refusalOf(e).message))}>
                <Icon name="download" size={13} /> Save a copy
              </button>
            </span>
          }
        >
          <dl className="m-0 grid grid-cols-2 gap-x-4 gap-y-1 px-3.5 py-2.5 text-[12.5px] md:grid-cols-3">
            {(
              [
                ['Received by', d.handover.received_by],
                ['Delivered by', d.handover.delivered_by?.name],
                ['Odometer out', distance(d.handover.odometer, company?.distance_unit)],
                ['Released', d.handover.release_basis === 'override' ? `Override: ${d.handover.override?.reason ?? ''}` : d.handover.release_basis],
                ['Returned', d.handover.items_returned.join(', ') || null],
                ['Signed', d.handover.signature ? `${d.handover.signature.signer ?? ''}${d.handover.signature.relation ? ` (${d.handover.signature.relation})` : ''}` : null],
              ] as Array<[string, string | null | undefined]>
            ).map(([k, v]) => (
              <div key={k} className="flex min-w-0 flex-col">
                <dt className="text-[11.5px] text-ink-3">{k}</dt>
                <dd className="m-0 truncate font-semibold text-ink">{v || '—'}</dd>
              </div>
            ))}
          </dl>
          <p className={cx('m-0 border-t border-line px-3.5 py-2 font-mono text-[11px]', d.handover.document_intact ? 'text-ink-3' : 'text-danger')}>
            {d.handover.document_intact ? 'Signed document intact' : 'The signed document does not match its hash'} · SHA-256 {d.handover.document_hash}
          </p>
        </Panel>
      ) : null}

      {!inReview && !['ready_for_delivery', 'invoice_pending', 'completed'].includes(job.status) ? <p className="m-0 text-[12.5px] text-ink-3">The final review opens once the quality check has passed.</p> : null}
      {note ? (
        <Modal title="Vehicle delivery note" width={900} onClose={() => setNote(false)}>
          <div className="h-[70vh]">
            <FileViewer path={`/api/garage/jobs/${job.id}/delivery-note`} name={`delivery-note-${job.number}.pdf`} />
          </div>
        </Modal>
      ) : null}
    </div>
  );
}

function InvoicePreviewPanel({ preview, currency, can, busy, online, onRaise }: { preview: DeliveryTab['invoice_preview']; currency: string; can: { create: boolean; issue: boolean; terms: boolean }; busy: boolean; online: boolean; onRaise: (body: { payment_terms_days: number; issue: boolean }) => void }) {
  const [terms, setTerms] = useState('0');
  const [issue, setIssue] = useState(true);
  if (!preview) return <p className="m-0 text-[12.5px] text-ink-3">The invoice is shown to those who may see the job’s money.</p>;
  return (
    <Panel title="The invoice to raise" sub="Approved work only: parts as used, labour at the timer’s time">
      {preview.lines.map((l, i) => (
        <div key={`${l.estimate_item_id}-${i}`} className="flex items-center gap-2.5 border-b border-line/70 px-3.5 py-1.5 text-[12.5px] last:border-b-0">
          <span className="min-w-0 flex-1 truncate text-ink">{l.description}</span>
          <span className="text-ink-3">{l.basis === 'used' ? 'as used' : l.basis === 'time' ? 'timer' : 'as approved'}</span>
          <span className="w-[80px] text-right tabular-nums">
            {String(l.qty)}
            {l.unit ? ` ${l.unit}` : ''}
          </span>
          <span className="w-[110px] text-right tabular-nums">{amount(l.unit_price)}</span>
        </div>
      ))}
      {preview.excluded.length ? (
        <div className="border-t border-line px-3.5 py-2 text-[12px] text-ink-3">
          <b className="text-ink-2">Not on it:</b> {preview.excluded.map((x) => `${x.description} — ${x.why}`).join('; ')}
        </div>
      ) : null}
      {preview.problems.length ? (
        <div role="alert" className="border-t border-line bg-danger-bg px-3.5 py-2 text-[12.5px] text-danger">
          {preview.problems.join(' ')}
        </div>
      ) : null}
      {preview.totals ? (
        <div className="flex justify-end gap-6 border-t border-line px-3.5 py-2 text-[12.5px]">
          <span>Subtotal {amount(preview.totals.subtotal)}</span>
          <span>Tax {amount(preview.totals.tax)}</span>
          <b>Total {amount(preview.totals.total, preview.currency ?? currency)}</b>
        </div>
      ) : null}
      {can.create ? (
        <div className="flex flex-wrap items-end justify-end gap-3 border-t border-line px-3.5 py-2.5 text-[12.5px]">
          <Field label="Payment terms (days)" hint={can.terms ? '0: due on delivery' : 'Terms need Invoices’ permission'}>
            <input aria-label="Payment terms" inputMode="numeric" disabled={!can.terms} value={terms} onChange={(e) => setTerms(e.target.value.replace(/[^\d]/g, ''))} className={cx(input, 'w-[110px]')} />
          </Field>
          {can.issue ? (
            <label className="flex items-center gap-1.5 pb-2 font-semibold">
              <input type="checkbox" checked={issue} onChange={(e) => setIssue(e.target.checked)} /> Issue it now
            </label>
          ) : (
            <span className="pb-2 text-ink-3">It waits in Invoices as a draft for somebody who may issue it.</span>
          )}
          <button type="button" className={btnPrimary} disabled={!online || busy || preview.problems.length > 0 || !preview.lines.length} onClick={() => onRaise({ payment_terms_days: Number(terms) || 0, issue: can.issue && issue })}>
            <Icon name="receipt" size={15} /> Raise the invoice
          </button>
        </div>
      ) : null}
    </Panel>
  );
}

function HandoverForm({ job, options, belongings, blocked, mayOverride, mayOverrideOdometer, busy, online, onSave }: { job: JobTabProps['job']; options: JobTabProps['options']; belongings: string[]; blocked: boolean; mayOverride: boolean; mayOverrideOdometer: boolean; busy: boolean; online: boolean; onSave: (body: Record<string, unknown>) => void }) {
  const [f, setF] = useState(() => ({ odometer: '', fuel: '', receivedBy: job.customer?.name ?? '', relation: '', signature: '', items: [...belongings], removedReturned: false, notes: '', summary: '', override: '', odometerReason: '' }));
  const set = (patch: Partial<typeof f>) => setF((x) => ({ ...x, ...patch }));
  const last = job.vehicle?.odometer ?? null;
  const lower = f.odometer !== '' && last !== null && Number(f.odometer) < last;
  const ready = !!f.odometer && !!f.fuel && !!f.receivedBy.trim() && !!f.signature && (!blocked || (mayOverride && !!f.override.trim())) && (!lower || (mayOverrideOdometer && !!f.odometerReason.trim()));
  return (
    <Panel title="Hand over the vehicle">
      <div className="flex flex-col gap-2.5 p-3.5 text-[12.5px]">
        <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
          <Field label="Odometer out" hint={last !== null ? `Last ${distance(last)}` : undefined}>
            <input aria-label="Odometer out" inputMode="numeric" value={f.odometer} onChange={(e) => set({ odometer: e.target.value.replace(/[^\d]/g, '') })} className={input} />
          </Field>
          <div className="flex flex-col gap-1">
            <span className="font-semibold text-ink">Fuel</span>
            <div role="radiogroup" aria-label="Fuel out" className="flex gap-1">
              {Object.keys(options.checkin.fuel_marks).map((m) => (
                <button key={m} type="button" role="radio" aria-checked={f.fuel === m} onClick={() => set({ fuel: m })} className={cx('h-8 min-w-[40px] rounded-[7px] px-2 font-bold', f.fuel === m ? 'bg-primary text-white' : 'border border-line bg-surface text-ink-2')}>
                  {m}
                </button>
              ))}
            </div>
          </div>
          <Field label="Collected by">
            <input aria-label="Collected by" value={f.receivedBy} onChange={(e) => set({ receivedBy: e.target.value })} className={input} maxLength={150} />
          </Field>
        </div>
        {lower ? (
          mayOverrideOdometer ? (
            <input aria-label="Why the odometer is lower" placeholder="Why is it lower than the last reading?" value={f.odometerReason} onChange={(e) => set({ odometerReason: e.target.value })} className={input} maxLength={255} />
          ) : (
            <p className="m-0 text-warning">Lower than the last reading: only somebody allowed to accept a lower reading can record it.</p>
          )
        ) : null}
        {belongings.length ? (
          <div className="flex flex-wrap gap-3">
            <b className="text-ink">Returned:</b>
            {belongings.map((b) => (
              <label key={b} className="flex items-center gap-1.5">
                <input type="checkbox" checked={f.items.includes(b)} onChange={(e) => set({ items: e.target.checked ? [...f.items, b] : f.items.filter((x) => x !== b) })} /> {b}
              </label>
            ))}
          </div>
        ) : null}
        <label className="flex items-center gap-1.5 font-semibold">
          <input type="checkbox" checked={f.removedReturned} onChange={(e) => set({ removedReturned: e.target.checked })} /> Removed parts handed back
        </label>
        <input aria-label="Summary for the customer" placeholder="What was done, for the delivery note (optional)" value={f.summary} onChange={(e) => set({ summary: e.target.value })} className={input} maxLength={1000} />
        {blocked ? (
          mayOverride ? (
            <input aria-label="Why release without payment" placeholder="Release without payment or terms: why?" value={f.override} onChange={(e) => set({ override: e.target.value })} className={input} maxLength={255} />
          ) : (
            <p className="m-0 font-semibold text-warning">The invoice must be paid, or on the customer’s terms, before the vehicle is released.</p>
          )
        ) : null}
        <div className="grid grid-cols-[1fr_200px] gap-2">
          <Field label="Signature of whoever collects">
            <SignaturePad onChange={(png) => set({ signature: png ?? '' })} />
          </Field>
          <Field label="Relation">
            <input aria-label="Relation" placeholder="Owner, driver…" value={f.relation} onChange={(e) => set({ relation: e.target.value })} className={input} maxLength={60} />
          </Field>
        </div>
        <div className="flex justify-end gap-2">
          <button type="button" className={btnPrimary} disabled={!online || busy || !ready} onClick={() => onSave(handoverBody(f))}>
            <Icon name="check" size={15} /> Hand over
          </button>
        </div>
      </div>
    </Panel>
  );
}
