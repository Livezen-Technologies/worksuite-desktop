import type { KeyPayload, LockOutcome, LockServer } from '@shared/pms-locks';
import { frame } from './frame';
import { exchange, httpJson } from './link';
import { type Runner, clip, fillEncoder, fromCompact, what, writtenCard } from './runner';

/**
 * dormakaba: the Saflok PMS interface (framed ASCII over TCP, fields joined by "|") or Ambiance's web interface
 * (JSON over HTTPS with the interface's API key as a bearer token, from this computer's keystore).
 *
 * Saflok answers `command|status|…`: status "0" is done, anything else a refusal with its text; a read (`KR`)
 * answers `KR|0|rooms joined by +|end yyyyMMddHHmm|serial`. Ambiance answers 2xx with JSON, or an error with
 * `message`. Both are dormakaba partner interfaces: the layout here **must be confirmed against dormakaba's
 * interface specification during certification**.
 */
export const dormakaba: Runner = {
  async run(server: LockServer, secret: string | null, p: KeyPayload): Promise<LockOutcome> {
    const vf = p.vendor_fields;
    if (vf.protocol === 'saflok') {
      const answer = await exchange(server, frame(vf.command, fillEncoder(vf.fields, server.encoder), '|'), '|');
      if (answer === 'ack') return { ok: true, message: what(p) };
      if (answer.command !== vf.command || answer.fields[0] !== '0') {
        return { ok: false, message: `The Saflok server refused it: ${clip(answer.fields.slice(1).join(' ') || answer.fields[0] || answer.command)}` };
      }
      if (vf.command === 'KR') {
        const rooms = (answer.fields[1] ?? '').split('+').filter(Boolean);
        return { ok: true, message: rooms.length ? `Card for room ${rooms.join(', ')}.` : 'A card with no guest room.', card: { rooms, valid_until: fromCompact(answer.fields[2]), serial: clip(answer.fields[3], 40) || undefined } };
      }
      return { ok: true, message: what(p), card: writtenCard(p) };
    }
    if (vf.protocol !== 'ambiance') return { ok: false, message: 'This payload is not for dormakaba.' };
    if (!secret) return { ok: false, message: 'Give this desk the Ambiance interface’s API key first (Desk devices → Door-lock server).' };
    const r = await httpJson(server, vf.method, vf.path, fillEncoder(vf.body, server.encoder), { Authorization: `Bearer ${secret}` });
    const j = (r.json ?? {}) as Record<string, unknown>;
    if (r.status < 200 || r.status >= 300) return { ok: false, message: `Ambiance refused it (HTTP ${r.status}): ${clip(j.message ?? j.error ?? '')}` };
    if (p.operation === 'read') {
      const rooms = Array.isArray(j.rooms) ? j.rooms.map((x) => clip(x, 20)) : [];
      return { ok: true, message: rooms.length ? `Card for room ${rooms.join(', ')}.` : 'A card with no guest room.', card: { rooms, valid_until: clip(j.checkOut, 20) || undefined, serial: clip(j.serial, 40) || undefined } };
    }
    return { ok: true, message: what(p), card: writtenCard(p) };
  },

  async test(server: LockServer, secret: string | null): Promise<LockOutcome> {
    const started = Date.now();
    if (server.connection === 'saflok') {
      const a = await exchange(server, frame('KT', [], '|'), '|');
      const ok = a === 'ack' || a.fields[0] === '0';
      return { ok, message: ok ? `The Saflok server at ${server.host}:${server.port} answered.` : 'The Saflok server answered with an error.', ms: Date.now() - started };
    }
    if (!secret) return { ok: false, message: 'Give this desk the Ambiance interface’s API key first.' };
    const r = await httpJson(server, 'GET', '/api/pms/status', null, { Authorization: `Bearer ${secret}` });
    const ok = r.status >= 200 && r.status < 300;
    return { ok, message: ok ? `Ambiance at ${server.host} answered.` : `Ambiance answered HTTP ${r.status}${r.status === 401 ? ' — check the API key' : ''}.`, ms: Date.now() - started };
  },
};
