import { createHash, randomUUID, verify, type KeyObject } from 'node:crypto';
import { mkdir, readFile, rename, stat, writeFile, open as openFile } from 'node:fs/promises';
import { basename, dirname, extname, isAbsolute, join } from 'node:path';
import { builtinProfiles, convert as engineConvert, detect as engineDetect, VERSION as ENGINE_VERSION, verifyProfile, type Profile } from '@worksuite/sinhala-core';
import { canonicalJson } from '@shared/canonical-json';
import {
  fontManifestSchema,
  orgSettingsFrom,
  profilesResponseSchema,
  statusResponseSchema,
  serverJobSchema,
  serverProfileSchema,
  SINHALA_ORG_DEFAULTS,
  SINHALA_USER_DEFAULTS,
  unicodeCopyName,
  type SinhalaAvailability,
  type SinhalaClipboardResult,
  type SinhalaConvertFileInput,
  type SinhalaConvertResult,
  type SinhalaDetectResult,
  type SinhalaDirection,
  type SinhalaDocxResult,
  type SinhalaFontManifest,
  type SinhalaFontsStatus,
  type SinhalaJob,
  type SinhalaLocalFile,
  type SinhalaOrgSettings,
  type SinhalaProfileSummary,
  type SinhalaProfilesView,
  type SinhalaSettingsPatch,
  type SinhalaStatus,
  type SinhalaUserSettings,
} from '@shared/sinhala';
import type { IpcRouter } from '../ipc/router';
import { DesktopError, isDesktopError } from '../main/errors';
import { logger } from '../main/log';
import { readZip, type DocxConvertStats } from './sinhala-docx';

const log = logger('sinhala');

/**
 * SinhalaService — Sinhala Tools on this computer (WorkSuite Desktop Sinhala Tools blueprint §6; P2, and P4's device
 * fonts). One engine, `@worksuite/sinhala-core`, pinned in vendor/sinhala-core; the server stays authoritative.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHETHER THE TOOLS ARE OFFERED
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * `GET api/sinhala/profiles` (sinhala.use) decides, on sign-in, on every bootstrap change and once a day:
 *  - 200: the org's profiles (and, when it sends them, its settings): `ok`, or `disabled` when the org turned the tools
 *    off. 404: the server has no Sinhala API (`no_api`). 403: this person lacks sinhala.use (`forbidden`).
 *  - No answer (offline, server down): the last answer stands — offline conversion keeps working with the last good
 *    profiles. Before any answer at all the tools stay hidden (fail closed, blueprint §10 risks).
 * Anything but `ok` hides the tools: the app, the tray line and the clipboard key go, and the channels refuse.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * PROFILES (AC-SI-05)
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * A profile is used only after its sha256 checks out (the engine's `verifyProfile`, over the canonical JSON of the
 * profile without `sha256`) and — when the server sends a `signature` — after that Ed25519 signature checks against a
 * key pinned in this build (the Update Center's release keys, the family Desktop trusts for updates; WF-SI-06): over
 * the canonical JSON of the profile without `signature`, `key_id` naming the key. A profile without a signature is
 * used on its sha256 alone and shown as unsigned (`signed: false`): the server does not sign profiles yet.
 * The last set that checked out is kept per account and person in the app database and checked again every time it
 * is read, so a cache edited on disk is refused like a tampered download. With nothing good, the engine's own
 * built-in profiles are used.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ONLINE AND OFFLINE (§6.3)
 * ─────────────────────────────────────────────────────────────────────────────
 *
 *  - Text (convert, detect, the clipboard) is converted here, in the main process: microseconds per kilobyte, and the
 *    clipboard key has 200 ms for 10,000 characters (AC-SI-06).
 *  - A Drive file, online: `POST api/sinhala/files/{id}/convert`; the server writes the new version and everyone sees it.
 *  - A Drive file's offline copy, or a file on this computer: the worker converts it with the cached profiles and
 *    writes `name (Unicode).docx` beside the original. An offline Drive copy's result is queued and uploaded as the
 *    file's new version when WorkSuite is back (a conflict keeps both: the converted copy goes up as a new file). A copy
 *    in a Drive sync folder is left to sync, which uploads it as a file of its own.
 *  - Every result carries the profile and version it used.
 *
 * No keystroke is read anywhere: the clipboard is read only when the person presses the key or picks the tray line.
 */

export interface SinhalaHttp {
  get<T = unknown>(path: string, opts?: { query?: Record<string, string | number | boolean | undefined | null> }): Promise<T>;
  post<T = unknown>(path: string, body?: unknown): Promise<T>;
  /** A download from the WorkSuite server (font files named by a relative URL), with the session's credentials. */
  download(path: string): Promise<Buffer>;
}

export interface SinhalaDocxRequest {
  profiles: Profile[];
  targetFont: string;
  force: string | null;
  path?: string;
  bytes?: Uint8Array;
  outPath?: string;
}

export interface SinhalaFontPlatform {
  platform: NodeJS.Platform;
  home: string;
  /** %LOCALAPPDATA% on Windows. */
  localAppData?: string | null;
}

