import { keepPreviousData, useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { Fragment, useMemo, useState, type ReactNode } from 'react';
import { errorMessage } from '../../core/bridge';
import { dateLabel } from '../../core/time';
import { toast } from '../../core/toasts';
import { Icon } from '../../components/Icon';
import { Select } from '../../components/Select';
import { ErrorNote, Spinner, cx } from '../../components/ui';
import { btn, btnPrimary, btnSmall, Empty, Field, input, PageHead, Seg, Sheet, SidePanel } from '../hr/parts';
import { cost, num, qty, stampWords, type Warehouse } from './api';
import {
  BOM_LABEL,
  bomBody,
  bomTone,
  createJob,
  deleteBom,
  deleteJob,
  fetchBom,
  fetchBomCost,
  fetchBoms,
  fetchJob,
  fetchJobs,
  JOB_LABEL,
  jobAct,
  jobActions,
  jobBody,
  jobTone,
  KM,
  leftToMake,
  needed,
  PER,
  runBody,
  saveBom,
  type BomDraft,
  type BomLineDraft,
  type NewJobDraft,
  type RunDraft,
} from './making';
import { minWidth, Pill } from './parts';
import { pick, ProductPick, WarehousePick } from './pickers';

/**
 * Manufacturing (InvManufacturing): the jobs on the floor and the recipes
 * they are built from. A job is released — its component list fixed from the
 * recipe and the parts reserved — then completed in one run or several, each
 * run using the parts and putting the goods on the shelf.
 */
export type MakeTab = 'jobs' | 'boms';

const JOB_STATUSES = [{ value: '', label: 'Every state' }, ...['draft', 'released', 'in_progress', 'completed', 'cancelled'].map((s) => ({ value: s, label: JOB_LABEL[s]! }))];
const BOM_STATUSES = [{ value: '', label: 'Every state' }, ...['active', 'draft', 'archived'].map((s) => ({ value: s, label: BOM_LABEL[s]! }))];

export function JobChip({ status }: { status: string }) {
  return <Pill tone={jobTone(status)}>{JOB_LABEL[status] ?? status.replace(/_/g, ' ')}</Pill>;
}

const rowCls = 'flex w-full items-center gap-2.5 border-b border-line/60 px-3.5 py-2 text-left text-[12.5px] last:border-b-0 hover:bg-subtle/60';

export default function Manufacturing({
  org,
  warehouse,
  currency,
  canCost,
  canMake,
  tab,
  onTab,
  jobId,
  onJob,
  bomId,
  onBom,
  onNewJob,
  onNewBom,
  onEditBom,
  initialStatus,
}: {
  org: string;
  warehouse: number | null;
  currency: string | null;
  canCost: boolean;
  canMake: boolean;
  tab: MakeTab;
  onTab: (t: MakeTab) => void;
  jobId: number | null;
  onJob: (id: number | null) => void;
  bomId: number | null;
  onBom: (id: number | null) => void;
  /** Start a job, from a recipe when one is named. */
  onNewJob: ((bom?: number) => void) | null;
  onNewBom: (() => void) | null;
  onEditBom: (id: number) => void;
  initialStatus?: string | null;
}) {
  return (
    <div className="flex h-full min-h-0 flex-col gap-3 px-6 py-5">
      <PageHead title="Manufacturing">
        <Seg
          label="Manufacturing"
          value={tab}
          onChange={onTab}
          options={[
            { id: 'jobs', label: 'Jobs' },
            { id: 'boms', label: 'Recipes' },
          ]}
        />
        {tab === 'jobs' && onNewJob ? (
          <button type="button" className={btnPrimary} onClick={() => onNewJob()}>
            <Icon name="plus" size={15} /> New job
          </button>
        ) : null}
        {tab === 'boms' && onNewBom ? (
          <button type="button" className={btnPrimary} onClick={onNewBom}>
            <Icon name="plus" size={15} /> New recipe
          </button>
        ) : null}
      </PageHead>
      {tab === 'jobs' ? <Jobs key={initialStatus ?? ''} org={org} warehouse={warehouse} canCost={canCost} openId={jobId} onOpen={onJob} initialStatus={initialStatus} /> : null}
      {tab === 'boms' ? <Boms org={org} openId={bomId} onOpen={onBom} /> : null}
      {jobId ? <JobPanel key={jobId} id={jobId} currency={currency} canCost={canCost} canMake={canMake} onClose={() => onJob(null)} onRecipe={(id) => onBom(id)} /> : null}
      {bomId ? <BomPanel key={bomId} id={bomId} currency={currency} canCost={canCost} canMake={canMake} onClose={() => onBom(null)} onEdit={() => onEditBom(bomId)} onBuild={onNewJob ? () => onNewJob(bomId) : null} /> : null}
    </div>
  );
}

function Frame({ min, head, children, more }: { min: number; head: ReactNode; children: ReactNode; more?: ReactNode }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-[12px] border border-line bg-surface">
      <div className="min-h-0 flex-1 overflow-auto scroll-thin">
        <div style={{ minWidth: min }}>
          <div className="sticky top-0 z-10 flex gap-2.5 border-b border-line bg-ground px-3.5 py-2 text-[11px] font-bold tracking-[.4px] text-ink-3 uppercase">{head}</div>
          {children}
        </div>
      </div>
      {more}
    </div>
  );
}

