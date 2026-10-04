import type { MenuItem, MenuSection } from '../../components/Menu';
import type { WaChat } from './channels/whatsapp';
import { canCall, type Room } from './types';
import { PRIORITIES, type WebsiteBulkAction, type WebsiteBulkExtra, type WebsitePriority, type WebsiteRow } from './website/api';

/**
 * The conversation menu (worksuite-desktop#183): one menu for every chat
 * channel — WorkSuite's own conversations, WhatsApp and Website chats — where
 * each channel shows only what it can do. What it offers is decided here, from
 * the conversation alone, so the right-click menu, the multi-select toolbar
 * and the keyboard shortcuts all agree; what each action does is the screen's
 * business (`useRoomActions`).
 *
 * The groups follow Mail's message menu: open, status, organise,
 * notifications, the conversation itself, and the destructive ones last.
 */

/** At most this many conversations are pinned to the top (the server says the same). */
export const MAX_PINNED = 5;

export type RoomAction =
  | 'open-window'
  | 'read'
  | 'unread'
  | 'pin'
  | 'unpin'
  | 'archive'
  | 'unarchive'
  | 'favorite'
  | 'unfavorite'
  | 'mute-8h'
  | 'mute-week'
  | 'mute-always'
  | 'unmute'
  | 'info'
  | 'call'
  | 'video'
  | 'add-members'
  | 'rename'
  | 'block'
  | 'unblock'
  | 'export'
  | 'clear'
  | 'leave'
  | 'delete'
  | 'delete-group';

/** What a conversation is, for what its menu offers. */
export type RoomKind = 'direct' | 'group' | 'meeting' | 'system';

export function roomKind(r: Pick<Room, 'type'>): RoomKind {
  if (r.type === 'direct') return 'direct';
  if (r.type === 'system') return 'system';
  if (r.type === 'meeting') return 'meeting';
  return 'group';
}

/** Minutes for each mute choice; "always" is no end. */
export const MUTE_MINUTES: Record<'mute-8h' | 'mute-week' | 'mute-always', number> = { 'mute-8h': 480, 'mute-week': 10080, 'mute-always': 0 };

/** The list's shortcuts, as `Mod` (⌘ on a Mac, Ctrl elsewhere) plus keys. */
export const SHORTCUTS = {
  unread: 'Mod+Shift+U',
  archive: 'Mod+E',
  mute: 'Mod+Shift+M',
  delete: 'Mod+Backspace',
  pin: 'Mod+Shift+P',
} as const;

export function shortcutLabel(s: string, mac: boolean): string {
  return mac ? s.replace('Mod+', '⌘').replace('Shift+', '⇧').replace('Backspace', '⌫') : s.replace('Mod', 'Ctrl');
}

/** Which action a key press on the list stands for, for this conversation (or none). */
export function shortcutAction(e: Pick<KeyboardEvent, 'key' | 'metaKey' | 'ctrlKey' | 'shiftKey' | 'altKey'>, r: Pick<Room, 'type' | 'pinned' | 'archived' | 'muted' | 'unread' | 'marked_unread'>, mac: boolean): RoomAction | null {
  const mod = mac ? e.metaKey : e.ctrlKey;
  if (!mod || e.altKey) return null;
  const key = e.key.toLowerCase();
  const kind = roomKind(r);
  const allowed = (a: RoomAction) => (kind === 'system' ? ['read', 'unread', 'archive', 'unarchive', 'mute-always', 'unmute'].includes(a) : true);
  let a: RoomAction | null = null;
  if (e.shiftKey && key === 'u') a = r.unread > 0 || r.marked_unread ? 'read' : 'unread';
  else if (e.shiftKey && key === 'm') a = r.muted ? 'unmute' : 'mute-always';
  else if (e.shiftKey && key === 'p') a = r.pinned ? 'unpin' : 'pin';
  else if (!e.shiftKey && key === 'e') a = r.archived ? 'unarchive' : 'archive';
  else if (!e.shiftKey && key === 'backspace') a = kind === 'system' || kind === 'meeting' ? null : 'delete';
  return a && allowed(a) ? a : null;
}

interface MenuContext {
  /** Conversations pinned now (for the five-at-most rule). */
  pinned: number;
  mac: boolean;
}

