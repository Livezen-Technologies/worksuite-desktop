import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Spinner } from '../../components/ui';
import { toast } from '../../core/toasts';
import { amount, clockAt, K, longDay, todayAt } from './api';
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
import { CountSheet, Failed, MoneyLine, Note, Page, Panel, Tag, TouchButton, useDesk, useNow, usePrintSettings } from './parts';
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
    <Page
      title="Close the day"
      sub={[longDay(date).replace(/ \d{4}$/, ''), desk.location.name, reg ? `register ${reg.code}${r?.session ? `, session #${r.session.id}` : ''}` : null, clockAt(new Date(clock).toISOString(), tz)].filter(Boolean).join(' · ')}
    >
      <div className="flex flex-col gap-3.5 xl:flex-row xl:items-start">
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
                <TouchButton className="min-h-10 text-[13px]" onClick={() => desk.go('register')}>
                  Register
                </TouchButton>
              }
            >
              Register {reg.code} is closed{r.last_close?.closed_at ? ` — last closed ${clockAt(r.last_close.closed_at, tz)} with ${amount(r.last_close.counted)} counted` : ''}.
            </Note>
          ) : (
            <CloseRegister state={r} date={date} onClosed={setClosed} />
          )}
        </div>
        <div className="w-full xl:w-[500px] xl:shrink-0">
          {day.isError ? (
            <Failed text={day.error instanceof Error ? day.error.message : 'The day’s figures could not be loaded.'} onRetry={() => void day.refetch()} />
          ) : !day.data ? (
            <Spinner label="Loading the day…" />
          ) : (
            <SalonDay day={day.data} />
          )}
        </div>
      </div>
    </Page>
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
    <Panel title={`Register ${closed.code} closed`} action={<Tag tone={v === 0 ? 'success' : 'warning'}>{v === 0 ? 'Counted exactly' : v < 0 ? 'Short' : 'Over'}</Tag>}>
      {closed.message ? <p className="mb-2 text-[13px] text-ink-2">{closed.message}</p> : null}
      <dl>
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
        <TouchButton icon="printer" onClick={() => void printIt(zReport(closed.result, closed.code, heading, desk.currency), 'The Z-report')}>
          Print the Z-report again
        </TouchButton>
      </div>
    </Panel>
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
      void qc.invalidateQueries({ queryKey: K.desks });
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
    <Panel title={`Close register ${reg.code} · count the drawer`} action={rules.blind ? <Tag tone="violet">Blind close</Tag> : undefined}>
      <p className="mb-1 text-[12.5px] text-ink-2">
        {rules.blind
          ? 'Point of Sale owns the drawer. The expected amount stays hidden until you close; a supervisor sees the difference.'
          : `${s.expected !== null ? `It should hold ${amount(s.expected, desk.currency)}. ` : ''}Any difference needs a reason.`}
      </p>
      {how === 'count' ? (
        <CountSheet values={state.denominations ?? []} counts={counts} onChange={setCounts} label="Closing count" />
      ) : (
        <input aria-label="Cash in the drawer" inputMode="decimal" value={figure} onChange={(e) => setFigure(moneyTyped(e.target.value))} className="h-12 w-full rounded-[12px] border border-line bg-surface px-3.5 text-right text-[18px] text-ink outline-none tabular-nums focus:border-primary" />
      )}
      <div className="mt-1 flex items-baseline justify-between border-t-2 border-ink pt-2">
        <span className="text-[20px] font-extrabold text-ink">Counted</span>
        <output className="text-[20px] font-extrabold text-ink tabular-nums">{amount(counted, desk.currency)}</output>
      </div>
      {!rules.count_to_close ? (
        <button type="button" onClick={() => setHow(how === 'count' ? 'figure' : 'count')} className="mt-1 text-[12.5px] font-semibold text-primary hover:underline">
          {how === 'count' ? 'Give it as one figure instead' : 'Count it note by note instead'}
        </button>
      ) : null}
      {!rules.blind ? (
        <label className="mt-2 flex flex-col gap-1">
          <span className="text-[12.5px] font-semibold text-ink-2">Why it is out, if it is</span>
          <input maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} className="h-11 rounded-[12px] border border-line bg-surface px-3.5 text-[14px] text-ink outline-none focus:border-primary" />
        </label>
      ) : null}
      {!desk.may('pos.register.close') ? <p className="mt-2 text-[12.5px] text-warning">Closing a register needs Point of Sale’s permission to close one.</p> : null}
      <div className="mt-3 flex flex-wrap gap-2.5">
        <TouchButton icon="banknote" onClick={() => setOut(true)}>
          Take cash out to safe
        </TouchButton>
        <TouchButton variant="primary" icon="lock" className="flex-1" loading={busy} disabled={!desk.may('pos.register.close')} onClick={() => void close()}>
          Close register &amp; print Z-report
        </TouchButton>
      </div>
      {out ? <MoveCash direction="out" code={reg.code} onClose={() => setOut(false)} /> : null}
    </Panel>
  );
}

