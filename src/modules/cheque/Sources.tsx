import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { errorMessage } from '../../core/bridge';
import { toast } from '../../core/toasts';
import { Select } from '../../components/Select';
import { ErrorNote, Modal, Spinner } from '../../components/ui';
import { refusal } from '../finance/api';
import { fetchBankAccounts, fetchReturns, fetchSources, has, K, openPdf, sendReturnLetter, startFromSource, type Access, type ReturnRow, type Source } from './api';
import { Badge, Note, PageHead, btn, btnPrimary, num, td, th } from './parts';

/**
 * Cheque 1.2 on the station: cheques started from other modules' payments (CHQ-FIN-01 — an Expense reimbursement
 * run paid by cheque becomes one cheque per employee, a Billing refund one cheque to the customer; never twice), and
 * the returned-cheque letters (CHQ-RET-03) as the server's PDF or by email. The cheques made go for approval as usual.
 */
export function Sources({ access }: { access: Access | undefined }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: K.sources, queryFn: ({ signal }) => fetchSources(signal), retry: false });
  const accounts = useQuery({ queryKey: ['cheque', 'bank-accounts'], queryFn: ({ signal }) => fetchBankAccounts(signal), staleTime: 300_000 });
  const [start, setStart] = useState<Source | null>(null);
  const [account, setAccount] = useState(0);
  const go = useMutation({
    mutationFn: () => startFromSource({ org_id: start?.org_id ?? undefined, kind: start!.kind, id: start!.id, bank_account_id: account }),
    onSuccess: () => (toast('success', 'Cheques created. They go for approval as usual.'), setStart(null), void qc.invalidateQueries({ queryKey: K.sources })),
    onError: (e) => toast('error', refusal(e)),
  });
  const can = has(access, 'cheque.create');
  return (
    <div className="flex flex-col gap-3">
      <PageHead title="Start from payments" sub="Expense reimbursements and Billing refunds paid by cheque that have no cheque yet" />
      {q.isLoading ? <Spinner /> : q.error ? <ErrorNote error={q.error} onRetry={() => void q.refetch()} /> : q.data === null ? <Note>Starting cheques from payments needs a newer WorkSuite server (Cheque 1.2).</Note> : (
        <section className="overflow-hidden rounded-[10px] border border-line bg-surface">
          <table className="w-full border-collapse">
            <thead><tr><th className={th}>From</th><th className={th}>Reference</th><th className={`${th} text-right`}>Total</th><th className={th} /></tr></thead>
            <tbody>
              {(q.data ?? []).map((r) => (
                <tr key={`${r.kind}-${r.id}`}>
                  <td className={td}><Badge tone={r.kind === 'billing_refund' ? 'warn' : 'info'}>{r.kind === 'billing_refund' ? 'Billing refund' : 'Expense reimbursement'}</Badge></td>
                  <td className={`${td} ${num}`}>{r.reference ?? `#${r.id}`}</td>
                  <td className={`${td} ${num} text-right`}>{`${r.currency} ${r.total}`}</td>
                  <td className={`${td} text-right`}>{can ? <button type="button" className={btnPrimary} onClick={() => (setStart(r), setAccount(0))}>{r.kind === 'expense_reimbursement' ? 'Start cheques' : 'Start cheque'}</button> : null}</td>
                </tr>
              ))}
              {q.data && !q.data.length ? <tr><td className={td} colSpan={4}>Nothing is waiting for a cheque.</td></tr> : null}
            </tbody>
          </table>
        </section>
      )}
      {start ? (
        <Modal
          title="Start cheques"
          onClose={() => setStart(null)}
          width={460}
          footer={<><button type="button" className={btn} onClick={() => setStart(null)}>Cancel</button><button type="button" className={btnPrimary} disabled={!account || go.isPending} onClick={() => go.mutate()}>{go.isPending ? 'Creating…' : 'Create'}</button></>}
        >
          <p className="m-0 text-[13px] text-ink-2">{start.kind === 'expense_reimbursement' ? 'One cheque per employee in the run, for the sum of their lines.' : 'One cheque to the customer for the refund.'}</p>
          <label className="mt-3 flex flex-col gap-1 text-[12px] font-semibold text-ink-2">
            Drawn on
            <Select aria-label="Bank account" value={account} onChange={(e) => setAccount(Number(e.target.value))} className="h-8 rounded-[7px] border border-line bg-surface px-2 text-[13px] font-normal text-ink">
              <option value={0}>Choose an account…</option>
              {(accounts.data ?? []).map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
            </Select>
          </label>
        </Modal>
      ) : null}
    </div>
  );
}

