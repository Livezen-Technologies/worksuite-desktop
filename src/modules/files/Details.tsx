import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { apiDelete, apiGet, apiPost, apiPut, request } from '../../core/api';
import { call, errorMessage } from '../../core/bridge';
import { bytes, dateLabel, listStamp, timeLabel } from '../../core/time';
import { toast } from '../../core/toasts';
import { Icon } from '../../components/Icon';
import { Button, ErrorNote, Spinner, cx } from '../../components/ui';
import { IMAGE_EDIT_EXTS, can, extOf, openWay, type DriveFile, type DriveFolder, type ItemAccess } from './api';
import { fileMenu, folderMenu, useDrive, type Item } from './ctx';
import { PopMenu, below, type MenuItem } from './Menu';
import { FolderIcon, Tile } from './Thumb';
import { SYNC_WORDS, hereLabel, revealLabel, useSyncAvailable, useSyncLookup } from './sync';
import { Checkbox } from '../../components/Checkbox';

type Tab = 'details' | 'activity' | 'comments' | 'versions' | 'access';

const stamp = (s: string | null | undefined) => (s ? `${dateLabel(s)}, ${timeLabel(s)}` : '—');
const LEVEL: Record<string, string> = { view: 'Can view', edit: 'Can edit', full: 'Full access' };
const initials = (n: string | null | undefined) => (n ?? '?').split(/\s+/).filter(Boolean).map((w) => w[0]).join('').slice(0, 2).toUpperCase() || '?';

/**
 * The details panel (DriveGrid, right): a picture of the file, what to do
 * with it, then Details, Activity, Comments, Versions and Access.
 */
