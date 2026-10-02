import { useQuery } from '@tanstack/react-query';
import { Fragment, useState } from 'react';
import { apiGet } from '../../core/api';
import { call, errorMessage } from '../../core/bridge';
import { wallTimeLabel } from '../../core/time';
import { toast } from '../../core/toasts';
import { Icon } from '../../components/Icon';
import { Avatar, Button, Chip, cx } from '../../components/ui';
import { CATEGORIES, destinationOf, entryCategory, relatedOf, type CalendarEvent, type Destination } from '../calendar/api';
import { openMeeting } from '../meet/api';
import { providerLabel, type Detail } from '../meetings/api';
import { MoreButton, type MenuAction } from './Menu';
import { agendaOf, allDayLabel, durationLabel, isTenderMeeting, untilLabel, type AgendaItem } from './today';

/**
 * Home › Today's agenda (optimized): the all-day entries folded into one line, then the day as a timeline — what has
 * ended muted, a red line at now, and the next meeting drawn out with who is in it, where, and Join. A meeting from
 * a tender says so, with its reference and Open tender beside View meeting (#100).
 */
export function Agenda({ events, now, today, canMeet, canMeetings, onOpen }: { events: CalendarEvent[]; now: number; today: string; canMeet: boolean; canMeetings: boolean; onOpen: (to: Destination) => void }) {
  const { allDay, timed, nowAt, next } = agendaOf(events, now);
  const nowLabel = wallTimeLabel(`${today} ${String(Math.floor(now / 60)).padStart(2, '0')}:${String(now % 60).padStart(2, '0')}:00`);
  return (
    <div className="flex flex-col gap-3.5">
      {allDay.length ? <AllDay events={allDay} onOpen={onOpen} /> : null}
      {timed.length ? (
        <ol aria-label="Timeline" className="m-0 flex list-none flex-col p-0">
          {timed.map((it, i) => (
            <Fragment key={`${it.e.source}:${it.e.id}:${it.e.start_at}`}>
              {i === nowAt ? <NowMarker label={nowLabel} /> : null}
              <Entry it={it} now={now} next={it === next} canMeet={canMeet} canMeetings={canMeetings} onOpen={onOpen} />
            </Fragment>
          ))}
          {nowAt === timed.length ? <NowMarker label={nowLabel} /> : null}
        </ol>
      ) : (
        <p className="m-0 flex items-center gap-2 text-[13px] text-ink-3">
          <Icon name="calendar" size={15} /> Nothing at a set time today.
        </p>
      )}
    </div>
  );
}

