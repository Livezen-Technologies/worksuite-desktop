import { BrowserWindow, dialog, nativeImage, shell, utilityProcess, webContents } from 'electron';
import { hkdfSync, randomUUID } from 'node:crypto';
import { open as openFile, rename, rm } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import type { NavigateRequest } from '@shared/types';
import { DesktopError } from '../../main/errors';
import { logger } from '../../main/log';
import type { IpcRouter } from '../../ipc/router';
import { openExternalSafely } from '../../security/hardening';
import { listPrinters } from '../print';
import { runPdfDiagnostics } from './diagnostics';
import { PdfLocalFiles } from './local-files';
import { printPdfPages } from './print';
import { DesktopPdfService, type HttpLike, type PdfPolicy } from './service';
import { PdfStorage } from './storage';
import { PdfRecovery } from './recovery';
import { StudioApi, studioClient } from './studio-api';
import { WorkerEngine, type WorkerChannel } from './worker-engine';
import type { WorkerMessage } from './worker-protocol';

const log = logger('pdf');

/**
 * PDF Studio in the main process: the service, its engine workers, its
 * files, and its IPC handlers — wired here so the shell's own files change
 * by a few lines only.
 */
export interface PdfStudioDeps {
  profile: string;
  userData: string;
  http: HttpLike;
  /** Seals the thumbnail cache; null when there is no lasting key (no keyring): nothing is cached on disk then. */
  cacheKey: Buffer | null;
  policy: () => PdfPolicy;
  desktop: () => { downloads: boolean; diskCache: boolean };
  audit: (action: string, details: Record<string, unknown>) => void;
  signedIn: () => boolean;
  dbCheck: () => string;
  navigate: (req: NavigateRequest) => void;
  appVersion: string;
  /** Stage D2: this computer and the person, for the server's sessions and the author of annotations. */
  device: () => { id: string | null; name: string };
  userName: () => string;
}

/**
 * A PDF written to this computer: beside its destination first, flushed to
 * the disk, then moved over it — so the file is either the old one or the
 * new one, never half of each.
 */
export async function writeAtomically(path: string, bytes: Uint8Array): Promise<void> {
  const tmp = join(dirname(path), `.${basename(path)}.${randomUUID().slice(0, 8)}.part`);
  const fh = await openFile(tmp, 'w', 0o644);
  try {
    await fh.write(bytes);
    await fh.sync();
  } finally {
    await fh.close();
  }
  try {
    await rename(tmp, path);
  } catch (e) {
    await rm(tmp, { force: true }).catch(() => undefined);
    throw new DesktopError('PERMISSION_DENIED', `The file could not be written there (${(e as NodeJS.ErrnoException).code ?? 'error'}).`);
  }
}

export interface PdfStudio {
  service: DesktopPdfService;
  /** WorkSuite answers again: saves that were waiting go. */
  online(): void;
  register(router: IpcRouter): void;
  /** PDFs the operating system handed to WorkSuite ("Open with"): each opens in a tab of its own. */
  openFromOs(paths: string[]): Promise<void>;
  senderGone(id: number): void;
  closeAll(): Promise<void>;
  wipe(): Promise<void>;
}

function spawnWorker(memoryMb: number): WorkerEngine {
  const proc = utilityProcess.fork(join(__dirname, 'pdf-worker.js'), [`--memory-mb=${Math.max(128, Math.round(memoryMb))}`], { serviceName: 'WorkSuite PDF engine', stdio: 'ignore' });
  const channel: WorkerChannel = {
    post: (m) => proc.postMessage(m),
    onMessage: (cb) => proc.on('message', (m: WorkerMessage) => cb(m)),
    onExit: (cb) => proc.on('exit', (code) => cb(code)),
    kill: () => void proc.kill(),
  };
  return new WorkerEngine(channel);
}

const winOf = (sender: number): BrowserWindow | null => {
  const wc = webContents.fromId(sender);
  return wc ? BrowserWindow.fromWebContents(wc) : null;
};

