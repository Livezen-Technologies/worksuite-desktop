import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type DragEvent } from 'react';
import { apiGet, apiPost } from '../../core/api';
import { app } from '../../core/app-state';
import { useStore } from '../../core/store';
import { errorMessage } from '../../core/bridge';
import { dateLabel, todayInZone } from '../../core/time';
import { toast } from '../../core/toasts';
import { Icon } from '../../components/Icon';
import { Select } from '../../components/Select';
import { ErrorNote, Spinner, cx } from '../../components/ui';
import { btn, btnPrimary, Caps, Field, input, Sheet, SidePanel } from '../../components/PageKit';
import type { Account, Board, BoardColumn, Deal, Pipeline as PipelineT, TimelineEntry } from './api';
import { TimelineList, useOwners } from './Leads';
import { crmCan, money, moneyFull, stageColour, StatusBar } from './parts';
import { boardTotals } from './logic';
import { ScheduleFollowUp } from './Schedule';
import { CompanyField, orgIdFor, useCrmScope } from './scope';

/**
 * The pipeline board (CrmPipeline, CrmDealSheet, desk-pipeline): deals in
 * columns by stage for the company the CRM is showing, each column with its
 * probability, total and weighted total, each card with its value, owner,
 * expected close and how long it has sat in the stage; Open and Weighted for
 * the board at the top and its StatusBar under it. Drag a card to move it —
 * into Lost asks why, which is recorded on the deal and the customer's
 * timeline. A deal opens in a drawer with its figures, details, quotes, its
 * timeline and Schedule a follow-up; New deal starts one in the first stage.
 */
interface DealDetail {
  deal: Deal & { stage_name: string; stage_kind: string; probability: number };
  timeline: TimelineEntry[];
  quotes: Array<{ id: number; quote_no: string; status: string; total: number; currency: string }>;
}

