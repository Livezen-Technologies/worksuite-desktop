import { mkdtempSync, rmSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { LOCAL_SCHEMA_VERSION, LocalWorkspace } from '../../../electron/services/local-workspace';
import { LocalApi, NEEDS_ACCOUNT, instantOf, wallOf, type LocalApiMethod } from '../../../electron/services/local-api';

/** Guest mode's storage layer (#149): the module screens' API requests, answered from the Local Profile on this device. */
const stores: LocalWorkspace[] = [];
const folders: string[] = [];
afterEach(() => {
  stores.splice(0).forEach((store) => { try { store.close(); } catch { /* closed by the test */ } });
  for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true });
});
function setup() {
  const store = new LocalWorkspace(':memory:'); stores.push(store);
  const api = new LocalApi(store, () => 'Nimal');
  const ask = (method: LocalApiMethod, path: string, body?: unknown, query?: Record<string, string>) => api.handle({ method, path, body, query });
  const ok = <T = Record<string, unknown>>(method: LocalApiMethod, path: string, body?: unknown, query?: Record<string, string>): T => {
    const r = ask(method, path, body, query);
    expect(r.status, r.message ?? '').toBe(200);
    return r.data as T;
  };
  return { store, ask, ok };
}

describe('Notes on this device', () => {
  it('creates, edits, searches, flags and deletes notes in the shapes the Notes screens read', () => {
    const { ok, ask } = setup();
    const { id } = ok<{ id: number }>('POST', '/api/notes', { title: 'Café budget', body: '<p>Quarterly numbers</p>' });
    ok('POST', '/api/notes', { title: 'Shopping', body: '<p>milk, bread</p>' });
    const detail = ok('GET', `/api/notes/${id}`);
    expect(detail).toMatchObject({ id, title: 'Café budget', body: '<p>Quarterly numbers</p>', my_role: 'owner', shares: [] });
    ok('PUT', `/api/notes/${id}`, { title: 'Café budget 2027', body: '<p>Quarterly <b>numbers</b></p>', tags: ['money'] });
    expect(ok<Array<{ title: string; excerpt: string }>>('GET', '/api/notes', undefined, { q: 'cafe numbers' })).toEqual([expect.objectContaining({ title: 'Café budget 2027', excerpt: 'Quarterly numbers', tags: ['money'] })]);
    expect(ok<unknown[]>('GET', '/api/notes', undefined, { q: 'bread budget' })).toEqual([]);
    expect(ok('POST', `/api/notes/${id}/pin`)).toMatchObject({ is_pinned: true });
    expect(ok<Array<{ id: number }>>('GET', '/api/notes')[0]!.id).toBe(id);
    expect(ok('GET', '/api/notes/stats')).toMatchObject({ total: 2, pinned: 1 });
    ok('POST', `/api/notes/${id}/archive`);
    expect(ok<unknown[]>('GET', '/api/notes')).toHaveLength(1);
    expect(ok<unknown[]>('GET', '/api/notes', undefined, { archived: '1' })).toHaveLength(1);
    ok('DELETE', `/api/notes/${id}`);
    expect(ask('GET', `/api/notes/${id}`).status).toBe(404);
  });

  it('reads #86 plain-text notes as HTML, and answers 403 with a sentence for what needs an account', () => {
    const { store, ok, ask } = setup();
    const old = store.save({ kind: 'note', title: 'Old', body: 'line <1>\nline 2' });
    const n = store.numberOf(old.id);
    expect(ok('GET', `/api/notes/${n}`)).toMatchObject({ body: '<p>line &lt;1&gt;<br>line 2</p>' });
    for (const [method, path] of [['GET', `/api/notes/${n}/shares`], ['GET', '/api/mail/messages'], ['GET', '/api/drive/files'], ['POST', '/api/chat/rooms/direct']] as const) {
      expect(ask(method, path)).toEqual({ status: 403, data: null, message: NEEDS_ACCOUNT });
    }
  });
});