/** The right-click menu for one of WorkSuite's own conversations. */
export function roomMenu(r: Room, ctx: MenuContext, run: (a: RoomAction) => void): MenuSection[] {
  const kind = roomKind(r);
  const item = (id: RoomAction, label: string, icon: string, extra: Partial<MenuItem> = {}): MenuItem => ({ id, label, icon, onSelect: () => run(id), ...extra });
  const key = (s: string) => shortcutLabel(s, ctx.mac);
  const unread = r.unread > 0 || !!r.marked_unread;
  const manager = r.role === 'owner' || r.role === 'admin';

  const status = item(unread ? 'read' : 'unread', unread ? 'Mark as read' : 'Mark as unread', unread ? 'check' : 'mail', { shortcut: key(SHORTCUTS.unread) });
  const archive = item(r.archived ? 'unarchive' : 'archive', r.archived ? 'Unarchive' : 'Archive', 'archive', { shortcut: key(SHORTCUTS.archive) });
  const mute: MenuItem = r.muted
    ? item('unmute', 'Unmute', 'bell', { shortcut: key(SHORTCUTS.mute) })
    : {
        id: 'mute',
        label: 'Mute',
        icon: 'bell-off',
        submenu: [
          {
            id: 'mute-for',
            items: [item('mute-8h', 'For 8 hours', 'clock'), item('mute-week', 'For 1 week', 'calendar'), item('mute-always', 'Until I turn it back on', 'bell-off', { shortcut: key(SHORTCUTS.mute) })],
          },
        ],
      };

  // WorkSuite's own notices: mute, mark read, archive — nothing to delete or leave.
  if (kind === 'system') {
    return [
      { id: 'status', items: unread ? [status] : [] },
      { id: 'organise', items: [archive] },
      { id: 'notifications', items: [mute] },
    ];
  }

  const full = r.pinned || ctx.pinned < MAX_PINNED;
  const pin = item(r.pinned ? 'unpin' : 'pin', r.pinned ? 'Unpin' : 'Pin', 'pin', { shortcut: key(SHORTCUTS.pin), disabled: !full, reason: full ? undefined : `You can pin up to ${MAX_PINNED} conversations.` });
  const favourite = item(r.favorite ? 'unfavorite' : 'favorite', r.favorite ? 'Remove from favourites' : 'Add to favourites', 'star');
  const calls = canCall(r) ? [item('call', 'Start call', 'phone'), item('video', 'Start video call', 'video')] : [];
  const sections: MenuSection[] = [
    { id: 'open', items: [item('open-window', 'Open in new window', 'external')] },
    { id: 'status', items: [status] },
    { id: 'organise', items: [pin, archive, favourite] },
    { id: 'notifications', items: [mute] },
  ];

  if (kind === 'direct') {
    sections.push({ id: 'person', items: [item('info', 'Contact info', 'user'), ...calls] });
    sections.push({
      id: 'danger',
      items: [
        r.blocked ? item('unblock', 'Unblock', 'lock') : item('block', 'Block', 'user-x', { danger: true }),
        item('export', 'Export chat', 'download'),
        item('clear', 'Clear chat', 'eraser', { danger: true }),
        item('delete', 'Delete chat', 'trash', { danger: true, shortcut: key(SHORTCUTS.delete) }),
      ],
    });
    return sections;
  }

  if (kind === 'meeting') {
    sections.push({ id: 'meeting', items: [item('info', 'Open meeting details', 'info'), ...(manager ? [item('rename', 'Rename', 'pen')] : [])] });
    sections.push({ id: 'danger', items: [item('export', 'Export chat', 'download'), item('clear', 'Clear chat', 'eraser', { danger: true }), item('leave', 'Leave', 'logout', { danger: true })] });
    return sections;
  }

  sections.push({ id: 'group', items: [item('info', 'Group info', 'info'), ...(manager && r.type === 'group' ? [item('add-members', 'Add members', 'user-plus')] : []), ...calls] });
  sections.push({
    id: 'danger',
    items: [
      item('export', 'Export chat', 'download'),
      item('clear', 'Clear chat', 'eraser', { danger: true }),
      item('leave', 'Leave group', 'logout', { danger: true }),
      item('delete', 'Delete chat', 'trash', { danger: true, shortcut: key(SHORTCUTS.delete) }),
      ...(r.role === 'owner' && r.type === 'group' ? [item('delete-group', 'Delete group', 'trash', { danger: true, description: 'For everyone in it' })] : []),
    ],
  });
  return sections;
}

