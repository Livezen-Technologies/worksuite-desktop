import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { cx } from '../../components/ui';
import { toast } from '../../core/toasts';
import { cashMove, openDrawer, PK, type PosSession } from './api';
import { useT } from './i18n';
import { BigAmount, Keypad } from './Keypad';
import { press } from './numpad';
import { ON } from './look';
import { Note, PosButton, PosDialog, useTillContext } from './parts';
import { formatMoney, parseAmount } from './pricing';

/**
 * Cash put into the drawer or taken out of it, from the counter: in or out (as the person may), the amount on the
 * keypad, why — the company's reasons (`options.cash_reasons`) or one typed — and a reference. WorkSuite records it
 * in the register's shift (`POST sessions/{id}/cash`), so it waits for WorkSuite; the drawer opens once it is
 * recorded.
 */
export default function CashMove({ session, onClose }: { session: PosSession; onClose: () => void }) {
  const t = useT();
  const till = useTillContext();
  const qc = useQueryClient();
  const can = till.company?.can;
  const [direction, setDirection] = useState<'in' | 'out'>(can?.cash_in || !can?.cash_out ? 'in' : 'out');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [reference, setReference] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const reasons = till.options?.cash_reasons?.[direction] ?? [];
  const value = parseAmount(amount);
  const allowed = direction === 'in' ? !!can?.cash_in : !!can?.cash_out;
  const ready = allowed && !till.offline && value > 0 && !!reason.trim();

  async function record() {
    if (!ready) return;
    setBusy(true);
    setError(null);
    try {
      const m = await cashMove(session.id, { direction, amount: Math.round(value * 100) / 100, reason: reason.trim().slice(0, 120), ...(reference.trim() ? { reference: reference.trim().slice(0, 120) } : {}) });
      toast('success', m ?? t('pos.cash.done'));
      void qc.invalidateQueries({ queryKey: PK.session(session.id) });
      void qc.invalidateQueries({ queryKey: PK.registers });
      void openDrawer().catch(() => undefined);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The money could not be recorded.');
    } finally {
      setBusy(false);
    }
  }

  const tab = (d: 'in' | 'out') => (
    <button
      key={d}
      type="button"
      role="tab"
      aria-selected={direction === d}
      disabled={d === 'in' ? !can?.cash_in : !can?.cash_out}
      onClick={() => {
        setDirection(d);
        setReason('');
      }}
      className={cx('h-12 rounded-[10px] px-[22px] text-[15px] disabled:opacity-40', direction === d ? 'bg-pos-bar font-bold text-white' : 'font-semibold text-ink-2')}
    >
      {t(d === 'in' ? 'pos.cash.in' : 'pos.cash.out')}
    </button>
  );

  return (
    <PosDialog label={t(direction === 'in' ? 'pos.cash.inTitle' : 'pos.cash.outTitle')} onClose={busy ? undefined : onClose} width={860} className="gap-4 overflow-y-auto p-7 scroll-thin">
      <div className="flex items-center gap-3">
        <div role="tablist" aria-label={t('pos.cashInOut')} className="flex gap-1 rounded-pos bg-pos-key p-1">
          {tab('in')}
          {tab('out')}
        </div>
        <span className="flex-1" />
        <span className="truncate text-[13px] text-ink-3">{[session.register_code ?? session.register, session.cashier].filter(Boolean).join(' · ')}</span>
      </div>
      <div className="flex gap-4">
        <div className="flex min-w-0 flex-1 flex-col gap-3">
          <div className="text-[14px] font-bold text-ink-2">{t('pos.amount')}</div>
          <BigAmount size="lg" autoFocus value={amount} onChange={setAmount} aria-label={t('pos.amount')} />
          <div className="text-[14px] font-bold text-ink-2">{t('pos.cash.what')}</div>
          <div className="flex flex-wrap gap-2">
            {reasons.map((r) => (
              <button key={r} type="button" aria-pressed={reason === r} onClick={() => setReason(r)} className={cx('h-12 rounded-[12px] px-4 text-[14px] font-semibold', reason === r ? `${ON} text-primary` : 'bg-pos-key text-ink hover:brightness-95')}>
                {r}
              </button>
            ))}
          </div>
          <input
            value={reasons.includes(reason) ? '' : reason}
            onChange={(e) => setReason(e.target.value.slice(0, 120))}
            placeholder={reasons.length ? t('pos.cash.otherReason') : t('pos.reason')}
            aria-label={t('pos.reason')}
            className="h-touch-md rounded-[12px] bg-pos-panel px-3.5 text-[15px] shadow-[inset_0_0_0_1px_#cbd5e1] outline-none focus:shadow-[inset_0_0_0_2px_var(--pos-on-ring)]"
          />
          <div className="text-[14px] font-bold text-ink-2">{t('pos.reference')}</div>
          <input
            value={reference}
            onChange={(e) => setReference(e.target.value.slice(0, 120))}
            aria-label={t('pos.reference')}
            className="h-touch-md rounded-[12px] bg-pos-panel px-3.5 text-[15px] shadow-[inset_0_0_0_1px_#cbd5e1] outline-none focus:shadow-[inset_0_0_0_2px_var(--pos-on-ring)]"
          />
        </div>
        <Keypad className="w-[280px] shrink-0 content-start" keys={['7', '8', '9', '4', '5', '6', '1', '2', '3', '00', '0', 'back']} onKey={(k) => setAmount((v) => press(v, k))} />
      </div>
      <div className="rounded-[12px] bg-pos-key px-3.5 py-3 text-[13px] text-ink-2">{t('pos.cash.note')}</div>
      {till.offline ? <Note tone="warning">{t('pos.cash.offline')}</Note> : null}
      {!allowed ? <Note tone="warning">{t(direction === 'in' ? 'pos.cash.mayNotIn' : 'pos.cash.mayNotOut')}</Note> : null}
      {error ? <Note tone="danger">{error}</Note> : null}
      <div className="flex gap-2.5">
        <PosButton className="h-touch-lg w-[200px] text-[15px]" disabled={busy} onClick={onClose}>
          {t('pos.cancel')}
        </PosButton>
        <PosButton tone="primary" className="h-touch-lg flex-1 text-[17px] font-extrabold" disabled={!ready || busy} onClick={() => void record()}>
          {t(direction === 'in' ? 'pos.cash.doIn' : 'pos.cash.doOut', { n: formatMoney(value > 0 ? value : 0) })}
        </PosButton>
      </div>
    </PosDialog>
  );
}
