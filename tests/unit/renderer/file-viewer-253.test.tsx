// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { FileViewer } from '../../../src/components/FileViewer';

/**
 * worksuite-desktop#253: a file the viewer cannot read says so — "Couldn't open this file" with Retry and Open in
 * its app — and is logged for Diagnostics by where it was read from, never by its name. It is never "Opening the
 * file…" for ever.
 */
const NAME = 'FORM TECH-10 — Bid Security (Bank Guarantee).pdf';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('the file viewer when a file cannot be opened', () => {
  it('offers Retry and Open in its app, logs the path only, and Retry reads it again', async () => {
    const fetch = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    });
    vi.stubGlobal('fetch', fetch);
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const onOpen = vi.fn();
    render(<FileViewer path="/api/tenders/checklist/10/download" name={NAME} onOpen={onOpen} onSave={() => undefined} />);

    expect(await screen.findByText("Couldn't open this file")).toBeTruthy();
    expect(screen.getByText('The file could not be read.')).toBeTruthy();
    expect(logged).toHaveBeenCalled();
    expect(JSON.stringify(logged.mock.calls)).not.toContain('Bid Security');
    expect(JSON.stringify(logged.mock.calls)).toContain('/api/tenders/checklist/10/download');

    fireEvent.click(screen.getByText('Open in its app'));
    expect(onOpen).toHaveBeenCalledOnce();

    fireEvent.click(screen.getByText('Retry'));
    expect(await screen.findByText("Couldn't open this file")).toBeTruthy();
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("shows the server's own message for an error answer", async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ status: 'error', message: "Couldn't open this. Try again." }), { status: 500 })));
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    render(<FileViewer path="/api/files/1/download" name={NAME} />);
    expect(await screen.findByText("Couldn't open this. Try again.")).toBeTruthy();
    expect(screen.getByText('Retry')).toBeTruthy();
  });

  it('gives up waiting after a while instead of "Opening the file…" for ever', async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      'fetch',
      vi.fn((_url: string, init: RequestInit) => new Promise((_res, rej) => init.signal!.addEventListener('abort', () => rej(init.signal!.reason)))),
    );
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    render(<FileViewer path="/api/files/1/download" name={NAME} />);
    expect(screen.getByText('Opening the file…')).toBeTruthy();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(61_000);
    });
    expect(screen.getByText('The file took too long to arrive.')).toBeTruthy();
  });
});
