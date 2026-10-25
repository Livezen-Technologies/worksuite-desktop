import { createPrivateKey, createPublicKey, generateKeyPairSync, sign, verify, type KeyObject } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({ BrowserWindow: class {}, net: { fetch: vi.fn() }, app: { getPath: () => '/tmp', isPackaged: false } }));

import { canonicalJson } from '@shared/canonical-json';
import { gatewayOrigin, normalisePairingCode } from '@shared/label';
import { CorePrintService, type ClaimedJob, type HostTransport, type PrintTarget } from '../../../electron/services/label/core-print';
import { checkEnvelope, sha256Hex } from '../../../electron/services/label/envelope';
import { PrintGateway, tokenMessage, type DeviceSecrets } from '../../../electron/services/label/gateway';
import { guessLanguage } from '../../../electron/services/label/host';
import { parseZebraStatus } from '../../../electron/services/label/raw-out';

const NOW = Date.parse('2026-10-25T05:00:00Z');
const { publicKey, privateKey } = generateKeyPairSync('ed25519');
const PUB = Buffer.from(publicKey.export({ format: 'jwk' }).x!, 'base64url').toString('base64');
const KEYS = { 'lbl-2026-10': PUB };

function envelope(job: string, chunk: number, printer: string | number, payload: Buffer, over: Record<string, unknown> = {}, key: KeyObject = privateKey) {
  const e = { job, chunk, printer, org: 12, expires: '2026-10-25T05:20:00Z', manifest_sha256: 'a'.repeat(64), payload_sha256: sha256Hex(payload), key_id: 'lbl-2026-10', ...over };
  return { ...e, sig: `ed25519:${sign(null, Buffer.from(canonicalJson(e)), key).toString('base64')}` };
}

describe('the signed envelope (§14.4, FR-GWY-04)', () => {
  const payload = Buffer.from('^XA^FDLBL-0001^FS^XZ');
  const expect1 = { job: 'LJ-1', chunk: 0, printer: 'prn_1', org: 12 };
  it('accepts a good one', () => {
    expect(checkEnvelope(envelope('LJ-1', 0, 'prn_1', payload), payload, expect1, KEYS, NOW)).toEqual({ ok: true });
  });
  it('refuses unsigned, foreign-key, tampered, expired, other printer and other company', () => {
    const good = envelope('LJ-1', 0, 'prn_1', payload);
    expect(checkEnvelope({ ...good, sig: undefined }, payload, expect1, KEYS, NOW).ok).toBe(false);
    expect(checkEnvelope(envelope('LJ-1', 0, 'prn_1', payload, {}, generateKeyPairSync('ed25519').privateKey), payload, expect1, KEYS, NOW).ok).toBe(false);
    expect(checkEnvelope(good, Buffer.from('^XA^FDOTHER^FS^XZ'), expect1, KEYS, NOW).ok).toBe(false);
    expect(checkEnvelope({ ...good, printer: 'prn_2' }, payload, expect1, KEYS, NOW).ok).toBe(false);
    expect(checkEnvelope(good, payload, expect1, KEYS, Date.parse('2026-10-25T06:00:00Z')).ok).toBe(false);
    expect(checkEnvelope(envelope('LJ-1', 0, 'prn_2', payload), payload, expect1, KEYS, NOW).ok).toBe(false);
    expect(checkEnvelope(envelope('LJ-1', 0, 'prn_1', payload, { org: 13 }), payload, expect1, KEYS, NOW).ok).toBe(false);
    expect(checkEnvelope({ ...good, key_id: 'other' }, payload, expect1, KEYS, NOW).ok).toBe(false);
  });
});

const TARGET: PrintTarget = { key: 'tcp:10.0.0.5:9100', connection: 'tcp', address: '10.0.0.5', port: 9100, language: 'zpl' };

