/**
 * Signing a mailbox in with Microsoft or Google from the desktop app (worksuite-desktop#324).
 *
 * THE FLOW. The server is the OAuth client, with PKCE: POST /api/mail/oauth/{provider}/start with
 * `client: 'desktop'` returns the provider's sign-in URL and an attempt id. The app opens the URL in the system
 * browser; the provider sends the browser back to the server's one registered redirect URI, which finishes the
 * exchange, tests reading (IMAP) and sending (SMTP), saves the mailbox and shows a page with "Return to WorkSuite"
 * (worksuite://mail). Meanwhile the app polls GET /api/mail/oauth/attempts/{id} and shows each step — and, when it
 * fails, what went wrong in plain words, Microsoft's error code and "Copy details". The app never holds the PKCE
 * verifier, the code or a token, so no loopback listener or desktop redirect URI is needed.
 *
 * An older server answers start with only `url`: the app then falls back to "finish in your browser".
 *
 * Before the browser opens, the URL is checked (shared/mail-oauth.ts: the provider's page, PKCE S256, a state, no
 * secret). A failure says what went wrong and what to do, with the server's one action (copy the admin consent link or
 * the redirect URI, or a how-to); Microsoft's code and the reference ID are under Details, and nothing ever says
 * "check the server log" (worksuite#154).
 */
import { explainProviderError, mentionsServerLog } from '@shared/mail-oauth';

export type StepStatus = 'pending' | 'pass' | 'warn' | 'fail' | 'skipped';

export interface OAuthStep {
  id: 'signin' | 'token' | 'imap' | 'smtp';
  label: string;
  status: StepStatus;
  detail: string | null;
}

export interface OAuthErrorDetails {
  provider?: string | null;
  stage?: string | null;
  request_id?: string | null;
  error?: string | null;
  code?: string | null;
  description?: string | null;
  trace_id?: string | null;
  correlation_id?: string | null;
  timestamp?: string | null;
}

/** A failure (or a warning) explained by the server's OAuthErrors. */
export interface OAuthExplained {
  kind: string;
  code: string | null;
  error: string | null;
  title: string;
  message: string;
  next_step: string | null;
  quiet: boolean;
  for_admin?: boolean;
  admin_consent_url: string | null;
  help_url: string | null;
  details: OAuthErrorDetails;
  /** The reference ID every log line about this failure carries (the server's request ID, or the app's own). */
  ref?: string | null;
  /** A stable name for the failure: M365_ADMIN_CONSENT, M365_IMAP_DISABLED… */
  error_code?: string | null;
  /** Microsoft's number alone ('65001'). */
  aadsts?: string | number | null;
  /** The one button that moves things on: copy the admin consent link or redirect URI, or open a how-to. */
  action?: { type: 'copy' | 'link'; label: string; value: string } | null;
}

export interface OAuthAttempt {
  id: string;
  request_id: string;
  provider: string;
  client: 'web' | 'desktop';
  purpose: 'connect' | 'test';
  status: 'pending' | 'connected' | 'failed' | 'cancelled';
  email: string | null;
  connection_id: number | null;
  steps: OAuthStep[];
  error: OAuthExplained | null;
  warnings: OAuthExplained[];
  created_at: string | null;
  finished_at: string | null;
}

export interface OAuthStart {
  url: string;
  attempt?: string;
  request_id?: string;
}

export const STEP_LABELS: Record<OAuthStep['id'], string> = { signin: 'Signed in', token: 'Got access', imap: 'Reading mail', smtp: 'Sending mail' };

/** The steps before anything has happened, for the moment between opening the browser and the first answer. */
export function initialSteps(): OAuthStep[] {
  return (Object.keys(STEP_LABELS) as Array<OAuthStep['id']>).map((id) => ({ id, label: STEP_LABELS[id], status: 'pending', detail: null }));
}

/** The start request's body: this is the desktop app, and the address being added when it is known. */
export function startBody(email?: string | null): { client: 'desktop'; login_hint?: string } {
  const e = (email ?? '').trim();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) ? { client: 'desktop', login_hint: e } : { client: 'desktop' };
}

/** An attempt id as the server mints them (32 hex characters); anything else is not polled. */
export function isAttemptId(id: unknown): id is string {
  return typeof id === 'string' && /^[0-9a-f]{32}$/.test(id);
}

/** A sign-in must finish within the server's 15 minutes; watching stops then. */
export const WATCH_LIMIT_MS = 15 * 60_000;

/** When to ask again, or null to stop: every 2 s for the first two minutes, then every 5 s, up to 15 minutes. */
export function nextPoll(elapsedMs: number): number | null {
  if (elapsedMs >= WATCH_LIMIT_MS) return null;
  return elapsedMs < 2 * 60_000 ? 2000 : 5000;
}

export function isFinished(a: Pick<OAuthAttempt, 'status'>): boolean {
  return a.status !== 'pending';
}

