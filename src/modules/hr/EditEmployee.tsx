import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { apiGet, apiPut } from '../../core/api';
import { errorMessage } from '../../core/bridge';
import { toast } from '../../core/toasts';
import { EMPLOYMENT_TYPES, hasLeft, SETTABLE_STATUSES, type EmployeeRow, type Profile } from './api';
import { ymd } from './dates';
import { btn, btnPrimary, Field, humanise, input, Sheet } from './parts';
import { Select } from '../../components/Select';

/**
 * Edit an employee (HrProfileSheet "Edit …"): employment, personal, and
 * emergency contact and address in one form, with the reason recorded
 * against every field it changes. Only what changed is sent — the server
 * reads a blank date as "clear it", so an untouched field is never posted.
 * Department and position come from the login (the Directory module), so
 * they are not here; identity numbers only for whoever may see them.
 */
type Key =
  | 'employee_no' | 'type' | 'status' | 'job_level' | 'work_location' | 'joined_at' | 'confirmed_at' | 'probation_ends_at' | 'contract_starts_at' | 'contract_ends_at' | 'exit_at' | 'manager_id'
  | 'first_name' | 'middle_name' | 'last_name' | 'preferred_name' | 'date_of_birth' | 'gender' | 'nationality' | 'marital_status' | 'national_id' | 'passport_no' | 'personal_email' | 'mobile' | 'telephone'
  | 'emergency_name' | 'emergency_relation' | 'emergency_phone' | 'address_1' | 'address_2' | 'city' | 'province' | 'postal_code' | 'country';

const DATES: Key[] = ['joined_at', 'confirmed_at', 'probation_ends_at', 'contract_starts_at', 'contract_ends_at', 'exit_at', 'date_of_birth'];

function initial(p: Profile): Record<Key, string> {
  const e = p.employment;
  const per = p.personal ?? {};
  const s = (v: unknown) => (v === null || v === undefined ? '' : String(v));
  return {
    employee_no: s(e?.employee_no ?? p.employee.employee_no),
    type: s(e?.type ?? p.employee.type),
    status: s(e?.status ?? p.employee.status),
    job_level: s(e?.job_level),
    work_location: s(e?.work_location),
    joined_at: s(e?.joined_at),
    confirmed_at: s(e?.confirmed_at),
    probation_ends_at: s(e?.probation_ends_at),
    contract_starts_at: s(e?.contract_starts_at),
    contract_ends_at: s(e?.contract_ends_at),
    exit_at: s(e?.exit_at),
    manager_id: s(e?.manager?.id),
    first_name: s(per.first_name),
    middle_name: s(per.middle_name),
    last_name: s(per.last_name),
    preferred_name: s(per.preferred_name),
    date_of_birth: s(per.date_of_birth),
    gender: s(per.gender),
    nationality: s(per.nationality),
    marital_status: s(per.marital_status),
    national_id: s(per.national_id),
    passport_no: s(per.passport_no),
    personal_email: s(per.personal_email),
    mobile: s(per.mobile),
    telephone: s(per.telephone),
    emergency_name: s(per.emergency_name),
    emergency_relation: s(per.emergency_relation),
    emergency_phone: s(per.emergency_phone),
    address_1: s(per.address_1),
    address_2: s(per.address_2),
    city: s(per.city),
    province: s(per.province),
    postal_code: s(per.postal_code),
    country: s(per.country),
  };
}

