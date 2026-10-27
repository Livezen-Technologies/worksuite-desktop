import { APP_CATALOGUE, appRoute, type AppDefinition } from './apps';
import { SHELL_SCREENS } from './access';
import type { Preferences } from './types';

/**
 * Desktop settings: which features, apps and settings this person has on this computer, and which screen WorkSuite
 * opens on (WorkSuite Desktop – Feature Enable/Disable Settings).
 *
 * The server keeps one document per person (`GET api/desktop/settings`): a catalogue of the keys there are, the
 * organisation's policy, the person's own preferences and what takes effect. Keys:
 *
 *   features.<id>            a feature on or off: launcherSearch, globalShortcut, itemLinks, officeEditing, fileSync,
 *                            offlineFiles (DESKTOP_FEATURES says where each is enforced)
 *   modules.<slug>.enabled   an app on or off, by its server `applications` slug (`AppDefinition.app`) — off, it is
 *                            gone from the launcher, the rail, links, shortcuts, the command palette and the tray,
 *                            exactly as an app the server does not give
 *   startup.screen           'home' | 'last' | 'app:<slug>' | 'route:/<path>'
 *   prefs.<name>             one of the person's preferences, synced across their devices (SYNCED_PREFS maps the
 *                            server's names — `prefs.launchAtLogin`, `prefs.notifications.preview` … — to `Preferences`)
 *
 * Who decides (resolveSettings):
 *   - Enterprise: a `managed` policy entry decides and is locked; otherwise the person's preference; otherwise a
 *     `default` policy entry (only a default — the person may change it); otherwise the catalogue's default.
 *   - Personal: the policy is not applied at all; everything is on by default and the person's to change.
 *
 * Everything here is pure: the main process (electron/services/desktop-settings.ts) and the renderer
 * (src/core/desktop-settings.ts) both resolve with it, so a choice made offline takes effect at once and the screen
 * shows the same as the main process enforces.
 */

export type SettingValue = boolean | string | number | null;
export type SettingType = 'boolean' | 'string' | 'number' | 'enum';
export type SettingsMode = 'enterprise' | 'personal';
export type SettingSource = 'policy' | 'user' | 'default';
export type Enforcement = 'managed' | 'default';

export interface SettingOption {
  value: string;
  label: string;
}

export interface CatalogueItem {
  key: string;
  type: SettingType;
  default: SettingValue;
  label: string;
  /** `features`, `modules`, `startup`, `prefs` or the server's own group name. */
  group: string;
  description?: string;
  options?: SettingOption[];
}

export interface PolicyEntry {
  value: SettingValue;
  enforcement: Enforcement;
}

export interface EffectiveSetting {
  value: SettingValue;
  source: SettingSource;
  locked: boolean;
}

/** The server's `data` (GET and PUT `api/desktop/settings[/preferences]`). */
export interface DesktopSettingsDoc {
  mode: SettingsMode;
  org_id: string | number | null;
  version: number;
  /** Raised by the server when a key is added, removed or changes type. */
  catalogue_version?: number;
  catalogue: CatalogueItem[];
  policy: Record<string, PolicyEntry>;
  preferences: Record<string, SettingValue>;
  effective?: Record<string, EffectiveSetting>;
  updated_at: string | null;
}

/** What the renderer is given (`desktopSettings:get`, `desktopSettings:changed`). */
export interface DesktopSettingsView {
  mode: SettingsMode;
  /**
   * `synced`: the server's copy, fresh. `cached`: the last copy the server gave (offline, or it failed); `asOf` says
   * when. `local`: this server has no desktop settings (404, an older server) or nobody is signed in — this
   * computer's choices alone, personal mode.
   */
  status: 'synced' | 'cached' | 'local';
  /** When the server's copy was read (ISO), or null when there is none. */
  asOf: string | null;
  version: number | null;
  orgId: string | null;
  catalogue: CatalogueItem[];
  effective: Record<string, EffectiveSetting>;
  /** Keys changed here and not yet accepted by the server. */
  pending: string[];
}

/** The answer when a write touches a managed key (`409 {error:'policy_locked', keys}`). */
export const POLICY_LOCKED = 'policy_locked';
/** What every lock says, wherever it is shown. */
export const MANAGED_LABEL = 'Managed by your organization';
export const MANAGED_REASON = 'Your organization manages this setting.';

// ── keys ─────────────────────────────────────────────────────────────────

