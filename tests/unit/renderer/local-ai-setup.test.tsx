// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LocalModelView } from '@shared/local-ai';

/**
 * Setting up a model on this computer from the assistant (worksuite-desktop#55): what it is, what it needs and its
 * licence, one button to download and set it up, its progress, the readiness check, and never "ready" before it
 * has answered.
 */
let models: LocalModelView[] = [];
const call = vi.fn(async (channel: string, _input?: unknown) => (channel === 'ai:localModels' ? models : null));
vi.mock('../../../src/core/bridge', () => ({ call: (c: string, i?: unknown) => call(c, i), on: () => () => undefined, hasDesktop: () => true, errorMessage: (e: unknown) => String(e), isMac: false }));
vi.mock('../../../src/core/toasts', () => ({ toast: vi.fn() }));

const { localReady, suggestedModel } = await import('../../../src/core/local-ai');
const { LocalSetup } = await import('../../../src/modules/ai/LocalSetup');

const GB = 1024 ** 3;
function view(over: Partial<LocalModelView> = {}, model: Partial<LocalModelView['model']> = {}): LocalModelView {
  return {
    model: {
      id: 'gemma3-4b', version: 'b1c2d3e4f5a6', name: 'Gemma 3 4B', family: 'gemma3', purpose: 'chat', url: 'https://cdn.example.test/gemma-3-4b-it-Q4_K_M.gguf', sha256: 'a'.repeat(64), bytes: Math.round(2.5 * GB),
      quantization: 'Q4_K_M', contextLength: 131072, minMemoryBytes: 4 * GB, tiers: ['basic', 'good', 'strong'], recommendedFor: ['basic', 'good'],
      license: { id: 'gemma', name: 'Gemma Terms of Use', url: 'https://ai.google.dev/gemma/terms' }, notice: 'Gemma is provided under and subject to the Gemma Terms of Use found at ai.google.dev/gemma/terms.', languages: [], toolCalling: false, ...model,
    },
    state: 'available', received: 0, error: null, fits: true, recommended: true, isDefault: false, readiness: 'untested', readinessError: null, ...over,
  };
}

function mount() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><LocalSetup /></QueryClientProvider>);
}

beforeEach(() => {
  localStorage.clear();
  call.mockClear();
});
afterEach(cleanup);

describe('choosing the model', () => {
  it('is ready only once installed, chosen, and not failing or in its check', () => {
    expect(localReady([view({ state: 'installed', isDefault: true, readiness: 'ready' })])).not.toBeNull();
    expect(localReady([view({ state: 'installed', isDefault: true, readiness: 'untested' })])).not.toBeNull();
    expect(localReady([view({ state: 'installed', isDefault: true, readiness: 'testing' })])).toBeNull();
    expect(localReady([view({ state: 'installed', isDefault: true, readiness: 'failed' })])).toBeNull();
    expect(localReady([view({ state: 'installed', isDefault: false, readiness: 'ready' })])).toBeNull();
  });

  it('offers the recommended model, else Gemma 3 4B, else the smallest that fits, and nothing once one is installed', () => {
    const small = view({ recommended: false }, { id: 'tiny', name: 'Tiny', family: 'tiny', bytes: GB });
    const gemma = view({ recommended: false });
    const rec = view({ recommended: true }, { id: 'rec', name: 'Rec', family: 'x', bytes: 3 * GB });
    expect(suggestedModel([small, gemma, rec])!.model.id).toBe('rec');
    expect(suggestedModel([small, gemma])!.model.id).toBe('gemma3-4b');
    expect(suggestedModel([small, view({ recommended: false, fits: false })])!.model.id).toBe('tiny');
    expect(suggestedModel([gemma, view({ state: 'installed' }, { id: 'other' })])).toBeNull();
    expect(suggestedModel([])).toBeNull();
  });
});

describe('first-use setup in the assistant', () => {
  it('says what the model is, what it needs and its licence, and downloads and sets it up', async () => {
    models = [view()];
    mount();
    expect(await screen.findByText('Answer on this computer too')).toBeTruthy();
    expect(screen.getByText(/Gemma 3 4B · version b1c2d3e4f5a6 · 2\.5 GB download · needs about 4(\.0)? GB of memory/)).toBeTruthy();
    expect(screen.getByText(/Gemma is provided under and subject to the Gemma Terms of Use/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Gemma Terms of Use' }));
    expect(call).toHaveBeenCalledWith('app:openExternal', { url: 'https://ai.google.dev/gemma/terms' });
    fireEvent.click(screen.getByRole('button', { name: 'Download and set up' }));
    await waitFor(() => expect(call).toHaveBeenCalledWith('ai:localInstall', { id: 'gemma3-4b' }));
  });

  it('shows the download, with pause and cancel, then resume', async () => {
    models = [view({ state: 'downloading', received: Math.round(1.25 * GB) })];
    const r = mount();
    expect(await screen.findByText(/Downloading · .* \(50%\)/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Pause' }));
    await waitFor(() => expect(call).toHaveBeenCalledWith('ai:localCancelInstall', { id: 'gemma3-4b' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(call).toHaveBeenCalledWith('ai:localCancelInstall', { id: 'gemma3-4b', discard: true }));
    r.unmount();
    models = [view({ state: 'paused', received: GB })];
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Resume' }));
    await waitFor(() => expect(call).toHaveBeenCalledWith('ai:localInstall', { id: 'gemma3-4b' }));
  });

  it('a failed download can be tried again', async () => {
    models = [view({ state: 'failed', error: 'The downloaded model does not match the catalog, so it was not installed.' })];
    mount();
    expect(await screen.findByText(/does not match the catalog/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(call).toHaveBeenCalledWith('ai:localInstall', { id: 'gemma3-4b' }));
  });

  it('says it is being set up while the model is tried, and why when it does not answer', async () => {
    models = [view({ state: 'installed', readiness: 'testing' })];
    const r = mount();
    expect(await screen.findByText(/Setting it up: loading the model and trying it/)).toBeTruthy();
    r.unmount();
    models = [view({ state: 'installed', readiness: 'failed', readinessError: 'error loading model architecture' })];
    mount();
    expect(await screen.findByText(/did not answer on this computer: error loading model architecture/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Test again' }));
    await waitFor(() => expect(call).toHaveBeenCalledWith('ai:localTest', { id: 'gemma3-4b' }));
  });

  it('is gone once the model is ready, and after Not now', async () => {
    models = [view({ state: 'installed', readiness: 'ready', isDefault: true })];
    const r = mount();
    await waitFor(() => expect(call).toHaveBeenCalledWith('ai:localModels', undefined));
    expect(screen.queryByText('Answer on this computer too')).toBeNull();
    r.unmount();
    models = [view()];
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Not now' }));
    expect(screen.queryByText('Answer on this computer too')).toBeNull();
    cleanup();
    mount();
    await waitFor(() => expect(call).toHaveBeenCalled());
    expect(screen.queryByText('Answer on this computer too')).toBeNull();
  });
});
