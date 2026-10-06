import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { useTab } from '../../../core/tab-context';
import { Checkbox } from '../../../components/Checkbox';
import { Select, type SelectOption } from '../../../components/Select';
import { Avatar, Button, cx, IconButton, NumberField, Spinner } from '../../../components/ui';
import {
  fetchAgents,
  fetchCallCampaign,
  MK,
  pageOf,
  saveCallCampaign,
  setCallCampaignState,
  useLists,
  useScripts,
  useSegments,
  useSettings,
  type CallCampaign,
  type CallCampaignInput,
  type MarketingSettings,
} from '../api';
import { count } from '../lib/format';
import { useMarketingOrg } from '../org';
import { Field, Input, Mono, Notice, PageBody, PageHeader, Panel, Refused, Row, useAction } from '../parts';

/**
 * A call campaign's setup (WF-12, PDF p31; MKT-CAL-01/02/05/07/13, MKT-CON-03, AC-12). The audience is a list or a
 * segment; whether phone consent is needed is the company's setting, and contacts without it — and do-not-call
 * numbers — are left out of the queue and counted once it starts. Calling hours, optionally in the contact's own time
 * (MKT-CAL-13); retries for no answer and busy (MKT-CAL-05); a versioned script (MKT-CAL-07); agents, of whom only
 * those holding marketing.call.make can claim (MKT-CAL-02). While nobody holds it (B-5) the campaign can still
 * start, and the screen says that nobody will be able to claim. Starting builds the queue.
 */

/** The form as typed: numbers stay text until saved. */
export interface Draft {
  name: string;
  kind: 'list' | 'segment';
  audienceId: number | null;
  from: string;
  to: string;
  local: boolean;
  attempts: string;
  delay: string;
  scriptId: number | null;
  agentIds: number[];
}

export type Problems = Partial<Record<'name' | 'audience' | 'hours' | 'attempts' | 'delay', string>>;

const hhmm = (s: string | null | undefined, d: string) => (s && /^\d{1,2}:\d{2}/.test(s) ? s.padStart(5, '0').slice(0, 5) : d);

/** A campaign as the form starts it: its own values, or the company's call settings for a new one. */
export function draftOf(c: CallCampaign | null, calls: MarketingSettings['calls'] | null): Draft {
  return {
    name: c?.name ?? '',
    kind: c?.audience?.kind ?? 'list',
    audienceId: c?.audience?.id ?? null,
    from: hhmm(c?.hours?.from ?? calls?.hours_from, '09:00'),
    to: hhmm(c?.hours?.to ?? calls?.hours_to, '17:00'),
    local: c?.hours?.contact_local ?? calls?.contact_local ?? true,
    attempts: String(c?.retries?.max_attempts ?? calls?.max_attempts ?? 3),
    delay: String(c?.retries?.delay_hours ?? calls?.retry_delay_hours ?? 24),
    scriptId: c?.script?.id ?? null,
    agentIds: (c?.agents ?? []).map((a) => a.user_id),
  };
}

/** What stops a save, by field. */
export function problemsOf(d: Draft): Problems {
  const p: Problems = {};
  if (!d.name.trim()) p.name = 'Give the campaign a name.';
  if (d.audienceId === null) p.audience = d.kind === 'segment' ? 'Choose a segment.' : 'Choose a list.';
  if (!/^\d{2}:\d{2}$/.test(d.from) || !/^\d{2}:\d{2}$/.test(d.to)) p.hours = 'Set when calling starts and ends.';
  else if (d.from >= d.to) p.hours = 'Calling must end after it starts.';
  const attempts = Number(d.attempts);
  if (d.attempts.trim() === '' || !Number.isInteger(attempts) || attempts < 1 || attempts > 5) p.attempts = 'From 1 to 5 attempts.';
  const delay = Number(d.delay);
  if (d.delay.trim() === '' || !Number.isInteger(delay) || delay < 1) p.delay = 'At least 1 hour.';
  return p;
}

export function inputOf(d: Draft): CallCampaignInput {
  return {
    name: d.name.trim(),
    audience: d.audienceId === null ? null : { kind: d.kind, id: d.audienceId },
    hours: { from: d.from, to: d.to, contact_local: d.local },
    retries: { max_attempts: Number(d.attempts), delay_hours: Number(d.delay) },
    script_id: d.scriptId,
    agent_ids: d.agentIds,
  };
}

