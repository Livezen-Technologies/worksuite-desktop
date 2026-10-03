import { BrowserWindow, dialog, shell, utilityProcess, type WebContents } from 'electron';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { MAIL_FILE_FILTERS, type ExportProgress, type ImportProgress } from '@shared/mail-files';
import type { NavigateRequest } from '@shared/types';
import { DesktopError } from '../../main/errors';
import type { IpcRouter } from '../../ipc/router';
import type { HttpClient } from '../http';
import { openExternalSafely } from '../../security/hardening';
import { verifySmime } from '../smime';
import { setSpellLanguages, spellState } from '../spellcheck';
import { exportMail } from './export';
import { MailFiles, type WorkerChannel } from './host';
import type { WorkerResponse } from './worker-protocol';

/**
 * Mail data files, export, safe links and S/MIME in the main process
 * (ENH-MAIL-03 P4): the IPC handlers, and the data-file worker started as a
 * utility process — one per file, a memory cap, no network asked of it.
 */

export interface MailFilesIpcDeps {
  http: HttpClient;
  broadcast: (channel: 'mailfile:changed' | 'mail:exportChanged', payload: ImportProgress | ExportProgress) => void;
  navigate: (req: NavigateRequest) => void;
  audit: (action: string, details: Record<string, unknown>) => void;
  downloadFolder: () => string;
}

function spawnWorker(): WorkerChannel {
  const proc = utilityProcess.fork(join(__dirname, 'datafile-worker.js'), [], { serviceName: 'WorkSuite mail data files', stdio: 'ignore', execArgv: ['--max-old-space-size=1536'] });
  return {
    post: (m) => proc.postMessage(m),
    onMessage: (cb) => proc.on('message', (m: WorkerResponse) => cb(m)),
    onExit: (cb) => proc.on('exit', (code) => cb(code)),
    kill: () => void proc.kill(),
  };
}

const winOf = (sender: WebContents) => BrowserWindow.fromWebContents(sender);

