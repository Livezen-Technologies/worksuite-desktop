import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { OfflineMutation } from '@shared/types';
import { app } from '../../core/app-state';
import { apiGet, apiGetMeta, apiPost } from '../../core/api';
import { call, errorMessage, on, registerDropped } from '../../core/bridge';
import { useDraft } from '../../core/drafts';
import { useStore } from '../../core/store';
import { useTab, useTabTitle } from '../../core/tab-context';
import { dayKey, dayLabel, listStamp, parseTs, timeLabel } from '../../core/time';
import { toast } from '../../core/toasts';
import { uploadBlob } from '../../core/upload';
import { Icon } from '../../components/Icon';
import { Avatar, CountBadge, Empty, ErrorNote, FileBadge, IconButton, OfflineNote, Spinner, cx } from '../../components/ui';
import type { ModuleProps } from '../registry';
import { roomFromRoute } from './routes';
import { useWebsiteAccess, useWebsiteInbox } from './website/api';
import { WebsiteInbox } from './website/WebsiteInbox';
import { WebsiteThread } from './website/WebsiteThread';

/**
 * Chat (UI-08, FR-COM-02/03, §4.15): the main app, the same thread in a
 * popped-out mini window that can stay on top. A message sent while offline
 * waits in the queue and shows as pending until it is delivered (WF-17);
 * each carries a client message id, so a replay never posts it twice.
 */
interface Room {
  id: number;
  type: string;
  name: string;
  avatar_name: string;
  last_message: { text: string; sender_id: number; created_at: string; type: string } | null;
  unread: number;
  updated_at: string;
  pinned: boolean;
  muted: boolean;
  mentions: number;
}

interface ChatMessage {
  id: number;
  room_id: number;
  sender_id: number;
  sender_name: string;
  type: string;
  message: string | null;
  file: { id: number; filename: string; size: number; is_image: boolean; url: string | null; download_url: string | null; status: string } | null;
  reactions: Array<{ emoji: string; count: number; mine: boolean }>;
  reply_preview: { sender_name: string; snippet: string } | null;
  edited: boolean;
  deleted: boolean;
  receipt: { status: 'sent' | 'delivered' | 'read'; read: number; total: number } | null;
  client_message_id: string | null;
  created_at: string;
}

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
  const rooms = useQuery({ queryKey: ['chat', 'rooms'], queryFn: ({ signal }) => apiGetMeta<{ rooms: Room[] }>('/api/chat/rooms', undefined, signal) });
  const list = (rooms.data?.data.rooms ?? []).filter((r) => !q || r.name.toLowerCase().includes(q.toLowerCase()));
  const current = rooms.data?.data.rooms.find((r) => String(r.id) === room);
  useTabTitle(mode === 'website' ? (website ? null : 'Website chats') : current ? `Chat · ${current.name}` : 'Chat');

  return (
    <div className="flex h-full">
      {!mini ? (
        <div className="flex w-[330px] shrink-0 flex-col border-r border-line bg-surface">
          <div className="px-4 pt-4 pb-3">
            <h1 className="text-[20px] font-bold text-ink">Chat</h1>
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
            {list.map((r) => (
              <button key={r.id} type="button" onClick={() => go(`/chat?room=${r.id}`)} className={cx('flex w-full items-center gap-3 px-4 py-3 text-left', String(r.id) === room ? 'bg-selection' : 'hover:bg-subtle')}>
                <Avatar name={r.avatar_name || r.name} size={40} />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    <span className={cx('flex-1 truncate text-[14px]', r.unread ? 'font-bold text-ink' : 'font-semibold text-ink')}>{r.name}</span>
                    <span className="shrink-0 text-[12px] text-ink-3">{listStamp(r.last_message?.created_at ?? r.updated_at)}</span>
                  </span>
                  <span className="flex items-center gap-2">
                    <span className="flex-1 truncate text-[13px] text-ink-3">{r.last_message?.text ?? ''}</span>
                    {r.muted ? <Icon name="bell" size={12} className="text-ink-3 opacity-60" /> : null}
                    <CountBadge n={r.unread} />
                  </span>
                </span>
              </button>
            ))}
          </div>
        </div>
      ) : null}
      <div className="flex min-w-0 flex-1 flex-col bg-ground">
        {mode === 'website' ? (
          website ? <WebsiteThread key={website} id={website} /> : <Empty icon="globe" title="Pick a website chat" hint="Visitors waiting for a reply are listed first." />
        ) : room ? (
          <Thread roomId={room} room={current} mini={mini} />
        ) : (
          <Empty icon="chat" title="Pick a conversation" hint={websiteAccess ? 'Messages from your team appear here; website visitors are under Website.' : 'Messages from your team appear here.'} />
        )}
      </div>
    </div>
  );
}

