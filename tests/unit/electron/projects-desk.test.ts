import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({ app: { getPath: () => '/tmp', getVersion: () => '0.1.0' }, safeStorage: {} }));

import { EMPTY_TIMER, entryUntil, isConflict, nextToSend, type ProjectsOutboxItem } from '@shared/projects';
import { DesktopError } from '../../../electron/main/errors';
import { Database } from '../../../electron/services/db';
import type { Incoming } from '../../../electron/services/notifications';
import { ProjectNotices, noticeRoute, projectNoticeKind, taskOfLink } from '../../../electron/services/projects/notices';
import { ProjectsOutbox, outcomeOf } from '../../../electron/services/projects/outbox';
import { ProjectsTimer, recentTargets, runningOf } from '../../../electron/services/projects/timer';
import { Vault } from '../../../electron/services/vault';

/**
 * A small Projects server: tasks with their versions, comments, time entries (one may be running), and a switch for
 * the connection. Requests with an `Idempotency-Key` it has seen are answered without doing anything twice, as a
 * server that honours the key does.
 */
function server() {
  const s = {
    online: true,
    /** Fail the next request of this method+path after doing it (the answer lost on the way back). */
    loseAnswer: null as string | null,
    tasks: new Map<number, { status: string; updated_at: string; updated_by: string; task_number: string; title: string }>(),
    comments: [] as Array<{ task: number; body: string }>,
    entries: [] as Array<{ id: number; minutes: number; running: boolean; started_at: string; task_id: number | null; project_id: number | null; on_date: string }>,
    seen: new Set<string>(),
    calls: [] as Array<{ method: string; path: string; key: string | null; body: unknown }>,
    nextId: 100,
  };
  const offline = () => new DesktopError('NETWORK_UNREACHABLE', 'Cannot reach WorkSuite server.');
  const request = vi.fn(async (method: string, path: string, opts: { body?: unknown; headers?: Record<string, string>; query?: unknown } = {}): Promise<unknown> => {
    if (!s.online) throw offline();
    const key = opts.headers?.['Idempotency-Key'] ?? null;
    s.calls.push({ method, path, key, body: opts.body });
    const done = (answer: unknown) => {
      if (s.loseAnswer === `${method} ${path}`) {
        s.loseAnswer = null;
        throw offline();
      }
      return answer;
    };
    if (key && s.seen.has(key)) return done({ replayed: true });
    if (key) s.seen.add(key);
    let m: RegExpExecArray | null;
    if (method === 'GET' && (m = /^\/api\/projects\/tasks\/(\d+)$/.exec(path))) {
      const t = s.tasks.get(Number(m[1]));
      if (!t) throw new DesktopError('NOT_FOUND', 'Task not found', 404);
      return { task: { id: Number(m[1]), ...t } };
    }
    if (method === 'POST' && (m = /^\/api\/projects\/tasks\/(\d+)\/move$/.exec(path))) {
      const t = s.tasks.get(Number(m[1]))!;
      t.status = String((opts.body as { status: string }).status);
      t.updated_at = `2026-10-09 12:00:${String(s.calls.length).padStart(2, '0')}`;
      t.updated_by = 'Me';
      return done({});
    }
    if (method === 'POST' && (m = /^\/api\/projects\/tasks\/(\d+)\/comments$/.exec(path))) {
      s.comments.push({ task: Number(m[1]), body: String((opts.body as { body: string }).body) });
      return done({});
    }
    if (method === 'POST' && path === '/api/projects/time/log') {
      const b = opts.body as { duration: string; task_id: number | null; project_id: number | null; on_date: string };
      const [h, mm] = b.duration.split(':').map(Number) as [number, number];
      s.entries.push({ id: s.nextId++, minutes: h * 60 + mm, running: false, started_at: '', task_id: b.task_id, project_id: b.project_id, on_date: b.on_date });
      return done({});
    }
    if (method === 'DELETE' && (m = /^\/api\/projects\/time\/(\d+)$/.exec(path))) {
      const i = s.entries.findIndex((e) => e.id === Number(m![1]));
      if (i < 0) throw new DesktopError('NOT_FOUND', 'Entry not found', 404);
      s.entries.splice(i, 1);
      return done({});
    }
    if (method === 'POST' && path === '/api/projects/time/stop') {
      const r = s.entries.find((e) => e.running);
      if (!r) throw new DesktopError('CONFLICT', 'No timer is running', 409);
      r.running = false;
      r.minutes = 60;
      return done({});
    }
    if (method === 'GET' && path === '/api/projects/time/running') {
      const r = s.entries.find((e) => e.running);
      return { timer: r ? { id: r.id, started_at: r.started_at, task_id: r.task_id, task_number: 'TSK-0412', task: 'Bidder KYC document upload', project_id: r.project_id, note: null } : null };
    }
    if (method === 'GET' && path === '/api/projects/time') return { entries: s.entries.map((e) => ({ ...e, project: 'e-Auction portal', project_code: 'PRJ-0018', task: 'KYC', task_number: 'TSK-0412' })) };
    return {};
  });
  return { s, http: { request } as never };
}

