import { execFileSync } from 'node:child_process';
import { verify } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { EMPTY_TRUSTED_CONFIG, SPKI_PIN, type ParsedSetupLink, type TrustedConfig, type TrustedSource } from '@shared/trusted-config';
import { logger } from '../../main/log';
import { parseEd25519Key } from './keys';

const log = logger('trusted-config');

/**
 * The trusted configuration on this computer (Connection & Startup §2 "Trusted configuration"). [WP2]
 *
 * Takes over electron/services/enterprise.ts, which keeps `readEnterpriseConfig()` as a wrapper. Sources, the first
 * one found wins:
 *  - Windows registry `HKLM\Software\Policies\WorkSuite` (GPO / Intune; `spki_pins` as a comma-separated REG_SZ),
 *  - macOS `/Library/Managed Preferences/com.livezen.worksuite.plist` (MDM profile),
 *  - `/etc/worksuite/policy.json` (Linux),
 *  - `managed.json` at `/etc/worksuite/managed.json`, `%ProgramData%\WorkSuite\managed.json`,
 *    `/Library/Application Support/WorkSuite/managed.json`,
 *  - `<resources>/enterprise.json` (custom builds).
 * A system file is ignored unless it is owned by root / an administrator and not writable by everyone; a custom
 * build's `enterprise.json` (inside the app, which a per-user install owns) only has to be not world-writable.
 *
 * Keys: `server_url`, `disable_server_change` (→ lockServer), `org_id`, `update_channel`, `spki_pins`,
 * `discovery_key`, `require_signed`, `allow_personal`, and `disable_personal` (legacy, inverted).
 */

export interface ManagedSource {
  source: Exclude<TrustedSource, 'setup-link' | null>;
  /** Where it was read from (a path, or the registry key). */
  where: string;
  raw: Record<string, unknown>;
}

/** What reading the sources may touch; every field defaults to the real thing (tests replace them). */
export interface SourceEnv {
  platform: NodeJS.Platform;
  resourcesPath: string | undefined;
  programData: string;
  exists: (path: string) => boolean;
  readFile: (path: string) => string;
  stat: (path: string) => { uid: number; gid: number; mode: number };
  exec: (file: string, args: string[]) => string;
}

function realEnv(): SourceEnv {
  return {
    platform: process.platform,
    resourcesPath: process.resourcesPath,
    programData: process.env.ProgramData ?? 'C:\\ProgramData',
    exists: existsSync,
    readFile: (p) => readFileSync(p, 'utf8'),
    stat: (p) => statSync(p),
    exec: (file, args) => execFileSync(file, args, { timeout: 3000, encoding: 'utf8', windowsHide: true }),
  };
}

const REGISTRY_KEY = 'HKLM\\Software\\Policies\\WorkSuite';
const MAC_PLIST = '/Library/Managed Preferences/com.livezen.worksuite.plist';

/** The managed.json path for a platform. */
export function managedJsonPath(env: Pick<SourceEnv, 'platform' | 'programData'>): string {
  if (env.platform === 'win32') return join(env.programData, 'WorkSuite', 'managed.json').replace(/\//g, '\\');
  if (env.platform === 'darwin') return '/Library/Application Support/WorkSuite/managed.json';
  return '/etc/worksuite/managed.json';
}

/**
 * Whether a configuration file may be trusted: owned by root (POSIX; on macOS the admin group may own it too) and not
 * world-writable. On Windows the ACL is read with icacls: no write right for Everyone, Users or Authenticated Users.
 */
export function fileIsProtected(path: string, env: SourceEnv, requireAdminOwner = true): boolean {
  try {
    if (env.platform === 'win32') {
      if (!requireAdminOwner) return true;
      const acl = env.exec('icacls', [path]);
      const open = acl
        .split(/\r?\n/)
        .some((l) => /(Everyone|\\Users|Authenticated Users):/i.test(l) && /\((?:[^)]*,)?(F|M|W|WD|AD|GA|GW)(?:,[^)]*)?\)/.test(l));
      return !open;
    }
    const st = env.stat(path);
    if (st.mode & 0o002) return false;
    if (!requireAdminOwner) return true;
    if (st.uid === 0) return true;
    // macOS: an MDM-installed file may be root:admin or owned by an admin with group admin (gid 80), never group-writable then.
    return env.platform === 'darwin' && st.gid === 80 && st.uid < 501 && (st.mode & 0o020) === 0;
  } catch {
    return false;
  }
}

