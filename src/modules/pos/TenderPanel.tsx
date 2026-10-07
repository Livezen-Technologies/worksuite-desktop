import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { PosApprovalNeed, PosCustomer, PosPrintOutcome, PosSale, PosTenderMethod, PosTenderOption } from '@shared/pos';
import { Icon } from '../../components/Icon';
import { cx } from '../../components/ui';
import { toast } from '../../core/toasts';
import { couponMessage, discountNeed, draftOf, expiryOf, tenderTiles } from './adjust';
import { emailReceipt, openDrawer, PK, printReceipt, sell, type PosSession } from './api';
import { approvalActions } from './approval';
import { cartActions, discountAmount, useCart } from './cart';
import { CouponDialog, DiscountDialog } from './DiscountEditor';
import { lookupVoucher, storeCredit, type Approval } from './desk';
import { publish } from './display';
import { useT, type PosKey } from './i18n';
import { BigAmount, Keypad } from './Keypad';
import { press, typedOf } from './numpad';
import { ON, OFF } from './look';
import Override from './Override';
import { Note, PosButton, PosDialog, useTillContext } from './parts';
import { discountBase, formatMoney, quickCash, settle, type PricedCart } from './pricing';
import ReceiptPreview from './ReceiptPreview';
import { buildSale, remaining, tenderProblem, tendersOf, type Balances, type TenderRow } from './tender';

/**
 * Taking the money, in two panes: on the navy side the total, what has been paid so far (each tender, the one being
 * typed ringed), what is still to pay and the change to give; on the other, the tenders this till takes — cash, card,
 * a transfer or a wallet (only cash and the shop's own card machine with WorkSuite out of reach) — the amount on the
 * keypad, the notes a customer is likely to hand over, a card's slip reference, and one button to complete the sale.
 * Change is cash only, as WorkSuite reckons it. Complete hands the sale to the till (numbered, kept, sent), which
 * prints the receipt and opens the drawer when cash was taken; the sale-complete screen follows, with the change, the
 * receipt's options and the receipt itself. Cash exact (`exact`) completes the total in cash at once.
 *
 * Phase 2: the tiles are the company's configured tenders (`capabilities.tenders`, in its order and with its names —
 * LankaQR, a gift voucher, store credit, the customer's account), else the four every server takes. A voucher's code
 * is checked for its balance first; store credit is read for the named customer; neither, nor an account, is offered
 * offline. A sale WorkSuite would take only with a manager's approval opens the override, and is sent again with it.
 * The sale-complete screen shows the points the customer earned and their balance.
 *
 * #293: under the total, the sale's adjustments — Subtotal, the promotions, Discount (−), Coupon (−), points — each with
 * its × to take it off, and Add discount / Add coupon. A discount is given in the same editor as the bottom bar's
 * (`DiscountEditor`: percentage or fixed amount, a reason, the cashier's limit, a manager's PIN past it); a coupon is
 * typed or scanned and checked by WorkSuite on the cart. Both change the sale on the counter (`cartActions`), so the
 * cart is priced again and the total, still to pay and the change follow at once; going back to the sale keeps them.
 * A gift voucher shows its balance and expiry. Offline, coupons and vouchers wait (they need WorkSuite); a discount
 * still works.
 */
const HINT: Record<PosTenderMethod, PosKey> = {
  cash: 'pos.pay.cashHint',
  card: 'pos.pay.cardHint',
  bank_transfer: 'pos.pay.transferHint',
  wallet: 'pos.pay.walletHint',
  qr: 'pos.pay.qrHint',
  voucher: 'pos.pay.voucherHint',
  store_credit: 'pos.pay.creditHint',
  account: 'pos.pay.accountHint',
};
const ICON: Record<PosTenderMethod, string> = { cash: 'banknote', card: 'credit-card', bank_transfer: 'landmark', wallet: 'wallet', qr: 'qr-code', voucher: 'ticket', store_credit: 'receipt', account: 'building' };

/** The configured name of a tender, else the till's word for its kind. */
export function tenderLabel(t: (k: PosKey) => string, kind: PosTenderMethod, offered?: PosTenderOption[] | null): string {
  const name = offered?.find((o) => o.kind === kind)?.name;
  return name && name !== kind ? name : t(`pos.${kind}` as PosKey);
}

/** Phase 2's parts of the sale, as the counter decided them (each only where the server announced it). */
export interface SaleExtras {
  /** Ask WorkSuite for its promotions (online), or say none were applied (offline). */
  promotions?: boolean;
  coupon?: string | null;
  redeem?: number;
  /** The open sale's id on this till (its approvals are kept by it, in memory). */
  saleId?: string;
  approval?: Approval | null;
}

