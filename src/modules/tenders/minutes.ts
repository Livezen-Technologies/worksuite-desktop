import { apiPost } from '../../core/api';
import { app } from '../../core/app-state';
import { dayWords } from '../../core/time';
import { closingValue } from './api';
import { addMeeting, labelOf, MEETING_KINDS, updateMeeting, type Meeting } from './work';

/**
 * A tender meeting's minutes: the notes, and the points agreed — each of which
 * can become a task, a reminder or a follow-up meeting.
 *
 * The server keeps the minutes as one text (`tender_meetings.minutes`), which
 * the web shows as it is. So the points are written as lines starting "- ",
 * and what a point became is written at the end of its line in brackets —
 * "[Task #482]", "[Reminder 2026-10-03 09:00]", "[Follow-up 2026-10-07 10:00]" —
 * readable there, and read back here. Minutes written before this, or on the
 * web, are notes; their "-", "•", "*" and "1." lines are points.
 */
export type Converted = { kind: 'task'; id: number } | { kind: 'reminder'; at: string } | { kind: 'followup'; at: string };

export interface Point {
  text: string;
  done: Converted | null;
}

export interface Minutes {
  notes: string;
  points: Point[];
}

const BULLET = /^\s*(?:[-•*]|\d{1,3}[.)])\s+(.*)$/;
const WHEN = '(\\d{4}-\\d{2}-\\d{2}(?: \\d{2}:\\d{2})?)';
const MARK = new RegExp(`\\s*\\[(?:Task #(\\d+)|Reminder ${WHEN}|Follow-up ${WHEN})\\]\\s*$`);

/** The longest a point may be; a task's title is cut here too. */
export const POINT_MAX = 250;

export function parseMinutes(text: string | null | undefined): Minutes {
  const notes: string[] = [];
  const points: Point[] = [];
  for (const line of (text ?? '').replace(/\r\n?/g, '\n').split('\n')) {
    const b = BULLET.exec(line);
    if (!b) {
      notes.push(line);
      continue;
    }
    const m = MARK.exec(b[1]!);
    const body = (m ? b[1]!.slice(0, m.index) : b[1]!).trim();
    if (!body) continue;
    const done: Converted | null = !m ? null : m[1] ? { kind: 'task', id: Number(m[1]) } : m[2] ? { kind: 'reminder', at: m[2] } : { kind: 'followup', at: m[3]! };
    points.push({ text: body, done });
  }
  return { notes: notes.join('\n').replace(/\n{3,}/g, '\n\n').trim(), points };
}

export function markOf(c: Converted): string {
  return c.kind === 'task' ? `[Task #${c.id}]` : c.kind === 'reminder' ? `[Reminder ${c.at}]` : `[Follow-up ${c.at}]`;
}

/** The text the server keeps: the notes, a blank line, then one line per point. */
export function writeMinutes(m: Minutes): string {
  const points = m.points
    .map((p) => ({ ...p, text: p.text.replace(/\s+/g, ' ').trim().slice(0, POINT_MAX) }))
    .filter((p) => p.text)
    .map((p) => `- ${p.text}${p.done ? ` ${markOf(p.done)}` : ''}`);
  return [m.notes.trim(), points.join('\n')].filter(Boolean).join('\n\n');
}

/** "YYYY-MM-DD HH:MM" as people read it: "Fri 3 Oct, 09:00". */
export function whenLabel(at: string): string {
  const [day, time] = at.split(' ');
  return `${dayWords(day!, { weekday: true })}${time ? `, ${time}` : ''}`;
}

export function convertedLabel(c: Converted): string {
  if (c.kind === 'task') return `Task #${c.id}`;
  return `${c.kind === 'reminder' ? 'Reminder' : 'Follow-up'} · ${whenLabel(c.at)}`;
}

function tenderLink(tenderId: number): string {
  const origin = (app.get().auth?.server?.origin ?? '').replace(/\/+$/, '');
  return `${origin}/tenders?open=${tenderId}`;
}

const escape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Where a point came from, in words: "the pre-bid meeting on Tue 30 Sep for “Road works, lot 2”". */
export function sourceOf(meeting: Pick<Meeting, 'kind' | 'scheduled_at'>, day: string | null, tender: string | null): string {
  const what = meeting.kind === 'other' ? 'meeting' : labelOf(MEETING_KINDS, meeting.kind).toLowerCase();
  return [`the ${what}`, day ? `on ${dayWords(day, { weekday: true })}` : null, tender ? `for “${tender}”` : null].filter(Boolean).join(' ');
}

export interface Context {
  tenderId: number;
  tender: string | null;
  meeting: Meeting;
  /** The meeting's day on the reader's clock, YYYY-MM-DD. */
  day: string | null;
}

/** A task (`/api/tasks`), assigned to whoever is chosen, due when chosen, pointing back at the tender. */
export async function toTask(point: string, c: Context, o: { assignee: number | null; due: string; priority: string }): Promise<Converted> {
  const description = `<p>${escape(point)}</p><p>From the minutes of ${escape(sourceOf(c.meeting, c.day, c.tender))}: <a href="${escape(tenderLink(c.tenderId))}">open the tender</a></p>`;
  const r = await apiPost<{ id: number }>('/api/tasks', {
    title: point.slice(0, POINT_MAX),
    description,
    priority: o.priority,
    ...(o.assignee ? { assignee_id: o.assignee } : {}),
    ...(o.due ? { due_date: o.due } : {}),
    tags: ['tender'],
  });
  if (!r?.id) throw new Error('The task was not created.');
  return { kind: 'task', id: Number(r.id) };
}

/**
 * A reminder: an event in the person's own calendar at that time, which
 * WorkSuite reminds them of when it comes (`calendar:remind`), in the bell and
 * on the desktop. The calendar takes the digits on the person's own clock.
 */
export async function toReminder(point: string, c: Context, o: { date: string; time: string }): Promise<Converted> {
  const at = `${o.date}T${o.time}`;
  await apiPost('/api/calendar/events', {
    title: `Reminder: ${point}`.slice(0, 250),
    description: `From the minutes of ${sourceOf(c.meeting, c.day, c.tender)}.\n${tenderLink(c.tenderId)}`,
    category: 'Tender',
    color: '#B45309',
    start: at,
    end: at,
    all_day: false,
    remind_minutes: 0,
  });
  return { kind: 'reminder', at: `${o.date} ${o.time}` };
}

/** A follow-up: another meeting on the tender, held the same way as this one, with the point as its first line. */
export async function toFollowUp(point: string, c: Context, o: { date: string; time: string; kind: string }): Promise<Converted> {
  const m = c.meeting;
  await addMeeting(c.tenderId, {
    kind: o.kind,
    scheduled_at: closingValue(o.date, o.time),
    mode: m.mode ?? 'physical',
    venue: m.venue ?? '',
    link: m.link ?? '',
    mandatory: false,
    minutes: `Follow-up to ${sourceOf(m, c.day, null)}: ${point}`,
  });
  return { kind: 'followup', at: `${o.date} ${o.time}` };
}

/** Saves the minutes — after a conversion, so the point says what it became. */
export const saveMinutes = (meetingId: number, m: Minutes) => updateMeeting(meetingId, { minutes: writeMinutes(m) });
