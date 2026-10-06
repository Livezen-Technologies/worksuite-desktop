import { useQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useTab } from '../../../core/tab-context';
import { Button, cx, Empty } from '../../../components/ui';
import { exportReportCsv, fetchCampaign, fetchReport, MK, type Campaign, type Report as ReportData } from '../api';
import { useMarketingOrg } from '../org';
import { Bar, Kpi, Loaded, Mono, Notice, PageBody, PageHeader, Panel, Row, saveCsv, Status, TD, TH, useAction } from '../parts';
import { campaignActions } from '../lib/consent';
import { count, full, parseStamp, pct, ratio, share } from '../lib/format';
import { useCampaignCommands, when } from './Campaigns';

/**
 * DK09 · Campaign report (W09; PDF p44) — MKT-TRK-01..04, MKT-ABT-02, AC-04/06. Delivered, human opens (machine
 * opens are counted apart and never enter a rate or an A/B decision), clicks and unsubscribes; the funnel against
 * sent; open quality; the top links; deliverability with the bounce guard; and, for an A/B test, both variants and how
 * the winner was chosen. A campaign the bounce guard paused stays paused until a person resumes it.
 */

export default function Report({ id }: { id: number }) {
  const org = useMarketingOrg();
  const campaign = useQuery({ queryKey: MK.campaign(org, id), queryFn: ({ signal }) => fetchCampaign(id, signal), refetchInterval: (q) => (q.state.data?.status === 'sending' ? 30_000 : false) });
  return (
    <div className="flex h-full min-h-0 flex-col">
      <Loaded q={campaign} what="This campaign">
        {(c) => <ReportView campaign={c} />}
      </Loaded>
    </div>
  );
}

const clockOf = (s: string | null) => parseStamp(s)?.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) ?? '—';

/** "Sent 28 Sep 2026 10:00 · 3,702 recipients · finished 13:06". */
function subOf(c: Campaign): string {
  switch (c.status) {
    case 'sent': {
      const a = parseStamp(c.started_at);
      const b = parseStamp(c.finished_at);
      const sameDay = a && b && a.toDateString() === b.toDateString();
      return `Sent ${full(c.started_at)} · ${count(c.recipients_count)} recipients${c.finished_at ? ` · finished ${sameDay ? clockOf(c.finished_at) : when(c.finished_at)}` : ''}`;
    }
    case 'sending':
      return `Sending since ${full(c.started_at)} · ${count(c.sent_count)} of ${count(c.recipients_count)} sent`;
    case 'paused':
      return `Paused · ${count(c.sent_count)} of ${count(c.recipients_count)} sent`;
    case 'cancelled':
      return `Cancelled · ${count(c.sent_count)} of ${count(c.recipients_count)} had been sent`;
    default:
      return 'Not sent yet';
  }
}

function ReportView({ campaign: c }: { campaign: Campaign }) {
  const org = useMarketingOrg();
  const { go } = useTab();
  const commands = useCampaignCommands();
  const [busy, run] = useAction();
  const acts = campaignActions(c.status);
  const notYet = c.status === 'draft' || c.status === 'scheduled';
  const report = useQuery({ queryKey: MK.report(org, c.id), queryFn: ({ signal }) => fetchReport(c.id, signal), enabled: !notYet, refetchInterval: c.status === 'sending' ? 30_000 : false });

  return (
    <>
      <PageHeader
        crumb="Marketing / Campaigns"
        title={c.name}
        sub={subOf(c)}
        actions={
          <>
            {acts.pause ? (
              <Button icon="pause" loading={commands.busy === `pause:${c.id}`} onClick={() => void commands.pause(c)}>
                Pause
              </Button>
            ) : null}
            {acts.resume ? (
              <Button icon="play" loading={commands.busy === `resume:${c.id}`} onClick={() => void commands.resume(c)}>
                Resume
              </Button>
            ) : null}
            <Button
              icon="download"
              disabled={notYet || !report.data}
              loading={busy === 'export'}
              onClick={() =>
                void run('export', async () => {
                  await saveCsv(`${c.name} report`, await exportReportCsv(c.id));
                })
              }
            >
              Export CSV
            </Button>
            <Button icon="copy" loading={commands.busy === `duplicate:${c.id}`} onClick={() => void commands.duplicate(c)}>
              Duplicate
            </Button>
          </>
        }
      />
      <PageBody className="flex flex-col gap-4">
        {c.status === 'paused' && c.paused_reason === 'bounce_guard' ? (
          <Notice tone="warning">
            The bounce guard paused this campaign at {pct(c.bounce_rate)} bounces. It does not resume by itself: a person has to, after checking the bounces below. Hard-bounced addresses are already suppressed.
          </Notice>
        ) : c.status === 'paused' ? (
          <Notice tone="warning">Paused. Nobody new is sent to until it is resumed; nobody who has it gets it twice.</Notice>
        ) : null}
        {notYet ? (
          <div className="rounded-[12px] border border-line bg-surface">
            <Empty
              icon="chart"
              title="Nothing to report yet"
              hint={c.status === 'scheduled' ? `It is scheduled for ${when(c.scheduled_at)}; its numbers start when it sends.` : 'This campaign is a draft. Its numbers start when it sends.'}
              action={
                <Button className="mt-2" icon="send" onClick={() => go(`/marketing/campaigns/${c.id}/review`)}>
                  Review & send
                </Button>
              }
            />
          </div>
        ) : (
          <Loaded q={report} what="The campaign report">
            {(r) => <ReportBody campaign={c} r={r} />}
          </Loaded>
        )}
      </PageBody>
      {commands.dialog}
    </>
  );
}