describe('Tasks on this device', () => {
  it('lists tasks with due dates (a day, or a time on this computer), and changes them field by field', () => {
    const { ok, ask } = setup();
    const a = ok<{ id: number }>('POST', '/api/tasks', { title: 'Pay rent', description: '<p>Bank</p>', status: 'todo', priority: 'high', due_date: '2026-11-01' }).id;
    const b = ok<{ id: number }>('POST', '/api/tasks', { title: 'Call Kavya', due_date: '2026-11-02T15:30', tags: ['home'] }).id;
    const list = ok<{ tasks: Array<Record<string, unknown>> }>('GET', '/api/tasks').tasks;
    expect(list.find((t) => t.id === a)).toMatchObject({ title: 'Pay rent', status: 'todo', priority: 'high', due_date: '2026-11-01', due_at: null });
    expect(list.find((t) => t.id === b)).toMatchObject({ due_date: '2026-11-02', due_at: instantOf('2026-11-02T15:30'), tags: ['home'] });
    expect(ok('PATCH', `/api/tasks/${a}`, { field: 'status', value: 'done' })).toMatchObject({ status: 'done', progress: 100 });
    expect(ok('PATCH', `/api/tasks/${b}`, { field: 'due_date', value: '2026-12-24' })).toMatchObject({ due_date: '2026-12-24', due_at: null });
    expect(ask('PATCH', `/api/tasks/${b}`, { field: 'assignee_id', value: 4 }).status).toBe(403);
    expect(ok('GET', `/api/tasks/${a}`)).toMatchObject({ comments: [], can_edit: expect.objectContaining({ title: true, assignee_id: false }) });
    ok('POST', `/api/tasks/${a}/checklist`, { title: 'Transfer' });
    ok('PUT', `/api/tasks/${a}/checklist/1`, { done: true });
    expect(ok('GET', `/api/tasks/${a}`)).toMatchObject({ checklist: [{ id: 1, title: 'Transfer', done: true }], checklist_done: 1, checklist_total: 1 });
    ok('PUT', `/api/tasks/${a}`, { archived: true });
    expect(ok<{ tasks: unknown[] }>('GET', '/api/tasks').tasks).toHaveLength(1);
    expect(ok<{ tasks: unknown[] }>('GET', '/api/tasks', undefined, { filter: 'shared' }).tasks).toEqual([]);
    ok('DELETE', `/api/tasks/${b}`);
    expect(ask('GET', `/api/tasks/${b}`).status).toBe(404);
  });

  it('keeps one reminder per task, before its due time or at a chosen time, and moves it with the due date', () => {
    const { ok, store } = setup();
    const id = ok<{ id: number }>('POST', '/api/tasks', { title: 'Renew licence', due_date: '2026-11-02T15:30', reminders: [{ offset_minutes: 60, recipients: [0] }] }).id;
    const item = () => store.items().find((i) => i.title === 'Renew licence')!;
    expect(item().reminder).toBe(new Date(Date.parse(instantOf('2026-11-02T15:30')!) - 3_600_000).toISOString());
    ok('PATCH', `/api/tasks/${id}`, { field: 'due_date', value: '2026-11-03T15:30' });
    expect(item().reminder).toBe(new Date(Date.parse(instantOf('2026-11-03T15:30')!) - 3_600_000).toISOString());
    expect(ok('GET', `/api/tasks/${id}/reminders`)).toMatchObject({ reminders: [{ id: 1, offset_minutes: 60 }], recipients: [{ id: 0, name: 'Nimal' }] });
    ok('PUT', `/api/tasks/${id}/reminders/1`, { offset_minutes: null, custom_at: '2026-11-01T08:00' });
    expect(item().reminder).toBe(instantOf('2026-11-01T08:00'));
    ok('DELETE', `/api/tasks/${id}/reminders/1`);
    expect(item().reminder).toBeNull();
  });
});

