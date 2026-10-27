import { text } from '../../../../core/i18n';
import { Switch, cx } from '../../../../components/ui';
import { useNow } from '../../../../components/CallKit';
import { DAYS, type HoursDay } from './design';
import { openLine, openState, weekBars, type DayBar } from './hours';

/**
 * The week of business hours as S-10 lays it out (WS-WCHAT X-UI-22, UX-SET-11; HRS-01), shared by Website chats ›
 * Business hours and the Hours tab of a widget's editor: a row a day — its name, an on/off switch and "08:30 to 17:30",
 * or "Closed all day" — the live "Open now · closes 17:30" pill, and "This week" drawn as bars across the day.
 */

/** "Open now · closes 17:30" in green, or when it opens next: worked out from the week being edited, every minute. */
export function OpenNow({ days, zone }: { days: HoursDay[]; zone: string }) {
  const now = useNow(30_000);
  const s = openState(days, zone, new Date(now));
  return (
    <span role="status" className={cx('flex h-[26px] shrink-0 items-center gap-1.5 rounded-[13px] px-2.5 text-[12px] font-bold', s.open ? 'bg-success-bg text-success' : 'bg-subtle text-ink-3')}>
      <span className={cx('h-[7px] w-[7px] rounded-full', s.open ? 'bg-success' : 'bg-ink-3')} aria-hidden />
      {openLine(s)}
    </span>
  );
}

/** Monday to Sunday, each with its switch and times; `problems` marks a day that closes before it opens. */
export function WeekDays({ days, onDay, problems = {}, disabled }: { days: HoursDay[]; onDay: (weekday: number, patch: Partial<HoursDay>) => void; problems?: Partial<Record<number, string>>; disabled?: boolean }) {
  return (
    <ul aria-label="Week" className="overflow-hidden rounded-[12px] border border-line bg-surface">
      {[1, 2, 3, 4, 5, 6, 0].map((w) => {
        const day = days.find((x) => x.weekday === w) ?? { weekday: w, is_open: false, opens_at: '09:00', closes_at: '17:00' };
        const name = DAYS[w]!;
        const wrong = problems[w];
        return (
          <li key={w} className={cx('flex flex-wrap items-center gap-3.5 border-b border-line/70 px-4 py-2.5 text-[13px] last:border-b-0', !day.is_open && 'text-ink-3')}>
            <span className="w-[100px] font-semibold text-ink">{name}</span>
            <Switch label={text('Open on {day}', { day: name })} checked={day.is_open} disabled={disabled} onChange={(v) => onDay(w, { is_open: v })} />
            {day.is_open ? (
              <>
                <input type="time" aria-label={text('{day} opens', { day: name })} disabled={disabled} value={day.opens_at.slice(0, 5)} onChange={(e) => onDay(w, { opens_at: e.target.value })} aria-invalid={wrong ? true : undefined} className={cx('h-8 w-[92px] rounded-[8px] border bg-surface px-2.5 font-mono text-[12.5px] text-ink outline-none focus:border-primary', wrong ? 'border-danger' : 'border-line')} />
                <span className="text-ink-3">to</span>
                <input type="time" aria-label={text('{day} closes', { day: name })} disabled={disabled} value={day.closes_at.slice(0, 5)} onChange={(e) => onDay(w, { closes_at: e.target.value })} aria-invalid={wrong ? true : undefined} className={cx('h-8 w-[92px] rounded-[8px] border bg-surface px-2.5 font-mono text-[12.5px] text-ink outline-none focus:border-primary', wrong ? 'border-danger' : 'border-line')} />
                {wrong ? <span role="alert" className="text-[12px] text-danger">{wrong}</span> : null}
              </>
            ) : (
              <span>Closed all day</span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

const TONE: Record<DayBar['tone'], string> = { usual: 'bg-primary', other: 'bg-primary/55', closed: 'bg-subtle' };

/** "This week": a bar a day across the 24 hours, the usual hours in the brand colour and a day of its own lighter. */
export function WeekChart({ days }: { days: HoursDay[] }) {
  const bars = weekBars(days);
  return (
    <section aria-label="This week" className="flex flex-col gap-2 rounded-[12px] border border-line bg-surface px-4 py-3.5">
      <h2 className="text-[14px] font-bold">This week</h2>
      <div role="img" aria-label={bars.map((b) => b.words).join(', ')} className="flex flex-col gap-0.5 text-[10.5px] text-ink-3">
        {bars.map((b) => (
          <div key={b.weekday} className="flex items-center gap-0.5" data-testid={`week-bar-${b.label}`}>
            <span className="w-[34px] shrink-0">{b.label}</span>
            <span className="relative h-3 flex-1">
              {b.start === null ? (
                <span className={cx('absolute inset-0 rounded-[3px]', TONE.closed)} />
              ) : (
                <span className={cx('absolute top-0 h-3 rounded-[3px]', TONE[b.tone])} style={{ left: `${b.start * 100}%`, width: `${b.span * 100}%` }} data-tone={b.tone} />
              )}
            </span>
          </div>
        ))}
      </div>
      <div className="flex justify-between pl-9 text-[10.5px] text-ink-3" aria-hidden>
        <span>00</span>
        <span>06</span>
        <span>12</span>
        <span>18</span>
        <span>24</span>
      </div>
    </section>
  );
}
