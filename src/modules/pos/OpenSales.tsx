import { useState } from 'react';
import { Icon } from '../../components/Icon';
import { cx, initials } from '../../components/ui';
import { toast } from '../../core/toasts';
import { activeSale, cartActions, itemCount, MAX_OPEN, useCarts, type CartState, type HeldSale } from './cart';
import { useT } from './i18n';
import { ON, OFF } from './look';
import { PosButton, PosDialog, useTillContext } from './parts';
import { formatMoney } from './pricing';

/**
 * The till's open sales and its held ones: every sale open on this till (up to five) to switch to, hold or discard,
 * and a new one; the held sales — parked for up to a day — to recall or discard; and the note a sale is held with.
 * What each comes to is the catalogue's preview (`totalOf`) — the sale on screen is priced by WorkSuite.
 */
const clock = (iso: string) => new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
const minutesSince = (iso: string) => Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60_000));

export function who(c: CartState, walkIn: string): string {
  return c.customer?.name || c.customer?.email || c.customer?.phone || walkIn;
}

export function OpenSalesDialog({ totalOf, onClose }: { totalOf: (c: CartState) => number | null; onClose: () => void }) {
  const t = useT();
  const till = useTillContext();
  const s = useCarts();
  const active = activeSale(s).id;
  const left = MAX_OPEN - s.sales.length;
  const [holding, setHolding] = useState<string | null>(null);
  const cashier = till.session?.cashier;
  // Holding one asks for its note in place of this dialog, then comes back to it.
  if (holding) return <HoldDialog id={holding} onClose={() => setHolding(null)} />;
  return (
    <PosDialog label={t('pos.open.title', { till: till.status.till?.terminal.code ?? '' })} onClose={onClose} width={1080} className="gap-4 p-[26px]">
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="text-[21px] font-extrabold">{t('pos.open.title', { till: till.status.till?.terminal.code ?? '' })}</h2>
          <p className="text-[13px] text-ink-3">{[t('pos.open.count', { n: s.sales.length, max: MAX_OPEN }), cashier, till.session?.register, t('pos.open.display')].filter(Boolean).join(' · ')}</p>
        </div>
        <PosButton className="h-[46px]" onClick={onClose}>
          {t('pos.close')}
        </PosButton>
      </div>
      <div className="grid grid-cols-2 gap-3 overflow-y-auto scroll-thin lg:grid-cols-4">
        {s.sales.map((x, i) => {
          const on = x.id === active;
          const total = totalOf(x.cart);
          const names = x.cart.lines.length ? t('pos.open.lines', { n: x.cart.lines.length }) : t('pos.open.empty');
          return (
            <div key={x.id} className={cx('flex min-h-[250px] flex-col gap-2.5 rounded-[18px] p-4', on ? ON : OFF)}>
              <div className="flex items-center gap-2.5">
                <span className={cx('flex h-[30px] w-[30px] items-center justify-center rounded-[9px] text-[14px] font-extrabold', on ? 'bg-primary text-white' : 'bg-pos-line text-ink-2')}>{i + 1}</span>
                <span className={cx('rounded-full px-2.5 py-[3px] text-[11px] font-extrabold', on ? 'bg-[#DBEAFE] text-[#1E40AF]' : 'bg-pos-key text-ink-2')}>{on ? t('pos.open.now') : t('pos.open.open')}</span>
              </div>
              <div>
                <div className="truncate text-[16px] font-extrabold">{who(x.cart, t('pos.walkIn'))}</div>
                <div className="text-[12px] text-ink-3">{[t('pos.nItems', { n: itemCount(x.cart) }), x.cart.lines.length ? t('pos.started', { at: clock(x.started_at) }) : null].filter(Boolean).join(' · ')}</div>
              </div>
              <div className="font-mono text-[22px] font-bold">{formatMoney(total)}</div>
              <div className="min-h-[34px] text-[12px] text-ink-2">{names}</div>
              <div className="mt-auto flex gap-1.5">
                <PosButton
                  tone={on ? 'quiet' : 'primary'}
                  className={cx('h-touch flex-1 text-[13px] font-extrabold', on && 'bg-pos-panel text-primary shadow-[inset_0_0_0_1px_#c7cde6]')}
                  onClick={() => {
                    cartActions.switchTo(x.id);
                    onClose();
                  }}
                >
                  {on ? t('pos.open.here') : t('pos.open.switch')}
                </PosButton>
                <PosButton className="h-touch px-3 text-[13px]" disabled={!x.cart.lines.length} onClick={() => setHolding(x.id)}>
                  {t('pos.hold')}
                </PosButton>
                <button type="button" aria-label={t('pos.open.discard')} title={t('pos.open.discard')} onClick={() => cartActions.discard(x.id)} className="flex h-touch w-touch items-center justify-center rounded-[10px] bg-danger-bg text-danger hover:brightness-95">
                  <Icon name="trash" size={18} />
                </button>
              </div>
            </div>
          );
        })}
        {left > 0 ? (
          <button
            type="button"
            onClick={() => {
              cartActions.newSale();
              onClose();
            }}
            className="flex min-h-[250px] flex-col items-center justify-center gap-2.5 rounded-[18px] border-2 border-dashed border-[#b8c0d6] bg-pos-ground text-primary hover:bg-pos-key"
          >
            <span className="flex h-touch-md w-touch-md items-center justify-center rounded-pos-lg bg-primary text-white">
              <Icon name="plus" size={28} />
            </span>
            <span className="text-[15px] font-extrabold">{t('pos.newSale')}</span>
            <span className="text-[12px] text-ink-3">{t('pos.open.more', { n: left })}</span>
          </button>
        ) : null}
      </div>
      <div className="grid grid-cols-3 gap-3">
        {(['keep', 'price', 'close'] as const).map((k) => (
          <div key={k} className="rounded-pos bg-pos-key px-3.5 py-3">
            <div className="text-[13px] font-extrabold">{t(`pos.open.rule.${k}`)}</div>
            <div className="mt-0.5 text-[12px] text-ink-2">{t(k === 'keep' && !till.status.can_keep ? 'pos.open.rule.keepMemory' : `pos.open.rule.${k}.text`)}</div>
          </div>
        ))}
      </div>
    </PosDialog>
  );
}

