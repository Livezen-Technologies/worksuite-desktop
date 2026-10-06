import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useState } from 'react';
import { apiGetMeta, apiPost } from '../../core/api';
import { errorMessage, isMac } from '../../core/bridge';
import { ContextMenu } from '../../components/ContextMenu';
import { app, updatePrefs } from '../../core/app-state';
import { useStore } from '../../core/store';
import { TabProvider } from '../../core/tab-context';
import { navigate, tabsStore } from '../../core/tabs';
import { listStamp, parseTs } from '../../core/time';
import { toast } from '../../core/toasts';
import { minimiseChatDrawer, openChatDrawer, ui, useChatDrawerMode } from '../../core/ui';
import { Icon } from '../../components/Icon';
import { ResizeDivider, useResizableWidth } from '../../components/ResizeDivider';
import { Empty, ErrorNote, Spinner, cx } from '../../components/ui';
import { UserAvatar } from '../../components/UserAvatar';
import { APP_CATALOGUE } from '@shared/apps';
import { appColour } from '../../core/app-look';
import { AppTile } from '../../components/AppTile';
import { useNow } from '../calls/parts';
import { startCall } from '../calls/start';
import { CALL_FILTERS, CallLogList, useCallLog, type CallFilter } from './CallLog';
import { PRESENCE } from './Details';
import { NewChat } from './NewChat';
import { Thread } from './Thread';
import { openChatWindow } from './window';
import { canCall, roomPerson, type Room } from './types';
import { usePresence } from './presence';
import { roomMenu } from './menus';
import { refOf, shareLink, webPathOfRoute } from './cards/recordLinks';
import { useRoomActions } from './RoomActions';

/**
 * The chat drawer (ChatDrawer, ChatDrawerCalls): chat over whatever you are
 * doing, from the title bar. Chats, calls and archived conversations; a
 * conversation opens in place, and minimising leaves it in the corner.
 *
 * Docked or floating (worksuite-desktop#264). Docked — the default — it stands beside the page, under the tab strip:
 * the page gives up the drawer's width and lays itself out again in what is left, so nothing is hidden under it.
 * Floating — chosen, or a window narrower than DOCK_MIN_WINDOW — it lies over the page with a shadow and a light dim,
 * and a click on the page or Esc closes it. Either way it comes and goes in DRAWER_MS, and its left edge is the shared
 * divider: drag it, use the arrow keys, double-click for the default; the width is kept for this person on this computer.
 */
const WIDTH_KEY = 'ws.chatDrawer.width';
/** The drawer's width range and default (worksuite-desktop#211, #264). */
export const DRAWER_MIN = 360;
export const DRAWER_MAX = 640;
export const DRAWER_DEFAULT = 400;
/** How long the drawer takes to come and go; a page beside it eases to its new width as long. */
export const DRAWER_MS = 200;
/** What the drawer leaves of the window: docked, the sidebar and a page still worth working in; floating, a strip of the page. */
const DOCKED_ROOM = 720;
const FLOATING_ROOM = 420;

/** The most of this window the drawer may take. */
export function drawerMax(floating: boolean): number {
  return Math.min(DRAWER_MAX, window.innerWidth - (floating ? FLOATING_ROOM : DOCKED_ROOM));
}

/** Where this person's drawer width is kept on this computer. */
export function drawerWidthKey(user: string | number | null | undefined): string {
  return user == null || user === '' ? WIDTH_KEY : `${WIDTH_KEY}.${user}`;
}

/** A width kept before it was kept per person becomes the first person's to open the drawer here. */
function adoptWidth(key: string): string {
  if (key === WIDTH_KEY) return key;
  try {
    const old = localStorage.getItem(WIDTH_KEY);
    if (old !== null) {
      if (localStorage.getItem(key) === null) localStorage.setItem(key, old);
      localStorage.removeItem(WIDTH_KEY);
    }
  } catch {
    // The width is a convenience.
  }
  return key;
}

