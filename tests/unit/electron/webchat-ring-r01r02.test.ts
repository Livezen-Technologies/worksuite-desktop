import { describe, expect, it, vi } from 'vitest';
import { tmpdir } from 'node:os';
import type { WebchatRingChat } from '@shared/types';

vi.mock('electron', () => ({
  app: { getPath: () => tmpdir(), getVersion: () => '0.1.0', isPackaged: false, on: () => undefined },
  BrowserWindow: class {},
  screen: {},
}));

import { mergeAnswer, toneFor } from '../../../electron/services/webchat-ring';

/**
 * R-01 / R-02 in the main process: the card's "3rd visit" and "2 others ringing" come from the server's ring sessions
 * and survive an event that does not carry them; only the top chat of several decides the tone (RING-23).
 */
const stamp = (msAgo: number) => new Date(Date.now() - msAgo).toISOString().slice(0, 19).replace('T', ' ');
const chat = (over: Partial<WebchatRingChat>): WebchatRingChat => ({
  id: 1, visitor: 'Visitor 4F2A', site: 'techubiz.com', page: '/shop', place: null, device: null, returning: true, preview: null, priority: 'normal',
  offline: false, since: stamp(10_000), stage: 'first', atRisk: false, mine: false, by: null, silenced: false, ...over,
});

describe('the ringing card’s facts (R-01, RING-20, RING-UI-01)', () => {
  it('reads the visit count, the colleagues rung besides me, and the first words from the ring sessions', () => {
    const [c] = mergeAnswer({ ringing: [{ id: 7, conversation_id: 7, visitor: 'Visitor 4F2A', visits: 3, others_ringing: 2, preview: 'Is the Adobe licence lifetime?', since: stamp(42_000) }] }, new Map());
    expect(c).toMatchObject({ id: 7, visits: 3, othersRinging: 2, preview: 'Is the Adobe licence lifetime?' });
  });

  it('an older server says neither: both stay unknown, not zero', () => {
    const [c] = mergeAnswer({ ringing: [{ id: 7, conversation_id: 7 }] }, new Map());
    expect(c).toMatchObject({ visits: null, othersRinging: null });
  });

  it('keeps what it knew when a read does not say it again', () => {
    const [c] = mergeAnswer({ ringing: [{ id: 7, conversation_id: 7, others_ringing: 'many' as unknown as number }] }, new Map([[7, chat({ id: 7, visits: 4, othersRinging: 1 })]]));
    expect(c).toMatchObject({ visits: 4, othersRinging: 1 });
  });
});

describe('only the top one sounds (R-02, RING-23)', () => {
  const base = { ringSeconds: 0, quiet: false, duringDnd: 'card' as const, now: Date.now() };

  it('a VIP waiting under a chat given to me does not make the tone stronger', () => {
    expect(toneFor([chat({ id: 1, mine: true }), chat({ id: 2, priority: 'vip' })], base)).toBe('normal');
  });

  it('at risk is always on top, and sounds stronger', () => {
    expect(toneFor([chat({ id: 1, mine: true }), chat({ id: 2, atRisk: true })], base)).toBe('strong');
  });

  it('a silenced top chat leaves the next one to sound', () => {
    expect(toneFor([chat({ id: 1, mine: true, silenced: true }), chat({ id: 2, priority: 'urgent' })], base)).toBe('strong');
  });
});
