import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { apiGet, apiPost, apiPut } from '../../core/api';
import { errorMessage } from '../../core/bridge';
import { toast } from '../../core/toasts';
import { ErrorNote, Spinner } from '../../components/ui';
import type { BankInfo } from './api';
import { btn, btnPrimary, Field, input, Panel, Sheet, StatusChip } from './parts';

/**
 * The bank card (HrProfileSheet "Bank"): where the salary goes, masked.
 * Showing the full number needs `hr.bank.view` and is logged (the list of
 * who looked sits underneath); changing it needs `hr.bank.manage` and
 * clears the verification; verifying must be done by somebody other than
 * the person who typed it — the server holds all three rules.
 */
export function BankCard({ employeeId }: { employeeId: number }) {
  const qc = useQueryClient();
  const [reveal, setReveal] = useState(false);
  const [editing, setEditing] = useState(false);
  const q = useQuery({ queryKey: ['hr', 'bank', employeeId, reveal], queryFn: ({ signal }) => apiGet<BankInfo>(`/api/hr/employees/${employeeId}/bank`, reveal ? { reveal: 1 } : undefined, signal) });
  const reads = useQuery({
    queryKey: ['hr', 'bank-reads', employeeId],
    queryFn: ({ signal }) => apiGet<{ reads: Array<{ id: number; by: string | null; at: string; purpose: string | null }> }>(`/api/hr/employees/${employeeId}/bank/reads`, undefined, signal),
    enabled: !!q.data?.can.view_number,
    retry: false,
  });
  const b = q.data;
  const a = b?.account;
  const verify = async () => {
    if (!a) return;
    try {
      await apiPost(`/api/hr/employees/${employeeId}/bank/verify`, { updated_at: a.updated_at });
      toast('success', 'Marked as verified.');
      void qc.invalidateQueries({ queryKey: ['hr', 'bank', employeeId] });
    } catch (e) {
      toast('error', errorMessage(e));
    }
  };

  return (
    <Panel
      title={
        <span className="flex items-center gap-2">
          Bank
          {a ? <StatusChip>{a.verified_at ? 'Verified' : 'Not verified'}</StatusChip> : null}
        </span>
      }
      bodyClassName="px-3.5 py-2.5"
    >
      {q.isLoading ? <Spinner /> : q.error ? <ErrorNote error={q.error} onRetry={() => void q.refetch()} /> : null}
      {b && !a ? (
        <div className="flex flex-col gap-2 text-ink-3">
          No bank details on file.
          {b.can.edit ? (
            <button type="button" className={btnPrimary + ' self-start'} onClick={() => setEditing(true)}>
              Add bank details
            </button>
          ) : null}
        </div>
      ) : null}
      {a ? (
        <div className="flex flex-col gap-2">
          {(
            [
              ['Bank', a.bank_name, false],
              ['Branch', a.branch, false],
              ['Branch code', a.branch_code, true],
              ['Account holder', a.account_holder, false],
              ['Account number', b!.revealed && a.account_number ? a.account_number : a.account_masked, true],
              ['Account type', a.account_type, false],
            ] as Array<[string, string | null, boolean]>
          ).map(([k, v, mono]) => (
            <div key={k} className="flex gap-2.5">
              <span className="w-[120px] shrink-0 text-ink-3">{k}</span>
              <span className={mono ? 'font-mono text-[12.5px] font-semibold text-ink' : 'font-semibold text-ink'}>{v || '—'}</span>
            </div>
          ))}
          {!a.payable.ok && a.payable.reason ? <div className="rounded-[8px] bg-warning-bg px-2.5 py-1.5 text-[12px] text-[#9A4A06] dark:text-warning">{a.payable.reason}</div> : null}
          {a.verified_at ? <span className="text-[12px] text-ink-3">Verified{a.verified_by ? ` by ${a.verified_by}` : ''}.</span> : null}
          <div className="flex flex-wrap gap-2">
            {b!.can.view_number && !b!.revealed ? (
              <button type="button" className={btn} onClick={() => setReveal(true)}>
                Show the full number
              </button>
            ) : null}
            {b!.can.verify && !a.verified_at ? (
              <button type="button" className={btn} onClick={() => void verify()}>
                Mark as verified
              </button>
            ) : null}
            {b!.can.edit ? (
              <button type="button" className={btn} onClick={() => setEditing(true)}>
                Change
              </button>
            ) : null}
          </div>
          {b!.can.verify && !a.verified_at ? <span className="text-[11.5px] text-ink-3">Somebody other than the person who entered these details has to check them.</span> : null}
          {reads.data?.reads.length ? (
            <div className="mt-1 flex flex-col gap-0.5 border-t border-line pt-2">
              <b className="text-[12px] text-ink">Who has looked at this number</b>
              {reads.data.reads.slice(0, 6).map((r) => (
                <span key={r.id} className="text-[12px] text-ink-3">
                  {r.by ?? 'Someone'} · {new Date(`${r.at.replace(' ', 'T')}Z`).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}
                  {r.purpose ? ` · ${r.purpose}` : ''}
                </span>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
      {b?.error ? <div className="mt-2 text-[12px] text-danger">{b.error}</div> : null}
      {editing ? <EditBank employeeId={employeeId} account={a ?? null} onClose={() => setEditing(false)} onDone={() => (setEditing(false), setReveal(false), void qc.invalidateQueries({ queryKey: ['hr', 'bank', employeeId] }))} /> : null}
    </Panel>
  );
}

function EditBank({ employeeId, account, onClose, onDone }: { employeeId: number; account: BankInfo['account']; onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({
    bank_name: account?.bank_name ?? '',
    branch: account?.branch ?? '',
    bank_code: account?.bank_code ?? '',
    branch_code: account?.branch_code ?? '',
    account_holder: account?.account_holder ?? '',
    account_number: '',
    account_type: account?.account_type ?? '',
  });
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((p) => ({ ...p, [k]: e.target.value }));
  const save = async () => {
    setBusy(true);
    try {
      await apiPut(`/api/hr/employees/${employeeId}/bank`, { ...f, account_number: f.account_number.replace(/\s+/g, '') });
      toast('success', 'Saved. It needs verifying again.');
      onDone();
    } catch (e) {
      toast('error', errorMessage(e));
      setBusy(false);
    }
  };
  return (
    <Sheet
      title={account ? 'Change bank details' : 'Add bank details'}
      onClose={onClose}
      footer={
        <>
          <button type="button" className={btn} onClick={onClose}>
            Cancel
          </button>
          <button type="button" disabled={busy || !f.bank_name.trim() || !f.account_holder.trim() || (!account && !f.account_number.trim())} className={btnPrimary} onClick={() => void save()}>
            Save
          </button>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-2.5">
        <Field label="Bank">
          <input aria-label="Bank" value={f.bank_name} onChange={set('bank_name')} className={input} />
        </Field>
        <Field label="Branch">
          <input aria-label="Branch" value={f.branch} onChange={set('branch')} className={input} />
        </Field>
        <Field label="Bank code">
          <input aria-label="Bank code" value={f.bank_code} onChange={set('bank_code')} className={input} />
        </Field>
        <Field label="Branch code">
          <input aria-label="Branch code" value={f.branch_code} onChange={set('branch_code')} className={input} />
        </Field>
        <Field label="Account holder">
          <input aria-label="Account holder" value={f.account_holder} onChange={set('account_holder')} className={input} />
        </Field>
        <Field label="Account type">
          <input aria-label="Account type" value={f.account_type} onChange={set('account_type')} placeholder="Savings" className={input} />
        </Field>
      </div>
      <Field label="Account number" hint={account ? `Leave blank to keep ${account.account_masked}.` : '5 to 34 letters and digits.'}>
        <input aria-label="Account number" value={f.account_number} onChange={set('account_number')} className={input + ' font-mono'} autoComplete="off" />
      </Field>
      <span className="text-[11.5px] text-ink-3">Changing where the money goes clears the verification; somebody else then checks it again.</span>
    </Sheet>
  );
}
