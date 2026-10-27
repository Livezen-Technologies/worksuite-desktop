import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useMemo, useState, type ReactNode } from 'react';
import { app } from '../../core/app-state';
import { useStore } from '../../core/store';
import { todayInZone } from '../../core/time';
import { toast } from '../../core/toasts';
import { Icon } from '../../components/Icon';
import { Select } from '../../components/Select';
import { Spinner, cx } from '../../components/ui';
import { refusal, shortDate } from '../finance/api';
import { ConfirmSheet, LoadFailed, Notice, ReasonSheet } from '../finance/parts';
import { btn, btnBad, btnGood, btnPrimary, btnSmall, Caps, Facts, Field, input, Kpi, PageHead, Seg, Sheet, SidePanel } from '../hr/parts';
import { minWidth } from '../inventory/parts';
import { can, canAct, money, type Org } from './api';
import {
  ADVANCE_SORTS,
  attachClaim,
  blankDraft,
  chargeable,
  decideOne,
  disburseAdvance,
  draftProblem,
  fetchAdvance,
  fetchAdvances,
  fetchClaimsFor,
  fetchRelated,
  filterAdvances,
  holds,
  isOutstandingGuard,
  kindLabel,
  KINDS,
  methodLabel,
  mayDecideAdvance,
  mineOnly,
  PAYMENT_METHODS,
  positive,
  QK,
  requestAdvance,
  settleAdvance,
  settledBalance,
  settleSummary,
  sortAdvances,
  TOUCHED,
  type Advance,
  type AdvanceDraft,
  type AdvanceScope,
  type AdvanceSort,
  type Position,
} from './approvals-api';
import { StatusPill, words } from './parts';
import type { ScreenProps } from './Rail';
import { StatGrid } from '../../components/StatCard';

/**
 * Cash advances: asking for money before a trip, and squaring up after it.
 *
 * THE SETTLEMENT IS THE HEART OF THIS SCREEN. One advance shows what was
 * advanced, what has been accounted for, and who owes whom — from each side by
 * name rather than as a signed number, because a negative figure in a "refund
 * due" column is read backwards by everybody at least once. Once settled, the
 * figures shown are the ones it was settled at: the server freezes them, so a
 * claim corrected later cannot quietly rewrite a settlement already actioned.
 *
 * NOTHING HERE MOVES MONEY. "Paid out" and "settled" are records that a person
 * did something elsewhere. Every message on the screen says so.
 *
 * One company: the list and a request name it. `openAdvance` — the shell's
 * reading of `&advance=<id>`, as the dashboard and notifications link one —
 * opens that advance; closing it goes back to the plain list.
 */
export default function Advances({ org, orgId, orgs, onGo, openAdvance }: ScreenProps & { openAdvance: number | null }) {
  // The shell sends one company here; without one there is nothing to list.
  if (orgId === null) return null;
  return <AdvancesIn org={org} orgId={orgId} orgs={orgs} onGo={onGo} openAdvance={openAdvance} />;
}

/** Everything a decision, a payout or a settlement changes. */
export const touch = (qc: QueryClient) => {
  for (const k of TOUCHED) void qc.invalidateQueries({ queryKey: k });
};

// Column widths. Amount is in the advance's own currency; Accounted and Balance
// are in the COMPANY's, which is why that one is passed down rather than read
// off the row — printing one label over the other figure is the mistake.
const W = { advance: 190, amount: 150, status: 110, accounted: 140, balance: 190 };

