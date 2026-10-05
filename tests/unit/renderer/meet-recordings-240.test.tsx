// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as CoreApi from '../../../src/core/api';
import type { LocalRecording } from '../../../shared/types';

/**
 * worksuite-desktop#240: Meet recordings that saved an empty 1.2 KB file, and were listed twice.
 * The recorder (permission, live video, codec, one-second pieces, 5-second check, stop that waits for every piece),
 * the indicator, and one compact card per recording with one status pill and the rest in ⋯.
 */
vi.mock('../../../src/core/api', async (orig) => ({ ...(await orig<typeof CoreApi>()), apiGet: vi.fn(), apiPost: vi.fn(), apiPut: vi.fn(), apiDelete: vi.fn() }));
vi.mock('../../../src/core/bridge', () => ({ call: vi.fn(async () => null), on: () => () => undefined, hasDesktop: () => true, errorMessage: (e: unknown) => (e instanceof Error ? e.message : String(e)), isMac: true, platform: 'darwin', registerDropped: vi.fn() }));
vi.mock('../../../src/core/toasts', () => ({ toast: vi.fn() }));
vi.mock('../../../src/core/tab-context', () => ({ useTab: () => ({ navigate: nav, go: nav, query: new URLSearchParams(), path: ['meet'] }), useTabTitle: () => undefined }));
vi.mock('livekit-client', () => ({
  Room: { getLocalDevices: vi.fn(async () => []) },
  createLocalVideoTrack: vi.fn(() => new Promise(() => undefined)),
  createLocalAudioTrack: vi.fn(() => new Promise(() => undefined)),
  Track: { Source: { Camera: 'camera', ScreenShare: 'screen_share', Microphone: 'microphone', ScreenShareAudio: 'screen_share_audio' } },
}));
const nav = vi.fn();

const { apiGet, apiDelete } = await import('../../../src/core/api');
const { call } = await import('../../../src/core/bridge');
const { app } = await import('../../../src/core/app-state');
const { MeetHome } = await import('../../../src/modules/meet/MeetHome');
const { RecordingFeedback } = await import('../../../src/modules/meet/RecordingFeedback');
const { recordingItems, pillOf, progressLine, mainActionOf } = await import('../../../src/modules/meet/RecordingCard');
const { LocalRecorder, RecordingError, hasLiveVideo, capturing, noVideoWarning, TIMESLICE_MS } = await import('../../../src/modules/meet/recorder');
const { localRecordingStatus, serverRecordingStatus } = await import('../../../shared/recording-status');

const UUID = 'b5d1c8e2-4f7a-4c1e-9a3b-2e6f8d0c1a77';
const T0 = '2026-10-05T09:30:00.000Z';
const loc = (o: Partial<LocalRecording> = {}): LocalRecording => ({
  id: 'r1', meeting: UUID, title: 'Board', state: 'uploading', error: null, failedAt: null, bytes: 5 * 1024 * 1024, uploaded: 0,
  startedAt: T0, endedAt: T0, durationMs: 90_000, fileName: 'Board.webm', driveFileId: null, deleteAfter: null, recovered: false, stepAt: T0, transferId: null, ...o,
});
const xfer = (o: Record<string, unknown>) => ({ id: 'up1', direction: 'upload', name: 'Board.webm', source: '', destination: '', speed: 0, error: null, createdAt: T0, movedAt: new Date().toISOString(), bytes: 2 * 1024 * 1024, total: 5 * 1024 * 1024, state: 'running', ...o });

