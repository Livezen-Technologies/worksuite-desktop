import { execFile } from 'node:child_process';

/**
 * Whether macOS lets WorkSuite post mouse and keyboard events (Privacy & Security › Accessibility), asked the way
 * remote control will need it (worksuite-desktop#47).
 *
 * Two answers, either of which is enough:
 * - the app's own (`isTrustedAccessibilityClient(false)` — never shows a prompt), and
 * - the helper's: the `osascript` that injects the input asks `AXIsProcessTrusted()` itself. macOS answers for the
 *   app responsible for it (WorkSuite), and this is the process that has to be allowed, so its answer is the one
 *   that counts when the two disagree.
 *
 * The helper is asked in the background and its answer kept for a few seconds, so the five-second refresh of the
 * Settings screen does not start a process every time; `refresh()` asks now (Check again, coming back from System
 * Settings). Nothing here asks for the permission or starts a session: granting Accessibility lets WorkSuite take
 * input only once the person approves a request, each time.
 */
export interface AccessibilityDeps {
  platform: string;
  /** The app's own answer (systemPreferences.isTrustedAccessibilityClient(false)). */
  appTrusted: () => boolean;
  /** The helper's answer: true, false, or null when it could not be asked. */
  helperTrusted: () => Promise<boolean | null>;
  now: () => number;
}

export interface AccessibilityState {
  status: 'granted' | 'denied' | 'not_required';
  /**
   * After System Settings was opened from WorkSuite and access still reads as off: either the entry there is an
   * earlier version's (remove it and add WorkSuite again), or macOS applies it only once WorkSuite is reopened.
   */
  hint: 'restart' | null;
}

/** How long the helper's answer is kept. */
const KEEP_MS = 10_000;

export class AccessibilityCheck {
  private helper: { trusted: boolean | null; at: number } | null = null;
  private asking: Promise<void> | null = null;
  private openedAt: number | null = null;

  constructor(private readonly deps: AccessibilityDeps) {}

  /** The status now, from what is known; asks the helper again in the background when its answer is old. */
  state(): AccessibilityState {
    if (this.deps.platform !== 'darwin') return { status: 'not_required', hint: null };
    if (this.deps.appTrusted()) return { status: 'granted', hint: null };
    if (!this.helper || this.deps.now() - this.helper.at > KEEP_MS) void this.ask();
    if (this.helper?.trusted) return { status: 'granted', hint: null };
    return { status: 'denied', hint: this.openedAt !== null && this.helper !== null && this.helper.at > this.openedAt ? 'restart' : null };
  }

  /** Asks again now (Check again; the window came back from System Settings). */
  async refresh(): Promise<AccessibilityState> {
    if (this.deps.platform === 'darwin' && !this.deps.appTrusted()) await this.ask(true);
    return this.state();
  }

  /** WorkSuite opened the Accessibility pane: an answer after this that is still "off" earns the restart hint. */
  openedSettings(): void {
    this.openedAt = this.deps.now();
  }

  private ask(force = false): Promise<void> {
    if (this.asking && !force) return this.asking;
    const run = this.deps
      .helperTrusted()
      .catch(() => null)
      .then((trusted) => {
        this.helper = { trusted, at: this.deps.now() };
      })
      .finally(() => {
        if (this.asking === run) this.asking = null;
      });
    this.asking = run;
    return run;
  }
}

/** The helper's own answer: the same osascript remote control injects through, asked for AXIsProcessTrusted(). */
export function askHelper(timeoutMs = 4_000): Promise<boolean | null> {
  return new Promise((resolve) => {
    execFile('/usr/bin/osascript', ['-l', 'JavaScript', '-e', "ObjC.import('ApplicationServices'); $.AXIsProcessTrusted()"], { timeout: timeoutMs }, (err, stdout) => {
      if (err) return resolve(null);
      const out = String(stdout).trim();
      resolve(out === 'true' ? true : out === 'false' ? false : null);
    });
  });
}
