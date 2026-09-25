import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { apiGet, apiPost } from '../../../core/api';
import { app } from '../../../core/app-state';
import { call } from '../../../core/bridge';
import { useStore } from '../../../core/store';
import { useTab, useTabTitle } from '../../../core/tab-context';
import { listStamp } from '../../../core/time';
import { Empty, ErrorNote, Spinner, cx } from '../../../components/ui';
import { sectionRows, useWebsiteInbox, WEBSITE, type Section, type WebsiteRow } from './api';
import { WebsiteThread } from './WebsiteThread';

/**
 * Website chats as their own workspace (WebChatInbox): the sections down the
 * left, the conversations in the chosen one, then the visitor's thread and
 * dossier. Setup and reports stay on the web, where they are edited.
 */
const SECTIONS: Array<{ id: Section; label: string }> = [
  { id: 'inbox', label: 'Inbox' },
  { id: 'live', label: 'Live chats' },
  { id: 'offline', label: 'Offline enquiries' },
  { id: 'missed', label: 'Missed chats' },
  { id: 'mine', label: 'Assigned to me' },
  { id: 'unassigned', label: 'Unassigned' },
  { id: 'awaiting', label: 'Awaiting reply' },
  { id: 'starred', label: 'Starred' },
  { id: 'closed', label: 'Closed' },
];

const ON_WEB: Array<{ head: string; items: Array<{ label: string; tab: string }> }> = [
  { head: 'LIVE', items: [{ label: 'Visitors online', tab: 'online' }, { label: 'Live dashboard', tab: 'dashboard' }] },
  { head: 'REPORTS', items: [{ label: 'Insights', tab: 'reports' }] },
  {
    head: 'SETUP',
    items: [
      { label: 'Widgets & embed', tab: 'widgets' },
      { label: 'Automated messages', tab: 'triggers' },
      { label: 'Conversation starters', tab: 'starters' },
      { label: 'Saved replies', tab: 'canned' },
      { label: 'Business hours', tab: 'hours' },
    ],
  },
];

interface Missed {
  id: number;
  widget: string;
  visitor: string;
  email: string | null;
  phone: string | null;
  place: string | null;
  missed_at: string | null;
  last_visitor_at: string | null;
}

const STATUS: Record<string, [string, string]> = {
  Open: ['bg-success-bg text-success', 'Open'],
  Pending: ['bg-warning-bg text-[#9A4A06] dark:text-warning', 'Pending'],
  Awaiting: ['bg-danger-bg text-danger', 'Awaiting reply'],
  Closed: ['bg-subtle text-ink-3', 'Closed'],
};

function statusOf(r: WebsiteRow): [string, string] {
  if (r.status === 'closed') return STATUS.Closed!;
  if (r.awaiting_reply) return STATUS.Awaiting!;
  return r.status === 'pending' ? STATUS.Pending! : STATUS.Open!;
}