export const STARTUP_KEY = 'startup.screen';
export const featureKey = (id: string): string => `features.${id}`;
/** `modules.<slug>.enabled`: the server's application slug (`AppDefinition.app`), not the desktop's app id. */
export const moduleKey = (slug: string): string => `modules.${slug}.enabled`;
export const prefKey = (name: string): string => `prefs.${name}`;

/** The key shapes; the same pattern guards `desktopSettings:set` (shared/ipc/contract.ts). */
export const SETTING_KEY_PATTERN = /^(features\.[A-Za-z][A-Za-z0-9_]{0,47}|modules\.[a-z][a-z0-9_-]{0,39}\.enabled|startup\.screen|prefs\.[A-Za-z][A-Za-z0-9_.]{0,63})$/;
const KEY_RE = SETTING_KEY_PATTERN;

/** Whether a key is one of the four shapes the contract allows. */
export function isSettingKey(key: string): boolean {
  return KEY_RE.test(key);
}

/** The app id in `modules.<appId>.enabled`, or null. */
export function moduleOfKey(key: string): string | null {
  const m = /^modules\.([a-z][a-z0-9_-]{0,39})\.enabled$/.exec(key);
  return m ? m[1]! : null;
}

// ── what this desktop knows ──────────────────────────────────────────────

/**
 * The features (the server's catalogue: `features.<id>`) and where the desktop enforces each. `overlay`: preferences a
 * feature that is off holds as given, so the services that read them follow by themselves.
 */
export interface DesktopFeature {
  id: string;
  label: string;
  description: string;
  overlay?: Partial<Preferences>;
}

export const DESKTOP_FEATURES: readonly DesktopFeature[] = [
  // The launcher's "Find an app" box (src/app/overlays/Launcher.tsx).
  { id: 'launcherSearch', label: 'Launcher search', description: 'Find an app by typing in the app launcher.' },
  // Every key held for the whole computer that brings WorkSuite up: Quick Ask, Next contact, Support's quick reply,
  // the Live keys (electron/main/index.ts `globalKeysOn`).
  { id: 'globalShortcut', label: 'Global shortcut to open WorkSuite', description: 'Keys that open WorkSuite from any app.' },
  // WorkSuite links open in the app (deep-link handling and Settings › Links).
  { id: 'itemLinks', label: 'Open WorkSuite links in the app', description: 'Links to files, meetings, tasks and other items open here instead of the browser.', overlay: { links: { openInApp: false } } },
  // Documents in WorkSuite Office: the DOC / Sheet / Slides tabs and the WorkSuite Office app.
  { id: 'officeEditing', label: 'Edit documents in WorkSuite Office', description: 'Open and edit documents in WorkSuite DOC, Sheet and Slides.' },
  // Drive sync (with the security policy's file_sync; the stricter wins).
  { id: 'fileSync', label: 'Drive sync', description: 'Keep Drive folders in step with folders on this computer.' },
  // Files kept on this computer to work on offline (`desktop.files.offline`, office:readOffline/writeOffline).
  { id: 'offlineFiles', label: 'Offline files', description: 'Keep files on this computer to open without a connection.' },
];

/** One synced preference: the server's key and the local `Preferences` field it is, both ways. */
export interface SyncedPref {
  key: string;
  pref: keyof Preferences;
  label: string;
  type: SettingType;
  options?: SettingOption[];
  /** The server's value as the local one; undefined: nothing to apply (e.g. language `system`). */
  toLocal: (v: SettingValue) => unknown;
  /** The local value as the server's; undefined: not one the server takes. */
  toServer: (v: unknown) => SettingValue | undefined;
}

const same = (v: unknown): SettingValue | undefined => (typeof v === 'boolean' || typeof v === 'string' || typeof v === 'number' ? v : undefined);
const bool = (key: string, pref: keyof Preferences, label: string): SyncedPref => ({ key, pref, label, type: 'boolean', toLocal: (v) => (typeof v === 'boolean' ? v : undefined), toServer: (v) => (typeof v === 'boolean' ? v : undefined) });
const PRIVACY: Record<string, string> = { full: 'FULL', sender_only: 'SENDER_ONLY', generic: 'GENERIC' };
const LANGS = ['en', 'si', 'ta'];

/**
 * The server's `prefs.*` and the preferences they are here. Paths, folders, per-computer caches and the security
 * settings (which have their own policy) stay on the computer.
 */
