import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useCanOpen } from '../../core/access';
import { ApiError, apiGet, apiPost } from '../../core/api';
import { errorMessage } from '../../core/bridge';
import { bytes } from '../../core/time';
import { toast } from '../../core/toasts';
import { Icon } from '../../components/Icon';
import { Button, Modal, Spinner, cx } from '../../components/ui';
import { flatten, tree as loadTree, type DriveFile, type DriveFolder } from './api';
import { forgetPassword, rememberPassword } from './locks';
import type { Item } from './ctx';
import { Select } from '../../components/Select';

const input = 'h-9 w-full rounded-[8px] border border-line bg-surface px-2.5 text-[13px] text-ink outline-none focus:border-primary';
const label = 'flex flex-col gap-[5px] text-[13px] font-semibold text-ink';

/** A name to give: a new folder, a new document, or a rename. The extension is kept unless changed on purpose. */
export function NameDialog({ title, initial, action, onClose, onSave }: { title: string; initial: string; action: string; onClose: () => void; onSave: (name: string) => Promise<void> }) {
  const [name, setName] = useState(initial);
  const [busy, setBusy] = useState(false);
  const dot = initial.lastIndexOf('.');
  const save = async () => {
    if (!name.trim() || busy) return;
    setBusy(true);
    try {
      await onSave(name.trim());
      onClose();
    } catch (e) {
      toast('error', errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title={title} onClose={onClose} width={400} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} disabled={!name.trim()} onClick={() => void save()}>{action}</Button></>}>
      <input
        autoFocus
        value={name}
        maxLength={255}
        aria-label="Name"
        onFocus={(e) => (dot > 0 ? e.currentTarget.setSelectionRange(0, dot) : e.currentTarget.select())}
        onChange={(e) => setName(e.target.value.replace(/[/\\]/g, ''))}
        onKeyDown={(e) => e.key === 'Enter' && void save()}
        className={input}
      />
    </Modal>
  );
}

export function ConfirmDialog({ title, body, action, danger, onClose, onYes }: { title: string; body: string; action: string; danger?: boolean; onClose: () => void; onYes: () => void }) {
  return (
    <Modal title={title} onClose={onClose} width={420} footer={<><Button onClick={onClose}>Cancel</Button><Button variant={danger ? 'danger' : 'primary'} onClick={() => (onClose(), onYes())}>{action}</Button></>}>
      <p className="text-[13px] leading-[1.5] text-ink-2">{body}</p>
    </Modal>
  );
}

/** Where to move or copy to: your folders as a tree; a folder cannot go inside itself. */
export function FolderPicker({ items, mode, onClose, onPick }: { items: Item[]; mode: 'move' | 'copy'; onClose: () => void; onPick: (folder: number | null, name: string) => void }) {
  const q = useQuery({ queryKey: ['files', 'tree'], queryFn: ({ signal }) => loadTree(signal) });
  const [chosen, setChosen] = useState<number | null>(null);
  const [term, setTerm] = useState('');
  const moving = items.filter((i) => i.type === 'folder').map((i) => i.f.id);
  const rows = flatten(q.data?.tree ?? []);
  const blocked = new Set<number>();
  for (const r of rows) if (moving.includes(r.id) || (r.parent_id !== null && blocked.has(r.parent_id))) blocked.add(r.id);
  const shown = rows.filter((r) => !term.trim() || r.name.toLowerCase().includes(term.trim().toLowerCase()));
  const what = items.length === 1 ? `“${items[0]!.f.name}”` : `${items.length} items`;
  const name = chosen === null ? 'My Drive' : (rows.find((r) => r.id === chosen)?.name ?? 'folder');
  return (
    <Modal
      title={`${mode === 'move' ? 'Move' : 'Copy'} ${what}`}
      onClose={onClose}
      width={460}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" onClick={() => (onClose(), onPick(chosen, name))}>{mode === 'move' ? 'Move here' : 'Copy here'}</Button></>}
    >
      <div className="flex flex-col gap-2 text-[13px]">
        <input value={term} onChange={(e) => setTerm(e.target.value)} aria-label="Find a folder" placeholder="Find a folder" className={input} />
        <div role="listbox" aria-label="Folders" className="flex max-h-[320px] flex-col overflow-y-auto rounded-[9px] border border-line p-1 scroll-thin">
          {!term.trim() ? (
            <button type="button" role="option" aria-selected={chosen === null} onClick={() => setChosen(null)} className={cx('flex h-8 items-center gap-2 rounded-[7px] px-2 text-left', chosen === null ? 'bg-selection font-bold text-primary' : 'text-ink hover:bg-ground')}>
              <Icon name="home" size={15} /> My Drive
            </button>
          ) : null}
          {q.isLoading ? <Spinner /> : null}
          {shown.map((r) => (
            <button key={r.id} type="button" role="option" aria-selected={chosen === r.id} disabled={blocked.has(r.id)} onClick={() => setChosen(r.id)} className={cx('flex h-8 shrink-0 items-center gap-2 rounded-[7px] pr-2 text-left disabled:opacity-40', chosen === r.id ? 'bg-selection font-bold text-primary' : 'text-ink hover:bg-ground')} style={{ paddingLeft: 8 + (term.trim() ? 0 : (r.depth + 1) * 16) }}>
              <span style={{ color: r.color ?? '#0E7C86' }}><Icon name={r.is_locked ? 'lock' : 'folder'} size={15} /></span>
              <span className="truncate">{r.name}</span>
              {term.trim() && r.path ? <span className="truncate text-[11px] text-ink-3">{r.path}</span> : null}
            </button>
          ))}
        </div>
        <span className="text-[12px] text-ink-3">Only your own folders are listed. Something shared with you can be moved within its company only.</span>
      </div>
    </Modal>
  );
}

