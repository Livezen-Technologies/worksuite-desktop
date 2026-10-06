import { useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import { useId, useState, type ReactNode } from 'react';
import { ApiError } from '../../../core/api';
import { useTab } from '../../../core/tab-context';
import { toast } from '../../../core/toasts';
import { Icon } from '../../../components/Icon';
import { Button, cx, Modal, NumberField, Spinner, Switch } from '../../../components/ui';
import { fetchAudience, fetchCampaign, MK, requestApproval, runCheck, scheduleCampaign, updateCampaign, useSettings, type AbSettings, type AudienceSummary, type Campaign, type Check, type CheckResult } from '../api';
import { useMarketingOrg } from '../org';
import { Field, Input, Loaded, Mono, Notice, PageBody, PageHeader, Panel, Planned, Refused, Row, Status, TextArea, useAction } from '../parts';
import { campaignActions, campaignStatus } from '../lib/consent';
import { count, isoDay, localToUtc, parseStamp, pct, plural } from '../lib/format';
import { Confirm, useCampaignCommands, when } from './Campaigns';
import { senderErrors } from './NewCampaign';
import { TestSendModal } from './TestSend';

/**
 * DK08 · Review & send (W08; PDF p43) — WF-07/08/09, MKT-CHK-01..03, MKT-ABT-01..03, MKT-SND-02/04/06, MKT-EML-05,
 * AC-05. The pre-send check runs as the screen opens; while it reports a blocker — or has not run — the campaign
 * cannot be scheduled, though tests (up to five) still can go. Sender and subject stay editable while it is a draft;
 * the audience is shown after exclusions; delivery takes an A/B subject test, recipient local time, now or a date
 * and time, under the company's pace and bounce guard. An author the server refuses can ask for approval instead.
 */

export default function ReviewSend({ id }: { id: number }) {
  const org = useMarketingOrg();
  const campaign = useQuery({ queryKey: MK.campaign(org, id), queryFn: ({ signal }) => fetchCampaign(id, signal) });
  return (
    <div className="flex h-full min-h-0 flex-col">
      <Loaded q={campaign} what="This campaign">
        {(c) => <Review key={c.id} campaign={c} />}
      </Loaded>
    </div>
  );
}

interface SenderForm {
  from_name: string;
  from_email: string;
  reply_to: string;
  subject: string;
  subject_b: string;
  preview_text: string;
}

interface Delivery {
  ab: boolean;
  kind: AbSettings['kind'];
  share: string;
  hours: string;
  metric: AbSettings['metric'];
  local: boolean;
  when: 'now' | 'later';
  date: string;
  time: string;
}

const senderOf = (c: Campaign): SenderForm => ({
  from_name: c.from_name ?? '',
  from_email: c.from_email ?? '',
  reply_to: c.reply_to ?? '',
  subject: c.subject ?? '',
  subject_b: c.ab?.subject_b ?? '',
  preview_text: c.preview_text ?? '',
});

const hhmm = (d: Date) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;

/** The scheduled time, or the next 09:00. */
function deliveryOf(c: Campaign): Delivery {
  let at = parseStamp(c.scheduled_at);
  if (!at) {
    at = new Date();
    if (at.getHours() >= 9) at.setDate(at.getDate() + 1);
    at.setHours(9, 0, 0, 0);
  }
  return {
    ab: c.ab?.enabled ?? false,
    kind: c.ab?.kind ?? 'subject',
    share: String(c.ab?.test_share ?? 20),
    hours: String(c.ab?.window_hours ?? 4),
    metric: c.ab?.metric ?? 'opens',
    local: c.local_time,
    when: 'later',
    date: isoDay(at),
    time: hhmm(at),
  };
}

/** A send time already gone (read as the person picks it, not kept). */
const isPast = (d: Date | null) => d !== null && d.getTime() <= Date.now();

const whole = (s: string, min: number, max: number) => /^\d+$/.test(s.trim()) && Number(s) >= min && Number(s) <= max;

function abOf(d: Delivery, s: SenderForm): Partial<AbSettings> {
  if (!d.ab) return { enabled: false };
  return { enabled: true, kind: d.kind, test_share: Number(d.share), window_hours: Number(d.hours), metric: d.metric, subject_b: d.kind === 'subject' ? s.subject_b.trim() || null : null };
}

/** "10:56" when it ends the day it starts, else "7 Oct 01:12". */
function finishOf(start: Date, end: Date): string {
  return start.toDateString() === end.toDateString() ? hhmm(end) : when(end.toISOString());
}

/** "1 h 56 min" */
function duration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h ? (m ? `${h} h ${m} min` : `${h} h`) : `${m} min`;
}

