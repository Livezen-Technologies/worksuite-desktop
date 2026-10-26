import { useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { toast } from '../../core/toasts';
import { Button, cx, Modal } from '../../components/ui';
import { Checkbox } from '../../components/Checkbox';
import { addDays, dayLabel, fetchAvailability, fetchDeposits, K, linkDeposit, money, recordPayment, refusal, reschedule, today, weekStart, type Appointment } from './api';
import { Chips, errText, input, Kbd, label, Refused, useDesk, useMove, useNow } from './parts';
import { depositHtml, printPage, type DeskSettings } from './print';
import { CancelFeeNote } from './Extras';

/**
 * The panel's dialogs: D09 check-in, D10 move, D11 cancel or no-show, D12 deposit. Each asks the server and shows its
 * answer; nothing is decided here.
 */

/** D09 · Check-in: what to read before starting, the contact on file to check, then Check in (queued offline). */
export function CheckInDialog({ a, visits, noShows, pinned, onClose }: { a: Appointment; settings: DeskSettings; visits: number | null; noShows: number | null; pinned: string[]; onClose: () => void }) {
  const move = useMove();
  const [busy, setBusy] = useState(false);
  const now = useNow();
  const early = Math.round((Date.parse(a.starts_at) - now) / 60_000);
  const go = async () => {
    setBusy(true);
    if (await move(a, 'checked_in')) onClose();
    setBusy(false);
  };
  return (
    <Modal
      title={`Check in ${a.customer.name}`}
      onClose={onClose}
      width={520}
      footer={<><Button variant="secondary" onClick={onClose}>Not yet</Button><Button variant="primary" autoFocus loading={busy} onClick={() => void go()}>Check in<Kbd>⏎</Kbd></Button></>}
    >
      <p className="m-0 text-[13px] text-ink-2">{`${a.service.name} · ${a.provider.name} · ${a.local.start}–${a.local.end} · ${early > 0 ? `${early} min early` : early < 0 ? `${-early} min late` : 'on time'}`}</p>
      <div className="mt-3 grid grid-cols-3 gap-2">
        <Stat k="Visits" v={visits ?? '—'} />
        <Stat k="No-shows" v={noShows ?? '—'} />
        <Stat k="Deposit held" v={a.deposit ? money(a.deposit.held, a.deposit.currency) : '—'} />
      </div>
      {pinned.length || a.internal_notes ? (
        <div className="mt-3 rounded-[8px] bg-[#FDF1E3] px-3 py-2 text-[12.5px] text-[#9A4A06] dark:bg-warning/15 dark:text-warning">
          <b>Read before starting: </b>
          {[...pinned, a.internal_notes].filter(Boolean).join(' ')}
        </div>
      ) : null}
      <div className="mt-3 grid grid-cols-2 gap-2 text-[12.5px]">
        <div><span className={label}>Phone (check it is current)</span><div className="text-ink">{a.customer.phone ?? '—'}</div></div>
        <div><span className={label}>Email</span><div className="text-ink">{a.customer.email ?? '—'}</div></div>
      </div>
    </Modal>
  );
}

function Stat({ k, v }: { k: string; v: string | number }) {
  return (
    <div className="rounded-[10px] border border-line px-3 py-2">
      <div className="text-[11px] text-ink-3">{k}</div>
      <div className="text-[15px] font-bold text-ink tabular-nums">{v}</div>
    </div>
  );
}

/** D10 · Move: free times by week from the server, for this stylist or another; why; the deposit stays. */
export function MoveDialog({ a, onClose }: { a: Appointment; onClose: () => void }) {
  const desk = useDesk();
  const qc = useQueryClient();
  const providers = (desk.options?.providers ?? []).filter((p) => (!p.locations.length || p.locations.includes(a.location.id)) && (!p.services.length || p.services.includes(a.service.id)));
  const [provider, setProvider] = useState<number>(a.provider.id);
  const [week, setWeek] = useState(() => weekStart(a.local.date ?? today(a.timezone)));
  const [pick, setPick] = useState<{ starts_at: string; label: string; date: string } | null>(null);
  const [why, setWhy] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const days = Array.from({ length: 7 }, (_, i) => addDays(week, i)).filter((d) => d >= today(a.timezone));
  const qs = useQueries({
    queries: days.map((d) => ({
      queryKey: K.availability({ move: a.id, provider, d }),
      queryFn: ({ signal }: { signal: AbortSignal }) => fetchAvailability({ location: a.location.id, service: a.service.id, provider, date: d, except: a.id }, signal),
      staleTime: 0,
    })),
  });
  const go = async () => {
    if (!pick) return;
    setBusy(true);
    setErr(null);
    try {
      const r = await reschedule(a.id, { starts_at: pick.starts_at, provider_id: provider, reason: why.trim() || undefined });
      toast('success', r.message || 'Moved.');
      void qc.invalidateQueries({ queryKey: K.all });
      onClose();
    } catch (e) {
      const f = refusal(e);
      setErr(f.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title={`Move ${a.number}`}
      onClose={onClose}
      width={760}
      footer={<><Button variant="secondary" onClick={onClose}>Keep as it is</Button><Button variant="primary" loading={busy} disabled={!pick || !desk.online} onClick={() => void go()}>{pick ? `Move to ${dayLabel(pick.date)}, ${pick.label}` : 'Choose a time'}</Button></>}
    >
      <p className="m-0 text-[13px] text-ink-2">{`${a.customer.name} · ${a.service.name} (${a.duration_min} min) · now ${a.local.date} ${a.local.start} with ${a.provider.name} · ${a.location.name}`}</p>
      <div className="mt-3 flex items-center gap-2">
        <select className={cx(input, 'w-auto')} aria-label="Stylist" value={provider} onChange={(e) => (setProvider(Number(e.target.value)), setPick(null))}>
          {providers.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <span className="flex-1" />
        <Button size="sm" variant="secondary" icon="chevron-left" aria-label="Previous week" disabled={week <= weekStart(today(a.timezone))} onClick={() => setWeek(addDays(week, -7))} />
        <span className="text-[12.5px] font-semibold text-ink">{`Free times · week of ${dayLabel(week)}`}</span>
        <Button size="sm" variant="secondary" icon="chevron-right" aria-label="Next week" onClick={() => setWeek(addDays(week, 7))} />
      </div>
      <div className="mt-3 grid grid-cols-7 gap-2">
        {days.map((d, i) => {
          const slots = qs[i]?.data?.providers.flatMap((p) => p.slots) ?? [];
          return (
            <div key={d}>
              <div className="mb-1 text-center text-[11.5px] font-semibold text-ink-2">{dayLabel(d)}</div>
              <div className="flex max-h-[200px] flex-col gap-1 overflow-y-auto scroll-thin">
                {slots.map((s) => (
                  <button key={s.starts_at} type="button" aria-pressed={pick?.starts_at === s.starts_at} onClick={() => setPick({ starts_at: s.starts_at, label: s.label, date: d })} className={cx('h-7 rounded-[6px] border text-[11.5px] tabular-nums', pick?.starts_at === s.starts_at ? 'border-primary bg-[#23349E] font-bold text-white dark:bg-primary' : 'border-line hover:bg-subtle')}>
                    {s.label}
                  </button>
                ))}
                {qs[i]?.isPending ? <span className="text-center text-[11px] text-ink-3">…</span> : !slots.length ? <span className="text-center text-[11px] text-ink-3">None</span> : null}
              </div>
            </div>
          );
        })}
      </div>
      <label className="mt-3 block"><span className={label}>Why is it moving? (kept in the history)</span><input className={input} value={why} maxLength={200} onChange={(e) => setWhy(e.target.value)} /></label>
      <p className="mt-2 mb-0 text-[12px] text-ink-3">{`${a.deposit ? `The deposit (${money(a.deposit.due, a.deposit.currency)}) stays with the appointment. ` : ''}The client is told of the new time, old reminders are dropped and new ones set — as WorkSuite is set up to.`}</p>
      <div className="mt-2"><Refused>{err}</Refused></div>
    </Modal>
  );
}

const REASONS = ['Client asked', 'Client is unwell', 'Stylist unavailable', 'Booked by mistake', 'Double booking', 'Other'];

/** D11 · Cancel (with a reason, kept in the history) or mark a no-show (after the start). Both queue offline. */
export function CancelDialog({ a, kind, noShows, onClose }: { a: Appointment; kind: 'cancel' | 'noshow'; noShows: number | null; onClose: () => void }) {
  const move = useMove();
  const [reason, setReason] = useState(REASONS[0]!);
  const [other, setOther] = useState('');
  const [busy, setBusy] = useState(false);
  const go = async () => {
    setBusy(true);
    const ok = kind === 'cancel' ? await move(a, 'cancelled', reason === 'Other' ? other.trim() || 'Other' : reason) : await move(a, 'no_show');
    setBusy(false);
    if (ok) onClose();
  };
  const now = useNow();
  const ago = Math.max(0, Math.round((now - Date.parse(a.starts_at)) / 60_000));
  return kind === 'cancel' ? (
    <Modal title={`Cancel ${a.number}?`} onClose={onClose} width={480} footer={<><Button variant="secondary" onClick={onClose}>Keep it</Button><Button variant="danger" loading={busy} disabled={reason === 'Other' && !other.trim()} onClick={() => void go()}>Cancel appointment</Button></>}>
      <p className="m-0 text-[13px] text-ink-2">{`${a.customer.name} · ${a.service.name} · ${a.local.date} ${a.local.start} with ${a.provider.name}. The time becomes free at once.`}</p>
      <div className="mt-3"><Chips label="Reason" value={reason} onChange={setReason} options={REASONS.map((r) => ({ id: r, label: r }))} /></div>
      {reason === 'Other' ? <input autoFocus className={cx(input, 'mt-2')} aria-label="Reason" value={other} maxLength={200} onChange={(e) => setOther(e.target.value)} /> : null}
      <CancelFeeNote a={a} />
      <p className="mt-3 mb-0 text-[12px] text-ink-3">The client is told as WorkSuite is set up to. Offline, the cancellation waits in the outbox.</p>
    </Modal>
  ) : (
    <Modal title="Mark as a no-show?" onClose={onClose} width={480} footer={<><Button variant="secondary" onClick={onClose}>Call them first</Button><Button variant="danger" loading={busy} onClick={() => void go()}>Mark no-show</Button></>}>
      <p className="m-0 text-[13px] text-ink-2">{`${a.customer.name} · ${a.service.name} · ${a.local.start} with ${a.provider.name} — ${ago} minutes ago.`}</p>
      {noShows !== null ? <p className="mt-2 mb-0 text-[13px] font-semibold text-ink">{`This will be no-show number ${noShows + 1} for this client.`}</p> : null}
      <p className="mt-2 mb-0 text-[12px] text-ink-3">If they arrive after all, Undo no-show puts it back to Confirmed.</p>
    </Modal>
  );
}

type Method = 'cash' | 'card' | 'bank_transfer';

/**
 * D12 · Deposit: take it now (recorded as a payment in Billing, then said to be this appointment's deposit), or link
 * a payment already received. Covering what is asked confirms the booking and the client is told — the server's.
 */
export function DepositDialog({ a, settings, onClose }: { a: Appointment; settings: DeskSettings; onClose: () => void }) {
  const qc = useQueryClient();
  const due = a.deposit?.outstanding ?? 0;
  const currency = a.deposit?.currency ?? '';
  const [method, setMethod] = useState<Method>('cash');
  const [amount, setAmount] = useState(due ? String(due) : '');
  const [ref, setRef] = useState('');
  const [print, setPrint] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const cands = useQuery({ queryKey: ['appointments', 'deposits', a.id], queryFn: ({ signal }) => fetchDeposits(a.id, signal), enabled: a.can.collect });
  const done = (msg: string) => {
    toast('success', msg);
    void qc.invalidateQueries({ queryKey: K.all });
    onClose();
  };
  const take = async () => {
    const n = Number(amount);
    if (!(n > 0)) return setErr('Enter the amount received.');
    setBusy(true);
    setErr(null);
    try {
      const p = await recordPayment({ client_id: a.customer.id, org_id: a.org_id, amount: n, currency, method, bank_reference: ref.trim() || undefined, note: `Deposit for ${a.number}` });
      const l = await linkDeposit(a.id, p.data.payment.id);
      if (print) void printPage(depositHtml(a, n, currency, method === 'bank_transfer' ? 'Bank transfer' : method === 'card' ? 'Card' : 'Cash', ref.trim() || null, settings.paper), `Deposit ${a.number}`, settings.receiptPrinter).catch(() => undefined);
      done(l.message || (l.data.confirmed ? 'Deposit taken. The booking is confirmed.' : 'Deposit taken.'));
    } catch (e) {
      setErr(errText(e));
    } finally {
      setBusy(false);
    }
  };
  const link = async (paymentId: number) => {
    setBusy(true);
    setErr(null);
    try {
      const l = await linkDeposit(a.id, paymentId);
      done(l.message || 'Linked as the deposit.');
    } catch (e) {
      setErr(errText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title={`Deposit for ${a.number}`} onClose={onClose} width={560} footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} disabled={!a.can.collect} onClick={() => void take()}>{`Take ${money(Number(amount) || 0, currency)} by ${method === 'bank_transfer' ? 'bank transfer' : method}`}</Button></>}>
      <p className="m-0 text-[13px] text-ink-2">{`${a.customer.name} · ${a.service.name} · ${a.local.date} ${a.local.start}${a.status === 'pending' ? ' · Pending until covered' : ''}`}</p>
      <p className="mt-2 mb-0 text-[13px] text-ink">{`Asked ${money(a.deposit?.due ?? 0, currency)} · held ${money(a.deposit?.held ?? 0)} · due ${money(due)}`}</p>
      {!a.can.collect ? <div className="mt-2"><Refused>Taking money is recorded in Billing, and needs Billing’s payment permission.</Refused></div> : null}
      <div className="mt-3"><Chips label="Method" value={method} onChange={setMethod} options={[{ id: 'cash', label: 'Cash' }, { id: 'card', label: 'Card' }, { id: 'bank_transfer', label: 'Bank transfer' }]} /></div>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <label><span className={label}>Amount</span><input className={input} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} /></label>
        <label><span className={label}>Reference</span><input className={input} value={ref} maxLength={100} onChange={(e) => setRef(e.target.value)} /></label>
      </div>
      <label className="mt-2 flex items-center gap-2 text-[12.5px] text-ink"><Checkbox checked={print} onChange={(e) => setPrint(e.target.checked)} />Print a deposit receipt</label>
      {cands.data?.items.length ? (
        <div className="mt-4">
          <div className={label}>Or link money already received</div>
          {cands.data.items.map((p) => (
            <div key={p.id} className="flex items-center gap-2 border-b border-line/70 py-1.5 text-[12.5px]">
              <span className="min-w-0 flex-1 truncate">{`${p.reference ?? `#${p.id}`} · ${p.method.replace('_', ' ')} · ${p.paid_on}`}</span>
              <span className="tabular-nums">{`${money(p.free, p.currency)} free`}</span>
              <Button size="sm" variant="secondary" disabled={busy} onClick={() => void link(p.id)}>Link</Button>
            </div>
          ))}
          <p className="mt-1 mb-0 text-[11.5px] text-ink-3">Unallocated Billing payments of this client. One payment can be one appointment’s deposit.</p>
        </div>
      ) : null}
      <div className="mt-2"><Refused>{err}</Refused></div>
    </Modal>
  );
}