export function Details({ item, list, onClose, tab: firstTab }: { item: Item; list: DriveFile[]; onClose: () => void; tab?: Tab }) {
  const d = useDrive();
  const [tab, setTab] = useState<Tab>(firstTab ?? 'details');
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const isFile = item.type === 'file';
  const type = isFile ? 'file' : 'folder';
  const tabs: Array<[Tab, string]> = [
    ['details', 'Details'],
    ['activity', 'Activity'],
    ['comments', 'Comments'],
    ...(isFile ? ([['versions', 'Versions']] as Array<[Tab, string]>) : []),
    ['access', 'Access'],
  ];
  const f = item.f;
  const way = isFile ? openWay(item.f) : null;
  const items: MenuItem[] = isFile ? fileMenu(item.f, d, list) : folderMenu(item.f, d);

  return (
    <aside aria-label="File details" className="flex w-[360px] shrink-0 flex-col border-l border-line bg-surface">
      <div className="flex flex-col gap-2.5 border-b border-line px-4 pt-3.5 pb-2.5">
        <div className="relative overflow-hidden rounded-[10px]">
          {isFile ? <Tile f={item.f} height={150} /> : <div className="flex h-[110px] items-center justify-center bg-[#FDF0E1] dark:bg-warning-bg"><FolderIcon color={item.f.color} locked={item.f.is_locked} size={56} /></div>}
          <button type="button" aria-label="Close details" onClick={onClose} className="absolute top-2 right-2 flex h-7 w-7 items-center justify-center rounded-full bg-surface/90 text-ink-2 shadow hover:text-ink">
            <Icon name="x" size={14} />
          </button>
        </div>
        <div className="flex items-center gap-2">
          <b className="min-w-0 flex-1 text-[14.5px] break-words text-ink">{f.name}</b>
          <button type="button" aria-label={f.starred ? 'Remove star' : 'Star'} aria-pressed={!!f.starred} onClick={() => d.star(item, !f.starred)} className={cx('flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-[7px]', f.starred ? 'bg-[#FFF6E5] text-[#E9A23B] dark:bg-warning-bg' : 'text-ink-3 hover:bg-subtle')}>
            <Icon name="star" size={16} className={f.starred ? 'fill-current' : ''} />
          </button>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {isFile ? (
            <button type="button" onClick={() => d.open(item, list)} className="flex h-[30px] items-center rounded-[7px] bg-primary px-2.5 text-[12px] font-bold text-white hover:bg-primary-hover">
              {way === 'office' ? 'Edit in Office' : way === 'archive' ? 'View contents' : way === 'pdf' ? 'Read PDF' : way === 'code' ? (can(item.f.access, 'edit') ? 'Edit' : 'Open') : way === 'media' ? 'Play' : way === 'preview' ? 'Open' : 'Download'}
            </button>
          ) : (
            <button type="button" onClick={() => d.openFolder(item.f.id)} className="flex h-[30px] items-center rounded-[7px] bg-primary px-2.5 text-[12px] font-bold text-white hover:bg-primary-hover">Open</button>
          )}
          {isFile && IMAGE_EDIT_EXTS.includes(extOf(item.f.name, item.f.extension)) && can(f.access, 'upload_version') ? <button type="button" onClick={() => d.editImage(item.f)} className="h-[30px] rounded-[7px] border border-line px-2.5 text-[12px] font-semibold text-ink hover:bg-subtle">Edit image</button> : null}
          {can(f.access, 'share') ? <button type="button" onClick={() => d.share(item)} className="h-[30px] rounded-[7px] border border-line px-2.5 text-[12px] font-semibold text-ink hover:bg-subtle">Share…</button> : null}
          {isFile && can(f.access, 'download') ? <button type="button" onClick={() => d.download([item.f], true)} className="h-[30px] rounded-[7px] border border-line px-2.5 text-[12px] font-semibold text-ink hover:bg-subtle">Open locally</button> : null}
          <button type="button" aria-label="More actions" onClick={(e) => setMenu(below(e.currentTarget, 'right'))} className="h-[30px] w-[30px] rounded-[7px] border border-line text-[15px] font-bold text-ink-2 hover:bg-subtle">⋯</button>
        </div>
      </div>
      <div role="tablist" aria-label="Details" className="flex gap-0.5 border-b border-line px-2.5">
        {tabs.map(([k, l]) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)} className={cx('h-[38px] px-[9px] text-[12.5px]', tab === k ? 'font-bold text-primary shadow-[inset_0_-2px_0_var(--color-primary)]' : 'font-medium text-ink-2 hover:text-ink')}>
            {l}
          </button>
        ))}
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto px-4 py-3.5 text-[12.5px] scroll-thin">
        {tab === 'details' ? isFile ? <FileFacts f={item.f} /> : <FolderFacts f={item.f} /> : null}
        {tab === 'details' ? <Records type={type} id={f.id} /> : null}
        {tab === 'details' ? <Notify type={type} id={f.id} /> : null}
        {tab === 'activity' ? <Activity type={type} id={f.id} /> : null}
        {tab === 'comments' ? <Comments type={type} id={f.id} /> : null}
        {tab === 'versions' && isFile ? <Versions f={item.f} /> : null}
        {tab === 'access' ? <Access item={item} /> : null}
      </div>
      {menu ? <PopMenu at={menu} items={items} label={`Actions — ${f.name}`} onClose={() => setMenu(null)} /> : null}
    </aside>
  );
}

/**
 * "On this Mac" and "Local path", with Show in Finder — whether Drive sync
 * keeps this file or folder on this computer (the Drive designs' Details).
 */
function HereFacts({ kind, id, context, folder }: { kind: 'file' | 'folder'; id: number; context: number | null; folder?: DriveFolder }) {
  const d = useDrive();
  const on = useSyncAvailable();
  const look = useSyncLookup(on && kind === 'file' ? [id] : [], on && kind === 'folder' ? [id] : [], context);
  if (!on) return null;
  const hit = kind === 'file' ? look.files[String(id)] : look.folders[String(id)];
  const state = hit?.state ?? 'online';
  const tone = state === 'synced' ? 'text-success' : state === 'conflict' ? 'text-warning' : state === 'pending' ? 'text-primary' : 'text-ink-2';
  const icon = state === 'synced' ? 'check' : state === 'conflict' ? 'warning' : state === 'pending' ? 'refresh' : 'cloud';
  const mayKeep = kind === 'folder' && state === 'online' && folder && folder.access?.owner !== false && !folder.is_locked;
  const reveal = () =>
    void call('sync:reveal', kind === 'file' ? { fileId: id } : { folderId: id }).catch((e) => toast('error', errorMessage(e)));
  return (
    <>
      <div className="flex gap-2.5">
        <span className="w-24 shrink-0 text-ink-3">{hereLabel()}</span>
        <span className={cx('flex min-w-0 items-center gap-1.5 font-semibold', tone)}>
          <Icon name={icon} size={14} className="shrink-0" />
          {SYNC_WORDS[state]}
        </span>
      </div>
      {hit?.path ? (
        <div className="flex gap-2.5">
          <span className="w-24 shrink-0 text-ink-3">Local path</span>
          <span className="min-w-0 font-mono text-[12px] break-all text-ink">{hit.path}</span>
        </div>
      ) : null}
      {state === 'synced' || state === 'conflict' ? (
        <Button icon="folder-open" onClick={reveal} className="w-full">
          {revealLabel()}
        </Button>
      ) : null}
      {mayKeep ? (
        <Button icon="laptop" onClick={() => d.syncFolder(folder)} className="w-full">
          Keep on this computer…
        </Button>
      ) : null}
    </>
  );
}

