import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Select } from '../../../components/Select';
import { Icon } from '../../../components/Icon';
import { Button, cx, Empty, Spinner } from '../../../components/ui';
import { ApiError, apiGet } from '../../../core/api';
import { call, errorMessage } from '../../../core/bridge';
import { text } from '../../../core/i18n';
import { toast } from '../../../core/toasts';
import { WEBSITE } from './api';
import { Segmented, Tile, type SubTone, type Tone } from './live/LiveDashboard';
import { clock } from './live/liveMap';

/**
 * Insights (worksuite-desktop L-07; WS-WCHAT X-UI-13, UX-INS-01…03, closing RPT-04): how website chat is doing across
 * all the widgets or one, over 7 days, 30 days or all time — six figures with their change against the period before,
 * conversations per day (answered and missed), traffic sources and devices, and the agent table with missed while
 * online — and Export CSV. From `GET widget-admin/insights` (WidgetInsights says what each figure counts).
 *
 * worksuite-desktop#247: a server older than Communication 1.41 has no such route and answers 404 ("Not found"), which
 * is said as "needs a newer server"; a 403 as no access; any other failure with its cause and the request's id. A
 * period without chats says so above empty charts. Each site, the pages chats start on and the busiest hours come from
 * a newer server still, and are drawn only when it sends them.
 */

export type InsightsPeriod = '7d' | '30d' | 'all';

export interface Insights {
  period: InsightsPeriod;
  since: string | null;
  until: string;
  widget_id: number | null;
  widgets: Array<{ id: number; name: string }>;
  conversations: { value: number; previous: number | null };
  first_response: { value: number | null; previous: number | null };
  resolution: { value: number | null; previous: number | null };
  rating: { value: number | null; rated: number; previous: number | null };
  missed: { value: number; share: number | null; previous: number | null };
  visitors: { value: number; returning: number; returning_share: number | null };
  days: Array<{ date: string; answered: number; missed: number }>;
  sources: Array<{ name: string; count: number; share: number }>;
  devices: Array<{ name: string; count: number; share: number }>;
  agents: Array<{ id: number; name: string; handled: number; first_response_seconds: number | null; rating: number | null; missed_while_online: number }>;
  join_median_seconds: number | null;
  team?: { installed: boolean; multi_staff_chats?: number; agents?: Array<{ transfers_in: number; transfers_out: number }> };
  calls?: { installed: boolean; requested?: number; answered?: number };
  /** Each site's chats, missed, median first reply and rating (#247); absent from an older server. */
  by_widget?: Array<{ id: number; name: string; conversations: number; missed: number; first_response_seconds: number | null; rating: number | null }>;
  /** The pages chats start on, most first (#247). */
  start_pages?: Array<{ page: string; count: number; share: number }>;
  /** Chats started per weekday (Monday first) and hour, on `timezone`'s clock (#247). */
  hours?: number[][];
  timezone?: string;
  /**
   * Message delivery per day (WS-WCHAT OPS-04, from ChatMetrics) for the whole installation, not per widget; all time
   * is the last 90 days. Absent from an older server, and `installed` false before its migration.
   */
  delivery?: InsightsDelivery;
}

export const DELIVERY_METRICS = ['sent', 'retried', 'deduplicated', 'resynced', 'emailed', 'not_reaching_staff'] as const;
export type DeliveryMetric = (typeof DELIVERY_METRICS)[number];
export type DeliveryDay = { date: string } & Record<DeliveryMetric, number>;

export interface InsightsDelivery {
  installed: boolean;
  from: string;
  to: string;
  totals: Record<DeliveryMetric, number>;
  days: DeliveryDay[];
}

const PERIODS = [
  ['7d', '7 days'],
  ['30d', '30 days'],
  ['all', 'All time'],
] as const;

const count = (n: number) => n.toLocaleString('en-US');

