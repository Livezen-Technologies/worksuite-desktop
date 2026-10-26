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
 *   features.<id>            a feature on or off (the palette, the launcher, notifications …)
 *   modules.<appId>.enabled  an app on or off — off, it is gone from the launcher, the rail, links, shortcuts, the
 *                            command palette and the tray, exactly as an app the server does not give
 *   startup.screen           'home' | 'last' | 'app:<appId>' | 'route:<path>'
 *   prefs.<name>             one of the person's preferences (`Preferences`), synced across their devices
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
export const moduleKey = (appId: string): string => `modules.${appId}.enabled`;
export const prefKey = (name: string): string => `prefs.${name}`;

const KEY_RE = /^(features\.[a-z0-9_]{1,48}|modules\.[a-z0-9_-]{1,40}\.enabled|startup\.screen|prefs\.[A-Za-z0-9_]{1,48})$/;

/** Whether a key is one of the four shapes the contract allows. */
export function isSettingKey(key: string): boolean {
  return KEY_RE.test(key);
}

/** The app id in `modules.<appId>.enabled`, or null. */
export function moduleOfKey(key: string): string | null {
  const m = /^modules\.([a-z0-9_-]{1,40})\.enabled$/.exec(key);
  return m ? m[1]! : null;
}

// ── what this desktop knows ──────────────────────────────────────────────

/**
 * The features the desktop enforces. `prefs`: preferences a feature that is off holds off (and shows locked), so the
 * services that read them stop by themselves. The rest are enforced where they open (the overlays, Quick Ask).
 */
export interface DesktopFeature {
  id: string;
  label: string;
  description: string;
  prefs?: ReadonlyArray<keyof Preferences>;
}

export const DESKTOP_FEATURES: readonly DesktopFeature[] = [
  { id: 'command_palette', label: 'Command palette', description: 'Run commands and open apps by name from the keyboard.' },
  { id: 'global_search', label: 'Search', description: 'Search across apps from the title bar and its shortcut.' },
  { id: 'app_launcher', label: 'App launcher', description: 'The grid of every app, from the title bar, the sidebar and its shortcut.' },
  { id: 'notifications', label: 'Desktop notifications', description: 'Banners and sounds on this computer, even with the window closed.', prefs: ['notificationsEnabled'] },
  { id: 'background_tray', label: 'Keep running in the tray', description: 'Closing the window leaves WorkSuite running in the tray. Off: closing it quits.', prefs: ['minimizeToTray', 'startMinimized'] },
  { id: 'start_with_os', label: 'Start with the computer', description: 'WorkSuite may start when you sign in to the computer.', prefs: ['startWithOs'] },
  { id: 'restore_tabs', label: 'Reopen tabs', description: 'WorkSuite may bring back the tabs you had open.', prefs: ['restoreTabs'] },
  { id: 'ai_quick_ask', label: 'AI Quick Ask', description: 'The assistant over any app, from its global shortcut.' },
];

/**
 * Preferences that sync as `prefs.<name>`: scalar choices that mean the same on every computer. Paths, folders,
 * per-computer caches and the security settings (which have their own policy) stay on the computer, and the colour
 * profile and its mode sync on their own (appearance-sync, with the organisation's colour profile).
 */
