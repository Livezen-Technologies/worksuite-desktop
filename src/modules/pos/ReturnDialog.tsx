import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { POS_LINE_CONDITIONS, type PosApprovalNeed, type PosGiveBack, type PosLineCondition, type PosRefundTo, type PosReturn, type PosSale } from '@shared/pos';
import { Icon } from '../../components/Icon';
import { cx } from '../../components/ui';
import { giveBack, mayGiveBack, openDrawer, PK, readSale } from './api';
import { useBarcodeScanner } from './barcode';
import { useT, type PosKey } from './i18n';
import { moneyNeedsApproval } from './approval';
import type { Approval } from './desk';
import { ON } from './look';
import Override from './Override';
import { Note, PosButton, PosDialog, timeOf, useTillContext } from './parts';
import { formatMoney } from './pricing';
import { canStillRefund, refundable, refundCalls, refundToOptions } from './returns';

/**
 * A return at the counter, against one of this till's sales: the receipt number scanned (the barcode under the
 * receipt) or typed, how many of each line come back and in what condition, and why. WorkSuite does the refund
 * through the till's door (`pos:giveBack`) — on the tenders the sale was paid with, cash out of this drawer — and
 * works out the exact figure; what is shown here is the sale's own line totals, as an estimate. Goods in a
 * condition to sell again go back into stock; damaged ones do not (two refunds, one each way, when both come back).
 *
 * Phase 2, where the server takes them: each line's condition — resaleable, opened, damaged, faulty — in one refund
 * (`capabilities.line_condition`), where the money goes — as paid, cash from this drawer, or the customer's store
 * credit (`refund_to`) — and a manager's approval for a refund past the company's figure (asked first where the till
 * knows the figure, else when WorkSuite answers `approval_required`; sent again under the same refund number).
 * Exchanges and returns without a receipt are not offered: WorkSuite does not take them from a till.
 */
const REASONS: PosKey[] = ['pos.ret.reason.faulty', 'pos.ret.reason.wrong', 'pos.ret.reason.mind', 'pos.ret.reason.damaged'];
type Condition = 'resell' | 'damaged' | PosLineCondition;
const COND_KEY: Record<Condition, PosKey> = { resell: 'pos.ret.resell', damaged: 'pos.ret.damagedGoods', resaleable: 'pos.ret.cond.resaleable', opened: 'pos.ret.cond.opened', faulty: 'pos.ret.cond.faulty' };

