import type { Heatmap } from '../../api';
import { cx } from '../../../../components/ui';
import { WEEKDAYS_SHORT } from '../../lib/time';

/**
 * W07's "When your audience engages" (SMM-ANL-005): engagement per post published in each hour, Monday to Sunday,
 * 08:00–20:00 on the brand's clock. Intensity is relative to the busiest cell shown; an hour with too little data is
 * hatched, never drawn as "quiet" (WF-12). The best hours, which feed queue suggestions, are outlined.
 */

const HOURS = Array.from({ length: 13 }, (_, i) => 8 + i);
const LONG_DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const HATCH = 'repeating-linear-gradient(45deg, var(--color-line) 0 2px, transparent 2px 6px)';

const hourLabel = (h: number) => `${String(h).padStart(2, '0')}:00`;

export function HeatmapGrid({ heatmap }: { heatmap: Heatmap }) {
  const rows = Array.from({ length: 7 }, (_, d) => heatmap.cells[d] ?? []);
  const shown = rows.flatMap((r) => HOURS.map((h) => r[h] ?? null)).filter((v): v is number => v !== null);
  const max = Math.max(0, ...shown);
  // `best` counts weekdays 1 = Monday … 7 = Sunday, as the queue's slots do.
  const isBest = (d: number, h: number) => (heatmap.best ?? []).some((b) => b.weekday === d + 1 && b.hour === h);

  return (
    <div className="min-w-0 overflow-x-auto scroll-thin">
      <table className="w-full border-separate border-spacing-[3px] text-[10.5px]" aria-label="Engagement per post by weekday and hour">
        <thead>
          <tr>
            <td />
            {HOURS.map((h) => (
              <th key={h} scope="col" className="px-0 pb-0.5 text-left font-medium whitespace-nowrap text-ink-3">
                {h % 2 === 0 ? <span>{hourLabel(h)}</span> : <span className="sr-only">{hourLabel(h)}</span>}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, d) => (
            <tr key={d}>
              <th scope="row" className="w-8 pr-1 text-left font-medium text-ink-3">
                <span aria-hidden>{WEEKDAYS_SHORT[d]}</span>
                <span className="sr-only">{LONG_DAYS[d]}</span>
              </th>
              {HOURS.map((h) => {
                const v = r[h] ?? null;
                const best = isBest(d, h);
                const label = v === null ? 'Not enough data' : `${+v.toFixed(2)} engagements per post${best ? ' · a best time' : ''}`;
                return (
                  <td
                    key={h}
                    title={v === null ? 'Not enough data' : `${WEEKDAYS_SHORT[d]} ${hourLabel(h)} — ${label}`}
                    aria-label={`${LONG_DAYS[d]} ${hourLabel(h)}: ${label}`}
                    className={cx('h-6 min-w-[18px] rounded-[4px]', v === null && 'border border-line', best && 'outline-2 outline-offset-[-1px] outline-primary')}
                    style={v === null ? { backgroundImage: HATCH } : { background: `color-mix(in srgb, var(--ws-indigo) ${max ? Math.round(10 + (v / max) * 85) : 10}%, transparent)` }}
                  />
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-2 text-[12px] text-ink-3">
        Darker = more engagement per post published in that hour (last {heatmap.days || 90} days, {heatmap.timezone}). Used to suggest queue slots.
      </p>
    </div>
  );
}
