import { app } from 'electron';
import { join } from 'node:path';
import type { DesktopPolicy, Preferences, PreferenceLock } from '@shared/types';
import type { Database } from './db';
import { stricterPrivacy } from './policy';

/** §11.1 defaults. */
export function defaultPreferences(): Preferences {
  let downloads = '';
  try {
    downloads = join(app.getPath('downloads'), 'WorkSuite');
  } catch {
    downloads = 'WorkSuite';
  }
  return {
    startWithOs: true,
    startMinimized: false,
    minimizeToTray: true,
    restoreTabs: true,
    theme: 'system',
    density: 'comfortable',
    hardwareAcceleration: true,
    notificationSounds: true,
    notificationPrivacy: 'SENDER_ONLY',
    notificationsEnabled: true,
    moduleNotifications: {},
    dndEnabled: false,
    dndFrom: '22:00',
    dndTo: '07:00',
    appLockMinutes: 15,
    lockOnSystemLock: true,
    openFilesLocally: 'ask',
    downloadFolder: downloads,
    mailCacheDays: 30,
    tabSuspendMinutes: 30,
    language: 'en',
    updateChannel: 'stable',
    sidebarMode: 'expanded',
    pinnedApps: [],
    shortcuts: {},
    backgroundServices: { notifications: true, realtime: true },
  };
}

/**
 * User preferences, with admin policy applied on top (FR-TRAY-04): a value
 * the policy constrains is clamped and reported as locked, with the reason,
 * so Settings can show the toggle disabled instead of silently ignoring it.
 */
export class SettingsService {
  private prefs: Preferences;
  private policy: DesktopPolicy | null = null;
  private listeners = new Set<(p: Preferences) => void>();

  constructor(private readonly db: Database) {
    const stored = db.getConfig<Partial<Preferences>>('preferences') ?? {};
    this.prefs = { ...defaultPreferences(), ...stored };
  }

  setPolicy(policy: DesktopPolicy | null): void {
    this.policy = policy;
    this.emit();
  }

  locks(): PreferenceLock[] {
    const p = this.policy;
    if (!p) return [];
    const out: PreferenceLock[] = [];
    if (p.app_lock_max_minutes > 0) {
      out.push({ key: 'appLockMinutes', reason: `Your organization requires WorkSuite to lock after at most ${p.app_lock_max_minutes} minutes.` });
    }
    if (p.notification_min_privacy !== 'FULL') {
      out.push({ key: 'notificationPrivacy', reason: 'Your organization limits what notifications may show.' });
    }
    if (p.auto_update === 'enforced') {
      out.push({ key: 'updateChannel', reason: 'Your organization chooses the update channel.' });
    }
    if (p.required_background_services.includes('notifications')) {
      out.push({ key: 'backgroundServices', reason: 'Your organization requires background notifications.' });
    }
    return out;
  }

  /** Preferences as they take effect, with policy constraints applied. */
  effective(): Preferences {
    const p = { ...this.prefs, backgroundServices: { ...this.prefs.backgroundServices } };
    const pol = this.policy;
    if (!pol) return p;
    if (pol.app_lock_max_minutes > 0 && (p.appLockMinutes === 0 || p.appLockMinutes > pol.app_lock_max_minutes)) {
      p.appLockMinutes = pol.app_lock_max_minutes;
    }
    p.notificationPrivacy = stricterPrivacy(p.notificationPrivacy, pol.notification_min_privacy);
    if (pol.auto_update === 'enforced') p.updateChannel = pol.update_channel;
    if (pol.required_background_services.includes('notifications')) p.backgroundServices.notifications = true;
    if (pol.required_background_services.includes('realtime')) p.backgroundServices.realtime = true;
    return p;
  }

  raw(): Preferences {
    return { ...this.prefs };
  }

  update(patch: Partial<Preferences>): Preferences {
    this.prefs = { ...this.prefs, ...patch };
    this.db.setConfig('preferences', this.prefs);
    this.emit();
    return this.effective();
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