function AdvancesIn({ orgId, orgs, onGo, openAdvance }: ScreenProps & { orgId: number; openAdvance: number | null }) {
  const me = Number(useStore(app, (s) => s.auth?.user?.id) ?? 0);
  const company = orgs.find((o) => o.id === orgId) ?? null;
  const [scope, setScope] = useState<AdvanceScope>('mine');
  const [asking, setAsking] = useState(false);
  const [picked, setPicked] = useState<number | null>(null);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [sort, setSort] = useState<AdvanceSort>('created');
  const [dir, setDir] = useState<'asc' | 'desc'>('desc');
  const list = useQuery({ queryKey: QK.advances(orgId, scope), queryFn: ({ signal }) => fetchAdvances(orgId, scope, signal), retry: false });

  const data = list.data;
  const finance = data?.role === 'finance' || data?.role === 'admin';
  const base = data?.currency || company?.currency || '';
  // A request is for the asker's own advance, which takes membership: a super-administrator acting here holds none.
  const mayRequest = !!company && canAct(company) && company.member;

  const all = useMemo(() => {
    const items = data?.items ?? [];
    return scope === 'mine' && finance && me > 0 ? mineOnly(items, me) : items;
  }, [data, scope, finance, me]);
  const statuses = useMemo(() => [...new Set(all.map((a) => a.status).filter(Boolean))].sort(), [all]);

  /* Filtered and sorted here: the server returns this person's — or this
     company's — advances whole, and an advance is a rare, deliberate act
     rather than a transaction stream. */
  const rows = useMemo(() => sortAdvances(filterAdvances(all, { q, status }), sort, dir), [all, q, status, sort, dir]);

  const openId = picked ?? openAdvance;
  const close = () => {
    setPicked(null);
    // The address opened it; leaving it there would open it again on the next visit.
    if (openAdvance !== null) onGo('advances');
  };
  const openClaim = (a: Advance, claimId: number) => onGo(a.user_id === me ? 'mine' : 'team', `&claim=${claimId}`);

  return (
    <div className="flex flex-col gap-3.5 px-6 py-5">
      <PageHead title="Cash advances" sub="Money given before it is spent, and the settlement that closes it.">
        {mayRequest ? (
          <button type="button" className={btnPrimary} onClick={() => setAsking(true)}>
            <Icon name="plus" size={14} /> Request an advance
          </button>
        ) : null}
      </PageHead>

      {list.isLoading ? <Spinner /> : null}
      {list.error ? <LoadFailed what="The advances" onRetry={() => void list.refetch()} /> : null}

      {data ? (
        <>
          <StatGrid min={200}>
            <Kpi icon="wallet" label="You are holding" value={money(data.outstanding.total, base)} sub={`${data.outstanding.count} advance(s) not yet settled`} tone={data.outstanding.count > 0 ? 'amber' : undefined} />
          </StatGrid>

          <div className="flex flex-wrap items-center gap-2">
            {finance ? (
              <Seg
                label="Whose advances"
                value={scope}
                onChange={setScope}
                options={[
                  { id: 'mine', label: 'Mine' },
                  { id: 'organization', label: 'Everyone' },
                ]}
              />
            ) : null}
            <div className="relative">
              <Icon name="search" size={14} className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-ink-3" />
              <input value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search advances" placeholder="Search number, purpose, person" className={cx(input, 'w-[240px] pl-8')} />
            </div>
            <Select<string>
              aria-label="Filter by status"
              value={status}
              onValueChange={setStatus}
              options={[{ value: '', label: 'Any status' }, ...statuses.map((v) => ({ value: v, label: words(v) }))]}
              className="h-[34px] rounded-[8px] border border-line bg-surface px-2.5 text-[13px]"
            />
            <Select<AdvanceSort> aria-label="Sort by" value={sort} onValueChange={setSort} options={ADVANCE_SORTS} className="h-[34px] rounded-[8px] border border-line bg-surface px-2.5 text-[13px]" />
            <button type="button" className={cx(btn, 'w-[34px] justify-center px-0')} aria-label={dir === 'asc' ? 'Sort ascending' : 'Sort descending'} onClick={() => setDir(dir === 'asc' ? 'desc' : 'asc')}>
              <Icon name={dir === 'asc' ? 'arrow-up' : 'arrow-down'} size={14} />
            </button>
          </div>

          <div className="overflow-x-auto rounded-[12px] border border-line bg-surface">
            <div style={{ minWidth: minWidth(220, Object.values(W)) }}>
              <div className="flex gap-2.5 border-b border-line bg-ground px-3.5 py-2 text-[11px] font-bold tracking-[.4px] text-ink-3 uppercase">
                <span className="shrink-0" style={{ width: W.advance }}>
                  Advance
                </span>
                <span className="min-w-0 flex-1">For</span>
                <span className="shrink-0 text-right" style={{ width: W.amount }}>
                  Amount
                </span>
                <span className="shrink-0" style={{ width: W.status }}>
                  Status
                </span>
                <span className="shrink-0 text-right" style={{ width: W.accounted }}>
                  Accounted
                </span>
                <span className="shrink-0 text-right" style={{ width: W.balance }}>
                  Balance
                </span>
              </div>
              {rows.map((a) => (
                <button key={a.id} type="button" onClick={() => setPicked(a.id)} className={cx('flex w-full items-center gap-2.5 border-b border-line/60 px-3.5 py-[9px] text-left text-[13px] last:border-b-0 hover:bg-subtle', openId === a.id && 'bg-selection')}>
                  <span className="flex shrink-0 flex-col" style={{ width: W.advance }}>
                    <span className="font-mono text-[12px] text-ink-2">{a.advance_no}</span>
                    <span className="truncate text-ink">{a.claimant ?? '—'}</span>
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-ink">{a.purpose}</span>
                    <span className="truncate text-[11.5px] text-ink-3">
                      {kindLabel(a.kind)}
                      {a.project ? ` · ${a.project}` : ''}
                      {a.vendor ? ` · ${a.vendor}` : ''}
                    </span>
                  </span>
                  <span className="shrink-0 text-right font-semibold whitespace-nowrap text-ink tabular-nums" style={{ width: W.amount }}>
                    {money(a.amount, a.currency ?? base)}
                  </span>
                  <span className="shrink-0" style={{ width: W.status }}>
                    <StatusPill status={a.status} />
                  </span>
                  <span className="shrink-0 text-right whitespace-nowrap text-ink-2 tabular-nums" style={{ width: W.accounted }}>
                    {a.status === 'settled' && a.settled_amount !== null ? money(a.settled_amount, base) : '—'}
                  </span>
                  <span className="shrink-0 text-right text-[12.5px] whitespace-nowrap" style={{ width: W.balance }}>
                    <Balance a={a} base={base} />
                  </span>
                </button>
              ))}
              {!rows.length ? (
                <div className="flex flex-col items-center gap-1 px-3.5 py-8 text-center text-[12.5px] text-ink-3">
                  {all.length ? (
                    'No advances match those filters.'
                  ) : (
                    <>
                      <b className="text-[13px] text-ink-2">No advances here.</b>
                      An advance is money handed over before a trip, settled against the receipts afterwards.
                    </>
                  )}
                </div>
              ) : null}
            </div>
          </div>
        </>
      ) : null}

      <Notice tone="grey">No money moves through this software. &ldquo;Paid out&rdquo; and &ldquo;settled&rdquo; record that somebody made a transfer or handed over cash elsewhere.</Notice>

      {asking && company ? <RequestSheet company={company} onClose={() => setAsking(false)} /> : null}
      {openId !== null ? <AdvancePanel key={openId} id={openId} orgs={orgs} onClose={close} onOpenClaim={openClaim} /> : null}
    </div>
  );
}

