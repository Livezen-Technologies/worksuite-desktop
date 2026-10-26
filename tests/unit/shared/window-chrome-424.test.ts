import { describe, expect, it } from 'vitest';
import { barHeightFor, macBarInsetFor, trafficLightPositionFor } from '@shared/window-chrome';

describe('macOS title bars (#424)', () => {
  it('centres the traffic lights in the bar they sit in', () => {
    for (const kind of ['main', 'meet', 'record', 'chat-mini']) {
      const { y } = trafficLightPositionFor(kind);
      expect(y * 2 + 14).toBe(barHeightFor(kind));
    }
  });
  it('keeps the bar content clear of the traffic lights, and gives the room back in full screen', () => {
    for (const kind of ['main', 'meet']) {
      const { x } = trafficLightPositionFor(kind);
      expect(macBarInsetFor(kind)).toBeGreaterThanOrEqual(x + 52 + 12);
      expect(macBarInsetFor(kind, true)).toBeLessThan(20);
    }
  });
});
