import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { app } from '../../core/app-state';
import { call, errorMessage } from '../../core/bridge';
import { useStore } from '../../core/store';
import { dateLabel, relative, timeLabel } from '../../core/time';
import { toast } from '../../core/toasts';
import { Icon } from '../../components/Icon';
import { ErrorNote, Spinner, cx } from '../../components/ui';
import { btn, btnPrimary, Empty, Field, input, Sheet } from '../hr/parts';
import {
  amount,
  can,
  cancelInvoice,
  deleteDraft,
  duplicateInvoice,
  fetchInvoice,
  fetchTaxes,
  filePdf,
  invoiceName,
  issueInvoice,
  K,
  markSent,
  methodLabel,
  unallocate,
  updateInvoice,
  type InvoiceDetail,
} from './api';
import { Lines, toEdit, toSend, type EditLine } from './Lines';
import { StatusChip } from './parts';
import RecordPayment from './RecordPayment';

/**
 * One invoice (BillInvoiceEditor, BillInvoiceIssued, BillInvoiceSheet). A
 * draft opens in the editor: its lines, discount, due date, notes and terms
 * are saved together, and Issue numbers it and freezes its figures. An issued
 * invoice is read-only — its PDF, recording how it was sent, a payment,
 * duplicating it, and cancelling it while nothing has been paid. Settlement
 * shows the payments and credit notes against it; History what happened.
 */
type Tab = 'lines' | 'settle' | 'history';
type Asking = 'issue' | 'sent' | 'cancel' | 'delete' | { unallocate: number; reference: string };

type Links = { onOpenPayment: (id: number) => void; onOpenNote: (id: number) => void; /** Raise a credit note against this invoice (absent without billing.credit). */ onCredit?: () => void };

export default function InvoiceView({ id, org, onClose, onOpen, ...links }: { id: number; org: string; onClose: () => void; onOpen: (id: number) => void } & Links) {
  const q = useQuery({ queryKey: K.invoice(id), queryFn: ({ signal }) => fetchInvoice(id, signal) });
  if (q.isLoading) return <Spinner />;
  if (q.error) return <ErrorNote error={q.error} onRetry={() => void q.refetch()} />;
  const inv = q.data!.invoice;
  // Keyed by what the server last said, so a save or an issue starts the editor again from its figures.
  return <Loaded key={`${inv.id}-${inv.status}-${inv.total}-${inv.lines.length}`} inv={inv} editable={q.data!.editable} org={org} onClose={onClose} onOpen={onOpen} {...links} />;
}

