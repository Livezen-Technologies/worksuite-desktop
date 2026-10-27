import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useRef, useState } from 'react';
import type { PosReport } from '@shared/pos';
import { Checkbox } from '../../components/Checkbox';
import { Card, Spinner, cx } from '../../components/ui';
import { toast } from '../../core/toasts';
import { closeSession, fetchSession, openDrawer, openSession, PK, printReport, usePrintSettings, useSales, type PosSession } from './api';
import { openWithLines, useCarts } from './cart';
import CashMove from './CashMove';
import { drawerReport, sessionReportOf } from './desk';
import { useT, type PosKey } from './i18n';
import { BigAmount, Keypad } from './Keypad';
import { press } from './numpad';
import { BADGE } from './look';
import { Failed, Note, PosButton, PosDialog, timeOf, useTillContext } from './parts';
import { countBody, countTotal, formatMoney, parseAmount, variance } from './pricing';
import { closeBody, closeGuard, needsReason, salesSummary, xReport, zReport } from './shift';

/**
 * The drawer's shift, WorkSuite's own (`/api/pos/sessions`), on two panes each way. Opening a register: the float
 * counted note by note (or one figure), the keypad, the opening checks this till can make itself, a note, Open.
 * Closing it: the count — blind where the company says so, when the figure the drawer should hold never leaves
 * WorkSuite — note by note or one figure (not where the company counts note by note), the shift so far, cash in and
 * out, the X report, the other tenders to check against the card terminal, and Close — which waits until no sale is
 * open or held on this till. Then the Z report. Money in the drawer is counted once, in one place: these need
 * WorkSuite, and wait for it. The X and Z reports are WorkSuite's own where it gives them (Phase 2,
 * `capabilities.session_report`: the till's door's `session/report`, every tender and the drawer's figures, a blind
 * drawer's money hidden); otherwise the till's own from its record of the shift.
 */

/** The report shown on the shift screen, and printed as it is. */
function ReportDialog({ report, onClose }: { report: PosReport; onClose: () => void }) {
  const t = useT();
  return (
    <PosDialog label={report.title} onClose={onClose} width={560} className="gap-3 p-7">
      <h2 className="text-[20px] font-extrabold">{report.title}</h2>
      {report.subtitle ? <p className="text-[13px] text-ink-3">{report.subtitle}</p> : null}
      <div className="flex max-h-[60vh] flex-col gap-1 overflow-y-auto scroll-thin">
        {report.rows.map((r, i) =>
          'rule' in r ? (
            <hr key={i} className="my-1 border-pos-line" />
          ) : (
            <div key={i} className={cx('flex justify-between gap-3 text-[14px]', r.strong ? 'font-extrabold text-ink' : 'text-ink-2')}>
              <span>{r.label}</span>
              <span className="font-mono tabular-nums">{r.value}</span>
            </div>
          ),
        )}
      </div>
      <div className="flex gap-2.5">
        <PosButton className="h-touch-lg w-40" onClick={onClose}>
          {t('pos.close')}
        </PosButton>
        <PosButton tone="primary" className="h-touch-lg flex-1" onClick={() => void printReport(report).then((o) => toast(o.ok ? 'success' : 'warning', o.message))}>
          {t('pos.print')}
        </PosButton>
      </div>
    </PosDialog>
  );
}

/** WorkSuite's report of a drawer (the till's door), as rows; null where the server has none (an older one). */
async function serverReport(sessionId: number | undefined, currency: string, when: string): Promise<PosReport | null> {
  const r = await drawerReport(sessionId);
  const shaped = r ? sessionReportOf(r.raw, currency) : null;
  return shaped ? { title: shaped.title, subtitle: when, rows: shaped.rows } : null;
}
const toCounts = (c: Record<string, string>) => Object.entries(c).map(([v, n]) => ({ value: Number(v), count: Math.floor(Number(n) || 0) })).sort((a, b) => b.value - a.value);

