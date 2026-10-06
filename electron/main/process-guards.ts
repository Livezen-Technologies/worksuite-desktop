import { setUnsafeHeaderReporter } from '@shared/http-headers';
import { logger } from './log';

const log = logger('process');

/**
 * The main process's last line (worksuite-desktop#238). One bad request — a header holding U+202F from a macOS
 * time, say — must not end in Electron's raw "A JavaScript error occurred in the main process" dialog and a dead
 * app. Anything nothing else caught is:
 *  · written to the diagnostics log (main.log and the ring Diagnostics shows), redacted like every log line;
 *  · handed to crash reporting, when the app has one, so it travels with the next crash report;
 *  · told to the person once, in the app, in plain words — and the app keeps running.
 * A promise nobody waited on is logged only: it is a failure of something in the background, and the screen that
 * asked for it already shows its own error with Retry.
 */
export const FRIENDLY_ERROR = 'Something went wrong, but WorkSuite kept running. If an action did not finish, try it again.';

export interface ProcessGuardDeps {
  /** A short message in the app's windows (a toast). */
  notify?: (text: string) => void;
  /** Crash reporting, when there is any: the error's summary, kept with the next report. */
  report?: (summary: string) => void;
  /** At most one message per this many milliseconds. */
  quietMs?: number;
  now?: () => number;
  /** For tests: the process to watch. */
  target?: Pick<NodeJS.Process, 'on' | 'off'>;
}

export function describeError(e: unknown): { name: string; message: string; stack?: string } {
  if (e instanceof Error) return { name: e.name, message: e.message.slice(0, 500), stack: e.stack?.split('\n').slice(0, 12).join('\n') };
  return { name: typeof e, message: String(e).slice(0, 500) };
}

let installed: (() => void) | null = null;

/** Installs the handlers (once; a second call replaces the first). Returns a function that removes them. */
export function installProcessGuards(deps: ProcessGuardDeps = {}): () => void {
  installed?.();
  const target = deps.target ?? process;
  const now = deps.now ?? Date.now;
  const quiet = deps.quietMs ?? 30_000;
  let lastNotice = -Infinity;
  let inside = false;

  const handle = (kind: 'uncaughtException' | 'unhandledRejection', e: unknown): void => {
    if (inside) return; // An error while handling one: never loop.
    inside = true;
    try {
      const d = describeError(e);
      log.error(kind === 'uncaughtException' ? 'uncaught exception' : 'unhandled promise rejection', d);
      try {
        deps.report?.(`${kind}: ${d.name}: ${d.message}`.slice(0, 400));
      } catch {
        /* crash reporting is best effort */
      }
      if (kind === 'uncaughtException' && deps.notify && now() - lastNotice >= quiet) {
        lastNotice = now();
        try {
          deps.notify(FRIENDLY_ERROR);
        } catch {
          /* no window yet */
        }
      }
    } catch {
      /* the guard itself must never throw */
    } finally {
      inside = false;
    }
  };

  const onException = (e: unknown): void => handle('uncaughtException', e);
  const onRejection = (e: unknown): void => handle('unhandledRejection', e);
  target.on('uncaughtException', onException);
  target.on('unhandledRejection', onRejection);
  // A header that had to be cleaned is a bug to fix: its NAME goes to the diagnostics log, never its value.
  setUnsafeHeaderReporter((header, reason) => log.warn('unsafe request header cleaned', { header, reason }));

  installed = () => {
    target.off('uncaughtException', onException);
    target.off('unhandledRejection', onRejection);
    installed = null;
  };
  return installed;
}
