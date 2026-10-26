import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Icon } from '../../../../components/Icon';
import { Menu } from '../../../../components/Menu';
import { cx } from '../../../../components/ui';
import { ApiError, apiPost } from '../../../../core/api';
import { app } from '../../../../core/app-state';
import { call, errorMessage, isMac } from '../../../../core/bridge';
import { text } from '../../../../core/i18n';
import { markdownLine } from '../../../../core/markdown';
import { useStore } from '../../../../core/store';
import { parseTs, timeLabel } from '../../../../core/time';
import { toast } from '../../../../core/toasts';
import { useNow } from '../../../calls/parts';
import { useWebsiteInbox, WEBSITE, type Section } from '../api';
import { PaneNotice, RetryButton, useSlow } from '../ThreadPlaceholder';
import { findCountry, flagOf } from './countries';
import {
  boxOfParam, byCountry, callClock, clock, CLUSTER, demonymOf, groupOf, longestWait, mapParam, mergePlaces, pathOf, placesNow, placesToday, presetsFor, sameBox, since, STATE, stateOf, waitWords, WORLD_BOX,
  type Box, type Dashboard, type Group, type OnlineVisitor, type Place, type Preset,
} from './liveMap';
import { LiveMap, loadMap, MapPlaceholder } from './LazyMap';
import { agoWords, type LiveData } from './liveData';
import { MapLegend } from './MapLegend';
import { OnSiteNow } from './OnSiteNow';
import { BrandMark } from '../../../../components/BrandMark';
import { StatCard, StatGrid, type StatTone } from '../../../../components/StatCard';

/*
 * The Live dashboard (worksuite-desktop C-00; the web's LiveDashboard, WS-WCHAT MAP-UI-01…03): who is on the sites right
 * now, what they are doing, and where they are — six figures, a live map, and everybody on the site in the order they
 * need us. Full map opens the map large with a place's people beside it; Wall mode is the same for a screen on the
 * wall, filling the window with names hidden. Both stay in this tab (no second window), and Esc comes back.
 *
 * IT IS NOT THE REPORTS SCREEN: it answers "what is happening this minute", from its own endpoint, polled every ten
 * seconds like the visitor list so the two never disagree about how many people are on the site.
 *
 * IT NEVER WAITS AS A WHOLE (worksuite-desktop#248). The layout is drawn at once, from the last copy this computer
 * kept when there is one ("Updated 2 min ago · refreshing"), else with a placeholder in each card and the list; each
 * fills in as its own answer lands (live/liveData), and a card that cannot be read says so with its own Retry. The
 * map comes last: its code loads only when its card is on screen (live/LazyMap).
 */

type When = 'now' | 'today';
type Filter = 'all' | Group;

/**
 * The dashboard's view as the address keeps it (MAP-15, `?section=dashboard&map=lk`), so a view can be bookmarked and
 * comes back with the tab: the full map's zoom and centre (`map`, present while it is open), its state chip, Now or
 * Today, the place picked, the sites, and Wall mode.
 */
export interface LiveParams {
  map: string | null;
  filter: Filter | null;
  when: When | null;
  place: string | null;
  sites: number[];
  wall: boolean;
}

export const NO_LIVE_PARAMS: LiveParams = { map: null, filter: null, when: null, place: null, sites: [], wall: false };

const FILTERS: Filter[] = ['all', 'needs', 'chat', 'browsing'];

/** The dashboard's view read from an address. */
export function liveParamsOf(q: URLSearchParams): LiveParams {
  const filter = q.get('filter');
  return {
    map: q.get('map') || null,
    filter: filter && (FILTERS as string[]).includes(filter) ? (filter as Filter) : null,
    when: q.get('when') === 'today' ? 'today' : null,
    place: q.get('place') || null,
    sites: (q.get('sites') ?? '').split(',').map(Number).filter((n) => Number.isInteger(n) && n > 0),
    wall: q.get('wall') === '1',
  };
}

/** The address for a Live view with the dashboard's view in it, leaving out whatever is at its default. */
export function liveQuery(section: string, p: LiveParams, visitor: number | null): URLSearchParams {
  const q = new URLSearchParams({ view: 'website', section });
  if (visitor) q.set('visitor', String(visitor));
  if (p.map) q.set('map', p.map);
  if (p.filter && p.filter !== 'all') q.set('filter', p.filter);
  if (p.when === 'today') q.set('when', 'today');
  if (p.place) q.set('place', p.place);
  if (p.sites.length) q.set('sites', p.sites.join(','));
  if (p.wall) q.set('wall', '1');
  return q;
}

/** How the wall shows on a display of its own (L-06, MAP-24): the map cycling World → region → home, the screen kept awake. */
export interface WallOptions {
  cycle: boolean;
  keepAwake: boolean;
}

