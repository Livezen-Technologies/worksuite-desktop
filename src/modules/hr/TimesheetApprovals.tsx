import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { apiGet, apiPost } from '../../core/api';
import { errorMessage } from '../../core/bridge';
import { toast } from '../../core/toasts';
import { ErrorNote, Spinner } from '../../components/ui';
import type { LogsResponse, Sheet as TimeSheet } from './api';
import { dayShort, minutesLabel, rangeLabel } from './dates';
import { btn, btnPrimary, Cell, Empty, Field, input, Kpi, PageHead, Panel, row, Sheet, StatusChip, THead } from './parts';

/**
 * Timesheet approvals (HrAdminSheet; the web's TimesheetApprovals): weeks
 * people submitted, for whoever reviews them — `hr.timesheet.approve`, or a
 * line manager, which only the server knows (`/hr/access` → timesheets.review).
 * Approve, or send back with what needs changing; View shows what was logged.
 */
const SHEET_LABEL: Record<string, string> = { draft: 'Draft', submitted: 'Awaiting review', approved: 'Approved', rejected: 'Sent back' };

export default function TimesheetApprovals() {
  const qc = useQueryClient();
  const [status, setStatus] = useState('submitted');
  const [viewing, setViewing] = useState<TimeSheet | null>(null);
  const [sending, setSending] = useState<TimeSheet | null>(null);
  const q = useQuery({ queryKey: ['hr', 'timesheets', 'all', status], queryFn: ({ signal }) => apiGet<TimeSheet[]>('/api/hr/timesheets', { scope: 'all', status: status || undefined }, signal) });
  const decide = async (s: TimeSheet, outcome: 'approve' | 'reject', note = '') => {
    try {
      await apiPost(`/api/hr/timesheets/${s.id}/${outcome}`, { note });
      toast('success', outcome === 'approve' ? 'Approved.' : 'Sent back.');
      void qc.invalidateQueries({ queryKey: ['hr', 'timesheets'] });
      return true;
    } catch (e) {
      toast('error', errorMessage(e));
      return false;
    }
  };

  return (
    <div className="flex flex-col gap-3.5">
      <PageHead title="Timesheet approvals" sub="Weeks your people submitted for review.">
        <select aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value)} className={input + ' !w-[180px]'}>
          <option value="submitted">Awaiting review</option>
          <option value="approved">Approved</option>
          <option value="rejected">Sent back</option>
          <option value="">All</option>
        </select>
      </PageHead>
      {q.isLoading ? <Spinner /> : q.error ? <ErrorNote error={q.error} onRetry={() => void q.refetch()} /> : null}
      {q.data ? (
        <div className="overflow-hidden rounded-[12px] border border-line bg-surface">
          <THead cols={[['Employee', null], ['Period', 150], ['Logged', 80], ['Submitted', 120], ['Status', 140], ['', 200]]} />
          {q.data.map((s) => (
            <div key={s.id} className={row}>
              <Cell w={null} className="font-semibold">{s.employee ?? `#${s.employee_id}`}</Cell>
              <Cell w={150}>{rangeLabel(s.starts_on, s.ends_on)}</Cell>
              <Cell w={80} className="tabular-nums">{minutesLabel(s.minutes)}</Cell>
              <Cell w={120} className="text-ink-3">{s.submitted_at ? dayShort(s.submitted_at.slice(0, 10)) : '—'}</Cell>
              <Cell w={140} className="!overflow-visible">
                <StatusChip>{SHEET_LABEL[s.status] ?? s.status}</StatusChip>
              </Cell>
              <span className="flex w-[200px] shrink-0 justify-end gap-3 text-[12.5px] font-bold">
                <button type="button" className="text-primary hover:underline" onClick={() => setViewing(s)}>
                  View
                </button>
                {s.can_decide ? (
                  <>
                    <button type="button" className="text-success hover:underline" onClick={() => void decide(s, 'approve')}>
                      Approve
                    </button>
                    <button type="button" className="text-danger hover:underline" onClick={() => setSending(s)}>
                      Send back
                    </button>
                  </>
                ) : s.status === 'submitted' ? (
                  <span className="font-medium text-ink-3">Someone else reviews it</span>
                ) : null}
              </span>
            </div>
          ))}
          {!q.data.length ? <Empty text={status === 'submitted' ? 'Nothing is waiting for review.' : 'Nothing here.'} /> : null}
        </div>
      ) : null}
      {viewing ? <SheetDetail sheet={viewing} onClose={() => setViewing(null)} /> : null}
      {sending ? <SendBackSheet sheet={sending} onClose={() => setSending(null)} onSend={async (note) => (await decide(sending, 'reject', note)) && setSending(null)} /> : null}
    </div>
  );
}

