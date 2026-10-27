import type { CallService } from '../../services/calls';
import type { HttpClient } from '../../services/http';
import type { LockService } from '../../services/lock';
import { MarketingPulse } from '../../services/marketing-pulse';
import { CallbackReminders } from '../../services/marketing-reminders';
import { NextContactKey } from '../../services/marketing-shortcut';
import { MeetKeys } from '../../services/meet-keys';
import { MeetNext } from '../../services/meet-next';
import type { NotificationService } from '../../services/notifications';
import type { QuickAsk } from '../../services/quick-ask';
import type { SettingsService } from '../../services/settings';
import type { TrayService } from '../../tray/tray';
import type { WindowManager } from '../../windows/manager';
import type { SessionController } from '../session';
import { canOpenApp } from '@shared/access';
import { MEET_GLOBAL_IDS, electronAccelerator, meetShortcutDefaults, type MeetGlobalKey } from '@shared/shortcuts';
import type { ActiveCall } from '@shared/types';
import { BrowserWindow, app, globalShortcut } from 'electron';

/**
 * Marketing and Meet outside the window (WS-MKT-SRS-001 MKT-DSK-01, MKT-CAL-12): the marketing pulse, callback
 * reminders, the next-contact key and Meet's global keys. Moved out of the composition root (electron/main/index.ts)
 * unchanged (audit D-G13).
 */
/** What wireMarketing reads from the composition root (electron/main/index.ts), live: getters, so a value set later is seen. */
export interface WireMarketingDeps {
  readonly calls: CallService;
  readonly globalKeysOn: () => boolean;
  readonly http: HttpClient;
  readonly liveMeetWindow: () => BrowserWindow | null;
  readonly lock: LockService;
  readonly log: { debug: (msg: string, data?: unknown) => void; info: (msg: string, data?: unknown) => void; warn: (msg: string, data?: unknown) => void; error: (msg: string, data?: unknown) => void; };
  readonly meetAction: (id: string, source: "shortcut" | "tray") => void;
  readonly notifications: NotificationService;
  readonly openNextContact: (source: "shortcut" | "tray") => void;
  readonly quickAsk: QuickAsk;
  readonly sessionCtl: SessionController;
  readonly settings: SettingsService;
  readonly syncSupportKeys: () => void;
  readonly tray: TrayService;
  readonly windows: WindowManager;
}

