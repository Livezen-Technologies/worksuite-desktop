import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { app } from '../../core/app-state';
import { useStore } from '../../core/store';
import { toast } from '../../core/toasts';
import { Icon } from '../../components/Icon';
import { Select } from '../../components/Select';
import { Spinner, cx } from '../../components/ui';
import { btn, btnPrimary, Field, input, PageHead, Sheet } from '../../components/PageKit';
import { Pill } from '../../components/ListKit';
import { archiveAccount, BEHAVIOURS, can, COSTABLE, createAccount, fetchAccounts, flattenAccounts, K, refusal, setBehaviour, TYPES, type Account, type Company } from './api';
import { ConfirmSheet, LoadFailed } from '../../components/RecordKit';
import { Checkbox } from '../../components/Checkbox';

/**
 * The chart of accounts, as the tree it is.
 *
 * A heading is drawn apart from an account because posting to both a heading
 * and its children double-counts it in every report. System accounts carry a
 * lock: the posting engine finds them by role, and archiving one would stop
 * it. Archiving keeps the account and everything posted to it, and frees its
 * code — so a later account may reuse it, and reports then show both.
 *
 * Fixed or variable is set here, on postable cost accounts only; the cost
 * breakdown in the Financial overview reads it.
 */
export default function Accounts({ company }: { company: Company }) {
  const qc = useQueryClient();
  const perms = useStore(app, (s) => s.bootstrap?.permissions);
  const mayManage = can(perms, 'finance.accounts.manage');
  const q = useQuery({ queryKey: K.accounts(company.id), queryFn: ({ signal }) => fetchAccounts(company.id, signal), retry: false });
  const [adding, setAdding] = useState(false);
  const [archiving, setArchiving] = useState<Account | null>(null);
  const [busy, setBusy] = useState(0);
  const [find, setFind] = useState('');
  const flat = useMemo(() => flattenAccounts(q.data ?? []), [q.data]);

  if (q.isLoading) return <Spinner />;
  if (q.error) return <LoadFailed what="The chart of accounts" onRetry={() => void q.refetch()} />;
  if (!flat.length) return <p className="m-6 text-[13px] text-ink-2">No accounts yet. Opening the company's books adopts the template chart.</p>;

  const refresh = () => void qc.invalidateQueries({ queryKey: K.company(company.id) });
  const behaviour = async (a: Account, b: string) => {
    setBusy(a.id);
    try {
      await setBehaviour(company.id, a.id, b);
      refresh();
    } catch (e) {
      toast('error', refusal(e));
    } finally {
      setBusy(0);
    }
  };
  const archive = async (a: Account) => {
    setBusy(a.id);
    try {
      const r = await archiveAccount(company.id, a.id);
      toast('success', r?.message ?? `${a.code} ${a.name} archived.`);
      setArchiving(null);
      refresh();
    } catch (e) {
      // The refusal names why (children, a role that would strand) — shown as said.
      toast('error', refusal(e));
    } finally {
      setBusy(0);
    }
  };

  const term = find.trim().toLowerCase();
  const shown = term ? flat.filter((a) => a.code.toLowerCase().includes(term) || a.name.toLowerCase().includes(term)) : flat;
  const unclassified = flat.filter((a) => a.is_postable && COSTABLE.includes(a.type) && a.cost_behaviour === 'unclassified' && a.status !== 'archived').length;

  return (
    <div className="flex flex-col gap-3.5 px-6 py-5">
      <PageHead title="Chart of accounts" sub="A heading groups and sums; only postable accounts carry an entry.">
        <input value={find} onChange={(e) => setFind(e.target.value)} placeholder="Find a code or a name" aria-label="Find an account" className={cx(input, 'w-[220px]')} />
        {mayManage ? (
          <button type="button" className={btnPrimary} onClick={() => setAdding(true)}>
            <Icon name="plus" size={14} /> New account
          </button>
        ) : null}
      </PageHead>
      {unclassified > 0 && mayManage ? (
        <p className="m-0 text-[12px] text-ink-3">
          {unclassified} cost account{unclassified === 1 ? ' is' : 's are'} not classified as fixed or variable, so the cost breakdown leaves {unclassified === 1 ? 'it' : 'them'} out.
        </p>
      ) : null}
      <div className="overflow-hidden rounded-[12px] border border-line bg-surface">
        <div className="flex gap-2.5 border-b border-line bg-ground px-3.5 py-2 text-[11px] font-bold tracking-[.4px] text-ink-3 uppercase">
          <span className="w-[120px] shrink-0">Code</span>
          <span className="min-w-0 flex-1">Account</span>
          <span className="w-[140px] shrink-0">Type</span>
          <span className="w-[110px] shrink-0">Normal balance</span>
          <span className="w-[150px] shrink-0">Fixed or variable</span>
          <span className="w-[80px] shrink-0" />
        </div>
        {shown.map((a) => {
          const archived = a.status === 'archived';
          const costable = a.is_postable && COSTABLE.includes(a.type) && a.cost_behaviour !== undefined;
          return (
            <div key={a.id} className={cx('group flex items-center gap-2.5 border-b border-line/60 px-3.5 py-[7px] text-[13px] last:border-b-0', archived && 'opacity-60')}>
              <span className="w-[120px] shrink-0 font-mono text-[12px] text-ink-2" style={{ paddingLeft: term ? 0 : a.depth * 14 }}>
                {a.code}
              </span>
              <span className={cx('flex min-w-0 flex-1 items-center gap-1.5 truncate', a.is_postable ? 'text-ink' : 'font-bold text-ink-3')}>
                <span className="truncate">{a.name}</span>
                {a.is_system ? (
                  <span title="A system account — the engine posts to it by role, so it cannot be archived" className="flex shrink-0">
                    <Icon name="lock" size={12} className="text-ink-3" />
                  </span>
                ) : null}
                {archived ? <Pill tone="grey">Archived</Pill> : null}
              </span>
              <span className="w-[140px] shrink-0 truncate text-[12.5px] text-ink-3">{TYPES.find((t) => t.value === a.type)?.label ?? a.type}</span>
              <span className="w-[110px] shrink-0 text-[12.5px] text-ink-3">{a.is_postable ? (a.normal_balance === 'credit' ? 'Credit' : 'Debit') : 'Heading'}</span>
              <span className="w-[150px] shrink-0">
                {costable ? (
                  mayManage && !archived ? (
                    <Select
                      aria-label={`${a.code} fixed or variable`}
                      value={a.cost_behaviour ?? 'unclassified'}
                      disabled={busy === a.id}
                      onChange={(e) => void behaviour(a, e.target.value)}
                      className={cx('h-7 w-full rounded-[7px] border px-2 text-[12px]', a.cost_behaviour === 'unclassified' ? 'border-warning-line bg-warning-bg text-warning-strong dark:border-warning/40 dark:bg-warning-bg dark:text-warning' : 'border-line bg-surface text-ink-2')}
                    >
                      {BEHAVIOURS.map(([v, l]) => (
                        <option key={v} value={v}>
                          {l}
                        </option>
                      ))}
                    </Select>
                  ) : (
                    <span className="text-[12.5px] text-ink-3">{BEHAVIOURS.find(([v]) => v === a.cost_behaviour)?.[1] ?? a.cost_behaviour}</span>
                  )
                ) : null}
              </span>
              <span className="flex w-[80px] shrink-0 justify-end">
                {mayManage && !archived && !a.is_system ? (
                  <button type="button" disabled={busy === a.id} onClick={() => setArchiving(a)} className="rounded-[6px] px-2 py-1 text-[12px] font-semibold text-ink-3 opacity-0 group-hover:opacity-100 hover:bg-subtle hover:text-ink focus-visible:opacity-100">
                    Archive
                  </button>
                ) : null}
              </span>
            </div>
          );
        })}
        {!shown.length ? <div className="px-3.5 py-6 text-center text-[12.5px] text-ink-3">No account has that code or name.</div> : null}
      </div>
      {adding ? <NewAccount company={company} flat={flat} onClose={() => setAdding(false)} onDone={refresh} /> : null}
      {archiving ? (
        <ConfirmSheet
          title={`Archive ${archiving.code} ${archiving.name}?`}
          body="Everything posted to it stays in the books and in every report that covers those dates. It stops being offered when writing a journal, and its code becomes available again — so a later account may reuse it, and reports will then show both."
          action="Archive"
          busy={busy === archiving.id}
          onYes={() => void archive(archiving)}
          onClose={() => setArchiving(null)}
        />
      ) : null}
    </div>
  );
}