/** Lock a folder with a password, or take the lock off (with the current password). */
export function LockDialog({ folder, on, onClose, onDone }: { folder: DriveFolder; on: boolean; onClose: () => void; onDone: () => void }) {
  const [pw, setPw] = useState('');
  const [again, setAgain] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const strength = pw.length >= 12 && /[a-z]/.test(pw) && /[A-Z0-9]/.test(pw) ? 'Strong password' : pw.length >= 8 ? 'Fair password' : pw ? 'Too short: use at least 8 characters' : '';
  const ok = on ? pw.length >= 8 && pw === again : !!pw;
  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await apiPost(`/api/folders/${folder.id}/${on ? 'lock' : 'unlock'}`, { password: pw });
      if (on) rememberPassword(folder.id, pw);
      else forgetPassword(folder.id);
      toast('success', on ? `“${folder.name}” is locked` : `The lock on “${folder.name}” is off`);
      onDone();
      onClose();
    } catch (e) {
      setError(e instanceof ApiError && e.status === 401 ? 'That is not the folder’s password.' : errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title={on ? `Password lock “${folder.name}”` : `Remove the lock on “${folder.name}”`} onClose={onClose} width={400} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} disabled={!ok} onClick={() => void save()}>{on ? 'Lock folder' : 'Remove lock'}</Button></>}>
      <div className="flex flex-col gap-3 text-[13px]">
        <span className="leading-[1.5] text-ink-2">{on ? 'Anyone opening this folder — including you on another device — must enter the password.' : 'Enter the folder’s current password to take the lock off.'}</span>
        <label className={label}>
          {on ? 'Password' : 'Current password'}
          <input autoFocus type="password" value={pw} onChange={(e) => setPw(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && ok && void save()} className={input} />
        </label>
        {on ? (
          <label className={label}>
            Confirm password
            <input type="password" value={again} onChange={(e) => setAgain(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && ok && void save()} className={input} />
          </label>
        ) : null}
        {on && strength ? <span className={cx('text-[12px] font-semibold', strength === 'Strong password' ? 'text-success' : strength.startsWith('Too') ? 'text-danger' : 'text-warning')}>{strength}</span> : null}
        {on && again && pw !== again ? <span className="text-[12px] text-danger">The two passwords differ.</span> : null}
        {error ? <span role="alert" className="text-[12px] text-danger">{error}</span> : null}
      </div>
    </Modal>
  );
}

