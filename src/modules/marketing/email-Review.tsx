import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { apiGet } from '../../core/api';
import { currentZone, wallToUtc } from '../../core/time';
import { toast } from '../../core/toasts';
import { Icon } from '../../components/Icon';
import { ErrorNote, Spinner, cx } from '../../components/ui';
import { refreshMarketing, send, withOrg } from './api';
import { AB_DEFAULTS, type Draft, type SetDraft } from './email-draft';
import { Confirm, SwitchRow, useLists, useSegmentNames, useTopics } from './email-kit';
import { AudienceLines, SenderFields } from './email-Setup';
import { Card, Field, Pill, Seg, Sheet, btn, btnPrimary, input, n } from './parts';
import { refusal, type CampaignCheck, type CampaignDetail, type ContactRow, type Options, type Version } from './types';

/**
 * Review & send (DK08): the server's pre-send check — blockers in red,
 * warnings in amber, what passed in green — who it is from and what the inbox
 * shows, who it reaches after every exclusion, and when it goes.
 *
 * The check reads the campaign as SAVED, and that is what is sent, so nothing
 * goes while a change is still on its way to the server; and nothing can be
 * scheduled while the check names a blocker. The server checks again when it
 * is asked to send, whatever this screen shows.
 */
export function ReviewStep({ campaign, d, set, errors, options, check, dirty, saving, autosave, edit, onStep, onTest }: {
  campaign: CampaignDetail;
  d: Draft;
  set: SetDraft;
  errors: Record<string, string>;
  options: Options;
  check: UseQueryResult<CampaignCheck>;
  dirty: boolean;
  saving: boolean;
  /** Whether changes save themselves (a draft), or wait for Save (a scheduled campaign). */
  autosave: boolean;
  edit: boolean;
  onStep: (step: 'setup' | 'content' | 'review') => void;
  onTest: () => void;
}) {
  const org = String(campaign.org_id);
  const lists = useLists(org);
  const segments = useSegmentNames(org);
  const topics = useTopics(org);
  const [when, setWhen] = useState(nextHour);
  const [local, setLocal] = useState(false);
  const [asking, setAsking] = useState<'now' | 'later' | null>(null);
  const [busy, setBusy] = useState(false);
  const c = check.data;
  const blockers = c?.blockers ?? [];
  const limits = options.ab_limits ?? AB_DEFAULTS;
  const canLaunch = campaign.can.launch && edit;
  const ready = !!c && blockers.length === 0 && !dirty && !saving;
  const minutes = toMinutes(when.time);
  const typed = /^\d{4}-\d{2}-\d{2}$/.test(when.date) && minutes !== null;
  const useLocal = local && !d.ab_on;
  const pace = c?.pace ?? (Number(d.pace_per_hour) || options.sending?.pace || 0);
  const topicName = (topics.data?.items ?? []).find((t) => String(t.id) === d.topic_id)?.name ?? null;

  const go = async (later: boolean) => {
    if (later && (!typed || minutes === null)) return;
    setBusy(true);
    try {
      const body = !later ? {} : useLocal ? { at: `${when.date} ${when.time}`, local: true } : { at: wallToUtc(when.date, minutes!) };
      const r = await send('POST', `/api/marketing/campaigns/${campaign.id}/send`, body);
      toast('success', r.message ?? (later ? 'Scheduled.' : 'Sending.'));
      setAsking(null);
      void refreshMarketing();
    } catch (e) {
      toast('error', refusal(e));
    } finally {
      setBusy(false);
    }
  };

  const finish = typed && minutes !== null && pace > 0 && c ? clock(minutes + Math.ceil((c.audience.final / pace) * 60)) : null;
  const final = c?.audience.final ?? 0;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h2 className="m-0 text-[18px] font-bold text-ink">Review &amp; send</h2>
          <p className="m-0 text-[12.5px] text-ink-3">Every blocker must be cleared before the campaign can be scheduled.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" className={btn} onClick={() => onStep('content')}>
            Back to content
          </button>
          {canLaunch ? (
            <button type="button" className={btnPrimary} disabled={!ready || !typed || busy} onClick={() => setAsking('later')} title={!ready ? 'Clear every blocker first' : undefined}>
              <Icon name="calendar" size={15} /> Schedule campaign
            </button>
          ) : null}
        </div>
      </div>

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="flex min-w-0 flex-col gap-4">
          <Card
            title="Pre-send check"
            action={
              c ? (
                blockers.length ? <Pill tone="red">{blockers.length === 1 ? '1 blocker' : `${blockers.length} blockers`}</Pill> : <Pill tone="green">Ready</Pill>
              ) : null
            }
          >
            {dirty || saving ? (
              <p role="status" className="m-0 text-[12.5px] text-ink-3">
                {saving || autosave ? 'Saving your changes' : 'Save your changes first (Save, at the top)'}: the check reads the campaign as it is saved, and that is what is sent.
              </p>
            ) : check.isLoading ? (
              <Spinner label="Checking…" />
            ) : !c ? (
              <ErrorNote error={new Error(refusal(check.error, 'The check could not be run.'))} onRetry={() => void check.refetch()} />
            ) : (
              <ul aria-label="Pre-send check" className="m-0 flex list-none flex-col p-0">
                {blockers.map((b) => <CheckItem key={`b-${b}`} kind="blocker" text={b} />)}
                {c.warnings.map((w) => <CheckItem key={`w-${w}`} kind="warning" text={w} />)}
                {(c.passed ?? []).map((p) => <CheckItem key={`p-${p}`} kind="passed" text={p} />)}
                {!c.passed && blockers.length === 0 && c.warnings.length === 0 ? <CheckItem kind="passed" text="Nothing stops it." /> : null}
              </ul>
            )}
          </Card>
          <Card title="Sender & subject">
            <SenderFields orgId={campaign.org_id} d={d} set={set} errors={errors} edit={edit} compact />
          </Card>
        </div>

        <div className="flex min-w-0 flex-col gap-4">
          <Card title="Audience">
            {c ? (
              <>
                <b className="block text-[28px] leading-tight text-ink tabular-nums">{n(final)}</b>
                <span className="mb-2 block text-[12px] text-ink-3">recipients after exclusions</span>
                <AudienceLines check={c} audience={d.audience} lists={lists.data?.items} segments={segments.data?.items} topicName={topicName} />
              </>
            ) : (
              <p className="m-0 text-[12.5px] text-ink-3">{dirty || saving ? 'Counted once your changes are saved.' : 'Counted by the check.'}</p>
            )}
          </Card>

          <Card title="Delivery">
            <SwitchRow
              label="A/B test subject line"
              hint={
                <>
                  Test {d.ab_share || limits.share}% ({limits.share_min}–{limits.share_max}%), pick winner by {d.ab_metric === 'clicks' ? 'clicks' : 'human opens'} after {d.ab_hours || limits.hours} h (1–{limits.hours_max} h).{' '}
                  {d.ab_on ? (
                    <button type="button" className="font-bold text-primary hover:underline" onClick={() => onStep('setup')}>
                      Set up version B
                    </button>
                  ) : null}
                </>
              }
              checked={d.ab_on}
              onChange={(v) => set('ab_on', v)}
              disabled={!edit}
            />
            <SwitchRow
              label="Send in recipient local time"
              hint={d.ab_on ? 'Not with an A/B test: the others would wait for the winner past their time.' : `Worked out from each person’s country. Where it spans several zones, or none is known, the company’s own clock.`}
              checked={useLocal}
              onChange={setLocal}
              disabled={d.ab_on || !canLaunch}
            />
            <div className="mt-2 grid grid-cols-2 gap-2">
              <Field label="Date">
                <input className={input} type="date" value={when.date} onChange={(e) => setWhen({ ...when, date: e.target.value })} disabled={!canLaunch} />
              </Field>
              <Field label="Time">
                <input className={input} type="time" value={when.time} onChange={(e) => setWhen({ ...when, time: e.target.value })} disabled={!canLaunch} />
              </Field>
            </div>
            <p className="m-0 mt-2 text-[12px] text-ink-3">
              {useLocal ? 'At that time in each person’s own time zone. ' : `On your clock (${currentZone()}). `}
              {pace ? `Paced at ${n(pace)}/h through the relay${options.sending ? ` (priority ${options.sending.priority})` : ''}. ` : ''}
              {finish && !useLocal ? `Estimated finish ${finish}. ` : ''}
              {options.sending?.bounce_guard ? `Auto-pause if bounces exceed ${options.sending.bounce_guard}%.` : ''}
            </p>
            {canLaunch ? (
              <div className="mt-3 flex flex-wrap gap-2 border-t border-line pt-3">
                <button type="button" className={btn} onClick={onTest} disabled={!edit}>
                  <Icon name="send" size={15} /> Send test
                </button>
                <button type="button" className={btn} disabled={!ready || busy} onClick={() => setAsking('now')}>
                  Send now
                </button>
              </div>
            ) : (
              <p className="m-0 mt-2 text-[12px] text-ink-3">Sending needs permission to send campaigns.</p>
            )}
          </Card>
        </div>
      </div>

      {asking ? (
        <Confirm
          title={asking === 'later' ? 'Schedule this campaign?' : 'Send this campaign now?'}
          yes={busy ? 'Working…' : asking === 'later' ? 'Schedule' : 'Send now'}
          busy={busy}
          onClose={() => setAsking(null)}
          onYes={() => void go(asking === 'later')}
        >
          {asking === 'later' && useLocal
            ? `It arrives at ${when.time} on ${when.date} in each person’s own time zone — about ${n(final)} people today. Where that time has already passed, it goes at once.`
            : asking === 'later'
              ? `It goes at ${when.time} on ${when.date} to everybody its audience reaches then — about ${n(final)} today.`
              : `${n(final)} ${final === 1 ? 'person' : 'people'} will get it, over the next minutes${final > pace ? ' and hours' : ''}.`}
        </Confirm>
      ) : null}
    </div>
  );
}

