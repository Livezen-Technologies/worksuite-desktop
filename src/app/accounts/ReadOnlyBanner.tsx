import type { CloudStatus } from '@shared/cloud';
import { app } from '../../core/app-state';
import { call } from '../../core/bridge';
import { useStore } from '../../core/store';
import { Icon } from '../../components/Icon';
import { StorageBanner } from '../../modules/account/Storage';

/**
 * A Personal account's standing, across the top of the workspace (Connection & Startup §3, screen 5's states):
 *
 * - read-only (account SUSPENDED, organization RESTRICTED, PENDING_DELETION): a persistent banner — files still open
 *   and download, nothing new goes up; a deletion under way offers "Cancel deletion";
 * - organization PAST_DUE / GRACE: a warning only, everything still works;
 * - storage at 95 % or full: the storage banner (screen 12).
 *
 * Nothing for an Enterprise account, or a Personal one in good standing. The store's `cloud` (`cloud:changed`) is
 * read unless one is passed.
 */
export function ReadOnlyBanner({ cloud: given }: { cloud?: CloudStatus | null }) {
  const personal = useStore(app, (s) => s.auth?.account?.kind === 'personal');
  const fromStore = useStore(app, (s) => s.cloud ?? s.auth?.cloud ?? null);
  const readOnlyAuth = useStore(app, (s) => s.auth?.readOnly ?? null);
  const cloud = given !== undefined ? given : personal ? fromStore : null;
  if (!cloud) return null;
  const readOnly = cloud.readOnly ?? readOnlyAuth;
  const open = (page: 'support' | 'privacy' | 'upgrade') => void call('cloud:openWeb', { page }).catch(() => undefined);

  if (readOnly) {
    return (
      <div role="status" data-testid="read-only-banner" className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-warning/40 bg-warning-bg px-6 py-2.5 text-[13.5px] text-warning-ink">
        <Icon name="lock" size={16} className="shrink-0" />
        <b className="font-bold">{readOnly.reason === 'pending_deletion' ? 'Deletion scheduled' : 'Your workspace is read-only.'}</b>
        <span className="min-w-[200px] flex-1">{readOnly.message}</span>
        {readOnly.reason === 'pending_deletion' ? (
          <button type="button" onClick={() => open('privacy')} className="font-bold underline">
            Cancel deletion
          </button>
        ) : null}
        <button type="button" onClick={() => open('support')} className="font-semibold underline">
          Contact support
        </button>
      </div>
    );
  }
  if (cloud.orgState === 'PAST_DUE' || cloud.orgState === 'GRACE') {
    return (
      <div role="status" data-testid="billing-banner" className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-warning/40 bg-warning-bg px-6 py-2.5 text-[13.5px] text-warning-ink">
        <Icon name="warning" size={16} className="shrink-0" />
        <span className="min-w-[200px] flex-1">
          {cloud.orgState === 'GRACE' ? 'Your subscription has lapsed. Your workspace keeps working for now — renew it to avoid interruptions.' : 'Your last payment did not go through. Update your payment details to keep your workspace.'}
        </span>
        <button type="button" onClick={() => open('upgrade')} className="font-bold underline">
          Manage subscription
        </button>
      </div>
    );
  }
  return <StorageBanner storage={cloud.storage} />;
}
