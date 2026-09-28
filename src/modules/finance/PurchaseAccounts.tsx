import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { app } from '../../core/app-state';
import { useStore } from '../../core/store';
import { toast } from '../../core/toasts';
import { Select } from '../../components/Select';
import { Spinner, cx } from '../../components/ui';
import { Empty, PageHead, Panel } from '../hr/parts';
import { Pill } from '../inventory/parts';
import { can, refusal } from './api';
import { LoadFailed, Notice } from './parts';
import type { ScreenProps } from './Rail';
import { accountLabel, fetchPurchaseAccounts, forbiddenWhy, KS, saveMapping, sameId, type MappingAccount, type MappingKind } from './setup';

/**
 * Where each supplier's and each product category's money goes — both ways.
 *
 * THE SUPPLIER COMES FIRST, because it is the axis that has data. A services
 * company never fills in a product catalogue, and a screen of categories only
 * reads as "purchases cannot be mapped" rather than "map them by supplier".
 *
 * THE FALLBACK IS SHOWN, NOT LEFT BLANK. An unmapped row is not inert: every
 * purchase in it lands on the purchases account, which is where all of them
 * landed before this screen existed. An empty cell would say "nothing happens
 * here" and give nobody a reason to map anything.
 *
 * The precedence is stated because two rules can apply to one line, and a
 * reader who does not know which wins cannot predict where the money lands.
 * The sale side has no customer rung on purpose: a supplier reliably sells one
 * kind of thing, a customer buys whatever they like.
 *
 * Each choice saves as it is made, one row per request. Changing one takes
 * `finance.accounts.manage`; without it the mapping is shown as text.
 */
