import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({ app: { getPath: () => '/tmp', getVersion: () => '0.1.0' }, safeStorage: {}, BrowserWindow: { getAllWindows: () => [] }, screen: {} }));

import { posContract, posDeskSchema, posPrintPatchSchema } from '@shared/pos';
import { POS_INVOKE_CHANNELS } from '@shared/ipc/pos-channels';
import { Database } from '../../../electron/services/db';
import type { DeviceAnswer, PosPairing } from '../../../electron/services/pos-desk';
import { PosDesk } from '../../../electron/services/pos-desk';
import { isDisplayWindow, touchOf } from '../../../electron/services/pos-display';
import { displayAnswerOf, mediaFor, PosDisplayMediaStore, SLIDE_MAX_BYTES, sniffImage } from '../../../electron/services/pos-display-media';
import { deskCall } from '../../../electron/services/pos-till';
import { Vault } from '../../../electron/services/vault';

/**
 * The customer display in the main process (worksuite-desktop#294): its promotions and the company's logo, read
 * through the till's door and kept sealed to show offline; the door's new calls; and the one channel, answered to the
 * customer display's own window.
 */

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(24, 1)]);
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(24, 2)]);

const pairing: PosPairing = {
  terminal: { id: 7, code: 'T1', name: 'Front', org_id: 3, org_name: 'Acme', branch_name: null, warehouse_id: null, warehouse_name: null },
  paired_at: '2026-10-01T00:00:00Z',
  prefix: 'T1-AAAAAA',
  state: 'paired',
  usable: true,
};

function store(o: { keep?: boolean; answer?: () => DeviceAnswer; pictures?: Record<string, Buffer | null> } = {}) {
  const db = new Database(':memory:');
  const vault = new Vault(Vault.generateKey());
  let answer: DeviceAnswer = o.answer?.() ?? {
    status: 200,
    body: { version: 'v1', interval: 5, transition: 'slide', slides: [{ id: 1, mime: 'image/png', version: 'a' }, { id: 2, mime: 'image/jpeg', version: 'b' }], logo: true, company: 'Acme', accent: '#0A6CFF' },
  };
  const pictures: Record<string, Buffer | null> = o.pictures ?? { 'display/slides/1/image': PNG, 'display/slides/2/image': JPEG, 'display/logo': PNG };
  const door = vi.fn(async (_m: string, _p: string) => answer);
  const bytes = vi.fn(async (path: string, _max: number) => {
    const b = pictures[path];
    return b ? { status: 200, type: 'image/png', bytes: b } : { status: 404, type: null, bytes: null };
  });
  let now = Date.parse('2026-10-07T09:00:00Z');
  const s = new PosDisplayMediaStore({
    db,
    vault: () => vault,
    desk: { pairing: () => pairing, door: door as never, bytes: bytes as never },
    origin: () => 'https://ws.example',
    keep: () => o.keep ?? true,
    now: () => now,
  });
  return {
    s,
    db,
    door,
    bytes,
    pictures,
    set: (a: DeviceAnswer) => {
      answer = a;
    },
    later: (ms: number) => {
      now += ms;
    },
  };
}

