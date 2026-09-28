import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as CoreApi from '../../../src/core/api';
import { b64, importKeys, open, type Envelope, type GrantClaims } from '@shared/remote-control/channel';

/**
 * The controller's end of Meet remote control (WS-MEET-ENH-01): what the
 * mouse and keys become, the grant → confirm → active flow against a fake
 * server, pause, a rotated key, release, policy and the step-up.
 */

const bridge = vi.hoisted(() => ({ listeners: [] as Array<(e: unknown) => void> }));
const policy = vi.hoisted(() => ({ controller: 'allowed' as 'allowed' | 'disabled' }));

vi.mock('../../../src/core/bridge', () => ({
  call: vi.fn(),
  errorMessage: (e: unknown) => String(e),
  on: (_channel: string, cb: (e: unknown) => void) => {
    bridge.listeners.push(cb);
    return () => bridge.listeners.splice(bridge.listeners.indexOf(cb), 1);
  },
}));
vi.mock('../../../src/core/api', async (orig) => ({ ...(await orig<typeof CoreApi>()), apiGet: vi.fn(), apiPost: vi.fn(), apiPut: vi.fn(), apiDelete: vi.fn() }));
vi.mock('../../../src/core/toasts', () => ({ toast: vi.fn() }));
vi.mock('../../../src/core/app-state', () => ({ app: { get: () => ({ bootstrap: { policy: { remote_control_controller: policy.controller } } }), subscribe: () => () => undefined } }));
vi.mock('../../../src/modules/meet/session', () => ({ meet: { room: null } }));

import { ApiError, apiDelete, apiGet, apiPost } from '../../../src/core/api';
import { toast } from '../../../src/core/toasts';
import { call } from '../../../src/core/bridge';
import { POLICY_OFF, endedOf, failure, offerFor, pauseText, type ControlSession, type ControlState, type Share } from '../../../src/modules/meet/remote/api';
import { MeetController } from '../../../src/modules/meet/remote/controller';
import { MoveCoalescer, buttonName, keyMessage, pointOn, wheelDelta } from '../../../src/modules/meet/remote/input';
import { specialKeys } from '../../../src/modules/meet/remote/specialKeys';

const get = vi.mocked(apiGet);
const post = vi.mocked(apiPost);
const del = vi.mocked(apiDelete);

// ── a fake WorkSuite server ─────────────────────────────────────────────────

const KEY1 = new Uint8Array(32).fill(7);
const KEY2 = new Uint8Array(32).fill(9);
const T0 = Date.parse('2026-09-28T10:00:00Z');

function claims(version: number): GrantClaims {
  return {
    grant_id: `g-${version}`, session_id: 12, meeting_id: 'm-1', sharer_identity: 'u3-hana', controller_identity: 'u5-me',
    caps: { mouse: true, keyboard: true, clipboard: 'off', file_transfer: false, monitor_switch: false },
    exp: T0 / 1000 + 3600, lease_s: 30, lease_renew_s: 10, key_version: version,
  };
}

function share(over: Partial<Share> = {}): Share {
  return {
    id: 44, user_id: 3, name: 'Hasarinda', identity: 'u3-hana', client: 'desktop', surface: 'screen', label: 'Screen 1',
    allow_requests: true, quality: 'auto', status: 'SHARING_VIEW_ONLY', paused: false, started_at: '2026-09-28 10:00:00',
    device: { platform: 'windows', os_version: '11', desktop_version: '0.2.40', display_server: null, displays: 1, report: '' },
    availability: { can_request: true, code: 'available', reason: '', pointer: true, annotate: true, handover: false, notes: [] },
    ...over,
  };
}