function Review({ campaign: c }: { campaign: Campaign }) {
  const org = useMarketingOrg();
  const qc = useQueryClient();
  const { go } = useTab();
  const settings = useSettings();
  const commands = useCampaignCommands();
  const [busy, run] = useAction();
  const acts = campaignActions(c.status);
  const editable = c.status === 'draft';
  const checkable = c.status === 'draft' || c.status === 'scheduled';
  const base = `/marketing/campaigns/${c.id}`;
  // The check runs each time the screen opens (WF-07 step 1), and again on request or after a save.
  const check = useQuery({ queryKey: MK.check(org, c.id), queryFn: () => runCheck(c.id), enabled: checkable, staleTime: 0, refetchOnWindowFocus: false, retry: false });
  const audience = useQuery({ queryKey: MK.audience(org, c.id), queryFn: ({ signal }) => fetchAudience(c.id, signal) });
  const [s, setS] = useState(() => senderOf(c));
  const [d, setD] = useState(() => deliveryOf(c));
  const [tried, setTried] = useState(false);
  const [testing, setTesting] = useState(false);
  const [sendNow, setSendNow] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  const patchS = (p: Partial<SenderForm>) => setS((x) => ({ ...x, ...p }));
  const patchD = (p: Partial<Delivery>) => setD((x) => ({ ...x, ...p }));

  const sending = settings.data?.sending ?? null;
  const maxTests = sending?.max_test_recipients ?? 5;
  const testsLeft = Math.max(0, maxTests - c.tests_sent);
  const errs = senderErrors(s);
  const abSubject = d.ab && d.kind === 'subject';
  const senderDirty = JSON.stringify(s) !== JSON.stringify(senderOf(c));
  const shareOk = whole(d.share, 10, 50);
  const hoursOk = whole(d.hours, 1, 72);
  const sendAt = d.when === 'now' ? null : localToUtc(d.date, d.time);
  const sendAtDate = parseStamp(sendAt);
  const blockers = check.data?.blockers ?? [];
  const checked = check.isSuccess && !check.isFetching;
  // What still stands between this draft and Schedule, said in one line.
  const whyNot = !checked
    ? check.isError
      ? 'The pre-send check did not run. Run it again.'
      : 'The pre-send check is running.'
    : blockers.length
      ? `Clear ${blockers.length === 1 ? 'the blocker' : `the ${blockers.length} blockers`} first.`
      : errs.from_email || errs.reply_to
        ? 'Fix the sender addresses first.'
        : abSubject && !s.subject_b.trim()
          ? 'Write subject B, or turn the A/B test off.'
          : d.ab && (!shareOk || !hoursOk)
            ? 'The test share is 10–50% and the window 1–72 h.'
            : d.when === 'later' && !sendAtDate
              ? 'Pick a date and a time.'
              : d.when === 'later' && isPast(sendAtDate)
                ? 'That time has passed. Pick a later one, or send now.'
                : null;

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['marketing', 'campaigns'] });
    void qc.invalidateQueries({ queryKey: MK.dashboard(org) });
    void qc.invalidateQueries({ queryKey: MK.audience(org, c.id) });
  };

  const saveSender = () => {
    setTried(true);
    if (errs.from_email || errs.reply_to) return;
    void run(
      'save',
      async () => {
        const updated = await updateCampaign(c.id, {
          from_name: s.from_name.trim() || null,
          from_email: s.from_email.trim() || null,
          reply_to: s.reply_to.trim() || null,
          subject: s.subject.trim() || null,
          preview_text: s.preview_text.trim() || null,
          ...(abSubject ? { ab: abOf(d, s) } : {}),
        });
        qc.setQueryData<Campaign>(MK.campaign(org, c.id), updated);
        setS(senderOf(updated));
        refresh();
        await check.refetch();
      },
      'Saved, and checked again.',
    );
  };

  const schedule = () => {
    setSendNow(false);
    const out = { refused: null as string | null };
    void run('schedule', async () => {
      await updateCampaign(c.id, {
        ...(senderDirty ? { from_name: s.from_name.trim() || null, from_email: s.from_email.trim() || null, reply_to: s.reply_to.trim() || null, subject: s.subject.trim() || null, preview_text: s.preview_text.trim() || null } : {}),
        ab: abOf(d, s),
        local_time: d.local,
      });
      try {
        const updated = await scheduleCampaign(c.id, { send_at: sendAt, local_time: d.local });
        qc.setQueryData<Campaign>(MK.campaign(org, c.id), updated);
      } catch (e) {
        // An author without send permission (MKT-EML-05): say so, and offer approval.
        if (e instanceof ApiError && e.forbidden) {
          out.refused = e.message;
          return;
        }
        throw e;
      }
    }).then((ok) => {
      if (!ok) return;
      if (out.refused !== null) {
        setRefusal(out.refused);
        void qc.invalidateQueries({ queryKey: MK.campaign(org, c.id) });
        return;
      }
      refresh();
      toast('success', sendAt ? `Scheduled for ${when(sendAt)}${d.local ? ', in each recipient’s local time' : ''}.` : 'Sending has started.');
      go(sendAt ? '/marketing/campaigns' : `${base}/report`);
    });
  };

  const recipients = audience.data?.recipients;
  const minutes = recipients && sending?.hourly_pace ? Math.max(1, Math.ceil((recipients / sending.hourly_pace) * 60)) : null;
  const finish = minutes !== null && sendAtDate && !d.local && d.when === 'later' ? new Date(sendAtDate.getTime() + minutes * 60_000) : null;

  return (
    <>
      <PageHeader
        crumb={`Marketing / Campaigns / ${c.name}`}
        title="Review & send"
        sub="Every blocker must be cleared before the campaign can be scheduled"
        actions={
          <>
            <Button icon="chevron-left" onClick={() => go(`${base}/content`)}>
              Back to content
            </Button>
            {acts.cancel ? (
              <Button variant="ghost" icon="x-circle" onClick={() => commands.cancel(c, () => go('/marketing/campaigns'))}>
                Cancel campaign
              </Button>
            ) : null}
            {acts.unschedule ? (
              <Button icon="undo" loading={commands.busy === `unschedule:${c.id}`} onClick={() => void commands.unschedule(c)}>
                Unschedule
              </Button>
            ) : null}
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
            {acts.schedule ? (
              <Button variant="primary" icon="calendar" loading={busy === 'schedule'} disabled={whyNot !== null || busy !== null} title={whyNot ?? undefined} onClick={() => (d.when === 'now' ? setSendNow(true) : schedule())}>
                Schedule campaign
              </Button>
            ) : null}
          </>
        }
      />
      <PageBody className="flex flex-col gap-4">
        {refusal !== null ? (
          <Notice
            tone="warning"
            icon="lock"
            action={
              <Button size="sm" icon="send" onClick={() => setAsking(true)}>
                Request approval
              </Button>
            }
          >
            You can’t schedule campaigns yourself: {refusal} Someone who can send may schedule it, or you can ask for approval.
          </Notice>
        ) : null}
        <StateNote campaign={c} onReport={() => go(`${base}/report`)} />
        {editable && whyNot && checked ? (
          <p className="-mb-1 text-[12px] text-ink-3" aria-live="polite">
            {whyNot}
          </p>
        ) : null}
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
          <div className="flex min-w-0 flex-col gap-4">
            <CheckPanel check={check} checkable={checkable} />
            <Panel title="Sender & subject" action={editable && senderDirty ? <span className="text-[11.5px] font-semibold text-warning">Unsaved</span> : null}>
              <form
                noValidate
                className="grid gap-3 sm:grid-cols-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  saveSender();
                }}
              >
                <Field label="From name">
                  <Input value={s.from_name} onChange={(e) => patchS({ from_name: e.target.value })} maxLength={120} disabled={!editable} />
                </Field>
                <Field label="From address" error={tried ? errs.from_email : null}>
                  <Input type="email" value={s.from_email} onChange={(e) => patchS({ from_email: e.target.value })} className="font-mono" disabled={!editable} />
                </Field>
                <Field label="Reply-to" error={tried ? errs.reply_to : null}>
                  <Input type="email" value={s.reply_to} onChange={(e) => patchS({ reply_to: e.target.value })} className="font-mono" disabled={!editable} />
                </Field>
                <Field label={abSubject ? 'Subject (A)' : 'Subject'}>
                  <Input value={s.subject} onChange={(e) => patchS({ subject: e.target.value })} maxLength={200} disabled={!editable} />
                </Field>
                {abSubject ? (
                  <Field label="Subject (B)" className="sm:col-span-2" hint="The other subject line in the test." error={tried && !s.subject_b.trim() ? 'Write the second subject line to test.' : null}>
                    <Input value={s.subject_b} onChange={(e) => patchS({ subject_b: e.target.value })} maxLength={200} disabled={!editable} />
                  </Field>
                ) : null}
                <Field label="Preview text" className="sm:col-span-2">
                  <Input value={s.preview_text} onChange={(e) => patchS({ preview_text: e.target.value })} maxLength={200} disabled={!editable} />
                </Field>
                {editable ? (
                  <div className="flex justify-end sm:col-span-2">
                    <Button type="submit" icon="check" loading={busy === 'save'} disabled={!senderDirty || busy !== null}>
                      Save
                    </Button>
                  </div>
                ) : null}
              </form>
            </Panel>
            <Panel
              title="Test sends"
              sub={`Up to ${maxTests} per campaign, with one contact’s merge values. Tests can go while blockers stand.`}
              action={
                <Button size="sm" icon="send" disabled={!checkable || testsLeft === 0} onClick={() => setTesting(true)}>
                  Send test
                </Button>
              }
            >
              <p className="text-[12.5px] text-ink-2">{c.tests_sent ? `${count(c.tests_sent)} of ${count(maxTests)} sent · ${count(testsLeft)} left` : `None sent yet · ${count(maxTests)} allowed`}</p>
            </Panel>
          </div>
          <div className="flex min-w-0 flex-col gap-4">
            <AudiencePanel audience={audience} />
            <Panel title="Delivery" bodyClassName="flex flex-col gap-3.5">
              <SwitchRow
                label="A/B test subject line"
                describe={`Test ${d.share}% (10–50%), pick winner by human opens after ${d.hours} h (1–72 h)`}
                checked={d.ab}
                disabled={!editable}
                onChange={(ab) => patchD({ ab, kind: ab && !c.ab?.enabled ? 'subject' : d.kind })}
              />
              {d.ab ? (
                <div className="flex flex-col gap-2.5 rounded-[10px] border border-line bg-subtle/50 p-3">
                  {d.kind === 'content' ? <Notice>This campaign’s test varies the content rather than the subject.</Notice> : null}
                  <div className="flex flex-wrap gap-x-4 gap-y-2">
                    <label className="flex items-center gap-2 text-[12.5px] text-ink-2">
                      Test share
                      <NumberField value={d.share} onValueChange={(share) => patchD({ share })} min={10} max={50} unit="%" size="sm" width={92} invalid={!shareOk} disabled={!editable} aria-label="Test share, 10 to 50 percent" />
                    </label>
                    <label className="flex items-center gap-2 text-[12.5px] text-ink-2">
                      Winner after
                      <NumberField value={d.hours} onValueChange={(hours) => patchD({ hours })} min={1} max={72} unit="h" size="sm" width={84} invalid={!hoursOk} disabled={!editable} aria-label="Hours before the winner is picked, 1 to 72" />
                    </label>
                  </div>
                  <fieldset className="flex flex-col gap-1">
                    <legend className="mb-0.5 text-[12px] font-semibold text-ink-2">Pick the winner by</legend>
                    <Radio name={`ab-metric-${c.id}`} checked={d.metric === 'opens'} disabled={!editable} onChange={() => patchD({ metric: 'opens' })}>
                      Human opens
                    </Radio>
                    <Radio name={`ab-metric-${c.id}`} checked={d.metric === 'clicks'} disabled={!editable || c.ab?.metric !== 'clicks'} onChange={() => patchD({ metric: 'clicks' })}>
                      Clicks {c.ab?.metric === 'clicks' ? null : <Planned />}
                    </Radio>
                  </fieldset>
                  <p className="text-[11.5px] text-ink-3">
                    Each subject goes to half of the test share; after {d.hours || '…'} h the one with more human opens goes to everyone else. A tie keeps A. Machine opens never count.
                  </p>
                </div>
              ) : null}
              <SwitchRow
                label="Send in recipient local time"
                describe={sending ? `Falls back to company zone ${sending.default_time_zone}` : 'Falls back to the company’s time zone'}
                checked={d.local}
                disabled={!editable}
                onChange={(local) => patchD({ local })}
              />
              {d.local && audience.data?.other_zones ? <p className="-mt-2 text-[11.5px] text-ink-3">{plural(audience.data.other_zones, 'recipient')} in another time zone will get it at that hour where they are.</p> : null}
              <fieldset className="flex flex-col gap-1.5" disabled={!editable}>
                <legend className="mb-0.5 text-[12px] font-semibold text-ink-2">When</legend>
                <div className="flex flex-wrap gap-x-4 gap-y-1">
                  <Radio name={`when-${c.id}`} checked={d.when === 'now'} onChange={() => patchD({ when: 'now' })}>
                    Send now
                  </Radio>
                  <Radio name={`when-${c.id}`} checked={d.when === 'later'} onChange={() => patchD({ when: 'later' })}>
                    At a date and time
                  </Radio>
                </div>
              </fieldset>
              {d.when === 'later' ? (
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Date">
                    <Input type="date" value={d.date} onChange={(e) => patchD({ date: e.target.value })} disabled={!editable} className="font-mono" />
                  </Field>
                  <Field label="Time">
                    <Input type="time" value={d.time} onChange={(e) => patchD({ time: e.target.value })} disabled={!editable} className="font-mono" />
                  </Field>
                </div>
              ) : null}
              <p className="text-[11.5px] leading-snug text-ink-3">
                {sending ? `Paced at ${count(sending.hourly_pace)}/h through the relay (priority ${sending.relay_priority}).` : 'Paced through the relay, below transactional mail.'}
                {minutes !== null ? (finish && sendAtDate ? ` Estimated finish ${finishOf(sendAtDate, finish)}.` : ` About ${duration(minutes)} once it starts.`) : null}
                {sending ? ` Auto-pause if bounces exceed ${pct(sending.bounce_guard_percent, 0)}.` : ' Auto-pause if bounces pass the guard.'}
              </p>
            </Panel>
          </div>
        </div>
      </PageBody>
      {testing ? <TestSendModal campaign={c} onClose={() => setTesting(false)} /> : null}
      {sendNow ? (
        <Confirm title="Send it now?" action="Send now" busy={busy === 'schedule'} onYes={schedule} onClose={() => setSendNow(false)}>
          Sending starts at once{recipients ? ` to ${plural(recipients, 'recipient')}` : ''}, paced through the relay. It can be paused, but what has gone cannot be called back.
        </Confirm>
      ) : null}
      {asking ? <ApprovalModal campaign={c} onClose={() => setAsking(false)} /> : null}
      {commands.dialog}
    </>
  );
}