export type BulkAction = 'read' | 'unread' | 'archive' | 'unarchive' | 'mute' | 'unmute' | 'delete';

/** The menu (and toolbar) for several selected conversations: mark read, archive, mute, delete. */
export function bulkMenu(rooms: Room[], run: (a: BulkAction) => void): MenuSection[] {
  const item = (id: BulkAction, label: string, icon: string, extra: Partial<MenuItem> = {}): MenuItem => ({ id, label, icon, onSelect: () => run(id), ...extra });
  const n = rooms.length;
  const allArchived = rooms.every((r) => r.archived);
  const allMuted = rooms.every((r) => r.muted);
  const anyUnread = rooms.some((r) => r.unread > 0 || r.marked_unread);
  const deletable = rooms.filter((r) => roomKind(r) !== 'system' && roomKind(r) !== 'meeting').length;
  return [
    { id: 'status', label: `${n} conversations`, items: [anyUnread ? item('read', 'Mark as read', 'check') : item('unread', 'Mark as unread', 'mail')] },
    { id: 'organise', items: [allArchived ? item('unarchive', 'Unarchive', 'archive') : item('archive', 'Archive', 'archive'), allMuted ? item('unmute', 'Unmute', 'bell') : item('mute', 'Mute', 'bell-off')] },
    { id: 'danger', items: deletable ? [item('delete', deletable === n ? 'Delete chats' : `Delete ${deletable} chats`, 'trash', { danger: true })] : [] },
  ];
}

export type WaAction = 'read' | 'pin' | 'unpin' | 'mute' | 'unmute' | 'contacts' | 'assign-me' | 'assign' | 'unassign' | 'waiting' | 'done' | 'reopen' | 'open-web';

/**
 * WhatsApp's menu: what WorkSuite keeps on a WhatsApp conversation, and the inbox's own actions. `contactItems`
 * (from the number matched in Contacts, #176) replace the plain "Add to contacts": Open contact, or Add / Link.
 */
export function whatsappMenu(c: WaChat, run: (a: WaAction) => void, contactItems?: MenuItem[]): MenuSection[] {
  const item = (id: WaAction, label: string, icon: string, extra: Partial<MenuItem> = {}): MenuItem => ({ id, label, icon, onSelect: () => run(id), ...extra });
  const resolved = c.status === 'resolved' || c.status === 'archived';
  return [
    { id: 'open', items: [item('open-web', 'Open on the web', 'external')] },
    { id: 'status', items: c.unread ? [item('read', 'Mark as read', 'check')] : [] },
    { id: 'organise', items: [c.is_pinned ? item('unpin', 'Unpin', 'pin') : item('pin', 'Pin', 'pin'), c.is_muted ? item('unmute', 'Unmute', 'bell') : item('mute', 'Mute', 'bell-off')] },
    {
      id: 'inbox',
      items: [
        ...(contactItems ?? (c.kind !== 'group' && c.phone ? [item('contacts', 'Add to contacts', 'user-plus')] : [])),
        { id: 'assign', label: 'Assign to…', icon: 'user', submenu: [{ id: 'who', items: [item('assign-me', 'Assign to me', 'user'), item('assign', 'Someone else…', 'users'), ...(c.assigned_name ? [item('unassign', 'Unassign', 'x')] : [])] }] },
        ...(resolved ? [item('reopen', 'Reopen', 'refresh')] : [item('waiting', 'Mark as waiting', 'clock', { checked: c.status === 'pending' }), item('done', 'Mark as done', 'check')]),
      ],
    },
  ];
}

export type WebsiteAction = 'open' | 'assign-me' | 'transfer' | 'unassign' | 'close' | 'reopen' | 'star' | 'unstar' | 'priority';

/** The Priority submenu: one radio item each, the conversations' own (when they share one) ticked. */
function priorityItems(current: string | null, pick: (p: WebsitePriority) => void): MenuSection[] {
  return [{ id: 'priorities', items: PRIORITIES.map((p) => ({ id: `priority-${p.id}`, label: p.label, radio: true, checked: current === p.id, onSelect: () => pick(p.id) })) }];
}