function session(over: Partial<ControlSession> = {}): ControlSession {
  return {
    id: 12, share_id: 44, status: 'CONTROL_APPROVED', role: 'controller', pause_reason: null,
    caps: claims(1).caps, caps_label: 'Mouse and keyboard',
    sharer: { id: 3, name: 'Hasarinda', identity: 'u3-hana' }, controller: { id: 5, name: 'Samali', identity: 'u5-me' },
    reason: null, duration: '15', approved_at: null, started_at: null, expires_at: null, key_version: 1, grant_waiting: true,
    type: 'meeting', ticket_id: null, mfa_passed: false, ...over,
  };
}

const server = {
  state: null as unknown as ControlState,
  grants: [] as Array<() => Promise<unknown>>,
};

function stateWith(sessions: ControlSession[], shares: Share[] = [share()]): ControlState {
  return {
    shares, requests: [], asked: [], sessions,
    options: { remote_control_mode: 'participants', viewer_pointer: true, share_mode: 'everyone', record_type: null, can_edit: false, is_host: false },
    server: { signing: true, lease_s: 30, lease_renew_s: 10 }, at: 0,
  };
}

function setSession(over: Partial<ControlSession>) {
  server.state = stateWith([session(over)]);
}

function delivery(version: number, key: Uint8Array) {
  return async () => ({ token: 't', key: b64(key), claims: claims(version), public_key: null, rate: { pointer_per_s: 120, key_per_s: 30, click_per_s: 10 } });
}

/** The server's answer to a request for control, listed as pending in the state from then on. */
function accepted() {
  server.state = { ...server.state, requests: [{ id: 9, session_id: 12, share_id: 44, kind: 'request', requester: { id: 5, name: 'Samali' }, sharer: { id: 3, name: 'Hasarinda' }, reason: null, expires_in: 60, status: 'pending' }] };
  return { request_id: 9, session_id: 12, expires_in: 60, handover: false };
}

function posts(path: RegExp) {
  return post.mock.calls.filter(([p]) => path.test(p));
}

let publishData: ReturnType<typeof vi.fn>;
let c: MeetController;

beforeEach(() => {
  bridge.listeners.length = 0;
  policy.controller = 'allowed';
  server.state = stateWith([]);
  server.grants = [];
  get.mockImplementation(async (path: string) => {
    if (path === '/api/meet/m-1/control/state') return structuredClone(server.state);
    if (path === '/api/meet/control/sessions/12/grant') {
      const next = server.grants.shift();
      if (!next) throw new ApiError(409, 'This grant was already handed to that end. Rejoin control to have its key rotated.', null, { code: 'delivered' });
      return next();
    }
    if (path === '/api/meet/control/sessions/12') return { id: 12, termination: null, ended_by: 'Hasarinda', ended_at: null };
    throw new Error(`unexpected GET ${path}`);
  });
  post.mockImplementation(async () => ({}));
  del.mockImplementation(async () => {
    server.state = { ...server.state, requests: [] };
    return {};
  });
  publishData = vi.fn(async () => undefined);
  c = new MeetController(() => ({ localParticipant: { identity: 'u5-me', publishData } }), () => T0);
});

afterEach(async () => {
  // Leaving the meeting releases control; let that finish inside this test.
  if (c.session) await c.release();
  c.stop();
  vi.useRealTimers();
});

/** What went out: topic, reliability, recipients, and the payload opened with the key it was sealed under. */
async function sent(key: Uint8Array) {
  const keys = await importKeys(key);
  const out = [];
  for (const [bytes, opts] of publishData.mock.calls as Array<[Uint8Array, { reliable: boolean; topic: string; destinationIdentities: string[] }]>) {
    const env = JSON.parse(new TextDecoder().decode(bytes)) as Envelope;
    out.push({ type: env.t, seq: env.s, topic: opts.topic, reliable: opts.reliable, to: opts.destinationIdentities, payload: await open(keys, env) });
  }
  return out;
}

/** Start in the meeting and get to CONTROL_ACTIVE with key 1. */
async function activate() {
  setSession({});
  server.grants.push(delivery(1, KEY1));
  c.start('m-1');
  await vi.waitFor(() => expect(posts(/\/confirm$/)).toHaveLength(1));
  setSession({ status: 'CONTROL_ACTIVE', grant_waiting: false });
  await c.refresh();
  await vi.waitFor(() => expect(c.active).toBe(true));
}

