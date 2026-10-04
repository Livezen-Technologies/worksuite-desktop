import { useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Icon } from '../../../../components/Icon';
import { Select } from '../../../../components/Select';
import { cx, ErrorNote, Spinner } from '../../../../components/ui';
import { ApiError, apiPost } from '../../../../core/api';
import { errorMessage } from '../../../../core/bridge';
import { text } from '../../../../core/i18n';
import { parseTs, timeLabel } from '../../../../core/time';
import { toast } from '../../../../core/toasts';
import { useNow } from '../../../calls/parts';
import { useWebsiteInbox, WEBSITE, type Section } from '../api';
import { findCountry, flagOf } from './countries';
import {
  byCountry, callClock, clock, CLUSTER, countryBox, groupOf, mergePlaces, padded, pathOf, placesNow, placesToday, regionOf, sameBox, since, stateOf, WORLD_BOX,
  type Box, type Dashboard, type OnlineVisitor, type Place,
} from './liveMap';
import { LiveMap, MapLegend } from './WorldMapView';
import { OnSiteNow } from './OnSiteNow';

/*
 * The Live dashboard (worksuite-desktop C-00; the web's LiveDashboard, WS-WCHAT MAP-UI-01…03): who is on the sites right
 * now, what they are doing, and where they are — six figures, a live map, and everybody on the site in the order they
 * need us. Full map opens the map large with a place's people beside it; Wall mode is the same for a screen on the
 * wall, filling the window with names hidden. Both stay in this tab (no second window), and Esc comes back.
 *
 * IT IS NOT THE REPORTS SCREEN: it answers "what is happening this minute", from its own endpoint, polled every ten
 * seconds like the visitor list so the two never disagree about how many people are on the site.
 */

type Mode = 'dashboard' | 'map' | 'wall';
type When = 'now' | 'today';

