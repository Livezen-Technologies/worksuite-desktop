import { useState } from 'react';
import { apiPost, apiPut } from '../../core/api';
import { errorMessage } from '../../core/bridge';
import { text } from '../../core/i18n';
import { toast } from '../../core/toasts';
import { Button, Modal, Spinner } from '../../components/ui';
import { useFolders } from './api';
import { folderName } from './model';
import type { Mailbox } from './types';

/**
 * An account with no Archive folder, archived from All Accounts (DMO-ALL-11,
 * WF-DO14): pick one of its folders or create "Archive" — asked once; the
 * choice is kept as that account's Archive (a role override, DMO-ALL-06).
 */
export function ArchivePicker({ box, onPick, onCancel }: { box: Mailbox; onPick: (slug: string, name: string) => void; onCancel: () => void }) {
  const folders = useFolders(box.id, true);
  const [busy, setBusy] = useState(false);
  const list = (folders.data?.folders ?? []).filter((f) => !['inbox', 'sent', 'drafts', 'trash', 'spam', 'starred', 'important'].includes(f.slug));
  const choose = async (slug: string, name: string) => {
    setBusy(true);
    try {
      await apiPut('/api/mail/folders/role', { mailbox: box.id, folder: slug, role: 'archive' });
    } catch {
      // Remembering is a convenience: the message is still archived where the person chose.
    }
    setBusy(false);
    onPick(slug, name);
  };
  const create = async () => {
    setBusy(true);
    try {
      await apiPost('/api/mail/folders-tree', { name: 'Archive', mailbox: box.id });
      await choose('archive', text('Archive'));
    } catch (e) {
      setBusy(false);
      toast('error', errorMessage(e));
    }
  };
  return (
    <Modal title={text('Where should {email} archive?', { email: box.email })} labelledBy="mail-archive-pick" width={440} onClose={onCancel} footer={<Button onClick={onCancel}>{text('Cancel')}</Button>}>
      <div className="flex flex-col gap-3 p-5 text-[13.5px]">
        <p className="text-ink-2">{text('This account has no Archive folder. Pick one of its folders or create one — WorkSuite remembers the choice for this account.')}</p>
        <Button variant="primary" icon="folder-plus" loading={busy} onClick={() => void create()}>
          {text('Create “Archive”')}
        </Button>
        {folders.isLoading ? <Spinner /> : null}
        {list.length ? (
          <ul role="list" aria-label={text('Folders of {email}', { email: box.email })} className="max-h-[240px] overflow-y-auto rounded-[10px] border border-line scroll-thin">
            {list.map((f) => (
              <li key={f.slug}>
                <button type="button" disabled={busy} onClick={() => void choose(f.slug, folderName(f.name))} className="flex h-9 w-full items-center px-3 text-left hover:bg-subtle disabled:opacity-50">
                  {folderName(f.name)}
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </Modal>
  );
}
