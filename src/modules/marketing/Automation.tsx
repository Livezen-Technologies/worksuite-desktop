import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState, type ReactNode } from 'react';
import { apiGet } from '../../core/api';
import { dateLabel } from '../../core/time';
import { toast } from '../../core/toasts';
import { Icon } from '../../components/Icon';
import { Select } from '../../components/Select';
import { cx, ErrorNote, Spinner, Switch } from '../../components/ui';
import { send, withOrg } from './api';
import { useLists } from './audience-parts';
import { draftOfRule, RuleTree, rulesOf, type RuleDraft } from './audience-rules';
import {
  exits, insertStep, JOURNEY_PILL, removeStep, useNames,
  type Arrow, type Condition, type Definition, type Enrollment, type Journey, type JourneyDetail, type Pair, type SimStep, type Step, type StepStat, type StepType,
} from './automation-parts';
import { btn, btnPrimary, btnSmall, Card, Empty, Field, input, n, PageHeader, Pill, Sheet } from './parts';
import { companiesWhere, peopleOf, refusal, type Options, type Rule } from './types';

const ICON: Record<StepType, string> = {
  send_email: 'mail', send_whatsapp: 'message-circle', send_sms: 'message-circle', wait: 'clock', wait_until: 'clock', branch: 'git-branch', split: 'scissors',
  tag_add: 'tag', tag_remove: 'tag', list_add: 'list', list_remove: 'list', call_task: 'phone', crm_lead: 'send', notify: 'bell', webhook: 'globe',
};
const ARROW_WORD: Record<string, string> = { yes: 'If yes', no: 'If no', a: 'Path A', b: 'Path B' };

/**
 * Automation journeys (MKT-AUT-01..08), as on the web: the list, and the
 * visual builder — a trigger, then steps that branch and split, then the
 * exit. A draft is edited here; "Activate" publishes it as the next version
 * on the server, which checks it, enrols whoever the trigger finds and runs
 * every step (re-checking consent, suppression and quiet hours at each send).
 */
export default function Automation({ org, options, journeyId, onOpen, onBack }: { org: string; options: Options; journeyId: number | null; onOpen: (id: number) => void; onBack: () => void }) {
  return journeyId ? <Builder id={journeyId} org={org} options={options} onBack={onBack} /> : <JourneyList org={org} options={options} onOpen={onOpen} />;
}

function Figure({ label, value }: { label: string; value: ReactNode }) {
  return <span className="rounded-[8px] bg-subtle px-1 py-1.5 text-center"><b className="block text-[16px] text-ink tabular-nums">{value}</b><span className="block text-[11px] text-ink-3">{label}</span></span>;
}

