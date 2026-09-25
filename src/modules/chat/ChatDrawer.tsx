import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { ApiError, apiGet, apiGetMeta, apiPost } from '../../core/api';
import { errorMessage } from '../../core/bridge';
import { useStore } from '../../core/store';
import { TabProvider } from '../../core/tab-context';
import { navigate, tabsStore } from '../../core/tabs';
import { listStamp } from '../../core/time';
import { toast } from '../../core/toasts';
import { minimiseChatDrawer, openChatDrawer, ui } from '../../core/ui';
import { Icon } from '../../components/Icon';
import { Avatar, CountBadge, Empty, ErrorNote, Spinner, cx } from '../../components/ui';
import { resolveWebLink } from '@shared/links';
import { APP_CATALOGUE } from '@shared/apps';
import { describeCall, type CallRow, type Kind } from '../calls/log';
import { startCall } from '../calls/start';
import { PRESENCE } from './Details';
import { NewChat } from './NewChat';
import { Thread } from './Thread';
import type { Room } from './types';

const GLYPH: Record<Kind, [string, string]> = {
  missed: ['↙', 'bg-[#FCE9E4] text-[#B42318] dark:bg-danger-bg dark:text-danger'],
  in: ['↙', 'bg-[#E4F4EA] text-[#1F7A4D] dark:bg-success-bg dark:text-success'],
  out: ['↗', 'bg-selection text-primary'],
  live: ['●', 'bg-[#E4F4EA] text-[#1F7A4D] dark:bg-success-bg dark:text-success'],
};

/** The web address of what the active tab shows, when it is a record. */
function recordLink(route: string): string | null {
  const [path] = route.split('?');
  const seg = path!.replace(/^\/+/, '').split('/');
  if (seg.length < 2 && !route.includes('?')) return null;
  const app = APP_CATALOGUE.find((a) => a.id === seg[0]);
  if (!app || app.id === 'chat' || app.id === 'home') return null;
  const web = `${app.webPath}${route.slice(app.id.length + 1)}`;
  return resolveWebLink(web).kind === 'none' ? null : web;
}

/**
 * The chat drawer (ChatDrawer, ChatDrawerCalls): chat over whatever you are
 * doing, from the title bar. Chats, calls and archived conversations; a
 * conversation opens in place, and minimising leaves it in the corner.
 */
export function ChatDrawer() {
  const room = useStore(ui, (s) => s.chatRoom);
  return (
    <>
      <button type="button" aria-label="Close the chat drawer" className="absolute inset-0 z-20 cursor-default bg-[rgba(15,27,61,.12)]" onClick={minimiseChatDrawer} />
      <aside aria-label="Chat drawer" className="absolute top-0 right-0 bottom-0 z-30 flex w-[408px] flex-col border-l border-line bg-surface shadow-[-12px_0_36px_rgba(15,27,61,.16)]">
        <TabProvider tabId="chat-drawer" route={room ? `/chat?room=${room}` : '/chat'} active onGo={(r) => navigate(r)}>
          {room ? <Conversation roomId={room} /> : <Lists />}
        </TabProvider>
      </aside>
    </>
  );
}

function useRooms() {
  return useQuery({ queryKey: ['chat', 'rooms'], queryFn: ({ signal }) => apiGetMeta<{ rooms: Room[] }>('/api/chat/rooms', undefined, signal) });
}

function Header({ children }: { children: React.ReactNode }) {
  return <div className="flex h-[54px] shrink-0 items-center gap-1.5 border-b border-line px-3">{children}</div>;
}

const hbtn = 'flex h-8 min-w-8 items-center justify-center rounded-[7px] px-1.5 text-[13px] text-ink-2 hover:bg-subtle hover:text-ink';

