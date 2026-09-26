import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { ApiError, apiGet, apiGetMeta, apiPost } from '../../core/api';
import { errorMessage } from '../../core/bridge';
import { app } from '../../core/app-state';
import { useStore } from '../../core/store';
import { TabProvider } from '../../core/tab-context';
import { navigate, tabsStore } from '../../core/tabs';
import { listStamp, parseTs } from '../../core/time';
import { toast } from '../../core/toasts';
import { minimiseChatDrawer, openChatDrawer, ui } from '../../core/ui';
import { Icon } from '../../components/Icon';
import { Avatar, Empty, ErrorNote, Spinner, cx } from '../../components/ui';
import { resolveWebLink } from '@shared/links';
import { APP_CATALOGUE } from '@shared/apps';
import { appColour } from '../../core/app-look';
import { AppTile } from '../../components/AppTile';
import { describeCall, type CallRow, type Kind } from '../calls/log';
import { useNow } from '../calls/parts';
import { answerCall, startCall } from '../calls/start';
import { PRESENCE } from './Details';
import { NewChat } from './NewChat';
import { Thread } from './Thread';
import type { Room } from './types';

const GLYPH: Record<Kind, [string, string]> = {
  missed: ['↙', 'text-danger'],
  in: ['↙', 'text-success'],
  out: ['↗', 'text-primary'],
  live: ['●', 'text-success'],
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
const WIDTH_KEY = 'ws.chatDrawer.width';

function savedWidth(): number {
  try {
    const w = Number(localStorage.getItem(WIDTH_KEY));
    return w >= 360 && w <= 900 ? w : 408;
  } catch {
    return 408;
  }
}

export function ChatDrawer() {
  const room = useStore(ui, (s) => s.chatRoom);
  const [width, setWidth] = useState(savedWidth);
  // Drag the left edge to make it wider or narrower; the width is remembered.
  const resize = (e: React.MouseEvent) => {
    e.preventDefault();
    const right = (e.currentTarget.parentElement?.getBoundingClientRect().right ?? window.innerWidth);
    let last = width;
    const move = (m: MouseEvent) => {
      last = Math.round(Math.max(360, Math.min(Math.min(900, window.innerWidth - 420), right - m.clientX)));
      setWidth(last);
    };
    const up = () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
      document.body.style.cursor = '';
      try {
        localStorage.setItem(WIDTH_KEY, String(last));
      } catch {
        // The width is a convenience.
      }
    };
    document.body.style.cursor = 'ew-resize';
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  };
  return (
    <aside aria-label="Chat drawer" className="absolute top-0 right-0 bottom-0 z-30 flex flex-col bg-surface shadow-[-14px_0_36px_rgba(15,27,61,.16)]" style={{ width }}>
      <div aria-hidden onMouseDown={resize} onDoubleClick={() => setWidth(408)} title="Drag to resize" className="absolute top-0 bottom-0 -left-1.5 z-10 w-1.5 cursor-ew-resize bg-transparent hover:bg-line" />
      <TabProvider tabId="chat-drawer" route={room ? `/chat?room=${room}` : '/chat'} active onGo={(r) => navigate(r)}>
        {room ? <Conversation roomId={room} /> : <Lists />}
      </TabProvider>
    </aside>
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
  const [tab, setTab] = useState<Tab>('Chats');
  const now = useNow(60_000);
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<'All' | 'Unread' | 'Mentions'>('All');
  const [callFilter, setCallFilter] = useState<'All' | 'Missed' | 'Incoming' | 'Outgoing'>('All');
  const [starting, setStarting] = useState(false);
  const rooms = useRooms();
  const all = (rooms.data?.data.rooms ?? []).filter((r) => r.type !== 'widget');
  const calls = useQuery({
    queryKey: ['chat', 'calls', 'history'],
    queryFn: ({ signal }) => apiGet<CallRow[]>('/api/chat/calls/history', undefined, signal),
    refetchInterval: tab === 'Calls' ? 30_000 : 120_000,
    retry: false,
  });
  const people = [...new Set(all.map((r) => r.other_user_id).filter((id): id is number => typeof id === 'number'))];
  const presence = useQuery({
    queryKey: ['chat', 'presence', people.join(',')],
    queryFn: ({ signal }) => apiGet<{ presence: Record<string, string> }>('/api/chat/presence', { ids: people.join(',') }, signal),
    enabled: people.length > 0,
    refetchInterval: 60_000,
  });
  const needle = q.trim().toLowerCase();
  const nameOf = (c: CallRow) => c.room_name ?? all.find((r) => r.id === c.room_id)?.name ?? c.caller_name;
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
  const log = (calls.data ?? []).filter((c) => {
    const k = describeCall(c).kind;
    if (callFilter === 'Missed' && k !== 'missed') return false;
    if (callFilter === 'Incoming' && c.direction !== 'incoming') return false;
    if (callFilter === 'Outgoing' && c.direction !== 'outgoing') return false;
    return !needle || nameOf(c).toLowerCase().includes(needle);
  });
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
          {(['All', 'Missed', 'Incoming', 'Outgoing'] as const).map((f) => (
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
          <>
            {calls.isLoading ? <Spinner /> : calls.error ? (
              calls.error instanceof ApiError && calls.error.status === 404 ? <Empty icon="phone" title="Call history needs a newer WorkSuite" /> : <div className="p-3"><ErrorNote error={calls.error} onRetry={() => void calls.refetch()} /></div>
            ) : !log.length ? <Empty icon="phone" title="No calls" /> : null}
            {log.map((c) => {
              const d = describeCall(c);
              const room = all.find((r) => r.id === c.room_id);
              const group = !!room && room.type !== 'direct';
              return (
                <div key={c.uuid} className="flex items-center gap-3 rounded-[12px] pr-2 pl-2.5">
                  <Avatar name={room?.avatar_name || nameOf(c)} size={42} className={group ? '!rounded-[13px]' : ''} />
                  <span className="flex min-w-0 flex-1 items-center gap-2 border-b border-line py-[11px]">
                    <span className="flex min-w-0 flex-1 flex-col gap-[3px]">
                      <b className={cx('truncate text-[14px]', d.kind === 'missed' ? 'text-danger' : 'text-ink')}>{nameOf(c)}</b>
                      <span className="flex items-center gap-[5px] text-[12px] text-ink-3">
                        <span className={cx('font-bold', GLYPH[d.kind][1])} aria-hidden>{GLYPH[d.kind][0]}</span>
                        <span className="truncate">{d.line}</span>
                      </span>
                    </span>
                    <span className="flex shrink-0 flex-col items-end gap-1">
                      <span className="text-[11.5px] text-ink-3">{d.kind === 'live' ? 'now' : listStamp(c.started_at)}</span>
                      {d.kind !== 'live' ? <span className="text-[11.5px] font-semibold whitespace-nowrap text-primary">{d.action}</span> : null}
                    </span>
                    <button
                      type="button"
                      aria-label={`${d.action} ${nameOf(c)}`}
                      title={d.action}
                      onClick={() => (d.kind === 'live' ? void answerCall(c.uuid, String(c.room_id), false, nameOf(c)) : void startCall(c.room_id, c.mode, nameOf(c)))}
                      className={cx('flex h-9 w-9 shrink-0 items-center justify-center rounded-full', d.kind === 'live' ? 'bg-[#1F9D5C] text-white' : 'bg-selection text-primary hover:brightness-95')}
                    >
                      <Icon name={c.mode === 'video' ? 'video' : 'phone'} size={16} />
                    </button>
                  </span>
                </div>
              );
            })}
          </>
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
              const st = r.other_user_id ? PRESENCE[presence.data?.presence[String(r.other_user_id)] ?? ''] : undefined;
              const mine = !!r.last_message && String(r.last_message.sender_id) === String(me);
              const text = r.last_message?.type === 'voice' ? 'Voice message' : r.last_message?.type === 'file' ? 'Attachment' : r.last_message?.type === 'call' ? 'Call' : (r.last_message?.text ?? '');
              if (tab === 'Archived') {
                return (
                  <div key={r.id} className="flex items-center gap-3 pr-2 pl-2.5">
                    <Avatar name={r.avatar_name || r.name} size={42} className={group ? '!rounded-[13px]' : ''} />
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
                <button key={r.id} type="button" onClick={() => openChatDrawer(String(r.id))} className="flex w-full items-center gap-3 rounded-[12px] px-2.5 text-left hover:bg-subtle">
                  <span className="relative shrink-0">
                    <Avatar name={r.avatar_name || r.name} size={46} className={group ? '!rounded-[14px]' : ''} />
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
                      {r.unread ? <span className="flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-primary px-1.5 text-[11px] font-bold text-white">{r.unread}</span> : null}
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
    </>
  );
}

function Conversation({ roomId }: { roomId: string }) {
  const rooms = useRooms();
  const room = (rooms.data?.data.rooms ?? []).find((r) => String(r.id) === roomId);
  const [menu, setMenu] = useState(false);
  const [typing, setTyping] = useState<string[]>([]);
  const [hiddenFor, setHiddenFor] = useState<string | null>(null);
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
  const recordApp = tab ? APP_CATALOGUE.find((x) => x.id === tab.app) : undefined;
  const banner =
    link && tab && hiddenFor !== tab.id ? (
      <div className="relative z-10 mx-2.5 mt-2.5 flex shrink-0 items-center gap-2.5 rounded-[12px] bg-surface py-2 pr-2 pl-2.5 shadow-[0_1px_3px_rgba(15,27,61,.12)]">
        <AppTile icon={recordApp?.icon ?? 'link'} colour={appColour(recordApp?.id ?? 'crm')} size={30} radius={8} iconSize={15} />
        <span className="min-w-0 flex-1 text-[12px] leading-snug text-ink-2">
          <b className="text-ink">{tab.title}</b> is open — messages can link to it
        </span>
        <button type="button" onClick={() => void attach()} className="flex h-[30px] shrink-0 items-center gap-1.5 rounded-full bg-selection px-3 text-[12px] font-bold text-primary hover:brightness-95">
          <Icon name="link" size={13} />
          Attach record
        </button>
        <button type="button" aria-label="Hide" title="Hide" onClick={() => setHiddenFor(tab.id)} className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-ink-3 hover:bg-subtle hover:text-ink">
          <Icon name="x" size={13} />
        </button>
      </div>
    ) : null;
  const status = typing.length ? (typing.length === 1 ? 'typing…' : `${typing.length} people typing…`) : (st?.label ?? (room && room.type !== 'direct' ? 'Group' : ''));
  return (
    <>
      <div className="flex h-[58px] shrink-0 items-center gap-1 border-b border-line pr-2 pl-2">
        <button type="button" aria-label="Back to chats" onClick={() => openChatDrawer(null)} className={hbtn}>
          <Icon name="chevron-left" size={18} />
        </button>
        <span className="relative ml-0.5 shrink-0">
          <Avatar name={room?.avatar_name || room?.name} size={36} className={room && room.type !== 'direct' ? '!rounded-[10px]' : ''} />
          {st ? <span className={cx('absolute -right-0.5 -bottom-0.5 h-3 w-3 rounded-full border-2 border-surface', st.dot)} /> : null}
        </span>
        <span className="ml-1.5 flex min-w-0 flex-1 flex-col">
          <b className="truncate text-[14px] text-ink">{room?.name ?? 'Conversation'}</b>
          <span className={cx('truncate text-[12px]', typing.length ? 'font-semibold text-success' : 'text-ink-3')}>{status}</span>
        </span>
        <button type="button" aria-label="Voice call" title="Voice call" onClick={() => void startCall(roomId, 'audio', room?.name)} className={cx(hbtn, '!text-primary')}>
          <Icon name="phone" size={17} />
        </button>
        <button type="button" aria-label="Video call" title="Video call" onClick={() => void startCall(roomId, 'video', room?.name)} className={cx(hbtn, '!text-primary')}>
          <Icon name="video" size={17} />
        </button>
        <span className="relative">
          <button type="button" aria-label="More" aria-expanded={menu} onClick={() => setMenu(!menu)} className={hbtn}>
            <Icon name="more-vertical" size={17} />
          </button>
          {menu ? (
            <div role="menu" className="absolute top-9 right-0 z-30 w-48 rounded-[12px] bg-surface p-1.5 shadow-[0_16px_40px_rgba(15,27,61,.2),0_0_0_1px_rgba(15,27,61,.06)]">
              <button type="button" role="menuitem" className="flex h-8 w-full items-center gap-2.5 rounded-[8px] px-2.5 text-left text-[13px] text-ink hover:bg-subtle" onClick={() => (minimiseChatDrawer(), navigate(`/chat?room=${roomId}`))}>
                <Icon name="maximize" size={14} className="text-ink-2" />
                Open in Chat
              </button>
              <button type="button" role="menuitem" className="flex h-8 w-full items-center gap-2.5 rounded-[8px] px-2.5 text-left text-[13px] text-ink hover:bg-subtle" onClick={() => (setMenu(false), void apiPost(`/api/chat/rooms/${roomId}/flags`, { muted: !room?.muted }).catch((e) => toast('error', errorMessage(e))))}>
                <Icon name={room?.muted ? 'volume' : 'volume-off'} size={14} className="text-ink-2" />
                {room?.muted ? 'Unmute' : 'Mute'}
              </button>
            </div>
          ) : null}
        </span>
        <span className="mx-1 h-5 w-px bg-line" aria-hidden />
        <button type="button" aria-label="Minimise" title="Minimise to the corner" onClick={minimiseChatDrawer} className={hbtn}>
          <Icon name="minus" size={16} />
        </button>
        <button type="button" aria-label="Close" title="Close" onClick={() => ui.set({ dock: null, chatRoom: null })} className={hbtn}>
          <Icon name="x" size={16} />
        </button>
      </div>
      <div className="min-h-0 flex-1">
        <Thread roomId={roomId} room={room} mini bare drawer banner={banner} onTyping={setTyping} rooms={rooms.data?.data.rooms ?? []} />
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
          <span key={id} className="group flex h-[38px] items-center gap-2 rounded-full bg-navy pr-2 pl-2 text-[12.5px] font-semibold text-white shadow-[0_8px_20px_rgba(15,27,61,.25)]">
            <button type="button" onClick={() => openChatDrawer(id)} className="flex items-center gap-2">
              <Avatar name={r?.avatar_name || r?.name} size={22} className={r && r.type !== 'direct' ? '!rounded-[6px]' : ''} />
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
