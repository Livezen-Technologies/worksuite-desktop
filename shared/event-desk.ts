import { z } from 'zod';

/**
 * WorkSuite Events' desk on this computer (Events SRS §15.2 [D], §9, §8.4):
 * what the renderer may ask the main process, what it is told, and the rules
 * both sides share. Pure — no Electron, no network — so the tests run it as
 * it runs in the app.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE SERVER DECIDES; OFFLINE, ITS OWN RULES DECIDE
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Online, a scan is the server's (`POST events/{id}/scan|check-in|check-out`)
 * and the desk shows its answer as it came. Offline, the server's contract
 * (web-api-b1 "Offline") says what to do instead: the device matches the
 * scanned text against its copy by `HMAC-SHA256(text trimmed and in capitals,
 * device key)` and applies `ScanRules` with the copy's `rules`. `scanRules()`
 * below is that pure function, line for line with the server's
 * `Flow\ScanRules::checkIn()` — the order of its checks and its sentences —
 * so the desk cannot answer a ticket differently from the gate beside it.
 *
 * The device key never reaches a renderer: the main process keeps it in the
 * OS credential store and does the matching (electron/services/event-desk.ts).
 */

const id = z.number().int().positive().max(2_147_483_647);

/* ── IPC inputs ─────────────────────────────────────────────────────────── */

export const deskEventRef = z.object({ event_id: id });
export const deskRegisterInput = z.object({ event_id: id, gate_id: id.nullable(), name: z.string().trim().min(1).max(120) });
export const deskForgetInput = z.object({ event_id: id, discard: z.boolean().optional() });
/** What was scanned or picked: a QR's text or a typed registration number, or a registration from the search. */
export const deskScanInput = z
  .object({
    event_id: id,
    code: z.string().trim().min(1).max(200).optional(),
    registration_id: id.optional(),
    /** scan = the verdict (and the gate's own automatic check-in); check_in / check_out = the buttons. */
    mode: z.enum(['scan', 'check_in', 'check_out']),
  })
  .refine((v) => (v.code === undefined) !== (v.registration_id === undefined), 'give the scanned code or a registration');
export const deskSearchInput = z.object({ event_id: id, q: z.string().max(120), limit: z.number().int().min(1).max(50).optional() });
export const deskQueueAction = z.object({ event_id: id, client_uuid: z.string().regex(/^[A-Za-z0-9_\-:.]{8,64}$/), action: z.enum(['retry', 'drop']) });
/** A walk-in kept offline (EV-OFF-006): the server registers it when the queue goes up. */
export const deskWalkInInput = z.object({
  event_id: id,
  ticket_type_id: id,
  answers: z.record(z.string().regex(/^[a-z0-9_]{1,64}$/), z.union([z.string().max(2000), z.boolean(), z.number(), z.array(z.string().max(200)).max(50), z.null()])),
});
export const deskPrintSettingsPatch = z
  .object({
    badge_printer: z.string().trim().min(1).max(200).nullable(),
    silent: z.boolean(),
    page: z.enum(['template', 'printer']),
    printer_name: z.string().trim().max(120).nullable(),
    take_phone_jobs: z.boolean(),
  })
  .partial();
export const deskPrintJobsInput = z.object({ event_id: id, job_ids: z.array(id).min(1).max(50) });

export type DeskScanMode = z.infer<typeof deskScanInput>['mode'];
export type DeskWalkIn = z.infer<typeof deskWalkInInput>;
export type DeskPrintPatch = z.infer<typeof deskPrintSettingsPatch>;

/* ── What the server sends (the parts the desk reads) ───────────────────── */

/** An instant as the server writes it: `{utc, local, date, time, zone}` in the event's zone. */
export interface When {
  utc: string;
  local: string;
  date: string;
  time: string;
  zone: string;
}

export interface CopyPresence {
  /** The attendance day (the event's local date) under daily check-in; null once per event. */
  day: string | null;
  state: string;
  entries: number;
  last_in: string | null;
  last_gate_id: number | null;
}

