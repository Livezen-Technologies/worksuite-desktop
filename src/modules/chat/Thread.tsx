import { OutgoingMediaBubble, useOutgoingMedia } from './OutgoingMedia';
import { outgoing } from './outgoing';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { canOpenLink } from '@shared/access';
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
import { Button, ErrorNote, FileBadge, Modal, Spinner, cx, DATA_TEXT } from '../../components/ui';
import { UserAvatar } from '../../components/UserAvatar';
import { MeetingCard } from './MeetingCard';
import { openChatWindow } from './window';
import { describeCard } from '../calls/log';
import { answerCall, startCall } from '../calls/start';
import { openMeeting } from '../meet/api';
import { startMeetingFromChat } from '../meet/start';
import { LinkedText } from '../../components/LinkedText';
import { DriveShareCard, type DriveCard } from './cards/DriveMeetCards';
import { RecordCards } from './cards/RecordCards';
import { recordsIn, withoutRecordLines } from './cards/recordLinks';
import { Composer, type ComposerHandle } from './Composer';
import { PRESENCE } from './Details';
import { ForwardDialog, type RoomDetail } from './NewChat';
import { EmojiPicker, VoicePlayer } from './parts';
import { AttachmentGallery, openChatAttachment, useAttachmentGallery } from './AttachmentViewer';
import { canCall, mediaUrl, roomPerson, type ChatMessage, type Room } from './types';

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
  banner,
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
  /** Shown over the top of the messages (the drawer's "record is open" card). */
  banner?: ReactNode;
  /** Who is typing, for a header drawn outside the thread. */
  onTyping?: (names: string[]) => void;
  rooms: Room[];
  detailsOpen?: boolean;
  onToggleDetails?: () => void;
}) {
  const qc = useQueryClient();
  const outgoingCount = useStore(outgoing, (s) => s.jobs.filter((j) => j.roomId === roomId).length);
  const me = useStore(app, (s) => s.auth?.user?.id);
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
  const ids = (detail.data?.members ?? []).map((m) => m.id).join(',');
  const presence = useQuery({ queryKey: ['chat', 'presence', ids], queryFn: ({ signal }) => apiGet<{ presence: Record<string, string> }>('/api/chat/presence', { ids }, signal), enabled: ids !== '', refetchInterval: 60_000 });
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
  // The conversation's pictures, oldest first: ‹ › in the attachment preview goes through them (#38).
  const pictures = useMemo(() => messages.flatMap((m) => (m.file && !m.deleted && m.file.preview === 'image' ? [m.file] : [])), [messages]);

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
  const online = members.filter((m) => presence.data?.presence[String(m.id)] === 'online').length;
  const other = room?.other_user_id ? presence.data?.presence[String(room.other_user_id)] : undefined;
  const subtitle = group ? `Group · ${members.length || '…'} members${online ? ` · ${online} online` : ''}` : ((other ? PRESENCE[other]?.label : null) ?? 'Direct message');
  const pinned = pins.data?.messages ?? [];
  const days = messages.map((m, i) => {
    const day = dayKey(parseTs(m.created_at));
    return i === 0 || dayKey(parseTs(messages[i - 1]!.created_at)) !== day ? day : null;
  });

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
      {banner}
      <div ref={scroller} className={cx('min-h-0 flex-1 overflow-y-auto scroll-thin', drawer ? 'px-3 pt-1 pb-3' : 'px-5 py-3.5')}>
        {msgs.hasNextPage ? (
          <div className="mb-3 text-center">
            <button type="button" className="text-[12.5px] font-semibold text-primary hover:underline" onClick={() => void msgs.fetchNextPage()}>
              {msgs.isFetchingNextPage ? 'Loading…' : 'Load earlier messages'}
            </button>
          </div>
        ) : null}
        {msgs.isLoading ? <Spinner /> : msgs.error ? <ErrorNote error={msgs.error} onRetry={() => void msgs.refetch()} /> : null}
        <AttachmentGallery.Provider value={pictures}>
        {timeline.map((entry) => {
          if (entry.job) return <OutgoingMediaBubble key={entry.job.id} job={entry.job} />;
          const m = entry.message!;
          const i = entry.index;
          const header = days[i];
          const prev = messages[i - 1];
          const first = !!header || !prev || prev.sender_id !== m.sender_id || prev.type === 'system' || prev.type === 'call';
          return (
            <div key={m.id} id={`msg-${m.id}`}>
              {header ? (
                drawer ? (
                  <div className="my-2.5 text-center">
                    <span className="rounded-[8px] bg-surface px-2 py-[3px] text-[11px] font-bold text-ink-2 shadow-[0_1px_1px_rgb(var(--ws-shadow-rgb)/.08)]">{relativeDay(header)}</span>
                  </div>
                ) : (
                  <div className="my-3 text-center"><span className="rounded-full bg-subtle px-2.5 py-[3px] text-[11.5px] font-semibold text-ink-3">{dayLabel(header, 'short')}</span></div>
                )
              ) : null}
              {drawer ? (
                <DrawerBubble m={m} own={String(m.sender_id) === me} group={group} first={first} roomId={roomId} roomName={room?.name ?? 'conversation'} onReply={setReply} onForward={setForwarding} onEdit={(x) => composer.current?.edit({ id: x.id, message: x.message ?? '' })} />
              ) : (
                <Bubble m={m} own={String(m.sender_id) === me} roomId={roomId} onReply={setReply} onForward={setForwarding} onEdit={(x) => composer.current?.edit({ id: x.id, message: x.message ?? '' })} />
              )}
            </div>
          );
        })}
        </AttachmentGallery.Provider>
        {mine.map((p) => (
          <div key={p.id} className="mt-3 flex flex-col items-end gap-1">
            <div className={cx('max-w-[520px] border border-dashed border-[#8C9AD3] bg-[#DDE3F7] text-ink dark:bg-selection', drawer ? 'max-w-[84%] rounded-[10px] px-2.5 py-1.5 text-[13px]' : 'rounded-[12px_4px_12px_12px] px-[13px] py-[9px] text-[13.5px]')}>{p.label.replace(/^Message: /, '')}</div>
            <span className="text-[11.5px] font-semibold text-[#9A4A06] dark:text-warning">
              {p.state === 'FAILED' || p.state === 'CONFLICT' ? (
                <>
                  Not sent — {p.error ?? 'the server refused it'} ·{' '}
                  <button type="button" className="underline" onClick={() => void call('offline:retry', { id: p.id }).then(() => qc.invalidateQueries({ queryKey: ['offline'] }))}>Retry</button>
                </>
              ) : (
                'Pending — sends when back online'
              )}
            </span>
          </div>
        ))}
      </div>
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
      {drag ? (
        <div className="pointer-events-none absolute inset-3 flex items-center justify-center rounded-[14px] border-2 border-dashed border-primary bg-selection/80 text-[15px] font-semibold text-primary">
          Drop to add to the message for {room?.name ?? 'this conversation'}
        </div>
      ) : null}
      {forwarding ? <ForwardDialog m={forwarding} rooms={rooms} onClose={() => setForwarding(null)} /> : null}
    </div>
  );
}

