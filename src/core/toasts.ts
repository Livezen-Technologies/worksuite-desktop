import type { ToastMessage } from '@shared/types';
import { createStore } from './store';

export interface ToastAction {
  label: string;
  run: () => void;
}

export interface Toast extends ToastMessage {
  id: number;
  action?: ToastAction;
  /** More buttons after `action` ("Retry · Details"). */
  actions?: ToastAction[];
  /** Toasts with the same key are one toast: a new one replaces it in place ("4 messages deleted · Undo"). */
  key?: string;
  /** The same toast again while it shows: "×2" rather than a second copy (worksuite-desktop#235). */
  count?: number;
  /** Stays until closed: errors, unless a lifetime is given. */
  sticky?: boolean;
}

export interface ToastOptions {
  key?: string;
  actions?: ToastAction[];
  /** Override: an error that closes itself, or an info that stays. */
  sticky?: boolean;
}

/**
 * The app's toasts (one component for every module, src/app/overlays/Toasts.tsx).
 *
 * worksuite-desktop#235: at most THREE at once, newest last; the same toast again is counted ("×4") instead of
 * stacking four copies; a toast with a `key` is replaced in place, so an action can group what it says
 * ("Deleted" → "4 messages deleted"); info and success close by themselves, errors stay until closed.
 */
export const MAX_TOASTS = 3;

export const toasts = createStore<{ items: Toast[] }>({ items: [] });
let seq = 0;
const timers = new Map<number, ReturnType<typeof setTimeout>>();

function arm(id: number, ttlMs: number | null): void {
  const t = timers.get(id);
  if (t) clearTimeout(t);
  timers.delete(id);
  if (ttlMs !== null) timers.set(id, setTimeout(() => dismiss(id), ttlMs));
}

/** Shows a toast. Errors stay until closed unless `ttlMs` is given. */
export function toast(kind: Toast['kind'], text: string, action?: Toast['action'], ttlMs?: number, opts: ToastOptions = {}): void {
  const sticky = opts.sticky ?? (kind === 'error' && ttlMs === undefined);
  const ttl = sticky ? null : (ttlMs ?? 4500);
  const items = toasts.get().items;
  const same = opts.key ? items.find((t) => t.key === opts.key) : items.find((t) => !t.key && t.kind === kind && t.text === text);
  const id = same?.id ?? ++seq;
  const next: Toast = {
    id,
    kind,
    text,
    ...(action ? { action } : {}),
    ...(opts.actions?.length ? { actions: opts.actions } : {}),
    ...(opts.key ? { key: opts.key } : {}),
    ...(same && !opts.key ? { count: (same.count ?? 1) + 1 } : {}),
    ...(sticky ? { sticky } : {}),
  };
  const kept = items.filter((t) => t.id !== id);
  const all = [...kept, next];
  const dropped = all.slice(0, Math.max(0, all.length - MAX_TOASTS));
  for (const d of dropped) arm(d.id, null);
  toasts.set({ items: all.slice(-MAX_TOASTS) });
  arm(id, ttl);
}

export function dismiss(id: number): void {
  arm(id, null);
  if (!toasts.get().items.some((t) => t.id === id)) return;
  toasts.set((s) => ({ items: s.items.filter((t) => t.id !== id) }));
}

/** Closes the toast with this key, if it shows. */
export function dismissKey(key: string): void {
  const t = toasts.get().items.find((x) => x.key === key);
  if (t) dismiss(t.id);
}