export function createPdfStudio(deps: PdfStudioDeps): PdfStudio {
  const storage = new PdfStorage(join(deps.profile, 'PDF'), () => deps.cacheKey);
  void storage.prepare().catch((e) => log.warn('pdf storage not prepared', { error: String(e) }));
  const local = new PdfLocalFiles({ maxBytes: () => deps.policy().maxBytes, forbidden: () => [deps.userData] });
  // Unsaved work kept on this computer (PDF-SAVE-020), sealed under a key from the credential store; none without one.
  const recovery = new PdfRecovery(join(deps.profile, 'PDF'), () => (deps.cacheKey ? Buffer.from(hkdfSync('sha256', deps.cacheKey, 'worksuite-pdf', 'recovery', 32)) : null));
  void recovery.trim().catch(() => undefined);

  // Once PDF Studio has been used, a warm engine waits for the next document, so opening one does not wait for the
  // engine to start (PDF-NFR-001/002). It is ended with the others at sign-out.
  let spare: WorkerEngine | null = null;
  let spareTimer: NodeJS.Timeout | null = null;
  const engineFor = (memoryMb: number): WorkerEngine => {
    const warm = spare?.alive ? spare : null;
    spare = null;
    if (!spareTimer) {
      spareTimer = setTimeout(() => {
        spareTimer = null;
        if (!spare && deps.signedIn()) spare = spawnWorker(memoryMb);
      }, 3_000);
      spareTimer.unref?.();
    }
    return warm ?? spawnWorker(memoryMb);
  };
  const dropSpare = (): void => {
    if (spareTimer) clearTimeout(spareTimer);
    spareTimer = null;
    void spare?.close().catch(() => undefined);
    spare = null;
  };

  const service = new DesktopPdfService({
    storage,
    local,
    http: deps.http,
    engine: (memoryMb) => engineFor(memoryMb),
    policy: deps.policy,
    desktop: deps.desktop,
    encode: (bgra, width, height, kind) => {
      const img = nativeImage.createFromBitmap(Buffer.from(bgra.buffer, bgra.byteOffset, bgra.byteLength), { width, height });
      return kind === 'jpeg' ? img.toJPEG(82) : img.toPNG();
    },
    print: (job, sender) => printPdfPages(job, winOf(sender)),
    openLink: async (url, confirm, sender) => {
      const u = new URL(url);
      if ((u.protocol !== 'https:' && u.protocol !== 'mailto:') || u.username || u.password) return false;
      if (!confirm) return openExternalSafely(u.toString(), winOf(sender));
      const win = winOf(sender);
      const opts = {
        type: 'question' as const,
        buttons: [u.protocol === 'mailto:' ? 'Write the email' : 'Open in browser', 'Cancel'],
        defaultId: 1,
        cancelId: 1,
        message: 'Open this link from the PDF?',
        detail: `${u.toString().slice(0, 500)}\n\nLinks in documents can lead anywhere. Open it only if you trust where it goes.`,
      };
      const { response } = win ? await dialog.showMessageBox(win, opts) : await dialog.showMessageBox(opts);
      if (response !== 0) return false;
      await shell.openExternal(u.toString());
      return true;
    },
    emit: (sender, channel, payload) => {
      const wc = webContents.fromId(sender);
      if (wc && !wc.isDestroyed()) wc.send(channel, payload);
    },
    audit: deps.audit,
    log,
    appVersion: deps.appVersion,
    studio: new StudioApi(deps.http),
    recovery,
    client: studioClient(process.platform),
    device: deps.device,
    userName: deps.userName,
    writeLocal: writeAtomically,
    chooseSavePath: async (sender, suggested) => {
      const win = winOf(sender);
      const opts: Electron.SaveDialogOptions = { title: 'Save the PDF', defaultPath: suggested.replace(/[\\/:*?"<>|]+/g, '-'), filters: [{ name: 'PDF documents', extensions: ['pdf'] }] };
      const res = win ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts);
      if (res.canceled || !res.filePath) return null;
      return res.filePath.toLowerCase().endsWith('.pdf') ? res.filePath : `${res.filePath}.pdf`;
    },
  });

  const register = (router: IpcRouter): void => {
    router.handle('pdf:open', (input, c) => service.open(c.sender.id, input.source));
    router.handle('pdf:state', (input, c) => service.view(c.sender.id, input.session));
    router.handle('pdf:unlock', (input, c) => service.unlock(c.sender.id, input.session, input.password, input.remember));
    router.handle('pdf:retry', (input, c) => service.retry(c.sender.id, input.session));
    router.handle('pdf:close', (input, c) => service.close(c.sender.id, input.session));
    router.handle('pdf:render', (input, c) => service.render(c.sender.id, input));
    router.handle('pdf:thumbnail', (input, c) => service.thumbnail(c.sender.id, input.session, input.page, input.ticket));
    router.handle('pdf:cancel', (input, c) => service.cancel(c.sender.id, input.session, input.tickets));
    router.handle('pdf:search', (input, c) => service.search(c.sender.id, input.session, input.query, input.options));
    router.handle('pdf:searchCancel', (input, c) => service.cancelSearch(c.sender.id, input.session));
    router.handle('pdf:outline', (input, c) => service.outline(c.sender.id, input.session));
    router.handle('pdf:links', (input, c) => service.links(c.sender.id, input.session, input.page));
    router.handle('pdf:followLink', (input, c) => service.followLink(c.sender.id, input.session, input.page, input.index));
    router.handle('pdf:attachments', (input, c) => service.attachments(c.sender.id, input.session));
    router.handle('pdf:details', (input, c) => service.details(c.sender.id, input.session));
    router.handle('pdf:print', (input, c) => service.print(c.sender.id, input));
    router.handle('pdf:pickLocal', async (_input, c) => {
      const win = BrowserWindow.fromWebContents(c.sender);
      const opts: Electron.OpenDialogOptions = { title: 'Open a PDF', filters: [{ name: 'PDF documents', extensions: ['pdf'] }], properties: ['openFile', 'multiSelections'] };
      const res = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts);
      if (res.canceled || !res.filePaths.length) return [];
      const { files, rejected } = await service.registerLocal(res.filePaths);
      if (!files.length && rejected.length) throw new DesktopError('IPC_VALIDATION_FAILED', rejected[0]!.reason);
      return files;
    });
    router.handle('pdf:registerDropped', (input) => service.registerLocal(input.paths));
    router.handle('pdf:mode', (input, c) => service.setMode(c.sender.id, input.session, input.mode, input.takeover));
    router.handle('pdf:edit', (input, c) => service.edit(c.sender.id, input.session, input.op));
    router.handle('pdf:undo', (input, c) => service.undo(c.sender.id, input.session));
    router.handle('pdf:redo', (input, c) => service.redoOp(c.sender.id, input.session));
    router.handle('pdf:annotations', (input, c) => service.annotations(c.sender.id, input.session, input.page));
    router.handle('pdf:textSpan', (input, c) => service.textSpan(c.sender.id, input.session, input.page, input.from, input.to));
    router.handle('pdf:save', (input, c) => service.save(c.sender.id, input.session, input.target, input.note));
    router.handle('pdf:resolve', (input, c) => service.resolve(c.sender.id, input.session, input.answer));
    router.handle('pdf:discard', (input, c) => service.discard(c.sender.id, input.session));
    router.handle('pdf:extract', (input, c) => service.extract(c.sender.id, input.session, input.pages));
    router.handle('pdf:diagnostics', async (_input, c) => {
      const win = BrowserWindow.fromWebContents(c.sender);
      const checks = await runPdfDiagnostics({
        engine: () => spawnWorker(256),
        storage,
        signedIn: deps.signedIn,
        serverGet: (path) => deps.http.get(path),
        dbCheck: deps.dbCheck,
        printers: async () => (await listPrinters(win)).length,
        engines: () => service.engines(),
      });
      return { checks, failures: service.recentFailures() };
    });
  };

  const openFromOs = async (paths: string[]): Promise<void> => {
    if (!paths.length) return;
    try {
      const { files, rejected } = await service.registerLocal(paths);
      for (const f of files) deps.navigate({ route: `/pdf?local=${f.handle}`, source: 'file', title: f.name });
      for (const r of rejected) log.info('pdf handed over by the system refused', { reason: r.reason.replace(basename(r.name), '…') });
    } catch (e) {
      log.warn('pdf handed over by the system not opened', { error: String((e as Error)?.message ?? e) });
    }
  };

  return {
    service,
    online: () => service.online(),
    register,
    openFromOs,
    senderGone: (id) => void service.senderGone(id).catch(() => undefined),
    closeAll: () => (dropSpare(), service.closeAll()),
    wipe: () => (dropSpare(), service.wipe()),
  };
}
