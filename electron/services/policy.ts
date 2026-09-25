import { createPublicKey, verify } from 'node:crypto';
import type { DesktopPolicy, DeviceTrust, NotificationPrivacy } from '@shared/types';
import { canonicalJson } from '@shared/canonical-json';

/**
 * Desktop policy (§11.2, FR-SEC-09).
 *
 * A policy from /desktop/v1 is signed (Ed25519 over canonical JSON) and is
 * applied only if the signature verifies against the pinned policy key; a
 * policy that fails keeps the last valid one in force
 * (POLICY_SIGNATURE_INVALID, §8.3).
 *
 * The existing WorkSuite API has no signed desktop policy. Its sync policy
 * and device directives arrive over the authenticated TLS session and are
 * applied as `signed: false`, which Diagnostics shows.
 */
export const DEFAULT_POLICY: DesktopPolicy = {
  version: 0,
  signed: false,
  desktop_access: 'allowed',
  minimum_version: {},
  update_channel: 'stable',
  auto_update: 'enforced',
  forced_update_deadline_hours: 24,
  file_sync: 'allowed',
  offline_files: 'allowed',
  sync_folder_policy: 'user_choice',
  removable_media_sync: false,
  offline_storage: true,
  offline_storage_max_mb: 2048,
  clipboard_paste: true,
  external_file_open: 'allowed',
  downloads: 'allowed',
  screen_capture_share: 'allowed',
  app_lock_max_minutes: 15,
  notification_min_privacy: 'FULL',
  required_background_services: [],
  personal_device_mode: 'online_only',
  wipe_on_revoke: 'cache+offline_files',
  proxy: 'system',
  allow_offline: true,
};

const PRIVACY_ORDER: NotificationPrivacy[] = ['FULL', 'SENDER_ONLY', 'GENERIC'];

/** The stricter of two privacy modes (admin minimum vs user choice). */
export function stricterPrivacy(a: NotificationPrivacy, b: NotificationPrivacy): NotificationPrivacy {
  return PRIVACY_ORDER.indexOf(a) >= PRIVACY_ORDER.indexOf(b) ? a : b;
}

function clamp(n: unknown, min: number, max: number, fallback: number): number {
  const v = typeof n === 'number' && Number.isFinite(n) ? n : fallback;
  return Math.min(max, Math.max(min, Math.round(v)));
}

function pick<T extends string>(v: unknown, allowed: readonly T[], fallback: T): T {
  return typeof v === 'string' && (allowed as readonly string[]).includes(v) ? (v as T) : fallback;
}

/** Normalises an untrusted policy object onto the known keys and ranges. */
export function normalizePolicy(input: Record<string, unknown> | null | undefined, signed: boolean): DesktopPolicy {
  const p = input ?? {};
  const d = DEFAULT_POLICY;
  const storage = p.offline_storage;
  const storageOn = typeof storage === 'object' && storage !== null ? (storage as { enabled?: unknown }).enabled !== false : storage !== false;
  const storageMb =
    typeof storage === 'object' && storage !== null ? (storage as { max_mb?: unknown }).max_mb : p.offline_storage_max_mb;
  const minVersion: DesktopPolicy['minimum_version'] = {};
  if (p.minimum_version && typeof p.minimum_version === 'object') {
    for (const k of ['windows', 'macos', 'linux'] as const) {
      const v = (p.minimum_version as Record<string, unknown>)[k];
      if (typeof v === 'string' && v.length <= 32) minVersion[k] = v;
    }
  }
  return {
    version: clamp(p.version, 0, Number.MAX_SAFE_INTEGER, 0),
    signed,
    desktop_access: pick(p.desktop_access, ['allowed', 'disabled', 'managed_only'], d.desktop_access),
    minimum_version: minVersion,
    update_channel: pick(p.update_channel, ['stable', 'beta', 'dev', 'org'], d.update_channel),
    auto_update: pick(p.auto_update, ['enforced', 'user_choice'], d.auto_update),
    forced_update_deadline_hours: clamp(p.forced_update_deadline_hours, 1, 168, d.forced_update_deadline_hours),
    file_sync: pick(p.file_sync, ['allowed', 'managed_only', 'disabled'], d.file_sync),
    offline_files: pick(p.offline_files, ['allowed', 'managed_only', 'disabled'], d.offline_files),
    sync_folder_policy: typeof p.sync_folder_policy === 'string' ? p.sync_folder_policy.slice(0, 512) : d.sync_folder_policy,
    removable_media_sync: p.removable_media_sync === true,
    offline_storage: storageOn,
    offline_storage_max_mb: clamp(storageMb, 64, 65_536, d.offline_storage_max_mb),
    clipboard_paste: p.clipboard_paste !== false,
    external_file_open: pick(p.external_file_open, ['allowed', 'managed_only', 'disabled'], d.external_file_open),
    downloads: pick(p.downloads, ['allowed', 'managed_only', 'disabled'], d.downloads),
    screen_capture_share: pick(p.screen_capture_share, ['allowed', 'disabled'], d.screen_capture_share),
    app_lock_max_minutes: clamp(p.app_lock_max_minutes, 0, 60, d.app_lock_max_minutes),
    notification_min_privacy: pick(p.notification_min_privacy, PRIVACY_ORDER, d.notification_min_privacy),
    required_background_services: Array.isArray(p.required_background_services)
      ? p.required_background_services.filter((s): s is string => typeof s === 'string').slice(0, 16)
      : [],
    personal_device_mode: pick(p.personal_device_mode, ['full', 'online_only', 'blocked'], d.personal_device_mode),
    wipe_on_revoke: pick(p.wipe_on_revoke, ['tokens', 'cache', 'cache+offline_files'], d.wipe_on_revoke),
    proxy: pick(p.proxy, ['system', 'manual', 'pac'], d.proxy),
    allow_offline: p.allow_offline !== false,
  };
}

