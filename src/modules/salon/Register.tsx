import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Icon } from '../../components/Icon';
import { Button, Card, Modal, Spinner, TextField } from '../../components/ui';
import { toast } from '../../core/toasts';
import { amount, answered, clockAt, shortDay } from './api';
import { countLines, countTotal, fetchRegister, METHOD_LABEL, MK, moneyTyped, moveCash, openRegister, tenderMap, type RegisterState } from './money';
import { Choice, CountSheet, Failed, Note, Tile, useDesk } from './parts';

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

  if (q.isError) return <div className="p-6"><Failed text={q.error instanceof Error ? q.error.message : 'The register could not be loaded.'} onRetry={() => void q.refetch()} /></div>;
  if (!q.data) return <Spinner label="Loading the register…" />;

  const r = q.data;
  if (!r.register) {
    return (
      <div className="flex flex-col gap-4 p-6">
        <h1 className="text-[22px] font-extrabold text-ink">Register</h1>
        <Note>{r.message ?? 'This desk takes payments as plain Billing receipts: no POS register is paired.'}</Note>
        <div>
          <Button icon="moon" onClick={() => desk.go('close')}>
            Close the day
          </Button>
        </div>
      </div>
    );
  }
  return r.session ? <OpenSession state={r} /> : <OpenForm state={r} />;
}

function OpenForm({ state }: { state: RegisterState }) {
  const desk = useDesk();
  const qc = useQueryClient();
  const reg = state.register!;
  const [how, setHow] = useState<'count' | 'figure'>('count');
  const [counts, setCounts] = useState<Record<string, string>>({});
  const [figure, setFigure] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const float = how === 'count' ? countTotal(counts) : Number(figure || 0);
  const tz = desk.location.timezone;

  async function open() {
    setBusy(true);
    try {
      const next = await openRegister(desk.desk.id, float, how === 'count' ? countLines(counts) : null, note.trim() || null);
      qc.setQueryData(MK.register(desk.desk.id), next);
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
    <div className="flex flex-col gap-4 p-6">
      <div>
        <h1 className="text-[22px] font-extrabold text-ink">Open the register</h1>
        <p className="mt-0.5 text-[13px] text-ink-2">
          {reg.name} · {reg.code}
          {state.last_close?.closed_at ? ` · last closed ${shortDay(state.last_close.closed_at.slice(0, 10))} ${clockAt(state.last_close.closed_at, tz)} with ${amount(state.last_close.counted)} counted` : ''}
        </p>
      </div>
      <Note tone="warning">Until the register is open you can book, check in and serve — taking payment waits.</Note>
      <Card title={`Count the opening float · ${reg.code}`}>
        <div className="flex flex-col gap-3">
          <Choice
            label="How to give the float"
            value={how}
            onChange={setHow}
            options={[
              { value: 'count', label: 'Note by note' },
              { value: 'figure', label: 'One figure' },
            ]}
          />
          {how === 'count' ? (
            <CountSheet values={state.denominations ?? []} counts={counts} onChange={setCounts} label="Opening float" />
          ) : (
            <TextField label="Cash in the drawer" inputMode="decimal" value={figure} onChange={(e) => setFigure(moneyTyped(e.target.value))} />
          )}
          <TextField label="Note" maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} />
          <div className="flex items-baseline justify-between rounded-[10px] bg-selection px-4 py-3">
            <span className="text-[14px] font-bold text-primary">Float</span>
            <output className="text-[22px] font-extrabold text-primary tabular-nums">{amount(float)}</output>
          </div>
        </div>
      </Card>
      <div className="flex flex-wrap items-center justify-end gap-2.5">
        {!desk.may('pos.register.open') ? <span className="text-[12.5px] text-warning">Opening a register needs Point of Sale’s permission to open one.</span> : null}
        <Button onClick={() => desk.go('today')}>Not now</Button>
        <Button variant="primary" icon="unlock" loading={busy} disabled={!desk.may('pos.register.open')} onClick={() => void open()}>
          Open register {reg.code}
        </Button>
      </div>
    </div>
  );
}

function OpenSession({ state }: { state: RegisterState }) {
  const desk = useDesk();
  const [moving, setMoving] = useState<'in' | 'out' | null>(null);
  const reg = state.register!;
  const s = state.session!;
  const tenders = tenderMap(s.tenders);

  return (
    <div className="flex flex-col gap-4 p-6">
      <div className="flex flex-wrap items-center gap-2.5">
        <div className="min-w-0 flex-1">
          <h1 className="text-[22px] font-extrabold text-ink">Register {reg.code} is open</h1>
          <p className="mt-0.5 text-[13px] text-ink-2">
            {reg.name} · session #{s.id}
            {s.opened_at ? ` opened ${clockAt(s.opened_at, desk.location.timezone)}` : ''}
            {s.mine ? ' by you' : ''}
          </p>
        </div>
        <Button icon="arrow-down" onClick={() => setMoving('in')}>
          Pay in
        </Button>
        <Button icon="arrow-up" onClick={() => setMoving('out')}>
          Take cash out
        </Button>
        <Button variant="primary" icon="moon" onClick={() => desk.go('close')}>
          Close the day
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile label="Opening float" value={amount(s.opening_float)} />
        <Tile label="Sales" value={String(s.sales.count)} sub={`${amount(s.sales.total)} in all`} />
        <Tile label="Cash in" value={amount(s.sales.cash_in)} sub={`change given ${amount(s.sales.cash_change)}`} />
        <Tile label="Drawer should hold" value={s.expected === null ? 'Hidden' : amount(s.expected)} sub={s.expected === null ? 'blind close: shown once counted' : 'float, cash sales and movements'} />
      </div>

      <Card title="Taken by tender">
        {Object.keys(tenders).length === 0 ? (
          <p className="text-[13px] text-ink-2">No sales in this session yet.</p>
        ) : (
          <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-[14px] md:grid-cols-3">
            {Object.entries(tenders).map(([m, v]) => (
              <div key={m} className="flex justify-between gap-3 border-b border-line py-1.5">
                <dt className="text-ink-2">{METHOD_LABEL[m] ?? m}</dt>
                <dd className="m-0 font-bold text-ink tabular-nums">{amount(v)}</dd>
              </div>
            ))}
          </dl>
        )}
      </Card>

      {moving ? <MoveCash direction={moving} code={reg.code} onClose={() => setMoving(null)} /> : null}
    </div>
  );
}

/**
 * Cash in or out of the open drawer, with its reason (POS-07). WorkSuite does
 * not keep these under a key, so a press that got no answer is never sent
 * again by itself: the register is looked at first.
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

  return (
    <Modal
      title={direction === 'in' ? `Put cash into ${code}` : `Take cash out of ${code}`}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={busy} disabled={!(n > 0) || reason.trim() === '' || unsure} onClick={() => void send()}>
            {direction === 'in' ? 'Put in' : 'Take out'} {n > 0 ? amount(n) : ''}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <TextField label="Amount" inputMode="decimal" autoFocus value={value} onChange={(e) => setValue(moneyTyped(e.target.value))} />
        <TextField label="What it is for" maxLength={120} value={reason} onChange={(e) => setReason(e.target.value)} />
        {unsure ? (
          <Note tone="warning">
            <span className="inline-flex items-center gap-1.5">
              <Icon name="warning" size={14} /> WorkSuite did not answer, so it may have been recorded. Look at the register’s figures before doing it again.
            </span>
          </Note>
        ) : null}
      </div>
    </Modal>
  );
}
