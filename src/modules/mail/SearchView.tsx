import { useQuery } from '@tanstack/react-query';
import { useMemo, useRef, useState, type ReactNode } from 'react';
import { apiGet, apiGetMeta } from '../../core/api';
import { text } from '../../core/i18n';
import { addDays, parseTs, todayInZone } from '../../core/time';
import { Icon } from '../../components/Icon';
import { Menu, type MenuSection } from '../../components/Menu';
import { Avatar, Empty, ErrorNote, FileBadge, Spinner, cx } from '../../components/ui';
import { folderName, rowStamp, sortRows } from './model';
import type { Mailbox, MessagePage, MessageRow } from './types';

/**
 * Search every mailbox (UI-07): from the index of mail on this side of the
 * server — instant — with `from:`, `to:`, `has:attachment`, `is:unread`,
 * `is:starred`, `before:` and `after:`, and the senders it found. Mail the
 * index does not hold (older, or a mailbox it does not mirror) is one click
 * away: "Search the server" asks each mailbox itself.
 */

export interface ParsedQuery {
  words: string;
  from: string | null;
  to: string | null;
  attachment: boolean;
  unread: boolean;
  starred: boolean;
  before: string | null;
  after: string | null;
  folder: string | null;
  label: string | null;
}

/** "BOQ from:sfcl.lk has:attachment" → the words and the operators. */
export function parseQuery(q: string): ParsedQuery {
  const out: ParsedQuery = { words: '', from: null, to: null, attachment: false, unread: false, starred: false, before: null, after: null, folder: null, label: null };
  const words: string[] = [];
  for (const token of q.match(/(?:[^\s"]+|"[^"]*")+/g) ?? []) {
    const m = /^(from|to|has|is|before|after|folder|in|label):(.+)$/i.exec(token);
    const value = m?.[2]?.replace(/^"|"$/g, '') ?? '';
    const key = m?.[1]?.toLowerCase();
    if (key === 'from') out.from = value.toLowerCase();
    else if (key === 'to') out.to = value.toLowerCase();
    else if (key === 'has' && /^attach/i.test(value)) out.attachment = true;
    else if (key === 'is' && value.toLowerCase() === 'unread') out.unread = true;
    else if (key === 'is' && /^(starred|flagged)$/i.test(value)) out.starred = true;
    else if (key === 'before' && /^\d{4}-\d{2}-\d{2}$/.test(value)) out.before = value;
    else if (key === 'after' && /^\d{4}-\d{2}-\d{2}$/.test(value)) out.after = value;
    else if (key === 'folder' || key === 'in') out.folder = value.toLowerCase();
    else if (key === 'label') out.label = value.toLowerCase();
    else words.push(token.replace(/^"|"$/g, ''));
  }
  out.words = words.join(' ').trim();
  return out;
}

/** What the server is asked: the words, or — with only operators — the sender. */
export function serverTerm(p: ParsedQuery): string {
  return p.words || p.from || p.to || '';
}

/** The operators again, on what came back. */
export function matches(m: MessageRow, p: ParsedQuery): boolean {
  if (p.from && !`${m.from_name} ${m.from_email}`.toLowerCase().includes(p.from)) return false;
  if (p.attachment && !m.has_attachment) return false;
  if (p.unread && m.is_read) return false;
  if (p.starred && !m.is_starred) return false;
  const day = parseTs(m.created_at).toISOString().slice(0, 10);
  if (p.before && day >= p.before) return false;
  if (p.after && day < p.after) return false;
  if (p.folder && (m.folder_slug ?? m.folder ?? 'inbox').toLowerCase() !== p.folder) return false;
  if (p.label && !(m.labels ?? []).some((l) => l.name.toLowerCase() === p.label)) return false;
  return true;
}

/**
 * Best match (D07): how well a message answers the words — the subject
 * counts most, then the sender, then the preview — newest first among equals.
 */
export function relevance(m: MessageRow, words: string): number {
  const terms = words.toLowerCase().split(/\s+/).filter((w) => w.length > 1);
  if (!terms.length) return 0;
  const subject = (m.subject || '').toLowerCase();
  const who = `${m.from_name} ${m.from_email}`.toLowerCase();
  const preview = (m.preview || '').toLowerCase();
  let score = 0;
  for (const t of terms) {
    if (subject.includes(t)) score += subject.startsWith(t) || subject.includes(` ${t}`) ? 4 : 3;
    if (who.includes(t)) score += 2;
    if (preview.includes(t)) score += 1;
    if ((m.attachments ?? []).some((a) => a.name.toLowerCase().includes(t))) score += 1;
  }
  return score;
}

export type SearchSort = 'best' | 'newest' | 'oldest';

export function sortResults(rows: MessageRow[], sort: SearchSort, words: string): MessageRow[] {
  if (sort === 'newest') return sortRows(rows, 'date', 'desc');
  if (sort === 'oldest') return sortRows(rows, 'date', 'asc');
  const byDate = sortRows(rows, 'date', 'desc');
  const score = new Map(byDate.map((m) => [m, relevance(m, words)] as const));
  return [...byDate].sort((a, b) => score.get(b)! - score.get(a)!);
}

/** "Any time" choices as before:/after: operators, on the reader's calendar. */
export function timeRange(id: 'week' | 'month' | 'year' | 'older', today = todayInZone()): string {
  if (id === 'week') return `after:${addDays(today, -7)}`;
  if (id === 'month') return `after:${addDays(today, -30)}`;
  if (id === 'year') return `after:${addDays(today, -365)}`;
  return `before:${addDays(today, -365)}`;
}

/** The query without one kind of operator (a dropdown chip replaces its own). */
export function withoutOperator(q: string, keys: string[]): string {
  return (q.match(/(?:[^\s"]+|"[^"]*")+/g) ?? [])
    .filter((t) => !keys.some((k) => t.toLowerCase().startsWith(`${k}:`)))
    .join(' ');
}

function highlight(s: string, words: string): ReactNode {
  const terms = words.split(/\s+/).filter((w) => w.length > 1);
  if (!terms.length) return s;
  const re = new RegExp(`(${terms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'gi');
  return s.split(re).map((part, i) => (i % 2 === 1 ? <mark key={i} className="rounded-[3px] bg-warning-bg px-0.5 text-ink">{part}</mark> : part));
}

export function SearchView({ initial, boxes, current, onOpen, onClose }: { initial: string; boxes: Mailbox[]; current: string | null; onOpen: (m: MessageRow) => void; onClose: () => void }) {
  const [q, setQ] = useState(initial);
  const [asked, setAsked] = useState(initial);
  const [all, setAll] = useState(true);
  const [server, setServer] = useState(false);
  const [sort, setSort] = useState<SearchSort>('best');
  const [menu, setMenu] = useState<'time' | 'from' | 'folder' | 'label' | 'sort' | null>(null);
  const timeBtn = useRef<HTMLButtonElement>(null);
  const fromBtn = useRef<HTMLButtonElement>(null);
  const folderBtn = useRef<HTMLButtonElement>(null);
  const labelBtn = useRef<HTMLButtonElement>(null);
  const sortBtn = useRef<HTMLButtonElement>(null);
  const parsed = useMemo(() => parseQuery(asked), [asked]);
  const term = serverTerm(parsed);
  const scopeBox = !all && current && current !== 'unified' ? current : null;
  const local = useQuery({
    queryKey: ['mail', 'search', term, scopeBox],
    queryFn: async () => {
      const t0 = performance.now();
      const r = await apiGet<{ messages: MessageRow[]; total: number; unsearched: string[] }>('/api/mail/search', scopeBox ? { q: term, mailbox: scopeBox } : { q: term, scope: 'all' });
      return { ...r, ms: performance.now() - t0 };
    },
    enabled: term.length >= 2,
    staleTime: 30_000,
    retry: false,
  });
  const remote = useQuery({
    queryKey: ['mail', 'search-server', term, scopeBox],
    queryFn: async () => (await apiGetMeta<MessagePage>('/api/mail/messages', scopeBox ? { mailbox: scopeBox, folder: 'inbox', q: term, tail: 1, per_page: 50 } : { unified: 1, folder: 'inbox', q: term, per_page: 50 })).data,
    enabled: server && term.length >= 2,
    retry: false,
  });
  const rows = useMemo(() => {
    const seen = new Set<string>();
    const merged = [...(local.data?.messages ?? []), ...(remote.data?.messages ?? [])].filter((m) => {
      const k = m.uid_key ?? `${m.mailbox?.id ?? ''}:${m.folder_slug ?? ''}:${m.id}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return matches(m, parsed);
    });
    return sortResults(merged, sort, parsed.words);
  }, [local.data, remote.data, parsed, sort]);
  // What the results hold, for the chips' menus: their folders, labels and files.
  const facets = useMemo(() => {
    const folders = new Map<string, string>();
    const labels = new Set<string>();
    for (const m of [...(local.data?.messages ?? []), ...(remote.data?.messages ?? [])]) {
      const slug = m.folder_slug ?? m.folder ?? 'inbox';
      folders.set(slug.toLowerCase(), folderName(slug.startsWith('label:') ? (m.folder ?? slug.slice(6)) : slug.charAt(0).toUpperCase() + slug.slice(1)));
      for (const l of m.labels ?? []) labels.add(l.name);
    }
    return { folders: [...folders], labels: [...labels].sort() };
  }, [local.data, remote.data]);
  const files = useMemo(() => rows.flatMap((m) => (m.attachments ?? []).map((a) => ({ a, m }))).slice(0, 12), [rows]);
  const people = useMemo(() => peopleOf(rows), [rows]);
  const searched = local.data ? boxes.length - (local.data.unsearched?.length ?? 0) : 0;
  const replace = (keys: string[], op: string | null) => {
    const next = `${withoutOperator(q, keys)} ${op ?? ''}`.replace(/\s+/g, ' ').trim();
    setQ(next);
    setAsked(next);
    setMenu(null);
  };
  const timeOn = !!(parsed.before || parsed.after);
  const menus: Record<'time' | 'from' | 'folder' | 'label' | 'sort', MenuSection[]> = {
    time: [
      {
        id: 'time',
        items: [
          { id: 'any', label: text('Any time'), radio: true, checked: !timeOn, onSelect: () => replace(['before', 'after'], null) },
          { id: 'week', label: text('Last 7 days'), radio: true, checked: parsed.after === timeRange('week').slice(6), onSelect: () => replace(['before', 'after'], timeRange('week')) },
          { id: 'month', label: text('Last 30 days'), radio: true, checked: parsed.after === timeRange('month').slice(6), onSelect: () => replace(['before', 'after'], timeRange('month')) },
          { id: 'year', label: text('Last year'), radio: true, checked: parsed.after === timeRange('year').slice(6), onSelect: () => replace(['before', 'after'], timeRange('year')) },
          { id: 'older', label: text('Older than a year'), radio: true, checked: parsed.before === timeRange('older').slice(7), onSelect: () => replace(['before', 'after'], timeRange('older')) },
        ],
      },
    ],
    from: [{ id: 'from', items: [{ id: 'anyone', label: text('Anyone'), radio: true, checked: !parsed.from, onSelect: () => replace(['from'], null) }, ...peopleOf(rows).map((p) => ({ id: p.email, label: p.name, description: p.email, radio: true, checked: parsed.from === p.email.toLowerCase(), onSelect: () => replace(['from'], `from:${p.email}`) }))] }],
    folder: [{ id: 'folder', items: [{ id: 'any', label: text('Any folder'), radio: true, checked: !parsed.folder, onSelect: () => replace(['folder', 'in'], null) }, ...facets.folders.map(([slug, name]) => ({ id: slug, label: name, radio: true, checked: parsed.folder === slug, onSelect: () => replace(['folder', 'in'], `in:${slug}`) }))] }],
    label: [{ id: 'label', items: facets.labels.length ? [{ id: 'any', label: text('Any label'), radio: true, checked: !parsed.label, onSelect: () => replace(['label'], null) }, ...facets.labels.map((l) => ({ id: l, label: l, radio: true, checked: parsed.label === l.toLowerCase(), onSelect: () => replace(['label'], `label:${/\s/.test(l) ? `"${l}"` : l}`) }))] : [{ id: 'none', label: text('No labels on these results'), disabled: true, onSelect: () => undefined }] }],
    sort: [{ id: 'sort', items: (['best', 'newest', 'oldest'] as const).map((k) => ({ id: k, label: k === 'best' ? text('Best match') : k === 'newest' ? text('Newest first') : text('Oldest first'), radio: true, checked: sort === k, onSelect: () => (setSort(k), setMenu(null)) })) }],
  };
  const toggle = (op: string) => {
    const has = new RegExp(`(^|\\s)${op.replace(':', '\\:')}(\\s|$)`, 'i').test(q);
    const next = has ? q.replace(new RegExp(`(^|\\s)${op.replace(':', '\\:')}(?=\\s|$)`, 'i'), ' ').replace(/\s+/g, ' ').trim() : `${q.trim()} ${op}`.trim();
    setQ(next);
    setAsked(next);
  };
  return (
    <section aria-label="Search mail" className="flex min-h-0 min-w-0 flex-1 flex-col bg-ground p-4">
      <form
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          setAsked(q);
          setServer(false);
        }}
        className="flex h-12 items-center gap-3 rounded-[12px] border-2 border-primary bg-surface px-4"
      >
        <Icon name="search" size={18} className="text-ink-2" />
        <input
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.preventDefault();
              onClose();
            }
          }}
          aria-label="Search mail"
          placeholder="Search mail — try from: has:attachment is:unread"
          className="bare-focus min-w-0 flex-1 bg-transparent text-[16px] font-semibold text-ink outline-none placeholder:font-normal placeholder:text-ink-3"
        />
        <span className="shrink-0 text-[12.5px] text-ink-3">Esc to close</span>
      </form>
      <div className="mt-3 flex flex-wrap items-center gap-2" role="group" aria-label="Search filters">
        <Chip on={all} onClick={() => setAll(!all)}>
          All mailboxes
        </Chip>
        <Chip ref={timeBtn} on={timeOn} menu onClick={() => setMenu('time')}>
          {timeOn ? (parsed.after ? text('After {date}', { date: parsed.after }) : text('Before {date}', { date: parsed.before ?? '' })) : text('Any time')}
        </Chip>
        <Chip ref={fromBtn} on={!!parsed.from} menu onClick={() => setMenu('from')}>
          {parsed.from ? text('From {who}', { who: parsed.from }) : text('From')}
        </Chip>
        <Chip on={parsed.attachment} onClick={() => toggle('has:attachment')}>
          Has attachment
        </Chip>
        <Chip ref={folderBtn} on={!!parsed.folder} menu onClick={() => setMenu('folder')}>
          {parsed.folder ? (facets.folders.find(([f]) => f === parsed.folder)?.[1] ?? parsed.folder) : text('Folder')}
        </Chip>
        <Chip ref={labelBtn} on={!!parsed.label} menu onClick={() => setMenu('label')}>
          {parsed.label ? text('Label {name}', { name: parsed.label }) : text('Label')}
        </Chip>
        <Chip on={parsed.unread} onClick={() => toggle('is:unread')}>
          Unread
        </Chip>
        <span className="flex-1" />
        <button ref={sortBtn} type="button" onClick={() => setMenu('sort')} aria-haspopup="menu" className="inline-flex h-8 items-center gap-1 rounded-[8px] px-2 text-[12.5px] text-ink-3 hover:bg-subtle hover:text-ink">
          {text('Sort: {how}', { how: sort === 'best' ? text('Best match') : sort === 'newest' ? text('Newest first') : text('Oldest first') })}
          <Icon name="chevron-down" size={12} />
        </button>
      </div>
      {menu ? <Menu sections={menus[menu]} label={text('Search filters')} anchor={menu === 'time' ? timeBtn : menu === 'from' ? fromBtn : menu === 'folder' ? folderBtn : menu === 'label' ? labelBtn : sortBtn} prefer="bottom" align={menu === 'sort' ? 'end' : 'start'} width={menu === 'from' ? 280 : 220} onClose={() => setMenu(null)} /> : null}
      <div className="mt-3 flex min-h-0 flex-1 gap-4">
        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-[12px] border border-line bg-surface">
          <header className="flex items-center justify-between border-b border-line px-4 py-2.5">
            <h2 className="text-[14px] font-bold text-ink">{text('Messages · {n}', { n: rows.length })}</h2>
            {local.data ? <span className="text-[12px] font-semibold text-success">{text('Searched {n} mailboxes on this computer · {s} s', { n: searched, s: (local.data.ms / 1000).toFixed(2) })}</span> : null}
          </header>
          <div className="min-h-0 flex-1 overflow-y-auto scroll-thin">
            {term.length < 2 ? <Empty icon="search" title={text('Type at least two letters')} hint={text('Try from: to: has:attachment before:2026-09-01 or is:unread.')} /> : local.isLoading ? <Spinner /> : local.error ? <div className="p-4"><ErrorNote error={local.error} onRetry={() => void local.refetch()} /></div> : rows.length === 0 && !remote.isLoading ? <Empty icon="search" title={text('Nothing found on this computer')} hint={text('Search the server for older mail.')} /> : null}
            <ul role="list">
              {rows.map((m) => (
                <li key={m.uid_key ?? `${m.mailbox?.id ?? ''}:${m.id}`}>
                  <button type="button" onClick={() => onOpen(m)} className="flex w-full gap-3 border-b border-line px-4 py-3 text-left hover:bg-subtle">
                    <Avatar name={m.from_name || m.from_email} size={34} />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2">
                        <span className={cx('min-w-0 flex-1 truncate text-[13.5px]', m.is_read ? 'font-semibold text-ink' : 'font-bold text-ink')}>{m.from_name || m.from_email}</span>
                        <span className="shrink-0 text-[12px] text-ink-3">
                          {m.mailbox ? `${m.mailbox.name} · ` : ''}
                          {rowStamp(m.created_at)}
                        </span>
                      </span>
                      <span className="block truncate text-[13.5px] font-semibold text-ink">{highlight(m.subject || text('(no subject)'), parsed.words)}</span>
                      <span className="block truncate text-[12.5px] text-ink-3">{m.preview}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            {remote.isLoading ? <Spinner label={text('Searching each mailbox…')} /> : null}
            {remote.error ? <div className="p-4"><ErrorNote error={remote.error} /></div> : null}
          </div>
          {term.length >= 2 && !server ? (
            <footer className="flex items-center justify-between gap-3 border-t border-line px-4 py-3 text-[13px] text-ink-2">
              <span>{local.data?.unsearched?.length ? text('{n} mailboxes are not indexed here yet, and older mail stays on the server.', { n: local.data.unsearched.length }) : text('Older mail stays on the server.')}</span>
              <button type="button" onClick={() => setServer(true)} className="h-8 shrink-0 rounded-[8px] border border-line px-3 font-semibold text-ink hover:bg-subtle">
                Search the server
              </button>
            </footer>
          ) : null}
        </div>
        <aside aria-label="Files and people" className="flex w-[320px] shrink-0 flex-col gap-3 overflow-y-auto scroll-thin">
          {files.length ? (
            <section aria-label={text('Attachments')} className="overflow-hidden rounded-[12px] border border-line bg-surface">
              <h3 className="border-b border-line bg-subtle px-3.5 py-2.5 text-[14px] font-bold text-ink">{text('Attachments · {n}', { n: files.length })}</h3>
              <ul role="list">
                {files.map(({ a, m }) => (
                  <li key={`${m.uid_key ?? m.id}:${a.ref}:${a.name}`}>
                    <button type="button" onClick={() => onOpen(m)} title={text('Open the email it came with')} className="flex w-full items-center gap-2.5 border-b border-line px-3.5 py-2 text-left last:border-b-0 hover:bg-subtle">
                      <FileBadge name={a.name} size={32} />
                      <span className="min-w-0">
                        <span className="block truncate text-[12.5px] font-semibold text-ink">{a.name}</span>
                        <span className="block truncate text-[11.5px] text-ink-3">{`${m.from_name || m.from_email} · ${rowStamp(m.created_at)}`}</span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
          {people.length ? (
            <div className="rounded-[12px] border border-line bg-surface p-3">
              <h3 className="px-1 pb-2 text-[14px] font-bold text-ink">People</h3>
              <ul role="list" className="flex flex-col gap-1">
                {people.map((p) => (
                  <li key={p.email}>
                    <button type="button" onClick={() => toggle(`from:${p.email}`)} className="flex w-full items-center gap-2.5 rounded-[8px] px-1 py-1.5 text-left hover:bg-subtle">
                      <Avatar name={p.name} size={30} />
                      <span className="min-w-0">
                        <span className="block truncate text-[13px] font-semibold text-ink">{p.name}</span>
                        <span className="block truncate text-[12px] text-ink-3">{text('{email} · {n} emails', { email: p.email, n: p.n })}</span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          <p className="rounded-[12px] bg-subtle p-3 text-[12.5px] leading-relaxed text-ink-2">
            Try <code className="font-mono">from:</code> <code className="font-mono">to:</code> <code className="font-mono">before:2026-09-01</code> <code className="font-mono">after:</code> <code className="font-mono">has:attachment</code> or <code className="font-mono">is:unread</code>.
          </p>
        </aside>
      </div>
    </section>
  );
}

/** The senders among the results, most frequent first. */
export function peopleOf(rows: MessageRow[]): Array<{ name: string; email: string; n: number }> {
  const by = new Map<string, { name: string; email: string; n: number }>();
  for (const m of rows) {
    const k = m.from_email.toLowerCase();
    const p = by.get(k) ?? { name: m.from_name || m.from_email, email: m.from_email, n: 0 };
    p.n++;
    by.set(k, p);
  }
  return [...by.values()].sort((a, b) => b.n - a.n).slice(0, 8);
}

function Chip({ ref, on, onClick, menu, children }: { ref?: React.Ref<HTMLButtonElement>; on: boolean; onClick: () => void; menu?: boolean; children: ReactNode }) {
  return (
    <button ref={ref} type="button" aria-pressed={menu ? undefined : on} aria-haspopup={menu ? 'menu' : undefined} onClick={onClick} className={cx('inline-flex h-[30px] items-center gap-1 rounded-full border px-3 text-[12.5px] font-semibold', on ? 'border-primary bg-selection text-primary' : 'border-line bg-surface text-ink hover:bg-subtle')}>
      {children}
      {menu ? <Icon name="chevron-down" size={12} /> : null}
    </button>
  );
}
