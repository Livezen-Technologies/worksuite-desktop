import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { ApiError } from '../../core/api';
import { call, on } from '../../core/bridge';
import type { SalonCopy, SalonCopyClient, SalonDeskInfo, SalonOutboxAction, SalonOutboxInput, SalonOutboxItem, SalonSyncStatus } from '@shared/types';
import { clockAt, todayAt, type CalendarDay, type FloorStylist, type Options, type Stylist, type TodayBoard, type Visit } from './api';

/**
 * The desk when WorkSuite is out of reach (OFF-01…08).
 *
 * The main process keeps the desk's copy of its day and the outbox
 * (electron/services/salon-sync.ts); the screens read them here. A screen
 * always prefers a live answer: the copy stands in only when WorkSuite does
 * not answer, and says how old it is.
 *
 * What the counter does offline — a new client, a walk-in started now, a
 * booking, a check-in — is kept in the outbox and sent, in order, when the
 * line is back. WorkSuite judges each again then, so a slot taken meanwhile
 * or an allergy added since comes back as a refusal for a person to decide
 * ("Changes to send"). Money never waits: payments, deposits and the
 * register need WorkSuite.
 */

export const SK = {
  all: ['salon', 'offline'] as const,
  status: ['salon', 'offline', 'status'] as const,
  copy: ['salon', 'offline', 'copy'] as const,
  outbox: ['salon', 'offline', 'outbox'] as const,
  clients: (q: string) => ['salon', 'offline', 'clients', q] as const,
};

export const syncStatus = (): Promise<SalonSyncStatus> => call('salon:syncStatus');
export const syncNow = (): Promise<SalonSyncStatus> => call('salon:syncNow');
export const readCopy = (): Promise<SalonCopy | null> => call('salon:copy');
export const copyClients = (q: string, limit = 20, id?: number): Promise<SalonCopyClient[]> => call('salon:copyClients', { q, limit, ...(id ? { id } : {}) });
export const readOutbox = (): Promise<SalonOutboxItem[]> => call('salon:outbox');
export const resolveChange = (a: SalonOutboxAction): Promise<SalonOutboxItem[]> => call('salon:outboxResolve', a);

/** Keep what the counter did, in order: a walk-in is its new client, its visit and its check-in. */
export async function keep(inputs: SalonOutboxInput[]): Promise<void> {
  for (const i of inputs) await call('salon:outboxAdd', i);
}

/** A local id for a client or visit made here, until WorkSuite gives it one. */
export function localId(kind: 'C' | 'V'): string {
  return `${kind}-${crypto.randomUUID()}`;
}

/* IPC, not the network: these answer with the line down, so they never wait for it. */
const LOCAL = { networkMode: 'always' as const, retry: false as const };

export function useSyncStatus() {
  return useQuery({ queryKey: SK.status, queryFn: syncStatus, ...LOCAL, refetchInterval: 30_000 });
}

export function useCopy(enabled = true) {
  return useQuery({ queryKey: SK.copy, queryFn: readCopy, ...LOCAL, enabled, staleTime: 15_000 });
}

export function useOutbox(enabled = true) {
  return useQuery({ queryKey: SK.outbox, queryFn: readOutbox, ...LOCAL, enabled });
}

export function useCopyClients(q: string, limit: number, enabled = true) {
  return useQuery({ queryKey: [...SK.clients(q), limit], queryFn: () => copyClients(q, limit), ...LOCAL, enabled });
}

/** One client from the copy, by id. */
export function useCopyClient(id: number | null, enabled = true) {
  return useQuery({ queryKey: [...SK.all, 'client', id], queryFn: async () => (await copyClients('', 1, id!))[0] ?? null, ...LOCAL, enabled: enabled && !!id });
}

/** The main process says when the copy or the outbox changed. */
export function useSalonChanged(): void {
  const qc = useQueryClient();
  useEffect(() => on('salon:changed', () => void qc.invalidateQueries({ queryKey: SK.all })), [qc]);
}

