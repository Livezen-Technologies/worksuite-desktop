import { useState, type ReactNode } from 'react';
import { Button, cx, Empty } from '../../../components/ui';
import { dataOf, useHeatmap, useModuleStatus, useOverview, type AnalyticsOverview, type AnalyticsQuery, type Kpi as KpiData } from '../api';
import { useSocialAccess } from '../access';
import { METRIC_DEFINITIONS, networkInfo, type Network } from '../lib/networks';
import { addDays, todayInZone } from '../lib/time';
import { compact, delta, full, Kpi, NativeSelect, NetChip, Notice, OptionalView, PageBody, PageHeader, Panel, pct, Table, TD, TR, UnderlineTabs, useBrandScope } from '../parts';
import { HeatmapGrid } from './measure/Heatmap';
import { AudienceTab, CampaignsTab, InboxTab, PostsTab } from './measure/AnalyticsTabs';
import { ExportButton, ScheduleReportDialog } from './measure/Reports';
import { TrendChart, TrendLegend } from './measure/TrendChart';

/**
 * W07 — Analytics (WS-SMM-SRS-001 SMM-ANL-001…009, AC-15, WF-12): KPIs against the previous period, the daily trend,
 * results by account with each network's own metric definitions, the engagement heat map, posts, audience, inbox
 * response and campaigns; export and scheduled reports for those allowed. A metric the server could not measure is
 * "Not measured", never a zero, and metrics networks define differently are never added up silently.
 */

type Range = '7d' | '30d' | '90d' | 'month';
type TabId = 'overview' | 'posts' | 'audience' | 'inbox' | 'campaigns' | 'competitors';

const TABS: Array<{ id: TabId; label: string }> = [
  { id: 'overview', label: 'Overview' },
  { id: 'posts', label: 'Posts' },
  { id: 'audience', label: 'Audience' },
  { id: 'inbox', label: 'Inbox & response' },
  { id: 'campaigns', label: 'Campaigns' },
  { id: 'competitors', label: 'Competitors' },
];

/** The range's days, ending yesterday (today is not complete), or this month so far. */
function rangeOf(range: Range, today: string): { from: string; to: string } {
  if (range === 'month') return { from: `${today.slice(0, 8)}01`, to: today };
  const to = addDays(today, -1);
  const days = range === '7d' ? 7 : range === '90d' ? 90 : 30;
  return { from: addDays(to, -(days - 1)), to };
}

export default function Analytics() {
  const access = useSocialAccess(dataOf(useModuleStatus().data)?.permissions);
  const [brandId] = useBrandScope();
  const [range, setRange] = useState<Range>('30d');
  const [today] = useState(() => todayInZone());
  const [tab, setTab] = useState<TabId>('overview');
  const [scheduling, setScheduling] = useState(false);
  const query: AnalyticsQuery = { ...rangeOf(range, today), brand_id: brandId };
  const overview = useOverview(query);

  return (
    <>
      <PageHeader
        crumb="Analytics"
        title="Analytics"
        actions={
          <>
            <NativeSelect label="Date range" value={range} onChange={(v) => setRange(v as Range)} className="h-8 w-auto">
              <option value="7d">Last 7 days</option>
              <option value="30d">Last 30 days</option>
              <option value="90d">Last 90 days</option>
              <option value="month">This month</option>
            </NativeSelect>
            {access.exportAnalytics ? (
              <>
                <Button icon="mail" onClick={() => setScheduling(true)}>
                  Schedule report
                </Button>
                <ExportButton query={query} />
              </>
            ) : null}
          </>
        }
      />
      <PageBody>
        <div className="flex flex-col gap-4">
          <UnderlineTabs label="Analytics views" value={tab} onChange={setTab} tabs={TABS} />
          {tab === 'overview' ? <OverviewTab q={overview} brandId={brandId} /> : null}
          {tab === 'posts' ? <PostsTab query={query} /> : null}
          {tab === 'audience' ? <AudienceTab overview={overview.data} /> : null}
          {tab === 'inbox' ? <InboxTab query={query} /> : null}
          {tab === 'campaigns' ? <CampaignsTab brandId={brandId} /> : null}
          {tab === 'competitors' ? (
            <Panel>
              <Empty icon="chart" title="Competitor benchmarks arrive in a later phase (SMM-ANL-010)" hint="Until then, Analytics covers your own accounts only." />
            </Panel>
          ) : null}
        </div>
      </PageBody>
      {scheduling ? <ScheduleReportDialog onClose={() => setScheduling(false)} /> : null}
    </>
  );
}

/* ------------------------------------------------------------------------ *
 * Overview
 * ------------------------------------------------------------------------ */

type OverviewQ = ReturnType<typeof useOverview>;

function OverviewTab({ q, brandId }: { q: OverviewQ; brandId: number | null }) {
  const heat = useHeatmap({ brand_id: brandId });
  return (
    <>
      <OptionalView q={q} what="Analytics" compact>
        {(o) => <KpiRow kpis={o.kpis} />}
      </OptionalView>
      <Panel title="Reach and engagements" action={<TrendLegend />}>
        <OptionalView q={q} what="The reach and engagement trend" compact>
          {(o) => <TrendChart series={o.series} />}
        </OptionalView>
      </Panel>
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <Panel title="By account">
          <OptionalView q={q} what="Results by account" compact>
            {(o) => <ByAccount overview={o} />}
          </OptionalView>
        </Panel>
        <Panel title="When your audience engages">
          <OptionalView q={heat} what="The engagement heat map" compact>
            {(h) => <HeatmapGrid heatmap={h} />}
          </OptionalView>
        </Panel>
      </div>
    </>
  );
}