/** A claim as Queue::claim answers it: 5 labels in chunks of 1. */
function job(over: Partial<ClaimedJob> = {}): ClaimedJob {
  return { job_id: 7, code: 'LJ-000007', attempt_id: 1, printer_id: 1, printer: { connection: { kind: 'ethernet', address: '10.0.0.5', port: 9100 }, language: 'zpl' }, labels_total: 5, labels_confirmed: 0, chunk_size: 1, chunks: 5, first_chunk: 0, ...over };
}

type Out = { ok: true } | { ok: false; reason: string; state: 'ribbon_out' | 'offline'; uncertain: boolean };

function host(o: { jobs?: () => ClaimedJob[]; send?: (b: Buffer) => Promise<Out>; status?: () => Promise<'ready' | 'paper_out'>; journal?: Record<string, unknown>; person?: boolean; now?: () => number } = {}) {
  let journal: Record<string, unknown> = o.journal ?? {};
  const sent: string[] = [];
  const progress: Array<{ confirmed: number; state: string; error?: string }> = [];
  let offered = false;
  const transport: HostTransport = {
    org: () => 12,
    keys: async () => KEYS,
    claim: async () => {
      if (o.jobs) return o.jobs();
      if (offered) return [];
      offered = true;
      return [job()];
    },
    chunk: async (id, n) => {
      const payload = Buffer.from(`^XA^FDLABEL-${n}^FS^XZ`);
      return { envelope: envelope('LJ-000007', n, 1, payload), payload_base64: payload.toString('base64'), labels: [{ seq_no: n + 1, item_id: 100 + n }] };
    },
    progress: async (_id, r) => {
      progress.push({ confirmed: r.labels_confirmed, state: r.state, error: r.error_code });
      return { instruction: null };
    },
    resume: vi.fn(async () => undefined),
    cancel: vi.fn(async () => undefined),
  };
  const core = new CorePrintService({
    transport,
    person: o.person ?? true,
    journal: { read: () => journal as never, write: (v) => void (journal = JSON.parse(JSON.stringify(v))) },
    target: (p) => (p.connection?.address === '10.0.0.5' ? TARGET : null),
    changed: () => undefined,
    send: async (_t, b) => {
      const r = o.send ? await o.send(b) : ({ ok: true } as const);
      if (r.ok) sent.push(b.toString());
      return r;
    },
    status: o.status ?? (async () => 'ready'),
    now: o.now ?? (() => NOW),
  });
  return { core, sent, progress, transport, journal: () => journal };
}

const labels = (...n: number[]) => n.map((i) => `^XA^FDLABEL-${i}^FS^XZ`);