export function LiveDashboard({ data, live, onLive, selected, onSelect, onStart, onOpenChat, onSection, drawer, wall }: {
  /** The figures, everybody on the chosen sites, and how each answer is doing (live/liveData). */
  data: LiveData;
  live: LiveParams;
  onLive: (patch: Partial<LiveParams>) => void;
  selected: number | null;
  onSelect: (id: number | null) => void;
  /** Start chat: the visitor's details open, ready to write to them. */
  onStart: (v: OnlineVisitor) => void;
  onOpenChat: (conversationId: number) => void;
  onSection: (s: 'visitors' | Section) => void;
  /** The selected visitor's details, shown over the list. */
  drawer: ReactNode;
  /** The wall window's choices (L-06); in a tab, the wall keeps the screen awake and shows the world. */
  wall?: WallOptions;
}) {
  const qc = useQueryClient();
  // On this computer, Wall mode asks first which screen and how (L-06, WF-M3 "the sheet confirms the display and
  // keep-awake"); where the app cannot say what screens there are, the wall fills this window as before (L-03).
  const desk = useQuery({ queryKey: ['live', 'desk'], queryFn: () => call('live:info'), retry: false });
  const sheet = !!desk.data?.displays?.length;
  const mode = live.wall ? 'wall' : live.map !== null ? 'map' : 'dashboard';
  const now = useNow(1_000);
  const { d, visitors, total } = data;
  // How far the server's clock is ahead of this one: every wait and call is counted on its clock.
  const skew = data.skew;
  const updated = data.updatedAt ? Math.max(0, Math.round((now - data.updatedAt) / 1000)) : null;
  // The saved copy on screen while the live answer is asked for: "Updated 2 min ago · refreshing".
  const snapshot = data.snapshotAt !== null ? Math.max(0, Math.round((now - data.snapshotAt) / 1000)) : null;
  // Nothing at all after five seconds: "Still loading… · Retry", centred.
  const [slow, restartSlow] = useSlow();
  // Who is on the site, once known: "longest" counts only their chats, not ones left open by visitors long gone (#284).
  const here = data.hasVisitors ? visitors : null;

  // What was said last in each chat, from the inbox the workspace keeps fresh; nothing is fetched for it here. Plain
  // words on one line, without Markdown's marks (#261).
  const inbox = useWebsiteInbox(false, false);
  const said = useMemo(() => new Map((inbox.data?.conversations ?? []).map((r) => [r.id, markdownLine(r.last_message?.body ?? '') || null])), [inbox.data]);
  const lastOf = (id: number) => said.get(id) ?? null;

  // Esc steps back: out of Wall mode, then the visitor's details, then the full map.
  const drawn = !!drawer;
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      if (mode === 'wall') onLive({ wall: false });
      else if (drawn) onSelect(null);
      else if (mode === 'map') onLive({ map: null, place: null });
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [mode, drawn, onSelect, onLive]);

  const join = async (v: OnlineVisitor) => {
    if (!v.conversation_id) return;
    try {
      await apiPost(`${WEBSITE}/conversations/${v.conversation_id}/accept`);
      onOpenChat(v.conversation_id);
    } catch (e) {
      // A moment late: the server says who has it.
      toast('error', e instanceof ApiError && e.status === 409 ? e.message : errorMessage(e));
    } finally {
      void qc.invalidateQueries({ queryKey: ['website', 'visitors'] });
    }
  };
  const act = { join: (v: OnlineVisitor) => void join(v), open: (v: OnlineVisitor) => v.conversation_id && onOpenChat(v.conversation_id), start: onStart };
  const list = { now, skew, selected, lastOf, onJoin: act.join, onOpen: act.open, onStart: act.start, onSelect: (v: OnlineVisitor) => onSelect(v.id) };

  const sitePicker = <SitePicker widgets={d?.widgets ?? null} sites={live.sites} onSites={(sites) => onLive({ sites })} />;
  const header = (title: string, subtitle: string | null, back: ReactNode, children: ReactNode) => (
    <div className="flex flex-wrap items-center gap-2.5">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2.5">
          {back}
          <h1 className={cx('font-bold text-ink', back ? 'text-[20px]' : 'text-[22px]')}>{text(title)}</h1>
          <LivePill updated={updated} snapshot={snapshot} />
        </div>
        {subtitle ? <p className="text-[12.5px] text-ink-3">{text(subtitle)}</p> : null}
      </div>
      {children}
    </div>
  );

  if (mode === 'map' && d) {
    return (
      <FullMap
        d={d}
        full={data.full}
        visitors={visitors}
        list={list}
        drawer={drawer}
        live={live}
        onLive={onLive}
        header={(controls) =>
          header(
            'Map',
            null,
            <button type="button" onClick={() => onLive({ map: null, place: null })} className="flex items-center gap-1 text-[13px] font-semibold whitespace-nowrap text-primary hover:underline">
              <Icon name="chevron-left" size={15} /> {text('Live dashboard')}
            </button>,
            <>
              {controls}
              <SitePicker widgets={d.widgets} sites={live.sites} onSites={(sites) => onLive({ sites })} count={false} />
            </>,
          )
        }
      />
    );
  }

  return (
    <main className="relative flex h-full min-w-0 flex-1 flex-col gap-3 overflow-y-auto bg-ground px-5 py-4 text-[13px] scroll-thin" aria-busy={data.pending || undefined}>
      {header(
        'Live dashboard',
        'Who is on your sites right now, what they are doing, and where they are.',
        null,
        <>
          {sitePicker}
          <button type="button" onClick={() => onLive({ map: 'world' })} onPointerEnter={() => void loadMap()} disabled={!d} className={OUTLINE}>
            <Icon name="fullscreen" size={14} /> {text('Full map')}
          </button>
          <button type="button" onClick={() => (sheet ? void call('live:open', { to: 'wallSheet' }).catch(() => onLive({ wall: true })) : onLive({ wall: true }))} onPointerEnter={() => void loadMap()} disabled={!d} className={OUTLINE}>
            <Icon name="monitor" size={14} /> {text('Wall mode')}
          </button>
          {/* The map in a native window of its own, over other apps or on another display (L-04, MAP-21). */}
          <button type="button" onClick={() => void call('live:open', { to: 'map' }).catch(() => undefined)} disabled={!d} title={text('Open the Live map in its own window ({keys})', { keys: MAP_KEYS })} className={OUTLINE}>
            <Icon name="external" size={14} /> {text('Pop out')}
          </button>
        </>,
      )}
      {d ? <Tiles d={d} online={total} here={here} now={now} skew={skew} onSection={onSection} /> : <TilesPlaceholder failed={data.cardsFailed} onRetry={data.retryCards} />}
      <div className="grid min-h-0 items-start gap-3.5 [grid-template-columns:minmax(0,65fr)_minmax(0,35fr)]">
        {d ? (
          <WhereTheyAre d={d} full={data.full} visitors={visitors} now={now} skew={skew} home={homeOf(d, visitors)} />
        ) : (
          <MapCardPlaceholder failed={data.mapFailed} onRetry={data.retryMap} />
        )}
        <section aria-label={text('On the site now')} aria-busy={!data.hasVisitors || undefined} className="relative flex min-h-[420px] min-w-0 flex-col overflow-hidden rounded-[12px] border border-line bg-surface">
          <div className="flex h-[46px] shrink-0 items-center border-b border-line px-3.5">
            <h2 className="min-w-0 flex-1 truncate text-[14px] font-bold text-ink">
              {text('On the site now')}
              {total !== null ? <span className="font-normal text-ink-3"> · {total}</span> : null}
            </h2>
            <span className="text-[11.5px] text-ink-3">{text('Needs you first')}</span>
          </div>
          {data.hasVisitors ? <OnSiteNow visitors={visitors} {...list} /> : data.listFailed ? <CardFailed onRetry={data.retryList} /> : <RowsPlaceholder />}
          {visitors.length ? (
            <div className="px-3.5 pt-2 pb-3">
              <button type="button" onClick={() => onSection('visitors')} className="text-[12.5px] font-bold text-primary hover:underline">
                {text('All {n} visitors online →', { n: total ?? visitors.length })}
              </button>
            </div>
          ) : null}
          {drawer ? <Drawer>{drawer}</Drawer> : null}
        </section>
      </div>
      {data.pending && slow ? (
        <PaneNotice>
          {text('Still loading…')}
          <span aria-hidden className="text-ink-3">·</span>
          <RetryButton onRetry={() => (restartSlow(), data.retryAll())} />
        </PaneNotice>
      ) : null}
      {mode === 'wall' && d ? <WallMode d={d} online={total} visitors={visitors} here={here} sites={live.sites} now={now} skew={skew} updated={updated} onClose={() => onLive({ wall: false })} cycle={wall?.cycle ?? false} awake={wall?.keepAwake ?? true} /> : null}
    </main>
  );
}

/* ---------------------------------------------------------------- while it loads (#248) */

const shimmer = 'rounded-full bg-subtle motion-safe:animate-pulse';

/** "Couldn't load · Retry", in the card that could not be read. */
function CardFailed({ onRetry, className }: { onRetry: () => void; className?: string }) {
  return (
    <div role="alert" className={cx('flex items-center justify-center gap-1.5 px-4 py-6 text-[13px] text-ink-2', className)}>
      <Icon name="alert" size={15} className="shrink-0 text-danger" />
      {text("Couldn't load")}
      <span aria-hidden className="text-ink-3">·</span>
      <RetryButton onRetry={onRetry} />
    </div>
  );
}

/** The six figures' boxes, grey until their answer lands; or, when it could not be read, one row saying so. */
function TilesPlaceholder({ failed, onRetry }: { failed: boolean; onRetry: () => void }) {
  if (failed) return <CardFailed onRetry={onRetry} className="rounded-[12px] border border-line bg-surface" />;
  return (
    <div className="grid grid-cols-6 gap-2.5" role="list" aria-label={text('Right now')} aria-busy="true">
      {['On the site now', 'Waiting on us', 'At risk', 'Open chats', 'On a call', 'First reply'].map((label) => (
        <div key={label} role="listitem" aria-label={`${text(label)}: ${text('loading')}`} className="flex min-w-0 flex-col gap-1.5 rounded-[12px] border border-line bg-surface px-3.5 py-2.5">
          <span className="text-[10.5px] font-bold tracking-[0.8px] whitespace-nowrap text-ink-3 uppercase">{text(label)}</span>
          <span className="flex items-baseline gap-2" aria-hidden>
            <span className="h-[26px] w-9 rounded-[6px] bg-subtle motion-safe:animate-pulse" />
            <span className={cx(shimmer, 'h-2.5 w-16')} />
          </span>
        </div>
      ))}
    </div>
  );
}

