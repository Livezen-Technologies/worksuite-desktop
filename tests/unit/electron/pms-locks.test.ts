import http from 'node:http';
import net from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({ BrowserWindow: class {}, safeStorage: {} }));

import { type KeyPayload, type LockServer, isLocalHost, keyPayloadSchema, lockServerProblem } from '@shared/pms-locks';
import { ACK, ENQ, ETX, NAK, STX, frame, lrc, parse } from '../../../electron/services/pms-locks/frame';
import { PmsLocks } from '../../../electron/services/pms-locks';
import { SHIP_SEPARATOR } from '../../../electron/services/pms-locks/salto';

/**
 * The desk's half of door locks, against fake lock servers on 127.0.0.1: SHIP and Saflok frames (STX … ETX LRC,
 * ACK / NAK), Visionline's session and signed card request, Vostio's and Ambiance's bearer key. The payloads are the
 * shapes WorkSuite's `Locks/*.php` build (PmsDoorLocksTest holds the server's half). No real vendor is reached.
 */

const servers: Array<net.Server | http.Server> = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => new Promise<void>((r) => s.close(() => r()))));
});

function listen(s: net.Server | http.Server): Promise<number> {
  servers.push(s);
  return new Promise((resolve) => s.listen(0, '127.0.0.1', () => resolve((s.address() as net.AddressInfo).port)));
}

/** A framed-link lock server: answers each frame with ACK and whatever `reply` builds. */
async function tcpServer(separator: string, reply: (command: string, fields: string[]) => Buffer | 'nak' | null, seen: Array<{ command: string; fields: string[] }> = []) {
  const port = await listen(
    net.createServer((sock) => {
      let buf: Buffer = Buffer.alloc(0);
      sock.on('data', (c: Buffer) => {
        if (c.length === 1 && c[0] === ENQ) return void sock.write(Buffer.from([ACK]));
        buf = Buffer.concat([buf, c]);
        const p = parse(buf, separator);
        if (!p.frame) return;
        buf = Buffer.from(p.rest);
        seen.push({ command: p.frame.command, fields: p.frame.fields });
        const r = reply(p.frame.command, p.frame.fields);
        if (r === 'nak') return void sock.write(Buffer.from([NAK]));
        sock.write(Buffer.from([ACK]));
        if (r) sock.write(r);
      });
    }),
  );
  return port;
}

function store() {
  const m = new Map<string, unknown>();
  const secrets = new Map<string, string>();
  return {
    config: { getConfig: <T>(k: string) => m.get(k) as T | undefined, setConfig: (k: string, v: unknown) => void m.set(k, JSON.parse(JSON.stringify(v))), deleteConfig: (k: string) => void m.delete(k) },
    secrets: {
      get: (k: string) => secrets.get(k) ?? null,
      set: (k: string, v: string) => void secrets.set(k, v),
      delete: (k: string) => void secrets.delete(k),
      deletePrefix: (p: string) => [...secrets.keys()].filter((k) => k.startsWith(p)).map((k) => secrets.delete(k)).length,
      getStatus: () => ({ available: true, backend: 'test', persistent: true }),
    },
    m,
    kept: secrets,
  };
}

function locks(allowed = true) {
  const s = store();
  const svc = new PmsLocks({ config: s.config, secrets: s.secrets, origin: () => 'https://ws.example', allowed: () => allowed });
  return { svc, ...s };
}

function payload(over: Partial<KeyPayload> & Pick<KeyPayload, 'vendor' | 'connection' | 'vendor_fields'>): KeyPayload {
  return keyPayloadSchema.parse({
    v: 1,
    log_id: 41,
    operation: 'issue',
    property_id: 7,
    stay_id: 12,
    rooms: ['R101'],
    room_numbers: ['101'],
    common_areas: ['P'],
    valid_from: '2026-09-18 14:05',
    valid_until: '2026-09-21 12:00',
    timezone: 'Asia/Colombo',
    guest_name: 'Dilani Fernando',
    cards: 2,
    kind: 'new',
    operator: 'Kasun Silva',
    issued_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + 15 * 60_000).toISOString(),
    ...over,
  });
}

const salto = (port: number): LockServer => ({ vendor: 'salto', connection: 'ship', host: '127.0.0.1', port, tls: false, encoder: 'ENC1', timeoutMs: 3000 });

