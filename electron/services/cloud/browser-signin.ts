import { randomBytes, timingSafeEqual } from 'node:crypto';
import { DesktopError } from '../../main/errors';
import { BROWSER_SIGNIN_TTL_MS, type BrowserSignIn, type IdpHint } from '@shared/cloud';

/**
 * The one browser sign-in in progress (screen 3). [WP3]
 *
 * One attempt at a time, `BROWSER_SIGNIN_TTL_MS` (10 minutes) from its start. "Open browser again" opens the same
 * URL; "Copy the sign-in link" copies it (it holds no verifier and no token); Cancel discards the verifier. The
 * callback is matched by a constant-time comparison of `state`; stray callbacks are ignored, as passkey callbacks are
 * today. Enterprise `browser_sign_in` (Core AppHandoff, `worksuite://auth/callback`, `client=worksuite-desktop`) uses
 * the same attempt and screen.
 *
 * The flow keeps only what the screen shows and the `state` to match; the verifier, the nonce and what to do with the
 * code stay with whoever started the attempt (handlers.ts), which hears how it ended through `onEnd`.
 */

export interface StartAttempt {
  accountId: string;
  host: string;
  url: string;
  state: string;
  purpose: BrowserSignIn['purpose'];
  method: IdpHint | null;
  /**
   * Where the browser comes back: `worksuite://auth/oidc`, `worksuite://auth/callback` or the loopback listener's
   * `http://127.0.0.1:<port>/oauth/callback`. A callback anywhere else is not this attempt's.
   */
  callback?: string;
  /** How the attempt ended (not called for `completed`: the caller is the one finishing it). */
  onEnd?: (reason: 'cancelled' | 'expired' | 'replaced') => void;
}

export interface BrowserSignInDeps {
  openExternal: (url: string) => Promise<boolean>;
  copyText: (text: string) => void;
  onChange: (attempt: BrowserSignIn | null) => void;
  now?: () => number;
}

/** A callback this attempt took: its account and the callback's query. */
export interface TakenCallback {
  attempt: BrowserSignIn;
  accountId: string;
  params: URLSearchParams;
}

interface Current {
  view: BrowserSignIn;
  accountId: string;
  state: string;
  callback: string | null;
  onEnd?: StartAttempt['onEnd'];
  timer: NodeJS.Timeout | null;
}

/** Equal strings, in time that does not depend on where they differ. */
export function sameSecret(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** The callback's address without its query, for comparing with where the attempt said it would come back. */
function base(url: URL): string {
  return url.protocol === 'worksuite:' ? `worksuite://${url.host}${url.pathname}`.replace(/\/+$/, '') : `${url.origin}${url.pathname}`;
}

export class BrowserSignInFlow {
  private cur: Current | null = null;

  constructor(private readonly deps: BrowserSignInDeps) {}

  private now(): number {
    return (this.deps.now ?? Date.now)();
  }

  /** The attempt in progress, or null. */
  current(): BrowserSignIn | null {
    if (this.cur && this.cur.view.expiresAt <= this.now()) this.end('expired');
    return this.cur ? { ...this.cur.view } : null;
  }

  /** The account of the attempt in progress. */
  accountId(): string | null {
    return this.current() ? this.cur!.accountId : null;
  }

  /** Starts an attempt (ending the one before) and opens the browser on it. */
  start(attempt: StartAttempt): BrowserSignIn {
    if (!attempt.state || attempt.state.length < 16) throw new DesktopError('INTERNAL', 'A browser sign-in needs a state value.');
    if (this.cur) this.end('replaced', false);
    const startedAt = this.now();
    const view: BrowserSignIn = {
      attemptId: randomBytes(12).toString('base64url'),
      host: attempt.host,
      url: attempt.url,
      startedAt,
      expiresAt: startedAt + BROWSER_SIGNIN_TTL_MS,
      purpose: attempt.purpose,
      method: attempt.method,
    };
    const timer = setTimeout(() => this.cur?.view.attemptId === view.attemptId && this.end('expired'), BROWSER_SIGNIN_TTL_MS);
    timer.unref?.();
    this.cur = { view, accountId: attempt.accountId, state: attempt.state, callback: attempt.callback ?? null, onEnd: attempt.onEnd, timer };
    this.deps.onChange({ ...view });
    void this.deps.openExternal(view.url);
    return { ...view };
  }

  private mine(attemptId: string): Current {
    const c = this.current() ? this.cur : null;
    if (!c || c.view.attemptId !== attemptId) throw new DesktopError('NOT_FOUND', 'That sign-in is no longer waiting. Start again.');
    return c;
  }

  /** "Open browser again": the same URL. */
  reopen(attemptId: string): Promise<boolean> {
    try {
      return this.deps.openExternal(this.mine(attemptId).view.url);
    } catch {
      return Promise.resolve(false);
    }
  }

  /** "Copy the sign-in link": the URL only — no verifier, no token. */
  copyLink(attemptId: string): { url: string } {
    const { url } = this.mine(attemptId).view;
    this.deps.copyText(url);
    return { url };
  }

  cancel(attemptId: string): void {
    if (this.cur?.view.attemptId === attemptId) this.end('cancelled');
  }

  /** Ends whatever attempt there is (a sign-out, the account removed). */
  cancelAll(): void {
    if (this.cur) this.end('cancelled');
  }

  private end(reason: 'cancelled' | 'expired' | 'replaced' | 'completed', announce = true): void {
    const c = this.cur;
    if (!c) return;
    if (c.timer) clearTimeout(c.timer);
    this.cur = null;
    if (reason !== 'completed') c.onEnd?.(reason);
    if (announce) this.deps.onChange(null);
  }

  /**
   * A `worksuite://auth/oidc` or `worksuite://auth/callback` link, or a loopback hit: whether it belongs to the
   * attempt in progress (its `state` matched, and it came back where the attempt said). Nothing is consumed.
   */
  matches(callbackUrl: string): boolean {
    const c = this.current() ? this.cur : null;
    if (!c) return false;
    let u: URL;
    try {
      u = new URL(callbackUrl);
    } catch {
      return false;
    }
    if (c.callback && base(u) !== c.callback.replace(/\/+$/, '')) return false;
    const state = u.searchParams.get('state');
    return !!state && sameSecret(state, c.state);
  }

  /** Takes the callback for the attempt in progress, once: the attempt ends (the screen moves on). Null when not ours. */
  take(callbackUrl: string): TakenCallback | null {
    if (!this.matches(callbackUrl)) return null;
    const c = this.cur!;
    this.end('completed');
    return { attempt: { ...c.view }, accountId: c.accountId, params: new URL(callbackUrl).searchParams };
  }
}
