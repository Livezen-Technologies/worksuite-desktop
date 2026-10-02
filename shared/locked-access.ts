import type { Preferences } from './types';
export interface LockedScope { kind: string; uuid: string | null; room: string | null }
export function lockedScope(url: string, kind: string | null): LockedScope | null {
  if (!kind || !['ring', 'call', 'video-call', 'chat-mini'].includes(kind)) return null;
  try {
    const hash = new URL(url).hash;
    if (!hash.startsWith(`#/window/${kind}?`)) return null;
    const route = new URLSearchParams(hash.split('?').slice(1).join('?')).get('route');
    if (!route) return null;
    const u = new URL(route, 'https://locked.invalid');
    if (kind === 'chat-mini' && u.pathname === '/chat' && /^\d+$/.test(u.searchParams.get('room') ?? '')) return { kind, uuid: null, room: u.searchParams.get('room') };
    if (u.pathname !== (kind === 'ring' ? '/calls/ring' : '/calls/call')) return null;
    const uuid = u.searchParams.get('uuid'); const room = u.searchParams.get('room_id');
    if ((kind === 'ring' && !uuid || uuid && !/^[A-Za-z0-9-]{8,64}$/.test(uuid)) || !/^\d+$/.test(room ?? '')) return null;
    return { kind, uuid, room };
  } catch { return null; }
}
export function lockedApi(scope: LockedScope | null, url: string, method: string, prefs: Pick<Preferences, 'lockedAnswerCalls' | 'lockedAllowChat' | 'lockedCallNotifications'>, body?: unknown): boolean {
  if (!scope) return false;
  const u = new URL(url); const path = u.pathname.replace(/^\/__api/, '');
  const ringOnly = scope.kind === 'ring' && prefs.lockedCallNotifications === true;
  if (scope.uuid && (prefs.lockedAnswerCalls || ringOnly) && path === `/api/chat/calls/${scope.uuid}` && method === 'GET') return true;
  if (scope.uuid && (prefs.lockedAnswerCalls || ringOnly && path.endsWith('/decline')) && ['answer', 'decline', 'end'].some(a => path === `/api/chat/calls/${scope.uuid}/${a}`) && method === 'POST') {
    if (path.endsWith('/answer') && body && typeof body === 'object' && (body as Record<string, unknown>).video === true) return false;
    return true;
  }
  if (!prefs.lockedAllowChat || !scope.room) return false;
  if (path === '/api/chat/messages' && method === 'GET') return u.searchParams.getAll('room_id').length === 1 && u.searchParams.get('room_id') === scope.room;
  if (path === '/api/chat/messages' && method === 'POST' && body && typeof body === 'object') {
    const b = body as Record<string, unknown>;
    return String(b.room_id) === scope.room && typeof b.message === 'string' && b.message.length <= 8000 && (!b.type || b.type === 'text') && Object.keys(b).every(k => ['room_id', 'message', 'type'].includes(k));
  }
  return false;
}
export function lockedIpc(scope: LockedScope | null, channel: string, input: unknown, prefs: Pick<Preferences, 'lockedAnswerCalls' | 'lockedAllowChat' | 'lockedCallNotifications'>): boolean {
  if (!scope || !prefs.lockedAnswerCalls && scope.kind !== 'chat-mini' && !(scope.kind === 'ring' && prefs.lockedCallNotifications === true)) return false;
  if (scope.kind === 'chat-mini' && !prefs.lockedAllowChat) return false;
  if (['windows:setAlwaysOnTop', 'windows:setCompact'].includes(channel)) return true;
  if (channel === 'calls:active') return scope.kind !== 'chat-mini' && ((input as { uuid?: string | null })?.uuid === scope.uuid || (input as { uuid?: string | null })?.uuid === null);
  if (channel === 'media:access') return !!prefs.lockedAnswerCalls && scope.kind !== 'chat-mini';
  if (channel === 'windows:open') {
    const b = input as { kind: string; route: string };
    const target = lockedScope(`app://bundle/#/window/${b.kind}?route=${encodeURIComponent(b.route)}`, b.kind);
    return !!target && (scope.kind === 'ring' && !!prefs.lockedAnswerCalls && ['call', 'video-call'].includes(target.kind) && target.uuid === scope.uuid && target.room === scope.room || !!prefs.lockedAllowChat && target.kind === 'chat-mini' && target.room === scope.room);
  }
  return false;
}
