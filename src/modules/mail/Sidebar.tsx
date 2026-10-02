import { useState, type CSSProperties, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { apiPost } from '../../core/api';
import { errorMessage } from '../../core/bridge';
import { text } from '../../core/i18n';
import { toast } from '../../core/toasts';
import { Icon } from '../../components/Icon';
import { Button, DATA_TEXT, Kbd, Modal, Spinner, TextField, cx } from '../../components/ui';
import { mailKeys, useFolders, useLabels } from './api';
import { SMART_VIEWS, agoShort, folderName, mailboxLetter, type SmartViewId } from './model';
import { AccountAvatar, Count, SectionHeading } from './parts';
import type { Folder, Mailbox, SyncStatus, ViewCounts } from './types';

/** Where the list is: the combined inbox, a smart view, or a folder of one mailbox. */
export interface Place {
  box: string;
  view: SmartViewId | null;
  folder: string;
  label: number | null;
}

export interface SidebarProps {
  boxes: Mailbox[];
  loading: boolean;
  counts: ViewCounts | null;
  place: Place;
  /** The mailbox whose folders are listed. */
  folderBox: Mailbox | null;
  /** Labels are kept in WorkSuite's own store; they are offered where that store is the mail. */
  showLabels: boolean;
  active: boolean;
  sync: SyncStatus | null;
  offline: boolean;
  pending: number;
  cacheDays: number;
  onCompose: () => void;
  onSearch: () => void;
  onAddMailbox: () => void;
  onPick: (p: Partial<Place>) => void;
  /** Settings › Mail: accounts, offline and storage. */
  onSettings: () => void;
}

const FOLDER_ICON: Record<string, string> = { inbox: 'inbox', sent: 'send', drafts: 'file-text', archive: 'archive', spam: 'shield-alert', junk: 'shield-alert', trash: 'trash' };

/** A mailbox's name in the sidebar: its address, or its own name and provider when it has one. */
export function mailboxName(b: Mailbox): string {
  if (b.shared) return text('{email} · shared', { email: b.email });
  const local = b.email.split('@')[0] ?? '';
  if (b.display_name && b.display_name !== local && b.display_name !== b.email && b.provider_label) return `${b.display_name} · ${b.provider_label}`;
  return b.email;
}

/** A mailbox's unread count: the mirror's when it counted it, else the local store's. */
export function unreadOf(b: Mailbox, counts: ViewCounts | null): number | null {
  const c = counts?.mailboxes.find((m) => m.id === b.id);
  if (c?.counted) return c.unread;
  return b.unread;
}

export function MailSidebar(p: SidebarProps) {
  const [open, setOpen] = useState({ mailboxes: true, views: true, folders: true, labels: true });
  const toggle = (k: keyof typeof open) => setOpen((o) => ({ ...o, [k]: !o[k] }));
  const [naming, setNaming] = useState<'folder' | 'label' | null>(null);
  const unifiedUnread = p.boxes.filter((b) => b.in_unified !== false).reduce((n, b) => n + (unreadOf(b, p.counts) ?? 0), 0);
  const isUnified = p.place.box === 'unified' && !p.place.view && p.place.folder === 'inbox' && p.place.label === null;
  const views = SMART_VIEWS.filter((v) => v.id !== 'important' || (p.counts?.views.important ?? null) !== null);
  return (
    <nav aria-label="Mail" className="flex w-[260px] shrink-0 flex-col border-r border-line bg-surface">
      <div className="flex gap-2 p-3 pb-1">
        <Button data-guide="mail.compose" variant="accent" size="action-lg" icon="compose" className="flex-1" onClick={p.onCompose} title={text('New email (N)')} aria-keyshortcuts="N">
          <span className="min-w-0 flex-1 text-left">{text('New email')}</span>
          <Kbd tone="accent" aria-hidden>
            N
          </Kbd>
        </Button>
        <Button variant="glass" size="action-icon" icon="search" onClick={p.onSearch} aria-label={text('Search mail')} title={text('Search mail (/)')} />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2 scroll-thin">
        <SectionHeading label={text('Mailboxes')} open={open.mailboxes} onToggle={() => toggle('mailboxes')} onAdd={p.onAddMailbox} addLabel={text('Add a mailbox')} />
        {open.mailboxes ? (
          <ul role="list">
            {p.boxes.length > 1 ? (
              <li>
                <Row icon="inbox" label={text('Unified inbox')} count={unifiedUnread} strong active={isUnified} onClick={() => p.onPick({ box: 'unified', view: null, folder: 'inbox', label: null })} />
              </li>
            ) : null}
            {p.loading ? <Spinner label="" className="p-2" /> : null}
            {p.boxes.map((b) => {
              const n = unreadOf(b, p.counts);
              return (
                <li key={b.id}>
                  <Row
                    nested={p.boxes.length > 1}
                    lead={<AccountAvatar letter={mailboxLetter(b)} colour={b.colour} size={18} />}
                    label={mailboxName(b)}
                    title={b.auth_state === 'problem' ? text('{email} · sign-in problem — open Accounts to repair', { email: b.email }) : b.email}
                    warn={b.auth_state === 'problem'}
                    count={n}
                    strong={!!n}
                    active={p.place.box === String(b.id) && !p.place.view && p.place.folder === 'inbox'}
                    onClick={() => p.onPick({ box: String(b.id), view: null, folder: 'inbox', label: null })}
                  />
                </li>
              );
            })}
            {!p.loading && p.boxes.length === 0 ? (
              <li className="px-2 py-1.5 text-[12.5px] text-ink-3">
                No mailbox yet.{' '}
                <button type="button" className="font-semibold text-primary underline" onClick={p.onAddMailbox}>
                  Add a mailbox
                </button>
              </li>
            ) : null}
          </ul>
        ) : null}

        <SectionHeading label={text('Smart views')} open={open.views} onToggle={() => toggle('views')} />
        {open.views ? (
          <ul role="list">
            {views.map((v) => {
              const n = p.counts ? (p.counts.views[v.id] ?? null) : null;
              // Today and Has attachments are lists, not badges: a count beside them is noise.
              const shown = v.id === 'today' || v.id === 'attachments' ? null : n;
              return (
                <li key={v.id}>
                  <Row icon={v.icon} iconClass={v.id === 'starred' ? 'text-warning' : v.id === 'important' ? 'text-danger' : undefined} label={v.label} count={shown} active={p.place.view === v.id} onClick={() => p.onPick({ box: 'unified', view: v.id, folder: v.folder, label: null })} />
                </li>
              );
            })}
          </ul>
        ) : null}

        {p.folderBox ? <FolderSection box={p.folderBox} many={p.boxes.length > 1} open={open.folders} onToggle={() => toggle('folders')} onAdd={() => setNaming('folder')} place={p.place} active={p.active} onPick={p.onPick} /> : null}

        {p.showLabels ? <LabelSection open={open.labels} onToggle={() => toggle('labels')} onAdd={() => setNaming('label')} place={p.place} active={p.active} onPick={p.onPick} /> : null}
      </div>
      <button type="button" onClick={p.onSettings} title={text('Mail accounts, offline and storage settings')} className="block text-left">
        <SyncCard sync={p.sync} boxes={p.boxes} offline={p.offline} pending={p.pending} cacheDays={p.cacheDays} />
      </button>
      {naming ? <NameDialog kind={naming} mailbox={p.folderBox} onClose={() => setNaming(null)} /> : null}
    </nav>
  );
}

function Row({ icon, iconClass, lead, label, title, count, strong, active, nested, warn, onClick }: { icon?: string; iconClass?: string; lead?: ReactNode; label: string; title?: string; count?: number | null; strong?: boolean; active: boolean; nested?: boolean; warn?: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title ?? label}
      aria-current={active ? 'page' : undefined}
      className={cx(
        'relative flex h-[30px] w-full items-center gap-2.5 rounded-[8px] pr-1.5 text-left text-[13.5px]',
        nested ? 'pl-6' : 'pl-2.5',
        active ? 'bg-selection font-semibold text-primary before:absolute before:-left-2 before:top-1 before:bottom-1 before:w-[3px] before:rounded-full before:bg-primary' : 'text-ink hover:bg-subtle',
        strong && !active && 'font-semibold',
      )}
    >
      {lead ?? (icon ? <Icon name={icon} size={16} className={cx('shrink-0', iconClass ?? (active ? 'text-primary' : 'text-ink-2'))} /> : null)}
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {warn ? <Icon name="warning" size={14} className="shrink-0 text-danger" label="Sign-in problem" /> : null}
      <Count n={count} strong={strong} active={active} />
    </button>
  );
}

