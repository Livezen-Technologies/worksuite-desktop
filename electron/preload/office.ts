import { contextBridge, ipcRenderer } from 'electron';

/**
 * The Office editor's bridge (OO-DSK-022): the only thing the editor's page
 * (`wsoffice://editor`, its own partition and process) gets from the
 * desktop. It reports that the page is ready, the editor's events, and a
 * failure to load the Document Server's script; it takes commands for the
 * editor. No WorkSuite API, no token, no files, no shell, no process — and
 * none of the shell's `window.worksuite`. The main process accepts these
 * messages only from an editor view's own main frame, and checks each one.
 */
let listening = false;

contextBridge.exposeInMainWorld('officeBridge', {
  ready: (): void => ipcRenderer.send('office-host:ready'),
  failed: (reason: unknown): void => ipcRenderer.send('office-host:failed', String(reason).slice(0, 16)),
  emit: (type: unknown, data: unknown): void => ipcRenderer.send('office-host:event', { type: String(type).slice(0, 64), data }),
  onCommand: (cb: (command: unknown) => void): void => {
    if (listening) return;
    listening = true;
    ipcRenderer.on('office-host:command', (_e, command: unknown) => cb(command));
  },
});
