import { beforeEach, describe, expect, it, vi } from 'vitest';
import { generateKeyPairSync, sign, type KeyObject } from 'node:crypto';
import { tmpdir } from 'node:os';

vi.mock('electron', () => ({ app: { getPath: () => tmpdir(), getVersion: () => '0.1.0', isPackaged: false } }));

import { canonicalJson } from '@shared/canonical-json';
import { ControlSender, importKeys, type GrantClaims } from '@shared/remote-control/channel';
import type { DesktopPolicy, RemoteControlSupport } from '@shared/types';
import { isProxyPathAllowed } from '../../../electron/services/api-proxy';
import { DEFAULT_POLICY, normalizePolicy } from '../../../electron/services/policy';
import { checkGrant } from '../../../electron/services/remote-control/grant';
import { cleanText, displayServer, inputSupport, protocolLines, xdotoolArgs, type InputAction, type Injector } from '../../../electron/services/remote-control/input';
import { comboCodes } from '../../../electron/services/remote-control/keys';
import { Held, comboActions, keyActions, place, pointerActions } from '../../../electron/services/remote-control/mapping';
import { RemoteControlService, isProtected, pauseText, type CapturedSource, type ControlState, type RemoteControlDeps } from '../../../electron/services/remote-control/service';

/**
 * Meet remote control on the shared computer (WS-MEET-ENH-01 §E): what the
 * page may not reach, the grant it takes control under, the consent that
 * needs a real click, and every gate between a controller's message and
 * the input helper.
 */

const b64url = (b: Buffer) => b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const { publicKey, privateKey } = generateKeyPairSync('ed25519');
const PEM = publicKey.export({ type: 'spki', format: 'pem' }).toString();
const KEY = Buffer.alloc(32, 7);
const UUID = 'c30c0aac-e4e9-454b-b1f0-551cebb76429';
const T0 = 1_790_000_000_000;

function token(claims: object, key: KeyObject = privateKey): string {
  const body = Buffer.from(canonicalJson(claims));
  return `${b64url(body)}.${b64url(sign(null, body, key))}`;
}

function claims(over: Partial<GrantClaims> = {}): GrantClaims {
  return {
    typ: 'meet.remote_control.grant',
    grant_id: 'g-1',
    session_id: 9,
    meeting_id: UUID,
    sharer_identity: 'u3-abc',
    sharer_device_id: 77,
    controller_identity: 'u5-xyz',
    caps: { mouse: true, keyboard: true, clipboard: 'off', file_transfer: false, monitor_switch: false },
    exp: T0 / 1000 + 600,
    lease_s: 30,
    lease_renew_s: 10,
    key_version: 1,
    idle_pause_s: 600,
    ...over,
  };
}

describe('what a meeting window may not reach through the proxy', () => {
  it('keeps allowing, resuming, reporting and the shared computer’s key to the main process', () => {
    for (const p of [
      '/api/meet/control/requests/21/answer',
      '/api/meet/control/requests/21/answer/',
      '/api/meet/control/sessions/9/resume',
      '/api/meet/control/sessions/9/security',
      '/api/meet/devices/77/capabilities',
      '/api/meet/control/sessions/9/grant?end=sharer',
      '/api/meet/control/sessions/9/grant?x=1&end=%73harer',
      '/api/meet/control/sessions/9/grant?end=controller&end=sharer',
    ]) {
      expect(isProxyPathAllowed(p, 'POST') && isProxyPathAllowed(p, 'GET'), p).toBe(false);
    }
  });

  it('still lets it ask, cancel, collect its own grant, pause and stop', () => {
    for (const p of ['/api/meet/control/sessions/9/grant?end=controller', `/api/meet/${UUID}/control/requests`, '/api/meet/control/requests/21', '/api/meet/control/sessions/9/stop', '/api/meet/control/sessions/9/pause', `/api/meet/${UUID}/control/state`]) {
      expect(isProxyPathAllowed(p, 'POST'), p).toBe(true);
    }
  });
});