export function LiveDashboard({ dash, visitors, loading, error, onRetry, site, onSite, selected, onSelect, onStart, onOpenChat, onSection, drawer }: {
  dash: UseQueryResult<Dashboard>;
  /** Everybody on the chosen site now. */
  visitors: OnlineVisitor[];
  loading: boolean;
  error: unknown;
  onRetry: () => void;
  site: number;
  onSite: (id: number) => void;
  selected: number | null;
  onSelect: (id: number | null) => void;
  /** Start chat: the visitor's details open, ready to write to them. */
  onStart: (v: OnlineVisitor) => void;
  onOpenChat: (conversationId: number) => void;
  onSection: (s: 'visitors' | Section) => void;
  /** The selected visitor's details, shown over the list. */
  drawer: ReactNode;
}) {
  const qc = useQueryClient();
  const [mode, setMode] = useState<Mode>('dashboard');
  const now = useNow(1_000);
  const d = dash.data;
  // How far the server's clock is ahead of this one: every wait and call is counted on its clock.
  const skew = d?.server_time ? parseTs(d.server_time).getTime() - dash.dataUpdatedAt : 0;
  const updated = dash.dataUpdatedAt ? Math.max(0, Math.round((now - dash.dataUpdatedAt) / 1000)) : null;

  // What was said last in each chat, from the inbox the workspace keeps fresh; nothing is fetched for it here.
  const inbox = useWebsiteInbox(false, false);
  const said = useMemo(() => new Map((inbox.data?.conversations ?? []).map((r) => [r.id, r.last_message?.body ?? null])), [inbox.data]);
  const lastOf = (id: number) => said.get(id) ?? null;

  // Esc steps back: out of Wall mode, then the visitor's details, then the full map.
  const drawn = !!drawer;
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      if (mode === 'wall') setMode('dashboard');
      else if (drawn) onSelect(null);
      else if (mode === 'map') setMode('dashboard');
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [mode, drawn, onSelect]);

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

  const header = (title: string, subtitle: string | null, back: ReactNode, children: ReactNode) => (
    <div className="flex flex-wrap items-center gap-2.5">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2.5">
          {back}
          <h1 className="text-[22px] font-bold text-ink">{text(title)}</h1>
          <LivePill updated={updated} />
        </div>
        {subtitle ? <p className="text-[12.5px] text-ink-3">{text(subtitle)}</p> : null}
      </div>
      <Select aria-label={text('Site')} value={site} onChange={(e) => onSite(Number(e.target.value))} className="h-8 rounded-[8px] border border-line bg-surface px-3 text-[12.5px] text-ink">
        <option value={0}>{text('All sites · {n}', { n: d?.widgets.length ?? 0 })}</option>
        {(d?.widgets ?? []).map((w) => <option key={w.id} value={w.id}>{w.open_now === false ? `${w.name} (${text('closed')})` : w.name}</option>)}
      </Select>
      {children}
    </div>
  );

  if (mode === 'map' && d) {
    return (
      <FullMap
        d={d}
        visitors={visitors}
        list={list}
        drawer={drawer}
        header={header(
          'Map',
          null,
          <button type="button" onClick={() => setMode('dashboard')} className="flex items-center gap-1 text-[13px] font-semibold text-primary hover:underline">
            <Icon name="chevron-left" size={15} /> {text('Live dashboard')}
          </button>,
          null,
        )}
      />
    );
  }

  return (
    <main className="flex h-full min-w-0 flex-1 flex-col gap-3 overflow-y-auto bg-ground px-5 py-4 text-[13px] scroll-thin">
      {header(
        'Live dashboard',
        'Who is on your sites right now, what they are doing, and where they are.',
        null,
        <>
          <button type="button" onClick={() => setMode('map')} disabled={!d} className={OUTLINE}>
            <Icon name="fullscreen" size={14} /> {text('Full map')}
          </button>
          <button type="button" onClick={() => setMode('wall')} disabled={!d} className={OUTLINE}>
            <Icon name="monitor" size={14} /> {text('Wall mode')}
          </button>
        </>,
      )}
      {dash.error && !d ? <ErrorNote error={dash.error} onRetry={() => void dash.refetch()} /> : null}
      {dash.isLoading ? <Spinner /> : null}
      {d ? <Tiles d={d} now={now} skew={skew} onSection={onSection} /> : null}
      {d ? (
        <div className="grid min-h-0 items-start gap-3.5 [grid-template-columns:minmax(0,65fr)_minmax(0,35fr)]">
          <WhereTheyAre d={d} visitors={visitors} now={now} skew={skew} />
          <section aria-label={text('On the site now')} className="relative flex min-h-[420px] min-w-0 flex-col overflow-hidden rounded-[12px] border border-line bg-surface">
            <div className="flex h-[46px] shrink-0 items-center border-b border-line px-3.5">
              <h2 className="min-w-0 flex-1 truncate text-[14px] font-bold text-ink">
                {text('On the site now')} <span className="font-normal text-ink-3">· {visitors.length}</span>
              </h2>
              <span className="text-[11.5px] text-ink-3">{text('Needs you first')}</span>
            </div>
            {loading ? <Spinner /> : error ? <ErrorNote error={error} onRetry={onRetry} /> : <OnSiteNow visitors={visitors} {...list} />}
            {visitors.length ? (
              <div className="px-3.5 pt-2 pb-3">
                <button type="button" onClick={() => onSection('visitors')} className="text-[12.5px] font-bold text-primary hover:underline">
                  {text('All {n} visitors online →', { n: visitors.length })}
                </button>
              </div>
            ) : null}
            {drawer ? <Drawer>{drawer}</Drawer> : null}
          </section>
        </div>
      ) : null}
      {mode === 'wall' && d ? <WallMode d={d} visitors={visitors} now={now} skew={skew} onClose={() => setMode('dashboard')} /> : null}
    </main>
  );
}

const OUTLINE = 'flex h-8 shrink-0 items-center gap-1.5 rounded-[8px] border border-line bg-surface px-3 text-[12.5px] font-semibold whitespace-nowrap text-ink hover:bg-subtle disabled:opacity-50';

/** The selected visitor's details over the right of a card, so the map keeps its place (C-00). */
function Drawer({ children }: { children: ReactNode }) {
  return <div className="absolute inset-y-0 right-0 z-10 w-[min(380px,100%)] overflow-y-auto border-l border-line bg-surface shadow-[-8px_0_24px_rgba(17,27,59,0.12)] scroll-thin">{children}</div>;
}

