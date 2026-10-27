import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { apiGet } from '../../core/api';
import { errorMessage } from '../../core/bridge';
import { timeLabel } from '../../core/time';
import { toast } from '../../core/toasts';
import { Icon } from '../../components/Icon';
import { ErrorNote, Spinner, cx } from '../../components/ui';
import { refreshMarketing, send } from './api';
import { bounceGuarded, Confirm, csv, saveCsvFile, stamp, stampYear } from './email-kit';
import { CAMPAIGN_PILL, Card, Empty, Kpi, Line, Meter, PageHeader, Pill, btn, btnBad, btnPrimary, n, pct } from './parts';
import { refusal, type CampaignDetail, type Options, type Report, type Version } from './types';
import { StatGrid } from '../../components/StatCard';

/**
 * How a campaign went — or how it is going (DK09): delivered, human opens,
 * clicks and unsubscribes; the funnel from sent to clicks; the links people
 * followed; how many opens were machines; and what bounced.
 *
 * Every figure is the server's, counted from the copies the send made. An
 * open made by an image proxy or a security scanner is kept for the record
 * but never counted as a person's: the human open rate is people over copies
 * that reached a mailbox. Open quality and deliverability come from a server
 * a part ahead; from one behind, the report says what it can from the counts.
 */
type Act = 'pause' | 'resume' | 'cancel' | 'duplicate' | 'winner';

export function ReportView({ campaign, options, onBack, onOpen }: { campaign: CampaignDetail; options: Options; onBack: () => void; onOpen: (id: number) => void }) {
  const live = campaign.status === 'sending';
  const [asking, setAsking] = useState<{ act: 'cancel' } | { act: 'winner'; version: Version } | null>(null);
  const [busy, setBusy] = useState<Act | null>(null);
  const report = useQuery({
    queryKey: ['marketing', 'campaign-results', campaign.id],
    queryFn: ({ signal }) => apiGet<Report>(`/api/marketing/campaigns/${campaign.id}/results`, undefined, signal),
    enabled: campaign.can.results,
    refetchInterval: live ? 30_000 : false,
  });
  const r = report.data;

  const act = async (what: Act, version?: Version) => {
    setBusy(what);
    try {
      const res = await send<{ id?: number } | null>('POST', `/api/marketing/campaigns/${campaign.id}/${what}`, what === 'winner' ? { version } : undefined);
      toast('success', res.message ?? 'Done.');
      setAsking(null);
      void refreshMarketing();
      if (what === 'duplicate' && res.data?.id) onOpen(res.data.id);
    } catch (e) {
      toast('error', refusal(e));
    } finally {
      setBusy(null);
    }
  };

  const exportCsv = async () => {
    if (!r) return;
    try {
      const where = await saveCsvFile(`campaign-${campaign.id}-report`, csv(reportRows(campaign, r)));
      if (where) toast('success', `Saved to ${where}`);
    } catch (e) {
      toast('error', errorMessage(e));
    }
  };

  const started = campaign.started_at ? `${campaign.status === 'sent' ? 'Sent' : 'Started'} ${stampYear(campaign.started_at)}` : campaign.status_label;
  const sub = [started, `${n(r?.counts.recipients ?? campaign.recipients)} recipients`, campaign.finished_at ? `finished ${timeLabel(campaign.finished_at)}` : null, live ? 'refreshed every half minute' : null].filter(Boolean).join(' · ');
  const stoppable = campaign.can.pause && (campaign.status === 'sending' || campaign.status === 'paused');

  return (
    <div className="flex flex-col">
      <PageHeader
        crumbs={['Campaigns', 'Report']}
        onCrumb={(i) => i === 1 && onBack()}
        title={
          <span className="flex min-w-0 items-center gap-2">
            <span className="truncate">{campaign.name}</span>
            <Pill tone={CAMPAIGN_PILL[campaign.status] ?? 'slate'}>{bounceGuarded(campaign) ? 'Paused · bounce guard' : campaign.status_label}</Pill>
          </span>
        }
        sub={sub}
        actions={
          <>
            {campaign.can.pause && campaign.status === 'sending' ? (
              <button type="button" className={btn} disabled={!!busy} onClick={() => void act('pause')}>
                <Icon name="pause" size={15} /> Pause
              </button>
            ) : null}
            {campaign.can.pause && campaign.status === 'paused' ? (
              <button type="button" className={btnPrimary} disabled={!!busy} onClick={() => void act('resume')}>
                <Icon name="play" size={15} /> Resume
              </button>
            ) : null}
            {stoppable ? (
              <button type="button" className={cx(btnBad, 'h-[34px] px-3 text-[13px]')} disabled={!!busy} onClick={() => setAsking({ act: 'cancel' })}>
                Cancel
              </button>
            ) : null}
            <button type="button" className={btn} disabled={!r} onClick={() => void exportCsv()}>
              <Icon name="download" size={15} /> Export CSV
            </button>
            {campaign.can.create ? (
              <button type="button" className={btn} disabled={busy === 'duplicate'} onClick={() => void act('duplicate')}>
                <Icon name="copy" size={15} /> Duplicate
              </button>
            ) : null}
          </>
        }
      />

      {campaign.status_note ? (
        <p role="status" className="m-0 mb-4 rounded-[10px] border border-warning-line bg-rail px-3.5 py-2.5 text-[12.5px] text-warning-ink dark:border-warning/40 dark:bg-warning-bg dark:text-warning">
          {campaign.status_note}
        </p>
      ) : null}

      {!campaign.can.results ? (
        <Card>
          <Empty text="Seeing how a campaign went needs permission to see campaign results." />
        </Card>
      ) : report.isLoading ? (
        <Spinner label="Loading the report…" />
      ) : !r ? (
        <ErrorNote error={new Error(refusal(report.error, 'The report could not be loaded.'))} onRetry={() => void report.refetch()} />
      ) : (
        <ReportBody campaign={campaign} options={options} r={r} mayChoose={campaign.can.launch && (campaign.status === 'sending' || campaign.status === 'paused')} busy={busy === 'winner'} onChoose={(v) => setAsking({ act: 'winner', version: v })} />
      )}

      {asking?.act === 'cancel' ? (
        <Confirm title="Cancel this campaign?" yes="Cancel it" danger busy={!!busy} onClose={() => setAsking(null)} onYes={() => void act('cancel')}>
          Nothing more is sent. Copies already sent stay sent; the ones still waiting are taken back.
        </Confirm>
      ) : null}
      {asking?.act === 'winner' ? (
        <Confirm title={`Send version ${asking.version.toUpperCase()} to the rest?`} yes={`Send ${asking.version.toUpperCase()}`} busy={!!busy} onClose={() => setAsking(null)} onYes={() => void act('winner', asking.version)}>
          The test stops here, and everybody still waiting gets this version.
        </Confirm>
      ) : null}
    </div>
  );
}