function JourneyList({ org, options, onOpen }: { org: string; options: Options; onOpen: (id: number) => void }) {
  const qc = useQueryClient();
  const [status, setStatus] = useState('');
  const [naming, setNaming] = useState<string | null>(null);
  const q = useQuery({
    queryKey: ['marketing', 'journeys', org, status],
    queryFn: ({ signal }) => apiGet<{ items: Journey[]; vocabulary: { triggers: Pair[] } }>('/api/marketing/journeys', withOrg(org, { status }), signal),
    retry: false,
  });
  const makers = companiesWhere(options, 'journeys');
  const create = async () => {
    try {
      const r = await send<{ id?: number }>('POST', '/api/marketing/journeys', { org_id: Number(org.split(',')[0]) || makers[0]?.id, name: (naming ?? '').trim() });
      setNaming(null);
      await qc.invalidateQueries({ queryKey: ['marketing', 'journeys'] });
      onOpen(Number(r.data?.id ?? 0));
    } catch (e) {
      toast('error', refusal(e));
    }
  };
  const word = (t: string | undefined) => q.data?.vocabulary.triggers.find((p) => p.value === t)?.label ?? 'No trigger yet';

  return (
    <div className="flex flex-col gap-4">
      <PageHeader crumbs={['Automation']} title="Journeys" sub="A trigger, then steps, then an exit — run by the server every minute"
        actions={makers.length ? <button type="button" className={btnPrimary} onClick={() => setNaming('')}><Icon name="plus" size={15} /> New journey</button> : undefined} />
      <div className="flex gap-1.5" role="tablist" aria-label="Journey status">
        {([['', 'All'], ['active', 'Active'], ['draft', 'Drafts'], ['paused', 'Paused'], ['archived', 'Archived']] as const).map(([k, l]) => (
          <button key={k} role="tab" aria-selected={status === k} type="button" onClick={() => setStatus(k)} className={cx(btnSmall, status === k && 'border-primary text-primary')}>{l}</button>
        ))}
      </div>
      {q.isLoading ? <Spinner /> : q.error ? <ErrorNote error={q.error} onRetry={() => void q.refetch()} /> : !q.data?.items.length ? (
        <Card><Empty text="No journeys yet. Welcome new sign-ups, nurture leads, win back the quiet ones: a journey does it for each contact, one step at a time." /></Card>
      ) : (
        <ul className="m-0 grid list-none gap-3 p-0 lg:grid-cols-2">
          {q.data.items.map((j) => (
            <li key={j.id}>
              <button type="button" onClick={() => onOpen(j.id)} className="flex w-full flex-col gap-2 rounded-[12px] border border-line bg-surface p-3.5 text-left hover:border-primary/50">
                <span className="flex items-start gap-2">
                  <span className="min-w-0 flex-1"><b className="block truncate text-[14px] text-ink">{j.name}</b><span className="text-[12px] text-ink-3">{word(j.trigger?.type)}{j.version ? ` · version ${j.version}` : ''}</span></span>
                  <Pill tone={JOURNEY_PILL[j.status]}>{j.status}</Pill>
                </span>
                <span className="grid grid-cols-4 gap-2">
                  <Figure label="Entered" value={n(j.stats.entered)} /><Figure label="In it now" value={n(j.stats.active)} />
                  <Figure label="Finished" value={n(j.stats.completed + j.stats.goal)} /><Figure label="Converted" value={j.stats.conversion === null ? '—' : `${j.stats.conversion}%`} />
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {naming !== null ? (
        <Sheet title="New journey" onClose={() => setNaming(null)} footer={<><button type="button" className={btn} onClick={() => setNaming(null)}>Cancel</button><button type="button" className={btnPrimary} disabled={!naming.trim()} onClick={() => void create()}>Create</button></>}>
          <Field label="Name"><input className={input} value={naming} onChange={(e) => setNaming(e.target.value)} autoFocus placeholder="Welcome series" /></Field>
          <p className="m-0 mt-2 text-[12px] text-ink-3">It starts as a draft; nothing runs until you activate it.</p>
        </Sheet>
      ) : null}
    </div>
  );
}

type Selected = { kind: 'trigger' } | { kind: 'settings' } | { kind: 'step'; key: string };
type Names = { lists: Pair[]; campaigns: Pair[]; callCampaigns: Pair[] };

function Builder({ id, org, options, onBack }: { id: number; org: string; options: Options; onBack: () => void }) {
  const q = useQuery({ queryKey: ['marketing', 'journey', id], queryFn: ({ signal }) => apiGet<JourneyDetail>(`/api/marketing/journeys/${id}`, undefined, signal), retry: false });
  if (q.isLoading) return <Spinner />;
  if (!q.data) return <ErrorNote error={q.error ?? new Error('That journey could not be loaded.')} onRetry={() => void q.refetch()} />;
  return <Editor key={`${q.data.id}-${q.data.updated_at ?? ''}`} journey={q.data} org={org} options={options} onBack={onBack} />;
}

function summary(step: Step, names: Names): string {
  const c = step.config;
  const name = (list: Pair[], v: unknown) => list.find((p) => p.value === String(v ?? ''))?.label ?? (v ? `#${String(v)}` : 'not chosen');
  switch (step.type) {
    case 'send_email': return name(names.campaigns, c.campaign_id);
    case 'send_whatsapp': case 'send_sms': return String(c.text ?? '').slice(0, 50) || 'no message yet';
    case 'wait': return [[c.days, 'd'], [c.hours, 'h'], [c.minutes, 'm']].filter(([v]) => Number(v) > 0).map(([v, u]) => `${Number(v)}${String(u)}`).join(' ') || 'no time set';
    case 'wait_until': return c.at ? `until ${String(c.at)}` : `until ${String(c.time ?? '09:00')} their time`;
    case 'branch': return `${(c.rules as unknown[] | undefined)?.length ?? 0} rule(s)`;
    case 'split': return `A ${Number(c.a_percent ?? 50)}% · B ${100 - Number(c.a_percent ?? 50)}%`;
    case 'tag_add': case 'tag_remove': return String(c.tag ?? 'no tag yet');
    case 'list_add': case 'list_remove': return name(names.lists, c.list_id);
    case 'call_task': return name(names.callCampaigns, c.campaign_id);
    case 'crm_lead': return 'through CRM';
    case 'notify': return String(c.message ?? '').slice(0, 50);
    case 'webhook': return String(c.url ?? 'no address yet');
  }
  return '';
}

function Editor({ journey, org, options, onBack }: { journey: JourneyDetail; org: string; options: Options; onBack: () => void }) {
  const qc = useQueryClient();
  const [def, setDef] = useState<Definition>(journey.definition);
  const [name, setName] = useState(journey.name);
  const [sel, setSel] = useState<Selected>({ kind: 'trigger' });
  const [busy, setBusy] = useState<string | null>(null);
  const [problems, setProblems] = useState<Record<string, string>>(journey.problems ?? {});
  const [tab, setTab] = useState<'flow' | 'people'>('flow');
  const [testing, setTesting] = useState(false);
  const orgId = String(journey.org_id);
  const may = journey.may_manage;
  const voc = journey.vocabulary;
  const lists = useLists(orgId);
  const campaigns = useQuery({ queryKey: ['marketing', 'campaign-names', orgId], queryFn: ({ signal }) => apiGet<{ items: Array<{ id: number; org_id: number; name: string }> }>('/api/marketing/campaigns', { org: orgId, per_page: 200 }, signal), retry: false });
  const calls = useQuery({ queryKey: ['marketing', 'call-campaign-names', orgId], queryFn: ({ signal }) => apiGet<{ items: Array<{ id: number; org_id: number; name: string }> }>('/api/marketing/calls/campaigns', { org: orgId }, signal), retry: false });
  const names: Names = useMemo(() => ({
    lists: (lists.data?.items ?? []).filter((l) => l.org_id === journey.org_id).map((l) => ({ value: String(l.id), label: l.name })),
    campaigns: (campaigns.data?.items ?? []).filter((c) => c.org_id === journey.org_id).map((c) => ({ value: String(c.id), label: c.name })),
    callCampaigns: (calls.data?.items ?? []).filter((c) => c.org_id === journey.org_id).map((c) => ({ value: String(c.id), label: c.name })),
  }), [lists.data, campaigns.data, calls.data, journey.org_id]);
  const dirty = JSON.stringify(def) !== JSON.stringify(journey.definition) || name.trim() !== journey.name;
  const live = journey.status === 'active' || journey.status === 'paused';
  const selectedStep = sel.kind === 'step' ? def.steps[sel.key] : undefined;

  const act = async (what: string, method: 'POST' | 'PUT', path: string, body?: unknown) => {
    setBusy(what);
    try {
      const r = await send<{ problems?: Record<string, string> } | null>(method, path, body);
      setProblems(r.data?.problems ?? {});
      toast('success', r.message ?? 'Done.');
      await qc.invalidateQueries({ queryKey: ['marketing', 'journey', journey.id] });
      await qc.invalidateQueries({ queryKey: ['marketing', 'journeys'] });
      return true;
    } catch (e) {
      const d = (e as { data?: { errors?: Record<string, string> } }).data;
      if (d?.errors) setProblems(d.errors);
      toast('error', refusal(e));
      return false;
    } finally {
      setBusy(null);
    }
  };
  const save = () => act('save', 'PUT', `/api/marketing/journeys/${journey.id}`, { name: name.trim(), definition: def });
  const activate = async () => {
    if (dirty && !(await save())) return;
    await act('activate', 'POST', `/api/marketing/journeys/${journey.id}/activate`);
  };
  const add = (from: string | null, arrow: Arrow, type: StepType) => {
    const r = insertStep(def, from, arrow, type);
    setDef(r.def);
    setSel({ kind: 'step', key: r.key });
  };

  return (
    <div className="flex flex-col gap-4">
      <PageHeader crumbs={['Automation', 'Journeys']} onCrumb={onBack}
        title={may ? <input aria-label="Journey name" className="w-full min-w-0 rounded-[6px] bg-transparent text-[20px] font-bold text-ink outline-none focus:ring-2 focus:ring-primary/40" value={name} onChange={(e) => setName(e.target.value)} maxLength={150} /> : name}
        sub={<span className="inline-flex flex-wrap items-center gap-2"><Pill tone={JOURNEY_PILL[journey.status]}>{journey.status}</Pill>{journey.version ? `version ${journey.version} live` : 'never activated'}{journey.dirty && journey.version ? ' · the draft has changes not yet live' : ''}</span>}
        actions={(
          <>
            <button type="button" className={btn} onClick={onBack}><Icon name="chevron-left" size={15} /> Back</button>
            {may ? <button type="button" className={btn} onClick={() => setTesting(true)}><Icon name="play" size={14} /> Test with a contact</button> : null}
            {may ? <button type="button" className={btn} disabled={!dirty || busy !== null} onClick={() => void save()}><Icon name="check" size={14} /> Save draft</button> : null}
            {may && journey.status === 'active' ? <button type="button" className={btn} disabled={busy !== null} onClick={() => void act('pause', 'POST', `/api/marketing/journeys/${journey.id}/pause`)}><Icon name="pause" size={14} /> Pause</button> : null}
            {may && journey.status === 'paused' ? <button type="button" className={btn} disabled={busy !== null} onClick={() => void act('resume', 'POST', `/api/marketing/journeys/${journey.id}/resume`)}><Icon name="play" size={14} /> Resume</button> : null}
            {may && journey.status !== 'archived' ? <button type="button" className={btnPrimary} disabled={busy !== null || (journey.status === 'active' && !dirty && !journey.dirty)} onClick={() => void activate()}>{journey.version ? 'Publish' : 'Activate'}</button> : null}
            {may && journey.status !== 'archived' ? <button type="button" className={btn} disabled={busy !== null} onClick={() => void act('archive', 'POST', `/api/marketing/journeys/${journey.id}/archive`)}><Icon name="archive" size={14} /> Archive</button> : null}
          </>
        )} />

      {Object.keys(problems).length ? (
        <div role="alert" className="rounded-[10px] border border-warning/40 bg-warning-bg px-3 py-2 text-[12.5px] text-ink">
          <b>Fix before activating:</b>
          <ul className="m-0 mt-1 pl-5">{Object.entries(problems).map(([k, v]) => <li key={k}>{v}</li>)}</ul>
        </div>
      ) : null}

      <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
        <Figure label="Entered" value={n(journey.stats.entered)} /><Figure label="In it now" value={n(journey.stats.active)} /><Figure label="Completed" value={n(journey.stats.completed)} />
        <Figure label="Reached goal" value={n(journey.stats.goal)} /><Figure label="Left early" value={n(journey.stats.exited)} /><Figure label="Parked" value={n(journey.stats.parked)} />
      </div>

      <div className="flex gap-1.5" role="tablist" aria-label="Journey view">
        {(['flow', 'people'] as const).map((t) => <button key={t} role="tab" aria-selected={tab === t} type="button" className={cx(btnSmall, tab === t && 'border-primary text-primary')} onClick={() => setTab(t)}>{t === 'flow' ? 'Flow' : 'People'}</button>)}
      </div>

      {tab === 'people' ? <People journeyId={journey.id} /> : (
        <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
          <section aria-label="Journey flow" className="min-w-0 overflow-x-auto rounded-[12px] border border-line bg-subtle/50 p-4 scroll-thin">
            <div className="mx-auto flex min-w-max flex-col items-center">
              <Node icon="zap" title={`Trigger · ${voc.triggers.find((t) => t.value === def.trigger.type)?.label ?? 'choose one'}`} detail={String(Object.values(def.trigger.config).filter(Boolean).join(' · ') || 'Set it up on the right')}
                active={sel.kind === 'trigger'} onClick={() => setSel({ kind: 'trigger' })} wrong={problems.trigger} strong />
              <Chain def={def} from={null} arrow="next" at={def.start} may={may} voc={voc.steps} names={names} stats={journey.step_stats} live={live} sel={sel} problems={problems} onSel={(k) => setSel({ kind: 'step', key: k })} onAdd={add} />
              <button type="button" className={cx(btnSmall, 'mt-3', sel.kind === 'settings' && 'border-primary text-primary')} onClick={() => setSel({ kind: 'settings' })}>Goal, exit and re-entry</button>
            </div>
          </section>
          <aside aria-label="Step settings" className="flex flex-col gap-4">
            {sel.kind === 'trigger' ? <TriggerCard def={def} onChange={setDef} voc={voc} names={names} orgId={orgId} readOnly={!may} /> : null}
            {sel.kind === 'settings' ? <SettingsCard def={def} onChange={setDef} orgId={orgId} options={options} readOnly={!may} /> : null}
            {sel.kind === 'step' && selectedStep ? (
              <StepCard key={sel.key} stepKey={sel.key} step={selectedStep} voc={voc} names={names} orgId={orgId} options={options} readOnly={!may} stat={journey.step_stats[sel.key]}
                onChange={(s) => setDef({ ...def, steps: { ...def.steps, [sel.key]: s } })} onRemove={() => { setDef(removeStep(def, sel.key)); setSel({ kind: 'trigger' }); }} />
            ) : null}
          </aside>
        </div>
      )}
      {testing ? <TestRun journeyId={journey.id} org={org || orgId} dirty={dirty} onClose={() => setTesting(false)} /> : null}
    </div>
  );
}

function Node({ icon, title, detail, active, onClick, wrong, stat, strong }: { icon: string; title: string; detail: string; active: boolean; onClick: () => void; wrong?: string; stat?: ReactNode; strong?: boolean }) {
  return (
    <button type="button" aria-pressed={active} onClick={onClick}
      className={cx('flex w-[250px] items-start gap-2.5 rounded-[12px] border bg-surface p-2.5 text-left shadow-sm', active ? 'border-primary ring-2 ring-primary/25' : wrong ? 'border-danger/50' : 'border-line hover:border-ink-3/40')}>
      <span className={cx('grid h-8 w-8 shrink-0 place-items-center rounded-[8px]', strong ? 'bg-primary text-white' : 'bg-selection text-primary')}><Icon name={icon} size={15} /></span>
      <span className="min-w-0 flex-1">
        <b className="block truncate text-[13px] text-ink">{title}</b>
        <span className="block truncate text-[12px] text-ink-3">{detail}</span>
        {wrong ? <span className="block text-[11.5px] text-danger">{wrong}</span> : null}
        {stat}
      </span>
    </button>
  );
}

function Insert({ may, voc, onAdd, label }: { may: boolean; voc: Pair[]; onAdd: (t: StepType) => void; label: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative flex flex-col items-center">
      <span className="h-4 w-px bg-line" aria-hidden="true" />
      {may ? <button type="button" aria-label={label} aria-expanded={open} onClick={() => setOpen((o) => !o)} className="grid h-6 w-6 place-items-center rounded-full border border-line bg-surface text-ink-3 hover:border-primary hover:text-primary"><Icon name="plus" size={12} /></button> : null}
      {open ? (
        <div role="menu" className="absolute top-10 z-20 grid w-52 gap-0.5 rounded-[10px] border border-line bg-surface p-1 shadow-lg">
          {voc.map((s) => <button key={s.value} role="menuitem" type="button" className="rounded-[6px] px-2 py-1.5 text-left text-[12.5px] text-ink hover:bg-subtle" onClick={() => { setOpen(false); onAdd(s.value as StepType); }}>{s.label}</button>)}
        </div>
      ) : null}
      <span className="h-4 w-px bg-line" aria-hidden="true" />
    </div>
  );
}

function Chain({ def, from, arrow, at, may, voc, names, stats, live, sel, problems, onSel, onAdd }: {
  def: Definition; from: string | null; arrow: Arrow; at: string | null | undefined; may: boolean; voc: Pair[]; names: Names; stats: Record<string, StepStat>; live: boolean;
  sel: Selected; problems: Record<string, string>; onSel: (k: string) => void; onAdd: (from: string | null, arrow: Arrow, t: StepType) => void;
}) {
  const step = at ? def.steps[at] : undefined;
  const ins = <Insert may={may} voc={voc} onAdd={(t) => onAdd(from, arrow, t)} label={`Add a step ${from === null ? 'at the start' : `after ${from}`}${arrow !== 'next' ? ` (${ARROW_WORD[arrow]})` : ''}`} />;
  if (!at || !step) return <>{ins}<span className="rounded-full bg-subtle px-2.5 py-0.5 text-[10.5px] font-bold tracking-wide text-ink-3 uppercase">Exit</span></>;
  const st = stats[at];
  const node = (
    <Node icon={ICON[step.type]} title={step.label || (voc.find((v) => v.value === step.type)?.label ?? step.type)} detail={summary(step, names)} active={sel.kind === 'step' && sel.key === at} onClick={() => onSel(at)} wrong={problems[`step.${at}`]}
      stat={live && st ? <span className="mt-0.5 block text-[11px] text-ink-3">{n(st.entered)} in · {n(st.waiting)} here · {n(st.completed)} on · {n(st.exited)} out{st.failed ? ` · ${n(st.failed)} failed` : ''}</span> : undefined} />
  );
  const two = exits(step.type);
  if (two.length === 1) return <>{ins}{node}<Chain def={def} from={at} arrow="next" at={step.next} may={may} voc={voc} names={names} stats={stats} live={live} sel={sel} problems={problems} onSel={onSel} onAdd={onAdd} /></>;
  return (
    <>
      {ins}{node}
      <div className="mt-1 flex items-start gap-6">
        {two.map((a) => (
          <div key={a} className="flex flex-col items-center">
            <span className={cx('mt-2 rounded-full px-2 py-0.5 text-[11px] font-bold', a === 'yes' || a === 'a' ? 'bg-success-bg text-success' : 'bg-warning-bg text-warning')}>{ARROW_WORD[a]}</span>
            <ol aria-label={ARROW_WORD[a]} className="contents"><Chain def={def} from={at} arrow={a} at={step[a]} may={may} voc={voc} names={names} stats={stats} live={live} sel={sel} problems={problems} onSel={onSel} onAdd={onAdd} /></ol>
          </div>
        ))}
      </div>
    </>
  );
}

const str = (v: unknown) => (v === null || v === undefined ? '' : String(v));

function TriggerCard({ def, onChange, voc, names, orgId, readOnly }: { def: Definition; onChange: (d: Definition) => void; voc: JourneyDetail['vocabulary']; names: Names; orgId: string; readOnly: boolean }) {
  const c = def.trigger.config;
  const set = (patch: Record<string, unknown>) => onChange({ ...def, trigger: { ...def.trigger, config: { ...c, ...patch } } });
  const forms = useNames('forms', orgId, def.trigger.type === 'form_submitted');
  const segments = useQuery({ queryKey: ['marketing', 'segment-names', orgId], queryFn: ({ signal }) => apiGet<{ items: Array<{ id: number; name: string }> }>('/api/marketing/segments', { org: orgId, brief: 1 }, signal), enabled: def.trigger.type === 'segment_joined', retry: false });
  const pick = (label: string, key: string, list: Pair[]) => <Field label={label}><Select<string> aria-label={label} value={str(c[key])} disabled={readOnly} onValueChange={(v) => set({ [key]: Number(v) || v })} options={list} placeholder="Choose…" /></Field>;
  return (
    <Card title="Trigger: who enters">
      <div className="flex flex-col gap-3">
        <Field label="When somebody"><Select<string> aria-label="Trigger" value={def.trigger.type} disabled={readOnly} onValueChange={(v) => onChange({ ...def, trigger: { type: v, config: {} } })} options={voc.triggers} /></Field>
        {def.trigger.type === 'list_joined' ? pick('List', 'list_id', names.lists) : null}
        {def.trigger.type === 'segment_joined' ? pick('Segment', 'segment_id', (segments.data?.items ?? []).map((s) => ({ value: String(s.id), label: s.name }))) : null}
        {def.trigger.type === 'form_submitted' ? pick('Form', 'form_id', forms.map((f) => ({ value: String(f.id), label: f.name }))) : null}
        {def.trigger.type === 'tag_added' ? <Field label="Tag"><input className={input} disabled={readOnly} value={str(c.tag)} onChange={(e) => set({ tag: e.target.value })} /></Field> : null}
        {def.trigger.type === 'email_event' ? (
          <>
            <Field label="Event"><Select<string> aria-label="Event" value={str(c.event)} disabled={readOnly} onValueChange={(v) => set({ event: v })} options={[{ value: 'open', label: 'Opens' }, { value: 'click', label: 'Clicks a link' }]} /></Field>
            {pick('Email (empty: any)', 'campaign_id', [{ value: '', label: 'Any email' }, ...names.campaigns])}
          </>
        ) : null}
        {def.trigger.type === 'call_outcome' ? <Field label="Outcome"><Select<string> aria-label="Outcome" value={str(c.outcome)} disabled={readOnly} onValueChange={(v) => set({ outcome: v })} options={voc.call_outcomes} /></Field> : null}
        {def.trigger.type === 'crm_stage' ? <Field label="CRM stage"><Select<string> aria-label="CRM stage" value={str(c.stage)} disabled={readOnly} onValueChange={(v) => set({ stage: v })} options={voc.crm_stages} /></Field> : null}
        {def.trigger.type === 'score_threshold' ? (
          <div className="grid grid-cols-2 gap-2">
            <Field label="Score"><Select<string> aria-label="Score" value={str(c.score) || 'total'} disabled={readOnly} onValueChange={(v) => set({ score: v })} options={[{ value: 'total', label: 'Total' }, { value: 'behaviour', label: 'Behaviour' }, { value: 'fit', label: 'Fit' }]} /></Field>
            <Field label="Reaches"><input type="number" min={1} className={input} disabled={readOnly} value={str(c.min)} onChange={(e) => set({ min: Number(e.target.value) })} /></Field>
          </div>
        ) : null}
        {def.trigger.type === 'date_field' ? (
          <div className="grid grid-cols-2 gap-2">
            <Field label="Date field"><input className={input} disabled={readOnly} value={str(c.field)} onChange={(e) => set({ field: e.target.value })} placeholder="created, or custom.birthday" /></Field>
            <Field label="Days before (−) / after"><input type="number" className={input} disabled={readOnly} value={str(c.offset_days)} onChange={(e) => set({ offset_days: Number(e.target.value) })} /></Field>
          </div>
        ) : null}
        {def.trigger.type === 'api' ? <p className="m-0 text-[12px] text-ink-3">Another system enters a contact with POST /api/marketing/journeys/{'{id}'}/enroll and its contact_id.</p> : null}
      </div>
    </Card>
  );
}

function ConditionBox({ label, value, onChange, orgId, options, readOnly }: { label: string; value: Condition | null; onChange: (c: Condition | null) => void; orgId: string; options: Options; readOnly: boolean }) {
  const fields = options.segment_fields;
  const [drafts, setDrafts] = useState<RuleDraft[]>(() => (value?.rules ?? []).map(draftOfRule));
  const lists = useLists(orgId);
  const match = value?.match ?? 'all';
  const push = (ds: RuleDraft[], m: 'all' | 'any') => { setDrafts(ds); onChange(ds.length ? { match: m, rules: rulesOf(ds, fields) } : null); };
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2 text-[12.5px] font-semibold text-ink">
        {label}
        {drafts.length ? <Select<'all' | 'any'> aria-label={`${label}: match`} value={match} disabled={readOnly} onValueChange={(v) => push(drafts, v)} className="h-[28px] w-auto" options={[{ value: 'all', label: 'all of' }, { value: 'any', label: 'any of' }]} /> : null}
        {!drafts.length && !readOnly ? <button type="button" className={btnSmall} onClick={() => push([{ field: fields[0]?.key ?? '', op: fields[0]?.ops[0]?.key ?? '', value: '' }], 'all')}>Add a rule</button> : null}
      </div>
      {drafts.length ? <RuleTree drafts={drafts} onChange={(ds) => push(ds, match)} fields={fields} people={peopleOf(options, Number(orgId))} lists={(lists.data?.items ?? []).filter((l) => String(l.org_id) === orgId)} wrong={{}} editable={!readOnly} /> : null}
    </div>
  );
}

function SettingsCard({ def, onChange, orgId, options, readOnly }: { def: Definition; onChange: (d: Definition) => void; orgId: string; options: Options; readOnly: boolean }) {
  return (
    <Card title="Goal, exit and re-entry">
      <div className="flex flex-col gap-4">
        <ConditionBox label="Goal — meeting it leaves as converted" value={def.goal} onChange={(goal) => onChange({ ...def, goal })} orgId={orgId} options={options} readOnly={readOnly} />
        <ConditionBox label="Exit — meeting it leaves the journey" value={def.exit} onChange={(exit) => onChange({ ...def, exit })} orgId={orgId} options={options} readOnly={readOnly} />
        <div className="grid grid-cols-2 gap-2">
          <Field label="Enter again">
            <Select<string> aria-label="Re-entry" value={def.reentry.policy} disabled={readOnly} onValueChange={(v) => onChange({ ...def, reentry: { policy: v as Definition['reentry']['policy'], days: v === 'after_days' ? (def.reentry.days ?? 30) : null } })}
              options={[{ value: 'never', label: 'Never' }, { value: 'after_days', label: 'After some days' }, { value: 'always', label: 'Every time' }]} />
          </Field>
          {def.reentry.policy === 'after_days' ? <Field label="Days"><input type="number" min={1} max={3650} className={input} disabled={readOnly} value={str(def.reentry.days)} onChange={(e) => onChange({ ...def, reentry: { ...def.reentry, days: Number(e.target.value) } })} /></Field> : null}
        </div>
        <div className="flex items-start gap-2 text-[12.5px] text-ink-2">
          <Switch checked={def.exit_sales_ready} disabled={readOnly} onChange={(v) => onChange({ ...def, exit_sales_ready: v })} label="Leave when sales-ready in CRM" />
          <span>Leave when CRM is working them — an open lead, or a won deal.</span>
        </div>
        <p className="m-0 text-[12px] text-ink-3">Quiet hours and the frequency cap are the company’s, under Settings → Sending.</p>
      </div>
    </Card>
  );
}

function StepCard({ stepKey, step, voc, names, orgId, options, readOnly, stat, onChange, onRemove }: {
  stepKey: string; step: Step; voc: JourneyDetail['vocabulary']; names: Names; orgId: string; options: Options; readOnly: boolean; stat: StepStat | undefined; onChange: (s: Step) => void; onRemove: () => void;
}) {
  const c = step.config;
  const set = (patch: Record<string, unknown>) => onChange({ ...step, config: { ...c, ...patch } });
  const [drafts, setDrafts] = useState<RuleDraft[]>(() => ((c.rules as Rule[] | undefined) ?? []).map(draftOfRule));
  const lists = useLists(orgId);
  const people = peopleOf(options, Number(orgId));
  const sel = (label: string, key: string, list: Pair[]) => <Field label={label}><Select<string> aria-label={label} value={str(c[key])} disabled={readOnly} onValueChange={(v) => set({ [key]: Number(v) || null })} options={list} placeholder="Choose…" /></Field>;
  return (
    <Card title={voc.steps.find((s) => s.value === step.type)?.label ?? step.type} action={!readOnly ? <button type="button" aria-label="Remove this step" className="text-ink-3 hover:text-danger" onClick={onRemove}><Icon name="trash" size={14} /></button> : undefined}>
      <div className="flex flex-col gap-3">
        <Field label="Name on the card (optional)"><input className={input} disabled={readOnly} value={step.label ?? ''} maxLength={150} onChange={(e) => onChange({ ...step, label: e.target.value })} /></Field>
        {step.type === 'send_email' ? sel('Email (a campaign of this company)', 'campaign_id', names.campaigns) : null}
        {step.type === 'send_whatsapp' || step.type === 'send_sms' ? (
          <>
            {step.type === 'send_whatsapp' ? <Field label="Approved template (name)"><input className={input} disabled={readOnly} value={str(c.template)} onChange={(e) => set({ template: e.target.value })} /></Field> : null}
            <Field label="Message"><textarea className={`${input} !h-auto py-1.5`} rows={3} disabled={readOnly} maxLength={1000} value={str(c.text)} onChange={(e) => set({ text: e.target.value })} /></Field>
          </>
        ) : null}
        {step.type === 'wait' ? (
          <div className="grid grid-cols-3 gap-2">
            {(['days', 'hours', 'minutes'] as const).map((k) => <Field key={k} label={k.charAt(0).toUpperCase() + k.slice(1)}><input type="number" min={0} className={input} disabled={readOnly} value={str(c[k])} onChange={(e) => set({ [k]: Number(e.target.value) })} /></Field>)}
          </div>
        ) : null}
        {step.type === 'wait_until' ? (
          <>
            <Field label="Time of day, the contact's clock"><input type="time" className={input} disabled={readOnly} value={str(c.time)} onChange={(e) => set({ time: e.target.value, at: null })} /></Field>
            <Field label="…or a fixed date and time"><input type="datetime-local" className={input} disabled={readOnly} value={str(c.at).replace(' ', 'T')} onChange={(e) => set({ at: e.target.value || null, time: e.target.value ? null : '09:00' })} /></Field>
          </>
        ) : null}
        {step.type === 'branch' ? (
          <>
            <div className="flex items-center gap-2 text-[12.5px] text-ink-2">Yes when they match
              <Select<'all' | 'any'> aria-label="Branch: match" value={c.match === 'any' ? 'any' : 'all'} disabled={readOnly} onValueChange={(v) => set({ match: v })} className="h-[28px] w-auto" options={[{ value: 'all', label: 'all' }, { value: 'any', label: 'any' }]} /> of</div>
            <RuleTree drafts={drafts} onChange={(ds) => { setDrafts(ds); set({ rules: rulesOf(ds, options.segment_fields) }); }} fields={options.segment_fields} people={people} lists={(lists.data?.items ?? []).filter((l) => String(l.org_id) === orgId)} wrong={{}} editable={!readOnly} />
          </>
        ) : null}
        {step.type === 'split' ? <Field label={`Path A ${Number(c.a_percent ?? 50)}% · Path B ${100 - Number(c.a_percent ?? 50)}%`}><input type="range" min={1} max={99} aria-label="Share on path A" disabled={readOnly} value={Number(c.a_percent ?? 50)} onChange={(e) => set({ a_percent: Number(e.target.value) })} /></Field> : null}
        {step.type === 'tag_add' || step.type === 'tag_remove' ? <Field label="Tag"><input className={input} disabled={readOnly} value={str(c.tag)} onChange={(e) => set({ tag: e.target.value })} /></Field> : null}
        {step.type === 'list_add' || step.type === 'list_remove' ? sel('List', 'list_id', names.lists) : null}
        {step.type === 'call_task' ? sel('Call campaign', 'campaign_id', names.callCampaigns) : null}
        {step.type === 'crm_lead' ? <p className="m-0 text-[12.5px] text-ink-2">Hands the contact to CRM as a lead, or links the lead already there.</p> : null}
        {step.type === 'notify' ? (
          <>
            {sel('Who (empty: the contact’s owner)', 'user_id', [{ value: '', label: 'The contact’s owner' }, ...people])}
            <Field label="Message"><input className={input} disabled={readOnly} maxLength={255} value={str(c.message)} onChange={(e) => set({ message: e.target.value })} /></Field>
          </>
        ) : null}
        {step.type === 'webhook' ? <Field label="Address (https)" hint="POSTed as JSON, signed in X-WorkSuite-Signature, retried 3 times."><input className={input} disabled={readOnly} value={str(c.url)} onChange={(e) => set({ url: e.target.value })} placeholder="https://example.com/hooks" /></Field> : null}
        {stat ? (
          <dl className="m-0 grid grid-cols-5 gap-1 text-center text-[11px] text-ink-3">
            {(['entered', 'waiting', 'completed', 'exited', 'failed'] as const).map((k) => <div key={k}><dt>{k}</dt><dd className="m-0 text-[14px] font-bold text-ink tabular-nums">{n(stat[k])}</dd></div>)}
          </dl>
        ) : null}
        <span className="text-[11px] text-ink-3">Step {stepKey}</span>
      </div>
    </Card>
  );
}

function People({ journeyId }: { journeyId: number }) {
  const [status, setStatus] = useState('');
  const q = useQuery({ queryKey: ['marketing', 'journey-people', journeyId, status], queryFn: ({ signal }) => apiGet<{ items: Enrollment[] }>(`/api/marketing/journeys/${journeyId}/enrollments`, status ? { status } : undefined, signal), retry: false });
  return (
    <Card title="People in this journey" action={<Select<string> aria-label="Show" value={status} onValueChange={setStatus} className="w-auto" options={[{ value: '', label: 'Everybody' }, { value: 'active', label: 'In it now' }, { value: 'completed', label: 'Completed' }, { value: 'goal', label: 'Reached goal' }, { value: 'exited', label: 'Left early' }, { value: 'parked', label: 'Parked' }]} />}>
      {q.isLoading ? <Spinner /> : !q.data?.items.length ? <Empty text="Nobody yet." /> : (
        <table className="w-full text-left text-[12.5px]">
          <thead className="text-[11px] text-ink-3 uppercase"><tr><th scope="col" className="py-1">Contact</th><th scope="col">Where</th><th scope="col">Next</th><th scope="col">Why</th></tr></thead>
          <tbody>
            {q.data.items.map((e) => (
              <tr key={e.id} className="border-t border-line">
                <td className="py-1.5 font-semibold text-ink">{e.contact.name}{e.test ? ' (test)' : ''}</td>
                <td><Pill tone={e.status === 'parked' ? 'red' : e.status === 'active' ? 'blue' : e.status === 'goal' ? 'green' : 'slate'}>{e.status}</Pill> {e.step ?? ''}</td>
                <td className="text-ink-2">{e.next_at ? dateLabel(e.next_at) : '—'}</td>
                <td className="text-ink-2">{e.reason ?? ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  );
}

function TestRun({ journeyId, org, dirty, onClose }: { journeyId: number; org: string; dirty: boolean; onClose: () => void }) {
  const [term, setTerm] = useState('');
  const [path, setPath] = useState<{ name: string; steps: SimStep[] } | null>(null);
  const found = useQuery({ queryKey: ['marketing', 'journey-test', org, term], queryFn: ({ signal }) => apiGet<{ items: Array<{ id: number; name: string; email: string | null }> }>('/api/marketing/contacts', withOrg(org, { q: term, per_page: 8 }), signal), enabled: term.trim().length >= 2, retry: false });
  const run = async (contactId: number) => {
    try {
      const r = await send<{ contact?: { name: string }; path?: SimStep[] }>('POST', `/api/marketing/journeys/${journeyId}/test`, { contact_id: contactId });
      setPath({ name: r.data?.contact?.name ?? '', steps: r.data?.path ?? [] });
    } catch (e) {
      toast('error', refusal(e));
    }
  };
  return (
    <Sheet title="Test with a contact" onClose={onClose} width={560} footer={<button type="button" className={btn} onClick={onClose}>Close</button>}>
      <p className="m-0 mb-2 text-[12px] text-ink-3">A dry run of the saved draft: nothing is sent or changed.{dirty ? ' Save the draft first — the test walks what is saved.' : ''}</p>
      <Field label="Find a contact"><input className={input} value={term} onChange={(e) => setTerm(e.target.value)} placeholder="Name or email" autoFocus /></Field>
      <ul className="m-0 mt-2 list-none p-0">
        {(found.data?.items ?? []).map((c) => <li key={c.id}><button type="button" className="w-full rounded-[6px] px-1 py-1 text-left text-[13px] hover:bg-subtle" onClick={() => void run(c.id)}>{c.name} <span className="text-ink-3">{c.email ?? ''}</span></button></li>)}
      </ul>
      {path ? (
        <ol className="m-0 mt-3 flex list-none flex-col gap-1.5 p-0 text-[12.5px]" aria-label={`${path.name}'s path`}>
          {path.steps.map((s, i) => <li key={`${s.step}-${i}`} className="rounded-[8px] border border-line p-2"><b className="text-ink">{i + 1}. {s.label}</b> — {s.outcome}</li>)}
          <li className="text-[12px] text-ink-3">Then the journey ends.</li>
        </ol>
      ) : null}
    </Sheet>
  );
}
