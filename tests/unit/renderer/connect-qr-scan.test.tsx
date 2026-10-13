// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Screen 6's QR dialog (WP4): the camera (getUserMedia) read with jsQR, an image of the QR, or a pasted link — only a
 * worksuite://setup link is taken, and the camera stops when the dialog closes.
 */
const qr = vi.hoisted(() => ({ result: null as { data: string } | null }));
vi.mock('jsqr', () => ({ default: vi.fn(() => qr.result) }));

const { QrScan, setupLinkIn, decodePixels } = await import('../../../src/app/connect/QrScan');

const LINK = 'worksuite://setup?d=eyJ2IjoyfQ&s=c2ln';
let stop: ReturnType<typeof vi.fn>;

beforeEach(() => {
  qr.result = null;
  stop = vi.fn();
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: vi.fn(async () => ({ getTracks: () => [{ stop }] })) } });
  Object.defineProperty(HTMLMediaElement.prototype, 'play', { configurable: true, value: vi.fn(() => Promise.resolve()) });
  // jsdom draws nothing: a canvas whose context hands back blank pixels.
  HTMLCanvasElement.prototype.getContext = vi.fn(() => ({ drawImage: vi.fn(), getImageData: (_x: number, _y: number, w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h }) })) as never;
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('QR helpers', () => {
  it('takes only setup links', () => {
    expect(setupLinkIn(` ${LINK} `)).toBe(LINK);
    expect(setupLinkIn('WORKSUITE://SETUP?d=1')).toBe('WORKSUITE://SETUP?d=1');
    expect(setupLinkIn('https://example.com')).toBeNull();
    expect(setupLinkIn(null)).toBeNull();
  });

  it('decodes pixels with jsQR', () => {
    qr.result = { data: LINK };
    expect(decodePixels(new Uint8ClampedArray(16), 2, 2)).toBe(LINK);
    qr.result = null;
    expect(decodePixels(new Uint8ClampedArray(16), 2, 2)).toBeNull();
  });
});

describe('QrScan', () => {
  it('opens the camera, and stops it on Close', async () => {
    const onClose = vi.fn();
    render(<QrScan onLink={vi.fn()} onClose={onClose} />);
    expect(screen.getByRole('dialog', { name: 'Scan setup QR' })).toBeTruthy();
    await waitFor(() => expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalled());
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalled();
    cleanup();
    expect(stop).toHaveBeenCalled();
  });

  it('closes on Escape', () => {
    const onClose = vi.fn();
    render(<QrScan onLink={vi.fn()} onClose={onClose} />);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });

  it('says so when there is no camera, and still offers an image or a link', async () => {
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: vi.fn(() => Promise.reject(new Error('denied'))) } });
    render(<QrScan onLink={vi.fn()} onClose={vi.fn()} />);
    await waitFor(() => expect(screen.getByText(/No camera available/)).toBeTruthy());
    expect(screen.getByRole('button', { name: 'choose an image' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'paste a setup link' })).toBeTruthy();
  });

  it('reads the camera until it sees a setup link', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const onLink = vi.fn();
    render(<QrScan onLink={onLink} onClose={vi.fn()} />);
    await waitFor(() => expect(screen.getByLabelText('Camera').className).not.toContain('hidden'));
    const video = screen.getByLabelText('Camera') as HTMLVideoElement;
    Object.defineProperty(video, 'readyState', { configurable: true, value: 4 });
    Object.defineProperty(video, 'videoWidth', { configurable: true, value: 640 });
    Object.defineProperty(video, 'videoHeight', { configurable: true, value: 480 });
    qr.result = { data: 'https://not-a-setup.example' };
    await act(async () => {
      vi.advanceTimersByTime(300);
    });
    expect(onLink).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toMatch(/isn’t a WorkSuite setup code/);
    qr.result = { data: LINK };
    await act(async () => {
      vi.advanceTimersByTime(300);
    });
    expect(onLink).toHaveBeenCalledWith(LINK);
    expect(onLink).toHaveBeenCalledTimes(1);
  });

  it('reads a chosen image', async () => {
    const onLink = vi.fn();
    URL.createObjectURL = vi.fn(() => 'blob:qr');
    URL.revokeObjectURL = vi.fn();
    Object.defineProperty(HTMLImageElement.prototype, 'decode', { configurable: true, value: () => Promise.resolve() });
    Object.defineProperty(HTMLImageElement.prototype, 'naturalWidth', { configurable: true, get: () => 200 });
    Object.defineProperty(HTMLImageElement.prototype, 'naturalHeight', { configurable: true, get: () => 200 });
    qr.result = { data: LINK };
    render(<QrScan onLink={onLink} onClose={vi.fn()} />);
    const input = screen.getByTestId('qr-image');
    await act(async () => {
      fireEvent.change(input, { target: { files: [new File(['x'], 'qr.png', { type: 'image/png' })] } });
    });
    await waitFor(() => expect(onLink).toHaveBeenCalledWith(LINK));
  });

  it('says when an image holds no QR code', async () => {
    URL.createObjectURL = vi.fn(() => 'blob:qr');
    URL.revokeObjectURL = vi.fn();
    Object.defineProperty(HTMLImageElement.prototype, 'decode', { configurable: true, value: () => Promise.resolve() });
    render(<QrScan onLink={vi.fn()} onClose={vi.fn()} />);
    await act(async () => {
      fireEvent.change(screen.getByTestId('qr-image'), { target: { files: [new File(['x'], 'photo.png', { type: 'image/png' })] } });
    });
    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/No QR code found/));
  });

  it('takes a pasted link, and refuses anything else', () => {
    const onLink = vi.fn();
    render(<QrScan onLink={onLink} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'paste a setup link' }));
    fireEvent.change(screen.getByLabelText('Setup link'), { target: { value: 'https://evil.example/setup' } });
    fireEvent.click(screen.getByRole('button', { name: 'Use this link' }));
    expect(onLink).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Setup link'), { target: { value: LINK } });
    fireEvent.click(screen.getByRole('button', { name: 'Use this link' }));
    expect(onLink).toHaveBeenCalledWith(LINK);
  });
});
