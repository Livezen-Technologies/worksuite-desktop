import type { OfficeLocalCopy } from '@shared/office';
import { app } from '../../core/app-state';
import { call, errorMessage } from '../../core/bridge';
import { useStore } from '../../core/store';
import { navigate } from '../../core/tabs';
import { toast } from '../../core/toasts';
import { Modal } from '../../components/ui';
import { size } from '../account/Storage';

/**
 * Screen 13 — the account's storage is full while a document's edits go up (Connection & Startup §3 quota): the
 * OfficeExternal copy is in its `quota` state. Nothing is lost: the edits stay on this computer and go up as a new
 * version by themselves as soon as there is room. Manage storage, Upgrade for more space, Save a copy on this
 * computer (shows the copy where it is kept), or Keep editing.
 */
export function StorageFullDialog({ copy, onClose }: { copy: Pick<OfficeLocalCopy, 'id' | 'name'>; onClose: () => void }) {
  const limit = useStore(app, (s) => (s.cloud ?? s.auth?.cloud ?? null)?.storage?.limit ?? 0);
  const manage = () => {
    onClose();
    navigate('/account/storage');
  };
  const upgrade = () => void call('cloud:openWeb', { page: 'upgrade' }).catch((e) => toast('error', errorMessage(e)));
  const saveCopy = () => void call('office:revealLocal', { id: copy.id }).catch((e) => toast('error', errorMessage(e)));
  return (
    <Modal onClose={onClose} width={520} labelledBy="storage-full-title">
      <div className="flex flex-col gap-3.5 px-2 py-3" data-testid="storage-full">
        <h2 id="storage-full-title" className="m-0 text-[22px] font-extrabold text-ink">
          {limit > 0 ? `Your ${size(limit)} is full` : 'Your storage is full'}
        </h2>
        <p className="m-0 text-[14.5px] leading-[1.6] text-ink-3">
          Your edits to <b className="text-ink">{copy.name}</b> are safe on this computer. They'll upload as a new version as soon as there's room.
        </p>
        <div className="mt-1.5 flex flex-col gap-2.5">
          <button type="button" onClick={manage} className="h-[46px] rounded-[10px] bg-primary text-[15px] font-semibold text-white hover:bg-primary-hover">
            Manage storage
          </button>
          <button type="button" onClick={upgrade} className="h-[46px] rounded-[10px] border border-primary bg-surface text-[15px] font-semibold text-primary hover:bg-selection">
            Upgrade for more space
          </button>
          <button type="button" onClick={saveCopy} title="Show the copy kept on this computer, to save it wherever you like" className="h-[46px] rounded-[10px] border border-line bg-surface text-[15px] font-semibold text-ink hover:bg-subtle">
            Save a copy on this computer…
          </button>
        </div>
        <button type="button" onClick={onClose} className="self-center text-[13px] text-primary hover:underline">
          Keep editing
        </button>
      </div>
    </Modal>
  );
}
