import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type ReactNode } from 'react';
import type { WebchatHandoff, WebchatRingChat } from '@shared/types';
import { apiGet, apiPost } from '../../../core/api';
import { call, errorMessage, on } from '../../../core/bridge';
import { toast } from '../../../core/toasts';
import { app } from '../../../core/app-state';
import { text } from '../../../core/i18n';
import { useStore } from '../../../core/store';
import { useTab, useTabTitle } from '../../../core/tab-context';
import { listStamp, parseTs } from '../../../core/time';
import { Icon } from '../../../components/Icon';
import { Avatar, Button, Empty, ErrorNote, Kbd, Spinner, cx } from '../../../components/ui';
import { useNow } from '../../calls/parts';
import { isMine as mineFor, lastSaid, longestWaiting, sectionRows, stepRow, useCallbacks, useWebsiteInbox, useWebsiteSearch, waitingSince, waitingSummary, WEBSITE, type CallbackOutcome, type Section, type WebsiteCallback, type WebsiteRow } from './api';
import { clock, handoffAsk, handoffTitle, useRingState, waited } from './Ringing';
import { WebsiteLive, type OnlineVisitor } from './WebsiteLive';
import { WebsiteThread } from './WebsiteThread';
import { Select } from '../../../components/Select';
import { SidePanel } from '../../../components/SidePanel';

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
  // Chats I own or take part in (ENH-WCHAT-03, TEAM-09).
  { id: 'mine', label: 'Mine' },
  // Invitations and transfers waiting for me.
  { id: 'invited', label: 'Invited' },
  { id: 'unassigned', label: 'Unassigned' },
  { id: 'awaiting', label: 'Awaiting reply' },
  { id: 'starred', label: 'Starred' },
  { id: 'closed', label: 'Closed' },
];

