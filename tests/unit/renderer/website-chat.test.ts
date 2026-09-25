// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { filterRows, sectionRows, sortRows, type Section, type WebsiteRow } from '../../../src/modules/chat/website/api';
import { roomFromRoute } from '../../../src/modules/chat/routes';

/**
 * Website chat in the Chat rail (UI-08 "group, direct and website-chat
 * conversations"): who is waiting, what is mine, and in what order.
 */
const row = (over: Partial<WebsiteRow>): WebsiteRow => ({
  id: 1, widget: 'Site', widget_id: 1, site: 'livezen.lk', online: true, inactive: false, label: 'Visitor 1', visitor_name: null,
  email: null, country: null, browser: null, os: null, device: null, current_url: null, last_seen: null, status: 'open',
  is_offline: false, priority: 'normal', updated_at: '2026-09-25 10:00:00', agent: null, assigned_to: null, started_at: null,
  last_visitor_at: null, waiting_since: null, at_risk: false, awaiting_reply: false, rating: null, is_starred: false, tags: null,
  ...over,
});

describe('website chat rail', () => {
  const rows = [
    row({ id: 1, awaiting_reply: true, waiting_since: '2026-09-25 10:05:00', updated_at: '2026-09-25 10:05:00' }),
    row({ id: 2, awaiting_reply: true, waiting_since: '2026-09-25 09:50:00', updated_at: '2026-09-25 09:50:00', assigned_to: 7 }),
    row({ id: 3, assigned_to: 7, updated_at: '2026-09-25 10:30:00' }),
    row({ id: 4, updated_at: '2026-09-25 10:10:00' }),
  ];

  it('Waiting is everyone awaiting a reply, the longest-waiting first', () => {
    expect(sortRows(filterRows(rows, 'waiting', 7), 'waiting').map((r) => r.id)).toEqual([2, 1]);
  });

  it('Mine is what is assigned to me, and nobody\'s when signed out', () => {
    expect(filterRows(rows, 'mine', 7).map((r) => r.id)).toEqual([2, 3]);
    expect(filterRows(rows, 'mine', null)).toEqual([]);
  });

  it('All open is newest first', () => {
    expect(sortRows(filterRows(rows, 'open', 7), 'open').map((r) => r.id)).toEqual([3, 4, 1, 2]);
  });
});

describe('chat routes', () => {
  it('opens the room a worksuite:// link names (/chat/42), as well as ?room=42', () => {
    expect(roomFromRoute(new URLSearchParams(''), ['chat', '42'])).toBe('42');
    expect(roomFromRoute(new URLSearchParams('room=9'), ['chat'])).toBe('9');
    expect(roomFromRoute(new URLSearchParams('room=../x'), ['chat', 'abc'])).toBeNull();
  });
});

describe('website chats workspace sections', () => {
  const rows = [
    row({ id: 1, online: true, awaiting_reply: true }),
    row({ id: 2, online: false, is_offline: true }),
    row({ id: 3, online: true, assigned_to: 7, is_starred: true }),
  ];
  const ids = (s: Section, me: number | null = 7) => sectionRows(rows, s, me).map((r) => r.id);

  it('Live chats are visitors on the site now, not offline enquiries', () => {
    expect(ids('live')).toEqual([1, 3]);
    expect(ids('offline')).toEqual([2]);
  });

  it('Assigned to me, Unassigned, Awaiting reply and Starred each ask one thing', () => {
    expect(ids('mine')).toEqual([3]);
    expect(ids('mine', null)).toEqual([]);
    expect(ids('unassigned')).toEqual([1, 2]);
    expect(ids('awaiting')).toEqual([1]);
    expect(ids('starred')).toEqual([3]);
    expect(ids('inbox')).toEqual([1, 2, 3]);
  });
});
