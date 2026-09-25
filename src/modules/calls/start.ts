import { call, errorMessage } from '../../core/bridge';
import { toast } from '../../core/toasts';

/**
 * A query string an app route accepts: percent-encoded throughout, including
 * the characters encodeURIComponent leaves alone (a route allows none of them).
 */
export function routeQuery(q: Record<string, string | number | boolean | null | undefined>): string {
  return Object.entries(q)
    .filter(([, v]) => v !== null && v !== undefined && v !== '')
    .map(([k, v]) => `${k}=${encodeURIComponent(String(v)).replace(/[!'()*~]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)}`)
    .join('&');
}

/** Call a conversation: the call opens in its own window (one call at a time). */
export async function startCall(roomId: string | number, mode: 'audio' | 'video', name?: string): Promise<void> {
  try {
    await call('windows:open', {
      kind: mode === 'video' ? 'video-call' : 'call',
      route: `/calls/call?${routeQuery({ room_id: roomId, mode, name: name?.slice(0, 120) })}`,
      title: mode === 'video' ? 'Video call' : 'Voice call',
      alwaysOnTop: true,
    });
  } catch (e) {
    toast('error', errorMessage(e));
  }
}

/** Answer a call that is ringing here, with or without the camera. */
export async function answerCall(uuid: string, roomId: string | number, video: boolean, name?: string): Promise<void> {
  await call('windows:open', {
    kind: video ? 'video-call' : 'call',
    route: `/calls/call?${routeQuery({ uuid, room_id: roomId, mode: video ? 'video' : 'audio', name: name?.slice(0, 120) })}`,
    title: video ? 'Video call' : 'Voice call',
    alwaysOnTop: true,
  });
}
