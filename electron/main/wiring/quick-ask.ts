import { AiService } from '../../services/ai';
import { AiPendingWatcher } from '../../services/ai-pending';
import type { HttpClient } from '../../services/http';
import type { LockService } from '../../services/lock';
import type { NotificationService } from '../../services/notifications';
import { QuickAsk } from '../../services/quick-ask';
import { createInjector, type Injector } from '../../services/remote-control/input';
import type { SettingsService } from '../../services/settings';
import type { DriveSync } from '../../services/sync/engine';
import type { TrayService } from '../../tray/tray';
import type { WindowManager } from '../../windows/manager';
import type { SessionController } from '../session';
import { clipboard, globalShortcut, systemPreferences } from 'electron';
import * as fsp from 'node:fs/promises';

/**
 * Quick Ask over any app (AI Assistant): the AI service, pending answers and the Quick Ask window. Moved out of the
 * composition root (electron/main/index.ts) unchanged (audit D-G13).
 */
/** What wireQuickAsk reads from the composition root (electron/main/index.ts), live: getters, so a value set later is seen. */
export interface WireQuickAskDeps {
  askHelper: Promise<Injector | null> | null;
  readonly globalKeysOn: () => boolean;
  readonly http: HttpClient;
  readonly lock: LockService;
  readonly notifications: NotificationService;
  readonly sessionCtl: SessionController;
  readonly settings: SettingsService;
  readonly sync: DriveSync;
  readonly tray: TrayService;
  readonly windows: WindowManager;
}

export function wireQuickAsk(root: WireQuickAskDeps) {
  const quickAskHelper = (): Promise<Injector | null> => {
    if (process.platform === 'darwin' && !systemPreferences.isTrustedAccessibilityClient(false)) return Promise.resolve(null);
    root.askHelper ??= (async () => {
      const inj = createInjector(process.platform);
      if (!inj) return null;
      const ok = await inj.start().catch(() => false);
      if (!ok) {
        root.askHelper = null;
        return null;
      }
      inj.onExit = () => {
        root.askHelper = null;
      };
      return inj;
    })();
    return root.askHelper;
  };
  // The assistant's rules here (the device policy and the company's), confirming, local files (DSK-2…7).
  const ai = new AiService({
    get: (path, query) => root.http.get(path, { query }),
    post: (path, body) => root.http.post(path, body, { timeoutMs: 120_000 }),
    postStream: (path, body) => root.http.postStream(path, body, { timeoutMs: 180_000 }),
    policy: () => (root.sessionCtl.isReady() ? (root.sessionCtl.current()?.policy ?? null) : null),
    driveIdAt: (p) => root.sync.fileIdAt(p),
    realpath: (p) => fsp.realpath(p),
    size: async (p) => (await fsp.stat(p)).size,
    read: (p) => fsp.readFile(p),
  });
  const quickAsk: QuickAsk = new QuickAsk({
    clipboard,
    platform: process.platform,
    injector: quickAskHelper,
    // Insert only where the company and this computer's policy both allow it.
    prefs: () => ({ ...root.settings.effective().ai, insert: root.settings.effective().ai.insert && ai.rules().insert }),
    allowed: () => {
      const b = root.sessionCtl.isReady() && !root.lock.isLocked() ? root.sessionCtl.current() : null;
      const may = !!b && (b.permissions.includes('*') || b.permissions.includes('ai.write') || b.permissions.includes('ai.assistant.use'));
      return may && ai.rules().quickAsk && root.globalKeysOn();
    },
    register: (acc, fn) => globalShortcut.register(acc, fn),
    unregister: (acc) => globalShortcut.unregister(acc),
    show: () => root.windows.showQuickAsk(),
    hide: () => root.windows.hideQuickAsk(),
  });
  const aiPending = new AiPendingWatcher({
    get: (path, query) => root.http.get(path, { query }),
    notify: (n) => root.notifications.notify(n),
    enabled: () => ai.rules().enabled && !root.lock.isLocked(),
    onCount: (n) => root.tray.update({ aiChanges: n }),
  });
  return { ai, aiPending, quickAsk };
}
