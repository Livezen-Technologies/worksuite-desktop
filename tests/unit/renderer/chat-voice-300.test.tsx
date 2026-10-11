// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Transfer } from '../../../shared/types';
import type * as CoreApi from '../../../src/core/api';

/**
 * worksuite-desktop#300 — voice messages that go fast: recorded as Opus mono at 32 kbit/s (AAC elsewhere) and sent
 * as recorded; room checked before recording, a countdown near the limit, what was recorded kept when the microphone
 * goes; the bubble at once with "Sending…", how much has gone, "Retrying in …" and "Sent" only once confirmed; Cancel
 * taking the bubble away; and the send timed from Send to bubble and to "Sent".
 */
const net = vi.hoisted(() => ({ call: vi.fn(), post: vi.fn(), toast: vi.fn() }));
vi.mock('../../../src/core/api', async (orig) => ({ ...(await orig<typeof CoreApi>()), apiGet: vi.fn(async () => ({})), apiPost: net.post, request: vi.fn() }));
vi.mock('../../../src/core/bridge', () => ({ call: net.call, on: () => () => undefined, errorMessage: (e: unknown) => (e instanceof Error ? e.message : String(e)), isMac: false, hasDesktop: () => true, registerDropped: vi.fn() }));
vi.mock('../../../src/core/toasts', () => ({ toast: net.toast }));

import { app } from '../../../src/core/app-state';
import { COUNTDOWN_MS, VOICE_BITS_PER_SECOND, countdown, storageRoom, voiceBytes, voiceExtension, voiceRecorderOptions } from '../../../src/modules/chat/kit/recording';
import { clearVoiceMetrics, quantile, summarize, summarizeByNetwork, voiceMetrics, type VoiceSample } from '../../../src/modules/chat/kit/voiceMetrics';
import { OutgoingMediaBubbles, voiceStatusText } from '../../../src/modules/chat/OutgoingMedia';
import { outgoing, outgoingForRoom, queueMedia } from '../../../src/modules/chat/outgoing';
import { VoiceRecorder } from '../../../src/modules/chat/parts';

const WAVE = Array.from({ length: 64 }, (_, i) => (i * 37) % 101);
const wrap = (ui: ReactNode) => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>);

beforeEach(() => {
  app.set({ auth: { user: { id: '3' }, server: { origin: 'https://ws.example' } }, transfers: [], bootstrap: { permissions: ['*'] } } as never);
  localStorage.clear();
  clearVoiceMetrics();
  outgoing.set({ jobs: [] });
  net.toast.mockReset();
  net.call.mockReset().mockImplementation(async (channel: string, input?: { name?: string }) => {
    if (channel === 'transfers:prepareMedia') return { handle: 'prepared1', name: input!.name, size: 100 };
    if (channel === 'transfers:upload') return [{ id: 't1', state: 'queued' }];
    return null;
  });
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn(() => 'blob:voice') });
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  app.set({ auth: null, transfers: [] } as never);
});

describe('the recording format (#300)', () => {
  it('asks for Opus at 32 kbit/s, WebM before Ogg, and AAC in MP4 where Opus cannot be recorded', () => {
    expect(VOICE_BITS_PER_SECOND).toBeGreaterThanOrEqual(24_000);
    expect(VOICE_BITS_PER_SECOND).toBeLessThanOrEqual(32_000);
    expect(voiceRecorderOptions(() => true)).toEqual({ mimeType: 'audio/webm;codecs=opus', audioBitsPerSecond: 32_000 });
    expect(voiceRecorderOptions((t) => t.startsWith('audio/ogg'))).toEqual({ mimeType: 'audio/ogg;codecs=opus', audioBitsPerSecond: 32_000 });
    // Safari's engine: AAC, at the same rate.
    expect(voiceRecorderOptions((t) => t.startsWith('audio/mp4'))).toEqual({ mimeType: 'audio/mp4;codecs=mp4a.40.2', audioBitsPerSecond: 32_000 });
    expect(voiceRecorderOptions(() => false)).toEqual({ audioBitsPerSecond: 32_000 });
    expect(voiceRecorderOptions(() => { throw new Error('no'); })).toEqual({ audioBitsPerSecond: 32_000 });
    expect([voiceExtension('audio/webm;codecs=opus'), voiceExtension('audio/ogg'), voiceExtension('audio/mp4;codecs=mp4a.40.2')]).toEqual(['webm', 'ogg', 'm4a']);
  });

  it('a minute is about a quarter of a megabyte', () => {
    expect(voiceBytes(60_000)).toBe(300_000);
  });

  it('warns before recording when there is room for a shorter recording only, and refuses when not even a minute fits', () => {
    expect(storageRoom(undefined)).toEqual({ kind: 'ok' });
    expect(storageRoom({ usage: 0, quota: 1e9 })).toEqual({ kind: 'ok' });
    expect(storageRoom({ usage: 0, quota: voiceBytes(60_000) * 2 * 3.5 })).toEqual({ kind: 'low', minutes: 3 });
    expect(storageRoom({ usage: 10, quota: 100_000 })).toEqual({ kind: 'full' });
  });

  it('counts down over the last half minute only', () => {
    expect(countdown(0, 600_000)).toBeNull();
    expect(countdown(600_000 - COUNTDOWN_MS - 1, 600_000)).toBeNull();
    expect(countdown(600_000 - 25_000, 600_000)).toBe(25_000);
    expect(countdown(700_000, 600_000)).toBe(0);
  });
});