export interface SinhalaDeps {
  http: SinhalaHttp;
  config: { getConfig<T>(key: string): T | undefined; setConfig(key: string, value: unknown): void; deleteConfig(key: string): void };
  /** `<account>:<user>` while signed in, else null. */
  scope: () => string | null;
  online: () => boolean;
  locked: () => boolean;
  /** Electron's clipboard (asynchronous since Electron 44). */
  clipboard: { readText(): Promise<string> | string; writeText(text: string): Promise<void> | void };
  shortcuts: { register(accelerator: string, fn: () => void): boolean; unregister(accelerator: string): void };
  toast: (kind: 'success' | 'info' | 'error', text: string) => void;
  changed: () => void;
  /** Whole documents, in the worker. */
  docx: (req: SinhalaDocxRequest) => Promise<{ stats: DocxConvertStats; bytes?: Uint8Array }>;
  /** A Drive file's copy on this computer, if there is one. */
  offlinePath: (fileId: number) => { path: string; synced: boolean } | null;
  /** `POST /api/files/{id}/versions` with this file: the new version, or 'conflict'. */
  uploadVersion: (fileId: number, path: string, name: string) => Promise<{ version: number | null } | 'conflict'>;
  /** The converted copy as a file of its own (a conflict's "keep both"). */
  uploadNew: (path: string, name: string) => Promise<void>;
  /** The main process's own open dialog. */
  pickFiles: (sender: Electron.WebContents) => Promise<string[]>;
  reveal: (path: string) => void;
  /** Font downloads from elsewhere than the WorkSuite server (an https URL in the manifest). */
  fetch: (url: string) => Promise<Response>;
  fonts: SinhalaFontPlatform;
  /** Runs a program (reg on Windows, fc-cache on Linux) without a shell. */
  run: (file: string, args: string[]) => Promise<void>;
  /** Ed25519 keys profile signatures may name (`key_id` → base64url raw key). */
  keys: Readonly<Record<string, string>>;
  ed25519Key: (rawBase64Url: string) => KeyObject;
  now?: () => number;
}

interface Cached {
  availability: SinhalaAvailability;
  profiles: unknown[];
  settings: SinhalaOrgSettings;
  syncedAt: string | null;
  /** The server's engine answered at the last status (its document jobs can run). */
  serverEngine?: boolean;
  formats?: string[];
  fonts?: SinhalaFontManifest | null;
}

interface Loaded {
  profile: Profile;
  signed: boolean;
  source: SinhalaProfileSummary['source'];
}

interface PendingUpload {
  jobId: string;
  fileId: number;
  path: string;
  name: string;
}

interface LocalHandle {
  path: string;
  name: string;
  size: number;
}

const DAY = 24 * 60 * 60_000;
const MAX_DOCX = 100 * 1024 * 1024;
/** The engine profile's own fields: what its sha256 is taken over (plus `sha256`). */
const PROFILE_FIELDS = ['id', 'name', 'version', 'status', 'fontNames', 'notes', 'passthrough', 'map', 'prebase', 'compose', 'sha256'] as const;

/** What the window may know of a profile. */
function summary(l: Loaded): SinhalaProfileSummary {
  const p = l.profile;
  return { id: p.id, name: p.name, version: p.version, status: p.status, fontNames: [...p.fontNames], sha256: p.sha256, source: l.source, signed: l.signed };
}

/**
 * A profile from the server (or the cache of one): its shape, its sha256 and, when it carries one, its signature.
 * Throws with the reason when any of them fails — the profile is then never used.
 */
export function checkServerProfile(raw: unknown, keys: Readonly<Record<string, string>>, keyOf: (raw: string) => KeyObject): { profile: Profile; signed: boolean } {
  const parsed = serverProfileSchema.safeParse(raw);
  if (!parsed.success) throw new Error('not a Sinhala profile listing');
  const item = parsed.data;
  if (!item.profile || typeof item.profile !== 'object') throw new Error(`profile ${item.id} ${item.version}: no profile data (ask with include=map)`);
  const data = item.profile as Record<string, unknown>;
  const engine: Record<string, unknown> = {};
  for (const k of PROFILE_FIELDS) engine[k] = data[k];
  const profile = verifyProfile(engine);
  // The listing must describe the data it carries: the same profile, version and sha256.
  if (profile.id !== item.id || profile.version !== item.version || profile.sha256 !== item.sha256) {
    throw new Error(`profile ${item.id} ${item.version}: the listing does not match its data (sha256)`);
  }
  const signature = item.signature || null;
  if (!signature) return { profile, signed: false };
  const keyId = item.key_id || Object.keys(keys)[0];
  const key = keyId ? keys[keyId] : undefined;
  if (!key) throw new Error(`profile ${profile.id} ${profile.version}: signed with an unknown key${keyId ? ` (${keyId})` : ''}`);
  // Signed: the engine's profile JSON (sha256 inside), canonical, with `key_id` when one is named.
  const signed: Record<string, unknown> = { ...engine, ...(item.key_id ? { key_id: item.key_id } : {}) };
  let ok = false;
  try {
    ok = verify(null, Buffer.from(canonicalJson(signed), 'utf8'), keyOf(key), Buffer.from(signature, 'base64'));
  } catch {
    ok = false;
  }
  if (!ok) throw new Error(`profile ${profile.id} ${profile.version}: the signature does not match`);
  return { profile, signed: true };
}

/** A font file's name in the archive → the name it is installed under; only the font files themselves. */
export function fontFilesOf(files: Record<string, string> | null | undefined): Array<{ path: string; name: string; sha256: string }> {
  return Object.entries(files ?? {})
    .filter(([path]) => /\.(ttf|otf)$/i.test(path))
    .map(([path, sha256]) => ({ path, name: basename(path.split('\\').join('/')), sha256 }))
    .filter((f) => /^[A-Za-z0-9 ._()-]{1,120}\.(ttf|otf)$/i.test(f.name));
}

/** Where fonts go for this person (blueprint §6.1 Fonts), or null where it is not supported. */
export function fontsDirFor(p: SinhalaFontPlatform): string | null {
  if (p.platform === 'win32') return p.localAppData ? join(p.localAppData, 'Microsoft', 'Windows', 'Fonts') : null;
  if (p.platform === 'darwin') return join(p.home, 'Library', 'Fonts');
  if (p.platform === 'linux') return join(p.home, '.local', 'share', 'fonts', 'worksuite');
  return null;
}

