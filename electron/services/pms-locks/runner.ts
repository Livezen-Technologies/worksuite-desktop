import type { CardData, KeyPayload, LockOutcome, LockServer } from '@shared/pms-locks';
import { ENCODER_PLACEHOLDER } from '@shared/pms-locks';

/** A vendor's half on the desk: run WorkSuite's payload against the on-site lock server, and test the link. */
export interface Runner {
  run(server: LockServer, secret: string | null, payload: KeyPayload): Promise<LockOutcome>;
  test(server: LockServer, secret: string | null): Promise<LockOutcome>;
}

/** The payload's `{encoder}` cells become this desk's encoder; nothing else in it is changed. */
export function fillEncoder<T>(value: T, encoder: string): T {
  if (value === ENCODER_PLACEHOLDER) return encoder as unknown as T;
  if (Array.isArray(value)) return value.map((v) => fillEncoder(v, encoder)) as unknown as T;
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = fillEncoder(v, encoder);
    return out as T;
  }
  return value;
}

/** What a successful write means for the card, from the payload (the lock server answered "done"). */
export function writtenCard(p: KeyPayload): CardData | undefined {
  if (p.operation === 'cancel' || p.operation === 'test' || p.operation === 'read') return undefined;
  return { rooms: p.room_numbers, valid_until: p.valid_until, cards: p.cards };
}

/** "yyyyMMddHHmm" → "yyyy-MM-dd HH:mm". */
export function fromCompact(s: string | undefined): string | undefined {
  const m = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})$/.exec(s ?? '');
  return m ? `${m[1]}-${m[2]}-${m[3]} ${m[4]}:${m[5]}` : undefined;
}

/** SHIP's "hhmmDDMMYY" → "20YY-MM-DD hh:mm". */
export function fromShip(s: string | undefined): string | undefined {
  const m = /^(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/.exec(s ?? '');
  return m ? `20${m[5]}-${m[4]}-${m[3]} ${m[1]}:${m[2]}` : undefined;
}

export const what = (p: KeyPayload): string =>
  ({ issue: 'Card encoded', duplicate: 'Copy encoded', extend: 'Card encoded with the new time', cancel: 'Key cancelled', read: 'Card read', test: 'The lock server answered' })[p.operation];

/** A lock server's text as the desk shows it: control characters out, cut to length. */
export function clip(s: unknown, n = 200): string {
  return [...String(s ?? '')]
    .map((ch) => {
      const c = ch.charCodeAt(0);
      return c < 0x20 || c === 0x7f ? ' ' : ch;
    })
    .join('')
    .trim()
    .slice(0, n);
}