export default function Pipeline({ openId, onOpen, onOpenQuote }: { openId: number | null; onOpen: (id: number | null) => void; onOpenQuote: (id: number) => void }) {
  const scope = useCrmScope();
  const qc = useQueryClient();
  const owners = useOwners();
  const perms = useStore(app, (s) => s.bootstrap?.permissions);
  const canDeal = crmCan(perms, 'crm.deal');
  const [pipelineId, setPipelineId] = useState<string>('');
  const [owner, setOwner] = useState('');
  const [q, setQ] = useState('');
  const [dragging, setDragging] = useState<Deal | null>(null);
  const [over, setOver] = useState<number | null>(null);
  const [losing, setLosing] = useState<{ deal: Deal; stageId: number } | null>(null);
  const [creating, setCreating] = useState(false);
  const pipelines = useQuery({ queryKey: ['crm', 'pipelines', scope.orgId ?? 0], queryFn: ({ signal }) => apiGet<{ pipelines: PipelineT[] }>('/api/crm/pipelines', scope.params, signal), staleTime: 5 * 60_000 });
  const params = { pipeline: pipelineId || undefined, q: q.trim() || undefined, mine: owner === 'me' ? 1 : undefined, owner: owner && owner !== 'me' ? owner : undefined, ...scope.params };
  const board = useQuery({ queryKey: ['crm', 'board', params], queryFn: ({ signal }) => apiGet<Board>('/api/crm/deals/board', params, signal) });
  const columns = board.data?.columns ?? [];
  const totals = boardTotals(board.data);
  const pipelineName = pipelines.data?.pipelines.find((p) => p.id === (pipelineId ? Number(pipelineId) : board.data?.pipeline?.id))?.name ?? 'Sales';
  const currency = columns.flatMap((c) => c.deals)[0]?.currency ?? 'LKR';
  const refresh = () => void qc.invalidateQueries({ queryKey: ['crm'] });

  const move = async (deal: Deal, stageId: number, reason?: string) => {
    try {
      await apiPost(`/api/crm/deals/${deal.id}/move`, { stage_id: stageId, reason });
      const to = columns.find((c) => c.id === stageId);
      toast('success', to ? `Moved to ${to.name}.` : 'Moved.');
      refresh();
      return true;
    } catch (e) {
      toast('error', errorMessage(e));
      return false;
    }
  };
  const dropOn = (stageId: number) => {
    const deal = dragging;
    setDragging(null);
    setOver(null);
    if (!deal || deal.stage_id === stageId) return;
    const column = columns.find((c) => c.id === stageId);
    if (column?.kind === 'lost') setLosing({ deal, stageId });
    else void move(deal, stageId);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="m-0 mr-2 text-[20px] font-bold text-ink">Pipeline</h1>
        {(pipelines.data?.pipelines.length ?? 0) > 1 ? (
          <Select label="Pipeline" value={pipelineId || String(board.data?.pipeline?.id ?? '')} onValueChange={setPipelineId} options={(pipelines.data?.pipelines ?? []).map((p) => ({ value: String(p.id), label: `${p.name} · ${scope.name}` }))} />
        ) : (
          <span className="rounded-[8px] border border-line bg-surface px-3 py-1.5 text-[13px] font-semibold text-ink">{`${pipelineName} · ${scope.name}`}</span>
        )}
        <Select label="Owner" value={owner} onValueChange={setOwner} options={[{ value: '', label: 'Everyone' }, { value: 'me', label: 'Mine' }, ...(owners.data?.owners ?? []).map((o) => ({ value: String(o.id), label: o.name }))]} />
        <label className="flex h-[34px] w-[200px] items-center gap-2 rounded-[8px] border border-line bg-surface px-2.5 focus-within:border-primary">
          <Icon name="search" size={14} className="text-ink-3" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search deals" aria-label="Search deals" className="bare-focus min-w-0 flex-1 bg-transparent text-[13px] text-ink outline-none placeholder:text-ink-3" />
        </label>
        <span className="flex-1" />
        <span className="flex flex-col items-end leading-tight" aria-label="Board totals">
          <span className="text-[11.5px] text-ink-3">Open · Weighted</span>
          <b className="text-[14px] text-ink tabular-nums">
            {money(totals.open, currency)} · {money(totals.weighted, currency)}
          </b>
        </span>
        {canDeal ? (
          <button type="button" className={btnPrimary} onClick={() => setCreating(true)}>
            <Icon name="plus" size={15} /> New deal
          </button>
        ) : null}
      </div>
      {board.isLoading ? <Spinner /> : board.error ? <ErrorNote error={board.error} onRetry={() => void board.refetch()} /> : null}
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-[12px] border border-line">
        <div className="grid min-h-0 flex-1 auto-cols-[minmax(210px,1fr)] grid-flow-col gap-2.5 overflow-x-auto p-2.5 scroll-thin">
          {columns.map((c) => (
            <Column key={c.id} c={c} currency={currency} canMove={canDeal} over={over === c.id} dragging={dragging} onDragOver={() => setOver(c.id)} onDrop={() => dropOn(c.id)} onDragStart={setDragging} onDragEnd={() => (setDragging(null), setOver(null))} onOpen={onOpen} />
          ))}
        </div>
        <StatusBar>{board.data ? `${totals.deals} ${totals.deals === 1 ? 'deal' : 'deals'} · Open ${money(totals.open, currency)} · Weighted ${money(totals.weighted, currency)}` : null}</StatusBar>
      </div>
      {openId ? <DealDrawer key={openId} id={openId} canDeal={canDeal} columns={columns} onClose={() => onOpen(null)} onMove={move} onLose={(deal, stageId) => setLosing({ deal, stageId })} onChanged={refresh} onOpenQuote={onOpenQuote} /> : null}
      {losing ? <LostReason deal={losing.deal} onClose={() => setLosing(null)} onSave={async (why) => (await move(losing.deal, losing.stageId, why)) && setLosing(null)} /> : null}
      {creating && canDeal ? <NewDeal onClose={() => setCreating(false)} onCreated={() => (setCreating(false), refresh())} /> : null}
    </div>
  );
}

