import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { app } from '../../core/app-state';
import { apiGet, apiGetMeta, apiPost } from '../../core/api';
import { errorMessage } from '../../core/bridge';
import { useStore } from '../../core/store';
import { useTab, useTabTitle } from '../../core/tab-context';
import { listStamp } from '../../core/time';
import { toast } from '../../core/toasts';
import { Icon } from '../../components/Icon';
import { Avatar, Empty, ErrorNote, OfflineNote, Spinner, cx } from '../../components/ui';
import type { ModuleProps } from '../registry';
import { Details, PRESENCE } from './Details';
import { NewChat, StarredDialog } from './NewChat';
import { lastOrRecent, roomFromRoute } from './routes';
import { Thread } from './Thread';
import type { Room } from './types';
import { useWebsiteAccess, useWebsiteInbox, type WebsiteRow } from './website/api';
import { WebsiteWorkspace } from './website/WebsiteWorkspace';
import { SidePanel } from '../../components/SidePanel';

/**
 * Chat (UI-08, FR-COM-02/03, §4.15; the "Chat · conversations, thread,
 * message actions, composer, details" design): conversations grouped as
 * Pinned, Direct, Groups & channels and Website, the thread, and the
 * conversation's details. A message sent offline waits in the queue and shows
 * as pending (WF-17). Website staff get the website-chat workspace under the
 * Website filter, and their open visitors in the list.
 */
type Filter = 'all' | 'unread' | 'mentions' | 'archived';

const STATUS_CHOICES: Array<{ id: string; label: string; dot: string }> = [
  { id: 'available', label: 'Available', dot: 'bg-success' },
  { id: 'busy', label: 'Busy', dot: 'bg-danger' },
  { id: 'dnd', label: 'Do not disturb', dot: 'bg-danger' },
  { id: 'away', label: 'Away', dot: 'bg-warning' },
  { id: 'offline', label: 'Appear offline', dot: 'bg-line' },
];

export default function ChatPage({ tabId }: ModuleProps) {
  const { query, go, path } = useTab();
  const mini = tabId.startsWith('window-chat-mini');
  const room = roomFromRoute(query, path);
  const website = query.get('website');
  const workspace = query.get('view') === 'website';
  const websiteAccess = useWebsiteAccess();
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [starting, setStarting] = useState(false);
  const [starred, setStarred] = useState(false);
  const [details, setDetails] = useState(true);
  const rooms = useQuery({ queryKey: ['chat', 'rooms'], queryFn: ({ signal }) => apiGetMeta<{ rooms: Room[] }>('/api/chat/rooms', undefined, signal) });
  const all = (rooms.data?.data.rooms ?? []).filter((r) => r.type !== 'widget');
  const current = all.find((r) => String(r.id) === room);
  useTabTitle(workspace || website ? null : current ? `Chat · ${current.name}` : 'Chat');
  const me = useStore(app, (s) => s.auth?.user?.id);
  const lastKey = me ? `ws.chat.lastRoom.${me}` : null;

  // The conversation open now is the one Chat comes back to.
  useEffect(() => {
    if (!room || !current || !lastKey) return;
    try {
      localStorage.setItem(lastKey, room);
    } catch {
      // Remembering is a convenience; without it Chat opens the most recent conversation.
    }
  }, [room, current, lastKey]);

  // Chat opens on a conversation, never on an empty pane: the last one you had
  // open, or else the most recent.
  const reopen = !mini && !room && !workspace && !website && rooms.isSuccess ? lastOrRecent(all, lastKey) : null;
  useEffect(() => {
    if (reopen) go(`/chat?room=${reopen}`);
  }, [reopen, go]);

  // Every website chat opens in its workspace, wherever the link came from.
  if (workspace || website) return <WebsiteWorkspace />;

  return (
    <div className="flex h-full">
      {!mini ? (
        <SidePanel id="chat" label="the conversations">
          <Rail rooms={all} loading={rooms.isLoading} error={rooms.error} offline={rooms.data?.offline ? rooms.data.cachedAt : null} retry={() => void rooms.refetch()} selected={room} q={q} setQ={setQ} filter={filter} setFilter={setFilter} websiteAccess={websiteAccess} onNew={() => setStarting(true)} onStarred={() => setStarred(true)} />
        </SidePanel>
      ) : null}
      <div className="flex min-w-0 flex-1 bg-ground">
        {room ? (
          <>
            <div className="flex min-w-0 flex-1 flex-col">
              <Thread key={room} roomId={room} room={current} mini={mini} rooms={all} detailsOpen={details} onToggleDetails={() => setDetails(!details)} />
            </div>
            {details && current && !mini ? <Details room={current} onClose={() => setDetails(false)} /> : null}
          </>
        ) : rooms.isLoading || reopen ? (
          <Spinner />
        ) : (
          <Empty icon="chat" title="No conversations yet" hint="Start one with +." />
        )}
      </div>
      {starting ? (
        <NewChat
          onClose={() => setStarting(false)}
          onOpened={(id) => {
            setStarting(false);
            go(`/chat?room=${id}`);
          }}
        />
      ) : null}
      {starred ? (
        <StarredDialog
          onClose={() => setStarred(false)}
          onShow={(id) => {
            setStarred(false);
            go(`/chat?room=${id}`);
          }}
        />
      ) : null}
    </div>
  );
}

