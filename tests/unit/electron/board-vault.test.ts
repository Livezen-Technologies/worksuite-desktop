import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createPublicKey, verify } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({ app: { getPath: () => '/tmp', getVersion: () => '0.1.0' }, safeStorage: {}, shell: {} }));

import { BoardVault, seal, unseal, type BoardVaultDeps } from '../../../electron/services/board-vault';
import { DesktopError } from '../../../electron/main/errors';
import { isProxyPathAllowed } from '../../../electron/services/api-proxy';
import { contract } from '../../../shared/ipc/contract';
import { INVOKE_CHANNELS, EVENT_CHANNELS } from '../../../shared/ipc/channels';
import { offlineResponsePayload } from '../../../shared/board';

let dir: string;
let now: number;
const T0 = Date.parse('2026-10-21T10:00:00Z');

function secrets() {
  const m = new Map<string, string>();
  return { m, get: (k: string) => m.get(k) ?? null, set: (k: string, v: string) => void m.set(k, v), delete: (k: string) => void m.delete(k), getStatus: () => ({ persistent: true, backend: 'test' }) };
}

/** The server's answers (worksuite docs/board/API.md "Devices and offline"), by path. */
const GRANT = {
  id: 31,
  board_meeting_id: 4,
  device_id: 7,
  manifest: { board_meeting_id: 4, user_id: 42, agenda_version: 3, papers: [{ paper_id: 11, paper_version_id: 111, sha256: 'ab', agenda_item_id: 1, title: 'Tender evaluation v2' }], pack_version: 2, annotations: [5], issued_at: '2026-10-21T10:00:00Z', encryption: 'AES-256-GCM' },
  manifest_sha256: 'cd',
  signature: 'sig',
  issued_at: '2026-10-21T10:00:00Z',
  expires_at: '2026-11-04T10:00:00Z',
  revoked_at: null,
  wiped_at: null,
  valid: true,
};
const MEETING = { id: 4, title: 'Audit Committee — AC/2026/004', meeting_number: 'AC/2026/004', body: 'Audit Committee', starts_at: '2026-10-25T09:00:00Z', pack: { pack_id: 3, status: 'PUBLISHED', current_version: 2 } };
const AGENDA = { items: [{ id: 1, number: '2', title: 'Q3 management accounts', depth: 0, papers: [{ id: 11, title: 'Tender evaluation v2' }], children: [{ id: 2, number: '2.1', title: 'External auditor appointment', depth: 1, papers: [], children: [] }] }] };
const NOTES = { items: [{ id: 5, kind: 'note', page: 9, body: 'Check rotation rule for the engagement partner', paper_version_id: 111, visibility: 'PRIVATE', mine: true }] };
const PACK = { pack: { id: 3, status: 'PUBLISHED', current_version: 2, versions: [{ id: 77, pack_id: 3, version: 2, pages: 75 }] } };
const CIRCULARS = {
  items: [
    { id: 9, status: 'ISSUED', deadline_at: '2026-10-25T17:00:00Z', allow_offline: true, me: { eligible: true, response: null } },
    { id: 10, status: 'ISSUED', deadline_at: '2026-10-20T17:00:00Z', allow_offline: true, me: { eligible: true, response: null } },
    { id: 11, status: 'ISSUED', deadline_at: '2026-10-25T17:00:00Z', allow_offline: false, me: { eligible: true, response: null } },
    { id: 12, status: 'ISSUED', deadline_at: '2026-10-25T17:00:00Z', allow_offline: true, me: { eligible: true, response: 'APPROVE' } },
  ],
};

function router(over: Record<string, unknown> = {}) {
  const gets: Record<string, unknown> = {
    '/api/board/meetings/4': MEETING,
    '/api/board/meetings/4/agenda': AGENDA,
    '/api/board/annotations?board_meeting_id=4&mine=1': NOTES,
    '/api/board/meetings/4/pack': PACK,
    '/api/board/offline/manifest/31': GRANT,
    '/api/board/circulars?tab=open': CIRCULARS,
    ...over,
  };
  return {
    get: vi.fn(async (p: string, _o?: unknown): Promise<unknown> => {
      if (p in gets) return gets[p];
      throw new DesktopError('NOT_FOUND', `no ${p}`, 404);
    }),
    post: vi.fn(async (p: string, b?: unknown, _o?: unknown): Promise<unknown> => {
      if (p === '/api/board/devices') return { device: { id: 7, device_uid: (b as { device_uid: string }).device_uid, status: 'ACTIVE', trust_level: 'TRUSTED', has_key: true } };
      if (p === '/api/board/devices/check-in') return { allowed: true, command: null, revoked_grants: [], status: 'ACTIVE' };
      if (p === '/api/board/offline/grants') return { grant: GRANT };
      if (p.endsWith('/offline-responses')) {
        const r = (b as { responses: Array<{ client_uuid: string }> }).responses[0]!;
        return { results: [{ client_uuid: r.client_uuid, verdict: 'ACCEPTED', reason: null }] };
      }
      if (p === '/api/board/annotations/sync') return { items: [{ client_uuid: 'a1', status: 200, body: {} }] };
      return {};
    }),
  };
}

