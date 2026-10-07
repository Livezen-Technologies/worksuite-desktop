import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { apiGet, apiPost } from '../../core/api';
import { app } from '../../core/app-state';
import { MY_PRESENCE_KEY, refreshMyPresence } from '../../core/presence';
import { createStore, useStore } from '../../core/store';
import { toast } from '../../core/toasts';
import { useNow } from '../../core/use-now';
import { isNotOffered, phoneApi } from './api';
import { expiry, fromPresence, NO_PREFS, parsePrefs, resolveStatus, ringOf, switchNote, type CallStatus, type CallStatusPrefs, type Resolved, type SwitchTook } from './lib/callstatus';

/**
 * The status calls are in (worksuite-desktop#288), kept in step everywhere:
 *
 *  - **One status.** While calls follow the WorkSuite status, choosing one here sets it for everybody to see (Chat's
 *    presence, `POST /api/chat/presence` — the top bar, Chat and Website chats show it at once), and a change made in
 *    the top bar, in Chat or on another computer reaches the phone the moment that copy asks again (`MY_PRESENCE_KEY`,
 *    refreshed by `chat.presence` and by every place that sets it). Given their own status, calls keep it whatever the
 *    WorkSuite status does.
 *  - **The phone on this computer** rings by it: PhoneHost hands the status to the softphone (loud, quiet, or not here).
 *  - **The switch** hears of it through the proposed `PUT /api/voip/me/dnd` — Do not disturb on or off, which a server
 *    that has the route turns into the switch's own Do not disturb, plus the status and when it ends for a server that
 *    keeps them. Without the route the status still works on this computer and the person is told what it can't do.
 *  - **Do not disturb for a while** ends on its own: PhoneHost checks at the time and every 15 s after a sleep. The
 *    server has no end time to keep, so a desktop that is closed puts it back when it next starts.
 *
 * What the person chose for calls is kept on this computer, per person.
 */

interface MyPresence {
  status: string;
  choice: string;
}

interface StatusState {
  prefs: CallStatusPrefs;
  /** The WorkSuite status as last heard, so calls follow it from the start, before the server answers again. */
  seen: string | null;
}

const KEY = 'ws.phone.status';
const LEGACY_DND = 'ws.phone.dnd';

export const callStatusStore = createStore<StatusState>({ prefs: NO_PREFS, seen: null });

function storageKey(): string {
  const id = app.get().auth?.user?.id;
  return id ? `${KEY}.${id}` : KEY;
}

function hasChatNow(): boolean {
  return app.get().apps.some((a) => a.id === 'chat');
}

/** This person's choice for calls, read at sign-in (PhoneHost). */
export function loadCallStatus(): void {
  let raw: string | null = null;
  let legacy: string | null = null;
  try {
    raw = localStorage.getItem(storageKey());
    legacy = localStorage.getItem(LEGACY_DND);
  } catch {
    /* nothing kept */
  }
  let seen: string | null = null;
  try {
    const v = raw ? (JSON.parse(raw) as { seen?: unknown } | null) : null;
    seen = typeof v?.seen === 'string' ? v.seen : null;
  } catch {
    /* parsePrefs starts again too */
  }
  callStatusStore.set({ prefs: parsePrefs(raw, legacy), seen });
}

function save(next: Partial<StatusState>): void {
  callStatusStore.set(next);
  const s = callStatusStore.get();
  try {
    localStorage.setItem(storageKey(), JSON.stringify({ ...s.prefs, seen: s.seen }));
    localStorage.removeItem(LEGACY_DND);
  } catch {
    /* this session only */
  }
}

/* ======================================================================== *
 * The switch (proposed `PUT me/dnd`)
 * ======================================================================== */

/** Whether this server has the route: unknown until asked, then remembered for the session. */
let switchOffered: boolean | null = null;
/** What the switch was last told (or is being told), so a change is sent once. */
let told: Pick<Resolved, 'status' | 'linked'> | null = null;
let ending = false;

const keyOf = (r: Pick<Resolved, 'status' | 'until' | 'linked'>) => `${r.status}|${r.until ?? ''}|${r.linked}`;
const sameAsTold = (r: Pick<Resolved, 'status' | 'linked'>) => told !== null && told.status === r.status && told.linked === r.linked;

/** Forget the session's answers (sign-out, tests). */
export function resetCallStatus(): void {
  switchOffered = null;
  told = null;
  ending = false;
  callStatusStore.set({ prefs: NO_PREFS, seen: null });
}

/**
 * Tell the phone system. Do not disturb on or off is what a server with the route acts on (Away counts as Do not
 * disturb there: calls are not to ring); the status and its end ride along for a server that keeps them, which answers
 * them back. Not offered: the status works on this computer only. Refused: the server's own words.
 */
