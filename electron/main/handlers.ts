import { verifyLockChange } from '../services/lock-verification';
import { app, BrowserWindow, clipboard, dialog, nativeImage, shell, systemPreferences, type WebContents } from 'electron';
import { readFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { writeAtomically } from '../services/pdf/host';
import os from 'node:os';
import { writeFile } from 'node:fs/promises';
import { canOpenApp, notificationAllowed } from '@shared/access';
import { tabRecordSchema, type TabRecord } from '@shared/ipc/contract';
import { garageDocPath } from '@shared/garage-docs';
import { safeFileName } from '@shared/filename';
import type { AppInfo, BusyReport, DetachedWindow, SyncPolicy } from '@shared/types';
import { assertRoute, assertWebPath } from './access';
import { windowRoute } from '../windows/manager';
import { attachmentRisk } from '@shared/attachments';
import { DesktopError, isDesktopError } from './errors';
import { saveLauncherDefaults } from '../services/launcher-defaults';
import type { AppContext } from './context';
import type { IpcRouter } from '../ipc/router';
import { applyAutostart } from './autostart';
import { writeBootConfig } from './boot';
import { paths } from './paths';
import { archName, platformName } from '../services/device';
import { listPrinters, printHtml, printToPdf } from '../services/print';
import { pmsDownload } from '../services/pms-download';
import { accessibility } from '../services/remote-control/host';
import { stopProbes } from '../services/remote-control/accessibility';
import { restartForAccessibility } from '../services/remote-control/accessibility-watch';
import { createZip } from '../services/zip';
import { openExternalSafely } from '../security/hardening';
import { answerNotice } from '../services/ai-pending';
import { broadcast } from './events';
import { logger } from './log';

/** The web app's pages `auth:openPage` may open, signed out. */
const AUTH_PAGES = { 'forgot-password': '/forgot-password', account: '/account/settings' } as const;

/** The chat attachment menu's kinds of file, as open-dialog filters. */
const PICK_FILTERS: Record<'gif' | 'document' | 'image' | 'video' | 'audio', Electron.FileFilter> = {
  gif: { name: 'GIF images', extensions: ['gif'] },
  document: { name: 'Documents', extensions: ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'csv', 'ppt', 'pptx', 'odt', 'ods', 'odp', 'rtf', 'txt', 'md', 'pages', 'numbers', 'key'] },
  image: { name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'heic', 'heif', 'bmp', 'tif', 'tiff', 'svg'] },
  video: { name: 'Videos', extensions: ['mp4', 'mov', 'webm', 'm4v', 'mkv', 'avi'] },
  audio: { name: 'Audio', extensions: ['mp3', 'wav', 'ogg', 'oga', 'm4a', 'aac', 'flac', 'opus'] },
};

/**
 * The implementation behind every IPC channel. Validation, sender checks,
 * lock, session, permission and rate limits have already been applied by the
 * router; handlers deal only with the action itself.
 */