function make(over: Partial<BoardVaultDeps> = {}, http = router()) {
  const s = secrets();
  const changed = vi.fn();
  const download = vi.fn(async (_p: string, _h: Record<string, string>) => new Uint8Array(Buffer.from('%PDF-1.7 secret board paper text')));
  const v = new BoardVault({
    http: http as unknown as BoardVaultDeps['http'],
    download,
    secrets: s,
    root: () => join(dir, 'board'),
    userId: () => '42',
    deviceId: () => 'dev-1',
    allowed: () => ({ ok: true, reason: null }),
    changed,
    now: () => now,
    ...over,
  });
  return { v, s, http, changed, download };
}

const refused = (code: 'device_blocked' | 'device_revoked') => new DesktopError('PERMISSION_DENIED', `This device is ${code.slice(7)} for WorkSuite Board.`, 403, { code, command: 'WIPE' });

function allFiles(d: string): string[] {
  if (!existsSync(d)) return [];
  return readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? allFiles(join(d, e.name)) : [join(d, e.name)]));
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ws-board-'));
  now = T0;
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('sealing', () => {
  it('opens only with the same key and the same name', () => {
    const k = Buffer.alloc(32, 3);
    const s = seal(k, '42:index.wsb', Buffer.from('hello'));
    expect(unseal(k, '42:index.wsb', s).toString()).toBe('hello');
    expect(() => unseal(k, '42:pack-1.wsb', s)).toThrow();
    expect(() => unseal(Buffer.alloc(32, 4), '42:index.wsb', s)).toThrow();
  });
});

describe('the device (FR-DEV-01)', () => {
  it('registers with its raw Ed25519 public key and names itself on every Board call', async () => {
    const { v, http, download } = make();
    await v.download(4);
    const reg = http.post.mock.calls.find((c) => c[0] === '/api/board/devices')!;
    const body = reg[1] as { device_uid: string; public_key: string; platform: string };
    expect(body.device_uid).toBe('dev-1');
    expect(Buffer.from(body.public_key, 'base64').length).toBe(32);
    expect(reg[2]).toEqual({ headers: { 'X-Board-Device': 'dev-1' } });
    expect(http.post).toHaveBeenCalledWith('/api/board/offline/grants', { board_meeting_id: 4, device_uid: 'dev-1' }, { headers: { 'X-Board-Device': 'dev-1' } });
    expect(download).toHaveBeenCalledWith('/api/board/packs/versions/77/file?member=me', { 'X-Board-Device': 'dev-1' });
    expect(v.headers('/api/board/dashboard')).toEqual({ 'X-Board-Device': 'dev-1' });
    expect(v.headers('/api/mail/messages')).toEqual({});
  });

  it('waits for an administrator when the device is pending', async () => {
    const http = router();
    const post = http.post.getMockImplementation()!;
    http.post.mockImplementation(async (p: string, b?: unknown, o?: unknown) => (p === '/api/board/devices' ? { device: { id: 7, status: 'ACTIVE', trust_level: 'PENDING', has_key: true } } : post(p, b, o)));
    const { v } = make({}, http);
    await expect(v.download(4)).rejects.toThrow(/not approved/);
    expect(v.status().trust).toBe('pending');
    expect(http.post.mock.calls.some((c) => c[0] === '/api/board/offline/grants')).toBe(false);
  });
});

