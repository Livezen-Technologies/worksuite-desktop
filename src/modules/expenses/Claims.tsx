import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { app } from '../../core/app-state';
import { useStore } from '../../core/store';
import { toast } from '../../core/toasts';
import { Icon } from '../../components/Icon';
import { Select } from '../../components/Select';
import { Spinner, cx } from '../../components/ui';
import { refusal, shortDate } from '../finance/api';
import { ConfirmSheet, LoadFailed, Notice, ReasonSheet } from '../finance/parts';
import { btnBad, btnGood, input, PageHead } from '../hr/parts';
import { Pill } from '../inventory/parts';
import { can, K, money } from './api';
import { bulkDecide, CK, clean, fetchCategories, fetchClaims, KIND_WORD, nextPage, selectionTotal, STATUSES, type ClaimFilters, type ClaimRow, type ClaimScope } from './claim-data';
import { StatusPill, words } from './parts';
import type { ScreenProps } from './Rail';

const ClaimPanel = lazy(() => import('./ClaimPanel'));

/**
 * The claim lists, and the claim that opens from one.
 *
 * THREE SCOPES, AND THE DEFAULT IS THE NARROW ONE. "Mine" is your own. "Team"
 * is everything you have ever been asked to approve, plus your own — which is
 * what a manager means by their team. "Organization" is everything, and needs
 * finance rights. The server enforces all three; this only asks.
 *
 * THE SELECTION, NOT ONE COMPANY. The server brackets each selected company
 * with that company's own visibility rule, so a consolidated list shows what
 * you may see in each and nothing more.
 *
 * THE FILTERS ARE ALWAYS ON SHOW. A list narrowed to one category and one
 * month looks exactly like an empty one unless what narrowed it is visible,
 * so they sit in the bar above it rather than behind a button.
 */
const TITLE: Record<ClaimScope, string> = { mine: 'My expenses', team: 'Team expenses', organization: 'Organization expenses' };

const SUB: Record<ClaimScope, string> = {
  mine: 'Everything you have claimed in this organization.',
  team: 'Claims that have been routed to you for approval, and your own.',
  organization: 'Every claim in this organization.',
};

