/**
 * W01 Overview (WS-SMM-SRS-001 p.42, design Main): what is going out, what needs attention and how the last week went —
 * the attention banner (SMM-ACC-005), the week's KPIs, Coming up (SMM-SCH-003), account health, Waiting for you
 * (SMM-INB-008) and the week's top posts (SMM-ANL-002). Everything follows the header's brand scope; each panel says
 * on its own when the server does not offer its data.
 */
import { useMemo, useState } from 'react';
import { Button } from '../../../components/ui';
import { Icon } from '../../../components/Icon';
import { useTab } from '../../../core/tab-context';
import { parseTs } from '../../../core/time';
import {
  dataOf,
  postNetworks,
  postWhen,
  rowsOf,
  useAccounts,
  useModuleStatus,
  useOverview,
  usePostPerformance,
  usePosts,
  type Account,
  type AnalyticsOverview,
  type ModuleStatus,
  type Post,
} from '../api';
import { useSocialAccess } from '../access';
import { AccountLabel, AccountStatusPill, compact, delta, full, Kpi, NetChip, NetChips, Notice, NotOffered, OptionalView, PageBody, PageHeader, Panel, PanelLink, PostStatusPill, Table, TD, TR, useBrandScope } from '../parts';
import { networkInfo } from '../lib/networks';
import { accountStatusLabel, needsAttention } from '../lib/status';
import { excerpt } from '../lib/text';
import { addDays, inZone, todayInZone, weekStart, whenLabel, zonedToUtc } from '../lib/time';
import { StatGrid } from '../../../components/StatCard';

/** What the module status may add for the Open inbox tile (proposed: not in the status contract yet). */
type StatusCounts = ModuleStatus['counts'] & { inbox_past_target?: number | null };

interface Span {
  now: string;
  today: string;
  in7: string;
  ago7: string;
  weekFrom: string;
  weekTo: string;
  /** Analytics days, YYYY-MM-DD: the last 7 and the 7 before them. */
  d14: string;
  d7: string;
  d0: string;
}

function makeSpan(): Span {
  const now = new Date();
  const today = todayInZone();
  const monday = weekStart(today);
  return {
    now: now.toISOString(),
    today,
    in7: new Date(now.getTime() + 7 * 86_400_000).toISOString(),
    ago7: new Date(now.getTime() - 7 * 86_400_000).toISOString(),
    weekFrom: zonedToUtc(monday, 0),
    weekTo: zonedToUtc(addDays(monday, 7), 0),
    d14: addDays(today, -13),
    d7: addDays(today, -6),
    d0: today,
  };
}

const inScope = (brand: number | null) => (x: { brand_id: number | null }) => brand === null || x.brand_id === brand;

export default function Overview() {
  const { go } = useTab();
  const statusQ = useModuleStatus();
  const status = dataOf(statusQ.data);
  const access = useSocialAccess(status?.permissions);
  const [brand] = useBrandScope();
  const [w] = useState(makeSpan);

  const accountsQ = useAccounts();
  const accounts = rowsOf(accountsQ.data).filter(inScope(brand));
  const attention = accounts.filter((a) => needsAttention(a.status));

  return (
    <>
      <PageHeader
        crumb="Overview"
        title="Overview"
        actions={
          <>
            <Button size="sm" icon="calendar" onClick={() => go(`/social-media/calendar?view=week&date=${w.today}`)}>
              This week
            </Button>
            {access.create ? (
              <Button size="sm" variant="primary" icon="plus" onClick={() => go('/social-media/compose')}>
                Create post
              </Button>
            ) : null}
          </>
        }
      />
      <PageBody>
        <div className="mx-auto flex max-w-[1240px] flex-col gap-4">
          {attention.length ? <AttentionBanner accounts={attention} onReview={() => go('/social-media/accounts')} /> : null}
          <KpiRow brand={brand} w={w} status={statusQ.data?.offered === false ? null : status} />
          <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
            <ComingUp brand={brand} w={w} />
            <div className="flex min-w-0 flex-col gap-4">
              <Panel title="Account health" action={accounts.length ? <PanelLink onClick={() => go('/social-media/accounts')}>All {accounts.length}</PanelLink> : null}>
                <OptionalView q={accountsQ} what="Accounts" compact>
                  {() => <AccountHealth accounts={accounts} onOpen={() => go('/social-media/accounts')} />}
                </OptionalView>
              </Panel>
              <Panel title="Waiting for you">
                <OptionalView q={statusQ} what="Your to-do counts" compact>
                  {(s) => <Waiting counts={s.counts} access={access} />}
                </OptionalView>
              </Panel>
            </div>
          </div>
          <TopPosts brand={brand} w={w} />
        </div>
      </PageBody>
    </>
  );
}

