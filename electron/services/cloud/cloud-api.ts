import { DesktopError } from '../../main/errors';
import { CLOUD_API, type AccountDeletion, type CloudInvitations, type CloudTwoStep, type CloudMe, type CloudPlan, type ProvisioningStatus, type StorageUsage } from '@shared/cloud';
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

  /** What is known about this account being deleted: when, what is in the way, and where it can be called off. */
  async deletionState(): Promise<AccountDeletion> {
    const d = await this.client().get<AccountDeletion>(CLOUD_API.accountDeletion);
    if (!d || typeof d !== 'object') throw bad('account deletion');
    return { scheduled_for: d.scheduled_for ?? null, requested_at: d.requested_at ?? null, blockers: Array.isArray(d.blockers) ? d.blockers.slice(0, 20) : [], cancel_url: String(d.cancel_url ?? '') };
  }

  /** Begin deleting this account. Everything is removed after the server's grace period, not now. */
  async requestDeletion(confirm: string, password: string): Promise<{ scheduledFor: string; cancelUrl: string }> {
    const d = await this.client().post<{ scheduled_for?: string; cancel_url?: string }>(CLOUD_API.accountDeletion, { confirm, password });
    if (!d?.scheduled_for) throw bad('account deletion');
    return { scheduledFor: d.scheduled_for, cancelUrl: String(d.cancel_url ?? '') };
  }

  /** Invitations to organisations waiting for this person (and organisations they may ask to join). */
  async invitations(): Promise<CloudInvitations> {
    const d = await this.client().get<CloudInvitations>(CLOUD_API.invitations);
    if (!d || typeof d !== 'object' || !Array.isArray(d.invitations)) throw bad('invitations');
    return {
      invitations: d.invitations
        .filter((i) => i && typeof i.id === 'string' && typeof i.organization === 'string')
        .slice(0, 50)
        .map((i) => ({ id: i.id, organization: i.organization, role: String(i.role ?? 'MEMBER'), invitedBy: i.invitedBy ? String(i.invitedBy) : null, expiresAt: i.expiresAt ? String(i.expiresAt) : null })),
      joinable: (Array.isArray(d.joinable) ? d.joinable : []).filter((a) => a && typeof a.id === 'string').slice(0, 50).map((a) => ({ id: a.id, name: String(a.name ?? ''), requested: !!a.requested })),
    };
  }

  /** Join the organisation of invitation `id` (from the list) or of an emailed invitation `token`. */
  async acceptInvitation(by: { id: string } | { token: string }): Promise<{ id: string; name: string }> {
    const d = await this.client().post<{ organization?: { id?: string; name?: string } }>(CLOUD_API.invitationAccept, by);
    if (!d?.organization?.id) throw bad('invitation');
    return { id: String(d.organization.id), name: String(d.organization.name ?? '') };
  }

  async declineInvitation(id: string): Promise<void> {
    await this.client().post(`${CLOUD_API.invitations}/${encodeURIComponent(id)}/decline`, {});
  }

  /** Two-step verification of the signed-in person (Cloud's own; every change needs the password or a code). */
  async twoStep(): Promise<CloudTwoStep> {
    return twoStepOf(await this.client().get<CloudTwoStep>(CLOUD_API.twoStep));
  }

  async twoStepStart(proof: { password?: string; code?: string }): Promise<{ secret: string; uri: string }> {
    const d = await this.client().post<{ secret?: string; uri?: string }>(`${CLOUD_API.twoStep}/start`, proof);
    if (!d?.uri || !d.secret) throw bad('two-step');
    return { secret: d.secret, uri: d.uri };
  }

  async twoStepConfirm(code: string): Promise<CloudTwoStep & { recoveryCodes: string[] }> {
    const d = await this.client().post<CloudTwoStep & { recoveryCodes?: string[] }>(`${CLOUD_API.twoStep}/confirm`, { code });
    return { ...twoStepOf(d), recoveryCodes: Array.isArray(d?.recoveryCodes) ? d.recoveryCodes.map(String).slice(0, 20) : [] };
  }

  async twoStepRecoveryCodes(proof: { password?: string; code?: string }): Promise<CloudTwoStep & { recoveryCodes: string[] }> {
    const d = await this.client().post<CloudTwoStep & { recoveryCodes?: string[] }>(`${CLOUD_API.twoStep}/recovery-codes`, proof);
    return { ...twoStepOf(d), recoveryCodes: Array.isArray(d?.recoveryCodes) ? d.recoveryCodes.map(String).slice(0, 20) : [] };
  }

  async twoStepDisable(proof: { password?: string; code?: string }): Promise<CloudTwoStep> {
    return twoStepOf(await this.client().post<CloudTwoStep>(`${CLOUD_API.twoStep}/disable`, proof));
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

function twoStepOf(d: CloudTwoStep | null | undefined): CloudTwoStep {
  if (!d || typeof d !== 'object' || typeof d.enabled !== 'boolean') throw bad('two-step');
  return { enabled: d.enabled, enabledAt: d.enabledAt ? String(d.enabledAt) : null, recoveryCodesLeft: Number(d.recoveryCodesLeft) || 0 };
}
