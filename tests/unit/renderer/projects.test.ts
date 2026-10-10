// @vitest-environment jsdom
import { afterAll, describe, expect, it, vi } from 'vitest';
import type { ProjectsOutboxItem } from '@shared/projects';
import { setRegional, todayInZone } from '../../../src/core/time';
import type { Task, TimeEntry } from '../../../src/modules/projects/api';
import { durationMinutes } from '../../../src/modules/projects/Dialogs';
import { activeSprint, boardKey, buildColumns, daySegments, dueOf, endOfWeek, filterMyWork, groupMyWork, nextColumn, perProject, sprintDay, withPending } from '../../../src/modules/projects/logic';
import { boardRoute, viewOf } from '../../../src/modules/projects/routes';

let seq = 0;
const task = (over: Partial<Task> = {}): Task => ({
  id: ++seq,
  task_number: `TSK-${String(seq).padStart(4, '0')}`,
  title: `Task ${seq}`,
  description: null,
  status: 'todo',
  priority: 'medium',
  task_type: 'task',
  project_id: 18,
  project: 'e-Auction portal',
  project_code: 'PRJ-0018',
  sprint_id: null,
  sprint: null,
  assignee_id: 7,
  assignee: 'Asha Fernando',
  reviewer_id: null,
  reviewer: null,
  estimated_hours: null,
  logged_hours: '0',
  logged_minutes: 0,
  start_date: null,
  due_date: null,
  overdue: false,
  blocked_reason: null,
  is_billable: true,
  tags: null,
  progress: 0,
  position: seq,
  completed_at: null,
  updated_at: '2026-10-09 08:00:00',
  updated_by: 'Asha',
  timer_running: false,
  ...over,
});

describe('the board’s keyboard (D01: J/K move, ←/→ change column)', () => {
  // Columns as the board draws them: To do [1, 2], In progress [3, 4, 5], In review [], Testing [6], Completed [7].
  const cols = [[1, 2], [3, 4, 5], [], [6], [7]];

  it('selects the first card when nothing is selected, and nothing on an empty board', () => {
    expect(boardKey(cols, null, 'down')).toBe(1);
    expect(boardKey([[], []], null, 'right')).toBeNull();
  });

  it('J and K go down and up a column, stopping at its ends', () => {
    expect(boardKey(cols, 3, 'down')).toBe(4);
    expect(boardKey(cols, 5, 'down')).toBe(5);
    expect(boardKey(cols, 4, 'up')).toBe(3);
    expect(boardKey(cols, 1, 'up')).toBe(1);
  });

  it('← and → go to the next column with cards, keeping the row as near as it can', () => {
    expect(boardKey(cols, 2, 'right')).toBe(4);
    expect(boardKey(cols, 5, 'right')).toBe(6); // In review is empty: skipped
    expect(boardKey(cols, 6, 'left')).toBe(3);
    expect(boardKey(cols, 7, 'right')).toBe(7); // the last column: stays
    expect(boardKey(cols, 1, 'left')).toBe(1);
    expect(boardKey(cols, 99, 'down')).toBe(1); // a card no longer on the board
  });

  it('Shift+←/→ moves a card to the neighbouring column; blocked work moves from In progress', () => {
    const statuses = buildColumns([task({ status: 'todo' })]).map((c) => c.status);
    expect(statuses).toEqual(['todo', 'in_progress', 'in_review', 'testing', 'completed']);
    expect(nextColumn(statuses, 'todo', 'right')).toBe('in_progress');
    expect(nextColumn(statuses, 'blocked', 'right')).toBe('in_review');
    expect(nextColumn(statuses, 'todo', 'left')).toBeNull();
    expect(nextColumn(statuses, 'completed', 'right')).toBeNull();
  });

  it('puts blocked work in In progress, hides cancelled, and shows Backlog only when something is in it', () => {
    const a = task({ status: 'blocked', blocked_reason: 'Waiting for the bank' });
    const b = task({ status: 'cancelled' });
    const c = task({ status: 'backlog' });
    const columns = buildColumns([a, b, c]);
    expect(columns.map((x) => x.status)).toEqual(['backlog', 'todo', 'in_progress', 'in_review', 'testing', 'completed']);
    expect(columns.find((x) => x.status === 'in_progress')!.tasks).toEqual([a]);
    expect(columns.flatMap((x) => x.tasks)).not.toContain(b);
  });
});

