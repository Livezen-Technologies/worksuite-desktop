import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Select } from '../../../components/Select';
import { Button, ErrorNote, IconButton, Modal, Spinner, cx } from '../../../components/ui';
import { toast } from '../../../core/toasts';
import { errorText, gGet, gPost, gUpload, K, newKey, nice, shrinkPhoto, span, when, type Inspection, type InspectionItem, type InspectionsView, type Light, type Recommendation } from '../api';
import { ChooseFiles, Field, input, LightPill, Section, Thumb, useGarage } from '../parts';

const LIGHTS: Record<string, Light[]> = { traffic: ['GREEN', 'AMBER', 'RED'], number: ['GREEN', 'AMBER', 'RED'], passfail: ['PASS', 'FAIL'] };
const LIGHT_WORD: Record<Light, string> = { GREEN: 'Good', AMBER: 'Soon', RED: 'Urgent', PASS: 'Pass', FAIL: 'Fail' };
const LIGHT_ON: Record<Light, string> = {
  GREEN: 'border-success bg-success text-white',
  PASS: 'border-success bg-success text-white',
  AMBER: 'border-warning bg-warning text-white',
  RED: 'border-danger bg-danger text-white',
  FAIL: 'border-danger bg-danger text-white',
};

/**
 * The job's health checks (WF-05, FR-INS-01..06). A tap on a light is saved
 * at once; a measurement or a note when the field is left. Completing needs
 * every light answered, and each amber, red or failed item then becomes a
 * recommendation for the estimate. Someone who may publish chooses what the
 * customer sees.
 */
export default function InspectionTab({ jobId, open, onChange }: { jobId: number; open: boolean; onChange: () => void }) {
  const g = useGarage();
  const qc = useQueryClient();
  const key = K.inspections(jobId);
  const q = useQuery({ queryKey: key, queryFn: ({ signal }) => gGet<InspectionsView>(`/jobs/${jobId}/inspections`, undefined, signal) });
  const [template, setTemplate] = useState('');
  const [busy, setBusy] = useState(false);

  if (q.isLoading) return <Spinner />;
  if (q.error || !q.data) return <ErrorNote error={q.error ?? new Error('The inspections could not be loaded.')} onRetry={() => void q.refetch()} />;

  const d = q.data;
  const running = d.inspections.some((i) => i.status === 'IN_PROGRESS');
  const reload = () => {
    void qc.invalidateQueries({ queryKey: key });
    onChange();
  };
  const chosen = template || String(d.suggested ?? d.templates[0]?.id ?? '');

  const start = async () => {
    setBusy(true);
    try {
      const r = await gPost(`/jobs/${jobId}/inspections`, { template_id: Number(chosen) || undefined }, newKey('insp'));
      toast('success', r.message);
      reload();
    } catch (e) {
      toast('error', errorText(e, 'The inspection could not be started.'));
    } finally {
      setBusy(false);
    }
  };

  const starter =
    d.can.perform && open && !running ? (
      <div className="flex flex-wrap items-end gap-2">
        <Field label="Template" className="min-w-60">
          <Select aria-label="Inspection template" value={chosen} onChange={(e) => setTemplate(e.target.value)} options={d.templates.map((t) => ({ value: String(t.id), label: t.name }))} className={input} />
        </Field>
        <Button variant="primary" loading={busy} disabled={!g.online} onClick={() => void start()}>
          Start inspection
        </Button>
      </div>
    ) : null;

  return (
    <div className="flex flex-col gap-4">
      {d.inspections.length === 0 ? (
        <Section title="Inspection">
          <p className="m-0 mb-3 text-[13px] text-ink-3">No inspection yet. The health check copies its template's items, so later changes to the template never change what was inspected.</p>
          {starter}
        </Section>
      ) : (
        <>
          {starter ? <Section title="Another inspection">{starter}</Section> : null}
          {[...d.inspections].reverse().map((i) => (
            <InspectionCard
              key={i.id}
              jobId={jobId}
              insp={i}
              canPerform={d.can.perform && g.online}
              canPublish={d.can.publish}
              onSaved={(next) => qc.setQueryData<InspectionsView>(key, (old) => old && { ...old, inspections: old.inspections.map((x) => (x.id === next.id ? next : x)) })}
              onCompleted={reload}
            />
          ))}
        </>
      )}
      <Recommendations recs={d.recommendations} canChange={d.can.estimate && g.online} onChange={reload} />
    </div>
  );
}

function Counts({ c }: { c: Inspection['summary'] }) {
  if (!c) return null;
  return (
    <span className="flex flex-wrap items-center gap-1.5 text-[11px] font-semibold">
      <span className="rounded-[5px] bg-success-bg px-1.5 py-0.5 text-success">{c.green} good</span>
      <span className="rounded-[5px] bg-warning-bg px-1.5 py-0.5 text-warning">{c.amber} attention</span>
      <span className="rounded-[5px] bg-danger-bg px-1.5 py-0.5 text-danger">{c.red} urgent</span>
      {c.open > 0 ? <span className="rounded-[5px] bg-subtle px-1.5 py-0.5 text-ink-2">{c.open} to check</span> : null}
    </span>
  );
}

