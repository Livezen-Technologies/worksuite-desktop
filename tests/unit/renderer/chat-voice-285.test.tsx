// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Transfer } from '../../../shared/types';
import type * as CoreApi from '../../../src/core/api';
import type * as AttachmentViewer from '../../../src/modules/chat/AttachmentViewer';

/**
 * Voice messages (worksuite-desktop#285): the app's own player in place of the browser's — play, the recording's
 * loudness, its length counting down, speed, seeking, Space and a screen reader's words — for Team Chat, website
 * chats and WhatsApp; a voice message decided by its type and never shown as a video, a file name or "Processing…";
 * sent with its length and loudness measured here, its bubble there at once with a ring on the play button; a dot
 * until it is first played; and tooltips that never stay on screen.
 */
const net = vi.hoisted(() => ({ call: vi.fn(), post: vi.fn() }));
vi.mock('../../../src/core/api', async (orig) => ({ ...(await orig<typeof CoreApi>()), apiGet: vi.fn(async () => ({})), apiPost: net.post, request: vi.fn() }));
vi.mock('../../../src/core/bridge', () => ({ call: net.call, on: () => () => undefined, errorMessage: (e: unknown) => (e instanceof Error ? e.message : String(e)), isMac: false, hasDesktop: () => true, registerDropped: vi.fn() }));
vi.mock('../../../src/core/toasts', () => ({ toast: vi.fn() }));
vi.mock('../../../src/core/tab-context', () => ({ useTab: () => ({ openLink: vi.fn() }), openWebLink: vi.fn() }));
vi.mock('../../../src/modules/chat/AttachmentViewer', async (orig) => ({ ...(await orig<typeof AttachmentViewer>()), openChatAttachment: vi.fn() }));

import { ApiError } from '../../../src/core/api';
import { app } from '../../../src/core/app-state';
import { TOOLTIP_DELAY, wireTooltips } from '../../../src/core/tooltips';
import { previewKind } from '../../../src/modules/chat/AttachmentViewer';
import { TEAM_CAPS, WEBSITE_CAPS } from '../../../src/modules/chat/kit/caps';
import { MessageList } from '../../../src/modules/chat/kit/MessageList';
import { fromChatMessage, fromWebsiteMessage, type KitMessage } from '../../../src/modules/chat/kit/model';
import { heard, isVoiceFile, readVoice, voiceLabel } from '../../../src/modules/chat/kit/voice';
import { VoiceMessage } from '../../../src/modules/chat/kit/VoiceMessage';
import { WAVEFORM_STEPS, levelsToWaveform, peaksOf, resample, scaled, waveformOf } from '../../../src/modules/chat/kit/waveform';
import { OutgoingMediaBubbles } from '../../../src/modules/chat/OutgoingMedia';
import { outgoing, queueMedia } from '../../../src/modules/chat/outgoing';
import { VoiceRecorder } from '../../../src/modules/chat/parts';
import type { ChatMessage } from '../../../src/modules/chat/types';
import type { WebsiteMessage } from '../../../src/modules/chat/website/api';

const T0 = '2026-10-07T05:00:00Z';
const WAVE = Array.from({ length: 64 }, (_, i) => (i * 37) % 101);

const voiceFile = (o: Partial<NonNullable<ChatMessage['file']>> = {}): NonNullable<ChatMessage['file']> => ({
  id: 1, kind: 'voice', filename: 'Voice message.webm', mime: 'video/webm', size: 33 * 1024, is_image: false, duration_ms: 12_000, waveform: WAVE, width: null, height: null,
  preview: 'audio', status: 'ready', url: '/media/voicetoken0001', download_url: '/media/voicetoken0001?download=1', thumb_url: null, poster_url: null, ...o,
});
const voiceMessage = (o: Partial<ChatMessage> & { id: number }): ChatMessage => ({
  room_id: 1, sender_id: 7, sender_name: 'Asha', type: 'voice', message: '', file: voiceFile(), reactions: [], reply_preview: null, edited: false, deleted: false, receipt: null, client_message_id: null, created_at: T0, ...o,
});

