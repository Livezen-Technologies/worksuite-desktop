import { createPublicKey, verify } from 'node:crypto';
import type { DesktopPolicy, DeviceTrust, NotificationPrivacy } from '@shared/types';
import { canonicalJson } from '@shared/canonical-json';
import { canonicalChord, parseChord } from '@shared/remote-control/channel';
import { cleanIds, PIN_MAX } from '@shared/launcher';

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
  allowed_update_channels: ['stable', 'beta', 'dev'],
  update_channel_default: 'stable',
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
  app_lock_max_minutes: 0,
  notification_min_privacy: 'FULL',
  required_background_services: [],
  personal_device_mode: 'online_only',
  wipe_on_revoke: 'cache+offline_files',
  proxy: 'system',
  allow_offline: true,
  remote_control_host: 'managed_only',
  remote_control_controller: 'allowed',
  remote_clipboard: 'off',
  remote_file_receive: 'managed_only',
  remote_emergency_stop_chord: 'Ctrl+Alt+Shift+Esc',
  remote_local_priority_hold_ms: 1500,
  ai_quick_ask: true,
  ai_insert: true,
  ai_local_files: true,
  launcher_pinned: [],
  launcher_order: [],
};

/**
 * The emergency chord as the policy wrote it, in the one form the receiver
 * and the shortcut use (`Alt+Ctrl+Shift+Escape` → `Ctrl+Alt+Shift+Esc`): at
 * least one modifier and a plain key, else the default.
 */
export function emergencyChord(v: unknown): string {
  if (typeof v !== 'string' || v.length > 64) return DEFAULT_POLICY.remote_emergency_stop_chord;
  const c = parseChord(v);
  const plain = /^([A-Z0-9]|F([1-9]|1[0-9]|2[0-4])|Esc|Tab|Space|Enter|Backspace|Delete|Home|End|PageUp|PageDown)$/.test(c.key);
  return c.mods.size > 0 && plain ? canonicalChord(v) : DEFAULT_POLICY.remote_emergency_stop_chord;
}

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
    allowed_update_channels: updateChannels(p.allowed_update_channels),
    update_channel_default: defaultChannel(p.update_channel_default, updateChannels(p.allowed_update_channels)),
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
    locked_answer_calls: p.locked_answer_calls !== false,
    locked_show_caller_details: p.locked_show_caller_details !== false,
    locked_allow_chat: p.locked_allow_chat !== false,
    app_lock_max_minutes: clamp(p.app_lock_max_minutes, 0, 60, d.app_lock_max_minutes),
    notification_min_privacy: pick(p.notification_min_privacy, PRIVACY_ORDER, d.notification_min_privacy),
    required_background_services: Array.isArray(p.required_background_services)
      ? p.required_background_services.filter((s): s is string => typeof s === 'string').slice(0, 16)
      : [],
    personal_device_mode: pick(p.personal_device_mode, ['full', 'online_only', 'blocked'], d.personal_device_mode),
    wipe_on_revoke: pick(p.wipe_on_revoke, ['tokens', 'cache', 'cache+offline_files'], d.wipe_on_revoke),
    proxy: pick(p.proxy, ['system', 'manual', 'pac'], d.proxy),
    allow_offline: p.allow_offline !== false,
    remote_control_host: pick(p.remote_control_host, ['allowed', 'managed_only', 'disabled'], d.remote_control_host),
    remote_control_controller: pick(p.remote_control_controller, ['allowed', 'disabled'], d.remote_control_controller),
    remote_clipboard: pick(p.remote_clipboard, ['off', 'text_only', 'text_and_files'], d.remote_clipboard),
    remote_file_receive: pick(p.remote_file_receive, ['allowed', 'managed_only', 'disabled'], d.remote_file_receive),
    remote_emergency_stop_chord: emergencyChord(p.remote_emergency_stop_chord),
    remote_local_priority_hold_ms: clamp(p.remote_local_priority_hold_ms, 500, 5000, d.remote_local_priority_hold_ms),
    // Nested under `ai` or flat: an administrator writing either is understood, and only `false` switches off.
    ai_quick_ask: aiKey(p, 'quick_ask') !== false,
    ai_insert: aiKey(p, 'insert') !== false,
    ai_local_files: aiKey(p, 'local_files') !== false,
    launcher_pinned: cleanIds(p.launcher_pinned, PIN_MAX),
    launcher_order: cleanIds(p.launcher_order, 300),
  };
}

/** The channels people may choose (worksuite-desktop#205): known ones, in order, Stable always; none listed: all three. */
function updateChannels(v: unknown): DesktopPolicy['update_channel'][] {
  const all = ['stable', 'beta', 'dev'] as const;
  const listed = Array.isArray(v) ? all.filter((c) => v.includes(c)) : [];
  return listed.length ? all.filter((c) => c === 'stable' || listed.includes(c)) : [...all];
}

/** The organisation's default channel, when it is one of the allowed ones; else Stable. */
function defaultChannel(v: unknown, allowed: DesktopPolicy['update_channel'][]): DesktopPolicy['update_channel'] {
  return typeof v === 'string' && (allowed as string[]).includes(v) ? (v as DesktopPolicy['update_channel']) : 'stable';
}

/** `ai.quick_ask` or `ai_quick_ask` — the policy file is written by people, in either shape. */
function aiKey(p: Record<string, unknown>, key: 'quick_ask' | 'insert' | 'local_files'): unknown {
  const nested = typeof p.ai === 'object' && p.ai !== null ? (p.ai as Record<string, unknown>)[key] : undefined;
  return nested ?? p[`ai_${key}`];
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
