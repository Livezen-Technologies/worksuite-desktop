/**
 * WorkSuite Office Local AI policy, passed through to the computer (Local AI spec W10).
 *
 * The organisation sets the policy in the Admin Center (server Ai 1.19.0). This app fetches the effective policy for
 * the signed-in person's company and writes it where WorkSuite Office's local `worksuite-ai` service reads managed
 * configuration; the service then serves it at `GET /v1/policy` and enforces it:
 *
 *   macOS    user defaults, domain `lk.worksuite.office`, `AI*` keys (`AIManaged`, `AIFeatureStt` …, `AIPolicy` JSON)
 *   Windows  HKCU\Software\Policies\WorkSuite\Office\AI (REG_DWORD flags, REG_SZ URL, REG_MULTI_SZ models, `Policy` JSON)
 *   Linux    ~/.config/worksuite/office/policy.json ($XDG_CONFIG_HOME respected), mode 0600, `{ ai: … }`
 *
 * Every location carries `Source = worksuite-desktop`. What an administrator deployed by MDM or Group Policy is
 * never overwritten or removed: a location whose source is something else is left alone and reported. The service
 * itself should prefer machine-wide managed locations (Managed Preferences, HKLM) over these per-user ones.
 *
 * Nothing here decides anything: the server computed the policy; an answer that is not the exact `GET /v1/policy`
 * shape is refused rather than "fixed", and the last good policy stays in place. Signing out removes what this app
 * wrote, so the next person on the computer is not governed by the previous person's company.
 */

export const OFFICE_AI_FEATURES = ['stt', 'suggestions', 'correction', 'translate', 'tts', 'assistant'] as const;
export type OfficeAiFeature = (typeof OFFICE_AI_FEATURES)[number];

/** The local service's `GET /v1/policy` shape (plus the additive `offlineOnly`). */
export interface OfficeAiPolicy {
  managed: boolean;
  features: Record<OfficeAiFeature, boolean>;
  cloudAllowed: boolean;
  approvedModels: string[];
  maxMemMB: number | null;
  gpuAllowed: boolean;
  orgDictionaryUrl: string | null;
  offlineOnly: boolean;
}

export const SOURCE = 'worksuite-desktop';
export const MAC_DOMAIN = 'lk.worksuite.office';
export const WIN_KEY = 'HKCU\\Software\\Policies\\WorkSuite\\Office\\AI';

const MODEL_ID = /^[a-z0-9][a-z0-9._-]{0,79}$/;