function Fact({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex gap-2.5">
      <span className="w-24 shrink-0 text-ink-3">{k}</span>
      <span className="min-w-0 font-semibold break-words text-ink">{v}</span>
    </div>
  );
}

function FileFacts({ f }: { f: DriveFile }) {
  const qc = useQueryClient();
  const [desc, setDesc] = useState(f.description ?? '');
  const saved = useRef(f.description ?? '');
  const editable = can(f.access, 'edit');
  const save = async () => {
    if (desc.trim() === saved.current.trim()) return;
    try {
      await apiPut(`/api/drive/media/${f.id}/meta`, { description: desc.trim() });
      saved.current = desc.trim();
      toast('success', 'Description saved');
      void qc.invalidateQueries({ queryKey: ['files', 'list'] });
    } catch (e) {
      toast('error', errorMessage(e));
    }
  };
  return (
    <>
      <Fact k="Type" v={`${(f.extension ?? '').toUpperCase() || 'File'}${f.kind && f.kind !== 'other' ? ` · ${f.kind}` : ''}`} />
      <Fact k="Size" v={bytes(f.size)} />
      <Fact k="Location" v={f.folder_path ? `My Drive › ${f.folder_path.replace(/\//g, ' › ')}` : f.folder_name || 'My Drive'} />
      <Fact k="Owner" v={f.access?.owner ? 'You' : (f.owner_name ?? '—')} />
      <Fact k="Modified" v={stamp(f.updated_at)} />
      <Fact k="Created" v={stamp(f.created_at)} />
      {f.version ? <Fact k="Version" v={String(f.version)} /> : null}
      {f.downloads ? <Fact k="Downloads" v={f.downloads.toLocaleString()} /> : null}
      <Fact k="Your access" v={f.access?.owner ? 'Owner' : (LEVEL[f.access?.level ?? ''] ?? '—')} />
      <HereFacts kind="file" id={f.id} context={f.folder_id} />
      <label className="flex flex-col gap-1 text-ink-3">
        Description
        <textarea value={desc} disabled={!editable} maxLength={1000} onChange={(e) => setDesc(e.target.value)} onBlur={() => void save()} aria-label="Description" placeholder={editable ? 'What is this file?' : 'No description'} className="h-[52px] resize-none rounded-[8px] border border-line bg-surface p-2 text-ink outline-none focus:border-primary disabled:bg-ground" />
      </label>
    </>
  );
}

function FolderFacts({ f }: { f: DriveFolder }) {
  const [desc, setDesc] = useState(f.description ?? '');
  const saved = useRef(f.description ?? '');
  const editable = can(f.access, 'edit');
  const save = async () => {
    if (desc.trim() === saved.current.trim()) return;
    try {
      await apiPut(`/api/drive/folders/${f.id}`, { description: desc.trim() });
      saved.current = desc.trim();
      toast('success', 'Description saved');
    } catch (e) {
      toast('error', errorMessage(e));
    }
  };
  return (
    <>
      <Fact k="Contains" v={`${f.file_count.toLocaleString()} ${f.file_count === 1 ? 'file' : 'files'}`} />
      <Fact k="Size" v={f.total_size ? bytes(f.total_size) : '—'} />
      <Fact k="Location" v={f.path ? `My Drive › ${f.path.replace(/\//g, ' › ')}` : 'My Drive'} />
      <Fact k="Owner" v={f.access?.owner ? 'You' : (f.owner_name ?? '—')} />
      <Fact k="Password lock" v={f.is_locked ? 'On' : 'Off'} />
      <Fact k="Your access" v={f.access?.owner ? 'Owner' : (LEVEL[f.access?.level ?? ''] ?? '—')} />
      <HereFacts kind="folder" id={f.id} context={f.parent_id} folder={f} />
      <label className="flex flex-col gap-1 text-ink-3">
        Description
        <textarea value={desc} disabled={!editable} maxLength={400} onChange={(e) => setDesc(e.target.value)} onBlur={() => void save()} aria-label="Description" placeholder={editable ? 'What is kept here?' : 'No description'} className="h-[52px] resize-none rounded-[8px] border border-line bg-surface p-2 text-ink outline-none focus:border-primary disabled:bg-ground" />
      </label>
    </>
  );
}

