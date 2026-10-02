import { execFile } from 'node:child_process';

/** Shared by the probe and the real input process; never requests permission or posts an event. */
export const MAC_PERMISSION_SCRIPT = String.raw`
ObjC.import('ApplicationServices'); ObjC.import('CoreGraphics');
function inputTrusted() {
  if (typeof $.CGPreflightPostEventAccess === 'function') return !!$.CGPreflightPostEventAccess();
  return !!$.AXIsProcessTrusted();
}
`;

export interface HelperPermission {
  trusted: boolean | null;
  accessibility: boolean | null;
  error: string | null;
}

export interface AccessibilityDeps {
  platform: string;
  appTrusted: () => boolean;
  helperTrusted: () => Promise<boolean | null | HelperPermission>;
  now: () => number;
}
export interface AccessibilityState {
  status: 'granted' | 'denied' | 'checking' | 'unknown' | 'not_required';
  hint: 'restart' | null;
  appTrusted?: boolean | null;
  helperTrusted?: boolean | null;
  checkedAt?: number;
  helperAccessibility?: boolean | null;
  problem?: string | null;
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
    if (!this.result) return this.refresh();
    return this.result;
  }

  /** Returning from Settings is handled by a fresh check, never blanket reset advice. */
  openedSettings(): void { this.generation++; this.result = null; this.asking = null; }

  private ask(): Promise<void> {
    const generation = ++this.generation;
    let app: boolean | null = null;
    try { app = this.deps.appTrusted(); } catch { /* Preserve unknown. */ }
    const run = Promise.resolve().then(() => this.deps.helperTrusted()).catch(() => null).then((trusted) => {
      if (generation !== this.generation) return;
      const helper = typeof trusted === 'object' && trusted !== null ? trusted : { trusted, accessibility: null, error: null };
      const disagreement = helper.accessibility === true && helper.trusted === false;
      this.result = {
        status: helper.trusted === null || disagreement ? 'unknown' : helper.trusted ? 'granted' : 'denied',
        hint: app === true && helper.trusted === false ? 'restart' : null,
        appTrusted: app, helperTrusted: helper.trusted, helperAccessibility: helper.accessibility, checkedAt: this.deps.now(),
        problem: disagreement ? 'The helper reports Accessibility enabled, but macOS event-posting preflight disagrees. Reopen the running copy of WorkSuite and check again.' : helper.error,
      };
    }).finally(() => { if (this.asking === run) this.asking = null; });
    this.asking = run;
    return run;
  }
}

export function askHelper(timeoutMs = 4_000): Promise<HelperPermission> {
  return new Promise((resolve) => {
    // Same binary, native APIs and launch context as the real injector; never posts input or prompts for consent.
    const script = `${MAC_PERMISSION_SCRIPT}\nJSON.stringify({ trusted: inputTrusted(), accessibility: !!$.AXIsProcessTrusted() })`;
    execFile('/usr/bin/osascript', ['-l', 'JavaScript', '-e', script],
      { timeout: timeoutMs, env: { ...process.env, WS_OWNER_PID: String(process.pid) } }, (err, stdout) => {
        if (err) return resolve({ trusted: null, accessibility: null, error: err.killed ? 'The input-helper permission check timed out.' : 'The input-helper permission check could not run.' });
        try {
          const value = JSON.parse(String(stdout).trim()) as HelperPermission;
          if (typeof value.trusted === 'boolean' && typeof value.accessibility === 'boolean') return resolve({ trusted: value.trusted, accessibility: value.accessibility, error: null });
        } catch { /* Malformed output is unknown, never denial. */ }
        resolve({ trusted: null, accessibility: null, error: 'The input-helper permission check returned an invalid response.' });
      });
  });
}
