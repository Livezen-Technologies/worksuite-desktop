import { createCipheriv, createDecipheriv, createHash, generateKeyPairSync, createPrivateKey, createPublicKey, randomBytes, randomUUID, sign } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import {
  BOARD_WIPE_CODES,
  BOARD_WIPE_EVENTS,
  offlineResponsePayload,
  offlineResponseRefusal,
  packExpired,
  packExpiry,
  type BoardOfflinePack,
  type BoardPackSummary,
  type BoardQueued,
  type BoardSearchHit,
  type BoardVaultStatus,
  type CircularForOffline,
} from '@shared/board';
import { DesktopError, isDesktopError } from '../main/errors';
import { logger } from '../main/log';

const log = logger('board-vault');

/**
 * WorkSuite Board's offline pack vault (SRS-BOARD-001 FR-OFF-01..03, FR-DEV-02/03, FR-VOT-08, FR-CIR-05), main
 * process only:
 *
 *  - KEPT ENCRYPTED: every file — the index, each meeting's manifest and pack, the offline queue — is AES-256-GCM
 *    under a key made for this person on this computer and held only in the OS credential store (secure-store.ts:
 *    Keychain, DPAPI, Secret Service). Without a keyring the key lives in memory and the packs last this session.
 *    Each file is bound to its own name (associated data), so files cannot be swapped.
 *  - WHAT is the server's: `POST /offline/grants` says whether this device may keep the meeting and until when;
 *    `GET /offline/manifest/{id}` lists the agenda, the papers this member may read, private notes and bookmarks.
 *    The pack file is the member's watermarked rendition (`GET /packs/versions/{id}/file?member=me`).
 *  - EXPIRY (FR-OFF-03): the soonest of the grant's end, the policy's max offline days and the archive date. An
 *    expired pack is erased when it is next listed or opened, online or not.
 *  - REVOCATION (FR-DEV-02/03): `board.device.revoked|blocked`, or DEVICE_REVOKED / DEVICE_BLOCKED on any Board call,
 *    erases this vault — its own folder inside the profile and its own keys, nothing else on the computer — and the
 *    result is reported to the server at the next contact.
 *  - QUEUE (FR-OFF-02): annotations, acknowledgements and draft notes made offline wait here, the later edit of the
 *    same item replacing the earlier (last writer wins; the server keeps the history).
 *  - OFFLINE CIRCULAR RESPONSES (FR-VOT-08): only where the board's policy allows, before the deadline, never a live
 *    meeting vote; signed with this device's Ed25519 key at the moment of recording, uploaded to
 *    `POST /circulars/{id}/offline-responses` and accepted or rejected there with a reason the person sees.
 */

const BASE = '/api/board';
const ALGO = 'aes-256-gcm';

export interface BoardVaultDeps {
  http: {
    get<T = unknown>(path: string): Promise<T>;
    post<T = unknown>(path: string, body?: unknown): Promise<T>;
  };
  /** The pack file's bytes, or null when the server has none. */
  download: (path: string) => Promise<Uint8Array | null>;
  secrets: { get(name: string): string | null; set(name: string, value: string): void; delete(name: string): void; getStatus(): { persistent: boolean; backend: string } };
  /** The account's Board folder inside its profile. */
  root: () => string;
  userId: () => string | null;
  deviceId: () => string | null;
  /** The organization keeps offline data on computers (and the person has the Board app). */
  allowed: () => { ok: boolean; reason: string | null };
  changed: () => void;
  now?: () => number;
}

interface PackRecord extends BoardPackSummary {
  /** The pack version's id on the server (for the update check and the file). */
  versionId: number | null;
  circularIds: number[];
}

interface QueueRecord extends BoardQueued {
  body: Record<string, unknown>;
}

interface Index {
  packs: PackRecord[];
  queue: QueueRecord[];
  trust: BoardVaultStatus['trust'];
  lastSyncAt: string | null;
  wiped: { at: string; reason: string } | null;
  /** A wipe not yet reported to the server. */
  wipeToReport: { at: string; reason: string; packs: number } | null;
}

const EMPTY: Index = { packs: [], queue: [], trust: 'unknown', lastSyncAt: null, wiped: null, wipeToReport: null };