export async function tellSwitch(r: Pick<Resolved, 'status' | 'until' | 'linked'>): Promise<{ took: SwitchTook; refused?: string }> {
  told = { status: r.status, linked: r.linked };
  if (switchOffered === false) return { took: 'local' };
  try {
    const a = await phoneApi.setCallStatus({ dnd: ringOf(r.status) === 'off', sync_presence: r.linked, status: r.status, until: r.until ? new Date(r.until).toISOString() : null });
    switchOffered = true;
    return { took: a?.status === r.status ? 'all' : 'dnd' };
  } catch (e) {
    if (isNotOffered(e)) {
      switchOffered = false;
      return { took: 'local' };
    }
    return { took: 'local', refused: e instanceof Error ? e.message : String(e) };
  }
}

/* ======================================================================== *
 * Choosing
 * ======================================================================== */

/** The WorkSuite status: what the server last said, else what was last heard; undefined without one. */
function workSuiteChoice(qc: QueryClient, heardOnly = false): string | undefined {
  if (!hasChatNow()) return undefined;
  const heard = qc.getQueryData<MyPresence>(MY_PRESENCE_KEY)?.choice;
  return heardOnly ? heard : (heard ?? callStatusStore.get().seen ?? undefined);
}

/** Set the WorkSuite status, and show it in every copy at once before they ask the server again. */
async function setPresence(qc: QueryClient, choice: string): Promise<void> {
  await apiPost('/api/chat/presence', { status: choice, active: true });
  const shown = choice === 'available' ? 'online' : choice;
  for (const key of [MY_PRESENCE_KEY, ['account', 'presence']] as const) qc.setQueryData<MyPresence>(key, (old) => ({ ...(old ?? {}), status: shown, choice }));
  save({ seen: choice });
  void refreshMyPresence(qc);
}

function sayHowItWent(status: CallStatus, res: { took: SwitchTook; refused?: string }): void {
  const note = res.refused ? `The phone system didn’t take it: ${res.refused} Calls follow it on this computer.` : switchNote(status, res.took);
  if (note) toast('info', note);
}

/**
 * Choose a status (the status menu, Forwarding's Do not disturb): for everybody while calls follow the WorkSuite
 * status, for calls only otherwise. `until` makes it a Do not disturb for a while. False when WorkSuite refused it.
 */
export async function chooseCallStatus(qc: QueryClient, status: CallStatus, until: number | null = null): Promise<boolean> {
  const before = callStatusStore.get().prefs;
  const choice = workSuiteChoice(qc);
  const now = Date.now();
  const r = resolveStatus(before, choice, now);
  const timed = status === 'dnd' && until !== null && until > now;
  // What comes back when it ends: the status before Do not disturb, not a Do not disturb chosen earlier.
  const back = r.linked ? (choice !== 'dnd' && choice ? choice : before.timer?.scope === 'everywhere' ? before.timer.back : 'available') : r.status !== 'dnd' ? r.status : before.timer?.scope === 'calls' ? before.timer.back : 'available';
  const target = { status, until: timed ? until : null, linked: r.linked };
  // Said before anything changes, so PhoneHost does not tell the switch a second time as the copies update.
  told = target;
  save({ prefs: r.linked ? { own: null, timer: timed ? { until, back, scope: 'everywhere' } : null } : { own: status, timer: timed ? { until, back, scope: 'calls' } : null } });
  if (r.linked) {
    try {
      await setPresence(qc, status);
    } catch (e) {
      save({ prefs: before });
      told = null;
      toast('error', (e as Error).message);
      return false;
    }
  }
  sayHowItWent(status, await tellSwitch(target));
  return true;
}

/**
 * Calls follow the WorkSuite status again (on), or keep the status they are in as their own (off) — with a Do not
 * disturb for a while keeping its end. Following again ends a Do not disturb that was for calls alone.
 */
export async function linkCallStatus(qc: QueryClient, on: boolean): Promise<void> {
  const { prefs } = callStatusStore.get();
  const choice = workSuiteChoice(qc);
  const now = Date.now();
  const r = resolveStatus(prefs, choice, now);
  if (on) save({ prefs: { own: null, timer: prefs.timer?.scope === 'everywhere' ? prefs.timer : null } });
  else save({ prefs: { own: r.status, timer: r.until && prefs.timer ? { until: r.until, back: fromPresence(prefs.timer.back) ?? 'available', scope: 'calls' } : null } });
  const next = resolveStatus(callStatusStore.get().prefs, choice, now);
  if (keyOf(next) === keyOf(r)) return;
  const res = await tellSwitch(next);
  if (res.refused) sayHowItWent(next.status, res);
}

