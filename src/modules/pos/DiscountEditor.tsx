import { useState, type ReactNode } from 'react';
import { Icon } from '../../components/Icon';
import { cx } from '../../components/ui';
import { checkDiscount, couponCode, couponMessage, type DiscountCheck, type DiscountDraft } from './adjust';
import type { CartLineInput } from './pricing';
import { formatMoney } from './pricing';
import { validateCoupon, type CouponCheck } from './api';
import type { DiscountRights } from './approval';
import { useT } from './i18n';
import { BigAmount, Keypad } from './Keypad';
import { ON, OFF } from './look';
import { press } from './numpad';
import { Note, PosButton, PosDialog } from './parts';

/**
 * The cashier's discount, one editor for both ways to it (#293): the bottom bar's Discount and the payment screen's
 * Add discount. A percentage or — where WorkSuite takes one (`capabilities.discount_amount`) — a fixed amount, typed on
 * the till's pad, an optional reason, the cashier's limit said beside it. What it gives is checked by `checkDiscount`
 * (never more than the sale; past the cashier's rights a manager approves next, where WorkSuite takes approvals), so
 * both entry points give the same result. The caller keeps it on the sale (`cartActions.applyDiscount`) and opens the
 * manager's override when `needsApproval` says so.
 */
export interface DiscountResult extends DiscountCheck {
  draft: DiscountDraft;
}

export function DiscountEditor({
  initial,
  base,
  currency,
  amountOn,
  rights,
  approvals,
  onApply,
  onCancel,
  children,
}: {
  initial: DiscountDraft;
  /** What the discount comes off: the goods after their list discounts and the promotions. */
  base: number;
  currency: string;
  /** A fixed amount may be given (`capabilities.discount_amount`). */
  amountOn: boolean;
  rights: DiscountRights;
  /** A manager can approve past the cashier's rights (`capabilities.approvals`, online). */
  approvals: boolean;
  onApply: (r: DiscountResult) => void;
  onCancel: () => void;
  /** More of the dialog under the reason (the bottom bar's coupon field). */
  children?: ReactNode;
}) {
  const t = useT();
  const [type, setType] = useState<'pct' | 'amount'>(amountOn ? initial.type : 'pct');
  const [value, setValue] = useState(amountOn || initial.type === 'pct' ? initial.value : '');
  const [reason, setReason] = useState(initial.reason);
  const rules = type === 'pct' ? { decimals: 2, digits: 3 } : { decimals: 2, digits: 9 };
  const check = checkDiscount({ type, value }, base, rights, approvals);
  const ceiling = approvals ? null : rights.ceiling;
  const own = rights.allowed ? rights.ceiling : 0;
  const hint =
    type === 'amount'
      ? t('pos.disc.amountHint', { n: formatMoney(base, currency) })
      : approvals
        ? own === 0
          ? t('pos.discountAllApproved')
          : own
            ? t('pos.discountPastApproved', { n: own })
            : t('pos.discountHint')
        : ceiling
          ? t('pos.discountMax', { n: ceiling })
          : t('pos.discountHint');
  const switchTo = (k: 'pct' | 'amount') => {
    if (k === type) return;
    setType(k);
    setValue('');
  };
  const apply = () => onApply({ ...check, draft: { type, value, reason: reason.trim().slice(0, 200) } });
  const label = type === 'amount' ? t('pos.disc.applyAmount', { n: formatMoney(check.amount ?? 0) }) : t('pos.discountApply', { n: check.pct });

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start gap-4">
        <div className="min-w-0 flex-1">
          <h2 className="text-[20px] font-extrabold">{t('pos.discountTitle')}</h2>
          <p className="text-[13px] text-ink-3">{hint}</p>
        </div>
        {amountOn ? (
          <div role="radiogroup" aria-label={t('pos.disc.kind')} className="flex shrink-0 gap-1.5">
            {(['pct', 'amount'] as const).map((k) => (
              <button key={k} type="button" role="radio" aria-checked={type === k} onClick={() => switchTo(k)} className={cx('h-touch rounded-[10px] px-4 text-[14px] font-bold', type === k ? ON : OFF)}>
                {k === 'pct' ? t('pos.disc.percent') : t('pos.disc.amount')}
              </button>
            ))}
          </div>
        ) : null}
      </div>
      <div className="flex gap-4">
        <div className="flex flex-1 flex-col gap-3">
          <BigAmount autoFocus value={value} onChange={(v) => setValue(v)} rules={rules} currency={type === 'amount' ? currency : undefined} aria-label={type === 'pct' ? t('pos.discount') : t('pos.disc.amountLabel')} placeholder="0" />
          {type === 'pct' ? (
            <div className="flex flex-wrap gap-2">
              {[5, 10, 15, 20].filter((n) => !ceiling || n <= ceiling).map((n) => (
                <PosButton key={n} className="h-touch-md flex-1 text-[16px]" onClick={() => setValue(String(n))}>
                  {n}%
                </PosButton>
              ))}
            </div>
          ) : check.amount ? (
            <p className="text-[13px] text-ink-2">{t('pos.disc.share', { pct: check.pct })}</p>
          ) : null}
          <label className="flex flex-col gap-1">
            <span className="text-[13px] font-bold text-ink-2">{t('pos.disc.reason')}</span>
            <input
              value={reason}
              maxLength={200}
              onChange={(e) => setReason(e.target.value)}
              placeholder={t('pos.disc.reasonHint')}
              aria-label={t('pos.disc.reason')}
              className="h-touch rounded-[10px] bg-pos-panel px-3 text-[14px] shadow-[inset_0_0_0_1px_var(--ws-slate-line)] outline-none"
            />
          </label>
          <PosButton tone="danger" className="h-touch-md" onClick={() => setValue('')}>
            {t('pos.discountNone')}
          </PosButton>
        </div>
        <Keypad className="w-[260px]" keys={['7', '8', '9', '4', '5', '6', '1', '2', '3', '.', '0', 'back']} onKey={(k) => setValue((v) => press(v, k, rules))} />
      </div>
      {children}
      {check.error ? <Note tone="danger">{check.error}</Note> : check.needsApproval ? <Note tone="warning">{t('pos.disc.needsManager')}</Note> : null}
      <div className="flex gap-2.5">
        <PosButton className="h-touch-lg w-40" onClick={onCancel}>
          {t('pos.cancel')}
        </PosButton>
        <PosButton tone="primary" className="h-touch-lg flex-1 text-[16px]" disabled={!!check.error} onClick={apply}>
          {label}
        </PosButton>
      </div>
    </div>
  );
}

