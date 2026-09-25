import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { logger } from '../main/log';

const log = logger('enterprise');

/**
 * Enterprise preconfiguration (§16.2, FR-AUTH-01). Read once at start-up from
 * wherever the platform's management tooling puts it:
 *
 *   Windows  HKLM\Software\Policies\WorkSuite           (GPO / Intune)
 *   macOS    /Library/Managed Preferences/com.livezen.worksuite.plist (MDM)
 *   Linux    /etc/worksuite/policy.json
 *   any      <resources>/enterprise.json                  (custom builds)
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

function readJson(path: string): Record<string, unknown> | null {
  try {
    if (!existsSync(path)) return null;
    const v = JSON.parse(readFileSync(path, 'utf8')) as unknown;
    return v && typeof v === 'object' ? (v as Record<string, unknown>) : null;
  } catch (e) {
    log.warn('enterprise config unreadable', { path, error: String(e) });
    return null;
  }
}

function readMacManaged(): Record<string, unknown> | null {
  const path = '/Library/Managed Preferences/com.livezen.worksuite.plist';
  if (!existsSync(path)) return null;
  try {
    const out = execFileSync('/usr/bin/plutil', ['-convert', 'json', '-o', '-', path], { timeout: 3000, encoding: 'utf8' });
    return JSON.parse(out) as Record<string, unknown>;
  } catch (e) {
    log.warn('managed preferences unreadable', { error: String(e) });
    return null;
  }
}

function readWindowsPolicy(): Record<string, unknown> | null {
  try {
    const out = execFileSync('reg', ['query', 'HKLM\\Software\\Policies\\WorkSuite'], { timeout: 3000, encoding: 'utf8', windowsHide: true });
    const values: Record<string, unknown> = {};
    for (const line of out.split(/\r?\n/)) {
      const m = /^\s+(\S+)\s+(REG_SZ|REG_DWORD|REG_EXPAND_SZ)\s+(.*)$/.exec(line);
      if (!m) continue;
      const [, name, type, data] = m;
      values[name!] = type === 'REG_DWORD' ? Number.parseInt(data!, 16) : data!.trim();
    }
    if (typeof values.proxy_mode === 'string') {
      values.proxy = { mode: values.proxy_mode, url: values.proxy_url, rules: values.proxy_rules, bypass: values.proxy_bypass };
    }
    return Object.keys(values).length ? values : null;
  } catch {
    return null; // key absent: not managed
  }
}

export function readEnterpriseConfig(): EnterpriseConfig {
  const candidates: Array<[string, () => Record<string, unknown> | null]> = [];
  if (process.platform === 'win32') candidates.push(['registry', readWindowsPolicy]);
  if (process.platform === 'darwin') candidates.push(['mdm-profile', readMacManaged]);
  if (process.platform === 'linux') candidates.push(['/etc/worksuite/policy.json', () => readJson('/etc/worksuite/policy.json')]);
  if (process.resourcesPath) candidates.push(['enterprise.json', () => readJson(join(process.resourcesPath, 'enterprise.json'))]);
  for (const [source, read] of candidates) {
    const raw = read();
    if (raw) {
      log.info('enterprise configuration found', { source });
      return clean(raw, source);
    }
  }
  return { source: null };
}
