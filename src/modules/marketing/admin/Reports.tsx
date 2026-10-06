import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useId, useMemo, useState } from 'react';
import { useTab } from '../../../core/tab-context';
import { Icon } from '../../../components/Icon';
import { Select } from '../../../components/Select';
import { cx, Empty } from '../../../components/ui';
import { fetchAnalytics, fetchCampaigns, MK, type Analytics, type Campaign, type CampaignFilters } from '../api';
import { campaignStatus } from '../lib/consent';
import { count, day, isoDay, pct, share } from '../lib/format';
import { useMarketingOrg } from '../org';
import { Input, Kpi, Loaded, Mono, OptionalView, PageBody, PageHeader, Pager, Panel, Planned, Status, Table, TD, TH, useDebounced } from '../parts';

/**
 * Reports (MKT-TRK-03, MKT-ANL-01). Every campaign that has a report — sent, sending or paused (SRS §6.1) — with its
 * delivery, human open, click, unsubscribe and bounce rates, each row opening its DK09 report; and analytics across
 * campaigns (Target, phase 3), which a server without them says plainly. Open rates count human opens only
 * (MKT-TRK-02): machine opens are excluded.
 */
type ReportStatus = 'sent' | 'sending' | 'paused';

const STATUSES: Array<{ value: ReportStatus; label: string }> = [
  { value: 'sent', label: 'Sent' },
  { value: 'sending', label: 'Sending' },
  { value: 'paused', label: 'Paused' },
];

const PERIODS: Array<{ value: string; label: string }> = [
  { value: '30', label: 'Last 30 days' },
  { value: '90', label: 'Last 90 days' },
  { value: '365', label: 'Last 365 days' },
];

// New contacts by month: subscribed in the accent (palette slot 1), the rest in the de-emphasis grey; every value is
// also printed beside its bar, so the grey's low contrast never hides a number.
const SUBSCRIBED = 'bg-[#2a78d6] dark:bg-[#3987e5]';
const REST = 'bg-[#a3abbd] dark:bg-[#4a5573]';

export default function Reports() {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader crumb="Marketing / Insights" title="Reports" sub="Every campaign's report, and analytics across campaigns" />
      <PageBody>
        <div className="flex flex-col gap-4">
          <CampaignReports />
          <AcrossCampaigns />
        </div>
      </PageBody>
    </div>
  );
}

/* ------------------------------------------------------------------------ *
 * Pure helpers
 * ------------------------------------------------------------------------ */

/** The rates of a campaign's row, from its counts: delivered of sent; opens and clicks of delivered; bounces of sent. */
export function campaignRates(c: Pick<Campaign, 'sent_count' | 'delivered_count' | 'human_opens' | 'clicks' | 'bounces' | 'bounce_rate'>): { delivered: string; opens: string; clicks: string; bounces: string } {
  return {
    delivered: share(c.delivered_count, c.sent_count),
    opens: share(c.human_opens, c.delivered_count),
    clicks: share(c.clicks, c.delivered_count),
    bounces: c.sent_count > 0 ? share(c.bounces, c.sent_count) : pct(c.bounce_rate),
  };
}

/** `2026-09` (or a date in it) as `Sep 2026`. */
export function monthLabel(m: string): string {
  const x = /^(\d{4})-(\d{2})/.exec(m);
  if (!x) return m;
  return new Date(Date.UTC(Number(x[1]), Number(x[2]) - 1, 15)).toLocaleDateString('en-GB', { month: 'short', year: 'numeric', timeZone: 'UTC' });
}

/** The last `days` days, today included, as local dates. */
function rangeOf(days: number): { from: string; to: string } {
  const to = new Date();
  const from = new Date(to);
  from.setDate(to.getDate() - (days - 1));
  return { from: isoDay(from), to: isoDay(to) };
}

/* ------------------------------------------------------------------------ *
 * Campaign reports (MKT-TRK-03)
 * ------------------------------------------------------------------------ */

