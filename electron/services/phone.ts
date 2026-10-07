import { globalShortcut, type BrowserWindow } from 'electron';
import { PHONE_SHORTCUTS, phoneOrigin, type PhoneNotify, type PhoneOutputs, type PhoneShortcut } from '@shared/phone';
import { DesktopError } from '../main/errors';
import { logger } from '../main/log';
import type { IpcRouter } from '../ipc/router';
import type { Incoming } from './notifications';

const log = logger('phone');

/**
 * The Phone in the main process (src/modules/phone; WS-VOIP-SRS-001 D01): the phone system's WebSocket in the page
 * policy, the compact phone's global shortcuts, and calls as native notifications. The SIP phone itself runs in the
 * main window's page; nothing here sees a SIP password beyond reading the address it may connect to.
 */
export interface PhoneDeps {
  config: { getConfig<T>(key: string): T | null | undefined; setConfig(key: string, value: unknown): void };
  http: { get<T>(path: string): Promise<T> };
  /** Signed in, not locked, and the Phone is one of the person's apps. */
  allowed: () => boolean;
  notify: (n: Incoming) => void;
  /** This computer's own entry in the bell (`NotificationService.addLocal`): a missed call nothing popped up for. */
  bell?: (item: { id: string; title: string; body: string; link: string | null; module?: string }) => void;
  mainWindow: () => BrowserWindow | null;
  /** Shortcut registration, replaceable in tests. */
  shortcuts?: { register(acc: string, fn: () => void): boolean; unregister(acc: string): void };
}

const KEY = 'phone_servers';

export class PhoneService {
  private held = new Map<PhoneShortcut, boolean>();
  private readonly keys: NonNullable<PhoneDeps['shortcuts']>;

  constructor(private readonly d: PhoneDeps) {
    this.keys = d.shortcuts ?? { register: (acc, fn) => globalShortcut.register(acc, fn), unregister: (acc) => globalShortcut.unregister(acc) };
  }

  /** The phone systems' WebSocket origins every page may connect to (added to the page policy's connect-src). */
  origins(): string[] {
    const v = this.d.config.getConfig<string[]>(KEY);
    return Array.isArray(v) ? v.filter((o) => phoneOrigin(o) === o) : [];
  }

  /** Learn the person's phone system from WorkSuite; `added` when the page that asked loaded without it. */
  async prepare(): Promise<PhoneOutputs['phone:prepare']> {
    if (!this.d.allowed()) throw new DesktopError('APP_ACCESS_DENIED', "You don't have access to the Phone.");
    let ws: string | null = null;
    try {
      const r = await this.d.http.get<{ ws_uri?: string }>('/api/voip/softphone');
      ws = typeof r?.ws_uri === 'string' ? r.ws_uri : null;
    } catch (e) {
      log.debug('softphone address not available', { error: String(e) });
      return { origin: null, added: false };
    }
    const origin = phoneOrigin(ws);
    if (!origin) return { origin: null, added: false };
    const known = this.origins();
    if (known.includes(origin)) return { origin, added: false };
    // A few at most: the person's own switch, and one before it if they moved.
    this.d.config.setConfig(KEY, [origin, ...known].slice(0, 4));
    log.info('phone system allowed', { origin });
    return { origin, added: true };
  }

  /** Hold the global shortcuts while the phone is registered; release them otherwise or on sign-out. */
  setShortcuts(on: boolean): PhoneOutputs['phone:shortcuts'] {
    for (const [action, acc] of Object.entries(PHONE_SHORTCUTS) as Array<[PhoneShortcut, string]>) {
      const has = this.held.get(action) ?? false;
      if (on && !has && this.d.allowed()) {
        try {
          const ok = this.keys.register(acc, () => this.press(action));
          this.held.set(action, ok);
          if (!ok) log.info('shortcut taken by another app', { acc });
        } catch {
          this.held.set(action, false);
        }
      } else if (!on && has) {
        this.keys.unregister(acc);
        this.held.set(action, false);
      }
    }
    return { held: { answer: this.held.get('answer') ?? false, hangup: this.held.get('hangup') ?? false, mute: this.held.get('mute') ?? false } };
  }

  private press(action: PhoneShortcut): void {
    const win = this.d.mainWindow();
    if (!win || win.isDestroyed()) return;
    win.webContents.send('phone:shortcut', { action });
  }

  /**
   * A call as a native notification; clicking it opens the Phone. As the status calls are in says (#288): Busy's is
   * silent whatever the app's sounds are, and a call turned away by Do not disturb or Away is only kept in the bell.
   */
  notify(n: PhoneNotify): void {
    if (!this.d.allowed()) return;
    const link = n.kind === 'missed' ? '/phone/calls' : '/phone';
    if (n.delivery === 'bell') {
      this.d.bell?.({ id: n.id, title: n.title, body: n.body, link, module: 'phone' });
      return;
    }
    this.d.notify({
      id: n.id,
      module: 'phone',
      category: 'voip',
      title: n.title,
      body: n.body,
      sender: null,
      link,
      critical: n.kind === 'incoming',
      call: n.kind === 'incoming',
      ...(n.delivery === 'silent' ? { custom: { actions: [], sound: false, onAction: () => undefined } } : {}),
    });
  }

  register(router: IpcRouter): void {
    router.handle('phone:prepare', () => this.prepare());
    router.handle('phone:shortcuts', (input) => this.setShortcuts(input.on));
    router.handle('phone:notify', (input) => this.notify(input));
  }

  /** Signed out, or the Phone went away: nothing held. */
  reset(): void {
    this.setShortcuts(false);
  }
}