export default function Shift() {
  const till = useTillContext();
  const [closed, setClosed] = useState<number | null>(null);
  if (closed) return <ZView sessionId={closed} onNew={() => setClosed(null)} />;
  if (!till.session) return <OpenShift />;
  return <OpenedShift session={till.session} onClosed={setClosed} />;
}

/** Counting the drawer: note by note, the keypad typing into the pile in focus, or one figure. */
function useCount(values: number[]) {
  const [counts, setCounts] = useState<Record<string, string>>({});
  const [typed, setTyped] = useState('');
  const [focus, setFocus] = useState(0);
  const refs = useRef<Array<HTMLInputElement | null>>([]);
  const counted = countTotal(toCounts(counts));
  const key = (k: string, byNotes: boolean) => {
    if (!byNotes) {
      setTyped((v) => press(v, k === 'next' ? '' : k));
      return;
    }
    if (k === 'next') {
      const n = Math.min(values.length - 1, focus + 1);
      setFocus(n);
      refs.current[n]?.focus();
      return;
    }
    const v = String(values[focus] ?? '');
    if (!v) return;
    setCounts((c) => ({ ...c, [v]: press(c[v] ?? '', k, { decimals: 0, digits: 5 }) }));
  };
  return { counts, setCounts, typed, setTyped, focus, setFocus, refs, counted, key };
}

function CountGrid({ values, c, label }: { values: number[]; c: ReturnType<typeof useCount>; label: string }) {
  return (
    <div role="group" aria-label={label} className="grid grid-cols-2 gap-2.5 max-lg:grid-cols-1">
      {values.map((v, i) => {
        const k = String(v);
        const n = Math.floor(Number(c.counts[k] ?? '') || 0);
        const on = c.focus === i;
        return (
          <label key={k} className={cx('flex h-touch-xl items-center gap-3 rounded-pos px-4', on ? 'bg-pos-on' : 'bg-pos-key')}>
            <span className="w-20 font-mono text-[18px] font-bold">{v.toLocaleString()}</span>
            <span className="text-[16px] text-ink-3">×</span>
            <input
              ref={(el) => {
                c.refs.current[i] = el;
              }}
              aria-label={`How many ${v.toLocaleString()}`}
              inputMode="numeric"
              value={c.counts[k] ?? ''}
              onFocus={() => c.setFocus(i)}
              onChange={(e) => c.setCounts({ ...c.counts, [k]: e.target.value.replace(/\D+/g, '').slice(0, 5) })}
              className={cx('h-touch w-[90px] rounded-[10px] bg-pos-panel text-center font-mono text-[18px] font-bold outline-none', on ? 'shadow-[inset_0_0_0_2px_var(--pos-on-ring)]' : 'shadow-[inset_0_0_0_1px_var(--pos-line)]')}
            />
            <span className="flex-1 text-right font-mono text-[16px] font-bold text-ink-2 tabular-nums">{n > 0 ? formatMoney(n * v) : '—'}</span>
          </label>
        );
      })}
    </div>
  );
}

function Tabs({ notes, onNotes, notesOk, figureOk }: { notes: boolean; onNotes: (v: boolean) => void; notesOk: boolean; figureOk: boolean }) {
  const t = useT();
  const tab = (v: boolean, label: PosKey, ok: boolean) => (
    <button type="button" role="tab" aria-selected={notes === v} disabled={!ok} onClick={() => onNotes(v)} className={cx('h-[42px] rounded-[9px] px-4 text-[14px] disabled:opacity-40', notes === v ? 'bg-pos-bar font-bold text-white' : 'font-semibold text-ink-2')}>
      {t(label)}
    </button>
  );
  return (
    <div role="tablist" aria-label={t('pos.countNotes')} className="flex shrink-0 gap-1 rounded-[12px] bg-pos-key p-1">
      {tab(true, 'pos.reg.byNotes', notesOk)}
      {tab(false, 'pos.reg.oneFigure', figureOk)}
    </div>
  );
}

const field = 'h-touch-md rounded-pos bg-pos-panel px-3.5 text-[14px] text-ink shadow-[inset_0_0_0_1px_var(--ws-slate-line)] outline-none focus:shadow-[inset_0_0_0_2px_var(--pos-on-ring)]';

