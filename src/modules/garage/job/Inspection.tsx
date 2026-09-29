import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { dateLabel, timeLabel } from '../../../core/time';
import { toast } from '../../../core/toasts';
import { Icon } from '../../../components/Icon';
import { Select } from '../../../components/Select';
import { ErrorNote, Modal, Spinner, Switch, cx } from '../../../components/ui';
import { btn, btnPrimary, btnSmall, input, Panel } from '../../hr/parts';
import { OFFLINE_WRITE, refusalOf } from '../api';
import { answerItems, completeInspection, fetchEstimate, fetchInspections, fetchReport, fetchTemplates, KB1, measured, nextStep, setCustomerSummary, startInspection, useEstimateOptions, type Inspection as InspectionData, type InspectionItem } from '../api-b1';
import { Pill } from '../parts';
import type { JobTabProps } from '../registry';
import { AddFiles, Thumb, useJobUpload } from './media-kit';

/**
 * The inspection / vehicle health check (SRS §14, §28.5, FR-INS-01..06, WF-05),
 * stage B1: start one from the company's templates; answer each item — green,
 * amber or red, pass or fail, a measurement the server colours from its
 * thresholds, a note, a photo, a recommendation — each answer saved as it is
 * given; send what needs attention to the estimate or leave it for later;
 * complete it (the server names the mandatory items still open); and the
 * customer's report as the customer will see it.
 */
const RESULT_TONE: Record<string, string> = {
  green: 'bg-[#1F7A4D] text-white',
  pass: 'bg-[#1F7A4D] text-white',
  amber: 'bg-[#B45309] text-white',
  red: 'bg-danger text-white',
  fail: 'bg-danger text-white',
};
const FALLBACK: Record<string, string> = { green: 'Good', amber: 'Attention', red: 'Urgent', pass: 'Pass', fail: 'Fail' };
const needsAttention = (r: string | null) => r === 'amber' || r === 'red' || r === 'fail';

export default function Inspection({ job, company, online, onChanged }: JobTabProps) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: KB1.inspections(job.id), queryFn: ({ signal }) => fetchInspections(job.id, signal) });
  const opts = useEstimateOptions(!!company?.can.estimates);
  const est = useQuery({ queryKey: KB1.estimate(job.id), queryFn: ({ signal }) => fetchEstimate(job.id, signal), enabled: !!company?.can.estimates });
  const mayPerform = !!company?.can.inspect;
  const mayPublish = job.can.publish_media;
  const mayEstimate = !!est.data?.estimate.can.create;
  const [picked, setPicked] = useState<number | null>(null);
  const [starting, setStarting] = useState(false);
  const list = q.data?.items ?? [];
  const current = list.find((i) => i.id === picked) ?? list.find((i) => i.status !== 'completed') ?? list[0] ?? null;
  const finished = ['draft', 'completed', 'cancelled'].includes(job.status);
  const results = { ...FALLBACK, ...(opts.data?.inspection_results ?? {}) };
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: KB1.inspections(job.id) });
    onChanged();
  };

  if (q.isLoading) return <Spinner />;
  if (q.error) return <ErrorNote error={q.error} onRetry={() => void q.refetch()} />;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        {list.length > 1 ? (
          <div role="tablist" aria-label="Inspections" className="flex flex-wrap gap-1">
            {list.map((i) => (
              <button key={i.id} type="button" role="tab" aria-selected={current?.id === i.id} onClick={() => setPicked(i.id)} className={cx('h-7 rounded-[7px] px-2.5 text-[12px] font-semibold', current?.id === i.id ? 'bg-primary text-white' : 'border border-line bg-surface text-ink-2')}>
                {i.type_label} · {i.status_label}
              </button>
            ))}
          </div>
        ) : null}
        <span className="flex-1" />
        {mayPerform && !finished ? (
          <button type="button" className={btnPrimary} disabled={!online} onClick={() => setStarting(true)}>
            <Icon name="plus" size={15} /> Start an inspection
          </button>
        ) : null}
      </div>
      {!current ? (
        <p className="m-0 text-[12.5px] text-ink-3">{job.status === 'draft' ? 'The vehicle is inspected once it is checked in.' : 'No inspection yet.'}</p>
      ) : (
        <Sheet key={current.id} i={current} results={results} recommendations={opts.data?.recommendations ?? {}} jobId={job.id} mayPerform={mayPerform} mayPublish={mayPublish} mayEstimate={mayEstimate} online={online} onChanged={refresh} />
      )}
      {starting ? <StartSheet orgId={job.org_id} jobId={job.id} onClose={() => setStarting(false)} onStarted={(id) => (setStarting(false), setPicked(id), refresh())} /> : null}
    </div>
  );
}

