import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { app } from '../../core/app-state';
import { errorMessage } from '../../core/bridge';
import { useStore } from '../../core/store';
import { toast } from '../../core/toasts';
import { Icon } from '../../components/Icon';
import { Select } from '../../components/Select';
import { ErrorNote, Spinner } from '../../components/ui';
import { btn, btnPrimary, Field, input, PageHead, Sheet } from '../hr/parts';
import { useOrgs } from './api';
import { fetchRules, KM, removeRule, ruleLine, saveRule, type Rule } from './manage';
import { Checkbox } from '../../components/Checkbox';

/**
 * Approval rules (OmsApprovalRules): when an order is submitted, every
 * matching rule becomes a step it has to pass, in step order. What a rule
 * can ask about, how it compares, and the sentence each rule reads as all
 * come from the server — the same class that evaluates them — so this
 * screen cannot offer a rule that silently never matches. Changing them
 * needs `oms.settings`; a chain already running is frozen and unaffected.
 */
const has = (perms: readonly string[] | undefined, p: string) => !!perms && (perms.includes('*') || perms.includes(p));
const BLANK: Partial<Rule> = { name: '', step: 1, subject: 'order_total', operator: 'gt', threshold: 0, text_value: '', permission: 'oms.orders.approve', is_active: true, org_id: null };

