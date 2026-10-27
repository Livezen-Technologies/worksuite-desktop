import { cx } from '../../components/ui';
import { statusOf } from './api';

/** An invoice's status as the design colours it, with how late it is when it is late. */
export function StatusChip({ status, late }: { status: string; late?: number }) {
  const s = statusOf(status);
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={cx('inline-flex h-[22px] items-center rounded-[11px] px-2 text-[11.5px] font-bold whitespace-nowrap', s.chip)}>{s.label}</span>
      {late && late > 0 ? <b className="text-[11.5px] text-danger tabular-nums">{late}d</b> : null}
    </span>
  );
}

export { money, moneyFull } from '../../components/ReportKit';
