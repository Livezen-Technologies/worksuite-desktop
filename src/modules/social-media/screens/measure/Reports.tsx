import { useMutation } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { errorMessage } from '../../../../core/bridge';
import { toast } from '../../../../core/toasts';
import { Menu } from '../../../../components/Menu';
import { Button, Modal } from '../../../../components/ui';
import { SK, socialApi, useInvalidate, useReportSchedules, type AnalyticsQuery, type ReportSchedule } from '../../api';
import { Field, INPUT, NativeSelect, OptionalView } from '../../parts';
import { logStamp } from '../../lib/time';

/**
 * W07's report actions (SMM-ANL-006, SMM-ANL-007): export the current view as PDF or XLSX — prepared on the server,
 * announced by a notification — and recurring e-mailed reports.
 */

export const EXPORT_TOAST = "Your export is being prepared — you'll get a notification when it's ready.";

export function ExportButton({ query }: { query: AnalyticsQuery }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [open, setOpen] = useState(false);
  const run = useMutation({ mutationFn: (format: 'pdf' | 'xlsx') => socialApi.exportAnalytics({ ...query, format }), onSuccess: (r) => toast('success', r.message || EXPORT_TOAST), onError: (e) => toast('error', errorMessage(e)) });
  return (
    <>
      <span ref={ref} className="inline-flex">
        <Button variant="primary" icon="download" loading={run.isPending} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
          Export
        </Button>
      </span>
      {open ? (
        <Menu
          label="Export analytics"
          anchor={ref}
          prefer="bottom"
          align="end"
          width={200}
          onClose={() => setOpen(false)}
          sections={[
            {
              id: 'format',
              items: [
                { id: 'pdf', label: 'PDF', description: 'A report to read or send', icon: 'file-text', onSelect: () => run.mutate('pdf') },
                { id: 'xlsx', label: 'XLSX', description: 'The numbers, for a spreadsheet', icon: 'file-sheet', onSelect: () => run.mutate('xlsx') },
              ],
            },
          ]}
        />
      ) : null}
    </>
  );
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function ScheduleReportDialog({ onClose }: { onClose: () => void }) {
  const [name, setName] = useState('');
  const [frequency, setFrequency] = useState<ReportSchedule['frequency']>('weekly');
  const [format, setFormat] = useState<ReportSchedule['format']>('pdf');
  const [recipients, setRecipients] = useState('');
  const schedules = useReportSchedules();
  const invalidate = useInvalidate();
  const list = recipients
    .split(/[,;\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const bad = list.filter((r) => !EMAIL.test(r));
  const save = useMutation({
    mutationFn: () => socialApi.saveReportSchedule({ name: name.trim(), frequency, format, recipients: list }),
    onSuccess: () => {
      invalidate(SK.reportSchedules);
      toast('success', 'Report scheduled.');
      setName('');
      setRecipients('');
    },
    onError: (e) => toast('error', errorMessage(e)),
  });
  const ready = name.trim() && list.length > 0 && bad.length === 0;
  return (
    <Modal
      title="Schedule report"
      onClose={onClose}
      width={540}
      footer={
        <>
          <Button onClick={onClose}>Close</Button>
          <Button variant="primary" disabled={!ready} loading={save.isPending} onClick={() => save.mutate()}>
            Schedule
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <Field label="Name">
          <input className={INPUT} value={name} onChange={(e) => setName(e.target.value)} placeholder="Monthly social summary" />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Frequency">
            <NativeSelect label="Frequency" value={frequency} onChange={(v) => setFrequency(v as ReportSchedule['frequency'])}>
              <option value="daily">Daily</option>
              <option value="weekly">Weekly</option>
              <option value="monthly">Monthly</option>
            </NativeSelect>
          </Field>
          <Field label="Format">
            <NativeSelect label="Format" value={format} onChange={(v) => setFormat(v as ReportSchedule['format'])}>
              <option value="pdf">PDF</option>
              <option value="xlsx">XLSX</option>
            </NativeSelect>
          </Field>
        </div>
        <Field label="Recipients" hint={bad.length ? <span className="text-danger">Not an e-mail address: {bad.join(', ')}</span> : 'E-mail addresses, separated by commas.'}>
          <input className={INPUT} value={recipients} onChange={(e) => setRecipients(e.target.value)} placeholder="manager@example.com, team@example.com" />
        </Field>
        <div>
          <h3 className="mb-1.5 text-[12px] font-semibold text-ink-2">Scheduled reports</h3>
          <OptionalView q={schedules} what="Scheduled reports" compact>
            {(rows) =>
              rows.length ? (
                <ul className="flex flex-col divide-y divide-line rounded-[10px] border border-line">
                  {rows.map((s) => (
                    <li key={s.id} className="flex flex-wrap items-center gap-x-3 px-3 py-2 text-[12.5px]">
                      <span className="font-semibold text-ink">{s.name}</span>
                      <span className="text-ink-3">
                        {s.frequency} · {s.format.toUpperCase()} · {s.recipients.length} recipient
                        {s.recipients.length === 1 ? '' : 's'}
                      </span>
                      {s.next_run_at ? <span className="ml-auto text-ink-3">Next {logStamp(s.next_run_at)}</span> : null}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-[12.5px] text-ink-3">No reports scheduled yet.</p>
              )
            }
          </OptionalView>
        </div>
      </div>
    </Modal>
  );
}