/** One registration in the device's copy (`GET events/{id}/checkin/bootstrap` items). No email, phone, address or amount. */
export interface CopyRow {
  id: number;
  number: string;
  name: string;
  company: string | null;
  ticket_type_id: number;
  status: string;
  payment_due: boolean;
  hash: string | null;
  ticket_active: boolean;
  revoked: string | null;
  photo_file_id: number | null;
  presence: CopyPresence[];
}

export interface CopyEvent {
  id: number;
  name: string;
  status: string;
  timezone: string;
  start: When | null;
  end: When | null;
  checkin_policy: string;
  reentry_allowed: boolean;
  days: Array<{ day: number; date: string; label: string; start: When | null; end: When | null }>;
}

export interface CopyTicketType {
  id: number;
  name: string;
  role: string;
  access_days: number[] | null;
  allowed_gate_ids: number[] | null;
  reentry: boolean;
  daily_checkin: boolean;
  admitted_here: boolean;
}

export interface CopyRules {
  duplicate_behavior: string;
  require_payment: string;
  auto_checkin: boolean;
  photo_verification: boolean;
  walk_ins: boolean;
}

export interface CopyGate {
  id: number;
  name: string;
  direction: string;
  active: boolean;
  auto_print: boolean;
}

/** The device's whole copy of the event, as the main process keeps it (encrypted) and reads it. */
export interface DeskCopy {
  event: CopyEvent;
  gate: CopyGate | null;
  ticket_types: CopyTicketType[];
  rules: CopyRules;
  rows: CopyRow[];
  /** The last domain event the copy has seen (`changes?after=`). */
  cursor: number;
  cache_expires: When | null;
  generated: When | null;
  total: number;
  warning: string | null;
}

/** The scan view (`POST events/{id}/scan|check-in|check-out`), and the desk's own offline one in the same shape. */
export interface ScanView {
  result: ScanResult;
  action: 'CHECK_IN' | 'CHECK_OUT' | null;
  colour: string;
  label: string;
  reason: string;
  warning: string | null;
  done: boolean;
  via: 'qr' | 'number' | 'registration';
  attendee: { name: string; company: string | null; job_title?: string | null; photo_file_id: number | null } | null;
  ticket: { id: number; name: string; role: string; access_days: number[] | null; allowed_gates?: Array<{ id: number; name: string } | null> } | null;
  registration: { id: number; number: string; status: string; status_label: string; payment_status: string | null } | null;
  presence: {
    state: string;
    state_label: string;
    day: string | null;
    entries: number;
    first_in?: When | null;
    last_in: When | string | null;
    last_out?: When | null;
    last_gate?: { id: number; name: string } | null;
  } | null;
  options: string[];
  checkin_event_id: number | null;
  replayed?: boolean;
}

/** What a scan at this desk came to: the server's answer, or — WorkSuite out of reach — the desk's own from its copy. */
export type DeskScanOutcome =
  | { source: 'server'; view: ScanView; message: string | null; badge: BadgeJob | null }
  | { source: 'local'; view: ScanView; message: string; queued: boolean; badge: null }
  | { source: 'refused'; status: number; code: string | null; message: string; wipe: boolean };

export interface BadgeJob {
  id: number;
  registration: { id: number; number: string; name: string | null; company: string | null } | null;
  template: { id: number; name: string } | null;
  status: string;
  status_label: string;
  reprint: boolean;
  printer: string | null;
  version: number;
}

/** This computer at an event: its device there, never its key. */
export interface DeskRegistration {
  event_id: number;
  event_name: string;
  org_id: number | null;
  device_id: number;
  device_name: string;
  gate_id: number | null;
  gate_name: string | null;
  registered_at: string;
}

export interface DeskQueueItem {
  client_uuid: string;
  device_sequence: number;
  action: 'CHECK_IN' | 'CHECK_OUT' | 'WALK_IN';
  occurred_at: string;
  local_result: ScanResult;
  /** What the desk showed: a name and a number, for the list. */
  label: string;
  detail: string | null;
  state: 'waiting' | 'recorded' | 'replayed' | 'conflict' | 'rejected';
  /** The server's flag once sent: POSSIBLE_DUPLICATE, CANCELLED_OFFLINE, UNKNOWN_TOKEN, PROVISIONAL_WALK_IN. */
  flag: string | null;
  message: string | null;
  reconciliation_id: number | null;
  provisional_number: string | null;
  registration_number: string | null;
}

