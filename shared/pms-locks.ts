/**
 * Hotel PMS door locks on this computer: the on-site lock server the front desk talks to (Salto, Vingcard,
 * dormakaba), what crosses IPC to reach it, and the checks on it (the typed contract's `pmsLocks:*` part, spread
 * into shared/ipc/contract.ts).
 *
 * THE SERVER DECIDES THE KEY. WorkSuite's door-lock provider builds the **encoder payload** — rooms, validity,
 * common areas, the guest's name, how many cards, new or copy, laid out in the vendor's own request — and the main
 * process only frames it for the vendor's link, fills in this desk's encoder, sends it to the lock server and
 * reports back what came of it. Nothing about a key is decided here. TTLock is cloud-to-cloud (the server calls it):
 * nothing of it passes through this computer.
 *
 * The lock server's address is kept in the app's settings per WorkSuite server and property; its password or API key
 * only in the OS keystore (`SecureStore`), never on disk in the clear, never back over IPC.
 */
import { z } from 'zod';

export const LOCK_VENDORS = ['salto', 'vingcard', 'dormakaba'] as const;
export type LockVendor = (typeof LOCK_VENDORS)[number];

/** How each vendor is reached from the desk. `tcp`: a framed link (SHIP, Saflok); `http`: a JSON web interface. */
export const LOCK_CONNECTIONS = {
  salto: { ship: { label: 'SHIP to the Salto server (TCP)', link: 'tcp', port: 8090 } },
  vingcard: { visionline: { label: 'Visionline web interface (HTTPS)', link: 'http', port: 443 }, vostio: { label: 'Vostio API (HTTPS)', link: 'http', port: 443 } },
  dormakaba: { ambiance: { label: 'Ambiance web interface (HTTPS)', link: 'http', port: 443 }, saflok: { label: 'Saflok PMS interface (TCP)', link: 'tcp', port: 7000 } },
} as const satisfies Record<LockVendor, Record<string, { label: string; link: 'tcp' | 'http'; port: number }>>;

export type LockConnection = 'ship' | 'visionline' | 'vostio' | 'ambiance' | 'saflok';

export const VENDOR_LABEL: Record<LockVendor, string> = { salto: 'Salto', vingcard: 'ASSA ABLOY Vingcard', dormakaba: 'dormakaba' };

export function linkOf(vendor: LockVendor, connection: LockConnection): 'tcp' | 'http' | null {
  const c = (LOCK_CONNECTIONS[vendor] as Record<string, { link: 'tcp' | 'http' }>)[connection];
  return c ? c.link : null;
}

const host = z
  .string()
  .trim()
  .min(1)
  .max(253)
  .regex(/^[A-Za-z0-9.-]+$|^\[[0-9A-Fa-f:]+\]$/, 'A host name or an IP address.');
const printable = (max: number) =>
  z
    .string()
    .max(max)
    .regex(/^[\x20-\x7E]*$/, 'Plain characters only.');

/** What the desk keeps about a property's lock server (no secret). */
export const lockServerSchema = z.strictObject({
  vendor: z.enum(LOCK_VENDORS),
  connection: z.enum(['ship', 'visionline', 'vostio', 'ambiance', 'saflok']),
  host,
  port: z.number().int().min(1).max(65535),
  /** TLS on the link. Plain links are allowed only to the hotel's own network (a private, loopback or .local address). */
  tls: z.boolean(),
  /** The lock server's certificate, pinned (SHA-256, hex, colons allowed) — for an on-site server with its own certificate. */
  fingerprint: z
    .string()
    .trim()
    .regex(/^([0-9A-Fa-f]{2}:?){32}$/, 'A SHA-256 fingerprint.')
    .optional()
    .or(z.literal('')),
  /** This desk's encoder as the lock server names it. */
  encoder: printable(40).min(1),
  /** The interface account on the lock server (Visionline and Ambiance sign in; SHIP and Saflok usually do not). */
  username: printable(80).optional(),
  timeoutMs: z.number().int().min(1000).max(60000).optional(),
});
export type LockServer = z.infer<typeof lockServerSchema>;

export interface LockServerView extends LockServer {
  propertyId: number;
  /** Whether a password or API key is in the keystore; never the secret itself. */
  hasSecret: boolean;
  /** Whether the keystore persists (false on Linux without a keyring: the secret lives until the app quits). */
  persistent: boolean;
}

const propertyId = z.number().int().positive().max(2 ** 31);

export const lockServerSetSchema = z.strictObject({
  propertyId,
  server: lockServerSchema,
  /** A new password or API key; absent keeps the kept one. */
  secret: z.string().min(1).max(512).optional(),
  clearSecret: z.boolean().optional(),
});

/* ── The encoder payload (built by WorkSuite, `Locks/EncoderLock.php`) ────── */

