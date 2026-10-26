import { APP_CATALOGUE } from '@shared/apps';
import {
  disabledModules,
  featureOn,
  isLockedKey,
  isSettingKey,
  localCatalogue,
  mergeCatalogue,
  migrationValues,
  moduleOn,
  prefOfKey,
  syncedPrefOf,
  resolveSettings,
  STARTUP_KEY,
  validValue,
  type CatalogueItem,
  type DesktopSettingsDoc,
  type DesktopSettingsView,
  type EffectiveSetting,
  type SettingValue,
} from '@shared/desktop-settings';
import type { Preferences } from '@shared/types';
import { DesktopError } from '../main/errors';
import { logger } from '../main/log';

const log = logger('desktop-settings');

/**
 * Desktop settings on this computer (shared/desktop-settings.ts): the server's document for the person signed in,
 * kept per account and person with when it was read, the choices made here that the server has not taken yet, and
 * what takes effect — which the main process enforces (apps turned off leave `SessionController.visibleApps`, features
 * hold their preferences off) and the renderer shows.
 *
 *   GET  /api/desktop/settings               the document (ETag on its version; If-None-Match → 304)
 *   PUT  /api/desktop/settings/preferences   {values, device_id} → the document; 409 {error:'policy_locked', keys}
 *   realtime `desktop.settings.changed` {version}                → read again
 *
 * A server without it (404) is an older one: personal mode, this computer's choices only. Offline, the last copy the
 * server gave stands, and changes wait here until it answers again. The first time a person syncs, the choices this
 * computer already had (its preferences, and anything chosen here before) go up — except where the organisation
 * manages the key or another device already chose.
 *
 * The server (worksuite `Modules\Desktop`, DesktopSettings.php): `?organization_id=` for the company open here;
 * ETag `"ds-<version>-<hash>"`, a 304 with no body; 409 `{status:'error', message, error:'policy_locked', keys}`;
 * 422 `{errors: {<key>: why}}` and nothing is taken (all or nothing); a `null` for a managed key removes the person's
 * stored value without a 409; a 503 on a write means its tables are not made yet — the change stays here and is
 * sent again later.
 */
export const DESKTOP_SETTINGS_PATH = '/api/desktop/settings';
export const DESKTOP_PREFERENCES_PATH = '/api/desktop/settings/preferences';
/** A few clicks make one request. */
export const SEND_DELAY_MS = 800;
/** A write the server could not take yet (a 503, offline): tried again after this long. */
export const RETRY_MS = 5 * 60_000;

/** What is kept per account and person (`desktop_settings:<scope>`). */
export interface StoredSettings {
  doc: DesktopSettingsDoc | null;
  etag: string | null;
  /** When the server's copy was last read or confirmed (ISO). */
  asOf: string | null;
  /** null: not asked yet; false: the server has no desktop settings (404). */
  supported: boolean | null;
  /** The last read failed (offline, a 5xx): the copy here is shown "as of". */
  failed: boolean;
  /** Choices for a server without desktop settings, or before anyone signed in. */
  local: Record<string, SettingValue>;
  /** Choices made here the server has not taken yet; null resets the key to its default. */
  pending: Record<string, SettingValue | null>;
  /** This computer's own choices have gone up once for this person. */
  migrated: boolean;
}

const EMPTY: StoredSettings = { doc: null, etag: null, asOf: null, supported: null, failed: false, local: {}, pending: {}, migrated: false };

export interface DesktopSettingsDeps {
  http: { url(path: string, query?: Record<string, string | number | boolean | null | undefined>): string; raw(method: string, url: string, init?: RequestInit & { timeoutMs?: number }): Promise<Response> };
  db: { getConfig<T>(key: string): T | undefined; setConfig(key: string, value: unknown): void };
  /** Signed in and ready: the server may be asked. */
  online: () => boolean;
  /** `<account or origin>:<user id>` while someone is signed in; null otherwise (this computer's own choices). */
  scope: () => string | null;
  /** The company open here (`?organization_id=`); null: the person's home company, as the server picks it. */
  organizationId?: () => string | null;
  deviceId: () => string | null;
  /** The person's preferences as saved here (no policy applied), and their defaults: what migration uploads. */
  prefs: () => Partial<Preferences>;
  defaults: () => Partial<Preferences>;
  /** A synced preference reset to its default here, so this computer's own copy follows. */
  resetPrefs?: (patch: Partial<Preferences>) => void;
  now?: () => number;
}

