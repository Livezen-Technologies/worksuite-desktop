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

const MANIFEST = {
  meeting: { id: 4, title: 'Audit Committee — AC/2026/004', archive_at: '2026-12-01T00:00:00Z' },
  pack: { version_id: 77, version: 2, pages: 75 },
  policy: { offline_allowed: true, max_offline_days: 14, offline_circular_responses: true },
  agenda: [{ id: 1, number: '2.1', title: 'Q3 management accounts', paper: { id: 11, name: 'q3.pdf' } }, { id: 2, number: '3.2', title: 'External auditor appointment' }],
  papers: [{ id: 11, title: 'Tender evaluation v2', pages: ['Intro', 'recommends the appointment of the highest-scoring firm as external auditor'] }],
  notes: [{ id: 'n1', text: 'Check rotation rule for the engagement partner', page: 9, paper_title: 'Tender evaluation v2' }],
  circulars: [
    { id: 9, status: 'open', deadline: '2026-10-25T17:00:00Z' },
    { id: 10, status: 'open', deadline: '2026-10-20T17:00:00Z' },
    { id: 11, status: 'open', deadline: '2026-10-25T17:00:00Z', offline_responses_allowed: false },
    { id: 12, status: 'open', deadline: '2026-10-25T17:00:00Z', live_meeting: true },
  ],
};

function make(over: Partial<BoardVaultDeps> = {}) {
  const s = secrets();
  const http = { get: vi.fn(async (_p: string): Promise<unknown> => MANIFEST), post: vi.fn(async (p: string, _b?: unknown): Promise<unknown> => (p.endsWith('/grants') ? { expires_at: '2026-11-30T00:00:00Z' } : { results: [{ status: 'accepted' }] })) };
  const changed = vi.fn();
  const v = new BoardVault({
    http: http as unknown as BoardVaultDeps['http'],
    download: vi.fn(async () => new Uint8Array(Buffer.from('%PDF-1.7 secret board paper text'))),
    secrets: s,
    root: () => join(dir, 'board'),
    userId: () => '42',
    deviceId: () => 'dev-1',
    allowed: () => ({ ok: true, reason: null }),
    changed,
    now: () => now,
    ...over,
  });
  return { v, s, http, changed };
}

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