const ON_WEB: Array<{ head: string; items: Array<{ label: string; tab: string }> }> = [
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

export function WebsiteWorkspace() {
  const { query, go, active } = useTab();
  const me = useStore(app, (s) => (s.auth?.user?.id ? Number(s.auth.user.id) : null));
  const myName = useStore(app, (s) => s.bootstrap?.user?.name ?? null);
  const selected = query.get('website');
  const live = query.get('section') === 'live';
  const section = (SECTIONS.find((s) => s.id === query.get('section'))?.id ?? 'inbox') as Section;
  const [site, setSite] = useState(0);
  // The Mine pill narrows whichever open section is showing; Closed is a section of its own.
  const [mineOnly, setMineOnly] = useState(false);
  useTabTitle(selected ? null : 'Website chats');
  const [q, setQ] = useState('');
  // The server searches what was said as well, once typing pauses.
  const [needle, setNeedle] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setNeedle(q.trim()), 300);
    return () => clearTimeout(t);
  }, [q]);
  const open = useWebsiteInbox(false);
  const online = useQuery({
    queryKey: ['website', 'visitors'],
    queryFn: ({ signal }) => apiGet<{ visitors: OnlineVisitor[] }>(`${WEBSITE}/visitors`, undefined, signal),
    refetchInterval: 30_000,
    retry: false,
  });
  const visitorsOnline = online.data?.visitors.length ?? 0;
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
  // Visitors waiting to be called back (VOICE-16): first in Missed chats.
  const callbacks = useCallbacks(true);
  const callbackList = callbacks.data ?? [];
  // What rings on this computer: the row shows it, and a silenced one is marked (RING-24).
  const ring = useRingState();
  const ringing = new Map(ring.chats.map((c) => [c.id, c]));
  const handoffs = ring.handoffs ?? [];
  // Visitors typing now, for their rows (LIVE-02).
  const typingRows = useVisitorsTyping();
  const openRows = open.data?.conversations ?? [];
  const sites = open.data && 'sites' in open.data ? ((open.data as { sites?: Array<{ widget_id: number; site: string }> }).sites ?? []) : [];
  const count = (s: Section): number => (s === 'missed' ? (missedCount.data?.count ?? 0) + callbackList.length : s === 'invited' ? handoffs.length : s === 'closed' ? 0 : sectionRows(openRows, s, me).length);
  const source = section === 'closed' ? closed : open;
  const pill = section === 'closed' ? 'closed' : mineOnly ? 'mine' : 'open';
  const onSite = (r: WebsiteRow) => !site || r.widget_id === site;
  const isMine = (r: WebsiteRow) => mineFor(r, me);
  const openHere = sectionRows(openRows, section === 'closed' ? 'inbox' : section, me).filter(onSite);
  const typed = q.trim().toLowerCase();
  const searching = section !== 'missed' && section !== 'invited' && needle.length >= 2 && typed.length >= 2;
  const found = useWebsiteSearch(searching ? needle : '', section === 'closed');
  // Until the server answers, the list narrows by what it already has.
  const rows = (searching && found.data ? found.data.conversations : sectionRows(source.data?.conversations ?? [], section, me))
    .filter(onSite)
    .filter((r) => pill !== 'mine' || isMine(r))
    .filter((r) => (searching && found.data) || !typed || [r.label, r.visitor_name, r.email, r.site, r.current_url, r.last_message?.body].some((v) => v?.toLowerCase().includes(typed)));
  const list = searching && found.data ? found : source;
  const to = (params: Record<string, string | null>) => {
    const next = new URLSearchParams({ view: 'website', section });
    if (selected) next.set('website', selected);
    for (const [k, v] of Object.entries(params)) {
      if (v === null) next.delete(k);
      else next.set(k, v);
    }
    go(`/chat?${next.toString()}`);
  };
  const showOpen = (mine: boolean) => {
    setMineOnly(mine);
    if (section === 'closed') to({ section: 'inbox', website: null });
  };
  const longest = longestWaiting(openRows);
  const openLongest = () => {
    if (!longest) return;
    // Stay in the section when the visitor is in it, so the list shows what is open.
    to({ section: rows.some((r) => r.id === longest.id) ? section : 'inbox', website: String(longest.id) });
  };

  // Opening a missed chat is dealing with it (the web does the same).
  useEffect(() => {
    if (section === 'missed' && selected) void apiPost(`${WEBSITE}/missed/${selected}/handle`).catch(() => undefined);
  }, [section, selected]);

  // J and K move through the list (CHAT-UI-00) while this tab is in front and nothing is being typed.
  const ids = section === 'missed' ? (missed.data?.missed ?? []).map((m) => m.id) : section === 'invited' ? handoffs.map((h) => h.conversationId) : rows.map((r) => r.id);
  const idsKey = ids.join(',');
  useEffect(() => {
    if (!active || live) return;
    const list = idsKey ? idsKey.split(',').map(Number) : [];
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey || (e.key !== 'j' && e.key !== 'k')) return;
      const t = e.target as HTMLElement | null;
      if (t && typeof t.closest === 'function' && (t.isContentEditable || t.closest('input, textarea, select, [contenteditable="true"], [role="dialog"], [role="menu"]'))) return;
      const next = stepRow(list, selected && /^\d+$/.test(selected) ? Number(selected) : null, e.key === 'j' ? 1 : -1);
      if (next === null) return;
      e.preventDefault();
      if (String(next) === selected) return;
      go(`/chat?${new URLSearchParams({ view: 'website', section, website: String(next) }).toString()}`);
      document.querySelector(`[data-website-row="${next}"]`)?.scrollIntoView?.({ block: 'nearest' });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active, live, idsKey, selected, section, go]);

  return (
    <div className="flex h-full min-w-0 flex-1 text-[13px]">
      <SidePanel id="website-chats" label="the website chat menu">
        <nav aria-label="Website chats" className="flex w-[212px] shrink-0 flex-col gap-px overflow-y-auto border-r border-line bg-surface px-2.5 py-3.5 scroll-thin">
          <button type="button" onClick={() => go('/chat')} className="px-2 pb-2 text-left font-semibold text-primary hover:underline">‹ Back to Chat</button>
          <b className="px-2 pb-1.5 text-[15px] text-ink">Website Chats</b>
          <div className="mx-2 mt-2 mb-0.5 text-[10.5px] font-bold tracking-[0.6px] text-ink-3">CONVERSATIONS</div>
          {SECTIONS.map((s) => {
            const n = count(s.id);
            return (
              <button key={s.id} type="button" aria-current={section === s.id ? 'page' : undefined} onClick={() => to({ section: s.id, website: null })} className={cx('flex h-[27px] items-center rounded-[7px] px-2 text-left', section === s.id ? 'bg-selection font-bold text-primary' : 'text-ink hover:bg-subtle')}>
                <span className="flex-1">{s.label}</span>
                {n ? <span className={cx('text-[11.5px] font-bold', s.id === 'missed' ? 'text-danger' : s.id === 'invited' ? 'text-primary' : 'text-ink-2')}>{n}</span> : null}
              </button>
            );
          })}
          <div className="mx-2 mt-2 mb-0.5 text-[10.5px] font-bold tracking-[0.6px] text-ink-3">LIVE</div>
          {[
            ['Visitors online', visitorsOnline],
            ['Live dashboard', null],
          ].map(([label, n]) => (
            <button key={label} type="button" aria-current={live && label === 'Live dashboard' ? 'page' : undefined} onClick={() => go('/chat?view=website&section=live')} className={cx('flex h-[27px] items-center rounded-[7px] px-2 text-left', live ? 'bg-selection font-bold text-primary' : 'text-ink hover:bg-subtle')}>
              <span className="flex-1">{label}</span>
              {n ? <span className="text-[11.5px] font-bold text-ink-2">{n}</span> : null}
            </button>
          ))}
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
      </SidePanel>
      {live ? <WebsiteLive onOpenChat={(id) => go(`/chat?view=website&section=inbox&website=${id}`)} /> : null}
      <section aria-label="Conversations" className={cx('flex w-[320px] shrink-0 flex-col border-r border-line bg-surface', live && 'hidden')}>
        <div className="flex flex-col gap-2 border-b border-line p-3">
          <div className="flex items-center">
            <b className="flex-1 text-[15px] text-ink">{SECTIONS.find((s) => s.id === section)?.label}</b>
            <Select aria-label="Site" value={site} onChange={(e) => setSite(Number(e.target.value))} className="h-7 rounded-[7px] border border-line bg-surface px-1.5 text-[12px] text-ink">
              <option value={0}>All sites</option>
              {sites.map((s) => <option key={s.widget_id} value={s.widget_id}>{s.site}</option>)}
            </Select>
          </div>
          <span className="relative flex items-center">
            <Icon name="search" size={14} className="pointer-events-none absolute left-2.5 text-ink-3" />
            <input value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search visitors" placeholder="Search visitors, messages, email…" className="h-8 w-full rounded-[8px] border border-line bg-surface pr-2.5 pl-8 text-[13px] outline-none focus:border-primary" />
          </span>
          {section !== 'missed' && section !== 'invited' ? (
            <div className="flex gap-1 text-[11.5px] font-semibold" role="group" aria-label="Show">
              <Pill on={pill === 'open'} onClick={() => showOpen(false)}>Open · {openHere.length}</Pill>
              <Pill on={pill === 'mine'} onClick={() => showOpen(true)}>Mine · {openHere.filter(isMine).length}</Pill>
              <Pill on={pill === 'closed'} onClick={() => to({ section: 'closed', website: null })}>Closed</Pill>
            </div>
          ) : null}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto scroll-thin">
          {section === 'invited' ? (
            handoffs.length === 0 ? <Empty icon="users" title="No invitations" hint="When a colleague invites you into a website chat, or transfers one to you, it waits here." /> : handoffs.map((h) => (
              <InvitedRow key={h.id} h={h} hidden={ring.hidden} active={selected === String(h.conversationId)} onOpen={() => to({ website: String(h.conversationId) })} />
            ))
          ) : section === 'missed' ? (
            missed.isLoading ? <Spinner /> : missed.error ? <div className="p-4"><ErrorNote error={missed.error} onRetry={() => void missed.refetch()} /></div> : !missed.data?.missed.length && !callbackList.length ? (
              <Empty icon="globe" title="No missed chats" />
            ) : (
              <>
              {callbackList.length ? (
                <div role="group" aria-label="Call backs" className="border-b border-line">
                  <div className="px-3.5 pt-2 pb-1 text-[11px] font-bold tracking-[.06em] text-ink-3 uppercase">{text('Call backs · {n}', { n: callbackList.length })}</div>
                  {callbackList.map((b) => <CallbackRow key={b.id} b={b} active={selected === String(b.conversation_id)} onOpen={() => to({ website: String(b.conversation_id) })} />)}
                </div>
              ) : null}
              {(missed.data?.missed ?? []).map((m) => (
                <button key={m.id} type="button" data-website-row={m.id} onClick={() => to({ website: String(m.id) })} className={cx('relative flex w-full flex-col gap-[3px] border-b border-line py-2.5 pr-3 pl-3.5 text-left', selected === String(m.id) ? 'bg-selection' : 'hover:bg-subtle')}>
                  {selected === String(m.id) ? <span aria-hidden className="absolute top-0 bottom-0 left-0 w-[3px] bg-primary" /> : null}
                  <span className="flex items-center gap-[7px]"><b className="flex-1 truncate text-ink">{m.visitor}</b><span className="text-[11px] text-ink-3">{listStamp(m.missed_at)}</span></span>
                  <span className="truncate text-[12px] text-ink-2">{m.email ?? m.phone ?? 'No way to reach them'}{m.place ? ` · ${m.place}` : ''}</span>
                  <span className="text-[11px] text-ink-3">{m.widget}</span>
                </button>
              ))}
              </>
            )
          ) : list.isLoading ? <Spinner /> : list.error ? <div className="p-4"><ErrorNote error={list.error} onRetry={() => void list.refetch()} /></div> : rows.length === 0 ? (
            <Empty icon="globe" title={typed ? text('Nothing matches “{q}”', { q: q.trim() }) : pill === 'mine' || section === 'mine' ? 'No chats assigned to you' : section === 'awaiting' ? 'Nobody is waiting' : 'No website chats'} />
          ) : (
            rows.map((r) => <Row key={r.id} r={r} me={me} myName={myName} ring={ringing.get(r.id)} typing={typingRows.has(r.id)} active={selected === String(r.id)} onOpen={() => to({ website: String(r.id) })} />)
          )}
        </div>
      </section>
      <div className={cx('flex min-w-0 flex-1', live && 'hidden')}>
        {selected ? (
          <WebsiteThread key={selected} id={selected} row={openRows.find((r) => String(r.id) === selected)} />
        ) : (
          <PickConversation rows={openRows} longest={longest} visitors={online.isSuccess ? visitorsOnline : null} onLongest={openLongest} onVisitors={() => go('/chat?view=website&section=live')} />
        )}
      </div>
    </div>
  );
}