/** A locked folder asks for its password before it shows anything. */
export function UnlockPrompt({ folderId, name, onUnlocked }: { folderId: number; name: string; onUnlocked: () => void }) {
  const [pw, setPw] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const open = async () => {
    setBusy(true);
    setError(null);
    try {
      await apiPost(`/api/folders/${folderId}/verify`, { password: pw });
      rememberPassword(folderId, pw);
      onUnlocked();
    } catch (e) {
      setError(e instanceof ApiError && e.status === 401 ? 'That password is not right.' : errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="mx-auto mt-16 flex w-[340px] flex-col items-center gap-3 text-center">
      <span className="flex h-14 w-14 items-center justify-center rounded-[18px] bg-warning-bg text-warning"><Icon name="lock" size={24} /></span>
      <b className="text-[15px] text-ink">“{name}” is password locked</b>
      <span className="text-[12.5px] text-ink-3">Enter the password to open it. It is remembered until you quit the app.</span>
      <input autoFocus type="password" value={pw} onChange={(e) => setPw(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && pw && void open()} aria-label="Folder password" placeholder="Password" className={input} />
      {error ? <span role="alert" className="text-[12px] text-danger">{error}</span> : null}
      <Button variant="primary" loading={busy} disabled={!pw} onClick={() => void open()}>Open folder</Button>
    </div>
  );
}

/** Look inside a zip without downloading it, and extract it into the Drive. */
export function ArchiveDialog({ file, onClose, onExtracted, onDownload }: { file: DriveFile; onClose: () => void; onExtracted: (folderId: number) => void; onDownload: () => void }) {
  const q = useQuery({
    queryKey: ['files', 'zip', file.id],
    queryFn: () => apiPost<{ count: number; total_size: number; entries: Array<{ path: string; size: number; is_dir: boolean }> }>('/api/zip/list', { file_id: file.id }),
    retry: false,
  });
  const [busy, setBusy] = useState(false);
  const zip = (file.extension ?? '').toLowerCase() === 'zip';
  const extract = async () => {
    setBusy(true);
    try {
      const r = await apiPost<{ folder_id: number; written: number; skipped: number; note: string | null }>(`/api/drive/files/${file.id}/extract`, {});
      toast('success', `Extracted ${r.written} ${r.written === 1 ? 'file' : 'files'}${r.skipped ? `; ${r.skipped} skipped` : ''}.`);
      onClose();
      onExtracted(r.folder_id);
    } catch (e) {
      toast('error', errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title={file.name}
      onClose={onClose}
      width={440}
      footer={
        <>
          <Button onClick={() => (onClose(), onDownload())}>Download</Button>
          {zip ? <Button variant="primary" loading={busy} onClick={() => void extract()}>Extract here</Button> : null}
        </>
      }
    >
      <div className="flex flex-col gap-2.5 text-[13px]">
        {q.data ? <span className="text-ink-3">{q.data.count.toLocaleString()} items · {bytes(q.data.total_size)} · view contents without downloading</span> : null}
        {q.isLoading ? <Spinner /> : null}
        {q.error ? <span className="text-ink-2">{q.error instanceof ApiError && q.error.status === 403 ? 'Only its owner can look inside this archive here.' : errorMessage(q.error)}{zip ? ' You can still extract it into your Drive.' : ''}</span> : null}
        {q.data ? (
          <div className="max-h-[300px] overflow-y-auto rounded-[9px] border border-line font-mono text-[12px] scroll-thin">
            {q.data.entries.map((e) => (
              <div key={e.path} className="flex justify-between gap-3 border-b border-line/70 px-2.5 py-1.5">
                <span className="truncate text-ink">{e.path}</span>
                <span className="shrink-0 text-ink-3">{e.is_dir ? '—' : bytes(e.size)}</span>
              </div>
            ))}
          </div>
        ) : null}
        {!zip ? <span className="text-[12px] text-ink-3">Only .zip archives extract here; download the others.</span> : null}
      </div>
    </Modal>
  );
}

const EXPIRY: Array<[string, number]> = [
  ['1 hour', 3600],
  ['1 day', 86_400],
  ['7 days', 604_800],
  ['30 days', 2_592_000],
  ['Never', 0],
];

/** A secure link (DriveSecureLink): expiring, download-limited, optional password and IP lock. */
export function SecureLinkDialog({ file, onClose, onAll }: { file: DriveFile; onClose: () => void; onAll: () => void }) {
  const [labelText, setLabel] = useState('');
  const [expiry, setExpiry] = useState(604_800);
  const [limit, setLimit] = useState('0');
  const [pw, setPw] = useState('');
  const [ipOn, setIpOn] = useState(false);
  const [ips, setIps] = useState('');
  const [busy, setBusy] = useState(false);
  const [url, setUrl] = useState<string | null>(null);
  const create = async () => {
    setBusy(true);
    try {
      const r = await apiPost<{ token: string; url: string }>('/api/downloads/grant', {
        file_id: file.id,
        label: labelText.trim() || undefined,
        expires_in: expiry,
        max_downloads: Number(limit) || undefined,
        one_time: limit === '1' || undefined,
        password: pw || undefined,
        allowed_ips: ipOn && ips.trim() ? ips.trim() : undefined,
      });
      setUrl(r.url);
      await navigator.clipboard.writeText(r.url).catch(() => undefined);
      toast('success', 'Secure link made and copied');
    } catch (e) {
      toast('error', errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title="Secure link"
      onClose={onClose}
      width={560}
      footer={
        <>
          <button type="button" onClick={() => (onClose(), onAll())} className="mr-auto text-[12.5px] font-semibold text-primary hover:underline">All secure links</button>
          <Button onClick={onClose}>{url ? 'Done' : 'Cancel'}</Button>
          {!url ? <Button variant="primary" loading={busy} onClick={() => void create()}>Create link</Button> : null}
        </>
      }
    >
      <div className="flex flex-col gap-3.5 text-[13px]">
        <span className="-mt-1 text-ink-3">{file.name} · {bytes(file.size)}</span>
        <label className={label}>
          Label
          <input value={labelText} maxLength={120} disabled={!!url} onChange={(e) => setLabel(e.target.value)} placeholder="Who is it for?" className={input} />
        </label>
        <div className="flex flex-col gap-2">
          <span className="font-semibold text-ink">The link lasts</span>
          <div role="radiogroup" aria-label="Expiry" className="flex flex-wrap gap-1.5">
            {EXPIRY.map(([l, s]) => (
              <button key={l} type="button" role="radio" aria-checked={expiry === s} disabled={!!url} onClick={() => setExpiry(s)} className={cx('h-8 rounded-2xl px-3 text-[12.5px] font-semibold', expiry === s ? 'bg-primary text-white' : 'border border-line bg-surface text-ink hover:bg-subtle')}>
                {l}
              </button>
            ))}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2.5">
          <label className={label}>
            Download limit
            <Select value={limit} disabled={!!url} onChange={(e) => setLimit(e.target.value)} className={input}>
              <option value="0">Unlimited</option>
              <option value="1">1 download</option>
              <option value="5">5 downloads</option>
              <option value="10">10 downloads</option>
              <option value="50">50 downloads</option>
            </Select>
          </label>
          <label className={label}>
            Password
            <input type="password" value={pw} disabled={!!url} onChange={(e) => setPw(e.target.value)} placeholder="Optional" className={input} />
          </label>
        </div>
        <label className="flex items-start gap-2.5">
          <input type="checkbox" checked={ipOn} disabled={!!url} onChange={(e) => setIpOn(e.target.checked)} className="mt-0.5 accent-[var(--color-primary)]" />
          <span className="flex flex-1 flex-col gap-1">
            <b className="text-ink">Lock to IP addresses</b>
            {ipOn ? <input value={ips} disabled={!!url} onChange={(e) => setIps(e.target.value)} placeholder="112.134.0.0/16, 203.0.113.5" aria-label="Allowed IP addresses" className={input} /> : <span className="text-[12px] text-ink-3">Only these networks can open it.</span>}
          </span>
        </label>
        {url ? (
          <div className="flex items-center gap-2 rounded-[9px] border border-line bg-ground px-2.5 py-2">
            <span className="min-w-0 flex-1 truncate font-mono text-[12px] text-ink">{url}</span>
            <Button size="sm" onClick={() => void navigator.clipboard.writeText(url).then(() => toast('success', 'Copied'))}>Copy</Button>
          </div>
        ) : null}
      </div>
    </Modal>
  );
}

/** A link anybody (or anybody with the password) can open: a file's public link, or a folder's link. */
export function LinkDialog({ item, onClose }: { item: Item; onClose: () => void }) {
  const [visibility, setVisibility] = useState<'public' | 'password'>('public');
  const [pw, setPw] = useState('');
  const [expiry, setExpiry] = useState(item.type === 'file' ? 0 : 604_800);
  const [busy, setBusy] = useState(false);
  const [url, setUrl] = useState<string | null>(null);
  const create = async () => {
    setBusy(true);
    try {
      const r = await apiPost<{ url: string }>('/api/shares', {
        [item.type === 'file' ? 'file_id' : 'folder_id']: item.f.id,
        visibility,
        password: visibility === 'password' ? pw : undefined,
        expires_in: expiry || undefined,
      });
      setUrl(r.url);
      await navigator.clipboard.writeText(r.url).catch(() => undefined);
      toast('success', 'Link made and copied');
    } catch (e) {
      toast('error', errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title={item.type === 'file' ? 'Public link' : `Link to “${item.f.name}”`}
      onClose={onClose}
      width={460}
      footer={<><Button onClick={onClose}>{url ? 'Done' : 'Cancel'}</Button>{!url ? <Button variant="primary" loading={busy} disabled={visibility === 'password' && pw.length < 4} onClick={() => void create()}>Create link</Button> : null}</>}
    >
      <div className="flex flex-col gap-3 text-[13px]">
        <span className="text-ink-2">{item.type === 'file' ? 'Anybody with the link can open it.' : 'Anybody with the link can open the folder, see what is in it, and download it.'}</span>
        <div role="radiogroup" aria-label="Who can open it" className="flex gap-3.5">
          {(
            [
              ['public', 'Anybody with the link'],
              ['password', 'With a password'],
            ] as const
          ).map(([v, l]) => (
            <label key={v} className="flex items-center gap-1.5 text-ink">
              <input type="radio" name="vis" checked={visibility === v} disabled={!!url} onChange={() => setVisibility(v)} className="accent-[var(--color-primary)]" />
              {l}
            </label>
          ))}
        </div>
        {visibility === 'password' ? <input type="password" value={pw} disabled={!!url} onChange={(e) => setPw(e.target.value)} aria-label="Link password" placeholder="Password" className={input} /> : null}
        <label className={label}>
          Lasts
          <Select value={expiry} disabled={!!url} onChange={(e) => setExpiry(Number(e.target.value))} className={input}>
            <option value={86_400}>1 day</option>
            <option value={604_800}>7 days</option>
            <option value={2_592_000}>30 days</option>
            <option value={0}>Until revoked</option>
          </Select>
        </label>
        {url ? (
          <div className="flex items-center gap-2 rounded-[9px] border border-line bg-ground px-2.5 py-2">
            <span className="min-w-0 flex-1 truncate font-mono text-[12px] text-ink">{url}</span>
            <Button size="sm" onClick={() => void navigator.clipboard.writeText(url).then(() => toast('success', 'Copied'))}>Copy</Button>
          </div>
        ) : null}
      </div>
    </Modal>
  );
}

interface NeedsAccess {
  needs_access: true;
  people: Array<{ id: number; name: string }>;
  more: number;
  can_grant: boolean;
  can_link: boolean;
  levels: string[];
  link_lifetimes: number[];
}

/** Send a file or folder into a conversation (DriveDialogs): a person, a conversation, or a team. */
export function SendToChatDialog({ item, discuss, onClose, onOpenChat }: { item: Item; discuss?: boolean; onClose: () => void; onOpenChat: (roomId: number) => void }) {
  const [tab, setTab] = useState<'person' | 'room' | 'team'>('person');
  const [term, setTerm] = useState('');
  const [to, setTo] = useState<{ kind: 'user' | 'room' | 'team'; id: number; name: string } | null>(null);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [needs, setNeeds] = useState<NeedsAccess | null>(null);
  const chat = useCanOpen('chat');
  const people = useQuery({ queryKey: ['chat', 'directory'], queryFn: ({ signal }) => apiGet<{ users: Array<{ id: number; name: string; email?: string | null }> }>('/api/chat/directory', undefined, signal), staleTime: 5 * 60_000 });
  const rooms = useQuery({ queryKey: ['chat', 'rooms-plain'], queryFn: ({ signal }) => apiGet<{ rooms: Array<{ id: number; name: string; type: string }> }>('/api/chat/rooms', undefined, signal), enabled: tab === 'room' });
  const teams = useQuery({ queryKey: ['files', 'chat-teams', term.trim()], queryFn: ({ signal }) => apiGet<{ teams: Array<{ id: number; name: string; detail?: string | null }> }>('/api/drive/chat/teams', { q: term.trim() }, signal), enabled: tab === 'team' });
  const t = term.trim().toLowerCase();
  const list =
    tab === 'person'
      ? (people.data?.users ?? []).filter((u) => !t || `${u.name} ${u.email ?? ''}`.toLowerCase().includes(t)).slice(0, 8).map((u) => ({ kind: 'user' as const, id: u.id, name: u.name, sub: u.email ?? 'Direct message' }))
      : tab === 'room'
        ? (rooms.data?.rooms ?? []).filter((r) => !t || r.name.toLowerCase().includes(t)).slice(0, 8).map((r) => ({ kind: 'room' as const, id: r.id, name: r.name, sub: r.type === 'direct' ? 'Direct message' : 'Conversation' }))
        : (teams.data?.teams ?? []).slice(0, 8).map((r) => ({ kind: 'team' as const, id: r.id, name: r.name, sub: r.detail ?? 'Team' }));

  const send = async (grant?: string) => {
    if (!to) return;
    setBusy(true);
    try {
      const body = { [to.kind === 'user' ? 'user_id' : to.kind === 'room' ? 'room_id' : 'team_id']: to.id, message: message.trim() || undefined, ...(grant ? { grant, ...(grant === 'link' ? { link_lifetime: 604_800 } : {}) } : {}) };
      const r = await apiPost<{ room_id: number }>(`/api/drive/chat/${discuss || to.kind === 'team' ? 'discuss' : 'share'}/${item.type}/${item.f.id}`, body);
      toast('success', discuss ? 'Conversation started' : 'Sent to Chat', chat ? { label: 'Open', run: () => onOpenChat(r.room_id) } : undefined);
      onClose();
    } catch (e) {
      if (e instanceof ApiError && e.status === 409 && (e.data as NeedsAccess | null)?.needs_access) setNeeds(e.data as NeedsAccess);
      else toast('error', errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={discuss ? 'Discuss in Chat' : 'Send to Chat'} onClose={onClose} width={420} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} disabled={!to || !!needs} onClick={() => void send()}>Send</Button></>}>
      <div className="flex flex-col gap-2.5 text-[13px]">
        <span className="-mt-1 truncate text-ink-3">{item.f.name}</span>
        <span role="tablist" className="flex rounded-[9px] bg-subtle p-[3px] text-[12.5px] font-semibold">
          {(
            [
              ['person', 'Person'],
              ['room', 'Conversation'],
              ['team', 'Team'],
            ] as const
          )
            .filter(([k]) => !(discuss && k === 'room'))
            .map(([k, l]) => (
              <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => (setTab(k), setTo(null), setNeeds(null))} className={cx('flex-1 rounded-[7px] py-1.5', tab === k ? 'bg-surface text-ink shadow-sm' : 'text-ink-2')}>
                {l}
              </button>
            ))}
        </span>
        <input autoFocus value={term} onChange={(e) => setTerm(e.target.value)} aria-label={`Search ${tab === 'person' ? 'people' : tab === 'room' ? 'conversations' : 'teams'}`} placeholder={`Search ${tab === 'person' ? 'people' : tab === 'room' ? 'conversations' : 'teams'}`} className={input} />
        <div className="flex max-h-[220px] flex-col gap-0.5 overflow-y-auto scroll-thin">
          {list.map((r) => (
            <button key={`${r.kind}${r.id}`} type="button" onClick={() => (setTo(r), setNeeds(null))} className={cx('flex items-center gap-2.5 rounded-[9px] px-2.5 py-2 text-left', to?.kind === r.kind && to.id === r.id ? 'bg-selection' : 'hover:bg-ground')}>
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#FDF0E1] text-[10.5px] font-bold text-[#9A4A06] dark:bg-warning-bg dark:text-warning">{r.name.split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase()}</span>
              <b className="min-w-0 flex-1 truncate text-ink">{r.name}</b>
              <span className="shrink-0 text-[11.5px] text-ink-3">{r.sub}</span>
            </button>
          ))}
        </div>
        {needs ? (
          <div className="flex flex-col gap-2 rounded-[9px] bg-warning-bg p-2.5">
            <span className="font-semibold text-ink">{needs.people.map((p) => p.name).join(', ')}{needs.more ? ` and ${needs.more} more` : ''} can’t open this {item.type} yet</span>
            <div className="flex flex-wrap gap-1.5">
              {needs.levels.includes('view') ? <Button size="sm" variant="primary" disabled={busy} onClick={() => void send('view')}>Grant view</Button> : null}
              {needs.levels.includes('edit') ? <Button size="sm" disabled={busy} onClick={() => void send('edit')}>Grant edit</Button> : null}
              {needs.levels.includes('link') ? <Button size="sm" disabled={busy} onClick={() => void send('link')}>Send secure link</Button> : null}
              {!needs.levels.length ? <span className="text-[12px] text-ink-2">Ask the owner to share it with them first.</span> : null}
            </div>
          </div>
        ) : null}
        <textarea value={message} maxLength={1000} onChange={(e) => setMessage(e.target.value)} aria-label="Message" placeholder="Add a message (optional)" className="h-[54px] resize-none rounded-[8px] border border-line bg-surface p-2 text-ink outline-none focus:border-primary" />
      </div>
    </Modal>
  );
}