type Card = { kind: string; available?: boolean; why?: string; heading?: string; name?: string; owner?: string; who?: string; what?: string; link?: string };

function Bubble({ m, own, roomId, onReply, onForward, onEdit }: { m: ChatMessage & { starred?: boolean; pinned?: unknown; card?: Card | null }; own: boolean; roomId: string; onReply: (r: ReplyTarget) => void; onForward: (m: ChatMessage) => void; onEdit: (m: ChatMessage) => void }) {
  const gallery = useAttachmentGallery();
  const qc = useQueryClient();
  const { openLink } = useTab();
  const visible = useVisibleIds();
  const [picker, setPicker] = useState(false);
  const [more, setMore] = useState(false);
  const [deleting, setDeleting] = useState<'everyone' | 'me' | null>(null);
  const origin = useStore(app, (x) => x.auth?.server?.origin);
  const named = !m.deleted && !m.card && recordsIn(m.message, origin).length > 0;
  const shownText = named && m.message ? withoutRecordLines(m.message, origin) : m.message;
  // A card is 440 wide; the bubble takes that width and gives it up in a narrow column.
  const carded = named || (!!m.card && !m.deleted);
  const can = m.can ?? {};
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
  const react = (emoji: string) => {
    setPicker(false);
    void act(() => apiPost(`/api/chat/messages/${m.id}/react`, { emoji }));
  };

  if (m.type === 'system') return <div className="my-2 text-center text-[12px] text-ink-3">{m.message}</div>;
  if (m.type === 'call' && m.call_uuid && !m.deleted) return <CallCard m={m} own={own} roomId={roomId} />;
  const f = m.file;
  const src = mediaUrl(f?.mime === 'image/gif' ? f.url : (f?.thumb_url ?? f?.url));
  const voice = !!f && (m.type === 'voice' || f.preview === 'audio');
  const bubble = own ? 'rounded-[12px_4px_12px_12px] bg-primary text-white' : 'rounded-[4px_12px_12px_12px] border border-line bg-surface text-ink';
  return (
    <div className={cx('group relative mt-3 flex gap-2.5', own && 'flex-row-reverse')}>
      {!own ? <UserAvatar userId={m.sender_id} name={m.sender_name} size={30} /> : null}
      <div data-bubble className={cx('relative flex min-w-0 max-w-[560px] flex-col gap-1', own && 'items-end', carded && 'w-[440px]')}>
        {!m.deleted ? (
          <MessageMenu
            own={own}
            named={!own}
            open={more}
            setOpen={setMore}
            reactions={can.react !== false ? REACTION_BAR : []}
            onReact={react}
            onMoreReactions={() => (setMore(false), setPicker(true))}
            items={[
              can.reply !== false ? { icon: 'reply', label: 'Reply', run: () => onReply({ id: m.id, sender_name: m.sender_name, snippet: (m.message ?? m.file?.filename ?? '').slice(0, 120) }) } : null,
              can.forward ? { icon: 'forward', label: 'Forward…', run: () => onForward(m) } : null,
              { icon: 'link', label: 'Copy link', run: () => void navigator.clipboard.writeText(`worksuite://chat/${roomId}`).then(() => toast('success', 'Link copied.')) },
              { icon: 'star', label: m.starred ? 'Unstar message' : 'Star message', run: () => void act(() => apiPut(`/api/chat/messages/${m.id}/star`, { starred: !m.starred }), m.starred ? 'Unstarred.' : 'Starred.') },
              { icon: m.pinned ? 'pin-off' : 'pin', label: m.pinned ? 'Unpin message' : 'Pin message', run: () => void act(() => apiPut(`/api/chat/messages/${m.id}/pin`, { pinned: !m.pinned }), m.pinned ? 'Unpinned.' : 'Pinned for everyone.') },
              can.edit ? { icon: 'compose', label: 'Edit', run: () => onEdit(m) } : null,
              m.message ? { icon: 'copy', label: 'Copy text', run: () => void navigator.clipboard.writeText(m.message ?? '').then(() => toast('success', 'Copied.')) } : null,
              can.delete_me || can.delete_everyone ? { icon: 'trash', label: 'Delete…', danger: true, run: () => setDeleting(can.delete_everyone ? 'everyone' : 'me') } : null,
            ]}
          />
        ) : null}
        {!own ? (
          <span className="text-[12px]">
            <b className="text-ink">{m.sender_name}</b> <span className="text-ink-3">{timeLabel(m.created_at)}</span>
          </span>
        ) : null}
        {m.reply_preview ? <div className="rounded-[6px] border-l-[3px] border-[#7FA2FF] bg-selection px-2.5 py-1.5 text-[12px] text-ink-2">Replying to {m.reply_preview.sender_name}: “{m.reply_preview.snippet}”</div> : null}
        {m.urgent && !m.deleted ? <span className="text-[10.5px] font-bold tracking-[0.5px] text-danger uppercase">Urgent</span> : null}
        {shownText && !m.deleted ? (
          <div className={cx('whitespace-pre-wrap break-words px-[13px] py-[9px] text-[13.5px] leading-[1.55] selectable', bubble)}>
            <LinkedText text={shownText} className={own ? 'text-white' : 'text-primary'} />
          </div>
        ) : m.deleted ? (
          <div className="rounded-[12px] border border-line px-3 py-2 text-[12.5px] text-ink-3 italic">Message deleted</div>
        ) : null}
        {named ? <RecordCards text={m.message} /> : null}
        {m.card && !m.deleted && m.card.kind.startsWith('drive.') ? <DriveShareCard card={m.card as DriveCard} onOpen={openLink} /> : null}
        {m.card && !m.deleted && !m.card.kind.startsWith('drive.') ? (
          <div className="flex w-[380px] flex-col gap-1.5 rounded-[12px] border border-line bg-surface px-3.5 py-3">
            {m.card.available === false ? (
              <span className="text-[12.5px] text-ink-3">{m.card.why}</span>
            ) : (
              <>
                <span className="text-[11px] font-bold tracking-[0.5px] text-[#9A4A06] uppercase dark:text-warning">{m.card.heading ?? m.card.kind.split('.')[0]}</span>
                <b className="text-[13px] text-ink">{m.card.name ?? m.card.what ?? ''}{m.card.who ? ` · ${m.card.who}` : ''}</b>
                {m.card.owner ? <span className="text-[12px] text-ink-3">{m.card.owner}</span> : null}
                {m.card.link && canOpenLink(m.card.link, visible) ? <button type="button" onClick={() => openLink(m.card!.link!)} className="self-start text-[12px] font-semibold text-primary hover:underline">Open</button> : null}
              </>
            )}
          </div>
        ) : null}
        {f && !m.deleted ? (
          (f.status === 'processing' || ((f.preview === 'video' || voice) && !f.url)) ? (
            <span role="status" className="flex items-center gap-2 p-2 text-[12px] text-ink-2"><span aria-hidden="true" className="h-3 w-3 animate-spin rounded-full border-2 border-primary border-t-transparent" />Media processing…</span>
          ) : voice && mediaUrl(f.url) ? (
            <VoicePlayer src={mediaUrl(f.url)!} ms={f.duration_ms} seed={m.id} own={own} />
          ) : f.preview === 'image' && src ? (
            <button type="button" className="overflow-hidden rounded-[12px] border border-line" onClick={() => openChatAttachment(f, openLink, gallery)} aria-label={`Open ${f.filename}`}>
              <img src={src} alt={f.filename} loading="lazy" className="max-h-[260px] max-w-[320px] object-cover" />
            </button>
          ) : f.preview === 'video' && mediaUrl(f.url) ? (
            <video src={mediaUrl(f.url)!} poster={mediaUrl(f.poster_url) ?? undefined} controls preload="metadata" className="max-h-[260px] max-w-[360px] rounded-[12px] border border-line" />
          ) : (
            <div className="flex w-[320px] items-center gap-2.5 rounded-[10px] border border-line bg-surface px-3 py-2.5">
              <FileBadge name={f.filename} size={34} />
              <span className="min-w-0 flex-1">
                <b className="block truncate text-[12px] text-ink">{f.filename}</b>
                <span className="block text-[12px] text-ink-3">{Math.max(1, Math.round(f.size / 1024))} KB{f.status !== 'ready' ? ` · ${f.status}` : ''}</span>
              </span>
              <button type="button" onClick={() => openChatAttachment(f, openLink, gallery)} className="text-[12px] font-semibold text-primary hover:underline">Open</button>
            </div>
          )
        ) : null}
        {m.reactions.length ? (
          <div className="flex flex-wrap gap-1">
            {m.reactions.map((r) => (
              <button
                key={r.emoji}
                type="button"
                disabled={can.react === false}
                onClick={() => react(r.emoji)}
                title={r.names?.join(', ')}
                aria-label={`${r.emoji} ${r.count}${r.mine ? ', yours — remove' : ''}`}
                className={cx('rounded-full border px-2 py-px text-[11.5px]', r.mine ? 'border-[#C7D0F0] bg-selection dark:border-primary/40' : 'border-line bg-surface hover:bg-subtle')}
              >
                {r.emoji} {r.count}
              </button>
            ))}
          </div>
        ) : null}
        {own ? (
          <span className="text-[11.5px] text-ink-3">
            {timeLabel(m.created_at)}
            {m.edited ? ' · edited' : ''}
            {m.starred ? ' · ★' : ''}
            {m.receipt ? ` · ${m.receipt.status === 'read' ? `Read by ${m.receipt.read} ✓✓` : m.receipt.status === 'delivered' ? 'Delivered ✓✓' : 'Sent ✓'}` : ''}
          </span>
        ) : m.edited || m.starred ? (
          <span className="text-[11.5px] text-ink-3">{[m.edited ? 'edited' : null, m.starred ? '★ starred' : null].filter(Boolean).join(' · ')}</span>
        ) : null}
      </div>
      {picker ? <EmojiPicker className={cx('absolute top-8 z-30', own ? 'right-2' : 'left-10')} onPick={react} onClose={() => setPicker(false)} /> : null}
      {deleting ? <DeleteDialog m={m} scope={deleting} setScope={setDeleting} onDelete={(scope) => void act(() => apiPost(`/api/chat/messages/${m.id}/delete`, { scope }))} /> : null}
    </div>
  );
}


