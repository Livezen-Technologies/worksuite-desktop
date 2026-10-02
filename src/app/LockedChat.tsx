import { useEffect, useState } from 'react';
import { apiGet, apiPost } from '../core/api';
import { Button } from '../components/ui';
import { call, errorMessage } from '../core/bridge';
/** Plain text only, no links, files, records, previews or module navigation. */
export function LockedChat({ room }: { room: string }) {
  const [shown, setShown] = useState(false);
  const [messages, setMessages] = useState<Array<{ id: number; type: string; message: string | null; deleted?: boolean }>>([]);
  const [busy, setBusy] = useState(false);
  const [text, setText] = useState(''); const [error, setError] = useState('');
  useEffect(() => {
    if (!shown) return;
    let live = true;
    const read = () => void apiGet<{ messages: typeof messages }>('/api/chat/messages', { room_id: room }).then(r => { if (live) setMessages(r.messages.filter(m => m.type === 'text' && !m.deleted)); }, e => { if (live) setError(errorMessage(e)); });
    read(); const timer = setInterval(read, 3000);
    return () => { live = false; clearInterval(timer); };
  }, [room, shown]);
  const send = async () => {
    if (busy || !text.trim()) return;
    setBusy(true);
    try { await apiPost('/api/chat/messages', { room_id: Number(room), type: 'text', message: text.trim() }); setText(''); setError(''); } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  };
  return <main className="flex h-full flex-col gap-3 bg-surface p-4 text-ink"><div className="drag flex items-center justify-between"><b>Chat while WorkSuite is locked</b><Button onClick={() => void call('windows:close')}>Close</Button></div><p className="text-sm">The workspace stays locked. Unlock to open files, links, records or other modules.</p>
    {!shown ? <Button onClick={() => setShown(true)}>Show this conversation</Button> : <div className="min-h-0 flex-1 overflow-auto">{messages.map(m => <p key={m.id} className="whitespace-pre-wrap break-words border-b border-line p-2">{m.message}</p>)}</div>}
    {error ? <p role="alert">{error}</p> : null}
    <textarea aria-label="Message" value={text} maxLength={8000} onChange={e => setText(e.target.value)} className="rounded border border-line p-2" /><Button disabled={busy || !text.trim()} onClick={() => void send()}>Send text</Button>
  </main>;
}
