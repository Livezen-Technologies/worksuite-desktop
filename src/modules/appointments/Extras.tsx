import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { toast } from '../../core/toasts';
import { Button } from '../../components/ui';
import { fetchCancelFee, fetchIntake, K, money, offerFreed, recordConsent, sendIntake, tellProvider, waiveFee, type Appointment, type Fee } from './api';
import { errText, input, Pill, useDesk, useNow } from './parts';

/**
 * Appointments 1.2 in the panel (server docs/appointments-api.md): the intake form and consent (APT-F17), the
 * cancellation and no-show fees the policy raised (T-14, waived with a reason), and for a freed time — offer it to
 * the waiting list again — and a word to the provider. Each part is the server's; on an older server it is not shown.
 */

const FEE_KIND: Record<string, string> = { late_cancel: 'Late cancel fee', no_show: 'No-show fee' };
const FEE_HOW: Record<string, string> = { deducted: 'taken from the deposit', invoiced: 'invoiced', waived: 'waived', due: 'due' };

export function FeesBlock({ fees }: { fees: Fee[] }) {
  const desk = useDesk();
  const qc = useQueryClient();
  const [waiving, setWaiving] = useState<number | null>(null);
  const [why, setWhy] = useState('');
  if (!fees.length) return null;
  const waive = async (id: number) => {
    try {
      const r = await waiveFee(id, why.trim());
      toast('success', r.message || 'Waived.');
      setWaiving(null);
      setWhy('');
      void qc.invalidateQueries({ queryKey: K.all });
    } catch (e) {
      toast('error', errText(e));
    }
  };
  return (
    <>
      {fees.map((f) => (
        <div key={f.id} className="py-0.5 text-[12.5px]">
          <div className="flex items-center gap-2">
            <span className="w-[90px] shrink-0 text-ink-3">{FEE_KIND[f.kind] ?? f.kind}</span>
            <span className="min-w-0 flex-1 text-ink">{`${money(Number(f.amount), f.currency)} · ${FEE_HOW[f.status] ?? f.status}`}</span>
            {f.status !== 'waived' && desk.online && waiving !== f.id ? <Button size="sm" variant="ghost" onClick={() => (setWaiving(f.id), setWhy(''))}>Waive…</Button> : null}
          </div>
          {waiving === f.id ? (
            <div className="mt-1 flex gap-1.5">
              <input autoFocus aria-label="Why it is waived" placeholder="Why (kept in the history)" className={input} value={why} maxLength={200} onChange={(e) => setWhy(e.target.value)} />
              <Button size="sm" variant="primary" disabled={!why.trim()} onClick={() => void waive(f.id)}>Waive</Button>
              <Button size="sm" variant="ghost" onClick={() => setWaiving(null)}>Cancel</Button>
            </div>
          ) : null}
        </div>
      ))}
    </>
  );
}