interface RailProps {
  rooms: Room[];
  loading: boolean;
  error: unknown;
  offline: string | null;
  retry: () => void;
  selected: string | null;
  q: string;
  setQ: (q: string) => void;
  filter: Filter;
  setFilter: (f: Filter) => void;
  websiteAccess: boolean;
  onNew: () => void;
  onStarred: () => void;
}

function Rail({ rooms, loading, error, offline, retry, selected, q, setQ, filter, setFilter, websiteAccess, onNew, onStarred }: RailProps) {
  const { go } = useTab();
  const people = [...new Set(rooms.map((r) => r.other_user_id).filter((id): id is number => typeof id === 'number'))];
  const presence = useQuery({
    queryKey: ['chat', 'presence', people.join(',')],
    queryFn: ({ signal }) => apiGet<{ presence: Record<string, string> }>('/api/chat/presence', { ids: people.join(',') }, signal),
    enabled: people.length > 0,
    refetchInterval: 60_000,
  });
  const web = useWebsiteInbox(false, websiteAccess);
  const needle = q.trim().toLowerCase();
  const search = useQuery({
    queryKey: ['chat', 'search', needle],
    queryFn: ({ signal }) => apiGet<{ results: Array<{ message_id: number; room_id: number; room_name: string; sender_name: string; snippet: string; created_at: string }> }>('/api/chat/search', { q: needle, kind: 'all' }, signal),
    enabled: needle.length >= 3,
    staleTime: 30_000,
  });

  const visible = rooms.filter((r) => {
    if (needle && !r.name.toLowerCase().includes(needle)) return false;
    if (filter === 'archived') return r.archived;
    if (r.archived) return false;
    if (filter === 'unread') return r.unread > 0;
    if (filter === 'mentions') return r.mentions > 0;
    return true;
  });
  const archived = rooms.filter((r) => r.archived).length;
  const sections: Array<[string, Room[]]> = [
    ['Pinned', visible.filter((r) => r.pinned)],
    ['Direct', visible.filter((r) => !r.pinned && r.type === 'direct')],
    ['Groups & channels', visible.filter((r) => !r.pinned && r.type !== 'direct')],
  ];
  const visitors = websiteAccess && filter === 'all' ? (web.data?.conversations ?? []).filter((c) => !needle || (c.visitor_name ?? c.label).toLowerCase().includes(needle)).slice(0, 6) : [];

  return (
    <aside aria-label="Conversations" className="flex w-[300px] shrink-0 flex-col border-r border-line bg-surface">
      <div className="flex flex-col gap-2 px-3 pt-3 pb-2">
        <div className="flex items-center gap-2">
          <MyStatus />
          <button type="button" aria-label="Starred messages" title="Starred messages" onClick={onStarred} className="flex h-8 w-8 items-center justify-center rounded-[8px] border border-line text-ink-2 hover:bg-subtle">
            <Icon name="star" size={15} />
          </button>
          <button type="button" aria-label="New conversation" title="New conversation" onClick={onNew} className="flex h-8 w-8 items-center justify-center rounded-[8px] bg-primary text-white hover:bg-primary-hover">
            <Icon name="plus" size={17} />
          </button>
        </div>
        <label className="flex h-[34px] items-center gap-2 rounded-[8px] bg-ground px-2.5 text-ink-3">
          <Icon name="search" size={14} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search messages, files and people…" aria-label="Search chat" className="flex-1 bg-transparent text-[13px] text-ink outline-none" />
        </label>
        <div role="tablist" className="flex gap-1 text-[12px] font-semibold">
          {(
            [
              ['all', 'All'],
              ['unread', 'Unread'],
              ['mentions', 'Mentions'],
            ] as Array<[Filter, string]>
          ).map(([f, l]) => (
            <button key={f} type="button" role="tab" aria-selected={filter === f} onClick={() => setFilter(f)} className={cx('shrink-0 rounded-full px-2.5 py-1', filter === f ? 'bg-ink text-surface' : 'border border-line text-ink hover:bg-subtle')}>
              {l}
            </button>
          ))}
          {websiteAccess ? (
            <button type="button" role="tab" aria-selected={false} onClick={() => go('/chat?view=website')} className="shrink-0 rounded-full border border-line px-2.5 py-1 text-ink hover:bg-subtle">
              Website
            </button>
          ) : null}
        </div>
        {offline ? <OfflineNote cachedAt={offline} /> : null}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto pb-2 scroll-thin">
        {filter === 'archived' ? (
          <button type="button" onClick={() => setFilter('all')} className="flex w-full items-center gap-2 px-3.5 py-2 text-left text-[12.5px] font-bold text-ink hover:bg-subtle">
            <Icon name="chevron-left" size={15} className="text-ink-3" /> Archived conversations
          </button>
        ) : archived && !needle ? (
          <button type="button" onClick={() => setFilter('archived')} className="flex w-full items-center gap-2.5 px-3.5 py-[7px] text-left hover:bg-subtle">
            <span className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-[9px] bg-subtle text-ink-2"><Icon name="archive" size={16} /></span>
            <b className="flex-1 text-[13px] font-semibold text-ink">Archived</b>
            <span className="text-[11.5px] font-semibold text-ink-3">{archived}</span>
          </button>
        ) : null}
        {loading ? <Spinner /> : error ? <div className="p-4"><ErrorNote error={error} onRetry={retry} /></div> : null}
        {!loading && !error && visible.length === 0 && visitors.length === 0 ? <Empty icon="chat" title={filter === 'archived' ? 'No archived conversations' : 'No conversations'} /> : null}
        {sections.map(([title, list]) =>
          list.length ? (
            <div key={title}>
              <div className="px-3.5 pt-2 pb-1 text-[10.5px] font-bold tracking-[0.6px] text-ink-3 uppercase">{title}</div>
              {list.map((r) => (
                <RoomRow key={r.id} r={r} active={String(r.id) === selected} status={r.other_user_id ? presence.data?.presence[String(r.other_user_id)] : undefined} onOpen={() => go(`/chat?room=${r.id}`)} />
              ))}
            </div>
          ) : null,
        )}
        {visitors.length ? (
          <div>
            <div className="px-3.5 pt-2 pb-1 text-[10.5px] font-bold tracking-[0.6px] text-ink-3 uppercase">Website</div>
            {visitors.map((c) => (
              <VisitorRow key={c.id} c={c} active={selected === `w${c.id}`} onOpen={() => go(`/chat?view=website&website=${c.id}`)} />
            ))}
          </div>
        ) : null}
        {needle.length >= 3 && search.data?.results.length ? (
          <div>
            <div className="px-3.5 pt-2 pb-1 text-[10.5px] font-bold tracking-[0.6px] text-ink-3 uppercase">Messages</div>
            {search.data.results.slice(0, 20).map((h) => (
              <button key={h.message_id} type="button" onClick={() => go(`/chat?room=${h.room_id}`)} className="flex w-full flex-col px-3.5 py-2 text-left hover:bg-subtle">
                <span className="flex gap-2 text-[12px]"><b className="flex-1 truncate text-ink">{h.room_name}</b><span className="text-ink-3">{listStamp(h.created_at)}</span></span>
                <span className="truncate text-[12px] text-ink-3">{h.sender_name}: {h.snippet}</span>
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </aside>
  );
}

function RoomRow({ r, active, status, onOpen }: { r: Room; active: boolean; status: string | undefined; onOpen: () => void }) {
  const st = status ? PRESENCE[status] : undefined;
  const group = r.type !== 'direct';
  const last = r.last_message?.type === 'voice' ? 'Voice message' : r.last_message?.type === 'file' ? 'Attachment' : (r.last_message?.text ?? '');
  const badge = r.mentions ? { text: String(r.mentions), cls: 'bg-badge' } : r.unread ? { text: String(r.unread), cls: 'bg-primary' } : null;
  return (
    <button type="button" onClick={onOpen} className={cx('flex w-full items-center gap-2.5 px-3.5 py-[7px] text-left', active ? 'bg-selection' : 'hover:bg-subtle')}>
      <span className="relative shrink-0">
        <Avatar name={r.avatar_name || r.name} size={34} className={group ? '!rounded-[9px]' : ''} />
        {st ? <span className={cx('absolute -right-px -bottom-px h-[10px] w-[10px] rounded-full border-2 border-surface', st.dot)} aria-label={st.label} title={st.label} /> : null}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex gap-1.5">
          <b className={cx('flex-1 truncate text-[13px] text-ink', !r.unread && 'font-semibold')}>{r.name}</b>
          <span className="shrink-0 text-[11px] text-ink-3">{listStamp(r.last_message?.created_at ?? r.updated_at)}</span>
        </span>
        <span className="block truncate text-[12px] text-ink-3">{r.muted ? `Muted · ${last}` : last}</span>
      </span>
      {badge ? <span className={cx('flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[10.5px] font-bold text-white', badge.cls)}>{badge.text}</span> : null}
    </button>
  );
}

function VisitorRow({ c, active, onOpen }: { c: WebsiteRow; active: boolean; onOpen: () => void }) {
  const name = c.visitor_name || c.label;
  return (
    <button type="button" onClick={onOpen} className={cx('flex w-full items-center gap-2.5 px-3.5 py-[7px] text-left', active ? 'bg-selection' : 'hover:bg-subtle')}>
      <span className="relative shrink-0">
        <Avatar name={name} size={34} />
        <span className={cx('absolute -right-px -bottom-px h-[10px] w-[10px] rounded-full border-2 border-surface', c.online ? 'bg-success' : 'bg-line')} aria-label={c.online ? 'On the site now' : 'Left the site'} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex gap-1.5">
          <b className="flex-1 truncate text-[13px] text-ink">{name}</b>
          <span className="shrink-0 text-[11px] text-ink-3">{listStamp(c.last_visitor_at ?? c.updated_at)}</span>
        </span>
        <span className="block truncate text-[12px] text-ink-3">{c.online ? `On the site now${c.current_url ? ` · ${c.current_url.replace(/^https?:\/\/[^/]+/, '') || '/'}` : ''}` : (c.site ?? 'Website')}</span>
      </span>
      {c.awaiting_reply ? <span className={cx('rounded-full px-1.5 text-[10.5px] font-bold text-white', c.at_risk || c.priority === 'urgent' ? 'bg-danger' : 'bg-badge')}>{c.at_risk ? 'At risk' : 'Waiting'}</span> : null}
    </button>
  );
}

/** "Set your status": the choice everybody sees on your avatar (presence heartbeats keep it live). */
function MyStatus() {
  const qc = useQueryClient();
  const user = useStore(app, (s) => s.auth?.user);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const me = useQuery({ queryKey: ['chat', 'presence', 'me'], queryFn: ({ signal }) => apiGet<{ status: string; choice: string }>('/api/chat/presence/me', undefined, signal), refetchInterval: 60_000 });
  const choice = STATUS_CHOICES.find((c) => c.id === (me.data?.choice ?? 'available')) ?? STATUS_CHOICES[0]!;
  useEffect(() => {
    if (!open) return;
    const off = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    window.addEventListener('mousedown', off);
    return () => window.removeEventListener('mousedown', off);
  }, [open]);
  const pick = async (id: string) => {
    setOpen(false);
    try {
      await apiPost('/api/chat/presence', { status: id, active: true });
      void qc.invalidateQueries({ queryKey: ['chat', 'presence'] });
    } catch (e) {
      toast('error', errorMessage(e));
    }
  };
  return (
    <div ref={ref} className="relative flex flex-1 items-center gap-2">
      <span className="relative shrink-0">
        <Avatar name={user?.name} size={32} />
        <span className={cx('absolute -right-px -bottom-px h-[10px] w-[10px] rounded-full border-2 border-surface', choice.dot)} />
      </span>
      <button type="button" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)} className="h-[30px] flex-1 truncate rounded-[7px] border border-line px-2 text-left text-[12px] text-ink-2 hover:bg-subtle">
        Set your status · {choice.label}
      </button>
      {open ? (
        <div role="menu" className="absolute top-9 left-0 z-30 w-52 rounded-[10px] border border-line bg-surface py-1 shadow-xl">
          {STATUS_CHOICES.map((c) => (
            <button key={c.id} type="button" role="menuitemradio" aria-checked={c.id === choice.id} onClick={() => void pick(c.id)} className="flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-[13px] text-ink hover:bg-subtle">
              <span className={cx('h-2.5 w-2.5 rounded-full', c.dot)} /> {c.label}
              {c.id === choice.id ? <Icon name="check" size={14} className="ml-auto text-primary" /> : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
