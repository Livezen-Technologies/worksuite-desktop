import { useSyncExternalStore } from 'react';
import { EMPTY_TIMER, mondayOf, type ProjectsChanged, type ProjectsOutboxItem, type ProjectsSubmit, type ProjectsSubmitResult, type ProjectTimerState } from '@shared/projects';
import { app } from '../../core/app-state';
import { call, hasDesktop, on } from '../../core/bridge';
import { addDays } from '../../core/time';
import { queryClient } from '../../core/query';
import { useStore } from '../../core/store';
import { qk, read } from './api';

/**
 * The Projects app's link to its main-process half (electron/services/projects): the timer the tray shows, the
 * outbox of what waits for WorkSuite, and the pinned and recent projects kept on this computer.
 */

// ── the timer ──────────────────────────────────────────────────────────────

let timer: ProjectTimerState = EMPTY_TIMER;
let outbox: ProjectsOutboxItem[] = [];
const listeners = new Set<() => void>();
let wired = false;

function emit(): void {
  for (const l of listeners) l();
}

/** Asked once per window, then kept current by `projects:changed`. */
function wire(): void {
  if (wired || !hasDesktop()) return;
  wired = true;
  on<ProjectsChanged>('projects:changed', (c) => {
    if (c.timer) timer = c.timer;
    if (c.outbox) {
      const sent = outbox.length > c.outbox.length;
      outbox = c.outbox;
      // Something reached WorkSuite: what the screens show is read again.
      if (sent) void queryClient.invalidateQueries({ queryKey: qk.all });
    }
    emit();
  });
  void call('projects:timer').then((t) => ((timer = t), emit()), () => undefined);
  void call('projects:outbox').then((o) => ((outbox = o), emit()), () => undefined);
}

function subscribe(fn: () => void): () => void {
  wire();
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function useProjectTimer(): ProjectTimerState {
  return useSyncExternalStore(subscribe, () => timer, () => timer);
}

export function useOutbox(): ProjectsOutboxItem[] {
  return useSyncExternalStore(subscribe, () => outbox, () => outbox);
}

/** Sets what a call answered at once (the event follows). */
export function setTimerState(t: ProjectTimerState): ProjectTimerState {
  timer = t;
  emit();
  return t;
}

export function setOutbox(o: ProjectsOutboxItem[]): ProjectsOutboxItem[] {
  outbox = o;
  emit();
  return o;
}

/** A move, comment or time entry: sent now, or kept in the outbox while WorkSuite is out of reach. */
export async function submit(input: ProjectsSubmit): Promise<ProjectsSubmitResult> {
  const r = await call('projects:submit', input);
  void call('projects:outbox').then(setOutbox, () => undefined);
  return r;
}

/** Seconds a running timer has run, ticking with `now`. */
export function elapsedOf(startedAt: string, now: number): number {
  const at = Date.parse(startedAt);
  return Number.isFinite(at) ? Math.max(0, Math.floor((now - at) / 1000)) : 0;
}

// ── pinned and recent projects (stored on this computer) ───────────────────

const RECENT_MAX = 6;

function scope(): string {
  const s = app.get();
  return `${s.auth?.server?.origin ?? ''}|${s.auth?.user?.id ?? ''}`;
}

function readList(kind: 'pins' | 'recent'): number[] {
  try {
    const raw = localStorage.getItem(`ws.projects.${kind}.${scope()}`);
    const v = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(v) ? v.filter((x): x is number => Number.isSafeInteger(x) && x > 0) : [];
  } catch {
    return [];
  }
}

function writeList(kind: 'pins' | 'recent', ids: number[]): void {
  try {
    localStorage.setItem(`ws.projects.${kind}.${scope()}`, JSON.stringify(ids));
  } catch {
    /* a view preference: nothing is lost without it */
  }
  localVersion++;
  for (const l of localListeners) l();
}

let localVersion = 0;
const localListeners = new Set<() => void>();
function subscribeLocal(fn: () => void): () => void {
  localListeners.add(fn);
  return () => localListeners.delete(fn);
}

/** Pinned and recent project ids, kept per server and person on this computer. */
export function usePinsAndRecent(): { pins: number[]; recent: number[] } {
  useSyncExternalStore(subscribeLocal, () => localVersion, () => localVersion);
  return { pins: readList('pins'), recent: readList('recent') };
}

export function togglePin(id: number): void {
  const pins = readList('pins');
  writeList('pins', pins.includes(id) ? pins.filter((x) => x !== id) : [...pins, id]);
  void keepOffline();
}

export function noteRecent(id: number): void {
  const recent = readList('recent');
  if (recent[0] === id) return;
  writeList('recent', [id, ...recent.filter((x) => x !== id)].slice(0, RECENT_MAX));
}

// ── kept for offline (PRJ-DSK-04) ──────────────────────────────────────────

let lastKept = 0;

/**
 * Reads, while WorkSuite answers, what the app must open with offline: the pinned projects' boards and details, my
 * work, the project list and counts, and my time for the last 30 days (five weeks). The API proxy keeps each answer
 * sealed (READ_CACHE); signing out clears them with the rest of the cache. At most every five minutes.
 */
export async function keepOffline(force = false): Promise<void> {
  if (!hasDesktop() || (!force && Date.now() - lastKept < 5 * 60_000)) return;
  lastKept = Date.now();
  const today = new Date().toISOString().slice(0, 10);
  const weeks = [0, 7, 14, 21, 28].map((n) => mondayOf(addDays(today, -n)));
  const jobs: Array<Promise<unknown>> = [read.list(), read.counts(), read.myWork(), ...weeks.map((w) => read.week(w))];
  for (const id of readList('pins')) jobs.push(read.detail(id), read.tasks(id));
  const answers = await Promise.allSettled(jobs);
  // Offline already: nothing new was kept; try again next time.
  if (answers.every((a) => a.status === 'rejected' || (a.value as { offline?: boolean }).offline)) lastKept = 0;
}

/** Whether the server answers right now, by what the last read said (`offline` from READ_CACHE). */
export function useOfflineFlag(...flags: Array<boolean | undefined>): boolean {
  const network = useStore(app, (s) => s.status?.network);
  return flags.some(Boolean) || network === 'OFFLINE';
}