export default function CallCampaignEditor({ id }: { id: number | null }) {
  const org = useMarketingOrg();
  const settings = useSettings();
  const existing = useQuery({ queryKey: MK.callCampaign(org, id ?? 0), queryFn: ({ signal }) => fetchCallCampaign(id ?? 0, signal), enabled: id !== null });
  if (id !== null && existing.error) {
    return (
      <Frame id={id}>
        <Refused error={existing.error} what="This call campaign" onRetry={() => void existing.refetch()} />
      </Frame>
    );
  }
  // The company's call settings start a new campaign; wait for them (or their refusal) so the form starts once.
  if (settings.isPending || (id !== null && !existing.data)) {
    return (
      <Frame id={id}>
        <Spinner />
      </Frame>
    );
  }
  const campaign = id !== null ? (existing.data ?? null) : null;
  return <Form key={campaign?.id ?? 'new'} campaign={campaign} settings={settings.data ?? null} />;
}

function Frame({ id, children }: { id: number | null; children: ReactNode }) {
  const { go } = useTab();
  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader crumb="Marketing / Call campaigns" title={id === null ? 'New call campaign' : 'Call campaign'} back={<IconButton icon="back" label="Back" onClick={() => go(id === null ? '/marketing/calls' : `/marketing/calls/${id}`)} />} />
      <PageBody>{children}</PageBody>
    </div>
  );
}

function Form({ campaign, settings }: { campaign: CallCampaign | null; settings: MarketingSettings | null }) {
  const org = useMarketingOrg();
  const qc = useQueryClient();
  const { go } = useTab();
  const [d, setD] = useState<Draft>(() => draftOf(campaign, settings?.calls ?? null));
  const [tried, setTried] = useState(false);
  const [busy, run] = useAction();
  const set = (p: Partial<Draft>) => setD((x) => ({ ...x, ...p }));
  const problems = problemsOf(d);
  const shown: Problems = tried ? problems : {};
  const draft = !campaign || campaign.status === 'draft';
  const back = campaign ? `/marketing/calls/${campaign.id}` : '/marketing/calls';

  const save = async (start: boolean) => {
    setTried(true);
    if (Object.keys(problems).length > 0) return;
    // Remembered outside the action: a campaign saved but refused a start is still opened, never saved twice.
    const saved: { id: number | null } = { id: null };
    await run(
      start ? 'start' : 'save',
      async () => {
        const c = await saveCallCampaign(org, campaign?.id ?? null, inputOf(d));
        saved.id = c.id;
        if (start) await setCallCampaignState(c.id, 'start');
      },
      start ? 'Started. The queue is built from the audience.' : campaign ? 'Saved.' : 'Call campaign created.',
    );
    if (saved.id === null) return;
    void qc.invalidateQueries({ queryKey: MK.callCampaign(org, saved.id) });
    void qc.invalidateQueries({ queryKey: MK.callCampaigns(org) });
    void qc.invalidateQueries({ queryKey: MK.queue(org) });
    go(`/marketing/calls/${saved.id}`);
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader
        crumb="Marketing / Call campaigns"
        title={campaign ? campaign.name : 'New call campaign'}
        sub={draft ? 'Starting builds the queue, checking consent and do-not-call for every contact' : `Call campaign · ${campaign?.status ?? ''}`}
        back={<IconButton icon="back" label="Back" onClick={() => go(back)} />}
        actions={
          <>
            <Button disabled={busy !== null} onClick={() => go(back)}>
              Cancel
            </Button>
            <Button variant={draft ? 'secondary' : 'primary'} icon="check" loading={busy === 'save'} disabled={busy !== null} onClick={() => void save(false)}>
              Save
            </Button>
            {draft ? (
              <Button variant="primary" icon="play" loading={busy === 'start'} disabled={busy !== null} onClick={() => void save(true)}>
                Save and start
              </Button>
            ) : null}
          </>
        }
      />
      <PageBody>
        <div className="mx-auto flex max-w-[860px] flex-col gap-4">
          <Panel title="Campaign" bodyClassName="flex flex-col gap-3">
            <Field label="Name" error={shown.name}>
              <Input value={d.name} onChange={(e) => set({ name: e.target.value })} placeholder="Vendor follow-up calls" autoFocus={!campaign} />
            </Field>
          </Panel>
          <Audience d={d} set={set} campaign={campaign} draft={draft} problem={shown.audience} settings={settings} />
          <Panel title="Calling hours and retries" sub="When contacts are offered to agents, and how often a contact who doesn’t answer is tried again" bodyClassName="flex flex-col gap-4">
            <div className="flex flex-col gap-1">
              <div className="flex flex-wrap items-end gap-3">
                <Field label="From" className="w-[140px]">
                  <Input type="time" value={d.from} onChange={(e) => set({ from: e.target.value })} aria-invalid={shown.hours ? true : undefined} />
                </Field>
                <Field label="To" className="w-[140px]">
                  <Input type="time" value={d.to} onChange={(e) => set({ to: e.target.value })} aria-invalid={shown.hours ? true : undefined} />
                </Field>
                <label className="flex h-9 items-center gap-2 text-[12.5px] text-ink-2">
                  <Checkbox checked={d.local} onChange={(e) => set({ local: e.target.checked })} />
                  In the contact’s local time
                </label>
              </div>
              <span className={cx('text-[11.5px]', shown.hours ? 'text-danger' : 'text-ink-3')}>
                {shown.hours ?? (d.local ? 'Each contact is offered only inside these hours in their own time zone.' : 'Contacts are offered only inside these hours, in the company’s time zone.')}
              </span>
            </div>
            <div className="flex flex-wrap items-start gap-5">
              <Field label="Attempts for no answer or busy" error={shown.attempts} hint="1 to 5, the first call included">
                <NumberField value={d.attempts} onValueChange={(v) => set({ attempts: v })} min={1} max={5} size="sm" width={96} invalid={!!shown.attempts} />
              </Field>
              <Field label="Try again after" error={shown.delay} hint="Hours between attempts">
                <NumberField value={d.delay} onValueChange={(v) => set({ delay: v })} min={1} unit="h" size="sm" width={110} invalid={!!shown.delay} />
              </Field>
            </div>
          </Panel>
          <ScriptPick d={d} set={set} campaign={campaign} />
          <Agents d={d} set={set} campaign={campaign} />
        </div>
      </PageBody>
    </div>
  );
}

