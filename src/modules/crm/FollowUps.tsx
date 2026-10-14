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
import { btn, btnPrimary, Field, input, Sheet } from '../hr/parts';
import type { FollowUp, FollowUpList, FollowUpOptions } from './api';
import { Chips, crmCan } from './parts';
import { exportCrmCsv } from './exportCsv';
import { lateLabel, subjectOf, whatFor, type RecordRef } from './logic';
import { ScheduleFollowUp, useFollowUpOptions } from './Schedule';
import { useCrmScope } from './scope';
import { Checkbox } from '../../components/Checkbox';

/**
 * Follow-ups (CrmFollowUps, desk-followups): late, due today, to come, done
 * or called off — mine, or everybody's for whoever may see them — for the
 * company the CRM is showing. A follow-up is about a lead, a deal or an
 * account, and its name opens that record. Each one can be closed with "How
 * did it go?" (which may set the next), moved, or called off with a reason;
 * Schedule sets a new one on any of the three; Export saves the list. A
 * follow-up's time is on the clock it was agreed in (`due_local`), so it is
 * shown as written.
 */
const VIEWS: Array<{ key: string; label: string; red?: boolean }> = [
  { key: 'overdue', label: 'Late', red: true },
  { key: 'today', label: 'Today' },
  { key: 'upcoming', label: 'To come' },
  { key: 'completed', label: 'Done' },
  { key: 'cancelled', label: 'Called off' },
];

const KIND_ICON: Record<string, string> = { call: 'phone', meeting: 'calendar', email: 'mail', whatsapp: 'chat', visit: 'map-pin', task: 'tasks', demo: 'monitor', quotation: 'file-text' };

export default function FollowUps({ onOpen }: { onOpen: (r: RecordRef) => void }) {
  const qc = useQueryClient();
  const [view, setView] = useState('today');
  const [all, setAll] = useState(false);
  const [closing, setClosing] = useState<FollowUp | null>(null);
  const [moving, setMoving] = useState<FollowUp | null>(null);
  const [calling, setCalling] = useState<FollowUp | null>(null);
  const [scheduling, setScheduling] = useState(false);
  const scope = useCrmScope();
  const perms = useStore(app, (s) => s.bootstrap?.permissions);
  const canEdit = crmCan(perms, 'crm.followup.edit');
  const canExport = crmCan(perms, 'crm.export');
  const filters = { view, all: all ? 1 : undefined, ...scope.params };
  const q = useQuery({ queryKey: ['crm', 'followups', view, all, scope.orgId ?? 0], queryFn: ({ signal }) => apiGet<FollowUpList>('/api/crm/followups', filters, signal), staleTime: 0 });
  const options = useFollowUpOptions();
  const refresh = () => void qc.invalidateQueries({ queryKey: ['crm'] });
  const counts: Record<string, number | undefined> = { ...(q.data?.counts ?? {}), ...(q.data?.meta?.counts ?? {}) };
  const can = q.data?.can;
  const items = q.data?.items ?? [];
  const exportList = () =>
    void exportCrmCsv('/api/crm/followups/export', filters, 'follow-ups', () => [
      ['Due', 'Time zone', 'Kind', 'About', 'Company', 'What for', 'Assigned to', 'Priority', 'Standing', 'Outcome'],
      ...items.map((f) => [f.due_local, f.timezone, f.kind_label, subjectOf(f)?.label ?? f.lead, f.company, whatFor(f), f.assignee, f.priority, f.standing, f.outcome_label]),
    ]);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="m-0 mr-3 text-[20px] font-bold text-ink">Follow-ups</h1>
        <Chips label="Follow-ups" value={view} onChange={setView} options={VIEWS.map((v) => ({ id: v.key, label: v.label, count: counts[v.key], red: v.red }))} />
        <span className="flex-1" />
        {can?.view_all ? (
          <label className="flex items-center gap-1.5 text-[13px] font-semibold text-ink">
            <Checkbox checked={all} onChange={(e) => setAll(e.target.checked)} />
            Everybody’s
          </label>
        ) : null}
        {canExport ? (
          <button type="button" className={btn} onClick={exportList}>
            <Icon name="download" size={14} /> Export
          </button>
        ) : null}
        {can?.create ?? crmCan(perms, 'crm.followup.create') ? (
          <button type="button" className={btnPrimary} onClick={() => setScheduling(true)}>
            <Icon name="calendar-plus" size={14} /> Schedule
          </button>
        ) : null}
      </div>
      {q.isLoading ? <Spinner /> : q.error ? <ErrorNote error={q.error} onRetry={() => void q.refetch()} /> : null}
      <div className="flex flex-col gap-2">
        {items.map((f) => (
          <Card key={f.id} f={f} canComplete={!!can?.complete} canEdit={canEdit} onOpen={onOpen} onClose={() => setClosing(f)} onMove={() => setMoving(f)} onCallOff={() => setCalling(f)} />
        ))}
        {q.data && !items.length ? (
          <div className="rounded-[12px] border border-dashed border-line bg-surface px-6 py-10 text-center">
            <b className="text-[14px] text-ink">{view === 'overdue' ? 'Nothing is late' : view === 'today' ? 'Nothing is due today' : 'Nothing here'}</b>
            {view === 'today' || view === 'overdue' ? <p className="m-0 mt-1 text-[12.5px] text-ink-3">Follow-ups you schedule on a lead, a deal or an account appear here.</p> : null}
          </div>
        ) : null}
      </div>
      {closing ? <HowItWent f={closing} options={options.data} onClose={() => setClosing(null)} onDone={() => (setClosing(null), refresh())} /> : null}
      {moving ? <Move f={moving} onClose={() => setMoving(null)} onDone={() => (setMoving(null), refresh())} /> : null}
      {calling ? <CallOff f={calling} onClose={() => setCalling(null)} onDone={() => (setCalling(null), refresh())} /> : null}
      {scheduling ? <ScheduleFollowUp subject={null} onClose={() => setScheduling(false)} onDone={() => (setScheduling(false), refresh())} /> : null}
    </div>
  );
}