interface LinkRow {
  id: number;
  entity_type: string;
  type_label: string;
  entity_id: number;
  title: string;
  detail: string | null;
  link: string | null;
}

/** Records the file is linked to (a project, a deal…), and linking another. */
function Records({ type, id }: { type: string; id: number }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['files', 'links', type, id], queryFn: ({ signal }) => apiGet<{ links: LinkRow[]; hidden: number; may_link: boolean }>(`/api/drive/links/${type}/${id}`, undefined, signal) });
  const [searching, setSearching] = useState(false);
  const [term, setTerm] = useState('');
  const found = useQuery({
    queryKey: ['files', 'records', term.trim()],
    queryFn: ({ signal }) => apiGet<{ groups: Array<{ type: string; label: string; records: Array<{ id: number; title: string; detail: string | null }> }> }>('/api/drive/records/search', { q: term.trim() }, signal),
    enabled: searching && term.trim().length >= 2,
  });
  const refresh = () => void qc.invalidateQueries({ queryKey: ['files', 'links', type, id] });
  const add = async (entityType: string, entityId: number) => {
    try {
      await apiPost(`/api/drive/links/${type}/${id}`, { entity_type: entityType, entity_id: entityId });
      setSearching(false);
      setTerm('');
      refresh();
    } catch (e) {
      toast('error', errorMessage(e));
    }
  };
  const remove = async (linkId: number) => {
    try {
      await apiDelete(`/api/drive/links/${type}/${id}/${linkId}`);
      refresh();
    } catch (e) {
      toast('error', errorMessage(e));
    }
  };
  const links = q.data?.links ?? [];
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-ink-3">Linked records</span>
      {links.map((l) => (
        <span key={l.id} className="flex items-center gap-2 rounded-[8px] border border-line px-2.5 py-2">
          <b className="min-w-0 flex-1 truncate text-ink">{l.type_label} · {l.title}</b>
          {q.data?.may_link ? (
            <button type="button" aria-label={`Unlink ${l.title}`} onClick={() => void remove(l.id)} className="text-ink-3 hover:text-danger"><Icon name="x" size={13} /></button>
          ) : null}
        </span>
      ))}
      {!links.length && q.isSuccess ? <span className="text-ink-3">None{q.data.hidden ? ` you can see (${q.data.hidden} hidden)` : ''}.</span> : null}
      {q.data?.may_link ? (
        searching ? (
          <div className="flex flex-col gap-1">
            <input autoFocus value={term} onChange={(e) => setTerm(e.target.value)} onKeyDown={(e) => e.key === 'Escape' && setSearching(false)} aria-label="Find a record" placeholder="Find a record…" className="h-8 rounded-[7px] border border-line bg-surface px-2 text-ink outline-none focus:border-primary" />
            {(found.data?.groups ?? []).flatMap((g) =>
              (g.records ?? []).slice(0, 5).map((r) => (
                <button key={`${g.type}:${r.id}`} type="button" onClick={() => void add(g.type, r.id)} className="flex items-center gap-2 rounded-[7px] px-2 py-1.5 text-left hover:bg-ground">
                  <span className="text-[11px] text-ink-3">{g.label}</span>
                  <span className="truncate font-semibold text-ink">{r.title}</span>
                </button>
              )),
            )}
          </div>
        ) : (
          <button type="button" onClick={() => setSearching(true)} className="self-start font-semibold text-primary hover:underline">+ Link a record</button>
        )
      ) : null}
    </div>
  );
}

