import { DesktopError } from '../../main/errors';
import { CLOUD_API, type CloudMe, type CloudPlan, type ProvisioningStatus, type StorageUsage } from '@shared/cloud';
import { errorFromResponse, type HttpClient } from '../http';

/**
 * WorkSuite Cloud's REST API for the active Personal account (Connection & Startup §3; paths in shared/cloud.ts
 * `CLOUD_API`). [WP3] Requests go through the account's `HttpClient`, so tokens, `X-WS-Org` and the error mapping
 * (QUOTA_EXCEEDED, ORG_SUSPENDED, ORG_NOT_FOUND) are the usual ones. Answers are checked for their shape before
 * anything reads them: a server answering something else is SERVER_ERROR, never a crash.
 */
export class CloudApi {
  constructor(private readonly http: () => HttpClient | null) {}

  private client(): HttpClient {
    const h = this.http();
    if (!h) throw new DesktopError('NOT_SIGNED_IN', 'Sign in to WorkSuite Cloud first.');
    return h;
  }

  async me(): Promise<CloudMe> {
    const me = await this.client().get<CloudMe>(CLOUD_API.me);
    if (!me || typeof me !== 'object' || typeof me.account_state !== 'string' || !me.identity) throw bad('account');
    return { ...me, organizations: Array.isArray(me.organizations) ? me.organizations : [], active_organization_id: me.active_organization_id ?? null, onboarding: me.onboarding ?? { complete: false } };
  }

  async provisioningStatus(): Promise<ProvisioningStatus> {
    return provisioning(await this.client().get<ProvisioningStatus>(CLOUD_API.provisioningStatus));
  }

  async retryProvisioning(): Promise<ProvisioningStatus> {
    return provisioning(await this.client().post<ProvisioningStatus>(CLOUD_API.provisioningRetry, {}));
  }

  async storageUsage(): Promise<StorageUsage> {
    const u = await this.client().get<StorageUsage>(CLOUD_API.storageUsage);
    if (!u || typeof u !== 'object' || !Number.isFinite(Number(u.used)) || !Number.isFinite(Number(u.limit))) throw bad('storage usage');
    return {
      limit: Number(u.limit),
      used: Number(u.used),
      reserved: Number(u.reserved) || 0,
      categories: (Array.isArray(u.categories) ? u.categories : [])
        .filter((c) => c && typeof c.key === 'string')
        .slice(0, 32)
        .map((c) => ({ key: c.key, bytes: Number(c.bytes) || 0, ...(c.label ? { label: String(c.label) } : {}), ...(c.policy ? { policy: String(c.policy) } : {}) })),
      largest: (Array.isArray(u.largest) ? u.largest : [])
        .filter((f) => f && typeof f.name === 'string')
        .slice(0, 50)
        .map((f) => ({ id: String(f.id), name: f.name, bytes: Number(f.bytes) || 0 })),
    };
  }

  /** The compact JWS for `organizationId` (answered as `application/jose`, or JSON `{entitlements|jws|token}`). */
  async entitlements(organizationId: string): Promise<string> {
    const h = this.client();
    const res = await h.raw('GET', h.url(CLOUD_API.entitlements, { organization_id: organizationId }), { headers: { Accept: 'application/jose, application/json' } });
    const text = await res.text().catch(() => '');
    if (!res.ok) {
      let body: unknown = null;
      try {
        body = JSON.parse(text);
      } catch {
        // Not JSON.
      }
      throw errorFromResponse(res.status, body as never, res.headers.get('retry-after'));
    }
    const trimmed = text.trim();
    if (/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(trimmed)) return trimmed;
    try {
      const j = JSON.parse(trimmed) as Record<string, unknown>;
      const inner = (j.data && typeof j.data === 'object' ? j.data : j) as Record<string, unknown>;
      const jws = inner.entitlements ?? inner.jws ?? inner.token;
      if (typeof jws === 'string') return jws.trim();
    } catch {
      // Neither.
    }
    throw bad('entitlements');
  }

  async plans(): Promise<CloudPlan[]> {
    const list = await this.client().get<CloudPlan[] | { plans?: CloudPlan[] }>(CLOUD_API.plans);
    const arr = Array.isArray(list) ? list : Array.isArray(list?.plans) ? list.plans : [];
    return arr
      .filter((p) => p && typeof p.id === 'string' && typeof p.name === 'string')
      .slice(0, 20)
      .map((p) => ({ id: p.id, name: p.name, storage_bytes: Number(p.storage_bytes) || 0, price: p.price ?? null }));
  }
}

function bad(what: string): DesktopError {
  return new DesktopError('SERVER_ERROR', `WorkSuite Cloud answered an unexpected ${what} document.`);
}

function provisioning(s: ProvisioningStatus | null): ProvisioningStatus {
  if (!s || typeof s !== 'object' || !['PROVISIONING', 'PROVISIONING_FAILED', 'ACTIVE'].includes(s.state)) throw bad('provisioning status');
  return { state: s.state, step: String(s.step ?? ''), attempts: Number(s.attempts) || 0, retry_at: typeof s.retry_at === 'string' ? s.retry_at : null };
}