describe('the framed link', () => {
  it('frames STX command SEP fields ETX LRC and reads it back', () => {
    const f = frame('CN', ['ENC1', '2', '101'], SHIP_SEPARATOR);
    expect(f[0]).toBe(STX);
    expect(f[f.length - 2]).toBe(ETX);
    expect(f[f.length - 1]).toBe(lrc(f.subarray(1, f.length - 1)));
    expect(f.subarray(1, f.length - 2).toString('latin1')).toBe('CN³ENC1³2³101');
    expect(f.includes(0xb3)).toBe(true);
    const p = parse(Buffer.concat([Buffer.from([ACK]), f]), SHIP_SEPARATOR);
    expect(p.acks).toEqual([ACK]);
    expect(p.frame).toEqual({ command: 'CN', fields: ['ENC1', '2', '101'], lrcOk: true });
    const bad = Buffer.from(f);
    bad[bad.length - 1] = (bad[bad.length - 1] ?? 0) ^ 0xff;
    expect(parse(bad, SHIP_SEPARATOR).frame?.lrcOk).toBe(false);
  });

  it('allows a plain link only to the hotel’s own network', () => {
    expect(isLocalHost('192.168.1.20')).toBe(true);
    expect(isLocalHost('10.0.0.5')).toBe(true);
    expect(isLocalHost('salto.local')).toBe(true);
    expect(isLocalHost('8.8.8.8')).toBe(false);
    expect(lockServerProblem({ ...salto(1), host: 'locks.example.com' })).toMatch(/needs TLS/);
    expect(lockServerProblem({ ...salto(1), host: 'locks.example.com', tls: true })).toBeNull();
    expect(lockServerProblem({ ...salto(1), connection: 'visionline' })).toMatch(/not reached/);
  });
});

describe('Salto over SHIP', () => {
  it('fills in the desk’s encoder, sends the server’s fields and takes the echoed answer as done', async () => {
    const seen: Array<{ command: string; fields: string[] }> = [];
    const port = await tcpServer(SHIP_SEPARATOR, (c, f) => frame(c, [f[0] ?? '', '0'], SHIP_SEPARATOR), seen);
    const { svc } = locks();
    svc.set({ propertyId: 7, server: salto(port) });

    const fields = ['{encoder}', '2', 'R101', '', '', '', 'P', '', '1405180926', '1200210926', 'Kasun Silva', 'Dilani Fernando'];
    const out = await svc.run(7, payload({ vendor: 'salto', connection: 'ship', vendor_fields: { protocol: 'ship', command: 'CN', fields } }));

    expect(out).toMatchObject({ ok: true, message: 'Card encoded', card: { rooms: ['101'], valid_until: '2026-09-21 12:00', cards: 2 }, encoder: 'ENC1 on 127.0.0.1' });
    expect(seen).toEqual([{ command: 'CN', fields: ['ENC1', ...fields.slice(1)] }]);
  });

  it('reads a card, reports a refusal in the server’s words, and a NAK', async () => {
    const port = await tcpServer(SHIP_SEPARATOR, (c) =>
      c === 'LT' ? frame('LT', ['ENC1', '101', '', '', '', '1405180926', '1200210926'], SHIP_SEPARATOR) : c === 'CC' ? frame('ES', ['04', 'No card'], SHIP_SEPARATOR) : 'nak',
    );
    const { svc } = locks();
    svc.set({ propertyId: 7, server: salto(port) });

    const read = await svc.run(7, payload({ vendor: 'salto', connection: 'ship', operation: 'read', vendor_fields: { protocol: 'ship', command: 'LT', fields: ['{encoder}'] } }));
    expect(read).toMatchObject({ ok: true, card: { rooms: ['101'], valid_until: '2026-09-21 12:00' } });

    const copy = await svc.run(7, payload({ vendor: 'salto', connection: 'ship', kind: 'duplicate', operation: 'duplicate', vendor_fields: { protocol: 'ship', command: 'CC', fields: ['{encoder}', '1', 'R101'] } }));
    expect(copy).toMatchObject({ ok: false, message: 'The Salto server refused it (ES: 04 No card).' });

    const out = await svc.run(7, payload({ vendor: 'salto', connection: 'ship', operation: 'cancel', vendor_fields: { protocol: 'ship', command: 'CO', fields: ['{encoder}', 'R101'] } }));
    expect(out).toMatchObject({ ok: false, message: 'The lock server refused the request (NAK).' });
  });

  it('tests the link with ENQ, and says so when nothing listens', async () => {
    const port = await tcpServer(SHIP_SEPARATOR, () => null);
    const { svc } = locks();
    svc.set({ propertyId: 7, server: salto(port) });
    expect(await svc.test(7)).toMatchObject({ ok: true, message: `The Salto server at 127.0.0.1:${port} answered.` });

    svc.set({ propertyId: 8, server: salto(1) });
    const down = await svc.test(8);
    expect(down.ok).toBe(false);
    expect(down.message).toMatch(/could not be reached/);
  });
});

