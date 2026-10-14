import { EMPTY_CLOUD_STATUS, type CloudMe, type CloudStatus, type OrgLifecycle, type ProvisioningStatus } from '@shared/cloud';
import type { AuthStage } from '@shared/types';
import { isDesktopError } from '../../main/errors';
import { logger } from '../../main/log';

const log = logger('cloud-provisioning');

/**
 * From tokens to a ready Personal workspace (Connection & Startup §3 "After tokens", screens 4 and 5). [WP3]
 *
 * | account_state                  | stage / behaviour                                                         |
 * | EMAIL_VERIFICATION_PENDING     | `verify-email`: poll /me every 5 s focused, 30 s otherwise; resend in 60 s |
 * | VERIFIED / PROVISIONING        | `provisioning`: poll /provisioning/status from 2 s up to 10 s              |
 * | PROVISIONING_FAILED            | `provisioning` with `retry_at` as a countdown; Retry now; keeps polling    |
 * | ACTIVE                         | bootstrap through `SessionController.afterSignIn`, `X-WS-Org` set          |
 * | SUSPENDED, org RESTRICTED      | `ready` with `readOnly`                                                    |
 * | PENDING_DELETION               | `readOnly` plus a "Cancel deletion" web link                               |
 * | org PAST_DUE / GRACE           | a warning banner only                                                      |
 *
 * Cloud out of reach (no answer, a 5xx) marks the status `unavailable` and asks again, later each time, up to a
 * minute apart; nothing about the account changes because of it.
 */

export interface ProvisioningDeps {
  me: () => Promise<CloudMe>;
  status: () => Promise<ProvisioningStatus>;
  retry: () => Promise<ProvisioningStatus>;
  onChange: (cloud: CloudStatus, stage: AuthStage) => void;
  /** The account is ACTIVE (or read-only, which is ready too): go on to the bootstrap. Once per start. */
  onActive: (me: CloudMe) => Promise<void>;
  focused: () => boolean;
  now?: () => number;
}

export const VERIFY_POLL_FOCUSED_MS = 5_000;
export const VERIFY_POLL_BACKGROUND_MS = 30_000;
export const PROVISION_POLL_MIN_MS = 2_000;
export const PROVISION_POLL_MAX_MS = 10_000;
const UNAVAILABLE_MAX_MS = 60_000;

export const READ_ONLY_MESSAGES = {
  suspended: 'Your workspace is read-only. You can still open and download your files.',
  restricted: 'Your workspace is read-only until the subscription is sorted out. You can still open and download your files.',
  pending_deletion: 'Your account is scheduled for deletion, so your workspace is read-only. You can still open and download your files, or cancel the deletion.',
} as const;

/** The stage for a `/me` answer. */
export function stageFor(me: Pick<CloudMe, 'account_state'>): AuthStage {
  switch (me.account_state) {
    case 'REGISTERED':
    case 'EMAIL_VERIFICATION_PENDING':
      return 'verify-email';
    case 'VERIFIED':
    case 'PROVISIONING':
    case 'PROVISIONING_FAILED':
      return 'provisioning';
    default:
      return 'ready';
  }
}

/** The active organization's lifecycle, when `/me` names one. */
export function orgStateOf(me: CloudMe): OrgLifecycle | null {
  const id = me.active_organization_id;
  return (id ? me.organizations.find((o) => o.id === id)?.state : me.organizations[0]?.state) ?? null;
}

/** Read-only, and why: a suspended account, a restricted organization, or a deletion under way. */
export function readOnlyOf(me: CloudMe): CloudStatus['readOnly'] {
  if (me.account_state === 'PENDING_DELETION') return { reason: 'pending_deletion', message: READ_ONLY_MESSAGES.pending_deletion };
  if (me.account_state === 'SUSPENDED') return { reason: 'suspended', message: READ_ONLY_MESSAGES.suspended };
  if (orgStateOf(me) === 'RESTRICTED') return { reason: 'restricted', message: READ_ONLY_MESSAGES.restricted };
  return null;
}

/** A failure that says Cloud is away, not that anything is wrong with the account. */
export function isUnavailable(e: unknown): boolean {
  if (!isDesktopError(e)) return true;
  return e.code === 'NETWORK_UNREACHABLE' || e.code === 'CLOUD_UNAVAILABLE' || e.code === 'RATE_LIMITED' || (e.code === 'SERVER_ERROR' && (e.status ?? 0) >= 500);
}

export class ProvisioningFlow {
  private status_: CloudStatus = { ...EMPTY_CLOUD_STATUS };
  private stage_: AuthStage | null = null;
  private me_: CloudMe | null = null;
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private activated = false;
  private provisionDelay = PROVISION_POLL_MIN_MS;
  private unavailableDelay = 2_000;
  private activeSeen = 0;
  private epoch = 0;

  constructor(private readonly deps: ProvisioningDeps) {}

  /** Starts following the account after sign-in (or when it becomes active again). */
  start(): void {
    this.stop();
    this.running = true;
    this.activated = false;
    this.provisionDelay = PROVISION_POLL_MIN_MS;
    this.unavailableDelay = 2_000;
    void this.checkMe();
  }

