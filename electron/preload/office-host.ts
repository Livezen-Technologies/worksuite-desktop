import { contextBridge, ipcRenderer } from 'electron';

/**
 * The editor view's only bridge (WorkSuite Office, `shared/office.ts`): the
 * page takes commands for the editor and passes the editor's events back.
 * Nothing else of the desktop is here — no `window.worksuite`, no invoke, no
 * file, no token — and the main process checks every event again: that it
 * came from this view, that its name is one the editor has, and its size.
 */
let listening = false;

contextBridge.exposeInMainWorld('officeHost', {
  onCommand(cb: (cmd: unknown) => void): void {
    if (listening) return;
    listening = true;
    ipcRenderer.on('office-host:command', (_e, cmd: unknown) => cb(cmd));
  },
  emit(build: unknown, type: unknown, data: unknown): void {
    if (typeof build !== 'number' || typeof type !== 'string') return;
    ipcRenderer.send('office-host:event', { build, type, data });
  },
  ready(): void {
    ipcRenderer.send('office-host:ready');
  },
});
