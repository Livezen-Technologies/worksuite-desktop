// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/core/bridge', () => ({ call: vi.fn(), on: () => () => undefined, hasDesktop: () => true, errorMessage: (e: unknown) => String(e), isMac: true }));
vi.mock('../../../src/core/toasts', () => ({ toast: vi.fn() }));

import { call } from '../../../src/core/bridge';
import { toast } from '../../../src/core/toasts';
import { LanguagePacks } from '../../../src/modules/ai/LanguagePacks';

/**
 * Settings › Local AI › Language packs (board D10). Two things matter: a pack
 * can be fetched before it is needed, which is the whole point of the screen
 * for anybody who will be offline; and the screen says what this version
 * actually has, rather than drawing the design's ONNX runtime and Performance
 * choice, which nothing in the app would honour.
 */

const status = (installed: string[]) => ({
  languages: [
    { id: 'eng', label: 'English', bytes: 2_952_873, installed: installed.includes('eng') },
    { id: 'sin', label: 'Sinhala', bytes: 1_138_317, installed: installed.includes('sin') },
    { id: 'tam', label: 'Tamil', bytes: 1_446_167, installed: installed.includes('tam') },
  ],
});

function mount(installed: string[]) {
  let now = installed;
  vi.mocked(call).mockImplementation(((channel: string, input?: { language?: string }) => {
    if (channel === 'ai:ocrStatus') return Promise.resolve(status(now));
    if (channel === 'ai:ocrInstall') {
      now = [...now, input!.language!];
      return Promise.resolve(undefined);
    }
    return Promise.resolve(null);
  }) as never);
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <LanguagePacks />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.mocked(call).mockReset();
  vi.mocked(toast).mockReset();
});

describe('Language packs', () => {
  it('shows what is on this computer and downloads a missing pack on purpose', async () => {
    mount(['eng']);

    expect(await screen.findByText('Sinhala')).toBeTruthy();
    // English is there; Sinhala and Tamil are not, so only they can be fetched.
    expect(screen.getAllByText('Installed')).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: 'Download' })).toHaveLength(2);
    expect(screen.getByText(/Reads Sinhala in pictures and screenshots · 1\.1 MB/)).toBeTruthy();

    const sinhala = screen.getByText('Sinhala').closest('div')!;
    await act(async () => fireEvent.click(sinhala.querySelector('button')!));

    expect(call).toHaveBeenCalledWith('ai:ocrInstall', { language: 'sin' });
    expect(toast).toHaveBeenCalledWith('success', 'Sinhala can now be read without a connection.');
    // The list catches up: English and Sinhala are both there now, Tamil alone can still be fetched.
    expect(await screen.findByText(/Installed: 3\.9 MB/)).toBeTruthy();
    expect(screen.getAllByText('Installed')).toHaveLength(2);
    expect(screen.getAllByRole('button', { name: 'Download' })).toHaveLength(1);
  });

  it('says plainly which packs this version does not have, instead of drawing them', async () => {
    mount([]);
    await screen.findByText('English');

    expect(screen.getByText(/Writing help on this computer .* are not in it yet/)).toBeTruthy();
    // The design's runtime panel and Performance choice would both be claims nothing could honour.
    expect(screen.queryByText(/ONNX/i)).toBeNull();
    expect(screen.queryByText(/Battery saver|High quality/)).toBeNull();
    expect(screen.queryAllByText('Installed')).toHaveLength(0);
    expect(screen.queryByText(/Installed:/)).toBeNull();
  });

  it('says so when the packs cannot be read, rather than showing an empty list', async () => {
    vi.mocked(call).mockRejectedValue(new Error('no desktop'));
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <LanguagePacks />
      </QueryClientProvider>,
    );

    expect(await screen.findByText('The language packs on this computer could not be read.')).toBeTruthy();
  });
});
