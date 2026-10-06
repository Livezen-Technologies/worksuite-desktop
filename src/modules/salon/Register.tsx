import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Icon } from '../../components/Icon';
import { Spinner, cx } from '../../components/ui';
import { toast } from '../../core/toasts';
import { amount, answered, clockAt, dayMonth, K, longDay, todayAt } from './api';
import { countLines, countTotal, fetchRegister, METHOD_LABEL, MK, moneyTyped, moveCash, openRegister, tenderMap, type RegisterState } from './money';
import { CountSheet, DeskDialog, Failed, Figure, greetingFor, Note, Page, Panel, TouchButton, useDesk, useNow } from './parts';

/**
 * The register this desk takes money into (D13, POS-01, POS-02, POS-07).
 *
 * Point of Sale owns the drawer: its session, the float, the cash put in and
 * taken out, and the close. Here the session is opened on a counted float,
 * cash is moved in or out with a reason, and the day is closed. Until the
 * register is open the desk still books, checks in and serves — only taking
 * payment waits.
 */
export default function Register() {
  const desk = useDesk();
  const q = useQuery({ queryKey: MK.register(desk.desk.id), queryFn: ({ signal }) => fetchRegister(desk.desk.id, signal) });

  if (q.isError)
    return (
      <div className="px-5 py-4">
        <Failed text={q.error instanceof Error ? q.error.message : 'The register could not be loaded.'} onRetry={() => void q.refetch()} />
      </div>
    );
  if (!q.data) return <Spinner label="Loading the register…" />;

  const r = q.data;
  if (!r.register) {
    return (
      <Page title="Register" sub="This desk takes payments as plain Billing receipts.">
        <Note>{r.message ?? 'No POS register is paired with this desk.'}</Note>
        <div>
          <TouchButton icon="moon" onClick={() => desk.go('close')}>
            Close the day
          </TouchButton>
        </div>
      </Page>
    );
  }
  return r.session ? <OpenSession state={r} /> : <OpenForm state={r} />;
}

