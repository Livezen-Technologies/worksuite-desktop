import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useMemo } from 'react';
import { useLocalFirstQuery } from '../../../../core/local-first-query';
import { parseTs } from '../../../../core/time';
import { WEBSITE } from '../api';
import type { Dashboard, OnlineVisitor } from './liveMap';

/*
 * What the Live dashboard is drawn from (worksuite-desktop#248), shared by the dashboard, Visitors online, the sidebar's
 * count, the Live map window and the tray's mini-dashboard, so each of them shows the same figures and reuses the
 * others' answers.
 *
 * THREE ANSWERS, ASKED AT ONCE. `GET /dashboard/summary` is the first view in one cheap answer — the cards, the fifty
 * who need us most, the sites; `GET /visitors` is everybody on the sites (the visitor list, the sidebar's count); and
 * `GET /dashboard` adds what only the map and the wall need (today's places, the activity feed). Each fills its part of
 * the screen as it lands; none waits for another.
 *
 * LOCAL FIRST. Each is read from this computer's saved copy while it is asked for (useLocalFirstQuery, #239), so the
 * dashboard opens with the last figures it showed, marked with how old they are, and is kept in memory for half an
 * hour so going back to it is instant.
 */

/** GET /dashboard/summary (WidgetAdminController::dashboardSummary). */
export interface LiveSummary {
  now: Dashboard['now'];
  today: { missed: number; missed_last_hour?: number; first_response_median: number | null };
  /** The fifty who need us most, worst first. */
  visitors: OnlineVisitor[];
  /** How many there are on the sites asked for, all of them. */
  visitors_total: number;
  /** Where those on the sites now came from: a referrer's host, a campaign's source, or Direct. */
  sources?: Array<{ name: string; count: number }>;
  widgets: Dashboard['widgets'];
  window_seconds?: number;
  server_time?: string;
}

/** Half an hour: switching away and back, the dashboard is where it was. */
export const LIVE_GC_MS = 30 * 60_000;
/** The cards and the list, as before: every ten seconds, so the two never disagree. */
export const LIVE_POLL_MS = 10_000;

export const sitesKey = (sites: number[]): number | string => (sites.length === 0 ? 0 : sites.length === 1 ? sites[0]! : sites.join(','));
export const siteParams = (sites: number[]): Record<string, string> | undefined =>
  sites.length === 1 ? { widget_id: String(sites[0]) } : sites.length ? { widget_ids: sites.join(',') } : undefined;

const isObject = (hit: unknown): hit is Record<string, unknown> => !!hit && typeof hit === 'object';
const isSummary = (hit: unknown) => isObject(hit) && isObject(hit.now) && Array.isArray(hit.visitors) && Array.isArray(hit.widgets);
const isDashboard = (hit: unknown) => isObject(hit) && isObject(hit.now) && Array.isArray(hit.widgets);
const isVisitors = (hit: unknown) => isObject(hit) && Array.isArray(hit.visitors);

/** Everybody on the sites now (GET /visitors): the visitor list, the sidebar's count, the dashboard's rows and map. */
export function useLiveVisitors(interval = LIVE_POLL_MS, enabled = true) {
  return useLocalFirstQuery<{ visitors: OnlineVisitor[] }>({ queryKey: ['website', 'visitors'], path: `${WEBSITE}/visitors`, interval, gcTime: LIVE_GC_MS, accept: isVisitors, enabled });
}

const EMPTY_TODAY: Dashboard['today'] = { visitors: 0, returning: 0, conversations: 0, missed: 0, page_views: 0, first_response_median: null };
const EMPTY_SUMMARY: Dashboard['summary'] = { pages: [], countries: [], devices: [], referrers: [] };

/**
 * One Dashboard from the two answers: the newer one's figures, the summary's sites, and the full answer's map and feed
 * once it is in. Undefined while there is neither.
 */
export function mergeLive(s: LiveSummary | undefined, sAt: number, f: Dashboard | undefined, fAt: number): Dashboard | undefined {
  if (!s) return f;
  const base: Dashboard = f ?? { now: s.now, today: EMPTY_TODAY, activity: [], summary: EMPTY_SUMMARY, widgets: s.widgets, server_time: s.server_time };
  if (f && fAt > sAt) return { ...f, widgets: f.widgets.length ? f.widgets : s.widgets };
  return { ...base, now: { ...base.now, ...s.now }, today: { ...base.today, ...s.today }, widgets: s.widgets, server_time: s.server_time ?? base.server_time };
}

/** How long ago, in words: "40 s", "2 min", "3 h", "2 d". */
export function agoWords(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return `${s} s`;
  if (s < 3600) return `${Math.floor(s / 60)} min`;
  if (s < 86_400) return `${Math.floor(s / 3600)} h`;
  return `${Math.floor(s / 86_400)} d`;
}