function Pill({ on, onClick, children }: { on: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" aria-pressed={on} onClick={onClick} className={cx('rounded-[10px] px-2.5 py-[3px]', on ? 'bg-ink text-surface' : 'border border-line text-ink hover:bg-subtle')}>
      {children}
    </button>
  );
}

const TAG = {
  danger: 'bg-danger-bg text-danger',
  indigo: 'bg-selection text-primary',
  warning: 'bg-warning-bg text-[#9A4A06] dark:text-warning',
  muted: 'bg-subtle text-ink-3',
};

function Tag({ tone, children }: { tone: keyof typeof TAG; children: ReactNode }) {
  return <span className={cx('shrink-0 rounded-[5px] px-1.5 py-px text-[10.5px] font-bold', TAG[tone])}>{children}</span>;
}

const PRIORITY_TAG: Record<string, string> = { vip: 'VIP', urgent: 'Urgent', high: 'High' };

function pathOf(url: string): string {
  try {
    return new URL(url).pathname || '/';
  } catch {
    return url;
  }
}

/** Which visitors are typing now, from the live frames (LIVE-02): a start lasts seven seconds unless a stop comes first. */
function useVisitorsTyping(): Set<number> {
  const now = useNow(1_000);
  const [until, setUntil] = useState<Record<number, number>>({});
  useEffect(
    () =>
      on<{ type: string; conversation_id?: number; who?: string; state?: string }>('realtime:event', (e) => {
        if (e.type !== 'chat.widget.typing' || e.who !== 'visitor' || !e.conversation_id) return;
        const cid = e.conversation_id;
        setUntil((u) => ({ ...u, [cid]: e.state === 'stop' ? 0 : Date.now() + 7_000 }));
      }),
    [],
  );
  return new Set(Object.entries(until).filter(([, t]) => t > now).map(([k]) => Number(k)));
}