type Topic = 'changes' | 'comments' | 'mentions' | 'versions';
const TOPICS: Array<[Topic, string]> = [
  ['versions', 'New versions'],
  ['comments', 'New comments'],
  ['mentions', 'Mentions and replies to me'],
  ['changes', 'Other changes'],
];

/** Which changes to this file or folder you hear about. */
function Notify({ type, id }: { type: string; id: number }) {
  const qc = useQueryClient();
  const key = ['files', 'notify', type, id];
  const q = useQuery({ queryKey: key, queryFn: ({ signal }) => apiGet<{ topics: Record<Topic, { on: boolean }> }>(`/api/drive/notify/${type}/${id}`, undefined, signal) });
  const set = async (t: Topic, on: boolean) => {
    try {
      await apiPut(`/api/drive/notify/${type}/${id}`, { topics: { [t]: on } });
      void qc.invalidateQueries({ queryKey: key });
    } catch (e) {
      toast('error', errorMessage(e));
    }
  };
  if (!q.data) return null;
  return (
    <div className="flex flex-col gap-1.5 border-t border-line pt-2">
      <span className="text-ink-3">Notify me about</span>
      {TOPICS.map(([t, l]) => (
        <label key={t} className="flex items-center gap-2 text-ink">
          <Checkbox checked={!!q.data.topics?.[t]?.on} onChange={(e) => void set(t, e.target.checked)} />
          {l}
        </label>
      ))}
    </div>
  );
}

interface ActivityRow {
  id: number;
  action: string;
  kind: 'content' | 'views' | 'access' | 'record';
  summary: string;
  actor: { id: number; name: string } | null;
  at: string;
}
const FILTERS: Array<[string, string]> = [
  ['all', 'All'],
  ['content', 'Changes'],
  ['comments', 'Comments'],
  ['access', 'Sharing'],
  ['record', 'Linked records'],
  ['views', 'Views'],
];

function Activity({ type, id }: { type: string; id: number }) {
  const [filter, setFilter] = useState('all');
  const q = useQuery({ queryKey: ['files', 'activity', type, id], queryFn: ({ signal }) => apiGet<{ activity: ActivityRow[]; more: boolean }>(`/api/drive/activity/${type}/${id}`, undefined, signal) });
  const rows = (q.data?.activity ?? []).filter((a) => filter === 'all' || (filter === 'comments' ? a.action.includes('comment') : a.kind === filter && !(filter === 'content' && a.action.includes('comment'))));
  return (
    <>
      <div className="flex flex-wrap gap-[5px]">
        {FILTERS.map(([k, l]) => (
          <button key={k} type="button" aria-pressed={filter === k} onClick={() => setFilter(k)} className={cx('rounded-xl px-[9px] py-[3px] font-semibold', filter === k ? 'bg-ink text-surface' : 'border border-line text-ink hover:bg-subtle')}>
            {l}
          </button>
        ))}
      </div>
      {q.isLoading ? <Spinner /> : null}
      {q.error ? <ErrorNote error={q.error} /> : null}
      {rows.map((a) => (
        <div key={a.id} className="flex gap-2.5 border-b border-line/70 py-2">
          <span className="flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-full bg-selection text-[10.5px] font-bold text-primary">{initials(a.actor?.name)}</span>
          <span className="flex flex-col gap-0.5">
            <span className="text-ink">
              <b>{a.actor?.name ?? 'Someone'}</b> {a.summary}
            </span>
            <span className="text-[11.5px] text-ink-3">{listStamp(a.at)}</span>
          </span>
        </div>
      ))}
      {q.isSuccess && !rows.length ? <span className="py-4 text-center text-ink-3">Nothing yet.</span> : null}
      {q.data?.more ? <span className="text-ink-3">The latest 100 are shown.</span> : null}
    </>
  );
}

interface CommentRow {
  id: number;
  parent_id: number | null;
  author: { id: number; name: string } | null;
  body: string;
  at: string;
  edited_at: string | null;
  removed: boolean;
  reactions: Array<{ emoji: string; count: number; mine: boolean }>;
  can: { edit: boolean; remove: boolean };
  resolved?: { at: string; by: string } | null;
  replies?: CommentRow[];
}

