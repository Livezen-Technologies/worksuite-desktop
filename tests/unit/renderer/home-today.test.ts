import { beforeAll, describe, expect, it } from 'vitest';
import { setRegional } from '../../../src/core/time';
import type { CalendarEvent } from '../../../src/modules/calendar/api';
import type { Task } from '../../../src/modules/tasks/api';
import { DEFAULT_LAYOUT, dueToday, meetingsToday, mergeTasks, move, normalise, todaysWork, toggle } from '../../../src/modules/home/today';

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
});
