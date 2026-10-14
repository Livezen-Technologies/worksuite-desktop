import { SERVER_MIN_VERSION, type CompatInfo } from '@shared/discovery';
import { compareVersions, parseVersion } from '@shared/version';

/**
 * Version compatibility (Connection & Startup §2 step 7, screen 9).
 *
 *  - `desktop.min_version[platform]` above this app's version → UPDATE_REQUIRED ("Update now" goes through the
 *    updater).
 *  - `server_version` below SERVER_MIN_VERSION → SERVER_TOO_OLD.
 *  - `server_version` not reported (current Core, legacy servers) → a warning only, so existing customers are never
 *    locked out.
 */

export type CompatVerdict =
  | { ok: true; status: 'ok' | 'warning'; note: string | null; compat: CompatInfo }
  | { ok: false; code: 'UPDATE_REQUIRED' | 'SERVER_TOO_OLD'; message: string; compat: CompatInfo };

/** A release train (`2026.10`, `2026.7.1`) as numbers, or null when it is not one. */
function train(v: string): number[] | null {
  const m = /^v?(\d+(?:\.\d+){0,3})(?:[-+].*)?$/.exec(v.trim());
  return m ? m[1]!.split('.').map(Number) : null;
}

/** Compares release trains numerically part by part (`2026.10` > `2026.7`); null when either is not one. */
export function compareTrains(a: string, b: string): number | null {
  const x = train(a);
  const y = train(b);
  if (!x || !y) return null;
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] ?? 0) - (y[i] ?? 0);
    if (d !== 0) return Math.sign(d);
  }
  return 0;
}

export function checkCompat(input: { appVersion: string; minVersion: string | null | undefined; serverVersion: string | null | undefined }): CompatVerdict {
  const required = input.minVersion?.trim() || null;
  const serverVersion = input.serverVersion?.trim() || null;
  const needsUpdate = required !== null && parseVersion(required) !== null && compareVersions(input.appVersion, required) < 0;
  const compat: CompatInfo = { installed: input.appVersion, required: needsUpdate ? required : null, serverVersion, supportedFrom: SERVER_MIN_VERSION };
  if (needsUpdate) {
    return { ok: false, code: 'UPDATE_REQUIRED', compat, message: `This server needs WorkSuite Desktop ${required} or later. You have ${input.appVersion}.` };
  }
  if (serverVersion === null) return { ok: true, status: 'warning', note: 'Version not reported', compat };
  const cmp = compareTrains(serverVersion, SERVER_MIN_VERSION);
  if (cmp === null) return { ok: true, status: 'warning', note: `Version ${serverVersion} not recognised`, compat };
  if (cmp < 0) {
    return {
      ok: false,
      code: 'SERVER_TOO_OLD',
      compat,
      message: `This server runs WorkSuite ${serverVersion}. This version of WorkSuite Desktop supports servers from ${SERVER_MIN_VERSION}. Ask your administrator to update the server.`,
    };
  }
  return { ok: true, status: 'ok', note: `Server ${serverVersion}`, compat };
}