function InspectionCard({ jobId, insp, canPerform, canPublish, onSaved, onCompleted }: { jobId: number; insp: Inspection; canPerform: boolean; canPublish: boolean; onSaved: (i: Inspection) => void; onCompleted: () => void }) {
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const editable = canPerform && insp.status === 'IN_PROGRESS';
  const sections = Array.from(new Set(insp.items.map((i) => i.section)));

  const save = async (patch: Record<string, unknown>) => {
    try {
      const r = await gPost<{ inspection: Inspection }>(`/inspections/${insp.id}`, patch);
      if (r.data?.inspection) onSaved(r.data.inspection);
    } catch (e) {
      toast('error', errorText(e, 'Not saved.'));
    }
  };
  const item = (id: number, patch: Partial<Pick<InspectionItem, 'result' | 'value' | 'note' | 'visibility'>>) => save({ items: [{ id, ...patch }] });

  const complete = async () => {
    setBusy(true);
    try {
      const r = await gPost(`/inspections/${insp.id}/complete`, {}, newKey('insp-done'));
      toast('success', r.message);
      setConfirming(false);
      onCompleted();
    } catch (e) {
      toast('error', errorText(e));
    } finally {
      setBusy(false);
    }
  };
  const open = insp.summary?.open ?? 0;

  return (
    <Section
      title={`${insp.inspection_type === 'VHC' ? 'Vehicle health check' : `${nice(insp.inspection_type)} inspection`}${insp.inspector ? ` · ${insp.inspector}` : ''}`}
      action={
        <span className="flex flex-wrap items-center gap-2">
          <Counts c={insp.summary} />
          {insp.status === 'COMPLETED' ? (
            <span className="text-[12px] font-semibold text-success">Completed {when(insp.completed_at)}</span>
          ) : editable ? (
            <Button size="sm" variant="primary" onClick={() => (open > 0 ? toast('warning', `${open} item${open === 1 ? ' has' : 's have'} no result yet.`) : setConfirming(true))}>
              Complete
            </Button>
          ) : null}
        </span>
      }
    >
      <div className="flex flex-col gap-4">
        {sections.map((s) => (
          <fieldset key={s} disabled={!editable} className="m-0 min-w-0 border-0 p-0">
            <legend className="mb-1 text-[11px] font-bold tracking-[.4px] text-ink-3 uppercase">{s}</legend>
            <ul className="m-0 flex list-none flex-col divide-y divide-line rounded-[10px] border border-line p-0">
              {insp.items
                .filter((i) => i.section === s)
                .map((i) => (
                  <ItemRow key={i.id} jobId={jobId} item={i} editable={editable} canPublish={canPublish} onPatch={(p) => item(i.id, p)} onPhoto={onCompleted} />
                ))}
            </ul>
          </fieldset>
        ))}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Note for the customer" hint="Shown with the health check on the estimate.">
            <textarea
              key={`c${insp.id}-${insp.customer_note ?? ''}`}
              className={cx(input, 'h-auto py-2')}
              rows={2}
              aria-label="Note for the customer"
              disabled={!editable}
              defaultValue={insp.customer_note ?? ''}
              onBlur={(e) => {
                if (e.target.value !== (insp.customer_note ?? '')) void save({ customer_note: e.target.value });
              }}
            />
          </Field>
          <Field label="Internal note" hint="Staff only.">
            <textarea
              key={`i${insp.id}-${insp.internal_note ?? ''}`}
              className={cx(input, 'h-auto py-2')}
              rows={2}
              aria-label="Internal note"
              disabled={!editable}
              defaultValue={insp.internal_note ?? ''}
              onBlur={(e) => {
                if (e.target.value !== (insp.internal_note ?? '')) void save({ internal_note: e.target.value });
              }}
            />
          </Field>
        </div>
      </div>
      {confirming ? (
        <Modal
          title="Complete the inspection?"
          onClose={() => setConfirming(false)}
          footer={
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setConfirming(false)}>
                Not yet
              </Button>
              <Button variant="primary" loading={busy} onClick={() => void complete()}>
                Complete
              </Button>
            </div>
          }
        >
          <p className="m-0 text-[13px] text-ink-2">Its results then stand. Each amber and red item becomes a recommendation for the estimate.</p>
        </Modal>
      ) : null}
    </Section>
  );
}