const wrap = (ui: ReactNode) => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>);
const list = (items: KitMessage[], look: 'page' | 'drawer' = 'page', caps = TEAM_CAPS) => wrap(<MessageList items={items} caps={caps} look={look} handlers={{}} />);
const player = () => screen.getByRole('group', { name: /^Voice message/ });
const clock = (root: HTMLElement = player()) => root.querySelector('[data-clock]')!.textContent;
const audioOf = (root: HTMLElement = player()) => root.querySelector('audio')!;

beforeEach(() => {
  app.set({ auth: { user: { id: '3' }, server: { origin: 'https://ws.example' } }, transfers: [], bootstrap: { permissions: ['*'] } } as never);
  heard.set({ keys: [] });
  localStorage.clear();
  outgoing.set({ jobs: [] });
  net.post.mockReset().mockResolvedValue({ ok: true });
  net.call.mockReset().mockImplementation(async (channel: string, input?: { name?: string }) => {
    if (channel === 'transfers:prepareMedia') return { handle: 'prepared1', name: input!.name, size: 100 };
    if (channel === 'transfers:upload') return [{ id: 't1', state: 'queued' }];
    return null;
  });
  // jsdom has no media: playing says so, as a browser does, and pausing too.
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(function (this: HTMLMediaElement) {
    this.dispatchEvent(new Event('play'));
    return Promise.resolve();
  });
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(function (this: HTMLMediaElement) {
    this.dispatchEvent(new Event('pause'));
  });
  vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => undefined);
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn(() => 'blob:voice') });
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  app.set({ auth: null, transfers: [] } as never);
});

describe('a voice message is decided by its type, never its extension', () => {
  it('reads a WebM voice message as sound, whatever its bytes were sniffed as', () => {
    expect(previewKind({ filename: 'Voice message.webm', mime: 'video/webm', preview: 'audio', is_image: false })).toBe('audio');
    expect(previewKind({ filename: 'Voice message.webm', mime: 'video/webm', preview: null, is_image: false, kind: 'voice' })).toBe('audio');
    for (const mime of ['audio/webm', 'audio/ogg', 'audio/mp4', 'audio/aac']) expect(previewKind({ filename: 'x.webm', mime, preview: null, is_image: false })).toBe('audio');
    // A real video is still a video.
    expect(previewKind({ filename: 'clip.webm', mime: 'video/webm', preview: 'video', is_image: false })).toBe('video');
    expect(isVoiceFile({ filename: 'a.webm', mime: 'audio/webm', preview: null, is_image: false }, true)).toBe(true);
    expect(isVoiceFile({ filename: 'a.webm', mime: 'video/webm', preview: null, is_image: false, kind: 'voice' }, false)).toBe(true);
    expect(isVoiceFile({ filename: 'song.webm', mime: 'video/webm', preview: 'video', is_image: false }, true)).toBe(false);
  });

  it('draws the player alone: no video, no browser controls, no file name or size', () => {
    const { container } = list([fromChatMessage(voiceMessage({ id: 1 }), '3')]);
    expect(container.querySelector('video')).toBeNull();
    expect(container.querySelector('audio[controls]')).toBeNull();
    expect(container.querySelector('audio')!.className).toContain('hidden');
    expect(container.textContent).not.toMatch(/Voice message\.webm|33 KB|Processing|processing/);
    expect(player()).toBeTruthy();
  });

  it('shows no "processing" line while the server finishes one: the player waits with its ring', () => {
    const { container } = list([fromChatMessage(voiceMessage({ id: 2, file: voiceFile({ status: 'processing', url: null }) }), '3')]);
    expect(container.textContent).not.toMatch(/processing/i);
    expect(screen.getByRole('button', { name: 'Play the voice message' })).toHaveProperty('disabled', true);
    expect(container.querySelector('circle[data-ring]')).toBeTruthy();
  });
});