function SalonDay({ day }: { day: DeskDay }) {
  const desk = useDesk();
  const heading = useHeading(day.date);
  const taken = day.figures.taken;
  const owed = day.unpaid.reduce((n, u) => n + u.owed, 0);
  const waiting = (desk.sync?.waiting ?? 0) + (desk.sync?.refused ?? 0);

  return (
    <Panel title="The salon day">
      {taken ? (
        <ul className="border-b border-line">
          {taken.by_method
            .filter((m) => m.new_money)
            .map((m) => (
              <li key={m.method} className="grid grid-cols-[1fr_auto_auto] items-baseline gap-4 border-t border-line py-2 text-[15px] first:border-t-0">
                <span className="text-ink">{m.label}</span>
                <span className="text-[13px] text-ink-2 tabular-nums">
                  {m.receipts} receipt{m.receipts === 1 ? '' : 's'}
                </span>
                <b className="w-28 text-right text-ink tabular-nums">{amount(m.amount)}</b>
              </li>
            ))}
          <li className="flex items-baseline justify-between border-t border-line py-2 text-[15px]">
            <span className="font-bold text-ink">Taken today</span>
            <b className="text-ink tabular-nums">{amount(taken.total, day.currency)}</b>
          </li>
        </ul>
      ) : (
        <p className="py-2 text-[13px] text-ink-2">Money figures need Billing’s permission to see them.</p>
      )}

      <dl className="mt-2 text-[14px]">
        <Stat label="Visits completed" value={String(day.completed)} />
        <Stat label="No-shows" value={String(day.no_shows)} />
        <Stat label="Invoices still owing" value={day.unpaid.length ? `${day.unpaid.length} · ${amount(owed, day.currency)}` : '0'} tone={day.unpaid.length ? 'warning' : undefined} />
        <Stat label="Commission accrued" value={desk.may('salon.commission.view') ? amount(day.commission, day.currency) : '—'} />
        <Stat label="Waiting to sync" value={String(waiting)} tone={waiting ? 'warning' : 'success'} />
      </dl>
      {taken && taken.not_new > 0 ? <p className="mt-1.5 text-[12px] text-ink-2">Advances, store credit and points used today ({amount(taken.not_new)}) are not new money and are not in the drawer.</p> : null}

      {day.not_checked_out.length > 0 ? (
        <div className="mt-3">
          <div className="mb-1 text-[12px] font-bold tracking-[.05em] text-warning uppercase">Not checked out</div>
          <ul>
            {day.not_checked_out.map((v) => (
              <li key={v.id} className="flex items-center gap-2 border-t border-line py-2 first:border-t-0">
                <span className="min-w-0 flex-1 truncate text-[13.5px] text-ink">
                  <b>{v.client}</b> · {v.number} · {v.status}
                </span>
                <TouchButton className="min-h-10 px-3 text-[13px]" onClick={() => desk.go('pay', { visit: v.id })}>
                  Take payment
                </TouchButton>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="mt-3 flex gap-2.5">
        <TouchButton icon="printer" className="flex-1" onClick={() => void printIt(daySummary(day, heading), 'The day’s summary')}>
          Print day summary
        </TouchButton>
      </div>
    </Panel>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: 'warning' | 'success' }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-[3px]">
      <dt className="text-ink-2">{label}</dt>
      <dd className={tone === 'warning' ? 'm-0 font-bold text-warning tabular-nums' : tone === 'success' ? 'm-0 font-bold text-success tabular-nums' : 'm-0 font-bold text-ink tabular-nums'}>{value}</dd>
    </div>
  );
}