function outboxWith(http: unknown) {
  const db = new Database(':memory:');
  const vault = new Vault(Vault.generateKey());
  const changed = vi.fn();
  const outbox = new ProjectsOutbox({ db, vault: () => vault, http: http as never, origin: () => 'https://ws.test', user: () => '7', changed });
  return { db, outbox, changed };
}

const T1 = '2026-10-09 08:00:00';

describe('projects outbox: order, idempotency and conflicts (PRJ-DSK-04, NFR-09)', () => {
  it('keeps what is done offline, in order, and replays it in that order when the connection is back', async () => {
    const { s, http } = server();
    s.tasks.set(402, { status: 'in_progress', updated_at: T1, updated_by: 'Me', task_number: 'TSK-0402', title: 'Broker role permissions' });
    const { outbox } = outboxWith(http);
    s.online = false;
    const a = await outbox.submit({ kind: 'move', taskId: 402, status: 'in_review', baseUpdatedAt: T1, label: 'Move TSK-0402 to In review' });
    const b = await outbox.submit({ kind: 'comment', taskId: 412, body: 'Uploads fixed', label: 'Comment on TSK-0412' });
    const c = await outbox.submit({ kind: 'log', duration: '1:30', onDate: '2026-10-09', projectId: 18, taskId: 412, billable: true, label: 'Log 1:30 on TSK-0412 · billable' });
    expect([a, b, c].map((r) => [r.queued, r.delivered])).toEqual([[true, false], [true, false], [true, false]]);
    expect(outbox.list().map((i) => [i.seq, i.kind, i.state])).toEqual([[1, 'move', 'waiting'], [2, 'comment', 'waiting'], [3, 'log', 'waiting']]);
    expect(outbox.pending()).toBe(3);

    s.online = true;
    const r = await outbox.replay();
    expect(r.online).toBe(true);
    expect(s.calls.filter((x) => x.method !== 'GET').map((x) => `${x.method} ${x.path}`)).toEqual(['POST /api/projects/tasks/402/move', 'POST /api/projects/tasks/412/comments', 'POST /api/projects/time/log']);
    expect(s.tasks.get(402)!.status).toBe('in_review');
    expect(s.comments).toEqual([{ task: 412, body: 'Uploads fixed' }]);
    expect(s.entries).toHaveLength(1);
    expect(outbox.list()).toEqual([]);
  });

  it('sends each item with its own key, the same key on every try, so a lost answer is not a second change', async () => {
    const { s, http } = server();
    const { outbox } = outboxWith(http);
    s.online = false;
    await outbox.submit({ kind: 'log', duration: '0:45', onDate: '2026-10-09', projectId: 18, taskId: null, billable: false, label: 'Log 0:45' });
    s.online = true;
    s.loseAnswer = 'POST /api/projects/time/log';
    await outbox.replay();
    // The server logged it, but the answer never came: still waiting.
    expect(s.entries).toHaveLength(1);
    expect(outbox.list()[0]!.state).toBe('waiting');
    await outbox.replay();
    await outbox.replay();
    const logs = s.calls.filter((x) => x.path === '/api/projects/time/log');
    expect(logs).toHaveLength(2);
    expect(new Set(logs.map((l) => l.key)).size).toBe(1);
    expect(logs[0]!.key).toMatch(/^wsd-prj-/);
    expect(s.entries).toHaveLength(1);
    expect(outbox.list()).toEqual([]);
  });

  it('a later change waits behind an earlier one: nothing overtakes it while it is in line', async () => {
    const { s, http } = server();
    s.tasks.set(5, { status: 'todo', updated_at: T1, updated_by: 'Me', task_number: 'TSK-5', title: 'A' });
    const { outbox } = outboxWith(http);
    s.online = false;
    await outbox.submit({ kind: 'move', taskId: 5, status: 'in_progress', baseUpdatedAt: T1, label: 'Move' });
    s.online = true;
    // Online again, but the first is still waiting: the comment goes behind it, then both go in order.
    const r = await outbox.submit({ kind: 'comment', taskId: 5, body: 'second', label: 'Comment' });
    expect(r.delivered).toBe(true);
    expect(s.calls.filter((x) => x.method === 'POST').map((x) => x.path)).toEqual(['/api/projects/tasks/5/move', '/api/projects/tasks/5/comments']);
  });

  it('does not overwrite a task somebody changed meanwhile: it asks, and holds a later move of that task', async () => {
    const { s, http } = server();
    s.tasks.set(402, { status: 'in_progress', updated_at: T1, updated_by: 'Me', task_number: 'TSK-0402', title: 'Broker role permissions' });
    const { outbox } = outboxWith(http);
    s.online = false;
    await outbox.submit({ kind: 'move', taskId: 402, status: 'in_review', baseUpdatedAt: T1, label: 'Move TSK-0402 to In review' });
    await outbox.submit({ kind: 'move', taskId: 402, status: 'testing', baseUpdatedAt: T1, label: 'Move TSK-0402 to Testing' });
    await outbox.submit({ kind: 'comment', taskId: 402, body: 'note', label: 'Comment on TSK-0402' });
    // Sachini moved it while I was offline.
    s.tasks.set(402, { ...s.tasks.get(402)!, status: 'completed', updated_at: '2026-10-09 09:15:00', updated_by: 'Sachini' });
    s.online = true;
    await outbox.replay();
    const items = outbox.list();
    expect(items.map((i) => [i.label, i.state])).toEqual([
      ['Move TSK-0402 to In review', 'conflict'],
      ['Move TSK-0402 to Testing', 'waiting'],
    ]);
    expect(items[0]!.theirs).toMatchObject({ status: 'completed', updatedBy: 'Sachini', number: 'TSK-0402' });
    // Never overwritten: theirs stands; the comment (which overwrites nothing) went.
    expect(s.tasks.get(402)!.status).toBe('completed');
    expect(s.comments).toHaveLength(1);
    expect(s.calls.some((c) => c.method === 'POST' && c.path.endsWith('/move'))).toBe(false);

    // Apply mine: sent now, from the version I have now seen; the move behind it then asks again (it was made from the old copy).
    await outbox.resolve(items[0]!.id, 'mine');
    expect(s.tasks.get(402)!.status).toBe('in_review');
    const left = outbox.list();
    expect(left.map((i) => [i.label, i.state])).toEqual([['Move TSK-0402 to Testing', 'conflict']]);
    // Keep theirs: my move is dropped.
    await outbox.resolve(left[0]!.id, 'theirs');
    expect(outbox.list()).toEqual([]);
    expect(s.tasks.get(402)!.status).toBe('in_review');
  });

  it('a refused change is kept with the server’s reason, and does not stop the line', async () => {
    const { s, http } = server();
    const { outbox } = outboxWith(http);
    s.online = false;
    await outbox.submit({ kind: 'move', taskId: 999, status: 'completed', baseUpdatedAt: T1, label: 'Move gone task' });
    await outbox.submit({ kind: 'comment', taskId: 12, body: 'x', label: 'Comment' });
    s.online = true;
    await outbox.replay();
    expect(outbox.list().map((i) => [i.label, i.state, i.message])).toEqual([['Move gone task', 'refused', 'Task not found']]);
    expect(s.comments).toHaveLength(1);
    expect(outbox.pending()).toBe(0);
  });

  it('is per person and server, and goes on sign-out', async () => {
    const { s, http } = server();
    const { outbox } = outboxWith(http);
    s.online = false;
    await outbox.submit({ kind: 'comment', taskId: 1, body: 'x', label: 'Comment' });
    expect(outbox.list()).toHaveLength(1);
    outbox.wipeUser('7');
    expect(outbox.list()).toEqual([]);
  });

  it('nextToSend and isConflict, as rules', () => {
    const item = (seq: number, over: Partial<ProjectsOutboxItem>) => ({ seq, state: 'waiting' as const, kind: 'move' as const, taskId: 1, ...over });
    expect(nextToSend([item(2, {}), item(1, {})])!.seq).toBe(1);
    expect(nextToSend([item(1, { state: 'conflict' }), item(2, {}), item(3, { kind: 'comment' })])!.seq).toBe(3);
    expect(nextToSend([item(1, { state: 'conflict' }), item(2, { taskId: 2 })])!.seq).toBe(2);
    expect(nextToSend([item(1, { state: 'sending' })])).toBeNull();
    expect(isConflict(T1, { status: 'completed', updated_at: '2026-10-09 09:00:00' }, 'in_review')).toBe(true);
    expect(isConflict(T1, { status: 'completed', updated_at: T1 }, 'in_review')).toBe(false);
    // The same moment written another way is the same version.
    expect(isConflict('2026-10-09T08:00:00Z', { status: 'completed', updated_at: T1 }, 'in_review')).toBe(false);
    // Where I put it already: nothing to ask.
    expect(isConflict(T1, { status: 'in_review', updated_at: '2026-10-09 09:00:00' }, 'in_review')).toBe(false);
    expect(isConflict(null, { status: 'completed', updated_at: '2026-10-09 09:00:00' }, 'in_review')).toBe(false);
    expect(outcomeOf(new DesktopError('NETWORK_UNREACHABLE', 'x')).outcome).toBe('offline');
    expect(outcomeOf(new DesktopError('SERVER_ERROR', 'x', 503)).outcome).toBe('later');
    expect(outcomeOf(new DesktopError('CONFLICT', 'x', 409)).outcome).toBe('conflict');
    expect(outcomeOf(new DesktopError('IPC_VALIDATION_FAILED', 'x', 422)).outcome).toBe('refused');
  });
});