// ── what the mouse and keys become ────────────────────────────────────────

describe('what the controller sends (RC-INP-02, RC-KBD-01)', () => {
  // A 1920×1080 picture in a 1000×500 box: 889 px wide, bars of 55.6 px either side.
  const box = { left: 0, top: 0, width: 1000, height: 500 };

  it('takes coordinates on the letterboxed picture, not the element', () => {
    expect(pointOn(500, 250, box, 1920, 1080)).toEqual({ x: 0.5, y: 0.5 });
    expect(pointOn(56, 0, box, 1920, 1080)).toEqual({ x: 0.0005, y: 0 });
    expect(pointOn(20, 250, box, 1920, 1080)).toBeNull();
    expect(pointOn(500, 250, box, 0, 0)).toBeNull();
  });

  it('pins a button let go off the picture to its edge, so a press is always released', () => {
    expect(pointOn(20, 250, box, 1920, 1080, true)).toEqual({ x: 0, y: 0.5 });
    expect(pointOn(2000, -40, box, 1920, 1080, true)).toEqual({ x: 1, y: 0 });
  });

  it("sends the web's key payload: the physical key, its name only when it isn't a character", () => {
    const k = (key: string, code: string, mods: Partial<Record<'ctrlKey' | 'altKey' | 'shiftKey' | 'metaKey', boolean>> = {}) => ({ key, code, ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, ...mods });

    expect(JSON.stringify(keyMessage(k('a', 'KeyA'), true, false))).toBe('{"code":"KeyA","ctrl":false,"alt":false,"shift":false,"meta":false,"down":true}');
    expect(keyMessage(k('Enter', 'Enter'), false, false)).toEqual({ code: 'Enter', key: 'Enter', ctrl: false, alt: false, shift: false, meta: false, down: false });
    expect(keyMessage(k('C', 'KeyC', { ctrlKey: true, shiftKey: true }), true, false)).toMatchObject({ code: 'KeyC', ctrl: true, shift: true, down: true });
  });

  it('types characters as text in text mode, once, and keeps shortcuts as keys', () => {
    const k = (key: string, code: string, ctrlKey = false) => ({ key, code, ctrlKey, altKey: false, shiftKey: false, metaKey: false });

    expect(keyMessage(k('අ', 'KeyA'), true, true)).toEqual({ text: 'අ', down: true });
    expect(keyMessage(k('අ', 'KeyA'), false, true)).toBeNull();
    expect(keyMessage(k('c', 'KeyC', true), true, true)).toMatchObject({ code: 'KeyC', ctrl: true });
    expect(keyMessage(k('Backspace', 'Backspace'), true, true)).toMatchObject({ key: 'Backspace' });
  });

  it('names buttons and turns wheel lines and pages into pixels', () => {
    expect([buttonName(0), buttonName(1), buttonName(2), buttonName(4)]).toEqual(['left', 'middle', 'right', 'left']);
    expect(wheelDelta({ deltaX: 0, deltaY: 3, deltaMode: 1 })).toEqual({ dx: 0, dy: 48 });
    expect(wheelDelta({ deltaX: 1.4, deltaY: -120.6, deltaMode: 0 })).toEqual({ dx: 1, dy: -121 });
  });

  it('offers Ctrl+Alt+Delete only on Windows and never the emergency stop or a lock chord (RC-KBD-04)', () => {
    expect(specialKeys('windows').available.map((k) => k.combo)).toContain('Ctrl+Alt+Delete');
    expect(specialKeys('macos').available.map((k) => k.combo)).not.toContain('Ctrl+Alt+Delete');
    for (const p of ['windows', 'macos', 'linux', null]) {
      const combos = specialKeys(p).available.map((k) => k.combo);
      expect(combos).not.toContain('Ctrl+Alt+Shift+Esc');
      expect(combos).not.toContain('Meta+L');
    }
  });
});

