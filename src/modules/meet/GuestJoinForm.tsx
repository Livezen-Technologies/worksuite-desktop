import { useState } from 'react';
import { Button, TextField } from '../../components/ui';
import { call, errorMessage } from '../../core/bridge';
export function GuestJoinForm({ server, initialInput, onBack, onOpened }: { server?: string; initialInput?: string; onBack: () => void; onOpened?: () => void }) {
  const [input, setInput] = useState(initialInput ?? '');
  const [origin, setOrigin] = useState(server ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const submit = async () => {
    setBusy(true); setError('');
    try { await call('guest:open', { input, server: origin || undefined }); onOpened?.(); }
    catch (e) { setError(errorMessage(e)); }
    finally { setBusy(false); }
  };
  return <form className="flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
    <h1 className="text-[22px] font-bold text-ink">Join a Meeting</h1>
    <p className="text-ink-2">Join as a guest. No account, profile picture, or AI downloads required.</p>
    <TextField label="Meeting link or code" value={input} onChange={(e) => setInput(e.target.value)} autoFocus error={error} />
    <TextField label="WorkSuite server (for codes)" placeholder="https://app.yourcompany.com" value={origin} onChange={(e) => setOrigin(e.target.value)} />
    <Button type="submit" variant="primary" loading={busy} disabled={!input.trim()}>Continue</Button>
    <Button type="button" variant="ghost" onClick={onBack}>Back</Button>
  </form>;
}