/** "Delete message?" — for everyone or for me, as the server allows. */
function DeleteDialog({ m, scope, setScope, onDelete }: { m: ChatMessage; scope: 'everyone' | 'me'; setScope: (v: 'everyone' | 'me' | null) => void; onDelete: (scope: 'everyone' | 'me') => void }) {
  const can = m.can ?? {};
  return (
    <Modal
      title="Delete message?"
      onClose={() => setScope(null)}
      width={420}
      footer={
        <>
          <Button onClick={() => setScope(null)}>Cancel</Button>
          <Button
            variant="danger"
            onClick={() => {
              setScope(null);
              onDelete(scope);
            }}
          >
            Delete
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3 text-[13px]">
        <div className="rounded-[9px] bg-subtle px-3 py-2.5 text-ink-2">“{(m.message ?? m.file?.filename ?? '').slice(0, 120)}”</div>
        {can.delete_everyone ? (
          <label className="flex items-start gap-2.5">
            <input type="radio" name={`del-${m.id}`} checked={scope === 'everyone'} onChange={() => setScope('everyone')} className="mt-0.5 accent-[var(--color-primary)]" />
            <span className="flex flex-col"><b className="text-ink">Delete for everyone</b><span className="text-[12px] text-ink-3">Shows “Message deleted” in the conversation</span></span>
          </label>
        ) : null}
        {can.delete_me ? (
          <label className="flex items-start gap-2.5">
            <input type="radio" name={`del-${m.id}`} checked={scope === 'me'} onChange={() => setScope('me')} className="mt-0.5 accent-[var(--color-primary)]" />
            <span className="flex flex-col"><b className="text-ink">Delete for me</b><span className="text-[12px] text-ink-3">Others still see it</span></span>
          </label>
        ) : null}
      </div>
    </Modal>
  );
}

/** "Today", "Yesterday", or the date — the drawer's day pills. */
function relativeDay(key: string): string {
  const today = dayKey(new Date());
  const d = new Date(`${key}T12:00:00`);
  const y = new Date(d);
  y.setDate(y.getDate() + 1);
  if (key === today) return 'Today';
  if (dayKey(y) === today) return 'Yesterday';
  return dayLabel(key, 'short');
}

const NAME_COLOURS = ['#0B6770', '#23349E', '#9A4A06', '#6B3FB5', '#B42318', '#1F7A4D'];
/** A sender's colour in a group, the same every time. */
export function nameColour(name: string): string {
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) | 0;
  return NAME_COLOURS[Math.abs(h) % NAME_COLOURS.length]!;
}

