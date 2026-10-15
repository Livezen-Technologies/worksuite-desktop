import iconUrl from '../../resources/icons/512x512.png';
import { attentionCount } from '@shared/network';
import type { StatusSnapshot } from '@shared/types';
import { call } from './bridge';

/**
 * The unread count on the macOS Dock icon (FR-TRAY-07), painted by us.
 *
 * `app.setBadgeCount()` sets the Dock tile's badge label, but macOS only draws
 * it for an app registered for notifications, and an unsigned (ad-hoc) build
 * is never registered — the label was set ("99+") and nothing showed. So the
 * count is drawn onto the icon itself, as the system badge would look, and
 * the main process swaps the Dock icon. When the count is 0 the plain icon
 * goes back. Same count as the tray: unread chat + unread notifications —
 * not mail, whose count covers every inbox including shared ones (see tray.ts) — support tickets needing me,
 * counted once (FR-DSK-04), and orders waiting on my approval, counted once (WS-OMS-SRS-001 FR-DSK-05).
 */
const SIZE = 512;

/** "7", "42", "99+" — as the Dock writes it. */
export function badgeLabel(n: number): string {
  return n <= 0 ? '' : n > 99 ? '99+' : String(n);
}

let icon: HTMLImageElement | null = null;
let shown: string | null = null;

function loadIcon(): Promise<HTMLImageElement> {
  if (icon) return Promise.resolve(icon);
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve((icon = img));
    img.onerror = reject;
    img.src = iconUrl;
  });
}

/** The icon with a red badge in its top-right corner, like the system's. */
export async function paint(label: string): Promise<string> {
  const img = await loadIcon();
  const canvas = document.createElement('canvas');
  canvas.width = SIZE;
  canvas.height = SIZE;
  const g = canvas.getContext('2d');
  if (!g) throw new Error('no 2d context');
  g.drawImage(img, 0, 0, SIZE, SIZE);
  if (label) {
    const h = 168;
    g.font = `700 ${label.length > 2 ? 96 : 112}px -apple-system, "SF Pro Text", "Helvetica Neue", sans-serif`;
    const w = Math.max(h, g.measureText(label).width + h * 0.62);
    const x = SIZE - 6 - w;
    const y = 6;
    g.save();
    g.shadowColor = 'rgba(0,0,0,.28)';
    g.shadowBlur = 10;
    g.shadowOffsetY = 3;
    g.fillStyle = '#FF3B30';
    g.beginPath();
    g.roundRect(x, y, w, h, h / 2);
    g.fill();
    g.restore();
    g.fillStyle = '#FFFFFF';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(label, x + w / 2, y + h / 2 + 5);
  }
  return canvas.toDataURL('image/png');
}

/** The count on the icon: what needs you, and the included inboxes' unread mail (ENH-MAIL-05 MNA-TRY-03). */
export function badgeCount(u: StatusSnapshot['unread']): number {
  return attentionCount(u.chat + (u.webchat ?? 0) + (u.ringing ?? 0), u.notifications, u.support ?? 0, u.supportNotices ?? 0, u.mailBadge ?? 0, u.mailNotices ?? 0, (u.salesApprovals ?? 0) + (u.purchaseApprovals ?? 0), (u.salesNotices ?? 0) + (u.purchaseNotices ?? 0));
}

/** Called with every status push; repaints only when the label changes. */
export async function updateDockBadge(status: StatusSnapshot | null, signedIn: boolean, enabled = true): Promise<void> {
  const u = status?.unread;
  // Visitors waiting on me in my website chats count with chat (worksuite-desktop#230), and so do chats ringing for me
  // until joined or silenced — the "1" on the Dock icon under the call window (R-05, R-06; RING-44).
  const label = signedIn && u && enabled ? badgeLabel(badgeCount(u)) : '';
  if (label === shown) return;
  shown = label;
  try {
    await call('app:setDockIcon', { png: await paint(label) });
  } catch {
    shown = null; // try again with the next push
  }
}

/** The Windows taskbar's overlay: a small red badge with the count (Windows has no badge count of its own). */
export async function paintOverlay(label: string): Promise<string> {
  const size = 32;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const g = canvas.getContext('2d');
  if (!g) throw new Error('no 2d context');
  g.fillStyle = '#D92D20';
  g.beginPath();
  g.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#FFFFFF';
  g.font = `700 ${label.length > 2 ? 13 : 18}px "Segoe UI", sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(label, size / 2, size / 2 + 1);
  return canvas.toDataURL('image/png');
}

let overlay: string | null = null;

/**
 * Windows: the taskbar button's overlay icon with the unread count (MNA-TRY-03), and its description — "WorkSuite —
 * 6 unread emails" — for screen readers. Repaints only when the count changes; none clears it.
 */
export async function updateTaskbarOverlay(status: StatusSnapshot | null, signedIn: boolean, enabled = true): Promise<void> {
  const u = status?.unread;
  const label = signedIn && u && enabled ? badgeLabel(badgeCount(u)) : '';
  if (label === overlay) return;
  overlay = label;
  const mail = u?.mailBadge ?? 0;
  const description = !label ? 'WorkSuite' : mail > 0 ? `WorkSuite — ${mail === 1 ? '1 unread email' : `${mail} unread emails`}` : `WorkSuite — ${label} unread`;
  try {
    await call('app:setOverlayIcon', { png: label ? await paintOverlay(label) : null, description });
  } catch {
    overlay = null;
  }
}
