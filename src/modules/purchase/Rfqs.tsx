import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { apiGet, ApiError } from '../../core/api';
import { errorMessage } from '../../core/bridge';
import { dateLabel } from '../../core/time';
import { toast } from '../../core/toasts';
import { Select } from '../../components/Select';
import { ErrorNote, Spinner, cx } from '../../components/ui';
import { btnPrimary, btnSmall, Empty, Field, input } from '../hr/parts';
import { qty, whole } from '../inventory/api';
import { Pill } from '../inventory/parts';
import { pick as pickCls } from '../inventory/pickers';
import { PURCHASE_API } from '@shared/purchase';
import { fetchRfq, fetchRfqs, KP, OFFLINE_WRITE, refreshPurchase, sendRfq, usePurchaseCan, usePurchaseOffline } from './api';
import { refusalText } from './chain';
import { Frame, Head, rowCls } from './parts';
import { awardBody, awardGroups, awardRfq, defaultPicks, fetchComparison, pick, savings, type Comparison, type Picks } from './rfq';

/**
 * RFQs (S-02 "Out to the market"; the "RFQ comparison" design; SRS-PUR-001 G-17): requests for quotation, and for one
 * of them the comparison — each line we asked for against every vendor's bid, the cheapest and the fastest marked — and
 * the award line by line: each line to the bid picked (the cheapest unless chosen otherwise), raising one draft order
 * per winning vendor, each of them sent through approval.
 */
const RFQ_LABEL: Record<string, string> = { draft: 'Draft', sent: 'Out to bid', bidding: 'Out to bid', open: 'Out to bid', closed: 'Closed', awarded: 'Awarded', partially_awarded: 'Part awarded', cancelled: 'Cancelled' };

export default function Rfqs({ org, currency, openId, onOpen, onOrder }: { org: string; currency: string | null; openId: number | null; onOpen: (id: number | null) => void; onOrder: (id: number) => void }) {
  const [status, setStatus] = useState('');
  const list = useQuery({ queryKey: KP.rfqs(org, status), queryFn: ({ signal }) => fetchRfqs(org, status, signal), enabled: !openId });
  if (openId) return <RfqDetail key={openId} id={openId} currency={currency} onBack={() => onOpen(null)} onOrder={onOrder} />;
  const rows = list.data ?? [];
  const W = { title: 220, wh: 130, closes: 90, ans: 100, st: 110 };
  return (
    <div className="flex h-full min-h-0 flex-col gap-3 px-6 py-5">
      <Head title="RFQs" sub="Out to the market: quotes asked for, compared and awarded" />
      <div className="flex items-center gap-2">
        <Select
          aria-label="RFQ status"
          value={status}
          onValueChange={setStatus}
          options={[{ value: '', label: 'Every state' }, ...['draft', 'sent', 'closed', 'awarded', 'cancelled'].map((s) => ({ value: s, label: RFQ_LABEL[s]! }))]}
          className={pickCls + ' !w-[170px]'}
        />
      </div>
      <Frame
        min={760}
        head={
          <>
            <span className="min-w-0 flex-1">RFQ</span>
            <span style={{ width: W.title }}>What for</span>
            <span style={{ width: W.wh }}>Deliver to</span>
            <span style={{ width: W.closes }}>Closes</span>
            <span style={{ width: W.ans }}>Answered</span>
            <span style={{ width: W.st }}>Status</span>
          </>
        }
      >
        {list.isLoading ? (
          <Spinner />
        ) : list.error ? (
          <ErrorNote error={list.error} onRetry={() => void list.refetch()} />
        ) : rows.length ? (
          rows.map((r) => (
            <button key={r.id} type="button" data-rfq={r.id} onClick={() => onOpen(r.id)} className={rowCls}>
              <b className="min-w-0 flex-1 truncate text-ink">{r.reference}</b>
              <span className="shrink-0 truncate text-ink" style={{ width: W.title }}>
                {r.title ?? '—'}
              </span>
              <span className="shrink-0 truncate text-ink-2" style={{ width: W.wh }}>
                {r.warehouse ?? '—'}
              </span>
              <span className="shrink-0 text-ink-2" style={{ width: W.closes }}>
                {r.closing_date ? dateLabel(r.closing_date) : '—'}
              </span>
              <span className="shrink-0 text-ink-2 tabular-nums" style={{ width: W.ans }}>
                {r.responded} of {r.invited}
              </span>
              <span className="shrink-0" style={{ width: W.st }}>
                <Pill tone={r.status === 'awarded' ? 'green' : r.status === 'cancelled' ? 'grey' : 'blue'}>{RFQ_LABEL[r.status] ?? r.status}</Pill>
              </span>
            </button>
          ))
        ) : (
          <Empty text={status ? 'No RFQ matches.' : 'No RFQs yet. Start one from an approved request.'} />
        )}
      </Frame>
    </div>
  );
}