export const STEP_MARK: Record<StepStatus, string> = { pending: '…', pass: '✓', warn: '!', fail: '✗', skipped: '–' };

/** Everything support needs, as text for the clipboard. The server never sends a token, so none can be copied. */
export function detailsText(a: Pick<OAuthAttempt, 'request_id' | 'provider' | 'status' | 'steps' | 'email'> & { error?: OAuthExplained | null; warnings?: OAuthExplained[] }): string {
  const e = a.error ?? null;
  const d = e?.details ?? {};
  const lines = [`WorkSuite mailbox sign-in (${a.provider}, desktop)`, `Result: ${a.status}${e ? ` — ${e.title}` : ''}`];
  if (a.email) lines.push(`Account: ${a.email}`);
  if (e?.code ?? d.code) lines.push(`Error code: ${e?.code ?? d.code}`);
  if (e?.error_code) lines.push(`WorkSuite code: ${e.error_code}`);
  if (d.error) lines.push(`Error: ${d.error}`);
  if (d.description) lines.push(`Description: ${d.description}`);
  if (d.stage) lines.push(`Stage: ${d.stage}`);
  lines.push(`Reference ID: ${e?.ref ?? d.request_id ?? a.request_id}`);
  if (d.trace_id) lines.push(`Trace ID: ${d.trace_id}`);
  if (d.correlation_id) lines.push(`Correlation ID: ${d.correlation_id}`);
  if (d.timestamp) lines.push(`Timestamp: ${d.timestamp}`);
  if (a.steps.length) lines.push(`Steps: ${a.steps.map((s) => `${s.label} ${STEP_MARK[s.status]}`).join(' · ')}`);
  for (const w of a.warnings ?? []) lines.push(`Warning: ${w.title}${w.details?.description ? ` (${w.details.description})` : ''}`);
  return lines.join('\n');
}

/** One line for a toast (the repair flow in Settings, which has no room for the whole card). */
export function summaryLine(a: OAuthAttempt): { kind: 'success' | 'info' | 'error'; text: string } {
  if (a.status === 'connected') return { kind: 'success', text: a.email ? `${a.email} is connected.` : 'Mailbox connected.' };
  if (a.status === 'cancelled' || a.error?.quiet) return { kind: 'info', text: 'Sign-in was cancelled. Try again when you are ready.' };
  const e = explained(a.error);
  if (!e) return { kind: 'error', text: 'The sign-in did not finish. Try again.' };
  const code = e.code ?? e.details?.code;
  return { kind: 'error', text: `${e.message}${e.next_step ? ` ${e.next_step}` : ''}${code ? ` (${code})` : ''}` };
}

/**
 * An explanation fit to show: one that sends the person to the server log (an older server's "OAuth sign-in failed —
 * check the server log"), or names nothing, is replaced by what Microsoft's code means. The codes and IDs are kept.
 */
export function explained(e: OAuthExplained | null): OAuthExplained | null {
  if (!e) return null;
  const d = e.details ?? {};
  const vague = mentionsServerLog(e.title, e.message, e.next_step) || !e.title || !e.message;
  const mapped = explainProviderError({ code: e.code ?? d.code, error: e.error ?? d.error, description: d.description });
  if (!vague && !(e.kind === 'unknown' && mapped.kind !== 'unknown')) return e;
  return {
    ...e,
    kind: mapped.kind,
    code: e.code ?? mapped.code,
    title: mapped.title,
    message: mapped.message,
    next_step: mapped.next_step,
    quiet: mapped.kind === 'cancelled',
  };
}

/** A start that failed before the browser opened, in words — never a log the person can't read. */
export function startFailure(message: string, ref: string): OAuthExplained {
  const vague = mentionsServerLog(message) || !message.trim();
  return {
    kind: 'unknown',
    code: null,
    error: 'start_failed',
    title: "The sign-in couldn't start",
    message: vague ? "WorkSuite couldn't start the sign-in with Microsoft." : message,
    next_step: 'Try again. If it keeps happening, give your admin the details below.',
    quiet: false,
    admin_consent_url: null,
    help_url: null,
    ref,
    details: { request_id: ref, error: 'start_failed', description: vague ? null : message },
  };
}

/** Why a mailbox's sign-in stopped working, for its row: "Sign in again" for a revoked or expired Microsoft sign-in. */
export function mailboxProblemText(b: { auth_type?: string; last_error?: string | null }): string | null {
  const raw = b.last_error ?? null;
  if (b.auth_type !== 'oauth') return raw && !mentionsServerLog(raw) ? raw : raw ? 'The sign-in failed.' : null;
  const e = explainProviderError({ error: /invalid_grant|oauth_expired|sign-in expired/i.test(raw ?? '') ? 'invalid_grant' : null, description: raw });
  if (e.kind === 'unknown') return raw && !mentionsServerLog(raw) ? raw : 'The sign-in stopped working. Sign in again.';
  return `${e.message} ${e.next_step ?? ''}`.trim();
}
