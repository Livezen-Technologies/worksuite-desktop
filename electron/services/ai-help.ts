/**
 * What Help & Guide's Contact Support may attach (WS-SUPPORT-SRS-001 D-11, FR-DSK-09, FR-SEC-05): the app's recent log
 * and a picture of the window the person is in. Both are only ever shown to the person first — the dialog lists them
 * with their size, and its "View exact payload" shows the words — and go only if they leave them ticked.
 *
 * The log is the in-memory ring of recent lines (`recentLog`), which is redacted as it is written (tokens, passwords,
 * email addresses and message bodies never reach it), narrowed to the last day and to the newest lines that fit, so a
 * request stays a request and not an archive. The picture is the window's own pixels (`capturePage`), as a PNG.
 */

/** At most this much of the log goes with a request: the newest lines that fit. */
export const HELP_LOG_MAX_BYTES = 8 * 1024;
/** And only lines from the last day. */
export const HELP_LOG_WINDOW_MS = 24 * 60 * 60_000;

/**
 * The newest log lines of the last day that fit in `maxBytes`, oldest first. A line that is not the log's JSON (an
 * older format) is kept without its time being checked.
 */
export function helpLogText(lines: readonly string[], now: number, maxBytes = HELP_LOG_MAX_BYTES): { text: string; lines: number; bytes: number } {
  const since = now - HELP_LOG_WINDOW_MS;
  const kept: string[] = [];
  let bytes = 0;
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i]!;
    let at: number | null = null;
    try {
      const t = (JSON.parse(line) as { t?: unknown }).t;
      at = typeof t === 'string' ? Date.parse(t) : null;
    } catch {
      at = null;
    }
    if (at !== null && Number.isFinite(at) && at < since) break;
    const size = Buffer.byteLength(line, 'utf8') + 1;
    if (bytes + size > maxBytes) break;
    kept.push(line);
    bytes += size;
  }
  kept.reverse();
  return { text: kept.join('\n'), lines: kept.length, bytes };
}

/** "window-capture-2026-10-06-0947.png": what the picture is called in the request. */
export function captureName(at: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `window-capture-${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}-${pad(at.getHours())}${pad(at.getMinutes())}.png`;
}