/** Time, edited, starred and the ticks, inside a drawer bubble. */
function Meta({ m, own }: { m: ChatMessage & { starred?: boolean }; own: boolean }) {
  const r = own ? m.receipt : null;
  return (
    <span className="ml-auto inline-flex shrink-0 items-center gap-1 self-end pt-1 pl-1 text-[10.5px] leading-none whitespace-nowrap text-ink-3">
      {m.starred ? <Icon name="star" size={10} className="text-[#CA8A04]" label="Starred" /> : null}
      {m.edited ? 'edited · ' : ''}
      {timeLabel(m.created_at)}
      {r ? (
        <Icon
          name={r.status === 'sent' ? 'check' : 'check-check'}
          size={13}
          className={r.status === 'read' ? 'text-[#3B6FE0] dark:text-[#8FB0FF]' : 'text-ink-3'}
          label={r.status === 'read' ? `Read by ${r.read}` : r.status === 'delivered' ? 'Delivered' : 'Sent'}
        />
      ) : null}
    </span>
  );
}

const DRAWER_REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🙏'];

/** Closes a floating panel on a click elsewhere, Escape, or a scroll behind it. */
function useDismiss(open: boolean, box: React.RefObject<HTMLElement | null>, close: () => void) {
  useEffect(() => {
    if (!open) return;
    const inside = (t: EventTarget | null) => !!box.current && box.current.contains(t as Node);
    const down = (e: MouseEvent) => !inside(e.target) && close();
    const key = (e: KeyboardEvent) => e.key === 'Escape' && close();
    const scroll = (e: Event) => !inside(e.target) && close();
    window.addEventListener('mousedown', down);
    window.addEventListener('keydown', key);
    window.addEventListener('scroll', scroll, true);
    return () => {
      window.removeEventListener('mousedown', down);
      window.removeEventListener('keydown', key);
      window.removeEventListener('scroll', scroll, true);
    };
  }, [open, box, close]);
}

/**
 * A message in the chat drawer (ChatDrawer · message actions): a bubble with
 * its time and ticks inside, reactions hanging off the bottom, and — on hover
 * or click — a compact action bar on its top edge: react, reply, star, more.
 * The reactions pill and the menu float, stay inside the drawer, and the menu
 * opens upward when the message is down by the message box.
 */