/** The map card's frame before the figures land: its title, the map's place, and the country rows in grey. */
function MapCardPlaceholder({ failed, onRetry }: { failed: boolean; onRetry: () => void }) {
  return (
    <section aria-label={text('Where they are')} aria-busy={!failed || undefined} className="flex min-w-0 flex-col overflow-hidden rounded-[12px] border border-line bg-surface">
      <div className="flex min-h-[46px] shrink-0 items-center gap-2.5 px-3.5 py-1.5">
        <h2 className="min-w-0 flex-1 truncate text-[14px] font-bold text-ink">{text('Where they are')}</h2>
      </div>
      {failed ? <CardFailed onRetry={onRetry} className="h-[400px] border-y border-line" /> : <MapPlaceholder className="h-[400px] shrink-0 border-y border-line" />}
      <div className="grid grid-cols-2 gap-x-[26px] gap-y-3 px-3.5 py-3" aria-hidden>
        {[0, 1, 2, 3].map((i) => <span key={i} className={cx(shimmer, 'h-2.5')} />)}
      </div>
    </section>
  );
}

/** "On the site now" before anybody is known: rows in grey, the circle and two lines each. */
function RowsPlaceholder() {
  return (
    <ul aria-hidden className="flex flex-col" data-testid="rows-placeholder">
      {[0, 1, 2, 3, 4].map((i) => (
        <li key={i} className="flex items-center gap-2.5 border-b border-line px-3.5 py-3 last:border-b-0">
          <span className="h-8 w-8 shrink-0 rounded-full bg-subtle motion-safe:animate-pulse" />
          <span className="flex flex-1 flex-col gap-1.5">
            <span className={cx(shimmer, 'h-3 w-2/5')} />
            <span className={cx(shimmer, 'h-2.5 w-3/4')} />
          </span>
        </li>
      ))}
    </ul>
  );
}

const OUTLINE = 'flex h-8 shrink-0 items-center gap-1.5 rounded-[8px] border border-line bg-surface px-3 text-[12.5px] font-semibold whitespace-nowrap text-ink hover:bg-subtle disabled:opacity-50';

/** The selected visitor's details over the right of a card, so the map keeps its place (C-00). */
function Drawer({ children }: { children: ReactNode }) {
  return <div className="absolute inset-y-0 right-0 z-10 w-[min(380px,100%)] overflow-y-auto border-l border-line bg-surface shadow-[-8px_0_24px_rgba(17,27,59,0.12)] scroll-thin">{children}</div>;
}

/**
 * "Live · updated 3 s ago", counting up each second from the last answer; "Updated 2 min ago · refreshing" while the
 * last copy kept on this computer is shown and the live answer is asked for (#248); "Refreshing…" before either.
 */
function LivePill({ updated, snapshot = null }: { updated: number | null; snapshot?: number | null }) {
  if (updated === null) {
    return (
      <span role="status" className="flex h-[22px] items-center gap-1.5 rounded-full bg-subtle px-[9px] text-[11.5px] font-bold whitespace-nowrap text-ink-2">
        <span className="h-[7px] w-[7px] rounded-full bg-[#c9ccd8] motion-safe:animate-pulse" aria-hidden />
        {snapshot !== null ? text('Updated {ago} ago · refreshing', { ago: agoWords(snapshot) }) : text('Refreshing…')}
      </span>
    );
  }
  // Amber after thirty seconds without an answer (MAP-03): the figures may be stale.
  const stale = updated !== null && updated > STALE_AFTER;
  return (
    <span className={cx('flex h-[22px] items-center gap-1.5 rounded-full px-[9px] text-[11.5px] font-bold whitespace-nowrap', stale ? 'bg-[#fdf6e7] text-[#9a5b10] dark:bg-warning-bg dark:text-warning' : 'bg-[#e9f6ee] text-[#1f6b40] dark:bg-success-bg dark:text-success')}>
      <span className={cx('h-[7px] w-[7px] rounded-full', stale ? 'bg-[#d9922e]' : 'bg-[#2f9e67] shadow-[0_0_0_3px_#cdebd8] dark:shadow-none')} aria-hidden />
      {updated === null ? text('Live') : text('Live · updated {n} s ago', { n: updated })}
    </span>
  );
}

/** Seconds without an answer before the live pill turns amber (MAP-03). */
const STALE_AFTER = 30;

/**
 * The sites to show (MAP-14): all of them, one, or several — "All sites · 3 ▾" on the dashboard (C-00), "All sites ▾"
 * on the full map (MAP-UI-02). A click on a site shows only it; its box adds it to, or takes it from, those shown.
 */
function SitePicker({ widgets: known, sites, onSites, count = true }: { widgets: Dashboard['widgets'] | null; sites: number[]; onSites: (ids: number[]) => void; count?: boolean }) {
  const anchor = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  // The sites from the answer (or its saved copy); "All sites" alone until they are known — never "All sites · 0" (#248).
  const widgets = known ?? [];
  const one = sites.length === 1 ? widgets.find((w) => w.id === sites[0]) : undefined;
  const label = !sites.length ? (count && widgets.length ? text('All sites · {n}', { n: widgets.length }) : text('All sites')) : one ? one.name : text('{n} sites', { n: sites.length });
  const toggle = (id: number) => {
    const from = sites.length ? sites : widgets.map((w) => w.id);
    const next = from.includes(id) ? from.filter((x) => x !== id) : [...from, id].sort((a, b) => a - b);
    onSites(next.length === widgets.length ? [] : next);
  };
  return (
    <>
      <button ref={anchor} type="button" aria-label={text('Site')} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}
        className="flex h-8 shrink-0 items-center gap-1.5 rounded-[8px] border border-line bg-surface px-3 text-[12.5px] whitespace-nowrap text-ink hover:bg-subtle">
        {label} <span aria-hidden>▾</span>
      </button>
      {open ? (
        <Menu
          label={text('Sites')}
          anchor={anchor}
          prefer="bottom"
          align="end"
          onClose={() => setOpen(false)}
          sections={[
            { id: 'all', items: [{ id: 'all', label: text('All sites'), radio: true, checked: !sites.length, onSelect: () => onSites([]) }] },
            {
              id: 'sites',
              items: widgets.map((w) => ({
                id: String(w.id),
                label: w.name,
                description: w.open_now === false ? text('closed') : undefined,
                checked: !sites.length || sites.includes(w.id),
                onToggle: () => toggle(w.id),
                onSelect: () => onSites([w.id]),
              })),
            },
          ]}
        />
      ) : null}
    </>
  );
}

/** ⌘⇧M, or Ctrl+Shift+M off a Mac: the Live map window's shortcut (MAP-21). */
export const MAP_KEYS = isMac ? '⌘⇧M' : 'Ctrl+Shift+M';
/** ⌘⇧D, or Ctrl+Shift+D: Open Live dashboard from the tray (MAP-22). */
export const DASHBOARD_KEYS = isMac ? '⌘⇧D' : 'Ctrl+Shift+D';

/** The home preset's country (MAP-08): the organisation's, else wherever most of those on the site now are. */
export function homeOf(d: Dashboard, visitors: OnlineVisitor[]): string | null {
  return d.home_country ?? byCountry(placesNow(visitors))[0]?.name ?? byCountry(placesOf(d, [], 'today'))[0]?.name ?? null;
}

/* ---------------------------------------------------------------- the six figures */

export type Tone = 'plain' | 'amber' | 'red' | 'green';

