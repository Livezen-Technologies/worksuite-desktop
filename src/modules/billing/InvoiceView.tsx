import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState, type ReactNode } from 'react';
import { app } from '../../core/app-state';
import { call, errorMessage } from '../../core/bridge';
import { useStore } from '../../core/store';
import { dateLabel, relative, timeLabel } from '../../core/time';
import { toast } from '../../core/toasts';
import { Icon } from '../../components/Icon';
import { Menu, type MenuItem } from '../../components/Menu';
import { DriveFilePicker } from '../../components/DriveFilePicker';
import { ErrorNote, Spinner, cx } from '../../components/ui';
import { btn, btnPrimary, Empty, Field, input, Sheet } from '../../components/PageKit';
import { approveInvoice, attachFile, cancelRefusal, clearDispute, detachFile, fetchAttachments, flagDispute, rejectInvoice, REVERSAL_NOTE, submitForApproval, type CancelRefusal } from './actions';
import { InvoiceAside } from './InvoiceAside';
import { OFFLINE_WRITE, useBillingOffline } from './offline';
import SendDialog from './SendDialog';
import { amount, can, cancelInvoice, deleteDraft, duplicateInvoice, fetchInvoice, fetchTaxes, filePdf, invoiceName, issueInvoice, K, markSent, methodLabel, unallocate, updateInvoice, type InvoiceDetail } from './api';
import { Lines, toEdit, toSend, type EditLine } from './Lines';
import { StatusChip } from './parts';
import RecordPayment from './RecordPayment';

/**
 * One invoice (D02; BillInvoiceEditor, BillInvoiceIssued). A draft opens in
 * the editor: its lines, discount, due date, notes and terms are saved
 * together, and Issue numbers it and freezes its figures — or, where the
 * company's rules ask for it (G-14), it is submitted for approval first. An
 * issued invoice is read-only: Send (W12), Record payment and its PDF up
 * front, and under ⋯ recording how it was sent, duplicating it, a credit
 * note, a dispute flag and cancelling it — which reverses its journal (G-01),
 * or is refused in a locked period with a credit note offered instead. The
 * side panel holds its details, payments, reminders and pay link. Offline,
 * it is read as last seen and nothing can be changed.
 */