export function seal(key: Buffer, label: string, plain: Buffer): Buffer {
  const nonce = randomBytes(12);
  const c = createCipheriv(ALGO, key, nonce);
  c.setAAD(Buffer.from(label));
  const body = Buffer.concat([c.update(plain), c.final()]);
  return Buffer.concat([Buffer.from('WSB1'), nonce, c.getAuthTag(), body]);
}

/** Throws when the file was changed, renamed or sealed under another key. */
export function unseal(key: Buffer, label: string, sealed: Buffer): Buffer {
  if (sealed.subarray(0, 4).toString() !== 'WSB1') throw new Error('not a Board vault file');
  const d = createDecipheriv(ALGO, key, sealed.subarray(4, 16));
  d.setAAD(Buffer.from(label));
  d.setAuthTag(sealed.subarray(16, 32));
  return Buffer.concat([d.update(sealed.subarray(32)), d.final()]);
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && /^\d+$/.test(v) ? Number(v) : null);
const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const arr = (v: unknown): Record<string, unknown>[] => (Array.isArray(v) ? v.map(obj) : []);

export class BoardVault {
  private memoryKeys = new Map<string, Buffer>();

  constructor(private readonly d: BoardVaultDeps) {}

  private now(): number {
    return this.d.now?.() ?? Date.now();
  }

  private uid(): string {
    const u = this.d.userId();
    if (!u) throw new DesktopError('NOT_SIGNED_IN', 'Sign in to use Board offline packs.');
    return u;
  }

  /** The person's vault folder: a hash of the user id, always inside the Board root. */
  private dir(uid: string): string {
    const root = resolve(this.d.root());
    const dir = resolve(root, createHash('sha256').update(`board:${uid}`).digest('hex').slice(0, 32));
    if (!dir.startsWith(root + sep)) throw new DesktopError('INTERNAL', 'The Board vault is outside its folder.');
    return dir;
  }

  private keyName = (uid: string) => `board.vault.${uid}`;
  private signName = (uid: string) => `board.sign.${uid}`;

  private key(uid: string, create: boolean): Buffer | null {
    const stored = this.d.secrets.get(this.keyName(uid));
    if (stored) return Buffer.from(stored, 'base64');
    // No keyring (SecureStore keeps secrets in memory only): the key lives for this session, and so do the packs.
    const persistent = this.d.secrets.getStatus().persistent;
    const mem = persistent ? undefined : this.memoryKeys.get(uid);
    if (mem) return mem;
    if (!create) return null;
    const k = randomBytes(32);
    this.d.secrets.set(this.keyName(uid), k.toString('base64'));
    if (!persistent) this.memoryKeys.set(uid, k);
    return k;
  }

  private read<T>(uid: string, name: string, fallback: T): T {
    const f = join(this.dir(uid), name);
    const key = this.key(uid, false);
    if (!key || !existsSync(f)) return fallback;
    try {
      return JSON.parse(unseal(key, `${uid}:${name}`, readFileSync(f)).toString('utf8')) as T;
    } catch (e) {
      log.warn('vault file unreadable; ignoring it', { name, error: String(e) });
      return fallback;
    }
  }

  private write(uid: string, name: string, value: unknown): void {
    const dir = this.dir(uid);
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const key = this.key(uid, true)!;
    const f = join(dir, name);
    writeFileSync(`${f}.tmp`, seal(key, `${uid}:${name}`, Buffer.from(JSON.stringify(value), 'utf8')), { mode: 0o600 });
    renameSync(`${f}.tmp`, f);
  }

  private index(uid: string): Index {
    return { ...EMPTY, ...this.read<Partial<Index>>(uid, 'index.wsb', {}) };
  }

  private save(uid: string, ix: Index): void {
    this.write(uid, 'index.wsb', ix);
  }

  /** Erases packs whose offline time is over (FR-OFF-03). */
  private purgeExpired(uid: string, ix: Index): boolean {
    const now = this.now();
    const gone = ix.packs.filter((p) => packExpired(p.expiresAt, now));
    if (!gone.length) return false;
    for (const p of gone) rmSync(join(this.dir(uid), `pack-${p.meetingId}.wsb`), { force: true });
    ix.packs = ix.packs.filter((p) => !gone.includes(p));
    return true;
  }

