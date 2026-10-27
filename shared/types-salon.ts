

/** SalonMate's front desk on this computer: pairing, printing, the outbox and the offline copy. Re-exported by shared/types.ts (audit D-G13). */

/**
 * SalonMate's front desk, as the server shapes it (`Desk::shape`). The fields
 * the desktop reads; the rest travels with it.
 */
export interface SalonDeskInfo {
  id: number;
  org_id: number;
  location_id: number;
  location: string | null;
  name: string;
  status: 'requested' | 'active' | 'revoked';
  device_id: string | null;
  register: { id: number; code: string; name: string; open: boolean; session_id: number | null; opened_at: string | null } | null;
  /** The POS till it is paired as, when it is one (POS-01). */
  till?: { id: number; code: string; name: string; revoked: boolean } | null;
  /** Where its checkouts and retail take stock from (DSK-02). */
  warehouse?: { id: number; code: string | null; name: string } | null;
  /** The receipt layout it prints with — `salon_80` or `salon_short` (POS-08). */
  receipt_template?: string;
  receipt_template_name?: string;
  approved_at: string | null;
  revoked_at: string | null;
  [field: string]: unknown;
}

/** Which desk this computer is on the signed-in server. The key never leaves the main process. */
export interface SalonDeskPairing {
  desk_id: number;
  name: string;
}

/** What the pairing screen sends (D01). The device id and app version are added in the main process. */
export interface SalonDeskPairInput {
  location_id: number;
  name: string;
  pos_register_id?: number | null;
  /** The stock location it takes from; none for the location's own. */
  warehouse_id?: number | null;
  /** The receipt layout it prints with; none for the salon receipt. */
  receipt_template?: string | null;
}

/** What a SalonMate receipt is printed on: an 80 mm or 58 mm roll, or a full page (A4, Letter). */
export type SalonPaper = '80mm' | '58mm' | 'a4' | 'letter';

/** This computer's printers for SalonMate, on one server (salon-print.ts). */
export interface SalonPrintSettings {
  receipt_printer: string | null;
  a4_printer: string | null;
  /** The receipt's paper (PRN-02): a roll, or a full page that goes to the A4 printer when there is one. */
  paper: SalonPaper;
  copies: number;
  /** Print the receipt as soon as a payment is taken. */
  auto_print: boolean;
  /** Straight to the printer, without the print dialog. */
  silent: boolean;
  /** 'printer': a drawer plugged into the receipt printer, opened by the ESC/POS pulse. */
  drawer: 'off' | 'printer';
  drawer_pin: 2 | 5;
}

export type SalonPrintPatch = Partial<SalonPrintSettings>;

/** What the front desk does while WorkSuite is out of reach (salon-outbox.ts). */
export type SalonOutboxKind = 'client.create' | 'visit.book' | 'visit.check_in' | 'visit.checkout';

export interface SalonOutboxCandidate {
  id: number;
  name: string;
  phone: string | null;
  email: string | null;
}

export interface SalonOutboxItem {
  id: string;
  seq: number;
  /** The Idempotency-Key it is sent under; a new one only for a new attempt. */
  key: string;
  kind: SalonOutboxKind;
  /** C-<uuid> or V-<uuid>, for a client or booking made here. */
  local_id: string | null;
  payload: Record<string, unknown>;
  /** The local ids it names, until the server has them. */
  needs: string[];
  /** What the counter sees: "Walk-in: Amaya Senanayake". */
  label: string;
  detail: string | null;
  created_at: string;
  updated_at: string;
  state: 'waiting' | 'refused';
  attempts: number;
  message: string | null;
  next: { starts_at: string; label?: string; date?: string } | { candidates: SalonOutboxCandidate[] } | null;
  choices: string[];
}

export interface SalonOutboxInput {
  kind: SalonOutboxKind;
  local_id?: string | null;
  payload: Record<string, unknown>;
  label: string;
  detail?: string | null;
}

export type SalonOutboxAction =
  | { id: string; action: 'drop' | 'retry' | 'take_next' }
  | { id: string; action: 'time'; starts_at: string }
  | { id: string; action: 'client'; client_id: number }
  | { id: string; action: 'edit'; changes: Record<string, string | boolean | null> };

export interface SalonSyncStatus {
  desk_id: number | null;
  /** The day's copy on this computer, for this person. */
  copy: { refreshed_at: string; pulled_at: string; visits: number; clients: number } | null;
  waiting: number;
  refused: number;
  /** Items somebody else signed in here made, waiting for them. */
  others: number;
  /** Whether WorkSuite answered the desk's last call. */
  reachable: boolean;
  last_contact: string | null;
  last_sync: { at: string; accepted: number; refused: number; duplicates: number } | null;
  problem: string | null;
  can_write: boolean;
  why_not: string | null;
  can_keep_copy: boolean;
}

/** A client in the day's copy: seen in the last year, with the worst allergy on file. */
export interface SalonCopyClient {
  id: number;
  name: string;
  phone: string | null;
  email: string | null;
  tier?: string | null;
  points?: number;
  reliability?: string | null;
  allergy?: { severity: string; substance: string } | null;
}

/** The day's copy, as the screens read it offline (clients are searched separately). */
export interface SalonCopy {
  desk_id: number;
  refreshed_at: string;
  pulled_at: string;
  timezone: string;
  location: { id: number; name: string; hours: Array<{ weekday: number | string; opens: string; closes: string }> };
  menu: unknown[];
  stylists: unknown[];
  visits: unknown[];
  settings: Record<string, unknown>;
  options: { may: Record<string, boolean>; currency?: string; company?: string; ack_severity?: string; locations?: unknown[] } | null;
  desk: SalonDeskInfo | null;
}

export interface SalonPrintOutcome {
  ok: boolean;
  printer: string | null;
  silent: boolean;
  message: string;
}