function RfqDetail({ id, currency, onBack, onOrder }: { id: number; currency: string | null; onBack: () => void; onOrder: (id: number) => void }) {
  const qc = useQueryClient();
  const c = usePurchaseCan();
  const offline = usePurchaseOffline();
  const rfq = useQuery({ queryKey: KP.rfq(id), queryFn: ({ signal }) => fetchRfq(id, signal) });
  const cmp = useQuery({ queryKey: KP.comparison(id), queryFn: ({ signal }) => fetchComparison(id, signal), retry: (n, e) => !(e instanceof ApiError && e.status === 404) && n < 2 });
  // The assistant's summary (G-24): assistive only, hidden where the server has no AI (501) or no such call.
  const ai = useQuery({ queryKey: ['purchase', 'rfq-ai', id], queryFn: ({ signal }) => apiGet<{ summary?: string }>(`${PURCHASE_API}/ai/rfq-summary/${id}`, undefined, signal), retry: false, staleTime: 300_000 });
  const c0 = cmp.data;
  // The cheapest bid on every line until somebody picks otherwise.
  const [chosen, setChosen] = useState<Picks | null>(null);
  const picks: Picks = useMemo(() => chosen ?? (c0 ? defaultPicks(c0) : {}), [chosen, c0]);
  const setPick = (line: number, bid: number) => c0 && setChosen(pick(c0, picks, line, bid));
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const r = rfq.data?.quotation;
  const awarded = r?.status === 'awarded';
  const groups = useMemo(() => (c0 ? awardGroups(c0, picks) : []), [c0, picks]);
  const save = c0 ? savings(c0, picks) : null;
  const cur = c0?.currency ?? currency;

  const award = async () => {
    if (!c0) return;
    const b = awardBody(c0, picks, reason);
    if (!b.body) return toast('error', b.error!);
    setBusy(true);
    try {
      const res = await awardRfq(id, b.body);
      const orders = res.orders ?? [];
      toast('success', orders.length === 1 ? `Draft order ${orders[0]!.number ?? orders[0]!.po_number ?? ''} raised — it goes through approval` : `${orders.length} draft orders raised, one per vendor — each goes through approval`);
      if (orders[0]) onOrder(orders[0].id);
    } catch (e) {
      toast('error', refusalText(e));
    } finally {
      setBusy(false);
      refreshPurchase(qc);
    }
  };
  const send = async () => {
    setBusy(true);
    try {
      await sendRfq(id);
      toast('success', 'Sent to the invited vendors');
    } catch (e) {
      toast('error', errorMessage(e));
    } finally {
      setBusy(false);
      refreshPurchase(qc);
    }
  };

  return (
    <div className="flex flex-col gap-3.5 px-6 py-5">
      <button type="button" className="self-start text-[12.5px] font-semibold text-primary hover:underline" onClick={onBack}>
        ← All RFQs
      </button>
      {rfq.isLoading ? <Spinner /> : rfq.error ? <ErrorNote error={rfq.error} onRetry={() => void rfq.refetch()} /> : null}
      {r ? (
        <Head
          title={`${r.reference}${r.title ? ` · ${r.title}` : ''}`}
          sub={[`${r.responded ?? 0} of ${r.invited ?? 0} answered`, r.warehouse ? `deliver to ${r.warehouse}` : null, r.closing_date ? `closes ${dateLabel(r.closing_date)}` : null, cur ? `compared in ${cur}` : null].filter(Boolean).join(' · ')}
        >
          {c.order && !awarded && (r.status === 'draft' || r.status === 'sent') ? (
            <button type="button" className={btnSmall} disabled={busy || offline} title={offline ? OFFLINE_WRITE : 'E-mail it to the invited vendors with a portal link'} onClick={() => void send()}>
              {r.status === 'draft' ? 'Send to vendors' : 'Send again'}
            </button>
          ) : null}
        </Head>
      ) : null}
      {cmp.isLoading ? <Spinner /> : cmp.error ? cmp.error instanceof ApiError && cmp.error.status === 404 ? <Empty text="This WorkSuite server cannot compare bids line by line yet. Award the RFQ on the web." /> : <ErrorNote error={cmp.error} onRetry={() => void cmp.refetch()} /> : null}
      {c0 ? <Grid c={c0} picks={picks} onPick={setPick} readOnly={awarded || !c.order} /> : null}
      {c0 && !awarded && c.order ? (
        <section className="grid grid-cols-1 gap-3 lg:grid-cols-[2fr_1fr]" aria-label="Split award">
          <div className="flex flex-col gap-2 rounded-[12px] border border-line bg-surface px-4 py-3">
            <b className="text-[13px] text-ink">Split award</b>
            <span className="text-[12.5px] text-ink-2">
              {groups.length ? `${groups.reduce((s, g) => s + g.lines, 0)} ${groups.reduce((s, g) => s + g.lines, 0) === 1 ? 'line' : 'lines'} to ${groups.length} ${groups.length === 1 ? 'vendor' : 'vendors'} will raise ${groups.length} draft ${groups.length === 1 ? 'order' : 'orders'}, each sent through approval.` : 'Pick a bid on a line to award it.'}
            </span>
            {groups.map((g) => (
              <span key={g.vendor} className="flex gap-2 text-[12.5px]">
                <span className="min-w-0 flex-1 truncate text-ink">
                  {g.vendor} · {g.lines} {g.lines === 1 ? 'line' : 'lines'}
                </span>
                <b className="text-ink tabular-nums">{whole(g.total, g.currency ?? cur)}</b>
              </span>
            ))}
            <Field label="Why these vendors?">
              <input className={input} value={reason} onChange={(e) => setReason(e.target.value)} aria-label="Why these vendors" maxLength={500} placeholder="Lowest landed cost per line" />
            </Field>
            <button type="button" className={btnPrimary + ' self-start'} disabled={busy || offline || !groups.length} title={offline ? OFFLINE_WRITE : undefined} onClick={() => void award()}>
              {busy ? 'Awarding…' : 'Award selected lines'}
            </button>
          </div>
          <div className="flex flex-col gap-1 rounded-[12px] border border-line bg-surface px-4 py-3">
            <b className="text-[13px] text-ink">Against target</b>
            {save ? (
              <>
                <span className={cx('text-[24px] font-bold tabular-nums', save.diff <= 0 ? 'text-[#166534] dark:text-success' : 'text-danger')}>
                  {save.pct > 0 ? '+' : ''}
                  {save.pct}%
                </span>
                <span className="text-[12.5px] text-ink-2">
                  {whole(Math.abs(save.diff), cur)} {save.diff <= 0 ? 'under' : 'over'} the target cost on the lines awarded
                </span>
              </>
            ) : (
              <span className="text-[12.5px] text-ink-3">No target cost on these lines.</span>
            )}
            {ai.data?.summary ? <span className="mt-2 rounded-[8px] bg-subtle px-2.5 py-2 text-[12px] text-ink-2">Assistant summary: {ai.data.summary}</span> : null}
          </div>
        </section>
      ) : null}
      {awarded && rfq.data?.quotation.award_reason ? <span className="text-[12.5px] text-ink-2">Awarded: {rfq.data.quotation.award_reason}</span> : null}
    </div>
  );
}