/** The policy if it is exactly the expected shape, else null. */
export function parseOfficeAiPolicy(raw: unknown): OfficeAiPolicy | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const f = r.features as Record<string, unknown> | undefined;
  if (typeof r.managed !== 'boolean' || !f || typeof f !== 'object') return null;
  if (!OFFICE_AI_FEATURES.every((k) => typeof f[k] === 'boolean')) return null;
  for (const k of ['cloudAllowed', 'gpuAllowed'] as const) if (typeof r[k] !== 'boolean') return null;
  if (r.offlineOnly !== undefined && typeof r.offlineOnly !== 'boolean') return null;
  if (!Array.isArray(r.approvedModels) || !r.approvedModels.every((m) => typeof m === 'string' && MODEL_ID.test(m))) return null;
  if (r.maxMemMB !== null && !(Number.isInteger(r.maxMemMB) && (r.maxMemMB as number) > 0)) return null;
  const url = r.orgDictionaryUrl;
  if (url !== null && !(typeof url === 'string' && /^https:\/\//i.test(url))) return null;
  return {
    managed: r.managed,
    features: Object.fromEntries(OFFICE_AI_FEATURES.map((k) => [k, f[k] as boolean])) as Record<OfficeAiFeature, boolean>,
    cloudAllowed: r.cloudAllowed as boolean,
    approvedModels: [...(r.approvedModels as string[])],
    maxMemMB: r.maxMemMB as number | null,
    gpuAllowed: r.gpuAllowed as boolean,
    orgDictionaryUrl: url as string | null,
    offlineOnly: (r.offlineOnly as boolean | undefined) ?? false,
  };
}

const cap = (k: string) => k.charAt(0).toUpperCase() + k.slice(1);

/** `defaults write` invocations for macOS (one per key; `defaults` has no batch form). */
export function macCommands(p: OfficeAiPolicy): string[][] {
  const w = (key: string, type: string, ...vals: string[]) => ['write', MAC_DOMAIN, key, type, ...vals];
  const out: string[][] = [
    w('AISource', '-string', SOURCE),
    w('AIManaged', '-bool', String(p.managed)),
    ...OFFICE_AI_FEATURES.map((k) => w(`AIFeature${cap(k)}`, '-bool', String(p.features[k]))),
    w('AICloudAllowed', '-bool', String(p.cloudAllowed)),
    w('AIGpuAllowed', '-bool', String(p.gpuAllowed)),
    w('AIOfflineOnly', '-bool', String(p.offlineOnly)),
    w('AIApprovedModels', '-array', ...p.approvedModels),
    w('AIMaxMemMB', '-int', String(p.maxMemMB ?? 0)),
    w('AIOrgDictionaryUrl', '-string', p.orgDictionaryUrl ?? ''),
    w('AIPolicy', '-string', JSON.stringify(p)),
  ];
  return out;
}

export const MAC_KEYS = ['AISource', 'AIManaged', ...OFFICE_AI_FEATURES.map((k) => `AIFeature${cap(k)}`), 'AICloudAllowed', 'AIGpuAllowed', 'AIOfflineOnly', 'AIApprovedModels', 'AIMaxMemMB', 'AIOrgDictionaryUrl', 'AIPolicy'];

/** `reg add` invocations for Windows. `MaxMemMB` 0 is no cap; models are REG_MULTI_SZ (`\0`-separated for reg.exe). */
export function winCommands(p: OfficeAiPolicy): string[][] {
  const add = (name: string, type: string, data: string) => ['add', WIN_KEY, '/v', name, '/t', type, '/d', data, '/f'];
  const dw = (b: boolean) => (b ? '1' : '0');
  return [
    add('Source', 'REG_SZ', SOURCE),
    add('Managed', 'REG_DWORD', dw(p.managed)),
    ...OFFICE_AI_FEATURES.map((k) => add(`Feature${cap(k)}`, 'REG_DWORD', dw(p.features[k]))),
    add('CloudAllowed', 'REG_DWORD', dw(p.cloudAllowed)),
    add('GpuAllowed', 'REG_DWORD', dw(p.gpuAllowed)),
    add('OfflineOnly', 'REG_DWORD', dw(p.offlineOnly)),
    add('ApprovedModels', 'REG_MULTI_SZ', p.approvedModels.join('\\0')),
    add('MaxMemMB', 'REG_DWORD', String(p.maxMemMB ?? 0)),
    add('OrgDictionaryUrl', 'REG_SZ', p.orgDictionaryUrl ?? ''),
    add('Policy', 'REG_SZ', JSON.stringify(p)),
  ];
}

export function linuxPolicyPath(env: Record<string, string | undefined>, home: string): string {
  const base = env.XDG_CONFIG_HOME && env.XDG_CONFIG_HOME.startsWith('/') ? env.XDG_CONFIG_HOME : `${home}/.config`;
  return `${base}/worksuite/office/policy.json`;
}

export interface OfficeAiPolicyDeps {
  platform: NodeJS.Platform;
  env: Record<string, string | undefined>;
  home: string;
  /** GET /api/ai/office-policy on the signed-in server (the envelope's `data`). Throws on 404 / network errors. */
  fetchPolicy: () => Promise<unknown>;
  /** Runs a program (`defaults`, `reg`) and resolves with its stdout. */
  run: (file: string, args: string[]) => Promise<string>;
  readFile: (path: string) => Promise<string | null>;
  /** Writes atomically (temp file + rename) with the given mode, creating parent folders. */
  writeFile: (path: string, data: string, mode: number) => Promise<void>;
  removeFile: (path: string) => Promise<void>;
  log: { info: (m: string, d?: Record<string, unknown>) => void; warn: (m: string, d?: Record<string, unknown>) => void };
}

export type SyncResult = { status: 'written' | 'cleared' | 'unchanged' | 'kept' | 'skipped-managed-elsewhere' | 'unsupported'; reason?: string };

export class OfficeAiPolicySync {
  private last: string | null = null;

  constructor(private readonly d: OfficeAiPolicyDeps) {}

  /** Fetch the effective policy and write it; an unmanaged company clears what this app wrote before. */
  async sync(): Promise<SyncResult> {
    let raw: unknown;
    try {
      raw = await this.d.fetchPolicy();
    } catch (e) {
      // An older server (no endpoint) or no network: the last policy written stays in force.
      this.d.log.info('office AI policy unavailable; keeping what is in place', { error: String((e as Error)?.message ?? e) });
      return { status: 'kept', reason: 'unavailable' };
    }
    const policy = parseOfficeAiPolicy(raw);
    if (!policy) {
      this.d.log.warn('office AI policy has an unexpected shape; keeping what is in place');
      return { status: 'kept', reason: 'invalid' };
    }
    if (!policy.managed) return this.clear();
    const key = JSON.stringify(policy);
    if (key === this.last) return { status: 'unchanged' };
    const r = await this.write(policy);
    if (r.status === 'written') this.last = key;
    return r;
  }

  /** Remove what this app wrote (sign-out, unmanaged company). MDM-deployed policy is left alone. */
  async clear(): Promise<SyncResult> {
    this.last = null;
    if (!(await this.ours())) return { status: 'skipped-managed-elsewhere' };
    try {
      switch (this.d.platform) {
        case 'darwin':
          for (const k of MAC_KEYS) await this.d.run('defaults', ['delete', MAC_DOMAIN, k]).catch(() => undefined);
          break;
        case 'win32':
          await this.d.run('reg', ['delete', WIN_KEY, '/f']).catch(() => undefined);
          break;
        case 'linux':
          await this.d.removeFile(linuxPolicyPath(this.d.env, this.d.home));
          break;
        default:
          return { status: 'unsupported' };
      }
    } catch (e) {
      this.d.log.warn('office AI policy could not be cleared', { error: String((e as Error)?.message ?? e) });
    }
    return { status: 'cleared' };
  }

  private async write(p: OfficeAiPolicy): Promise<SyncResult> {
    if (!(await this.ours())) {
      this.d.log.info('office AI policy is deployed by the organisation’s device management; not overwriting it');
      return { status: 'skipped-managed-elsewhere' };
    }
    try {
      switch (this.d.platform) {
        case 'darwin':
          for (const args of macCommands(p)) await this.d.run('defaults', args);
          break;
        case 'win32':
          for (const args of winCommands(p)) await this.d.run('reg', args);
          break;
        case 'linux':
          await this.d.writeFile(
            linuxPolicyPath(this.d.env, this.d.home),
            `${JSON.stringify({ schema: 1, source: SOURCE, updatedAt: new Date().toISOString(), ai: p }, null, 2)}\n`,
            0o600,
          );
          break;
        default:
          return { status: 'unsupported' };
      }
    } catch (e) {
      // HKCU\Software\Policies is read-only for standard users on some Windows builds; reported, not retried in a loop.
      this.d.log.warn('office AI policy could not be written', { error: String((e as Error)?.message ?? e) });
      return { status: 'kept', reason: 'write-failed' };
    }
    this.d.log.info('office AI policy written', { platform: this.d.platform, models: p.approvedModels.length });
    return { status: 'written' };
  }

  /** Whether the location is empty or was written by this app (and so may be written or cleared). */
  private async ours(): Promise<boolean> {
    try {
      switch (this.d.platform) {
        case 'darwin': {
          const v = await this.d.run('defaults', ['read', MAC_DOMAIN, 'AISource']).catch(() => null);
          if (v !== null && v.trim() !== '' && v.trim() !== SOURCE) return false;
          const managed = await this.d.run('defaults', ['read', MAC_DOMAIN, 'AIManaged']).catch(() => null);
          return v !== null || managed === null;
        }
        case 'win32': {
          const out = await this.d.run('reg', ['query', WIN_KEY, '/v', 'Source']).catch(() => null);
          if (out === null) {
            const any = await this.d.run('reg', ['query', WIN_KEY]).catch(() => null);
            return any === null || !/REG_/.test(any);
          }
          return out.includes(SOURCE);
        }
        case 'linux': {
          const txt = await this.d.readFile(linuxPolicyPath(this.d.env, this.d.home));
          if (txt === null) return true;
          try {
            return (JSON.parse(txt) as { source?: unknown }).source === SOURCE;
          } catch {
            return false;
          }
        }
        default:
          return false;
      }
    } catch {
      return false;
    }
  }
}