export interface DeskStatus {
  event_id: number;
  registration: DeskRegistration | null;
  /** The device as the server last described it (status, gate, trusted…), when it has been asked. */
  device: { status: string; status_label: string; online: boolean; trusted: boolean | null; queue_size: number; last_sync: When | null } | null;
  reachable: boolean;
  last_contact: string | null;
  last_sync: { at: string; accepted: number; duplicates: number; conflicts: number; rejected: number } | null;
  copy: { rows: number; total: number; refreshed_at: string; pulled_at: string; cache_expires: When | null; event_status: string; gate: string | null; warning: string | null } | null;
  waiting: number;
  rejected: number;
  flagged: number;
  /** Scans another person made at this desk offline: they go up when that person signs in here. */
  others: number;
  /** Why this desk cannot check in offline now (policy, the event's setting, no copy yet), or null. */
  offline_blocked: string | null;
  /** What the server said last time it refused this desk (suspended, not trusted, key missing…), in its words. */
  problem: { code: string | null; message: string } | null;
  /** The device was revoked and this computer's copy wiped (EV-CHK-033). */
  wiped: string | null;
}

export interface DeskSearchHit {
  registration_id: number;
  number: string;
  name: string;
  company: string | null;
  ticket: { id: number; name: string };
  status: string;
  status_label: string;
  payment_due: boolean;
  presence: { state: string; last_in: string | null };
}

export interface DeskPrintSettings {
  /** The badge printer (the OS's name for it); null = the OS print dialog each time. */
  badge_printer: string | null;
  /** Straight to the badge printer, without the dialog. */
  silent: boolean;
  /** template = the page is the badge template's size; printer = the label size the printer is loaded with. */
  page: 'template' | 'printer';
  /** The name phones and other desks send badges to (`badge/print` with `printer`). */
  printer_name: string | null;
  /** Take the badges sent to that name, while the desk is open. */
  take_phone_jobs: boolean;
}

export interface DeskPrintOutcome {
  ok: boolean;
  printed: number[];
  failed: number[];
  message: string;
}

/* ── ScanRules, as the server has it ────────────────────────────────────── */

export const SCAN_RESULTS = {
  VALID: ['Valid', 'green'],
  ALREADY_CHECKED_IN: ['Already checked in', 'amber'],
  CANCELLED: ['Cancelled', 'red'],
  PAYMENT_REQUIRED: ['Payment required', 'red'],
  WRONG_DAY: ['Not valid today', 'red'],
  INVALID_TICKET: ['Invalid ticket', 'red'],
  EVENT_NOT_ACTIVE: ['Event not active', 'red'],
  ACCESS_DENIED: ['Access denied', 'red'],
} as const;

export type ScanResult = keyof typeof SCAN_RESULTS;

export const SCAN_RESULT_KEYS = Object.keys(SCAN_RESULTS) as ScanResult[];

/** `Flow\TicketTokenMachine::REASONS`. */
export const REVOKE_REASONS: Readonly<Record<string, string>> = {
  cancelled: 'The registration was cancelled.',
  transferred: 'The ticket was transferred to somebody else.',
  substituted: 'Another person was named for this seat.',
  reissued: 'A new ticket was issued in its place.',
  unconfirmed: 'The registration is no longer confirmed.',
  anonymized: "The attendee's data was erased.",
};

/** `Flow\RegistrationMachine` labels. */
export const REGISTRATION_LABELS: Readonly<Record<string, string>> = {
  DRAFT: 'Draft',
  PENDING: 'Pending',
  PENDING_PAYMENT: 'Pending payment',
  PENDING_APPROVAL: 'Pending approval',
  CONFIRMED: 'Confirmed',
  WAITLISTED: 'Waitlisted',
  CANCELLED: 'Cancelled',
  REJECTED: 'Rejected',
  NO_SHOW: 'No-show',
  COMPLETED: 'Completed',
};

/** `Flow\PresenceMachine` labels. */
export const PRESENCE_LABELS: Readonly<Record<string, string>> = { NOT_ARRIVED: 'Not arrived', INSIDE: 'Inside', OUTSIDE: 'Checked out' };