describe('the recorder (#300)', () => {
  type Listener = () => void;
  class FakeTrack {
    listeners: Listener[] = [];
    addEventListener(_: string, fn: Listener) { this.listeners.push(fn); }
    stop() {}
    end() { this.listeners.forEach((fn) => fn()); }
  }
  class FakeRecorder {
    static isTypeSupported = (m: string) => m === 'audio/webm;codecs=opus';
    state: 'inactive' | 'recording' | 'paused' = 'inactive';
    mimeType: string;
    options: MediaRecorderOptions | undefined;
    ondataavailable: ((e: { data: Blob }) => void) | null = null;
    onstop: (() => void) | null = null;
    onerror: (() => void) | null = null;
    constructor(_s: unknown, o?: MediaRecorderOptions) {
      this.mimeType = o?.mimeType ?? '';
      this.options = o;
      recorders.push(this);
    }
    start() { this.state = 'recording'; }
    pause() { this.state = 'paused'; }
    resume() { this.state = 'recording'; }
    requestData() {}
    stop() {
      this.state = 'inactive';
      this.ondataavailable?.({ data: new Blob(['voice'], { type: this.mimeType }) });
      this.onstop?.();
    }
  }
  const recorders: FakeRecorder[] = [];
  class FakeAudio {
    resume = async () => undefined;
    close = async () => undefined;
    createAnalyser = () => ({ fftSize: 0, getByteTimeDomainData: (b: Uint8Array) => b.fill(160) });
    createMediaStreamSource = () => ({ connect: () => undefined });
  }
  let track: FakeTrack;
  let asked: MediaStreamConstraints | undefined;
  const setUp = (estimate?: { usage: number; quota: number }) => {
    recorders.length = 0;
    track = new FakeTrack();
    net.call.mockImplementation(async (channel: string) => (channel === 'media:access' ? { granted: true } : null));
    vi.stubGlobal('MediaRecorder', FakeRecorder);
    vi.stubGlobal('AudioContext', FakeAudio);
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: async (c: MediaStreamConstraints) => ((asked = c), { getTracks: () => [track] }) } });
    Object.defineProperty(navigator, 'storage', { configurable: true, value: estimate ? { estimate: async () => estimate } : undefined });
  };

  it('records Opus, mono, at the voice bit rate, and says when Send was pressed', async () => {
    setUp();
    const onDone = vi.fn();
    render(<VoiceRecorder onDone={onDone} onCancel={vi.fn()} />);
    await screen.findByRole('button', { name: 'Pause recording' });
    expect(recorders[0]!.options).toEqual({ mimeType: 'audio/webm;codecs=opus', audioBitsPerSecond: 32_000 });
    expect(asked?.audio).toMatchObject({ channelCount: 1, echoCancellation: true, noiseSuppression: true });
    fireEvent.click(screen.getByRole('button', { name: 'Send the voice message' }));
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(typeof onDone.mock.calls[0]![3]).toBe('number');
  });

  it('keeps what was recorded when the microphone goes, and says so', async () => {
    setUp();
    const onDone = vi.fn();
    render(<VoiceRecorder onDone={onDone} onCancel={vi.fn()} />);
    await screen.findByRole('button', { name: 'Pause recording' });
    act(() => track.end());
    expect(screen.getByRole('alert').textContent).toMatch(/microphone stopped.*What you recorded is kept/);
    expect(recorders[0]!.state).toBe('inactive');
    // Kept, to listen to and send.
    expect(screen.getByRole('button', { name: 'Listen to the recording' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Send the voice message' }));
    expect(onDone).toHaveBeenCalledTimes(1);
    expect((onDone.mock.calls[0]![0] as Blob).size).toBeGreaterThan(0);
  });

  it('refuses before the microphone opens when there is no room to keep a recording', async () => {
    setUp({ usage: 0, quota: 50_000 });
    const onCancel = vi.fn();
    render(<VoiceRecorder onDone={vi.fn()} onCancel={onCancel} />);
    await waitFor(() => expect(onCancel).toHaveBeenCalled());
    expect(net.toast).toHaveBeenCalledWith('error', expect.stringMatching(/out of space/));
    expect(recorders).toHaveLength(0);
    expect(net.call).not.toHaveBeenCalledWith('media:access', expect.anything());
  });

  it('warns, and records, when there is room for a few minutes only', async () => {
    setUp({ usage: 0, quota: voiceBytes(60_000) * 2 * 4.2 });
    render(<VoiceRecorder onDone={vi.fn()} onCancel={vi.fn()} />);
    await screen.findByRole('button', { name: 'Pause recording' });
    expect(net.toast).toHaveBeenCalledWith('warning', expect.stringMatching(/about 4 minutes/));
  });

  it('shows a countdown over the last half minute', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    setUp();
    render(<VoiceRecorder onDone={vi.fn()} onCancel={vi.fn()} />);
    await screen.findByRole('button', { name: 'Pause recording' });
    expect(screen.queryByRole('timer')).toBeNull();
    await act(async () => void vi.advanceTimersByTime(10 * 60_000 - 20_000));
    expect(screen.getByRole('timer').textContent).toMatch(/0:(19|20) left/);
  });
});