function Thread({ roomId, room, mini }: { roomId: string; room: Room | undefined; mini: boolean }) {
  const qc = useQueryClient();
  const me = useStore(app, (s) => s.auth?.user?.id);
  const scroller = useRef<HTMLDivElement>(null);
  const [typing, setTyping] = useState<string | null>(null);
  const [drag, setDrag] = useState(false);
  const msgs = useInfiniteQuery({
    queryKey: ['chat', 'messages', roomId],
    initialPageParam: null as number | null,
    queryFn: ({ pageParam, signal }) => apiGet<{ messages: ChatMessage[] }>('/api/chat/messages', { room_id: roomId, before: pageParam ?? undefined }, signal),
    getNextPageParam: (last) => (last.messages.length >= 40 ? last.messages[0]?.id : undefined),
  });
  const pending = useQuery({ queryKey: ['offline', 'pending'], queryFn: () => call('offline:pending') });
  const mine = (pending.data ?? []).filter((m: OfflineMutation) => m.module === 'chat' && m.entityId === roomId && m.state !== 'DONE');
  const messages = useMemo(() => {
    const pages = [...(msgs.data?.pages ?? [])].reverse();
    return pages.flatMap((p) => p.messages);
  }, [msgs.data]);

  // Mark the room read while it is on screen.
  useEffect(() => {
    if (!msgs.isSuccess || messages.length === 0) return;
    void apiPost('/api/chat/read', { room_id: Number(roomId) })
      .then(() => qc.invalidateQueries({ queryKey: ['chat', 'rooms'] }))
      .catch(() => undefined);
  }, [msgs.isSuccess, messages.length, roomId, qc]);

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight });
  }, [messages.length, mine.length]);

  useEffect(
    () =>
      on<{ type: string; room_id?: number; name?: string; user_name?: string }>('realtime:event', (e) => {
        if (String(e.room_id) !== roomId) return;
        if (e.type === 'chat.typing.started') setTyping(e.name ?? e.user_name ?? 'Someone');
        if (e.type === 'chat.typing.stopped' || e.type === 'chat.message') setTyping(null);
      }),
    [roomId],
  );

  const onDrop = async (files: File[]) => {
    setDrag(false);
    try {
      const handles = await registerDropped(files);
      if (handles.length) {
        await call('transfers:upload', { handles: handles.map((h) => h.handle), target: { kind: 'chat', roomId } });
        toast('info', `Sending ${handles.length} file${handles.length === 1 ? '' : 's'}…`);
      }
    } catch (e) {
      toast('error', errorMessage(e));
    }
  };

  const days = messages.map((m, i) => {
    const day = dayKey(parseTs(m.created_at));
    return i === 0 || dayKey(parseTs(messages[i - 1]!.created_at)) !== day ? day : null;
  });
  return (
    <div
      className="relative flex h-full flex-col"
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('Files')) {
          e.preventDefault();
          setDrag(true);
        }
      }}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => {
        e.preventDefault();
        void onDrop(Array.from(e.dataTransfer.files));
      }}
    >
      <div className="flex items-center gap-3 border-b border-line bg-surface px-5 py-3">
        <Avatar name={room?.avatar_name || room?.name} size={mini ? 30 : 38} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[15px] font-bold text-ink">{room?.name ?? 'Conversation'}</div>
          <div className="truncate text-[12.5px] text-ink-3">{typing ? `${typing} is typing…` : room?.type === 'direct' ? 'Direct message' : room?.type ?? ''}</div>
        </div>
        {!mini ? <IconButton icon="external" label="Pop out" onClick={() => void call('windows:open', { kind: 'chat-mini', route: `/chat?room=${roomId}`, title: room?.name, alwaysOnTop: true })} /> : null}
      </div>
      <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto px-5 py-4 scroll-thin">
        {msgs.hasNextPage ? (
          <div className="mb-3 text-center">
            <button type="button" className="text-[12.5px] font-semibold text-primary hover:underline" onClick={() => void msgs.fetchNextPage()}>
              {msgs.isFetchingNextPage ? 'Loading…' : 'Load earlier messages'}
            </button>
          </div>
        ) : null}
        {msgs.isLoading ? <Spinner /> : msgs.error ? <ErrorNote error={msgs.error} onRetry={() => void msgs.refetch()} /> : null}
        {messages.map((m, i) => {
          const header = days[i];
          const own = String(m.sender_id) === me;
          return (
            <div key={m.id}>
              {header ? <div className="my-3 text-center"><span className="rounded-full bg-subtle px-3 py-1 text-[12px] font-semibold text-ink-2">{dayLabel(header, 'short')}</span></div> : null}
              <Bubble m={m} own={own} />
            </div>
          );
        })}
        {mine.map((p) => (
          <div key={p.id} className="mt-2 flex justify-end">
            <div className="max-w-[70%] rounded-[14px] border-2 border-dashed border-primary/40 bg-surface px-4 py-2.5 text-[13.5px] text-ink">
              <div>{p.label.replace(/^Message: /, '')}</div>
              <div className="mt-1 flex items-center gap-1 text-[11.5px] text-ink-3">
                <Icon name="clock" size={12} /> {p.state === 'FAILED' || p.state === 'CONFLICT' ? `Not sent — ${p.error ?? 'retry from the connection menu'}` : 'Pending — sends when back online'}
              </div>
            </div>
          </div>
        ))}
      </div>
      <Composer roomId={roomId} roomName={room?.name ?? 'this conversation'} onFiles={onDrop} />
      {drag ? (
        <div className="pointer-events-none absolute inset-3 flex items-center justify-center rounded-[14px] border-2 border-dashed border-primary bg-selection/80 text-[15px] font-semibold text-primary">
          Drop to send to {room?.name ?? 'this conversation'}
        </div>
      ) : null}
    </div>
  );
}