function Jobs({ org, warehouse, canCost, openId, onOpen, initialStatus }: { org: string; warehouse: number | null; canCost: boolean; openId: number | null; onOpen: (id: number) => void; initialStatus?: string | null }) {
  const [status, setStatus] = useState(initialStatus ?? '');
  const list = useInfiniteQuery({
    queryKey: KM.jobs(org, { status, warehouse }),
    initialPageParam: 1,
    queryFn: ({ pageParam, signal }) => fetchJobs(org, warehouse, { status, page: pageParam }, signal),
    getNextPageParam: (last, pages) => (pages.length * PER < last.total ? pages.length + 1 : undefined),
    placeholderData: keepPreviousData,
  });
  const rows = useMemo(() => (list.data?.pages ?? []).flatMap((p) => p.rows), [list.data]);
  const total = list.data?.pages[0]?.total ?? 0;
  const W = { makes: 200, wh: 130, st: 110, plan: 90, made: 120, unit: 96 };
  return (
    <>
      <div className="flex items-center gap-2">
        <Select aria-label="Job status" value={status} onValueChange={setStatus} options={JOB_STATUSES} className={pick + ' !w-[170px]'} />
        <span className="ml-auto text-[12.5px] text-ink-3" data-doc-count>
          {list.isLoading ? '' : `${total.toLocaleString()} ${total === 1 ? 'job' : 'jobs'}`}
        </span>
      </div>
      <Frame
        min={minWidth(110, [W.makes, W.wh, W.st, W.plan, W.made, ...(canCost ? [W.unit] : [])])}
        head={
          <>
            <span className="min-w-0 flex-1">Job</span>
            <span style={{ width: W.makes }}>Makes</span>
            <span style={{ width: W.wh }}>Where</span>
            <span style={{ width: W.st }}>Status</span>
            <span className="text-right" style={{ width: W.plan }}>
              Planned
            </span>
            <span className="text-right" style={{ width: W.made }}>
              Made
            </span>
            {canCost ? (
              <span className="text-right" style={{ width: W.unit }}>
                Unit cost
              </span>
            ) : null}
          </>
        }
        more={
          list.hasNextPage ? (
            <div className="flex shrink-0 justify-center border-t border-line px-3.5 py-2 text-[12px]">
              <button type="button" className="font-semibold text-primary hover:underline" onClick={() => void list.fetchNextPage()} disabled={list.isFetchingNextPage}>
                {list.isFetchingNextPage ? 'Loading…' : 'Load more'}
              </button>
            </div>
          ) : null
        }
      >
        {list.isLoading ? (
          <Spinner />
        ) : list.error ? (
          <ErrorNote error={list.error} onRetry={() => void list.refetch()} />
        ) : rows.length ? (
          rows.map((a) => {
            const made = num(a.produced_qty) ?? 0;
            const scrap = num(a.scrapped_qty) ?? 0;
            return (
              <button key={a.id} type="button" data-job={a.id} onClick={() => onOpen(Number(a.id))} className={cx(rowCls, openId === Number(a.id) && 'bg-[#F4F6FE] dark:bg-selection/40')}>
                <b className="min-w-0 flex-1 truncate text-ink">{a.reference}</b>
                <span className="flex shrink-0 flex-col" style={{ width: W.makes }}>
                  <span className="truncate text-ink">{a.product_name}</span>
                  {a.code ? <span className="truncate text-[11px] text-ink-3">{a.code}</span> : null}
                </span>
                <span className="shrink-0 truncate text-ink-2" style={{ width: W.wh }}>
                  {a.warehouse ?? '—'}
                </span>
                <span className="shrink-0" style={{ width: W.st }}>
                  <JobChip status={a.status} />
                </span>
                <span className="shrink-0 text-right text-ink tabular-nums" style={{ width: W.plan }}>
                  {qty(num(a.quantity) ?? 0)}
                  {a.unit ? ` ${a.unit}` : ''}
                </span>
                <span className={cx('shrink-0 text-right tabular-nums', made > 0 ? 'text-[#166534] dark:text-success' : 'text-ink-3')} style={{ width: W.made }}>
                  {qty(made)}
                  {scrap > 0 ? <span className="text-danger"> · {qty(scrap)} scrap</span> : null}
                </span>
                {canCost ? (
                  <span className="shrink-0 text-right text-ink-2 tabular-nums" style={{ width: W.unit }}>
                    {made > 0 ? cost(a.unit_cost) : '—'}
                  </span>
                ) : null}
              </button>
            );
          })
        ) : (
          <Empty text={status ? 'No jobs match that.' : 'No jobs yet. A job builds a product from its recipe.'} />
        )}
      </Frame>
    </>
  );
}