describe('offline packs (FR-OFF-01, FR-OFF-03)', () => {
  it('keeps a pack encrypted with a keychain key, nothing plain on disk', async () => {
    const { v, s, http } = make();
    const p = await v.download(4);
    expect(http.post).toHaveBeenCalledWith('/api/board/offline/grants', { meeting_id: 4, device_id: 'dev-1' });
    expect(http.get).toHaveBeenCalledWith('/api/board/offline/manifest/4');
    expect(p).toMatchObject({ meetingId: 4, version: 2, pages: 75, notes: 1, state: 'ready' });
    // min(grant 30 Nov, now + 14 days = 4 Nov, archive 1 Dec)
    expect(p.expiresAt).toBe('2026-11-04T10:00:00.000Z');
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
    expect(opened.manifest.pack).toEqual(MANIFEST.pack);
  });

  it('refuses when the organization keeps nothing offline', async () => {
    const { v } = make({ allowed: () => ({ ok: false, reason: 'No offline data here.' }) });
    await expect(v.download(4)).rejects.toThrow('No offline data here.');
  });

  it('erases an expired pack on the next look, online or not', async () => {
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

  it('searches the kept packs offline with pages', async () => {
    const { v } = make();
    await v.download(4);
    const hits = v.search('auditor');
    expect(hits.map((h) => h.type)).toEqual(['agenda', 'paper']);
    expect(hits[1]).toMatchObject({ page: 2, title: 'Tender evaluation v2' });
    expect(v.search('rotation rule')[0]).toMatchObject({ type: 'note', page: 9 });
  });

  it('flags a newer version and drops an archived meeting at sync', async () => {
    const { v, http } = make();
    await v.download(4);
    http.get.mockResolvedValueOnce({ ...MANIFEST, pack: { ...MANIFEST.pack, version: 3 } });
    let st = await v.sync();
    expect(st.packs[0]!.latestVersion).toBe(3);
    expect(st.trust).toBe('trusted');
    http.get.mockRejectedValueOnce(new DesktopError('NOT_FOUND', 'Archived', 404));
    st = await v.sync();
    expect(st.packs).toEqual([]);
  });
});

describe('revocation and wipe (FR-DEV-02, FR-DEV-03)', () => {
  it('a revoked device erases only its vault and reports it at the next contact', async () => {
    const { v, s, http } = make();
    await v.download(4);
    const personal = join(dir, 'my-own-file.txt');
    writeFileSync(personal, 'mine');
    mkdirSync(join(dir, 'board-other'));
    v.handleRealtime({ type: 'board.device.revoked', device_id: 'dev-1' });
    expect(existsSync(personal)).toBe(true);
    expect(existsSync(join(dir, 'board-other'))).toBe(true);
    expect(s.m.has('board.sign.42')).toBe(false);
    const st = v.status();
    expect(st.packs).toEqual([]);
    expect(st.trust).toBe('revoked');
    expect(st.wiped?.reason).toMatch(/revoked/);
    await expect(v.download(4)).rejects.toMatchObject({ code: 'DEVICE_REVOKED' });
    await v.sync();
    expect(http.post).toHaveBeenCalledWith('/api/board/devices/dev-1/wipe-report', expect.objectContaining({ packs: 1 }));
  });

  it("ignores another device's revocation", async () => {
    const { v } = make();
    await v.download(4);
    v.handleRealtime({ type: 'board.device.blocked', device_id: 'dev-2' });
    expect(v.status().packs.length).toBe(1);
  });

  it('DEVICE_BLOCKED on a Board call wipes the vault', async () => {
    const { v, http } = make();
    await v.download(4);
    http.get.mockRejectedValueOnce(new DesktopError('DEVICE_BLOCKED', 'Blocked', 403));
    const st = await v.sync();
    expect(st.trust).toBe('blocked');
    expect(st.packs).toEqual([]);
    expect(() => v.open(4)).toThrow(/may not open/);
  });
});

describe('offline queue and circular responses (FR-OFF-02, FR-VOT-08, FR-CIR-05)', () => {
  it('keeps only the latest edit of the same annotation, then sends it', async () => {
    const { v, http } = make();
    await v.download(4);
    v.enqueue({ kind: 'annotation', meetingId: 4, ref: 'a1', body: { note: 'first' } });
    v.enqueue({ kind: 'annotation', meetingId: 4, ref: 'a1', body: { note: 'second' } });
    expect(v.queue().length).toBe(1);
    await v.sync();
    expect(http.post).toHaveBeenCalledWith('/api/board/meetings/4/annotations', expect.objectContaining({ note: 'second', client_ref: 'a1' }));
    expect(v.queue()[0]!.outcome).toBe('accepted');
  });

  it('signs an allowed response with the device key, and the signature verifies', async () => {
    const { v, s, http } = make();
    await v.download(4);
    const q = v.respondOffline({ circularId: 9, choice: 'approve', comment: 'Fine' });
    expect(q.outcome).toBe('pending');
    await v.sync();
    const call = http.post.mock.calls.find((c) => c[0] === '/api/board/circulars/9/offline-responses')!;
    const r = (call[1] as { responses: Array<Record<string, string>> }).responses[0]!;
    const payload = offlineResponsePayload({ circularId: 9, choice: 'approve', comment: 'Fine', recordedAt: r.recorded_at!, deviceId: 'dev-1' });
    expect(verify(null, Buffer.from(payload), createPublicKey(r.public_key!), Buffer.from(r.signature!, 'base64'))).toBe(true);
    expect(s.m.get('board.sign.42')).toContain('PRIVATE KEY');
    expect(v.queue().find((x) => x.kind === 'circular')!.outcome).toBe('accepted');
  });

  it('refuses past the deadline, without the policy, and for live votes', async () => {
    const { v } = make();
    await v.download(4);
    expect(() => v.respondOffline({ circularId: 10, choice: 'approve' })).toThrow('The deadline has passed.');
    expect(() => v.respondOffline({ circularId: 11, choice: 'approve' })).toThrow(/policy/);
    expect(() => v.respondOffline({ circularId: 12, choice: 'approve' })).toThrow(/online only/);
    expect(() => v.respondOffline({ circularId: 99, choice: 'approve' })).toThrow(/not in the offline vault/);
  });

  it('shows the server rejection reason', async () => {
    const { v, http } = make();
    await v.download(4);
    v.respondOffline({ circularId: 9, choice: 'reject' });
    v.respondOffline({ circularId: 9, choice: 'approve' });
    expect(v.queue().filter((x) => x.kind === 'circular').length).toBe(1);
    http.post.mockResolvedValueOnce({ results: [{ status: 'rejected', reason: 'Recorded after the deadline.' }] });
    await v.sync();
    expect(v.queue().find((x) => x.kind === 'circular')).toMatchObject({ outcome: 'rejected', error: 'Recorded after the deadline.' });
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
  });
  it('keeps grants, manifests and signed responses away from pages', () => {
    expect(isProxyPathAllowed('/api/board/offline/grants', 'POST')).toBe(false);
    expect(isProxyPathAllowed('/api/board/offline/manifest/4')).toBe(false);
    expect(isProxyPathAllowed('/api/board/circulars/9/offline-responses', 'POST')).toBe(false);
    expect(isProxyPathAllowed('/api/board/circulars/9/respond', 'POST')).toBe(true);
    expect(isProxyPathAllowed('/api/board/dashboard')).toBe(true);
  });
});
