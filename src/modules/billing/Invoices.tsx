import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { call, errorMessage } from '../../core/bridge';
import { dateLabel } from '../../core/time';
import { toast } from '../../core/toasts';
import { Icon } from '../../components/Icon';
import { Select } from '../../components/Select';
import { ErrorNote, Spinner, cx } from '../../components/ui';
import { btn, btnPrimary, btnSmall, Empty, Field, input, PageHead, Sheet } from '../hr/parts';
import { Menu } from '../../components/Menu';
import { BULK_LABEL, bulkAct, bulkFile, bulkSummary, exportRequest, type BulkAction, type BulkResult, type ExportFormat } from './actions';
import { amount, fetchInvoices, invoiceName, K, PER_PAGE, SORTS, STATUS, STATUSES, type Invoice, type ListFilters } from './api';
import { OFFLINE_WRITE, useBillingOffline } from './offline';
import { money, StatusChip } from './parts';
import { Checkbox } from '../../components/Checkbox';

/**
 * Invoices (BillInvoices, W2): the list, with the per-status tallies over
 * every invoice (not just this page), filters, export (G-13: CSV, XLSX or
 * PDF, saved to disk through Transfers, filtered as the list is) and — for
 * those who may issue — the bulk bar: issue, send, one PDF of them all, mark
 * as sent, record each as paid in full, and cancel. The server does each one
 * on its own and says, per invoice, what it did or why it refused; that
 * answer is shown as it came.
 */