function JobPanel({ id, currency, canCost, canMake, onClose, onRecipe }: { id: number; currency: string | null; canCost: boolean; canMake: boolean; onClose: () => void; onRecipe: (id: number) => void }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: KM.job(id), queryFn: ({ signal }) => fetchJob(id, signal) });
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<'complete' | 'cancel' | 'remove' | null>(null);
  const [run, setRun] = useState<RunDraft>({ made: '', scrapped: '', batch: '', expiry: '', serials: '' });
  const [error, setError] = useState<string | null>(null);
  const d = q.data;
  const a = d?.assembly;
  const acts = a ? jobActions(a, canMake) : null;
  const tracking = d?.product?.tracking ?? 'none';
  const left = a ? leftToMake(a) : 0;
  const short = (d?.lines ?? []).filter((l) => (num(l.short) ?? 0) > 0);

  const act = async (label: string | ((r: unknown) => string), fn: () => Promise<unknown>, after?: () => void) => {
    setBusy(true);
    setError(null);
    try {
      const r = await fn();
      toast('success', typeof label === 'string' ? label : label(r));
      void qc.invalidateQueries({ queryKey: ['inventory'] });
      after?.();
    } catch (e) {
      toast('error', errorMessage(e));
    } finally {
      setBusy(false);
      setConfirm(null);
    }
  };
  const complete = () => {
    const { body, error: bad } = runBody(run, tracking, left);
    if (bad) {
      setConfirm(null);
      return setError(bad);
    }
    void act(
      'Run recorded — the parts are used and the goods are on the shelf',
      () => jobAct(id, 'complete', body),
      () => setRun({ made: '', scrapped: '', batch: '', expiry: '', serials: '' }),
    );
  };

  return (
    <>
      <SidePanel
        label={a ? `Job ${a.reference}` : 'Job'}
        width={640}
        onClose={onClose}
        head={
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="flex items-center gap-2">
              <b className="truncate text-[15px] text-ink">{a?.reference ?? 'Job'}</b>
              {a ? <JobChip status={a.status} /> : null}
            </span>
            {a ? <span className="truncate text-[12.5px] text-ink-3">{a.product_name}</span> : null}
          </span>
        }
      >
        {q.isLoading ? (
          <Spinner />
        ) : q.error ? (
          <ErrorNote error={q.error} onRetry={() => void q.refetch()} />
        ) : a && d ? (
          <>
            <span className="text-[12.5px] text-ink-2">
              {[
                a.warehouse,
                a.planned_for ? `planned for ${dateLabel(a.planned_for)}` : null,
                a.created_by_name ? `raised by ${a.created_by_name}` : null,
                a.bom_id ? (
                  <button key="bom" type="button" className="font-semibold text-primary hover:underline" onClick={() => onRecipe(Number(a.bom_id))}>
                    the recipe{a.bom_version ? ` (version ${a.bom_version})` : ''}
                  </button>
                ) : null,
              ]
                .filter(Boolean)
                .map((x, i) => (
                  <Fragment key={i}>
                    {i ? ' · ' : ''}
                    {x}
                  </Fragment>
                ))}
            </span>
            <span data-job-progress className="text-[13px] text-ink">
              <b>{qty(num(a.produced_qty) ?? 0)}</b> of {qty(num(a.quantity) ?? 0)}
              {a.unit ? ` ${a.unit}` : ''} made
              {(num(a.scrapped_qty) ?? 0) > 0 ? <span className="text-danger"> · {qty(num(a.scrapped_qty) ?? 0)} scrapped</span> : null}
              {a.completed_at ? <span className="text-ink-3"> · completed {stampWords(a.completed_at)}</span> : null}
            </span>
            {short.length && !['completed', 'cancelled'].includes(a.status) ? (
              <span role="status" className="rounded-[8px] bg-warning-bg px-3 py-2 text-[12.5px] text-[#9A4A06] dark:text-warning">
                Short of {short.map((s) => `${s.code ?? s.component_name} (${qty(num(s.short) ?? 0)})`).join(', ')}. A run can use only what is here.
              </span>
            ) : null}
            {d.lines.length ? (
              <div className="overflow-hidden rounded-[10px] border border-line">
                <div className="flex gap-2 border-b border-line bg-ground px-3 py-1.5 text-[11px] font-bold tracking-[.4px] text-ink-3 uppercase">
                  <span className="min-w-0 flex-1">Part</span>
                  <span className="w-[76px] text-right">Needed</span>
                  <span className="w-[66px] text-right">Used</span>
                  <span className="w-[76px] text-right">Available</span>
                  {canCost ? <span className="w-[84px] text-right">Cost</span> : null}
                </div>
                {d.lines.map((l) => {
                  const sh = (num(l.short) ?? 0) > 0;
                  return (
                    <div key={l.id} data-part={l.code ?? l.component_id} className={cx('flex items-center gap-2 border-b border-line/60 px-3 py-1.5 text-[12.5px] last:border-b-0', sh && 'bg-warning-bg/40')}>
                      <span className="flex min-w-0 flex-1 flex-col">
                        <b className="truncate text-ink">{l.component_name}</b>
                        {l.code ? <span className="truncate text-[11px] text-ink-3">{l.code}</span> : null}
                      </span>
                      <span className="w-[76px] text-right text-ink tabular-nums">
                        {qty(num(l.required_qty) ?? 0)}
                        {l.unit ? ` ${l.unit}` : ''}
                      </span>
                      <span className="w-[66px] text-right text-ink-2 tabular-nums">{qty(num(l.consumed_qty) ?? 0)}</span>
                      <span className={cx('w-[76px] text-right tabular-nums', sh ? 'font-bold text-[#9A4A06] dark:text-warning' : 'text-ink-2')}>{qty(num(l.available) ?? 0)}</span>
                      {canCost ? <span className="w-[84px] text-right text-ink-2 tabular-nums">{(num(l.consumed_qty) ?? 0) > 0 ? cost(l.cost_value) : '—'}</span> : null}
                    </div>
                  );
                })}
              </div>
            ) : (
              <span className="text-[12.5px] text-ink-3">The parts list is taken from the recipe when the job is released, and the parts are reserved then.</span>
            )}
            {a.status === 'completed' && num(a.unit_cost) !== null ? (
              <section className="flex flex-col gap-1 rounded-[10px] border border-line px-3 py-2.5 text-[12.5px]">
                <b className="text-[13px] text-ink">What it cost</b>
                <Row label="Parts used" value={cost(a.component_cost, currency)} />
                <Row label="Labour" value={cost(a.labour_cost, currency)} />
                <Row label="Overhead" value={cost(a.overhead_cost, currency)} />
                <Row label="Each one made" value={cost(a.unit_cost, currency)} strong />
                <span className="text-[11.5px] text-ink-3">From the stock the parts actually came out of. Scrapped units' share is carried by the ones that were made.</span>
              </section>
            ) : null}
            {acts?.complete ? (
              <section aria-label="Record a run" className="flex flex-col gap-2 rounded-[10px] border border-line px-3 py-2.5">
                <b className="text-[13px] text-ink">Record a run</b>
                <div className="grid grid-cols-2 gap-2.5">
                  <Field label="Good units made" hint={`Blank: the rest, ${qty(Math.max(0, left - (Number(run.scrapped) || 0)))}`}>
                    <input className={input + ' text-right tabular-nums'} value={run.made} onChange={(e) => setRun({ ...run, made: e.target.value })} aria-label="Good units made" inputMode="decimal" placeholder={qty(left)} />
                  </Field>
                  <Field label="Scrapped">
                    <input className={input + ' text-right tabular-nums'} value={run.scrapped} onChange={(e) => setRun({ ...run, scrapped: e.target.value })} aria-label="Scrapped" inputMode="decimal" placeholder="0" />
                  </Field>
                </div>
                {tracking === 'batch' ? (
                  <div className="grid grid-cols-2 gap-2.5">
                    <Field label="Batch made">
                      <input className={input} value={run.batch} onChange={(e) => setRun({ ...run, batch: e.target.value })} aria-label="Batch made" placeholder={a.batch_no ?? ''} />
                    </Field>
                    <Field label="Expires">
                      <input type="date" className={input} value={run.expiry} onChange={(e) => setRun({ ...run, expiry: e.target.value })} aria-label="Expires" />
                    </Field>
                  </div>
                ) : null}
                {tracking === 'serial' ? (
                  <Field label="Serials made" hint="One per unit — a line each, or separated by commas">
                    <textarea className={input + ' !h-[70px] py-1.5'} value={run.serials} onChange={(e) => setRun({ ...run, serials: e.target.value })} aria-label="Serials made" />
                  </Field>
                ) : null}
                {error ? (
                  <span role="alert" className="rounded-[8px] bg-danger-bg px-3 py-2 text-[12.5px] font-semibold text-danger">
                    {error}
                  </span>
                ) : null}
                <button
                  type="button"
                  className={btnPrimary + ' self-start'}
                  disabled={busy}
                  onClick={() => {
                    const { error: bad } = runBody(run, tracking, left);
                    setError(bad);
                    if (!bad) setConfirm('complete');
                  }}
                >
                  Record the run…
                </button>
              </section>
            ) : null}
            {acts ? (
              <div className="flex flex-wrap gap-2">
                {acts.release ? (
                  <button
                    type="button"
                    className={btnPrimary + ' !h-[30px] !text-[12.5px]'}
                    disabled={busy}
                    onClick={() =>
                      void act(
                        (r) => ((r as { short?: string[] })?.short?.length ? `Released, but short of ${(r as { short: string[] }).short.join('; ')}` : 'Released — the parts are reserved'),
                        () => jobAct(id, 'release'),
                      )
                    }
                  >
                    Release — reserve the parts
                  </button>
                ) : null}
                {acts.cancel ? (
                  <button type="button" className={btnSmall} disabled={busy} onClick={() => setConfirm('cancel')}>
                    Cancel job
                  </button>
                ) : null}
                {acts.remove ? (
                  <button type="button" className={btnSmall + ' ml-auto text-danger'} disabled={busy} onClick={() => setConfirm('remove')}>
                    Delete
                  </button>
                ) : null}
              </div>
            ) : null}
          </>
        ) : null}
      </SidePanel>
      {confirm && a ? (
        <Sheet
          title={confirm === 'complete' ? `Record a run on ${a.reference}?` : confirm === 'cancel' ? `Cancel ${a.reference}?` : `Delete ${a.reference}?`}
          width={440}
          onClose={() => setConfirm(null)}
          footer={
            <>
              <button type="button" className={btn} onClick={() => setConfirm(null)}>
                {confirm === 'complete' ? 'Not yet' : 'Keep it'}
              </button>
              <button
                type="button"
                className={btnPrimary}
                disabled={busy}
                onClick={() => (confirm === 'complete' ? complete() : confirm === 'cancel' ? void act('Job cancelled — the parts are free again', () => jobAct(id, 'cancel')) : void act('Job removed', () => deleteJob(id), onClose))}
              >
                {confirm === 'complete' ? 'Record the run' : confirm === 'cancel' ? 'Cancel the job' : 'Delete'}
              </button>
            </>
          }
        >
          <span className="text-[13px] text-ink-2">
            {confirm === 'complete'
              ? 'The parts for this run are taken out of stock and the goods made are put on the shelf, at what the parts, labour and overhead cost. It cannot be undone here.'
              : confirm === 'cancel'
                ? 'Cancelling frees any parts this job had reserved. Nothing has been made on it.'
                : 'It is removed from the list, and any parts it had reserved are freed.'}
          </span>
        </Sheet>
      ) : null}
    </>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={cx('flex justify-between gap-3', strong ? 'border-t border-line/60 pt-1 font-bold text-ink' : 'text-ink-2')}>
      <span>{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  );
}

