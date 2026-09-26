import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { ApiError, apiGet } from '../../../core/api';
import { addDays, dateLabel, relative, todayInZone } from '../../../core/time';
import { Icon } from '../../../components/Icon';
import { Button, Modal, Spinner, cx } from '../../../components/ui';
import { KIND, type CardKind } from './CardFrame';
import { pathOf, type RecordRef } from './recordLinks';
import { RecordCard } from './RecordCards';

/**
 * Share from WorkSuite (ChatSharePicker): pick a record of your own — a
 * task, a note, a meeting, a deal — and it goes into the conversation as its
 * address, which every reader's app turns into a card read with their own
 * access. Drive goes through its own picker, which checks first that
 * everybody here can open the file.
 */
export type ShareKind = 'drive' | 'meeting' | 'note' | 'task' | 'event' | 'crm' | 'invoice' | 'contact';

export const SHARE_KINDS: Array<{ id: ShareKind; label: string; card: CardKind }> = [
  { id: 'drive', label: 'Drive file or folder', card: 'folder' },
  { id: 'meeting', label: 'Meeting', card: 'meeting' },
  { id: 'note', label: 'Note', card: 'note' },
  { id: 'task', label: 'Task', card: 'task' },
  { id: 'event', label: 'Calendar event', card: 'event' },
  { id: 'crm', label: 'CRM deal, lead or account', card: 'deal' },
  { id: 'invoice', label: 'Invoice', card: 'invoice' },
  { id: 'contact', label: 'Contact', card: 'contact' },
];

/** The "+" menu: what can be shared, and a way back to a file from the computer. */
export function ShareMenu({ onPick, onUpload, onClose, align = 'left' }: { onPick: (k: ShareKind) => void; onUpload: () => void; onClose: () => void; align?: 'left' | 'right' }) {
  const ref = useRef<HTMLDivElement>(null);
  const [at, setAt] = useState(0);
  const count = SHARE_KINDS.length + 1;
  useEffect(() => {
    ref.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus();
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const t = setTimeout(() => window.addEventListener('mousedown', onDown), 0);
    return () => {
      clearTimeout(t);
      window.removeEventListener('mousedown', onDown);
    };
  }, [onClose]);
  const move = (n: number) => {
    const next = (at + n + count) % count;
    setAt(next);
    ref.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')[next]?.focus();
  };
  const item = 'flex w-full items-center gap-2.5 rounded-[8px] px-2 py-1.5 text-left text-[12.5px] font-semibold text-ink outline-none hover:bg-subtle focus:bg-subtle';
  return (
    <div
      ref={ref}
      role="menu"
      aria-label="Share from WorkSuite"
      onKeyDown={(e) => {
        if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp' && e.key !== 'Escape') return;
        e.preventDefault();
        e.stopPropagation();
        if (e.key === 'Escape') onClose();
        else move(e.key === 'ArrowDown' ? 1 : -1);
      }}
      className={cx('absolute bottom-full z-40 mb-2 w-[250px] rounded-[12px] border border-line bg-surface p-1.5 shadow-[0_12px_32px_rgb(var(--ws-shadow-rgb)/.18)]', align === 'right' ? 'right-0' : 'left-0')}
    >
      <div className="px-2 pt-1 pb-1.5 text-[10.5px] font-extrabold tracking-[.7px] text-ink-3">SHARE FROM WORKSUITE</div>
      {SHARE_KINDS.map((k, i) => (
        <button key={k.id} type="button" role="menuitem" tabIndex={i === at ? 0 : -1} onClick={() => onPick(k.id)} className={item}>
          <KindIcon kind={k.card} />
          {k.label}
        </button>
      ))}
      <div className="my-1 border-t border-line" />
      <button type="button" role="menuitem" tabIndex={at === SHARE_KINDS.length ? 0 : -1} onClick={onUpload} className={item}>
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[8px] bg-subtle text-ink-2">
          <Icon name="upload" size={14} />
        </span>
        Upload from computer
      </button>
    </div>
  );
}

function KindIcon({ kind, size = 28 }: { kind: CardKind; size?: number }) {
  const k = KIND[kind];
  return (
    <span className="flex shrink-0 items-center justify-center rounded-[8px] [background:var(--tl)] dark:[background:var(--td)]" style={{ width: size, height: size, color: k.acc, ['--tl' as string]: k.tintLight, ['--td' as string]: k.tint }}>
      <Icon name={k.icon} size={Math.round(size / 2)} />
    </span>
  );
}

interface Row {
  ref: RecordRef;
  title: string;
  sub: string;
}

const human = (s: string | null | undefined) => (s ? s.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase()) : '');
const join = (...parts: Array<string | null | undefined | false>) => parts.filter(Boolean).join(' · ');

