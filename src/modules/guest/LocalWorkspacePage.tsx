import { Checkbox } from '../../components/Checkbox';
import { useEffect, useState, type ReactNode } from 'react';
import { ONLINE_ONLY_FEATURES, searchLocalItems, type LocalItem, type LocalItemInput, type LocalProfile, type LocalStatus, type LocalView, type RestorePreview } from '@shared/local-workspace';
import { Avatar, Button, TextField, Spinner } from '../../components/ui';
import { Icon } from '../../components/Icon';
import { call, errorMessage } from '../../core/bridge';
import { setLanguage, text, useLanguage } from '../../core/i18n';
import { LocalProfileForm, LocalUnlock } from './LocalProfileForms';
const empty = (kind: LocalItem['kind']): LocalItemInput => ({ kind, title: '', body: '', completed: false, due: null, start: null, end: null, reminder: null });
export function localInput(value: string | null): string {
  if (!value) return '';
  const date = new Date(value);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}
function instant(value: string): string | null { return value ? new Date(value).toISOString() : null; }
/**
 * The Local Profile window (#86, #141): first-use setup, the optional PIN, then device-only Notes, Tasks and
 * Calendar. It never initializes account state; online-only apps are shown locked, never opened.
 */
export default function LocalWorkspacePage() {
  useLanguage();
  const [status, setStatus] = useState<LocalStatus | null>(null);
  const [error, setError] = useState('');
  const load = () => call('local:status').then((next) => { setLanguage(next.language); setStatus(next); setError(''); }, (e) => setError(errorMessage(e)));
  useEffect(() => { void load(); }, []);
  if (!status) return <main className="flex h-full flex-col items-center justify-center gap-3 bg-ground p-5 text-ink">{error ? <><p role="alert">{error}</p><Button onClick={() => void load()}>Retry</Button></> : <Spinner />}</main>;
  if (!status.profile) return <Gate><LocalProfileForm profile={null} onSaved={(profile) => setStatus({ ...status, profile, locked: false })} /></Gate>;
  if (status.locked) return <Gate><LocalUnlock profile={status.profile} onUnlocked={() => setStatus({ ...status, locked: false })} /></Gate>;
  return <LocalWorkspace profile={status.profile} onProfile={(profile) => setStatus({ ...status, profile })} onDeleted={() => void load()} />;
}
/** First use and the PIN: a card in the (frameless) window, which can still be closed. */
function Gate({ children }: { children: ReactNode }) {
  return <main className="drag relative flex h-full items-center justify-center overflow-y-auto bg-ground p-6 text-ink">
    <Button className="no-drag absolute top-3 right-3" variant="ghost" size="sm" onClick={() => void call('windows:close').catch(() => undefined)}>Close</Button>
    <div className="no-drag rounded-[16px] bg-surface p-8 shadow-xl">{children}</div>
  </main>;
}
type Tab = 'note' | 'task' | 'event' | 'meet' | 'data' | 'profile';
function LocalWorkspace({ profile, onProfile, onDeleted }: { profile: LocalProfile; onProfile: (profile: LocalProfile) => void; onDeleted: () => void }) {
  const [view, setView] = useState<LocalView | null>(null);
  const [tab, setTab] = useState<Tab>('note');
  const [query, setQuery] = useState('');
  const [restore, setRestore] = useState<RestorePreview | null>(null);
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
  const choose = (kind: Tab) => { setTab(kind); if (kind === 'note' || kind === 'task' || kind === 'event') setDraft(empty(kind)); setMessage(''); setQuery(''); };
  const save = () => act(async () => { await call('local:save', draft); await reload(); setDraft(empty(draft.kind)); }, text('Saved on this device.'));
  const remove = (item: LocalItem) => act(async () => { await call('local:remove', { id: item.id }); await reload(); if (draft.id === item.id) setDraft(empty(item.kind)); }, text('Deleted from this device.'));
  const retainMeeting = () => call('local:meeting', { input: meetingInput, server: meetingServer });
  const meeting = () => act(async () => {
    await retainMeeting();
    if (!navigator.onLine) { setMessage(text('Live meetings require internet access. Your link or code is saved on this device.')); return; }
    // Joins as a guest with the Local Profile's display name; no account or local data is sent.
    await call('local:joinMeeting', { input: meetingInput, server: meetingServer || undefined });
  });
  const field = (key: 'due' | 'start' | 'end' | 'reminder', label: string, required = false) => <label className="flex flex-col gap-1">{label}<input className="rounded border border-line bg-surface p-2" aria-label={label} type="datetime-local" value={localInput(draft[key])} required={required} onChange={(e) => setDraft({ ...draft, [key]: instant(e.target.value) })} /></label>;
  const all = view?.items.filter((item) => item.kind === tab).sort((a, b) => (a.start ?? a.due ?? a.updatedAt).localeCompare(b.start ?? b.due ?? b.updatedAt)) ?? [];
  const items = searchLocalItems(all, query);
  const kindLabel = tab === 'note' ? text('notes') : tab === 'task' ? text('tasks') : text('events');
  return <main className="flex h-full flex-col overflow-y-auto bg-ground p-5 text-ink">
    <header className="drag mb-4 flex flex-wrap items-center justify-between gap-3 pl-16">
      <div className="flex items-center gap-3">
        <Avatar name={profile.name} src={profile.picture} size={36} />
        <div>
          <h1 className="font-bold" data-testid="local-profile-chip"><span>{profile.name}</span><span className="font-normal text-ink-2"> · {text('Local Profile')} · {text('Saved on This Device')}</span></h1>
          <p className="mt-0.5 flex items-center gap-1 text-[12px] text-ink-3" role="status" aria-label={text('Connection')}><Icon name={online ? 'wifi' : 'wifi-off'} size={13} className={online ? 'text-success' : 'text-warning'} />{online ? 'Online · network available' : 'Offline · local tools work'}</p>
        </div>
      </div>
      <div className="no-drag flex gap-2"><Button onClick={() => void act(() => call('local:signIn'))} icon="log-in">Sign In / Create Account</Button><Button variant="ghost" onClick={() => void act(() => call('windows:close'))}>Close</Button></div>
    </header>
    <nav className="mb-2 flex flex-wrap gap-2" aria-label="Guest workspace">{([['note', 'Notes'], ['task', 'Tasks'], ['event', 'Calendar'], ['meet', 'Join Meeting'], ['data', 'Backup & Data'], ['profile', 'Profile']] as const).map(([id, label]) => <Button key={id} variant={tab === id ? 'primary' : 'ghost'} onClick={() => choose(id)}>{text(label)}</Button>)}</nav>
    <section className="mb-5 flex flex-wrap items-center gap-2 text-[12px] text-ink-3" aria-label={text('Needs a WorkSuite account')}>
      <span className="font-semibold">Needs a WorkSuite account:</span>
      {ONLINE_ONLY_FEATURES.map((feature) => <button key={feature} type="button" disabled aria-disabled title={text('Sign in to a WorkSuite account to use {feature}.', { feature: text(feature) })} className="inline-flex cursor-not-allowed items-center gap-1 rounded-[6px] border border-line px-1.5 py-0.5 opacity-70"><Icon name="lock" size={11} />{text(feature)}</button>)}
    </section>
    {message ? <p role="status" className="mb-3 rounded border border-line p-3">{message}</p> : null}
    {!view ? <><Spinner /><Button onClick={() => void act(reload)}>Retry</Button></> : tab === 'meet' ? <form className="flex max-w-xl flex-col gap-4" onSubmit={(e) => { e.preventDefault(); void meeting(); }}>
      <h2 className="flex items-center gap-2 text-lg font-bold">Join Meeting <span className="rounded-[6px] bg-subtle px-1.5 py-0.5 text-[11px] font-semibold text-ink-2">Needs internet</span></h2>
      <p>{text('You join as a guest named “{name}”, and can change the name before joining.', { name: profile.name })} Live meetings require internet access. Links and codes are kept on this device while offline. The host decides guest access, passcodes and admission.</p>
      <TextField label="Meeting link or code" value={meetingInput} onChange={(e) => { setMeetingInput(e.target.value); void call('local:meeting', { input: e.target.value, server: meetingServer }).catch((error) => setMessage(errorMessage(error))); }} />
      <TextField label="WorkSuite server (for codes)" value={meetingServer} onChange={(e) => { setMeetingServer(e.target.value); void call('local:meeting', { input: meetingInput, server: e.target.value }).catch((error) => setMessage(errorMessage(error))); }} placeholder="https://app.yourcompany.com" />
      <div className="flex gap-2"><Button type="submit" disabled={!meetingInput.trim() || busy} variant="primary">{online ? 'Continue to meeting' : 'Save meeting destination'}</Button><Button type="button" disabled={busy} onClick={() => void act(retainMeeting, 'Meeting destination saved on this device.')}>Save for later</Button></div>
    </form> : tab === 'data' ? <section className="flex max-w-xl flex-col gap-4">
      <h2 className="text-lg font-bold">Backup & Data</h2><p>{view.items.length} local items. Guest data is kept in this device's WorkSuite profile and is never uploaded automatically. Anyone using this device profile can access it.</p>
      <p>Export a readable JSON backup before changing devices. Local guest storage supports backups up to 20 MB. Backups contain your notes, tasks and events. Restore merges items and skips identical content; it does not overwrite existing items.</p>
      <Button onClick={() => void act(async () => { const result = await call('local:export'); if (result.saved) setMessage(text('Backup exported. Keep it in a private location.')); })}>Export / Back up local data</Button>
      <Button onClick={() => void act(async () => { setRestore(await call('local:restorePreview')); })}>Restore backup</Button>
      {restore ? <div className="rounded border border-line bg-surface p-3" role="group" aria-label={text('Restore preview')}>
        <p className="font-semibold">{text('This backup adds {notes} notes, {tasks} tasks and {events} events.', { notes: restore.notes, tasks: restore.tasks, events: restore.events })}</p>
        <p className="text-[13px] text-ink-2">{text('{count} identical items are already here and will be skipped. Nothing is overwritten.', { count: restore.duplicates })}{restore.profileName ? text(' Backup profile: {name}.', { name: restore.profileName }) : ''}</p>
        <div className="mt-2 flex gap-2"><Button variant="primary" disabled={busy} onClick={() => void act(async () => { const result = await call('local:restore', { token: restore.token }); setRestore(null); await reload(); setMessage(text('Restored {added} items; skipped {skipped} duplicates.', { added: result.added, skipped: result.skipped })); })}>Restore these items</Button><Button variant="ghost" onClick={() => setRestore(null)}>Cancel</Button></div>
      </div> : null}
      <TextField label="Type DELETE LOCAL DATA to delete everything" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
      <p className="text-[12px] text-ink-3">Deleting removes your Local Profile, its PIN and every local note, task and event from this device.</p>
      <Button variant="danger" disabled={confirm !== 'DELETE LOCAL DATA' || busy} onClick={() => void act(async () => { await call('local:deleteAll', { confirmation: 'DELETE LOCAL DATA' }); onDeleted(); })}>Delete all local guest data</Button>
    </section> : tab === 'profile' ? <LocalProfileForm profile={profile} onSaved={(next) => { onProfile(next); setMessage(text('Profile saved on this device.')); }} /> : <>
      {tab === 'event' ? <CalendarMonth month={month} setMonth={setMonth} items={items} select={(date) => setDraft({ ...empty('event'), start: instant(`${date}T09:00`), end: instant(`${date}T10:00`) })} edit={(item) => setDraft(item)} /> : null}
      <div className="grid gap-5 md:grid-cols-2"><section className="flex flex-col gap-3"><h2 className="text-lg font-bold">{tab === 'note' ? 'Notes' : tab === 'task' ? 'Tasks' : 'Events'}</h2><Button onClick={() => setDraft(empty(tab))}>New {tab === 'note' ? 'note' : tab === 'task' ? 'task' : 'event'}</Button>
        <TextField type="search" label={text('Search {kind}', { kind: kindLabel })} value={query} onChange={(e) => setQuery(e.target.value)} />
        {query && all.length && !items.length ? <p className="text-ink-3">No local items match your search.</p> : null}
        {items.length ? items.map((item) => <article key={item.id} className="rounded border border-line bg-surface p-3">
          <button className="text-left font-semibold hover:underline" onClick={() => setDraft(item)}>{item.title}</button>
          <p className="whitespace-pre-wrap text-[13px] text-ink-2">{item.body.slice(0, 160)}</p>
          {item.start || item.due ? <p className="text-[12px] text-ink-3">{new Date((item.start ?? item.due)!).toLocaleString()}</p> : null}
          {item.kind === 'task' ? <label className="flex gap-2"><Checkbox checked={item.completed} onChange={(e) => void act(async () => { await call('local:save', { ...item, completed: e.target.checked }); await reload(); })} />Completed</label> : null}
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => void remove(item)}>Delete</Button>
        </article>) : all.length ? null : <p className="text-ink-3">No local items yet.</p>}
      </section><form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); void save(); }}>
        <h2 className="text-lg font-bold">{draft.id ? 'Edit' : 'Create'} {tab === 'note' ? 'note' : tab === 'task' ? 'task' : 'event'}</h2>
        <TextField label="Title" value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} maxLength={200} required />
        <label className="flex flex-col gap-1">{tab === 'note' ? 'Note' : 'Description'}<textarea aria-label={tab === 'note' ? 'Note' : 'Description'} className="min-h-40 rounded border border-line bg-surface p-3" maxLength={200000} value={draft.body} onChange={(e) => setDraft({ ...draft, body: e.target.value })} /></label>
        {tab === 'task' ? field('due', 'Due date and time') : null}
        {tab === 'event' ? <>{field('start', 'Start date and time', true)}{field('end', 'End date and time')}</> : null}
        {tab !== 'note' ? <>{field('reminder', 'Local reminder date and time')}<p className="text-[12px] text-ink-3">Reminders run while WorkSuite is running, including in the background. They do not fire while WorkSuite is fully closed: if you quit the app, missed reminders appear after reopening. Your operating system may silence notifications.</p></> : null}
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