function Balance({ a, base }: { a: Advance; base: string }) {
  const b = settledBalance(a);
  if (b.side === 'open') return <span className="text-ink-3">—</span>;
  if (b.side === 'due_back') return <span className="font-semibold text-warning-ink dark:text-warning">{money(b.amount, base)} due back</span>;
  if (b.side === 'owed') return <span className="font-semibold text-primary">{money(b.amount, base)} owed to them</span>;
  return <span className="font-semibold text-success">came out even</span>;
}

// ── asking for one ───────────────────────────────────────────────────────

function RequestSheet({ company, onClose }: { company: Org; onClose: () => void }) {
  const qc = useQueryClient();
  const [d, setD] = useState<AdvanceDraft>(blankDraft);
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<string | null>(null);
  const [guard, setGuard] = useState<string | null>(null);
  const needsRecord = d.kind === 'project' || d.kind === 'vendor';
  const related = useQuery({ queryKey: QK.related(company.id), queryFn: ({ signal }) => fetchRelated(company.id, signal), enabled: needsRecord, retry: false, staleTime: 60_000 });
  const problem = draftProblem(d);
  const touched = d.amount !== '' || d.purpose !== '';
  const set = (patch: Partial<AdvanceDraft>) => setD((x) => ({ ...x, ...patch }));

  const save = async (allowMultiple: boolean) => {
    setBusy(true);
    setSaid(null);
    try {
      const r = await requestAdvance(company.id, d, allowMultiple);
      toast('success', r.message ?? 'Requested.');
      touch(qc);
      onClose();
    } catch (e) {
      const msg = refusal(e);
      if (!allowMultiple && isOutstandingGuard(msg)) setGuard(msg);
      else setSaid(msg);
    } finally {
      setBusy(false);
    }
  };

  const records = d.kind === 'project' ? (related.data?.project ?? []) : (related.data?.vendor ?? []);

  return (
    <Sheet
      title="Request a cash advance"
      onClose={onClose}
      width={500}
      footer={
        <>
          <button type="button" className={btn} onClick={onClose}>
            Cancel
          </button>
          <button type="button" className={btnPrimary} disabled={busy || problem !== null} onClick={() => void save(false)}>
            {busy ? 'Sending…' : 'Request it'}
          </button>
        </>
      }
    >
      <p className="m-0 text-[12.5px] text-ink-3">In {company.name}. It goes through the company&rsquo;s approval steps before anybody hands money over.</p>
      <div className="grid grid-cols-2 gap-3">
        <Field label="What kind">
          <Select<string> aria-label="What kind" value={d.kind} onValueChange={(v) => set({ kind: v, project_id: '', vendor_id: '' })} options={KINDS} className="h-[34px] w-full rounded-[8px] border border-line bg-surface px-2.5 text-[13px]" />
        </Field>
        <Field label={`Amount (${company.currency})`}>
          <input inputMode="decimal" aria-label="Amount" value={d.amount} onChange={(e) => set({ amount: e.target.value })} placeholder="0.00" className={cx(input, 'text-right tabular-nums')} />
        </Field>
      </div>
      {needsRecord ? (
        <Field label={d.kind === 'project' ? 'Which project' : 'Which vendor'}>
          {related.isLoading ? (
            <Spinner />
          ) : related.error ? (
            <span className="text-[12px] font-medium text-danger">The list could not be loaded. This is a failed request, not an empty list.</span>
          ) : (
            <Select<string>
              aria-label={d.kind === 'project' ? 'Which project' : 'Which vendor'}
              searchable
              value={d.kind === 'project' ? d.project_id : d.vendor_id}
              onValueChange={(v) => set(d.kind === 'project' ? { project_id: v } : { vendor_id: v })}
              options={[{ value: '', label: d.kind === 'project' ? 'Choose a project…' : 'Choose a vendor…' }, ...records.map((r) => ({ value: String(r.id), label: r.label }))]}
              empty={d.kind === 'project' ? 'No projects yet' : 'No vendors yet'}
              className="h-[34px] w-full rounded-[8px] border border-line bg-surface px-2.5 text-[13px]"
            />
          )}
        </Field>
      ) : null}
      <Field label="What it is for" hint="Somebody approves it on this basis, so be specific.">
        <textarea aria-label="What it is for" rows={3} value={d.purpose} onChange={(e) => set({ purpose: e.target.value })} className="resize-none rounded-[8px] border border-line bg-surface px-2.5 py-2 text-[13px] font-medium text-ink outline-none focus:border-primary" />
      </Field>
      <Field label="Needed by">
        <input type="date" aria-label="Needed by" min={todayInZone()} value={d.needed_by} onChange={(e) => set({ needed_by: e.target.value })} className={cx(input, 'w-[180px]')} />
      </Field>
      {touched && problem ? <span className="text-[12px] text-ink-3">{problem}</span> : null}
      {said ? <Notice tone="red">{said}</Notice> : null}
      {guard ? (
        <ConfirmSheet
          title="You already hold an advance"
          body={
            <>
              <p className="mt-0">{guard}</p>
              <p className="mb-0">Ask for another one anyway?</p>
            </>
          }
          action="Ask anyway"
          busy={busy}
          onYes={() => {
            setGuard(null);
            void save(true);
          }}
          onClose={() => setGuard(null)}
        />
      ) : null}
    </Sheet>
  );
}