function Tiles({ d, online, here, now, skew, onSection }: { d: Dashboard; online: number | null; here: OnlineVisitor[] | null; now: number; skew: number; onSection: (s: 'visitors' | Section) => void }) {
  // The longest of the chats somebody is waiting in now, in days past one ("22 days", not "532:00:52"; #284).
  const waited = longestWait(d, here, now, skew);
  const calls = d.now.on_call?.count ?? 0;
  const call = calls ? since(d.now.on_call?.since, now, skew) : null;
  const tiles: Array<{ label: string; value: string; sub: string; tone: Tone; live?: boolean; go: 'visitors' | Section; action: string; icon: string; accent?: StatTone }> = [
    // Counted as the visitor list counts them once it is in, so this, the list's header and the sidebar agree (#248).
    { label: 'On the site now', icon: 'globe', accent: 'blue', value: String(online ?? d.now.visitors_online), sub: d.now.arrived_10m ? text('+{n} in 10 min', { n: d.now.arrived_10m }) : text('seen in {n} min', { n: Math.round(d.now.window_seconds / 60) }), tone: 'plain', live: true, go: 'visitors', action: 'see who' },
    { label: 'Waiting on us', icon: 'hourglass', value: String(d.now.waiting_on_us), sub: waited !== null ? text('longest {time}', { time: waitWords(waited) }) : text('visitor spoke last'), tone: d.now.waiting_on_us ? 'amber' : 'plain', go: 'awaiting', action: 'open those chats' },
    { label: 'At risk', icon: 'warning', value: String(d.now.at_risk), sub: d.now.at_risk_after ? text('past {time}', { time: clock(d.now.at_risk_after) }) : text('nobody answered in time'), tone: d.now.at_risk ? 'red' : 'plain', go: 'awaiting', action: 'open those chats' },
    { label: 'Open chats', icon: 'messages', accent: 'violet', value: String(d.now.open + d.now.pending), sub: text('{n} staff', { n: d.now.staff_in_chats ?? 0 }), tone: 'plain', go: 'inbox', action: 'open the inbox' },
    { label: 'On a call', icon: 'phone-call', value: String(calls), sub: call !== null ? callClock(call) : text('no calls on'), tone: calls ? 'green' : 'plain', go: 'inbox', action: 'open the inbox' },
    { label: 'First reply', icon: 'reply', accent: 'cyan', value: d.today.first_response_median === null ? '—' : clock(d.today.first_response_median), sub: text('median today'), tone: 'plain', go: 'missed', action: 'open missed chats' },
  ];
  return (
    <StatGrid min={170} role="list" label={text('Right now')}>
      {tiles.map((t) => (
        <Tile key={t.label} {...t} onClick={() => onSection(t.go)} />
      ))}
    </StatGrid>
  );
}

const TILE: Record<Tone, { box: string; value: string }> = {
  plain: { box: 'border-line bg-surface', value: 'text-ink' },
  amber: { box: 'border-[#f0d08f] bg-[#fffaf0] dark:border-line dark:bg-warning-bg', value: 'text-[#9a5b10] dark:text-warning' },
  red: { box: 'border-[#f3c1bb] bg-[#fff6f5] dark:border-line dark:bg-danger-bg', value: 'text-[#c2392d] dark:text-danger' },
  green: { box: 'border-line bg-surface', value: 'text-[#2b7a4b] dark:text-success' },
};

/** The line under a figure: plain, better than before (green), or worse — and Missed's share (red) — as Insights draws them (L-07). */
export type SubTone = 'plain' | 'good' | 'bad';
const SUB: Record<SubTone, string> = { plain: 'text-ink-3', good: 'text-[#2b7a4b] dark:text-success', bad: 'text-[#a63224] dark:text-danger' };

/** The wall's figures (MAP-UI-03): white on navy, amber and red values where somebody waits or is at risk. */
const WALL: Record<Tone, string> = { plain: 'text-[#f1f4fb]', amber: 'text-[#f3c77e]', red: 'text-[#ff8a7a]', green: 'text-[#8fe0b5]' };

/**
 * One figure (C-00's six, the wall's; V-01's call tiles): its name, the number, and a line under it when there is one,
 * coloured by `subTone` — Insights' change against the previous period (L-07, UX-INS-01). On the desk it is the shared
 * StatCard: `icon` in a chip coloured by `tone`, or by `accent` when the tone is plain. `wall` draws it for the dark
 * wall screen, readable across a room (MAP-UI-03); `compact`, the four small figures of the Live map window and the
 * tray's mini-dashboard (MAP-UI-04/05). `stack` is kept for the callers: the line is always under the number now.
 */
export function Tile({ label, value, sub, tone, live, big, wall, compact, stack: _stack, subTone, action, onClick, icon, accent }: { label: string; value: string; sub?: string; tone: Tone; live?: boolean; big?: boolean; wall?: boolean; compact?: boolean; stack?: boolean; subTone?: SubTone; action?: string; onClick?: () => void; icon?: string; accent?: StatTone }) {
  if (compact) {
    return (
      <div role="listitem" aria-label={`${text(label)}: ${value}`} className={cx('flex min-w-0 flex-1 flex-col rounded-[10px] border px-2.5 py-[7px]', TILE[tone].box)}>
        <span className="truncate text-[9.5px] font-bold tracking-[0.8px] whitespace-nowrap text-ink-3 uppercase">{text(label)}</span>
        <span className={cx('text-[21px] leading-[1.15] font-bold tabular-nums', TILE[tone].value)}>{value}</span>
      </div>
    );
  }
  if (!wall) {
    // The desk's figures are the shared StatCard (#modern-cards): the tone colours the chip, `accent` a plain one.
    const label_ = (
      <span className="inline-flex items-center gap-1.5">
        {live ? <span className="h-[7px] w-[7px] shrink-0 rounded-full bg-[#2f9e67] shadow-[0_0_0_3px_#2f9e6733]" aria-hidden /> : null}
        {text(label)}
      </span>
    );
    return (
      <StatCard
        role="listitem"
        label={label_}
        value={value}
        sub={sub ? <span className={SUB[subTone ?? 'plain']}>{sub}</span> : undefined}
        icon={icon}
        tone={tone === 'plain' ? (accent ?? 'neutral') : tone}
        size={big ? 'lg' : 'md'}
        onClick={onClick}
        ariaLabel={onClick ? `${text(label)}: ${value} — ${text(action ?? '')}` : undefined}
      />
    );
  }
  // The wall (MAP-UI-03) keeps its own TV look: white on navy, big figures, coloured where somebody waits.
  const body = (
    <>
      <span className="flex items-center gap-1.5 text-[12px] font-bold tracking-[1.2px] whitespace-nowrap text-[#9aa3c4] uppercase">
        {live ? <span className="h-[7px] w-[7px] shrink-0 rounded-full bg-[#2f9e67] shadow-[0_0_0_3px_#2f9e6733]" aria-hidden /> : null}
        {text(label)}
      </span>
      <span className="flex items-baseline gap-2.5 whitespace-nowrap">
        <span className={cx('text-[44px] leading-[1.1] font-bold tabular-nums', WALL[tone])}>{value}</span>
        {sub ? <span className="truncate text-[13px] text-[#9aa3c4]">{sub}</span> : null}
      </span>
    </>
  );
  const box = 'flex min-w-0 flex-col rounded-[14px] border border-[#22306a] bg-[#111b3b] px-[18px] py-3.5 text-left';
  return onClick ? (
    <button type="button" role="listitem" aria-label={`${text(label)}: ${value} — ${text(action ?? '')}`} onClick={onClick} className={cx(box, 'hover:border-primary focus-visible:outline-2 focus-visible:outline-primary')}>
      {body}
    </button>
  ) : (
    <div role="listitem" className={box}>
      {body}
    </div>
  );
}