/** Whether the drawer is on screen: while it is open, and for the moment it takes to leave once put away. */
export function useDrawerShown(open: boolean): boolean {
  const [shown, setShown] = useState(open);
  if (open && !shown) setShown(true);
  useEffect(() => {
    if (open || !shown) return;
    const t = window.setTimeout(() => setShown(false), DRAWER_MS);
    return () => window.clearTimeout(t);
  }, [open, shown]);
  return open || shown;
}

export function ChatDrawer({ closing = false }: { closing?: boolean }) {
  const current = useStore(ui, (s) => s.chatRoom);
  // Leaving, it goes on showing what it showed: minimising has already let go of the conversation.
  const [room, setRoom] = useState(current);
  if (!closing && room !== current) setRoom(current);
  const user = useStore(app, (s) => s.auth?.user?.id ?? null);
  const [key] = useState(() => adoptWidth(drawerWidthKey(user)));
  const { floating } = useChatDrawerMode();
  const max = useCallback(() => drawerMax(floating), [floating]);
  const size = useResizableWidth('chatDrawer', { key, defaultWidth: DRAWER_DEFAULT, min: DRAWER_MIN, max });
  // It comes in once; switching between docked and floating afterwards, or the window crossing the line, moves it at once.
  const [entered, setEntered] = useState(false);
  const motion = closing ? (floating ? 'chat-float-out' : 'chat-dock-out') : entered ? null : floating ? 'chat-float-in' : 'chat-dock-in';
  return (
    <>
      {floating ? <div aria-hidden data-chat-scrim onMouseDown={minimiseChatDrawer} className={cx('absolute inset-0 z-30 bg-scrim/40', closing ? 'chat-scrim-out' : 'chat-scrim-in')} /> : null}
      {/*
        One container with one left edge (worksuite-desktop#211): a 1px border, every part inside (header, messages,
        composer) sharing it. Docked, it is a column of the window, and the page beside it is narrower by its width;
        floating, it lies over the page with a soft shadow, so it reads as a layer in both themes. Its content keeps
        the drawer's width while the column grows or shrinks, so it slides rather than squeezes.
      */}
      <div
        data-chat-drawer={floating ? 'floating' : 'docked'}
        inert={closing}
        onAnimationEnd={(e) => e.target === e.currentTarget && !closing && setEntered(true)}
        className={cx(floating ? 'absolute inset-y-0 right-0 z-30' : 'relative shrink-0', motion)}
        style={{ width: size.width }}
      >
        <aside aria-label="Chat drawer" className={cx('absolute inset-y-0 left-0 flex flex-col overflow-hidden border-l border-line bg-surface', floating && 'shadow-[-12px_0_32px_-16px_rgb(0_0_0/.45)]')} style={{ width: size.width }}>
          <TabProvider tabId="chat-drawer" route={room ? `/chat?room=${room}` : '/chat'} active onGo={(r) => navigate(r)}>
            {room ? <Conversation roomId={room} /> : <Lists />}
          </TabProvider>
        </aside>
        <ResizeDivider state={size} side="left" label="Resize the chat drawer" />
      </div>
    </>
  );
}

/** Docked ⇄ Floating, from the drawer's header: kept as the Settings › Chat choice. A narrow window has no room to dock. */
export function DrawerModeButton({ className }: { className?: string }) {
  const { chosen, narrow, floating } = useChatDrawerMode();
  const label = floating ? 'Dock beside the page' : 'Float over the page';
  return (
    <button
      type="button"
      aria-label={label}
      title={narrow ? 'Make the window wider to dock the chat beside the page' : label}
      disabled={narrow}
      onClick={() => void updatePrefs({ chatDrawer: chosen === 'floating' ? 'docked' : 'floating' }).catch((e) => toast('error', errorMessage(e)))}
      className={cx(className, 'disabled:opacity-40 disabled:hover:bg-transparent')}
    >
      <Icon name={floating ? 'layout-side' : 'pip'} size={15} />
    </button>
  );
}

function useRooms() {
  return useQuery({ queryKey: ['chat', 'rooms'], queryFn: ({ signal }) => apiGetMeta<{ rooms: Room[] }>('/api/chat/rooms', undefined, signal) });
}

