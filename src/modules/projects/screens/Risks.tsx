import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { errorMessage } from '../../../core/bridge';
import { toast } from '../../../core/toasts';
import { Select } from '../../../components/Select';
import { Button, ErrorNote, Modal, Spinner, cx } from '../../../components/ui';
import { qk } from '../api';
import { useProjectCompany } from '../company';
import { gk, gov, govWrite, type Risk, type RiskStatus } from './gov-api';
import { ConfirmDialog, Field, Mono, PageHead, ProjectFilter, RISK_LEVEL, RISK_STATUS, Tabs, Tone, WAITS, WebButton, areaClass, fmtDay, inputClass, useLiveProjects, useMemberOptions } from './gov-kit';

/**
 * W13 · Risks (SRS p46, PRJ-GOV): the register, the portfolio's (`/projects/risks`) and one project's
 * (`/projects/<id>/risks`).
 *
 * Score = impact × probability, each 1–4, so the heat map is a 4 × 4 table of how many open and mitigating risks sit
 * in each cell; every cell is announced with its impact, probability, level and count, and the legend says the levels
 * in words — the colour only repeats them (NFR-08). Raising, editing and deleting need `can.manage` and WorkSuite;
 * without manage a risk opens read-only.
 */

type Tab = 'open' | 'mitigating' | 'realised' | 'closed' | 'all';

/** Highest first, as the heat map's rows read. */
export const IMPACTS = ['critical', 'high', 'medium', 'low'] as const;
export const PROBABILITIES = ['low', 'medium', 'high', 'certain'] as const;
const IMPACT_N: Record<string, number> = { low: 1, medium: 2, high: 3, critical: 4 };
const PROB_N: Record<string, number> = { low: 1, medium: 2, high: 3, certain: 4 };
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** critical 12–16 · high 6–9 · medium 3–4 · low 1–2 */
export function levelOf(score: number): 'critical' | 'high' | 'medium' | 'low' {
  return score >= 12 ? 'critical' : score >= 6 ? 'high' : score >= 3 ? 'medium' : 'low';
}

