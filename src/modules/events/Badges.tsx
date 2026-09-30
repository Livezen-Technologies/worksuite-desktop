import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Select } from '../../components/Select';
import { Button, Card, Empty, Modal, Spinner, cx } from '../../components/ui';
import { toast } from '../../core/toasts';
import type { BadgeJob } from '@shared/event-desk';
import { at, eGet, ePost, errorText, K, type TicketType, type When } from './api';
import { printJobs, usePrintSettings } from './desk';
import { Header, Refusal, useEvent } from './parts';

/**
 * Badges at the desk (EV-BDG-012..014): pre-printing a first badge for every
 * confirmed registration that has none — of one ticket, sorted by name or
 * company (`POST badge-prints/bulk`) — printed here in runs of fifty from the
 * server's sheet; and the print queue: badges waiting, printed or failed,
 * printed here, sent again or cancelled. A single badge (and a reprint with
 * its reason) is printed from the desk's scan result or a registration.
 */

interface Job extends BadgeJob {
  by: string | null;
  reason: string | null;
  error: string | null;
  at: When | null;
  printed_at: When | null;
}

const RUN = 50;

export default function Badges() {
  const { event, may, online } = useEvent();
  const qc = useQueryClient();
  const settings = usePrintSettings();
  const [status, setStatus] = useState('QUEUED,FAILED');
  const queue = useQuery({
    queryKey: [...K.live(event.id), 'badge-queue', status],
    queryFn: ({ signal }) => eGet<{ items: Job[] }>(`/events/${event.id}/badge-prints`, { status, limit: 200 }, signal),
    enabled: online,
    refetchInterval: 20_000,
  });
  const tickets = useQuery({ queryKey: [...K.event(event.id), 'tickets'], queryFn: ({ signal }) => eGet<TicketType[]>(`/events/${event.id}/ticket-types`, undefined, signal), enabled: online });
  const templates = useQuery({
    queryKey: [...K.event(event.id), 'badge-templates'],
    queryFn: ({ signal }) => eGet<{ items: Array<{ id: number; name: string; role_label: string; size: string; active: boolean }> }>(`/events/${event.id}/badge-templates`, undefined, signal),
    enabled: online,
    retry: false,
  });
  const [ticket, setTicket] = useState<number | null>(null);
  const [sort, setSort] = useState<'name' | 'company'>('name');
  const [template, setTemplate] = useState<number | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number; failed: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = () => void qc.invalidateQueries({ queryKey: K.live(event.id) });

  const runPrint = async (ids: number[]) => {
    let done = 0;
    let failed = 0;
    setProgress({ done, total: ids.length, failed });
    for (let i = 0; i < ids.length; i += RUN) {
      const part = ids.slice(i, i + RUN);
      try {
        const r = await printJobs(event.id, part);
        done += r.printed.length;
        failed += r.failed.length;
        if (!r.ok && r.printed.length === 0) {
          setError(r.message);
          break;
        }
      } catch (e) {
        setError(errorText(e));
        break;
      }
      setProgress({ done, total: ids.length, failed });
    }
    setProgress({ done, total: ids.length, failed });
    refresh();
  };

  const bulk = async () => {
    setConfirm(false);
    setError(null);
    try {
      const r = await ePost<{ job_ids: number[]; count: number }>(`/events/${event.id}/badge-prints/bulk`, {
        ticket_type_id: ticket ?? undefined,
        sort,
        printer: settings.data?.printer_name ?? undefined,
        template_id: template ?? undefined,
      });
      toast('info', r.message);
      if (r.data.job_ids.length > 0) await runPrint(r.data.job_ids);
    } catch (e) {
      setError(errorText(e));
    }
  };

  const move = async (job: Job, on: 'retry' | 'cancel') => {
    try {
      const r = await ePost(`/badge-prints/${job.id}/${on}`, { version: job.version });
      toast('success', r.message);
      refresh();
    } catch (e) {
      toast('error', errorText(e));
    }
  };

  if (!may('events.badge.print')) return null;
  const items = queue.data?.items ?? [];

  return (
    <div className="flex flex-col gap-4 pb-6">
      <Header title="Badges" sub={settings.data?.badge_printer ? `Printing on ${settings.data.badge_printer}${settings.data.silent ? ', without asking' : ''}` : 'Printing through the system’s print dialog (choose a badge printer under This computer)'} />
      <div className="flex flex-col gap-4 px-6">
        {!online ? <Refusal text="Badges print from WorkSuite’s badge page: they wait for the line." /> : null}
        {error ? <Refusal text={error} /> : null}
        <Card title="Pre-print badges">
          <div className="flex flex-wrap items-end gap-3 text-[13px]">
            <label className="flex flex-col gap-1 font-semibold text-ink-2">
              Ticket
              <Select
                aria-label="Ticket"
                value={ticket === null ? '' : String(ticket)}
                onChange={(e) => setTicket(e.target.value ? Number(e.target.value) : null)}
                options={[{ value: '', label: 'Every ticket' }, ...(tickets.data ?? []).map((t) => ({ value: String(t.id), label: t.name }))]}
                className="h-9 w-[220px] rounded-[8px] border border-line bg-surface px-2 text-[13px] text-ink"
              />
            </label>
            <label className="flex flex-col gap-1 font-semibold text-ink-2">
              In the order of
              <Select
                aria-label="Order"
                value={sort}
                onValueChange={(v) => setSort(v)}
                options={[
                  { value: 'name' as const, label: 'Name' },
                  { value: 'company' as const, label: 'Company' },
                ]}
                className="h-9 w-[140px] rounded-[8px] border border-line bg-surface px-2 text-[13px] text-ink"
              />
            </label>
            {templates.data ? (
              <label className="flex flex-col gap-1 font-semibold text-ink-2">
                Template
                <Select
                  aria-label="Template"
                  value={template === null ? '' : String(template)}
                  onChange={(e) => setTemplate(e.target.value ? Number(e.target.value) : null)}
                  options={[{ value: '', label: 'Each ticket’s own' }, ...templates.data.items.filter((t) => t.active).map((t) => ({ value: String(t.id), label: `${t.name} (${t.role_label}, ${t.size})` }))]}
                  className="h-9 w-[240px] rounded-[8px] border border-line bg-surface px-2 text-[13px] text-ink"
                />
              </label>
            ) : null}
            <Button variant="primary" icon="printer" disabled={!online || progress !== null && progress.done + progress.failed < progress.total} onClick={() => setConfirm(true)}>
              Pre-print
            </Button>
          </div>
          <p className="mt-2 mb-0 text-[12px] text-ink-3">A first badge for every confirmed registration that has none yet. Reprints are made one at a time, with a reason.</p>
          {progress ? (
            <div className="mt-3 flex items-center gap-3 text-[13px]">
              <div className="h-2 flex-1 overflow-hidden rounded-full bg-subtle">
                <div className="h-full bg-primary" style={{ width: `${progress.total ? Math.round(((progress.done + progress.failed) / progress.total) * 100) : 100}%` }} />
              </div>
              <span className="tabular-nums">
                {progress.done} of {progress.total} printed{progress.failed ? `, ${progress.failed} not reported` : ''}
              </span>
            </div>
          ) : null}
        </Card>

        <Card
          title="Print queue"
          action={
            <div className="flex gap-1">
              {[
                ['QUEUED,FAILED', 'To print'],
                ['PRINTED', 'Printed'],
              ].map(([v, l]) => (
                <button key={v} type="button" aria-pressed={status === v} onClick={() => setStatus(v!)} className={cx('h-7 rounded-[7px] px-2.5 text-[12px] font-semibold', status === v ? 'bg-selection text-primary' : 'text-ink-2 hover:bg-subtle')}>
                  {l}
                </button>
              ))}
            </div>
          }
        >
          {queue.isLoading ? <Spinner /> : null}
          {queue.error ? <Refusal text={errorText(queue.error)} /> : null}
          {queue.data && items.length === 0 ? <Empty icon="printer" title={status === 'PRINTED' ? 'Nothing printed yet' : 'Nothing waits to print'} /> : null}
          {status !== 'PRINTED' && items.some((j) => j.status === 'QUEUED') ? (
            <div className="mb-2">
              <Button size="sm" icon="printer" onClick={() => void runPrint(items.filter((j) => j.status === 'QUEUED').map((j) => j.id))}>
                Print all waiting here
              </Button>
            </div>
          ) : null}
          <ul className="m-0 flex list-none flex-col gap-1 p-0">
            {items.map((j) => (
              <li key={j.id} className="flex items-center gap-3 rounded-[8px] border border-line px-3 py-1.5 text-[12.5px]">
                <span className="min-w-0 flex-1 truncate">
                  <b>{j.registration?.name ?? j.registration?.number}</b>
                  <span className="text-ink-3">
                    {' '}
                    · {j.registration?.number}
                    {j.template ? ` · ${j.template.name}` : ''}
                    {j.printer ? ` · to ${j.printer}` : ''}
                    {j.reprint ? ` · reprint${j.reason ? `: ${j.reason}` : ''}` : ''}
                  </span>
                  {j.error ? <span className="text-danger"> — {j.error}</span> : null}
                </span>
                <span className="shrink-0 text-ink-2">{j.status_label}</span>
                <span className="w-[100px] shrink-0 text-right text-ink-3">{at(j.printed_at ?? j.at)}</span>
                {j.status === 'QUEUED' ? (
                  <>
                    <Button size="sm" onClick={() => void runPrint([j.id])}>
                      Print here
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => void move(j, 'cancel')}>
                      Cancel
                    </Button>
                  </>
                ) : j.status === 'FAILED' ? (
                  <Button size="sm" onClick={() => void move(j, 'retry')}>
                    Queue again
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        </Card>
      </div>
      {confirm ? (
        <Modal
          title="Pre-print badges?"
          onClose={() => setConfirm(false)}
          width={440}
          footer={
            <>
              <Button onClick={() => setConfirm(false)}>Cancel</Button>
              <Button variant="primary" icon="printer" onClick={() => void bulk()}>
                Queue and print
              </Button>
            </>
          }
        >
          <p className="m-0 text-[13px] text-ink-2">
            WorkSuite queues a first badge for every confirmed registration {ticket ? 'of that ticket ' : ''}without one, and this desk prints them in runs of {RUN}. Anything not printed stays in the queue.
          </p>
        </Modal>
      ) : null}
    </div>
  );
}
