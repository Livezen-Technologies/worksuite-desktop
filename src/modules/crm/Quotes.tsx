import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { apiDelete, apiGet, apiPost, apiPut } from '../../core/api';
import { app } from '../../core/app-state';
import { call, errorMessage } from '../../core/bridge';
import { useStore } from '../../core/store';
import { dateLabel } from '../../core/time';
import { toast } from '../../core/toasts';
import { Icon } from '../../components/Icon';
import { Select } from '../../components/Select';
import { ErrorNote, Spinner, cx } from '../../components/ui';
import { btn, btnPrimary, btnSmall, Field, input, PageHead, Sheet } from '../hr/parts';
import type { Account, Product, Quote, QuoteLine } from './api';
import { crmCan, money, moneyFull, StatusBar } from './parts';
import { Checkbox } from '../../components/Checkbox';
import { isMissing, pageOf, type PageMeta } from './logic';
import { exportCrmCsv } from './exportCsv';
import { CompanyField, orgIdFor, useCrmScope } from './scope';
import { clickOnKey } from '../../components/press';

/**
 * Quotes (CrmQuotes, desk-quote): the list for the company the CRM is
 * showing, with what is out in each status, Export and the StatusBar; one
 * quote on its own page — a draft in the editor (lines from the price list
 * or typed, in a table whose number columns keep their width and line up,
 * W11; a discount, notes and terms; the totals block on the right); Open PDF,
 * Mark as sent, Mark accepted or Declined (with a reason), Convert to
 * invoice where the server offers it, and Revise; a sent quote read-only,
 * changed only by a revision (a new draft that replaces it). Totals are the
 * server's: this screen shows the same sums while typing, and the server
 * works them out again on save.
 */
const STATUSES: Array<[Quote['status'], string]> = [
  ['draft', 'Draft'],
  ['sent', 'Sent'],
  ['accepted', 'Accepted'],
  ['declined', 'Declined'],
  ['expired', 'Expired'],
];
const TONE: Record<string, string> = {
  draft: 'bg-subtle text-ink-2',
  sent: 'bg-selection text-primary',
  accepted: 'bg-success-bg text-success-ink dark:bg-success-bg dark:text-success',
  declined: 'bg-danger-bg text-danger-ink dark:bg-danger-bg dark:text-danger',
  expired: 'bg-warning-bg text-warning-ink dark:bg-warning-bg dark:text-warning',
};

export function QuoteStatus({ status, expired }: { status: string; expired?: boolean }) {
  const s = expired && status === 'sent' ? 'expired' : status;
  return <span className={cx('rounded-full px-2 py-0.5 text-[11.5px] font-bold capitalize', TONE[s] ?? 'bg-subtle text-ink-2')}>{expired && status === 'sent' ? 'Past its date' : s}</span>;
}

interface QuoteList {
  quotes: Quote[];
  total?: number;
  page?: number;
  summary?: Record<string, { count: number; value: number }>;
  meta?: Partial<PageMeta>;
}

const PER_PAGE = 50;

