import { beforeAll, describe, expect, it } from 'vitest';
import { setRegional } from '../../../src/core/time';
import type { CalendarEvent } from '../../../src/modules/calendar/api';
import type { Task } from '../../../src/modules/tasks/api';
import {
  DEFAULT_LAYOUT,
  agendaOf,
  allDayLabel,
  cappedCount,
  dueToday,
  durationLabel,
  isTenderMeeting,
  mainSpans,
  meetingsToday,
  mergeTasks,
  move,
  normalise,
  place,
  resize,
  todaysWork,
  toggle,
  untilLabel,
  waitingBreakdown,
} from '../../../src/modules/home/today';

beforeAll(() => setRegional({ timezone: 'Asia/Colombo', locale: 'en-GB' }));

const task = (over: Partial<Task>): Task => ({
  id: 1, task_key: null, list_id: null, org_id: null, org_name: null, owner_id: 5, assignee_id: 5, assignee_name: null, title: 'T', description: null,
  status: 'todo', priority: 'medium', tags: [], start_date: null, start_at: null, due_date: null, due_at: null, estimated_hours: null, progress: 0,
  position: 0, archived: false, completed_at: null, created_at: null, updated_at: null, ...over,
});

// 2026-09-29, 10:00 in Colombo.
const now = Date.parse('2026-09-29T04:30:00Z');
const today = '2026-09-29';

describe("Home: today's tasks (QA-014)", () => {
  it('counts the tasks shared with you too, once', () => {
    const mine = [task({ id: 1, due_date: today })];
    const shared = [task({ id: 1, due_date: today }), task({ id: 2, owner_id: 9, assignee_id: 9, due_date: today })];
    expect(mergeTasks(mine, shared).map((t) => t.id)).toEqual([1, 2]);
  });

  it('reads a timed task on your clock, not the day its setter typed', () => {
    // Set in a zone ahead of Colombo: its `due_date` says tomorrow, and it is due at 18:00 today here.
    const t = task({ id: 3, due_date: '2026-09-30', due_at: '2026-09-29T12:30:00Z' });
    expect(dueToday([t], today, now).map((x) => x.id)).toEqual([3]);
  });

  it('does not count overdue, done or cancelled tasks as due today; the card keeps overdue first', () => {
    const tasks = [
      task({ id: 4, due_date: today }),
      task({ id: 5, due_date: '2026-09-27' }),
      task({ id: 6, due_date: today, status: 'done' }),
      task({ id: 7, due_date: today, status: 'cancelled' }),
      task({ id: 8, due_date: '2026-10-02' }),
    ];
    expect(dueToday(tasks, today, now).map((t) => t.id)).toEqual([4]);
    expect(todaysWork(tasks, today, now).map((t) => t.id)).toEqual([5, 4]);
  });
});

describe('Home: meetings today (QA-018)', () => {
  it('counts meetings, not every event with a time', () => {
    const ev = (over: Partial<CalendarEvent>): CalendarEvent => ({ source: 'event', id: 1, title: 'x', color: null, start_at: '2026-09-29 10:00:00', end_at: null, all_day: false, editable: true, ...over });
    const events = [ev({ id: 1, source: 'meeting' }), ev({ id: 2, source: 'businessmeeting' }), ev({ id: 3 }), ev({ id: 4, join_url: 'https://meet' }), ev({ id: 5, source: 'task' }), ev({ id: 6, source: 'meeting', all_day: true })];
    expect(meetingsToday(events).map((e) => e.id)).toEqual([1, 2, 4]);
  });
});

