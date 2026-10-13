import { DesktopError } from '../../main/errors';
import type { BrowserSignIn, IdpHint } from '@shared/cloud';

/**
 * The one browser sign-in in progress (screen 3). [WP3]
 *
 * One attempt at a time, `BROWSER_SIGNIN_TTL_MS` (10 minutes) from its start. "Open browser again" opens the same
 * URL; "Copy the sign-in link" copies it (it holds no verifier and no token); Cancel discards the verifier. The
 * callback is matched by a constant-time comparison of `state`; stray callbacks are ignored, as passkey callbacks are
 * today. Enterprise `browser_sign_in` (Core AppHandoff, `worksuite://auth/callback`, `client=worksuite-desktop`) uses
 * the same attempt and screen.
 */

export interface StartAttempt {
  accountId: string;
  host: string;
  url: string;
  state: string;
  purpose: BrowserSignIn['purpose'];
  method: IdpHint | null;
}

export interface BrowserSignInDeps {
  openExternal: (url: string) => Promise<boolean>;
  copyText: (text: string) => void;
  onChange: (attempt: BrowserSignIn | null) => void;
  now?: () => number;
}

export class BrowserSignInFlow {
  constructor(private readonly deps: BrowserSignInDeps) {}

  /** The attempt in progress, or null. */
  current(): BrowserSignIn | null {
    void this.deps;
    return null;
  }

  start(_attempt: StartAttempt): BrowserSignIn {
    throw new DesktopError('UNSUPPORTED', 'Signing in through the browser is not available in this version.');
  }

  reopen(_attemptId: string): Promise<boolean> {
    return Promise.resolve(false);
  }

  copyLink(_attemptId: string): { url: string } {
    throw new DesktopError('UNSUPPORTED', 'Signing in through the browser is not available in this version.');
  }

  cancel(_attemptId: string): void {}

  /**
   * A `worksuite://auth/oidc` or `worksuite://auth/callback` link, or a loopback hit: whether it belongs to the
   * attempt in progress (its `state` matched). Stub: false, so the existing passkey handling still sees it.
   */
  matches(_callbackUrl: string): boolean {
    return false;
  }
}
