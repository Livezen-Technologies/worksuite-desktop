import { createHmac } from 'node:crypto';
import type { KeyPayload, LockOutcome, LockServer } from '@shared/pms-locks';
import { type HttpAnswer, httpJson, md5Base64 } from './link';
import { type Runner, clip, fillEncoder, what, writtenCard } from './runner';

/**
 * ASSA ABLOY Vingcard: Visionline's web interface on the hotel's server, or Vostio's API.
 *
 * Visionline: a session (`POST /api/v1/sessions` with the interface user and password from this computer's
 * keystore) answers an id and an access key; each request is then signed — `Authorization: AWS <id>:<signature>`,
 * the signature an HMAC-SHA1 with the access key over method, Content-MD5, Content-Type, Date and path, base64 —
 * and the card operation is WorkSuite's (`Locks/Vingcard.php`). Vostio: the API key as a bearer token.
 *
 * Both are ASSA ABLOY partner interfaces: the session, signing and field names here follow the vendor's published
 * outline and **must be confirmed against the Visionline / Vostio integration guide under the partner agreement**.
 */
function sign(key: string, method: string, md5: string, type: string, date: string, path: string): string {
  return createHmac('sha1', key).update([method, md5, type, date, path].join('\n')).digest('base64');
}

async function visionline(server: LockServer, secret: string | null, method: 'GET' | 'POST', path: string, body: unknown): Promise<HttpAnswer> {
  if (!server.username || !secret) throw new Error('Give this desk the Visionline interface user and password first (Desk devices → Door-lock server).');
  const s = await httpJson(server, 'POST', '/api/v1/sessions', { username: server.username, password: secret });
  const sj = (s.json ?? {}) as Record<string, unknown>;
  if (s.status < 200 || s.status >= 300 || typeof sj.id !== 'string' || typeof sj.accessKey !== 'string') {
    return { status: s.status === 200 ? 401 : s.status, json: { message: 'Visionline did not open a session — check the interface user and password.' } };
  }
  const text = body === null || body === undefined ? '' : JSON.stringify(body);
  const md5 = text ? md5Base64(text) : '';
  const type = text ? 'application/json' : '';
  const date = new Date().toUTCString();
  return httpJson(server, method, path, body, { Date: date, ...(md5 ? { 'Content-MD5': md5 } : {}), Authorization: `AWS ${sj.id}:${sign(sj.accessKey, method, md5, type, date, path)}` });
}

function doorsOf(j: Record<string, unknown>): string[] {
  if (Array.isArray(j.doors)) return j.doors.map((d) => clip(d, 20));
  const ops = Array.isArray(j.doorOperations) ? (j.doorOperations as Array<Record<string, unknown>>) : [];
  return ops.flatMap((o) => (Array.isArray(o.doors) ? o.doors.map((d) => clip(d, 20)) : []));
}

export const vingcard: Runner = {
  async run(server: LockServer, secret: string | null, p: KeyPayload): Promise<LockOutcome> {
    const vf = p.vendor_fields;
    if (vf.protocol !== 'visionline' && vf.protocol !== 'vostio') return { ok: false, message: 'This payload is not for Vingcard.' };
    const body = fillEncoder(vf.body, server.encoder);
    let r: HttpAnswer;
    if (vf.protocol === 'visionline') r = await visionline(server, secret, vf.method, vf.path, body);
    else {
      if (!secret) return { ok: false, message: 'Give this desk the Vostio API key first (Desk devices → Door-lock server).' };
      r = await httpJson(server, vf.method, vf.path, body, { Authorization: `Bearer ${secret}` });
    }
    const j = (r.json ?? {}) as Record<string, unknown>;
    if (r.status < 200 || r.status >= 300) return { ok: false, message: `${vf.protocol === 'vostio' ? 'Vostio' : 'Visionline'} refused it (HTTP ${r.status}): ${clip(j.message ?? j.error ?? '')}` };
    if (p.operation === 'read') {
      const rooms = doorsOf(j);
      return { ok: true, message: rooms.length ? `Card for room ${rooms.join(', ')}.` : 'A card with no guest room.', card: { rooms, valid_until: clip(j.expireTime, 20) || undefined, serial: clip(j.serialNumber ?? j.cardSerial, 40) || undefined } };
    }
    return { ok: true, message: what(p), card: writtenCard(p) };
  },

  async test(server: LockServer, secret: string | null): Promise<LockOutcome> {
    const started = Date.now();
    const r = server.connection === 'vostio' ? (secret ? await httpJson(server, 'GET', '/api/v1/status', null, { Authorization: `Bearer ${secret}` }) : null) : await visionline(server, secret, 'GET', '/api/v1/sessions/current', null);
    if (!r) return { ok: false, message: 'Give this desk the Vostio API key first.' };
    const ok = r.status >= 200 && r.status < 300;
    const j = (r.json ?? {}) as Record<string, unknown>;
    return { ok, message: ok ? `${server.connection === 'vostio' ? 'Vostio' : 'Visionline'} at ${server.host} answered.` : `It answered HTTP ${r.status}: ${clip(j.message ?? '')}`, ms: Date.now() - started };
  },
};
