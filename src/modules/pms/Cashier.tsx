import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Button, ErrorNote, Spinner, cx } from '../../components/ui';
import { toast } from '../../core/toasts';
import { Ask, Field, input, Section } from '../garage/parts';
import { PageHead } from '../hr/parts';
import { day, errorText, isZero, K, money, pGet, pPost, stamp, type Shift } from './api';
import { device } from './devices';
import { deskName, keepDeskName } from './money';
import { Facts, NoAccess, Refusal, usePms } from './parts';
import { printPage, shiftReportHtml } from './print';
import { clickOnKey } from '../../components/press';

/** A shift's figures, as the server counted them. */
export function ShiftFacts({ s }: { s: Shift }) {
  const cur = s.currency;
  return (
    <>
      <Facts
        rows={[
          ['Cashier', s.cashier],
          ['Terminal', s.terminal],
          ['Business date', day(s.business_date, true)],
          ['Opened', stamp(s.opened_at)],
          ['Opening cash', money(s.opening_cash, cur)],
          ['Cash taken', money(s.totals?.cash_in ?? null, cur)],
          ['Cash paid out', money(s.totals?.cash_out ?? null, cur)],
          ['Expected in the drawer', money(s.expected_cash, cur)],
          ...(s.counted_cash !== null ? ([['Counted', money(s.counted_cash, cur)], ['Variance', money(s.variance, cur)]] as Array<[string, string]>) : []),
          ...(s.variance_reason ? ([['Why', s.variance_reason]] as Array<[string, string]>) : []),
          ...(s.approved_by ? ([['Approved by', s.approved_by]] as Array<[string, string]>) : []),
        ]}
      />
      {s.totals?.methods.length ? (
        <table className="mt-3 w-full text-left text-[12.5px]">
          <thead className="text-[10.5px] font-bold tracking-[.4px] text-ink-3 uppercase">
            <tr>
              <th className="py-1">Method</th>
              <th className="py-1 text-right">Count</th>
              <th className="py-1 text-right">In</th>
              <th className="py-1 text-right">Out</th>
            </tr>
          </thead>
          <tbody>
            {s.totals.methods.map((m) => (
              <tr key={m.method} className="border-t border-line">
                <td className="py-1">{m.label}</td>
                <td className="py-1 text-right tabular-nums">{m.count}</td>
                <td className="py-1 text-right tabular-nums">{money(m.in, cur)}</td>
                <td className="py-1 text-right tabular-nums">{money(m.out, cur)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </>
  );
}

/**
 * The cashier (§10.7, PMS-CSH-001/002): open a shift at this terminal with
 * the opening cash, see what it took by method, close it by counting the
 * drawer — within the property's allowance it reconciles itself, beyond it
 * someone else approves the variance with a reason. Cash is taken only in an
 * open shift. The cash drawer opens through the device agent when there is
 * one.
 */
export default function Cashier() {
  const pms = usePms();
  const qc = useQueryClient();
  const pid = pms.property.id;
  const q = useQuery({ queryKey: K.cashier(pid), queryFn: ({ signal }) => pGet<{ items: Shift[]; mine: Shift | null }>(`/properties/${pid}/cashier-sessions`, undefined, signal) });
  const [terminal, setTerminal] = useState(() => deskName(null));
  const [opening, setOpening] = useState('');
  const [counted, setCounted] = useState('');
  const [reason, setReason] = useState('');
  const [approve, setApprove] = useState<Shift | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [told, setTold] = useState<string | null>(null);
  const drawer = device('cash_drawer');

  if (!pms.mayAny('pms.cashier.open', 'pms.cashier.close', 'pms.payment.view')) return <NoAccess what="The cashier needs “Open a cashier shift”, “Close a cashier shift” or “See payments”." />;
  if (q.isLoading) return <Spinner />;
  if (q.error || !q.data) return <div className="p-6"><ErrorNote error={q.error ?? new Error('The shifts could not be loaded.')} onRetry={() => void q.refetch()} /></div>;
  const mine = q.data.mine;
  const reload = () => void qc.invalidateQueries({ queryKey: K.cashier(pid) });

  const run = async (fn: () => Promise<{ message: string; data: unknown }>, fallback: string) => {
    setBusy(true);
    setError(null);
    try {
      const r = await fn();
      toast('success', r.message);
      reload();
      return r;
    } catch (e) {
      setError(errorText(e, fallback));
      return null;
    } finally {
      setBusy(false);
    }
  };
  const open = () => {
    keepDeskName(terminal);
    void run(() => pPost(`/properties/${pid}/cashier-sessions`, { terminal: terminal.trim(), opening_cash: opening.trim() || '0' }), 'The shift was not opened.');
  };
  const close = async () => {
    if (!mine) return;
    const r = await run(() => pPost<{ shift_status: string; variance: string; needs_approval?: boolean }>(`/cashier-sessions/${mine.id}/close`, { counted_cash: counted.trim(), ...(reason.trim() ? { reason: reason.trim() } : {}) }), 'The shift was not closed.');
    const d = r?.data as { shift_status: string; variance: string; needs_approval?: boolean } | undefined;
    if (d) setTold(d.needs_approval ? `Closed with a variance of ${money(d.variance, mine.currency)}: someone else approves it.` : `Closed and reconciled${isZero(d.variance) ? '' : ` (variance ${money(d.variance, mine.currency)})`}.`);
    setCounted('');
    setReason('');
  };
  const print = (s: Shift) => void printPage({ title: `Cashier shift ${s.cashier ?? ''} ${s.business_date}`, html: shiftReportHtml(s, pms.property.name), kind: 'report' }).catch((e) => toast('error', errorText(e)));
  const waiting = q.data.items.filter((s) => s.status === 'closed');

  return (
    <div className="flex flex-col gap-4 px-6 py-5">
      <PageHead title="Cashier" sub={`${pms.property.name} · business date ${day(pms.businessDate, true)}`}>
        {drawer.available() ? (
          <Button icon="wallet" onClick={() => void drawer.open('count').then((o) => toast(o.ok ? 'success' : 'error', o.message))}>
            Open the drawer
          </Button>
        ) : null}
      </PageHead>
      {told ? <div className="rounded-[10px] bg-success-bg px-3 py-2 text-[12.5px] text-success">{told}</div> : null}
      {error ? <Refusal text={error} /> : null}

      <Section title="Your shift">
        {!mine ? (
          pms.may('pms.cashier.open') ? (
            <form
              className="grid gap-3 sm:grid-cols-3"
              onSubmit={(e) => {
                e.preventDefault();
                open();
              }}
            >
              <Field label="Terminal" hint="This desk’s name on every payment it takes.">
                <input aria-label="Terminal" className={input} value={terminal} onChange={(e) => setTerminal(e.target.value)} />
              </Field>
              <Field label="Opening cash">
                <input aria-label="Opening cash" className={input} inputMode="decimal" placeholder="0.00" value={opening} onChange={(e) => setOpening(e.target.value)} />
              </Field>
              <div className="flex items-end">
                <Button variant="primary" loading={busy} disabled={!terminal.trim() || !pms.online || (!!opening && !/^\d+(\.\d{1,2})?$/.test(opening))} onClick={open}>
                  Open shift
                </Button>
              </div>
              <button type="submit" hidden />
            </form>
          ) : (
            <p className="m-0 text-[13px] text-ink-3">You have no open shift.</p>
          )
        ) : (
          <div className="grid gap-4 lg:grid-cols-2">
            <div>
              <ShiftFacts s={mine} />
              <div className="mt-3 flex gap-2">
                <Button size="sm" icon="printer" onClick={() => print(mine)}>
                  Print
                </Button>
                <Button size="sm" onClick={() => pms.open({ kind: 'shift', id: mine.id })}>
                  Its payments
                </Button>
              </div>
            </div>
            {pms.may('pms.cashier.close') ? (
              <form
                className="flex flex-col gap-3"
                onSubmit={(e) => {
                  e.preventDefault();
                  void close();
                }}
              >
                <Field label="Cash counted in the drawer *">
                  <input aria-label="Cash counted" className={input} inputMode="decimal" value={counted} onChange={(e) => setCounted(e.target.value)} />
                </Field>
                <Field label="If it differs, why">
                  <input aria-label="Why it differs" className={input} value={reason} onChange={(e) => setReason(e.target.value)} />
                </Field>
                <Button variant="primary" className="self-start" loading={busy} disabled={!/^\d+(\.\d{1,2})?$/.test(counted.trim()) || !pms.online} onClick={() => void close()}>
                  Close shift
                </Button>
                <button type="submit" hidden />
              </form>
            ) : null}
          </div>
        )}
      </Section>

      {waiting.length && pms.may('pms.cashier.close') ? (
        <Section title="Waiting for approval">
          <ul className="m-0 flex list-none flex-col gap-1.5 p-0 text-[13px]">
            {waiting.map((s) => (
              <li key={s.id} className="flex items-center gap-2">
                <span className="min-w-0 flex-1">
                  {s.cashier} · {s.terminal} · {day(s.business_date)} · variance <b>{money(s.variance, s.currency)}</b>
                  {s.variance_reason ? ` — ${s.variance_reason}` : ''}
                </span>
                <Button size="sm" disabled={!pms.online} onClick={() => setApprove(s)}>
                  Approve
                </Button>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      <Section title="Shifts">
        {q.data.items.length === 0 ? (
          <p className="m-0 text-[13px] text-ink-3">No shifts yet.</p>
        ) : (
          <table className="w-full text-left text-[12.5px]">
            <thead className="text-[10.5px] font-bold tracking-[.4px] text-ink-3 uppercase">
              <tr>
                <th className="py-1">Date</th>
                <th className="py-1">Cashier</th>
                <th className="py-1">Terminal</th>
                <th className="py-1">Status</th>
                <th className="py-1 text-right">Variance</th>
              </tr>
            </thead>
            <tbody>
              {q.data.items.slice(0, 60).map((s) => (
                <tr tabIndex={0} onKeyDown={clickOnKey} key={s.id} className="cursor-pointer border-t border-line hover:bg-subtle" onClick={() => pms.open({ kind: 'shift', id: s.id })}>
                  <td className="py-1.5">{day(s.business_date)}</td>
                  <td className="py-1.5">{s.cashier}</td>
                  <td className="py-1.5">{s.terminal}</td>
                  <td className={cx('py-1.5', s.status === 'closed' && 'font-semibold text-warning')}>{s.status_label}</td>
                  <td className="py-1.5 text-right tabular-nums">{s.variance !== null ? money(s.variance, s.currency) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>
      {approve ? (
        <Ask
          title={`Approve ${approve.cashier}’s variance of ${money(approve.variance, approve.currency)}`}
          fields={[{ name: 'reason', label: 'Reason', required: true }]}
          confirm="Approve"
          busy={busy}
          onClose={() => setApprove(null)}
          onSubmit={(v) => void run(() => pPost(`/cashier-sessions/${approve.id}/reconcile`, v), 'The shift was not reconciled.').then(() => setApprove(null))}
        />
      ) : null}
    </div>
  );
}
