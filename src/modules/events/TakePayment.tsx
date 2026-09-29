import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Button, Modal, Spinner } from '../../components/ui';
import { toast } from '../../core/toasts';
import { at, eGet, ePost, errorText, money, newKey, nice, type PaymentView } from './api';
import { Facts, Refusal } from './parts';

/**
 * Taking the money at the desk for a ticket waiting for its payment
 * (EV-CHK-010 "PAYMENT_REQUIRED — option to take payment if permitted",
 * §6.2): what is owed is the server's (`GET registrations/{id}/payment`), the
 * money is recorded in Billing by the server (`POST …/payment/take`, with
 * Billing's own permission), and the ticket is confirmed when Billing has it.
 * One idempotency key per attempt: a second press is the same payment.
 */
export default function TakePayment({ registrationId, who, onClose, onPaid }: { registrationId: number; who: string; onClose: () => void; onPaid: () => void }) {
  const pay = useQuery({ queryKey: ['events', 'payment', registrationId], queryFn: ({ signal }) => eGet<PaymentView>(`/registrations/${registrationId}/payment`, undefined, signal) });
  const live = useQuery({ queryKey: ['events', 'options-live'], queryFn: ({ signal }) => eGet<{ payment_methods: string[] }>('/options/live', undefined, signal), staleTime: 300_000 });
  const methods = (live.data?.payment_methods ?? []).filter((m) => m !== 'offset');
  const [method, setMethod] = useState('cash');
  const [reference, setReference] = useState('');
  const [key] = useState(() => newKey('pay'));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const p = pay.data;

  const take = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await ePost<{ confirmed?: boolean }>(`/registrations/${registrationId}/payment/take`, { method, reference: reference.trim() || undefined }, key);
      toast('success', r.message);
      onPaid();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title={`Take payment — ${who}`}
      onClose={onClose}
      width={480}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" icon="credit-card" loading={busy} disabled={!p || methods.length === 0} onClick={() => void take()}>
            Take {p?.due ? money(p.due, p.currency) : 'payment'}
          </Button>
        </>
      }
    >
      {pay.isLoading ? <Spinner /> : null}
      {pay.error ? <Refusal text={errorText(pay.error)} /> : null}
      {p ? (
        <div className="flex flex-col gap-3">
          <Facts
            rows={[
              ['Owed', <b key="d">{money(p.due, p.currency)}</b>],
              ['Ticket price', money(p.price, p.currency)],
              ...(p.discount && p.discount !== '0.00' ? ([['Discount', money(p.discount, p.currency)]] as Array<[string, string]>) : []),
              ['Payment', p.payment_status_label ?? '—'],
              ...(p.invoice ? ([['Invoice', `${p.invoice.number} · ${money(p.invoice.outstanding, p.currency)} outstanding`]] as Array<[string, string]>) : []),
              ...(p.pay_by ? ([['Seat held until', at(p.pay_by)]] as Array<[string, string]>) : []),
            ]}
          />
          {methods.length === 0 && live.data ? <Refusal text="Billing is not part of this installation, so money cannot be taken at the desk." /> : null}
          {methods.length > 0 ? (
            <div className="flex flex-col gap-2">
              <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="How they pay">
                {methods.map((m) => (
                  <button
                    key={m}
                    type="button"
                    role="radio"
                    aria-checked={method === m}
                    onClick={() => setMethod(m)}
                    className={`h-8 rounded-[8px] border px-3 text-[12.5px] font-semibold ${method === m ? 'border-primary bg-selection text-primary' : 'border-line bg-surface text-ink-2'}`}
                  >
                    {nice(m)}
                  </button>
                ))}
              </div>
              <label className="flex flex-col gap-1 text-[12.5px] font-semibold text-ink-2">
                Reference {method === 'cash' || method === 'other' ? '(optional)' : '(the slip, transfer or cheque number)'}
                <input value={reference} onChange={(e) => setReference(e.target.value)} maxLength={120} className="h-9 rounded-[8px] border border-line bg-surface px-2.5 text-[13px] font-normal text-ink outline-none focus:border-primary" />
              </label>
            </div>
          ) : null}
          {error ? <Refusal text={error} /> : null}
        </div>
      ) : null}
    </Modal>
  );
}
