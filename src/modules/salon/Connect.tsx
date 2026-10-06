import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { Icon } from '../../components/Icon';
import { Spinner, cx } from '../../components/ui';
import { Select } from '../../components/Select';
import { app } from '../../core/app-state';
import { useStore } from '../../core/store';
import { toast } from '../../core/toasts';
import type { SalonDeskInfo, SalonDeskPairing } from '@shared/types';
import { fetchOptions, forgetDesk, K, pairDesk, type DeskList } from './api';
import { Failed, Note, TouchButton } from './parts';

/**
 * Setting SalonMate up on this computer (D01, DSK-02, POS-01).
 *
 * SalonMate is an app inside WorkSuite Desktop: the person is already signed
 * in and the computer is already a WorkSuite device. What is left is the
 * front desk — its name, its location — and, where the salon uses Point of
 * Sale, the register its money goes into, the stock location its products
 * come out of and the receipt template it prints with. Somebody who may manage desks is
 * approved at once; anybody else's request waits for an owner, and this
 * screen waits with it. The key the server hands over is kept by the main
 * process; this screen only ever sees the desk.
 */
type Desks = { data?: DeskList; isLoading: boolean; isError: boolean; refetch: () => unknown };

export default function Connect({ pairing, desk, state, desks, me, onChange }: {
  pairing: SalonDeskPairing | null;
  desk: SalonDeskInfo | null;
  state: SalonDeskInfo['status'] | 'gone' | null;
  desks: Desks;
  me?: string | null;
  onChange: () => void;
}) {
  const email = useStore(app, (s) => s.auth?.user?.email ?? null);
  const paired = !!pairing && (state === 'requested' || state === 'active');
  return (
    <div className="h-full overflow-y-auto bg-ground px-5 py-4 scroll-thin">
      <section className="rounded-[16px] border border-line bg-surface px-[26px] py-6 shadow-[0_1px_2px_rgb(var(--ws-shadow-rgb)/.05)]">
        <h1 className="text-[24px] leading-tight font-extrabold text-ink">Set up SalonMate on this computer</h1>
        <p className="mt-0.5 text-[14px] text-ink-2">SalonMate is an app inside WorkSuite Desktop — same sign-in, updates and device approval as every other app.</p>
        <div className="mt-5 flex flex-col gap-6 lg:flex-row">
          <ol className="flex w-full shrink-0 flex-col gap-4 lg:w-[330px] lg:border-r lg:border-line lg:pr-6">
            <Step n={1} state="done" title="Signed in to WorkSuite" sub={`${email ?? me ?? 'You'} · this computer is already a WorkSuite Desktop device`} />
            <Step n={2} state={paired ? 'done' : 'now'} title="SalonMate on this computer" sub={desk?.location ? `Front desk for ${desk.location}` : 'Name the front desk and choose its location'} />
            <Step n={3} state={paired ? 'done' : 'now'} title="Use it as a POS till" sub="A register for payments, a stock location and a receipt template" />
            <Step n={4} state="later" title="Receipt printer" sub="Set up in Settings once the desk is approved" />
          </ol>
          <div className="min-w-0 flex-1">
            {pairing ? <Waiting pairing={pairing} desk={desk} state={state} loading={desks.isLoading} failed={desks.isError} onRetry={() => void desks.refetch()} onChange={onChange} /> : <PairForm desks={desks} onChange={onChange} />}
          </div>
        </div>
      </section>
    </div>
  );
}

function Step({ n, state, title, sub }: { n: number; state: 'done' | 'now' | 'later'; title: string; sub: ReactNode }) {
  return (
    <li className="flex items-start gap-3">
      <span
        className={cx(
          'grid h-[30px] w-[30px] shrink-0 place-items-center rounded-full text-[15px] font-bold',
          state === 'done' ? 'bg-success-bg text-success' : state === 'now' ? 'bg-selection text-primary' : 'bg-ground text-ink-2',
        )}
      >
        {state === 'done' ? <Icon name="check" size={16} strokeWidth={2.4} /> : n}
      </span>
      <div className="min-w-0">
        <div className={cx('text-[17px] font-bold', state === 'later' ? 'text-ink-2' : 'text-ink')}>{title}</div>
        <div className="text-[13px] text-ink-2">{sub}</div>
      </div>
    </li>
  );
}

const FIELD = 'h-11 rounded-[10px] border border-line bg-surface px-3.5 text-[14.5px] text-ink outline-none focus:border-primary';