type Part = { d: Draft; set: (p: Partial<Draft>) => void; campaign: CallCampaign | null };

function Audience({ d, set, campaign, draft, problem, settings }: Part & { draft: boolean; problem?: string; settings: MarketingSettings | null }) {
  const lists = useLists();
  const segments = useSegments();
  const source = d.kind === 'list' ? lists : segments;
  const own = campaign?.audience && campaign.audience.kind === d.kind ? campaign.audience : null;
  const options: Array<SelectOption<number>> =
    d.kind === 'list'
      ? (lists.data ?? []).map((l) => ({ value: l.id, label: l.name, hint: `${count(l.members_count)} members` }))
      : (segments.data ?? []).map((s) => ({ value: s.id, label: s.name, hint: typeof s.count === 'number' ? `${count(s.count)} contacts` : undefined }));
  if (own && !options.some((o) => o.value === own.id)) options.unshift({ value: own.id, label: own.name });
  const list = d.kind === 'list' ? (lists.data ?? []).find((l) => l.id === d.audienceId) : undefined;
  const needed = settings?.consent.require_phone_consent ?? null;
  return (
    <Panel title="Audience" sub="Turned into the queue when the campaign starts" bodyClassName="flex flex-col gap-3">
      <div className="flex flex-wrap items-end gap-3">
        <div role="radiogroup" aria-label="Audience kind" className="inline-flex h-9 rounded-[9px] bg-subtle p-0.5 text-[12.5px] font-semibold">
          {(['list', 'segment'] as const).map((k) => (
            <button
              key={k}
              type="button"
              role="radio"
              aria-checked={d.kind === k}
              disabled={!draft}
              onClick={() => d.kind !== k && set({ kind: k, audienceId: null })}
              className={cx('rounded-[7px] px-3 disabled:opacity-60', d.kind === k ? 'bg-surface text-ink shadow-sm' : 'text-ink-3 hover:text-ink')}
            >
              {k === 'list' ? 'List' : 'Segment'}
            </button>
          ))}
        </div>
        <Field label={d.kind === 'list' ? 'List' : 'Segment'} error={problem} className="min-w-[240px] flex-1">
          <Select<number>
            value={d.audienceId}
            onValueChange={(v) => set({ audienceId: v })}
            options={options}
            aria-label={d.kind === 'list' ? 'List' : 'Segment'}
            placeholder={source.isPending ? 'Loading…' : d.kind === 'list' ? 'Choose a list…' : 'Choose a segment…'}
            empty={d.kind === 'list' ? 'No lists yet.' : 'No segments yet.'}
            disabled={!draft}
          />
        </Field>
      </div>
      {source.error ? <Refused error={source.error} what={d.kind === 'list' ? 'Lists' : 'Segments'} onRetry={() => void source.refetch()} /> : null}
      {!draft ? <p className="text-[11.5px] text-ink-3">The audience is fixed once the campaign has started: its queue was built from it.</p> : null}
      {list && typeof list.phone_consented_count === 'number' ? (
        <p className="text-[12px] text-ink-2">{`${list.name}: ${count(list.phone_consented_count)} of ${count(list.members_count)} members have phone consent.`}</p>
      ) : null}
      <div className="rounded-[10px] border border-line px-3 py-1">
        <Row label="Requires phone consent before calling">{needed === null ? 'Set in Marketing settings' : needed ? 'Yes (company setting)' : 'No (company setting)'}</Row>
      </div>
      <p className="text-[11.5px] text-ink-3">
        {needed === false
          ? 'Do-not-call numbers are still left out of the queue, and counted on the campaign after it starts.'
          : 'Contacts without phone consent, and do-not-call numbers, are left out of the queue and counted on the campaign after it starts.'}
      </p>
    </Panel>
  );
}