export default function Tender({
  cart,
  source,
  currency,
  session,
  customer,
  catalogueVersion,
  exact = false,
  offered = null,
  extras = {},
  pricing = { pending: false, error: null },
  onClose,
  onDone,
}: {
  cart: PricedCart;
  source: 'server' | 'estimate';
  currency: string;
  session: PosSession;
  customer: PosCustomer | null;
  catalogueVersion: string | null;
  /** Cash exact: the total taken in cash at once. */
  exact?: boolean;
  /** The company's configured tenders (`capabilities.tenders`); null: the four every server takes. */
  offered?: PosTenderOption[] | null;
  extras?: SaleExtras;
  /** The cart being priced again after an adjustment (`pending`), or WorkSuite's refusal of it (`error`). */
  pricing?: { pending: boolean; error: string | null };
  onClose: () => void;
  onDone: () => void;
}) {
  const t = useT();
  const till = useTillContext();
  const qc = useQueryClient();
  const total = cart.total;
  const [rows, setRows] = useState<TenderRow[]>([{ method: 'cash', amount: typedOf(total), reference: '' }]);
  const [cur, setCur] = useState(0);
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ sale: PosSale; queued: boolean; printed: PosPrintOutcome | null } | null>(null);
  const [need, setNeed] = useState<PosApprovalNeed | null>(null);
  const [approval, setApproval] = useState<Approval | null>(extras.approval ?? null);
  const [balances, setBalances] = useState<Balances>({ vouchers: {}, credit: null });
  const [checking, setChecking] = useState(false);
  const [panel, setPanel] = useState<'discount' | 'coupon' | null>(null);
  const [discountAsk, setDiscountAsk] = useState<{ need: PosApprovalNeed; reason: string } | null>(null);
  const state = useCart();
  const online = !till.offline;
  const caps = till.caps;
  const approvalsOn = !!caps.approvals && online;
  const tenders = useMemo(() => tenderTiles(online, offered, caps, till.company?.can), [online, offered, caps, till.company]);
  /** What the cashier's discount comes off: the goods after their list discounts and the promotions. */
  const base = discountBase(cart);
  /** A coupon on the sale that WorkSuite no longer takes (the cart changed, it ran out): the sale waits until it goes. */
  const couponOff = !!(extras.coupon && cart.coupon && !cart.coupon.valid);
  const methods = useMemo(() => tenders.map((x) => x.kind), [tenders]);
  const denominations = useMemo(() => till.options?.denominations?.[currency] ?? session.denominations ?? [], [till.options, currency, session.denominations]);
  const s = settle(total, tendersOf(rows));
  const shop = till.company?.name ?? null;
  const row = rows[cur] ?? rows[0]!;

  useEffect(() => {
    if (done) {
      const l = done.sale.loyalty;
      publish({
        kind: 'paid',
        shop,
        currency,
        total: done.sale.totals.total,
        paid: s.paid + s.change,
        change: done.sale.change_given,
        ...(done.sale.customer?.name ? { customer: done.sale.customer.name } : {}),
        ...(l ? { points: { earned: l.earned, balance: l.balance ?? null } } : {}),
      });
    }
  }, [done, shop, currency, s.paid, s.change]);

  // The total moved (a discount or a coupon added or taken off): the one payment nobody has typed follows it.
  const [seenTotal, setSeenTotal] = useState(total);
  if (seenTotal !== total) {
    setSeenTotal(total);
    if (!touched && rows.length === 1) setRows([{ ...rows[0]!, amount: typedOf(total) }]);
  }

  const quick = useMemo(() => (row.method === 'cash' ? quickCash(remaining(total, rows, cur), denominations) : []), [total, rows, cur, row.method, denominations]);
  const label = (m: PosTenderMethod) => tenderLabel(t, m, offered);
  const problem = tenderProblem(rows, { offered: tenders, customer, balances, online: !till.offline });

  /** A voucher's balance, before it is taken: the amount becomes what it covers. */
  async function checkVoucher(i: number) {
    const code = (rows[i]?.reference ?? '').trim().toUpperCase();
    if (!code) return;
    setChecking(true);
    setError(null);
    try {
      const v = await lookupVoucher(code);
      setBalances((b) => ({ ...b, vouchers: { ...b.vouchers, [code]: v ? { balance: v.balance, usable: v.usable, expires_on: v.expires_on, problem: v.problem ?? null } : null } }));
      if (v?.usable) set(i, { reference: code, amount: typedOf(Math.min(v.balance, remaining(total, rows, i))) });
    } catch (e) {
      setError(e instanceof Error ? e.message : t('pos.pay.voucherFailed'));
    } finally {
      setChecking(false);
    }
  }

  /** The named customer's store credit, read when the tile is chosen. */
  useEffect(() => {
    if (!methods.includes('store_credit') || !customer?.id || till.offline || !rows.some((r) => r.method === 'store_credit')) return;
    if (balances.credit !== null) return;
    let live = true;
    storeCredit(customer.id).then(
      (c) => {
        if (!live) return;
        setBalances((b) => ({ ...b, credit: c.balance }));
        setRows((rs) => rs.map((r, k) => (r.method === 'store_credit' && (Number(r.amount.replace(/,/g, '')) || 0) > c.balance ? { ...r, amount: typedOf(Math.min(c.balance, remaining(total, rs, k))) } : r)));
      },
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [rows, methods, customer?.id, till.offline, balances.credit, total]);

  const set = (i: number, patch: Partial<TenderRow>) => {
    setTouched(true);
    setRows((rs) => rs.map((r, k) => (k === i ? { ...r, ...patch } : r)));
  };

  /** A tender tile: the one payment as it stands changes method, else that tender's row, or a new one for what is left. */
  function choose(m: PosTenderMethod) {
    if (rows.length === 1 && !touched) {
      setRows([{ ...rows[0]!, method: m }]);
      return;
    }
    const have = rows.findIndex((r) => r.method === m);
    if (have >= 0) {
      setCur(have);
      return;
    }
    if (rows.length >= 4) return;
    setTouched(true);
    setRows((rs) => [...rs, { method: m, amount: typedOf(remaining(total, rs)), reference: '' }]);
    setCur(rows.length);
  }

  async function complete(using = rows, approved: Approval | null = approval) {
    if (pricing.pending) return;
    if (pricing.error || couponOff) {
      setError(pricing.error ?? t('pos.adj.couponFix'));
      return;
    }
    const why = tenderProblem(using, { offered: tenders, customer, balances, online: !till.offline });
    if (why) {
      setError(why);
      return;
    }
    const input = buildSale(
      {
        session_id: session.id,
        register_id: session.register_id,
        currency,
        customer,
        cart,
        source,
        catalogue_version: catalogueVersion,
        promotions: extras.promotions,
        coupon: extras.coupon,
        redeem: extras.redeem,
        approval_id: approved && approved.action === 'discount' ? approved.id : null,
        discount: discountAmount(state) !== null ? { type: 'amount', value: discountAmount(state)!, reason: state.discount_reason } : state.discount_reason ? { type: 'pct', value: cart.discount_pct, reason: state.discount_reason } : undefined,
      },
      using,
    );
    if ('error' in input) {
      setError(input.error);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const r = await sell(input);
      if ('needs' in r) {
        // Nothing was sold: a manager approves, and the sale is sent again with it.
        setNeed(r.needs);
        return;
      }
      if (extras.saleId) approvalActions.drop(extras.saleId);
      setDone(r);
      void qc.invalidateQueries({ queryKey: PK.till });
      void qc.invalidateQueries({ queryKey: ['pos', 'sales'] });
      toast(r.queued ? 'warning' : 'success', r.queued ? t('pos.saleQueued', { ref: r.sale.ref }) : t('pos.saleDone', { ref: r.sale.ref }));
      if (r.printed && !r.printed.ok) toast('warning', r.printed.message);
    } catch (e) {
      // WorkSuite refused the sale while the customer is here: nothing was sold; the cart stays.
      setError(e instanceof Error ? e.message : 'The sale could not be completed.');
      // The refusal may be the drawer (`drawer_closed`: closed on the web meanwhile): read the registers again, so the
      // register asks for one to be opened.
      void qc.invalidateQueries({ queryKey: PK.registers });
    } finally {
      setBusy(false);
    }
  }

  // Cash exact: once, as the screen opens.
  const started = useRef(false);
  useEffect(() => {
    if (!exact || started.current) return;
    started.current = true;
    void complete([{ method: 'cash', amount: total.toFixed(2), reference: '' }]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [exact]);

  if (done) return <Complete done={done} currency={currency} onDone={onDone} />;
  if (discountAsk) {
    // A discount past the cashier's rights, from Add discount: a manager approves it, and it stays on the sale.
    return (
      <Override
        need={discountAsk.need}
        currency={currency}
        reason={discountAsk.reason || undefined}
        onClose={() => setDiscountAsk(null)}
        onApproved={(a) => {
          setDiscountAsk(null);
          setApproval(a);
          if (extras.saleId) approvalActions.set(extras.saleId, a);
        }}
      />
    );
  }
  if (panel === 'discount') {
    return (
      <DiscountDialog
        initial={draftOf(state)}
        base={base}
        currency={currency}
        amountOn={!!caps.discount_amount}
        rights={till.discount}
        approvals={approvalsOn}
        onCancel={() => setPanel(null)}
        onApply={(r) => {
          setPanel(null);
          cartActions.applyDiscount({ type: r.draft.type, value: r.draft.value, reason: r.draft.reason }, approvalsOn ? null : till.discount.ceiling);
          // Past the cashier's own rights: a manager approves it now, unless one already approved as much.
          if (r.needsApproval && !(approval && approval.action === 'discount' && approval.amount + 0.0001 >= r.pct)) {
            setDiscountAsk({ need: discountNeed(t, r, till.discount, (n) => formatMoney(n, currency)), reason: r.draft.reason });
          }
        }}
      />
    );
  }
  if (panel === 'coupon') {
    return (
      <CouponDialog
        current={state.coupon ?? null}
        lines={state.lines}
        org={till.company?.id ?? null}
        customerId={customer?.id ?? null}
        offline={till.offline}
        onClose={() => setPanel(null)}
        onApplied={(code) => {
          setPanel(null);
          setError(null);
          cartActions.coupon(code);
        }}
      />
    );
  }
  if (need) {
    return (
      <Override
        need={need}
        currency={currency}
        onClose={() => {
          setNeed(null);
          setError(need.message);
        }}
        onApproved={(a) => {
          setNeed(null);
          setApproval(a);
          if (extras.saleId) approvalActions.set(extras.saleId, a);
          void complete(rows, a);
        }}
      />
    );
  }

  const who = customer?.name || customer?.email || customer?.phone || t('pos.walkIn');
  const couponCode = extras.coupon ?? null;
  const cta = s.overCharged ? t('pos.pay.overCharged') : s.due > 0 ? t('pos.pay.stillDue', { n: formatMoney(s.due) }) : s.change > 0 ? t('pos.pay.completeChange', { n: formatMoney(s.change) }) : t('pos.complete');

  return (
    <PosDialog label={t('pos.pay.title')} onClose={busy ? undefined : onClose} width={1120} className="h-[min(720px,100%)] flex-row">
      <div className="flex w-[420px] shrink-0 flex-col gap-3.5 overflow-y-auto bg-pos-bar p-7 text-white scroll-thin max-lg:w-[340px]">
        <div className="truncate text-[13px] text-pos-bar-ink">{t('pos.pay.sale', { who })}</div>
        <div>
          <div className="text-[13px] text-[#cbd5e1]">{t('pos.total')}</div>
          <div className="font-mono text-[34px] font-bold tabular-nums">{formatMoney(total, currency)}</div>
        </div>
        <Adjustments
          cart={cart}
          coupon={couponCode}
          discountReason={state.discount_reason ?? null}
          discountTyped={Number(state.discount) > 0}
          offline={till.offline}
          mayDiscount={till.discount.allowed || approvalsOn}
          mayCoupon={!!caps.coupons}
          busy={busy}
          repricing={pricing.pending}
          onAddDiscount={() => setPanel('discount')}
          onAddCoupon={() => setPanel('coupon')}
          onRemoveDiscount={() => cartActions.clearDiscount()}
          onRemoveCoupon={() => {
            cartActions.coupon('');
            setError(null);
          }}
        />
        <div className="h-px bg-white/[.14]" />
        <div className="text-[12px] font-bold tracking-[.06em] text-pos-bar-ink uppercase">{t('pos.pay.paidSoFar')}</div>
        {rows.map((r, i) => {
          const on = i === cur;
          const v = Number(r.amount.replace(/,/g, '')) || 0;
          return (
            <div key={i} className={cx('flex items-center gap-3 rounded-pos bg-white/[.08] p-3.5', on && 'shadow-[inset_0_0_0_2px_#7FD8DF]')}>
              <button type="button" onClick={() => setCur(i)} aria-label={`${label(r.method)} ${i + 1}`} className="flex min-w-0 flex-1 items-center gap-3 text-left">
                <span className={cx('flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px]', r.method === 'cash' ? 'bg-teal' : 'bg-primary')}>
                  <Icon name={ICON[r.method]} size={18} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[14px] font-bold">{label(r.method)}</span>
                  <span className="block truncate text-[12px] text-pos-bar-ink">{r.method === 'cash' ? t('pos.pay.tendered', { n: formatMoney(v) }) : r.reference.trim() ? t('pos.pay.ref', { ref: r.reference.trim() }) : t('pos.pay.noRef')}</span>
                </span>
                <span className="font-mono text-[16px] font-bold tabular-nums">{formatMoney(r.method === 'cash' ? Math.max(0, v - s.change) : v)}</span>
              </button>
              {rows.length > 1 ? (
                <button
                  type="button"
                  aria-label={t('pos.pay.remove')}
                  onClick={() => {
                    setRows((rs) => rs.filter((_, k) => k !== i));
                    setCur(0);
                  }}
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[8px] text-white/70 hover:bg-white/10"
                >
                  <Icon name="x" size={16} />
                </button>
              ) : null}
            </div>
          );
        })}
        <div className="mt-auto flex flex-col gap-2">
          <div className="flex justify-between text-[15px]">
            <span className="text-[#cbd5e1]">{t('pos.pay.toPay')}</span>
            <span className={cx('font-mono font-bold tabular-nums', s.due > 0 && 'text-[#fca5a5]')}>{formatMoney(s.due)}</span>
          </div>
          <div className="flex items-baseline justify-between rounded-pos bg-pos-change px-4 py-3.5 text-pos-change-ink">
            <span className="text-[16px] font-bold">{t('pos.pay.changeToGive')}</span>
            <span className="font-mono text-[28px] font-bold tabular-nums">{formatMoney(s.change)}</span>
          </div>
        </div>
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-4 overflow-y-auto p-7 scroll-thin">
        <div className="flex items-center">
          <h2 className="flex-1 text-[20px] font-extrabold">{t('pos.pay.title')}</h2>
          <PosButton className="h-touch text-[14px] font-semibold" disabled={busy} onClick={onClose}>
            {t('pos.pay.back')}
          </PosButton>
        </div>
        <div role="radiogroup" aria-label={t('pos.tender')} className="grid grid-cols-3 gap-2.5 max-lg:grid-cols-2">
          {methods.map((m) => (
            <button
              key={m}
              type="button"
              role="radio"
              aria-checked={row.method === m}
              aria-label={label(m)}
              onClick={() => choose(m)}
              className={cx('flex h-touch-2xl flex-col items-start justify-center gap-0.5 rounded-pos px-4 text-left text-ink', row.method === m ? ON : OFF)}
            >
              <span className="text-[15px] font-bold">{label(m)}</span>
              <span className="text-[12px] text-ink-3">{tenders.find((x) => x.kind === m)?.needs_customer && !customer?.id ? t('pos.pay.needsCustomer') : t(HINT[m])}</span>
            </button>
          ))}
        </div>
        {till.offline ? <p className="-mt-2 text-[12px] text-ink-3">{t('pos.pay.offlineTenders')}</p> : null}
        {pricing.error ? <Note tone="danger">{pricing.error}</Note> : null}
        <div className="flex min-h-0 flex-1 gap-4">
          <div className="flex min-w-0 flex-1 flex-col gap-2.5">
            <div className="text-[13px] font-bold text-ink-2">{row.method === 'cash' ? t('pos.pay.cashReceived') : t('pos.pay.amountOf', { method: label(row.method) })}</div>
            <BigAmount value={row.amount} onChange={(v) => set(cur, { amount: v })} onFocus={(e) => e.target.select()} aria-label={`${t('pos.amount')} ${cur + 1}`} />
            {row.method === 'cash' ? (
              <div className="grid grid-cols-2 gap-2">
                {quick.map((v, i) => (
                  <button
                    key={v}
                    type="button"
                    aria-label={formatMoney(v)}
                    onClick={() => set(cur, { amount: typedOf(v) })}
                    className={cx('h-touch-md rounded-[12px] font-mono text-[16px] font-bold', Math.abs((Number(row.amount) || 0) - v) < 0.005 ? 'bg-primary text-white' : 'bg-pos-key text-ink hover:brightness-95')}
                  >
                    {i === 0 ? t('pos.pay.exact', { n: formatMoney(v) }) : formatMoney(v)}
                  </button>
                ))}
              </div>
            ) : row.method === 'voucher' ? (
              <div className="flex flex-col gap-2">
                <div className="flex gap-2">
                  <input
                    aria-label={`${t('pos.pay.voucherCode')} ${cur + 1}`}
                    placeholder={t('pos.pay.voucherCode')}
                    value={row.reference}
                    maxLength={40}
                    onChange={(e) => set(cur, { reference: e.target.value.toUpperCase().replace(/[^A-Z0-9-]/g, '').slice(0, 40) })}
                    onKeyDown={(e) => e.key === 'Enter' && void checkVoucher(cur)}
                    className="h-touch-md min-w-0 flex-1 rounded-[12px] bg-pos-panel px-3.5 font-mono text-[15px] text-ink shadow-[inset_0_0_0_1px_#cbd5e1] outline-none focus:shadow-[inset_0_0_0_2px_var(--pos-on-ring)]"
                  />
                  <PosButton className="h-touch-md px-4 text-[14px]" disabled={checking || row.reference.trim().length < 4 || till.offline} onClick={() => void checkVoucher(cur)}>
                    {checking ? <Icon name="spinner" size={16} className="animate-spin" /> : null}
                    {t('pos.pay.voucherCheck')}
                  </PosButton>
                </div>
                {row.reference.trim().toUpperCase() in balances.vouchers ? <VoucherLine v={balances.vouchers[row.reference.trim().toUpperCase()] ?? null} currency={currency} /> : null}
              </div>
            ) : row.method === 'store_credit' || row.method === 'account' ? (
              <p className="rounded-[12px] bg-pos-key px-3.5 py-3 text-[13px] text-ink-2">
                {!customer?.id
                  ? t('pos.pay.needsCustomer')
                  : row.method === 'store_credit'
                    ? balances.credit === null
                      ? t('pos.pay.creditReading')
                      : t('pos.pay.creditBalance', { name: customer.name ?? '', n: formatMoney(balances.credit, currency) })
                    : t('pos.pay.accountNote', { name: customer.name ?? '' })}
              </p>
            ) : (
              <input
                aria-label={`${t('pos.reference')} ${cur + 1}`}
                placeholder={row.method === 'card' ? t('pos.pay.slipRef') : t('pos.reference')}
                value={row.reference}
                maxLength={80}
                onChange={(e) => set(cur, { reference: e.target.value.slice(0, 80) })}
                className="h-touch-md rounded-[12px] bg-pos-panel px-3.5 text-[15px] text-ink shadow-[inset_0_0_0_1px_#cbd5e1] outline-none focus:shadow-[inset_0_0_0_2px_var(--pos-on-ring)]"
              />
            )}
            {source === 'estimate' ? <Note tone="warning">{t('pos.provisional')}</Note> : null}
            {error ? <Note tone="danger">{error}</Note> : problem && touched && s.due <= 0 ? <Note tone="warning">{problem}</Note> : null}
            {approval?.action === 'discount' ? <p className="text-[12px] text-success">{t('pos.ovr.approvedBy', { name: approval.approver ?? '' })}</p> : null}
            <p className="mt-auto text-[12px] text-ink-3">{t('pos.pay.cardNote')}</p>
          </div>
          <Keypad className="w-[300px] shrink-0 content-start max-lg:w-[240px]" keys={['7', '8', '9', '4', '5', '6', '1', '2', '3', '00', '0', 'back']} onKey={(k) => set(cur, { amount: press(row.amount, k) })} />
        </div>
        <PosButton tone="primary" className="h-[68px] shrink-0 rounded-pos-lg text-[19px] font-extrabold" disabled={busy || pricing.pending || !!pricing.error || couponOff || s.due > 0 || s.overCharged} onClick={() => void complete()}>
          {busy || pricing.pending ? <Icon name="spinner" size={20} className="animate-spin" /> : <Icon name="check" size={20} />}
          {pricing.pending ? t('pos.adj.repricing') : cta}
        </PosButton>
      </div>
    </PosDialog>
  );
}

/**
 * The sale's adjustments under the total (#293): the subtotal, the promotions, the coupon and the cashier's discount
 * (each with its × to take it off, the reason under the discount), the points, and Add discount / Add coupon. A coupon
 * WorkSuite no longer takes says why; offline, coupons wait.
 */
function Adjustments({
  cart,
  coupon,
  discountReason,
  discountTyped,
  offline,
  mayDiscount,
  mayCoupon,
  busy,
  repricing,
  onAddDiscount,
  onAddCoupon,
  onRemoveDiscount,
  onRemoveCoupon,
}: {
  cart: PricedCart;
  coupon: string | null;
  discountReason: string | null;
  discountTyped: boolean;
  offline: boolean;
  mayDiscount: boolean;
  mayCoupon: boolean;
  busy: boolean;
  repricing: boolean;
  onAddDiscount: () => void;
  onAddCoupon: () => void;
  onRemoveDiscount: () => void;
  onRemoveCoupon: () => void;
}) {
  const t = useT();
  const promos = (cart.promotions ?? []).filter((p) => !(coupon && p.coupon));
  const couponOff = cart.coupon_discount ?? (cart.promotions ?? []).filter((p) => p.coupon).reduce((a, p) => a + p.amount, 0);
  const pct = Math.round((cart.discount_pct || 0) * 100) / 100;
  const line = (key: string, label: string, amount: number, o: { remove?: () => void; what?: string; note?: string | null; tone?: string } = {}) => (
    <div key={key} className={cx('flex items-start gap-2', o.tone)}>
      <span className="min-w-0 flex-1">
        <span className="block truncate">{label}</span>
        {o.note ? <span className="block truncate text-[11px] opacity-80">{o.note}</span> : null}
      </span>
      <span className="font-mono tabular-nums">−{formatMoney(amount)}</span>
      {o.remove ? (
        <button type="button" aria-label={t('pos.adj.remove', { what: o.what ?? label })} disabled={busy} onClick={o.remove} className="-my-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-[6px] text-white/70 hover:bg-white/10">
          <Icon name="x" size={14} />
        </button>
      ) : null}
    </div>
  );
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-col gap-1 text-[13px] text-pos-bar-ink" aria-label={t('pos.discounts')}>
        <div className="flex justify-between gap-2">
          <span>{t('pos.subtotal')}</span>
          <span className="font-mono tabular-nums">{formatMoney(cart.subtotal)}</span>
        </div>
        {promos.map((p) => line(`p${p.id}`, p.label, p.amount))}
        {coupon
          ? cart.coupon && !cart.coupon.valid
            ? (
                <div className="flex items-start gap-2 text-[#fca5a5]">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{t('pos.adj.couponOff', { code: coupon })}</span>
                    <span className="block text-[11px]">{couponMessage(t, cart.coupon.reason, cart.coupon.message)}</span>
                  </span>
                  <button type="button" aria-label={t('pos.adj.remove', { what: t('pos.adj.coupon', { code: coupon }) })} disabled={busy} onClick={onRemoveCoupon} className="flex h-6 w-6 shrink-0 items-center justify-center rounded-[6px] text-white/70 hover:bg-white/10">
                    <Icon name="x" size={14} />
                  </button>
                </div>
              )
            : line('coupon', t('pos.adj.coupon', { code: coupon }), couponOff, { remove: onRemoveCoupon })
          : null}
        {discountTyped && cart.discount > 0
          ? line('discount', cart.discount_type === 'amount' || !pct ? t('pos.adj.discount') : t('pos.adj.discountPct', { n: pct }), cart.discount, { remove: onRemoveDiscount, what: t('pos.adj.discount'), note: discountReason })
          : null}
        {cart.points_discount ? line('points', t('pos.pay.points', { n: cart.points_redeemed ?? 0 }), cart.points_discount) : null}
        {repricing ? <span className="text-[11px] opacity-80">{t('pos.adj.repricing')}</span> : null}
      </div>
      <div className="flex gap-2">
        <button type="button" disabled={busy || !mayDiscount} title={mayDiscount ? undefined : t('pos.adj.noDiscount')} onClick={onAddDiscount} className="flex h-touch flex-1 items-center justify-center gap-1.5 rounded-[10px] bg-white/[.08] text-[13px] font-bold hover:bg-white/[.14] disabled:opacity-45">
          <Icon name="tag" size={15} />
          {t('pos.adj.addDiscount')}
        </button>
        {mayCoupon ? (
          <button type="button" disabled={busy || offline} title={offline ? t('pos.adj.offline') : undefined} onClick={onAddCoupon} className="flex h-touch flex-1 items-center justify-center gap-1.5 rounded-[10px] bg-white/[.08] text-[13px] font-bold hover:bg-white/[.14] disabled:opacity-45">
            <Icon name="ticket" size={15} />
            {t('pos.adj.addCoupon')}
          </button>
        ) : null}
      </div>
      {offline && mayCoupon ? <p className="text-[11px] text-pos-bar-ink">{t('pos.adj.offline')}</p> : null}
    </div>
  );
}

/** A gift voucher's balance as WorkSuite answered it: with its expiry, or why it cannot be used. */
function VoucherLine({ v, currency }: { v: Balances['vouchers'][string]; currency: string }) {
  const t = useT();
  if (!v) return <p className="text-[13px] text-ink-2">{t('pos.pay.voucherNone')}</p>;
  if (!v.usable) return <p className="text-[13px] text-danger">{t('pos.pay.voucherUnusable', { why: v.problem ?? t('pos.pay.voucherSpent') })}</p>;
  const until = expiryOf(v.expires_on);
  return <p className="text-[13px] text-ink-2">{until ? t('pos.pay.voucherBalanceUntil', { n: formatMoney(v.balance, currency), date: until }) : t('pos.pay.voucherBalance', { n: formatMoney(v.balance, currency) })}</p>;
}

/**
 * The sale is done: the change to give, the receipt — printed again, or e-mailed once WorkSuite has the sale (where
 * it can) — where the sale stands with WorkSuite, the receipt on screen, and a new sale.
 */
function Complete({ done, currency, onDone }: { done: { sale: PosSale; queued: boolean; printed: PosPrintOutcome | null }; currency: string; onDone: () => void }) {
  const t = useT();
  const till = useTillContext();
  const sale = done.sale;
  const [busy, setBusy] = useState<string | null>(null);
  const [emailing, setEmailing] = useState(false);
  const [to, setTo] = useState(sale.customer?.email ?? '');
  const mayEmail = sale.state === 'sent' && !till.offline && !!(till.caps.email_receipt || till.caps.email);
  const bad = !!to.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to.trim());

  async function run(what: string, fn: () => Promise<{ ok?: boolean; message: string }>) {
    setBusy(what);
    try {
      const o = await fn();
      toast(o.ok === false ? 'warning' : 'success', o.message);
      if (what === 'email') setEmailing(false);
    } catch (e) {
      toast('error', e instanceof Error ? e.message : 'That did not work.');
    } finally {
      setBusy(null);
    }
  }

  const tile = (id: string, label: string, icon: string, onClick: () => void, o: { on?: boolean; disabled?: boolean; title?: string } = {}) => (
    <button key={id} type="button" disabled={o.disabled} title={o.title} onClick={onClick} className={cx('flex h-20 flex-col items-center justify-center gap-1.5 rounded-pos text-ink disabled:opacity-40', o.on ? ON : 'bg-pos-key hover:brightness-95')}>
      {busy === id ? <Icon name="spinner" size={20} className="animate-spin" /> : <Icon name={icon} size={20} />}
      <span className="text-[13px] font-bold">{label}</span>
    </button>
  );

  return (
    <PosDialog label={t('pos.done.title')} width={980} className="h-[min(640px,100%)] flex-row">
      <div className="flex min-w-0 flex-1 flex-col gap-[18px] overflow-y-auto p-9 scroll-thin">
        <span className="flex h-16 w-16 items-center justify-center rounded-full bg-success-bg text-success">
          <Icon name="check" size={32} strokeWidth={2.2} />
        </span>
        <div>
          <h2 className="text-[26px] font-extrabold">{t('pos.done.title')}</h2>
          <p className="mt-1 text-[14px] text-ink-3">{[sale.ref, formatMoney(sale.totals.total, currency), sale.customer?.name].filter(Boolean).join(' · ')}</p>
          {sale.loyalty && (sale.loyalty.earned || sale.loyalty.balance != null) ? (
            <p className="mt-1 text-[14px] font-semibold text-primary">
              {[
                sale.loyalty.earned ? t('pos.done.earned', { name: sale.customer?.name ?? t('pos.customer'), n: sale.loyalty.earned }) : null,
                sale.loyalty.balance != null ? t('pos.done.balance', { n: sale.loyalty.balance }) : null,
                sale.loyalty.tier ?? sale.customer?.tier ?? null,
              ]
                .filter(Boolean)
                .join(' · ')}
            </p>
          ) : sale.customer?.id && done.queued ? (
            <p className="mt-1 text-[13px] text-ink-3">{t('pos.done.pointsLater')}</p>
          ) : null}
        </div>
        <div className="flex items-baseline justify-between rounded-[18px] bg-pos-change px-6 py-5 text-pos-change-ink">
          <span className="text-[20px] font-extrabold">{sale.change_given ? t('pos.done.giveChange') : t('pos.done.noChange')}</span>
          <span className="font-mono text-[44px] font-bold tabular-nums">{formatMoney(sale.change_given)}</span>
        </div>
        <div className="text-[13px] font-bold text-ink-2">{t('pos.receipt')}</div>
        <div className="grid grid-cols-5 gap-2.5">
          {tile('print', t('pos.print'), 'printer', () => void run('print', () => printReceipt(sale.ref, false)), { on: true })}
          {tile('email', t('pos.done.email'), 'mail', () => setEmailing((v) => !v), { disabled: !mayEmail, title: mayEmail ? undefined : t('pos.done.emailLater') })}
          {tile('drawer', t('pos.openDrawer'), 'box', () => void run('drawer', openDrawer))}
        </div>
        {emailing ? (
          <div className="flex gap-2">
            <input
              autoFocus
              aria-label={t('pos.emailTo')}
              placeholder={t('pos.emailTo')}
              inputMode="email"
              value={to}
              maxLength={150}
              onChange={(e) => setTo(e.target.value)}
              className="h-touch-md min-w-0 flex-1 rounded-[12px] bg-pos-panel px-3.5 text-[15px] shadow-[inset_0_0_0_1px_#cbd5e1] outline-none focus:shadow-[inset_0_0_0_2px_var(--pos-on-ring)]"
            />
            <PosButton tone="primary" className="h-touch-md px-6" disabled={bad || !to.trim() || busy === 'email'} onClick={() => void run('email', () => emailReceipt(sale.ref, to.trim()))}>
              {t('pos.send')}
            </PosButton>
          </div>
        ) : (
          <p className="text-[12px] text-ink-3">{[sale.customer?.email, sale.customer?.phone].filter(Boolean).join(' · ') || (mayEmail ? '' : t('pos.done.emailLater'))}</p>
        )}
        {done.printed ? <p className={cx('text-[12px]', done.printed.ok ? 'text-ink-3' : 'text-warning')}>{done.printed.message}</p> : null}
        {sale.priced_by === 'estimate' ? <p className="text-[12px] text-ink-3">{t('pos.provisional')}</p> : null}
        <div className="mt-auto flex items-center gap-2.5">
          <div className={cx('flex flex-1 items-center gap-2 text-[13px]', done.queued ? 'text-warning-ink' : 'text-success')}>
            <span className={cx('h-2 w-2 shrink-0 rounded-full', done.queued ? 'bg-warning' : 'bg-[#22C55E]')} />
            {done.queued ? t('pos.saleQueued', { ref: sale.ref }) : sale.number ? t('pos.done.sentOrder', { n: sale.number }) : t('pos.done.sent')}
          </div>
          <PosButton tone="primary" autoFocus className="h-touch-xl w-[260px] rounded-pos-lg text-[18px] font-extrabold" onClick={onDone}>
            {t('pos.newSale')}
          </PosButton>
        </div>
      </div>
      <div className="flex w-[320px] shrink-0 items-start justify-center overflow-y-auto bg-pos-key py-6 scroll-thin max-lg:hidden">
        <ReceiptPreview sale={sale} till={till.status.till?.terminal.name ?? null} />
      </div>
    </PosDialog>
  );
}
