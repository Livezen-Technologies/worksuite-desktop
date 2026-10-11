import { ApiError } from '../../../core/api';

/**
 * Linking a WhatsApp Web number, as one screen reads it (worksuite-desktop#323): starting, a QR code (or a pairing
 * code) to use, scanned, linked — or one error, with its cause and the next step. Pure, so the rules are tested
 * without a server: what the server says about the attempt wins; an older server's bare states are read the same
 * way; and nothing reads "starting" for more than a minute, whichever side noticed first.
 */

export type LinkAction = 'scan_again' | 'retry' | 'new_code' | 'open_existing' | 'none';

export interface LinkError {
  code: string;
  title: string;
  message: string;
  action: LinkAction;
  /** The bridge's own words, for an admin ("Details for admin"). */
  detail: string | null;
}

export interface LinkAttemptView {
  id: number | null;
  state: 'starting' | 'waiting' | 'scanned' | 'connected' | 'failed' | 'cancelled';
  method: 'qr' | 'pairing';
  error: LinkError | null;
  started_at: string | null;
  timeout_at: string | null;
  elapsed_seconds: number;
  phone?: string | null;
}

/** What GET /accounts/{id}/qr answers, as far as the flow reads it. */
export interface LinkAnswer {
  qr: string | null;
  state: string | null;
  linked: boolean;
  pairing_code?: string | null;
  link_error?: LinkError | null;
  attempt?: LinkAttemptView | null;
  progress?: { loading: { percent: number; message: string } | null } | null;
}

export type LinkView =
  | { at: 'starting' }
  | { at: 'qr'; qr: string }
  | { at: 'pairing'; code: string }
  | { at: 'scanned' }
  | { at: 'linked' }
  | { at: 'error'; error: LinkError };

/** No code within this long of starting: the link has failed, and says so with Retry. */
export const START_TIMEOUT_MS = 60_000;

/** WhatsApp replaces the QR code about this often. */
export const QR_ROTATE_SECONDS = 20;

/** The same words the server uses, for a server too old to send them and for the screen's own timeout. */
const CATALOGUE: Record<string, Omit<LinkError, 'code' | 'detail'>> = {
  unlinked: { title: 'Phone unlinked this device', message: 'WhatsApp rejected the saved login, so it has been cleared. Scan again to link the phone.', action: 'scan_again' },
  browser_failed: { title: 'Couldn’t start the WhatsApp connection on the server (browser failed)', message: 'The browser the connection runs in did not start. Retry; if it keeps failing, an admin should check the WhatsApp service on the server (Diagnostics has the details).', action: 'retry' },
  qr_expired: { title: 'QR code expired', message: 'The code was not scanned in time. Ask for a new code and scan it within a minute.', action: 'new_code' },
  pairing_expired: { title: 'Pairing code expired', message: 'The code was not entered in time. Ask for a new code.', action: 'new_code' },
  timeout: { title: 'Linking timed out', message: 'Nothing came back from WhatsApp within 60 seconds. Retry to start again with a fresh session.', action: 'retry' },
  bridge_unreachable: { title: 'The WhatsApp service on the server isn’t answering', message: 'Retry; if it keeps failing, an admin should check that it is running.', action: 'retry' },
  invalid_phone: { title: 'That is not a full phone number', message: 'Give the number with its country code, for example +94 76 913 6424.', action: 'none' },
  unknown: { title: 'Linking did not finish', message: 'Retry to start again with a fresh session.', action: 'retry' },
};

export function linkError(code: string, detail: string | null = null): LinkError {
  const known = CATALOGUE[code];
  return { code: known ? code : 'unknown', ...(known ?? CATALOGUE.unknown!), detail };
}

function isLinkError(v: unknown): v is LinkError {
  return !!v && typeof v === 'object' && typeof (v as LinkError).code === 'string' && typeof (v as LinkError).title === 'string';
}

/** The error a failed request carries: the server's `link_error` when it sent one, otherwise its message. */
export function linkErrorOf(e: unknown, fallback = 'unknown'): LinkError {
  if (e instanceof ApiError) {
    const data = e.data as { link_error?: unknown } | null;
    if (isLinkError(data?.link_error)) return data.link_error;
    return linkError(e.status === 0 ? 'bridge_unreachable' : fallback, e.message || null);
  }
  return linkError(fallback, e instanceof Error ? e.message : null);
}

/**
 * Where the link stands. `startError` is a failed start (or pairing request); `startedAt`/`now` run the screen's own
 * clock, so a server that never says anything still ends in "timed out" rather than a spinner.
 */
export function linkView({ startError, answer, started, startedAt, now }: {
  startError?: LinkError | null;
  answer?: LinkAnswer | null;
  started: boolean;
  startedAt: number;
  now: number;
}): LinkView {
  if (startError) return { at: 'error', error: startError };
  if (answer?.linked) return { at: 'linked' };
  const reported = answer?.link_error ?? answer?.attempt?.error ?? null;
  if (reported) return { at: 'error', error: reported };
  const state = answer?.state ?? null;
  // An older server: a refused login comes back as the bare state.
  if (state === 'auth_failure') return { at: 'error', error: linkError('unlinked') };
  if (state === 'start_failed') return { at: 'error', error: linkError('browser_failed') };
  if (state === 'authenticated' || state === 'authenticating' || answer?.progress?.loading) return { at: 'scanned' };
  if (answer?.pairing_code) return { at: 'pairing', code: answer.pairing_code };
  if (answer?.qr) return { at: 'qr', qr: answer.qr };
  if (started && now - startedAt >= START_TIMEOUT_MS) return { at: 'error', error: linkError('timeout', 'No QR code within 60 seconds of starting.') };
  return { at: 'starting' };
}

/** Seconds until WhatsApp replaces the code on screen, counted from when this code was first seen. */
export function qrCountdown(seenAt: number, now: number, period = QR_ROTATE_SECONDS): number {
  return Math.max(0, period - Math.floor((now - seenAt) / 1000));
}

/** The button an error offers, or null when there is nothing the screen itself can do. */
export function actionLabel(action: LinkAction): string | null {
  switch (action) {
    case 'scan_again': return 'Scan again';
    case 'retry': return 'Retry';
    case 'new_code': return 'New code';
    default: return null;
  }
}

/** Is this worth sending as a number to pair with? The server reads it (a national number in the home region too). */
export function pairingPhoneOk(raw: string): boolean {
  const digits = raw.replace(/\D+/g, '').replace(/^00/, '');
  return digits.length >= 8 && digits.length <= 15;
}