export interface ScanFacts {
  token_known?: boolean;
  token_active?: boolean;
  revoke_reason?: string | null;
  scope_ok?: boolean;
  event_status?: string;
  in_window?: boolean;
  registration_status?: string;
  payment_settled?: boolean;
  require_payment?: string;
  day_allowed?: boolean;
  valid_days?: Array<number | string>;
  gate_allowed?: boolean;
  presence?: string;
  reentry_allowed?: boolean;
  duplicate_behavior?: string;
}

export interface Verdict {
  result: ScanResult;
  action: 'CHECK_IN' | 'CHECK_OUT' | null;
  colour: string;
  label: string;
  reason: string;
  warning: string | null;
}

/**
 * `Flow\ScanRules::checkIn()`: the verdict on the facts, checks in the
 * server's order (so a ticket with two problems is given the same reason).
 * A fact left out is not checked, as on the server.
 */
export function scanRules(f: ScanFacts): Verdict {
  const out = (r: ScanResult, why: string, action: Verdict['action'] = null, warn: string | null = null): Verdict => ({
    result: r,
    action,
    colour: SCAN_RESULTS[r][1],
    label: SCAN_RESULTS[r][0],
    reason: why,
    warning: warn,
  });

  if (!f.token_known) return out('INVALID_TICKET', 'This code is not a ticket for this event.');
  if (!f.token_active && (f.revoke_reason ?? '') !== 'cancelled') {
    return out('INVALID_TICKET', REVOKE_REASONS[f.revoke_reason ?? ''] ?? 'This ticket is no longer valid.');
  }
  if (f.scope_ok !== undefined && !f.scope_ok) return out('ACCESS_DENIED', 'You are not assigned to check in at this event or gate.');
  if ((f.event_status ?? '') !== 'LIVE' || (f.in_window !== undefined && !f.in_window)) return out('EVENT_NOT_ACTIVE', 'Check-in is not open for this event now.');

  const status = f.registration_status ?? '';
  if (status === 'CANCELLED' || status === 'REJECTED' || !f.token_active) return out('CANCELLED', 'The registration is cancelled.');
  if (status === 'PENDING_PAYMENT') return out('PAYMENT_REQUIRED', 'The registration is waiting for its payment: take it to confirm the ticket.');
  if (!['CONFIRMED', 'NO_SHOW', 'COMPLETED'].includes(status)) return out('INVALID_TICKET', 'The registration is not confirmed.');

  let warn: string | null = null;
  if (f.payment_settled !== undefined && !f.payment_settled) {
    const policy = f.require_payment ?? 'block';
    if (policy === 'block') return out('PAYMENT_REQUIRED', 'Payment is outstanding on this ticket.');
    warn = policy === 'warn' ? 'Payment is outstanding.' : null;
  }

  if (f.day_allowed !== undefined && !f.day_allowed) {
    const days = (f.valid_days ?? []).map(String).join(', ');
    return out('WRONG_DAY', `This ticket is not valid today${days !== '' ? ` (valid: ${days})` : ''}.`);
  }
  if (f.gate_allowed !== undefined && !f.gate_allowed) return out('ACCESS_DENIED', 'This ticket does not admit at this gate.');

  const presence = f.presence ?? 'NOT_ARRIVED';
  const again = presence === 'INSIDE' || (presence === 'OUTSIDE' && !f.reentry_allowed);
  if (again) {
    const behaviour = f.duplicate_behavior ?? 'warn';
    if (behaviour === 'checkout' && presence === 'INSIDE') return out('VALID', 'Checked out: the ticket was already inside.', 'CHECK_OUT', warn);
    if (behaviour === 'warn' && presence === 'INSIDE') {
      return out('VALID', 'Already inside — let in again as the policy allows.', 'CHECK_IN', `Already checked in. ${warn ?? ''}`.trim());
    }
    return out('ALREADY_CHECKED_IN', presence === 'INSIDE' ? 'This ticket is already inside.' : 'Re-entry is not allowed on this ticket.');
  }

  return out('VALID', 'Welcome.', 'CHECK_IN', warn);
}

