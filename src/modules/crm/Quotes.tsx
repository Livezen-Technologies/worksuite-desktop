import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { apiDelete, apiGet, apiPost, apiPut } from '../../core/api';
import { app } from '../../core/app-state';
import { call, errorMessage } from '../../core/bridge';
import { useStore } from '../../core/store';
import { dateLabel } from '../../core/time';
import { toast } from '../../core/toasts';
import { Icon } from '../../components/Icon';
import { Select } from '../../components/Select';
import { ErrorNote, Spinner, cx } from '../../components/ui';
import { btn, btnPrimary, btnSmall, Caps, Field, input, PageHead, Sheet, SidePanel } from '../hr/parts';
import type { Account, Product, Quote, QuoteLine } from './api';
import { crmCan, money, moneyFull } from './parts';

/**
 * Quotes (CrmQuotes, CrmQuoteSheet): the list with what is out in each
 * status; a draft in the editor — lines from the price list or typed, a
 * discount, notes and terms; PDF, Mark as sent, Accept or Decline; and a
 * sent quote read-only, changed only by a revision (a new draft that
 * replaces it). Totals are the server's: this screen shows the same sums
 * while typing, and the server works them out again on save.
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
  accepted: 'bg-[#E4F4EA] text-[#145C39] dark:bg-success-bg dark:text-success',
  declined: 'bg-[#FCE9E4] text-[#8C2A14] dark:bg-danger-bg dark:text-danger',
  expired: 'bg-[#FFF4E0] text-[#9A4A06] dark:bg-warning-bg dark:text-warning',
};

export function QuoteStatus({ status, expired }: { status: string; expired?: boolean }) {
  const s = expired && status === 'sent' ? 'expired' : status;
  return <span className={cx('rounded-full px-2 py-0.5 text-[11.5px] font-bold capitalize', TONE[s] ?? 'bg-subtle text-ink-2')}>{expired && status === 'sent' ? 'Past its date' : s}</span>;
}

interface QuoteList {
  quotes: Quote[];
  total: number;
  page: number;
  summary: Record<string, { count: number; value: number }>;
}

export default function Quotes({ openId, creating, onOpen, onNew, onCloseNew }: { openId: number | null; creating: boolean; onOpen: (id: number | null) => void; onNew: () => void; onCloseNew: () => void }) {
  const qc = useQueryClient();
  const perms = useStore(app, (s) => s.bootstrap?.permissions);
  const canQuote = crmCan(perms, 'crm.quote');
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [mine, setMine] = useState(false);
  const [page, setPage] = useState(1);
  const params = { q: q.trim() || undefined, status: status || undefined, mine: mine ? 1 : undefined, page, per_page: 50 };
  const list = useQuery({ queryKey: ['crm', 'quotes', params], queryFn: ({ signal }) => apiGet<QuoteList>('/api/crm/quotes', params, signal) });
  const refresh = () => void qc.invalidateQueries({ queryKey: ['crm'] });
  const rows = list.data?.quotes ?? [];
  const summary = list.data?.summary ?? {};

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <PageHead
        title="Quotes"
        sub={
          <span className="flex flex-wrap gap-x-4">
            {STATUSES.filter(([s]) => summary[s]?.count).map(([s, l]) => (
              <span key={s}>
                {l.toLowerCase()} <b className="text-ink">{summary[s]!.count}</b> · {money(summary[s]!.value)}
              </span>
            ))}
          </span>
        }
      >
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
          <input type="checkbox" checked={mine} onChange={(e) => (setMine(e.target.checked), setPage(1))} className="accent-primary" />
          Mine only
        </label>
      </div>
      <div className="flex min-h-0 flex-col overflow-hidden rounded-[12px] border border-line bg-surface">
        <div className="flex shrink-0 items-center gap-2.5 border-b border-line bg-[#F7F8FB] px-3.5 py-2 text-[11px] font-bold tracking-[.4px] text-ink-3 uppercase dark:bg-well">
          <span className="w-[130px] shrink-0">Quote</span>
          <span className="min-w-0 flex-1">Account</span>
          <span className="w-[110px] shrink-0">Status</span>
          <span className="w-[110px] shrink-0">Issued</span>
          <span className="w-[110px] shrink-0">Valid until</span>
          <span className="w-[130px] shrink-0 text-right">Total</span>
        </div>
        <div className="min-h-0 overflow-y-auto scroll-thin">
          {list.isLoading ? <Spinner /> : list.error ? <ErrorNote error={list.error} onRetry={() => void list.refetch()} /> : null}
          {rows.map((r) => (
            <div key={r.id} data-quote={r.id} className={cx('flex cursor-pointer items-center gap-2.5 border-b border-line/60 px-3.5 py-2 text-[12.5px] hover:bg-subtle', openId === r.id && 'bg-selection')} onClick={() => onOpen(r.id)}>
              <b className="w-[130px] shrink-0 truncate text-ink">{r.quote_no}</b>
              <span className="min-w-0 flex-1 truncate text-ink">{r.account ?? '—'}</span>
              <span className="w-[110px] shrink-0">
                <QuoteStatus status={r.status} expired={r.expired} />
              </span>
              <span className="w-[110px] shrink-0 text-ink-2">{r.issued_on ? dateLabel(r.issued_on) : '—'}</span>
              <span className="w-[110px] shrink-0 text-ink-2">{r.valid_until ? dateLabel(r.valid_until) : '—'}</span>
              <b className="w-[130px] shrink-0 text-right text-ink tabular-nums">{moneyFull(r.total, r.currency)}</b>
            </div>
          ))}
          {list.data && !rows.length ? <p className="m-0 px-3.5 py-8 text-center text-[12.5px] text-ink-3">No quotes match.</p> : null}
          <div className="flex items-center gap-3 px-3.5 py-2.5 text-[12px] text-ink-3">
            {list.data ? `${list.data.total} ${list.data.total === 1 ? 'quote' : 'quotes'}` : null}
            {page > 1 ? (
              <button type="button" className={btnSmall} onClick={() => setPage(page - 1)}>
                Newer
              </button>
            ) : null}
            {list.data && page * 50 < list.data.total ? (
              <button type="button" className={btnSmall} onClick={() => setPage(page + 1)}>
                Older
              </button>
            ) : null}
          </div>
        </div>
      </div>
      {openId ? <QuoteDrawer key={openId} id={openId} onClose={() => onOpen(null)} onChanged={refresh} onOpen={onOpen} /> : null}
      {creating && canQuote ? <QuoteDrawer id={null} onClose={onCloseNew} onChanged={refresh} onOpen={(id) => (onCloseNew(), onOpen(id))} /> : null}
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

function QuoteDrawer({ id, onClose, onChanged, onOpen }: { id: number | null; onClose: () => void; onChanged: () => void; onOpen: (id: number) => void }) {
  const qc = useQueryClient();
  const perms = useStore(app, (s) => s.bootstrap?.permissions);
  const canQuote = crmCan(perms, 'crm.quote');
  const q = useQuery({ queryKey: ['crm', 'quote', id], queryFn: ({ signal }) => apiGet<{ quote: Quote; defaults: { currency: string; valid_days: number } }>(`/api/crm/quotes/${id}`, undefined, signal), enabled: id !== null, staleTime: 0, refetchOnMount: 'always' });
  const accounts = useQuery({ queryKey: ['crm', 'accounts', 'picker'], queryFn: ({ signal }) => apiGet<{ accounts: Account[] }>('/api/crm/accounts', { per_page: 200 }, signal), staleTime: 60_000 });
  const products = useQuery({ queryKey: ['crm', 'products', 'picker'], queryFn: ({ signal }) => apiGet<{ products: Product[] }>('/api/crm/products', { per_page: 100 }, signal), staleTime: 60_000 });
  const quote = q.data?.quote ?? null;
  const [draft, setDraft] = useState<{ account_id: string; valid_until: string; lines: QuoteLine[]; discount: number; notes: string; terms: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [sending, setSending] = useState(false);
  const [revising, setRevising] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // The editor's copy: taken from the quote once it arrives (or blank for a new one), then the person's.
  const form =
    draft ??
    (id === null
      ? { account_id: '', valid_until: '', lines: [blank()], discount: 0, notes: '', terms: '' }
      : quote
        ? { account_id: quote.account_id ? String(quote.account_id) : '', valid_until: quote.valid_until ?? '', lines: quote.lines?.length ? quote.lines : [blank()], discount: quote.discount, notes: quote.notes ?? '', terms: quote.terms ?? '' }
        : null);
  const editable = canQuote && (id === null || quote?.status === 'draft');
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

  const save = async () => {
    if (!form) return;
    const lines = form.lines.filter((l) => l.description.trim() !== '').map((l) => ({ product_id: l.product_id, description: l.description.trim(), quantity: l.quantity, unit_price: l.unit_price, discount_pct: l.discount_pct, tax_rate: l.tax_rate }));
    const body = { account_id: form.account_id ? Number(form.account_id) : null, valid_until: form.valid_until || undefined, notes: form.notes, terms: form.terms, lines, discount: form.discount };
    setBusy(true);
    try {
      if (id === null) {
        const r = await apiPost<{ quote: Quote }>('/api/crm/quotes', body);
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
      await call('transfers:download', { fileId: String(r.file_id), name: r.name });
      toast('success', `${r.name} saved to your downloads, and kept in your Drive.`);
    } catch (e) {
      toast('error', errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const head = (
    <span className="flex min-w-0 flex-col gap-1">
      <b className="truncate text-[16px] text-ink">{id === null ? 'New quote' : (quote?.quote_no ?? 'Quote')}</b>
      {quote ? (
        <span className="flex items-center gap-2 text-[12px] text-ink-3">
          <QuoteStatus status={quote.status} expired={quote.expired} />
          {quote.account ?? 'No account'}
          {quote.sent_at ? ` · sent ${dateLabel(quote.sent_at)}` : ''}
        </span>
      ) : null}
    </span>
  );

  return (
    <SidePanel label="Quote" width={760} onClose={onClose} head={head}>
      {id !== null && q.isLoading ? <Spinner /> : q.error ? <ErrorNote error={q.error} onRetry={() => void q.refetch()} /> : null}
      {form && sums ? (
        <div className="flex flex-col gap-4">
          {quote && quote.status !== 'draft' ? (
            <div className="flex items-start gap-2 rounded-[10px] border border-[#F1D9B5] bg-[#FFF9EC] px-3 py-2.5 text-[12.5px] text-[#7A3B05] dark:border-warning/30 dark:bg-warning-bg dark:text-warning">
              <Icon name="lock" size={15} className="mt-0.5 shrink-0" />
              <span>This quote has been {quote.status}. The figures are fixed, so what the customer saw stays true. Use Revise to make a new version with changes.</span>
            </div>
          ) : null}
          {id !== null ? (
            <div className="flex flex-wrap gap-2">
              <button type="button" className={btn} disabled={busy} onClick={() => void pdf()}>
                <Icon name="download" size={14} />
                PDF
              </button>
              {canQuote && quote?.status === 'draft' ? (
                <button type="button" className={btn} disabled={busy} onClick={() => setSending(true)}>
                  <Icon name="send" size={14} />
                  Mark as sent
                </button>
              ) : null}
              {canQuote && quote?.status === 'sent' ? (
                <>
                  <button type="button" className={btn} disabled={busy} onClick={() => void run(() => apiPut(`/api/crm/quotes/${id}`, { status: 'accepted' }), 'Marked accepted.')}>
                    <Icon name="check" size={14} />
                    Accepted
                  </button>
                  <button type="button" className={btn} disabled={busy} onClick={() => void run(() => apiPut(`/api/crm/quotes/${id}`, { status: 'declined' }), 'Marked declined.')}>
                    <Icon name="x" size={14} />
                    Declined
                  </button>
                </>
              ) : null}
              {canQuote && quote && quote.status !== 'draft' ? (
                <button type="button" className={btn} disabled={busy} onClick={() => setRevising(true)}>
                  <Icon name="repeat" size={14} />
                  Revise
                </button>
              ) : null}
              <span className="flex-1" />
              {canQuote && quote?.status === 'draft' ? (
                <button type="button" className={cx(btn, 'text-danger')} disabled={busy} onClick={() => setDeleting(true)}>
                  Delete draft
                </button>
              ) : null}
            </div>
          ) : null}

          <div className="grid grid-cols-2 gap-3">
            <Field label="Account">
              {editable ? (
                <Select label="Account" value={form.account_id} onValueChange={(v) => change({ account_id: v })} options={[{ value: '', label: 'No account' }, ...(accounts.data?.accounts ?? []).map((a) => ({ value: String(a.id), label: a.name }))]} />
              ) : (
                <span className="text-[13px] text-ink">{quote?.account ?? '—'}</span>
              )}
            </Field>
            <Field label="Valid until" hint={id === null ? 'Blank: the usual number of days from today' : undefined}>
              {editable ? <input type="date" value={form.valid_until} onChange={(e) => change({ valid_until: e.target.value })} aria-label="Valid until" className={input} /> : <span className="text-[13px] text-ink">{quote?.valid_until ? dateLabel(quote.valid_until) : '—'}</span>}
            </Field>
          </div>

          <section className="flex flex-col gap-1.5">
            <Caps>Lines</Caps>
            <div className="overflow-hidden rounded-[10px] border border-line">
              <div className="flex items-center gap-2 border-b border-line bg-[#F7F8FB] px-2.5 py-1.5 text-[11px] font-bold tracking-[.4px] text-ink-3 uppercase dark:bg-well">
                <span className="min-w-0 flex-1">Item</span>
                <span className="w-[64px] shrink-0 text-right">Qty</span>
                <span className="w-[100px] shrink-0 text-right">Rate</span>
                <span className="w-[62px] shrink-0 text-right">Disc %</span>
                <span className="w-[58px] shrink-0 text-right">Tax %</span>
                <span className="w-[110px] shrink-0 text-right">Amount</span>
                {editable ? <span className="w-6 shrink-0" /> : null}
              </div>
              {form.lines.map((l, i) => (
                <div key={i} className="flex items-start gap-2 border-b border-line/60 px-2.5 py-1.5 text-[12.5px] last:border-b-0">
                  {editable ? (
                    <>
                      <span className="flex min-w-0 flex-1 flex-col gap-1">
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
                      <Num value={l.quantity} onChange={(v) => setLine(i, { quantity: v })} label={`Line ${i + 1} quantity`} w={64} />
                      <Num value={l.unit_price} onChange={(v) => setLine(i, { unit_price: v })} label={`Line ${i + 1} rate`} w={100} />
                      <Num value={l.discount_pct} onChange={(v) => setLine(i, { discount_pct: Math.min(100, v) })} label={`Line ${i + 1} discount`} w={62} />
                      <Num value={l.tax_rate} onChange={(v) => setLine(i, { tax_rate: Math.min(100, v) })} label={`Line ${i + 1} tax`} w={58} />
                    </>
                  ) : (
                    <>
                      <span className="min-w-0 flex-1 py-1 text-ink">{l.description}</span>
                      <span className="w-[64px] shrink-0 py-1 text-right tabular-nums">{l.quantity}</span>
                      <span className="w-[100px] shrink-0 py-1 text-right tabular-nums">{moneyFull(l.unit_price)}</span>
                      <span className="w-[62px] shrink-0 py-1 text-right tabular-nums">{l.discount_pct || '—'}</span>
                      <span className="w-[58px] shrink-0 py-1 text-right tabular-nums">{l.tax_rate || '—'}</span>
                    </>
                  )}
                  <b className="w-[110px] shrink-0 py-2 text-right text-ink tabular-nums">{moneyFull(editable ? sums.lines[i] : (l.line_total ?? sums.lines[i]))}</b>
                  {editable ? (
                    <button type="button" aria-label={`Remove line ${i + 1}`} onClick={() => change({ lines: form.lines.length > 1 ? form.lines.filter((_, j) => j !== i) : [blank()] })} className="mt-1.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-[6px] text-ink-3 hover:bg-subtle hover:text-danger">
                      <Icon name="x" size={13} />
                    </button>
                  ) : null}
                </div>
              ))}
            </div>
            {editable ? (
              <button type="button" className={cx(btnSmall, 'self-start')} onClick={() => change({ lines: [...form.lines, blank()] })}>
                Add line
              </button>
            ) : null}
          </section>

          <div className="ml-auto flex w-[300px] flex-col gap-1 text-[13px]">
            <Row label="Subtotal" value={moneyFull(editable ? sums.subtotal : (quote?.subtotal ?? sums.subtotal), currency)} />
            <div className="flex items-center justify-between gap-2">
              <span className="text-ink-2">Discount</span>
              {editable ? <Num value={form.discount} onChange={(v) => change({ discount: v })} label="Discount amount" w={120} /> : <span className="tabular-nums">{moneyFull(quote?.discount ?? 0, currency)}</span>}
            </div>
            <Row label="Tax" value={moneyFull(editable ? sums.tax : (quote?.tax ?? sums.tax), currency)} />
            <div className="mt-1 flex items-center justify-between border-t border-line pt-1.5">
              <b className="text-ink">Total</b>
              <b className="text-[15px] text-ink tabular-nums">{moneyFull(editable ? sums.total : (quote?.total ?? sums.total), currency)}</b>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Notes">
              {editable ? <textarea value={form.notes} onChange={(e) => change({ notes: e.target.value })} rows={3} aria-label="Notes" className={cx(input, 'h-auto py-2')} /> : <p className="m-0 text-[13px] whitespace-pre-wrap text-ink-2">{quote?.notes || '—'}</p>}
            </Field>
            <Field label="Terms">
              {editable ? <textarea value={form.terms} onChange={(e) => change({ terms: e.target.value })} rows={3} aria-label="Terms" className={cx(input, 'h-auto py-2')} /> : <p className="m-0 text-[13px] whitespace-pre-wrap text-ink-2">{quote?.terms || '—'}</p>}
            </Field>
          </div>

          {editable ? (
            <div className="flex justify-end gap-2 border-t border-line pt-3">
              <button type="button" className={btn} onClick={onClose}>
                Close
              </button>
              <button type="button" className={btnPrimary} disabled={busy} onClick={() => void save()}>
                {id === null ? 'Create quote' : 'Save'}
              </button>
            </div>
          ) : null}
        </div>
      ) : null}

      {sending && id ? <MarkSent onClose={() => setSending(false)} onSend={async (how) => (await run(() => apiPost(`/api/crm/quotes/${id}/sent`, { how: how || undefined }), 'Marked as sent.')) && setSending(false)} /> : null}
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
              <button type="button" className={cx(btnPrimary, 'bg-danger hover:bg-danger')} onClick={() => void apiDelete(`/api/crm/quotes/${id}`).then(() => (toast('success', 'Draft deleted.'), onChanged(), onClose())).catch((e) => toast('error', errorMessage(e)))}>
                Delete
              </button>
            </>
          }
        >
          <p className="m-0 text-[13px] text-ink-2">Its number is not used again.</p>
        </Sheet>
      ) : null}
    </SidePanel>
  );
}

function Num({ value, onChange, label, w }: { value: number; onChange: (v: number) => void; label: string; w: number }) {
  return <input type="number" min={0} step="any" value={Number.isFinite(value) ? value : 0} onChange={(e) => onChange(Math.max(0, Number(e.target.value) || 0))} aria-label={label} className={cx(input, 'shrink-0 text-right tabular-nums')} style={{ width: w }} />;
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-ink-2">{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
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