/** What the state means here, past draft. */
function StateNote({ campaign: c, onReport }: { campaign: Campaign; onReport: () => void }) {
  if (c.status === 'draft') return null;
  if (c.status === 'scheduled')
    return (
      <Notice tone="violet" icon="calendar">
        Scheduled for {when(c.scheduled_at)}
        {c.local_time ? ' in each recipient’s local time' : ''}. Unschedule it to change anything.
      </Notice>
    );
  if (c.status === 'paused' && c.paused_reason === 'bounce_guard')
    return (
      <Notice tone="warning">
        The bounce guard paused this campaign at {pct(c.bounce_rate)} bounces. It stays paused until a person resumes it — check the bounces in the report first.
      </Notice>
    );
  return (
    <Notice
      icon="info"
      action={
        <Button size="sm" icon="chart" onClick={onReport}>
          Report
        </Button>
      }
    >
      This campaign is {campaignStatus(c.status).label.toLowerCase()}; what it sends can no longer change.
    </Notice>
  );
}

function CheckRow({ kind, check }: { kind: 'blocker' | 'warning' | 'passed'; check: Check }) {
  return (
    <li className="flex items-start gap-2.5 border-b border-line py-2 last:border-b-0">
      <Icon name={kind === 'passed' ? 'check' : 'warning'} size={16} className={cx('mt-0.5 shrink-0', kind === 'blocker' ? 'text-danger' : kind === 'warning' ? 'text-warning' : 'text-success')} />
      <div className="min-w-0">
        <div className="text-[12.5px] font-semibold text-ink">{kind === 'blocker' ? `Blocker · ${check.title}` : kind === 'warning' ? `Warning · ${check.title}` : check.title}</div>
        {check.detail ? <div className="text-[11.5px] break-words text-ink-3">{check.detail}</div> : null}
      </div>
    </li>
  );
}