/** What this computer's network adapter says. It knows only that a cable is out, never that WorkSuite is down. */
export function useOnline(): boolean {
  const [online, setOnline] = useState(() => navigator.onLine);
  useEffect(() => {
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener('online', up);
    window.addEventListener('offline', down);
    return () => {
      window.removeEventListener('online', up);
      window.removeEventListener('offline', down);
    };
  }, []);
  return online;
}

/** A query WorkSuite did not answer: the line is down, or it is waiting for the line to come back. */
export function unreachable(q: { isError: boolean; error: unknown; fetchStatus: string }): boolean {
  return q.fetchStatus === 'paused' || (q.isError && q.error instanceof ApiError && q.error.offline);
}

// ── the copy, as the screens' shapes ────────────────────────────────────

const WAITING = new Set(['pending', 'confirmed']);
const DONE = new Set(['checked_in', 'in_service', 'completed']);

/** ISO weekday (1 = Monday … 7 = Sunday) of a calendar day. */
export function weekdayOf(ymd: string): number {
  return new Date(`${ymd}T12:00:00Z`).getUTCDay() || 7;
}

function hoursOn(copy: SalonCopy, ymd: string): { opens: string; closes: string } | null {
  const h = copy.location.hours.find((x) => Number(x.weekday) === weekdayOf(ymd));
  return h ? { opens: h.opens.slice(0, 5), closes: h.closes.slice(0, 5) } : null;
}

export function visitsOf(copy: SalonCopy): Visit[] {
  return copy.visits as Visit[];
}

export function stylistsOf(copy: SalonCopy): Stylist[] {
  return (copy.stylists as Stylist[]).filter((s) => s.active !== false);
}

/** The desk's own record, as it was when the copy was taken. */
export function deskFromCopy(copy: SalonCopy | null | undefined): SalonDeskInfo | null {
  return copy?.desk ?? null;
}

/** What /options would have said, from the copy: enough for the desk to open. */
export function optionsFromCopy(copy: SalonCopy): Options {
  const s = copy.settings;
  const o = copy.options;
  const orgId = copy.desk?.org_id ?? 0;
  const locations = (o?.locations as Options['locations'] | undefined)?.length
    ? (o!.locations as Options['locations'])
    : [{ id: copy.location.id, org_id: orgId, name: copy.location.name, timezone: copy.timezone }];
  return {
    locations,
    menu: copy.menu as Options['menu'],
    stylists: copy.stylists as Options['stylists'],
    currency: (o?.currency ?? (typeof s.currency === 'string' ? s.currency : undefined)) || undefined,
    company: (o?.company ?? (typeof s.company === 'string' ? s.company : undefined)) || undefined,
    loyalty: s.loyalty === true,
    ack_severity: (o?.ack_severity ?? (typeof s.ack_severity === 'string' ? s.ack_severity : undefined)) as Options['ack_severity'],
    may: o?.may ?? {},
  };
}

/**
 * Today's board from the copy, by the server's own rules (Today::board):
 * late is more than a quarter of an hour past its start and not yet in;
 * a stylist is busy with anybody checked in or in the chair, or booked
 * across now. What was taken today needs WorkSuite.
 */