function Column({ c, currency, canMove, over, dragging, onDragOver, onDrop, onDragStart, onDragEnd, onOpen }: { c: BoardColumn; currency: string; canMove: boolean; over: boolean; dragging: Deal | null; onDragOver: () => void; onDrop: () => void; onDragStart: (d: Deal) => void; onDragEnd: () => void; onOpen: (id: number) => void }) {
  const today = todayInZone();
  return (
    <div
      data-stage={c.id}
      onDragOver={(e: DragEvent) => {
        if (!dragging) return;
        e.preventDefault();
        onDragOver();
      }}
      onDrop={(e) => (e.preventDefault(), onDrop())}
      className={cx('flex min-h-0 flex-col gap-2 rounded-[10px] bg-info-bg p-2 dark:bg-well', over && dragging && dragging.stage_id !== c.id && 'ring-2 ring-primary')}
    >
      <div className="flex flex-col gap-0.5 px-1 pt-0.5" data-column-head>
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: stageColour(c.colour) }} />
          <b className="min-w-0 truncate text-ink">{c.name}</b>
          <span className="text-[12px] font-bold text-ink-2 tabular-nums">{c.count}</span>
          <span className="flex-1" />
          <span className="text-[11.5px] text-ink-3 tabular-nums">{c.probability}%</span>
        </span>
        <span className="text-[11.5px] text-ink-3 tabular-nums">
          {money(c.total, c.deals[0]?.currency ?? currency)}
          {c.kind === 'open' && c.weighted ? ` · ≈ ${money(c.weighted)}` : ''}
        </span>
      </div>
      <div className="flex min-h-0 flex-col gap-1.5 overflow-y-auto scroll-thin">
        {c.deals.map((d) => {
          const stale = c.kind === 'open' && d.days_in_stage >= 14;
          const late = c.kind === 'open' && !!d.close_date && d.close_date < today;
          return (
            <button
              key={d.id}
              type="button"
              draggable={canMove}
              data-deal={d.id}
              onDragStart={(e) => (e.dataTransfer.setData('text/plain', String(d.id)), (e.dataTransfer.effectAllowed = 'move'), onDragStart(d))}
              onDragEnd={onDragEnd}
              onClick={() => onOpen(d.id)}
              className={cx('flex flex-col gap-1 rounded-[9px] border border-line bg-surface px-2.5 py-2 text-left hover:border-primary/50', dragging?.id === d.id && 'opacity-50')}
            >
              <b className="text-[12.5px] leading-snug text-ink">{d.name}</b>
              <span className="truncate text-[11.5px] text-ink-3">{d.account_name ?? 'No account'}</span>
              <span className="flex items-center gap-1.5">
                <b className="min-w-0 flex-1 text-[12.5px] text-ink tabular-nums">{money(d.amount, d.currency)}</b>
                {stale ? (
                  <span title={`${d.days_in_stage} days in this stage`} className="rounded-full bg-warning-bg px-1.5 text-[10.5px] font-bold text-warning-ink dark:bg-warning-bg dark:text-warning">
                    {d.days_in_stage}d
                  </span>
                ) : null}
              </span>
              <span className="flex items-center gap-1.5 text-[11.5px]">
                <span className={cx('min-w-0 flex-1 truncate', d.owner_name ? 'text-ink-2' : 'font-bold text-warning-ink dark:text-warning')}>{d.owner_name ?? 'Unassigned'}</span>
                <span className={late ? 'font-bold text-danger' : 'text-ink-3'}>{d.won_at ? `Won ${dateLabel(d.won_at)}` : d.close_date ? dateLabel(d.close_date) : ''}</span>
              </span>
            </button>
          );
        })}
        {!c.deals.length ? <span className="px-1 py-3 text-center text-[12px] text-ink-3">Nothing here</span> : null}
      </div>
    </div>
  );
}

function LostReason({ deal, onClose, onSave }: { deal: Deal; onClose: () => void; onSave: (why: string) => void }) {
  const [why, setWhy] = useState('');
  return (
    <Sheet
      title={`Why was “${deal.name}” lost?`}
      width={420}
      onClose={onClose}
      footer={
        <>
          <button type="button" className={btn} onClick={onClose}>
            Cancel
          </button>
          <button type="button" className={cx(btnPrimary, 'bg-danger hover:bg-danger')} disabled={!why.trim()} onClick={() => onSave(why.trim())}>
            Mark as lost
          </button>
        </>
      }
    >
      <span className="-mt-1.5 text-[12.5px] text-ink-3">The one piece of pipeline data worth keeping.</span>
      <input autoFocus aria-label="Why was it lost?" value={why} onChange={(e) => setWhy(e.target.value)} placeholder="Budget moved to next year" className={input} maxLength={255} />
      <span className="text-[11.5px] text-ink-3">Recorded on the deal and on the customer’s timeline.</span>
    </Sheet>
  );
}