export function IntakeBlock({ a }: { a: Appointment }) {
  const desk = useDesk();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['appointments', 'intake', a.id], queryFn: ({ signal }) => fetchIntake(a.id, signal), enabled: desk.online, retry: false, staleTime: 30_000 });
  const [signing, setSigning] = useState(false);
  const [name, setName] = useState(a.customer.name);
  const [busy, setBusy] = useState(false);
  const d = q.data;
  if (!d || (!d.required && !d.form && !d.consent && !d.fields.length)) return null;
  const run = async (fn: () => Promise<{ message: string }>, ok: string) => {
    setBusy(true);
    try {
      const r = await fn();
      toast('success', r.message || ok);
      setSigning(false);
      void qc.invalidateQueries({ queryKey: ['appointments', 'intake', a.id] });
    } catch (e) {
      toast('error', errText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="mt-4">
      <h3 className="m-0 mb-1 text-[11px] font-bold tracking-[.06em] text-ink-3 uppercase">Intake</h3>
      {d.form ? (
        <div className="flex items-center gap-2 py-0.5 text-[12.5px]">
          <span className="min-w-0 flex-1 truncate text-ink">{d.form.title}</span>
          <Pill tone={d.form.status === 'submitted' ? 'ok' : 'muted'}>{d.form.status === 'submitted' ? 'Sent back' : d.form.status}</Pill>
        </div>
      ) : d.required ? (
        <div className="flex items-center gap-2 py-0.5 text-[12.5px]">
          <span className="min-w-0 flex-1 text-ink-2">The form has not been sent yet.</span>
          <Button size="sm" variant="secondary" disabled={busy || !desk.online} onClick={() => void run(() => sendIntake(a.id), 'Sent.')}>Send form</Button>
        </div>
      ) : null}
      {d.form?.answers.map((x) => (
        <div key={x.key} className="flex gap-2 py-0.5 text-[12px]">
          <span className="w-[120px] shrink-0 text-ink-3">{x.label}</span>
          <span className="min-w-0 flex-1 text-ink">{x.value === true ? 'Yes' : x.value === false ? 'No' : String(x.value ?? '—')}</span>
        </div>
      ))}
      {d.fields.map((f) => (
        <div key={f.key} className="flex gap-2 py-0.5 text-[12px]">
          <span className="w-[120px] shrink-0 text-ink-3">{f.label}</span>
          <span className="min-w-0 flex-1 text-ink">{d.values[f.key] === undefined || d.values[f.key] === null || d.values[f.key] === '' ? '—' : String(d.values[f.key])}</span>
        </div>
      ))}
      {d.consent ? (
        d.consent.given ? (
          <p className="m-0 py-0.5 text-[12.5px] text-ink">{`Consent agreed${d.consent.name ? ` by ${d.consent.name}` : ''}${d.consent.how === 'online' ? ' online' : d.consent.how === 'desk' ? ' at the desk' : ''}${d.consent.at ? ` · ${new Date(d.consent.at).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}` : ''}`}</p>
        ) : signing ? (
          <div className="mt-1 rounded-[8px] border border-line p-2 text-[12.5px]">
            <p className="m-0 whitespace-pre-wrap text-ink-2">{d.consent.text}</p>
            <div className="mt-2 flex gap-1.5">
              <input aria-label="Name of the person agreeing" className={input} value={name} maxLength={120} onChange={(e) => setName(e.target.value)} />
              <Button size="sm" variant="primary" disabled={busy || !name.trim()} onClick={() => void run(() => recordConsent(a.id, name.trim()), 'Consent recorded.')}>Agreed</Button>
              <Button size="sm" variant="ghost" onClick={() => setSigning(false)}>Cancel</Button>
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-2 py-0.5 text-[12.5px]">
            <span className="min-w-0 flex-1 text-[#9A4A06] dark:text-warning">Consent not agreed yet.</span>
            <Button size="sm" variant="secondary" disabled={!desk.online} onClick={() => setSigning(true)}>Record at the desk…</Button>
          </div>
        )
      ) : null}
    </section>
  );
}

/** For a cancelled or no-show time still to come: offer it to the waiting list again, and a word to the provider. */
export function FreedActions({ a }: { a: Appointment }) {
  const desk = useDesk();
  const qc = useQueryClient();
  const [telling, setTelling] = useState(false);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const now = useNow();
  const freed = (a.status === 'cancelled' || a.status === 'no_show') && Date.parse(a.starts_at) > now;
  const offer = async () => {
    setBusy(true);
    try {
      const r = await offerFreed(a.id);
      toast('success', r.message || (r.data.made ? `Offered to ${r.data.made} on the waiting list.` : 'Nobody on the waiting list matches this time.'));
      void qc.invalidateQueries({ queryKey: K.all });
    } catch (e) {
      toast('error', errText(e));
    } finally {
      setBusy(false);
    }
  };
  const tell = async () => {
    setBusy(true);
    try {
      const r = await tellProvider(a.id, message.trim());
      toast('success', r.message || `Sent to ${a.provider.name}.`);
      setTelling(false);
      setMessage('');
      void qc.invalidateQueries({ queryKey: K.detail(a.id) });
    } catch (e) {
      toast('error', errText(e));
    } finally {
      setBusy(false);
    }
  };
  if (!desk.online) return null;
  return (
    <div className="mt-2 flex flex-col gap-1.5">
      <div className="flex flex-wrap gap-1.5">
        {freed && a.can.create !== false ? <Button size="sm" variant="secondary" disabled={busy} onClick={() => void offer()}>Offer the time to the waiting list</Button> : null}
        {!telling ? <Button size="sm" variant="ghost" onClick={() => setTelling(true)}>{`Tell ${a.provider.name}…`}</Button> : null}
      </div>
      {telling ? (
        <div className="flex flex-col gap-1.5">
          <textarea autoFocus aria-label={`Message to ${a.provider.name}`} rows={2} maxLength={500} className="w-full resize-none rounded-[8px] border border-line bg-surface px-2.5 py-1.5 text-[12.5px] text-ink outline-none focus:border-primary" value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Client is running 10 minutes late" />
          <div className="flex gap-1.5">
            <Button size="sm" variant="primary" disabled={busy || !message.trim()} onClick={() => void tell()}>Send</Button>
            <Button size="sm" variant="ghost" onClick={() => setTelling(false)}>Cancel</Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** What cancelling now would cost under the policy (the server's answer; nothing is written). */
export function CancelFeeNote({ a }: { a: Appointment }) {
  const desk = useDesk();
  const q = useQuery({ queryKey: ['appointments', 'cancel-fee', a.id], queryFn: ({ signal }) => fetchCancelFee(a.id, signal), enabled: desk.online, retry: false });
  const f = q.data;
  if (!f) return null;
  if (!f.late || !Number(f.fee)) return f.free_until ? <p className="mt-2 mb-0 text-[12px] text-ink-3">{`Free to cancel until ${new Date(f.free_until).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}.`}</p> : null;
  return (
    <p className="mt-3 mb-0 rounded-[8px] bg-[#FDF1E3] px-3 py-2 text-[12.5px] text-[#9A4A06] dark:bg-warning/15 dark:text-warning">
      {`Inside the ${f.window_hours ?? ''}-hour window: a late-cancel fee of ${money(Number(f.fee), f.currency)} applies${f.from === 'deducted' ? ', taken from the deposit held' : f.from === 'invoiced' ? ', raised as an invoice' : ''}. It can be waived afterwards, with a reason.`}
    </p>
  );
}
