import { BrowserWindow } from 'electron';
import { EventEmitter } from 'node:events';
import type { EventChannel } from '@shared/ipc/channels';

/**
 * Two buses:
 *  - `bus`: in-process events between main-process services.
 *  - `broadcast`: pushes an allow-listed event to renderer windows. Only
 *    channels in EVENT_CHANNELS exist in the preload, so nothing else could
 *    be received anyway.
 */
export const guestWindowIds = new Set<number>();

export const bus = new EventEmitter();
bus.setMaxListeners(50);

export function broadcast(channel: EventChannel, payload?: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed() || guestWindowIds.has(win.webContents.id)) continue;
    const wc = win.webContents;
    if (wc.isDestroyed() || wc.isCrashed()) continue;
    wc.send(channel, payload);
  }
}

export function sendTo(win: BrowserWindow | null | undefined, channel: EventChannel, payload?: unknown): void {
  if (!win || win.isDestroyed() || guestWindowIds.has(win.webContents.id)) return;
  win.webContents.send(channel, payload);
}
