import type { DiagnosticCheck } from './types';

/**
 * What a gathering of ICE candidates says about the media path
 * (WS-MEET-ENH-01 RC09's firewall and TURN rows).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS CAN BE MEASURED AFTER ALL
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * The checks used to say the media path could not be known from a settings
 * page, which was true of the **media server**: its address arrives when a
 * meeting is joined. But a call's media can only flow the way ICE finds, and
 * ICE can be run against the STUN and TURN servers this deployment already
 * hands out (`GET /api/meet/ice`). So the question "will media get out of this
 * network" is answerable without a meeting, and these are the answers:
 *
 *  - a **server-reflexive** candidate means a UDP packet left this computer,
 *    reached the internet and came back with the address it was seen from;
 *  - a **relay** candidate means the TURN server answered, and the protocol it
 *    answered over says whether UDP or only TCP got there;
 *  - **host candidates alone** mean nothing left at all.
 *
 * What it still does not measure is throughput, or the path to the particular
 * media server a meeting ends up on. The rows say what they measured.
 */

export type CandidateType = 'host' | 'srflx' | 'prflx' | 'relay';

export interface IceCandidateFact {
  type: CandidateType;
  /** The transport the candidate itself uses. */
  protocol?: 'udp' | 'tcp' | string | null;
  /** How a relay candidate reached the TURN server, where the browser says. */
  relayProtocol?: 'udp' | 'tcp' | 'tls' | string | null;
}

export interface IceProbeResult {
  candidates: IceCandidateFact[];
  /** How long gathering took, in ms. */
  ms: number;
  /** True when gathering was cut short rather than finishing by itself. */
  timedOut: boolean;
  /** Whether the configuration this ran with offered a relay at all. */
  relayOffered: boolean;
  /** Set when the probe could not run — no configuration, or no WebRTC here. */
  error?: string | null;
}

const has = (facts: IceCandidateFact[], type: CandidateType): boolean => facts.some((c) => c.type === type);

const relayOver = (facts: IceCandidateFact[], protocol: 'udp' | 'tcp' | 'tls'): boolean =>
  facts.some((c) => c.type === 'relay' && ((c.relayProtocol ?? c.protocol ?? '').toLowerCase() === protocol));

/** Whether UDP got out of this network at all — by either route that proves it. */
export const udpLeaves = (facts: IceCandidateFact[]): boolean => has(facts, 'srflx') || has(facts, 'prflx') || relayOver(facts, 'udp');

/**
 * The two rows RC09 draws, from one gathering.
 *
 * They are deliberately separate: a network where UDP is blocked but the relay
 * answers over TCP still carries a call, worse but working, and somebody
 * reading a single row could not tell that from a network where nothing gets
 * out at all.
 */
export function iceChecks(result: IceProbeResult | null): DiagnosticCheck[] {
  if (!result || result.error) {
    return [
      {
        id: 'meet-media',
        label: 'Media path (UDP and TURN)',
        status: 'skip',
        detail: result?.error
          ? `Not measured: ${result.error}`
          : 'Not measured yet. Run checks again to try the path a call’s audio and video would take.',
      },
    ];
  }

  const udp = udpLeaves(result.candidates);
  const relay = has(result.candidates, 'relay');
  const relayTcpOnly = relay && !relayOver(result.candidates, 'udp');
  const nothing = result.candidates.length === 0 || (!udp && !relay);

  const rows: DiagnosticCheck[] = [
    {
      id: 'meet-udp',
      label: 'UDP out of this network',
      status: udp ? 'pass' : 'warn',
      ms: result.ms,
      detail: nothing
        ? 'Nothing left this computer. A firewall is blocking WebRTC outright, and calls will not connect from this network.'
        : udp
          ? `A UDP packet reached the internet and came back${result.ms > 0 ? ` in ${result.ms} ms` : ''}. This is the path a call prefers.`
          : 'UDP did not get out. Calls will fall back to a relay over TCP, which adds delay and costs quality.',
    },
    {
      id: 'meet-relay',
      label: 'Relay (TURN)',
      // No relay configured is a deployment's choice, not a fault of this computer.
      status: !result.relayOffered ? 'skip' : relay ? 'pass' : 'warn',
      detail: !result.relayOffered
        ? 'This server hands out no relay, so a call needs a direct path. Nothing to check here.'
        : relay
          ? relayTcpOnly
            ? 'The relay answered, over TCP only. It will carry a call that cannot go directly, more slowly than UDP would.'
            : 'The relay answered over UDP, so a call still connects where a direct path cannot be found.'
          : 'The relay did not answer. A call between two networks that both refuse a direct path would fail.',
    },
  ];

  if (result.timedOut) {
    rows.push({
      id: 'meet-media-timeout',
      label: 'Media path check',
      status: 'skip',
      detail: 'Gathering did not finish in time, so the two rows above may be incomplete. A slow or filtered network does this.',
    });
  }

  return rows;
}
