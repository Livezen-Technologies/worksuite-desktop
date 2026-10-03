import { createHmac, createPublicKey, verify, type KeyObject } from 'node:crypto';
import { z } from 'zod';
import { canonicalJson } from '@shared/canonical-json';
import type { Arch, Platform, UpdateChannel } from '@shared/types';
import { updateCenterChannel } from '@shared/updates';

/**
 * The WorkSuite Update Center (download.worksuitecloud.com) — where desktop
 * builds are published and where the app asks whether to update.
 *
 *   GET /api/v1/desktop/update?app_id=…&current_version=…&platform=…&architecture=…
 *
 * answers with an UpdateResponse signed by the Update Center's RESPONSE key:
 * Ed25519 over the canonical JSON of the document without `signature`
 * (`key_id` stays in the signed bytes), base64url. The package's size and
 * SHA-256 sit inside the signed document, so a download that matches them is
 * the build the Update Center vouched for.
 */

export const UPDATE_CENTER_URL = 'https://download.worksuitecloud.com';
export const UPDATE_CENTER_APP_ID = 'lk.worksuite.desktop';

/**
 * Pinned public keys, base64url raw Ed25519 (also served at GET /api/v1/keys,
 * which is never trusted at run time: a key fetched from the server it guards
 * proves nothing). A rotation ships as a new app version carrying both keys.
 */
export const UPDATE_CENTER_RESPONSE_KEYS: Readonly<Record<string, string>> = {
  'ws-uc-resp-1': 'IXUW-CxIZxbDuC0uWZUjQk3Q4x-mA9y4atMGcbPkgJs',
};
export const UPDATE_CENTER_RELEASE_KEYS: Readonly<Record<string, string>> = {
  'ws-release-1': '4LoA_LfKb1KQ0rVJgzqxLodhS4OCXntsFvOck7lNpv0',
};

const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');

/** A raw 32-byte Ed25519 public key (base64url) as a Node key object. */
export function ed25519Key(rawBase64Url: string): KeyObject {
  const raw = Buffer.from(rawBase64Url, 'base64url');
  if (raw.length !== 32) throw new Error('an Ed25519 public key is 32 bytes');
  return createPublicKey({ key: Buffer.concat([ED25519_SPKI_PREFIX, raw]), format: 'der', type: 'spki' });
}

/**
 * The Update Center's canonical JSON (PHP json_encode with unescaped slashes
 * and unicode). It matches ours byte for byte except that PHP still escapes
 * U+2028 and U+2029, which can only appear inside strings.
 */
export function ucCanonicalJson(value: unknown): string {
  return canonicalJson(value).replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}

/** Verifies a signed Update Center document against pinned keys, by its `key_id`. */
export function verifyUcDocument(doc: Record<string, unknown>, keys: Readonly<Record<string, string>>): boolean {
  const { signature, ...rest } = doc;
  const kid = rest.key_id;
  if (typeof signature !== 'string' || typeof kid !== 'string' || !Object.hasOwn(keys, kid)) return false;
  try {
    return verify(null, Buffer.from(ucCanonicalJson(rest), 'utf8'), ed25519Key(keys[kid]!), Buffer.from(signature, 'base64url'));
  } catch {
    return false;
  }
}