export default function Quotes({ openId, creating, forAccount, onOpen, onNew, onCloseNew, onOpenAccount, onOpenInvoice }: { openId: number | null; creating: boolean; forAccount?: number | null; onOpen: (id: number | null) => void; onNew: () => void; onCloseNew: () => void; onOpenAccount: (id: number) => void; onOpenInvoice: (id: number) => void }) {
  const qc = useQueryClient();
  const scope = useCrmScope();
  const perms = useStore(app, (s) => s.bootstrap?.permissions);
  const canQuote = crmCan(perms, 'crm.quote');
  const canExport = crmCan(perms, 'crm.export');
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [mine, setMine] = useState(false);
  const [page, setPage] = useState(1);
  const filters = { q: q.trim() || undefined, status: status || undefined, mine: mine ? 1 : undefined, ...scope.params };
  const params = { ...filters, page, per_page: PER_PAGE };
  const list = useQuery({ queryKey: ['crm', 'quotes', params], queryFn: ({ signal }) => apiGet<QuoteList>('/api/crm/quotes', params, signal), enabled: !openId && !creating });
  const refresh = () => void qc.invalidateQueries({ queryKey: ['crm'] });
  const rows = list.data?.quotes ?? [];
  const meta = list.data ? pageOf({ ...list.data, meta: { per_page: PER_PAGE, ...list.data.meta } }, rows.length) : null;
  const summary = list.data?.summary ?? {};
  const countOf = (s: string) => meta?.counts?.[s] ?? summary[s]?.count ?? 0;

  if (openId || creating) {
    return <QuoteEditor key={openId ?? 'new'} id={openId} forAccount={forAccount ?? null} onBack={() => (creating ? onCloseNew() : onOpen(null))} onChanged={refresh} onOpen={(id) => (creating ? (onCloseNew(), onOpen(id)) : onOpen(id))} onOpenAccount={onOpenAccount} onOpenInvoice={onOpenInvoice} />;
  }

  const exportList = () =>
    void exportCrmCsv('/api/crm/quotes/export', filters, 'quotes', () => [
      ['Quote', 'Account', 'Status', 'Issued', 'Valid until', 'Subtotal', 'Discount', 'Tax', 'Total', 'Currency'],
      ...rows.map((r) => [r.quote_no, r.account, r.expired && r.status === 'sent' ? 'expired' : r.status, r.issued_on, r.valid_until, r.subtotal, r.discount, r.tax, r.total, r.currency]),
    ]);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <PageHead title="Quotes" sub={scope.name}>
        {canExport ? (
          <button type="button" className={btn} onClick={exportList}>
            <Icon name="download" size={14} /> Export
          </button>
        ) : null}
        {canQuote ? (
          <button type="button" className={btnPrimary} onClick={onNew}>
            New quote
          </button>
        ) : null}
      </PageHead>
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex h-[34px] w-[260px] items-center gap-2 rounded-[8px] border border-line bg-surface px-2.5 focus-within:border-primary">
          <Icon name="search" size={14} className="text-ink-3" />
          <input value={q} onChange={(e) => (setQ(e.target.value), setPage(1))} placeholder="Quote number or account" aria-label="Search quotes" className="bare-focus min-w-0 flex-1 bg-transparent text-[13px] text-ink outline-none placeholder:text-ink-3" />
        </label>
        <Select label="Status" value={status} onValueChange={(v) => (setStatus(v), setPage(1))} options={[{ value: '', label: 'Any status' }, ...STATUSES.map(([v, l]) => ({ value: v, label: l }))]} />
        <label className="flex items-center gap-2 text-[12.5px] font-semibold text-ink-2">
          <Checkbox checked={mine} onChange={(e) => (setMine(e.target.checked), setPage(1))} />
          Mine only
        </label>
      </div>
      <div className="flex min-h-0 flex-col overflow-hidden rounded-[12px] border border-line bg-surface">
        <div className="flex shrink-0 items-center gap-2.5 border-b border-line bg-info-soft px-3.5 py-2 text-[11px] font-bold tracking-[.4px] text-ink-3 uppercase dark:bg-well">
          <span className="w-[130px] shrink-0">Quote</span>
          <span className="min-w-0 flex-1">Account</span>
          <span className="w-[110px] shrink-0">Status</span>
          <span className="w-[110px] shrink-0">Issued</span>
          <span className="w-[110px] shrink-0">Valid until</span>
          <span className="w-[140px] shrink-0 text-right">Total</span>
        </div>
        <div className="min-h-0 overflow-y-auto scroll-thin">
          {list.isLoading ? <Spinner /> : list.error ? <ErrorNote error={list.error} onRetry={() => void list.refetch()} /> : null}
          {rows.map((r) => (
            <div key={r.id} data-quote={r.id} className="flex cursor-pointer items-center gap-2.5 border-b border-line/60 px-3.5 py-2 text-[12.5px] hover:bg-subtle" role="button" tabIndex={0} onKeyDown={clickOnKey} onClick={() => onOpen(r.id)}>
              <b className="w-[130px] shrink-0 truncate font-mono text-ink">{r.quote_no}</b>
              <span className="min-w-0 flex-1 truncate text-ink">{r.account ?? '—'}</span>
              <span className="w-[110px] shrink-0">
                <QuoteStatus status={r.status} expired={r.expired} />
              </span>
              <span className="w-[110px] shrink-0 text-ink-2">{r.issued_on ? dateLabel(r.issued_on) : '—'}</span>
              <span className="w-[110px] shrink-0 text-ink-2">{r.valid_until ? dateLabel(r.valid_until) : '—'}</span>
              <b className="w-[140px] shrink-0 text-right text-ink tabular-nums">{moneyFull(r.total, r.currency)}</b>
            </div>
          ))}
          {list.data && !rows.length ? <p className="m-0 px-3.5 py-8 text-center text-[12.5px] text-ink-3">No quotes match.</p> : null}
        </div>
        <StatusBar
          right={
            <span className="flex gap-2">
              {page > 1 ? (
                <button type="button" className={btnSmall} onClick={() => setPage(page - 1)}>
                  Newer
                </button>
              ) : null}
              {meta?.has_more ? (
                <button type="button" className={btnSmall} onClick={() => setPage(page + 1)}>
                  Older
                </button>
              ) : null}
            </span>
          }
        >
          {meta
            ? [`${meta.total} ${meta.total === 1 ? 'quote' : 'quotes'}`, ...STATUSES.filter(([s]) => countOf(s)).map(([s, l]) => `${countOf(s)} ${l.toLowerCase()}${summary[s]?.value ? ` (${money(summary[s]!.value)})` : ''}`)].join(' · ')
            : null}
        </StatusBar>
      </div>
    </div>
  );
}

