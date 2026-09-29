import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { toast } from '../../../core/toasts';
import { Icon } from '../../../components/Icon';
import { ErrorNote, Modal, Spinner, cx } from '../../../components/ui';
import { btn, btnPrimary, btnSmall, PageHead } from '../../hr/parts';
import { OFFLINE_WRITE, refusalOf, vehicleLine } from '../api';
import { clock, completeWorkOrder, fetchMine, KB2, minutesLabel, PAUSE_REASONS, timer, workedSeconds, type WorkOrder } from '../api-b2';
import { Pill, when } from '../parts';
import type { GarageViewProps } from '../registry';

/**
 * My work (SRS §9.2 Technician, §28.8, FR-TEC-01..03), stage B2: the work
 * orders the reader is on, in the server's tabs (today, in progress, waiting
 * for parts, paused, completed), their own running timer first, with Start,
 * Pause (and why) and Complete. The timer is the server's clock; the one
 * shown here only counts on from what the server said.
 */
export default function MyWork({ org, online, onJob }: GarageViewProps) {
  const qc = useQueryClient();
  const [tab, setTab] = useState('today');
  const q = useQuery({ queryKey: KB2.mine(tab, org), queryFn: ({ signal }) => fetchMine(tab, org, signal), refetchInterval: 30_000, placeholderData: (p) => p });
  const [pausing, setPausing] = useState<WorkOrder | null>(null);
  const [busy, setBusy] = useState<number | null>(null);
  const items = q.data?.items ?? [];
  const running = items.some((w) => w.my_timer?.state === 'running');
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!running) return;
    const h = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(h);
  }, [running]);

  const act = async (wo: WorkOrder, fn: () => Promise<{ message?: string | null; data: { warnings?: string[] } }>, done: string) => {
    if (!online) return toast('error', OFFLINE_WRITE);
    setBusy(wo.id);
    try {
      const r = await fn();
      toast('success', r.message || done);
      for (const w of r.data.warnings ?? []) toast('warning', w);
      void qc.invalidateQueries({ queryKey: ['garage'] });
    } catch (e) {
      toast('error', refusalOf(e).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="flex flex-col gap-3 px-6 py-5">
      <PageHead title="My work" sub="The work orders you are on">
        <div role="tablist" aria-label="My work" className="flex flex-wrap gap-1">
          {(q.data?.tabs ?? [{ key: 'today', label: 'Today', count: 0 }]).map((t) => (
            <button key={t.key} type="button" role="tab" aria-selected={tab === t.key} onClick={() => setTab(t.key)} className={cx('h-8 rounded-[8px] px-3 text-[12.5px] font-semibold', tab === t.key ? 'bg-primary text-white' : 'border border-line bg-surface text-ink-2')}>
              {t.label} {t.count ? <span className="ml-1 opacity-80">{t.count}</span> : null}
            </button>
          ))}
        </div>
      </PageHead>
      {q.isLoading ? <Spinner /> : q.error ? <ErrorNote error={q.error} onRetry={() => void q.refetch()} /> : null}
      {items.map((wo) => (
        <section key={wo.id} aria-label={`${wo.job.number} ${wo.code}`} className={cx('flex flex-wrap items-center gap-3 rounded-[12px] border bg-surface px-4 py-3 text-[12.5px]', wo.my_timer?.state === 'running' ? 'border-primary' : 'border-line')}>
          <button type="button" onClick={() => onJob(wo.job.id)} className="flex min-w-[220px] flex-1 flex-col text-left">
            <span className="flex items-center gap-2">
              <b className="text-[13.5px] text-ink">{wo.job.number}</b>
              <Pill tone="blue">{wo.status_label}</Pill>
              {wo.job.overdue ? <Pill tone="red">Overdue</Pill> : null}
            </span>
            <span className="text-ink-2">{vehicleLine(wo.job.vehicle)}</span>
            <span className="text-ink">
              <b>{wo.code}</b> · {wo.work_type}
            </span>
            <span className="text-ink-3">{[wo.bay ? `Bay ${wo.bay.code}` : null, `${minutesLabel(wo.actual_minutes)} of ${minutesLabel(wo.estimated_minutes)}`, wo.job.target_completion_at ? `promised ${when(wo.job.target_completion_at)}` : null].filter(Boolean).join(' · ')}</span>
          </button>
          {wo.my_timer && wo.my_timer.state !== 'not_started' ? <span className={cx('font-mono text-[20px] tabular-nums', wo.my_timer.state === 'running' ? 'font-bold text-primary' : 'text-ink-3')}>{clock(workedSeconds(wo.my_timer, now))}</span> : null}
          <div className="flex flex-wrap gap-1.5">
            {wo.my_timer?.state === 'running' ? (
              wo.can.pause ? (
                <button type="button" className={btn} disabled={!online || busy === wo.id} onClick={() => setPausing(wo)}>
                  <Icon name="pause" size={15} /> Pause
                </button>
              ) : null
            ) : wo.can.start ? (
              <button type="button" className={btnPrimary} disabled={!online || busy === wo.id} onClick={() => void act(wo, () => timer(wo.id, wo.my_timer?.state === 'paused' ? 'resume' : 'start'), 'Timer running.')}>
                <Icon name="play" size={15} /> {wo.my_timer?.state === 'paused' ? 'Resume' : 'Start'}
              </button>
            ) : null}
            {wo.can.complete ? (
              <button type="button" className={btn} disabled={!online || busy === wo.id} onClick={() => void act(wo, () => completeWorkOrder(wo.id), `${wo.code} completed.`)}>
                <Icon name="check" size={15} /> Complete
              </button>
            ) : null}
          </div>
        </section>
      ))}
      {q.data && !items.length ? <p className="m-0 text-[12.5px] text-ink-3">Nothing here.</p> : null}
      {pausing ? (
        <Modal title={`Pause ${pausing.code}`} width={420} onClose={() => setPausing(null)}>
          <div className="flex flex-col gap-1">
            {Object.entries(PAUSE_REASONS).map(([k, label]) => (
              <button
                key={k}
                type="button"
                className={cx(btnSmall, 'h-9 justify-start')}
                onClick={() => {
                  const wo = pausing;
                  setPausing(null);
                  void act(wo, () => timer(wo.id, 'pause', { reason: k }), 'Paused.');
                }}
              >
                {label}
              </button>
            ))}
          </div>
        </Modal>
      ) : null}
    </div>
  );
}