/** The discount editor in its own dialog: the bottom bar's and the payment screen's. */
export function DiscountDialog(props: Parameters<typeof DiscountEditor>[0]) {
  const t = useT();
  return (
    <PosDialog label={t('pos.discountTitle')} onClose={props.onCancel} width={680} className="gap-4 p-7">
      <DiscountEditor {...props} />
    </PosDialog>
  );
}

/**
 * A coupon (#293): typed, or scanned into the field (a scanner types and presses Enter), then Apply — WorkSuite runs its
 * promotions on the cart (`POST coupons/validate`) and answers what it takes off, or why not in the cashier's words
 * (expired, already used, minimum spend not met, not valid for these items …). One coupon per sale: a new one replaces
 * the one on the sale. It needs WorkSuite, so offline it waits.
 */
export function CouponDialog({
  current,
  lines,
  org,
  customerId,
  offline,
  onApplied,
  onClose,
}: {
  current: string | null;
  lines: CartLineInput[];
  org: number | null;
  customerId: number | null;
  offline: boolean;
  onApplied: (code: string, check: CouponCheck) => void;
  onClose: () => void;
}) {
  const t = useT();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const clean = couponCode(code);
  const ready = clean.length >= 3 && !busy && !offline && lines.length > 0;

  async function apply() {
    if (!ready) return;
    setBusy(true);
    setError(null);
    try {
      const r = await validateCoupon(clean, lines, { org, ...(customerId ? { customer_id: customerId } : {}) });
      if (r.valid) onApplied(r.code || clean, r);
      else setError(couponMessage(t, r.reason, r.message));
    } catch (e) {
      setError(e instanceof Error ? e.message : t('pos.cpn.failed'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <PosDialog label={t('pos.cpn.title')} onClose={busy ? undefined : onClose} width={560} className="gap-4 p-7">
      <div>
        <h2 className="text-[20px] font-extrabold">{t('pos.cpn.title')}</h2>
        <p className="text-[13px] text-ink-3">{t('pos.cpn.hint')}</p>
      </div>
      <div className="flex gap-2">
        <input
          autoFocus
          aria-label={t('pos.cpn.code')}
          placeholder={t('pos.couponHint')}
          value={code}
          maxLength={40}
          disabled={offline}
          onChange={(e) => {
            setCode(couponCode(e.target.value));
            setError(null);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              void apply();
            }
          }}
          className="h-touch-md min-w-0 flex-1 rounded-[12px] bg-pos-panel px-3.5 font-mono text-[16px] text-ink shadow-[inset_0_0_0_1px_var(--ws-slate-line)] outline-none focus:shadow-[inset_0_0_0_2px_var(--pos-on-ring)]"
        />
        <PosButton tone="primary" className="h-touch-md px-6 text-[15px]" disabled={!ready} onClick={() => void apply()}>
          {busy ? <Icon name="spinner" size={16} className="animate-spin" /> : null}
          {t('pos.cpn.apply')}
        </PosButton>
      </div>
      {offline ? <Note tone="warning">{t('pos.cpn.offline')}</Note> : null}
      {current && !offline ? <p className="text-[12px] text-ink-3">{t('pos.cpn.one', { code: current })}</p> : null}
      {error ? <Note tone="danger">{error}</Note> : null}
      <div className="flex justify-end">
        <PosButton className="h-touch-lg w-40" disabled={busy} onClick={onClose}>
          {t('pos.cancel')}
        </PosButton>
      </div>
    </PosDialog>
  );
}