function CheckPanel({ check, checkable }: { check: UseQueryResult<CheckResult>; checkable: boolean }) {
  const n = check.data?.blockers.length ?? 0;
  return (
    <Panel
      title="Pre-send check"
      action={
        checkable ? (
          <div className="flex shrink-0 items-center gap-2">
            {check.data && !check.isFetching ? n ? <Status tone="danger">{plural(n, 'blocker')}</Status> : <Status tone="success">No blockers</Status> : null}
            <Button size="sm" variant="ghost" icon="refresh" loading={check.isFetching} onClick={() => void check.refetch()}>
              Run again
            </Button>
          </div>
        ) : null
      }
    >
      {!checkable ? (
        <p className="text-[12.5px] text-ink-3">The check is for campaigns not yet sending.</p>
      ) : check.isLoading ? (
        <Spinner label="Checking…" />
      ) : check.error ? (
        <Refused error={check.error} what="The pre-send check" onRetry={() => void check.refetch()} />
      ) : check.data ? (
        <ul aria-label="Check results" aria-busy={check.isFetching || undefined} className={cx('flex flex-col', check.isFetching && 'opacity-60')}>
          {check.data.blockers.map((x) => (
            <CheckRow key={`b-${x.code}`} kind="blocker" check={x} />
          ))}
          {check.data.warnings.map((x) => (
            <CheckRow key={`w-${x.code}`} kind="warning" check={x} />
          ))}
          {check.data.passed.map((x) => (
            <CheckRow key={`p-${x.code}`} kind="passed" check={x} />
          ))}
        </ul>
      ) : null}
    </Panel>
  );
}

