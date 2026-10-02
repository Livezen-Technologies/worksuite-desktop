import { Checkbox } from '../../components/Checkbox';
import { useEffect, useState } from 'react';
import type { LocalItem, LocalItemInput, LocalView } from '@shared/local-workspace';
import { Button, TextField, Spinner } from '../../components/ui';
import { call, errorMessage } from '../../core/bridge';
const empty = (kind: LocalItem['kind']): LocalItemInput => ({ kind, title: '', body: '', completed: false, due: null, start: null, end: null, reminder: null });
export function localInput(value: string | null): string {
  if (!value) return '';
  const date = new Date(value);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}
function instant(value: string): string | null { return value ? new Date(value).toISOString() : null; }
export default function LocalWorkspacePage() {
  const [view, setView] = useState<LocalView | null>(null);
  const [tab, setTab] = useState<'note' | 'task' | 'event' | 'meet' | 'data'>('note');
  const [draft, setDraft] = useState<LocalItemInput>(empty('note'));
  const [online, setOnline] = useState(navigator.onLine);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [month, setMonth] = useState(() => localInput(new Date().toISOString()).slice(0, 7));
  const [meetingInput, setMeetingInput] = useState('');
  const [meetingServer, setMeetingServer] = useState('');
  const [confirm, setConfirm] = useState('');
  const reload = async () => {
    const next = await call('local:read'); setView(next); return next;
  };
  useEffect(() => {
    let active = true;
    void call('local:read').then((next) => { if (active) { setView(next); setMeetingInput(next.meetingInput); setMeetingServer(next.meetingServer); } }, (e) => { if (active) setMessage(errorMessage(e)); });
    const connected = () => setOnline(navigator.onLine);
    window.addEventListener('online', connected); window.addEventListener('offline', connected);
    return () => { active = false; window.removeEventListener('online', connected); window.removeEventListener('offline', connected); };
  }, []);
  const act = async (action: () => Promise<unknown>, success?: string) => {
    setBusy(true); setMessage('');
    try { await action(); if (success) setMessage(success); }
    catch (e) { setMessage(errorMessage(e)); }
    finally { setBusy(false); }
  };
  const choose = (kind: typeof tab) => { setTab(kind); if (kind !== 'meet' && kind !== 'data') setDraft(empty(kind)); setMessage(''); };
  const save = () => act(async () => { await call('local:save', draft); await reload(); setDraft(empty(draft.kind)); }, 'Saved on this device.');
  const remove = (item: LocalItem) => act(async () => { await call('local:remove', { id: item.id }); await reload(); if (draft.id === item.id) setDraft(empty(item.kind)); }, 'Deleted from this device.');
  const retainMeeting = () => call('local:meeting', { input: meetingInput, server: meetingServer });
  const meeting = () => act(async () => {
    await retainMeeting();
    if (!navigator.onLine) { setMessage('Live meetings require internet access. Your link or code is saved on this device.'); return; }
    await call('guest:open', { input: meetingInput, server: meetingServer || undefined });
  });
  const field = (key: 'due' | 'start' | 'end' | 'reminder', label: string, required = false) => <label className="flex flex-col gap-1">{label}<input className="rounded border border-line bg-surface p-2" aria-label={label} type="datetime-local" value={localInput(draft[key])} required={required} onChange={(e) => setDraft({ ...draft, [key]: instant(e.target.value) })} /></label>;
  const items = view?.items.filter((item) => item.kind === tab).sort((a, b) => (a.start ?? a.due ?? a.updatedAt).localeCompare(b.start ?? b.due ?? b.updatedAt)) ?? [];
  return <main className="flex h-full flex-col overflow-y-auto bg-ground p-5 text-ink">
    <header className="drag mb-4 flex flex-wrap items-center justify-between gap-3 pl-16"><div><h1 className="font-bold">Guest · Saved on this device</h1><p className="text-[12px] text-ink-3" role="status">{online ? 'Online · network available' : 'Offline · local tools work'}</p></div><div className="no-drag flex gap-2"><Button onClick={() => void act(() => call('local:signIn'))}>Sign In</Button><Button variant="ghost" onClick={() => void act(() => call('windows:close'))}>Close</Button></div></header>
    <nav className="mb-5 flex flex-wrap gap-2" aria-label="Guest workspace">{([['note', 'Notes'], ['task', 'Tasks'], ['event', 'Calendar'], ['meet', 'Join Meeting'], ['data', 'Backup & Data']] as const).map(([id, label]) => <Button key={id} variant={tab === id ? 'primary' : 'ghost'} onClick={() => choose(id)}>{label}</Button>)}</nav>
    {message ? <p role="status" className="mb-3 rounded border border-line p-3">{message}</p> : null}
    {!view ? <><Spinner /><Button onClick={() => void act(reload)}>Retry</Button></> : tab === 'meet' ? <form className="flex max-w-xl flex-col gap-4" onSubmit={(e) => { e.preventDefault(); void meeting(); }}>
      <h2 className="text-lg font-bold">Join Meeting</h2>
      <p>Live meetings require internet access. Links and codes are kept on this device while offline. The host decides guest access, passcodes and admission.</p>
      <TextField label="Meeting link or code" value={meetingInput} onChange={(e) => { setMeetingInput(e.target.value); void call('local:meeting', { input: e.target.value, server: meetingServer }).catch((error) => setMessage(errorMessage(error))); }} />
      <TextField label="WorkSuite server (for codes)" value={meetingServer} onChange={(e) => { setMeetingServer(e.target.value); void call('local:meeting', { input: meetingInput, server: e.target.value }).catch((error) => setMessage(errorMessage(error))); }} placeholder="https://app.yourcompany.com" />
      <div className="flex gap-2"><Button type="submit" disabled={!meetingInput.trim() || busy} variant="primary">{online ? 'Continue to meeting' : 'Save meeting destination'}</Button><Button type="button" disabled={busy} onClick={() => void act(retainMeeting, 'Meeting destination saved on this device.')}>Save for later</Button></div>
    </form> : tab === 'data' ? <section className="flex max-w-xl flex-col gap-4">
      <h2 className="text-lg font-bold">Backup & Data</h2><p>{view.items.length} local items. Guest data is kept in this device's WorkSuite profile and is never uploaded automatically. Anyone using this device profile can access it.</p>
      <p>Export a readable JSON backup before changing devices. Local guest storage supports backups up to 20 MB. Backups contain your notes, tasks and events. Restore merges items and skips identical content; it does not overwrite existing items.</p>
      <Button onClick={() => void act(async () => { const result = await call('local:export'); if (result.saved) setMessage('Backup exported. Keep it in a private location.'); })}>Export / Back up local data</Button>
      <Button onClick={() => void act(async () => { const result = await call('local:restore'); if (result) { await reload(); setMessage(`Restored ${result.added} items; skipped ${result.skipped} duplicates.`); } })}>Restore backup</Button>
      <TextField label="Type DELETE LOCAL DATA to delete everything" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
      <Button variant="danger" disabled={confirm !== 'DELETE LOCAL DATA' || busy} onClick={() => void act(async () => { await call('local:deleteAll', { confirmation: 'DELETE LOCAL DATA' }); await reload(); setMeetingInput(''); setMeetingServer(''); setConfirm(''); setDraft(empty('note')); }, 'All local guest data deleted. Exported backup files remain where you saved them.')}>Delete all local guest data</Button>
    </section> : <>
      {tab === 'event' ? <CalendarMonth month={month} setMonth={setMonth} items={items} select={(date) => setDraft({ ...empty('event'), start: instant(`${date}T09:00`), end: instant(`${date}T10:00`) })} edit={(item) => setDraft(item)} /> : null}
      <div className="grid gap-5 md:grid-cols-2"><section className="flex flex-col gap-3"><h2 className="text-lg font-bold">{tab === 'note' ? 'Notes' : tab === 'task' ? 'Tasks' : 'Events'}</h2><Button onClick={() => setDraft(empty(tab))}>New {tab === 'note' ? 'note' : tab === 'task' ? 'task' : 'event'}</Button>
        {items.length ? items.map((item) => <article key={item.id} className="rounded border border-line bg-surface p-3">
          <button className="text-left font-semibold hover:underline" onClick={() => setDraft(item)}>{item.title}</button>
          <p className="whitespace-pre-wrap text-[13px] text-ink-2">{item.body.slice(0, 160)}</p>
          {item.start || item.due ? <p className="text-[12px] text-ink-3">{new Date((item.start ?? item.due)!).toLocaleString()}</p> : null}
          {item.kind === 'task' ? <label className="flex gap-2"><Checkbox checked={item.completed} onChange={(e) => void act(async () => { await call('local:save', { ...item, completed: e.target.checked }); await reload(); })} />Completed</label> : null}
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => void remove(item)}>Delete</Button>
        </article>) : <p className="text-ink-3">No local items yet.</p>}
      </section><form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); void save(); }}>
        <h2 className="text-lg font-bold">{draft.id ? 'Edit' : 'Create'} {tab === 'note' ? 'note' : tab === 'task' ? 'task' : 'event'}</h2>
        <TextField label="Title" value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} maxLength={200} required />
        <label className="flex flex-col gap-1">{tab === 'note' ? 'Note' : 'Description'}<textarea aria-label={tab === 'note' ? 'Note' : 'Description'} className="min-h-40 rounded border border-line bg-surface p-3" maxLength={200000} value={draft.body} onChange={(e) => setDraft({ ...draft, body: e.target.value })} /></label>
        {tab === 'task' ? field('due', 'Due date and time') : null}
        {tab === 'event' ? <>{field('start', 'Start date and time', true)}{field('end', 'End date and time')}</> : null}
        {tab !== 'note' ? <>{field('reminder', 'Local reminder date and time')}<p className="text-[12px] text-ink-3">Reminders run while WorkSuite is running, including in the background. If you quit the app, missed reminders appear after reopening. Your operating system may silence notifications.</p></> : null}
        <Button type="submit" variant="primary" disabled={busy || !draft.title.trim()} loading={busy}>Save on this device</Button>
      </form></div>
    </>}
  </main>;
}
function CalendarMonth({ month, setMonth, items, select, edit }: { month: string; setMonth: (month: string) => void; items: LocalItem[]; select: (day: string) => void; edit: (item: LocalItem) => void }) {
  const [year, index] = month.split('-').map(Number);
  const offset = new Date(year!, index! - 1, 1).getDay();
  const days = new Date(year!, index!, 0).getDate();
  return <section className="mb-5"><label>Calendar month<input aria-label="Calendar month" className="ml-2 rounded border border-line bg-surface p-2" type="month" value={month} onChange={(e) => { if (e.target.value) setMonth(e.target.value); }} /></label>
    <div className="mt-3 grid grid-cols-7 gap-1">{['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day) => <b key={day}>{day}</b>)}{Array.from({ length: offset }, (_, i) => <div key={`space-${i}`} />)}{Array.from({ length: days }, (_, i) => {
      const date = `${month}-${String(i + 1).padStart(2, '0')}`;
      return <div key={date} className="min-h-20 rounded border border-line bg-surface p-1"><button aria-label={`Create event on ${date}`} onClick={() => select(date)} className="font-bold">{i + 1}</button>{items.filter((item) => localInput(item.start).startsWith(date)).map((item) => <button key={item.id} className="block w-full truncate text-left text-[12px] text-primary" onClick={() => edit(item)}>{item.title}</button>)}</div>;
    })}</div></section>;
}