/** The Windows registry value a per-user font is listed under. */
export function windowsFontValue(family: string, file: string): string {
  const style = /bold/i.test(file) ? (/italic/i.test(file) ? ' Bold Italic' : ' Bold') : /italic/i.test(file) ? ' Italic' : '';
  return `${family}${style} (${/\.otf$/i.test(file) ? 'OpenType' : 'TrueType'})`;
}

export class SinhalaService {
  private cache: Cached | null = null;
  private cacheScope: string | null = null;
  private loaded: Loaded[] = [];
  private rejected: SinhalaProfilesView['rejected'] = [];
  private offline = false;
  private heldKey: string | null = null;
  private jobs = new Map<string, SinhalaJob & { outPath?: string }>();
  private handles = new Map<string, LocalHandle>();
  private manifest: SinhalaFontManifest | null = null;
  private timer: NodeJS.Timeout | null = null;
  private syncing: Promise<void> | null = null;

  constructor(private readonly d: SinhalaDeps) {}

  private now(): number {
    return this.d.now?.() ?? Date.now();
  }

  // ── state ────────────────────────────────────────────────────────────────

  private key(kind: string): string | null {
    const s = this.d.scope();
    return s ? `sinhala.${kind}:${s}` : null;
  }

  /** The cached answer for the person signed in now, loaded (and every profile in it checked again) on first use. */
  private state(): Cached | null {
    const scope = this.d.scope();
    if (scope !== this.cacheScope) {
      this.cacheScope = scope;
      this.cache = null;
      this.loaded = [];
      this.rejected = [];
      this.manifest = null;
      const key = this.key('cache');
      const raw = key ? this.d.config.getConfig<Cached>(key) : undefined;
      if (raw && typeof raw === 'object' && Array.isArray(raw.profiles)) {
        this.cache = { ...raw, settings: { ...SINHALA_ORG_DEFAULTS, ...(raw.settings ?? {}) }, syncedAt: raw.syncedAt ?? null };
        this.loaded = this.check(raw.profiles, 'cache');
      }
    }
    return this.cache;
  }

  private check(list: unknown[], source: 'server' | 'cache'): Loaded[] {
    const out: Loaded[] = [];
    this.rejected = [];
    for (const raw of list) {
      try {
        const { profile, signed } = checkServerProfile(raw, this.d.keys, this.d.ed25519Key);
        out.push({ profile, signed, source });
      } catch (e) {
        const r = raw as { id?: unknown; version?: unknown };
        const reason = e instanceof Error ? e.message : String(e);
        this.rejected.push({ id: String(r?.id ?? '?').slice(0, 64), version: String(r?.version ?? '?').slice(0, 32), reason: reason.slice(0, 300) });
        log.warn('profile refused', { id: r?.id, version: r?.version, source, reason });
      }
    }
    return out;
  }

  availability(): SinhalaAvailability {
    if (!this.d.scope()) return 'signed_out';
    return this.state()?.availability ?? 'no_api';
  }

  available(): boolean {
    return this.availability() === 'ok';
  }

  org(): SinhalaOrgSettings {
    return this.state()?.settings ?? SINHALA_ORG_DEFAULTS;
  }

  /** The profiles converting uses now: the server's that checked out, else the engine's own. */
  profiles(): Loaded[] {
    this.state();
    return this.loaded.length ? this.loaded : builtinProfiles.map((profile) => ({ profile, signed: false, source: 'builtin' as const }));
  }

  private engineProfiles(): Profile[] {
    return this.profiles().map((l) => l.profile);
  }

  user(): SinhalaUserSettings {
    const key = this.key('user');
    const saved = key ? this.d.config.getConfig<Partial<SinhalaUserSettings>>(key) : undefined;
    const u: SinhalaUserSettings = { ...SINHALA_USER_DEFAULTS, ...(saved && typeof saved === 'object' ? saved : {}) };
    const org = this.org();
    // What the organisation fixed is the organisation's (blueprint §6.1 Settings: "Admin policy can lock each").
    if (org.locked.includes('defaultProfile')) u.defaultProfile = org.defaultProfile;
    if (org.locked.includes('autoDetectOnPaste')) u.autoDetectOnPaste = org.autoDetectOnPaste;
    if (org.locked.includes('shortcut')) u.shortcut = SINHALA_USER_DEFAULTS.shortcut;
    return u;
  }

  setUser(patch: SinhalaSettingsPatch): SinhalaUserSettings {
    const key = this.key('user');
    if (!key) throw new DesktopError('NOT_SIGNED_IN', 'Sign in to change Sinhala settings.');
    const locked = this.org().locked.filter((k) => k in patch);
    if (locked.length) throw new DesktopError('POLICY_DENIED', 'Your organization set this, so it cannot be changed here.');
    if (patch.defaultProfile && patch.defaultProfile !== 'auto' && !this.engineProfiles().some((p) => p.id === patch.defaultProfile)) {
      throw new DesktopError('IPC_VALIDATION_FAILED', 'There is no such Sinhala font profile.');
    }
    const saved = this.d.config.getConfig<Partial<SinhalaUserSettings>>(key) ?? {};
    this.d.config.setConfig(key, { ...saved, ...patch });
    this.syncKey();
    this.d.changed();
    return this.user();
  }

  status(): SinhalaStatus {
    return {
      availability: this.availability(),
      offline: this.offline,
      org: this.org(),
      user: this.user(),
      shortcutHeld: this.heldKey,
      pendingUploads: this.pending().length,
      serverEngine: !this.offline && (this.state()?.serverEngine ?? false),
      serverFormats: this.state()?.formats ?? [],
      engineVersion: ENGINE_VERSION,
    };
  }

