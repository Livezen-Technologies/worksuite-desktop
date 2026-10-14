import type { AccountView } from '@shared/accounts';

/**
 * How an account is named and drawn across the account UI (the switcher, the chooser, Settings › Accounts & Servers,
 * the sign-out and remove dialogs), so every place says the same thing about the same account.
 */

/** The server's host, without the scheme ("worksuite.livezentech.com"). */
export function hostOf(origin: string | null | undefined): string {
  if (!origin) return '';
  try {
    return new URL(origin).host;
  } catch {
    return origin.replace(/^[a-z]+:\/\//i, '').replace(/\/.*$/, '');
  }
}

/** The organization's name for an enterprise account, "WorkSuite Cloud" for a Personal one's server. */
export function accountName(a: Pick<AccountView, 'kind' | 'organizationName' | 'serverName'>): string {
  if (a.kind === 'personal') return 'WorkSuite Cloud';
  return a.organizationName?.trim() || a.serverName?.trim() || 'WorkSuite';
}

/** "Hasarinda · WorkSuite Cloud" for Personal; the organization for Enterprise (screen 10's rows). */
export function switcherLabel(a: AccountView): string {
  if (a.kind === 'personal') {
    const first = a.user?.name?.trim().split(/\s+/)[0];
    return first ? `${first} · WorkSuite Cloud` : 'WorkSuite Cloud';
  }
  return accountName(a);
}

/** "Personal — WorkSuite Cloud" / "Enterprise — Livezen Technologies" (Settings, screen 15). */
export function settingsTitle(a: AccountView): string {
  return a.kind === 'personal' ? 'Personal — WorkSuite Cloud' : `Enterprise — ${accountName(a)}`;
}

/** The name the chooser leads with: the person for Personal (screen 11's "Hasarinda"), the organization otherwise. */
export function chooserName(a: AccountView): string {
  if (a.kind === 'personal') return a.user?.name?.trim().split(/\s+/)[0] || 'Personal';
  return accountName(a);
}

export function isSignedIn(a: Pick<AccountView, 'signInState'>): boolean {
  return a.signInState === 'signed-in';
}

/** "Signed out", "Session expired", "Removed by your organization" — null while signed in. */
export function signInLabel(a: Pick<AccountView, 'signInState'>): string | null {
  switch (a.signInState) {
    case 'signed-out':
      return 'Signed out';
    case 'expired':
      return 'Session expired';
    case 'revoked':
      return 'Removed by your organization';
    default:
      return null;
  }
}

/** A `#rrggbb` accent from the server, or null (the theme's own colour is used). */
export function safeAccent(accent: string | null | undefined): string | null {
  return accent && /^#[0-9a-fA-F]{6}$/.test(accent) ? accent : null;
}

/** White or near-black text on `accent`, whichever reads (WCAG relative luminance). */
export function inkOn(accent: string): string {
  const n = parseInt(accent.slice(1), 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  const l = 0.2126 * ch[0]! + 0.7152 * ch[1]! + 0.0722 * ch[2]!;
  // Contrast with white (1.05 / (l + .05)) against contrast with #151A2D (≈ (l + .05) / .062).
  return 1.05 / (l + 0.05) >= (l + 0.05) / 0.062 ? '#FFFFFF' : '#151A2D';
}

/** A logo the desktop handed over (a data URL it fetched and checked); anything else is not drawn. */
export function safeLogo(logo: string | null | undefined): string | null {
  return logo && /^data:image\/(png|svg\+xml|jpeg|webp);base64,/i.test(logo) ? logo : null;
}

/** "2 h ago", "3 d ago", "just now" for `lastUsedAt`. */
export function usedAgo(iso: string | null, now = Date.now()): string | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  const min = Math.max(0, Math.round((now - t) / 60_000));
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min ago`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  return `${d} d ago`;
}

/** The changes not on the server yet, as a sentence ("1 change", "6 changes"). */
export function changes(n: number): string {
  return `${n} ${n === 1 ? 'change' : 'changes'}`;
}

/** "2 GB" from bytes, whole where it is whole. */
export function storageLabel(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let v = bytes;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  const r = Math.round(v * 10) / 10;
  return `${Number.isInteger(r) ? r.toFixed(0) : r.toFixed(1)} ${units[i]}`;
}