export const SYNCED_PREFS: ReadonlyArray<{ name: keyof Preferences; label: string; type: SettingType; options?: SettingOption[] }> = [
  { name: 'density', label: 'Density', type: 'enum', options: [{ value: 'comfortable', label: 'Comfortable' }, { value: 'compact', label: 'Compact' }] },
  { name: 'sidebarMode', label: 'Sidebar', type: 'enum', options: [{ value: 'expanded', label: 'Expanded' }, { value: 'collapsed', label: 'Collapsed' }, { value: 'auto-hide', label: 'Auto-hide' }] },
  { name: 'highContrast', label: 'High contrast', type: 'boolean' },
  { name: 'restoreTabs', label: 'Reopen my tabs when WorkSuite starts', type: 'boolean' },
  { name: 'startWithOs', label: 'Start with your computer', type: 'boolean' },
  { name: 'startMinimized', label: 'Start minimized to the tray', type: 'boolean' },
  { name: 'minimizeToTray', label: 'Closing the window keeps WorkSuite in the tray', type: 'boolean' },
  { name: 'notificationsEnabled', label: 'Desktop notifications', type: 'boolean' },
  { name: 'notificationSounds', label: 'Sounds', type: 'boolean' },
  { name: 'badgeCount', label: 'Badge count', type: 'boolean' },
  { name: 'openFilesLocally', label: 'Open downloaded files', type: 'enum', options: [{ value: 'ask', label: 'Ask' }, { value: 'always', label: 'Open locally' }, { value: 'never', label: 'Download only' }] },
  { name: 'tabSuspendMinutes', label: 'Tab suspension', type: 'number' },
  { name: 'dndEnabled', label: 'Do not disturb', type: 'boolean' },
  { name: 'dndFrom', label: 'Do not disturb from', type: 'string' },
  { name: 'dndTo', label: 'Do not disturb until', type: 'string' },
];
const SYNCED_PREF_NAMES = new Set<string>(SYNCED_PREFS.map((p) => p.name));

/** The preference a `prefs.<name>` key is, when it is one this desktop applies. */
export function prefOfKey(key: string): keyof Preferences | null {
  const name = key.startsWith('prefs.') ? key.slice(6) : null;
  return name && SYNCED_PREF_NAMES.has(name) ? (name as keyof Preferences) : null;
}

/** Apps that can never be turned off: the shell's own screens (Home, Settings …) and what has no app gate. */
export function canDisableModule(appId: string): boolean {
  return !SHELL_SCREENS.has(appId);
}

export const STARTUP_OPTIONS: SettingOption[] = [
  { value: 'home', label: 'Home' },
  { value: 'last', label: 'Where I left off' },
];

