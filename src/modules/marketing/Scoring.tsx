import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { apiGet } from '../../core/api';
import { toast } from '../../core/toasts';
import { Icon } from '../../components/Icon';
import { Select } from '../../components/Select';
import { ErrorNote, Spinner } from '../../components/ui';
import { send, withOrg } from './api';
import { CountrySelect } from './audience-parts';
import type { Pair } from './automation-parts';
import { btn, btnPrimary, btnSmall, Card, Empty, Field, input, PageHeader, Pill, Sheet } from './parts';
import { companiesWhere, refusal, type Options } from './types';

interface ScoreRule { id: number; org_id: number; kind: 'behaviour' | 'fit'; subject: string; subject_label: string; op: string; value: string | null; points: number; active: boolean }
interface Subject { key: string; label: string; kind: 'behaviour' | 'fit'; type: string; ops: Array<{ key: string; label: string }> }
interface Answer { items: ScoreRule[]; settings: Array<{ org_id: number; mql_threshold: number; decay_percent: number }>; vocabulary: { subjects: Subject[]; call_outcomes: Pair[] } }

/**
 * Lead scoring (MKT-SCO-01..03), as on the web: behaviour rules (what people
 * do) and fit rules (who they are), how fast behaviour fades, and the MQL
 * threshold at which the server hands a contact to CRM. Scores are the
 * server's, worked out each minute and nightly.
 */