// ── one advance ──────────────────────────────────────────────────────────

type Asking = null | 'approve' | 'decline' | 'disburse' | 'settle' | 'attach';

/**
 * One advance: where it stands, what has been charged to it, and the next act
 * — deciding it, recording the payout, settling it. Opened from this screen
 * and from the approval queue, so it resolves the company from the advance
 * itself and gates each act on the person's role there.
 */
export function AdvancePanel({ id, orgs, onClose, onOpenClaim }: { id: number; orgs: Org[]; onClose: () => void; onOpenClaim?: (a: Advance, claimId: number) => void }) {
  const qc = useQueryClient();
  const me = Number(useStore(app, (s) => s.auth?.user?.id) ?? 0);
  const perms = useStore(app, (s) => s.bootstrap?.permissions);
  const q = useQuery({ queryKey: QK.advance(id), queryFn: ({ signal }) => fetchAdvance(id, signal), retry: false });
  const [asking, setAsking] = useState<Asking>(null);
  const [busy, setBusy] = useState(false);
  const p = q.data;
  const a = p?.advance;
  const org = a ? orgs.find((o) => o.id === a.org_id) : undefined;

  const mayDecide = !!p && can(perms, 'expense.approve') && mayDecideAdvance(p, me, org);
  const mayPay = can(perms, 'expense.pay') && holds(org, 'finance');
  // The claimant charges their own claims; finance may charge anybody's.
  const mayAttach = !!a && (a.status === 'approved' || a.status === 'disbursed') && ((a.user_id === me && holds(org, 'member')) || holds(org, 'finance'));

  const act = async (run: () => Promise<{ message: string | null }>, fallback: string) => {
    setBusy(true);
    try {
      const r = await run();
      toast('success', r.message ?? fallback);
      setAsking(null);
      touch(qc);
    } catch (e) {
      toast('error', refusal(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <SidePanel
      label={a ? `Advance ${a.advance_no}` : 'Advance'}
      width={580}
      onClose={onClose}
      head={
        a ? (
          <>
            <span className="flex min-w-0 flex-col">
              <b className="font-mono text-[14px] text-ink">{a.advance_no}</b>
              <span className="truncate text-[12px] text-ink-3">{a.purpose}</span>
            </span>
            <StatusPill status={a.status} />
          </>
        ) : (
          <b className="text-ink">Advance</b>
        )
      }
    >
      {q.isLoading ? <Spinner /> : null}
      {q.error ? <LoadFailed what="That advance" onRetry={() => void q.refetch()} /> : null}
      {p && a ? (
        <>
          <div className="text-[13px]">
            <Facts
              rows={[
                ['Asked by', a.claimant ?? '—'],
                ['Company', org?.name ?? '—'],
                ['Kind', `${kindLabel(a.kind)}${a.project ? ` · ${a.project}` : ''}${a.vendor ? ` · ${a.vendor}` : ''}`],
                ['Asked for', `${money(a.amount, a.currency ?? p.currency)}${a.currency && a.currency !== p.currency && a.base_amount ? ` (${money(a.base_amount, p.currency)})` : ''}`],
                ['Needed by', a.needed_by ? shortDate(a.needed_by) : '—'],
                ...(a.disbursed_at ? ([['Paid out', `${shortDate(a.disbursed_at)}${a.disbursed_method ? ` · ${methodLabel(a.disbursed_method)}` : ''}`]] as Array<[string, ReactNode]>) : []),
                ...(a.decision_note ? ([['Decision note', a.decision_note]] as Array<[string, ReactNode]>) : []),
              ]}
            />
          </div>

          <Standing p={p} />

          <section className="flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <Caps>Spending charged to it</Caps>
              <span className="flex-1" />
              {mayAttach ? (
                <button type="button" className={btnSmall} onClick={() => setAsking('attach')}>
                  <Icon name="link" size={13} /> <span className="ml-1">Charge a claim to it</span>
                </button>
              ) : null}
            </div>
            {p.lines.length === 0 ? (
              <div className="rounded-[10px] border border-line px-3.5 py-4 text-center text-[12.5px] text-ink-3">
                <b className="block text-ink-2">Nothing has been charged to this advance yet.</b>
                File a claim and choose this advance on the form.
              </div>
            ) : (
              <div className="overflow-hidden rounded-[10px] border border-line">
                <div className="flex gap-2.5 border-b border-line bg-ground px-3 py-2 text-[11px] font-bold tracking-[.4px] text-ink-3 uppercase">
                  <span className="w-[96px] shrink-0">Claim</span>
                  <span className="w-[86px] shrink-0">Date</span>
                  <span className="min-w-0 flex-1">What</span>
                  <span className="w-[120px] shrink-0 text-right">Amount</span>
                  <span className="w-[92px] shrink-0">Status</span>
                </div>
                {p.lines.map((l) => (
                  <div key={l.claim_id} className="flex items-center gap-2.5 border-b border-line/60 px-3 py-2 text-[13px] last:border-b-0">
                    <span className="w-[96px] shrink-0">
                      {onOpenClaim ? (
                        <button type="button" className="font-mono text-[12px] text-primary hover:underline" onClick={() => onOpenClaim(a, l.claim_id)}>
                          {l.claim_no}
                        </button>
                      ) : (
                        <span className="font-mono text-[12px] text-ink-2">{l.claim_no}</span>
                      )}
                    </span>
                    <span className="w-[86px] shrink-0 text-ink-2">{shortDate(l.spent_on)}</span>
                    <span className="min-w-0 flex-1 truncate text-ink">{l.description}</span>
                    <span className="w-[120px] shrink-0 text-right tabular-nums">{money(l.base_amount, p.currency)}</span>
                    <span className="w-[92px] shrink-0">
                      <StatusPill status={l.status} />
                    </span>
                  </div>
                ))}
              </div>
            )}
          </section>

          {mayDecide || (mayPay && (a.status === 'approved' || a.status === 'disbursed')) ? (
            <div className="flex flex-wrap items-center gap-2 border-t border-line pt-3">
              {mayDecide ? (
                <>
                  <button type="button" className={btnGood} disabled={busy} onClick={() => setAsking('approve')}>
                    Approve
                  </button>
                  <button type="button" className={btnBad} disabled={busy} onClick={() => setAsking('decline')}>
                    Decline
                  </button>
                </>
              ) : null}
              {mayPay && a.status === 'approved' ? (
                <button type="button" className={btnPrimary} disabled={busy} onClick={() => setAsking('disburse')}>
                  Record it as paid out
                </button>
              ) : null}
              {mayPay && a.status === 'disbursed' ? (
                <button type="button" className={btnPrimary} disabled={busy || !p.settleable} title={p.settleable ? undefined : (p.blocked_by ?? undefined)} onClick={() => setAsking('settle')}>
                  Settle it
                </button>
              ) : null}
            </div>
          ) : null}

          {p.approvals.length ? (
            <section className="flex flex-col gap-1">
              <Caps>Approval</Caps>
              <ol className="m-0 flex list-none flex-col gap-1.5 p-0 text-[13px] text-ink-2">
                {p.approvals.map((s) => (
                  <li key={s.id} className={cx(!s.live && 'opacity-60')}>
                    <b className="text-ink">{s.label ?? `Step ${s.step}`}</b> — {words(s.status).toLowerCase()}
                    {s.approver && s.status === 'pending' ? ` with ${s.approver}` : ''}
                    {s.decided_by ? ` by ${s.decided_by}` : ''}
                    {s.decided_at ? `, ${shortDate(s.decided_at)}` : ''}
                    {!s.live ? <span className="ml-1 text-[11.5px] text-ink-3">(an earlier round)</span> : null}
                    {s.note ? <span className="block text-[12px] text-ink-3">{s.note}</span> : null}
                  </li>
                ))}
              </ol>
            </section>
          ) : null}

          {asking === 'approve' ? (
            <ApproveSheet title={`Approve ${a.advance_no}`} busy={busy} onOk={(note) => void act(() => decideOne({ entity_type: 'advance', entity_id: a.id }, true, note), 'Approved.')} onClose={() => setAsking(null)} />
          ) : null}
          {asking === 'decline' ? (
            <ReasonSheet
              title={`Decline ${a.advance_no}`}
              body="Say why. The person who asked for it sees exactly this."
              label="Reason"
              action="Decline"
              danger
              busy={busy}
              onOk={(note) => void act(() => decideOne({ entity_type: 'advance', entity_id: a.id }, false, note), 'Rejected.')}
              onClose={() => setAsking(null)}
            />
          ) : null}
          {asking === 'disburse' ? <DisburseSheet advance={a} busy={busy} onOk={(m) => void act(() => disburseAdvance(a.id, m), 'Recorded as paid out.')} onClose={() => setAsking(null)} /> : null}
          {asking === 'settle' ? (
            <ConfirmSheet
              title="Settle this advance"
              body={
                <div className="flex flex-col gap-2">
                  {settleSummary(p, a.claimant).map((line) => (
                    <p key={line} className="m-0">
                      {line}
                    </p>
                  ))}
                </div>
              }
              action="Settle it"
              busy={busy}
              onYes={() => void act(() => settleAdvance(a.id), 'Settled.')}
              onClose={() => setAsking(null)}
            />
          ) : null}
          {asking === 'attach' ? <AttachSheet position={p} me={me} busy={busy} onOk={(claimId) => void act(() => attachClaim(a.id, claimId), 'Charged to the advance.')} onClose={() => setAsking(null)} /> : null}
        </>
      ) : null}
    </SidePanel>
  );
}

/**
 * Who owes whom. Before settlement it is the live position, from the claims
 * charged so far; after it, the figures it was settled at, which the server
 * stored and will not recompute.
 */
function Standing({ p }: { p: Position }) {
  const a = p.advance;
  const m = (v: string | null) => money(v ?? '0', p.currency);
  if (a.status === 'settled') {
    const b = settledBalance(a);
    return (
      <section className="flex flex-col gap-2">
        <StatGrid min={150}>
          <Kpi icon="banknote" tone="blue" label="Advanced" value={m(a.base_amount)} />
          <Kpi icon="receipt-text" tone="violet" label="Accounted for" value={m(a.settled_amount)} />
          <Kpi icon="undo" label="Due back to the company" value={m(a.refund_amount)} tone={b.side === 'due_back' ? 'amber' : undefined} />
          <Kpi icon="hand-coins" label="Company owes them" value={m(a.topup_amount)} tone={b.side === 'owed' ? 'green' : undefined} />
        </StatGrid>
        <span className="text-[12px] text-ink-3">
          Settled{a.settled_at ? ` on ${shortDate(a.settled_at)}` : ''}. These are the figures it was settled at; a later correction to a claim does not change them.
        </span>
      </section>
    );
  }
  return (
    <section className="flex flex-col gap-2">
      <StatGrid min={150}>
        <Kpi icon="banknote" tone="blue" label="Advanced" value={m(p.advanced)} />
        <Kpi icon="receipt-text" tone="violet" label="Accounted for" value={m(p.accounted)} />
        <Kpi icon="undo" label="Due back to the company" value={m(p.refund_due)} tone={positive(p.refund_due) ? 'amber' : undefined} />
        <Kpi icon="hand-coins" label="Company owes them" value={m(p.company_due)} tone={positive(p.company_due) ? 'green' : undefined} />
      </StatGrid>
      {positive(p.pending) && p.blocked_by ? <Notice tone="amber">{p.blocked_by}</Notice> : null}
    </section>
  );
}

/** Approving takes an optional note; declining takes a reason (the ReasonSheet). */
export function ApproveSheet({ title, body, busy, onOk, onClose }: { title: string; body?: ReactNode; busy: boolean; onOk: (note: string) => void; onClose: () => void }) {
  const [note, setNote] = useState('');
  return (
    <Sheet
      title={title}
      onClose={onClose}
      width={480}
      footer={
        <>
          <button type="button" className={btn} onClick={onClose}>
            Cancel
          </button>
          <button type="button" className={btnPrimary} disabled={busy} onClick={() => onOk(note.trim())}>
            {busy ? 'Working…' : 'Approve'}
          </button>
        </>
      }
    >
      <div className="text-[13px] leading-[1.55] text-ink-2">{body ?? 'Add a note, if you want one on the record.'}</div>
      <label className="flex flex-col gap-1 text-[12.5px] font-semibold text-ink">
        Note (optional)
        <textarea autoFocus value={note} onChange={(e) => setNote(e.target.value)} rows={3} className="resize-none rounded-[8px] border border-line bg-surface px-2.5 py-2 text-[13px] font-medium text-ink outline-none focus:border-primary" />
      </label>
    </Sheet>
  );
}

function DisburseSheet({ advance, busy, onOk, onClose }: { advance: Advance; busy: boolean; onOk: (method: string) => void; onClose: () => void }) {
  const [method, setMethod] = useState('');
  return (
    <Sheet
      title="Record the payout"
      onClose={onClose}
      width={460}
      footer={
        <>
          <button type="button" className={btn} onClick={onClose}>
            Cancel
          </button>
          <button type="button" className={btnPrimary} disabled={busy || !method} onClick={() => onOk(method)}>
            {busy ? 'Working…' : 'Record it as paid out'}
          </button>
        </>
      }
    >
      <p className="m-0 text-[13px] text-ink-2">
        {advance.advance_no}, {money(advance.amount, advance.currency ?? '')} to {advance.claimant ?? 'the person who asked'}. This records that somebody handed the money over elsewhere — no money moves through this software.
      </p>
      <Field label="How was it handed over?">
        <Select<string> aria-label="How was it handed over?" value={method} onValueChange={setMethod} options={[{ value: '', label: 'Choose how…' }, ...PAYMENT_METHODS]} className="h-[34px] w-full rounded-[8px] border border-line bg-surface px-2.5 text-[13px]" />
      </Field>
    </Sheet>
  );
}

function AttachSheet({ position, me, busy, onOk, onClose }: { position: Position; me: number; busy: boolean; onOk: (claimId: number) => void; onClose: () => void }) {
  const a = position.advance;
  const [claim, setClaim] = useState('');
  const q = useQuery({ queryKey: QK.claimsFor(a.org_id, a.user_id), queryFn: ({ signal }) => fetchClaimsFor(a.org_id, a.user_id, me, signal), retry: false });
  const options = chargeable(q.data ?? [], position.lines);
  const who = a.user_id === me ? 'you' : (a.claimant ?? 'the person who holds it');
  return (
    <Sheet
      title={`Charge a claim to ${a.advance_no}`}
      onClose={onClose}
      width={520}
      footer={
        <>
          <button type="button" className={btn} onClick={onClose}>
            Cancel
          </button>
          <button type="button" className={btnPrimary} disabled={busy || !claim} onClick={() => onOk(Number(claim))}>
            {busy ? 'Working…' : 'Charge it'}
          </button>
        </>
      }
    >
      <p className="m-0 text-[13px] text-ink-2">Only claims filed by {who} in this company can be charged to it, and a claim can be charged to one advance only. What it spent counts once the claim is approved.</p>
      {q.isLoading ? <Spinner /> : null}
      {q.error ? <span className="text-[12.5px] text-danger">The claims could not be loaded. This is a failed request, not an empty list.</span> : null}
      {q.data ? (
        options.length ? (
          <Field label="Which claim">
            <Select<string>
              aria-label="Which claim"
              searchable
              value={claim}
              onValueChange={setClaim}
              options={[{ value: '', label: 'Choose a claim…' }, ...options.map((c) => ({ value: String(c.id), label: `${c.claim_no} · ${c.description || 'No description'}`, hint: `${shortDate(c.spent_on)} · ${money(c.base_amount, c.base_currency ?? position.currency)} · ${words(c.status)}` }))]}
              className="h-[34px] w-full rounded-[8px] border border-line bg-surface px-2.5 text-[13px]"
            />
          </Field>
        ) : (
          <span className="text-[12.5px] text-ink-3">There are no claims by {who} in this company that could still be charged to it.</span>
        )
      ) : null}
    </Sheet>
  );
}