function CampaignReports() {
  const org = useMarketingOrg();
  const { go } = useTab();
  const [status, setStatus] = useState<ReportStatus>('sent');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const term = useDebounced(q.trim());
  const f: CampaignFilters = { status, q: term, page };
  const list = useQuery({ queryKey: MK.campaigns(org, f), queryFn: ({ signal }) => fetchCampaigns(org, f, signal), placeholderData: keepPreviousData });
  const open = (c: Campaign) => go(`/marketing/campaigns/${c.id}/report`);

  return (
    <Panel title="Campaign reports" sub="Funnel, top links, open quality and deliverability of each campaign — open one to read it." bodyClassName="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Select<ReportStatus>
          aria-label="Status"
          value={status}
          onValueChange={(s) => {
            setStatus(s);
            setPage(1);
          }}
          options={STATUSES}
          className="w-[140px]"
        />
        <span className="relative min-w-[200px] flex-1 sm:max-w-[320px]">
          <Icon name="search" size={15} className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-ink-3" />
          <Input
            type="search"
            aria-label="Search campaigns"
            placeholder="Search campaigns"
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setPage(1);
            }}
            className="pl-8"
          />
        </span>
      </div>
      <Loaded q={list} what="Campaign reports">
        {(p) =>
          p.rows.length === 0 ? (
            <div className="rounded-[12px] border border-line">
              {term ? (
                <Empty icon="search" title={`No campaign matches “${term}”`} hint="Search by the campaign’s name." />
              ) : status === 'sent' ? (
                <Empty icon="chart" title="No campaign has been sent yet" hint="A campaign’s report appears here once it starts sending." />
              ) : status === 'sending' ? (
                <Empty icon="send" title="Nothing is sending now" hint="Campaigns being sent show their report here as it fills." />
              ) : (
                <Empty icon="pause" title="No campaign is paused" hint="A campaign paused by hand or by the bounce guard shows here." />
              )}
            </div>
          ) : (
            <div className={cx('flex flex-col', list.isPlaceholderData && 'opacity-60')}>
              <Table
                label="Campaign reports"
                head={
                  <tr>
                    <th className={TH}>Campaign</th>
                    <th className={TH}>Sent</th>
                    <th className={cx(TH, 'text-right')}>Recipients</th>
                    <th className={cx(TH, 'text-right')}>Delivered %</th>
                    <th className={cx(TH, 'text-right')}>Human open rate</th>
                    <th className={cx(TH, 'text-right')}>Click rate</th>
                    <th className={cx(TH, 'text-right')}>Unsubscribes</th>
                    <th className={cx(TH, 'text-right')}>Bounce rate</th>
                  </tr>
                }
              >
                {p.rows.map((c) => {
                  const r = campaignRates(c);
                  const s = campaignStatus(c.status);
                  const label = c.status === 'sending' && c.progress !== null ? `${s.label} · ${Math.round(c.progress)}%` : c.status === 'paused' && c.paused_reason === 'bounce_guard' ? `${s.label} · bounce guard` : s.label;
                  return (
                    <tr key={c.id} className="cursor-pointer hover:bg-subtle/60" onClick={() => open(c)}>
                      <td className={cx(TD, 'max-w-[320px]')}>
                        <button
                          type="button"
                          className="block max-w-full truncate text-left font-semibold text-ink hover:text-primary hover:underline"
                          onClick={(e) => {
                            e.stopPropagation();
                            open(c);
                          }}
                        >
                          {c.name}
                        </button>
                        <span className="flex flex-wrap items-center gap-1.5 text-[11.5px] text-ink-3">
                          {c.status !== 'sent' ? <Status tone={s.tone}>{label}</Status> : null}
                          {c.audience_label ?? c.topic?.name ?? null}
                        </span>
                      </td>
                      <td className={cx(TD, 'whitespace-nowrap text-ink-2')}>{day(c.started_at ?? c.scheduled_at)}</td>
                      <td className={cx(TD, 'text-right')}>
                        <Mono>{count(c.recipients_count)}</Mono>
                      </td>
                      <td className={cx(TD, 'text-right')}>
                        <Mono>{r.delivered}</Mono>
                      </td>
                      <td className={cx(TD, 'text-right')}>
                        <Mono className="font-semibold">{r.opens}</Mono>
                      </td>
                      <td className={cx(TD, 'text-right')}>
                        <Mono>{r.clicks}</Mono>
                      </td>
                      <td className={cx(TD, 'text-right')}>
                        <Mono>{count(c.unsubscribes)}</Mono>
                      </td>
                      <td className={cx(TD, 'text-right')}>
                        <Mono className={c.status === 'paused' && c.paused_reason === 'bounce_guard' ? 'font-semibold text-danger' : undefined}>{r.bounces}</Mono>
                      </td>
                    </tr>
                  );
                })}
              </Table>
              <Pager page={p.page} pages={p.pages} total={p.total} perPage={p.perPage} onPage={setPage} />
            </div>
          )
        }
      </Loaded>
    </Panel>
  );
}

/* ------------------------------------------------------------------------ *
 * Across campaigns (MKT-ANL-01, Target · phase 3)
 * ------------------------------------------------------------------------ */

function AcrossCampaigns() {
  const org = useMarketingOrg();
  const [days, setDays] = useState('90');
  const range = useMemo(() => rangeOf(Number(days)), [days]);
  const q = useQuery({ queryKey: MK.analytics(org, range.from, range.to), queryFn: ({ signal }) => fetchAnalytics(org, range.from, range.to, signal), placeholderData: keepPreviousData });
  const offered = q.data?.offered !== false;
  return (
    <Panel
      title="Across campaigns"
      sub="By period and topic, and the cohort of new contacts"
      action={offered ? <Select<string> aria-label="Period" value={days} onValueChange={setDays} options={PERIODS} className="w-[150px]" /> : undefined}
      bodyClassName={cx('flex flex-col gap-4', q.isPlaceholderData && 'opacity-60')}
    >
      <OptionalView
        q={q}
        what="Cross-campaign analytics"
        notOffered={
          <div className="flex flex-col items-start gap-2 rounded-[10px] border border-dashed border-line px-4 py-3.5 text-[12.5px] text-ink-2">
            <p className="m-0">Cross-campaign analytics by period, topic, list and channel, and a cohort of new contacts, are planned (phase 3).</p>
            <p className="m-0 text-ink-3">This WorkSuite server does not offer them yet. Each campaign’s own report is in the list above.</p>
            <Planned />
          </div>
        }
      >
        {(a) => <AnalyticsView a={a} />}
      </OptionalView>
    </Panel>
  );
}