describe('moves are coalesced to at most 60 a second', () => {
  it('sends the first at once and then only the latest, never closer than 1/60 s', () => {
    vi.useFakeTimers();
    const start = Date.now();
    const at: number[] = [];
    const got: number[] = [];
    const m = new MoveCoalescer((p) => (at.push(Date.now()), got.push(p.x)));

    // A mouse reporting every 4 ms (250 Hz) for a second.
    for (let i = 0; i < 250; i++) {
      m.push({ x: i, y: 0 });
      vi.advanceTimersByTime(4);
    }
    vi.advanceTimersByTime(50);
    expect(at[0]).toBe(start);

    expect(got[0]).toBe(0);
    expect(got.length).toBeLessThanOrEqual(61);
    expect(got.length).toBeGreaterThan(50);
    expect(got.at(-1)).toBe(249);
    for (let i = 1; i < at.length; i++) expect(at[i]! - at[i - 1]!).toBeGreaterThanOrEqual(1000 / 60 - 0.001);
  });

  it('forgets a waiting move when told to', () => {
    vi.useFakeTimers();
    let t = 0;
    const send = vi.fn();
    const m = new MoveCoalescer(send, () => t);
    m.push({ x: 0.1, y: 0.1 });
    m.push({ x: 0.2, y: 0.2 });
    m.drop();
    t += 100;
    vi.advanceTimersByTime(100);
    expect(send).toHaveBeenCalledTimes(1);
  });
});

// ── the session ─────────────────────────────────────────────────────────────

describe('the grant, confirmed, then control (RC-REQ-05, SEC-20)', () => {
  it('collects the grant once, confirms, and sends nothing before the session is active', async () => {
    setSession({});
    let release!: () => void;
    server.grants.push(() => new Promise((r) => (release = () => r(delivery(1, KEY1)()))));
    c.start('m-1');
    await vi.waitFor(() => expect(get).toHaveBeenCalledWith('/api/meet/control/sessions/12/grant', { end: 'controller' }));

    // More reads while the grant is on its way — the poll, a realtime nudge — don't ask again.
    for (const cb of bridge.listeners) cb({ type: 'meet.control', meeting: 'm-1' });
    const reads = [c.refresh(), c.refresh()];
    release();
    await Promise.all(reads);

    await vi.waitFor(() => expect(posts(/\/sessions\/12\/confirm$/)).toEqual([['/api/meet/control/sessions/12/confirm', { end: 'controller' }]]));
    expect(get.mock.calls.filter(([p]) => p.endsWith('/grant'))).toHaveLength(1);
    expect(c.confirmed).toBe(true);
    expect(toast).toHaveBeenCalledWith('success', 'You now have control. Hasarinda allowed mouse and keyboard.');

    // Approved, both ends not yet confirmed: still nothing goes out.
    expect(c.active).toBe(false);
    c.move({ x: 0.5, y: 0.5 });
    c.button({ x: 0.5, y: 0.5 }, 'left', true);
    await c.flush();
    expect(publishData).not.toHaveBeenCalled();

    setSession({ status: 'CONTROL_ACTIVE', grant_waiting: false });
    await c.refresh();
    expect(c.active).toBe(true);
    expect(get.mock.calls.filter(([p]) => p.endsWith('/grant'))).toHaveLength(1);
  });

  it('seals moves for the lossy topic and everything else for the reliable one, to the sharer alone', async () => {
    await activate();

    c.move({ x: 0.25, y: 0.75 });
    c.button({ x: 0.25, y: 0.75 }, 'right', true);
    c.wheel({ x: 0.25, y: 0.75 }, 0, 48);
    c.key({ key: 'Enter', code: 'Enter', ctrlKey: false, altKey: false, shiftKey: false, metaKey: false }, true);
    c.special('Alt+Tab');
    await c.flush();

    const out = await sent(KEY1);
    expect(out.map((m) => [m.type, m.topic, m.reliable])).toEqual([
      ['ptr.move', 'rc.ctl.move', false],
      ['ptr.button', 'rc.ctl', true],
      ['ptr.wheel', 'rc.ctl', true],
      ['key', 'rc.ctl', true],
      ['special', 'rc.ctl', true],
    ]);
    expect(out.every((m) => m.to.length === 1 && m.to[0] === 'u3-hana')).toBe(true);
    expect(out.map((m) => m.seq)).toEqual([1, 2, 3, 4, 5]);
    expect(out.map((m) => m.payload)).toEqual([
      { x: 0.25, y: 0.75, display: 1 },
      { x: 0.25, y: 0.75, button: 'right', down: true },
      { x: 0.25, y: 0.75, dx: 0, dy: 48 },
      { code: 'Enter', key: 'Enter', ctrl: false, alt: false, shift: false, meta: false, down: true },
      { combo: 'Alt+Tab' },
    ]);
  });

  it("says so when the grant was already handed over (409 delivered), and doesn't ask again", async () => {
    setSession({});
    c.start('m-1');
    await vi.waitFor(() => expect(c.problem).toBe('This grant was already handed to that end. Rejoin control to have its key rotated.'));
    await c.refresh();
    await c.refresh();

    expect(get.mock.calls.filter(([p]) => p.endsWith('/grant'))).toHaveLength(1);
    expect(posts(/\/confirm$/)).toHaveLength(0);
    expect(c.active).toBe(false);
  });

  it('lets go of keys still down when the shared screen loses focus', async () => {
    await activate();
    const shift = { key: 'Shift', code: 'ShiftLeft', ctrlKey: false, altKey: false, shiftKey: true, metaKey: false };
    c.key(shift, true);
    c.button({ x: 0.1, y: 0.1 }, 'left', true);
    c.releaseHeld();
    await c.flush();

    const out = await sent(KEY1);
    expect(out.slice(2).map((m) => m.payload)).toEqual([
      { code: 'ShiftLeft', key: 'Shift', ctrl: false, alt: false, shift: true, meta: false, down: false },
      { x: 0.1, y: 0.1, button: 'left', down: false },
    ]);
  });
});