describe('dormakaba', () => {
  it('Saflok: frames with "|", takes status 0 as done and reads the card', async () => {
    const seen: Array<{ command: string; fields: string[] }> = [];
    const port = await tcpServer('|', (c) => (c === 'KR' ? frame('KR', ['0', '101+102', '202609211200', 'SN-77'], '|') : c === 'KD' ? frame('KD', ['3', 'Encoder busy'], '|') : frame(c, ['0'], '|')), seen);
    const { svc } = locks();
    svc.set({ propertyId: 7, server: { vendor: 'dormakaba', connection: 'saflok', host: '127.0.0.1', port, tls: false, encoder: 'E2', timeoutMs: 3000 } });

    const issue = await svc.run(7, payload({ vendor: 'dormakaba', connection: 'saflok', vendor_fields: { protocol: 'saflok', command: 'KN', fields: ['{encoder}', '101', '2', '202609181405', '202609211200', 'POOL', 'Dilani Fernando', 'Kasun Silva'] } }));
    expect(issue.ok).toBe(true);
    expect(seen[0]).toEqual({ command: 'KN', fields: ['E2', '101', '2', '202609181405', '202609211200', 'POOL', 'Dilani Fernando', 'Kasun Silva'] });

    const dup = await svc.run(7, payload({ vendor: 'dormakaba', connection: 'saflok', operation: 'duplicate', kind: 'duplicate', vendor_fields: { protocol: 'saflok', command: 'KD', fields: ['{encoder}'] } }));
    expect(dup).toMatchObject({ ok: false, message: 'The Saflok server refused it: Encoder busy' });

    const read = await svc.run(7, payload({ vendor: 'dormakaba', connection: 'saflok', operation: 'read', vendor_fields: { protocol: 'saflok', command: 'KR', fields: ['{encoder}'] } }));
    expect(read.card).toEqual({ rooms: ['101', '102'], valid_until: '2026-09-21 12:00', serial: 'SN-77' });
  });

  it('Ambiance: sends the API key from the keystore as a bearer token', async () => {
    const got: Array<{ url?: string; auth?: string; body: unknown }> = [];
    const port = await listen(
      http.createServer((req, res) => {
        let b = '';
        req.on('data', (c: Buffer) => (b += c.toString()));
        req.on('end', () => {
          got.push({ url: req.url, auth: req.headers.authorization, body: b ? JSON.parse(b) : null });
          res.writeHead(req.headers.authorization === 'Bearer amb-key' ? 200 : 401, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true }));
        });
      }),
    );
    const { svc } = locks();
    svc.set({ propertyId: 7, server: { vendor: 'dormakaba', connection: 'ambiance', host: '127.0.0.1', port, tls: false, encoder: 'AMB-1' } });
    const fields = { protocol: 'ambiance' as const, method: 'POST' as const, path: '/api/pms/keys', body: { encoder: '{encoder}', rooms: ['101'], keyCount: 2, new: true } };

    expect(await svc.run(7, payload({ vendor: 'dormakaba', connection: 'ambiance', vendor_fields: fields }))).toMatchObject({ ok: false, message: expect.stringMatching(/API key/) });

    svc.set({ propertyId: 7, server: { vendor: 'dormakaba', connection: 'ambiance', host: '127.0.0.1', port, tls: false, encoder: 'AMB-1' }, secret: 'amb-key' });
    expect((await svc.run(7, payload({ vendor: 'dormakaba', connection: 'ambiance', vendor_fields: fields }))).ok).toBe(true);
    expect(got[0]).toEqual({ url: '/api/pms/keys', auth: 'Bearer amb-key', body: { encoder: 'AMB-1', rooms: ['101'], keyCount: 2, new: true } });
  });
});

