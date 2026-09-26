import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { app } from '../../core/app-state';
import { errorMessage } from '../../core/bridge';
import { useStore } from '../../core/store';
import { toast } from '../../core/toasts';
import { Icon } from '../../components/Icon';
import { Select } from '../../components/Select';
import { ErrorNote, Spinner, cx } from '../../components/ui';
import { btn, btnPrimary, Cell, Empty, Field, input, PageHead, Panel, row, Sheet, THead } from '../hr/parts';
import { useOrgs } from './api';
import { COUPON_STATE, couponRuns, couponUsed, couponWorth, fetchCoupons, KM, removeCoupon, saveCoupon, type Coupon } from './manage';

/**
 * Coupons (OmsCoupons): the codes an order can carry, what each takes off,
 * when it runs and how often it has been used. The state is the server's —
 * a coupon ticked Active whose end date has passed is Expired, not Live —
 * so "why doesn't my code work" is answered by the list. Only somebody with
 * `oms.coupons.manage` adds, edits or removes; a used coupon's code is fixed,
 * because customers have been given it.
 */
const has = (perms: readonly string[] | undefined, p: string) => !!perms && (perms.includes('*') || perms.includes(p));
const COLS: Array<[string, number | null]> = [
  ['Code', 110],
  ['Name', null],
  ['Worth', 150],
  ['Minimum', 100],
  ['Runs', 170],
  ['Used', 76],
  ['State', 96],
  ['', 116],
];