  status(): BoardVaultStatus {
    const uid = this.uid();
    const ix = this.index(uid);
    if (this.purgeExpired(uid, ix)) this.save(uid, ix);
    const s = this.d.secrets.getStatus();
    return {
      keystore: s.persistent,
      backend: s.backend,
      trust: ix.trust,
      lastSyncAt: ix.lastSyncAt,
      packs: ix.packs.map(({ versionId: _v, circularIds: _c, ...p }) => p),
      queued: ix.queue.filter((q) => q.outcome === 'pending').length,
      wiped: ix.wiped,
    };
  }

  /** Keeps a meeting's pack offline: grant, manifest, the member's rendition — sealed as they arrive. */
  async download(meetingId: number): Promise<BoardPackSummary> {
    const uid = this.uid();
    const ok = this.d.allowed();
    if (!ok.ok) throw new DesktopError('POLICY_DENIED', ok.reason ?? 'Offline packs are not allowed on this computer.');
    const ix = this.index(uid);
    if (ix.trust === 'revoked' || ix.trust === 'blocked') throw new DesktopError('DEVICE_REVOKED', 'This device may not keep Board packs offline.');
    const deviceId = this.d.deviceId();
    try {
      const grant = obj(await this.d.http.post(`${BASE}/offline/grants`, { meeting_id: meetingId, device_id: deviceId }));
      const manifest = obj(await this.d.http.get(`${BASE}/offline/manifest/${meetingId}`));
      const meeting = obj(manifest.meeting);
      const pack = obj(manifest.pack);
      const policy = obj(manifest.policy);
      if (policy.offline_allowed === false) throw new DesktopError('POLICY_DENIED', "The board's policy does not allow offline packs.");
      const versionId = num(pack.version_id ?? pack.id);
      const file = versionId ? await this.d.download(`${BASE}/packs/versions/${versionId}/file?member=me`) : null;
      const expiresAt = packExpiry({ grantExpiresAt: str(grant.expires_at), maxOfflineDays: num(policy.max_offline_days), archiveAt: str(meeting.archive_at) }, this.now());
      const rec: PackRecord = {
        meetingId,
        title: str(meeting.title) ?? `Meeting ${meetingId}`,
        version: num(pack.version) ?? 1,
        pages: num(pack.pages),
        notes: arr(manifest.notes).length,
        bytes: file?.byteLength ?? 0,
        downloadedAt: new Date(this.now()).toISOString(),
        expiresAt,
        latestVersion: null,
        state: 'ready',
        versionId,
        circularIds: arr(manifest.circulars).map((c) => num(c.id)).filter((n): n is number => !!n),
      };
      this.write(uid, `pack-${meetingId}.wsb`, { manifest, file: file ? Buffer.from(file).toString('base64') : null });
      ix.packs = [...ix.packs.filter((p) => p.meetingId !== meetingId), rec];
      ix.trust = 'trusted';
      this.save(uid, ix);
      this.d.changed();
      const { versionId: _v, circularIds: _c, ...summary } = rec;
      return summary;
    } catch (e) {
      if (this.wipeIfRevoked(e)) throw new DesktopError('DEVICE_REVOKED', 'This device was revoked; its Board packs were erased.');
      throw e;
    }
  }

  open(meetingId: number): BoardOfflinePack {
    const uid = this.uid();
    const ix = this.index(uid);
    if (ix.trust === 'blocked' || ix.trust === 'revoked') throw new DesktopError('DEVICE_REVOKED', 'This device may not open Board packs.');
    if (this.purgeExpired(uid, ix)) {
      this.save(uid, ix);
      this.d.changed();
    }
    const rec = ix.packs.find((p) => p.meetingId === meetingId);
    if (!rec) throw new DesktopError('NOT_FOUND', 'This pack is not kept on this computer (or its offline time is over).');
    const body = this.read<{ manifest: Record<string, unknown>; file: string | null } | null>(uid, `pack-${meetingId}.wsb`, null);
    if (!body) throw new DesktopError('NOT_FOUND', 'The offline copy could not be read. Download it again.');
    const { versionId: _v, circularIds: _c, ...summary } = rec;
    return { summary, manifest: body.manifest, file: body.file ? new Uint8Array(Buffer.from(body.file, 'base64')) : null };
  }