const hbtn = 'flex h-8 min-w-8 items-center justify-center rounded-full px-1 text-[13px] text-ink-2 hover:bg-subtle hover:text-ink';
const round = 'flex h-[34px] w-[34px] items-center justify-center rounded-full text-ink-2 hover:bg-subtle hover:text-ink';
const pill = (on: boolean) => cx('flex h-[30px] shrink-0 items-center rounded-full border px-3 text-[12.5px] font-semibold', on ? 'border-primary bg-primary text-white' : 'border-line bg-surface text-ink-2 hover:text-ink');

type Tab = 'Chats' | 'Calls' | 'Archived';

function Lists() {
  const qc = useQueryClient();
  const me = useStore(app, (s) => s.auth?.user?.id);
  // The conversation menu, as in Chat's list (worksuite-desktop#183).
  const actions = useRoomActions({ onInfo: (r) => openChatDrawer(String(r.id)) });
  const [menu, setMenu] = useState<{ x: number; y: number; id: number } | null>(null);
  const [tab, setTab] = useState<Tab>('Chats');
  const now = useNow(60_000);
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<'All' | 'Unread' | 'Mentions'>('All');
  const [callFilter, setCallFilter] = useState<CallFilter>('All');
  const [starting, setStarting] = useState(false);
  const rooms = useRooms();
  const all = (rooms.data?.data.rooms ?? []).filter((r) => r.type !== 'widget');
  const calls = useCallLog(tab === 'Calls');
  const people = [...new Set(all.map((r) => r.other_user_id).filter((id): id is number => typeof id === 'number'))];
  const presenceOf = usePresence(people);
  const needle = q.trim().toLowerCase();
  const live = all.filter((r) => !r.archived);
  const archived = all.filter((r) => r.archived);
  const shown = (tab === 'Archived' ? archived : live).filter((r) => {
    if (needle && !r.name.toLowerCase().includes(needle)) return false;
    if (tab === 'Chats' && filter === 'Unread') return r.unread > 0;
    if (tab === 'Chats' && filter === 'Mentions') return r.mentions > 0;
    return true;
  });
  // Pinned first, then the most recent.
  const ordered = tab === 'Chats' ? [...shown.filter((r) => r.pinned), ...shown.filter((r) => !r.pinned)] : shown;
  const unreadChats = live.filter((r) => r.unread > 0).length;
  // Calls missed in the last day.
  const missed = (calls.data ?? []).filter((c) => c.missed && now - parseTs(c.started_at).getTime() < 86_400_000).length;
  const counts: Record<Tab, [number, string]> = { Chats: [unreadChats, 'bg-primary'], Calls: [missed, 'bg-badge'], Archived: [0, ''] };

  return (
    <>
      <div className="flex shrink-0 items-center gap-0.5 pt-3 pr-2 pb-1.5 pl-4">
        <b className="flex-1 text-[20px] tracking-[-0.2px] text-ink">Chat</b>
        <button type="button" aria-label="New conversation" title="New conversation" onClick={() => setStarting(true)} className="flex h-[34px] w-[34px] items-center justify-center rounded-full bg-selection text-primary hover:brightness-95">
          <Icon name="compose" size={16} />
        </button>
        <button type="button" aria-label="Open full chat" title="Open full chat" onClick={() => (minimiseChatDrawer(), navigate('/chat'))} className={round}>
          <Icon name="maximize" size={15} />
        </button>
        <DrawerModeButton className={round} />
        <button type="button" aria-label="Minimise" title="Minimise" onClick={minimiseChatDrawer} className={round}>
          <Icon name="minus" size={16} />
        </button>
        <button type="button" aria-label="Close" title="Close" onClick={minimiseChatDrawer} className={round}>
          <Icon name="x" size={16} />
        </button>
      </div>
      <div className="shrink-0 px-3.5 pt-1 pb-2">
        <label className="flex h-[38px] items-center gap-2.5 rounded-full bg-subtle px-3 text-ink-3">
          <Icon name="search" size={15} />
          <input value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search conversations and people" placeholder="Search conversations and people…" className="bare-focus min-w-0 flex-1 bg-transparent text-[13px] text-ink outline-none placeholder:text-ink-3" />
        </label>
      </div>
      <div role="tablist" className="flex shrink-0 gap-1.5 border-b border-line px-3.5 pb-2.5">
        {(['Chats', 'Calls', 'Archived'] as const).map((t) => (
          <button key={t} type="button" role="tab" aria-selected={tab === t} onClick={() => setTab(t)} className={cx('flex h-8 flex-1 items-center justify-center gap-1.5 rounded-[9px] text-[13px]', tab === t ? 'bg-selection font-bold text-primary' : 'font-semibold text-ink-2 hover:bg-subtle')}>
            {t}
            {counts[t][0] ? <span className={cx('flex h-[18px] min-w-[18px] items-center justify-center rounded-full px-[5px] text-[10.5px] font-bold text-white', counts[t][1])}>{counts[t][0]}</span> : null}
          </button>
        ))}
      </div>
      {tab === 'Chats' ? (
        <div className="flex shrink-0 gap-1.5 px-3.5 pt-2.5 pb-1">
          {(['All', 'Unread', 'Mentions'] as const).map((f) => (
            <button key={f} type="button" aria-pressed={filter === f} onClick={() => setFilter(f)} className={pill(filter === f)}>
              {f}
            </button>
          ))}
        </div>
      ) : tab === 'Calls' ? (
        <div className="flex shrink-0 gap-1.5 px-3.5 pt-2.5 pb-1">
          {CALL_FILTERS.map((f) => (
            <button key={f} type="button" aria-pressed={callFilter === f} onClick={() => setCallFilter(f)} className={pill(callFilter === f)}>
              {f}
            </button>
          ))}
        </div>
      ) : (
        <div className="shrink-0 px-4 pt-3 pb-1.5 text-[12px] leading-normal text-ink-3">Archived chats stay here until a new message arrives or you move them back.</div>
      )}
      <div className="min-h-0 flex-1 overflow-y-auto px-1.5 pt-0.5 pb-2 scroll-thin">
        {tab === 'Calls' ? (
          <CallLogList log={calls} rooms={all} filter={callFilter} needle={needle} />
        ) : (
          <>
            {tab === 'Chats' && archived.length && !needle && filter === 'All' ? (
              <button type="button" onClick={() => setTab('Archived')} className="flex h-11 w-full items-center gap-3.5 rounded-[12px] pr-2.5 pl-[22px] text-left text-ink hover:bg-subtle">
                <Icon name="archive" size={17} className="text-ink-2" />
                <b className="flex-1 text-[13.5px]">Archived</b>
                <span className="text-[12px] font-bold text-primary">{archived.length}</span>
              </button>
            ) : null}
            {rooms.isLoading ? <Spinner /> : rooms.error ? <div className="p-3"><ErrorNote error={rooms.error} onRetry={() => void rooms.refetch()} /></div> : null}
            {!rooms.isLoading && !ordered.length ? <Empty icon="chat" title={tab === 'Archived' ? 'Nothing archived' : filter === 'Unread' ? 'Nothing unread' : filter === 'Mentions' ? 'No mentions' : 'No conversations'} /> : null}
            {ordered.map((r) => {
              const group = r.type !== 'direct';
              const st = r.other_user_id ? PRESENCE[presenceOf(r.other_user_id) ?? ''] : undefined;
              const mine = !!r.last_message && String(r.last_message.sender_id) === String(me);
              const text = r.last_message?.type === 'voice' ? 'Voice message' : r.last_message?.type === 'file' ? 'Attachment' : r.last_message?.type === 'call' ? 'Call' : (r.last_message?.text ?? '');
              if (tab === 'Archived') {
                return (
                  <div key={r.id} className="flex items-center gap-3 pr-2 pl-2.5">
                    <UserAvatar userId={roomPerson(r)} name={r.avatar_name || r.name} size={42} className={group ? '!rounded-[13px]' : ''} />
                    <span className="flex min-w-0 flex-1 items-center gap-2 border-b border-line py-[11px]">
                      <span className="flex min-w-0 flex-1 flex-col gap-[3px]">
                        <b className="truncate text-[14px] text-ink">{r.name}</b>
                        <span className="truncate text-[12.5px] text-ink-3">{text}</span>
                      </span>
                      <button
                        type="button"
                        className="h-[30px] shrink-0 rounded-full bg-selection px-3 text-[12px] font-bold whitespace-nowrap text-primary hover:brightness-95"
                        onClick={() => void apiPost(`/api/chat/rooms/${r.id}/flags`, { archived: false }).then(() => qc.invalidateQueries({ queryKey: ['chat', 'rooms'] }), (e) => toast('error', errorMessage(e)))}
                      >
                        Move back to chats
                      </button>
                    </span>
                  </div>
                );
              }
              return (
                <button key={r.id} type="button" onClick={() => openChatDrawer(String(r.id))} onContextMenu={(e) => (e.preventDefault(), setMenu({ x: e.clientX, y: e.clientY, id: r.id }))} className="flex w-full items-center gap-3 rounded-[12px] px-2.5 text-left hover:bg-subtle">
                  <span className="relative shrink-0">
                    <UserAvatar userId={roomPerson(r)} name={r.avatar_name || r.name} size={46} className={group ? '!rounded-[14px]' : ''} />
                    {st ? <span className={cx('absolute right-0 bottom-0 h-3 w-3 rounded-full border-[2.5px] border-surface', st.dot)} aria-label={st.label} /> : null}
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col gap-[3px] border-b border-line py-[11px]">
                    <span className="flex items-baseline gap-2">
                      <b className="min-w-0 flex-1 truncate text-[14px] text-ink">{r.name}</b>
                      <span className={cx('shrink-0 text-[11.5px]', r.unread ? 'font-bold text-primary' : 'text-ink-3')}>{listStamp(r.last_message?.created_at ?? r.updated_at)}</span>
                    </span>
                    <span className="flex min-h-5 items-center gap-[5px]">
                      <span className={cx('min-w-0 flex-1 truncate text-[12.5px]', r.unread ? 'font-semibold text-ink' : 'text-ink-3')}>
                        {mine ? <span className="font-semibold text-ink-2">You: </span> : null}
                        {text}
                      </span>
                      {r.muted ? <Icon name="volume-off" size={13} className="shrink-0 text-ink-3" label="Muted" /> : null}
                      {r.pinned ? <Icon name="pin" size={13} className="shrink-0 text-ink-3" label="Pinned" /> : null}
                      {r.mentions ? <span className="flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full bg-primary text-[11px] font-extrabold text-white" aria-label="Mentions you">@</span> : null}
                      {r.unread ? <span className={cx('flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full px-1.5 text-[11px] font-bold text-white', r.muted ? 'bg-ink-3' : 'bg-primary')}>{r.unread}</span> : null}
                    </span>
                  </span>
                </button>
              );
            })}
          </>
        )}
      </div>
      {starting ? (
        <NewChat
          onClose={() => setStarting(false)}
          onOpened={(id) => {
            setStarting(false);
            openChatDrawer(String(id));
          }}
        />
      ) : null}
      {menu && all.some((r) => r.id === menu.id) ? (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          label="Conversation actions"
          sections={roomMenu(all.find((r) => r.id === menu.id)!, { pinned: all.filter((r) => r.pinned).length, mac: isMac }, (a) => actions.run(all.find((r) => r.id === menu.id)!, a))}
          onClose={() => setMenu(null)}
        />
      ) : null}
      {actions.dialogs}
    </>
  );
}

