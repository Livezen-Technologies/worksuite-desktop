import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import type { PosCustomer, PosPrintOutcome, PosSale } from '@shared/pos';
import { Button, IconButton, Modal, cx } from '../../components/ui';
import { toast } from '../../core/toasts';
import { openDrawer, PK, printReceipt, sell, type PosSession } from './api';
import { publish } from './display';
import { useT, type PosKey } from './i18n';
import { Note, useTillContext } from './parts';
import { allowedTenders, formatMoney, quickCash, settle, type PricedCart } from './pricing';
import { buildSale, remaining, tendersOf, type TenderRow } from './tender';

/**
 * Taking the money: cash, card, a transfer or a wallet, or several (split); what is still due and the change, as
 * WorkSuite reckons it (only cash is handed back). With WorkSuite out of reach only cash and the shop's own card
 * machine are offered. Complete sale hands the sale to the till (numbered, kept, sent), which prints the receipt and
 * opens the drawer when cash was taken.
 */
export default function Tender({
  cart,
  source,
  currency,
  session,
  customer,
  catalogueVersion,
  onClose,
  onDone,
}: {
  cart: PricedCart;
  source: 'server' | 'estimate';
  currency: string;
  session: PosSession;
  customer: PosCustomer | null;
  catalogueVersion: string | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const t = useT();
  const till = useTillContext();
  const qc = useQueryClient();
  const total = cart.total;
  const [rows, setRows] = useState<TenderRow[]>([{ method: 'cash', amount: total.toFixed(2), reference: '' }]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ sale: PosSale; queued: boolean; printed: PosPrintOutcome | null } | null>(null);
  const methods = allowedTenders(!till.offline);
  const denominations = useMemo(() => till.options?.denominations?.[currency] ?? session.denominations ?? [], [till.options, currency, session.denominations]);
  const s = settle(total, tendersOf(rows));
  const shop = till.company?.name ?? null;

  useEffect(() => {
    if (done) publish({ kind: 'paid', shop, currency, total: done.sale.totals.total, paid: s.paid + s.change, change: done.sale.change_given });
  }, [done, shop, currency, s.paid, s.change]);

  const cashRow = rows.findIndex((r) => r.method === 'cash');
  const quick = useMemo(() => (cashRow >= 0 ? quickCash(remaining(total, rows, cashRow), denominations) : []), [total, rows, cashRow, denominations]);

  const set = (i: number, patch: Partial<TenderRow>) => setRows((rs) => rs.map((r, k) => (k === i ? { ...r, ...patch } : r)));

  async function complete() {
    const input = buildSale({ session_id: session.id, register_id: session.register_id, currency, customer, cart, source, catalogue_version: catalogueVersion }, rows);
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
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <Modal
        title={t('pos.saleDone', { ref: done.sale.ref })}
        width={460}
        footer={
          <>
            <Button icon="printer" onClick={() => void printReceipt(done.sale.ref, false).then((o) => toast(o.ok ? 'success' : 'warning', o.message))}>
              {t('pos.reprint')}
            </Button>
            <Button icon="banknote" onClick={() => void openDrawer().then((o) => toast(o.ok ? 'success' : 'warning', o.message))}>
              {t('pos.openDrawer')}
            </Button>
            <Button variant="primary" autoFocus onClick={onDone}>
              {t('pos.newSale')}
            </Button>
          </>
        }
      >
        <div className="flex flex-col items-center gap-2 py-2 text-center">
          <div className="text-[13px] text-ink-2">{t('pos.change')}</div>
          <div className="text-[40px] leading-none font-extrabold text-ink tabular-nums">{formatMoney(done.sale.change_given, currency)}</div>
          <div className="mt-2 text-[12.5px] text-ink-3">
            {t('pos.receipt')} {done.sale.ref}
            {done.sale.number ? ` · ${done.sale.number}` : ''}
          </div>
          {done.queued ? <Note tone="warning">{t('pos.saleQueued', { ref: done.sale.ref })}</Note> : null}
          {done.sale.priced_by === 'estimate' ? <p className="text-[12px] text-ink-3">{t('pos.provisional')}</p> : null}
          {done.printed ? <p className={cx('text-[12px]', done.printed.ok ? 'text-ink-3' : 'text-warning')}>{done.printed.message}</p> : null}
        </div>
      </Modal>
    );
  }

  return (
    <Modal
      title={`${t('pos.tender')} · ${formatMoney(total, currency)}`}
      width={560}
      onClose={busy ? undefined : onClose}
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            {t('pos.cart')}
          </Button>
          <Button variant="primary" size="lg" icon="check" loading={busy} disabled={s.due > 0 || s.overCharged} onClick={() => void complete()}>
            {t('pos.complete')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        {source === 'estimate' ? <Note tone="warning">{t('pos.provisional')}</Note> : null}
        {rows.map((r, i) => (
          <div key={i} className="flex flex-col gap-2 rounded-[10px] border border-line p-3">
            <div className="flex items-center gap-2">
              <div role="radiogroup" aria-label={`Payment ${i + 1}`} className="flex flex-1 flex-wrap gap-1.5">
                {methods.map((m) => (
                  <button
                    key={m}
                    type="button"
                    role="radio"
                    aria-checked={r.method === m}
                    onClick={() => set(i, { method: m })}
                    className={cx('h-8 rounded-full px-3 text-[12.5px] font-semibold', r.method === m ? 'bg-primary text-white' : 'border border-line bg-surface text-ink hover:bg-subtle')}
                  >
                    {t(`pos.${m}` as PosKey)}
                  </button>
                ))}
              </div>
              {rows.length > 1 ? <IconButton icon="x" label="Remove this payment" onClick={() => setRows((rs) => rs.filter((_, k) => k !== i))} /> : null}
            </div>
            <div className="flex items-center gap-2">
              <input
                aria-label={`${t('pos.amount')} ${i + 1}`}
                inputMode="decimal"
                value={r.amount}
                onChange={(e) => set(i, { amount: e.target.value.replace(/[^\d.,]/g, '').slice(0, 14) })}
                onFocus={(e) => e.target.select()}
                className="h-11 w-44 rounded-[8px] border border-line bg-surface px-3 text-right text-[20px] font-bold text-ink tabular-nums outline-none focus:border-primary"
              />
              {r.method !== 'cash' ? (
                <input
                  aria-label={`${t('pos.reference')} ${i + 1}`}
                  placeholder={t('pos.reference')}
                  value={r.reference}
                  onChange={(e) => set(i, { reference: e.target.value.slice(0, 80) })}
                  className="h-11 min-w-0 flex-1 rounded-[8px] border border-line bg-surface px-3 text-[13px] text-ink outline-none focus:border-primary"
                />
              ) : null}
            </div>
            {r.method === 'cash' && i === cashRow ? (
              <div className="flex flex-wrap gap-1.5">
                {quick.map((v) => (
                  <button key={v} type="button" onClick={() => set(i, { amount: v.toFixed(2) })} className="h-8 rounded-[8px] border border-line bg-surface px-3 text-[13px] font-semibold text-ink tabular-nums hover:bg-subtle">
                    {formatMoney(v)}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        ))}
        <div>
          <Button
            size="sm"
            icon="plus"
            disabled={rows.length >= 4 || s.due <= 0}
            onClick={() => setRows((rs) => [...rs, { method: methods.find((m) => m !== 'cash') ?? 'cash', amount: remaining(total, rs).toFixed(2), reference: '' }])}
          >
            {t('pos.split')}
          </Button>
        </div>
        <div className="grid grid-cols-3 gap-2 rounded-[10px] bg-subtle p-3 text-center">
          <Figure label={t('pos.paid')} value={formatMoney(s.paid + s.change)} />
          <Figure label={t('pos.due')} value={formatMoney(s.due)} tone={s.due > 0 ? 'danger' : undefined} />
          <Figure label={t('pos.change')} value={formatMoney(s.change)} tone={s.change > 0 ? 'success' : undefined} />
        </div>
        {s.overCharged ? <Note tone="danger">A card, transfer or wallet cannot be charged more than the sale.</Note> : null}
        {error ? <Note tone="danger">{error}</Note> : null}
      </div>
    </Modal>
  );
}

function Figure({ label, value, tone }: { label: string; value: string; tone?: 'danger' | 'success' }) {
  return (
    <div>
      <div className="text-[11px] font-bold tracking-[.5px] text-ink-3 uppercase">{label}</div>
      <div className={cx('text-[20px] font-extrabold tabular-nums', tone === 'danger' ? 'text-danger' : tone === 'success' ? 'text-success' : 'text-ink')}>{value}</div>
    </div>
  );
}