/* ------------------------------------------------------------------------ */

/** "X @techhubiz needs to be reconnected — 1 post is on hold." */
function attentionLine(a: Account): string {
  const who = `${networkInfo(a.network).label} ${a.handle?.startsWith('@') ? a.handle : a.display_name}`;
  const held = a.held_posts ? ` — ${a.held_posts} ${a.held_posts === 1 ? 'post is' : 'posts are'} on hold` : '';
  switch (a.status) {
    case 'needs_reconnect':
      return `${who} needs to be reconnected${held}.`;
    case 'expiring':
      return `${who} access ${accountStatusLabel(a.status, a.token_expires_at).toLowerCase()}${held}.`;
    case 'limited':
      return `${who} is limited${a.missing?.length ? ` (${a.missing.join(', ')} not granted)` : ''}${held}.`;
    default:
      return `${who} has an error${a.last_error_message ? `: ${a.last_error_message}` : ''}${held}.`;
  }
}

function AttentionBanner({ accounts, onReview }: { accounts: Account[]; onReview: () => void }) {
  return (
    <Notice
      tone="warning"
      icon="warning"
      action={
        <Button size="sm" onClick={onReview}>
          Review accounts
        </Button>
      }
    >
      <b>
        {accounts.length} {accounts.length === 1 ? 'account needs' : 'accounts need'} attention.
      </b>{' '}
      {accounts.map(attentionLine).join(' ')}
    </Notice>
  );
}

/* ------------------------------------------------------------------------ */

const isPublished = (p: Post) => p.status === 'published' || p.status === 'partly_published';

const ms = (stamp: string) => parseTs(stamp).getTime();

function within(p: Post, from: string, to: string): boolean {
  const at = postWhen(p);
  return !!at && ms(at) >= ms(from) && ms(at) < ms(to);
}

function sumEngagements(series: AnalyticsOverview['series'], from: string, to: string): number | null {
  const days = series.filter((s) => s.date >= from && s.date <= to);
  if (!days.length || days.some((d) => d.engagements === null)) return null;
  return days.reduce((n, d) => n + (d.engagements ?? 0), 0);
}

