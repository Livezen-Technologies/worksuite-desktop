import { describe, expect, it, vi } from 'vitest';

vi.mock('livekit-client', () => ({ Room: class {}, RoomEvent: {}, Track: { Source: {}, Kind: {} }, VideoPresets: { h720: {} }, createLocalTracks: vi.fn() }));
vi.mock('../../../src/core/bridge', () => ({ call: vi.fn(), on: vi.fn(), errorMessage: (e: unknown) => String(e) }));
vi.mock('../../../src/core/api', () => ({ ApiError: class {}, apiGet: vi.fn(), apiPost: vi.fn(), request: vi.fn() }));
vi.mock('../../../src/core/toasts', () => ({ toast: vi.fn() }));

import { deviceProblem } from '../../../src/modules/calls/session';
import { routeQuery } from '../../../src/modules/calls/start';

const named = (name: string) => Object.assign(new Error(name), { name });

describe('call routes', () => {
  it('encodes every character a route does not allow', () => {
    const q = routeQuery({ room_id: 5, mode: 'audio', name: "Samali O'Neil (Design) + co" });
    expect(q).toMatch(/^[A-Za-z0-9_\-.:=&%]*$/);
    expect(new URLSearchParams(q).get('name')).toBe("Samali O'Neil (Design) + co");
  });

  it('leaves out what is not set', () => {
    expect(routeQuery({ room_id: 5, name: undefined, uuid: null })).toBe('room_id=5');
  });
});

describe('device problems', () => {
  it('names a blocked microphone and points at the privacy settings', () => {
    const p = deviceProblem(named('NotAllowedError'));
    expect(p.message).toContain('Microphone blocked (NotAllowedError)');
    expect(p.pane).toBe('microphone');
  });

  it('tells a missing device and a busy one apart', () => {
    expect(deviceProblem(named('NotFoundError'), 'camera').message).toContain('No camera was found');
    expect(deviceProblem(named('NotReadableError')).message).toContain('in use by another app');
    expect(deviceProblem(named('NotReadableError')).pane).toBeNull();
  });
});