describe('projects timer: idle and the one entry (PRJ-TIM-05, acceptance #11)', () => {
  const NOW = Date.parse('2026-10-09T10:00:00Z');

  function timerWith(idle: number, startedMinutesAgo = 60) {
    const { s, http } = server();
    s.entries.push({ id: 41, minutes: 0, running: true, started_at: new Date(NOW - startedMinutesAgo * 60_000).toISOString(), task_id: 412, project_id: 18, on_date: '2026-10-09' });
    const { outbox } = outboxWith(http);
    const notify = vi.fn<(n: Incoming) => void>();
    let now = NOW;
    const idleRef = { v: idle };
    const timer = new ProjectsTimer({ http, enabled: () => true, outbox, notify, idleSeconds: () => idleRef.v, changed: () => undefined, now: () => now, zone: () => 'UTC' });
    return { s, outbox, notify, timer, idleRef, setNow: (t: number) => (now = t) };
  }

  it('asks once after fifteen idle minutes, and Drop idle time leaves exactly one entry, up to when the idle began', async () => {
    const { s, notify, timer, idleRef } = timerWith(20 * 60);
    await timer.refresh();
    expect(timer.get().running).toMatchObject({ id: 41, taskNumber: 'TSK-0412' });
    timer.checkIdle();
    timer.checkIdle();
    expect(notify).toHaveBeenCalledTimes(1);
    const n = notify.mock.calls[0]![0];
    expect(n.title).toBe('Still working on TSK-0412?');
    expect(n.body).toBe('No keyboard or mouse for 20 minutes. Keep the time or drop the idle part.');
    expect(n.custom?.actions).toEqual(['Keep 15 min', 'Drop idle time']);
    expect(n.custom?.persistent).toBe(true);
    expect(n.category).toBe('projects');

    await n.custom!.onAction(1);
    expect(s.entries).toEqual([expect.objectContaining({ running: false, minutes: 40, task_id: 412, project_id: 18, on_date: '2026-10-09' })]);
    expect(timer.get().running).toBeNull();
    // Back at the keyboard and idle again: a new stretch may ask again (nothing is running now, so it does not).
    idleRef.v = 10;
    timer.checkIdle();
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it('Keep 15 min changes nothing; the timer runs on and stops as one entry', async () => {
    const { s, notify, timer } = timerWith(16 * 60);
    await timer.refresh();
    timer.checkIdle();
    await notify.mock.calls[0]![0].custom!.onAction(0);
    expect(s.entries).toEqual([expect.objectContaining({ running: true })]);
    await timer.end();
    expect(s.entries).toHaveLength(1);
    expect(s.entries[0]!.running).toBe(false);
  });

  it('dropped while WorkSuite is out of reach: kept as one item, replayed as one entry, however often it is replayed', async () => {
    const { s, outbox, timer } = timerWith(20 * 60);
    await timer.refresh();
    s.online = false;
    await timer.stopAt(NOW - 20 * 60_000);
    expect(timer.get().running).toBeNull();
    expect(outbox.list().map((i) => i.kind)).toEqual(['stop']);
    expect(s.entries).toHaveLength(1);
    s.online = true;
    // The removal goes through, the log's answer is lost: the next try logs it, once, and removes nothing twice.
    s.loseAnswer = 'POST /api/projects/time/log';
    await outbox.replay();
    await outbox.replay();
    await outbox.replay();
    expect(s.entries).toEqual([expect.objectContaining({ running: false, minutes: 40 })]);
    expect(s.calls.filter((c) => c.method === 'DELETE')).toHaveLength(1);
    expect(outbox.list()).toEqual([]);
    // Read again before the replay, the timer would not show as running.
    expect(timer.get().running).toBeNull();
  });

  it('a stop that cannot reach WorkSuite is kept with its moment, and the timer is not shown running meanwhile', async () => {
    const { s, outbox, timer, setNow } = timerWith(0, 30);
    await timer.refresh();
    s.online = false;
    setNow(NOW + 5 * 60_000);
    await timer.end();
    expect(outbox.list()).toEqual([expect.objectContaining({ kind: 'stop', label: expect.stringContaining('Stop the timer on TSK-0412') })]);
    s.online = true;
    // The timer is read again before the outbox is sent: still not running here.
    await timer.refresh();
    expect(timer.get().running).toBeNull();
    await outbox.replay();
    expect(s.entries).toEqual([expect.objectContaining({ running: false, minutes: 35 })]);
  });

  it('switching stops what runs and starts the other; starting offline says it needs a connection', async () => {
    const { s, timer } = timerWith(0);
    await timer.refresh();
    await timer.switchTo({ taskId: 409, projectId: 18 });
    expect(s.calls.filter((c) => c.method === 'POST').map((c) => c.path)).toEqual(['/api/projects/time/stop', '/api/projects/time/start']);
    s.online = false;
    await expect(timer.begin({ taskId: 1, projectId: null })).rejects.toThrow(/needs a connection/);
  });

  it('reads the running timer and the week: totals, and Switch to without what runs', () => {
    const r = runningOf({ id: 3, started_at: '2026-10-09 09:00:00', task_id: 7, project_id: 2, note: null }, NOW);
    expect(r!.startedAt).toBe('2026-10-09T09:00:00.000Z');
    expect(runningOf({ id: 3, started_at: '2026-10-09 14:30:00', elapsed_seconds: 600, task_id: 7, project_id: 2 }, NOW)!.startedAt).toBe('2026-10-09T09:50:00.000Z');
    const e = (id: number, task_id: number | null, on_date: string, minutes: number) => ({ id, task_id, project_id: 18, on_date, minutes, started_at: null, project: 'P', project_code: 'PRJ-1', task: task_id ? `T${task_id}` : null, task_number: task_id ? `TSK-${task_id}` : null });
    const recent = recentTargets([e(1, 7, '2026-10-07', 30), e(2, 9, '2026-10-09', 60), e(3, 7, '2026-10-08', 15), e(4, null, '2026-10-06', 20)], { taskId: 9, projectId: 18 });
    expect(recent.map((x) => [x.number, x.minutes])).toEqual([['TSK-7', 45], ['PRJ-1', 20]]);
    expect(entryUntil({ ...r!, billable: true }, Date.parse('2026-10-09T09:00:30Z'))).toBeNull();
    expect(entryUntil({ ...r!, billable: true }, Date.parse('2026-10-09T10:30:00Z'), 'UTC')!.body).toEqual({ duration: '1:30', on_date: '2026-10-09', project_id: 2, task_id: 7, note: null, is_billable: true });
    expect(EMPTY_TIMER.running).toBeNull();
  });
});

describe('projects banners with buttons (PRJ-DSK-03)', () => {
  it('knows its kinds and where each opens', () => {
    expect(projectNoticeKind('project.change_waiting')).toBe('change');
    expect(projectNoticeKind('project.task_overdue')).toBe('overdue');
    expect(projectNoticeKind('task.overdue')).toBeNull();
    expect(projectNoticeKind('project.milestone')).toBeNull();
    expect(taskOfLink('/tasks?task=402')).toEqual({ projectId: null, taskId: 402 });
    expect(taskOfLink('/projects/18/tasks/402')).toEqual({ projectId: 18, taskId: 402 });
    expect(noticeRoute('overdue', '/projects/18/tasks/402')).toBe('/projects/18/tasks/402');
    expect(noticeRoute('overdue', '/tasks?task=402')).toBe('/projects/my-work?task=402');
    expect(noticeRoute('change', '/projects/changes/7')).toBe('/projects/changes/7');
  });

  it('claims them with Review, or Open task and Snooze 1 day — the snooze kept on this computer and back a day later', async () => {
    const db = new Database(':memory:');
    const notify = vi.fn<(n: Incoming) => void>();
    const open = vi.fn();
    const markRead = vi.fn(async () => undefined);
    let now = Date.parse('2026-10-09T09:00:00Z');
    const notices = new ProjectNotices({ db, notify, markRead, open, enabled: () => true, user: () => '7', now: () => now });
    expect(notices.claim({ id: '55', event: 'mail.new', title: 'x', body: 'y', link: null, category: null, priority: null })).toBe(false);
    expect(notices.claim({ id: '56', event: 'project.change_waiting', title: 'Change request waiting for you', body: 'CR-0007 · PRJ-0018 · +LKR 1.2M, +14 days', link: '/projects/changes/7', category: 'projects', priority: null })).toBe(true);
    expect(notify.mock.calls[0]![0]).toMatchObject({ module: 'projects', category: 'projects', link: '/projects/changes/7', custom: { actions: ['Review'] } });
    await notify.mock.calls[0]![0].custom!.onAction(0);
    expect(open).toHaveBeenCalledWith('/projects/changes/7');
    expect(markRead).toHaveBeenCalledWith(['56']);

    const overdue = { id: '57', event: 'project.task_overdue', title: 'Overdue: Broker role permissions', body: 'PRJ-0018 · TSK-0402 — was due 2026-10-08 (1 day(s) ago)', link: '/tasks?task=402', category: 'projects', priority: null };
    notices.claim(overdue);
    const banner = notify.mock.calls[1]![0];
    expect(banner.custom!.actions).toEqual(['Open task', 'Snooze 1 day']);
    await banner.custom!.onAction(1);
    notices.tick();
    expect(notify).toHaveBeenCalledTimes(2);
    now += 24 * 60 * 60_000;
    notices.tick();
    expect(notify).toHaveBeenCalledTimes(3);
    expect(notify.mock.calls[2]![0]).toMatchObject({ id: '57:again:1', title: 'Overdue: Broker role permissions' });
    notices.tick();
    expect(notify).toHaveBeenCalledTimes(3);
  });
});