/** Copies that reached a mailbox: sent, less bounces. */
function reachedOf(r: Report): number {
  return r.rates.reached ?? Math.max(0, (r.counts.sent ?? 0) - (r.counts.bounced ?? 0));
}

/** People who opened it themselves: the quality breakdown's count, or the counts' own. */
function humanOf(r: Report): number {
  return r.quality?.human ?? r.counts.opened_by_people ?? 0;
}

const rateOf = (part: number, whole: number): number | null => (whole > 0 ? Math.round((part / whole) * 1000) / 10 : null);

function ReportBody({ campaign, options, r, mayChoose, busy, onChoose }: { campaign: CampaignDetail; options: Options; r: Report; mayChoose: boolean; busy: boolean; onChoose: (v: Version) => void }) {
  const c = r.counts;
  const sent = c.sent ?? 0;
  const reached = reachedOf(r);
  const human = humanOf(r);
  const machineOnly = Math.max(0, (c.opened ?? 0) - (c.opened_by_people ?? 0));
  const totalUnique = r.links.reduce((s, l) => s + l.unique_clicks, 0);
  const funnel: Array<[string, number, 'blue' | 'violet' | 'amber' | 'red' | 'green']> = [
    ['Sent', sent, 'blue'],
    ['Delivered', reached, 'blue'],
    ['Human opens', human, 'blue'],
    ['Clicks', c.clicked ?? 0, 'violet'],
    ['Unsubscribes', c.unsubscribed ?? 0, 'amber'],
    ['Bounces', c.bounced ?? 0, 'red'],
  ];
  const d = r.deliverability;
  const guardRate = d?.guard.rate ?? r.rates.bounced;

  return (
    <div className="flex flex-col gap-4">
      <StatGrid>
        <Kpi icon="mail-check" label="Delivered" value={pct(rateOf(reached, sent))} sub={`${n(reached)} of ${n(sent)}`} tone="green" />
        <Kpi icon="mail-open" tone="violet" label="Human open rate" value={pct(rateOf(human, reached))} sub={r.quality ? `${n(r.quality.machine_total)} machine opens excluded` : `${n(machineOnly)} opened only by machines, excluded`} />
        <Kpi icon="mouse-click" tone="cyan" label="Click rate" value={pct(r.rates.clicked)} sub={`${n(c.clicked ?? 0)} unique clickers`} />
        <Kpi icon="user-minus" label="Unsubscribes" value={n(c.unsubscribed ?? 0)} sub={r.rates.unsubscribed !== null ? `${pct(r.rates.unsubscribed)} of those reached` : undefined} tone={(c.unsubscribed ?? 0) > 0 ? 'amber' : undefined} />
      </StatGrid>

      {r.ab ? <AbPanel ab={r.ab} waiting={c.waiting ?? 0} mayChoose={mayChoose} busy={busy} onChoose={onChoose} /> : null}

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="flex min-w-0 flex-col gap-4">
          <Card title="Funnel">
            <ul className="m-0 flex list-none flex-col gap-2 p-0">
              {funnel.map(([label, value, tone]) => (
                <li key={label} className="grid grid-cols-[110px_minmax(0,1fr)_70px] items-center gap-3 text-[13px]">
                  <span className="text-ink-2">{label}</span>
                  <Meter value={value} max={Math.max(1, sent)} tone={tone} label={`${label}: ${n(value)} of ${n(sent)} sent`} />
                  <span className="text-right text-ink tabular-nums">{n(value)}</span>
                </li>
              ))}
            </ul>
          </Card>

          <Card title="Top links" padded={false}>
            {r.links.length === 0 ? (
              <Empty text={campaign.track_clicks ? 'Nobody has followed a link yet.' : 'Clicks are not counted for this campaign.'} />
            ) : (
              <table className="w-full table-fixed border-collapse text-left text-[13px]">
                <thead>
                  <tr className="border-y border-line bg-ground text-[11px] font-bold tracking-[.4px] text-ink-3 uppercase">
                    <th scope="col" className="px-4 py-2 font-bold">Link</th>
                    <th scope="col" className="w-[110px] px-4 py-2 text-right font-bold">Unique clicks</th>
                    <th scope="col" className="w-[80px] px-4 py-2 text-right font-bold">Share</th>
                  </tr>
                </thead>
                <tbody>
                  {r.links.map((l) => (
                    <tr key={l.id} className="border-b border-line/70 last:border-b-0">
                      <td className="truncate px-4 py-2 text-ink" title={l.url}>{l.url.replace(/^https?:\/\//i, '')}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{n(l.unique_clicks)}</td>
                      <td className="px-4 py-2 text-right text-ink-2 tabular-nums">{totalUnique > 0 ? `${Math.round((l.unique_clicks / totalUnique) * 100)}%` : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>
        </div>

        <div className="flex min-w-0 flex-col gap-4">
          <Card title="Open quality">
            {r.quality ? (
              <>
                {r.quality.machine.map((m) => <Line key={m.client} label={m.client}>{n(m.opens)}</Line>)}
                <Line label="Counted as human" strong>{n(r.quality.human)}</Line>
              </>
            ) : (
              <>
                <Line label="Opened only by machines">{n(machineOnly)}</Line>
                <Line label="Counted as human" strong>{n(c.opened_by_people ?? 0)}</Line>
                <p className="m-0 mt-2 text-[12px] text-ink-3">This server does not yet say which machines opened it.</p>
              </>
            )}
            <p className="m-0 mt-2 text-[12px] text-ink-3">Machine opens are kept for audit but never drive A/B winners or rates.</p>
          </Card>

          <Card title="Deliverability">
            <Line label="Hard bounces">{`${n(d?.hard ?? c.hard_bounced ?? 0)} · suppressed`}</Line>
            <Line label="Soft bounces">{`${n(d?.soft ?? Math.max(0, (c.bounced ?? 0) - (c.hard_bounced ?? 0)))} · retried`}</Line>
            <Line label="Complaints">{n(d?.complaints ?? c.complained ?? 0)}</Line>
            {d ? <Line label="Suppressed">{n(d.suppressed)}</Line> : null}
            <Line label="Bounce guard">
              {d
                ? `${d.guard.triggered ? 'Triggered' : 'Not triggered'} (${pct(guardRate)})`
                : bounceGuarded(campaign)
                  ? `Triggered (${pct(guardRate)})`
                  : `${pct(guardRate)} of ${options.sending?.bounce_guard ? `${options.sending.bounce_guard}%` : 'its limit'}`}
            </Line>
          </Card>
        </div>
      </div>
    </div>
  );
}

/**
 * The A/B test: each version's copies and how many people opened or clicked
 * them, which one leads, and — until it is decided — the way to decide now.
 */
function AbPanel({ ab, waiting, mayChoose, busy, onChoose }: { ab: NonNullable<Report['ab']>; waiting: number; mayChoose: boolean; busy: boolean; onChoose: (v: Version) => void }) {
  const word = ab.metric === 'clicks' ? 'clicked' : 'opened';
  const ra = ab.versions.a.rate ?? 0;
  const rb = ab.versions.b.rate ?? 0;
  const lead: Version | null = ab.winner ?? (ra === rb ? null : rb > ra ? 'b' : 'a');
  return (
    <Card title="A/B test">
      <p className="m-0 mb-3 text-[12.5px] text-ink-3">
        {ab.winner
          ? `Version ${ab.winner.toUpperCase()} won${ab.decided_by ? `, chosen by ${ab.decided_by}` : ', by the test'}${ab.decided_at ? ` ${stamp(ab.decided_at)}` : ''}, and went to everybody who waited.`
          : ab.ends_at
            ? `Decided ${stamp(ab.ends_at)} by who ${word} it (people, not image proxies); ${n(waiting)} wait for the winner.`
            : `The test's copies are going out; its ${ab.hours} ${ab.hours === 1 ? 'hour' : 'hours'} start when they have all been sent. ${n(waiting)} wait for the winner.`}
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        {(['a', 'b'] as const).map((v) => {
          const t = ab.versions[v];
          return (
            <section key={v} aria-label={`Version ${v.toUpperCase()}`} className={cx('rounded-[10px] border p-3', lead === v ? 'border-success/50 bg-success-bg' : 'border-line')}>
              <div className="flex items-center gap-2">
                <b className="text-[13.5px] text-ink">Version {v.toUpperCase()}</b>
                {ab.winner === v ? <Pill tone="green">Winner</Pill> : !ab.winner && lead === v ? <Pill tone="green" dot={false}>Ahead</Pill> : null}
              </div>
              <p className="m-0 mt-1 truncate text-[12px] text-ink-2" title={t.subject}>{t.subject || '—'}</p>
              <b className="mt-2 block text-[22px] text-ink tabular-nums">{t.rate === null ? '—' : `${t.rate}%`}</b>
              <span className="block text-[12px] text-ink-3">
                {n(ab.metric === 'clicks' ? t.clicked : t.opened)} of {n(t.reached)} reached {word}
              </span>
              {mayChoose && !ab.winner && waiting > 0 ? (
                <button type="button" className={cx(btn, 'mt-2')} disabled={busy} onClick={() => onChoose(v)}>
                  Choose {v.toUpperCase()} as the winner
                </button>
              ) : null}
            </section>
          );
        })}
      </div>
    </Card>
  );
}

/** The summary a person takes away: the headline figures, the links, and the test. */
export function reportRows(campaign: CampaignDetail, r: Report): Array<Array<string | number | null>> {
  const c = r.counts;
  const reached = reachedOf(r);
  const human = humanOf(r);
  const totalUnique = r.links.reduce((s, l) => s + l.unique_clicks, 0);
  const rows: Array<Array<string | number | null>> = [
    ['Campaign', campaign.name],
    ['Status', campaign.status_label],
    ['Subject', campaign.subject],
    ['Started', campaign.started_at],
    ['Finished', campaign.finished_at],
    [],
    ['Measure', 'Count', 'Rate %'],
    ['Recipients', c.recipients ?? 0, null],
    ['Sent', c.sent ?? 0, null],
    ['Delivered', reached, rateOf(reached, c.sent ?? 0)],
    ['Human opens', human, rateOf(human, reached)],
    ['Opens, machines included', c.opened ?? 0, r.rates.opened],
    ['Clicked (people)', c.clicked ?? 0, r.rates.clicked],
    ['Unsubscribes', c.unsubscribed ?? 0, r.rates.unsubscribed],
    ['Bounces', c.bounced ?? 0, r.rates.bounced],
    ['Hard bounces', r.deliverability?.hard ?? c.hard_bounced ?? 0, null],
    ['Complaints', r.deliverability?.complaints ?? c.complained ?? 0, null],
  ];
  if (r.quality) {
    rows.push([], ['Open quality', 'Opens']);
    r.quality.machine.forEach((m) => rows.push([m.client, m.opens]));
    rows.push(['Counted as human', r.quality.human]);
  }
  if (r.links.length) {
    rows.push([], ['Link', 'Unique clicks', 'Clicks', 'Share %']);
    r.links.forEach((l) => rows.push([l.url, l.unique_clicks, l.clicks, totalUnique > 0 ? Math.round((l.unique_clicks / totalUnique) * 100) : null]));
  }
  if (r.ab) {
    rows.push([], ['Version', 'Subject', 'Recipients', 'Reached', 'Opened', 'Clicked', `Rate % (${r.ab.metric})`, 'Winner']);
    (['a', 'b'] as const).forEach((v) => {
      const t = r.ab!.versions[v];
      rows.push([v.toUpperCase(), t.subject, t.recipients, t.reached, t.opened, t.clicked, t.rate, r.ab!.winner === v ? 'yes' : '']);
    });
  }
  return rows;
}
