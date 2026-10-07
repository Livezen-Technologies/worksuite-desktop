import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as CoreApi from '../../../src/core/api';

vi.mock('sip.js', () => {
  class Invitation {}
  class Inviter {
    stateChange = { addListener: vi.fn() };
    invite = vi.fn(async () => ({}));
    cancel = vi.fn(async () => undefined);
    constructor(
      readonly ua: unknown,
      readonly uri: unknown,
    ) {}
  }
  return {
    Invitation,
    Inviter,
    Registerer: class {},
    RegistererState: { Registered: 'Registered', Unregistered: 'Unregistered' },
    SessionState: { Initial: 'Initial', Establishing: 'Establishing', Established: 'Established', Terminated: 'Terminated' },
    UserAgent: { makeURI: (s: string) => ({ toString: () => s }) },
  };
});
vi.mock('../../../src/modules/calls/tones', () => ({ playTone: vi.fn(() => ({ stop: vi.fn(), setVolume: vi.fn() })), playOnce: vi.fn(), ringVolume: () => 0.5 }));
vi.mock('../../../src/core/api', async (orig) => ({ ...(await orig<typeof CoreApi>()), apiGet: vi.fn(), apiPost: vi.fn() }));

import { Invitation, Inviter } from 'sip.js';
import { ApiError, apiGet, apiPost } from '../../../src/core/api';
import { playOnce, playTone } from '../../../src/modules/calls/tones';
import { answeredElsewhere, INITIAL, phaseLabel, PhoneEngine, sipTarget, viaOf } from '../../../src/modules/phone/softphone/engine';
import { isHostWindow } from '../../../src/modules/phone/softphone/client';

/**
 * The softphone's call handling (WS-VOIP-SRS-001 WF-05/06/07): placing calls through the switch with the ring-back
 * answered here, falling back to direct SIP, call waiting, DND, and what counts as a missed call.
 */
type Fake = Invitation & {
  request: { getHeader: (h: string) => string | null };
  remoteIdentity: { uri: { user: string }; displayName: string };
  assertedIdentity?: undefined;
  stateChange: { addListener: ReturnType<typeof vi.fn> };
  accept: ReturnType<typeof vi.fn>;
  reject: ReturnType<typeof vi.fn>;
  delegate?: { onCancel?: (c: { request: { getHeader: (h: string) => string | null } }) => void };
};

function invitation(user: string, name = '', alertInfo: string | null = null): Fake {
  const f = Object.create(Invitation.prototype) as Fake;
  Object.assign(f, {
    request: { getHeader: (h: string) => (h === 'Alert-Info' ? alertInfo : null) },
    remoteIdentity: { uri: { user }, displayName: name },
    stateChange: { addListener: vi.fn() },
    accept: vi.fn(async () => undefined),
    reject: vi.fn(async () => undefined),
  });
  return f;
}

function registered(e: PhoneEngine) {
  e.store.set({ phase: 'registered', extension: '1042', name: 'Hasini J.', domain: 'pbx.example.lk' });
  (e as unknown as { ua: unknown }).ua = {};
  (e as unknown as { self: Set<string> }).self = new Set(['1042', 'hasini j.', '112447000']);
}

const ring = (e: PhoneEngine, inv: Fake) => (e as unknown as { incoming: (i: Fake) => void }).incoming(inv);

beforeEach(() => {
  vi.mocked(apiGet).mockReset();
  vi.mocked(apiPost).mockReset();
  vi.mocked(apiGet).mockImplementation((async (path: string) => {
    if (path === '/api/voip/screen-pop') return { context: { number: '0773124408', matched: true, confidence: 'contact', contact: { id: 9, name: 'Nimal Perera', company: 'Lanka Agro Exports' }, account: null, lead: null, deals: [], quotes: [], invoices: [], tasks: [], meetings: [], calls: [] } };
    if (path === '/api/voip/calls') return { calls: [], page: 1, per_page: 10, total: 0 };
    throw new Error(`unexpected ${path}`);
  }) as never);
});