describe('Home: customize (QA-015)', () => {
  it('moves and hides cards, and keeps a saved layout whole', () => {
    const l = move(DEFAULT_LAYOUT, 'files', -1);
    expect(l.order.indexOf('files')).toBe(DEFAULT_LAYOUT.order.indexOf('files') - 1);
    expect(move(DEFAULT_LAYOUT, 'work', -1)).toBe(DEFAULT_LAYOUT);
    expect(toggle(toggle(DEFAULT_LAYOUT, 'activity'), 'activity').hidden).toEqual([]);
    expect(toggle(DEFAULT_LAYOUT, 'activity').hidden).toEqual(['activity']);
    const n = normalise({ order: ['summary', 'nope', 'summary', 'work'], hidden: ['files', 'x'] });
    expect(n.order.slice(0, 2)).toEqual(['summary', 'work']);
    expect(n.order).toHaveLength(DEFAULT_LAYOUT.order.length);
    expect(n.hidden).toEqual(['files']);
    expect(normalise('garbage')).toEqual(DEFAULT_LAYOUT);
  });

  it('moves a card only among the cards of its zone', () => {
    // The daily brief is the first of the rail, though main cards come before it in the list.
    expect(move(DEFAULT_LAYOUT, 'summary', -1)).toBe(DEFAULT_LAYOUT);
    expect(move(DEFAULT_LAYOUT, 'files', 1)).toBe(DEFAULT_LAYOUT);
    expect(move(DEFAULT_LAYOUT, 'waiting', -1).order.filter((id) => ['summary', 'waiting', 'announcements'].includes(id))).toEqual(['waiting', 'summary', 'announcements']);
    expect(place(DEFAULT_LAYOUT, 'summary', 'work')).toBe(DEFAULT_LAYOUT);
    expect(place(DEFAULT_LAYOUT, 'files', 'work').order.slice(0, 2)).toEqual(['files', 'work']);
    expect(resize(DEFAULT_LAYOUT, 'waiting', 'wide').wide).toEqual([]);
  });

  it('migrates a layout saved before the optimized Home', () => {
    // Never reordered: the new default order, with what was hidden; the old two-of-three "wide" is dropped.
    const untouched = normalise({ order: ['work', 'calendar', 'waiting', 'announcements', 'activity', 'files', 'summary'], hidden: ['files'], wide: ['calendar'] });
    expect(untouched).toEqual({ ...DEFAULT_LAYOUT, hidden: ['files'] });
    // Reordered: kept, each card in its own zone.
    const moved = normalise({ order: ['files', 'work', 'summary', 'calendar', 'waiting', 'announcements', 'activity'], hidden: [], wide: ['files'] });
    expect(moved.order.slice(0, 2)).toEqual(['files', 'work']);
    expect(moved.wide).toEqual([]);
    // A version 2 layout keeps its wide main cards, never a wide rail card.
    expect(normalise({ version: 2, order: DEFAULT_LAYOUT.order, hidden: [], wide: ['calendar', 'summary'] }).wide).toEqual(['calendar']);
  });

  it('pairs main cards 5 + 4, a wide or lone one takes the row', () => {
    expect([...mainSpans(['work', 'calendar', 'activity', 'files'], [])]).toEqual([['work', 'major'], ['calendar', 'minor'], ['activity', 'major'], ['files', 'minor']]);
    expect([...mainSpans(['work', 'calendar', 'activity'], ['calendar'])]).toEqual([['work', 'full'], ['calendar', 'full'], ['activity', 'full']]);
  });
});

describe('Home: the tiles and the agenda (optimized)', () => {
  const ev = (over: Partial<CalendarEvent>): CalendarEvent => ({ source: 'event', id: 1, title: 'x', color: null, start_at: `${today} 10:00:00`, end_at: `${today} 10:30:00`, all_day: false, editable: true, ...over });

  it('caps unread at 99+ and says what is waiting by kind', () => {
    expect(cappedCount(99)).toBe('99');
    expect(cappedCount(100)).toBe('99+');
    expect(waitingBreakdown({ invitations: 1, approvals: 2, acknowledgements: 0 })).toBe('1 invitation · 2 approvals');
    expect(waitingBreakdown({ invitations: 0, approvals: 0, acknowledgements: 0 })).toBe('');
  });

  it('says how long and how soon', () => {
    expect(durationLabel(30)).toBe('30 min');
    expect(durationLabel(60)).toBe('1 hr');
    expect(durationLabel(95)).toBe('1 hr 35 min');
    expect(untilLabel(55)).toBe('in 55 min');
    expect(untilLabel(0)).toBe('Now');
  });

  it('puts now after what ended, and the next meeting is the one on now or the first to come', () => {
    const events = [
      ev({ id: 1, title: 'Standup', source: 'meeting', start_at: `${today} 09:00:00`, end_at: `${today} 09:15:00` }),
      ev({ id: 2, title: 'Focus', start_at: `${today} 10:00:00`, end_at: `${today} 11:00:00` }),
      ev({ id: 3, title: 'Review', source: 'businessmeeting', start_at: `${today} 14:00:00`, end_at: `${today} 14:30:00` }),
      ev({ id: 4, title: 'Renewal', source: 'subscription', all_day: true }),
    ];
    const a = agendaOf(events, 10 * 60 + 5);
    expect(a.allDay.map((e) => e.id)).toEqual([4]);
    expect(a.timed.map((i) => [i.e.id, i.past, i.live])).toEqual([[1, true, false], [2, false, true], [3, false, false]]);
    expect(a.nowAt).toBe(1);
    expect(a.next?.e.id).toBe(3);
    expect(agendaOf(events, 14 * 60 + 10).next?.live).toBe(true);
    expect(agendaOf(events, 20 * 60).nowAt).toBe(3);
    expect(agendaOf(events, 20 * 60).next).toBeNull();
    expect(allDayLabel([events[3]!, { ...events[3]!, id: 5 }])).toEqual({ title: 'All day · 2 renewals', detail: 'Subscription renewals' });
    expect(allDayLabel([events[3]!, ev({ id: 6, source: 'task', all_day: true })]).title).toBe('All day · 2 items');
  });

  it('knows a tender meeting by its source, or by its label from an older server', () => {
    expect(isTenderMeeting(ev({ source: 'businessmeeting', source_type: 'tender' }))).toBe(true);
    expect(isTenderMeeting(ev({ source: 'businessmeeting', related: { kind_label: 'Tender Meeting', label: null, link: null, open_label: null } }))).toBe(true);
    expect(isTenderMeeting(ev({ source: 'businessmeeting', source_type: 'crm_lead' }))).toBe(false);
  });
});
