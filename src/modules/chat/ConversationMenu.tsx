import { useEffect, useState } from 'react';
import { app } from '../../core/app-state';
import { useStore } from '../../core/store';
import { useTab } from '../../core/tab-context';
import { ContextMenu } from '../../components/ContextMenu';
import type { WaChat } from './channels/whatsapp';
import type { MenuItem } from '../../components/Menu';
import { websiteMenu, whatsappMenu } from './menus';
import { useWebsiteActions, useWhatsappActions } from './RoomActions';
import { useAgents, type WebsiteRow } from './website/api';

/**
 * The conversation menu at the mouse for the WhatsApp and Website channels
 * (worksuite-desktop#183): the same menu as WorkSuite's own conversations,
 * showing what each channel can do. A channel's list only keeps where the
 * click was and which conversation it was on.
 */
export type ConversationMenuTarget = { kind: 'whatsapp'; chat: WaChat; contactItems?: MenuItem[] } | { kind: 'website'; row: WebsiteRow };

export function ConversationMenu({ x, y, target, onClose }: { x: number; y: number; target: ConversationMenuTarget; onClose: () => void }) {
  return target.kind === 'whatsapp' ? <WhatsappMenu x={x} y={y} chat={target.chat} contactItems={target.contactItems} onClose={onClose} /> : <WebsiteMenu x={x} y={y} row={target.row} onClose={onClose} />;
}

function useMe(): number | null {
  return useStore(app, (s) => (s.auth?.user?.id ? Number(s.auth.user.id) : null));
}

function WhatsappMenu({ x, y, chat, contactItems, onClose }: { x: number; y: number; chat: WaChat; contactItems?: MenuItem[]; onClose: () => void }) {
  const wa = useWhatsappActions(useMe());
  // "Assign to… → Someone else" asks who after the menu has gone: this stays until that is answered.
  const [open, setOpen] = useState(true);
  useEffect(() => {
    if (!open && !wa.busy) onClose();
  }, [open, wa.busy, onClose]);
  return (
    <>
      {open ? <ContextMenu x={x} y={y} label={`Actions — ${chat.name}`} sections={whatsappMenu(chat, (a) => wa.run(chat, a), contactItems)} onClose={() => setOpen(false)} /> : null}
      {wa.dialogs}
    </>
  );
}

function WebsiteMenu({ x, y, row, onClose }: { x: number; y: number; row: WebsiteRow; onClose: () => void }) {
  const { go } = useTab();
  const me = useMe();
  const agents = useAgents(true);
  const run = useWebsiteActions(me, (c) => go(`/chat?view=website&website=${c.id}`));
  return <ContextMenu x={x} y={y} label={`Actions — ${row.visitor_name || row.label}`} sections={websiteMenu(row, me, agents.data?.agents ?? [], (a, userId) => run(row, a, userId))} onClose={onClose} />;
}