function OpenForm({ state }: { state: RegisterState }) {
  const desk = useDesk();
  const qc = useQueryClient();
  const clock = useNow(60_000);
  const reg = state.register!;
  const [how, setHow] = useState<'count' | 'figure'>('count');
  const [counts, setCounts] = useState<Record<string, string>>({});
  const [figure, setFigure] = useState('');
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const float = how === 'count' ? countTotal(counts) : Number(figure || 0);
  const tz = desk.location.timezone;
  const last = state.last_close;
  const may = desk.may('pos.register.open');

  async function open() {
    setBusy(true);
    try {
      const next = await openRegister(desk.desk.id, float, how === 'count' ? countLines(counts) : null, note?.trim() || null);
      qc.setQueryData(MK.register(desk.desk.id), next);
      void qc.invalidateQueries({ queryKey: K.desks });
      toast('success', `Register ${reg.code} is open.`);
    } catch (e) {
      toast('error', e instanceof Error ? e.message : 'The register did not open.');
      /* Whether it opened is the server's to say: look again. */
      void qc.invalidateQueries({ queryKey: MK.register(desk.desk.id) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Page title="Open the register" sub={[greetingFor(desk, clock), longDay(todayAt(tz, new Date(clock))).replace(/ \d{4}$/, ''), clockAt(new Date(clock).toISOString(), tz)].join(' · ')}>
      <div className="flex flex-col gap-3.5 xl:flex-row xl:items-start">
        <Panel title="Which register?" className="flex w-full flex-col gap-3 xl:w-[480px] xl:shrink-0">
          <div className="flex items-center gap-3 rounded-[14px] border-2 border-primary bg-selection px-4 py-3.5">
            <Icon name="store" size={22} className="shrink-0 text-primary" />
            <div className="min-w-0">
              <div className="truncate text-[17px] font-bold text-ink">
                {reg.name} <span className="font-mono text-[12px] font-semibold text-ink-2">{reg.code}</span>
              </div>
              <div className="truncate text-[12.5px] text-ink-2">
                Closed{last?.closed_at ? ` · last closed ${dayMonth(todayAt(tz, new Date(last.closed_at)), false)} ${clockAt(last.closed_at, tz)} · ${amount(last.counted)} counted` : ''}
              </div>
            </div>
          </div>
          <p className="text-[12.5px] text-ink-2">The register this desk was paired with. Another is chosen by pairing the desk again.</p>
          <div className="rounded-[14px] border border-[var(--ws-note-line)] bg-warning-bg px-3.5 py-3 text-[13px] text-warning-ink">
            Until a register is open you can book, check in and serve — but <b>Take payment</b> and deposits wait. Card, LankaQR and bank payments also need an open session.
          </div>
        </Panel>

        <Panel title={`Count the opening float · ${reg.code}`} className="flex min-w-0 flex-1 flex-col gap-2">
          <p className="-mt-1 text-[12.5px] text-ink-2">Point of Sale keeps the session; SalonMate takes payments into it.</p>
          {how === 'count' ? (
            <CountSheet values={state.denominations ?? []} counts={counts} onChange={setCounts} label="Opening float" />
          ) : (
            <input aria-label="Cash in the drawer" inputMode="decimal" value={figure} onChange={(e) => setFigure(moneyTyped(e.target.value))} className="h-12 rounded-[12px] border border-line bg-surface px-3.5 text-right text-[18px] text-ink outline-none tabular-nums focus:border-primary" />
          )}
          <div className="flex items-baseline justify-between border-t-2 border-ink pt-2">
            <span className="text-[20px] font-extrabold text-ink">Float</span>
            <output className="text-[20px] font-extrabold text-ink tabular-nums">{amount(float, desk.currency)}</output>
          </div>
          {last && float > 0 && Math.round(float * 100) === Math.round(last.counted * 100) ? (
            <p className="flex items-center gap-1 text-[12.5px] text-success">
              <Icon name="check" size={14} /> The same as last night’s count
            </p>
          ) : null}
          <div className="flex flex-wrap gap-x-4 text-[12.5px]">
            <button type="button" onClick={() => setHow(how === 'count' ? 'figure' : 'count')} className="font-semibold text-primary hover:underline">
              {how === 'count' ? 'Give it as one figure instead' : 'Count it note by note instead'}
            </button>
            {note === null ? (
              <button type="button" onClick={() => setNote('')} className="font-semibold text-primary hover:underline">
                Add a note
              </button>
            ) : null}
          </div>
          {note !== null ? <input aria-label="Note" maxLength={300} value={note} placeholder="A note for the session" onChange={(e) => setNote(e.target.value)} className="h-11 rounded-[12px] border border-line bg-surface px-3.5 text-[14px] text-ink outline-none focus:border-primary" /> : null}
          {!may ? <p className="text-[12.5px] text-warning">Opening a register needs Point of Sale’s permission to open one.</p> : null}
          <div className="mt-2 flex gap-2.5">
            <TouchButton onClick={() => desk.go('today')}>Not now</TouchButton>
            <TouchButton variant="primary" icon="store" className="flex-1" loading={busy} disabled={!may} onClick={() => void open()}>
              Open register {reg.code}
            </TouchButton>
          </div>
        </Panel>
      </div>
    </Page>
  );
}

function OpenSession({ state }: { state: RegisterState }) {
  const desk = useDesk();
  const [moving, setMoving] = useState<'in' | 'out' | null>(null);
  const reg = state.register!;
  const s = state.session!;
  const tenders = tenderMap(s.tenders);

  return (
    <Page
      title={`Register ${reg.code} is open`}
      sub={`${reg.name} · session #${s.id}${s.opened_at ? ` opened ${clockAt(s.opened_at, desk.location.timezone)}` : ''}${s.mine ? ' by you' : ''}`}
      actions={
        <>
          <TouchButton icon="arrow-down" onClick={() => setMoving('in')}>
            Pay in
          </TouchButton>
          <TouchButton icon="arrow-up" onClick={() => setMoving('out')}>
            Take cash out
          </TouchButton>
          <TouchButton variant="primary" icon="moon" onClick={() => desk.go('close')}>
            Close the day
          </TouchButton>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Figure label="Opening float" value={amount(s.opening_float)} />
        <Figure label="Sales" value={String(s.sales.count)} sub={`${amount(s.sales.total)} in all`} />
        <Figure label="Cash in" value={amount(s.sales.cash_in)} sub={`change given ${amount(s.sales.cash_change)}`} />
        <Figure label="Drawer should hold" value={s.expected === null ? 'Hidden' : amount(s.expected)} sub={s.expected === null ? 'blind close: shown once counted' : 'float, cash sales and movements'} />
      </div>

      <Panel title="Taken by tender">
        {Object.keys(tenders).length === 0 ? (
          <p className="py-2 text-[14px] text-ink-2">No sales in this session yet.</p>
        ) : (
          <dl className="grid grid-cols-1 gap-x-8 md:grid-cols-2">
            {Object.entries(tenders).map(([m, v]) => (
              <div key={m} className="flex justify-between gap-3 border-b border-line py-2.5 text-[15px]">
                <dt className="text-ink-2">{METHOD_LABEL[m] ?? m}</dt>
                <dd className="m-0 font-bold text-ink tabular-nums">{amount(v)}</dd>
              </div>
            ))}
          </dl>
        )}
      </Panel>

      {moving ? <MoveCash direction={moving} code={reg.code} onClose={() => setMoving(null)} /> : null}
    </Page>
  );
}

/**
 * Cash in or out of the open drawer, with its reason (POS-07). A press that
 * got no answer is never sent again by itself: the register is looked at first.
 */
export function MoveCash({ direction, code, onClose }: { direction: 'in' | 'out'; code: string; onClose: () => void }) {
  const desk = useDesk();
  const qc = useQueryClient();
  const [value, setValue] = useState('');
  const [reason, setReason] = useState(direction === 'out' ? 'To the safe' : '');
  const [busy, setBusy] = useState(false);
  const [unsure, setUnsure] = useState(false);
  const n = Number(value || 0);

  async function send() {
    setBusy(true);
    try {
      const message = await moveCash(desk.desk.id, direction, n, reason.trim());
      toast('success', message ?? 'Done.');
      void qc.invalidateQueries({ queryKey: MK.register(desk.desk.id) });
      onClose();
    } catch (e) {
      if (answered(e)) {
        toast('error', e instanceof Error ? e.message : 'That was not recorded.');
      } else {
        setUnsure(true);
        void qc.invalidateQueries({ queryKey: MK.register(desk.desk.id) });
      }
    } finally {
      setBusy(false);
    }
  }

  const field = 'h-12 rounded-[12px] border border-line bg-surface px-3.5 text-[15px] text-ink outline-none focus:border-primary';
  return (
    <DeskDialog
      tone="teal"
      icon={direction === 'in' ? 'arrow-down' : 'arrow-up'}
      title={direction === 'in' ? `Put cash into ${code}` : `Take cash out of ${code}`}
      sub="Recorded in the register’s session, with its reason."
      labelledBy="salon-move-cash"
      width={540}
      onClose={onClose}
      footer={
        <>
          <TouchButton onClick={onClose}>Cancel</TouchButton>
          <TouchButton variant="primary" icon="check" loading={busy} disabled={!(n > 0) || reason.trim() === '' || unsure} onClick={() => void send()}>
            {direction === 'in' ? 'Put in' : 'Take out'} {n > 0 ? amount(n) : ''}
          </TouchButton>
        </>
      }
    >
      <label className="flex flex-col gap-1">
        <span className="text-[12.5px] font-semibold text-ink-2">Amount</span>
        <input className={cx(field, 'text-right text-[18px] tabular-nums')} inputMode="decimal" autoFocus value={value} onChange={(e) => setValue(moneyTyped(e.target.value))} />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-[12.5px] font-semibold text-ink-2">What it is for</span>
        <input className={field} maxLength={120} value={reason} onChange={(e) => setReason(e.target.value)} />
      </label>
      {unsure ? (
        <Note tone="warning" icon="warning">
          WorkSuite did not answer, so it may have been recorded. Look at the register’s figures before doing it again.
        </Note>
      ) : null}
    </DeskDialog>
  );
}
