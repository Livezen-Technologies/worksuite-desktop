import { useState } from 'react';
import { useTab } from '../../../../core/tab-context';
import { usePostPerformance, useInboxMetrics, useCampaigns, rowsOf, type AnalyticsOverview, type AnalyticsQuery, type Optional } from '../../api';
import { CAMPAIGN_STATUS } from '../../lib/status';
import { NETWORKS, networkInfo } from '../../lib/networks';
import { logStamp } from '../../lib/time';
import { compact, delta, full, Kpi, NativeSelect, NetChip, NotOffered, OptionalView, Panel, Pill, Table, TD, TR } from '../../parts';
import { cx } from '../../../../components/ui';

/**
 * W07's other tabs: Posts (SMM-ANL-003), Audience and Inbox & response (SMM-ANL-004), Campaigns (SMM-CPG-003).
 * Each asks its own route, so a server that has the overview but not, say, inbox metrics says so in that tab alone.
 */

// The row takes the click; the button in its first cell is how a keyboard reaches it (its click bubbles up).
const ROW = cx(TR, 'cursor-pointer hover:bg-subtle');
const num = (n: number | null | undefined) => (n === null || n === undefined ? <span className="text-ink-3">—</span> : <span className="tabular-nums">{compact(n)}</span>);
const minutes = (m: number | null | undefined) => (m === null || m === undefined ? null : m >= 120 ? `${+(m / 60).toFixed(1)} h` : `${Math.round(m)} min`);

export function PostsTab({ query }: { query: AnalyticsQuery }) {
  const { go } = useTab();
  const [sort, setSort] = useState('reach');
  const [network, setNetwork] = useState('');
  const q = usePostPerformance({ ...query, sort, network: network || null });
  return (
    <Panel
      title="Posts"
      sub="Each post's results on each network, for the range above."
      action={
        <div className="flex gap-2">
          <NativeSelect label="Sort by" value={sort} onChange={setSort} className="w-auto">
            <option value="reach">Sort: Reach</option>
            <option value="engagements">Sort: Engagements</option>
            <option value="clicks">Sort: Clicks</option>
            <option value="published_at">Sort: Published</option>
          </NativeSelect>
          <NativeSelect label="Network" value={network} onChange={setNetwork} className="w-auto">
            <option value="">All networks</option>
            {NETWORKS.map((n) => (
              <option key={n} value={n}>
                {networkInfo(n).label}
              </option>
            ))}
          </NativeSelect>
        </div>
      }
    >
      <OptionalView q={q} what="Post performance" compact>
        {(rows) =>
          rows.length ? (
            <Table head={['Post', 'Published', 'Reach', 'Engagements', 'Clicks']} minWidth={640}>
              {rows.map((p) => (
                <tr key={p.target_id} className={ROW} onClick={() => go(`/social-media/posts/${p.post_id}`)}>
                  <td className={TD}>
                    <button type="button" className="flex min-w-0 items-center gap-2 text-left">
                      <NetChip network={p.network} />
                      <span className="min-w-0">
                        <span className="block max-w-[360px] truncate font-semibold text-ink">{p.excerpt}</span>
                        <span className="block truncate text-[11.5px] text-ink-3">{p.account}</span>
                      </span>
                    </button>
                  </td>
                  <td className={cx(TD, 'whitespace-nowrap text-ink-2')}>{logStamp(p.published_at)}</td>
                  <td className={TD}>{num(p.reach)}</td>
                  <td className={TD}>{num(p.engagements)}</td>
                  <td className={TD}>{num(p.clicks)}</td>
                </tr>
              ))}
            </Table>
          ) : (
            <p className="py-6 text-center text-[12.5px] text-ink-3">Nothing published in this range.</p>
          )
        }
      </OptionalView>
    </Panel>
  );
}