function AllDay({ events, onOpen }: { events: CalendarEvent[]; onOpen: (to: Destination) => void }) {
  const [open, setOpen] = useState(false);
  const { title, detail } = allDayLabel(events);
  return (
    <div className="rounded-[10px] border border-line bg-well">
      <button type="button" aria-expanded={open} aria-controls="home-allday" onClick={() => setOpen((v) => !v)} className="flex w-full items-center gap-3 px-3 py-2.5 text-left">
        <span aria-hidden="true" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[8px] bg-teal/10 text-teal">
          <Icon name="repeat" size={16} />
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-px">
          <span className="text-[13px] font-semibold text-ink">{title}</span>
          <span className="truncate text-[12px] text-ink-3">{detail}</span>
        </span>
        <Icon name="chevron-down" size={16} className={cx('shrink-0 text-ink-3 transition-transform', open && 'rotate-180')} />
      </button>
      {open ? (
        <ul id="home-allday" className="m-0 flex list-none flex-col border-t border-line p-1.5">
          {events.map((e) => {
            const to = destinationOf(e);
            const kind = e.related?.kind_label ?? CATEGORIES.find((c) => c.id === entryCategory(e))?.label.replace(/s$/, '') ?? 'Event';
            return (
              <li key={`${e.source}:${e.id}`}>
                <button type="button" disabled={!to} onClick={() => to && onOpen(to)} className="flex w-full items-center gap-2 rounded-[7px] px-2 py-1.5 text-left enabled:hover:bg-subtle">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-medium text-ink">{e.title}</span>
                    <span className="block truncate text-[12px] text-ink-3">{kind}</span>
                  </span>
                  {to ? <Icon name={to.route ? 'chevron-right' : 'external'} size={14} className="shrink-0 text-ink-3" /> : null}
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}

function NowMarker({ label }: { label: string }) {
  return (
    <li aria-label={`Now, ${label}`} className="grid grid-cols-[64px_1fr] items-center gap-3 pb-3.5">
      <span aria-hidden="true" className="text-[11px] font-bold tracking-[0.04em] text-danger">
        NOW
      </span>
      <span aria-hidden="true" className="relative -ml-[5px] h-0.5 bg-danger">
        <span className="absolute -top-1 -left-0.5 h-2.5 w-2.5 rounded-full bg-danger" />
      </span>
    </li>
  );
}

/** Where a meeting is held, from what the calendar or the meeting says. */
function providerOf(e: CalendarEvent, detail: Detail | undefined): string | null {
  if (detail) return providerLabel(detail.meeting);
  if (e.source === 'meeting') return 'WorkSuite Meet';
  const url = e.join_url ?? '';
  if (/zoom\.us/i.test(url)) return 'Zoom';
  if (/teams\.(microsoft|live)\.com/i.test(url)) return 'Microsoft Teams';
  if (/meet\.google\.com/i.test(url)) return 'Google Meet';
  return url ? 'Online' : (e.location ?? null);
}

/** A business meeting's people and recordings, when the reader has Meetings — the same request its page makes. */
function useMeetingDetail(e: CalendarEvent, enabled: boolean) {
  return useQuery({
    queryKey: ['meetings', 'detail', Number(e.id)],
    queryFn: ({ signal }) => apiGet<Detail>(`/api/meetings/${e.id}`, undefined, signal),
    enabled: enabled && e.source === 'businessmeeting',
    retry: false,
    staleTime: 60_000,
  });
}

function Entry({ it, now, next, canMeet, canMeetings, onOpen }: { it: AgendaItem; now: number; next: boolean; canMeet: boolean; canMeetings: boolean; onOpen: (to: Destination) => void }) {
  const { e, past } = it;
  const tender = isTenderMeeting(e);
  // Only what is drawn out (the next meeting) or done (its recording and notes) is asked about.
  const detail = useMeetingDetail(e, canMeetings && (next || past)).data;
  const to = destinationOf(e);
  const related = relatedOf(e);
  const join = e.source === 'meeting' && e.uuid ? (canMeet ? () => void openMeeting(e.uuid!, e.title) : null) : e.join_url ? () => void call('app:openExternal', { url: e.join_url! }) : null;
  const kind = e.related?.kind_label ?? CATEGORIES.find((c) => c.id === entryCategory(e))?.label.replace(/s$/, '') ?? 'Event';
  const line = tender ? [e.related?.label, e.location].filter(Boolean).join(' · ') : [kind, e.location].filter(Boolean).join(' · ');
  const people = (detail?.participants ?? []).filter((p) => p.rsvp !== 'declined');
  const provider = next || past ? providerOf(e, detail) : null;
  const notes = past && detail ? notesOf(detail) : null;
  const tenderChip = tender ? <Chip tone="teal">{e.related?.kind_label && !/^tender meeting$/i.test(e.related.kind_label) ? e.related.kind_label : 'Tender meeting'}</Chip> : null;
  const more: MenuAction[] = [
    ...(e.join_url ? [{ label: 'Copy meeting link', icon: 'copy', run: () => void navigator.clipboard.writeText(e.join_url!).then(() => toast('success', 'Meeting link copied.'), (err: unknown) => toast('error', errorMessage(err))) }] : []),
    { label: 'Open in Calendar', icon: 'calendar', run: () => onOpen({ route: `/calendar?date=${e.start_at.slice(0, 10)}`, label: 'Open in Calendar' }) },
  ];

  return (
    <li className={cx('grid grid-cols-[64px_1fr] gap-3', 'pb-3.5')}>
      <span className="flex flex-col gap-0.5 pt-0.5">
        <span className={cx('text-[12px] font-semibold tabular', past ? 'text-ink-3' : 'text-ink')}>{wallTimeLabel(e.start_at)}</span>
        <span className="text-[11px] text-ink-3">{durationLabel(it.end - it.start)}</span>
      </span>
      {next ? (
        <div className="flex min-w-0 flex-col gap-2.5 rounded-[10px] bg-selection px-3.5 py-3" data-next-meeting>
          <div className="flex items-center justify-between gap-2">
            <span className="min-w-0 truncate text-[14px] font-semibold text-ink" title={e.title}>
              {e.title}
            </span>
            <span className="shrink-0 text-[11px] font-semibold text-primary">{untilLabel(it.start - now)}</span>
          </div>
          {tender ? (
            <div className="flex flex-col gap-1">
              <span className="self-start">{tenderChip}</span>
              {line ? <span className="text-[12px] text-ink-2">{line}</span> : null}
            </div>
          ) : null}
          {people.length || provider ? (
            <div className="flex items-center gap-2.5">
              <People names={people.map((p) => p.name ?? p.email ?? '')} ring="ring-selection" />
              {provider ? <span className="min-w-0 truncate text-[12px] text-ink-2">{provider}</span> : null}
            </div>
          ) : null}
          <div className="flex flex-wrap gap-2">
            {join ? (
              <Button variant="primary" icon="video" className="h-[34px] min-w-[96px] flex-1" onClick={join}>
                Join
              </Button>
            ) : null}
            {to ? (
              <Button className="h-[34px]" onClick={() => onOpen(to)}>
                {tender ? 'View meeting' : 'Details'}
              </Button>
            ) : null}
            {tender && related ? (
              <Button className="h-[34px]" onClick={() => onOpen(related)}>
                Open tender
              </Button>
            ) : null}
            <MoreButton label={`More options for ${e.title}`} items={more} size={34} className="[&>button]:border [&>button]:border-line [&>button]:bg-surface" />
          </div>
        </div>
      ) : (
        <div className="flex min-w-0 flex-col gap-2 border-l-2 border-line pl-3.5">
          <div className="flex items-center justify-between gap-2">
            <span className={cx('min-w-0 truncate text-[14px] font-semibold', past ? 'text-ink-2' : 'text-ink')} title={e.title}>
              {e.title}
            </span>
            {past ? (
              <span className="shrink-0 rounded-[6px] bg-subtle px-2 py-0.5 text-[11px] font-semibold text-ink-3">Ended</span>
            ) : it.live ? (
              <span className="shrink-0 text-[11px] font-semibold text-primary">Now</span>
            ) : (
              tenderChip
            )}
          </div>
          {line && (!past || tender) ? <span className="text-[12px] text-ink-3">{line}</span> : null}
          {past && (people.length || provider) ? (
            <div className="flex items-center gap-2.5">
              <People names={people.map((p) => p.name ?? p.email ?? '')} ring="ring-surface" />
              {provider ? <span className="min-w-0 truncate text-[12px] text-ink-3">{provider}</span> : null}
            </div>
          ) : null}
          <div className="flex flex-wrap gap-x-3.5 gap-y-1">
            {notes ? <TextLink icon="video" onClick={() => onOpen({ route: `/meetings?meeting=${e.id}`, label: notes })}>{notes}</TextLink> : null}
            {tender && related ? <TextLink onClick={() => onOpen(related)}>Open tender</TextLink> : null}
            {to ? <TextLink onClick={() => onOpen(to)}>{tender || e.source === 'businessmeeting' ? 'View meeting' : to.label.replace(/ ↗$/, '')}</TextLink> : null}
            {join && it.live ? <TextLink icon="video" onClick={join}>Join</TextLink> : null}
          </div>
        </div>
      )}
    </li>
  );
}

/** What a meeting that ended left behind for this person: its recording, its notes, or both. */
function notesOf(d: Detail): string | null {
  const recording = (d.recordings ?? []).some((r) => r.status === 'ready');
  const notes = !!(d.minutes && (d.minutes.summary || d.minutes.notes || d.minutes.decisions));
  return recording && notes ? 'Recording & notes' : recording ? 'Recording' : notes ? 'Notes' : null;
}

function TextLink({ children, onClick, icon }: { children: string; onClick: () => void; icon?: string }) {
  return (
    <button type="button" onClick={onClick} className="flex items-center gap-1.5 text-[12px] font-medium text-primary hover:underline">
      {icon ? <Icon name={icon} size={14} /> : null}
      {children}
    </button>
  );
}

/** Up to three faces and "+N". */
function People({ names, ring }: { names: string[]; ring: string }) {
  if (!names.length) return null;
  const shown = names.slice(0, 3);
  return (
    <span className="flex" aria-label={`${names.length} ${names.length === 1 ? 'person' : 'people'}: ${names.join(', ')}`} role="img">
      {shown.map((n, i) => (
        <Avatar key={`${n}:${i}`} name={n} size={24} className={cx('ring-2', ring, i > 0 && '-ml-1.5')} />
      ))}
      {names.length > 3 ? <span className={cx('-ml-1.5 flex h-6 w-6 items-center justify-center rounded-full bg-subtle text-[10px] font-semibold text-ink-2 ring-2', ring)}>+{names.length - 3}</span> : null}
    </span>
  );
}
