import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { apiGet } from '../../core/api';
import { dateLabel } from '../../core/time';
import { toast } from '../../core/toasts';
import { Icon } from '../../components/Icon';
import { Select } from '../../components/Select';
import { send, withOrg } from './api';
import { btn, btnPrimary, btnSmall, Card, Field, input, n, Pill, Sheet } from './parts';
import { refusal, type Rule } from './types';

/**
 * Stream C's shapes and the small pieces several screens share (MKT-AUT,
 * FRM, SCO, SEG-08, AI-01/02/03), the same as the web's `automation.ts`:
 * what the server sends, and nothing that decides who may be sent what.
 */

export type JourneyStatus = 'draft' | 'active' | 'paused' | 'archived';
export type StepType = 'send_email' | 'send_whatsapp' | 'send_sms' | 'wait' | 'wait_until' | 'branch' | 'split' | 'tag_add' | 'tag_remove'
  | 'list_add' | 'list_remove' | 'call_task' | 'crm_lead' | 'notify' | 'webhook';
export type Arrow = 'next' | 'yes' | 'no' | 'a' | 'b';

export interface Pair { value: string; label: string }
export interface Condition { match: 'all' | 'any'; rules: Rule[] }
export interface Step { type: StepType; config: Record<string, unknown>; label?: string | null; next?: string | null; yes?: string | null; no?: string | null; a?: string | null; b?: string | null }
export interface Definition {
  trigger: { type: string; config: Record<string, unknown> };
  start: string | null;
  steps: Record<string, Step>;
  goal: Condition | null;
  exit: Condition | null;
  reentry: { policy: 'never' | 'after_days' | 'always'; days: number | null };
  exit_sales_ready: boolean;
}
export interface JourneyStats { entered: number; active: number; completed: number; goal: number; exited: number; parked: number; conversion: number | null }
export interface Journey {
  id: number; org_id: number; name: string; description: string | null; status: JourneyStatus; version: number;
  trigger: Definition['trigger'] | null; stats: JourneyStats; updated_at: string | null;
}
export interface StepStat { entered: number; waiting: number; completed: number; exited: number; failed: number }
export interface Vocabulary { triggers: Pair[]; steps: Pair[]; reentry: Pair[]; call_outcomes: Pair[]; crm_stages: Pair[]; statuses: Pair[] }
export interface JourneyDetail extends Journey {
  definition: Definition; problems: Record<string, string>; dirty: boolean; step_stats: Record<string, StepStat>; vocabulary: Vocabulary; may_manage: boolean;
}
export interface Enrollment { id: number; contact: { id: number; name: string }; status: string; step: string | null; next_at: string | null; reason: string | null; test: boolean; entered_at: string | null }
export interface SimStep { step: string; type: StepType; label: string; outcome: string }

export const JOURNEY_PILL: Record<JourneyStatus, 'slate' | 'green' | 'amber'> = { draft: 'slate', active: 'green', paused: 'amber', archived: 'slate' };

export function exits(type: StepType): Arrow[] {
  if (type === 'branch') return ['yes', 'no'];
  if (type === 'split') return ['a', 'b'];
  return ['next'];
}

export function blankConfig(type: StepType): Record<string, unknown> {
  switch (type) {
    case 'wait': return { days: 1, hours: 0, minutes: 0 };
    case 'wait_until': return { time: '09:00', at: null };
    case 'branch': return { match: 'all', rules: [{ field: 'email_status', op: 'is', value: ['subscribed'] }] };
    case 'split': return { a_percent: 50 };
    case 'notify': return { message: 'Have a look at {{first_name}}.', user_id: null };
    default: return {};
  }
}

/** A new step at an arrow; what followed there now follows it. */
export function insertStep(def: Definition, from: string | null, arrow: Arrow, type: StepType): { def: Definition; key: string } {
  let i = Object.keys(def.steps).length + 1;
  while (def.steps[`s${i}`]) i++;
  const key = `s${i}`;
  const steps = { ...def.steps };
  const after = from === null ? def.start : (steps[from]?.[arrow] ?? null);
  const step: Step = { type, config: blankConfig(type), label: null };
  for (const a of exits(type)) step[a] = null;
  step[exits(type)[0] ?? 'next'] = after;
  steps[key] = step;
  if (from === null) return { def: { ...def, steps, start: key }, key };
  const was = steps[from];
  if (was) steps[from] = { ...was, [arrow]: key };
  return { def: { ...def, steps }, key };
}