const minus = (n: number) => (n > 0 ? `−${count(n)}` : '0');

function AudiencePanel({ audience }: { audience: UseQueryResult<AudienceSummary> }) {
  return (
    <Panel title="Audience">
      <Loaded q={audience} what="The audience">
        {(a) => (
          <>
            <div className="font-mono text-[28px] leading-tight font-bold text-ink tabular-nums">{count(a.recipients)}</div>
            <div className="mb-2 text-[12px] text-ink-3">recipients after exclusions</div>
            {a.recipients === 0 ? (
              <Notice tone="danger" className="mb-2">
                Nobody would receive it. Add lists or segments in Setup.
              </Notice>
            ) : null}
            {a.sources.map((x) => (
              <Row key={`${x.kind}-${x.id}`} label={x.kind === 'list' ? `List: ${x.name}` : x.kind === 'segment' ? `Segment: ${x.name}` : `Topic: ${x.name}`}>
                <Mono>{count(x.count)}</Mono>
              </Row>
            ))}
            <Row label="Duplicates removed">
              <Mono>{minus(a.duplicates_removed)}</Mono>
            </Row>
            <Row label="Suppressed / unsubscribed">
              <Mono>{minus(a.suppressed + a.unsubscribed)}</Mono>
            </Row>
            <Row label="Not subscribed to topic">
              <Mono>{minus(a.not_in_topic)}</Mono>
            </Row>
            <Row label="No consent">
              <Mono>{minus(a.no_consent)}</Mono>
            </Row>
          </>
        )}
      </Loaded>
    </Panel>
  );
}

