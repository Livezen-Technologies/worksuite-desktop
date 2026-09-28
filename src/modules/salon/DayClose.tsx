import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Button, Card, Chip, Spinner, TextField } from '../../components/ui';
import { toast } from '../../core/toasts';
import { amount, clockAt, longDay, todayAt } from './api';
import {
  closeRegister,
  countLines,
  countTotal,
  daySummary,
  fetchDay,
  fetchRegister,
  METHOD_LABEL,
  MK,
  moneyTyped,
  printPage,
  tenderMap,
  zReport,
  type CloseResult,
  type DeskDay,
  type PageHeading,
  type RegisterState,
} from './money';
import { Choice, CountSheet, Failed, MoneyLine, Note, useDesk, useNow, usePrintSettings } from './parts';
import { MoveCash } from './Register';

/**
 * Closing the day (D11, WF-21, POS-07, PAY-14): the drawer counted and the
 * register closed — Point of Sale's — beside the salon's side of the day:
 * what was taken by tender, what was not new money, visits still open and
 * invoices still owing.
 *
 * The count is what the cashier typed; what the drawer should hold, and how
 * far out the count is, are Point of Sale's, worked out as it closes — under
 * a blind close the expected figure is not shown before then. The Z-report
 * printed afterwards carries only the figures the close answered with.
 */
