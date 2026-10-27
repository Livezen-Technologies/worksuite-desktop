import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Icon } from '../../components/Icon';
import { Button, cx } from '../../components/ui';
import { toast } from '../../core/toasts';
import { input } from '../../components/FormKit';
import { day, errorText, pGet, pPost, type Stay } from './api';
import { device } from './devices';
import { doorLocks, finishKey, type KeyAnswer, type KeyDone, type KeyLogRow } from './locks';
import { usePms } from './parts';
import { Checkbox } from '../../components/Checkbox';

type Action = 'issue' | 'duplicate' | 'cancel' | 'status';

/**
 * A stay's keys (PMS-KEY-002): a new key or a duplicate — how many cards, which common areas, a TTLock app key —
 * cancelled, asked about; the property's lock system does it (WorkSuite for TTLock, this desk's lock server for
 * Salto, Vingcard and dormakaba) and the key log says who made which key, for which room, until when.
 */
export function KeyPanel({ stay, onChanged }: { stay: Stay; onChanged: () => void }) {
  const pms = usePms();
  const qc = useQueryClient();
  const logKey = ['pms', 'keys', stay.id];
  const cfg = useQuery({ queryKey: ['pms', 'door-locks', stay.property_id], queryFn: ({ signal }) => doorLocks(stay.property_id, signal), enabled: pms.online });
  const log = useQuery({ queryKey: logKey, queryFn: ({ signal }) => pGet<{ items: KeyLogRow[] }>(`/stays/${stay.id}/keys`, undefined, signal), enabled: pms.online });
  const lock = cfg.data?.door_locks.enabled ? cfg.data.door_locks : null;
  const max = cfg.data?.max_cards ?? 6;
  const [cards, setCards] = useState<number | null>(null);
  const [areas, setAreas] = useState<string[] | null>(null);
  const [mobile, setMobile] = useState(false);
  const [receiver, setReceiver] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<KeyDone | null>(null);
  const count = cards ?? lock?.default_cards ?? 1;
  const chosen = areas ?? (lock?.common_areas ?? []).filter((a) => a.default).map((a) => a.code);
  const enc = device('key_encoder');
  const inHouse = stay.status === 'in_house';
  const may = pms.may('pms.keys.issue');

  const act = async (action: Action) => {
    setBusy(true);
    setDone(null);
    try {
      const body = action === 'cancel' || action === 'status' ? { action } : { action, cards: count, common_areas: chosen, mobile, ...(mobile ? { receiver: receiver.trim() } : {}) };
      const r = await pPost<{ key: KeyAnswer }>(`/stays/${stay.id}/keys`, body);
      const out = await finishKey(stay.property_id, r.data.key);
      setDone(out);
      toast(out.ok ? 'success' : out.ran || !r.data.key.ok ? 'error' : 'info', out.message || r.message);
    } catch (e) {
      toast('error', errorText(e, 'The lock system did not answer.'));
    } finally {
      setBusy(false);
      void qc.invalidateQueries({ queryKey: logKey });
      onChanged();
    }
  };

  const area = (code: string, on: boolean) => setAreas(on ? [...chosen, code] : chosen.filter((c) => c !== code));

  return (
    <div className="flex flex-col gap-3 text-[13px]">
      <p className="m-0 flex items-center gap-2">
        <Icon name="key" size={15} className="text-ink-3" /> {stay.key_status_label ?? 'No key yet'}
        {lock ? <span className="text-[12px] text-ink-3">· {lock.vendor_label}</span> : null}
      </p>
      <p className="m-0 text-[12px] text-ink-3">
        {!lock
          ? 'No door-lock system is switched on for this property: keys are handed over by hand.'
          : lock.mode === 'server'
            ? `${lock.vendor_label} is done by WorkSuite: passcodes and app keys come back here.`
            : enc.available()
              ? `This desk encodes cards on ${enc.label}.`
              : 'This computer has no lock server for this property (Desk devices → Door-lock server): a card waits for a desk that has one.'}
      </p>
      {inHouse && may ? (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-1.5">
              Cards
              <input aria-label="How many cards" type="number" min={1} max={max} className={cx(input, 'w-20')} value={count} onChange={(e) => setCards(Math.max(1, Math.min(max, Number(e.target.value) || 1)))} />
            </label>
            {lock?.vendor === 'ttlock' ? (
              <label className="flex items-center gap-1.5">
                <Checkbox checked={mobile} onChange={(e) => setMobile(e.target.checked)} /> App key
              </label>
            ) : null}
            {mobile ? <input aria-label="The guest’s TTLock account" placeholder="The guest’s TTLock account" className={cx(input, 'w-52')} value={receiver} onChange={(e) => setReceiver(e.target.value)} /> : null}
          </div>
          {(lock?.common_areas ?? []).length > 0 ? (
            <div className="flex flex-wrap gap-3 text-[12px]">
              {(lock?.common_areas ?? []).map((a) => (
                <label key={a.code} className="flex items-center gap-1">
                  <Checkbox checked={chosen.includes(a.code)} onChange={(e) => area(a.code, e.target.checked)} /> {a.name}
                </label>
              ))}
            </div>
          ) : null}
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="primary" loading={busy} disabled={!pms.online} onClick={() => void act('issue')}>
              New key
            </Button>
            <Button disabled={busy || !pms.online} onClick={() => void act('duplicate')}>
              Duplicate
            </Button>
            <Button disabled={busy || !pms.online} onClick={() => void act('status')}>
              Ask the lock system
            </Button>
            <Button variant="danger" disabled={busy || !pms.online} onClick={() => void act('cancel')}>
              Cancel key
            </Button>
          </div>
        </>
      ) : null}
      {!inHouse && may && lock && stay.key_status !== 'revoked' ? (
        <Button variant="danger" className="self-start" disabled={busy || !pms.online} onClick={() => void act('cancel')}>
          Cancel key
        </Button>
      ) : null}
      {done?.secret ? (
        <div role="status" className="rounded-[10px] border border-warning/50 bg-warning/10 px-3 py-2">
          <b className="block">Give the guest {done.secret.includes('\n') ? 'these passcodes' : 'this passcode'} now</b>
          <pre className="m-0 font-mono whitespace-pre-wrap">{done.secret}</pre>
        </div>
      ) : null}
      {log.data ? (
        <ul aria-label="Key log" className="m-0 flex max-h-56 list-none flex-col gap-1 overflow-auto p-0 text-[12px]">
          {log.data.items.length === 0 ? <li className="text-ink-3">No key made yet.</li> : null}
          {log.data.items.map((r) => (
            <li key={r.id} className="border-t border-line pt-1">
              <b>{r.action_label}</b> · room {r.rooms || '—'} · {r.status_label}
              {r.cards > 0 && r.action !== 'cancel' ? ` · ${r.cards} card${r.cards === 1 ? '' : 's'}` : ''}
              {r.valid_until ? ` · until ${day(r.valid_until.slice(0, 10))} ${r.valid_until.slice(11, 16)}` : ''}
              <span className="block text-ink-3">
                {r.created_by_name ?? 'System'} · {r.created_at ?? ''}
                {r.encoder ? ` · ${r.encoder}` : ''}
                {r.message ? ` — ${r.message}` : ''}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/** After a check-in or a move: run each key WorkSuite answered on this desk's encoder, one after another, and say how it went. */
export async function finishKeys(propertyId: number, keys: Array<{ room: string | null; key: KeyAnswer | undefined | null }>): Promise<void> {
  for (const { room, key } of keys) {
    if (!key) continue;
    try {
      const out = await finishKey(propertyId, key);
      if (out.ran || key.mode === 'encoder') toast(out.ok ? 'success' : 'error', `${room ? `Room ${room}: ` : ''}${out.message}`);
      if (out.secret) toast('info', `${room ? `Room ${room} — ` : ''}passcode: ${out.secret.replace(/\n/g, '; ')}`);
    } catch (e) {
      toast('error', errorText(e, 'The key was not reported to WorkSuite.'));
    }
  }
}