const cell = printable(64);
const ENCODER = '{encoder}';

const shipFields = z.strictObject({ protocol: z.literal('ship'), command: z.enum(['CN', 'CC', 'CO', 'LT', 'ENQ']), fields: z.array(cell).max(16) });
const saflokFields = z.strictObject({ protocol: z.literal('saflok'), command: z.enum(['KN', 'KD', 'KC', 'KR', 'KT']), fields: z.array(cell).max(12) });
const httpFields = z.strictObject({
  protocol: z.enum(['visionline', 'vostio', 'ambiance']),
  method: z.enum(['GET', 'POST']),
  path: z.string().regex(/^\/api\/[A-Za-z0-9/_.?=&-]{1,200}$/, 'A path on the lock server.'),
  body: z.record(z.string(), z.unknown()).nullable(),
});

export const keyPayloadSchema = z.object({
  v: z.literal(1),
  log_id: z.number().int().positive().nullable(),
  vendor: z.enum(LOCK_VENDORS),
  connection: z.enum(['ship', 'visionline', 'vostio', 'ambiance', 'saflok']),
  operation: z.enum(['issue', 'duplicate', 'extend', 'cancel', 'read', 'test']),
  property_id: propertyId,
  stay_id: z.number().int().positive().nullable(),
  rooms: z.array(printable(60)).max(4),
  room_numbers: z.array(printable(20)).max(4),
  common_areas: z.array(printable(60)).max(40),
  valid_from: z.string().max(20),
  valid_until: z.string().max(20),
  timezone: z.string().max(64),
  guest_name: z.string().max(150),
  cards: z.number().int().min(0).max(9),
  kind: z.enum(['new', 'duplicate']),
  operator: z.string().max(150),
  vendor_fields: z.union([shipFields, saflokFields, httpFields]),
  issued_at: z.string().max(30),
  expires_at: z.string().max(30),
});
export type KeyPayload = z.infer<typeof keyPayloadSchema>;
export { ENCODER as ENCODER_PLACEHOLDER };

/** What a desk may report of a card: rooms, validity, a serial, a count — nothing else is read out or kept. */
export interface CardData {
  rooms?: string[];
  valid_from?: string;
  valid_until?: string;
  serial?: string;
  cards?: number;
}

export interface LockOutcome {
  ok: boolean;
  message: string;
  card?: CardData;
  /** Which encoder did it ("ENC1 on 10.0.0.5"), as reported to WorkSuite. */
  encoder?: string;
  ms?: number;
  /** Nothing was sent: this desk has no lock server for the property, or one for another vendor. The job stays waiting. */
  skipped?: boolean;
}

const none = z.undefined().or(z.null()).optional();

export const pmsLocksContract = {
  'pmsLocks:config': { input: z.strictObject({ propertyId }), session: true },
  'pmsLocks:configSet': { input: lockServerSetSchema, session: true, rate: 5, sensitive: true },
  'pmsLocks:forget': { input: z.strictObject({ propertyId }), session: true, rate: 5, sensitive: true },
  'pmsLocks:test': { input: z.strictObject({ propertyId }), session: true, rate: 2 },
  'pmsLocks:run': { input: z.strictObject({ propertyId, payload: keyPayloadSchema }), session: true, rate: 4, sensitive: true },
  'pmsLocks:status': { input: none, session: true },
};

export interface PmsLocksOutputs {
  'pmsLocks:config': LockServerView | null;
  'pmsLocks:configSet': LockServerView;
  'pmsLocks:forget': void;
  'pmsLocks:test': LockOutcome;
  'pmsLocks:run': LockOutcome;
  /** The properties this computer has a lock server for, on the current WorkSuite server. */
  'pmsLocks:status': { properties: number[] };
}

/** Whether a host is on the hotel's own network: private, loopback or link-local, or a `.local` name. */
export function isLocalHost(h: string): boolean {
  const s = h.replace(/^\[|\]$/g, '').toLowerCase();
  if (s === 'localhost' || s.endsWith('.local') || s.endsWith('.lan') || s.endsWith('.internal')) return true;
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(s);
  if (m) {
    const [a, b] = [Number(m[1]), Number(m[2])];
    return a === 10 || a === 127 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254);
  }
  if (s.includes(':')) return s === '::1' || s.startsWith('fc') || s.startsWith('fd') || s.startsWith('fe80');
  return false;
}

/** Why a lock server's settings cannot be used, or null. */
export function lockServerProblem(s: LockServer): string | null {
  const link = linkOf(s.vendor, s.connection);
  if (!link) return `${VENDOR_LABEL[s.vendor]} is not reached through ${s.connection}.`;
  if (!s.tls && !isLocalHost(s.host)) return 'A lock server outside the hotel’s own network needs TLS.';
  return null;
}
