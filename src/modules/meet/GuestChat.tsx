import { useEffect, useRef, useState } from 'react';
import { RoomEvent, type Participant, type Room } from 'livekit-client';
import { Button } from '../../components/ui';
import { may, type MeetRole, type RoomSettings } from './api';

const TOPIC = 'meet.guest-chat';
export function guestRole(p: Participant): MeetRole {
  try { const role = JSON.parse(p.metadata ?? '{}').role; return role === 'host' || role === 'cohost' || role === 'presenter' ? role : 'participant'; } catch { return 'participant'; }
}
export function guestWaiting(p: Participant): boolean {
  try { return JSON.parse(p.metadata ?? '{}').waiting === true; } catch { return true; }
}
/** Ephemeral room messages. Sender names/roles come from the SFU, never from a payload. */
export function GuestChat({ room, chat }: { room: Room; chat: RoomSettings['chat'] | null }) {
  const [messages, setMessages] = useState<Array<{ name: string; text: string }>>([]);
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const policy = useRef(chat);
  useEffect(() => { policy.current = chat; }, [chat]);
  const permitted = (p: Participant) => !guestWaiting(p) && p.permissions?.canPublishData === true && policy.current !== null && may.chat(guestRole(p), { chat: policy.current } as RoomSettings);
  useEffect(() => {
    const receive = (data: Uint8Array, sender?: Participant, _kind?: unknown, topic?: string) => {
      if (topic !== TOPIC || !sender || data.byteLength > 4000 || !permitted(sender)) return;
      try {
        const value = JSON.parse(new TextDecoder().decode(data)) as { text?: unknown };
        if (typeof value.text !== 'string' || !value.text.trim() || value.text.length > 1000) return;
        setMessages((rows) => [...rows.slice(-99), { name: `${sender.name || 'Participant'}${sender.identity.startsWith('g-') ? ' · Guest' : ''}`, text: value.text as string }]);
      } catch { /* Ignore unrelated or malformed data. */ }
    };
    room.on(RoomEvent.DataReceived, receive);
    return () => { room.off(RoomEvent.DataReceived, receive); };
  }, [room]);
  const send = async () => {
    if (!permitted(room.localParticipant) || !text.trim()) return;
    try {
      await room.localParticipant.publishData(new TextEncoder().encode(JSON.stringify({ text: text.trim() })), { reliable: true, topic: TOPIC });
      setMessages((rows) => [...rows.slice(-99), { name: `${room.localParticipant.name || 'You'} · You`, text: text.trim() }]);
      setText(''); setError('');
    } catch { setError('Message could not be sent. Try again.'); }
  };
  const local = room.localParticipant;
  const allowed = !guestWaiting(local) && local.permissions?.canPublishData === true && chat !== null && may.chat(guestRole(local), { chat } as RoomSettings);
  return <section className="flex flex-col gap-2 p-3 text-ink">
    <h2 className="font-semibold">Guest meeting chat</h2>
    <p className="text-[12px] text-ink-3">Visible to this room; messages are not saved to workspace chat.</p>
    {chat === 'off' || chat === null ? <p>Chat is unavailable.</p> : <div className="max-h-56 overflow-y-auto" aria-live="polite">{messages.map((m, i) => <p key={i}><b>{m.name}: </b>{m.text}</p>)}</div>}
    {!allowed ? <p className="text-ink-3">The host controls who can chat.</p> : <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); void send(); }}>
      <input aria-label="Message to meeting" className="min-w-0 flex-1 rounded border border-line bg-surface p-2" maxLength={1000} value={text} onChange={(e) => setText(e.target.value)} />
      <Button type="submit" disabled={!text.trim()}>Send</Button>
    </form>}
    {error ? <p role="alert">{error}</p> : null}
  </section>;
}
