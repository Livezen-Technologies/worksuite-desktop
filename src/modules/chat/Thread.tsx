import { OutgoingMediaBubble, useOutgoingMedia } from './OutgoingMedia';
import { outgoing } from './outgoing';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { OfflineMutation } from '@shared/types';
import { useCanOpen, useVisibleIds } from '../../core/access';
import { app } from '../../core/app-state';
import { apiGet, apiPost, apiPut } from '../../core/api';
import { call, errorMessage, on, registerDropped } from '../../core/bridge';
import { useStore } from '../../core/store';
import { navigate } from '../../core/tabs';
import { useTab } from '../../core/tab-context';
import { dayKey, dayLabel, parseTs, timeLabel } from '../../core/time';
import { toast } from '../../core/toasts';
import { Icon } from '../../components/Icon';
import { ErrorNote, Spinner, cx } from '../../components/ui';
import { UserAvatar } from '../../components/UserAvatar';
import { openChatWindow } from './window';
import { startCall } from '../calls/start';
import { startMeetingFromChat } from '../meet/start';
import { Composer, type ComposerHandle } from './Composer';
import { PRESENCE } from './Details';
import { ForwardDialog, type RoomDetail } from './NewChat';
import { canCall, roomPerson, type ChatMessage, type Room } from './types';
import { CallCard } from './kit/CallCard';
import { TEAM_CAPS } from './kit/caps';
import type { KitItem } from './kit/grouping';
import type { MessageHandlers } from './kit/MessageActions';
import type { KitRenderers } from './kit/MessageBubble';
import { MessageList, PendingBubble } from './kit/MessageList';
import { fromChatMessage } from './kit/model';
import { MessageRecords } from './kit/TeamCards';
import { usePresence } from './presence';

export interface ReplyTarget {
  id: number;
  sender_name: string;
  snippet: string;
}

/** How long a "typing…" lasts if its "stopped" never arrives. */
const TYPING_TIMEOUT = 8_000;

const headerBtn = 'flex h-[34px] w-[34px] items-center justify-center rounded-[8px] border border-line bg-surface text-ink hover:bg-subtle';

/**
 * One conversation. `mini` is the pop-out window; `bare` drops the header
 * altogether, for a conversation shown beside something else (a call).
 */
