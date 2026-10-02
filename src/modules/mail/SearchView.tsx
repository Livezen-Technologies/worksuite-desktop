import { useQuery } from '@tanstack/react-query';
import { useMemo, useState, type ReactNode } from 'react';
import { apiGet, apiGetMeta } from '../../core/api';
import { text } from '../../core/i18n';
import { parseTs } from '../../core/time';
import { Icon } from '../../components/Icon';
import { Avatar, Empty, ErrorNote, Spinner, cx } from '../../components/ui';
import { rowStamp, sortRows } from './model';
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
}

/** "BOQ from:sfcl.lk has:attachment" → the words and the operators. */
export function parseQuery(q: string): ParsedQuery {
  const out: ParsedQuery = { words: '', from: null, to: null, attachment: false, unread: false, starred: false, before: null, after: null };
  const words: string[] = [];
  for (const token of q.match(/(?:[^\s"]+|"[^"]*")+/g) ?? []) {
    const m = /^(from|to|has|is|before|after):(.+)$/i.exec(token);
    const value = m?.[2]?.replace(/^"|"$/g, '') ?? '';
    const key = m?.[1]?.toLowerCase();
    if (key === 'from') out.from = value.toLowerCase();
    else if (key === 'to') out.to = value.toLowerCase();
    else if (key === 'has' && /^attach/i.test(value)) out.attachment = true;
    else if (key === 'is' && value.toLowerCase() === 'unread') out.unread = true;
    else if (key === 'is' && /^(starred|flagged)$/i.test(value)) out.starred = true;
    else if (key === 'before' && /^\d{4}-\d{2}-\d{2}$/.test(value)) out.before = value;
    else if (key === 'after' && /^\d{4}-\d{2}-\d{2}$/.test(value)) out.after = value;
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
  return true;
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
    return sortRows(merged, 'date', 'desc');
  }, [local.data, remote.data, parsed]);
  const people = useMemo(() => {
    const by = new Map<string, { name: string; email: string; n: number }>();
    for (const m of rows) {
      const k = m.from_email.toLowerCase();
      const p = by.get(k) ?? { name: m.from_name || m.from_email, email: m.from_email, n: 0 };
      p.n++;
      by.set(k, p);
    }
    return [...by.values()].sort((a, b) => b.n - a.n).slice(0, 6);
  }, [rows]);
  const searched = local.data ? boxes.length - (local.data.unsearched?.length ?? 0) : 0;
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
        <Chip on={parsed.attachment} onClick={() => toggle('has:attachment')}>
          Has attachment
        </Chip>
        <Chip on={parsed.unread} onClick={() => toggle('is:unread')}>
          Unread
        </Chip>
        <Chip on={parsed.starred} onClick={() => toggle('is:starred')}>
          Starred
        </Chip>
      </div>
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
        <aside className="flex w-[300px] shrink-0 flex-col gap-3">
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

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" aria-pressed={on} onClick={onClick} className={cx('h-8 rounded-full border px-3 text-[13px] font-semibold', on ? 'border-primary bg-selection text-primary' : 'border-line bg-surface text-ink hover:bg-subtle')}>
      {children}
    </button>
  );
}