const KPIS: Array<{ key: keyof AnalyticsOverview['kpis']; label: string; show: (v: number) => string; lowerIsBetter?: boolean }> = [
  { key: 'followers', label: 'Followers', show: full },
  { key: 'reach', label: 'Reach', show: compact },
  { key: 'impressions', label: 'Impressions', show: compact },
  { key: 'engagement_rate', label: 'Engagement rate', show: (v) => pct(v) },
  { key: 'link_clicks', label: 'Link clicks', show: full },
  { key: 'median_reply_minutes', label: 'Median reply time', show: (v) => `${Math.round(v)} min`, lowerIsBetter: true },
];

/** Green when the change is for the better — for reply time, a shorter one (SMM-ANL-001). */
function deltaTone(k: KpiData, lowerIsBetter?: boolean): 'success' | 'danger' | 'muted' {
  if (k.delta === null || k.delta === 0) return 'muted';
  return k.delta > 0 !== !!lowerIsBetter ? 'success' : 'danger';
}

function KpiRow({ kpis }: { kpis: AnalyticsOverview['kpis'] }) {
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
      {KPIS.map((d) => {
        const k = kpis[d.key] ?? { value: null, delta: null };
        return (
          <Kpi
            key={d.key}
            label={d.label}
            value={k.value === null ? null : d.show(k.value)}
            sub={k.value === null ? undefined : delta(k.delta, k.delta_kind ?? (d.key === 'median_reply_minutes' ? 'min' : 'pct'))}
            tone={deltaTone(k, d.lowerIsBetter)}
            title={k.value === null ? 'Not measured: an account in scope did not grant the insight needed, or the network does not report it.' : 'Compared with the previous period of the same length.'}
          />
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------------ *
 * By account
 * ------------------------------------------------------------------------ */

const METRIC_NAMES: Record<string, string> = { reach: 'Reach', impressions: 'Impressions', engagements: 'Engagements', engagement_rate: 'Engagement rate', clicks: 'Link clicks', link_clicks: 'Link clicks', followers: 'Followers' };

/** "Reach is defined differently by each network, so it is shown per account and not added up." */
export function mixedNote(metrics: string[]): string {
  const names = metrics.map((m, i) => (i ? (METRIC_NAMES[m] ?? m).toLowerCase() : (METRIC_NAMES[m] ?? m)));
  const list = names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}` : names[0]!;
  return names.length > 1 ? `${list} are defined differently by each network, so they are shown per account and not added up.` : `${list} is defined differently by each network, so it is shown per account and not added up.`;
}

/** A metric heading carrying each network's definition on hover (SMM-ANL-008). */
function MetricHead({ label, metric, networks, overview }: { label: string; metric: string; networks: Network[]; overview: AnalyticsOverview }) {
  const lines = networks
    .map((n) => {
      const def = overview.definitions?.[n]?.[metric] ?? METRIC_DEFINITIONS[metric]?.[n];
      return def ? `${networkInfo(n).label}: ${def}` : null;
    })
    .filter(Boolean);
  if (!lines.length) return <>{label}</>;
  return (
    <span title={lines.join('\n')} className="cursor-help underline decoration-dotted underline-offset-2">
      {label}
    </span>
  );
}

function ByAccount({ overview }: { overview: AnalyticsOverview }) {
  const rows = overview.by_account;
  const networks = [...new Set(rows.map((r) => r.network))];
  const mixed = overview.mixed_definitions ?? [];
  const head = (label: string, metric: string): ReactNode => <MetricHead label={label} metric={metric} networks={networks} overview={overview} />;
  const cell = (v: ReactNode | null) => (v === null ? <span className="text-ink-3">—</span> : v);
  return (
    <div className="flex flex-col gap-3">
      {mixed.length ? (
        <Notice tone="info" icon="info">
          {mixedNote(mixed)}
        </Notice>
      ) : null}
      {rows.length ? (
        <Table head={['Account', 'Posts', head('Reach', 'reach'), head('Eng. rate', 'engagements'), head('Clicks', 'clicks'), head('Followers Δ', 'followers')]} minWidth={560}>
          {rows.map((a) => (
            <tr key={a.account_id} className={TR}>
              <td className={TD}>
                <span className="flex min-w-0 items-center gap-2">
                  <NetChip network={a.network} />
                  <span className="truncate font-semibold text-ink">{a.name}</span>
                </span>
              </td>
              <td className={cx(TD, 'tabular-nums')}>{full(a.posts)}</td>
              <td className={cx(TD, 'tabular-nums')}>{cell(a.reach === null ? null : compact(a.reach))}</td>
              <td className={cx(TD, 'tabular-nums')}>{cell(a.engagement_rate === null ? null : pct(a.engagement_rate))}</td>
              <td className={cx(TD, 'tabular-nums')}>{cell(a.clicks === null ? null : full(a.clicks))}</td>
              <td className={cx(TD, 'tabular-nums')}>{cell(a.followers_delta === null ? null : <span className={a.followers_delta >= 0 ? 'text-success' : 'text-danger'}>{delta(a.followers_delta, 'abs')}</span>)}</td>
            </tr>
          ))}
        </Table>
      ) : (
        <p className="py-6 text-center text-[12.5px] text-ink-3">No accounts in this scope.</p>
      )}
    </div>
  );
}