describe('the grant (SEC-03)', () => {
  const expected = { sessionId: 9, meeting: UUID, sharerIdentity: 'u3-abc', deviceId: 77, now: T0 };
  const delivery = (c: GrantClaims, t = token(c)) => ({ token: t, key: KEY.toString('base64'), claims: c, public_key: PEM });

  it('is taken when the signature and every claim check out', () => {
    const r = checkGrant(delivery(claims()), expected, null);
    expect(r.ok && r.claims.controller_identity).toBe('u5-xyz');
    expect(r.ok && r.key.length).toBe(32);
    expect(r.ok && r.pinned).toBe(false);
  });

  it('is checked with the pinned key when this build has one', () => {
    const other = generateKeyPairSync('ed25519');
    expect(checkGrant(delivery(claims()), expected, PEM)).toMatchObject({ ok: true, pinned: true });
    expect(checkGrant(delivery(claims(), token(claims(), other.privateKey)), expected, PEM)).toMatchObject({ ok: false });
  });

  it('is refused when anything about it is off', () => {
    const t = token(claims());
    const [body, sig] = t.split('.') as [string, string];
    const forged = b64url(Buffer.from(canonicalJson({ ...claims(), controller_identity: 'u9-intruder' })));
    expect(checkGrant(delivery(claims(), `${forged}.${sig}`), expected, null)).toMatchObject({ ok: false, why: expect.stringContaining('signature') });
    expect(checkGrant(delivery(claims(), `${body}`), expected, null).ok).toBe(false);
    expect(checkGrant(delivery(claims({ session_id: 10 })), expected, null)).toMatchObject({ ok: false, why: 'The grant is for another session.' });
    expect(checkGrant(delivery(claims({ sharer_identity: 'u3-other' })), expected, null)).toMatchObject({ ok: false, why: 'The grant is for another share.' });
    expect(checkGrant(delivery(claims({ sharer_device_id: 78 })), expected, null)).toMatchObject({ ok: false, why: 'The grant is for another computer.' });
    expect(checkGrant(delivery(claims({ exp: T0 / 1000 - 1 })), expected, null)).toMatchObject({ ok: false, why: 'The grant has run out.' });
    expect(checkGrant({ ...delivery(claims()), key: Buffer.alloc(16).toString('base64') }, expected, null).ok).toBe(false);
    expect(checkGrant({ ...delivery(claims()), public_key: null }, expected, null)).toMatchObject({ ok: false });
  });
});

describe('the input helpers’ protocol', () => {
  it('writes numbers and known keys only', () => {
    const actions: InputAction[] = [
      { t: 'move', x: 960.4, y: 540.6 },
      { t: 'button', button: 'left', down: true },
      { t: 'wheel', dx: 0, dy: 240 },
      { t: 'key', code: 'KeyA', down: true },
      { t: 'key', code: 'NotAKey; rm -rf /', down: true },
      { t: 'key', code: 'ArrowLeft', down: false },
      { t: 'text', text: 'héllo\u0007' },
    ];
    expect(protocolLines(actions, 'win32')).toEqual(['m 960 541', 'b l 1', 'w 0 240', 'k 65 0 1', 'k 37 1 0', `u ${Buffer.from('héllo').toString('base64')}`]);
    expect(protocolLines(actions, 'darwin')).toContain('k 0 1');
  });

  it('chains a batch into one xdotool run, typed text after --', () => {
    expect(xdotoolArgs([{ t: 'move', x: 10, y: 20 }, { t: 'button', button: 'right', down: true }, { t: 'key', code: 'ControlLeft', down: true }, { t: 'wheel', dx: 0, dy: -240 }, { t: 'text', text: '--help' }])).toEqual([
      'mousemove', '10', '20', 'mousedown', '3', 'keydown', 'Control_L', 'click', '--repeat', '2', '4', 'type', '--delay', '0', '--', '--help',
    ]);
  });

  it('keeps text to readable characters', () => {
    expect(cleanText('a\r\nb\u0000c\u001b')).toBe('a\nbc');
    expect(cleanText('x'.repeat(5000))).toHaveLength(1000);
  });

  it('says why a computer cannot be controlled', () => {
    expect(displayServer('linux', { XDG_SESSION_TYPE: 'wayland' })).toBe('wayland');
    expect(displayServer('linux', { WAYLAND_DISPLAY: 'wayland-0', XDG_SESSION_TYPE: 'x11' })).toBe('x11');
    expect(inputSupport({ platform: 'linux', env: { XDG_SESSION_TYPE: 'wayland' } })).toMatchObject({ available: false, reason: expect.stringContaining('Wayland') });
    expect(inputSupport({ platform: 'linux', env: { XDG_SESSION_TYPE: 'x11' }, exists: () => false })).toMatchObject({ available: false, reason: expect.stringContaining('xdotool') });
    expect(inputSupport({ platform: 'linux', env: { XDG_SESSION_TYPE: 'x11' }, exists: (p) => p === '/usr/bin/xdotool' })).toMatchObject({ available: true, method: 'xdotool' });
    expect(inputSupport({ platform: 'darwin', env: {}, accessibility: false, exists: () => true })).toMatchObject({ available: false, reason: expect.stringContaining('Accessibility') });
    expect(inputSupport({ platform: 'win32', env: { SystemRoot: 'C:\\Windows' }, exists: () => true })).toMatchObject({ available: true, method: 'sendinput' });
  });
});

