import { useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { app } from '../../core/app-state';
import { useStore } from '../../core/store';
import { toast } from '../../core/toasts';
import { Icon } from '../../components/Icon';
import { Select } from '../../components/Select';
import { Spinner, cx } from '../../components/ui';
import { refusal, shortDate } from '../finance/api';
import { ConfirmSheet, LoadFailed, Notice, ReasonSheet } from '../finance/parts';
import { btn, btnBad, btnGood, btnPrimary, btnSmall, Field, input, PageHead, Panel, Sheet } from '../hr/parts';
import { minWidth, Pill } from '../inventory/parts';
import { can, money, parseSelection, type Org } from './api';
import {
  currencyOf,
  decideDuplicate,
  decideMany,
  decideOne,
  fetchDuplicates,
  fetchMembers,
  fetchQueue,
  filterQueue,
  holds,
  namedRefusals,
  QK,
  QUEUE_SORTS,
  reassignable,
  reassignStep,
  scopeQueue,
  sortQueue,
  waited,
  type Duplicate,
  type QueueFilter,
  type QueueItem,
  type QueueSort,
} from './approvals-api';
import { AdvancePanel, ApproveSheet, touch } from './Advances';
import { Blocks, Warnings } from './parts';
import type { ScreenProps } from './Rail';

/**
 * Everything waiting on this person.
 *
 * IT USED TO IGNORE THE COMPANY SELECTOR ENTIRELY, and the reason was sound:
 * an approval queue split by company is a queue somebody forgets to check, and
 * the person who suffers is the claimant waiting to be paid. But the selector
 * sits directly beside this screen, and choosing one company to read another's
 * claims is a control that lies. So the selection is honoured and the original
 * danger answered: WHAT THE FILTER HIDES IS COUNTED AND OFFERED, in a banner
 * and in the empty state. The company stays on every row, so a consolidated
 * view is one click away.
 *
 * ORDERED OLDEST FIRST. The interesting item is the one that has been sitting
 * longest, not the newest, and anything over a week says so in red.
 *
 * THE POLICY WARNINGS STAY ON THE ROW. An item flagged before it reached you
 * is the one to look at first; a flag somebody has to open the row to see is
 * a flag nobody sees.
 *
 * FILTERED AND SORTED HERE. The server builds the queue one pending item at a
 * time and returns what is outstanding for one person and nothing more. That
 * is a queue, not a ledger: it is bounded by how much somebody has left
 * undecided, and paging it would page a list whose whole purpose is to be
 * emptied.
 *
 * Below the queue, claims in the same companies that look like the same
 * expense twice — arithmetic, not an accusation, and nothing is rejected by it.
 */
type Asking =
  | null
  | { kind: 'approve' | 'decline'; items: QueueItem[]; bulk: boolean }
  | { kind: 'reassign'; item: QueueItem };

const W = { check: 18, claimant: 170, waiting: 80, amount: 150, actions: 196 };

export default function Approvals({ org, orgs, onGo }: ScreenProps) {
  const qc = useQueryClient();
  const perms = useStore(app, (s) => s.bootstrap?.permissions);
  const me = Number(useStore(app, (s) => s.auth?.user?.id) ?? 0);
  const mayDecide = can(perms, 'expense.approve');
  const mayReassign = can(perms, 'expense.admin');
  const q = useQuery({ queryKey: QK.queue, queryFn: ({ signal }) => fetchQueue(signal), retry: false });

  const selected = useMemo(() => parseSelection(org), [org]);
  /* Set by the "show every company" link, so somebody can see across companies
     without going back to the switcher to clear a filter they did not set here. */
  const [showAll, setShowAll] = useState(false);
  const [filter, setFilter] = useState<QueueFilter>({ q: '', kind: '', only: '' });
  const [sort, setSort] = useState<QueueSort>('waiting');
  const [dir, setDir] = useState<'asc' | 'desc'>('desc');
  const [picked, setPicked] = useState<Set<string>>(() => new Set());
  const [asking, setAsking] = useState<Asking>(null);
  const [busy, setBusy] = useState(false);
  const [refused, setRefused] = useState<Array<{ key: string; ref: string; why: string }>>([]);
  const [advance, setAdvance] = useState<number | null>(null);

  const everything = useMemo(() => q.data ?? [], [q.data]);
  const scoped = selected.length > 0 && !showAll;
  const { shown: all, elsewhere } = useMemo(() => scopeQueue(everything, scoped ? selected : []), [everything, scoped, selected]);
  const rows = useMemo(() => sortQueue(filterQueue(all, filter), sort, dir), [all, filter, sort, dir]);
  const chosen = rows.filter((r) => picked.has(r.key));
  const one = selected.length === 1;
  const here = one ? 'this company' : 'the companies selected';
  const orgOf = (id: number) => orgs.find((o) => o.id === id);

  const toggle = (key: string) =>
    setPicked((s) => {
      const n = new Set(s);
      if (n.has(key)) n.delete(key);
      else n.add(key);
      return n;
    });
  const allPicked = rows.length > 0 && rows.every((r) => picked.has(r.key));
  const pickAll = () => setPicked(allPicked ? new Set() : new Set(rows.map((r) => r.key)));

  const decide = async (items: QueueItem[], approve: boolean, note: string, bulk: boolean) => {
    setBusy(true);
    try {
      if (bulk) {
        const r = await decideMany(items, approve, note);
        setRefused(namedRefusals(r.failed, items));
        toast(r.failed.length ? 'warning' : 'success', r.message);
      } else {
        const r = await decideOne(items[0]!, approve, note);
        toast('success', r.message ?? (approve ? 'Approved.' : 'Rejected.'));
      }
      setPicked(new Set());
      setAsking(null);
      touch(qc);
    } catch (e) {
      toast('error', refusal(e));
    } finally {
      setBusy(false);
    }
  };

  const reassign = async (item: QueueItem, userId: number) => {
    setBusy(true);
    try {
      const r = await reassignStep(item.approval_id, userId);
      toast('success', r.message ?? 'Reassigned.');
      setAsking(null);
      touch(qc);
    } catch (e) {
      toast('error', refusal(e));
    } finally {
      setBusy(false);
    }
  };

  // Look-alike claims come from the same companies the queue is showing.
  const dupOrgs = mayDecide ? orgs.filter((o) => (!scoped || selected.includes(o.id)) && holds(o, 'approver')) : [];

  return (
    <div className="flex flex-col gap-3.5 px-6 py-5">
      <PageHead
        title="Approvals"
        sub={scoped ? `Everything waiting on you in ${here}. Oldest first.` : 'Everything waiting on you, in every organization you belong to. Oldest first.'}
      />

      {/* What the filter is hiding, said out loud: the reason this screen may
          honour the selector at all. Nothing can be forgotten while the screen
          is counting it and offering one click to see it. */}
      {elsewhere > 0 ? (
        <Notice tone="amber" className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <b>
            {elsewhere} more {elsewhere === 1 ? 'approval is' : 'approvals are'} waiting on you in your other companies
          </b>
          <button type="button" className="ml-auto text-[12px] font-bold underline hover:no-underline" onClick={() => setShowAll(true)}>
            Show every company
          </button>
        </Notice>
      ) : null}
      {showAll && selected.length > 0 ? (
        <Notice tone="grey" className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span>Showing every company, not just {one ? 'the one' : 'the ones'} selected in the sidebar.</span>
          <button type="button" className="ml-auto text-[12px] font-bold text-primary underline hover:no-underline" onClick={() => setShowAll(false)}>
            Back to {here}
          </button>
        </Notice>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <Icon name="search" size={14} className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-ink-3" />
          <input value={filter.q} onChange={(e) => setFilter({ ...filter, q: e.target.value })} aria-label="Search the queue" placeholder="Search reference, description, person" className={cx(input, 'w-[260px] pl-8')} />
        </div>
        <Select<QueueFilter['kind']>
          aria-label="Filter by kind"
          value={filter.kind}
          onValueChange={(v) => setFilter({ ...filter, kind: v })}
          options={[
            { value: '', label: 'Everything' },
            { value: 'claim', label: 'Expenses' },
            { value: 'advance', label: 'Cash advances' },
          ]}
          className="h-[34px] rounded-[8px] border border-line bg-surface px-2.5 text-[13px]"
        />
        <Select<QueueFilter['only']>
          aria-label="Narrow"
          value={filter.only}
          onValueChange={(v) => setFilter({ ...filter, only: v })}
          options={[
            { value: '', label: 'No extra filter' },
            { value: 'flagged', label: 'Flagged by policy' },
            { value: 'week', label: 'Waiting a week or more' },
          ]}
          className="h-[34px] rounded-[8px] border border-line bg-surface px-2.5 text-[13px]"
        />
        <Select<QueueSort> aria-label="Sort by" value={sort} onValueChange={setSort} options={QUEUE_SORTS} className="h-[34px] rounded-[8px] border border-line bg-surface px-2.5 text-[13px]" />
        <button type="button" className={cx(btn, 'w-[34px] justify-center px-0')} aria-label={dir === 'asc' ? 'Sort ascending' : 'Sort descending'} onClick={() => setDir(dir === 'asc' ? 'desc' : 'asc')}>
          <Icon name={dir === 'asc' ? 'arrow-up' : 'arrow-down'} size={14} />
        </button>
        {mayDecide && chosen.length ? (
          <div className="ml-auto flex items-center gap-2 rounded-[9px] bg-selection px-2.5 py-1">
            <b className="text-[12.5px] text-primary">{chosen.length} selected</b>
            <button type="button" className={btnGood} disabled={busy} onClick={() => setAsking({ kind: 'approve', items: chosen, bulk: true })}>
              Approve
            </button>
            {/* No confirmation before this one: the reason sheet IS the
                confirmation, and two dialogs in a row for one act is how
                people stop reading either. */}
            <button type="button" className={btnBad} disabled={busy} onClick={() => setAsking({ kind: 'decline', items: chosen, bulk: true })}>
              Decline
            </button>
            <button type="button" className="text-[12px] font-semibold text-ink-3 hover:text-ink" onClick={() => setPicked(new Set())}>
              Clear
            </button>
          </div>
        ) : null}
      </div>

      {refused.length ? (
        <Notice tone="red">
          <div className="flex items-start gap-2">
            <div className="min-w-0 flex-1">
              <b>
                {refused.length === 1 ? 'One item was' : `${refused.length} items were`} not decided — each in the words of the rule that refused it:
              </b>
              <ul className="mt-1 mb-0 pl-4">
                {refused.map((r) => (
                  <li key={r.key}>
                    <span className="font-mono">{r.ref}</span> — {r.why}
                  </li>
                ))}
              </ul>
            </div>
            <button type="button" aria-label="Dismiss" className="shrink-0 rounded p-0.5 hover:bg-black/5" onClick={() => setRefused([])}>
              <Icon name="x" size={14} />
            </button>
          </div>
        </Notice>
      ) : null}

      {q.isLoading ? <Spinner /> : null}
      {q.error ? <LoadFailed what="Your approval queue" onRetry={() => void q.refetch()} /> : null}

      {q.data ? (
        <div className="overflow-x-auto rounded-[12px] border border-line bg-surface">
          <div style={{ minWidth: minWidth(300, mayDecide ? Object.values(W) : [W.claimant, W.waiting, W.amount, W.actions]) }}>
            <div className="flex items-center gap-2.5 border-b border-line bg-ground px-3.5 py-2 text-[11px] font-bold tracking-[.4px] text-ink-3 uppercase">
              {mayDecide ? (
                <span className="shrink-0" style={{ width: W.check }}>
                  <input type="checkbox" aria-label="Choose every item shown" checked={allPicked} disabled={!rows.length} onChange={pickAll} className="h-3.5 w-3.5 accent-[var(--color-primary)]" />
                </span>
              ) : null}
              <span className="min-w-0 flex-1">Item</span>
              <span className="shrink-0" style={{ width: W.claimant }}>
                Claimant
              </span>
              <span className="shrink-0" style={{ width: W.waiting }}>
                Waiting
              </span>
              <span className="shrink-0 text-right" style={{ width: W.amount }}>
                Amount
              </span>
              <span className="shrink-0" style={{ width: W.actions }} />
            </div>
            {rows.map((r) => {
              const blocks = r.policy.filter((h) => h.severity === 'block');
              const warns = r.policy.filter((h) => h.severity !== 'block');
              const mayHand = mayReassign && holds(orgOf(r.org_id), 'admin');
              return (
                <div key={r.key} className={cx('flex items-start gap-2.5 border-b border-line/60 px-3.5 py-2.5 text-[13px] last:border-b-0', picked.has(r.key) && 'bg-selection')}>
                  {mayDecide ? (
                    <span className="shrink-0 pt-0.5" style={{ width: W.check }}>
                      <input type="checkbox" aria-label={`Choose ${r.ref}`} checked={picked.has(r.key)} onChange={() => toggle(r.key)} className="h-3.5 w-3.5 accent-[var(--color-primary)]" />
                    </span>
                  ) : null}
                  <span className="flex min-w-0 flex-1 flex-col gap-1">
                    <span className="flex flex-wrap items-center gap-1.5">
                      <span className="font-mono text-[12px] text-ink-2">{r.ref}</span>
                      <Pill tone={r.entity_type === 'advance' ? 'blue' : 'grey'}>{r.entity_type === 'advance' ? 'Cash advance' : 'Expense'}</Pill>
                      {r.policy.length ? (
                        <span className="inline-flex items-center gap-1 text-[11.5px] font-bold text-[#9A4A06] dark:text-warning">
                          <Icon name="warning" size={12} /> Flagged
                        </span>
                      ) : null}
                    </span>
                    <span className="text-ink">{r.description || <span className="text-ink-3">No description</span>}</span>
                    <span className="text-[11.5px] text-ink-3">
                      {[r.category, r.spent_on ? shortDate(r.spent_on) : null, r.label ? `Your step: ${r.label}` : null].filter(Boolean).join(' · ')}
                    </span>
                    {r.policy.length ? (
                      <span className="flex max-w-[520px] flex-col gap-1.5 pt-0.5">
                        <Blocks items={blocks} />
                        <Warnings items={warns} />
                      </span>
                    ) : null}
                  </span>
                  <span className="flex shrink-0 flex-col" style={{ width: W.claimant }}>
                    <span className="truncate text-ink-2">{r.claimant ?? '—'}</span>
                    <span className="truncate text-[11.5px] text-ink-3">{r.org ?? ''}</span>
                  </span>
                  <span className={cx('shrink-0 text-[12.5px]', r.days_waiting >= 7 ? 'font-bold text-danger' : 'text-ink-3')} style={{ width: W.waiting }}>
                    {waited(r.days_waiting)}
                  </span>
                  <span className="shrink-0 text-right font-bold whitespace-nowrap text-ink tabular-nums" style={{ width: W.amount }}>
                    {money(r.base_amount, currencyOf(r, orgs))}
                  </span>
                  <span className="flex shrink-0 flex-col items-end gap-1.5" style={{ width: W.actions }}>
                    {mayDecide ? (
                      <span className="flex gap-1.5">
                        <button type="button" className={btnGood} disabled={busy} onClick={() => setAsking({ kind: 'approve', items: [r], bulk: false })}>
                          Approve
                        </button>
                        <button type="button" className={btnBad} disabled={busy} onClick={() => setAsking({ kind: 'decline', items: [r], bulk: false })}>
                          Decline
                        </button>
                      </span>
                    ) : null}
                    {r.entity_type === 'claim' ? (
                      <button type="button" className="text-[11.5px] font-semibold text-primary hover:underline" onClick={() => onGo('team', `&claim=${r.entity_id}`)}>
                        Open the full claim
                      </button>
                    ) : (
                      <button type="button" className="text-[11.5px] font-semibold text-primary hover:underline" onClick={() => setAdvance(r.entity_id)}>
                        Open the advance
                      </button>
                    )}
                    {mayHand ? (
                      <button type="button" className="text-[11.5px] font-semibold text-ink-3 hover:text-ink hover:underline" onClick={() => setAsking({ kind: 'reassign', item: r })}>
                        Hand to somebody else
                      </button>
                    ) : null}
                  </span>
                </div>
              );
            })}
            {!rows.length ? (
              <div className="flex flex-col items-center gap-1 px-3.5 py-8 text-center text-[12.5px] text-ink-3">
                {all.length ? (
                  'Nothing matches those filters.'
                ) : elsewhere > 0 ? (
                  /* "Nothing is waiting for you" would be false — there are
                     items, in another company. Saying it here is how somebody
                     goes home with four approvals outstanding. */
                  <>
                    <b className="text-[13px] text-ink-2">Nothing is waiting for you in {here}.</b>
                    {elsewhere} {elsewhere === 1 ? 'approval is' : 'approvals are'} waiting in your other companies.
                  </>
                ) : (
                  <>
                    <b className="text-[13px] text-ink-2">Nothing is waiting for you.</b>
                    Claims routed to you appear here the moment they are filed.
                  </>
                )}
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      <Notice tone="grey">You cannot approve your own claim, even as an administrator — if one of yours is routed to you, an administrator has to reassign the step to somebody else.</Notice>

      {dupOrgs.length ? <LookAlikes orgs={dupOrgs} onOpenClaim={(id) => onGo('team', `&claim=${id}`)} /> : null}

      {asking?.kind === 'approve' && asking.bulk ? (
        <ConfirmSheet
          title={`Approve ${asking.items.length} item(s)?`}
          body="Each goes through the same approval ladder as a single decision. Anything you cannot decide — your own, or a step that has moved on — is refused and named."
          action="Approve them"
          busy={busy}
          onYes={() => void decide(asking.items, true, '', true)}
          onClose={() => setAsking(null)}
        />
      ) : null}
      {asking?.kind === 'approve' && !asking.bulk ? <ApproveSheet title={`Approve ${asking.items[0]!.ref}`} busy={busy} onOk={(note) => void decide(asking.items, true, note, false)} onClose={() => setAsking(null)} /> : null}
      {asking?.kind === 'decline' ? (
        <ReasonSheet
          title={asking.bulk ? `Decline ${asking.items.length} item(s)?` : `Decline ${asking.items[0]!.ref}`}
          body={asking.bulk ? 'The reason goes on every one of them, and it is all each claimant sees.' : 'Say why. The person who filed it sees exactly this.'}
          label={asking.bulk ? 'Why are these being declined?' : 'Reason'}
          action={asking.bulk ? 'Decline them' : 'Decline'}
          danger
          busy={busy}
          onOk={(note) => void decide(asking.items, false, note, asking.bulk)}
          onClose={() => setAsking(null)}
        />
      ) : null}
      {asking?.kind === 'reassign' ? <ReassignSheet item={asking.item} company={orgOf(asking.item.org_id)} me={me} busy={busy} onOk={(uid) => void reassign(asking.item, uid)} onClose={() => setAsking(null)} /> : null}
      {advance !== null ? <AdvancePanel key={advance} id={advance} orgs={orgs} onClose={() => setAdvance(null)} onOpenClaim={(_a, id) => onGo('team', `&claim=${id}`)} /> : null}
    </div>
  );
}

/**
 * Hand a step to somebody else — for the claim routed to its own claimant,
 * or an approver who is away. Only people who approve in that company are
 * offered: a step handed to a plain member would wait on somebody who cannot
 * decide it.
 */
function ReassignSheet({ item, company, me, busy, onOk, onClose }: { item: QueueItem; company: Org | undefined; me: number; busy: boolean; onOk: (userId: number) => void; onClose: () => void }) {
  const [who, setWho] = useState('');
  const q = useQuery({ queryKey: QK.members(item.org_id), queryFn: ({ signal }) => fetchMembers(item.org_id, signal), retry: false });
  const people = reassignable(q.data ?? [], me);
  const name = company?.name ?? item.org ?? 'this company';
  return (
    <Sheet
      title={`Hand ${item.ref} to somebody else`}
      onClose={onClose}
      width={480}
      footer={
        <>
          <button type="button" className={btn} onClick={onClose}>
            Cancel
          </button>
          <button type="button" className={btnPrimary} disabled={busy || !who} onClick={() => onOk(Number(who))}>
            {busy ? 'Working…' : 'Hand it over'}
          </button>
        </>
      }
    >
      <p className="m-0 text-[13px] text-ink-2">
        This step{item.label ? ` (${item.label})` : ''} is waiting on you. Whoever you choose decides it instead, and the step records that you reassigned it. Only people who approve in {name} are offered.
      </p>
      {q.isLoading ? <Spinner /> : null}
      {q.error ? <span className="text-[12.5px] text-danger">{refusal(q.error)}</span> : null}
      {q.data ? (
        people.length ? (
          <Field label="Hand it to">
            <Select<string>
              aria-label="Hand it to"
              searchable
              value={who}
              onValueChange={setWho}
              options={[{ value: '', label: 'Choose somebody…' }, ...people.map((m) => ({ value: String(m.user_id), label: m.name, hint: m.role ?? undefined }))]}
              className="h-[34px] w-full rounded-[8px] border border-line bg-surface px-2.5 text-[13px]"
            />
          </Field>
        ) : (
          <span className="text-[12.5px] text-ink-3">Nobody else approves in {name}. Give somebody the approver role there first.</span>
        )
      ) : null}
    </Sheet>
  );
}

/**
 * Claims that look like the same expense twice, per company. Arithmetic, not
 * an accusation: the server's own sentence says so above the list, and a
 * judgement of "the same expense" records the judgement and rejects nothing.
 */
function LookAlikes({ orgs, onOpenClaim }: { orgs: Org[]; onOpenClaim: (id: number) => void }) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState<number | null>(null);
  const results = useQueries({ queries: orgs.map((o) => ({ queryKey: QK.duplicates(o.id), queryFn: ({ signal }: { signal: AbortSignal }) => fetchDuplicates(o.id, signal), retry: false })) });

  const judge = async (orgId: number, d: Duplicate, same: boolean) => {
    setBusy(d.id);
    try {
      const r = await decideDuplicate(d.id, same);
      toast('success', r.message ?? (same ? 'Recorded.' : 'Dismissed.'));
      void qc.invalidateQueries({ queryKey: QK.duplicates(orgId) });
      // The dashboard counts open flags too.
      void qc.invalidateQueries({ queryKey: ['expenses', 's'] });
    } catch (e) {
      toast('error', refusal(e));
    } finally {
      setBusy(null);
    }
  };

  const failed = orgs.filter((_, i) => results[i]?.error);
  const found = orgs.map((o, i) => ({ o, r: results[i]?.data })).filter((x) => x.r && x.r.items.length);
  if (!found.length && !failed.length) return null;

  return (
    <Panel title="Claims that look like the same expense twice" sub={found[0]?.r?.note ?? undefined} bodyClassName="flex flex-col">
      {found.map(({ o, r }) => (
        <div key={o.id} className="flex flex-col">
          {orgs.length > 1 ? <div className="border-b border-line/60 bg-ground px-3.5 py-1.5 text-[11px] font-bold tracking-[.4px] text-ink-3 uppercase">{o.name}</div> : null}
          {r!.items.map((d) => (
            <div key={d.id} className="flex items-start gap-3 border-b border-line/60 px-3.5 py-2.5 text-[13px] last:border-b-0">
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="text-ink">{d.reason}</span>
                <span className="flex flex-wrap items-center gap-x-1.5 text-[11.5px] text-ink-3">
                  {d.claimant ? <span>{d.claimant}</span> : null}
                  <button type="button" className="font-mono text-primary hover:underline" onClick={() => onOpenClaim(d.claim_id)}>
                    {d.claim_no}
                  </button>
                  <span>and</span>
                  <button type="button" className="font-mono text-primary hover:underline" onClick={() => onOpenClaim(d.other_claim_id)}>
                    {d.other_no ?? `#${d.other_claim_id}`}
                  </button>
                  {d.spent_on ? <span>· {shortDate(d.spent_on)}</span> : null}
                  {d.amount ? <span>· {money(d.amount, d.currency ?? o.currency)}</span> : null}
                </span>
              </span>
              <span className="flex shrink-0 gap-1.5">
                <button type="button" className={btnSmall} disabled={busy === d.id} onClick={() => void judge(o.id, d, true)}>
                  Same expense twice
                </button>
                <button type="button" className={btnSmall} disabled={busy === d.id} onClick={() => void judge(o.id, d, false)}>
                  Different expenses
                </button>
              </span>
            </div>
          ))}
        </div>
      ))}
      {failed.length ? (
        <div className="px-3.5 py-2.5 text-[12px] text-ink-3">
          {failed.map((o) => o.name).join(', ')} could not be checked for look-alike claims. This is a failed request, not a statement that there are none.
        </div>
      ) : null}
    </Panel>
  );
}