function Bubble({ m, own }: { m: ChatMessage; own: boolean }) {
  const { openLink } = useTab();
  if (m.type === 'system') return <div className="my-2 text-center text-[12px] text-ink-3">{m.message}</div>;
  return (
    <div className={cx('mt-2 flex gap-3', own && 'flex-row-reverse')}>
      {!own ? <Avatar name={m.sender_name} size={32} /> : null}
      <div className={cx('flex max-w-[70%] flex-col', own && 'items-end')}>
        {!own ? (
          <div className="mb-0.5 text-[12.5px]">
            <span className="font-semibold text-ink">{m.sender_name}</span> <span className="text-ink-3">{timeLabel(m.created_at)}</span>
          </div>
        ) : null}
        {m.reply_preview ? <div className="mb-1 rounded-[8px] border-l-2 border-primary bg-subtle px-2.5 py-1 text-[12px] text-ink-2">{m.reply_preview.sender_name}: {m.reply_preview.snippet}</div> : null}
        {m.message && !m.deleted ? (
          <div className={cx('whitespace-pre-wrap break-words rounded-[14px] px-4 py-2.5 text-[13.5px] leading-relaxed selectable', own ? 'bg-primary text-white' : 'border border-line bg-surface text-ink')}>{m.message}</div>
        ) : m.deleted ? (
          <div className="rounded-[14px] border border-line px-4 py-2 text-[12.5px] italic text-ink-3">Message deleted</div>
        ) : null}
        {m.file ? (
          <button type="button" onClick={() => m.file?.download_url && openLink(m.file.download_url)} className="mt-1 flex items-center gap-3 rounded-[12px] border border-line bg-surface px-3 py-2.5 text-left hover:bg-subtle">
            <FileBadge name={m.file.filename} />
            <span>
              <span className="block max-w-[260px] truncate text-[13px] font-semibold text-ink">{m.file.filename}</span>
              <span className="block text-[11.5px] text-ink-3">{Math.max(1, Math.round(m.file.size / 1024))} KB{m.file.status !== 'ready' ? ` · ${m.file.status}` : ''}</span>
            </span>
          </button>
        ) : null}
        {m.reactions.length ? (
          <div className="mt-1 flex gap-1">
            {m.reactions.map((r) => (
              <span key={r.emoji} className={cx('rounded-full border px-2 py-0.5 text-[12px]', r.mine ? 'border-primary/40 bg-selection' : 'border-line bg-surface')}>
                {r.emoji} {r.count}
              </span>
            ))}
          </div>
        ) : null}
        {own ? (
          <div className="mt-0.5 text-[11.5px] text-ink-3">
            {timeLabel(m.created_at)}
            {m.edited ? ' · edited' : ''}
            {m.receipt ? ` · ${m.receipt.status === 'read' ? `Read by ${m.receipt.read}` : m.receipt.status === 'delivered' ? 'Delivered' : 'Sent'}` : ''}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function Composer({ roomId, roomName, onFiles }: { roomId: string; roomName: string; onFiles: (files: File[]) => void }) {
  const qc = useQueryClient();
  const draft = useDraft<string>('chat', `room:${roomId}`, '');
  const [sending, setSending] = useState(false);
  const send = async () => {
    const text = draft.value.trim();
    if (!text) return;
    setSending(true);
    const clientId = `desktop-${crypto.randomUUID()}`;
    try {
      const r = await call('offline:submit', {
        module: 'chat',
        entity: 'message',
        entityId: roomId,
        label: `Message: ${text.slice(0, 180)}`,
        method: 'POST',
        path: '/api/chat/messages',
        body: { room_id: Number(roomId), message: text, client_message_id: clientId },
        queueIfOffline: true,
      });
      if (!r.delivered && !r.queued) {
        toast('error', r.code === 'POLICY_DENIED' ? `${r.error} Your message is kept as a draft.` : (r.error ?? 'Not sent.'));
        return;
      }
      draft.setValue('');
      await draft.clear();
      void qc.invalidateQueries({ queryKey: r.queued ? ['offline'] : ['chat', 'messages', roomId] });
      void qc.invalidateQueries({ queryKey: ['chat', 'rooms'] });
    } catch (e) {
      toast('error', errorMessage(e));
    } finally {
      setSending(false);
    }
  };
  const attach = async () => {
    try {
      const picked = await call('files:pickFiles', { multiple: true, title: `Send files to ${roomName}` });
      if (picked.length) await call('transfers:upload', { handles: picked.map((p) => p.handle), target: { kind: 'chat', roomId } });
    } catch (e) {
      toast('error', errorMessage(e));
    }
  };
  return (
    <div className="border-t border-line bg-surface px-5 py-3">
      <div className="flex items-end gap-2 rounded-[12px] border border-line bg-surface px-3 py-2 focus-within:border-primary">
        <IconButton icon="paperclip" label="Attach files" onClick={() => void attach()} />
        <textarea
          value={draft.value}
          onChange={(e) => draft.setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              void send();
            }
          }}
          onPaste={(e) => {
            // FR-XFR-05: a pasted screenshot or file is sent, on the user's paste only.
            const files = Array.from(e.clipboardData.files);
            if (files.length === 0) return;
            e.preventDefault();
            const onDisk = files.filter((f) => f.size > 0 && f.name && !f.type.startsWith('image/'));
            const images = files.filter((f) => f.type.startsWith('image/'));
            if (onDisk.length) onFiles(onDisk);
            for (const img of images) {
              void uploadBlob(img, img.name || `Screenshot ${new Date().toISOString().slice(0, 19).replace('T', ' ')}.png`, { kind: 'chat', roomId })
                .then(({ uploadId }) => apiPost('/api/chat/messages/attachments', { room_id: Number(roomId), upload_id: uploadId, client_message_id: `desktop-${crypto.randomUUID()}` }))
                .then(() => qc.invalidateQueries({ queryKey: ['chat', 'messages', roomId] }))
                .catch((err) => toast('error', errorMessage(err)));
            }
          }}
          rows={1}
          placeholder={`Message ${roomName} (drop files to upload)`}
          aria-label="Message"
          className="max-h-40 min-h-[36px] flex-1 resize-none bg-transparent py-2 text-[13.5px] outline-none"
        />
        <IconButton icon="send" label="Send" onClick={() => void send()} disabled={sending || !draft.value.trim()} className="!text-primary" />
      </div>
    </div>
  );
}
