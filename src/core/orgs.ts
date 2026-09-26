import { app, organizationName } from './app-state';
import { call, errorMessage, isMac } from './bridge';
import { closeTabsOutside } from './tabs';
import { toast } from './toasts';

/**
 * Switching organisation (FR-AUTH-05/06, WF-03) — from the sidebar's
 * switcher, its shortcuts (⌃0–⌃9 on macOS, Ctrl+Alt+0–9 elsewhere; ⌘/Ctrl+1–9
 * already switch tabs) and anywhere else that asks. `null` is All
 * organizations.
 */
export async function switchOrganization(id: string | null): Promise<boolean> {
  try {
    const r = await call('session:switchOrganization', { organizationId: id });
    app.set({ organizationId: r.organizationId });
    const closed = closeTabsOutside(id);
    if (closed) toast('info', `${closed} tab${closed === 1 ? '' : 's'} from another organization closed.`);
    toast('success', `Showing ${organizationName(id)}.`);
    return true;
  } catch (e) {
    toast('error', errorMessage(e));
    return false;
  }
}

/** The shortcut for slot `n` (0 = All organizations, 1–9 the list in order). */
export function orgShortcut(n: number, mac = isMac): string {
  return mac ? `Ctrl+${n}` : `Mod+Alt+${n}`;
}

const TONES = ['#0E7C86', '#6D3FC0', '#3346B8', '#B4235A', '#B45309', '#15803D', '#0369A1', '#9D174D'];

/** A company's tile colour: the same every time for the same company. */
export function orgTone(id: string): string {
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return TONES[h % TONES.length]!;
}

/** "asset_manager" → "Asset manager"; "super-admin" → "Administrator". */
export function roleLabel(role: string | null | undefined): string | null {
  if (!role) return null;
  if (role === 'super-admin') return 'Administrator';
  const t = role.replace(/[_-]+/g, ' ').trim();
  return t ? t[0]!.toUpperCase() + t.slice(1) : null;
}
