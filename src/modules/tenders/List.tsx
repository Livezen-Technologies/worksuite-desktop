import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { errorMessage } from '../../core/bridge';
import { dateLabel, timeLabel } from '../../core/time';
import { toast } from '../../core/toasts';
import { Icon } from '../../components/Icon';
import { Select } from '../../components/Select';
import { ErrorNote, Spinner, cx } from '../../components/ui';
import { btn, btnPrimary, btnSmall, Empty, Field, input, PageHead, Sheet } from '../hr/parts';
import { bulkTenders, fetchList, K, moneyList, money, NOT_IN_BULK, PER_PAGE, presetOf, PRIORITIES, SORTS, STAGE_GROUPS, useOwners, VIEWS, type Band, type BulkAction, type Filters, type ListView, type StageDef, type TenderRow } from './api';
import { Left, OutcomePill, PriorityPill, Score, StagePill } from './parts';
import { Checkbox } from '../../components/Checkbox';

/**
 * A tender list: one of the rail's presets, with its filters on screen to be
 * changed. Changing the rail item starts from that preset again rather than
 * carrying a search across — somebody on "Won" with a leftover search would
 * see nothing and no reason why. The footer counts the whole filtered set by
 * stage and its published ceilings per currency, not just this page.
 *
 * Following and unfollowing a selection needs only `tender.view`; the other
 * bulk acts need `tender.manage`. A stage move for a selection goes through
 * the same rules as one bid, and each refusal is named.
 */
type Bulk = { action: BulkAction; ids: number[] };

const CLOSING: Array<[string, string]> = [
  ['', 'Any closing date'],
  ['7', 'Closing in 7 days'],
  ['14', 'Closing in 14 days'],
  ['30', 'Closing in 30 days'],
  ['overdue', 'Closed, still open'],
];

