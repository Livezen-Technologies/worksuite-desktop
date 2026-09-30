import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Icon } from '../../../components/Icon';
import { Button, ErrorNote, Spinner, cx } from '../../../components/ui';
import { toast } from '../../../core/toasts';
import { PageHead } from '../../hr/parts';
import { eGet, ePost, errorText, K, type SetupStatus } from '../api';
import { Refusal, useEl, type ElView } from '../parts';

/** Where the steps done by doing are done. */
const WHERE: Record<string, { view: ElView; label: string }> = {
  categories: { view: 'categories', label: 'Categories' },
  first_course: { view: 'courses', label: 'Courses' },
  publish: { view: 'courses', label: 'Courses' },
};

/**
 * First-time set-up (§13): twelve resumable steps kept on the server. Required
 * ones tick by being done (a category, a course with a lesson, a published
 * course); defaulted ones are confirmed; later phases are skipped. Publishing
 * waits for every step before "Create first course".
 */
export default function Setup() {
  const el = useEl();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: K.setup(el.org), queryFn: ({ signal }) => eGet<SetupStatus>('/setup', { org: el.org }, signal) });
  const [busy, setBusy] = useState<string | null>(null);
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: K.setup(el.org) });
    void qc.invalidateQueries({ queryKey: ['elearning', 'options'] });
    void qc.invalidateQueries({ queryKey: ['elearning', 'categories'] });
  };
  const act = async (key: string, path: string, body: object = {}) => {
    setBusy(key);
    try {
      const r = await ePost(path, { ...body, org: el.org });
      toast('success', r.message);
      refresh();
    } catch (e) {
      toast('error', errorText(e));
    } finally {
      setBusy(null);
    }
  };
  if (q.isLoading) return <Spinner />;
  if (q.error || !q.data) return <div className="p-6"><ErrorNote error={q.error ?? new Error('The set-up could not be loaded.')} onRetry={() => void q.refetch()} /></div>;
  const s = q.data;
  const pctDone = s.total ? Math.round((s.done / s.total) * 100) : 0;
  return (
    <div className="flex flex-col gap-4 px-6 py-5">
      <PageHead title={s.complete ? 'Set-up' : 'Set up eLearning'} sub={s.complete ? 'eLearning is set up for this company.' : 'Progress is kept — finish later if you need to.'}>
        {!s.complete ? (
          <Button variant="primary" icon="check" loading={busy === 'finish'} disabled={!s.ready || !el.online} title={s.ready ? undefined : 'Every required step first'} onClick={() => void act('finish', '/setup/finish')}>
            Finish set-up
          </Button>
        ) : null}
      </PageHead>
      <div className="h-2 max-w-[520px] overflow-hidden rounded-full bg-subtle" role="progressbar" aria-label="Set-up progress" aria-valuenow={s.done} aria-valuemin={0} aria-valuemax={s.total}>
        <div className="h-full bg-primary" style={{ width: `${pctDone}%` }} />
      </div>
      <p className="m-0 text-[12px] text-ink-3">
        {s.done} of {s.total} steps{s.ready_to_publish ? ' · courses can be published' : ' · publishing waits for the steps before "Create first course"'}
      </p>
      {!s.manage ? <Refusal text="You can follow the set-up; changing it needs elearning.settings.manage." /> : null}
      <ol className="m-0 flex max-w-[760px] list-none flex-col gap-1.5 p-0">
        {s.steps.map((x, i) => (
          <li key={x.key} className={cx('rounded-[10px] border px-3 py-2', s.next === x.key ? 'border-primary bg-selection' : 'border-line bg-surface')}>
            <div className="flex items-start gap-2">
              {x.done ? (
                <Icon name={x.skipped ? 'minus' : 'check-circle'} size={18} className={cx('mt-0.5 shrink-0', x.skipped ? 'text-ink-3' : 'text-success')} />
              ) : (
                <span className="mt-0.5 grid size-[18px] shrink-0 place-items-center rounded-full border border-line text-[10px] font-bold text-ink-3">{i + 1}</span>
              )}
              <div className="min-w-0 flex-1">
                <b className="text-[13px] text-ink">
                  {x.title} {x.kind !== 'required' ? <span className="text-[10px] font-normal text-ink-3 uppercase">{x.kind === 'skip' ? 'later phase' : 'defaults'}</span> : null}
                </b>
                <p className="m-0 text-[12px] text-ink-3">{x.done ? (x.skipped ? 'Skipped for now.' : x.what) : x.todo || x.what}</p>
                {s.manage && el.online ? (
                  <div className="mt-1 flex flex-wrap gap-3 text-[12px]">
                    {x.key === 'categories' && !x.done ? (
                      <button type="button" className="font-semibold text-primary disabled:opacity-50" disabled={busy !== null} onClick={() => void act(x.key, '/setup/categories')}>
                        Add the fourteen default categories
                      </button>
                    ) : null}
                    {WHERE[x.key] && !x.done ? (
                      <button type="button" className="font-semibold text-primary" onClick={() => el.go(WHERE[x.key]!.view)}>
                        Open {WHERE[x.key]!.label}
                      </button>
                    ) : null}
                    {!x.done && x.kind !== 'required' ? (
                      <>
                        <button type="button" className="font-semibold text-primary disabled:opacity-50" disabled={busy !== null} onClick={() => void act(x.key, `/setup/steps/${x.key}`, { how: 'done' })}>
                          {x.kind === 'default' ? 'Use the defaults' : 'Done'}
                        </button>
                        {x.kind === 'skip' ? (
                          <button type="button" className="text-ink-3 disabled:opacity-50" disabled={busy !== null} onClick={() => void act(x.key, `/setup/steps/${x.key}`, { how: 'skipped' })}>
                            Skip
                          </button>
                        ) : null}
                      </>
                    ) : null}
                    {x.done && x.kind !== 'required' ? (
                      <button type="button" className="text-ink-3 disabled:opacity-50" disabled={busy !== null} onClick={() => void act(x.key, `/setup/steps/${x.key}`, { how: 'clear' })}>
                        Undo
                      </button>
                    ) : null}
                  </div>
                ) : null}
              </div>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}
