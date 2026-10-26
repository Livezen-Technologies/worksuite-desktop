import { normalizeLanguage } from '@shared/localization';
import { DEFAULT_DARK_PROFILE, isBuiltinProfile, normalizeAppearance, normalizeDarkProfile, normalizeSpec, storedAppearance, withOrganisation, type AppearancePrefs, type OrgProfile } from '@shared/theme-profiles';
import { app } from 'electron';
import { join } from 'node:path';
import { FOLLOW_UP_DEFAULTS, type DesktopPolicy, type Preferences, type PreferenceLock } from '@shared/types';
import { defaultDrivePrefs, normalizeDrivePrefs } from '@shared/transfers';
import type { Database } from './db';
import { stricterPrivacy } from './policy';
import { effectiveChannel, migrateUpdatePrefs } from '@shared/updates';

/** §11.1 defaults. */
export function defaultPreferences(): Preferences {
  let downloads = '';
  try {
    downloads = join(app.getPath('downloads'), 'WorkSuite');
  } catch {
    downloads = 'WorkSuite';
  }
  // Local meeting recordings (worksuite-desktop#68): the system's Videos folder, else beside the downloads.
  let videos = '';
  try {
    videos = app.getPath('videos');
  } catch {
    videos = downloads;
  }
  return {
    startWithOs: true,
    startMinimized: false,
    minimizeToTray: true,
    restoreTabs: true,
    theme: 'system',
    darkColorProfile: DEFAULT_DARK_PROFILE,
    appearance: normalizeAppearance(null),
    density: 'comfortable',
    hardwareAcceleration: true,
    notificationSounds: true,
    notificationPrivacy: 'SENDER_ONLY',
    notificationsEnabled: true,
    badgeCount: true,
    moduleNotifications: {},
    dndEnabled: false,
    dndFrom: '22:00',
    dndTo: '07:00',
    appLockMinutes: 15,
    appLockEnabled: false,
    lockOnSleep: true,
    lockedChatNotifications: true,
    lockedCallNotifications: true,
    lockedNotificationSounds: true,
    lockedAnswerCalls: true,
    lockedShowCallerDetails: false,
    lockedAllowChat: false,
    lockedNotificationSender: false,
    lockedNotificationPreview: false,
    lockOnSystemLock: true,
    openFilesLocally: 'ask',
    downloadFolder: downloads,
    mailCacheDays: 30,
    mailtoHandler: false,
    mailCacheDaysByMailbox: {},
    tabSuspendMinutes: 30,
    language: 'en',
    updateChannel: 'beta',
    autoUpdate: true,
    updateNotifications: true,
    updateInstallOnQuit: true,
    updateShowWhatsNew: true,
    updateInstallWhenIdle: false,
    sidebarMode: 'expanded',
    pinnedApps: [],
    shortcuts: {},
    backgroundServices: { notifications: true, realtime: true },
    webchatRinging: { window: true, duringDnd: 'card', shortcut: true, volume: 80, ringOn: 'both', liveShortcuts: true },
    webchatFollowUps: { ...FOLLOW_UP_DEFAULTS },
    ai: { quickAsk: true, shortcut: process.platform === 'darwin' ? 'Alt+Space' : 'Control+Alt+Space', insert: true, dockAtStart: false, language: 'Sinhala', display: 'widget', sound: false, moduleAccess: { worksuite: {}, local: {} }, onlineFallback: true, autoMinimize: false, autoMinimizeWhenWorking: true },
    meetRecording: { method: 'cloud', quality: '720p', layout: 'grid', folder: 'Meeting Recordings', localFolder: join(videos, 'WorkSuite Recordings'), keepLocal: '7' },
    // Settings › Meet › Behaviour (WS-MEET-ENH-01 D05). The global keys are on:
    // a mute key that only works with the window in front is not worth having.
    meetBehaviour: { popOutOnSwitch: false, globalKeys: true, shareComputerSound: false, qualityOnBattery: 'auto' },
    drive: defaultDrivePrefs(),
  };
}

/**
 * User preferences, with admin policy applied on top (FR-TRAY-04): a value
 * the policy constrains is clamped and reported as locked, with the reason,
 * so Settings can show the toggle disabled instead of silently ignoring it.
 */
const SECURITY_KEYS = ['appLockEnabled', 'appLockMinutes', 'lockOnSystemLock', 'lockOnSleep', 'lockedChatNotifications', 'lockedCallNotifications', 'lockedNotificationSounds', 'lockedAnswerCalls', 'lockedShowCallerDetails', 'lockedAllowChat', 'lockedNotificationSender', 'lockedNotificationPreview'] as const;

