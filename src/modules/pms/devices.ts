import { call } from '../../core/bridge';

/**
 * The front desk's device agent seam (PMS-DSK-002): the desk's hardware is
 * driven through typed provider interfaces, one per kind of device, so a
 * vendor's driver slots in without the screens changing.
 *
 *   ID scanner          reads a passport or ID card; staff confirm what it read before anything is saved (PMS-IDS-002)
 *   Key encoder         writes the door key after the server's door-lock provider has issued it (PMS-KEY-001/002)
 *   Document printer    registration cards, receipts, invoices, shift and night-audit reports
 *   Signature pad       the guest signs the registration card (PMS-CKI-004)
 *   Cash drawer         opens for a cash payment or a refund
 *   Payment terminal    charges a card and answers with the provider's reference, token and last four digits (PMS-PAY-003)
 *
 * What ships is the seam and its "no device" providers, the printer that is
 * the desktop's own printing (the OS dialog, `print:print`), and the key
 * encoder through the property's on-site lock server — Salto (SHIP), Vingcard
 * (Visionline, Vostio), dormakaba (Ambiance, Saflok) — driven by the main
 * process (`electron/services/pms-locks`, `pmsLocks:*`) and registered here by
 * `locks.ts` when this computer has a lock server for the property. Without a device the desk works as a desk does — the
 * server's door-lock provider (or keys handed over by hand), the signature on
 * the screen, the card terminal's slip typed in as a card payment with its
 * reference and last four digits.
 *
 * A vendor driver needs the computer (a USB or serial device, a local agent),
 * so it belongs in the main process, reached over an IPC channel of its own
 * the way SalonMate's receipt printer and cash drawer are
 * (`electron/services/salon-print.ts`); its renderer half registers here with
 * `registerDevice(kind, provider)`. Card numbers never pass through this
 * seam: a terminal answers with a provider token and the last four digits
 * only, which is all the server accepts.
 */

export type DeviceKind = 'id_scanner' | 'key_encoder' | 'printer' | 'signature_pad' | 'cash_drawer' | 'payment_terminal';

export interface Provider {
  /** A short name for the provider ("none", a vendor's code). */
  readonly id: string;
  /** What the desk sees in the Devices panel. */
  readonly label: string;
  /** Whether a device is there to drive. The "no device" providers are never available. */
  available(): boolean;
}

/** What an ID scanner read (machine-readable zone and the like). Nothing is kept until staff confirm it. */
export interface IdScan {
  id_type: string | null;
  id_number: string | null;
  id_country: string | null;
  id_expires_on: string | null;
  date_of_birth: string | null;
  nationality: string | null;
  first_name: string | null;
  last_name: string | null;
}

export interface IdScanner extends Provider {
  scan(): Promise<IdScan | null>;
}

export interface KeyJob {
  stayId: number;
  roomNumber: string | null;
  validUntil: string;
  count: number;
  /** WorkSuite's encoder payload and its key-log job, for an on-premise lock system (`locks.ts`). */
  payload?: unknown;
  logId?: number;
}

export interface DeviceOutcome {
  ok: boolean;
  message: string;
}

export interface KeyEncoder extends Provider {
  encode(job: KeyJob): Promise<DeviceOutcome>;
}

export interface PrintJob {
  title: string;
  /** A whole page, built from the server's data (`print.ts`); printed with no script and no network. */
  html: string;
  kind: 'registration_card' | 'receipt' | 'invoice' | 'statement' | 'report';
}

export interface DocumentPrinter extends Provider {
  print(job: PrintJob): Promise<boolean>;
}

export interface SignaturePadDevice extends Provider {
  /** A PNG data URL of the signature, or null when the guest did not sign. */
  capture(prompt: string): Promise<string | null>;
}

export interface CashDrawer extends Provider {
  open(reason: 'payment' | 'refund' | 'count'): Promise<DeviceOutcome>;
}

export interface TerminalCharge {
  amount: string;
  currency: string;
  reference: string;
}

/** What a card terminal answers: the provider's reference and token, the last four digits. Never a card number. */
export interface TerminalOutcome {
  approved: boolean;
  message: string;
  provider?: string;
  provider_ref?: string;
  card_token?: string;
  card_last4?: string;
}

export interface PaymentTerminal extends Provider {
  charge(req: TerminalCharge): Promise<TerminalOutcome>;
}

export interface Devices {
  id_scanner: IdScanner;
  key_encoder: KeyEncoder;
  printer: DocumentPrinter;
  signature_pad: SignaturePadDevice;
  cash_drawer: CashDrawer;
  payment_terminal: PaymentTerminal;
}

const none = { id: 'none', available: () => false } as const;

/** The "no device" providers. */
export const NO_DEVICE: Devices = {
  id_scanner: { ...none, label: 'No ID scanner — the guest’s ID is checked by eye and ticked', scan: async () => null },
  key_encoder: { ...none, label: 'No key encoder here — keys follow the property’s door-lock system, or are handed over by hand', encode: async () => ({ ok: true, message: 'No key encoder at this desk: hand the key over.' }) },
  printer: {
    id: 'system',
    label: 'This computer’s printers (the print dialog)',
    available: () => true,
    print: async (job) => call('print:print', { html: job.html, title: job.title }),
  },
  signature_pad: { ...none, label: 'No signature pad — the guest signs on the screen', capture: async () => null },
  cash_drawer: { ...none, label: 'No cash drawer connected', open: async () => ({ ok: false, message: 'No cash drawer is connected to this desk.' }) },
  payment_terminal: { ...none, label: 'No card terminal connected — card payments are recorded from the terminal’s slip', charge: async () => ({ approved: false, message: 'No card terminal is connected to this desk.' }) },
};

const current: Devices = { ...NO_DEVICE };
const listeners = new Set<() => void>();

/** A driver's renderer half registers here; the screens ask `device(kind)` each time they need one. */
export function registerDevice<K extends DeviceKind>(kind: K, provider: Devices[K]): () => void {
  current[kind] = provider;
  for (const fn of listeners) fn();
  return () => {
    if (current[kind] === provider) current[kind] = NO_DEVICE[kind];
    for (const fn of listeners) fn();
  };
}

export function device<K extends DeviceKind>(kind: K): Devices[K] {
  return current[kind];
}

export function onDevicesChanged(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export const DEVICE_LABEL: Record<DeviceKind, string> = {
  id_scanner: 'ID / passport scanner',
  key_encoder: 'Key card encoder',
  printer: 'Registration card and receipt printer',
  signature_pad: 'Signature pad',
  cash_drawer: 'Cash drawer',
  payment_terminal: 'Card payment terminal',
};

export const DEVICE_KINDS: readonly DeviceKind[] = ['id_scanner', 'key_encoder', 'printer', 'signature_pad', 'cash_drawer', 'payment_terminal'];