/** The bid grid: lines down, vendors across; a priced bid is picked for its line by clicking it (Space or Enter). */
function Grid({ c, picks, onPick, readOnly }: { c: Comparison; picks: Picks; onPick: (line: number, bid: number) => void; readOnly: boolean }) {
  const vendors = c.vendors.length ? c.vendors.map((v) => v.vendor) : [...new Set(c.lines.flatMap((l) => l.bids.map((b) => b.vendor)))];
  const totals = vendors.map((v) => {
    let sum = 0;
    let missing = 0;
    for (const l of c.lines) {
      const b = l.bids.find((x) => x.vendor === v);
      if (b && b.total !== null) sum += b.total;
      else missing++;
    }
    return { sum, missing };
  });
  return (
    <div className="overflow-x-auto rounded-[12px] border border-line bg-surface" role="grid" aria-label="Bid comparison">
      <div className="flex min-w-max border-b border-line bg-ground text-[11.5px] font-bold text-ink-3" role="row">
        <span className="w-[240px] shrink-0 px-3 py-2" role="columnheader">
          What we asked for
        </span>
        <span className="w-[90px] shrink-0 px-2 py-2 text-right" role="columnheader">
          Target
        </span>
        {vendors.map((v) => {
          const meta = c.vendors.find((x) => x.vendor === v);
          return (
            <span key={v} className="flex w-[160px] shrink-0 flex-col px-2 py-2" role="columnheader">
              <span className="truncate text-ink">{v}</span>
              <span className="truncate font-normal">{[meta?.currency, meta?.lead_days !== null && meta?.lead_days !== undefined ? `${meta.lead_days} days` : null, meta?.status === 'invited' ? 'no answer' : null].filter(Boolean).join(' · ')}</span>
            </span>
          );
        })}
      </div>
      {c.lines.map((l) => (
        <div key={l.rfq_line_id} className="flex min-w-max border-b border-line/60 text-[12.5px]" role="row" data-rfq-line={l.rfq_line_id}>
          <span className="w-[240px] shrink-0 truncate px-3 py-2 text-ink" role="rowheader">
            {l.product} <span className="text-ink-3">× {qty(l.qty, l.unit)}</span>
          </span>
          <span className="w-[90px] shrink-0 px-2 py-2 text-right text-ink-2 tabular-nums">{l.target !== null ? whole(l.target * (l.qty || 1)) : '—'}</span>
          {vendors.map((v) => {
            const b = l.bids.find((x) => x.vendor === v);
            const on = !!b && picks[l.rfq_line_id] === b.bid_id;
            if (!b) return <span key={v} className="w-[160px] shrink-0 px-2 py-2 text-ink-3">—</span>;
            if (b.total === null)
              return (
                <span key={v} className="w-[160px] shrink-0 px-2 py-2 text-ink-3">
                  not quoted
                </span>
              );
            return (
              <button
                key={v}
                type="button"
                role="gridcell"
                aria-pressed={on}
                aria-label={`${v} for ${l.product}: ${whole(b.total)}${on ? ', awarded' : ''}`}
                disabled={readOnly}
                onClick={() => onPick(l.rfq_line_id, b.bid_id)}
                className={cx('flex w-[160px] shrink-0 flex-col px-2 py-2 text-left', on ? 'bg-[#E4F4EA] dark:bg-success-bg' : !readOnly && 'hover:bg-subtle')}
              >
                <b className="text-ink tabular-nums">{whole(b.total, b.currency)}</b>
                <span className="text-[11px] text-ink-3">{[b.cheapest ? 'cheapest' : null, b.fastest ? 'fastest' : null, on ? 'award ✓' : null].filter(Boolean).join(' · ') || (b.lead_days !== null ? `${b.lead_days} days` : '')}</span>
              </button>
            );
          })}
        </div>
      ))}
      <div className="flex min-w-max bg-ground text-[12.5px]" role="row">
        <span className="w-[240px] shrink-0 px-3 py-2 font-bold text-ink">Total</span>
        <span className="w-[90px] shrink-0 px-2 py-2 text-right text-ink-2 tabular-nums">{whole(c.lines.reduce((s, l) => s + (l.target ?? 0) * (l.qty || 1), 0))}</span>
        {totals.map((t, i) => (
          <span key={vendors[i]} className="flex w-[160px] shrink-0 flex-col px-2 py-2">
            <b className="text-ink tabular-nums">{whole(t.sum)}</b>
            {t.missing ? <span className="text-[11px] text-[#9A4A06] dark:text-warning">missing {t.missing} {t.missing === 1 ? 'line' : 'lines'}</span> : null}
          </span>
        ))}
      </div>
    </div>
  );
}
