import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Checkbox } from '../../components/Checkbox';
import { Icon } from '../../components/Icon';
import { Select } from '../../components/Select';
import { cx, Spinner } from '../../components/ui';
import { apiGet } from '../../core/api';
import { text } from '../../core/i18n';
import { dateLabel } from '../../core/time';
import { toast } from '../../core/toasts';
import { refreshMarketing, send } from './api';
import type { CallCampaign, CallCampaignDetail, CallResults, CallScript, Reach } from './calls';
import { agentState, CALL_PILL, Caption, ConfirmSheet, FieldError, outcomesOf, useAudienceNames, useCallScripts } from './calls-parts';
import { ScriptSheet } from './calls-scripts';
import { btn, btnPrimary, Card, Empty, Field, Initials, input, Kpi, Line, n, PageHeader, pct, Pill, Sheet } from './parts';
import { companiesWhere, fieldErrors, refusal, type Audience, type Options } from './types';
import { StatGrid } from '../../components/StatCard';

/**
 * One call campaign (MKT-CAL-01…08, MKT-CAL-15; the W10 / DK10 supervisor view): how the queue stands, who is on a
 * call and who is idle, how the calls ended — the ten outcomes — and the rules it calls by. Whoever runs the
 * campaign starts, pauses, resumes and finishes it, brings in people who joined its audience since, and changes its
 * script, hours, retries and agents; an agent on it goes from here to their queue.
 *
 * Before calling starts it is a draft to set up: the audience (lists and segments, and who to leave out), the
 * script, the calling hours in the company's time, how many attempts and how far apart, and who makes the calls.
 * Who of the audience may be called is the server's count — no number, the do-not-call list, and phone consent where
 * the company requires it — and it is shown as the server gave it.
 */
type Act = 'launch' | 'pause' | 'resume' | 'finish' | 'refresh' | 'delete';

const ASK: Partial<Record<Act, { title: (c: CallCampaign, r: Reach | null) => string; body: string; action: string; danger?: boolean }>> = {
  launch: {
    title: (_c, r) => text('Start calling {n} people?', { n: (r?.callable ?? 0).toLocaleString() }),
    body: 'They go into the queue now, for the agents you chose. People who join the audience later come in with “Add new people”.',
    action: 'Start calling',
  },
  finish: {
    title: (c) => text('Finish “{name}”?', { name: c.name }),
    body: 'Whoever has not been called yet is taken out of the queue, and contacts agents hold are let go. Its results stay.',
    action: 'Finish',
  },
  delete: {
    title: (c) => text('Delete the draft “{name}”?', { name: c.name }),
    body: 'Nothing has been called from it.',
    action: 'Delete',
    danger: true,
  },
};

