import { afterEach, describe, expect, it, vi } from 'vitest';
import { LocalSession, LocalWorkspace } from '../../../electron/services/local-workspace';
import { LocalWorkspaceMove, accountWall, movePayload, type MoveAccount, type MoveClient } from '../../../electron/services/local-workspace-move';

/** Signing in from guest mode (#149): moving the Local Profile into the account, without losing anything. */
const stores: LocalWorkspace[] = [];
afterEach(() => { stores.splice(0).forEach((store) => store.close()); });
const account: MoveAccount = { key: 'acct-1', orgId: '7', timezone: 'Asia/Colombo' };

function fixture() {
  const store = new LocalWorkspace(':memory:'); stores.push(store);
  store.saveProfile({ name: 'Nimal' });
  store.save({ kind: 'note', title: 'Note A', body: '<p>a</p>', meta: { html: true, tags: ['x'] } });
  store.save({ kind: 'task', title: 'Task B', body: 'plain', completed: false, due: '2026-11-02T10:00:00Z', meta: { checklist: [{ id: 1, title: 'Step', done: true }] } });
  store.save({ kind: 'event', title: 'Event C', start: '2026-11-05T03:30:00Z', end: '2026-11-05T04:30:00Z', reminder: '2026-11-05T03:00:00Z' });
  store.saveContact({ display_name: 'Kavya', labels: ['family'], log: [{ id: 9, body: 'Met at school', pinned: false, created_at: '2026-10-01 10:00:00', updated_at: null }] });
  let backup: string | null = null;
  const files = { exists: () => backup !== null, write: vi.fn((text: string) => { backup = text; }), remove: vi.fn(() => { backup = null; }) };
  let next = 100;
  const client = {
    get: vi.fn<MoveClient['get']>(async () => ({ id: 1 })),
    post: vi.fn<MoveClient['post']>(async () => ({ id: next++ })),
    put: vi.fn<MoveClient['put']>(async () => ({})),
  };
  const mover = new LocalWorkspaceMove(store, files);
  let current: string | null = account.key;
  return { store, files, client, mover, backup: () => backup, current: () => current, switchTo: (key: string | null) => { current = key; } };
}