/** "11 min", "45 s", "1 h 20 min": a resolution time. */
export function minutes(seconds: number): string {
  if (seconds < 60) return text('{n} s', { n: seconds });
  const m = Math.round(seconds / 60);
  if (m < 60) return text('{n} min', { n: m });
  return m % 60 ? text('{h} h {m} min', { h: Math.floor(m / 60), m: m % 60 }) : text('{h} h', { h: Math.floor(m / 60) });
}

const MINUS = '−';

/** "+18% vs previous": the change in conversations; green when there were more. Nothing for all time. */
export function conversationsChange(value: number, previous: number | null): { sub?: string; tone: SubTone } {
  if (previous === null || previous === 0) return { tone: 'plain' };
  const pct = Math.round(((value - previous) * 100) / previous);
  if (pct === 0) return { sub: text('same'), tone: 'plain' };
  return { sub: text('{change} vs previous', { change: `${pct > 0 ? '+' : MINUS}${Math.abs(pct)}%` }), tone: pct > 0 ? 'good' : 'plain' };
}

/**
 * "−12 s" or "same": the change in a time against the period before, in seconds under a minute and minutes above;
 * quicker is green, slower red. Nothing when either is unknown.
 */
export function timeChange(value: number | null, previous: number | null, unit: 's' | 'min'): { sub?: string; tone: SubTone } {
  if (value === null || previous === null) return { tone: 'plain' };
  const d = value - previous;
  const n = unit === 's' && Math.abs(d) < 60 ? Math.abs(d) : Math.round(Math.abs(d) / 60);
  if (n === 0) return { sub: text('same'), tone: 'plain' };
  const amount = unit === 's' && Math.abs(d) < 60 ? text('{n} s', { n }) : text('{n} min', { n });
  return { sub: `${d < 0 ? MINUS : '+'}${amount}`, tone: d < 0 ? 'good' : 'bad' };
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "20 Sep", as the design writes it (a locale may say "Sept"). */
export const dayLabel = (iso: string) => `${Number(iso.slice(8, 10))} ${text(MONTHS[Number(iso.slice(5, 7)) - 1] ?? '')}`;

/** The report for a period and a widget (or all), one query shared by Insights and the widgets list's week (S-01). */
export const insightsQuery = (period: InsightsPeriod, widget: number | null) => ({
  queryKey: ['website', 'insights', period, widget ?? 0],
  queryFn: ({ signal }: { signal?: AbortSignal }) => apiGet<Insights>(`${WEBSITE}/insights`, { period, ...(widget ? { widget_id: widget } : {}) }, signal),
});

/** Why Insights could not be shown (#247): the server is too old, the person may not see it, or something failed. */
export type InsightsFailure =
  | { kind: 'old' }
  | { kind: 'denied' }
  | { kind: 'error'; cause: string; status: number; message: string; requestId: string | null };

/**
 * A 404 here is the route missing — the report itself answers a period without chats with zeros — so it means a server
 * from before Communication 1.41, as Voice calls and Call history read theirs.
 */
export function insightsFailure(e: unknown): InsightsFailure {
  if (e instanceof ApiError && e.status === 404) return { kind: 'old' };
  if (e instanceof ApiError && e.status === 403) return { kind: 'denied' };
  const status = e instanceof ApiError ? e.status : 0;
  const cause =
    e instanceof ApiError && e.offline ? text('no connection') : status >= 500 ? text('server error') : status === 401 ? text('signed out') : status ? text('error {n}', { n: status }) : text('request failed');
  return { kind: 'error', cause, status, message: e instanceof Error ? e.message : String(e), requestId: e instanceof ApiError ? e.requestId : null };
}

/** What "Copy details" puts on the clipboard: enough for whoever looks at the server's log. */
export function failureDetails(f: Extract<InsightsFailure, { kind: 'error' }>, period: InsightsPeriod, widget: number | null): string {
  const query = new URLSearchParams({ period, ...(widget ? { widget_id: String(widget) } : {}) }).toString();
  return [
    `Couldn't load Insights (${f.cause})`,
    `Request: GET ${WEBSITE}/insights?${query}`,
    `Status: ${f.status || 'no answer'}`,
    `Message: ${f.message}`,
    `Request ID: ${f.requestId ?? 'none sent by the server'}`,
    `Time: ${new Date().toISOString()}`,
  ].join('\n');
}

export function WebsiteInsights({ period, widget, onChange }: { period: InsightsPeriod; widget: number | null; onChange: (p: { period: InsightsPeriod; widget: number | null }) => void }) {
  const q = useQuery({ ...insightsQuery(period, widget), placeholderData: keepPreviousData });
  const d = q.data;
  const failure = q.error && !d ? insightsFailure(q.error) : null;

  const exportCsv = () =>
    void call('transfers:download', {
      websiteInsights: { period, ...(widget ? { widget } : {}) },
      name: `website-chat-insights-${period}${widget ? `-widget-${widget}` : ''}-${new Date().toISOString().slice(0, 10)}.csv`,
      open: false,
    }).then(
      () => toast('success', text('Exporting — see Transfers.')),
      (e) => toast('error', errorMessage(e)),
    );

  return (
    <main aria-label={text('Insights')} className="flex h-full min-w-0 flex-1 flex-col gap-3 overflow-y-auto border-l border-line bg-ground px-[22px] py-4 text-[13px] text-ink scroll-thin">
      <div className="flex flex-wrap items-center gap-2.5">
        <div className="min-w-0 flex-1">
          <h1 className="text-[21px] font-bold">{text('Insights')}</h1>
          <p className="text-[12.5px] text-ink-3">{text('How website chat is doing across all your widgets.')}</p>
        </div>
        <Segmented label="Period" value={period} onChange={(p) => onChange({ period: p, widget })} options={PERIODS} />
        <Select<string>
          aria-label={text('Widget')}
          value={widget ? String(widget) : ''}
          onValueChange={(v) => onChange({ period, widget: Number(v) || null })}
          options={[{ value: '', label: text('All widgets') }, ...(d?.widgets ?? []).map((w) => ({ value: String(w.id), label: w.name }))]}
          className="h-8 rounded-[8px] border border-line bg-surface px-3 text-[12.5px] text-ink"
        />
        {/* Nothing to export from a server without the report, or for somebody who may not see it (#247). */}
        <Button variant="secondary" onClick={exportCsv} disabled={failure?.kind === 'old' || failure?.kind === 'denied'} className="text-[12.5px]">
          {text('Export CSV')}
        </Button>
      </div>
      {failure ? <Failure f={failure} period={period} widget={widget} onRetry={() => void q.refetch()} retrying={q.isFetching} /> : null}
      {!d && !q.error ? <Spinner /> : null}
      {d ? <Report d={d} all={!widget} /> : null}
    </main>
  );
}

function Failure({ f, period, widget, onRetry, retrying }: { f: InsightsFailure; period: InsightsPeriod; widget: number | null; onRetry: () => void; retrying: boolean }) {
  if (f.kind === 'old') {
    return (
      <Empty
        icon="chart"
        title={text('Insights needs a newer WorkSuite server (Communication 1.41 or later).')}
        hint={text('Ask your administrator to update.')}
        action={
          // The web's Website chats › Insights › Reports is there on an older server too: the all-time figures.
          <Button variant="secondary" icon="external" onClick={() => void call('app:openInBrowser', { path: '/website-chats' }).catch((e) => toast('error', errorMessage(e)))}>
            {text('Open Reports on the web')}
          </Button>
        }
      />
    );
  }
  if (f.kind === 'denied') return <Empty icon="lock" title={text("You don't have access to Website chat reports")} hint={text('Ask an admin.')} />;
  const copy = () =>
    void navigator.clipboard.writeText(failureDetails(f, period, widget)).then(
      () => toast('success', text('Details copied.')),
      () => toast('error', text("Couldn't copy the details.")),
    );
  return (
    <div role="alert" className="flex items-start gap-2 rounded-[8px] bg-danger-bg px-3 py-2 text-[12.5px] text-danger">
      <Icon name="alert" size={15} className="mt-px shrink-0" />
      <div className="min-w-0 flex-1">
        <b className="font-semibold">{text("Couldn't load Insights ({cause})", { cause: f.cause })}</b>
        <div className="break-words opacity-90">{f.message}</div>
        {f.requestId ? <div className="font-mono text-[11.5px] opacity-90">{text('Request ID: {id}', { id: f.requestId })}</div> : null}
      </div>
      <button type="button" className="font-semibold underline disabled:opacity-60" onClick={onRetry} disabled={retrying}>
        {text('Retry')}
      </button>
      <button type="button" className="font-semibold underline" onClick={copy}>
        {text('Copy details')}
      </button>
    </div>
  );
}

function Report({ d, all }: { d: Insights; all: boolean }) {
  const conv = conversationsChange(d.conversations.value, d.conversations.previous);
  const first = timeChange(d.first_response.value, d.first_response.previous, 's');
  const res = timeChange(d.resolution.value, d.resolution.previous, 'min');
  const tiles: Array<{ label: string; value: string; sub?: string; tone: Tone; subTone: SubTone }> = [
    { label: 'Conversations', value: count(d.conversations.value), sub: conv.sub, tone: 'plain', subTone: conv.tone },
    { label: 'Avg first response', value: d.first_response.value === null ? '—' : clock(d.first_response.value), sub: first.sub, tone: 'plain', subTone: first.tone },
    { label: 'Avg resolution', value: d.resolution.value === null ? '—' : minutes(d.resolution.value), sub: res.sub, tone: 'plain', subTone: res.tone },
    { label: 'Avg rating', value: d.rating.value === null ? '—' : d.rating.value.toFixed(1), sub: text('from {n} rated', { n: count(d.rating.rated) }), tone: 'plain', subTone: 'plain' },
    {
      label: 'Missed',
      value: count(d.missed.value),
      sub: d.missed.share === null ? undefined : text('{pct}% of chats', { pct: d.missed.share }),
      tone: d.missed.value ? 'red' : 'plain',
      subTone: d.missed.value ? 'bad' : 'plain',
    },
    { label: 'Visitors', value: count(d.visitors.value), sub: d.visitors.returning_share === null ? undefined : text('{pct}% returning', { pct: d.visitors.returning_share }), tone: 'plain', subTone: 'plain' },
  ];
  return (
    <>
      {/* A period without chats is no error (#247): it says so, and the charts below stay, empty. */}
      {d.conversations.value === 0 ? (
        <div role="status" className="flex items-center gap-2 rounded-[10px] border border-line bg-surface px-4 py-3 text-[12.5px] text-ink-2">
          <Icon name="chart" size={16} className="text-ink-3" />
          <b className="text-ink">{text('No chats in this period')}</b>
          <span className="text-ink-3">{text('Try a longer period or another widget.')}</span>
        </div>
      ) : null}
      <div className="grid grid-cols-6 gap-2.5" role="list" aria-label={text('Figures')}>
        {tiles.map((t) => (
          <Tile key={t.label} stack {...t} />
        ))}
      </div>
      <div className="grid gap-3 [grid-template-columns:minmax(0,2fr)_minmax(0,1fr)]">
        <PerDay days={d.days} />
        <section aria-label={text('Traffic sources')} className="flex flex-col gap-[9px] rounded-[12px] border border-line bg-surface px-4 py-3.5 text-[12.5px]">
          <h2 className="text-[14px] font-bold">{text('Traffic sources')}</h2>
          <Sources sources={d.sources} />
          <h2 className="mt-1.5 text-[14px] font-bold">{text('Devices')}</h2>
          <Devices devices={d.devices} />
        </section>
      </div>
      <Agents agents={d.agents} />
      {all && d.by_widget ? <ByWidget rows={d.by_widget} /> : null}
      {d.hours || d.start_pages ? (
        <div className="grid gap-3 [grid-template-columns:minmax(0,2fr)_minmax(0,1fr)]">
          {d.hours ? <Hours hours={d.hours} zone={d.timezone ?? null} /> : <span />}
          {d.start_pages ? <StartPages pages={d.start_pages} /> : null}
        </div>
      ) : null}
      {d.delivery?.installed ? <Delivery delivery={d.delivery} all={all} /> : null}
      <Also d={d} />
    </>
  );
}

/** Conversations per day, answered and missed stacked (UX-INS-03); each bar says its day and both counts on hover. */
function PerDay({ days }: { days: Insights['days'] }) {
  const top = Math.max(1, ...days.map((x) => x.answered + x.missed));
  const marks = days.length ? [days[0]!, days[Math.floor((days.length - 1) / 2)]!, days[days.length - 1]!] : [];
  return (
    <section aria-label={text('Conversations per day')} className="flex min-w-0 flex-col gap-2.5 rounded-[12px] border border-line bg-surface px-4 py-3.5">
      <div className="flex items-center">
        <h2 className="flex-1 text-[14px] font-bold">{text('Conversations per day')}</h2>
        <span className="flex gap-3 text-[11.5px] text-ink-2" role="list" aria-label={text('Legend')}>
          <span role="listitem">
            <span className="inline-block h-2.5 w-2.5 rounded-[2px] bg-[#273498] align-[-1px] dark:bg-[#7c8fe8]" aria-hidden /> {text('Answered')}
          </span>
          <span role="listitem">
            <span className="inline-block h-2.5 w-2.5 rounded-[2px] bg-[#e8a33d] align-[-1px]" aria-hidden /> {text('Missed')}
          </span>
        </span>
      </div>
      <ol className={cx('flex h-[190px] items-end border-b border-line pb-0.5', days.length > 45 ? 'gap-px' : 'gap-1.5')} aria-label={text('Conversations per day')}>
        {days.map((x) => {
          const said = text('{day}: {answered} answered, {missed} missed', { day: dayLabel(x.date), answered: x.answered, missed: x.missed });
          return (
            <li key={x.date} title={said} aria-label={said} className="flex h-full min-w-0 flex-1 flex-col justify-end gap-[2px] hover:opacity-80">
              {x.missed ? <span className="block rounded-t-[2px] bg-[#e8a33d]" style={{ height: `${(x.missed / top) * 100}%` }} /> : null}
              {x.answered ? <span className={cx('block bg-[#273498] dark:bg-[#7c8fe8]', !x.missed && 'rounded-t-[2px]')} style={{ height: `${(x.answered / top) * 100}%` }} /> : null}
            </li>
          );
        })}
      </ol>
      <div className="flex justify-between text-[11px] text-ink-3">
        {marks.map((m, i) => (
          <span key={i}>{dayLabel(m.date)}</span>
        ))}
      </div>
    </section>
  );
}

/** google.com, Direct, facebook.com and Other: each with its share, the bar as long as the share against the largest. */
function Sources({ sources }: { sources: Insights['sources'] }) {
  if (!sources.length) return <p className="text-ink-3">{text('No visitors in this period.')}</p>;
  const top = Math.max(1, ...sources.map((s) => s.share));
  return (
    <ul className="flex flex-col gap-[9px]" aria-label={text('Traffic sources')}>
      {sources.map((s) => (
        <li key={s.name} className="flex items-center gap-2">
          <span className="w-[92px] truncate">{s.name}</span>
          <span className="h-1.5 flex-1 rounded-[3px] bg-subtle" aria-hidden>
            <span className="block h-1.5 rounded-[3px] bg-[#4a63e8]" style={{ width: `${(s.share / top) * 100}%` }} />
          </span>
          <b className="w-[34px] text-right tabular-nums">{s.share}%</b>
        </li>
      ))}
    </ul>
  );
}

const DEVICE: Record<string, { label: string; colour: string }> = {
  desktop: { label: 'Desktop', colour: '#273498' },
  mobile: { label: 'Mobile', colour: '#7c8fe8' },
  tablet: { label: 'Tablet', colour: '#c3ccf6' },
};

/** Desktop, mobile and tablet as one split bar, with their shares in words under it. */
function Devices({ devices }: { devices: Insights['devices'] }) {
  return (
    <>
      <div className="flex h-2.5 gap-[2px] overflow-hidden rounded-[5px]" aria-hidden>
        {devices.filter((x) => x.share > 0).map((x) => (
          <span key={x.name} style={{ width: `${x.share}%`, background: DEVICE[x.name]?.colour }} />
        ))}
      </div>
      <ul className="flex gap-3 text-[11.5px] text-ink-2" aria-label={text('Devices')}>
        {devices.map((x) => (
          <li key={x.name}>{`${text(DEVICE[x.name]?.label ?? x.name)} ${x.share}%`}</li>
        ))}
      </ul>
    </>
  );
}

const COLS = 'grid [grid-template-columns:2fr_1fr_1fr_1fr_1fr] px-4 py-2.5';

/** Each person who had chats, busiest first: handled, first response, rating, missed while online (UX-INS-03). */
function Agents({ agents }: { agents: Insights['agents'] }) {
  return (
    <div role="table" aria-label={text('Agents')} className="overflow-hidden rounded-[12px] border border-line bg-surface">
      <div role="row" className={cx(COLS, 'border-b border-line bg-subtle/60 text-[10.5px] font-bold tracking-[0.9px] text-ink-3 uppercase')}>
        {['Agent', 'Handled', 'First response', 'Rating', 'Missed while online'].map((h) => (
          <span key={h} role="columnheader">
            {text(h)}
          </span>
        ))}
      </div>
      {agents.length ? (
        agents.map((a, i) => (
          <div key={a.id} role="row" className={cx(COLS, 'text-[13px] tabular-nums', i < agents.length - 1 && 'border-b border-line/60')}>
            <b role="cell" className="truncate">{a.name}</b>
            <span role="cell">{count(a.handled)}</span>
            <span role="cell">{a.first_response_seconds === null ? '—' : clock(a.first_response_seconds)}</span>
            <span role="cell">{a.rating === null ? '—' : a.rating.toFixed(1)}</span>
            <span role="cell">{count(a.missed_while_online)}</span>
          </div>
        ))
      ) : (
        <p className="px-4 py-3 text-ink-3">{text('No chats in this period.')}</p>
      )}
    </div>
  );
}

/** Each site, busiest first: chats, missed, the median first reply and the rating (#247). Only for All widgets. */
function ByWidget({ rows }: { rows: NonNullable<Insights['by_widget']> }) {
  return (
    <div role="table" aria-label={text('By widget')} className="overflow-hidden rounded-[12px] border border-line bg-surface">
      <div role="row" className={cx(COLS, 'border-b border-line bg-subtle/60 text-[10.5px] font-bold tracking-[0.9px] text-ink-3 uppercase')}>
        {['Widget', 'Chats', 'Missed', 'First reply', 'Rating'].map((h) => (
          <span key={h} role="columnheader">
            {text(h)}
          </span>
        ))}
      </div>
      {rows.length ? (
        rows.map((w, i) => (
          <div key={w.id} role="row" className={cx(COLS, 'text-[13px] tabular-nums', i < rows.length - 1 && 'border-b border-line/60')}>
            <b role="cell" className="truncate">{w.name}</b>
            <span role="cell">{count(w.conversations)}</span>
            <span role="cell">{count(w.missed)}</span>
            <span role="cell">{w.first_response_seconds === null ? '—' : clock(w.first_response_seconds)}</span>
            <span role="cell">{w.rating === null ? '—' : w.rating.toFixed(1)}</span>
          </div>
        ))
      ) : (
        <p className="px-4 py-3 text-ink-3">{text('No widget had chats in this period.')}</p>
      )}
    </div>
  );
}

const DELIVERY_COLS = 'grid [grid-template-columns:1.4fr_repeat(6,minmax(0,1fr))] px-4 py-2.5';
const DELIVERY_HEADS: Record<DeliveryMetric, string> = {
  sent: 'Sent',
  retried: 'Retried',
  deduplicated: 'Deduplicated',
  resynced: 'Re-synced',
  emailed: 'Emailed',
  not_reaching_staff: 'Not reaching staff',
};

/**
 * Message delivery per day (OPS-04): sent, retried, deduplicated, re-synced, emailed and not reaching staff, the
 * period's totals first and then each day that had any, newest first. Counted for the whole installation, so a single
 * widget's report says so.
 */
function Delivery({ delivery, all }: { delivery: InsightsDelivery; all: boolean }) {
  const days = delivery.days.filter((x) => DELIVERY_METRICS.some((m) => Number(x[m]) > 0)).reverse();
  const cell = (n: number | undefined, m: DeliveryMetric) => (
    <span key={m} role="cell" className={cx(m === 'not_reaching_staff' && n ? 'font-semibold text-danger' : undefined)}>
      {count(Number(n ?? 0))}
    </span>
  );
  return (
    <section aria-label={text('Delivery')} className="flex min-w-0 flex-col overflow-hidden rounded-[12px] border border-line bg-surface">
      <div className="flex items-baseline gap-2 px-4 pt-3.5 pb-2.5">
        <h2 className="flex-1 text-[14px] font-bold">{text('Delivery')}</h2>
        <span className="text-[11.5px] text-ink-3">
          {all ? text('{from} – {to}', { from: dayLabel(delivery.from), to: dayLabel(delivery.to) }) : text('All widgets, {from} – {to}', { from: dayLabel(delivery.from), to: dayLabel(delivery.to) })}
        </span>
      </div>
      <div role="table" aria-label={text('Delivery per day')} className="max-h-[320px] overflow-y-auto border-t border-line scroll-thin">
        <div role="row" className={cx(DELIVERY_COLS, 'sticky top-0 border-b border-line bg-subtle text-[10.5px] font-bold tracking-[0.9px] text-ink-3 uppercase')}>
          <span role="columnheader">{text('Day')}</span>
          {DELIVERY_METRICS.map((m) => (
            <span key={m} role="columnheader">
              {text(DELIVERY_HEADS[m])}
            </span>
          ))}
        </div>
        <div role="row" className={cx(DELIVERY_COLS, 'text-[13px] tabular-nums', days.length > 0 && 'border-b border-line/60')}>
          <b role="rowheader">{text('Total')}</b>
          {DELIVERY_METRICS.map((m) => cell(delivery.totals[m], m))}
        </div>
        {days.map((x, i) => (
          <div key={x.date} role="row" className={cx(DELIVERY_COLS, 'text-[13px] tabular-nums', i < days.length - 1 && 'border-b border-line/60')}>
            <span role="rowheader">{dayLabel(x.date)}</span>
            {DELIVERY_METRICS.map((m) => cell(x[m], m))}
          </div>
        ))}
      </div>
      {days.length ? null : <p className="border-t border-line/60 px-4 py-3 text-ink-3">{text('No messages counted in this period.')}</p>}
    </section>
  );
}

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const hh = (h: number) => `${String(h).padStart(2, '0')}:00`;

/** Chats started per weekday and hour as a grid, darker when busier, and the busiest hour in words (#247). */
function Hours({ hours, zone }: { hours: number[][]; zone: string | null }) {
  const top = Math.max(0, ...hours.flat());
  const peakDay = top > 0 ? hours.findIndex((row) => row.includes(top)) : -1;
  const peak = peakDay >= 0 ? ([peakDay, hours[peakDay]!.indexOf(top)] as const) : null;
  return (
    <section aria-label={text('Busiest hours')} className="flex min-w-0 flex-col gap-2 rounded-[12px] border border-line bg-surface px-4 py-3.5">
      <div className="flex items-baseline gap-2">
        <h2 className="flex-1 text-[14px] font-bold">{text('Busiest hours')}</h2>
        <span className="text-[11.5px] text-ink-3">
          {peak ? text('Busiest: {day} {hour}', { day: text(WEEKDAYS[peak[0]]!), hour: hh(peak[1]) }) : text('No chats in this period.')}
        </span>
      </div>
      <div role="table" aria-label={text('Chats by weekday and hour')} className="flex flex-col gap-[2px]">
        {hours.map((row, day) => (
          <div key={day} role="row" className="grid items-center gap-[2px] [grid-template-columns:30px_repeat(24,minmax(0,1fr))]">
            <span role="rowheader" className="text-[10.5px] text-ink-3">{text(WEEKDAYS[day]!)}</span>
            {row.map((n, h) => {
              const said = text('{day} {hour}: {n} chats', { day: text(WEEKDAYS[day]!), hour: hh(h), n });
              return (
                <span
                  key={h}
                  role="cell"
                  aria-label={said}
                  title={said}
                  className={cx('block h-3.5 rounded-[2px]', n ? 'bg-[#273498] dark:bg-[#7c8fe8]' : 'bg-subtle')}
                  style={n ? { opacity: 0.2 + (0.8 * n) / top } : undefined}
                />
              );
            })}
          </div>
        ))}
      </div>
      <div className="grid text-[10.5px] text-ink-3 [grid-template-columns:30px_repeat(4,minmax(0,1fr))]" aria-hidden>
        <span />
        {[0, 6, 12, 18].map((h) => (
          <span key={h}>{hh(h)}</span>
        ))}
      </div>
      {zone ? <p className="text-[11px] text-ink-3">{text('Times in {zone}.', { zone })}</p> : null}
    </section>
  );
}

/** The pages chats start on, most first, each with its share (#247). */
function StartPages({ pages }: { pages: NonNullable<Insights['start_pages']> }) {
  const top = Math.max(1, ...pages.map((p) => p.share));
  return (
    <section aria-label={text('Top start pages')} className="flex min-w-0 flex-col gap-[9px] rounded-[12px] border border-line bg-surface px-4 py-3.5 text-[12.5px]">
      <h2 className="text-[14px] font-bold">{text('Top start pages')}</h2>
      {pages.length ? (
        <ul className="flex flex-col gap-[9px]" aria-label={text('Top start pages')}>
          {pages.map((p) => (
            <li key={p.page} className="flex items-center gap-2" title={p.page}>
              <span className="min-w-0 flex-1 truncate">{p.page}</span>
              <span className="h-1.5 w-[64px] shrink-0 rounded-[3px] bg-subtle" aria-hidden>
                <span className="block h-1.5 rounded-[3px] bg-[#4a63e8]" style={{ width: `${(p.share / top) * 100}%` }} />
              </span>
              <b className="w-[34px] text-right tabular-nums">{p.share}%</b>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-ink-3">{text('No pages recorded in this period.')}</p>
      )}
    </section>
  );
}

/**
 * The rest of the report in one line (RING-13, TEAM-81, VOICE-23): the median time to join, transfers, chats more than
 * one of the team took part in, and calls answered — every one of them per agent in the CSV.
 */
function Also({ d }: { d: Insights }) {
  const parts: string[] = [];
  if (d.join_median_seconds !== null) parts.push(text('Median time to join {time}', { time: clock(d.join_median_seconds) }));
  const transfers = (d.team?.agents ?? []).reduce((n, a) => n + a.transfers_in, 0);
  if (d.team?.installed && transfers) parts.push(text('{n} transfers', { n: transfers }));
  if (d.team?.installed && d.team.multi_staff_chats) parts.push(text('{n} chats with more than one of the team', { n: d.team.multi_staff_chats }));
  if (d.calls?.installed && d.calls.requested) parts.push(text('{answered} of {requested} calls answered', { answered: d.calls.answered ?? 0, requested: d.calls.requested }));
  if (!parts.length) return null;
  return <p className="text-[11.5px] text-ink-3">{`${parts.join(' · ')} — ${text('per agent in the CSV.')}`}</p>;
}
