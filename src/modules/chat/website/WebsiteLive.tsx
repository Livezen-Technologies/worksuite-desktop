import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type Ref } from 'react';
import { ApiError, apiGet, apiPost, request } from '../../../core/api';
import { errorMessage } from '../../../core/bridge';
import { text } from '../../../core/i18n';
import { stampDayLabel, timeLabel } from '../../../core/time';
import { toast } from '../../../core/toasts';
import { Icon } from '../../../components/Icon';
import { avatarTone, Empty, ErrorNote, Spinner, cx } from '../../../components/ui';
import { Composer, type ComposerChannel, type ComposerHandle } from '../Composer';
import { dwell } from '../kit/model';
import { useNow } from '../../calls/parts';
import { useCanned, visitorStatus, WEBSITE, type Section } from './api';
import { Select } from '../../../components/Select';
import { LiveDashboard, NO_LIVE_PARAMS, type LiveParams, type WallOptions } from './live/LiveDashboard';
import { useLiveData, useLiveVisitors } from './live/liveData';
import { clock, initialsOf, ordinal, pathOf, since, STATE, stateOf, whereOf, type OnlineVisitor } from './live/liveMap';
import { BlockDialog } from './panelCards';
import { refuseForVisitor } from './profile';
import { hostOf, PANEL_CARD as CARD, PANEL_HEADING as HEADING, ROW_PICKED, siteAndPath, TABLE_FRAME, TABLE_HEAD } from './rowParts';

export type { OnlineVisitor } from './live/liveMap';

interface Activity {
  events: Array<{ id: number; kind: string; url: string | null; title: string | null; at: string; seconds?: number | null; new_visit: boolean }>;
  visits?: number;
  first_seen?: string | null;
  chats?: Array<{ id: number; status: string; started_at: string | null; closed_at: string | null }>;
  contact?: { id: number; name: string } | null;
  language?: string | null;
  landing_page?: string | null;
}

/** The Live section's two views (worksuite-desktop#231): the dashboard, and everybody on the sites. */
export type LiveView = 'dashboard' | 'visitors';


/** Whether there is a chat to go to: one open or waiting. */
const hasChat = (v: OnlineVisitor) => !!v.conversation_id && (v.conversation_status === 'open' || v.conversation_status === 'pending');

type Status = ReturnType<typeof visitorStatus>[0];

const STATUSES: Array<{ id: '' | Status; label: string }> = [
  { id: '', label: 'Everyone' },
  { id: 'Waiting', label: 'Waiting' },
  { id: 'Chatting', label: 'Chatting' },
  { id: 'Active', label: 'Browsing' },
  { id: 'Inactive', label: 'Inactive' },
];

/** Quiet this long and a visitor is idle: the grey dot (UX-VIS-01), as visitorStatus's Inactive. */
const IDLE_AFTER = 120;

/**
 * The status dot (C-07, UX-VIS-01): browsing green, waiting amber, idle grey — and, from the dashboard's legend
 * (C-00), in a chat indigo, at risk red, on a call green.
 */
function dotOf(v: OnlineVisitor, idle: number): { colour: string; label: string } {
  const s = stateOf(v);
  if (s !== 'browsing') return STATE[s];
  return idle >= IDLE_AFTER ? { colour: '#c9ccd8', label: 'Idle' } : { colour: '#2f9e67', label: 'Browsing' };
}

/**
 * LAST ACTIVE (C-07): "Waiting 1:38" while their chat waits on us, "Chatting" in one, else when we last heard from
 * them — "Now", "40 s ago", "3 min ago" — or "Just arrived" on their first page.
 */
function lastActive(v: OnlineVisitor, idle: number, now: number): { label: string; tone: string } {
  const [st] = visitorStatus(v);
  if (st === 'Waiting') return { label: text('Waiting {time}', { time: clock(since(v.chat?.waiting_since, now) ?? 0) }), tone: 'font-semibold text-[#9a5b10] dark:text-warning' };
  if (st === 'Chatting') return { label: text('Chatting'), tone: 'font-semibold text-primary' };
  if (v.pages <= 1 && v.on_site_seconds < 60) return { label: text('Just arrived'), tone: 'text-ink-3' };
  if (idle < 20) return { label: text('Now'), tone: 'font-semibold text-[#2b7a4b] dark:text-success' };
  if (idle < 60) return { label: text('{n} s ago', { n: Math.round(idle / 10) * 10 }), tone: 'text-ink-3' };
  return { label: text('{n} min ago', { n: Math.floor(idle / 60) }), tone: 'text-ink-3' };
}