describe('mapping a controller’s message', () => {
  it('lands on the shared surface and never outside it', () => {
    expect(place(0.5, 0.5, { x: 1920, y: 0, width: 1920, height: 1080 })).toEqual({ x: 2880, y: 540 });
    expect(place(1, 1, { x: 0, y: 0, width: 100, height: 50 })).toEqual({ x: 99, y: 49 });
    expect(place(-2, 9, { x: 0, y: 0, width: 100, height: 50 })).toEqual({ x: 0, y: 49 });
  });

  it('presses a button once, and lets go only of what it pressed', () => {
    const held = new Held();
    expect(pointerActions('ptr.button', { button: 'left', down: true }, { x: 1, y: 2 }, held)).toEqual([{ t: 'move', x: 1, y: 2 }, { t: 'button', button: 'left', down: true }]);
    expect(pointerActions('ptr.button', { button: 'left', down: true }, null, held)).toEqual([]);
    expect(pointerActions('ptr.button', { button: 'right', down: false }, null, held)).toEqual([]);
    expect(pointerActions('ptr.button', { button: 'evil', down: true }, null, held)).toEqual([]);
    expect(held.releaseAll()).toEqual([{ t: 'button', button: 'left', down: false }]);
  });

  it('lets go of a modifier the controller no longer holds', () => {
    const held = new Held();
    keyActions({ code: 'ControlLeft', down: true, ctrl: true }, held);
    // The key-up for Ctrl was lost; the next key says Ctrl is not held.
    expect(keyActions({ code: 'KeyV', down: true, ctrl: false }, held)).toEqual([{ t: 'key', code: 'ControlLeft', down: false }, { t: 'key', code: 'KeyV', down: true }]);
    expect(keyActions({ code: 'Unknown', down: true }, held)).toEqual([]);
    expect(keyActions({ text: 'ü', down: true }, held)).toEqual([{ t: 'text', text: 'ü' }]);
  });

  it('presses a special key in order and lets go in reverse', () => {
    expect(comboActions('Ctrl+Shift+Esc').map((a) => (a.t === 'key' ? `${a.code}${a.down ? '↓' : '↑'}` : ''))).toEqual(['ControlLeft↓', 'ShiftLeft↓', 'Escape↓', 'Escape↑', 'ShiftLeft↑', 'ControlLeft↑']);
    expect(comboCodes('Meta')).toEqual(['MetaLeft']);
    expect(comboCodes('Ctrl+Nope')).toBeNull();
  });
});

describe('the policy keys for remote control', () => {
  it('default to what the server defaults to, and take only known values', () => {
    expect(DEFAULT_POLICY.remote_control_host).toBe('managed_only');
    const p = normalizePolicy({ remote_control_host: 'disabled', remote_emergency_stop_chord: 'Ctrl+Alt+F12', remote_local_priority_hold_ms: 99_999, remote_clipboard: 'everything' }, false);
    expect(p).toMatchObject({ remote_control_host: 'disabled', remote_emergency_stop_chord: 'Ctrl+Alt+F12', remote_local_priority_hold_ms: 5000, remote_clipboard: 'off' });
    expect(normalizePolicy({ remote_emergency_stop_chord: 'rm -rf' }, false).remote_emergency_stop_chord).toBe('Ctrl+Alt+Shift+Esc');
  });
});

// ── the service ───────────────────────────────────────────────────────────

const SCREEN: CapturedSource = { id: 'screen:1:0', name: 'Screen 1', kind: 'screen', displayId: '1', windowId: null };