describe('CorePrintService (FR-DSK-05/06, WF-07, C-08)', () => {
  it('prints every chunk once and reports each confirmed label', async () => {
    const h = host();
    await h.core.tick();
    expect(h.sent).toEqual(labels(0, 1, 2, 3, 4));
    expect(h.progress.map((p) => p.confirmed)).toEqual([1, 2, 3, 4, 5, 5]);
    expect(h.progress.at(-1)!.state).toBe('completed');
    expect(h.core.job('7')?.state).toBe('done');
  });

  it('starts at first_chunk and takes the larger of the server’s and the journal’s count', async () => {
    const h = host({ jobs: () => [job({ labels_confirmed: 3, first_chunk: 3 })] });
    await h.core.tick();
    expect(h.sent).toEqual(labels(3, 4));
    expect(h.progress.map((p) => p.confirmed)).toEqual([4, 5, 5]);
  });

  it('re-sends a count the server did not hear before printing on', async () => {
    const h = host({ jobs: () => [job({ attempt_id: 2, labels_confirmed: 2, first_chunk: 2 })], journal: { '7': { id: '7', confirmed: 3, state: 'waiting_printer', claim: null, inflight: null, uncertain: null, updatedAt: '2026-10-25T04:59:00Z' } } });
    await h.core.tick();
    expect(h.progress[0]).toMatchObject({ confirmed: 3, state: 'printing' });
  });

  it('holds a job while the printer reports paper out, then pauses it with nothing sent', async () => {
    let t = NOW;
    let ready = false;
    const h = host({ status: async () => (ready ? 'ready' : 'paper_out'), now: () => t });
    await h.core.tick();
    expect(h.sent).toHaveLength(0);
    expect(h.core.job('7')).toMatchObject({ state: 'waiting_printer', printerState: 'paper_out' });
    t += 3 * 60_000;
    await h.core.tick();
    expect(h.core.job('7')).toMatchObject({ state: 'paused' });
    expect(h.progress.at(-1)).toMatchObject({ state: 'paused', error: 'PAPER_OUT' });
    ready = true;
    await h.core.tick();
    expect(h.transport.resume).toHaveBeenCalledWith(7);
  });

  it('goes on by itself when the printer is ready again within the hold', async () => {
    let ready = false;
    const h = host({ status: async () => (ready ? 'ready' : 'paper_out') });
    await h.core.tick();
    ready = true;
    await h.core.tick();
    expect(h.sent).toEqual(labels(0, 1, 2, 3, 4));
    expect(h.core.job('7')?.state).toBe('done');
  });

  it('a spooler refusal pauses the job with nothing uncertain', async () => {
    let n = 0;
    const h = host({ send: async () => (++n === 3 ? { ok: false, reason: 'lp: printer stopped', state: 'offline', uncertain: false } : { ok: true }) });
    await h.core.tick();
    expect(h.core.job('7')).toMatchObject({ state: 'paused', confirmed: 2, uncertain: null });
    expect(h.progress.at(-1)).toMatchObject({ state: 'paused', confirmed: 2 });
  });

  it('a send cut off part-way stops the job with those labels uncertain, and waits for a person', async () => {
    let n = 0;
    const h = host({ send: async () => (++n === 2 ? { ok: false, reason: 'connection reset', state: 'offline', uncertain: true } : { ok: true }) });
    await h.core.tick();
    expect(h.core.job('7')).toMatchObject({ state: 'interrupted', confirmed: 1, uncertain: { from: 1, to: 2 } });
    expect(h.progress.at(-1)).toMatchObject({ state: 'stopped' });
  });

  it('a restart mid-send never resends the chunk that was going out; D05 decides', async () => {
    const claim = job({ labels_confirmed: 2, first_chunk: 2 });
    const h = host({ jobs: () => [], journal: { '7': { id: '7', printerId: '1', total: 5, confirmed: 2, state: 'printing', claim, inflight: { from: 2, to: 3, chunk: 2 }, uncertain: null, sequence: false, updatedAt: '2026-10-25T04:59:00Z' } } });
    await (h.core as unknown as { run(j: ClaimedJob): Promise<void> }).run(claim);
    expect(h.sent).toHaveLength(0);
    expect(h.core.job('7')).toMatchObject({ state: 'interrupted', uncertain: { from: 2, to: 3 } });
    await h.core.resolve('7', 'printed');
    expect(h.progress.find((p) => p.confirmed === 3)).toBeTruthy();
    expect(h.sent).toEqual(labels(3, 4));
  });

  it('a gateway (no person) reports a restart mid-send as stopped for the server to reconcile', async () => {
    const claim = job({ labels_confirmed: 2, first_chunk: 2 });
    const h = host({ person: false, jobs: () => [], journal: { '7': { id: '7', confirmed: 2, state: 'printing', claim, inflight: { from: 2, to: 3, chunk: 2 }, uncertain: null, updatedAt: '2026-10-25T04:59:00Z' } } });
    await (h.core as unknown as { run(j: ClaimedJob): Promise<void> }).run(claim);
    expect(h.sent).toHaveLength(0);
    expect(h.progress.at(-1)).toMatchObject({ state: 'stopped', error: 'HOST_RESTARTED' });
  });

  it('refuses a job for a printer this computer does not have', async () => {
    const h = host({ jobs: () => [job({ printer: { connection: { kind: 'ethernet', address: '10.9.9.9', port: 9100 } } })] });
    await h.core.tick();
    expect(h.core.job('7')).toMatchObject({ state: 'failed' });
    expect(h.progress.at(-1)).toMatchObject({ state: 'failed', error: 'PRINTER_NOT_HERE' });
    expect(h.sent).toHaveLength(0);
  });
});