function KpiRow({ brand, w, status }: { brand: number | null; w: Span; status: ModuleStatus | null }) {
  const weekQ = usePosts({ from: w.weekFrom, to: w.weekTo, brand_id: brand });
  const lastQ = usePosts({ from: w.ago7, to: w.now, brand_id: brand });
  const overviewQ = useOverview({ from: w.d14, to: w.d0, brand_id: brand });

  const week = rowsOf(weekQ.data).filter((p) => within(p, w.weekFrom, w.weekTo));
  const last = rowsOf(lastQ.data).filter((p) => within(p, w.ago7, w.now));
  const ov = dataOf(overviewQ.data);
  const prevTo = addDays(w.d7, -1);
  const eng = ov ? sumEngagements(ov.series, w.d7, w.d0) : null;
  const prior = ov ? sumEngagements(ov.series, w.d14, prevTo) : null;
  const change = eng !== null && prior ? ((eng - prior) / prior) * 100 : null;
  const counts = status?.counts as StatusCounts | undefined;

  const off = (what: string) => <NotOffered what={what} compact />;
  return (
    <StatGrid>
      {weekQ.data?.offered === false ? (
        off('Scheduled this week')
      ) : (
        <Kpi
          icon="calendar-clock"
          accent="blue"
          label="Scheduled this week"
          value={weekQ.data ? full(week.filter((p) => p.status !== 'draft' && p.status !== 'cancelled').length) : '…'}
          sub={week.some((p) => p.status === 'in_review') ? `${week.filter((p) => p.status === 'in_review').length} in review` : undefined}
          tone="warning"
        />
      )}
      {lastQ.data?.offered === false ? (
        off('Published · last 7 days')
      ) : (
        <Kpi
          icon="send"
          accent="green"
          label="Published · last 7 days"
          value={lastQ.data ? full(last.filter(isPublished).length) : '…'}
          sub={last.some((p) => p.status === 'failed') ? `${last.filter((p) => p.status === 'failed').length} failed` : undefined}
          tone="danger"
        />
      )}
      {overviewQ.data?.offered === false ? (
        off('Engagements · last 7 days')
      ) : (
        <Kpi icon="heart" accent="violet" label="Engagements · last 7 days" value={overviewQ.data ? (eng === null ? null : full(eng)) : '…'} sub={change !== null ? `${delta(change)} vs prior week` : undefined} tone={change !== null && change < 0 ? 'danger' : 'success'} />
      )}
      {!status ? (
        off('Open inbox items')
      ) : (
        <Kpi icon="inbox" accent="amber" label="Open inbox items" value={full(status.counts.inbox_open)} sub={counts?.inbox_past_target ? `${counts.inbox_past_target} past reply target` : undefined} tone="danger" />
      )}
    </StatGrid>
  );
}

/* ------------------------------------------------------------------------ */

function ComingUp({ brand, w }: { brand: number | null; w: Span }) {
  const { go } = useTab();
  const q = usePosts({ from: w.now, to: w.in7, brand_id: brand });
  return (
    <Panel title="Coming up" action={<PanelLink onClick={() => go('/social-media/calendar')}>Open calendar</PanelLink>}>
      <OptionalView q={q} what="Upcoming posts" compact>
        {(rows) => <ComingUpRows posts={rows} w={w} />}
      </OptionalView>
    </Panel>
  );
}

function ComingUpRows({ posts, w }: { posts: Post[]; w: Span }) {
  const { go } = useTab();
  const rows = useMemo(
    () =>
      posts
        .map((p) => ({ p, at: postWhen(p) }))
        .filter((x): x is { p: Post; at: string } => !!x.at && within(x.p, w.now, w.in7))
        .sort((a, b) => ms(a.at) - ms(b.at))
        .slice(0, 8),
    [posts, w],
  );
  if (!rows.length) return <p className="py-3 text-[13px] text-ink-3">Nothing is planned for the next 7 days.</p>;
  return (
    <ul aria-label="Coming up" className="flex flex-col">
      {rows.map(({ p, at }) => (
        <li key={p.id} className="border-b border-line/70 last:border-b-0">
          <button type="button" onClick={() => go(`/social-media/posts/${p.id}`)} className="flex w-full min-w-0 items-center gap-3 rounded-[8px] px-1 py-2.5 text-left hover:bg-subtle">
            <span className="w-[92px] shrink-0 font-mono text-[12px] text-ink-2 tabular-nums">{whenLabel(at, undefined, w.today)}</span>
            <NetChips networks={postNetworks(p)} size={20} max={3} />
            <span className="min-w-0 flex-1 truncate text-[13px] text-ink">{excerpt(p.base_text, 120)}</span>
            {p.owner ? <span className="hidden w-[90px] shrink-0 truncate text-[12px] text-ink-3 md:block">{p.owner.name}</span> : null}
            <PostStatusPill status={p.status} />
          </button>
        </li>
      ))}
    </ul>
  );
}

/* ------------------------------------------------------------------------ */