function harness(opts: { support?: Partial<RemoteControlSupport>; policy?: Partial<DesktopPolicy> } = {}) {
  let t = T0;
  const calls: Array<[string, string, unknown]> = [];
  const every: Array<{ ms: number; fn: () => void }> = [];
  const sent: InputAction[][] = [];
  const shortcuts = new Map<string, () => void>();
  const h = {
    state: { shares: [{ id: 5, identity: 'u3-abc' }], asked: [], sessions: [] } as ControlState,
    grant: null as unknown,
    consentWc: null as number | null,
    consentOpen: false,
    cursor: { x: 0, y: 0 },
    advance: (ms: number) => (t += ms),
    tick: (ms: number) => every.filter((e) => e.ms === ms).forEach((e) => e.fn()),
  };
  const injector: Injector = {
    method: 'xdotool',
    start: vi.fn(async () => true),
    send: (a) => void sent.push(a),
    windowBounds: vi.fn(async () => null),
    foreground: vi.fn(async () => ({ window: null, app: 'Code', title: 'x' })),
    stop: vi.fn(),
  };
  const ui = {
    showConsent: vi.fn(),
    closeConsent: vi.fn(),
    consentOpen: () => h.consentOpen,
    consentFor: (wc: number) => (wc === h.consentWc ? (h.state.asked[0]?.id ?? 21) : null),
    isIndicator: (wc: number) => wc === 600,
    showIndicator: vi.fn(),
    hideIndicator: vi.fn(),
    notify: vi.fn(),
    changed: vi.fn(),
    switchScreen: vi.fn(async () => true),
  };
  const policy = { ...DEFAULT_POLICY, ...opts.policy };
  const deps: RemoteControlDeps = {
    http: {
      get: async <T,>(path: string) => {
        calls.push(['GET', path, null]);
        if (path.endsWith('/control/state')) return h.state as T;
        if (path.includes('/grant')) return h.grant as T;
        throw new Error(`unexpected ${path}`);
      },
      request: async <T,>(method: string, path: string, o?: { body?: unknown }) => {
        calls.push([method, path, o?.body ?? null]);
        if (path.endsWith('/control/shares')) return { id: 5 } as T;
        if (path.endsWith('/answer')) return { status: 'approved' } as T;
        return {} as T;
      },
    },
    deviceId: () => 77,
    policy: () => policy,
    support: () => ({ available: true, method: 'xdotool', displayServer: 'x11', reason: null, accessibility: 'not_required', policyAllows: true, ...opts.support }),
    pinnedKey: null,
    createInjector: () => injector,
    screen: {
      displays: () => [{ id: 1, bounds: { x: 0, y: 0, width: 1920, height: 1080 } }],
      primary: () => ({ id: 1, bounds: { x: 0, y: 0, width: 1920, height: 1080 } }),
      cursor: () => h.cursor,
      toInput: (p) => p,
      fromInput: (p) => p,
    },
    ui,
    shortcuts: { register: (a, fn) => (shortcuts.set(a, fn), true), unregister: (a) => void shortcuts.delete(a) },
    clipboard: { writeText: vi.fn() },
    files: { download: vi.fn(async () => undefined), pickAndOffer: vi.fn(async () => 1) },
    prefs: { allowRequests: () => true, setAllowRequests: vi.fn() },
    now: () => t,
    timers: {
      every: (ms, fn) => {
        const e = { ms, fn };
        every.push(e);
        return () => every.splice(every.indexOf(e), 1);
      },
      after: () => () => undefined,
    },
  };
  const rc = new RemoteControlService(deps);
  return { rc, h, calls, sent, ui, injector, shortcuts, now: () => t };
}

const settle = async () => {
  for (let i = 0; i < 12; i++) await new Promise((r) => setTimeout(r, 0));
};

const session = (status: string, over: Record<string, unknown> = {}) => ({
  id: 9, share_id: 5, status, role: 'sharer' as const, pause_reason: null, caps: claims().caps, caps_label: 'Mouse and keyboard',
  controller: { id: 5, name: 'Olivia Chen', identity: 'u5-xyz' }, expires_at: null, key_version: 1, grant_waiting: false, type: 'meeting' as const, ...over,
});

/** Shares Screen 1, gets asked, allows with a real click, collects the grant and goes active. */
async function active(x = harness()) {
  await x.rc.shareStarted(11, { uuid: UUID, identity: 'u3-abc', allowRequests: true }, SCREEN);
  x.h.state = { shares: [{ id: 5, identity: 'u3-abc' }], asked: [], sessions: [session('CONTROL_APPROVED', { grant_waiting: true })] };
  x.h.grant = { token: token(claims()), key: KEY.toString('base64'), claims: claims(), public_key: PEM };
  await x.rc.poll();
  await settle();
  x.h.state = { ...x.h.state, sessions: [session('CONTROL_ACTIVE')] };
  await x.rc.poll();
  const keys = await importKeys(new Uint8Array(KEY));
  const sender = new ControlSender(claims(), keys, x.now);
  const send = async (type: Parameters<ControlSender['next']>[0], payload: unknown, from = 'u5-xyz') => {
    x.rc.packet(11, from, new TextDecoder().decode(await sender.next(type, payload)), type === 'ptr.move' ? 'rc.ctl.move' : 'rc.ctl');
    await settle();
  };
  return { ...x, send };
}

