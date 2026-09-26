// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { lastOrRecent } from '../../../src/modules/chat/routes';
import type { Room } from '../../../src/modules/chat/types';

const room = (id: number, at: string, over: Partial<Room> = {}): Room => ({
  id,
  type: 'direct',
  name: `Room ${id}`,
  avatar_name: `Room ${id}`,
  last_message: { text: 'hi', sender_id: 1, created_at: at, type: 'text' },
  unread: 0,
  updated_at: at,
  pinned: false,
  muted: false,
  mentions: 0,
  ...over,
});

/** Chat opens on a conversation, never on an empty "Pick a conversation" pane. */
describe('the conversation Chat reopens', () => {
  const key = 'ws.chat.lastRoom.7';
  beforeEach(() => localStorage.clear());

  it('is the last one open, while it is still in the list', () => {
    localStorage.setItem(key, '2');
    expect(lastOrRecent([room(1, '2026-09-26 08:00:00'), room(2, '2026-09-01 08:00:00')], key)).toBe('2');
  });

  it('is otherwise the most recent, by its last message', () => {
    localStorage.setItem(key, '99');
    expect(lastOrRecent([room(1, '2026-09-01 08:00:00'), room(3, '2026-09-26 08:00:00'), room(2, '2026-09-20 08:00:00')], key)).toBe('3');
    expect(lastOrRecent([room(1, '2026-09-01 08:00:00'), room(4, '2026-09-02 08:00:00', { last_message: null, updated_at: '2026-09-25 00:00:00' })], null)).toBe('4');
  });

  it('is never an archived one, and nothing when there is nothing to open', () => {
    localStorage.setItem(key, '5');
    expect(lastOrRecent([room(5, '2026-09-26 08:00:00', { archived: true }), room(6, '2026-09-01 08:00:00')], key)).toBe('6');
    expect(lastOrRecent([room(5, '2026-09-26 08:00:00', { archived: true })], key)).toBeNull();
    expect(lastOrRecent([], key)).toBeNull();
  });
});