export function EditEmployee({ profile, onClose, onDone }: { profile: Profile; onClose: () => void; onDone: () => void }) {
  const was = initial(profile);
  const [f, setF] = useState(was);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const identifiers = !!profile.can.identifiers;
  const personal = !!profile.personal;
  const people = useQuery({ queryKey: ['hr', 'employees'], queryFn: ({ signal }) => apiGet<EmployeeRow[]>('/api/hr/employees', undefined, signal) });
  const today = ymd(new Date());
  const changed = (Object.keys(f) as Key[]).filter((k) => f[k] !== was[k]);
  const set = (k: Key) => (e: { target: { value: string } }) => setF((p) => ({ ...p, [k]: e.target.value }));

  const save = async () => {
    if (!changed.length) return onClose();
    setBusy(true);
    const body: Record<string, unknown> = { reason: reason.trim() || undefined };
    for (const k of changed) body[k] = k === 'manager_id' ? (f[k] ? Number(f[k]) : null) : f[k].trim() === '' ? null : f[k].trim();
    try {
      await apiPut(`/api/hr/employees/${profile.employee.id}/profile`, body);
      toast('success', changed.length === 1 ? 'Saved.' : `Saved ${changed.length} changes.`);
      onDone();
    } catch (e) {
      toast('error', errorMessage(e));
      setBusy(false);
    }
  };

  const text = (k: Key, label: string, extra?: { placeholder?: string }) => (
    <Field key={k} label={label}>
      <input aria-label={label} type={DATES.includes(k) ? 'date' : 'text'} value={f[k]} onChange={set(k)} placeholder={extra?.placeholder} className={input} />
    </Field>
  );
  const statuses = SETTABLE_STATUSES.includes(was.status as (typeof SETTABLE_STATUSES)[number]) ? [...SETTABLE_STATUSES] : [was.status, ...SETTABLE_STATUSES];

  return (
    <Sheet
      title={`Edit ${profile.employee.name}`}
      width={720}
      onClose={onClose}
      footer={
        <>
          <span className="mr-auto self-center text-[12px] text-ink-3">{changed.length ? `${changed.length} ${changed.length === 1 ? 'change' : 'changes'}` : 'Nothing changed yet'}</span>
          <button type="button" className={btn} onClick={onClose}>
            Cancel
          </button>
          <button type="button" disabled={busy || !changed.length} className={btnPrimary} onClick={() => void save()}>
            Save
          </button>
        </>
      }
    >
      <div className="text-[11px] font-bold tracking-[.4px] text-ink-3 uppercase">Employment</div>
      <div className="grid grid-cols-3 gap-2.5">
        {text('employee_no', 'Employee number')}
        <Field label="Employment type">
          <Select aria-label="Employment type" value={f.type} onChange={set('type')} className={input}>
            {EMPLOYMENT_TYPES.map((t) => (
              <option key={t} value={t}>
                {humanise(t)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Status" hint={was.status === 'active' ? 'Active is set by completing an onboarding.' : undefined}>
          <Select aria-label="Status" value={f.status} onChange={set('status')} className={input}>
            {statuses.map((t) => (
              <option key={t} value={t}>
                {humanise(t)}
              </option>
            ))}
          </Select>
        </Field>
        {text('job_level', 'Job level')}
        {text('work_location', 'Work location')}
        <Field label="Reports to">
          <Select aria-label="Reports to" value={f.manager_id} onChange={set('manager_id')} className={input}>
            <option value="">Nobody</option>
            {(people.data ?? [])
              .filter((p) => p.id !== profile.employee.id && (!hasLeft(p, today) || String(p.id) === was.manager_id))
              .map((p) => (
                <option key={p.id} value={String(p.id)}>
                  {p.name ?? p.employee_no}
                </option>
              ))}
          </Select>
        </Field>
        {text('joined_at', 'Joined')}
        {text('confirmed_at', 'Confirmed')}
        {text('probation_ends_at', 'Probation ends')}
        {text('contract_starts_at', 'Contract starts')}
        {text('contract_ends_at', 'Contract ends')}
        {text('exit_at', 'Left')}
      </div>
      {personal ? (
        <>
          <div className="mt-1 text-[11px] font-bold tracking-[.4px] text-ink-3 uppercase">Personal</div>
          <div className="grid grid-cols-3 gap-2.5">
            {text('first_name', 'First name')}
            {text('middle_name', 'Middle name')}
            {text('last_name', 'Last name')}
            {text('preferred_name', 'Known as')}
            {text('date_of_birth', 'Date of birth')}
            {text('gender', 'Gender')}
            {text('nationality', 'Nationality')}
            {text('marital_status', 'Marital status')}
            {identifiers ? text('national_id', 'National ID', { placeholder: profile.personal?.has_national_id ? 'On file' : '' }) : null}
            {identifiers ? text('passport_no', 'Passport', { placeholder: profile.personal?.has_passport ? 'On file' : '' }) : null}
            {text('personal_email', 'Personal email')}
            {text('mobile', 'Mobile')}
            {text('telephone', 'Telephone')}
          </div>
          <div className="mt-1 text-[11px] font-bold tracking-[.4px] text-ink-3 uppercase">Emergency contact and address</div>
          <div className="grid grid-cols-3 gap-2.5">
            {text('emergency_name', 'Emergency contact')}
            {text('emergency_relation', 'Relationship')}
            {text('emergency_phone', 'Emergency phone')}
            {text('address_1', 'Address')}
            {text('address_2', 'Address line 2')}
            {text('city', 'City')}
            {text('province', 'Province / State')}
            {text('postal_code', 'Postal code')}
            {text('country', 'Country')}
          </div>
        </>
      ) : null}
      <Field label="Reason for the change" hint="Recorded against every field this saves.">
        <input aria-label="Reason for the change" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Confirmed after probation review" className={input} />
      </Field>
    </Sheet>
  );
}
