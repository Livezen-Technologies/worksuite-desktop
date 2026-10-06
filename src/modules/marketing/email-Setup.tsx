import { useQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { apiGet } from '../../core/api';
import { Checkbox } from '../../components/Checkbox';
import { Select } from '../../components/Select';
import { Spinner, cx } from '../../components/ui';
import { AB_DEFAULTS, type Draft, type SetDraft } from './email-draft';
import { SwitchRow, useLists, useSegmentNames, useTopics } from './email-kit';
import { Card, Field, Line, input, n } from './parts';
import type { Audience, CampaignCheck, MarketingList, Options, Segment, Senders } from './types';

/**
 * The campaign's Setup step: what it is and what it is about, who it goes to
 * and who is left out, who it is from and what the inbox shows, an A/B test,
 * and how fast it goes.
 *
 * Who it actually reaches is the server's count — consent, suppression,
 * topic opt-outs and earlier bounces taken off — read from the check of the
 * campaign as saved; the screen never counts it itself.
 */
export interface StepProps {
  orgId: number;
  d: Draft;
  set: SetDraft;
  errors: Record<string, string>;
  options: Options;
  edit: boolean;
}

export function SetupStep({ orgId, d, set, errors, options, edit, check, checking, dirty }: StepProps & { check: CampaignCheck | undefined; checking: boolean; dirty: boolean }) {
  const lists = useLists(String(orgId));
  const segments = useSegmentNames(String(orgId));
  const topics = useTopics(String(orgId));
  const mineL = (lists.data?.items ?? []).filter((l) => l.org_id === orgId && !l.archived);
  const mineS = (segments.data?.items ?? []).filter((s) => s.org_id === orgId);
  /* The live topics, and the campaign's own even if it has since been archived. */
  const mineT = (topics.data?.items ?? []).filter((t) => t.org_id === orgId && (!t.archived || String(t.id) === d.topic_id));
  const topicName = mineT.find((t) => String(t.id) === d.topic_id)?.name ?? null;
  const limits = options.ab_limits ?? AB_DEFAULTS;

  const toggle = (key: keyof Audience, id: number) => {
    const now = d.audience[key];
    set('audience', { ...d.audience, [key]: now.includes(id) ? now.filter((x) => x !== id) : [...now, id] });
  };
  const picker = (key: keyof Audience, items: Array<{ id: number; name: string; members?: number | null }>, title: string, empty: string) => (
    <fieldset className="m-0 min-w-0 border-0 p-0">
      <legend className="mb-1 text-[12px] font-bold text-ink-3">{title}</legend>
      {items.length === 0 ? (
        <p className="m-0 text-[12.5px] text-ink-3">{empty}</p>
      ) : (
        <ul className="m-0 flex max-h-56 list-none flex-col gap-1 overflow-y-auto p-0 scroll-thin">
          {items.map((i) => (
            <li key={i.id}>
              <label className="flex items-center gap-2 text-[13px] text-ink">
                <Checkbox checked={d.audience[key].includes(i.id)} onChange={() => toggle(key, i.id)} disabled={!edit} />
                <span className="min-w-0 flex-1 truncate">{i.name}</span>
                {typeof i.members === 'number' ? <span className="text-[11.5px] text-ink-3 tabular-nums">{n(i.members)}</span> : null}
              </label>
            </li>
          ))}
        </ul>
      )}
    </fieldset>
  );

  return (
    <div className="grid items-start gap-4 lg:grid-cols-2">
      <div className="flex min-w-0 flex-col gap-4">
        <Card title="Campaign">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Name" hint="For you and your colleagues; recipients never see it." className="sm:col-span-2">
              <input className={input} value={d.name} onChange={(e) => set('name', e.target.value)} disabled={!edit} maxLength={150} />
            </Field>
            <Field label="Kind">
              <Select aria-label="Kind" value={d.type} onValueChange={(v) => set('type', v)} disabled={!edit} options={[{ value: '', label: 'Not said' }, ...(options.campaign_types ?? [])]} />
            </Field>
            <Field label="Topic" hint={d.topic_id ? 'Whoever opted out of it is left out.' : 'Topics are set under Email › Topics & preferences.'}>
              <Select
                aria-label="Topic"
                value={d.topic_id}
                onValueChange={(v) => set('topic_id', v)}
                disabled={!edit}
                options={[{ value: '', label: 'No topic: everybody subscribed' }, ...mineT.map((t) => ({ value: String(t.id), label: t.archived ? `${t.name} (archived)` : t.name }))]}
              />
            </Field>
            <Field label="Tags" hint="Separated by commas, to find it again." className="sm:col-span-2">
              <input className={input} value={d.tags} onChange={(e) => set('tags', e.target.value)} disabled={!edit} placeholder="q4, expo" />
            </Field>
            {errors.type || errors.topic_id || errors.tags ? <p role="alert" className="m-0 text-[12px] text-danger sm:col-span-2">{errors.type ?? errors.topic_id ?? errors.tags}</p> : null}
          </div>
        </Card>

        <Card title="Audience">
          {lists.isLoading || segments.isLoading ? <Spinner label="Loading lists and segments…" /> : null}
          <div className="grid gap-4 sm:grid-cols-2">
            {picker('lists', mineL, 'Send to — lists', 'This company has no lists yet.')}
            {picker('segments', mineS, 'Send to — segments', 'This company has no segments yet.')}
            {picker('exclude_lists', mineL, 'Leave out — lists', '—')}
            {picker('exclude_segments', mineS, 'Leave out — segments', '—')}
          </div>
          <div className="mt-3 border-t border-line pt-3">
            <h3 className="m-0 mb-1 text-[13px] font-bold text-ink">Who it reaches</h3>
            {dirty ? (
              <p className="m-0 text-[12.5px] text-ink-3">Counted again once your changes are saved.</p>
            ) : checking && !check ? (
              <Spinner label="Counting…" />
            ) : check ? (
              <AudienceLines check={check} audience={d.audience} lists={lists.data?.items} segments={segments.data?.items} topicName={topicName} />
            ) : (
              <p className="m-0 text-[12.5px] text-ink-3">Choose a list or a segment.</p>
            )}
          </div>
        </Card>
      </div>

      <div className="flex min-w-0 flex-col gap-4">
        <Card title="Sender & subject">
          <SenderFields orgId={orgId} d={d} set={set} errors={errors} edit={edit} />
        </Card>

        <Card title="A/B test">
          <SwitchRow
            label="Test two versions"
            hint={`Part of the list gets A, part gets B, and the one more people ${d.ab_metric === 'clicks' ? 'click' : 'open'} goes to everybody else.`}
            checked={d.ab_on}
            onChange={(v) => set('ab_on', v)}
            disabled={!edit}
          />
          {d.ab_on ? (
            <div className="mt-2 grid gap-3 border-t border-line pt-3 sm:grid-cols-3">
              <Field label="Share in the test" hint={`Split evenly between A and B. ${limits.share_min}–${limits.share_max}%.`}>
                <Unit unit="%">
                  <input className={input} type="number" min={limits.share_min} max={limits.share_max} value={d.ab_share} onChange={(e) => set('ab_share', e.target.value)} disabled={!edit} />
                </Unit>
              </Field>
              <Field label="Winner by">
                <Select<'opens' | 'clicks'> aria-label="Winner by" value={d.ab_metric} onValueChange={(v) => set('ab_metric', v)} disabled={!edit} options={[{ value: 'opens', label: 'Human opens' }, { value: 'clicks', label: 'Clicks' }]} />
              </Field>
              <Field label="Decided after" hint={`1–${limits.hours_max} hours, from the test's last copy.`}>
                <Unit unit="h">
                  <input className={input} type="number" min={1} max={limits.hours_max} value={d.ab_hours} onChange={(e) => set('ab_hours', e.target.value)} disabled={!edit} />
                </Unit>
              </Field>
              <Field label="Subject, version B" hint="Empty: the same as A." className="sm:col-span-3">
                <input className={input} value={d.b_subject} onChange={(e) => set('b_subject', e.target.value)} disabled={!edit} maxLength={255} placeholder={d.subject} />
              </Field>
              <Field label="Preview text, version B" hint="Empty: the same as A." className="sm:col-span-2">
                <input className={input} value={d.b_preheader} onChange={(e) => set('b_preheader', e.target.value)} disabled={!edit} maxLength={255} placeholder={d.preheader} />
              </Field>
              <Field label="From name, version B" hint="Empty: the same as A.">
                <input className={input} value={d.b_from_name} onChange={(e) => set('b_from_name', e.target.value)} disabled={!edit} maxLength={150} placeholder={d.from_name} />
              </Field>
              <fieldset className="m-0 flex flex-wrap items-center gap-2 border-0 p-0 sm:col-span-3">
                <legend className="mb-1 text-[12.5px] font-semibold text-ink">Version B’s content</legend>
                {[{ own: false, label: 'The same as A' }, { own: true, label: 'Its own (written under Content)' }].map((o) => (
                  <label key={String(o.own)} className={cx('flex cursor-pointer items-center gap-1.5 rounded-[8px] border px-2.5 py-1 text-[12.5px]', d.b_own === o.own ? 'border-primary bg-selection text-primary' : 'border-line text-ink')}>
                    <input
                      type="radio"
                      name="b-content"
                      className="accent-primary"
                      checked={d.b_own === o.own}
                      disabled={!edit}
                      onChange={() => {
                        /* B's own content starts as a copy of A's, to change from. */
                        if (o.own && d.b_body_html.trim() === '') set('b_body_html', d.body_html);
                        set('b_own', o.own);
                      }}
                    />
                    {o.label}
                  </label>
                ))}
              </fieldset>
              {errors.ab_share || errors.ab_hours || errors.ab_metric ? <p role="alert" className="m-0 text-[12px] text-danger sm:col-span-3">{errors.ab_share ?? errors.ab_hours ?? errors.ab_metric}</p> : null}
            </div>
          ) : null}
        </Card>

        <Card title="Delivery">
          <div className="flex flex-col gap-3">
            <Field label="Emails an hour, at most" hint={`Empty: the company's setting${options.sending?.pace ? ` (${n(options.sending.pace)} an hour)` : ''}. Slower is kinder to a new domain's reputation.`}>
              <input className={input} type="number" min={10} max={100000} value={d.pace_per_hour} onChange={(e) => set('pace_per_hour', e.target.value)} disabled={!edit} placeholder={options.sending?.pace ? String(options.sending.pace) : ''} />
            </Field>
            {errors.pace_per_hour ? <p role="alert" className="m-0 text-[12px] text-danger">{errors.pace_per_hour}</p> : null}
            <label className="flex items-start gap-2 text-[13px] text-ink">
              <Checkbox className="mt-0.5" checked={d.track_opens} onChange={(e) => set('track_opens', e.target.checked)} disabled={!edit} />
              <span>
                Count opens
                <span className="block text-[12px] text-ink-3">A tiny picture in each copy. Apple and Gmail fetch pictures for people who never read the message, so the report counts human opens apart.</span>
              </span>
            </label>
            <label className="flex items-start gap-2 text-[13px] text-ink">
              <Checkbox className="mt-0.5" checked={d.track_clicks} onChange={(e) => set('track_clicks', e.target.checked)} disabled={!edit} />
              <span>
                Count clicks
                <span className="block text-[12px] text-ink-3">Links go through WorkSuite on their way, so a click is known and the person marked as engaged.</span>
              </span>
            </label>
          </div>
        </Card>
      </div>
    </div>
  );
}

function Unit({ unit, children }: { unit: string; children: ReactNode }) {
  return (
    <span className="flex items-center gap-1.5">
      {children}
      <span className="text-[12.5px] text-ink-3">{unit}</span>
    </span>
  );
}

/** The domains this company may send from, and whether each passed its checks. */
export function useSenders(orgId: number) {
  return useQuery({
    queryKey: ['marketing', 'senders', orgId],
    queryFn: ({ signal }) => apiGet<Senders>('/api/marketing/campaigns/senders', { org_id: orgId, org: orgId }, signal),
    retry: false,
    staleTime: 5 * 60_000,
  });
}

/** Who it is from and what the inbox shows: the Setup step's and the review's "Sender & subject". */
export function SenderFields({ orgId, d, set, errors, edit, compact = false }: { orgId: number; d: Draft; set: SetDraft; errors: Record<string, string>; edit: boolean; compact?: boolean }) {
  const senders = useSenders(orgId);
  const domains = senders.data?.domains ?? [];
  const chosen = domains.find((x) => x.domain === d.from_domain);
  const known = domains.some((x) => x.domain === d.from_domain);
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Field label="From name" hint={compact ? undefined : d.ab_on ? 'Who the inbox says it is from. Version B can say otherwise.' : 'Who the inbox says it is from.'}>
        <input className={input} value={d.from_name} onChange={(e) => set('from_name', e.target.value)} disabled={!edit} maxLength={150} />
      </Field>
      <div className="flex min-w-0 flex-col gap-1">
        <span className="text-[12.5px] font-semibold text-ink">From address</span>
        <span className="flex min-w-0 items-center gap-1">
          <input className={cx(input, 'min-w-0 flex-1')} aria-label="From address, before the @" value={d.from_local} onChange={(e) => set('from_local', e.target.value)} disabled={!edit} placeholder="news" />
          <span className="text-ink-3">@</span>
          <span className="min-w-0 flex-1">
            <Select
              aria-label="Sending domain"
              value={d.from_domain}
              onValueChange={(v) => set('from_domain', v)}
              disabled={!edit}
              placeholder="Domain"
              options={[
                ...(!known && d.from_domain ? [{ value: d.from_domain, label: d.from_domain, hint: 'Not one of this company’s' }] : []),
                ...domains.map((x) => ({ value: x.domain, label: x.domain, hint: x.ok ? 'Checked' : 'Not checked', disabled: !x.ok && x.domain !== d.from_domain })),
              ]}
            />
          </span>
        </span>
        {errors.from_email ? <span role="alert" className="text-[11.5px] text-danger">{errors.from_email}</span> : null}
        {chosen && !chosen.ok ? <span role="alert" className="text-[11.5px] text-danger">{chosen.reason}</span> : null}
        {senders.isSuccess && domains.length === 0 ? <span className="text-[11.5px] text-ink-3">This company has no sending domain. An administrator adds one, and has its DNS checked, under Outgoing mail › Domains.</span> : null}
        {senders.error ? <span className="text-[11.5px] text-ink-3">The sending domains could not be loaded.</span> : null}
      </div>
      <Field label="Reply-to" hint={compact ? undefined : 'Empty: to the From address.'}>
        <input className={input} type="email" value={d.reply_to} onChange={(e) => set('reply_to', e.target.value)} disabled={!edit} />
      </Field>
      <Field label={d.ab_on ? 'Subject (A)' : 'Subject'}>
        <input className={input} value={d.subject} onChange={(e) => set('subject', e.target.value)} disabled={!edit} maxLength={255} />
      </Field>
      <Field label="Preview text" hint={compact ? undefined : 'The line an inbox shows after the subject. Merge tags work here too.'} className="sm:col-span-2">
        <input className={input} value={d.preheader} onChange={(e) => set('preheader', e.target.value)} disabled={!edit} maxLength={255} />
      </Field>
      {errors.reply_to || errors.subject || errors.name ? <p role="alert" className="m-0 text-[12px] text-danger sm:col-span-2">{errors.reply_to ?? errors.subject ?? errors.name}</p> : null}
    </div>
  );
}

