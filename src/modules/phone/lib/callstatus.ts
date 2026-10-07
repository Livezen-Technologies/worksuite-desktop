/**
 * Status for calls (worksuite-desktop#288): what each status does to a call, how it follows the WorkSuite status, and
 * a Do not disturb that ends on its own. Pure functions and plain data, shared by the softphone, the status menu and
 * the host that keeps them in step, and tested on their own.
 *
 * One status across WorkSuite: calls follow the status chosen in the top bar (Chat's presence, which Website chats are
 * routed by too) unless the person gives calls their own — "Available for chats, Do not disturb for calls". The
 * person's own choice is what calls follow, never the server's automatic Busy in a meeting or Away when idle: an
 * idle screen must not send a caller to voicemail.
 */
import { addDays, dayKey, stampDayLabel, timeLabel, wallToUtc } from '../../../core/time';
import type { ForwardRule } from '../api';
import { prettyNumber } from './format';

export type CallStatus = 'available' | 'busy' | 'dnd' | 'away';

/** How a call reaches this computer: rings out loud, rings without a sound, or does not ring here at all. */
export type Ring = 'loud' | 'quiet' | 'off';

export const CALL_STATUSES: CallStatus[] = ['available', 'busy', 'dnd', 'away'];

export const CALL_STATUS: Record<CallStatus, { label: string; dot: string; hint: string; ring: Ring }> = {
  available: { label: 'Available', dot: 'bg-success', hint: 'Calls ring on this computer', ring: 'loud' },
  busy: { label: 'Busy', dot: 'bg-warning', hint: 'Calls ring quietly, no sound', ring: 'quiet' },
  dnd: { label: 'Do not disturb', dot: 'bg-danger', hint: 'Calls go to voicemail or the next person in your team', ring: 'off' },
  away: { label: 'Away', dot: 'bg-ink-3', hint: 'Calls forward to your phone (if set)', ring: 'off' },
};

export function ringOf(status: CallStatus): Ring {
  return CALL_STATUS[status].ring;
}

export function isCallStatus(v: unknown): v is CallStatus {
  return typeof v === 'string' && (CALL_STATUSES as string[]).includes(v);
}

/**
 * The WorkSuite status (the choice in the top bar's Show me as) as calls take it. Appear offline is Away: whoever sees
 * you offline and calls gets your forwarding or voicemail, not a phone that rings while you look away.
 */
export function fromPresence(choice: string | null | undefined): CallStatus | null {
  if (choice === 'offline') return 'away';
  return isCallStatus(choice) ? choice : null;
}

/** What the person chose for calls, kept on this computer. */
export interface CallStatusPrefs {
  /** Calls' own status (a per-channel override); null while they follow the WorkSuite status. */
  own: CallStatus | null;
  /** Do not disturb for a while. */
  timer: DndTimer | null;
}

export interface DndTimer {
  /** When it ends (ms since the epoch). */
  until: number;
  /** What comes back: the status before it — the calls' own (scope `calls`), or the WorkSuite choice (`everywhere`). */
  back: string;
  /** Calls only, or the WorkSuite status (Chat, Website chats and calls together). */
  scope: 'calls' | 'everywhere';
}

export const NO_PREFS: CallStatusPrefs = { own: null, timer: null };

/**
 * Prefs as stored, never trusted: anything malformed is dropped. Before #288 the phone kept only "Do not disturb on
 * this computer" (`ws.phone.dnd`); that carries over as calls' own Do not disturb, as it behaved.
 */
export function parsePrefs(raw: string | null, legacyDnd: string | null = null): CallStatusPrefs {
  try {
    const v = raw ? (JSON.parse(raw) as Partial<CallStatusPrefs> | null) : null;
    if (v && typeof v === 'object') {
      const t = v.timer;
      const timer = t && typeof t === 'object' && Number.isFinite(t.until) && typeof t.back === 'string' && (t.scope === 'calls' || t.scope === 'everywhere') ? { until: t.until, back: t.back, scope: t.scope } : null;
      return { own: isCallStatus(v.own) ? v.own : null, timer };
    }
  } catch {
    /* start again */
  }
  return legacyDnd === '1' ? { own: 'dnd', timer: null } : NO_PREFS;
}

export interface Resolved {
  status: CallStatus;
  /** Calls follow the WorkSuite status: a change here changes it everywhere. */
  linked: boolean;
  /** When Do not disturb ends, while it is on for a while; null when it is not, or until turned off. */
  until: number | null;
}

/**
 * The status calls are in now. `choice` is the WorkSuite status (undefined when there is none: no Chat app, or not
 * known yet). Without one, or with an override, calls have their own (Available by default).
 */