function Conversation({ roomId }: { roomId: string }) {
  const rooms = useRooms();
  const room = (rooms.data?.data.rooms ?? []).find((r) => String(r.id) === roomId);
  const [menu, setMenu] = useState(false);
  const [typing, setTyping] = useState<string[]>([]);
  const [hiddenFor, setHiddenFor] = useState<string | null>(null);
  const presenceOf = usePresence([room?.other_user_id]);
  const st = room?.other_user_id ? PRESENCE[presenceOf(room.other_user_id) ?? ''] : undefined;
  const tab = useStore(tabsStore, (s) => s.tabs.find((t) => t.id === s.activeId) ?? null);
  const link = tab ? webPathOfRoute(tab.route) : null;
  const page = link ? refOf(link)?.kind === 'page' : false;
  const attach = async () => {
    if (!tab || !link) return;
    // The tab's title, then a full link that names its organisation, what it is and which (worksuite-desktop#266):
    // every reader's app draws it as a card, and none gets a bare path.
    const s = app.get();
    const full = shareLink(link, { org: tab.organizationId ?? s.organizationId, origin: s.auth?.server?.origin });
    try {
      await apiPost('/api/chat/messages', { room_id: Number(roomId), message: `${tab.title}\n${full}`, client_message_id: `desktop-${crypto.randomUUID()}` });
      toast('success', page ? 'Page attached.' : 'Record attached.');
    } catch (e) {
      toast('error', errorMessage(e));
    }
  };
  const recordApp = tab ? APP_CATALOGUE.find((x) => x.id === tab.app) : undefined;
  // A small chip inside the message box rather than a card over the conversation (worksuite-desktop#164).
  const chip =
    link && tab && hiddenFor !== tab.id ? (
      <div data-record-chip className="mx-1 mb-1 flex max-w-full items-center gap-1.5 self-start rounded-full bg-subtle py-0.5 pr-0.5 pl-1 text-[11.5px] text-ink-2">
        <AppTile icon={recordApp?.icon ?? 'link'} colour={appColour(recordApp?.id ?? 'crm')} size={18} radius={9} iconSize={10} />
        <span className="min-w-0 truncate" title={`${tab.title} is open — messages can link to it`}>
          <b className="text-ink">{tab.title}</b> is open
        </span>
        <button type="button" onClick={() => void attach()} title="Attach a link to it to the conversation" className="flex h-5 shrink-0 items-center gap-1 rounded-full bg-selection px-2 text-[11px] font-bold text-primary hover:brightness-95">
          <Icon name="link" size={11} />
          {page ? 'Attach page' : 'Attach record'}
        </button>
        <button type="button" aria-label="Hide" title="Hide" onClick={() => setHiddenFor(tab.id)} className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-ink-3 hover:bg-surface hover:text-ink">
          <Icon name="x" size={11} />
        </button>
      </div>
    ) : null;
  const status = typing.length ? (typing.length === 1 ? 'typing…' : `${typing.length} people typing…`) : (st?.label ?? (room && room.type !== 'direct' ? 'Group' : ''));
  return (
    <>
      <div className="flex h-[58px] shrink-0 items-center gap-1 border-b border-line bg-surface pr-3 pl-2">
        <button type="button" aria-label="Back to chats" onClick={() => openChatDrawer(null)} className={hbtn}>
          <Icon name="chevron-left" size={18} />
        </button>
        <span className="relative ml-0.5 shrink-0">
          <UserAvatar userId={roomPerson(room)} name={room?.avatar_name || room?.name} size={36} className={room && room.type !== 'direct' ? '!rounded-[10px]' : ''} />
          {st ? <span className={cx('absolute -right-0.5 -bottom-0.5 h-3 w-3 rounded-full border-2 border-surface', st.dot)} /> : null}
        </span>
        <span className="ml-1.5 flex min-w-0 flex-1 flex-col">
          <b className="truncate text-[14px] text-ink" title={room?.name ?? undefined}>
            {room?.name ?? 'Conversation'}
          </b>
          <span className={cx('truncate text-[12px]', typing.length ? 'font-semibold text-success' : 'text-ink-3')}>{status}</span>
        </span>
        {canCall(room) ? (
          <>
            <button type="button" aria-label="Voice call" title="Voice call" onClick={() => void startCall(roomId, 'audio', room?.name)} className={cx(hbtn, '!text-primary')}>
              <Icon name="phone" size={17} />
            </button>
            <button type="button" aria-label="Video call" title="Video call" onClick={() => void startCall(roomId, 'video', room?.name)} className={cx(hbtn, '!text-primary')}>
              <Icon name="video" size={17} />
            </button>
          </>
        ) : null}
        <span className="relative">
          <button type="button" aria-label="More" title="More" aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu(!menu)} className={hbtn}>
            <Icon name="more-vertical" size={17} />
          </button>
          {menu ? (
            <div role="menu" className="absolute top-9 right-0 z-30 w-48 rounded-[12px] bg-surface p-1.5 shadow-[0_16px_40px_rgb(var(--ws-shadow-rgb)/.2),0_0_0_1px_var(--ws-edge)]">
              <button type="button" role="menuitem" className="flex h-8 w-full items-center gap-2.5 rounded-[8px] px-2.5 text-left text-[13px] text-ink hover:bg-subtle" onClick={() => (minimiseChatDrawer(), navigate(`/chat?room=${roomId}`))}>
                <Icon name="maximize" size={14} className="text-ink-2" />
                Open in Chat
              </button>
              <button type="button" role="menuitem" className="flex h-8 w-full items-center gap-2.5 rounded-[8px] px-2.5 text-left text-[13px] text-ink hover:bg-subtle" onClick={() => (setMenu(false), void apiPost(`/api/chat/rooms/${roomId}/flags`, { muted: !room?.muted }).catch((e) => toast('error', errorMessage(e))))}>
                <Icon name={room?.muted ? 'volume' : 'volume-off'} size={14} className="text-ink-2" />
                {room?.muted ? 'Unmute' : 'Mute'}
              </button>
              <button type="button" role="menuitem" className="flex h-8 w-full items-center gap-2.5 rounded-[8px] px-2.5 text-left text-[13px] text-ink hover:bg-subtle" onClick={() => (setMenu(false), void openChatWindow(roomId, room?.name).then(minimiseChatDrawer, (e) => toast('error', errorMessage(e))))}>
                <Icon name="external" size={14} className="text-ink-2" />
                Open in new window
              </button>
              <button type="button" role="menuitem" className="flex h-8 w-full items-center gap-2.5 rounded-[8px] px-2.5 text-left text-[13px] text-ink hover:bg-subtle" onClick={() => (setMenu(false), minimiseChatDrawer())}>
                <Icon name="minus" size={14} className="text-ink-2" />
                Minimise to the corner
              </button>
            </div>
          ) : null}
        </span>
        <span className="mx-1 h-5 w-px bg-line" aria-hidden />
        <button type="button" aria-label="Close" title="Close" onClick={() => ui.set({ dock: null, chatRoom: null })} className={hbtn}>
          <Icon name="x" size={16} />
        </button>
      </div>
      <div className="min-h-0 flex-1">
        <Thread roomId={roomId} room={room} mini bare drawer boxChip={chip} onTyping={setTyping} rooms={rooms.data?.data.rooms ?? []} />
      </div>
    </>
  );
}

