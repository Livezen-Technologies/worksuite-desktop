import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { canOpenApp } from '@shared/access';
import { findApp } from '@shared/apps';
import { parseItemLink } from '@shared/item-links';
import { useVisibleIds } from '../../../core/access';
import { apiPost } from '../../../core/api';
import { appColour } from '../../../core/app-look';
import { app as appState } from '../../../core/app-state';
import { errorMessage } from '../../../core/bridge';
import { openItemLink } from '../../../core/item-links';
import { useStore } from '../../../core/store';
import { openWebLink } from '../../../core/tab-context';
import { toast } from '../../../core/toasts';
import { Button, Modal } from '../../../components/ui';
import { current, useMyAnnouncements } from '../../home/Announcements';
import { CardFrame } from './CardFrame';
import { pathOf, pageTitle, type PageRef } from './recordLinks';

/** The message a card came in, for asking its sender for access. */
export interface CardSource {
  roomId: number;
  messageId: number;
  sender: string;
  /** Sent by the person looking: there is nobody to ask. */
  own: boolean;
}

/**
 * A page of an app shared in a conversation (worksuite-desktop#266): the app's icon and name, the page's title, a
 * line about it — only what the reader may see of it themselves — and Open, which opens it here in a tab of its own,
 * in the organisation the link names. A reader without the app sees "You don't have access to this page" and can ask
 * the sender for it, in the conversation, as a reply to the share.
 */
export function PageCard({ r, title, from }: { r: PageRef; title?: string | null; from?: CardSource }) {
  const visible = useVisibleIds();
  const orgs = useStore(appState, (s) => s.bootstrap?.organizations);
  const here = useStore(appState, (s) => s.organizationId);
  const [asking, setAsking] = useState(false);
  const def = findApp(r.app);
  const name = title || pageTitle(r);
  const member = !r.org || !orgs || orgs.some((o) => o.id === r.org);
  const allowed = !!def && member && canOpenApp(r.app, visible);
  // Another organisation's page says whose it is; what it holds is read only in the organisation open now.
  const elsewhere = r.org && r.org !== here ? (orgs?.find((o) => o.id === r.org)?.name ?? null) : null;
  const look = def ? { icon: def.icon, colour: appColour(def.id) } : undefined;

  if (!allowed) {
    const ask = from && !from.own && member;
    return (
      <>
        <CardFrame
          kind="page"
          app={look}
          label={def?.label ?? 'Page'}
          state="noaccess"
          gone={{ title: 'You don’t have access to this page', sub: member ? `${name} is in an app you haven’t been given.` : 'It belongs to an organisation you’re not a member of.' }}
          actions={ask ? [{ label: 'Request access', tone: 'primary', onClick: () => setAsking(true) }] : []}
        />
        {asking && from ? <RequestAccess page={name} from={from} onClose={() => setAsking(false)} /> : null}
      </>
    );
  }

  const open = () => {
    const org = r.org ?? here;
    const parsed = org ? parseItemLink(`worksuite://${org}/${r.app}/${r.page}`) : null;
    if (parsed?.ok) void openItemLink(parsed.link, { source: 'chat', place: 'new-tab' });
    else openWebLink(pathOf(r));
  };
  return (
    <CardFrame kind="page" app={look} label={def!.label} org={elsewhere} actions={[{ label: 'Open', tone: 'primary', onClick: open }]}>
      <div className="flex flex-col gap-1 px-3.5 py-3.5">
        <b className="block text-[15px] leading-snug">{name}</b>
        <span data-page-summary className="block text-[12.5px] text-ink-3 dark:text-[#8D96B8]">
          {!elsewhere && `${r.app}/${r.page}` === 'hr/announcements' ? <AnnouncementsSummary /> : `A page in ${def!.label}`}
        </span>
      </div>
    </CardFrame>
  );
}

/** "3 announcements · 1 unread": the reader's own announcements, the ones the page shows them. */
function AnnouncementsSummary() {
  const q = useMyAnnouncements();
  if (q.isLoading) return <>…</>;
  if (!q.data) return <>Announcements sent to you</>;
  const mine = current(q.data);
  const unread = mine.filter((a) => !a.read).length;
  if (!mine.length) return <>No announcements</>;
  return (
    <>
      {mine.length} announcement{mine.length === 1 ? '' : 's'} · {unread ? `${unread} unread` : 'all read'}
    </>
  );
}

/** Request access: a reply to the share, so its sender (or whoever can) knows who is asking and for what. */
function RequestAccess({ page, from, onClose }: { page: string; from: CardSource; onClose: () => void }) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const message = `I don’t have access to ${page}. Could you give me access, or ask an administrator to?`;
  const send = async () => {
    setBusy(true);
    try {
      await apiPost('/api/chat/messages', { room_id: from.roomId, message, reply_to: from.messageId, client_message_id: `desktop-${crypto.randomUUID()}` });
      void qc.invalidateQueries({ queryKey: ['chat', 'messages', String(from.roomId)] });
      toast('success', `Asked ${from.sender} for access.`);
      onClose();
    } catch (e) {
      toast('error', errorMessage(e));
      setBusy(false);
    }
  };
  return (
    <Modal
      title="Request access?"
      onClose={onClose}
      width={420}
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>Cancel</Button>
          <Button variant="primary" loading={busy} onClick={() => void send()}>Send request</Button>
        </>
      }
    >
      <div className="flex flex-col gap-3 text-[13px]">
        <p className="m-0 text-ink-2">{from.sender} will be asked in this conversation, as a reply to what they shared:</p>
        <div className="rounded-[9px] bg-subtle px-3 py-2.5 text-ink">{message}</div>
      </div>
    </Modal>
  );
}