describe('small pieces', () => {
  it('reads a Zebra ~HS status', () => {
    const s1 = '\x02030,0,0,1245,000,0,0,0,000,0,0,0\x03\r\n';
    const s2 = (head: string, ribbon: string) => `\x02001,0,${head},${ribbon},1,2,6,0,00000000,1,000\x03\r\n`;
    const s3 = '\x021234,0\x03\r\n';
    expect(parseZebraStatus(s1 + s2('0', '0') + s3)).toBe('ready');
    expect(parseZebraStatus(s1.replace('030,0', '030,1') + s2('0', '0') + s3)).toBe('paper_out');
    expect(parseZebraStatus(s1 + s2('1', '0') + s3)).toBe('head_open');
    expect(parseZebraStatus(s1 + s2('0', '1') + s3)).toBe('ribbon_out');
    expect(parseZebraStatus(null)).toBe('offline');
  });
  it('normalises pairing codes and addresses', () => {
    expect(normalisePairingCode('pg 82kd 91ax')).toBe('PG-82KD-91AX');
    expect(normalisePairingCode('82KD91AX')).toBe('PG-82KD-91AX');
    expect(normalisePairingCode('PG-82')).toBeNull();
    expect(gatewayOrigin('company.worksuitecloud.com/label')).toBe('https://company.worksuitecloud.com');
    expect(gatewayOrigin('http://example.com')).toBeNull();
    expect(gatewayOrigin('http://localhost:8080')).toBe('http://localhost:8080');
  });
  it('guesses a queue’s language from its name', () => {
    expect(guessLanguage('Zebra ZD421')).toBe('zpl');
    expect(guessLanguage('TSC TE244')).toBe('tspl');
    expect(guessLanguage('Brother QL-820NWB')).toBe('escp');
    expect(guessLanguage('HP LaserJet')).toBe('unknown');
  });
});

