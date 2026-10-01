// @vitest-environment jsdom
import { beforeAll, describe, expect, it } from 'vitest';
import { setRegional } from '../../../src/core/time';
import { counts, dueOf, inScope, plainText, progressOf, sanitizeRich, type Task, type TaskList } from '../../../src/modules/tasks/api';

const task = (over: Partial<Task> = {}): Task => ({
  id: 1,
  task_key: 'TASK-2026-0001',
  list_id: null,
  org_id: null,
  org_name: null,
  owner_id: 7,
  assignee_id: 7,
  assignee_name: 'Me',
  title: 'Send the budget',
  description: null,
  status: 'todo',
  priority: 'medium',
  tags: [],
  start_date: null,
  start_at: null,
  due_date: null,
  due_at: null,
  estimated_hours: null,
  progress: 0,
  position: 1,
  archived: false,
  completed_at: null,
  created_at: null,
  updated_at: null,
  ...over,
});

// Saturday 26 September 2026, 10:00 in Colombo (04:30 UTC).
const TODAY = '2026-09-26';
const NOW = Date.parse('2026-09-26T04:30:00Z');

beforeAll(() => setRegional({ timezone: 'Asia/Colombo' }));

describe('when a task is due', () => {
  it('names the day, and says overdue once a day has passed or a time has', () => {
    expect(dueOf(task({ due_date: TODAY }), TODAY, NOW)).toMatchObject({ label: 'Today', group: 'today', tone: 'soon' });
    expect(dueOf(task({ due_date: '2026-09-25' }), TODAY, NOW)).toMatchObject({ label: 'Yesterday', group: 'overdue', tone: 'overdue' });
    expect(dueOf(task({ due_date: '2026-09-27' }), TODAY, NOW)).toMatchObject({ label: 'Tomorrow', group: 'week' });
    expect(dueOf(task({ due_date: '2026-10-01' }), TODAY, NOW)).toMatchObject({ label: 'Thu', group: 'later' });
    expect(dueOf(task({ due_date: '2026-10-12' }), TODAY, NOW)).toMatchObject({ label: '12 Oct', group: 'later' });
    expect(dueOf(task({ due_date: '2027-01-05' }), TODAY, NOW).label).toBe('5 Jan 2027');
    expect(dueOf(task(), TODAY, NOW)).toMatchObject({ label: '', group: 'none' });
  });

  it('reads a timed deadline on the WorkSuite clock, to the minute', () => {
    // 12:30 UTC is 18:00 in Colombo: later today, not yet late.
    expect(dueOf(task({ due_date: TODAY, due_at: '2026-09-26T12:30:00Z' }), TODAY, NOW)).toMatchObject({ label: 'Today 6 PM', group: 'today', tone: 'soon' });
    // 03:30 UTC was 09:00: an hour ago, so overdue though still today.
    expect(dueOf(task({ due_date: TODAY, due_at: '2026-09-26T03:30:00Z' }), TODAY, NOW)).toMatchObject({ label: 'Today 9 AM', group: 'overdue', tone: 'overdue' });
    // 20:00 UTC on the 26th is 01:30 on the 27th in Colombo.
    expect(dueOf(task({ due_date: TODAY, due_at: '2026-09-26T20:00:00Z' }), TODAY, NOW)).toMatchObject({ day: '2026-09-27', label: 'Tomorrow 1:30 AM' });
  });

  it('never calls a finished task overdue', () => {
    expect(dueOf(task({ due_date: '2026-09-20', status: 'done' }), TODAY, NOW).tone).toBe('done');
    expect(dueOf(task({ due_date: '2026-09-20', status: 'cancelled' }), TODAY, NOW).group).not.toBe('overdue');
  });
});

describe('the views and their counts', () => {
  const lists: TaskList[] = [{ id: 3, name: 'Garage', color: '#0E7C86', is_favorite: false, open_count: 0 }];
  const all = [
    task({ id: 1, due_date: TODAY }),
    task({ id: 2, due_date: '2026-09-24', list_id: 3 }),
    task({ id: 3, assignee_id: 9, assignee_name: 'Kasun', list_id: 3 }),
    task({ id: 4, status: 'done', due_date: '2026-09-20' }),
    task({ id: 5, status: 'cancelled', due_date: '2026-09-20' }),
  ];

  it('shows each view what belongs in it', () => {
    const ids = (s: Parameters<typeof inScope>[1]) => all.filter((t) => inScope(t, s, 7, TODAY, NOW)).map((t) => t.id);
    expect(ids('all')).toEqual([1, 2, 3]);
    expect(ids('mine')).toEqual([1, 2]);
    expect(ids('today')).toEqual([1]);
    expect(ids('overdue')).toEqual([2]);
    expect(ids('done')).toEqual([4]);
    expect(ids('list:3')).toEqual([2, 3]);
  });

  it('counts what is still open in each', () => {
    const shared = [task({ id: 10, owner_id: 2, assignee_id: 2 }), task({ id: 11, status: 'done' })];
    expect(counts(all, shared, lists, 7, TODAY, NOW)).toEqual({ all: 3, mine: 2, today: 1, overdue: 1, upcoming: 0, shared: 1, 'list:3': 2 });
  });

  it('takes progress from the checklist when there is one', () => {
    expect(progressOf({ progress: 30, status: 'todo' })).toBe(30);
    expect(progressOf({ progress: 30, status: 'todo', checklist_done: 3, checklist_total: 5 })).toBe(60);
    expect(progressOf({ progress: 10, status: 'done', checklist_done: 0, checklist_total: 4 })).toBe(100);
  });
});

describe('rich text on the page', () => {
  it('keeps the allowed formatting and drops everything that could run', () => {
    const out = sanitizeRich('<p onclick="x()">Hi <b>there</b> <a href="javascript:alert(1)">bad</a> <a href="https://ok.test" style="color:red">ok</a></p><script>alert(1)</script><img src="https://evil.test/x.png"><iframe src="https://evil.test"></iframe><table><tr><td>cell</td></tr></table>');
    expect(out).toContain('<b>there</b>');
    expect(out).not.toMatch(/onclick|javascript:|<script|<iframe|evil\.test|style=/);
    expect(out).toContain('<a href="https://ok.test" target="_blank" rel="noopener noreferrer">ok</a>');
    expect(out).toContain('<a>bad</a>');
    expect(out).toContain('cell');
    expect(out).not.toContain('<table');
  });

  it('shows an inline image only by its file id, from the task', () => {
    const out = sanitizeRich('<p><img data-file-id="42" alt="board" src="https://evil.test/x.png" onerror="x()"></p>', (id) => `app://bundle/__api/api/tasks/5/images/${id}`);
    expect(out).toBe('<p><img src="app://bundle/__api/api/tasks/5/images/42" alt="board" data-file-id="42"></p>');
    expect(sanitizeRich('<img data-file-id="../../x">', () => 'u')).toBe('');
  });

  it('reads plain text for search', () => {
    expect(plainText('<p>Budget <b>v2</b></p><ul><li>one</li></ul>')).toBe('Budget v2one');
  });
});