export interface LiveData {
  /** The figures, the sites, and — once the full answer is in — today's places and the feed. */
  d: Dashboard | undefined;
  /** Whether the full answer is in: the map's Today and the wall's Just now. */
  full: boolean;
  /** Everybody on the chosen sites; the summary's fifty until the whole list lands. */
  visitors: OnlineVisitor[];
  /** How many are on the chosen sites, as the sidebar counts them; null until known. */
  total: number | null;
  /** Whether there is anybody to show yet (the list, the summary, or a saved copy of either). */
  hasVisitors: boolean;
  /** When the figures were last answered, live; 0 while only a saved copy is shown. */
  updatedAt: number;
  /** When the saved copy shown was taken (ms), while no live answer is in; else null. */
  snapshotAt: number | null;
  /** How far the server's clock is ahead of this one. */
  skew: number;
  /** Nothing at all yet: no figures, nobody, no saved copy, and no failure. */
  pending: boolean;
  /** The cards could not be read and there is nothing to show. */
  cardsFailed: boolean;
  /** The list could not be read and there is nobody to show. */
  listFailed: boolean;
  /** The map's answer could not be read and there is nothing to draw. */
  mapFailed: boolean;
  retryCards: () => void;
  retryList: () => void;
  retryMap: () => void;
  retryAll: () => void;
}

/**
 * The Live dashboard's data for the chosen sites. `full` asks for the map's and the wall's extra answer too (the
 * dashboard; not the visitor list, the Live map window or the tray), every `fullInterval` ms.
 */
export function useLiveData(sites: number[], { full: wantFull = true, fullInterval = 30_000, enabled = true }: { full?: boolean; fullInterval?: number; enabled?: boolean } = {}): LiveData {
  const key = sitesKey(sites);
  const params = siteParams(sites);
  const summary = useLocalFirstQuery<LiveSummary>({
    queryKey: ['website', 'live-summary', key], path: `${WEBSITE}/dashboard/summary`, params, interval: LIVE_POLL_MS, gcTime: LIVE_GC_MS, accept: isSummary, keepPrevious: true, enabled,
  });
  // Where the summary cannot be had (a server before #248 answers 404), the full answer stands in for it.
  const fallback = !wantFull && (summary.isError || summary.failureCount > 0) && summary.data === undefined;
  const fullQ = useLocalFirstQuery<Dashboard>({
    queryKey: ['website', 'dashboard', key], path: `${WEBSITE}/dashboard`, params, interval: fullInterval, gcTime: LIVE_GC_MS, accept: isDashboard, keepPrevious: true, enabled: enabled && (wantFull || fallback),
  });
  const asked = wantFull || fallback;
  const list = useLiveVisitors(LIVE_POLL_MS, enabled);

  const sAt = summary.isPlaceholderData ? 0 : summary.dataUpdatedAt;
  const fAt = fullQ.isPlaceholderData ? 0 : fullQ.dataUpdatedAt;
  const d = useMemo(() => mergeLive(summary.data, sAt, fullQ.data, fAt), [summary.data, sAt, fullQ.data, fAt]);

  const sitesJson = JSON.stringify(sites);
  const visitors = useMemo(() => {
    const chosen = JSON.parse(sitesJson) as number[];
    const inSites = (v: OnlineVisitor) => !chosen.length || chosen.includes(v.widget_id);
    return (list.data?.visitors ?? summary.data?.visitors ?? []).filter(inSites);
  }, [list.data, summary.data, sitesJson]);
  const listed = list.data !== undefined;
  const hasVisitors = listed || summary.data !== undefined;
  const total = listed ? visitors.length : summary.data && !summary.isPlaceholderData ? (summary.data.visitors_total ?? summary.data.now.visitors_online) : d && fAt ? d.now.visitors_online : null;

  const updatedAt = Math.max(sAt, fAt);
  const live = sAt >= fAt ? summary.data : fullQ.data;
  const stamp = d?.server_time ? parseTs(d.server_time).getTime() : NaN;
  const snapshotAt = !updatedAt && d && Number.isFinite(stamp) ? stamp : null;
  const skew = updatedAt && live?.server_time ? parseTs(live.server_time).getTime() - updatedAt : 0;

  const fullFailed = asked ? fullQ.isError && !fullQ.data : true;
  const cardsFailed = !d && summary.isError && fullFailed;
  const listFailed = !hasVisitors && list.isError && (summary.isError || !summary.isFetching);
  // The map's card is drawn from the figures' answer: it fails with them.
  const mapFailed = cardsFailed;

  // Retry asks again now, giving up on a request still hanging rather than joining it.
  const qc = useQueryClient();
  const { refetch: rs } = summary;
  const { refetch: rf } = fullQ;
  const { refetch: rl } = list;
  const again = useCallback(
    (which: { summary?: boolean; full?: boolean; list?: boolean }) => {
      const asks: Array<[unknown[], () => Promise<unknown>]> = [];
      if (which.summary) asks.push([['website', 'live-summary', key], rs]);
      if (which.full && asked) asks.push([['website', 'dashboard', key], rf]);
      if (which.list) asks.push([['website', 'visitors'], rl]);
      for (const [queryKey, refetch] of asks) void qc.cancelQueries({ queryKey }).then(() => refetch());
    },
    [qc, key, asked, rs, rf, rl],
  );
  const retryCards = useCallback(() => again({ summary: true, full: true }), [again]);
  const retryList = useCallback(() => again({ list: true, summary: true }), [again]);
  const retryMap = retryCards;
  const retryAll = useCallback(() => again({ summary: true, full: true, list: true }), [again]);

  return {
    d,
    full: fullQ.data !== undefined,
    visitors,
    total,
    hasVisitors,
    updatedAt,
    snapshotAt,
    skew,
    pending: !d && !hasVisitors && !cardsFailed && !listFailed,
    cardsFailed,
    listFailed,
    mapFailed,
    retryCards,
    retryList,
    retryMap,
    retryAll,
  };
}
