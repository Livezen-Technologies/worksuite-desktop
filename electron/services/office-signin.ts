import { mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { WindowLimiter } from '@shared/backoff';
import { officeCallback, parseOfficeSignIn, type OfficeSignInRequest } from '@shared/office-signin';

/**
 * Signing in WorkSuite Office with this app's sign-in (worksuite-office#6) — the two halves this app owns.
 *
 * DesktopAccountsFile tells WorkSuite Office, on the same computer, who this app is signed in as, so it can
 * offer "Continue as <name>" without a browser. OfficeSignIn answers when the person chooses it there.
 */

/** Who is signed in, as WorkSuite Office shows it. Names and addresses: never a token. */
export interface DesktopAccount {
  server: string;
  user: { id: string; name: string; email: string; organization: string };
}

/**
 * <app data>/WorkSuite/desktop-accounts.json. This app's data folder is that folder (productName WorkSuite),
 * and WorkSuite Office reads the file there; a development or test profile (WS_USER_DATA_DIR) keeps its own.
 *
 * Rewritten when the session or the person's profile changes, emptied when nobody is signed in. Only this
 * user can read it. It says no more than the person's name, email, organisation and server, which any app
 * running as them could already see in WorkSuite's windows.
 */
export class DesktopAccountsFile {
  private last = '';

  constructor(
    private readonly file: string,
    private readonly log: { warn(msg: string, meta?: Record<string, unknown>): void },
  ) {}

  update(account: DesktopAccount | null): void {
    const text = `${JSON.stringify({ version: 1, app: 'WorkSuite Desktop', accounts: account ? [account] : [] }, null, 2)}\n`;
    // Session changes repeat for the same stage; the file is written when what it says changes.
    if (text === this.last) return;

    try {
      mkdirSync(dirname(this.file), { recursive: true, mode: 0o700 });
      const tmp = `${this.file}.${process.pid}.tmp`;
      writeFileSync(tmp, text, { mode: 0o600 });
      renameSync(tmp, this.file);
      this.last = text;
    } catch (e) {
      this.log.warn('desktop accounts file not written', { message: e instanceof Error ? e.message : String(e) });
    }
  }
}

export interface OfficeSignInDeps {
  /** The signed-in account, or null when nobody is (or the session is not ready). */
  account(): { origin: string; userId: string; name: string; organization: string | null } | null;
  isLocked(): boolean;
  /** Ask the person. True when they chose to continue. */
  confirm(text: { message: string; detail: string }): Promise<boolean>;
  /** POST /api/auth/apps/handoff with this app's session; answers the envelope's data. */
  handoff(challenge: string): Promise<unknown>;
  /** Hand a link to the operating system, which gives it to WorkSuite Office. */
  open(url: string): Promise<void>;
  showMain(): void;
  toast(kind: 'error' | 'info', text: string): void;
  /** The server does not offer the hand-off (an older WorkSuite). */
  isNotFound(e: unknown): boolean;
  log: { info(msg: string, meta?: Record<string, unknown>): void; warn(msg: string, meta?: Record<string, unknown>): void };
  now?: () => number;
}

/** How long a request that arrived while the app was locked waits for the person to unlock it. */
const WAIT_WHILE_LOCKED_MS = 2 * 60_000;

/**
 * worksuite://office/signin, handled.
 *
 * WHO MAY ASK. Any program on the computer can open a worksuite:// link, so the link proves nothing: the
 * person decides, in this app's own dialog, every time. The link must name this app's server and user (the
 * ones desktop-accounts.json gave WorkSuite Office); the code goes only to WorkSuite Office's fixed address;
 * and it is bound to the PKCE challenge, so a program that opened the link without being WorkSuite Office
 * gets a code it cannot exchange.
 *
 * LOCKED. Nothing is asked over the lock screen: a request that arrives while the app is locked waits, for
 * two minutes, for the person to unlock it.
 */
export class OfficeSignIn {
  private waiting: { request: OfficeSignInRequest; at: number } | null = null;
  private asking = false;
  private readonly limiter = new WindowLimiter(5, 60_000);

  constructor(private readonly deps: OfficeSignInDeps) {}

  async handle(url: string): Promise<void> {
    const parsed = parseOfficeSignIn(url);
    if (!parsed.ok) {
      this.deps.log.warn('office sign-in link rejected', { reason: parsed.reason });
      this.deps.showMain();
      this.deps.toast('error', 'That WorkSuite Office sign-in could not be used. Try again from WorkSuite Office.');
      return;
    }
    // A program opening the link over and over must not stack dialogs.
    if (!this.limiter.hit(this.now())) {
      this.deps.log.warn('office sign-in links refused: too many');
      return;
    }

    this.deps.showMain();
    if (this.deps.isLocked()) {
      this.waiting = { request: parsed.request, at: this.now() };
      return;
    }
    await this.run(parsed.request);
  }

  /** The person unlocked the app: a request that arrived while it was locked, if it is still fresh. */
  unlocked(): void {
    const waiting = this.waiting;
    this.waiting = null;
    if (waiting && this.now() - waiting.at < WAIT_WHILE_LOCKED_MS) void this.run(waiting.request);
  }

  private async run(request: OfficeSignInRequest): Promise<void> {
    if (this.asking) return;

    const account = this.deps.account();
    if (!account) {
      this.deps.toast('info', 'Sign in to WorkSuite first, then choose Continue in WorkSuite Office again.');
      return;
    }
    if (account.origin !== request.server || account.userId !== request.uid) {
      this.deps.log.warn('office sign-in for another account');
      this.deps.toast('error', 'WorkSuite Office asked for a different WorkSuite account than the one signed in here.');
      return;
    }

    this.asking = true;
    try {
      const where = [account.organization, new URL(account.origin).host].filter(Boolean).join(' · ');
      const yes = await this.deps.confirm({
        message: `Sign in to WorkSuite Office as ${account.name}?`,
        detail:
          `WorkSuite Office on this computer asked to use your WorkSuite sign-in (${where}). It gets a sign-in of ` +
          'its own, which you can end from your sessions in WorkSuite.\n\n' +
          `Only continue if you just chose “Continue as ${account.name}” in WorkSuite Office.`,
      });
      if (!yes) {
        this.deps.log.info('office sign-in declined');
        return;
      }

      // The account may have changed while the question was open.
      const still = this.deps.account();
      if (!still || still.origin !== account.origin || still.userId !== account.userId) {
        this.deps.toast('error', 'Your account changed. Try again from WorkSuite Office.');
        return;
      }

      let code = '';
      try {
        const data = (await this.deps.handoff(request.challenge)) as { code?: unknown } | null;
        code = data && typeof data.code === 'string' ? data.code : '';
      } catch (e) {
        this.deps.log.warn('office sign-in hand-off failed', { notFound: this.deps.isNotFound(e) });
        this.deps.toast('error', this.deps.isNotFound(e)
          ? 'This WorkSuite server cannot sign in WorkSuite Office yet.'
          : 'WorkSuite Office could not be signed in. Try again.');
        return;
      }
      if (!/^[A-Za-z0-9_-]{43}$/.test(code)) {
        this.deps.log.warn('office sign-in: the server sent no code');
        this.deps.toast('error', 'WorkSuite Office could not be signed in. Try again.');
        return;
      }

      await this.deps.open(officeCallback(code, request.state));
      this.deps.log.info('office sign-in handed to WorkSuite Office');
    } finally {
      this.asking = false;
    }
  }

  private now(): number {
    return this.deps.now ? this.deps.now() : Date.now();
  }
}