export default function List({ view, org, stages, bands, canManage, onOpen }: { view: ListView; org: string; stages: StageDef[]; bands: Band[] | undefined; canManage: boolean; onOpen: (id: number) => void }) {
  const qc = useQueryClient();
  const [f, setF] = useState<Filters>(() => presetOf(view));
  const [chosen, setChosen] = useState<number[]>([]);
  const [bulk, setBulk] = useState<Bulk | null>(null);
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const owners = useOwners(org);
  const list = useQuery({ queryKey: K.list(org, f), queryFn: ({ signal }) => fetchList(org, f, signal), placeholderData: keepPreviousData });
  const rows = list.data?.items ?? [];
  const total = list.data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / PER_PAGE));
  const set = (patch: Partial<Filters>) => {
    setF((x) => ({ ...x, ...patch, page: patch.page ?? 1 }));
    if (patch.page === undefined) setChosen([]);
  };
  const toggle = (id: number) => setChosen((c) => (c.includes(id) ? c.filter((x) => x !== id) : [...c, id]));
  const allOnPage = rows.length > 0 && rows.every((r) => chosen.includes(r.id));
  const preset = presetOf(view);
  const narrowed = JSON.stringify({ ...f, page: 1 }) !== JSON.stringify(preset);
  const stageOptions = [
    { value: '', label: 'Any stage' },
    ...STAGE_GROUPS.map((g) => ({ value: g.value, label: g.label })),
    ...(f.stage && !stages.some((s) => s.key === f.stage) && !STAGE_GROUPS.some((g) => g.value === f.stage) ? [{ value: f.stage, label: f.stage }] : []),
    ...stages.map((s) => ({ value: s.key, label: s.label })),
  ];
  const movable = stages.filter((s) => !NOT_IN_BULK.includes(s.key));

  const run = async (extra: { owner_id?: number | null; priority?: string; stage?: string } = {}, b: Bulk | null = bulk) => {
    if (!b) return;
    setBusy(true);
    try {
      const r = await bulkTenders(org, b.action, b.ids, extra);
      const did = r.done.length;
      const word = { follow: 'now followed', unfollow: 'no longer followed', owner: 'reassigned', priority: 'reprioritised', stage: 'moved', delete: 'removed' }[b.action];
      if (did) toast('success', `${did} ${did === 1 ? 'tender' : 'tenders'} ${word}.`);
      for (const x of r.failed.slice(0, 4)) toast('error', `${x.reference ?? `#${x.id}`}: ${x.why}`);
      if (r.failed.length > 4) toast('error', `${r.failed.length - 4} more could not be ${word}.`);
      setBulk(null);
      setValue('');
      setChosen([]);
      void qc.invalidateQueries({ queryKey: K.all });
    } catch (e) {
      toast('error', errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-3 px-6 py-5">
      <PageHead title={VIEWS[view].title} sub={VIEWS[view].blurb}>
        {list.data?.summary.ceiling_by_currency.length ? (
          <span className="mr-1.5 flex flex-col items-end">
            <span className="text-[11.5px] text-ink-3">Published ceilings</span>
            <b className="text-ink tabular-nums">{moneyList(list.data.summary.ceiling_by_currency)}</b>
          </span>
        ) : null}
      </PageHead>
      <div className="flex flex-wrap items-center gap-2">
        <input value={f.q} onChange={(e) => set({ q: e.target.value })} placeholder="Search title, number, buyer" aria-label="Search tenders" className={input + ' !w-[220px]'} />
        <Select<string> aria-label="Stage" value={f.stage} onValueChange={(v) => set({ stage: v })} options={stageOptions} className={input + ' !w-[170px]'} />
        <Select<string>
          aria-label="Outcome"
          value={f.outcome}
          onValueChange={(v) => set({ outcome: v })}
          options={[
            { value: '', label: 'Open or decided' },
            { value: 'open', label: 'Open' },
            { value: 'won', label: 'Won' },
            { value: 'lost', label: 'Lost' },
            { value: 'cancelled', label: 'Cancelled' },
          ]}
          className={input + ' !w-[140px]'}
        />
        <Select<string>
          aria-label="Owner"
          searchable
          value={f.owner}
          onValueChange={(v) => set({ owner: v })}
          options={[{ value: '', label: 'Anyone' }, { value: 'none', label: 'Nobody yet' }, ...(owners.data ?? []).map((o) => ({ value: String(o.id), label: o.name, hint: o.holds ? undefined : 'no longer here' }))]}
          className={input + ' !w-[150px]'}
        />
        <Select<string>
          aria-label="Priority"
          value={f.priority}
          onValueChange={(v) => set({ priority: v })}
          options={[{ value: '', label: 'Any priority' }, ...PRIORITIES.map((p) => ({ value: p, label: p[0]!.toUpperCase() + p.slice(1) }))]}
          className={input + ' !w-[124px]'}
        />
        <Select<string> aria-label="Closing" value={f.closing} onValueChange={(v) => set({ closing: v })} options={CLOSING.map(([value, label]) => ({ value, label }))} className={input + ' !w-[160px]'} />
        <label className="flex items-center gap-1.5 font-semibold text-ink">
          <Checkbox checked={f.following} onChange={(e) => set({ following: e.target.checked })} />
          Following
        </label>
        <label className="flex items-center gap-1.5 font-semibold text-ink">
          <Checkbox checked={f.unscored} onChange={(e) => set({ unscored: e.target.checked })} />
          Not scored
        </label>
        <Select<string> aria-label="Sort" value={f.sort} onValueChange={(v) => set({ sort: v })} options={SORTS.map(([value, label]) => ({ value, label: `Sort: ${label}` }))} className={input + ' !w-[170px]'} />
        <button
          type="button"
          className={btn + ' !w-[34px] justify-center !px-0'}
          aria-label={f.dir === 'desc' ? 'Descending — show ascending' : 'Ascending — show descending'}
          title={f.dir === 'desc' ? 'Descending' : 'Ascending'}
          onClick={() => set({ dir: f.dir === 'desc' ? 'asc' : 'desc' })}
        >
          <Icon name={f.dir === 'desc' ? 'arrow-down' : 'arrow-up'} size={15} />
        </button>
        {narrowed ? (
          <button type="button" className="text-[12.5px] font-semibold text-primary hover:underline" onClick={() => (setF(preset), setChosen([]))}>
            Back to {VIEWS[view].title}
          </button>
        ) : null}
      </div>
      {list.data?.summary.by_stage.length ? (
        <div className="flex flex-wrap gap-3 text-[12px] text-ink-2" aria-label="By stage">
          {list.data.summary.by_stage.map((s) => (
            <button key={s.stage} type="button" onClick={() => set({ stage: s.stage })} className={cx('hover:underline', f.stage === s.stage && 'font-bold')}>
              {s.label}: <b className="tabular-nums">{s.count}</b>
            </button>
          ))}
        </div>
      ) : null}
      {chosen.length ? (
        <div className="flex flex-wrap items-center gap-2 self-start rounded-[9px] border border-info-line bg-selection px-2.5 py-1.5 dark:border-primary/40 dark:bg-selection">
          <b className="text-[12.5px] text-primary">{chosen.length} selected</b>
          <button type="button" className={btnSmall + ' !h-7'} disabled={busy} onClick={() => void run({}, { action: 'follow', ids: chosen })}>
            Follow
          </button>
          <button type="button" className={btnSmall + ' !h-7'} disabled={busy} onClick={() => void run({}, { action: 'unfollow', ids: chosen })}>
            Stop following
          </button>
          {canManage ? (
            <>
              <button type="button" className={btnSmall + ' !h-7'} onClick={() => (setValue(''), setBulk({ action: 'owner', ids: chosen }))}>
                Owner…
              </button>
              <button type="button" className={btnSmall + ' !h-7'} onClick={() => (setValue('normal'), setBulk({ action: 'priority', ids: chosen }))}>
                Priority…
              </button>
              <button type="button" className={btnSmall + ' !h-7'} onClick={() => (setValue(''), setBulk({ action: 'stage', ids: chosen }))}>
                Move…
              </button>
              <button type="button" className={btnSmall + ' !h-7 !text-danger'} onClick={() => setBulk({ action: 'delete', ids: chosen })}>
                Remove
              </button>
            </>
          ) : null}
          <button type="button" className="text-[12px] font-semibold text-primary hover:underline" onClick={() => setChosen([])}>
            Clear the selection
          </button>
        </div>
      ) : null}
      {list.isLoading ? (
        <Spinner />
      ) : list.error ? (
        <ErrorNote error={list.error} onRetry={() => void list.refetch()} />
      ) : (
        <div className="overflow-hidden rounded-[12px] border border-line bg-surface">
          <div className="flex items-center gap-2.5 border-b border-line bg-ground px-3.5 py-2 text-[11px] font-bold tracking-[.4px] text-ink-3 uppercase">
            <Checkbox
              aria-label="Choose every tender on this page"
              checked={allOnPage}
              indeterminate={!allOnPage && rows.some((r) => chosen.includes(r.id))}
              onChange={() => setChosen(allOnPage ? chosen.filter((c) => !rows.some((r) => r.id === c)) : [...new Set([...chosen, ...rows.map((r) => r.id)])])}
            />
            <span className="min-w-0 flex-1">Tender</span>
            <span className="w-[140px] shrink-0">Stage</span>
            <span className="w-[56px] shrink-0">Score</span>
            <span className="w-[120px] shrink-0">Owner</span>
            <span className="w-[128px] shrink-0">Closing</span>
            <span className="w-[150px] shrink-0 text-right">Budget</span>
          </div>
          {rows.length ? (
            rows.map((r) => <Row key={r.id} r={r} bands={bands} chosen={chosen.includes(r.id)} onChoose={() => toggle(r.id)} onOpen={() => onOpen(r.id)} />)
          ) : (
            <Empty text={narrowed ? 'No tender matches those filters.' : 'Nothing here yet.'} />
          )}
        </div>
      )}
      {pages > 1 ? (
        <div className="flex items-center justify-center gap-2.5">
          <button type="button" className={btn} disabled={f.page <= 1} onClick={() => set({ page: f.page - 1 })}>
            Previous
          </button>
          <span className="text-[12.5px] text-ink-2 tabular-nums">
            Page {f.page} of {pages} · {total.toLocaleString()} tenders
          </span>
          <button type="button" className={btn} disabled={f.page >= pages} onClick={() => set({ page: f.page + 1 })}>
            Next
          </button>
        </div>
      ) : null}

      {bulk ? (
        <Sheet
          title={
            bulk.action === 'owner'
              ? `Give ${bulk.ids.length} ${bulk.ids.length === 1 ? 'tender' : 'tenders'} an owner`
              : bulk.action === 'priority'
                ? `Set the priority of ${bulk.ids.length}`
                : bulk.action === 'stage'
                  ? `Move ${bulk.ids.length} ${bulk.ids.length === 1 ? 'tender' : 'tenders'}`
                  : `Remove ${bulk.ids.length} ${bulk.ids.length === 1 ? 'tender' : 'tenders'}?`
          }
          width={440}
          onClose={() => setBulk(null)}
          footer={
            <>
              <button type="button" className={btn} onClick={() => setBulk(null)}>
                Cancel
              </button>
              <button
                type="button"
                className={btnPrimary + (bulk.action === 'delete' ? ' !bg-danger hover:!opacity-90' : '')}
                disabled={busy || (bulk.action === 'stage' && !value)}
                onClick={() => void run(bulk.action === 'owner' ? { owner_id: value ? Number(value) : null } : bulk.action === 'priority' ? { priority: value } : bulk.action === 'stage' ? { stage: value } : {})}
              >
                {busy ? 'Working…' : bulk.action === 'delete' ? 'Remove them' : bulk.action === 'stage' ? 'Move' : 'Save'}
              </button>
            </>
          }
        >
          {bulk.action === 'owner' ? (
            <Field label="Owner" hint="Only people who may hold this company's bids are offered. The owner gets the closing reminders.">
              <Select<string>
                aria-label="Owner"
                searchable
                value={value}
                onValueChange={setValue}
                options={[{ value: '', label: 'Nobody' }, ...(owners.data ?? []).filter((o) => o.holds).map((o) => ({ value: String(o.id), label: o.name }))]}
                className={input}
              />
            </Field>
          ) : bulk.action === 'priority' ? (
            <Field label="Priority">
              <Select<string> aria-label="Priority" value={value} onValueChange={setValue} options={PRIORITIES.map((p) => ({ value: p, label: p[0]!.toUpperCase() + p.slice(1) }))} className={input} />
            </Field>
          ) : bulk.action === 'stage' ? (
            <>
              <Field label="Move to" hint="Each goes only where its own stage allows, and one with outstanding requirements or approvals stays put. Those are named afterwards.">
                <Select<string> aria-label="Move to" value={value} onValueChange={setValue} options={[{ value: '', label: 'Choose a stage' }, ...movable.map((s) => ({ value: s.key, label: s.label }))]} className={input} />
              </Field>
              <p className="m-0 text-[12px] text-ink-3">Awarded, won, lost and cancelled are decided one bid at a time — each records a value or a reason.</p>
            </>
          ) : (
            <p className="m-0 text-[13px] text-ink-2">They leave every list and the board. The records and their history are kept rather than erased, but nothing here brings them back.</p>
          )}
        </Sheet>
      ) : null}
    </div>
  );
}

function Row({ r, bands, chosen, onChoose, onOpen }: { r: TenderRow; bands: Band[] | undefined; chosen: boolean; onChoose: () => void; onOpen: () => void }) {
  const decided = r.outcome !== 'open';
  return (
    <div data-tender={r.id} className={cx('flex items-center gap-2.5 border-b border-line/60 px-3.5 py-2 text-[12.5px] last:border-b-0 hover:bg-subtle/60', chosen && 'bg-info-soft dark:bg-selection/40')}>
      <Checkbox aria-label={`Choose ${r.title}`} checked={chosen} onChange={onChoose} />
      <button type="button" aria-label={`Open ${r.title}`} onClick={onOpen} className="flex min-w-0 flex-1 flex-col text-left">
        <span className="flex min-w-0 items-center gap-1.5">
          {r.following ? <Icon name="eye" size={13} className="shrink-0 text-primary" /> : null}
          <b className="truncate text-ink">{r.title}</b>
          <PriorityPill p={r.priority} />
        </span>
        <span className="truncate text-[11.5px] text-ink-3">{[r.reference, r.organization ?? r.client_name].filter(Boolean).join(' · ') || 'No buyer recorded'}</span>
      </button>
      <span className="flex w-[140px] shrink-0 items-center gap-1">{decided && r.stage === r.outcome ? <OutcomePill o={r.outcome} /> : <StagePill label={r.stage_label} outcome={r.outcome} />}</span>
      <span className="w-[56px] shrink-0">
        <Score score={r.score} bands={bands} />
      </span>
      <span className="w-[120px] shrink-0 truncate text-ink-2">{r.owner_name ?? <span className="text-ink-3">Nobody yet</span>}</span>
      <span className="flex w-[128px] shrink-0 flex-col">
        {r.closing_at ? (
          <>
            <span className="text-ink">
              {dateLabel(r.closing_at)} <span className="text-ink-3">{timeLabel(r.closing_at)}</span>
            </span>
            {decided ? null : <Left r={r.remaining} className="text-[11.5px]" />}
          </>
        ) : (
          <span className="text-ink-3">No closing date</span>
        )}
      </span>
      <b className="w-[150px] shrink-0 text-right text-ink tabular-nums">{r.outcome === 'won' && r.award_value ? money(r.award_value, r.currency) : money(r.budget_max, r.currency)}</b>
    </div>
  );
}
