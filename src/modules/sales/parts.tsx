import { cx } from '../../components/ui';
import { statusOf, type Priority } from './api';

/** An order's status as the design colours it. */
export function StatusPill({ status, label }: { status: string; label?: string | null }) {
  const s = statusOf(status);
  return <span className={cx('inline-flex h-[22px] items-center rounded-[11px] px-2 text-[11.5px] font-bold whitespace-nowrap', s.chip)}>{label || s.label}</span>;
}

/** Normal says nothing; low, high and urgent are marked. */
export function PriorityPill({ priority }: { priority: Priority | string | null | undefined }) {
  if (!priority || priority === 'normal') return <span className="text-[12px] text-ink-3">normal</span>;
  const tone = priority === 'urgent' ? 'bg-[#FFE4E6] text-[#9F1239] dark:bg-danger-bg dark:text-danger' : priority === 'high' ? 'bg-[#FFF4E0] text-[#9A4A06] dark:bg-warning-bg dark:text-warning' : 'bg-subtle text-ink-2';
  return <span className={cx('inline-flex h-[22px] items-center rounded-[11px] px-2 text-[11.5px] font-bold whitespace-nowrap', tone)}>{priority}</span>;
}

const PAY: Record<string, string> = {
  paid: 'bg-[#DCFCE7] text-[#166534] dark:bg-success-bg dark:text-success',
  partial: 'bg-[#FFF4E0] text-[#9A4A06] dark:bg-warning-bg dark:text-warning',
  unpaid: 'bg-[#FFE4E6] text-[#9F1239] dark:bg-danger-bg dark:text-danger',
  overpaid: 'bg-[#E0F2FE] text-[#075985] dark:bg-[#0C2A3D] dark:text-[#7DD3FC]',
};

/**
 * The payment status the order carries. It is only kept up to date for
 * orders from the shop and the till; an order entered by hand stays
 * "unpaid" whatever its invoices say, so it is shown as recorded, not as
 * the truth about the money.
 */
export function PaymentPill({ status }: { status: string | null | undefined }) {
  if (!status) return <span className="text-ink-3">—</span>;
  return <span className={cx('inline-flex h-[22px] items-center rounded-[11px] px-2 text-[11.5px] font-bold whitespace-nowrap', PAY[status] ?? 'bg-subtle text-ink-2')}>{status.replace(/_/g, ' ')}</span>;
}

export { money, moneyFull } from '../crm/parts';
