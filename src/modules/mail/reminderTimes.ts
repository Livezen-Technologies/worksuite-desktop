import type { MessageStates } from './states';

/**
 * Reminders (ENH-MAIL-03 DMO-NTF-05, DMO-TSK-02, WF-DO11): flags whose
 * reminder time has come, messages back from snooze, and events about to
 * start — worked out on this computer from what it already has (the flags
 * and snoozes WorkSuite keeps, the calendar), so they come up offline too.
 *
 * What the person did with each — dismissed it, or snoozed it here — is kept
 * on this computer; a flag's snooze also moves its reminder on the server
 * when it can, so the phone agrees.
 */

export interface ReminderItem {
  key: string;
  kind: 'flag' | 'snooze' | 'event';
  title: string;
  /** When it is due (the flag's due time, the event's start), ISO, for the words. */
  at: string | null;
  /** When the reminder came up. */
  since: string;
  route: string;
  /** A flag's message, to snooze or complete on the server. */
  ref?: { mailbox: number; folder: string; uid: string };
}

export interface ReminderMemory {
  dismissed: Record<string, string>;
  snoozed: Record<string, string>;
}

export interface ReminderEvent {
  id: number | string;
  title: string;
  start_at: string;
  remind_minutes?: number | null;
  all_day?: boolean;
  occurrence_date?: string | null;
}

const iso = (s: string | null | undefined): number => {
  if (!s) return NaN;
  // The server's naive stamps are UTC.
  return Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(s) ? s : `${s.replace(' ', 'T')}Z`);
};

/** Everything due now, newest first, less what the person dismissed or snoozed past now. */
export function dueReminders(states: MessageStates | null, events: ReminderEvent[], memory: ReminderMemory, now = Date.now()): ReminderItem[] {
  const out: ReminderItem[] = [];
  const live = (key: string) => !memory.dismissed[key] && !(memory.snoozed[key] && iso(memory.snoozed[key]) > now);
  for (const [k, f] of Object.entries(states?.flags ?? {})) {
    const at = iso(f.reminder_at);
    if (Number.isNaN(at) || at > now || f.completed_at) continue;
    const key = `flag:${k}:${f.reminder_at}`;
    if (!live(key)) continue;
    out.push({ key, kind: 'flag', title: f.subject || '(no subject)', at: f.due_at, since: new Date(at).toISOString(), route: `/mail?msg=${encodeURIComponent(f.uid)}&mbx=${f.mailbox}&mf=${encodeURIComponent(f.folder)}`, ref: { mailbox: f.mailbox, folder: f.folder, uid: f.uid } });
  }
  for (const [k, when] of Object.entries(states?.returned ?? {})) {
    const at = iso(when);
    // Back from snooze in the last day.
    if (Number.isNaN(at) || at > now || now - at > 86_400_000) continue;
    const key = `snooze:${k}:${when}`;
    if (!live(key)) continue;
    const [box, ...rest] = k.split(':');
    const uid = rest.pop() ?? '';
    const flag = states?.flags[k];
    out.push({ key, kind: 'snooze', title: flag?.subject || '', at: null, since: new Date(at).toISOString(), route: `/mail?msg=${encodeURIComponent(uid)}&mbx=${box}&mf=${encodeURIComponent(rest.join(':'))}` });
  }
  for (const e of events) {
    if (e.all_day || e.remind_minutes === null || e.remind_minutes === undefined) continue;
    const start = iso(e.start_at);
    const at = start - e.remind_minutes * 60_000;
    // From its reminder time until a quarter of an hour after it starts.
    if (Number.isNaN(start) || at > now || now > start + 15 * 60_000) continue;
    const key = `event:${e.id}:${e.occurrence_date ?? e.start_at}`;
    if (!live(key)) continue;
    out.push({ key, kind: 'event', title: e.title, at: new Date(start).toISOString(), since: new Date(at).toISOString(), route: `/calendar?event=${encodeURIComponent(String(e.id))}` });
  }
  return out.sort((a, b) => iso(b.since) - iso(a.since));
}

/** Snooze choices (DMO-NTF-05): 5 minutes, an hour, tomorrow at 9 on the person's clock. */
export function snoozeUntil(choice: '5m' | '1h' | 'tomorrow', now = new Date(), tomorrowAt9: () => Date = () => {
  const d = new Date(now);
  d.setDate(d.getDate() + 1);
  d.setHours(9, 0, 0, 0);
  return d;
}): Date {
  if (choice === '5m') return new Date(now.getTime() + 5 * 60_000);
  if (choice === '1h') return new Date(now.getTime() + 60 * 60_000);
  return tomorrowAt9();
}

/** Forget what is long past, so the memory stays small. */
export function pruneMemory(m: ReminderMemory, now = Date.now()): ReminderMemory {
  const keep = (r: Record<string, string>) => Object.fromEntries(Object.entries(r).filter(([, v]) => now - iso(v) < 7 * 86_400_000));
  return { dismissed: keep(m.dismissed), snoozed: keep(m.snoozed) };
}