function OpenShift() {
  const t = useT();
  const till = useTillContext();
  const qc = useQueryClient();
  const print = usePrintSettings();
  const here = till.status.till!.terminal.id;
  const free = till.registers.filter((r) => r.active && (!r.session || r.session.is_mine));
  const ours = free.filter((r) => r.terminal_id === here);
  const [registerId, setRegisterId] = useState<number | null>((ours[0] ?? free[0])?.id ?? null);
  const denominations = till.options?.denominations?.[till.currency] ?? [];
  const c = useCount(denominations);
  const [notes, setNotes] = useState(denominations.length > 0);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const byNotes = notes && denominations.length > 0;
  const float = byNotes ? c.counted : parseAmount(c.typed || '0');
  const can = till.company?.can.open ?? false;
  const register = free.find((r) => r.id === registerId);
  const cat = till.status.catalogue;

  async function open() {
    if (!registerId) return;
    setBusy(true);
    setError(null);
    try {
      const piles = byNotes ? countBody(toCounts(c.counts)) : [];
      const r = await openSession({ register_id: registerId, opening_float: Math.round(float * 100) / 100, ...(piles.length ? { denominations: piles } : {}), ...(note.trim() ? { note: note.trim() } : {}) });
      toast('success', r.message ?? 'Register open.');
      await qc.invalidateQueries({ queryKey: PK.registers });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The register could not be opened.');
    } finally {
      setBusy(false);
    }
  }

  const checks = [
    t('pos.reg.checkTill', { code: till.status.till!.terminal.code }),
    print.data?.receipt_printer ? t('pos.reg.checkPrinter', { name: print.data.receipt_printer }) : t('pos.reg.checkNoPrinter'),
    cat ? t('pos.reg.checkCatalogue', { at: timeOf(cat.fetched_at) }) : t('pos.reg.checkNoCatalogue'),
    till.offline ? t('pos.reg.checkOffline') : t('pos.reg.checkOnline'),
  ];

  return (
    <div className="flex min-h-full gap-6 px-10 py-7 max-lg:flex-col max-lg:px-5">
      <section className="flex min-w-0 flex-1 flex-col gap-3.5 rounded-pos-xl bg-pos-panel p-7 shadow-[0_1px_2px_rgba(15,27,61,.06)]">
        <div className="flex items-center gap-3">
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-[24px] font-extrabold">{register ? t('pos.reg.openTitle', { name: register.name }) : t('pos.openShift')}</h1>
            <p className="text-[14px] text-ink-3">{t('pos.reg.openHint')}</p>
          </div>
          <Tabs notes={byNotes} onNotes={setNotes} notesOk={denominations.length > 0} figureOk />
        </div>
        {till.offline ? <Note tone="warning">{t('pos.reg.openOffline')}</Note> : null}
        {!can ? <Note tone="warning">You may not open a register here (pos.register.open).</Note> : null}
        {free.length === 0 ? <Note>No register is free. Every register is open at another cashier’s till, or none is set up for this company (on the web).</Note> : null}
        {free.length > 1 ? (
          <div role="radiogroup" aria-label="Register" className="flex flex-wrap gap-2">
            {free.map((r) => (
              <button key={r.id} type="button" role="radio" aria-checked={registerId === r.id} onClick={() => setRegisterId(r.id)} className={cx('h-touch rounded-[12px] px-4 text-[14px] font-semibold', registerId === r.id ? 'bg-pos-bar text-white' : 'bg-pos-key text-ink')}>
                {r.name} · {r.code}
                {r.terminal_id === here ? ` (${t('pos.reg.thisTill')})` : ''}
              </button>
            ))}
          </div>
        ) : null}
        {free.length > 0 && ours.length === 0 ? <p className="text-[12px] text-ink-3">No register is bound to this till on the web; any free register can be opened here.</p> : null}
        {byNotes ? <CountGrid values={denominations} c={c} label={t('pos.countNotes')} /> : <BigAmount size="lg" value={c.typed} onChange={c.setTyped} aria-label={t('pos.float')} currency={till.currency} />}
        <div className="mt-auto flex items-center gap-4 rounded-pos-lg bg-pos-on px-5 py-4">
          <span className="flex-1 text-[16px] font-bold">{t('pos.reg.startsWith')}</span>
          <span className="font-mono text-[32px] font-bold tabular-nums">{formatMoney(Number.isFinite(float) ? float : 0, till.currency)}</span>
        </div>
      </section>
      <aside className="flex w-[380px] shrink-0 flex-col gap-3.5 max-lg:w-full">
        <Keypad size="lg" tone="panel" keys={['7', '8', '9', '4', '5', '6', '1', '2', '3', 'clear', '0', 'next']} labels={{ clear: t('pos.reg.clear'), next: t('pos.reg.next') }} onKey={(k) => c.key(k, byNotes)} />
        <div className="rounded-pos-lg bg-pos-panel p-4 text-[13px] text-ink-2 shadow-[inset_0_0_0_1px_var(--pos-line)]">
          <span className="font-semibold text-ink">{t('pos.reg.checks')}</span> {checks.join(' · ')}.
        </div>
        <input value={note} onChange={(e) => setNote(e.target.value.slice(0, 300))} placeholder={t('pos.reg.noteSupervisor')} aria-label={t('pos.reg.noteSupervisor')} className={field} />
        {error ? <Note tone="danger">{error}</Note> : null}
        <PosButton tone="primary" className="mt-auto h-touch-2xl shrink-0 rounded-pos-lg text-[19px] font-extrabold" disabled={busy || !registerId || !can || till.offline || !Number.isFinite(float) || float < 0} onClick={() => void open()}>
          {t('pos.openShift')}
        </PosButton>
      </aside>
    </div>
  );
}

