import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { app } from '../../core/app-state';
import { useStore } from '../../core/store';
import { toast } from '../../core/toasts';
import { Select } from '../../components/Select';
import { Spinner, cx } from '../../components/ui';
import { btn, btnPrimary, Cell, PageHead, row, THead } from '../hr/parts';
import { Pill } from '../inventory/parts';
import { can, K, money, refusal } from './api';
import { LoadFailed, Notice } from './parts';
import type { ScreenProps } from './Rail';
import { fetchAssetAccounts, forbiddenWhy, KS, mappingChanges, sameId, saveAssetAccounts } from './setup';

/**
 * Which fixed-asset account each asset category's cost is debited to.
 *
 * An opening balance debits a fixed-asset account, and the standard chart has
 * several — Property, Equipment, Vehicles, Computers. Nothing in the ledger
 * can decide which: an account role answers "which account does this company
 * use for X", not a per-asset question. So the answer comes from the asset's
 * category, and this is where somebody gives it. Until they do, capitalising
 * refuses every asset in the category by name.
 *
 * THE VALUE COLUMN IS NOT DECORATION. Mapping a category holding millions is a
 * different decision from mapping an empty one, and without the figure the two
 * look identical. The count already in the books is there for the same reason:
 * changing a mapping after some of a category is capitalised splits it across
 * two accounts, and the row says so before it is saved, not in next month's
 * balance sheet.
 *
 * The draft is held against the company it was made for, so switching company
 * with unsaved choices can never save them against the other company's chart.
 * Only the rows that changed are sent. Changing a mapping takes
 * `finance.accounts.manage`.
 */