describe('sharing from WorkSuite Desktop', () => {
  it('is registered as a desktop share, with control offered only when this computer can take it', async () => {
    const x = harness();
    const r = await x.rc.shareStarted(11, { uuid: UUID, identity: 'u3-abc', quality: 'balanced', allowRequests: true }, SCREEN);
    expect(r).toEqual({ shareId: 5, controlOffered: true, why: null });
    expect(x.calls[0]).toEqual(['POST', `/api/meet/${UUID}/control/shares`, { identity: 'u3-abc', client: 'desktop', surface: 'screen', label: 'Screen 1', quality: 'balanced', allow_requests: true }]);

    const y = harness({ support: { available: false, reason: 'This is a Wayland session…' } });
    expect(await y.rc.shareStarted(11, { uuid: UUID, identity: 'u3-abc', allowRequests: true }, SCREEN)).toMatchObject({ controlOffered: false, why: 'This is a Wayland session…' });
    expect(y.calls[0]![2]).toMatchObject({ allow_requests: false });
  });
});

describe('consent (RC03, SEC-02)', () => {
  let x: ReturnType<typeof harness>;
  beforeEach(async () => {
    x = harness();
    await x.rc.shareStarted(11, { uuid: UUID, identity: 'u3-abc' }, SCREEN);
    x.h.state = { shares: [{ id: 5, identity: 'u3-abc' }], asked: [{ id: 21, session_id: 9, share_id: 5, kind: 'request', requester: { id: 5, name: 'Olivia Chen' }, reason: 'Fix the VPN', expires_in: 58 }], sessions: [] };
    await x.rc.poll();
  });

  it('opens a prompt for each request, and shows who asks and why', () => {
    expect(x.ui.showConsent).toHaveBeenCalledWith(21, expect.objectContaining({ id: 1 }));
    x.h.consentWc = 500;
    expect(x.rc.consent(500, false)).toMatchObject({ requester: 'Olivia Chen', reason: 'Fix the VPN', share: 'Screen 1', clipboard: 'off' });
    expect(() => x.rc.consent(501, false)).toThrow('That request has ended.');
  });

  it('allows only with a real click in that prompt', async () => {
    x.h.consentWc = 500;
    await expect(x.rc.answer(500, { decision: 'allow' }, false)).rejects.toMatchObject({ code: 'POLICY_DENIED' });
    x.rc.noteLocalInput(600);
    await expect(x.rc.answer(500, { decision: 'allow' }, false)).rejects.toMatchObject({ code: 'POLICY_DENIED' });
    x.rc.noteLocalInput(500);
    await x.rc.answer(500, { decision: 'allow', caps: { clipboard: 'text_files', file_transfer: true } }, false);
    const posted = x.calls.find(([, p]) => p.endsWith('/answer'));
    // The policy's defaults: no clipboard, and files only on managed computers (the server decides that part).
    expect(posted).toEqual(['POST', '/api/meet/control/requests/21/answer', { decision: 'allow', caps: { mouse: true, keyboard: true, clipboard: 'off', file_transfer: true, monitor_switch: false }, duration: 'until_stopped', local_input_proof: true }]);
    expect(x.ui.closeConsent).toHaveBeenCalledWith(21);
  });

  it('lets a request be denied without proof, and never allowed while WorkSuite is locked', async () => {
    x.h.consentWc = 500;
    x.rc.noteLocalInput(500);
    await expect(x.rc.answer(500, { decision: 'allow' }, true)).rejects.toMatchObject({ code: 'APP_LOCKED' });
    await x.rc.answer(500, { decision: 'deny' }, true);
    expect(x.calls.find(([, p]) => p.endsWith('/answer'))![2]).toMatchObject({ decision: 'deny', local_input_proof: false });
  });

  it('closes the prompt when the request goes away', async () => {
    x.h.state = { ...x.h.state, asked: [] };
    await x.rc.poll();
    expect(x.ui.closeConsent).toHaveBeenCalledWith(21);
  });
});

