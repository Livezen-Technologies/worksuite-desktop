import { describe, expect, it } from 'vitest';
import { sessionLength } from '../../../src/modules/meet/remote/api';

/**
 * How long a control session ran (WS-MEET-ENH-01 RC07's ended card).
 *
 * Small, but it reads two clocks that can disagree — the server's and this
 * computer's — and a negative duration on screen is worse than none.
 */

describe('how long the session lasted', () => {
  it('reads minutes and seconds', () => {
    expect(sessionLength('2026-10-10T11:13:18Z', '2026-10-10T11:32:00Z')).toBe('18m 42s');
  });

  it('reads seconds alone for a short one', () => {
    expect(sessionLength('2026-10-10T11:13:18Z', '2026-10-10T11:13:40Z')).toBe('22s');
  });

  it('accepts the space-separated form the server also sends', () => {
    expect(sessionLength('2026-10-10 11:13:18', '2026-10-10 11:14:18')).toBe('1m 0s');
  });

  it('counts to now when the record does not say when it ended', () => {
    expect(sessionLength('2026-10-10T11:13:18Z', null, Date.parse('2026-10-10T11:14:18Z'))).toBe('1m 0s');
  });

  it('never counts backwards when the two clocks disagree', () => {
    expect(sessionLength('2026-10-10T11:32:00Z', '2026-10-10T11:13:18Z')).toBe('0s');
  });

  it('says nothing at all without a usable start', () => {
    expect(sessionLength(null, '2026-10-10T11:32:00Z')).toBe('');
    expect(sessionLength('not a date', null)).toBe('');
    expect(sessionLength('', null)).toBe('');
    expect(sessionLength(undefined, undefined)).toBe('');
  });
});