export default function DayClose() {
  const desk = useDesk();
  const clock = useNow(60_000);
  const day = useQuery({ queryKey: MK.day(desk.desk.id), queryFn: ({ signal }) => fetchDay(desk.desk.id, signal) });
  const register = useQuery({ queryKey: MK.register(desk.desk.id), queryFn: ({ signal }) => fetchRegister(desk.desk.id, signal) });
  const tz = desk.location.timezone;
  const r = register.data;
  const reg = r?.register ?? null;
  /* Kept here, not in the count: once closed, the register reads as closed, and the close's figures must stay on screen. */
  const [closed, setClosed] = useState<Closed | null>(null);
  const date = day.data?.date ?? todayAt(tz, new Date(clock));

  return (
    <div className="flex flex-col gap-4 p-6">
      <div>
        <h1 className="text-[22px] font-extrabold text-ink">Close the day</h1>
        <p className="mt-0.5 text-[13px] text-ink-2">
          {[longDay(day.data?.date ?? todayAt(tz, new Date(clock))), desk.location.name, reg ? `register ${reg.code}${r?.session ? `, session #${r.session.id}` : ''}` : null, clockAt(new Date(clock).toISOString(), tz)].filter(Boolean).join(' · ')}
        </p>
      </div>

      <div className="flex flex-col gap-4 2xl:flex-row">
        <div className="min-w-0 flex-1">
          {closed ? (
            <ClosedRegister closed={closed} date={date} />
          ) : register.isError ? (
            <Failed text={register.error instanceof Error ? register.error.message : 'The register could not be loaded.'} onRetry={() => void register.refetch()} />
          ) : !r ? (
            <Spinner label="Loading the register…" />
          ) : !reg ? (
            <Note>{r.message ?? 'No POS register is paired with this desk: there is no drawer to count here.'}</Note>
          ) : !r.session ? (
            <Note
              action={
                <Button size="sm" onClick={() => desk.go('register')}>
                  Register
                </Button>
              }
            >
              Register {reg.code} is closed{r.last_close?.closed_at ? ` — last closed ${clockAt(r.last_close.closed_at, tz)} with ${amount(r.last_close.counted)} counted` : ''}.
            </Note>
          ) : (
            <CloseRegister state={r} date={date} onClosed={setClosed} />
          )}
        </div>
        <div className="w-full 2xl:w-[420px]">
          {day.isError ? (
            <Failed text={day.error instanceof Error ? day.error.message : 'The day’s figures could not be loaded.'} onRetry={() => void day.refetch()} />
          ) : !day.data ? (
            <Spinner label="Loading the day…" />
          ) : (
            <SalonDay day={day.data} />
          )}
        </div>
      </div>
    </div>
  );
}

function useHeading(date: string): PageHeading {
  const desk = useDesk();
  const print = usePrintSettings();
  return { company: desk.company, location: desk.location.name, date, paper: print.data?.paper ?? '80mm' };
}

async function printIt(html: string, what: string) {
  try {
    const o = await printPage(html);
    toast(o.ok ? 'success' : 'warning', o.ok ? `${what} printed.` : o.message);
  } catch (e) {
    toast('warning', `${what} could not be printed: ${e instanceof Error ? e.message : 'unknown error'}.`);
  }
}

interface Closed {
  result: CloseResult;
  message: string | null;
  code: string;
}

/** What the close answered, and the Z-report again. */
function ClosedRegister({ closed, date }: { closed: Closed; date: string }) {
  const desk = useDesk();
  const heading = useHeading(date);
  const z = closed.result.z;
  const v = closed.result.variance;
  return (
    <Card title={`Register ${closed.code} closed`}>
      {closed.message ? <p className="mb-2 text-[13px] text-ink-2">{closed.message}</p> : null}
      <dl className="flex flex-col gap-1">
        <MoneyLine label={`Sales · ${z.sales.count}`} value={z.sales.total} currency={desk.currency} />
        <MoneyLine label="Cash in" value={z.sales.cash_in} />
        <MoneyLine label="Change given" value={z.sales.cash_change} />
        <MoneyLine label="The drawer should have held" value={z.expected} currency={desk.currency} />
        <MoneyLine label={v === 0 ? 'Difference — none, counted exactly' : v < 0 ? 'Short by' : 'Over by'} value={Math.abs(v)} currency={desk.currency} strong />
        {Object.entries(tenderMap(z.tenders)).map(([m, val]) => (
          <MoneyLine key={m} label={METHOD_LABEL[m] ?? m} value={val} />
        ))}
      </dl>
      <div className="mt-3 flex justify-end">
        <Button icon="printer" onClick={() => void printIt(zReport(closed.result, closed.code, heading, desk.currency), 'The Z-report')}>
          Print the Z-report again
        </Button>
      </div>
    </Card>
  );
}

function CloseRegister({ state, date, onClosed }: { state: RegisterState; date: string; onClosed: (c: Closed) => void }) {
  const desk = useDesk();
  const qc = useQueryClient();
  const heading = useHeading(date);
  const reg = state.register!;
  const s = state.session!;
  const rules = state.rules ?? { count_to_close: true, blind: false };
  const [how, setHow] = useState<'count' | 'figure'>('count');
  const [counts, setCounts] = useState<Record<string, string>>({});
  const [figure, setFigure] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [out, setOut] = useState(false);
  const counted = how === 'count' ? countTotal(counts) : Number(figure || 0);

  async function close() {
    setBusy(true);
    try {
      const r = await closeRegister(desk.desk.id, how === 'count' ? { denominations: countLines(counts) } : { counted_cash: Number(figure || 0) }, reason.trim() || null);
      onClosed({ result: r.data, message: r.message, code: reg.code });
      toast('success', r.message ?? 'Register closed.');
      void qc.invalidateQueries({ queryKey: MK.register(desk.desk.id) });
      void qc.invalidateQueries({ queryKey: MK.day(desk.desk.id) });
      void printIt(zReport(r.data, reg.code, heading, desk.currency), 'The Z-report');
    } catch (e) {
      toast('error', e instanceof Error ? e.message : 'The register did not close.');
      /* Whether it closed is the server's to say: look again. */
      void qc.invalidateQueries({ queryKey: MK.register(desk.desk.id) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title={`Close register ${reg.code} · count the drawer`} action={rules.blind ? <Chip tone="indigo">Blind close</Chip> : undefined}>
      <div className="flex flex-col gap-3">
        <p className="text-[13px] text-ink-2">
          {rules.blind
            ? 'What the drawer should hold stays hidden until you close; a supervisor sees the difference.'
            : `${s.expected !== null ? `It should hold ${amount(s.expected, desk.currency)}. ` : ''}Any difference needs a reason.`}
        </p>
        {!rules.count_to_close ? (
          <Choice
            label="How to count"
            value={how}
            onChange={setHow}
            options={[
              { value: 'count', label: 'Note by note' },
              { value: 'figure', label: 'One figure' },
            ]}
          />
        ) : null}
        {how === 'count' ? (
          <CountSheet values={state.denominations ?? []} counts={counts} onChange={setCounts} label="Closing count" />
        ) : (
          <TextField label="Cash in the drawer" inputMode="decimal" value={figure} onChange={(e) => setFigure(moneyTyped(e.target.value))} />
        )}
        <div className="flex items-baseline justify-between rounded-[10px] bg-selection px-4 py-3">
          <span className="text-[14px] font-bold text-primary">Counted</span>
          <output className="text-[22px] font-extrabold text-primary tabular-nums">{amount(counted, desk.currency)}</output>
        </div>
        {!rules.blind ? <TextField label="Why it is out, if it is" hint="Needed when the count is not what the drawer should hold." maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} /> : null}
        <div className="flex flex-wrap items-center justify-end gap-2.5">
          {!desk.may('pos.register.close') ? <span className="text-[12.5px] text-warning">Closing a register needs Point of Sale’s permission to close one.</span> : null}
          <Button icon="arrow-up" onClick={() => setOut(true)}>
            Take cash out to the safe
          </Button>
          <Button variant="primary" icon="printer" loading={busy} disabled={!desk.may('pos.register.close')} onClick={() => void close()}>
            Close register &amp; print the Z-report
          </Button>
        </div>
      </div>
      {out ? <MoveCash direction="out" code={reg.code} onClose={() => setOut(false)} /> : null}
    </Card>
  );
}

function SalonDay({ day }: { day: DeskDay }) {
  const desk = useDesk();
  const heading = useHeading(day.date);
  const taken = day.figures.taken;

  return (
    <Card title="The salon day">
      <div className="flex flex-col gap-3">
        {taken ? (
          <dl className="flex flex-col gap-1">
            {taken.by_method
              .filter((m) => m.new_money)
              .map((m) => (
                <MoneyLine key={m.method} label={`${m.label} · ${m.receipts} receipt${m.receipts === 1 ? '' : 's'}`} value={m.amount} />
              ))}
            <MoneyLine label="Taken today" value={taken.total} currency={day.currency} strong />
          </dl>
        ) : (
          <p className="text-[13px] text-ink-2">Money figures need Billing’s permission to see them.</p>
        )}
        <div className="grid grid-cols-2 gap-2">
          <Small label="Visits completed" value={String(day.completed)} />
          <Small label="No-shows" value={String(day.no_shows)} />
          <Small label="Invoices still owing" value={String(day.unpaid.length)} />
          <Small label="Commission accrued" value={desk.may('salon.commission.view') ? amount(day.commission, day.currency) : '—'} />
        </div>
        {taken && taken.not_new > 0 ? <p className="text-[12.5px] text-ink-2">Advances, store credit and points used today ({amount(taken.not_new)}) are not new money and are not in the drawer.</p> : null}

        {day.not_checked_out.length > 0 ? (
          <div>
            <h3 className="mb-1 text-[10.5px] font-bold tracking-[.6px] text-warning uppercase">Not checked out</h3>
            <ul>
              {day.not_checked_out.map((v) => (
                <li key={v.id} className="flex items-center gap-2 border-t border-line py-2 first:border-t-0">
                  <span className="min-w-0 flex-1 truncate text-[13px] text-ink">
                    <b>{v.client}</b> · {v.number} · {v.status}
                  </span>
                  <Button size="sm" onClick={() => desk.go('pay', { visit: v.id })}>
                    Take payment
                  </Button>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {day.unpaid.length > 0 ? (
          <div>
            <h3 className="mb-1 text-[10.5px] font-bold tracking-[.6px] text-ink-3 uppercase">Still owing</h3>
            <ul className="text-[13px]">
              {day.unpaid.map((u) => (
                <li key={u.id} className="flex justify-between gap-2 border-t border-line py-1.5 first:border-t-0">
                  <span className="text-ink">
                    {u.number}
                    {u.invoice ? ` · ${u.invoice}` : ''}
                  </span>
                  <b className="text-ink tabular-nums">{amount(u.owed, day.currency)}</b>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        <div className="flex justify-end">
          <Button icon="printer" onClick={() => void printIt(daySummary(day, heading), 'The day’s summary')}>
            Print the day’s summary
          </Button>
        </div>
      </div>
    </Card>
  );
}

function Small({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[10px] bg-subtle px-3 py-2">
      <div className="text-[12px] text-ink-3">{label}</div>
      <div className="text-[17px] font-extrabold text-ink tabular-nums">{value}</div>
    </div>
  );
}