describe('control on this computer', () => {
  it('collects the grant once, confirms it, and puts the bar up', async () => {
    const x = await active();
    expect(x.calls.filter(([m, p]) => m === 'GET' && p.includes('/grant'))).toEqual([['GET', '/api/meet/control/sessions/9/grant', null]]);
    expect(x.calls).toContainEqual(['POST', '/api/meet/control/sessions/9/confirm', { end: 'sharer' }]);
    expect(x.ui.showIndicator).toHaveBeenCalled();
    expect(x.rc.view().session).toMatchObject({ controller: 'Olivia Chen', status: 'CONTROL_ACTIVE', waiting: null });
  });

  it('refuses a grant that does not check out, and stops', async () => {
    const x = harness();
    await x.rc.shareStarted(11, { uuid: UUID, identity: 'u3-abc' }, SCREEN);
    x.h.state = { shares: [{ id: 5, identity: 'u3-abc' }], asked: [], sessions: [session('CONTROL_APPROVED', { grant_waiting: true })] };
    x.h.grant = { token: token(claims({ sharer_identity: 'u3-someone-else' })), key: KEY.toString('base64'), claims: claims(), public_key: PEM };
    await x.rc.poll();
    await settle();
    expect(x.calls).toContainEqual(['POST', '/api/meet/control/sessions/9/stop', { reason: 'security' }]);
    expect(x.calls.some(([, p]) => p.endsWith('/confirm'))).toBe(false);
  });

  it('moves the pointer onto the shared screen for a genuine message', async () => {
    const x = await active();
    await x.send('ptr.move', { x: 0.5, y: 0.5 });
    expect(x.sent.at(-1)).toEqual([{ t: 'move', x: 960, y: 540 }]);
  });

  it('drops what another participant sends and reports it', async () => {
    const x = await active();
    await x.send('ptr.move', { x: 0.5, y: 0.5 }, 'u9-intruder');
    expect(x.sent).toEqual([]);
    x.h.tick(10_000);
    await settle();
    expect(x.calls).toContainEqual(['POST', '/api/meet/control/sessions/9/security', { kind: 'wrong_sender', count: 1 }]);
  });

  it('injects nothing while a consent prompt is open', async () => {
    const x = await active();
    x.h.consentOpen = true;
    await x.send('ptr.button', { x: 0.1, y: 0.1, button: 'left', down: true });
    expect(x.sent).toEqual([]);
  });

  it('lets the person here win: their mouse moves, the controller waits (RC-INP-04)', async () => {
    const x = await active();
    x.h.tick(100);
    x.h.advance(1_000);
    x.h.cursor = { x: 400, y: 300 };
    x.h.tick(100);
    expect(x.rc.view().session?.waiting).toBe('local');
    await x.send('ptr.move', { x: 0.5, y: 0.5 });
    expect(x.sent).toEqual([]);
    x.h.advance(1_600);
    await x.send('ptr.move', { x: 0.5, y: 0.5 });
    expect(x.sent).toHaveLength(1);
  });

  it('does not take the controller’s own move for the person here', async () => {
    const x = await active();
    x.h.tick(100);
    await x.send('ptr.move', { x: 0.5, y: 0.5 });
    x.h.cursor = { x: 960, y: 540 };
    x.h.advance(100);
    x.h.tick(100);
    expect(x.rc.view().session?.waiting).toBeNull();
  });

  it('pauses on a burst of clicks and tells the server why (SEC-14)', async () => {
    const x = await active();
    for (let i = 0; i < 11; i++) await x.send('ptr.button', { x: 0.2, y: 0.2, button: 'left', down: i % 2 === 0 });
    expect(x.calls).toContainEqual(['POST', '/api/meet/control/sessions/9/pause', { reason: 'security' }]);
    await settle();
    expect(x.calls).toContainEqual(['POST', '/api/meet/control/sessions/9/security', { kind: 'input_burst', count: 1 }]);
    const n = x.sent.length;
    await x.send('ptr.move', { x: 0.5, y: 0.5 });
    expect(x.sent).toHaveLength(n);
  });

  it('stops everything on the emergency chord, and lets go of held keys', async () => {
    const x = await active();
    await x.send('key', { code: 'ShiftLeft', down: true, shift: true });
    expect(x.shortcuts.size).toBeGreaterThan(0);
    [...x.shortcuts.values()][0]!();
    await settle();
    expect(x.calls).toContainEqual(['POST', '/api/meet/control/sessions/9/stop', { reason: 'emergency_stop' }]);
    expect(x.sent.flat()).toContainEqual({ t: 'key', code: 'ShiftLeft', down: false });
    expect(x.ui.hideIndicator).toHaveBeenCalled();
    expect(x.shortcuts.size).toBe(0);
  });

  it('pauses when the screen locks', async () => {
    const x = await active();
    x.rc.onSystem('lock-screen');
    await settle();
    expect(x.calls).toContainEqual(['POST', '/api/meet/control/sessions/9/pause', { reason: 'lock_screen' }]);
    await x.send('ptr.move', { x: 0.5, y: 0.5 });
    expect(x.sent).toEqual([]);
  });

  it('keeps a pause made here until the person resumes and the key rotates', async () => {
    const x = await active();
    await x.rc.pause(9, 'sharer');
    // A read that still says active (the server has not caught up) does not undo it.
    await x.rc.poll();
    await x.send('ptr.move', { x: 0.5, y: 0.5 });
    expect(x.sent).toEqual([]);
    expect(x.rc.view().session?.status).toBe('CONTROL_PAUSED');
    // Resumed: a new key, collected and confirmed, and input flows again.
    const c2 = claims({ key_version: 2 });
    x.h.grant = { token: token(c2), key: KEY.toString('base64'), claims: c2, public_key: PEM };
    x.h.state = { ...x.h.state, sessions: [session('CONTROL_ACTIVE', { key_version: 2, grant_waiting: true })] };
    x.h.advance(1);
    await x.rc.poll();
    await settle();
    expect(x.calls.filter(([, p]) => p.endsWith('/confirm'))).toHaveLength(2);
    expect(x.rc.view().session?.status).toBe('CONTROL_ACTIVE');
  });

  it('never takes up again a session it stopped', async () => {
    const x = await active();
    await x.rc.stop(9);
    await x.rc.poll();
    expect(x.rc.isLive()).toBe(false);
    expect(x.ui.showIndicator).toHaveBeenCalledTimes(1);
  });

  it('resumes only from the bar, with a real click there', async () => {
    const x = await active();
    await expect(x.rc.resume(500, 9)).rejects.toMatchObject({ code: 'IPC_FORBIDDEN_SENDER' });
    await expect(x.rc.resume(600, 9)).rejects.toMatchObject({ code: 'POLICY_DENIED' });
    x.rc.noteLocalInput(600);
    await x.rc.resume(600, 9);
    expect(x.calls).toContainEqual(['POST', '/api/meet/control/sessions/9/resume', { local_input_proof: true }]);
  });

  it('does not count a click that came right after something was injected', async () => {
    const x = await active();
    await x.send('ptr.button', { x: 0.5, y: 0.5, button: 'left', down: true });
    x.h.advance(100);
    x.rc.noteLocalInput(600);
    expect(x.rc.hasProof(600)).toBe(false);
    x.h.advance(2_000);
    x.rc.noteLocalInput(600);
    expect(x.rc.hasProof(600)).toBe(true);
  });

  it('never sends Ctrl+Alt+Delete, and says so', async () => {
    const x = await active();
    await x.send('special', { combo: 'Ctrl+Alt+Delete' });
    expect(x.sent).toEqual([]);
    expect(x.ui.notify).toHaveBeenCalledWith(expect.stringContaining('Ctrl+Alt+Delete'));
  });

  it('ends when the server says so, and when the meeting window goes', async () => {
    const x = await active();
    x.h.state = { ...x.h.state, sessions: [] };
    await x.rc.poll();
    expect(x.rc.isLive()).toBe(false);
    expect(x.injector.stop).toHaveBeenCalled();
    x.rc.windowGone(11);
    await settle();
    expect(x.calls).toContainEqual(['DELETE', `/api/meet/${UUID}/control/shares/5`, null]);
    expect(x.rc.isSharing()).toBe(false);
  });
});