export function wireMarketing(root: WireMarketingDeps) {
  // ── Marketing outside the window (WS-MKT-SRS-001 MKT-DSK-01, MKT-CAL-12) ──
  // The tray's counts, callback reminders to the minute, and the Next contact key — for somebody with Marketing.
  const marketingVisible = (): boolean => root.sessionCtl.isReady() && canOpenApp('marketing', root.sessionCtl.visibleApps());
  const marketingPulse: MarketingPulse = new MarketingPulse({
    get: (path, query) => root.http.get(path, { query }),
    allowed: marketingVisible,
    onChange: (m) => {
      root.tray.update({ marketing: m });
      // Whether the person has a call queue at all decides whether the key is worth holding.
      nextContactKey.sync();
    },
  });
  // ⌘⇧N / Ctrl+Shift+N from other apps (the D01 design). In WorkSuite the keys are "Move tab to new window", so — like
  // the Live keys — held only while no WorkSuite window is in front, and given back on focus, lock, sign-out and quit.
  const nextContactKey = new NextContactKey({
    register: (acc, fn) => globalShortcut.register(acc, fn),
    unregister: (acc) => globalShortcut.unregister(acc),
    state: () => {
      const pulse = marketingPulse.get();
      return {
        signedIn: root.sessionCtl.isReady() && root.globalKeysOn(),
        locked: root.lock.isLocked(),
        marketing: marketingVisible(),
        agent: pulse ? pulse.queue !== null : null,
        focused: BrowserWindow.getAllWindows().some((w) => !w.isDestroyed() && w.isFocused()),
      };
    },
    press: () => root.openNextContact('shortcut'),
  });
  app.on('browser-window-focus', () => nextContactKey.sync());
  app.on('browser-window-blur', () => setImmediate(() => nextContactKey.sync()));

  /*
   * "Pop out the call when I switch apps" (D05): the meeting shrinks to a card
   * that floats over whatever you moved to, and goes back when you return.
   *
   * Only when no WorkSuite window is in front — moving between WorkSuite's own
   * windows is not switching apps, and a meeting that shrank every time
   * somebody clicked their inbox would be unusable. The same test the Next
   * contact key uses, for the same reason.
   */
  let poppedOut = false;
  const anyWindowFocused = (): boolean => BrowserWindow.getAllWindows().some((w) => !w.isDestroyed() && w.isFocused());
  const syncPopOut = (): void => {
    if (root.settings.effective().meetBehaviour?.popOutOnSwitch !== true) {
      poppedOut = false;

      return;
    }

    const win = root.liveMeetWindow();

    if (!win) {
      poppedOut = false;

      return;
    }

    const away = !anyWindowFocused();

    if (away === poppedOut) return;

    poppedOut = away;
    // Only ever undoes what it did: a card the person shrank themselves is
    // left alone when they come back.
    root.windows.setCompact(win, away, 'card');
  };

  app.on('browser-window-focus', () => syncPopOut());
  app.on('browser-window-blur', () => setImmediate(() => syncPopOut()));

  /*
   * Meet's global keys (WS-MEET-ENH-01 D06): mute, camera, join the next
   * meeting, share a screen, start a meeting.
   *
   * Unlike Marketing's key these are not given back on focus — ⌘⇧M is not the
   * shell's anything, and muting yourself while WorkSuite is in front is the
   * ordinary case. They are held only while they can act: mute and camera
   * while a meeting is live on this computer, none of them while locked or
   * signed out.
   */
  const meetKeys = new MeetKeys({
    register: (acc, fn) => globalShortcut.register(acc, fn),
    unregister: (acc) => globalShortcut.unregister(acc),
    state: () => ({
      signedIn: root.sessionCtl.isReady(),
      locked: root.lock.isLocked(),
      meet: canOpenApp('meet', root.sessionCtl.visibleApps()),
      inCall: !!root.liveMeetWindow(),
      globalKeys: root.settings.effective().meetBehaviour?.globalKeys !== false,
    }),
    accelerators: () => {
      const defaults = meetShortcutDefaults(process.platform === 'darwin');
      const overrides = root.settings.effective().shortcuts ?? {};

      return Object.fromEntries(MEET_GLOBAL_IDS.map((id) => [id, overrides[id] ?? defaults[id]!])) as Partial<Record<MeetGlobalKey, string>>;
    },
    press: (id) => root.meetAction(id, 'shortcut'),
    warn: (message, detail) => root.log.warn(message, detail),
  });
  /*
   * What the tray shows for Meet (D04): the next meeting to join, and whether
   * this computer is in one. Polled in the main process because the tray is
   * read with every window closed — the same `GET /api/meet/upcoming` the Meet
   * home asks, and the same idea of "joinable", so the two never disagree.
   */
  const meetNext = new MeetNext({
    get: (path, query) => root.http.get(path, { query }),
    allowed: () => root.sessionCtl.isReady() && !root.lock.isLocked() && canOpenApp('meet', root.sessionCtl.visibleApps()),
    inCall: () => !!root.liveMeetWindow(),
    onChange: (meet) => root.tray.update({ meet, shortcutLabels: meetKeyLabels() }),
  });
  /** Each Meet key as a menu shows it, so a tray line can carry its shortcut without registering it. */
  const meetKeyLabels = (): Record<string, string> => {
    const defaults = meetShortcutDefaults(process.platform === 'darwin');
    const overrides = root.settings.effective().shortcuts ?? {};

    return Object.fromEntries(
      Object.keys(defaults)
        .map((id) => [id, electronAccelerator(overrides[id] ?? defaults[id])])
        .filter((pair): pair is [string, string] => typeof pair[1] === 'string'),
    );
  };
  // A meeting starting or ending decides whether mute and camera are held.
  root.calls.onListChanged = ((previous) => (list: ActiveCall[]) => {
    previous(list);
    meetKeys.sync();
    // In or out of a meeting changes both the keys held and the tray's lines.
    meetNext.publish();
    meetNext.poke();
  })(root.calls.onListChanged);
  root.settings.onChange(() => {
    meetKeys.sync();
    meetNext.publish();
  });
  const callbackReminders = new CallbackReminders({
    get: (path, query) => root.http.get(path, { query }),
    notify: (n) => root.notifications.notify(n),
    allowed: marketingVisible,
  });
  root.notifications.snoozeCallback = (c) => callbackReminders.snooze(c);
  const syncQuickAsk = (): void => {
    root.quickAsk.sync();
    root.tray.update({ quickAsk: root.quickAsk.shortcut() });
    // Support's quick-reply shortcut follows the same moments: sign-in, the lock, the settings.
    root.syncSupportKeys();
  };
  return { callbackReminders, marketingPulse, meetKeys, meetNext, nextContactKey, syncQuickAsk };
}
