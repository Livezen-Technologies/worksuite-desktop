/**
 * WorkSuite OS mode (docs/WORKSUITE_OS.md).
 *
 * On WorkSuite OS the operating system owns the things a standalone desktop client does for itself: who is signed in
 * (the credentials broker), which device this is (the device agent), updates (the OS package manager) and the lock
 * (the OS screen lock). The app turns into OS mode when `/etc/worksuite/os-release` exists, or when started with
 * `--worksuite-os` or `WORKSUITE_OS=1` (development and tests). Everything else runs as it always has.
 *
 * Pure, so it can be used in both processes and unit tested.
 */

/** Written by the WorkSuite OS image. Its presence is what says "this is WorkSuite OS". */
export const OS_RELEASE_PATH = '/etc/worksuite/os-release';
export const OS_MODE_SWITCH = '--worksuite-os';

export function isOsMode(argv: readonly string[], env: Record<string, string | undefined>, exists: (path: string) => boolean): boolean {
  if (argv.includes(OS_MODE_SWITCH)) return true;
  if (env.WORKSUITE_OS === '1') return true;
  // WORKSUITE_OS=0 turns it off on a WorkSuite OS machine (support: run the standalone flow there).
  if (env.WORKSUITE_OS === '0') return false;
  try {
    return exists(OS_RELEASE_PATH);
  } catch {
    return false;
  }
}

/** The modules the OS start menu (and anyone else) may open with `--module=<id>`. */
export const LAUNCH_MODULES = ['home', 'mail', 'chat', 'calendar', 'tasks', 'files', 'crm', 'hr'] as const;
export type LaunchModule = (typeof LAUNCH_MODULES)[number];

export function isLaunchModule(v: unknown): v is LaunchModule {
  return typeof v === 'string' && (LAUNCH_MODULES as readonly string[]).includes(v);
}

/**
 * `--module=<id>` or `--module <id>`, or null. An unknown module is ignored (the app opens as usual), so a start
 * menu entry for a module this version lacks cannot do anything but open the app.
 */
export function moduleInArgv(argv: readonly string[]): LaunchModule | null {
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    let v: string | undefined;
    if (a.startsWith('--module=')) v = a.slice('--module='.length);
    else if (a === '--module') v = argv[i + 1];
    if (v === undefined) continue;
    const m = v.trim().toLowerCase();
    return isLaunchModule(m) ? m : null;
  }
  return null;
}

/** The worksuite:// link a module opens through, so it takes the deep-link path (grammar, permissions, single instance). */
export function moduleLink(m: LaunchModule): string {
  return `worksuite://${m}`;
}

/** `--module=<id>` as a worksuite:// link, or null. */
export function moduleLinkInArgv(argv: readonly string[]): string | null {
  const m = moduleInArgv(argv);
  return m ? moduleLink(m) : null;
}
