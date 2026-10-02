import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LOCAL_SCHEMA_VERSION, LocalAccess, LocalWorkspace } from '../../../electron/services/local-workspace';
import { GuestMeetService } from '../../../electron/services/guest-meet';
import { GUEST_CHANNELS } from '@shared/guest-meet';
import { LOCAL_CHANNELS, localBackup, searchLocalItems, type LocalItemInput } from '@shared/local-workspace';
import { GUEST_LOCKED_APPS } from '@shared/apps';
import { INVOKE_CHANNELS } from '@shared/ipc/channels';

const folders: string[] = [];
const stores: LocalWorkspace[] = [];
afterEach(() => { stores.splice(0).forEach((store) => { try { store.close(); } catch { /* closed by the test */ } }); for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true }); });
const folder = () => { const dir = mkdtempSync(join(tmpdir(), 'local-141-')); folders.push(dir); return dir; };
const open = (path = ':memory:') => { const store = new LocalWorkspace(path); stores.push(store); return store; };
const item = (kind: LocalItemInput['kind'], title: string, body = ''): LocalItemInput => ({ kind, title, body, completed: false, due: null, start: kind === 'event' ? '2026-10-02T09:00:00Z' : null, end: null, reminder: null });
const PICTURE = 'data:image/png;base64,iVBORw0KGgo=';

describe('Local Profile (#141)', () => {
  it('creates a profile on first use with only a display name: no email, verification or server', () => {
    const store = open();
    expect(store.profile()).toBeNull();
    const profile = store.saveProfile({ name: '  Nimal  ' });
    expect(profile).toMatchObject({ name: 'Nimal', picture: null, hasPin: false });
    expect(store.checkPin('')).toBe(true);
    expect(() => store.saveProfile({ name: '   ' })).toThrow();
  });

  it('keeps the profile, its picture and a hashed PIN across restarts; the PIN never appears in the file', () => {
    const path = join(folder(), 'guest-workspace.sqlite');
    let store = open(path);
    store.saveProfile({ name: 'Kavya', picture: PICTURE, pin: '4826' });
    store.save(item('note', 'Kept note'));
    store.close();
    expect(readFileSync(path).includes(Buffer.from('4826'))).toBe(false);
    store = open(path);
    expect(store.profile()).toMatchObject({ name: 'Kavya', picture: PICTURE, hasPin: true });
    expect(store.read().items.map((entry) => entry.title)).toEqual(['Kept note']);
    expect(store.checkPin('4826')).toBe(true);
    expect(store.checkPin('4827')).toBe(false);
    // Edits keep the PIN unless it is changed or removed.
    store.saveProfile({ name: 'Kavya R', picture: null });
    expect(store.profile()).toMatchObject({ name: 'Kavya R', picture: null, hasPin: true });
    store.saveProfile({ name: 'Kavya R', pin: null });
    expect(store.profile()!.hasPin).toBe(false);
  });

  it('refuses weak PINs and pictures that are not small images', () => {
    const store = open();
    expect(() => store.saveProfile({ name: 'A', pin: '1111' })).toThrow('harder to guess');
    expect(() => store.saveProfile({ name: 'A', pin: '12a4' })).toThrow();
    expect(() => store.saveProfile({ name: 'A', picture: 'data:image/svg+xml;base64,PHN2Zz4=' })).toThrow();
    expect(() => store.saveProfile({ name: 'A', picture: `data:image/png;base64,${'A'.repeat(500_000)}` })).toThrow();
    expect(store.profile()).toBeNull();
  });

  it('migrates a #86 database in place on update and refuses one from a newer version', () => {
    const path = join(folder(), 'guest-workspace.sqlite');
    const old = new DatabaseSync(path);
    old.exec(`CREATE TABLE items (id TEXT PRIMARY KEY, payload TEXT NOT NULL); CREATE TABLE preferences (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE imported (account TEXT NOT NULL, fingerprint TEXT NOT NULL, PRIMARY KEY(account, fingerprint));`);
    old.prepare('INSERT INTO items VALUES (?, ?)').run('4f29a1c0-7b3d-4e8a-9c21-5d6e7f809a1b', JSON.stringify({ ...item('task', 'Before update'), id: '4f29a1c0-7b3d-4e8a-9c21-5d6e7f809a1b', revision: 1, updatedAt: '2026-01-01T00:00:00Z', firedAt: null }));
    old.close();
    const store = open(path);
    expect(store.schemaVersion()).toBe(LOCAL_SCHEMA_VERSION);
    expect(store.read().items[0]!.title).toBe('Before update');
    expect(store.profile()).toBeNull();
    store.saveProfile({ name: 'After update' });
    store.close();
    const newer = new DatabaseSync(path); newer.exec(`PRAGMA user_version = ${LOCAL_SCHEMA_VERSION + 1}`); newer.close();
    expect(() => new LocalWorkspace(path)).toThrow('newer WorkSuite');
  });

  it('searches local notes, tasks and events by every word, ignoring case and accents', () => {
    const store = open();
    store.save(item('note', 'Café budget', 'Quarterly numbers'));
    store.save(item('note', 'Shopping', 'milk, bread'));
    store.save(item('task', 'Call the bank'));
    const notes = store.read().items.filter((entry) => entry.kind === 'note');
    expect(searchLocalItems(notes, 'cafe').map((entry) => entry.title)).toEqual(['Café budget']);
    expect(searchLocalItems(notes, 'BREAD milk').map((entry) => entry.title)).toEqual(['Shopping']);
    expect(searchLocalItems(notes, 'bread budget')).toEqual([]);
    expect(searchLocalItems(notes, '  ')).toHaveLength(2);
  });
});