describe('the lease (RC-CTL-04)', () => {
  it('is renewed every lease_renew_s on the data channel and over HTTPS, until control is released', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    await activate();

    vi.advanceTimersByTime(10_000);
    await vi.waitFor(() => expect(posts(/\/sessions\/12\/lease$/)).toHaveLength(1));
    await c.flush();
    const out = await sent(KEY1);
    expect(out.map((m) => [m.type, m.topic])).toEqual([['lease', 'rc.ctl']]);

    await c.release();
    vi.advanceTimersByTime(30_000);
    await c.flush();
    expect(posts(/\/lease$/)).toHaveLength(1);
    expect(publishData).toHaveBeenCalledTimes(1);
  });
});

describe('pause and resume (RC07, WF-RC-04)', () => {
  it('stops sending while paused, and says why', async () => {
    await activate();
    setSession({ status: 'CONTROL_PAUSED', grant_waiting: false, pause_reason: 'lock_screen' });
    await c.refresh();

    expect(c.active).toBe(false);
    c.move({ x: 0.5, y: 0.5 });
    c.button({ x: 0.5, y: 0.5 }, 'left', true);
    expect(c.key({ key: 'a', code: 'KeyA', ctrlKey: false, altKey: false, shiftKey: false, metaKey: false }, true)).toBe(false);
    c.special('Alt+Tab');
    await c.flush();
    expect(publishData).not.toHaveBeenCalled();
    expect(pauseText('lock_screen', 'Hasarinda')).toBe("Hasarinda's computer is locked. Control is paused until they unlock it and resume.");
    expect(pauseText(null, 'Hasarinda')).toBe('Remote control paused by Hasarinda. Only they can resume it.');
  });

  it('collects and confirms the rotated key when the sharer resumes, and seals with it', async () => {
    await activate();
    setSession({ status: 'CONTROL_PAUSED', grant_waiting: false, pause_reason: 'sharer' });
    await c.refresh();

    // Resume rotates the key: the grant waits again under version 2.
    server.grants.push(delivery(2, KEY2));
    setSession({ status: 'CONTROL_PAUSED', grant_waiting: true, key_version: 2, pause_reason: 'sharer' });
    await c.refresh();
    await vi.waitFor(() => expect(posts(/\/confirm$/)).toHaveLength(2));
    expect(get.mock.calls.filter(([p]) => p.endsWith('/grant'))).toHaveLength(2);
    expect(c.active).toBe(false);

    setSession({ status: 'CONTROL_ACTIVE', grant_waiting: false, key_version: 2 });
    await c.refresh();
    expect(c.active).toBe(true);
    c.button({ x: 0.5, y: 0.5 }, 'left', true);
    await c.flush();

    const out = await sent(KEY2);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ type: 'ptr.button', seq: 1, payload: { x: 0.5, y: 0.5, button: 'left', down: true } });
    expect((await sent(KEY1))[0]!.payload).toBeNull();
  });
});