describe('placing a call (WF-05)', () => {
  it('without a softphone here, asks the switch to ring the desk phone first', async () => {
    const e = new PhoneEngine();
    vi.mocked(apiPost).mockResolvedValue({ call_id: 5, message: 'Ringing', channel: '', context: null } as never);
    const r = await e.dial('+94 77 312 4408', { contactId: 9 });
    expect(apiPost).toHaveBeenCalledWith('/api/voip/call', { number: '+94773124408', contact_id: 9 });
    expect(r).toEqual({ ok: true, message: 'Your phone is ringing. Pick it up to be connected.' });
  });

  it('refuses what cannot be dialled before asking anyone', async () => {
    const e = new PhoneEngine();
    expect(await e.dial('call me')).toEqual({ ok: false, message: 'That is not a number that can be dialled.' });
    expect(apiPost).not.toHaveBeenCalled();
  });

  it('answers the switch’s ring-back here, and that line is the outbound call with its record', async () => {
    const e = new PhoneEngine();
    registered(e);
    const back = invitation('112447000', 'Hasini J.');
    vi.mocked(apiPost).mockImplementation((async () => {
      ring(e, back);
      return { call_id: 77, message: 'Ringing', channel: '', context: { matched: true, contact: { name: 'Nimal Perera' } } };
    }) as never);
    const r = await e.dial('0773124408');
    expect(r.ok).toBe(true);
    expect(back.accept).toHaveBeenCalled();
    const line = e.state.lines[0]!;
    expect(line).toMatchObject({ direction: 'outbound', remote: '0773124408', callId: 77, direct: false });
    expect(line.remoteName).toBe('Nimal Perera');
  });

  it('lets anyone else ring as usual while it waits for the ring-back', async () => {
    const e = new PhoneEngine();
    registered(e);
    vi.mocked(apiPost).mockImplementation((async () => {
      ring(e, invitation('0711111111', 'Ceylon Tea Traders'));
      return { call_id: 78, message: 'Ringing', channel: '', context: null };
    }) as never);
    await e.dial('0773124408');
    const line = e.state.lines.find((l) => l.remote === '0711111111')!;
    expect(line).toMatchObject({ direction: 'inbound', state: 'ringing' });
  });

  it('dials directly when the server cannot reach its switch, and says the call is not in the history yet', async () => {
    const e = new PhoneEngine();
    registered(e);
    vi.mocked(apiPost).mockRejectedValue(new ApiError(503, 'No PBX is reachable.', null));
    const r = await e.dial('0773124408');
    expect(r).toEqual({ ok: true, message: 'Placed directly: this call is not in the history until the phone system reports it.' });
    const line = e.state.lines[0]!;
    expect(line).toMatchObject({ direction: 'outbound', direct: true, state: 'dialing' });
    expect(vi.mocked(Inviter).prototype).toBeDefined();
  });

  it('passes the server’s own refusal through (no extension)', async () => {
    const e = new PhoneEngine();
    registered(e);
    vi.mocked(apiPost).mockRejectedValue(new ApiError(409, 'You do not have an extension, so a call cannot be placed from your account.', null));
    expect(await e.dial('0773124408')).toEqual({ ok: false, message: 'You do not have an extension, so a call cannot be placed from your account.' });
  });
});

