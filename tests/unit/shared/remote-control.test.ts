import { describe, expect, it } from 'vitest';
import vector from '../../fixtures/rc-channel.vector.json';
import { ControlReceiver, ControlSender, acceleratorsFor, chordOf, importKeys, normalise, open, parseEnvelope, seal, type Envelope, type GrantClaims } from '@shared/remote-control/channel';

const hex = (h: string) => new Uint8Array(h.match(/../g)!.map((b) => parseInt(b, 16)));

describe('the control channel', () => {
  it('seals exactly the bytes the server reference does (SEC-05, SEC-08)', async () => {
    const keys = await importKeys(hex(vector.key_hex));
    const env = await seal(keys, vector.grant_id, vector.seq, vector.type, vector.lease_until, JSON.parse(vector.payload_json), hex(vector.iv_hex));

    expect(env).toEqual(vector.envelope);
    expect(await open(keys, vector.envelope as Envelope)).toEqual(JSON.parse(vector.payload_json));
  });

  it('refuses anything altered or sealed with another key', async () => {
    const keys = await importKeys(hex(vector.key_hex));
    const other = await importKeys(new Uint8Array(32));
    const env = vector.envelope as Envelope;

    expect(await open(other, env)).toBeNull();
    expect(await open(keys, { ...env, s: env.s + 1 })).toBeNull();
    expect(await open(keys, { ...env, t: 'key' })).toBeNull();
    expect(await open(keys, { ...env, l: env.l + 3600 })).toBeNull();
  });
});

describe('what the sharer accepts (§B.4)', () => {
  const now = 1_790_000_000_000;
  const claims: GrantClaims = {
    grant_id: 'g-1', session_id: 1, meeting_id: 'm', sharer_identity: 'u3-a', controller_identity: 'u5-b',
    caps: { mouse: true, keyboard: true, clipboard: 'off', file_transfer: false, monitor_switch: false },
    exp: now / 1000 + 600, lease_s: 30, lease_renew_s: 10, key_version: 1,
  };

  async function pair(c: GrantClaims = claims) {
    const keys = await importKeys(new Uint8Array(32).fill(7));
    let t = now;
    const clock = () => t;
    const sender = new ControlSender(c, keys, clock);
    const receiver = new ControlReceiver(c, keys, clock);
    const send = async (type: Parameters<ControlSender['next']>[0], payload: unknown) => JSON.parse(new TextDecoder().decode(await sender.next(type, payload))) as Envelope;

    return { keys, sender, receiver, send, advance: (ms: number) => { t += ms; } };
  }

  it('takes a genuine move from the controller while control is active', async () => {
    const { receiver, send } = await pair();
    expect(await receiver.accept(await send('ptr.move', { x: 0.5, y: 0.5 }), 'u5-b', true)).toMatchObject({ ok: true, type: 'ptr.move' });
  });

  it('drops another participant\'s message even with the right key (SEC-07, AC-S08)', async () => {
    const { receiver, send } = await pair();
    expect(await receiver.accept(await send('ptr.move', { x: 0.5, y: 0.5 }), 'u9-intruder', true)).toEqual({ ok: false, reason: 'wrong_sender' });
  });

  it('drops a replay (SEC-06)', async () => {
    const { receiver, send } = await pair();
    const env = await send('ptr.button', { button: 'left', down: true });
    expect((await receiver.accept(env, 'u5-b', true)).ok).toBe(true);
    expect(await receiver.accept(env, 'u5-b', true)).toEqual({ ok: false, reason: 'stale_sequence' });
  });

  it('takes a click that a later move overtook — moves travel on their own channel (RC-INP-02)', async () => {
    const { receiver, send } = await pair();
    const click = await send('ptr.button', { x: 0.2, y: 0.2, button: 'left', down: true });
    const move = await send('ptr.move', { x: 0.3, y: 0.3 });
    expect((await receiver.accept(move, 'u5-b', true)).ok).toBe(true);
    expect((await receiver.accept(click, 'u5-b', true)).ok).toBe(true);
    expect(await receiver.accept(click, 'u5-b', true)).toEqual({ ok: false, reason: 'stale_sequence' });
    expect(await receiver.accept(move, 'u5-b', true)).toEqual({ ok: false, reason: 'stale_sequence' });
  });

  it('drops input while paused, after the lease lapses, and beyond the grant', async () => {
    const { receiver, send, advance } = await pair();
    expect(await receiver.accept(await send('key', { code: 'KeyA', down: true }), 'u5-b', false)).toEqual({ ok: false, reason: 'state' });
    expect((await receiver.accept(await send('lease', {}), 'u5-b', false)).ok).toBe(true);

    const stale = await send('ptr.move', { x: 0.1, y: 0.1 });
    advance(31_000);
    expect(await receiver.accept(stale, 'u5-b', true)).toEqual({ ok: false, reason: 'lease' });
  });

  it('drops what the grant does not allow (SEC-04, AC-S07)', async () => {
    const { receiver, send } = await pair();
    expect(await receiver.accept(await send('clip', { text: 'x' }), 'u5-b', true)).toEqual({ ok: false, reason: 'capability' });
    expect(await receiver.accept(await send('display', { display: 2 }), 'u5-b', true)).toEqual({ ok: false, reason: 'capability' });
  });

  it('drops coordinates off the shared surface (SEC-13)', async () => {
    const { receiver, send } = await pair();
    expect(await receiver.accept(await send('ptr.move', { x: 1.2, y: 0.5 }), 'u5-b', true)).toEqual({ ok: false, reason: 'out_of_bounds' });
  });

  it('never injects the emergency stop or a lock chord (RC-KBD-05, AC-S15)', async () => {
    const { receiver, send } = await pair();
    expect(await receiver.accept(await send('key', { ctrl: true, alt: true, shift: true, code: 'Escape', down: true }), 'u5-b', true)).toEqual({ ok: false, reason: 'reserved_chord' });
    expect(await receiver.accept(await send('special', { combo: 'Meta+L' }), 'u5-b', true)).toEqual({ ok: false, reason: 'reserved_chord' });
    expect((await receiver.accept(await send('special', { combo: 'Alt+Tab' }), 'u5-b', true)).ok).toBe(true);
  });

  it('pauses on a burst: more than ten clicks in a second (SEC-14)', async () => {
    const { receiver, send } = await pair();
    const verdicts = [];
    for (let i = 0; i < 11; i++) verdicts.push(await receiver.accept(await send('ptr.button', { button: 'left', down: true }), 'u5-b', true));

    expect(verdicts.slice(0, 10).every((v) => v.ok)).toBe(true);
    expect(verdicts[10]).toEqual({ ok: false, reason: 'input_burst' });
  });
});

