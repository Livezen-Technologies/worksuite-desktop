import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react';
import type { WebchatHandoff, WebchatRingChat } from '@shared/types';
import { apiGet, apiPost } from '../../../core/api';
import { call, errorMessage, isMac, on } from '../../../core/bridge';
import { toast } from '../../../core/toasts';
import { app } from '../../../core/app-state';
import { text } from '../../../core/i18n';
import { useStore } from '../../../core/store';
import { navigate } from '../../../core/tabs';
import { useTab, useTabTitle } from '../../../core/tab-context';
import { listStamp } from '../../../core/time';
import { Icon } from '../../../components/Icon';
import { Avatar, Button, Empty, ErrorNote, Kbd, Spinner, cx } from '../../../components/ui';
import { useNow } from '../../calls/parts';
import { followUpsFirst, isMine as mineFor, longestWaiting, PRIORITIES, sectionRows, sortWebsiteRows, stepRow, useCallbacks, useWebsiteInbox, useWebsiteSearch, waitingSince, waitingSummary, WEBSITE, WEBSITE_SORTS, type CallbackOutcome, type Section, type WebsiteCallback, type WebsitePriority, type WebsiteRow, type WebsiteSort } from './api';
import { CallbackCard, useCallbackCounts, useCallbackList } from './Callbacks';
import { ClosedDetail, ClosedRow } from './Closed';
import { MissedDetail, MissedRow, useMissed, type MissedTab } from './Missed';
import { OfflineDetail, OfflineRow, useOffline } from './Offline';
import { clock, handoffAsk, handoffLeft, handoffTitle, useRingState } from './Ringing';
import { CallLine, FilterPill as Pill, pathOf, PRIORITY_TAG, ROW_SILENCED, RingBell, rowPreview, Tag, WaitClock } from './rowParts';
import { WebsiteTable } from './WebsiteTable';
import { WebsiteLive, type LiveView, type OnlineVisitor } from './WebsiteLive';
import { liveParamsOf, liveQuery, type LiveParams } from './live/LiveDashboard';
import { WebsiteThread } from './WebsiteThread';
import { VoiceCalls } from './VoiceCalls';
import { WidgetSettings } from './widget/WidgetSettings';
import { WebsiteWidgets } from './widget/Widgets';
import { WebsiteInsights, type InsightsPeriod } from './Insights';
import { AutomatedMessages } from './Automated';
import { BusinessHours } from './BusinessHours';
import { SavedRepliesScreen } from './SavedReplies';
import { ConversationStarters } from './Starters';
import { ConversationMenu } from '../ConversationMenu';
import { MyStatus } from '../MyStatus';
import { Select } from '../../../components/Select';
import { SidePanel } from '../../../components/SidePanel';

/**
 * Website chats as their own workspace (WebChatInbox): the sections down the
 * left, the conversations in the chosen one, then the visitor's thread and
 * dossier. Widgets & embed is this app's own (S-01, S-02): the widgets as cards, and each widget's editor with a live
 * preview; Insights is read here (L-07); Automated messages are edited here (S-07), and so are Conversation starters
 * (S-08), Saved replies (S-09) and Business hours (S-10): nothing under SETUP opens on the web any more.
 */
const SECTIONS: Array<{ id: Section; label: string; icon: string }> = [
  // In the order of the design (C-01, DsWsNav): what comes in, then what is mine, then the rest.
  { id: 'inbox', label: 'Inbox', icon: 'inbox' },
  { id: 'live', label: 'Live chats', icon: 'chat' },
  { id: 'offline', label: 'Offline enquiries', icon: 'mail' },
  { id: 'missed', label: 'Missed chats', icon: 'alert' },
  // Visitors who asked to be contacted, with a reference and a due time (worksuite-desktop#223).
  { id: 'callbacks', label: 'Callbacks', icon: 'phone' },
  // Chats I own or take part in (ENH-WCHAT-03, TEAM-09).
  { id: 'mine', label: 'Assigned to me', icon: 'user' },
  { id: 'unassigned', label: 'Unassigned', icon: 'user-x' },
  { id: 'awaiting', label: 'Awaiting reply', icon: 'clock' },
  // Invitations and transfers waiting for me.
  { id: 'invited', label: 'Invited', icon: 'user-plus' },
  { id: 'starred', label: 'Starred', icon: 'star' },
  { id: 'closed', label: 'Closed', icon: 'archive' },
];

/**
 * The list views drawn as one table while nothing is open (C-03, UX-LIST-01): each with its own heading. Invited stays
 * the list of invitations, each with its own answer; the rest keep the card list.
 */
const TABLE: Partial<Record<Section, { title: string; subtitle: string; footnote?: string }>> = {
  live: {
    title: 'Live chats',
    subtitle: 'Open conversations with a visitor still on the site.',
    footnote: 'Departed visitors leave this list at once; their open chats stay under Awaiting reply until closed or swept as inactive.',
  },
  unassigned: { title: 'Unassigned', subtitle: 'Open conversations nobody has taken yet.' },
  mine: { title: 'Assigned to me', subtitle: 'Open conversations you own or take part in.' },
  awaiting: { title: 'Awaiting reply', subtitle: 'Visitors who spoke last and are waiting for an answer.' },
  starred: { title: 'Starred', subtitle: 'Open conversations starred to come back to.' },
};

/**
 * SETUP after Widgets & embed and Automated messages (S-07), in the design's order (DsWsNav): Conversation starters
 * (S-08, `active="starters"`), Saved replies (S-09, `saved`) and Business hours (S-10, `hours`), each this app's own.
 */