/* ---------------------------------------------------------------- the map card */

const placesOf = (d: Dashboard, visitors: OnlineVisitor[], when: When): Place[] =>
  when === 'now' ? placesNow(visitors) : placesToday(d.summary.places ?? d.summary.countries.filter((c) => c.name).map((c) => ({ country: c.name!, city: null, lat: null, lng: null, count: c.count })));

/** The red callout beside an at-risk place: whoever there has waited longest, and for how long. */
function callout(now: number, skew: number, named: boolean) {
  return (p: Place): string | null => {
    const v = p.visitors.filter((x) => x.chat?.at_risk).sort((a, b) => (since(b.chat?.waiting_since, now, skew) ?? 0) - (since(a.chat?.waiting_since, now, skew) ?? 0))[0];
    if (!v) return null;
    const time = clock(since(v.chat?.waiting_since, now, skew) ?? 0);
    return named ? text('{name} · at risk {time}', { name: v.name || v.label, time }) : text('At risk {time}', { time });
  };
}

/**
 * What the shading means, in the theme's words (#284): on light more visitors is a darker country, on dark a brighter
 * one — read from the theme in force, so it changes the moment the theme does.
 */
function captionOf(when: When, dark: boolean): string {
  if (when === 'now') return dark ? text('Shaded by visitors now · brighter = more') : text('Shaded by visitors now · darker = more');
  return dark ? text('Shaded by visitors today · brighter = more') : text('Shaded by visitors today · darker = more');
}

function WhereTheyAre({ d, full, visitors, now, skew, home }: { d: Dashboard; full: boolean; visitors: OnlineVisitor[]; now: number; skew: number; home: string | null }) {
  const [when, setWhen] = useState<When>('now');
  const [box, setBox] = useState<Box>(WORLD_BOX);
  const places = useMemo(() => placesOf(d, visitors, when), [d, visitors, when]);
  const countries = byCountry(places);
  const cities = places.filter((p) => !p.approx).length;
  const dark = useStore(app, (s) => s.resolvedTheme === 'dark');
  return (
    <section aria-label={text('Where they are')} className="flex min-w-0 flex-col overflow-hidden rounded-[12px] border border-line bg-surface">
      <div className="flex min-h-[46px] shrink-0 flex-wrap items-center gap-2.5 px-3.5 py-1.5">
        <h2 className="min-w-0 flex-1 truncate text-[14px] font-bold text-ink">
          {text('Where they are')}{' '}
          <span className="text-[12.5px] font-normal text-ink-3">
            · {countries.length === 1 ? text('1 country') : text('{n} countries', { n: countries.length })}
            {cities ? `, ${cities === 1 ? text('1 city') : text('{n} cities', { n: cities })}` : ''}
          </span>
        </h2>
        <Segmented label="Show" value={when} onChange={setWhen} options={[['now', 'Now'], ['today', 'Today']]} />
        <Zooms presets={presetsFor(home)} box={box} onBox={setBox} />
      </div>
      <LiveMap
        whenVisible
        places={places}
        box={box}
        onBox={setBox}
        callout={when === 'now' ? callout(now, skew, true) : undefined}
        caption={captionOf(when, dark)}
        label={when === 'now' ? 'Map of visitors on the site now' : 'Map of visitors today'}
        className="h-[400px] shrink-0 border-y border-line"
      />
      <div className="border-b border-line px-3.5 py-[9px]">
        <MapLegend />
      </div>
      {when === 'today' && !full ? <p className="px-3.5 py-3 text-center text-[12px] text-ink-3">{text('Loading today…')}</p> : <CountryRows rows={countries.slice(0, 6)} />}
      <p className="mt-auto border-t border-line bg-subtle px-3.5 py-[9px] text-[11px] text-ink-3">
        {text("City dots come from your CDN or the server's GeoIP database. Visitors located only by browser timezone show as a dashed ring on their country (≈) and are never pinned to a city.")}
      </p>
    </section>
  );
}

/**
 * A segmented switch (C-00's Now / Today, the map's zooms; V-01's Calls / Call-backs). An option may carry a count, drawn
 * as V-01's amber pill beside its words.
 */
export function Segmented<T extends string>({ label, value, onChange, options }: { label: string; value: T; onChange: (v: T) => void; options: ReadonlyArray<readonly [T, string] | readonly [T, string, number | null]> }) {
  return (
    <div role="radiogroup" aria-label={text(label)} className="flex gap-0.5 rounded-[8px] bg-subtle p-0.5">
      {options.map(([k, l, n]) => (
        <button key={k} type="button" role="radio" aria-checked={value === k} onClick={() => onChange(k)} className={cx(SEG, 'gap-1.5', value === k ? SEG_ON : SEG_OFF)}>
          {text(l)}
          {n ? ' ' : null}
          {n ? <span className="rounded-[8px] bg-warning-bg px-1.5 text-[10.5px] font-bold text-[#9a5b10] dark:text-warning">{n}</span> : null}
        </button>
      ))}
    </div>
  );
}

const SEG = 'flex h-[26px] items-center rounded-[6px] px-2.5 text-[12px] whitespace-nowrap';
const SEG_ON = 'bg-surface font-bold text-primary shadow-[0_1px_2px_rgba(17,27,59,0.12)]';
const SEG_OFF = 'text-ink-2 hover:text-ink';

/** The map's ready zooms (MAP-08): World, the region, (on the full map) the part of it, and the home country. */
export function Zooms({ presets, box, onBox, onPreset }: { presets: Preset[]; box: Box; onBox: (b: Box) => void; onPreset?: (p: Preset) => void }) {
  return (
    <div role="group" aria-label={text('Zoom to')} className="flex gap-0.5 rounded-[8px] bg-subtle p-0.5">
      {presets.map((p) => (
        <button key={p.key} type="button" aria-pressed={sameBox(box, p.box)} onClick={() => (onPreset ? onPreset(p) : onBox(p.box))} className={cx(SEG, sameBox(box, p.box) ? SEG_ON : SEG_OFF)}>
          {text(p.label)}
        </button>
      ))}
    </div>
  );
}

function CountryRows({ rows }: { rows: Array<{ name: string; count: number }> }) {
  if (!rows.length) return <p className="px-3.5 py-3 text-center text-[12px] text-ink-3">{text('No locations yet.')}</p>;
  const max = Math.max(...rows.map((r) => r.count), 1);
  return (
    <ul aria-label={text('Countries')} className="grid grid-cols-2 gap-x-[26px] gap-y-2 px-3.5 py-3">
      {rows.map((r) => {
        const c = findCountry(r.name);
        return (
          <li key={r.name} className="flex items-center gap-2 text-[12px]">
            <span className="w-[18px] text-center" aria-hidden>{c ? flagOf(c.code) : '🌐'}</span>
            <span className="w-[120px] truncate text-ink-2">{c?.name ?? r.name}</span>
            <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-subtle" aria-hidden>
              <span className="block h-1.5 rounded-full bg-[#4a63e8]" style={{ width: `${Math.round((r.count / max) * 100)}%` }} />
            </span>
            <span className="w-[22px] text-right font-semibold text-ink-2 tabular-nums">{r.count}</span>
          </li>
        );
      })}
    </ul>
  );
}

/* ---------------------------------------------------------------- Full map */

type ListProps = Omit<Parameters<typeof OnSiteNow>[0], 'visitors'>;

