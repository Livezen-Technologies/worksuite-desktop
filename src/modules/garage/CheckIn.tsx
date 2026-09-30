import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { Icon } from '../../components/Icon';
import { Select } from '../../components/Select';
import { Button, ErrorNote, IconButton, Spinner, cx } from '../../components/ui';
import { toast } from '../../core/toasts';
import { bytes } from '../../core/time';
import { CameraCapture } from '../chat/attach';
import {
  codeOf, errorText, fromLocalInput, FUEL_LABEL, gDelete, gGet, gPost, gUpload, K, MAX_UPLOAD, newKey, nice, OFFLINE, shrinkPhoto, toLocalInput, when,
  type CheckinScreen, type CheckinState, type JobView,
} from './api';
import { Ask, ChooseFiles, DocActions, DropZone, Field, input, Section, SignaturePad, Thumb, ToneNote, useGarage } from './parts';

type Draft = Pick<CheckinState, 'odometer' | 'fuel_level' | 'accessories' | 'valuables' | 'complaints' | 'conditions' | 'marks'> & {
  estimated_handover_at: string;
  requested_services: string;
};

/** The diagram's zones (the web's A1…C3 grid over each view of the vehicle). */
export const ZONES = ['A1', 'A2', 'A3', 'B1', 'B2', 'B3', 'C1', 'C2', 'C3'];

function draftOf(c: CheckinState): Draft {
  return {
    odometer: c.odometer,
    fuel_level: c.fuel_level,
    accessories: c.accessories,
    valuables: c.valuables,
    complaints: c.complaints,
    conditions: c.conditions,
    marks: c.marks,
    estimated_handover_at: toLocalInput(c.estimated_handover_at),
    requested_services: c.requested_services ?? '',
  };
}

/**
 * Vehicle check-in (WF-04, FR-CHK-01..08, §12), at the counter PC or a
 * workshop tablet: readings, what the customer says, what is left in the
 * vehicle, the condition of every area, damage on the diagram, photos in
 * their slots — dropped on the window, chosen, or taken with the camera —
 * and the customer's signature last. A change after signing clears the
 * signature (the server binds it to what was shown). Complete lists exactly
 * what the server still wants; a reading lower than the last one needs a
 * reason from someone who may accept it.
 */