function Boms({ org, openId, onOpen }: { org: string; openId: number | null; onOpen: (id: number) => void }) {
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  const list = useQuery({ queryKey: KM.boms(org, { status, q }), queryFn: ({ signal }) => fetchBoms(org, { status, q }, signal), placeholderData: keepPreviousData });
  const rows = list.data ?? [];
  const W = { name: 190, ver: 70, st: 90, yld: 96, parts: 90 };
  return (
    <>
      <div className="flex items-center gap-2">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Product, code or recipe…" aria-label="Search recipes" className={input + ' !w-[240px]'} />
        <Select aria-label="Recipe status" value={status} onValueChange={setStatus} options={BOM_STATUSES} className={pick + ' !w-[160px]'} />
        <span className="ml-auto text-[12.5px] text-ink-3">{list.isLoading ? '' : `${rows.length.toLocaleString()} ${rows.length === 1 ? 'recipe' : 'recipes'}`}</span>
      </div>
      <Frame
        min={minWidth(160, Object.values(W))}
        head={
          <>
            <span className="min-w-0 flex-1">Makes</span>
            <span style={{ width: W.name }}>Recipe</span>
            <span style={{ width: W.ver }}>Version</span>
            <span style={{ width: W.st }}>Status</span>
            <span className="text-right" style={{ width: W.yld }}>
              One run
            </span>
            <span className="text-right" style={{ width: W.parts }}>
              Parts
            </span>
          </>
        }
      >
        {list.isLoading ? (
          <Spinner />
        ) : list.error ? (
          <ErrorNote error={list.error} onRetry={() => void list.refetch()} />
        ) : rows.length ? (
          rows.map((b) => (
            <button key={b.id} type="button" data-bom={b.id} onClick={() => onOpen(Number(b.id))} className={cx(rowCls, openId === Number(b.id) && 'bg-[#F4F6FE] dark:bg-selection/40')}>
              <span className="flex min-w-0 flex-1 flex-col">
                <b className="truncate text-ink">{b.product_name}</b>
                {b.code ? <span className="truncate text-[11px] text-ink-3">{b.code}</span> : null}
              </span>
              <span className="flex shrink-0 items-center gap-1.5 truncate text-ink" style={{ width: W.name }}>
                <span className="truncate">{b.name ?? '—'}</span>
                {Number(b.is_default) ? <Pill tone="blue">default</Pill> : null}
              </span>
              <span className="shrink-0 text-ink-2" style={{ width: W.ver }}>
                {b.version}
              </span>
              <span className="shrink-0" style={{ width: W.st }}>
                <Pill tone={bomTone(b.status)}>{BOM_LABEL[b.status] ?? b.status}</Pill>
              </span>
              <span className="shrink-0 text-right text-ink tabular-nums" style={{ width: W.yld }}>
                {qty(num(b.output_qty) ?? 0)}
                {b.unit ? ` ${b.unit}` : ''}
              </span>
              <span className="shrink-0 text-right text-ink-2 tabular-nums" style={{ width: W.parts }}>
                {num(b.line_count) ?? 0}
              </span>
            </button>
          ))
        ) : (
          <Empty text={q || status ? 'No recipes match that.' : 'No recipes yet. A recipe says what one run of a product uses.'} />
        )}
      </Frame>
    </>
  );
}