export class DesktopSettingsService {
  private scopeKey: string | null = null;
  private loaded = false;
  private stored: StoredSettings = { ...EMPTY };
  private effectiveCache: Record<string, EffectiveSetting> | null = null;
  private catalogueCache: CatalogueItem[] | null = null;
  private listeners = new Set<(v: DesktopSettingsView) => void>();
  private refreshing: Promise<void> | null = null;
  private flushing: Promise<Refused> | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private retry: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly deps: DesktopSettingsDeps) {
    this.load();
  }

  private now(): number {
    return this.deps.now?.() ?? Date.now();
  }

  private configKey(scope: string | null): string {
    return `desktop_settings:${scope ?? 'device'}`;
  }

  /** Whose copy: the person, and the company open (each company has its own policy). */
  private currentScope(): string | null {
    const scope = this.deps.scope();
    if (!scope) return null;
    const org = this.deps.organizationId?.() ?? null;
    return org ? `${scope}:org-${org}` : scope;
  }

  private url(path: string): string {
    const org = this.deps.organizationId?.() ?? null;
    return this.deps.http.url(path, org ? { organization_id: org } : undefined);
  }

  /** Reads what is kept for whoever is signed in now; call when the session's person or account changes. */
  load(): void {
    const scope = this.currentScope();
    if (this.loaded && scope === this.scopeKey) return;
    const switched = this.loaded;
    this.loaded = true;
    this.scopeKey = scope;
    const saved = this.deps.db.getConfig<Partial<StoredSettings>>(this.configKey(scope));
    this.stored = { ...EMPTY, ...(saved && typeof saved === 'object' ? saved : {}), local: { ...(saved?.local ?? {}) }, pending: { ...(saved?.pending ?? {}) } };
    if (switched) this.changed();
    else this.invalidate();
  }

  private persist(): void {
    this.deps.db.setConfig(this.configKey(this.scopeKey), this.stored);
  }

  private invalidate(): void {
    this.effectiveCache = null;
    this.catalogueCache = null;
  }

  private changed(): void {
    this.invalidate();
    const v = this.view();
    for (const fn of this.listeners) fn(v);
  }

  onChange(fn: (v: DesktopSettingsView) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  // ── what takes effect ──────────────────────────────────────────────────

  catalogue(): CatalogueItem[] {
    if (!this.catalogueCache) this.catalogueCache = mergeCatalogue(localCatalogue(APP_CATALOGUE, this.deps.defaults()), this.stored.doc?.catalogue);
    return this.catalogueCache;
  }

  /** The person's preferences as this computer knows them: the server's, then this computer's, then what waits. */
  private preferences(): Record<string, SettingValue | undefined> {
    const s = this.stored;
    const out: Record<string, SettingValue | undefined> = { ...(s.doc?.preferences ?? {}), ...(s.supported === false || !s.doc ? s.local : {}) };
    for (const [k, v] of Object.entries(s.pending)) {
      if (v === null) delete out[k];
      else out[k] = v;
    }
    return out;
  }

  private mode(): 'enterprise' | 'personal' {
    return this.stored.supported !== false && this.stored.doc?.mode === 'enterprise' ? 'enterprise' : 'personal';
  }

  effective(): Record<string, EffectiveSetting> {
    this.load();
    if (!this.effectiveCache) {
      const doc = this.stored.supported === false ? null : this.stored.doc;
      this.effectiveCache = resolveSettings({ mode: this.mode(), catalogue: this.catalogue(), policy: doc?.policy, preferences: this.preferences() });
    }
    return this.effectiveCache;
  }

  value(key: string): SettingValue {
    return this.effective()[key]?.value ?? null;
  }

  feature(id: string): boolean {
    return featureOn(this.effective(), id);
  }

  moduleEnabled(appId: string): boolean {
    return moduleOn(this.effective(), appId);
  }

  disabledModules(): Set<string> {
    return disabledModules(this.effective());
  }

  startupScreen(): string {
    const v = this.value(STARTUP_KEY);
    return typeof v === 'string' ? v : 'home';
  }

  view(): DesktopSettingsView {
    this.load();
    const s = this.stored;
    const signedIn = !!this.scopeKey;
    const status: DesktopSettingsView['status'] = !signedIn || s.supported === false || !s.doc ? 'local' : s.failed ? 'cached' : 'synced';
    return {
      mode: this.mode(),
      status,
      asOf: s.doc ? s.asOf : null,
      version: s.doc?.version ?? null,
      orgId: s.doc?.org_id === null || s.doc?.org_id === undefined ? null : String(s.doc.org_id),
      catalogue: this.catalogue(),
      effective: this.effective(),
      pending: Object.keys(s.pending),
    };
  }

  // ── the server ─────────────────────────────────────────────────────────

  /** Reads the server's copy (at sign-in, with each bootstrap, on `desktop.settings.changed`), then sends what waits. */
  refresh(): Promise<void> {
    this.load();
    if (!this.deps.online() || !this.scopeKey) return Promise.resolve();
    if (this.refreshing) return this.refreshing;
    const scope = this.scopeKey;
    this.refreshing = (async () => {
      try {
        const headers: Record<string, string> = {};
        if (this.stored.etag && this.stored.doc && this.stored.supported) headers['If-None-Match'] = this.stored.etag;
        const res = await this.deps.http.raw('GET', this.url(DESKTOP_SETTINGS_PATH), { headers });
        if (scope !== this.scopeKey) return;
        if (res.status === 404 || res.status === 405 || res.status === 501) {
          // An older server: personal mode on this computer's choices, which keep what was waiting.
          this.stored = { ...this.stored, supported: false, failed: false, local: { ...this.stored.local, ...nonNull(this.stored.pending) }, pending: {} };
          this.persist();
          this.changed();
          return;
        }
        if (res.status === 304) {
          this.stored = { ...this.stored, failed: false, asOf: new Date(this.now()).toISOString() };
          this.persist();
          this.changed();
        } else if (res.ok) {
          const doc = docOf(await readJson(res));
          if (!doc) throw new Error('unreadable desktop settings');
          this.take(doc, res.headers.get('etag'));
        } else {
          throw new Error(`desktop settings answered ${res.status}`);
        }
        this.migrate();
        if (Object.keys(this.stored.pending).length) await this.flush();
      } catch (e) {
        if (scope !== this.scopeKey) return;
        log.debug('desktop settings not read', { error: String((e as Error)?.message ?? e) });
        if (!this.stored.failed) {
          this.stored = { ...this.stored, failed: true };
          this.persist();
          this.changed();
        }
      } finally {
        this.refreshing = null;
      }
    })();
    return this.refreshing;
  }

  private take(doc: DesktopSettingsDoc, etag: string | null): void {
    this.stored = { ...this.stored, doc, etag: etag ?? `"${doc.version}"`, asOf: new Date(this.now()).toISOString(), supported: true, failed: false };
    // A wait for a key the organisation now manages is over: the policy decides it. (A reset — null — still goes up:
    // it removes the person's stored value, which the server allows.)
    for (const [k, v] of Object.entries(this.stored.pending)) if (v !== null && doc.mode === 'enterprise' && doc.policy?.[k]?.enforcement === 'managed') delete this.stored.pending[k];
    this.persist();
    this.changed();
  }

  /** The first sync for this person: this computer's choices go up where nobody manages or chose them yet. */
  private migrate(): void {
    const s = this.stored;
    if (s.migrated || !s.supported || !s.doc) return;
    const values = migrationValues(this.deps.prefs(), this.deps.defaults(), s.doc, s.local);
    this.stored = { ...s, migrated: true, local: {}, pending: { ...values, ...s.pending } };
    this.persist();
    if (Object.keys(values).length) {
      log.info('desktop settings migrated', { keys: Object.keys(values).length });
      this.changed();
    }
  }

  /** Sends what waits. Returns what the server refused: keys it manages (409), values it does not take (422). */
  flush(): Promise<Refused> {
    if (this.flushing) return this.flushing.then(() => this.flush());
    const s = this.stored;
    const values = { ...s.pending };
    if (!Object.keys(values).length || !s.supported || !this.deps.online() || !this.scopeKey) return Promise.resolve(NONE);
    const scope = this.scopeKey;
    this.flushing = (async (): Promise<Refused> => {
      try {
        const device = this.deps.deviceId();
        const res = await this.deps.http.raw('PUT', this.url(DESKTOP_PREFERENCES_PATH), {
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ values, ...(device ? { device_id: device } : {}) }),
        });
        if (scope !== this.scopeKey) return NONE;
        const body = await readJson(res);
        if (res.status === 409) {
          const keys = lockedKeys(body);
          // Managed after all: those choices are dropped, the rest is sent again with the policy read afresh.
          for (const k of keys.length ? keys : Object.keys(values)) delete this.stored.pending[k];
          this.persist();
          this.changed();
          void this.refresh();
          return { locked: keys, invalid: {} };
        }
        if (res.status === 422) {
          // All or nothing: the values it names are dropped; the rest goes again.
          const invalid = invalidKeys(body);
          const named = Object.keys(invalid);
          for (const k of named.length ? named : Object.keys(values)) if (this.stored.pending[k] === values[k]) delete this.stored.pending[k];
          this.persist();
          this.changed();
          if (named.length && Object.keys(this.stored.pending).length) this.schedule();
          return { locked: [], invalid: named.length ? invalid : Object.fromEntries(Object.keys(values).map((k) => [k, 'Not an allowed value.'])) };
        }
        if (res.status === 404) {
          this.stored = { ...this.stored, supported: false, local: { ...this.stored.local, ...nonNull(this.stored.pending) }, pending: {} };
          this.persist();
          this.changed();
          return NONE;
        }
        if (!res.ok) throw new Error(`desktop preferences answered ${res.status}`);
        // What was sent is taken; anything changed meanwhile still waits.
        for (const [k, v] of Object.entries(values)) if (this.stored.pending[k] === v) delete this.stored.pending[k];
        const doc = docOf(body);
        if (doc) this.take(doc, res.headers.get('etag'));
        else {
          this.persist();
          this.changed();
        }
        return NONE;
      } catch (e) {
        // Offline, or a 503 (the server's tables are not made yet): the change stays here and goes later.
        log.debug('desktop preferences not sent', { error: String((e as Error)?.message ?? e) });
        this.retryLater();
        return NONE;
      } finally {
        this.flushing = null;
      }
    })();
    return this.flushing;
  }

  private retryLater(): void {
    if (this.retry) return;
    this.retry = setTimeout(() => {
      this.retry = null;
      void this.flush();
    }, RETRY_MS);
    (this.retry as { unref?: () => void }).unref?.();
  }

  private schedule(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.flush();
    }, SEND_DELAY_MS);
  }

  // ── changes ────────────────────────────────────────────────────────────

  /**
   * The person's choices from Settings (`desktopSettings:set`); null resets a key to its default. A managed key is
   * refused (POLICY_DENIED) and nothing is changed. Takes effect here at once; the server is told now, or when it is
   * back.
   */
  async set(values: Record<string, SettingValue | null>): Promise<DesktopSettingsView> {
    this.load();
    const eff = this.effective();
    const items = new Map(this.catalogue().map((c) => [c.key, c]));
    // A value for a managed key is refused; a reset (null) of one only removes the person's stored value.
    const locked = Object.keys(values).filter((k) => values[k] !== null && isLockedKey(eff, k));
    if (locked.length) throw new DesktopError('POLICY_DENIED', 'Your organization manages this setting.', 409, { keys: locked });
    for (const [k, v] of Object.entries(values)) {
      if (!isSettingKey(k)) throw new DesktopError('IPC_VALIDATION_FAILED', `Unknown setting ${k}.`);
      if (v !== null && !validValue(items.get(k), v)) throw new DesktopError('IPC_VALIDATION_FAILED', `That is not a value for ${k}.`);
    }
    const resets: Partial<Preferences> = {};
    for (const [k, v] of Object.entries(values)) {
      const p = prefOfKey(k);
      if (p && v === null && !isLockedKey(eff, k)) Object.assign(resets, { [p.pref]: this.deps.defaults()[p.pref] });
    }
    if (this.stored.supported === false || !this.scopeKey) {
      const local = { ...this.stored.local };
      for (const [k, v] of Object.entries(values)) {
        if (v === null) delete local[k];
        else local[k] = v;
      }
      this.stored = { ...this.stored, local };
    } else {
      this.stored = { ...this.stored, pending: { ...this.stored.pending, ...values } };
    }
    this.persist();
    if (Object.keys(resets).length) this.deps.resetPrefs?.(resets);
    this.changed();
    const refused = await this.flush();
    if (refused.locked.length) throw new DesktopError('POLICY_DENIED', 'Your organization manages this setting.', 409, { keys: refused.locked });
    const bad = Object.keys(refused.invalid);
    if (bad.length) throw new DesktopError('IPC_VALIDATION_FAILED', refused.invalid[bad[0]!] ?? 'That setting was not accepted.', 422, refused.invalid);
    return this.view();
  }

  /**
   * A preference changed through Settings (`settings:set`): the synced ones wait to go up, so the person's other
   * computers follow. Keys the policy manages are not taken (settings:set has already refused them).
   */
  notePreferences(patch: Partial<Preferences>): void {
    this.load();
    const eff = this.effective();
    const next: Record<string, SettingValue> = {};
    for (const [name, v] of Object.entries(patch)) {
      const p = syncedPrefOf(name);
      if (!p || isLockedKey(eff, p.key)) continue;
      const server = p.toServer(v);
      if (server !== undefined) next[p.key] = server;
    }
    if (!Object.keys(next).length) return;
    if (this.stored.supported === false || !this.scopeKey) {
      // Nothing to sync with: this computer's preferences are the person's already.
      return;
    }
    this.stored = { ...this.stored, pending: { ...this.stored.pending, ...next } };
    this.persist();
    this.changed();
    this.schedule();
  }

  /** `desktop.settings.changed` {version}: read again when it is newer than the copy here. */
  handleRealtime(e: { type?: string; version?: unknown } | null | undefined): void {
    if (e?.type !== 'desktop.settings.changed') return;
    const v = typeof e.version === 'number' ? e.version : Number(e.version);
    if (Number.isFinite(v) && this.stored.doc && v <= this.stored.doc.version) return;
    void this.refresh();
  }

  /** Signed out with its data removed: nothing of the person's stays. */
  forget(scope: string | null): void {
    this.deps.db.setConfig(this.configKey(scope), null);
    if (this.scopeKey && (scope === this.scopeKey || this.scopeKey.startsWith(`${scope}:org-`))) {
      this.deps.db.setConfig(this.configKey(this.scopeKey), null);
      this.stored = { ...EMPTY };
      this.changed();
    }
  }

  dispose(): void {
    if (this.timer) clearTimeout(this.timer);
    if (this.retry) clearTimeout(this.retry);
    this.timer = null;
    this.retry = null;
  }
}