function FunnelRow({ label, n, of, tone }: { label: string; n: number; of: number; tone: 'primary' | 'ink' | 'violet' | 'danger' | 'warning' }) {
  return (
    <div className="grid grid-cols-[minmax(84px,120px)_minmax(0,1fr)_64px] items-center gap-3 text-[12.5px]">
      <span className="truncate text-ink-2">{label}</span>
      <Bar value={ratio(n, of)} tone={tone} />
      <Mono className="text-right text-ink">{count(n)}</Mono>
    </div>
  );
}

function ReportBody({ campaign: c, r }: { campaign: Campaign; r: ReportData }) {
  const bounces = r.bounces.hard + r.bounces.soft;
  const sources = [`One-click ${count(r.unsubscribe_sources.one_click)}`, `preference centre ${count(r.unsubscribe_sources.preference_centre)}`, ...(r.unsubscribe_sources.footer ? [`footer ${count(r.unsubscribe_sources.footer)}`] : [])].join(' · ');
  return (
    <>
      <div className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(190px,1fr))]">
        <Kpi label="Delivered" value={share(r.delivered, r.sent)} sub={`${count(r.delivered)} of ${count(r.sent)}`} subTone="success" />
        <Kpi label="Human open rate" value={share(r.human_opens, r.delivered)} sub={`${count(r.machine_opens)} machine opens excluded`} />
        <Kpi label="Click rate" value={share(r.unique_clickers, r.delivered)} sub={`${count(r.unique_clickers)} unique clickers`} />
        <Kpi label="Unsubscribes" value={count(r.unsubscribes)} sub={sources} />
      </div>
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="flex min-w-0 flex-col gap-4">
          <Panel title="Funnel" bodyClassName="flex flex-col gap-2.5">
            <FunnelRow label="Sent" n={r.sent} of={r.sent} tone="ink" />
            <FunnelRow label="Delivered" n={r.delivered} of={r.sent} tone="primary" />
            <FunnelRow label="Human opens" n={r.human_opens} of={r.sent} tone="primary" />
            <FunnelRow label="Clicks" n={r.unique_clickers} of={r.sent} tone="violet" />
            <FunnelRow label="Unsubscribes" n={r.unsubscribes} of={r.sent} tone="warning" />
            <FunnelRow label="Bounces" n={bounces} of={r.sent} tone="danger" />
          </Panel>
          <Panel title="Top links">
            {r.top_links.length === 0 ? (
              <Empty icon="link" title="No clicks yet" hint="A link counts once per recipient who clicks it; security scanners that pre-fetch links are not counted." />
            ) : (
              <div className="-mx-4 -mb-3 overflow-x-auto scroll-thin">
                <table className="w-full border-collapse" aria-label="Top links">
                  <thead className="border-y border-line bg-subtle/50">
                    <tr>
                      <th className={TH}>Link</th>
                      <th className={`${TH} text-right`}>Unique clicks</th>
                      <th className={`${TH} text-right`}>Share</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {r.top_links.map((l, i) => (
                      <tr key={`${i}:${l.url}`}>
                        <td className={`${TD} max-w-[360px] truncate font-mono`} title={l.url}>
                          {l.url.replace(/^https?:\/\//, '')}
                        </td>
                        <td className={`${TD} text-right font-mono tabular-nums`}>{count(l.unique_clicks)}</td>
                        <td className={`${TD} text-right font-mono tabular-nums`}>{pct(l.share, 0)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>
          {r.ab ? <AbPanel campaign={c} ab={r.ab} /> : null}
        </div>
        <div className="flex min-w-0 flex-col gap-4">
          <Panel title="Open quality">
            <Row label="Apple Mail Privacy proxy">
              <Mono>{count(r.open_quality.apple_mpp)}</Mono>
            </Row>
            <Row label="Security scanner (pre-fetch)">
              <Mono>{count(r.open_quality.scanner)}</Mono>
            </Row>
            <Row label="Image cache">
              <Mono>{count(r.open_quality.image_cache)}</Mono>
            </Row>
            <Row label={<b className="text-ink">Counted as human</b>}>
              <Mono className="font-bold">{count(r.open_quality.human)}</Mono>
            </Row>
            <p className="mt-2 text-[11.5px] leading-snug text-ink-3">Machine opens are kept for audit but never drive A/B winners or rates.</p>
          </Panel>
          <Panel title="Deliverability">
            <Row label="Hard bounces">
              <Mono>{count(r.bounces.hard)}</Mono> · suppressed
            </Row>
            <Row label="Soft bounces">
              <Mono>{count(r.bounces.soft)}</Mono> · retried
            </Row>
            <Row label="Complaints">
              <Mono>{count(r.complaints)}</Mono>
            </Row>
            <Row label="Bounce guard">
              <span className={cx(r.bounce_guard.triggered && 'text-danger')}>{r.bounce_guard.triggered ? `Triggered — paused at ${pct(r.bounce_guard.rate)}` : `Not triggered (${pct(r.bounce_guard.rate)})`}</span>
            </Row>
            <p className="mt-2 text-[11.5px] leading-snug text-ink-3">The guard pauses a campaign whose bounces reach {pct(r.bounce_guard.threshold, 0)}; a person resumes it.</p>
          </Panel>
        </div>
      </div>
    </>
  );
}

function AbPanel({ campaign: c, ab }: { campaign: Campaign; ab: NonNullable<ReportData['ab']> }) {
  const by = ab.metric === 'clicks' ? 'clicks' : 'human opens';
  const hours = c.ab?.window_hours ?? null;
  const how: ReactNode = ab.winner
    ? `Variant ${ab.winner} won by ${by}${hours ? ` after ${hours} h` : ''}${ab.decided_at ? ` (${when(ab.decided_at)})` : ''}; a tie keeps A. The winner went to everyone else.`
    : `No winner yet: it is picked by ${by}${hours ? ` after ${hours} h` : ''}; a tie keeps A.`;
  return (
    <Panel title="A/B test" sub={how}>
      <div className="-mx-4 -mb-3 overflow-x-auto scroll-thin">
        <table className="w-full border-collapse" aria-label="A/B variants">
          <thead className="border-y border-line bg-subtle/50">
            <tr>
              <th className={TH}>Variant</th>
              <th className={TH}>Subject</th>
              <th className={`${TH} text-right`}>Recipients</th>
              <th className={`${TH} text-right`}>Human open rate</th>
              <th className={`${TH} text-right`}>Click rate</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {ab.variants.map((v) => (
              <tr key={v.key} className={cx(ab.winner === v.key && 'bg-success-bg/40')}>
                <td className={`${TD} whitespace-nowrap`}>
                  <span className="inline-flex items-center gap-2">
                    <Mono className="font-bold">{v.key}</Mono>
                    {ab.winner === v.key ? <Status tone="success">Winner</Status> : null}
                  </span>
                </td>
                <td className={`${TD} max-w-[320px] truncate`} title={v.subject ?? undefined}>
                  {v.subject ?? '—'}
                </td>
                <td className={`${TD} text-right font-mono tabular-nums`}>{count(v.recipients)}</td>
                <td className={`${TD} text-right font-mono tabular-nums`}>{pct(v.human_open_rate)}</td>
                <td className={`${TD} text-right font-mono tabular-nums`}>{pct(v.click_rate)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}