export default function ApprovalRules({ org }: { org: string }) {
  const qc = useQueryClient();
  const perms = useStore(app, (s) => s.bootstrap?.permissions);
  const manage = has(perms, 'oms.settings');
  const orgs = useOrgs();
  const q = useQuery({ queryKey: KM.rules(org), queryFn: ({ signal }) => fetchRules(org, signal) });
  const [editing, setEditing] = useState<Partial<Rule> | null>(null);
  const [removing, setRemoving] = useState<Rule | null>(null);
  const [busy, setBusy] = useState(false);
  const refresh = () => void qc.invalidateQueries({ queryKey: ['sales', 'rules'] });

  const run = async (fn: () => Promise<unknown>, done: string, after: () => void) => {
    setBusy(true);
    try {
      await fn();
      toast('success', done);
      after();
      refresh();
    } catch (e) {
      // The server's sentence names the thing to change.
      toast('error', errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  if (q.isLoading) return <Spinner />;
  if (q.error) return <ErrorNote error={q.error} onRetry={() => void q.refetch()} />;
  const { rules, subjects, operators } = q.data!;
  const kind = (s: string | undefined) => subjects[s ?? '']?.kind ?? 'money';
  const e = editing;

  return (
    <div className="flex flex-col gap-3.5 px-6 py-5">
      <PageHead title="Approval rules" sub="When an order is submitted, every matching rule becomes a step it has to pass.">
        {manage ? (
          <button type="button" className={btnPrimary} onClick={() => setEditing({ ...BLANK, org_id: /^\d+$/.test(org) ? Number(org) : null })}>
            <Icon name="plus" size={15} /> New rule
          </button>
        ) : null}
      </PageHead>

      {rules.length ? (
        <div className="overflow-hidden rounded-[12px] border border-line bg-surface">
          {rules.map((r) => (
            <div key={r.id} data-rule={r.name} className="flex items-center gap-3 border-b border-line/60 px-3.5 py-3 last:border-b-0">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-selection font-extrabold text-primary tabular-nums" title={`Step ${r.step}`}>
                {r.step}
              </span>
              <span className="flex min-w-0 flex-1 flex-col">
                <b className="flex items-center gap-1.5 text-ink">
                  <span className="truncate">{r.name}</span>
                  {!r.is_active ? <span className="rounded-[8px] bg-subtle px-[7px] py-px text-[11px] font-semibold text-ink-2">off</span> : null}
                </b>
                <span className="truncate text-[12.5px] text-ink-2">{ruleLine(r)}</span>
              </span>
              {manage ? (
                <>
                  <button type="button" className="font-semibold text-primary hover:underline" onClick={() => setEditing(r)}>
                    Edit
                  </button>
                  <button type="button" aria-label={`Remove ${r.name}`} title="Remove" className="flex h-7 w-7 items-center justify-center rounded-full text-danger hover:bg-danger-bg" onClick={() => setRemoving(r)}>
                    <Icon name="x" size={15} />
                  </button>
                </>
              ) : null}
            </div>
          ))}
        </div>
      ) : (
        <div className="rounded-[12px] border border-dashed border-line px-4 py-6 text-center">
          <b className="text-ink">No approval rules.</b>
          <p className="mx-auto mt-1 mb-0 max-w-[520px] text-[12.5px] text-ink-3">
            That is a working setup, not a gap: with no rule, a submitted order is approved at once and nobody sees an approval step. Add one when a value, a discount or a customer's balance should need a second pair of eyes.
          </p>
        </div>
      )}

      {e ? (
        <section aria-label={e.id ? 'Edit rule' : 'New rule'} className="flex flex-col gap-2.5 rounded-[12px] border-2 border-primary bg-surface p-3.5">
          <b className="text-ink">{e.id ? 'Edit rule' : 'New rule'}</b>
          <div className="grid grid-cols-[2fr_90px_1fr] gap-2.5">
            <Field label="Name" hint="What somebody reads when an order is waiting on it.">
              <input aria-label="Name" value={e.name ?? ''} placeholder="Large orders need a manager" onChange={(ev) => setEditing({ ...e, name: ev.target.value })} className={input} />
            </Field>
            <Field label="Step">
              <Select<string> aria-label="Step" value={String(e.step ?? 1)} onValueChange={(v) => setEditing({ ...e, step: Number(v) })} options={Array.from({ length: 10 }, (_, i) => ({ value: String(i + 1), label: String(i + 1) }))} className={input} />
            </Field>
            <Field label="Applies to">
              <Select<string>
                aria-label="Applies to"
                searchable
                value={e.org_id ? String(e.org_id) : ''}
                onValueChange={(v) => setEditing({ ...e, org_id: v ? Number(v) : null })}
                options={[{ value: '', label: 'Every company' }, ...(orgs.data ?? []).map((o) => ({ value: String(o.id), label: o.name }))]}
                className={input}
              />
            </Field>
          </div>
          <Field label="When" hint="Steps run in order. Two rules on one step: the first that matches decides it.">
            <div className="flex gap-2">
              <Select<string> aria-label="What the rule asks about" value={e.subject ?? 'order_total'} onValueChange={(v) => setEditing({ ...e, subject: v })} options={Object.entries(subjects).map(([k, v]) => ({ value: k, label: v.label }))} className={input + ' !w-[200px]'} />
              <Select<string> aria-label="How it compares" value={e.operator ?? 'gt'} onValueChange={(v) => setEditing({ ...e, operator: v })} options={Object.entries(operators).map(([k, v]) => ({ value: k, label: v }))} className={input + ' !w-[170px]'} />
              {kind(e.subject) === 'text' ? (
                <input aria-label="Value" value={e.text_value ?? ''} placeholder={e.subject === 'priority' ? 'urgent' : 'rush'} onChange={(ev) => setEditing({ ...e, text_value: ev.target.value })} className={input + ' flex-1'} />
              ) : (
                <input aria-label="Value" type="number" step="0.01" min={0} value={e.threshold ?? 0} onChange={(ev) => setEditing({ ...e, threshold: Number(ev.target.value) })} className={input + ' flex-1'} />
              )}
            </div>
          </Field>
          <div className="flex items-end gap-2.5">
            <Field label="Approver needs" hint="A permission. A narrower one means a different person approves.">
              <input aria-label="Approver needs" value={e.permission ?? 'oms.orders.approve'} onChange={(ev) => setEditing({ ...e, permission: ev.target.value.trim() })} className={input + ' !w-[280px] font-mono'} />
            </Field>
            <label className="mb-[22px] flex h-[34px] items-center gap-1.5 font-semibold text-ink">
              <Checkbox checked={e.is_active ?? true} onChange={(ev) => setEditing({ ...e, is_active: ev.target.checked })} />
              Active
            </label>
            <span className="flex-1" />
            <div className="mb-[22px] flex gap-2">
              <button type="button" className={btn} onClick={() => setEditing(null)}>
                Cancel
              </button>
              <button type="button" className={btnPrimary} disabled={busy || !e.name?.trim()} onClick={() => void run(() => saveRule(e), e.id ? 'Rule saved.' : 'Rule added.', () => setEditing(null))}>
                {busy ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </section>
      ) : null}

      {removing ? (
        <Sheet
          title="Remove this rule?"
          width={420}
          onClose={() => setRemoving(null)}
          footer={
            <>
              <button type="button" className={btn} onClick={() => setRemoving(null)}>
                Cancel
              </button>
              <button type="button" className={btnPrimary + ' !bg-danger hover:!opacity-90'} disabled={busy} onClick={() => void run(() => removeRule(removing.id), 'Rule removed.', () => setRemoving(null))}>
                {busy ? 'Removing…' : 'Remove'}
              </button>
            </>
          }
        >
          <b className="text-ink">{removing.name}</b>
          <p className="m-0 text-[13px] text-ink-2">Orders already waiting on it keep waiting: a chain is fixed when the order is submitted, so removing the rule changes what happens next and rewrites nothing that already happened.</p>
        </Sheet>
      ) : null}
    </div>
  );
}