export function Returns({ access }: { access: Access | undefined }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: K.returns, queryFn: ({ signal }) => fetchReturns(signal), retry: false });
  const [sending, setSending] = useState<ReturnRow | null>(null);
  const [to, setTo] = useState('');
  const send = useMutation({
    mutationFn: () => sendReturnLetter(sending!.id, to.trim() || undefined),
    onSuccess: () => (toast('success', 'Letter sent.'), setSending(null), void qc.invalidateQueries({ queryKey: K.returns })),
    onError: (e) => toast('error', refusal(e)),
  });
  const can = has(access, 'cheque.return.manage');
  return (
    <div className="flex flex-col gap-3">
      <PageHead title="Returned cheques" sub="The letter to the customer or supplier, as a PDF and by email" />
      {q.isLoading ? <Spinner /> : q.error ? <ErrorNote error={q.error} onRetry={() => void q.refetch()} /> : q.data === null ? <Note>Return letters need a newer WorkSuite server (Cheque 1.2).</Note> : (
        <section className="overflow-hidden rounded-[10px] border border-line bg-surface">
          <table className="w-full border-collapse">
            <thead><tr><th className={th}>Cheque</th><th className={th}>Customer / supplier</th><th className={th}>Returned</th><th className={th}>Letter</th><th className={th} /></tr></thead>
            <tbody>
              {(q.data ?? []).map((r) => (
                <tr key={r.id}>
                  <td className={`${td} ${num}`}>{r.number}</td>
                  <td className={td}>{`${r.party ?? ''} (${r.direction === 'in' ? 'received' : 'issued'})`}</td>
                  <td className={td}>{`${r.return_date}${r.reason ? ` · ${r.reason}` : ''}`}</td>
                  <td className={td}>{r.letter_sent_at ? <Badge tone="ok">{`Sent to ${r.letter_to ?? ''}`}</Badge> : <Badge tone="warn">Not sent</Badge>}</td>
                  <td className={`${td} text-right`}>
                    <span className="inline-flex gap-1.5">
                      <button type="button" className={btn} onClick={() => void openPdf('return-letter', r.id, `Returned cheque ${r.number ?? r.id}`).catch((e) => toast('error', errorMessage(e)))}>PDF</button>
                      {can ? <button type="button" className={btnPrimary} onClick={() => (setSending(r), setTo(''))}>{r.letter_sent_at ? 'Send again' : 'Send'}</button> : null}
                    </span>
                  </td>
                </tr>
              ))}
              {q.data && !q.data.length ? <tr><td className={td} colSpan={5}>No returned cheques.</td></tr> : null}
            </tbody>
          </table>
        </section>
      )}
      {sending ? (
        <Modal
          title="Send the returned-cheque letter"
          onClose={() => setSending(null)}
          width={460}
          footer={<><button type="button" className={btn} onClick={() => setSending(null)}>Cancel</button><button type="button" className={btnPrimary} disabled={send.isPending} onClick={() => send.mutate()}>{send.isPending ? 'Sending…' : 'Send'}</button></>}
        >
          <p className="m-0 text-[13px] text-ink-2">{`${sending.number ?? ''} · ${sending.party ?? ''}`}</p>
          <label className="mt-3 flex flex-col gap-1 text-[12px] font-semibold text-ink-2">
            Email (blank = the address on file)
            <input type="email" aria-label="Email" value={to} onChange={(e) => setTo(e.target.value)} className="h-8 rounded-[7px] border border-line bg-surface px-2.5 text-[13px] font-normal text-ink" />
          </label>
        </Modal>
      ) : null}
    </div>
  );
}
