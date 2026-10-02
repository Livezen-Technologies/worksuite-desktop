import { useState, type ReactNode } from 'react';
import { Button, TextField } from '../../components/ui';
import { call, errorMessage } from '../../core/bridge';
/**
 * Join a meeting by link or code as a guest: from sign-in, a guest meeting's window, or Meet in guest mode (#149),
 * which joins with the Local Profile's name (`join`) and keeps the destination on this device (`onChange`).
 */
export function GuestJoinForm({ server, initialInput, onBack, onOpened, join, onChange, intro, offline }: {
  server?: string; initialInput?: string; onBack?: () => void; onOpened?: () => void;
  join?: (input: string, server: string | undefined) => Promise<unknown>; onChange?: (input: string, server: string) => void; intro?: ReactNode; offline?: boolean;
}) {
  const [input, setInput] = useState(initialInput ?? '');
  const [origin, setOrigin] = useState(server ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const submit = async () => {
    setBusy(true); setError('');
    try { await (join ? join(input, origin || undefined) : call('guest:open', { input, server: origin || undefined })); onOpened?.(); }
    catch (e) { setError(errorMessage(e)); }
    finally { setBusy(false); }
  };
  return <form className="flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
    <h1 className="text-[22px] font-bold text-ink">Join a Meeting</h1>
    {intro ?? <p className="text-ink-2">Join as a guest. No account, profile picture, or AI downloads required.</p>}
    <TextField label="Meeting link or code" value={input} onChange={(e) => { setInput(e.target.value); onChange?.(e.target.value, origin); }} autoFocus error={error} />
    <TextField label="WorkSuite server (for codes)" placeholder="https://app.yourcompany.com" value={origin} onChange={(e) => { setOrigin(e.target.value); onChange?.(input, e.target.value); }} />
    <Button type="submit" variant="primary" loading={busy} disabled={!input.trim() || offline}>Continue</Button>
    {onBack ? <Button type="button" variant="ghost" onClick={onBack}>Back</Button> : null}
  </form>;
}