  profilesView(): SinhalaProfilesView {
    return { profiles: this.profiles().map(summary), syncedAt: this.state()?.syncedAt ?? null, rejected: [...this.rejected] };
  }

  private require(): void {
    const a = this.availability();
    if (a === 'ok') return;
    if (a === 'signed_out') throw new DesktopError('NOT_SIGNED_IN', 'Sign in to use Sinhala Tools.');
    throw new DesktopError('APP_ACCESS_DENIED', a === 'forbidden' ? 'You do not have access to Sinhala Tools.' : 'Sinhala Tools are not available for your organization.');
  }

  // ── the server ─────────────────────────────────────────────────────────

  /** Asks the server again (sign-in, a bootstrap change, daily, Refresh). Never throws. */
  sync(): Promise<void> {
    if (this.syncing) return this.syncing;
    this.syncing = this.pull().finally(() => {
      this.syncing = null;
    });
    return this.syncing;
  }

  private async pull(): Promise<void> {
    const scope = this.d.scope();
    const key = this.key('cache');
    if (!scope || !key) {
      this.syncKey();
      return;
    }
    this.state();
    const save = (c: Cached): void => {
      this.cache = c;
      this.d.config.setConfig(key, c);
    };
    try {
      // Whether this person may see the tools, and why not (any signed-in user may ask).
      const st = statusResponseSchema.parse(await this.d.http.get<unknown>('/api/sinhala/status'));
      if (this.d.scope() !== scope) return;
      this.offline = false;
      const reason = st.available ? null : (st.reason ?? 'DISABLED_FOR_ORGANIZATION');
      if (reason && reason !== 'SINHALA_UNAVAILABLE') {
        // No sinhala.use, or the company has the tools off: hidden, and nothing of theirs is kept.
        save({ availability: reason === 'NO_PERMISSION' ? 'forbidden' : 'disabled', profiles: [], settings: orgSettingsFrom(st), syncedAt: null, serverEngine: false, formats: [], fonts: null });
        this.loaded = [];
        this.manifest = null;
      } else {
        // Available (SINHALA_UNAVAILABLE only stops the server's own engine: this computer converts with its own).
        let fonts: SinhalaFontManifest | null = this.cache?.fonts ?? null;
        try {
          fonts = fontManifestSchema.parse(await this.d.http.get<unknown>('/api/sinhala/fonts'));
        } catch (e) {
          log.info('font list not read', { error: e instanceof Error ? e.message : String(e) });
        }
        this.manifest = fonts;
        const settings = orgSettingsFrom(st, fonts?.desktop_install_fonts);
        let profiles = this.cache?.profiles ?? [];
        let syncedAt = this.cache?.syncedAt ?? null;
        try {
          const body = profilesResponseSchema.parse(await this.d.http.get<unknown>('/api/sinhala/profiles', { query: { include: 'map' } }));
          const loaded = this.check(body.profiles, 'server');
          // Only what checked out is kept: the cache is never a way around the check.
          const good = body.profiles.filter((p) => loaded.some((l) => l.profile.id === (p as { id?: unknown }).id && l.profile.sha256 === (p as { sha256?: unknown }).sha256));
          if (loaded.length || !profiles.length) {
            profiles = good;
            this.loaded = loaded;
          }
          syncedAt = body.synced_at ?? new Date(this.now()).toISOString();
        } catch (e) {
          log.info('profiles not refreshed', { error: e instanceof Error ? e.message : String(e) });
        }
        save({ availability: 'ok', profiles, settings, syncedAt, serverEngine: st.worker?.ok ?? st.available, formats: st.formats ?? [], fonts });
      }
    } catch (e) {
      if (this.d.scope() !== scope) return;
      if (isDesktopError(e) && e.code === 'NOT_FOUND') {
        // A server without the Sinhala API: nothing is shown, and what was kept goes.
        save({ availability: 'no_api', profiles: [], settings: SINHALA_ORG_DEFAULTS, syncedAt: null, serverEngine: false, formats: [], fonts: null });
        this.loaded = [];
        this.offline = false;
      } else {
        // No answer: the last one stands, and converting goes on with the last good profiles.
        this.offline = true;
        log.info('Sinhala status not refreshed', { error: e instanceof Error ? e.message : String(e) });
      }
    }
    this.syncKey();
    this.d.changed();
    if (this.available()) {
      void this.flushUploads();
      if (this.org().installFonts === 'always') void this.installFonts(undefined, true).catch(() => undefined);
    }
  }