export class SettingsService {
  private prefs: Preferences;
  private languageScope: string | null = null;
  private defaultLanguage: string;
  private policy: DesktopPolicy | null = null;
  private listeners = new Set<(p: Preferences) => void>();
  /**
   * Desktop settings over the preferences (shared/desktop-settings.ts preferenceOverlay): the synced and managed
   * `prefs.*`, and the preferences a feature that is off holds off — with the locks that come with them.
   */
  private overlay: { values: Partial<Preferences>; locks: PreferenceLock[] } = { values: {}, locks: [] };

  constructor(private readonly db: Database) {
    const stored = db.getConfig<Partial<Preferences>>('preferences') ?? {};
    const defaults = defaultPreferences();
    const savedLanguage = db.getConfig<unknown>('interface_language_default');
    this.defaultLanguage = normalizeLanguage(typeof savedLanguage === 'string' ? savedLanguage : stored.language);
    // The AI settings are one object: one saved before a field was added takes that field's default.
    this.prefs = { ...defaults, ...stored, appLockEnabled: stored.appLockEnabled ?? (stored.appLockMinutes !== undefined && stored.appLockMinutes > 0), appLockMinutes: stored.appLockMinutes === 0 && stored.appLockEnabled === undefined ? 15 : stored.appLockMinutes ?? defaults.appLockMinutes, darkColorProfile: normalizeDarkProfile(stored.darkColorProfile), ai: { ...defaults.ai, ...stored.ai, display: stored.ai?.display ?? defaults.ai.display }, meetRecording: { ...defaults.meetRecording, ...stored.meetRecording }, meetBehaviour: { ...defaults.meetBehaviour, ...stored.meetBehaviour }, drive: normalizeDrivePrefs(stored.drive), ...migrateUpdatePrefs(stored) };
    this.setAppearance(normalizeAppearance(stored.appearance, { theme: stored.theme, darkColorProfile: stored.darkColorProfile }), stored.theme);
  }

  /**
   * The colour profiles (worksuite-desktop#234), and `theme` and `darkColorProfile` — the mode and the dark profile
   * as preferences saved before them, and the rest of the app, read them — kept the same as them. `theme`: the mode
   * when it was saved without it.
   */
  private setAppearance(a: AppearancePrefs, theme?: unknown): void {
    const mode = theme === 'system' || theme === 'light' || theme === 'dark' ? theme : a.mode;
    const appearance = { ...storedAppearance(a), mode };
    this.prefs = { ...this.prefs, appearance, theme: mode, darkColorProfile: isBuiltinProfile(appearance.darkProfile) ? appearance.darkProfile : normalizeDarkProfile(this.prefs.darkColorProfile) };
  }

  /** The person's own colour profiles, as saved and synced. */
  appearance(): AppearancePrefs {
    return { ...this.prefs.appearance!, custom: [...this.prefs.appearance!.custom] };
  }

  /** The organisation's colour profile, from its desktop policy. */
  private orgProfile(): OrgProfile | null {
    const p = this.policy;
    const spec = p?.appearance_accent ? normalizeSpec({ accent: p.appearance_accent, tint: p.appearance_tint, tintColor: p.appearance_tint_color }) : null;
    return spec ? { ...spec, name: 'Organisation' } : null;
  }

  /**
   * Another device's copy (synced through the server), when it is newer than this one: taken as it is, its time
   * kept, so it is not sent back. Returns whether it was taken.
   */
  applyRemoteAppearance(remote: unknown): boolean {
    const next = normalizeAppearance(remote);
    if (!next.updatedAt || next.updatedAt <= (this.prefs.appearance?.updatedAt ?? 0)) return false;
    this.setAppearance(next);
    this.persistAppearance();
    this.db.setConfig('preferences', this.prefs);
    this.emit();
    return true;
  }

  private persistAppearance(): void {
    if (this.languageScope) this.db.setConfig(`appearance_preferences:${this.languageScope}`, this.prefs.appearance);
  }

