import { useEffect } from 'react';
import { hideWindowBar } from '../../app/windowChrome';
import { useTabTitle } from '../../core/tab-context';
import { useDisplayState } from './display';
import { useT } from './i18n';
import { Mark } from './parts';
import { formatMoney } from './pricing';

/**
 * The customer display (`/pos/display`), facing the customer: on the navy side the shop and the sale as it is rung
 * up; on the white side what they pay — the total, the tax in it and what the discount saved them — and, once paid,
 * what they paid and their change. It reads nothing but what the counter sends it (display.ts), for the sale on
 * screen, and shows no cashier, drawer or customer details.
 */
export default function CustomerDisplay() {
  const t = useT();
  const s = useDisplayState();
  useTabTitle(t('pos.display'));
  useEffect(() => hideWindowBar(), []);

  const brand = (
    <div className="flex items-center gap-2.5">
      <Mark size={26} />
      <span className="truncate text-[clamp(16px,1.8vw,24px)] font-extrabold">{s.shop ?? ''}</span>
    </div>
  );

  if (s.kind === 'idle') {
    return (
      <div className="drag flex h-full flex-col bg-navy p-[clamp(20px,2.8vw,40px)] text-white">
        {brand}
        <div className="flex flex-1 items-center justify-center text-[clamp(32px,4.5vw,64px)] font-extrabold">{t('pos.cd.welcome')}</div>
      </div>
    );
  }

  return (
    <div className="drag flex h-full overflow-hidden bg-navy text-white">
      <div className="flex min-w-0 flex-[600] flex-col gap-2.5 p-[clamp(20px,2.8vw,40px)]">
        {brand}
        {s.kind === 'cart' ? (
          <ul className="mt-2.5 flex min-h-0 flex-1 flex-col justify-end overflow-hidden text-[clamp(15px,1.7vw,24px)]">
            {s.lines.slice(-12).map((l, i) => (
              <li key={i} className="flex justify-between gap-6 border-b border-white/10 py-[clamp(6px,1vw,12px)]">
                <span className="truncate">
                  {l.quantity} × {l.name}
                </span>
                <span className="shrink-0 font-mono font-bold tabular-nums">{formatMoney(l.total)}</span>
              </li>
            ))}
          </ul>
        ) : (
          <div className="flex flex-1 items-center justify-center text-[clamp(28px,3.6vw,52px)] font-extrabold">{t('pos.cd.thanks')}</div>
        )}
      </div>
      <div className="flex min-w-0 flex-[424] flex-col gap-2.5 bg-white p-[clamp(20px,2.8vw,40px)] text-navy">
        {s.kind === 'cart' ? (
          <>
            <div className="text-[clamp(14px,1.5vw,20px)] text-[#64748b]">{t('pos.cd.youPay')}</div>
            <div className="font-mono text-[clamp(36px,4.6vw,72px)] leading-none font-bold tabular-nums">{formatMoney(s.total)}</div>
            <div className="text-[clamp(13px,1.4vw,18px)] text-[#64748b]">
              {[s.currency, s.tax ? t('pos.cd.taxIn', { n: formatMoney(s.tax) }) : null, s.discount ? t('pos.cd.saved', { n: formatMoney(s.discount) }) : null].filter(Boolean).join(' · ')}
            </div>
            {s.provisional ? <div className="mt-auto text-[clamp(12px,1.2vw,16px)] text-[#64748b]">{t('pos.provisional')}</div> : null}
          </>
        ) : (
          <>
            <div className="text-[clamp(14px,1.5vw,20px)] text-[#64748b]">{t('pos.cd.paid', { n: formatMoney(s.paid, s.currency) })}</div>
            <div className="text-[clamp(14px,1.5vw,20px)] text-[#64748b]">{t('pos.cd.total', { n: formatMoney(s.total, s.currency) })}</div>
            <div className="mt-auto rounded-[16px] bg-[#7FD8DF] px-5 py-4">
              <div className="text-[clamp(16px,1.7vw,22px)] font-bold">{t('pos.cd.change')}</div>
              <div className="font-mono text-[clamp(36px,4.6vw,72px)] leading-none font-bold tabular-nums">{formatMoney(s.change)}</div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
