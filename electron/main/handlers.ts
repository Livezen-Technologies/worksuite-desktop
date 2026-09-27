import { app, BrowserWindow, clipboard, dialog, nativeImage, shell, systemPreferences } from 'electron';
import os from 'node:os';
import { writeFile } from 'node:fs/promises';
import type { TabRecord } from '@shared/ipc/contract';
import type { AppInfo, BusyReport } from '@shared/types';
import { DesktopError, isDesktopError } from './errors';
import type { AppContext } from './context';
import type { IpcRouter } from '../ipc/router';
import { applyAutostart } from './autostart';
import { writeBootConfig } from './boot';
import { paths } from './paths';
import { archName, platformName } from '../services/device';
import { listPrinters, printHtml, printToPdf } from '../services/print';
import { createZip } from '../services/zip';
import { openExternalSafely } from '../security/hardening';
import { broadcast } from './events';
import { logger } from './log';

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
  router.handle('app:openExternal', (input, c) => openExternalSafely(input.url, winOf(c.sender)));
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
    return openExternalSafely(`${origin}${input.path}`, winOf(c.sender));
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
  router.handle('media:screenSources', () => ctx.screenShare.sources());
  router.handle('media:screenPick', (input, c) => ctx.screenShare.pick(c.sender.id, input.id, !!input.audio));
  router.handle('media:privacySettings', async (input) => {
    // Fixed addresses of the OS's own privacy panes; nothing from the page.
    const mac = { microphone: 'Privacy_Microphone', camera: 'Privacy_Camera', screen: 'Privacy_ScreenCapture' } as const;
    const win = { microphone: 'privacy-microphone', camera: 'privacy-webcam', screen: 'privacy' } as const;
    if (process.platform === 'darwin') await shell.openExternal(`x-apple.systempreferences:com.apple.preference.security?${mac[input.pane]}`);
    else if (process.platform === 'win32') await shell.openExternal(`ms-settings:${win[input.pane]}`);
  });
  router.handle('calls:active', (input, c) => {
    const w = winOf(c.sender);
    if (w) ctx.calls.setActive(w, input.uuid, { kind: input.kind ?? 'call', title: input.title ?? '' });
  });
  router.handle('calls:list', () => ctx.calls.list());
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
      ctx.vault().encrypt({ tabs: input.tabs, activeId: input.activeId }),
      new Date().toISOString(),
    );
  });
  router.handle('tabs:restore', () => {
    const prefs = ctx.settings.effective();
    if (!prefs.restoreTabs || ctx.boot.safeMode) return { tabs: [], activeId: null, restored: false };
    const row = ctx.db.get<{ payload: string }>('SELECT payload FROM tab_sessions WHERE user_id = ? AND window = ?', uid(), 'main');
    const v = row ? ctx.vault().decrypt<{ tabs: TabRecord[]; activeId: string | null }>(row.payload) : undefined;
    return { tabs: v?.tabs ?? [], activeId: v?.activeId ?? null, restored: !!v };
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
  router.handle('transfers:download', async (input) => {
    if (input.hrDocument) {
      // A one-time link, asked for at the moment of downloading (it expires).
      const base = input.hrEmployee ? `/api/hr/employees/${input.hrEmployee}/documents` : '/api/hr/me/documents';
      const link = await ctx.http.post<{ url: string }>(`${base}/${input.hrDocument}/link`, { disposition: 'attachment' });
      return ctx.transfers.download(`/${String(link.url).replace(/^\/+/, '')}`, input.name, !!input.open, null);
    }
    const r = input.hrReport;
    const oc = input.ordersCsv;
    const rep = input.omsReport;
    const tl = input.tenderLine;
    const path = input.orderPdf
      ? `/api/share/oms/${input.orderPdf}/pdf`
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
    return ctx.transfers.download(path, input.name, !!input.open, input.fileId ?? null);
  });
  router.handle('transfers:upload', (input) => ctx.transfers.upload(input.handles, input.target));
  router.handle('transfers:pause', (input) => ctx.transfers.pause(input.id));
  router.handle('transfers:resume', (input) => ctx.transfers.resume(input.id));
  router.handle('transfers:cancel', (input) => ctx.transfers.cancel(input.id));
  router.handle('transfers:retry', (input) => ctx.transfers.retry(input.id));
  router.handle('transfers:open', (input) => ctx.transfers.openFile(input.id));
  router.handle('transfers:reveal', (input) => ctx.transfers.reveal(input.id));
  router.handle('transfers:clearFinished', () => ctx.transfers.clearFinished());

  // ── notifications ──────────────────────────────────────────────────────
  router.handle('notifications:list', () => ctx.notifications.refreshList());
  router.handle('notifications:markRead', (input) => ctx.notifications.markRead(input.ids));
  router.handle('notifications:markAllRead', () => ctx.notifications.markAllRead());
  router.handle('notifications:pause', (input) => ({ pausedUntil: ctx.notifications.pause(input.minutes) }));
  router.handle('notifications:test', () => ctx.notifications.test());
  router.handle('notifications:refresh', () => ctx.notifications.refreshCounts());

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

  // ── offline ────────────────────────────────────────────────────────────
  router.handle('offline:status', () => ctx.queue.status(uid(), { bytes: ctx.cache.totalBytes(), entries: ctx.cache.count() }));
  router.handle('offline:pending', () => ctx.queue.list(uid()));
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
    for (const e of ctx.cache.entries(uid())) {
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
    }
    const failures = ctx.lock.recordFailure();
    if (failures >= 5) {
      await ctx.session.signOut(false);
      ctx.lock.reset();
      return { ok: false, message: 'Too many attempts. You have been signed out.' };
    }
    return { ok: false, message: 'That password is not right.' };
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
  router.handle('updates:restartLater', () => ctx.updater.restartLater());
  router.handle('updates:setChannel', (input) => {
    if (ctx.settings.locks().some((l) => l.key === 'updateChannel')) throw new DesktopError('POLICY_DENIED', 'Your organization chooses the update channel.');
    ctx.settings.update({ updateChannel: input.channel });
    return ctx.updater.check();
  });
  router.handle('updates:setActiveCall', (input) => ctx.setActiveCall(input.active));
  router.handle('updates:busy', (): BusyReport => {
    const id = ctx.session.userId();
    const counts = ctx.transfers.activeCounts();
    return {
      uploads: counts.uploads,
      downloads: counts.downloads,
      pendingMutations: id ? ctx.queue.pendingCount(id) : 0,
      drafts: id ? ctx.queue.draftCount(id) : 0,
      activeCall: ctx.activeCall(),
    };
  });

  // ── settings ───────────────────────────────────────────────────────────
  router.handle('settings:get', () => ({ preferences: ctx.settings.effective(), locks: ctx.settings.locks() }));
  router.handle('settings:set', (input) => {
    const locked = new Set(ctx.settings.locks().map((l) => l.key));
    const patch = Object.fromEntries(Object.entries(input).filter(([k]) => !locked.has(k as never)));
    const before = ctx.settings.raw();
    const prefs = ctx.settings.update(patch);
    if (before.startWithOs !== prefs.startWithOs || before.startMinimized !== prefs.startMinimized) applyAutostart(prefs.startWithOs, prefs.startMinimized);
    if (before.hardwareAcceleration !== prefs.hardwareAcceleration) writeBootConfig(paths().bootConfig, { hardwareAcceleration: prefs.hardwareAcceleration });
    return { preferences: prefs, locks: ctx.settings.locks() };
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