/**
 * An invitation or a transfer waiting for me, in the Invited view (ENH-WCHAT-03, TEAM-09): who asks, the note, how long
 * is left, Join chat or Accept, and Decline. Opening the row reads the chat without joining it.
 */
function InvitedRow({ h, hidden, active, onOpen }: { h: WebchatHandoff; hidden: boolean; active: boolean; onOpen: () => void }) {
  const now = useNow(1_000);
  const left = h.expiresAt ? Math.max(0, Math.round((parseTs(h.expiresAt).getTime() - now) / 1000)) : null;
  const answer = (accept: boolean) => void call('ring:handoff', { id: h.id, accept }).catch(() => undefined);
  return (
    <div data-website-row={h.conversationId} className={cx('relative flex flex-col gap-1.5 border-b border-line py-2.5 pr-3 pl-3.5', active ? 'bg-selection' : 'hover:bg-subtle')}>
      {active ? <span aria-hidden className="absolute top-0 bottom-0 left-0 w-[3px] bg-primary" /> : null}
      <button type="button" onClick={onOpen} className="flex flex-col gap-[3px] text-left">
        <span className="flex items-center gap-1.5">
          <b className="flex-1 truncate text-ink">{hidden ? 'A visitor' : h.visitor}</b>
          <Tag tone="indigo">{handoffTitle(h)}</Tag>
          {left !== null ? <span className="shrink-0 font-mono text-[11px] text-ink-3" aria-label={`Expires in ${clock(left)}`}>{clock(left)}</span> : null}
        </span>
        <span className="truncate text-[12px] text-ink-2">{handoffAsk(h)}{h.site ? ` · ${h.site}` : ''}</span>
        {h.note && !hidden ? <span className="truncate text-[12px] text-[#7A4308] italic dark:text-warning" title="Only staff see this note">“{h.note}”</span> : null}
      </button>
      <span className="flex gap-1.5">
        <Button size="sm" variant="primary" onClick={() => answer(true)}>{h.kind === 'invite' ? 'Join chat' : 'Accept'}</Button>
        <Button size="sm" onClick={() => answer(false)}>Decline</Button>
      </span>
    </div>
  );
}