describe('the end', () => {
  it('releases with reason released, then sends nothing more', async () => {
    await activate();
    await c.release();

    expect(posts(/\/stop$/)).toEqual([['/api/meet/control/sessions/12/stop', { reason: 'released' }]]);
    expect(c.session).toBeNull();
    c.move({ x: 0.5, y: 0.5 });
    await c.flush();
    expect(publishData).not.toHaveBeenCalled();

    // A read that still lists it (sent before the stop landed) doesn't bring it back.
    await c.refresh();
    expect(c.session).toBeNull();
    expect(get.mock.calls.filter(([p]) => p.endsWith('/grant'))).toHaveLength(1);
  });

  it('tears down when the session leaves the live states, and says who ended it', async () => {
    await activate();
    server.state = stateWith([]);
    await c.refresh();

    expect(c.session).toBeNull();
    expect(c.active).toBe(false);
    await vi.waitFor(() => expect(toast).toHaveBeenCalledWith('info', 'Remote control ended by Hasarinda. Ended just now.'));
  });

  it('tears down when the share ends', async () => {
    await activate();
    server.state = stateWith([session({ status: 'CONTROL_ACTIVE', grant_waiting: false })], []);
    await c.refresh();
    expect(c.session).toBeNull();
  });

  it('words how it ended as the web does', () => {
    expect(endedOf({ id: 1, termination: 'emergency_stop', ended_by: 'Hasarinda', ended_at: null }, 'Hasarinda')).toEqual({ by: 'Hasarinda (emergency stop)', reason: 'Ended just now.' });
    expect(endedOf({ id: 1, termination: 'released', ended_by: 'You', ended_at: null }, 'Hasarinda').by).toBe('you');
    expect(endedOf({ id: 1, termination: 'handover', ended_by: 'Handed to someone else', ended_at: null }, 'Hasarinda').reason).toBe('Control was handed to someone else.');
    expect(endedOf(null, 'Hasarinda')).toEqual({ by: 'Hasarinda', reason: 'Control has ended.' });
  });
});

// ── asking ──────────────────────────────────────────────────────────────────

