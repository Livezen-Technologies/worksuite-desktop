import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

/**
 * The operating system's own Focus / Do not disturb, as far as this app can read it (RING-47, RING-UI-08 "During Focus /
 * Do not disturb"): a website chat ringing during it follows the person's choice — the window without the tone (the
 * default), the tone only at risk, or as usual — just as it does during WorkSuite's own Do not disturb.
 *
 * - macOS 12 and later: a Focus turned on by hand leaves an assertion in ~/Library/DoNotDisturb/DB/Assertions.json.
 *   Where the system will not let the app read it, or a Focus runs on a schedule only, it is not known.
 * - Linux (GNOME and others that keep the setting): `show-banners` false is Do not disturb.
 * - Windows: Focus Assist cannot be read by an app, so it is never known there.
 *
 * Not known counts as off: the ring is never kept quiet on a guess.
 */

/** Whether a Focus is on, from macOS's Assertions.json; null when it cannot be read. */
export function focusFromAssertions(json: string): boolean | null {
  try {
    const d = JSON.parse(json) as { data?: Array<{ storeAssertionRecords?: unknown[] }> };
    if (!Array.isArray(d?.data)) return null;
    return d.data.some((x) => Array.isArray(x?.storeAssertionRecords) && x.storeAssertionRecords.length > 0);
  } catch {
    return null;
  }
}

/** Whether Do not disturb is on, from `gsettings get org.gnome.desktop.notifications show-banners`; null when unknown. */
export function focusFromGsettings(out: string): boolean | null {
  const v = out.trim();
  if (v === 'false') return true;
  if (v === 'true') return false;
  return null;
}

export interface SystemFocusDeps {
  platform?: NodeJS.Platform;
  readFile?: (path: string) => Promise<string>;
  run?: (cmd: string, args: string[]) => Promise<string>;
  /** Said when it turns on or off. */
  onChange?: (on: boolean) => void;
}

const run = (cmd: string, args: string[]): Promise<string> =>
  new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout: 3_000, windowsHide: true }, (e, out) => (e ? reject(e) : resolve(String(out))));
  });

export class SystemFocus {
  private on = false;
  private timer: NodeJS.Timeout | null = null;

  constructor(private readonly deps: SystemFocusDeps = {}) {}

  /** Whether the system's Focus / Do not disturb is on, as last read. */
  active(): boolean {
    return this.on;
  }

  /** Reads it now; whatever cannot be read is off. */
  async check(): Promise<boolean> {
    const platform = this.deps.platform ?? process.platform;
    let now: boolean | null = null;
    try {
      if (platform === 'darwin') {
        now = focusFromAssertions(await (this.deps.readFile ?? ((p: string) => readFile(p, 'utf8')))(join(homedir(), 'Library', 'DoNotDisturb', 'DB', 'Assertions.json')));
      } else if (platform === 'linux') {
        now = focusFromGsettings(await (this.deps.run ?? run)('gsettings', ['get', 'org.gnome.desktop.notifications', 'show-banners']));
      }
    } catch {
      now = null;
    }
    const on = now === true;
    if (on !== this.on) {
      this.on = on;
      this.deps.onChange?.(on);
    }
    return on;
  }

  /** Every 20 s while the app runs: Focus changes with the clock and by hand, and says nothing when it does. */
  start(every = 20_000): void {
    if (this.timer) return;
    if ((this.deps.platform ?? process.platform) === 'win32') return;
    void this.check();
    this.timer = setInterval(() => void this.check(), every);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}
