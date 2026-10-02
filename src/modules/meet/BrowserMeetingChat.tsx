import { useEffect, useState } from 'react';
import { apiGet, apiPost } from '../../core/api';

interface ChatState { enabled: boolean; can_send: boolean; messages: { id: number; name: string; guest: boolean; text: string }[] }
export default function BrowserMeetingChat({ uuid }: { uuid: string }) {
  const [state, setState] = useState<ChatState | null>(null);
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function request(body?: { text: string }): Promise<ChatState> {
    const path = `/meet/${encodeURIComponent(uuid)}/browser-chat`;
    return body ? await apiPost<ChatState>(path, body) : await apiGet<ChatState>(path);
  }

  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    const load = async () => {
      try { const next = await request(); if (active) { setState(next); setError(''); } }
      catch { if (active) setError('Meeting chat is unavailable. Check your connection or ask the host.'); }
      finally { if (active) timer = setTimeout(load, 5000); }
    };
    void load();
    return () => { active = false; clearTimeout(timer); };
  // request is scoped to this UUID; state changes must not restart polling.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uuid]);
  async function send() {
    if (!text.trim() || busy) return;
    setBusy(true);
    try { setState(await request({ text: text.trim() })); setText(''); setError(''); }
    catch { setError('Message could not be sent. Check the connection and the host’s chat settings.'); }
    finally { setBusy(false); }
  }
  return <section className="flex min-h-0 flex-1 flex-col p-3" aria-label="Meeting chat">
    <h2 className="mb-2 font-semibold">Browser meeting chat</h2><p className="mb-2 text-xs text-ink-3">Chat for this meeting. Workspace conversations stay private.</p>
    {error && <p role="alert" className="text-sm text-warning">{error}</p>}
    {state?.enabled === false && <p>The host turned meeting chat off.</p>}
    <ol className="min-h-0 flex-1 space-y-3 overflow-y-auto" aria-label="Messages">{state?.messages.map((m) => <li key={m.id}><span className="text-xs text-ink-3">{m.name}{m.guest ? ' · Guest' : ''}</span><p className="whitespace-pre-wrap break-words text-sm">{m.text}</p></li>)}</ol>
    {state?.can_send ? <form className="mt-3 flex gap-2" onSubmit={(e) => { e.preventDefault(); void send(); }}><input aria-label="Message" value={text} maxLength={2000} onChange={(e) => setText(e.target.value)} className="min-w-0 flex-1 rounded-lg bg-surface p-2" /><button className="rounded bg-brand px-3 py-2 text-white disabled:opacity-50" disabled={busy || !text.trim()}>Send</button></form> : state?.enabled && <p className="mt-3 text-sm text-ink-3">Only hosts can send messages.</p>}
  </section>;
}