function ScriptPick({ d, set, campaign }: Part) {
  const scripts = useScripts();
  const { go } = useTab();
  const options: Array<SelectOption<number>> = [{ value: 0, label: 'No script' }, ...(scripts.data ?? []).map((s) => ({ value: s.id, label: `${s.name} (v${s.version})` }))];
  const own = campaign?.script ?? null;
  if (own && !options.some((o) => o.value === own.id)) options.push({ value: own.id, label: `${own.name} (v${own.version})` });
  const latest = own ? scripts.data?.find((s) => s.id === own.id) : undefined;
  return (
    <Panel
      title="Script"
      sub="Six sections, versioned: a campaign keeps the version it was started with"
      action={
        <button type="button" className="shrink-0 text-[12.5px] font-semibold text-primary hover:underline" onClick={() => go('/marketing/scripts')}>
          Manage scripts
        </button>
      }
      bodyClassName="flex flex-col gap-2"
    >
      <Field label="Script">
        <Select<number> value={d.scriptId ?? 0} onValueChange={(v) => set({ scriptId: v || null })} options={options} aria-label="Script" />
      </Field>
      {scripts.error ? <Refused error={scripts.error} what="Call scripts" onRetry={() => void scripts.refetch()} /> : null}
      {own && latest && latest.version !== own.version && d.scriptId === own.id ? (
        <p className="text-[11.5px] text-ink-3">{`This campaign uses v${own.version}; v${latest.version} is the latest.`}</p>
      ) : null}
    </Panel>
  );
}

function Agents({ d, set, campaign }: Part) {
  const org = useMarketingOrg();
  const q = useQuery({ queryKey: MK.agents(org), queryFn: ({ signal }) => fetchAgents(org, signal), staleTime: 60_000 });
  const people = q.data ? [...pageOf<{ user_id: number; name: string; can_call: boolean }>(q.data).rows] : [];
  for (const a of campaign?.agents ?? []) if (!people.some((p) => p.user_id === a.user_id)) people.push({ user_id: a.user_id, name: a.name, can_call: a.can_call });
  const nobody = !people.some((p) => p.can_call);
  const toggle = (id: number, on: boolean) => set({ agentIds: on ? [...d.agentIds.filter((x) => x !== id), id] : d.agentIds.filter((x) => x !== id) });
  return (
    <Panel title="Agents" sub="Only people holding marketing.call.make can claim from the queue" bodyClassName="flex flex-col gap-3">
      {q.isPending ? (
        <Spinner />
      ) : q.error ? (
        <Refused error={q.error} what="Choosing agents" onRetry={() => void q.refetch()} />
      ) : people.length === 0 ? (
        <p className="text-[12.5px] text-ink-3">Nobody in this company can be assigned yet.</p>
      ) : (
        <ul className="grid grid-cols-1 gap-1 sm:grid-cols-2">
          {people.map((p) => {
            const on = d.agentIds.includes(p.user_id);
            const locked = !p.can_call && !on;
            return (
              <li key={p.user_id}>
                <label className={cx('flex items-center gap-2.5 rounded-[8px] px-2 py-1.5', locked ? 'opacity-60' : 'cursor-pointer hover:bg-subtle')}>
                  <Checkbox checked={on} disabled={locked} onChange={(e) => toggle(p.user_id, e.target.checked)} />
                  <Avatar name={p.name} size={26} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-medium text-ink">{p.name}</span>
                    {p.can_call ? null : (
                      <span className="block truncate text-[11.5px] text-ink-3">
                        doesn’t hold <Mono>marketing.call.make</Mono>
                      </span>
                    )}
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
      )}
      {!q.isPending && !q.error && nobody ? (
        <Notice tone="warning">Nobody holds marketing.call.make — the campaign can start, but nobody can claim from its queue. Grant it to the call-agent role in Roles & permissions.</Notice>
      ) : null}
      {d.agentIds.length > 0 ? <p className="text-[11.5px] text-ink-3">{`${count(d.agentIds.length)} assigned.`}</p> : null}
    </Panel>
  );
}
