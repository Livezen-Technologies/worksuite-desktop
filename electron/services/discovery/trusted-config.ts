import { DesktopError } from '../../main/errors';
import { EMPTY_TRUSTED_CONFIG, type ParsedSetupLink, type TrustedConfig } from '@shared/trusted-config';

/**
 * The trusted configuration on this computer (Connection & Startup §2 "Trusted configuration"). [WP2]
 *
 * Takes over electron/services/enterprise.ts, which keeps `readEnterpriseConfig()` as a wrapper. Sources, the first
 * one found wins:
 *  - Windows registry `HKLM\Software\Policies\WorkSuite` (GPO / Intune; `spki_pins` as a comma-separated REG_SZ),
 *  - macOS `/Library/Managed Preferences/com.livezen.worksuite.plist` (MDM profile),
 *  - `/etc/worksuite/policy.json`,
 *  - `managed.json` at `/etc/worksuite/managed.json`, `%ProgramData%\WorkSuite\managed.json`,
 *    `/Library/Application Support/WorkSuite/managed.json`,
 *  - `<resources>/enterprise.json` (custom builds).
 * A file is ignored unless it is owned by an administrator / root and not world-writable.
 *
 * Keys: `server_url`, `disable_server_change` (→ lockServer), `org_id`, `update_channel`, `spki_pins`,
 * `discovery_key`, `require_signed`, `allow_personal`, and `disable_personal` (legacy, inverted).
 */

/** Reads every source once. Stub: nothing configured. */
export function readTrustedConfig(): TrustedConfig {
  return { ...EMPTY_TRUSTED_CONFIG, spkiPins: [] };
}

/**
 * A setup link's trusted configuration, after its signature verified against the server's key and its `iat` is not
 * before the server's `setup.revoked_before`. Its pins only restrict, never allow. Stub: UNSUPPORTED.
 */
export function trustedFromSetupLink(_link: Extract<ParsedSetupLink, { ok: true }>, _serverKey: string): TrustedConfig {
  throw new DesktopError('UNSUPPORTED', 'Setup links are not available in this version.');
}

/** Verifies a setup link's Ed25519 signature (`s`) over its canonical JSON (`signed`). Stub: false. */
export function verifySetupLink(_link: Extract<ParsedSetupLink, { ok: true }>, _key: string): boolean {
  return false;
}
