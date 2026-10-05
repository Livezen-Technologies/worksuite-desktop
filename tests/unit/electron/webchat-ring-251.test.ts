import { afterEach, describe, expect, it, vi } from 'vitest';
import { tmpdir } from 'node:os';
import type { RingTestNotice, WebchatRingChat, WebchatRingPrefs, WebchatRingState } from '@shared/types';

vi.mock('electron', () => ({
  app: { getPath: () => tmpdir(), getVersion: () => '0.1.0', isPackaged: false, on: () => undefined },
  BrowserWindow: class {},
  screen: {},
}));

import { DesktopError } from '../../../electron/main/errors';
import { FALLBACK_POLL_MS, REFUSED_RETRY_MS, ringTestSteps, TEST_WAIT_MS, WebchatRinger, type PendingAnswer, type RingingEntry } from '../../../electron/services/webchat-ring';
import { notificationSettingsUrl, testNoticeFor } from '../../../electron/services/locked-notifications';
import { INVOKE_CHANNELS } from '../../../shared/ipc/channels';
import { contract } from '../../../shared/ipc/contract';
import type { HttpClient } from '../../../electron/services/http';

/**
 * New website chats reach signed-in staff (worksuite-desktop#251), in the main process: the ring service runs from
 * sign-in whatever screen is open, reads the list every 10 s while realtime is down, announces a chat it found by
 * reading as the event would have, does not stay silent for ever after one refusal, and runs the test chat
 * notification's steps.
 */
const stamp = (msAgo: number) => new Date(Date.now() - msAgo).toISOString().slice(0, 19).replace('T', ' ');
const entry = (over: Partial<RingingEntry> = {}): RingingEntry => ({ id: 3, conversation_id: 3, visitor: 'Visitor 4F2A', site: 'worksuite.lk', kind: 'waiting', mine: false, since: stamp(5000), silenced: false, ...over });
const prefs: WebchatRingPrefs = { window: true, duringDnd: 'card', shortcut: true, volume: 80 };