function NewAccount({ company, flat, onClose, onDone }: { company: Company; flat: Array<Account & { depth: number }>; onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({ code: '', name: '', type: 'expense', parent: '', postable: true });
  const [busy, setBusy] = useState(false);
  const normal = TYPES.find((t) => t.value === f.type)?.normal ?? 'debit';
  const clash = flat.some((a) => a.code === f.code.trim() && a.status !== 'archived');
  const ready = f.code.trim() !== '' && f.name.trim() !== '' && !clash;
  const save = async () => {
    setBusy(true);
    try {
      await createAccount(company.id, { code: f.code.trim(), name: f.name.trim(), type: f.type, parent_id: f.parent ? Number(f.parent) : null, is_postable: f.postable });
      toast('success', `${f.code.trim()} ${f.name.trim()} created.`);
      onDone();
      onClose();
    } catch (e) {
      toast('error', refusal(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet
      title="New account"
      onClose={onClose}
      width={520}
      footer={
        <>
          <button type="button" className={btn} onClick={onClose}>
            Cancel
          </button>
          <button type="button" className={btnPrimary} disabled={busy || !ready} onClick={() => void save()}>
            {busy ? 'Creating…' : 'Create'}
          </button>
        </>
      }
    >
      <div className="grid grid-cols-[140px_1fr] gap-3">
        <Field label="Code" hint={clash ? <span className="text-danger">This company already has a live {f.code.trim()}.</span> : undefined}>
          <input autoFocus value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} placeholder="6250" maxLength={40} className={cx(input, 'font-mono', clash && '!border-danger')} />
        </Field>
        <Field label="Name">
          <input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Staff training" className={input} />
        </Field>
      </div>
      <Field label="Type" hint={`${normal === 'debit' ? 'Debits increase it.' : 'Credits increase it.'} That follows from the type and cannot be set separately.`}>
        <Select aria-label="Account type" value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })} className="h-[34px] rounded-[8px] border border-line bg-surface px-2.5 text-[13px]">
          {TYPES.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Under">
        <Select aria-label="Parent account" searchable value={f.parent} onChange={(e) => setF({ ...f, parent: e.target.value })} className="h-[34px] rounded-[8px] border border-line bg-surface px-2.5 text-[13px]">
          <option value="">Nothing — a top-level account</option>
          {flat
            .filter((a) => a.status !== 'archived')
            .map((a) => (
              <option key={a.id} value={String(a.id)}>
                {`${' '.repeat(a.depth * 2)}${a.code} — ${a.name}`}
              </option>
            ))}
        </Select>
      </Field>
      <label className="flex items-start gap-2 text-[13px]">
        <Checkbox checked={f.postable} onChange={(e) => setF({ ...f, postable: e.target.checked })} className="mt-0.5" />
        <span>
          <span className="font-semibold text-ink">Entries can be posted to it</span>
          <span className="block text-[11.5px] text-ink-3">Turn this off for a heading. Posting to a heading and to its children double-counts it in every report.</span>
        </span>
      </label>
    </Sheet>
  );
}
