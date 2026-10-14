import type { AccountRecord } from '@shared/accounts';
import { DesktopError } from '../../main/errors';

/**
 * Opening another account in about two seconds (Connection & Startup §1.3): one service graph, its lowest layer
 * rebound — the database swapped, the secrets and the vault rebound, the token holder reset — rather than a second
 * graph. Each step after the other:
 *
 *  1. Guards: locked → APP_LOCKED; a call, meeting, screen share or remote control → SWITCH_BLOCKED with why.
 *  2. `accounts:changed{switching}`: the renderer shows "Opening <account>…".
 *  3. Windows save their drafts (`update:prepare`, at most 400 ms); meanwhile the new main window is made, hidden,
 *     in the target's partition.
 *  4. The open account is suspended: its services stopped (no wipe, no revoke), its requests aborted (epoch moves
 *     on), transfers paused, every window but the main one closed.
 *  5. Background: the old account becomes a background one; the new one is released by the background poller,
 *     waiting for a refresh it has under way (one refresher per account, risk 3).
 *  6. The new scope is bound: database, secrets, vault, AuthService, settings scope, partitions, X-WS-Org.
 *  7. The registry's active account, then the session from the cached bootstrap (`init({cachedFirst})`).
 *  8. The new window shows where the old one was; the old one goes. `accounts.switch` timing to Diagnostics.
 *  9. Steps 4–6 failing, or over 1,500 ms: relaunch into the account (`--account=<id>`). `WS_ACCOUNT_SWITCH=relaunch`
 *     always relaunches (the kill switch).
 */

export type SwitchMode = 'inprocess' | 'relaunch';

/** The kill switch: `WS_ACCOUNT_SWITCH=relaunch` (a build's environment) makes every switch a relaunch. */
export function switchModeFrom(env: NodeJS.ProcessEnv = process.env): SwitchMode {
  return (env.WS_ACCOUNT_SWITCH ?? '').trim().toLowerCase() === 'relaunch' ? 'relaunch' : 'inprocess';
}

/** The longest steps 4–6 may take before a relaunch is the better way. */
export const BIND_BUDGET_MS = 1_500;
/** How long windows get to save their drafts. */
export const PREPARE_CAP_MS = 400;

export interface SwitchGuard {
  code: 'APP_LOCKED' | 'SWITCH_BLOCKED';
  reason: string;
}

export interface SwitcherDeps<W> {
  account: (id: string) => AccountRecord | null;
  activeId: () => string | null;
  setActive: (id: string) => void;
  guard: () => SwitchGuard | null;
  /** `accounts:changed` with `switching` set (or cleared with null). */
  switching: (id: string | null) => void;
  /** Windows save their drafts and tabs; resolves within `capMs` whatever they answer. */
  prepare: (capMs: number) => Promise<void>;
  /** The new main window, hidden, in the account's partition; null when the window can stay (same partition). */
  createWindow: (account: AccountRecord) => W | null | Promise<W | null>;
  /** Step 4: the open account's services stopped, requests aborted, transfers paused, other windows closed. */
  suspend: () => void | Promise<void>;
  background: { adopt: (id: string) => void; release: (id: string) => Promise<void> };
  /** Step 6: the new account's database, secrets, vault, auth, settings scope, partitions, X-WS-Org. */
  bind: (account: AccountRecord) => void | Promise<void>;
  /** Step 7: the session from the cached bootstrap first. */
  init: () => Promise<void>;
  /** Step 8: shows the new window where the old one was and closes the old one. */
  show: (win: W) => void;
  /** The new window, when the switch did not finish in-process. */
  discard: (win: W) => void;
  /** Step 9: restart into the account. */
  relaunch: (id: string) => void;
  mode: () => SwitchMode;
  now?: () => number;
  timing?: (ms: number, how: 'inprocess' | 'relaunch', failed: string | null) => void;
}

export class AccountSwitcher<W> {
  private running: Promise<{ switched: true; ms: number }> | null = null;
  private target: string | null = null;

  constructor(private readonly d: SwitcherDeps<W>) {}

  /** The account being opened now, if a switch is under way. */
  switching(): string | null {
    return this.target;
  }

  switchTo(id: string): Promise<{ switched: true; ms: number }> {
    if (this.running) {
      if (this.target === id) return this.running;
      return Promise.reject(new DesktopError('SWITCH_BLOCKED', 'Another account is being opened. Try again in a moment.'));
    }
    const flight = this.run(id).finally(() => {
      this.running = null;
      this.target = null;
    });
    this.running = flight;
    this.target = id;
    return flight;
  }

  private async run(id: string): Promise<{ switched: true; ms: number }> {
    const now = this.d.now ?? Date.now;
    const t0 = now();
    const account = this.d.account(id);
    if (!account) throw new DesktopError('NOT_FOUND', 'That account is no longer on this computer.');
    if (this.d.activeId() === id) return { switched: true, ms: 0 };
    // 1. Guards.
    const blocked = this.d.guard();
    if (blocked) throw new DesktopError(blocked.code, blocked.reason);

    const from = this.d.activeId();
    if (this.d.mode() === 'relaunch') {
      this.d.setActive(id);
      this.d.timing?.(now() - t0, 'relaunch', null);
      this.d.relaunch(id);
      return { switched: true, ms: now() - t0 };
    }

    // 2. The overlay.
    this.d.switching(id);
    let win: W | null = null;
    try {
      // 3. Drafts saved, the new window made meanwhile.
      const [made] = await Promise.all([Promise.resolve(this.d.createWindow(account)), this.d.prepare(PREPARE_CAP_MS)]);
      win = made;
    } catch (e) {
      this.d.switching(null);
      if (win) this.d.discard(win);
      throw e;
    }

    // 4–6, timed: a failure or a slow bind relaunches into the account.
    const tBind = now();
    let failed: string | null = null;
    try {
      await this.d.suspend();
      if (from) this.d.background.adopt(from);
      await this.d.background.release(id);
      await this.d.bind(account);
    } catch (e) {
      failed = String((e as Error)?.message ?? e).slice(0, 200);
    }
    if (failed !== null || now() - tBind > BIND_BUDGET_MS) {
      if (win) this.d.discard(win);
      this.d.setActive(id);
      this.d.timing?.(now() - t0, 'relaunch', failed ?? 'slow');
      this.d.relaunch(id);
      return { switched: true, ms: now() - t0 };
    }

    // 7. Active, then the session from what is cached.
    this.d.setActive(id);
    try {
      await this.d.init();
    } finally {
      // 8. The new window in front, the overlay gone.
      if (win) this.d.show(win);
      this.d.switching(null);
    }
    const ms = now() - t0;
    this.d.timing?.(ms, 'inprocess', null);
    return { switched: true, ms };
  }
}