export default function CheckIn({ jobId, onBack }: { jobId: number; onBack: () => void }) {
  const g = useGarage();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: K.checkin(jobId), queryFn: ({ signal }) => gGet<CheckinScreen>(`/jobs/${jobId}/checkin`, undefined, signal) });
  const job = qc.getQueryData<JobView>(K.job(jobId));
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [signer, setSigner] = useState<string | null>(null);
  const [relation, setRelation] = useState<string | null>(null);
  const [sig, setSig] = useState<string | null>(null);
  const [email, setEmail] = useState(true);
  const [completing, setCompleting] = useState(false);
  const [lowerReading, setLowerReading] = useState<string | null>(null);
  const [complaint, setComplaint] = useState('');
  const [markView, setMarkView] = useState<string | null>(null);
  const [markKind, setMarkKind] = useState<string | null>(null);
  const [camera, setCamera] = useState<{ slot: string | null; subject: 'checkin' | 'damage' } | null>(null);
  const [uploading, setUploading] = useState(0);
  const completeKey = useRef(newKey('checkin'));

  if (q.isLoading) return <Spinner label="Opening the check-in…" />;
  if (q.error || !q.data) {
    return (
      <div className="flex flex-col gap-3 p-6">
        <Button icon="back" className="self-start" onClick={onBack}>
          Job
        </Button>
        <ErrorNote error={q.error ?? new Error('The check-in could not be loaded.')} onRetry={() => void q.refetch()} />
      </div>
    );
  }

  const data = q.data;
  const cfg = data.config;
  const c = data.checkin;
  const editable = data.editable && g.online;
  const d = draft ?? draftOf(c);
  const dirty = draft !== null;
  const who = signer ?? c.signer_name ?? '';
  const whoIs = relation ?? c.signer_relation ?? '';
  const view = markView ?? cfg.views[0] ?? 'front';
  const kind = markKind ?? cfg.marks[0] ?? 'SCRATCH';
  const change = (patch: Partial<Draft>) => setDraft({ ...d, ...patch });
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: K.checkin(jobId) });
    void qc.invalidateQueries({ queryKey: K.job(jobId) });
  };

  const save = async (quiet = false): Promise<boolean> => {
    if (!data.editable) return true;
    if (!g.online) {
      toast('error', OFFLINE);
      return false;
    }
    setSaving(true);
    try {
      const r = await gPost<CheckinScreen & { signature_cleared?: boolean }>(`/jobs/${jobId}/checkin`, {
        ...d,
        estimated_handover_at: d.estimated_handover_at ? fromLocalInput(d.estimated_handover_at) : '',
      });
      qc.setQueryData(K.checkin(jobId), r.data);
      setDraft(null);
      if (r.data?.signature_cleared) toast('warning', r.message);
      else if (!quiet) toast('success', r.message);
      return true;
    } catch (e) {
      toast('error', errorText(e, 'The check-in could not be saved.'));
      return false;
    } finally {
      setSaving(false);
    }
  };

  const upload = async (files: Array<{ blob: Blob; name: string }>, slot: string | null, subject: 'checkin' | 'damage') => {
    if (!g.online) return toast('error', OFFLINE);
    if (dirty && !(await save(true))) return;
    for (const f of files) {
      if (f.blob.size > MAX_UPLOAD) {
        toast('error', `${f.name} is ${bytes(f.blob.size)}; the desktop sends up to ${bytes(MAX_UPLOAD)} at a time.`);
        continue;
      }
      setUploading((n) => n + 1);
      try {
        const r = await gUpload<{ signature_cleared?: boolean }>(jobId, await shrinkPhoto(f.blob), f.name, { subject, slot: slot ?? undefined });
        if (r.data?.signature_cleared) toast('warning', 'Photo kept. The check-in changed after it was signed, so the customer signs it again.');
      } catch (e) {
        toast('error', `${f.name}: ${errorText(e, 'the photo was not kept.')}`);
      } finally {
        setUploading((n) => n - 1);
      }
    }
    refresh();
  };

  const removePhoto = async (mediaId: number) => {
    try {
      await gDelete(`/media/${mediaId}`);
      refresh();
    } catch (e) {
      toast('error', errorText(e));
    }
  };

  const sign = async () => {
    if (!sig) return;
    if (dirty && !(await save(true))) return;
    try {
      const r = await gPost<CheckinScreen>(`/jobs/${jobId}/checkin/sign`, { image: sig, signer_name: who, signer_relation: whoIs }, newKey('sign'));
      qc.setQueryData(K.checkin(jobId), r.data);
      setSig(null);
      toast('success', r.message);
    } catch (e) {
      toast('error', errorText(e, 'The signature was not kept.'));
    }
  };

  const complete = async (reason?: string) => {
    if (dirty && !(await save(true))) return;
    setCompleting(true);
    try {
      const r = await gPost(`/jobs/${jobId}/checkin/complete`, { email, odometer_reason: reason }, completeKey.current);
      toast('success', r.message);
      setLowerReading(null);
      void qc.invalidateQueries({ queryKey: K.job(jobId) });
      void qc.invalidateQueries({ queryKey: ['garage', 'board'] });
      void qc.invalidateQueries({ queryKey: ['garage', 'jobs'] });
      void qc.invalidateQueries({ queryKey: ['garage', 'overview'] });
      onBack();
    } catch (e) {
      completeKey.current = newKey('checkin');
      if (codeOf(e) === 'odometer_reason') setLowerReading(errorText(e));
      else toast('error', errorText(e, 'The check-in could not be completed.'));
      void q.refetch();
    } finally {
      setCompleting(false);
    }
  };

  const photoFor = (slot: string) => c.photos.find((p) => p.slot === slot && p.subject_type === 'checkin');
  const extras = c.photos.filter((p) => !p.slot || !cfg.slots.includes(p.slot) || p.subject_type === 'damage');
  const addComplaint = (t: string) => {
    const v = t.trim();
    if (v && !d.complaints.includes(v)) change({ complaints: [...d.complaints, v] });
    setComplaint('');
  };
  const signed = c.signature?.current ?? false;
  const number = job?.job.number ?? `Job ${jobId}`;

  return (
    <div className="flex min-h-full flex-col">
      <div className="sticky top-0 z-10 flex flex-wrap items-center gap-3 border-b border-line bg-surface/95 px-6 py-3 backdrop-blur">
        <Button icon="back" onClick={onBack}>
          Job
        </Button>
        <div className="min-w-0 flex-1">
          <h1 className="m-0 text-[16px] font-bold text-ink">Vehicle check-in</h1>
          <span className="text-[12px] text-ink-3">
            {number}
            {job?.job.vehicle ? ` · ${job.job.vehicle.number}` : ''}
          </span>
        </div>
        {uploading > 0 ? <Spinner label={`Sending ${uploading === 1 ? 'a photo' : `${uploading} photos`}…`} /> : null}
        {c.completed_at ? (
          <>
            <span className="text-[12.5px] font-semibold text-success">Completed {when(c.completed_at)}</span>
            <DocActions doc={{ kind: 'checkin-sheet', job: jobId }} name={`${number} check-in sheet.html`} label="Check-in sheet" what="check-in sheet" size="md" />
            {g.may('garage.checkin.create') ? <EmailAgain jobId={jobId} /> : null}
          </>
        ) : data.editable ? (
          <Button loading={saving} disabled={!dirty || !g.online} onClick={() => void save()}>
            {dirty ? 'Save' : 'Saved'}
          </Button>
        ) : null}
      </div>

      <fieldset disabled={!editable} className="m-0 flex min-w-0 flex-col gap-4 border-0 px-6 py-5">
        <Section title="Readings">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={`Odometer (${cfg.units})`} hint={data.last_odometer !== null ? `Last reading ${data.last_odometer.toLocaleString()}` : undefined}>
              <input
                className={cx(input, 'text-[15px]')}
                aria-label="Odometer"
                inputMode="numeric"
                value={d.odometer ?? ''}
                onChange={(e) => change({ odometer: e.target.value === '' ? null : Number(e.target.value.replace(/\D/g, '')) })}
              />
              {d.odometer !== null && data.last_odometer !== null && d.odometer < data.last_odometer ? <span className="text-[12px] font-semibold text-warning">Lower than the last reading — check it.</span> : null}
            </Field>
            <Field label="Promised for">
              <input type="datetime-local" className={input} aria-label="Promised for" value={d.estimated_handover_at} onChange={(e) => change({ estimated_handover_at: e.target.value })} />
            </Field>
          </div>
          <div className="mt-3 flex flex-col gap-1">
            <span className="text-[12.5px] font-semibold text-ink-2">Fuel</span>
            <div className="grid grid-cols-5 gap-2" role="radiogroup" aria-label="Fuel level">
              {cfg.fuel.map((f) => (
                <button
                  key={f}
                  type="button"
                  role="radio"
                  aria-checked={d.fuel_level === f}
                  onClick={() => change({ fuel_level: f })}
                  className={cx('rounded-[10px] border py-2.5 text-[14px] font-bold', d.fuel_level === f ? 'border-primary bg-primary text-white' : 'border-line bg-surface text-ink-2')}
                >
                  {FUEL_LABEL[f] ?? `${f}%`}
                </button>
              ))}
            </div>
          </div>
        </Section>

        <Section title="What the customer says">
          {cfg.complaints.length ? (
            <div className="flex flex-wrap gap-1.5">
              {cfg.complaints.map((t) => (
                <button key={t} type="button" onClick={() => addComplaint(t)} className="rounded-full border border-line px-2.5 py-1 text-[12.5px] text-ink-2 hover:border-primary hover:text-primary">
                  {t}
                </button>
              ))}
            </div>
          ) : null}
          <div className="mt-2 flex gap-2">
            <input
              className={input}
              aria-label="Complaint"
              value={complaint}
              placeholder="Or type it and press Enter"
              onChange={(e) => setComplaint(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  addComplaint(complaint);
                }
              }}
            />
            <Button onClick={() => addComplaint(complaint)}>Add</Button>
          </div>
          {d.complaints.length ? (
            <ul className="m-0 mt-2 flex list-none flex-col gap-1 p-0">
              {d.complaints.map((t) => (
                <li key={t} className="flex items-center justify-between rounded-[8px] bg-subtle px-3 py-1.5 text-[13px]">
                  {t}
                  <IconButton icon="x" label={`Remove ${t}`} size={14} onClick={() => change({ complaints: d.complaints.filter((x) => x !== t) })} />
                </li>
              ))}
            </ul>
          ) : null}
          <Field label="Requested services" className="mt-3">
            <textarea className={cx(input, 'h-auto py-2')} rows={2} aria-label="Requested services" value={d.requested_services} onChange={(e) => change({ requested_services: e.target.value })} />
          </Field>
        </Section>

        <Section title="Left with the vehicle">
          <div className="flex flex-wrap gap-1.5">
            {cfg.accessories.map((a) => {
              const on = d.accessories.includes(a);
              return (
                <button
                  key={a}
                  type="button"
                  aria-pressed={on}
                  onClick={() => change({ accessories: on ? d.accessories.filter((x) => x !== a) : [...d.accessories, a] })}
                  className={cx('rounded-full border px-2.5 py-1 text-[12.5px]', on ? 'border-primary bg-selection text-primary' : 'border-line text-ink-2')}
                >
                  {a}
                </button>
              );
            })}
          </div>
          <Field label="Valuables in the vehicle" hint="Kept sealed; never put in an email." className="mt-3">
            <textarea className={cx(input, 'h-auto py-2')} rows={2} aria-label="Valuables" value={d.valuables} onChange={(e) => change({ valuables: e.target.value })} />
          </Field>
        </Section>

        <Section
          title="Condition"
          action={
            editable ? (
              <button type="button" className="text-[12px] font-semibold text-primary" onClick={() => change({ conditions: Object.fromEntries(cfg.areas.map((a) => [a, d.conditions[a] ?? { value: 'GOOD', note: null }])) })}>
                Mark the rest good
              </button>
            ) : null
          }
        >
          <ul className="m-0 flex list-none flex-col divide-y divide-line p-0">
            {cfg.areas.map((area) => {
              const v = d.conditions[area]?.value ?? '';
              return (
                <li key={area} className="flex flex-wrap items-center justify-between gap-2 py-1.5">
                  <span className="w-36 text-[13px] font-medium text-ink-2">{nice(area)}</span>
                  <div className="flex flex-wrap gap-1" role="radiogroup" aria-label={nice(area)}>
                    {cfg.conditions.map((k) => (
                      <button
                        key={k}
                        type="button"
                        role="radio"
                        aria-checked={v === k}
                        onClick={() => change({ conditions: { ...d.conditions, [area]: { value: k, note: d.conditions[area]?.note ?? null } } })}
                        className={cx('rounded-[7px] border px-2 py-1 text-[11.5px] font-semibold', v === k ? (k === 'GOOD' ? 'border-success bg-success text-white' : 'border-warning bg-warning text-white') : 'border-line text-ink-2')}
                      >
                        {nice(k)}
                      </button>
                    ))}
                  </div>
                </li>
              );
            })}
          </ul>
        </Section>

        <Section title="Damage diagram">
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex gap-1" role="tablist" aria-label="View of the vehicle">
              {cfg.views.map((v) => (
                <button key={v} type="button" role="tab" aria-selected={view === v} onClick={() => setMarkView(v)} className={cx('rounded-[8px] px-3 py-1 text-[12.5px] font-semibold', view === v ? 'bg-navy text-white' : 'bg-subtle text-ink-2')}>
                  {nice(v)}
                </button>
              ))}
            </div>
            <Select aria-label="Kind of damage" value={kind} onChange={(e) => setMarkKind(e.target.value)} options={cfg.marks.map((m) => ({ value: m, label: nice(m) }))} className={cx(input, 'w-40')} />
          </div>
          <div className="mt-3 grid max-w-sm grid-cols-3 gap-1.5" aria-label={`${nice(view)} view: choose where the damage is`}>
            {ZONES.map((z) => {
              const here = d.marks.filter((m) => m.view === view && m.zone === z);
              return (
                <button
                  key={z}
                  type="button"
                  aria-label={`${nice(view)} ${z}${here.length ? `: ${here.map((m) => nice(m.kind)).join(', ')}` : ''}`}
                  onClick={() => change({ marks: [...d.marks, { view, zone: z, kind, note: null, media_id: null }] })}
                  className={cx('aspect-[4/3] rounded-[8px] border text-[11.5px]', here.length ? 'border-warning bg-warning-bg font-bold text-warning' : 'border-line bg-subtle text-ink-3')}
                >
                  {here.length ? here.map((m) => nice(m.kind)).join(', ') : z}
                </button>
              );
            })}
          </div>
          {d.marks.length ? (
            <ul className="m-0 mt-3 flex list-none flex-col gap-1 p-0">
              {d.marks.map((m, i) => (
                <li key={i} className="flex items-center gap-2 text-[13px]">
                  <span className="w-44 shrink-0">
                    {nice(m.view)} {m.zone} · {nice(m.kind)}
                  </span>
                  <input className={input} placeholder="Note" aria-label={`Note on ${nice(m.view)} ${m.zone}`} value={m.note ?? ''} onChange={(e) => change({ marks: d.marks.map((x, k) => (k === i ? { ...x, note: e.target.value } : x)) })} />
                  <IconButton icon="trash" label={`Remove the mark on ${nice(m.view)} ${m.zone}`} size={15} onClick={() => change({ marks: d.marks.filter((_, k) => k !== i) })} />
                </li>
              ))}
            </ul>
          ) : null}
        </Section>

        <Section title={`Photos — at least ${cfg.min_photos}`}>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {cfg.slots
              .filter((s) => s !== 'damage')
              .map((slot) => {
                const p = photoFor(slot);
                const required = cfg.required_slots.includes(slot);
                return (
                  <DropZone key={slot} enabled={editable && !p} label={`Photo: ${nice(slot)}`} onFiles={(fs) => void upload(fs.slice(0, 1).map((f) => ({ blob: f, name: f.name })), slot, 'checkin')} className={cx('rounded-[10px] border p-2', required && !p ? 'border-warning' : 'border-line')}>
                    {p ? (
                      <Thumb id={p.id} mime={p.mime} alt={nice(slot)} className="aspect-[4/3] w-full" />
                    ) : (
                      <div className="grid aspect-[4/3] place-items-center rounded-[8px] bg-subtle text-ink-3">
                        {editable ? (
                          <div className="flex flex-col items-center gap-1">
                            <ChooseFiles small multiple={false} accept="image/*" label="Choose…" onFiles={(fs) => void upload(fs.map((f) => ({ blob: f, name: f.name })), slot, 'checkin')} />
                            <Button size="sm" variant="ghost" icon="camera" onClick={() => setCamera({ slot, subject: 'checkin' })}>
                              Camera
                            </Button>
                          </div>
                        ) : (
                          <Icon name="camera" size={22} />
                        )}
                      </div>
                    )}
                    <div className="mt-1 flex items-center justify-between text-[11.5px]">
                      <span className="font-semibold text-ink-2">
                        {nice(slot)}
                        {required ? <span className="text-warning"> *</span> : null}
                      </span>
                      {p && editable ? <IconButton icon="trash" label={`Remove the ${nice(slot).toLowerCase()} photo`} size={14} onClick={() => void removePhoto(p.id)} /> : null}
                    </div>
                  </DropZone>
                );
              })}
          </div>
          <DropZone enabled={editable} label="Damage close-ups" onFiles={(fs) => void upload(fs.map((f) => ({ blob: f, name: f.name })), 'damage', 'damage')} className="mt-3 flex flex-wrap items-center gap-2 rounded-[10px] border border-dashed border-line p-2">
            {extras.map((p) => (
              <span key={p.id} className="relative">
                <Thumb id={p.id} mime={p.mime} alt="damage close-up" className="size-20" />
                {editable ? <IconButton icon="x" label="Remove this close-up" size={12} className="absolute -top-1 -right-1 size-5 bg-surface" onClick={() => void removePhoto(p.id)} /> : null}
              </span>
            ))}
            {editable ? (
              <>
                <ChooseFiles small accept="image/*,video/*" label="Damage close-up…" onFiles={(fs) => void upload(fs.map((f) => ({ blob: f, name: f.name })), 'damage', 'damage')} />
                <Button size="sm" variant="ghost" icon="camera" onClick={() => setCamera({ slot: 'damage', subject: 'damage' })}>
                  Camera
                </Button>
                <span className="text-[11.5px] text-ink-3">or drop photos here</span>
              </>
            ) : extras.length === 0 ? (
              <span className="text-[12px] text-ink-3">No close-ups.</span>
            ) : null}
          </DropZone>
        </Section>

        {cfg.signature ? (
          <Section title="Customer signature">
            {c.signature ? (
              <p className={cx('m-0 mb-2 text-[13px] font-semibold', signed ? 'text-success' : 'text-warning')}>
                Signed by {c.signature.name}
                {signed ? '.' : ' — the check-in changed since, so they sign again.'}
              </p>
            ) : null}
            {!signed && editable ? (
              <div className="flex flex-col gap-3">
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Name of the person signing *">
                    <input className={input} aria-label="Name of the person signing" value={who} onChange={(e) => setSigner(e.target.value)} />
                  </Field>
                  <Field label="They are the">
                    <Select
                      aria-label="Relation"
                      value={whoIs}
                      onChange={(e) => setRelation(e.target.value)}
                      options={[
                        { value: '', label: 'Owner' },
                        { value: 'Driver', label: 'Driver' },
                        { value: 'Family', label: 'Family member' },
                        { value: 'Employee', label: 'Employee of the owner' },
                      ]}
                      className={input}
                    />
                  </Field>
                </div>
                <p className="m-0 text-[12px] text-ink-3">I confirm the vehicle was handed over in the condition recorded above.</p>
                <SignaturePad onChange={setSig} />
                <div className="flex justify-end">
                  <Button variant="primary" disabled={!sig || !who.trim()} onClick={() => void sign()}>
                    Keep signature
                  </Button>
                </div>
              </div>
            ) : null}
          </Section>
        ) : null}
      </fieldset>

      {data.editable ? (
        <div className="sticky bottom-0 z-10 mt-auto border-t border-line bg-surface/95 px-6 py-3 backdrop-blur">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0 flex-1 text-[13px]">
              {data.missing.length === 0 ? (
                <span className="font-semibold text-success">Everything the check-in needs is here.</span>
              ) : (
                <span className="text-warning" aria-label="Still needed">
                  Still needed: {data.missing.map((m) => m.text).join(' ')}
                </span>
              )}
            </div>
            <label className="flex items-center gap-1.5 text-[12.5px] text-ink-2">
              <input type="checkbox" checked={email} onChange={(e) => setEmail(e.target.checked)} /> Email the customer a copy
            </label>
            <Button variant="primary" loading={completing} disabled={(data.missing.length > 0 && !dirty) || !g.online} onClick={() => void complete()}>
              Complete check-in
            </Button>
          </div>
        </div>
      ) : null}

      {!data.editable && !c.completed_at ? (
        <div className="px-6 pb-5">
          <ToneNote>You can read this check-in; recording it needs permission to check vehicles in.</ToneNote>
        </div>
      ) : null}

      {camera ? (
        <CameraCapture
          onTaken={(blob, name) => {
            const to = camera;
            setCamera(null);
            void upload([{ blob, name }], to.slot, to.subject);
          }}
          onClose={() => setCamera(null)}
        />
      ) : null}
      {lowerReading !== null ? (
        <Ask
          title="The odometer is lower than last time"
          text={lowerReading}
          fields={[{ name: 'reason', label: 'Why', required: true, placeholder: 'Instrument cluster replaced' }]}
          confirm="Accept the reading"
          busy={completing}
          onClose={() => setLowerReading(null)}
          onSubmit={(v) => void complete(v.reason)}
        />
      ) : null}
    </div>
  );
}

/** Send the customer the check-in sheet again (FR-CHK-07); valuables and the signature image are left out of the email. */
function EmailAgain({ jobId }: { jobId: number }) {
  const g = useGarage();
  const [busy, setBusy] = useState(false);
  const send = async () => {
    setBusy(true);
    try {
      const r = await gPost(`/jobs/${jobId}/checkin/email`, {});
      toast('success', r.message);
    } catch (e) {
      toast('error', errorText(e, 'The sheet was not sent.'));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Button variant="ghost" icon="mail" loading={busy} disabled={!g.online} onClick={() => void send()}>
      Email it again
    </Button>
  );
}