/** The sums the server makes (Quotes::totals), for showing while typing. */
export function totalsOf(lines: QuoteLine[], discount: number) {
  const totals = lines.map((l) => Math.round(l.quantity * l.unit_price * (1 - l.discount_pct / 100) * 100) / 100);
  const subtotal = totals.reduce((a, b) => a + b, 0);
  const rawTax = lines.reduce((a, l, i) => a + (totals[i]! * l.tax_rate) / 100, 0);
  const disc = Math.min(Math.max(0, discount), subtotal);
  const tax = subtotal > 0 ? rawTax * (1 - disc / subtotal) : 0;
  return { lines: totals, subtotal, discount: disc, tax, total: subtotal - disc + tax };
}

const blank = (): QuoteLine => ({ product_id: null, description: '', quantity: 1, unit_price: 0, discount_pct: 0, tax_rate: 0 });

/** The line table's fixed number columns (W11): they keep their width at any window size, so figures line up. */
export const COLS = { qty: 72, rate: 120, disc: 72, tax: 72, amount: 136, remove: 28 } as const;

/** What a quote in this status offers, for somebody who may work on quotes. */
export function quoteActions(quote: Pick<Quote, 'status' | 'invoice_id' | 'can' | 'expired'> | null, canQuote: boolean, invoiceUnsupported = false) {
  const s = quote?.status;
  return {
    send: canQuote && s === 'draft',
    accept: canQuote && s === 'sent' && quote?.can?.accept !== false,
    decline: canQuote && s === 'sent' && quote?.can?.decline !== false,
    invoice: canQuote && s === 'accepted' && !quote?.invoice_id && quote?.can?.invoice !== false && !invoiceUnsupported,
    revise: canQuote && !!s && s !== 'draft',
    remove: canQuote && s === 'draft',
  };
}