/** The conversation about a file: comment, reply, resolve, edit or remove your own. */
function Comments({ type, id }: { type: string; id: number }) {
  const qc = useQueryClient();
  const key = ['files', 'comments', type, id];
  const q = useQuery({ queryKey: key, queryFn: ({ signal }) => apiGet<{ comments: CommentRow[]; can: { comment: boolean; moderate: boolean; resolve: boolean; react: boolean } }>(`/api/drive/comments/${type}/${id}`, undefined, signal) });
  const [text, setText] = useState('');
  const [reply, setReply] = useState<number | null>(null);
  const [editing, setEditing] = useState<{ id: number; body: string } | null>(null);
  const refresh = () => void qc.invalidateQueries({ queryKey: key });
  const send = async () => {
    if (!text.trim()) return;
    try {
      await apiPost(`/api/drive/comments/${type}/${id}`, { body: text.trim(), mentions: [], ...(reply ? { parent_id: reply } : {}) });
      setText('');
      setReply(null);
      refresh();
    } catch (e) {
      toast('error', errorMessage(e));
    }
  };
  const act = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
      refresh();
    } catch (e) {
      toast('error', errorMessage(e));
    }
  };
  const one = (c: CommentRow, reply = false) => (
    <div key={c.id} className={cx('flex flex-col gap-1.5 rounded-[9px] bg-ground p-2.5', reply && 'ml-[18px]', c.resolved && 'opacity-70')}>
      <span>
        <b className="text-ink">{c.author?.name ?? 'Someone'}</b> <span className="text-ink-3">· {listStamp(c.at)}{c.edited_at ? ' · edited' : ''}</span>
        {c.resolved ? <span className="ml-1.5 rounded-lg bg-success-bg px-1.5 text-[10.5px] font-bold text-success">Resolved</span> : null}
      </span>
      {editing?.id === c.id ? (
        <div className="flex flex-col gap-1">
          <textarea autoFocus value={editing.body} maxLength={4000} onChange={(e) => setEditing({ ...editing, body: e.target.value })} aria-label="Comment" className="h-16 resize-none rounded-[7px] border border-line bg-surface p-2 text-ink outline-none focus:border-primary" />
          <div className="flex justify-end gap-1.5">
            <Button size="sm" onClick={() => setEditing(null)}>Cancel</Button>
            <Button size="sm" variant="primary" onClick={() => void act(() => apiPut(`/api/drive/comments/${type}/${id}/${c.id}`, { body: editing.body.trim(), mentions: [] })).then(() => setEditing(null))}>Save</Button>
          </div>
        </div>
      ) : (
        <span className={cx('whitespace-pre-wrap text-ink', c.removed && 'italic text-ink-3')}>{c.removed ? 'This comment was removed.' : c.body}</span>
      )}
      {!c.removed ? (
        <span className="flex flex-wrap gap-2.5 font-semibold">
          {c.reactions.map((r) => (
            <button key={r.emoji} type="button" onClick={() => void act(() => apiPost(`/api/drive/comments/${type}/${id}/${c.id}/reactions`, { emoji: r.emoji }))} className={cx('rounded-lg px-1.5', r.mine ? 'bg-selection text-primary' : 'bg-surface text-ink-2')}>
              {r.emoji} {r.count}
            </button>
          ))}
          {q.data?.can.react ? <button type="button" onClick={() => void act(() => apiPost(`/api/drive/comments/${type}/${id}/${c.id}/reactions`, { emoji: '👍' }))} className="text-primary hover:underline">👍</button> : null}
          {!reply && q.data?.can.comment ? <button type="button" onClick={() => setReply(c.id)} className="text-primary hover:underline">Reply</button> : null}
          {!reply && c.resolved !== undefined && q.data?.can.resolve ? <button type="button" onClick={() => void act(() => apiPut(`/api/drive/comments/${type}/${id}/${c.id}/resolved`, { resolved: !c.resolved }))} className="text-primary hover:underline">{c.resolved ? 'Reopen' : 'Resolve'}</button> : null}
          {c.can.edit ? <button type="button" onClick={() => setEditing({ id: c.id, body: c.body })} className="text-primary hover:underline">Edit</button> : null}
          {c.can.remove ? <button type="button" onClick={() => void act(() => apiDelete(`/api/drive/comments/${type}/${id}/${c.id}`))} className="text-danger hover:underline">Remove</button> : null}
        </span>
      ) : null}
    </div>
  );
  return (
    <>
      {q.isLoading ? <Spinner /> : null}
      {q.error ? <ErrorNote error={q.error} /> : null}
      {(q.data?.comments ?? []).map((c) => (
        <div key={c.id} className="flex flex-col gap-1.5">
          {one(c)}
          {(c.replies ?? []).map((r) => one(r, true))}
        </div>
      ))}
      {q.isSuccess && !q.data.comments.length ? <span className="py-2 text-ink-3">No comments yet.</span> : null}
      {q.data?.can.comment ? (
        <>
          {reply ? (
            <span className="flex items-center gap-1.5 text-ink-3">
              Replying to {q.data.comments.find((c) => c.id === reply)?.author?.name ?? 'a comment'}
              <button type="button" onClick={() => setReply(null)} className="text-primary hover:underline">Cancel</button>
            </span>
          ) : null}
          <textarea
            value={text}
            maxLength={4000}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                void send();
              }
            }}
            aria-label="Add a comment"
            placeholder="Add a comment"
            className="h-16 resize-none rounded-[8px] border border-line bg-surface p-2 text-ink outline-none focus:border-primary"
          />
          <button type="button" disabled={!text.trim()} onClick={() => void send()} className="h-[30px] self-end rounded-[7px] bg-primary px-3 font-bold text-white disabled:opacity-50">Comment</button>
        </>
      ) : q.isSuccess ? (
        <span className="text-ink-3">You can read the comments; commenting needs edit access.</span>
      ) : null}
    </>
  );
}

