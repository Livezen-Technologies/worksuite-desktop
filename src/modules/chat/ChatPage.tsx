import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { apiGet, apiGetMeta } from '../../core/api';
import { useTab, useTabTitle } from '../../core/tab-context';
import { listStamp } from '../../core/time';
import { Icon } from '../../components/Icon';
import { Avatar, CountBadge, Empty, ErrorNote, IconButton, OfflineNote, Spinner, cx } from '../../components/ui';
import type { ModuleProps } from '../registry';
import { NewChat } from './NewChat';
import { roomFromRoute } from './routes';
import { Thread } from './Thread';
import type { Room } from './types';
import { useWebsiteAccess, useWebsiteInbox } from './website/api';
import { WebsiteInbox } from './website/WebsiteInbox';
import { WebsiteThread } from './website/WebsiteThread';

/**
 * Chat (UI-08, FR-COM-02/03, §4.15): the main app, the same thread in a
 * popped-out mini window that can stay on top. A message sent while offline
 * waits in the queue and shows as pending until it is delivered (WF-17);
 * each carries a client message id, so a replay never posts it twice.
 * Website staff also see their visitors' chats, under Website.
 */
/** What `GET /api/chat/presence` reports (ChatPresence::effective) — `online`, not the `available` one chooses. */
type Presence = 'online' | 'busy' | 'dnd' | 'away' | 'offline';

const PRESENCE: Record<Presence, { dot: string; label: string }> = {
  online: { dot: 'bg-success', label: 'Online' },
  busy: { dot: 'bg-danger', label: 'Busy' },
  dnd: { dot: 'bg-danger', label: 'Do not disturb' },
  away: { dot: 'bg-warning', label: 'Away' },
  offline: { dot: 'bg-line', label: 'Offline' },
};

