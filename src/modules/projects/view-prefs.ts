import { useSyncExternalStore } from 'react';
import { apiGet, apiPut } from '../../core/api';
import { app } from '../../core/app-state';
import { normaliseTaskView, DEFAULT_TASK_VIEW, type TaskViewPrefs } from './list';

/**
 * Which view a project's tasks open in, and how the list is laid out (PRJ-LST-02, §14.1 Memory): per person through
 * the generic preferences (`GET|PUT /api/prefs/projects.task_view`, with a per-project override
 * `projects.task_view.p{id}`), the same rows the web reads, so the two agree. Like core/org-prefs.ts, this computer
 * keeps a copy read synchronously — a project opens on its view at once, and offline — a change is made here first,
 * marked unsent and sent a moment later, and the server's copy is taken only while nothing here is unsent.
 *
 * A change made in a project is that project's (`p{id}`) and becomes the person's default too, for a project they have
 * not opened yet. A server without the scope (or offline) leaves the copy here standing.
 */

export const TASK_VIEW_SCOPE = 'projects.task_view';
export const TASK_VIEW_SEND_DELAY_MS = 800;
const projectScope = (projectId: number) => `${TASK_VIEW_SCOPE}.p${projectId}`;

interface Held {
  prefs: TaskViewPrefs;
  /** Changed here and not yet taken by the server. */
  dirty: boolean;
}

type Copy = Record<string, Held>;

let version = 0;
const listeners = new Set<() => void>();
const timers = new Map<string, ReturnType<typeof setTimeout>>();
let memo: { key: string; copy: Copy } | null = null;

function who(): string | null {
  const s = app.get();
  if (s.session?.mode === 'guest') return 'guest';
  const id = s.auth?.user?.id;
  return id == null ? null : `${s.auth?.server?.origin ?? ''}|${id}`;
}

const storageKey = (user: string) => `ws.projects.taskview.${user}`;

function load(user: string): Copy {
  if (memo?.key === user) return memo.copy;
  let copy: Copy = {};
  try {
    const raw = JSON.parse(localStorage.getItem(storageKey(user)) ?? 'null') as unknown;
    if (raw && typeof raw === 'object') {
      for (const [scope, v] of Object.entries(raw as Record<string, unknown>)) {
        const h = v as { prefs?: unknown; dirty?: unknown } | null;
        const prefs = normaliseTaskView(h?.prefs);
        if (prefs) copy[scope] = { prefs, dirty: h?.dirty === true };
      }
    }
  } catch {
    copy = {};
  }
  memo = { key: user, copy };
  return copy;
}

function store(user: string, copy: Copy): void {
  memo = { key: user, copy };
  try {
    localStorage.setItem(storageKey(user), JSON.stringify(copy));
  } catch {
    // Storage full or blocked: the server's copy is still the person's.
  }
  version++;
  for (const l of listeners) l();
}

const online = () => app.get().session?.mode !== 'guest' && app.get().auth?.stage === 'ready';

/** The view a project's tasks open in, and the list's layout: the project's own, else the person's default. */
export function recallTaskView(projectId: number): TaskViewPrefs {
  const user = who();
  if (!user) return DEFAULT_TASK_VIEW;
  const copy = load(user);
  return copy[projectScope(projectId)]?.prefs ?? copy[TASK_VIEW_SCOPE]?.prefs ?? DEFAULT_TASK_VIEW;
}

/** Remembers a change for this project and as the person's default; sent to the server a moment later. */
export function rememberTaskView(projectId: number, patch: Partial<TaskViewPrefs>): TaskViewPrefs {
  const next = normaliseTaskView({ ...recallTaskView(projectId), ...patch }) ?? DEFAULT_TASK_VIEW;
  const user = who();
  if (!user) return next;
  const copy = {
    ...load(user),
    [projectScope(projectId)]: { prefs: next, dirty: true },
    [TASK_VIEW_SCOPE]: { prefs: next, dirty: true },
  };
  store(user, copy);
  for (const scope of [projectScope(projectId), TASK_VIEW_SCOPE]) {
    const had = timers.get(scope);
    if (had) clearTimeout(had);
    timers.set(
      scope,
      setTimeout(() => void flushTaskView(scope), TASK_VIEW_SEND_DELAY_MS),
    );
  }
  return next;
}

/** Sends an unsent scope now (the timer's work; tests call it directly). Quiet offline: sent at the next sync. */
export async function flushTaskView(scope?: string): Promise<void> {
  const user = who();
  if (!user || !online()) return;
  const copy = load(user);
  for (const s of scope ? [scope] : Object.keys(copy)) {
    timers.delete(s);
    const held = copy[s];
    if (!held?.dirty) continue;
    try {
      await apiPut(`/api/prefs/${s}`, { prefs: held.prefs });
      const now = load(user);
      if (now[s]?.prefs === held.prefs) store(user, { ...now, [s]: { prefs: held.prefs, dirty: false } });
    } catch {
      // Offline, or a server without the scope: kept, and tried again at the next sync.
    }
  }
}

/** Brings this project's copy and the server's together: an unsent change goes up, else the server's is taken. */
export async function syncTaskView(projectId: number): Promise<void> {
  const user = who();
  if (!user || !online()) return;
  await flushTaskView();
  for (const scope of [TASK_VIEW_SCOPE, projectScope(projectId)]) {
    try {
      const res = await apiGet<{ prefs: unknown }>(`/api/prefs/${scope}`);
      const remote = normaliseTaskView(res?.prefs);
      const now = load(user);
      if (!remote || now[scope]?.dirty || who() !== user) continue;
      if (JSON.stringify(now[scope]?.prefs) !== JSON.stringify(remote)) store(user, { ...now, [scope]: { prefs: remote, dirty: false } });
    } catch {
      // Offline or refused: what is here stands.
    }
  }
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** A project's view and list layout, kept current. */
export function useTaskView(projectId: number): TaskViewPrefs {
  useSyncExternalStore(
    subscribe,
    () => version,
    () => version,
  );
  return recallTaskView(projectId);
}

/** For tests: forget what is held in memory (the copy on this computer stays). */
export function resetTaskViewForTests(): void {
  for (const t of timers.values()) clearTimeout(t);
  timers.clear();
  memo = null;
  version++;
}
