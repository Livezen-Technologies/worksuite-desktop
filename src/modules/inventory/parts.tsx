import type { ReactNode } from 'react';
import { Icon } from '../../components/Icon';
import { cx } from '../../components/ui';
import { Empty, Panel } from '../hr/parts';

/** A dashboard panel of rows, or a line saying there are none. */
export function ListPanel({ title, empty, action, children }: { title: string; empty: string; action?: ReactNode; children: ReactNode[] }) {
  return (
    <Panel title={title} action={action} bodyClassName="flex flex-col">
      {children.length ? children : <Empty text={empty} />}
    </Panel>
  );
}

/** One row of such a panel: a title over a line of detail, a figure on the right. */
export function Line({ title, sub, right, rightClass, icon, onClick }: { title: ReactNode; sub?: ReactNode; right?: ReactNode; rightClass?: string; icon?: string; onClick?: () => void }) {
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag {...(onClick ? { type: 'button' as const, onClick } : {})} className={cx('flex items-center gap-2 border-b border-line/60 px-3.5 py-2 text-left last:border-b-0', onClick && 'hover:bg-subtle')}>
      {icon ? <Icon name={icon} size={14} className="shrink-0 text-ink-3" /> : null}
      <span className="flex min-w-0 flex-1 flex-col">
        <b className="truncate text-[12.5px] text-ink">{title}</b>
        {sub ? <span className="truncate text-[11.5px] text-ink-3">{sub}</span> : null}
      </span>
      {right !== undefined && right !== null ? <span className={cx('shrink-0 text-[12px] font-bold whitespace-nowrap tabular-nums', rightClass ?? 'text-ink')}>{right}</span> : null}
    </Tag>
  );
}

/** A small link-styled button in a panel's header. */
export function HeadLink({ children, onClick, web }: { children: ReactNode; onClick: () => void; web?: boolean }) {
  return (
    <button type="button" className="inline-flex items-center gap-1 text-[12.5px] font-semibold text-primary hover:underline" title={web ? 'Opens in your browser' : undefined} onClick={onClick}>
      {children}
      {web ? <Icon name="external" size={11} /> : null}
    </button>
  );
}

/** A signed quantity, green in and red out. */
export function Signed({ value, text }: { value: number; text: string }) {
  return <span className={cx('font-bold tabular-nums', value > 0 ? 'text-success-ink dark:text-success' : value < 0 ? 'text-danger' : 'text-ink-3')}>{text}</span>;
}

/** A pill: the tracking kind, a status. */
export function Pill({ children, tone }: { children: ReactNode; tone?: 'blue' | 'amber' | 'red' | 'green' | 'grey' }) {
  const c =
    tone === 'blue'
      ? 'bg-selection text-primary dark:bg-selection dark:text-primary'
      : tone === 'amber'
        ? 'bg-warning-bg text-warning-ink dark:bg-warning-bg dark:text-warning'
        : tone === 'red'
          ? 'bg-danger-bg text-danger-ink dark:bg-danger-bg dark:text-danger'
          : tone === 'green'
            ? 'bg-success-bg text-success-ink dark:bg-success-bg dark:text-success'
            : 'bg-subtle text-ink-2 dark:bg-subtle dark:text-ink-2';
  return <span className={cx('inline-flex h-[20px] items-center rounded-[10px] px-2 text-[11px] font-bold whitespace-nowrap', c)}>{children}</span>;
}

/**
 * The width a list needs so its flexible column keeps `flex` pixels beside
 * the fixed ones (each with its 10px gap, and the row's 28px of padding).
 * Narrower than that, the list scrolls sideways rather than squeezing the
 * product name to nothing.
 */
export const minWidth = (flex: number, fixed: number[]) => 28 + flex + fixed.reduce((a, b) => a + b, 0) + 10 * fixed.length;