export const SYNCED_PREFS: readonly SyncedPref[] = [
  { key: 'prefs.theme', pref: 'theme', label: 'Theme', type: 'enum', options: [{ value: 'system', label: 'Match the system' }, { value: 'light', label: 'Light' }, { value: 'dark', label: 'Dark' }], toLocal: (v) => (v === 'system' || v === 'light' || v === 'dark' ? v : undefined), toServer: (v) => (v === 'system' || v === 'light' || v === 'dark' ? v : undefined) },
  {
    key: 'prefs.language',
    pref: 'language',
    label: 'Language',
    type: 'enum',
    options: [{ value: 'system', label: 'Match the system' }, { value: 'en', label: 'English' }, { value: 'si', label: 'Sinhala' }, { value: 'ta', label: 'Tamil' }],
    toLocal: (v) => (typeof v === 'string' && LANGS.includes(v) ? v : undefined),
    toServer: (v) => (typeof v === 'string' && LANGS.includes(v) ? v : undefined),
  },
  bool('prefs.launchAtLogin', 'startWithOs', 'Open WorkSuite when you sign in to the computer'),
  bool('prefs.startMinimized', 'startMinimized', 'Start minimised'),
  bool('prefs.minimizeToTray', 'minimizeToTray', 'Keep running in the tray when the window is closed'),
  bool('prefs.notifications.enabled', 'notificationsEnabled', 'Desktop notifications'),
  bool('prefs.notifications.sound', 'notificationSounds', 'Notification sounds'),
  bool('prefs.notifications.badge', 'badgeCount', 'Unread count on the app icon'),
  {
    key: 'prefs.notifications.preview',
    pref: 'notificationPrivacy',
    label: 'What a notification shows',
    type: 'enum',
    options: [{ value: 'full', label: 'Sender and message' }, { value: 'sender_only', label: 'Sender only' }, { value: 'generic', label: 'Nothing but “New activity”' }],
    toLocal: (v) => (typeof v === 'string' ? PRIVACY[v] : undefined),
    toServer: (v) => same(Object.keys(PRIVACY).find((k) => PRIVACY[k] === v)),
  },
  bool('prefs.spellcheck', 'spellcheck', 'Check spelling as you type'),
  bool('prefs.hardwareAcceleration', 'hardwareAcceleration', 'Use hardware acceleration'),
];
const SYNCED_BY_KEY = new Map(SYNCED_PREFS.map((p) => [p.key, p]));
const SYNCED_BY_PREF = new Map(SYNCED_PREFS.map((p) => [p.pref as string, p]));

/** The synced preference a `prefs.*` key is, when it is one this desktop applies. */
export function prefOfKey(key: string): SyncedPref | null {
  return SYNCED_BY_KEY.get(key) ?? null;
}

/** The synced preference a local `Preferences` field is, or null. */
export function syncedPrefOf(pref: string): SyncedPref | null {
  return SYNCED_BY_PREF.get(pref) ?? null;
}

/** Apps that can never be turned off: the shell's own screens (Home, Settings …) — they have no slug anyway. */
export function canDisableModule(slug: string): boolean {
  return !SHELL_SCREENS.has(slug);
}

/** The server slugs of the apps in a list, once each, with the first app's label. */
export function moduleSlugs(apps: ReadonlyArray<Pick<AppDefinition, 'app' | 'label'>>): Array<{ slug: string; label: string }> {
  const seen = new Map<string, string>();
  for (const a of apps) if (a.app && canDisableModule(a.app) && !seen.has(a.app)) seen.set(a.app, a.label);
  return [...seen].map(([slug, label]) => ({ slug, label }));
}

export const STARTUP_OPTIONS: SettingOption[] = [
  { value: 'home', label: 'Home' },
  { value: 'last', label: 'Where you left off' },
];

/**
 * The catalogue this desktop knows without a server — the same keys and defaults as the server's (DesktopSettings.php),
 * every app with a server slug as a module. `defaults`: unused, kept for callers; a synced preference's default is the
 * server's, and the local preference stands while nobody has chosen (preferenceOverlay ignores defaults).
 */