function DrawerBubble({ m, own, group, first, roomId, roomName, onReply, onForward, onEdit }: { m: ChatMessage & { starred?: boolean; pinned?: unknown; card?: Card | null }; own: boolean; group: boolean; first: boolean; roomId: string; roomName: string; onReply: (r: ReplyTarget) => void; onForward: (m: ChatMessage) => void; onEdit: (m: ChatMessage) => void }) {
  const gallery = useAttachmentGallery();
  const qc = useQueryClient();
  const { openLink } = useTab();
  const visible = useVisibleIds();
  const tasksAllowed = useCanOpen('tasks');
  const [pop, setPop] = useState<{ kind: 'react' | 'more'; left: number; top: number } | null>(null);
  const [picker, setPicker] = useState(false);
  const [deleting, setDeleting] = useState<'everyone' | 'me' | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const close = useMemo(() => () => setPop(null), []);
  useDismiss(!!pop, box, close);
  const can = m.can ?? {};
  const act = async (fn: () => Promise<unknown>, done?: string) => {
    try {
      await fn();
      if (done) toast('success', done);
    } catch (e) {
      toast('error', errorMessage(e));
    } finally {
      void qc.invalidateQueries({ queryKey: ['chat', 'messages', roomId] });
      void qc.invalidateQueries({ queryKey: ['chat', 'pins', roomId] });
      void qc.invalidateQueries({ queryKey: ['chat', 'rooms'] });
    }
  };
  const react = (emoji: string) => {
    setPop(null);
    setPicker(false);
    void act(() => apiPost(`/api/chat/messages/${m.id}/react`, { emoji }));
  };
  const snippet = (m.message ?? m.file?.filename ?? '').slice(0, 120);
  const items: MenuItem[] = [
    ...(can.reply !== false ? [{ icon: 'reply', label: 'Reply', run: () => onReply({ id: m.id, sender_name: m.sender_name, snippet }) }] : []),
    ...(m.message ? [{ icon: 'copy', label: 'Copy message', run: () => void navigator.clipboard.writeText(m.message ?? '').then(() => toast('success', 'Copied.')) }] : []),
    { icon: 'link', label: 'Copy link', run: () => void navigator.clipboard.writeText(`worksuite://chat/${roomId}`).then(() => toast('success', 'Link copied.')) },
    { icon: m.pinned ? 'pin-off' : 'pin', label: m.pinned ? 'Unpin message' : 'Pin message', run: () => void act(() => apiPut(`/api/chat/messages/${m.id}/pin`, { pinned: !m.pinned }), m.pinned ? 'Unpinned.' : 'Pinned for everyone.') },
    ...(can.forward ? [{ icon: 'forward', label: 'Forward…', run: () => onForward(m) }] : []),
    ...(tasksAllowed ? [{ icon: 'tasks', label: 'Create task', run: () => navigate(`/tasks?new=1&title=${encodeURIComponent((m.message ?? `Follow up: ${roomName}`).replace(/\s+/g, ' ').slice(0, 200))}`) }] : []),
    ...(can.edit ? [{ icon: 'compose', label: 'Edit', run: () => onEdit(m) }] : []),
    ...(can.delete_me || can.delete_everyone ? [{ icon: 'trash', label: 'Delete…', danger: true, run: () => setDeleting(can.delete_everyone ? 'everyone' : 'me') }] : []),
  ];

  const origin = useStore(app, (x) => x.auth?.server?.origin);

  // Placed when opened: inside the drawer, above the bar for the reactions,
  // under the ⋯ for the menu unless that would run into the message box.
  const open = (kind: 'react' | 'more', button: HTMLElement) => {
    if (pop?.kind === kind) return setPop(null);
    const area = (button.closest('[data-thread]') ?? document.body).getBoundingClientRect();
    const b = button.getBoundingClientRect();
    const bar = (button.closest('[role="toolbar"]') ?? button).getBoundingClientRect();
    const w = kind === 'react' ? 44 + DRAWER_REACTIONS.length * 36 : 214;
    const h = kind === 'react' ? 46 : items.length * 32 + 12 + (items.some((x) => x.danger) ? 9 : 0);
    const left = Math.max(area.left + 8, Math.min(area.right - w - 8, kind === 'react' ? (own ? bar.right - w : bar.left) : own ? b.right - w : b.left));
    const top =
      kind === 'react'
        ? bar.top - h - 6 >= area.top + 8
          ? bar.top - h - 6
          : bar.bottom + 6
        : b.bottom + 4 + h <= area.bottom - 8
          ? b.bottom + 4
          : Math.max(area.top + 8, b.top - h - 4);
    setPop({ kind, left, top });
  };

  if (m.type === 'system') return <div className="my-2 text-center"><span className="rounded-[8px] bg-surface/80 px-2 py-0.5 text-[11.5px] text-ink-3">{m.message}</span></div>;
  if (m.type === 'call' && m.call_uuid && !m.deleted) return <CallCard m={m} own={own} roomId={roomId} compact />;
  const f = m.file;
  const src = mediaUrl(f?.mime === 'image/gif' ? f.url : (f?.thumb_url ?? f?.url));
  const voice = !!f && (m.type === 'voice' || f.preview === 'audio');
  const media = !!f && !m.deleted;
  // On dark the other side's bubbles sit a shade above the wallpaper, and inside
  // your own the accents go pale: indigo on indigo is not readable.
  const cards = !m.deleted && !m.card && recordsIn(m.message, origin).length > 0;
  const shownText = cards && m.message ? withoutRecordLines(m.message, origin) : m.message;
  const tone = own ? 'bg-[#DCE3FB] dark:bg-[#26366E]' : 'bg-surface dark:bg-well';
  const accent = own ? 'text-primary dark:text-[#B4C3FF]' : 'text-primary';
  const toolBtn = 'flex h-7 w-7 items-center justify-center rounded-[7px] text-ink-2 hover:bg-subtle hover:text-ink';

  return (
    <div className={cx('group relative flex', own ? 'justify-end' : 'justify-start', first ? 'mt-2.5' : 'mt-1')}>
      <div ref={box} data-bubble className={cx('relative flex min-w-0 max-w-[84%] flex-col', own ? 'items-end' : 'items-start', (cards || (m.card && !m.deleted)) && 'w-[456px]')}>
        {!m.deleted ? (
          <div
            role="toolbar"
            aria-label="Message actions"
            className={cx(
              'absolute -top-[15px] z-20 flex items-center gap-0.5 rounded-[10px] bg-surface p-[3px] shadow-[0_4px_14px_rgb(var(--ws-shadow-rgb)/.16),0_0_0_1px_var(--ws-edge)]',
              own ? 'right-1.5' : 'left-1.5',
              pop ? 'visible' : 'invisible group-hover:visible group-focus-within:visible',
            )}
          >
            {can.react !== false ? (
              <button type="button" aria-label="React" title="React" aria-expanded={pop?.kind === 'react'} onClick={(e) => open('react', e.currentTarget)} className={cx(toolBtn, pop?.kind === 'react' && '!bg-selection !text-primary')}>
                <Icon name="smile" size={15} />
              </button>
            ) : null}
            {can.reply !== false ? (
              <button type="button" aria-label="Reply" title="Reply" onClick={() => onReply({ id: m.id, sender_name: m.sender_name, snippet })} className={toolBtn}>
                <Icon name="reply" size={15} />
              </button>
            ) : null}
            <button type="button" aria-label={m.starred ? 'Unstar message' : 'Star message'} title={m.starred ? 'Unstar' : 'Star'} aria-pressed={!!m.starred} onClick={() => void act(() => apiPut(`/api/chat/messages/${m.id}/star`, { starred: !m.starred }), m.starred ? 'Unstarred.' : 'Starred.')} className={cx(toolBtn, m.starred && '!text-[#CA8A04]')}>
              <Icon name="star" size={15} />
            </button>
            <button type="button" aria-label="More actions" title="More" aria-haspopup="menu" aria-expanded={pop?.kind === 'more'} onClick={(e) => open('more', e.currentTarget)} className={cx(toolBtn, pop?.kind === 'more' && '!bg-selection !text-primary')}>
              <Icon name="more" size={15} />
            </button>
          </div>
        ) : null}
        <div className={cx('min-w-[64px] rounded-[10px] text-[13px] leading-[1.45] text-ink shadow-[0_1px_1px_rgb(var(--ws-shadow-rgb)/.1)]', tone, media || m.card || cards ? 'p-1' : 'px-2.5 py-1.5', (cards || (m.card && !m.deleted)) && 'w-full')}>
          {group && !own && first ? (
            <b className={cx('block text-[11.5px]', DATA_TEXT, (media || m.card) && 'px-1.5 pt-0.5')} style={{ ['--c' as string]: nameColour(m.sender_name) }}>
              {m.sender_name}
            </b>
          ) : null}
          {m.reply_preview ? (
            <div className={cx('mb-1 rounded-[6px] border-l-[3px] border-primary bg-black/[.04] px-2 py-1 text-[11.5px] dark:bg-white/5', own && 'dark:border-[#B4C3FF]', (media || m.card) && 'mx-0.5')}>
              <b className={cx('block', accent)}>{m.reply_preview.sender_name}</b>
              <span className="line-clamp-2 text-ink-2">{m.reply_preview.snippet}</span>
            </div>
          ) : null}
          {m.urgent && !m.deleted ? <span className={cx('block text-[10px] font-bold tracking-[0.5px] text-danger uppercase', (media || m.card) && 'px-1.5')}>Urgent</span> : null}
          {m.deleted ? (
            <div className="flex flex-wrap items-end">
              <span className="text-ink-3 italic">Message deleted</span>
              <Meta m={m} own={own} />
            </div>
          ) : (
            <>
              {m.card && m.card.kind.startsWith('drive.') ? <DriveShareCard card={m.card as DriveCard} onOpen={openLink} /> : null}
              {m.card && !m.card.kind.startsWith('drive.') ? (
                <div className={cx('flex w-[270px] max-w-full flex-col gap-0.5 rounded-[8px] border-l-[3px] border-[#E0522F] bg-surface px-2.5 py-2', own && 'dark:bg-black/25')}>
                  {m.card.available === false ? (
                    <span className="text-[12.5px] text-ink-3">{m.card.why}</span>
                  ) : (
                    <>
                      <span className="text-[10.5px] font-bold tracking-[0.5px] text-[#E0522F] uppercase dark:text-[#FF8A6B]">{(m.card.heading ?? m.card.kind.split('.')[0])?.replace('.', ' · ')}</span>
                      <b className="text-[13px] text-ink">
                        {m.card.name ?? m.card.what ?? ''}
                        {m.card.who ? ` · ${m.card.who}` : ''}
                      </b>
                      {m.card.owner ? <span className="text-[12px] text-ink-3">{m.card.owner}</span> : null}
                    </>
                  )}
                </div>
              ) : null}
              {f ? (
                (f.status === 'processing' || ((f.preview === 'video' || voice) && !f.url)) ? (
                  <span role="status" className="flex items-center gap-2 p-2 text-[12px] text-ink-2"><span aria-hidden="true" className="h-3 w-3 animate-spin rounded-full border-2 border-primary border-t-transparent" />Media processing…</span>
                ) : voice && mediaUrl(f.url) ? (
                  <VoicePlayer src={mediaUrl(f.url)!} ms={f.duration_ms} seed={m.id} own={own} bare />
                ) : f.preview === 'image' && src ? (
                  <button type="button" className="block overflow-hidden rounded-[8px]" onClick={() => openChatAttachment(f, openLink, gallery)} aria-label={`Open ${f.filename}`}>
                    <img src={src} alt={f.filename} loading="lazy" className="max-h-[220px] max-w-[260px] object-cover" />
                  </button>
                ) : f.preview === 'video' && mediaUrl(f.url) ? (
                  <video src={mediaUrl(f.url)!} poster={mediaUrl(f.poster_url) ?? undefined} controls preload="metadata" className="max-h-[220px] max-w-[280px] rounded-[8px]" />
                ) : (
                  <div className="flex w-[250px] max-w-full items-center gap-2.5 rounded-[8px] bg-surface/70 px-2 py-2 dark:bg-white/5">
                    <FileBadge name={f.filename} size={32} />
                    <span className="min-w-0 flex-1">
                      <b className="block truncate text-[12px] text-ink">{f.filename}</b>
                      <span className="block text-[11.5px] text-ink-3">{Math.max(1, Math.round(f.size / 1024))} KB{f.status !== 'ready' ? ` · ${f.status}` : ''}</span>
                    </span>
                    <button type="button" onClick={() => openChatAttachment(f, openLink, gallery)} className={cx('text-[12px] font-semibold hover:underline', accent)}>
                      Open
                    </button>
                  </div>
                )
              ) : null}
              {cards ? (
                <div className="p-0.5">
                  <RecordCards text={m.message} />
                </div>
              ) : null}
              <div className={cx('flex flex-wrap items-end gap-x-2', (media || m.card || cards) && 'px-1.5 pb-0.5')}>
                {shownText ? (
                  <span className={cx('min-w-0 whitespace-pre-wrap break-words selectable', (media || m.card || cards) && 'pt-1')}>
                    <LinkedText text={shownText} className={accent} />
                  </span>
                ) : null}
                {m.card?.link && m.card.available !== false && !m.card.kind.startsWith('drive.') && canOpenLink(m.card.link, visible) ? (
                  <button type="button" onClick={() => openLink(m.card!.link!)} className={cx('pt-1 text-[12.5px] font-bold hover:underline', accent)}>
                    Open {m.card.kind.split('.').pop()}
                  </button>
                ) : null}
                <Meta m={m} own={own} />
              </div>
            </>
          )}
        </div>
        {m.reactions.length ? (
          <div className={cx('relative z-10 -mt-1.5 flex flex-wrap gap-1', own ? 'mr-2' : 'ml-2')}>
            {m.reactions.map((r) => (
              <button
                key={r.emoji}
                type="button"
                disabled={can.react === false}
                onClick={() => react(r.emoji)}
                title={r.names?.join(', ')}
                aria-label={`${r.emoji} ${r.count}${r.mine ? ', yours — remove' : ''}`}
                className={cx('rounded-full bg-surface px-1.5 py-px text-[11.5px] font-semibold text-ink shadow-[0_1px_3px_rgb(var(--ws-shadow-rgb)/.18)]', r.mine && 'ring-1 ring-primary/40')}
              >
                {r.emoji} {r.count}
              </button>
            ))}
          </div>
        ) : null}
        {pop?.kind === 'react' ? (
          <div role="toolbar" aria-label="React" className="fixed z-40 flex items-center gap-0.5 rounded-full bg-surface p-1 shadow-[0_8px_24px_rgb(var(--ws-shadow-rgb)/.18),0_0_0_1px_var(--ws-edge)]" style={{ left: pop.left, top: pop.top }}>
            {DRAWER_REACTIONS.map((e) => (
              <button key={e} type="button" aria-label={`React ${e}`} onClick={() => react(e)} className="flex h-[34px] w-[34px] items-center justify-center rounded-full text-[21px] leading-none transition-transform hover:scale-110 hover:bg-selection">
                {e}
              </button>
            ))}
            <button type="button" aria-label="More reactions" title="More reactions" onClick={() => (setPop(null), setPicker(true))} className="ml-0.5 flex h-[34px] w-[34px] items-center justify-center rounded-full bg-subtle text-ink-2 hover:text-ink">
              <Icon name="plus" size={16} />
            </button>
          </div>
        ) : null}
        {pop?.kind === 'more' ? (
          <div role="menu" aria-label="Message actions" className="fixed z-40 w-[214px] rounded-[12px] bg-surface p-1.5 shadow-[0_16px_40px_rgb(var(--ws-shadow-rgb)/.2),0_0_0_1px_var(--ws-edge)]" style={{ left: pop.left, top: pop.top }}>
            {items.map((it, i) => (
              <div key={it.label}>
                {it.danger && i > 0 ? <span className="mx-1.5 my-1 block h-px bg-line" /> : null}
                <button type="button" role="menuitem" onClick={() => (setPop(null), it.run())} className={cx('flex h-8 w-full items-center gap-2.5 rounded-[8px] px-2.5 text-left text-[13px] hover:bg-subtle', it.danger ? 'text-danger' : 'text-ink')}>
                  <Icon name={it.icon} size={15} className={it.danger ? '' : 'text-ink-2'} />
                  {it.label}
                </button>
              </div>
            ))}
          </div>
        ) : null}
        {picker ? <EmojiPicker className={cx('absolute top-6 z-30', own ? 'right-0' : 'left-0')} onPick={react} onClose={() => setPicker(false)} /> : null}
      </div>
      {deleting ? <DeleteDialog m={m} scope={deleting} setScope={setDeleting} onDelete={(scope) => void act(() => apiPost(`/api/chat/messages/${m.id}/delete`, { scope }))} /> : null}
    </div>
  );
}