export default function ChatPage({ tabId }: ModuleProps) {
  const { query, go, path } = useTab();
  const mini = tabId.startsWith('window-chat-mini');
  const room = roomFromRoute(query, path);
  const website = query.get('website');
  const mode: 'team' | 'website' = website || query.get('view') === 'website' ? 'website' : 'team';
  const websiteAccess = useWebsiteAccess();
  const websiteOpen = useWebsiteInbox(false, websiteAccess);
  const waiting = (websiteOpen.data?.conversations ?? []).filter((c) => c.awaiting_reply).length;
  const [q, setQ] = useState('');
  const [starting, setStarting] = useState(false);
  const rooms = useQuery({ queryKey: ['chat', 'rooms'], queryFn: ({ signal }) => apiGetMeta<{ rooms: Room[] }>('/api/chat/rooms', undefined, signal) });
  const all = rooms.data?.data.rooms ?? [];
  const list = all.filter((r) => !q || r.name.toLowerCase().includes(q.toLowerCase()));
  const current = all.find((r) => String(r.id) === room);
  const people = [...new Set(all.map((r) => r.other_user_id).filter((id): id is number => typeof id === 'number'))];
  const presence = useQuery({
    queryKey: ['chat', 'presence', people.join(',')],
    queryFn: ({ signal }) => apiGet<{ presence: Record<string, Presence> }>('/api/chat/presence', { ids: people.join(',') }, signal),
    enabled: !mini && people.length > 0,
    refetchInterval: 60_000,
  });
  useTabTitle(mode === 'website' ? (website ? null : 'Website chats') : current ? `Chat · ${current.name}` : 'Chat');

  return (
    <div className="flex h-full">
      {!mini ? (
        <div className="flex w-[330px] shrink-0 flex-col border-r border-line bg-surface">
          <div className="px-4 pt-4 pb-3">
            <div className="flex items-center gap-2">
              <h1 className="flex-1 text-[20px] font-bold text-ink">Chat</h1>
              {mode === 'team' ? <IconButton icon="compose" label="New conversation" onClick={() => setStarting(true)} /> : null}
            </div>
            <div className="mt-3 flex h-9 items-center gap-2 rounded-[9px] bg-ground px-3">
              <Icon name="search" size={15} className="text-ink-3" />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={mode === 'website' ? 'Search visitors' : 'Search chats'} aria-label={mode === 'website' ? 'Search visitors' : 'Search chats'} className="flex-1 bg-transparent text-[13px] outline-none" />
            </div>
            {websiteAccess ? (
              <div className="mt-3 grid grid-cols-2 gap-0.5 rounded-[9px] bg-ground p-0.5" role="tablist" aria-label="Conversations">
                <button type="button" role="tab" aria-selected={mode === 'team'} onClick={() => go('/chat')} className={cx('rounded-[7px] py-1.5 text-[12.5px] font-semibold', mode === 'team' ? 'bg-surface text-ink shadow-sm' : 'text-ink-3 hover:text-ink')}>
                  Team
                </button>
                <button type="button" role="tab" aria-selected={mode === 'website'} onClick={() => go('/chat?view=website')} className={cx('flex items-center justify-center gap-1.5 rounded-[7px] py-1.5 text-[12.5px] font-semibold', mode === 'website' ? 'bg-surface text-ink shadow-sm' : 'text-ink-3 hover:text-ink')}>
                  Website {waiting ? <span className="rounded-full bg-danger px-1.5 text-[11px] text-white">{waiting}</span> : null}
                </button>
              </div>
            ) : null}
            {mode === 'team' && rooms.data?.offline ? <div className="mt-2"><OfflineNote cachedAt={rooms.data.cachedAt} /></div> : null}
          </div>
          {mode === 'website' ? <WebsiteInbox selected={website} q={q} /> : null}
          <div className={cx('min-h-0 flex-1 overflow-y-auto scroll-thin', mode === 'website' && 'hidden')}>
            {rooms.isLoading ? <Spinner /> : rooms.error ? <div className="p-4"><ErrorNote error={rooms.error} onRetry={() => void rooms.refetch()} /></div> : list.length === 0 ? <Empty icon="chat" title="No conversations" /> : null}
            {list.map((r) => {
              const status = r.other_user_id ? presence.data?.presence[String(r.other_user_id)] : undefined;
              return (
                <button key={r.id} type="button" onClick={() => go(`/chat?room=${r.id}`)} className={cx('flex w-full items-center gap-3 px-4 py-3 text-left', String(r.id) === room ? 'bg-selection' : 'hover:bg-subtle')}>
                  <span className="relative">
                    <Avatar name={r.avatar_name || r.name} size={40} />
                    {status && PRESENCE[status] ? <span className={cx('absolute -right-0.5 -bottom-0.5 h-3 w-3 rounded-full border-2 border-surface', PRESENCE[status].dot)} aria-label={PRESENCE[status].label} title={PRESENCE[status].label} /> : null}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span className={cx('flex-1 truncate text-[14px]', r.unread ? 'font-bold text-ink' : 'font-semibold text-ink')}>{r.name}</span>
                      <span className="shrink-0 text-[12px] text-ink-3">{listStamp(r.last_message?.created_at ?? r.updated_at)}</span>
                    </span>
                    <span className="flex items-center gap-2">
                      <span className="flex-1 truncate text-[13px] text-ink-3">{r.last_message?.type === 'voice' ? 'Voice note' : (r.last_message?.text ?? '')}</span>
                      {r.muted ? <Icon name="bell" size={12} className="text-ink-3 opacity-60" /> : null}
                      <CountBadge n={r.unread} />
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      ) : null}
      <div className="flex min-w-0 flex-1 flex-col bg-ground">
        {mode === 'website' ? (
          website ? <WebsiteThread key={website} id={website} /> : <Empty icon="globe" title="Pick a website chat" hint="Visitors waiting for a reply are listed first." />
        ) : room ? (
          <Thread key={room} roomId={room} room={current} mini={mini} />
        ) : (
          <Empty icon="chat" title="Pick a conversation" hint={websiteAccess ? 'Messages from your team appear here; website visitors are under Website.' : 'Messages from your team appear here.'} />
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
    </div>
  );
}