const SETUP: Array<{ id: 'starters' | 'saved' | 'hours'; label: string; icon: string }> = [
  { id: 'starters', label: 'Conversation starters', icon: 'message-circle' },
  { id: 'saved', label: 'Saved replies', icon: 'bookmark' },
  { id: 'hours', label: 'Business hours', icon: 'clock' },
];

export function WebsiteWorkspace() {
  const { query, go, active } = useTab();
  const me = useStore(app, (s) => (s.auth?.user?.id ? Number(s.auth.user.id) : null));
  const myName = useStore(app, (s) => s.bootstrap?.user?.name ?? null);
  // The organisation's ringing rules (P-03, Admin Center › Chat › Ringing): for whoever manages website chats.
  const managesRinging = useStore(app, (s) => !!s.bootstrap?.permissions?.some((p) => p === '*' || p === 'chat.widget.manage'));
  const selected = query.get('website');
  // The LIVE views (worksuite-desktop#231): each its own section — not `live`, which is the Live chats section and
  // lit up beside both — with the selected visitor in the address.
  const liveView: LiveView | null = query.get('section') === 'dashboard' ? 'dashboard' : query.get('section') === 'visitors' ? 'visitors' : null;
  const live = liveView !== null;
  const liveVisitor = Number(query.get('visitor')) || null;
  // The dashboard's view, so it can be bookmarked and comes back with the tab (MAP-15): `map=lk` while the full map is
  // open, its state chip, Now or Today, the place picked, the sites, and Wall mode.
  const liveParams = liveParamsOf(query);
  const goLive = (patch: Partial<LiveParams>, visitor: number | null) => {
    if (!liveView) return;
    go(`/chat?${liveQuery(liveView, { ...liveParams, ...patch }, visitor).toString()}`);
  };
  // Widgets & embed (S-01) and one widget's editor (S-02), with the widget and its tab in the address.
  const widgetList = query.get('section') === 'widgets';
  const designing = query.get('section') === 'widget';
  // Voice calls (V-01): a LIVE view of its own, full width, with the picked call in the address.
  const calling = query.get('section') === 'calls';
  const pickedCall = Number(query.get('voice')) || null;
  // Its Call-backs half (V-02), with the opened request in the address too.
  const callBacks = calling && query.get('show') === 'callbacks';
  const pickedCallback = Number(query.get('callback')) || null;
  // Insights (L-07, X-UI-13): its period and widget in the address, so the view comes back with the tab.
  const insights = query.get('section') === 'insights';
  const insightsPeriod: InsightsPeriod = query.get('period') === '7d' ? '7d' : query.get('period') === 'all' ? 'all' : '30d';
  const insightsWidget = Number(query.get('widget')) || null;
  // Automated messages (S-07, X-UI-19): the rules and the one open, `rule` in the address (`new` for a new one).
  const automated = query.get('section') === 'automated';
  // Conversation starters (S-08), Saved replies (S-09) and Business hours (S-10): `widget`, `starter` and `reply` in the address.
  const setup = SETUP.find((x) => x.id === query.get('section'))?.id ?? null;
  // Everything that takes the whole width, hiding the list and the thread.
  const wide = live || widgetList || designing || calling || insights || automated || setup !== null;
  const section = (SECTIONS.find((s) => s.id === query.get('section'))?.id ?? 'inbox') as Section;
  const [site, setSite] = useState(0);
  // The Mine pill narrows whichever open section is showing; Closed is a section of its own.
  const [mineOnly, setMineOnly] = useState(false);

  // The list views' priority filter and order (UX-LIST-01).
  const [priority, setPriority] = useState<WebsitePriority | ''>('');
  const [sort, setSort] = useState<WebsiteSort>('waiting');
  const table = TABLE[section] ?? null;

  const [q, setQ] = useState('');
  // The conversation menu at the mouse, shared with Chat's other channels (worksuite-desktop#183).
  const [rowMenu, setRowMenu] = useState<{ x: number; y: number; r: WebsiteRow } | null>(null);
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
  // To follow up / Handled (C-04, UX-MISS-01). A server without the tabs sends no Handled count, and shows the one list.
  const [missedTab, setMissedTab] = useState<MissedTab>('todo');
  const missed = useMissed(missedTab, section === 'missed');
  const missedTabs = missed.data ? missed.data.handled !== undefined : true;
  const missedCount = useQuery({
    queryKey: ['website', 'missed', 'count'],
    queryFn: ({ signal }) => apiGet<{ count: number }>(`${WEBSITE}/missed/count`, undefined, signal),
    refetchInterval: 60_000,
    retry: false,
  });
  /*
   * Offline enquiries (C-05): their own list, answered ones too, with why each was left. An older server has no such
   * list (404) and the section keeps showing the inbox's `is_offline` rows as before.
   */
  const offline = useOffline();
  const enquiries = !offline.isError;
  // Visitors waiting to be called back (VOICE-16): first in Missed chats on a server without the Callbacks section;
  // with it (#223), they have that section, its count and its overdue mark.
  const callbackCounts = useCallbackCounts();
  const structured = callbackCounts.isSuccess;
  const callbacks = useCallbacks(!structured);
  const callbackList = structured ? [] : (callbacks.data ?? []);
  const [cbStatus, setCbStatus] = useState<'todo' | 'handled'>('todo');
  const cbList = useCallbackList(cbStatus, mineOnly, section === 'callbacks' && structured);
  // What rings on this computer: the row shows it, and a silenced one is marked (RING-24).
  const ring = useRingState();
  // Visitors waiting on me in my chats (#230), and chats ringing for me (R-06, RING-45): "(3) Website chats".
  const waitingOnMe = (ring.followUps?.length ?? 0) + ring.chats.length;
  useTabTitle(selected ? null : waitingOnMe ? `(${waitingOnMe}) Website chats` : 'Website chats');
  const ringing = new Map(ring.chats.map((c) => [c.id, c]));
  const handoffs = ring.handoffs ?? [];
  // Visitors typing now, for their rows (LIVE-02).
  const typingRows = useVisitorsTyping();
  const openRows = open.data?.conversations ?? [];
  // Calls ringing or on now, from the list the inbox already polls: the Voice calls entry's count (V-01).
  const liveCalls = openRows.filter((r) => !!r.call).length;
  const sites = open.data && 'sites' in open.data ? ((open.data as { sites?: Array<{ widget_id: number; site: string }> }).sites ?? []) : [];
  const count = (s: Section): number => (s === 'missed' ? (missedCount.data?.count ?? 0) + callbackList.length : s === 'callbacks' ? (callbackCounts.data?.todo ?? 0) : s === 'invited' ? handoffs.length : s === 'closed' ? 0 : s === 'offline' && offline.data ? offline.data.count : sectionRows(openRows, s, me).length);
  const overdue = callbackCounts.data?.overdue ?? 0;
  const source = section === 'closed' ? closed : open;
  // The list views have no pills: a Mine left on from another section does not narrow them unseen.
  const pill = section === 'closed' ? 'closed' : mineOnly && !table ? 'mine' : 'open';
  const onSite = (r: WebsiteRow) => !site || r.widget_id === site;
  const isMine = (r: WebsiteRow) => mineFor(r, me);
  const openHere = sectionRows(openRows, section === 'closed' ? 'inbox' : section, me).filter(onSite);
  const typed = q.trim().toLowerCase();
  const ownList = section === 'missed' || (section === 'offline' && enquiries);
  const searching = !ownList && section !== 'invited' && section !== 'callbacks' && needle.length >= 2 && typed.length >= 2;
  const found = useWebsiteSearch(searching ? needle : '', section === 'closed');
  // Until the server answers, the list narrows by what it already has.
  const narrowed = (searching && found.data ? found.data.conversations : sectionRows(source.data?.conversations ?? [], section, me))
    .filter(onSite)
    .filter((r) => pill !== 'mine' || isMine(r))
    .filter((r) => (searching && found.data) || !typed || [r.label, r.visitor_name, r.email, r.site, r.current_url, r.last_message?.body].some((v) => v?.toLowerCase().includes(typed)));
  // The list views (the table, and the card list beside an open chat) filter by priority and keep their own order.
  const rows = table
    ? (sort === 'waiting' ? (l: WebsiteRow[]) => followUpsFirst(l, isMine) : (l: WebsiteRow[]) => l)(sortWebsiteRows(narrowed.filter((r) => !priority || r.priority === priority), sort))
    : followUpsFirst(narrowed, isMine);
  // Full width while nothing is open; beside an open chat, the card list.
  const tableView = !!table && !selected && !wide;
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
  // A spinner, an error, or the section's empty text, in place of the rows of either list.
  const listPlaceholder: ReactNode = list.isLoading ? <Spinner /> : list.error ? <div className="p-4"><ErrorNote error={list.error} onRetry={() => void list.refetch()} /></div> : rows.length === 0 ? (
    <Empty icon="globe" title={typed ? text('Nothing matches “{q}”', { q: q.trim() }) : pill === 'mine' || section === 'mine' ? 'No chats assigned to you' : section === 'awaiting' ? 'Nobody is waiting' : 'No website chats'} />
  ) : null;
  const searchBox = (wide: boolean) => (
    <span className={cx('relative flex items-center', wide && 'w-[280px] shrink-0')}>
      <Icon name="search" size={14} className="pointer-events-none absolute left-2.5 text-ink-3" />
      <input value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search visitors" placeholder={section === 'closed' ? text('Search closed chats…') : text('Search visitors, messages, email…')} className={cx('w-full rounded-[8px] border border-line bg-surface pr-2.5 pl-8 outline-none focus:border-primary', wide ? 'h-8 text-[12.5px]' : 'h-[34px] text-[13px]')} />
    </span>
  );
  const siteSelect = (
    <Select aria-label="Site" value={site} onChange={(e) => setSite(Number(e.target.value))} className="h-8 rounded-[8px] border border-line bg-surface px-2 text-[12.5px] text-ink">
      <option value={0}>All sites</option>
      {sites.map((s) => <option key={s.widget_id} value={s.widget_id}>{s.site}</option>)}
    </Select>
  );
  const longest = longestWaiting(openRows);
  const openLongest = () => {
    if (!longest) return;
    // Stay in the section when the visitor is in it, so the list shows what is open.
    to({ section: rows.some((r) => r.id === longest.id) ? section : 'inbox', website: String(longest.id) });
  };

  /*
   * A missed chat is no longer handled by opening it (MIS-05 on the web): C-04 reads it back without arriving and has
   * Mark handled for that, so looking first and deciding after is possible, and Handled says who did it.
   */
  const missedRows = (missed.data?.missed ?? []).filter((m) => !typed || [m.visitor, m.email, m.phone, m.preview, m.widget, m.place].some((v) => v?.toLowerCase().includes(typed)));
  const missedOpen = section === 'missed' && selected ? missedRows.find((m) => String(m.id) === selected) ?? (missed.data?.missed ?? []).find((m) => String(m.id) === selected) : undefined;
  // A legacy call back in Missed chats opens its conversation, as it always has.
  const missedDetail = section === 'missed' && !!selected && (!!missedOpen || (!callbackList.some((b) => String(b.conversation_id) === selected) && missedTabs));

  // The enquiries, narrowed by the site picked and the search box; the open one may be outside them (C-05).
  const offlineRows = (offline.data?.offline ?? []).filter((e) => !site || e.widget_id === site)
    .filter((e) => !typed || [e.visitor, e.company, e.email, e.phone, e.preview, e.widget, e.place].some((v) => v?.toLowerCase().includes(typed)));
  const offlineDetail = section === 'offline' && enquiries && !!selected;
  const offlineOpen = offlineDetail ? (offline.data?.offline ?? []).find((e) => String(e.id) === selected) : undefined;

  // Ctrl/Cmd+[ goes back to Chat (C-01), while this tab is in front.
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === '[' && (isMac ? e.metaKey : e.ctrlKey) && !e.altKey && !e.shiftKey) {
        e.preventDefault();
        go('/chat');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active, go]);

  // J and K move through the list (CHAT-UI-00) while this tab is in front and nothing is being typed.
  const ids = section === 'missed' ? missedRows.map((m) => m.id) : section === 'offline' && enquiries ? offlineRows.map((e) => e.id) : section === 'invited' ? handoffs.map((h) => h.conversationId)
    : section === 'callbacks' ? (cbList.data?.callbacks ?? []).map((b) => b.conversation_id) : rows.map((r) => r.id);
  const idsKey = ids.join(',');
  useEffect(() => {
    if (!active || wide) return;
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
  }, [active, wide, idsKey, selected, section, go]);

  return (
    <div className="flex h-full min-w-0 flex-1 text-[13px]">
      <SidePanel id="website-chats" label="the website chat menu">
        <nav aria-label="Website chats" className="flex w-[212px] shrink-0 flex-col gap-px overflow-y-auto border-r border-line bg-surface px-2 pt-3 pb-2.5 scroll-thin">
          {/* Back to Chat as a tile, with its shortcut (C-01). */}
          <button type="button" onClick={() => go('/chat')} title={`${text('Back to Chat')} (${isMac ? '⌘[' : 'Ctrl+['})`} className="mb-2 flex h-8 items-center gap-2 rounded-[8px] border border-line bg-subtle px-2 text-left text-[12.5px] font-semibold text-primary hover:bg-selection">
            <Icon name="chevron-left" size={14} />
            <span className="flex h-[22px] w-[22px] items-center justify-center rounded-[6px] bg-selection"><Icon name="chat" size={13} /></span>
            <span className="flex-1">{text('Back to Chat')}</span>
            <Kbd tone="key">{isMac ? '⌘[' : 'Ctrl+['}</Kbd>
          </button>
          <div className="flex items-center gap-2 px-1.5 pb-1.5">
            <span className="flex h-[26px] w-[26px] items-center justify-center rounded-[7px] bg-primary text-white"><Icon name="globe" size={15} /></span>
            <b className="text-[15.5px] text-ink">Website Chats</b>
          </div>
          <MenuHead>CONVERSATIONS</MenuHead>
          {SECTIONS.filter((s) => s.id !== 'callbacks' || structured).map((s) => {
            const n = count(s.id);
            // Lit only while it is what shows: not under a LIVE view or the Widget (#231).
            const here = !wide && section === s.id;
            return (
              <MenuItem key={s.id} icon={s.icon} label={s.label} here={here} onClick={() => to({ section: s.id, website: null, visitor: null })}>
                {/* Overdue callbacks: a red dot beside the count, and said (#223). */}
                {s.id === 'callbacks' && overdue ? <span className="mr-1 h-1.5 w-1.5 rounded-full bg-danger" role="img" aria-label={text('{n} overdue', { n: overdue })} title={text('{n} overdue', { n: overdue })} /> : null}
                <CountPill n={n} here={here} tone={s.id === 'missed' || (s.id === 'callbacks' && overdue) ? 'danger' : 'plain'} />
              </MenuItem>
            );
          })}
          <MenuHead>LIVE</MenuHead>
          {([
            ['dashboard', 'Live dashboard', 'activity', null, 'green'],
            ['visitors', 'Visitors online', 'eye', visitorsOnline, 'green'],
            // Voice calls (V-01; C-01's DsWsNav): the calls ringing or on now, amber.
            ['calls', 'Voice calls', 'phone', liveCalls, 'amber'],
          ] as const).map(([id, label, icon, n, tone]) => (
            <MenuItem key={id} icon={icon} label={label} here={query.get('section') === id} onClick={() => go(`/chat?view=website&section=${id}`)}>
              <CountPill n={n} here={query.get('section') === id} tone={tone} />
            </MenuItem>
          ))}
          <div className="flex flex-col gap-px">
            <MenuHead>REPORTS</MenuHead>
            {/* Insights is this app's own (L-07, X-UI-13). */}
            <MenuItem icon="chart" label="Insights" here={insights} onClick={() => go('/chat?view=website&section=insights')} />
          </div>
          <div className="flex flex-col gap-px">
            <MenuHead>SETUP</MenuHead>
            {/* The widgets and each one's editor, with a live preview, are this app's own (S-01, S-02). */}
            <MenuItem icon="code" label="Widgets & embed" here={widgetList || designing} onClick={() => go('/chat?view=website&section=widgets')} />
            {/* Automated messages (S-07), second under SETUP as the design has them. */}
            <MenuItem icon="zap" label="Automated messages" here={automated} onClick={() => go('/chat?view=website&section=automated')} />
            {SETUP.map((x) => (
              <MenuItem key={x.id} icon={x.icon} label={x.label} here={setup === x.id} onClick={() => go(`/chat?view=website&section=${x.id}`)} />
            ))}
            {/* Who is rung, and when: the Admin Center's Chat › Ringing, in Settings (P-03). */}
            {managesRinging ? <MenuItem icon="bell" label="Ringing" here={false} onClick={() => navigate('/settings/admin/chat/ringing')} /> : null}
          </div>
          <MyStatus variant="website" open={openRows.filter(isMine).length} />
        </nav>
      </SidePanel>
      {liveView ? (
        <WebsiteLive
          view={liveView}
          selected={liveVisitor}
          live={liveParams}
          onLive={(patch) => goLive(patch, liveVisitor)}
          onSelect={(id) => goLive({}, id)}
          onOpenChat={(id, then) => go(`/chat?view=website&section=inbox&website=${id}${then === 'invite' ? '&invite=1' : ''}`)}
          onSection={(s) => go(`/chat?view=website&section=${s}`)}
        />
      ) : null}
      {widgetList ? (
        <WebsiteWidgets
          onOpen={(id, tab) => go(`/chat?${new URLSearchParams({ view: 'website', section: 'widget', widget: String(id), ...(tab ? { tab } : {}) }).toString()}`)}
          onInsights={() => go('/chat?view=website&section=insights&period=7d')}
        />
      ) : null}
      {designing ? <WidgetSettings key={query.get('widget') ?? ''} onList={() => go('/chat?view=website&section=widgets')} /> : null}
      {automated ? (
        <AutomatedMessages selected={query.get('rule')} onSelect={(rule) => go(`/chat?${new URLSearchParams({ view: 'website', section: 'automated', ...(rule ? { rule } : {}) }).toString()}`)} />
      ) : null}
      {setup === 'starters' ? (
        <ConversationStarters
          widget={Number(query.get('widget')) || null}
          selected={query.get('starter')}
          onSelect={(widget, starter) => go(`/chat?${new URLSearchParams({ view: 'website', section: 'starters', widget: String(widget), ...(starter ? { starter } : {}) }).toString()}`)}
        />
      ) : null}
      {setup === 'saved' ? (
        <SavedRepliesScreen selected={query.get('reply')} onSelect={(reply) => go(`/chat?${new URLSearchParams({ view: 'website', section: 'saved', ...(reply ? { reply } : {}) }).toString()}`)} />
      ) : null}
      {setup === 'hours' ? (
        <BusinessHours
          widget={Number(query.get('widget')) || null}
          onWidget={(widget) => go(`/chat?view=website&section=hours&widget=${widget}`)}
          onAppearance={(widget) => go(`/chat?view=website&section=widget&widget=${widget}&tab=appearance`)}
        />
      ) : null}
      {insights ? (
        <WebsiteInsights
          period={insightsPeriod}
          widget={insightsWidget}
          onChange={(p) => go(`/chat?${new URLSearchParams({ view: 'website', section: 'insights', ...(p.period !== '30d' ? { period: p.period } : {}), ...(p.widget ? { widget: String(p.widget) } : {}) }).toString()}`)}
        />
      ) : null}
      {calling ? (
        <VoiceCalls
          // Before the counts answer, a server with Call-backs is assumed: the half asked for shows without a flash of Calls.
          show={callBacks && !callbackCounts.isError ? 'callbacks' : 'calls'}
          selected={pickedCall}
          onSelect={(id) => go(`/chat?${new URLSearchParams({ view: 'website', section: 'calls', ...(id ? { voice: String(id) } : {}) }).toString()}`)}
          onOpenChat={(id) => go(`/chat?view=website&section=inbox&website=${id}`)}
          // Call-backs (V-02) are the hub's other half; on a server without them, they are still in Missed chats.
          onCallbacks={() => go(structured ? '/chat?view=website&section=calls&show=callbacks' : '/chat?view=website&section=missed')}
          onCalls={() => go('/chat?view=website&section=calls')}
          callbacksOpen={structured ? (callbackCounts.data?.todo ?? 0) : callbackList.length}
          pickedCallback={pickedCallback}
          onPickCallback={(id) => go(`/chat?${new URLSearchParams({ view: 'website', section: 'calls', show: 'callbacks', ...(id ? { callback: String(id) } : {}) }).toString()}`)}
        />
      ) : null}
      {tableView && table ? (
        <WebsiteTable
          title={table.title}
          subtitle={table.subtitle}
          footnote={table.footnote}
          filters={
            <div className="flex flex-wrap items-center gap-2">
              {searchBox(true)}
              {siteSelect}
              <Select<WebsitePriority | ''> aria-label="Priority" value={priority} onValueChange={setPriority} options={[{ value: '', label: 'Any priority' }, ...PRIORITIES.map((p) => ({ value: p.id, label: p.label }))]} className="h-8 rounded-[8px] border border-line bg-surface px-2 text-[12.5px] text-ink" />
              <span className="flex-1" />
              <span className="text-[12.5px] text-ink-3">{text('Sort')}</span>
              <Select<WebsiteSort> aria-label="Sort" value={sort} onValueChange={setSort} options={WEBSITE_SORTS.map((o) => ({ value: o.id, label: o.label }))} className="h-8 rounded-[8px] border border-line bg-surface px-2 text-[12.5px] text-ink" />
            </div>
          }
          rows={rows}
          placeholder={listPlaceholder ?? undefined}
          me={me}
          myName={myName}
          ringing={ringing}
          typing={typingRows}
          active={active}
          onOpen={(r) => to({ website: String(r.id) })}
          onMenu={(e, r) => (e.preventDefault(), setRowMenu({ x: e.clientX, y: e.clientY, r }))}
        />
      ) : null}
      {rowMenu ? <ConversationMenu x={rowMenu.x} y={rowMenu.y} target={{ kind: 'website', row: rowMenu.r }} onClose={() => setRowMenu(null)} /> : null}
      <section aria-label="Conversations" className={cx('flex w-[320px] shrink-0 flex-col border-r border-line bg-surface', (wide || tableView) && 'hidden')}>
        <div className="flex flex-col gap-2 border-b border-line p-3">
          <div className="flex items-center gap-2">
            <b className="flex-1 text-[18px] text-ink">{SECTIONS.find((s) => s.id === section)?.label}</b>
            {/* C-04: how many are still owed a reply, in red beside the heading. */}
            {section === 'missed' && missed.data?.count ? <span className="shrink-0 rounded-[8px] bg-danger-bg px-2 py-0.5 text-[11px] font-bold text-danger">{text('{n} to follow up', { n: missed.data.count })}</span> : null}
            {section !== 'missed' ? siteSelect : null}
          </div>
          {section === 'missed' ? <div className="-mt-1 text-[12px] text-ink-3">{text('Visitors who wrote and left before anyone replied.')}</div> : null}
          {section === 'offline' ? <div className="-mt-1 text-[12px] text-ink-3">{text('Messages left while nobody was available or outside business hours.')}</div> : null}
          {searchBox(false)}
          {section === 'missed' && missedTabs ? (
            <div className="flex gap-1.5 text-[12px] font-semibold" role="group" aria-label="Show">
              <Pill on={missedTab === 'todo'} onClick={() => setMissedTab('todo')}>{text('To follow up · {n}', { n: missed.data?.count ?? missedCount.data?.count ?? 0 })}</Pill>
              <Pill on={missedTab === 'handled'} onClick={() => setMissedTab('handled')}>{missed.data?.handled !== undefined ? text('Handled · {n}', { n: missed.data.handled }) : text('Handled')}</Pill>
            </div>
          ) : section === 'callbacks' ? (
            <div className="flex gap-1.5 text-[12px] font-semibold" role="group" aria-label="Show">
              <Pill on={cbStatus === 'todo'} onClick={() => setCbStatus('todo')}>{text('To do · {n}', { n: callbackCounts.data?.todo ?? 0 })}</Pill>
              <Pill on={cbStatus === 'handled'} onClick={() => setCbStatus('handled')}>{text('Handled')}</Pill>
              <Pill on={mineOnly} onClick={() => setMineOnly((m) => !m)}>{text('Mine')}</Pill>
            </div>
          ) : !ownList && section !== 'invited' && section !== 'closed' && !table ? (
            <div className="flex gap-1.5 text-[12px] font-semibold" role="group" aria-label="Show">
              <Pill on={pill === 'open'} onClick={() => showOpen(false)}>Open · {openHere.length}</Pill>
              <Pill on={pill === 'mine'} onClick={() => showOpen(true)}>Mine · {openHere.filter(isMine).length}</Pill>
              <Pill on={pill === 'closed'} onClick={() => to({ section: 'closed', website: null })}>Closed</Pill>
            </div>
          ) : null}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto scroll-thin">
          {section === 'callbacks' ? (
            cbList.isLoading ? <Spinner /> : cbList.error ? <div className="p-4"><ErrorNote error={cbList.error} onRetry={() => void cbList.refetch()} /></div> : !(cbList.data?.callbacks.length) ? (
              <Empty icon="phone" title={cbStatus === 'todo' ? 'Nobody is waiting to be contacted' : 'No callbacks handled yet'} hint={cbStatus === 'todo' ? 'When a visitor asks for a callback on the website, it waits here with its reference and when it is due.' : undefined} />
            ) : (
              cbList.data.callbacks.map((b) => <CallbackCard key={b.id} b={b} compact active={selected === String(b.conversation_id)} onOpen={() => to({ website: String(b.conversation_id) })} />)
            )
          ) : section === 'invited' ? (
            handoffs.length === 0 ? <Empty icon="users" title="No invitations" hint="When a colleague invites you into a website chat, or transfers one to you, it waits here." /> : handoffs.map((h) => (
              <InvitedRow key={h.id} h={h} hidden={ring.hidden} active={selected === String(h.conversationId)} onOpen={() => to({ website: String(h.conversationId) })} />
            ))
          ) : section === 'offline' && enquiries ? (
            offline.isLoading ? <Spinner /> : !offlineRows.length ? (
              <Empty
                icon="mail"
                title={typed ? text('Nothing matches “{q}”', { q: q.trim() }) : text('No offline enquiries')}
                hint={typed ? undefined : text('When a visitor writes while nobody is available or outside business hours, their message waits here.')}
              />
            ) : (
              offlineRows.map((e) => <OfflineRow key={e.id} e={e} active={selected === String(e.id)} onOpen={() => to({ website: String(e.id) })} />)
            )
          ) : section === 'missed' ? (
            missed.isLoading ? <Spinner /> : missed.error ? <div className="p-4"><ErrorNote error={missed.error} onRetry={() => void missed.refetch()} /></div> : !missedRows.length && !(missedTab === 'todo' && callbackList.length) ? (
              <Empty
                icon="globe"
                title={typed ? text('Nothing matches “{q}”', { q: q.trim() }) : missedTab === 'handled' ? text('Nothing handled in the last 30 days') : text('No missed chats')}
                hint={typed ? undefined : missedTab === 'handled' ? undefined : text('When a visitor writes and leaves before anyone replies, they wait here to be followed up.')}
              />
            ) : (
              <>
              {missedTab === 'todo' && callbackList.length ? (
                <div role="group" aria-label="Call backs" className="border-b border-line">
                  <div className="px-3.5 pt-2 pb-1 text-[11px] font-bold tracking-[.06em] text-ink-3 uppercase">{text('Call backs · {n}', { n: callbackList.length })}</div>
                  {callbackList.map((b) => <CallbackRow key={b.id} b={b} active={selected === String(b.conversation_id)} onOpen={() => to({ website: String(b.conversation_id) })} />)}
                </div>
              ) : null}
              {missedRows.map((m) => <MissedRow key={m.id} m={m} active={selected === String(m.id)} onOpen={() => to({ website: String(m.id) })} />)}
              </>
            )
          ) : section === 'closed' ? (
            // C-06: each closed chat says how it ended and what it was rated, in the order chats ended.
            list.isLoading || list.error ? listPlaceholder : rows.length === 0 ? (
              <Empty icon="archive" title={typed ? text('Nothing matches “{q}”', { q: q.trim() }) : text('No closed chats')} hint={typed ? undefined : text('Chats closed by the team, ended by the visitor or closed as inactive are kept here.')} />
            ) : (
              rows.map((r) => <ClosedRow key={r.id} r={r} active={selected === String(r.id)} onOpen={() => to({ website: String(r.id) })} />)
            )
          ) : listPlaceholder ?? (
            rows.map((r) => <Row key={r.id} r={r} me={me} myName={myName} ring={ringing.get(r.id)} typing={typingRows.has(r.id)} active={selected === String(r.id)} onOpen={() => to({ website: String(r.id) })} onMenu={(e) => (e.preventDefault(), setRowMenu({ x: e.clientX, y: e.clientY, r }))} />)
          )}
        </div>
      </section>
      <div className={cx('flex min-w-0 flex-1', (wide || tableView) && 'hidden')}>
        {selected && offlineDetail ? (
          <OfflineDetail key={selected} id={selected} e={offlineOpen} me={me} onOpenChat={() => to({ section: 'inbox', website: selected })} onClosed={() => to({ website: null })} />
        ) : selected && section === 'closed' ? (
          // A closed chat is read back with its summary (C-06); Reopen takes it to the open thread to reply in.
          <ClosedDetail key={selected} id={selected} row={(source.data?.conversations ?? []).find((r) => String(r.id) === selected) ?? found.data?.conversations.find((r) => String(r.id) === selected)} onReopened={() => to({ section: 'inbox', website: selected })} />
        ) : selected && missedDetail ? (
          <MissedDetail key={selected} id={selected} m={missedOpen} onOpenChat={() => to({ section: 'inbox', website: selected })} />
        ) : selected ? (
          <WebsiteThread key={selected} id={selected} row={openRows.find((r) => String(r.id) === selected)} />
        ) : (
          <PickConversation rows={openRows} longest={longest} visitors={online.isSuccess ? visitorsOnline : null} onLongest={openLongest} onVisitors={() => go('/chat?view=website&section=visitors')} />
        )}
      </div>
    </div>
  );
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
  // By the server's count, as the call card's (C-09).
  const left = handoffLeft(h, now);
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
 * happening, and on which site. A chat ringing here shows a bell; one silenced for me (on all my devices) is amber,
 * with the bell struck through (R-04, RING-UI-04).
 */
