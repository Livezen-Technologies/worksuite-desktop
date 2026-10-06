import { useState } from 'react';
import type { PosProduct } from '@shared/pos';
import { Icon } from '../../components/Icon';
import { cx, initials } from '../../components/ui';
import { toast } from '../../core/toasts';
import type { CartPrice } from './api';
import { activeSale, cartActions, itemCount, MAX_OPEN, useCarts, type CartState } from './cart';
import { useT } from './i18n';
import { BADGE } from './look';
import { who } from './OpenSales';
import { PosButton, useTillContext } from './parts';
import { deductionOf, formatMoney } from './pricing';

/**
 * The counter's right side: the open sales on this till as tabs (a new one, all of them), the customer on the sale
 * on screen, its lines with their quantities, what the price stands on (WorkSuite's, or the catalogue's preview), the
 * totals and the big total, and Cash exact / Pay. Phase 2: the CRM customer's tier and points, each promotion and the
 * points spent as lines of the totals, and a discount waiting for a manager's approval (Pay waits with it).
 */
const clock = (iso: string) => new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });

export default function CartPane({
  price,
  byId,
  currency,
  totalOf,
  canSell,
  onCustomer,
  needsApproval = false,
  approvedBy = null,
  onApproval,
  onPay,
  onCashExact,
  onOpenSales,
}: {
  price: CartPrice;
  byId: Map<number, PosProduct>;
  currency: string;
  totalOf: (c: CartState) => number | null;
  canSell: boolean;
  onCustomer: () => void;
  /** The discount typed is past the cashier's rights and no manager has approved it yet. */
  needsApproval?: boolean;
  /** A manager approved the discount (their name). */
  approvedBy?: string | null;
  onApproval?: () => void;
  onPay: () => void;
  onCashExact: () => void;
  onOpenSales: () => void;
}) {
  const t = useT();
  const till = useTillContext();
  const s = useCarts();
  const sale = activeSale(s);
  const cart = sale.cart;
  const [selected, setSelected] = useState<number | null>(null);
  const session = till.session;
  const n = s.sales.findIndex((x) => x.id === sale.id) + 1;
  const total = price.cart?.total ?? null;
  const payable = !!session && canSell && !!price.cart && !price.error && !price.pending && cart.lines.length > 0 && !needsApproval;
  const c = price.cart;
  const promos = c?.promotions ?? [];

  const hint: { tone: 'ok' | 'info' | 'warn' | 'danger'; text: string } | null = price.error
    ? { tone: 'danger', text: price.error }
    : !cart.lines.length
      ? null
      : !canSell
        ? { tone: 'warn', text: t('pos.mayNotSell') }
        : price.pending
          ? { tone: 'info', text: t('pos.pricing') }
          : price.source === 'server'
            ? { tone: 'ok', text: t('pos.priceServer') }
            : { tone: 'warn', text: t('pos.priceEstimate') };
  const HINT = { ok: 'bg-success-bg text-success', info: 'bg-pos-on text-primary', warn: 'bg-warning-bg text-warning-ink', danger: 'bg-danger-bg text-danger' };

  return (
    <aside aria-label={t('pos.cart')} className="flex w-[560px] shrink-0 flex-col border-l border-pos-line bg-pos-panel max-xl:w-[440px]">
      <div role="tablist" aria-label={t('pos.open.tabs')} className="flex items-stretch gap-1.5 border-b border-pos-line bg-subtle px-3 pt-2.5">
        {s.sales.map((x, i) => {
          const on = x.id === sale.id;
          return (
            <button
              key={x.id}
              type="button"
              role="tab"
              aria-selected={on}
              title={`Ctrl+${i + 1}`}
              onClick={() => cartActions.switchTo(x.id)}
              className={cx('flex h-[50px] min-w-0 flex-1 basis-0 items-center gap-2 rounded-t-[10px] px-2.5 text-left text-ink', on ? 'bg-pos-panel shadow-[inset_0_3px_0_var(--ws-indigo)]' : 'opacity-80 hover:bg-pos-panel/60')}
            >
              <span className={cx('flex h-6 w-6 shrink-0 items-center justify-center rounded-[7px] text-[12px] font-extrabold', on ? 'bg-primary text-white' : 'bg-pos-line text-ink-2')}>{i + 1}</span>
              <span className="flex min-w-0 flex-col leading-tight">
                <span className="truncate text-[12px] font-bold">{who(x.cart, t('pos.walkIn'))}</span>
                <span className="truncate font-mono text-[11px] font-bold opacity-80">{formatMoney(on ? total : totalOf(x.cart))}</span>
              </span>
            </button>
          );
        })}
        <button
          type="button"
          aria-label={t('pos.newSale')}
          title={`${t('pos.newSale')} (Ctrl+N)`}
          disabled={s.sales.length >= MAX_OPEN && s.sales.every((x) => x.cart.lines.length > 0)}
          onClick={() => {
            if (!cartActions.newSale()) toast('warning', t('pos.open.full', { n: MAX_OPEN }));
          }}
          className="mb-1.5 flex w-touch shrink-0 items-center justify-center rounded-[10px] bg-pos-panel text-primary shadow-[inset_0_0_0_1px_var(--pos-line)] disabled:opacity-40"
        >
          <Icon name="plus" size={22} />
        </button>
        <button type="button" aria-label={t('pos.open.all')} title={t('pos.open.all')} onClick={onOpenSales} className="mb-1.5 flex w-touch shrink-0 items-center justify-center rounded-[10px] bg-pos-panel text-ink shadow-[inset_0_0_0_1px_var(--pos-line)]">
          <Icon name="grid" size={18} />
        </button>
      </div>

      <div className="flex items-center gap-3 border-b border-pos-line/60 px-5 py-3">
        <span className={cx('flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-[14px] font-extrabold', cart.customer ? BADGE.gold : 'bg-pos-tint-slate text-ink-2')}>{cart.customer ? initials(who(cart, '')) : 'WI'}</span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[14px] font-bold">{cart.customer ? who(cart, '') : t('pos.walkIn')}</div>
          <div className="truncate text-[12px] text-ink-3">
            {cart.customer
              ? [cart.customer.tier, typeof cart.customer.points === 'number' && till.caps.loyalty ? t('pos.cust.points', { n: cart.customer.points }) : null, cart.customer.phone, cart.customer.email].filter(Boolean).join(' · ') || t('pos.custNoContact')
              : t('pos.custNone')}
          </div>
        </div>
        <button type="button" onClick={onCustomer} className="h-10 shrink-0 rounded-[10px] bg-pos-key px-3.5 text-[13px] font-semibold text-primary hover:brightness-95">
          {cart.customer ? t('pos.changeCustomer') : t('pos.addCustomer')}
        </button>
      </div>
      <div className="flex justify-between px-5 pt-2 pb-1 text-[12px] text-ink-3">
        <span>{t('pos.saleInfo', { n, of: s.sales.length, items: itemCount(cart) })}</span>
        <span>{cart.lines.length ? t('pos.started', { at: clock(sale.started_at) }) : ''}</span>
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-3 scroll-thin">
        {cart.lines.length === 0 && !session ? (
          <div className="flex flex-col items-center gap-3 py-8 text-center" role="status">
            <Icon name="banknote" size={28} className="text-warning" />
            <p className="max-w-[360px] text-[13.5px] font-semibold text-ink">{t('pos.noDrawer')}</p>
            <PosButton tone="primary" className="h-touch-md px-5" onClick={() => till.go('shift')}>
              {t('pos.openShift')}
            </PosButton>
          </div>
        ) : cart.lines.length === 0 ? (
          <p className="py-8 text-center text-[13px] text-ink-3">{t('pos.cartEmpty')}</p>
        ) : null}
        {cart.lines.map((l) => {
          const p = byId.get(l.product_id);
          const priced = price.cart?.lines.find((x) => x.product_id === l.product_id);
          const name = p?.name ?? `#${l.product_id}`;
          const on = selected === l.product_id;
          return (
            <div
              key={l.product_id}
              onClick={() => setSelected(on ? null : l.product_id)}
              className={cx('flex items-center gap-3 rounded-[10px] border-b border-pos-line/60 px-2 py-[9px]', on && 'bg-pos-on')}
            >
              <div className="min-w-0 flex-1">
                <div className="truncate text-[14px] font-semibold">{name}</div>
                <div className="truncate text-[12px] text-ink-3">{t('pos.each', { price: formatMoney(priced?.unit_price ?? p?.price) })}</div>
              </div>
              <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                <button type="button" aria-label={`One fewer ${name}`} onClick={() => cartActions.qty(l.product_id, l.quantity - 1)} className="flex h-9 w-9 items-center justify-center rounded-[8px] bg-pos-key text-[18px] text-ink">
                  −
                </button>
                <input
                  aria-label={`${t('pos.qty')} ${name}`}
                  inputMode="decimal"
                  value={String(l.quantity)}
                  onFocus={(e) => e.target.select()}
                  onChange={(e) => cartActions.qty(l.product_id, Number(e.target.value.replace(/[^\d.]/g, '')) || 0)}
                  className="h-9 w-10 rounded-[6px] bg-transparent text-center font-mono text-[15px] font-bold outline-none focus:bg-pos-key"
                />
                <button type="button" aria-label={`One more ${name}`} onClick={() => cartActions.add(l.product_id)} className="flex h-9 w-9 items-center justify-center rounded-[8px] bg-pos-key text-[18px] text-ink">
                  +
                </button>
              </div>
              <div className="w-[118px] text-right">
                <div className="font-mono text-[14px] font-bold">{formatMoney(priced?.total)}</div>
                {priced?.discount_pct ? <div className="text-[11px] text-warning">{t('pos.lineDiscount', { n: priced.discount_pct })}</div> : null}
              </div>
              {on ? (
                <button
                  type="button"
                  aria-label={t('pos.remove')}
                  onClick={(e) => {
                    e.stopPropagation();
                    cartActions.remove(l.product_id);
                  }}
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[8px] bg-danger-bg text-danger"
                >
                  <Icon name="trash" size={16} />
                </button>
              ) : null}
            </div>
          );
        })}
        {hint ? <div className={cx('mx-2 my-1.5 rounded-[10px] px-3 py-2 text-[12px]', HINT[hint.tone])}>{hint.text}</div> : null}
        {needsApproval ? (
          <div className="mx-2 my-1.5 flex items-center gap-3 rounded-[10px] bg-warning-bg px-3 py-2 text-[12px] text-warning-ink">
            <span className="flex-1">{t('pos.ovr.discountWaits', { n: Number(cart.discount) || 0 })}</span>
            <button type="button" className="font-bold underline" onClick={onApproval}>
              {t('pos.ovr.askManager')}
            </button>
          </div>
        ) : approvedBy !== null ? (
          <div className="mx-2 my-1.5 rounded-[10px] bg-success-bg px-3 py-2 text-[12px] text-success">{t('pos.ovr.approvedBy', { name: approvedBy })}</div>
        ) : null}
        {c?.notes?.map((n) => (
          <div key={n} className="mx-2 my-1 rounded-[10px] bg-pos-key px-3 py-2 text-[12px] text-ink-2">
            {n}
          </div>
        ))}
        {!session && cart.lines.length ? (
          <div className="mx-2 my-1.5 flex items-center gap-3 rounded-[10px] bg-warning-bg px-3 py-2 text-[12px] text-warning-ink">
            <span className="flex-1">{t('pos.noDrawer')}</span>
            <button type="button" className="font-bold underline" onClick={() => till.go('shift')}>
              {t('pos.openShift')}
            </button>
          </div>
        ) : null}
      </div>

      <div className="flex flex-col gap-1 border-t border-pos-line/60 px-5 pt-2.5 pb-3.5">
        <Line label={t('pos.subtotal')} value={formatMoney(c?.subtotal ?? 0)} />
        {promos.map((p) => (
          <Line key={p.id} label={p.label || t('pos.promotion')} value={`− ${formatMoney(p.amount)}`} tone="text-success" />
        ))}
        {c?.points_discount ? <Line label={t('pos.pay.points', { n: c.points_redeemed ?? 0 })} value={`− ${formatMoney(c.points_discount)}`} tone="text-primary" /> : null}
        {promos.length || c?.points_discount ? (
          c?.discount ? <Line label={t('pos.discounts')} value={`− ${formatMoney(c.discount)}`} tone="text-warning" /> : null
        ) : (
          <Line label={t('pos.discounts')} value={c && deductionOf(c) ? `− ${formatMoney(deductionOf(c))}` : formatMoney(0)} tone="text-warning" />
        )}
        <Line label={t('pos.tax')} value={formatMoney(price.cart?.tax ?? 0)} />
        <div className="mt-0.5 flex items-baseline justify-between gap-3">
          <span className="text-[16px] font-bold">{t('pos.total')}</span>
          <span className="truncate font-mono text-[30px] font-bold tabular-nums" data-testid="pos-total">
            {formatMoney(total ?? 0, currency)}
          </span>
        </div>
        <div className="mt-1.5 flex gap-2">
          <PosButton className="h-[62px] w-[120px] text-[14px]" disabled={!payable} onClick={onCashExact}>
            {t('pos.cashExact')}
          </PosButton>
          <PosButton tone="primary" className="h-[62px] flex-1 gap-2.5 text-[18px]" disabled={!payable} onClick={onPay}>
            {t('pos.pay')} {price.cart ? formatMoney(price.cart.total, currency) : ''}
            <kbd className="rounded-[4px] border border-white/40 px-1.5 font-mono text-[11px] font-medium">F12</kbd>
          </PosButton>
        </div>
      </div>
    </aside>
  );
}

function Line({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className={cx('flex justify-between text-[13px]', tone ?? 'text-ink-2')}>
      <span>{label}</span>
      <span className="font-mono tabular-nums">{value}</span>
    </div>
  );
}
