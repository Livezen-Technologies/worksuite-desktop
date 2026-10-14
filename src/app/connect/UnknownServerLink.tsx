import { useId } from 'react';
import type { UnknownLink } from '@shared/accounts';
import { app, startAdding } from '../../core/app-state';
import { useStore } from '../../core/store';
import { Icon } from '../../components/Icon';
import { Button, Modal } from '../../components/ui';

export interface UnknownServerLinkProps {
  link: UnknownLink;
  onClose: () => void;
}

/**
 * Screen 16's dialog — a link to a server that is not added (`accounts:unknownLink`): its host and what it points at,
 * Add Account or Cancel. Nothing was fetched from that host, and nothing is until the account is added (the address
 * screen still needs Continue, and the checks run first). Links never carry tokens.
 */
export function UnknownServerLink({ link, onClose }: UnknownServerLinkProps) {
  const titleId = useId();
  const accounts = useStore(app, (s) => s.accounts);
  const canAdd = accounts?.allowAddEnterprise ?? true;
  return (
    <Modal width={500} onClose={onClose} labelledBy={titleId}>
      <div className="flex flex-col gap-3.5 py-2">
        <span className="flex h-12 w-12 items-center justify-center rounded-[12px] bg-selection text-primary" aria-hidden>
          <Icon name="link" size={22} />
        </span>
        <h2 id={titleId} className="m-0 text-[21px] font-extrabold text-ink">
          This link belongs to a WorkSuite server you haven’t added
        </h2>
        <div className="rounded-[10px] bg-subtle px-3.5 py-3 font-mono text-[13px] break-all text-ink">
          {link.host}
          {link.label ? ` · ${link.label}` : ''}
        </div>
        <p className="m-0 text-[14px] leading-normal text-ink-3">WorkSuite never connects to a new server on its own. Add the account if you work with this organization.</p>
        {!canAdd ? <p className="m-0 text-[13px] text-warning">Your organization allows only its own WorkSuite server on this computer.</p> : null}
        <div className="flex gap-2.5">
          <Button
            variant="primary"
            size="lg"
            autoFocus
            disabled={!canAdd}
            className="h-11 flex-1 rounded-[10px]"
            onClick={() => {
              onClose();
              startAdding('enterprise', `https://${link.host}`);
            }}
          >
            Add Account
          </Button>
          <Button size="lg" className="h-11 rounded-[10px]" onClick={onClose}>
            Cancel
          </Button>
        </div>
      </div>
    </Modal>
  );
}

/** Shows screen 16's dialog for the latest `accounts:unknownLink`, in whichever screen the window is on. */
export function UnknownLinkHost() {
  const link = useStore(app, (s) => s.unknownLink);
  if (!link) return null;
  return <UnknownServerLink key={link.url} link={link} onClose={() => app.set({ unknownLink: null })} />;
}
