import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { apiGet, apiPost } from '../../core/api';
import { app } from '../../core/app-state';
import { useStore } from '../../core/store';
import { errorMessage } from '../../core/bridge';
import { addDays, dayLabel, todayInZone, wallTimeLabel } from '../../core/time';
import { toast } from '../../core/toasts';
import { Icon } from '../../components/Icon';
import { Select } from '../../components/Select';
import { ErrorNote, Spinner, cx } from '../../components/ui';
import { btn, btnPrimary, Field, input, PageHead, Sheet } from '../hr/parts';
import type { FollowUp, FollowUpList, FollowUpOptions } from './api';
import { crmCan } from './parts';

/**
 * Follow-ups (CrmFollowUps): what is due today, late, to come, done or called
 * off — mine, or everybody's for whoever may see them. Each one can be closed
 * with "How did it go?" (which may set the next), moved, or called off with a
 * reason. A follow-up's time is on the clock it was agreed in (`due_local`),
 * so it is shown as written.
 */
const VIEWS: Array<{ key: string; label: string }> = [
  { key: 'today', label: 'Due today' },
  { key: 'overdue', label: 'Late' },
  { key: 'upcoming', label: 'To come' },
  { key: 'completed', label: 'Done' },
  { key: 'cancelled', label: 'Called off' },
];

const KIND_ICON: Record<string, string> = { call: 'phone', meeting: 'calendar', email: 'mail', whatsapp: 'chat', visit: 'map-pin', task: 'tasks' };

export default function FollowUps({ onOpenLead }: { onOpenLead: (id: number) => void }) {
  const qc = useQueryClient();
  const [view, setView] = useState('today');
  const [all, setAll] = useState(false);
  const [closing, setClosing] = useState<FollowUp | null>(null);
  const [moving, setMoving] = useState<FollowUp | null>(null);
  const [calling, setCalling] = useState<FollowUp | null>(null);
  const orgId = useStore(app, (s) => s.organizationId);
  const perms = useStore(app, (s) => s.bootstrap?.permissions);
  const canEdit = crmCan(perms, 'crm.followup.edit');
  const q = useQuery({ queryKey: ['crm', 'followups', view, all, orgId], queryFn: ({ signal }) => apiGet<FollowUpList>('/api/crm/followups', { view, all: all ? 1 : undefined, org: orgId ?? undefined }, signal), staleTime: 0 });
  const options = useQuery({ queryKey: ['crm', 'followup-options'], queryFn: ({ signal }) => apiGet<FollowUpOptions>('/api/crm/followups/options', undefined, signal), staleTime: 10 * 60_000 });
  const refresh = () => void qc.invalidateQueries({ queryKey: ['crm'] });
  const counts = q.data?.counts;
  const can = q.data?.can;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <PageHead title="Follow-ups" />
      <div className="flex flex-wrap items-center gap-1.5">
        <div role="tablist" aria-label="Follow-ups" className="flex flex-wrap gap-1.5">
          {VIEWS.map((v) => {
            const on = view === v.key;
            const n = v.key === 'overdue' ? counts?.overdue : v.key === 'today' ? counts?.today : undefined;
            return (
              <button key={v.key} type="button" role="tab" aria-selected={on} onClick={() => setView(v.key)} className={cx('h-[30px] rounded-full px-3 text-[12.5px] font-semibold', on ? 'bg-[#0F1B3D] text-white dark:bg-primary' : 'border border-line bg-surface text-ink hover:bg-subtle')}>
                {v.label}
                {n ? <span className={cx('ml-1.5 font-bold', v.key === 'overdue' ? (on ? 'text-[#FFB4A6]' : 'text-danger') : on ? 'text-white/70' : 'text-ink-3')}>{n}</span> : null}
              </button>
            );
          })}
        </div>
        <span className="flex-1" />
        {can?.view_all ? (
          <label className="flex items-center gap-1.5 text-[13px] font-semibold text-ink">
            <input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} className="accent-primary" />
            Everybody’s
          </label>
        ) : null}
      </div>
      {q.isLoading ? <Spinner /> : q.error ? <ErrorNote error={q.error} onRetry={() => void q.refetch()} /> : null}
      <div className="flex flex-col gap-2">
        {(q.data?.items ?? []).map((f) => (
          <Card key={f.id} f={f} canComplete={!!can?.complete} canEdit={canEdit} onOpenLead={onOpenLead} onClose={() => setClosing(f)} onMove={() => setMoving(f)} onCallOff={() => setCalling(f)} />
        ))}
        {q.data && !q.data.items.length ? (
          <div className="rounded-[12px] border border-dashed border-line bg-surface px-6 py-10 text-center">
            <b className="text-[14px] text-ink">{view === 'overdue' ? 'Nothing is late' : view === 'today' ? 'Nothing is due today' : 'Nothing here'}</b>
            {view === 'today' || view === 'overdue' ? <p className="m-0 mt-1 text-[12.5px] text-ink-3">Follow-ups you schedule on a lead appear here.</p> : null}
          </div>
        ) : null}
      </div>
      {closing ? <HowItWent f={closing} options={options.data} onClose={() => setClosing(null)} onDone={() => (setClosing(null), refresh())} /> : null}
      {moving ? <Move f={moving} onClose={() => setMoving(null)} onDone={() => (setMoving(null), refresh())} /> : null}
      {calling ? <CallOff f={calling} onClose={() => setCalling(null)} onDone={() => (setCalling(null), refresh())} /> : null}
    </div>
  );
}