/** The state chips (MAP-14), each with its colour as in the legend, so a state is never told by colour alone. */
const CHIPS: Array<{ id: Filter; label: string; dot: string | null }> = [
  { id: 'all', label: 'All', dot: null },
  { id: 'needs', label: 'Needs you', dot: STATE.at_risk.colour },
  { id: 'chat', label: 'In a chat', dot: STATE.chatting.colour },
  { id: 'browsing', label: 'Browsing', dot: STATE.browsing.colour },
];

/**
 * The full map (MAP-UI-02, MAP-15): the map given the content area, with Now / Today, the zooms, the sites, the state
 * chips and the legend above it, and the selected place's panel beside it. Drag to pan, scroll or pinch to zoom; past a
 * region the countries in view take their detailed outlines. The view is kept in the address as it settles.
 */
function FullMap({ d, full, visitors, list, drawer, header, live, onLive }: {
  d: Dashboard;
  /** Whether today's places are in yet (the full answer, #248). */
  full: boolean;
  visitors: OnlineVisitor[];
  list: ListProps;
  drawer: ReactNode;
  header: (controls: ReactNode) => ReactNode;
  live: LiveParams;
  onLive: (patch: Partial<LiveParams>) => void;
}) {
  const when: When = live.when ?? 'now';
  const filter: Filter = live.filter ?? 'all';
  const home = homeOf(d, visitors);
  const presets = useMemo(() => presetsFor(home, true), [home]);
  const [box, setBox] = useState<Box>(() => boxOfParam(live.map, presets));
  // The address follows the view once it settles, not at every step of a drag.
  useEffect(() => {
    const t = setTimeout(() => {
      const m = mapParam(box, presets);
      if (m !== live.map) onLive({ map: m });
    }, 400);
    return () => clearTimeout(t);
  }, [box, presets, live.map, onLive]);

  const shown = useMemo(() => (filter === 'all' ? visitors : visitors.filter((v) => groupOf(stateOf(v)) === filter)), [visitors, filter]);
  const today = useMemo(() => placesOf(d, [], 'today'), [d]);
  const now_ = useMemo(() => placesNow(shown), [shown]);
  const places = when === 'now' ? now_ : today;
  // A pick is a place or a cluster of them (the map's key joins theirs), found again in each new answer.
  const members = live.place ? places.filter((p) => live.place!.split(CLUSTER).includes(p.key)) : [];
  const place = members.length ? mergePlaces(members) : (places[0] ?? null);
  const count = (g: Filter) => (g === 'all' ? visitors.length : visitors.filter((v) => groupOf(stateOf(v)) === g).length);
  return (
    <main className="flex h-full min-w-0 flex-1 flex-col gap-3 overflow-y-auto bg-ground px-5 py-3.5 text-[13px] scroll-thin">
      {header(
        <>
          <Segmented label="Show" value={when} onChange={(w) => onLive({ when: w === 'now' ? null : w, place: null })} options={[['now', 'Now'], ['today', 'Today']]} />
          <Zooms
            presets={presets}
            box={box}
            onBox={setBox}
            onPreset={(p) => {
              setBox(p.box);
              onLive({ map: p.key });
            }}
          />
        </>,
      )}
      <div className="flex flex-wrap items-center gap-2">
        <div role="group" aria-label={text('Show visitors')} className="flex flex-wrap items-center gap-2">
          {CHIPS.map((c) => (
            <button key={c.id} type="button" aria-pressed={filter === c.id} onClick={() => onLive({ filter: c.id === 'all' ? null : c.id, place: null })}
              className={cx('flex h-7 items-center gap-1.5 rounded-full px-[11px] text-[12px] whitespace-nowrap', filter === c.id ? 'bg-navy font-bold text-white' : 'border border-line bg-surface text-ink hover:bg-subtle')}>
              {c.dot ? <span className="h-2 w-2 rounded-full" style={{ background: c.dot }} aria-hidden /> : null}
              {text(c.label)} · {count(c.id)}
            </button>
          ))}
        </div>
        <span className="flex-1" />
        <MapLegend />
      </div>
      <div className="grid min-h-[520px] flex-1 gap-3.5 [grid-template-columns:minmax(0,1fr)_minmax(300px,340px)]">
        <section aria-label={text('Map')} className="relative min-w-0 overflow-hidden rounded-[12px] border border-line">
          <LiveMap
            places={places}
            box={box}
            onBox={setBox}
            fit
            selected={place?.key ?? null}
            onSelect={(p) => onLive({ place: p.key })}
            caption={text('Detailed outlines load when you zoom past a region · drag to pan · scroll or pinch to zoom')}
            label={when === 'now' ? 'Map of visitors on the site now' : 'Map of visitors today'}
            className="absolute inset-0"
          />
        </section>
        <section aria-label={text('Selected place')} className="relative flex min-h-0 flex-col overflow-hidden rounded-[12px] border border-line bg-surface">
          {place ? (
            <SelectedPlace place={place} visitors={visitors} today={today} when={when} list={list} onClose={() => onLive({ place: null })} />
          ) : (
            <p className="px-4 py-8 text-center text-ink-3">{when === 'today' && !full ? text('Loading today…') : text('Nobody to show here yet.')}</p>
          )}
          {drawer ? <Drawer>{drawer}</Drawer> : null}
        </section>
      </div>
    </main>
  );
}

/** How the city-level visitors were located, in words: "GeoIP", "your CDN", or both (MAP-05, MAP-06). */
function sourceOf(vs: OnlineVisitor[]): 'geoip' | 'header' | 'either' {
  const all = new Set(vs.map((v) => v.geo_source ?? null));
  return all.size === 1 && all.has('geoip') ? 'geoip' : all.size === 1 && all.has('header') ? 'header' : 'either';
}

const BADGE: Record<ReturnType<typeof sourceOf>, string> = { geoip: 'City · GeoIP', header: 'City · CDN', either: 'City · CDN or GeoIP' };
const SOURCE: Record<ReturnType<typeof sourceOf>, string> = { geoip: 'GeoIP', header: 'your CDN', either: 'your CDN or GeoIP' };

/**
 * How precise a country's locations are (MAP-UI-02, MAP-05): "8 of 9 Sri Lankan visitors have a city from GeoIP (rounded
 * to about 10 km). 1 is placed by browser timezone only, so it is shown on the country, not a city."
 */
export function precisionNote(country: string, inCountry: OnlineVisitor[]): string {
  const cities = inCountry.filter((v) => typeof v.lat === 'number' && typeof v.lng === 'number');
  const n = inCountry.length;
  const exact = cities.length;
  const source = text(SOURCE[sourceOf(cities)]);
  const people = demonymOf(country);
  const first = people
    ? exact === 1
      ? text('{exact} of {n} {people} visitors has a city from {source} (rounded to about 10 km).', { exact, n, people, source })
      : text('{exact} of {n} {people} visitors have a city from {source} (rounded to about 10 km).', { exact, n, people, source })
    : exact === 1
      ? text('{exact} of {n} visitors in {country} has a city from {source} (rounded to about 10 km).', { exact, n, country, source })
      : text('{exact} of {n} visitors in {country} have a city from {source} (rounded to about 10 km).', { exact, n, country, source });
  const rest = n - exact;
  if (!rest) return first;
  return `${first} ${
    rest === 1
      ? text('{n} is placed by browser timezone only, so it is shown on the country, not a city.', { n: rest })
      : text('{n} are placed by browser timezone only, so they are shown on the country, not a city.', { n: rest })
  }`;
}

/**
 * A place on the full map (MAP-UI-02, MAP-11): its name, region and country with how many are there now, how precise
 * its location is and today's figures, then its people grouped Needs you / In a chat / Browsing with Join, Open and
 * Start chat, and at the foot how precise the country's locations are.
 */