/** Verifies an Ed25519 signature over the canonical JSON of `payload`. */
export function verifySignature(payload: unknown, signatureB64: string, publicKeyPem: string): boolean {
  try {
    const key = createPublicKey(publicKeyPem);
    return verify(null, Buffer.from(canonicalJson(payload), 'utf8'), key, Buffer.from(signatureB64, 'base64'));
  } catch {
    return false;
  }
}

/**
 * Applies a policy document `{ ...policy, signature }`.
 *
 * With a policy key pinned in this build, the signature is required: a
 * missing or wrong one returns null and the caller keeps the last valid
 * policy (POLICY_SIGNATURE_INVALID). Without a pinned key there is nothing to
 * check a signature against, so the policy is applied as unsigned — the same
 * trust as the core API's policy: the authenticated TLS session.
 */
export function acceptSignedPolicy(doc: Record<string, unknown>, publicKeyPem: string | null): DesktopPolicy | null {
  const { signature, ...rest } = doc;
  if (!publicKeyPem) return normalizePolicy(rest, false);
  if (typeof signature !== 'string') return null;
  if (!verifySignature(rest, signature, publicKeyPem)) return null;
  return normalizePolicy(rest, true);
}

/**
 * §11.3: what a device may do given its trust. The organization's trust in
 * the installation, not an assessment of the user.
 */
export interface DeviceCapabilities {
  offlineQueue: 'allowed' | 'drafts_only' | 'disabled';
  offlineCache: boolean;
  downloads: 'allowed' | 'audited' | 'disabled';
}

export function capabilitiesFor(trust: DeviceTrust, policy: DesktopPolicy): DeviceCapabilities {
  const offlineAllowed = policy.allow_offline && policy.offline_storage;
  const downloadsPolicy = policy.downloads === 'disabled' ? 'disabled' : null;
  switch (trust) {
    case 'TRUSTED':
      return { offlineQueue: offlineAllowed ? 'allowed' : 'disabled', offlineCache: offlineAllowed, downloads: downloadsPolicy ?? 'allowed' };
    case 'STANDARD':
      return {
        offlineQueue: offlineAllowed ? 'drafts_only' : 'disabled',
        offlineCache: offlineAllowed && policy.personal_device_mode !== 'online_only' ? true : offlineAllowed,
        downloads: downloadsPolicy ?? (policy.downloads === 'managed_only' ? 'disabled' : 'audited'),
      };
    case 'RESTRICTED':
    case 'REVOKED':
      return { offlineQueue: 'disabled', offlineCache: false, downloads: 'disabled' };
  }
}
