import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';

/**
 * Decisions that must be made before `app.ready` (FR-DIAG-03/04/05, WF-27):
 *
 *  - Was the last run an unexpected exit? A marker file is written at start
 *    and removed on a clean quit; finding it means the app crashed or was
 *    killed, and the user is offered their session back.
 *  - Three unexpected exits within ten minutes start the app in Safe Mode:
 *    no hardware acceleration, no tab restore, no background previews. The
 *    user can restart normally from the banner or Diagnostics.
 *  - Hardware acceleration (on by default) can only be switched before ready,
 *    so its preference is mirrored into a small file read here.
 */
export interface BootState {
  safeMode: boolean;
  safeModeReason: 'crashes' | 'requested' | null;
  uncleanExit: boolean;
  recentCrashes: string[];
  hardwareAcceleration: boolean;
}

interface CrashFile {
  crashes: string[];
}

interface BootConfig {
  hardwareAcceleration?: boolean;
}

function readJson<T>(path: string, fallback: T): T {
  try {
    return existsSync(path) ? (JSON.parse(readFileSync(path, 'utf8')) as T) : fallback;
  } catch {
    return fallback;
  }
}

export function evaluateBoot(p: { crashState: string; runningMarker: string; bootConfig: string }, argv: string[], now = Date.now()): BootState {
  const uncleanExit = existsSync(p.runningMarker);
  const file = readJson<CrashFile>(p.crashState, { crashes: [] });
  let crashes = (file.crashes ?? []).filter((t) => now - new Date(t).getTime() < 24 * 3600_000);
  if (uncleanExit) crashes.push(new Date(now).toISOString());
  crashes = crashes.slice(-20);
  try {
    writeFileSync(p.crashState, JSON.stringify({ crashes }), { mode: 0o600 });
  } catch {
    /* read-only profile: carry on */
  }
  const recent = crashes.filter((t) => now - new Date(t).getTime() < 10 * 60_000);
  const requested = argv.includes('--safe-mode');
  const safeMode = requested || recent.length >= 3;
  const cfg = readJson<BootConfig>(p.bootConfig, {});
  return {
    safeMode,
    safeModeReason: requested ? 'requested' : safeMode ? 'crashes' : null,
    uncleanExit,
    recentCrashes: recent,
    hardwareAcceleration: safeMode ? false : cfg.hardwareAcceleration !== false,
  };
}

export function markRunning(path: string): void {
  try {
    writeFileSync(path, String(process.pid), { mode: 0o600 });
  } catch {
    /* ignore */
  }
}

export function markCleanExit(path: string): void {
  try {
    if (existsSync(path)) unlinkSync(path);
  } catch {
    /* ignore */
  }
}

export function writeBootConfig(path: string, cfg: BootConfig): void {
  try {
    writeFileSync(path, JSON.stringify(cfg), { mode: 0o600 });
  } catch {
    /* ignore */
  }
}

export function clearCrashes(path: string): void {
  try {
    writeFileSync(path, JSON.stringify({ crashes: [] }), { mode: 0o600 });
  } catch {
    /* ignore */
  }
}