function FolderSection({ box, many, open, onToggle, onAdd, place, active, onPick }: { box: Mailbox; many: boolean; open: boolean; onToggle: () => void; onAdd: () => void; place: Place; active: boolean; onPick: (p: Partial<Place>) => void }) {
  const folders = useFolders(box.id, active);
  const list = (folders.data?.folders ?? []).filter((f) => f.slug !== 'starred' && f.slug !== 'important');
  // A mailbox's inbox is its row under Mailboxes when there are several: one place, one highlight.
  const here = (f: Folder) => !place.view && place.label === null && place.folder === f.slug && !(many && f.slug === 'inbox') && (place.box === String(box.id) || (place.box === 'unified' && !many));
  return (
    <>
      <SectionHeading label={many ? text('Folders · {email}', { email: box.email }) : text('Folders')} open={open} onToggle={onToggle} onAdd={onAdd} addLabel={text('New folder')} />
      {open ? (
        <ul role="list">
          {folders.isLoading ? <Spinner label="" className="p-2" /> : null}
          {folders.error ? <li className="px-2 text-[12px] text-danger">{errorMessage(folders.error)}</li> : null}
          {list.map((f) => {
            const custom = !FOLDER_ICON[f.slug];
            // Unread in the folders mail arrives in; Sent, Drafts and Trash count nothing worth a badge.
            const n = ['sent', 'trash', 'drafts'].includes(f.slug) ? null : f.unread;
            return (
              <li key={f.slug}>
                <Row icon={FOLDER_ICON[f.slug] ?? 'folder'} iconClass={custom ? 'text-warning' : undefined} label={custom ? folderName(f.name) : f.name} count={n} strong={!!n} active={here(f)} onClick={() => onPick({ box: String(box.id), view: null, folder: f.slug, label: null })} />
              </li>
            );
          })}
        </ul>
      ) : null}
    </>
  );
}

