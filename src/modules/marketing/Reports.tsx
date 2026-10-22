import { useQueries, useQuery } from '@tanstack/react-query';
import { apiGet } from '../../core/api';
import { ErrorNote, Spinner, cx } from '../../components/ui';
import { mayAny, withOrg } from './api';
import type { CallCampaign, CallStatus } from './calls';
import { bounceGuarded, delivered, rateWords, stamp, useHumanOpens } from './email-kit';
import { CAMPAIGN_PILL, Card, Cell, Empty, PageHeader, Pill, THead, n, row, type PillTone } from './parts';
import { refusal, type Campaign, type Options } from './types';

/**
 * Reports: every email campaign that has gone out or is going, with its
 * rates, and every call campaign with its reach — each row opening that
 * campaign's own report. Analytics across campaigns is its own screen,
 * Insights › Analytics (WS-D).
 *
 * Rates are worked out from the server's counts the same way the campaign's
 * report works them out: out of the copies that reached a mailbox. Opens are
 * people's own — never image proxies or scanners — as the server counts them.
 */
const SENT_STATUSES = ['sending', 'paused', 'sent'] as const;

const CALL_PILL: Record<CallStatus, PillTone> = { draft: 'slate', active: 'blue', paused: 'amber', completed: 'green', cancelled: 'red' };

export default function Reports({ org, options, onCampaign, onCall, onAnalytics }: { org: string; options: Options; onCampaign: (id: number) => void; onCall: (id: number) => void; onAnalytics?: () => void }) {
  const mayEmail = mayAny(options, 'analytics') || mayAny(options, 'campaigns');
  const mayCalls = mayAny(options, 'calls');

  const email = useQueries({
    queries: SENT_STATUSES.map((status) => ({
      queryKey: ['marketing', 'campaigns', org, status, '', 'report'],
      queryFn: ({ signal }: { signal: AbortSignal }) => apiGet<{ items: Campaign[]; total: number }>('/api/marketing/campaigns', withOrg(org, { status, per_page: 100 }), signal),
      enabled: mayEmail,
    })),
  });
  const calls = useQuery({
    queryKey: ['marketing', 'calls', 'campaigns', org],
    queryFn: ({ signal }) => apiGet<{ items: CallCampaign[] }>('/api/marketing/calls/campaigns', withOrg(org), signal),
    enabled: mayCalls,
  });

  const emailLoading = email.some((q) => q.isLoading);
  const emailError = email.find((q) => q.error)?.error;
  const campaigns = email
    .flatMap((q) => q.data?.items ?? [])
    .sort((a, b) => (b.started_at ?? b.updated_at ?? '').localeCompare(a.started_at ?? a.updated_at ?? ''));
  const human = useHumanOpens(campaigns);
  const callItems = (calls.data?.items ?? []).filter((c) => c.status !== 'draft');

  return (
    <div className="flex flex-col gap-4">
      <PageHeader crumbs={['Insights']} title="Reports" sub="Each campaign’s figures, counted by the server from the copies it sent and the calls agents logged." />

      {!mayEmail && !mayCalls ? (
        <Card>
          <Empty text="Reports need permission to see campaign results or call campaigns. An administrator can give it." />
        </Card>
      ) : null}

      {mayEmail ? (
        <Card title="Email campaigns" padded={false}>
          {emailLoading ? (
            <Spinner label="Loading email campaigns…" />
          ) : emailError ? (
            <div className="px-4 pb-4">
              <ErrorNote error={new Error(refusal(emailError, 'The email campaigns could not be loaded.'))} onRetry={() => email.forEach((q) => void q.refetch())} />
            </div>
          ) : (
            <div className="overflow-x-auto scroll-thin">
              <div className="min-w-[860px]">
                <THead cols={[['Campaign', null], ['Status', 170], ['Sent', 130], ['Delivered', 100], ['Human opens', 110], ['Clicks', 80], ['Unsubscribes', 110]]} />
                {campaigns.map((c) => {
                  const s = c.stats;
                  const d = delivered(c);
                  return (
                    <button key={c.id} type="button" onClick={() => onCampaign(c.id)} className={cx(row, 'w-full text-left hover:bg-subtle focus-visible:bg-subtle')}>
                      <Cell w={null} className="font-bold">{c.name}</Cell>
                      <Cell w={170} className="!overflow-visible">
                        <Pill tone={CAMPAIGN_PILL[c.status] ?? 'slate'}>{bounceGuarded(c) ? 'Paused · bounce guard' : c.status_label}</Pill>
                      </Cell>
                      <Cell w={130} className="text-ink-2">{stamp(c.finished_at ?? c.started_at)}</Cell>
                      <Cell w={100} className="text-right tabular-nums">{d === null ? '—' : n(d)}</Cell>
                      <Cell w={110} className="text-right text-ink-2 tabular-nums">{rateWords(human.get(c.id), d)}</Cell>
                      <Cell w={80} className="text-right text-ink-2 tabular-nums">{rateWords(s?.clicked, d)}</Cell>
                      <Cell w={110} className="text-right text-ink-2 tabular-nums">{s ? n(s.unsubscribed) : '—'}</Cell>
                    </button>
                  );
                })}
                {campaigns.length === 0 ? <Empty text="No email campaign has gone out yet." /> : null}
              </div>
            </div>
          )}
        </Card>
      ) : null}

      {mayCalls ? (
        <Card title="Call campaigns" padded={false}>
          {calls.isLoading ? (
            <Spinner label="Loading call campaigns…" />
          ) : calls.error ? (
            <div className="px-4 pb-4">
              <ErrorNote error={new Error(refusal(calls.error, 'The call campaigns could not be loaded.'))} onRetry={() => void calls.refetch()} />
            </div>
          ) : (
            <div className="overflow-x-auto scroll-thin">
              <div className="min-w-[720px]">
                <THead cols={[['Campaign', null], ['Status', 130], ['In queue', 100], ['Calls', 90], ['Reached', 90], ['Reach rate', 100]]} />
                {callItems.map((c) => (
                  <button key={c.id} type="button" onClick={() => onCall(c.id)} className={cx(row, 'w-full text-left hover:bg-subtle focus-visible:bg-subtle')}>
                    <Cell w={null} className="font-bold">{c.name}</Cell>
                    <Cell w={130} className="!overflow-visible">
                      <Pill tone={CALL_PILL[c.status] ?? 'slate'}>{c.status_label}</Pill>
                    </Cell>
                    <Cell w={100} className="text-right tabular-nums">{n(c.waiting ?? c.queued)}</Cell>
                    <Cell w={90} className="text-right tabular-nums">{n(c.calls)}</Cell>
                    <Cell w={90} className="text-right tabular-nums">{n(c.connected)}</Cell>
                    <Cell w={100} className="text-right text-ink-2 tabular-nums">{rateWords(c.connected, c.calls)}</Cell>
                  </button>
                ))}
                {callItems.length === 0 ? <Empty text="No call campaign has been launched yet." /> : null}
              </div>
            </div>
          )}
        </Card>
      ) : null}

      <Card title="Cross-campaign analytics" tone="info" action={onAnalytics ? <button type="button" className="text-[12.5px] font-semibold text-primary hover:underline" onClick={onAnalytics}>Open Analytics</button> : null}>
        <p className="m-0 text-[12.5px] text-ink-2">
          Results by period, channel and topic across email, WhatsApp, SMS and calls, the funnel, revenue attribution, UTM links, site tracking and scheduled reports are under Insights › Analytics.
        </p>
      </Card>
    </div>
  );
}
