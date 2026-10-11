import { describe, expect, it } from 'vitest';
import { iceChecks, udpLeaves, type IceProbeResult } from '../../../shared/ice-probe';

/**
 * What a gathering of ICE candidates is allowed to claim (RC09).
 *
 * This row used to say the media path could not be known from a settings page.
 * It can — against the STUN and TURN servers the deployment hands out — and
 * the thing to protect now is that it claims exactly what it measured: that
 * UDP left this network, or that the relay answered, and never that a call
 * will be good.
 */

const result = (over: Partial<IceProbeResult> = {}): IceProbeResult => ({
  candidates: [],
  ms: 120,
  timedOut: false,
  relayOffered: true,
  ...over,
});
const row = (r: IceProbeResult | null, id: string) => iceChecks(r).find((c) => c.id === id);

describe('whether UDP leaves this network', () => {
  it('is proved by a reflexive candidate', () => {
    expect(udpLeaves([{ type: 'srflx', protocol: 'udp' }])).toBe(true);
  });

  it('is proved by a relay reached over UDP, when no direct path was found', () => {
    expect(udpLeaves([{ type: 'host', protocol: 'udp' }, { type: 'relay', protocol: 'udp', relayProtocol: 'udp' }])).toBe(true);
  });

  it('is not proved by a relay reached over TCP', () => {
    expect(udpLeaves([{ type: 'relay', protocol: 'udp', relayProtocol: 'tcp' }])).toBe(false);
  });

  it('is not proved by this computer’s own addresses', () => {
    expect(udpLeaves([{ type: 'host', protocol: 'udp' }, { type: 'host', protocol: 'tcp' }])).toBe(false);
  });
});

describe('the UDP row', () => {
  it('passes, and says what it measured rather than that calls will be good', () => {
    const r = row(result({ candidates: [{ type: 'srflx', protocol: 'udp' }] }), 'meet-udp')!;

    expect(r.status).toBe('pass');
    expect(r.detail).toMatch(/reached the internet and came back in 120 ms/);
    expect(r.detail).not.toMatch(/quality will|will be good/);
  });

  it('warns, and names the cost, when only a TCP relay answered', () => {
    const r = row(result({ candidates: [{ type: 'host' }, { type: 'relay', relayProtocol: 'tcp' }] }), 'meet-udp')!;

    expect(r.status).toBe('warn');
    expect(r.detail).toMatch(/fall back to a relay over TCP/);
  });

  it('says plainly that nothing got out when nothing did', () => {
    const r = row(result({ candidates: [{ type: 'host', protocol: 'udp' }] }), 'meet-udp')!;

    expect(r.status).toBe('warn');
    expect(r.detail).toMatch(/Nothing left this computer/);
    expect(r.detail).toMatch(/will not connect from this network/);
  });
});

describe('the relay row', () => {
  it('passes when the relay answered over UDP', () => {
    expect(row(result({ candidates: [{ type: 'relay', relayProtocol: 'udp' }] }), 'meet-relay')).toMatchObject({ status: 'pass' });
  });

  it('passes but says TCP only, which is the honest half-answer', () => {
    const r = row(result({ candidates: [{ type: 'relay', relayProtocol: 'tcp' }] }), 'meet-relay')!;

    expect(r.status).toBe('pass');
    expect(r.detail).toMatch(/over TCP only/);
  });

  it('warns when a relay was offered and did not answer', () => {
    expect(row(result({ candidates: [{ type: 'srflx' }] }), 'meet-relay')).toMatchObject({ status: 'warn' });
  });

  it('is nothing to check where the deployment hands out no relay', () => {
    // A choice, not a fault of this computer.
    const r = row(result({ relayOffered: false, candidates: [{ type: 'srflx' }] }), 'meet-relay')!;

    expect(r.status).toBe('skip');
    expect(r.detail).toMatch(/hands out no relay/);
  });
});

describe('before it has run, and when it cannot', () => {
  it('says it has not been measured rather than showing a tick', () => {
    const r = row(null, 'meet-media')!;

    expect(r.status).toBe('skip');
    expect(r.detail).toMatch(/Not measured yet/);
  });

  it('says why it could not be measured', () => {
    const r = row(result({ error: 'this server hands out no STUN or relay servers' }), 'meet-media')!;

    expect(r.status).toBe('skip');
    expect(r.detail).toMatch(/Not measured: this server hands out no STUN/);
  });

  it('admits when gathering was cut short, instead of reporting a partial answer as whole', () => {
    const rows = iceChecks(result({ candidates: [{ type: 'srflx' }], timedOut: true }));

    expect(rows.find((r) => r.id === 'meet-media-timeout')?.detail).toMatch(/did not finish in time/);
  });
});