export interface Refused {
  locked: string[];
  invalid: Record<string, string>;
}
const NONE: Refused = { locked: [], invalid: {} };

/** A 422's `errors: {<key>: why}`. */
export function invalidKeys(body: unknown): Record<string, string> {
  const e = (body as { errors?: unknown } | null)?.errors;
  if (!e || typeof e !== 'object' || Array.isArray(e)) return {};
  return Object.fromEntries(Object.entries(e as Record<string, unknown>).map(([k, v]) => [k, typeof v === 'string' ? v : 'Not an allowed value.']));
}

function nonNull(values: Record<string, SettingValue | null>): Record<string, SettingValue> {
  return Object.fromEntries(Object.entries(values).filter(([, v]) => v !== null)) as Record<string, SettingValue>;
}

async function readJson(res: Response): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

/** The document from an envelope (`{status, message, data}`) or the bare document; null when it is not one. */
export function docOf(body: unknown): DesktopSettingsDoc | null {
  const b = body as { data?: unknown } | null;
  const d = (b && typeof b === 'object' && 'data' in b ? b.data : b) as Partial<DesktopSettingsDoc> | null;
  if (!d || typeof d !== 'object') return null;
  if (d.mode !== 'enterprise' && d.mode !== 'personal') return null;
  const obj = (x: unknown) => (x && typeof x === 'object' && !Array.isArray(x) ? (x as Record<string, never>) : {});
  return {
    mode: d.mode,
    org_id: d.org_id ?? null,
    version: typeof d.version === 'number' ? d.version : Number(d.version) || 0,
    ...(typeof d.catalogue_version === 'number' ? { catalogue_version: d.catalogue_version } : {}),
    catalogue: Array.isArray(d.catalogue) ? d.catalogue.filter((c) => c && typeof c === 'object' && typeof c.key === 'string') : [],
    policy: obj(d.policy),
    preferences: obj(d.preferences),
    ...(d.effective ? { effective: obj(d.effective) } : {}),
    updated_at: typeof d.updated_at === 'string' ? d.updated_at : null,
  };
}

/** The keys of a `409 {error:'policy_locked', keys}` (at the top, or in the envelope's data or errors). */
export function lockedKeys(body: unknown): string[] {
  const b = (body ?? {}) as { error?: unknown; keys?: unknown; data?: { error?: unknown; keys?: unknown }; errors?: { keys?: unknown } };
  for (const src of [b, b.data, b.errors]) {
    if (src && Array.isArray(src.keys)) return src.keys.filter((k): k is string => typeof k === 'string');
  }
  return [];
}
