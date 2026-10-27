import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { app } from '../../core/app-state';
import { useStore } from '../../core/store';
import { todayInZone } from '../../core/time';
import { toast } from '../../core/toasts';
import { Icon } from '../../components/Icon';
import { Select } from '../../components/Select';
import { Spinner, cx } from '../../components/ui';
import { btn, btnPrimary, btnSmall, Field, input, PageHead, Seg, Sheet, SidePanel } from '../hr/parts';
import { Pill } from '../inventory/parts';
import {
  advanceJournal,
  can,
  createJournal,
  draftProblems,
  fetchAccounts,
  fetchJournal,
  fetchJournals,
  fromCents,
  isZero,
  K,
  money,
  NEXT,
  postable,
  problemsOf,
  refusal,
  reverseJournal,
  shortDate,
  type Company,
  type DraftLine,
} from './api';
import { ConfirmSheet, JournalPill, LoadFailed, Notice, ReasonSheet, Withheld } from './parts';

/**
 * The journals, newest first, and one journal's lines.
 *
 * Status is the column that matters. A draft and a posted journal can carry
 * the same figures and mean different things — one is in the books, the other
 * is somebody's intention.
 *
 * The next step is offered by status, not permission: submit, approve (by
 * somebody other than the writer), post, and then only reverse. Hiding
 * Approve from the writer would leave a journal waiting with nothing on screen
 * saying why; the server's refusal is that explanation. Approving is asserting
 * the lines are right, so the lines are one click away on every row.
 */
type Filter = 'all' | 'open' | 'posted' | 'reversed';

const bump = (qc: ReturnType<typeof useQueryClient>, company: number) => void qc.invalidateQueries({ queryKey: ['finance', 'c', company] });

