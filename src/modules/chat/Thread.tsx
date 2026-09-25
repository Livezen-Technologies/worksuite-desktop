import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { OfflineMutation } from '@shared/types';
import { app } from '../../core/app-state';
import { apiGet, apiPost, apiPut } from '../../core/api';
import { call, errorMessage, on, registerDropped } from '../../core/bridge';
import { useStore } from '../../core/store';
import { useTab } from '../../core/tab-context';
import { dayKey, dayLabel, parseTs, timeLabel } from '../../core/time';
import { toast } from '../../core/toasts';
import { Icon } from '../../components/Icon';
import { Avatar, Button, ErrorNote, FileBadge, Modal, Spinner, cx } from '../../components/ui';
import { describeCard } from '../calls/log';
import { answerCall, startCall } from '../calls/start';
import { openMeeting } from '../meet/api';
import { startMeetingFromChat } from '../meet/start';
import { Composer, type ComposerHandle } from './Composer';
import { PRESENCE } from './Details';
import { ForwardDialog, type RoomDetail } from './NewChat';
import { EmojiPicker, QUICK_REACTIONS, VoicePlayer } from './parts';
import { mediaUrl, type ChatMessage, type Room } from './types';

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
export function Thread({ roomId, room, mini, bare, rooms, detailsOpen, onToggleDetails }: { roomId: string; room: Room | undefined; mini: boolean; bare?: boolean; rooms: Room[]; detailsOpen?: boolean; onToggleDetails?: () => void }) {
  const qc = useQueryClient();
  const me = useStore(app, (s) => s.auth?.user?.id);
  const meetAllowed = useStore(app, (s) => s.apps.some((a) => a.id === 'meet'));
  const scroller = useRef<HTMLDivElement>(null);
  const [typing, setTyping] = useState<Record<string, string>>({});
  const composer = useRef<ComposerHandle>(null);
  const [drag, setDrag] = useState(false);
  const [reply, setReply] = useState<ReplyTarget | null>(null);
  const [forwarding, setForwarding] = useState<ChatMessage | null>(null);
  const [searching, setSearching] = useState(false);
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

  return (
    <div
      className="relative flex h-full flex-col bg-ground"
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
        <Avatar name={room?.avatar_name || room?.name} size={mini ? 30 : 36} className={group ? '!rounded-[10px]' : ''} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[14.5px] font-bold text-ink">{room?.name ?? 'Conversation'}</div>
          <div className="truncate text-[12px] text-ink-3">{subtitle}</div>
        </div>
        {!mini ? (
          <button type="button" aria-label="Search in conversation" title="Search in conversation" aria-pressed={searching} onClick={() => setSearching(!searching)} className={cx(headerBtn, searching && '!border-primary !bg-selection !text-primary')}>
            <Icon name="search" size={15} />
          </button>
        ) : null}
        <button type="button" aria-label="Start a voice call" title="Voice call" onClick={() => void startCall(roomId, 'audio', room?.name)} className={headerBtn}>
          <Icon name="phone" size={16} />
        </button>
        <button type="button" aria-label="Start a video call" title="Video call" onClick={() => void startCall(roomId, 'video', room?.name)} className={headerBtn}>
          <Icon name="video" size={16} />
        </button>
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
          <button type="button" aria-label="Pop out" title="Pop out" onClick={() => void call('windows:open', { kind: 'chat-mini', route: `/chat?room=${roomId}`, title: room?.name, alwaysOnTop: true })} className={cx(headerBtn, mini && 'hidden')}>
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
      <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto px-5 py-3.5 scroll-thin">
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
          return (
            <div key={m.id} id={`msg-${m.id}`}>
              {header ? <div className="my-3 text-center"><span className="rounded-full bg-subtle px-2.5 py-[3px] text-[11.5px] font-semibold text-ink-3">{dayLabel(header, 'short')}</span></div> : null}
              <Bubble m={m} own={String(m.sender_id) === me} roomId={roomId} onReply={setReply} onForward={setForwarding} onEdit={(x) => composer.current?.edit({ id: x.id, message: x.message ?? '' })} />
            </div>
          );
        })}
        {mine.map((p) => (
          <div key={p.id} className="mt-3 flex flex-col items-end gap-1">
            <div className="max-w-[520px] rounded-[12px_4px_12px_12px] border border-dashed border-[#8C9AD3] bg-[#DDE3F7] px-[13px] py-[9px] text-[13.5px] text-ink dark:bg-selection">{p.label.replace(/^Message: /, '')}</div>
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
      <Composer ref={composer} roomId={roomId} roomName={room?.name ?? 'this conversation'} group={group} reply={reply} onClearReply={() => setReply(null)} typing={Object.values(typing)} compact={mini || bare} />
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
  const qc = useQueryClient();
  const { openLink } = useTab();
  const [picker, setPicker] = useState(false);
  const [more, setMore] = useState(false);
  const [deleting, setDeleting] = useState<'everyone' | 'me' | null>(null);
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
  const tool = 'rounded-[6px] px-[7px] py-1 text-[11.5px] font-semibold text-ink hover:bg-subtle';
  return (
    <div className={cx('group relative mt-3 flex gap-2.5', own && 'flex-row-reverse')}>
      {!own ? <Avatar name={m.sender_name} size={30} /> : null}
      <div className={cx('flex max-w-[560px] flex-col gap-1', own && 'items-end')}>
        {!own ? (
          <span className="text-[12px]">
            <b className="text-ink">{m.sender_name}</b> <span className="text-ink-3">{timeLabel(m.created_at)}</span>
          </span>
        ) : null}
        {m.reply_preview ? <div className="rounded-[6px] border-l-[3px] border-[#7FA2FF] bg-selection px-2.5 py-1.5 text-[12px] text-ink-2">Replying to {m.reply_preview.sender_name}: “{m.reply_preview.snippet}”</div> : null}
        {m.urgent && !m.deleted ? <span className="text-[10.5px] font-bold tracking-[0.5px] text-danger uppercase">Urgent</span> : null}
        {m.message && !m.deleted ? (
          <div className={cx('whitespace-pre-wrap break-words px-[13px] py-[9px] text-[13.5px] leading-[1.55] selectable', bubble)}>{m.message}</div>
        ) : m.deleted ? (
          <div className="rounded-[12px] border border-line px-3 py-2 text-[12.5px] text-ink-3 italic">Message deleted</div>
        ) : null}
        {m.card && !m.deleted ? (
          <div className="flex w-[380px] flex-col gap-1.5 rounded-[12px] border border-line bg-surface px-3.5 py-3">
            {m.card.available === false ? (
              <span className="text-[12.5px] text-ink-3">{m.card.why}</span>
            ) : (
              <>
                <span className="text-[11px] font-bold tracking-[0.5px] text-[#9A4A06] uppercase dark:text-warning">{m.card.heading ?? m.card.kind.split('.')[0]}</span>
                <b className="text-[13px] text-ink">{m.card.name ?? m.card.what ?? ''}{m.card.who ? ` · ${m.card.who}` : ''}</b>
                {m.card.owner ? <span className="text-[12px] text-ink-3">{m.card.owner}</span> : null}
                {m.card.link ? <button type="button" onClick={() => openLink(m.card!.link!)} className="self-start text-[12px] font-semibold text-primary hover:underline">Open</button> : null}
              </>
            )}
          </div>
        ) : null}
        {f && !m.deleted ? (
          voice && mediaUrl(f.url) ? (
            <VoicePlayer src={mediaUrl(f.url)!} ms={f.duration_ms} seed={m.id} own={own} />
          ) : f.preview === 'image' && src ? (
            <button type="button" className="overflow-hidden rounded-[12px] border border-line" onClick={() => f.download_url && openLink(f.download_url)} aria-label={`Open ${f.filename}`}>
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
              <button type="button" onClick={() => f.download_url && openLink(f.download_url)} className="text-[12px] font-semibold text-primary hover:underline">Open</button>
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
                className={cx('rounded-full border px-2 py-px text-[11.5px]', r.mine ? 'border-[#C7D0F0] bg-selection' : 'border-line bg-surface hover:bg-subtle')}
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
      {!m.deleted ? (
        <div className={cx('invisible absolute -top-3 z-10 flex items-center gap-0.5 rounded-[9px] border border-line bg-surface p-[3px] shadow-[0_6px_18px_rgba(15,27,61,.14)] group-hover:visible group-focus-within:visible', own ? 'right-2' : 'left-10')} role="toolbar" aria-label="Message actions">
          {can.react !== false ? QUICK_REACTIONS.slice(0, 3).map((e) => (
            <button key={e} type="button" aria-label={`React ${e}`} onClick={() => react(e)} className="flex h-6 w-6 items-center justify-center rounded-[6px] text-[14px] hover:bg-subtle">{e}</button>
          )) : null}
          {can.react !== false ? <button type="button" className={tool} onClick={() => setPicker(!picker)}>React</button> : null}
          {can.reply !== false ? <button type="button" className={tool} onClick={() => onReply({ id: m.id, sender_name: m.sender_name, snippet: (m.message ?? m.file?.filename ?? '').slice(0, 120) })}>Reply</button> : null}
          {can.forward ? <button type="button" className={tool} onClick={() => onForward(m)}>Forward…</button> : null}
          <button type="button" className={tool} onClick={() => void act(() => apiPut(`/api/chat/messages/${m.id}/star`, { starred: !m.starred }), m.starred ? 'Unstarred.' : 'Starred.')}>{m.starred ? 'Unstar' : 'Star'}</button>
          <button type="button" className={tool} onClick={() => void act(() => apiPut(`/api/chat/messages/${m.id}/pin`, { pinned: !m.pinned }), m.pinned ? 'Unpinned.' : 'Pinned for everyone.')}>{m.pinned ? 'Unpin' : 'Pin'}</button>
          <button type="button" className={tool} onClick={() => void navigator.clipboard.writeText(`worksuite://chat/${roomId}`).then(() => toast('success', 'Link copied.'))}>Copy link</button>
          {can.edit || can.copy || can.delete_me || can.delete_everyone ? (
            <span className="relative">
              <button type="button" className={tool} aria-haspopup="menu" aria-expanded={more} onClick={() => setMore(!more)}>More ⋯</button>
              {more ? (
                <div role="menu" className="absolute top-8 right-0 z-30 w-44 rounded-[10px] border border-line bg-surface py-1 shadow-xl">
                  {can.edit ? <button type="button" role="menuitem" className="block w-full px-3 py-1.5 text-left text-[13px] hover:bg-subtle" onClick={() => (setMore(false), onEdit(m))}>Edit</button> : null}
                  {m.message ? <button type="button" role="menuitem" className="block w-full px-3 py-1.5 text-left text-[13px] hover:bg-subtle" onClick={() => (setMore(false), void navigator.clipboard.writeText(m.message ?? '').then(() => toast('success', 'Copied.')))}>Copy text</button> : null}
                  {can.delete_me || can.delete_everyone ? <button type="button" role="menuitem" className="block w-full px-3 py-1.5 text-left text-[13px] text-danger hover:bg-subtle" onClick={() => (setMore(false), setDeleting(can.delete_everyone ? 'everyone' : 'me'))}>Delete…</button> : null}
                </div>
              ) : null}
            </span>
          ) : null}
        </div>
      ) : null}
      {picker ? <EmojiPicker className={cx('absolute top-6', own ? 'right-2' : 'left-10')} onPick={react} onClose={() => setPicker(false)} /> : null}
      {deleting ? (
        <Modal
          title="Delete message?"
          onClose={() => setDeleting(null)}
          width={420}
          footer={
            <>
              <Button onClick={() => setDeleting(null)}>Cancel</Button>
              <Button variant="danger" onClick={() => {
                const scope = deleting;
                setDeleting(null);
                void act(() => apiPost(`/api/chat/messages/${m.id}/delete`, { scope }));
              }}>
                Delete
              </Button>
            </>
          }
        >
          <div className="flex flex-col gap-3 text-[13px]">
            <div className="rounded-[9px] bg-subtle px-3 py-2.5 text-ink-2">“{(m.message ?? m.file?.filename ?? '').slice(0, 120)}”</div>
            {can.delete_everyone ? (
              <label className="flex items-start gap-2.5">
                <input type="radio" name={`del-${m.id}`} checked={deleting === 'everyone'} onChange={() => setDeleting('everyone')} className="mt-0.5 accent-[var(--color-primary)]" />
                <span className="flex flex-col"><b className="text-ink">Delete for everyone</b><span className="text-[12px] text-ink-3">Shows “Message deleted” in the conversation</span></span>
              </label>
            ) : null}
            {can.delete_me ? (
              <label className="flex items-start gap-2.5">
                <input type="radio" name={`del-${m.id}`} checked={deleting === 'me'} onChange={() => setDeleting('me')} className="mt-0.5 accent-[var(--color-primary)]" />
                <span className="flex flex-col"><b className="text-ink">Delete for me</b><span className="text-[12px] text-ink-3">Others still see it</span></span>
              </label>
            ) : null}
          </div>
        </Modal>
      ) : null}
    </div>
  );
}

/** A call's card in the thread (ChatDrawer: "Missed voice call · Call back"). */
function CallCard({ m, own, roomId }: { m: ChatMessage; own: boolean; roomId: string }) {
  const d = describeCard(m, own);
  const video = m.call_mode === 'video' || m.call_kind === 'meeting';
  const act = () => {
    if (d.action === 'Join') {
      if (m.call_kind === 'meeting') void openMeeting(m.call_uuid!);
      else void answerCall(m.call_uuid!, roomId, false, m.sender_name);
    } else if (d.action) void startCall(roomId, video ? 'video' : 'audio', m.sender_name);
  };
  return (
    <div className={cx('mt-3 flex', own ? 'justify-end' : 'justify-start')}>
      <div className={cx('flex items-center gap-2.5 rounded-[12px] border px-3 py-2.5', d.tone === 'missed' ? 'border-[#F1B8A8] bg-surface' : d.tone === 'live' ? 'border-[#9EE6C3] bg-surface' : 'border-line bg-surface')}>
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