export default function CallCampaignView({ id, options, onBack, onQueue }: { id: number; options: Options; onBack: () => void; onQueue: (id: number) => void }) {
  const q = useQuery({
    queryKey: ['marketing', 'calls', 'campaign', id],
    queryFn: ({ signal }) => apiGet<CallCampaignDetail>(`/api/marketing/calls/campaigns/${id}`, undefined, signal),
    retry: false,
    // The supervisor's view is live while it calls: who is on a call, who is idle.
    refetchInterval: (query) => (query.state.data?.campaign.status === 'active' ? 30_000 : false),
  });
  const scripts = useCallScripts();
  const [busy, setBusy] = useState<Act | null>(null);
  const [ask, setAsk] = useState<Act | null>(null);
  const [editScript, setEditScript] = useState<CallScript | null>(null);
  const [agents, setAgents] = useState(false);
  const data = q.data;
  const audience = useAudienceNames(data?.campaign.org_id ?? null);

  if (q.isLoading) return <Spinner />;
  if (!data) {
    return (
      <div className="flex flex-col gap-3">
        <PageHeader crumbs={['Call campaigns']} title="Call campaign" onCrumb={onBack} />
        <Card>
          <Empty text={refusal(q.error, 'That call campaign could not be found.')} />
        </Card>
      </div>
    );
  }

  const camp = data.campaign;
  const r = data.results;
  const reach = data.reach;
  const manage = data.can.manage;
  const draft = camp.status === 'draft';
  const running = camp.status === 'active' || camp.status === 'paused';
  const editable = manage && (draft || running);
  const script = (scripts.data?.items ?? []).find((s) => s.id === camp.script_id) ?? null;
  const scriptCompanies = companiesWhere(options, 'call_manage');
  const total = reach?.total ?? r?.queued ?? camp.queued;

  async function act(what: Act) {
    setBusy(what);
    try {
      const res = what === 'delete' ? await send('DELETE', `/api/marketing/calls/campaigns/${id}`) : await send('POST', `/api/marketing/calls/campaigns/${id}/${what}`, {});
      toast('success', res.message ?? 'Done');
      setAsk(null);
      void refreshMarketing();
      if (what === 'delete') onBack();
    } catch (e) {
      toast('error', refusal(e));
    } finally {
      setBusy(null);
    }
  }
  const press = (what: Act) => (ASK[what] ? setAsk(what) : void act(what));

  const sub = [
    text('Call campaign · {status}', { status: camp.status_label.toLowerCase() }),
    text('{n} contacts', { n: n(total) }),
    text('retries {max} × every {h} h', { max: camp.max_attempts, h: camp.retry_hours }),
    data.closed,
  ].filter(Boolean).join(' · ');

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <PageHeader
        crumbs={['Call campaigns', camp.name]}
        onCrumb={onBack}
        title={
          <span className="flex min-w-0 items-center gap-2.5">
            <span className="truncate">{camp.name}</span>
            <Pill tone={CALL_PILL[camp.status]}>{camp.status_label}</Pill>
          </span>
        }
        sub={sub}
        actions={
          <>
            {manage && script && scriptCompanies.some((c) => c.id === script.org_id) ? (
              <button type="button" className={btn} onClick={() => setEditScript(script)}>
                <Icon name="file-text" size={15} /> Edit script
              </button>
            ) : null}
            {editable ? (
              <button type="button" className={btn} onClick={() => setAgents(true)}>
                <Icon name="users" size={15} /> Agents
              </button>
            ) : null}
            {manage && running ? (
              <button type="button" className={btn} onClick={() => press('refresh')} disabled={busy === 'refresh'}>
                <Icon name="user-plus" size={15} /> Add new people
              </button>
            ) : null}
            {manage && camp.status === 'active' ? (
              <button type="button" className={btn} onClick={() => press('pause')} disabled={busy === 'pause'}>
                <Icon name="pause" size={15} /> Pause
              </button>
            ) : null}
            {manage && camp.status === 'paused' ? (
              <button type="button" className={btn} onClick={() => press('resume')} disabled={busy === 'resume'}>
                <Icon name="play" size={15} /> Resume
              </button>
            ) : null}
            {manage && running ? (
              <button type="button" className={btn} onClick={() => press('finish')} disabled={busy === 'finish'}>
                <Icon name="check" size={15} /> Finish
              </button>
            ) : null}
            {manage && draft ? (
              <button type="button" className={btn} onClick={() => press('delete')} disabled={busy === 'delete'}>
                <Icon name="trash" size={15} /> Delete
              </button>
            ) : null}
            {manage && draft ? (
              <button type="button" className={btnPrimary} onClick={() => press('launch')} disabled={busy === 'launch' || (reach?.callable ?? 0) === 0} title={(reach?.callable ?? 0) === 0 ? 'Nobody in the audience may be called yet.' : undefined}>
                <Icon name="phone" size={15} /> Start calling
              </button>
            ) : null}
            {data.can.call && camp.status === 'active' ? (
              <button type="button" className={btnPrimary} onClick={() => onQueue(camp.id)}>
                <Icon name="phone" size={15} /> Work the queue
              </button>
            ) : null}
          </>
        }
      />

      {r ? <Figures r={r} /> : null}

      <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(260px,340px)]">
        <div className="flex min-w-0 flex-col gap-4">
          {r ? <Agents r={r} /> : null}
          {r ? <Outcomes r={r} options={options} /> : null}
          {editable ? <CampaignForm key={`${camp.updated_at}|${camp.status}`} camp={camp} options={options} scripts={scripts.data?.items ?? []} audience={audience} /> : null}
        </div>
        <div className="flex min-w-0 flex-col gap-4">
          <Rules data={data} script={script} audience={audience} />
          {data.consent_required && reach && reach.no_consent > 0 ? (
            <Card tone="warning">
              <div className="flex gap-2.5 text-[13px] leading-snug text-ink">
                <Icon name="warning" size={16} className="mt-0.5 shrink-0 text-warning-ink dark:text-warning" />
                <span>
                  {text('{held} of {total} contacts have no phone consent and are held back. Record a lawful basis or collect consent to release them.', { held: n(reach.no_consent), total: n(reach.total) })}
                </span>
              </div>
            </Card>
          ) : null}
        </div>
      </div>

      {ask && ASK[ask] ? (
        <ConfirmSheet title={ASK[ask]!.title(camp, reach)} body={ASK[ask]!.body} action={ASK[ask]!.action} danger={ASK[ask]!.danger} busy={busy === ask} onClose={() => setAsk(null)} onYes={() => void act(ask)} />
      ) : null}
      {editScript ? <ScriptSheet script={editScript} companies={scriptCompanies} onClose={() => setEditScript(null)} /> : null}
      {agents ? <AgentsSheet camp={camp} options={options} onClose={() => setAgents(false)} /> : null}
    </div>
  );
}

