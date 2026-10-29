import type { PosLocalState } from '@shared/pos';
import type { PosPermission, PosRole } from '@shared/pos-local';
import { ROLE_PERMISSIONS } from '@shared/pos-local';

/**
 * Which screen the offline till is on (ENH-POS-01 §1, phase 3). A pure function of what the main process said, so
 * the screen never decides for itself what it is allowed to show — the state comes from `posLocal:state`, and
 * every action is checked again in the main process whatever this returns.
 */
export type TillScreen = 'loading' | 'first-run' | 'sign-in' | 'change-password' | 'closed' | 'selling';

export function screenFor(state: PosLocalState | null, registerOpen: boolean): TillScreen {
  if (!state) return 'loading';
  if (state.empty) return 'first-run';
  if (!state.signedIn) return 'sign-in';
  if (state.mustChangePassword) return 'change-password';
  return registerOpen ? 'selling' : 'closed';
}

/** What the signed-in person may do, for hiding buttons. The main process refuses regardless. */
export function can(state: PosLocalState | null, permission: PosPermission): boolean {
  return !!state?.signedIn && (state.permissions as string[]).includes(permission);
}

/** The roles an owner may hand out, which is all of them; a manager hands out none. */
export function grantableBy(role: PosRole | undefined): PosRole[] {
  return role === 'owner' ? (Object.keys(ROLE_PERMISSIONS) as PosRole[]) : [];
}

/** Money in and out of the till is whole cents; the screens take what a person types. */
export function parseMoney(typed: string): number | null {
  const clean = typed.replace(/[^\d.]/g, '');
  if (!clean || !/^\d*\.?\d{0,2}$/.test(clean)) return null;
  const n = Math.round(Number(clean) * 100);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/** 123456 → "1,234.56". The till's own currency is a setting; the symbol is left to the caller. */
export function money(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  const n = Math.abs(cents);
  return `${sign}${Math.floor(n / 100).toLocaleString()}.${String(n % 100).padStart(2, '0')}`;
}
