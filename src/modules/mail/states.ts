import { classifyFocus, type FocusContext } from '@shared/mail-focus';
import { useQuery } from '@tanstack/react-query';
import { ApiError, apiGet } from '../../core/api';
import { text } from '../../core/i18n';
import { addDays, parseTs, todayInZone, wallToUtc } from '../../core/time';
import type { MessageRow } from './types';

/**
 * Pins, snoozes, flags with dates, Focused Inbox and categories on the
 * desktop (ENH-MAIL-03 P1). The server keeps them (GET/POST api/mail/states),
 * so they are the same on every device; the list is drawn from what it says,
 * and changes go through the offline queue like every other mail action.
 */

export interface FlagState {
  start_at: string | null;
  due_at: string | null;
  reminder_at: string | null;
  completed_at: string | null;
  task_id: number | null;
}

export interface Category {
  id: number;
  name: string;
  colour: string;
  /** 1…11: Ctrl+F2…F12 assigns it (DMO-INB-07). */
  shortcut: number | null;
  /** Published by the organisation: read-only. */
  org: boolean;
  label_id: number | null;
}

export interface MessageStates {
  pins: Record<string, string>;
  snoozed: Record<string, string>;
  returned: Record<string, string>;
  flags: Record<string, FlagState & { mailbox: number; folder: string; uid: string; subject: string; from_name: string; from_email: string }>;
  focus: Record<string, 'focused' | 'other'>;
  categories: Record<string, number[]>;
}

export type { FocusContext };

/** The server's name for a message: "4:inbox:1234" (0 for WorkSuite's own store). */
export function stateKey(mailbox: string | number | null | undefined, folder: string, uid: string | number): string {
  return `${mailbox ?? 0}:${folder}:${uid}`;
}

/** An item for POST api/mail/states, with the snapshot the Snoozed view and the linked task use. */
export function stateItem(m: Pick<MessageRow, 'id' | 'subject' | 'from_name' | 'from_email' | 'created_at'> & { message_id?: string }, mailbox: string | null, folder: string) {
  return { mailbox: mailbox ? Number(mailbox) : 0, folder, uid: String(m.id), subject: m.subject, from_name: m.from_name, from_email: m.from_email, received_at: m.created_at, ...(m.message_id ? { message_id: m.message_id } : {}) };
}

/** null when the server has no such call yet (older WorkSuite), never an error the list shows. */
async function optional<T>(path: string, params?: Record<string, string | number | boolean | null | undefined>): Promise<T | null> {
  try {
    return await apiGet<T>(path, params);
  } catch (e) {
    if (e instanceof ApiError && (e.status === 404 || e.status === 503)) return null;
    throw e;
  }
}