/**
 * A conversation in the list (CHAT-UI-00): the visitor with their on-site dot, how long they have waited, what is
 * happening, and on which site. A chat ringing here shows a bell; one silenced on this computer is amber with the
 * bell struck through (RING-UI-04).
 */
function Row({ r, me, myName, ring, typing = false, active, onOpen }: { r: WebsiteRow; me: number | null; myName: string | null; ring?: WebchatRingChat; typing?: boolean; active: boolean; onOpen: () => void }) {
  const name = r.visitor_name || r.label;
  const mine = me !== null && r.assigned_to === me;
  // Several staff in it: their faces, the owner first (TEAM-04); and what I am in it (TEAM-09).
  const faces = (r.team ?? []).filter((p) => p.role !== 'observer');
  const helping = !mine && r.my_role === 'participant';
  const closed = r.status === 'closed';
  const since = waitingSince(r);
  const page = r.current_url ? pathOf(r.current_url) : null;
  const unread = closed ? 0 : (r.unread ?? 0);
  const line = ring?.preview
    ? `“${ring.preview}”`
    : r.last_message
      ? lastSaid(r.last_message, myName)
      : r.online && page && !closed
      ? text('Reading {page}', { page })
      : r.agent
        ? mine
          ? text('With you')
          : text('With {name}', { name: r.agent })
        : (r.email ?? '');
  const presence = closed ? null : r.online ? 'online' : 'away';
  return (
    <button
      type="button"
      data-website-row={r.id}
      aria-current={active ? 'true' : undefined}
      onClick={onOpen}
      className={cx('relative flex w-full items-start gap-2.5 border-b border-line py-2.5 pr-3 pl-3.5 text-left', active ? 'bg-selection' : ring?.silenced ? 'bg-warning-bg' : 'hover:bg-subtle')}
    >
      {active ? <span aria-hidden className="absolute top-0 bottom-0 left-0 w-[3px] bg-primary" /> : null}
      <Avatar name={name} size={32} presence={presence} className="mt-px" />
      <span className="flex min-w-0 flex-1 flex-col gap-[3px]">
        <span className="flex items-center gap-1.5">
          <b className={cx('flex-1 truncate text-ink', r.awaiting_reply ? 'font-bold' : 'font-semibold')}>{name}</b>
          {ring ? <Icon name={ring.silenced ? 'bell-off' : 'bell'} size={12} className={ring.silenced ? 'shrink-0 text-warning' : 'shrink-0 text-danger'} label={ring.silenced ? text('Silenced on this computer') : text('Ringing')} /> : null}
          {r.awaiting_reply && since && !closed ? <WaitClock since={since} /> : <span className="shrink-0 text-[11px] text-ink-3">{listStamp(r.last_message?.at ?? r.last_visitor_at ?? r.updated_at)}</span>}
        </span>
        <span className="flex min-w-0 items-center gap-1.5">
          {r.call && !closed ? (
            <CallLine call={r.call} />
          ) : typing && !closed ? (
            <span className="min-w-0 flex-1 truncate text-[12px] font-semibold text-primary">{text('Typing…')}</span>
          ) : (
            <span className={cx('min-w-0 flex-1 truncate text-[12px]', unread ? 'font-semibold text-ink' : 'text-ink-2')}>{line}</span>
          )}
          {unread ? (
            <span className="min-w-[18px] shrink-0 rounded-full bg-primary px-1.5 text-center text-[10.5px] leading-[18px] font-bold text-white tabular-nums" aria-label={text('{n} unread', { n: unread })}>
              {unread > 99 ? '99+' : unread}
            </span>
          ) : null}
        </span>
        <span className="flex min-w-0 items-center gap-[5px] text-[11px]">
          {closed ? <Tag tone="muted">Closed</Tag> : r.awaiting_reply ? <Tag tone="danger">Awaiting reply</Tag> : mine ? <Tag tone="indigo">You</Tag> : helping ? <Tag tone="indigo">Participant</Tag> : null}
          {r.at_risk && !closed ? <Tag tone="danger">At risk</Tag> : null}
          {r.is_offline ? <Tag tone="muted">Offline</Tag> : null}
          {PRIORITY_TAG[r.priority] ? <Tag tone="warning">{PRIORITY_TAG[r.priority]}</Tag> : null}
          <span className="min-w-0 truncate text-ink-3">
            {r.site ?? r.widget ?? 'Website'}
            {presence === 'away' ? ` · ${text('away')}` : ''}
          </span>
          {presence === 'online' ? <span className="sr-only">On the site now</span> : null}
          {r.is_starred ? <Icon name="star" size={11} className="shrink-0 text-warning" label={text('Starred')} /> : null}
          {faces.length > 1 ? (
            <span className="ml-auto flex shrink-0" aria-label={text('In this chat: {names}', { names: faces.map((p) => p.name).join(', ') })}>
              {faces.slice(0, 3).map((p, i) => <Avatar key={p.user_id} name={p.name} src={p.avatar} size={16} className={cx('ring-2 ring-surface', i > 0 && '-ml-1')} />)}
            </span>
          ) : null}
        </span>
      </span>
    </button>
  );
}

