import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { OfflineMutation } from '@shared/types';
import { app } from '../../core/app-state';
import { apiGet, apiPost } from '../../core/api';
import { call, errorMessage, on, registerDropped } from '../../core/bridge';
import { useStore } from '../../core/store';
import { useTab } from '../../core/tab-context';
import { dayKey, dayLabel, parseTs, timeLabel } from '../../core/time';
import { toast } from '../../core/toasts';
import { Icon } from '../../components/Icon';
import { Avatar, Button, ErrorNote, FileBadge, IconButton, Modal, Spinner, cx } from '../../components/ui';
import { Composer } from './Composer';
import { EmojiPicker, QUICK_REACTIONS, VoicePlayer } from './parts';
import { mediaUrl, type ChatMessage, type Room } from './types';

export interface ReplyTarget {
  id: number;
  sender_name: string;
  snippet: string;
}

/** How long a "typing…" lasts if its "stopped" never arrives. */
const TYPING_TIMEOUT = 8_000;

export function Thread({ roomId, room, mini }: { roomId: string; room: Room | undefined; mini: boolean }) {
  const qc = useQueryClient();
  const me = useStore(app, (s) => s.auth?.user?.id);
  const scroller = useRef<HTMLDivElement>(null);
  const [typing, setTyping] = useState<string | null>(null);
  const [drag, setDrag] = useState(false);
  const [reply, setReply] = useState<ReplyTarget | null>(null);
  const msgs = useInfiniteQuery({
    queryKey: ['chat', 'messages', roomId],
    initialPageParam: null as number | null,
    queryFn: ({ pageParam, signal }) => apiGet<{ messages: ChatMessage[] }>('/api/chat/messages', { room_id: roomId, before: pageParam ?? undefined }, signal),
    getNextPageParam: (last) => (last.messages.length >= 40 ? last.messages[0]?.id : undefined),
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

  useEffect(() => {
    let clear: ReturnType<typeof setTimeout> | null = null;
    const off = on<{ type: string; room_id?: number; name?: string; user_name?: string; by?: number }>('realtime:event', (e) => {
      if (String(e.room_id) !== roomId || String(e.by) === me) return;
      if (e.type === 'chat.typing.started') {
        setTyping(e.name ?? e.user_name ?? 'Someone');
        if (clear) clearTimeout(clear);
        clear = setTimeout(() => setTyping(null), TYPING_TIMEOUT);
      }
      if (e.type === 'chat.typing.stopped' || e.type === 'chat.message') setTyping(null);
    });
    return () => {
      off();
      if (clear) clearTimeout(clear);
    };
  }, [roomId, me]);

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
          <div className="truncate text-[12.5px] text-ink-3">{typing ? `${typing} is typing…` : room?.type === 'direct' ? 'Direct message' : room?.type === 'group' ? 'Group' : (room?.type ?? '')}</div>
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
          return (
            <div key={m.id}>
              {header ? <div className="my-3 text-center"><span className="rounded-full bg-subtle px-3 py-1 text-[12px] font-semibold text-ink-2">{dayLabel(header, 'short')}</span></div> : null}
              <Bubble m={m} own={String(m.sender_id) === me} roomId={roomId} onReply={setReply} />
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
      <Composer roomId={roomId} roomName={room?.name ?? 'this conversation'} onFiles={onDrop} reply={reply} onClearReply={() => setReply(null)} />
      {drag ? (
        <div className="pointer-events-none absolute inset-3 flex items-center justify-center rounded-[14px] border-2 border-dashed border-primary bg-selection/80 text-[15px] font-semibold text-primary">
          Drop to send to {room?.name ?? 'this conversation'}
        </div>
      ) : null}
    </div>
  );
}

function Bubble({ m, own, roomId, onReply }: { m: ChatMessage; own: boolean; roomId: string; onReply: (r: ReplyTarget) => void }) {
  const qc = useQueryClient();
  const { openLink } = useTab();
  const [picker, setPicker] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const can = m.can ?? {};
  const refresh = () => void qc.invalidateQueries({ queryKey: ['chat', 'messages', roomId] });
  const act = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
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
  const saveEdit = () => {
    const text = (editing ?? '').trim();
    setEditing(null);
    if (text && text !== m.message) void act(() => apiPost(`/api/chat/messages/${m.id}/edit`, { message: text }));
  };

  if (m.type === 'system') return <div className="my-2 text-center text-[12px] text-ink-3">{m.message}</div>;
  const f = m.file;
  const src = mediaUrl(f?.mime === 'image/gif' ? f.url : (f?.thumb_url ?? f?.url));
  const voice = !!f && (m.type === 'voice' || f.preview === 'audio');
  return (
    <div className={cx('group relative mt-2 flex gap-3', own && 'flex-row-reverse')}>
      {!own ? <Avatar name={m.sender_name} size={32} /> : null}
      <div className={cx('flex max-w-[70%] flex-col', own && 'items-end')}>
        {!own ? (
          <div className="mb-0.5 text-[12.5px]">
            <span className="font-semibold text-ink">{m.sender_name}</span> <span className="text-ink-3">{timeLabel(m.created_at)}</span>
          </div>
        ) : null}
        {m.reply_preview ? <div className="mb-1 rounded-[8px] border-l-2 border-primary bg-subtle px-2.5 py-1 text-[12px] text-ink-2">{m.reply_preview.sender_name}: {m.reply_preview.snippet}</div> : null}
        {editing !== null ? (
          <div className="flex w-[min(440px,60vw)] flex-col gap-1.5">
            <textarea
              value={editing}
              onChange={(e) => setEditing(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  saveEdit();
                }
                if (e.key === 'Escape') setEditing(null);
              }}
              autoFocus
              aria-label="Edit message"
              className="min-h-[60px] rounded-[10px] border border-primary bg-surface px-3 py-2 text-[13.5px] outline-none"
            />
            <div className="flex justify-end gap-1.5">
              <Button size="sm" onClick={() => setEditing(null)}>Cancel</Button>
              <Button size="sm" variant="primary" onClick={saveEdit}>Save</Button>
            </div>
          </div>
        ) : m.message && !m.deleted ? (
          <div className={cx('whitespace-pre-wrap break-words rounded-[14px] px-4 py-2.5 text-[13.5px] leading-relaxed selectable', own ? 'bg-primary text-white' : 'border border-line bg-surface text-ink')}>{m.message}</div>
        ) : m.deleted ? (
          <div className="rounded-[14px] border border-line px-4 py-2 text-[12.5px] italic text-ink-3">Message deleted</div>
        ) : null}
        {f && !m.deleted ? (
          voice && mediaUrl(f.url) ? (
            <div className="mt-1"><VoicePlayer src={mediaUrl(f.url)!} ms={f.duration_ms} seed={m.id} own={own} /></div>
          ) : f.preview === 'image' && src ? (
            <button type="button" className="mt-1 overflow-hidden rounded-[12px] border border-line" onClick={() => f.download_url && openLink(f.download_url)} aria-label={`Open ${f.filename}`}>
              <img src={src} alt={f.filename} loading="lazy" className="max-h-[260px] max-w-[320px] object-cover" />
            </button>
          ) : f.preview === 'video' && mediaUrl(f.url) ? (
            <video src={mediaUrl(f.url)!} poster={mediaUrl(f.poster_url) ?? undefined} controls preload="metadata" className="mt-1 max-h-[260px] max-w-[360px] rounded-[12px] border border-line" />
          ) : (
            <button type="button" onClick={() => f.download_url && openLink(f.download_url)} className="mt-1 flex items-center gap-3 rounded-[12px] border border-line bg-surface px-3 py-2.5 text-left hover:bg-subtle">
              <FileBadge name={f.filename} />
              <span>
                <span className="block max-w-[260px] truncate text-[13px] font-semibold text-ink">{f.filename}</span>
                <span className="block text-[11.5px] text-ink-3">{Math.max(1, Math.round(f.size / 1024))} KB{f.status !== 'ready' ? ` · ${f.status}` : ''}</span>
              </span>
            </button>
          )
        ) : null}
        {m.reactions.length ? (
          <div className="mt-1 flex flex-wrap gap-1">
            {m.reactions.map((r) => (
              <button
                key={r.emoji}
                type="button"
                disabled={can.react === false}
                onClick={() => react(r.emoji)}
                title={r.names?.join(', ')}
                aria-label={`${r.emoji} ${r.count}${r.mine ? ', yours — remove' : ''}`}
                className={cx('rounded-full border px-2 py-0.5 text-[12px]', r.mine ? 'border-primary/40 bg-selection' : 'border-line bg-surface hover:bg-subtle')}
              >
                {r.emoji} {r.count}
              </button>
            ))}
          </div>
        ) : null}
        {own ? (
          <div className="mt-0.5 text-[11.5px] text-ink-3">
            {timeLabel(m.created_at)}
            {m.edited ? ' · edited' : ''}
            {m.receipt ? ` · ${m.receipt.status === 'read' ? `Read by ${m.receipt.read}` : m.receipt.status === 'delivered' ? 'Delivered' : 'Sent'}` : ''}
          </div>
        ) : m.edited ? <div className="mt-0.5 text-[11.5px] text-ink-3">edited</div> : null}
      </div>
      {!m.deleted && editing === null ? (
        <div className={cx('invisible absolute -top-3 z-10 flex items-center gap-0.5 rounded-[9px] border border-line bg-surface p-0.5 shadow-md group-hover:visible group-focus-within:visible', own ? 'left-0' : 'right-0')} role="toolbar" aria-label="Message actions">
          {can.react !== false ? QUICK_REACTIONS.slice(0, 4).map((e) => (
            <button key={e} type="button" aria-label={`React ${e}`} onClick={() => react(e)} className="flex h-7 w-7 items-center justify-center rounded-[6px] text-[15px] hover:bg-subtle">{e}</button>
          )) : null}
          {can.react !== false ? <IconButton icon="smile" label="More reactions" size={15} onClick={() => setPicker(!picker)} /> : null}
          {can.reply !== false ? <IconButton icon="reply" label="Reply" size={15} onClick={() => onReply({ id: m.id, sender_name: m.sender_name, snippet: (m.message ?? m.file?.filename ?? '').slice(0, 120) })} /> : null}
          {can.edit ? <IconButton icon="compose" label="Edit" size={15} onClick={() => setEditing(m.message ?? '')} /> : null}
          {can.delete_me || can.delete_everyone ? <IconButton icon="trash" label="Delete" size={15} onClick={() => setDeleting(true)} /> : null}
        </div>
      ) : null}
      {picker ? <EmojiPicker className={cx('absolute top-6', own ? 'left-0' : 'right-0')} onPick={react} onClose={() => setPicker(false)} /> : null}
      {deleting ? (
        <Modal
          title="Delete this message?"
          onClose={() => setDeleting(false)}
          width={420}
          footer={
            <>
              <Button onClick={() => setDeleting(false)}>Cancel</Button>
              {can.delete_me ? <Button onClick={() => (setDeleting(false), void act(() => apiPost(`/api/chat/messages/${m.id}/delete`, { scope: 'me' })))}>Delete for me</Button> : null}
              {can.delete_everyone ? <Button variant="danger" onClick={() => (setDeleting(false), void act(() => apiPost(`/api/chat/messages/${m.id}/delete`, { scope: 'everyone' })))}>Delete for everyone</Button> : null}
            </>
          }
        >
          <p className="text-[13px] text-ink-2">{can.delete_everyone ? 'Deleting for everyone removes it from this conversation for all its members.' : 'It will be removed from your view of this conversation.'}</p>
        </Modal>
      ) : null}
    </div>
  );
}
