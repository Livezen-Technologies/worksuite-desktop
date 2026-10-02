import { execFile } from 'node:child_process';

/** Shared by the probe and the real input process; never requests permission or posts an event. */
export const MAC_PERMISSION_SCRIPT = String.raw`
ObjC.import('ApplicationServices'); ObjC.import('CoreGraphics');
function inputTrusted() {
  if (typeof $.CGPreflightPostEventAccess === 'function') return !!$.CGPreflightPostEventAccess();
  return !!$.AXIsProcessTrusted();
}
`;

export interface AccessibilityDeps {
  platform: string;
  appTrusted: () => boolean;
  helperTrusted: () => Promise<boolean | null>;
  now: () => number;
}
export interface AccessibilityState {
  status: 'granted' | 'denied' | 'checking' | 'unknown' | 'not_required';
  hint: 'restart' | null;
  appTrusted?: boolean | null;
  helperTrusted?: boolean | null;
  checkedAt?: number;
}

/** The event-posting helper is authoritative. Failed checks never become permission denials. */
export class AccessibilityCheck {
  private result: AccessibilityState | null = null;
  private asking: Promise<void> | null = null;
  private generation = 0;
  constructor(private readonly deps: AccessibilityDeps) {}

  state(): AccessibilityState {
    if (this.deps.platform !== 'darwin') return { status: 'not_required', hint: null };
    let app: boolean | null = null;
    try { app = this.deps.appTrusted(); } catch { /* Unavailable native check. */ }
    if (!this.asking && (!this.result || this.deps.now() - this.result.checkedAt! > 10_000 || app !== this.result.appTrusted)) void this.ask();
    return this.asking ? { status: 'checking', hint: null } : this.result!;
  }

  async refresh(): Promise<AccessibilityState> {
    if (this.deps.platform !== 'darwin') return this.state();
    await this.ask();
    // Another refresh may have superseded ours. Wait for its result too.
    while (this.asking) await this.asking;
    return this.result!;
  }

  /** Returning from Settings is handled by a fresh check, never blanket reset advice. */
  openedSettings(): void { this.result = null; }

  private ask(): Promise<void> {
    const generation = ++this.generation;
    let app: boolean | null = null;
    try { app = this.deps.appTrusted(); } catch { /* Preserve unknown. */ }
    const run = Promise.resolve().then(() => this.deps.helperTrusted()).catch(() => null).then((trusted) => {
      if (generation !== this.generation) return;
      this.result = {
        status: trusted === null ? 'unknown' : trusted ? 'granted' : 'denied',
        hint: app === true && trusted === false ? 'restart' : null,
        appTrusted: app, helperTrusted: trusted, checkedAt: this.deps.now(),
      };
    }).finally(() => { if (this.asking === run) this.asking = null; });
    this.asking = run;
    return run;
  }
}

export function askHelper(timeoutMs = 4_000): Promise<boolean | null> {
  return new Promise((resolve) => {
    execFile('/usr/bin/osascript', ['-l', 'JavaScript', '-e', `${MAC_PERMISSION_SCRIPT}\ninputTrusted()`],
      { timeout: timeoutMs, env: { ...process.env, WS_OWNER_PID: String(process.pid) } }, (err, stdout) => {
        if (err) return resolve(null);
        const out = String(stdout).trim();
        resolve(out === 'true' ? true : out === 'false' ? false : null);
      });
  });
}