function LabelSection({ open, onToggle, onAdd, place, active, onPick }: { open: boolean; onToggle: () => void; onAdd: () => void; place: Place; active: boolean; onPick: (p: Partial<Place>) => void }) {
  const labels = useLabels(active);
  const list = (labels.data?.labels ?? []).filter((l) => !l.is_hidden);
  if (!labels.isLoading && list.length === 0 && !labels.error) {
    return <SectionHeading label={text('Labels')} open={false} onToggle={onToggle} onAdd={onAdd} addLabel={text('New label')} />;
  }
  return (
    <>
      <SectionHeading label={text('Labels')} open={open} onToggle={onToggle} onAdd={onAdd} addLabel={text('New label')} />
      {open ? (
        <ul role="list">
          {list.map((l) => (
            <li key={l.id}>
              <Row
                lead={
                  <span className={cx('inline-flex shrink-0', DATA_TEXT)} style={{ '--c': l.color || 'var(--ws-ink-3)' } as CSSProperties}>
                    <Icon name="tag" size={16} />
                  </span>
                }
                label={l.name}
                count={l.messages ?? null}
                active={place.label === l.id}
                onClick={() => onPick({ box: 'unified', view: null, folder: `label:${l.id}`, label: l.id })}
              />
            </li>
          ))}
        </ul>
      ) : null}
    </>
  );
}