function QuoteEditor({ id, forAccount, onBack, onChanged, onOpen, onOpenAccount, onOpenInvoice }: { id: number | null; forAccount: number | null; onBack: () => void; onChanged: () => void; onOpen: (id: number) => void; onOpenAccount: (id: number) => void; onOpenInvoice: (id: number) => void }) {
  const qc = useQueryClient();
  const scope = useCrmScope();
  const perms = useStore(app, (s) => s.bootstrap?.permissions);
  const canQuote = crmCan(perms, 'crm.quote');
  const q = useQuery({ queryKey: ['crm', 'quote', id], queryFn: ({ signal }) => apiGet<{ quote: Quote; defaults: { currency: string; valid_days: number } }>(`/api/crm/quotes/${id}`, undefined, signal), enabled: id !== null, staleTime: 0, refetchOnMount: 'always' });
  const accounts = useQuery({ queryKey: ['crm', 'accounts', 'picker', scope.orgId ?? 0], queryFn: ({ signal }) => apiGet<{ accounts: Account[] }>('/api/crm/accounts', { per_page: 200, ...scope.params }, signal), staleTime: 60_000 });
  const products = useQuery({ queryKey: ['crm', 'products', 'picker', scope.orgId ?? 0], queryFn: ({ signal }) => apiGet<{ products: Product[] }>('/api/crm/products', { per_page: 100, ...scope.params }, signal), staleTime: 60_000 });
  const quote = q.data?.quote ?? null;
  const [draft, setDraft] = useState<{ account_id: string; valid_until: string; lines: QuoteLine[]; discount: number; notes: string; terms: string } | null>(null);
  const [org, setOrg] = useState('');
  const [busy, setBusy] = useState(false);
  const [sending, setSending] = useState(false);
  const [declining, setDeclining] = useState(false);
  const [revising, setRevising] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [invoiceUnsupported, setInvoiceUnsupported] = useState(false);

  // The editor's copy: taken from the quote once it arrives (or blank for a new one), then the person's.
  const form =
    draft ??
    (id === null
      ? { account_id: forAccount ? String(forAccount) : '', valid_until: '', lines: [blank()], discount: 0, notes: '', terms: '' }
      : quote
        ? { account_id: quote.account_id ? String(quote.account_id) : '', valid_until: quote.valid_until ?? '', lines: quote.lines?.length ? quote.lines : [blank()], discount: quote.discount, notes: quote.notes ?? '', terms: quote.terms ?? '' }
        : null);
  const editable = canQuote && (id === null || quote?.status === 'draft');
  const act = quoteActions(quote, canQuote, invoiceUnsupported);
  const currency = quote?.currency ?? q.data?.defaults.currency ?? 'LKR';
  const sums = form ? totalsOf(form.lines, form.discount) : null;
  const change = (patch: Partial<NonNullable<typeof form>>) => form && setDraft({ ...form, ...patch });
  const setLine = (i: number, patch: Partial<QuoteLine>) => form && change({ lines: form.lines.map((l, j) => (j === i ? { ...l, ...patch } : l)) });
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['crm', 'quote', id] });
    onChanged();
  };
  const run = async (fn: () => Promise<unknown>, done: string) => {
    setBusy(true);
    try {
      await fn();
      toast('success', done);
      refresh();
      return true;
    } catch (e) {
      toast('error', errorMessage(e));
      return false;
    } finally {
      setBusy(false);
    }
  };
  /** Accept or decline (`quotes/{id}/accept|decline`); a server before them takes the status as an edit. */
  const decide = (to: 'accepted' | 'declined', reason?: string) =>
    run(async () => {
      try {
        await apiPost(`/api/crm/quotes/${id}/${to === 'accepted' ? 'accept' : 'decline'}`, to === 'declined' ? { reason: reason || undefined } : undefined);
      } catch (e) {
        if (!isMissing(e)) throw e;
        await apiPut(`/api/crm/quotes/${id}`, { status: to });
      }
    }, to === 'accepted' ? 'Marked accepted.' : 'Marked declined.');
  const invoice = async () => {
    setBusy(true);
    try {
      const r = await apiPost<{ invoice_id?: number; invoice_no?: string; invoice?: { id: number; number?: string; invoice_no?: string } }>(`/api/crm/quotes/${id}/invoice`);
      const no = r.invoice_no ?? r.invoice?.invoice_no ?? r.invoice?.number;
      toast('success', no ? `Invoice ${no} created from this quote.` : 'Invoice created from this quote.');
      refresh();
    } catch (e) {
      if (isMissing(e)) {
        setInvoiceUnsupported(true);
        toast('info', 'Billing on this server cannot make an invoice from a quote.');
      } else toast('error', errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    if (!form) return;
    if (id === null && scope.needsOrg && !org) return void toast('error', 'Choose the company it belongs to.');
    const lines = form.lines.filter((l) => l.description.trim() !== '').map((l) => ({ product_id: l.product_id, description: l.description.trim(), quantity: l.quantity, unit_price: l.unit_price, discount_pct: l.discount_pct, tax_rate: l.tax_rate }));
    const body = { account_id: form.account_id ? Number(form.account_id) : null, valid_until: form.valid_until || undefined, notes: form.notes, terms: form.terms, lines, discount: form.discount };
    setBusy(true);
    try {
      if (id === null) {
        const r = await apiPost<{ quote: Quote }>('/api/crm/quotes', { ...body, org_id: orgIdFor(org, scope) });
        toast('success', `Quote ${r.quote.quote_no} created.`);
        onChanged();
        onOpen(r.quote.id);
      } else {
        await apiPut(`/api/crm/quotes/${id}`, body);
        toast('success', 'Saved.');
        setDraft(null);
        refresh();
      }
    } catch (e) {
      toast('error', errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const pdf = async () => {
    if (!id) return;
    setBusy(true);
    try {
      const r = await apiPost<{ file_id: number; name: string }>(`/api/crm/quotes/${id}/pdf`);
      await call('transfers:download', { fileId: String(r.file_id), name: r.name, open: true });
      toast('success', `${r.name} saved to your downloads, and kept in your Drive.`);
    } catch (e) {
      toast('error', errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const facts = quote ? [quote.contact, quote.issued_on ? `issued ${dateLabel(quote.issued_on)}` : null, quote.valid_until ? `valid until ${dateLabel(quote.valid_until)}` : null, quote.sent_at ? `sent ${dateLabel(quote.sent_at)}` : null].filter(Boolean) : [];

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <button type="button" className="flex items-center gap-1 self-start text-[12.5px] font-semibold text-primary hover:underline" onClick={onBack}>
        <Icon name="back" size={13} /> Quotes
      </button>
      <div className="flex flex-wrap items-start gap-2">
        <div className="flex min-w-0 flex-1 flex-col">
          <h1 className="m-0 flex items-center gap-2 text-[20px] font-bold text-ink">
            <span className="font-mono">{id === null ? 'New quote' : (quote?.quote_no ?? 'Quote')}</span>
            {quote ? <QuoteStatus status={quote.status} expired={quote.expired} /> : null}
          </h1>
          <span className="text-[12.5px] text-ink-3">
            {!quote ? 'Lines from the price list or typed; the server works out the totals again on save.' : null}
            {quote?.account_id ? (
              <button type="button" className="font-semibold text-primary hover:underline" onClick={() => onOpenAccount(quote.account_id!)}>
                {quote.account ?? 'Account'}
              </button>
            ) : quote ? (
              'No account'
            ) : null}
            {facts.map((f) => ` · ${f}`).join('')}
          </span>
        </div>
        {id !== null ? (
          <>
            <button type="button" className={btn} disabled={busy} onClick={() => void pdf()}>
              <Icon name="download" size={14} /> Open PDF
            </button>
            {act.send ? (
              <button type="button" className={btn} disabled={busy} onClick={() => setSending(true)}>
                <Icon name="send" size={14} /> Mark as sent
              </button>
            ) : null}
            {act.accept ? (
              <button type="button" className={btn} disabled={busy} onClick={() => void decide('accepted')}>
                <Icon name="check" size={14} /> Mark accepted
              </button>
            ) : null}
            {act.decline ? (
              <button type="button" className={btn} disabled={busy} onClick={() => setDeclining(true)}>
                <Icon name="x" size={14} /> Declined
              </button>
            ) : null}
            {act.invoice ? (
              <button type="button" className={btnPrimary} disabled={busy} onClick={() => void invoice()}>
                <Icon name="receipt" size={14} /> Convert to invoice
              </button>
            ) : null}
            {quote?.invoice_id ? (
              <button type="button" className={btn} onClick={() => onOpenInvoice(quote.invoice_id!)}>
                <Icon name="receipt" size={14} /> {quote.invoice_no ? `Invoice ${quote.invoice_no}` : 'Open invoice'}
              </button>
            ) : null}
            {act.revise ? (
              <button type="button" className={act.invoice ? btn : btnPrimary} disabled={busy} onClick={() => setRevising(true)}>
                <Icon name="repeat" size={14} /> Revise
              </button>
            ) : null}
            {act.remove ? (
              <button type="button" className={cx(btn, 'text-danger')} disabled={busy} onClick={() => setDeleting(true)}>
                Delete draft
              </button>
            ) : null}
          </>
        ) : null}
      </div>

      {id !== null && q.isLoading ? <Spinner /> : q.error ? <ErrorNote error={q.error} onRetry={() => void q.refetch()} /> : null}
      {form && sums ? (
        <>
          {quote && quote.status !== 'draft' ? (
            <div role="note" className="flex items-start gap-2 rounded-[8px] border border-primary/30 bg-selection px-3 py-2.5 text-[12.5px] text-ink">
              <Icon name="lock" size={15} className="mt-0.5 shrink-0 text-primary" />
              <span>
                This quote has been {quote.status} — the figures are fixed because the customer is holding this document. Use <b>Revise</b> to issue a replacement that says which quote it supersedes.
                {quote.status === 'declined' && quote.decline_reason ? ` Declined because: ${quote.decline_reason}` : ''}
              </span>
            </div>
          ) : null}

          {editable ? (
            <div className="grid grid-cols-2 gap-3">
              {id === null ? <CompanyField scope={scope} value={org} onChange={setOrg} what="quote" /> : null}
              <Field label="Account">
                <Select label="Account" value={form.account_id} onValueChange={(v) => change({ account_id: v })} searchable options={[{ value: '', label: 'No account' }, ...(accounts.data?.accounts ?? []).map((a) => ({ value: String(a.id), label: a.name })), ...(form.account_id && !accounts.data?.accounts.some((a) => String(a.id) === form.account_id) ? [{ value: form.account_id, label: quote?.account ?? `Account #${form.account_id}` }] : [])]} />
              </Field>
              <Field label="Valid until" hint={id === null ? 'Blank: the usual number of days from today' : undefined}>
                <input type="date" value={form.valid_until} onChange={(e) => change({ valid_until: e.target.value })} aria-label="Valid until" className={input} />
              </Field>
            </div>
          ) : null}

          <div role="table" aria-label="Lines" className="overflow-x-auto rounded-[10px] border border-line bg-surface">
            <div role="row" className="flex min-w-[640px] items-center gap-2 border-b border-line bg-info-soft px-3 py-2 text-[11px] font-bold tracking-[.4px] text-ink-3 uppercase dark:bg-well">
              <span role="columnheader" className="min-w-[180px] flex-1">
                Description
              </span>
              <NumHead w={COLS.qty}>Qty</NumHead>
              <NumHead w={COLS.rate}>Rate</NumHead>
              <NumHead w={COLS.disc}>Disc %</NumHead>
              <NumHead w={COLS.tax}>Tax %</NumHead>
              <NumHead w={COLS.amount}>Amount</NumHead>
              {editable ? <span className="shrink-0" style={{ width: COLS.remove }} /> : null}
            </div>
            {form.lines.map((l, i) => (
              <div role="row" key={i} className="flex min-w-[640px] items-start gap-2 border-b border-line/60 px-3 py-1.5 text-[13px] last:border-b-0">
                {editable ? (
                  <>
                    <span role="cell" className="flex min-w-[180px] flex-1 flex-col gap-1">
                      <Select<string>
                        label={`Line ${i + 1} from the price list`}
                        placeholder="From the price list…"
                        value={l.product_id ? String(l.product_id) : null}
                        onValueChange={(v) => {
                          const p = products.data?.products.find((x) => String(x.id) === v);
                          if (p) setLine(i, { product_id: p.id, description: p.name + (p.description ? ` — ${p.description}` : ''), unit_price: p.unit_price, tax_rate: p.tax_rate });
                        }}
                        options={(products.data?.products ?? []).filter((p) => p.active).map((p) => ({ value: String(p.id), label: `${p.code ? `${p.code} · ` : ''}${p.name} · ${moneyFull(p.unit_price, p.currency)}` }))}
                      />
                      <input value={l.description} onChange={(e) => setLine(i, { description: e.target.value })} placeholder="Or describe it" aria-label={`Line ${i + 1} description`} className={input} />
                    </span>
                    <Num value={l.quantity} onChange={(v) => setLine(i, { quantity: v })} label={`Line ${i + 1} quantity`} w={COLS.qty} />
                    <Num value={l.unit_price} onChange={(v) => setLine(i, { unit_price: v })} label={`Line ${i + 1} rate`} w={COLS.rate} />
                    <Num value={l.discount_pct} onChange={(v) => setLine(i, { discount_pct: Math.min(100, v) })} label={`Line ${i + 1} discount`} w={COLS.disc} />
                    <Num value={l.tax_rate} onChange={(v) => setLine(i, { tax_rate: Math.min(100, v) })} label={`Line ${i + 1} tax`} w={COLS.tax} />
                  </>
                ) : (
                  <>
                    <span role="cell" className="min-w-[180px] flex-1 py-1 text-ink">
                      {l.description}
                    </span>
                    <NumCell w={COLS.qty}>{l.quantity}</NumCell>
                    <NumCell w={COLS.rate}>{moneyFull(l.unit_price)}</NumCell>
                    <NumCell w={COLS.disc}>{l.discount_pct || 0}</NumCell>
                    <NumCell w={COLS.tax}>{l.tax_rate || 0}</NumCell>
                  </>
                )}
                <NumCell w={COLS.amount} strong>
                  {moneyFull(editable ? sums.lines[i] : (l.line_total ?? sums.lines[i]))}
                </NumCell>
                {editable ? (
                  <button type="button" aria-label={`Remove line ${i + 1}`} onClick={() => change({ lines: form.lines.length > 1 ? form.lines.filter((_, j) => j !== i) : [blank()] })} className="mt-1.5 flex h-6 shrink-0 items-center justify-center rounded-[6px] text-ink-3 hover:bg-subtle hover:text-danger" style={{ width: COLS.remove }}>
                    <Icon name="x" size={13} />
                  </button>
                ) : null}
              </div>
            ))}
          </div>
          {editable ? (
            <button type="button" className={cx(btnSmall, 'self-start')} onClick={() => change({ lines: [...form.lines, blank()] })}>
              <Icon name="plus" size={13} /> Add line
            </button>
          ) : null}

          <div className="flex flex-wrap items-start gap-3.5">
            <div className="flex min-w-[260px] flex-1 flex-col gap-2 rounded-[10px] border border-line bg-surface p-3 text-[13px]">
              <Field label="Notes">{editable ? <textarea value={form.notes} onChange={(e) => change({ notes: e.target.value })} rows={3} aria-label="Notes" className={cx(input, 'h-auto py-2')} /> : <p className="m-0 whitespace-pre-wrap text-ink-2">{quote?.notes || '—'}</p>}</Field>
              <Field label="Terms">{editable ? <textarea value={form.terms} onChange={(e) => change({ terms: e.target.value })} rows={3} aria-label="Terms" className={cx(input, 'h-auto py-2')} /> : <p className="m-0 whitespace-pre-wrap text-ink-2">{quote?.terms || '—'}</p>}</Field>
            </div>
            <div aria-label="Totals" className="flex w-[300px] shrink-0 flex-col gap-1 rounded-[10px] border border-line bg-surface p-3 text-[13px]">
              <Row label="Subtotal" value={moneyFull(editable ? sums.subtotal : (quote?.subtotal ?? sums.subtotal))} />
              <div className="flex items-center justify-between gap-2 py-1">
                <span className="text-ink-2">Discount</span>
                {editable ? <Num value={form.discount} onChange={(v) => change({ discount: v })} label="Discount amount" w={COLS.rate} /> : <span className="tabular-nums">{moneyFull(quote?.discount ?? 0)}</span>}
              </div>
              <Row label="Tax" value={moneyFull(editable ? sums.tax : (quote?.tax ?? sums.tax))} />
              <div className="mt-1 flex items-center justify-between border-t border-line pt-2 text-[17px] font-bold text-ink">
                <span>Total {currency}</span>
                <span className="tabular-nums">{moneyFull(editable ? sums.total : (quote?.total ?? sums.total))}</span>
              </div>
            </div>
          </div>

          {editable ? (
            <div className="flex justify-end gap-2 border-t border-line pt-3">
              <button type="button" className={btn} onClick={onBack}>
                Close
              </button>
              <button type="button" className={btnPrimary} disabled={busy || (id === null && scope.needsOrg && !org)} onClick={() => void save()}>
                {id === null ? 'Create quote' : 'Save'}
              </button>
            </div>
          ) : null}
        </>
      ) : null}

      {sending && id ? <MarkSent onClose={() => setSending(false)} onSend={async (how) => (await run(() => apiPost(`/api/crm/quotes/${id}/sent`, { how: how || undefined }), 'Marked as sent.')) && setSending(false)} /> : null}
      {declining && id ? <Decline onClose={() => setDeclining(false)} onSave={async (why) => (await decide('declined', why)) && setDeclining(false)} /> : null}
      {revising && id ? (
        <Sheet
          title="Create a revision?"
          width={420}
          onClose={() => setRevising(false)}
          footer={
            <>
              <button type="button" className={btn} onClick={() => setRevising(false)}>
                Cancel
              </button>
              <button
                type="button"
                className={btnPrimary}
                disabled={busy}
                onClick={() =>
                  void apiPost<{ quote: Quote }>(`/api/crm/quotes/${id}/revise`)
                    .then((r) => (toast('success', `Revision ${r.quote.quote_no} created.`), setRevising(false), onChanged(), onOpen(r.quote.id)))
                    .catch((e) => toast('error', errorMessage(e)))
                }
              >
                Create revision
              </button>
            </>
          }
        >
          <p className="m-0 text-[13px] text-ink-2">A new draft with the next number copies these lines, discount and terms, and says which quote it replaces. This one is marked expired{quote?.status === 'accepted' ? ', even though it was accepted' : ''}.</p>
        </Sheet>
      ) : null}
      {deleting && id ? (
        <Sheet
          title="Delete this draft?"
          width={400}
          onClose={() => setDeleting(false)}
          footer={
            <>
              <button type="button" className={btn} onClick={() => setDeleting(false)}>
                Cancel
              </button>
              <button type="button" className={cx(btnPrimary, 'bg-danger hover:bg-danger')} onClick={() => void apiDelete(`/api/crm/quotes/${id}`).then(() => (toast('success', 'Draft deleted.'), onChanged(), onBack())).catch((e) => toast('error', errorMessage(e)))}>
                Delete
              </button>
            </>
          }
        >
          <p className="m-0 text-[13px] text-ink-2">Its number is not used again.</p>
        </Sheet>
      ) : null}
    </div>
  );
}

/** A number in the line table: an input of a fixed width, right-aligned, tabular figures. */
function Num({ value, onChange, label, w }: { value: number; onChange: (v: number) => void; label: string; w: number }) {
  return <input type="number" min={0} step="any" value={Number.isFinite(value) ? value : 0} onChange={(e) => onChange(Math.max(0, Number(e.target.value) || 0))} aria-label={label} className={cx(input, 'shrink-0 px-2 text-right tabular-nums')} style={{ width: w }} />;
}
function NumHead({ w, children }: { w: number; children: string }) {
  return (
    <span role="columnheader" className="shrink-0 text-right" style={{ width: w }}>
      {children}
    </span>
  );
}

function NumCell({ w, children, strong }: { w: number; children: ReactNode; strong?: boolean }) {
  return (
    <span role="cell" className={cx('shrink-0 py-2 text-right tabular-nums', strong ? 'font-bold text-ink' : 'text-ink-2')} style={{ width: w }}>
      {children}
    </span>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between py-1">
      <span className="text-ink-2">{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  );
}

function Decline({ onClose, onSave }: { onClose: () => void; onSave: (why: string) => void }) {
  const [why, setWhy] = useState('');
  return (
    <Sheet
      title="The customer declined"
      width={420}
      onClose={onClose}
      footer={
        <>
          <button type="button" className={btn} onClick={onClose}>
            Cancel
          </button>
          <button type="button" className={btnPrimary} onClick={() => onSave(why.trim())}>
            Mark declined
          </button>
        </>
      }
    >
      <Field label="Why" hint="Optional — kept on the quote and the customer’s timeline">
        <input autoFocus value={why} maxLength={255} onChange={(e) => setWhy(e.target.value)} placeholder="Went with a cheaper local supplier" aria-label="Why it was declined" className={input} />
      </Field>
    </Sheet>
  );
}

function MarkSent({ onClose, onSend }: { onClose: () => void; onSend: (how: string) => void }) {
  const [how, setHow] = useState('');
  return (
    <Sheet
      title="Mark as sent"
      width={420}
      onClose={onClose}
      footer={
        <>
          <button type="button" className={btn} onClick={onClose}>
            Cancel
          </button>
          <button type="button" className={btnPrimary} onClick={() => onSend(how.trim())}>
            Mark as sent
          </button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <p className="m-0 text-[13px] text-ink-2">Nothing is emailed from here — this records that the customer has it, and fixes its figures.</p>
        <Field label="How it went" hint="Optional — emailed, handed over, WhatsApp…">
          <input autoFocus value={how} maxLength={60} onChange={(e) => setHow(e.target.value)} aria-label="How it was sent" className={input} />
        </Field>
      </div>
    </Sheet>
  );
}
