import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useImperativeHandle, useRef, useState, type Ref, type ReactNode } from 'react';
import type { PickedFile } from '@shared/ipc/contract';
import { app } from '../../core/app-state';
import { apiGet, apiPost } from '../../core/api';
import { call, errorMessage, registerDropped } from '../../core/bridge';
import { useDraft } from '../../core/drafts';
import { useStore } from '../../core/store';
import { toast } from '../../core/toasts';
import { uploadBlob } from '../../core/upload';
import { Icon } from '../../components/Icon';
import { Avatar, cx } from '../../components/ui';
import { AttachMenu, CameraCapture, DrivePicker, Tray, type AttachChoice, type Staged } from './attach';
import { caretPoint } from './caret';
import { PRESENCE } from './Details';
import { mentionQuery } from './mentions';
import { EmojiPicker, VoiceRecorder } from './parts';
import { typingLine } from './typing';
import type { ReplyTarget } from './Thread';

/** At most one "typing" signal per few seconds; "stopped" after a pause or on send. */
const TYPING_EVERY = 4_000;
const TYPING_IDLE = 5_000;
const URGENT = 'chat.message.urgent';

type Target = { type: string; id: number; name: string; detail?: string | null };
type Mentionable = Record<'people' | 'teams' | 'departments' | 'everyone', Target[]>;
type BlobItem = Extract<Staged, { kind: 'blob' }>;
type DiskItem = Extract<Staged, { kind: 'disk' }>;
type Extra = { caption?: string; replyTo?: number };

/** What a conversation asks of its composer: files dropped on it, a message to edit. */
export interface ComposerHandle {
  stage: (files: PickedFile[]) => void;
  edit: (m: { id: number; message: string }) => void;
}

/**
 * The message box (ChatComposer — polished): attach, urgent, emoji and send
 * around the text; @ to mention with who is in the conversation; a reply or
 * an edit shown above it; files wait in a tray until Send; a voice message
 * records in its place. `compact` is the drawer's and the call panel's size.
 */