  stop(): void {
    this.running = false;
    this.epoch++;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  status(): CloudStatus {
    return { ...this.status_ };
  }

  stage(): AuthStage | null {
    return this.stage_;
  }

  me(): CloudMe | null {
    return this.me_;
  }

  /** Something said the organization changed (ORG_SUSPENDED, ORG_NOT_FOUND, `cloud:refresh`): /me again, now. */
  refetch(): Promise<void> {
    if (!this.running) return Promise.resolve();
    return this.checkMe();
  }

  /** `cloud:retryProvisioning`: asks Cloud to try again, and polls from 2 s again. */
  async retryNow(): Promise<ProvisioningStatus> {
    const s = await this.deps.retry();
    this.provisionDelay = PROVISION_POLL_MIN_MS;
    this.patch({ provisioning: s, accountState: s.state === 'PROVISIONING_FAILED' ? 'PROVISIONING_FAILED' : s.state === 'ACTIVE' ? this.status_.accountState : 'PROVISIONING' }, 'provisioning');
    if (this.running) this.after(PROVISION_POLL_MIN_MS, () => this.checkStatus());
    return s;
  }

  private patch(p: Partial<CloudStatus>, stage: AuthStage): void {
    this.status_ = { ...this.status_, ...p };
    this.stage_ = stage;
    this.deps.onChange(this.status(), stage);
  }

  private after(ms: number, run: () => Promise<void>): void {
    if (this.timer) clearTimeout(this.timer);
    const epoch = this.epoch;
    this.timer = setTimeout(() => {
      this.timer = null;
      if (this.running && epoch === this.epoch) void run();
    }, ms);
    this.timer.unref?.();
  }

  private away(e: unknown, again: () => Promise<void>): void {
    log.debug('Cloud not answering', { error: String((e as Error)?.message ?? e) });
    if (!this.status_.unavailable) this.patch({ unavailable: true }, this.stage_ ?? 'bootstrapping');
    const delay = this.unavailableDelay;
    this.unavailableDelay = Math.min(UNAVAILABLE_MAX_MS, delay * 2);
    this.after(delay, again);
  }

  private async checkMe(): Promise<void> {
    const epoch = this.epoch;
    let me: CloudMe;
    try {
      me = await this.deps.me();
    } catch (e) {
      if (epoch !== this.epoch) return;
      if (isUnavailable(e)) return this.away(e, () => this.checkMe());
      // Signed out, or refused: the session handles that; nothing more to poll.
      log.info('/me refused', { code: isDesktopError(e) ? e.code : 'unknown' });
      return;
    }
    if (epoch !== this.epoch) return;
    this.unavailableDelay = 2_000;
    this.me_ = me;
    const stage = stageFor(me);
    this.patch({ accountState: me.account_state, orgState: orgStateOf(me), readOnly: readOnlyOf(me), unavailable: false }, stage);
    if (stage === 'verify-email') {
      this.after(this.deps.focused() ? VERIFY_POLL_FOCUSED_MS : VERIFY_POLL_BACKGROUND_MS, () => this.checkMe());
      return;
    }
    if (stage === 'provisioning') return this.checkStatus();
    if (!this.activated) {
      this.activated = true;
      try {
        await this.deps.onActive(me);
      } catch (e) {
        log.warn('workspace bootstrap after Cloud sign-in failed', { error: String((e as Error)?.message ?? e) });
        this.activated = false;
        if (this.running && epoch === this.epoch) this.after(5_000, () => this.checkMe());
      }
    }
  }

  private async checkStatus(): Promise<void> {
    const epoch = this.epoch;
    let s: ProvisioningStatus;
    try {
      s = await this.deps.status();
    } catch (e) {
      if (epoch !== this.epoch) return;
      if (isUnavailable(e)) return this.away(e, () => this.checkStatus());
      log.info('provisioning status refused', { code: isDesktopError(e) ? e.code : 'unknown' });
      return;
    }
    if (epoch !== this.epoch) return;
    this.unavailableDelay = 2_000;
    if (s.state === 'ACTIVE') {
      this.patch({ provisioning: s, unavailable: false }, 'provisioning');
      // /me says ACTIVE (or what else) and takes it from there — at once the first time; if /me still says it is
      // provisioning, a moment later (never a loop between the two).
      this.activeSeen++;
      if (this.activeSeen === 1) return this.checkMe();
      this.after(PROVISION_POLL_MIN_MS, () => this.checkMe());
      return;
    }
    this.activeSeen = 0;
    this.patch({ provisioning: s, accountState: s.state, unavailable: false }, 'provisioning');
    const delay = this.provisionDelay;
    this.provisionDelay = Math.min(PROVISION_POLL_MAX_MS, Math.round(delay * 1.5));
    this.after(s.state === 'PROVISIONING_FAILED' ? PROVISION_POLL_MAX_MS : delay, () => this.checkStatus());
  }
}
