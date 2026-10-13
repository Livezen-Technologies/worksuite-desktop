import type { Bootstrap, DesktopPolicy, MonitoringPolicySummary, Organization, ServerApi } from '@shared/types';
import { isDesktopError } from '../main/errors';
import { logger } from '../main/log';
import type { PublicUser } from './auth';
import { toUserSummary } from './auth';
import type { Database } from './db';
import type { HttpClient } from './http';
import { acceptSignedPolicy, DEFAULT_POLICY, normalizePolicy } from './policy';
import type { Vault } from './vault';

const log = logger('bootstrap');

/**
 * Bootstrap (FR-AUTH-04, WF-02): who the user is, which organizations and
 * apps they have, their permissions and the policy in force.
 *
 * A server with the desktop API answers GET /desktop/v1/bootstrap in one
 * call. The existing WorkSuite API has the same facts spread over a few
 * endpoints, so they are composed here — and nothing is invented: when the
 * server has no answer (no signed policy, no monitoring policy) the field
 * says so.
 *
 * The result is cached encrypted so the app can start offline, read-only,
 * until it revalidates (WF-02 exception path).
 */

interface MeResponse {
  user: PublicUser;
  permissions?: string[] | null;
  apps?: string[] | null;
  /** Apps the person may open only for themselves (their own expense claims); absent on older servers. */
  self_service?: unknown;
}

/** App slugs from a server list (strings, or `{slug}` / `{id}` objects), without the `worksuite.` prefix. */
export function slugsOf(list: unknown): string[] {
  if (!Array.isArray(list)) return [];
  return list
    .map((a) => (typeof a === 'string' ? a : a && typeof a === 'object' ? ((a as { slug?: unknown }).slug ?? (a as { id?: unknown }).id) : null))
    .filter((a): a is string => typeof a === 'string')
    .map((id) => id.replace(/^worksuite\./, ''));
}

function toOrg(o: unknown): Organization | null {
  if (!o || typeof o !== 'object') return null;
  const x = o as { id?: unknown; name?: unknown; role?: unknown };
  if ((typeof x.id !== 'number' && typeof x.id !== 'string') || typeof x.name !== 'string') return null;
  return { id: String(x.id), name: x.name, role: typeof x.role === 'string' && x.role ? x.role.slice(0, 64) : null };
}

/** The media servers a bootstrap announces: absolute wss/https URLs only. */
export function mediaServersOf(media: unknown): string[] {
  const url = media && typeof media === 'object' ? (media as { livekit_url?: unknown }).livekit_url : null;
  if (typeof url !== 'string') return [];
  try {
    const u = new URL(url);
    return ['wss:', 'https:'].includes(u.protocol) ? [`${u.protocol}//${u.host}`] : [];
  } catch {
    return [];
  }
}

export class BootstrapService {
  private current: Bootstrap | null = null;
  private lastValidPolicy: DesktopPolicy | null = null;

  constructor(
    private readonly db: Database,
    private readonly vault: () => Vault,
    private readonly http: HttpClient,
    private readonly policyPublicKey: string | null,
  ) {}

  get(): Bootstrap | null {
    return this.current;
  }

  async fetch(api: ServerApi, organizationId: string | null = null): Promise<Bootstrap> {
    const base = api === 'desktop-v1' ? await this.fetchV1(organizationId) : await this.compose();
    const lic = await this.licence();
    const b: Bootstrap = lic ? { ...base, entitlements: { ...base.entitlements, ...lic.entitlements }, lockedApps: lic.locked } : base;
    this.current = b;
    this.save(b);
    return b;
  }

  /**
   * What the server's WorkSuite licence includes, per app (GET /api/system/entitlements, WorkSuite Server
   * Core 1.7.0+). Fails open: an older server (404), an error or an odd answer leaves every app as it was.
   */
  private async licence(): Promise<{ entitlements: Record<string, boolean>; locked: string[] } | null> {
    try {
      const d = await this.http.get<{ apps?: unknown }>('/api/system/entitlements');
      if (!d || !Array.isArray(d.apps)) return null;
      const entitlements: Record<string, boolean> = {};
      const locked: string[] = [];
      for (const a of d.apps as Array<Record<string, unknown>>) {
        if (typeof a?.app !== 'string') continue;
        entitlements[a.app] = a.entitled !== false;
        if (a.locked === true) locked.push(a.app);
      }
      return { entitlements, locked };
    } catch (e) {
      log.debug('licence entitlements unavailable; every app as the server grants it', { code: isDesktopError(e) ? e.code : String(e) });
      return null;
    }
  }

