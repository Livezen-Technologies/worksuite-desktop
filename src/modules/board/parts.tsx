import type { ReactNode } from 'react';
import { Chip, cx } from '../../components/ui';
import { dayKey, monthGrid, type Body, type Flag } from './api';

/** NEW / AMENDED against what this person last opened (FR-DX-03). */
export function FlagChip({ flag }: { flag?: Flag }) {
  if (flag === 'NEW') return <Chip tone="success">NEW</Chip>;
  if (flag === 'AMENDED') return <Chip tone="danger">AMENDED</Chip>;
  return null;
}

/** Board / committee filter tabs (FR-DX-01): only bodies the person belongs to. */
export function BodyTabs({ bodies, value, onChange }: { bodies: Body[]; value: number | null; onChange: (id: number | null) => void }) {
  const tab = (id: number | null, label: string) => (
    <button key={id ?? 'all'} type="button" role="tab" aria-selected={value === id} onClick={() => onChange(id)}
      className={cx('h-[28px] rounded-full px-3 text-[12.5px] font-semibold', value === id ? 'bg-primary text-white' : 'border border-line bg-surface text-ink-2 hover:bg-subtle')}>
      {label}
    </button>
  );
  return (
    <div role="tablist" aria-label="Boards and committees" className="flex flex-wrap gap-1.5">
      {tab(null, 'All')}
      {bodies.map((b) => tab(b.id, b.name))}
    </div>
  );
}

export function Panel({ title, action, children, className }: { title: ReactNode; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cx('flex min-h-0 flex-col rounded-[10px] border border-line bg-surface', className)}>
      <header className="flex items-center justify-between gap-2 px-3.5 pt-3 pb-2 text-[13px] font-bold text-ink">
        <h2>{title}</h2>
        {action}
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto px-3.5 pb-3 scroll-thin">{children}</div>
    </section>
  );
}

/** A month with its meeting days marked (D-01 mini calendar, D-03 two-month view). */
export function MonthCal({ year, month, marked, today, selected, onPick }: { year: number; month: number; marked: Set<string>; today: string; selected?: string | null; onPick?: (day: string) => void }) {
  const label = new Date(year, month, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  return (
    <div aria-label={label}>
      <div className="mb-1.5 text-center text-[12.5px] font-bold text-ink">{label}</div>
      <table className="w-full text-center text-[11.5px] tabular-nums">
        <thead>
          <tr className="text-ink-3">{['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d, i) => <th key={i} className="py-1 font-semibold">{d}</th>)}</tr>
        </thead>
        <tbody>
          {monthGrid(year, month).map((w, i) => (
            <tr key={i}>
              {w.map((d, j) => {
                if (!d) return <td key={j} />;
                const key = dayKey(new Date(Date.UTC(year, month, d)).toISOString());
                const has = marked.has(key);
                return (
                  <td key={j} className="p-0.5">
                    <button type="button" disabled={!onPick} onClick={() => onPick?.(key)} aria-label={`${d}${has ? ', meeting' : ''}`}
                      className={cx('h-[26px] w-full rounded-[6px]', key === today ? 'bg-ink text-white' : key === selected ? 'ring-2 ring-primary' : has ? 'bg-[#EEF1FD] font-bold text-primary dark:bg-selection' : 'text-ink-2')}>
                      {d}
                    </button>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Status({ children, tone = 'muted' }: { children: ReactNode; tone?: 'muted' | 'indigo' | 'success' | 'warning' | 'danger' | 'teal' }) {
  return <Chip tone={tone}>{children}</Chip>;
}

export const Muted = ({ children }: { children: ReactNode }) => <p className="text-[12px] text-ink-3">{children}</p>;