function DealDrawer({ id, canDeal, columns, onClose, onMove, onLose, onChanged, onOpenQuote }: { id: number; canDeal: boolean; columns: BoardColumn[]; onClose: () => void; onMove: (d: Deal, stageId: number) => Promise<boolean>; onLose: (d: Deal, stageId: number) => void; onChanged: () => void; onOpenQuote: (id: number) => void }) {
  const qc = useQueryClient();
  const perms = useStore(app, (s) => s.bootstrap?.permissions);
  const [scheduling, setScheduling] = useState(false);
  const [kind, setKind] = useState('note');
  const [title, setTitle] = useState('');
  const q = useQuery({ queryKey: ['crm', 'deal', id], queryFn: ({ signal }) => apiGet<DealDetail>(`/api/crm/deals/${id}`, undefined, signal), staleTime: 0, refetchOnMount: 'always' });
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['crm', 'deal', id] });
    onChanged();
  };
  const record = async () => {
    try {
      await apiPost(`/api/crm/deals/${id}/activity`, { kind, title: title.trim() });
      toast('success', 'Recorded.');
      setTitle('');
      refresh();
    } catch (e) {
      toast('error', errorMessage(e));
    }
  };
  const d = q.data?.deal;
  const head = d ? (
    <span className="flex min-w-0 flex-col">
      <b className="truncate text-[16px] text-ink">{d.name}</b>
      <span className="truncate text-[12.5px] text-ink-3">{[d.account_name ?? 'No account', d.owner_name ?? 'Unassigned'].join(' · ')}</span>
    </span>
  ) : (
    <b className="text-ink">Deal</b>
  );
  return (
    <SidePanel label="Deal" width={540} onClose={onClose} head={head}>
      {q.isLoading ? <Spinner /> : q.error ? <ErrorNote error={q.error} onRetry={() => void q.refetch()} /> : null}
      {d && q.data ? (
        <>
          <div className="grid grid-cols-3 gap-2">
            {[
              ['Deal value', money(d.amount, d.currency), ''],
              [d.stage_name, `${d.probability}%`, d.stage_kind === 'open' ? `${d.days_in_stage}d in stage` : ''],
              ['Weighted', money((d.amount * d.probability) / 100, d.currency), ''],
            ].map(([l, v, sub]) => (
              <div key={l} className="flex flex-col rounded-[10px] bg-info-soft px-3 py-2 dark:bg-well">
                <span className="text-[11.5px] font-semibold text-ink-3">{l}</span>
                <b className="text-[16px] text-ink tabular-nums">{v}</b>
                {sub ? <span className={cx('text-[11px]', d.days_in_stage >= 14 ? 'font-bold text-danger' : 'text-ink-3')}>{sub}</span> : null}
              </div>
            ))}
          </div>
          {crmCan(perms, 'crm.followup.create') && d.stage_kind === 'open' ? (
            <button type="button" className={cx(btn, 'self-start')} onClick={() => setScheduling(true)}>
              <Icon name="calendar-plus" size={14} /> Schedule a follow-up
            </button>
          ) : null}
          <Field label="Stage">
            <Select
              label="Stage"
              disabled={!canDeal}
              value={String(d.stage_id)}
              onValueChange={(v) => {
                const stage = columns.find((c) => String(c.id) === v);
                if (!stage || stage.id === d.stage_id) return;
                if (stage.kind === 'lost') onLose(d, stage.id);
                else void onMove(d, stage.id).then((ok) => ok && refresh());
              }}
              options={columns.map((c) => ({ value: String(c.id), label: `${c.name} · ${c.probability}%` }))}
            />
          </Field>
          <section>
            <Caps>Details</Caps>
            <div className="grid grid-cols-2 gap-x-4">
              {(
                [
                  ['Account', d.account_name],
                  ['Contact', d.contact_name],
                  ['Owner', d.owner_name ?? 'Unassigned'],
                  ['Expected close', d.close_date ? dateLabel(d.close_date) : null],
                  ['Amount', moneyFull(d.amount, d.currency)],
                  ['Source', d.source],
                  ['Won', d.won_at ? dateLabel(d.won_at) : null],
                  ['Lost', d.lost_at ? `${dateLabel(d.lost_at)}${d.lost_reason ? ` — ${d.lost_reason}` : ''}` : null],
                ] as Array<[string, string | null]>
              ).map(([k, v]) => (
                <div key={k} className="flex min-w-0 flex-col border-b border-line/60 py-1.5">
                  <span className="text-[11.5px] text-ink-3">{k}</span>
                  <span className="truncate font-semibold text-ink">{v || '—'}</span>
                </div>
              ))}
            </div>
          </section>
          <section>
            <Caps>Quotes</Caps>
            {q.data.quotes.length ? (
              q.data.quotes.map((x) => (
                <button key={x.id} type="button" onClick={() => onOpenQuote(x.id)} className="flex w-full items-center gap-2 border-b border-line/60 py-1.5 text-left text-[12.5px] last:border-b-0 hover:bg-subtle">
                  <span className="font-semibold text-primary">{x.quote_no}</span>
                  <span className="text-ink-3 capitalize">{x.status}</span>
                  <span className="flex-1" />
                  <b className="text-ink tabular-nums">{money(x.total, x.currency)}</b>
                </button>
              ))
            ) : (
              <p className="m-0 text-[12.5px] text-ink-3">No quotes on this deal.</p>
            )}
          </section>
          <section className="flex flex-col gap-2">
            <Caps>Timeline</Caps>
            <div className={cx('flex gap-2', !canDeal && 'hidden')}>
              <Select label="Kind" value={kind} onValueChange={setKind} options={[{ value: 'note', label: 'Note' }, { value: 'call', label: 'Call' }, { value: 'email', label: 'Email' }, { value: 'meeting', label: 'Meeting' }]} />
              <input aria-label="What happened?" value={title} onChange={(e) => setTitle(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && title.trim() && void record()} placeholder="What happened?" className={input} maxLength={200} />
              <button type="button" className={btnPrimary} disabled={!title.trim()} onClick={() => void record()}>
                Record
              </button>
            </div>
            <TimelineList entries={q.data.timeline} />
          </section>
        </>
      ) : null}
      {scheduling && d ? <ScheduleFollowUp subject={{ type: 'deal', id: d.id, label: [d.name, d.account_name].filter(Boolean).join(' · ') }} onClose={() => setScheduling(false)} onDone={() => (setScheduling(false), refresh())} /> : null}
    </SidePanel>
  );
}