describe('pointer coordinates', () => {
  it('are measured on the picture, not the letterboxed box', () => {
    // A 1600×900 picture in a 1000×1000 box: bars of 218.75px above and below.
    const box = { left: 0, top: 0, width: 1000, height: 1000 };
    expect(normalise(500, 500, box, 1600, 900)).toEqual({ x: 0.5, y: 0.5 });
    expect(normalise(0, 218.75, box, 1600, 900)).toEqual({ x: 0, y: 0 });
    expect(normalise(500, 100, box, 1600, 900)).toBeNull();
  });

  it('name chords in one order', () => {
    expect(chordOf({ shift: true, ctrl: true, alt: true, code: 'Escape' })).toBe('Ctrl+Alt+Shift+Esc');
    expect(chordOf({ meta: true, code: 'KeyL' })).toBe('Meta+L');
  });
});

describe('the emergency stop as a shortcut', () => {
  it('becomes an Electron accelerator, with Command as well on a Mac', () => {
    expect(acceleratorsFor('Ctrl+Alt+Shift+Esc', 'win32')).toEqual(['Control+Alt+Shift+Escape']);
    expect(acceleratorsFor('Ctrl+Alt+Shift+Esc', 'darwin')).toEqual(['Control+Alt+Shift+Escape', 'Command+Alt+Shift+Escape']);
    expect(acceleratorsFor('Esc', 'linux')).toEqual([]);
  });
});

describe('envelopes off the wire', () => {
  it('are taken only when shaped like one', () => {
    expect(parseEnvelope(JSON.stringify(vector.envelope))).toEqual(vector.envelope);
    expect(parseEnvelope('{"g":1}')).toBeNull();
    expect(parseEnvelope('not json')).toBeNull();
    expect(parseEnvelope('x'.repeat(20_000))).toBeNull();
  });
});
