import type { Store } from './store';

/**
 * What a screen's error boundary caught, with a short reference ID (worksuite-desktop#338).
 *
 * The boundary shows the reference on screen; the same line — module, account where one is known, the error and
 * the reference — goes to the console, which the main process writes to its log (windows/manager.ts), so a reference
 * read out by the person finds the line in a diagnostic report. Diagnostics lists the errors caught in this window
 * and opens on the one a "Diagnostics" button named.
 */
export interface ScreenError {
  ref: string;
  /** The module's name ("Mail"), or the part of it ("Mail · message"). */
  module: string;
  where: 'module' | 'pane';
  /** The account on screen when it happened, where the module said (an ID, never an address). */
  account: string | null;
  name: string;
  message: string;
  stack: string | null;
  at: string;
}

/** Most recent first; the oldest go after this many. */
export const KEPT_ERRORS = 50;

interface ScreenErrorsState {
  errors: ScreenError[];
  accounts: Readonly<Record<string, string | null>>;
}

/*
 * A store of its own rather than core/store's createStore: every screen's boundary imports this, so it is kept free
 * of anything a test of one screen may stand in for.
 */
let state: ScreenErrorsState = { errors: [], accounts: {} };
const subs = new Set<() => void>();
export const screenErrors: Store<ScreenErrorsState> = {
  get: () => state,
  set(patch) {
    state = { ...state, ...(typeof patch === 'function' ? patch(state) : patch) };
    for (const fn of subs) fn();
  },
  subscribe(fn) {
    subs.add(fn);
    return () => subs.delete(fn);
  },
};

/** "E-7F3A9C": short enough to read out on the phone. */
export function newErrorRef(): string {
  const bytes = new Uint8Array(3);
  globalThis.crypto.getRandomValues(bytes);
  return `E-${Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('').toUpperCase()}`;
}

/** The account a module is showing now (Mail: the open message's, else the folder's), for the next error it has. */
export function noteAccount(module: string, account: string | null): void {
  if ((screenErrors.get().accounts[module] ?? null) === account) return;
  screenErrors.set((s) => ({ accounts: { ...s.accounts, [module]: account } }));
}

/** Keep and log a caught error; returns it with its reference. */
export function recordScreenError(input: { module: string; where: ScreenError['where']; error: unknown; componentStack?: string | null; account?: string | null; key?: string }): ScreenError {
  const e = input.error instanceof Error ? input.error : new Error(String(input.error));
  const key = input.key ?? input.module.split(' · ')[0]!.toLowerCase();
  const entry: ScreenError = {
    ref: newErrorRef(),
    module: input.module,
    where: input.where,
    account: input.account !== undefined ? input.account : (screenErrors.get().accounts[key] ?? null),
    name: e.name || 'Error',
    message: e.message || String(e),
    stack: [e.stack ?? '', input.componentStack ? `Component stack:${input.componentStack}` : ''].filter(Boolean).join('\n\n') || null,
    at: new Date().toISOString(),
  };
  screenErrors.set((s) => ({ errors: [entry, ...s.errors].slice(0, KEPT_ERRORS) }));
  console.error(`[module:${input.module}] ref=${entry.ref}${entry.account ? ` account=${entry.account}` : ''}`, e, input.componentStack ?? '');
  return entry;
}

/** Diagnostics' route for one error. */
export function diagnosticsRoute(ref: string | null): string {
  return ref ? `/diagnostics?error=${encodeURIComponent(ref)}` : '/diagnostics';
}