function ringer(get: () => Promise<PendingAnswer>, more: Partial<ConstructorParameters<typeof WebchatRinger>[0]> = {}, post: (path: string) => Promise<unknown> = async () => ({})) {
  const http = { get: vi.fn(get), post: vi.fn(post), request: vi.fn(async () => ({})) };
  const announced: WebchatRingChat[] = [];
  const r = new WebchatRinger({
    http: http as unknown as HttpClient,
    signedIn: () => true,
    locked: () => false,
    me: () => 5,
    prefs: () => prefs,
    quiet: () => false,
    open: () => undefined,
    onChanged: (_s: WebchatRingState) => undefined,
    deviceId: () => 'desktop-12',
    focused: () => false,
    announce: (c) => announced.push(c),
    ...more,
  });
  return { r, http, announced };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('a chat found by reading the list is announced (#251)', () => {
  it('announces a chat it had heard nothing about, once', async () => {
    const { r, announced } = ringer(async () => ({ ringing: [entry()] }));
    r.start();
    await vi.waitFor(() => expect(r.state().chats).toHaveLength(1));
    await r.reconcile();
    expect(announced.map((c) => c.id)).toEqual([3]);
    r.stop();
  });

  it('does not announce one its realtime event already brought, nor one I silenced', async () => {
    const { r, announced } = ringer(async () => ({ ringing: [entry(), entry({ id: 4, conversation_id: 4, silenced: true })] }));
    r.start();
    r.handle({ type: 'chat.incoming', conversation_id: 3, visitor: 'Visitor 4F2A' });
    await vi.waitFor(() => expect(r.state().chats).toHaveLength(2));
    expect(announced).toEqual([]);
    r.stop();
  });

  it('announces it again if it stops ringing and then rings again', async () => {
    let answer: PendingAnswer = { ringing: [entry()] };
    const { r, announced } = ringer(async () => answer);
    r.start();
    await vi.waitFor(() => expect(announced).toHaveLength(1));
    answer = { ringing: [] };
    await r.reconcile();
    answer = { ringing: [entry()] };
    await r.reconcile();
    expect(announced).toHaveLength(2);
    r.stop();
  });
});

describe('while realtime is down the list is read every 10 s (#251)', () => {
  const reads = async (up: boolean): Promise<number> => {
    vi.useFakeTimers();
    const { r, http } = ringer(async () => ({ ringing: [] }), { realtimeUp: () => up });
    r.start();
    await vi.advanceTimersByTimeAsync(100);
    const first = http.get.mock.calls.length;
    await vi.advanceTimersByTimeAsync(30_000);
    r.stop();
    return http.get.mock.calls.length - first;
  };

  it('with the socket down, at least every 10 s', async () => {
    expect(FALLBACK_POLL_MS).toBe(10_000);
    expect(await reads(false)).toBeGreaterThanOrEqual(3);
  });

  it('with the socket up, every 15 s as before', async () => {
    expect(await reads(true)).toBe(2);
  });
});

describe('a refusal is not for ever (#251)', () => {
  it('asks again after a while: one 404 while the server updated used to silence every chat until the next sign-in', async () => {
    vi.useFakeTimers();
    let refuse = true;
    const { r, http } = ringer(async () => {
      if (refuse) throw new DesktopError('NOT_FOUND', 'Not found', 404);
      return { ringing: [entry()] };
    });
    r.start();
    await vi.advanceTimersByTimeAsync(100);
    expect(r.state().chats).toHaveLength(0);
    // Refused: realtime events are not acted on, and the list is not read again at once …
    r.handle({ type: 'chat.incoming', conversation_id: 3 });
    expect(r.state().chats).toHaveLength(0);
    refuse = false;
    const asked = http.get.mock.calls.length;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(http.get.mock.calls.length).toBe(asked);
    // … but after a while it is, and the chat rings.
    await vi.advanceTimersByTimeAsync(REFUSED_RETRY_MS);
    expect(r.state().chats.map((c) => c.id)).toEqual([3]);
    r.stop();
  });
});

describe('it runs from sign-in, whatever screen is open (#251)', () => {
  it('rings from the list with no window having asked for anything', async () => {
    const { r } = ringer(async () => ({ ringing: [entry({ mine: true, kind: 'assigned' }), entry({ id: 9, conversation_id: 9 })] }));
    r.start();
    await vi.waitFor(() => expect(r.state().chats).toHaveLength(2));
    expect(r.state().tone).toBe('normal');
    r.stop();
  });

  it('stops ringing for everybody when a colleague joins', async () => {
    const { r } = ringer(async () => ({ ringing: [entry()] }));
    r.start();
    await vi.waitFor(() => expect(r.state().chats).toHaveLength(1));
    r.handle({ type: 'chat.ring.stopped', conversation_id: 3, reason: 'joined', by: 7, by_name: 'Hasarinda Perera' });
    expect(r.state().chats).toHaveLength(0);
    expect(r.state().outcome?.text).toBe('Hasarinda joined the chat with Visitor 4F2A');
    r.stop();
  });
});

describe('Send a test chat notification (#251)', () => {
  const shown: RingTestNotice = { state: 'shown', detail: null };

  it('routed to you ✓ · received by this computer ✓ · desktop notification shown ✓', async () => {
    const answer = { routed: true, widgets: ['worksuite.lk'], status: 'online', available: true, test_id: 'abc123', sent: true, realtime: true };
    const { r, http } = ringer(async () => ({ ringing: [] }), { testNotify: async () => shown }, async () => answer);
    r.start();
    const steps = r.testRing();
    await vi.waitFor(() => expect(http.post).toHaveBeenCalledWith('/api/chat/ring/test', {}));
    // The server's test frame arrives over the live connection; it is never a chat on the card.
    r.handle({ type: 'chat.ring.test', test_id: 'abc123', conversation_id: 0 });
    const out = await steps;
    expect(out.map((s) => [s.id, s.state])).toEqual([
      ['routed', 'ok'],
      ['received', 'ok'],
      ['notification', 'ok'],
    ]);
    expect(out[0]!.detail).toBe('New chats on worksuite.lk ring for you.');
    expect(r.state().chats).toHaveLength(0);
    r.stop();
  });

  it('says the live connection did not deliver it, and that the system refused the notification', async () => {
    vi.useFakeTimers();
    const { r } = ringer(async () => ({ ringing: [] }), { testNotify: async () => ({ state: 'failed', detail: 'Desktop notifications are off for WorkSuite.' }) }, async () => ({ routed: true, widgets: ['worksuite.lk'], available: true, test_id: 'x1', sent: true, realtime: false }));
    r.start();
    const steps = r.testRing();
    await vi.advanceTimersByTimeAsync(TEST_WAIT_MS + 50);
    const out = await steps;
    expect(out[1]).toMatchObject({ state: 'warn', detail: expect.stringMatching(/Live updates are off on this server/) });
    expect(out[2]).toMatchObject({ state: 'fail', detail: 'Desktop notifications are off for WorkSuite.' });
    r.stop();
  });

  it('a server without the test says it needs the update', async () => {
    const { r } = ringer(async () => ({ ringing: [] }), {}, async () => {
      throw new DesktopError('NOT_FOUND', 'Not found', 404);
    });
    const out = await r.testRing();
    expect(out[0]).toMatchObject({ id: 'routed', state: 'fail', detail: expect.stringMatching(/needs the Communication update/) });
  });

  it('routed but not available: rung, never given a chat by turn', () => {
    const out = ringTestSteps({ routed: true, widgets: ['worksuite.lk'], status: 'busy', available: false }, null, 'realtime', { state: 'shown', detail: null });
    expect(out[0]).toMatchObject({ state: 'warn', detail: expect.stringMatching(/you show as Busy/) });
    expect(ringTestSteps({ routed: false, why: 'You are not on any widget\'s staff list, so no chat rings for you.' }, null, 'none', null)[0]!.state).toBe('fail');
  });
});

describe('notification permission (#251)', () => {
  it('words what the system did with the test notification, and where its settings are', () => {
    expect(testNoticeFor('darwin', 'failed', 'denied').detail).toMatch(/^Desktop notifications are off for WorkSuite\. Turn them on in System Settings › Notifications › WorkSuite/);
    expect(testNoticeFor('darwin', 'shown', null).detail).toMatch(/Focus/);
    expect(testNoticeFor('win32', 'unknown', null).state).toBe('unknown');
    expect(notificationSettingsUrl('darwin')).toBe('x-apple.systempreferences:com.apple.preference.notifications');
    expect(notificationSettingsUrl('win32')).toBe('ms-settings:notifications');
    expect(notificationSettingsUrl('linux')).toBeNull();
  });

  it('the window can run the test and open the system settings', () => {
    expect(INVOKE_CHANNELS).toContain('ring:test');
    expect(INVOKE_CHANNELS).toContain('notifications:openSettings');
    expect(contract['ring:test'].input.safeParse(undefined).success).toBe(true);
  });
});