export function Thread({
  roomId,
  room,
  mini,
  bare,
  drawer,
  boxChip,
  onTyping,
  rooms,
  detailsOpen,
  onToggleDetails,
}: {
  roomId: string;
  room: Room | undefined;
  mini: boolean;
  bare?: boolean;
  /** The chat drawer's conversation: its bubbles, action bar, quick actions and message box. */
  drawer?: boolean;
  /** Shown inside the message box, above the line you type in (the drawer's "record is open" chip, worksuite-desktop#164). */
  boxChip?: ReactNode;
  /** Who is typing, for a header drawn outside the thread. */
  onTyping?: (names: string[]) => void;
  rooms: Room[];
  detailsOpen?: boolean;
  onToggleDetails?: () => void;
}) {
  const qc = useQueryClient();
  const { openLink } = useTab();
  const visible = useVisibleIds();
  const outgoingCount = useStore(outgoing, (s) => s.jobs.filter((j) => j.roomId === roomId).length);
  const me = useStore(app, (s) => s.auth?.user?.id);
  const cardOrigin = useStore(app, (s) => s.auth?.server?.origin);
  const meetAllowed = useCanOpen('meet');
  // Making a task or a note from here crosses into Tasks or Notes: only for whoever has them.
  const tasksAllowed = useCanOpen('tasks');
  const notesAllowed = useCanOpen('notes');
  const scroller = useRef<HTMLDivElement>(null);
  const [typing, setTyping] = useState<Record<string, string>>({});
  const composer = useRef<ComposerHandle>(null);
  const [drag, setDrag] = useState(false);
  const [reply, setReply] = useState<ReplyTarget | null>(null);
  const [forwarding, setForwarding] = useState<ChatMessage | null>(null);
  const [searching, setSearching] = useState(false);
  const [saving, setSaving] = useState(false);
  const [find, setFind] = useState('');
  const [pinsOpen, setPinsOpen] = useState(false);
  const msgs = useInfiniteQuery({
    queryKey: ['chat', 'messages', roomId],
    initialPageParam: null as number | null,
    queryFn: ({ pageParam, signal }) => apiGet<{ messages: ChatMessage[] }>('/api/chat/messages', { room_id: roomId, before: pageParam ?? undefined }, signal),
    getNextPageParam: (last) => (last.messages.length >= 40 ? last.messages[0]?.id : undefined),
  });
  const detail = useQuery({ queryKey: ['chat', 'room', roomId], queryFn: ({ signal }) => apiGet<RoomDetail>(`/api/chat/rooms/${roomId}`, undefined, signal), enabled: !mini });
  // One presence for everybody, the list's and this header's (worksuite-desktop#183).
  const presenceOf = usePresence([...(detail.data?.members ?? []).map((m) => m.id), room?.other_user_id]);
  const pins = useQuery({ queryKey: ['chat', 'pins', roomId], queryFn: ({ signal }) => apiGet<{ messages: ChatMessage[] }>(`/api/chat/rooms/${roomId}/pins`, undefined, signal) });
  const found = useQuery({
    queryKey: ['chat', 'search', roomId, find.trim()],
    queryFn: ({ signal }) => apiGet<{ results: Array<{ message_id: number; sender_name: string; snippet: string; created_at: string }> }>('/api/chat/search', { q: find.trim(), room_id: roomId, kind: 'all' }, signal),
    enabled: searching && find.trim().length >= 2,
  });
  const pending = useQuery({ queryKey: ['offline', 'pending'], queryFn: () => call('offline:pending') });
  const mine = (pending.data ?? []).filter((m: OfflineMutation) => m.module === 'chat' && m.entityId === roomId && m.state !== 'DONE');
  const messages = useMemo(() => [...(msgs.data?.pages ?? [])].reverse().flatMap((p) => p.messages), [msgs.data]);
  const pendingMedia = useOutgoingMedia(roomId, messages);
  const mediaTransfers = useStore(app, (s) => s.transfers);
  const timeline = [
    ...messages.map((m, index) => ({ message: m, index, job: null, time: m.client_message_id ? Date.parse(mediaTransfers.find((t) => t.chat?.clientMessageId === m.client_message_id)?.createdAt ?? '') || parseTs(m.created_at).getTime() : parseTs(m.created_at).getTime() })),
    ...pendingMedia.map((job) => ({ message: null, index: 0, job, time: Date.parse(job.createdAt) })),
  ].sort((a, b) => a.time - b.time);

  // Mark the room read while it is on screen.
  useEffect(() => {
    if (!msgs.isSuccess || messages.length === 0) return;
    void apiPost('/api/chat/read', { room_id: Number(roomId) })
      .then(() => qc.invalidateQueries({ queryKey: ['chat', 'rooms'] }))
      .catch(() => undefined);
  }, [msgs.isSuccess, messages.length, roomId, qc]);

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight });
  }, [messages.length, mine.length, outgoingCount]);

  // Who is typing here, each until they stop, send, or go quiet.
  useEffect(() => {
    const clear = new Map<string, ReturnType<typeof setTimeout>>();
    const drop = (who: string) => {
      clearTimeout(clear.get(who));
      clear.delete(who);
      setTyping((t) => {
        if (!(who in t)) return t;
        const next = { ...t };
        delete next[who];
        return next;
      });
    };
    const off = on<{ type: string; room_id?: number; name?: string; user_name?: string; by?: number }>('realtime:event', (e) => {
      if (String(e.room_id) !== roomId || String(e.by) === me) return;
      const who = String(e.by ?? e.name ?? e.user_name ?? '');
      if (e.type === 'chat.typing.started' && who) {
        setTyping((t) => ({ ...t, [who]: e.name ?? e.user_name ?? 'Someone' }));
        clearTimeout(clear.get(who));
        clear.set(who, setTimeout(() => drop(who), TYPING_TIMEOUT));
      }
      if ((e.type === 'chat.typing.stopped' || e.type === 'chat.message') && who) drop(who);
      if (e.type === 'chat.message.pinned') void qc.invalidateQueries({ queryKey: ['chat', 'pins', roomId] });
      // A share card's access changed, or another file joined it (worksuite-desktop#164): drawn again for this reader.
      if (e.type === 'chat.message.card') void qc.invalidateQueries({ queryKey: ['chat', 'messages', roomId] });
    });
    return () => {
      off();
      clear.forEach((t) => clearTimeout(t));
    };
  }, [roomId, me, qc]);

  // The drawer draws "typing…" in its own header.
  useEffect(() => {
    onTyping?.(Object.values(typing));
  }, [typing, onTyping]);

  const onDrop = async (files: File[]) => {
    setDrag(false);
    try {
      composer.current?.stage(await registerDropped(files));
    } catch (e) {
      toast('error', errorMessage(e));
    }
  };

  const group = room?.type !== undefined && room.type !== 'direct';
  const members = detail.data?.members ?? [];
  const online = members.filter((m) => presenceOf(m.id) === 'online').length;
  const other = room?.other_user_id ? presenceOf(room.other_user_id) : undefined;
  const subtitle = group ? `Group · ${members.length || '…'} members${online ? ` · ${online} online` : ''}` : ((other ? PRESENCE[other]?.label : null) ?? 'Direct message');
  const pinned = pins.data?.messages ?? [];
  // The conversation through the kit: each message as the kit has it, uploads on their way in their place (#229).
  // The pictures for ‹ › in the preview are the list's own (#38).
  const items: KitItem[] = timeline.map((entry) =>
    entry.job ? { slot: true as const, key: `job-${entry.job.id}`, time: entry.time, node: <OutgoingMediaBubble job={entry.job} look={drawer ? 'drawer' : 'page'} /> } : fromChatMessage(entry.message!, me, cardOrigin),
  );
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['chat', 'messages', roomId] });
    void qc.invalidateQueries({ queryKey: ['chat', 'pins', roomId] });
    // The list's preview may be this message (a deleted last message must not linger there).
    void qc.invalidateQueries({ queryKey: ['chat', 'rooms'] });
  };
  const act = async (fn: () => Promise<unknown>, done?: string) => {
    try {
      await fn();
      if (done) toast('success', done);
    } catch (e) {
      toast('error', errorMessage(e));
    } finally {
      refresh();
    }
  };
  const handlers: MessageHandlers = {
    onReply: (m) => setReply({ id: m.id, sender_name: m.author.name, snippet: (m.body ?? m.files?.[0]?.filename ?? '').slice(0, 120) }),
    onReact: (m, emoji) => void act(() => apiPost(`/api/chat/messages/${m.id}/react`, { emoji })),
    onStar: (m) => void act(() => apiPut(`/api/chat/messages/${m.id}/star`, { starred: !m.starred }), m.starred ? 'Unstarred.' : 'Starred.'),
    onPin: (m) => void act(() => apiPut(`/api/chat/messages/${m.id}/pin`, { pinned: !m.pinned }), m.pinned ? 'Unpinned.' : 'Pinned for everyone.'),
    onForward: (m) => m.chat && setForwarding(m.chat),
    onEdit: (m) => composer.current?.edit({ id: m.id, message: m.body ?? '' }),
    onDelete: (m, scope) => void act(() => apiPost(`/api/chat/messages/${m.id}/delete`, { scope })),
    onCopyLink: () => void navigator.clipboard.writeText(`worksuite://chat/${roomId}`).then(() => toast('success', 'Link copied.')),
    onCreateTask: tasksAllowed && drawer ? (m) => navigate(`/tasks?new=1&title=${encodeURIComponent((m.body ?? `Follow up: ${room?.name ?? 'conversation'}`).replace(/\s+/g, ' ').slice(0, 200))}`) : undefined,
  };
  const renderers: KitRenderers = {
    records: (m, named) => (m.chat ? <MessageRecords m={m.chat} own={m.own} named={named} openLink={openLink} visible={visible} /> : null),
    call: (m, compact) => (m.chat ? <CallCard m={m.chat} own={m.own} roomId={roomId} compact={compact} /> : null),
  };

  const chip = 'flex h-[30px] items-center gap-1.5 rounded-full border border-line bg-surface px-3 text-ink hover:bg-subtle disabled:opacity-60';
  /** The conversation so far (what is loaded), as a note of its own. */
  const saveAsNote = async () => {
    const said = messages.filter((m) => !m.deleted && (m.message || m.file)).slice(-40);
    if (!said.length) return toast('info', 'Nothing to save yet.');
    setSaving(true);
    try {
      const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      const body = said.map((m) => `<p><b>${esc(m.sender_name)}</b> · ${esc(timeLabel(m.created_at))}<br>${esc(m.message ?? m.file?.filename ?? '').replace(/\n/g, '<br>')}</p>`).join('');
      const r = await apiPost<{ id: number }>('/api/notes', { title: `Chat · ${room?.name ?? 'conversation'} · ${dayLabel(dayKey(parseTs(said[said.length - 1]!.created_at)), 'short')}`.slice(0, 190), body });
      toast('success', 'Saved as a note.', { label: 'Open', run: () => navigate(`/notes?note=${r.id}`) });
    } catch (e) {
      toast('error', errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      data-thread
      className={cx('relative flex h-full flex-col', drawer ? 'chat-wallpaper' : 'bg-ground')}
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
      <div className={cx('flex h-[58px] shrink-0 items-center gap-2.5 border-b border-line bg-surface px-4', bare && 'hidden')}>
        <UserAvatar userId={roomPerson(room)} name={room?.avatar_name || room?.name} size={mini ? 30 : 36} className={group ? '!rounded-[10px]' : ''} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[14.5px] font-bold text-ink">{room?.name ?? 'Conversation'}</div>
          <div className="truncate text-[12px] text-ink-3">{subtitle}</div>
        </div>
        {!mini ? (
          <button type="button" aria-label="Search in conversation" title="Search in conversation" aria-pressed={searching} onClick={() => setSearching(!searching)} className={cx(headerBtn, searching && '!border-primary !bg-selection !text-primary')}>
            <Icon name="search" size={15} />
          </button>
        ) : null}
        {canCall(room) ? (
          <>
            <button type="button" aria-label="Start a voice call" title="Voice call" onClick={() => void startCall(roomId, 'audio', room?.name)} className={headerBtn}>
              <Icon name="phone" size={16} />
            </button>
            <button type="button" aria-label="Start a video call" title="Video call" onClick={() => void startCall(roomId, 'video', room?.name)} className={headerBtn}>
              <Icon name="video" size={16} />
            </button>
          </>
        ) : null}
        {!mini && meetAllowed ? (
          <button type="button" onClick={() => void startMeetingFromChat(roomId, room?.name)} className="flex h-[34px] items-center rounded-[8px] bg-primary px-3 text-[12.5px] font-bold text-white hover:bg-primary-hover">
            Meet
          </button>
        ) : null}
        {!mini && onToggleDetails ? (
          <button type="button" aria-label="Conversation details" title="Conversation details" aria-pressed={detailsOpen} onClick={onToggleDetails} className={cx(headerBtn, detailsOpen && '!border-primary !bg-selection !text-primary')}>
            <Icon name="panel-open" size={15} />
          </button>
        ) : (
          <button type="button" aria-label="Open in new window" title="Open in new window" onClick={() => void openChatWindow(roomId, room?.name)} className={cx(headerBtn, mini && 'hidden')}>
            <Icon name="external" size={15} />
          </button>
        )}
      </div>
      {searching ? (
        <div className="relative shrink-0 border-b border-line bg-surface px-4 py-2">
          <input autoFocus value={find} onChange={(e) => setFind(e.target.value)} placeholder="Search in this conversation…" aria-label="Search in this conversation" className="h-8 w-full rounded-[8px] border border-line bg-surface px-3 text-[13px] outline-none focus:border-primary" />
          {find.trim().length >= 2 ? (
            <div className="absolute top-full right-4 left-4 z-20 max-h-72 overflow-y-auto rounded-[10px] border border-line bg-surface py-1 shadow-xl scroll-thin">
              {found.isLoading ? <Spinner /> : !(found.data?.results.length) ? <div className="px-3 py-2 text-[12.5px] text-ink-3">No matches</div> : null}
              {(found.data?.results ?? []).map((h) => (
                <button key={h.message_id} type="button" className="block w-full px-3 py-1.5 text-left hover:bg-subtle" onClick={() => document.getElementById(`msg-${h.message_id}`)?.scrollIntoView({ block: 'center' })}>
                  <span className="block text-[11.5px] text-ink-3"><b className="text-ink">{h.sender_name}</b> · {timeLabel(h.created_at)}</span>
                  <span className="block truncate text-[12.5px] text-ink">{h.snippet}</span>
                </button>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
      {pinned.length ? (
        <div className="relative flex shrink-0 items-center gap-2 border-b border-[#F1D9B5] bg-[#FFF9EC] px-4 py-[7px] text-[12px] dark:border-warning/30 dark:bg-warning-bg">
          <b className="text-[#7A3B05] dark:text-warning">Pinned</b>
          <span className="min-w-0 flex-1 truncate text-ink-2">{pinned[0]!.message ?? pinned[0]!.file?.filename}</span>
          <button type="button" className="font-semibold text-primary hover:underline" onClick={() => setPinsOpen(!pinsOpen)}>{pinned.length > 1 ? `See all ${pinned.length}` : 'Show'}</button>
          {pinsOpen ? (
            <div className="absolute top-full right-4 z-20 mt-1 w-[360px] rounded-[10px] border border-line bg-surface p-1.5 shadow-xl">
              {pinned.map((p) => (
                <button key={p.id} type="button" className="block w-full rounded-[7px] px-2.5 py-1.5 text-left hover:bg-subtle" onClick={() => (setPinsOpen(false), document.getElementById(`msg-${p.id}`)?.scrollIntoView({ block: 'center' }))}>
                  <span className="block text-[11px] text-ink-3"><b className="text-ink">{p.sender_name}</b> · {timeLabel(p.created_at)}</span>
                  <span className="block truncate text-[12.5px] text-ink">{p.message ?? p.file?.filename}</span>
                </button>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
      <div ref={scroller} className={cx('min-h-0 flex-1 overflow-y-auto scroll-thin', drawer ? 'px-4 pt-1 pb-3' : 'px-5 py-3.5')}>
        {msgs.hasNextPage ? (
          <div className="mb-3 text-center">
            <button type="button" className="text-[12.5px] font-semibold text-primary hover:underline" onClick={() => void msgs.fetchNextPage()}>
              {msgs.isFetchingNextPage ? 'Loading…' : 'Load earlier messages'}
            </button>
          </div>
        ) : null}
        {msgs.isLoading ? <Spinner /> : msgs.error ? <ErrorNote error={msgs.error} onRetry={() => void msgs.refetch()} /> : null}
        {/* The shared chat kit (C-02, worksuite-desktop#229): the same bubbles, meta and attachments as a website chat, with Team Chat's caps. */}
        <MessageList items={items} caps={TEAM_CAPS} look={drawer ? 'drawer' : 'page'} handlers={handlers} renderers={renderers} group={group} />
        {mine.map((p) => (
          <PendingBubble
            key={p.id}
            label={p.label.replace(/^Message: /, '')}
            failed={p.state === 'FAILED' || p.state === 'CONFLICT'}
            error={p.error}
            waiting="Pending — sends when back online"
            look={drawer ? 'drawer' : 'page'}
            onRetry={() => void call('offline:retry', { id: p.id }).then(() => qc.invalidateQueries({ queryKey: ['offline'] }))}
          />
        ))}
      </div>
      {room?.blocked ? (
        // A person I blocked can't message me, and I can't message them until I unblock them (worksuite-desktop#183).
        <div role="status" className="flex shrink-0 items-center justify-center gap-1.5 border-t border-line bg-surface px-4 py-3 text-[13px] text-ink-2">
          You blocked {room.name} ·
          <button
            type="button"
            className="font-bold text-primary hover:underline"
            onClick={() => void apiPost(`/api/chat/rooms/${roomId}/unblock`).then(() => qc.invalidateQueries({ queryKey: ['chat', 'rooms'] }), (e) => toast('error', errorMessage(e)))}
          >
            Unblock
          </button>
        </div>
      ) : (
        <Composer
          ref={composer}
          roomId={roomId}
          roomName={room?.name ?? 'this conversation'}
          group={group}
          reply={reply}
          onClearReply={() => setReply(null)}
          typing={Object.values(typing)}
          compact={mini || bare}
          look={drawer ? 'pill' : 'box'}
          inside={boxChip}
          extras={
            drawer ? (
              <div className="flex flex-wrap gap-1.5 text-[12px] font-bold">
                {tasksAllowed ? (
                  <button type="button" onClick={() => navigate(`/tasks?new=1&title=${encodeURIComponent(`Follow up: ${room?.name ?? 'conversation'}`.slice(0, 200))}`)} className={chip}>
                    <Icon name="tasks" size={14} className="text-primary" />
                    Create task
                  </button>
                ) : null}
                {notesAllowed ? (
                  <button type="button" disabled={saving} onClick={() => void saveAsNote()} className={chip}>
                    <Icon name="notebook" size={14} className="text-[#CA8A04]" />
                    {saving ? 'Saving…' : 'Save as note'}
                  </button>
                ) : null}
                <button type="button" aria-label="Search in conversation" aria-pressed={searching} onClick={() => setSearching(!searching)} className={cx(chip, searching && '!border-primary !bg-selection !text-primary')}>
                  <Icon name="search" size={14} className="text-ink-2" />
                  Search
                </button>
              </div>
            ) : null
          }
        />
      )}
      {drag ? (
        <div className="pointer-events-none absolute inset-3 flex items-center justify-center rounded-[14px] border-2 border-dashed border-primary bg-selection/80 text-[15px] font-semibold text-primary">
          Drop to add to the message for {room?.name ?? 'this conversation'}
        </div>
      ) : null}
      {forwarding ? <ForwardDialog m={forwarding} rooms={rooms} onClose={() => setForwarding(null)} /> : null}
    </div>
  );
}

