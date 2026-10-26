/**
 * W03 month and list views and the D01 week view (SMM-SCH-002, SMM-SCH-004): posts as chips coloured by status, moved
 * by HTML5 drag and drop. The screen decides whether a drop is allowed (WF-08); these only draw and report it.
 */
import { useState, type CSSProperties, type DragEvent } from 'react';
import { cx } from '../../../../components/ui';
import { Icon } from '../../../../components/Icon';
import { postNetworks } from '../../api';
import { NetChip, NetChips, PostStatusPill } from '../../parts';
import { CALENDAR_BUCKETS, TONE_CLASS, TONE_SOLID, type CalendarBucket } from '../../lib/status';
import { excerpt } from '../../lib/text';
import { hhmm, WEEKDAYS_SHORT } from '../../lib/time';
import { dayHead, dayLong, DRAG_TYPE, HOUR_PX, minutesAt, readDrag, WEEK_FROM, WEEK_TO, writeDrag, type DragPayload, type Placed } from './calendar-model';
import { clickOnKey } from '../../../../components/press';

const TONE_OF = Object.fromEntries(CALENDAR_BUCKETS.map((b) => [b.id, b.tone])) as Record<CalendarBucket, (typeof CALENDAR_BUCKETS)[number]['tone']>;

export interface ViewProps {
  days: string[];
  byDay: Map<string, Placed[]>;
  today: string;
  /** "Brand clock" for a post's hover title, or null. */
  hoverOf: (p: Placed) => string | null;
  onOpen: (postId: number) => void;
  onCompose: (ymd: string) => void;
  /** A drop on a day; `minutes` is the time in the week grid, null in the month (keep the time of day). */
  onDrop: (drag: DragPayload, ymd: string, minutes: number | null) => void;
  canCompose: boolean;
}

const accepts = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).some((t) => t === DRAG_TYPE || t === 'text/plain');

function useDropTarget(onDrop: (drag: DragPayload, e: DragEvent<HTMLElement>) => void) {
  const [over, setOver] = useState(false);
  return {
    over,
    handlers: {
      onDragOver: (e: DragEvent<HTMLElement>) => {
        if (!accepts(e)) return;
        e.preventDefault();
        if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
        if (!over) setOver(true);
      },
      onDragLeave: () => setOver(false),
      onDrop: (e: DragEvent<HTMLElement>) => {
        e.preventDefault();
        setOver(false);
        const d = readDrag(e.dataTransfer);
        if (d) onDrop(d, e);
      },
    },
  };
}

/** One post on the grid: network chip, time, a line of text. */
export function PostChip({ p, onOpen, hover, className, style }: { p: Placed; onOpen: (id: number) => void; hover: string | null; className?: string; style?: CSSProperties }) {
  const nets = postNetworks(p.post);
  const text = p.post.internal_title || excerpt(p.post.base_text, 60);
  return (
    <button
      type="button"
      draggable
      onDragStart={(e) => writeDrag(e.dataTransfer, { kind: 'post', id: p.post.id })}
      onClick={(e) => {
        e.stopPropagation();
        onOpen(p.post.id);
      }}
      title={[hover, excerpt(p.post.base_text, 200)].filter(Boolean).join('\n')}
      aria-label={`${hhmm(p.minutes)} ${text}`}
      className={cx('flex w-full min-w-0 items-center gap-1 rounded-[6px] px-1 py-[3px] text-left text-[11.5px] font-medium', TONE_CLASS[TONE_OF[p.bucket]], className)}
      style={style}
    >
      {nets[0] ? <NetChip network={nets[0]} size={16} /> : null}
      <span className="shrink-0 font-mono text-[11px] tabular-nums">{hhmm(p.minutes)}</span>
      <span className="min-w-0 truncate">{text}</span>
    </button>
  );
}

/* ------------------------------------------------------------------------ */

const MAX_CHIPS = 3;

