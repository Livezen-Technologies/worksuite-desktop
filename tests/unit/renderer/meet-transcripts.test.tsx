// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('livekit-client', () => ({ Track: { Source: { Microphone: 'microphone' } } }));
const bridge = vi.hoisted(() => ({ call: vi.fn() }));
vi.mock('../../../src/core/bridge', () => ({ call: bridge.call, on: vi.fn(() => () => undefined), errorMessage: (e: unknown) => (e instanceof Error ? e.message : String(e)) }));
vi.mock('../../../src/core/toasts', () => ({ toast: vi.fn() }));
const prefs = vi.hoisted(() => ({ fallback: true }));
vi.mock('../../../src/core/app-state', () => ({ app: { get: () => ({ prefs: { ai: { onlineFallback: prefs.fallback } } }) } }));
const api = vi.hoisted(() => ({ apiGet: vi.fn(), apiPost: vi.fn(), apiPut: vi.fn(), apiDelete: vi.fn() }));
vi.mock('../../../src/core/api', () => {
  class ApiError extends Error {
    constructor(
      readonly status: number,
      message: string,
      readonly code: string | null = null,
      readonly data: unknown = null,
    ) {
      super(message);
    }
  }
  return { ApiError, ...api, request: vi.fn(), apiUrl: (p: string) => p };
});

import { ApiError } from '../../../src/core/api';
import { RATE, UtteranceSplitter, downsample, wav } from '../../../src/modules/meet/transcribe/audio';
import { speakerName } from '../../../src/modules/meet/transcribe/live';
import { EmailTranscriptDialog, TranscriptView } from '../../../src/modules/meetings/transcripts/TranscriptsTab';
import { transcriptText, type Transcript } from '../../../src/modules/meetings/transcripts/api';
import type { Participant } from 'livekit-client';

afterEach(cleanup);
beforeEach(() => {
  for (const f of Object.values(api)) f.mockReset();
  bridge.call.mockReset();
  prefs.fallback = true;
});

const wrap = (ui: React.ReactNode) => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>);

describe('audio for transcription', () => {
  it('makes 16 kHz mono WAV', () => {
    expect(downsample(new Float32Array([1, 1, 1, 0, 0, 0]), 48_000, 16_000)).toEqual(new Float32Array([1, 0]));
    const bytes = wav(new Float32Array([0, 1, -1]));
    expect(bytes.length).toBe(44 + 6);
    expect(String.fromCharCode(...bytes.slice(0, 4))).toBe('RIFF');
    const v = new DataView(bytes.buffer);
    expect(v.getUint32(24, true)).toBe(RATE);
    expect(v.getInt16(46, true)).toBe(32767);
    expect(v.getInt16(48, true)).toBe(-32768);
  });

  it('cuts speech where people pause, and never sends silence', () => {
    const got: Array<{ startMs: number; ms: number }> = [];
    const split = new UtteranceSplitter((u) => got.push({ startMs: u.startMs, ms: (u.samples.length / RATE) * 1000 }), { pauseMs: 500 });
    const frame = (loud: boolean) => new Float32Array(1600).fill(loud ? 0.2 : 0); // 100 ms
    for (let i = 0; i < 10; i++) split.push(frame(false)); // 1 s of silence
    for (let i = 0; i < 10; i++) split.push(frame(true)); // 1 s of speech
    for (let i = 0; i < 6; i++) split.push(frame(false)); // a pause
    expect(got).toHaveLength(1);
    expect(got[0]!.startMs).toBe(1000);
    for (let i = 0; i < 10; i++) split.push(frame(false));
    split.flush();
    expect(got).toHaveLength(1);
  });

  it('cuts a long talk so it arrives as it goes', () => {
    const got: number[] = [];
    const split = new UtteranceSplitter((u) => got.push(u.samples.length), { maxMs: 2000 });
    for (let i = 0; i < 50; i++) split.push(new Float32Array(1600).fill(0.3));
    expect(got.length).toBeGreaterThanOrEqual(2);
  });

  it('names a speaker only by the name the meeting has for them', () => {
    expect(speakerName({ name: 'Kumari Silva' } as Participant)).toBe('Kumari Silva');
    expect(speakerName({ name: '' } as Participant)).toBe('');
    expect(speakerName({ name: 'Guest' } as Participant)).toBe('');
  });
});