export function resolveStatus(prefs: CallStatusPrefs, choice: string | null | undefined, now: number): Resolved {
  const timer = prefs.timer && prefs.timer.until > now ? prefs.timer : null;
  const ws = fromPresence(choice);
  if (prefs.own || !ws) {
    const status = prefs.own ?? 'available';
    return { status, linked: false, until: status === 'dnd' && timer?.scope === 'calls' ? timer.until : null };
  }
  return { status: ws, linked: true, until: ws === 'dnd' && timer?.scope === 'everywhere' ? timer.until : null };
}

/**
 * What a Do not disturb whose time is up asks for: nothing (none, or not yet), the calls' own status put back, or the
 * WorkSuite status put back (`presence`) — only while WorkSuite still says Do not disturb, since a change made since
 * (from the top bar, say) wins over the timer.
 */
export function expiry(prefs: CallStatusPrefs, choice: string | null | undefined, now: number): { prefs: CallStatusPrefs; presence: string | null } | null {
  const t = prefs.timer;
  if (!t || t.until > now) return null;
  if (t.scope === 'calls') return { prefs: { own: prefs.own === 'dnd' ? (fromPresence(t.back) ?? 'available') : prefs.own, timer: null }, presence: null };
  return { prefs: { ...prefs, timer: null }, presence: choice === 'dnd' ? t.back : null };
}

export type DndLength = '30m' | '1h' | '2h' | 'tomorrow' | 'off';

export const DND_LENGTHS: Array<{ id: DndLength; label: string }> = [
  { id: '30m', label: '30 minutes' },
  { id: '1h', label: '1 hour' },
  { id: '2h', label: '2 hours' },
  { id: 'tomorrow', label: 'Until tomorrow' },
  { id: 'off', label: 'Until I turn it off' },
];

/** Tomorrow's Do not disturb ends at the start of the working day, 8:00 on the person's clock. */
export const TOMORROW_AT = 8 * 60;

/** When Do not disturb for that long ends, or null for "until I turn it off". */
export function dndEnd(length: DndLength, now: number): number | null {
  switch (length) {
    case '30m':
      return now + 30 * 60_000;
    case '1h':
      return now + 60 * 60_000;
    case '2h':
      return now + 120 * 60_000;
    case 'tomorrow':
      return Date.parse(wallToUtc(addDays(dayKey(new Date(now)), 1), TOMORROW_AT));
    case 'off':
      return null;
  }
}

/** A moment on the person's clock and in their format: "3:30 PM", "tomorrow 8:00 AM", "9 Oct 8:00 AM". */
export function atLabel(at: number, now: number): string {
  const iso = new Date(at).toISOString();
  const day = dayKey(new Date(at));
  const today = dayKey(new Date(now));
  if (day === today) return timeLabel(iso);
  if (day === addDays(today, 1)) return `tomorrow ${timeLabel(iso)}`;
  return `${stampDayLabel(iso, 'short')} ${timeLabel(iso)}`;
}

/** What the status pill says: "Available", "Do not disturb · until 3:30 PM". */
export function statusLabel(r: Pick<Resolved, 'status' | 'until'>, now: number): string {
  const label = CALL_STATUS[r.status].label;
  return r.until ? `${label} · until ${atLabel(r.until, now)}` : label;
}

/**
 * Where Away sends calls. The switch's own word when it gives one (`GET me` → `away_forward_to`, proposed); otherwise
 * the person's "When busy" rule to a phone number, since this computer turns a call away as busy (486) and the switch
 * then follows that rule. Null when neither: calls go to voicemail, as with Do not disturb.
 */
export function awayForwardTo(rules: ForwardRule[] | null | undefined, extensionId: number | null, serverSays?: string | null): string | null {
  if (serverSays) return serverSays;
  const r = (rules ?? []).find((x) => x.enabled && x.condition === 'busy' && (x.destination_kind === 'mobile' || x.destination_kind === 'external') && !!x.destination && (x.extension_id === null || x.extension_id === extensionId));
  return r?.destination ?? null;
}

/** Away's line in the menu: where calls go, said plainly when nothing forwards them. */
export function awayHint(forwardTo: string | null): string {
  return forwardTo ? `Calls forward to ${prettyNumber(forwardTo)}` : `${CALL_STATUS.away.hint}. None is set, so they go to voicemail`;
}

/** What the phone system took of a status: all of it (mode and end), Do not disturb on or off only, or nothing. */
export type SwitchTook = 'all' | 'dnd' | 'local';

/** What to tell the person about the phone system after a change, or null when there is nothing to add. */
export function switchNote(status: CallStatus, took: SwitchTook): string | null {
  if (took === 'all' || status === 'available') return null;
  if (status === 'busy') return took === 'dnd' ? 'Only this computer rings quietly: this server can’t ring your other phones without a sound yet.' : 'Only this computer rings quietly: this server can’t tell your other phones yet.';
  if (status === 'away' && took === 'dnd') return 'This server takes Away as Do not disturb, so callers go to voicemail: it can’t forward them for Away yet.';
  if (took === 'local') return 'Calls won’t ring on this computer. This server can’t set Do not disturb on the switch yet, so your other phones still ring.';
  return null;
}