export function registerHandlers(router: IpcRouter, ctx: AppContext): void {
  const uid = (): string => {
    const id = ctx.session.userId();
    if (!id) throw new DesktopError('NOT_SIGNED_IN', 'Sign in to WorkSuite first.');
    return id;
  };
  const winOf = (sender: Electron.WebContents) => BrowserWindow.fromWebContents(sender);

  // ── app ────────────────────────────────────────────────────────────────
  router.handle('app:info', (): AppInfo => ({
    version: app.getVersion(),
    platform: platformName(),
    arch: archName(),
    osVersion: `${os.type()} ${os.release()}`,
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
    channel: ctx.settings.effective().updateChannel,
    safeMode: ctx.boot.safeMode,
    isPackaged: app.isPackaged,
    locale: app.getLocale(),
    restoredFromCrash: ctx.boot.uncleanExit,
  }));
  router.handle('app:quit', () => ctx.quit());
  router.handle('app:relaunch', () => ctx.relaunch(false));
  router.handle('app:openExternal', (input, c) => {
    // A page of this server is the browser as a way round too: the same rule as app:openInBrowser.
    const origin = ctx.auth.getServer()?.origin;
    const u = URL.canParse(input.url) ? new URL(input.url) : null;
    if (origin && u && u.origin === origin) assertWebPath(`${u.pathname}${u.search}`, ctx.session.visibleApps());
    return openExternalSafely(input.url, winOf(c.sender));
  });
  router.handle('app:setDockIcon', (input) => {
    // An unsigned build is never registered for notifications, so macOS will not draw
    // its Dock badge; the count is painted onto the icon instead (FR-TRAY-07).
    if (process.platform !== 'darwin' || !app.dock) return false;
    const img = nativeImage.createFromDataURL(input.png);
    if (img.isEmpty()) return false;
    app.dock.setIcon(img);
    return true;
  });
  router.handle('app:openInBrowser', async (input, c) => {
    const origin = ctx.auth.getServer()?.origin;
    if (!origin) throw new DesktopError('NOT_SIGNED_IN', 'No WorkSuite server is configured.');
    // Never the browser as a way round: a page of an app the person was not given stays shut.
    assertWebPath(input.path, ctx.session.visibleApps());
    return openExternalSafely(`${origin}${input.path}`, winOf(c.sender));
  });

  // An item link opened from an email, a chat or another program (#170): the audit trail says which item, which
  // action and where from — the server's copy is what an administrator reads.
  router.handle('links:audit', async (input) => {
    ctx.audit.record(ctx.session.userId(), 'desktop.link.opened', { org_id: input.org, item_type: input.type, item_id: input.id, action: input.action, source: input.source, outcome: input.outcome });
    void ctx.audit.flush();
  });

  // ── auth / session ─────────────────────────────────────────────────────
  router.handle('auth:state', () => ctx.session.get());
  router.handle('auth:setServer', async (input) => {
    if (input.url === '') return ctx.session.forgetServer();
    const before = ctx.auth.getServer()?.origin ?? null;
    const state = await ctx.session.setServer(input.url);
    // The CSP names the server (its media links); a new one takes a reload.
    if ((ctx.auth.getServer()?.origin ?? null) !== before) setTimeout(() => ctx.windows.reloadAll(), 50);
    return state;
  });
  router.handle('media:access', async (input) => {
    // macOS asks the person once per app; elsewhere the OS has no such gate.
    if (process.platform !== 'darwin' || (!app.isPackaged && process.env.WS_E2E_FAKE_MEDIA)) return { granted: true };
    const kind = input.kind === 'camera' ? 'camera' : 'microphone';
    if (systemPreferences.getMediaAccessStatus(kind) === 'granted') return { granted: true };
    return { granted: await systemPreferences.askForMediaAccess(kind) };
  });
  router.handle('media:screenIndicator', (input, c) => ctx.screenShare.indicate(c.sender.id, input.active));
  router.handle('media:screenSources', () => ctx.screenShare.sources());
  router.handle('media:screenPick', (input, c) => ctx.screenShare.preparePick(c.sender.id, input.id, !!input.audio));
  router.handle('media:privacySettings', async (input) => {
    // Fixed addresses of the OS's own privacy panes; nothing from the page.
    const mac = { microphone: 'Privacy_Microphone', camera: 'Privacy_Camera', screen: 'Privacy_ScreenCapture', accessibility: 'Privacy_Accessibility' } as const;
    const win = { microphone: 'privacy-microphone', camera: 'privacy-webcam', screen: 'privacy', accessibility: 'privacy' } as const;
    if (process.platform === 'darwin' && input.pane === 'accessibility') accessibility.openedSettings();
    if (process.platform === 'darwin') await shell.openExternal(`x-apple.systempreferences:com.apple.preference.security?${mac[input.pane]}`);
    else if (process.platform === 'win32') await shell.openExternal(`ms-settings:${win[input.pane]}`);
  });
  router.handle('calls:active', (input, c) => {
    const w = winOf(c.sender);
    if (w) ctx.calls.setActive(w, input.uuid, { kind: input.kind ?? 'call', title: input.title ?? '' });
  });
  router.handle('calls:list', () => ctx.calls.list());

  // ── Meet remote control (WS-MEET-ENH-01) ──────────────────────────────
  // Each call is taken only from the window it belongs to: the meeting
  // window for its share, the consent window for its request, the control
  // bar for resuming.
  const kindOf = (sender: Electron.WebContents) => ctx.windows.kindOf(winOf(sender)?.id ?? -1);
  const fromMeeting = (sender: Electron.WebContents) => {
    if (kindOf(sender) !== 'meet') throw new DesktopError('IPC_FORBIDDEN_SENDER', 'Only a meeting window shares.');
  };
  const rc = ctx.remoteControl;
  router.handle('rc:state', () => rc.view());
  router.handle('rc:recheck', async () => {
    // A new question to the app and to its input helper each time, never an earlier answer (worksuite-desktop#147).
    await accessibility.refresh();
    return rc.view();
  });
  router.handle('rc:restart', async () => {
    if (process.platform !== 'darwin') throw new DesktopError('UNSUPPORTED', 'Restarting for Accessibility is only needed on macOS.');
    await restartForAccessibility({ stopControl: () => rc.shutdown('stopped'), stopProbes, relaunch: (safe, args) => ctx.relaunch(safe, args) });
  });
  router.handle('rc:setAllowRequests', (input) => rc.setAllowRequests(input.value));
  router.handle('rc:shareStarted', async (input, c) => {
    fromMeeting(c.sender);
    const granted = ctx.screenShare.lastGranted(c.sender.id);
    // Only a capture granted in the last minute is this share's.
    const source = granted && Date.now() - granted.source.at < 60_000 ? granted.source : null;
    return rc.shareStarted(c.sender.id, input, source);
  });
  router.handle('rc:shareChanged', async (_input, c) => {
    fromMeeting(c.sender);
    const granted = ctx.screenShare.lastGranted(c.sender.id);
    await rc.shareChanged(c.sender.id, granted?.source ?? null, granted?.byController ?? false);
  });
  router.handle('rc:shareStopped', async (_input, c) => {
    fromMeeting(c.sender);
    await rc.shareStopped(c.sender.id);
  });
  router.handle('rc:sharePaused', async (input, c) => {
    fromMeeting(c.sender);
    await rc.sharePaused(c.sender.id, input.paused);
  });
  router.handle('rc:packet', (input, c) => rc.packet(c.sender.id, input.sender, input.data, input.topic));
  router.handle('rc:consent', (_input, c) => rc.consent(c.sender.id, ctx.lock.isLocked()));
  router.handle('rc:answer', (input, c) => rc.answer(c.sender.id, input, ctx.lock.isLocked()));
  router.handle('rc:pause', (input) => rc.pause(input.sessionId, 'sharer'));
  router.handle('rc:resume', (input, c) => rc.resume(c.sender.id, input.sessionId));
  router.handle('rc:fileAnswer', (input, c) => rc.answerFile(c.sender.id, input, ctx.lock.isLocked()));
  router.handle('rc:sendFile', (input, c) => rc.sendFile(c.sender.id, input.sessionId));
  router.handle('rc:takeFile', (input, c) => {
    fromMeeting(c.sender);
    return rc.takeFile(input, ctx.lock.isLocked());
  });
  router.handle('rc:stop', async (input) => {
    if (input.sessionId) await rc.stop(input.sessionId, 'stopped');
    else await rc.stopAll('stopped');
  });
  router.handle('calls:focus', (input) => {
    const w = ctx.windows.all().find((x) => x.id === input.windowId);
    if (!w || !ctx.calls.has(w.id)) return false;
    // Back from the floating card to the full window, and in front.
    if (ctx.windows.isCompact(w)) ctx.windows.setCompact(w, false);
    if (w.isMinimized()) w.restore();
    w.show();
    w.focus();
    return true;
  });
  router.handle('auth:signIn', (input) => ctx.session.signIn(input.email, input.password));
  router.handle('auth:verifyMfa', (input) => ctx.session.verifyMfa(input.code));
  router.handle('auth:cancelMfa', () => ctx.session.cancelMfa());
  router.handle('auth:passkeyStart', async () => {
    const url = ctx.session.startPasskey(os.hostname());
    const origin = ctx.auth.getServer()?.origin;
    // Always a page on the configured server — whose address was vetted when it
    // was chosen — so it opens without the generic external-link prompt.
    if (!origin || new URL(url).origin !== origin) {
      ctx.session.cancelPasskey();
      throw new DesktopError('UNSUPPORTED', 'Passkey sign-in could not be opened.');
    }
    try {
      // Unpackaged test runs record the page instead of opening a real browser.
      if (!app.isPackaged && process.env.WS_E2E_EXTERNAL_LOG) await writeFile(process.env.WS_E2E_EXTERNAL_LOG, `${url}\n`, { flag: 'a' });
      else await shell.openExternal(url);
    } catch {
      ctx.session.cancelPasskey();
      throw new DesktopError('UNSUPPORTED', 'Your browser could not be opened. Sign in with your password instead.');
    }
    return ctx.session.get();
  });
  router.handle('auth:passkeyCancel', () => ctx.session.cancelPasskey());
  router.handle('auth:openPage', async (input, c) => {
    const origin = ctx.auth.getServer()?.origin;
    if (!origin) throw new DesktopError('NOT_SIGNED_IN', 'Choose your WorkSuite server first.');
    return openExternalSafely(`${origin}${AUTH_PAGES[input.page]}`, winOf(c.sender));
  });

  // ── HR ────────────────────────────────────────────────────────────────
  router.handle('hr:clock', async (input) => {
    await ctx.clockAttendance(input.direction, { note: input.note, workLocation: input.workLocation, geoNote: input.geoNote, noteType: input.noteType });
    return { ok: true } as const;
  });
  router.handle('hr:break', async (input) => {
    await ctx.attendanceBreak(input.action);
    return { ok: true } as const;
  });
  router.handle('auth:signOut', (input) => ctx.session.signOut(!!input?.wipe));
  router.handle('auth:completeSetup', () => ctx.session.completeSetup());
  router.handle('auth:sessionId', () => ({ sid: ctx.auth.sessionId() }));
  router.handle('auth:changePassword', async (input) => {
    const email = ctx.bootstrap.get()?.user.email;
    if (!email) throw new DesktopError('NOT_SIGNED_IN', 'Sign in first.');
    // A token about to expire is renewed first: once refreshes are held, nothing could renew it.
    if (!ctx.auth.accessToken() && (await ctx.auth.refresh()) !== 'ok') throw new DesktopError('SESSION_EXPIRED', 'Sign in again first.');
    ctx.auth.hold();
    try {
      await ctx.http.post('/api/auth/password', { current_password: input.current, new_password: input.next });
    } catch (e) {
      // Refused (wrong current password, a rule not met): nothing changed, the session with it.
      ctx.auth.release('ok');
      throw e;
    }
    try {
      return { outcome: await ctx.auth.renew(email, input.next) };
    } catch (e) {
      // Changed, but not signed in again: the old session is gone, so the app asks for the new password.
      logger('auth').info('could not sign in again after the password change', { code: isDesktopError(e) ? e.code : 'INTERNAL' });
      ctx.auth.release('lost');
      return { outcome: 'later' as const };
    }
  });
  router.handle('auth:renewMfa', async (input) => {
    if (!ctx.auth.isHeld()) throw new DesktopError('MFA_INVALID', 'That sign-in expired. Sign in again with your new password.');
    await ctx.auth.renewMfa(input.code);
    return { renewed: true as const };
  });
  router.handle('auth:renewCancel', () => {
    ctx.auth.release('lost');
  });

  router.handle('session:bootstrap', (_i, c) => {
    if (winOf(c.sender) === ctx.windows.getMain()) setTimeout(() => ctx.flushNavigation(), 300);
    return ctx.session.current();
  });
  router.handle('session:refresh', () => ctx.session.refreshBootstrap());
  router.handle('session:switchOrganization', async (input) => {
    const organizationId = await ctx.session.switchOrganization(input.organizationId);
    broadcast('organization:changed', { organizationId });
    return { organizationId, closedTabs: 0 };
  });

  // ── windows ────────────────────────────────────────────────────────────
  router.handle('windows:open', (input) => {
    assertRoute(input.route, ctx.session.visibleApps());
    const w = ctx.windows.open(input.kind, input.route, input.title, input.alwaysOnTop);
    return { id: w.id };
  });
  router.handle('windows:setAlwaysOnTop', (input, c) => {
    const w = winOf(c.sender);
    return w ? ctx.windows.setAlwaysOnTop(w, input.value) : false;
  });
  router.handle('windows:setCompact', (input, c) => {
    const w = winOf(c.sender);
    return w ? ctx.windows.setCompact(w, input.value, input.shape ?? 'bar') : false;
  });
  router.handle('windows:fitVideo', (_i, c) => {
    const w = winOf(c.sender);
    return w ? ctx.windows.fitVideo(w) : false;
  });
  router.handle('windows:minimize', (_i, c) => {
    winOf(c.sender)?.minimize();
  });
  router.handle('windows:toggleMaximize', (_i, c) => {
    const w = winOf(c.sender);
    if (!w) return false;
    if (w.isMaximized()) w.unmaximize();
    else w.maximize();
    return w.isMaximized();
  });
  router.handle('windows:close', (_i, c) => {
    winOf(c.sender)?.close();
  });
  // ── Quick Ask (AI Assistant) ────────────────────────────────────────────
  router.handle('quickask:context', () => ({ ...ctx.quickAsk.context(), shortcut: ctx.quickAsk.shortcut() }));
  router.handle('quickask:open', () => void ctx.quickAsk.open());
  router.handle('quickask:insert', (input) => ctx.quickAsk.insert(input.text));
  router.handle('quickask:close', () => ctx.windows.hideQuickAsk());
  // "Open in WorkSuite", "Make a task", "Ask WorkSuite": the main window takes the text (and any result) over.
  router.handle('quickask:handoff', (input) => {
    ctx.windows.hideQuickAsk();
    const w = ctx.windows.showMain();
    w.webContents.send('ai:open', { to: input.to, text: input.text, result: input.result });
  });

  // ── the assistant (WS-AI-SRS-001 DSK-3, DSK-5…7) ────────────────────────
  router.handle('ai:rules', (input) => (input?.refresh ? ctx.ai.refresh() : ctx.ai.rules()));
  // A proposal is confirmed from the main window only: never from Quick Ask, never from a
  // notification (which can only open the main window), and never through the page's API proxy.
  router.handle('ai:confirm', (input, c) => {
    if (winOf(c.sender) !== ctx.windows.getMain()) throw new DesktopError('IPC_FORBIDDEN_SENDER', 'A change the assistant proposed is confirmed in the main window.');
    return ctx.ai.confirm(input.id, input.nonce);
  });
  // A file from this computer, picked here: never a path the page names.
  // An answer ready while the window is behind others (#126): a banner, as the notification settings allow; none in front.
  router.handle('ai:answerReady', (input) => {
    const main = ctx.windows.getMain();
    if (main && main.isFocused()) return false;
    ctx.notifications.notify(answerNotice(input.kind, input.preview));
    return true;
  });
  router.handle('ai:upload', async (_i, c) => {
    const w = winOf(c.sender);
    if (!ctx.ai.rules().localFiles) throw new DesktopError('POLICY_DENIED', 'Files from this computer cannot be sent to the assistant here.');
    const opts: Electron.OpenDialogOptions = { title: 'Choose a file to ask about', properties: ['openFile'] };
    const res = w ? await dialog.showOpenDialog(w, opts) : await dialog.showOpenDialog(opts);
    if (res.canceled || !res.filePaths[0]) return null;
    return ctx.ai.upload(res.filePaths[0]);
  });

  // ── website chats ringing (ENH-WCHAT-01, RING-49) ───────────────────────
  router.handle('ring:state', () => ctx.webchat.state());
  router.handle('ring:join', (input) => ctx.webchat.join(input.id, input.then));
  router.handle('ring:silence', (input) => ctx.webchat.silence(input.id, input.on));
  router.handle('ring:pass', (input) => ctx.webchat.pass(input.id));
  router.handle('ring:joinSend', (input) => ctx.webchat.joinAndSend(input.id, input.message ?? null, { ...(input.open ? { open: true } : {}), ...(input.cannedId ? { cannedId: input.cannedId } : {}) }));
  router.handle('ring:draft', (input) => ctx.webchat.setDraft(input.id, input.text));
  router.handle('ring:reply', (input) => ctx.webchat.replyJoined(input.message));
  router.handle('ring:closeJoined', (input) => ctx.webchat.closeJoined(input.open));
  router.handle('ring:minimise', () => ctx.webchat.minimise());
  router.handle('ring:fit', (input) => ctx.webchat.fit(input.height));
  router.handle('ring:openInbox', () => ctx.webchat.openInbox());
  router.handle('ring:outcome', (input) => ctx.webchat.outcomeAction(input.action));
  // The tray's ringing menu (R-06): its height, and Open Website Chats, Ringing settings…, Quit WorkSuite.
  router.handle('ring:trayFit', (input) => ctx.ringTray.fit(input.height));
  router.handle('ring:tray', (input) => ctx.ringTray.act(input.action));
  // A visitor who wrote again in my chat (#230): the card's actions, and which conversation the main window shows.
  router.handle('ring:followUp', (input) => ctx.webchat.followUp(input.id, input.action, input.message));
  router.handle('ring:viewing', (input) => ctx.webchat.setViewing(input.id));
  router.handle('ring:handoff', (input) => ctx.webchat.answer(input.id, input.accept));
  router.handle('ring:call', (input) => ctx.webchat.answerCall(input.id, input.accept));
  router.handle('ring:mic', (input) => ctx.webchat.setMic(input.has, input.label ?? null, input.headset ?? false));
  router.handle('ring:onCall', (input) => ctx.webchatOnCall(input));

  // ── multi-window docking (FR-NAV-05/07) ─────────────────────────────────
  const fromMain = (sender: WebContents) => {
    if (winOf(sender) !== ctx.windows.getMain()) throw new DesktopError('IPC_FORBIDDEN_SENDER', 'Tabs are torn off and docked from the main window.');
  };
  // A tab torn off the main window: its own window, where the tab was let go.
  router.handle('windows:detach', (input, c) => {
    fromMain(c.sender);
    const w = ctx.windows.open('record', input.route, input.title, false, { at: input.at });
    return { id: w.id };
  });
  // "Dock to main window" in a torn-off window: it closes and comes back as a tab. What it shows is
  // the window's own record here, never what the page says.
  router.handle('windows:dock', (input, c) => {
    const w = winOf(c.sender);
    const r = w ? ctx.windows.recordOf(w.id) : null;
    if (!w || !r) throw new DesktopError('IPC_FORBIDDEN_SENDER', 'Only a torn-off window docks.');
    ctx.navigate({ route: r.route, title: r.title || undefined, side: !!input?.side, source: 'dock' });
    w.close();
  });
  // "Open in Main App" (#103): the main window opens what a secondary window shows — its own route, read from
  // the window's address, never from the page — and the secondary window closes unless asked to stay.
  router.handle('windows:toMain', (input, c) => {
    const w = winOf(c.sender);
    const route = w ? windowRoute(w.webContents.getURL()) : null;
    if (!w || !route || w === ctx.windows.getMain()) throw new DesktopError('IPC_FORBIDDEN_SENDER', 'Only a secondary window opens in the main app.');
    ctx.navigate({ route, source: 'window' });
    if (!input?.keep) w.close();
  });
  // A torn-off window dragged onto the main window's tabs: the main window takes it in.
  router.handle('windows:adopt', (input, c) => {
    fromMain(c.sender);
    const r = ctx.windows.recordOf(input.windowId);
    const w = r ? BrowserWindow.fromId(input.windowId) : null;
    if (!r || !w || w.isDestroyed()) return null;
    w.close();
    return r;
  });
  router.handle('windows:describe', (input, c) => {
    const w = winOf(c.sender);
    if (w) ctx.windows.describe(w, input.route, input.title);
  });
  // At start, the torn-off windows open again where they were (with tab restore, and never in Safe Mode).
  router.handle('windows:restoreDetached', (_i, c) => {
    fromMain(c.sender);
    const prefs = ctx.settings.effective();
    // After an update's restart the same windows come back, whatever Settings says (#205); never in Safe Mode.
    const afterUpdate = ctx.updater.takeSessionRestore();
    if ((!prefs.restoreTabs && !afterUpdate) || ctx.boot.safeMode || ctx.windows.detached().length) return 0;
    const row = ctx.db.get<{ payload: string }>('SELECT payload FROM tab_sessions WHERE user_id = ? AND window = ?', uid(), 'detached');
    const saved = row ? (ctx.vault().decrypt<{ windows: DetachedWindow[] }>(row.payload)?.windows ?? []) : [];
    let n = 0;
    for (const d of saved.slice(0, 12)) {
      if (!tabRecordSchema.shape.route.safeParse(d?.route).success) continue;
      const b = d.bounds;
      const bounds = b && [b.x, b.y, b.width, b.height].every(Number.isFinite) ? b : undefined;
      ctx.windows.open('record', d.route, typeof d.title === 'string' && d.title ? d.title.slice(0, 200) : undefined, false, { bounds });
      n++;
    }
    return n;
  });

  router.handle('windows:state', (_i, c) => {
    const w = winOf(c.sender);
    return {
      id: w?.id ?? 0,
      kind: w ? (ctx.windows.kindOf(w.id) ?? 'main') : 'main',
      maximized: !!w?.isMaximized(),
      alwaysOnTop: !!w?.isAlwaysOnTop(),
      platform: process.platform,
      compact: w ? ctx.windows.isCompact(w) : false,
      fullScreen: !!w?.isFullScreen(),
    };
  });

  // ── tabs (FR-NAV-04) ───────────────────────────────────────────────────
  router.handle('tabs:save', (input) => {
    ctx.db.run(
      'INSERT INTO tab_sessions (user_id, window, payload, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(user_id, window) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at',
      uid(),
      'main',
      ctx.vault().encrypt({ tabs: input.tabs, activeId: input.activeId, side: input.side ?? null }),
      new Date().toISOString(),
    );
  });
  router.handle('tabs:restore', () => {
    const prefs = ctx.settings.effective();
    if ((!prefs.restoreTabs && !ctx.updater.sessionRestorePending()) || ctx.boot.safeMode) return { tabs: [], activeId: null, side: null, restored: false };
    const row = ctx.db.get<{ payload: string }>('SELECT payload FROM tab_sessions WHERE user_id = ? AND window = ?', uid(), 'main');
    const v = row ? ctx.vault().decrypt<{ tabs: TabRecord[]; activeId: string | null; side?: { id: string; split: number } | null }>(row.payload) : undefined;
    return { tabs: v?.tabs ?? [], activeId: v?.activeId ?? null, side: v?.side ?? null, restored: !!v };
  });

  // ── files & transfers ──────────────────────────────────────────────────
  router.handle('files:pickFiles', async (input, c) => {
    const w = winOf(c.sender);
    const opts: Electron.OpenDialogOptions = {
      title: input.title ?? 'Choose files',
      properties: input.multiple ? ['openFile', 'multiSelections'] : ['openFile'],
      ...(input.only ? { filters: [PICK_FILTERS[input.only]] } : {}),
    };
    const res = w ? await dialog.showOpenDialog(w, opts) : await dialog.showOpenDialog(opts);
    if (res.canceled) return [];
    return ctx.transfers.register(res.filePaths);
  });
  router.handle('files:pickFolder', async (input, c) => {
    const w = winOf(c.sender);
    const opts: Electron.OpenDialogOptions = { title: input.title ?? 'Choose a folder to upload', properties: ['openDirectory'] };
    const res = w ? await dialog.showOpenDialog(w, opts) : await dialog.showOpenDialog(opts);
    if (res.canceled || !res.filePaths[0]) return [];
    return ctx.transfers.register(res.filePaths);
  });
  // Meetings recorded on this computer (worksuite-desktop#68).
  router.handle('meetrec:preflight', () => ctx.meetRecorder.preflight());
  router.handle('meetrec:start', (input) => ctx.meetRecorder.start(input));
  router.handle('meetrec:chunk', (input) => ctx.meetRecorder.chunk(input.id, input.data));
  router.handle('meetrec:active', (input) => ctx.meetRecorder.active(input.id));
  router.handle('meetrec:abort', (input) => ctx.meetRecorder.abort(input.id));
  router.handle('meetrec:stop', (input) => ctx.meetRecorder.stop(input.id, input.durationMs));
  router.handle('meetrec:list', () => ctx.meetRecorder.list());
  router.handle('meetrec:retry', (input) => ctx.meetRecorder.retry(input.id));
  router.handle('meetrec:discard', (input) => ctx.meetRecorder.discard(input.id));
  router.handle('meetrec:reveal', (input) => ctx.meetRecorder.reveal(input.id));
  router.handle('meetrec:open', (input) => ctx.meetRecorder.openLocal(input.id));
  router.handle('meetrec:downloads', () => ctx.meetRecorder.downloads());
  router.handle('meetrec:chooseFolder', async (_i, c) => {
    const w = winOf(c.sender);
    const opts: Electron.OpenDialogOptions = { title: 'Choose where meeting recordings are saved', defaultPath: ctx.settings.effective().meetRecording.localFolder, properties: ['openDirectory', 'createDirectory'] };
    const res = w ? await dialog.showOpenDialog(w, opts) : await dialog.showOpenDialog(opts);
    if (res.canceled || !res.filePaths[0]) return null;
    ctx.settings.update({ meetRecording: { ...ctx.settings.effective().meetRecording, localFolder: res.filePaths[0] } });
    return res.filePaths[0];
  });
  // Speech to text on this computer (worksuite-desktop#81).
  router.handle('stt:status', () => ctx.speech.status());
  router.handle('stt:chooseModel', (_i, c) => ctx.speech.chooseModel(winOf(c.sender) ?? null));
  router.handle('stt:removeModel', () => ctx.speech.removeModel());
  router.handle('stt:transcribe', async (input) => ({ segments: await ctx.speech.transcribe(input.wav, input.language) }));
  router.handle('speech:ready', (input, c) => ctx.speech.onReady(c.sender.id, input));
  router.handle('speech:result', (input, c) => ctx.speech.onResult(c.sender.id, input));
  router.handle('files:chooseDownloadFolder', async (_i, c) => {
    const w = winOf(c.sender);
    const opts: Electron.OpenDialogOptions = { title: 'Choose where downloads are saved', defaultPath: ctx.settings.effective().downloadFolder, properties: ['openDirectory', 'createDirectory'] };
    const res = w ? await dialog.showOpenDialog(w, opts) : await dialog.showOpenDialog(opts);
    if (res.canceled || !res.filePaths[0]) return null;
    ctx.settings.update({ downloadFolder: res.filePaths[0] });
    return res.filePaths[0];
  });
  router.handle('files:saveText', async (input, c) => {
    const w = winOf(c.sender);
    const opts: Electron.SaveDialogOptions = { title: 'Save', defaultPath: `${ctx.settings.effective().downloadFolder}/${input.name}`, filters: [{ name: 'Text', extensions: ['txt'] }] };
    const res = w ? await dialog.showSaveDialog(w, opts) : await dialog.showSaveDialog(opts);
    if (res.canceled || !res.filePath) return null;
    await writeFile(res.filePath, input.text, { encoding: 'utf8', mode: 0o600 });
    return res.filePath;
  });
  router.handle('files:registerDropped', (input) => ctx.transfers.register(input.paths));
  router.handle('transfers:list', () => ctx.transfers.list());
  router.handle('transfers:download', async (input, c) => {
    // A mail attachment that runs as a program is never saved from a message; one with macros never opens elsewhere (ENH-MAIL-03 DMO-SEC-04).
    if (input.mail) {
      const risk = attachmentRisk(input.name);
      if (risk === 'blocked') throw new DesktopError('POLICY_DENIED', 'WorkSuite blocks this kind of attachment: it can run as a program on your computer.');
      if (risk === 'macro' && input.open) throw new DesktopError('POLICY_DENIED', 'Files with macros open only in WorkSuite, where macros do not run.');
    }
    // Drive › Settings › Ask where to save each time: the place comes from this process's own dialog, never the page.
    let saveAs: string | undefined;
    if (!input.open && ctx.settings.effective().drive.askWhereToSave) {
      const w = winOf(c.sender);
      const opts: Electron.SaveDialogOptions = { title: 'Save as', defaultPath: join(ctx.settings.effective().downloadFolder, safeFileName(input.name)) };
      const res = w ? await dialog.showSaveDialog(w, opts) : await dialog.showSaveDialog(opts);
      if (res.canceled || !res.filePath) throw new DesktopError('CANCELLED', 'The download was cancelled.');
      saveAs = res.filePath;
    }
    const download = (path: string, fileId: string | null) => (saveAs ? ctx.transfers.download(path, input.name, !!input.open, fileId, undefined, saveAs) : ctx.transfers.download(path, input.name, !!input.open, fileId));
    if (input.hrDocument) {
      // A one-time link, asked for at the moment of downloading (it expires).
      const base = input.hrEmployee ? `/api/hr/employees/${input.hrEmployee}/documents` : '/api/hr/me/documents';
      const link = await ctx.http.post<{ url: string }>(`${base}/${input.hrDocument}/link`, { disposition: 'attachment' });
      return download(`/${String(link.url).replace(/^\/+/, '')}`, null);
    }
    if (input.taskAttachment) {
      // The same for a task's attachment: a short-lived /d/{token} grant on our own server.
      const { task, id } = input.taskAttachment;
      const link = await ctx.http.post<{ url: string }>(`/api/tasks/${task}/attachments/${id}/link`, {});
      const grant = /\/d\/([A-Za-z0-9]{16,128})$/.exec(String(link.url ?? ''));
      if (!grant) throw new DesktopError('NOT_FOUND', 'The server did not give a download link for that attachment.');
      return download(`/d/${grant[1]}`, null);
    }
    const r = input.hrReport;
    const oc = input.ordersCsv;
    const rep = input.omsReport;
    const tl = input.tenderLine;
    const fc = input.financeCsv;
    const ef = input.expenseFile;
    const withOrg = (org?: number) => (org ? `?org=${org}` : '');
    const path = input.officeExport
      ? `/office/exports/${input.officeExport}`
      : input.elearningMedia
      ? `/media/${input.elearningMedia}?download=1`
      : input.chatMedia
      ? `/media/${input.chatMedia}?download=1`
      : input.chatExport
      ? `/api/chat/rooms/${input.chatExport.room}/export?${new URLSearchParams({ format: input.chatExport.format, media: input.chatExport.media ? '1' : '0' })}`
      : input.garageDoc
      ? garageDocPath(input.garageDoc)
      : ef
      ? ef.kind === 'claim-receipt'
        ? `/api/expense/claims2/${ef.claim}/receipt`
        : ef.kind === 'receipt'
          ? `/api/expense/receipts/${encodeURIComponent(ef.token)}`
          : ef.kind === 'sub-document'
            ? `/api/expense/subscriptions/${ef.sub}/documents/${ef.doc}`
            : ef.kind === 'run-csv'
              ? `/api/expense/runs/${ef.run}/csv${withOrg(ef.org)}`
              : ef.kind === 'posting'
                ? `/api/expense/postings/${ef.posting}/export${withOrg(ef.org)}`
                : `/api/expense/${ef.which === 'insights' ? 'reports2' : 'reports'}/export?${new URLSearchParams(ef.query)}`
      : fc
      ? `/api/finance/export/${fc.report}${fc.lines ? '/transactions' : ''}?${new URLSearchParams({ company: String(fc.company), from: fc.from, to: fc.to, ...(fc.currency ? { currency: fc.currency } : {}) })}`
      : input.orderPdf
      ? `/api/share/oms/${input.orderPdf}/pdf`
      : input.minutesExport
      ? `/api/meetings/${input.minutesExport.meeting}/minutes/export?format=${input.minutesExport.format}`
      : input.transcriptExport
      ? `/api/meetings/transcripts/${input.transcriptExport.id}/export?format=${input.transcriptExport.format}`
      : input.tenderDocument
      ? `/api/tenders/documents/${input.tenderDocument}/file`
      : tl
      ? `/api/tenders/checklist/${tl.line}/download${tl.version ? `?v=${tl.version}` : ''}`
      : input.tenderLetter
      ? `/api/tenders/${input.tenderLetter.tender}/letters/${input.tenderLetter.letter}/download`
      : input.tenderLibrary
      ? `/api/tender/library/${input.tenderLibrary}/file`
      : input.invoicePdf
      ? `/api/share/billing/${input.invoicePdf}/pdf`
      : input.paymentSlip
      ? `/api/billing/payments/${input.paymentSlip.payment}/slips/${input.paymentSlip.slip}`
      : rep
      ? `/api/oms/reports/${rep.report}?${new URLSearchParams({ from: rep.from, to: rep.to, format: 'csv', ...(rep.org ? { org: rep.org } : {}), ...(rep.report === 'sales' && rep.group ? { group: rep.group } : {}) })}`
      : oc
      ? `/api/oms/orders/export?${new URLSearchParams(Object.entries({ org: oc.org, status: oc.status, source: oc.source, priority: oc.priority, q: oc.q, mine: oc.mine ? '1' : undefined }).filter((e): e is [string, string] => !!e[1]))}`
      : input.picture
      ? `/api/users/me/pictures/${input.picture}/original`
      : input.hrLetter
      ? input.hrLetter === 'mine'
        ? '/api/hr/me/resignation/letter'
        : `/api/hr/resignations/${input.hrLetter}/letter`
      : r
      ? `/api/hr/reports/attendance?${new URLSearchParams({ type: r.type, from: r.from, to: r.to, format: 'csv', ...(r.department_id ? { department_id: String(r.department_id) } : {}), ...(r.employee_id ? { employee_id: String(r.employee_id) } : {}) })}`
      : input.payslip
      ? `/api/payroll/me/payslips/${encodeURIComponent(input.payslip)}/pdf`
      : input.mailSource
      ? `/api/mail/messages/${input.mailSource.uid}/source?${new URLSearchParams({ folder: input.mailSource.folder, download: '1', ...(input.mailSource.mailbox ? { mailbox: input.mailSource.mailbox } : {}) })}`
      : input.fileId
      ? `/api/files/${encodeURIComponent(input.fileId)}/download`
      : input.recording
        ? `/api/meet/recordings/${input.recording}/file`
        : input.export
          ? { calendar: '/api/calendar/export', 'contacts-csv': '/api/contacts/export?format=csv', 'contacts-vcf': '/api/contacts/export?format=vcf', 'contacts-template': '/api/data/contacts/template' }[input.export]
          : input.importErrors
            ? `/api/data/jobs/${input.importErrors}/errors`
          : input.version
            ? `/api/files/${input.version.fileId}/versions/${input.version.versionId}/download`
          : `/api/mail/messages/${input.mail!.uid}/attachments/${encodeURIComponent(input.mail!.ref)}?${new URLSearchParams({ folder: input.mail!.folder, dl: '1', ...(input.mail!.mailbox ? { mailbox: input.mail!.mailbox } : {}) })}`;
    const t = await download(path, input.fileId ?? null);
    // A Meet recording's download is shown on the recording itself, also after a restart (worksuite-desktop#89).
    const rec = input.recording ?? input.forRecording;
    if (rec) ctx.meetRecorder.rememberDownload(rec, t.id);
    return t;
  });
  // Hotel PMS files (shared/pms-files.ts): the address built here from what the page names; the organization's download
  // policy checked here too, not only by the channel and the screen, so a page cannot save around it.
  router.handle('pms:download', (input) =>
    pmsDownload({ mayDownload: () => ctx.session.hasPermission('desktop.downloads'), download: (path, name, open, fileId) => ctx.transfers.download(path, name, open, fileId) }, input),
  );
  // Office documents: the editor's view (office-editor.ts) and copies opened in other apps (office-external.ts).
  router.handle('office:open', (input, c) => ctx.office.open(c.sender, input));
  router.handle('office:place', (input, c) => ctx.office.place(c.sender, input.viewId, input.bounds, input.visible));
  router.handle('office:snapshot', (input, c) => ctx.office.snapshot(c.sender, input.viewId));
  router.handle('office:command', (input, c) => ctx.office.command(c.sender, input.viewId, input.command.type === 'start' && input.events ? { ...input.command, events: input.events } : input.command, input.sessionId));
  router.handle('office:close', (input, c) => ctx.office.close(c.sender, input.viewId));
  router.handle('office:focusFile', (input, c) => ctx.office.focusFile(c.sender, input.fileId));
  router.handle('office:externalApps', (input) => ctx.officeLocal.apps(input.extension));
  router.handle('office:openExternal', (input) => ctx.officeLocal.open(input));
  router.handle('office:localCopies', () => ctx.officeLocal.list());
  router.handle('office:uploadLocal', (input) => ctx.officeLocal.upload(input.id, input.how));
  router.handle('office:forgetLocal', (input) => ctx.officeLocal.forget(input.id));
  router.handle('office:revealLocal', (input) => {
    shell.showItemInFolder(ctx.officeLocal.pathOf(input.id));
    return true;
  });
  router.handle('office:localAvailable', (input) => {
    const at = ctx.officeLocal.localPath(input.fileId);
    return { available: !!at, synced: !!at?.synced, preview: !!at && process.platform === 'darwin', openInApp: !!at && ctx.session.hasPermission('desktop.files.open_external') };
  });
  // WorkSuite DOC / Sheet / Slides on files from this computer: the main process's own dialogs, handles to the page.
  router.handle('office:pickFile', async (_input, c) => {
    const win = BrowserWindow.fromWebContents(c.sender);
    const opts: Electron.OpenDialogOptions = { title: 'Open a document', filters: [{ name: 'Word, Excel and PowerPoint', extensions: ['docx', 'xlsx', 'pptx'] }], properties: ['openFile', 'multiSelections'] };
    const res = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts);
    if (res.canceled || !res.filePaths.length) return [];
    const { files, rejected } = await ctx.officeFiles.register(res.filePaths);
    if (!files.length && rejected.length) throw new DesktopError('IPC_VALIDATION_FAILED', rejected[0]!.reason);
    return files;
  });
  router.handle('office:readFile', (input) => ctx.officeFiles.read(input.handle));
  router.handle('office:readOffline', async (input) => {
    const at = ctx.officeLocal.localPath(input.fileId);
    if (!at) throw new DesktopError('NOT_FOUND', 'This file is not on this computer, so it cannot be edited offline.');
    return new Uint8Array(await readFile(at.path));
  });
  router.handle('office:writeOffline', async (input) => {
    const at = ctx.officeLocal.localPath(input.fileId);
    if (!at) throw new DesktopError('NOT_FOUND', 'This file is no longer on this computer.');
    await writeAtomically(at.path, input.bytes);
    return { size: input.bytes.byteLength, synced: at.synced };
  });
  router.handle('office:writeFile', (input) => ctx.officeFiles.write(input.handle, input.bytes, writeAtomically));
  router.handle('office:saveCopy', async (input, c) => {
    const win = BrowserWindow.fromWebContents(c.sender);
    const opts: Electron.SaveDialogOptions = { title: 'Save a copy', defaultPath: input.name };
    const res = win ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts);
    if (res.canceled || !res.filePath) return null;
    await writeAtomically(res.filePath, input.bytes);
    return { name: basename(res.filePath) };
  });
  router.handle('office:openLocal', async (input, c) => {
    const at = ctx.officeLocal.localPath(input.fileId);
    if (!at) throw new DesktopError('NOT_FOUND', 'This file is not on this computer.');
    if (input.preview) {
      // Quick Look shows the file without another app, and without the network (macOS).
      const win = winOf(c.sender);
      if (process.platform !== 'darwin' || !win) throw new DesktopError('UNSUPPORTED', 'Previewing an Office file without WorkSuite needs macOS Quick Look.');
      win.previewFile(at.path);
      return true;
    }
    if (!ctx.session.hasPermission('desktop.files.open_external')) throw new DesktopError('POLICY_DENIED', 'Your organization does not allow opening files in other applications.');
    return (await shell.openPath(at.path)) === '';
  });

  // eLearning's offline copies (electron/services/elearning-offline.ts).
  router.handle('elearning:offlineList', () => ctx.elearning.list());
  router.handle('elearning:offlineDownload', (input) => ctx.elearning.download(input.courseId, input.title));
  router.handle('elearning:offlineRemove', (input) => ctx.elearning.remove(input.courseId));
  router.handle('elearning:offlineValidate', () => ctx.elearning.validate());
  router.handle('transfers:prepareMedia', (input) => ctx.transfers.prepareMedia(input));
  router.handle('transfers:upload', (input, c) => {
    // A file for a remote-control session goes only from the meeting window that controls it; the shared
    // computer's own offers are chosen in the main process's dialog, never through here.
    if (input.target.kind === 'remote' && ctx.windows.kindOf(winOf(c.sender)?.id ?? -1) !== 'meet') {
      throw new DesktopError('IPC_FORBIDDEN_SENDER', 'Files for a remote session are sent from the meeting window.');
    }
    return ctx.transfers.upload(input.handles, input.target);
  });
  router.handle('transfers:pause', (input) => ctx.transfers.pause(input.id));
  router.handle('transfers:resume', (input) => ctx.transfers.resume(input.id));
  router.handle('transfers:cancel', (input) => ctx.transfers.cancel(input.id));
  router.handle('transfers:retry', (input) => ctx.transfers.retry(input.id));
  router.handle('transfers:open', (input) => ctx.transfers.openFile(input.id));
  router.handle('transfers:reveal', (input) => ctx.transfers.reveal(input.id));
  router.handle('transfers:clearFinished', () => ctx.transfers.clearFinished());
  router.handle('transfers:pauseAll', () => ctx.transfers.pauseAll());
  router.handle('transfers:resumeAll', () => ctx.transfers.resumeAll());
  router.handle('transfers:resetSettings', () => ({ preferences: ctx.settings.resetDrive(), locks: ctx.settings.locks() }));

  // ── Drive sync ─────────────────────────────────────────────────────────
  router.handle('sync:status', () => ctx.sync.status());
  router.handle('sync:devices', async () => {
    const d = await ctx.http.get<{ devices?: Array<Record<string, unknown>>; policy?: SyncPolicy }>('/api/sync/devices');
    const str = (v: unknown) => (typeof v === 'string' && v !== '' ? v : null);
    return {
      devices: (d.devices ?? []).map((x) => ({
        id: Number(x.id),
        name: String(x.name ?? ''),
        platform: String(x.platform ?? 'other'),
        osVersion: str(x.os_version),
        appVersion: str(x.app_version),
        status: String(x.status ?? 'active'),
        storageUsed: Number(x.storage_used ?? 0),
        fileCount: Number(x.file_count ?? 0),
        lastSeenAt: str(x.last_seen_at),
        lastSyncAt: str(x.last_sync_at),
        wipeOrderedAt: str(x.wipe_ordered_at),
      })),
      policy: d.policy ?? null,
      thisDevice: ctx.sync.status().deviceId ?? (ctx.device.current() ? Number(ctx.device.current()!.id) : null),
    };
  });
  router.handle('sync:deviceAction', async (input) => {
    const mine = ctx.sync.status().deviceId ?? Number(ctx.device.current()?.id ?? 0);
    if (input.id === mine && input.action !== 'rename') {
      throw new DesktopError('IPC_VALIDATION_FAILED', 'Pause or stop syncing on this computer instead — signing it out from here would cut off the app you are using.');
    }
    const path = `/api/sync/devices/${input.id}`;
    if (input.action === 'rename') {
      if (!input.name) throw new DesktopError('IPC_VALIDATION_FAILED', 'A device needs a name.');
      await ctx.http.request('PUT', path, { body: { name: input.name } });
    } else if (input.action === 'sign-out') await ctx.http.post(`${path}/logout`, {});
    else if (input.action === 'wipe') await ctx.http.post(`${path}/wipe`, {});
    else await ctx.http.request('DELETE', path);
  });
  router.handle('sync:add', async (input, c) => {
    let localPath: string | null = null;
    if (input.choose) {
      const w = winOf(c.sender);
      const opts: Electron.OpenDialogOptions = {
        title: 'Choose the folder on this computer to keep in step',
        buttonLabel: 'Sync here',
        defaultPath: ctx.sync.defaultRoot(),
        properties: ['openDirectory', 'createDirectory', 'promptToCreate'],
      };
      const res = w ? await dialog.showOpenDialog(w, opts) : await dialog.showOpenDialog(opts);
      if (res.canceled || !res.filePaths[0]) return null;
      localPath = res.filePaths[0];
    }
    return ctx.sync.add({ folderId: input.folderId, mode: input.mode, localPath });
  });
  router.handle('sync:remove', (input) => ctx.sync.remove(input.id));
  router.handle('sync:setMode', (input) => ctx.sync.setMode(input.id, input.mode));
  router.handle('sync:pause', (input) => ctx.sync.setPaused(input.id, input.paused));
  router.handle('sync:now', () => {
    ctx.sync.kick('now');
    return ctx.sync.status();
  });
  router.handle('sync:resolve', (input) => ctx.sync.resolveHeld(input.id, input.choice));
  router.handle('sync:reveal', async (input) => {
    const at = ctx.sync.locate(input);
    if (!at) throw new DesktopError('NOT_FOUND', 'That is not on this computer.');
    if (at.isFile) {
      shell.showItemInFolder(at.path);
      return true;
    }
    return (await shell.openPath(at.path)) === '';
  });
  router.handle('sync:lookup', (input) => ctx.sync.lookup(input.files, input.folders, input.context));
  router.handle('sync:reconnect', async () => {
    const server = ctx.auth.getServer();
    await ctx.device.reenrol(uid(), server?.api ?? 'core');
    ctx.sync.start(uid());
    return ctx.sync.status();
  });

  // ── notifications ──────────────────────────────────────────────────────
  router.handle('notifications:list', async () => {
    const r = await ctx.notifications.refreshList();
    const visible = ctx.session.visibleApps();
    return { ...r, items: r.items.filter((i) => notificationAllowed(i, visible)) };
  });
  router.handle('notifications:markRead', (input) => ctx.notifications.markRead(input.ids));
  router.handle('notifications:markAllRead', () => ctx.notifications.markAllRead());
  router.handle('notifications:pause', (input) => ({ pausedUntil: ctx.notifications.pause(input.minutes) }));
  router.handle('notifications:test', () => ctx.notifications.test());
  router.handle('notifications:permission', () => ctx.notifications.permission());
  router.handle('notifications:refresh', () => ctx.notifications.refreshCounts());
  router.handle('notifications:reminder', (input) =>
    ctx.notifications.notify({ id: `reminder:${input.id}`, module: 'mail', title: input.title, body: input.body, sender: null, link: input.route, critical: false, flag: input.flag ?? null }),
  );

  // ── clipboard (FR-XFR-05; never monitored, FR-XFR-06) ──────────────────
  router.handle('clipboard:readForPaste', async (_i, c) => {
    const policy = ctx.session.current()?.policy;
    if (policy && !policy.clipboard_paste) throw new DesktopError('POLICY_DENIED', 'Your organization has turned off pasting into WorkSuite.');
    if (Date.now() - ctx.lastPasteGesture(c.sender.id) > 3000) {
      throw new DesktopError('PERMISSION_DENIED', 'The clipboard is read only when you paste.');
    }
    const text = (await clipboard.readText()) || null;
    let image: string | null = null;
    for (const item of await clipboard.read()) {
      const type = item.types.find((t) => t === 'image/png' || t === 'image/jpeg');
      if (!type) continue;
      const blob = (await item.getType(type)) as Blob;
      if (blob.size > 20 * 1024 * 1024) break;
      image = `data:${type};base64,${Buffer.from(await blob.arrayBuffer()).toString('base64')}`;
      break;
    }
    return { text, image, files: [] };
  });

  // ── printing ───────────────────────────────────────────────────────────
  router.handle('print:print', (input) => printHtml(input.html, input.title, { silent: input.silent, deviceName: input.deviceName }, false));
  router.handle('print:printers', (_i, c) => listPrinters(winOf(c.sender)));
  router.handle('print:toPdf', (input, c) => printToPdf(input.html, input.title, winOf(c.sender)));

  // ── SalonMate's front desk ─────────────────────────────────────────────
  // Pairing is done here so the key the server hands over never reaches a
  // renderer; the API proxy adds it to SalonMate's requests (salon-desk.ts).
  router.handle('salon:deskPairing', () => ctx.salonDesk.pairing());
  router.handle('salon:deskPair', (input) => ctx.salonDesk.pair(input, `desktop-${ctx.device.installId()}`, app.getVersion()));
  router.handle('salon:deskForget', () => {
    // The old desk's copy and outbox mean nothing to the next one (the screen has warned about anything unsent).
    const origin = ctx.auth.getServer()?.origin;
    const desk = ctx.salonDesk.pairing();
    if (origin && desk) ctx.salonSync.forgetDesk(origin, desk.desk_id);
    ctx.salonDesk.forget();
  });
  // Receipts go to the desk's own printer, checked against what this computer has.
  const installed = async (sender: WebContents) => (await listPrinters(winOf(sender))).map((p) => p.name);
  router.handle('salon:printSettings', () => ctx.salonPrint.settings());
  router.handle('salon:printSettingsSet', async (input, c) => ctx.salonPrint.update(input, await installed(c.sender)));
  router.handle('salon:printReceipt', async (input, c) => ctx.salonPrint.receipt(input.visit_id, input.paper, await installed(c.sender)));
  router.handle('salon:printTest', async (input, c) => ctx.salonPrint.test(input.paper, await installed(c.sender)));
  router.handle('salon:printPage', async (input, c) => ctx.salonPrint.page(input.html, input.paper, await installed(c.sender)));
  router.handle('salon:openDrawer', async (_i, c) => ctx.salonPrint.drawer(await installed(c.sender)));

  // ── WorkSuite Events' desk ─────────────────────────────────────────────
  // Registering at an event and a new key are done here, so the key never
  // reaches a renderer (event-desk.ts); scans are matched against the offline
  // copy here too. Badges print from the server's own page (event-desk-print.ts).
  router.handle('eventdesk:list', () => ctx.eventDesk.registrations());
  router.handle('eventdesk:status', (input) => ctx.eventDesk.status(input.event_id));
  router.handle('eventdesk:register', (input) => ctx.eventDesk.register(input));
  router.handle('eventdesk:rotateKey', (input) => ctx.eventDesk.rotateKey(input.event_id));
  router.handle('eventdesk:forget', (input) => ctx.eventDesk.forget(input.event_id, input.discard === true));
  router.handle('eventdesk:sync', async (input) => {
    await ctx.eventDesk.sync(input.event_id);
    return ctx.eventDesk.status(input.event_id);
  });
  router.handle('eventdesk:scan', (input) => ctx.eventDesk.scan(input));
  router.handle('eventdesk:search', (input) => ctx.eventDesk.search(input.event_id, input.q, input.limit ?? 20));
  router.handle('eventdesk:queue', (input) => ctx.eventDesk.queue(input.event_id));
  router.handle('eventdesk:queueResolve', (input) => ctx.eventDesk.resolveItem(input.event_id, input.client_uuid, input.action));
  router.handle('eventdesk:walkIn', (input) => ctx.eventDesk.walkIn(input));
  router.handle('eventdesk:printSettings', () => ctx.eventDeskPrint.settings());
  router.handle('eventdesk:printSettingsSet', async (input, c) => ctx.eventDeskPrint.update(input, await installed(c.sender)));
  router.handle('eventdesk:printJobs', async (input, c) => ctx.eventDeskPrint.printJobs(input.event_id, input.job_ids, await installed(c.sender)));

  // Offline working (salon-sync.ts): the day's copy, and the outbox.
  router.handle('salon:syncStatus', () => ctx.salonSync.status());
  router.handle('salon:syncNow', () => ctx.salonSync.sync());
  router.handle('salon:copy', () => ctx.salonSync.copy());
  router.handle('salon:copyClients', (input) => ctx.salonSync.clients(input.q, input.limit ?? 20, input.id));
  router.handle('salon:outbox', () => ctx.salonSync.outbox());
  router.handle('salon:outboxAdd', (input) => ctx.salonSync.add(input));
  router.handle('salon:outboxResolve', (input) => ctx.salonSync.resolve(input));

  // ── offline ────────────────────────────────────────────────────────────
  router.handle('offline:status', () => ctx.queue.status(uid(), { bytes: ctx.cache.totalBytes(), entries: ctx.cache.count() }));
  router.handle('offline:pending', () => ctx.queue.list(uid()));
  router.handle('offline:moduleBytes', (input) => ctx.cache.moduleBytes(uid(), input.module));
  router.handle('offline:clearModule', (input) => ctx.cache.clearModule(uid(), input.module));
  router.handle('offline:mailStats', () => ({ ...ctx.cache.mailStats(uid()), limitBytes: (ctx.session.current()?.policy?.offline_storage_max_mb ?? 2048) * 1024 * 1024, bodies: ctx.mailBodies?.progress() ?? {} }));
  // A message's pictures and attachments kept on this computer (worksuite-desktop#163).
  router.handle('mail:images', (input) => {
    if (!canOpenApp('mail', ctx.session.visibleApps()) || !ctx.mailMedia) return { enabled: true, images: {} };
    return ctx.mailMedia.images(uid(), input.urls, input.mailbox, input.fetch);
  });
  router.handle('mail:keptAttachments', (input) => {
    if (!canOpenApp('mail', ctx.session.visibleApps()) || !ctx.mailMedia) return [];
    return ctx.mailMedia.kept(uid(), { uid: input.uid, folder: input.folder, mailbox: input.mailbox, items: input.items }, input.auto);
  });
  // Cached first (worksuite-desktop#162): Mail's saved answers, read without the network; the page refreshes behind them.
  router.handle('offline:peek', (input) => {
    if (!canOpenApp('mail', ctx.session.visibleApps())) return input.paths.map(() => null);
    return input.paths.map((path) => {
      if (path.includes('..') || path.includes('//')) return null;
      const hit = ctx.cache.get(uid(), path);
      return hit && hit.status === 200 ? { body: hit.body, cachedAt: hit.cachedAt } : null;
    });
  });
  router.handle('offline:clearMailbox', (input) => ctx.cache.clearMailbox(uid(), input.mailbox));
  router.handle('offline:mailSearch', (input) => (canOpenApp('mail', ctx.session.visibleApps()) ? ctx.cache.mailSearch(uid(), input.q) : []));
  router.handle('offline:mailList', (input) => (canOpenApp('mail', ctx.session.visibleApps()) ? ctx.cache.mailList(uid(), { mailbox: input.mailbox, folder: input.folder, role: input.role ?? null, limit: input.limit, offset: input.offset ?? 0 }) : { messages: [], total: 0 }));
  router.handle('offline:submit', (input) => ctx.queue.submit(uid(), input));
  router.handle('offline:retry', async (input) => {
    ctx.queue.retry(uid(), input.id);
    void ctx.queue.replay(uid());
  });
  router.handle('offline:discard', (input) => ctx.queue.discard(uid(), input.id));
  router.handle('offline:saveDraft', (input) => ctx.queue.saveDraft(uid(), input.module, input.context, input.content));
  router.handle('offline:getDraft', (input) => ctx.queue.getDraft(uid(), input.module, input.context));
  router.handle('offline:listDrafts', (input) => ctx.queue.listDrafts(uid(), input?.module));
  router.handle('offline:deleteDraft', (input) => ctx.queue.deleteDraft(uid(), input.module, input.context));
  router.handle('offline:clearCache', () => ctx.cache.clearUser(uid()));
  router.handle('offline:search', (input) => {
    const q = input.q.toLowerCase();
    const out: Array<{ module: string; title: string; subtitle: string; route: string; cachedAt: string }> = [];
    // Saved while an app was the person's, but not searched once it is not.
    const visible = ctx.session.visibleApps();
    for (const e of ctx.cache.entries(uid())) {
      if (!canOpenApp(e.module, visible)) continue;
      let data: unknown;
      try {
        data = (JSON.parse(e.value.body) as { data?: unknown }).data;
      } catch {
        continue;
      }
      const lists: Array<[string, unknown[], (x: Record<string, unknown>) => { title: string; subtitle: string; route: string }]> = [];
      const d = (data ?? {}) as Record<string, unknown>;
      if (Array.isArray(d.tasks)) lists.push(['tasks', d.tasks, (x) => ({ title: String(x.title ?? ''), subtitle: 'Task', route: `/tasks?task=${x.id}` })]);
      if (Array.isArray(d.leads)) lists.push(['crm', d.leads, (x) => ({ title: String(x.name ?? ''), subtitle: String(x.company ?? 'Lead'), route: `/crm/leads/${x.id}` })]);
      if (Array.isArray(d.messages) && e.module === 'mail') lists.push(['mail', d.messages, (x) => ({ title: String(x.subject ?? ''), subtitle: String(x.from_name ?? x.from_email ?? ''), route: `/mail?msg=${x.id}&folder=${x.folder_slug ?? 'inbox'}` })]);
      if (Array.isArray(d.rooms)) lists.push(['chat', d.rooms, (x) => ({ title: String(x.name ?? ''), subtitle: 'Conversation', route: `/chat?room=${x.id}` })]);
      if (Array.isArray(d.files)) lists.push(['files', d.files, (x) => ({ title: String(x.name ?? ''), subtitle: 'File', route: `/files?file=${x.id}` })]);
      for (const [module, items, map] of lists) {
        if (!canOpenApp(module, visible)) continue;
        for (const raw of items) {
          if (!raw || typeof raw !== 'object') continue;
          const hit = map(raw as Record<string, unknown>);
          if (hit.title.toLowerCase().includes(q) || hit.subtitle.toLowerCase().includes(q)) {
            if (!out.some((o) => o.route === hit.route)) out.push({ module, ...hit, cachedAt: e.value.cachedAt });
          }
          if (out.length >= 40) return out;
        }
      }
    }
    return out;
  });

  // ── security ───────────────────────────────────────────────────────────
  router.handle('security:lock', () => ctx.lock.lock('manual'));
  router.handle('security:unlockPassword', async (input) => {
    if (!ctx.lock.isLocked()) return { ok: true, message: null };
    const email = ctx.session.get().user?.email;
    if (!email) return { ok: false, message: 'Sign in again.' };
    try {
      const ok = await ctx.auth.verifyPassword(email, input.password);
      if (ok) {
        ctx.lock.unlock();
        return { ok: true, message: null };
      }
    } catch (e) {
      const code = (e as DesktopError).code;
      if (code === 'NETWORK_UNREACHABLE') {
        return { ok: false, message: 'WorkSuite cannot check your password while offline. Use Touch ID, or reconnect.' };
      }
      if (code === 'RATE_LIMITED') return { ok: false, message: (e as Error).message };
      // The password was right and the server still said no — an access policy, a suspended account.
      // Its words, and not a wrong password: it would not count towards signing out.
      if (e instanceof DesktopError && e.status !== null && e.status !== 401) return { ok: false, message: e.message };
    }
    const out = await failedUnlock();
    return out ?? { ok: false, message: `That password is not right (${ctx.lock.failures()} of 5). If you sign in with a passkey, choose Sign out and sign in again — your drafts are kept.` };
  });
  // Wrong passwords and wrong PINs count together: five and the person is signed out.
  const failedUnlock = async (): Promise<{ ok: false; message: string } | null> => {
    if (ctx.lock.recordFailure() < 5) return null;
    await ctx.session.signOut(false);
    ctx.lock.reset();
    return { ok: false, message: 'Too many attempts. You have been signed out.' };
  };
  router.handle('security:unlockPin', async (input) => {
    if (!ctx.lock.isLocked()) return { ok: true, message: null };
    const uid = ctx.session.userId();
    if (!uid || !ctx.lockPin.has(uid)) return { ok: false, message: 'No PIN is set on this computer. Use your password.' };
    if (ctx.lockPin.verify(uid, input.pin)) {
      ctx.lock.unlock();
      return { ok: true, message: null };
    }
    const out = await failedUnlock();
    return out ?? { ok: false, message: `That PIN is not right (${ctx.lock.failures()} of 5).` };
  });
  router.handle('security:setPin', async (input) => {
    const uid = ctx.session.userId();
    const email = ctx.session.get().user?.email;
    const origin = ctx.session.get().server?.origin;
    if (!uid || !email) return { ok: false, message: 'Sign in again.' };
    try {
      if (!(await ctx.auth.verifyPassword(email, input.password))) return { ok: false, message: 'That password is not right.' };
    } catch (e) {
      const code = (e as DesktopError).code;
      if (code === 'NETWORK_UNREACHABLE') return { ok: false, message: 'Setting a PIN checks your password with WorkSuite. Reconnect and try again.' };
      if (e instanceof DesktopError && e.status !== null && e.status !== 401) return { ok: false, message: e.message };
      return { ok: false, message: 'That password is not right.' };
    }
    if (uid !== ctx.session.userId() || origin !== ctx.session.get().server?.origin) return { ok: false, message: 'Your account changed. Try again.' };
    try {
      ctx.lockPin.set(uid, input.pin);
    } catch (e) {
      return { ok: false, message: (e as Error).message };
    }
    ctx.audit.record(uid, 'security.lock_pin_set', {});
    ctx.lock.changed();
    return { ok: true, message: null };
  });
  router.handle('security:clearPin', async (input) => {
    await verifyLockChange(() => ({ id: ctx.session.userId() ? `${ctx.session.get().server?.origin}:${ctx.session.userId()}` : null, email: ctx.session.get().user?.email ?? null }), (email, password) => ctx.auth.verifyPassword(email, password), input.password);
    const uid = ctx.session.userId();
    if (uid) {
      ctx.lockPin.clear(uid);
      ctx.audit.record(uid, 'security.lock_pin_removed', {});
    }
    ctx.lock.changed();
    return ctx.lock.state();
  });
  router.handle('security:unlockBiometric', async () => {
    const ok = await ctx.lock.unlockWithBiometric();
    return { ok, message: ok ? null : 'Touch ID did not unlock WorkSuite.' };
  });
  router.handle('security:state', () => ctx.lock.state());
  router.handle('security:deviceInfo', () => ctx.device.info(ctx.secrets.getStatus()));
  router.handle('security:activity', () => ctx.lock.activity());

  // ── updates ────────────────────────────────────────────────────────────
  router.handle('updates:status', () => ctx.updater.get());
  router.handle('updates:check', () => ctx.updater.check());
  router.handle('updates:installNow', (input) => ctx.updater.install(!!input?.force));
  router.handle('updates:restartLater', () => ctx.updater.later('hour'));
  router.handle('updates:later', (input) => ctx.updater.later(input.choice));
  router.handle('updates:download', () => ctx.updater.downloadNow());
  router.handle('updates:reinstall', () => ctx.updater.reinstall());
  router.handle('updates:dismissNotice', () => ctx.updater.dismissNotice());
  router.handle('updates:prepared', (input) => ctx.updatePrepared(input.token));
  // Settings › About › Channel (#205): only what the organisation allows; a less stable channel once confirmed.
  router.handle('updates:setChannel', async (input) => {
    try {
      return await ctx.updater.setChannel(input.channel, !!input.confirmed, (channel) => ctx.settings.update({ updateChannel: channel, updateChannelChosen: true }));
    } catch (e) {
      const code = (e as { code?: string }).code;
      if (code === 'POLICY_DENIED') throw new DesktopError('POLICY_DENIED', (e as Error).message);
      if (code === 'CONFIRMATION_REQUIRED') throw new DesktopError('IPC_VALIDATION_FAILED', (e as Error).message);
      throw e;
    }
  });
  router.handle('updates:setActiveCall', (input) => ctx.setActiveCall(input.active));
  router.handle('updates:busy', (): BusyReport => ctx.updateBusy());

  // ── settings ───────────────────────────────────────────────────────────
  router.handle('settings:get', () => ({ preferences: ctx.settings.effective(), locks: ctx.settings.locks() }));
  router.handle('settings:set', async (input) => {
    const { verificationPassword, ...choices } = input;
    if (choices.appLockEnabled === false && ctx.settings.effective().appLockEnabled === true) {
      await verifyLockChange(() => ({ id: ctx.session.userId() ? `${ctx.session.get().server?.origin}:${ctx.session.userId()}` : null, email: ctx.session.get().user?.email ?? null }), (email, password) => ctx.auth.verifyPassword(email, password), verificationPassword);
    }
    const locked = new Set(ctx.settings.locks().map((l) => l.key));
    const patch = Object.fromEntries(Object.entries(choices).filter(([k]) => k === 'appLockMinutes' || !locked.has(k as never)));
    const before = ctx.settings.raw();
    const prefs = ctx.settings.update(patch);
    if (before.startWithOs !== prefs.startWithOs || before.startMinimized !== prefs.startMinimized) applyAutostart(prefs.startWithOs, prefs.startMinimized);
    if (before.hardwareAcceleration !== prefs.hardwareAcceleration) writeBootConfig(paths().bootConfig, { hardwareAcceleration: prefs.hardwareAcceleration });
    // Turned back on with a version on offer: it downloads now rather than at the next check.
    if (before.autoUpdate === false && prefs.autoUpdate !== false && ctx.updater.get().state === 'AVAILABLE') void ctx.updater.check();
    return { preferences: prefs, locks: ctx.settings.locks() };
  });

  router.handle('settings:launcherDefaults', async (input) => {
    if (ctx.session.get().server?.api !== 'desktop-v1') throw new DesktopError('UNSUPPORTED', 'This WorkSuite server does not take launcher defaults.');
    const saved = await saveLauncherDefaults(ctx.http, input.organizationId, input);
    // Everyone's next bootstrap carries them; this window's at once.
    void ctx.session.refreshBootstrap().catch(() => undefined);
    return saved;
  });

  router.handle('status:snapshot', () => ctx.status());

  // ── diagnostics ────────────────────────────────────────────────────────
  router.handle('diagnostics:run', () => ctx.diagnostics.run());
  router.handle('diagnostics:previewBundle', () => ctx.diagnostics.preview());
  router.handle('diagnostics:saveBundle', async (_i, c) => {
    const entries = await ctx.diagnostics.bundle();
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const opts = { title: 'Save diagnostic report', defaultPath: `WorkSuite-diagnostics-${stamp}.zip`, filters: [{ name: 'ZIP archive', extensions: ['zip'] }] };
    const w = winOf(c.sender);
    const res = w ? await dialog.showSaveDialog(w, opts) : await dialog.showSaveDialog(opts);
    if (res.canceled || !res.filePath) return null;
    await writeFile(res.filePath, createZip(entries));
    ctx.audit.record(ctx.session.userId(), 'desktop.diagnostics.export', { files: entries.length });
    return res.filePath;
  });
  router.handle('diagnostics:restartSafeMode', (input) => ctx.relaunch(input.safe));
  router.handle('diagnostics:services', () => ctx.supervisor.health());
}
