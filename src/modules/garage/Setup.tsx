import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Icon } from '../../components/Icon';
import { Button, ErrorNote, Spinner, cx } from '../../components/ui';
import { toast } from '../../core/toasts';
import { PageHead } from '../hr/parts';
import { errorText, gGet, gPost, K, type SetupStatus } from './api';
import { useGarage } from './parts';
import Workshop, { type WorkshopTab } from './Workshop';

/** Which Workshop section sets each required step up. */
const WHERE: Record<string, WorkshopTab> = {
  branches: 'branches',
  workshops: 'bays',
  bays: 'bays',
  technicians: 'technicians',
  warehouses: 'branches',
  labour: 'rates',
  services: 'services',
  inspections: 'inspections',
};

/**
 * The first-time set-up wizard (§27, FR-APP-04). Required steps are done by
 * doing them — they tick when the branch, bay or technician exists — so the
 * wizard never disagrees with the Workshop screens beside it. Defaulted steps
 * are confirmed and optional ones skipped; progress is kept on the server.
 * People who manage Garage land here until it is finished.
 */
export default function Setup() {
  const g = useGarage();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: K.setup(g.org), queryFn: ({ signal }) => gGet<SetupStatus>('/setup', { org: g.org }, signal) });
  const [busy, setBusy] = useState<string | null>(null);
  const [picked, setPicked] = useState<string | null>(null);

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: K.setup(g.org) });
    void qc.invalidateQueries({ queryKey: ['garage', 'options'] });
  };
  const mark = async (key: string, how: 'done' | 'skipped' | 'clear') => {
    setBusy(key);
    try {
      await gPost(`/setup/steps/${key}`, { how, org: g.org });
      refresh();
    } catch (e) {
      toast('error', errorText(e));
    } finally {
      setBusy(null);
    }
  };
  const finish = async () => {
    setBusy('finish');
    try {
      const r = await gPost('/setup/finish', { org: g.org });
      toast('success', r.message);
      refresh();
      g.go('overview');
    } catch (e) {
      toast('error', errorText(e));
    } finally {
      setBusy(null);
    }
  };

  if (q.isLoading) return <Spinner />;
  if (q.error || !q.data) return <div className="p-6"><ErrorNote error={q.error ?? new Error('The set-up could not be loaded.')} onRetry={() => void q.refetch()} /></div>;
  const s = q.data;
  const current = s.steps.find((x) => x.key === picked) ?? s.steps.find((x) => !x.done && x.kind === 'required') ?? null;
  const where = current ? WHERE[current.key] : undefined;
  const pct = s.total ? Math.round((s.done / s.total) * 100) : 0;

  return (
    <div className="flex flex-col gap-4 px-6 py-5">
      <PageHead title={s.complete ? 'Set-up' : 'Configure your workshop'} sub={s.complete ? 'Garage is set up. Change anything here or in Workshop.' : 'Before the first service job. Progress is saved — finish later if you need to.'}>
        {!s.complete ? (
          <Button variant="primary" icon="check" loading={busy === 'finish'} disabled={!s.ready || !g.online} title={s.ready ? undefined : 'Every required step first'} onClick={() => void finish()}>
            Finish set-up
          </Button>
        ) : null}
      </PageHead>
      <div className="grid gap-4 xl:grid-cols-[22rem_1fr]">
        <div className="flex flex-col gap-2">
          <div className="h-2 overflow-hidden rounded-full bg-subtle" role="progressbar" aria-valuenow={s.done} aria-valuemin={0} aria-valuemax={s.total} aria-label="Set-up progress">
            <div className="h-full bg-primary" style={{ width: `${pct}%` }} />
          </div>
          <p className="m-0 text-[12px] text-ink-3">
            {s.done} of {s.total} steps
          </p>
          <ol className="m-0 flex list-none flex-col gap-1 p-0">
            {s.steps.map((x, i) => (
              <li key={x.key} className={cx('rounded-[10px] border px-3 py-2', current?.key === x.key ? 'border-primary bg-selection' : 'border-line bg-surface')}>
                <div className="flex items-start gap-2">
                  {x.done ? (
                    <Icon name={x.skipped ? 'minus' : 'check-circle'} size={18} className={cx('mt-0.5 shrink-0', x.skipped ? 'text-ink-3' : 'text-success')} />
                  ) : (
                    <span className="mt-0.5 grid size-[18px] shrink-0 place-items-center rounded-full border border-line text-[10px] font-bold text-ink-3">{i + 1}</span>
                  )}
                  <div className="min-w-0 flex-1">
                    <button type="button" className="text-left text-[13px] font-semibold text-ink hover:text-primary" onClick={() => setPicked(x.key)}>
                      {x.title} {x.kind !== 'required' ? <span className="text-[10px] font-normal text-ink-3 uppercase">{x.kind === 'skip' ? 'optional' : 'defaults'}</span> : null}
                    </button>
                    <p className="m-0 text-[12px] text-ink-3">{x.done ? (x.skipped ? 'Skipped for now.' : x.what) : x.todo || x.what}</p>
                    {!x.done && x.kind !== 'required' && g.online ? (
                      <div className="mt-1 flex gap-3">
                        <button type="button" className="text-[12px] font-semibold text-primary disabled:opacity-50" disabled={busy === x.key} onClick={() => void mark(x.key, 'done')}>
                          {x.kind === 'default' ? 'Use the defaults' : 'Done'}
                        </button>
                        {x.kind === 'skip' ? (
                          <button type="button" className="text-[12px] text-ink-3 disabled:opacity-50" disabled={busy === x.key} onClick={() => void mark(x.key, 'skipped')}>
                            Skip
                          </button>
                        ) : null}
                      </div>
                    ) : null}
                    {x.done && x.kind !== 'required' && x.key !== 'first_job' && g.online ? (
                      <button type="button" className="mt-1 text-[12px] text-ink-3" onClick={() => void mark(x.key, 'clear')}>
                        Undo
                      </button>
                    ) : null}
                    {x.key === 'first_job' && !x.done && s.complete && g.may('garage.job.create') ? (
                      <button type="button" className="mt-1 text-[12px] font-semibold text-primary" onClick={() => g.go('walkin')}>
                        Take a walk-in
                      </button>
                    ) : null}
                  </div>
                </div>
              </li>
            ))}
          </ol>
        </div>
        <div className="min-w-0 rounded-[12px] border border-line bg-surface">
          {current && where ? (
            <Workshop key={`${current.key}-${where}`} initial={where} embedded />
          ) : (
            <p className="m-0 p-5 text-[13px] text-ink-2">{s.complete ? 'Every required step is done.' : s.ready ? 'Every required step is done. Finish the set-up to start taking jobs.' : 'Choose a step on the left.'}</p>
          )}
        </div>
      </div>
    </div>
  );
}