export default function AssetAccounts({ company, onGo }: ScreenProps) {
  const qc = useQueryClient();
  const perms = useStore(app, (s) => s.bootstrap?.permissions);
  const mayManage = can(perms, 'finance.accounts.manage');
  const q = useQuery({ queryKey: KS.assetAccounts(company.id), queryFn: ({ signal }) => fetchAssetAccounts(company.id, signal), retry: false });
  const [draft, setDraft] = useState<{ c: number; map: Record<number, number | null> }>({ c: company.id, map: {} });
  const [busy, setBusy] = useState(false);
  const map = draft.c === company.id ? draft.map : {};

  if (q.isLoading) return <Spinner />;
  if (q.error || !q.data) {
    const why = forbiddenWhy(q.error);
    return why ? <Notice tone="grey" className="m-6">{why}</Notice> : <LoadFailed what="The fixed-asset mapping" onRetry={() => void q.refetch()} />;
  }

  const d = q.data;
  const head = (
    <PageHead
      title="Fixed-asset accounts"
      sub="Where each category's cost is debited when its assets are brought into the books. Until a category is mapped, nothing in it can be capitalised."
    />
  );
  if (d.unavailable === 'assets') {
    return (
      <div className="flex flex-col gap-3.5 px-6 py-5">
        {head}
        <Notice tone="grey">This installation has no asset register, so there is nothing to map.</Notice>
      </div>
    );
  }
  const cats = d.categories ?? [];
  if (!cats.length) {
    return (
      <div className="flex flex-col gap-3.5 px-6 py-5">
        {head}
        <Notice tone="grey">No asset categories exist yet.</Notice>
      </div>
    );
  }

  const accounts = d.accounts ?? [];
  const base = company.base_currency ?? '';
  const current = (id: number, saved: number | null) => (id in map ? (map[id] ?? null) : saved);
  const changes = mappingChanges(cats, map);
  const dirty = Object.keys(changes).length;
  const unmapped = cats.filter((c) => current(c.id, c.account_id) === null).length;
  const nameOf = (id: number | null) => {
    const a = accounts.find((x) => sameId(x.id, id));
    return a ? `${a.code} ${a.name}` : null;
  };

  const save = async () => {
    setBusy(true);
    try {
      await saveAssetAccounts(company.id, changes);
      toast('success', dirty === 1 ? 'One category mapped.' : `${dirty} categories mapped.`);
      setDraft({ c: company.id, map: {} });
      // The unposted list carries the reason capitalisation is refused, and that reason has just changed.
      void qc.invalidateQueries({ queryKey: K.company(company.id) });
    } catch (e) {
      toast('error', refusal(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-3.5 px-6 py-5">
      {head}
      {unmapped > 0 ? (
        <Notice tone="amber">
          {unmapped} categor{unmapped === 1 ? 'y is' : 'ies are'} not mapped, so nothing in {unmapped === 1 ? 'it' : 'them'} can be capitalised.{' '}
          <button type="button" className="font-semibold underline" onClick={() => onGo('unposted')}>
            Not in the ledger
          </button>{' '}
          lists the assets that are waiting.
        </Notice>
      ) : null}
      <div className="overflow-x-auto rounded-[12px] border border-line bg-surface">
        <div className="min-w-[760px]">
          <THead
            cols={[
              ['Category', null],
              ['Assets', 70],
              ['At cost', 150],
              ['Debited to', 280],
            ]}
          />
          {cats.map((c) => {
            const now = current(c.id, c.account_id);
            const moved = c.id in changes;
            return (
              <div key={c.id} className="flex flex-col border-b border-line/70 last:border-b-0">
                <div className={cx(row, 'border-b-0')}>
                  <span className="flex min-w-0 flex-1 items-center gap-2">
                    <span className="truncate">{c.name}</span>
                    {c.capitalised > 0 ? (
                      <span title="Changing this now would split the category across two accounts">
                        <Pill tone="amber">{c.capitalised} already in the books</Pill>
                      </span>
                    ) : null}
                  </span>
                  <Cell w={70} className="text-right text-ink-3 tabular-nums">
                    {c.asset_count}
                  </Cell>
                  <Cell w={150} className="text-right tabular-nums">
                    {money(c.total, base)}
                  </Cell>
                  <span className="w-[280px] shrink-0">
                    {mayManage ? (
                      <Select<string>
                        aria-label={`${c.name} debited to`}
                        searchable
                        value={now === null ? '' : String(now)}
                        disabled={busy}
                        onValueChange={(v) => setDraft({ c: company.id, map: { ...map, [c.id]: v === '' ? null : Number(v) } })}
                        options={[{ value: '', label: 'Not mapped' }, ...accounts.map((a) => ({ value: String(a.id), label: `${a.code} ${a.name}` }))]}
                        className={cx('h-[30px] w-full rounded-[7px] border px-2 text-[12.5px]', moved && 'bg-selection')}
                      />
                    ) : (
                      <span className={cx('text-[12.5px]', now === null ? 'text-[#9A4A06] dark:text-warning' : 'text-ink-2')}>{nameOf(now) ?? 'Not mapped'}</span>
                    )}
                  </span>
                </div>
                {moved && c.capitalised > 0 ? (
                  <p className="m-0 px-3.5 pb-2 text-[12px] text-[#9A4A06] dark:text-warning">
                    {c.capitalised} of its assets are already in the books under {nameOf(c.account_id) ?? 'the old account'}. Saving this sends the rest to {nameOf(now) ?? 'no account'}, so the category will sit across two accounts.
                  </p>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>
      {mayManage ? (
        <div className="sticky bottom-0 flex items-center justify-end gap-2 border-t border-line bg-ground py-2.5">
          <span className="mr-auto text-[12px] text-ink-3">{dirty ? `${dirty} unsaved ${dirty === 1 ? 'change' : 'changes'}` : 'Choose an asset account for each category.'}</span>
          {dirty ? (
            <button type="button" className={btn} onClick={() => setDraft({ c: company.id, map: {} })}>
              Discard
            </button>
          ) : null}
          <button type="button" className={btnPrimary} disabled={busy || !dirty} onClick={() => void save()}>
            {busy ? 'Saving…' : 'Save mapping'}
          </button>
        </div>
      ) : (
        <p className="m-0 text-[12px] text-ink-3">
          Changing where a category is debited needs <code className="font-mono text-[11.5px]">finance.accounts.manage</code>.
        </p>
      )}
    </div>
  );
}
