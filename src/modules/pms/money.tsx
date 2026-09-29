import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Select } from '../../components/Select';
import { Button, Modal } from '../../components/ui';
import { Field, input } from '../garage/parts';
import { errorText, K, money, pGet, type Shift } from './api';
import { device } from './devices';
import { Refusal, usePms } from './parts';

/** How a guest pays (the server's `PaymentMachine::METHODS`, less "deposit", which is money moved, not taken). */
export const METHODS: Array<{ value: string; label: string }> = [
  { value: 'cash', label: 'Cash' },
  { value: 'card', label: 'Credit / debit card' },
  { value: 'bank_transfer', label: 'Bank transfer' },
  { value: 'online', label: 'Online payment' },
  { value: 'payment_link', label: 'Payment link' },
  { value: 'ota_virtual_card', label: 'OTA virtual card' },
  { value: 'corporate_credit', label: 'Corporate credit' },
  { value: 'advance', label: 'Advance' },
];

/** The methods a provider settles: they may be recorded as waiting for its answer. */
export const PROVIDER_METHODS = new Set(['card', 'online', 'payment_link', 'ota_virtual_card']);

const TERMINAL_KEY = 'pms.terminal';

/** This desk's name for the records (a payment keeps its shift and terminal, PMS-CSH-002): the open shift's, else what the desk called itself. */
export function deskName(shift: Shift | null | undefined): string {
  if (shift?.terminal) return shift.terminal;
  try {
    return localStorage.getItem(TERMINAL_KEY) || 'Front desk';
  } catch {
    return 'Front desk';
  }
}

export function keepDeskName(name: string): void {
  try {
    localStorage.setItem(TERMINAL_KEY, name.trim().slice(0, 60));
  } catch {
    /* a convenience */
  }
}

/** The person's own open cashier shift at this property, when they may see shifts. */
export function useMyShift(): { shift: Shift | null; loading: boolean } {
  const pms = usePms();
  const reads = pms.mayAny('pms.cashier.open', 'pms.cashier.close', 'pms.payment.view');
  const q = useQuery({
    queryKey: K.cashier(pms.property.id),
    queryFn: ({ signal }) => pGet<{ items: Shift[]; mine: Shift | null }>(`/properties/${pms.property.id}/cashier-sessions`, undefined, signal),
    enabled: reads && pms.online,
  });
  return { shift: q.data?.mine ?? null, loading: q.isLoading && reads };
}

/**
 * Taking money (PMS-PAY-001…003): the method, the amount the desk was handed
 * and, for a card, the terminal's reference and the last four digits — a
 * card number is never typed here, and the server refuses one. With a card
 * terminal connected (the device agent) it charges the card and answers with
 * its token. Cash is taken in the cashier's open shift.
 */
export function PaymentDialog({ title, currency, owed, busy, error, onClose, onPay }: { title: string; currency: string; owed?: string | null; busy: boolean; error: string | null; onClose: () => void; onPay: (body: Record<string, unknown>) => void }) {
  const pms = usePms();
  const { shift } = useMyShift();
  const [method, setMethod] = useState('cash');
  const [amount, setAmount] = useState(owed && !owed.startsWith('-') && owed !== '0.00' ? owed : '');
  const [cur, setCur] = useState(currency);
  const [last4, setLast4] = useState('');
  const [ref, setRef] = useState('');
  const [pending, setPending] = useState(false);
  const [charging, setCharging] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const terminal = device('payment_terminal');
  const provider = PROVIDER_METHODS.has(method);
  const valid = /^\d+(\.\d{1,2})?$/.test(amount.trim()) && Number(amount) > 0 && (!last4 || /^\d{4}$/.test(last4)) && /^[A-Z]{3}$/.test(cur);
  const base = () => ({ method, amount: amount.trim(), currency: cur, terminal: deskName(shift) });

  const submit = () => {
    if (!valid) return;
    onPay({ ...base(), ...(last4 ? { card_last4: last4 } : {}), ...(ref.trim() ? { provider_ref: ref.trim() } : {}), ...(provider && pending ? { pending: true } : {}) });
  };

  const chargeTerminal = async () => {
    setCharging(true);
    setNote(null);
    try {
      const out = await terminal.charge({ amount: amount.trim(), currency: cur, reference: title });
      if (!out.approved) {
        setNote(out.message);
        return;
      }
      onPay({ ...base(), provider: out.provider, provider_ref: out.provider_ref, card_token: out.card_token, card_last4: out.card_last4 });
    } catch (e) {
      setNote(errorText(e, 'The terminal did not answer.'));
    } finally {
      setCharging(false);
    }
  };

  return (
    <Modal
      title={title}
      onClose={onClose}
      width={480}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          {method === 'card' && terminal.available() ? (
            <Button icon="credit-card" loading={charging} disabled={!valid || busy} onClick={() => void chargeTerminal()}>
              Charge on the terminal
            </Button>
          ) : null}
          <Button variant="primary" loading={busy} disabled={!valid || charging || !pms.online} onClick={submit}>
            {provider && pending ? 'Record as waiting' : 'Take payment'}
          </Button>
        </>
      }
    >
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        {owed ? <p className="m-0 text-[13px] text-ink-2">Owed now: {money(owed, currency)}</p> : null}
        <div className="grid grid-cols-2 gap-3">
          <Field label="Method">
            <Select aria-label="Method" value={method} onChange={(e) => setMethod(e.target.value)} options={METHODS} className={input} />
          </Field>
          <Field label="Amount *">
            <input aria-label="Amount" className={input} inputMode="decimal" autoFocus value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" />
          </Field>
          <Field label="Currency" hint={cur !== currency ? 'Converted at Billing’s rate for the business date.' : undefined}>
            <input aria-label="Currency" className={input} maxLength={3} value={cur} onChange={(e) => setCur(e.target.value.toUpperCase())} />
          </Field>
          {provider ? (
            <Field label="Card: last four digits" hint="Never the card number.">
              <input aria-label="Last four digits" className={input} inputMode="numeric" maxLength={4} value={last4} onChange={(e) => setLast4(e.target.value.replace(/\D/g, '').slice(0, 4))} />
            </Field>
          ) : null}
        </div>
        {provider ? (
          <>
            <Field label="Terminal or provider reference">
              <input aria-label="Reference" className={input} value={ref} onChange={(e) => setRef(e.target.value)} placeholder="Approval code from the slip" />
            </Field>
            <label className="flex items-center gap-2 text-[12.5px] text-ink-2">
              <input type="checkbox" checked={pending} onChange={(e) => setPending(e.target.checked)} /> The provider has not confirmed it yet (it stays waiting until it does)
            </label>
          </>
        ) : null}
        <p className="m-0 text-[12px] text-ink-3">
          Recorded at {deskName(shift)}
          {shift ? ` in your shift (${shift.business_date})` : method === 'cash' ? ' — cash needs your open cashier shift' : ''}.
        </p>
        {note ? <Refusal text={note} /> : null}
        {error ? <Refusal text={error} /> : null}
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}