describe('moving local data into the account', () => {
  it('offers counts only, uploads every kind through the normal APIs, confirms, then removes the local copies and the backup', async () => {
    const { store, files, client, mover, current } = fixture();
    expect(mover.offer(account.key)).toEqual({ notes: 1, tasks: 1, contacts: 1, events: 1, total: 4 });
    const result = await mover.run(account, client, current);
    expect(result).toEqual({ moved: 4, failures: [], remaining: 0, backupKept: false });
    const paths = client.post.mock.calls.map(([path]) => path);
    expect(paths).toEqual(expect.arrayContaining(['/api/notes', '/api/tasks', '/api/calendar/events', '/api/contacts', expect.stringMatching(/^\/api\/tasks\/\d+\/checklist$/), expect.stringMatching(/^\/api\/contacts\/\d+\/notes$/)]));
    for (const [, , key] of client.post.mock.calls) expect(key).toMatch(/^local-move-[a-f0-9]{64}$/);
    expect(client.put).toHaveBeenCalledWith(expect.stringMatching(/^\/api\/tasks\/\d+\/checklist\/\d+$/), { done: true }, expect.any(String));
    // The backup was written before the first upload, and removed only after the account confirmed every record.
    expect(files.write.mock.invocationCallOrder[0]!).toBeLessThan(client.post.mock.invocationCallOrder[0]!);
    expect(client.get).toHaveBeenCalledTimes(4);
    expect(files.remove).toHaveBeenCalled();
    expect(store.items()).toEqual([]);
    expect(store.contacts()).toEqual([]);
    expect(store.profile()).toMatchObject({ name: 'Nimal' });
  });

  it('reports a partial failure per item, keeps every item and the backup, and resumes without uploading anything twice', async () => {
    const { store, client, mover, backup, current } = fixture();
    client.post.mockImplementation(async (path) => {
      if (path === '/api/tasks') throw new Error('The server is busy.');
      return { id: 500 + client.post.mock.calls.length };
    });
    const first = await mover.run(account, client, current);
    expect(first).toMatchObject({ moved: 3, failures: [{ kind: 'task', title: 'Task B', message: 'The server is busy.' }], remaining: 1, backupKept: true });
    expect(JSON.parse(backup()!)).toMatchObject({ format: 'worksuite-local', items: expect.any(Array), contacts: [expect.objectContaining({ display_name: 'Kavya' })] });
    expect(store.items()).toHaveLength(3);
    expect(store.contacts()).toHaveLength(1);
    expect(client.get).not.toHaveBeenCalled();
    expect(mover.offer(account.key)).toMatchObject({ tasks: 1, total: 1 });
    const firstNoteKey = client.post.mock.calls.find(([path]) => path === '/api/notes')![2];
    const failedTaskKey = client.post.mock.calls.find(([path]) => path === '/api/tasks')![2];

    client.post.mockClear();
    client.post.mockImplementation(async () => ({ id: 900 }));
    const second = await mover.run(account, client, current);
    expect(second).toEqual({ moved: 1, failures: [], remaining: 0, backupKept: false });
    // Only the task went up again, with the same idempotency key; the note was not uploaded twice.
    expect(client.post.mock.calls.filter(([path]) => path === '/api/notes')).toEqual([]);
    expect(client.post.mock.calls.find(([path]) => path === '/api/tasks')![2]).toBe(failedTaskKey);
    expect(firstNoteKey).not.toBe(failedTaskKey);
    expect(store.items()).toEqual([]);
    expect(backup()).toBeNull();
  });

  it('keeps everything when the account cannot confirm an upload yet', async () => {
    const { store, client, mover, backup, current } = fixture();
    client.get.mockRejectedValueOnce(new Error('offline'));
    const result = await mover.run(account, client, current);
    expect(result.failures).toEqual([expect.objectContaining({ message: expect.stringContaining('has not confirmed it yet') })]);
    expect(result.backupKept).toBe(true);
    expect(backup()).not.toBeNull();
    expect(store.items()).toHaveLength(3);
    // Nothing is left to upload; trying again only confirms.
    client.post.mockClear();
    expect(await mover.run(account, client, current)).toMatchObject({ failures: [], backupKept: false });
    expect(client.post).not.toHaveBeenCalled();
  });

  it('stops writing when the account changes, and never moves into the other account', async () => {
    const { client, mover, switchTo, store } = fixture();
    switchTo('acct-2');
    const result = await mover.run(account, client, () => 'acct-2');
    expect(client.post).not.toHaveBeenCalled();
    expect(result.failures).toHaveLength(4);
    expect(store.items()).toHaveLength(3);
  });

  it('sends what the account’s own screens send', () => {
    const { store } = fixture();
    const [note, task, event] = ['note', 'task', 'event'].map((kind) => store.items().find((i) => i.kind === kind)!);
    expect(movePayload({ kind: 'note', item: note! }, account)).toEqual({ title: 'Note A', body: '<p>a</p>', tags: ['x'] });
    expect(movePayload({ kind: 'task', item: task! }, account)).toMatchObject({ title: 'Task B', description: '<p>plain</p>', status: 'todo', due_date: '2026-11-02T15:30', org_id: 7 });
    expect(movePayload({ kind: 'event', item: event! }, account)).toMatchObject({ start: '2026-11-05T09:00', end: '2026-11-05T10:00', all_day: false, remind_minutes: 30 });
    expect(movePayload({ kind: 'contact', item: store.contacts()[0]! }, account)).toMatchObject({ display_name: 'Kavya', labels: 'family' });
    expect(accountWall('2026-11-02T10:00:00Z', 'UTC')).toBe('2026-11-02T10:00');
  });
});

describe('guest mode and accounts stay apart', () => {
  it('ends guest mode on sign-in, offers the move only to that window and account, and closes the Local Profile on sign-out', () => {
    const store = new LocalWorkspace(':memory:'); stores.push(store);
    store.saveProfile({ name: 'Nimal', pin: '4826' });
    const session = new LocalSession(store);
    expect(() => session.require(1)).toThrow('Continue as Guest');
    session.enter(1);
    expect(() => session.require(1)).toThrow('PIN first');
    expect(session.access.unlock(1, '4826').unlocked).toBe(true);
    session.require(1);
    session.signedIn(null);
    // Signed in: guest mode is over in every window; the PIN is needed again for guest mode.
    expect(session.isGuest(1)).toBe(false);
    expect(() => session.require(1)).toThrow();
    expect(session.moveAccount(2, 'acct-1')).toBeNull();
    expect(session.moveAccount(1, 'acct-1')).toBe('acct-1');
    expect(session.moveAccount(1, 'acct-2')).toBeNull();
    // Signed out: nobody is offered the Local Profile's data, and guest mode starts again with its PIN.
    session.signedOut();
    expect(session.moveAccount(1, 'acct-1')).toBeNull();
    session.enter(1);
    expect(session.access.locked(1)).toBe(true);
  });

  it('offers no move from a window that never got past the PIN', () => {
    const store = new LocalWorkspace(':memory:'); stores.push(store);
    store.saveProfile({ name: 'Nimal', pin: '4826' });
    const session = new LocalSession(store);
    session.enter(1);
    session.signedIn('acct-1');
    expect(session.moveAccount(1, 'acct-1')).toBeNull();
  });
});
