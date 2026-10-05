// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

vi.mock('livekit-client', () => ({ Track: { Source: { Camera: 'camera', ScreenShare: 'screen_share', Microphone: 'microphone', ScreenShareAudio: 'screen_share_audio' } } }));
const bridge = vi.hoisted(() => ({ call: vi.fn() }));
vi.mock('../../../src/core/bridge', () => ({ call: bridge.call, on: vi.fn(() => () => undefined), errorMessage: (e: unknown) => String(e) }));
vi.mock('../../../src/core/toasts', () => ({ toast: vi.fn() }));
const prefs = vi.hoisted(() => ({ update: vi.fn(async () => undefined) }));
vi.mock('../../../src/core/app-state', async () => {
  const { createStore } = await import('../../../src/core/store');
  return {
    app: createStore({ prefs: { meetRecording: { method: 'cloud', quality: '720p', layout: 'grid', folder: 'Meeting Recordings', localFolder: '/home/me/Videos/WorkSuite Recordings', keepLocal: '7' } } }),
    updatePrefs: prefs.update,
  };
});

import { fit, gridTiles, recordingMime } from '../../../src/modules/meet/recorder';
import { RecordingSettings } from '../../../src/modules/meet/RecordingSettings';

afterEach(cleanup);

describe('the picture a local recording draws', () => {
  it('lays people out in a grid, the last row centred', () => {
    expect(gridTiles(0, 1280, 720)).toEqual([]);
    const one = gridTiles(1, 1280, 720, 0);
    expect(one).toEqual([{ x: 0, y: 0, w: 1280, h: 720 }]);
    const three = gridTiles(3, 1280, 720, 0);
    expect(three).toHaveLength(3);
    expect(three[2]!.x).toBe(320); // alone on the second row, in the middle
    expect(gridTiles(5, 1280, 720).every((t) => t.w > 0 && t.h > 0)).toBe(true);
  });

  it('fits a shared screen inside the picture, and fills a tile with a camera', () => {
    expect(fit(1920, 1080, { x: 0, y: 0, w: 1280, h: 720 }, 'contain')).toEqual({ x: 0, y: 0, w: 1280, h: 720 });
    const tall = fit(1000, 2000, { x: 0, y: 0, w: 1280, h: 720 }, 'contain');
    expect(tall.h).toBe(720);
    expect(tall.x).toBe(460);
    expect(fit(640, 480, { x: 0, y: 0, w: 160, h: 90 }, 'cover').w).toBe(160);
  });

  it('records in VP9, then VP8, then H.264, else not at all (#240)', () => {
    expect(recordingMime(() => true)).toBe('video/webm;codecs=vp9,opus');
    expect(recordingMime((t) => t !== 'video/webm;codecs=vp9,opus')).toBe('video/webm;codecs=vp8,opus');
    expect(recordingMime((t) => t.includes('h264') || t.startsWith('video/mp4'))).toBe('video/webm;codecs=h264,opus');
    expect(recordingMime((t) => t.startsWith('video/mp4'))).toBe('video/mp4;codecs=avc1.42E01E,mp4a.40.2');
    expect(recordingMime(() => false)).toBeNull();
  });
});

describe('Settings › Meet › Recording', () => {
  it('chooses where meetings are recorded, and shows the local options only for this computer', () => {
    render(<RecordingSettings />);
    expect(screen.getByRole('radio', { name: /On the WorkSuite server/ }).getAttribute('aria-checked')).toBe('true');
    expect(screen.queryByText(/Saved on this computer in/)).toBeNull();
    fireEvent.click(screen.getByRole('radio', { name: /On this computer/ }));
    expect(prefs.update).toHaveBeenCalledWith({ meetRecording: expect.objectContaining({ method: 'local', folder: 'Meeting Recordings' }) });
  });

  it('keeps the Drive folder to one level', () => {
    render(<RecordingSettings />);
    const box = screen.getByRole('textbox', { name: /Drive folder/ });
    fireEvent.change(box, { target: { value: 'Board/2026' } });
    fireEvent.blur(box);
    expect(prefs.update).toHaveBeenLastCalledWith({ meetRecording: expect.objectContaining({ folder: 'Board2026' }) });
  });
});