/** A step taken out: its first path takes its place, a second path goes with it. */
export function removeStep(def: Definition, key: string): Definition {
  const step = def.steps[key];
  if (!step) return def;
  const keep = step[exits(step.type)[0] ?? 'next'] ?? null;
  const steps: Record<string, Step> = { ...def.steps };
  const drop = (k: string | null | undefined) => {
    if (!k || !steps[k]) return;
    const s = steps[k];
    delete steps[k];
    for (const a of exits(s.type)) drop(s[a]);
  };
  for (const a of exits(step.type).slice(1)) drop(step[a]);
  delete steps[key];
  for (const [k, s] of Object.entries(steps)) for (const a of exits(s.type)) if (s[a] === key) steps[k] = { ...(steps[k] ?? s), [a]: keep };
  return { ...def, steps, start: def.start === key ? keep : def.start };
}

/** The company's forms or journeys by name, for a picker. */
export function useNames(what: 'forms' | 'journeys' | 'pages', org: string, enabled = true) {
  const q = useQuery({
    queryKey: ['marketing', `${what}-names`, org],
    queryFn: ({ signal }) => apiGet<{ items: Array<{ id: number; org_id: number; name: string }> }>(`/api/marketing/${what}`, withOrg(org), signal),
    enabled: enabled && org !== '',
    retry: false,
    staleTime: 60_000,
  });
  return (q.data?.items ?? []).filter((x) => !org || org.split(',').includes(String(x.org_id))).map((x) => ({ id: x.id, name: x.name }));
}