describe('the player', () => {
  it('has a play button, the waveform, the length, the speed and a screen reader’s words', () => {
    list([fromChatMessage(voiceMessage({ id: 3 }), '3')]);
    const p = player();
    expect(p.getAttribute('aria-label')).toBe('Voice message, 12 seconds');
    expect(within(p).getByRole('button', { name: 'Play the voice message' })).toBeTruthy();
    const bars = p.querySelectorAll('[data-bar]');
    expect(bars.length).toBeGreaterThanOrEqual(30);
    expect(bars.length).toBeLessThanOrEqual(40);
    // The bars are the message's own loudness.
    expect([...bars].map((b) => Number(b.getAttribute('data-bar')))).toEqual(resample(WAVE, bars.length));
    expect(clock(p)).toBe('0:12');
    expect(within(p).getByRole('button', { name: 'Playback speed 1×' }).textContent).toBe('1×');
    // The stream: the server's signed address, played by a hidden element.
    expect(audioOf(p).getAttribute('src')).toBe('https://ws.example/media/voicetoken0001');
  });

  it('cycles the speed 1× → 1.5× → 2× → 1×', () => {
    list([fromChatMessage(voiceMessage({ id: 4 }), '3')]);
    const speed = () => within(player()).getByRole('button', { name: /^Playback speed/ });
    fireEvent.click(speed());
    expect(speed().textContent).toBe('1.5×');
    expect(audioOf().playbackRate).toBe(1.5);
    fireEvent.click(speed());
    expect(speed().textContent).toBe('2×');
    expect(audioOf().playbackRate).toBe(2);
    fireEvent.click(speed());
    expect(speed().textContent).toBe('1×');
  });

  it('counts down while it plays, and shows the whole length again at the end', () => {
    list([fromChatMessage(voiceMessage({ id: 5 }), '3')]);
    fireEvent.click(screen.getByRole('button', { name: 'Play the voice message' }));
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Pause the voice message' })).toBeTruthy();
    const a = audioOf();
    a.currentTime = 3;
    fireEvent.timeUpdate(a);
    expect(clock()).toBe('0:09');
    // The played part fills in.
    expect(player().querySelectorAll('[data-bar].bg-primary').length).toBeGreaterThan(0);
    fireEvent.ended(a);
    expect(clock()).toBe('0:12');
  });

  it('plays and pauses with Space when it has focus', () => {
    list([fromChatMessage(voiceMessage({ id: 6 }), '3')]);
    const p = player();
    p.focus();
    fireEvent.keyDown(p, { key: ' ' });
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(1);
    expect(within(p).getByRole('button', { name: 'Pause the voice message' })).toBeTruthy();
    fireEvent.keyDown(p, { key: ' ' });
    expect(HTMLMediaElement.prototype.pause).toHaveBeenCalled();
    expect(within(p).getByRole('button', { name: 'Play the voice message' })).toBeTruthy();
  });

  it('goes to the point clicked on the waveform', () => {
    list([fromChatMessage(voiceMessage({ id: 7 }), '3')]);
    const bar = within(player()).getByRole('slider', { name: 'Position' });
    bar.getBoundingClientRect = () => ({ left: 100, width: 200, top: 0, right: 300, bottom: 28, height: 28, x: 100, y: 0, toJSON: () => ({}) });
    fireEvent.click(bar, { clientX: 150 });
    expect(audioOf().currentTime).toBe(3);
    expect(clock()).toBe('0:09');
    expect(bar.getAttribute('aria-valuenow')).toBe('3');
    // And with the keyboard.
    fireEvent.keyDown(bar, { key: 'ArrowRight' });
    expect(audioOf().currentTime).toBe(8);
  });

  it('plays the AAC copy where the original cannot be played', () => {
    list([fromChatMessage(voiceMessage({ id: 8, file: voiceFile({ m4a_url: '/media/voicetoken0001m4a' }) }), '3')]);
    expect(audioOf().getAttribute('src')).toBe('https://ws.example/media/voicetoken0001');
    fireEvent.click(screen.getByRole('button', { name: 'Play the voice message' }));
    fireEvent.error(audioOf());
    expect(audioOf().getAttribute('src')).toBe('https://ws.example/media/voicetoken0001m4a');
    // It goes on playing from the copy once the copy can.
    fireEvent.canPlay(audioOf());
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(2);
    fireEvent.error(audioOf());
    expect(screen.getByRole('button', { name: /could not be played/ })).toBeTruthy();
  });

  it('says a minute and seconds, and only "Voice message" without a length', () => {
    expect(voiceLabel(12)).toBe('Voice message, 12 seconds');
    expect(voiceLabel(1)).toBe('Voice message, 1 second');
    expect(voiceLabel(65)).toBe('Voice message, 1 minute 5 seconds');
    expect(voiceLabel(120)).toBe('Voice message, 2 minutes');
    expect(voiceLabel(0)).toBe('Voice message');
    expect(voiceLabel(null)).toBe('Voice message');
  });
});

