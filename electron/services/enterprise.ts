import { managedSource, readManagedSource, type SourceEnv } from './discovery/trusted-config';

/**
 * Enterprise preconfiguration (§16.2, FR-AUTH-01). Read once at start-up from
 * wherever the platform's management tooling puts it:
 *
 *   Windows  HKLM\Software\Policies\WorkSuite           (GPO / Intune)
 *   macOS    /Library/Managed Preferences/com.livezen.worksuite.plist (MDM)
 *   Linux    /etc/worksuite/policy.json
 *   any      managed.json (/etc/worksuite, %ProgramData%\WorkSuite, /Library/Application Support/WorkSuite)
 *   any      <resources>/enterprise.json                  (custom builds)
 *
 * The trust keys (pins, discovery key, require_signed, allow_personal, org_id) are read by
 * discovery/trusted-config.ts `readTrustedConfig()`; this wrapper keeps the keys the rest of the app used before.
 */
export interface EnterpriseConfig {
  server_url?: string;
  disable_server_change?: boolean;
  update_channel?: string;
  proxy?: { mode: 'system' | 'manual' | 'pac'; url?: string; rules?: string; bypass?: string };
  sync_folder?: string;
  kiosk?: unknown;
  source: string | null;
}

function clean(raw: Record<string, unknown>, source: string): EnterpriseConfig {
  const out: EnterpriseConfig = { source };
  if (typeof raw.server_url === 'string' && /^https?:\/\//i.test(raw.server_url)) out.server_url = raw.server_url;
  if (raw.disable_server_change === true || raw.disable_server_change === 1 || raw.disable_server_change === '1') out.disable_server_change = true;
  if (typeof raw.update_channel === 'string') out.update_channel = raw.update_channel;
  if (raw.proxy && typeof raw.proxy === 'object') {
    const p = raw.proxy as Record<string, unknown>;
    const mode = p.mode === 'manual' || p.mode === 'pac' ? p.mode : 'system';
    out.proxy = {
      mode,
      url: typeof p.url === 'string' ? p.url : undefined,
      rules: typeof p.rules === 'string' ? p.rules : undefined,
      bypass: typeof p.bypass === 'string' ? p.bypass : undefined,
    };
  }
  if (typeof raw.sync_folder === 'string') out.sync_folder = raw.sync_folder;
  if ('kiosk' in raw) out.kiosk = raw.kiosk;
  return out;
}

/**
 * The enterprise configuration as before, read through discovery/trusted-config.ts (which now owns the sources, the
 * ownership check and managed.json). The Linux policy file keeps its old source name.
 */
export function readEnterpriseConfig(env?: SourceEnv): EnterpriseConfig {
  const src = env ? readManagedSource(env) : managedSource();
  if (!src) return { source: null };
  return clean(src.raw, src.source === 'policy.json' ? '/etc/worksuite/policy.json' : src.source);
}