/** How long a visitor has waited: counting while it is under an hour, then when they wrote. */
/** "On a call · 2:14" on a row (VOICE-UI-02): calling, on, or on hold. */
function CallLine({ call }: { call: NonNullable<WebsiteRow['call']> }) {
  const now = useNow(1_000);
  const at = call.since ? parseTs(call.since).getTime() : NaN;
  const time = Number.isNaN(at) ? '' : ` · ${clock((now - at) / 1000)}`;
  const words = call.status === 'ringing' ? text('Calling') : call.status === 'on_hold' ? text('On hold') : text('On a call');
  return (
    <span className="flex min-w-0 flex-1 items-center gap-1 truncate text-[12px] font-semibold text-success">
      <Icon name={call.status === 'ringing' ? 'phone-incoming' : 'phone'} size={12} className={cx('shrink-0', call.status === 'ringing' && 'motion-safe:animate-pulse')} />
      <span className="truncate tabular-nums">{words}{time}</span>
    </span>
  );
}

const OUTCOMES: Array<{ id: CallbackOutcome; label: string }> = [
  { id: 'answered', label: 'Answered' },
  { id: 'no_answer', label: 'No answer' },
  { id: 'wrong_number', label: 'Wrong number' },
];

/** A visitor waiting to be called back (VOICE-16): their number, the best time, and how the call went once made. */
function CallbackRow({ b, active, onOpen }: { b: WebsiteCallback; active: boolean; onOpen: () => void }) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const log = (outcome: CallbackOutcome) => {
    setBusy(true);
    void apiPost(`${WEBSITE}/callbacks/${b.id}/done`, { outcome }).then(
      () => {
        toast('success', text('Call back logged'));
        void qc.invalidateQueries({ queryKey: ['website'] });
      },
      (e) => {
        toast('error', errorMessage(e));
        setBusy(false);
      },
    );
  };
  return (
    <div data-website-row={b.conversation_id} className={cx('relative flex flex-col gap-1 border-t border-line py-2 pr-3 pl-3.5 first-of-type:border-t-0', active ? 'bg-selection' : 'hover:bg-subtle')}>
      {active ? <span aria-hidden className="absolute top-0 bottom-0 left-0 w-[3px] bg-primary" /> : null}
      <button type="button" onClick={onOpen} className="flex flex-col gap-[3px] text-left">
        <span className="flex items-center gap-[7px]">
          <Icon name="phone" size={12} className="shrink-0 text-primary" />
          <b className="flex-1 truncate text-ink">{b.visitor}</b>
          <span className="text-[11px] text-ink-3">{listStamp(b.created_at)}</span>
        </span>
        <span className="truncate text-[12px] text-ink-2">
          <span className="font-semibold text-ink select-text">{b.phone}</span>
          {b.best_time ? ` · ${b.best_time}` : ''}
        </span>
        <span className="flex items-center gap-[5px] text-[11px]">
          {b.missed_call ? <Tag tone="danger">{text('Missed call')}</Tag> : null}
          <span className="truncate text-ink-3">{b.site ?? 'Website'}</span>
        </span>
      </button>
      <span className="flex flex-wrap items-center gap-1" role="group" aria-label={text('How the call back went')}>
        {OUTCOMES.map((o) => (
          <button key={o.id} type="button" disabled={busy} onClick={() => log(o.id)} className="h-6 rounded-[6px] border border-line bg-surface px-2 text-[11.5px] font-semibold text-ink hover:bg-subtle disabled:opacity-50">
            {o.label}
          </button>
        ))}
      </span>
    </div>
  );
}