const REACTION_BAR = ['👍', '❤️', '😂', '😮', '😢', '🎉', '👏'];

interface MenuItem {
  icon: string;
  label: string;
  danger?: boolean;
  run: () => void;
}

/**
 * A message's actions (Chat · message actions): a small round button on the
 * message, shown on hover, that opens the reactions above and the menu below.
 */
function MessageMenu({ own, named, open, setOpen, reactions, onReact, onMoreReactions, items }: { own: boolean; named: boolean; open: boolean; setOpen: (v: boolean) => void; reactions: string[]; onReact: (e: string) => void; onMoreReactions: () => void; items: Array<MenuItem | null> }) {
  const box = useRef<HTMLDivElement>(null);
  const [at, setAt] = useState<{ bar: { left: number; top: number }; menu: { left: number; top: number } } | null>(null);
  const shown = items.filter((x): x is MenuItem => !!x);
  useEffect(() => {
    if (!open) return;
    const off = (e: MouseEvent) => box.current && !box.current.contains(e.target as Node) && setOpen(false);
    const key = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    // The menu floats over the thread; a scroll leaves it behind, so it closes.
    const scroll = (e: Event) => box.current && !box.current.contains(e.target as Node) && setOpen(false);
    window.addEventListener('mousedown', off);
    window.addEventListener('keydown', key);
    window.addEventListener('scroll', scroll, true);
    return () => {
      window.removeEventListener('mousedown', off);
      window.removeEventListener('keydown', key);
      window.removeEventListener('scroll', scroll, true);
    };
  }, [open, setOpen]);

  // Placed when opened, from where the button and the message are: the
  // reactions above the message, the menu under the button — or above it when
  // the message sits at the bottom of the thread.
  const place = (button: HTMLElement) => {
    const r = button.getBoundingClientRect();
    const col = (button.closest('[data-bubble]') ?? button).getBoundingClientRect();
    const barW = 44 + reactions.length * 34 + 40;
    const menuH = shown.length * 34 + 12 + (shown.some((x) => x.danger) ? 9 : 0);
    const clampX = (x: number, w: number) => Math.max(8, Math.min(window.innerWidth - w - 8, x));
    const below = r.bottom + 4 + menuH <= window.innerHeight - 8;
    const menuTop = below ? r.bottom + 4 : Math.max(8, r.top - menuH - 4);
    // Flipped, the reactions sit on top of the menu rather than under it.
    const barTop = below ? col.top - 48 : menuTop - 48;
    setAt({
      bar: { left: clampX(own ? col.right - barW : col.left, barW), top: barTop >= 8 ? barTop : col.bottom + 6 },
      menu: { left: clampX(own ? r.right - 200 : r.left, 200), top: menuTop },
    });
  };

  return (
    <div ref={box} className="pointer-events-none absolute inset-0 z-20">
      <button
        type="button"
        aria-label="Message actions"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={(e) => {
          if (!open) place(e.currentTarget);
          setOpen(!open);
        }}
        className={cx(
          'pointer-events-auto absolute flex h-[22px] w-[22px] items-center justify-center rounded-full bg-selection text-primary shadow-[0_1px_3px_rgb(var(--ws-shadow-rgb)/.12)]',
          named ? 'top-[24px]' : 'top-[2px]',
          own ? '-left-7' : '-right-7',
          open ? 'visible' : 'invisible group-hover:visible group-focus-within:visible',
        )}
      >
        <Icon name="chevron-down" size={14} />
      </button>
      {open && at ? (
        <>
          {reactions.length ? (
            <div role="toolbar" aria-label="React" className="pointer-events-auto fixed z-40 flex items-center gap-0.5 rounded-[22px] bg-surface px-1.5 py-1 shadow-[0_8px_24px_rgb(var(--ws-shadow-rgb)/.16),0_0_0_1px_var(--ws-edge)]" style={at.bar}>
              {reactions.map((e) => (
                <button key={e} type="button" aria-label={`React ${e}`} onClick={() => (setOpen(false), onReact(e))} className="flex h-8 w-8 items-center justify-center rounded-full text-[19px] leading-none hover:bg-selection">
                  {e}
                </button>
              ))}
              <span className="mx-0.5 h-5 w-px bg-line" />
              <button type="button" aria-label="More reactions" title="More reactions" onClick={onMoreReactions} className="flex h-8 w-8 items-center justify-center rounded-full bg-subtle text-ink-2 hover:text-ink">
                <Icon name="smile" size={16} />
              </button>
            </div>
          ) : null}
          <div role="menu" aria-label="Message actions" className="pointer-events-auto fixed z-40 w-[200px] rounded-[12px] bg-surface p-1.5 shadow-[0_16px_40px_rgb(var(--ws-shadow-rgb)/.2),0_0_0_1px_var(--ws-edge)]" style={at.menu}>
            {shown.map((it, i) => (
              <div key={it.label}>
                {it.danger && i > 0 ? <span className="mx-1.5 my-1 block h-px bg-line" /> : null}
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => (setOpen(false), it.run())}
                  className={cx('flex h-[34px] w-full items-center gap-2.5 rounded-[8px] px-2.5 text-left text-[13px] font-medium hover:bg-subtle', it.danger ? 'text-danger' : 'text-ink')}
                >
                  <Icon name={it.icon} size={15} className={it.danger ? '' : 'text-ink-3'} />
                  {it.label}
                </button>
              </div>
            ))}
          </div>
        </>
      ) : null}
    </div>
  );
}