  private async fetchV1(organizationId: string | null): Promise<Bootstrap> {
    const d = await this.http.get<Record<string, unknown>>('/desktop/v1/bootstrap', { query: { organization_id: organizationId } });
    const user = toUserSummary((d.user ?? {}) as PublicUser);
    const orgs = Array.isArray(d.organizations) ? d.organizations.map(toOrg).filter((o): o is Organization => o !== null) : [];
    const signedPolicy = (d.desktop_policy ?? null) as Record<string, unknown> | null;
    let policy = signedPolicy ? acceptSignedPolicy(signedPolicy, this.policyPublicKey) : null;
    if (!policy) {
      if (signedPolicy) log.warn('POLICY_SIGNATURE_INVALID: keeping the last valid desktop policy');
      policy = this.lastValidPolicy ?? { ...DEFAULT_POLICY };
    }
    this.lastValidPolicy = policy;
    // The server has already applied its gates (installed, enabled, enabled
    // for the organization, licensed, user access); what arrives is the slugs
    // the user may open. An installation that does not gate apps says so.
    const slugs = slugsOf(d.apps);
    const gated = d.apps_gated !== false;
    const mv = (d.minimum_version ?? {}) as Record<string, string>;
    const platformKey = process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'macos' : 'linux';
    const mp = d.monitoring_policy as MonitoringPolicySummary | null;
    return {
      source: 'desktop-v1',
      user,
      organizations: orgs,
      defaultOrganizationId: typeof d.default_organization_id === 'string' ? d.default_organization_id : (orgs[0]?.id ?? null),
      apps: gated ? slugs : null,
      serverApps: gated ? slugs : null,
      selfService: slugsOf(d.self_service),
      permissions: Array.isArray(d.permissions) ? (d.permissions as string[]) : [],
      entitlements: (d.entitlements ?? {}) as Record<string, boolean>,
      featureFlags: (d.feature_flags ?? {}) as Record<string, boolean>,
      policy,
      monitoringPolicy: mp && typeof mp === 'object' && 'id' in mp ? mp : null,
      minimumVersion: typeof mv[platformKey] === 'string' ? mv[platformKey]! : null,
      realtimeEndpoint: typeof d.realtime_endpoint === 'string' ? d.realtime_endpoint : null,
      mediaServers: mediaServersOf(d.media),
      cachedAt: new Date().toISOString(),
      offline: false,
    };
  }

  private async organizations(me: MeResponse): Promise<Organization[]> {
    const perms = me.permissions ?? [];
    if (perms.includes('*') || perms.includes('directory.view')) {
      try {
        const list = await this.http.get<unknown>('/api/directory/organizations');
        const orgs = (Array.isArray(list) ? list : []).map(toOrg).filter((o): o is Organization => o !== null);
        if (orgs.length) return orgs;
      } catch (e) {
        log.debug('directory organizations unavailable', { code: isDesktopError(e) ? e.code : String(e) });
      }
    }
    try {
      const data = await this.http.get<{ organizations?: unknown[] }>('/api/tasks/organizations');
      const orgs = (data.organizations ?? []).map(toOrg).filter((o): o is Organization => o !== null);
      if (orgs.length) return orgs;
    } catch (e) {
      log.debug('task organizations unavailable', { code: isDesktopError(e) ? e.code : String(e) });
    }
    const u = toUserSummary(me.user);
    return u.organizationName ? [{ id: u.organizationId ?? 'default', name: u.organizationName }] : [];
  }

  private async compose(): Promise<Bootstrap> {
    const me = await this.http.get<MeResponse>('/api/auth/me');
    const user = toUserSummary(me.user);
    const organizations = await this.organizations(me);

    // The sync policy is the one device policy this API has. It is served
    // over the authenticated session, not signed, and is recorded as such.
    let policy: DesktopPolicy = { ...DEFAULT_POLICY };
    try {
      const sp = await this.http.get<Record<string, unknown>>('/api/sync/policy');
      policy = normalizePolicy({ allow_offline: sp.allow_offline }, false);
    } catch (e) {
      log.debug('sync policy unavailable; using defaults', { code: isDesktopError(e) ? e.code : String(e) });
    }

    const ownOrg = user.organizationId && organizations.some((o) => o.id === user.organizationId) ? user.organizationId : null;
    return {
      source: 'core',
      user,
      organizations,
      defaultOrganizationId: ownOrg,
      apps: me.apps === null || me.apps === undefined ? null : me.apps.includes('*') ? '*' : me.apps,
      serverApps: null,
      selfService: slugsOf(me.self_service),
      permissions: me.permissions ?? [],
      entitlements: {},
      featureFlags: {},
      policy,
      monitoringPolicy: null,
      minimumVersion: null,
      realtimeEndpoint: null,
      cachedAt: new Date().toISOString(),
      offline: false,
    };
  }

  private save(b: Bootstrap): void {
    this.db.run(
      'INSERT INTO sessions (user_id, bootstrap, cached_at) VALUES (?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET bootstrap = excluded.bootstrap, cached_at = excluded.cached_at',
      b.user.id,
      this.vault().encrypt(b),
      b.cachedAt,
    );
  }

  /** The cached bootstrap, flagged offline, for an offline start. */
  loadCached(userId: string): Bootstrap | null {
    const row = this.db.get<{ bootstrap: string }>('SELECT bootstrap FROM sessions WHERE user_id = ?', userId);
    const b = row ? this.vault().decrypt<Bootstrap>(row.bootstrap) : undefined;
    if (!b) return null;
    // A copy saved before servers said which apps are self-service has none.
    this.current = { ...b, selfService: b.selfService ?? [], offline: true };
    this.lastValidPolicy = b.policy;
    return this.current;
  }

  /** The last signed-in user, for resuming a session at start-up. */
  lastUserId(): string | null {
    return this.db.getConfig<string>('last-user') ?? null;
  }

  setLastUser(userId: string | null): void {
    if (userId) this.db.setConfig('last-user', userId);
    else this.db.deleteConfig('last-user');
  }

  applyPolicyPatch(patch: Partial<DesktopPolicy>): void {
    if (!this.current) return;
    this.current = { ...this.current, policy: { ...this.current.policy, ...patch } };
  }

  clear(userId: string): void {
    this.db.run('DELETE FROM sessions WHERE user_id = ?', userId);
    this.current = null;
  }
}