describe('Vingcard', () => {
  it('Visionline: opens a session with the interface user and signs the card request', async () => {
    const got: Array<{ url?: string; headers: http.IncomingHttpHeaders; body: unknown }> = [];
    const port = await listen(
      http.createServer((req, res) => {
        let b = '';
        req.on('data', (c: Buffer) => (b += c.toString()));
        req.on('end', () => {
          const body = b ? JSON.parse(b) : null;
          got.push({ url: req.url, headers: req.headers, body });
          res.writeHead(req.url === '/api/v1/sessions' && body?.password !== 'vl-pass' ? 401 : 200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(req.url === '/api/v1/sessions' ? { id: 'S1', accessKey: 'K1' } : { doors: ['101'] }));
        });
      }),
    );
    const { svc, kept } = locks();
    svc.set({ propertyId: 7, server: { vendor: 'vingcard', connection: 'visionline', host: '127.0.0.1', port, tls: false, encoder: 'EP-3', username: 'pms' }, secret: 'vl-pass' });
    const out = await svc.run(7, payload({
      vendor: 'vingcard',
      connection: 'visionline',
      vendor_fields: { protocol: 'visionline', method: 'POST', path: '/api/v1/cards?action=encode', body: { endPointID: '{encoder}', cardOperation: 'EncodeNewCard', doorOperations: [{ operation: 'guest', doors: ['101'] }] } },
    }));

    expect(out.ok).toBe(true);
    expect(got.map((g) => g.url)).toEqual(['/api/v1/sessions', '/api/v1/cards?action=encode']);
    expect(got[0]?.body).toEqual({ username: 'pms', password: 'vl-pass' });
    expect(got[1]?.headers.authorization).toMatch(/^AWS S1:[A-Za-z0-9+/=]{28}$/);
    expect(got[1]?.headers['content-md5']).toBeTruthy();
    expect(got[1]?.body).toMatchObject({ endPointID: 'EP-3' });
    expect(JSON.stringify(svc.view(7))).not.toContain('vl-pass');
    expect([...kept.keys()]).toEqual(['pmsLocks:https://ws.example#7']);
  });
});

describe('what the desk will run', () => {
  it('refuses a payload for another property, vendor or link, or an old one, and without Hotel PMS', async () => {
    const port = await tcpServer(SHIP_SEPARATOR, (c) => frame(c, ['0'], SHIP_SEPARATOR));
    const { svc } = locks();
    svc.set({ propertyId: 7, server: salto(port) });
    const ship = { protocol: 'ship' as const, command: 'CN' as const, fields: ['{encoder}'] };

    await expect(svc.run(7, payload({ vendor: 'salto', connection: 'ship', property_id: 9, vendor_fields: ship }))).rejects.toThrow(/another property/);
    expect((await svc.run(7, payload({ vendor: 'dormakaba', connection: 'saflok', vendor_fields: { protocol: 'saflok', command: 'KN', fields: [] } }))).message).toMatch(/this desk is set up for Salto/);
    expect((await svc.run(7, payload({ vendor: 'salto', connection: 'ship', expires_at: '2026-01-01T00:00:00Z', vendor_fields: ship }))).message).toMatch(/too old/);
    expect((await svc.run(8, payload({ vendor: 'salto', connection: 'ship', property_id: 8, vendor_fields: ship }))).message).toMatch(/no door-lock server/);
    expect(() => keyPayloadSchema.parse({ ...payload({ vendor: 'salto', connection: 'ship', vendor_fields: ship }), vendor_fields: { protocol: 'ship', command: 'XX', fields: [] } })).toThrow();
    expect(() => keyPayloadSchema.parse({ ...payload({ vendor: 'salto', connection: 'ship', vendor_fields: ship }), vendor_fields: { protocol: 'ship', command: 'CN', fields: ['\u0002'] } })).toThrow();

    const other = locks(false);
    expect(() => other.svc.view(7)).toThrow(/access to Hotel PMS/);
    expect(() => svc.set({ propertyId: 7, server: { ...salto(port), host: 'locks.example.com' } })).toThrow(/needs TLS/);
    expect(svc.status()).toEqual({ properties: [7] });
    svc.forget(7);
    expect(svc.view(7)).toBeNull();
  });
});