export default function Scoring({ org, options }: { org: string; options: Options }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['marketing', 'scores', org], queryFn: ({ signal }) => apiGet<Answer>('/api/marketing/scores', withOrg(org), signal), retry: false });
  const makers = companiesWhere(options, 'scores');
  const [chosen, setChosen] = useState<number | null>(null);
  const company = chosen ?? makers[0]?.id ?? q.data?.settings[0]?.org_id ?? null;
  const may = makers.some((c) => c.id === company);
  const settings = q.data?.settings.find((s) => s.org_id === company);
  const [threshold, setThreshold] = useState<string | null>(null);
  const [decay, setDecay] = useState<string | null>(null);
  const [adding, setAdding] = useState<'behaviour' | 'fit' | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: ['marketing', 'scores'] });
  const act = async (method: 'POST' | 'PUT' | 'DELETE', path: string, body?: unknown) => {
    try {
      const r = await send(method, path, body);
      toast('success', r.message ?? 'Done.');
      await refresh();
    } catch (e) {
      toast('error', refusal(e));
    }
  };
  const rules = (q.data?.items ?? []).filter((r) => r.org_id === company);
  const section = (kind: 'behaviour' | 'fit', title: string, hint: string) => (
    <Card title={title} action={may ? <button type="button" className={btnSmall} onClick={() => setAdding(kind)}><Icon name="plus" size={13} /> Add rule</button> : undefined}>
      <p className="m-0 mb-2 text-[12px] text-ink-3">{hint}</p>
      {!rules.some((r) => r.kind === kind) ? <Empty text="No rules yet." /> : (
        <ul className="m-0 list-none p-0">
          {rules.filter((r) => r.kind === kind).map((r) => (
            <li key={r.id} className="flex flex-wrap items-center gap-2 border-b border-line/70 py-1.5 text-[12.5px] last:border-b-0">
              <b className={r.points >= 0 ? 'w-12 text-right text-success tabular-nums' : 'w-12 text-right text-danger tabular-nums'}>{r.points > 0 ? `+${r.points}` : r.points}</b>
              <span className="min-w-0 flex-1 text-ink">{r.subject_label}{r.op !== 'any' ? ` ${r.op} ${r.value ?? ''}` : ''}</span>
              {!r.active ? <Pill tone="slate">off</Pill> : null}
              {may ? <button type="button" className={btnSmall} onClick={() => void act('PUT', `/api/marketing/scores/${r.id}`, { op: r.op, value: r.value, points: r.points, active: !r.active })}>{r.active ? 'Turn off' : 'Turn on'}</button> : null}
              {may ? <button type="button" aria-label="Delete rule" className="text-ink-3 hover:text-danger" onClick={() => void act('DELETE', `/api/marketing/scores/${r.id}`)}><Icon name="trash" size={13} /></button> : null}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );

  return (
    <div className="flex flex-col gap-4">
      <PageHeader crumbs={['Automation']} title="Lead scoring" sub="Behaviour + fit = score · a contact at the MQL threshold is handed to CRM"
        actions={may ? <button type="button" className={btn} onClick={() => void act('POST', '/api/marketing/scores/recalculate', { org_id: company })}><Icon name="rotate-cw" size={14} /> Recalculate now</button> : undefined} />
      {makers.length > 1 ? <span className="w-[240px]"><Select<string> aria-label="Company" value={String(company ?? '')} onValueChange={(v) => setChosen(Number(v))} options={makers.map((c) => ({ value: String(c.id), label: c.name }))} /></span> : null}
      {q.isLoading ? <Spinner /> : q.error ? <ErrorNote error={q.error} /> : (
        <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
          <div className="flex min-w-0 flex-col gap-4">
            {section('behaviour', 'Behaviour — what they do', 'Opens, clicks, form sign-ups, call outcomes and landing page visits: each counts once, and fades every 30 days.')}
            {section('fit', 'Fit — who they are', 'Job title, industry, country and company size (the custom field "company_size" or "employees").')}
          </div>
          <Card title="Threshold and decay">
            <div className="flex flex-col gap-3">
              <Field label="MQL threshold (0: off)"><input type="number" min={0} max={10000} className={input} disabled={!may} value={threshold ?? String(settings?.mql_threshold ?? 0)} onChange={(e) => setThreshold(e.target.value)} /></Field>
              <Field label="Behaviour fades by (% per 30 days)"><input type="number" min={0} max={100} className={input} disabled={!may} value={decay ?? String(settings?.decay_percent ?? 25)} onChange={(e) => setDecay(e.target.value)} /></Field>
              {may ? <button type="button" className={btnPrimary} onClick={() => void act('PUT', '/api/marketing/scores/settings', { org_id: company, mql_threshold: Number(threshold ?? settings?.mql_threshold ?? 0), decay_percent: Number(decay ?? settings?.decay_percent ?? 25) })}>Save</button> : null}
            </div>
          </Card>
        </div>
      )}
      {adding && company !== null && q.data ? <RuleSheet kind={adding} orgId={company} subjects={q.data.vocabulary.subjects.filter((s) => s.kind === adding)} outcomes={q.data.vocabulary.call_outcomes} onClose={() => setAdding(null)} onSaved={() => { setAdding(null); void refresh(); }} /> : null}
    </div>
  );
}

function RuleSheet({ kind, orgId, subjects, outcomes, onClose, onSaved }: { kind: 'behaviour' | 'fit'; orgId: number; subjects: Subject[]; outcomes: Pair[]; onClose: () => void; onSaved: () => void }) {
  const [subject, setSubject] = useState(subjects[0]?.key ?? '');
  const s = subjects.find((x) => x.key === subject);
  const [op, setOp] = useState(s?.ops[0]?.key ?? 'any');
  const [value, setValue] = useState('');
  const [points, setPoints] = useState(kind === 'behaviour' ? '5' : '10');
  const forms = useQuery({ queryKey: ['marketing', 'forms-names', String(orgId)], queryFn: ({ signal }) => apiGet<{ items: Array<{ id: number; name: string }> }>('/api/marketing/forms', { org: orgId }, signal), enabled: s?.type === 'form', retry: false });
  const pages = useQuery({ queryKey: ['marketing', 'pages-names', String(orgId)], queryFn: ({ signal }) => apiGet<{ items: Array<{ id: number; name: string }> }>('/api/marketing/pages', { org: orgId }, signal), enabled: s?.type === 'page', retry: false });
  const save = async () => {
    try {
      await send('POST', '/api/marketing/scores', { org_id: orgId, subject, op, value, points: Number(points) });
      onSaved();
    } catch (e) {
      toast('error', refusal(e));
    }
  };
  return (
    <Sheet title={kind === 'behaviour' ? 'Behaviour rule' : 'Fit rule'} onClose={onClose} footer={<><button type="button" className={btn} onClick={onClose}>Cancel</button><button type="button" className={btnPrimary} onClick={() => void save()}>Save</button></>}>
      <div className="flex flex-col gap-3">
        <Field label="When"><Select<string> aria-label="When" value={subject} onValueChange={(v) => { setSubject(v); setOp(subjects.find((x) => x.key === v)?.ops[0]?.key ?? 'any'); setValue(''); }} options={subjects.map((x) => ({ value: x.key, label: x.label }))} /></Field>
        {s && s.ops.length > 1 ? <Field label="How"><Select<string> aria-label="How" value={op} onValueChange={setOp} options={s.ops.map((o) => ({ value: o.key, label: o.label }))} /></Field> : null}
        {s && op !== 'any' ? (
          <Field label="Value">
            {s.type === 'outcome' ? <Select<string> aria-label="Value" value={value} onValueChange={setValue} options={outcomes} placeholder="Choose an outcome" />
              : s.type === 'country' ? <CountrySelect label="Value" value={value} empty="Choose a country…" onChange={(c) => setValue(c ?? '')} />
                : s.type === 'form' ? <Select<string> aria-label="Value" value={value} onValueChange={setValue} options={(forms.data?.items ?? []).map((f) => ({ value: String(f.id), label: f.name }))} placeholder="Choose a form" />
                  : s.type === 'page' ? <Select<string> aria-label="Value" value={value} onValueChange={setValue} options={(pages.data?.items ?? []).map((f) => ({ value: String(f.id), label: f.name }))} placeholder="Choose a page" />
                    : <input aria-label="Value" className={input} type={s.type === 'number' ? 'number' : 'text'} value={value} onChange={(e) => setValue(e.target.value)} />}
          </Field>
        ) : null}
        <Field label="Points (-100 to 100)"><input type="number" min={-100} max={100} className={input} value={points} onChange={(e) => setPoints(e.target.value)} /></Field>
      </div>
    </Sheet>
  );
}