function AccountHealth({ accounts, onOpen }: { accounts: Account[]; onOpen: () => void }) {
  if (!accounts.length) return <p className="py-2 text-[13px] text-ink-3">No accounts are connected yet.</p>;
  return (
    <ul className="flex flex-col">
      {accounts.slice(0, 6).map((a) => (
        <li key={a.id}>
          <button type="button" onClick={onOpen} className="flex w-full min-w-0 items-center justify-between gap-2 rounded-[8px] px-1 py-2 text-left hover:bg-subtle">
            <AccountLabel account={a} size={22} sub={networkInfo(a.network).accountNoun} />
            <AccountStatusPill account={a} />
          </button>
        </li>
      ))}
    </ul>
  );
}

function Waiting({ counts, access }: { counts: ModuleStatus['counts']; access: ReturnType<typeof useSocialAccess> }) {
  const { go } = useTab();
  const rows: Array<{ label: string; n: number; to: string; danger?: boolean; show: boolean }> = [
    { label: 'Posts to approve', n: counts.approvals_waiting, to: '/social-media/approvals', show: access.approve },
    { label: 'Messages assigned to you', n: counts.inbox_assigned_to_me, to: '/social-media/inbox?view=mine', show: access.inbox },
    { label: 'Failed publish', n: counts.failed_7d, to: '/social-media/log?outcome=failed', danger: true, show: access.audit || access.publish },
  ];
  const shown = rows.filter((r) => r.show);
  if (!shown.length) return <p className="py-2 text-[13px] text-ink-3">Nothing waits for you.</p>;
  return (
    <ul className="flex flex-col gap-2">
      {shown.map((r) => (
        <li key={r.label}>
          <button
            type="button"
            onClick={() => go(r.to)}
            className={
              r.danger && r.n
                ? 'flex h-9 w-full items-center justify-between rounded-[8px] border border-danger/40 bg-danger-bg px-3 text-[13px] text-danger hover:border-danger'
                : 'flex h-9 w-full items-center justify-between rounded-[8px] border border-line px-3 text-[13px] text-ink hover:bg-subtle'
            }
          >
            <span>{r.label}</span>
            <span className="font-bold tabular-nums">{r.n}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

/* ------------------------------------------------------------------------ */

function shortDay(stamp: string): string {
  const p = inZone(stamp);
  const d = new Date(`${p.ymd}T12:00:00Z`);
  return d.toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short', timeZone: 'UTC' }).replace(',', '');
}

function TopPosts({ brand, w }: { brand: number | null; w: Span }) {
  const { go } = useTab();
  const q = usePostPerformance({ from: w.d7, to: w.d0, brand_id: brand, sort: 'reach' });
  return (
    <Panel title="Top posts · last 7 days" action={<PanelLink onClick={() => go('/social-media/analytics')}>Analytics</PanelLink>}>
      <OptionalView q={q} what="Post performance" compact>
        {(rows) =>
          rows.length ? (
            <Table head={['Post', 'Account', 'Published', 'Reach', 'Engagements', 'Clicks']} minWidth={720}>
              {rows.slice(0, 5).map((r) => (
                <tr key={r.target_id} className={`${TR} hover:bg-subtle`}>
                  <td className={`${TD} max-w-[360px]`}>
                    <button type="button" onClick={() => go(`/social-media/posts/${r.post_id}`)} className="block max-w-full truncate text-left text-ink hover:text-primary">
                      {r.excerpt}
                    </button>
                  </td>
                  <td className={TD}>
                    <span className="inline-flex items-center gap-2 text-ink-2">
                      <NetChip network={r.network} size={18} />
                      {r.account}
                    </span>
                  </td>
                  <td className={`${TD} whitespace-nowrap text-ink-2`}>{shortDay(r.published_at)}</td>
                  <td className={`${TD} tabular-nums`}>{compact(r.reach)}</td>
                  <td className={`${TD} tabular-nums`}>{compact(r.engagements)}</td>
                  <td className={`${TD} tabular-nums`}>{compact(r.clicks)}</td>
                </tr>
              ))}
            </Table>
          ) : (
            <p className="flex items-center gap-2 py-3 text-[13px] text-ink-3">
              <Icon name="chart" size={15} />
              Nothing was published in the last 7 days.
            </p>
          )
        }
      </OptionalView>
    </Panel>
  );
}