export function AudienceTab({ overview }: { overview: Optional<AnalyticsOverview> | undefined }) {
  if (!overview) return null;
  if (!overview.offered) {
    return (
      <Panel title="Followers by account">
        <NotOffered what="Audience analytics" compact />
      </Panel>
    );
  }
  const rows = overview.data.by_account;
  return (
    <Panel title="Followers by account" sub="Change in followers over the range above, per account. Networks count followers differently, so there is no total.">
      {rows.length ? (
        <Table head={['Account', 'Followers Δ']}>
          {rows.map((a) => (
            <tr key={a.account_id} className={TR}>
              <td className={TD}>
                <span className="flex items-center gap-2">
                  <NetChip network={a.network} />
                  <span className="font-semibold text-ink">{a.name}</span>
                </span>
              </td>
              <td className={cx(TD, 'tabular-nums')}>
                {a.followers_delta === null ? <span className="text-ink-3">Not measured</span> : <span className={a.followers_delta >= 0 ? 'text-success' : 'text-danger'}>{delta(a.followers_delta, 'abs')}</span>}
              </td>
            </tr>
          ))}
        </Table>
      ) : (
        <p className="py-6 text-center text-[12.5px] text-ink-3">No accounts in this scope.</p>
      )}
    </Panel>
  );
}

export function InboxTab({ query }: { query: AnalyticsQuery }) {
  const q = useInboxMetrics(query);
  return (
    <OptionalView q={q} what="Inbox metrics" compact>
      {(m) => (
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Kpi label="Conversations" value={full(m.volume)} />
            <Kpi label="Median first reply" value={minutes(m.median_first_reply_minutes)} />
            <Kpi label="Median resolution" value={minutes(m.median_resolution_minutes)} />
          </div>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Panel title="By agent">
              <Table head={['Agent', 'Replies', 'Median first reply']}>
                {m.by_agent.map((a) => (
                  <tr key={a.name} className={TR}>
                    <td className={cx(TD, 'font-semibold text-ink')}>{a.name}</td>
                    <td className={cx(TD, 'tabular-nums')}>{full(a.replies)}</td>
                    <td className={TD}>{minutes(a.median_first_reply_minutes) ?? <span className="text-ink-3">Not measured</span>}</td>
                  </tr>
                ))}
              </Table>
            </Panel>
            <Panel title="By brand">
              <Table head={['Brand', 'Conversations', 'Median first reply']}>
                {m.by_brand.map((b) => (
                  <tr key={b.name} className={TR}>
                    <td className={cx(TD, 'font-semibold text-ink')}>{b.name}</td>
                    <td className={cx(TD, 'tabular-nums')}>{full(b.volume)}</td>
                    <td className={TD}>{minutes(b.median_first_reply_minutes) ?? <span className="text-ink-3">Not measured</span>}</td>
                  </tr>
                ))}
              </Table>
            </Panel>
          </div>
        </div>
      )}
    </OptionalView>
  );
}

export function CampaignsTab({ brandId }: { brandId: number | null }) {
  const { go } = useTab();
  const q = useCampaigns();
  const rows = rowsOf(q.data).filter((c) => !brandId || c.brand_id === brandId);
  return (
    <Panel title="Campaigns" sub="Results attributed to each campaign through its tagged links.">
      <OptionalView q={q} what="Campaigns" compact>
        {() =>
          rows.length ? (
            <Table head={['Campaign', 'Posts', 'Clicks', 'CRM', 'Status']} minWidth={560}>
              {rows.map((c) => {
                const s = CAMPAIGN_STATUS[c.status] ?? { label: c.status, tone: 'muted' as const };
                return (
                  <tr key={c.id} className={ROW} onClick={() => go(`/social-media/campaigns/${c.id}`)}>
                    <td className={TD}>
                      <button type="button" className="text-left font-semibold text-ink">
                        {c.name}
                      </button>
                    </td>
                    <td className={cx(TD, 'text-ink-2')}>
                      {c.posts_planned} · {c.posts_published} published
                    </td>
                    <td className={TD}>{num(c.clicks)}</td>
                    <td className={TD}>{c.crm_leads === null ? <span className="text-ink-3">—</span> : `${full(c.crm_leads)} leads`}</td>
                    <td className={TD}>
                      <Pill tone={s.tone}>{s.label}</Pill>
                    </td>
                  </tr>
                );
              })}
            </Table>
          ) : (
            <p className="py-6 text-center text-[12.5px] text-ink-3">No campaigns yet.</p>
          )
        }
      </OptionalView>
    </Panel>
  );
}
