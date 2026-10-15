import { apiGet } from '../../core/api';
import { lineDone, type RcvLine, type RcvState } from '../purchase/scan';
import type { LabelItem } from './labels';

/**
 * Receiving with a scanner on the desktop (the "Desktop receiving" design). The scan rules are Purchasing's own
 * (purchase/scan.ts — one box for the order, each item and each unit's serial; a code on no line of the order is
 * refused and changes nothing; more than is still to come is refused). This adds what the warehouse desk needs:
 *
 *  - a serial WorkSuite already knows is refused with the unit it already belongs to, before it is counted;
 *  - each line's progress, for the table;
 *  - unit labels for what was scanned, printed after each scan or all at once.
 */

/** The serialised line a scanned code would be a serial for, or null when the code is an item's (or nothing's). */
export function serialLineFor(s: Pick<RcvState, 'lines' | 'active'>, code: string): RcvLine | null {
  const c = code.trim().toLowerCase();
  if (!c) return null;
  if (s.lines.some((l) => (l.code && l.code.toLowerCase() === c) || (l.barcode && l.barcode.toLowerCase() === c))) return null;
  const active = s.lines.find((l) => l.lineId === s.active);
  return active && active.tracking === 'serial' && !lineDone(active) ? active : null;
}

export interface KnownUnit {
  product?: string | null;
  serial_no?: string | null;
  status?: string | null;
  warehouse?: string | null;
}

/** Why a serial already in WorkSuite is refused: "CN0F4K37 is already Dell Latitude 5440's unit, in stock at Kandy Branch." */
export function knownSerialText(code: string, u: KnownUnit): string {
  const where = [u.status ? u.status.replace(/_/g, ' ') : null, u.warehouse ? `at ${u.warehouse}` : null].filter(Boolean).join(' ');
  return `${u.serial_no ?? code} is already ${u.product ? `${u.product}'s unit` : 'a unit in WorkSuite'}${where ? `, ${where}` : ''}. Nothing was counted.`;
}

/** Asks WorkSuite whether a serial is a unit it already has (`GET /api/inventory/scan`). Null when it is new. */
export async function knownUnit(code: string, signal?: AbortSignal): Promise<KnownUnit | null> {
  const r = await apiGet<{ found: boolean; unit: KnownUnit | null }>('/api/inventory/scan', { code }, signal);
  return r.found && r.unit ? r.unit : null;
}

/** How far a line is, 0–100. */
export const progress = (l: Pick<RcvLine, 'accepted' | 'rejected' | 'expected'>) => (l.expected ? Math.min(100, Math.round(((l.accepted + l.rejected) / l.expected) * 100)) : 100);

/** The unit labels for the serials scanned and not printed yet, in the order they were scanned. */
export function labelsToPrint(s: Pick<RcvState, 'lines'>, printed: ReadonlySet<string>, note: string | null = null): LabelItem[] {
  return s.lines.flatMap((l) => l.serials.filter((x) => !printed.has(x)).map((x) => ({ title: l.name, code: x, note, qr: x })));
}

/** What is left to scan, in words: "One more Dell Latitude 5440 to scan." / "Everything on the order is counted." */
export function leftWords(s: Pick<RcvState, 'lines'>): string {
  const open = s.lines.filter((l) => !lineDone(l));
  if (!s.lines.length) return '';
  if (!open.length) return 'Everything on the order is counted.';
  if (open.length === 1) {
    const l = open[0]!;
    const n = l.expected - l.accepted - l.rejected;
    return n === 1 ? `One more ${l.name} to scan.` : `${n} more ${l.name} to scan.`;
  }
  const n = open.reduce((t, l) => t + (l.expected - l.accepted - l.rejected), 0);
  return `${n} more to scan on ${open.length} lines.`;
}
