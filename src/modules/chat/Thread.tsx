import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { OfflineMutation } from '@shared/types';
import { app } from '../../core/app-state';
import { apiGet, apiPost, apiPut } from '../../core/api';
import { call, errorMessage, on, registerDropped } from '../../core/bridge';
import { useStore } from '../../core/store';
import { navigate } from '../../core/tabs';
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
import { EmojiPicker, VoicePlayer } from './parts';
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
export function Thread({ roomId, room, mini, bare, tools, rooms, detailsOpen, onToggleDetails }: { roomId: string; room: Room | undefined; mini: boolean; bare?: boolean; tools?: boolean; rooms: Room[]; detailsOpen?: boolean; onToggleDetails?: () => void }) {
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

  const chip = 'rounded-full border border-line px-2 py-[3px] text-ink-2 hover:bg-subtle hover:text-ink disabled:opacity-60';
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
      <Composer
        ref={composer}
        roomId={roomId}
        roomName={room?.name ?? 'this conversation'}
        group={group}
        reply={reply}
        onClearReply={() => setReply(null)}
        typing={Object.values(typing)}
        compact={mini || bare}
        extras={
          tools ? (
            <div className="flex flex-wrap gap-1.5 text-[11.5px] font-semibold">
              <button type="button" onClick={() => navigate(`/tasks?new=1&title=${encodeURIComponent(`Follow up: ${room?.name ?? 'conversation'}`.slice(0, 200))}`)} className={chip}>
                Create task
              </button>
              <button type="button" disabled={saving} onClick={() => void saveAsNote()} className={chip}>
                {saving ? 'Saving…' : 'Save as note'}
              </button>
              <button type="button" aria-pressed={searching} onClick={() => setSearching(!searching)} className={cx(chip, searching && '!border-primary !bg-selection !text-primary')}>
                Search in conversation
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
  return (
    <div className={cx('group relative mt-3 flex gap-2.5', own && 'flex-row-reverse')}>
      {!own ? <Avatar name={m.sender_name} size={30} /> : null}
      <div data-bubble className={cx('relative flex max-w-[560px] flex-col gap-1', own && 'items-end')}>
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
      {picker ? <EmojiPicker className={cx('absolute top-8 z-30', own ? 'right-2' : 'left-10')} onPick={react} onClose={() => setPicker(false)} /> : null}
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
          'pointer-events-auto absolute flex h-[22px] w-[22px] items-center justify-center rounded-full bg-selection text-primary shadow-[0_1px_3px_rgba(15,27,61,.12)]',
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
            <div role="toolbar" aria-label="React" className="pointer-events-auto fixed z-40 flex items-center gap-0.5 rounded-[22px] bg-surface px-1.5 py-1 shadow-[0_8px_24px_rgba(15,27,61,.16),0_0_0_1px_rgba(15,27,61,.06)]" style={at.bar}>
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
          <div role="menu" aria-label="Message actions" className="pointer-events-auto fixed z-40 w-[200px] rounded-[12px] bg-surface p-1.5 shadow-[0_16px_40px_rgba(15,27,61,.2),0_0_0_1px_rgba(15,27,61,.06)]" style={at.menu}>
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
