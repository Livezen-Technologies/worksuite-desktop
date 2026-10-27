import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { apiGet, apiPost, apiPut } from '../../core/api';
import { errorMessage } from '../../core/bridge';
import { toast } from '../../core/toasts';
import { Spinner } from '../../components/ui';
import type { Correction } from './api';
import { dayLong } from './dates';
import { btn, btnPrimary, Field, input, Sheet } from '../../components/PageKit';

/**
 * Correct attendance (HrTeamAttendance's dialog): set a day's check-in and
 * check-out as wall-clock times on that day, with the reason the decision
 * rests on, and see the corrections made to it before. A day with no row
 * yet (id 0) is created by the correction. The server refuses self-service
 * corrections and anybody without `hr.attendance.correct` or the reporting line.
 */
export interface CorrectableDay {
  id: number;
  employee_id: number;
  on_date: string;
  check_in: string | null;
  check_out: string | null;
  name?: string | null;
}

/** "2026-09-18 08:40:00" → "08:40" (the stamp is already on the company's clock). */
const hm = (v: string | null) => (v && v.length >= 16 ? v.slice(11, 16) : '');

export function CorrectAttendance({ day, onClose, onDone }: { day: CorrectableDay; onClose: () => void; onDone: () => void }) {
  const [inAt, setIn] = useState(hm(day.check_in));
  const [outAt, setOut] = useState(hm(day.check_out));
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const earlier = useQuery({
    queryKey: ['hr', 'corrections', day.id],
    queryFn: ({ signal }) => apiGet<Correction[]>(`/api/hr/attendance/${day.id}/corrections`, undefined, signal),
    enabled: day.id > 0,
  });
  const save = async () => {
    if (!reason.trim()) return toast('error', 'Say why — the correction is judged on it.');
    if (inAt && outAt && outAt < inAt) {
      // An overnight shift rolls the check-out to the next day on the server; say so rather than refuse.
      toast('info', 'The check-out is before the check-in, so it is taken as the next morning.');
    }
    setBusy(true);
    const body = { employee_id: day.employee_id, on_date: day.on_date, check_in: inAt || null, check_out: outAt || null, reason: reason.trim() };
    try {
      if (day.id > 0) await apiPut(`/api/hr/attendance/${day.id}`, body);
      else await apiPost('/api/hr/attendance/correct', body);
      toast('success', 'Correction saved.');
      onDone();
    } catch (e) {
      toast('error', errorMessage(e));
      setBusy(false);
    }
  };
  return (
    <Sheet
      title="Correct attendance"
      width={440}
      onClose={onClose}
      footer={
        <>
          <button type="button" className={btn} onClick={onClose}>
            Cancel
          </button>
          <button type="button" disabled={busy || !reason.trim() || (!inAt && !outAt)} className={btnPrimary} onClick={() => void save()}>
            Save correction
          </button>
        </>
      }
    >
      <span className="font-semibold text-ink-2">
        {day.name ? `${day.name} · ` : ''}
        {dayLong(day.on_date)}
      </span>
      <div className="grid grid-cols-2 gap-2.5">
        <Field label="Check in">
          <input type="time" aria-label="Check in" value={inAt} onChange={(e) => setIn(e.target.value)} className={input} />
        </Field>
        <Field label="Check out">
          <input type="time" aria-label="Check out" value={outAt} onChange={(e) => setOut(e.target.value)} className={input} />
        </Field>
      </div>
      <Field label="Reason" hint="The employee is told, with this reason.">
        <input aria-label="Reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Forgot to check out" maxLength={300} className={input} />
      </Field>
      <div className="flex flex-col gap-1 rounded-[9px] bg-ground px-3 py-2.5 text-[12.5px]">
        <b className="text-ink">Earlier corrections</b>
        {day.id > 0 && earlier.isLoading ? <Spinner /> : null}
        {earlier.data?.length ? (
          earlier.data.map((c) => (
            <div key={c.id} className="text-ink-2">
              <b className="text-ink">{c.field.replace(/_/g, '-')}</b> {c.old_value ? c.old_value.slice(11, 16) || c.old_value : '—'} → {c.new_value ? c.new_value.slice(11, 16) || c.new_value : '—'}
              {c.reason ? ` · “${c.reason}”` : ''}
              <span className="text-ink-3">
                {' '}
                · {c.changed_by ?? 'Someone'}, {dayLong(c.created_at.slice(0, 10))}
              </span>
            </div>
          ))
        ) : (
          <span className="text-ink-3">None for this day.</span>
        )}
      </div>
    </Sheet>
  );
}