function BomPanel({ id, currency, canCost, canMake, onClose, onEdit, onBuild }: { id: number; currency: string | null; canCost: boolean; canMake: boolean; onClose: () => void; onEdit: () => void; onBuild: (() => void) | null }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: KM.bom(id), queryFn: ({ signal }) => fetchBom(id, signal) });
  const est = useQuery({ queryKey: KM.bomCost(id), queryFn: ({ signal }) => fetchBomCost(id, signal), enabled: canCost && !!q.data?.lines.length });
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const b = q.data?.bom;

  const act = async (label: string, fn: () => Promise<unknown>, after?: () => void) => {
    setBusy(true);
    try {
      await fn();
      toast('success', label);
      void qc.invalidateQueries({ queryKey: ['inventory'] });
      after?.();
    } catch (e) {
      toast('error', errorMessage(e));
    } finally {
      setBusy(false);
      setConfirm(false);
    }
  };

  return (
    <>
      <SidePanel
        label={b ? `Recipe for ${b.product_name}` : 'Recipe'}
        width={620}
        onClose={onClose}
        head={
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="flex items-center gap-2">
              <b className="truncate text-[15px] text-ink">{b?.name ?? b?.product_name ?? 'Recipe'}</b>
              {b ? <Pill tone={bomTone(b.status)}>{BOM_LABEL[b.status] ?? b.status}</Pill> : null}
              {b && Number(b.is_default) ? <Pill tone="blue">default</Pill> : null}
            </span>
            {b ? (
              <span className="truncate text-[12.5px] text-ink-3">
                One run makes {qty(num(b.output_qty) ?? 0)}
                {b.unit ? ` ${b.unit}` : ''} of {b.product_name} · version {b.version}
              </span>
            ) : null}
          </span>
        }
      >
        {q.isLoading ? (
          <Spinner />
        ) : q.error ? (
          <ErrorNote error={q.error} onRetry={() => void q.refetch()} />
        ) : b && q.data ? (
          <>
            <div className="overflow-hidden rounded-[10px] border border-line">
              <div className="flex gap-2 border-b border-line bg-ground px-3 py-1.5 text-[11px] font-bold tracking-[.4px] text-ink-3 uppercase">
                <span className="min-w-0 flex-1">Part</span>
                <span className="w-[80px] text-right">Per run</span>
                <span className="w-[62px] text-right">Waste</span>
                <span className="w-[80px] text-right">Needed</span>
                {canCost ? <span className="w-[80px] text-right">Unit cost</span> : null}
              </div>
              {q.data.lines.length ? (
                q.data.lines.map((l) => {
                  const per = num(l.quantity) ?? 0;
                  const waste = num(l.wastage_pct) ?? 0;
                  return (
                    <div key={l.id} className="flex items-center gap-2 border-b border-line/60 px-3 py-1.5 text-[12.5px] last:border-b-0">
                      <span className="flex min-w-0 flex-1 flex-col">
                        <b className="truncate text-ink">{l.component_name}</b>
                        <span className="truncate text-[11px] text-ink-3">{[l.code, Number(l.has_bom) > 0 ? 'made here too' : null].filter(Boolean).join(' · ')}</span>
                      </span>
                      <span className="w-[80px] text-right text-ink tabular-nums">
                        {qty(per)}
                        {(l.unit ?? l.product_unit) ? ` ${l.unit ?? l.product_unit}` : ''}
                      </span>
                      <span className="w-[62px] text-right text-ink-2 tabular-nums">{waste > 0 ? `${qty(waste)}%` : '—'}</span>
                      <b className="w-[80px] text-right text-ink tabular-nums">{qty(needed(per, waste))}</b>
                      {canCost ? <span className="w-[80px] text-right text-ink-2 tabular-nums">{cost(num(l.average_cost) ? l.average_cost : l.cost_price)}</span> : null}
                    </div>
                  );
                })
              ) : (
                <span className="block px-3 py-2 text-[12.5px] text-ink-3">No parts yet. Edit the recipe to add them.</span>
              )}
            </div>
            <span className="text-[11.5px] text-ink-3">Waste divides: to finish with 100 good at 5% waste, you start with 105.26, not 105.</span>
            {canCost && est.data ? (
              <section data-bom-estimate className="flex flex-col gap-1 rounded-[10px] border border-line px-3 py-2.5 text-[12.5px]">
                <b className="text-[13px] text-ink">Estimated cost of one run</b>
                <Row label="Parts" value={cost(est.data.component_cost, currency)} />
                <Row label="Labour" value={cost(est.data.labour_cost, currency)} />
                <Row label="Overhead" value={cost(est.data.overhead_cost, currency)} />
                <Row label="Each one" value={cost(est.data.unit_cost, currency)} strong />
                <span className="text-[11.5px] text-ink-3">{est.data.basis}</span>
              </section>
            ) : canCost && est.error ? (
              <ErrorNote error={est.error} onRetry={() => void est.refetch()} />
            ) : null}
            {b.notes ? <span className="text-[12.5px] whitespace-pre-line text-ink-2">{b.notes}</span> : null}
            {canMake ? (
              <div className="flex flex-wrap gap-2">
                <button type="button" className={btnSmall} disabled={busy} onClick={onEdit}>
                  Edit
                </button>
                {b.status !== 'active' ? (
                  <button type="button" className={btnPrimary + ' !h-[30px] !text-[12.5px]'} disabled={busy} onClick={() => void act('This is now the recipe used', () => saveBom(id, { status: 'active', is_default: true }))}>
                    Make it the recipe used
                  </button>
                ) : (
                  <>
                    {onBuild ? (
                      <button type="button" className={btnPrimary + ' !h-[30px] !text-[12.5px]'} disabled={busy} onClick={onBuild}>
                        Start a job
                      </button>
                    ) : null}
                    <button type="button" className={btnSmall} disabled={busy} onClick={() => void act('Recipe archived', () => saveBom(id, { status: 'archived', is_default: false }))}>
                      Archive
                    </button>
                  </>
                )}
                <button type="button" className={btnSmall + ' ml-auto text-danger'} disabled={busy} onClick={() => setConfirm(true)}>
                  Delete
                </button>
              </div>
            ) : null}
          </>
        ) : null}
      </SidePanel>
      {confirm && b ? (
        <Sheet
          title={`Delete this recipe for ${b.product_name}?`}
          width={440}
          onClose={() => setConfirm(false)}
          footer={
            <>
              <button type="button" className={btn} onClick={() => setConfirm(false)}>
                Keep it
              </button>
              <button type="button" className={btnPrimary} disabled={busy} onClick={() => void act('Recipe removed', () => deleteBom(id), onClose)}>
                Delete
              </button>
            </>
          }
        >
          <span className="text-[13px] text-ink-2">A recipe that jobs were built from can't be deleted — archive it instead, and those jobs keep their parts lists.</span>
        </Sheet>
      ) : null}
    </>
  );
}

