import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { Button, Card, Spinner, TextField } from '../../components/ui';
import { toast } from '../../core/toasts';
import { cashMove, closeSession, fetchSession, openDrawer, openSession, PK, printReport, useSales, type PosSession } from './api';
import { useT } from './i18n';
import { Choice, CountSheet, Failed, Field, MoneyLine, Note, timeOf, useTillContext } from './parts';
import { countBody, countTotal, formatMoney, parseAmount, variance } from './pricing';
import { closeBody, salesSummary, xReport, zReport } from './shift';

/**
 * The drawer's shift, WorkSuite's own (`/api/pos/sessions`): opening a register with its float (typed, or counted
 * note by note), cash put in and taken out with the reason, the X report while it is open, and closing it on a count —
 * blind where the company says so, when the figure the drawer should hold never leaves WorkSuite — and the Z report.
 * Money in the drawer is counted once, in one place: these need WorkSuite, and wait for it.
 */
const toCounts = (c: Record<string, string>) => Object.entries(c).map(([v, n]) => ({ value: Number(v), count: Math.floor(Number(n) || 0) }));

export default function Shift() {
  const till = useTillContext();
  const [closed, setClosed] = useState<number | null>(null);
  if (closed) return <ZView sessionId={closed} onNew={() => setClosed(null)} />;
  if (!till.session) return <OpenShift />;
  return <OpenedShift session={till.session} onClosed={setClosed} />;
}

