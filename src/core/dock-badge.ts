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
 * not mail, whose count covers every inbox including shared ones (see tray.ts) — and support tickets needing me,
 * counted once (FR-DSK-04).
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

/** Called with every status push; repaints only when the label changes. */
export async function updateDockBadge(status: StatusSnapshot | null, signedIn: boolean, enabled = true): Promise<void> {
  const u = status?.unread;
  // Visitors waiting on me in my website chats count with chat (worksuite-desktop#230), and so do chats ringing for me
  // until joined or silenced — the "1" on the Dock icon under the call window (R-05, R-06; RING-44).
  const label = signedIn && u && enabled ? badgeLabel(attentionCount(u.chat + (u.webchat ?? 0) + (u.ringing ?? 0), u.notifications, u.support ?? 0, u.supportNotices ?? 0)) : '';
  if (label === shown) return;
  shown = label;
  try {
    await call('app:setDockIcon', { png: await paint(label) });
  } catch {
    shown = null; // try again with the next push
  }
}
