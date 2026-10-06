import { useId, useState, type ReactNode } from 'react';
import { ApiError } from '../../../core/api';
import { useTab } from '../../../core/tab-context';
import { Icon } from '../../../components/Icon';
import { Button, cx, Empty, ErrorNote } from '../../../components/ui';
import { useDashboard, useReadiness, type Campaign, type Dashboard as Summary } from '../api';
import { campaignStatus, type Tone } from '../lib/consent';
import { count, parseStamp, pct, plural, ratio, share } from '../lib/format';
import { useCompanies, useMarketingOrg } from '../org';
import { Bar, Kpi, Loaded, Mono, PageBody, PageHeader, Panel, Row, Status, Table, TD, TH } from '../parts';

/**
 * DK01 · Dashboard (MKT-DSH-01/02, WF-01). Audience size, consent coverage, recent email campaigns and the calls
 * summary for the company over the last 30 days. Until the module is live, the go-live readiness panel (Target)
 * names each open item, its owner and where to fix it; a server without the readiness check shows no panel rather
 * than guessed blockers. Open rates are human opens: proxy and scanner opens are excluded (MKT-TRK-02).
 */
export default function Dashboard() {
  const { go } = useTab();
  const org = useMarketingOrg();
  const companies = useCompanies();
  const company = companies.find((c) => c.id === org)?.name ?? (companies.length === 1 ? companies[0]?.name : undefined) ?? 'this company';
  const dash = useDashboard();
  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader
        crumb="Marketing"
        title="Dashboard"
        sub={`Audience, email and call activity for ${company} · last 30 days`}
        actions={
          <>
            <Button icon="upload" onClick={() => go('/marketing/import')}>
              Import contacts
            </Button>
            <Button variant="primary" icon="plus" onClick={() => go('/marketing/campaigns/new')}>
              New campaign
            </Button>
          </>
        }
      />
      <PageBody>
        <div className="mx-auto flex w-full max-w-[1280px] flex-col gap-4">
          <Readiness />
          <Loaded q={dash} what="The Marketing dashboard">
            {(d) => <Overview d={d} />}
          </Loaded>
        </div>
      </PageBody>
    </div>
  );
}

/* ------------------------------------------------------------------------ *
 * Pure helpers
 * ------------------------------------------------------------------------ */

/** Where a campaign row opens: a draft's content, a scheduled one's review, anything else its report. */
export function campaignRoute(c: Pick<Campaign, 'id' | 'status'>): string {
  const base = `/marketing/campaigns/${c.id}`;
  return c.status === 'draft' ? `${base}/content` : c.status === 'scheduled' ? `${base}/review` : `${base}/report`;
}

/** The status chip, with how far a send has got ("Sending · 62%"). */
export function campaignChip(c: Pick<Campaign, 'status' | 'progress'>): { label: string; tone: Tone } {
  const s = campaignStatus(c.status);
  return c.status === 'sending' && typeof c.progress === 'number' && Number.isFinite(c.progress) ? { ...s, label: `${s.label} · ${Math.round(c.progress)}%` } : s;
}

/** "7 Sep" for the week that starts on a date; the server's own words when it is not one. */
export function weekLabel(week: string): string {
  const d = parseStamp(week);
  return d ? d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : week;
}

/** What the weekly chart shows, said in full for a screen reader. */
export function weeklySummary(weekly: Summary['weekly']): string {
  if (!weekly.length) return 'No email delivered in the last 30 days.';
  const weeks = weekly.map((w) => `week of ${weekLabel(w.week)}: ${count(w.delivered)} delivered, ${count(w.human_opens)} human opens`);
  return `Email delivered and human opens by week. ${weeks.join('; ')}.`;
}

/* ------------------------------------------------------------------------ *
 * Go-live readiness (MKT-DSH-02, Target)
 * ------------------------------------------------------------------------ */