describe('ringing (WF-06)', () => {
  it('rings with who is calling and the queue they came through', async () => {
    const e = new PhoneEngine();
    const notify = vi.fn();
    e.notify = notify;
    registered(e);
    ring(e, invitation('0773124408', 'Nimal Perera', '<http://x>;info=Sales queue 600'));
    const line = e.state.lines[0]!;
    expect(line).toMatchObject({ direction: 'inbound', state: 'ringing', remote: '0773124408', via: 'Sales queue 600' });
    expect(notify).toHaveBeenCalledWith(expect.objectContaining({ kind: 'incoming', title: 'Incoming call from Nimal Perera' }));
    await vi.waitFor(() => expect(e.state.lines[0]!.context?.contact?.name).toBe('Nimal Perera'));
  });

  it('a caller who hangs up is a missed call; one answered elsewhere is not', () => {
    const e = new PhoneEngine();
    const notify = vi.fn();
    e.notify = notify;
    registered(e);
    const gone = invitation('0711111111');
    ring(e, gone);
    gone.delegate!.onCancel!({ request: { getHeader: () => null } });
    expect(e.state.missed).toHaveLength(1);
    expect(notify).toHaveBeenLastCalledWith(expect.objectContaining({ kind: 'missed' }));
    const taken = invitation('0722222222');
    ring(e, taken);
    taken.delegate!.onCancel!({ request: { getHeader: () => 'SIP;cause=200;text="Call completed elsewhere"' } });
    expect(e.state.missed).toHaveLength(1);
  });

  it('sends callers to voicemail with Do not disturb, and while locked', () => {
    const e = new PhoneEngine();
    registered(e);
    e.setDnd(true);
    const a = invitation('0711111111');
    ring(e, a);
    expect(a.reject).toHaveBeenCalledWith({ statusCode: 486 });
    expect(e.state.lines).toHaveLength(0);
    e.setDnd(false);
    e.setLocked(true);
    const b = invitation('0722222222');
    ring(e, b);
    expect(b.reject).toHaveBeenCalledWith({ statusCode: 486 });
    expect(e.state.missed).toHaveLength(2);
  });

  it('declines (603) or sends to voicemail (486)', async () => {
    const e = new PhoneEngine();
    registered(e);
    const a = invitation('0711111111');
    ring(e, a);
    await e.decline(e.state.lines[0]!.id, true);
    expect(a.reject).toHaveBeenCalledWith({ statusCode: 486 });
    expect(e.state.lines[0]!.endReason).toBe('Sent to voicemail');
    const b = invitation('0722222222');
    ring(e, b);
    await e.decline(e.state.lines.find((l) => l.remote === '0722222222')!.id);
    expect(b.reject).toHaveBeenCalledWith({ statusCode: 603 });
  });
});