describe('Contacts on this device', () => {
  it('adds, edits, searches, favourites, archives and deletes personal contacts, with their notes', () => {
    const { ok, ask } = setup();
    const c = ok<{ id: number }>('POST', '/api/contacts', { first_name: 'Kavya', last_name: 'Raj', display_name: 'Kavya Raj', type: 'personal', mobile: '+94 77 123 4567', labels: 'family, school', social: { linkedin: 'kavya', x: '' }, company: '', group_ids: [] });
    ok('POST', '/api/contacts', { display_name: 'Ravi Perera', company: 'Acme', work_email: 'ravi@acme.test' });
    expect(ok('GET', `/api/contacts/${c.id}`)).toMatchObject({ display_name: 'Kavya Raj', phone: '+94 77 123 4567', labels: ['family', 'school'], social: { linkedin: 'kavya' }, company: null, groups: [] });
    ok('PUT', `/api/contacts/${c.id}`, { display_name: 'Kavya R.', job_title: 'Teacher' });
    expect(ok<Array<{ display_name: string }>>('GET', '/api/contacts', undefined, { q: 'teach' }).map((x) => x.display_name)).toEqual(['Kavya R.']);
    expect(ok<Array<{ display_name: string }>>('GET', '/api/contacts').map((x) => x.display_name)).toEqual(['Kavya R.', 'Ravi Perera']);
    expect(ok('POST', `/api/contacts/${c.id}/favorite`)).toEqual({ is_favorite: true });
    expect(ok('GET', '/api/contacts/stats')).toMatchObject({ total: 2, favorites: 1 });
    ok('POST', `/api/contacts/${c.id}/notes`, { body: 'Met at the school fair' });
    const [note] = ok<Array<{ id: number; body: string }>>('GET', `/api/contacts/${c.id}/notes`);
    expect(note).toMatchObject({ body: 'Met at the school fair', pinned: false });
    ok('PUT', `/api/contact-notes/${note!.id}`, { pinned: true });
    expect(ok<Array<{ pinned: boolean }>>('GET', `/api/contacts/${c.id}/notes`)[0]!.pinned).toBe(true);
    ok('DELETE', `/api/contact-notes/${note!.id}`);
    expect(ok<unknown[]>('GET', `/api/contacts/${c.id}/notes`)).toEqual([]);
    expect(ask('POST', '/api/contacts', { display_name: '  ' })).toMatchObject({ status: 422, message: 'Give the contact a name.' });
    expect(ask('GET', '/api/contacts/directory').status).toBe(403);
    ok('POST', `/api/contacts/${c.id}/archive`);
    expect(ok<unknown[]>('GET', '/api/contacts')).toHaveLength(1);
    ok('DELETE', `/api/contacts/${c.id}`);
    expect(ask('GET', `/api/contacts/${c.id}`).status).toBe(404);
  });
});

describe('Calendar on this device', () => {
  it('adds, lists by range, moves and deletes local events, with reminders before the start', () => {
    const { ok, ask, store } = setup();
    const e = ok<{ id: number; start_at: string }>('POST', '/api/calendar/events', { title: 'Dentist', description: 'Bring card', location: 'Colombo', color: '#0E7C86', start: '2026-11-05T09:00', end: '2026-11-05T10:00', all_day: false, remind_minutes: 30, recur_freq: null });
    expect(e).toMatchObject({ source: 'event', start_at: '2026-11-05 09:00:00', editable: true, can_manage: true, remind_minutes: 30 });
    ok('POST', '/api/calendar/events', { title: 'Holiday', start: '2026-11-10', end: '2026-11-11', all_day: true, remind_minutes: null });
    const week = ok<{ events: Array<{ title: string; all_day: boolean; start_at: string; end_at: string }> }>('GET', '/api/calendar/events', undefined, { from: '2026-11-02', to: '2026-11-08' }).events;
    expect(week.map((x) => x.title)).toEqual(['Dentist']);
    const later = ok<{ events: Array<{ title: string; all_day: boolean; start_at: string; end_at: string }> }>('GET', '/api/calendar/events', undefined, { from: '2026-11-11', to: '2026-11-11' }).events;
    expect(later).toEqual([expect.objectContaining({ title: 'Holiday', all_day: true, start_at: '2026-11-10 00:00:00', end_at: '2026-11-11 00:00:00' })]);
    expect(store.items().find((i) => i.title === 'Dentist')!.reminder).toBe(new Date(Date.parse(instantOf('2026-11-05T09:00')!) - 30 * 60_000).toISOString());
    // Dragging an event sends its times only.
    expect(ok('PUT', `/api/calendar/events/${e.id}`, { start: '2026-11-06T11:00', end: '2026-11-06T12:00', all_day: false })).toMatchObject({ title: 'Dentist', location: 'Colombo', start_at: '2026-11-06 11:00:00', remind_minutes: 30 });
    expect(store.items().find((i) => i.title === 'Dentist')!.reminder).toBe(new Date(Date.parse(instantOf('2026-11-06T11:00')!) - 30 * 60_000).toISOString());
    expect(ask('POST', '/api/calendar/events', { title: 'Weekly', start: '2026-11-05T09:00', recur_freq: 'weekly' }).status).toBe(422);
    expect(ask('PUT', `/api/calendar/events/${e.id}`, { start: '2026-11-06T11:00', end: '2026-11-06T10:00', all_day: false })).toMatchObject({ status: 422, message: 'End time must follow start time.' });
    expect(ok('POST', '/api/calendar/conflicts', { start: '2026-11-06T11:00' })).toMatchObject({ conflicts: [] });
    ok('DELETE', `/api/calendar/events/${e.id}`);
    expect(ask('GET', `/api/calendar/events/${e.id}`).status).toBe(404);
  });

  it('round-trips wall-clock digits on this computer', () => {
    expect(wallOf(instantOf('2026-03-29T02:30')!).slice(0, 10)).toBe('2026-03-29');
    expect(wallOf(instantOf('2026-11-05T09:15')!)).toBe('2026-11-05 09:15:00');
    expect(instantOf('2026-11-05T09:15:00Z')).toBe('2026-11-05T09:15:00.000Z');
    expect(instantOf('not a date')).toBeNull();
  });
});