function OpenedShift({ session, onClosed }: { session: PosSession; onClosed: (id: number) => void }) {
  const t = useT();
  const till = useTillContext();
  const qc = useQueryClient();
  const carts = useCarts();
  const detail = useQuery({ queryKey: PK.session(session.id), queryFn: ({ signal }) => fetchSession(session.id, signal), refetchInterval: 60_000 });
  const sales = useSales({ session_id: session.id });
  const sum = useMemo(() => salesSummary(sales.data ?? []), [sales.data]);
  const s = detail.data?.session ?? session;
  const movements = detail.data?.movements ?? [];
  const can = till.company?.can;
  const denominations = s.denominations ?? till.options?.denominations?.[s.currency] ?? [];
  // How this company closes a drawer (`options` rules): note by note, blind, and how far out needs no reason.
  const rules = till.company?.rules;
  const blind = !!s.blind || !!rules?.blind_close;
  const mustNotes = !!rules?.count_to_close && denominations.length > 0;
  const c = useCount(denominations);
  const [notes, setNotes] = useState(denominations.length > 0);
  const byNotes = mustNotes || (notes && denominations.length > 0);
  const [why, setWhy] = useState('');
  const [settled, setSettled] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cash, setCash] = useState(false);
  const [report, setReport] = useState<PosReport | null>(null);

  const counted = byNotes ? (c.counted > 0 ? c.counted : NaN) : c.typed ? parseAmount(c.typed) : NaN;
  const expected = blind ? null : (s.takings?.expected ?? null);
  const diff = variance(Number.isFinite(counted) ? counted : null, expected);
  const reasonNeeded = needsReason(diff, rules?.variance_tolerance, blind);
  const tolerance = rules?.variance_tolerance ?? 0;
  const others = Object.entries(sum.byTender).filter(([m, v]) => m !== 'cash' && v);
  const card = sum.byTender.card ?? 0;
  const open = openWithLines(carts);
  // Sales not yet in WorkSuite, or refused: the register waits for them, unless a manager closes it anyway (#296).
  const guard = closeGuard(till.status, can);
  const [anyway, setAnyway] = useState(false);
  const blocked = open.length + carts.held.length > 0 || (guard.blocked && !anyway);

  async function close() {
    const body = closeBody(byNotes ? toCounts(c.counts) : [], byNotes ? '' : c.typed, why, { count_to_close: mustNotes });
    if ('error' in body) {
      setError(body.error);
      return;
    }
    setBusy('close');
    setError(null);
    try {
      const r = await closeSession(session.id, body);
      toast(r.variance && Math.abs(r.variance) >= 0.01 ? 'warning' : 'success', r.message ?? 'Register closed.');
      void qc.invalidateQueries({ queryKey: PK.session(session.id) });
      void qc.invalidateQueries({ queryKey: PK.registers });
      onClosed(session.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The register could not be closed.');
    } finally {
      setBusy(null);
    }
  }

  /** The X report: WorkSuite's (the till's door) where it gives one, the till's own otherwise. */
  async function showX() {
    const when = new Date().toLocaleString();
    if (till.caps.session_report && !till.offline) {
      setBusy('x');
      try {
        const r = await serverReport(undefined, s.currency, when);
        if (r) {
          setReport(r);
          return;
        }
      } catch (e) {
        toast('warning', e instanceof Error ? e.message : 'WorkSuite’s X report could not be read; the till’s own is shown.');
      } finally {
        setBusy(null);
      }
    }
    setReport(xReport(s, sum, movements, when));
  }

  const today = new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'short' });
  const row = (label: string, value: string, strong = false) => (
    <div className={cx('flex justify-between gap-3 border-t border-pos-line/60 py-2 text-[14px]', strong && 'font-extrabold')}>
      <span className="min-w-0 truncate">{label}</span>
      <span className="font-mono font-bold tabular-nums">{value}</span>
    </div>
  );

  return (
    <div className="flex min-h-full gap-5 px-8 py-6 max-lg:flex-col max-lg:px-5">
      <section className="flex min-w-0 flex-1 flex-col gap-3 rounded-pos-xl bg-pos-panel p-[26px]">
        <div className="flex items-center gap-3">
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-[24px] font-extrabold">{t('pos.reg.closeTitle', { name: s.register ?? 'Register', day: today })}</h1>
            <p className="text-[14px] text-ink-3">{blind ? t('pos.reg.closeBlind') : t('pos.reg.closeHint')}</p>
          </div>
          {blind ? <span className={cx('shrink-0 rounded-full px-3.5 py-1.5 text-[13px] font-bold', BADGE.blind)}>{t('pos.reg.blindBadge')}</span> : null}
          <Tabs notes={byNotes} onNotes={setNotes} notesOk={denominations.length > 0} figureOk={!mustNotes} />
        </div>
        {mustNotes ? <p className="text-[12px] text-ink-3">{t('pos.countToClose')}</p> : null}
        {byNotes ? <CountGrid values={denominations} c={c} label={t('pos.countNotes')} /> : <BigAmount size="lg" value={c.typed} onChange={c.setTyped} aria-label={t('pos.counted')} currency={s.currency} />}
        <div className="flex-1" />
        <Keypad className="max-w-[420px] self-end" keys={['7', '8', '9', '4', '5', '6', '1', '2', '3', 'clear', '0', 'next']} labels={{ clear: t('pos.reg.clear'), next: t('pos.reg.next') }} onKey={(k) => c.key(k, byNotes)} />
        <div className="flex items-center gap-4 rounded-pos-lg bg-pos-on px-5 py-4">
          <span className="flex-1 text-[16px] font-bold">{t('pos.reg.youCounted')}</span>
          <span className="font-mono text-[32px] font-bold tabular-nums">{formatMoney(Number.isFinite(counted) ? counted : 0, s.currency)}</span>
        </div>
        {diff != null ? (
          <p className={cx('text-right text-[13px] font-semibold', Math.abs(diff) >= 0.01 ? 'text-warning' : 'text-success')}>
            {t('pos.reg.difference', { expected: formatMoney(expected, s.currency), n: formatMoney(diff) })}
          </p>
        ) : null}
      </section>

      <aside className="flex w-[460px] shrink-0 flex-col gap-3.5 max-lg:w-full">
        <div className="flex flex-col gap-1 rounded-pos-xl bg-pos-panel p-[22px]">
          <div className="flex items-center gap-2">
            <div className="min-w-0 flex-1">
              <div className="text-[16px] font-extrabold">{t('pos.thisShift')}</div>
              <div className="truncate text-[12px] text-ink-3">{[s.cashier, t('pos.reg.openedAt', { at: timeOf(s.opened_at) })].filter(Boolean).join(' · ')}</div>
            </div>
          </div>
          {row(t('pos.float'), formatMoney(s.opening_float))}
          {row(`${t('pos.sales')} (${sum.count})`, formatMoney(sum.total))}
          {row(t('pos.cashIn'), formatMoney(s.takings?.moved_in ?? 0))}
          {row(t('pos.cashOut'), formatMoney(s.takings?.moved_out ?? 0))}
          {expected != null ? row(t('pos.expected'), formatMoney(expected, s.currency), true) : null}
          {movements.slice(0, 3).map((m) => (
            <div key={m.id} className="flex justify-between gap-2 text-[12px] text-ink-3">
              <span className="truncate">
                {m.direction === 'in' ? '+' : '−'} {m.reason}
                {m.by ? ` · ${m.by}` : ''}
              </span>
              <span className="font-mono tabular-nums">{formatMoney(m.amount)}</span>
            </div>
          ))}
          <div className="mt-2 grid grid-cols-3 gap-2">
            <PosButton className="h-touch text-[13px]" disabled={busy === 'x'} onClick={() => void showX()}>
              {t('pos.xReport')}
            </PosButton>
            <PosButton className="h-touch text-[13px]" disabled={till.offline || !(can?.cash_in || can?.cash_out)} onClick={() => setCash(true)}>
              {t('pos.cashInOut')}
            </PosButton>
            <PosButton className="h-touch text-[13px]" onClick={() => void openDrawer().then((o) => toast(o.ok ? 'success' : 'warning', o.message))}>
              {t('pos.openDrawer')}
            </PosButton>
          </div>
          {detail.isError && !till.offline ? <Failed text="The drawer’s figures could not be loaded." onRetry={() => void detail.refetch()} /> : null}
        </div>

        {others.length ? (
          <div className="flex flex-col gap-2 rounded-pos-xl bg-pos-panel p-[22px]">
            <div className="text-[16px] font-extrabold">{t('pos.reg.otherTenders')}</div>
            <div className="text-[13px] text-ink-3">{t('pos.reg.otherHint')}</div>
            {others.map(([m, v]) => row(t(`pos.${m}` as PosKey), formatMoney(v)))}
            {card ? (
              <label className="mt-1 flex items-center gap-2.5 text-[14px] font-semibold">
                <Checkbox checked={settled} onChange={(e) => setSettled(e.target.checked)} />
                {t('pos.reg.cardSettled')}
              </label>
            ) : null}
          </div>
        ) : null}

        <div className="flex flex-col gap-2.5 rounded-pos-xl bg-pos-bar p-[22px] text-white">
          <div className="text-[13px] text-pos-bar-ink">{t('pos.reg.afterTitle')}</div>
          <div className="text-[15px]">
            {t('pos.reg.after')}
            {!blind && tolerance > 0 ? ` ${t('pos.tolerance', { n: formatMoney(tolerance, s.currency) })}` : ''}
          </div>
        </div>

        {blocked ? (
          <Note tone="warning" action={<PosButton className="h-touch px-3 text-[13px]" onClick={() => till.go('register')}>{t('pos.reg.toCounter')}</PosButton>}>
            {t('pos.reg.blocked', { open: open.length, held: carts.held.length })}
          </Note>
        ) : null}
        {guard.blocked ? (
          <Note tone={anyway ? 'warning' : 'danger'} action={till.openSync ? <PosButton className="h-touch px-3 text-[13px]" onClick={() => till.openSync?.()}>{t('pos.closeWaitsLink')}</PosButton> : null}>
            {t('pos.closeWaits', { n: guard.pending })}
            {guard.override ? (
              <label className="mt-2 flex items-center gap-2 text-[13px] font-semibold">
                <Checkbox checked={anyway} onChange={(e) => setAnyway(e.target.checked)} />
                {t('pos.closeAnyway')}
              </label>
            ) : null}
            {anyway ? <span className="mt-1 block text-[12px]">{t('pos.closeAnywayConfirm', { n: guard.pending })}</span> : null}
          </Note>
        ) : sum.waiting ? (
          <Note tone="warning">{t('pos.waiting', { n: sum.waiting })}: WorkSuite counts them in the drawer once they arrive.</Note>
        ) : null}
        <input
          value={why}
          onChange={(e) => setWhy(e.target.value.slice(0, 300))}
          placeholder={reasonNeeded ? `${t('pos.varianceReason')} *` : t('pos.reg.noteOptional')}
          aria-label={reasonNeeded ? t('pos.varianceReason') : t('pos.reg.noteOptional')}
          className={cx(field, reasonNeeded && !why.trim() && 'shadow-[inset_0_0_0_2px_var(--ws-danger)]')}
        />
        {reasonNeeded && !why.trim() ? <p className="-mt-2 text-[12px] text-danger">{t('pos.reasonNeeded')}</p> : null}
        {till.offline ? <Note tone="warning">{t('pos.reg.closeOffline')}</Note> : null}
        {error ? <Note tone="danger">{error}</Note> : null}
        <PosButton
          tone="primary"
          className="mt-auto h-touch-2xl shrink-0 rounded-pos-lg text-[19px] font-extrabold"
          disabled={busy === 'close' || blocked || till.offline || !can?.close || !Number.isFinite(counted) || (reasonNeeded && !why.trim()) || (card > 0 && !settled)}
          onClick={() => void close()}
        >
          {t('pos.closeShift')}
        </PosButton>
      </aside>
      {cash ? <CashMove session={session} onClose={() => setCash(false)} /> : null}
      {report ? <ReportDialog report={report} onClose={() => setReport(null)} /> : null}
    </div>
  );
}