function Loaded({ inv, editable, org, onClose, onOpen, onOpenPayment, onOpenNote, onCredit }: { inv: InvoiceDetail; editable: boolean; org: string; onClose: () => void; onOpen: (id: number) => void } & Links) {
  const qc = useQueryClient();
  const perms = useStore(app, (s) => s.bootstrap?.permissions);
  const taxes = useQuery({ queryKey: K.taxes, queryFn: ({ signal }) => fetchTaxes(signal), staleTime: 300_000 });
  const [tab, setTab] = useState<Tab>('lines');
  const [lines, setLines] = useState<EditLine[]>(() => toEdit(inv.lines));
  const [discount, setDiscount] = useState(inv.discount ? String(inv.discount) : '');
  const [dueDate, setDueDate] = useState(inv.due_date ?? '');
  const [notes, setNotes] = useState(inv.notes ?? '');
  const [terms, setTerms] = useState(inv.terms ?? '');
  const [dirty, setDirty] = useState(false);
  const [asking, setAsking] = useState<Asking | null>(null);
  const [words, setWords] = useState('');
  const [paying, setPaying] = useState(false);
  const [busy, setBusy] = useState(false);
  const draft = inv.status === 'draft';
  const mayEdit = editable && can(perms, 'billing.invoice');
  const mayIssue = can(perms, 'billing.issue');
  const mayPay = can(perms, 'billing.payment');
  const notesChanged = notes !== (inv.notes ?? '') || terms !== (inv.terms ?? '');
  const refresh = () => void qc.invalidateQueries({ queryKey: K.all });
  const change = <T,>(set: (v: T) => void) => (v: T) => {
    set(v);
    setDirty(true);
  };

  const run = async (fn: () => Promise<unknown>, done: string | null, after?: () => void) => {
    setBusy(true);
    try {
      await fn();
      if (done) toast('success', done);
      setAsking(null);
      setWords('');
      after?.();
      refresh();
      return true;
    } catch (e) {
      toast('error', errorMessage(e));
      return false;
    } finally {
      setBusy(false);
    }
  };
  const saveDraft = () =>
    updateInvoice(inv.id, {
      lines: toSend(lines),
      discount: Number(discount.replace(/,/g, '')) || 0,
      ...(dueDate ? { due_date: dueDate } : {}),
      notes,
      terms,
    }).then(() => setDirty(false));
  const issue = () =>
    run(
      async () => {
        if (dirty || notesChanged) await saveDraft();
        const r = await issueInvoice(inv.id);
        toast('success', r.message ?? 'Issued.');
        for (const p of r.data.posting?.problems ?? []) toast('error', p);
      },
      null,
    );
  const pdf = async () => {
    try {
      if (perms?.includes('*') || perms?.includes('share.download')) {
        await call('transfers:download', { invoicePdf: inv.id, name: `${inv.number ?? `DRAFT-${inv.id}`}.pdf`, open: true });
      } else {
        const f = await filePdf(inv.id);
        await call('transfers:download', { fileId: String(f.file_id), name: f.name || `${inv.number ?? `DRAFT-${inv.id}`}.pdf`, open: true });
      }
      toast('success', 'Downloading the PDF — see Transfers.');
    } catch (e) {
      toast('error', errorMessage(e));
    }
  };
  const settled = inv.paid + inv.credited;

  return (
    <div className="flex flex-col gap-3" data-invoice-view={inv.id}>
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="flex items-center gap-2">
            <b className="text-[20px] text-ink">{draft ? 'Draft invoice' : inv.number}</b>
            <StatusChip status={inv.status} />
            {inv.days_overdue > 0 ? <b className="text-[12.5px] text-danger">{inv.days_overdue} {inv.days_overdue === 1 ? 'day' : 'days'} late</b> : null}
          </span>
          <span className="truncate text-[12.5px] text-ink-3">{[inv.client ?? 'No customer', inv.project, inv.po_number ? `PO ${inv.po_number}` : null].filter(Boolean).join(' · ')}</span>
        </div>
        {draft ? (
          <>
            {mayEdit ? (
              <button type="button" className={btn} disabled={busy || !(dirty || notesChanged)} onClick={() => void run(saveDraft, 'Draft saved.')}>
                Save draft
              </button>
            ) : null}
            {mayIssue ? (
              <button type="button" className={btnPrimary} disabled={busy || !toSend(lines).length} onClick={() => setAsking('issue')}>
                Issue
              </button>
            ) : null}
            {mayEdit ? (
              <button type="button" className={btn + ' !text-danger'} disabled={busy} onClick={() => setAsking('delete')}>
                Delete draft
              </button>
            ) : null}
          </>
        ) : (
          <>
            <button type="button" className={btn} onClick={() => void pdf()}>
              <Icon name="download" size={14} /> PDF
            </button>
            {mayIssue && inv.status !== 'cancelled' ? (
              <button type="button" className={btn} onClick={() => setAsking('sent')} title={inv.sent_at ? `Recorded as sent ${dateLabel(inv.sent_at)}` : 'Record how it was sent'}>
                {inv.sent_at ? 'Sent' : 'Record as sent'}
              </button>
            ) : null}
            {mayPay && inv.due > 0 && inv.status !== 'cancelled' ? (
              <button type="button" className={btnPrimary} onClick={() => setPaying(true)}>
                Record payment
              </button>
            ) : null}
            {can(perms, 'billing.invoice') ? (
              <button type="button" className={btn} disabled={busy} onClick={() => void run(async () => onOpen((await duplicateInvoice(inv.id)).invoice.id), 'Duplicated as a new draft.')}>
                Duplicate
              </button>
            ) : null}
            {onCredit && inv.status !== 'cancelled' && inv.due > 0 ? (
              <button type="button" className={btn} onClick={onCredit} title="Reduce what is owed on this invoice">
                Raise credit note
              </button>
            ) : null}
            {mayIssue && inv.status !== 'cancelled' && inv.paid === 0 ? (
              <button type="button" className={btn + ' !text-danger'} onClick={() => setAsking('cancel')}>
                Cancel invoice
              </button>
            ) : null}
          </>
        )}
        <button type="button" className={btn} onClick={onClose}>
          Close
        </button>
      </div>
      {!draft ? (
        <p className="m-0 rounded-[10px] border border-line bg-subtle px-3.5 py-2 text-[12.5px] text-ink-2">
          {inv.status === 'cancelled'
            ? `Cancelled${inv.cancel_reason ? ` — ${inv.cancel_reason}` : ''}. It keeps its number and stays on the customer's record.`
            : 'This invoice has been issued, so its figures are fixed. Raise a credit note to reduce it, or a debit note to add to it.'}
        </p>
      ) : null}
      <div role="tablist" aria-label="Invoice" className="flex gap-[18px] border-b border-line">
        {(
          [
            ['lines', 'Lines'],
            ['settle', `Settlement (${inv.allocations.payments.length + inv.allocations.credits.length})`],
            ['history', `History (${inv.timeline.length})`],
          ] as Array<[Tab, string]>
        ).map(([k, l]) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)} className={cx('-mb-px border-b-2 py-[9px] font-semibold', tab === k ? 'border-primary text-primary' : 'border-transparent text-ink-3 hover:text-ink')}>
            {l}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-4 gap-2.5">
        <Card label="Issued" value={inv.issue_date && !draft ? dateLabel(inv.issue_date) : '—'} />
        <Card
          label="Due"
          value={
            draft && mayEdit ? (
              <input aria-label="Due date" type="date" value={dueDate} onChange={(e) => change(setDueDate)(e.target.value)} className="h-7 rounded-[6px] border border-line bg-surface px-1.5 text-[13px] font-bold text-ink outline-none focus:border-primary" />
            ) : inv.due_date ? (
              dateLabel(inv.due_date)
            ) : (
              '—'
            )
          }
        />
        <Card label="Total" value={amount(inv.total, inv.currency)} />
        <Card label="Outstanding" value={draft || inv.status === 'cancelled' ? amount(inv.total, inv.currency) : amount(inv.due, inv.currency)} tint />
      </div>

      {tab === 'lines' ? (
        <>
          <section className="flex flex-col gap-2 rounded-[12px] border border-line bg-surface px-3.5 py-3">
            <Lines lines={lines} onChange={change(setLines)} taxes={taxes.data ?? []} currency={inv.currency} readOnly={!mayEdit} defaultTaxes={(taxes.data ?? []).filter((t) => t.is_default).map((t) => t.id)} />
            {mayEdit ? (
              <label className="flex items-center justify-end gap-2 text-[12.5px] text-ink-2">
                Discount on the invoice ({inv.currency})
                <input aria-label="Discount on the invoice" inputMode="decimal" value={discount} placeholder="0.00" onChange={(e) => change(setDiscount)(e.target.value)} className={input + ' !h-[30px] !w-[120px] tabular-nums'} />
              </label>
            ) : null}
            <div className="flex w-[320px] flex-col gap-1 self-end text-[12.5px]">
              {dirty ? <span className="text-right text-[11.5px] text-[#9A4A06] dark:text-warning">Unsaved changes — the totals below update when you save.</span> : null}
              <Total label="Subtotal" value={amount(inv.subtotal)} />
              {inv.discount ? <Total label="Discount" value={`− ${amount(inv.discount)}`} /> : null}
              {inv.tax_breakdown.length ? inv.tax_breakdown.map((t) => <Total key={`${t.name}-${t.rate}`} label={`${t.name} ${Number(t.rate)}%${t.is_compound ? ' (compound)' : ''}`} value={amount(t.amount)} />) : <Total label="Tax" value={amount(inv.tax_total)} />}
              {inv.withholding ? <Total label="Withholding" value={`− ${amount(inv.withholding)}`} tone="text-[#9A4A06] dark:text-warning" /> : null}
              <span className="flex border-t border-line pt-1.5 text-[15px]">
                <span className="flex-1 text-ink">Total {inv.currency}</span>
                <b className="text-ink tabular-nums">{amount(inv.total)}</b>
              </span>
            </div>
          </section>
          <section className="flex flex-col gap-2 rounded-[12px] border border-line bg-surface px-3.5 py-3">
            <b className="text-ink">Notes and terms</b>
            <div className="grid grid-cols-2 gap-2.5">
              <Field label="Notes" hint="Printed on the invoice">
                <textarea aria-label="Notes" disabled={!can(perms, 'billing.invoice')} value={notes} onChange={(e) => setNotes(e.target.value)} className={input + ' !h-[52px] resize-none py-2'} />
              </Field>
              <Field label="Terms">
                <textarea aria-label="Terms" disabled={!can(perms, 'billing.invoice')} value={terms} onChange={(e) => setTerms(e.target.value)} className={input + ' !h-[52px] resize-none py-2'} />
              </Field>
            </div>
            {!draft && notesChanged ? (
              <button type="button" className={btn + ' !h-[30px] self-end'} disabled={busy} onClick={() => void run(() => updateInvoice(inv.id, { notes, terms }), 'Notes saved.')}>
                Save notes
              </button>
            ) : null}
          </section>
        </>
      ) : null}

      {tab === 'settle' ? (
        <section className="flex flex-col gap-3 rounded-[12px] border border-line bg-surface px-3.5 py-3">
          <div className="grid grid-cols-3 gap-2.5">
            <Card label="Invoiced" value={amount(inv.total, inv.currency)} />
            <Card label="Paid and credited" value={amount(settled, inv.currency)} />
            <Card label="Outstanding" value={amount(inv.due, inv.currency)} tint />
          </div>
          <SubHead>Payments ({inv.allocations.payments.length})</SubHead>
          {inv.allocations.payments.length ? (
            inv.allocations.payments.map((p) => (
              <div key={p.id} className="flex items-center gap-3 border-b border-line/60 py-2 text-[12.5px] last:border-b-0">
                <button type="button" className="flex min-w-0 flex-1 flex-col text-left" onClick={() => onOpenPayment(p.payment_id)}>
                  <b className="text-primary hover:underline">{p.reference}</b>
                  <span className="text-[11.5px] text-ink-3">
                    {methodLabel(p.method)} · {dateLabel(p.paid_on)}
                    {p.gateway ? ` · ${p.gateway}` : ''}
                  </span>
                </button>
                <b className="text-ink tabular-nums">{amount(p.amount, inv.currency)}</b>
                {mayPay ? (
                  <button type="button" className="font-semibold text-danger hover:underline" onClick={() => setAsking({ unallocate: p.id, reference: p.reference })}>
                    Remove
                  </button>
                ) : null}
              </div>
            ))
          ) : (
            <Empty text="No payment has been allocated to this invoice." />
          )}
          <SubHead>Credit notes ({inv.allocations.credits.length})</SubHead>
          {inv.allocations.credits.length ? (
            inv.allocations.credits.map((c) => (
              <div key={c.id} className="flex items-center gap-3 border-b border-line/60 py-2 text-[12.5px] last:border-b-0">
                <button type="button" className="flex-1 text-left font-bold text-primary hover:underline" onClick={() => onOpenNote(c.credit_id)}>
                  {c.number}
                </button>
                <b className="text-ink tabular-nums">− {amount(c.amount, inv.currency)}</b>
              </div>
            ))
          ) : (
            <Empty text="No credit note has been applied to this invoice." />
          )}
        </section>
      ) : null}

      {tab === 'history' ? (
        <section className="flex flex-col rounded-[12px] border border-line bg-surface px-3.5 py-2">
          {inv.timeline.length ? (
            inv.timeline.map((h) => (
              <div key={h.id} className="flex gap-3 border-b border-line/60 py-2 text-[12.5px] last:border-b-0">
                <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-primary" />
                <span className="flex min-w-0 flex-1 flex-col">
                  <b className="text-ink">{h.title}</b>
                  {h.body ? <span className="text-ink-2">{h.body}</span> : null}
                  <span className="text-[11.5px] text-ink-3" title={`${dateLabel(h.at)}, ${timeLabel(h.at)}`}>
                    {h.author ?? 'System'} · {relative(h.at)}
                  </span>
                </span>
              </div>
            ))
          ) : (
            <Empty text="Nothing has happened to this invoice yet." />
          )}
        </section>
      ) : null}

      {paying ? <RecordPayment invoice={inv} org={org} onClose={() => setPaying(false)} /> : null}
      {asking ? (
        <Sheet
          title={
            asking === 'issue'
              ? 'Issue this invoice?'
              : asking === 'sent'
                ? 'How was it sent?'
                : asking === 'cancel'
                  ? 'Cancel this invoice?'
                  : asking === 'delete'
                    ? 'Delete this draft?'
                    : 'Remove this allocation?'
          }
          width={440}
          onClose={() => setAsking(null)}
          footer={
            <>
              <button type="button" className={btn} onClick={() => setAsking(null)}>
                {asking === 'cancel' ? 'Back' : 'Cancel'}
              </button>
              {asking === 'issue' ? (
                <button type="button" className={btnPrimary} disabled={busy} onClick={() => void issue()}>
                  {busy ? 'Issuing…' : 'Issue'}
                </button>
              ) : asking === 'sent' ? (
                <button type="button" className={btnPrimary} disabled={busy} onClick={() => void run(() => markSent(inv.id, words), 'Recorded as sent.')}>
                  Record
                </button>
              ) : asking === 'cancel' ? (
                <button type="button" className={btnPrimary + ' !bg-danger hover:!opacity-90'} disabled={busy} onClick={() => void run(() => cancelInvoice(inv.id, words), `${invoiceName(inv)} cancelled.`)}>
                  Cancel invoice
                </button>
              ) : asking === 'delete' ? (
                <button type="button" className={btnPrimary + ' !bg-danger hover:!opacity-90'} disabled={busy} onClick={() => void run(() => deleteDraft(inv.id), 'Draft deleted.', onClose)}>
                  Delete
                </button>
              ) : (
                <button type="button" className={btnPrimary + ' !bg-danger hover:!opacity-90'} disabled={busy} onClick={() => void run(() => unallocate(asking.unallocate), 'Allocation removed; the payment is on account.')}>
                  Remove
                </button>
              )}
            </>
          }
        >
          {asking === 'issue' ? <p className="m-0 text-[13px] leading-relaxed text-ink-2">It is given a number that can never be reused, and its figures are frozen. After this, only a credit or debit note can change what is owed.{dirty || notesChanged ? ' Your unsaved changes are saved first.' : ''}</p> : null}
          {asking === 'sent' ? (
            <>
              <p className="m-0 text-[13px] text-ink-2">This records that it was sent. It does not send anything.</p>
              <input aria-label="How was it sent?" value={words} maxLength={120} autoFocus placeholder="Emailed, posted, handed over…" onChange={(e) => setWords(e.target.value)} className={input} />
            </>
          ) : null}
          {asking === 'cancel' ? (
            <>
              <p className="m-0 text-[13px] text-ink-2">It keeps its number and stays on the customer's record, marked cancelled. Why?</p>
              <input aria-label="Why?" value={words} maxLength={250} autoFocus placeholder="Raised against the wrong company" onChange={(e) => setWords(e.target.value)} className={input} />
            </>
          ) : null}
          {asking === 'delete' ? <p className="m-0 text-[13px] text-ink-2">A draft has no number yet, so nothing is lost from the sequence. Anything it had drawn in (time, expenses, milestones) is freed to bill again.</p> : null}
          {typeof asking === 'object' ? <p className="m-0 text-[13px] text-ink-2">{asking.reference} stays on the customer's account, unallocated. The invoice goes back to owing this amount.</p> : null}
        </Sheet>
      ) : null}
    </div>
  );
}

function Card({ label, value, tint }: { label: string; value: ReactNode; tint?: boolean }) {
  return (
    <div className={cx('flex flex-col gap-0.5 rounded-[10px] border border-line px-3 py-2.5', tint ? 'bg-[#EEF4FF] dark:bg-selection/50' : 'bg-surface')}>
      <span className="text-[11.5px] font-semibold text-ink-3">{label}</span>
      <b className="text-[16px] text-ink tabular-nums">{value}</b>
    </div>
  );
}

function Total({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <span className={cx('flex', tone)}>
      <span className="flex-1 text-ink-2">{label}</span>
      <b className="tabular-nums">{value}</b>
    </span>
  );
}

function SubHead({ children }: { children: ReactNode }) {
  return <div className="text-[11px] font-bold tracking-[.4px] text-ink-3 uppercase">{children}</div>;
}
