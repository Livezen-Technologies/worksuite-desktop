import { z } from 'zod';

/**
 * WorkSuite Label Studio on this computer (WS-LABEL-SRS-001 v1.0 §4.27 FR-DSK-01…06, §4.20 FR-GWY-01…07, §14.3–14.4,
 * §16): what the main process does for Label Studio that a page may not do for itself.
 *
 *  - **Print host** (electron/services/label/core-print.ts): this computer's label printers — the OS's own queues and
 *    raw-TCP printers on the LAN (port 9100) — are registered with the server; the server keeps the queue, this
 *    computer claims jobs for its approved printers on a 60-second lease, fetches each signed chunk itself, checks the
 *    signature, sends the bytes raw and reports every confirmed label. The renderer never touches a printer, a
 *    socket, a file or a shell (FR-DSK-03): it asks for four things — the printers, send, status, cancel.
 *  - **Print Gateway** (electron/services/label/gateway.ts, SRS Q-03: a headless/tray mode of WorkSuite Desktop, not a
 *    new program): paired once with the server's URL and a one-time code, it holds its own device key (never a user
 *    password), makes outbound HTTPS calls only, and prints only signed jobs for its own approved printers.
 *
 * No printer language is ever made here or accepted from a page (C-07, FR-SEC-04): the bytes are the server's
 * rendering, verified against the signed envelope before they go out.
 *
 * Plain data and zod schemas shared by the main process, the IPC contract and the Label Studio screens.
 */

export const LABEL_API = '/api/labels';
export const LABEL_GATEWAY_API = '/api/label-gateways';

/** The server's single-use pairing code (FR-GWY-02): PG-XXXX-XXXX, valid for 15 minutes. */
export const PAIRING_CODE = /^PG-[A-Z0-9]{4}-[A-Z0-9]{4}$/;

/** A pairing code as typed: upper-cased, spaces dropped, the dashes put back. Null when it cannot be one. */
export function normalisePairingCode(raw: string): string | null {
  const s = raw.toUpperCase().replace(/[^A-Z0-9]/g, '');
  const body = s.startsWith('PG') && s.length === 10 ? s.slice(2) : s.length === 8 ? s : null;
  if (!body) return null;
  const code = `PG-${body.slice(0, 4)}-${body.slice(4)}`;
  return PAIRING_CODE.test(code) ? code : null;
}

/** The WorkSuite address a gateway pairs with: https only (http for this computer itself, in development). */
export function gatewayOrigin(raw: string): string | null {
  let u: URL;
  try {
    u = new URL(/^[a-z]+:\/\//i.test(raw.trim()) ? raw.trim() : `https://${raw.trim()}`);
  } catch {
    return null;
  }
  const local = u.hostname === 'localhost' || u.hostname === '127.0.0.1' || u.hostname === '[::1]';
  if (u.protocol !== 'https:' && !(u.protocol === 'http:' && local)) return null;
  if (u.username || u.password) return null;
  return u.origin;
}

/** How a printer is reached from this computer. */
export type LabelConnection = 'spooler' | 'tcp';
/** The printer languages the server renders (§12.2). The host does not speak them; it only asks a Zebra how it is. */
export type LabelLanguage = 'zpl' | 'tspl' | 'epl' | 'dpl' | 'sbpl' | 'escp' | 'pdf' | 'unknown';

/** A server printer's connection (`label_printers.connection`): an OS queue by name, or an address and port. */
export interface ServerConnection {
  kind?: string | null;
  address?: string | null;
  port?: number | null;
  os_name?: string | null;
}

/** This computer's key for the printer a server connection names: `os:<queue>` or `tcp:<address>:<port>`. */
export function printerKeyOf(c: ServerConnection | null | undefined): string | null {
  if (!c) return null;
  if (c.os_name && (c.kind === 'os' || c.kind === 'usb' || !c.address)) return `os:${c.os_name}`;
  if (c.address) return `tcp:${c.address}:${c.port ?? 9100}`;
  return null;
}

/** What a printer said, or what sending to it showed (label.printer.fault in §15.1). */
export type PrinterState = 'ready' | 'printing' | 'paused' | 'paper_out' | 'ribbon_out' | 'head_open' | 'offline' | 'error' | 'unknown';

/** A printer on this computer: an OS queue, or a raw-TCP printer on the LAN added here. */
export interface LocalPrinter {
  /** This computer's own key for it: `os:<queue name>` or `tcp:<address>:<port>`. */
  key: string;
  name: string;
  connection: LabelConnection;
  /** The OS queue's name, or the LAN address and port. */
  address: string;
  port: number | null;
  language: LabelLanguage;
  isDefault: boolean;
  /** The server's printer id, once offered to WorkSuite, and whether an administrator approved it (FR-GWY-05). */
  serverId: string | null;
  approved: boolean;
  state: PrinterState;
  stateAt: string | null;
  message: string | null;
}

/** A printer found on the LAN (D04's "Discover"): something answering on 9100. */
export interface DiscoveredPrinter {
  address: string;
  port: number;
  /** What it said to `~HI` (a Zebra's model and firmware), when it answered. */
  model: string | null;
  language: LabelLanguage;
  added: boolean;
}

/** One job as this computer is running it: its local queue (FR-DSK-06), kept across a restart. */
export type HostJobState = 'queued' | 'printing' | 'waiting_printer' | 'paused' | 'interrupted' | 'done' | 'cancelled' | 'failed';

export interface HostJob {
  id: string;
  ref: string | null;
  template: string | null;
  printerId: string;
  printerKey: string | null;
  total: number;
  confirmed: number;
  sequence: boolean;
  state: HostJobState;
  /** Labels that may or may not have come out (a send cut off part-way, or this computer stopped mid-chunk): D05. */
  uncertain: { from: number; to: number } | null;
  error: string | null;
  printerState: PrinterState | null;
  updatedAt: string;
}

export interface HostStatus {
  enabled: boolean;
  hostId: string | null;
  registeredAt: string | null;
  lastClaimAt: string | null;
  problem: string | null;
  printers: LocalPrinter[];
  jobs: HostJob[];
}

export interface HostSettings {
  /** Claim and print the server's jobs for this computer's registered printers. */
  host: boolean;
  /** The print station's printer (D03), by key. */
  stationPrinter: string | null;
  /** LAN printers added on this computer. */
  lan: Array<{ address: string; port: number; name: string; language: LabelLanguage }>;
}

export type GatewayConnection = 'unpaired' | 'connecting' | 'online' | 'offline' | 'revoked';

export interface GatewayStatus {
  paired: boolean;
  connection: GatewayConnection;
  gatewayId: string | null;
  name: string | null;
  server: string | null;
  org: number | null;
  pairedAt: string | null;
  lastHeartbeatAt: string | null;
  tokenExpiresAt: string | null;
  /** Where the device key is kept: the OS key store, or a 0600 file on a headless build with none (§16). */
  keyStore: 'os' | 'file' | 'memory' | null;
  /** Started as the gateway (`--print-gateway`): tray only, no window until one is asked for. */
  headless: boolean;
  /** Starts with the OS as the gateway (the D07 switch). */
  autostart: boolean;
  version: string;
  updateChannel: string | null;
  /** The printers registered to this gateway — the only ones it prints to (FR-GWY-04). */
  printers: Array<{ id: string; name: string; key: string; approved: boolean; state: PrinterState }>;
  /** The job printing now, with per-label progress (D07). */
  current: { id: string; ref: string | null; printer: string; confirmed: number; total: number } | null;
  /** The last signature check: a job refused for a bad signature, expiry, company or printer shows here. */
  lastCheck: { job: string; ok: boolean; reason: string | null; at: string } | null;
  problem: string | null;
}

export type ReconcileDecision = 'printed' | 'reprint' | 'void' | 'stop';

const key = z.string().regex(/^(os|tcp):[^\0\n\r]{1,300}$/);
const jobId = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);
const lanAddress = z.string().regex(/^(?:\d{1,3}\.){3}\d{1,3}$/).refine((s) => s.split('.').every((p) => Number(p) <= 255), 'Not an IPv4 address.');
const language = z.enum(['zpl', 'tspl', 'epl', 'dpl', 'sbpl', 'escp', 'pdf', 'unknown']);