describe('the customer display’s promotions on the till', () => {
  it('reads what the door says this till shows, fetches each picture, and keeps it sealed', async () => {
    const t = store();
    const m = await t.s.refresh();
    expect(t.door).toHaveBeenCalledWith('GET', 'display');
    expect(t.bytes.mock.calls.map((c) => c[0])).toEqual(['display/slides/1/image', 'display/slides/2/image', 'display/logo']);
    expect(t.bytes.mock.calls[0]![1]).toBe(SLIDE_MAX_BYTES);
    expect(m?.slides.map((x) => x.id)).toEqual([1, 2]);
    const row = t.db.get<{ payload: string }>('SELECT payload FROM pos_display_media WHERE origin = ? AND terminal_id = ?', 'https://ws.example', 7);
    expect(row?.payload.startsWith('v1:')).toBe(true);
    expect(row?.payload).not.toContain(PNG.toString('base64'));

    const shown = mediaFor(t.s.kept(), true);
    expect(shown.slides[0]!.src).toBe(`data:image/png;base64,${PNG.toString('base64')}`);
    expect(shown.slides[1]!.src.startsWith('data:image/jpeg;base64,')).toBe(true);
    expect(shown.logo?.startsWith('data:image/png;base64,')).toBe(true);
    expect(shown).toMatchObject({ interval: 5, transition: 'slide', company: 'Acme', accent: '#0A6CFF', touch: true, version: 'v1' });
  });

  it('asks again only every half hour, and an unchanged version fetches no picture', async () => {
    const t = store();
    await t.s.refresh();
    t.bytes.mockClear();
    t.door.mockClear();
    t.s.maybeRefresh();
    expect(t.door).not.toHaveBeenCalled();
    t.later(30 * 60_000);
    t.s.maybeRefresh();
    await vi.waitFor(() => expect(t.door).toHaveBeenCalledTimes(1));
    await t.s.refresh();
    expect(t.bytes).not.toHaveBeenCalled();
  });

  it('fetches only the pictures that changed', async () => {
    const t = store();
    await t.s.refresh();
    t.bytes.mockClear();
    t.set({ status: 200, body: { version: 'v2', interval: 8, transition: 'fade', slides: [{ id: 2, version: 'b' }, { id: 3, version: 'c' }], logo: false } });
    t.pictures['display/slides/3/image'] = PNG;
    const m = await t.s.refresh();
    expect(t.bytes.mock.calls.map((c) => c[0])).toEqual(['display/slides/3/image']);
    expect(m?.slides.map((x) => x.id)).toEqual([2, 3]);
    expect(m?.logo).toBeNull();
  });

  it('keeps no picture that is not one, and tries a missing one again next time', async () => {
    const t = store({ pictures: { 'display/slides/1/image': Buffer.from('<script>alert(1)</script>'), 'display/slides/2/image': JPEG, 'display/logo': null } });
    const m = await t.s.refresh();
    expect(m?.slides.map((x) => x.id)).toEqual([2]);
    expect(m?.version).toBe('v1~partial');
    t.pictures['display/slides/1/image'] = PNG;
    t.bytes.mockClear();
    const again = await t.s.refresh();
    expect(t.bytes.mock.calls.map((c) => c[0])).toEqual(['display/slides/1/image', 'display/logo']);
    expect(again?.slides.map((x) => x.id)).toEqual([1, 2]);
  });

  it('shows the pictures it kept while WorkSuite is out of reach', async () => {
    const t = store();
    await t.s.refresh();
    t.door.mockRejectedValueOnce(new Error('offline'));
    const m = await t.s.refresh();
    expect(m?.slides).toHaveLength(2);
    expect(mediaFor(t.s.kept(), false).slides).toHaveLength(2);
  });

  it('keeps them in memory only where the policy keeps no data on this computer', async () => {
    const t = store({ keep: false });
    await t.s.refresh();
    expect(t.db.get('SELECT 1 FROM pos_display_media')).toBeUndefined();
    expect(t.s.kept()?.slides).toHaveLength(2);
  });

  it('has none on an older server, and forgets them with the till', async () => {
    const t = store();
    await t.s.refresh();
    t.set({ status: 404, body: null });
    expect(await t.s.refresh()).toBeNull();
    expect(t.s.kept()).toBeNull();

    const u = store();
    await u.s.refresh();
    u.s.forget('https://ws.example', 7);
    expect(u.s.kept()).toBeNull();
    await u.s.refresh();
    u.s.forgetAll();
    expect(u.db.get('SELECT 1 FROM pos_display_media')).toBeUndefined();
  });

  it('reads the door’s answer carefully', () => {
    expect(displayAnswerOf(null)).toBeNull();
    expect(displayAnswerOf({ slides: [] })).toBeNull();
    const a = displayAnswerOf({ version: 'v', interval: 999, transition: 'spin', slides: [{ id: 'x' }, { id: 4, mime: 'image/gif' }, { id: '5' }], accent: 'red' })!;
    expect(a).toMatchObject({ interval: 120, transition: 'fade', accent: null, logo: false });
    expect(a.slides.map((x) => x.id)).toEqual([5]);
    expect(sniffImage(PNG)).toBe('image/png');
    expect(sniffImage(JPEG)).toBe('image/jpeg');
    expect(sniffImage(Buffer.from('RIFF\0\0\0\0WEBPVP8 '))).toBe('image/webp');
    expect(sniffImage(Buffer.from('GIF89a......'))).toBeNull();
    expect(mediaFor(null, false)).toEqual({ slides: [], logo: null, company: null, accent: null, interval: 8, transition: 'fade', touch: false, version: null });
  });
});