function Lists() {
  const qc = useQueryClient();
  const [tab, setTab] = useState<'Chats' | 'Calls' | 'Archived'>('Chats');
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<'All' | 'Missed' | 'Incoming' | 'Outgoing'>('All');
  const [starting, setStarting] = useState(false);
  const rooms = useRooms();
  const all = (rooms.data?.data.rooms ?? []).filter((r) => r.type !== 'widget');
  const calls = useQuery({
    queryKey: ['chat', 'calls', 'history'],
    queryFn: ({ signal }) => apiGet<CallRow[]>('/api/chat/calls/history', undefined, signal),
    enabled: tab === 'Calls',
    refetchInterval: 30_000,
    retry: false,
  });
  const needle = q.trim().toLowerCase();
  const nameOf = (c: CallRow) => c.room_name ?? all.find((r) => r.id === c.room_id)?.name ?? c.caller_name;
  const list = tab === 'Archived' ? all.filter((r) => r.archived) : all.filter((r) => !r.archived);
  const shown = list.filter((r) => !needle || r.name.toLowerCase().includes(needle));
  const log = (calls.data ?? []).filter((c) => {
    const k = describeCall(c).kind;
    if (filter === 'Missed' && k !== 'missed') return false;
    if (filter === 'Incoming' && c.direction !== 'incoming') return false;
    if (filter === 'Outgoing' && c.direction !== 'outgoing') return false;
    return !needle || nameOf(c).toLowerCase().includes(needle);
  });
  return (
    <>
      <Header>
        <b className="flex-1 text-[15px] text-ink">Chat</b>
        <button type="button" aria-label="New conversation" onClick={() => setStarting(true)} className="h-8 rounded-[7px] bg-primary px-3 text-[12.5px] font-bold text-white hover:bg-primary-hover">New</button>
        <button type="button" aria-label="Open full chat" title="Open full chat" onClick={() => (minimiseChatDrawer(), navigate('/chat'))} className={hbtn}>⤢</button>
        <button type="button" aria-label="Minimise" title="Minimise" onClick={minimiseChatDrawer} className={hbtn}>–</button>
        <button type="button" aria-label="Close" title="Close" onClick={minimiseChatDrawer} className={hbtn}>×</button>
      </Header>
      <div role="tablist" className="flex shrink-0 border-b border-line px-2">
        {(['Chats', 'Calls', 'Archived'] as const).map((t) => (
          <button key={t} type="button" role="tab" aria-selected={tab === t} onClick={() => setTab(t)} className={cx('h-[38px] px-3 text-[13px]', tab === t ? 'font-bold text-primary shadow-[inset_0_-2px_0_var(--color-primary)]' : 'font-medium text-ink-2')}>
            {t}
          </button>
        ))}
      </div>
      <div className="shrink-0 px-3 py-2.5">
        <input value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search conversations and people" placeholder="Search conversations and people…" className="h-8 w-full rounded-[8px] bg-subtle px-2.5 text-[13px] text-ink outline-none" />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto scroll-thin">
        {tab === 'Calls' ? (
          <>
            <div className="flex gap-1 px-3 pb-2 text-[11.5px] font-semibold">
              {(['All', 'Missed', 'Incoming', 'Outgoing'] as const).map((f) => (
                <button key={f} type="button" aria-pressed={filter === f} onClick={() => setFilter(f)} className={cx('rounded-[10px] px-2 py-[3px]', filter === f ? 'bg-ink text-surface' : 'border border-line text-ink')}>
                  {f}
                </button>
              ))}
            </div>
            {calls.isLoading ? <Spinner /> : calls.error ? (
              calls.error instanceof ApiError && calls.error.status === 404 ? <Empty icon="phone" title="Call history needs a newer WorkSuite" /> : <div className="p-3"><ErrorNote error={calls.error} onRetry={() => void calls.refetch()} /></div>
            ) : !log.length ? <Empty icon="phone" title="No calls" /> : null}
            {log.map((c) => {
              const d = describeCall(c);
              return (
                <div key={c.uuid} className="flex items-center gap-2.5 border-b border-line px-3.5 py-2.5">
                  <span className={cx('flex h-8 w-8 shrink-0 items-center justify-center rounded-full font-bold', GLYPH[d.kind][1])} aria-hidden>{GLYPH[d.kind][0]}</span>
                  <span className="flex min-w-0 flex-1 flex-col">
                    <b className="truncate text-[13px] text-ink">{nameOf(c)}</b>
                    <span className={cx('truncate text-[12px]', d.kind === 'missed' ? 'text-danger' : 'text-ink-3')}>{d.line}</span>
                  </span>
                  <span className="flex shrink-0 flex-col items-end gap-0.5">
                    <span className="text-[11px] text-ink-3">{listStamp(c.started_at)}</span>
                    <button type="button" onClick={() => void startCall(c.room_id, c.mode, nameOf(c))} className="text-[12px] font-semibold text-primary hover:underline">{d.action}</button>
                  </span>
                </div>
              );
            })}
          </>
        ) : (
          <>
            {rooms.isLoading ? <Spinner /> : rooms.error ? <div className="p-3"><ErrorNote error={rooms.error} onRetry={() => void rooms.refetch()} /></div> : null}
            {!rooms.isLoading && !shown.length ? <Empty icon="chat" title={tab === 'Archived' ? 'Nothing archived' : 'No conversations'} /> : null}
            {shown.map((r) =>
              tab === 'Archived' ? (
                <div key={r.id} className="flex items-center gap-2.5 border-b border-line px-3.5 py-2.5">
                  <b className="min-w-0 flex-1 truncate text-[13px] text-ink">{r.name}</b>
                  <button
                    type="button"
                    className="text-[12px] font-semibold text-primary hover:underline"
                    onClick={() => void apiPost(`/api/chat/rooms/${r.id}/flags`, { archived: false }).then(() => qc.invalidateQueries({ queryKey: ['chat', 'rooms'] }), (e) => toast('error', errorMessage(e)))}
                  >
                    Move back to chats
                  </button>
                </div>
              ) : (
                <button key={r.id} type="button" onClick={() => openChatDrawer(String(r.id))} className="flex w-full items-center gap-2.5 px-3.5 py-2 text-left hover:bg-subtle">
                  <Avatar name={r.avatar_name || r.name} size={34} className={r.type !== 'direct' ? '!rounded-[10px]' : ''} />
                  <span className="flex min-w-0 flex-1 flex-col">
                    <b className="truncate text-[13px] text-ink">{r.name}</b>
                    <span className="truncate text-[12px] text-ink-3">{r.last_message?.text ?? ''}</span>
                  </span>
                  <span className="flex shrink-0 flex-col items-end gap-1">
                    <span className="text-[11px] text-ink-3">{listStamp(r.last_message?.created_at ?? r.updated_at)}</span>
                    {r.unread ? <CountBadge n={r.unread} /> : null}
                  </span>
                </button>
              ),
            )}
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
    </>
  );
}

function Conversation({ roomId }: { roomId: string }) {
  const rooms = useRooms();
  const room = (rooms.data?.data.rooms ?? []).find((r) => String(r.id) === roomId);
  const [menu, setMenu] = useState(false);
  const presence = useQuery({
    queryKey: ['chat', 'presence', String(room?.other_user_id ?? '')],
    queryFn: ({ signal }) => apiGet<{ presence: Record<string, string> }>('/api/chat/presence', { ids: String(room!.other_user_id) }, signal),
    enabled: !!room?.other_user_id,
    refetchInterval: 60_000,
  });
  const st = room?.other_user_id ? PRESENCE[presence.data?.presence[String(room.other_user_id)] ?? ''] : undefined;
  const tab = useStore(tabsStore, (s) => s.tabs.find((t) => t.id === s.activeId) ?? null);
  const link = tab ? recordLink(tab.route) : null;
  const attach = async () => {
    if (!tab || !link) return;
    try {
      await apiPost('/api/chat/messages', { room_id: Number(roomId), message: `${tab.title}\n${link}`, client_message_id: `desktop-${crypto.randomUUID()}` });
      toast('success', 'Record attached.');
    } catch (e) {
      toast('error', errorMessage(e));
    }
  };
  return (
    <>
      <Header>
        <button type="button" aria-label="Back to chats" onClick={() => openChatDrawer(null)} className={hbtn}>‹</button>
        <span className="relative">
          <Avatar name={room?.avatar_name || room?.name} size={32} className={room && room.type !== 'direct' ? '!rounded-[9px]' : ''} />
          {st ? <span className={cx('absolute -right-px -bottom-px h-[10px] w-[10px] rounded-full border-2 border-surface', st.dot)} /> : null}
        </span>
        <span className="flex min-w-0 flex-1 flex-col">
          <b className="truncate text-[13.5px] text-ink">{room?.name ?? 'Conversation'}</b>
          <span className="truncate text-[11.5px] text-ink-3">{st?.label ?? (room && room.type !== 'direct' ? 'Group' : '')}</span>
        </span>
        <button type="button" aria-label="Voice call" title="Voice call" onClick={() => void startCall(roomId, 'audio', room?.name)} className={hbtn}>
          <Icon name="phone" size={15} />
        </button>
        <button type="button" aria-label="Video call" title="Video call" onClick={() => void startCall(roomId, 'video', room?.name)} className={hbtn}>
          <Icon name="video" size={15} />
        </button>
        <span className="relative">
          <button type="button" aria-label="More" aria-expanded={menu} onClick={() => setMenu(!menu)} className={hbtn}>⋯</button>
          {menu ? (
            <div role="menu" className="absolute top-9 right-0 z-10 w-48 rounded-[10px] border border-line bg-surface py-1 shadow-xl">
              <button type="button" role="menuitem" className="block w-full px-3 py-1.5 text-left text-[13px] hover:bg-subtle" onClick={() => (minimiseChatDrawer(), navigate(`/chat?room=${roomId}`))}>Open in Chat</button>
              <button type="button" role="menuitem" className="block w-full px-3 py-1.5 text-left text-[13px] hover:bg-subtle" onClick={() => (setMenu(false), void apiPost(`/api/chat/rooms/${roomId}/flags`, { muted: !room?.muted }).catch((e) => toast('error', errorMessage(e))))}>{room?.muted ? 'Unmute' : 'Mute'}</button>
            </div>
          ) : null}
        </span>
        <button type="button" aria-label="Minimise" title="Minimise" onClick={minimiseChatDrawer} className={hbtn}>–</button>
        <button type="button" aria-label="Maximise" title="Open in Chat" onClick={() => (minimiseChatDrawer(), navigate(`/chat?room=${roomId}`))} className={hbtn}>□</button>
        <button type="button" aria-label="Close" title="Close" onClick={() => ui.set({ dock: null, chatRoom: null })} className={hbtn}>×</button>
      </Header>
      {link && tab ? (
        <div className="flex shrink-0 items-center gap-2 border-b border-line bg-subtle px-3 py-1.5 text-[12px] text-ink-2">
          <span className="min-w-0 flex-1 truncate">
            Context: <b className="text-ink">{tab.title}</b> is open — messages can link to it
          </span>
          <button type="button" onClick={() => void attach()} className="shrink-0 font-semibold text-primary hover:underline">Attach record</button>
        </div>
      ) : null}
      <div className="min-h-0 flex-1">
        <Thread roomId={roomId} room={room} mini bare rooms={rooms.data?.data.rooms ?? []} />
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
    <div aria-label="Minimised chats" className="absolute right-5 bottom-3 z-20 flex gap-2">
      {ids.map((id) => {
        const r = (rooms.data?.data.rooms ?? []).find((x) => String(x.id) === id);
        return (
          <span key={id} className="flex items-center gap-1.5 rounded-full border border-line bg-surface py-1 pr-1.5 pl-1 text-[12.5px] font-semibold text-ink shadow-[0_6px_18px_rgba(15,27,61,.14)]">
            <button type="button" onClick={() => openChatDrawer(id)} className="flex items-center gap-1.5">
              <Avatar name={r?.avatar_name || r?.name} size={24} />
              <span className="max-w-[140px] truncate">{r?.name ?? 'Conversation'}</span>
              {r?.unread ? <CountBadge n={r.unread} /> : null}
            </button>
            <button type="button" aria-label={`Close ${r?.name ?? 'conversation'}`} onClick={() => ui.set((s) => ({ chatMinimised: s.chatMinimised.filter((x) => x !== id) }))} className="px-1 text-ink-3 hover:text-ink">×</button>
          </span>
        );
      })}
    </div>
  );
}
