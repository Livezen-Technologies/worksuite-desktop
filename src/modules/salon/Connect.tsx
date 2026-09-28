import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Icon } from '../../components/Icon';
import { Button, Card, Spinner, TextField } from '../../components/ui';
import { Select } from '../../components/Select';
import { toast } from '../../core/toasts';
import type { SalonDeskInfo, SalonDeskPairing } from '@shared/types';
import { fetchOptions, forgetDesk, K, pairDesk, type DeskList } from './api';
import { Failed, Note } from './parts';

/**
 * Pairing this computer as a salon's front desk (D01, DSK-02, POS-01).
 *
 * The desk is named, placed at one location and — where the salon uses Point
 * of Sale — bound to the register its money goes into. Somebody who may
 * manage desks is approved at once; anybody else's request waits for an
 * owner, and this screen waits with it. The key the server hands over is kept
 * by the main process; this screen only ever sees the desk.
 */
export default function Connect({ pairing, desk, state, desks, onChange }: {
  pairing: SalonDeskPairing | null;
  desk: SalonDeskInfo | null;
  state: SalonDeskInfo['status'] | 'gone' | null;
  desks: { data?: DeskList; isLoading: boolean; isError: boolean; refetch: () => unknown };
  onChange: () => void;
}) {
  return (
    <div className="h-full overflow-y-auto bg-ground scroll-thin">
      <div className="mx-auto flex max-w-3xl flex-col gap-4 p-8">
        <div className="flex items-center gap-3">
          <span className="flex h-12 w-12 items-center justify-center rounded-[14px] bg-selection text-primary">
            <Icon name="scissors" size={26} />
          </span>
          <div>
            <h1 className="text-[22px] font-extrabold text-ink">SalonMate on this computer</h1>
            <p className="text-[13px] text-ink-2">Pair this computer as the front desk of one of your salon’s locations.</p>
          </div>
        </div>
        {pairing ? <Waiting pairing={pairing} desk={desk} state={state} loading={desks.isLoading} failed={desks.isError} onRetry={() => void desks.refetch()} onChange={onChange} /> : <PairForm desks={desks} onChange={onChange} />}
      </div>
    </div>
  );
}

function PairForm({ desks, onChange }: { desks: { data?: DeskList; isLoading: boolean; isError: boolean; refetch: () => unknown }; onChange: () => void }) {
  const qc = useQueryClient();
  const options = useQuery({ queryKey: K.options(null), queryFn: ({ signal }) => fetchOptions(null, signal) });
  const [name, setName] = useState('Front desk');
  const [locationId, setLocationId] = useState<number | null>(null);
  const [registerId, setRegisterId] = useState<number | null>(null);
  const [busy, setBusy] = useState<'pos' | 'plain' | null>(null);

  const locations = options.data?.locations ?? [];
  const location = locations.find((l) => l.id === locationId) ?? locations[0] ?? null;
  const registers = (desks.data?.registers ?? []).filter((r) => !location || r.org_id === location.org_id);
  const register = registers.find((r) => r.id === registerId) ?? registers[0] ?? null;

  async function pair(withRegister: boolean) {
    if (!location) return;
    setBusy(withRegister ? 'pos' : 'plain');
    try {
      const r = await pairDesk({ location_id: location.id, name: name.trim(), pos_register_id: withRegister && register ? register.id : null });
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
    <Card title="Pair this desk">
      <div className="flex flex-col gap-4">
        <TextField label="Name of this desk" hint="What owners see in the list of desks — Front desk, Reception 2." value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
        <label className="flex flex-col gap-1">
          <span className="text-[12.5px] font-semibold text-ink-2">Location</span>
          <Select
            aria-label="Location"
            value={String(location?.id ?? '')}
            onChange={(e) => {
              setLocationId(Number(e.target.value));
              setRegisterId(null);
            }}
            className="h-9 rounded-[8px] border border-line bg-surface px-2 text-[13px] text-ink"
          >
            {locations.map((l) => (
              <option key={l.id} value={String(l.id)}>
                {l.name}
              </option>
            ))}
          </Select>
        </label>
        {desks.isError ? (
          <Failed text="The company’s POS registers could not be loaded." onRetry={() => void desks.refetch()} />
        ) : desks.isLoading ? (
          <Spinner label="Loading registers…" />
        ) : registers.length === 0 ? (
          <Note>This company has no POS register in use. The desk takes payments as plain Billing receipts.</Note>
        ) : (
          <label className="flex flex-col gap-1">
            <span className="text-[12.5px] font-semibold text-ink-2">Register it takes money into</span>
            <Select aria-label="Register" value={String(register?.id ?? '')} onChange={(e) => setRegisterId(Number(e.target.value))} className="h-9 rounded-[8px] border border-line bg-surface px-2 text-[13px] text-ink">
              {registers.map((r) => (
                <option key={r.id} value={String(r.id)}>
                  {r.code} · {r.name}
                </option>
              ))}
            </Select>
            <span className="text-[12px] text-ink-3">Salon checkouts and retail sales land in this register’s session and drawer.</span>
          </label>
        )}
        <p className="text-[12px] text-ink-3">An owner approves the pairing, and can revoke it from SalonMate → Front desk PCs at any time; the desk stops at once.</p>
        <div className="flex flex-wrap justify-end gap-2.5">
          <Button size="lg" loading={busy === 'plain'} disabled={busy !== null || name.trim() === ''} onClick={() => void pair(false)}>
            {registers.length > 0 ? 'Skip — no payments here' : 'Pair this desk'}
          </Button>
          {registers.length > 0 && register ? (
            <Button variant="primary" size="lg" loading={busy === 'pos'} disabled={busy !== null || name.trim() === ''} onClick={() => void pair(true)}>
              Pair with {register.code}
            </Button>
          ) : null}
        </div>
      </div>
    </Card>
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
    <Card>
      <div className="flex flex-col gap-4 pt-4">
        {state === 'requested' ? (
          <div className="flex items-start gap-3">
            <Icon name="clock" size={28} className="shrink-0 text-warning" />
            <div>
              <p className="text-[17px] font-extrabold text-ink">{name} is waiting for an owner to approve it</p>
              <p className="text-[13px] text-ink-2">Ask an owner to open SalonMate → Front desk PCs and approve it. This screen moves on by itself once they have.</p>
              {desk ? (
                <p className="mt-1 text-[13px] text-ink">
                  <b>{desk.location ?? 'Location'}</b>
                  {desk.register ? ` · register ${desk.register.code}` : ' · no POS register'}
                </p>
              ) : null}
            </div>
          </div>
        ) : (
          <div className="flex items-start gap-3">
            <Icon name="shield-alert" size={28} className="shrink-0 text-danger" />
            <div>
              <p className="text-[17px] font-extrabold text-ink">{state === 'revoked' ? `${name} was revoked` : `${name} is no longer paired`}</p>
              <p className="text-[13px] text-ink-2">It cannot work as the front desk. Pair this computer again — an owner approves the new pairing.</p>
            </div>
          </div>
        )}
        <div className="flex justify-end">
          <Button loading={busy} onClick={() => void again()}>
            {state === 'requested' ? 'Cancel and start again' : 'Pair this computer again'}
          </Button>
        </div>
      </div>
    </Card>
  );
}