export default function Coupons({ org }: { org: string }) {
  const qc = useQueryClient();
  const perms = useStore(app, (s) => s.bootstrap?.permissions);
  const manage = has(perms, 'oms.coupons.manage');
  const orgs = useOrgs();
  const q = useQuery({ queryKey: KM.coupons(org), queryFn: ({ signal }) => fetchCoupons(org, signal) });
  const [editing, setEditing] = useState<Partial<Coupon> | null>(null);
  const [removing, setRemoving] = useState<Coupon | null>(null);
  const [busy, setBusy] = useState(false);
  const currencyOf = (orgId: number) => orgs.data?.find((o) => o.id === orgId)?.currency ?? (orgs.data?.length === 1 ? orgs.data[0]!.currency : null);
  const rows = q.data ?? [];

  const remove = async (c: Coupon) => {
    setBusy(true);
    try {
      await removeCoupon(c.id);
      toast('success', `${c.code} removed.`);
      setRemoving(null);
      void qc.invalidateQueries({ queryKey: ['sales', 'coupons'] });
    } catch (e) {
      toast('error', errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-3.5 px-6 py-5">
      <PageHead title="Coupons" sub="Codes an order can carry — one per order">
        {manage ? (
          <button type="button" className={btnPrimary} onClick={() => setEditing({ kind: 'percent', status: 'active', usage_limit: 0, per_customer_limit: 0 })}>
            <Icon name="plus" size={15} /> New coupon
          </button>
        ) : null}
      </PageHead>
      {q.isLoading ? (
        <Spinner />
      ) : q.error ? (
        <ErrorNote error={q.error} onRetry={() => void q.refetch()} />
      ) : (
        <Panel title={`${rows.length} ${rows.length === 1 ? 'coupon' : 'coupons'}`} bodyClassName="flex flex-col">
          <THead cols={COLS} />
          {rows.length ? (
            rows.map((c) => {
              const st = COUPON_STATE[c.state] ?? COUPON_STATE.inactive;
              return (
                <div key={c.id} className={row} data-coupon={c.code}>
                  <Cell w={110} className="font-mono text-[12.5px] font-semibold">
                    {c.code}
                  </Cell>
                  <Cell w={null}>
                    <span title={c.description ?? undefined}>{c.name}</span>
                  </Cell>
                  <Cell w={150} className="tabular-nums">
                    {couponWorth(c, currencyOf(c.org_id))}
                  </Cell>
                  <Cell w={100} className="text-ink-2 tabular-nums">
                    {c.min_order_value !== null && Number(c.min_order_value) > 0 ? Number(c.min_order_value).toLocaleString() : 'none'}
                  </Cell>
                  <Cell w={170} className="text-ink-2">
                    {couponRuns(c)}
                  </Cell>
                  <Cell w={76} className="tabular-nums">
                    {couponUsed(c)}
                  </Cell>
                  <Cell w={96}>
                    <span className={cx('inline-flex h-[22px] items-center rounded-[11px] px-2 text-[11.5px] font-bold', st.chip)}>{st.label}</span>
                  </Cell>
                  <Cell w={116} className="text-right">
                    {manage ? (
                      <>
                        <button type="button" className="font-semibold text-primary hover:underline" onClick={() => setEditing(c)}>
                          Edit
                        </button>
                        <span className="text-ink-3"> · </span>
                        <button type="button" className="font-semibold text-danger hover:underline" onClick={() => setRemoving(c)}>
                          Remove
                        </button>
                      </>
                    ) : null}
                  </Cell>
                </div>
              );
            })
          ) : (
            <Empty text={manage ? 'No coupons yet. New coupon makes the first.' : 'No coupons yet.'} />
          )}
        </Panel>
      )}

      {editing ? (
        <Editor
          value={editing}
          org={org}
          orgs={orgs.data ?? []}
          everyCompany={!!perms?.includes('*')}
          onClose={() => setEditing(null)}
          onSaved={() => (setEditing(null), void qc.invalidateQueries({ queryKey: ['sales', 'coupons'] }))}
        />
      ) : null}
      {removing ? (
        <Sheet
          title={`Remove ${removing.code}?`}
          width={420}
          onClose={() => setRemoving(null)}
          footer={
            <>
              <button type="button" className={btn} onClick={() => setRemoving(null)}>
                Cancel
              </button>
              <button type="button" className={btnPrimary + ' !bg-danger hover:!opacity-90'} disabled={busy} onClick={() => void remove(removing)}>
                {busy ? 'Removing…' : 'Remove'}
              </button>
            </>
          }
        >
          <p className="m-0 text-[13px] text-ink-2">
            {removing.redeemed_count > 0
              ? `It has been used ${removing.redeemed_count} ${removing.redeemed_count === 1 ? 'time' : 'times'}. Those orders keep the discount they were given; the code simply stops working.`
              : 'The code stops working. Orders already using it are unaffected.'}
          </p>
        </Sheet>
      ) : null}
    </div>
  );
}

/**
 * A new coupon belongs to one company. Somebody in several says which (it
 * starts as the one the screen is narrowed to); only an administrator may
 * make one spendable in every company's books.
 */
function Editor({ value, org, orgs, everyCompany, onClose, onSaved }: { value: Partial<Coupon>; org: string; orgs: Array<{ id: number; name: string }>; everyCompany: boolean; onClose: () => void; onSaved: () => void }) {
  const [c, setC] = useState<Partial<Coupon>>(value);
  const [orgId, setOrgId] = useState(/^\d+$/.test(org) ? org : '');
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof Coupon>(k: K, v: Coupon[K] | null) => setC((p) => ({ ...p, [k]: v }));
  const codeFixed = !!c.id && (c.redeemed_count ?? 0) > 0;
  const n = (v: string) => (v.trim() === '' ? null : Number(v));
  const askCompany = !c.id && (orgs.length > 1 || everyCompany);

  const save = async () => {
    setBusy(true);
    try {
      await saveCoupon(orgId === '0' ? '' : orgId, c);
      toast('success', `${(c.code ?? '').toUpperCase()} saved.`);
      onSaved();
    } catch (e) {
      // The server's sentence: the code is taken, the dates are backwards, a used code is fixed.
      toast('error', errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet
      title={c.id ? `Edit ${c.code}` : 'New coupon'}
      width={520}
      onClose={onClose}
      footer={
        <>
          <button type="button" className={btn} onClick={onClose}>
            Cancel
          </button>
          <button type="button" className={btnPrimary} disabled={busy || !c.code?.trim() || !c.name?.trim() || !(Number(c.value) > 0) || (askCompany && orgId === '')} onClick={() => void save()}>
            {busy ? 'Saving…' : 'Save'}
          </button>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-2.5">
        <Field label="Code" hint={codeFixed ? 'Already used, so the code is fixed — customers have been given it.' : undefined}>
          <input aria-label="Code" value={c.code ?? ''} disabled={codeFixed} placeholder="SAVE20" onChange={(e) => set('code', e.target.value.toUpperCase().replace(/\s/g, ''))} className={input + ' font-mono'} />
        </Field>
        <Field label="Name">
          <input aria-label="Name" value={c.name ?? ''} onChange={(e) => set('name', e.target.value)} className={input} />
        </Field>
        <Field label="Kind">
          <Select<Coupon['kind']> aria-label="Kind" value={c.kind ?? 'percent'} onValueChange={(v) => set('kind', v)} options={[{ value: 'percent', label: 'Percentage' }, { value: 'amount', label: 'Fixed amount' }]} className={input} />
        </Field>
        <Field label={c.kind === 'amount' ? 'Amount' : 'Percent'}>
          <input aria-label={c.kind === 'amount' ? 'Amount' : 'Percent'} type="number" min={0} max={c.kind === 'amount' ? undefined : 100} step="0.01" value={c.value ?? ''} onChange={(e) => set('value', n(e.target.value) ?? (undefined as unknown as number))} className={input} />
        </Field>
        <Field label="Most it can take off">
          <input aria-label="Most it can take off" type="number" min={0} step="0.01" placeholder="no cap" value={c.max_discount ?? ''} onChange={(e) => set('max_discount', n(e.target.value))} className={input} />
        </Field>
        <Field label="Minimum order">
          <input aria-label="Minimum order" type="number" min={0} step="0.01" placeholder="none" value={c.min_order_value ?? ''} onChange={(e) => set('min_order_value', n(e.target.value))} className={input} />
        </Field>
        <Field label="Starts">
          <input aria-label="Starts" type="date" value={c.starts_at?.slice(0, 10) ?? ''} onChange={(e) => set('starts_at', e.target.value || null)} className={input} />
        </Field>
        <Field label="Ends">
          <input aria-label="Ends" type="date" min={c.starts_at?.slice(0, 10) || undefined} value={c.ends_at?.slice(0, 10) ?? ''} onChange={(e) => set('ends_at', e.target.value || null)} className={input} />
        </Field>
        <Field label="Times it may be used" hint="0 = no limit">
          <input aria-label="Times it may be used" type="number" min={0} value={c.usage_limit ?? 0} onChange={(e) => set('usage_limit', Math.max(0, Number(e.target.value) || 0))} className={input} />
        </Field>
        <Field label="Per customer" hint="0 = no limit">
          <input aria-label="Per customer" type="number" min={0} value={c.per_customer_limit ?? 0} onChange={(e) => set('per_customer_limit', Math.max(0, Number(e.target.value) || 0))} className={input} />
        </Field>
      </div>
      <Field label="Status">
        <Select<Coupon['status']> aria-label="Status" value={c.status ?? 'active'} onValueChange={(v) => set('status', v)} options={[{ value: 'active', label: 'Active' }, { value: 'inactive', label: 'Inactive' }]} className={input} />
      </Field>
      <Field label="Description">
        <textarea aria-label="Description" value={c.description ?? ''} onChange={(e) => set('description', e.target.value)} className={input + ' !h-[52px] resize-none py-2'} />
      </Field>
      {askCompany ? (
        <Field label="Company" hint={orgId === '0' ? "Spendable in every company's books." : undefined}>
          <Select<string>
            aria-label="Company"
            searchable
            placeholder="Choose the company"
            value={orgId}
            onValueChange={setOrgId}
            options={[...(everyCompany ? [{ value: '0', label: 'Every company' }] : []), ...orgs.map((o) => ({ value: String(o.id), label: o.name }))]}
            className={input}
          />
        </Field>
      ) : null}
    </Sheet>
  );
}
