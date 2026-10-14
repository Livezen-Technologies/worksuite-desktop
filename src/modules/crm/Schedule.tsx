import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { apiGet, apiPost } from '../../core/api';
import { errorMessage } from '../../core/bridge';
import { addDays, todayInZone } from '../../core/time';
import { toast } from '../../core/toasts';
import { Select } from '../../components/Select';
import { btn, btnPrimary, Field, input, Sheet } from '../hr/parts';
import type { FollowUpOptions, Owner } from './api';
import { isMissing, normaliseSearch, type RecordRef } from './logic';
import { useCrmScope } from './scope';

/**
 * Schedule a follow-up (W8): on a lead, a deal or an account (gap #16) —
 * what, when (on your clock), what for, who does it, how urgent, and a
 * reminder. Opened from a record it is about that record; opened from the
 * Follow-ups view it asks which record first. A server that schedules on
 * leads only says so for a deal or an account.
 */
export type Subject = RecordRef & { type: 'lead' | 'deal' | 'account'; label?: string | null };

export const SUBJECT_PATH: Record<Subject['type'], string> = { lead: 'leads', deal: 'deals', account: 'accounts' };

export function useFollowUpOptions() {
  return useQuery({ queryKey: ['crm', 'followup-options'], queryFn: ({ signal }) => apiGet<FollowUpOptions>('/api/crm/followups/options', undefined, signal), staleTime: 10 * 60_000 });
}

export function useOwnerList() {
  return useQuery({ queryKey: ['crm', 'owners'], queryFn: ({ signal }) => apiGet<{ owners: Owner[] }>('/api/crm/owners', undefined, signal), staleTime: 5 * 60_000 });
}

const key = (s: Subject) => `${s.type}:${s.id}`;