/** Each kind's search, with the list endpoint its own screen uses: nothing the reader could not open there. */
async function search(kind: Exclude<ShareKind, 'drive'>, q: string, signal: AbortSignal): Promise<Row[]> {
  switch (kind) {
    case 'task': {
      const r = await apiGet<{ tasks: Array<{ id: number; title: string; task_key: string | null; status: string; due_date: string | null; assignee_name: string | null }> }>('/api/tasks', q ? { q } : { filter: 'active' }, signal);
      return (r.tasks ?? []).slice(0, 40).map((t) => ({ ref: { kind: 'task', id: t.id }, title: t.title, sub: join(t.task_key, human(t.status), t.due_date && `Due ${dateLabel(t.due_date)}`, t.assignee_name) }));
    }
    case 'note': {
      const r = await apiGet<Array<{ id: number; title: string | null; updated_at: string | null; excerpt?: string | null }>>('/api/notes', q ? { q } : undefined, signal);
      return (r ?? []).slice(0, 40).map((n) => ({ ref: { kind: 'note', id: n.id }, title: n.title || 'Untitled note', sub: join(n.updated_at && `Edited ${relative(n.updated_at)}`, n.excerpt?.slice(0, 80)) }));
    }
    case 'meeting': {
      const r = await apiGet<{ meetings: Array<{ id: number; title: string; meeting_no: string; start_at: string | null; live_status?: string | null; status: string }> }>('/api/meetings', q ? { q } : undefined, signal);
      return (r.meetings ?? []).slice(0, 40).map((m) => ({ ref: { kind: 'meeting', id: m.id }, title: m.title, sub: join(m.meeting_no, m.start_at && dateLabel(m.start_at), human(m.live_status ?? m.status)) }));
    }
    case 'event': {
      const today = todayInZone();
      const r = await apiGet<{ events: Array<{ source: string; id: number; title: string; start_at: string; location?: string | null }> }>('/api/calendar/events', { from: addDays(today, -30), to: addDays(today, 120) }, signal);
      const needle = q.toLowerCase();
      const seen = new Set<number>();
      return (r.events ?? [])
        .filter((e) => e.source === 'event' && !seen.has(e.id) && seen.add(e.id) && (!needle || `${e.title} ${e.location ?? ''}`.toLowerCase().includes(needle)))
        .slice(0, 40)
        .map((e) => ({ ref: { kind: 'event', id: e.id }, title: e.title, sub: join(dateLabel(e.start_at.slice(0, 10)), e.location) }));
    }
    case 'crm': {
      if (q.length < 2) return [];
      const r = await apiGet<{ results: Array<{ type: string; id: number; title: string; subtitle: string | null; meta: string | null }> }>('/api/crm/search', { q }, signal);
      return (r.results ?? [])
        .filter((x) => x.type === 'deal' || x.type === 'lead' || x.type === 'account')
        .map((x) => ({ ref: { kind: x.type as 'deal' | 'lead' | 'account', id: x.id }, title: x.title, sub: join(human(x.type), x.subtitle, x.meta) }));
    }
    case 'invoice': {
      const r = await apiGet<{ invoices: Array<{ id: number; number: string; client: string | null; status: string; currency?: string | null; total?: number }> }>('/api/billing/invoices', { ...(q ? { q } : {}), per_page: 30 }, signal);
      return (r.invoices ?? []).map((i) => ({ ref: { kind: 'invoice', id: i.id }, title: i.number, sub: join(i.client, human(i.status), i.total !== undefined && `${i.currency ?? ''} ${Number(i.total).toLocaleString()}`.trim()) }));
    }
    case 'contact': {
      const r = await apiGet<Array<{ id: number; display_name: string; company: string | null; job_title: string | null; work_email?: string | null }>>('/api/contacts', q ? { q } : undefined, signal);
      return (r ?? []).slice(0, 40).map((c) => ({ ref: { kind: 'contact', id: c.id }, title: c.display_name, sub: join(c.job_title, c.company, c.work_email) }));
    }
  }
}

const EMPTY: Record<Exclude<ShareKind, 'drive'>, string> = {
  task: 'No tasks of yours match.',
  note: 'No notes match.',
  meeting: 'No meetings match.',
  event: 'No events match (a month back, four ahead).',
  crm: 'Type two letters or more to search the CRM.',
  invoice: 'No invoices match.',
  contact: 'No contacts match.',
};