function Readiness() {
  const { go, openLink } = useTab();
  const r = useReadiness();
  const headingId = useId();
  if (r.error) {
    if (r.error instanceof ApiError && r.error.forbidden) {
      return (
        <p className="flex items-center gap-2 text-[12px] text-ink-3">
          <Icon name="lock" size={14} /> You don’t have permission to see go-live readiness.
        </p>
      );
    }
    return <ErrorNote error={r.error} onRetry={() => void r.refetch()} />;
  }
  // Not offered by this server: no panel, never invented blockers.
  if (!r.data?.offered) return null;
  const open = r.data.data.items.filter((i) => i.open);
  if (open.length === 0) {
    return (
      <p className="flex items-center gap-2 text-[12.5px] font-semibold text-success">
        <Icon name="check-circle" size={16} /> Ready to send · every go-live item is cleared
      </p>
    );
  }
  const fix = (to: string) => (to.startsWith('/marketing') ? go(to) : openLink(to));
  return (
    <section aria-labelledby={headingId} className="rounded-[12px] border border-warning/60 bg-surface px-4 pt-3.5 pb-1.5">
      <div className="flex items-start gap-2.5">
        <Icon name="warning" size={18} className="mt-px shrink-0 text-warning" />
        <div className="min-w-0">
          <h2 id={headingId} className="text-[14px] font-bold text-ink">
            Go-live readiness · {plural(open.length, 'item')} open
          </h2>
          <p className="mt-0.5 text-[12px] text-ink-3">Sending stays blocked until the red items are cleared. Owners are notified when each one changes.</p>
        </div>
      </div>
      <ul className="mt-2 divide-y divide-line sm:pl-7">
        {open.map((i) => {
          const to = i.fix;
          return (
            <li key={i.code} className="flex items-center gap-3 py-2">
              <Icon name="warning" size={15} className="shrink-0 text-danger" />
              <div className="min-w-0 flex-1">
                <div className="text-[12.5px] font-semibold text-ink">{i.title}</div>
                <div className="truncate text-[11.5px] text-ink-3">{[i.owner, i.area].filter(Boolean).join(' · ')}</div>
              </div>
              {to ? (
                <button type="button" onClick={() => fix(to)} aria-label={`Fix: ${i.title}`} className="shrink-0 text-[12px] font-semibold text-primary underline underline-offset-2 hover:no-underline">
                  Fix
                </button>
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/* ------------------------------------------------------------------------ *
 * The numbers (MKT-DSH-01)
 * ------------------------------------------------------------------------ */

function Overview({ d }: { d: Summary }) {
  const subscribed = d.email_subscribed.share ?? (d.contacts.total > 0 ? (d.email_subscribed.count / d.contacts.total) * 100 : null);
  const guard = d.bounce_guard_threshold;
  const over = d.bounce_rate !== null && d.bounce_rate >= guard;
  return (
    <>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="Contacts" value={count(d.contacts.total)} sub={`+${count(d.contacts.added_this_month)} this month`} subTone={d.contacts.added_this_month > 0 ? 'success' : undefined} />
        <Kpi label="Email-subscribed" value={count(d.email_subscribed.count)} sub={subscribed === null ? 'No contacts yet' : `${pct(subscribed)} of contacts`} />
        <Kpi label="Human open rate" value={d.human_open_rate === null ? null : pct(d.human_open_rate)} sub="Proxy/bot opens excluded" />
        <Kpi label="Bounce rate" value={d.bounce_rate === null ? null : pct(d.bounce_rate)} tone={over ? 'danger' : undefined} sub={`Guard pauses at ${pct(guard, Number.isInteger(guard) ? 0 : 1)}`} subTone={over ? 'danger' : 'success'} />
      </div>
      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(260px,340px)]">
        <div className="flex min-w-0 flex-col gap-4">
          <Weekly weekly={d.weekly} />
          <Recent rows={d.recent_campaigns} />
        </div>
        <div className="flex min-w-0 flex-col gap-4">
          <Calls calls={d.calls} />
          <Coverage consent={d.consent} />
        </div>
      </div>
    </>
  );
}

function LinkButton({ children, onClick }: { children: ReactNode; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="shrink-0 text-[12px] font-semibold text-primary underline underline-offset-2 hover:no-underline">
      {children}
    </button>
  );
}

/** Delivered mail per week, human opens drawn inside each bar (part of what was delivered); a table on request. */
function Weekly({ weekly }: { weekly: Summary['weekly'] }) {
  const { go } = useTab();
  const [asTable, setAsTable] = useState(false);
  const max = weekly.reduce((m, w) => Math.max(m, w.delivered), 0);
  const last = weekly[weekly.length - 1];
  const sparse = weekly.length > 8;
  return (
    <Panel
      title="Email delivery · weekly"
      action={
        <div className="flex shrink-0 items-center gap-1">
          {max > 0 ? (
            <Button size="sm" variant="ghost" icon="table" aria-pressed={asTable} onClick={() => setAsTable(!asTable)}>
              Table
            </Button>
          ) : null}
          <Button size="sm" variant="ghost" icon="chart" onClick={() => go('/marketing/reports')}>
            Reports
          </Button>
        </div>
      }
    >
      {max === 0 ? (
        <Empty icon="mail" title="Nothing delivered in the last 30 days" hint="Delivered mail and human opens show here week by week once a campaign has sent." />
      ) : asTable ? (
        <Table
          label="Email delivery by week"
          head={
            <tr>
              <th className={TH}>Week of</th>
              <th className={cx(TH, 'text-right')}>Delivered</th>
              <th className={cx(TH, 'text-right')}>Human opens</th>
              <th className={cx(TH, 'text-right')}>Open rate</th>
            </tr>
          }
        >
          {weekly.map((w, i) => (
            <tr key={`${w.week}-${i}`}>
              <td className={TD}>{weekLabel(w.week)}</td>
              <td className={cx(TD, 'text-right')}>
                <Mono>{count(w.delivered)}</Mono>
              </td>
              <td className={cx(TD, 'text-right')}>
                <Mono>{count(w.human_opens)}</Mono>
              </td>
              <td className={cx(TD, 'text-right')}>
                <Mono>{share(w.human_opens, w.delivered)}</Mono>
              </td>
            </tr>
          ))}
        </Table>
      ) : (
        <figure className="m-0">
          <div role="img" aria-label={weeklySummary(weekly)} className="flex h-[168px] items-end gap-1.5 border-b border-line sm:gap-2">
            {weekly.map((w, i) => {
              const opened = ratio(Math.min(w.human_opens, w.delivered), w.delivered);
              return (
                <div key={`${w.week}-${i}`} title={`Week of ${weekLabel(w.week)} · ${count(w.delivered)} delivered · ${count(w.human_opens)} human opens`} className="flex h-full min-w-0 flex-1 items-end justify-center">
                  {w.delivered > 0 ? (
                    <div className="flex w-full max-w-[24px] flex-col overflow-hidden rounded-t-[4px]" style={{ height: `max(2px, ${ratio(w.delivered, max)}%)` }}>
                      <div className="min-h-0 flex-1 bg-primary" />
                      {opened > 0 ? <div className={cx('shrink-0 bg-primary/40 dark:bg-primary/55', opened < 100 && 'border-t-2 border-surface')} style={{ height: `${opened}%` }} /> : null}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
          <div aria-hidden className="mt-1 flex gap-1.5 sm:gap-2">
            {weekly.map((w, i) => (
              <span key={`${w.week}-${i}`} className="min-w-0 flex-1 truncate text-center text-[10.5px] text-ink-3 tabular-nums">
                {!sparse || (weekly.length - 1 - i) % 2 === 0 ? weekLabel(w.week) : ''}
              </span>
            ))}
          </div>
          <figcaption className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11.5px] text-ink-2">
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-[3px] bg-primary" /> Delivered
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-[3px] bg-primary/40 dark:bg-primary/55" /> Human opens
            </span>
            {last ? (
              <span className="text-ink-3 sm:ml-auto">
                Latest week · {count(last.delivered)} delivered · {count(last.human_opens)} human opens ({share(last.human_opens, last.delivered)})
              </span>
            ) : null}
          </figcaption>
        </figure>
      )}
    </Panel>
  );
}

function Recent({ rows }: { rows: Campaign[] }) {
  const { go } = useTab();
  return (
    <Panel title="Recent email campaigns" action={<LinkButton onClick={() => go('/marketing/campaigns')}>All campaigns</LinkButton>} className="overflow-hidden" bodyClassName="px-0 pb-0">
      {rows.length === 0 ? (
        <Empty icon="mail" title="No email campaigns yet" hint="Start one with New campaign. Drafts, scheduled sends and their results show here." />
      ) : (
        <Table
          label="Recent email campaigns"
          className="!rounded-none !border-x-0 !border-b-0"
          head={
            <tr>
              <th className={TH}>Campaign</th>
              <th className={TH}>Status</th>
              <th className={cx(TH, 'text-right')}>Recipients</th>
              <th className={cx(TH, 'text-right')}>Opens</th>
              <th className={cx(TH, 'text-right')}>Clicks</th>
            </tr>
          }
        >
          {rows.map((c) => {
            const s = campaignChip(c);
            // Rates once the send is finished; a send in progress has no honest rate yet.
            const done = c.status === 'sent';
            const open = () => go(campaignRoute(c));
            return (
              <tr key={c.id} onClick={open} className="cursor-pointer hover:bg-subtle/60">
                <td className={TD}>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      open();
                    }}
                    className="max-w-[300px] truncate text-left font-semibold text-ink hover:underline"
                  >
                    {c.name}
                  </button>
                </td>
                <td className={TD}>
                  <Status tone={s.tone}>{s.label}</Status>
                </td>
                <td className={cx(TD, 'text-right')}>
                  <Mono>{count(c.recipients_count)}</Mono>
                </td>
                <td className={cx(TD, 'text-right')}>
                  <Mono>{done ? share(c.human_opens, c.delivered_count) : '—'}</Mono>
                </td>
                <td className={cx(TD, 'text-right')}>
                  <Mono>{done ? share(c.clicks, c.delivered_count) : '—'}</Mono>
                </td>
              </tr>
            );
          })}
        </Table>
      )}
    </Panel>
  );
}

function Calls({ calls }: { calls: Summary['calls'] }) {
  const { go } = useTab();
  const rows: Array<[string, number]> = [
    ['In queue', calls.in_queue],
    ['Claimed now', calls.claimed_now],
    ['Callbacks due today', calls.callbacks_due_today],
    ['Reached (30 d)', calls.reached_30d],
    ['Interested → CRM lead', calls.interested_30d],
  ];
  return (
    <Panel title="Calls" action={<LinkButton onClick={() => go('/marketing/queue')}>Open queue</LinkButton>}>
      {rows.map(([label, n]) => (
        <Row key={label} label={label}>
          <Mono>{count(n)}</Mono>
        </Row>
      ))}
    </Panel>
  );
}

function Coverage({ consent }: { consent: Summary['consent'] }) {
  const rows = [
    { label: 'Email consent recorded', n: consent.email_recorded, tone: 'primary' },
    { label: 'Phone consent recorded', n: consent.phone_recorded, tone: 'violet' },
    { label: 'Suppressed (email)', n: consent.suppressed_email, tone: 'warning' },
    { label: 'Do-not-call', n: consent.do_not_call, tone: 'danger' },
  ] as const;
  return (
    <Panel title="Consent coverage" sub={`Of ${plural(consent.total, 'contact')}`}>
      <ul className="flex flex-col gap-2.5">
        {rows.map((r) => (
          <li key={r.label} className="flex flex-col gap-1" title={`${share(r.n, consent.total)} of contacts`}>
            <div className="flex items-center justify-between gap-3 text-[12.5px]">
              <span className="min-w-0 text-ink-2">{r.label}</span>
              <Mono className="font-medium text-ink">{count(r.n)}</Mono>
            </div>
            <Bar value={ratio(r.n, consent.total)} tone={r.tone} />
          </li>
        ))}
      </ul>
    </Panel>
  );
}