describe('asking for control (RC02, RC-REQ-01)', () => {
  it('offers Request control only where the server says it can be asked for, else its sentence', () => {
    expect(offerFor(share(), false)).toEqual({ kind: 'request', hint: null });
    const web = share({ client: 'web', availability: { ...share().availability, can_request: false, code: 'browser', reason: "Control needs WorkSuite Desktop on Hasarinda's computer." } });
    expect(offerFor(web, false)).toMatchObject({ kind: 'reason', text: "Control needs WorkSuite Desktop on Hasarinda's computer." });
    expect(offerFor(share({ availability: { ...share().availability, can_request: false, code: 'controlling' } }), false)).toEqual({ kind: 'none' });
  });

  it("doesn't offer it at all when this computer's policy turns controlling off", async () => {
    expect(offerFor(share(), true)).toEqual({ kind: 'policy', text: POLICY_OFF });
    expect(POLICY_OFF).toBe('Controlling other computers is turned off on this computer by its policy.');

    policy.controller = 'disabled';
    c.start('m-1');
    await c.ask(share(), '', { reason: vi.fn(), code: vi.fn() });
    expect(posts(/\/control\/requests$/)).toHaveLength(0);
  });

  it('asks with this connection, waits with the countdown, and cancels', async () => {
    post.mockImplementation(async (path: string) => (path.endsWith('/control/requests') ? accepted() : {}));
    c.start('m-1');
    await c.ask(share(), 'Printer driver', { reason: vi.fn(), code: vi.fn() });

    expect(posts(/\/control\/requests$/)).toEqual([['/api/meet/m-1/control/requests', { share_id: 44, identity: 'u5-me', reason: 'Printer driver' }]]);
    expect(c.waiting).toMatchObject({ requestId: 9, shareId: 44, name: 'Hasarinda', until: T0 + 60_000 });
    await c.refresh();
    expect(c.waiting?.requestId).toBe(9);

    await c.cancel();
    expect(del).toHaveBeenCalledWith('/api/meet/control/requests/9');
    expect(c.waiting).toBeNull();
  });

  it('stops waiting when the request is answered, and says so when it runs out', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    post.mockImplementation(async (path: string) => (path.endsWith('/control/requests') ? accepted() : {}));
    c.start('m-1');
    await c.ask(share(), '', { reason: vi.fn(), code: vi.fn() });
    expect(c.waiting?.requestId).toBe(9);

    // Allowed: the request leaves the state and the session arrives.
    server.state = stateWith([session({ grant_waiting: false })]);
    server.grants.push(delivery(1, KEY1));
    await c.refresh();
    expect(c.waiting).toBeNull();
    await c.release();

    // Asked again, and nobody answers for sixty seconds.
    await c.ask(share(), '', { reason: vi.fn(), code: vi.fn() });
    expect(c.waiting?.requestId).toBe(9);
    vi.advanceTimersByTime(61_000);
    expect(c.waiting).toBeNull();
    expect(toast).toHaveBeenCalledWith('info', "Hasarinda didn't answer. You can ask again.");
  });

  it('confirms who you are first when policy asks for a step-up, then asks again', async () => {
    let n = 0;
    post.mockImplementation(async (path: string) => {
      if (path.endsWith('/control/requests') && n++ === 0) throw new ApiError(428, "Confirm it's you first — company policy asks for your authenticator code or passkey before controlling a computer.", null, { code: 'step_up' });
      if (path.endsWith('/control/requests')) return accepted();
      return {};
    });
    const code = vi.fn(async () => '123456');
    c.start('m-1');
    await c.ask(share(), 'Printer driver', { reason: vi.fn(), code });

    expect(code).toHaveBeenCalledWith("Confirm it's you first — company policy asks for your authenticator code or passkey before controlling a computer.");
    expect(posts(/\/step-up$/)).toEqual([['/api/meet/control/step-up', { code: '123456' }]]);
    expect(posts(/\/control\/requests$/)).toHaveLength(2);
    expect(posts(/\/control\/requests$/)[1]![1]).toEqual({ share_id: 44, identity: 'u5-me', reason: 'Printer driver' });
    expect(c.waiting?.requestId).toBe(9);
  });

  it('asks for a reason when company policy wants one', async () => {
    let n = 0;
    post.mockImplementation(async (path: string) => {
      if (path.endsWith('/control/requests') && n++ === 0) throw new ApiError(422, 'Say briefly why you need control — company policy asks for a reason.', null, { code: 'reason_required' });
      return accepted();
    });
    c.start('m-1');
    await c.ask(share(), '', { reason: async () => 'Printer driver', code: vi.fn() });
    expect(posts(/\/control\/requests$/)[1]![1]).toMatchObject({ reason: 'Printer driver' });
  });

  it('says what went wrong otherwise, and reads the code from where the server puts it', async () => {
    post.mockRejectedValue(new ApiError(429, "You've asked 3 times in 10 minutes.", null, { code: 'rate_limited' }));
    c.start('m-1');
    await c.ask(share(), '', { reason: vi.fn(), code: vi.fn() });
    expect(toast).toHaveBeenCalledWith('error', "You've asked 3 times in 10 minutes.");
    expect(failure(new ApiError(409, 'x', null, { code: 'delivered' })).code).toBe('delivered');
  });

  it('reads again at once on meet.control for this meeting, not for another', async () => {
    c.start('m-1');
    await vi.waitFor(() => expect(get).toHaveBeenCalledTimes(1));
    const reads = () => get.mock.calls.filter(([p]) => p === '/api/meet/m-1/control/state').length;
    for (const cb of bridge.listeners) cb({ type: 'meet.control', meeting: 'other' });
    for (const cb of bridge.listeners) cb({ type: 'chat.message' });
    expect(reads()).toBe(1);
    for (const cb of bridge.listeners) cb({ type: 'meet.control', meeting: 'm-1' });
    await vi.waitFor(() => expect(reads()).toBe(2));
  });
});