/** `Flow\ScanRules::checkOutRefusal()`. */
export function checkOutRefusal(f: { token_known: boolean; presence?: string }): string | null {
  if (!f.token_known) return 'This code is not a ticket for this event.';
  return (f.presence ?? 'NOT_ARRIVED') === 'INSIDE' ? null : 'This ticket is not checked in.';
}

/* ── The copy: matching and facts ───────────────────────────────────────── */

/** What the hash is taken of: the QR text as scanned, trimmed and in capitals (`OfflineSync` "hash.input"). */
export function normalizeCode(code: string): string {
  return code.trim().toUpperCase();
}

/** `Tokens::looksLikeQr()`: "EV1-" and 32 base-32 characters. */
export function looksLikeQr(code: string): boolean {
  return /^EV1-[A-Z2-7]{32}$/.test(code.trim());
}

/** A date on the event's calendar (`YYYY-MM-DD` in its zone). */
export function localDate(tz: string, at: number): string {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: tz || 'UTC', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(at));
  } catch {
    return new Date(at).toISOString().slice(0, 10);
  }
}

const utcOf = (w: When | null | undefined): number => (w?.utc ? Date.parse(w.utc) : NaN);

/**
 * The event's status as the gate should read it now. The server's sweep takes
 * a PUBLISHED event LIVE at its start, every minute (`EventMachine` edge
 * `auto_start`, guard `started`): a copy taken before the doors opened, read
 * after WorkSuite went out of reach, would otherwise refuse everybody.
 */
export function gateEventStatus(event: Pick<CopyEvent, 'status' | 'start'>, at: number): string {
  const start = utcOf(event.start);
  return event.status === 'PUBLISHED' && Number.isFinite(start) && start <= at ? 'LIVE' : event.status;
}

/** `CheckIn::dayKey()`: the event-local date under daily check-in, '' once per event. */
export function dayKeyFor(copy: Pick<DeskCopy, 'event'>, ticket: Pick<CopyTicketType, 'daily_checkin'> | null, at: number): string {
  const daily = ticket ? ticket.daily_checkin : copy.event.checkin_policy === 'DAILY';
  return daily ? localDate(copy.event.timezone, at) : '';
}

/** The registration's presence for a day key ('' = once per event). */
export function presenceFor(row: Pick<CopyRow, 'presence'>, key: string): CopyPresence {
  const day = key === '' ? null : key;
  return row.presence.find((p) => (p.day ?? null) === day) ?? { day, state: 'NOT_ARRIVED', entries: 0, last_in: null, last_gate_id: null };
}

export type CopyMatch = { row: CopyRow; via: 'qr' | 'number' | 'registration' };

/**
 * `CheckIn::facts()` from the copy. A ticket matched by its QR is as alive as
 * that ticket; one picked by number or from the search is as alive as the
 * registration. The person's own gates were checked when the copy was given
 * (the server refuses a copy at a gate they are not kept to).
 */
export function copyFacts(copy: DeskCopy, match: CopyMatch | null, at: number): ScanFacts {
  if (!match) return { token_known: false };
  const { row, via } = match;
  const tt = copy.ticket_types.find((t) => t.id === row.ticket_type_id) ?? null;
  const dead = row.status === 'CANCELLED' || row.status === 'REJECTED';
  const access = (tt?.access_days ?? []).map(Number);
  const today = localDate(copy.event.timezone, at);
  const dayNo = access.length === 0 ? null : (copy.event.days.find((d) => d.date === today)?.day ?? null);
  const gate = copy.gate;
  return {
    token_known: true,
    token_active: via === 'qr' ? row.ticket_active : !dead,
    revoke_reason: via === 'qr' ? row.revoked : dead ? 'cancelled' : null,
    event_status: gateEventStatus(copy.event, at),
    registration_status: row.status,
    payment_settled: !row.payment_due,
    require_payment: copy.rules.require_payment,
    day_allowed: access.length === 0 || (dayNo !== null && access.includes(dayNo)),
    valid_days: access,
    gate_allowed: !!tt && tt.admitted_here && (gate === null || (gate.active && gate.direction !== 'OUT')),
    presence: presenceFor(row, dayKeyFor(copy, tt, at)).state,
    reentry_allowed: tt?.reentry ?? copy.event.reentry_allowed,
    duplicate_behavior: copy.rules.duplicate_behavior,
  };
}