export default function ReturnDialog({ onClose }: { onClose: () => void }) {
  const t = useT();
  const till = useTillContext();
  const qc = useQueryClient();
  const [code, setCode] = useState('');
  const [sale, setSale] = useState<PosSale | null>(null);
  const [missing, setMissing] = useState<string | null>(null);
  const [qty, setQty] = useState<Record<number, number>>({});
  const [cond, setCond] = useState<Record<number, Condition>>({});
  const [reason, setReason] = useState<string>('');
  const [other, setOther] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<PosReturn[] | null>(null);
  const [to, setTo] = useState<PosRefundTo>('original');
  const [need, setNeed] = useState<{ need: PosApprovalNeed; rest: PosGiveBack[]; back: PosReturn[] } | null>(null);
  const conditions: Condition[] = till.caps.line_condition ? [...POS_LINE_CONDITIONS] : ['resell', 'damaged'];
  const fallback: Condition = conditions[0]!;

  async function find(ref: string) {
    const r = ref.trim();
    if (!r) return;
    setError(null);
    try {
      const s = await readSale(r);
      setSale(s);
      setMissing(s ? null : r);
      setQty({});
      setCond({});
      setTo('original');
      setCode(r);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The sale could not be read.');
    }
  }
  // The receipt's barcode, scanned anywhere on this screen.
  useBarcodeScanner(!sale && !busy, (c) => void find(c));

  const left = sale ? refundable(sale) : [];
  const can = till.company?.can;
  const allowed = !!sale && mayGiveBack(till.caps, can, 'refund');
  const why = sale?.state !== 'sent' ? t('pos.ret.notYet') : sale.voided || !canStillRefund(sale) ? t('pos.ret.nothingLeft') : till.offline ? t('pos.ret.offline') : !allowed ? t('pos.noReturns') : null;
  const picked = left.filter((l) => (qty[l.product_id] ?? 0) > 0);
  const estimate = (pid: number, q: number) => {
    const l = sale?.lines.find((x) => x.product_id === pid);
    return l && l.quantity > 0 ? (l.total / l.quantity) * q : 0;
  };
  const total = Math.round(picked.reduce((a, l) => a + estimate(l.product_id, qty[l.product_id] ?? 0), 0) * 100) / 100;
  const ready = !!sale && !why && picked.length > 0 && reason.trim().length >= 3;
  const toOptions = sale ? refundToOptions(sale, !!till.caps.refund_to) : [];
  const rules = till.company?.approvals;

  /**
   * The refunds asked, one after the other; a manager's approval asked for stops them there, and they go on with it
   * (the same refund number, so a lost answer is never a second refund).
   */
  async function run(calls: PosGiveBack[], back: PosReturn[], approval: Approval | null) {
    if (!sale) return;
    setBusy(true);
    setError(null);
    try {
      for (let i = 0; i < calls.length; i++) {
        const call = i === 0 && approval ? { ...calls[i]!, approval_id: approval.id } : calls[i]!;
        const r = await giveBack(call);
        if ('needs' in r) {
          setNeed({ need: r.needs, rest: calls.slice(i), back });
          return;
        }
        back.push(r.refund);
        setSale(r.sale);
      }
      setDone(back);
      if (back.some((r) => r.cash_out > 0)) void openDrawer().catch(() => undefined);
      void qc.invalidateQueries({ queryKey: PK.all });
    } catch (e) {
      if (back.length) setDone(back);
      setError(e instanceof Error ? e.message : 'WorkSuite did not do that.');
    } finally {
      setBusy(false);
    }
  }

  async function refund() {
    if (!sale || !ready) return;
    const picks = Object.fromEntries(picked.map((l) => [l.product_id, { quantity: qty[l.product_id] ?? 0, condition: cond[l.product_id] ?? fallback }]));
    const calls = refundCalls(sale, picks, { reason: reason.trim().slice(0, 200), conditions: !!till.caps.line_condition, refund_to: to });
    // Past the company's figure a manager approves first, where the till knows the figure (`approvals.manager_above_amount`).
    if (till.caps.approvals && moneyNeedsApproval(total, rules?.manager_above_amount, rules?.may_approve)) {
      setNeed({
        need: { code: 'approval_required', message: t('pos.ovr.refundAsk', { n: formatMoney(total, sale.currency), max: formatMoney(rules?.manager_above_amount ?? 0, sale.currency) }), ask: { action: 'refund', amount: total, threshold: rules?.manager_above_amount ?? null, subject: sale.ref } },
        rest: calls,
        back: [],
      });
      return;
    }
    await run(calls, [], null);
  }

  if (need && sale) {
    return (
      <Override
        need={need.need}
        currency={sale.currency}
        reason={reason}
        onClose={() => {
          if (need.back.length) setDone(need.back);
          setError(need.need.code === 'approval_required' ? null : need.need.message);
          setNeed(null);
        }}
        onApproved={(a) => {
          const n = need;
          setNeed(null);
          void run(n.rest, n.back, a);
        }}
      />
    );
  }

  if (done && sale) {
    const amount = done.reduce((a, r) => a + r.amount, 0);
    const cash = done.reduce((a, r) => a + r.cash_out, 0);
    return (
      <PosDialog label={t('pos.ret.done')} onClose={onClose} width={620} className="gap-4 p-7">
        <span className="flex h-16 w-16 items-center justify-center rounded-full bg-success-bg text-success">
          <Icon name="check" size={32} strokeWidth={2.2} />
        </span>
        <h2 className="text-[24px] font-extrabold">{t('pos.refundDone', { amount: formatMoney(amount, sale.currency) })}</h2>
        {done.map((r) => (
          <p key={r.ref} className="text-[13px] text-ink-2">
            {r.ref} · {r.tenders.map((x) => `${x.to === 'credit' ? t('pos.ret.toCredit') : x.to === 'voucher' ? t('pos.voucher') : t(`pos.${x.to === 'cash' ? 'cash' : x.method}` as PosKey)} ${formatMoney(x.amount)}`).join(' · ')}
            {r.credit_note ? ` · ${r.credit_note}` : ''}
          </p>
        ))}
        {cash > 0 ? <div className="rounded-pos bg-pos-change px-5 py-4 text-[18px] font-extrabold text-pos-change-ink">{t('pos.cashFromDrawer', { n: formatMoney(cash, sale.currency) })}</div> : null}
        {error ? <Note tone="danger">{error}</Note> : null}
        <PosButton tone="primary" autoFocus className="h-touch-xl text-[17px]" onClick={onClose}>
          {t('pos.ret.backToCounter')}
        </PosButton>
      </PosDialog>
    );
  }

  return (
    <PosDialog label={t('pos.ret.title')} onClose={busy ? undefined : onClose} width={1320} className="h-[min(820px,100%)] flex-row gap-5 bg-pos-ground p-5">
      <section className="flex min-w-0 flex-1 flex-col gap-3 overflow-y-auto rounded-pos-xl bg-pos-panel p-6 scroll-thin">
        <div className="flex items-center gap-3">
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-[22px] font-extrabold">{sale ? t('pos.ret.against', { ref: sale.ref }) : t('pos.ret.title')}</h2>
            <p className="truncate text-[13px] text-ink-3">
              {sale
                ? [timeOf(sale.created_at), sale.customer?.name, sale.tenders.map((x) => `${t(`pos.${x.method}` as PosKey)} ${formatMoney(x.amount)}`).join(' + ')].filter(Boolean).join(' · ')
                : t('pos.ret.hint')}
            </p>
          </div>
          <form
            className="flex h-touch-md w-[300px] shrink-0 items-center gap-2 rounded-[12px] border-2 border-primary bg-pos-panel px-3.5"
            onSubmit={(e) => {
              e.preventDefault();
              void find(code);
            }}
          >
            <Icon name="scan" size={20} className="text-primary" />
            <input autoFocus value={code} onChange={(e) => setCode(e.target.value.slice(0, 60))} placeholder={t('pos.ret.receiptNo')} aria-label={t('pos.ret.receiptNo')} className="bare-focus min-w-0 flex-1 bg-transparent font-mono text-[15px] outline-none" />
          </form>
          <button type="button" aria-label={t('pos.close')} onClick={onClose} disabled={busy} className="flex h-touch-md w-touch-md shrink-0 items-center justify-center rounded-[12px] bg-pos-key">
            <Icon name="x" size={20} />
          </button>
        </div>
        {missing ? <Note tone="warning">{t('pos.ret.missing', { ref: missing })}</Note> : null}
        {sale && why ? <Note tone="warning">{why}</Note> : null}
        {sale ? (
          <>
            <div className="grid grid-cols-[1fr_140px_210px_120px] gap-2.5 px-3 pt-2 text-[12px] font-bold tracking-[.04em] text-ink-3 uppercase">
              <span>{t('pos.ret.item')}</span>
              <span className="text-center">{t('pos.ret.qty')}</span>
              <span>{t('pos.ret.condition')}</span>
              <span className="text-right">{t('pos.refund')}</span>
            </div>
            {left.map((l) => {
              const q = qty[l.product_id] ?? 0;
              const line = sale.lines.find((x) => x.product_id === l.product_id)!;
              const setQ = (n: number) => setQty((m) => ({ ...m, [l.product_id]: Math.min(l.left, Math.max(0, n)) }));
              return (
                <div key={l.product_id} className={cx('grid grid-cols-[1fr_140px_210px_120px] items-center gap-2.5 rounded-pos px-3 py-2.5', q > 0 ? ON : 'bg-pos-key')}>
                  <div className="min-w-0">
                    <div className="truncate text-[15px] font-bold">{l.name}</div>
                    <div className="text-[12px] text-ink-3">{[t('pos.ret.sold', { n: l.sold, price: formatMoney(line.unit_price) }), l.returned ? t('pos.ret.already', { n: l.returned }) : null].filter(Boolean).join(' · ')}</div>
                  </div>
                  <div className="flex items-center justify-center gap-1.5">
                    <button type="button" aria-label={`One fewer ${l.name}`} disabled={!!why || q <= 0} onClick={() => setQ(q - 1)} className="h-10 w-10 rounded-[10px] bg-pos-panel text-[18px] disabled:opacity-40">
                      −
                    </button>
                    <span className="w-10 text-center font-mono text-[16px] font-bold" aria-label={`${t('pos.ret.qty')} ${l.name}`}>
                      {q}
                    </span>
                    <button type="button" aria-label={`One more ${l.name}`} disabled={!!why || q >= l.left} onClick={() => setQ(q + 1)} className="h-10 w-10 rounded-[10px] bg-pos-panel text-[18px] disabled:opacity-40">
                      +
                    </button>
                  </div>
                  <div className="flex gap-1.5">
                    {q > 0 ? (
                      conditions.length > 2 ? (
                        <select
                          aria-label={`${t('pos.ret.condition')} ${l.name}`}
                          value={cond[l.product_id] ?? fallback}
                          onChange={(e) => setCond((m) => ({ ...m, [l.product_id]: e.target.value as Condition }))}
                          className="h-9 w-full rounded-[10px] bg-pos-panel px-2 text-[13px] font-semibold text-ink outline-none"
                        >
                          {conditions.map((c) => (
                            <option key={c} value={c}>
                              {t(COND_KEY[c])}
                            </option>
                          ))}
                        </select>
                      ) : (
                        conditions.map((c) => (
                          <button
                            key={c}
                            type="button"
                            aria-pressed={(cond[l.product_id] ?? fallback) === c}
                            onClick={() => setCond((m) => ({ ...m, [l.product_id]: c }))}
                            className={cx('h-9 rounded-[10px] px-3 text-[12px] font-semibold', (cond[l.product_id] ?? fallback) === c ? 'bg-pos-bar text-white' : 'bg-pos-panel text-ink')}
                          >
                            {t(COND_KEY[c])}
                          </button>
                        ))
                      )
                    ) : (
                      <span className="text-[13px] text-ink-3">—</span>
                    )}
                  </div>
                  <span className="text-right font-mono text-[15px] font-bold">{q > 0 ? formatMoney(estimate(l.product_id, q)) : '—'}</span>
                </div>
              );
            })}
          </>
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center text-ink-3">
            <Icon name="scan" size={40} />
            <p className="max-w-[420px] text-[14px]">{t('pos.ret.scan')}</p>
          </div>
        )}
      </section>
      <aside className="flex w-[440px] shrink-0 flex-col gap-3.5 overflow-y-auto rounded-pos-xl bg-pos-panel p-6 scroll-thin">
        <h3 className="text-[18px] font-extrabold">{t('pos.refund')}</h3>
        <div className="text-[13px] font-bold text-ink-2">{t('pos.reason')}</div>
        <div className="flex flex-wrap gap-2">
          {REASONS.map((k) => {
            const label = t(k);
            const on = !other && reason === label;
            return (
              <button
                key={k}
                type="button"
                aria-pressed={on}
                onClick={() => {
                  setOther(false);
                  setReason(label);
                }}
                className={cx('h-touch rounded-[12px] px-3.5 text-[14px] font-semibold', on ? `${ON} text-primary` : 'bg-pos-key text-ink')}
              >
                {label}
              </button>
            );
          })}
          <button
            type="button"
            aria-pressed={other}
            onClick={() => {
              setOther(true);
              setReason('');
            }}
            className={cx('h-touch rounded-[12px] px-3.5 text-[14px] font-semibold', other ? `${ON} text-primary` : 'bg-pos-key text-ink')}
          >
            {t('pos.ret.reason.other')}
          </button>
        </div>
        {other ? <input autoFocus value={reason} onChange={(e) => setReason(e.target.value.slice(0, 200))} aria-label={t('pos.reason')} placeholder={t('pos.reason')} className="h-touch-md rounded-[12px] bg-pos-panel px-3.5 text-[15px] shadow-[inset_0_0_0_1px_#cbd5e1] outline-none" /> : null}
        <div className="text-[13px] font-bold text-ink-2">{t('pos.ret.to')}</div>
        {toOptions.length > 1 ? (
          <div role="radiogroup" aria-label={t('pos.ret.to')} className="flex flex-col gap-2">
            {toOptions.map((o) => (
              <button key={o} type="button" role="radio" aria-checked={to === o} onClick={() => setTo(o)} className={cx('rounded-[12px] px-4 py-3 text-left text-[14px]', to === o ? ON : 'bg-pos-key')}>
                <div className="font-bold">{t(o === 'original' ? 'pos.ret.asPaid' : o === 'cash' ? 'pos.ret.toCash' : 'pos.ret.toCredit')}</div>
                <div className="text-[12px] text-ink-3">{t(o === 'original' ? 'pos.ret.asPaidHint' : o === 'cash' ? 'pos.ret.toCashHint' : 'pos.ret.toCreditHint')}</div>
              </button>
            ))}
          </div>
        ) : (
          <div className="rounded-[12px] bg-pos-key px-4 py-3 text-[14px]">
            <div className="font-bold">{t('pos.ret.asPaid')}</div>
            <div className="text-[12px] text-ink-3">{t('pos.ret.asPaidHint')}</div>
          </div>
        )}
        <div className="flex flex-col gap-1 rounded-pos bg-pos-key px-4 py-3.5">
          {picked.map((l) => (
            <div key={l.product_id} className="flex justify-between gap-2 text-[13px] text-ink-2">
              <span className="truncate">
                {qty[l.product_id]} × {l.name}
                {(cond[l.product_id] ?? fallback) !== fallback ? ` · ${t(COND_KEY[cond[l.product_id]!])}` : ''}
              </span>
              <span className="font-mono">{formatMoney(estimate(l.product_id, qty[l.product_id] ?? 0))}</span>
            </div>
          ))}
          <div className="mt-1 flex items-baseline justify-between">
            <span className="text-[16px] font-extrabold">{t('pos.ret.about')}</span>
            <span className="font-mono text-[26px] font-bold">{formatMoney(total, sale?.currency)}</span>
          </div>
        </div>
        <p className="text-[12px] text-ink-3">{t('pos.ret.exact')}</p>
        {error ? <Note tone="danger">{error}</Note> : null}
        <PosButton tone="primary" className="mt-auto h-touch-xl shrink-0 rounded-pos-lg text-[17px] font-extrabold" disabled={!ready || busy} onClick={() => void refund()}>
          {busy ? <Icon name="spinner" size={18} className="animate-spin" /> : null}
          {t('pos.ret.go', { n: formatMoney(total) })}
        </PosButton>
      </aside>
    </PosDialog>
  );
}