export function localCatalogue(apps: readonly AppDefinition[] = APP_CATALOGUE, _defaults?: Partial<Preferences>): CatalogueItem[] {
  const out: CatalogueItem[] = [];
  for (const f of DESKTOP_FEATURES) out.push({ key: featureKey(f.id), type: 'boolean', default: true, label: f.label, description: f.description, group: 'features' });
  for (const m of moduleSlugs(apps)) out.push({ key: moduleKey(m.slug), type: 'boolean', default: true, label: m.label, group: 'modules' });
  out.push({ key: STARTUP_KEY, type: 'string', default: 'home', label: 'Opens on launch', group: 'startup', options: STARTUP_OPTIONS });
  for (const p of SYNCED_PREFS) out.push({ key: p.key, type: p.type, default: null, label: p.label, group: 'preferences', ...(p.options ? { options: p.options } : {}) });
  return out;
}

/** The server's catalogue over this desktop's: the server's label, default and options win for the keys it has. */
export function mergeCatalogue(local: readonly CatalogueItem[], server: readonly CatalogueItem[] | null | undefined): CatalogueItem[] {
  const byKey = new Map(local.map((c) => [c.key, c]));
  for (const s of server ?? []) {
    if (!s || typeof s.key !== 'string' || !isSettingKey(s.key)) continue;
    const mine = byKey.get(s.key);
    byKey.set(s.key, { ...mine, ...s, type: normalizeType(s.type ?? mine?.type), ...(s.options ?? mine?.options ? { options: s.options ?? mine?.options } : {}) } as CatalogueItem);
  }
  return [...byKey.values()];
}

function normalizeType(t: unknown): SettingType {
  if (t === 'boolean' || t === 'number' || t === 'string' || t === 'enum') return t;
  if (t === 'bool') return 'boolean';
  if (t === 'select' || t === 'radio') return 'enum';
  if (t === 'integer' || t === 'int') return 'number';
  return 'string';
}

// ── resolution ───────────────────────────────────────────────────────────

/** Whether a value fits a catalogue item (unknown keys take any scalar). `null` never fits: it means "no choice". */
export function validValue(item: CatalogueItem | undefined, v: unknown): v is SettingValue {
  if (v === null || v === undefined) return false;
  if (!item) return typeof v === 'boolean' || typeof v === 'string' || typeof v === 'number';
  if (item.key === STARTUP_KEY) return typeof v === 'string' && parseStartup(v) !== null;
  switch (item.type) {
    case 'boolean':
      return typeof v === 'boolean';
    case 'number':
      return typeof v === 'number' && Number.isFinite(v);
    case 'enum':
      return typeof v === 'string' && (!item.options?.length || item.options.some((o) => o.value === v));
    default:
      // A string with options takes one of them (as the server checks: DesktopSettings::valid).
      return typeof v === 'string' && v.length <= 300 && (!item.options?.length || item.options.some((o) => o.value === v));
  }
}

export interface ResolveInput {
  mode: SettingsMode;
  catalogue: readonly CatalogueItem[];
  policy?: Record<string, PolicyEntry> | null;
  preferences?: Record<string, SettingValue | undefined> | null;
}

/**
 * What takes effect for every key: managed policy (locked) › the person's preference › a default policy entry › the
 * catalogue's default. A personal account has no policy. A value that does not fit its key is passed over, never
 * applied — a typo in a policy cannot turn something into nonsense.
 */
export function resolveSettings({ mode, catalogue, policy, preferences }: ResolveInput): Record<string, EffectiveSetting> {
  const items = new Map(catalogue.map((c) => [c.key, c]));
  const keys = new Set<string>([...items.keys()]);
  const pol = mode === 'enterprise' ? (policy ?? {}) : {};
  for (const k of Object.keys(pol)) if (isSettingKey(k)) keys.add(k);
  for (const k of Object.keys(preferences ?? {})) if (isSettingKey(k)) keys.add(k);
  const out: Record<string, EffectiveSetting> = {};
  for (const key of keys) {
    const item = items.get(key);
    const p = pol[key];
    const mine = preferences?.[key];
    if (p && p.enforcement === 'managed' && validValue(item, p.value)) out[key] = { value: p.value, source: 'policy', locked: true };
    else if (validValue(item, mine)) out[key] = { value: mine, source: 'user', locked: false };
    else if (p && p.enforcement === 'default' && validValue(item, p.value)) out[key] = { value: p.value, source: 'policy', locked: false };
    else out[key] = { value: item?.default ?? null, source: 'default', locked: false };
  }
  return out;
}

/** Whether a key is locked by policy. */
export function isLockedKey(effective: Record<string, EffectiveSetting> | null | undefined, key: string): boolean {
  return !!effective?.[key]?.locked;
}

