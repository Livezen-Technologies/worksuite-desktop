import { cleanIds, PIN_MAX } from '@shared/launcher';
import { DesktopError } from '../main/errors';

/**
 * The organization's app launcher defaults (worksuite-desktop#201): the pinned apps and the order of the grid for
 * everyone in it who has not chosen their own. They are two keys of the organization's desktop policy
 * (`launcher_pinned`, `launcher_order`), so they reach every device in the bootstrap the policy already rides in,
 * and they are set where an administrator sets the rest of it: `PUT /desktop/v1/admin/policies/organization:{id}`,
 * which needs `desktop.policies.manage` there.
 *
 * That endpoint replaces the scope's whole policy, so the organization's other keys are read first and kept.
 */
export interface PolicyHttp {
  get<T = unknown>(path: string): Promise<T>;
  request<T = unknown>(method: string, path: string, opts?: { body?: unknown }): Promise<T>;
}

interface PolicyRow {
  scope?: string;
  scope_id?: number | string;
  policy?: Record<string, unknown>;
}

export interface LauncherDefaults {
  pinned: string[];
  order: string[];
}

export async function saveLauncherDefaults(http: PolicyHttp, organizationId: string, wanted: LauncherDefaults): Promise<LauncherDefaults> {
  if (!/^\d{1,12}$/.test(organizationId)) throw new DesktopError('IPC_VALIDATION_FAILED', 'Choose an organization first.');
  const pinned = cleanIds(wanted.pinned, PIN_MAX);
  const order = cleanIds(wanted.order, 300);
  const listed = await http.get<{ policies?: PolicyRow[] }>('/desktop/v1/admin/policies');
  const row = (listed?.policies ?? []).find((p) => p.scope === 'organization' && String(p.scope_id) === organizationId);
  const policy: Record<string, unknown> = { ...(row?.policy ?? {}) };
  // Empty is "no default": the key goes, rather than an empty list standing for one.
  if (pinned.length) policy.launcher_pinned = pinned;
  else delete policy.launcher_pinned;
  if (order.length) policy.launcher_order = order;
  else delete policy.launcher_order;
  await http.request('PUT', `/desktop/v1/admin/policies/organization:${organizationId}`, { body: { policy } });
  return { pinned, order };
}