/** What a code or a picked registration is in the copy. `hashOf` is the main process's HMAC under the device key. */
export function matchInCopy(rows: CopyRow[], input: { code?: string; registration_id?: number }, hashOf: (text: string) => string): CopyMatch | null {
  if (input.registration_id) {
    const row = rows.find((r) => r.id === input.registration_id);
    return row ? { row, via: 'registration' } : null;
  }
  const code = normalizeCode(input.code ?? '');
  if (code === '') return null;
  if (looksLikeQr(code)) {
    const h = hashOf(code);
    const row = rows.find((r) => r.hash === h);
    return row ? { row, via: 'qr' } : null;
  }
  const row = rows.find((r) => r.number.toUpperCase() === code);
  return row ? { row, via: 'number' } : null;
}

/** The desk's own verdict from its copy, as a scan view (the shape the server sends, `done` once it is kept). */
export function localView(copy: DeskCopy, match: CopyMatch | null, v: Verdict, done: boolean, at: number): ScanView {
  const row = match?.row ?? null;
  const tt = row ? (copy.ticket_types.find((t) => t.id === row.ticket_type_id) ?? null) : null;
  const key = row ? dayKeyFor(copy, tt, at) : '';
  const p = row ? presenceFor(row, key) : null;
  const opts: string[] = [];
  if (row && !done) {
    if (v.result === 'VALID' && v.action === 'CHECK_IN') opts.push('check_in');
    if (v.result === 'VALID' && v.action === 'CHECK_OUT') opts.push('check_out');
  }
  if (row && p?.state === 'INSIDE' && !opts.includes('check_out') && !(done && v.action === 'CHECK_OUT')) opts.push('check_out');
  return {
    result: v.result,
    action: v.action,
    colour: v.colour,
    label: v.label,
    reason: v.reason,
    warning: v.warning,
    done,
    via: match?.via ?? 'qr',
    attendee: row ? { name: row.name, company: row.company, photo_file_id: copy.rules.photo_verification ? row.photo_file_id : null } : null,
    ticket: tt ? { id: tt.id, name: tt.name, role: tt.role, access_days: tt.access_days } : null,
    registration: row ? { id: row.id, number: row.number, status: row.status, status_label: REGISTRATION_LABELS[row.status] ?? row.status, payment_status: row.payment_due ? 'UNPAID' : null } : null,
    presence: p ? { state: p.state, state_label: PRESENCE_LABELS[p.state] ?? p.state, day: p.day, entries: p.entries, last_in: p.last_in } : null,
    options: opts,
    checkin_event_id: null,
  };
}

/** The copy after a check-in or out recorded here: the desk's own second entry is then a duplicate it sees itself (EV-OFF-011). */
export function applyLocal(copy: DeskCopy, rowId: number, action: 'CHECK_IN' | 'CHECK_OUT', at: number): DeskCopy {
  const rows = copy.rows.map((r) => {
    if (r.id !== rowId) return r;
    const tt = copy.ticket_types.find((t) => t.id === r.ticket_type_id) ?? null;
    const key = dayKeyFor(copy, tt, at);
    const was = presenceFor(r, key);
    const stamp = new Date(at).toISOString();
    const now: CopyPresence =
      action === 'CHECK_IN'
        ? { ...was, state: 'INSIDE', entries: was.entries + 1, last_in: stamp, last_gate_id: copy.gate?.id ?? was.last_gate_id }
        : { ...was, state: 'OUTSIDE' };
    return { ...r, presence: [...r.presence.filter((p) => (p.day ?? null) !== (key === '' ? null : key)), now] };
  });
  return { ...copy, rows };
}

/** The server's changes into the copy (`checkin/changes`, and `sync` → `changes`): rows replaced, rows gone, the cursor moved on. */
export function mergeChanges(copy: DeskCopy, ch: { items?: CopyRow[]; removed?: number[]; cursor?: number }): DeskCopy {
  const byId = new Map(copy.rows.map((r) => [r.id, r]));
  for (const r of ch.items ?? []) byId.set(r.id, r);
  for (const gone of ch.removed ?? []) byId.delete(gone);
  return { ...copy, rows: [...byId.values()].sort((a, b) => a.id - b.id), cursor: Math.max(copy.cursor, ch.cursor ?? copy.cursor) };
}