export function boardFromCopy(copy: SalonCopy, now: number): TodayBoard {
  const tz = copy.timezone;
  const date = todayAt(tz, new Date(now));
  const visits = visitsOf(copy).filter((v) => v.date === date);
  const live = visits.filter((v) => v.status !== 'cancelled');
  const cut = now - 15 * 60_000;
  const waiting = live.filter((v) => WAITING.has(v.status));
  const open = hoursOn(copy, date);

  const floor: FloorStylist[] = stylistsOf(copy).map((s) => {
    let current: FloorStylist['current'] = null;
    let next: (FloorStylist['next'] & { at: number }) | null = null;
    for (const v of live) {
      for (const i of v.items) {
        if (i.provider_id !== s.id) continue;
        const a = Date.parse(i.starts_at);
        const b = Date.parse(i.ends_at);
        if (i.status === 'in_service' || i.status === 'checked_in' || (i.status === 'confirmed' && a <= now && b > now)) {
          current ??= { client: v.client.name, service: i.service, until: i.end };
        } else if (a > now && WAITING.has(i.status) && (!next || a < next.at)) {
          next = { label: i.start, client: v.client.name, at: a };
        }
      }
    }
    return { provider_id: s.id, name: s.name, color: s.color, current, next: next ? { label: next.label, client: next.client } : null };
  });

  return {
    date,
    timezone: tz,
    now_label: clockAt(new Date(now).toISOString(), tz),
    location: { id: copy.location.id, name: copy.location.name, opens: open?.opens ?? null, closes: open?.closes ?? null },
    currency: typeof copy.settings.currency === 'string' ? copy.settings.currency : '',
    figures: { bookings: live.length, done: live.filter((v) => DONE.has(v.status)).length, to_come: waiting.length, taken: null },
    arriving: waiting.filter((v) => Date.parse(v.starts_at) >= cut).slice(0, 12),
    late: waiting.filter((v) => Date.parse(v.starts_at) < cut),
    floor,
    visits,
  };
}

/** The instant a wall-clock time on a day is, in a time zone ("2026-09-28", "09:00", "Asia/Colombo" → 03:30Z). */
export function instantAt(ymd: string, hm: string, timezone: string): string {
  const [y, m, d] = ymd.split('-').map(Number);
  const [h, mi] = hm.split(':').map(Number);
  const wall = Date.UTC(y!, m! - 1, d!, h!, mi!);
  const offset = (at: number) => {
    const p = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).formatToParts(new Date(at));
    const g = (t: string) => Number(p.find((x) => x.type === t)?.value ?? 0);
    return Date.UTC(g('year'), g('month') - 1, g('day'), g('hour'), g('minute')) - at;
  };
  let at = wall - offset(wall);
  at = wall - offset(at);
  return new Date(at).toISOString().replace('.000Z', 'Z');
}

/** Whether the copy holds a day: yesterday to the salon's days ahead. */
export function copyHolds(copy: SalonCopy, ymd: string, now: number): boolean {
  const ahead = Math.max(1, Number(copy.settings.cache_days_ahead ?? 14));
  const from = todayAt(copy.timezone, new Date(now - 86_400_000));
  const to = todayAt(copy.timezone, new Date(now + ahead * 86_400_000));
  return ymd >= from && ymd <= to;
}

/** A day of the calendar from the copy; working hours are the salon's opening hours, as each stylist's own need WorkSuite. */
export function calendarFromCopy(copy: SalonCopy, ymd: string): CalendarDay {
  const open = hoursOn(copy, ymd);
  return {
    date: ymd,
    hours: copy.location.hours,
    stylists: stylistsOf(copy).map((s) => ({ ...s, working: open ? [[instantAt(ymd, open.opens, copy.timezone), instantAt(ymd, open.closes, copy.timezone)] as [string, string]] : [] })),
    visits: visitsOf(copy).filter((v) => v.date === ymd),
  };
}

/** "Taken at 10:42", on the salon's clock. */
export function copyAge(copy: SalonCopy | null | undefined, timezone: string): string | null {
  return copy ? clockAt(copy.pulled_at, timezone) : null;
}

// ── what the outbox shows ───────────────────────────────────────────────

export const CHOICE_LABEL: Record<string, string> = {
  take_next: 'Take the next time',
  time: 'Choose a time',
  client: 'It is this client',
  edit: 'Change it',
  retry: 'Send again',
  drop: 'Drop it',
};

/** Items still to send, and what they wait for, in words. */
export function waitingLine(s: SalonSyncStatus | undefined): string | null {
  if (!s) return null;
  const parts = [s.waiting > 0 ? `${s.waiting} change${s.waiting === 1 ? '' : 's'} waiting to send` : null, s.refused > 0 ? `${s.refused} need${s.refused === 1 ? 's' : ''} you` : null].filter(Boolean);
  return parts.length ? parts.join(' · ') : null;
}