describe('cards: due, late, and queued changes (D01, D04)', () => {
  it('says how late an open task is, and when the rest are due', () => {
    expect(dueOf(task({ due_date: '2026-09-24' }), '2026-10-09')).toEqual({ label: '15 d late', late: true });
    expect(dueOf(task({ due_date: '2026-10-09' }), '2026-10-09')).toEqual({ label: 'Today', late: false });
    expect(dueOf(task({ due_date: '2026-10-14' }), '2026-10-09')).toEqual({ label: 'Wed 14', late: false });
    expect(dueOf(task({ due_date: '2026-10-30' }), '2026-10-09')).toEqual({ label: '30 Oct', late: false });
    expect(dueOf(task({ due_date: '2026-09-24', status: 'completed' }), '2026-10-09').late).toBe(false);
  });

  it('shows a queued move where I put it, and marks every card with something waiting', () => {
    const a = task({ status: 'in_progress' });
    const b = task({ status: 'todo' });
    const c = task({ status: 'in_review' });
    const item = (seqNo: number, over: Partial<ProjectsOutboxItem>): ProjectsOutboxItem => ({ id: `i${seqNo}`, seq: seqNo, kind: 'move', taskId: a.id, label: 'x', state: 'waiting', message: null, createdAt: '2026-10-09T08:41:00Z', status: null, theirs: null, ...over });
    const { tasks, marks } = withPending([a, b, c], [
      item(1, { kind: 'move', taskId: b.id, status: 'in_review' }),
      item(2, { kind: 'comment', taskId: a.id }),
      item(3, { kind: 'move', taskId: c.id, status: 'completed', state: 'conflict' }),
      item(4, { kind: 'log', taskId: c.id, state: 'refused' }),
    ]);
    expect(tasks.find((t) => t.id === b.id)!.status).toBe('in_review');
    expect(marks.get(b.id)).toBe('Move waiting');
    expect(marks.get(a.id)).toBe('Note waiting');
    expect(marks.get(c.id)).toBe('Needs your choice');
  });
});

describe('My work by the reader’s own day (NFR-06, D03)', () => {
  afterAll(() => setRegional({ timezone: null }));

  it('groups overdue, today, the rest of this week and later on my calendar, not the server’s', () => {
    // 23:30 UTC on Friday 9 October is already Saturday 10 October in Colombo (+05:30): my today is Saturday.
    setRegional({ timezone: 'Asia/Colombo' });
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-09T23:30:00Z'));
    try {
      expect(todayInZone()).toBe('2026-10-10');
    } finally {
      vi.useRealTimers();
    }
    const day = '2026-10-10';
    const late = task({ due_date: '2026-10-09' });
    const now = task({ due_date: '2026-10-10' });
    const sunday = task({ due_date: '2026-10-11' });
    const next = task({ due_date: '2026-10-12' });
    const none = task({ due_date: null });
    const done = task({ due_date: '2026-10-01', status: 'completed' });
    const g = groupMyWork([next, late, sunday, none, now, done, late], day);
    expect(g.overdue).toEqual([late]);
    expect(g.today).toEqual([now]);
    expect(g.week).toEqual([sunday]);
    expect(g.later).toEqual([next, none]);
    // On the server's day (still Friday), the same task was "today", not overdue.
    expect(groupMyWork([late], '2026-10-09').today).toEqual([late]);
    expect(endOfWeek('2026-10-09')).toBe('2026-10-11');
    expect(endOfWeek('2026-10-11')).toBe('2026-10-11');
  });

  it('filters: assigned to me, to review, bugs', () => {
    const mine = task({ assignee_id: 7 });
    const theirs = task({ assignee_id: 8, reviewer_id: 7, status: 'in_review' });
    const bug = task({ assignee_id: 8, task_type: 'bug' });
    expect(filterMyWork([mine, theirs, bug], 'mine', 7)).toEqual([mine]);
    expect(filterMyWork([mine, theirs, bug], 'review', 7)).toEqual([theirs]);
    expect(filterMyWork([mine, theirs, bug], 'bugs', 7)).toEqual([bug]);
    expect(filterMyWork([mine, theirs, bug], 'all', 7)).toHaveLength(3);
  });

  it('draws today’s time on the 08:00–20:00 line and totals it by project, the running timer included', () => {
    const e = (id: number, start: string, minutes: number, project_id: number | null): TimeEntry => ({ id, user: 'Me', user_id: 7, project: project_id ? `P${project_id}` : null, project_code: null, project_id, task: null, task_number: null, task_id: null, on_date: '2026-10-09', started_at: start, minutes, duration: '', is_billable: true, note: null, running: false, approved: false });
    const minutesOfDay = (ms: number) => new Date(ms).getUTCHours() * 60 + new Date(ms).getUTCMinutes();
    const now = Date.parse('2026-10-09T15:00:00Z');
    const segs = daySegments([e(1, '2026-10-09 08:00:00', 120, 18), e(2, '2026-10-09T11:00:00Z', 60, 21)], { startedAt: '2026-10-09T14:00:00Z', projectId: 18, label: 'e-Auction' }, now, minutesOfDay);
    expect(segs.map((s) => [Math.round(s.left), Math.round(s.width), s.running])).toEqual([[0, 17, false], [25, 8, false], [50, 8, true]]);
    expect(perProject([e(1, '', 120, 18), e(2, '', 60, 21)], { projectId: 18, project: 'P18', seconds: 3600 })).toEqual([
      { projectId: 18, label: 'P18', minutes: 180 },
      { projectId: 21, label: 'P21', minutes: 60 },
    ]);
  });
});

