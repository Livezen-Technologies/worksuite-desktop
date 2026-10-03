import { execFile, type ChildProcess } from 'node:child_process';

/** Shared by the probe and the real input process; never requests permission or posts an event. */
export const MAC_PERMISSION_SCRIPT = String.raw`
ObjC.import('ApplicationServices'); ObjC.import('CoreGraphics');
function inputTrusted() {
  if (typeof $.CGPreflightPostEventAccess === 'function') return !!$.CGPreflightPostEventAccess();
  return !!$.AXIsProcessTrusted();
}
function permissionReport() {
  return JSON.stringify({ trusted: inputTrusted(), accessibility: !!$.AXIsProcessTrusted() });
}
`;

/** The input helper: Apple's own osascript, started by WorkSuite so macOS counts WorkSuite as responsible for it. */
export const MAC_HELPER = '/usr/bin/osascript';

export interface HelperPermission {
  trusted: boolean | null;
  accessibility: boolean | null;
  error: string | null;
  /** Which helper answered: the running injector over its pipe, or a new helper process started for this check. */
  source?: 'injector' | 'probe';
}

export interface AccessibilityDeps {
  platform: string;
  appTrusted: () => boolean;
  helperTrusted: () => Promise<boolean | null | HelperPermission>;
  now: () => number;
  /** WorkSuite was just relaunched from Restart WorkSuite (macOS sometimes only applies a grant to a new process). */
  relaunched?: () => boolean;
}

/**
 * - restart: access is granted to WorkSuite, but the helper's event-posting check only changes for a new process.
 * - helper: WorkSuite has access, its helper does not, and restarting already did not help — the helper is not
 *   being counted as WorkSuite's (started from Terminal, another copy, a stale entry).
 */
export type AccessibilityHint = 'restart' | 'helper' | null;

export interface AccessibilityState {
  status: 'granted' | 'denied' | 'checking' | 'unknown' | 'not_required';
  hint: AccessibilityHint;
  appTrusted?: boolean | null;
  helperTrusted?: boolean | null;
  checkedAt?: number;
  helperAccessibility?: boolean | null;
  helperSource?: 'injector' | 'probe' | null;
  problem?: string | null;
}

/**
 * The event-posting helper is authoritative. Failed checks never become permission denials.
 * Nothing is cached across a refresh: each one asks the app (AXIsProcessTrusted) and the helper again.
 */
export class AccessibilityCheck {
  private result: AccessibilityState | null = null;
  private asking: Promise<void> | null = null;
  private generation = 0;
  /** This process has seen its own Accessibility check say no, so a later yes was granted while it ran. */
  private sawAppDenied = false;
  constructor(private readonly deps: AccessibilityDeps) {}

  state(): AccessibilityState {
    if (this.deps.platform !== 'darwin') return { status: 'not_required', hint: null };
    let app: boolean | null = null;
    try { app = this.deps.appTrusted(); } catch { /* Unavailable native check. */ }
    const changed = !!this.result && app !== this.result.appTrusted;
    if (!this.asking && (!this.result || this.deps.now() - this.result.checkedAt! > 10_000 || changed)) void this.ask();
    // While a background re-check runs, the last answer stands — unless the app's own answer has since changed.
    if (this.result && !changed) return this.result;
    return this.asking ? { status: 'checking', hint: null } : this.result!;
  }

  /** Check again: always a new question to the app and to the helper; never an earlier answer. */
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
    if (app === false) this.sawAppDenied = true;
    const run = Promise.resolve().then(() => this.deps.helperTrusted()).catch(() => null).then((trusted) => {
      if (generation !== this.generation) return;
      const helper: HelperPermission = typeof trusted === 'object' && trusted !== null ? trusted : { trusted, accessibility: null, error: null };
      // The helper says it has Accessibility but not event posting while the app itself does not: nothing to act on.
      const disagreement = app !== true && helper.accessibility === true && helper.trusted === false;
      // Granted to WorkSuite, not (yet) to its helper's event posting: macOS often applies that only to a new process.
      const pending = app === true && helper.trusted === false;
      const hint: AccessibilityHint = !pending ? null : this.deps.relaunched?.() && !this.sawAppDenied ? 'helper' : 'restart';
      this.result = {
        status: helper.trusted === null || disagreement ? 'unknown' : helper.trusted ? 'granted' : 'denied',
        hint,
        appTrusted: app, helperTrusted: helper.trusted, helperAccessibility: helper.accessibility, helperSource: helper.source ?? null, checkedAt: this.deps.now(),
        problem: disagreement ? 'The helper reports Accessibility enabled, but macOS event-posting preflight disagrees. Reopen the running copy of WorkSuite and check again.' : helper.error,
      };
    }).finally(() => { if (this.asking === run) this.asking = null; });
    this.asking = run;
    return run;
  }
}

/** Helper processes started only to answer a check; Restart WorkSuite ends them with the app. */
const probes = new Set<ChildProcess>();

export function stopProbes(): void {
  for (const p of probes) {
    try { p.kill(); } catch { /* already gone */ }
  }
  probes.clear();
}

/**
 * Asks a new helper process — the same binary, script and launch as the injector: a direct child, never through
 * `open`, launchd or a shell, so macOS attributes it to WorkSuite. A new process has no earlier answer cached.
 */
export function askHelper(timeoutMs = 4_000): Promise<HelperPermission> {
  return new Promise((resolve) => {
    // Never posts input or prompts for consent.
    const script = `${MAC_PERMISSION_SCRIPT}\npermissionReport()`;
    // The callback can run before execFile returns (an immediate failure), so the process is looked up through a holder.
    const started: { child?: ChildProcess; done?: boolean } = {};
    const done = (err: (Error & { killed?: boolean }) | null, stdout: string | Buffer) => {
      started.done = true;
      if (started.child) probes.delete(started.child);
      if (err) return resolve({ trusted: null, accessibility: null, source: 'probe', error: err.killed ? 'The input-helper permission check timed out.' : 'The input-helper permission check could not run.' });
      resolve(parsePermission(String(stdout), 'probe'));
    };
    started.child = execFile(MAC_HELPER, ['-l', 'JavaScript', '-e', script], { timeout: timeoutMs, shell: false, env: { ...process.env, WS_OWNER_PID: String(process.pid) } }, done) as ChildProcess | undefined;
    if (started.child && !started.done) probes.add(started.child);
  });
}

/** The helper's answer, `{"trusted":…,"accessibility":…}`; anything else is unknown, never a denial. */
export function parsePermission(text: string, source: 'injector' | 'probe'): HelperPermission {
  try {
    const value = JSON.parse(text.trim()) as HelperPermission;
    if (typeof value.trusted === 'boolean' && typeof value.accessibility === 'boolean') return { trusted: value.trusted, accessibility: value.accessibility, error: null, source };
  } catch { /* Malformed output is unknown, never denial. */ }
  return { trusted: null, accessibility: null, source, error: 'The input-helper permission check returned an invalid response.' };
}

export interface RunningHelper {
  /** Asks the running helper, over its pipe, to check its own Accessibility and event posting now. */
  permission(): Promise<HelperPermission | null>;
}

/** The running input helper when there is one, asked over its own pipe; otherwise a new helper process. */
export async function askRunningHelper(running: () => RunningHelper | null, probe: () => Promise<HelperPermission> = askHelper): Promise<HelperPermission> {
  const live = running();
  if (live) {
    const answer = await live.permission().catch(() => null);
    if (answer) return answer;
  }
  return probe();
}