/** The five tiles (W10): the queue, the claims held now, who was reached, who was interested, callbacks due. */
function Figures({ r }: { r: CallResults }) {
  const interested = (r.outcomes.interested ?? 0) + (r.outcomes.qualified ?? 0);
  return (
    <StatGrid min={180}>
      <Kpi icon="list-todo" tone="blue" label="In queue" value={n(r.waiting)} sub={text('{n} ready now', { n: n(r.ready_now) })} />
      <Kpi icon="hand" tone="violet" label="Claimed now" value={n(r.claimed_now ?? null)} sub={<span className="text-warning-ink dark:text-warning">Released after 20 min idle</span>} />
      <Kpi icon="phone-call" tone="cyan" label="Reached" value={n(r.connected)} sub={r.calls > 0 ? text('{p} of calls made', { p: pct((r.connected / r.calls) * 100) }) : 'No calls yet'} />
      <Kpi icon="star" tone="green" label="Interested" value={n(interested)} sub={<span className="text-success">{text('{n} handed to CRM', { n: n(r.handed_over ?? r.leads) })}</span>} />
      <Kpi icon="phone-incoming" tone="amber" label="Callbacks due" value={n(r.callbacks_due ?? r.callbacks)} sub="Created as Tasks" />
    </StatGrid>
  );
}