  /** Interface language is isolated by server and user, while device policy stays computer-wide. */
  setUserLanguageScope(origin: string | null, userId: string | null): void {
    const next = origin && userId ? `${origin}:${userId}` : null;
    if (next === this.languageScope) return;
    if (this.db.getConfig('interface_language_default') === undefined || this.db.getConfig('interface_language_default') === null) this.db.setConfig('interface_language_default', this.defaultLanguage);
    // Lock choices are local to this installation and isolated by server and user.
    const defaults = defaultPreferences();
    let scoped = next ? this.db.getConfig<Partial<Preferences>>(`security_preferences:${next}`) : null;
    // Migrate the old device-wide preferences once, to the first signed-in account.
    if (next && !this.db.getConfig<string>('security_preferences_legacy_owner')) {
      this.db.setConfig('security_preferences_legacy_owner', next);
      if (!scoped) {
        scoped = Object.fromEntries(SECURITY_KEYS.map(key => [key, this.prefs[key]]));
        this.db.setConfig(`security_preferences:${next}`, scoped);
      }
    }
    for (const key of SECURITY_KEYS) Object.assign(this.prefs, { [key]: scoped?.[key] ?? defaults[key] });
    // Colour profiles are each person's (#234): theirs when they have saved some here, else what this computer shows
    // now becomes theirs.
    if (next) {
      const look = this.db.getConfig<unknown>(`appearance_preferences:${next}`);
      if (look && typeof look === 'object' && typeof (look as AppearancePrefs).lightProfile === 'string') {
        this.setAppearance(normalizeAppearance(look));
        // The next start, before anyone signs in, paints this person's colours.
        this.db.setConfig('preferences', this.prefs);
      } else this.db.setConfig(`appearance_preferences:${next}`, this.prefs.appearance);
    }
    this.languageScope = next;
    const saved = this.db.getConfig<Record<string, string>>('interface_languages') ?? {};
    this.prefs = { ...this.prefs, language: normalizeLanguage(next ? saved[next] ?? this.defaultLanguage : this.defaultLanguage) };
    this.emit();
  }

  /** The organisation's minimum for what any notification shows here, or null without a policy. */
  policyMinPrivacy(): DesktopPolicy['notification_min_privacy'] | null {
    return this.policy?.notification_min_privacy ?? null;
  }

  /** What desktop settings put over the preferences; the windows hear of it when it changes anything. */
  setDesktopOverlay(overlay: { values: Partial<Preferences>; locks: PreferenceLock[] }): void {
    if (JSON.stringify(overlay) === JSON.stringify(this.overlay)) return;
    this.overlay = { values: { ...overlay.values }, locks: [...overlay.locks] };
    this.emit();
  }

  setPolicy(policy: DesktopPolicy | null): void {
    this.policy = policy;
    this.emit();
  }

  locks(): PreferenceLock[] {
    const out = this.policyLocks();
    for (const l of this.overlay.locks) if (!out.some((o) => o.key === l.key)) out.push(l);
    return out;
  }

  private policyLocks(): PreferenceLock[] {
    const p = this.policy;
    if (!p) return [];
    const out: PreferenceLock[] = [];
    if (p.app_lock_max_minutes > 0) {
      out.push({ key: 'appLockEnabled', reason: 'Your organization requires app locking.' });
      out.push({ key: 'appLockMinutes', reason: `Your organization requires WorkSuite to lock after at most ${p.app_lock_max_minutes} minutes.` });
    }
    if (p.notification_min_privacy !== 'FULL') {
      out.push({ key: 'notificationPrivacy', reason: 'Your organization limits what notifications may show.' });
      out.push({ key: 'lockedNotificationPreview', reason: 'Your organization limits what notifications may show.' });
    }
    if (p.notification_min_privacy === 'GENERIC') out.push({ key: 'lockedNotificationSender', reason: 'Your organization limits what notifications may show.' });
    if (p.auto_update === 'enforced') {
      out.push({ key: 'updateChannel', reason: 'Your organization chooses the update channel.' });
      out.push({ key: 'autoUpdate', reason: 'Your organization keeps WorkSuite up to date automatically.' });
    }
    if (p.required_background_services.includes('notifications')) {
      out.push({ key: 'backgroundServices', reason: 'Your organization requires background notifications.' });
    }
    if (p.appearance_locked && this.orgProfile()) {
      out.push({ key: 'appearance', reason: 'Your organization sets the colour profile.' });
      out.push({ key: 'darkColorProfile', reason: 'Your organization sets the colour profile.' });
    }
    for (const [flag, key] of [['locked_answer_calls', 'lockedAnswerCalls'], ['locked_show_caller_details', 'lockedShowCallerDetails'], ['locked_allow_chat', 'lockedAllowChat']] as const) {
      if (p[flag] === false) out.push({ key, reason: 'Your organization disables this access while WorkSuite is locked.' });
    }
    return out;
  }

