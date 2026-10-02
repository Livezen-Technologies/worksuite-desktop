import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { errorMessage } from '../../core/bridge';
import { dateLabel } from '../../core/time';
import { toast } from '../../core/toasts';
import { Icon } from '../../components/Icon';
import { Select } from '../../components/Select';
import { ErrorNote, Spinner, cx } from '../../components/ui';
import { btn, btnPrimary, btnSmall, Empty, Field, input, PageHead, Sheet } from '../hr/parts';
import { amount, bulkInvoices, fetchInvoices, invoiceName, K, PER_PAGE, SORTS, STATUS, STATUSES, type Invoice, type ListFilters } from './api';
import { money, StatusChip } from './parts';
import { Checkbox } from '../../components/Checkbox';

/**
 * Invoices (BillInvoices): the list, with the per-status tallies over every
 * invoice (not just this page), filters, and — for those who may issue — the
 * two bulk acts the server allows: recording several as sent, and cancelling
 * them. Issuing is never a bulk act; each draft is issued on its own.
 */
type Bulk = { action: 'sent' | 'cancel'; ids: number[] };

export default function Invoices({ org, narrow, salesDate, outstanding, currency, canCreate, canIssue, onOpen, onNew }: {
  org: string;
  /** Where the list starts: a status ('draft', 'overdue'), unpaid, or everything. */
  narrow: string | null;
  salesDate?: string | null;
  outstanding: number | null;
  currency: string | null;
  canCreate: boolean;
  canIssue: boolean;
  onOpen: (id: number) => void;
  onNew: () => void;
}) {
  const qc = useQueryClient();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState(narrow && narrow !== 'unpaid' ? narrow : '');
  const [unpaid, setUnpaid] = useState(narrow === 'unpaid');
  const [sort, setSort] = useState('created');
  const [dir, setDir] = useState<'asc' | 'desc'>('desc');
  const [page, setPage] = useState(1);
  const [chosen, setChosen] = useState<number[]>([]);
  const [bulk, setBulk] = useState<Bulk | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  // The rail's "drafts" and the dashboard's tiles land here narrowed; a new narrowing replaces the filters.
  const scope = `${org}:${narrow ?? ''}:${salesDate ?? ''}`;
  const [seen, setSeen] = useState(scope);
  if (seen !== scope) {
    setSeen(scope);
    setStatus(narrow && narrow !== 'unpaid' ? narrow : '');
    setUnpaid(narrow === 'unpaid');
    setPage(1);
    setChosen([]);
  }
  const f: ListFilters = { q, status, unpaid, sort, dir, page, salesDate };
  const list = useQuery({ queryKey: K.invoices(org, f), queryFn: ({ signal }) => fetchInvoices(org, f, signal), placeholderData: salesDate ? undefined : keepPreviousData });
  const rows = list.data?.invoices ?? [];
  const pages = Math.max(1, Math.ceil((list.data?.total ?? 0) / PER_PAGE));
  const reset = (fn: () => void) => {
    fn();
    setPage(1);
    setChosen([]);
  };
  const toggle = (id: number) => setChosen((c) => (c.includes(id) ? c.filter((x) => x !== id) : [...c, id]));
  const allOnPage = rows.length > 0 && rows.every((r) => chosen.includes(r.id));

  const runBulk = async () => {
    if (!bulk) return;
    setBusy(true);
    try {
      const r = await bulkInvoices(bulk.action, bulk.ids, reason);
      const did = r.done.length;
      const word = bulk.action === 'sent' ? 'recorded as sent' : 'cancelled';
      if (did) toast('success', `${did} ${did === 1 ? 'invoice' : 'invoices'} ${word}.`);
      for (const x of r.failed.slice(0, 4)) toast('error', `${x.number ?? `Draft #${x.id}`}: ${x.why}`);
      if (r.failed.length > 4) toast('error', `${r.failed.length - 4} more could not be ${word}.`);
      setBulk(null);
      setReason('');
      setChosen([]);
      void qc.invalidateQueries({ queryKey: K.all });
    } catch (e) {
      toast('error', errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      {salesDate ? <p role="status" className="px-4 py-2 text-[12px] text-ink-2">Supporting gross sales invoices dated {salesDate}. Drafts, cancellations, proformas, credit/debit notes and records without a company are excluded.</p> : null}
      <PageHead title="Invoices">
        {!salesDate && outstanding !== null ? (
          <span className="mr-1.5 flex flex-col items-end">
            <span className="text-[11.5px] text-ink-3">Outstanding</span>
            <b className="text-ink tabular-nums">{money(outstanding, currency)}</b>
          </span>
        ) : null}
        {canCreate ? (
          <button type="button" className={btnPrimary} onClick={onNew}>
            <Icon name="plus" size={15} /> New invoice
          </button>
        ) : null}
      </PageHead>
      <div className="flex flex-wrap items-center gap-2">
        <input value={q} onChange={(e) => reset(() => setQ(e.target.value))} placeholder="Search number, customer, PO" aria-label="Search invoices" className={input + ' !w-[240px]'} />
        <Select<string> aria-label="Status" value={status} onValueChange={(v) => reset(() => setStatus(v))} options={[{ value: '', label: 'Any status' }, ...STATUSES.map((s) => ({ value: s, label: STATUS[s].label }))]} className={input + ' !w-[130px]'} />
        <label className="flex items-center gap-1.5 font-semibold text-ink">
          <Checkbox checked={unpaid} onChange={(e) => reset(() => setUnpaid(e.target.checked))} />
          Unpaid only
        </label>
        <Select<string> aria-label="Sort" value={sort} onValueChange={(v) => reset(() => setSort(v))} options={SORTS.map((s) => ({ value: s.id, label: `Sort: ${s.label}` }))} className={input + ' !w-[170px]'} />
        <button type="button" className={btn + ' !w-[34px] justify-center !px-0'} aria-label={dir === 'desc' ? 'Descending — show ascending' : 'Ascending — show descending'} title={dir === 'desc' ? 'Descending' : 'Ascending'} onClick={() => reset(() => setDir((d) => (d === 'desc' ? 'asc' : 'desc')))}>
          <Icon name={dir === 'desc' ? 'arrow-down' : 'arrow-up'} size={15} />
        </button>
      </div>
      {list.data?.summary ? (
        <div className="flex flex-wrap gap-3 text-[12px] text-ink-2">
          {STATUSES.filter((s) => (list.data!.summary[s]?.count ?? 0) > 0).map((s) => (
            <button key={s} type="button" onClick={() => reset(() => (setStatus(s), setUnpaid(false)))} className={cx('hover:underline', s === 'overdue' && 'text-danger', status === s && 'font-bold')}>
              {STATUS[s].label}: <b className="tabular-nums">{list.data!.summary[s]!.count}</b>
            </button>
          ))}
        </div>
      ) : null}
      {chosen.length && canIssue ? (
        <div className="flex items-center gap-2 self-start rounded-[9px] border border-[#C7D0F5] bg-[#EEF1FC] px-2.5 py-1.5 dark:border-primary/40 dark:bg-selection">
          <b className="text-[12.5px] text-primary">{chosen.length} selected</b>
          <button type="button" className={btnSmall + ' !h-7'} onClick={() => setBulk({ action: 'sent', ids: chosen })}>
            Mark as sent
          </button>
          <button type="button" className={btnSmall + ' !h-7 !text-danger'} onClick={() => setBulk({ action: 'cancel', ids: chosen })}>
            Cancel
          </button>
          <button type="button" className="text-[12px] font-semibold text-primary hover:underline" onClick={() => setChosen([])}>
            Clear the selection
          </button>
        </div>
      ) : null}
      {list.isLoading ? (
        <Spinner />
      ) : list.error ? (
        <ErrorNote error={list.error} onRetry={() => void list.refetch()} />
      ) : (
        <div className="overflow-hidden rounded-[12px] border border-line bg-surface">
          <div className="flex items-center gap-2.5 border-b border-line bg-ground px-3.5 py-2 text-[11px] font-bold tracking-[.4px] text-ink-3 uppercase">
            {canIssue ? <Checkbox aria-label="Choose every invoice on this page" checked={allOnPage} indeterminate={!allOnPage && rows.some((r) => chosen.includes(r.id))} onChange={() => setChosen(allOnPage ? chosen.filter((c) => !rows.some((r) => r.id === c)) : [...new Set([...chosen, ...rows.map((r) => r.id)])])} /> : null}
            <span className="w-[130px] shrink-0">Invoice</span>
            <span className="min-w-0 flex-1">Customer</span>
            <span className="w-[120px] shrink-0">Status</span>
            <span className="w-[84px] shrink-0">Issued</span>
            <span className="w-[84px] shrink-0">Due</span>
            <span className="w-[124px] shrink-0 text-right">Total</span>
            <span className="w-[124px] shrink-0 text-right">Outstanding</span>
          </div>
          {rows.length ? rows.map((r) => <Row key={r.id} r={r} chosen={chosen.includes(r.id)} canChoose={canIssue} onChoose={() => toggle(r.id)} onOpen={() => onOpen(r.id)} />) : <Empty text={q || status || unpaid ? 'No invoice matches those filters.' : 'No invoices yet.'} />}
        </div>
      )}
      {pages > 1 ? (
        <div className="flex items-center justify-center gap-2.5">
          <button type="button" className={btn} disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
            Previous
          </button>
          <span className="text-[12.5px] text-ink-2 tabular-nums">
            Page {page} of {pages} · {list.data?.total.toLocaleString()} invoices
          </span>
          <button type="button" className={btn} disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>
            Next
          </button>
        </div>
      ) : null}

      {bulk ? (
        <Sheet
          title={bulk.action === 'sent' ? `Record ${bulk.ids.length} ${bulk.ids.length === 1 ? 'invoice' : 'invoices'} as sent?` : `Cancel ${bulk.ids.length} ${bulk.ids.length === 1 ? 'invoice' : 'invoices'}?`}
          width={440}
          onClose={() => setBulk(null)}
          footer={
            <>
              <button type="button" className={btn} onClick={() => setBulk(null)}>
                {bulk.action === 'sent' ? 'Cancel' : 'Back'}
              </button>
              <button type="button" className={btnPrimary + (bulk.action === 'cancel' ? ' !bg-danger hover:!opacity-90' : '')} disabled={busy} onClick={() => void runBulk()}>
                {busy ? 'Working…' : bulk.action === 'sent' ? 'Record' : 'Cancel them'}
              </button>
            </>
          }
        >
          {bulk.action === 'sent' ? (
            <p className="m-0 text-[13px] text-ink-2">This records that they were sent. It does not send anything. Drafts are refused: a draft is issued first.</p>
          ) : (
            <>
              <p className="m-0 text-[13px] text-ink-2">Cancelling is not deleting — they stay on the record, marked cancelled. Any with payments against them are refused and named.</p>
              <Field label="Why?">
                <input aria-label="Why?" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={250} placeholder="Raised against the wrong company" className={input} />
              </Field>
            </>
          )}
        </Sheet>
      ) : null}
    </div>
  );
}

function Row({ r, chosen, canChoose, onChoose, onOpen }: { r: Invoice; chosen: boolean; canChoose: boolean; onChoose: () => void; onOpen: () => void }) {
  const draft = r.status === 'draft';
  const late = r.status === 'overdue' || r.days_overdue > 0;
  return (
    <div data-invoice={r.id} className={cx('flex items-center gap-2.5 border-b border-line/60 px-3.5 py-2 text-[12.5px] last:border-b-0 hover:bg-subtle/60', chosen && 'bg-[#F4F6FE] dark:bg-selection/40')}>
      {canChoose ? <Checkbox aria-label={`Choose ${invoiceName(r)}`} checked={chosen} onChange={onChoose} /> : null}
      <button type="button" aria-label={`Open ${invoiceName(r)}`} onClick={onOpen} className="flex w-[130px] shrink-0 flex-col text-left">
        <b className={cx('truncate', draft ? 'text-ink-3' : 'text-ink')}>{draft ? 'Draft' : r.number}</b>
        {r.project || r.po_number ? <span className="truncate text-[11.5px] text-ink-3">{r.project ?? `PO ${r.po_number}`}</span> : null}
      </button>
      <button type="button" onClick={onOpen} className="min-w-0 flex-1 truncate text-left text-ink">
        {r.client ?? 'No customer'}
      </button>
      <span className="w-[120px] shrink-0">
        <StatusChip status={r.status} late={late ? r.days_overdue : 0} />
      </span>
      <span className="w-[84px] shrink-0 text-ink-2">{r.issue_date && !draft ? dateLabel(r.issue_date) : '—'}</span>
      <span className="w-[84px] shrink-0 text-ink-2">{r.due_date && !draft ? dateLabel(r.due_date) : '—'}</span>
      <b className="w-[124px] shrink-0 text-right text-ink tabular-nums">{amount(r.total, r.currency)}</b>
      <span className={cx('w-[124px] shrink-0 text-right tabular-nums', late ? 'font-semibold text-danger' : 'text-ink')}>{draft || r.status === 'cancelled' ? '—' : amount(r.due, r.currency)}</span>
    </div>
  );
}