/**
 * A Do not disturb whose time is up ends: the calls' own status comes back, or the WorkSuite status — set only from
 * what the server last said (a change made on the web since wins), and asked again at the next check when it fails.
 */
export async function endDndIfDue(qc: QueryClient): Promise<void> {
  if (ending) return;
  const { prefs } = callStatusStore.get();
  if (!prefs.timer || prefs.timer.until > Date.now()) return;
  const choice = workSuiteChoice(qc, true);
  if (prefs.timer.scope === 'everywhere' && hasChatNow() && choice === undefined) return;
  const e = expiry(prefs, choice, Date.now());
  if (!e) return;
  ending = true;
  try {
    const next = resolveStatus(e.prefs, e.presence ?? choice, Date.now());
    told = next;
    if (e.presence) await setPresence(qc, e.presence);
    // Something else chosen meanwhile: that stands.
    if (callStatusStore.get().prefs.timer?.until !== prefs.timer.until) return;
    save({ prefs: e.prefs });
    void tellSwitch(next);
  } catch {
    told = null;
  } finally {
    ending = false;
  }
}

/* ======================================================================== *
 * Hooks
 * ======================================================================== */

export interface CallStatusView extends Resolved {
  /** The WorkSuite status (a presence choice), when there is one. */
  workSuite: string | null;
  /** Calls can follow the WorkSuite status: the person has Chat's presence. */
  canLink: boolean;
  /** The server has answered (or there is nothing to ask): changes from now on are changes, not the first word. */
  settled: boolean;
  /** What the server said, not a remembered value. */
  heard: string | null;
  now: number;
}

/** The status calls are in, as every screen shows it. */
export function useCallStatus(): CallStatusView {
  const hasChat = useStore(app, (s) => s.apps.some((a) => a.id === 'chat'));
  const presence = useQuery({ queryKey: MY_PRESENCE_KEY, queryFn: ({ signal }) => apiGet<MyPresence>('/api/chat/presence/me', undefined, signal), enabled: hasChat, refetchInterval: 60_000, retry: false });
  const prefs = useStore(callStatusStore, (s) => s.prefs);
  const seen = useStore(callStatusStore, (s) => s.seen);
  const now = useNow(15_000).getTime();
  const heard = hasChat ? (presence.data?.choice ?? null) : null;
  const choice = hasChat ? (heard ?? seen ?? undefined) : undefined;
  return { ...resolveStatus(prefs, choice, now), workSuite: choice ?? null, canLink: hasChat && !!fromPresence(choice), settled: !hasChat || presence.isFetched, heard, now };
}

/**
 * In the main window's PhoneHost: the softphone rings by the status (`apply`), a Do not disturb for a while ends on
 * time, what WorkSuite said is remembered for the next start, and the switch hears of a change made elsewhere — the
 * top bar, Chat, another computer — while calls follow the WorkSuite status.
 */
export function useCallStatusSync(apply: (status: CallStatus) => void): CallStatusView {
  const qc = useQueryClient();
  useEffect(() => {
    loadCallStatus();
    // Chosen in another window of the app (the same origin, the same storage): the phone here follows it.
    const onStorage = (e: StorageEvent) => {
      if (e.key === storageKey()) loadCallStatus();
    };
    window.addEventListener('storage', onStorage);
    return () => {
      window.removeEventListener('storage', onStorage);
      // Signed out, or the Phone went away: the next person, or server, starts afresh.
      resetCallStatus();
    };
  }, []);
  const s = useCallStatus();
  const { status, until, linked, heard, settled } = s;
  useEffect(() => {
    apply(status);
  }, [apply, status]);
  useEffect(() => {
    if (heard && heard !== callStatusStore.get().seen) save({ seen: heard });
  }, [heard]);
  const timerUntil = useStore(callStatusStore, (x) => x.prefs.timer?.until ?? null);
  useEffect(() => {
    if (timerUntil === null) return;
    const check = () => void endDndIfDue(qc);
    const t = setTimeout(check, Math.min(Math.max(0, timerUntil - Date.now()), 2 ** 31 - 1));
    const i = setInterval(check, 15_000);
    return () => {
      clearTimeout(t);
      clearInterval(i);
    };
  }, [qc, timerUntil, heard]);
  // A change of status, not of its end: a Do not disturb running out is the expiry's to tell, a new end the chooser's.
  const key = `${status}|${linked}`;
  const prev = useRef<string | null>(null);
  useEffect(() => {
    if (!settled) return;
    if (prev.current !== null && prev.current !== key && linked && !sameAsTold({ status, linked })) void tellSwitch({ status, until, linked });
    prev.current = key;
  }, [key, settled, status, until, linked]);
  return s;
}