function PairForm({ desks, onChange }: { desks: Desks; onChange: () => void }) {
  const qc = useQueryClient();
  const options = useQuery({ queryKey: K.options(null), queryFn: ({ signal }) => fetchOptions(null, signal) });
  const [name, setName] = useState('Front desk');
  const [locationId, setLocationId] = useState<number | null>(null);
  const [registerId, setRegisterId] = useState<number | null>(null);
  const [store, setStore] = useState<number | null>(null);
  const [template, setTemplate] = useState<string | null>(null);
  const [busy, setBusy] = useState<'pos' | 'plain' | null>(null);

  const locations = options.data?.locations ?? [];
  const location = locations.find((l) => l.id === locationId) ?? locations[0] ?? null;
  const registers = (desks.data?.registers ?? []).filter((r) => !location || r.org_id === location.org_id);
  const register = registers.find((r) => r.id === registerId) ?? registers[0] ?? null;
  const stores = (desks.data?.warehouses ?? []).filter((w) => w.org_id === null || !location || w.org_id === location.org_id);
  const templates = desks.data?.templates ?? [];
  const chosen = templates.find((t) => t.id === template) ?? templates[0] ?? null;

  async function pair(withRegister: boolean) {
    if (!location) return;
    setBusy(withRegister ? 'pos' : 'plain');
    try {
      const r = await pairDesk({
        location_id: location.id,
        name: name.trim(),
        pos_register_id: withRegister && register ? register.id : null,
        warehouse_id: stores.some((w) => w.id === store) ? store : null,
        receipt_template: chosen?.id ?? null,
      });
      toast('success', r.message ?? `${r.desk.name} is paired.`);
      void qc.invalidateQueries({ queryKey: K.pairing });
      void qc.invalidateQueries({ queryKey: K.desks });
      onChange();
    } catch (e) {
      toast('error', e instanceof Error ? e.message : 'This computer could not be paired. Try again.');
    } finally {
      setBusy(null);
    }
  }

  if (options.isError) return <Failed text="WorkSuite could not say which locations you may set a desk up at." onRetry={() => void options.refetch()} />;
  if (options.isLoading) return <Spinner label="Loading your locations…" />;
  if (locations.length === 0) return <Note tone="warning">You have no SalonMate location to set a desk up at. Ask an owner to give you access to one.</Note>;

  return (
    <div className="flex flex-col gap-3.5">
      <h2 className="text-[19px] font-extrabold text-ink">Use this front desk as a POS till</h2>
      <div className="grid gap-3.5 md:grid-cols-2">
        <label className="flex flex-col gap-1">
          <span className="text-[13px] font-semibold text-ink">Name of this desk</span>
          <input className={FIELD} value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
          <span className="text-[12px] text-ink-2">What owners see in the list of desks — Front desk, Reception 2.</span>
        </label>
        <div className="flex flex-col gap-1">
          <span className="text-[13px] font-semibold text-ink">Location</span>
          <Select
            label="Location"
            value={String(location?.id ?? '')}
            options={locations.map((l) => ({ value: String(l.id), label: l.name }))}
            onValueChange={(v) => {
              setLocationId(Number(v));
              setRegisterId(null);
              setStore(null);
            }}
          />
        </div>
      </div>
      {desks.isError ? (
        <Failed text="The company’s POS registers could not be loaded." onRetry={() => void desks.refetch()} />
      ) : desks.isLoading ? (
        <Spinner label="Loading registers…" />
      ) : registers.length === 0 ? (
        <Note>This company has no POS register in use. The desk takes payments as plain Billing receipts.</Note>
      ) : (
        <div className="flex flex-col gap-1">
          <span className="text-[13px] font-semibold text-ink">Register it takes money into</span>
          <Select label="Register" value={String(register?.id ?? '')} options={registers.map((r) => ({ value: String(r.id), label: `${r.code} · ${r.name}` }))} onValueChange={(v) => setRegisterId(Number(v))} />
          <span className="text-[12px] text-ink-2">Salon checkouts, deposits and retail sales land in this register’s session and drawer.</span>
        </div>
      )}
      {stores.length > 0 || templates.length > 0 ? (
        <div className="grid gap-3.5 md:grid-cols-2">
          {stores.length > 0 ? (
            <div className="flex flex-col gap-1">
              <span className="text-[13px] font-semibold text-ink">Stock location</span>
              <Select
                label="Stock location"
                value={stores.some((w) => w.id === store) ? String(store) : 'location'}
                options={[{ value: 'location', label: `${location?.name ?? 'The location'}’s own store` }, ...stores.map((w) => ({ value: String(w.id), label: w.code ? `${w.code} · ${w.name}` : w.name }))]}
                onValueChange={(v) => setStore(v === 'location' ? null : Number(v))}
              />
              <span className="text-[12px] text-ink-2">Products used on clients and retail sold at this desk come out of this stock.</span>
            </div>
          ) : null}
          {chosen ? (
            <div className="flex flex-col gap-1">
              <span className="text-[13px] font-semibold text-ink">Receipt template</span>
              <Select label="Receipt template" value={chosen.id} options={templates.map((t) => ({ value: t.id, label: t.name }))} onValueChange={(v) => setTemplate(v)} />
              <span className="text-[12px] text-ink-2">{chosen.about}</span>
            </div>
          ) : null}
        </div>
      ) : null}
      <div className="flex items-start gap-2.5 rounded-[12px] bg-selection px-3.5 py-3 text-[13.5px] text-primary">
        <Icon name="shield" size={18} className="mt-0.5 shrink-0" />
        <span>An owner approves the pairing. The desk’s key is kept in this computer’s credential store, and can be revoked from SalonMate → Front desk PCs at any time; the desk stops at once.</span>
      </div>
      <div className="flex flex-wrap justify-end gap-2.5">
        <TouchButton loading={busy === 'plain'} disabled={busy !== null || name.trim() === ''} onClick={() => void pair(false)}>
          {registers.length > 0 ? 'Skip — no payments here' : 'Pair this desk'}
        </TouchButton>
        {registers.length > 0 && register ? (
          <TouchButton variant="primary" icon="check" loading={busy === 'pos'} disabled={busy !== null || name.trim() === ''} onClick={() => void pair(true)}>
            Pair with {register.code}
          </TouchButton>
        ) : null}
      </div>
    </div>
  );
}

