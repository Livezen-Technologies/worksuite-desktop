import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { app } from '../../core/app-state';
import { call, errorMessage } from '../../core/bridge';
import { useStore } from '../../core/store';
import { dateLabel } from '../../core/time';
import { toast } from '../../core/toasts';
import { Icon } from '../../components/Icon';
import { Select } from '../../components/Select';
import { ErrorNote, Spinner, cx } from '../../components/ui';
import { btn, btnPrimary, btnSmall, Empty, Field, input, PageHead, Seg, Sheet, SidePanel } from '../../components/PageKit';
import { amount, can, fetchBankAccounts, fetchInvoice, K, searchCustomers, useBillingOrgs, type Customer } from './api';
import { applyNote, createNote, deleteNote, fetchModes, fetchNote, fetchNotes, issueNote, KB, notePdf, notesTotal, openInvoicesOf, PER_PAGE, refundCredit, unapplyNote, type NoteDetail } from './more';
import { exportRequest } from './actions';
import { Facts, Section } from './Payments';

/**
 * Credit and debit notes (BillCredit, W7). An issued invoice's figures never
 * change; a credit note reduces what is owed and a debit note adds to it.
 * A note has as many lines as it needs (G-22). A credit note raised against
 * an invoice is applied to it the moment it is issued; one raised on its own
 * is a balance the customer can spend on any later invoice, applied from
 * here — and taken off an invoice again (unapply), or paid out to the
 * customer (refund credit, G-16). Only drafts can be changed or deleted.
 * All of it needs `billing.credit`.
 */
export default function Notes({ org, openId, kind, creating, against, onOpen, onKind, onNew, onCloseNew, onOpenInvoice }: {
  org: string;
  openId: number | null;
  kind: 'credit' | 'debit';
  creating: boolean;
  /** An invoice the new note starts against (from the invoice's "Raise a credit note"). */
  against: number | null;
  onOpen: (id: number | null) => void;
  onKind: (k: 'credit' | 'debit') => void;
  onNew: () => void;
  onCloseNew: (id?: number) => void;
  onOpenInvoice: (id: number) => void;
}) {
  const perms = useStore(app, (s) => s.bootstrap?.permissions);
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const f = { kind, q, page };
  const list = useQuery({ queryKey: KB.notes(org, f), queryFn: ({ signal }) => fetchNotes(org, f, signal), placeholderData: keepPreviousData });
  const rows = list.data?.notes ?? [];
  const pages = Math.max(1, Math.ceil((list.data?.total ?? 0) / PER_PAGE));
  const word = kind === 'credit' ? 'credit note' : 'debit note';

  return (
    <div className="flex flex-col gap-3 px-6 py-5">
      <PageHead title={kind === 'credit' ? 'Credit notes' : 'Debit notes'} sub={kind === 'credit' ? 'What reduces what a customer owes' : 'What adds to what a customer owes'}>
        <button
          type="button"
          className={btn}
          title="Saved to disk as CSV — see Transfers"
          onClick={() =>
            void call('transfers:download', exportRequest('credit-notes', 'csv', { org, q: q.trim() || undefined, status: kind })).then(
              () => toast('success', 'Exporting — see Transfers.'),
              (e) => toast('error', errorMessage(e)),
            )
          }
        >
          <Icon name="download" size={14} /> Export
        </button>
        {can(perms, 'billing.credit') ? (
          <button type="button" className={btnPrimary} onClick={onNew}>
            <Icon name="plus" size={15} /> New {word}
          </button>
        ) : null}
      </PageHead>
      <div className="flex items-center gap-2">
        <Seg<'credit' | 'debit'>
          label="Kind of note"
          value={kind}
          onChange={(k) => (setPage(1), onKind(k))}
          options={[
            { id: 'credit', label: 'Credit notes' },
            { id: 'debit', label: 'Debit notes' },
          ]}
        />
        <input value={q} onChange={(e) => (setQ(e.target.value), setPage(1))} placeholder="Search number or customer" aria-label="Search notes" className={input + ' !w-[260px]'} />
      </div>
      {list.isLoading ? (
        <Spinner />
      ) : list.error ? (
        <ErrorNote error={list.error} onRetry={() => void list.refetch()} />
      ) : (
        <div className="overflow-hidden rounded-[12px] border border-line bg-surface">
          <div className="flex gap-2.5 border-b border-line bg-ground px-3.5 py-2 text-[11px] font-bold tracking-[.4px] text-ink-3 uppercase">
            <span className="w-[120px] shrink-0">Number</span>
            <span className="min-w-0 flex-1">Customer</span>
            <span className="w-[120px] shrink-0">Against</span>
            <span className="w-[80px] shrink-0">Status</span>
            <span className="w-[90px] shrink-0">Issued</span>
            <span className="w-[130px] shrink-0 text-right">Amount</span>
            {kind === 'credit' ? <span className="w-[120px] shrink-0 text-right">Unused</span> : null}
          </div>
          {rows.length ? (
            rows.map((n) => (
              <button key={n.id} type="button" data-note={n.id} onClick={() => onOpen(n.id)} className={cx('flex w-full items-center gap-2.5 border-b border-line/60 px-3.5 py-2 text-left text-[12.5px] last:border-b-0 hover:bg-subtle/60', openId === n.id && 'bg-info-soft dark:bg-selection/40')}>
                <b className={cx('w-[120px] shrink-0', n.number ? 'text-ink' : 'text-ink-3')}>{n.number ?? 'Draft'}</b>
                <span className="min-w-0 flex-1 truncate text-ink">{n.client ?? 'No customer'}</span>
                <span className="w-[120px] shrink-0 truncate text-ink-2">{n.invoice_number ?? '—'}</span>
                <span className="w-[80px] shrink-0">
                  <NoteStatus status={n.status} />
                </span>
                <span className="w-[90px] shrink-0 text-ink-2">{n.issue_date && n.number ? dateLabel(n.issue_date) : '—'}</span>
                <b className="w-[130px] shrink-0 text-right text-ink tabular-nums">{amount(n.total, n.currency)}</b>
                {kind === 'credit' ? <span className={cx('w-[120px] shrink-0 text-right tabular-nums', n.number && n.remaining > 0 ? 'font-bold text-warning-ink dark:text-warning' : 'text-ink-3')}>{n.number ? amount(n.remaining, n.currency) : '—'}</span> : null}
              </button>
            ))
          ) : (
            <Empty text={q ? 'No note matches.' : `No ${word}s yet.`} />
          )}
        </div>
      )}
      {pages > 1 ? (
        <div className="flex items-center justify-center gap-2.5">
          <button type="button" className={btn} disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
            Newer
          </button>
          <span className="text-[12.5px] text-ink-2 tabular-nums">
            Page {page} of {pages}
          </span>
          <button type="button" className={btn} disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>
            Older
          </button>
        </div>
      ) : null}
      {openId ? <NotePanel id={openId} onClose={() => onOpen(null)} onOpenInvoice={onOpenInvoice} /> : null}
      {creating ? <NewNote org={org} kind={kind} against={against} onClose={onCloseNew} /> : null}
    </div>
  );
}