/**
 * The Live section of Website chats (WebChatLive; worksuite-desktop#231): the Live dashboard (worksuite-desktop C-00;
 * live/LiveDashboard) — six figures each opening the view they count, the map, and everybody on the site in the order
 * they need us — and Visitors online (C-07, X-UI-06), everybody, with filters, and the selected visitor's panel
 * beside the list: what they are reading now, this visit, and the composer to speak first. In both, a visitor is
 * selected (a click, the arrow keys, or Start chat) and their details open: beside the list here, over it on the
 * dashboard; Enter or a double-click goes to their chat. The selection is in the address, so it survives Back, a
 * reopened tab and a refresh of the list.
 */
export function WebsiteLive({ view, selected, onSelect, onOpenChat, onSection, live: held, onLive: hold, wall }: {
  view: LiveView;
  /** The wall window's choices (L-06, MAP-24): cycle the map, keep the screen awake. */
  wall?: WallOptions;
  /** The dashboard's view as the address keeps it (MAP-15); held here when the caller keeps no address. */
  live?: LiveParams;
  onLive?: (patch: Partial<LiveParams>) => void;
  selected: number | null;
  onSelect: (id: number | null) => void;
  onOpenChat: (conversationId: number, then?: 'invite') => void;
  onSection: (s: 'visitors' | Section) => void;
}) {
  const [own, setOwn] = useState<LiveParams>(NO_LIVE_PARAMS);
  const live = held ?? own;
  const onLive = useCallback((patch: Partial<LiveParams>) => (hold ? hold(patch) : setOwn((o) => ({ ...o, ...patch }))), [hold]);
  // All sites, one, or several (MAP-14): every figure and the list narrow to them.
  const sites = live.sites;
  const [status, setStatus] = useState<'' | Status>('');
  const [focusStart, setFocusStart] = useState(0);
  // The cards, the list and the map from one place (worksuite-desktop#248): the summary first, the visitor list and the
  // map's answer beside it, each from this computer's last copy while it is asked for. One site narrows every figure;
  // changing it keeps the last figures on screen until the new ones land. Visitors online reads only the sites' names.
  const data = useLiveData(sites, { full: view === 'dashboard', fullInterval: live.wall ? 10_000 : 30_000 });
  const visitors = useLiveVisitors();
  const all = (visitors.data?.visitors ?? []).filter((v) => !sites.length || sites.includes(v.widget_id));
  const list = view === 'visitors' && status ? all.filter((v) => visitorStatus(v)[0] === status) : all;

  // The selected visitor, and — once they have left the site — who they were and when they were last seen.
  const [last, setLast] = useState<{ v: OnlineVisitor; at: number } | null>(null);
  const here = selected !== null ? (visitors.data?.visitors ?? []).find((v) => v.id === selected) ?? null : null;
  if (here && last?.v !== here) setLast({ v: here, at: visitors.dataUpdatedAt - here.idle_seconds * 1000 });
  const picked = here ?? (selected !== null && last?.v.id === selected ? last.v : null);
  const left = !here && !!picked && visitors.isSuccess;

  const d = data.d;
  const open = (v: OnlineVisitor) => {
    if (hasChat(v)) onOpenChat(v.conversation_id!);
    else {
      onSelect(v.id);
      setFocusStart((n) => n + 1);
    }
  };

  const card = picked ? <VisitorCard key={picked.id} v={picked} asOf={visitors.dataUpdatedAt} left={left} leftAt={left ? (last?.at ?? null) : null} focusStart={focusStart} onOpenChat={onOpenChat} onClose={() => onSelect(null)} /> : null;

  if (view === 'dashboard') {
    return (
      <LiveDashboard
        wall={wall}
        data={data}
        live={live}
        onLive={onLive}
        selected={selected}
        onSelect={onSelect}
        onStart={(v) => {
          onSelect(v.id);
          setFocusStart((n) => n + 1);
        }}
        onOpenChat={onOpenChat}
        onSection={onSection}
        drawer={card}
      />
    );
  }

  return (
    <div className="flex h-full min-w-0 flex-1">
      <main className="flex h-full min-w-0 flex-1 flex-col gap-3 overflow-y-auto bg-ground px-5 py-4 text-[13px] scroll-thin">
        <div className="flex items-center gap-2.5">
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline gap-1.5">
              <h1 className="text-[21px] font-bold text-ink">{text('Visitors online')}</h1>
              <span className="text-[21px] font-medium text-ink-3">· {list.length}</span>
            </div>
            <p className="text-[12.5px] text-ink-3">{text('Everyone on your sites right now. Select someone to see what they are reading.')}</p>
          </div>
          <Select aria-label={text('Show')} value={status} onChange={(e) => setStatus(e.target.value as '' | Status)} className="h-8 rounded-[8px] border border-line bg-surface px-1.5 text-[12.5px] text-ink">
            {STATUSES.map((s) => <option key={s.id} value={s.id}>{text(s.label)}</option>)}
          </Select>
          <Select aria-label={text('Site')} value={sites.length === 1 ? sites[0] : sites.length ? -1 : 0} onChange={(e) => onLive({ sites: Number(e.target.value) > 0 ? [Number(e.target.value)] : [] })} className="h-8 rounded-[8px] border border-line bg-surface px-1.5 text-[12.5px] text-ink">
            <option value={0}>{text('All sites')}</option>
            {sites.length > 1 ? <option value={-1} disabled>{text('{n} sites', { n: sites.length })}</option> : null}
            {(d?.widgets ?? []).map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
          </Select>
        </div>
        <VisitorTable rows={list} selected={selected} asOf={visitors.dataUpdatedAt} loading={visitors.isLoading} error={visitors.error} onRetry={() => void visitors.refetch()} onSelect={onSelect} onOpen={open} />
      </main>
      <aside aria-label={text('Selected visitor')} className="flex w-[340px] shrink-0 flex-col overflow-hidden border-l border-line bg-ground">
        {card ?? <p className="m-3 rounded-[12px] border border-dashed border-line p-4 text-ink-3">{text('Select a visitor to see their pages and start a conversation.')}</p>}
      </aside>
    </div>
  );
}

/** VISITOR, READING NOW, ON THE SITE, PAGES, VISITS, LAST ACTIVE (C-07, UX-VIS-01). */
const GRID = 'grid grid-cols-[2.2fr_2fr_1fr_0.8fr_0.8fr_1.2fr] items-center gap-x-2';

/**
 * The visitors, one row each (C-07, UX-VIS-01): who and where with the status dot, the page they are reading, how
 * long they have been on the site, pages this visit, which visit, and when last active. A click selects, a
 * double-click or Enter goes to their chat (or to Start chat), the arrow keys move, Escape closes the details; the
 * last-active cell goes to the chat too.
 */
function VisitorTable({ rows, selected, asOf, loading, error, onRetry, onSelect, onOpen }: {
  rows: OnlineVisitor[];
  selected: number | null;
  /** When the list was fetched: its seconds are counted on from then. */
  asOf: number;
  loading: boolean;
  error: unknown;
  onRetry: () => void;
  onSelect: (id: number | null) => void;
  onOpen: (v: OnlineVisitor) => void;
}) {
  const now = useNow(1_000);
  const extra = asOf ? Math.max(0, (now - asOf) / 1000) : 0;
  const refs = useRef(new Map<number, HTMLDivElement>());
  const move = (i: number) => {
    const v = rows[Math.max(0, Math.min(rows.length - 1, i))];
    if (!v) return;
    onSelect(v.id);
    refs.current.get(v.id)?.focus();
  };
  const onKey = (e: KeyboardEvent, v: OnlineVisitor, i: number) => {
    const act: Record<string, () => void> = {
      ArrowDown: () => move(i + 1),
      ArrowUp: () => move(i - 1),
      Enter: () => onOpen(v),
      ' ': () => onSelect(v.id),
      Escape: () => onSelect(null),
    };
    const f = act[e.key];
    if (!f) return;
    e.preventDefault();
    f();
  };
  const focusable = rows.some((r) => r.id === selected) ? selected : (rows[0]?.id ?? null);
  return (
    <div className={TABLE_FRAME}>
      <div className={cx(GRID, TABLE_HEAD)} aria-hidden>
        {['Visitor', 'Reading now', 'On the site', 'Pages', 'Visits', 'Last active'].map((h) => <span key={h}>{text(h)}</span>)}
      </div>
      {loading ? <Spinner /> : error ? <div className="p-3"><ErrorNote error={error} onRetry={onRetry} /></div> : null}
      {!loading && !rows.length ? <Empty icon="globe" title="Nobody is on your sites right now" /> : null}
      {rows.length ? (
        <div role="listbox" aria-label={text('Visitors online')} className="flex flex-col">
          {rows.map((v, i) => {
            const idle = v.idle_seconds + extra;
            const dot = dotOf(v, idle);
            const act = lastActive(v, idle, now);
            const on = selected === v.id;
            return (
              <div
                key={v.id}
                ref={(el) => {
                  if (el) refs.current.set(v.id, el);
                  else refs.current.delete(v.id);
                }}
                role="option"
                aria-selected={on}
                tabIndex={focusable === v.id ? 0 : -1}
                onClick={() => onSelect(v.id)}
                onDoubleClick={() => onOpen(v)}
                onKeyDown={(e) => onKey(e, v, i)}
                className={cx(GRID, 'cursor-pointer border-b border-line px-4 py-[11px] text-left outline-none last:border-b-0 focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-inset', on ? ROW_PICKED : 'hover:bg-subtle')}
              >
                <span className="flex min-w-0 items-center gap-2">
                  <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: dot.colour }} title={text(dot.label)} aria-label={text(dot.label)} role="img" />
                  <b className="truncate text-ink">{v.name || v.label}</b>
                  <span className="truncate text-ink-3">· {whereOf(v)}</span>
                </span>
                <span className="truncate text-ink" title={siteAndPath(v.current_url)}>{pathOf(v.current_url)}</span>
                <span className="text-ink">{Math.floor((v.on_site_seconds + extra) / 60)}m</span>
                <span className="text-ink">{v.pages}</span>
                <span className="text-ink">{ordinal(v.visits)}</span>
                <span className="min-w-0">
                  <button
                    type="button"
                    tabIndex={-1}
                    title={hasChat(v) ? text('Open the chat') : text('Start a chat')}
                    onClick={(e) => {
                      e.stopPropagation();
                      onOpen(v);
                    }}
                    className={cx('truncate rounded-[5px] px-1 text-left tabular-nums hover:bg-subtle hover:underline', act.tone)}
                  >
                    {act.label}
                  </button>
                </span>
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

/**
 * The selected visitor's panel (C-07, X-UI-06): who they are and how long they have been here, with Block; what they
 * are reading now (UX-VIS-02/03) and this visit's pages with how they arrived; and the composer to speak first
 * (UX-VIS-04, VIS-07) — or, when they are already in a chat, Open the chat and Invite a colleague. When they leave
 * it says so and keeps what it showed.
 */
function VisitorCard({ v, asOf, left, leftAt, focusStart, onOpenChat, onClose }: {
  v: OnlineVisitor;
  asOf: number;
  left: boolean;
  leftAt: number | null;
  focusStart: number;
  onOpenChat: (id: number, then?: 'invite') => void;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [blocking, setBlocking] = useState(false);
  const composer = useRef<ComposerHandle>(null);
  const now = useNow(1_000);
  const extra = left || !asOf ? 0 : Math.max(0, (now - asOf) / 1000);
  const trail = useQuery({
    queryKey: ['website', 'visitor', v.id],
    queryFn: ({ signal }) => apiGet<Activity>(`${WEBSITE}/visitors/${v.id}/activity`, undefined, signal),
    refetchInterval: left ? false : 15_000,
  });
  useEffect(() => {
    if (focusStart) composer.current?.focus();
  }, [focusStart]);
  const a = trail.data;
  const who = v.name || v.label;
  const idle = v.idle_seconds + extra;
  const dot = dotOf(v, idle);
  const [st] = visitorStatus(v);
  const chats = (a?.chats ?? []).filter((c) => c.id !== v.conversation_id);
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['website', 'visitors'] });
    onClose();
  };
  const presence = left
    ? text('Left the site · {time}', { time: leftAt ? timeLabel(new Date(leftAt).toISOString()) : '' })
    : st === 'Waiting'
      ? text('Waiting {time}', { time: clock(since(v.chat?.waiting_since, now) ?? 0) })
      : st === 'Chatting'
        ? (v.chat?.agent ? text('In a chat with {name}', { name: v.chat.agent }) : text('In a chat'))
        : text('On the site · {time}', { time: dwell(v.on_site_seconds + extra) });
  return (
    <section aria-label={text('Visitor details')} className="flex h-full min-h-0 flex-col bg-ground text-[13px]" onKeyDown={(e) => {
        if (e.key !== 'Escape' || e.defaultPrevented) return;
        e.preventDefault();
        onClose();
      }}>
      <header className="flex h-[60px] shrink-0 items-center gap-2.5 border-b border-line bg-surface pr-3 pl-3.5">
        <span className={cx('relative flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-full text-[12.5px] font-bold', avatarTone(who))} aria-hidden>
          {initialsOf(v)}
          {left ? null : <span className="absolute -right-px -bottom-px h-[11px] w-[11px] rounded-full border-2 border-surface" style={{ background: dot.colour }} />}
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-[14.5px] font-bold text-ink">{who}</h2>
          <p role={left ? 'status' : undefined} className={cx('truncate text-[11.5px] font-semibold', left ? 'text-ink-3' : st === 'Waiting' ? 'text-[#9a5b10] dark:text-warning' : st === 'Chatting' ? 'text-primary' : 'text-[#2b7a4b] dark:text-success')}>{presence}</p>
        </div>
        <button type="button" aria-label={text('Block visitor')} title={text('Block visitor')} onClick={() => setBlocking(true)} className="flex h-[30px] w-[30px] items-center justify-center rounded-[8px] border border-line bg-surface text-ink-2 hover:bg-subtle hover:text-ink">
          <Icon name="ban" size={14} />
        </button>
        <button type="button" aria-label={text('Close the details')} title={text('Close')} onClick={onClose} className="flex h-[30px] w-[30px] items-center justify-center rounded-[8px] text-ink-3 hover:bg-subtle hover:text-ink">
          <Icon name="x" size={13} />
        </button>
      </header>
      <div className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto p-3 scroll-thin">
        <ReadingNow v={v} left={left} pageSeconds={pageSeconds(v, a, extra, now)} />
        <ThisVisit v={v} a={a} loading={trail.isLoading} left={left} idle={st === 'Inactive'} onSite={v.on_site_seconds + extra} pageSeconds={pageSeconds(v, a, extra, now)} />
        {a?.contact || chats.length ? (
          <div className={CARD}>
            <span className={HEADING}>{text('Before')}</span>
            {a?.contact ? (
              <p className="text-[12px] text-ink-2">
                {text('Contact')} · <b className="text-ink">{a.contact.name}</b>
              </p>
            ) : null}
            {chats.length ? (
              <ul className="flex flex-col gap-0.5 text-[12px]" aria-label={text('Previous chats')}>
                {chats.map((c) => (
                  <li key={c.id}>
                    <button type="button" onClick={() => onOpenChat(c.id)} className="text-primary hover:underline">
                      {c.started_at ? `${stampDayLabel(c.started_at, 'short')} ${timeLabel(c.started_at)}` : `#${c.id}`} · {c.status}
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}
      </div>
      {hasChat(v) ? (
        <div className="flex shrink-0 flex-wrap gap-2 border-t border-line bg-surface px-3 pt-2.5 pb-3">
          <button type="button" onClick={() => onOpenChat(v.conversation_id!)} className="h-9 rounded-[8px] bg-primary px-3.5 font-bold text-white hover:bg-primary-hover">{text('Open the chat')}</button>
          <button type="button" className="h-9 rounded-[8px] border border-line bg-surface px-3 font-semibold text-ink hover:bg-subtle" onClick={() => onOpenChat(v.conversation_id!, 'invite')}>{text('Invite a colleague')}</button>
        </div>
      ) : left ? null : (
        <SpeakFirst v={v} composer={composer} onOpenChat={onOpenChat} />
      )}
      {blocking ? <BlockDialog conversationId={hasChat(v) ? v.conversation_id : null} visitorId={v.id} name={who} onClose={() => setBlocking(false)} onDone={refresh} /> : null}
    </section>
  );
}

/** Seconds on the page they are reading: the server's figure (C-07), else from when their journey last changed page. */
function pageSeconds(v: OnlineVisitor, a: Activity | undefined, extra: number, now: number): number | null {
  if (v.page_seconds !== null && v.page_seconds !== undefined) return v.page_seconds + extra;
  const lastPage = (a?.events ?? []).filter((e) => e.kind === 'page_view').at(-1);
  return lastPage ? since(lastPage.at, now) : null;
}

/**
 * READING NOW (C-07, UX-VIS-02/03): a schematic of the page they are on — a browser frame with its address, the
 * page's title over placeholder lines, and the scroll bar where they are — drawn from the title and the widget's
 * figures, never from the page itself: no screenshot or copy of it is taken. The section they are looking at, and a
 * pointer on it, only when the widget reports one.
 */
function ReadingNow({ v, left, pageSeconds }: { v: OnlineVisitor; left: boolean; pageSeconds: number | null }) {
  const url = v.current_url;
  const address = url ? `${hostOf(url)}${pathOf(url) === '/' ? '' : pathOf(url)}` : '—';
  const title = v.current_title || pathOf(url);
  const scroll = v.scroll ?? null;
  const section = v.section || null;
  return (
    <div className="overflow-hidden rounded-[12px] border border-line bg-surface">
      <div className="flex items-center gap-2 border-b border-line px-2.5 py-2">
        <span className={cx(HEADING, 'flex-1')}>{text('Reading now')}</span>
        {left ? (
          <span className="text-[11px] font-bold text-ink-3">{text('Left')}</span>
        ) : (
          <span className="flex items-center gap-[5px] text-[11px] font-bold text-[#2b7a4b] dark:text-success">
            <span className="h-1.5 w-1.5 rounded-full bg-[#2f9e67]" aria-hidden />
            {text('Live')}
          </span>
        )}
      </div>
      <div className="bg-subtle p-2.5">
        <div
          role="img"
          aria-label={[text('Schematic of {title}', { title }), address, scroll !== null ? text('{n}% down the page', { n: scroll }) : null].filter(Boolean).join(' · ')}
          className={cx('overflow-hidden rounded-[8px] border border-line bg-surface shadow-[0_4px_12px_rgba(17,27,59,0.06)]', left && 'opacity-60')}
        >
          <div className="flex h-[22px] items-center gap-[5px] bg-[#eceef4] px-2 dark:bg-subtle" aria-hidden>
            {[0, 1, 2].map((i) => <span key={i} className="h-1.5 w-1.5 rounded-full bg-[#c9ccd8]" />)}
            <span className="ml-1.5 flex h-3.5 min-w-0 flex-1 items-center truncate rounded-[4px] bg-surface px-1.5 text-[9.5px] text-ink-3">{address}</span>
          </div>
          <div className="relative flex h-[112px] gap-2.5 p-2.5" aria-hidden>
            <div className="flex min-w-0 flex-1 flex-col gap-1.5">
              <div className="truncate text-[12px] font-extrabold text-ink">{title}</div>
              <div className="h-[5px] w-[90%] rounded-[3px] bg-line" />
              <div className="h-[5px] w-[70%] rounded-[3px] bg-line" />
              <div className="h-[5px] w-[80%] rounded-[3px] bg-line" />
              <div className="mt-1 h-[18px] w-[70px] rounded-[5px] bg-primary" />
            </div>
            {section ? (
              <div className="relative flex w-[92px] shrink-0 flex-col gap-1 rounded-[6px] border-2 border-primary bg-selection p-1.5">
                <div className="line-clamp-3 text-[9px] leading-tight text-ink-2">{section}</div>
                <div className="h-1 rounded-[2px] bg-[#dfe4fb] dark:bg-line" />
                <div className="h-1 w-[70%] rounded-[2px] bg-[#dfe4fb] dark:bg-line" />
                {left ? null : (
                  <svg className="absolute -bottom-1 -left-2" width="14" height="18" viewBox="0 0 14 18">
                    <path d="M1 1l11 7-5 1.5L4.5 15z" fill="currentColor" stroke="var(--color-surface, #fff)" strokeWidth="1.2" className="text-ink" />
                  </svg>
                )}
              </div>
            ) : null}
            {scroll !== null ? (
              <span className="absolute top-2 right-[3px] h-[96px] w-[3px] rounded-[2px] bg-[#eceef4] dark:bg-line">
                <span className="absolute left-0 h-[26px] w-[3px] rounded-[2px] bg-[#9aa3c4]" style={{ top: `${(Math.max(0, Math.min(100, scroll)) / 100) * 70}px` }} />
              </span>
            ) : null}
          </div>
        </div>
        <div className="mt-[7px] flex justify-between gap-2 text-[11.5px] text-ink-2">
          <span>
            {left ? (
              text('Was on this page')
            ) : pageSeconds !== null ? (
              <>
                <b className="text-ink">{dwell(pageSeconds)}</b> {text('on this page')}
              </>
            ) : null}
          </span>
          <span className="min-w-0 truncate text-right">
            {section ? text('Looking at {section}', { section }) : scroll !== null ? text('{n}% down the page', { n: scroll }) : null}
          </span>
        </div>
      </div>
    </div>
  );
}

/**
 * THIS VISIT (C-07; VIS-06): its pages, newest first, the one they are on highlighted with how long so far, each
 * other with how long it held them, and the first with where they came from; then where they are, their browser,
 * which visit this is and when the last one was.
 */
function ThisVisit({ v, a, loading, left, idle, onSite, pageSeconds }: { v: OnlineVisitor; a: Activity | undefined; loading: boolean; left: boolean; idle: boolean; onSite: number; pageSeconds: number | null }) {
  const pages = (a?.events ?? []).filter((e) => e.kind === 'page_view');
  const start = pages.map((e) => e.new_visit).lastIndexOf(true);
  const visit = start >= 0 ? pages.slice(start) : pages;
  const shown = visit.slice(-8).reverse();
  const earlier = visit.length - shown.length;
  const from = v.referrer_host ?? (v.referrer ? hostOf(v.referrer) : null);
  const chips = [
    [v.city, v.country].filter(Boolean).join(', ') || null,
    [v.browser, v.os].filter(Boolean).join(' · ') || null,
    text('{n} visit', { n: ordinal(v.visits) }),
    v.previous_visit_at ? text('Last: {date}', { date: stampDayLabel(v.previous_visit_at, 'short') }) : null,
    a?.language ?? null,
  ].filter((c): c is string => !!c);
  return (
    <div className="flex flex-col gap-2 rounded-[12px] border border-line bg-surface px-3 py-2.5">
      <div className="flex items-center">
        <span className={cx(HEADING, 'flex-1')}>{text('This visit')}</span>
        <span className="text-[11px] text-ink-3">{text('{n} pages · {time}', { n: v.pages, time: dwell(onSite) })}</span>
      </div>
      {loading ? <Spinner label={text('Loading their pages…')} className="p-2" /> : null}
      {shown.length ? (
        <ol className="ml-1 flex flex-col gap-[7px] border-l-2 border-line pl-3" aria-label={text('Pages this visit')}>
          {shown.map((e, i) => {
            const current = i === 0 && !left;
            const first = i === shown.length - 1 && earlier === 0;
            const sub = current
              ? [idle ? null : text('Now'), pageSeconds !== null ? dwell(pageSeconds) : null].filter(Boolean).join(' · ')
              : first
                ? (from ? text('Arrived from {host}', { host: from }) : text('Arrived directly'))
                : e.seconds !== null && e.seconds !== undefined
                  ? dwell(e.seconds)
                  : timeLabel(e.at);
            return (
              <li key={e.id} className="relative" aria-current={current ? 'page' : undefined}>
                <span className={cx('absolute rounded-full', current ? 'top-[3px] -left-[17px] h-2 w-2 bg-primary shadow-[0_0_0_3px_var(--color-selection,#e0e5fb)]' : 'top-1 -left-4 h-1.5 w-1.5 bg-[#c3ccf6] dark:bg-line')} aria-hidden />
                <div className={cx('truncate text-[12px]', current ? 'font-bold text-primary' : 'text-ink')} title={siteAndPath(e.url)}>{pathOf(e.url)}</div>
                <div className="text-[11px] text-ink-3">{sub}</div>
              </li>
            );
          })}
        </ol>
      ) : null}
      {earlier > 0 ? <p className="text-[11px] text-ink-3">{text('+ {n} earlier this visit', { n: earlier })}</p> : null}
      <div className="flex flex-wrap gap-[5px] border-t border-line pt-1">
        {chips.map((c) => <span key={c} className="rounded-[8px] bg-subtle px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap text-ink-2">{c}</span>)}
      </div>
    </div>
  );
}

/**
 * Speak first (C-07, UX-VIS-04, VIS-07; WF-X3): the shared composer — attach, emoji, saved replies, writing
 * assistant, Send — with the saved-reply chips above it. The first message creates the chat as an invitation, owned by
 * whoever wrote it, and the visitor's widget opens on their page with it; files go with it, into that chat. Then the
 * chat opens here, to carry on.
 */
function SpeakFirst({ v, composer, onOpenChat }: { v: OnlineVisitor; composer: Ref<ComposerHandle>; onOpenChat: (id: number) => void }) {
  const canned = useCanned(true, v.widget_id);
  const conv = useRef<number | null>(null);
  const who = v.name || v.label;
  const channel: ComposerChannel = {
    inputLabel: text('Message to {name}', { name: who }),
    draftModule: 'website',
    draftContext: `visitor:${v.id}`,
    refusal: null,
    allowBlockedDraft: false,
    maxLength: 4000,
    maxCaptionLength: 400,
    voice: false,
    attachChoices: ['document', 'image', 'camera', 'drive'],
    plain: true,
    replies: canned.data?.responses ?? [],
    // Nothing has been said yet: a suggestion is written from what they are reading.
    context: () => [{ mine: false, name: who, text: `(${who} has not written yet. They are reading “${v.current_title || pathOf(v.current_url)}” — ${siteAndPath(v.current_url)}.)` }],
    refuseFile: (f) => refuseForVisitor(f.name, f.size),
    send: async (words, files, meta) => {
      try {
        if (words) {
          const r = await apiPost<{ conversation_id: number }>(`${WEBSITE}/visitors/${v.id}/message`, { message: words, ...(meta?.canned ? { canned_id: meta.canned } : {}) });
          conv.current = r.conversation_id;
        }
        if (files.length) {
          if (conv.current === null) {
            toast('error', text('Write a first message — the file goes with it.'));
            return false;
          }
          for (const f of files) {
            const form = new FormData();
            form.append('file', f, f.name);
            await request('POST', `${WEBSITE}/conversations/${conv.current}/attach`, { body: form });
          }
        }
        return true;
      } catch (e) {
        toast('error', e instanceof ApiError && e.status === 409 ? text('That visitor is blocked.') : errorMessage(e));
        return false;
      }
    },
    onSent: () => {
      if (conv.current === null) return;
      toast('success', text('Message sent.'));
      onOpenChat(conv.current);
    },
  };
  return (
    <div className="flex shrink-0 flex-col border-t border-line bg-surface">
      <p className="mx-3 mt-2.5 flex items-center gap-2 rounded-[8px] bg-selection px-2.5 py-1.5 text-[11.5px] text-primary">
        <Icon name="chat" size={13} className="shrink-0" />
        <span className="flex-1">{text('Start the conversation — it opens the widget on their page')}</span>
      </p>
      <Composer ref={composer} roomId={`visitor:${v.id}`} roomName={who} group={false} reply={null} onClearReply={() => undefined} compact channel={channel} />
    </div>
  );
}