function SwitchRow({ label, describe, checked, disabled, onChange }: { label: string; describe: string; checked: boolean; disabled?: boolean; onChange: (v: boolean) => void }) {
  const id = useId();
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <div className="text-[12.5px] font-semibold text-ink">{label}</div>
        <div id={id} className="text-[11.5px] text-ink-3">
          {describe}
        </div>
      </div>
      <Switch label={label} checked={checked} disabled={disabled} describedBy={id} onChange={onChange} />
    </div>
  );
}

function Radio({ name, checked, disabled, onChange, children }: { name: string; checked: boolean; disabled?: boolean; onChange: () => void; children: ReactNode }) {
  return (
    <label className={cx('flex items-center gap-2 text-[12.5px] text-ink', disabled ? 'opacity-60' : 'cursor-pointer')}>
      <input type="radio" name={name} checked={checked} disabled={disabled} onChange={onChange} className="h-3.5 w-3.5 accent-primary" />
      <span className="inline-flex items-center gap-1.5">{children}</span>
    </label>
  );
}

function ApprovalModal({ campaign, onClose }: { campaign: Campaign; onClose: () => void }) {
  const org = useMarketingOrg();
  const qc = useQueryClient();
  const titleId = useId();
  const [note, setNote] = useState('');
  const [busy, run] = useAction();
  const send = () =>
    void run('approval', async () => {
      const r = await requestApproval(campaign.id, note.trim() || null);
      if (!r.offered) {
        toast('info', r.message);
        return;
      }
      toast('success', 'Approval requested. You’ll be told when someone decides.');
      void qc.invalidateQueries({ queryKey: MK.campaign(org, campaign.id) });
      onClose();
    });
  return (
    <Modal
      title="Request approval"
      labelledBy={titleId}
      onClose={onClose}
      width={480}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" icon="send" loading={busy === 'approval'} onClick={send}>
            Request approval
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <p className="text-[12.5px] text-ink-2">
          Someone who may send campaigns is asked to approve <b className="text-ink">{campaign.name}</b> as it is now. Its delivery settings are saved with it.
        </p>
        <Field label="Note for the approver" hint="Optional.">
          <TextArea value={note} onChange={(e) => setNote(e.target.value)} rows={3} maxLength={1000} />
        </Field>
      </div>
    </Modal>
  );
}