  remove(meetingId: number): BoardVaultStatus {
    const uid = this.uid();
    const ix = this.index(uid);
    rmSync(join(this.dir(uid), `pack-${meetingId}.wsb`), { force: true });
    ix.packs = ix.packs.filter((p) => p.meetingId !== meetingId);
    this.save(uid, ix);
    this.d.changed();
    return this.status();
  }

  /** Something done offline (FR-OFF-02): a later edit of the same item replaces the earlier one. */
  enqueue(input: { kind: 'annotation' | 'ack' | 'note'; meetingId: number; ref: string; body: Record<string, unknown> }): BoardQueued {
    const uid = this.uid();
    const ix = this.index(uid);
    const item: QueueRecord = { id: randomUUID(), kind: input.kind, meetingId: input.meetingId, circularId: null, ref: input.ref, at: new Date(this.now()).toISOString(), error: null, outcome: 'pending', body: input.body };
    ix.queue = [...ix.queue.filter((q) => !(q.outcome === 'pending' && q.kind === input.kind && q.ref === input.ref)), item];
    this.save(uid, ix);
    this.d.changed();
    return strip(item);
  }

  queue(): BoardQueued[] {
    return this.index(this.uid()).queue.map(strip);
  }

  /** The circular as kept in an offline pack's manifest. */
  private keptCircular(uid: string, ix: Index, circularId: number): CircularForOffline | null {
    for (const p of ix.packs) {
      if (!p.circularIds.includes(circularId)) continue;
      const body = this.read<{ manifest: Record<string, unknown> } | null>(uid, `pack-${p.meetingId}.wsb`, null);
      const c = arr(body?.manifest.circulars).find((x) => num(x.id) === circularId);
      const policy = obj(body?.manifest.policy);
      if (c) {
        return {
          id: circularId,
          status: str(c.status) ?? 'open',
          deadline: str(c.deadline),
          offline_responses_allowed: c.offline_responses_allowed === true || (c.offline_responses_allowed === undefined && policy.offline_circular_responses === true),
          can_respond: c.can_respond !== false,
          secret: c.secret === true,
          live_meeting: c.live_meeting === true,
        };
      }
    }
    return null;
  }

  private signingKey(uid: string): { privatePem: string; publicPem: string } {
    const stored = this.d.secrets.get(this.signName(uid));
    if (stored) {
      const priv = createPrivateKey(stored);
      return { privatePem: stored, publicPem: createPublicKey(priv).export({ type: 'spki', format: 'pem' }).toString() };
    }
    const { privateKey, publicKey } = generateKeyPairSync('ed25519');
    const privatePem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
    this.d.secrets.set(this.signName(uid), privatePem);
    return { privatePem, publicPem: publicKey.export({ type: 'spki', format: 'pem' }).toString() };
  }

  /** Records a circular response offline (FR-VOT-08), signed now; one waiting response per circular, the latest kept. */
  respondOffline(input: { circularId: number; choice: 'approve' | 'reject' | 'abstain'; comment?: string }): BoardQueued {
    const uid = this.uid();
    const ix = this.index(uid);
    if (ix.trust === 'blocked' || ix.trust === 'revoked') throw new DesktopError('DEVICE_REVOKED', 'This device may not record responses.');
    const refusal = offlineResponseRefusal(this.keptCircular(uid, ix, input.circularId), this.now());
    if (refusal) throw new DesktopError('POLICY_DENIED', refusal);
    const deviceId = this.d.deviceId() ?? 'unregistered';
    const recordedAt = new Date(this.now()).toISOString();
    const { privatePem, publicPem } = this.signingKey(uid);
    const payload = offlineResponsePayload({ circularId: input.circularId, choice: input.choice, comment: input.comment ?? '', recordedAt, deviceId });
    const signature = sign(null, Buffer.from(payload), createPrivateKey(privatePem)).toString('base64');
    const item: QueueRecord = {
      id: randomUUID(),
      kind: 'circular',
      meetingId: null,
      circularId: input.circularId,
      ref: `circular-${input.circularId}`,
      at: recordedAt,
      error: null,
      outcome: 'pending',
      body: { choice: input.choice, comment: input.comment ?? null, recorded_at: recordedAt, device_id: deviceId, signature, public_key: publicPem },
    };
    ix.queue = [...ix.queue.filter((q) => !(q.kind === 'circular' && q.circularId === input.circularId && q.outcome === 'pending')), item];
    this.save(uid, ix);
    this.d.changed();
    return strip(item);
  }