describe('Local Profile schema 3 (#149)', () => {
  it('opens a #141 file in place, keeps its items and profile, and adds contacts and record numbers', () => {
    const dir = mkdtempSync(join(tmpdir(), 'local-149-')); folders.push(dir);
    const path = join(dir, 'guest-workspace.sqlite');
    const old = new DatabaseSync(path);
    old.exec(`CREATE TABLE items (id TEXT PRIMARY KEY, payload TEXT NOT NULL); CREATE TABLE preferences (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE imported (account TEXT NOT NULL, fingerprint TEXT NOT NULL, PRIMARY KEY(account, fingerprint));
      CREATE TABLE profile (id INTEGER PRIMARY KEY CHECK (id = 1), name TEXT NOT NULL, picture TEXT, pin TEXT, created_at TEXT NOT NULL);
      INSERT INTO profile VALUES (1, 'Nimal', NULL, NULL, '2026-10-02T09:00:00Z'); PRAGMA user_version = 2;`);
    old.prepare('INSERT INTO items VALUES (?, ?)').run('4f29a1c0-7b3d-4e8a-9c21-5d6e7f809a1b', JSON.stringify({ id: '4f29a1c0-7b3d-4e8a-9c21-5d6e7f809a1b', revision: 1, updatedAt: '2026-10-02T09:00:00Z', firedAt: null, kind: 'task', title: 'From #141', body: 'plain', completed: true, due: '2026-10-03T09:00:00Z', start: null, end: null, reminder: null }));
    old.close();
    const store = new LocalWorkspace(path); stores.push(store);
    expect(store.schemaVersion()).toBe(LOCAL_SCHEMA_VERSION);
    expect(store.profile()).toMatchObject({ name: 'Nimal' });
    const api = new LocalApi(store, () => 'Nimal');
    const tasks = api.handle({ method: 'GET', path: '/api/tasks' }).data as { tasks: Array<Record<string, unknown>> };
    expect(tasks.tasks).toEqual([expect.objectContaining({ title: 'From #141', status: 'done', description: '<p>plain</p>', due_at: '2026-10-03T09:00:00Z' })]);
    store.saveContact({ display_name: 'Kept' });
    expect(store.contacts()).toHaveLength(1);
  });

  it('backs up and restores contacts (backup version 3), skipping identical ones', () => {
    const source = new LocalWorkspace(':memory:'); const target = new LocalWorkspace(':memory:'); stores.push(source, target);
    source.saveContact({ display_name: 'Kavya', mobile: '1' }); source.save({ kind: 'note', title: 'N' });
    target.saveContact({ display_name: 'Kavya', mobile: '1' });
    expect(target.preview(source.export())).toMatchObject({ notes: 1, contacts: 0, duplicates: 1 });
    expect(target.restore(source.export())).toEqual({ added: 1, skipped: 1 });
    expect(target.contacts()).toHaveLength(1);
  });
});