describe('offline packs (FR-OFF-01, FR-OFF-03)', () => {
  it('keeps the grant and the rendition encrypted with a keychain key, nothing plain on disk', async () => {
    const { v, s } = make();
    const p = await v.download(4);
    expect(p).toMatchObject({ meetingId: 4, version: 2, pages: 75, notes: 1, state: 'ready', expiresAt: '2026-11-04T10:00:00Z' });
    expect(s.m.has('board.vault.42')).toBe(true);
    const files = allFiles(join(dir, 'board'));
    expect(files.length).toBe(2);
    for (const f of files) {
      const raw = readFileSync(f).toString('latin1');
      expect(raw).not.toContain('secret board paper');
      expect(raw).not.toContain('Audit Committee');
    }
    const opened = v.open(4);
    expect(Buffer.from(opened.file!).toString()).toContain('secret board paper');
    expect(opened.manifest.grant).toEqual(GRANT.manifest);
    expect(opened.manifest.agenda.map((a) => [a.number, a.depth])).toEqual([['2', 0], ['2.1', 1]]);
  });

  it('refuses when the organization keeps nothing offline', async () => {
    const { v } = make({ allowed: () => ({ ok: false, reason: 'No offline data here.' }) });
    await expect(v.download(4)).rejects.toThrow('No offline data here.');
  });

  it("erases a pack at its grant's expiry on the next look, online or not", async () => {
    const { v } = make();
    await v.download(4);
    now = Date.parse('2026-11-05T00:00:00Z');
    expect(() => v.open(4)).toThrow(DesktopError);
    expect(v.status().packs).toEqual([]);
    expect(allFiles(join(dir, 'board')).some((f) => f.includes('pack-4'))).toBe(false);
  });

  it('cannot be read without its key (another computer, a reset keychain)', async () => {
    const { v, s } = make();
    await v.download(4);
    s.m.clear();
    expect(v.status().packs).toEqual([]);
  });

  it('searches the kept agenda, papers and my notes offline', async () => {
    const { v } = make();
    await v.download(4);
    expect(v.search('auditor').map((h) => h.type)).toEqual(['agenda']);
    expect(v.search('tender')[0]).toMatchObject({ type: 'paper', title: 'Tender evaluation v2' });
    expect(v.search('rotation rule')[0]).toMatchObject({ type: 'note', page: 9 });
  });

  it('flags a newer version, and drops a revoked or missing grant at sync', async () => {
    const http = router();
    const { v } = make({}, http);
    await v.download(4);
    const get = http.get.getMockImplementation()!;
    http.get.mockImplementation(async (p: string) => (p === '/api/board/meetings/4' ? { ...MEETING, pack: { ...MEETING.pack, current_version: 3 } } : get(p)));
    let st = await v.sync();
    expect(st.packs[0]!.latestVersion).toBe(3);
    expect(st.trust).toBe('trusted');
    http.get.mockImplementation(async (p: string) => (p === '/api/board/offline/manifest/31' ? { ...GRANT, valid: false, revoked_at: '2026-10-21T11:00:00Z' } : get(p)));
    st = await v.sync();
    expect(st.packs).toEqual([]);
  });

  it('PURGE_GRANTS at check-in erases just those meetings', async () => {
    const http = router();
    const { v } = make({}, http);
    await v.download(4);
    const post = http.post.getMockImplementation()!;
    http.post.mockImplementation(async (p: string, b?: unknown, o?: unknown) => (p === '/api/board/devices/check-in' ? { allowed: true, command: 'PURGE_GRANTS', revoked_grants: [31], status: 'ACTIVE' } : post(p, b, o)));
    const st = await v.sync();
    expect(st.packs).toEqual([]);
    expect(st.trust).toBe('trusted');
  });
});

describe('revocation and wipe (FR-DEV-02, FR-DEV-03)', () => {
  it('a WIPE at check-in erases only the vault and reports it with POST /devices/{id}/wiped', async () => {
    const http = router();
    const { v, s } = make({}, http);
    await v.download(4);
    const personal = join(dir, 'my-own-file.txt');
    writeFileSync(personal, 'mine');
    mkdirSync(join(dir, 'board-other'));
    const post = http.post.getMockImplementation()!;
    http.post.mockImplementation(async (p: string, b?: unknown, o?: unknown) => (p === '/api/board/devices/check-in' ? { allowed: false, command: 'WIPE', revoked_grants: [31], status: 'REVOKED' } : post(p, b, o)));
    let st = await v.sync();
    expect(existsSync(personal)).toBe(true);
    expect(existsSync(join(dir, 'board-other'))).toBe(true);
    expect(s.m.has('board.sign.42')).toBe(false);
    expect(st.packs).toEqual([]);
    expect(st.trust).toBe('revoked');
    expect(st.wiped?.reason).toMatch(/revoked/);
    await expect(v.download(4)).rejects.toMatchObject({ code: 'DEVICE_REVOKED' });
    st = await v.sync();
    const report = http.post.mock.calls.find((c) => c[0] === '/api/board/devices/7/wiped')!;
    expect(report[1]).toEqual({ result: expect.stringMatching(/Board vault destroyed/), grants: [31] });
    // The report is the device's own, by id: no X-Board-Device, which a blocked device would be refused with.
    expect(report[2]).toBeUndefined();
  });

  it('403 device_blocked on any Board call wipes the vault', async () => {
    const http = router();
    const { v } = make({}, http);
    await v.download(4);
    http.get.mockRejectedValue(refused('device_blocked'));
    const st = await v.sync();
    expect(st.trust).toBe('blocked');
    expect(st.packs).toEqual([]);
    expect(() => v.open(4)).toThrow(/may not open/);
  });

  it('a refused download wipes too', async () => {
    const http = router();
    const { v } = make({}, http);
    http.post.mockRejectedValue(refused('device_revoked'));
    await expect(v.download(4)).rejects.toThrow(/revoked; its Board packs were erased/);
    expect(v.status().trust).toBe('revoked');
  });

  it('a plain 403 (no permission) is not a wipe', () => {
    const { v } = make();
    expect(v.wipeIfRevoked(new DesktopError('PERMISSION_DENIED', 'You do not have permission to do that', 403, null))).toBeNull();
  });
});