type Tab = 'lines' | 'settle' | 'files' | 'history';
type Asking = 'issue' | 'sent' | 'cancel' | 'delete' | 'submit' | 'approve' | 'reject' | 'dispute' | 'undispute' | { unallocate: number; reference: string };

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
  const [sending, setSending] = useState(false);
  const [more, setMore] = useState(false);
  const [refusal, setRefusal] = useState<CancelRefusal | null>(null);
  const [busy, setBusy] = useState(false);
  const moreRef = useRef<HTMLButtonElement | null>(null);
  const offline = useBillingOffline();
  const draft = inv.status === 'draft';
  const pending = inv.status === 'pending_approval';
  const live = !draft && !pending && inv.status !== 'cancelled';
  const mayEdit = editable && can(perms, 'billing.invoice') && !offline;
  const mayIssue = can(perms, 'billing.issue') && !offline;
  const mayPay = can(perms, 'billing.payment') && !offline;
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
  /** Cancel (G-01): the server reverses the journal; a locked period is refused and a credit note offered instead. */
  const cancel = async () => {
    setBusy(true);
    try {
      await cancelInvoice(inv.id, words);
      toast('success', `${invoiceName(inv)} cancelled; its journal was reversed.`);
      setAsking(null);
      setWords('');
      setRefusal(null);
      refresh();
    } catch (e) {
      setRefusal(cancelRefusal(e));
    } finally {
      setBusy(false);
    }
  };
  const menu: MenuItem[] = [
    ...(mayIssue && live ? [{ id: 'sent', label: inv.sent_at ? `Sent ${dateLabel(inv.sent_at)} — record again` : 'Record as sent', icon: 'check', onSelect: () => setAsking('sent') }] : []),
    ...(can(perms, 'billing.invoice') && !offline ? [{ id: 'dup', label: 'Duplicate', icon: 'copy', onSelect: () => void run(async () => onOpen((await duplicateInvoice(inv.id)).invoice.id), 'Duplicated as a new draft.') }] : []),
    ...(onCredit && live && inv.due > 0 && !offline ? [{ id: 'credit', label: 'Raise credit note', icon: 'undo', description: 'Reduce what is owed on this invoice', onSelect: onCredit }] : []),
    ...(can(perms, 'billing.invoice') && live && !offline
      ? [
          inv.disputed
            ? { id: 'undispute', label: 'Clear the dispute', icon: 'flag', onSelect: () => setAsking('undispute') }
            : { id: 'dispute', label: 'Flag a dispute', icon: 'flag', description: 'Pauses its reminders', onSelect: () => setAsking('dispute') },
        ]
      : []),
    ...(mayIssue && live && inv.paid === 0 ? [{ id: 'cancel', label: 'Cancel invoice', icon: 'x', danger: true, onSelect: () => (setRefusal(null), setAsking('cancel')) }] : []),
  ];
  const saveDraft = () => updateInvoice(inv.id, { lines: toSend(lines), discount: Number(discount.replace(/,/g, '')) || 0, ...(dueDate ? { due_date: dueDate } : {}), notes, terms }).then(() => setDirty(false));
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
    <div className="flex items-start gap-4" data-invoice-view={inv.id}>
      <div className="flex min-w-0 flex-1 flex-col gap-3">
        <div className="flex flex-wrap items-start gap-2">
          <div className="flex min-w-0 flex-1 flex-col">
            <span className="flex flex-wrap items-center gap-2">
              <b className="text-[20px] text-ink">{draft || pending ? 'Draft invoice' : inv.number}</b>
              <StatusChip status={inv.status} />
              {inv.days_overdue > 0 ? (
                <span className="rounded-[10px] bg-danger-bg px-2 py-0.5 text-[11px] font-semibold text-danger">
                  {inv.days_overdue} {inv.days_overdue === 1 ? 'day' : 'days'} late
                </span>
              ) : null}
              {inv.disputed ? <span className="rounded-[10px] bg-warning-bg px-2 py-0.5 text-[11px] font-semibold text-warning-ink dark:text-warning">Disputed</span> : null}
            </span>
            <span className="truncate text-[12.5px] text-ink-3">{[inv.client ?? 'No customer', TYPE_LABEL[inv.type] ?? null, inv.project, inv.po_number ? `PO ${inv.po_number}` : null].filter(Boolean).join(' · ')}</span>
          </div>
          {draft ? (
            <>
              {mayEdit ? (
                <button type="button" className={btn} disabled={busy || !(dirty || notesChanged)} onClick={() => void run(saveDraft, 'Draft saved.')}>
                  Save draft
                </button>
              ) : null}
              {mayEdit && inv.approval?.required && inv.approval.status !== 'approved' ? (
                <button type="button" className={btn} disabled={busy || !toSend(lines).length} title={`Needs approval before it is issued: ${inv.approval.required}`} onClick={() => setAsking('submit')}>
                  Submit for approval
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
          ) : pending ? (
            inv.approval?.can_approve && !offline ? (
              <>
                <button type="button" className={btnPrimary + ' !bg-success hover:!bg-success'} disabled={busy} onClick={() => setAsking('approve')}>
                  Approve
                </button>
                <button type="button" className={btn + ' !text-danger'} disabled={busy} onClick={() => setAsking('reject')}>
                  Reject
                </button>
              </>
            ) : null
          ) : (
            <>
              {live && can(perms, 'billing.issue') ? (
                <button type="button" className={btnPrimary} disabled={offline} title={offline ? OFFLINE_WRITE : 'Email it, with its PDF and a pay link'} onClick={() => setSending(true)}>
                  <Icon name="send" size={14} /> Send
                </button>
              ) : null}
              {mayPay && inv.due > 0 && live ? (
                <button type="button" className={btnPrimary + ' !bg-success hover:!bg-success'} onClick={() => setPaying(true)}>
                  Record payment
                </button>
              ) : null}
              <button type="button" className={btn} onClick={() => void pdf()}>
                <Icon name="download" size={14} /> PDF
              </button>
              {menu.length ? (
                <button ref={moreRef} type="button" aria-label="More" title="More" aria-haspopup="menu" aria-expanded={more} className={btn + ' !w-[34px] justify-center !px-0'} onClick={() => setMore((v) => !v)}>
                  <Icon name="more" size={16} />
                </button>
              ) : null}
              {more ? <Menu label="More for this invoice" anchor={moreRef} prefer="bottom" align="end" width={260} sections={[{ id: 'more', items: menu }]} onClose={() => setMore(false)} /> : null}
            </>
          )}
          <button type="button" className={btn} onClick={onClose}>
            Close
          </button>
        </div>
        {offline ? (
          <p role="status" className="m-0 rounded-[10px] border border-line bg-subtle px-3.5 py-2 text-[12.5px] text-ink-2">
            {OFFLINE_WRITE}
          </p>
        ) : null}
        {pending ? (
          <p className="m-0 rounded-[10px] border border-warning-line bg-warning-bg px-3.5 py-2 text-[12.5px] text-warning-strong dark:border-warning/40 dark:bg-warning-bg dark:text-warning">
            Waiting for approval
            {inv.approval?.submitted_at ? ` — submitted ${dateLabel(inv.approval.submitted_at)}` : ''}.{inv.approval?.rule ? ` ${inv.approval.rule}` : ''} It is issued when approved.
          </p>
        ) : null}
        {draft && inv.approval?.status === 'rejected' ? (
          <p className="m-0 rounded-[10px] border border-line bg-danger-bg px-3.5 py-2 text-[12.5px] text-danger">
            Approval was refused
            {inv.approval.note ? `: ${inv.approval.note}` : '.'} Change it and submit it again.
          </p>
        ) : null}
        {!draft && !pending ? (
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
              ['files', 'Attachments'],
              ['history', `History (${inv.timeline.length})`],
            ] as Array<[Tab, string]>
          ).map(([k, l]) => (
            <button
              key={k}
              type="button"
              role="tab"
              aria-selected={tab === k}
              onClick={() => setTab(k)}
              className={cx('-mb-px border-b-2 py-[9px] font-semibold', tab === k ? 'border-primary text-primary' : 'border-transparent text-ink-3 hover:text-ink')}
            >
              {l}
            </button>
          ))}
        </div>
        {draft || pending ? (
          <div className="grid grid-cols-4 gap-2.5">
            <Card label="Issued" value={inv.issue_date && !draft ? dateLabel(inv.issue_date) : '—'} />
            <Card
              label="Due"
              value={
                draft && mayEdit ? (
                  <input
                    aria-label="Due date"
                    type="date"
                    value={dueDate}
                    onChange={(e) => change(setDueDate)(e.target.value)}
                    className="h-7 rounded-[6px] border border-line bg-surface px-1.5 text-[13px] font-bold text-ink outline-none focus:border-primary"
                  />
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
        ) : null}

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
                {dirty ? <span className="text-right text-[11.5px] text-warning-ink dark:text-warning">Unsaved changes — the totals below update when you save.</span> : null}
                <Total label="Subtotal" value={amount(inv.subtotal)} />
                {inv.discount ? <Total label="Discount" value={`− ${amount(inv.discount)}`} /> : null}
                {inv.tax_breakdown.length ? (
                  inv.tax_breakdown.map((t) => <Total key={`${t.name}-${t.rate}`} label={`${t.name} ${Number(t.rate)}%${t.is_compound ? ' (compound)' : ''}`} value={amount(t.amount)} />)
                ) : (
                  <Total label="Tax" value={amount(inv.tax_total)} />
                )}
                {inv.withholding ? <Total label="Withholding" value={`− ${amount(inv.withholding)}`} tone="text-warning-ink dark:text-warning" /> : null}
                <span className="flex border-t border-line pt-1.5 text-[15px]">
                  <span className="flex-1 text-ink">Total {inv.currency}</span>
                  <b className="text-ink tabular-nums">{amount(inv.total)}</b>
                </span>
                {!draft && !pending && inv.status !== 'cancelled' ? (
                  <span className={cx('flex font-bold', inv.due > 0 ? 'text-danger' : 'text-success dark:text-success')}>
                    <span className="flex-1">Outstanding</span>
                    <span className="tabular-nums">{amount(inv.due)}</span>
                  </span>
                ) : null}
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

        {tab === 'files' ? <Attachments id={inv.id} canEdit={can(perms, 'billing.invoice') && !offline} /> : null}
      </div>
      <InvoiceAside inv={inv} canLink={can(perms, 'billing.invoice')} offline={offline} />
      {sending ? <SendDialog inv={inv} org={org} onClose={() => setSending(false)} /> : null}
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
                    : asking === 'submit'
                      ? 'Submit for approval?'
                      : asking === 'approve'
                        ? 'Approve this invoice?'
                        : asking === 'reject'
                          ? 'Reject this invoice?'
                          : asking === 'dispute'
                            ? 'Flag a dispute?'
                            : asking === 'undispute'
                              ? 'Clear the dispute?'
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
                refusal?.creditInstead && onCredit ? (
                  <button type="button" className={btnPrimary} onClick={() => (setAsking(null), onCredit())}>
                    Raise a credit note instead
                  </button>
                ) : (
                  <button type="button" className={btnPrimary + ' !bg-danger hover:!opacity-90'} disabled={busy || !!refusal} onClick={() => void cancel()}>
                    Cancel invoice
                  </button>
                )
              ) : asking === 'submit' ? (
                <button
                  type="button"
                  className={btnPrimary}
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      if (dirty || notesChanged) await saveDraft();
                      const r = await submitForApproval(inv.id, words);
                      toast('success', r.message ?? 'Submitted for approval.');
                    }, null)
                  }
                >
                  Submit
                </button>
              ) : asking === 'approve' ? (
                <button
                  type="button"
                  className={btnPrimary + ' !bg-success hover:!bg-success'}
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      const r = await approveInvoice(inv.id, words);
                      const issued = r.data?.issue;
                      if (issued && !issued.ok) toast('error', `Approved, but not issued${issued.problems?.length ? `: ${issued.problems.join('; ')}` : '.'} Issue it from the draft.`);
                      else toast('success', issued?.number ? `Approved and issued as ${issued.number}.` : (r.message ?? 'Approved.'));
                    }, null)
                  }
                >
                  Approve
                </button>
              ) : asking === 'reject' ? (
                <button
                  type="button"
                  className={btnPrimary + ' !bg-danger hover:!opacity-90'}
                  disabled={busy || !words.trim()}
                  onClick={() =>
                    void run(async () => {
                      const r = await rejectInvoice(inv.id, words);
                      toast('success', r.message ?? 'Rejected; it goes back to a draft.');
                    }, null)
                  }
                >
                  Reject
                </button>
              ) : asking === 'dispute' ? (
                <button type="button" className={btnPrimary} disabled={busy || !words.trim()} onClick={() => void run(() => flagDispute(inv.id, words), 'Dispute flagged; reminders are paused.')}>
                  Flag dispute
                </button>
              ) : asking === 'undispute' ? (
                <button type="button" className={btnPrimary} disabled={busy} onClick={() => void run(() => clearDispute(inv.id), 'Dispute cleared; reminders resume.')}>
                  Clear
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
          {asking === 'issue' ? (
            <p className="m-0 text-[13px] leading-relaxed text-ink-2">
              It is given a number that can never be reused, and its figures are frozen. After this, only a credit or debit note can change what is owed.
              {dirty || notesChanged ? ' Your unsaved changes are saved first.' : ''}
            </p>
          ) : null}
          {asking === 'sent' ? (
            <>
              <p className="m-0 text-[13px] text-ink-2">This records that it was sent. It does not send anything.</p>
              <input aria-label="How was it sent?" value={words} maxLength={120} autoFocus placeholder="Emailed, posted, handed over…" onChange={(e) => setWords(e.target.value)} className={input} />
            </>
          ) : null}
          {asking === 'cancel' ? (
            refusal ? (
              <div role="alert" className="flex flex-col gap-1.5 rounded-[10px] border border-danger-line bg-danger-bg px-3 py-2.5 text-[12.5px] text-danger dark:border-danger/40">
                <b>{refusal.code === 'period_locked' ? 'The period is locked' : 'It cannot be cancelled'}</b>
                <span>{refusal.message}</span>
                {refusal.creditInstead ? <span className="text-ink-2">Raise a credit note for {amount(inv.due || inv.total, inv.currency)} instead: it is dated today, in the open period, and leaves the locked books as they are.</span> : null}
              </div>
            ) : (
              <>
                <p className="m-0 text-[13px] text-ink-2">{REVERSAL_NOTE} Why?</p>
                <input aria-label="Why?" value={words} maxLength={250} autoFocus placeholder="Raised against the wrong company" onChange={(e) => setWords(e.target.value)} className={input} />
              </>
            )
          ) : null}
          {asking === 'submit' || asking === 'approve' ? (
            <>
              <p className="m-0 text-[13px] text-ink-2">
                {asking === 'submit' ? 'An approver is asked to say yes before it is issued. It cannot be changed while it waits.' : 'It is issued: numbered, its figures frozen, and posted.'}
                {asking === 'submit' && (dirty || notesChanged) ? ' Your unsaved changes are saved first.' : ''}
              </p>
              <input aria-label="Note" value={words} maxLength={250} placeholder="A note (optional)" onChange={(e) => setWords(e.target.value)} className={input} />
            </>
          ) : null}
          {asking === 'reject' || asking === 'dispute' ? (
            <>
              <p className="m-0 text-[13px] text-ink-2">{asking === 'reject' ? 'It goes back to a draft, with your reason, to change and submit again.' : 'What does the customer dispute? Reminders stop while it is open.'}</p>
              <input aria-label={asking === 'reject' ? 'Reason' : 'What is disputed'} value={words} maxLength={250} autoFocus onChange={(e) => setWords(e.target.value)} className={input} />
            </>
          ) : null}
          {asking === 'undispute' ? <p className="m-0 text-[13px] text-ink-2">The dispute is closed and its reminders pick up again from where the schedule is.</p> : null}
          {asking === 'delete' ? <p className="m-0 text-[13px] text-ink-2">A draft has no number yet, so nothing is lost from the sequence. Anything it had drawn in (time, expenses, milestones) is freed to bill again.</p> : null}
          {typeof asking === 'object' ? <p className="m-0 text-[13px] text-ink-2">{asking.reference} stays on the customer's account, unallocated. The invoice goes back to owing this amount.</p> : null}
        </Sheet>
      ) : null}
    </div>
  );
}