describe('who transcribes', () => {
  it('uses this computer when it has a speech model, and the server only when allowed', async () => {
    const { transcribe } = await import('../../../src/modules/meet/transcribe/engine');
    bridge.call.mockImplementation(async (ch: string) => (ch === 'stt:status' ? { local: { ready: true, model: { name: 'm', size: 1 }, why: null } } : { segments: [{ start_ms: 0, end_ms: 900, text: 'hello', uncertain: false }] }));
    expect(await transcribe(new Uint8Array(50), 'en')).toEqual({ engine: 'local', segments: [{ start_ms: 0, end_ms: 900, text: 'hello', uncertain: false }] });
    expect(api.apiPost).not.toHaveBeenCalled();

    bridge.call.mockImplementation(async () => ({ local: { ready: false, model: null, why: 'No speech model.' } }));
    api.apiGet.mockResolvedValue({ online: true, why: null });
    api.apiPost.mockResolvedValue({ segments: [{ start_ms: 0, end_ms: 500, text: 'ආයුබෝවන්', uncertain: true }] });
    expect((await transcribe(new Uint8Array(50), 'si')).engine).toBe('online');
    expect(api.apiPost).toHaveBeenCalledWith('/api/ai/speech/transcribe', expect.any(FormData));

    prefs.fallback = false;
    await expect(transcribe(new Uint8Array(50), 'si')).rejects.toThrow(/Online fallback is off/);
  });
});

const T: Transcript = {
  id: 7, meeting_id: 9, recording_id: null, source: 'live', language: 'en', status: 'ready', engine: 'local', progress: 100, version: 3, error: null, segments_count: 2,
  auto_email: { enabled: false, participant_ids: [], format: 'link' }, auto_emailed_at: null, created_by: 5, started_at: '2026-10-01T09:00:00Z', ended_at: null, edited_at: null,
  can: { correct: true, email: true }, formats: ['link', 'pdf', 'txt'],
  segments: [
    { start_ms: 0, end_ms: 2000, speaker: 'Asha', text: 'We agree the budget.', uncertain: false },
    { start_ms: 65_000, end_ms: 66_000, speaker: '', text: 'maybe next week', uncertain: true },
  ],
};

describe('reading and correcting a transcript', () => {
  it('shows when, who and what, and marks what nobody could tell or hear', async () => {
    api.apiGet.mockImplementation(async (path: string) => (path.endsWith('/deliveries') ? { deliveries: [] } : T));
    wrap(<TranscriptView id={7} title="Budget" />);
    expect(await screen.findByText('We agree the budget.')).toBeTruthy();
    expect(screen.getByText('Unidentified speaker')).toBeTruthy();
    expect(screen.getByText('(unclear)')).toBeTruthy();
    expect(screen.getByText('00:01:05')).toBeTruthy();
    expect(transcriptText(T.segments!)).toBe('[00:00:00] Asha: We agree the budget.\n[00:01:05] Unidentified speaker: maybe next week (unclear)');
  });

  it('saves corrections on the version read, and says so when somebody else got there first', async () => {
    api.apiGet.mockImplementation(async (path: string) => (path.endsWith('/deliveries') ? { deliveries: [] } : T));
    api.apiPut.mockRejectedValueOnce(new ApiError(409, 'conflict', null)).mockResolvedValueOnce({ ...T, version: 4 });
    wrap(<TranscriptView id={7} title="Budget" />);
    fireEvent.click(await screen.findByRole('button', { name: /Correct/ }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Speaker at 00:01:05' }), { target: { value: 'Ben' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save corrections' }));
    await waitFor(() => expect(api.apiPut).toHaveBeenCalledWith('/api/meetings/transcripts/7', { segments: expect.arrayContaining([expect.objectContaining({ speaker: 'Ben', text: 'maybe next week' })]), base_version: 3 }));
    // Still editing: nothing of theirs or ours was lost.
    expect(screen.getByRole('button', { name: 'Save corrections' })).toBeTruthy();
  });
});

describe('emailing a transcript', () => {
  it('offers only the people who may see it, previews, and sends only after confirmation', async () => {
    api.apiGet.mockResolvedValue({
      recipients: [
        { participant_id: 1, name: 'Asha', email: 'asha@x.lk', allowed: true, why: null },
        { participant_id: 2, name: 'Ben', email: 'ben@x.lk', allowed: true, why: null },
        { participant_id: 3, name: 'Guest', email: null, allowed: false, why: 'No email address' },
      ],
      formats: ['link', 'pdf', 'txt'],
    });
    api.apiPost.mockResolvedValue({ deliveries: [{ id: 1, name: 'Ben', email: 'ben@x.lk', format: 'link', version: 3, status: 'sent', error: null, automatic: false, sent_at: null }], skipped: [] });
    wrap(<EmailTranscriptDialog t={T} title="Budget" onClose={vi.fn()} />);
    expect(await screen.findByText('No email address')).toBeTruthy();
    const ben = screen.getByText('Ben').closest('label')!;
    fireEvent.click(within(ben).getByRole('checkbox'));
    fireEvent.change(screen.getByRole('textbox', { name: /Message/ }), { target: { value: 'As promised.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Review and send' }));
    expect(screen.getByText(/Nothing has been sent yet/)).toBeTruthy();
    expect(screen.getByText('As promised.')).toBeTruthy();
    expect(api.apiPost).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Send to 1 person' }));
    await waitFor(() => expect(api.apiPost).toHaveBeenCalledWith('/api/meetings/transcripts/7/email', { participant_ids: [2], subject: 'Transcript: Budget', message: 'As promised.', format: 'link' }));
    expect(await screen.findByText('Sent')).toBeTruthy();
  });
});