/** Hold a sale: a note on why (optional), then it is parked. */
export function HoldDialog({ id, onClose }: { id: string; onClose: () => void }) {
  const t = useT();
  const [note, setNote] = useState('');
  const hold = () => {
    cartActions.hold(id, note);
    toast('success', t('pos.held.done'));
    onClose();
  };
  return (
    <PosDialog label={t('pos.held.hold')} onClose={onClose} width={520} className="gap-4 p-6">
      <h2 className="text-[20px] font-extrabold">{t('pos.held.hold')}</h2>
      <p className="text-[13px] text-ink-3">{t('pos.held.holdHint')}</p>
      <input
        autoFocus
        value={note}
        maxLength={120}
        onChange={(e) => setNote(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && hold()}
        placeholder={t('pos.held.note')}
        aria-label={t('pos.held.note')}
        className="h-touch-md rounded-[12px] bg-pos-panel px-3.5 text-[15px] shadow-[inset_0_0_0_1px_#cbd5e1] outline-none focus:shadow-[inset_0_0_0_2px_var(--pos-on-ring)]"
      />
      <div className="flex gap-2.5">
        <PosButton className="h-touch-lg w-40" onClick={onClose}>
          {t('pos.cancel')}
        </PosButton>
        <PosButton tone="primary" className="h-touch-lg flex-1 text-[16px]" onClick={hold}>
          {t('pos.hold')}
        </PosButton>
      </div>
    </PosDialog>
  );
}

/** The held sales: recall one onto the counter, or discard it. Those older than a day are gone already. */
export function HeldDialog({ totalOf, onClose }: { totalOf: (c: CartState) => number | null; onClose: () => void }) {
  const t = useT();
  const till = useTillContext();
  const s = useCarts();
  const recall = (h: HeldSale) => {
    if (cartActions.recall(h.id)) onClose();
    else toast('warning', t('pos.open.full', { n: MAX_OPEN }));
  };
  return (
    <PosDialog label={t('pos.held.title')} onClose={onClose} width={900} className="gap-3.5 p-[26px]">
      <div className="flex items-center">
        <div className="min-w-0 flex-1">
          <h2 className="text-[20px] font-extrabold">{[t('pos.held.title'), till.session?.register].filter(Boolean).join(' · ')}</h2>
          <p className="text-[13px] text-ink-3">{t('pos.held.hint')}</p>
        </div>
        <PosButton className="h-touch" onClick={onClose}>
          {t('pos.close')}
        </PosButton>
      </div>
      <div className="flex min-h-0 flex-col gap-3.5 overflow-y-auto scroll-thin">
        {s.held.length === 0 ? <p className="py-6 text-center text-[14px] text-ink-3">{t('pos.held.none')}</p> : null}
        {s.held.map((h, i) => (
          <div key={h.id} className={cx('flex items-center gap-3.5 rounded-pos-lg p-4', i === 0 ? ON : OFF)}>
            <span className="flex h-touch w-touch shrink-0 items-center justify-center rounded-full bg-pos-tint-indigo text-[14px] font-extrabold text-pos-tint-indigo-ink">{initials(who(h.cart, 'W I'))}</span>
            <div className="min-w-0 flex-1">
              <div className="truncate text-[16px] font-bold">{who(h.cart, t('pos.walkIn'))}</div>
              <div className="text-[13px] text-ink-3">{t('pos.nItems', { n: itemCount(h.cart) })}</div>
              {h.note ? <div className="mt-1 truncate text-[12px] text-warning-ink">{h.note}</div> : null}
            </div>
            <div className="text-right">
              <div className="font-mono text-[18px] font-bold">{formatMoney(totalOf(h.cart))}</div>
              <div className="text-[12px] text-ink-3">{t('pos.held.when', { at: clock(h.held_at), n: minutesSince(h.held_at) })}</div>
            </div>
            <PosButton tone="danger" className="h-touch-md" onClick={() => cartActions.discardHeld(h.id)}>
              {t('pos.held.discard')}
            </PosButton>
            <PosButton tone="primary" className="h-touch-md px-[22px] text-[15px] font-extrabold" onClick={() => recall(h)}>
              {t('pos.held.recall')}
            </PosButton>
          </div>
        ))}
      </div>
      <p className="text-[12px] text-ink-3">{t('pos.held.expiry')}</p>
    </PosDialog>
  );
}