export default function Journals({ company, openId, making, onOpen, onMake }: { company: Company; openId: number | null; making: boolean; onOpen: (id: number | null) => void; onMake: (on: boolean) => void }) {
  const perms = useStore(app, (s) => s.bootstrap?.permissions);
  const mayWrite = can(perms, 'finance.journal.create');
  const q = useQuery({ queryKey: K.journals(company.id), queryFn: ({ signal }) => fetchJournals(company.id, signal), retry: false });
  const [filter, setFilter] = useState<Filter>('all');

  if (q.isLoading) return <Spinner />;
  if (q.error) return <LoadFailed what="The journals" onRetry={() => void q.refetch()} />;

  const rows = q.data?.journals ?? [];
  const figures = q.data?.may_read_figures !== false;
  const base = q.data?.base_currency ?? company.base_currency ?? '';
  const open = rows.filter((j) => j.status === 'draft' || j.status === 'pending' || j.status === 'approved');
  const shown = filter === 'open' ? open : filter === 'posted' ? rows.filter((j) => j.status === 'posted') : filter === 'reversed' ? rows.filter((j) => j.status === 'reversed' || j.reverses_id) : rows;

  return (
    <div className="flex flex-col gap-3.5 px-6 py-5">
      <PageHead title="Journals" sub="A hand-written journal is saved as a draft, submitted, approved by somebody else, then posted.">
        <Seg
          label="Show"
          value={filter}
          onChange={setFilter}
          options={[
            { id: 'all', label: 'All' },
            { id: 'open', label: open.length ? `Not yet posted · ${open.length}` : 'Not yet posted' },
            { id: 'posted', label: 'Posted' },
            { id: 'reversed', label: 'Reversals' },
          ]}
        />
        {mayWrite ? (
          <button type="button" className={btnPrimary} onClick={() => onMake(true)}>
            <Icon name="plus" size={14} /> New journal
          </button>
        ) : null}
      </PageHead>
      {!figures ? <Withheld /> : null}
      <div className="overflow-hidden rounded-[12px] border border-line bg-surface">
        <div className="flex gap-2.5 border-b border-line bg-ground px-3.5 py-2 text-[11px] font-bold tracking-[.4px] text-ink-3 uppercase">
          <span className="w-[112px] shrink-0">Number</span>
          <span className="w-[100px] shrink-0">Date</span>
          <span className="min-w-0 flex-1">Description</span>
          <span className="w-[140px] shrink-0">Status</span>
          <span className="w-[170px] shrink-0 text-right">Amount</span>
        </div>
        {shown.map((j) => (
          <button key={j.id} type="button" onClick={() => onOpen(j.id)} className={cx('flex w-full items-center gap-2.5 border-b border-line/60 px-3.5 py-[9px] text-left text-[13px] last:border-b-0 hover:bg-subtle', openId === j.id && 'bg-selection')}>
            <span className="w-[112px] shrink-0 font-mono text-[12px] text-ink-2">{j.journal_no}</span>
            <span className="w-[100px] shrink-0 text-ink-2">{shortDate(j.entry_date)}</span>
            <span className="flex min-w-0 flex-1 items-center gap-1.5">
              <span className="truncate text-ink">{j.description || <span className="text-ink-3">No description</span>}</span>
              {j.reversed_by_id ? <span className="shrink-0 text-[11.5px] font-semibold text-danger">reversed</span> : null}
              {j.reverses_id ? <span className="shrink-0 text-[11.5px] text-ink-3">a reversal</span> : null}
              {j.source_type && j.source_type !== 'manual' ? <Pill tone="grey">{j.source_type.replace(/_/g, ' ')}</Pill> : null}
            </span>
            <span className="w-[140px] shrink-0">
              <JournalPill status={j.status} />
            </span>
            <span className="flex w-[170px] shrink-0 flex-col items-end tabular-nums">
              {figures && j.total_debit !== undefined ? (
                <>
                  <span className="text-ink">{money(j.total_debit, base)}</span>
                  {j.currency_total && j.currency !== base ? <span className="text-[11px] text-ink-3">{money(j.currency_total, j.currency)} as struck</span> : null}
                </>
              ) : (
                <span className="text-ink-3">—</span>
              )}
            </span>
          </button>
        ))}
        {!shown.length ? (
          <div className="flex flex-col items-center gap-2 px-3.5 py-8 text-center text-[12.5px] text-ink-3">
            {rows.length ? 'Nothing here with that filter.' : 'No journals yet.'}
            {!rows.length && mayWrite ? (
              <button type="button" className={btn} onClick={() => onMake(true)}>
                Write the first one
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
      {openId ? <JournalPanel key={openId} company={company} id={openId} base={base} onOpen={onOpen} /> : null}
      {making && mayWrite ? <JournalEntry company={company} onClose={() => onMake(false)} onSaved={(id) => (id ? onOpen(id) : onMake(false))} /> : null}
    </div>
  );
}

// ── one journal ──────────────────────────────────────────────────────────

function JournalPanel({ company, id, base, onOpen }: { company: Company; id: number; base: string; onOpen: (id: number | null) => void }) {
  const qc = useQueryClient();
  const perms = useStore(app, (s) => s.bootstrap?.permissions);
  const q = useQuery({ queryKey: K.journal(company.id, id), queryFn: ({ signal }) => fetchJournal(company.id, id, signal), retry: false });
  const [asking, setAsking] = useState<'post' | 'reverse' | null>(null);
  const [busy, setBusy] = useState(false);
  const [reverseOn, setReverseOn] = useState('');
  const j = q.data?.journal;
  const lines = q.data?.lines ?? [];
  const cur = q.data?.base_currency ?? base;
  // The server leaves the amount keys out rather than zeroing them.
  const figures = lines.length === 0 || lines[0]!.debit !== undefined;
  const next = j ? NEXT[j.status] : undefined;
  const mayReverse = !!j && j.status === 'posted' && !j.reversed_by_id && !j.reverses_id && can(perms, 'finance.journal.post');

  const step = async () => {
    if (!j || !next) return;
    setBusy(true);
    try {
      await advanceJournal(company.id, j.id, next.path);
      toast('success', `${j.journal_no}: ${next.done}`);
      setAsking(null);
      bump(qc, company.id);
    } catch (e) {
      toast('error', refusal(e));
    } finally {
      setBusy(false);
    }
  };
  const reverse = async (reason: string) => {
    if (!j) return;
    setBusy(true);
    try {
      const r = await reverseJournal(company.id, j.id, reason, reverseOn || undefined);
      const warning = r?.problems?.[0];
      if (warning) toast('warning', `${j.journal_no} is reversed${r?.journal_no ? ` by ${r.journal_no}` : ''}, but: ${warning}`);
      else toast('success', `${j.journal_no} reversed${r?.journal_no ? ` by ${r.journal_no}` : ''}.`);
      setAsking(null);
      bump(qc, company.id);
    } catch (e) {
      toast('error', refusal(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <SidePanel
      label={j ? `Journal ${j.journal_no}` : 'Journal'}
      width={620}
      onClose={() => onOpen(null)}
      head={
        j ? (
          <>
            <span className="flex min-w-0 flex-col">
              <b className="font-mono text-[14px] text-ink">{j.journal_no}</b>
              <span className="text-[12px] text-ink-3">{shortDate(j.entry_date)}</span>
            </span>
            <JournalPill status={j.status} />
          </>
        ) : (
          <b className="text-ink">Journal</b>
        )
      }
    >
      {q.isLoading ? <Spinner /> : null}
      {q.error ? <LoadFailed what="That journal" onRetry={() => void q.refetch()} /> : null}
      {j ? (
        <>
          {j.description || j.reference || (j.source_type && j.source_type !== 'manual') ? (
            <div className="flex flex-col gap-1 rounded-[10px] bg-ground px-3.5 py-2.5 text-[13px]">
              {j.description ? <span className="text-ink">{j.description}</span> : null}
              {j.reference ? <span className="text-[12px] text-ink-3">Reference {j.reference}</span> : null}
              {j.source_type && j.source_type !== 'manual' ? <span className="text-[12px] text-ink-3">Raised automatically from {j.source_type.replace(/_/g, ' ')}.</span> : null}
            </div>
          ) : null}
          {j.reversed_by_id || j.reverses_id ? (
            <div className="flex flex-wrap gap-2 text-[12.5px]">
              {j.reversed_by_id ? (
                <button type="button" className={btnSmall} onClick={() => onOpen(j.reversed_by_id)}>
                  Open the reversal <Icon name="chevron-right" size={13} />
                </button>
              ) : null}
              {j.reverses_id ? (
                <button type="button" className={btnSmall} onClick={() => onOpen(j.reverses_id)}>
                  Open the journal it reverses <Icon name="chevron-right" size={13} />
                </button>
              ) : null}
            </div>
          ) : null}
          <div className="overflow-hidden rounded-[12px] border border-line">
            <div className="flex gap-2.5 border-b border-line bg-ground px-3 py-2 text-[11px] font-bold tracking-[.4px] text-ink-3 uppercase">
              <span className="min-w-0 flex-1">Account</span>
              <span className="w-[120px] shrink-0 text-right">Debit</span>
              <span className="w-[120px] shrink-0 text-right">Credit</span>
            </div>
            {lines.map((l) => (
              <div key={l.id} className="flex gap-2.5 border-b border-line/60 px-3 py-2 text-[13px] last:border-b-0">
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate">
                    <b className="font-mono text-[12px] text-ink">{l.account_code}</b> <span className="text-ink-2">{l.account_name}</span>
                    {l.account_status && l.account_status !== 'active' ? <span className="ml-1 text-[11.5px] text-warning-ink dark:text-warning">({l.account_status})</span> : null}
                  </span>
                  {l.description ? <span className="truncate text-[12px] text-ink-3">{l.description}</span> : null}
                </span>
                <span className="w-[120px] shrink-0 text-right tabular-nums">{l.debit !== undefined && !isZero(l.debit) ? money(l.debit) : <span className="text-ink-3">—</span>}</span>
                <span className="w-[120px] shrink-0 text-right tabular-nums">{l.credit !== undefined && !isZero(l.credit) ? money(l.credit) : <span className="text-ink-3">—</span>}</span>
              </div>
            ))}
            {figures && j.total_debit !== undefined ? (
              <div className="flex gap-2.5 border-t-2 border-line bg-ground px-3 py-2 text-[13px] font-bold">
                <span className="min-w-0 flex-1 text-ink-2">
                  {lines.length} line{lines.length === 1 ? '' : 's'} · {cur}
                </span>
                <span className="w-[120px] shrink-0 text-right tabular-nums">{money(j.total_debit)}</span>
                <span className="w-[120px] shrink-0 text-right tabular-nums">{money(j.total_credit ?? '0')}</span>
              </div>
            ) : null}
          </div>
          {!figures ? <Withheld /> : null}
          {next || mayReverse ? (
            <div className="flex flex-wrap items-center gap-2">
              {next ? (
                <button type="button" className={btnPrimary} disabled={busy} onClick={() => (next.path === 'post' ? setAsking('post') : void step())}>
                  {busy && asking === null ? 'Working…' : next.label}
                </button>
              ) : null}
              {mayReverse ? (
                <button type="button" className={btn} disabled={busy} onClick={() => setAsking('reverse')}>
                  Reverse…
                </button>
              ) : null}
              {j.status === 'pending' ? <span className="text-[12px] text-ink-3">Somebody other than the writer approves it.</span> : null}
            </div>
          ) : null}
        </>
      ) : null}
      {asking === 'post' && j ? (
        <ConfirmSheet
          title={`Post ${j.journal_no}?`}
          body="Once it is in the books it cannot be edited or deleted. Correcting it afterwards means a reversal, which leaves both entries on the record."
          action="Post it"
          danger
          busy={busy}
          onYes={() => void step()}
          onClose={() => setAsking(null)}
        />
      ) : null}
      {asking === 'reverse' && j ? (
        <ReasonSheet
          title={`Reverse ${j.journal_no}?`}
          body="A reversal is a new journal with the sides swapped, pointing at this one. Both stay in the books — the reason is the only record of why."
          label="Why is it being reversed?"
          action="Reverse"
          danger
          busy={busy}
          extra={
            <Field label="Date the reversal" hint={`Not before ${shortDate(j.entry_date)}, the original's date, and not inside a reconciled range. Leave empty for the original's date.`}>
              <input type="date" value={reverseOn} min={j.entry_date} onChange={(e) => setReverseOn(e.target.value)} className={input} />
            </Field>
          }
          onOk={(r) => void reverse(r)}
          onClose={() => setAsking(null)}
        />
      ) : null}
    </SidePanel>
  );
}

// ── writing one ──────────────────────────────────────────────────────────

const blank = (): DraftLine => ({ key: Math.random().toString(36).slice(2), account_id: '', description: '', debit: '', credit: '' });

/**
 * Writing a journal by hand. The totals and the difference update as it is
 * typed — added up in cents, as the server does, so the difference shown is
 * the one the server would find. The server stays the check: it knows whether
 * the period is open and whether a line falls in a reconciled range.
 */
function JournalEntry({ company, onClose, onSaved }: { company: Company; onClose: () => void; onSaved: (id: number | null) => void }) {
  const qc = useQueryClient();
  const accountsQ = useQuery({ queryKey: K.accounts(company.id), queryFn: ({ signal }) => fetchAccounts(company.id, signal), retry: false });
  const accounts = useMemo(() => postable(accountsQ.data ?? []), [accountsQ.data]);
  const [date, setDate] = useState(() => todayInZone());
  const [description, setDescription] = useState('');
  const [reference, setReference] = useState('');
  const [lines, setLines] = useState<DraftLine[]>(() => [blank(), blank()]);
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<string[]>([]);
  const check = draftProblems(lines);
  const balanced = !check.bad && check.dr === check.cr && check.dr > 0;

  const set = (key: string, patch: Partial<DraftLine>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  // A line is a debit or a credit, never both: typing in one side clears the other.
  const amount = (key: string, side: 'debit' | 'credit', v: string) => set(key, side === 'debit' ? { debit: v, credit: '' } : { credit: v, debit: '' });

  const save = async () => {
    setBusy(true);
    setSaid([]);
    try {
      const r = await createJournal(company.id, { entry_date: date, description, reference, lines });
      void qc.invalidateQueries({ queryKey: ['finance', 'c', company.id] });
      toast('success', 'Saved as a draft — it needs approving before it can be posted.');
      onSaved(r?.id ? Number(r.id) : null);
    } catch (e) {
      // Every problem, at once: one at a time turns a four-mistake journal into four round trips.
      setSaid(problemsOf(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet
      title="New journal"
      onClose={onClose}
      width={940}
      footer={
        <>
          <span className="mr-auto self-center text-[12px] text-ink-3">Saved as a draft. Somebody other than you approves it before it reaches the books.</span>
          <button type="button" className={btn} onClick={onClose}>
            Cancel
          </button>
          <button type="button" className={btnPrimary} disabled={busy || check.problems.length > 0} onClick={() => void save()}>
            {busy ? 'Saving…' : 'Save draft'}
          </button>
        </>
      }
    >
      {accountsQ.isLoading ? <Spinner /> : null}
      <div className="grid grid-cols-[170px_1fr] gap-3">
        <Field label="Date">
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={input} />
        </Field>
        <Field label="Description">
          <input autoFocus value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What this entry is for" className={input} />
        </Field>
      </div>
      <Field label="Reference">
        <input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="An invoice number, a bank reference — anything that ties this to a document" className={input} />
      </Field>
      <div className="overflow-hidden rounded-[12px] border border-line">
        <div className="flex gap-2 border-b border-line bg-ground px-3 py-2 text-[11px] font-bold tracking-[.4px] text-ink-3 uppercase">
          <span className="w-[280px] shrink-0">Account</span>
          <span className="min-w-0 flex-1">Line description</span>
          <span className="w-[120px] shrink-0 text-right">Debit</span>
          <span className="w-[120px] shrink-0 text-right">Credit</span>
          <span className="w-[30px] shrink-0" />
        </div>
        {lines.map((l, i) => {
          const bad = check.bad && (!/^\d*(\.\d{0,2})?$/.test(l.debit.trim().replace(/,/g, '')) || !/^\d*(\.\d{0,2})?$/.test(l.credit.trim().replace(/,/g, '')));
          return (
            <div key={l.key} className="flex items-center gap-2 border-b border-line/60 px-3 py-1.5 last:border-b-0">
              <span className="w-[280px] shrink-0">
                <Select aria-label={`Line ${i + 1} account`} searchable value={l.account_id} onChange={(e) => set(l.key, { account_id: e.target.value })} className="h-[32px] w-full rounded-[7px] border border-line bg-surface px-2 text-[12.5px]">
                  <option value="">Choose an account…</option>
                  {accounts.map((a) => (
                    <option key={a.id} value={String(a.id)}>
                      {a.code} — {a.name}
                    </option>
                  ))}
                </Select>
              </span>
              <input aria-label={`Line ${i + 1} description`} value={l.description} onChange={(e) => set(l.key, { description: e.target.value })} className={cx(input, 'h-[32px] min-w-0 flex-1')} />
              <input aria-label={`Line ${i + 1} debit`} inputMode="decimal" placeholder="0.00" value={l.debit} onChange={(e) => amount(l.key, 'debit', e.target.value)} className={cx(input, 'h-[32px] w-[120px] shrink-0 text-right tabular-nums', bad && '!border-danger')} />
              <input aria-label={`Line ${i + 1} credit`} inputMode="decimal" placeholder="0.00" value={l.credit} onChange={(e) => amount(l.key, 'credit', e.target.value)} className={cx(input, 'h-[32px] w-[120px] shrink-0 text-right tabular-nums', bad && '!border-danger')} />
              <button
                type="button"
                aria-label={`Remove line ${i + 1}`}
                title={lines.length <= 2 ? 'A journal needs at least two lines' : 'Remove this line'}
                disabled={lines.length <= 2}
                onClick={() => setLines((ls) => (ls.length > 2 ? ls.filter((x) => x.key !== l.key) : ls))}
                className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-[7px] text-ink-3 hover:bg-subtle hover:text-danger disabled:opacity-30"
              >
                <Icon name="trash" size={14} />
              </button>
            </div>
          );
        })}
        <div className="flex items-center gap-2 border-t-2 border-line bg-ground px-3 py-2 text-[13px] font-bold">
          <button type="button" className={cx(btnSmall, 'w-[280px] shrink-0 justify-center')} onClick={() => setLines((ls) => [...ls, blank()])}>
            <Icon name="plus" size={13} /> Add a line
          </button>
          <span className="min-w-0 flex-1 text-right text-ink-2">Total</span>
          <span className="w-[120px] shrink-0 text-right tabular-nums">{money(fromCents(check.dr))}</span>
          <span className="w-[120px] shrink-0 text-right tabular-nums">{money(fromCents(check.cr))}</span>
          <span className="w-[30px] shrink-0" />
        </div>
      </div>
      <Notice tone={balanced && !said.length ? 'green' : 'amber'}>
        {said.length ? (
          <>
            <b>The server refused it{said.length > 1 ? ` — ${said.length} problems` : ''}:</b>
            <ul className="mt-1 mb-0 pl-4">
              {said.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          </>
        ) : balanced ? (
          'Debits equal credits.'
        ) : (
          <>
            {check.problems[0] ?? 'Fill in at least two lines.'}
            {check.problems.length > 1 ? <span className="ml-1 opacity-75">and {check.problems.length - 1} more.</span> : null}
          </>
        )}
      </Notice>
    </Sheet>
  );
}
