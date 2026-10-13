import { useId, useState } from 'react';
import type { AccountView } from '@shared/accounts';
import { app } from '../../core/app-state';
import { call, errorMessage } from '../../core/bridge';
import { toast } from '../../core/toasts';
import { Checkbox } from '../../components/Checkbox';
import { Icon } from '../../components/Icon';
import { Button, Modal } from '../../components/ui';
import { accountName, changes, hostOf } from './labels';

export interface RemoveAccountDialogProps {
  account: AccountView;
  onClose: () => void;
}

/**
 * Remove from this device (screen 14's footer, Settings › Accounts & Servers): the account's sign-in, its data on this
 * computer and its local settings go; the account and its data on the server stay. Changes not on the server yet are
 * named, and removing needs an explicit tick when there are any (Export them first from Sign out). Not offered for an
 * account IT set up ("Removal set by IT policy"). Deleting a WorkSuite Cloud account is another action, on the web.
 */
export function RemoveAccountDialog({ account, onClose }: RemoveAccountDialogProps) {
  const titleId = useId();
  const [keepOffline, setKeepOffline] = useState(false);
  const [understood, setUnderstood] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const name = accountName(account);
  const pending = account.pendingChanges;
  const blocked = !account.removable;

  const remove = async () => {
    setBusy(true);
    setError(null);
    try {
      const next = await call('accounts:remove', { accountId: account.id, keepOfflineFiles: keepOffline });
      app.set({ accounts: next });
      toast('success', `${name} was removed from this computer.`);
      onClose();
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  };

  return (
    <Modal
      width={480}
      onClose={onClose}
      labelledBy={titleId}
      title={`Remove ${name} from this device?`}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          {blocked ? null : (
            <Button variant="danger" loading={busy} disabled={pending > 0 && !understood} onClick={() => void remove()}>
              Remove from this device
            </Button>
          )}
        </>
      }
    >
      <div className="flex flex-col gap-3 text-[13.5px] text-ink-2">
        <p className="m-0">
          <b className="text-ink">{account.user?.email ?? hostOf(account.serverOrigin)}</b> is signed out on this computer, and its cached data, drafts and settings here are removed. Your account and its data on the server are not deleted, and your other accounts are not touched.
        </p>
        {blocked ? (
          <p className="m-0 flex items-start gap-2 rounded-[10px] bg-subtle px-3 py-2.5 text-ink">
            <Icon name="lock" size={15} className="mt-0.5 shrink-0" />
            {account.removalReason ?? 'Removal set by IT policy.'}
          </p>
        ) : (
          <>
            <label className="flex cursor-pointer items-start gap-2.5 text-ink">
              <Checkbox checked={keepOffline} onChange={(e) => setKeepOffline(e.target.checked)} className="mt-0.5" />
              Keep offline files on this computer
            </label>
            {pending > 0 ? (
              <div className="flex flex-col gap-2 rounded-[10px] bg-danger-bg px-3 py-2.5 text-danger">
                <span>
                  <b>{changes(pending)} on this computer haven’t reached the server.</b> Removing the account removes them too. Sign out keeps them, and can export them first.
                </span>
                <label className="flex cursor-pointer items-start gap-2.5 text-ink">
                  <Checkbox checked={understood} onChange={(e) => setUnderstood(e.target.checked)} className="mt-0.5" />
                  Remove them with the account
                </label>
              </div>
            ) : null}
          </>
        )}
        {account.kind === 'personal' ? (
          <p className="m-0 text-[12.5px] text-ink-3">
            Want to delete your WorkSuite Cloud account itself?{' '}
            <button type="button" className="font-semibold text-danger hover:underline" onClick={() => void call('cloud:openWeb', { page: 'privacy' }).catch((e) => toast('error', errorMessage(e)))}>
              Account › Privacy
            </button>{' '}
            (after a 30-day grace period).
          </p>
        ) : null}
        {error ? (
          <p role="alert" className="m-0 text-danger">
            {error}
          </p>
        ) : null}
      </div>
    </Modal>
  );
}