export default function PurchaseAccounts({ company }: ScreenProps) {
  const qc = useQueryClient();
  const perms = useStore(app, (s) => s.bootstrap?.permissions);
  const mayManage = can(perms, 'finance.accounts.manage');
  const q = useQuery({ queryKey: KS.purchaseAccounts(company.id), queryFn: ({ signal }) => fetchPurchaseAccounts(company.id, signal), retry: false, enabled: company.has_books });
  const [busy, setBusy] = useState('');

  if (!company.has_books) return <Notice tone="grey" className="m-6">{company.name} has no general ledger yet.</Notice>;
  if (q.isLoading) return <Spinner />;
  if (q.error || !q.data) {
    const why = forbiddenWhy(q.error);
    return why ? <Notice tone="grey" className="m-6">{why}</Notice> : <LoadFailed what="The purchase accounts" onRetry={() => void q.refetch()} />;
  }

  const d = q.data;
  const cost = accountLabel(d.fallback, 'the purchases account');
  const sales = accountLabel(d.revenue_fallback, 'the sales account');
  const save = async (kind: MappingKind, id: number, account: number | null) => {
    const key = `${kind}:${id}`;
    setBusy(key);
    try {
      await saveMapping(company.id, kind, id, account);
      toast('success', account === null ? 'Cleared — it uses the default again.' : 'Mapped.');
      void qc.invalidateQueries({ queryKey: KS.purchaseAccounts(company.id) });
    } catch (e) {
      // The refusal explains why an asset account is not offered, and it is long on purpose.
      toast('error', refusal(e));
    } finally {
      setBusy('');
    }
  };

  const picker = (kind: MappingKind, id: number, label: string, value: number | null, accounts: MappingAccount[], empty: string) =>
    mayManage ? (
      <Select<string>
        aria-label={label}
        searchable
        value={value === null ? '' : String(value)}
        disabled={busy === `${kind}:${id}`}
        onValueChange={(v) => void save(kind, id, v === '' ? null : Number(v))}
        options={[{ value: '', label: empty }, ...accounts.map((a) => ({ value: String(a.id), label: `${a.code} ${a.name}` }))]}
        className="h-[30px] w-full rounded-[7px] border px-2 text-[12.5px]"
      />
    ) : (
      <span className={cx('block truncate text-[12.5px]', value === null ? 'text-ink-3' : 'text-ink-2')}>{value === null ? empty : accountLabel(accounts.find((a) => sameId(a.id, value)), `Account ${value}`)}</span>
    );

  return (
    <div className="flex flex-col gap-3.5 px-6 py-5">
      <PageHead
        title="Purchase accounts"
        sub={
          <>
            Where each category's money goes — the account a purchase is debited to, and the one a sale is credited as. Anything unmapped uses <b>{cost}</b> for cost and <b>{sales}</b> for revenue — where every purchase and every sale went before this screen existed.
          </>
        }
      />

      <div className="grid max-w-[860px] grid-cols-2 gap-3">
        <Ladder title="A bill line is debited to">
          <li>The account on the bill line itself, if one was chosen.</li>
          <li>The product's category — what was bought.</li>
          <li>The supplier — who sold it.</li>
          <li>
            Otherwise <b>{cost}</b>.
          </li>
        </Ladder>
        <Ladder title="An invoice line is credited to">
          <li>The account on the invoice line itself, if one was chosen.</li>
          <li>The product's category — what was sold.</li>
          <li>
            Otherwise <b>{sales}</b>.
          </li>
        </Ladder>
      </div>

      <Panel title="Suppliers" sub="What this supplier's bills are normally bought for. This is the rule that works when a bill has no product on it — a services invoice — which is most of them." bodyClassName="flex flex-col">
        {d.vendors.length === 0 ? (
          <Empty text="There are no suppliers yet. Add them in the Purchasing module and they will appear here." />
        ) : (
          d.vendors.map((v) => (
            <div key={v.vendor_id} className="flex items-center gap-3 border-b border-line/60 px-3.5 py-2 text-[13px] last:border-b-0">
              <span className="flex min-w-0 flex-1 items-center gap-2">
                <span className="truncate text-ink">{v.name}</span>
                {v.status && v.status !== 'active' ? <Pill tone="grey">{v.status.charAt(0).toUpperCase() + v.status.slice(1)}</Pill> : null}
              </span>
              {v.account_id === null && d.fallback ? <span className="shrink-0 text-[12px] text-ink-3">default · {cost}</span> : null}
              <span className="w-[280px] shrink-0">{picker('vendor', v.vendor_id, `${v.name} bought into`, v.account_id, d.accounts, 'Use the default')}</span>
            </div>
          ))
        )}
      </Panel>

      <Panel title="Product categories" sub="What was bought. More specific about the cost than who sold it, so this beats the supplier rule on any line that names a product." bodyClassName="flex flex-col">
        {d.categories.length === 0 ? (
          <Empty text="There are no product categories yet. They are optional — map suppliers above instead if you do not keep a catalogue." />
        ) : (
          <>
            {/* Both sides on one row: a category is bought into one account and sold as another, and the pair is what has to make sense together. */}
            <div className="flex shrink-0 gap-3 border-b border-line bg-ground px-3.5 py-2 text-[11px] font-bold tracking-[.4px] text-ink-3 uppercase">
              <span className="min-w-0 flex-1">Category</span>
              <span className="w-[240px] shrink-0">Bought into</span>
              <span className="w-[240px] shrink-0">Sold as</span>
            </div>
            {d.categories.map((r) => (
              <div key={r.category_id} className="flex items-center gap-3 border-b border-line/60 px-3.5 py-2 text-[13px] last:border-b-0">
                <span className="min-w-0 flex-1 truncate text-ink" style={{ paddingLeft: (r.depth ?? 0) * 14 }} title={r.name}>
                  {r.name}
                </span>
                <span className="w-[240px] shrink-0">{picker('cost', r.category_id, `${r.name} bought into`, r.account_id, d.accounts, d.fallback ? `${cost} (default)` : 'Default')}</span>
                <span className="w-[240px] shrink-0">{picker('revenue', r.category_id, `${r.name} sold as`, r.revenue_account_id, d.revenue_accounts ?? [], d.revenue_fallback ? `${sales} (default)` : 'Default')}</span>
              </div>
            ))}
          </>
        )}
      </Panel>

      {/* Stock is deliberately not offered, and said plainly rather than left as a puzzle about a missing option. */}
      <Notice tone="grey" className="max-w-[860px]">
        Only cost and expense accounts can be chosen. Buying stock into <b>1140 Inventory</b> would mean holding it on the balance sheet, and that only works once something moves the cost out to cost of sales when the stock is sold — which this product does not do yet. Until then the cost would sit in Inventory for ever, and every statement would still balance.
      </Notice>
      {!mayManage ? (
        <p className="m-0 text-[12px] text-ink-3">
          Changing a mapping needs <code className="font-mono text-[11.5px]">finance.accounts.manage</code>.
        </p>
      ) : null}
    </div>
  );
}

function Ladder({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="rounded-[10px] border border-line bg-surface px-3.5 py-2.5">
      <div className="mb-1 text-[11px] font-bold tracking-[.4px] text-ink-3 uppercase">{title}</div>
      <ol className="m-0 flex list-decimal flex-col gap-0.5 pl-5 text-[12.5px] text-ink-2">{children}</ol>
    </div>
  );
}