describe('the bubble while it goes (#300)', () => {
  const blob = () => Object.assign(new Blob(['voice'], { type: 'audio/webm;codecs=opus' }), { arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer });
  const send = () => queueMedia('12', [{ key: 'v', kind: 'blob', blob: blob(), name: 'Voice message.webm', state: 'ready', progress: 0, error: null, extra: null }], { voice: true, durationMs: 2400, waveform: WAVE }, true, { pressedAt: performance.now() });
  const transfer = (id: string, o: Partial<Transfer> = {}): Transfer => ({ id: 't1', direction: 'upload', name: 'Voice message.webm', source: '', destination: 'Chat', bytes: 40, total: 100, state: 'running', phase: 'uploading', speed: 0, error: null, createdAt: new Date().toISOString(), chat: { roomId: '12', clientMessageId: id, voice: true, durationMs: 2400, waveform: WAVE }, ...o });
  const status = () => document.querySelector('[data-voice-status]');

  it('says Sending… with how much has gone, Retrying in … between tries, and Sent only when the server confirmed it', async () => {
    send();
    const id = outgoing.get().jobs[0]!.id;
    wrap(<OutgoingMediaBubbles roomId="12" messages={[]} />);
    expect(status()!.textContent).toBe('Sending…');
    await waitFor(() => expect(outgoing.get().jobs[0]!.transferId).toBe('t1'));
    act(() => app.set({ transfers: [transfer(id)] }));
    expect(status()!.textContent).toBe('Sending… 40%');
    act(() => app.set({ transfers: [transfer(id, { bytes: 100, phase: 'sending' })] }));
    expect(status()!.textContent).toBe('Sending…');
    act(() => app.set({ transfers: [transfer(id, { state: 'queued', phase: 'waiting', retryAt: new Date(Date.now() + 15_000).toISOString(), attempts: 2, error: 'Connection lost' })] }));
    expect(status()!.textContent).toMatch(/^Retrying in 1[45] s$/);
    act(() => app.set({ transfers: [transfer(id, { state: 'done', phase: 'sending', bytes: 100 })] }));
    expect(status()!.textContent).toBe('Sent');
    expect(status()!.getAttribute('data-voice-status')).toBe('sent');
  });

  it('offers Retry and Cancel when it did not go, and Cancel takes the bubble away', async () => {
    send();
    const id = outgoing.get().jobs[0]!.id;
    await waitFor(() => expect(outgoing.get().jobs[0]!.transferId).toBe('t1'));
    act(() => app.set({ transfers: [transfer(id, { state: 'failed', error: 'Connection lost.' })] }));
    const { container } = wrap(<OutgoingMediaBubbles roomId="12" messages={[]} />);
    expect(screen.getByRole('button', { name: 'Retry sending the voice message' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Discard the voice message' }));
    await waitFor(() => expect(net.call).toHaveBeenCalledWith('transfers:cancel', { id: 't1' }));
    act(() => app.set({ transfers: [transfer(id, { state: 'cancelled' })] }));
    expect(container.querySelector('[data-outgoing-voice]')).toBeNull();
    expect(outgoing.get().jobs).toHaveLength(0);
  });

  it('comes back from the transfer queue in another window or after a restart, playing the recording kept here', () => {
    const preview = 'app://bundle/__local/chat-media/0b6c7f1e-1111-4222-8333-944445555666';
    const t = transfer('desktop-restored', { state: 'failed', error: 'Connection lost', chat: { roomId: '12', clientMessageId: 'desktop-restored', voice: true, durationMs: 2400, waveform: WAVE, preview } });
    const [job] = outgoingForRoom('12', [t]);
    expect(job!.preview).toBe(preview);
    expect(job!.target).not.toHaveProperty('preview');
    // A cancelled one never comes back.
    expect(outgoingForRoom('12', [{ ...t, state: 'cancelled' }])).toHaveLength(0);
  });

  it('times Send → bubble and Send → Sent, with its size', async () => {
    send();
    const id = outgoing.get().jobs[0]!.id;
    wrap(<OutgoingMediaBubbles roomId="12" messages={[]} />);
    await waitFor(() => expect(outgoing.get().jobs[0]!.transferId).toBe('t1'));
    // A frame later the bubble is painted.
    await act(async () => void (await new Promise((r) => setTimeout(r, 40))));
    act(() => app.set({ transfers: [transfer(id, { state: 'done', phase: 'sending', bytes: 100 })] }));
    const [sample] = voiceMetrics.get().samples;
    expect(sample).toMatchObject({ id, durationMs: 2400, failed: false });
    expect(sample!.bubbleMs).not.toBeNull();
    expect(sample!.confirmMs).toBeGreaterThanOrEqual(sample!.bubbleMs!);
  });

  it('words the status', () => {
    expect(voiceStatusText({ phase: 'preparing', progress: null })).toBe('Sending…');
    expect(voiceStatusText({ phase: 'uploading', progress: 0.5 })).toBe('Sending… 50%');
    expect(voiceStatusText({ phase: 'queued', progress: null, retryAt: new Date(10_000).toISOString() }, 4_500)).toBe('Retrying in 6 s');
    expect(voiceStatusText({ phase: 'sent', progress: 1 })).toBe('Sent');
  });
});

describe('the send times (#300)', () => {
  const sample = (o: Partial<VoiceSample>): VoiceSample => ({ id: Math.random().toString(36), at: '', bytes: 240_000, durationMs: 60_000, mime: 'audio/webm', bubbleMs: 30, confirmMs: 900, retries: 0, failed: false, network: '4g', ...o });

  it('sums up the median and the 95th percentile, size per minute, failures and retries, per connection', () => {
    expect(quantile([], 0.5)).toBeNull();
    expect(quantile([5, 1, 3], 0.5)).toBe(3);
    expect(quantile(Array.from({ length: 100 }, (_, i) => i + 1), 0.95)).toBe(95);
    const list = [sample({ confirmMs: 800 }), sample({ confirmMs: 1200, retries: 2 }), sample({ confirmMs: null, failed: true, network: '3g' }), sample({ confirmMs: 4000, network: '3g', bytes: 120_000, durationMs: 30_000 })];
    const all = summarize(list);
    expect(all).toMatchObject({ count: 4, bytesPerMinute: 240_000, failureRate: 0.25, retries: 2 });
    expect(all.confirm).toEqual({ median: 1200, p95: 4000 });
    expect(summarizeByNetwork(list).map((g) => [g.network, g.summary.count])).toEqual([['4g', 2], ['3g', 2]]);
  });
});