export function SharePicker({ kind: first, roomName, onClose, onDrive, onShare }: {
  kind: Exclude<ShareKind, 'drive'>;
  roomName: string;
  onClose: () => void;
  /** The Drive tab hands over to Drive's own picker. */
  onDrive: () => void;
  /** Sends the record's address; resolves false when it was not sent. */
  onShare: (path: string) => Promise<boolean>;
}) {
  const [kind, setKind] = useState(first);
  const [q, setQ] = useState('');
  const [needle, setNeedle] = useState('');
  const [choice, setChosen] = useState<Row | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setNeedle(q.trim()), 250);
    return () => clearTimeout(t);
  }, [q]);
  const rows = useQuery({ queryKey: ['chat', 'share-picker', kind, needle], queryFn: ({ signal }) => search(kind, needle, signal), retry: false, staleTime: 30_000 });
  const denied = rows.error instanceof ApiError && rows.error.status === 403;
  const list = rows.data ?? [];
  const same = (a: RecordRef, b: RecordRef) => a.kind === b.kind && 'id' in a && 'id' in b && a.id === b.id;
  // A choice holds only while it is still in the list shown.
  const chosen = choice && list.some((r) => same(r.ref, choice.ref)) ? choice : null;

  const share = async () => {
    if (!chosen) return;
    setBusy(true);
    try {
      if (await onShare(pathOf(chosen.ref))) onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title={`Share to ${roomName}`}
      onClose={onClose}
      width={640}
      footer={
        <>
          <span className="mr-auto text-[12px] text-ink-3">Everyone sees it with their own access.</span>
          <Button onClick={onClose} disabled={busy}>Cancel</Button>
          <Button variant="primary" onClick={() => void share()} disabled={!chosen} loading={busy}>Share card</Button>
        </>
      }
    >
      <div className="flex flex-col gap-3 text-[13px]" data-share-picker>
        <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="What to share">
          {SHARE_KINDS.map((k) => (
            <button
              key={k.id}
              type="button"
              role="tab"
              aria-selected={k.id === kind}
              onClick={() => (k.id === 'drive' ? onDrive() : setKind(k.id))}
              className={cx('inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-[12px] font-semibold', k.id === kind ? 'border-primary bg-selection text-primary' : 'border-line text-ink-2 hover:bg-subtle')}
            >
              <Icon name={KIND[k.card].icon} size={13} />
              {k.id === 'crm' ? 'CRM' : k.label}
            </button>
          ))}
        </div>
        <label className="flex h-[36px] items-center gap-2 rounded-[9px] border border-line bg-surface px-2.5 focus-within:border-primary">
          <Icon name="search" size={15} className="text-ink-3" />
          <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search" placeholder={`Search ${kind === 'crm' ? 'deals, leads and accounts' : (SHARE_KINDS.find((k) => k.id === kind)?.label.toLowerCase() ?? '') + 's'}…`} className="bare-focus min-w-0 flex-1 bg-transparent text-ink outline-none" />
        </label>
        <div role="listbox" aria-label="Results" className="max-h-[248px] min-h-[120px] overflow-y-auto rounded-[10px] border border-line scroll-thin">
          {rows.isLoading ? <Spinner /> : null}
          {denied ? <p className="px-3 py-6 text-center text-ink-3">You don’t have access to {kind === 'crm' ? 'the CRM' : kind === 'invoice' ? 'invoices' : `${kind}s`}.</p> : null}
          {rows.error && !denied ? <p className="px-3 py-6 text-center text-ink-3">These could not be loaded.</p> : null}
          {list.map((r) => {
            const on = !!chosen && same(chosen.ref, r.ref);
            return (
              <button
                key={`${r.ref.kind}-${'id' in r.ref ? r.ref.id : ''}`}
                type="button"
                role="option"
                aria-selected={on}
                onClick={() => setChosen(r)}
                onDoubleClick={() => (setChosen(r), void onShare(pathOf(r.ref)).then((ok) => ok && onClose()))}
                className={cx('flex w-full items-center gap-2.5 border-b border-l-[3px] border-b-line/60 px-3 py-2 text-left', on ? 'border-l-primary bg-selection' : 'border-l-transparent hover:bg-subtle')}
              >
                <KindIcon kind={r.ref.kind as CardKind} size={26} />
                <span className="flex min-w-0 flex-1 flex-col">
                  <b className="truncate text-ink">{r.title}</b>
                  {r.sub ? <span className="truncate text-[12px] text-ink-3">{r.sub}</span> : null}
                </span>
              </button>
            );
          })}
          {!rows.isLoading && !rows.error && !list.length ? <p className="px-3 py-6 text-center text-ink-3">{kind === 'crm' && needle.length < 2 ? EMPTY.crm : kind === 'crm' ? 'Nothing in the CRM matches.' : EMPTY[kind]}</p> : null}
        </div>
        {chosen ? (
          <div className="flex flex-col gap-1.5">
            <span className="text-[10.5px] font-extrabold tracking-[.7px] text-ink-3">PREVIEW</span>
            <RecordCard r={chosen.ref} />
          </div>
        ) : null}
      </div>
    </Modal>
  );
}
