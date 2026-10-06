import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { PosCustomer, PosPrintOutcome, PosSale, PosTenderMethod } from '@shared/pos';
import { Icon } from '../../components/Icon';
import { cx } from '../../components/ui';
import { toast } from '../../core/toasts';
import { emailReceipt, openDrawer, PK, printReceipt, sell, type PosSession } from './api';
import { publish } from './display';
import { useT, type PosKey } from './i18n';
import { BigAmount, Keypad } from './Keypad';
import { press, typedOf } from './keypad';
import { ON, OFF } from './look';
import { Note, PosButton, PosDialog, useTillContext } from './parts';
import { allowedTenders, formatMoney, quickCash, settle, type PricedCart } from './pricing';
import ReceiptPreview from './ReceiptPreview';
import { buildSale, remaining, tendersOf, type TenderRow } from './tender';

/**
 * Taking the money, in two panes: on the navy side the total, what has been paid so far (each tender, the one being
 * typed ringed), what is still to pay and the change to give; on the other, the tenders this till takes — cash, card,
 * a transfer or a wallet (only cash and the shop's own card machine with WorkSuite out of reach) — the amount on the
 * keypad, the notes a customer is likely to hand over, a card's slip reference, and one button to complete the sale.
 * Change is cash only, as WorkSuite reckons it. Complete hands the sale to the till (numbered, kept, sent), which
 * prints the receipt and opens the drawer when cash was taken; the sale-complete screen follows, with the change, the
 * receipt's options and the receipt itself. Cash exact (`exact`) completes the total in cash at once.
 */
const HINT: Record<PosTenderMethod, PosKey> = { cash: 'pos.pay.cashHint', card: 'pos.pay.cardHint', bank_transfer: 'pos.pay.transferHint', wallet: 'pos.pay.walletHint' };
const ICON: Record<PosTenderMethod, string> = { cash: 'banknote', card: 'credit-card', bank_transfer: 'landmark', wallet: 'wallet' };

export default function Tender({
  cart,
  source,
  currency,
  session,
  customer,
  catalogueVersion,
  exact = false,
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
  const methods = allowedTenders(!till.offline);
  const denominations = useMemo(() => till.options?.denominations?.[currency] ?? session.denominations ?? [], [till.options, currency, session.denominations]);
  const s = settle(total, tendersOf(rows));
  const shop = till.company?.name ?? null;
  const row = rows[cur] ?? rows[0]!;

  useEffect(() => {
    if (done) publish({ kind: 'paid', shop, currency, total: done.sale.totals.total, paid: s.paid + s.change, change: done.sale.change_given });
  }, [done, shop, currency, s.paid, s.change]);

  const quick = useMemo(() => (row.method === 'cash' ? quickCash(remaining(total, rows, cur), denominations) : []), [total, rows, cur, row.method, denominations]);

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

  async function complete(using = rows) {
    const input = buildSale({ session_id: session.id, register_id: session.register_id, currency, customer, cart, source, catalogue_version: catalogueVersion }, using);
    if ('error' in input) {
      setError(input.error);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const r = await sell(input);
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

  const who = customer?.name || customer?.email || customer?.phone || t('pos.walkIn');
  const cta = s.overCharged ? t('pos.pay.overCharged') : s.due > 0 ? t('pos.pay.stillDue', { n: formatMoney(s.due) }) : s.change > 0 ? t('pos.pay.completeChange', { n: formatMoney(s.change) }) : t('pos.complete');

  return (
    <PosDialog label={t('pos.pay.title')} onClose={busy ? undefined : onClose} width={1120} className="h-[min(720px,100%)] flex-row">
      <div className="flex w-[420px] shrink-0 flex-col gap-3.5 overflow-y-auto bg-pos-bar p-7 text-white scroll-thin max-lg:w-[340px]">
        <div className="truncate text-[13px] text-pos-bar-ink">{t('pos.pay.sale', { who })}</div>
        <div>
          <div className="text-[13px] text-[#cbd5e1]">{t('pos.total')}</div>
          <div className="font-mono text-[34px] font-bold tabular-nums">{formatMoney(total, currency)}</div>
        </div>
        <div className="h-px bg-white/[.14]" />
        <div className="text-[12px] font-bold tracking-[.06em] text-pos-bar-ink uppercase">{t('pos.pay.paidSoFar')}</div>
        {rows.map((r, i) => {
          const on = i === cur;
          const v = Number(r.amount.replace(/,/g, '')) || 0;
          return (
            <div key={i} className={cx('flex items-center gap-3 rounded-pos bg-white/[.08] p-3.5', on && 'shadow-[inset_0_0_0_2px_#7FD8DF]')}>
              <button type="button" onClick={() => setCur(i)} aria-label={`${t(`pos.${r.method}` as PosKey)} ${i + 1}`} className="flex min-w-0 flex-1 items-center gap-3 text-left">
                <span className={cx('flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px]', r.method === 'cash' ? 'bg-teal' : 'bg-primary')}>
                  <Icon name={ICON[r.method]} size={18} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[14px] font-bold">{t(`pos.${r.method}` as PosKey)}</span>
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
              aria-label={t(`pos.${m}` as PosKey)}
              onClick={() => choose(m)}
              className={cx('flex h-touch-2xl flex-col items-start justify-center gap-0.5 rounded-pos px-4 text-left text-ink', row.method === m ? ON : OFF)}
            >
              <span className="text-[15px] font-bold">{t(`pos.${m}` as PosKey)}</span>
              <span className="text-[12px] text-ink-3">{t(HINT[m])}</span>
            </button>
          ))}
        </div>
        {till.offline ? <p className="-mt-2 text-[12px] text-ink-3">{t('pos.pay.offlineTenders')}</p> : null}
        <div className="flex min-h-0 flex-1 gap-4">
          <div className="flex min-w-0 flex-1 flex-col gap-2.5">
            <div className="text-[13px] font-bold text-ink-2">{row.method === 'cash' ? t('pos.pay.cashReceived') : t('pos.pay.amountOf', { method: t(`pos.${row.method}` as PosKey) })}</div>
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
            {error ? <Note tone="danger">{error}</Note> : null}
            <p className="mt-auto text-[12px] text-ink-3">{t('pos.pay.cardNote')}</p>
          </div>
          <Keypad className="w-[300px] shrink-0 content-start max-lg:w-[240px]" keys={['7', '8', '9', '4', '5', '6', '1', '2', '3', '00', '0', 'back']} onKey={(k) => set(cur, { amount: press(row.amount, k) })} />
        </div>
        <PosButton tone="primary" className="h-[68px] shrink-0 rounded-pos-lg text-[19px] font-extrabold" disabled={busy || s.due > 0 || s.overCharged} onClick={() => void complete()}>
          {busy ? <Icon name="spinner" size={20} className="animate-spin" /> : <Icon name="check" size={20} />}
          {cta}
        </PosButton>
      </div>
    </PosDialog>
  );
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