function readJsonFile(path: string, env: SourceEnv, requireAdminOwner: boolean): Record<string, unknown> | null {
  try {
    if (!env.exists(path)) return null;
    if (!fileIsProtected(path, env, requireAdminOwner)) {
      log.warn('managed configuration ignored: not protected', { path });
      return null;
    }
    const v = JSON.parse(env.readFile(path)) as unknown;
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch (e) {
    log.warn('managed configuration unreadable', { path, error: String(e) });
    return null;
  }
}

function readMacManaged(env: SourceEnv): Record<string, unknown> | null {
  if (!env.exists(MAC_PLIST)) return null;
  try {
    if (!fileIsProtected(MAC_PLIST, env)) {
      log.warn('managed preferences ignored: not protected');
      return null;
    }
    const out = env.exec('/usr/bin/plutil', ['-convert', 'json', '-o', '-', MAC_PLIST]);
    const v = JSON.parse(out) as unknown;
    return v && typeof v === 'object' ? (v as Record<string, unknown>) : null;
  } catch (e) {
    log.warn('managed preferences unreadable', { error: String(e) });
    return null;
  }
}

/** `reg query` output as values: REG_DWORD as numbers, strings trimmed. */
export function parseRegQuery(out: string): Record<string, unknown> {
  const values: Record<string, unknown> = {};
  for (const line of out.split(/\r?\n/)) {
    const m = /^\s+(\S+)\s+(REG_SZ|REG_DWORD|REG_EXPAND_SZ|REG_MULTI_SZ)\s*(.*)$/.exec(line);
    if (!m) continue;
    const [, name, type, data] = m;
    if (type === 'REG_DWORD') values[name!] = Number.parseInt(data!, 16);
    else if (type === 'REG_MULTI_SZ') values[name!] = data!.split('\\0').map((s) => s.trim()).filter(Boolean);
    else values[name!] = data!.trim();
  }
  if (typeof values.proxy_mode === 'string') {
    values.proxy = { mode: values.proxy_mode, url: values.proxy_url, rules: values.proxy_rules, bypass: values.proxy_bypass };
  }
  return values;
}

function readWindowsPolicy(env: SourceEnv): Record<string, unknown> | null {
  try {
    const values = parseRegQuery(env.exec('reg', ['query', REGISTRY_KEY]));
    return Object.keys(values).length ? values : null;
  } catch {
    return null; // key absent: not managed
  }
}

/** The first managed source found, raw. */
export function readManagedSource(env: SourceEnv = realEnv()): ManagedSource | null {
  const candidates: Array<[ManagedSource['source'], string, () => Record<string, unknown> | null]> = [];
  if (env.platform === 'win32') candidates.push(['registry', REGISTRY_KEY, () => readWindowsPolicy(env)]);
  if (env.platform === 'darwin') candidates.push(['mdm-profile', MAC_PLIST, () => readMacManaged(env)]);
  if (env.platform === 'linux') candidates.push(['policy.json', '/etc/worksuite/policy.json', () => readJsonFile('/etc/worksuite/policy.json', env, true)]);
  const managed = managedJsonPath(env);
  candidates.push(['managed.json', managed, () => readJsonFile(managed, env, true)]);
  if (env.resourcesPath) {
    const p = join(env.resourcesPath, 'enterprise.json');
    candidates.push(['enterprise.json', p, () => readJsonFile(p, env, false)]);
  }
  for (const [source, where, read] of candidates) {
    const raw = read();
    if (raw) {
      log.info('managed configuration found', { source });
      return { source, where, raw };
    }
  }
  return null;
}

function flag(v: unknown): boolean | null {
  if (v === true || v === 1 || v === '1' || v === 'true') return true;
  if (v === false || v === 0 || v === '0' || v === 'false') return false;
  return null;
}

function str(v: unknown, max = 512): string | null {
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  return typeof v === 'string' && v.trim() && v.length <= max ? v.trim() : null;
}

/** Pins as an array, or a comma / whitespace separated string (the registry's REG_SZ); malformed ones dropped. */
export function parsePins(v: unknown): string[] {
  const list = Array.isArray(v) ? v : typeof v === 'string' ? v.split(/[,\s]+/) : [];
  const out: string[] = [];
  for (const p of list) {
    if (typeof p === 'string' && SPKI_PIN.test(p.trim()) && !out.includes(p.trim())) out.push(p.trim());
  }
  return out.slice(0, 16);
}

function httpsOrigin(v: unknown): string | null {
  const s = str(v, 2048);
  if (!s) return null;
  try {
    const u = new URL(s);
    return u.protocol === 'https:' ? u.origin : null;
  } catch {
    return null;
  }
}

/** A raw managed source as a TrustedConfig. */
export function trustedFromRaw(raw: Record<string, unknown>, source: ManagedSource['source']): TrustedConfig {
  const key = str(raw.discovery_key);
  if (key && !parseEd25519Key(key)) log.warn('managed discovery_key ignored: not an Ed25519 key');
  const allow = flag(raw.allow_personal);
  const disable = flag(raw.disable_personal);
  return {
    source,
    serverUrl: httpsOrigin(raw.server_url),
    organizationId: str(raw.org_id, 128),
    updateChannel: str(raw.update_channel, 32),
    spkiPins: parsePins(raw.spki_pins),
    discoveryKey: key && parseEd25519Key(key) ? key : null,
    requireSigned: flag(raw.require_signed) === true,
    allowPersonal: allow !== null ? allow : disable !== null ? !disable : true,
    lockServer: flag(raw.disable_server_change) === true,
    expiresAt: null,
  };
}

let cached: { source: ManagedSource | null } | null = null;

/** The managed source, read once per run of the app. */
export function managedSource(): ManagedSource | null {
  if (!cached) cached = { source: readManagedSource() };
  return cached.source;
}

/** Forgets the cached source (tests, or a policy refresh). */
export function resetTrustedConfigCache(): void {
  cached = null;
}

/** This computer's trusted configuration; nothing configured when no source is found. */
export function readTrustedConfig(env?: SourceEnv): TrustedConfig {
  const src = env ? readManagedSource(env) : managedSource();
  return src ? trustedFromRaw(src.raw, src.source) : { ...EMPTY_TRUSTED_CONFIG, spkiPins: [] };
}

type OkLink = Extract<ParsedSetupLink, { ok: true }>;

/** Verifies a setup link's Ed25519 signature (`s`, standard base64) over its canonical JSON (`signed`). */
export function verifySetupLink(link: OkLink, key: string): boolean {
  const k = parseEd25519Key(key);
  if (!k) return false;
  try {
    const sig = Buffer.from(link.s, 'base64');
    return sig.length === 64 && verify(null, Buffer.from(link.signed, 'utf8'), k, sig);
  } catch {
    return false;
  }
}

/**
 * Whether Admin Center's Regenerate revoked the link: issued (`iat`) before the server's `setup.revoked_before`.
 * A link without `iat` (v1) predates any Regenerate, so it is revoked as soon as the server names a time.
 */
export function setupLinkRevoked(link: OkLink, revokedBefore: number | null | undefined): boolean {
  if (revokedBefore === null || revokedBefore === undefined || revokedBefore <= 0) return false;
  return (link.payload.iat ?? 0) < revokedBefore;
}

/**
 * A setup link's trusted configuration, after its signature verified against the server's key and its `iat` is not
 * before the server's `setup.revoked_before`. Its pins only restrict, never allow (the pinning layer treats them as
 * not managed). Throws when the signature does not verify.
 */
export function trustedFromSetupLink(link: OkLink, serverKey: string, revokedBefore: number | null = null): TrustedConfig {
  if (!verifySetupLink(link, serverKey)) throw new Error('setup link signature does not verify');
  if (setupLinkRevoked(link, revokedBefore)) throw new Error('setup link revoked');
  const p = link.payload;
  return {
    source: 'setup-link',
    serverUrl: new URL(p.server_url).origin,
    organizationId: p.org_id ?? null,
    updateChannel: p.update_channel ?? null,
    spkiPins: parsePins(p.spki_pins ?? []),
    discoveryKey: p.discovery_key && parseEd25519Key(p.discovery_key) ? p.discovery_key : serverKey,
    requireSigned: p.require_signed === true,
    allowPersonal: p.allow_personal !== false,
    lockServer: false,
    expiresAt: new Date(p.exp * 1000).toISOString(),
  };
}