function SelectedPlace({ place, visitors, today, when, list, onClose }: { place: Place; visitors: OnlineVisitor[]; today: Place[]; when: When; list: ListProps; onClose: () => void }) {
  const keys = place.key.split(CLUSTER);
  const here = when === 'now' ? today.filter((p) => keys.includes(p.key)) : [place];
  const todayN = here.reduce((n, p) => n + p.count, 0);
  const chats = here.some((p) => p.chats !== undefined) ? here.reduce((n, p) => n + (p.chats ?? 0), 0) : null;
  const inCountry = visitors.filter((v) => v.country === place.country);
  const where = [place.region, place.city ? place.country : null].filter(Boolean).join(', ');
  const badge = place.approx ? text('Country only · browser timezone') : text(BADGE[sourceOf(place.visitors.length ? place.visitors : inCountry.filter((v) => typeof v.lat === 'number'))]);
  const visitorsWord = todayN === 1 ? text('{n} visitor', { n: todayN }) : text('{n} visitors', { n: todayN });
  const chatsWord = chats === null ? null : chats === 1 ? text('{n} chat', { n: chats }) : text('{n} chats', { n: chats });
  return (
    <>
      <div className="shrink-0 border-b border-line px-3.5 py-3.5">
        <div className="flex items-center gap-2">
          <h2 className="min-w-0 flex-1 truncate text-[16px] font-bold text-ink">{place.city ?? place.country}{place.approx ? ' ≈' : ''}</h2>
          <button type="button" onClick={onClose} aria-label={text('Show the busiest place')} className="flex h-7 w-7 items-center justify-center rounded-[7px] text-ink-3 hover:bg-subtle hover:text-ink">
            <Icon name="x" size={14} />
          </button>
        </div>
        <p className="text-[12px] text-ink-3">
          {where}
          {where ? ' · ' : ''}
          {when === 'now' ? text('{n} on the site now', { n: place.visitors.length }) : text('{n} today', { n: place.count })}
        </p>
        <div className="mt-2 flex flex-wrap gap-1.5 text-[11px]">
          <span className="rounded-[8px] bg-[#eff1fc] px-2 py-[3px] font-semibold text-[#273498] dark:bg-selection dark:text-primary">{badge}</span>
          {when === 'now' && todayN > 0 ? (
            <span className="rounded-[8px] bg-subtle px-2 py-[3px] text-ink-2">
              {chatsWord ? text('Today: {visitors} · {chats}', { visitors: visitorsWord, chats: chatsWord }) : text('Today: {visitors}', { visitors: visitorsWord })}
            </span>
          ) : null}
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto scroll-thin">{when === 'now' ? <OnSiteNow visitors={place.visitors} {...list} limit={50} /> : null}</div>
      {inCountry.length ? (
        <div className="flex shrink-0 flex-col gap-1.5 border-t border-line bg-subtle px-3.5 py-3 text-[12px] text-ink-2">
          <p className="text-[10.5px] font-bold tracking-[0.9px] text-ink-3 uppercase">{text('How precise is this')}</p>
          <p>{precisionNote(place.country, inCountry)}</p>
        </div>
      ) : null}
    </>
  );
}

/* ---------------------------------------------------------------- Wall mode */

/**
 * While the wall is up: the whole screen, and the screen kept awake (MAP-16, WF-M3). Leaving full screen (Esc does) leaves
 * the wall; a screen hidden and shown again asks to stay awake again, as the browser drops the lock when it is hidden.
 */