describe('files in a session (RC06)', () => {
  async function withFiles() {
    const x = harness();
    const caps = { ...claims().caps, file_transfer: true };
    const c = claims({ caps });
    await x.rc.shareStarted(11, { uuid: UUID, identity: 'u3-abc' }, SCREEN);
    x.h.state = { shares: [{ id: 5, identity: 'u3-abc' }], asked: [], sessions: [session('CONTROL_APPROVED', { grant_waiting: true, caps })] };
    x.h.grant = { token: token(c), key: KEY.toString('base64'), claims: c, public_key: PEM };
    await x.rc.poll();
    await settle();
    x.h.state = { ...x.h.state, sessions: [session('CONTROL_ACTIVE', { caps })] };
    return x;
  }
  const row = { id: 31, session_id: 9, direction: 'to_sharer', sender: { id: 5, name: 'Olivia Chen' }, name: 'fix.log', size: 2048, executable: false, scan: 'clean', status: 'offered' };

  it('lists what the controller offered and says so', async () => {
    const x = await withFiles();
    (x.rc as unknown as { deps: RemoteControlDeps }).deps.http.get = async <T,>(path: string) => (path.endsWith('/files') ? ({ files: [row, { ...row, id: 32, direction: 'to_controller' }] } as T) : (x.h.state as T));
    await x.rc.poll();
    expect(x.rc.view().offers).toEqual([{ id: 31, sessionId: 9, name: 'fix.log', size: 2048, from: 'Olivia Chen', executable: false, scan: 'clean' }]);
    expect(x.rc.view().canSendFiles).toBe(true);
    expect(x.ui.notify).toHaveBeenCalledWith(expect.stringContaining('Olivia Chen wants to send you fix.log'));
  });

  it('accepts only from the bar with a real click, then fetches it with its one-time token', async () => {
    const x = await withFiles();
    const deps = (x.rc as unknown as { deps: RemoteControlDeps }).deps;
    deps.http.get = async <T,>(path: string) => (path.endsWith('/files') ? ({ files: [row] } as T) : (x.h.state as T));
    const request = deps.http.request;
    deps.http.request = async <T,>(method: string, path: string, o?: { body?: unknown }) => (path.endsWith('/31/accept') ? ({ download: '/api/meet/control/files/31/download?t=abcdefabcdefabcdef12' } as T) : request<T>(method, path, o));
    await x.rc.poll();
    await expect(x.rc.answerFile(500, { id: 31, accept: true }, false)).rejects.toMatchObject({ code: 'IPC_FORBIDDEN_SENDER' });
    await expect(x.rc.answerFile(600, { id: 31, accept: true }, false)).rejects.toMatchObject({ code: 'POLICY_DENIED' });
    x.rc.noteLocalInput(600);
    expect(await x.rc.answerFile(600, { id: 31, accept: true }, false)).toEqual({ status: 'accepted' });
    expect(deps.files.download).toHaveBeenCalledWith('/api/meet/control/files/31/download?t=abcdefabcdefabcdef12', 'fix.log');
    expect(x.rc.view().offers).toEqual([]);
  });

  it('asks again before taking a program', async () => {
    const x = await withFiles();
    const deps = (x.rc as unknown as { deps: RemoteControlDeps }).deps;
    deps.http.get = async <T,>(path: string) => (path.endsWith('/files') ? ({ files: [{ ...row, name: 'fix.exe', executable: true }] } as T) : (x.h.state as T));
    const { DesktopError } = await import('../../../electron/main/errors');
    deps.http.request = async <T,>(_m: string, path: string) => {
      if (path.endsWith('/accept')) throw new DesktopError('INTERNAL', 'fix.exe is a program. Confirm…', 428, { code: 'confirm_executable' });
      return {} as T;
    };
    await x.rc.poll();
    x.rc.noteLocalInput(600);
    expect(await x.rc.answerFile(600, { id: 31, accept: true }, false)).toMatchObject({ status: 'confirm', confirmExecutable: true });
  });

  it('injects nothing while the person picks a file to send', async () => {
    const x = await withFiles();
    const deps = (x.rc as unknown as { deps: RemoteControlDeps }).deps;
    await x.rc.poll();
    const keys = await importKeys(new Uint8Array(KEY));
    const sender = new ControlSender(claims({ caps: { ...claims().caps, file_transfer: true } }), keys, x.now);
    let during = -1;
    deps.files.pickAndOffer = vi.fn(async () => {
      x.rc.packet(11, 'u5-xyz', new TextDecoder().decode(await sender.next('ptr.move', { x: 0.5, y: 0.5 })), 'rc.ctl.move');
      await settle();
      during = x.sent.length;
      return 1;
    });
    await expect(x.rc.sendFile(600, 9)).rejects.toMatchObject({ code: 'POLICY_DENIED' });
    x.rc.noteLocalInput(600);
    expect(await x.rc.sendFile(600, 9)).toEqual({ sent: 1 });
    expect(during).toBe(0);
  });
});

describe('words on the bar', () => {
  it('say why control is paused, and which apps pause it', () => {
    expect(pauseText('protected_app')).toMatch(/password manager/);
    expect(pauseText(null)).toBe('You paused control.');
    expect(isProtected({ app: '1Password 7', title: '' })).toBe(true);
    expect(isProtected({ app: 'Code', title: 'budget.xlsx' })).toBe(false);
  });
});