export const ucPackageSchema = z.object({
  id: z.string(),
  type: z.string(),
  size: z.number().int().positive(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  file_name: z.string().max(255),
  download_url: z.string().min(1).max(4096),
  download_grant: z.string().max(4096).nullable().optional(),
});

export const updateResponseSchema = z.object({
  status: z.enum(['CURRENT', 'UPDATE_AVAILABLE', 'UPDATE_RECOMMENDED', 'UPDATE_REQUIRED', 'UNSUPPORTED', 'RELEASE_WITHDRAWN']),
  app_id: z.string(),
  channel: z.string(),
  current_version: z.string(),
  latest_version: z.string().nullable().optional(),
  release_type: z.string().nullable().optional(),
  mandatory: z.boolean().optional(),
  effective_minimum: z.string().nullable().optional(),
  release_notes_url: z.string().nullable().optional(),
  /** "What's new" lines for the version on offer (worksuite-desktop#205). */
  highlights: z.array(z.string().max(500)).max(20).nullable().optional(),
  /** A one-line summary of the release, when the Update Center has one. */
  summary: z.string().max(500).nullable().optional(),
  package: ucPackageSchema.nullable().optional(),
  message: z.string().nullable().optional(),
  issued_at: z.string(),
  expires_at: z.string(),
  key_id: z.string(),
  signature: z.string(),
});

export type UpdateResponse = z.infer<typeof updateResponseSchema>;
export type UcPackage = z.infer<typeof ucPackageSchema>;

/** Statuses that mean this version has to go (the deadline logic applies). */
export function isRequired(r: UpdateResponse): boolean {
  return r.status === 'UPDATE_REQUIRED' || r.status === 'UNSUPPORTED' || r.status === 'RELEASE_WITHDRAWN';
}

/**
 * The channel hint. The Update Center decides: a tenant policy wins, and a
 * channel that is not public falls back to Stable. `org` is the
 * organisation's own channel, which only a tenant policy can name.
 */
export function ucChannel(channel: UpdateChannel): string | null {
  return updateCenterChannel(channel);
}

/** A security fix: the Update Center's release type CRITICAL or SECURITY. */
export function isSecurityRelease(r: Pick<UpdateResponse, 'release_type'>): boolean {
  return r.release_type === 'CRITICAL' || r.release_type === 'SECURITY';
}

/**
 * Test channels: an unsigned build may install their releases by itself,
 * trusting the signed answer and the package's SHA-256. Stable never.
 */
export function isTestChannel(channel: string): boolean {
  return ['beta', 'dev', 'internal'].includes(channel.toLowerCase());
}

/** The package type this installation installs by itself. */
export function ucInstallType(platform: Platform, runningAsAppImage: boolean): string | null {
  if (platform === 'windows') return 'exe';
  if (platform === 'macos') return 'dmg';
  return runningAsAppImage ? 'appimage' : null;
}

/** A pseudonymous device reference: the install id never leaves the computer. */
export function deviceRef(installId: string): string {
  return 'hmac:' + createHmac('sha256', 'worksuite-update-center/device-ref').update(installId).digest('hex').slice(0, 32);
}

export interface UpdateQuery {
  base: string;
  version: string;
  platform: Platform;
  arch: Arch;
  installType: string | null;
  channel: UpdateChannel;
  installId: string | null;
  osVersion: string | null;
  /** "Reinstall Stable now": ask for the channel's build even when it is older than this one. */
  allowDowngrade?: boolean;
}

export function updateCheckUrl(q: UpdateQuery): string {
  const u = new URL('/api/v1/desktop/update', q.base);
  u.searchParams.set('app_id', UPDATE_CENTER_APP_ID);
  u.searchParams.set('current_version', q.version);
  u.searchParams.set('platform', q.platform);
  u.searchParams.set('architecture', q.arch);
  if (q.installType) u.searchParams.set('install_type', q.installType);
  const ch = ucChannel(q.channel);
  if (ch) u.searchParams.set('channel', ch);
  if (q.installId && q.installId !== 'unknown') u.searchParams.set('device_id', deviceRef(q.installId));
  if (q.osVersion) u.searchParams.set('os_version', q.osVersion);
  if (q.allowDowngrade) u.searchParams.set('allow_downgrade', '1');
  return u.toString();
}

/**
 * Accepts an update response only if it is signed, is for this app and this
 * version, and has not expired (a replayed old answer is refused).
 */
export function acceptUpdateResponse(
  raw: Record<string, unknown>,
  keys: Readonly<Record<string, string>>,
  currentVersion: string,
  now = Date.now(),
): { ok: true; response: UpdateResponse } | { ok: false; reason: 'signature' | 'malformed' | 'mismatch' | 'expired' } {
  if (!verifyUcDocument(raw, keys)) return { ok: false, reason: 'signature' };
  const parsed = updateResponseSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, reason: 'malformed' };
  const r = parsed.data;
  if (r.app_id !== UPDATE_CENTER_APP_ID || r.current_version.replace(/^v/, '') !== currentVersion.replace(/^v/, '')) return { ok: false, reason: 'mismatch' };
  const expires = Date.parse(r.expires_at);
  const issued = Date.parse(r.issued_at);
  // Twelve hours' grace either way: a computer whose clock is wrong must still
  // hear about updates, and an old answer replayed can at worst offer a build
  // the Update Center once signed for this very version.
  const grace = 12 * 3600_000;
  if (!Number.isFinite(expires) || expires < now - grace || !Number.isFinite(issued) || issued > now + grace) return { ok: false, reason: 'expired' };
  return { ok: true, response: r };
}
