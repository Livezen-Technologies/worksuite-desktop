import { itemLabel } from '@shared/item-links';
import { closeItemDialog, itemDialog, requestItemAccess } from '../../core/item-links';
import { useStore } from '../../core/store';
import { Button, Modal } from '../../components/ui';

/**
 * What a WorkSuite link says in the app when it cannot simply open
 * (worksuite-desktop#170): the confirmation for an action, "You don't have
 * access to this organisation", no access to the item (with Request access
 * for Drive items) and "Available when online". Never a page in the browser.
 */
export function ItemLinkDialog() {
  const dialog = useStore(itemDialog, (s) => s.dialog);
  if (!dialog) return null;
  const what = itemLabel(dialog.link.type);

  if (dialog.kind === 'confirm') {
    return (
      <Modal
        title={dialog.title}
        labelledBy="item-link-confirm"
        onClose={dialog.cancel}
        footer={
          <>
            <Button onClick={dialog.cancel}>Cancel</Button>
            <Button variant={dialog.danger ? 'danger' : 'primary'} onClick={dialog.run} autoFocus>
              {dialog.action}
            </Button>
          </>
        }
      >
        <p className="text-[13.5px] text-ink-2">{dialog.body}</p>
        <p className="mt-2 text-[12.5px] text-ink-3">This was asked by a link. Nothing happens unless you choose {dialog.action}.</p>
      </Modal>
    );
  }

  if (dialog.kind === 'no-org') {
    return (
      <Modal title="You don't have access to this organisation" labelledBy="item-link-org" onClose={closeItemDialog} footer={<Button variant="primary" onClick={closeItemDialog} autoFocus>OK</Button>}>
        <p className="text-[13.5px] text-ink-2">This {what} belongs to an organisation you are not a member of. Ask someone there to invite you.</p>
      </Modal>
    );
  }

  if (dialog.kind === 'no-access') {
    const link = dialog.link;
    return (
      <Modal
        title={`You don't have access to this ${what}`}
        labelledBy="item-link-access"
        onClose={closeItemDialog}
        footer={
          <>
            <Button onClick={closeItemDialog}>Close</Button>
            {dialog.canRequest ? (
              <Button
                variant="primary"
                autoFocus
                onClick={() => {
                  closeItemDialog();
                  void requestItemAccess(link);
                }}
              >
                Request access
              </Button>
            ) : null}
          </>
        }
      >
        <p className="text-[13.5px] text-ink-2">It may have been removed, or not shared with you.{dialog.canRequest ? ' You can ask its owner for access.' : ''}</p>
      </Modal>
    );
  }

  return (
    <Modal title="Available when online" labelledBy="item-link-offline" onClose={closeItemDialog} footer={<Button variant="primary" onClick={closeItemDialog} autoFocus>OK</Button>}>
      <p className="text-[13.5px] text-ink-2">There is no copy of this {what} on this computer. It opens once you are back online.</p>
    </Modal>
  );
}