  /** Sends what waits, checks each kept pack against the server, reports a wipe, erases what expired. */
  async sync(): Promise<BoardVaultStatus> {
    const uid = this.uid();
    const ix = this.index(uid);
    try {
      if (ix.wipeToReport) {
        const deviceId = this.d.deviceId();
        if (deviceId) await this.d.http.post(`${BASE}/devices/${deviceId}/wipe-report`, { wiped_at: ix.wipeToReport.at, reason: ix.wipeToReport.reason, packs: ix.wipeToReport.packs });
        ix.wipeToReport = null;
        this.save(uid, ix);
      }
      for (const q of ix.queue.filter((x) => x.outcome === 'pending')) {
        try {
          if (q.kind === 'circular') {
            const r = obj(await this.d.http.post(`${BASE}/circulars/${q.circularId}/offline-responses`, { responses: [q.body] }));
            const first = arr(r.results)[0] ?? r;
            const accepted = first.status === 'accepted' || first.accepted === true;
            q.outcome = accepted ? 'accepted' : 'rejected';
            q.error = accepted ? null : (str(first.reason) ?? 'The server did not accept this response.');
          } else if (q.kind === 'ack') {
            await this.d.http.post(`${BASE}/meetings/${q.meetingId}/pack/acknowledge`, q.body);
            q.outcome = 'accepted';
          } else {
            await this.d.http.post(`${BASE}/meetings/${q.meetingId}/${q.kind === 'note' ? 'notes' : 'annotations'}`, { ...q.body, client_ref: q.ref, client_updated_at: q.at });
            q.outcome = 'accepted';
          }
        } catch (e) {
          if (isDesktopError(e) && (e.code === 'NETWORK_UNREACHABLE' || e.code === 'SERVER_ERROR' || e.code === 'RATE_LIMITED' || e.code === 'SESSION_EXPIRED')) throw e;
          if (this.wipeIfRevoked(e)) return this.status();
          q.outcome = 'rejected';
          q.error = e instanceof Error ? e.message : String(e);
        }
      }
      // Sent items drop off after a day; rejections stay until seen and the queue is next synced a day later.
      const dayAgo = this.now() - 86_400_000;
      ix.queue = ix.queue.filter((q) => q.outcome === 'pending' || Date.parse(q.at) > dayAgo);
      for (const p of [...ix.packs]) {
        try {
          const m = obj(await this.d.http.get(`${BASE}/offline/manifest/${p.meetingId}`));
          const latest = num(obj(m.pack).version);
          p.latestVersion = latest && latest > p.version ? latest : null;
          const archive = str(obj(m.meeting).archive_at);
          if (archive) p.expiresAt = new Date(Math.min(Date.parse(p.expiresAt), Date.parse(packExpiry({ archiveAt: archive }, this.now())))).toISOString();
        } catch (e) {
          if (this.wipeIfRevoked(e)) return this.status();
          // Withdrawn, archived or no longer mine: the copy goes.
          if (isDesktopError(e) && (e.code === 'NOT_FOUND' || e.code === 'PERMISSION_DENIED')) {
            rmSync(join(this.dir(uid), `pack-${p.meetingId}.wsb`), { force: true });
            ix.packs = ix.packs.filter((x) => x !== p);
          } else throw e;
        }
      }
      // A revoked or blocked device stays so until the person signs in again (the sign-in asks the server afresh).
      if (ix.trust !== 'revoked' && ix.trust !== 'blocked') ix.trust = 'trusted';
      ix.lastSyncAt = new Date(this.now()).toISOString();
      if (ix.trust === 'trusted') ix.wiped = null;
    } catch (e) {
      log.info('board vault sync stopped', { error: String(e) });
    }
    this.purgeExpired(uid, ix);
    this.save(uid, ix);
    this.d.changed();
    return this.status();
  }

