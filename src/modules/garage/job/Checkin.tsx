import { useState, type ReactNode } from 'react';
import { dateLabel, timeLabel } from '../../../core/time';
import { toast } from '../../../core/toasts';
import { Icon } from '../../../components/Icon';
import { Select } from '../../../components/Select';
import { cx } from '../../../components/ui';
import { btn, btnPrimary, btnSmall, Field, input, Panel } from '../../hr/parts';
import { distance, fuelMark, isoToLocal, localToIso, OFFLINE_WRITE, refusalOf, saveCheckin, type Checkin as CheckinData, type DamageMark, type Job360, type Options } from '../api';
import { when } from '../parts';
import type { JobTabProps } from '../registry';
import { DamageMap } from './DamageMap';
import { AddFiles, DropZone, Thumb, useJobUpload } from './media-kit';
import { SignaturePad } from './SignaturePad';

/**
 * The vehicle check-in (SRS §12, §28.4, WF-04, FR-CHK-01..08).
 *
 * Filled in over as many saves as it takes while the job is a draft. "Check the
 * vehicle in" asks the server to complete it; the server refuses with what is
 * still missing — the company's required fields and its minimum number of
 * photos — and that list is shown as it was sent, beside the button
 * (`checkin.missing`) and again as the refusal. Photos go up as they are
 * dropped, chosen or taken, each into its slot. After the check-in completes
 * it is the record of how the vehicle arrived, shown read-only.
 */
export const BELONGINGS = ['Jack', 'Spare wheel', 'Floor mats', 'Tool kit', 'SD card', 'Owner’s manual', 'Charging cable', 'Child seat'];

export interface CheckinDraft {
  odometer: string;
  overrideReason: string;
  fuel: number | null;
  complaints: Array<{ text: string; quick_pick: string | null }>;
  services: string[];
  conditions: Record<string, { value: string; note: string }>;
  marks: DamageMark[];
  accessories: string[];
  valuables: string;
  promised: string;
  signature: string | null;
  signer: string;
  relation: string;
}

export function draftFrom(job: Pick<Job360, 'checkin' | 'customer'>): CheckinDraft {
  const c = job.checkin;
  return {
    odometer: c.odometer === null ? '' : String(c.odometer),
    overrideReason: '',
    fuel: c.fuel_level,
    complaints: c.complaints.map(({ text, quick_pick }) => ({ text, quick_pick })),
    services: [...c.requested_services],
    conditions: Object.fromEntries(c.conditions.map((x) => [x.area, { value: x.value, note: x.note ?? '' }])),
    marks: c.damage.map(({ view, zone, mark, x, y, note, media_id }) => ({ view, zone, mark, x, y, note, media_id })),
    accessories: [...c.accessories],
    valuables: c.valuables ?? '',
    promised: isoToLocal(c.estimated_handover_at),
    signature: null,
    signer: c.signer?.name ?? job.customer?.name ?? '',
    relation: c.signer?.relation ?? '',
  };
}

/** Whether the typed odometer is below the vehicle's last reading (the server decides; this only says so early). */
export function odometerLower(d: Pick<CheckinDraft, 'odometer'>, last: number | null): boolean {
  const n = d.odometer.trim() === '' ? null : Number(d.odometer);
  return n !== null && last !== null && Number.isFinite(n) && n < last;
}

/** `POST jobs/{id}/checkin`: what was recorded so far; lists replace what the server has. */
export function checkinBody(d: CheckinDraft, complete: boolean, last: number | null): Record<string, unknown> {
  const body: Record<string, unknown> = {
    complaints: d.complaints.map((x) => (x.quick_pick ? { quick_pick: x.quick_pick, text: x.text } : x.text)),
    requested_services: d.services,
    conditions: Object.entries(d.conditions)
      .filter(([, v]) => v.value !== '')
      .map(([area, v]) => ({ area, value: v.value, note: v.note.trim() || null })),
    damage: d.marks,
    accessories: d.accessories,
    valuables: d.valuables.trim() || null,
    estimated_handover_at: d.promised ? localToIso(d.promised) : null,
    complete,
  };
  if (d.odometer.trim() !== '') body.odometer = Number(d.odometer);
  if (odometerLower(d, last) && d.overrideReason.trim()) body.odometer_override_reason = d.overrideReason.trim();
  if (d.fuel !== null) body.fuel_level = d.fuel;
  if (d.signature) body.signature = { signer_name: d.signer.trim(), relation: d.relation.trim() || null, image: d.signature, device: 'WorkSuite Desktop' };
  return body;
}

