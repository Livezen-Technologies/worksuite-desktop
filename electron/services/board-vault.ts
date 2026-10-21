import { createCipheriv, createDecipheriv, createHash, generateKeyPairSync, createPrivateKey, createPublicKey, randomBytes, randomUUID, sign } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import {
  boardDeviceRefusal,
  offlineComment,
  offlineResponsePayload,
  offlineResponseRefusal,
  packExpired,
  signedAtStamp,
  type BoardKeptManifest,
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
 * WorkSuite Board's offline pack vault (SRS-BOARD-001 FR-OFF-01..03, FR-DEV-01..03, FR-VOT-08, FR-CIR-05), main
 * process only, against the server's contract (worksuite docs/board/API.md "Devices and offline"):
 *
 *  - THE DEVICE: on first offline use this computer registers as a Board device — `POST /devices {device_uid, name,
 *    platform, public_key}` with the raw Ed25519 public key, base64; the private half stays in the OS credential store.
 *    Every Board request from the main process (and, through the API proxy, from the pages) carries
 *    `X-Board-Device: {device_uid}`, so a blocked or revoked device is refused with
 *    `403 {errors: {code: "device_blocked"|"device_revoked", command: "WIPE"}}`.
 *  - KEPT ENCRYPTED: every file — the index, each meeting's copy, the offline queue — is AES-256-GCM under a key made
 *    for this person on this computer and held only in the OS credential store. Without a keyring the key lives in
 *    memory and the packs last this session. Each file is bound to its own name (associated data).
 *  - WHAT is the server's: `POST /offline/grants {board_meeting_id, device_uid}` answers a signed Grant — the agenda
 *    version, the paper versions this member may read, the pack version, private notes — and its `expires_at` (the
 *    policy's max offline days, or the archiving). `GET /offline/manifest/{grantId}` re-reads it at sync. The pack
 *    file is the member's watermarked rendition (`GET /packs/versions/{id}/file?member=me`).
 *  - EXPIRY (FR-OFF-03): at the grant's `expires_at`. An expired pack is erased when it is next listed or opened.
 *  - REVOCATION (FR-DEV-02/03): `POST /devices/check-in` answering `command: WIPE`, or the 403 above on any Board call,
 *    erases this vault — its own folder inside the profile and its own keys, nothing else — and the wipe is reported
 *    with `POST /devices/{id}/wiped {result, grants}` at the next contact. `PURGE_GRANTS` erases just those meetings.
 *  - QUEUE (FR-OFF-02): annotations go up through `POST /annotations/sync` (last writer wins by `client_uuid` and
 *    `updated_at`), acknowledgements through `POST /packs/versions/{id}/acknowledge`.
 *  - OFFLINE CIRCULAR RESPONSES (FR-VOT-08): the open circulars that allow it are kept at each sync; a response is
 *    signed when it is recorded over the server's canonical JSON (`offlineResponsePayload`) and uploaded to
 *    `POST /circulars/{id}/offline-responses`, where it is ACCEPTED or REJECTED with a reason the person sees.
 */

const BASE = '/api/board';
const ALGO = 'aes-256-gcm';

type Opts = { headers?: Record<string, string> };

export interface BoardVaultDeps {
  http: {
    get<T = unknown>(path: string, opts?: Opts): Promise<T>;
    post<T = unknown>(path: string, body?: unknown, opts?: Opts): Promise<T>;
  };
  /** The pack file's bytes, or null when the server has none. */
  download: (path: string, headers: Record<string, string>) => Promise<Uint8Array | null>;
  secrets: { get(name: string): string | null; set(name: string, value: string): void; delete(name: string): void; getStatus(): { persistent: boolean; backend: string } };
  /** The account's Board folder inside its profile. */
  root: () => string;
  userId: () => string | null;
  /** This computer's stable id, sent as Board's `device_uid` (at most 64 characters). */
  deviceId: () => string | null;
  /** What the device is called in the administrator's device list. */
  deviceName?: () => string;
  platform?: () => string;
  /** The organization keeps offline data on computers (and the person has the Board app). */
  allowed: () => { ok: boolean; reason: string | null };
  changed: () => void;
  now?: () => number;
}

interface PackRecord extends BoardPackSummary {
  grantId: number;
  /** The pack version's id on the server (for the acknowledgement and the file). */
  versionId: number | null;
}

interface QueueRecord extends BoardQueued {
  body: Record<string, unknown>;
}

interface DeviceRecord {
  id: number;
  uid: string;
  status: string;
  trust_level: string;
  hasKey: boolean;
}

interface Index {
  packs: PackRecord[];
  queue: QueueRecord[];
  /** Open circulars that allow offline responses, as `GET /circulars?tab=open` gave them at the last sync. */
  circulars: CircularForOffline[];
  device: DeviceRecord | null;
  trust: BoardVaultStatus['trust'];
  lastSyncAt: string | null;
  wiped: { at: string; reason: string } | null;
  /** A wipe not yet reported to the server. */
  wipeToReport: { at: string; reason: string; deviceId: number | null; grants: number[] } | null;
}

const EMPTY: Index = { packs: [], queue: [], circulars: [], device: null, trust: 'unknown', lastSyncAt: null, wiped: null, wipeToReport: null };

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

  private dropPack(uid: string, ix: Index, meetingId: number): void {
    rmSync(join(this.dir(uid), `pack-${meetingId}.wsb`), { force: true });
    ix.packs = ix.packs.filter((p) => p.meetingId !== meetingId);
  }

  /** Erases packs whose grant has expired (FR-OFF-03). */
  private purgeExpired(uid: string, ix: Index): boolean {
    const now = this.now();
    const gone = ix.packs.filter((p) => packExpired(p.expiresAt, now));
    for (const p of gone) this.dropPack(uid, ix, p.meetingId);
    return gone.length > 0;
  }

  /** `X-Board-Device` for a Board request (main process and API proxy alike); nothing for other paths. */
  headers(path = BASE): Record<string, string> {
    const uid = this.d.deviceId();
    return uid && (path === BASE || path.startsWith(`${BASE}/`) || path.startsWith(`${BASE}?`)) ? { 'X-Board-Device': uid.slice(0, 64) } : {};
  }

  private deviceUid(): string {
    const uid = this.d.deviceId();
    if (!uid) throw new DesktopError('DEVICE_NOT_REGISTERED', 'This computer is not registered with WorkSuite yet.');
    return uid.slice(0, 64);
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
      packs: ix.packs.map(summaryOf),
      queued: ix.queue.filter((q) => q.outcome === 'pending').length,
      wiped: ix.wiped,
    };
  }

  private trustOf(dev: DeviceRecord): BoardVaultStatus['trust'] {
    if (dev.status === 'BLOCKED') return 'blocked';
    if (dev.status === 'REVOKED') return 'revoked';
    return dev.trust_level === 'TRUSTED' ? 'trusted' : 'pending';
  }

  /** Registers this computer as a Board device with its Ed25519 public key (FR-DEV-01); known devices answer as they are. */
  private async ensureDevice(uid: string, ix: Index): Promise<DeviceRecord> {
    const deviceUid = this.deviceUid();
    if (ix.device && ix.device.uid === deviceUid && ix.device.hasKey && ix.device.status === 'ACTIVE' && ix.device.trust_level === 'TRUSTED') return ix.device;
    const r = obj(
      await this.d.http.post(
        `${BASE}/devices`,
        { device_uid: deviceUid, name: this.d.deviceName?.() ?? 'WorkSuite Desktop', platform: (this.d.platform?.() ?? 'desktop').slice(0, 20), public_key: this.signingKey(uid).publicRaw },
        { headers: this.headers() },
      ),
    );
    const dv = obj(r.device);
    const dev: DeviceRecord = { id: num(dv.id) ?? 0, uid: deviceUid, status: str(dv.status) ?? 'ACTIVE', trust_level: str(dv.trust_level) ?? 'PENDING', hasKey: dv.has_key === true };
    ix.device = dev;
    ix.trust = this.trustOf(dev);
    this.save(uid, ix);
    return dev;
  }

  /** Keeps a meeting offline: the grant, what the screens show with it, and the member's rendition — sealed as they arrive. */
  async download(meetingId: number): Promise<BoardPackSummary> {
    const uid = this.uid();
    const ok = this.d.allowed();
    if (!ok.ok) throw new DesktopError('POLICY_DENIED', ok.reason ?? 'Offline packs are not allowed on this computer.');
    const ix = this.index(uid);
    if (ix.trust === 'revoked' || ix.trust === 'blocked') throw new DesktopError('DEVICE_REVOKED', 'This device may not keep Board packs offline.');
    const h = { headers: this.headers() };
    try {
      const dev = await this.ensureDevice(uid, ix);
      if (dev.trust_level !== 'TRUSTED') throw new DesktopError('POLICY_DENIED', 'An administrator has not approved this computer for Board offline use yet.');
      const grant = obj(obj(await this.d.http.post(`${BASE}/offline/grants`, { board_meeting_id: meetingId, device_uid: dev.uid }, h)).grant);
      const grantId = num(grant.id);
      const expiresAt = str(grant.expires_at);
      if (!grantId || !expiresAt) throw new DesktopError('SERVER_ERROR', 'The server did not issue an offline grant.');
      const manifest = obj(grant.manifest);
      const meeting = obj(await this.d.http.get(`${BASE}/meetings/${meetingId}`, h));
      const agenda = obj(await this.d.http.get(`${BASE}/meetings/${meetingId}/agenda`, h));
      const notes = arr(obj(await this.d.http.get(`${BASE}/annotations?board_meeting_id=${meetingId}&mine=1`, h)).items);
      const pack = obj(obj(await this.d.http.get(`${BASE}/meetings/${meetingId}/pack`, h)).pack);
      const version = num(manifest.pack_version) ?? num(pack.current_version);
      const pv = arr(pack.versions).find((v) => num(v.version) === version) ?? null;
      const versionId = pv ? num(pv.id) : null;
      const file = versionId ? await this.d.download(`${BASE}/packs/versions/${versionId}/file?member=me`, this.headers()) : null;
      const kept: BoardKeptManifest = {
        grant: manifest,
        meeting: { id: meetingId, title: str(meeting.title) ?? `Meeting ${meetingId}`, meeting_number: str(meeting.meeting_number), body: str(meeting.body), starts_at: str(meeting.starts_at) },
        agenda: flattenAgenda(arr(agenda.items)),
        notes,
      };
      const rec: PackRecord = {
        meetingId,
        title: kept.meeting.title,
        version: version ?? 0,
        pages: pv ? num(pv.pages) : null,
        notes: notes.length,
        bytes: file?.byteLength ?? 0,
        downloadedAt: new Date(this.now()).toISOString(),
        expiresAt,
        latestVersion: null,
        state: 'ready',
        grantId,
        versionId,
      };
      this.write(uid, `pack-${meetingId}.wsb`, { manifest: kept, file: file ? Buffer.from(file).toString('base64') : null });
      ix.packs = [...ix.packs.filter((p) => p.meetingId !== meetingId), rec];
      this.save(uid, ix);
      this.d.changed();
      return summaryOf(rec);
    } catch (e) {
      const wiped = this.wipeIfRevoked(e);
      if (wiped) throw new DesktopError('DEVICE_REVOKED', `This device was ${wiped}; its Board packs were erased.`);
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
    const body = this.read<{ manifest: BoardKeptManifest; file: string | null } | null>(uid, `pack-${meetingId}.wsb`, null);
    if (!body) throw new DesktopError('NOT_FOUND', 'The offline copy could not be read. Download it again.');
    return { summary: summaryOf(rec), manifest: body.manifest, file: body.file ? new Uint8Array(Buffer.from(body.file, 'base64')) : null };
  }

  remove(meetingId: number): BoardVaultStatus {
    const uid = this.uid();
    const ix = this.index(uid);
    this.dropPack(uid, ix, meetingId);
    this.save(uid, ix);
    this.d.changed();
    return this.status();
  }

  /** Something done offline (FR-OFF-02): a later edit of the same item replaces the earlier one. */
  enqueue(input: { kind: 'annotation' | 'ack'; meetingId: number; ref: string; body: Record<string, unknown> }): BoardQueued {
    const uid = this.uid();
    const ix = this.index(uid);
    // An acknowledgement names the pack version read; offline, the one kept here.
    const body = input.kind === 'ack' && !input.body.pack_version_id ? { ...input.body, pack_version_id: ix.packs.find((p) => p.meetingId === input.meetingId)?.versionId ?? null } : input.body;
    const item: QueueRecord = { id: randomUUID(), kind: input.kind, meetingId: input.meetingId, circularId: null, ref: input.ref, at: new Date(this.now()).toISOString(), error: null, outcome: 'pending', body };
    ix.queue = [...ix.queue.filter((q) => !(q.outcome === 'pending' && q.kind === input.kind && q.ref === input.ref)), item];
    this.save(uid, ix);
    this.d.changed();
    return strip(item);
  }

  queue(): BoardQueued[] {
    return this.index(this.uid()).queue.map(strip);
  }

  /** The device's Ed25519 key: PKCS#8 in the credential store, and the raw 32-byte public key the server takes (base64). */
  private signingKey(uid: string): { privatePem: string; publicRaw: string } {
    let privatePem = this.d.secrets.get(this.signName(uid));
    if (!privatePem) {
      privatePem = generateKeyPairSync('ed25519').privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
      this.d.secrets.set(this.signName(uid), privatePem);
    }
    const der = createPublicKey(createPrivateKey(privatePem)).export({ type: 'spki', format: 'der' });
    return { privatePem, publicRaw: Buffer.from(der.subarray(der.length - 32)).toString('base64') };
  }

  /** Records a circular response offline (FR-VOT-08), signed now; one waiting response per circular, the latest kept. */
  respondOffline(input: { circularId: number; choice: 'approve' | 'reject' | 'abstain'; comment?: string }): BoardQueued {
    const uid = this.uid();
    const ix = this.index(uid);
    if (ix.trust === 'blocked' || ix.trust === 'revoked') throw new DesktopError('DEVICE_REVOKED', 'This device may not record responses.');
    // The server verifies against the key it was given at registration: without one there, nothing would verify.
    if (!ix.device?.hasKey || ix.device.uid !== this.d.deviceId()?.slice(0, 64)) throw new DesktopError('POLICY_DENIED', 'This computer is not set up for Board offline use yet. Download a pack once while online.');
    const refusal = offlineResponseRefusal(ix.circulars.find((c) => c.id === input.circularId), this.now());
    if (refusal) throw new DesktopError('POLICY_DENIED', refusal);
    const userId = Number(uid);
    if (!Number.isInteger(userId) || userId <= 0) throw new DesktopError('NOT_SIGNED_IN', 'Sign in again to respond offline.');
    const signedAt = signedAtStamp(this.now());
    const response = input.choice.toUpperCase();
    const comment = offlineComment(input.comment);
    const { privatePem } = this.signingKey(uid);
    const payload = offlineResponsePayload({ circularId: input.circularId, userId, response, comment, signedAt });
    const signature = sign(null, Buffer.from(payload, 'utf8'), createPrivateKey(privatePem)).toString('base64');
    const item: QueueRecord = {
      id: randomUUID(),
      kind: 'circular',
      meetingId: null,
      circularId: input.circularId,
      ref: `circular-${input.circularId}`,
      at: signedAt,
      error: null,
      outcome: 'pending',
      body: { device_uid: ix.device.uid, response, comment, device_signed_at: signedAt, signature, client_uuid: randomUUID() },
    };
    ix.queue = [...ix.queue.filter((q) => !(q.kind === 'circular' && q.circularId === input.circularId && q.outcome === 'pending')), item];
    this.save(uid, ix);
    this.d.changed();
    return strip(item);
  }

  /** Checks in, reports a wipe, sends what waits, re-reads each grant, keeps the open circulars, erases what expired. */
  async sync(): Promise<BoardVaultStatus> {
    const uid = this.uid();
    const ix = this.index(uid);
    const h = { headers: this.headers() };
    try {
      if (ix.wipeToReport) {
        const w = ix.wipeToReport;
        // Without X-Board-Device: the report is the device's own, by its id.
        if (w.deviceId) await this.d.http.post(`${BASE}/devices/${w.deviceId}/wiped`, { result: `Board vault destroyed (${w.reason})`, grants: w.grants });
        ix.wipeToReport = null;
        this.save(uid, ix);
      }
      const deviceUid = this.d.deviceId()?.slice(0, 64);
      if (deviceUid) {
        const c = obj(await this.d.http.post(`${BASE}/devices/check-in`, { device_uid: deviceUid }, h));
        const status = str(c.status) ?? 'UNKNOWN';
        if (c.command === 'WIPE' || (status !== 'UNKNOWN' && c.allowed === false && (status === 'BLOCKED' || status === 'REVOKED'))) {
          this.wipe(status === 'BLOCKED' ? 'blocked' : 'revoked');
          return this.status();
        }
        if (c.command === 'PURGE_GRANTS') {
          const gone = new Set(Array.isArray(c.revoked_grants) ? c.revoked_grants.map(num) : []);
          for (const p of ix.packs.filter((x) => gone.has(x.grantId))) this.dropPack(uid, ix, p.meetingId);
        }
        if (ix.device && ix.device.uid === deviceUid && status !== 'UNKNOWN') ix.device.status = status;
        // A device waiting for approval (or one whose record changed) hears its trust again.
        if (ix.device || ix.packs.length) await this.ensureDevice(uid, ix);
      }
      for (const q of ix.queue.filter((x) => x.outcome === 'pending')) {
        try {
          if (q.kind === 'circular') {
            const r = obj(await this.d.http.post(`${BASE}/circulars/${q.circularId}/offline-responses`, { responses: [q.body] }, h));
            const first = arr(r.results).find((x) => x.client_uuid === q.body.client_uuid) ?? arr(r.results)[0] ?? {};
            const accepted = first.verdict === 'ACCEPTED';
            q.outcome = accepted ? 'accepted' : 'rejected';
            q.error = accepted ? null : (str(first.reason) ?? 'The server did not accept this response.');
          } else if (q.kind === 'ack') {
            const vid = num(q.body.pack_version_id);
            if (!vid) throw new DesktopError('IPC_VALIDATION_FAILED', 'The pack version is not known.');
            await this.d.http.post(`${BASE}/packs/versions/${vid}/acknowledge`, {}, h);
            q.outcome = 'accepted';
          } else {
            const r = obj(await this.d.http.post(`${BASE}/annotations/sync`, { items: [{ ...q.body, board_meeting_id: q.meetingId, client_uuid: q.ref, updated_at: q.at }] }, h));
            const res = arr(r.items)[0] ?? {};
            const code = num(res.status) ?? 200;
            q.outcome = code < 300 ? 'accepted' : 'rejected';
            q.error = code < 300 ? null : (str(obj(res.body).message) ?? `The server answered ${code}.`);
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
          const g = obj(await this.d.http.get(`${BASE}/offline/manifest/${p.grantId}`, h));
          if (g.valid === false || g.revoked_at || g.wiped_at) {
            this.dropPack(uid, ix, p.meetingId);
            continue;
          }
          const exp = str(g.expires_at);
          if (exp) p.expiresAt = exp;
          // The grant names the version it was issued for; the meeting says what is current now.
          const cur = num(obj(obj(await this.d.http.get(`${BASE}/meetings/${p.meetingId}`, h)).pack).current_version);
          p.latestVersion = cur && cur > p.version ? cur : null;
        } catch (e) {
          if (this.wipeIfRevoked(e)) return this.status();
          // Withdrawn, archived or no longer mine: the copy goes.
          if (isDesktopError(e) && (e.code === 'NOT_FOUND' || e.code === 'PERMISSION_DENIED')) this.dropPack(uid, ix, p.meetingId);
          else throw e;
        }
      }
      // The open circulars that may be answered offline, kept for when there is no connection (FR-VOT-08).
      try {
        const list = arr(obj(await this.d.http.get(`${BASE}/circulars?tab=open`, h)).items);
        ix.circulars = list
          .filter((c) => c.allow_offline === true)
          .map((c) => ({ id: num(c.id) ?? 0, status: str(c.status) ?? '', deadline_at: str(c.deadline_at), allow_offline: true, secret: c.secret === true, me: c.me ? { eligible: obj(c.me).eligible !== false, response: str(obj(c.me).response) } : null }))
          .filter((c) => c.id > 0);
      } catch (e) {
        if (this.wipeIfRevoked(e)) return this.status();
        if (!(isDesktopError(e) && e.code === 'PERMISSION_DENIED')) throw e;
        ix.circulars = [];
      }
      ix.lastSyncAt = new Date(this.now()).toISOString();
      if (ix.trust === 'trusted' || ix.trust === 'pending' || ix.trust === 'unknown') ix.wiped = null;
    } catch (e) {
      log.info('board vault sync stopped', { error: String(e) });
      if (this.wipeIfRevoked(e)) return this.status();
    }
    this.purgeExpired(uid, ix);
    this.save(uid, ix);
    this.d.changed();
    return this.status();
  }

  /** Searches the kept packs' agenda, paper titles and my notes (D-07 offline). */
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
      const body = this.read<{ manifest: BoardKeptManifest } | null>(uid, `pack-${p.meetingId}.wsb`, null);
      if (!body) continue;
      for (const a of body.manifest.agenda ?? []) {
        const t = `${a.number} ${a.title}`.trim();
        const s = snip(t);
        if (s) hits.push({ meetingId: p.meetingId, type: 'agenda', title: t, snippet: s, page: null });
      }
      for (const paper of arr(body.manifest.grant.papers)) {
        const title = str(paper.title) ?? 'Paper';
        if (snip(title)) hits.push({ meetingId: p.meetingId, type: 'paper', title, snippet: title, page: null });
      }
      for (const n of body.manifest.notes ?? []) {
        const text = [str(obj(n.anchor).text), str(n.body)].filter(Boolean).join(' — ');
        const s = snip(text);
        if (s) hits.push({ meetingId: p.meetingId, type: 'note', title: 'My note', snippet: s, page: num(n.page) });
      }
    }
    return hits.slice(0, 200);
  }

  /** A Board refusal that means this device is revoked or blocked: the vault goes. Says which when it did. */
  wipeIfRevoked(e: unknown): 'blocked' | 'revoked' | null {
    if (!isDesktopError(e)) return null;
    const why = boardDeviceRefusal(e.status, e.data);
    if (!why) return null;
    this.wipe(why);
    return why;
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
    const grants = ix.packs.length ? ix.packs.map((p) => p.grantId) : (ix.wipeToReport?.grants ?? []);
    const deviceId = ix.device?.id ?? ix.wipeToReport?.deviceId ?? null;
    rmSync(this.dir(uid), { recursive: true, force: true });
    this.d.secrets.delete(this.keyName(uid));
    this.d.secrets.delete(this.signName(uid));
    this.memoryKeys.delete(uid);
    log.warn('board offline vault erased', { why, packs });
    if (why === 'revoked' || why === 'blocked') {
      const at = new Date(this.now()).toISOString();
      const reason = why === 'blocked' ? 'An administrator blocked this device.' : 'An administrator revoked this device.';
      this.save(uid, { ...EMPTY, trust: why, wiped: { at, reason }, wipeToReport: { at, reason, deviceId, grants } });
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

/** The server's agenda (items nested in `children`), flattened in order, withheld items kept as their placeholder. */
export function flattenAgenda(items: Record<string, unknown>[], depth = 0): BoardKeptManifest['agenda'] {
  const out: BoardKeptManifest['agenda'] = [];
  for (const it of items) {
    out.push({ id: num(it.id) ?? 0, number: str(it.number) ?? '', title: str(it.title) ?? '', depth: num(it.depth) ?? depth, papers: arr(it.papers).map((p) => ({ id: num(p.id) ?? 0, title: str(p.title) ?? '' })) });
    out.push(...flattenAgenda(arr(it.children), depth + 1));
  }
  return out;
}

function summaryOf(p: PackRecord): BoardPackSummary {
  const { grantId: _g, versionId: _v, ...rest } = p;
  return rest;
}

function strip(q: QueueRecord): BoardQueued {
  const { body: _b, ...rest } = q;
  return rest;
}