export function RisksScreen({ projectId = null, offline, onOffline, onGo }: { projectId?: number | null; offline: boolean; onOffline: (o: boolean) => void; onGo: (route: string) => void }) {
  useProjectCompany();
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>('open');
  const [projectFilter, setProjectFilter] = useState('');
  const [editing, setEditing] = useState<Risk | 'new' | null>(null);
  const pid = projectId ?? (Number(projectFilter) || null);
  const p = { status: tab, project_id: pid };
  const q = useQuery({ queryKey: gk.risks(p), queryFn: ({ signal }) => gov.risks(p, { signal }) });
  const projects = useLiveProjects(!projectId);
  const d = q.data?.data;
  const fromCache = !!q.data?.offline;
  useEffect(() => onOffline(fromCache), [fromCache, onOffline]);
  const risks = [...(d?.risks ?? [])].sort((a, b) => b.score - a.score);
  const manage = !!d?.can?.manage;
  const first = risks[0];

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHead crumb={projectId && first ? `${first.project_code} · ${first.project}` : undefined} title="Risks">
        <Tabs<Tab>
          label="Status"
          value={tab}
          onChange={setTab}
          tabs={[
            { key: 'open', label: 'Open', count: d?.counts.open },
            { key: 'mitigating', label: 'Mitigating', count: d?.counts.mitigating },
            { key: 'realised', label: 'Realised', count: d?.counts.realised },
            { key: 'closed', label: 'Closed', count: d?.counts.closed },
            { key: 'all', label: 'All', count: d?.counts.all },
          ]}
        />
        {!projectId ? <ProjectFilter value={projectFilter} onChange={setProjectFilter} options={projects} /> : <Button size="sm" icon="board" onClick={() => onGo(`/projects/${projectId}/board`)}>Board</Button>}
        {manage ? (
          <Button size="sm" variant="primary" icon="plus" disabled={offline} title={offline ? WAITS : undefined} onClick={() => setEditing('new')}>
            Raise a risk
          </Button>
        ) : null}
        <WebButton path={projectId ? `/projects/${projectId}/risks` : '/projects/risks'} />
      </PageHead>
      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4 scroll-thin">
        <div className="grid gap-3.5 lg:grid-cols-[320px_minmax(0,1fr)]">
          <section className="flex flex-col gap-2 self-start rounded-[12px] border border-line bg-surface p-3.5">
            <h2 className="text-[14px] font-bold text-ink">Heat map</h2>
            <span className="text-[12px] text-ink-3">Impact × probability, open and mitigating</span>
            {d ? <HeatMap heat={d.heat} /> : <Spinner />}
            <p className="border-t border-line pt-1.5 text-[12px] text-ink-2">
              <strong className="text-danger">Critical</strong> score 12–16 · <strong className="text-[#9A3412] dark:text-[#FDBA74]">High</strong> 6–9 · <strong className="text-warning-ink">Medium</strong> 3–4 · Low 1–2
            </p>
          </section>
          <section className="self-start overflow-x-auto rounded-[12px] border border-line bg-surface">
            {q.isLoading ? <Spinner /> : q.error && !d ? <div className="p-3"><ErrorNote error={q.error} onRetry={() => void q.refetch()} /></div> : !risks.length ? (
              <p className="px-4 py-6 text-center text-ink-3">No risks here.</p>
            ) : (
              <table className="w-full min-w-[720px] border-collapse text-[12.5px]">
                <thead className="bg-subtle text-[11.5px] text-ink-3">
                  <tr>
                    <th className="px-3 py-2 text-start font-semibold">Score</th>
                    <th className="px-3 py-2 text-start font-semibold">Risk</th>
                    <th className="px-3 py-2 text-start font-semibold">Impact · probability</th>
                    <th className="px-3 py-2 text-start font-semibold">Owner</th>
                    <th className="px-3 py-2 text-start font-semibold">Review by</th>
                    <th className="px-3 py-2 text-start font-semibold">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {risks.map((r) => {
                    const lv = RISK_LEVEL[r.level] ?? RISK_LEVEL[levelOf(r.score)]!;
                    const st = RISK_STATUS[r.status] ?? { label: r.status, tone: 'bg-subtle text-ink-2' };
                    return (
                      <tr key={r.id} className="border-t border-line/70 align-top">
                        <td className="px-3 py-2">
                          <span className={cx('inline-block w-8 rounded-[7px] py-0.5 text-center font-mono text-[12px] font-bold', lv.cell)} title={lv.label}>
                            {r.score}
                            <span className="sr-only"> ({lv.label})</span>
                          </span>
                        </td>
                        <td className="px-3 py-2">
                          <button type="button" onClick={() => setEditing(r)} className="text-start font-semibold text-ink hover:text-primary hover:underline">
                            {r.title}
                          </button>
                          {!projectId ? (
                            <div className="text-[11.5px] text-ink-3">
                              <Mono>{r.project_code}</Mono> · {r.project}
                            </div>
                          ) : null}
                          {r.mitigation ? <div className="mt-0.5 text-[12px] text-ink-2">Mitigation: {r.mitigation}</div> : null}
                        </td>
                        <td className="px-3 py-2 text-ink-2">
                          {cap(r.impact)} · {r.probability}
                        </td>
                        <td className="px-3 py-2 text-ink-2">{r.owner ?? '—'}</td>
                        <td className={cx('px-3 py-2', r.review_overdue ? 'font-semibold text-danger' : 'text-ink-2')}>{r.due_date ? `${fmtDay(r.due_date)}${r.review_overdue ? ' (overdue)' : ''}` : '—'}</td>
                        <td className="px-3 py-2">
                          <Tone tone={st.tone}>{st.label}</Tone>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </section>
        </div>
      </div>
      {editing ? (
        <RiskDialog
          risk={editing === 'new' ? null : editing}
          projectId={projectId}
          canManage={manage}
          offline={offline}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            void qc.invalidateQueries({ queryKey: ['projects', 'risks'] });
            void qc.invalidateQueries({ queryKey: ['projects', 'detail'] });
            void qc.invalidateQueries({ queryKey: qk.counts });
          }}
        />
      ) : null}
    </div>
  );
}

export function HeatMap({ heat }: { heat: Record<string, Record<string, number>> }) {
  return (
    <table className="w-full border-separate border-spacing-1 text-[11px]">
      <caption className="sr-only">Open and mitigating risks by impact (rows) and probability (columns)</caption>
      <thead className="sr-only">
        <tr>
          <td />
          {PROBABILITIES.map((p) => (
            <th key={p} scope="col">
              Probability {p}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {IMPACTS.map((i) => (
          <tr key={i}>
            <th scope="row" className="w-[64px] pe-1 text-end font-normal text-ink-2">
              {cap(i)}
              <span className="sr-only"> impact</span>
            </th>
            {PROBABILITIES.map((p) => {
              const n = heat?.[i]?.[p] ?? 0;
              const score = IMPACT_N[i]! * PROB_N[p]!;
              const lv = RISK_LEVEL[levelOf(score)]!;
              return (
                <td key={p} className={cx('h-10 rounded-[8px] text-center font-mono text-[15px] font-bold', lv.cell)}>
                  <span aria-hidden>{n || ''}</span>
                  <span className="sr-only">{`Impact ${i}, probability ${p}: ${n} risk${n === 1 ? '' : 's'}, score ${score}, ${lv.label.toLowerCase()}`}</span>
                </td>
              );
            })}
          </tr>
        ))}
        <tr aria-hidden>
          <td />
          {PROBABILITIES.map((p) => (
            <td key={p} className="pt-0.5 text-center text-ink-2">
              {cap(p)}
            </td>
          ))}
        </tr>
        <tr aria-hidden>
          <td />
          <td colSpan={4} className="text-center text-[11.5px] text-ink-3">
            probability →
          </td>
        </tr>
      </tbody>
    </table>
  );
}

function RiskDialog({ risk, projectId, canManage, offline, onClose, onSaved }: { risk: Risk | null; projectId: number | null; canManage: boolean; offline: boolean; onClose: () => void; onSaved: () => void }) {
  const projects = useLiveProjects(!projectId && !risk);
  const [f, setF] = useState({
    project_id: String(risk?.project_id ?? projectId ?? ''),
    title: risk?.title ?? '',
    description: risk?.description ?? '',
    impact: risk?.impact ?? 'medium',
    probability: risk?.probability ?? 'medium',
    owner_id: String(risk?.owner_id ?? ''),
    due_date: risk?.due_date?.slice(0, 10) ?? '',
    mitigation: risk?.mitigation ?? '',
    status: (risk?.status ?? 'open') as RiskStatus,
  });
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));
  const members = useMemberOptions(Number(f.project_id) || null);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const score = (IMPACT_N[f.impact] ?? 2) * (PROB_N[f.probability] ?? 2);
  const readOnly = !canManage;
  const valid = !!f.title.trim() && !!f.project_id;

  const save = async () => {
    if (readOnly || !valid || offline) return;
    setBusy(true);
    try {
      const body = { title: f.title.trim(), description: f.description.trim(), impact: f.impact, probability: f.probability, owner_id: Number(f.owner_id) || null, due_date: f.due_date || null, mitigation: f.mitigation.trim() };
      const r = risk ? await govWrite.updateRisk(risk.id, { ...body, status: f.status }) : await govWrite.createRisk({ ...body, project_id: Number(f.project_id) });
      toast('success', r.message && r.message !== 'OK' ? r.message : risk ? 'Risk saved' : 'Risk raised');
      onSaved();
    } catch (e) {
      toast('error', errorMessage(e));
      setBusy(false);
    }
  };
  const remove = async () => {
    if (!risk) return;
    try {
      await govWrite.deleteRisk(risk.id);
      toast('success', 'Risk deleted');
      onSaved();
    } catch (e) {
      toast('error', errorMessage(e));
    }
  };

  return (
    <Modal
      title={risk ? (readOnly ? risk.title : 'Edit risk') : 'Raise a risk'}
      onClose={onClose}
      width={560}
      footer={
        <>
          {risk && canManage ? (
            <Button variant="danger" className="me-auto" disabled={offline} title={offline ? WAITS : undefined} onClick={() => setConfirm(true)}>
              Delete
            </Button>
          ) : null}
          <Button onClick={onClose}>{readOnly ? 'Close' : 'Cancel'}</Button>
          {!readOnly ? (
            <Button variant="primary" loading={busy} disabled={!valid || offline} title={offline ? WAITS : undefined} onClick={() => void save()}>
              {risk ? 'Save' : 'Raise risk'}
            </Button>
          ) : null}
        </>
      }
    >
      <fieldset disabled={readOnly} className="flex flex-col gap-3">
        {risk ? (
          <span className="font-mono text-[11.5px] text-ink-3">
            {risk.project_code} · {risk.project}
          </span>
        ) : null}
        {!projectId && !risk ? (
          <Field label="Project" required>
            <Select aria-label="Project" value={f.project_id} onValueChange={(v) => setF((x) => ({ ...x, project_id: v, owner_id: '' }))} options={[{ value: '', label: 'Choose a project…' }, ...projects]} className={inputClass} />
          </Field>
        ) : null}
        <Field label="Title" required>
          <input autoFocus value={f.title} onChange={(e) => set('title', e.target.value)} className={inputClass} />
        </Field>
        <Field label="Description">
          <textarea rows={2} value={f.description} onChange={(e) => set('description', e.target.value)} className={areaClass} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Impact">
            <Select aria-label="Impact" value={f.impact} onValueChange={(v) => set('impact', v)} options={[...IMPACTS].reverse().map((i) => ({ value: i, label: cap(i) }))} className={inputClass} disabled={readOnly} />
          </Field>
          <Field label="Probability">
            <Select aria-label="Probability" value={f.probability} onValueChange={(v) => set('probability', v)} options={PROBABILITIES.map((p) => ({ value: p, label: cap(p) }))} className={inputClass} disabled={readOnly} />
          </Field>
        </div>
        <p className="text-[12px] text-ink-2" aria-live="polite">
          Score <Mono className="font-bold">{score}</Mono> · {RISK_LEVEL[levelOf(score)]!.label}
        </p>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Owner" hint="A member of the project">
            <Select aria-label="Owner" value={f.owner_id} onValueChange={(v) => set('owner_id', v)} options={[{ value: '', label: 'No owner' }, ...members]} className={inputClass} disabled={readOnly || !f.project_id} />
          </Field>
          <Field label="Review by">
            <input type="date" value={f.due_date} onChange={(e) => set('due_date', e.target.value)} className={inputClass} />
          </Field>
        </div>
        <Field label="Mitigation">
          <textarea rows={2} value={f.mitigation} onChange={(e) => set('mitigation', e.target.value)} placeholder="What reduces the chance or the damage" className={areaClass} />
        </Field>
        {risk ? (
          <Field label="Status">
            <Select aria-label="Status" value={f.status} onValueChange={(v) => set('status', v as RiskStatus)} options={(['open', 'mitigating', 'closed', 'realised'] as const).map((s) => ({ value: s, label: RISK_STATUS[s]!.label }))} className={inputClass} disabled={readOnly} />
          </Field>
        ) : null}
        {offline && !readOnly ? <p className="text-[12px] text-warning-ink">Risk changes wait for a connection.</p> : null}
      </fieldset>
      {confirm && risk ? <ConfirmDialog title="Delete risk" body={`Delete “${risk.title}” from the register?`} action="Delete" danger onClose={() => setConfirm(false)} onYes={() => void remove()} /> : null}
    </Modal>
  );
}