describe('PrintGateway (FR-GWY-02, 04, 06)', () => {
  function gw(answers: Record<string, (body: unknown) => { status: number; json: unknown }>) {
    const cfg = new Map<string, unknown>();
    const store = new Map<string, string>();
    const secrets: DeviceSecrets = { get: (n) => store.get(n) ?? null, set: (n, v) => void store.set(n, v), delete: (n) => void store.delete(n), where: () => 'os' };
    const calls: Array<{ url: string; body: Record<string, unknown> | undefined; auth: string | null }> = [];
    const fetch = vi.fn(async (url: string, init: RequestInit) => {
      const body = init.body ? JSON.parse(String(init.body)) : undefined;
      calls.push({ url, body, auth: (init.headers as Record<string, string>).Authorization ?? null });
      const k = Object.keys(answers).find((p) => url.endsWith(p));
      const r = k ? answers[k]!(body) : { status: 404, json: { status: 'error', message: 'no', errors: { code: 'NOT_FOUND' } } };
      return new Response(JSON.stringify(r.json), { status: r.status, headers: { 'content-type': 'application/json' } });
    });
    const g = new PrintGateway({
      config: { getConfig: <T>(k: string) => cfg.get(k) as T | undefined, setConfig: (k, v) => void cfg.set(k, v), deleteConfig: (k) => void cfg.delete(k) },
      secrets,
      fetch,
      localPrinters: async () => [{ key: 'tcp:10.0.0.5:9100', name: 'Zebra ZD421', connection: 'tcp', address: '10.0.0.5', port: 9100, language: 'zpl', isDefault: false, serverId: null, approved: false, state: 'unknown', stateAt: null, message: null }],
      version: '0.2.0',
      headless: true,
      changed: () => undefined,
    });
    return { g, calls, store };
  }
  const paired = () => ({ status: 200, json: { status: 'success', data: { gateway_id: 3, token: 'lgt_1', expires_at: '2099-01-01 00:00:00', server_key: { key_id: 'lbl-2026-10', public_key: PUB }, heartbeat_sec: 30 } } });

  it('pairs with a URL and a one-time code, keeping its own key and no password', async () => {
    const { g, calls, store } = gw({
      '/api/label-gateways/pair': paired,
      '/api/label-gateways/3/printers': () => ({ status: 200, json: { status: 'success', data: { created: [{ id: 41, name: 'Zebra ZD421', connection: { kind: 'ethernet', address: '10.0.0.5', port: 9100 }, approved: false }], updated: [] } } }),
      '/api/label-gateways/3/heartbeat': () => ({ status: 200, json: { status: 'success', data: { ok: true, commands: [] } } }),
    });
    const s = await g.pair({ url: 'https://acme.example', code: 'pg-82kd-91ax', name: 'Warehouse' });
    g.stop();
    expect(calls[0]!.body).toMatchObject({ code: 'PG-82KD-91AX', public_key: expect.any(String) });
    expect(Buffer.from(String(calls[0]!.body!.public_key), 'base64')).toHaveLength(32);
    expect(JSON.stringify(calls[0]!.body)).not.toMatch(/password/i);
    expect(store.get('label-gateway:device-key')).toMatch(/BEGIN PRIVATE KEY/);
    expect(calls[1]!.auth).toBe('Bearer lgt_1');
    expect(calls[1]!.body).toMatchObject({ discovered: [{ connection: { kind: 'ethernet', address: '10.0.0.5', port: 9100 } }] });
    expect(s).toMatchObject({ paired: true, gatewayId: '3', keyStore: 'os', printers: [{ id: '41', key: 'tcp:10.0.0.5:9100', approved: false }] });
  });

  it('gets a new token by signing the server’s token message with its device key', async () => {
    let signed: Record<string, unknown> | null = null;
    const { g, store } = gw({
      '/api/label-gateways/pair': () => ({ status: 200, json: { data: { gateway_id: 3, token: 'lgt_1', expires_at: '2000-01-01 00:00:00', server_key: { key_id: 'k', public_key: PUB } } } }),
      '/api/label-gateways/3/token': (b) => ((signed = b as Record<string, unknown>), { status: 200, json: { data: { token: 'lgt_2', expires_at: '2099-01-01 00:00:00' } } }),
      '/api/label-gateways/3/printers': () => ({ status: 200, json: { data: { created: [] } } }),
      '/api/label-gateways/3/heartbeat': () => ({ status: 200, json: { data: { ok: true } } }),
    });
    await g.pair({ url: 'https://acme.example', code: 'PG-82KD-91AX', name: 'x' });
    g.stop();
    const pem = store.get('label-gateway:device-key')!;
    const pub = createPublicKey(createPrivateKey(pem));
    const s = signed as unknown as { timestamp: number; nonce: string; signature: string };
    expect(verify(null, Buffer.from(tokenMessage(3, s.timestamp, s.nonce)), pub, Buffer.from(s.signature, 'base64'))).toBe(true);
    expect(s.nonce.length).toBeGreaterThanOrEqual(16);
  });

  it('refuses a malformed code or a plain-http address', async () => {
    const { g } = gw({});
    await expect(g.pair({ url: 'https://acme.example', code: 'nope', name: 'x' })).rejects.toThrow(/PG-/);
    await expect(g.pair({ url: 'http://acme.example', code: 'PG-82KD-91AX', name: 'x' })).rejects.toThrow(/https/);
  });

  it('forgets its key at once when revoked', async () => {
    const { g, store } = gw({
      '/api/label-gateways/pair': paired,
      '/api/label-gateways/3/printers': () => ({ status: 401, json: { status: 'error', message: 'This gateway was revoked.', errors: { code: 'GATEWAY_REVOKED' } } }),
    });
    const s = await g.pair({ url: 'https://acme.example', code: 'PG-82KD-91AX', name: 'x' });
    expect(store.size).toBe(0);
    expect(s.connection).toBe('revoked');
    expect(s.paired).toBe(false);
  });
});