/** "Live · updated 3 s ago", counting up each second from the last answer. */
function LivePill({ updated }: { updated: number | null }) {
  return (
    <span className="flex h-[22px] items-center gap-1.5 rounded-full bg-[#e9f6ee] px-[9px] text-[11.5px] font-bold text-[#1f6b40] dark:bg-success-bg dark:text-success">
      <span className="h-[7px] w-[7px] rounded-full bg-[#2f9e67] shadow-[0_0_0_3px_#cdebd8] dark:shadow-none" aria-hidden />
      {updated === null ? text('Live') : text('Live · updated {n} s ago', { n: updated })}
    </span>
  );
}

/* ---------------------------------------------------------------- the six figures */

export type Tone = 'plain' | 'amber' | 'red' | 'green';

function Tiles({ d, now, skew, onSection }: { d: Dashboard; now: number; skew: number; onSection: (s: 'visitors' | Section) => void }) {
  const waited = d.now.waiting_on_us ? since(d.now.longest_wait_since, now, skew) : null;
  const calls = d.now.on_call?.count ?? 0;
  const call = calls ? since(d.now.on_call?.since, now, skew) : null;
  const tiles: Array<{ label: string; value: string; sub: string; tone: Tone; live?: boolean; go: 'visitors' | Section; action: string }> = [
    { label: 'On the site now', value: String(d.now.visitors_online), sub: d.now.arrived_10m ? text('+{n} in 10 min', { n: d.now.arrived_10m }) : text('seen in {n} min', { n: Math.round(d.now.window_seconds / 60) }), tone: 'plain', live: true, go: 'visitors', action: 'see who' },
    { label: 'Waiting on us', value: String(d.now.waiting_on_us), sub: waited !== null ? text('longest {time}', { time: clock(waited) }) : text('visitor spoke last'), tone: d.now.waiting_on_us ? 'amber' : 'plain', go: 'awaiting', action: 'open those chats' },
    { label: 'At risk', value: String(d.now.at_risk), sub: d.now.at_risk_after ? text('past {time}', { time: clock(d.now.at_risk_after) }) : text('nobody answered in time'), tone: d.now.at_risk ? 'red' : 'plain', go: 'awaiting', action: 'open those chats' },
    { label: 'Open chats', value: String(d.now.open + d.now.pending), sub: text('{n} staff', { n: d.now.staff_in_chats ?? 0 }), tone: 'plain', go: 'inbox', action: 'open the inbox' },
    { label: 'On a call', value: String(calls), sub: call !== null ? callClock(call) : text('no calls on'), tone: calls ? 'green' : 'plain', go: 'inbox', action: 'open the inbox' },
    { label: 'First reply', value: d.today.first_response_median === null ? '—' : clock(d.today.first_response_median), sub: text('median today'), tone: 'plain', go: 'missed', action: 'open missed chats' },
  ];
  return (
    <div className="grid grid-cols-6 gap-2.5" role="list" aria-label={text('Right now')}>
      {tiles.map((t) => (
        <Tile key={t.label} {...t} onClick={() => onSection(t.go)} />
      ))}
    </div>
  );
}

const TILE: Record<Tone, { box: string; value: string }> = {
  plain: { box: 'border-line bg-surface', value: 'text-ink' },
  amber: { box: 'border-[#f0d08f] bg-[#fffaf0] dark:border-line dark:bg-warning-bg', value: 'text-[#9a5b10] dark:text-warning' },
  red: { box: 'border-[#f3c1bb] bg-[#fff6f5] dark:border-line dark:bg-danger-bg', value: 'text-[#c2392d] dark:text-danger' },
  green: { box: 'border-line bg-surface', value: 'text-[#2b7a4b] dark:text-success' },
};

