import { describe, expect, it } from 'vitest';
import { rejoinable } from '../../../src/modules/meet/home';
import type { HistoryRow } from '../../../src/modules/meet/api';

/**
 * Rejoining the meeting you were last in (WS-MEET-ENH-01 D07).
 *
 * What it protects: the card is a button, so it must never offer a meeting
 * that cannot be rejoined. A meeting is ended only when a host ends it, so
 * "recent" is not enough on its own — and yesterday's call is not something
 * anybody means by "rejoin".
 */

const NOW = Date.parse('2026-10-11T12:00:00Z');
const ago = (minutes: number) => new Date(NOW - minutes * 60_000).toISOString().replace('T', ' ').slice(0, 19);

type Row = Pick<HistoryRow, 'uuid' | 'title' | 'status'> & { started_at: string | null; created_at: string | null };

const row = (over: Partial<Row>): Row =>
  ({
    uuid: 'b5d1c8e2-4f7a-4c1e-9a3b-2e6f8d0c1a77',
    title: 'Weekly team sync',
    status: 'open',
    started_at: ago(30),
    created_at: ago(35),
    ended_at: null,
    ...over,
  }) as Row;

describe('the meeting Rejoin offers', () => {
  it('is the most recent one still open', () => {
    const found = rejoinable([row({ uuid: 'old', started_at: ago(200) }), row({ uuid: 'new', started_at: ago(10) })], NOW);

    expect(found?.uuid).toBe('new');
  });

  it('is never one that has ended', () => {
    expect(rejoinable([row({ status: 'ended', started_at: ago(5) })], NOW)).toBeNull();
  });

  it('offers a live one and one nobody has started yet', () => {
    expect(rejoinable([row({ status: 'live' })], NOW)?.status).toBe('live');
    expect(rejoinable([row({ status: 'not_started' })], NOW)?.status).toBe('not_started');
  });

  it('stops offering yesterday’s call', () => {
    // "Rejoin" stops being the word for it; it is in the history like the rest.
    expect(rejoinable([row({ started_at: ago(25 * 60) })], NOW)).toBeNull();
    expect(rejoinable([row({ started_at: ago(23 * 60) })], NOW)).not.toBeNull();
  });

  it('falls back to when it was made, for one nobody started', () => {
    expect(rejoinable([row({ status: 'not_started', started_at: null, created_at: ago(20) })], NOW)?.title).toBe('Weekly team sync');
  });

  it('offers nothing rather than something undated', () => {
    expect(rejoinable([row({ started_at: null, created_at: null })], NOW)).toBeNull();
    expect(rejoinable([row({ started_at: 'not a date', created_at: null })], NOW)).toBeNull();
    expect(rejoinable([], NOW)).toBeNull();
  });
});