function NoteStatus({ status }: { status: string }) {
  const draft = status === 'draft';
  return <span className={cx('inline-flex h-[22px] items-center rounded-[11px] px-2 text-[11.5px] font-bold', draft ? 'bg-subtle text-ink-2' : status === 'cancelled' ? 'bg-subtle text-ink-3' : 'bg-success-bg text-success')}>{draft ? 'Draft' : status === 'cancelled' ? 'Cancelled' : 'Issued'}</span>;
}

type Asking = 'issue' | 'delete' | 'apply' | 'refund';

function NotePanel({ id, onClose, onOpenInvoice }: { id: number; onClose: () => void; onOpenInvoice: (id: number) => void }) {
  const qc = useQueryClient();
  const perms = useStore(app, (s) => s.bootstrap?.permissions);
  const q = useQuery({ queryKey: KB.note(id), queryFn: ({ signal }) => fetchNote(id, signal) });
  const [asking, setAsking] = useState<Asking | null>(null);
  const [busy, setBusy] = useState(false);
  const n = q.data;
  const may = can(perms, 'billing.credit');
  const run = async (fn: () => Promise<unknown>, done: string | null, after?: () => void) => {
    setBusy(true);
    try {
      await fn();
      if (done) toast('success', done);
      setAsking(null);
      after?.();
      void qc.invalidateQueries({ queryKey: K.all });
    } catch (e) {
      toast('error', errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const pdf = async () => {
    if (!n) return;
    try {
      const f = await notePdf(n.id);
      await call('transfers:download', { fileId: String(f.file_id), name: f.name || `${n.number ?? `DRAFT-${n.id}`}.pdf`, open: true });
      toast('success', 'Downloading the PDF — see Transfers.');
    } catch (e) {
      toast('error', errorMessage(e));
    }
  };
  const draft = n?.status === 'draft';

  return (
    <SidePanel
      label={n ? `Note ${n.number ?? `Draft #${n.id}`}` : 'Note'}
      width={460}
      onClose={onClose}
      head={
        n ? (
          <>
            <span className="flex min-w-0 flex-1 flex-col">
              <b className="truncate text-[15px] text-ink">{n.number ?? `Draft ${n.kind} note`}</b>
              <span className="truncate text-[12px] text-ink-3">{n.client ?? 'No customer'}</span>
            </span>
            <NoteStatus status={n.status} />
          </>
        ) : (
          <b className="text-ink">Note</b>
        )
      }
    >
      {q.isLoading ? (
        <Spinner />
      ) : q.error ? (
        <ErrorNote error={q.error} onRetry={() => void q.refetch()} />
      ) : n ? (
        <>
          <div className="flex flex-wrap gap-2">
            {may && draft ? (
              <button type="button" className={btnPrimary + ' !h-[30px]'} onClick={() => setAsking('issue')}>
                Issue
              </button>
            ) : null}
            {may && n.kind === 'credit' && !draft && n.remaining > 0 ? (
              <button type="button" className={btnPrimary + ' !h-[30px]'} onClick={() => setAsking('apply')}>
                Apply to an invoice
              </button>
            ) : null}
            {may && n.kind === 'credit' && !draft && n.remaining > 0 ? (
              <button type="button" className={btnSmall} title="Pay the unused balance out to the customer" onClick={() => setAsking('refund')}>
                Refund credit
              </button>
            ) : null}
            <button type="button" className={btnSmall} onClick={() => void pdf()}>
              <Icon name="download" size={13} className="mr-1" /> PDF
            </button>
            {may && draft ? (
              <button type="button" className={btnSmall + ' !text-danger'} onClick={() => setAsking('delete')}>
                Delete draft
              </button>
            ) : null}
          </div>
          <Section title="Details">
            <Facts
              rows={[
                ['Amount', amount(n.total, n.currency)],
                ...(n.kind === 'credit'
                  ? ([
                      ['Applied', amount(n.applied, n.currency)],
                      ['Unused', <span className={n.remaining > 0 && !draft ? 'text-warning-ink dark:text-warning' : ''}>{amount(n.remaining, n.currency)}</span>],
                    ] as Array<[string, ReactNode]>)
                  : []),
                [
                  'Against',
                  n.invoice_id ? (
                    <button type="button" className="font-semibold text-primary hover:underline" onClick={() => onOpenInvoice(n.invoice_id!)}>
                      {n.invoice_number ?? `#${n.invoice_id}`}
                    </button>
                  ) : n.kind === 'credit' ? (
                    'Nothing — a standing balance'
                  ) : (
                    'Nothing'
                  ),
                ],
                ['Issued', n.number && n.issue_date ? dateLabel(n.issue_date) : '—'],
                ['Reason', n.reason || '—'],
              ]}
            />
          </Section>
          <Section title={`Lines (${n.lines.length})`}>
            {n.lines.map((l) => (
              <div key={l.id} className="flex items-center gap-2.5 border-b border-line/60 py-1.5 text-[12.5px] last:border-b-0">
                <span className="min-w-0 flex-1 text-ink">{l.description}</span>
                <span className="text-ink-3 tabular-nums">
                  {l.quantity} × {amount(l.unit_price)}
                </span>
                <b className="text-ink tabular-nums">{amount(l.line_total, n.currency)}</b>
              </div>
            ))}
          </Section>
          {n.kind === 'credit' ? (
            <Section title={`Applied to (${n.allocations.length})`}>
              {n.allocations.length ? (
                n.allocations.map((a) => (
                  <div key={a.id} className="flex items-center gap-2.5 border-b border-line/60 py-1.5 text-[12.5px] last:border-b-0">
                    <button type="button" className="min-w-0 flex-1 truncate text-left font-bold text-primary hover:underline" onClick={() => onOpenInvoice(a.invoice_id)}>
                      {a.number ?? `#${a.invoice_id}`}
                    </button>
                    <b className="text-ink tabular-nums">{amount(a.amount, n.currency)}</b>
                    {may && !draft ? (
                      <button
                        type="button"
                        className="text-[12px] font-semibold text-danger hover:underline"
                        disabled={busy}
                        title="Take it off this invoice: the invoice owes it again"
                        onClick={() => void run(() => unapplyNote(n.id, a.invoice_id), `Taken off ${a.number ?? 'the invoice'}; the credit is unused again.`)}
                      >
                        Unapply
                      </button>
                    ) : null}
                  </div>
                ))
              ) : (
                <span className="text-[12.5px] text-ink-3">{draft ? 'Applied when it is issued, if it is raised against an invoice.' : 'Not applied to any invoice yet.'}</span>
              )}
            </Section>
          ) : null}
          {asking === 'apply' ? <ApplySheet n={n} onClose={() => setAsking(null)} /> : null}
          {asking === 'refund' ? <RefundCreditSheet n={n} onClose={() => setAsking(null)} /> : null}
          {asking === 'issue' || asking === 'delete' ? (
            <Sheet
              title={asking === 'issue' ? `Issue this ${n.kind} note?` : 'Delete this draft?'}
              width={420}
              onClose={() => setAsking(null)}
              footer={
                <>
                  <button type="button" className={btn} onClick={() => setAsking(null)}>
                    Cancel
                  </button>
                  {asking === 'issue' ? (
                    <button
                      type="button"
                      className={btnPrimary}
                      disabled={busy}
                      onClick={() =>
                        void run(async () => {
                          const r = await issueNote(n.id);
                          toast('success', r.message ?? 'Issued.');
                          if (n.kind === 'credit' && n.invoice_id && !r.data.applied) toast('error', `It was issued, but could not be applied to ${n.invoice_number ?? 'the invoice'}. Apply it from here.`);
                        }, null)
                      }
                    >
                      {busy ? 'Issuing…' : 'Issue'}
                    </button>
                  ) : (
                    <button type="button" className={btnPrimary + ' !bg-danger hover:!opacity-90'} disabled={busy} onClick={() => void run(() => deleteNote(n.id), 'Draft deleted.', onClose)}>
                      Delete
                    </button>
                  )}
                </>
              }
            >
              <p className="m-0 text-[13px] text-ink-2">
                {asking === 'delete'
                  ? 'It has no number yet, so nothing is lost from the sequence.'
                  : n.kind === 'credit'
                    ? n.invoice_id
                      ? `It is numbered and applied to ${n.invoice_number ?? 'the invoice it was raised against'} immediately.`
                      : 'It is numbered and becomes a balance the customer can spend on any later invoice.'
                    : `It is numbered and adds ${amount(n.total, n.currency)} to what ${n.client ?? 'the customer'} owes, due in 14 days.`}
              </p>
            </Sheet>
          ) : null}
        </>
      ) : null}
    </SidePanel>
  );
}

function ApplySheet({ n, onClose }: { n: NoteDetail; onClose: () => void }) {
  const qc = useQueryClient();
  const open = useQuery({ queryKey: ['billing', 'open-invoices', n.client_id], queryFn: ({ signal }) => openInvoicesOf(n.client_id!, signal), enabled: !!n.client_id });
  const invoices = (open.data ?? []).filter((i) => i.currency === n.currency && i.due > 0);
  const [invoice, setInvoice] = useState('');
  const [value, setValue] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const chosen = invoices.find((i) => String(i.id) === invoice);
  const suggested = chosen ? Math.min(n.remaining, chosen.due) : 0;
  const text = value ?? (suggested ? suggested.toFixed(2) : '');
  const sum = Number(text.replace(/,/g, '')) || 0;
  const send = async () => {
    if (!chosen) return;
    setBusy(true);
    try {
      await applyNote(n.id, chosen.id, sum);
      toast('success', `${amount(sum, n.currency)} applied to ${chosen.number}.`);
      void qc.invalidateQueries({ queryKey: K.all });
      onClose();
    } catch (e) {
      toast('error', errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet
      title={`Apply ${n.number ?? 'this credit note'}`}
      width={440}
      onClose={onClose}
      footer={
        <>
          <button type="button" className={btn} onClick={onClose}>
            Cancel
          </button>
          <button type="button" className={btnPrimary} disabled={busy || !chosen || sum <= 0 || sum > n.remaining + 0.005 || (!!chosen && sum > chosen.due + 0.005)} onClick={() => void send()}>
            Apply
          </button>
        </>
      }
    >
      <p className="m-0 text-[12.5px] text-ink-3">
        {amount(n.remaining, n.currency)} unused · {n.client}
      </p>
      <Field label="Invoice">
        <Select<string>
          aria-label="Invoice"
          value={invoice}
          onValueChange={(v) => (setInvoice(v), setValue(null))}
          placeholder={open.isLoading ? 'Reading…' : invoices.length ? 'Choose the invoice' : 'Nothing is owed in this currency'}
          options={invoices.map((i) => ({ value: String(i.id), label: i.number ?? `#${i.id}`, hint: `owes ${amount(i.due, i.currency)}${i.due_date ? ` · due ${dateLabel(i.due_date)}` : ''}` }))}
          className={input}
        />
      </Field>
      <Field label="Amount">
        <input aria-label="Amount" inputMode="decimal" value={text} onChange={(e) => setValue(e.target.value)} className={input + ' tabular-nums'} />
      </Field>
    </Sheet>
  );
}

/** Pay a credit note's unused balance out (G-16): how much, by which payment mode, from which bank account. */
function RefundCreditSheet({ n, onClose }: { n: NoteDetail; onClose: () => void }) {
  const qc = useQueryClient();
  const perms = useStore(app, (s) => s.bootstrap?.permissions);
  const org = n.org_id ? String(n.org_id) : '';
  const modes = useQuery({ queryKey: KB.modes(org), queryFn: ({ signal }) => fetchModes(org, signal), staleTime: 300_000 });
  const canBank = !!perms && (perms.includes('*') || perms.includes('finance.view'));
  const banks = useQuery({ queryKey: ['billing', 'banks', org], queryFn: ({ signal }) => fetchBankAccounts(Number(org), signal), enabled: canBank && !!org, retry: false, staleTime: 300_000 });
  const [value, setValue] = useState(n.remaining.toFixed(2));
  const [mode, setMode] = useState('');
  const [bank, setBank] = useState('');
  const [busy, setBusy] = useState(false);
  const sum = Number(value.replace(/,/g, '')) || 0;
  const active = (modes.data ?? []).filter((m) => m.is_active && m.kind !== 'offset');
  const send = async () => {
    setBusy(true);
    try {
      const chosenMode = active.find((m) => String(m.id) === mode);
      const r = await refundCredit(n.id, { amount: sum, mode_id: Number(mode), ...(chosenMode ? { method: chosenMode.kind } : {}), ...(bank ? { bank_account_id: Number(bank) } : {}) });
      toast('success', r.message ?? `${amount(sum, n.currency)} refunded to ${n.client ?? 'the customer'}${r.data?.reference ? ` (${r.data.reference})` : ''}.`);
      void qc.invalidateQueries({ queryKey: K.all });
      onClose();
    } catch (e) {
      toast('error', errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet
      title={`Refund credit from ${n.number ?? 'this note'}`}
      width={440}
      onClose={onClose}
      footer={
        <>
          <button type="button" className={btn} onClick={onClose}>
            Cancel
          </button>
          <button type="button" className={btnPrimary} disabled={busy || sum <= 0 || sum > n.remaining + 0.005 || !mode} onClick={() => void send()}>
            Refund {amount(sum, n.currency)}
          </button>
        </>
      }
    >
      <p className="m-0 text-[12.5px] text-ink-3">
        {amount(n.remaining, n.currency)} unused · {n.client}
      </p>
      <Field label="Amount" hint={sum > n.remaining + 0.005 ? <span className="text-danger">More than the unused credit.</span> : undefined}>
        <input aria-label="Amount" inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} className={input + ' tabular-nums'} />
      </Field>
      <Field label="Paid out by">
        <Select<string> aria-label="Paid out by" value={mode} onValueChange={setMode} placeholder={modes.isLoading ? 'Reading…' : 'Choose the payment mode'} options={active.map((m) => ({ value: String(m.id), label: m.name }))} className={input} />
      </Field>
      {banks.data ? (
        <Field label="From the account">
          <Select<string>
            aria-label="From the account"
            value={bank}
            onValueChange={setBank}
            options={[{ value: '', label: 'The company default' }, ...banks.data.accounts.map((a) => ({ value: String(a.id), label: `${a.code ? `${a.code} ` : ''}${a.name}`, hint: a.currency ?? undefined }))]}
            className={input}
          />
        </Field>
      ) : null}
      <p className="m-0 rounded-[8px] bg-subtle px-3 py-2 text-[12px] text-ink-2">This records money paid back to the customer and posts it. Nothing here sends it.</p>
    </Sheet>
  );
}

type NoteLine = { description: string; quantity: string; unit_price: string };
const blankLine = (): NoteLine => ({ description: '', quantity: '1', unit_price: '' });

/** The lines a note sends: those with a description or an amount, as numbers. */
export function noteLinesToSend(lines: NoteLine[]): Array<{ description: string; quantity: number; unit_price: number }> {
  return lines
    .map((l) => ({ description: l.description.trim(), quantity: Number(l.quantity.replace(/,/g, '')) || 0, unit_price: Number(l.unit_price.replace(/,/g, '')) || 0 }))
    .filter((l) => l.quantity > 0 && l.unit_price > 0)
    .map((l) => ({ ...l, description: l.description || 'Adjustment' }));
}

/**
 * A new note (BillRecurringSheet "New credit note"): the customer, what it is
 * against (an issued invoice still owing, or nothing), how much and why. With
 * an invoice, its customer, company and currency come from the invoice, and a
 * credit note is capped at what the invoice still owes.
 */
function NewNote({ org, kind: startKind, against, onClose }: { org: string; kind: 'credit' | 'debit'; against: number | null; onClose: (id?: number) => void }) {
  const qc = useQueryClient();
  const orgs = useBillingOrgs();
  const [kind, setKind] = useState(startKind);
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [hits, setHits] = useState<Customer[]>([]);
  const [term, setTerm] = useState('');
  const [searching, setSearching] = useState(false);
  const [invoice, setInvoice] = useState(against ? String(against) : '');
  const [company, setCompany] = useState(/^\d+$/.test(org) ? org : '');
  const [lines, setLines] = useState<NoteLine[]>([blankLine()]);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);
  // Started from an invoice: its customer is the note's.
  const from = useQuery({ queryKey: K.invoice(against ?? 0), queryFn: ({ signal }) => fetchInvoice(against!, signal), enabled: !!against });
  const fromInv = from.data?.invoice;
  const client = customer ?? (fromInv?.client_id ? ({ id: fromInv.client_id, name: fromInv.client ?? '' } as Customer) : null);
  const open = useQuery({ queryKey: ['billing', 'open-invoices', client?.id], queryFn: ({ signal }) => openInvoicesOf(client!.id, signal), enabled: !!client });
  const chosen = (open.data ?? []).find((i) => String(i.id) === invoice) ?? (fromInv && String(fromInv.id) === invoice ? { id: fromInv.id, number: fromInv.number, due: fromInv.due, currency: fromInv.currency } : undefined);
  const toSend = noteLinesToSend(lines);
  const sum = notesTotal(toSend);
  const several = (orgs.data ?? []).length > 1;
  const ready = !!client && sum > 0 && (!!invoice || !several || !!company) && !(kind === 'credit' && chosen && sum > chosen.due + 0.005);
  const search = (q: string) => {
    setTerm(q);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      setSearching(true);
      searchCustomers(q, org)
        .then(setHits, () => setHits([]))
        .finally(() => setSearching(false));
    }, 250);
  };
  const save = async () => {
    if (!ready || !client) return;
    setBusy(true);
    try {
      const r = await createNote({ kind, client_id: client.id, ...(invoice ? { invoice_id: Number(invoice) } : company ? { org_id: Number(company) } : {}), ...(reason.trim() ? { reason: reason.trim() } : {}), lines: toSend });
      toast('success', `Draft ${kind} note saved. Issue it to number it${kind === 'credit' && invoice ? ' and apply it' : ''}.`);
      void qc.invalidateQueries({ queryKey: K.all });
      onClose(r.note.id);
    } catch (e) {
      toast('error', errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <SidePanel
      label={`New ${kind} note`}
      width={440}
      onClose={() => onClose()}
      head={
        <span className="flex min-w-0 flex-col">
          <b className="text-[15px] text-ink">New {kind} note</b>
          <span className="text-[12px] text-ink-3">{kind === 'credit' ? 'Reduces what a customer owes' : 'Adds to what a customer owes'}</span>
        </span>
      }
    >
      <Seg<'credit' | 'debit'>
        label="Kind of note"
        value={kind}
        onChange={setKind}
        options={[
          { id: 'credit', label: 'Credit note' },
          { id: 'debit', label: 'Debit note' },
        ]}
      />
      <Field label="Customer">
        <Select<string>
          aria-label="Customer"
          value={client ? String(client.id) : ''}
          disabled={!!against}
          onSearch={search}
          loading={searching}
          empty={term ? 'No customer matches.' : 'Type to find a customer.'}
          placeholder="Choose a customer"
          options={[...(client && !hits.some((h) => h.id === client.id) ? [client] : []), ...hits].map((c) => ({ value: String(c.id), label: c.name, hint: c.email ?? undefined }))}
          onValueChange={(v) => (setCustomer([...hits, ...(client ? [client] : [])].find((c) => String(c.id) === v) ?? null), setInvoice(''))}
          className={input}
        />
      </Field>
      <Field label="Against an invoice" hint={chosen ? `Outstanding: ${amount(chosen.due, chosen.currency)}` : kind === 'credit' ? 'Without one, it is a balance the customer can spend later.' : undefined}>
        <Select<string>
          aria-label="Against an invoice"
          value={invoice}
          disabled={!client}
          onValueChange={setInvoice}
          options={[
            { value: '', label: 'No specific invoice' },
            ...(fromInv && !(open.data ?? []).some((i) => i.id === fromInv.id) ? [{ value: String(fromInv.id), label: fromInv.number ?? `#${fromInv.id}`, hint: `owes ${amount(fromInv.due, fromInv.currency)}` }] : []),
            ...(open.data ?? []).map((i) => ({ value: String(i.id), label: i.number ?? `#${i.id}`, hint: `owes ${amount(i.due, i.currency)}` })),
          ]}
          className={input}
        />
      </Field>
      {!invoice && several ? (
        <Field label="Company" hint="Whose books the note belongs in">
          <Select<string> aria-label="Company" searchable value={company} onValueChange={setCompany} placeholder="Choose the company" options={(orgs.data ?? []).map((o) => ({ value: String(o.id), label: o.name }))} className={input} />
        </Field>
      ) : null}
      <div className="flex flex-col gap-1.5">
        <span className="text-[12px] font-semibold text-ink-2">Lines{chosen ? ` (${chosen.currency})` : ''}</span>
        {lines.map((l, i) => (
          <div key={i} className="flex items-center gap-1.5">
            <input
              aria-label={`Line ${i + 1} description`}
              value={l.description}
              placeholder="What it is for"
              onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, description: e.target.value } : x)))}
              className={input + ' min-w-0 flex-1'}
            />
            <input
              aria-label={`Line ${i + 1} quantity`}
              inputMode="decimal"
              value={l.quantity}
              onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, quantity: e.target.value } : x)))}
              className={input + ' !w-[52px] text-right tabular-nums'}
            />
            <input
              aria-label={`Line ${i + 1} rate`}
              inputMode="decimal"
              value={l.unit_price}
              placeholder="0.00"
              onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, unit_price: e.target.value } : x)))}
              className={input + ' !w-[96px] text-right tabular-nums'}
            />
            <button
              type="button"
              aria-label={`Remove line ${i + 1}`}
              title="Remove"
              disabled={lines.length === 1}
              className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-ink-3 hover:bg-subtle hover:text-danger disabled:opacity-30"
              onClick={() => setLines(lines.filter((_, j) => j !== i))}
            >
              <Icon name="x" size={13} />
            </button>
          </div>
        ))}
        <span className="flex items-center justify-between">
          <button type="button" className="text-[12.5px] font-semibold text-primary hover:underline" onClick={() => setLines([...lines, blankLine()])}>
            + Add a line
          </button>
          <b className="text-[12.5px] text-ink tabular-nums">Before tax {amount(sum, chosen?.currency)}</b>
        </span>
        {kind === 'credit' && chosen && sum > chosen.due + 0.005 ? <span className="text-[12px] text-danger">More than the invoice still owes. Record a refund instead if money is going back.</span> : null}
      </div>
      <Field label="Reason">
        <input aria-label="Reason" value={reason} onChange={(e) => setReason(e.target.value)} className={input} />
      </Field>
      <div className="mt-auto flex justify-end gap-2 border-t border-line pt-3">
        <button type="button" className={btn} onClick={() => onClose()}>
          Cancel
        </button>
        <button type="button" className={btnPrimary} disabled={busy || !ready} onClick={() => void save()}>
          {busy ? 'Saving…' : 'Create draft'}
        </button>
      </div>
    </SidePanel>
  );
}