function SendBackSheet({ sheet, onClose, onSend }: { sheet: TimeSheet; onClose: () => void; onSend: (note: string) => Promise<unknown> }) {
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <Sheet
      title="Send this timesheet back"
      width={420}
      onClose={onClose}
      footer={
        <>
          <button type="button" className={btn} onClick={onClose}>
            Cancel
          </button>
          <button type="button" disabled={busy || !note.trim()} className={btnPrimary} onClick={() => (setBusy(true), void onSend(note.trim()).finally(() => setBusy(false)))}>
            Send back
          </button>
        </>
      }
    >
      <span className="text-ink-2">
        {sheet.employee ?? 'Timesheet'} · {rangeLabel(sheet.starts_on, sheet.ends_on)}
      </span>
      <Field label="What needs changing?" hint="They see this on their timesheet.">
        <textarea aria-label="What needs changing?" value={note} onChange={(e) => setNote(e.target.value)} className={input + ' !h-[70px] resize-none py-2'} />
      </Field>
    </Sheet>
  );
}

/** What was logged inside one submitted period. */
export function SheetDetail({ sheet, onClose }: { sheet: TimeSheet; onClose: () => void }) {
  const q = useQuery({
    queryKey: ['hr', 'time-logs', sheet.employee_id, sheet.starts_on, sheet.ends_on],
    queryFn: ({ signal }) => apiGet<LogsResponse>('/api/hr/time-logs', { employee_id: sheet.employee_id, from: sheet.starts_on, to: sheet.ends_on }, signal),
  });
  const d = q.data;
  return (
    <Sheet
      title={`${sheet.employee ?? 'Timesheet'} — ${rangeLabel(sheet.starts_on, sheet.ends_on)}`}
      width={620}
      onClose={onClose}
      footer={
        <button type="button" className={btn} onClick={onClose}>
          Close
        </button>
      }
    >
      {q.isLoading ? <Spinner /> : q.error ? <ErrorNote error={q.error} onRetry={() => void q.refetch()} /> : null}
      {d ? (
        <>
          <div className="grid grid-cols-3 gap-2.5">
            <Kpi label="Logged" value={minutesLabel(d.totals.minutes)} />
            <Kpi label="Billable" value={minutesLabel(d.totals.billable_minutes)} />
            <Kpi label="Entries" value={d.totals.entries} />
          </div>
          {sheet.decision_note ? <div className="rounded-[8px] bg-ground px-3 py-2 text-[12.5px] text-ink-2">“{sheet.decision_note}”{sheet.decided_by ? ` — ${sheet.decided_by}` : ''}</div> : null}
          <Panel title="Work logged">
            <THead cols={[['Date', 90], ['Work', null], ['Project', 130], ['Time', 70]]} />
            {d.logs.map((l) => (
              <div key={l.id} className={row}>
                <Cell w={90}>{dayShort(l.on_date)}</Cell>
                <Cell w={null}>
                  {l.description}
                  {!l.billable ? <span className="ml-1.5 text-[11px] text-ink-3">non-billable</span> : null}
                </Cell>
                <Cell w={130} className="text-ink-2">{l.project ?? '—'}</Cell>
                <Cell w={70} className="tabular-nums">{minutesLabel(l.minutes)}</Cell>
              </div>
            ))}
            {!d.logs.length ? <Empty text="No time was logged in this period." /> : null}
          </Panel>
        </>
      ) : null}
    </Sheet>
  );
}