  /** Preferences as they take effect, with policy constraints applied. */
  effective(): Preferences {
    const p = { ...this.prefs, ...this.overlay.values, backgroundServices: { ...this.prefs.backgroundServices } };
    const pol = this.policy;
    // The organisation's colour profile stands in for the person's until they pick one, or always when locked.
    p.appearance = withOrganisation(this.prefs.appearance!, this.orgProfile(), pol?.appearance_locked === true);
    if (!pol) return p;
    if (pol.locked_answer_calls === false) p.lockedAnswerCalls = false;
    if (pol.locked_show_caller_details === false) p.lockedShowCallerDetails = false;
    if (pol.locked_allow_chat === false) p.lockedAllowChat = false;
    if (pol.app_lock_max_minutes > 0) p.appLockEnabled = true;
    if (pol.app_lock_max_minutes > 0 && p.appLockMinutes > pol.app_lock_max_minutes) {
      p.appLockMinutes = pol.app_lock_max_minutes;
    }
    p.notificationPrivacy = stricterPrivacy(p.notificationPrivacy, pol.notification_min_privacy);
    if (p.notificationPrivacy === 'GENERIC') p.lockedShowCallerDetails = false;
    // What a banner shows while locked is never more than the organization lets any banner show (#114).
    if (pol.notification_min_privacy !== 'FULL') p.lockedNotificationPreview = false;
    if (pol.notification_min_privacy === 'GENERIC') p.lockedNotificationSender = false;
    // Enforced: the organisation's channel. Each person's choice: theirs while allowed, else the organisation's
    // default, else the most stable allowed channel — never a downgrade (the updater waits for it to catch up).
    p.updateChannel = effectiveChannel(this.prefs.updateChannel, !!this.prefs.updateChannelChosen, pol);
    // Enforced updates download by themselves; installing on quit and the notifications stay each person's.
    if (pol.auto_update === 'enforced') p.autoUpdate = true;
    if (pol.required_background_services.includes('notifications')) p.backgroundServices.notifications = true;
    if (pol.required_background_services.includes('realtime')) p.backgroundServices.realtime = true;
    return p;
  }

  raw(): Preferences {
    return { ...this.prefs };
  }

  update(patch: Partial<Preferences>): Preferences {
    // Recording settings arrive a field at a time; the rest of them stays.
    const meetRecording = patch.meetRecording ? { ...this.prefs.meetRecording, ...patch.meetRecording } : this.prefs.meetRecording;
    // So do Drive's: a change to one of them leaves the others as they were.
    const drive = patch.drive ? normalizeDrivePrefs({ ...this.prefs.drive, ...patch.drive }) : this.prefs.drive;
    // And the link settings (#170).
    const links = patch.links ? { ...this.prefs.links, ...patch.links } : this.prefs.links;
    // And "Open Office files in" (#322): one kind at a time.
    const officeOpen = patch.officeOpen ? { ...this.prefs.officeOpen, ...patch.officeOpen } : this.prefs.officeOpen;
    const before = this.prefs.appearance!;
    this.prefs = { ...this.prefs, ...patch, meetRecording, drive, ...(links ? { links } : {}), ...(officeOpen ? { officeOpen } : {}), appearance: before };
    if (patch.appearance !== undefined || patch.theme !== undefined || patch.darkColorProfile !== undefined) {
      const next: Partial<AppearancePrefs> = { ...before, ...patch.appearance };
      if (patch.darkColorProfile !== undefined && patch.appearance?.darkProfile === undefined) {
        next.darkProfile = patch.darkColorProfile;
        next.chosen = true;
      }
      if (patch.theme !== undefined) next.mode = patch.theme;
      const after = normalizeAppearance(next);
      const changed = JSON.stringify({ ...after, updatedAt: 0 }) !== JSON.stringify({ ...normalizeAppearance(before), updatedAt: 0 });
      after.updatedAt = changed ? Math.max(Date.now(), (before.updatedAt ?? 0) + 1) : before.updatedAt;
      if (!after.updatedAt) delete after.updatedAt;
      this.setAppearance(after);
      if (changed) this.persistAppearance();
    }
    if (patch.language !== undefined) {
      this.prefs.language = normalizeLanguage(patch.language);
      if (this.languageScope) {
        const languages = this.db.getConfig<Record<string, string>>('interface_languages') ?? {};
        this.db.setConfig('interface_languages', { ...languages, [this.languageScope]: this.prefs.language });
      } else { this.defaultLanguage = this.prefs.language; this.db.setConfig('interface_language_default', this.prefs.language); }
    }
    if (this.languageScope) this.db.setConfig(`security_preferences:${this.languageScope}`, Object.fromEntries(SECURITY_KEYS.map(key => [key, this.prefs[key]])));
    this.db.setConfig('preferences', this.prefs);
    this.emit();
    return this.effective();
  }

  /** Drive › Settings › Reset to defaults: the transfer settings and the download folder as they were at first. */
  resetDrive(): Preferences {
    const d = defaultPreferences();
    return this.update({ drive: d.drive, downloadFolder: d.downloadFolder });
  }

  onChange(fn: (p: Preferences) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(): void {
    const eff = this.effective();
    for (const fn of this.listeners) fn(eff);
  }
}