export default function Claims({ org, orgs, onGo, scope, openClaim }: ScreenProps & { scope: ClaimScope; openClaim: number | null }) {
  const qc = useQueryClient();
  const perms = useStore(app, (s) => s.bootstrap?.permissions);
  const [q, setQ] = useState('');
  const [needle, setNeedle] = useState('');
  const [status, setStatus] = useState('');
  const [category, setCategory] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [flagged, setFlagged] = useState(false);
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [asking, setAsking] = useState<'approve' | 'reject' | null>(null);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<{ message: string; failed: Array<{ id: number; why: string; no: string | null }> } | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setNeedle(q.trim()), 300);
    return () => clearTimeout(t);
  }, [q]);

  const filters: ClaimFilters = useMemo(() => ({ q: needle || undefined, status: status || undefined, category_id: category || undefined, from: from || undefined, to: to || undefined, flagged: flagged || undefined }), [needle, status, category, from, to, flagged]);
  const anyFilter = !!(q || status || category || from || to || flagged);

  /*
   * PAGED. The server takes `page` and `per_page` and returns the real total,
   * so "312 claims" is never printed above a list of fifty with no way to
   * reach the rest.
   */
  const list = useInfiniteQuery({
    queryKey: CK.list(org, scope, filters),
    initialPageParam: 1,
    queryFn: ({ pageParam, signal }) => fetchClaims(org, scope, filters, pageParam, signal),
    getNextPageParam: (_last, pages) => nextPage(pages),
  });
  // The category filter follows the selection: every selected company's categories, and the shared ones.
  const cats = useQuery({ queryKey: CK.categories(org), queryFn: ({ signal }) => fetchCategories(org, signal), staleTime: 300_000 });

  const rows = useMemo(() => (list.data?.pages ?? []).flatMap((p) => p.items), [list.data]);
  const first = list.data?.pages[0];
  const total = first?.total ?? 0;
  /*
   * Only where a decision is the point. Every row on "My expenses" is your
   * own, and offering to approve them would be offering what the server
   * exists to refuse.
   */
  const bulk = scope !== 'mine' && can(perms, 'expense.approve');
  const chosen = rows.filter((r) => picked.has(r.id));
  const chosenTotal = selectionTotal(chosen);
  const person = scope !== 'mine';

  const clear = () => {
    setQ('');
    setNeedle('');
    setStatus('');
    setCategory('');
    setFrom('');
    setTo('');
    setFlagged(false);
  };

  /*
   * One request for the selection; `Claims::decide()` owns every rule and the
   * server only collects its answers. Every refusal is listed with the
   * library's own sentence — the one thing that says which rule refused.
   */
  const decideMany = async (decision: 'approved' | 'rejected', note: string) => {
    setBusy(true);
    try {
      const r = await bulkDecide(
        chosen.map((c) => c.id),
        decision,
        note,
      );
      setAsking(null);
      setPicked(new Set());
      void qc.invalidateQueries({ queryKey: K.all });
      if (r.failed.length) {
        const no = new Map(rows.map((c) => [c.id, c.claim_no]));
        setOutcome({ message: r.message, failed: r.failed.map((f) => ({ ...f, no: no.get(f.id) ?? null })) });
        toast('warning', r.message);
      } else {
        setOutcome(null);
        toast('success', r.message);
      }
    } catch (e) {
      toast('error', refusal(e));
    } finally {
      setBusy(false);
    }
  };

  const open = (id: number) => onGo(scope, `&claim=${id}`);

  return (
    <div className="flex flex-col gap-3 px-6 py-5">
      <PageHead title={TITLE[scope]} sub={SUB[scope]} />

      <div className="flex flex-wrap items-center gap-2">
        <span className="relative">
          <Icon name="search" size={14} className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-ink-3" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Description, claim number or person" aria-label="Search claims" className={cx(input, '!w-[260px] pl-8')} />
        </span>
        <Select
          aria-label="Filter by status"
          value={status}
          onValueChange={setStatus}
          className={cx('!w-auto', status && 'bg-selection')}
          options={[{ value: '', label: 'Any status' }, ...STATUSES.map((s) => ({ value: s, label: words(s) }))]}
        />
        <Select
          aria-label="Filter by category"
          searchable
          value={category}
          onValueChange={setCategory}
          className={cx('!w-auto', category && 'bg-selection')}
          options={[{ value: '', label: 'Any category' }, ...(cats.data ?? []).map((c) => ({ value: String(c.id), label: c.name, hint: c.active ? undefined : 'archived' }))]}
        />
        {/* A pair, labelled as one: which box is the start and which the end is not a guess. Optional — "any date" is the normal state. */}
        <span className="flex items-center gap-1.5">
          <input type="date" aria-label="Claims from this date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} className={cx(input, '!w-[150px]')} />
          <span className="text-[12px] text-ink-3">to</span>
          <input type="date" aria-label="Claims up to this date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} className={cx(input, '!w-[150px]')} />
        </span>
        <label className="flex items-center gap-1.5 text-[12.5px] font-semibold text-ink">
          <input type="checkbox" checked={flagged} onChange={(e) => setFlagged(e.target.checked)} className="h-3.5 w-3.5 accent-primary" />
          Flagged only
        </label>
        {anyFilter ? (
          <button type="button" onClick={clear} className="text-[12.5px] font-semibold text-ink-3 hover:text-ink">
            Clear
          </button>
        ) : null}
      </div>

      {bulk && chosen.length ? (
        <div className="flex flex-wrap items-center gap-2 self-start rounded-[9px] border border-[#C7D0F5] bg-[#EEF1FC] px-2.5 py-1.5 dark:border-[#2D3A66] dark:bg-[#16203E]" aria-label="Selected claims">
          <b className="text-[12.5px] text-primary">
            {chosen.length} selected{chosenTotal ? ` · ${chosenTotal}` : ''}
          </b>
          <button type="button" className={btnGood} disabled={busy} onClick={() => setAsking('approve')}>
            Approve
          </button>
          <button type="button" className={btnBad} disabled={busy} onClick={() => setAsking('reject')}>
            Reject
          </button>
          <button type="button" onClick={() => setPicked(new Set())} className="h-7 rounded-[7px] px-2 text-[12px] font-semibold text-ink-2 hover:bg-subtle">
            Clear
          </button>
        </div>
      ) : null}

      {outcome ? (
        <Notice tone="amber">
          <div className="flex items-start gap-2">
            <div className="min-w-0 flex-1">
              <b>{outcome.message}</b>
              <ul className="mt-1 mb-0 pl-4">
                {outcome.failed.map((f) => (
                  <li key={f.id}>
                    {f.no ?? `#${f.id}`} — {f.why}
                  </li>
                ))}
              </ul>
            </div>
            <button type="button" aria-label="Dismiss" onClick={() => setOutcome(null)} className="shrink-0 rounded-full p-0.5 hover:bg-black/5">
              <Icon name="x" size={14} />
            </button>
          </div>
        </Notice>
      ) : null}

      <div className="overflow-x-auto rounded-[12px] border border-line bg-surface scroll-thin">
        <div className="min-w-[860px]">
          <div className="flex items-center gap-2.5 border-b border-line bg-ground px-3.5 py-2 text-[11px] font-bold tracking-[.4px] text-ink-3 uppercase">
            {bulk ? (
              <input
                type="checkbox"
                aria-label="Select every claim shown"
                checked={rows.length > 0 && chosen.length === rows.length}
                onChange={(e) => setPicked(e.target.checked ? new Set(rows.map((r) => r.id)) : new Set())}
                className="h-3.5 w-3.5 shrink-0 accent-primary"
              />
            ) : null}
            <span className="min-w-0 flex-1">Claim</span>
            <span className="w-[96px] shrink-0">Date</span>
            {person ? <span className="w-[140px] shrink-0">Person</span> : null}
            <span className="w-[150px] shrink-0">Category</span>
            <span className="w-[150px] shrink-0 text-right">Amount</span>
            <span className="w-[96px] shrink-0">Status</span>
            <span className="w-[76px] shrink-0 text-right">Receipt</span>
          </div>
          {list.isLoading ? <Spinner /> : null}
          {list.error ? <LoadFailed what="The claims" onRetry={() => void list.refetch()} /> : null}
          {rows.map((c) => (
            <Row
              key={c.id}
              c={c}
              person={person}
              bulk={bulk}
              checked={picked.has(c.id)}
              open={openClaim === c.id}
              onCheck={(on) =>
                setPicked((s) => {
                  const n = new Set(s);
                  if (on) n.add(c.id);
                  else n.delete(c.id);
                  return n;
                })
              }
              onOpen={() => open(c.id)}
            />
          ))}
          {!list.isLoading && !list.error && !rows.length ? (
            <div className="flex flex-col items-center gap-1 px-3.5 py-8 text-center text-[12.5px] text-ink-3">
              <b className="text-[13px] text-ink-2">{anyFilter ? 'Nothing matches these filters.' : 'Nothing here yet.'}</b>
              {!anyFilter && scope === 'mine' ? <span>Claims you file appear here as soon as they are submitted.</span> : null}
            </div>
          ) : null}
          {list.data && rows.length ? (
            <div className="flex flex-wrap items-center gap-3 border-t border-line px-3.5 py-2 text-[12px] text-ink-3">
              <span>
                {rows.length} of {total} claim{total === 1 ? '' : 's'}
              </span>
              {/* The WHOLE filtered set, computed beside the total — not the loaded page. */}
              {first?.mixed ? (
                <span>No total: the companies selected keep their books in different currencies, and adding them would not be a figure in any one.</span>
              ) : first?.sum !== null && first?.sum !== undefined ? (
                <span>
                  Total <b className="text-ink tabular-nums">{money(first.sum, first.currency ?? '')}</b>
                </span>
              ) : null}
              <span className="flex-1" />
              {list.hasNextPage ? (
                <button type="button" className="font-semibold text-primary hover:underline" onClick={() => void list.fetchNextPage()} disabled={list.isFetchingNextPage}>
                  {list.isFetchingNextPage ? 'Loading…' : 'Load more'}
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>

      {asking === 'approve' ? (
        <ConfirmSheet
          title={`Approve ${chosen.length} claim${chosen.length === 1 ? '' : 's'}?`}
          body="Each one still goes through its own approval chain — any that are not yours to approve, or are already decided, will be refused and counted."
          action="Approve"
          busy={busy}
          onYes={() => void decideMany('approved', '')}
          onClose={() => setAsking(null)}
        />
      ) : null}
      {asking === 'reject' ? (
        <ReasonSheet
          title={`Reject ${chosen.length} claim${chosen.length === 1 ? '' : 's'}?`}
          body="The reason goes on every one of them. It is the only record of why."
          label="Why are these being rejected?"
          action="Reject them"
          danger
          busy={busy}
          onOk={(note) => void decideMany('rejected', note)}
          onClose={() => setAsking(null)}
        />
      ) : null}

      {openClaim ? (
        <Suspense fallback={null}>
          <ClaimPanel key={openClaim} id={openClaim} org={org} orgs={orgs} onGo={onGo} onClose={() => onGo(scope)} />
        </Suspense>
      ) : null}
    </div>
  );
}

function Row({ c, person, bulk, checked, open, onCheck, onOpen }: { c: ClaimRow; person: boolean; bulk: boolean; checked: boolean; open: boolean; onCheck: (on: boolean) => void; onOpen: () => void }) {
  const paidIn = c.currency && c.base_currency && c.currency !== c.base_currency;
  return (
    <div className={cx('flex items-center gap-2.5 border-b border-line/60 px-3.5 py-[9px] text-[13px] last:border-b-0 hover:bg-subtle', (open || checked) && 'bg-selection')}>
      {bulk ? <input type="checkbox" aria-label={`Select ${c.claim_no ?? 'claim'}`} checked={checked} onChange={(e) => onCheck(e.target.checked)} className="h-3.5 w-3.5 shrink-0 accent-primary" /> : null}
      <button type="button" onClick={onOpen} className="flex min-w-0 flex-1 items-center gap-2.5 text-left">
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="flex items-center gap-1.5">
            <span className="font-mono text-[12px] text-ink-2">{c.claim_no ?? '—'}</span>
            {c.flagged ? (
              <span title="A policy rule fired on this claim" className="inline-flex">
                <Icon name="warning" size={13} label="Flagged by a policy rule" className="text-[#E59A2F]" />
              </span>
            ) : null}
            {c.kind !== 'expense' ? <Pill tone="grey">{KIND_WORD[c.kind]}</Pill> : null}
          </span>
          <span className="truncate text-ink">{clean(c.description) || <span className="text-ink-3">No description</span>}</span>
        </span>
        <span className="w-[96px] shrink-0 text-ink-2">{shortDate(c.spent_on)}</span>
        {person ? <span className="w-[140px] shrink-0 truncate text-ink-2">{c.claimant ?? '—'}</span> : null}
        <span className="flex w-[150px] shrink-0 flex-col">
          <span className="truncate text-ink-2">{c.category ?? '—'}</span>
          {c.cost_centre || c.project ? <span className="truncate text-[11.5px] text-ink-3">{[c.cost_centre, c.project].filter(Boolean).join(' · ')}</span> : null}
        </span>
        <span className="flex w-[150px] shrink-0 flex-col items-end tabular-nums">
          <span className="font-semibold text-ink">{c.base_amount !== null ? money(c.base_amount, c.base_currency) : money(c.amount, c.currency)}</span>
          {paidIn ? <span className="text-[11.5px] text-ink-3">paid {money(c.amount, c.currency)}</span> : null}
        </span>
        <span className="w-[96px] shrink-0">
          <StatusPill status={c.status} />
        </span>
        <span className={cx('w-[76px] shrink-0 text-right text-[11.5px]', c.has_receipt ? 'text-ink-2' : 'text-ink-3')}>{c.has_receipt ? 'attached' : 'no receipt'}</span>
      </button>
    </div>
  );
}