/** "All mailboxes synced · 12 s ago" — or offline, with what is waiting. */
export function SyncCard({ sync, boxes, offline, pending, cacheDays }: { sync: SyncStatus | null; boxes: Mailbox[]; offline: boolean; pending: number; cacheDays: number }) {
  const cache = cacheDays === 0 ? text('headers only offline') : text('offline cache {n} days', { n: cacheDays });
  if (offline) {
    return (
      <span role="status" className="m-2 mt-0 flex items-start gap-2.5 rounded-[10px] border border-line bg-surface p-2.5 text-[12px] leading-snug hover:bg-subtle">
        <span className="mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-[6px] bg-warning-bg text-warning">
          <Icon name="warning" size={14} />
        </span>
        <span className="min-w-0">
          <span className="block font-semibold text-warning">{pending ? text('Offline · {n} actions waiting', { n: pending }) : text('Offline')}</span>
          <span className="block truncate text-ink-3">Showing mail saved on this computer</span>
        </span>
      </span>
    );
  }
  const live = sync?.enabled ? sync.mailboxes : [];
  const problem = boxes.some((b) => b.auth_state === 'problem') || live.some((m) => m.problem);
  const lag = live.length ? Math.max(...live.map((m) => m.lag_seconds ?? 0)) : null;
  const pushed = live.length > 0 && live.every((m) => m.pushed);
  const head = problem ? text('A mailbox needs attention') : live.length ? text('All mailboxes synced') : text('Mail is checked on a schedule');
  const ago = agoShort(lag);
  return (
    <span role="status" className="m-2 mt-0 flex items-start gap-2.5 rounded-[10px] border border-line bg-surface p-2.5 text-[12px] leading-snug hover:bg-subtle">
      <span className={cx('mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-[6px]', problem ? 'bg-danger-bg text-danger' : 'bg-success-bg text-success')}>
        <Icon name={problem ? 'warning' : 'check'} size={14} />
      </span>
      <span className="min-w-0">
        <span className={cx('block truncate font-semibold', problem ? 'text-danger' : 'text-success')}>{ago && !problem ? `${head} · ${ago}` : head}</span>
        <span className="block truncate text-ink-3" title={cache}>
          {live.length ? (pushed ? text('Pushed (IDLE) · {cache}', { cache }) : text('Checked regularly · {cache}', { cache })) : cache}
        </span>
      </span>
    </span>
  );
}

/** A new folder (in the mailbox listed) or a new label. */
function NameDialog({ kind, mailbox, onClose }: { kind: 'folder' | 'label'; mailbox: Mailbox | null; onClose: () => void }) {
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      if (kind === 'folder') await apiPost('/api/mail/folders-tree', { name: name.trim(), ...(mailbox ? { mailbox: mailbox.id } : {}) });
      else await apiPost('/api/mail/labels', { name: name.trim() });
      void qc.invalidateQueries({ queryKey: kind === 'folder' ? ['mail', 'folders'] : mailKeys.labels });
      toast('success', kind === 'folder' ? 'Folder created.' : 'Label created.');
      onClose();
    } catch (e) {
      toast('error', errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title={kind === 'folder' ? text('New folder') : text('New label')}
      labelledBy="mail-name-title"
      width={420}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={busy} disabled={!name.trim()} onClick={() => void save()}>
            Create
          </Button>
        </>
      }
    >
      <form
        className="p-5"
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim()) void save();
        }}
      >
        <TextField label="Name" value={name} onChange={(e) => setName(e.target.value)} autoFocus hint={kind === 'folder' && mailbox ? text('In {email}', { email: mailbox.email }) : undefined} />
      </form>
    </Modal>
  );
}