export function MonthGrid({ month, ...v }: ViewProps & { month: string }) {
  return (
    <div className="min-w-0 overflow-hidden rounded-[14px] border border-line bg-surface">
      <div className="grid grid-cols-7 border-b border-line bg-subtle" role="row">
        {WEEKDAYS_SHORT.map((d) => (
          <div key={d} role="columnheader" className="px-2 py-2 text-[11px] font-semibold tracking-[.04em] text-ink-3 uppercase">
            {d}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7" role="grid" aria-label="Month">
        {v.days.map((ymd) => (
          <MonthCell key={ymd} ymd={ymd} inMonth={ymd.slice(0, 7) === month.slice(0, 7)} {...v} />
        ))}
      </div>
    </div>
  );
}

function MonthCell({ ymd, inMonth, byDay, today, hoverOf, onOpen, onCompose, onDrop, canCompose }: ViewProps & { ymd: string; inMonth: boolean }) {
  const [all, setAll] = useState(false);
  const items = byDay.get(ymd) ?? [];
  const shown = all ? items : items.slice(0, MAX_CHIPS);
  const { over, handlers } = useDropTarget((d) => onDrop(d, ymd, null));
  const day = Number(ymd.slice(8));
  return (
    <div
      role="gridcell"
      tabIndex={canCompose ? 0 : undefined}
      onKeyDown={canCompose ? clickOnKey : undefined}
      data-day={ymd}
      aria-label={dayLong(ymd)}
      {...handlers}
      onClick={() => canCompose && onCompose(ymd)}
      className={cx('group flex min-h-[112px] min-w-0 flex-col gap-1 border-r border-b border-line p-1.5 [&:nth-child(7n)]:border-r-0', !inMonth && 'bg-subtle/60', over && 'bg-selection', canCompose && 'cursor-pointer')}
    >
      <div className="flex items-center justify-between">
        <span
          className={cx(
            'inline-flex h-6 min-w-6 items-center justify-center rounded-full px-1 text-[12px] font-semibold tabular-nums',
            ymd === today ? 'bg-primary text-white' : inMonth ? 'text-ink' : 'text-ink-3',
          )}
          aria-current={ymd === today ? 'date' : undefined}
        >
          {day}
        </span>
        {canCompose ? (
          <button
            type="button"
            aria-label={`Create a post on ${dayLong(ymd)}`}
            onClick={(e) => {
              e.stopPropagation();
              onCompose(ymd);
            }}
            className="hidden h-5 w-5 items-center justify-center rounded-[5px] text-ink-3 group-hover:flex hover:bg-subtle hover:text-ink focus-visible:flex"
          >
            <Icon name="plus" size={13} />
          </button>
        ) : null}
      </div>
      {shown.map((p) => (
        <PostChip key={p.post.id} p={p} onOpen={onOpen} hover={hoverOf(p)} />
      ))}
      {items.length > MAX_CHIPS ? (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setAll(!all);
          }}
          className="self-start rounded px-1 text-[11.5px] font-semibold text-primary hover:underline"
        >
          {all ? 'Show less' : `+${items.length - MAX_CHIPS} more`}
        </button>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------------ */

const HOURS = Array.from({ length: (WEEK_TO - WEEK_FROM) / 60 }, (_, i) => WEEK_FROM + i * 60);

export function WeekGrid(v: ViewProps) {
  return (
    <div className="min-w-0 overflow-x-auto rounded-[14px] border border-line bg-surface scroll-thin">
      <div className="grid min-w-[760px] grid-cols-[56px_repeat(7,minmax(0,1fr))]">
        <div className="border-b border-line bg-subtle" />
        {v.days.map((d) => (
          <div key={d} className={cx('border-b border-l border-line bg-subtle px-2 py-2 text-[12px] font-semibold', d === v.today ? 'text-primary' : 'text-ink-2')}>
            {dayHead(d)}
          </div>
        ))}
        <div className="relative" style={{ height: HOURS.length * HOUR_PX }}>
          {HOURS.map((h, i) => (
            <span key={h} className="absolute right-2 font-mono text-[10.5px] text-ink-3" style={{ top: i * HOUR_PX + 2 }}>
              {hhmm(h)}
            </span>
          ))}
        </div>
        {v.days.map((d) => (
          <WeekColumn key={d} ymd={d} {...v} />
        ))}
      </div>
    </div>
  );
}

function WeekColumn({ ymd, byDay, hoverOf, onOpen, onCompose, onDrop, canCompose }: ViewProps & { ymd: string }) {
  const items = byDay.get(ymd) ?? [];
  const { over, handlers } = useDropTarget((d, e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    onDrop(d, ymd, minutesAt(e.clientY - rect.top));
  });
  return (
    <div
      data-day={ymd}
      aria-label={dayLong(ymd)}
      {...handlers}
      role="button"
      tabIndex={canCompose ? 0 : undefined}
      onKeyDown={canCompose ? clickOnKey : undefined}
      onClick={() => canCompose && onCompose(ymd)}
      className={cx('relative border-l border-line', over && 'bg-selection')}
      style={{ height: HOURS.length * HOUR_PX, backgroundImage: `repeating-linear-gradient(to bottom, transparent 0, transparent ${HOUR_PX - 1}px, var(--color-line) ${HOUR_PX - 1}px, var(--color-line) ${HOUR_PX}px)` }}
    >
      {items.map((p, i) => {
        const clamped = Math.min(WEEK_TO - 30, Math.max(WEEK_FROM, p.minutes));
        const same = items.slice(0, i).filter((x) => Math.abs(x.minutes - p.minutes) < 30).length;
        return <PostChip key={p.post.id} p={p} onOpen={onOpen} hover={hoverOf(p)} className="absolute right-1 left-1 w-auto shadow-sm" style={{ top: ((clamped - WEEK_FROM) / 60) * HOUR_PX + same * 24 + 1 }} />;
      })}
    </div>
  );
}

/* ------------------------------------------------------------------------ */

export function ListView({ days, byDay, hoverOf, onOpen }: ViewProps) {
  const withPosts = days.filter((d) => byDay.get(d)?.length);
  if (!withPosts.length) return <div className="rounded-[14px] border border-line bg-surface p-6 text-center text-[13px] text-ink-3">Nothing is planned in this range.</div>;
  return (
    <div className="flex min-w-0 flex-col gap-3">
      {withPosts.map((d) => (
        <section key={d} className="rounded-[14px] border border-line bg-surface px-4 py-2">
          <h3 className="py-1.5 text-[13px] font-bold text-ink">{dayLong(d)}</h3>
          <ul>
            {byDay.get(d)!.map((p) => (
              <li key={p.post.id} className="border-t border-line/70">
                <button type="button" onClick={() => onOpen(p.post.id)} title={hoverOf(p) ?? undefined} className="flex w-full min-w-0 items-center gap-3 rounded-[8px] px-1 py-2 text-left hover:bg-subtle">
                  <span className={cx('h-2.5 w-2.5 shrink-0 rounded-[3px]', TONE_SOLID[TONE_OF[p.bucket]])} aria-hidden />
                  <span className="w-[44px] shrink-0 font-mono text-[12px] text-ink-2 tabular-nums">{hhmm(p.minutes)}</span>
                  <NetChips networks={postNetworks(p.post)} size={20} max={4} />
                  <span className="min-w-0 flex-1 truncate text-[13px] text-ink">{excerpt(p.post.base_text, 140)}</span>
                  <PostStatusPill status={p.post.status} />
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
