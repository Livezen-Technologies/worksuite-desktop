import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Icon } from '../../components/Icon';
import { cx } from '../../components/ui';
import { toast } from '../../core/toasts';
import { amount, answered, attemptKey, K, refusal, type Visit } from './api';
import { fetchRegister, MK, moneyTyped, openDrawer, takeAdvance, type AdvanceBody } from './money';
import { DeskDialog, Note, servicesOf, stylistsOf, TouchButton, usePrintSettings, type Desk } from './parts';

/**
 * Taking a visit's deposit at the counter (D02 "Take deposit", D16 "Book ·
 * take deposit", PAY-05).
 *
 * The deposit is an advance on the visit: WorkSuite records the Billing
 * receipt and puts it into this desk's open POS register as a sale of its
 * own, so the drawer and the close count it once. While the register is shut
 * it is refused before anything is recorded. One press is one advance: the
 * request carries a key made for the attempt, so a press after a dropped
 * line sends the same one again, never a second.
 */
type Method = AdvanceBody['method'];

const METHODS: Array<{ value: Method; label: string; icon: string }> = [
  { value: 'cash', label: 'Cash', icon: 'banknote' },
  { value: 'card', label: 'Card', icon: 'credit-card' },
  { value: 'wallet', label: 'LankaQR', icon: 'qr-code' },
  { value: 'bank_transfer', label: 'Bank transfer', icon: 'landmark' },
];

export function useDeposit(desk: Pick<Desk, 'desk' | 'go' | 'may'> | null) {
  const [open, setOpen] = useState<Visit | null>(null);
  const panel = open && desk ? <DepositPanel key={open.id} visit={open} desk={desk} onClose={() => setOpen(null)} /> : null;
  return { start: (v: Visit) => setOpen(v), panel };
}

function DepositPanel({ visit, desk, onClose }: { visit: Visit; desk: Pick<Desk, 'desk' | 'go' | 'may'>; onClose: () => void }) {
  const qc = useQueryClient();
  const print = usePrintSettings();
  const owed = visit.money.deposit_owed > 0 ? visit.money.deposit_owed : visit.money.deposit_due;
  const [method, setMethod] = useState<Method>('cash');
  const [value, setValue] = useState(owed > 0 ? String(owed) : '');
  const [reference, setReference] = useState('');
  const [busy, setBusy] = useState(false);
  const [key, setKey] = useState(attemptKey);
  const [closed, setClosed] = useState<string | null>(null);
  const register = useQuery({ queryKey: MK.register(desk.desk.id), queryFn: ({ signal }) => fetchRegister(desk.desk.id, signal) });
  const reg = register.data;
  const shut = !!reg?.register && !reg.session;
  const n = Number(value || 0);
  const needsRef = method !== 'cash' && reference.trim() === '';
  const currency = visit.money.currency;

  const pick = (m: Method) => {
    setMethod(m);
    setKey(attemptKey());
  };

  async function take() {
    setBusy(true);
    try {
      const r = await takeAdvance(visit.id, { amount: n, method, reference: method === 'cash' ? null : reference.trim(), desk_id: desk.desk.id }, key);
      toast('success', r.message || `${amount(n, currency)} deposit taken for ${visit.client.name}.`);
      if (method === 'cash' && print.data?.drawer === 'printer') {
        void openDrawer()
          .then((o) => !o.ok && toast('warning', o.message))
          .catch(() => toast('warning', 'The drawer did not open. Open it from Printers & receipts.'));
      }
      void qc.invalidateQueries({ queryKey: K.all });
      onClose();
    } catch (e) {
      if (!answered(e)) {
        toast('error', 'WorkSuite did not answer. Press again — the same deposit is sent, never a second one.');
      } else {
        setKey(attemptKey());
        const d = refusal<{ code?: string }>(e);
        if (d.code === 'register_closed') {
          setClosed(e instanceof Error ? e.message : 'The register is closed.');
          void qc.invalidateQueries({ queryKey: MK.register(desk.desk.id) });
        } else {
          toast('error', e instanceof Error ? e.message : 'The deposit was not taken.');
        }
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <DeskDialog
      tone="warning"
      icon="wallet"
      title={`Take ${visit.client.name}’s deposit`}
      sub={`${servicesOf(visit)} with ${stylistsOf(visit)} · ${visit.start}${visit.money.deposit_owed > 0 ? ` · ${amount(visit.money.deposit_owed, currency)} owed` : ''}`}
      labelledBy="salon-deposit"
      width={620}
      onClose={onClose}
      footer={
        <>
          <TouchButton onClick={onClose}>Not now</TouchButton>
          <TouchButton variant="primary" icon="check" loading={busy} disabled={!(n > 0) || needsRef || !!closed || shut || !desk.may('salon.checkout')} onClick={() => void take()}>
            Take {n > 0 ? amount(n, currency) : 'deposit'}
          </TouchButton>
        </>
      }
    >
      <div className="flex flex-col gap-3.5">
        {closed || shut ? (
          <Note
            tone="warning"
            action={
              desk.may('pos.register.open') ? (
                <TouchButton
                  className="min-h-10 text-[13px]"
                  onClick={() => {
                    onClose();
                    desk.go('register');
                  }}
                >
                  Open register
                </TouchButton>
              ) : null
            }
          >
            {closed ?? `Register ${reg?.register?.code ?? ''} is closed. A deposit goes into it, so open it first.`}
          </Note>
        ) : reg?.register && reg.session ? (
          <Note tone="teal" icon="printer">
            Into register <b>{reg.register.code}</b>, session #{reg.session.id}.
          </Note>
        ) : null}

        <div role="radiogroup" aria-label="How they pay the deposit" className="grid grid-cols-4 gap-2">
          {METHODS.map((m) => (
            <button
              key={m.value}
              type="button"
              role="radio"
              aria-checked={method === m.value}
              onClick={() => pick(m.value)}
              className={cx(
                'flex min-h-[70px] flex-col items-center justify-center gap-1.5 rounded-[14px] text-[13px] font-bold',
                method === m.value ? 'border-2 border-primary bg-selection text-primary' : 'border border-line bg-surface text-ink hover:bg-subtle',
              )}
            >
              <Icon name={m.icon} size={20} />
              {m.label}
            </button>
          ))}
        </div>

        <label className="flex flex-col gap-1">
          <span className="text-[12px] font-bold tracking-[.05em] text-ink-2 uppercase">Deposit taken</span>
          <input
            inputMode="decimal"
            aria-label="Deposit taken"
            value={value}
            onChange={(e) => {
              setValue(moneyTyped(e.target.value));
              setKey(attemptKey());
            }}
            className="rounded-[14px] border-2 border-primary bg-surface px-3.5 py-2 text-right font-mono text-[28px] font-bold text-ink outline-none tabular-nums"
          />
        </label>
        {method !== 'cash' ? (
          <label className="flex flex-col gap-1">
            <span className="text-[12.5px] font-semibold text-ink-2">Reference</span>
            <input
              maxLength={120}
              value={reference}
              placeholder={method === 'card' ? 'The approval code, or the last four digits' : method === 'wallet' ? 'The LankaQR transaction id' : 'The transfer reference'}
              onChange={(e) => {
                setReference(e.target.value);
                setKey(attemptKey());
              }}
              className="h-11 rounded-[10px] border border-line bg-surface px-3 text-[14px] text-ink outline-none focus:border-primary"
            />
          </label>
        ) : null}
        <p className="text-[13px] text-ink-2">The deposit is held against the visit and taken off the bill at checkout, once. {method === 'cash' ? 'The drawer opens.' : ''}</p>
      </div>
    </DeskDialog>
  );
}