function useWallScreen(onExit: () => void, keepAwake = true) {
  const exit = useRef(onExit);
  useEffect(() => {
    exit.current = onExit;
  });
  useEffect(() => {
    let alive = true;
    let lock: WakeLockSentinel | null = null;
    const awake = async () => {
      // Turned off in the Wall mode sheet (L-06, MAP-24): the screen may sleep as it usually does.
      if (!keepAwake || document.visibilityState !== 'visible' || !('wakeLock' in navigator)) return;
      try {
        const l = await navigator.wakeLock.request('screen');
        if (alive) lock = l;
        else void l.release();
      } catch {
        // Refused (a battery saver, say): the wall still shows; the screen may sleep.
      }
    };
    void awake();
    const shown = () => void awake();
    document.addEventListener('visibilitychange', shown);
    const root = document.documentElement;
    let full = false;
    if (!document.fullscreenElement && typeof root.requestFullscreen === 'function') {
      root.requestFullscreen().then(
        () => void (full = true),
        () => undefined,
      );
    }
    const changed = () => {
      if (full && !document.fullscreenElement) exit.current();
    };
    document.addEventListener('fullscreenchange', changed);
    return () => {
      alive = false;
      document.removeEventListener('visibilitychange', shown);
      document.removeEventListener('fullscreenchange', changed);
      void lock?.release().catch(() => undefined);
      if (full && document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
    };
  }, [keepAwake]);
}

/** Every 60 s on the wall, when the sheet says to cycle (L-06, MAP-24): World → region → home country, then round. */
export const WALL_CYCLE_MS = 60_000;

/** The view the wall's map shows: the world, or — cycling — the next of World, region and home country each minute. */
function useWallView(home: string | null, cycle: boolean): Box {
  const presets = useMemo(() => presetsFor(home), [home]);
  const [step, setStep] = useState(0);
  useEffect(() => {
    if (!cycle || presets.length < 2) return;
    const t = setInterval(() => setStep((n) => n + 1), WALL_CYCLE_MS);
    return () => clearInterval(t);
  }, [cycle, presets.length]);
  return cycle && presets.length ? presets[step % presets.length]!.box : WORLD_BOX;
}

/**
 * For a TV in the support room (MAP-UI-03, MAP-16): dark, the whole screen, the figures large, the map, what just
 * happened and the sites — with nobody named, since anybody walking past can read it (MNFR-04). It keeps the screen
 * awake and carries on through a dropped connection; Esc (or its button) comes back.
 */
function WallMode({ d, online, visitors, here, sites, now, skew, updated, onClose, cycle, awake }: { d: Dashboard; online: number | null; visitors: OnlineVisitor[]; here: OnlineVisitor[] | null; sites: number[]; now: number; skew: number; updated: number | null; onClose: () => void; cycle: boolean; awake: boolean }) {
  useWallScreen(onClose, awake);
  const box = useWallView(homeOf(d, visitors), cycle);
  const places = useMemo(() => placesNow(visitors), [visitors]);
  const waited = longestWait(d, here, now, skew);
  // In a chat as the chips count it (MAP-UI-02): somebody waiting on us is under Waiting, not here.
  const inChat = visitors.filter((v) => groupOf(stateOf(v)) === 'chat').length;
  const calls = d.now.on_call?.count ?? 0;
  const shown = sites.length ? d.widgets.filter((w) => sites.includes(w.id)) : d.widgets;
  const names = shown.map((w) => w.name).join(', ');
  const stale = updated !== null && updated > STALE_AFTER;
  return (
    // Dark whichever theme the app is in, its map and legend too: inside it the theme's variables are the dark ones (#284).
    <div role="dialog" aria-modal="true" aria-label={text('Website chats — live, wall mode')} data-theme="dark" className="fixed inset-0 z-[120] flex flex-col gap-4 overflow-auto bg-[#0b1430] px-7 py-[22px] text-[#f1f4fb]">
      <div className="flex flex-wrap items-center gap-3">
        <BrandMark size={34} />
        <span className="text-[20px] font-bold">{text('Website chats — live')}</span>
        <span className={cx('flex h-[26px] items-center gap-[7px] rounded-full px-[11px] text-[13px] font-bold', stale ? 'bg-[#3a2a10] text-[#f3c77e]' : 'bg-[#123a2a] text-[#8fe0b5]')}>
          <span className={cx('h-2 w-2 rounded-full', stale ? 'bg-[#d9922e]' : 'bg-[#2f9e67] shadow-[0_0_0_4px_rgba(47,158,103,0.3)]')} aria-hidden />
          {stale ? text('Reconnecting…') : text('Live')}
        </span>
        <span className="min-w-0 truncate text-[14px] text-[#9aa3c4]">{!sites.length && shown.length > 1 ? text('All sites · {sites}', { sites: names }) : names}</span>
        <span className="flex-1" />
        <span className="text-[13px] text-[#9aa3c4]">{text('Names hidden on this screen')}</span>
        <span className="font-mono text-[26px] font-medium tabular-nums">{new Date(now).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
        <button type="button" onClick={onClose} className="rounded-[6px] border border-[#2a3870] px-2 py-1 text-[12px] text-[#8b93ad] hover:text-[#f1f4fb]">
          {text('Esc to exit')}
        </button>
      </div>
      <div className="grid grid-cols-6 gap-3.5" role="list" aria-label={text('Right now')}>
        <Tile wall label="On the site now" value={String(online ?? d.now.visitors_online)} sub={d.now.arrived_10m ? text('+{n} in 10 min', { n: d.now.arrived_10m }) : text('seen in {n} min', { n: Math.round(d.now.window_seconds / 60) })} tone="plain" />
        <Tile wall label="Waiting on us" value={String(d.now.waiting_on_us)} sub={waited !== null ? text('longest {time}', { time: waitWords(waited) }) : text('Nobody waiting')} tone={d.now.waiting_on_us ? 'amber' : 'plain'} />
        <Tile wall label="At risk" value={String(d.now.at_risk)} sub={d.now.at_risk_after ? text('past {time}', { time: clock(d.now.at_risk_after) }) : text('nobody answered in time')} tone={d.now.at_risk ? 'red' : 'plain'} />
        <Tile wall label="In a chat" value={String(inChat)} sub={calls ? text('{n} on a call', { n: calls }) : text('{n} staff', { n: d.now.staff_in_chats ?? 0 })} tone="plain" />
        <Tile wall label="First reply" value={d.today.first_response_median === null ? '—' : clock(d.today.first_response_median)} sub={text('median today')} tone="plain" />
        <Tile wall label="Missed today" value={String(d.today.missed)} sub={text('{n} in last hour', { n: d.today.missed_last_hour ?? 0 })} tone="plain" />
      </div>
      <div className="grid min-h-0 flex-1 gap-[18px] [grid-template-columns:minmax(0,1fr)_minmax(320px,26%)]">
        {/* The dashboard's map in its dark colours, its dots a step brighter (`data-map-wall`) and larger, names larger. */}
        <div data-map-wall className="relative min-h-[360px] overflow-hidden rounded-[16px] border border-[#1c2858]">
          <LiveMap places={places} box={box} wall edges={false} label="Map of visitors on the site now" className="absolute inset-0" />
          <div className="absolute bottom-3.5 left-3.5 rounded-[10px] border border-[#22306a] bg-[rgba(11,20,48,0.85)] px-3 py-2">
            <MapLegend />
          </div>
        </div>
        <div className="flex min-h-0 flex-col">
          <p className="pb-1 text-[12px] font-bold tracking-[1.2px] text-[#9aa3c4] uppercase">{text('Just now')}</p>
          <ul className="flex flex-col" aria-label={text('Just now')}>
            {justNow(d, visitors, now, skew).map((e, i) => (
              <li key={i} className="flex items-start gap-2.5 border-b border-[#1c2858] py-2.5">
                <span className="mt-1.5 h-[9px] w-[9px] shrink-0 rounded-full" style={{ background: e.dot }} aria-hidden />
                <span className={cx('min-w-0 flex-1 text-[15px]', e.strong ? 'font-bold text-white' : 'font-medium text-[#dfe3f0]')}>{e.text}</span>
                <span className="shrink-0 font-mono text-[12px] whitespace-nowrap text-[#8b93ad] tabular-nums">{e.at}</span>
              </li>
            ))}
          </ul>
          <div className="mt-auto flex flex-col gap-2 pt-4">
            <p className="text-[12px] font-bold tracking-[1.2px] text-[#9aa3c4] uppercase">{text('Sites')}</p>
            <ul className="flex flex-col gap-2" aria-label={text('Sites')}>
              {shown.map((w) => (
                <li key={w.id} className={cx('flex justify-between gap-2 text-[14px]', w.open_now === false && 'text-[#9aa3c4]')}>
                  <span className="min-w-0 truncate">
                    <span className={w.open_now === false ? 'text-[#5a6386]' : 'text-[#2f9e67]'} aria-hidden>●</span> {w.name}
                    {w.open_now === false ? ` · ${text('closed')}` : ''}
                  </span>
                  <span className="tabular-nums">{w.online}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * What just happened, for the wall, with nobody named (MAP-16, MNFR-04): waiting and at-risk visitors first, calls
 * answered, then the activity log — arrivals, pages, chats started — each said by its place and event only.
 */
export function justNow(d: Pick<Dashboard, 'activity'>, visitors: OnlineVisitor[], now: number, skew = 0): Array<{ text: string; at: string; dot: string; t: number; strong: boolean }> {
  const out: Array<{ text: string; at: string; dot: string; t: number; strong: boolean }> = [];
  const place = (city: string | null | undefined, country: string | null | undefined, exact = true) => city ?? (country ? `${country}${exact ? '' : ' ≈'}` : text('somewhere'));
  for (const v of visitors) {
    const where = place(v.city, v.country, typeof v.lat === 'number');
    if (v.chat?.awaiting && v.chat.waiting_since) {
      const t = parseTs(v.chat.waiting_since).getTime();
      out.push(
        v.chat.at_risk
          ? { text: text('A visitor in {where} has waited {time} — at risk', { where, time: clock(since(v.chat.waiting_since, now, skew) ?? 0) }), at: timeLabel(v.chat.waiting_since), dot: STATE.at_risk.colour, t: Number.MAX_SAFE_INTEGER, strong: true }
          : { text: text('A visitor in {where} is waiting for a reply', { where }), at: timeLabel(v.chat.waiting_since), dot: STATE.waiting.colour, t: t + 1, strong: true },
      );
    }
    if (v.chat?.call?.since && v.chat.call.status !== 'ringing') {
      out.push({ text: text('Voice call answered · {where}', { where }), at: timeLabel(v.chat.call.since), dot: STATE.on_call.colour, t: parseTs(v.chat.call.since).getTime(), strong: false });
    }
  }
  const words: Record<string, (r: NonNullable<Dashboard['activity']>[number]) => string | null> = {
    chat_started: () => text('Chat started'),
    page_view: (r) => (r.arrived ? (r.referrer_host ? text('Arrived from {host}', { host: r.referrer_host }) : text('Arrived')) : text('Opened {path}', { path: pathOf(r.url) })),
    identified: () => text('A visitor shared their details'),
    rated: () => text('A chat was rated'),
    offline_form: () => text('A message was left'),
  };
  for (const r of d.activity ?? []) {
    const say = words[r.kind]?.(r);
    if (!say) continue;
    out.push({ text: `${say} · ${place(r.city, r.country, !r.approx)}`, at: timeLabel(r.at), dot: r.kind === 'chat_started' ? STATE.chatting.colour : STATE.browsing.colour, t: parseTs(r.at).getTime(), strong: false });
  }
  return out.sort((a, b) => b.t - a.t).slice(0, 8);
}