/**
 * The desk's search from its copy (EV-CHK-050), as the server searches:
 * the number anywhere in it, the company or the ticket's name from their
 * start, or every word the start of a name or of the company ("dilani per"
 * finds Dilani Perera). Two characters at least; the exact number first,
 * then by name. The copy holds no email or phone, so neither is searched
 * offline (the server's "Offline search" decision).
 */
export function searchCopy(copy: Pick<DeskCopy, 'rows' | 'ticket_types' | 'event'>, q: string, limit = 20, at = Date.now()): DeskSearchHit[] {
  const t = q.trim().toLowerCase();
  if (t.length < 2) return [];
  const words = t.split(/\s+/).filter(Boolean);
  const exact = q.trim().toUpperCase();
  const names = new Map(copy.ticket_types.map((tt) => [tt.id, tt]));
  const hits: CopyRow[] = [];
  for (const r of copy.rows) {
    const number = r.number.toLowerCase();
    const company = (r.company ?? '').toLowerCase();
    const ticket = (names.get(r.ticket_type_id)?.name ?? '').toLowerCase();
    const parts = r.name.toLowerCase().split(/\s+/).filter(Boolean);
    const byWords = words.every((w) => parts.some((p) => p.startsWith(w)) || company.startsWith(w));
    if (number.includes(t) || company.startsWith(t) || ticket.startsWith(t) || byWords) hits.push(r);
  }
  hits.sort((a, b) => Number(a.number !== exact) - Number(b.number !== exact) || a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
  return hits.slice(0, Math.max(1, Math.min(50, limit))).map((r) => {
    const tt = names.get(r.ticket_type_id) ?? null;
    const p = presenceFor(r, dayKeyFor(copy, tt, at));
    return {
      registration_id: r.id,
      number: r.number,
      name: r.name,
      company: r.company,
      ticket: { id: r.ticket_type_id, name: tt?.name ?? '' },
      status: r.status,
      status_label: REGISTRATION_LABELS[r.status] ?? r.status,
      payment_due: r.payment_due,
      presence: { state: p.state, last_in: p.last_in },
    };
  });
}

/* ── The queue ──────────────────────────────────────────────────────────── */

/**
 * The next `device_sequence`: one more than the last, and never below the
 * clock in milliseconds. The server keeps `(device_id, device_sequence)`
 * unique for ever and answers a number it has seen as "replayed" — so a
 * counter that restarted (a profile rebuilt, a computer restored) must not
 * count from 1 again, or its scans would be taken for old ones and dropped.
 */
export function nextSequence(last: number, at: number): number {
  return Math.max(Math.floor(last) + 1, Math.floor(at));
}

/** A scan id the server accepts (`client_uuid`, `batch_uuid`: 8–64 of A-Z a-z 0-9 - _ : .). */
export function scanId(prefix: 'dsk' | 'batch' | 'walkin'): string {
  return `${prefix}-${globalThis.crypto.randomUUID()}`;
}

/** A provisional number for a walk-in registered offline (EV-OFF-006), kept by the server beside the real one. */
export function provisionalNumber(deviceId: number, sequence: number): string {
  return `WALKIN-${deviceId}-${String(sequence).slice(-6)}`;
}

/** Time of an item, as the server takes it: an ISO instant. */
export function isoAt(at: number): string {
  return new Date(at).toISOString();
}

/** A copy past `cache_expires` is not used (EV-OFF-003: "expire after a configurable period after the event"). */
export function copyExpired(copy: Pick<DeskCopy, 'cache_expires'>, at: number): boolean {
  const t = utcOf(copy.cache_expires);
  return Number.isFinite(t) && t <= at;
}

/** The label of a scan result, as the server's catalogue has it. */
export function resultLabel(r: string): string {
  return (SCAN_RESULTS as Record<string, readonly [string, string]>)[r]?.[0] ?? r;
}