/** One line of the check: its first sentence as the heading, the rest under it. */
function CheckItem({ kind, text }: { kind: 'blocker' | 'warning' | 'passed'; text: string }) {
  const cut = text.search(/[.:]\s/);
  const head = cut > 0 && cut < text.length - 2 ? text.slice(0, cut + 1) : text;
  const rest = head === text ? '' : text.slice(head.length).trim();
  const tone = kind === 'blocker' ? 'text-danger' : kind === 'warning' ? 'text-[#9A4A06] dark:text-warning' : 'text-success';
  return (
    <li className="flex gap-2.5 border-b border-line/70 py-2 last:border-b-0">
      <Icon name={kind === 'passed' ? 'check' : 'warning'} size={16} className={cx('mt-0.5 shrink-0', tone)} />
      <span className="min-w-0">
        <b className={cx('block text-[13px]', kind === 'passed' ? 'text-ink' : tone)}>
          {kind === 'blocker' ? 'Blocker · ' : kind === 'warning' ? 'Warning · ' : ''}
          {head}
        </b>
        {rest ? <span className="block text-[12px] text-ink-3">{rest}</span> : null}
      </span>
    </li>
  );
}

/** The next whole hour on the reader's clock, as the date and time fields hold it. */
function nextHour(): { date: string; time: string } {
  const t = new Date(Date.now() + 60 * 60_000);
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: currentZone(), year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' }).formatToParts(t);
  const g = (k: string) => parts.find((p) => p.type === k)?.value ?? '00';
  return { date: `${g('year')}-${g('month')}-${g('day')}`, time: `${g('hour')}:00` };
}

