import { code128, code128Encodable } from '@shared/code128';
import { vatRows, type PosSale } from '@shared/pos';
import { usePrintSettings } from './api';
import { useT, type PosKey } from './i18n';
import { formatMoney } from './pricing';

/**
 * The receipt on screen, as the till prints it from its own record of the sale (pos-print.ts `receiptRows`): the
 * shop's lines, the sale, its lines, the totals with the tax by rate, how it was paid, the footer and the receipt
 * number as a barcode — so it can be scanned back at the counter.
 */
export function Barcode({ text, height = 44, module = 2 }: { text: string; height?: number; module?: number }) {
  if (!code128Encodable(text)) return null;
  const widths = code128(text);
  let x = 0;
  const bars: Array<{ x: number; w: number }> = [];
  widths.forEach((w, i) => {
    if (i % 2 === 0) bars.push({ x, w });
    x += w;
  });
  return (
    <svg viewBox={`0 0 ${x} 1`} preserveAspectRatio="none" width={x * module} height={height} className="max-w-full" role="img" aria-label={text}>
      {bars.map((b, i) => (
        <rect key={i} x={b.x} y={0} width={b.w} height={1} fill="#111827" />
      ))}
    </svg>
  );
}

function Pair({ l, r, b }: { l: string; r: string; b?: boolean }) {
  return (
    <div className={`flex justify-between gap-2 ${b ? 'font-bold' : ''}`}>
      <span className="min-w-0 truncate">{l}</span>
      <span className="shrink-0">{r}</span>
    </div>
  );
}

function Rule() {
  return <div className="my-2 border-t border-dashed border-[#6b7280]" />;
}

export default function ReceiptPreview({ sale, till }: { sale: PosSale; till: string | null }) {
  const t = useT();
  const settings = usePrintSettings();
  const head = (settings.data?.header ?? '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean).slice(0, 8);
  const foot = (settings.data?.footer ?? '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean).slice(0, 8);
  const at = new Date(sale.created_at);
  return (
    <div aria-label={t('pos.receipt')} className="flex w-[260px] flex-col gap-[3px] overflow-hidden bg-white px-4 py-[18px] font-mono text-[10.5px] leading-snug text-[#111827] shadow-[0_2px_10px_rgba(0,0,0,.08)]">
      {head.map((l, i) => (
        <div key={i} className={`text-center ${i === 0 ? 'text-[13px] font-bold' : ''}`}>
          {l}
        </div>
      ))}
      {head.length ? <Rule /> : null}
      <Pair l={t('pos.receipt')} r={sale.ref} />
      {sale.number ? <Pair l="Order" r={sale.number} /> : null}
      <Pair l={Number.isNaN(at.getTime()) ? sale.created_at : at.toLocaleString(undefined, { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })} r={till ?? ''} />
      {sale.cashier_name ? <Pair l="Cashier" r={sale.cashier_name} /> : null}
      {sale.customer?.name ? <Pair l={t('pos.customer')} r={sale.customer.name} /> : null}
      <Rule />
      {sale.lines.map((l) => (
        <div key={l.product_id}>
          <div className="truncate">{l.name}</div>
          <Pair l={`  ${l.quantity} x ${formatMoney(l.unit_price)}${l.discount_pct ? ` -${l.discount_pct}%` : ''}`} r={formatMoney(l.net)} />
        </div>
      ))}
      <Rule />
      <Pair l={t('pos.subtotal')} r={formatMoney(sale.totals.subtotal)} />
      {sale.promotions?.map((p, i) => <Pair key={`p${i}`} l={p.label} r={`-${formatMoney(p.amount)}`} />)}
      {sale.points?.discount ? <Pair l={t('pos.pay.points', { n: sale.points.redeemed })} r={`-${formatMoney(sale.points.discount)}`} /> : null}
      {sale.totals.discount - (sale.promotions ?? []).reduce((a, p) => a + p.amount, 0) - (sale.points?.discount ?? 0) > 0.004 ? (
        <Pair l={t('pos.discounts')} r={`-${formatMoney(Math.round((sale.totals.discount - (sale.promotions ?? []).reduce((a, p) => a + p.amount, 0) - (sale.points?.discount ?? 0)) * 100) / 100)}`} />
      ) : null}
      {vatRows(sale.lines, sale.totals.tax).map((v) => (
        <Pair key={v.label} l={v.label} r={formatMoney(v.amount)} />
      ))}
      <div className="flex justify-between gap-2 text-[13px] font-bold">
        <span>TOTAL {sale.currency}</span>
        <span>{formatMoney(sale.totals.total)}</span>
      </div>
      <Rule />
      {sale.tenders.map((x, i) => (
        <Pair key={i} l={`${t(`pos.${x.method}` as PosKey)}${x.reference ? ` (${x.reference})` : ''}`} r={formatMoney(x.amount)} />
      ))}
      {sale.change_given ? <Pair l={t('pos.change')} r={formatMoney(sale.change_given)} b /> : null}
      {sale.loyalty?.earned ? <Pair l={t('pos.cust.pointsLabel')} r={`+${sale.loyalty.earned}${sale.loyalty.balance != null ? ` = ${sale.loyalty.balance}` : ''}`} /> : null}
      {sale.priced_by === 'estimate' ? (
        <>
          <Rule />
          <div className="text-center">Provisional: priced offline.</div>
        </>
      ) : null}
      {foot.length ? <Rule /> : null}
      {foot.map((l, i) => (
        <div key={i} className="text-center">
          {l}
        </div>
      ))}
      <div className="mt-2.5 flex justify-center">
        <Barcode text={sale.ref} height={40} module={1} />
      </div>
      <div className="text-center text-[10px]">{sale.ref}</div>
    </div>
  );
}