const safeName = (s: string) => s.replace(/[\\/:*?"<>|\p{Cc}]+/gu, '_').trim().slice(0, 120) || 'mail';

export function createMailFilesIpc(deps: MailFilesIpcDeps) {
  const files = new MailFiles({
    http: deps.http,
    spawn: spawnWorker,
    broadcast: (p) => deps.broadcast('mailfile:changed', p),
    audit: deps.audit,
  });
  let exporting: { cancel: boolean } | null = null;

  /** .eml and .msg files the system handed over ("Open with", a double-click): each opens to read in a tab. */
  const openFromOs = (paths: string[]): void => {
    for (const p of paths) {
      const h = files.add(p);
      if (h && (h.kind === 'eml' || h.kind === 'msg')) deps.navigate({ route: `/mail?file=${h.id}`, source: 'file', title: h.name });
    }
  };

  const register = (router: IpcRouter): void => {
    router.handle('mailfile:pick', async (input, c) => {
      const w = winOf(c.sender);
      const opts: Electron.OpenDialogOptions =
        input.mode === 'folder'
          ? { title: 'Choose a folder of .eml or .msg files', properties: ['openDirectory'] }
          : { title: input.mode === 'view' ? 'Open a message file' : 'Choose a mail data file', properties: ['openFile'], filters: input.mode === 'view' ? [MAIL_FILE_FILTERS[3]!] : MAIL_FILE_FILTERS };
      const res = w ? await dialog.showOpenDialog(w, opts) : await dialog.showOpenDialog(opts);
      if (res.canceled || !res.filePaths[0]) return null;
      const h = files.add(res.filePaths[0]);
      if (!h) throw new DesktopError('UNSUPPORTED', 'That is not a .pst, .mbox, .eml or .msg file.');
      return h;
    });
    router.handle('mailfile:scan', (input) => files.scan(input.handle));
    router.handle('mailfile:import', (input) => files.start(input.handle, input.importId, input.plan));
    router.handle('mailfile:progress', (input) => files.progress(input.handle));
    router.handle('mailfile:cancel', (input) => files.cancel(input.handle));
    router.handle('mailfile:view', (input) => files.view(input.handle));
    router.handle('mailfile:saveAttachment', async (input, c) => {
      const a = await files.attachment(input.handle, input.index);
      const w = winOf(c.sender);
      const opts: Electron.SaveDialogOptions = { title: 'Save attachment', defaultPath: join(deps.downloadFolder(), safeName(a.name)) };
      const res = w ? await dialog.showSaveDialog(w, opts) : await dialog.showSaveDialog(opts);
      if (res.canceled || !res.filePath) return false;
      await writeFile(res.filePath, Buffer.from(a.data), { mode: 0o600 });
      return true;
    });
    router.handle('mailfile:close', (input) => files.close(input.handle));

    router.handle('mail:export', async (input, c) => {
      if (exporting) throw new DesktopError('CONFLICT', 'An export is already running.');
      const w = winOf(c.sender);
      const ext = input.format === 'eml' ? 'zip' : 'mbox';
      const name = `${safeName(input.folderName)}.${ext}`;
      const opts: Electron.SaveDialogOptions = { title: 'Export mail', defaultPath: join(deps.downloadFolder(), name), filters: [{ name: input.format === 'eml' ? 'Zip of .eml files' : 'Mailbox (mbox)', extensions: [ext] }] };
      const res = w ? await dialog.showSaveDialog(w, opts) : await dialog.showSaveDialog(opts);
      if (res.canceled || !res.filePath) return null;
      const job = { cancel: false };
      exporting = job;
      const tell = (p: ExportProgress) => deps.broadcast('mail:exportChanged', p);
      try {
        const r = await exportMail(
          {
            get: (path, o) => deps.http.get(path, o),
            post: (path, body) => deps.http.post(path, body),
            source: async (uid, folder, mailbox) => {
              const resp = await deps.http.raw('GET', deps.http.url(`/api/mail/messages/${uid}/source`, { folder, download: 1, ...(mailbox ? { mailbox } : {}) }), { timeoutMs: 120_000 });
              if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
              return Buffer.from(await resp.arrayBuffer());
            },
          },
          input,
          res.filePath,
          (done, total) => tell({ done, total, state: 'running', error: null }),
          () => job.cancel,
        );
        tell({ done: r.count + r.failed, total: r.count + r.failed, state: r.cancelled ? 'cancelled' : 'done', error: null });
        deps.audit('mail.export', { format: input.format, count: r.count });
        return { ...r, name };
      } catch (e) {
        tell({ done: 0, total: 0, state: 'failed', error: (e as Error).message });
        throw new DesktopError('SERVER_ERROR', (e as Error).message);
      } finally {
        exporting = null;
      }
    });
    router.handle('mail:exportCancel', () => {
      if (exporting) exporting.cancel = true;
    });

    // Spell check's languages (worksuite-desktop#188), for the window's own session.
    router.handle('mail:spellLanguages', (_input, c) => spellState(c.sender.session));
    router.handle('mail:setSpellLanguages', (input, c) => setSpellLanguages(c.sender.session, input.languages));

    // A link from a message, after the safe-link check in the window (DMO-SEC-03).
    router.handle('mail:openLink', async (input, c) => {
      const u = new URL(input.url);
      if (!input.confirmed) return openExternalSafely(u.toString(), winOf(c.sender));
      if (u.protocol !== 'https:' && u.protocol !== 'http:') return false;
      // The person chose to go on (past a warning, or a link with none): the real address, without a name hidden before the host.
      u.username = '';
      u.password = '';
      await shell.openExternal(u.toString());
      return true;
    });

    router.handle('smime:verify', async (input) => {
      const resp = await deps.http.raw('GET', deps.http.url(`/api/mail/messages/${input.uid}/source`, { folder: input.folder, download: 1, ...(input.mailbox ? { mailbox: input.mailbox } : {}) }), { timeoutMs: 60_000 });
      if (!resp.ok) throw new DesktopError('SERVER_ERROR', 'The original of this message is not available.');
      const raw = Buffer.from(await resp.arrayBuffer());
      const from = /^From:.*?([^\s<>"]+@[^\s<>"]+)/im.exec(raw.subarray(0, 65536).toString('latin1').split(/\r?\n\r?\n/, 1)[0] ?? '')?.[1]?.toLowerCase() ?? null;
      return verifySmime(raw, from);
    });
  };

  return { files, register, openFromOs, closeAll: () => files.closeAll() };
}
