import { z } from 'zod';

/**
 * Marketing's IPC (src/modules/marketing, electron/services/marketing.ts; WS-MKT-SRS-001 D01, MKT-DSK-01, MKT-CAL-12):
 * what the desktop adds to the web's screens.
 *
 *  - `marketing:configure` — the next-contact shortcut, held while the person may work a call queue
 *    (marketing.call.make). Pressed anywhere, it brings WorkSuite forward on My call queue and claims the next
 *    contact (`NEXT_CONTACT_ROUTE`, through the app's own navigation: locked, it waits for the unlock).
 *  - `marketing:refresh` — look again now: a callback was booked or an outcome saved, so the reminders and the tray's
 *    counts change. The main process otherwise looks every few minutes on its own.
 *
 * Callback reminders are the main process's: it keeps a timer per callback due in the next hours and raises a native
 * notification at the minute (Call now · Snooze 15 min), whether or not a Marketing tab is open. Snoozing is kept on
 * this computer only; the callback itself stays the Task the server made.
 */
const none = z.undefined().or(z.null()).optional();

export { MARKETING_INVOKE_CHANNELS } from './ipc/marketing-channels';

/** Where the shortcut and a reminder's Call now go: My call queue, claiming the next contact. */
export const NEXT_CONTACT_ROUTE = '/marketing/queue?next=1';

/**
 * "Next contact" from anywhere (design D01). The design names Ctrl+Shift+N, which WorkSuite already uses for Move Tab
 * to New Window; Alt+Ctrl/Cmd+N sits with the Phone's Alt+Ctrl/Cmd+A/H/M call keys instead.
 */
export const NEXT_CONTACT_SHORTCUT = 'Alt+CommandOrControl+N';
/** The same keys as the app's own shortcut notation (`prettyAccelerator`). */
export const NEXT_CONTACT_KEYS = 'Mod+Alt+N';

/** How long "Snooze" puts a callback reminder off. */
export const CALLBACK_SNOOZE_MINUTES = 15;

export const marketingConfigureSchema = z.strictObject({ shortcut: z.boolean() });
export type MarketingConfigure = z.infer<typeof marketingConfigureSchema>;

/** Spread into `contract` (shared/ipc/contract.ts). */
export const marketingContract = {
  'marketing:configure': { input: marketingConfigureSchema, session: true, rate: 4 },
  'marketing:refresh': { input: none, session: true, rate: 6 },
};

export interface MarketingOutputs {
  'marketing:configure': { shortcut: boolean };
  'marketing:refresh': void;
}

/** The tray's Marketing lines (design D01 "WORKSUITE TRAY"). */
export interface MarketingTray {
  /** Waiting in the person's call queues; null without marketing.call.make. */
  queue: number | null;
  /** Callbacks due today for the person. */
  callbacksToday: number;
  /** Campaigns sending now and how far the first one is ("1 · 62%"). */
  sending: { count: number; progress: number | null };
  /** The next-contact shortcut while it is held. */
  shortcut: string | null;
}

/** A callback as the reminder needs it (GET /api/marketing/queue/callbacks). */
export interface CallbackDue {
  id: number;
  /** The queue item it brings back: Call now claims this one, not whoever is next. */
  queueItemId: number | null;
  contact: string;
  organisation: string | null;
  note: string | null;
  /** UTC stamp. */
  dueAt: string;
}

/**
 * The callbacks worth a reminder from an answer of the server: well-formed, not yet past by more than a grace period,
 * and due within the horizon, soonest first.
 */
export function dueCallbacks(raw: unknown, now: number, horizonMs: number, graceMs = 10 * 60_000): CallbackDue[] {
  const rows = Array.isArray(raw) ? raw : raw && typeof raw === 'object' && Array.isArray((raw as { data?: unknown }).data) ? (raw as { data: unknown[] }).data : [];
  const out: CallbackDue[] = [];
  for (const r of rows) {
    if (!r || typeof r !== 'object') continue;
    const o = r as Record<string, unknown>;
    const id = typeof o.id === 'number' ? o.id : Number(o.id);
    const dueAt = typeof o.due_at === 'string' ? o.due_at : null;
    if (!Number.isInteger(id) || id <= 0 || !dueAt) continue;
    const at = stampMs(dueAt);
    if (at === null || at < now - graceMs || at > now + horizonMs) continue;
    const c = (o.contact ?? {}) as Record<string, unknown>;
    const item = typeof o.queue_item_id === 'number' ? o.queue_item_id : Number(o.queue_item_id);
    out.push({
      id,
      queueItemId: Number.isInteger(item) && item > 0 ? item : null,
      contact: typeof c.name === 'string' && c.name.trim() ? c.name.trim().slice(0, 120) : 'A contact',
      organisation: typeof c.organisation === 'string' && c.organisation.trim() ? c.organisation.trim().slice(0, 120) : null,
      note: typeof o.note === 'string' && o.note.trim() ? o.note.trim().slice(0, 200) : null,
      dueAt,
    });
  }
  return out.sort((a, b) => (stampMs(a.dueAt) ?? 0) - (stampMs(b.dueAt) ?? 0));
}

/** How many callbacks in an answer are due on the computer's calendar day of `now` (the tray's "Callbacks today"). */
export function callbacksToday(raw: unknown, now: number): number {
  const rows = Array.isArray(raw) ? raw : raw && typeof raw === 'object' && Array.isArray((raw as { data?: unknown }).data) ? (raw as { data: unknown[] }).data : [];
  const today = new Date(now).toDateString();
  let n = 0;
  for (const r of rows) {
    const due = r && typeof r === 'object' && typeof (r as { due_at?: unknown }).due_at === 'string' ? stampMs((r as { due_at: string }).due_at) : null;
    if (due !== null && new Date(due).toDateString() === today) n++;
  }
  return n;
}

/** A UTC stamp without a zone (`2026-10-06 14:00:00`) or an ISO one, in milliseconds; null when unreadable. */
export function stampMs(s: string): number | null {
  const iso = /[zZ]|[+-]\d\d:?\d\d$/.test(s) ? s.replace(' ', 'T') : `${s.replace(' ', 'T')}Z`;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : t;
}

/** Where a reminder's Call now goes: My call queue, claiming that callback's own queue item when it is known. */
export function callbackRoute(c: Pick<CallbackDue, 'queueItemId'>): string {
  return c.queueItemId ? `${NEXT_CONTACT_ROUTE}&item=${c.queueItemId}` : NEXT_CONTACT_ROUTE;
}

/** "Callback due · Iresha Dias" / "Dias Printers · “Call after 2 pm”" (design D01). */
export function callbackNotice(c: CallbackDue): { title: string; body: string } {
  return {
    title: `Callback due · ${c.contact}`,
    body: [c.organisation, c.note ? `“${c.note}”` : null].filter(Boolean).join(' · ') || 'A callback you booked is due now.',
  };
}

/** "1 · 62%" — the tray's sending line. */
export function sendingLabel(s: MarketingTray['sending']): string {
  return s.progress === null ? String(s.count) : `${s.count} · ${Math.round(s.progress)}%`;
}