/** Who is calling (MKT-CAL-15): on a call, wrapping up or idle, with today's calls — or, from a server a part behind, every call so far. */
function Agents({ r }: { r: CallResults }) {
  const live = r.live;
  return (
    <Card title="Agents" padded={false}>
      {live ? (
        live.length === 0 ? (
          <Empty text="Nobody is assigned to call yet." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] border-collapse text-[13px]">
              <thead>
                <tr className="bg-ground text-left text-[11px] font-bold tracking-[.4px] text-ink-3 uppercase">
                  <th scope="col" className="px-4 py-2">Agent</th>
                  <th scope="col" className="px-3 py-2">Status</th>
                  <th scope="col" className="px-3 py-2 text-right">Calls today</th>
                  <th scope="col" className="px-3 py-2 text-right">Reached</th>
                  <th scope="col" className="px-4 py-2 text-right">Interested</th>
                </tr>
              </thead>
              <tbody>
                {live.map((a) => {
                  const s = agentState(a);
                  return (
                    <tr key={a.user_id} className="border-t border-line/70">
                      <td className="px-4 py-2">
                        <span className="flex min-w-0 items-center gap-2">
                          <Initials name={a.name} size={26} />
                          <span className="min-w-0">
                            <span className="block truncate font-semibold text-ink">{a.name}</span>
                            {a.holding ? <span className="block truncate text-[11.5px] text-ink-3">{text('with {name}', { name: a.holding })}</span> : null}
                          </span>
                        </span>
                      </td>
                      <td className="px-3 py-2">
                        <Pill tone={s.tone}>{s.label}</Pill>
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">{n(a.calls_today)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{n(a.reached_today)}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{n(a.interested)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )
      ) : r.agents.length === 0 ? (
        <Empty text="Nobody has called yet." />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[420px] border-collapse text-[13px]">
            <thead>
              <tr className="bg-ground text-left text-[11px] font-bold tracking-[.4px] text-ink-3 uppercase">
                <th scope="col" className="px-4 py-2">Agent</th>
                <th scope="col" className="px-3 py-2 text-right">Calls</th>
                <th scope="col" className="px-3 py-2 text-right">Reached</th>
                <th scope="col" className="px-4 py-2 text-right">Leads</th>
              </tr>
            </thead>
            <tbody>
              {r.agents.map((a) => (
                <tr key={a.user_id} className="border-t border-line/70">
                  <td className="px-4 py-2">
                    <span className="flex items-center gap-2">
                      <Initials name={a.name} size={26} />
                      <span className="truncate font-semibold text-ink">{a.name ?? '—'}</span>
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{n(a.calls)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{n(a.connected)}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{n(a.leads)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {r.per_contact !== null ? <p className="m-0 border-t border-line/70 px-4 py-2 text-[12px] text-ink-3">{text('{n} calls per contact tried, on average.', { n: r.per_contact })}</p> : null}
    </Card>
  );
}

/** How the calls ended: the ten outcomes (MKT-CAL-04), each with its count. */
function Outcomes({ r, options }: { r: CallResults; options: Options }) {
  const list = outcomesOf(options);
  return (
    <Card title={text('Outcomes · {n} types', { n: list.length })}>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-5">
        {list.map((o) => (
          <div key={o.value} className="min-w-0 rounded-[10px] border border-line px-3 py-2">
            <div className="truncate text-[12px] text-ink-3">{o.label}</div>
            <div className="text-[19px] leading-tight font-bold text-ink tabular-nums">{n((r.outcomes as Record<string, number>)[o.value] ?? 0)}</div>
          </div>
        ))}
      </div>
    </Card>
  );
}

/** The rules the campaign calls by, and who of its audience may be called. */
function Rules({ data, script, audience }: { data: CallCampaignDetail; script: CallScript | null; audience: ReturnType<typeof useAudienceNames> }) {
  const c = data.campaign;
  const reach = data.reach;
  const names = (ids: number[], from: Array<{ id: number; name: string }>, kind: string) => ids.map((i) => `${kind} · ${from.find((x) => x.id === i)?.name ?? `#${i}`}`);
  const who = [...names(c.audience.lists, audience.lists, 'List'), ...names(c.audience.segments, audience.segments, 'Segment')];
  const out = [...names(c.audience.exclude_lists, audience.lists, 'List'), ...names(c.audience.exclude_segments, audience.segments, 'Segment')];
  const hours = c.calling_from || c.calling_until ? `${c.calling_from ?? '00:00'}–${c.calling_until ?? '24:00'} ${text('company time')}` : text('Any time');
  const runs = c.starts_on || c.ends_on ? `${c.starts_on ? dateLabel(c.starts_on) : '…'} – ${c.ends_on ? dateLabel(c.ends_on) : '…'}` : null;
  return (
    <Card title="Rules">
      <Line label="Audience">
        <span className="block max-w-[200px] truncate" title={who.join(', ')}>
          {who.length ? who.join(', ') : 'Nobody chosen yet'}
        </span>
      </Line>
      {out.length ? (
        <Line label="Leaving out">
          <span className="block max-w-[200px] truncate" title={out.join(', ')}>
            {out.join(', ')}
          </span>
        </Line>
      ) : null}
      <Line label="Requires phone consent">{data.consent_required ? 'Yes (setting)' : 'No'}</Line>
      {reach ? (
        <>
          <Line label="In the audience">{n(reach.total)}</Line>
          <Line label="Excluded · no number">{n(reach.no_phone)}</Line>
          <Line label="Excluded · do not call">{n(reach.do_not_call)}</Line>
          {data.consent_required ? <Line label="Excluded · no consent">{n(reach.no_consent)}</Line> : null}
          <Line label="May be called" strong>
            {n(reach.callable)}
          </Line>
        </>
      ) : null}
      <Line label="Calling hours">{hours}</Line>
      {runs ? <Line label="Runs">{runs}</Line> : null}
      <Line label="Retry">{text('No answer / busy · {max} × {h} h', { max: c.max_attempts, h: c.retry_hours })}</Line>
      <Line label="Priority">{c.priority === 'high' ? 'High' : c.priority === 'low' ? 'Low' : 'Normal'}</Line>
      <Line label="Script">{script?.name ?? (c.script_id ? `#${c.script_id}` : 'None')}</Line>
      <Line label="Claiming">One agent at a time · 20-min release</Line>
    </Card>
  );
}

interface Draft {
  name: string; objective: string; priority: string; script_id: string; starts_on: string; ends_on: string;
  calling_from: string; calling_until: string; max_attempts: string; retry_hours: string; agents: number[]; audience: Audience;
}

const draftOf = (c: CallCampaign): Draft => ({
  name: c.name, objective: c.objective ?? '', priority: c.priority, script_id: c.script_id ? String(c.script_id) : '',
  starts_on: c.starts_on ?? '', ends_on: c.ends_on ?? '', calling_from: c.calling_from ?? '', calling_until: c.calling_until ?? '',
  max_attempts: String(c.max_attempts), retry_hours: String(c.retry_hours), agents: c.agents, audience: c.audience,
});

/**
 * The campaign's settings: everything before calling starts, and all but the audience while it calls (the audience
 * was taken at the start; "Add new people" brings in whoever joined it since).
 */
function CampaignForm({ camp, options, scripts, audience }: { camp: CallCampaign; options: Options; scripts: CallScript[]; audience: ReturnType<typeof useAudienceNames> }) {
  const [d, setD] = useState<Draft>(() => draftOf(camp));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const draft = camp.status === 'draft';
  const people = options.companies.find((co) => co.id === camp.org_id)?.people ?? [];
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((was) => ({ ...was, [k]: v }));
  const mine = scripts.filter((s) => s.org_id === camp.org_id && (!s.archived || s.id === camp.script_id));

  async function save() {
    setBusy(true);
    setErrors({});
    try {
      const { audience: who, ...rest } = d;
      const r = await send('PUT', `/api/marketing/calls/campaigns/${camp.id}`, {
        ...rest,
        script_id: d.script_id ? Number(d.script_id) : null,
        max_attempts: Number(d.max_attempts),
        retry_hours: Number(d.retry_hours),
        ...(draft ? { audience: who } : {}),
      });
      toast('success', r.message ?? 'Saved');
      void refreshMarketing();
    } catch (e) {
      setErrors(fieldErrors(e));
      toast('error', refusal(e, 'It could not be saved.'));
    } finally {
      setBusy(false);
    }
  }

  const toggle = (k: keyof Audience, v: number) => set('audience', { ...d.audience, [k]: d.audience[k].includes(v) ? d.audience[k].filter((x) => x !== v) : [...d.audience[k], v] });
  const box = (k: keyof Audience, label: string, items: Array<{ id: number; name: string }>) => (
    <fieldset className="m-0 min-w-0 border-0 p-0">
      <legend className="p-0">
        <Caption>{label}</Caption>
      </legend>
      {items.length === 0 ? (
        <p className="m-0 text-[12.5px] text-ink-3">{audience.loading ? 'Loading…' : 'None yet.'}</p>
      ) : (
        <ul className="m-0 flex max-h-44 list-none flex-col gap-1 overflow-y-auto p-0 scroll-thin">
          {items.map((i) => (
            <li key={i.id}>
              <label className="flex items-center gap-2 text-[13px] text-ink">
                <Checkbox checked={d.audience[k].includes(i.id)} onChange={() => toggle(k, i.id)} disabled={!draft} />
                <span className="min-w-0 truncate">{i.name}</span>
              </label>
            </li>
          ))}
        </ul>
      )}
    </fieldset>
  );

  return (
    <Card title={draft ? 'Set up the campaign' : 'Campaign settings'}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Name" className="sm:col-span-2">
          <input className={input} value={d.name} onChange={(e) => set('name', e.target.value)} />
          <FieldError text={errors.name} />
        </Field>
        <Field label="Objective" className="sm:col-span-2">
          <textarea className={`${input} h-auto py-2`} rows={2} value={d.objective} onChange={(e) => set('objective', e.target.value)} placeholder="Book a 15-minute call about website care" />
        </Field>
        <Field label="Script">
          <Select value={d.script_id} onValueChange={(v) => set('script_id', v)} aria-label="Script" options={[{ value: '', label: 'No script' }, ...mine.map((s) => ({ value: String(s.id), label: s.name }))]} />
          <FieldError text={errors.script_id} />
        </Field>
        <Field label="Priority" hint="High comes first in a queue with several campaigns.">
          <Select value={d.priority} onValueChange={(v) => set('priority', v)} aria-label="Priority" searchable={false} options={[{ value: 'high', label: 'High' }, { value: 'normal', label: 'Normal' }, { value: 'low', label: 'Low' }]} />
        </Field>
        <Field label="From">
          <input type="date" className={input} value={d.starts_on} onChange={(e) => set('starts_on', e.target.value)} aria-label="Starts on" />
          <FieldError text={errors.starts_on} />
        </Field>
        <Field label="Until">
          <input type="date" className={input} value={d.ends_on} onChange={(e) => set('ends_on', e.target.value)} aria-label="Ends on" />
          <FieldError text={errors.ends_on} />
        </Field>
        <Field label="Calling from" hint="The company's time. Empty: any time.">
          <input type="time" className={input} value={d.calling_from} onChange={(e) => set('calling_from', e.target.value)} aria-label="Calling from" />
          <FieldError text={errors.calling_from} />
        </Field>
        <Field label="Calling until">
          <input type="time" className={input} value={d.calling_until} onChange={(e) => set('calling_until', e.target.value)} aria-label="Calling until" />
          <FieldError text={errors.calling_until} />
        </Field>
        <Field label="Attempts per contact" hint="No answer, busy or voicemail count as one.">
          <input type="number" min={1} max={10} className={input} value={d.max_attempts} onChange={(e) => set('max_attempts', e.target.value)} aria-label="Attempts per contact" />
          <FieldError text={errors.max_attempts} />
        </Field>
        <Field label="Try again after (hours)">
          <input type="number" min={1} max={168} className={input} value={d.retry_hours} onChange={(e) => set('retry_hours', e.target.value)} aria-label="Try again after" />
          <FieldError text={errors.retry_hours} />
        </Field>
      </div>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        {box('lists', 'Call · lists', audience.lists)}
        {box('segments', 'Call · segments', audience.segments)}
        {box('exclude_lists', 'Leave out · lists', audience.lists)}
        {box('exclude_segments', 'Leave out · segments', audience.segments)}
      </div>
      {!draft ? <p className="m-0 mt-2 text-[12px] text-ink-3">The audience was taken when calling started. “Add new people” brings in anybody who has joined it since.</p> : null}

      <fieldset className="m-0 mt-4 min-w-0 border-0 p-0">
        <legend className="p-0">
          <Caption>Who makes the calls</Caption>
        </legend>
        <AgentPicker people={people} value={d.agents} onChange={(v) => set('agents', v)} />
        <FieldError text={errors.agents} />
      </fieldset>

      <div className="mt-4 flex justify-end">
        <button type="button" className={btnPrimary} onClick={() => void save()} disabled={busy}>
          Save
        </button>
      </div>
    </Card>
  );
}

/** The company's people, ticked when they make the calls. They also need the "Make marketing calls" permission. */
function AgentPicker({ people, value, onChange }: { people: Array<{ id: number; name: string }>; value: number[]; onChange: (v: number[]) => void }) {
  return (
    <>
      {people.length === 0 ? (
        <p className="m-0 text-[12.5px] text-ink-3">Nobody in this company yet.</p>
      ) : (
        <ul className="m-0 grid max-h-56 list-none gap-1 overflow-y-auto p-0 scroll-thin sm:grid-cols-2">
          {people.map((p) => (
            <li key={p.id}>
              <label className="flex items-center gap-2 text-[13px] text-ink">
                <Checkbox checked={value.includes(p.id)} onChange={() => onChange(value.includes(p.id) ? value.filter((x) => x !== p.id) : [...value, p.id])} />
                <span className="min-w-0 truncate">{p.name}</span>
              </label>
            </li>
          ))}
        </ul>
      )}
      <p className={cx('m-0 mt-1 text-[11.5px] text-ink-3')}>They also need the “Make marketing calls” permission.</p>
    </>
  );
}

/** "Agents" in the header: who makes the calls, changed on its own. */
function AgentsSheet({ camp, options, onClose }: { camp: CallCampaign; options: Options; onClose: () => void }) {
  const people = options.companies.find((co) => co.id === camp.org_id)?.people ?? [];
  const [value, setValue] = useState<number[]>(camp.agents);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const r = await send('PUT', `/api/marketing/calls/campaigns/${camp.id}`, { agents: value });
      toast('success', r.message ?? 'Saved');
      void refreshMarketing();
      onClose();
    } catch (e) {
      setError(fieldErrors(e).agents ?? refusal(e, 'The agents could not be saved.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet
      title="Agents"
      onClose={onClose}
      width={520}
      footer={
        <>
          <button type="button" className={btn} onClick={onClose}>
            Cancel
          </button>
          <button type="button" className={btnPrimary} onClick={() => void save()} disabled={busy}>
            Save
          </button>
        </>
      }
    >
      <p className="m-0 text-[12.5px] text-ink-2">Who works this campaign's queue. A contact somebody holds stays theirs until they finish or let it go.</p>
      <AgentPicker people={people} value={value} onChange={setValue} />
      {error ? (
        <p role="alert" className="m-0 text-[12.5px] font-medium text-danger">
          {error}
        </p>
      ) : null}
    </Sheet>
  );
}