export default function Checkin({ job, company, options, online, onChanged }: JobTabProps) {
  const c = job.checkin;
  const editable = job.can.checkin && job.status === 'draft';
  if (!editable) return <CheckinRecord c={c} job={job} options={options} unit={company?.distance_unit ?? 'km'} note={job.status === 'draft' ? 'Checking the vehicle in is for those who may record check-ins.' : null} />;
  return <CheckinForm key={job.id} job={job} options={options} unit={company?.distance_unit ?? 'km'} mayOverride={!!company?.can.override_odometer} online={online} onChanged={onChanged} />;
}

function CheckinForm({ job, options, unit, mayOverride, online, onChanged }: { job: Job360; options: Options; unit: string; mayOverride: boolean; online: boolean; onChanged: JobTabProps['onChanged'] }) {
  const c = job.checkin;
  const [d, setD] = useState<CheckinDraft>(() => draftFrom(job));
  const [typed, setTyped] = useState('');
  const [service, setService] = useState('');
  const [other, setOther] = useState('');
  const [busy, setBusy] = useState<'save' | 'complete' | null>(null);
  const [refused, setRefused] = useState<{ message: string; missing: string[]; field: string | null } | null>(null);
  const upload = useJobUpload(job.id, online, () => onChanged());
  const last = job.vehicle?.odometer ?? null;
  const lower = odometerLower(d, last);
  const set = (patch: Partial<CheckinDraft>) => setD((x) => ({ ...x, ...patch }));
  const toggle = (list: string[], item: string) => (list.includes(item) ? list.filter((x) => x !== item) : [...list, item]);

  const save = async (complete: boolean) => {
    if (!online) return toast('error', OFFLINE_WRITE);
    if (d.signature && !d.signer.trim()) return setRefused({ message: 'A signature needs the signer’s name.', missing: [], field: 'signature' });
    setBusy(complete ? 'complete' : 'save');
    setRefused(null);
    try {
      const r = await saveCheckin(job.id, checkinBody(d, complete, last));
      // A signature is kept once per save; it is not sent again.
      set({ signature: null });
      toast('success', r.message || (complete ? 'Vehicle checked in.' : 'Check-in saved.'));
      onChanged(r.data.job);
    } catch (e) {
      const p = refusalOf(e);
      setRefused({ message: p.message, missing: p.missing, field: p.field });
    } finally {
      setBusy(null);
    }
  };
  const bad = (field: string) => refused?.field === field;
  const slots = Object.entries(options.checkin.photo_slots);
  const photos = c.photos;

  return (
    <div className="flex flex-col gap-3">
      <div className="grid gap-3 xl:grid-cols-2">
        <Panel title="Readings">
          <div className="grid gap-2.5 p-3.5 sm:grid-cols-2">
            <Field label={`Odometer (${unit})`} hint={last !== null ? `Last reading ${distance(last, unit)}` : 'No reading on file yet'}>
              <input aria-label="Odometer" inputMode="numeric" value={d.odometer} onChange={(e) => set({ odometer: e.target.value.replace(/[^\d]/g, '') })} aria-invalid={bad('odometer')} className={cx(input, bad('odometer') && 'border-danger')} />
            </Field>
            {lower ? (
              mayOverride ? (
                <Field label="Why is it lower?" hint="Recorded and audited.">
                  <input aria-label="Why the odometer is lower" value={d.overrideReason} onChange={(e) => set({ overrideReason: e.target.value })} className={input} maxLength={255} />
                </Field>
              ) : (
                <p className="m-0 self-end text-[12px] text-warning">Lower than the last reading: only somebody allowed to accept a lower reading can record it.</p>
              )
            ) : null}
            <div className="flex flex-col gap-1 sm:col-span-2">
              <span className="text-[12.5px] font-semibold text-ink">Fuel level</span>
              <div role="radiogroup" aria-label="Fuel level" className="flex gap-1">
                {Object.entries(options.checkin.fuel_marks).map(([label, v]) => (
                  <button key={label} type="button" role="radio" aria-checked={d.fuel === v} onClick={() => set({ fuel: v })} className={cx('h-8 min-w-[48px] rounded-[7px] px-2 text-[12.5px] font-bold', d.fuel === v ? 'bg-primary text-white' : 'border border-line bg-surface text-ink-2 hover:bg-subtle')}>
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <Field label="Promised for" hint="Your clock. Becomes the job’s promised time if it has none.">
              <input aria-label="Promised handover" type="datetime-local" value={d.promised} onChange={(e) => set({ promised: e.target.value })} className={input} />
            </Field>
          </div>
        </Panel>

        <Panel title="What the customer says" sub="Each complaint becomes a diagnostic item.">
          <div className="flex flex-col gap-2.5 p-3.5">
            <div className="flex flex-wrap gap-1">
              {Object.entries(options.checkin.complaints).map(([k, label]) => {
                const on = d.complaints.some((x) => x.quick_pick === k);
                return (
                  <button key={k} type="button" aria-pressed={on} onClick={() => set({ complaints: on ? d.complaints.filter((x) => x.quick_pick !== k) : [...d.complaints, { text: label, quick_pick: k }] })} className={cx('h-7 rounded-[14px] px-2.5 text-[12px] font-semibold', on ? 'bg-primary text-white' : 'border border-line bg-surface text-ink-2 hover:bg-subtle')}>
                    {label}
                  </button>
                );
              })}
            </div>
            <div className="flex gap-2">
              <input
                aria-label="Complaint in the customer's words"
                placeholder="In the customer’s words"
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && typed.trim()) {
                    set({ complaints: [...d.complaints, { text: typed.trim(), quick_pick: null }] });
                    setTyped('');
                  }
                }}
                className={input}
                maxLength={500}
              />
              <button type="button" className={btnSmall} disabled={!typed.trim()} onClick={() => (set({ complaints: [...d.complaints, { text: typed.trim(), quick_pick: null }] }), setTyped(''))}>
                Add
              </button>
            </div>
            <Chips items={d.complaints.filter((x) => !x.quick_pick).map((x) => x.text)} onRemove={(t) => set({ complaints: d.complaints.filter((x) => x.quick_pick || x.text !== t) })} empty={d.complaints.length ? null : 'No complaint recorded yet.'} />
            <span className="text-[12.5px] font-semibold text-ink">Requested services</span>
            <div className="flex gap-2">
              <input aria-label="Requested service" placeholder="e.g. Full service" value={service} onChange={(e) => setService(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && service.trim() && (set({ services: [...d.services, service.trim()] }), setService(''))} className={input} maxLength={190} />
              <button type="button" className={btnSmall} disabled={!service.trim()} onClick={() => (set({ services: [...d.services, service.trim()] }), setService(''))}>
                Add
              </button>
            </div>
            <Chips items={d.services} onRemove={(t) => set({ services: d.services.filter((x) => x !== t) })} empty={null} />
          </div>
        </Panel>
      </div>

      <Panel title="Condition" sub="Every area as the vehicle arrived.">
        <div className="grid gap-x-4 gap-y-2 p-3.5 md:grid-cols-2 xl:grid-cols-3">
          {Object.entries(options.checkin.areas).map(([area, label]) => {
            const v = d.conditions[area] ?? { value: '', note: '' };
            return (
              <div key={area} className="flex items-center gap-2">
                <span className="w-[110px] shrink-0 text-[12.5px] text-ink-2">{label}</span>
                <Select aria-label={`${label} condition`} value={v.value} onValueChange={(value) => set({ conditions: { ...d.conditions, [area]: { ...v, value } } })} options={[{ value: '', label: 'Not checked' }, ...Object.entries(options.checkin.conditions).map(([value, l]) => ({ value, label: l }))]} className="min-w-0 flex-1" />
                {v.value && v.value !== 'good' ? <input aria-label={`${label} note`} placeholder="Note" value={v.note} onChange={(e) => set({ conditions: { ...d.conditions, [area]: { ...v, note: e.target.value } } })} className={cx(input, 'w-[120px]')} maxLength={255} /> : null}
              </div>
            );
          })}
        </div>
      </Panel>

      <div className="grid gap-3 xl:grid-cols-2">
        <Panel title="Damage">
          <div className="p-3.5">
            <DamageMap options={options} marks={d.marks} onChange={(marks) => set({ marks })} photos={photos.filter((p) => p.kind === 'photo')} />
          </div>
        </Panel>
        <Panel title="Photos" sub={upload.busy ? `Sending ${upload.busy}…` : 'Drop photos on a slot, choose them, or use the camera.'}>
          <div className="grid grid-cols-2 gap-2 p-3.5 sm:grid-cols-4">
            {slots.map(([slot, label]) => {
              const inSlot = photos.filter((p) => p.slot === slot);
              return (
                <DropZone key={slot} label={`${label} photo`} enabled={online} onFiles={(files) => void upload.send(files.map((f) => ({ blob: f, name: f.name })), { context: 'checkin', slot })} className="flex flex-col gap-1.5 rounded-[10px] border border-dashed border-line bg-ground p-2">
                  <span className="flex items-center gap-1 text-[11.5px] font-bold text-ink-2">
                    {inSlot.length ? <Icon name="check-circle" size={13} className="text-success" /> : <Icon name="camera" size={13} className="text-ink-3" />} {label}
                  </span>
                  <div className="flex flex-wrap gap-1">
                    {inSlot.map((p) => (
                      <Thumb key={p.id} m={p} size={56} />
                    ))}
                  </div>
                  <span className="flex flex-wrap gap-1">
                    <AddFiles small disabled={!online || !!upload.busy} accept="image/*,video/*" label="Choose" onFiles={(files) => void upload.send(files.map((f) => ({ blob: f, name: f.name })), { context: 'checkin', slot })} onPhoto={(blob, name) => void upload.send([{ blob, name }], { context: 'checkin', slot })} />
                  </span>
                </DropZone>
              );
            })}
          </div>
          {photos.some((p) => !p.slot) ? (
            <div className="flex flex-wrap gap-1.5 px-3.5 pb-3.5">
              {photos
                .filter((p) => !p.slot)
                .map((p) => (
                  <Thumb key={p.id} m={p} size={56} />
                ))}
            </div>
          ) : null}
        </Panel>
      </div>

      <div className="grid gap-3 xl:grid-cols-2">
        <Panel title="Belongings" sub="Listed again on the delivery checklist.">
          <div className="flex flex-col gap-2.5 p-3.5">
            <div className="flex flex-wrap gap-1">
              {[...new Set([...BELONGINGS, ...d.accessories])].map((a) => {
                const on = d.accessories.includes(a);
                return (
                  <button key={a} type="button" aria-pressed={on} onClick={() => set({ accessories: toggle(d.accessories, a) })} className={cx('h-7 rounded-[14px] px-2.5 text-[12px] font-semibold', on ? 'bg-primary text-white' : 'border border-line bg-surface text-ink-2 hover:bg-subtle')}>
                    {a}
                  </button>
                );
              })}
            </div>
            <div className="flex gap-2">
              <input aria-label="Something else left in the vehicle" placeholder="Something else" value={other} onChange={(e) => setOther(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && other.trim() && (set({ accessories: [...d.accessories, other.trim()] }), setOther(''))} className={input} maxLength={120} />
              <button type="button" className={btnSmall} disabled={!other.trim()} onClick={() => (set({ accessories: [...d.accessories, other.trim()] }), setOther(''))}>
                Add
              </button>
            </div>
            <Field label="Valuables declared" hint="Kept encrypted, and never shown to the customer’s view.">
              <textarea aria-label="Valuables declared" value={d.valuables} onChange={(e) => set({ valuables: e.target.value })} rows={2} className={cx(input, 'h-auto py-2')} maxLength={1000} />
            </Field>
          </div>
        </Panel>
        <Panel title="Customer’s signature" sub={c.signer?.signed ? `Signed by ${c.signer.name}. Signing again replaces it.` : 'On the condition as recorded.'}>
          <div className="flex flex-col gap-2.5 p-3.5">
            <div className="grid grid-cols-2 gap-2">
              <Field label="Signed by">
                <input aria-label="Signed by" value={d.signer} onChange={(e) => set({ signer: e.target.value })} className={cx(input, bad('signature') && 'border-danger')} maxLength={150} />
              </Field>
              <Field label="Relation">
                <input aria-label="Relation" placeholder="Owner, driver…" value={d.relation} onChange={(e) => set({ relation: e.target.value })} className={input} maxLength={60} />
              </Field>
            </div>
            <SignaturePad onChange={(png) => set({ signature: png })} />
          </div>
        </Panel>
      </div>

      <section aria-label="Check the vehicle in" className="sticky bottom-0 flex flex-col gap-2 rounded-[12px] border border-line bg-surface px-4 py-3 shadow-[0_-6px_18px_rgb(var(--ws-shadow-rgb)/.08)]">
        {refused ? (
          <div role="alert" className="flex flex-col gap-1 rounded-[9px] bg-danger-bg px-3 py-2 text-[12.5px] text-danger">
            <b>{refused.message}</b>
            {refused.missing.length ? (
              <ul className="m-0 list-disc pl-5">
                {refused.missing.map((m) => (
                  <li key={m}>{m}</li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : c.missing.length ? (
          <p className="m-0 text-[12.5px] text-ink-2">
            <b>Still to record:</b> {c.missing.join('; ')}.
          </p>
        ) : (
          <p className="m-0 text-[12.5px] text-success">Everything the company asks for is recorded.</p>
        )}
        <div className="flex items-center justify-end gap-2">
          {!online ? <span className="mr-auto text-[12px] text-warning">{OFFLINE_WRITE}</span> : null}
          <button type="button" className={btn} disabled={!online || !!busy} onClick={() => void save(false)}>
            Save
          </button>
          <button type="button" className={btnPrimary} disabled={!online || !!busy} onClick={() => void save(true)}>
            <Icon name="check" size={15} /> Check the vehicle in
          </button>
        </div>
      </section>
    </div>
  );
}

function Chips({ items, onRemove, empty }: { items: string[]; onRemove: (t: string) => void; empty: string | null }) {
  if (!items.length) return empty ? <span className="text-[12px] text-ink-3">{empty}</span> : null;
  return (
    <div className="flex flex-wrap gap-1">
      {items.map((t, i) => (
        <span key={`${t}-${i}`} className="inline-flex h-7 items-center gap-1 rounded-[14px] bg-subtle pr-1 pl-2.5 text-[12px] font-semibold text-ink">
          {t}
          <button type="button" aria-label={`Remove ${t}`} onClick={() => onRemove(t)} className="flex h-5 w-5 items-center justify-center rounded-full text-ink-3 hover:bg-line hover:text-ink">
            <Icon name="x" size={12} />
          </button>
        </span>
      ))}
    </div>
  );
}

/** The check-in as it was recorded: how the vehicle arrived. */
function CheckinRecord({ c, job, options, unit, note }: { c: CheckinData; job: Job360; options: Options; unit: string; note: string | null }) {
  const row = (k: string, v: ReactNode) => (
    <div key={k} className="flex gap-2.5 py-1 text-[12.5px]">
      <span className="w-[150px] shrink-0 text-ink-3">{k}</span>
      <span className="min-w-0 font-semibold text-ink">{v || '—'}</span>
    </div>
  );
  const fuel = fuelMark(c.fuel_level, options.checkin.fuel_marks);
  return (
    <div className="flex flex-col gap-3">
      {note ? <p className="m-0 rounded-[9px] bg-subtle px-3 py-2 text-[12.5px] text-ink-2">{note}</p> : null}
      {c.status === 'completed' ? (
        <p className="m-0 flex items-center gap-1.5 text-[12.5px] text-success">
          <Icon name="check-circle" size={15} /> Checked in {c.completed_at ? `${dateLabel(c.completed_at)} ${timeLabel(c.completed_at)}` : ''}. This is the record of how the vehicle arrived and is not changed.
        </p>
      ) : null}
      <div className="grid gap-3 xl:grid-cols-2">
        <Panel title="Readings and request">
          <div className="px-3.5 py-2.5">
            {row('Odometer', c.odometer !== null ? distance(c.odometer, unit) : null)}
            {row('Fuel level', fuel ? `${fuel} (${c.fuel_level}%)` : null)}
            {row('Complaints', c.complaints.map((x) => x.text).join('; '))}
            {row('Requested services', c.requested_services.join('; '))}
            {row('Promised handover', when(c.estimated_handover_at))}
            {row('Accessories', c.accessories.join(', '))}
            {row('Valuables declared', c.valuables)}
            {row('Signed by', c.signer ? `${c.signer.name}${c.signer.relation ? ` (${c.signer.relation})` : ''}${c.signer.signed ? '' : ' — not signed'}` : null)}
          </div>
        </Panel>
        <Panel title="Condition">
          <div className="px-3.5 py-2.5">
            {c.conditions.length ? c.conditions.map((x) => row(options.checkin.areas[x.area] ?? x.area, `${options.checkin.conditions[x.value] ?? x.value}${x.note ? ` — ${x.note}` : ''}`)) : <span className="text-[12.5px] text-ink-3">No condition recorded.</span>}
          </div>
        </Panel>
        <Panel title="Damage">
          <div className="p-3.5">
            <DamageMap options={options} marks={c.damage} onChange={() => undefined} photos={[]} disabled />
          </div>
        </Panel>
        <Panel title="Photos" sub={`${c.photos.length} ${c.photos.length === 1 ? 'photo' : 'photos'}`}>
          <div className="flex flex-wrap gap-2 p-3.5">
            {c.photos.map((p) => (
              <span key={p.id} className="flex flex-col items-center gap-0.5 text-[11px] text-ink-3">
                <Thumb m={p} size={84} />
                {p.slot ? (options.checkin.photo_slots[p.slot] ?? p.slot) : null}
              </span>
            ))}
            {!c.photos.length ? <span className="text-[12.5px] text-ink-3">No photos.</span> : null}
          </div>
        </Panel>
      </div>
      {job.status === 'draft' && c.missing.length ? (
        <p className="m-0 text-[12.5px] text-ink-2">
          <b>Still to record:</b> {c.missing.join('; ')}.
        </p>
      ) : null}
    </div>
  );
}