/** `submit` sends the follow-up somewhere else (the bulk bar: `leads/bulk` with `followup`); `count` says for how many. */
export function ScheduleFollowUp({ subject: fixed, count, submit, onClose, onDone }: { subject: Subject | null; count?: number; submit?: (body: Record<string, unknown>) => Promise<unknown>; onClose: () => void; onDone: () => void }) {
  const options = useFollowUpOptions();
  const owners = useOwnerList();
  const [subject, setSubject] = useState<Subject | null>(fixed);
  const [kind, setKind] = useState('call');
  const [date, setDate] = useState(addDays(todayInZone(), 1));
  const [time, setTime] = useState('09:00');
  const [what, setWhat] = useState('');
  const [assignee, setAssignee] = useState('');
  const [priority, setPriority] = useState('normal');
  const [reminder, setReminder] = useState('30');
  const [busy, setBusy] = useState(false);
  const o = options.data;
  const body = { kind, date, time, subject: what.trim() || null, priority, reminders: reminder === '' ? [] : [Number(reminder)], ...(assignee ? { assigned_to: Number(assignee) } : {}) };
  const save = async () => {
    if (submit) {
      setBusy(true);
      try {
        await submit(body);
      } finally {
        setBusy(false);
      }
      return;
    }
    if (!subject) return;
    setBusy(true);
    try {
      await apiPost(`/api/crm/${SUBJECT_PATH[subject.type]}/${subject.id}/followups`, body);
      toast('success', 'Follow-up set.');
      onDone();
    } catch (e) {
      toast('error', subject.type !== 'lead' && isMissing(e) ? `This WorkSuite server schedules follow-ups on leads only, not on ${subject.type === 'deal' ? 'deals' : 'accounts'}.` : errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet
      title="Schedule a follow-up"
      width={500}
      onClose={onClose}
      footer={
        <>
          <button type="button" className={btn} onClick={onClose}>
            Cancel
          </button>
          <button type="button" className={btnPrimary} disabled={busy || !date || (!subject && !submit)} onClick={() => void save()}>
            {busy ? 'Saving…' : 'Schedule'}
          </button>
        </>
      }
    >
      {submit ? (
        <span className="-mt-1.5 text-ink-3">
          For {count ?? 0} {count === 1 ? 'lead' : 'leads'}, each with its own follow-up
        </span>
      ) : fixed ? (
        <span className="-mt-1.5 text-ink-3">
          {fixed.type === 'lead' ? 'Lead' : fixed.type === 'deal' ? 'Deal' : 'Account'} · {fixed.label ?? `#${fixed.id}`}
        </span>
      ) : (
        <Field label="About" hint="A lead, a deal or an account">
          <SubjectPicker value={subject} onChange={setSubject} />
        </Field>
      )}
      <div className="grid grid-cols-3 gap-2">
        <Field label="Kind">
          <Select label="Kind" value={kind} onValueChange={setKind} options={Object.entries(o?.kinds ?? { call: 'Phone call' }).map(([value, label]) => ({ value, label }))} />
        </Field>
        <Field label="Date">
          <input type="date" aria-label="Date" value={date} min={todayInZone()} onChange={(e) => setDate(e.target.value)} className={input} />
        </Field>
        <Field label="Time">
          <input type="time" aria-label="Time" value={time} onChange={(e) => setTime(e.target.value)} className={input} />
        </Field>
      </div>
      <Field label="What for">
        <input aria-label="What for" value={what} onChange={(e) => setWhat(e.target.value)} placeholder="Confirm the seat count before the revised quote" className={input} maxLength={200} />
      </Field>
      <div className="grid grid-cols-3 gap-2">
        <Field label="Assigned to">
          <Select label="Assigned to" value={assignee} onValueChange={setAssignee} options={[{ value: '', label: 'Its owner' }, ...(owners.data?.owners ?? []).map((x) => ({ value: String(x.id), label: x.name }))]} />
        </Field>
        <Field label="Priority">
          <Select label="Priority" value={priority} onValueChange={setPriority} options={Object.entries(o?.priorities ?? { low: 'Low', normal: 'Normal', high: 'High', urgent: 'Urgent' }).map(([value, label]) => ({ value, label }))} />
        </Field>
        <Field label="Remind">
          <Select label="Remind" value={reminder} onValueChange={setReminder} options={[{ value: '', label: 'No reminder' }, ...Object.entries(o?.reminders ?? { '30': '30 minutes before' }).map(([value, label]) => ({ value, label }))]} />
        </Field>
      </div>
      <span className="text-[11.5px] text-ink-3">At the time where you are.</span>
    </Sheet>
  );
}

/** Find the lead, deal or account a follow-up is about, with Search the CRM. */
export function SubjectPicker({ value, onChange }: { value: Subject | null; onChange: (s: Subject | null) => void }) {
  const scope = useCrmScope();
  const [q, setQ] = useState('');
  const needle = q.trim();
  const res = useQuery({
    queryKey: ['crm', 'search', needle, scope.orgId ?? 0],
    queryFn: ({ signal }) => apiGet<unknown>('/api/crm/search', { q: needle, ...scope.params }, signal),
    enabled: needle.length >= 2,
    staleTime: 30_000,
  });
  const hits: Subject[] = normaliseSearch(res.data)
    .flatMap((g) => g.hits)
    .filter((h): h is typeof h & { type: Subject['type'] } => h.type === 'lead' || h.type === 'deal' || h.type === 'account')
    .map((h) => ({ type: h.type, id: h.id, label: h.title }));
  const all = value && !hits.some((h) => key(h) === key(value)) ? [value, ...hits] : hits;
  const word = { lead: 'Lead', deal: 'Deal', account: 'Account' };
  return (
    <Select<string>
      label="About"
      placeholder="Type a name…"
      value={value ? key(value) : null}
      onSearch={setQ}
      onValueChange={(v) => onChange(all.find((h) => key(h) === v) ?? null)}
      options={all.map((h) => ({ value: key(h), label: `${word[h.type]} · ${h.label ?? `#${h.id}`}` }))}
    />
  );
}