/** Whether a feature is on: anything but an explicit `false`. */
export function featureOn(effective: Record<string, EffectiveSetting> | null | undefined, id: string): boolean {
  return effective?.[featureKey(id)]?.value !== false;
}

/** Whether an app is on (`modules.<id>.enabled` is not false). The shell's screens always are. */
export function moduleOn(effective: Record<string, EffectiveSetting> | null | undefined, slug: string): boolean {
  if (!canDisableModule(slug)) return true;
  return effective?.[moduleKey(slug)]?.value !== false;
}

/** The server slugs of the apps turned off. */
export function disabledModules(effective: Record<string, EffectiveSetting> | null | undefined): Set<string> {
  const out = new Set<string>();
  for (const [k, e] of Object.entries(effective ?? {})) {
    const slug = moduleOfKey(k);
    if (slug && e.value === false && canDisableModule(slug)) out.add(slug);
  }
  return out;
}

/** Drops the apps whose server slug is turned off from a visible-apps list. An app without a slug is never off. */
export function withoutDisabled<T extends Pick<AppDefinition, 'app'>>(apps: readonly T[], off: ReadonlySet<string>): T[] {
  if (off.size === 0) return apps as T[];
  return apps.filter((a) => !(a.app && off.has(a.app)));
}

/** The same for a set of visible app ids (the main process's `visibleApps`). */
export function withoutDisabledIds(ids: ReadonlySet<string>, off: ReadonlySet<string>): Set<string> {
  if (off.size === 0) return new Set(ids);
  const slugOf = new Map(APP_CATALOGUE.map((a) => [a.id, a.app]));
  return new Set([...ids].filter((id) => !off.has(slugOf.get(id) ?? '')));
}

/**
 * What the policy, a feature that is off, and the person's synced choices make of their preferences: values to put
 * over `Preferences` (in its own shapes: `prefs.notifications.preview` `sender_only` is `SENDER_ONLY`), and the keys
 * to show locked with why. A managed `prefs.*` is locked. A feature that is off puts its overlay (itemLinks: links
 * open in the browser). Nobody's choice (`default`) puts nothing: the local preference stands.
 */
export function preferenceOverlay(effective: Record<string, EffectiveSetting> | null | undefined): { values: Partial<Preferences>; locks: Array<{ key: keyof Preferences; reason: string }> } {
  const values: Record<string, unknown> = {};
  const locks: Array<{ key: keyof Preferences; reason: string }> = [];
  if (!effective) return { values: values as Partial<Preferences>, locks };
  for (const [key, e] of Object.entries(effective)) {
    const p = prefOfKey(key);
    if (!p || e.source === 'default' || e.value === null) continue;
    const local = p.toLocal(e.value);
    if (local === undefined) continue;
    values[p.pref] = local;
    if (e.locked) locks.push({ key: p.pref, reason: MANAGED_REASON });
  }
  for (const f of DESKTOP_FEATURES) {
    if (!f.overlay || effective[featureKey(f.id)]?.value !== false) continue;
    for (const [k, v] of Object.entries(f.overlay)) values[k] = v && typeof v === 'object' ? { ...(values[k] as object), ...v } : v;
  }
  return { values: values as Partial<Preferences>, locks };
}

// ── migration ────────────────────────────────────────────────────────────

/**
 * This computer's own choices, as preferences to upload the first time it syncs: every synced preference that differs
 * from its default, and the startup screen the tab restore implied. Keys the policy manages, and keys the server
 * already has a preference for (another device got there first), are left out — never overwritten.
 */
export function migrationValues(
  prefs: Partial<Preferences>,
  defaults: Partial<Preferences>,
  doc: Pick<DesktopSettingsDoc, 'mode' | 'policy' | 'preferences'> | null,
  local: Record<string, SettingValue> = {},
): Record<string, SettingValue> {
  const out: Record<string, SettingValue> = {};
  for (const p of SYNCED_PREFS) {
    const v = prefs[p.pref];
    if (v === undefined || v === null || typeof v === 'object') continue;
    if (JSON.stringify(v) === JSON.stringify(defaults[p.pref])) continue;
    const server = p.toServer(v);
    if (server !== undefined) out[p.key] = server;
  }
  // Choices made here before the server had desktop settings (features, apps, startup) go up too.
  for (const [k, v] of Object.entries(local)) if (isSettingKey(k) && v !== null) out[k] = v;
  for (const k of Object.keys(out)) {
    const managed = doc?.mode === 'enterprise' && doc.policy?.[k]?.enforcement === 'managed';
    const taken = doc?.preferences && Object.prototype.hasOwnProperty.call(doc.preferences, k) && doc.preferences[k] !== null;
    if (managed || taken) delete out[k];
  }
  return out;
}