/** After the close: WorkSuite's figures for the shift, and the Z report. */
function ZView({ sessionId, onNew }: { sessionId: number; onNew: () => void }) {
  const t = useT();
  const till = useTillContext();
  const q = useQuery({ queryKey: PK.session(sessionId), queryFn: ({ signal }) => fetchSession(sessionId, signal) });
  const sales = useSales({ session_id: sessionId });
  // WorkSuite's Z report where it gives one (`capabilities.session_report`); the till's own otherwise.
  const server = useQuery({
    queryKey: ['pos', 'z', sessionId],
    queryFn: () => serverReport(sessionId, q.data?.session.currency ?? till.currency, new Date().toLocaleString()),
    enabled: !!till.caps.session_report && !till.offline && !!q.data,
    retry: false,
  });
  if (q.isError) return <div className="p-6"><Failed text="The closed shift could not be read." onRetry={() => void q.refetch()} /></div>;
  if (!q.data) return <Spinner />;
  const s = q.data.session;
  const sum = salesSummary(sales.data ?? []);
  const report = server.data ?? zReport(s, sum);
  return (
    <div className="flex max-w-[640px] flex-col gap-4 p-6">
      <h1 className="text-[22px] font-extrabold text-ink">{t('pos.zReport')}</h1>
      <Card>
        <div className="flex flex-col gap-1 pt-3">
          {report.rows.map((r, i) => ('rule' in r ? <hr key={i} className="my-1 border-line" /> : <div key={i} className={`flex justify-between gap-3 text-[13px] ${r.strong ? 'font-extrabold text-ink' : 'text-ink-2'}`}><span>{r.label}</span><span className="tabular-nums">{r.value}</span></div>))}
        </div>
      </Card>
      <div className="flex gap-2">
        <PosButton className="h-touch-md px-5" onClick={() => void printReport(report).then((o) => toast(o.ok ? 'success' : 'warning', o.message))}>
          {t('pos.print')}
        </PosButton>
        <PosButton tone="primary" className="h-touch-md px-6" onClick={onNew}>
          {t('pos.openShift')}
        </PosButton>
      </div>
    </div>
  );
}
