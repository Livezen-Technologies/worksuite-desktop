import { DesktopError } from '../../main/errors';
import type { CloudMe, CloudPlan, ProvisioningStatus, StorageUsage } from '@shared/cloud';
import type { HttpClient } from '../http';

/**
 * WorkSuite Cloud's REST API for the active Personal account (Connection & Startup §3; paths in shared/cloud.ts
 * `CLOUD_API`). [WP3] Requests go through the account's `HttpClient`, so tokens, `X-WS-Org` and the error mapping
 * (QUOTA_EXCEEDED, ORG_SUSPENDED, ORG_NOT_FOUND) are the usual ones.
 */
export class CloudApi {
  constructor(private readonly http: () => HttpClient | null) {}

  me(): Promise<CloudMe> {
    return this.unsupported();
  }

  provisioningStatus(): Promise<ProvisioningStatus> {
    return this.unsupported();
  }

  retryProvisioning(): Promise<ProvisioningStatus> {
    return this.unsupported();
  }

  storageUsage(): Promise<StorageUsage> {
    return this.unsupported();
  }

  /** The compact JWS for `organizationId`. */
  entitlements(_organizationId: string): Promise<string> {
    return this.unsupported();
  }

  plans(): Promise<CloudPlan[]> {
    return this.unsupported();
  }

  private unsupported<T>(): Promise<T> {
    void this.http;
    return Promise.reject(new DesktopError('UNSUPPORTED', 'WorkSuite Cloud is not available in this version.'));
  }
}