export function Composer({ roomId, roomName, group, reply, onClearReply, typing = [], compact, extras, ref }: {
  roomId: string;
  roomName: string;
  group: boolean;
  reply: ReplyTarget | null;
  onClearReply: () => void;
  typing?: string[];
  compact?: boolean;
  /** Actions above the box (the chat drawer's quick actions). */
  extras?: ReactNode;
  ref?: Ref<ComposerHandle>;
}) {
  const qc = useQueryClient();
  const draft = useDraft<string>('chat', `room:${roomId}`, '');
  const canUrgent = useStore(app, (s) => !!s.bootstrap?.permissions.some((p) => p === '*' || p === URGENT));
  const transfers = useStore(app, (s) => s.transfers);
  const [sending, setSending] = useState(false);
  const [editing, setEditing] = useState<{ id: number; original: string; text: string } | null>(null);
  const [urgent, setUrgent] = useState(false);
  const [menu, setMenu] = useState<'attach' | 'emoji' | null>(null);
  const [modal, setModal] = useState<'drive' | 'camera' | null>(null);
  const [recording, setRecording] = useState(false);
  const [staged, setStaged] = useState<Staged[]>([]);
  const [asking, setAsking] = useState<{ start: number; word: string; left: number } | null>(null);
  const [pick, setPick] = useState(0);
  const picked = useRef<Target[]>([]);
  const root = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const typingAt = useRef(0);
  const idle = useRef<ReturnType<typeof setTimeout> | null>(null);

  const suggestions = useQuery({
    queryKey: ['chat', 'mentionable', roomId, asking?.word ?? ''],
    queryFn: ({ signal }) => apiGet<Mentionable>(`/api/chat/rooms/${roomId}/mentionable`, { q: asking?.word ?? '' }, signal),
    enabled: group && asking !== null,
    staleTime: 30_000,
  });
  const found = asking ? suggestions.data : undefined;
  const people = found?.people ?? [];
  const options = found ? [...found.everyone, ...people, ...found.teams, ...found.departments].slice(0, 10) : [];
  const ids = people.map((p) => p.id).join(',');
  const presence = useQuery({
    queryKey: ['chat', 'presence', ids],
    queryFn: ({ signal }) => apiGet<{ presence: Record<string, string> }>('/api/chat/presence', { ids }, signal),
    enabled: ids !== '',
    staleTime: 30_000,
  });

  const text = editing ? editing.text : draft.value;
  const setText = (v: string) => (editing ? setEditing({ ...editing, text: v }) : draft.setValue(v));
  const done = (s: Staged) => s.kind === 'disk' && !!s.transfer && transfers.find((t) => t.id === s.transfer)?.state === 'done';
  const tray = staged.filter((s) => !done(s));
  const ready = tray.filter((s) => (s.kind === 'disk' ? !s.transfer : s.state === 'ready'));
  const canSend = editing ? editing.text.trim() !== '' : text.trim() !== '' || ready.length > 0;

  const focus = (at?: number) =>
    requestAnimationFrame(() => {
      const el = input.current;
      if (!el) return;
      el.focus();
      if (at !== undefined) el.setSelectionRange(at, at);
    });

  const stage = (items: Staged[]) => {
    if (!items.length) return;
    setStaged((list) => [...list.filter((s) => !done(s)), ...items]);
    focus();
  };
  const stageDisk = (files: PickedFile[]) => stage(files.map((file) => ({ key: file.handle, kind: 'disk' as const, file, transfer: null })));
  const stageBlob = (blob: Blob, name: string) => stage([{ key: crypto.randomUUID(), kind: 'blob', blob, name, state: 'ready', progress: 0, error: null, extra: null }]);

  useImperativeHandle(ref, () => ({
    stage: stageDisk,
    edit: (m) => {
      setEditing({ id: m.id, original: m.message, text: m.message });
      setMenu(null);
      setRecording(false);
      focus(m.message.length);
    },
  }));

  const typingSignal = (state: 'start' | 'stop') => void apiPost('/api/chat/typing', { room_id: Number(roomId), state }).catch(() => undefined);
  const stopTyping = () => {
    if (idle.current) clearTimeout(idle.current);
    idle.current = null;
    if (typingAt.current) {
      typingAt.current = 0;
      typingSignal('stop');
    }
  };
  const onTyped = () => {
    const now = Date.now();
    if (now - typingAt.current > TYPING_EVERY) {
      typingAt.current = now;
      typingSignal('start');
    }
    if (idle.current) clearTimeout(idle.current);
    idle.current = setTimeout(stopTyping, TYPING_IDLE);
  };
  // Leaving the conversation ends "typing" there.
  useEffect(() => stopTyping, [roomId]); // eslint-disable-line react-hooks/exhaustive-deps

  const choose = (t: Target) => {
    if (!asking) return;
    const caret = input.current?.selectionStart ?? text.length;
    setText(`${text.slice(0, asking.start)}@${t.name} ${text.slice(caret)}`);
    picked.current = [...picked.current.filter((p) => !(p.type === t.type && p.id === t.id)), t];
    setAsking(null);
    focus(asking.start + t.name.length + 2);
  };
  /** Only who is still written in the text is mentioned. */
  const mentionsIn = (words: string) =>
    picked.current.filter((t) => words.includes(`@${t.name}`)).map((t) => (t.type === 'everyone' ? { type: 'everyone' } : { type: t.type, id: t.id, name: t.name }));

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['chat', 'messages', roomId] });
    void qc.invalidateQueries({ queryKey: ['chat', 'rooms'] });
  };

  const sendBlob = async (s: BlobItem, extra: Extra | null) => {
    const update = (patch: Partial<BlobItem>) => setStaged((list) => list.map((x) => (x.key === s.key && x.kind === 'blob' ? { ...x, ...patch } : x)));
    update({ state: 'sending', progress: 0, error: null, extra });
    try {
      const { uploadId } = await uploadBlob(s.blob, s.name, { kind: 'chat', roomId }, (p) => update({ progress: p }));
      await apiPost('/api/chat/messages/attachments', {
        room_id: Number(roomId),
        upload_id: uploadId,
        client_message_id: `desktop-${crypto.randomUUID()}`,
        ...(extra?.caption ? { caption: extra.caption } : {}),
        ...(extra?.replyTo ? { reply_to: extra.replyTo } : {}),
      });
      setStaged((list) => list.filter((x) => x.key !== s.key));
      refresh();
    } catch (e) {
      update({ state: 'failed', error: errorMessage(e) });
    }
  };

  const sendDisk = async (list: DiskItem[], extra: Extra) => {
    if (!list.length) return;
    const out = await call('transfers:upload', { handles: list.map((s) => s.file.handle), target: { kind: 'chat', roomId, ...extra } });
    const byKey = new Map(list.map((s, i) => [s.key, out[i]?.id ?? null]));
    setStaged((all) => all.map((x) => (x.kind === 'disk' && byKey.has(x.key) ? { ...x, transfer: byKey.get(x.key) ?? null } : x)));
  };

  /** Words go through the offline queue (urgent ones only while online, so they are never late). */
  const sendWords = async (words: string, asUrgent: boolean): Promise<boolean> => {
    const mentions = mentionsIn(words);
    const r = await call('offline:submit', {
      module: 'chat',
      entity: 'message',
      entityId: roomId,
      label: `Message: ${words.slice(0, 180)}`,
      method: 'POST',
      path: '/api/chat/messages',
      body: {
        room_id: Number(roomId),
        message: words,
        client_message_id: `desktop-${crypto.randomUUID()}`,
        ...(reply ? { reply_to: reply.id } : {}),
        ...(mentions.length ? { mentions } : {}),
        ...(asUrgent ? { urgent: true } : {}),
      },
      queueIfOffline: !asUrgent,
    });
    if (!r.delivered && !r.queued) {
      toast('error', r.code === 'POLICY_DENIED' ? `${r.error} Your message is kept as a draft.` : (r.error ?? 'Not sent.'));
      return false;
    }
    void qc.invalidateQueries({ queryKey: r.queued ? ['offline'] : ['chat', 'messages', roomId] });
    void qc.invalidateQueries({ queryKey: ['chat', 'rooms'] });
    return true;
  };

  /**
   * With files, the words are the first file's caption and the reply goes
   * with it. Urgent words go as their own message first: a file cannot be
   * urgent.
   */
  const send = async () => {
    if (!canSend || sending) return;
    stopTyping();
    setAsking(null);
    if (editing) return saveEdit();
    const words = text.trim();
    const files = ready;
    const wordsAlone = words !== '' && (urgent || files.length === 0);
    setSending(true);
    try {
      if (wordsAlone && !(await sendWords(words, urgent))) return;
      if (files.length) {
        const first: Extra = wordsAlone ? {} : { ...(words ? { caption: words } : {}), ...(reply ? { replyTo: reply.id } : {}) };
        const lead = files[0]!;
        const disk = files.filter((s): s is DiskItem => s.kind === 'disk');
        if (lead.kind === 'disk') {
          await sendDisk([lead], first);
          await sendDisk(disk.slice(1), {});
        } else {
          void sendBlob(lead, first);
          await sendDisk(disk, {});
        }
        for (const s of files.slice(1)) if (s.kind === 'blob') void sendBlob(s, null);
      }
      draft.setValue('');
      await draft.clear();
      picked.current = [];
      setUrgent(false);
      onClearReply();
    } catch (e) {
      toast('error', errorMessage(e));
    } finally {
      setSending(false);
    }
  };

  const saveEdit = async () => {
    if (!editing) return;
    const words = editing.text.trim();
    if (words === editing.original.trim()) return setEditing(null);
    setSending(true);
    try {
      const mentions = mentionsIn(words);
      await apiPost(`/api/chat/messages/${editing.id}/edit`, { message: words, ...(mentions.length ? { mentions } : {}) });
      setEditing(null);
      picked.current = [];
      refresh();
      focus();
    } catch (e) {
      toast('error', errorMessage(e));
    } finally {
      setSending(false);
    }
  };

  const sendVoice = async (blob: Blob, ms: number) => {
    setRecording(false);
    const ext = blob.type.includes('mp4') ? 'm4a' : blob.type.includes('ogg') ? 'ogg' : 'webm';
    try {
      const { uploadId } = await uploadBlob(blob, `Voice message ${new Date().toISOString().slice(0, 19).replace('T', ' ')}.${ext}`, { kind: 'chat', roomId });
      await apiPost('/api/chat/messages/attachments', {
        room_id: Number(roomId),
        upload_id: uploadId,
        voice: true,
        duration_ms: Math.round(ms),
        client_message_id: `desktop-${crypto.randomUUID()}`,
        ...(reply ? { reply_to: reply.id } : {}),
      });
      onClearReply();
      refresh();
    } catch (e) {
      toast('error', `The voice message was not sent: ${errorMessage(e)}`);
    }
  };

  const attach = async (c: AttachChoice) => {
    setMenu(null);
    if (c === 'drive' || c === 'camera') return setModal(c);
    if (c === 'voice') return setRecording(true);
    try {
      const files = await call('files:pickFiles', { multiple: true, title: `Send to ${roomName}`, ...(c === 'any' ? {} : { only: c }) });
      stageDisk(files);
    } catch (e) {
      toast('error', errorMessage(e));
    }
  };

  const retry = (s: Staged) => {
    if (s.kind === 'blob') return void sendBlob(s, s.extra);
    if (s.transfer) void call('transfers:retry', { id: s.transfer }).catch((e) => toast('error', errorMessage(e)));
  };
  const remove = (s: Staged) => {
    setStaged((list) => list.filter((x) => x.key !== s.key));
    if (s.kind === 'disk' && s.transfer) void call('transfers:cancel', { id: s.transfer }).catch(() => undefined);
  };

  const insert = (e: string) => {
    const el = input.current;
    const at = el?.selectionStart ?? text.length;
    setText(`${text.slice(0, at)}${e}${text.slice(el?.selectionEnd ?? at)}`);
    setMenu(null);
    focus(at + e.length);
  };

  const cancelEdit = () => {
    setEditing(null);
    focus();
  };

  /** Where the "@" is drawn, from the composer's left edge, so the list opens above it. */
  const leftOf = (el: HTMLTextAreaElement, index: number) => {
    const base = root.current?.getBoundingClientRect().left ?? 0;
    const x = el.getBoundingClientRect().left + caretPoint(el, index).left - base;
    return Math.max(8, Math.min(x - 12, (root.current?.clientWidth ?? 400) - (compact ? 258 : 298)));
  };

  const line = typingLine(typing);
  const size = compact ? 'h-[30px] w-[30px]' : 'h-[34px] w-[34px]';
  const tool = cx('flex shrink-0 items-center justify-center rounded-[8px] text-ink-2 hover:bg-subtle hover:text-ink', size);
  const hint = editing
    ? 'Enter to save · Esc to cancel'
    : urgent
      ? 'Urgent: reaches people who only want priority notifications'
      : `Enter to send · Shift + Enter for a new line${group ? ' · @ to mention' : ''}`;

  return (
    <div ref={root} className={cx('relative flex shrink-0 flex-col border-t border-line bg-surface', compact ? 'gap-1.5 px-2.5 pt-2 pb-2.5' : 'gap-2 px-4 pt-2.5 pb-3')}>
      {extras}
      {line ? (
        <div className="absolute bottom-full left-4 mb-1 flex items-center gap-1.5 rounded-full bg-surface/95 px-2 py-0.5 text-[11.5px] text-ink-3" aria-live="polite">
          <span className="flex gap-[3px]" aria-hidden>
            {[0, 1, 2].map((i) => <span key={i} className="h-[5px] w-[5px] animate-bounce rounded-full bg-ink-3" style={{ animationDelay: `${i * 150}ms` }} />)}
          </span>
          {line}
        </div>
      ) : null}
      {editing ? (
        <div className="flex items-center gap-2 rounded-[8px] border-l-[3px] border-[#D97706] bg-[#FFF6E5] px-2.5 py-1.5 text-[12px] dark:bg-warning-bg">
          <Icon name="compose" size={13} className="shrink-0 text-[#9A4A06] dark:text-warning" />
          <span className="flex min-w-0 flex-1 flex-col">
            <b className="text-[#7A3B05] dark:text-warning">Editing message</b>
            <span className="truncate text-ink-2">{editing.original}</span>
          </span>
          <button type="button" onClick={cancelEdit} className="shrink-0 rounded-[6px] px-2 py-0.5 font-semibold text-[#7A3B05] hover:bg-[#FDEBC8] dark:text-warning dark:hover:bg-transparent">Cancel</button>
        </div>
      ) : reply ? (
        <div className="flex items-center gap-2 rounded-[8px] border-l-[3px] border-primary bg-selection px-2.5 py-1.5 text-[12px]">
          <Icon name="reply" size={13} className="shrink-0 text-primary" />
          <span className="flex min-w-0 flex-1 flex-col">
            <b className="text-ink">Replying to {reply.sender_name}</b>
            <span className="truncate text-ink-2">{reply.snippet}</span>
          </span>
          <button type="button" aria-label="Cancel the reply" title="Cancel the reply (Esc)" onClick={onClearReply} className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-ink-3 hover:bg-surface hover:text-ink">
            <Icon name="x" size={13} />
          </button>
        </div>
      ) : null}
      {asking && options.length ? (
        <div
          role="listbox"
          aria-label="Mention someone"
          className={cx('absolute bottom-full z-40 mb-1 flex max-h-[320px] flex-col rounded-[12px] border border-line bg-surface shadow-[0_12px_32px_rgba(15,27,61,.18)]', compact ? 'w-[250px]' : 'w-[290px]')}
          style={{ left: asking.left }}
        >
          <div className="min-h-0 flex-1 overflow-y-auto p-1 scroll-thin">
            {options.map((t, i) => {
              const heading =
                t.type === 'user' && options.findIndex((o) => o.type === 'user') === i ? 'PEOPLE IN THIS CHAT'
                  : t.type !== 'user' && t.type !== 'everyone' && options.findIndex((o) => o.type !== 'user' && o.type !== 'everyone') === i ? 'TEAMS AND DEPARTMENTS'
                    : null;
              const state = t.type === 'user' ? (presence.data?.presence[String(t.id)] ?? 'offline') : '';
              const sub = t.type === 'user'
                ? [t.detail, (PRESENCE[state]?.label ?? state).toLowerCase()].filter(Boolean).join(' · ')
                : (t.detail ?? (t.type === 'department' ? 'Department' : 'Team'));
              return (
                <div key={`${t.type}:${t.id}`}>
                  {heading ? <div className="px-2 pt-1.5 pb-1 text-[10.5px] font-bold tracking-[0.6px] text-ink-3">{heading}</div> : null}
                  <button
                    type="button"
                    role="option"
                    aria-selected={i === pick}
                    onMouseDown={(e) => e.preventDefault()}
                    onMouseEnter={() => setPick(i)}
                    onClick={() => choose(t)}
                    className={cx('flex w-full items-center gap-2.5 rounded-[8px] px-2 py-1.5 text-left', i === pick ? 'bg-selection' : 'hover:bg-subtle')}
                  >
                    {t.type === 'user' ? (
                      <span className="relative shrink-0">
                        <Avatar name={t.name} size={28} />
                        <span className={cx('absolute -right-0.5 -bottom-0.5 h-2.5 w-2.5 rounded-full border-2 border-surface', PRESENCE[state]?.dot ?? 'bg-line')} />
                      </span>
                    ) : (
                      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[8px] bg-subtle text-ink-2">
                        <Icon name={t.type === 'everyone' ? 'megaphone' : t.type === 'department' ? 'building' : 'users'} size={14} />
                      </span>
                    )}
                    <span className="flex min-w-0 flex-col">
                      <b className="truncate text-[12.5px] text-ink">{t.type === 'everyone' ? '@everyone' : t.name}</b>
                      {sub ? <span className="truncate text-[11.5px] text-ink-3">{sub}</span> : null}
                    </span>
                  </button>
                </div>
              );
            })}
          </div>
          <div className="border-t border-line px-2.5 py-1.5 text-[11px] text-ink-3">↑↓ to move · Enter to pick · Esc to close</div>
        </div>
      ) : null}
      {menu === 'emoji' ? <EmojiPicker className="absolute right-3 bottom-full mb-2" onPick={insert} onClose={() => setMenu(null)} /> : null}
      <div
        className={cx(
          'relative flex flex-col gap-1.5 rounded-[12px] border transition-colors',
          compact ? 'px-1.5 py-1' : 'px-2 py-1.5',
          urgent && !editing
            ? 'border-danger bg-danger-bg/40 focus-within:ring-2 focus-within:ring-danger/20'
            : editing
              ? 'border-[#D97706] focus-within:ring-2 focus-within:ring-[#D97706]/20'
              : 'border-line focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/15',
        )}
      >
        {tray.length && !editing && !recording ? (
          <div className="px-1 pt-1">
            <Tray items={tray} transfers={transfers} onRemove={remove} onRetry={retry} compact={compact} />
          </div>
        ) : null}
        <div className="flex items-end gap-1">
          {recording ? (
            <VoiceRecorder compact={compact} onDone={(b, ms) => void sendVoice(b, ms)} onCancel={() => setRecording(false)} />
          ) : (
            <>
              {!editing ? (
                <span className="relative">
                  <button type="button" aria-label="Attach" title="Attach" aria-haspopup="menu" aria-expanded={menu === 'attach'} onClick={() => setMenu(menu === 'attach' ? null : 'attach')} className={cx(tool, menu === 'attach' && '!bg-selection !text-primary')}>
                    <Icon name="paperclip" size={compact ? 16 : 18} />
                  </button>
                  {menu === 'attach' ? <AttachMenu compact={compact} onPick={(c) => void attach(c)} onClose={() => setMenu(null)} /> : null}
                </span>
              ) : null}
              <textarea
                ref={input}
                value={text}
                onChange={(e) => {
                  setText(e.target.value);
                  if (!editing) onTyped();
                  if (group) {
                    const q = mentionQuery(e.target.value, e.target.selectionStart ?? e.target.value.length);
                    setAsking(q ? { ...q, left: leftOf(e.target, q.start) } : null);
                    setPick(0);
                  }
                }}
                onBlur={() => {
                  stopTyping();
                  setAsking(null);
                }}
                onKeyDown={(e) => {
                  if (asking && options.length) {
                    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                      e.preventDefault();
                      setPick((pick + (e.key === 'ArrowDown' ? 1 : options.length - 1)) % options.length);
                      return;
                    }
                    if (e.key === 'Enter' || e.key === 'Tab') {
                      e.preventDefault();
                      choose(options[pick]!);
                      return;
                    }
                    if (e.key === 'Escape') {
                      e.preventDefault();
                      setAsking(null);
                      return;
                    }
                  }
                  if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                    e.preventDefault();
                    void send();
                    return;
                  }
                  if (e.key === 'Escape') {
                    if (editing) cancelEdit();
                    else if (reply) onClearReply();
                  }
                }}
                onPaste={(e) => {
                  // FR-XFR-05: a pasted screenshot or file joins the tray, on the user's paste only.
                  const files = Array.from(e.clipboardData.files);
                  if (files.length === 0 || editing) return;
                  e.preventDefault();
                  for (const img of files.filter((f) => f.type.startsWith('image/'))) {
                    stageBlob(img, img.name && img.name !== 'image.png' ? img.name : `Screenshot ${new Date().toISOString().slice(0, 19).replace('T', ' ').replace(/:/g, '.')}.png`);
                  }
                  const onDisk = files.filter((f) => f.size > 0 && f.name && !f.type.startsWith('image/'));
                  if (onDisk.length) void registerDropped(onDisk).then(stageDisk, (err: unknown) => toast('error', errorMessage(err)));
                }}
                rows={1}
                placeholder={editing ? 'Edit your message' : tray.length ? 'Add a caption…' : 'Type a message…'}
                aria-label="Message"
                className={cx('bare-focus field-sizing-content max-h-40 min-w-0 flex-1 resize-none bg-transparent px-1 outline-none', compact ? 'min-h-[30px] py-[5px] text-[13px]' : 'min-h-[34px] py-[7px] text-[13.5px]')}
              />
              {canUrgent && !editing ? (
                <button
                  type="button"
                  aria-label="Urgent"
                  title={urgent ? 'Urgent is on: reaches people who only want priority notifications' : 'Mark as urgent'}
                  aria-pressed={urgent}
                  onClick={() => setUrgent(!urgent)}
                  className={cx(tool, urgent && '!bg-danger !text-white')}
                >
                  <Icon name="warning" size={compact ? 15 : 17} />
                </button>
              ) : null}
              <button type="button" aria-label="Emoji" title="Emoji" aria-pressed={menu === 'emoji'} onClick={() => setMenu(menu === 'emoji' ? null : 'emoji')} className={cx(tool, menu === 'emoji' && '!bg-selection !text-primary')}>
                <Icon name="smile" size={compact ? 16 : 18} />
              </button>
              <button
                type="button"
                aria-label={editing ? 'Save the change' : 'Send'}
                title={editing ? 'Save the change' : 'Send (Enter)'}
                disabled={!canSend || sending}
                onClick={() => void send()}
                className={cx(
                  'flex shrink-0 items-center justify-center rounded-[9px] text-white disabled:bg-subtle disabled:text-ink-3',
                  size,
                  editing ? 'bg-[#D97706] hover:bg-[#B45309]' : urgent ? 'bg-danger hover:opacity-90' : 'bg-primary hover:bg-primary-hover',
                )}
              >
                <Icon name={editing ? 'check' : 'send'} size={compact ? 14 : 16} />
              </button>
            </>
          )}
        </div>
      </div>
      {!compact && !recording ? <div className={cx('px-1 text-[11px]', urgent && !editing ? 'font-semibold text-danger' : 'text-ink-3')}>{hint}</div> : null}
      {modal === 'drive' ? <DrivePicker roomId={roomId} onClose={() => setModal(null)} onSent={refresh} /> : null}
      {modal === 'camera' ? <CameraCapture onTaken={stageBlob} onClose={() => setModal(null)} /> : null}
    </div>
  );
}