function AnalyticsView({ a }: { a: Analytics }) {
  const topicsId = useId();
  return (
    <>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        <Kpi label="Campaigns" value={count(a.campaigns)} sub={`${day(a.period.from)} – ${day(a.period.to)}`} />
        <Kpi label="Sent" value={count(a.sent)} />
        <Kpi label="Human open rate" value={a.human_open_rate === null ? null : pct(a.human_open_rate)} sub="Machine opens excluded" />
        <Kpi label="Click rate" value={a.click_rate === null ? null : pct(a.click_rate)} />
        <Kpi label="Unsubscribe rate" value={a.unsubscribe_rate === null ? null : pct(a.unsubscribe_rate)} />
      </div>
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <section aria-labelledby={topicsId} className="flex min-w-0 flex-col gap-2">
          <h3 id={topicsId} className="m-0 text-[13px] font-bold text-ink">
            By topic
          </h3>
          {a.by_topic.length === 0 ? (
            <p className="m-0 rounded-[10px] border border-line px-3 py-3 text-[12.5px] text-ink-3">No campaign in this period targeted a topic.</p>
          ) : (
            <Table
              label="By topic"
              head={
                <tr>
                  <th className={TH}>Topic</th>
                  <th className={cx(TH, 'text-right')}>Sent</th>
                  <th className={cx(TH, 'text-right')}>Human open rate</th>
                  <th className={cx(TH, 'text-right')}>Click rate</th>
                </tr>
              }
            >
              {a.by_topic.map((t) => (
                <tr key={t.topic}>
                  <td className={cx(TD, 'font-semibold')}>{t.topic}</td>
                  <td className={cx(TD, 'text-right')}>
                    <Mono>{count(t.sent)}</Mono>
                  </td>
                  <td className={cx(TD, 'text-right')}>
                    <Mono>{pct(t.human_open_rate)}</Mono>
                  </td>
                  <td className={cx(TD, 'text-right')}>
                    <Mono>{pct(t.click_rate)}</Mono>
                  </td>
                </tr>
              ))}
            </Table>
          )}
        </section>
        <NewContacts months={a.new_contacts} />
      </div>
    </>
  );
}

/** New contacts by month, each bar split into those who subscribed and the rest; the numbers are printed beside it. */
function NewContacts({ months }: { months: Analytics['new_contacts'] }) {
  const id = useId();
  const max = Math.max(1, ...months.map((m) => m.added));
  return (
    <section aria-labelledby={id} className="flex min-w-0 flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id={id} className="m-0 text-[13px] font-bold text-ink">
          New contacts by month
        </h3>
        <span className="flex items-center gap-3 text-[11.5px] text-ink-2" aria-hidden={months.length === 0}>
          <span className="flex items-center gap-1.5">
            <span className={cx('h-2.5 w-2.5 rounded-[2px]', SUBSCRIBED)} />
            Subscribed
          </span>
          <span className="flex items-center gap-1.5">
            <span className={cx('h-2.5 w-2.5 rounded-[2px]', REST)} />
            Not subscribed
          </span>
        </span>
      </div>
      {months.length === 0 ? (
        <p className="m-0 rounded-[10px] border border-line px-3 py-3 text-[12.5px] text-ink-3">No contact was added in this period.</p>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-1 rounded-[10px] border border-line p-3">
          {months.map((m) => {
            const added = Math.max(0, m.added);
            const subscribed = Math.min(Math.max(0, m.subscribed), added);
            const rest = added - subscribed;
            return (
              <li key={m.month} className="grid grid-cols-[64px_minmax(0,1fr)_auto] items-center gap-3 py-1 text-[12px]" title={`${monthLabel(m.month)}: ${count(m.added)} new, ${count(m.subscribed)} subscribed`}>
                <span className="text-ink-2">{monthLabel(m.month)}</span>
                <span className="flex h-3 min-w-0 items-center">
                  {added > 0 ? (
                    <span className="flex h-3 gap-[2px] overflow-hidden rounded-r-[4px]" style={{ width: `${(added / max) * 100}%` }} aria-hidden>
                      {subscribed > 0 ? <span className={cx('h-full min-w-[2px]', SUBSCRIBED)} style={{ flexGrow: subscribed, flexBasis: 0 }} /> : null}
                      {rest > 0 ? <span className={cx('h-full min-w-[2px]', REST)} style={{ flexGrow: rest, flexBasis: 0 }} /> : null}
                    </span>
                  ) : null}
                </span>
                <span className="text-right whitespace-nowrap text-ink-2">
                  <Mono className="font-semibold text-ink">{count(m.added)}</Mono> new · <Mono>{count(m.subscribed)}</Mono> subscribed
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