describe('ringing by the status (#288)', () => {
  it('Available rings out loud with an ordinary banner', () => {
    const e = new PhoneEngine();
    const notify = vi.fn();
    e.notify = notify;
    registered(e);
    ring(e, invitation('0773124408', 'Nimal Perera'));
    expect(playTone).toHaveBeenCalledWith('ring', 0.5);
    expect(notify).toHaveBeenCalledWith({ kind: 'incoming', id: expect.stringMatching(/^phone-ring:/), title: 'Incoming call from Nimal Perera', body: '0773124408' });
  });

  it('Busy rings on screen only: no ring tone, no call-waiting beep, a silent banner', () => {
    const e = new PhoneEngine();
    const notify = vi.fn();
    e.notify = notify;
    registered(e);
    e.setStatus('busy');
    ring(e, invitation('0773124408', 'Nimal Perera'));
    expect(e.state.lines[0]).toMatchObject({ state: 'ringing', remote: '0773124408' });
    expect(playTone).not.toHaveBeenCalled();
    expect(notify).toHaveBeenCalledWith(expect.objectContaining({ kind: 'incoming', delivery: 'silent' }));
    // On a call, a second caller: no beep in the ear either.
    e.store.set((s) => ({ lines: s.lines.map((l) => ({ ...l, state: 'connected' as const })) }));
    ring(e, invitation('0711111111'));
    expect(playOnce).not.toHaveBeenCalled();
  });

  it('going Busy while a call rings silences it, and the call stays to be answered', () => {
    const e = new PhoneEngine();
    registered(e);
    ring(e, invitation('0773124408'));
    const tone = vi.mocked(playTone).mock.results[0]!.value as { stop: ReturnType<typeof vi.fn> };
    e.setStatus('busy');
    expect(tone.stop).toHaveBeenCalled();
    expect(e.state.lines[0]!.state).toBe('ringing');
  });

  it('Do not disturb turns the caller away to voicemail; the missed call is kept, in the bell without a banner', () => {
    const e = new PhoneEngine();
    const notify = vi.fn();
    e.notify = notify;
    registered(e);
    e.setStatus('dnd');
    expect(e.state.dnd).toBe(true);
    const a = invitation('0773124408', 'Nimal Perera');
    ring(e, a);
    expect(a.reject).toHaveBeenCalledWith({ statusCode: 486 });
    expect(e.state.lines).toHaveLength(0);
    expect(e.state.missed).toEqual([expect.objectContaining({ remote: '0773124408', name: 'Nimal Perera' })]);
    expect(playTone).not.toHaveBeenCalled();
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith({ kind: 'missed', id: expect.stringMatching(/^phone-missed:/), title: 'Missed call from Nimal Perera', body: '0773124408 · Do not disturb: sent to voicemail', delivery: 'bell' });
  });

  it('Away does not ring here either: the switch’s busy path forwards or takes a message', () => {
    const e = new PhoneEngine();
    const notify = vi.fn();
    e.notify = notify;
    registered(e);
    e.setStatus('away');
    const a = invitation('0711111111');
    ring(e, a);
    expect(a.reject).toHaveBeenCalledWith({ statusCode: 486 });
    expect(e.state.missed).toHaveLength(1);
    expect(notify).toHaveBeenCalledWith(expect.objectContaining({ kind: 'missed', delivery: 'bell', body: '0711111111 · Away: sent to your forwarding or voicemail' }));
  });

  it('keeps the status through a stop that finishes late', async () => {
    const e = new PhoneEngine();
    e.setStatus('dnd');
    await e.stop();
    expect(e.state).toMatchObject({ phase: 'stopped', status: 'dnd', dnd: true });
  });
});

describe('small rules', () => {
  it('reads the queue from Alert-Info or a display prefix', () => {
    expect(viaOf('<http://127.0.0.1>;info=Support queue 610', null)).toBe('Support queue 610');
    expect(viaOf(null, 'Sales queue: Nimal Perera')).toBe('Sales queue');
    expect(viaOf(null, 'Nimal Perera')).toBeNull();
  });

  it('knows a call answered on another phone', () => {
    expect(answeredElsewhere('SIP;cause=200;text="Call completed elsewhere"')).toBe(true);
    expect(answeredElsewhere('Q.850;cause=16')).toBe(false);
    expect(answeredElsewhere(null)).toBe(false);
  });

  it('addresses only dialable targets on the phone’s own domain', () => {
    expect(sipTarget('+94 77 312 4408', 'pbx.example.lk')).toBe('sip:+94773124408@pbx.example.lk');
    expect(sipTarget('*43', 'pbx.example.lk')).toBe('sip:*43@pbx.example.lk');
    expect(sipTarget('x@evil', 'pbx.example.lk')).toBeNull();
  });

  it('says the registration plainly (W01 chip)', () => {
    expect(phaseLabel({ ...INITIAL, phase: 'registered', extension: '1042' })).toEqual({ text: 'Ext 1042 · Registered', tone: 'success' });
    expect(phaseLabel({ ...INITIAL, phase: 'no-extension' }).text).toBe('No extension');
    expect(phaseLabel({ ...INITIAL, phase: 'needs-reload', extension: '1042' }).tone).toBe('warning');
  });

  it('holds the phone in the main window only', () => {
    expect(isHostWindow('')).toBe(true);
    expect(isHostWindow('#/phone')).toBe(true);
    expect(isHostWindow('#/window/phone?route=%2Fphone%2Fcompact')).toBe(false);
  });
});
