import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Select } from '../../components/Select';
import { Button, ErrorNote, Spinner } from '../../components/ui';
import { toast } from '../../core/toasts';
import { input, Section } from '../../components/FormKit';
import { PageHead } from '../../components/PageKit';
import { day, errorText, K, pGet, pPost, stamp, type FolioShape, type OutboxRow } from './api';
import { Money, NoAccess, Refusal, usePms } from './parts';

const FOLIO_STATUSES = [
  { value: 'settled', label: 'Settled' },
  { value: 'transferred_ar', label: 'To a company’s account' },
  { value: 'closed', label: 'Closed' },
];
const OUTBOX_STATUSES = [
  { value: '', label: 'Every hand-off' },
  { value: 'pending', label: 'Waiting' },
  { value: 'failed', label: 'Failed — will retry' },
  { value: 'dead', label: 'Needs attention' },
  { value: 'done', label: 'Sent' },
];

/**
 * Invoices (§10.5) are Billing's: a settled folio becomes a Billing invoice to
 * its payee (or, without Billing, a PMS receipt). This lists the folios that
 * have one or should (`pms.folio.view`), invoices one now for whoever settles
 * (`pms.payment.process` or `pms.checkout`), opens the folio — and, for
 * whoever manages PMS settings, shows the hand-offs to Billing and Finance
 * (`pms_outbox`) waiting or failed, with a retry for those that gave up.
 * Online only: nothing of money is kept on this computer.
 */
export default function Invoices() {
  const pms = usePms();
  const qc = useQueryClient();
  const pid = pms.property.id;
  const reads = pms.may('pms.folio.view');
  const [status, setStatus] = useState('settled');
  const [busy, setBusy] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const q = useQuery({ queryKey: K.folios(pid, status), queryFn: ({ signal }) => pGet<{ items: FolioShape[] }>(`/properties/${pid}/folios`, { status }, signal), enabled: reads && pms.online });
  const invoices = pms.mayAny('pms.payment.process', 'pms.checkout');

  if (!reads && !pms.may('pms.settings.manage')) return <NoAccess what="Invoices are shown to people who may read folios." />;
  const invoice = async (f: FolioShape) => {
    setBusy(f.id);
    setError(null);
    try {
      toast('success', (await pPost(`/folios/${f.id}/invoice`, {})).message);
      void qc.invalidateQueries({ queryKey: ['pms', 'folios'] });
      void qc.invalidateQueries({ queryKey: ['pms', 'outbox'] });
    } catch (e) {
      setError(errorText(e, 'The invoice was not made.'));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="flex flex-col gap-4 px-6 py-5">
      <PageHead title="Invoices" sub="Invoices are Billing’s; without Billing a settled folio has a PMS receipt." />
      {error ? <Refusal text={error} /> : null}
      {!pms.online ? <p className="text-[13px] text-ink-3">Invoices show when WorkSuite is back.</p> : null}
      {reads && pms.online ? (
        <Section title="Folios" action={<Select aria-label="Folio status" value={status} options={FOLIO_STATUSES} onChange={(e) => setStatus(e.target.value)} className={`${input} w-56`} />}>
          {q.isLoading ? (
            <Spinner />
          ) : q.error ? (
            <ErrorNote error={q.error} onRetry={() => void q.refetch()} />
          ) : (q.data?.items ?? []).length === 0 ? (
            <p className="m-0 text-[13px] text-ink-3">No folios here.</p>
          ) : (
            <table className="w-full text-left text-[13px]">
              <thead className="text-[11px] font-bold tracking-[.4px] text-ink-3 uppercase">
                <tr>
                  <th className="py-1.5">Folio</th>
                  <th>Payee</th>
                  <th>Status</th>
                  <th>Settled</th>
                  <th>Document</th>
                  <th className="text-right">Balance</th>
                </tr>
              </thead>
              <tbody>
                {q.data!.items.map((f) => (
                  <tr key={f.id} className="border-t border-line">
                    <td className="py-1.5">
                      <button type="button" className="font-mono text-[12px] font-semibold text-primary" onClick={() => pms.open({ kind: 'folio', id: f.id })}>
                        {f.folio_no}
                      </button>
                    </td>
                    <td>{f.payee_name ?? '—'}</td>
                    <td>{f.status_label}</td>
                    <td>{stamp(f.settled_at)}</td>
                    <td>
                      {f.invoice_id ? (
                        (f.ar_reference ?? `Invoice #${f.invoice_id}`)
                      ) : f.receipt_no ? (
                        `Receipt ${f.receipt_no}`
                      ) : invoices ? (
                        <Button size="sm" variant="ghost" loading={busy === f.id} disabled={busy !== null || !pms.online} onClick={() => void invoice(f)}>
                          Invoice now
                        </Button>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="text-right">
                      <Money amount={f.balance} currency={f.currency} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Section>
      ) : null}
      {pms.may('pms.settings.manage') && pms.online ? <Outbox /> : null}
    </div>
  );
}

/** Hand-offs to Billing and Finance (`GET properties/{id}/outbox`): retried with backoff, then waiting for a person. */
export function Outbox() {
  const pms = usePms();
  const qc = useQueryClient();
  const pid = pms.property.id;
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const q = useQuery({ queryKey: K.outbox(pid, status), queryFn: ({ signal }) => pGet<{ items: OutboxRow[] }>(`/properties/${pid}/outbox`, status ? { status } : undefined, signal) });
  const retry = async (o: OutboxRow) => {
    setBusy(o.id);
    setError(null);
    try {
      toast('success', (await pPost(`/outbox/${o.id}/retry`, {})).message);
      void qc.invalidateQueries({ queryKey: ['pms', 'outbox'] });
    } catch (e) {
      setError(errorText(e, 'It was not sent again.'));
    } finally {
      setBusy(null);
    }
  };
  return (
    <Section title="Hand-offs to Billing" action={<Select aria-label="Hand-off status" value={status} options={OUTBOX_STATUSES} onChange={(e) => setStatus(e.target.value)} className={`${input} w-52`} />}>
      {error ? <div className="mb-2"><Refusal text={error} /></div> : null}
      {q.isLoading ? (
        <Spinner />
      ) : q.error ? (
        <ErrorNote error={q.error} onRetry={() => void q.refetch()} />
      ) : (q.data?.items ?? []).length === 0 ? (
        <p className="m-0 text-[13px] text-ink-3">Nothing here.</p>
      ) : (
        <ul className="m-0 flex list-none flex-col p-0 text-[13px]">
          {q.data!.items.map((o) => (
            <li key={o.id} className="flex flex-wrap items-center gap-2 border-t border-line py-1.5 first:border-t-0">
              <span className="min-w-0 flex-1">
                <b>{o.topic}</b> · {o.ref_type} {o.ref_id} · <span className={o.status === 'dead' ? 'font-semibold text-danger' : o.status === 'failed' ? 'font-semibold text-warning' : ''}>{o.status_label}</span>
                <span className="text-[12px] text-ink-3">
                  {' '}
                  · {o.attempts} {o.attempts === 1 ? 'attempt' : 'attempts'}
                  {o.next_attempt_at ? ` · next ${stamp(o.next_attempt_at)}` : ''}
                </span>
                {o.last_error ? <span className="block text-[12px] text-danger">{o.last_error}</span> : null}
              </span>
              <span className="text-[12px] text-ink-3">{day(o.created_at)}</span>
              {o.status === 'dead' ? (
                <Button size="sm" loading={busy === o.id} disabled={busy !== null || !pms.online} onClick={() => void retry(o)}>
                  Retry
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}