describe('Local Profile backup, restore preview and deletion', () => {
  it('exports a versioned backup with the name and picture but never the PIN', () => {
    const store = open();
    store.saveProfile({ name: 'Ravi', picture: PICTURE, pin: '4826' });
    store.save(item('note', 'One'));
    const text = store.export();
    const backup = JSON.parse(text);
    expect(backup).toMatchObject({ format: 'worksuite-local', version: 3, profile: { name: 'Ravi', picture: PICTURE } });
    expect(text).not.toContain('salt');
    expect(text).not.toContain('"pin"');
    expect(localBackup.safeParse(backup).success).toBe(true);
  });

  it('previews counts without writing, and restores only after that', () => {
    const source = open();
    source.saveProfile({ name: 'Backup owner' });
    source.save(item('note', 'N1')); source.save(item('task', 'T1')); source.save(item('task', 'T2')); source.save(item('event', 'E1'));
    const target = open();
    target.save(item('note', 'N1'));
    const before = target.export();
    expect(target.preview(source.export())).toEqual({ notes: 0, tasks: 2, events: 1, contacts: 0, duplicates: 1, profileName: 'Backup owner' });
    expect(target.export()).toBe(before);
    expect(() => target.preview('{"format":"other"}')).toThrow();
    expect(target.restore(source.export())).toEqual({ added: 3, skipped: 1 });
    // The device had no profile yet: the backup names it (without a PIN).
    expect(target.profile()).toMatchObject({ name: 'Backup owner', hasPin: false });
  });

  it('keeps the existing profile when restoring, and still reads version 1 backups', () => {
    const target = open();
    target.saveProfile({ name: 'Current', pin: '4826' });
    const other = open(); other.saveProfile({ name: 'Other' }); other.save(item('note', 'From other'));
    target.restore(other.export());
    expect(target.profile()).toMatchObject({ name: 'Current', hasPin: true });
    const v1 = JSON.stringify({ format: 'worksuite-local', version: 1, items: [item('task', 'Old backup')] });
    expect(target.preview(v1)).toMatchObject({ tasks: 1, profileName: null });
    expect(target.restore(v1)).toEqual({ added: 1, skipped: 0 });
  });

  it('deletes everything, including the profile and its PIN', () => {
    const store = open();
    store.saveProfile({ name: 'Gone', pin: '4826' }); store.save(item('event', 'E'));
    store.deleteAll();
    expect(store.profile()).toBeNull();
    expect(store.read().items).toEqual([]);
    expect(store.checkPin('')).toBe(true);
  });
});

describe('Local Profile isolation and online-only features', () => {
  it('lets a guest meeting window reach only meeting and window channels: no account and no Local Profile data (#149)', () => {
    for (const channel of GUEST_CHANNELS) expect(channel).toMatch(/^(guest|media|windows|security):/);
    for (const channel of LOCAL_CHANNELS) expect(INVOKE_CHANNELS as readonly string[]).toContain(channel);
    for (const channel of ['session:get', 'files:list', 'chat:send', 'ai:ask', 'api:request', 'auth:signIn', 'local:api', 'local:move', 'local:status']) expect(GUEST_CHANNELS.has(channel)).toBe(false);
    expect(GUEST_LOCKED_APPS.map((a) => a.guestLabel ?? a.label)).toEqual(expect.arrayContaining(['Chat', 'Mail', 'Drive & Files', 'Company records', 'Shared workspaces', 'HR & People', 'CRM & Sales', 'AI Assistant']));
  });

  it('suggests the Local Profile name in a guest meeting while info stays the server’s current state', async () => {
    const UUID = '4f29a1c0-7b3d-4e8a-9c21-5d6e7f809a1b';
    const INFO = { guests: true, ended: false, locked: false, title: 'Public', sfu_url: 'wss://media.example.test', chat: 'everyone' };
    const reply = (data: unknown) => new Response(JSON.stringify({ data }), { status: 200 });
    const fetch = vi.fn().mockResolvedValueOnce(reply(INFO)).mockResolvedValueOnce(reply({ ...INFO, locked: true }));
    const service = new GuestMeetService({ fetch, server: () => 'https://example.test' });
    const info = await service.prepare(UUID);
    service.bind(7, { ...info, localName: 'Nimal' });
    expect(await service.info(7)).toMatchObject({ uuid: UUID, origin: 'https://example.test', localName: 'Nimal', locked: true });
    for (const [, init] of fetch.mock.calls) expect(init.credentials).toBe('omit');
  });
});

describe('Local Profile PIN gate', () => {
  it('needs a profile, then the PIN once per window; five wrong PINs wait a minute', () => {
    const store = open();
    let now = 1_000_000;
    const access = new LocalAccess(store, () => now);
    expect(() => access.require(1)).toThrow('Create your Local Profile first');
    store.saveProfile({ name: 'Nimal' });
    expect(access.locked(1)).toBe(false); access.require(1);
    store.saveProfile({ name: 'Nimal', pin: '4826' });
    expect(access.locked(1)).toBe(true);
    expect(() => access.require(1)).toThrow('PIN first');
    for (let i = 0; i < 4; i++) expect(access.unlock(1, '1357')).toEqual({ unlocked: false, retryAfter: 0 });
    expect(access.unlock(1, '1357')).toEqual({ unlocked: false, retryAfter: 60 });
    // Even the right PIN waits out the minute.
    expect(access.unlock(1, '4826')).toMatchObject({ unlocked: false });
    now += 61_000;
    expect(access.unlock(1, '4826')).toEqual({ unlocked: true, retryAfter: 0 });
    access.require(1);
    expect(access.locked(2)).toBe(true);
    access.forget(1); expect(access.locked(1)).toBe(true);
    access.grant(3); expect(access.locked(3)).toBe(false);
    access.clear(); expect(access.locked(3)).toBe(true);
  });
});
