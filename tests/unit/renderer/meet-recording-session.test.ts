// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), notice: vi.fn() }));
vi.mock('../../../src/core/api', () => ({ ApiError: class extends Error {}, apiGet: mocks.get, apiPost: mocks.post, apiPut: vi.fn(), apiDelete: vi.fn() }));
vi.mock('../../../src/modules/meet/recording-notice', () => ({ announceRecording: mocks.notice }));
vi.mock('../../../src/core/bridge', () => ({ call: vi.fn(), on: vi.fn(() => () => {}), errorMessage: (e: Error) => e.message }));
vi.mock('../../../src/core/toasts', () => ({ toast: vi.fn() }));
import { MeetSession } from '../../../src/modules/meet/session';
import { app } from '../../../src/core/app-state';
const active = { cloud: { id: 1, status: 'recording', started_at: '2026-10-02 10:00:00', by: { id: 1, name: 'Host' } }, local: [] };
beforeEach(() => { mocks.get.mockReset(); mocks.post.mockReset(); mocks.notice.mockReset(); app.set({ prefs: null }); });
afterEach(() => vi.useRealTimers());
it('immediately enters Starting and prevents another request while it is pending', async () => {
  let resolve!: (value: unknown) => void;
  mocks.post.mockReturnValue(new Promise((r) => { resolve = r; }));
  mocks.get.mockResolvedValue(active);
  const session = new MeetSession(); session.uuid = 'meeting';
  const first = session.startRecording();
  expect(session.recordingCommand).toBe('starting');
  expect(session.recording).toBeNull();
  await session.startRecording();
  expect(mocks.post).toHaveBeenCalledOnce();
  resolve({ status: 'starting' }); await first;
  expect(session.recordingCommand).toBe('idle'); expect(session.recording).toBeTruthy();
  expect(mocks.notice).toHaveBeenCalledExactlyOnceWith(true);
});
it('announces late-join and confirmed stop once despite repeated refreshes', async () => {
  const session = new MeetSession(); session.uuid = 'meeting';
  mocks.get.mockResolvedValue(active);
  await session.refreshRecording(); await session.refreshRecording();
  expect(mocks.notice).toHaveBeenCalledExactlyOnceWith(true);
  mocks.get.mockResolvedValue({ cloud: null, local: [] });
  await session.refreshRecording(); await session.refreshRecording();
  expect(mocks.notice.mock.calls).toEqual([[true], [false]]);
});
it('reports failed startup without an active badge and allows explicit retry', async () => {
  const session = new MeetSession(); session.uuid = 'meeting';
  mocks.post.mockRejectedValue(new Error('Recording service unavailable.'));
  mocks.get.mockResolvedValue({ cloud: null, local: [] });
  await session.startRecording();
  expect(session.recordingCommand).toBe('error');
  expect(session.recordingError).toContain('unavailable'); expect(session.recording).toBeNull();
  mocks.post.mockResolvedValue({}); mocks.get.mockResolvedValue(active);
  await session.startRecording(); expect(session.recording).toBeTruthy();
});
it('times out an unconfirmed startup instead of claiming Recording On', async () => {
  vi.useFakeTimers();
  const session = new MeetSession(); session.uuid = 'meeting';
  mocks.post.mockResolvedValue({}); mocks.get.mockResolvedValue({ cloud: null, local: [], pending: [{ id: 1, phase: 'starting' }] });
  const start = session.startRecording();
  await vi.advanceTimersByTimeAsync(31000); await start;
  expect(session.recordingCommand).toBe('error'); expect(session.recordingError).toContain('timed out'); expect(session.recording).toBeNull();
});

it('retains confirmed capture through a status outage and does not announce a false stop', async () => {
  const session = new MeetSession(); session.uuid = 'meeting';
  mocks.get.mockResolvedValue(active); await session.refreshRecording();
  mocks.get.mockRejectedValue(new Error('Connection interrupted')); await session.refreshRecording();
  expect(session.recording).toBeTruthy(); expect(mocks.notice.mock.calls).toEqual([[true]]);
});