function WaitClock({ since }: { since: string }) {
  const now = useNow(1_000);
  const at = parseTs(since).getTime();
  if (Number.isNaN(at) || now - at >= 3_600_000) return <span className="shrink-0 text-[11px] text-ink-3">{listStamp(since)}</span>;
  return <span className="shrink-0 text-[11.5px] font-bold text-danger tabular-nums">{waited(since, now)}</span>;
}

/**
 * Nothing open yet (CHAT-UI-00): how many visitors are waiting and for how long the longest has, a way straight to
 * them, the visitors on the sites now, and the keys that move through the list.
 */
function PickConversation({ rows, longest, visitors, onLongest, onVisitors }: { rows: WebsiteRow[]; longest: WebsiteRow | null; visitors: number | null; onLongest: () => void; onVisitors: () => void }) {
  const now = useNow(30_000);
  return (
    <div className="flex h-full min-h-[160px] flex-1 flex-col items-center justify-center gap-2 p-8 text-center">
      <span className="flex h-11 w-11 items-center justify-center rounded-full border border-line bg-surface text-ink-3">
        <Icon name="globe" size={20} />
      </span>
      <div className="text-[14px] font-semibold text-ink">Pick a conversation</div>
      <div className="max-w-sm text-[12.5px] text-ink-3">{waitingSummary(rows, now)}</div>
      <div className="mt-1.5 flex flex-wrap justify-center gap-2">
        {longest ? (
          <Button variant="primary" size="sm" onClick={onLongest}>
            Open the longest waiting
          </Button>
        ) : null}
        <Button size="sm" onClick={onVisitors}>
          {visitors === null ? 'Visitors online' : `${text('Visitors online')} · ${visitors}`}
        </Button>
      </div>
      <div className="mt-2 flex items-center gap-1 text-[11.5px] text-ink-3">
        Press <Kbd tone="key">J</Kbd> / <Kbd tone="key">K</Kbd> to move through the list
      </div>
    </div>
  );
}
