import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { apiGet } from '../../core/api';
import { call, errorMessage } from '../../core/bridge';
import { useTab } from '../../core/tab-context';
import { dateLabel } from '../../core/time';
import { toast } from '../../core/toasts';
import { Icon } from '../../components/Icon';
import { cx, Spinner } from '../../components/ui';
import { withOrg } from './api';
import { Refused, TABLE, TD, TH } from './audience-parts';
import { btn, btnPrimary, CAMPAIGN_PILL, Card, CardLink, Kpi, Line, Meter, n, PageHeader, Panel, pct, Pill, Seg } from './parts';
import type { Go } from './routes';
import type { Campaign, DashboardWide, Options, Readiness, ReadinessItem } from './types';

const PERIODS = [7, 30, 90] as const;
type Period = (typeof PERIODS)[number];

/**
 * The first screen (DK01, the web's W01; MKT-DSH-01, MKT-DSH-02): the
 * audience, what email and calls are doing, and — until the module is live —
 * what still stands between the company and its first send.
 *
 * "May be emailed" is the server's one definition — an address, consent
 * granted, and not suppressed — the same one the contact list's filter and a
 * segment's rule read, so the three cannot disagree. The open rate is the
 * HUMAN open rate: what Apple's proxy, Gmail's cache and link scanners
 * fetched is kept out of every rate.
 *
 * Every figure a server a part behind does not send is left off rather than
 * shown as nought: a tile that reads 0 for something not counted yet reads as
 * a failure.
 */
