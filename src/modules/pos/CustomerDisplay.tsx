import { useEffect } from 'react';
import { hideWindowBar } from '../../app/windowChrome';
import { useTabTitle } from '../../core/tab-context';
import { useDisplayState } from './display';
import { useT } from './i18n';
import { formatMoney } from './pricing';

/**
 * The customer display (`/pos/display`): the cart as it is rung up, the total, then what was paid and the change. It
 * reads nothing but what the register sends it (display.ts), and shows no cashier, drawer or customer details.
 */
export default function CustomerDisplay() {
  const t = useT();
  const s = useDisplayState();
  useTabTitle(t('pos.display'));
  useEffect(() => hideWindowBar(), []);

  return (
    <div className="drag flex h-full flex-col bg-navy text-white">
      <header className="px-10 pt-8 text-[22px] font-bold text-white/80">{s.shop ?? ''}</header>
      {s.kind === 'idle' ? (
        <div className="flex flex-1 items-center justify-center text-[44px] font-extrabold">Welcome</div>
      ) : s.kind === 'paid' ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-4">
          <div className="text-[28px] text-white/80">{t('pos.total')} {formatMoney(s.total, s.currency)}</div>
          <div className="text-[28px] text-white/80">{t('pos.paid')} {formatMoney(s.paid, s.currency)}</div>
          <div className="text-[64px] leading-none font-extrabold">
            {t('pos.change')} {formatMoney(s.change, s.currency)}
          </div>
          <div className="mt-6 text-[26px] text-white/70">Thank you</div>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col gap-4 px-10 pb-8">
          <ul className="min-h-0 flex-1 overflow-hidden text-[24px]">
            {s.lines.slice(-12).map((l, i) => (
              <li key={i} className="flex justify-between gap-6 border-b border-white/10 py-2">
                <span className="truncate">
                  {l.quantity !== 1 ? `${l.quantity} × ` : ''}
                  {l.name}
                </span>
                <span className="tabular-nums">{formatMoney(l.total)}</span>
              </li>
            ))}
          </ul>
          <div className="flex flex-col gap-1 text-[24px] text-white/80">
            {s.discount ? (
              <div className="flex justify-between">
                <span>{t('pos.discount')}</span>
                <span className="tabular-nums">−{formatMoney(s.discount)}</span>
              </div>
            ) : null}
            <div className="flex justify-between">
              <span>{t('pos.tax')}</span>
              <span className="tabular-nums">{formatMoney(s.tax)}</span>
            </div>
          </div>
          <div className="flex items-baseline justify-between text-[56px] leading-none font-extrabold">
            <span>{t('pos.total')}</span>
            <span className="tabular-nums">{formatMoney(s.total, s.currency)}</span>
          </div>
          {s.provisional ? <div className="text-[16px] text-white/60">{t('pos.provisional')}</div> : null}
        </div>
      )}
    </div>
  );
}
