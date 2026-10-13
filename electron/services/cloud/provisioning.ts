import type { CloudMe, CloudStatus, ProvisioningStatus } from '@shared/cloud';
import type { AuthStage } from '@shared/types';

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
 */

export interface ProvisioningDeps {
  me: () => Promise<CloudMe>;
  status: () => Promise<ProvisioningStatus>;
  retry: () => Promise<ProvisioningStatus>;
  onChange: (cloud: CloudStatus, stage: AuthStage) => void;
  /** The account is ACTIVE: go on to the bootstrap. */
  onActive: (me: CloudMe) => Promise<void>;
  focused: () => boolean;
  now?: () => number;
}

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

export class ProvisioningFlow {
  constructor(private readonly deps: ProvisioningDeps) {}

  /** Starts following the account after sign-in. Stub: does nothing. */
  start(): void {
    void this.deps;
  }

  stop(): void {}

  /** `cloud:retryProvisioning`. Stub: asks Cloud directly. */
  retryNow(): Promise<ProvisioningStatus> {
    return this.deps.retry();
  }
}