function OpenShift() {
  const t = useT();
  const till = useTillContext();
  const qc = useQueryClient();
  const here = till.status.till!.terminal.id;
  const free = till.registers.filter((r) => r.active && (!r.session || r.session.is_mine));
  const ours = free.filter((r) => r.terminal_id === here);
  const [registerId, setRegisterId] = useState<number | null>((ours[0] ?? free[0])?.id ?? null);
  const [counts, setCounts] = useState<Record<string, string>>({});
  const [typed, setTyped] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const denominations = till.options?.denominations?.[till.currency] ?? [];
  const counted = countTotal(toCounts(counts));
  const float = counted > 0 ? counted : parseAmount(typed || '0');
  const can = till.company?.can.open ?? false;

  async function open() {
    if (!registerId) return;
    setBusy(true);
    setError(null);
    try {
      const piles = countBody(toCounts(counts));
      const r = await openSession({ register_id: registerId, opening_float: float, ...(piles.length ? { denominations: piles } : {}), ...(note.trim() ? { note: note.trim() } : {}) });
      toast('success', r.message ?? 'Register open.');
      await qc.invalidateQueries({ queryKey: PK.registers });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The register could not be opened.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex max-w-[820px] flex-col gap-4 p-6">
      <h1 className="text-[22px] font-extrabold text-ink">{t('pos.openShift')}</h1>
      {till.offline ? <Note tone="warning">Opening the register needs WorkSuite, so the drawer’s money is counted once, in one place.</Note> : null}
      {!can ? <Note tone="warning">You may not open a register here (pos.register.open).</Note> : null}
      {free.length === 0 ? <Note>No register is free. Every register is open at another cashier’s till, or none is set up for this company (on the web).</Note> : null}
      {free.length > 0 ? (
        <Card title="Register">
          <div className="flex flex-col gap-3">
            <Choice label="Register" value={String(registerId ?? '')} onChange={(v) => setRegisterId(Number(v))} options={free.map((r) => ({ value: String(r.id), label: `${r.name} · ${r.code}${r.terminal_id === here ? ' (this till)' : ''}` }))} />
            {ours.length === 0 ? <p className="text-[12px] text-ink-3">No register is bound to this till on the web; any free register can be opened here.</p> : null}
          </div>
        </Card>
      ) : null}
      <Card title={t('pos.float')}>
        <div className="flex flex-col gap-3">
          {denominations.length ? (
            <Field label={t('pos.countNotes')}>
              <CountSheet values={denominations} counts={counts} onChange={setCounts} label={t('pos.countNotes')} />
            </Field>
          ) : null}
          {counted > 0 ? (
            <MoneyLine label={t('pos.float')} value={counted} currency={till.currency} strong />
          ) : (
            <TextField label={t('pos.float')} inputMode="decimal" value={typed} onChange={(e) => setTyped(e.target.value.replace(/[^\d.,]/g, ''))} placeholder="0.00" />
          )}
          <TextField label="Note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} />
        </div>
      </Card>
      {error ? <Note tone="danger">{error}</Note> : null}
      <div>
        <Button variant="primary" size="lg" icon="unlock" loading={busy} disabled={!registerId || !can || till.offline || !Number.isFinite(float) || float < 0} onClick={() => void open()}>
          {t('pos.openShift')}
        </Button>
      </div>
    </div>
  );
}

function OpenedShift({ session, onClosed }: { session: PosSession; onClosed: (id: number) => void }) {
  const t = useT();
  const till = useTillContext();
  const qc = useQueryClient();
  const detail = useQuery({ queryKey: PK.session(session.id), queryFn: ({ signal }) => fetchSession(session.id, signal), refetchInterval: 60_000 });
  const sales = useSales({ session_id: session.id });
  const sum = useMemo(() => salesSummary(sales.data ?? []), [sales.data]);
  const s = detail.data?.session ?? session;
  const movements = detail.data?.movements ?? [];
  const can = till.company?.can;

  const [direction, setDirection] = useState<'in' | 'out'>(can?.cash_in ? 'in' : 'out');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [reference, setReference] = useState('');
  const [counts, setCounts] = useState<Record<string, string>>({});
  const [typed, setTyped] = useState('');
  const [why, setWhy] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const denominations = s.denominations ?? till.options?.denominations?.[s.currency] ?? [];
  const counted = countTotal(toCounts(counts)) || (typed ? parseAmount(typed) : NaN);
  const expected = s.blind ? null : (s.takings?.expected ?? null);
  const diff = variance(Number.isFinite(counted) ? counted : null, expected);
  const reasons = till.options?.cash_reasons?.[direction] ?? [];

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: PK.session(session.id) });
    void qc.invalidateQueries({ queryKey: PK.registers });
  };

  async function move() {
    const v = parseAmount(amount);
    if (!Number.isFinite(v) || v <= 0 || !reason.trim()) return;
    setBusy('cash');
    try {
      const m = await cashMove(session.id, { direction, amount: v, reason: reason.trim(), ...(reference.trim() ? { reference: reference.trim() } : {}) });
      toast('success', m ?? 'Recorded.');
      setAmount('');
      setReference('');
      refresh();
      void openDrawer();
    } catch (e) {
      toast('error', e instanceof Error ? e.message : 'The money could not be recorded.');
    } finally {
      setBusy(null);
    }
  }

  async function close() {
    const body = closeBody(toCounts(counts), typed, why);
    if ('error' in body) {
      setError(body.error);
      return;
    }
    setBusy('close');
    setError(null);
    try {
      const r = await closeSession(session.id, body);
      toast(r.variance && Math.abs(r.variance) >= 0.01 ? 'warning' : 'success', r.message ?? 'Register closed.');
      refresh();
      onClosed(session.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The register could not be closed.');
    } finally {
      setBusy(null);
    }
  }

  async function printX() {
    const o = await printReport(xReport(s, sum, movements, new Date().toLocaleString()));
    toast(o.ok ? 'success' : 'warning', o.message);
  }

  return (
    <div className="flex max-w-[980px] flex-col gap-4 p-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-[22px] font-extrabold text-ink">
            {s.register ?? 'Register'} <span className="text-ink-3">· {s.register_code}</span>
          </h1>
          <p className="text-[13px] text-ink-2">
            {s.cashier} · opened {timeOf(s.opened_at)}
          </p>
        </div>
        <div className="flex gap-2">
          <Button icon="printer" onClick={() => void printX()}>
            {t('pos.xReport')}
          </Button>
          <Button icon="banknote" onClick={() => void openDrawer().then((o) => toast(o.ok ? 'success' : 'warning', o.message))}>
            {t('pos.openDrawer')}
          </Button>
        </div>
      </div>
      {detail.isError && !till.offline ? <Failed text="The drawer’s figures could not be loaded." onRetry={() => void detail.refetch()} /> : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title={t('pos.xReport')}>
          <div className="flex flex-col gap-1">
            <MoneyLine label={t('pos.float')} value={s.opening_float} />
            <MoneyLine label={`${t('pos.sales')} (${sum.count})`} value={sum.total} />
            {Object.entries(sum.byTender).map(([m, v]) => (
              <MoneyLine key={m} label={<span className="pl-3">{m}</span>} value={v} />
            ))}
            <MoneyLine label={t('pos.cashIn')} value={s.takings?.moved_in ?? 0} />
            <MoneyLine label={t('pos.cashOut')} value={s.takings?.moved_out ?? 0} />
            {expected != null ? <MoneyLine label={t('pos.expected')} value={expected} currency={s.currency} strong /> : null}
            {s.blind ? <p className="mt-1 text-[12px] text-ink-3">{t('pos.blind')}</p> : null}
            {sum.waiting ? <p className="mt-1 text-[12px] text-warning">{t('pos.waiting', { n: sum.waiting })}</p> : null}
          </div>
        </Card>

        <Card title={`${t('pos.cashIn')} / ${t('pos.cashOut')}`}>
          <div className="flex flex-col gap-3">
            <Choice
              label="Direction"
              value={direction}
              onChange={setDirection}
              options={[
                { value: 'in', label: t('pos.cashIn'), disabled: !can?.cash_in },
                { value: 'out', label: t('pos.cashOut'), disabled: !can?.cash_out },
              ]}
            />
            <TextField label={t('pos.amount')} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d.,]/g, ''))} />
            <Field label={t('pos.reason')}>
              <div className="flex flex-wrap gap-1.5">
                {reasons.map((r) => (
                  <button key={r} type="button" onClick={() => setReason(r)} className="h-7 rounded-full border border-line bg-surface px-3 text-[12px] font-semibold text-ink hover:bg-subtle">
                    {r}
                  </button>
                ))}
              </div>
              <input value={reason} onChange={(e) => setReason(e.target.value.slice(0, 120))} aria-label={t('pos.reason')} className="h-9 rounded-[8px] border border-line bg-surface px-3 text-[13px] outline-none focus:border-primary" />
            </Field>
            <TextField label={t('pos.reference')} value={reference} onChange={(e) => setReference(e.target.value.slice(0, 120))} />
            <div>
              <Button variant="primary" loading={busy === 'cash'} disabled={till.offline || !(direction === 'in' ? can?.cash_in : can?.cash_out) || !(parseAmount(amount) > 0) || !reason.trim()} onClick={() => void move()}>
                Record
              </Button>
            </div>
            {movements.length ? (
              <ul className="flex flex-col divide-y divide-line text-[12.5px]">
                {movements.slice(0, 8).map((m) => (
                  <li key={m.id} className="flex justify-between gap-2 py-1.5">
                    <span className="truncate text-ink-2">
                      {m.direction === 'in' ? '+' : '−'} {m.reason}
                      {m.by ? ` · ${m.by}` : ''}
                    </span>
                    <span className="font-semibold tabular-nums">{formatMoney(m.amount)}</span>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        </Card>
      </div>

      <Card title={t('pos.closeShift')}>
        <div className="flex flex-col gap-3">
          {s.blind ? <Note tone="indigo">{t('pos.blind')}</Note> : null}
          {denominations.length ? <CountSheet values={denominations} counts={counts} onChange={setCounts} label={t('pos.countNotes')} /> : null}
          {countTotal(toCounts(counts)) > 0 ? (
            <MoneyLine label={t('pos.counted')} value={countTotal(toCounts(counts))} currency={s.currency} strong />
          ) : (
            <TextField label={t('pos.counted')} inputMode="decimal" value={typed} onChange={(e) => setTyped(e.target.value.replace(/[^\d.,]/g, ''))} hint="Or count the notes and coins above: the company may ask for the count." />
          )}
          {diff != null ? <MoneyLine label={t('pos.variance')} value={diff} currency={s.currency} strong /> : null}
          <TextField label={t('pos.varianceReason')} value={why} onChange={(e) => setWhy(e.target.value.slice(0, 300))} />
          {sum.waiting ? <Note tone="warning">{t('pos.waiting', { n: sum.waiting })}: WorkSuite counts them in the drawer once they arrive.</Note> : null}
          {error ? <Note tone="danger">{error}</Note> : null}
          <div>
            <Button variant="danger" size="lg" icon="lock" loading={busy === 'close'} disabled={till.offline || !can?.close || !Number.isFinite(counted)} onClick={() => void close()}>
              {t('pos.closeShift')}
            </Button>
          </div>
        </div>
      </Card>
    </div>
  );
}

/** After the close: WorkSuite's figures for the shift, and the Z report. */
function ZView({ sessionId, onNew }: { sessionId: number; onNew: () => void }) {
  const t = useT();
  const q = useQuery({ queryKey: PK.session(sessionId), queryFn: ({ signal }) => fetchSession(sessionId, signal) });
  const sales = useSales({ session_id: sessionId });
  if (q.isError) return <div className="p-6"><Failed text="The closed shift could not be read." onRetry={() => void q.refetch()} /></div>;
  if (!q.data) return <Spinner />;
  const s = q.data.session;
  const sum = salesSummary(sales.data ?? []);
  const report = zReport(s, sum);
  return (
    <div className="flex max-w-[640px] flex-col gap-4 p-6">
      <h1 className="text-[22px] font-extrabold text-ink">{t('pos.zReport')}</h1>
      <Card>
        <div className="flex flex-col gap-1 pt-3">
          {report.rows.map((r, i) => ('rule' in r ? <hr key={i} className="my-1 border-line" /> : <div key={i} className={`flex justify-between gap-3 text-[13px] ${r.strong ? 'font-extrabold text-ink' : 'text-ink-2'}`}><span>{r.label}</span><span className="tabular-nums">{r.value}</span></div>))}
        </div>
      </Card>
      <div className="flex gap-2">
        <Button icon="printer" onClick={() => void printReport(report).then((o) => toast(o.ok ? 'success' : 'warning', o.message))}>
          {t('pos.print')}
        </Button>
        <Button variant="primary" onClick={onNew}>
          {t('pos.openShift')}
        </Button>
      </div>
    </div>
  );
}
