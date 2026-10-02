// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from 'vitest';
import type { Room } from 'livekit-client';
const mocks = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('../../../src/core/api', () => ({ ApiError: class extends Error {}, apiGet: mocks.get, apiPost: vi.fn(), apiPut: vi.fn(), apiDelete: vi.fn() }));
vi.mock('../../../src/core/bridge', () => ({ call: vi.fn(), on: vi.fn(() => () => {}), errorMessage: (e: Error) => e.message }));
vi.mock('../../../src/core/toasts', () => ({ toast: vi.fn() }));
import { MeetSession } from '../../../src/modules/meet/session';
beforeEach(() => { mocks.get.mockReset(); });
it('does not turn a livestream egress into a recording badge', () => {
  const s = new MeetSession(); s.room = { isRecording: true } as Room;
  s.livestream = { available: true, active: true, live: true, count: 1, destinations: [] };
  expect(s.recording).toBeNull();
});
it('keeps recording independent when a livestream stops', () => {
  const s = new MeetSession(); s.room = { isRecording: true } as Room;
  s.livestream = { available: true, active: false, live: false, count: 0, destinations: [] };
  s.rec = { cloud: { id: 1, status: 'recording', started_at: null, by: null }, local: [] };
  expect(s.recording).toBeTruthy();
});
it('deduplicates overlapping status polls and retains the confirmed state during a network failure', async () => {
  const s = new MeetSession(); s.uuid = 'meeting'; s.room = {} as Room;
  let resolve!: (status: unknown) => void;
  mocks.get.mockReturnValue(new Promise(r => { resolve = r; }));
  const first = s.refreshLivestream(); await s.refreshLivestream(); expect(mocks.get).toHaveBeenCalledOnce();
  const live = { available: true, active: true, live: true, count: 1, destinations: [] };
  resolve(live); await first; expect(s.livestream).toEqual(live);
  mocks.get.mockRejectedValue(new Error('offline')); await s.refreshLivestream(); expect(s.livestream).toEqual(live);
});
it('ignores an old meeting response after leaving or changing meetings', async () => {
  const s = new MeetSession(); s.uuid = 'meeting'; s.room = {} as Room;
  let resolve!: (status: unknown) => void;
  mocks.get.mockReturnValue(new Promise(r => { resolve = r; }));
  const first = s.refreshLivestream(); s.uuid = 'another-meeting';
  resolve({ available: true, active: true, live: true, count: 1, destinations: [] }); await first;
  expect(s.livestream).toBeNull();
});