/** "14:00", or "21 Sep, 3:00 PM" when not today — on the follow-up's own clock. */
function when(local: string): string {
  const day = local.slice(0, 10);
  const time = wallTimeLabel(local);
  return day === todayInZone() ? `Today ${time}` : `${dayLabel(day, 'short')}, ${time}`;
}

const STANDING: Record<FollowUp['standing'], string> = {
  overdue: 'bg-[#FCE9E4] text-[#8C2A14] dark:bg-danger-bg dark:text-danger',
  due: 'bg-[#FFF4E0] text-[#9A4A06] dark:bg-warning-bg dark:text-warning',
  upcoming: 'bg-selection text-primary',
  completed: 'bg-[#E4F4EA] text-[#145C39] dark:bg-success-bg dark:text-success',
  cancelled: 'bg-subtle text-ink-2',
};

const SUBJECT_WORD: Record<string, string> = { lead: 'Lead', deal: 'Deal', account: 'Account' };

function Card({ f, canComplete, canEdit, onOpen, onClose, onMove, onCallOff }: { f: FollowUp; canComplete: boolean; canEdit: boolean; onOpen: (r: RecordRef) => void; onClose: () => void; onMove: () => void; onCallOff: () => void }) {
  const late = f.standing === 'overdue';
  const open = f.status === 'scheduled';
  const about = subjectOf(f);
  const name = about?.label ?? f.lead ?? f.company ?? 'Follow-up';
  const pill = f.status === 'completed' ? 'Done' : f.status === 'cancelled' ? 'Called off' : late ? (lateLabel(f.late_minutes) ?? 'Late') : when(f.due_local);
  const line =
    f.status === 'completed'
      ? [f.outcome_label, f.result_notes].filter(Boolean).join(' — ')
      : f.status === 'cancelled'
        ? (f.cancel_reason ?? 'Called off.')
        : [whatFor(f) || f.notes, f.company && f.company !== name ? f.company : null, f.assignee, f.priority && f.priority !== 'normal' ? f.priority[0]!.toUpperCase() + f.priority.slice(1) : null].filter(Boolean).join(' · ');
  return (
    <div data-followup={f.id} className={cx('flex items-center gap-3 rounded-[10px] border bg-surface px-3.5 py-2.5', late && open ? 'border-danger/50' : 'border-line')}>
      <span aria-hidden className={cx('flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-[8px]', late && open ? 'bg-[#FCE9E4] text-[#B42318] dark:bg-danger-bg dark:text-danger' : 'bg-selection text-primary')}>
        <Icon name={KIND_ICON[f.kind] ?? 'phone'} size={16} />
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-[2px]">
        <span className="flex min-w-0 flex-wrap items-center gap-1 text-[13px]">
          <b className="text-ink">{f.kind_label}</b>
          <span className="text-ink-3">·</span>
          {about ? (
            <button type="button" className="truncate font-bold text-ink hover:text-primary hover:underline" title={`Open the ${SUBJECT_WORD[about.type]?.toLowerCase() ?? 'record'}`} onClick={() => onOpen(about)}>
              {name}
            </button>
          ) : (
            <b className="truncate text-ink">{name}</b>
          )}
          {about && about.type !== 'lead' ? <span className="rounded-full bg-subtle px-1.5 text-[10.5px] font-bold text-ink-2">{SUBJECT_WORD[about.type] ?? about.type}</span> : null}
        </span>
        <span className="truncate text-[12px] text-ink-3">{line || 'No note was left with it.'}</span>
      </span>
      <span className={cx('shrink-0 rounded-full px-2.5 py-0.5 text-[11.5px] font-bold whitespace-nowrap', STANDING[f.standing])}>{pill}</span>
      {open ? (
        <>
          {canComplete ? (
            <button type="button" className={cx(late ? btnPrimary : btn, 'h-[30px]')} onClick={onClose}>
              How did it go?
            </button>
          ) : null}
          {canEdit ? (
            <>
              <button type="button" className={cx(btn, 'h-[30px]')} onClick={onMove}>
                Move
              </button>
              <button type="button" className={cx(btn, 'h-[30px]')} onClick={onCallOff}>
                Call off
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
      <span className="-mt-1.5 text-ink-3">{[subjectOf(f)?.label ?? f.lead, f.company].filter(Boolean).join(' · ')}</span>
      <Field label="What happened">
        <Select label="What happened" value={outcome} onValueChange={setOutcome} options={Object.entries(outcomes).map(([value, label]) => ({ value, label }))} />
      </Field>
      <Field label="Notes">
        <textarea aria-label="Notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} placeholder="What was said, and anything the next person needs to know" className={cx(input, 'h-auto py-2')} />
      </Field>
      {closes ? (
        <p className="m-0 rounded-[8px] bg-well px-3 py-2 text-[12px] text-ink-3">That outcome closes it, so nothing is scheduled after it.</p>
      ) : (
        <>
          <label className="flex items-center gap-2 font-semibold text-ink">
            <Checkbox checked={next} onChange={(e) => setNext(e.target.checked)} />
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
      <p className="m-0 text-[12.5px] text-ink-2">When should {subjectOf(f)?.label ?? f.lead ?? 'this'} be followed up instead?</p>
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
      <p className="m-0 text-[12.5px] text-ink-2">Why is this follow-up not happening? Whoever reads the record later sees this.</p>
      <input autoFocus aria-label="Why?" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="They bought elsewhere" className={input} maxLength={255} />
    </Sheet>
  );
}