/** Conversations minimised from the drawer, waiting in the corner. */
export function MinimisedChats() {
  const ids = useStore(ui, (s) => s.chatMinimised);
  const open = useStore(ui, (s) => s.dock === 'chat');
  const rooms = useRooms();
  if (!ids.length || open) return null;
  return (
    <div aria-label="Minimised chats" className="absolute bottom-3.5 left-6 z-20 flex gap-2">
      {ids.map((id) => {
        const r = (rooms.data?.data.rooms ?? []).find((x) => String(x.id) === id);
        return (
          <span key={id} className="group flex h-[38px] items-center gap-2 rounded-full bg-navy pr-2 pl-2 text-[12.5px] font-semibold text-white shadow-[0_8px_20px_rgb(var(--ws-shadow-rgb)/.25)]">
            <button type="button" onClick={() => openChatDrawer(id)} className="flex items-center gap-2">
              <UserAvatar userId={roomPerson(r)} name={r?.avatar_name || r?.name} size={22} className={r && r.type !== 'direct' ? '!rounded-[6px]' : ''} />
              <span className="max-w-[140px] truncate">{r?.name ?? 'Conversation'}</span>
              {r?.unread ? <span className="rounded-[8px] bg-badge px-1.5 text-[10.5px]">{r.unread}</span> : null}
            </button>
            <button type="button" aria-label={`Close ${r?.name ?? 'conversation'}`} onClick={() => ui.set((s) => ({ chatMinimised: s.chatMinimised.filter((x) => x !== id) }))} className="flex h-5 w-5 items-center justify-center rounded-full text-navy-ink opacity-60 group-hover:opacity-100 hover:bg-white/10 hover:text-white">
              <Icon name="x" size={12} />
            </button>
          </span>
        );
      })}
    </div>
  );
}