// ── the startup screen ───────────────────────────────────────────────────

export type StartupChoice = { kind: 'home' } | { kind: 'last' } | { kind: 'app'; appId: string } | { kind: 'route'; path: string };

/** An in-app path, as the server allows it: one leading slash, never `//host`, no scheme, spaces or quotes. */
const ROUTE_RE = /^\/(?!\/)[A-Za-z0-9\-._~/?=&%#+:@!$,;]{0,255}$/;

/** Reads `startup.screen`; null for anything that is not one of the four shapes (or a path that is not in-app). */
export function parseStartup(v: unknown): StartupChoice | null {
  if (v === 'home') return { kind: 'home' };
  if (v === 'last') return { kind: 'last' };
  if (typeof v !== 'string') return null;
  if (v.startsWith('app:')) {
    const id = v.slice(4);
    return /^[a-z][a-z0-9_-]{0,39}$/.test(id) ? { kind: 'app', appId: id } : null;
  }
  if (v.startsWith('route:')) {
    const path = v.slice(6);
    return ROUTE_RE.test(path) && !path.includes('..') ? { kind: 'route', path } : null;
  }
  return null;
}

export interface StartupContext {
  /** The visible apps, after the ones turned off are taken out. */
  apps: ReadonlyArray<Pick<AppDefinition, 'id' | 'route' | 'app'>>;
  /** Whether a desktop route may be opened (access and apps turned off). */
  canOpenRoute: (route: string) => boolean;
  /** The route of the tab that was in front when WorkSuite last closed, if tabs were brought back. */
  lastRoute: string | null;
  /** Where the shell starts when nothing else applies: Home, or Notes for a guest. */
  home: string;
}

/**
 * Where WorkSuite opens. `route` null: stay on the tab already in front (`last`, with tabs brought back). A choice
 * that cannot be honoured — an app no longer given or turned off, a route refused — falls back to Home, and says why.
 */
export function startupTarget(screen: unknown, ctx: StartupContext): { route: string | null; fallback: string | null } {
  const choice = parseStartup(screen) ?? { kind: 'home' };
  switch (choice.kind) {
    case 'home':
      return { route: ctx.home, fallback: null };
    case 'last':
      return ctx.lastRoute && ctx.canOpenRoute(ctx.lastRoute) ? { route: null, fallback: null } : { route: ctx.home, fallback: null };
    case 'app': {
      // `app:<slug>` (the server's) — or a desktop app id, for an app the server has no slug for (Home's, Activity's).
      const a = ctx.apps.find((x) => x.app === choice.appId) ?? ctx.apps.find((x) => x.id === choice.appId);
      return a ? { route: appRoute(a), fallback: null } : { route: ctx.home, fallback: 'The app chosen to open at startup is not available, so WorkSuite opened Home.' };
    }
    case 'route':
      return ctx.canOpenRoute(choice.path) ? { route: choice.path, fallback: null } : { route: ctx.home, fallback: 'The page chosen to open at startup is not available, so WorkSuite opened Home.' };
  }
}

/** The startup choices offered for the apps a person has. */
export function startupOptions(apps: ReadonlyArray<Pick<AppDefinition, 'id' | 'label' | 'app'>>): SettingOption[] {
  const seen = new Set<string>();
  const out = [...STARTUP_OPTIONS];
  for (const a of apps) {
    if (a.id === 'home' || SHELL_SCREENS.has(a.id)) continue;
    const value = `app:${a.app ?? a.id}`;
    if (seen.has(value)) continue;
    seen.add(value);
    out.push({ value, label: a.label });
  }
  return out;
}

/** The view a renderer gets when it has nothing from the desktop yet (a browser preview, tests). */
export function emptyView(): DesktopSettingsView {
  const catalogue = localCatalogue();
  return { mode: 'personal', status: 'local', asOf: null, version: null, orgId: null, catalogue, effective: resolveSettings({ mode: 'personal', catalogue }), pending: [] };
}
