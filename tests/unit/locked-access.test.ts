import { describe, expect, it } from 'vitest';
import { lockedScope, lockedApi, lockedIpc } from '../../shared/locked-access';
const prefs = { lockedAnswerCalls: true, lockedAllowChat: true };
const route = (kind: string, path: string) => `app://bundle/#/window/${kind}?route=${encodeURIComponent(path)}`;
const ring = lockedScope(route('ring', '/calls/ring?uuid=abcdefgh-123&room_id=7'), 'ring')!;
const chat = lockedScope(route('chat-mini', '/chat?room=7'), 'chat-mini')!;
const api = (path: string) => `app://bundle/__api/api/${path}`;
describe('locked access boundaries (#112)', () => {
  it('requires an owned window kind matching the exact route', () => {
    expect(lockedScope(route('ring', '/calls/ring?uuid=abcdefgh-123&room_id=7'), 'main')).toBeNull();
    expect(lockedScope(route('call', '/files?room_id=7'), 'call')).toBeNull();
    expect(lockedScope(route('ring', '/calls/ring?room_id=7'), 'ring')).toBeNull();
    expect(lockedScope(route('call', '/calls/call?room_id=7'), 'call')).toEqual({ kind: 'call', uuid: null, room: '7' });
  });
  it('allows only the current call lifecycle, with camera off on answer', () => {
    for (const action of ['answer', 'decline', 'end']) expect(lockedApi(ring, api(`chat/calls/abcdefgh-123/${action}`), 'POST', prefs, { video: false })).toBe(true);
    expect(lockedApi(ring, api('chat/calls/abcdefgh-123/answer'), 'POST', prefs, { video: true })).toBe(false);
    expect(lockedApi(ring, api('chat/calls/another-uuid/end'), 'POST', prefs)).toBe(false);
    expect(lockedApi(ring, api('chat/calls'), 'POST', prefs)).toBe(false);
    expect(lockedApi(ring, api('chat/calls/abcdefgh-123'), 'GET', { ...prefs, lockedAnswerCalls: false })).toBe(false);
  });
  it('restricts chat to one conversation and plain text without attachments or references', () => {
    expect(lockedApi(chat, api('chat/messages?room_id=7'), 'GET', prefs)).toBe(true);
    for (const path of ['chat/messages?room_id=8', 'chat/messages?room_id=7&room_id=8', 'files', 'chat/rooms', 'contacts']) expect(lockedApi(chat, api(path), 'GET', prefs)).toBe(false);
    const message = { room_id: 7, type: 'text', message: 'Hello' };
    expect(lockedApi(chat, api('chat/messages'), 'POST', prefs, message)).toBe(true);
    for (const patch of [{ room_id: 8 }, { attachment: 5 }, { record: 1 }, { reply_to: 2 }, { type: 'file' }, { message: 'a'.repeat(8001) }]) expect(lockedApi(chat, api('chat/messages'), 'POST', prefs, { ...message, ...patch })).toBe(false);
    expect(lockedApi(chat, api('chat/messages?room_id=7'), 'GET', { ...prefs, lockedAllowChat: false })).toBe(false);
  });
  it('permits scoped answer/chat windows but refuses workspace navigation and sharing/control', () => {
    expect(lockedIpc(ring, 'windows:open', { kind: 'call', route: '/calls/call?uuid=abcdefgh-123&room_id=7' }, prefs)).toBe(true);
    expect(lockedIpc(ring, 'windows:open', { kind: 'chat-mini', route: '/chat?room=7' }, prefs)).toBe(true);
    for (const input of [{ kind: 'call', route: '/calls/call?uuid=another-uuid&room_id=7' }, { kind: 'chat-mini', route: '/chat?room=8' }, { kind: 'files', route: '/files' }]) expect(lockedIpc(ring, 'windows:open', input, prefs)).toBe(false);
    for (const channel of ['media:sources', 'rc:start', 'files:open', 'windows:describe', 'session:switchOrganization']) expect(lockedIpc(ring, channel, {}, prefs)).toBe(false);
    expect(lockedIpc(chat, 'media:access', {}, prefs)).toBe(false);
    expect(lockedIpc(null, 'media:access', {}, prefs)).toBe(false);
  });
});
it('allows a locked ring to be seen and declined without granting answering, media or call-window access (#115)', () => {
  const ring = lockedScope('app://bundle/#/window/ring?route=' + encodeURIComponent('/calls/ring?uuid=abcdefgh-123&room_id=7'), 'ring');
  const p = { lockedAnswerCalls: false, lockedAllowChat: false, lockedCallNotifications: true };
  expect(lockedApi(ring, 'https://example.com/api/chat/calls/abcdefgh-123', 'GET', p)).toBe(true);
  expect(lockedApi(ring, 'https://example.com/api/chat/calls/abcdefgh-123/decline', 'POST', p)).toBe(true);
  expect(lockedApi(ring, 'https://example.com/api/chat/calls/abcdefgh-123/answer', 'POST', p, { video: false })).toBe(false);
  expect(lockedIpc(ring, 'media:access', {}, p)).toBe(false);
  expect(lockedIpc(ring, 'windows:open', { kind: 'call', route: '/calls/call?uuid=abcdefgh-123&room_id=7' }, p)).toBe(false);
});