export function useMessageStates(enabled: boolean, mailbox: string | null, folder: string | null) {
  return useQuery({
    queryKey: ['mail', 'states', mailbox ?? 'all', folder ?? 'all'],
    queryFn: () => optional<MessageStates>('/api/mail/states', { ...(mailbox ? { mailbox } : {}), ...(folder ? { folder } : {}) }),
    enabled,
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
}

export function useCategories(enabled = true) {
  return useQuery({ queryKey: ['mail', 'categories'], queryFn: async () => (await optional<{ categories: Category[] }>('/api/categories'))?.categories ?? null, enabled, staleTime: 5 * 60_000 });
}

export function useFocusContext(enabled: boolean) {
  return useQuery({ queryKey: ['mail', 'focus-context'], queryFn: () => optional<FocusContext>('/api/mail/focus/context'), enabled, staleTime: 5 * 60_000 });
}

/**
 * The list with WorkSuite's states on each row: pinned, flagged, categorised,
 * focus; snoozed ones out until they return; returned and pinned mail on top
 * (DMO-INB-05/06).
 */
export function withStates(rows: MessageRow[], states: MessageStates | null | undefined, keyOf: (m: MessageRow) => string, cats: Category[] | null | undefined): MessageRow[] {
  if (!states) return rows;
  const byId = new Map((cats ?? []).map((c) => [c.id, c] as const));
  const out: MessageRow[] = [];
  for (const m of rows) {
    const k = keyOf(m);
    if (states.snoozed[k]) continue;
    const flag = states.flags[k];
    const catIds = states.categories[`mail:${k}`] ?? [];
    out.push({
      ...m,
      pinned: !!states.pins[k],
      returned: !!states.returned[k] && !m.is_read,
      flag: flag ? { start_at: flag.start_at, due_at: flag.due_at, reminder_at: flag.reminder_at, completed_at: flag.completed_at, task_id: flag.task_id } : null,
      categories: catIds.map((id) => byId.get(id)).filter((c): c is Category => !!c),
      ...(states.focus[k] ? { focus: states.focus[k] } : {}),
    });
  }
  return out;
}

/** Pinned and just-returned mail first, each group in the list's own order. */
export function pinnedFirst(rows: MessageRow[]): MessageRow[] {
  const top = rows.filter((m) => m.returned);
  const pinned = rows.filter((m) => m.pinned && !m.returned);
  const rest = rows.filter((m) => !m.pinned && !m.returned);
  return [...top, ...pinned, ...rest];
}

// ---- Focused Inbox (WF-DO01) ------------------------------------------------------------------

export { classifyFocus };

/** "3 new in Other: Daraz, LinkedIn, …" — unread Other mail, not in the badge (DMO-INB-03). */
export function otherBanner(rows: MessageRow[], ctx: FocusContext | null | undefined): string | null {
  const unread = rows.filter((m) => !m.is_read && classifyFocus(m, ctx).focus === 'other');
  if (unread.length === 0) return null;
  const names = [...new Set(unread.map((m) => m.from_name || m.from_email))];
  const shown = names.slice(0, 3).join(', ');
  return text('{n} new in Other: {names}', { n: unread.length, names: names.length > 3 ? `${shown}, …` : shown });
}

// ---- snooze and flag times, on the reader's clock ---------------------------------------------

export interface TimeChoice {
  id: string;
  label: string;
  /** ISO instant. */
  at: string;
}

/** Later today (+3 h, on the hour), Tomorrow 08:00, This weekend (Saturday 08:00), Next week (Monday 08:00) — DMO-INB-06. */
export function snoozeChoices(now = new Date(), today = todayInZone()): TimeChoice[] {
  const dow = new Date(`${today}T12:00:00Z`).getUTCDay();
  const later = new Date(Math.ceil((now.getTime() + 3 * 3_600_000) / 3_600_000) * 3_600_000);
  const out: TimeChoice[] = [];
  if (later.getTime() < parseTs(wallToUtc(today, 21 * 60)).getTime()) out.push({ id: 'later', label: text('Later today'), at: later.toISOString() });
  out.push({ id: 'tomorrow', label: text('Tomorrow'), at: wallToUtc(addDays(today, 1), 8 * 60) });
  if (dow !== 6 && dow !== 0) out.push({ id: 'weekend', label: text('This weekend'), at: wallToUtc(addDays(today, 6 - dow), 8 * 60) });
  out.push({ id: 'next-week', label: text('Next week'), at: wallToUtc(addDays(today, ((8 - dow) % 7) || 7), 8 * 60) });
  return out;
}

/** Flag dates (DMO-TSK-01): Today, Tomorrow, This week, Next week, No date — start, due and a reminder. */
export function flagChoices(today = todayInZone()): Array<{ id: string; label: string; dates: { start_at: string | null; due_at: string | null; reminder_at: string | null } }> {
  const dow = new Date(`${today}T12:00:00Z`).getUTCDay();
  const friday = addDays(today, Math.max(0, 5 - dow));
  const monday = addDays(today, ((8 - dow) % 7) || 7);
  const at = (ymd: string, h: number) => wallToUtc(ymd, h * 60);
  return [
    { id: 'today', label: text('Today'), dates: { start_at: at(today, 9), due_at: at(today, 17), reminder_at: at(today, 16) } },
    { id: 'tomorrow', label: text('Tomorrow'), dates: { start_at: at(addDays(today, 1), 9), due_at: at(addDays(today, 1), 17), reminder_at: at(addDays(today, 1), 9) } },
    { id: 'week', label: text('This week'), dates: { start_at: at(today, 9), due_at: at(friday, 17), reminder_at: at(friday, 9) } },
    { id: 'next-week', label: text('Next week'), dates: { start_at: at(monday, 9), due_at: at(addDays(monday, 4), 17), reminder_at: at(monday, 9) } },
    { id: 'none', label: text('No date'), dates: { start_at: null, due_at: null, reminder_at: null } },
  ];
}