/** MKT-AI-02: the segment in a sentence; rules come back to read before saving. */
export function AiSegmentDraft({ orgId, onRules }: { orgId: number; onRules: (match: 'all' | 'any', rules: Rule[]) => void }) {
  const [ask, setAsk] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const go = async () => {
    setBusy(true);
    try {
      const r = await send<{ match?: 'all' | 'any'; rules?: Rule[]; members?: number }>('POST', '/api/marketing/ai/segment', { org_id: orgId, ask: ask.trim() });
      onRules(r.data?.match === 'any' ? 'any' : 'all', r.data?.rules ?? []);
      setNote(`${r.message ?? 'Drafted.'}${typeof r.data?.members === 'number' ? ` ${n(r.data.members)} match now.` : ''}`);
    } catch (e) {
      toast('error', refusal(e, 'The AI assistant could not draft that.'));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card title="Describe it">
      <textarea aria-label="Describe the people" className={`${input} !h-auto py-1.5`} rows={2} maxLength={500} value={ask} onChange={(e) => setAsk(e.target.value)} placeholder="Colombo contacts who clicked in the last 30 days" />
      <button type="button" className={`${btnSmall} mt-2 gap-1`} disabled={busy || ask.trim() === ''} onClick={() => void go()}><Icon name="sparkles" size={13} /> {busy ? 'Drafting…' : 'Draft rules'}</button>
      <p role="status" className="m-0 mt-2 text-[12px] text-ink-3">{note ?? 'An AI draft: the rules appear to check before you save.'}</p>
    </Card>
  );
}

interface Snapshot { id: number; list_id: number; list_name: string | null; frequency: 'daily' | 'weekly'; mode: 'replace' | 'add'; last_count: number | null; last_run_at: string | null }

/** MKT-SEG-08: the segment copied into a list every day or week, by the server. */
export function SnapshotPanel({ segmentId, mayEdit, dirty, onList }: { segmentId: number | null; mayEdit: boolean; dirty: boolean; onList?: (id: number) => void }) {
  const qc = useQueryClient();
  const [frequency, setFrequency] = useState<'daily' | 'weekly'>('daily');
  const [mode, setMode] = useState<'replace' | 'add'>('replace');
  const [busy, setBusy] = useState(false);
  const q = useQuery({
    queryKey: ['marketing', 'snapshots', segmentId],
    queryFn: ({ signal }) => apiGet<{ items: Snapshot[] }>(`/api/marketing/segments/${segmentId}/snapshots`, undefined, signal),
    enabled: segmentId !== null,
    retry: false,
  });
  const schedule = async () => {
    setBusy(true);
    try {
      const r = await send('POST', `/api/marketing/segments/${segmentId}/snapshots`, { frequency, mode });
      toast('success', r.message ?? 'Scheduled.');
      await qc.invalidateQueries({ queryKey: ['marketing'] });
    } catch (e) {
      toast('error', refusal(e));
    } finally {
      setBusy(false);
    }
  };
  const stop = async (s: Snapshot) => {
    try {
      await send('DELETE', `/api/marketing/snapshots/${s.id}`);
      await qc.invalidateQueries({ queryKey: ['marketing', 'snapshots', segmentId] });
    } catch (e) {
      toast('error', refusal(e));
    }
  };
  return (
    <Card title="Snapshot to a list">
      <p className="m-0 text-[12.5px] text-ink-2">Copy who matches into a list on a schedule, so a campaign can target a frozen audience.</p>
      {segmentId === null ? <p className="m-0 mt-2 text-[12px] text-ink-3">Save the segment first.</p> : (
        <>
          <ul className="m-0 mt-2 flex list-none flex-col gap-1.5 p-0 text-[12.5px]">
            {(q.data?.items ?? []).map((s) => (
              <li key={s.id} className="flex items-center gap-2 rounded-[8px] border border-line p-2">
                <Icon name="camera" size={14} />
                <span className="min-w-0 flex-1">
                  <button type="button" className="font-semibold text-primary hover:underline" onClick={() => onList?.(s.list_id)}>{s.list_name ?? `List ${s.list_id}`}</button>
                  <span className="block text-[11.5px] text-ink-3">{s.frequency === 'weekly' ? 'Every week' : 'Every day'} · {s.mode === 'add' ? 'adds' : 'replaces'}{s.last_run_at ? ` · last ${dateLabel(s.last_run_at)}, ${n(s.last_count)} people` : ' · not taken yet'}</span>
                </span>
                {mayEdit ? <button type="button" aria-label="Stop this schedule" className="text-ink-3 hover:text-danger" onClick={() => void stop(s)}><Icon name="x" size={13} /></button> : null}
              </li>
            ))}
          </ul>
          {mayEdit ? (
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <Select<'daily' | 'weekly'> aria-label="How often" value={frequency} onValueChange={setFrequency} className="w-auto" options={[{ value: 'daily', label: 'Every day' }, { value: 'weekly', label: 'Every week' }]} />
              <Select<'replace' | 'add'> aria-label="How" value={mode} onValueChange={setMode} className="w-auto" options={[{ value: 'replace', label: 'Replace the list' }, { value: 'add', label: 'Add to the list' }]} />
              <button type="button" className={btnSmall} disabled={busy || dirty} title={dirty ? 'Save the segment first.' : undefined} onClick={() => void schedule()}>Schedule</button>
            </div>
          ) : null}
        </>
      )}
    </Card>
  );
}

interface ContactScore {
  behaviour: number; fit: number; score: number; mql_at: string | null; deal: { status: 'won' | 'lost'; at: string | null } | null;
  events: Array<{ rule: string; points: number; now: number; at: string | null }>; fit_rules: Array<{ rule: string; points: number }>;
  settings: { mql_threshold: number }; send_time: { hour: number | null; basis: string; opens: number; zone: string | null };
}

/** A contact's score explained, the CRM deal outcome and the hour they usually open (SCO, CRM-04, AI-03). */
export function ContactScoreCard({ contactId }: { contactId: number }) {
  const q = useQuery({
    queryKey: ['marketing', 'contact-score', contactId],
    queryFn: ({ signal }) => apiGet<ContactScore>(`/api/marketing/contacts/${contactId}/score`, undefined, signal),
    retry: false,
  });
  const s = q.data;
  if (!s || typeof s.score !== 'number' || !s.settings || !s.send_time) return null;
  const hour = s.send_time.hour === null ? '—' : `${String(s.send_time.hour).padStart(2, '0')}:00`;
  return (
    <Card title="Score">
      <p className="m-0 flex items-end gap-3">
        <b className="text-[28px] leading-none text-ink tabular-nums">{n(s.score)}</b>
        <span className="text-[12px] text-ink-3">behaviour {n(s.behaviour)} · fit {n(s.fit)}{s.settings.mql_threshold > 0 ? ` · MQL at ${n(s.settings.mql_threshold)}` : ''}</span>
      </p>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {s.mql_at ? <Pill tone="green">MQL since {dateLabel(s.mql_at)}</Pill> : null}
        {s.deal ? <Pill tone={s.deal.status === 'won' ? 'green' : 'red'}>Deal {s.deal.status}</Pill> : null}
        <Pill tone="blue">Best send hour {hour}{s.send_time.zone ? ` ${s.send_time.zone}` : ''}</Pill>
      </div>
      {s.events.length ? (
        <ul className="m-0 mt-2 list-none p-0 text-[12.5px]">
          {s.events.slice(0, 6).map((e, i) => <li key={i} className="flex justify-between gap-2"><span className="text-ink-2">{e.rule}</span><span className="text-ink-3 tabular-nums">{e.now}/{e.points}</span></li>)}
        </ul>
      ) : null}
    </Card>
  );
}

/** MKT-AI-01: subject lines, preview text and a body from a brief — a draft until "Use this". */
export function AiCopySheet({ orgId, onUse, onClose }: { orgId: number; onUse: (d: { subject: string; preheader: string; body_html: string }) => void; onClose: () => void }) {
  const [brief, setBrief] = useState('');
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState<{ subjects: string[]; preheader: string; body_html: string } | null>(null);
  const [pick, setPick] = useState(0);
  const ask = async () => {
    setBusy(true);
    try {
      const r = await send<{ draft?: { subjects: string[]; preheader: string; body_html: string } }>('POST', '/api/marketing/ai/copy', { org_id: orgId, brief });
      setDraft(r.data?.draft ?? null);
      setPick(0);
    } catch (e) {
      toast('error', refusal(e, 'The AI assistant could not draft that.'));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet title="Draft with AI" onClose={onClose} width={620}
      footer={(
        <>
          <button type="button" className={btn} onClick={onClose}>Cancel</button>
          <button type="button" className={btn} disabled={busy || brief.trim() === ''} onClick={() => void ask()}>{busy ? 'Drafting…' : draft ? 'Try again' : 'Draft'}</button>
          {draft ? <button type="button" className={btnPrimary} onClick={() => onUse({ subject: draft.subjects[pick] ?? '', preheader: draft.preheader, body_html: draft.body_html })}>Use this</button> : null}
        </>
      )}>
      <Field label="What is the email about?">
        <textarea className={`${input} !h-auto py-1.5`} rows={3} maxLength={2000} value={brief} onChange={(e) => setBrief(e.target.value)} placeholder="Our autumn sale: 20% off garden tools until 31 October." />
      </Field>
      {draft ? (
        <div className="mt-3 flex flex-col gap-2 text-[13px]">
          <fieldset className="m-0 border-0 p-0">
            <legend className="mb-1 text-[12px] font-semibold text-ink-3">Subject line</legend>
            {draft.subjects.map((s, i) => <label key={i} className="flex items-center gap-2"><input type="radio" name="ai-subject" checked={pick === i} onChange={() => setPick(i)} /> {s}</label>)}
          </fieldset>
          <span className="text-[12px] text-ink-3">Preview text: {draft.preheader}</span>
          <iframe title="Drafted email" sandbox="" srcDoc={draft.body_html} className="h-56 w-full rounded-[8px] border border-line bg-white" />
        </div>
      ) : null}
    </Sheet>
  );
}