describe('offline queue and circular responses (FR-OFF-02, FR-VOT-08, FR-CIR-05)', () => {
  it('keeps only the latest edit of the same annotation, then sends it through /annotations/sync', async () => {
    const { v, http } = make();
    await v.download(4);
    v.enqueue({ kind: 'annotation', meetingId: 4, ref: 'a1', body: { paper_version_id: 111, kind: 'note', body: 'first', visibility: 'PRIVATE' } });
    v.enqueue({ kind: 'annotation', meetingId: 4, ref: 'a1', body: { paper_version_id: 111, kind: 'note', body: 'second', visibility: 'PRIVATE' } });
    expect(v.queue().length).toBe(1);
    await v.sync();
    expect(http.post).toHaveBeenCalledWith('/api/board/annotations/sync', { items: [expect.objectContaining({ body: 'second', client_uuid: 'a1', board_meeting_id: 4, updated_at: expect.any(String) })] }, expect.anything());
    expect(v.queue()[0]!.outcome).toBe('accepted');
  });

  it('acknowledges the kept pack version', async () => {
    const { v, http } = make();
    await v.download(4);
    v.enqueue({ kind: 'ack', meetingId: 4, ref: 'ack-4', body: {} });
    await v.sync();
    expect(http.post).toHaveBeenCalledWith('/api/board/packs/versions/77/acknowledge', {}, expect.anything());
  });

  it("signs an allowed response over the server's canonical JSON, and it verifies with the registered key", async () => {
    const { v, s, http } = make();
    await v.download(4);
    await v.sync();
    const q = v.respondOffline({ circularId: 9, choice: 'approve', comment: '  Fine / “ok”  ' });
    expect(q.outcome).toBe('pending');
    await v.sync();
    const call = http.post.mock.calls.find((c) => c[0] === '/api/board/circulars/9/offline-responses')!;
    const r = (call[1] as { responses: Array<Record<string, string | null>> }).responses[0]!;
    expect(Object.keys(r).sort()).toEqual(['client_uuid', 'comment', 'device_signed_at', 'device_uid', 'response', 'signature']);
    expect(r).toMatchObject({ device_uid: 'dev-1', response: 'APPROVE', comment: 'Fine / “ok”', device_signed_at: '2026-10-21T10:00:00Z' });
    const payload = '{"circular_id":9,"comment":"Fine / “ok”","device_signed_at":"2026-10-21T10:00:00Z","response":"APPROVE","user_id":42}';
    expect(offlineResponsePayload({ circularId: 9, userId: 42, response: 'approve', comment: '  Fine / “ok”  ', signedAt: '2026-10-21T10:00:00Z' })).toBe(payload);
    const raw = (http.post.mock.calls.find((c) => c[0] === '/api/board/devices')![1] as { public_key: string }).public_key;
    const pub = createPublicKey({ key: Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), Buffer.from(raw, 'base64')]), format: 'der', type: 'spki' });
    expect(verify(null, Buffer.from(payload), pub, Buffer.from(r.signature!, 'base64'))).toBe(true);
    expect(s.m.get('board.sign.42')).toContain('PRIVATE KEY');
    expect(v.queue().find((x) => x.kind === 'circular')!.outcome).toBe('accepted');
  });

  it('signs null for an empty comment, as the server rebuilds it', () => {
    expect(offlineResponsePayload({ circularId: 12, userId: 4, response: 'APPROVE', comment: ' \n ', signedAt: '2026-11-02T07:00:00Z' })).toBe('{"circular_id":12,"comment":null,"device_signed_at":"2026-11-02T07:00:00Z","response":"APPROVE","user_id":4}');
    expect(offlineResponsePayload({ circularId: 1, userId: 1, response: 'REJECT', comment: 'a b', signedAt: 'x' })).toContain('"a\\u2028b"');
  });

  it('refuses past the deadline, without the policy, once answered, and when not kept', async () => {
    const { v } = make();
    await v.download(4);
    await v.sync();
    expect(() => v.respondOffline({ circularId: 10, choice: 'approve' })).toThrow('The deadline has passed.');
    expect(() => v.respondOffline({ circularId: 11, choice: 'approve' })).toThrow(/not in the offline vault/);
    expect(() => v.respondOffline({ circularId: 12, choice: 'approve' })).toThrow(/already responded/);
    expect(() => v.respondOffline({ circularId: 99, choice: 'approve' })).toThrow(/not in the offline vault/);
  });

  it('refuses before this computer is registered with a key', () => {
    const { v } = make();
    expect(() => v.respondOffline({ circularId: 9, choice: 'approve' })).toThrow(/not set up for Board offline use/);
  });

  it('shows the server rejection reason', async () => {
    const http = router();
    const { v } = make({}, http);
    await v.download(4);
    await v.sync();
    v.respondOffline({ circularId: 9, choice: 'reject' });
    v.respondOffline({ circularId: 9, choice: 'approve' });
    expect(v.queue().filter((x) => x.kind === 'circular').length).toBe(1);
    const post = http.post.getMockImplementation()!;
    http.post.mockImplementation(async (p: string, b?: unknown, o?: unknown) => (p.endsWith('/offline-responses') ? { results: [{ client_uuid: 'x', verdict: 'REJECTED', reason: 'Signed after the deadline (2026-10-25T17:00:00Z).' }] } : post(p, b, o)));
    await v.sync();
    expect(v.queue().find((x) => x.kind === 'circular')).toMatchObject({ outcome: 'rejected', error: 'Signed after the deadline (2026-10-25T17:00:00Z).' });
  });
});