  /** Searches the kept packs' agenda, papers and my notes (D-07 offline). */
  search(q: string): BoardSearchHit[] {
    const uid = this.uid();
    const ix = this.index(uid);
    const needle = q.toLowerCase();
    const hits: BoardSearchHit[] = [];
    const snip = (t: string) => {
      const i = t.toLowerCase().indexOf(needle);
      return i < 0 ? null : `${i > 40 ? '…' : ''}${t.slice(Math.max(0, i - 40), i + needle.length + 60)}`;
    };
    for (const p of ix.packs) {
      if (packExpired(p.expiresAt, this.now())) continue;
      const body = this.read<{ manifest: Record<string, unknown> } | null>(uid, `pack-${p.meetingId}.wsb`, null);
      if (!body) continue;
      for (const a of arr(body.manifest.agenda)) {
        const t = `${str(a.number) ?? ''} ${str(a.title) ?? ''}`.trim();
        const s = snip(t);
        if (s) hits.push({ meetingId: p.meetingId, type: 'agenda', title: t, snippet: s, page: null });
      }
      for (const paper of arr(body.manifest.papers)) {
        const title = str(paper.title) ?? 'Paper';
        const pages = Array.isArray(paper.pages) ? (paper.pages as unknown[]).map(String) : [str(paper.text) ?? ''];
        let found = false;
        pages.forEach((text, i) => {
          const s = !found ? snip(text) : null;
          if (s) {
            found = true;
            hits.push({ meetingId: p.meetingId, type: 'paper', title, snippet: s, page: Array.isArray(paper.pages) ? i + 1 : null });
          }
        });
        if (!found && snip(title)) hits.push({ meetingId: p.meetingId, type: 'paper', title, snippet: title, page: null });
      }
      for (const n of arr(body.manifest.notes)) {
        const s = snip(str(n.text) ?? '');
        if (s) hits.push({ meetingId: p.meetingId, type: 'note', title: str(n.paper_title) ?? 'My note', snippet: s, page: num(n.page) });
      }
    }
    return hits.slice(0, 200);
  }

  /** A Board error or event that means this device is revoked or blocked: the vault goes. True when it did. */
  wipeIfRevoked(e: unknown): boolean {
    if (!isDesktopError(e) || !BOARD_WIPE_CODES.has(e.code)) return false;
    this.wipe(e.code === 'DEVICE_BLOCKED' ? 'blocked' : 'revoked');
    return true;
  }

  /** `board.device.revoked|blocked` from realtime (only for this device, when the event names one). */
  handleRealtime(e: { type?: string; device_id?: unknown }): void {
    if (!e.type || !BOARD_WIPE_EVENTS.has(e.type)) return;
    const mine = this.d.deviceId();
    if (e.device_id !== undefined && mine && String(e.device_id) !== String(mine)) return;
    if (!this.d.userId()) return;
    this.wipe(e.type === 'board.device.blocked' ? 'blocked' : 'revoked');
  }

  /**
   * Erases this person's vault: its folder inside the profile and its two keys. Nothing else — no downloads, no
   * personal files, no other app's data. The marker that remains (unreadable without a key) says only that a wipe
   * happened, so the next contact reports it.
   */
  wipe(why: 'revoked' | 'blocked' | 'signed-out' | 'policy'): void {
    const uid = this.d.userId();
    if (!uid) return;
    if (why !== 'revoked' && why !== 'blocked' && !existsSync(this.dir(uid))) return;
    const ix = this.index(uid);
    const packs = ix.packs.length;
    rmSync(this.dir(uid), { recursive: true, force: true });
    this.d.secrets.delete(this.keyName(uid));
    this.d.secrets.delete(this.signName(uid));
    this.memoryKeys.delete(uid);
    log.warn('board offline vault erased', { why, packs });
    if (why === 'revoked' || why === 'blocked') {
      const at = new Date(this.now()).toISOString();
      const reason = why === 'blocked' ? 'An administrator blocked this device.' : 'An administrator revoked this device.';
      this.save(uid, { ...EMPTY, trust: why, wiped: { at, reason }, wipeToReport: { at, reason, packs } });
    }
    this.d.changed();
  }

  /** Every person's vault on this account's profile (a remote wipe of WorkSuite's data). */
  wipeAll(): void {
    const uid = this.d.userId();
    if (uid) {
      this.d.secrets.delete(this.keyName(uid));
      this.d.secrets.delete(this.signName(uid));
    }
    rmSync(resolve(this.d.root()), { recursive: true, force: true });
    this.memoryKeys.clear();
    this.d.changed();
  }
}

function strip(q: QueueRecord): BoardQueued {
  const { body: _b, ...rest } = q;
  return rest;
}