function ItemRow({ jobId, item, editable, canPublish, onPatch, onPhoto }: { jobId: number; item: InspectionItem; editable: boolean; canPublish: boolean; onPatch: (p: Partial<Pick<InspectionItem, 'result' | 'value' | 'note' | 'visibility'>>) => Promise<void>; onPhoto: () => void }) {
  const lights = LIGHTS[item.result_type] ?? [];
  const photo = async (files: File[]) => {
    const f = files[0];
    if (!f) return;
    try {
      await gUpload(jobId, await shrinkPhoto(f), f.name, { subject: 'inspection_item', subject_id: item.id, visibility: item.visibility });
      onPhoto();
    } catch (e) {
      toast('error', errorText(e, 'The photo was not kept.'));
    }
  };
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2">
      <div className="min-w-40 flex-1">
        <p className="m-0 text-[13px] font-medium text-ink">{item.label}</p>
        {item.visibility === 'INTERNAL' ? <p className="m-0 text-[10px] font-semibold text-ink-3 uppercase">Staff only</p> : null}
      </div>
      {item.result_type === 'number' || item.result_type === 'text' ? (
        <label className="flex items-center gap-1 text-[13px]">
          <span className="sr-only">
            {item.label} {item.result_type === 'number' ? 'measurement' : 'text'}
          </span>
          <input
            key={`${item.id}-v-${item.value ?? ''}`}
            className={cx(input, item.result_type === 'number' ? 'w-20' : 'w-48')}
            inputMode={item.result_type === 'number' ? 'decimal' : undefined}
            defaultValue={item.value ?? ''}
            onBlur={(e) => {
              if (e.target.value !== (item.value ?? '')) void onPatch({ value: e.target.value });
            }}
          />
          {item.unit ? <span className="text-[12px] text-ink-3">{item.unit}</span> : null}
        </label>
      ) : null}
      {lights.length ? (
        <div className="flex gap-1" role="radiogroup" aria-label={`${item.label} result`}>
          {lights.map((l) => (
            <button
              key={l}
              type="button"
              role="radio"
              aria-checked={item.result === l}
              disabled={!editable}
              onClick={() => void onPatch({ result: item.result === l ? null : l })}
              className={cx('rounded-[7px] border px-2.5 py-1 text-[12px] font-bold', item.result === l ? LIGHT_ON[l] : 'border-line bg-surface text-ink-3 hover:bg-subtle')}
            >
              {LIGHT_WORD[l]}
            </button>
          ))}
        </div>
      ) : null}
      <input
        key={`${item.id}-n-${item.note ?? ''}`}
        className={cx(input, 'w-full sm:w-56')}
        placeholder="Note"
        aria-label={`${item.label} note`}
        defaultValue={item.note ?? ''}
        onBlur={(e) => {
          if (e.target.value !== (item.note ?? '')) void onPatch({ note: e.target.value });
        }}
      />
      <div className="flex items-center gap-1">
        {item.media.map((m) => (
          <Thumb key={m} id={m} alt={`${item.label} photo`} className="size-9" />
        ))}
        {editable ? <ChooseFiles small multiple={false} accept="image/*" label="Photo" onFiles={(fs) => void photo(fs)} /> : null}
        {editable && canPublish ? (
          <IconButton
            icon="eye"
            label={item.visibility === 'CUSTOMER' ? `${item.label}: the customer sees this — make it staff only` : `${item.label}: staff only — show it to the customer`}
            active={item.visibility === 'CUSTOMER'}
            size={16}
            onClick={() => void onPatch({ visibility: item.visibility === 'CUSTOMER' ? 'INTERNAL' : 'CUSTOMER' })}
          />
        ) : null}
      </div>
    </li>
  );
}

/** What the inspection and the diagnosis found to do: estimated, left for later, or declined (FR-INS-04). */
export function Recommendations({ recs, canChange, onChange }: { recs: Recommendation[]; canChange: boolean; onChange: () => void }) {
  if (recs.length === 0) return null;
  const set = async (id: number, status: 'DEFERRED' | 'DECLINED' | 'OPEN') => {
    try {
      const r = await gPost(`/recommendations/${id}/status`, { status });
      toast('success', r.message);
      onChange();
    } catch (e) {
      toast('error', errorText(e));
    }
  };
  return (
    <Section title={`Recommendations (${recs.length})`}>
      <ul className="m-0 flex list-none flex-col divide-y divide-line p-0">
        {recs.map((r) => (
          <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
            <div className="min-w-0">
              <p className="m-0 flex flex-wrap items-center gap-1.5 text-[13px]">
                <LightPill value={r.priority} />
                {r.description}
              </p>
              <p className="m-0 text-[11.5px] text-ink-3">
                {nice(r.source_type)}
                {r.labour_minutes ? ` · ${span(r.labour_minutes)}` : ''} · {nice(r.status)}
                {r.status === 'DEFERRED' && r.due_date ? ` · due ${r.due_date}${r.due_km ? ` or ${r.due_km.toLocaleString()} km` : ''}` : ''}
              </p>
            </div>
            {canChange ? (
              <div className="flex gap-1">
                {r.status === 'OPEN' ? (
                  <>
                    <Button size="sm" variant="ghost" onClick={() => void set(r.id, 'DEFERRED')}>
                      Later
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => void set(r.id, 'DECLINED')}>
                      Decline
                    </Button>
                  </>
                ) : r.status === 'DEFERRED' || r.status === 'DECLINED' ? (
                  <Button size="sm" variant="ghost" onClick={() => void set(r.id, 'OPEN')}>
                    Reopen
                  </Button>
                ) : null}
              </div>
            ) : null}
          </li>
        ))}
      </ul>
    </Section>
  );
}