interface VersionList {
  current: { version: number; size: number; updated_at: string };
  history: Array<{ id: number; version: number; size: number; note: string | null; created_at: string }>;
}

/** Every saved version; restore one, download one, or upload a new one. */
function Versions({ f }: { f: DriveFile }) {
  const qc = useQueryClient();
  const d = useDrive();
  const key = ['files', 'versions', f.id];
  const q = useQuery({ queryKey: key, queryFn: ({ signal }) => apiGet<VersionList>(`/api/files/${f.id}/versions`, undefined, signal) });
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: key });
    d.refresh();
  };
  const restore = async (v: number, rowId: number) => {
    try {
      await apiPost(`/api/files/${f.id}/versions/${rowId}/restore`);
      toast('success', `Version ${v} restored. What was there is kept as a version.`);
      refresh();
    } catch (e) {
      toast('error', errorMessage(e));
    }
  };
  const upload = async (file: File | undefined) => {
    if (!file) return;
    if (file.size > 24 * 1024 * 1024) return toast('error', 'A new version can be up to 24 MB here. Upload a larger one on the web.');
    setBusy(true);
    try {
      const form = new FormData();
      form.append('file', file, file.name);
      await request('POST', `/api/files/${f.id}/versions`, { body: form });
      toast('success', 'New version uploaded');
      refresh();
    } catch (e) {
      toast('error', errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const download = async (rowId: number, v: number) => {
    try {
      const ext = f.name.includes('.') ? f.name.slice(f.name.lastIndexOf('.')) : '';
      await call('transfers:download', { version: { fileId: f.id, versionId: rowId }, name: `${f.name.replace(/\.[^.]+$/, '')}-v${v}${ext}` });
      toast('info', 'Downloading that version…');
    } catch (e) {
      toast('error', errorMessage(e));
    }
  };
  return (
    <>
      {q.isLoading ? <Spinner /> : null}
      {q.error ? <ErrorNote error={q.error} /> : null}
      {q.data ? (
        <>
          <div className="flex items-center gap-2.5 rounded-[9px] border border-line px-2.5 py-2">
            <span className="flex flex-1 flex-col gap-0.5">
              <b className="text-ink">Version {q.data.current.version}</b>
              <span className="text-[11.5px] text-ink-3">{stamp(q.data.current.updated_at)} · {bytes(q.data.current.size)}</span>
            </span>
            <span className="rounded-[10px] bg-success-bg px-2 py-0.5 text-[11px] font-bold text-success">Current</span>
          </div>
          {q.data.history.map((v) => (
            <div key={v.id} className="flex items-center gap-2 rounded-[9px] border border-line px-2.5 py-2">
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <b className="text-ink">Version {v.version}</b>
                <span className="truncate text-[11.5px] text-ink-3">{stamp(v.created_at)} · {bytes(v.size)}{v.note ? ` · ${v.note}` : ''}</span>
              </span>
              {can(f.access, 'download') ? <button type="button" aria-label={`Download version ${v.version}`} onClick={() => void download(v.id, v.version)} className="flex h-7 w-7 items-center justify-center rounded-[7px] text-ink-2 hover:bg-subtle"><Icon name="download" size={14} /></button> : null}
              {can(f.access, 'edit') ? <button type="button" onClick={() => void restore(v.version, v.id)} className="h-7 rounded-[7px] border border-line px-2.5 text-[12px] font-semibold text-ink hover:bg-subtle">Restore</button> : null}
            </div>
          ))}
          {!q.data.history.length ? <span className="text-ink-3">No earlier versions.</span> : null}
        </>
      ) : null}
      {can(f.access, 'upload_version') ? (
        <>
          <button type="button" disabled={busy} onClick={() => input.current?.click()} className="h-[34px] rounded-[8px] border border-dashed border-line font-semibold text-primary hover:bg-ground disabled:opacity-50">
            {busy ? 'Uploading…' : 'Upload new version'}
          </button>
          <input ref={input} type="file" hidden aria-label="New version" onChange={(e) => (void upload(e.target.files?.[0]), (e.target.value = ''))} />
        </>
      ) : null}
    </>
  );
}

interface AccessInfo {
  item: { owner: { id: number; name: string; detail: string | null } | null; company: { id: number; name: string } | null; inherits: boolean };
  my_access: ItemAccess;
  may: { share: boolean; manage: boolean };
  grants: Array<{ id: number; principal: { type: string; id: number; name: string; detail: string | null }; level: string; effect: string; can_download: boolean }> | null;
  inherited: Array<{ id: number | null; from: { id: number; name: string }; principal: { type: string; name: string }; level: string; effect: string }> | null;
}

/** Who can open it, and how; changing that is Share. */
function Access({ item }: { item: Item }) {
  const d = useDrive();
  const q = useQuery({ queryKey: ['files', 'access', item.type, item.f.id], queryFn: ({ signal }) => apiGet<AccessInfo>(`/api/drive/access/${item.type}/${item.f.id}`, undefined, signal) });
  const a = q.data;
  const person = (name: string, via: string, level: string) => (
    <div key={`${name}${via}`} className="flex items-center gap-2.5">
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#E3F4F5] text-[10.5px] font-bold text-[#0B6770] dark:bg-subtle dark:text-[#5CC6CF]">{initials(name)}</span>
      <span className="flex min-w-0 flex-1 flex-col">
        <b className="truncate text-ink">{name}</b>
        <span className="text-[11.5px] text-ink-3">{via}</span>
      </span>
      <span className="font-semibold text-ink-2">{level}</span>
    </div>
  );
  return (
    <>
      {q.isLoading ? <Spinner /> : null}
      {q.error ? <ErrorNote error={q.error} /> : null}
      {a ? (
        <>
          <span className="text-[11px] font-bold tracking-[0.5px] text-ink-2">PEOPLE WITH ACCESS</span>
          {a.item.owner ? person(a.item.owner.name, 'Owner', 'Owner') : null}
          {(a.grants ?? []).map((g) => person(g.principal.name, `${g.principal.type === 'user' ? 'Shared directly' : g.principal.detail ?? g.principal.type}${g.can_download ? '' : ' · No download'}`, g.effect === 'deny' ? 'Refused' : (LEVEL[g.level] ?? g.level)))}
          {(a.inherited ?? []).map((g, i) => (
            <div key={`i${i}`}>{person(g.principal.name, `From folder “${g.from.name}”`, g.effect === 'deny' ? 'Refused' : (LEVEL[g.level] ?? g.level))}</div>
          ))}
          {!a.grants ? <span className="text-ink-3">Your access: {a.my_access.owner ? 'Owner' : (LEVEL[a.my_access.level ?? ''] ?? '—')}. Only people who may share it see everyone.</span> : null}
          {a.may.share ? <button type="button" onClick={() => d.share(item)} className="self-start font-bold text-primary hover:underline">Manage access…</button> : null}
        </>
      ) : null}
    </>
  );
}