function Waiting({ pairing, desk, state, loading, failed, onRetry, onChange }: {
  pairing: SalonDeskPairing;
  desk: SalonDeskInfo | null;
  state: SalonDeskInfo['status'] | 'gone' | null;
  loading: boolean;
  failed: boolean;
  onRetry: () => void;
  onChange: () => void;
}) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const name = desk?.name ?? pairing.name ?? 'This desk';

  async function again() {
    setBusy(true);
    try {
      await forgetDesk();
      void qc.invalidateQueries({ queryKey: K.pairing });
      onChange();
    } catch (e) {
      toast('error', e instanceof Error ? e.message : 'The pairing could not be forgotten.');
    } finally {
      setBusy(false);
    }
  }

  if (failed) return <Failed text="WorkSuite could not say whether this desk is approved." onRetry={onRetry} />;
  if (loading || state === null || state === 'active') return <Spinner label="Asking whether this desk is approved…" />;

  return (
    <div className="flex flex-col gap-4">
      {state === 'requested' ? (
        <div className="flex items-start gap-3">
          <span className="grid h-12 w-12 shrink-0 place-items-center rounded-[14px] bg-warning-bg text-warning">
            <Icon name="clock" size={26} />
          </span>
          <div>
            <p className="text-[19px] font-extrabold text-ink">{name} is waiting for an owner to approve it</p>
            <p className="text-[14px] text-ink-2">Ask an owner to open SalonMate → Front desk PCs and approve it. This screen moves on by itself once they have.</p>
            {desk ? (
              <p className="mt-1.5 text-[14px] text-ink">
                <b>{desk.location ?? 'Location'}</b>
                {desk.register ? ` · register ${desk.register.code}` : ' · no POS register'}
                {desk.warehouse ? ` · stock from ${desk.warehouse.name}` : ''}
                {desk.receipt_template_name ? ` · ${desk.receipt_template_name}` : ''}
              </p>
            ) : null}
          </div>
        </div>
      ) : (
        <div className="flex items-start gap-3">
          <span className="grid h-12 w-12 shrink-0 place-items-center rounded-[14px] bg-danger-bg text-danger">
            <Icon name="shield-alert" size={26} />
          </span>
          <div>
            <p className="text-[19px] font-extrabold text-ink">{state === 'revoked' ? `${name} was revoked` : `${name} is no longer paired`}</p>
            <p className="text-[14px] text-ink-2">It cannot work as the front desk. Pair this computer again — an owner approves the new pairing.</p>
          </div>
        </div>
      )}
      <div className="flex justify-end">
        <TouchButton loading={busy} onClick={() => void again()}>
          {state === 'requested' ? 'Cancel and start again' : 'Pair this computer again'}
        </TouchButton>
      </div>
    </div>
  );
}
