import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { apiGet, apiPost } from '../../core/api';
import { call, errorMessage } from '../../core/bridge';
import { useDraft } from '../../core/drafts';
import { toast } from '../../core/toasts';
import { uploadBlob } from '../../core/upload';
import { Icon } from '../../components/Icon';
import { IconButton, cx } from '../../components/ui';
import { mentionQuery } from './mentions';
import { EmojiPicker, VoiceRecorder } from './parts';
import type { ReplyTarget } from './Thread';

/** At most one "typing" signal per few seconds; "stopped" after a pause or on send. */
const TYPING_EVERY = 4_000;
const TYPING_IDLE = 5_000;

type Target = { type: string; id: number; name: string; detail?: string | null };
type Mentionable = Record<'people' | 'teams' | 'departments' | 'everyone', Target[]>;

const tool = 'h-[30px] shrink-0 px-1.5 text-[12.5px] text-ink-2 hover:text-ink';

export function Composer({ roomId, roomName, group, onFiles, reply, onClearReply }: { roomId: string; roomName: string; group: boolean; onFiles: (files: File[]) => void; reply: ReplyTarget | null; onClearReply: () => void }) {
  const qc = useQueryClient();
  const draft = useDraft<string>('chat', `room:${roomId}`, '');
  const [sending, setSending] = useState(false);
  const [emoji, setEmoji] = useState(false);
  const [recording, setRecording] = useState(false);
  const [asking, setAsking] = useState<{ start: number; word: string } | null>(null);
  const [pick, setPick] = useState(0);
  const picked = useRef<Target[]>([]);
  const input = useRef<HTMLTextAreaElement>(null);
  const typingAt = useRef(0);
  const idle = useRef<ReturnType<typeof setTimeout> | null>(null);
  const suggestions = useQuery({
    queryKey: ['chat', 'mentionable', roomId, asking?.word ?? ''],
    queryFn: ({ signal }) => apiGet<Mentionable>(`/api/chat/rooms/${roomId}/mentionable`, { q: asking?.word ?? '' }, signal),
    enabled: group && asking !== null,
    staleTime: 30_000,
  });
  const options = asking && suggestions.data ? [...suggestions.data.everyone, ...suggestions.data.people, ...suggestions.data.teams, ...suggestions.data.departments].slice(0, 8) : [];

  const typing = (state: 'start' | 'stop') => void apiPost('/api/chat/typing', { room_id: Number(roomId), state }).catch(() => undefined);
  const stopTyping = () => {
    if (idle.current) clearTimeout(idle.current);
    idle.current = null;
    if (typingAt.current) {
      typingAt.current = 0;
      typing('stop');
    }
  };
  const onTyped = () => {
    const now = Date.now();
    if (now - typingAt.current > TYPING_EVERY) {
      typingAt.current = now;
      typing('start');
    }
    if (idle.current) clearTimeout(idle.current);
    idle.current = setTimeout(stopTyping, TYPING_IDLE);
  };
  // Leaving the conversation ends "typing" there.
  useEffect(() => stopTyping, [roomId]); // eslint-disable-line react-hooks/exhaustive-deps

  const choose = (t: Target) => {
    if (!asking) return;
    const el = input.current;
    const caret = el?.selectionStart ?? draft.value.length;
    const text = `${draft.value.slice(0, asking.start)}@${t.name} ${draft.value.slice(caret)}`;
    draft.setValue(text);
    picked.current = [...picked.current.filter((p) => !(p.type === t.type && p.id === t.id)), t];
    setAsking(null);
    const at = asking.start + t.name.length + 2;
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(at, at);
    });
  };

  const send = async () => {
    const text = draft.value.trim();
    if (!text) return;
    setSending(true);
    stopTyping();
    const clientId = `desktop-${crypto.randomUUID()}`;
    // Only who is still written in the text is mentioned.
    const mentions = picked.current.filter((t) => text.includes(`@${t.name}`)).map((t) => (t.type === 'everyone' ? { type: 'everyone' } : { type: t.type, id: t.id, name: t.name }));
    try {
      const r = await call('offline:submit', {
        module: 'chat',
        entity: 'message',
        entityId: roomId,
        label: `Message: ${text.slice(0, 180)}`,
        method: 'POST',
        path: '/api/chat/messages',
        body: { room_id: Number(roomId), message: text, client_message_id: clientId, ...(reply ? { reply_to: reply.id } : {}), ...(mentions.length ? { mentions } : {}) },
        queueIfOffline: true,
      });
      if (!r.delivered && !r.queued) {
        toast('error', r.code === 'POLICY_DENIED' ? `${r.error} Your message is kept as a draft.` : (r.error ?? 'Not sent.'));
        return;
      }
      draft.setValue('');
      await draft.clear();
      picked.current = [];
      onClearReply();
      void qc.invalidateQueries({ queryKey: r.queued ? ['offline'] : ['chat', 'messages', roomId] });
      void qc.invalidateQueries({ queryKey: ['chat', 'rooms'] });
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
      const { uploadId } = await uploadBlob(blob, `Voice note ${new Date().toISOString().slice(0, 19).replace('T', ' ')}.${ext}`, { kind: 'chat', roomId });
      await apiPost('/api/chat/messages/attachments', {
        room_id: Number(roomId),
        upload_id: uploadId,
        voice: true,
        duration_ms: Math.round(ms),
        client_message_id: `desktop-${crypto.randomUUID()}`,
        ...(reply ? { reply_to: reply.id } : {}),
      });
      onClearReply();
      void qc.invalidateQueries({ queryKey: ['chat', 'messages', roomId] });
    } catch (e) {
      toast('error', `The voice note was not sent: ${errorMessage(e)}`);
    }
  };

  const attach = async (only?: 'gif') => {
    try {
      const files = await call('files:pickFiles', { multiple: true, title: only ? `Send a GIF to ${roomName}` : `Send files to ${roomName}`, ...(only ? { only } : {}) });
      if (files.length) await call('transfers:upload', { handles: files.map((p) => p.handle), target: { kind: 'chat', roomId } });
    } catch (e) {
      toast('error', errorMessage(e));
    }
  };

  const insert = (text: string) => {
    const el = input.current;
    const at = el?.selectionStart ?? draft.value.length;
    draft.setValue(`${draft.value.slice(0, at)}${text}${draft.value.slice(el?.selectionEnd ?? at)}`);
    setEmoji(false);
    requestAnimationFrame(() => el?.focus());
  };

  return (
    <div className="relative flex flex-col gap-2 border-t border-line bg-surface px-4 pt-2.5 pb-3.5">
      {reply ? (
        <div className="flex items-center gap-2 rounded-[6px] border-l-[3px] border-[#7FA2FF] bg-selection px-2.5 py-1.5 text-[12px] text-ink-2">
          <Icon name="reply" size={13} />
          <span className="min-w-0 flex-1 truncate">
            Replying to <span className="font-semibold">{reply.sender_name}</span>: “{reply.snippet}”
          </span>
          <IconButton icon="x" label="Cancel the reply" size={14} onClick={onClearReply} />
        </div>
      ) : null}
      {options.length ? (
        <div role="listbox" aria-label="Mention someone" className="absolute bottom-full left-14 mb-1 w-[260px] rounded-[10px] border border-line bg-surface p-1 text-[12.5px] shadow-[0_10px_28px_rgba(15,27,61,.18)]">
          {options.map((t, i) => (
            <button
              key={`${t.type}:${t.id}`}
              type="button"
              role="option"
              aria-selected={i === pick}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => choose(t)}
              className={cx('block w-full truncate rounded-[6px] px-2.5 py-1.5 text-left', i === pick ? 'bg-selection font-bold text-ink' : 'text-ink hover:bg-subtle')}
            >
              @{t.name}
              {t.detail ? <span className="font-normal text-ink-3"> · {t.detail}</span> : t.type !== 'user' && t.type !== 'everyone' ? <span className="font-normal text-ink-3"> · {t.type}</span> : null}
            </button>
          ))}
        </div>
      ) : null}
      {emoji ? <EmojiPicker className="absolute right-24 bottom-full mb-2" onPick={insert} onClose={() => setEmoji(false)} /> : null}
      <div className="flex items-end gap-1.5 rounded-[10px] border border-line px-2.5 py-[7px] focus-within:border-primary">
        {recording ? (
          <VoiceRecorder onDone={(b, ms) => void sendVoice(b, ms)} onCancel={() => setRecording(false)} />
        ) : (
          <>
            <button type="button" aria-label="Attach" onClick={() => void attach()} className={tool}>Attach</button>
            <textarea
              ref={input}
              value={draft.value}
              onChange={(e) => {
                draft.setValue(e.target.value);
                onTyped();
                if (group) {
                  const q = mentionQuery(e.target.value, e.target.selectionStart ?? e.target.value.length);
                  setAsking(q);
                  setPick(0);
                }
              }}
              onBlur={() => {
                stopTyping();
                setAsking(null);
              }}
              onKeyDown={(e) => {
                if (options.length) {
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
                    setAsking(null);
                    return;
                  }
                }
                if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  void send();
                }
                if (e.key === 'Escape' && reply) onClearReply();
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
              placeholder={`Message ${roomName}`}
              aria-label="Message"
              className="bare-focus max-h-40 min-h-[30px] flex-1 resize-none bg-transparent py-[5px] text-[13.5px] outline-none"
            />
            <button type="button" aria-label="Emoji" aria-pressed={emoji} onClick={() => setEmoji(!emoji)} className={tool}>Emoji</button>
            <button type="button" aria-label="GIF" title="Send a GIF from your computer" onClick={() => void attach('gif')} className="mb-0.5 h-[26px] shrink-0 rounded-[5px] border border-line px-1.5 text-[10.5px] font-bold text-ink-2 hover:text-ink">GIF</button>
            <button type="button" aria-label="Record a voice message" onClick={() => setRecording(true)} className={tool}>Voice</button>
            <button type="button" disabled={sending || !draft.value.trim()} onClick={() => void send()} className="h-8 shrink-0 rounded-[8px] bg-primary px-3.5 text-[13px] font-bold text-white hover:bg-primary-hover disabled:opacity-50">
              Send
            </button>
          </>
        )}
      </div>
    </div>
  );
}