  /** Daily refresh while signed in (blueprint §6.1 Profile cache: "on sign-in and daily"). */
  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.sync(), DAY);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.releaseKey();
  }

  /** Signed out or switched: this person's jobs and handles go; their cache stays for their next, offline, sign-in. */
  signedOut(): void {
    this.releaseKey();
    this.jobs.clear();
    this.handles.clear();
    this.cacheScope = null;
    this.cache = null;
    this.loaded = [];
    this.manifest = null;
    this.d.changed();
  }

  /** Forgets everything kept for this person (a wipe). */
  forget(): void {
    for (const k of ['cache', 'user', 'uploads']) {
      const key = this.key(k);
      if (key) this.d.config.deleteConfig(key);
    }
    this.signedOut();
  }

  // ── text ───────────────────────────────────────────────────────────────

  private pick(id: string | undefined, text: string): Profile {
    const profiles = this.engineProfiles();
    const want = id && id !== 'auto' ? id : null;
    if (want) {
      const p = profiles.find((x) => x.id === want);
      if (!p) throw new DesktopError('NOT_FOUND', 'That Sinhala font profile is not available.');
      return p;
    }
    const u = this.user().defaultProfile;
    const detected = engineDetect(text, { profiles }).profile;
    const choice = detected ?? (u !== 'auto' ? u : this.org().defaultProfile);
    return profiles.find((x) => x.id === choice) ?? profiles.find((x) => x.id === this.org().defaultProfile) ?? profiles[0]!;
  }

  detect(text: string, fontNames?: string[]): SinhalaDetectResult {
    this.require();
    return engineDetect(text, { fontNames: fontNames ?? null, profiles: this.engineProfiles() });
  }

  convert(text: string, profile?: string, direction: SinhalaDirection = 'toUnicode'): SinhalaConvertResult {
    this.require();
    if (direction === 'toLegacy' && !this.org().allowReverse) throw new DesktopError('POLICY_DENIED', 'Your organization does not allow converting Unicode to legacy fonts.');
    const p = this.pick(profile, text);
    return engineConvert(text, p, direction);
  }

  /**
   * Converts what is on the clipboard (WF-SI-04): only the legacy stretches of it — English words and Unicode
   * Sinhala around them stay as they are — unless a profile is named, which converts it all. Puts the result back on
   * the clipboard and says which profile it used.
   */
  async clipboard(profile?: string): Promise<SinhalaClipboardResult> {
    this.require();
    const t0 = performance.now();
    const text = await this.d.clipboard.readText();
    const done = (r: Omit<SinhalaClipboardResult, 'ms' | 'chars'>): SinhalaClipboardResult => ({ ...r, chars: text.length, ms: Math.round((performance.now() - t0) * 10) / 10 });
    if (!text.trim()) {
      this.d.toast('info', 'The clipboard has no text to convert.');
      return done({ changed: false, profile: null, profileVersion: null, unmapped: 0 });
    }
    if (text.length > 500_000) throw new DesktopError('IPC_VALIDATION_FAILED', 'The clipboard holds too much text to convert at once.');
    const profiles = this.engineProfiles();
    let out = '';
    let unmapped = 0;
    let used: Profile | null = null;
    if (profile && profile !== 'auto') {
      used = this.pick(profile, text);
      const r = engineConvert(text, used, 'toUnicode');
      out = r.text;
      unmapped = r.unmapped.length;
    } else {
      const det = engineDetect(text, { profiles });
      if (det.kind !== 'legacy' && det.kind !== 'mixed') {
        this.d.toast('info', det.kind === 'unicode' ? 'The clipboard is already in Unicode.' : 'No legacy Sinhala text was found on the clipboard.');
        return done({ changed: false, profile: null, profileVersion: null, unmapped: 0 });
      }
      used = this.pick(undefined, text);
      // A word the detector could not tell from English between two legacy ones ("rcfha" in "Y%S ,xld rcfha
      // mqj;am;") is legacy too; English at either end of the text, or between English, stays English.
      const segs = det.segments;
      const legacyAt = (i: number): boolean => segs[i]?.kind === 'legacy' || (segs[i]?.kind === 'latin' && segs[i - 1]?.kind === 'legacy' && segs[i + 1]?.kind === 'legacy');
      let at = 0;
      for (let i = 0; i < segs.length; i++) {
        const s = segs[i]!;
        out += text.slice(at, s.start);
        const part = text.slice(s.start, s.end);
        if (legacyAt(i)) {
          const r = engineConvert(part, used, 'toUnicode');
          out += r.text;
          unmapped += r.unmapped.length;
        } else out += part;
        at = s.end;
      }
      out += text.slice(at);
    }
    await this.d.clipboard.writeText(out);
    this.d.toast('success', unmapped ? `Converted to Unicode with ${used.name} ${used.version}; ${unmapped} characters were left as they were.` : `Converted to Unicode with ${used.name} ${used.version}.`);
    return done({ changed: true, profile: used.id, profileVersion: used.version, unmapped });
  }

  // ── the clipboard key ────────────────────────────────────────────────────

  /** Holds the person's clipboard key while the tools are available, signed in and unlocked; lets it go otherwise. */
  syncKey(): string | null {
    const want = this.d.scope() && !this.d.locked() && this.available() ? this.user().shortcut : null;
    if (want === this.heldKey) return this.heldKey;
    this.releaseKey();
    if (!want) return null;
    try {
      // Another app holding it is not an error: the tray line still works, and Settings says the key is taken.
      if (this.d.shortcuts.register(want, () => this.pressed())) this.heldKey = want;
    } catch {
      this.heldKey = null;
    }
    return this.heldKey;
  }

  private releaseKey(): void {
    if (!this.heldKey) return;
    try {
      this.d.shortcuts.unregister(this.heldKey);
    } catch {
      /* already gone */
    }
    this.heldKey = null;
  }

  /** The key, or the tray's line. */
  pressed(): void {
    this.clipboard().catch((e: unknown) => this.d.toast('error', e instanceof Error ? e.message : String(e)));
  }

  // ── documents ──────────────────────────────────────────────────────────

  private pending(): PendingUpload[] {
    const key = this.key('uploads');
    const list = key ? this.d.config.getConfig<PendingUpload[]>(key) : undefined;
    return Array.isArray(list) ? list : [];
  }

  private setPending(list: PendingUpload[]): void {
    const key = this.key('uploads');
    if (key) this.d.config.setConfig(key, list);
  }

  private job(j: SinhalaJob & { outPath?: string }): SinhalaJob {
    this.jobs.set(j.id, j);
    this.d.changed();
    return j;
  }

  private update(id: string, patch: Partial<SinhalaJob>): void {
    const j = this.jobs.get(id);
    if (!j) return;
    Object.assign(j, patch);
    this.d.changed();
  }

  async convertFile(input: SinhalaConvertFileInput): Promise<{ jobId: string }> {
    this.require();
    const src = input.source;
    if (src.kind === 'drive' && this.d.online()) {
      try {
        // 202 with the job: the server converts a copy and shows its preview; nothing is saved before Accept.
        const raw = await this.d.http.post<unknown>(`/api/sinhala/files/${src.fileId}/convert`, { profile: input.profile && input.profile !== 'auto' ? input.profile : undefined });
        const j = this.fromServer(raw, src.name ?? `File ${src.fileId}`);
        return { jobId: this.job(j).id };
      } catch (e) {
        // An unreachable server, or its engine down (503 SINHALA_UNAVAILABLE), falls back to the copy on this
        // computer, if there is one; any other refusal is the server's answer.
        const fallBack = isDesktopError(e) && (e.code === 'NETWORK_UNREACHABLE' || (e.status === 503 && !!this.d.offlinePath(src.fileId)));
        if (!fallBack) throw e;
      }
    }
    let path: string;
    let name: string;
    let upload: { fileId: number } | null = null;
    if (src.kind === 'drive') {
      const at = this.d.offlinePath(src.fileId);
      if (!at) throw new DesktopError('NOT_FOUND', 'This file is not on this computer, so it can only be converted online.');
      path = at.path;
      name = src.name ?? basename(at.path);
      if (!at.synced) upload = { fileId: src.fileId };
    } else {
      const h = this.handles.get(src.handle);
      if (!h) throw new DesktopError('NOT_FOUND', 'That file is no longer available. Drop it again.');
      path = h.path;
      name = h.name;
    }
    if (extname(path).toLowerCase() !== '.docx') throw new DesktopError('UNSUPPORTED', 'Only Word documents (.docx) can be converted on this computer.');
    const outPath = join(dirname(path), unicodeCopyName(basename(path)));
    const id = `l-${randomUUID()}`;
    this.job({ id, where: 'local', state: 'running', name, profile: input.profile ?? 'auto', profileVersion: null, runsTotal: 0, runsConverted: 0, unmappedCount: 0, preview: [], paragraphsChanged: null, canAccept: false, unmapped: [], outputName: basename(outPath), resultVersionId: null, error: null, outPath });
    void this.runLocal(id, path, outPath, input.profile, upload, name);
    return { jobId: id };
  }

  private async runLocal(id: string, path: string, outPath: string, profile: string | undefined, upload: { fileId: number } | null, name: string): Promise<void> {
    try {
      const { stats } = await this.d.docx({ profiles: this.engineProfiles(), targetFont: this.org().targetFont, force: profile && profile !== 'auto' ? profile : null, path, outPath });
      this.update(id, { state: upload ? 'waiting_upload' : 'done', profile: stats.profile || (profile ?? ''), profileVersion: stats.profileVersion || null, runsTotal: stats.runsTotal, runsConverted: stats.runsConverted, unmappedCount: stats.unmappedCount, preview: stats.preview });
      if (upload) {
        this.setPending([...this.pending().filter((p) => p.fileId !== upload.fileId), { jobId: id, fileId: upload.fileId, path: outPath, name }]);
        if (this.d.online()) void this.flushUploads();
      }
    } catch (e) {
      this.update(id, { state: 'failed', error: e instanceof Error ? e.message : String(e) });
    }
  }

  /** Converted offline copies go up as their files' new versions, once WorkSuite is reachable (WF-SI-03 step 3). */
  async flushUploads(): Promise<void> {
    if (!this.available() || !this.d.online()) return;
    for (const p of this.pending()) {
      try {
        const r = await this.d.uploadVersion(p.fileId, p.path, p.name);
        if (r === 'conflict') {
          // Changed on the server meanwhile: keep both — the converted copy goes up as a file of its own.
          await this.d.uploadNew(p.path, unicodeCopyName(p.name));
          this.update(p.jobId, { state: 'conflict' });
        } else this.update(p.jobId, { state: 'uploaded', resultVersionId: r.version });
        this.setPending(this.pending().filter((x) => x.fileId !== p.fileId || x.path !== p.path));
      } catch (e) {
        log.warn('converted copy not uploaded yet', { fileId: p.fileId, error: e instanceof Error ? e.message : String(e) });
        if (isDesktopError(e) && e.code === 'NOT_FOUND') this.setPending(this.pending().filter((x) => x.path !== p.path));
        break;
      }
    }
    this.d.changed();
  }

  private fromServer(raw: unknown, name: string): SinhalaJob & { outPath?: string } {
    const s = serverJobSchema.parse(raw);
    const known: SinhalaJob['state'][] = ['queued', 'running', 'preview', 'done', 'rejected', 'no_change', 'failed', 'conflict'];
    const state = known.find((k) => k === s.status) ?? 'failed';
    return {
      id: `s-${s.id}`,
      where: 'server',
      state,
      name: s.file_name ?? name,
      profile: s.profile ?? 'auto',
      profileVersion: s.profile_version ?? null,
      runsTotal: s.runs_total ?? 0,
      runsConverted: s.runs_converted ?? 0,
      unmappedCount: s.unmapped_count ?? 0,
      preview: (s.preview?.samples ?? []).slice(0, 10).map((x) => ({ part: x.part, before: x.before, after: x.after })),
      paragraphsChanged: s.preview?.paragraphs_changed ?? null,
      canAccept: s.can_accept ?? state === 'preview',
      unmapped: (s.unmapped ?? []).slice(0, 50).map((u) => ({ sequence: u.sequence, codePoint: u.code_point, count: u.count, firstOffset: u.first_offset })),
      outputName: null,
      resultVersionId: s.result_version ?? null,
      error: state === 'failed' && !known.includes(s.status as SinhalaJob['state']) ? `The server reported "${s.status}".` : (s.error ?? null),
    };
  }

  private view(j: SinhalaJob & { outPath?: string }): SinhalaJob {
    const { outPath: _out, ...view } = j;
    return view;
  }

  async jobStatus(id: string): Promise<SinhalaJob> {
    const j = this.jobs.get(id);
    if (!j) throw new DesktopError('NOT_FOUND', 'That conversion is not known here.');
    if (j.where === 'server' && (j.state === 'queued' || j.state === 'running')) {
      Object.assign(j, this.fromServer(await this.d.http.get<unknown>(`/api/sinhala/jobs/${encodeURIComponent(id.slice(2))}`), j.name));
    }
    return this.view(j);
  }

  /**
   * The person's decision on a server job's preview (WF-SI-02 step 4): Accept saves it as the file's new version —
   * the server answers 409 when the file changed after it was converted, and nothing is saved — or Reject drops it.
   */
  async decide(id: string, accept: boolean): Promise<SinhalaJob> {
    this.require();
    const j = this.jobs.get(id);
    if (!j || j.where !== 'server') throw new DesktopError('NOT_FOUND', 'That conversion is not known here.');
    const path = `/api/sinhala/jobs/${encodeURIComponent(id.slice(2))}/${accept ? 'accept' : 'reject'}`;
    try {
      Object.assign(j, this.fromServer(await this.d.http.post<unknown>(path), j.name));
    } catch (e) {
      // The job as it is now (a conflict ends it `preview` or `conflict`), then the server's reason.
      const now = await this.d.http.get<unknown>(`/api/sinhala/jobs/${encodeURIComponent(id.slice(2))}`).catch(() => null);
      if (now) Object.assign(j, this.fromServer(now, j.name));
      this.d.changed();
      throw e;
    }
    this.d.changed();
    return this.view(j);
  }

  reveal(id: string): boolean {
    const j = this.jobs.get(id);
    if (!j?.outPath) return false;
    this.d.reveal(j.outPath);
    return true;
  }

  /** The built-in editor's document, converted and handed back (no Document Server, maybe no network). */
  async convertDocx(bytes: Uint8Array, profile?: string): Promise<SinhalaDocxResult> {
    this.require();
    const { stats, bytes: out } = await this.d.docx({ profiles: this.engineProfiles(), targetFont: this.org().targetFont, force: profile && profile !== 'auto' ? profile : null, bytes });
    if (!out) throw new DesktopError('INTERNAL', 'The converted document did not come back.');
    return { bytes: out, runsTotal: stats.runsTotal, runsConverted: stats.runsConverted, unmappedCount: stats.unmappedCount, profile: stats.profile, profileVersion: stats.profileVersion, preview: stats.preview };
  }

  /** Paths from a real drop or the main process's dialog, as handles: .docx files only, read where they are. */
  async registerPaths(paths: string[]): Promise<{ files: SinhalaLocalFile[]; rejected: Array<{ name: string; reason: string }> }> {
    const files: SinhalaLocalFile[] = [];
    const rejected: Array<{ name: string; reason: string }> = [];
    for (const raw of paths.slice(0, 20)) {
      const name = basename(raw);
      if (!isAbsolute(raw) || raw.includes('\0')) {
        rejected.push({ name, reason: `${name} is not a file on this computer.` });
        continue;
      }
      if (extname(raw).toLowerCase() !== '.docx') {
        rejected.push({ name, reason: `${name} is not a Word document (.docx).` });
        continue;
      }
      const st = await stat(raw).catch(() => null);
      if (!st?.isFile()) {
        rejected.push({ name, reason: `${name} could not be found.` });
        continue;
      }
      if (st.size > MAX_DOCX) {
        rejected.push({ name, reason: `${name} is too large to convert here.` });
        continue;
      }
      const head = Buffer.alloc(4);
      const fh = await openFile(raw, 'r').catch(() => null);
      if (!fh) {
        rejected.push({ name, reason: `${name} could not be read.` });
        continue;
      }
      await fh.read(head, 0, 4, 0).finally(() => fh.close());
      if (head.readUInt32LE(0) !== 0x04034b50) {
        rejected.push({ name, reason: `${name} is not a Word document.` });
        continue;
      }
      const handle = randomUUID();
      this.handles.set(handle, { path: raw, name, size: st.size });
      files.push({ handle, name, size: st.size });
    }
    return { files, rejected };
  }

  // ── fonts (blueprint §6.1 Fonts, §7; P4) ─────────────────────────────────

  private async loadManifest(): Promise<SinhalaFontManifest | null> {
    // Asked again while online (an admin may just have uploaded a font); the last list kept otherwise.
    this.manifest = this.manifest ?? this.state()?.fonts ?? null;
    if (this.d.online()) {
      try {
        this.manifest = fontManifestSchema.parse(await this.d.http.get<unknown>('/api/sinhala/fonts'));
      } catch (e) {
        log.info('font list not read', { error: e instanceof Error ? e.message : String(e) });
      }
    }
    return this.manifest;
  }

  async fontsStatus(): Promise<SinhalaFontsStatus> {
    this.require();
    const dir = fontsDirFor(this.d.fonts);
    const m = await this.loadManifest();
    const families = [];
    for (const f of [...(m?.unicode ?? []), ...(m?.legacy ?? [])]) {
      const files = fontFilesOf(f.files);
      let installed = files.length > 0 && dir !== null;
      for (const file of files) installed = installed && (await stat(join(dir!, file.name)).catch(() => null))?.isFile() === true;
      families.push({ family: f.family, kind: f.kind, installed, distributable: f.distributable && !!f.download_url && files.length > 0, licence: f.licence ?? null });
    }
    return { supported: dir !== null, dir, families, policy: this.org().installFonts };
  }

  /**
   * Installs the organisation's fonts for this person only (no administrator rights). A distributable font comes as
   * its release archive (`download_url`): the archive is checked against its sha256, then each font file in it against
   * its own (`files`), and only then put in place. Only distributable fonts — legacy fonts only when the organisation
   * uploaded them and marked them so (blueprint §7).
   */
  async installFonts(families?: string[], quiet = false): Promise<SinhalaFontsStatus> {
    this.require();
    const policy = this.org().installFonts;
    if (policy === 'never') throw new DesktopError('POLICY_DENIED', 'Your organization does not install fonts on devices.');
    const dir = fontsDirFor(this.d.fonts);
    if (!dir) throw new DesktopError('UNSUPPORTED', 'Fonts cannot be installed on this system.');
    const m = await this.loadManifest();
    if (!m) throw new DesktopError('NETWORK_UNREACHABLE', 'The font list could not be read. Check you are online, then try again.');
    await mkdir(dir, { recursive: true });
    const sha = (b: Buffer): string => createHash('sha256').update(b).digest('hex');
    let installed = 0;
    for (const f of [...m.unicode, ...m.legacy]) {
      const files = fontFilesOf(f.files);
      if (!f.distributable || !f.download_url || !files.length || (families && !families.includes(f.family))) continue;
      const missing = [];
      for (const file of files) {
        const have = await readFile(join(dir, file.name)).catch(() => null);
        if (!have || sha(have) !== file.sha256) missing.push(file);
      }
      if (!missing.length) continue;
      let archive: Buffer;
      if (f.download_url.startsWith('/')) archive = await this.d.http.download(f.download_url);
      else {
        if (!/^https:\/\//i.test(f.download_url)) throw new DesktopError('POLICY_DENIED', `${f.family}: fonts are downloaded over HTTPS only.`);
        const res = await this.d.fetch(f.download_url);
        if (!res.ok) throw new DesktopError('SERVER_ERROR', `${f.family} could not be downloaded (${res.status}).`);
        archive = Buffer.from(await res.arrayBuffer());
      }
      if (!f.sha256 || sha(archive) !== f.sha256) throw new DesktopError('INTERNAL', `${f.family}: the download does not match its checksum, so nothing was installed.`);
      const entries = /\.zip$/i.test(f.download_url.split('?')[0] ?? '') || archive.readUInt32LE(0) === 0x04034b50 ? readZip(archive) : null;
      for (const file of missing) {
        const bytes = entries ? entries.find((e) => e.name === file.path)?.data : files.length === 1 ? archive : undefined;
        if (!bytes || sha(bytes) !== file.sha256) throw new DesktopError('INTERNAL', `${f.family}: ${file.name} does not match its checksum, so it was not installed.`);
        const dest = join(dir, file.name);
        const tmp = `${dest}.part`;
        await writeFile(tmp, bytes);
        await rename(tmp, dest);
        if (this.d.fonts.platform === 'win32') {
          await this.d.run('reg', ['add', 'HKCU\\Software\\Microsoft\\Windows NT\\CurrentVersion\\Fonts', '/v', windowsFontValue(f.family, file.name), '/t', 'REG_SZ', '/d', dest, '/f']);
        }
        installed++;
      }
    }
    if (installed && this.d.fonts.platform === 'linux') await this.d.run('fc-cache', ['-f', dir]).catch(() => undefined);
    if (installed && !quiet) this.d.toast('success', installed === 1 ? 'A Sinhala font was installed.' : `${installed} Sinhala font files were installed.`);
    return this.fontsStatus();
  }

  // ── IPC ──────────────────────────────────────────────────────────────────

  register(router: IpcRouter): void {
    router.handle('sinhala:status', () => this.status());
    router.handle('sinhala:detect', (input) => this.detect(input.text, input.fontNames));
    router.handle('sinhala:convert', (input) => this.convert(input.text, input.profile, input.direction));
    router.handle('sinhala:convertFile', (input) => this.convertFile(input));
    router.handle('sinhala:job', (input) => this.jobStatus(input.jobId));
    router.handle('sinhala:jobAccept', (input) => this.decide(input.jobId, true));
    router.handle('sinhala:jobReject', (input) => this.decide(input.jobId, false));
    router.handle('sinhala:profiles', async (input) => {
      if (input?.refresh) await this.sync();
      return this.profilesView();
    });
    router.handle('sinhala:fontsStatus', () => this.fontsStatus());
    router.handle('sinhala:fontsInstall', (input) => this.installFonts(input?.families));
    router.handle('sinhala:clipboard', (input) => this.clipboard(input?.profile));
    router.handle('sinhala:settings', () => this.user());
    router.handle('sinhala:settingsSet', (input) => this.setUser(input));
    router.handle('sinhala:convertDocx', (input) => this.convertDocx(input.bytes, input.profile));
    router.handle('sinhala:registerDropped', (input) => {
      this.require();
      return this.registerPaths(input.paths);
    });
    router.handle('sinhala:pickFile', async (_input, c) => {
      this.require();
      const paths = await this.d.pickFiles(c.sender);
      if (!paths.length) return [];
      const { files, rejected } = await this.registerPaths(paths);
      if (!files.length && rejected.length) throw new DesktopError('IPC_VALIDATION_FAILED', rejected[0]!.reason);
      return files;
    });
    router.handle('sinhala:reveal', (input) => this.reveal(input.jobId));
  }
}