const TYPE_LABEL: Record<string, string> = { standard: 'Invoice', tax: 'Tax invoice', proforma: 'Proforma', commercial: 'Commercial invoice' };

/** Files kept with the invoice (G-26): from the Drive, opened from here, removed by whoever may edit it. */
function Attachments({ id, canEdit }: { id: number; canEdit: boolean }) {
  const qc = useQueryClient();
  const key = ['billing', 'invoice', id, 'attachments'];
  const q = useQuery({ queryKey: key, queryFn: ({ signal }) => fetchAttachments(id, signal), retry: false });
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);
  const act = async (fn: () => Promise<unknown>, done: string) => {
    setBusy(true);
    try {
      await fn();
      toast('success', done);
      void qc.invalidateQueries({ queryKey: key });
    } catch (e) {
      toast('error', errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const rows = q.data ?? [];
  return (
    <section className="flex flex-col gap-2 rounded-[12px] border border-line bg-surface px-3.5 py-3">
      {q.isLoading ? <Spinner /> : q.error ? <ErrorNote error={q.error} onRetry={() => void q.refetch()} /> : null}
      {rows.map((a) => (
        <div key={a.id} className="flex items-center gap-2 border-b border-line/60 py-1.5 text-[12.5px] last:border-b-0">
          <Icon name="file" size={14} className="shrink-0 text-ink-3" />
          <button
            type="button"
            className="min-w-0 flex-1 truncate text-left font-semibold text-primary hover:underline"
            onClick={() =>
              void call('transfers:download', { fileId: String(a.file_id), name: a.name, open: true }).then(
                () => toast('success', 'Downloading — see Transfers.'),
                (e) => toast('error', errorMessage(e)),
              )
            }
          >
            {a.name}
          </button>
          <span className="shrink-0 text-[11.5px] text-ink-3">{[a.added_by, a.created_at ? dateLabel(a.created_at) : null].filter(Boolean).join(' · ')}</span>
          {canEdit ? (
            <button
              type="button"
              aria-label={`Remove ${a.name}`}
              title="Remove"
              disabled={busy}
              className="flex h-6 w-6 items-center justify-center rounded-full text-danger hover:bg-danger-bg"
              onClick={() => void act(() => detachFile(id, a.id), 'Attachment removed.')}
            >
              <Icon name="x" size={13} />
            </button>
          ) : null}
        </div>
      ))}
      {!rows.length && !q.isLoading && !q.error ? <Empty text="No files are attached. Timesheets, delivery notes or a signed PO can go with the invoice." /> : null}
      {canEdit ? (
        <button type="button" className={btn + ' self-start'} disabled={busy} onClick={() => setPicking(true)}>
          <Icon name="paperclip" size={14} /> Attach from Drive
        </button>
      ) : null}
      {picking ? (
        <DriveFilePicker
          title="Attach to the invoice"
          confirmLabel="Attach"
          busy={busy}
          onClose={() => setPicking(false)}
          onChoose={(files) =>
            void act(
              async () => {
                for (const f of files) await attachFile(id, Number(f.id));
                setPicking(false);
              },
              files.length === 1 ? 'File attached.' : 'Files attached.',
            )
          }
        />
      ) : null}
    </section>
  );
}

function Card({ label, value, tint }: { label: string; value: ReactNode; tint?: boolean }) {
  return (
    <div className={cx('flex flex-col gap-0.5 rounded-[10px] border border-line px-3 py-2.5', tint ? 'bg-selection dark:bg-selection/50' : 'bg-surface')}>
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