function StartSheet({ orgId, jobId, onClose, onStarted }: { orgId: number; jobId: number; onClose: () => void; onStarted: (id: number) => void }) {
  const t = useQuery({ queryKey: KB1.templates(orgId), queryFn: ({ signal }) => fetchTemplates(orgId, signal) });
  const [template, setTemplate] = useState('');
  const [busy, setBusy] = useState(false);
  const usable = (t.data?.items ?? []).filter((x) => x.inspection_type !== 'quality');
  const start = async () => {
    setBusy(true);
    try {
      const r = await startInspection(jobId, template ? { template_id: Number(template) } : { inspection_type: 'vhc' });
      toast('success', r.message || 'Inspection started.');
      onStarted(r.data.inspection.id);
    } catch (e) {
      toast('error', refusalOf(e).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title="Start an inspection"
      width={460}
      onClose={onClose}
      footer={
        <>
          <button type="button" className={btn} onClick={onClose}>
            Cancel
          </button>
          <button type="button" className={btnPrimary} disabled={busy} onClick={() => void start()}>
            Start
          </button>
        </>
      }
    >
      {t.isLoading ? <Spinner /> : null}
      <Select aria-label="Template" value={template} onValueChange={setTemplate} options={[{ value: '', label: 'The vehicle health check' }, ...usable.map((x) => ({ value: String(x.id), label: `${x.name} · ${x.type_label}` }))]} />
      <p className="mt-2 text-[12px] text-ink-3">The items are copied from the template. A checked-in job moves to Inspection.</p>
    </Modal>
  );
}

function Sheet({ i, results, recommendations, jobId, mayPerform, mayPublish, mayEstimate, online, onChanged }: { i: InspectionData; results: Record<string, string>; recommendations: Record<string, string>; jobId: number; mayPerform: boolean; mayPublish: boolean; mayEstimate: boolean; online: boolean; onChanged: () => void }) {
  const [missing, setMissing] = useState<number[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [summary, setSummary] = useState(i.customer_summary ?? '');
  const [report, setReport] = useState(false);
  const done = i.status === 'completed';
  const upload = useJobUpload(jobId, online, onChanged);
  const sections = [...new Set(i.items.map((x) => x.section ?? 'Items'))];

  const act = async (key: string, fn: () => Promise<{ message?: string | null }>, quiet = false) => {
    if (!online) return toast('error', OFFLINE_WRITE);
    setBusy(key);
    try {
      const r = await fn();
      if (!quiet) toast('success', r.message || 'Saved.');
      onChanged();
    } catch (e) {
      const p = refusalOf(e);
      if (p.missing.length) setMissing(p.missing.map(Number));
      toast('error', p.message);
    } finally {
      setBusy(null);
    }
  };
  const answer = (item: InspectionItem, patch: Partial<InspectionItem>) => void act(`item:${item.id}`, () => answerItems(i.id, [{ id: item.id, ...patch }]), true);

  return (
    <div className="flex flex-col gap-3">
      <section className="flex flex-wrap items-center gap-2 rounded-[12px] border border-line bg-surface px-4 py-3 text-[12.5px]" aria-label="Inspection">
        <b className="text-[14px] text-ink">{i.template?.name ?? i.type_label}</b>
        <Pill tone={done ? 'green' : 'blue'}>{i.status_label}</Pill>
        {i.summary ? (
          <span className="flex items-center gap-2 text-ink-2">
            <span className="text-success">✓ {i.summary.good}</span>
            <span className="text-warning">⚠ {i.summary.attention}</span>
            <span className="text-danger">! {i.summary.urgent}</span>
            {i.summary.unanswered ? <span className="text-ink-3">{i.summary.unanswered} to answer</span> : null}
          </span>
        ) : null}
        <span className="text-ink-3">{[i.performed_by?.name, i.completed_at ? `completed ${dateLabel(i.completed_at)} ${timeLabel(i.completed_at)}` : i.started_at ? `started ${dateLabel(i.started_at)} ${timeLabel(i.started_at)}` : null].filter(Boolean).join(' · ')}</span>
        <span className="flex-1" />
        {done ? (
          <button type="button" className={btnSmall} onClick={() => setReport(true)}>
            <Icon name="eye" size={14} /> The customer’s report
          </button>
        ) : mayPerform ? (
          <button type="button" className={btnPrimary} disabled={!online || !!busy} onClick={() => void act('complete', () => completeInspection(i.id))}>
            <Icon name="check" size={15} /> Complete the inspection
          </button>
        ) : null}
      </section>
      {missing.length ? (
        <p role="alert" className="m-0 rounded-[9px] bg-danger-bg px-3 py-2 text-[12.5px] text-danger">
          Still to answer: {i.items.filter((x) => missing.includes(x.id)).map((x) => x.label).join(', ')}.
        </p>
      ) : null}
      {sections.map((s) => (
        <Panel key={s} title={s}>
          {i.items
            .filter((x) => (x.section ?? 'Items') === s)
            .map((item) => (
              <ItemRow
                key={item.id}
                item={item}
                results={results}
                recommendations={recommendations}
                locked={done || !mayPerform || !online}
                flagged={missing.includes(item.id)}
                mayPublish={mayPublish && online}
                mayHide={mayPerform && online}
                mayEstimate={mayEstimate && online}
                mayDefer={(mayPerform || mayEstimate) && online}
                busy={busy === `item:${item.id}` || busy === `step:${item.id}`}
                onAnswer={(patch) => answer(item, patch)}
                onStep={(step) => void act(`step:${item.id}`, () => nextStep(i.id, item.id, step))}
                onPhoto={(files) => void upload.send(files, { context: 'inspection', context_id: item.id })}
              />
            ))}
        </Panel>
      ))}
      {mayPublish ? (
        <Panel title="For the customer" sub="A few words shown above their report.">
          <div className="flex flex-col gap-2 p-3.5">
            <textarea aria-label="Summary for the customer" value={summary} onChange={(e) => setSummary(e.target.value)} rows={2} className={cx(input, 'h-auto py-2')} maxLength={2000} />
            <button type="button" className={cx(btnSmall, 'self-end')} disabled={!online || summary === (i.customer_summary ?? '')} onClick={() => void act('summary', () => setCustomerSummary(i.id, summary))}>
              Save
            </button>
          </div>
        </Panel>
      ) : null}
      {report ? <ReportModal id={i.id} onClose={() => setReport(false)} /> : null}
    </div>
  );
}

function ItemRow({
  item,
  results,
  recommendations,
  locked,
  flagged,
  mayPublish,
  mayHide,
  mayEstimate,
  mayDefer,
  busy,
  onAnswer,
  onStep,
  onPhoto,
}: {
  item: InspectionItem;
  results: Record<string, string>;
  recommendations: Record<string, string>;
  locked: boolean;
  flagged: boolean;
  mayPublish: boolean;
  mayHide: boolean;
  mayEstimate: boolean;
  mayDefer: boolean;
  busy: boolean;
  onAnswer: (patch: Partial<InspectionItem>) => void;
  onStep: (step: 'estimate' | 'deferred' | 'none') => void;
  onPhoto: (files: Array<{ blob: Blob; name: string }>) => void;
}) {
  const [value, setValue] = useState(item.measurement ?? '');
  const [note, setNote] = useState(item.note ?? '');
  const choices = item.result_type === 'pass_fail' ? ['pass', 'fail'] : ['green', 'amber', 'red'];
  const colour = item.result_type === 'measurement' ? measured(value, item.thresholds) : null;
  const measuredOnly = item.result_type === 'measurement' && item.thresholds && Object.values(item.thresholds).some((x) => x !== null);
  return (
    <div className={cx('flex flex-col gap-1.5 border-b border-line/70 px-3.5 py-2.5 text-[12.5px] last:border-b-0', flagged && 'bg-danger-bg/40')} aria-busy={busy}>
      <div className="flex flex-wrap items-center gap-2">
        <b className="min-w-0 flex-1 text-ink">
          {item.label}
          {item.mandatory ? <span className="text-danger"> *</span> : null}
          {item.spec ? <span className="font-normal text-ink-3"> · {item.spec}</span> : null}
        </b>
        {item.result_type === 'measurement' ? (
          <label className="flex items-center gap-1">
            <input
              aria-label={`${item.label} measurement`}
              inputMode="decimal"
              disabled={locked}
              value={value}
              onChange={(e) => setValue(e.target.value.replace(/[^\d.-]/g, ''))}
              onBlur={() => value !== (item.measurement ?? '') && value.trim() !== '' && onAnswer({ measurement: value.trim() })}
              onKeyDown={(e) => e.key === 'Enter' && value.trim() !== '' && onAnswer({ measurement: value.trim() })}
              className={cx(input, 'h-8 w-[90px]')}
            />
            <span className="text-ink-3">{item.unit}</span>
            {colour ? <span className={cx('rounded-[6px] px-1.5 py-0.5 text-[11px] font-bold', RESULT_TONE[colour])}>{results[colour]}</span> : null}
          </label>
        ) : null}
        {!measuredOnly ? (
          <div role="radiogroup" aria-label={`${item.label} result`} className="flex gap-1">
            {choices.map((r) => (
              <button key={r} type="button" role="radio" aria-checked={item.result === r} disabled={locked} onClick={() => onAnswer({ result: r as InspectionItem['result'] })} className={cx('h-7 rounded-[7px] px-2.5 text-[12px] font-bold disabled:opacity-60', item.result === r ? RESULT_TONE[r] : 'border border-line bg-surface text-ink-2 enabled:hover:bg-subtle')}>
                {results[r] ?? r}
              </button>
            ))}
          </div>
        ) : item.result ? (
          <span className={cx('rounded-[6px] px-2 py-0.5 text-[11px] font-bold', RESULT_TONE[item.result])}>{item.result_label ?? results[item.result]}</span>
        ) : null}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <input aria-label={`${item.label} note`} placeholder="Note" disabled={locked} value={note} onChange={(e) => setNote(e.target.value)} onBlur={() => note !== (item.note ?? '') && onAnswer({ note })} className={cx(input, 'h-8 min-w-[160px] flex-1')} maxLength={1000} />
        {Object.keys(recommendations).length ? (
          <Select aria-label={`${item.label} recommendation`} disabled={!mayHide} value={item.recommendation ?? ''} onValueChange={(v) => onAnswer({ recommendation: v || null })} options={[{ value: '', label: 'No recommendation' }, ...Object.entries(recommendations).map(([value, label]) => ({ value, label }))]} />
        ) : null}
        <label className="flex items-center gap-1.5 text-[12px] text-ink-2" title={item.customer_visible ? 'On the customer’s report' : 'Internal'}>
          <Switch label={`${item.label} on the customer’s report`} checked={item.customer_visible} disabled={item.customer_visible ? !mayHide && !mayPublish : !mayPublish} onChange={(v) => onAnswer({ customer_visible: v })} /> Customer
        </label>
        {!locked ? <AddFiles small disabled={locked} accept="image/*" label="Photo" onFiles={(files) => onPhoto(files.map((f) => ({ blob: f, name: f.name })))} onPhoto={(blob, name) => onPhoto([{ blob, name }])} /> : null}
      </div>
      {item.media.length ? (
        <div className="flex flex-wrap gap-1">
          {item.media.map((m) => (
            <Thumb key={m.id} m={m} size={48} />
          ))}
        </div>
      ) : null}
      {needsAttention(item.result) ? (
        <div className="flex flex-wrap items-center gap-2 text-[12px]">
          {item.next_step === 'estimate' ? (
            <Pill tone="blue">On the estimate</Pill>
          ) : item.next_step === 'deferred' ? (
            <>
              <Pill tone="grey">Later</Pill>
              {mayDefer ? (
                <button type="button" className="font-semibold text-primary hover:underline" onClick={() => onStep('none')}>
                  Undo
                </button>
              ) : null}
            </>
          ) : (
            <>
              {mayEstimate ? (
                <button type="button" className={btnSmall} disabled={busy} onClick={() => onStep('estimate')}>
                  <Icon name="receipt" size={13} /> Add to the estimate
                </button>
              ) : null}
              {mayDefer ? (
                <button type="button" className={btnSmall} disabled={busy} onClick={() => onStep('deferred')}>
                  Later
                </button>
              ) : null}
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}

function ReportModal({ id, onClose }: { id: number; onClose: () => void }) {
  const q = useQuery({ queryKey: ['garage', 'inspection-report', id], queryFn: ({ signal }) => fetchReport(id, signal) });
  const r = q.data?.report;
  return (
    <Modal title="What the customer sees" width={680} onClose={onClose}>
      {q.isLoading ? <Spinner /> : q.error ? <ErrorNote error={q.error} /> : null}
      {r ? (
        <div className="flex flex-col gap-2 text-[12.5px]">
          <b className="text-[14px] text-ink">{r.type_label}</b>
          {r.customer_summary ? <p className="m-0 text-ink-2">{r.customer_summary}</p> : null}
          {r.items.map((x, n) => (
            <div key={n} className="flex items-start gap-2 border-b border-line/70 py-1.5 last:border-b-0">
              <span className={cx('mt-px rounded-[6px] px-1.5 py-0.5 text-[10.5px] font-bold', x.result ? RESULT_TONE[x.result] : 'bg-subtle text-ink-3')}>{x.result_label ?? '—'}</span>
              <span className="min-w-0 flex-1">
                <b className="text-ink">{x.label}</b>
                {x.measurement ? ` · ${x.measurement} ${x.unit ?? ''}` : ''}
                {x.note ? <span className="block text-ink-2">{x.note}</span> : null}
                {x.recommendation ? <span className="block text-ink-3">{x.recommendation}{x.later ? ' — later' : ''}</span> : null}
              </span>
            </div>
          ))}
          {!r.items.length ? <span className="text-ink-3">Nothing on it is shown to the customer yet.</span> : null}
        </div>
      ) : null}
    </Modal>
  );
}