/** New deal: from the board, or from an account's 360 page (`account`, fixed). */
export function NewDeal({ account: fixed, onClose, onCreated }: { account?: { id: number; name: string }; onClose: () => void; onCreated: () => void }) {
  const owners = useOwners();
  const scope = useCrmScope();
  const [org, setOrg] = useState('');
  const accounts = useQuery({ queryKey: ['crm', 'accounts-pick', scope.orgId ?? 0], queryFn: ({ signal }) => apiGet<{ accounts: Account[] }>('/api/crm/accounts', { per_page: 200, ...scope.params }, signal), staleTime: 60_000, enabled: !fixed });
  const [name, setName] = useState('');
  const [account, setAccount] = useState(fixed ? String(fixed.id) : '');
  const [amount, setAmount] = useState('');
  const [close, setClose] = useState('');
  const [owner, setOwner] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const create = async () => {
    if (!name.trim() || (scope.needsOrg && !org)) return;
    setBusy(true);
    try {
      await apiPost('/api/crm/deals', { name: name.trim(), account_id: account ? Number(account) : null, amount: amount ? Number(amount) : 0, close_date: close || null, owner_id: owner ? Number(owner) : null, description: notes, org_id: orgIdFor(org, scope) });
      toast('success', 'Deal created.');
      onCreated();
    } catch (e) {
      toast('error', errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <SidePanel
      label="New deal"
      width={460}
      onClose={onClose}
      head={
        <span className="flex flex-col">
          <b className="text-[16px] text-ink">New deal</b>
          <span className="text-[12.5px] text-ink-3">It starts in the first stage of the pipeline</span>
        </span>
      }
    >
      <form className="flex flex-col gap-3" onSubmit={(e) => (e.preventDefault(), void create())}>
        <CompanyField scope={scope} value={org} onChange={setOrg} what="deal" />
        <Field label="Deal name">
          <input autoFocus aria-label="Deal name" value={name} onChange={(e) => setName(e.target.value)} className={input} maxLength={200} />
        </Field>
        <Field label="Account">
          {fixed ? <span className="text-[13px] font-semibold text-ink">{fixed.name}</span> : <Select label="Account" value={account} onValueChange={setAccount} searchable options={[{ value: '', label: 'No account' }, ...(accounts.data?.accounts ?? []).map((a) => ({ value: String(a.id), label: a.name }))]} />}
        </Field>
        <div className="grid grid-cols-2 gap-2.5">
          <Field label="Amount">
            <input aria-label="Amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ''))} placeholder="0.00" className={input} />
          </Field>
          <Field label="Expected close">
            <input aria-label="Expected close" type="date" value={close} onChange={(e) => setClose(e.target.value)} className={input} />
          </Field>
        </div>
        <Field label="Owner">
          <Select label="Owner" value={owner} onValueChange={setOwner} options={[{ value: '', label: 'Me' }, ...(owners.data?.owners ?? []).map((o) => ({ value: String(o.id), label: o.name }))]} />
        </Field>
        <Field label="Notes">
          <textarea aria-label="Notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} className={cx(input, 'h-auto py-2')} />
        </Field>
        <div className="flex justify-end gap-2 border-t border-line pt-3">
          <button type="button" className={btn} onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className={btnPrimary} disabled={!name.trim() || busy || (scope.needsOrg && !org)}>
            {busy ? 'Creating…' : 'Create deal'}
          </button>
        </div>
      </form>
    </SidePanel>
  );
}
