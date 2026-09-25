import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { apiPost } from '../../core/api';
import { call, errorMessage } from '../../core/bridge';
import { useDraft } from '../../core/drafts';
import { toast } from '../../core/toasts';
import { uploadBlob } from '../../core/upload';
import { Icon } from '../../components/Icon';
import { IconButton } from '../../components/ui';
import { EmojiPicker, VoiceRecorder } from './parts';
import type { ReplyTarget } from './Thread';

/** At most one "typing" signal per few seconds; "stopped" after a pause or on send. */
const TYPING_EVERY = 4_000;
const TYPING_IDLE = 5_000;

export function Composer({ roomId, roomName, onFiles, reply, onClearReply }: { roomId: string; roomName: string; onFiles: (files: File[]) => void; reply: ReplyTarget | null; onClearReply: () => void }) {
  const qc = useQueryClient();
  const draft = useDraft<string>('chat', `room:${roomId}`, '');
  const [sending, setSending] = useState(false);
  const [emoji, setEmoji] = useState(false);
  const [recording, setRecording] = useState(false);
  const input = useRef<HTMLTextAreaElement>(null);
  const typingAt = useRef(0);
  const idle = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  const send = async () => {
    const text = draft.value.trim();
    if (!text) return;
    setSending(true);
    stopTyping();
    const clientId = `desktop-${crypto.randomUUID()}`;
    try {
      const r = await call('offline:submit', {
        module: 'chat',
        entity: 'message',
        entityId: roomId,
        label: `Message: ${text.slice(0, 180)}`,
        method: 'POST',
        path: '/api/chat/messages',
        body: { room_id: Number(roomId), message: text, client_message_id: clientId, ...(reply ? { reply_to: reply.id } : {}) },
        queueIfOffline: true,
      });
      if (!r.delivered && !r.queued) {
        toast('error', r.code === 'POLICY_DENIED' ? `${r.error} Your message is kept as a draft.` : (r.error ?? 'Not sent.'));
        return;
      }
      draft.setValue('');
      await draft.clear();
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

  const attach = async () => {
    try {
      const picked = await call('files:pickFiles', { multiple: true, title: `Send files to ${roomName}` });
      if (picked.length) await call('transfers:upload', { handles: picked.map((p) => p.handle), target: { kind: 'chat', roomId } });
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
    <div className="relative border-t border-line bg-surface px-5 py-3">
      {reply ? (
        <div className="mb-2 flex items-center gap-2 rounded-[8px] border-l-2 border-primary bg-subtle px-3 py-1.5 text-[12.5px] text-ink-2">
          <Icon name="reply" size={13} />
          <span className="min-w-0 flex-1 truncate">
            Replying to <span className="font-semibold">{reply.sender_name}</span>: {reply.snippet}
          </span>
          <IconButton icon="x" label="Cancel the reply" size={14} onClick={onClearReply} />
        </div>
      ) : null}
      {emoji ? <EmojiPicker className="absolute bottom-full left-5 mb-2" onPick={insert} onClose={() => setEmoji(false)} /> : null}
      <div className="flex items-end gap-2 rounded-[12px] border border-line bg-surface px-3 py-2 focus-within:border-primary">
        {recording ? (
          <VoiceRecorder onDone={(b, ms) => void sendVoice(b, ms)} onCancel={() => setRecording(false)} />
        ) : (
          <>
            <IconButton icon="paperclip" label="Attach files" onClick={() => void attach()} />
            <IconButton icon="smile" label="Emoji" active={emoji} onClick={() => setEmoji(!emoji)} />
            <textarea
              ref={input}
              value={draft.value}
              onChange={(e) => {
                draft.setValue(e.target.value);
                onTyped();
              }}
              onBlur={stopTyping}
              onKeyDown={(e) => {
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
              placeholder={`Message ${roomName} (drop files or GIFs to send)`}
              aria-label="Message"
              className="max-h-40 min-h-[36px] flex-1 resize-none bg-transparent py-2 text-[13.5px] outline-none"
            />
            {draft.value.trim() ? (
              <IconButton icon="send" label="Send" onClick={() => void send()} disabled={sending} className="!text-primary" />
            ) : (
              <IconButton icon="mic" label="Record a voice note" onClick={() => setRecording(true)} />
            )}
          </>
        )}
      </div>
    </div>
  );
}