// ── forms ───────────────────────────────────────────────────────────────

export function JobSheet({ org, warehouses, defaultWarehouse, bom, onClose, onSaved }: { org: string; warehouses: Warehouse[]; defaultWarehouse?: number | null; bom?: number | null; onClose: () => void; onSaved: (id: number) => void }) {
  const qc = useQueryClient();
  const recipes = useQuery({ queryKey: KM.boms(org, { status: 'active', q: '' }), queryFn: ({ signal }) => fetchBoms(org, { status: 'active', q: '' }, signal) });
  const [d, setD] = useState<NewJobDraft>({ bom: bom ?? null, warehouse: defaultWarehouse ?? null, quantity: '', plannedFor: '', notes: '' });
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const chosen = (recipes.data ?? []).find((b) => Number(b.id) === d.bom);

  const save = async () => {
    setError(null);
    const { body, error: bad } = jobBody(d);
    if (bad) return setError(bad);
    setSaving(true);
    try {
      const r = await createJob(org, body);
      void qc.invalidateQueries({ queryKey: ['inventory'] });
      toast('success', 'Draft job created — release it to reserve the parts');
      onSaved(Number(r.id));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Sheet
      title="New job"
      width={560}
      onClose={onClose}
      footer={
        <>
          <button type="button" className={btn} onClick={onClose}>
            Cancel
          </button>
          <button type="button" className={btnPrimary} disabled={saving} onClick={() => void save()}>
            {saving ? 'Creating…' : 'Create'}
          </button>
        </>
      }
    >
      <div role="form" aria-label="New job" className="flex flex-col gap-2.5">
        <Field label="Recipe" hint="Only active recipes are built">
          <Select<string>
            aria-label="Recipe"
            searchable
            value={d.bom ? String(d.bom) : ''}
            placeholder={recipes.isLoading ? 'Loading…' : 'Choose a recipe'}
            options={(recipes.data ?? []).map((b) => ({ value: String(b.id), label: b.product_name, hint: [b.name, `v${b.version}`, b.code].filter(Boolean).join(' · ') }))}
            onValueChange={(v) => setD({ ...d, bom: v ? Number(v) : null })}
            empty={recipes.error ? errorMessage(recipes.error) : 'No active recipe yet.'}
            className={pick}
          />
        </Field>
        {chosen ? (
          <span className="text-[12.5px] text-ink-2">
            One run makes {qty(num(chosen.output_qty) ?? 0)}
            {chosen.unit ? ` ${chosen.unit}` : ''} of {chosen.product_name}, from {num(chosen.line_count) ?? 0} {num(chosen.line_count) === 1 ? 'part' : 'parts'}.
          </span>
        ) : null}
        <div className="grid grid-cols-3 gap-2.5">
          <Field label="Made at" className="col-span-2">
            <WarehousePick warehouses={warehouses} value={d.warehouse} onChange={(w) => setD({ ...d, warehouse: w })} label="Made at" />
          </Field>
          <Field label="How many">
            <input className={input + ' text-right tabular-nums'} value={d.quantity} onChange={(e) => setD({ ...d, quantity: e.target.value })} aria-label="How many" inputMode="decimal" />
          </Field>
        </div>
        <div className="grid grid-cols-3 gap-2.5">
          <Field label="Planned for">
            <input type="date" className={input} value={d.plannedFor} onChange={(e) => setD({ ...d, plannedFor: e.target.value })} aria-label="Planned for" />
          </Field>
          <Field label="Notes" className="col-span-2">
            <input className={input} value={d.notes} onChange={(e) => setD({ ...d, notes: e.target.value })} aria-label="Notes" />
          </Field>
        </div>
        {error ? (
          <span role="alert" className="rounded-[8px] bg-danger-bg px-3 py-2 text-[12.5px] font-semibold text-danger">
            {error}
          </span>
        ) : null}
      </div>
    </Sheet>
  );
}

export function BomSheet({ org, id, canCost, onClose, onSaved }: { org: string; id: number | null; canCost: boolean; onClose: () => void; onSaved: (id: number) => void }) {
  const existing = useQuery({ queryKey: KM.bom(id ?? 0), queryFn: ({ signal }) => fetchBom(id!, signal), enabled: !!id });
  if (id && existing.isLoading) {
    return (
      <Sheet title="Edit recipe" width={720} onClose={onClose} footer={null}>
        <Spinner />
      </Sheet>
    );
  }
  const d = existing.data;
  const initial: BomDraft = d
    ? {
        product: { id: Number(d.bom.product_id), code: d.bom.code, name: d.bom.product_name },
        name: d.bom.name ?? '',
        version: d.bom.version ?? '1',
        output: String(num(d.bom.output_qty) ?? 1),
        labour: num(d.bom.labour_cost) ? String(num(d.bom.labour_cost)) : '',
        overhead: num(d.bom.overhead_cost) ? String(num(d.bom.overhead_cost)) : '',
        notes: d.bom.notes ?? '',
        lines: d.lines.map((l, i) => ({ key: i, component: { id: Number(l.component_id), code: l.code, name: l.component_name }, qty: String(num(l.quantity) ?? ''), waste: num(l.wastage_pct) ? String(num(l.wastage_pct)) : '' })),
      }
    : { product: null, name: '', version: '1', output: '1', labour: '', overhead: '', notes: '', lines: [{ key: 0, component: null, qty: '', waste: '' }] };
  return <BomForm org={org} id={id} initial={initial} canCost={canCost} onClose={onClose} onSaved={onSaved} />;
}

function BomForm({ org, id, initial, canCost, onClose, onSaved }: { org: string; id: number | null; initial: BomDraft; canCost: boolean; onClose: () => void; onSaved: (id: number) => void }) {
  const qc = useQueryClient();
  const [d, setD] = useState<BomDraft>(initial);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const setLine = (key: number, patch: Partial<BomLineDraft>) => setD((x) => ({ ...x, lines: x.lines.map((l) => (l.key === key ? { ...l, ...patch } : l)) }));
  const asPick = (p: { id: number; code: string | null; name: string } | null) =>
    p ? { id: p.id, code: p.code, barcode: null, name: p.name, variant_label: null, unit: null, tracking: 'none' as const, is_stocked: 1, on_hand: 0, reserved: 0 } : null;

  const save = async () => {
    setError(null);
    const { body, error: bad } = bomBody(d, canCost);
    if (bad) return setError(bad);
    setSaving(true);
    try {
      const r = (await saveBom(id, body)) as { id?: number } | undefined;
      void qc.invalidateQueries({ queryKey: ['inventory'] });
      toast('success', id ? 'Recipe saved' : 'Draft recipe created — make it the recipe used when it is right');
      onSaved(Number(id ?? r?.id));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Sheet
      title={id ? `Edit the recipe for ${initial.product?.name ?? 'this product'}` : 'New recipe'}
      width={740}
      onClose={onClose}
      footer={
        <>
          <button type="button" className={btn} onClick={onClose}>
            Cancel
          </button>
          <button type="button" className={btnPrimary} disabled={saving} onClick={() => void save()}>
            {saving ? 'Saving…' : id ? 'Save' : 'Create'}
          </button>
        </>
      }
    >
      <div role="form" aria-label={id ? 'Edit recipe' : 'New recipe'} className="flex flex-col gap-2.5">
        <div className="grid grid-cols-3 gap-2.5">
          <Field label="What it makes" className="col-span-2">
            {id ? (
              <span className="flex h-[34px] items-center truncate text-[13px] font-semibold text-ink">{initial.product?.name}</span>
            ) : (
              <ProductPick org={org} warehouse={null} value={asPick(d.product)} onChange={(p) => setD({ ...d, product: p ? { id: p.id, code: p.code, name: p.name } : null })} label="What it makes" />
            )}
          </Field>
          <Field label="One run makes">
            <input className={input + ' text-right tabular-nums'} value={d.output} onChange={(e) => setD({ ...d, output: e.target.value })} aria-label="One run makes" inputMode="decimal" />
          </Field>
        </div>
        <div className={cx('grid gap-2.5', canCost ? 'grid-cols-4' : 'grid-cols-2')}>
          <Field label="Recipe name">
            <input className={input} value={d.name} onChange={(e) => setD({ ...d, name: e.target.value })} aria-label="Recipe name" maxLength={190} />
          </Field>
          <Field label="Version">
            <input className={input} value={d.version} onChange={(e) => setD({ ...d, version: e.target.value })} aria-label="Version" maxLength={20} />
          </Field>
          {canCost ? (
            <>
              <Field label="Labour per run">
                <input className={input + ' text-right tabular-nums'} value={d.labour} onChange={(e) => setD({ ...d, labour: e.target.value })} aria-label="Labour per run" inputMode="decimal" placeholder="0.00" />
              </Field>
              <Field label="Overhead per run">
                <input className={input + ' text-right tabular-nums'} value={d.overhead} onChange={(e) => setD({ ...d, overhead: e.target.value })} aria-label="Overhead per run" inputMode="decimal" placeholder="0.00" />
              </Field>
            </>
          ) : null}
        </div>
        <b className="mt-1 text-[13px] text-ink">Parts one run uses</b>
        <div className="flex flex-col gap-2">
          {d.lines.map((l, i) => (
            <div key={l.key} className="flex items-center gap-2">
              <span className="min-w-0 flex-1">
                <ProductPick org={org} warehouse={null} noSerial value={asPick(l.component)} onChange={(p) => setLine(l.key, { component: p ? { id: p.id, code: p.code, name: p.name } : null })} label={`Part ${i + 1}`} />
              </span>
              <input className={input + ' !w-[90px] text-right tabular-nums'} value={l.qty} onChange={(e) => setLine(l.key, { qty: e.target.value })} placeholder="Qty" aria-label={`Part ${i + 1} quantity`} inputMode="decimal" />
              <input className={input + ' !w-[80px] text-right tabular-nums'} value={l.waste} onChange={(e) => setLine(l.key, { waste: e.target.value })} placeholder="Waste %" aria-label={`Part ${i + 1} waste`} inputMode="decimal" />
              <button
                type="button"
                aria-label={`Remove part ${i + 1}`}
                onClick={() => setD((x) => ({ ...x, lines: x.lines.length > 1 ? x.lines.filter((y) => y.key !== l.key) : [{ key: l.key + 1, component: null, qty: '', waste: '' }] }))}
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[6px] text-ink-3 hover:bg-subtle hover:text-ink"
              >
                <Icon name="x" size={14} />
              </button>
            </div>
          ))}
          <button
            type="button"
            className="self-start text-[12.5px] font-semibold text-primary hover:underline"
            onClick={() => setD((x) => ({ ...x, lines: [...x.lines, { key: Math.max(...x.lines.map((y) => y.key)) + 1, component: null, qty: '', waste: '' }] }))}
          >
            + Add a part
          </button>
        </div>
        <span className="text-[12.5px] text-ink-3">Serialised parts are left out: a run uses parts by quantity. {canCost ? '' : 'Labour and overhead are set by people who can see costs.'}</span>
        <Field label="Notes">
          <input className={input} value={d.notes} onChange={(e) => setD({ ...d, notes: e.target.value })} aria-label="Notes" />
        </Field>
        {error ? (
          <span role="alert" className="rounded-[8px] bg-danger-bg px-3 py-2 text-[12.5px] font-semibold text-danger">
            {error}
          </span>
        ) : null}
      </div>
    </Sheet>
  );
}