describe('played or not', () => {
  it('shows a dot on the other side’s message until it is played, and tells the server once', async () => {
    list([fromChatMessage(voiceMessage({ id: 21, listened: false }), '3')]);
    expect(within(player()).getByRole('img', { name: 'Not played yet' })).toBeTruthy();
    // Their avatar, with a microphone.
    expect(player().querySelector('[data-voice-avatar]')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Play the voice message' }));
    expect(within(player()).queryByRole('img', { name: 'Not played yet' })).toBeNull();
    await waitFor(() => expect(net.post).toHaveBeenCalledWith('/api/chat/messages/21/listened'));
    fireEvent.click(screen.getByRole('button', { name: 'Pause the voice message' }));
    fireEvent.click(screen.getByRole('button', { name: 'Play the voice message' }));
    expect(net.post).toHaveBeenCalledTimes(1);
  });

  it('shows no dot on a message already played, or on my own', () => {
    list([fromChatMessage(voiceMessage({ id: 22, listened: true }), '3'), fromChatMessage(voiceMessage({ id: 23, sender_id: 3, sender_name: 'Me' }), '3')]);
    expect(screen.queryByRole('img', { name: 'Not played yet' })).toBeNull();
    const mine = screen.getAllByRole('group', { name: /^Voice message/ })[1]!;
    expect(mine.querySelector('[data-voice-avatar]')).toBeNull();
  });

  it('remembers it here when the server has no such mark (404), so the dot stays gone', async () => {
    net.post.mockRejectedValue(new ApiError(404, 'Not found', null));
    const { unmount } = list([fromChatMessage(voiceMessage({ id: 24 }), '3')]);
    expect(within(player()).getByRole('img', { name: 'Not played yet' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Play the voice message' }));
    await waitFor(() => expect(net.post).toHaveBeenCalledWith('/api/chat/messages/24/listened'));
    unmount();
    list([fromChatMessage(voiceMessage({ id: 24 }), '3')]);
    expect(within(player()).queryByRole('img', { name: 'Not played yet' })).toBeNull();
    expect(localStorage.getItem('ws.chat.voice.heard')).toContain('m24');
  });
});

describe('website chats and WhatsApp use the same player', () => {
  it('plays a visitor’s recording in a website chat, never as a file card', () => {
    const m: WebsiteMessage = { id: 31, body: null, from: 'visitor', agent: null, at: T0, file: { url: '/chat/widget-admin/files/v', filename: 'memo.ogg', mime: 'audio/ogg', size: 9000, is_image: false, kind: 'audio' } };
    const { container } = list([fromWebsiteMessage(m, { me: 3, visitor: 'Visitor 4F2A', canReply: true })], 'page', WEBSITE_CAPS);
    expect(container.querySelector('[data-file-card]')).toBeNull();
    expect(audioOf().getAttribute('src')).toBe('app://bundle/__api/api/chat/widget-admin/files/v');
    // A visitor's message: their dot, kept on this computer only.
    fireEvent.click(screen.getByRole('button', { name: 'Play the voice message' }));
    expect(net.post).not.toHaveBeenCalled();
    expect(within(player()).queryByRole('img', { name: 'Not played yet' })).toBeNull();
  });

  it('streams a WhatsApp voice note (Ogg/Opus) from the Drive through the app', () => {
    render(<VoiceMessage file={{ url: '/api/files/9/download', download_url: '/api/files/9/download', size: 4000 }} own={false} look="drawer" of={{ key: 'wa9' }} />);
    expect(audioOf().getAttribute('src')).toBe('app://bundle/__api/api/files/9/download');
    expect(within(player()).getByRole('img', { name: 'Not played yet' })).toBeTruthy();
  });
});

describe('a recording without its length or loudness', () => {
  it('reads both from the recording once, when its player says Infinity (a WebM made in a browser)', async () => {
    const fetched = vi.fn(async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) }));
    const samples = new Float32Array(7 * 8000).map((_, i) => (i < 8000 ? 0.5 : 0.1));
    class FakeContext {
      decodeAudioData = vi.fn(async () => ({ duration: 7, numberOfChannels: 1, getChannelData: () => samples }));
    }
    vi.stubGlobal('fetch', fetched);
    vi.stubGlobal('OfflineAudioContext', FakeContext);
    list([fromChatMessage(voiceMessage({ id: 41, file: voiceFile({ duration_ms: null, waveform: null, url: '/media/voicetoken0041' }) }), '3')]);
    const a = audioOf();
    Object.defineProperty(a, 'duration', { configurable: true, value: Infinity });
    fireEvent.loadedMetadata(a);
    await waitFor(() => expect(clock()).toBe('0:07'));
    expect(player().getAttribute('aria-label')).toBe('Voice message, 7 seconds');
    // Through the app's proxy, which may fetch the server's signed address.
    expect(fetched).toHaveBeenCalledWith('app://bundle/__api/media/voicetoken0041');
    const bars = [...player().querySelectorAll('[data-bar]')].map((b) => Number(b.getAttribute('data-bar')));
    expect(bars[0]).toBe(100);
    expect(bars[bars.length - 1]).toBe(20);
    // Once per message.
    await readVoice('m41', 'app://bundle/__api/media/voicetoken0041');
    expect(fetched).toHaveBeenCalledTimes(1);
  });

  it('uses its player’s own length where it can tell one (Ogg, MP4), and never says 0:00 meanwhile', () => {
    list([fromChatMessage(voiceMessage({ id: 42, file: voiceFile({ duration_ms: null, mime: 'audio/ogg' }) }), '3')]);
    expect(clock()).toBe('–:––');
    const a = audioOf();
    Object.defineProperty(a, 'duration', { configurable: true, value: 4.2 });
    fireEvent.loadedMetadata(a);
    expect(clock()).toBe('0:04');
  });
});

describe('the loudness, worked out on the device', () => {
  it('fits 64 steps to the bars drawn: the loudest of each stretch', () => {
    const steps = Array.from({ length: 64 }, (_, i) => i);
    expect(resample(steps, 32)).toEqual(Array.from({ length: 32 }, (_, i) => i * 2 + 1));
    expect(resample(steps, 36)).toHaveLength(36);
    expect(resample(steps, 36)[35]).toBe(63);
    expect(resample([10, 50], 4)).toEqual([10, 10, 50, 50]);
    expect(resample([], 3)).toEqual([0, 0, 0]);
    expect(resample(steps, 64)).toEqual(steps);
  });

  it('takes the loudest sample of each equal slice, across channels, as 0–100 of the loudest', () => {
    const left = new Float32Array([0.1, -0.2, 0.05, 0.05, -0.8, 0.4, 0, 0]);
    const right = new Float32Array([0, 0, 0.3, 0, 0, 0, 0.2, -0.1]);
    expect(peaksOf([left, right], 4)).toEqual([25, 38, 100, 25]);
    expect(peaksOf([new Float32Array(10)], 4)).toEqual([0, 0, 0, 0]);
    expect(peaksOf([], 3)).toEqual([0, 0, 0]);
    expect(peaksOf([new Float32Array(1000).fill(0.5)])).toHaveLength(WAVEFORM_STEPS);
    expect(scaled([0, 2, 4])).toEqual([0, 50, 100]);
  });

  it('turns the recorder’s levels into the 64 steps sent with the message', () => {
    const w = levelsToWaveform([0.1, 0.5, 0.25]);
    expect(w).toHaveLength(64);
    expect(Math.max(...w)).toBe(100);
    expect(w[0]).toBe(20);
    expect(levelsToWaveform([])).toEqual(Array.from({ length: 64 }, () => 0));
  });

  it('takes a server’s waveform only when it is one', () => {
    expect(waveformOf([0, 50.4, 120, -3])).toEqual([0, 50, 100, 0]);
    expect(waveformOf(null)).toBeNull();
    expect(waveformOf([])).toBeNull();
    expect(waveformOf(['1'])).toBeNull();
  });
});

describe('sending a voice message', () => {
  const blob = () => {
    const b = new Blob(['voice'], { type: 'audio/webm;codecs=opus' });
    return Object.assign(b, { arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer });
  };
  const send = () =>
    queueMedia('12', [{ key: 'v', kind: 'blob', blob: blob(), name: 'Voice message.webm', state: 'ready', progress: 0, error: null, extra: null }], { voice: true, durationMs: 2400, waveform: WAVE }, true);
  const transfer = (id: string, o: Partial<Transfer> = {}): Transfer => ({ id: 't1', direction: 'upload', name: 'Voice message.webm', source: '', destination: 'Chat', bytes: 40, total: 100, state: 'running', phase: 'uploading', speed: 0, error: null, createdAt: new Date().toISOString(), chat: { roomId: '12', clientMessageId: id, voice: true, durationMs: 2400, waveform: WAVE }, ...o });

  it('sends its length and loudness with it', async () => {
    send();
    await waitFor(() => expect(net.call).toHaveBeenCalledWith('transfers:upload', expect.objectContaining({ target: expect.objectContaining({ voice: true, durationMs: 2400, waveform: WAVE }) })));
    // The recording's own type, never the `.webm` name's video.
    await waitFor(() => expect(outgoing.get().jobs[0]!.transferId).toBe('t1'));
    expect(outgoing.get().jobs[0]!.mime).toBe('audio/webm;codecs=opus');
  });

  it('shows the bubble at once, with its length, its waveform and an upload ring — no file name, size or "Processing…"', async () => {
    send();
    const id = outgoing.get().jobs[0]!.id;
    const { container } = wrap(<OutgoingMediaBubbles roomId="12" messages={[]} />);
    const p = player();
    expect(p.getAttribute('aria-label')).toBe('Voice message, 2 seconds');
    expect(clock(p)).toBe('0:02');
    expect([...p.querySelectorAll('[data-bar]')].map((b) => Number(b.getAttribute('data-bar')))).toEqual(resample(WAVE, 36));
    expect(within(p).getByRole('progressbar', { name: 'Sending the voice message' })).toBeTruthy();
    // It plays from its copy on this computer while it goes.
    expect(audioOf(p).getAttribute('src')).toBe('blob:voice');
    await waitFor(() => expect(outgoing.get().jobs[0]!.transferId).toBe('t1'));
    act(() => app.set({ transfers: [transfer(id, { phase: 'processing' })] }));
    expect(container.textContent).not.toMatch(/Processing|Preparing|Uploading|Voice message\.webm|KB/);
    expect(container.querySelector('audio[controls], video')).toBeNull();
    act(() => app.set({ transfers: [transfer(id)] }));
    expect(within(player()).getByRole('progressbar').getAttribute('aria-valuenow')).toBe('40');
  });

  it('cancels with ✕ on the ring while it uploads', async () => {
    send();
    const id = outgoing.get().jobs[0]!.id;
    await waitFor(() => expect(outgoing.get().jobs[0]!.transferId).toBe('t1'));
    act(() => app.set({ transfers: [transfer(id)] }));
    wrap(<OutgoingMediaBubbles roomId="12" messages={[]} />);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel sending' }));
    await waitFor(() => expect(net.call).toHaveBeenCalledWith('transfers:cancel', { id: 't1' }));
  });

  it('keeps a failed one in the conversation with a red ring and Retry', async () => {
    send();
    const id = outgoing.get().jobs[0]!.id;
    await waitFor(() => expect(outgoing.get().jobs[0]!.transferId).toBe('t1'));
    act(() => app.set({ transfers: [transfer(id, { state: 'failed', error: 'Connection lost.' })] }));
    const { container } = wrap(<OutgoingMediaBubbles roomId="12" messages={[]} />);
    expect(screen.queryByRole('button', { name: 'Cancel sending' })).toBeNull();
    expect(screen.getByText('Not sent')).toBeTruthy();
    expect(container.querySelector('circle.stroke-danger')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Retry sending the voice message' }));
    await waitFor(() => expect(net.call).toHaveBeenCalledWith('transfers:retry', { id: 't1' }));
    expect(player()).toBeTruthy();
  });

  it('shows the sent message with what was measured here at once, before the server has any of it', () => {
    send();
    const id = outgoing.get().jobs[0]!.id;
    list([fromChatMessage(voiceMessage({ id: 51, sender_id: 3, client_message_id: id, file: voiceFile({ duration_ms: null, waveform: null }) }), '3')]);
    expect(clock()).toBe('0:02');
    expect(player().querySelector('[data-bar="100"]')).toBeTruthy();
  });
});

describe('recording', () => {
  class FakeRecorder {
    static isTypeSupported = (m: string) => m === 'audio/webm;codecs=opus' || m === 'audio/mp4';
    state: 'inactive' | 'recording' | 'paused' = 'inactive';
    mimeType: string;
    ondataavailable: ((e: { data: Blob }) => void) | null = null;
    onstop: (() => void) | null = null;
    constructor(_s: unknown, o?: { mimeType?: string }) {
      this.mimeType = o?.mimeType ?? '';
      recorders.push(this);
    }
    start() { this.state = 'recording'; }
    pause() { this.state = 'paused'; }
    resume() { this.state = 'recording'; }
    requestData() { this.ondataavailable?.({ data: new Blob(['so far']) }); }
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
    createAnalyser = () => ({ fftSize: 0, getByteTimeDomainData: (b: Uint8Array) => b.fill(192) });
    createMediaStreamSource = () => ({ connect: () => undefined });
  }
  const start = async (onDone = vi.fn(), onCancel = vi.fn()) => {
    recorders.length = 0;
    net.call.mockImplementation(async (channel: string) => (channel === 'media:access' ? { granted: true } : null));
    vi.stubGlobal('MediaRecorder', FakeRecorder);
    vi.stubGlobal('AudioContext', FakeAudio);
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: async () => ({ getTracks: () => [] }) } });
    render(<VoiceRecorder onDone={onDone} onCancel={onCancel} />);
    await screen.findByRole('button', { name: 'Pause recording' });
    return { onDone, onCancel };
  };

  it('records Opus, pauses and goes on, and sends its length (pauses left out) and its loudness', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { onDone } = await start();
    expect(recorders[0]!.mimeType).toBe('audio/webm;codecs=opus');
    await act(async () => void vi.advanceTimersByTime(1500));
    fireEvent.click(screen.getByRole('button', { name: 'Pause recording' }));
    expect(recorders[0]!.state).toBe('paused');
    await act(async () => void vi.advanceTimersByTime(5000));
    // Listening to it so far, then going on.
    fireEvent.click(screen.getByRole('button', { name: 'Listen to the recording' }));
    expect(screen.getByRole('button', { name: 'Stop listening' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Resume recording' }));
    expect(recorders[0]!.state).toBe('recording');
    await act(async () => void vi.advanceTimersByTime(1000));
    fireEvent.click(screen.getByRole('button', { name: 'Send the voice message' }));
    expect(onDone).toHaveBeenCalledTimes(1);
    const [sent, ms, waveform] = onDone.mock.calls[0]! as [Blob, number, number[]];
    expect(sent.type).toBe('audio/webm;codecs=opus');
    expect(ms).toBeGreaterThanOrEqual(2400);
    expect(ms).toBeLessThan(4000);
    expect(waveform).toHaveLength(64);
    expect(Math.max(...waveform)).toBe(100);
  });

  it('throws it away with ✕', async () => {
    const { onDone, onCancel } = await start();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel the voice message' }));
    expect(onCancel).toHaveBeenCalled();
    expect(onDone).not.toHaveBeenCalled();
  });
});

describe('tooltips never stay on screen', () => {
  let unwire: () => void = () => undefined;
  const setUp = () => {
    vi.useFakeTimers();
    unwire = wireTooltips();
    const { container, unmount } = render(
      <div>
        <button type="button" aria-label="Emoji" title="Emoji">
          ☺
        </button>
        <span title="Only a title" />
        <div data-testid="scroller" />
      </div>,
    );
    return { button: container.querySelector('button')!, unmount };
  };
  const shown = () => document.querySelector('[role="tooltip"]');
  afterEach(() => unwire());

  it('shows the title as the app’s own tooltip, and the system’s cannot show as well', () => {
    const { button } = setUp();
    fireEvent.mouseOver(button, { clientX: 20, clientY: 30 });
    expect(button.hasAttribute('title')).toBe(false);
    act(() => void vi.advanceTimersByTime(TOOLTIP_DELAY));
    expect(shown()!.textContent).toBe('Emoji');
    fireEvent.mouseOut(button, { relatedTarget: document.body });
    expect(shown()).toBeNull();
    expect(button.getAttribute('title')).toBe('Emoji');
  });

  it('goes on a scroll, a click or a key, and stays gone while the pointer is still there', () => {
    const { button } = setUp();
    for (const go of [() => fireEvent.scroll(window), () => fireEvent.scroll(screen.getByTestId('scroller')), () => fireEvent.click(button), () => fireEvent.keyDown(document.body, { key: 'a' }), () => fireEvent.wheel(document.body)]) {
      fireEvent.mouseOver(button);
      act(() => void vi.advanceTimersByTime(TOOLTIP_DELAY));
      expect(shown()).toBeTruthy();
      go();
      expect(shown()).toBeNull();
      act(() => void vi.advanceTimersByTime(TOOLTIP_DELAY * 2));
      expect(shown()).toBeNull();
      fireEvent.mouseOut(button, { relatedTarget: document.body });
    }
  });

  it('goes when the element leaves the page under the pointer', async () => {
    const { button, unmount } = setUp();
    fireEvent.mouseOver(button);
    act(() => void vi.advanceTimersByTime(TOOLTIP_DELAY));
    expect(shown()).toBeTruthy();
    unmount();
    await act(async () => undefined);
    expect(shown()).toBeNull();
  });

  it('leaves text being edited exactly as it is', () => {
    vi.useFakeTimers();
    unwire = wireTooltips();
    const { container } = render(
      <div contentEditable suppressContentEditableWarning>
        <a href="https://example.test" title="A link in a mail">
          link
        </a>
      </div>,
    );
    const a = container.querySelector('a')!;
    fireEvent.mouseOver(a);
    act(() => void vi.advanceTimersByTime(TOOLTIP_DELAY));
    expect(a.getAttribute('title')).toBe('A link in a mail');
    expect(shown()).toBeNull();
  });

  it('goes when the window loses focus, and keeps an element named only by its title named', () => {
    setUp();
    const only = document.querySelector('span[title]')!;
    fireEvent.mouseOver(only);
    expect(only.getAttribute('aria-label')).toBe('Only a title');
    act(() => void vi.advanceTimersByTime(TOOLTIP_DELAY));
    expect(shown()).toBeTruthy();
    fireEvent.blur(window);
    expect(shown()).toBeNull();
    expect(only.getAttribute('title')).toBe('Only a title');
    expect(only.hasAttribute('aria-label')).toBe(false);
  });
});