/** Website chats' menu: assign, transfer to another agent, star, priority, close. */
export function websiteMenu(c: WebsiteRow, me: number | null, agents: Array<{ id: number; name: string }>, run: (a: WebsiteAction, userId?: number, priority?: WebsitePriority) => void): MenuSection[] {
  const closed = c.status === 'closed';
  const others = agents.filter((a) => a.id !== me && a.id !== c.assigned_to);
  return [
    { id: 'open', items: [{ id: 'open', label: 'Open', icon: 'chat', onSelect: () => run('open') }] },
    {
      id: 'assign',
      items: closed
        ? []
        : [
            ...(c.assigned_to !== me ? [{ id: 'assign-me', label: 'Assign to me', icon: 'user', onSelect: () => run('assign-me') }] : []),
            {
              id: 'transfer',
              label: c.assigned_to === null ? 'Assign to…' : 'Transfer',
              icon: 'users',
              disabled: others.length === 0,
              reason: others.length === 0 ? 'Nobody else answers website chats.' : undefined,
              submenu: [{ id: 'agents', items: others.map((a) => ({ id: `agent-${a.id}`, label: a.name, icon: 'user', onSelect: () => run('transfer', a.id) })) }],
            },
            ...(c.assigned_to !== null ? [{ id: 'unassign', label: 'Unassign', icon: 'x', onSelect: () => run('unassign') }] : []),
          ],
    },
    {
      id: 'organise',
      items: [
        c.is_starred ? { id: 'unstar', label: 'Unstar', icon: 'star', onSelect: () => run('unstar') } : { id: 'star', label: 'Star', icon: 'star', onSelect: () => run('star') },
        { id: 'priority', label: 'Priority', icon: 'flag', submenu: priorityItems(c.priority, (p) => run('priority', undefined, p)) },
      ],
    },
    { id: 'state', items: [closed ? { id: 'reopen', label: 'Reopen conversation', icon: 'refresh', onSelect: () => run('reopen') } : { id: 'close', label: 'Close conversation', icon: 'check', danger: true, onSelect: () => run('close') }] },
  ];
}

/**
 * The menu for several picked website chats (UX-LIST-02): Assign to… (me, each colleague, or nobody), Priority,
 * Star or Unstar (Unstar when all of them are starred), and Close or Reopen. The bulk bar's dropdowns are the
 * submenus of the same items, so the bar and a right-click on the picked rows offer the same.
 */
export function websiteBulkMenu(rows: WebsiteRow[], me: number | null, agents: Array<{ id: number; name: string }>, run: (a: WebsiteBulkAction, extra?: WebsiteBulkExtra) => void): MenuSection[] {
  const n = rows.length;
  const allStarred = n > 0 && rows.every((r) => r.is_starred);
  const allClosed = n > 0 && rows.every((r) => r.status === 'closed');
  const anyAssigned = rows.some((r) => r.assigned_to !== null);
  const shared = n > 0 && rows.every((r) => r.priority === rows[0]!.priority) ? rows[0]!.priority : null;
  const others = agents.filter((a) => a.id !== me);
  const assign: MenuSection[] = [
    { id: 'me', items: me !== null ? [{ id: 'assign-me', label: 'Assign to me', icon: 'user', onSelect: () => run('assign', { user_id: me }) }] : [] },
    { id: 'agents', label: others.length ? 'Assign to' : undefined, items: others.map((a) => ({ id: `agent-${a.id}`, label: a.name, icon: 'user', onSelect: () => run('assign', { user_id: a.id }) })) },
    { id: 'nobody', items: anyAssigned ? [{ id: 'unassign', label: 'Unassign', icon: 'x', onSelect: () => run('assign', { user_id: null }) }] : [] },
  ];
  return [
    {
      id: 'organise',
      label: n === 1 ? '1 conversation' : `${n} conversations`,
      items: [
        { id: 'assign', label: 'Assign to…', icon: 'users', submenu: assign },
        { id: 'priority', label: 'Priority', icon: 'flag', submenu: priorityItems(shared, (p) => run('priority', { priority: p })) },
        allStarred ? { id: 'unstar', label: 'Unstar', icon: 'star', onSelect: () => run('unstar') } : { id: 'star', label: 'Star', icon: 'star', onSelect: () => run('star') },
      ],
    },
    { id: 'state', items: [allClosed ? { id: 'reopen', label: 'Reopen', icon: 'refresh', onSelect: () => run('reopen') } : { id: 'close', label: 'Close', icon: 'check', danger: true, onSelect: () => run('close') }] },
  ];
}