function lateText(minutes: number | null): string | null {
  if (!minutes || minutes <= 0) return null;
  if (minutes < 60) return `${minutes} min late`;
  if (minutes < 1440) return `${Math.round(minutes / 60)} h late`;
  const d = Math.floor(minutes / 1440);
  return `${d} ${d === 1 ? 'day' : 'days'} late`;
}

/** "9:30 AM", or "21 Sep, 3:00 PM" when not today — on the follow-up's own clock. */
function when(local: string): string {
  const day = local.slice(0, 10);
  const time = wallTimeLabel(local);
  return day === todayInZone() ? time : `${dayLabel(day, 'short')}, ${time}`;
}

const STANDING: Record<FollowUp['standing'], [string, string]> = {
  overdue: ['Late', 'bg-[#FCE9E4] text-[#8C2A14] dark:bg-danger-bg dark:text-danger'],
  due: ['Due', 'bg-[#FFF4E0] text-[#9A4A06] dark:bg-warning-bg dark:text-warning'],
  upcoming: ['To come', 'bg-selection text-primary'],
  completed: ['Done', 'bg-[#E4F4EA] text-[#145C39] dark:bg-success-bg dark:text-success'],
  cancelled: ['Called off', 'bg-subtle text-ink-2'],
};

function Card({ f, canComplete, canEdit, onOpenLead, onClose, onMove, onCallOff }: { f: FollowUp; canComplete: boolean; canEdit: boolean; onOpenLead: (id: number) => void; onClose: () => void; onMove: () => void; onCallOff: () => void }) {
  const late = f.standing === 'overdue';
  const open = f.status === 'scheduled';
  const [label, tone] = STANDING[f.standing];
  const line = f.status === 'completed' ? [f.outcome_label, f.result_notes].filter(Boolean).join(' — ') : f.status === 'cancelled' ? (f.cancel_reason ?? 'Called off.') : f.subject || f.notes || 'No note was left with it.';
  return (
    <div data-followup={f.id} className="flex items-center gap-3 rounded-[12px] border border-line bg-surface px-3.5 py-3">
      <span className={cx('flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-full', late ? 'bg-[#FCE9E4] text-[#B42318] dark:bg-danger-bg dark:text-danger' : 'bg-selection text-primary')}>
        <Icon name={late ? 'clock' : (KIND_ICON[f.kind] ?? 'phone')} size={16} />
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-[3px]">
        <span className="flex flex-wrap items-center gap-1.5">
          {f.lead_id ? (
            <button type="button" className="font-bold text-ink hover:underline" onClick={() => onOpenLead(f.lead_id!)}>
              {f.lead ?? 'Lead'}
            </button>
          ) : (
            <b className="text-ink">{f.lead ?? f.subject ?? 'Follow-up'}</b>
          )}
          {f.company && f.company !== f.lead ? <span className="text-ink-3">{f.company}</span> : null}
          <span className={cx('rounded-full px-2 py-0.5 text-[11.5px] font-bold', tone)}>{label}</span>
          <span className="rounded-full bg-subtle px-2 py-0.5 text-[11.5px] font-bold text-ink-2">{f.kind_label}</span>
          {f.priority && f.priority !== 'normal' ? <span className={cx('rounded-full px-2 py-0.5 text-[11.5px] font-bold capitalize', f.priority === 'urgent' ? 'bg-[#FCE9E4] text-[#8C2A14] dark:bg-danger-bg dark:text-danger' : 'bg-[#FFF4E0] text-[#9A4A06] dark:bg-warning-bg dark:text-warning')}>{f.priority}</span> : null}
        </span>
        <span className="truncate text-[12.5px] text-ink-2">{line}</span>
        <span className="text-[12px] text-ink-3">{[when(f.due_local), open ? lateText(f.late_minutes) : null, f.assignee].filter(Boolean).join(' · ')}</span>
      </span>
      {open ? (
        <>
          {canComplete ? (
            <button type="button" className={cx(btnPrimary, 'h-[30px]')} onClick={onClose}>
              How it went
            </button>
          ) : null}
          {canEdit ? (
            <>
              <button type="button" className={cx(btn, 'h-[30px]')} onClick={onMove}>
                Move
              </button>
              <button type="button" aria-label="Call it off" title="Call it off" className={cx(btn, 'h-[30px] w-[30px] justify-center px-0')} onClick={onCallOff}>
                <Icon name="x" size={14} />
              </button>
            </>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

function HowItWent({ f, options, onClose, onDone }: { f: FollowUp; options: FollowUpOptions | undefined; onClose: () => void; onDone: () => void }) {
  const outcomes = options?.outcomes ?? { contacted: 'Spoke to them' };
  const [outcome, setOutcome] = useState(Object.keys(outcomes)[0] ?? 'contacted');
  const [notes, setNotes] = useState('');
  const [next, setNext] = useState(true);
  const [kind, setKind] = useState(f.kind);
  const [date, setDate] = useState(addDays(todayInZone(), 3));
  const [time, setTime] = useState('09:00');
  const [busy, setBusy] = useState(false);
  const closes = (options?.closing ?? ['not_interested', 'lost', 'converted']).includes(outcome);
  const save = async () => {
    setBusy(true);
    try {
      await apiPost(`/api/crm/followups/${f.id}/complete`, { outcome, result_notes: notes, next: next && !closes ? { kind, date, time, reminders: [30] } : undefined });
      toast('success', next && !closes ? 'Recorded, and the next one is set.' : 'Recorded.');
      onDone();
    } catch (e) {
      toast('error', errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet
      title="How did it go?"
      width={480}
      onClose={onClose}
      footer={
        <>
          <button type="button" className={btn} onClick={onClose}>
            Not now
          </button>
          <button type="button" className={btnPrimary} disabled={busy} onClick={() => void save()}>
            {busy ? 'Saving…' : 'Save'}
          </button>
        </>
      }
    >
      <span className="-mt-1.5 text-ink-3">{[f.lead, f.company].filter(Boolean).join(' · ')}</span>
      <Field label="What happened">
        <Select label="What happened" value={outcome} onValueChange={setOutcome} options={Object.entries(outcomes).map(([value, label]) => ({ value, label }))} />
      </Field>
      <Field label="Notes">
        <textarea aria-label="Notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} placeholder="What was said, and anything the next person needs to know" className={cx(input, 'h-auto py-2')} />
      </Field>
      {closes ? (
        <p className="m-0 rounded-[8px] bg-well px-3 py-2 text-[12px] text-ink-3">That outcome closes the lead, so nothing is scheduled after it.</p>
      ) : (
        <>
          <label className="flex items-center gap-2 font-semibold text-ink">
            <input type="checkbox" checked={next} onChange={(e) => setNext(e.target.checked)} className="accent-primary" />
            Set the next follow-up
          </label>
          {next ? (
            <>
              <div className="grid grid-cols-3 gap-2">
                <Field label="Kind">
                  <Select label="Kind" value={kind} onValueChange={setKind} options={Object.entries(options?.kinds ?? { call: 'Phone call' }).map(([value, label]) => ({ value, label }))} />
                </Field>
                <Field label="Date">
                  <input type="date" aria-label="Date" value={date} min={todayInZone()} onChange={(e) => setDate(e.target.value)} className={input} />
                </Field>
                <Field label="Time">
                  <input type="time" aria-label="Time" value={time} onChange={(e) => setTime(e.target.value)} className={input} />
                </Field>
              </div>
              <span className="text-[11.5px] text-ink-3">Reminded 30 minutes before, at the time where you are.</span>
            </>
          ) : null}
        </>
      )}
    </Sheet>
  );
}

function Move({ f, onClose, onDone }: { f: FollowUp; onClose: () => void; onDone: () => void }) {
  const [date, setDate] = useState(f.due_local.slice(0, 10) < todayInZone() ? todayInZone() : f.due_local.slice(0, 10));
  const [time, setTime] = useState(f.due_local.slice(11, 16) || '09:00');
  const [busy, setBusy] = useState(false);
  const move = async () => {
    setBusy(true);
    try {
      // Moving rebuilds the reminders from what is sent, so one is sent: without it the moved follow-up would have none.
      await apiPost(`/api/crm/followups/${f.id}/reschedule`, { date, time, reminders: [30] });
      toast('success', 'Moved.');
      onDone();
    } catch (e) {
      toast('error', errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet
      title="Move the follow-up"
      width={420}
      onClose={onClose}
      footer={
        <>
          <button type="button" className={btn} onClick={onClose}>
            Cancel
          </button>
          <button type="button" className={btnPrimary} disabled={busy || !date} onClick={() => void move()}>
            Move
          </button>
        </>
      }
    >
      <p className="m-0 text-[12.5px] text-ink-2">When should {f.lead ?? 'this'} be followed up instead?</p>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Date">
          <input type="date" aria-label="Date" value={date} min={todayInZone()} onChange={(e) => setDate(e.target.value)} className={input} />
        </Field>
        <Field label="Time">
          <input type="time" aria-label="Time" value={time} onChange={(e) => setTime(e.target.value)} className={input} />
        </Field>
      </div>
    </Sheet>
  );
}

function CallOff({ f, onClose, onDone }: { f: FollowUp; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    try {
      await apiPost(`/api/crm/followups/${f.id}/cancel`, { reason: reason.trim() });
      toast('success', 'Called off.');
      onDone();
    } catch (e) {
      toast('error', errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet
      title="Call it off"
      width={420}
      onClose={onClose}
      footer={
        <>
          <button type="button" className={btn} onClick={onClose}>
            Cancel
          </button>
          <button type="button" className={btnPrimary} disabled={busy || !reason.trim()} onClick={() => void run()}>
            OK
          </button>
        </>
      }
    >
      <p className="m-0 text-[12.5px] text-ink-2">Why is this follow-up not happening? Whoever reads the lead later sees this.</p>
      <input autoFocus aria-label="Why?" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="They bought elsewhere" className={input} maxLength={255} />
    </Sheet>
  );
}