/** One figure (C-00's six, the wall's; V-01's call tiles): its name, the number, and a line under it when there is one. */
export function Tile({ label, value, sub, tone, live, big, action, onClick }: { label: string; value: string; sub?: string; tone: Tone; live?: boolean; big?: boolean; action?: string; onClick?: () => void }) {
  const body = (
    <>
      <span className="flex items-center gap-1.5 text-[10.5px] font-bold tracking-[0.8px] whitespace-nowrap text-ink-3 uppercase">
        {live ? <span className="h-[7px] w-[7px] shrink-0 rounded-full bg-[#2f9e67] shadow-[0_0_0_3px_#2f9e6733]" aria-hidden /> : null}
        {text(label)}
      </span>
      <span className="flex items-baseline gap-2 whitespace-nowrap">
        <span className={cx('leading-[1.15] font-bold tabular-nums', big ? 'text-[44px]' : 'text-[26px]', TILE[tone].value)}>{value}</span>
        {sub ? <span className="truncate text-[11.5px] text-ink-3">{sub}</span> : null}
      </span>
    </>
  );
  const box = cx('flex min-w-0 flex-col gap-0.5 rounded-[12px] border px-3.5 py-2.5 text-left', TILE[tone].box);
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

function WhereTheyAre({ d, visitors, now, skew }: { d: Dashboard; visitors: OnlineVisitor[]; now: number; skew: number }) {
  const [when, setWhen] = useState<When>('now');
  const [box, setBox] = useState<Box>(WORLD_BOX);
  const places = useMemo(() => placesOf(d, visitors, when), [d, visitors, when]);
  const countries = byCountry(places);
  const cities = places.filter((p) => !p.approx).length;
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
        <Zooms places={places} box={box} onBox={setBox} />
      </div>
      <LiveMap
        places={places}
        box={box}
        onBox={setBox}
        callout={when === 'now' ? callout(now, skew, true) : undefined}
        caption={when === 'now' ? text('Shaded by visitors now · darker = more') : text('Shaded by visitors today · darker = more')}
        label={when === 'now' ? 'Map of visitors on the site now' : 'Map of visitors today'}
        className="h-[400px] shrink-0 border-y border-line"
      />
      <div className="border-b border-line px-3.5 py-[9px]">
        <MapLegend />
      </div>
      <CountryRows rows={countries.slice(0, 6)} />
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

/** World, the region most visitors are in, and their country: the map's three ready zooms. */
function Zooms({ places, box, onBox }: { places: Place[]; box: Box; onBox: (b: Box) => void }) {
  const top = byCountry(places)[0]?.name ?? null;
  const region = top ? regionOf(top) : null;
  const country = top ? countryBox(top) : null;
  const options: Array<[string, Box]> = [[text('World'), WORLD_BOX]];
  if (region) options.push([text(region.name), padded(region.box, 0.02)]);
  if (top && country) options.push([findCountry(top)?.name ?? top, padded(country, 0.3)]);
  return (
    <div role="group" aria-label={text('Zoom to')} className="flex gap-0.5 rounded-[8px] bg-subtle p-0.5">
      {options.map(([l, b]) => (
        <button key={l} type="button" aria-pressed={sameBox(box, b)} onClick={() => onBox(b)} className={cx(SEG, sameBox(box, b) ? SEG_ON : SEG_OFF)}>
          {l}
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

type Filter = 'all' | 'needs' | 'chat' | 'browsing';
type ListProps = Omit<Parameters<typeof OnSiteNow>[0], 'visitors'>;

function FullMap({ d, visitors, list, drawer, header }: { d: Dashboard; visitors: OnlineVisitor[]; list: ListProps; drawer: ReactNode; header: ReactNode }) {
  const [when, setWhen] = useState<When>('now');
  const [filter, setFilter] = useState<Filter>('all');
  const [box, setBox] = useState<Box>(WORLD_BOX);
  const [picked, setPicked] = useState<string | null>(null);
  const shown = useMemo(() => (filter === 'all' ? visitors : visitors.filter((v) => groupOf(stateOf(v)) === filter)), [visitors, filter]);
  const today = useMemo(() => placesOf(d, [], 'today'), [d]);
  const now_ = useMemo(() => placesNow(shown), [shown]);
  const places = when === 'now' ? now_ : today;
  // A pick is a place or a cluster of them (the map's key joins theirs), found again in each new answer.
  const members = picked ? places.filter((p) => picked.split(CLUSTER).includes(p.key)) : [];
  const place = members.length ? mergePlaces(members) : (places[0] ?? null);
  const count = (g: Filter) => (g === 'all' ? visitors.length : visitors.filter((v) => groupOf(stateOf(v)) === g).length);
  return (
    <main aria-label={text('Map')} className="flex h-full min-w-0 flex-1 flex-col gap-3 overflow-y-auto bg-ground px-5 py-4 text-[13px] scroll-thin">
      {header}
      <div className="flex flex-wrap items-center gap-2">
        {([['all', 'All'], ['needs', 'Needs you'], ['chat', 'In a chat'], ['browsing', 'Browsing']] as const).map(([k, l]) => (
          <button key={k} type="button" aria-pressed={filter === k} onClick={() => setFilter(k)} className={cx('h-7 rounded-full px-3 text-[12px] font-semibold', filter === k ? 'bg-navy text-white' : 'border border-line bg-surface text-ink-2 hover:bg-subtle')}>
            {text(l)} · {count(k)}
          </button>
        ))}
        <span className="flex-1" />
        <Segmented label="Show" value={when} onChange={setWhen} options={[['now', 'Now'], ['today', 'Today']]} />
        <Zooms places={places} box={box} onBox={setBox} />
      </div>
      <div className="grid min-h-0 items-start gap-3.5 [grid-template-columns:minmax(0,1fr)_340px]">
        <section aria-label={text('Where they are')} className="flex min-w-0 flex-col overflow-hidden rounded-[12px] border border-line bg-surface">
          <LiveMap
            places={places}
            box={box}
            onBox={setBox}
            selected={place?.key ?? null}
            onSelect={(p) => setPicked(p.key)}
            callout={when === 'now' ? callout(list.now, list.skew ?? 0, true) : undefined}
            caption={when === 'now' ? text('Shaded by visitors now · darker = more') : text('Shaded by visitors today · darker = more')}
            label={when === 'now' ? 'Map of visitors on the site now' : 'Map of visitors today'}
            className="h-[560px] border-b border-line"
          />
          <div className="px-3.5 py-[9px]">
            <MapLegend />
          </div>
        </section>
        <section aria-label={text('Selected place')} className="relative min-h-[420px] overflow-hidden rounded-[12px] border border-line bg-surface">
          {place ? <SelectedPlace place={place} visitors={visitors} today={today} when={when} list={list} onClose={() => setPicked(null)} /> : <p className="px-4 py-8 text-center text-ink-3">{text('Nobody to show here yet.')}</p>}
          {drawer ? <Drawer>{drawer}</Drawer> : null}
        </section>
      </div>
    </main>
  );
}

/** A place on the full map: who is there now, how many today, and how precise the location is. */
function SelectedPlace({ place, visitors, today, when, list, onClose }: { place: Place; visitors: OnlineVisitor[]; today: Place[]; when: When; list: ListProps; onClose: () => void }) {
  const todayHere = today.find((p) => p.key === place.key)?.count ?? 0;
  const inCountry = visitors.filter((v) => v.country === place.country);
  const exact = inCountry.filter((v) => typeof v.lat === 'number' && typeof v.lng === 'number').length;
  return (
    <div className="flex flex-col gap-3 py-3.5">
      <div className="px-3.5">
        <div className="flex items-start gap-2">
          <h2 className="min-w-0 flex-1 text-[16px] font-bold text-ink">{place.city ?? place.country}{place.approx ? ' ≈' : ''}</h2>
          <button type="button" onClick={onClose} aria-label={text('Show the busiest place')} className="flex h-7 w-7 items-center justify-center rounded-[7px] text-ink-3 hover:bg-subtle hover:text-ink">
            <Icon name="x" size={14} />
          </button>
        </div>
        <p className="text-[12px] text-ink-3">
          {[place.region, place.city ? place.country : null].filter(Boolean).join(', ')}
          {place.city ? ' · ' : ''}
          {when === 'now' ? text('{n} on the site now', { n: place.visitors.length }) : text('{n} today', { n: place.count })}
        </p>
        <div className="mt-2 flex flex-wrap gap-1.5 text-[11px]">
          <span className="rounded-full bg-subtle px-2 py-0.5 font-semibold text-ink-2">{place.approx ? text('Country only · browser timezone') : text('City · CDN or GeoIP')}</span>
          {when === 'now' && todayHere > 0 ? <span className="rounded-full bg-subtle px-2 py-0.5 text-ink-2">{text('Today: {n}', { n: todayHere })}</span> : null}
        </div>
      </div>
      {when === 'now' ? <OnSiteNow visitors={place.visitors} {...list} limit={12} hidePlace /> : null}
      {inCountry.length ? (
        <div className="mx-3.5 rounded-[10px] bg-subtle p-3 text-[12px] text-ink-2">
          <p className="mb-1 text-[10.5px] font-bold tracking-[0.8px] text-ink-3 uppercase">{text('How precise is this')}</p>
          {text('{exact} of {n} from {country} have a city (rounded to about 10 km).', { exact, n: inCountry.length, country: place.country })}
          {inCountry.length - exact > 0 ? ` ${text('{n} placed by browser timezone only, so shown on the country, not a city.', { n: inCountry.length - exact })}` : ''}
        </div>
      ) : null}
    </div>
  );
}

/* ---------------------------------------------------------------- Wall mode */

/**
 * For a screen on the wall: the figures large, the map, what just happened and the sites — filling the window, with
 * nobody named, since anybody walking past can read it. Esc (or its button) comes back.
 */
function WallMode({ d, visitors, now, skew, onClose }: { d: Dashboard; visitors: OnlineVisitor[]; now: number; skew: number; onClose: () => void }) {
  const places = useMemo(() => placesNow(visitors), [visitors]);
  const waited = d.now.waiting_on_us ? since(d.now.longest_wait_since, now, skew) : null;
  const inChat = visitors.filter((v) => v.chat).length;
  const calls = d.now.on_call?.count ?? 0;
  const sites = d.widgets.map((w) => w.name).join(', ');
  return (
    <div role="dialog" aria-modal="true" aria-label={text('Website chats — live, wall mode')} className="fixed inset-0 z-[120] flex flex-col gap-4 overflow-auto bg-ground p-6 text-ink">
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-[26px] font-bold">{text('Website chats — live')}</span>
        <span className="flex h-[22px] items-center gap-1.5 rounded-full bg-[#e9f6ee] px-[9px] text-[11.5px] font-bold text-[#1f6b40] dark:bg-success-bg dark:text-success">
          <span className="h-[7px] w-[7px] rounded-full bg-[#2f9e67]" aria-hidden />
          {text('Live')}
        </span>
        <span className="min-w-0 flex-1 truncate text-[13px] text-ink-3">{d.widgets.length > 1 ? text('All sites · {sites}', { sites }) : sites}</span>
        <span className="rounded-full bg-surface px-3 py-1 text-[12px] font-semibold text-ink-2">{text('Names hidden on this screen')}</span>
        <span className="font-mono text-[26px] tabular-nums">{new Date(now).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
        <button type="button" onClick={onClose} className="h-10 rounded-[8px] border border-line bg-surface px-3 text-[13px] font-semibold hover:bg-subtle">
          {text('Esc to exit')}
        </button>
      </div>
      <div className="grid grid-cols-6 gap-3" role="list" aria-label={text('Right now')}>
        <Tile big live label="On the site now" value={String(d.now.visitors_online)} sub={d.now.arrived_10m ? text('+{n} in 10 min', { n: d.now.arrived_10m }) : text('Live')} tone="plain" />
        <Tile big label="Waiting on us" value={String(d.now.waiting_on_us)} sub={waited !== null ? text('longest {time}', { time: clock(waited) }) : text('Nobody waiting')} tone={d.now.waiting_on_us ? 'amber' : 'plain'} />
        <Tile big label="At risk" value={String(d.now.at_risk)} sub={d.now.at_risk_after ? text('past {time}', { time: clock(d.now.at_risk_after) }) : text('nobody answered in time')} tone={d.now.at_risk ? 'red' : 'plain'} />
        <Tile big label="In a chat" value={String(inChat)} sub={calls ? text('{n} on a call', { n: calls }) : text('{n} staff', { n: d.now.staff_in_chats ?? 0 })} tone="plain" />
        <Tile big label="First reply" value={d.today.first_response_median === null ? '—' : clock(d.today.first_response_median)} sub={text('median today')} tone="plain" />
        <Tile big label="Missed today" value={String(d.today.missed)} sub={text('{n} in last hour', { n: d.today.missed_last_hour ?? 0 })} tone={d.today.missed ? 'red' : 'plain'} />
      </div>
      <div className="grid min-h-0 flex-1 gap-4 [grid-template-columns:minmax(0,1fr)_380px]">
        <div className="flex min-h-[360px] flex-col overflow-hidden rounded-[14px] border border-line bg-surface">
          <LiveMap places={places} box={WORLD_BOX} callout={callout(now, skew, false)} caption={text('Shaded by visitors now · darker = more')} label="Map of visitors on the site now" className="min-h-[320px] flex-1" />
          <div className="border-t border-line px-3.5 py-[9px]">
            <MapLegend />
          </div>
        </div>
        <div className="flex flex-col gap-4 rounded-[14px] border border-line bg-surface p-4">
          <p className="text-[11px] font-bold tracking-[0.8px] text-ink-3 uppercase">{text('Just now')}</p>
          <ul className="flex flex-col gap-2" aria-label={text('Just now')}>
            {justNow(d, visitors, now, skew).map((e, i) => (
              <li key={i} className="flex items-center gap-2 text-[13px]">
                <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: e.dot }} aria-hidden />
                <span className="min-w-0 flex-1 truncate">{e.text}</span>
                <span className="shrink-0 font-mono text-[11.5px] text-ink-3 tabular-nums">{e.at}</span>
              </li>
            ))}
          </ul>
          <div className="border-t border-line pt-3">
            <p className="mb-2 text-[11px] font-bold tracking-[0.8px] text-ink-3 uppercase">{text('Sites')}</p>
            <ul className="flex flex-col gap-1.5">
              {d.widgets.map((w) => (
                <li key={w.id} className="flex items-center gap-2 text-[13px]">
                  <span className={cx('h-2 w-2 rounded-full', w.open_now === false ? 'bg-ink-3' : 'bg-[#2f9e67]')} aria-hidden />
                  <span className="min-w-0 flex-1 truncate">{w.name}{w.open_now === false ? ` · ${text('closed')}` : ''}</span>
                  <span className="font-semibold tabular-nums">{w.online}</span>
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
 * What just happened, for the wall, with nobody named: waiting and at-risk visitors first, calls answered, then the
 * activity log — each said with its place.
 */
export function justNow(d: Pick<Dashboard, 'activity'>, visitors: OnlineVisitor[], now: number, skew = 0): Array<{ text: string; at: string; dot: string; t: number }> {
  const out: Array<{ text: string; at: string; dot: string; t: number }> = [];
  const place = (city: string | null | undefined, country: string | null | undefined, exact = true) => city ?? (country ? `${country}${exact ? '' : ' ≈'}` : text('somewhere'));
  for (const v of visitors) {
    const where = place(v.city, v.country, typeof v.lat === 'number');
    if (v.chat?.awaiting && v.chat.waiting_since) {
      const t = parseTs(v.chat.waiting_since).getTime();
      out.push(
        v.chat.at_risk
          ? { text: text('A visitor in {where} has waited {time} — at risk', { where, time: clock(since(v.chat.waiting_since, now, skew) ?? 0) }), at: timeLabel(v.chat.waiting_since), dot: '#c2392d', t: Number.MAX_SAFE_INTEGER }
          : { text: text('A visitor in {where} is waiting for a reply', { where }), at: timeLabel(v.chat.waiting_since), dot: '#d9922e', t: t + 1 },
      );
    }
    if (v.chat?.call?.since && v.chat.call.status !== 'ringing') {
      out.push({ text: text('Voice call answered · {where}', { where }), at: timeLabel(v.chat.call.since), dot: '#2f9e67', t: parseTs(v.chat.call.since).getTime() });
    }
  }
  const words: Record<string, (r: NonNullable<Dashboard['activity']>[number]) => string | null> = {
    chat_started: () => text('Chat started'),
    page_view: (r) => text('Opened {path}', { path: pathOf(r.url) }),
    identified: () => text('A visitor shared their details'),
    rated: () => text('A chat was rated'),
    offline_form: () => text('A message was left'),
  };
  for (const r of d.activity ?? []) {
    const say = words[r.kind]?.(r);
    if (!say) continue;
    out.push({ text: `${say} · ${place(r.city, r.country)}`, at: timeLabel(r.at), dot: r.kind === 'chat_started' ? '#273498' : '#7c8fe8', t: parseTs(r.at).getTime() });
  }
  return out.sort((a, b) => b.t - a.t).slice(0, 8);
}