export const labelLanPrinter = z.strictObject({ address: lanAddress, port: z.number().int().min(1).max(65535).default(9100), name: z.string().trim().min(1).max(80), language: language.default('zpl') });
export const labelSettingsPatch = z.strictObject({
  host: z.boolean().optional(),
  stationPrinter: key.nullable().optional(),
  addLan: labelLanPrinter.optional(),
  removeLan: key.optional(),
});
export type LabelSettingsPatch = z.input<typeof labelSettingsPatch>;

const none = z.undefined().or(z.null()).optional();

export const labelContract = {
  // The four calls of §16 (FR-DSK-03).
  'label:listPrinters': { input: none, session: true, rate: 10 },
  'label:send': { input: z.strictObject({ job_id: jobId, chunk: z.number().int().min(0).max(100_000).optional() }), session: true, rate: 10 },
  'label:status': { input: none, session: true, rate: 30 },
  'label:cancel': { input: z.strictObject({ job_id: jobId }), session: true, rate: 5 },
  // D04 and D05.
  'label:discover': { input: none, session: true, rate: 1 },
  'label:settings': { input: none, session: true },
  'label:settingsSet': { input: labelSettingsPatch, session: true, rate: 5 },
  'label:register': { input: none, session: true, rate: 2 },
  'label:resolve': { input: z.strictObject({ job_id: jobId, decision: z.enum(['printed', 'reprint', 'void', 'stop']), reason: z.string().trim().min(3).max(300), last_printed: z.number().int().min(0).optional() }), session: true, rate: 3, sensitive: true },
  // The Print Gateway (D06, D07).
  'labelGateway:status': { input: none, rate: 20 },
  'labelGateway:pair': { input: z.strictObject({ url: z.string().min(3).max(300), code: z.string().min(8).max(20), name: z.string().trim().min(1).max(80) }), session: true, rate: 2, sensitive: true },
  'labelGateway:unpair': { input: none, session: true, rate: 2, sensitive: true },
  'labelGateway:headless': { input: z.strictObject({ enabled: z.boolean() }), session: true, rate: 2, sensitive: true },
};

export interface LabelOutputs {
  'label:listPrinters': LocalPrinter[];
  'label:send': HostJob;
  'label:status': HostStatus;
  'label:cancel': HostJob | null;
  'label:discover': DiscoveredPrinter[];
  'label:settings': HostSettings;
  'label:settingsSet': HostSettings;
  'label:register': HostStatus;
  'label:resolve': HostJob;
  'labelGateway:status': GatewayStatus;
  'labelGateway:pair': GatewayStatus;
  'labelGateway:unpair': GatewayStatus;
  'labelGateway:headless': GatewayStatus;
}