describe('touch on the customer display', () => {
  it('is the till’s setting, else what the system says of the monitor — not knowing is no touch', () => {
    expect(touchOf('yes', 'unavailable')).toBe(true);
    expect(touchOf('no', 'available')).toBe(false);
    expect(touchOf('auto', 'available')).toBe(true);
    expect(touchOf('auto', 'unknown')).toBe(false);
    expect(touchOf(undefined, 'unavailable')).toBe(false);
    expect(posPrintPatchSchema.safeParse({ display_touch: 'yes' }).success).toBe(true);
    expect(posPrintPatchSchema.safeParse({ display_touch: 'maybe' }).success).toBe(false);
  });

  it('answers the display’s channel to the customer display’s window alone', () => {
    expect(isDisplayWindow({ getURL: () => 'app://worksuite/index.html#/window/record?route=%2Fpos%2Fdisplay' })).toBe(true);
    expect(isDisplayWindow({ getURL: () => 'app://worksuite/index.html#/pos' })).toBe(false);
    expect(isDisplayWindow({ getURL: () => 'app://worksuite/index.html#/window/record?route=%2Fpos' })).toBe(false);
    expect(isDisplayWindow({ getURL: () => { throw new Error('gone'); } })).toBe(false);
    expect(POS_INVOKE_CHANNELS).toContain('pos:displayMedia');
    expect(posContract['pos:displayMedia'].input.safeParse(undefined).success).toBe(true);
  });
});

describe('the door’s new calls', () => {
  it('looks a number up by its exact E.164 form, nothing else', () => {
    expect(deskCall({ op: 'byPhone', phone: '+94767793692' }, () => 5)).toEqual({ method: 'GET', path: 'customers/by-phone', query: { phone: '+94767793692' } });
    expect(posDeskSchema.safeParse({ op: 'byPhone', phone: '+94767793692' }).success).toBe(true);
    expect(posDeskSchema.safeParse({ op: 'byPhone', phone: '0767793692' }).success).toBe(false);
    expect(posDeskSchema.safeParse({ op: 'byPhone', phone: '+9476%' }).success).toBe(false);
    expect(posDeskSchema.safeParse({ op: 'byPhone', phone: '+94767793692', name: 'x' }).success).toBe(false);
  });

  function paired(raw: (url: string, init: RequestInit) => Promise<Response>) {
    const m = new Map<string, string>();
    m.set('pos-till:https://ws.example', JSON.stringify({ terminal: { id: 7, code: 'T1', name: 'Front', org_id: 3 }, token: `wsp_7_${'a1'.repeat(32)}`, expires_at: null, paired_at: '2026-10-01T00:00:00Z', prefix: 'T1-AAAAAA', state: 'paired' }));
    const spy = vi.fn(async (_m: string, url: string, init: RequestInit) => raw(url, init));
    const d = new PosDesk({
      secrets: { get: (k) => m.get(k) ?? null, set: (k, v) => void m.set(k, v), delete: (k) => void m.delete(k), deletePrefix: () => 0 },
      http: { request: vi.fn() as never, raw: spy as never, url: (p: string, q?: Record<string, unknown>) => `https://ws.example${p}${q?.phone ? `?phone=${encodeURIComponent(String(q.phone))}` : ''}` },
      origin: () => 'https://ws.example',
      installId: () => 'i',
      device: () => ({ name: 'PC', info: 'x' }),
      appVersion: '0.2.199',
    });
    return { d, spy };
  }

  it('lets the display’s calls through the door, with the till’s credential', async () => {
    const { d, spy } = paired(async () => new Response(JSON.stringify({ items: [] }), { headers: { 'Content-Type': 'application/json' } }));
    for (const path of ['display', 'display/logo', 'display/slides/12/image', 'customers/by-phone']) await d.door('GET', path, path === 'customers/by-phone' ? { query: { phone: '+94767793692' } } : {});
    expect(spy.mock.calls.map((c) => c[1])).toEqual([
      'https://ws.example/api/pos/device/display',
      'https://ws.example/api/pos/device/display/logo',
      'https://ws.example/api/pos/device/display/slides/12/image',
      'https://ws.example/api/pos/device/customers/by-phone?phone=%2B94767793692',
    ]);
    await expect(d.door('GET', 'display/slides/x/image')).rejects.toThrow(/door/);
  });

  it('reads a picture only from the display’s paths, only an image, only up to its size', async () => {
    const png = paired(async () => new Response(PNG, { headers: { 'Content-Type': 'image/png' } }));
    const r = await png.d.bytes('display/logo', 1024);
    expect(r.status).toBe(200);
    expect(r.bytes?.equals(PNG)).toBe(true);
    expect((await png.d.bytes('display/logo', 8)).status).toBe(413);
    await expect(png.d.bytes('customers/by-phone', 1024)).rejects.toThrow(/picture/);
    const html = paired(async () => new Response('<html>', { headers: { 'Content-Type': 'text/html' } }));
    expect((await html.d.bytes('display/logo', 1024)).bytes).toBeNull();
  });
});