function toMinutes(time: string): number | null {
  const m = /^(\d{2}):(\d{2})/.exec(time);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

function clock(minutes: number): string {
  const days = Math.floor(minutes / 1440);
  const m = minutes % 1440;
  const hhmm = `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
  return days === 0 ? hhmm : `${hhmm}, ${days === 1 ? 'the next day' : `${days} days later`}`;
}

/**
 * A test before the real thing: up to the server's limit of addresses, filled
 * in with a real contact's details (the check's choice, or one you search
 * for), marked [Test], and counted nowhere.
 */
export function SendTest({ campaign, limit, sample, onClose }: { campaign: CampaignDetail; limit: number; sample: number | null; onClose: () => void }) {
  const [to, setTo] = useState('');
  const [typed, setTyped] = useState('');
  const [q, setQ] = useState('');
  const [who, setWho] = useState<number | null>(sample);
  const [version, setVersion] = useState<Version | 'both'>('both');
  const [busy, setBusy] = useState(false);
  const ab = !!campaign.ab;
  const addresses = to.split(/[,;\s]+/).map((x) => x.trim()).filter(Boolean);
  const bad = addresses.filter((a) => !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(a));

  useEffect(() => {
    const t = setTimeout(() => setQ(typed.trim()), 300);
    return () => clearTimeout(t);
  }, [typed]);

  const people = useQuery({
    queryKey: ['marketing', 'contacts', 'sample', campaign.org_id, q],
    queryFn: ({ signal }) => apiGet<{ items: ContactRow[] }>('/api/marketing/contacts', withOrg(String(campaign.org_id), { q, per_page: 6 }), signal),
    enabled: q.length >= 2,
  });

  const go = async () => {
    setBusy(true);
    try {
      const r = await send('POST', `/api/marketing/campaigns/${campaign.id}/test`, { to: addresses, sample_id: who, ...(ab ? { version } : {}) });
      toast('success', r.message ?? 'Test sent.');
      onClose();
    } catch (e) {
      toast('error', refusal(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet
      title="Send a test"
      width={500}
      onClose={onClose}
      footer={
        <>
          <button type="button" className={btn} onClick={onClose}>
            Cancel
          </button>
          <button type="button" className={btnPrimary} disabled={busy || addresses.length === 0 || addresses.length > limit || bad.length > 0} onClick={() => void go()}>
            <Icon name="send" size={15} /> {busy ? 'Sending…' : 'Send the test'}
          </button>
        </>
      }
    >
      <Field label="To" hint={`Up to ${limit} ${limit === 1 ? 'address' : 'addresses'}, separated by commas. Marked [Test]; nothing in it is counted.`}>
        <input className={input} value={to} onChange={(e) => setTo(e.target.value)} placeholder="you@example.com, colleague@example.com" />
      </Field>
      <p className={cx('m-0 text-[12px]', addresses.length > limit || bad.length ? 'text-danger' : 'text-ink-3')} role="status">
        {bad.length ? `Not an address: ${bad.join(', ')}` : `${addresses.length} of ${limit} allowed addresses`}
      </p>
      {ab ? (
        <Field label="Which version">
          <Seg<Version | 'both'> label="Which version" value={version} onChange={setVersion} options={[{ id: 'both', label: 'A and B' }, { id: 'a', label: 'A' }, { id: 'b', label: 'B' }]} />
        </Field>
      ) : null}
      <fieldset className="m-0 flex flex-col gap-1.5 border-0 p-0">
        <legend className="mb-1 text-[12.5px] font-semibold text-ink">Fill it in as</legend>
        {sample ? (
          <label className="flex items-center gap-2 text-[13px] text-ink">
            <input type="radio" name="test-sample" className="accent-primary" checked={who === sample} onChange={() => setWho(sample)} />
            One of its recipients, chosen by the check
          </label>
        ) : null}
        <label className="flex items-center gap-2 text-[13px] text-ink">
          <input type="radio" name="test-sample" className="accent-primary" checked={who === null} onChange={() => setWho(null)} />
          A sample person
        </label>
        <input type="search" className={input} value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="Or search for a contact by name or email" aria-label="Search for a sample contact" />
        {people.isFetching ? <Spinner label="Searching…" /> : null}
        {(people.data?.items ?? []).map((p) => (
          <label key={p.id} className="flex items-center gap-2 text-[13px] text-ink">
            <input type="radio" name="test-sample" className="accent-primary" checked={who === p.id} onChange={() => setWho(p.id)} />
            <span className="min-w-0 truncate">
              {p.name}
              {p.email ? <span className="ml-1.5 text-[12px] text-ink-3">{p.email}</span> : null}
            </span>
          </label>
        ))}
        {q.length >= 2 && people.isSuccess && (people.data?.items ?? []).length === 0 ? <p className="m-0 text-[12px] text-ink-3">No contact matches.</p> : null}
      </fieldset>
    </Sheet>
  );
}