export default function Dashboard({ org, options, onGo }: { org: string; options: Options; onGo: (g: Go) => void }) {
  const { go } = useTab();
  const [days, setDays] = useState<Period>(30);
  const q = useQuery({
    queryKey: ['marketing', 'dashboard', org, days],
    queryFn: ({ signal }) => apiGet<DashboardWide>('/api/marketing/dashboard', withOrg(org, { days }), signal),
  });
  const companies = options.companies;
  const names = companies.map((c) => c.name).filter(Boolean);
  const may = (k: 'import' | 'campaign_create') => companies.some((c) => Boolean(c.can[k]));
  const d = q.data;

  const header = (
    <PageHeader
      title="Dashboard"
      sub={`Audience, email and call activity${names.length === 1 ? ` for ${names[0]}` : ''} · last ${d?.days ?? days} days`}
      actions={
        <>
          <Seg<Period> label="Period" value={days} onChange={setDays} options={PERIODS.map((p) => ({ id: p, label: `${p} days` }))} />
          {may('import') ? (
            <button type="button" className={btn} onClick={() => onGo({ view: 'import' })}>
              <Icon name="upload" size={15} /> Import contacts
            </button>
          ) : null}
          {may('campaign_create') ? (
            <button type="button" className={btnPrimary} onClick={() => go('/marketing?view=campaigns&new=1')}>
              <Icon name="plus" size={15} /> New campaign
            </button>
          ) : null}
        </>
      }
    />
  );

  if (q.isLoading) {
    return (
      <div className="flex flex-col">
        {header}
        <Spinner label="Loading the dashboard…" />
      </div>
    );
  }
  if (!d) {
    return (
      <div className="flex flex-col">
        {header}
        <Refused error={q.error} fallback="The dashboard could not be loaded." onRetry={() => void q.refetch()} />
      </div>
    );
  }

  const t = d.totals;
  const share = t.contacts > 0 ? Math.round((t.subscribed / t.contacts) * 1000) / 10 : 0;
  const guardHit = d.email?.bounce_rate != null && d.email.bounce_rate >= d.email.bounce_guard;

  return (
    <div className="flex flex-col gap-4">
      {header}

      {d.readiness ? <ReadinessCard readiness={d.readiness} onRoute={go} /> : null}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="Contacts" value={n(t.contacts)} sub={<span className="text-success">+{n(t.new)} in {d.days} days</span>} onClick={() => onGo({ view: 'contacts' })} />
        <Kpi label="May be emailed" value={n(t.subscribed)} sub={`${share}% of contacts: consent given, not suppressed`} onClick={() => onGo({ view: 'contacts', filter: { subscribed: 'yes' } })} />
        {d.email ? (
          <>
            <Kpi label="Human open rate" value={pct(d.email.human_open_rate)} sub="Proxy and scanner opens left out" />
            <Kpi label="Bounce rate" value={pct(d.email.bounce_rate)} tone={guardHit ? 'red' : undefined} sub={<span className={guardHit ? 'text-danger' : undefined}>The guard pauses a campaign at {d.email.bounce_guard}%</span>} />
          </>
        ) : (
          <>
            <Kpi label="Qualified" value={n(t.qualified)} sub="Ready to hand to sales" onClick={() => onGo({ view: 'contacts', filter: { status: 'qualified' } })} />
            <Kpi label="Suppressed" value={n(t.suppressed)} tone={t.suppressed > 0 ? 'red' : undefined} sub="Never to be contacted" onClick={() => onGo({ view: 'consent' })} />
          </>
        )}
      </div>

      {d.email || d.calls ? (
        <div className="grid items-start gap-4 lg:grid-cols-3">
          {d.email ? (
            <Card className={d.calls ? 'lg:col-span-2' : 'lg:col-span-3'} title="Email delivery · weekly" action={<CardLink onClick={() => onGo({ view: 'reports' })}>Reports</CardLink>}>
              <Weekly weeks={d.email.weekly} />
            </Card>
          ) : null}
          {d.calls ? (
            <Card title="Calls" action={<CardLink onClick={() => onGo({ view: 'queue' })}>Open queue</CardLink>}>
              <Line label="In queue">{n(d.calls.in_queue)}</Line>
              <Line label="Claimed now">{n(d.calls.claimed_now)}</Line>
              <Line label="Callbacks due today">{n(d.calls.callbacks_today)}</Line>
              <Line label={`Reached (${d.days} d)`}>{n(d.calls.reached)}</Line>
              <Line label="Interested → CRM lead">{n(d.calls.interested_to_crm)}</Line>
            </Card>
          ) : null}
        </div>
      ) : null}

      {d.campaigns || d.consent ? (
        <div className="grid items-start gap-4 lg:grid-cols-3">
          {d.campaigns ? (
            <Card className={d.consent ? 'lg:col-span-2' : 'lg:col-span-3'} title="Recent email campaigns" padded={false} action={<CardLink onClick={() => onGo({ view: 'campaigns' })}>All campaigns</CardLink>}>
              <RecentCampaigns rows={d.campaigns.recent} onOpen={(id) => onGo({ view: 'campaign', id })} canCreate={may('campaign_create')} />
            </Card>
          ) : null}
          {d.consent ? (
            <Card title="Consent coverage">
              <div className="flex flex-col gap-3 text-[13px]">
                <Coverage label="Email consent recorded" value={d.consent.email_granted} of={d.consent.contacts} tone="blue" />
                <Coverage label="Phone consent recorded" value={d.consent.phone_granted} of={d.consent.contacts} tone="violet" />
                <Coverage label="Suppressed (email)" value={d.consent.email_suppressed} of={d.consent.contacts} tone="amber" />
                <Coverage label="Do-not-call" value={d.consent.do_not_call} of={d.consent.contacts} tone="red" />
              </div>
            </Card>
          ) : null}
        </div>
      ) : null}

      <div className="grid items-start gap-4 lg:grid-cols-3">
        <Panel title="By status">
          <Bars empty="No contacts yet." rows={d.statuses.map((s) => ({ key: s.key, label: s.label, value: s.contacts, onClick: () => onGo({ view: 'contacts', filter: { status: s.key } }) }))} />
        </Panel>
        <Panel title="Where they came from">
          <Bars empty="No contacts yet." rows={d.sources.map((s) => ({ key: s.key, label: s.label, value: s.contacts, onClick: () => onGo({ view: 'contacts', filter: { source: s.key } }) }))} />
        </Panel>
        <Panel title="Latest imports" action={may('import') ? <CardLink onClick={() => onGo({ view: 'import' })}>Import</CardLink> : undefined}>
          {d.recent_imports.length === 0 ? (
            <div className="px-3.5 py-5 text-center text-[12.5px] text-ink-3">
              <p className="m-0 font-semibold text-ink">No spreadsheet imported yet.</p>
              <p className="m-0 mt-1">Bring contacts in from a CSV: duplicates, consent and suppression are checked before anything is written.</p>
            </div>
          ) : (
            <ul className="m-0 list-none p-0">
              {d.recent_imports.map((i) => (
                <li key={i.id} className="border-b border-line/70 px-3.5 py-2 text-[12px] last:border-b-0">
                  <p className="m-0 truncate font-semibold text-ink">{i.file_name}</p>
                  <p className="m-0 text-ink-3">
                    {n(i.created)} added · {n(i.updated)} updated · {dateLabel(i.created_at)}
                    {i.status === 'failed' ? <span className="ml-1 font-semibold text-danger">· stopped part way</span> : null}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </div>
  );
}

/** The checks that stop mail going at all (red); the rest narrow what can be done (amber). */
const BLOCKING = new Set(['app_enabled', 'send_cron', 'mail_route', 'sending_domain', 'footer_address']);

/**
 * Where a Fix link goes. Marketing's own pages open in this tab; anything else
 * on the server (the Admin Centre's apps, the mail relay, roles) is the web
 * client's, so it opens in the browser; a full address opens as itself.
 */
export function followFix(href: string, onRoute: (route: string) => void): void {
  if (/^https?:\/\//i.test(href)) {
    void call('app:openExternal', { url: href }).catch((e) => toast('error', errorMessage(e)));
  } else if (/^\/marketing(\/|\?|$)/.test(href)) {
    onRoute(href);
  } else {
    void call('app:openInBrowser', { path: href.startsWith('/') ? href : `/${href}` }).catch((e) => toast('error', errorMessage(e)));
  }
}

/**
 * What stands between the company and a safe first send (MKT-DSH-02): each
 * item the server checked, who owns it, and where it is fixed. Once every one
 * passes the card shrinks to a line, and stays as a line: a route deleted or a
 * domain that stops verifying brings it back.
 */
function ReadinessCard({ readiness, onRoute }: { readiness: Readiness; onRoute: (route: string) => void }) {
  const open = readiness.items.filter((i) => !i.ok);
  if (open.length === 0) {
    return (
      <p role="status" className="m-0 flex items-center gap-2 rounded-[12px] border border-success/30 bg-success-bg px-4 py-2.5 text-[13px] font-semibold text-success">
        <Icon name="check-circle" size={18} />
        Ready to send: every go-live check passes.
      </p>
    );
  }
  return (
    <Card tone="danger">
      <div className="flex flex-wrap items-start gap-3.5">
        <Icon name="warning" size={22} className="shrink-0 text-danger" />
        <div className="min-w-0 flex-[1_1_360px]">
          <h2 className="m-0 text-[15px] font-bold text-ink">
            Go-live readiness · {open.length} {open.length === 1 ? 'item' : 'items'} open
          </h2>
          <p className="m-0 mt-0.5 text-[12.5px] text-ink-3">Sending stays blocked until the red items are cleared. Each is checked again every time this screen loads.</p>
          <ul aria-label="Go-live checks" className="m-0 mt-2 list-none p-0">
            {readiness.items.map((i) => (
              <ReadinessRow key={i.key} item={i} onRoute={onRoute} />
            ))}
          </ul>
        </div>
      </div>
    </Card>
  );
}

function ReadinessRow({ item: i, onRoute }: { item: ReadinessItem; onRoute: (route: string) => void }) {
  const blocking = BLOCKING.has(i.key);
  return (
    <li className="flex items-start gap-2.5 border-b border-line/70 py-2.5 last:border-b-0">
      {i.ok ? (
        <Icon name="check-circle" size={18} className="mt-0.5 shrink-0 text-success" />
      ) : (
        <Icon name="warning" size={18} className={cx('mt-0.5 shrink-0', blocking ? 'text-danger' : 'text-[#B45309] dark:text-warning')} />
      )}
      <span className="sr-only">{i.ok ? 'Done:' : blocking ? 'Blocks sending:' : 'Open:'}</span>
      <div className="min-w-0 flex-1">
        <p className={cx('m-0 text-[13px]', i.ok ? 'text-ink-3' : 'font-semibold text-ink')}>{i.title}</p>
        <p className="m-0 text-[12px] text-ink-3">
          {i.detail} · {i.owner}
        </p>
      </div>
      {!i.ok && i.fix ? (
        <button type="button" onClick={() => followFix(i.fix!.href, onRoute)} className="shrink-0 text-[12.5px] font-bold whitespace-nowrap text-primary hover:underline" aria-label={`${i.fix.label}: ${i.title}`}>
          {i.fix.label}
        </button>
      ) : null}
    </li>
  );
}

/**
 * Delivered copies by week, with the human opens inside them: one hue, the
 * opens a lighter step of it, a 2px gap between the two, a legend, a tooltip
 * on each week, and the same figures as a table for a screen reader.
 */
function Weekly({ weeks }: { weeks: Array<{ week: string; delivered: number; human_opens: number }> }) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(1, ...weeks.map((w) => w.delivered));
  if (weeks.length === 0 || weeks.every((w) => w.delivered === 0)) {
    return <p className="m-0 py-8 text-center text-[12.5px] text-ink-3">Nothing delivered yet. Weekly deliveries appear here once a campaign has gone.</p>;
  }
  const shown = hover === null ? null : weeks[hover];
  return (
    <figure className="m-0">
      <div className="relative">
        <div className="flex h-44 items-end gap-2" aria-hidden="true">
          {weeks.map((w, i) => {
            const opens = Math.min(w.human_opens, w.delivered);
            return (
              <div key={w.week} className="flex h-full min-w-0 flex-1 cursor-default flex-col justify-end" onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
                <div className={cx('flex w-full flex-col justify-end gap-[2px] overflow-hidden rounded-t-[4px]', hover === i && 'brightness-110')} style={{ height: `${(w.delivered / max) * 100}%` }}>
                  <div className="w-full min-h-0 flex-1 bg-primary" />
                  {opens > 0 ? <div className="w-full shrink-0 bg-primary/40" style={{ height: `${(opens / w.delivered) * 100}%` }} /> : null}
                </div>
              </div>
            );
          })}
        </div>
        {shown ? (
          <div className="pointer-events-none absolute top-0 right-0 rounded-[8px] border border-line bg-surface px-2.5 py-1.5 text-[12px] shadow-[0_6px_18px_rgb(var(--ws-shadow-rgb)/.16)]">
            <b className="block text-ink">Week of {dateLabel(shown.week)}</b>
            <span className="text-ink-2">
              {n(shown.delivered)} delivered · {n(shown.human_opens)} human opens
            </span>
          </div>
        ) : null}
      </div>
      <div className="mt-1 flex justify-between text-[11px] text-ink-3" aria-hidden="true">
        <span>{dateLabel(weeks[0]!.week)}</span>
        <span>{dateLabel(weeks[weeks.length - 1]!.week)}</span>
      </div>
      <figcaption className="mt-2 flex gap-4 text-[11.5px] text-ink-2">
        <span className="flex items-center gap-1.5">
          <span aria-hidden="true" className="size-2.5 rounded-[3px] bg-primary" />
          Delivered
        </span>
        <span className="flex items-center gap-1.5">
          <span aria-hidden="true" className="size-2.5 rounded-[3px] bg-primary/40" />
          Human opens
        </span>
      </figcaption>
      <table className="sr-only">
        <caption>Delivered copies and human opens by week</caption>
        <thead>
          <tr>
            <th scope="col">Week of</th>
            <th scope="col">Delivered</th>
            <th scope="col">Human opens</th>
          </tr>
        </thead>
        <tbody>
          {weeks.map((w) => (
            <tr key={w.week}>
              <td>{dateLabel(w.week)}</td>
              <td>{n(w.delivered)}</td>
              <td>{n(w.human_opens)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}

function RecentCampaigns({ rows, onOpen, canCreate }: { rows: Campaign[]; onOpen: (id: number) => void; canCreate: boolean }) {
  if (rows.length === 0) {
    return <p className="m-0 px-4 pb-5 text-[12.5px] text-ink-3">No email campaigns yet.{canCreate ? ' Start one with New campaign.' : ''}</p>;
  }
  return (
    <div className="overflow-x-auto scroll-thin">
      <table className={cx(TABLE, 'min-w-[34rem]')}>
        <thead>
          <tr>
            <th scope="col" className={cx(TH, 'pl-4')}>
              Campaign
            </th>
            <th scope="col" className={TH}>
              Status
            </th>
            <th scope="col" className={cx(TH, 'text-right')}>
              Recipients
            </th>
            <th scope="col" className={cx(TH, 'text-right')}>
              Opens
            </th>
            <th scope="col" className={cx(TH, 'pr-4 text-right')}>
              Clicks
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((c) => {
            const reached = c.stats ? c.stats.sent - c.stats.bounced : 0;
            const rate = (part: number) => (c.stats && reached > 0 ? `${Math.round((part / reached) * 1000) / 10}%` : '—');
            return (
              <tr key={c.id} className="cursor-pointer hover:bg-subtle" onClick={() => onOpen(c.id)}>
                <td className={cx(TD, 'pl-4')}>
                  <button type="button" onClick={(e) => (e.stopPropagation(), onOpen(c.id))} className="text-left font-semibold text-ink hover:underline">
                    {c.name}
                  </button>
                  {c.ab ? <span className="ml-1.5 rounded-[4px] bg-[#F1EAFB] px-1 text-[10px] font-bold text-[#5B2FA0] dark:bg-[#2A1F45] dark:text-[#C4A8F0]">A/B</span> : null}
                </td>
                <td className={TD}>
                  <Pill tone={CAMPAIGN_PILL[c.status]}>{c.status_label}</Pill>
                </td>
                <td className={cx(TD, 'text-right tabular-nums')}>{n(c.recipients || c.stats?.recipients)}</td>
                {/* Human opens where the server counts them, like every rate on this screen; all opens from a server a part behind. */}
                <td className={cx(TD, 'text-right tabular-nums')}>{rate(c.stats?.human ?? c.stats?.opened ?? 0)}</td>
                <td className={cx(TD, 'pr-4 text-right tabular-nums')}>{rate(c.stats?.clicked ?? 0)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function Coverage({ label, value, of, tone }: { label: string; value: number; of: number; tone: 'blue' | 'violet' | 'amber' | 'red' }) {
  return (
    <div>
      <div className="mb-1 flex justify-between gap-2">
        <span className="text-ink-2">{label}</span>
        <span className="text-ink tabular-nums">{n(value)}</span>
      </div>
      <Meter value={value} max={of} tone={tone} label={label} />
    </div>
  );
}

/** A count per kind as bars, each a way into the contacts it counts. */
function Bars({ rows, empty }: { rows: Array<{ key: string; label: string; value: number; onClick: () => void }>; empty: string }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  if (rows.length === 0) return <p className="m-0 px-3.5 py-5 text-center text-[12.5px] text-ink-3">{empty}</p>;
  return (
    <ul className="m-0 list-none p-0">
      {rows.map((r) => (
        <li key={r.key}>
          <button type="button" onClick={r.onClick} className="flex w-full flex-col gap-1 px-3.5 py-2 text-left text-[12.5px] hover:bg-subtle" aria-label={`${r.label}: ${n(r.value)} contacts`}>
            <span className="flex justify-between gap-2">
              <span className="truncate text-ink">{r.label}</span>
              <span className="text-ink-2 tabular-nums">{n(r.value)}</span>
            </span>
            <span aria-hidden="true" className="block h-1.5 w-full overflow-hidden rounded-full bg-subtle">
              <span className="block h-full rounded-full bg-primary" style={{ width: `${(r.value / max) * 100}%` }} />
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}