/** A call's card in the thread (ChatDrawer: "Missed voice call · Call back"). */
function CallCard({ m, own, roomId, compact }: { m: ChatMessage; own: boolean; roomId: string; compact?: boolean }) {
  // A Meet meeting has a card of its own: its name, who started it, live or ended, and one action (worksuite-desktop#71).
  if (m.call_kind === 'meeting') return <MeetingCard m={m} own={own} roomId={roomId} compact={compact} />;
  return <NativeCallCard m={m} own={own} roomId={roomId} compact={compact} />;
}

function NativeCallCard({ m, own, roomId, compact }: { m: ChatMessage; own: boolean; roomId: string; compact?: boolean }) {
  const d = describeCard(m, own);
  const video = m.call_mode === 'video' || m.call_kind === 'meeting';
  const act = () => {
    if (d.action === 'Join') {
      if (m.call_kind === 'meeting') void openMeeting(m.call_uuid!);
      else void answerCall(m.call_uuid!, roomId, false, m.sender_name);
    } else if (d.action) void startCall(roomId, video ? 'video' : 'audio', m.sender_name);
  };
  if (compact) {
    return (
      <div className={cx('mt-2.5 flex', own ? 'justify-end' : 'justify-start')}>
        <div className="flex items-center gap-2 rounded-full bg-surface py-1.5 pr-1.5 pl-1.5 shadow-[0_1px_2px_rgb(var(--ws-shadow-rgb)/.12)]">
          <span className={cx('flex h-7 w-7 shrink-0 items-center justify-center rounded-full', d.tone === 'missed' ? 'bg-danger-bg text-danger' : d.tone === 'live' ? 'bg-success-bg text-success' : 'bg-selection text-primary')}>
            <Icon name={video ? 'video' : 'phone'} size={14} />
          </span>
          <b className={cx('text-[12.5px]', d.tone === 'missed' ? 'text-danger' : 'text-ink')}>{d.title}</b>
          <span className="text-[12px] text-ink-3">
            {timeLabel(m.created_at)}
            {d.detail ? ` · ${d.detail}` : ''}
          </span>
          {d.action ? (
            <button type="button" onClick={act} className={cx('h-7 shrink-0 rounded-full px-3 text-[12px] font-bold', d.action === 'Join' ? 'bg-success text-white' : 'bg-success-bg text-success hover:brightness-95')}>
              {d.action}
            </button>
          ) : null}
        </div>
      </div>
    );
  }
  return (
    <div className={cx('mt-3 flex', own ? 'justify-end' : 'justify-start')}>
      <div className={cx('flex items-center gap-2.5 rounded-[12px] border px-3 py-2.5', d.tone === 'missed' ? 'border-[#F1B8A8] bg-surface dark:border-danger/40' : d.tone === 'live' ? 'border-[#9EE6C3] bg-surface' : 'border-line bg-surface')}>
        <span className={cx('flex h-8 w-8 shrink-0 items-center justify-center rounded-full', d.tone === 'missed' ? 'bg-danger-bg text-danger' : d.tone === 'live' ? 'bg-success-bg text-success' : 'bg-selection text-primary')}>
          <Icon name={video ? 'video' : 'phone'} size={15} />
        </span>
        <span className="flex min-w-0 flex-col">
          <b className={cx('text-[13px]', d.tone === 'missed' ? 'text-danger' : 'text-ink')}>{d.title}</b>
          <span className="text-[12px] text-ink-3">
            {timeLabel(m.created_at)}
            {d.detail ? ` · ${d.detail}` : ''}
          </span>
        </span>
        {d.action ? (
          <button type="button" onClick={act} className={cx('ml-1 h-7 shrink-0 rounded-full px-3 text-[12px] font-bold', d.action === 'Join' ? 'bg-success text-white' : 'border border-line text-primary hover:bg-subtle')}>
            {d.action}
          </button>
        ) : null}
      </div>
    </div>
  );
}