/** The catalogue this desktop knows without a server: every feature, app, the startup screen and the synced prefs. */
export function localCatalogue(apps: readonly AppDefinition[] = APP_CATALOGUE, defaults?: Partial<Preferences>): CatalogueItem[] {
  // `last` until someone chooses: what WorkSuite did before there was a choice (the tabs back, the last one in front;
  // Home when tab restore is off).
  const out: CatalogueItem[] = [{ key: STARTUP_KEY, type: 'string', default: 'last', label: 'Startup screen', group: 'startup', options: STARTUP_OPTIONS }];
  for (const f of DESKTOP_FEATURES) out.push({ key: featureKey(f.id), type: 'boolean', default: true, label: f.label, description: f.description, group: 'features' });
  for (const a of apps) if (canDisableModule(a.id) && !a.channelOf) out.push({ key: moduleKey(a.id), type: 'boolean', default: true, label: a.label, group: 'modules' });
  for (const p of SYNCED_PREFS) {
    const d = defaults?.[p.name];
    out.push({ key: prefKey(p.name), type: p.type, default: d === undefined ? null : (d as SettingValue), label: p.label, group: 'prefs', ...(p.options ? { options: p.options } : {}) });
  }
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
      return typeof v === 'string' && v.length <= 2048;
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
export function moduleOn(effective: Record<string, EffectiveSetting> | null | undefined, appId: string): boolean {
  if (!canDisableModule(appId)) return true;
  return effective?.[moduleKey(appId)]?.value !== false;
}

/** The apps turned off. */
export function disabledModules(effective: Record<string, EffectiveSetting> | null | undefined): Set<string> {
  const out = new Set<string>();
  for (const [k, e] of Object.entries(effective ?? {})) {
    const id = moduleOfKey(k);
    if (id && e.value === false && canDisableModule(id)) out.add(id);
  }
  return out;
}

/** Drops the apps turned off from a visible-apps list (and a channel whose host is off goes with it). */
export function withoutDisabled<T extends Pick<AppDefinition, 'id' | 'channelOf'>>(apps: readonly T[], off: ReadonlySet<string>): T[] {
  if (off.size === 0) return apps as T[];
  return apps.filter((a) => !off.has(a.id) && !(a.channelOf && off.has(a.channelOf)));
}

/** The same for a set of visible app ids (the main process's `visibleApps`). */
export function withoutDisabledIds(ids: ReadonlySet<string>, off: ReadonlySet<string>): Set<string> {
  if (off.size === 0) return new Set(ids);
  const hostOf = new Map(APP_CATALOGUE.filter((a) => a.channelOf).map((a) => [a.id, a.channelOf!]));
  return new Set([...ids].filter((id) => !off.has(id) && !off.has(hostOf.get(id) ?? '')));
}

/**
 * What the policy, a feature that is off, and the person's synced choices make of their preferences: values to put
 * over `Preferences`, and the keys to show locked with why. A managed `prefs.*` is locked; a feature that is off holds
 * its preferences off and locked (by the organisation, or by the person's own Features & apps).
 */
export function preferenceOverlay(effective: Record<string, EffectiveSetting> | null | undefined): { values: Partial<Preferences>; locks: Array<{ key: keyof Preferences; reason: string }> } {
  const values: Record<string, unknown> = {};
  const locks: Array<{ key: keyof Preferences; reason: string }> = [];
  if (!effective) return { values: values as Partial<Preferences>, locks };
  for (const [key, e] of Object.entries(effective)) {
    const name = prefOfKey(key);
    if (!name || e.source === 'default' || e.value === null) continue;
    values[name] = e.value;
    if (e.locked) locks.push({ key: name, reason: MANAGED_REASON });
  }
  for (const f of DESKTOP_FEATURES) {
    const e = effective[featureKey(f.id)];
    if (!f.prefs || e?.value !== false) continue;
    for (const name of f.prefs) {
      values[name] = false;
      if (!locks.some((l) => l.key === name)) locks.push({ key: name, reason: e.locked ? `${MANAGED_REASON} ${f.label} is turned off.` : `${f.label} is turned off in Settings › Features & apps.` });
    }
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
    const v = prefs[p.name];
    if (v === undefined || v === null || typeof v === 'object') continue;
    if (JSON.stringify(v) === JSON.stringify(defaults[p.name])) continue;
    out[prefKey(p.name)] = v as SettingValue;
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

const ROUTE_RE = /^\/[A-Za-z0-9][A-Za-z0-9/_.~%-]*(\?[A-Za-z0-9_.~%=&+,:-]*)?$/;

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
    return path.length <= 512 && ROUTE_RE.test(path) && !path.startsWith('//') && !path.includes('..') ? { kind: 'route', path } : null;
  }
  return null;
}

export interface StartupContext {
  /** The visible apps, after the ones turned off are taken out. */
  apps: ReadonlyArray<Pick<AppDefinition, 'id' | 'route'>>;
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
      const a = ctx.apps.find((x) => x.id === choice.appId);
      return a ? { route: appRoute(a), fallback: null } : { route: ctx.home, fallback: 'The app chosen to open at startup is not available, so WorkSuite opened Home.' };
    }
    case 'route':
      return ctx.canOpenRoute(choice.path) ? { route: choice.path, fallback: null } : { route: ctx.home, fallback: 'The page chosen to open at startup is not available, so WorkSuite opened Home.' };
  }
}

/** The startup choices offered for the apps a person has. */
export function startupOptions(apps: ReadonlyArray<Pick<AppDefinition, 'id' | 'label'>>): SettingOption[] {
  return [...STARTUP_OPTIONS, ...apps.filter((a) => a.id !== 'home' && !SHELL_SCREENS.has(a.id)).map((a) => ({ value: `app:${a.id}`, label: a.label }))];
}

/** The view a renderer gets when it has nothing from the desktop yet (a browser preview, tests). */
export function emptyView(): DesktopSettingsView {
  const catalogue = localCatalogue();
  return { mode: 'personal', status: 'local', asOf: null, version: null, orgId: null, catalogue, effective: resolveSettings({ mode: 'personal', catalogue }), pending: [] };
}
