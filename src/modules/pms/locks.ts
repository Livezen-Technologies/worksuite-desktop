import type { KeyPayload, LockOutcome, LockServerView } from '@shared/pms-locks';
import { LOCK_CONNECTIONS, VENDOR_LABEL } from '@shared/pms-locks';
import { call, DesktopError, hasDesktop } from '../../core/bridge';
import { pGet, pPost, type KeyResult } from './api';
import { NO_DEVICE, registerDevice } from './devices';
import { deskName } from './money';

/**
 * Keys at this desk (PMS-KEY-002, PMS-DSK-002). WorkSuite's door-lock provider answers every key action: TTLock
 * is done by the server (a passcode or an app key comes back); Salto, Vingcard and dormakaba answer `pending` with
 * the encoder payload, which this desk sends to the on-site lock server through the main process
 * (`pmsLocks:run`) and reports back to WorkSuite (`POST keys/{log}/result`). A desk with no lock server for the
 * property leaves the job waiting, for a desk that has one.
 */

/** What WorkSuite answers for a key: `KeyResult` plus the job, the vendor's mode and, for an encoder, the payload. */
export interface KeyAnswer extends KeyResult {
  log_id?: number;
  mode?: 'server' | 'encoder' | 'manual';
  vendor?: string;
  payload?: KeyPayload;
  secret?: string;
  offer?: 'issue' | 'cancel';
}

export interface CommonArea {
  code: string;
  name: string;
  lock: string;
  default: boolean;
}

/** The property's lock system as WorkSuite describes it (`GET properties/{id}/door-locks`, no secrets). */
export interface DoorLocks {
  door_locks: {
    property_id: number;
    vendor: string;
    vendor_label: string;
    connection: string;
    mode: 'server' | 'encoder' | 'manual';
    enabled: boolean;
    default_cards: number;
    common_areas: CommonArea[];
    on_checkin: string;
    on_move: string;
    on_checkout: string;
  };
  max_cards: number;
}

export interface KeyLogRow {
  id: number;
  rooms: string;
  action: string;
  action_label: string;
  vendor: string;
  mode: string;
  status: string;
  status_label: string;
  cards: number;
  mobile: boolean;
  valid_until: string | null;
  common_areas: string[];
  message: string;
  encoder: string | null;
  created_by_name: string | null;
  created_at: string | null;
}

export const doorLocks = (propertyId: number, signal?: AbortSignal) => pGet<DoorLocks>(`/properties/${propertyId}/door-locks`, undefined, signal);

/** What became of a key at this desk. `ran`: the desk's lock server was asked. */
export interface KeyDone {
  ok: boolean;
  message: string;
  ran: boolean;
  /** Passcodes a cloud vendor made — shown once. */
  secret?: string;
  outcome?: LockOutcome;
  /** For a card read: the stay in the room the card opens. */
  stay?: { stay_id: number | null; room_number: string; guest_name: string | null; departure_date: string | null } | null;
}

/**
 * Finish a key WorkSuite answered: an encoder job runs on this desk's lock server and is reported back; anything
 * else is already done (or offered) and only said.
 */
export async function finishKey(propertyId: number, key: KeyAnswer): Promise<KeyDone> {
  if (key.mode !== 'encoder' || key.status !== 'pending' || !key.payload || !key.log_id) {
    return { ok: key.ok, message: key.message, ran: false, ...(key.secret ? { secret: key.secret } : {}) };
  }
  if (!hasDesktop()) return { ok: false, message: 'Encode the card at the front-desk computer.', ran: false };
  let out: LockOutcome;
  try {
    out = await call('pmsLocks:run', { propertyId, payload: key.payload });
  } catch (e) {
    out = { ok: false, message: e instanceof DesktopError ? e.message : 'The lock server was not reached.' };
  }
  if (out.skipped) return { ok: false, message: out.message, ran: false, outcome: out };
  const r = await pPost<{ stay?: KeyDone['stay'] }>(`/keys/${key.log_id}/result`, {
    ok: out.ok,
    message: out.message,
    encoder: `${deskName(null)} · ${out.encoder ?? ''}`.slice(0, 80),
    ...(out.card ? { card: out.card } : {}),
  });
  return { ok: out.ok, message: out.message, ran: true, outcome: out, stay: r.data.stay ?? null };
}

/** Read the card on this desk's encoder, and find whose it is. */
export async function readCard(propertyId: number): Promise<KeyDone> {
  const r = await pPost<{ key: KeyAnswer }>(`/properties/${propertyId}/keys/read`, {});
  return finishKey(propertyId, r.data.key);
}

export function lockServerLabel(s: LockServerView): string {
  const conn = (LOCK_CONNECTIONS[s.vendor] as Record<string, { label: string }>)[s.connection]?.label ?? s.connection;
  return `${VENDOR_LABEL[s.vendor]} — ${conn} at ${s.host}:${s.port}, encoder ${s.encoder}`;
}

/** This desk's lock server for the property, or null (also outside the desktop). */
export async function lockServer(propertyId: number): Promise<LockServerView | null> {
  if (!hasDesktop()) return null;
  try {
    return await call('pmsLocks:config', { propertyId });
  } catch {
    return null;
  }
}

let unregister: (() => void) | null = null;

/** The Devices panel's key encoder follows the property's lock server on this computer. */
export async function syncKeyEncoder(propertyId: number): Promise<LockServerView | null> {
  const s = await lockServer(propertyId);
  unregister?.();
  unregister = null;
  if (s) {
    unregister = registerDevice('key_encoder', {
      id: s.vendor,
      label: lockServerLabel(s),
      available: () => true,
      encode: async (job) => {
        if (!job.payload || !job.logId) return NO_DEVICE.key_encoder.encode(job);
        const done = await finishKey(propertyId, { ok: true, status: 'pending', message: '', mode: 'encoder', payload: job.payload as KeyPayload, log_id: job.logId });
        return { ok: done.ok, message: done.message };
      },
    });
  }
  return s;
}
