// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createRef } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { VideoStream } from '../../../src/modules/files/VideoStream';
const mocks = vi.hoisted(() => ({
  players: [] as Array<{ currentLevel: number; destroy: ReturnType<typeof vi.fn>; stopLoad: ReturnType<typeof vi.fn>; events: Record<string, (...args: unknown[]) => void> }>,
}));
vi.mock('hls.js', () => ({
  default: class {
    static Events = { MANIFEST_PARSED: 'manifest', ERROR: 'error' };
    static isSupported() {
      return true;
    }
    levels = [{ height: 360 }, { height: 720 }];
    currentLevel = -1;
    events: Record<string, (...args: unknown[]) => void> = {};
    destroy = vi.fn();
    stopLoad = vi.fn();
    constructor(public config: Record<string, number>) {
      mocks.players.push(this);
    }
    on(event: string, cb: (...args: unknown[]) => void) {
      this.events[event] = cb;
    }
    attachMedia() {}
    loadSource() {
      this.events.manifest?.();
    }
  },
}));
beforeEach(() => {
  mocks.players.length = 0;
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {});
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
it('offers automatic/manual HLS quality and releases the player on close', async () => {
  const ref = createRef<HTMLVideoElement>();
  const { unmount } = render(<VideoStream mediaRef={ref} source="https://example.test/media/original" hlsUrl="https://example.test/media/hls/master.m3u8" />);
  const quality = await screen.findByRole('combobox', { name: 'Video quality' });
  expect((quality as HTMLSelectElement).value).toBe('-1');
  fireEvent.change(quality, { target: { value: '1' } });
  expect(mocks.players[0]!.currentLevel).toBe(1);
  fireEvent.change(quality, { target: { value: '-1' } });
  expect(mocks.players[0]!.currentLevel).toBe(-1);
  const video = ref.current!;
  unmount();
  expect(mocks.players[0]!.destroy).toHaveBeenCalledOnce();
  expect(video.getAttribute('src')).toBeNull();
  expect(HTMLMediaElement.prototype.pause).toHaveBeenCalled();
});
it('stops failed buffering and gives a working streaming retry', async () => {
  render(<VideoStream mediaRef={createRef<HTMLVideoElement>()} source={null} hlsUrl="https://example.test/media/hls/master.m3u8" />);
  await screen.findByRole('combobox', { name: 'Video quality' });
  act(() => mocks.players[0]!.events.error!('error', { fatal: true }));
  expect(mocks.players[0]!.stopLoad).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByRole('button', { name: 'Retry streaming' }));
  await waitFor(() => expect(mocks.players.length).toBe(2));
  expect(mocks.players[0]!.destroy).toHaveBeenCalledOnce();
  expect(screen.queryByRole('alert')).toBeNull();
});
it('uses the progressive source directly with metadata preload', () => {
  const ref = createRef<HTMLVideoElement>();
  render(<VideoStream mediaRef={ref} source="https://example.test/media/original" hlsUrl={null} />);
  expect(ref.current?.getAttribute('src')).toBe('https://example.test/media/original');
  expect(ref.current?.preload).toBe('metadata');
  expect(mocks.players).toHaveLength(0);
});