describe('the sprint line (D01: “Sprint 7 · day 4 of 9”)', () => {
  it('counts the sprint’s days, both ends included', () => {
    const s = { id: 7, name: 'Sprint 7', status: 'active', start_date: '2026-10-06', end_date: '2026-10-14' };
    expect(activeSprint([{ ...s, status: 'completed' }, s], '2026-10-09')).toBe(s);
    expect(sprintDay(s, '2026-10-09')).toEqual({ day: 4, of: 9 });
    expect(sprintDay(s, '2026-11-01')).toEqual({ day: 9, of: 9 });
    expect(sprintDay({ start_date: null, end_date: null }, '2026-10-09')).toBeNull();
  });
});

describe('the Projects app’s addresses (PRJ-INT-02)', () => {
  const at = (route: string) => {
    const [p, q] = route.split('?');
    return viewOf((p ?? '').split('/').filter(Boolean), new URLSearchParams(q ?? ''));
  };
  it('reads the web’s addresses', () => {
    expect(at('/projects')).toEqual({ view: { kind: 'dashboard' }, taskId: null });
    expect(at('/projects/18')).toEqual({ view: { kind: 'board', projectId: 18 }, taskId: null });
    expect(at('/projects/18/tasks/412')).toEqual({ view: { kind: 'board', projectId: 18 }, taskId: 412 });
    expect(at('/projects/18/board')).toEqual({ view: { kind: 'board', projectId: 18 }, taskId: null });
    expect(at('/projects?project=18')).toEqual({ view: { kind: 'board', projectId: 18 }, taskId: null });
    expect(at('/projects?id=18')).toEqual({ view: { kind: 'board', projectId: 18 }, taskId: null });
    expect(at('/projects/my-work?task=402')).toEqual({ view: { kind: 'my-work' }, taskId: 402 });
    expect(at('/projects/changes/7')).toEqual({ view: { kind: 'changes', id: 7 }, taskId: null });
    expect(at('/projects/timer').view).toEqual({ kind: 'timer' });
    // DELIVERY: the timeline, milestones, sprints and workload land natively.
    expect(at('/projects/18/timeline').view).toEqual({ kind: 'timeline', projectId: 18 });
    expect(at('/projects/timeline').view).toEqual({ kind: 'timeline', projectId: null });
    expect(at('/projects/milestones').view).toEqual({ kind: 'milestones', projectId: null });
    expect(at('/projects/18/milestones?task=4')).toEqual({ view: { kind: 'milestones', projectId: 18 }, taskId: 4 });
    expect(at('/projects/sprints').view).toEqual({ kind: 'sprints', projectId: null, sprintId: null });
    expect(at('/projects/sprints/7').view).toEqual({ kind: 'sprints', projectId: null, sprintId: 7 });
    expect(at('/projects/18/sprints/7').view).toEqual({ kind: 'sprints', projectId: 18, sprintId: 7 });
    expect(at('/projects/workload').view).toEqual({ kind: 'workload' });
    expect(at('/projects/time?tab=queue').view).toEqual({ kind: 'time' });
    expect(at('/projects/18/budget').view).toEqual({ kind: 'web', path: '/projects/18/budget' });
    expect(at('/projects/sprints/x').view).toEqual({ kind: 'web', path: '/projects/sprints/x' });
    expect(boardRoute(18, 412)).toBe('/projects/18/tasks/412');
  });

  it('takes durations as the API writes them', () => {
    expect(durationMinutes('1:30')).toBe(90);
    expect(durationMinutes('90m')).toBe(90);
    expect(durationMinutes('1.5h')).toBe(90);
    expect(durationMinutes('1h30')).toBe(90);
    expect(durationMinutes('2')).toBe(120);
    expect(durationMinutes('soon')).toBeNull();
  });
});