beforeEach(() => {
  localStorage.clear();
  nav.mockReset();
  vi.mocked(call).mockReset().mockResolvedValue(null as never);
  vi.mocked(apiGet).mockReset();
  vi.mocked(apiDelete).mockReset().mockResolvedValue(undefined as never);
  app.set({ auth: { user: { id: 1, name: 'Me' }, server: { origin: 'https://app.worksuite.lk' } }, bootstrap: { permissions: ['*'] }, apps: [{ id: 'meetings' }, { id: 'chat' }, { id: 'meet' }], transfers: [] } as never);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('one entry per recording, its status on its own card', () => {
  it('joins the server row and this computer’s entry into one item; not-yet-listed ones come first; finished ledger-only ones stay out', () => {
    const rows = [{ id: 7, title: 'Board', created_at: T0, ready: false, size: null, status: 'uploading' as const, method: 'local' as const, client_id: 'r1' }];
    const items = recordingItems(rows, [loc(), loc({ id: 'r2', title: 'Fresh', state: 'recording' }), loc({ id: 'r3', state: 'ready', driveFileId: 99 })]);
    expect(items.map((i) => i.key)).toEqual(['l:r2', 's:7']);
    expect(items[1]!.local?.id).toBe('r1');
    // Matched by the file in Drive as well.
    expect(recordingItems([{ id: 8, title: 'x', created_at: T0, ready: true, size: 1, drive_file_id: 99 }], [loc({ id: 'r3', state: 'ready', driveFileId: 99 })])).toHaveLength(1);
  });

  it('one pill — Recording · Finishing · Uploading · Ready · Failed — and progress in words', () => {
    expect(pillOf(localRecordingStatus(loc({ state: 'recording' }), null))).toBe('Recording');
    expect(pillOf(localRecordingStatus(loc({ state: 'processing' }), null))).toBe('Finishing');
    expect(progressLine(localRecordingStatus(loc({ state: 'processing' }), null))).toBe('Finishing…');
    expect(progressLine({ ...localRecordingStatus(loc({ state: 'processing' }), null), progress: { percent: 40, done: null, total: null, etaSeconds: null } })).toBe('Finishing… 40%');
    const up = localRecordingStatus(loc({ transferId: 'up1' }), xfer({}) as never);
    expect(pillOf(up)).toBe('Uploading');
    expect(progressLine(up)).toBe('Uploading 2.0 MB of 5.0 MB · 40%');
    expect(pillOf(serverRecordingStatus({ status: 'ready', playable: true, drive_file_id: 1 }))).toBe('Ready');
    expect(pillOf(localRecordingStatus(loc({ state: 'failed', failedAt: 'uploading' }), null))).toBe('Failed');
  });

  it('the main action is one that can work: Play, Fix permission, Retry upload — never Try again for an empty recording', () => {
    const item = (l?: LocalRecording) => ({ key: 'k', local: l });
    const ready = serverRecordingStatus({ status: 'ready', playable: true, drive_file_id: 1 });
    expect(mainActionOf(ready, item())).toBe('play');
    const perm = loc({ state: 'failed', failedAt: 'processing', problem: 'screen-permission' });
    expect(mainActionOf(localRecordingStatus(perm, null), item(perm))).toBe('fixPermission');
    const empty = loc({ state: 'failed', failedAt: 'processing', problem: 'no-video' });
    expect(mainActionOf(localRecordingStatus(empty, null), item(empty))).toBe('delete');
    const upload = loc({ state: 'failed', failedAt: 'uploading', error: 'offline' });
    expect(mainActionOf(localRecordingStatus(upload, null), item(upload))).toBe('retryUpload');
    expect(mainActionOf(serverRecordingStatus({ status: 'failed', method: 'cloud' }), item())).toBe('retryUpload');
    // A desktop's failure is retried on that desktop, not from the server's row.
    expect(mainActionOf(serverRecordingStatus({ status: 'failed', method: 'local' }), item())).toBeNull();
  });
});

function serve(recordings: unknown[], local: LocalRecording[]) {
  vi.mocked(apiGet).mockImplementation((async (path: string) => {
    if (path === '/api/meet/recordings') return { recordings };
    if (path === '/api/meet/upcoming' || path === '/api/meet/history') return { meetings: [] };
    return {};
  }) as never);
  vi.mocked(call).mockImplementation((async (channel: string) => {
    if (channel === 'meetrec:list') return local;
    if (channel === 'meetrec:downloads') return {};
    return null;
  }) as never);
}
const home = () => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MeetHome /></QueryClientProvider>);

describe('Meet Home recordings', () => {
  it('lists a recording being uploaded once, with its progress on its own card', async () => {
    serve([{ id: 7, title: 'Board', created_at: T0, ready: false, size: null, status: 'uploading', method: 'local', client_id: 'r1' }], [loc({ transferId: 'up1' })]);
    app.set({ transfers: [xfer({})] } as never);
    home();
    const region = await screen.findByRole('region', { name: 'Recordings' });
    await within(region).findByText('Uploading 2.0 MB of 5.0 MB · 40%');
    expect(region.querySelectorAll('[data-recording]')).toHaveLength(1);
    expect(within(region).getAllByText('Board')).toHaveLength(1);
    expect(within(region).getAllByTestId('recording-pill').map((p) => p.textContent)).toEqual(['Uploading']);
    expect(within(region).getByRole('progressbar', { name: 'Uploading' }).getAttribute('aria-valuenow')).toBe('40');
    // No full-width processing card, no paragraph: the background note is an ⓘ, privacy a small note.
    expect(within(region).queryByText(/Finishing and uploading go on in the background/)).toBeNull();
    expect(within(region).getByText('Only you can see your recordings')).toBeTruthy();
    fireEvent.focus(within(region).getByRole('button', { name: 'About recordings' }));
    expect(screen.getByRole('tooltip').textContent).toMatch(/Finishing and uploading go on in the background/);
    expect(within(region).getByText(/5\.0 MB · This computer$/)).toBeTruthy();
  });

  it('a recording made here that the server does not list yet still appears, once', async () => {
    serve([], [loc({ state: 'recording', bytes: 3 * 1024 * 1024 })]);
    home();
    const region = await screen.findByRole('region', { name: 'Recordings' });
    await within(region).findByText('Recording… 3.0 MB');
    expect(region.querySelectorAll('[data-recording]')).toHaveLength(1);
    expect(within(region).queryByText('No recordings')).toBeNull();
  });

  it('an empty recording: No video, Failed, the real cause on one line with Details, Fix permission and Delete — no Try again', async () => {
    const message = "Nothing was recorded because WorkSuite doesn't have Screen Recording permission. Turn it on in System Settings › Privacy & Security › Screen Recording, then record again.";
    serve(
      [{ id: 7, title: 'Board', created_at: T0, ready: false, size: null, status: 'failed', method: 'local', client_id: 'r1', error: message }],
      [loc({ state: 'failed', failedAt: 'processing', problem: 'screen-permission', error: message, bytes: 1229 })],
    );
    home();
    const region = await screen.findByRole('region', { name: 'Recordings' });
    await within(region).findByText('No video');
    expect(within(region).getByTestId('recording-pill').textContent).toBe('Failed');
    expect(within(region).getByRole('alert').textContent).toBe(message);
    expect(within(region).queryByText(/no pictures/)).toBeNull();
    expect(within(region).queryByRole('button', { name: /Try again|Retry/ })).toBeNull();
    const details = within(region).getByRole('button', { name: 'Details' });
    fireEvent.click(details);
    expect(details.getAttribute('aria-expanded')).toBe('true');
    fireEvent.click(within(region).getByRole('button', { name: 'Fix permission' }));
    expect(call).toHaveBeenCalledWith('media:privacySettings', { pane: 'screen' });
    fireEvent.click(within(region).getByRole('button', { name: 'Delete' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Remove' }));
    await vi.waitFor(() => expect(call).toHaveBeenCalledWith('meetrec:discard', { id: 'r1' }));
    expect(apiDelete).toHaveBeenCalledWith('/api/meet/recordings/7');
  });

  it('a failed upload offers Retry upload, the one retry that can work', async () => {
    serve([], [loc({ state: 'failed', failedAt: 'uploading', error: 'The upload stopped: fetch failed. It continues from where it was when you try again.' })]);
    home();
    const region = await screen.findByRole('region', { name: 'Recordings' });
    fireEvent.click(await within(region).findByRole('button', { name: 'Retry upload' }));
    expect(call).toHaveBeenCalledWith('meetrec:retry', { id: 'r1' });
  });

  it('a ready one: Play as its button, Show in Finder, Rename, Share and Delete in ⋯', async () => {
    serve([{ id: 7, title: 'Board', created_at: T0, ready: true, size: 9_000_000, duration: 95, status: 'ready', method: 'local', client_id: 'r1', drive_file_id: 41, playable: true }], [loc({ state: 'ready', driveFileId: 41 })]);
    home();
    const region = await screen.findByRole('region', { name: 'Recordings' });
    await within(region).findByText(/1:35 · 8\.6 MB · Uploaded$/);
    expect(within(region).getByTestId('recording-pill').textContent).toBe('Ready');
    fireEvent.click(within(region).getByRole('button', { name: 'Play' }));
    expect(nav).toHaveBeenCalledWith('/files?file=41&play=1');
    fireEvent.click(within(region).getByRole('button', { name: 'More for Board' }));
    const items = [...screen.getByRole('menu').querySelectorAll('[role="menuitem"]')].map((b) => b.textContent);
    expect(items).toEqual(expect.arrayContaining(['Show in Finder', 'Rename', 'Share…', 'Delete']));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Share…' }));
    expect(nav).toHaveBeenCalledWith('/files?file=41&share=1');
  });
});

describe('the indicator in the meeting', () => {
  it('shows elapsed time and size while recording', () => {
    render(<RecordingFeedback active since={1000} now={62_000} size={3 * 1024 * 1024} />);
    expect(screen.getByRole('status').textContent).toMatch(/Recording On · 1:01 · 3\.0 MB/);
  });

  it('a missing permission is explained, with Open System Settings and Check again instead of Retry', () => {
    const retry = vi.fn();
    const settings = vi.fn();
    render(<RecordingFeedback active={false} since={null} now={0} phase="error" error="Recording isn't capturing video. Check Screen Recording permission." fix="screen-permission" retry={retry} openSettings={settings} />);
    expect(screen.getByRole('alert').textContent).toMatch(/Screen Recording permission needed/);
    expect(screen.queryByRole('button', { name: 'Retry recording' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Open System Settings' }));
    fireEvent.click(screen.getByRole('button', { name: 'Check again' }));
    expect(settings).toHaveBeenCalledOnce();
    expect(retry).toHaveBeenCalledOnce();
  });
});

// ── the recorder ───────────────────────────────────────────────────────────

class FakeTrack {
  readyState: 'live' | 'ended' = 'live';
  enabled = true;
  id = Math.random().toString(36);
  stop() {
    this.readyState = 'ended';
  }
}
class FakeStream {
  constructor(private tracks: FakeTrack[] = []) {}
  getVideoTracks() {
    return this.tracks.filter((t) => (t as FakeTrack & { kind?: string }).kind !== 'audio');
  }
  getAudioTracks() {
    return [];
  }
  getTracks() {
    return this.tracks;
  }
}
const recorders: FakeRecorder[] = [];
class FakeRecorder extends EventTarget {
  static isTypeSupported = (t: string) => t.startsWith('video/webm');
  state: 'inactive' | 'recording' = 'inactive';
  timeslice: number | undefined;
  ondataavailable: ((e: Event & { data: { size: number } }) => void) | null = null;
  onstart: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onstop: (() => void) | null = null;
  constructor(
    readonly stream: FakeStream,
    readonly options: { mimeType: string },
  ) {
    super();
    recorders.push(this);
  }
  start(timeslice?: number) {
    this.timeslice = timeslice;
    this.state = 'recording';
    queueMicrotask(() => this.onstart?.());
  }
  emit(size: number) {
    const e = Object.assign(new Event('dataavailable'), { data: { size, arrayBuffer: async () => new ArrayBuffer(size) } });
    this.ondataavailable?.(e);
    this.dispatchEvent(e);
  }
  stop() {
    this.state = 'inactive';
    // The last piece, then stop — a moment later, as Chromium does.
    setTimeout(() => {
      this.emit(2048);
      this.onstop?.();
      this.dispatchEvent(new Event('stop'));
    }, 50);
  }
}

describe('recording on this computer', () => {
  let videoLive = true;
  beforeEach(() => {
    recorders.length = 0;
    videoLive = true;
    vi.stubGlobal('MediaRecorder', FakeRecorder);
    vi.stubGlobal('MediaStream', FakeStream);
    vi.stubGlobal(
      'AudioContext',
      class {
        resume = async () => undefined;
        close = async () => undefined;
        createMediaStreamDestination = () => ({ stream: new FakeStream() });
        createOscillator = () => ({ connect: () => undefined, start: () => undefined });
        createGain = () => ({ gain: { value: 1 }, connect: () => undefined });
        createMediaStreamSource = () => ({ connect: () => undefined, disconnect: () => undefined });
      },
    );
    (HTMLCanvasElement.prototype as unknown as { captureStream: () => FakeStream }).captureStream = () => {
      const t = new FakeTrack();
      if (!videoLive) t.readyState = 'ended';
      return new FakeStream([t]);
    };
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const room = { localParticipant: { isMicrophoneEnabled: false, getTrackPublication: () => undefined, identity: 'me', isLocal: true, name: 'Me', metadata: '' }, remoteParticipants: new Map() } as never;
  const bridge = (preflight: Record<string, unknown> = { ok: true, why: null, fix: null }) => {
    const order: string[] = [];
    vi.mocked(call).mockImplementation((async (channel: string) => {
      order.push(channel);
      if (channel === 'meetrec:preflight') return { folder: '/x', free: null, screen: 'granted', ...preflight };
      if (channel === 'meetrec:start') return { id: '1b4e28ba-2fa1-11d2-883f-0016d3cca427' };
      return null;
    }) as never);
    return order;
  };

  it('does not start without Screen Recording permission, and says how to fix it', async () => {
    const order = bridge({ ok: false, why: "WorkSuite doesn't have Screen Recording permission, so the recording would be empty.", fix: 'screen-permission', screen: 'missing' });
    const rec = new LocalRecorder(room, { layout: 'grid', quality: '720p', speaker: () => null, onError: vi.fn() });
    const err = await rec.start(UUID, 'Board').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RecordingError);
    expect((err as InstanceType<typeof RecordingError>).fix).toBe('screen-permission');
    expect(order).not.toContain('meetrec:start');
    expect(recorders).toHaveLength(0);
  });

  it('does not start without a live video track', async () => {
    videoLive = false;
    const order = bridge();
    const rec = new LocalRecorder(room, { layout: 'grid', quality: '720p', speaker: () => null, onError: vi.fn() });
    await expect(rec.start(UUID, 'Board')).rejects.toThrow(/would be empty/);
    expect(order).not.toContain('meetrec:start');
    expect(hasLiveVideo(new FakeStream([new FakeTrack()]) as never)).toBe(true);
  });

  it('records VP9 in one-second pieces, each written as it arrives; stopping waits for the last piece', async () => {
    const order = bridge();
    const onError = vi.fn();
    const rec = new LocalRecorder(room, { layout: 'grid', quality: '720p', speaker: () => null, onError });
    await rec.start(UUID, 'Board');
    const r = recorders[0]!;
    expect(r.options.mimeType).toBe('video/webm;codecs=vp9,opus');
    expect(r.timeslice).toBe(TIMESLICE_MS);
    r.emit(64 * 1024);
    await vi.waitFor(() => expect(order.filter((c) => c === 'meetrec:chunk')).toHaveLength(1));
    expect(rec.bytes).toBe(64 * 1024);
    await rec.stop();
    // The last piece was written before the main process was told to finish the file.
    expect(order.filter((c) => c === 'meetrec:chunk')).toHaveLength(2);
    expect(order.lastIndexOf('meetrec:chunk')).toBeLessThan(order.indexOf('meetrec:stop'));
    expect(onError).not.toHaveBeenCalled();
  });

  it('stops within 5 seconds when no video arrives, and warns', async () => {
    vi.useFakeTimers();
    const order = bridge();
    const onError = vi.fn();
    const rec = new LocalRecorder(room, { layout: 'grid', quality: '720p', speaker: () => null, onError });
    const started = rec.start(UUID, 'Board');
    await vi.advanceTimersByTimeAsync(0);
    await started;
    recorders[0]!.emit(1229); // a header and nothing else: the 1.2 KB of #240
    await vi.advanceTimersByTimeAsync(4_900);
    expect(onError).not.toHaveBeenCalled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });
    expect(onError).toHaveBeenCalledWith("Recording isn't capturing video. Check Screen Recording permission.", { stopped: true, fix: 'screen-permission' });
    await vi.advanceTimersByTimeAsync(1_000);
    expect(order).toContain('meetrec:stop');
    expect(capturing(1229)).toBe(false);
    expect(capturing(256 * 1024)).toBe(true);
    expect(noVideoWarning(false)).not.toMatch(/Screen Recording/);
  });
});