describe('IPC and the page boundary', () => {
  it('declares every Board channel with a schema and lists it for the preload', () => {
    for (const ch of ['board:vaultStatus', 'board:packDownload', 'board:packOpen', 'board:packRemove', 'board:queueAdd', 'board:queueList', 'board:respondOffline', 'board:sync', 'board:search', 'board:verify'] as const) {
      expect(contract[ch]).toBeTruthy();
      expect((INVOKE_CHANNELS as readonly string[]).includes(ch)).toBe(true);
    }
    expect((EVENT_CHANNELS as readonly string[]).includes('board:vaultChanged')).toBe(true);
    expect(contract['board:packDownload'].input.safeParse({ meetingId: -1 }).success).toBe(false);
    expect(contract['board:respondOffline'].input.safeParse({ circularId: 9, choice: 'maybe' }).success).toBe(false);
    expect(contract['board:queueAdd'].input.safeParse({ kind: 'annotation', meetingId: 4, ref: '../x', body: {} }).success).toBe(false);
    expect(contract['board:queueAdd'].input.safeParse({ kind: 'note', meetingId: 4, ref: 'x', body: {} }).success).toBe(false);
  });
  it('keeps grants, manifests, signed responses, check-in, wipe reports and device registration away from pages', () => {
    expect(isProxyPathAllowed('/api/board/offline/grants', 'POST')).toBe(false);
    expect(isProxyPathAllowed('/api/board/offline/manifest/4')).toBe(false);
    expect(isProxyPathAllowed('/api/mobile/v1/board/offline/grants', 'POST')).toBe(false);
    expect(isProxyPathAllowed('/api/board/circulars/9/offline-responses', 'POST')).toBe(false);
    expect(isProxyPathAllowed('/api/board/devices/check-in', 'POST')).toBe(false);
    expect(isProxyPathAllowed('/api/board/devices/7/wiped', 'POST')).toBe(false);
    expect(isProxyPathAllowed('/api/board/devices', 'POST')).toBe(false);
    expect(isProxyPathAllowed('/api/board/devices?mine=1')).toBe(true);
    expect(isProxyPathAllowed('/api/board/circulars/9/respond', 'POST')).toBe(true);
    expect(isProxyPathAllowed('/api/board/dashboard')).toBe(true);
  });
});