function Row({ r, me, myName, ring, typing = false, active, onOpen, onMenu }: { r: WebsiteRow; me: number | null; myName: string | null; ring?: WebchatRingChat; typing?: boolean; active: boolean; onOpen: () => void; onMenu: (e: ReactMouseEvent) => void }) {
  const name = r.visitor_name || r.label;
  const mine = me !== null && r.assigned_to === me;
  // Several staff in it: their faces, the owner first (TEAM-04); and what I am in it (TEAM-09).
  const faces = (r.team ?? []).filter((p) => p.role !== 'observer');
  const helping = !mine && r.my_role === 'participant';
  const closed = r.status === 'closed';
  const since = waitingSince(r);
  const page = r.current_url ? pathOf(r.current_url) : null;
  const unread = closed ? 0 : (r.unread ?? 0);
  const line = rowPreview(r, { me, myName, ring });
  const presence = closed ? null : r.online ? 'online' : 'away';
  return (
    <button
      type="button"
      data-website-row={r.id}
      aria-current={active ? 'true' : undefined}
      onClick={onOpen}
      onContextMenu={onMenu}
      className={cx('relative flex w-full items-start gap-2.5 border-b border-line py-2.5 pr-3 pl-3.5 text-left', active ? 'bg-selection' : ring?.silenced ? ROW_SILENCED : 'hover:bg-subtle')}
    >
      {active ? <span aria-hidden className="absolute top-0 bottom-0 left-0 w-[3px] bg-primary" /> : null}
      <Avatar name={name} size={36} presence={presence} className="mt-px" />
      <span className="flex min-w-0 flex-1 flex-col gap-[3px]">
        <span className="flex items-center gap-1.5">
          <b className={cx('flex-1 truncate text-ink', r.awaiting_reply ? 'font-bold' : 'font-semibold')}>{name}</b>
          {ring ? <RingBell ring={ring} /> : null}
          {r.awaiting_reply && since && !closed ? <WaitClock since={since} amber={r.wait_amber} red={r.wait_red} silenced={!!ring?.silenced} /> : <span className="shrink-0 text-[11px] text-ink-3">{listStamp(r.last_message?.at ?? r.last_visitor_at ?? r.updated_at)}</span>}
        </span>
        <span className="flex min-w-0 items-center gap-1.5">
          {r.call && !closed ? (
            <CallLine call={r.call} />
          ) : typing && !closed ? (
            <span className="min-w-0 flex-1 truncate text-[12px] font-semibold text-primary">{text('Typing…')}</span>
          ) : (
            <span className={cx('min-w-0 flex-1 truncate text-[13px]', unread ? 'font-semibold text-ink' : r.last_message?.from === 'agent' ? 'text-ink-3' : 'text-ink-2')}>{line}</span>
          )}
          {unread ? (
            <span className="min-w-[18px] shrink-0 rounded-full bg-primary px-1.5 text-center text-[10.5px] leading-[18px] font-bold text-white tabular-nums" aria-label={text('{n} unread', { n: unread })}>
              {unread > 99 ? '99+' : unread}
            </span>
          ) : null}
        </span>
        <span className="flex min-w-0 items-center gap-[5px] text-[11px]">
          {closed ? <Tag tone="muted">Closed</Tag> : r.awaiting_reply && r.reply_waiting_since ? <Tag tone="danger">{r.reply_stage === 'team' ? text('Visitor replied · team alerted') : text('Visitor replied')}</Tag> : r.awaiting_reply ? <Tag tone="danger">Awaiting reply</Tag> : mine ? <Tag tone="indigo">You</Tag> : helping ? <Tag tone="indigo">Participant</Tag> : null}
          {r.at_risk && !closed ? <Tag tone="danger">At risk</Tag> : null}
          {r.callback && !closed ? <Tag tone={r.callback.overdue ? 'danger' : 'indigo'}>{r.callback.overdue ? text('Callback overdue') : text('Callback requested')}</Tag> : null}
          {r.is_offline ? <Tag tone="muted">Offline</Tag> : null}
          {PRIORITY_TAG[r.priority] ? <Tag tone="warning">{PRIORITY_TAG[r.priority]}</Tag> : null}
          <span className="min-w-0 truncate text-ink-3">
            {r.site ?? r.widget ?? 'Website'}
            {/* Where they are on the site (C-01): its path while they are there. */}
            {presence === 'away' ? ` · ${text('away')}` : presence === 'online' && page ? ` · ${page}` : ''}
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

/**
 * Nothing open yet (CHAT-UI-00): how many visitors are waiting and for how long the longest has, a way straight to
 * them, the visitors on the sites now, and the keys that move through the list.
 */
function PickConversation({ rows, longest, visitors, onLongest, onVisitors }: { rows: WebsiteRow[]; longest: WebsiteRow | null; visitors: number | null; onLongest: () => void; onVisitors: () => void }) {
  const now = useNow(30_000);
  return (
    <div className="flex h-full min-h-[160px] flex-1 flex-col items-center justify-center gap-2 p-8 text-center">
      <span className="flex h-14 w-14 items-center justify-center rounded-full bg-subtle text-ink-3">
        <Icon name="globe" size={24} />
      </span>
      <div className="mt-1 text-[18px] font-bold text-ink">Pick a conversation</div>
      <div className="max-w-[420px] text-[14px] text-ink-2">{waitingSummary(rows, now)}</div>
      <div className="mt-2 flex flex-wrap justify-center gap-2">
        {longest ? (
          <Button variant="primary" onClick={onLongest}>
            Open the longest waiting
          </Button>
        ) : null}
        <Button onClick={onVisitors}>
          {visitors === null ? 'Visitors online' : `${text('Visitors online')} · ${visitors}`}
        </Button>
      </div>
      <div className="mt-2 flex items-center gap-1 text-[12px] text-ink-3">
        Press <Kbd tone="key">J</Kbd> / <Kbd tone="key">K</Kbd> to move through the list
      </div>
    </div>
  );
}

function MenuHead({ children }: { children: ReactNode }) {
  return <div className="mx-2 mt-2.5 mb-0.5 text-[10.5px] font-bold tracking-[0.9px] text-ink-3">{children}</div>;
}

/** A menu entry (C-01): its icon, its words and what it counts; the one showing is lit with a bar on its left. */
function MenuItem({ icon, label, here, onClick, title, children }: { icon: string; label: string; here: boolean; onClick: () => void; title?: string; children?: ReactNode }) {
  return (
    <button type="button" aria-current={here ? 'page' : undefined} title={title} onClick={onClick} className={cx('relative flex h-[27px] shrink-0 items-center gap-[9px] rounded-[7px] px-2 text-left', here ? 'bg-selection font-bold text-primary shadow-[inset_3px_0_0_var(--color-primary)]' : 'text-ink hover:bg-subtle')}>
      <Icon name={icon} size={16} className={cx('shrink-0', here ? 'text-primary' : 'text-ink-2')} />
      <span className="min-w-0 flex-1 truncate">{text(label)}</span>
      {children}
    </button>
  );
}

/** A count as a small pill: plain, ringed on the lit entry, red for missed, green for visitors online, amber for calls on now (V-01). */
function CountPill({ n, here, tone }: { n: number | null; here: boolean; tone: 'plain' | 'danger' | 'green' | 'amber' }) {
  if (!n) return null;
  return (
    <span className={cx('inline-flex h-[18px] min-w-[20px] shrink-0 items-center justify-center rounded-[9px] px-1.5 text-[11px] font-bold', tone === 'danger' ? 'bg-danger text-white' : tone === 'green' ? 'bg-success-bg text-success' : tone === 'amber' ? 'bg-warning-bg text-[#9A4A06] dark:text-warning' : here ? 'bg-surface text-primary ring-1 ring-primary/40' : 'bg-subtle text-ink-2')}>
      {n}
    </span>
  );
}