type Bulk = { action: BulkAction; ids: number[] };

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
  const [result, setResult] = useState<{ action: BulkAction; r: BulkResult } | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [exporting, setExporting] = useState(false);
  const exportRef = useRef<HTMLButtonElement | null>(null);
  const offline = useBillingOffline();
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
      const r = await bulkAct(bulk.action, bulk.ids, bulk.action === 'cancel' && reason.trim() ? { reason: reason.trim() } : {});
      toast(r.done ? 'success' : 'error', bulkSummary(bulk.action, r));
      const file = bulkFile(r);
      if (file) await call('transfers:download', { ...file, name: `invoices-${new Date().toISOString().slice(0, 10)}.pdf`, open: true }).catch((e) => toast('error', errorMessage(e)));
      if (r.refused) setResult({ action: bulk.action, r });
      setBulk(null);
      setReason('');
      setChosen(r.results.filter((x) => !x.ok).map((x) => x.id));
      void qc.invalidateQueries({ queryKey: K.all });
    } catch (e) {
      toast('error', errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const doExport = (format: ExportFormat) => {
    const x = exportRequest('invoices', format, { org, q: q.trim() || undefined, status: status || (unpaid ? 'sent,viewed,partial,overdue' : undefined) });
    void call('transfers:download', x).then(
      () => toast('success', `Exporting ${format.toUpperCase()} — see Transfers.`),
      (e) => toast('error', errorMessage(e)),
    );
  };
  const nameOf = (id: number) => {
    const r = rows.find((x) => x.id === id);
    return r ? invoiceName(r) : `#${id}`;
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
        <button ref={exportRef} type="button" className={btn} aria-haspopup="menu" aria-expanded={exporting} onClick={() => setExporting((v) => !v)}>
          <Icon name="download" size={14} /> Export
        </button>
        {exporting ? (
          <Menu
            label="Export the invoices"
            anchor={exportRef}
            prefer="bottom"
            align="end"
            width={240}
            sections={[
              {
                id: 'fmt',
                label: 'As filtered, every page',
                items: (['csv', 'xlsx', 'pdf'] as ExportFormat[]).map((f) => ({
                  id: f,
                  label: f === 'csv' ? 'CSV' : f === 'xlsx' ? 'Excel (XLSX)' : 'PDF',
                  description: f === 'xlsx' ? 'CSV where the server has no Excel writer' : undefined,
                  onSelect: () => doExport(f),
                })),
              },
            ]}
            onClose={() => setExporting(false)}
          />
        ) : null}
        {canCreate ? (
          <button type="button" className={btnPrimary} disabled={offline} title={offline ? OFFLINE_WRITE : undefined} onClick={onNew}>
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
        <div role="toolbar" aria-label="With the chosen invoices" className="flex flex-wrap items-center gap-2 self-start rounded-[9px] border border-info-line bg-selection px-2.5 py-1.5 dark:border-primary/40 dark:bg-selection">
          <b className="text-[12.5px] text-primary">{chosen.length} selected</b>
          {(['issue', 'send', 'pdf', 'mark_sent', 'record_payment', 'cancel'] as BulkAction[]).map((a) => (
            <button
              key={a}
              type="button"
              disabled={offline && a !== 'pdf'}
              title={offline && a !== 'pdf' ? OFFLINE_WRITE : undefined}
              className={btnSmall + ' !h-7' + (a === 'cancel' ? ' !text-danger' : '')}
              onClick={() => setBulk({ action: a, ids: chosen })}
            >
              {BULK_LABEL[a].verb}
            </button>
          ))}
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
          title={bulkTitle(bulk)}
          width={460}
          onClose={() => setBulk(null)}
          footer={
            <>
              <button type="button" className={btn} onClick={() => setBulk(null)}>
                {bulk.action === 'cancel' ? 'Back' : 'Cancel'}
              </button>
              <button type="button" className={btnPrimary + (bulk.action === 'cancel' ? ' !bg-danger hover:!opacity-90' : '')} disabled={busy} onClick={() => void runBulk()}>
                {busy ? 'Working…' : bulk.action === 'cancel' ? 'Cancel them' : BULK_LABEL[bulk.action].verb}
              </button>
            </>
          }
        >
          <p className="m-0 text-[13px] text-ink-2">{BULK_HELP[bulk.action]} Each one is done on its own; any refused are named with the reason.</p>
          {bulk.action === 'cancel' ? (
            <Field label="Why?">
              <input aria-label="Why?" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={250} placeholder="Raised against the wrong company" className={input} />
            </Field>
          ) : null}
        </Sheet>
      ) : null}
      {result ? <BulkResults action={result.action} r={result.r} nameOf={nameOf} onOpen={(id) => (setResult(null), onOpen(id))} onClose={() => setResult(null)} /> : null}
    </div>
  );
}

const BULK_HELP: Record<BulkAction, string> = {
  issue: 'Drafts are numbered and frozen, and posted. Ones that need approval are refused.',
  send: 'Each is emailed to its customer with its PDF and a pay link, by the invoice template.',
  pdf: 'Their PDFs are put in one file, saved to Transfers.',
  mark_sent: 'This records that they were sent. It does not send anything. Drafts are refused: a draft is issued first.',
  record_payment: 'Each is recorded as paid in full today, by bank transfer to the company’s default account.',
  cancel: 'Their journals are reversed and they stay on the record, marked cancelled. Any with payments, or in a locked period, are refused and named.',
};

const bulkTitle = (b: Bulk) => {
  const n = `${b.ids.length} ${b.ids.length === 1 ? 'invoice' : 'invoices'}`;
  return b.action === 'pdf' ? `One PDF of ${n}?` : b.action === 'mark_sent' ? `Record ${n} as sent?` : b.action === 'record_payment' ? `Record ${n} as paid?` : `${BULK_LABEL[b.action].verb} ${n}?`;
};

/** What a bulk act did, invoice by invoice: those refused first, with the server's reason, each one openable. */
export function BulkResults({ action, r, nameOf, onOpen, onClose }: { action: BulkAction; r: BulkResult; nameOf: (id: number) => string; onOpen: (id: number) => void; onClose: () => void }) {
  const sorted = [...r.results].sort((a, b) => Number(a.ok) - Number(b.ok));
  return (
    <Sheet
      title={`${BULK_LABEL[action].verb}: ${r.done} done, ${r.refused} refused`}
      width={500}
      onClose={onClose}
      footer={
        <button type="button" className={btnPrimary} onClick={onClose}>
          Done
        </button>
      }
    >
      <p className="m-0 text-[12.5px] text-ink-2">{bulkSummary(action, r)} The refused ones stay chosen in the list.</p>
      <div role="list" aria-label="Results" className="flex flex-col">
        {sorted.map((x) => (
          <div role="listitem" key={x.id} data-ok={x.ok ? '1' : '0'} className="flex items-start gap-2 border-b border-line/60 py-1.5 text-[12.5px] last:border-b-0">
            <Icon name={x.ok ? 'check' : 'x'} size={14} className={cx('mt-0.5 shrink-0', x.ok ? 'text-success' : 'text-danger')} />
            <button type="button" className="w-[110px] shrink-0 truncate text-left font-bold text-primary hover:underline" onClick={() => onOpen(x.id)}>
              {x.number ?? nameOf(x.id)}
            </button>
            <span className={cx('min-w-0 flex-1', x.ok ? 'text-ink-3' : 'text-danger')}>{x.ok ? (x.message ?? 'Done') : (x.message ?? x.code ?? 'Refused')}</span>
          </div>
        ))}
      </div>
    </Sheet>
  );
}

function Row({ r, chosen, canChoose, onChoose, onOpen }: { r: Invoice; chosen: boolean; canChoose: boolean; onChoose: () => void; onOpen: () => void }) {
  const draft = r.status === 'draft';
  const late = r.status === 'overdue' || r.days_overdue > 0;
  return (
    <div data-invoice={r.id} className={cx('flex items-center gap-2.5 border-b border-line/60 px-3.5 py-2 text-[12.5px] last:border-b-0 hover:bg-subtle/60', chosen && 'bg-info-soft dark:bg-selection/40')}>
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

