import { apiGet } from '../../core/api';
import type { IceCandidateFact, IceProbeResult } from '@shared/ice-probe';

/**
 * Runs the media-path check (WS-MEET-ENH-01 RC09).
 *
 * One `RTCPeerConnection` against the STUN and TURN servers this deployment
 * hands out, gathering candidates and throwing the connection away. It never
 * calls anybody: no offer is sent, nothing is signalled, no media is opened,
 * and the microphone and camera are not touched — a data channel is enough to
 * make gathering start.
 *
 * It runs only when asked. Gathering sends UDP to a server on somebody's
 * behalf, and a settings page that did that on every visit would be making
 * network traffic nobody asked for.
 */

/** How long to wait for gathering before reporting what arrived. */
const GATHER_MS = 5_000;

type IceConfig = { iceServers: RTCIceServer[] };

export async function probeIce(timeoutMs = GATHER_MS): Promise<IceProbeResult> {
  const started = Date.now();
  const empty = { candidates: [], ms: 0, timedOut: false, relayOffered: false };

  if (typeof RTCPeerConnection === 'undefined') {
    return { ...empty, error: 'this computer has no WebRTC' };
  }

  let config: IceConfig;

  try {
    config = await apiGet<IceConfig>('/api/meet/ice');
  } catch {
    return { ...empty, error: 'the server did not say which relays to use' };
  }

  const servers = config.iceServers ?? [];

  if (!servers.length) {
    return { ...empty, error: 'this server hands out no STUN or relay servers' };
  }

  const relayOffered = servers.some((s) => [s.urls].flat().some((u) => String(u).startsWith('turn')));
  const candidates: IceCandidateFact[] = [];
  const pc = new RTCPeerConnection({ iceServers: servers, iceCandidatePoolSize: 0 });

  try {
    pc.createDataChannel('probe');

    const done = new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => resolve(true), timeoutMs);

      pc.onicecandidate = (e) => {
        if (!e.candidate) {
          clearTimeout(timer);
          resolve(false);

          return;
        }

        const c = e.candidate as RTCIceCandidate & { relayProtocol?: string };

        candidates.push({
          type: (c.type ?? 'host') as IceCandidateFact['type'],
          protocol: c.protocol ?? null,
          relayProtocol: c.relayProtocol ?? null,
        });
      };
    });

    await pc.setLocalDescription(await pc.createOffer({ offerToReceiveAudio: false, offerToReceiveVideo: false }));

    const timedOut = await done;

    return { candidates, ms: Date.now() - started, timedOut, relayOffered };
  } catch (e) {
    return { ...empty, relayOffered, error: e instanceof Error ? e.message : String(e) };
  } finally {
    // Whatever happened: no connection is left holding a port open.
    pc.onicecandidate = null;
    pc.close();
  }
}
