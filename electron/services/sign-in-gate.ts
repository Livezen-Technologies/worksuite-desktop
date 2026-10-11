import type { CaptchaProvider, DeviceCodeStep, SignInGate } from '@shared/types';
import { DesktopError } from '../main/errors';

/**
 * The server's sign-in protections, read from its answers (worksuite-desktop#301; the server's
 * Auth\Libraries\SignInGuard, Captcha, SignInDevice and EmailCode).
 *
 * Everything here is counted and decided on the server — per account and per address — and the app only says what
 * the answer said: a CAPTCHA to solve before the next attempt, a wait with its end, a block, or the emailed code a new
 * computer needs. None of it says whether an address has an account: the server answers an address with none exactly
 * the same, and so does this.
 */

/** A sign-in answer that is a CAPTCHA, a wait or a block: the session shows it instead of failing. */
export class SignInGateError extends DesktopError {
  constructor(readonly gate: SignInGate) {
    super(gate.kind === 'blocked' ? 'POLICY_DENIED' : 'RATE_LIMITED', gate.message);
    this.name = 'SignInGateError';
  }
}

export function isGateError(e: unknown): e is SignInGateError {
  return e instanceof SignInGateError;
}

/** A new computer's emailed code: ten minutes, five wrong guesses, another one after a minute (EmailCode). */
export const DEVICE_CODE_TTL_MS = 10 * 60_000;
export const DEVICE_CODE_ATTEMPTS = 5;
export const DEVICE_CODE_RESEND_MS = 60_000;

const PROVIDERS: readonly CaptchaProvider[] = ['turnstile', 'hcaptcha', 'recaptcha'];

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v.slice(0, 200) : null);

/**
 * The gate in an error answer, or null for any other error.
 *
 * - `423 {code: blocked}`: the account is blocked until it is unblocked (an administrator, or the emailed link).
 * - `429 {code: restricted, retry_after}`: a wait; `Retry-After` says the same.
 * - `401|400 {code: captcha_required, captcha}`: the next attempt needs a solved CAPTCHA (401: this attempt's
 *   password was wrong too; 400: it was not looked at, because no CAPTCHA came with it).
 */
export function gateFrom(status: number, json: Record<string, unknown> | null, email: string, retryAfter: string | null, now = Date.now()): SignInGate | null {
  const errors = json?.errors && typeof json.errors === 'object' ? (json.errors as Record<string, unknown>) : {};
  const code = errors.code;
  const message = typeof json?.message === 'string' && json.message.trim() ? json.message.trim() : '';
  if (code === 'blocked' || (status === 423 && code === undefined && /blocked/i.test(message))) {
    return {
      kind: 'blocked',
      email,
      reference: str(errors.reference),
      failures: num(errors.failures),
      blockedAt: str(errors.blocked_at),
      lastPlace: str(errors.last_place),
      lastBrowser: str(errors.last_browser),
      selfUnblock: errors.self_unblock !== false,
      linkHours: num(errors.link_hours),
      message: message || 'Sign-in to this account is blocked. Use the unblock link we emailed to the account, or ask your administrator.',
    };
  }
  if (code === 'restricted') {
    const seconds = num(errors.retry_after) ?? (retryAfter !== null && /^\d+$/.test(retryAfter) ? Number(retryAfter) : null) ?? 60;
    return {
      kind: 'restricted',
      email,
      until: now + Math.max(1, seconds) * 1000,
      total: num(errors.wait_total),
      failures: num(errors.failures),
      nextWait: num(errors.next_wait),
      blockAfter: num(errors.block_after),
      message: message || 'Too many attempts. Try again later.',
    };
  }
  if (code === 'captcha_required') {
    const c = errors.captcha && typeof errors.captcha === 'object' ? (errors.captcha as Record<string, unknown>) : {};
    const provider = PROVIDERS.includes(c.provider as CaptchaProvider) ? (c.provider as CaptchaProvider) : null;
    return {
      kind: 'captcha',
      email,
      provider,
      solved: false,
      message:
        status === 401
          ? 'That email and password don’t match. After several failed attempts, confirm you are not a robot before trying again.'
          : message || 'Confirm you are not a robot, then sign in again.',
    };
  }
  return null;
}

/** The emailed-code step from a password answer (`{device_verification, challenge, email_hint, sent, message}`), or null. */
export function deviceStepFrom(data: Record<string, unknown>, now = Date.now()): { challenge: string; step: DeviceCodeStep } | null {
  if (data.device_verification !== true || typeof data.challenge !== 'string' || !data.challenge) return null;
  const sent = data.sent !== false;
  return {
    challenge: data.challenge,
    step: {
      emailHint: typeof data.email_hint === 'string' ? data.email_hint.slice(0, 254) : '',
      sent,
      message: typeof data.message === 'string' ? data.message.slice(0, 300) : null,
      expiresAt: now + DEVICE_CODE_TTL_MS,
      resendAt: sent ? now + DEVICE_CODE_RESEND_MS : now,
      attemptsLeft: DEVICE_CODE_ATTEMPTS,
    },
  };
}

/**
 * Whether a two-factor challenge is for a computer the account has not verified (its `nd` claim). Read without
 * verifying: it only changes what the screen says ("this verifies this computer too"), never what is sent.
 */
export function challengeIsNewDevice(challenge: string): boolean {
  const payload = challenge.split('.')[1];
  if (!payload) return false;
  try {
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as { nd?: unknown };
    return claims.nd === 1 || claims.nd === true;
  } catch {
    return false;
  }
}

/** A remembered-device token as the server issues it (`DeviceTrust`: 32–128 characters). */
export function isDeviceToken(v: unknown): v is string {
  return typeof v === 'string' && /^[A-Za-z0-9_-]{32,128}$/.test(v);
}