export function WebsiteWorkspace() {
  const { query, go } = useTab();
  const me = useStore(app, (s) => (s.auth?.user?.id ? Number(s.auth.user.id) : null));
  const selected = query.get('website');
  const section = (SECTIONS.find((s) => s.id === query.get('section'))?.id ?? 'inbox') as Section;
  const [site, setSite] = useState(0);
  useTabTitle(selected ? null : 'Website chats');
  const [q, setQ] = useState('');
  const open = useWebsiteInbox(false);
  const closed = useWebsiteInbox(true, section === 'closed');
  const missed = useQuery({
    queryKey: ['website', 'missed'],
    queryFn: ({ signal }) => apiGet<{ missed: Missed[]; count: number }>(`${WEBSITE}/missed`, undefined, signal),
    enabled: section === 'missed',
    retry: false,
  });
  const missedCount = useQuery({
    queryKey: ['website', 'missed', 'count'],
    queryFn: ({ signal }) => apiGet<{ count: number }>(`${WEBSITE}/missed/count`, undefined, signal),
    refetchInterval: 60_000,
    retry: false,
  });
  const openRows = open.data?.conversations ?? [];
  const sites = open.data && 'sites' in open.data ? ((open.data as { sites?: Array<{ widget_id: number; site: string }> }).sites ?? []) : [];
  const count = (s: Section): number => (s === 'missed' ? (missedCount.data?.count ?? 0) : s === 'closed' ? 0 : sectionRows(openRows, s, me).length);
  const source = section === 'closed' ? closed : open;
  const needle = q.trim().toLowerCase();
  const rows = sectionRows(source.data?.conversations ?? [], section, me)
    .filter((r) => !site || r.widget_id === site)
    .filter((r) => !needle || [r.label, r.visitor_name, r.email, r.site, r.current_url].some((v) => v?.toLowerCase().includes(needle)));
  const to = (params: Record<string, string | null>) => {
    const next = new URLSearchParams({ view: 'website', section });
    if (selected) next.set('website', selected);
    for (const [k, v] of Object.entries(params)) {
      if (v === null) next.delete(k);
      else next.set(k, v);
    }
    go(`/chat?${next.toString()}`);
  };

  // Opening a missed chat is dealing with it (the web does the same).
  useEffect(() => {
    if (section === 'missed' && selected) void apiPost(`${WEBSITE}/missed/${selected}/handle`).catch(() => undefined);
  }, [section, selected]);

  return (
    <div className="flex h-full min-w-0 text-[13px]">
      <nav aria-label="Website chats" className="flex w-[212px] shrink-0 flex-col gap-px overflow-y-auto border-r border-line bg-surface px-2.5 py-3.5 scroll-thin">
        <button type="button" onClick={() => go('/chat')} className="px-2 pb-2 text-left font-semibold text-primary hover:underline">‹ Back to Chat</button>
        <b className="px-2 pb-1.5 text-[15px] text-ink">Website Chats</b>
        <div className="mx-2 mt-2 mb-0.5 text-[10.5px] font-bold tracking-[0.6px] text-ink-3">CONVERSATIONS</div>
        {SECTIONS.map((s) => {
          const n = count(s.id);
          return (
            <button key={s.id} type="button" aria-current={section === s.id ? 'page' : undefined} onClick={() => to({ section: s.id, website: null })} className={cx('flex h-[27px] items-center rounded-[7px] px-2 text-left', section === s.id ? 'bg-selection font-bold text-primary' : 'text-ink hover:bg-subtle')}>
              <span className="flex-1">{s.label}</span>
              {n ? <span className={cx('text-[11.5px] font-bold', s.id === 'missed' ? 'text-danger' : 'text-ink-2')}>{n}</span> : null}
            </button>
          );
        })}
        {ON_WEB.map((g) => (
          <div key={g.head} className="flex flex-col gap-px">
            <div className="mx-2 mt-2 mb-0.5 text-[10.5px] font-bold tracking-[0.6px] text-ink-3">{g.head}</div>
            {g.items.map((i) => (
              <button key={i.tab} type="button" title="Opens on the web" onClick={() => void call('app:openInBrowser', { path: `/website-chats?tab=${i.tab}` })} className="flex h-[27px] items-center rounded-[7px] px-2 text-left text-ink hover:bg-subtle">
                <span className="flex-1">{i.label}</span>
                <span className="text-[11px] text-ink-3" aria-hidden>↗</span>
              </button>
            ))}
          </div>
        ))}
      </nav>
      <section aria-label="Conversations" className="flex w-[320px] shrink-0 flex-col border-r border-line bg-surface">
        <div className="flex flex-col gap-2 border-b border-line p-3">
          <div className="flex items-center">
            <b className="flex-1 text-[15px] text-ink">{SECTIONS.find((s) => s.id === section)?.label}</b>
            <select aria-label="Site" value={site} onChange={(e) => setSite(Number(e.target.value))} className="h-7 rounded-[7px] border border-line bg-surface px-1.5 text-[12px] text-ink">
              <option value={0}>All sites</option>
              {sites.map((s) => <option key={s.widget_id} value={s.widget_id}>{s.site}</option>)}
            </select>
          </div>
          <input value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search visitors" placeholder="Search visitors…" className="h-8 rounded-[8px] border border-line bg-surface px-2.5 text-[13px] outline-none focus:border-primary" />
          <div className="flex gap-1 text-[11.5px] font-semibold">
            <button type="button" onClick={() => to({ section: section === 'closed' ? 'inbox' : section, website: null })} className={cx('rounded-[10px] px-2 py-[3px]', section !== 'closed' ? 'bg-ink text-surface' : 'border border-line text-ink')}>Open &amp; pending</button>
            <button type="button" onClick={() => to({ section: 'closed', website: null })} className={cx('rounded-[10px] px-2 py-[3px]', section === 'closed' ? 'bg-ink text-surface' : 'border border-line text-ink')}>Closed</button>
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto scroll-thin">
          {section === 'missed' ? (
            missed.isLoading ? <Spinner /> : missed.error ? <div className="p-4"><ErrorNote error={missed.error} onRetry={() => void missed.refetch()} /></div> : !missed.data?.missed.length ? (
              <Empty icon="globe" title="No missed chats" />
            ) : (
              missed.data.missed.map((m) => (
                <button key={m.id} type="button" onClick={() => to({ website: String(m.id) })} className={cx('flex w-full flex-col gap-[3px] border-b border-line px-3 py-2.5 text-left', selected === String(m.id) ? 'bg-selection' : 'hover:bg-subtle')}>
                  <span className="flex items-center gap-[7px]"><b className="flex-1 truncate text-ink">{m.visitor}</b><span className="text-[11px] text-ink-3">{listStamp(m.missed_at)}</span></span>
                  <span className="truncate text-[12px] text-ink-2">{m.email ?? m.phone ?? 'No way to reach them'}{m.place ? ` · ${m.place}` : ''}</span>
                  <span className="text-[11px] text-ink-3">{m.widget}</span>
                </button>
              ))
            )
          ) : source.isLoading ? <Spinner /> : source.error ? <div className="p-4"><ErrorNote error={source.error} onRetry={() => void source.refetch()} /></div> : rows.length === 0 ? (
            <Empty icon="globe" title={section === 'awaiting' ? 'Nobody is waiting' : section === 'mine' ? 'No chats assigned to you' : 'No website chats'} />
          ) : (
            rows.map((r) => {
              const [tone, label] = statusOf(r);
              return (
                <button key={r.id} type="button" onClick={() => to({ website: String(r.id) })} className={cx('flex w-full flex-col gap-[3px] border-b border-line px-3 py-2.5 text-left', selected === String(r.id) ? 'bg-selection' : 'hover:bg-subtle')}>
                  <span className="flex items-center gap-[7px]">
                    <span className={cx('h-2 w-2 shrink-0 rounded-full', r.online ? 'bg-success' : r.status === 'pending' ? 'bg-warning' : 'bg-line')} aria-label={r.online ? 'On the site now' : 'Left the site'} />
                    <b className="flex-1 truncate text-ink">{r.visitor_name || r.label}</b>
                    <span className="text-[11px] text-ink-3">{listStamp(r.last_visitor_at ?? r.updated_at)}</span>
                  </span>
                  <span className="truncate text-[12px] text-ink-2">{r.current_url ?? (r.agent ? `With ${r.agent}` : r.email ?? '')}</span>
                  <span className="flex items-center gap-[5px]">
                    <span className={cx('rounded-[5px] px-1.5 py-px text-[10.5px] font-bold', tone)}>{label}</span>
                    <span className="truncate text-[11px] text-ink-3">{r.site ?? r.widget}</span>
                    {r.at_risk ? <span className="text-[10.5px] font-bold text-danger">At risk</span> : null}
                    {r.is_starred ? <span className="text-[11px] text-warning" aria-label="Starred">★</span> : null}
                  </span>
                </button>
              );
            })
          )}
        </div>
      </section>
      <div className="flex min-w-0 flex-1">
        {selected ? <WebsiteThread key={selected} id={selected} row={openRows.find((r) => String(r.id) === selected)} /> : <Empty icon="globe" title="Pick a conversation" hint="Visitors waiting for a reply are marked Awaiting reply." />}
      </div>
    </div>
  );
}