describe('files in the session (RC06)', () => {
  const caps = { ...claims(1).caps, file_transfer: true };
  const offered = { id: 31, session_id: 12, direction: 'to_controller' as const, sender: { id: 3, name: 'Hasarinda' }, receiver_id: 5, name: 'log.zip', size: 10, executable: false, scan: 'clean' as const, status: 'offered' as const };

  async function withFiles(files: unknown[]) {
    const base = get.getMockImplementation()!;
    get.mockImplementation(async (path: string, q?: unknown) => (path === '/api/meet/control/sessions/12/files' ? { files } : base(path, q as never)));
    setSession({ caps });
    server.grants.push(delivery(1, KEY1));
    c.start('m-1');
    await vi.waitFor(() => expect(posts(/\/confirm$/)).toHaveLength(1));
    setSession({ status: 'CONTROL_ACTIVE', grant_waiting: false, caps });
    await c.refresh();
  }

  it('lists what the sharer offered this end, offers files through the upload manager, and fetches with the one-time token', async () => {
    await withFiles([offered, { ...offered, id: 32, direction: 'to_sharer' }]);
    expect(c.offers.map((f) => f.id)).toEqual([31]);

    const bridgeCall = vi.mocked(call);
    bridgeCall.mockImplementation((async (ch: string) => (ch === 'files:pickFiles' ? [{ handle: 'h1', name: 'a.txt', size: 1 }] : [])) as never);
    expect(await c.sendFiles()).toBe(1);
    expect(bridgeCall).toHaveBeenCalledWith('transfers:upload', { handles: ['h1'], target: { kind: 'remote', sessionId: 12 } });

    post.mockImplementation(async (path: string) => (path.endsWith('/31/accept') ? { download: '/api/meet/control/files/31/download?t=abcdefabcdefabcdef12' } : {}));
    expect(await c.acceptFile(c.offers[0]!)).toBe(true);
    expect(bridgeCall).toHaveBeenCalledWith('transfers:download', { remoteFile: { id: 31, t: 'abcdefabcdefabcdef12' }, name: 'log.zip' });
    expect(c.offers).toEqual([]);
  });

  it('asks again before taking a program', async () => {
    await withFiles([{ ...offered, name: 'fix.exe', executable: true }]);
    post.mockImplementation(async (path: string) => {
      if (path.endsWith('/31/accept')) throw new ApiError(428, 'fix.exe is a program. Confirm…', null, { code: 'confirm_executable' });
      return {};
    });
    expect(await c.acceptFile(c.offers[0]!)).toBe(false);
    expect(c.offers).toHaveLength(1);
  });
});