/** The server's count of who gets it: what the audience names, then each reason somebody is left out. */
export function AudienceLines({ check, audience, lists, segments, topicName }: { check: CampaignCheck; audience: Audience; lists: MarketingList[] | undefined; segments: Segment[] | undefined; topicName: string | null }) {
  const a = check.audience;
  const minus = (v: number | undefined) => (v ? `−${n(v)}` : '0');
  return (
    <div>
      {audience.lists.map((id) => {
        const l = lists?.find((x) => x.id === id);
        return l ? <Line key={`l${id}`} label={`List: ${l.name}`}>{n(l.members)}</Line> : null;
      })}
      {audience.segments.map((id) => {
        const s = segments?.find((x) => x.id === id);
        return s ? <Line key={`s${id}`} label={`Segment: ${s.name}`}>{typeof s.members === 'number' ? n(s.members) : '—'}</Line> : null;
      })}
      <Line label="Named by the audience, once each">{n(a.named)}</Line>
      <Line label="No email address">{minus(a.no_email)}</Line>
      <Line label="Have not agreed to email">{minus(a.no_consent)}</Line>
      <Line label="Suppressed / unsubscribed">{minus(a.suppressed)}</Line>
      {(a.opted_out ?? 0) > 0 || topicName ? <Line label={`Not subscribed to ${topicName ?? 'its topic'}`}>{minus(a.opted_out)}</Line> : null}
      <Line label="Bounced before">{minus(a.bounced)}</Line>
      <Line label="Will get it" strong>{n(a.final)}</Line>
      {check.ab ? <p className="m-0 mt-2 text-[12px] text-ink-3">A to {n(check.ab.a)}, B to {n(check.ab.b)}; the winner to the other {n(check.ab.rest)}.</p> : null}
    </div>
  );
}
