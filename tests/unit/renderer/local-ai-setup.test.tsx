// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LocalAIHardware, LocalModelView } from '@shared/local-ai';

/**
 * Setting up the AI Assistant on this computer (worksuite-desktop#49, #55): what the model is and what it needs,
 * the computer checked first, Download and Set Up / Not Now, the stages with progress and time left, cancel, resume
 * and retry, errors that say what to do, local chat only once the model has answered, then "ready" and Start
 * Chatting — and nothing offered once a model can answer.
 */
let models: LocalModelView[] = [];
let hardware: LocalAIHardware | null = null;
const call = vi.fn(async (channel: string, _input?: unknown) => {
  if (channel === 'ai:localModels') return models;
  if (channel === 'ai:localStatus') return { runtime: 'off', error: null, loaded: null, hardware, catalogError: null, catalogAt: null };
  return null;
});
vi.mock('../../../src/core/bridge', () => ({ call: (c: string, i?: unknown) => call(c, i), on: () => () => undefined, hasDesktop: () => true, errorMessage: (e: unknown) => String(e), isMac: false }));
vi.mock('../../../src/core/toasts', () => ({ toast: vi.fn() }));
const navigate = vi.fn();
vi.mock('../../../src/core/tabs', () => ({ navigate: (r: string) => navigate(r) }));

const { localReady, suggestedModel } = await import('../../../src/core/local-ai');
const { LocalSetup } = await import('../../../src/modules/ai/LocalSetup');
const { compatibility, firstUseOffer, problemKind, secondsLeft, stageOf, storageNeeded, timeLeftLabel } = await import('../../../src/modules/ai/setup');

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
const hw = (free: number, memory = 16 * GB): LocalAIHardware => ({ platform: 'darwin', arch: 'arm64', memoryBytes: memory, freeDiskBytes: free, cpuCores: 8, gpu: 'metal', vramBytes: 0, tier: 'good' });

const onStart = vi.fn();
function mount() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><LocalSetup onStart={onStart} /></QueryClientProvider>);
}

beforeEach(() => {
  localStorage.clear();
  call.mockClear();
  navigate.mockClear();
  onStart.mockClear();
  hardware = hw(100 * GB);
});
afterEach(cleanup);

describe('what to offer, and when', () => {
  it('local chat is offered only once the model is installed, chosen, and has not failed (or is in) its check', () => {
    expect(localReady([view({ state: 'installed', isDefault: true, readiness: 'ready' })])).not.toBeNull();
    expect(localReady([view({ state: 'installed', isDefault: true, readiness: 'testing' })])).toBeNull();
    expect(localReady([view({ state: 'installed', isDefault: true, readiness: 'failed' })])).toBeNull();
  });

  it('suggests the recommended model, else Gemma 3 4B, else the smallest that fits', () => {
    const small = view({ recommended: false }, { id: 'tiny', name: 'Tiny', family: 'tiny', bytes: GB });
    expect(suggestedModel([small, view({ recommended: false }), view({}, { id: 'rec', name: 'Rec', family: 'x' })])!.model.id).toBe('rec');
    expect(suggestedModel([small, view({ recommended: false })])!.model.id).toBe('gemma3-4b');
    expect(suggestedModel([small, view({ recommended: false, fits: false })])!.model.id).toBe('tiny');
    // Nothing fits: the smallest anyway, rather than no offer.
    expect(suggestedModel([view({ fits: false }), view({ fits: false }, { id: 'tiny', bytes: GB })])!.model.id).toBe('tiny');
  });

  it('offers nothing when a model on this computer can already answer; a setup under way beats a suggestion', () => {
    const s = view();
    expect(firstUseOffer([view({ state: 'installed', readiness: 'ready' }, { id: 'x' }), s], s)).toBeNull();
    expect(firstUseOffer([view({ state: 'installed', readiness: 'failed' }, { id: 'x' })], s)!.model.id).toBe('x');
    expect(firstUseOffer([view({ state: 'paused', received: GB }, { id: 'y' })], s)!.model.id).toBe('y');
    expect(firstUseOffer([], s)).toBe(s);
  });

  it('checks the space first (blocking) and the memory (a warning)', () => {
    expect(storageNeeded(view())).toBe(Math.round(2.5 * GB) + 512 * 1024 ** 2);
    expect(storageNeeded(view({ received: 2 * GB }))).toBe(Math.round(0.5 * GB) + 512 * 1024 ** 2);
    expect(compatibility(view(), hw(2 * GB))).toMatchObject({ storage: true, slow: false });
    expect(compatibility(view({ fits: false }), hw(50 * GB))).toMatchObject({ storage: false, slow: true });
    expect(compatibility(view(), null)).toMatchObject({ storage: false, free: null });
  });

  it('names the stage and what kind of trouble stopped it', () => {
    expect(stageOf(view({ state: 'downloading' }))).toEqual({ stage: 'downloading', stopped: null });
    expect(stageOf(view({ state: 'paused' }))).toEqual({ stage: 'downloading', stopped: 'paused' });
    expect(stageOf(view({ state: 'verifying' }))).toEqual({ stage: 'verifying', stopped: null });
    expect(stageOf(view({ state: 'failed', error: 'The downloaded model does not match the catalog, so it was not installed.' }))).toEqual({ stage: 'verifying', stopped: 'failed' });
    expect(stageOf(view({ state: 'installed', readiness: 'testing' }))).toEqual({ stage: 'preparing', stopped: null });
    expect(stageOf(view({ state: 'installed', readiness: 'failed' }))).toEqual({ stage: 'preparing', stopped: 'failed' });
    expect(stageOf(view({ state: 'installed', readiness: 'ready' }))).toEqual({ stage: 'ready', stopped: null });
    expect(problemKind('net::ERR_INTERNET_DISCONNECTED')).toBe('connection');
    expect(problemKind('The download failed (503).')).toBe('connection');
    expect(problemKind('Not enough free space: Gemma 3 4B needs 2400 MB more.')).toBe('storage');
    expect(problemKind('The downloaded model does not match the catalog, so it was not installed.')).toBe('mismatch');
    expect(problemKind('error loading model', true)).toBe('setup');
  });

  it('says how long is left once it can tell', () => {
    expect(secondsLeft(view({ received: GB, bytesPerSecond: null }))).toBeNull();
    expect(secondsLeft(view({ received: 0, bytesPerSecond: 10 * 1024 ** 2 }))).toBe(256);
    expect(timeLeftLabel(30)).toBe('less than a minute left');
    expect(timeLeftLabel(256)).toBe('about 4 min left');
    expect(timeLeftLabel(3 * 3600 + 20 * 60)).toBe('about 3 h 20 min left');
    expect(timeLeftLabel(null)).toBeNull();
  });
});

describe('"Set up your AI Assistant"', () => {
  it('shows the model, its size, the space it needs and its licence, with Download and Set Up and Not Now', async () => {
    models = [view()];
    mount();
    expect(await screen.findByText('Set up your AI Assistant')).toBeTruthy();
    expect(screen.getByText(/Gemma 3 4B · 2\.5 GB download · needs 3(\.0)? GB of free space/)).toBeTruthy();
    expect(screen.getByText(/Gemma is provided under and subject to the Gemma Terms of Use/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Gemma Terms of Use' }));
    expect(call).toHaveBeenCalledWith('app:openExternal', { url: 'https://ai.google.dev/gemma/terms' });
    fireEvent.click(await screen.findByRole('button', { name: 'Download and set up' }));
    await waitFor(() => expect(call).toHaveBeenCalledWith('ai:localInstall', { id: 'gemma3-4b' }));
  });

  it('will not start without the space, and says how much is needed', async () => {
    hardware = hw(1 * GB);
    models = [view()];
    mount();
    expect(await screen.findByText(/Not enough free space: it needs 3(\.0)? GB and this computer has 1(\.0)? GB/)).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Download and set up' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Check again' }));
    await waitFor(() => expect(call.mock.calls.filter(([c]) => c === 'ai:localStatus').length).toBeGreaterThan(1));
  });

  it('warns, but lets it go ahead, when the computer has less memory than the model wants', async () => {
    hardware = hw(100 * GB, 3 * GB);
    models = [view({ fits: false })];
    mount();
    expect(await screen.findByText(/It needs about 4(\.0)? GB of memory and this computer has 3(\.0)? GB: it will work, slowly/)).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Download and set up anyway' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('Not now puts the offer away, and it stays away next time', async () => {
    models = [view()];
    const r = mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Not now' }));
    expect(screen.queryByText('Set up your AI Assistant')).toBeNull();
    r.unmount();
    mount();
    await waitFor(() => expect(call).toHaveBeenCalledWith('ai:localModels', undefined));
    expect(screen.queryByText('Set up your AI Assistant')).toBeNull();
  });

  it('a setup under way is shown even after Not now, with its stage, progress and time left', async () => {
    localStorage.setItem('ws.ai.localSetup.snoozed', String(Date.now()));
    models = [view({ state: 'downloading', received: Math.round(1.25 * GB), bytesPerSecond: 20 * 1024 ** 2 })];
    mount();
    expect(await screen.findByText(/50% · 1\.3 GB of 2\.5 GB · about 1 min left/)).toBeTruthy();
    const stages = screen.getByRole('list', { name: 'Setup stages' });
    expect(stages.textContent).toMatch(/Downloading.*Verifying.*Preparing AI.*Ready/);
    expect(screen.getByText('Downloading').closest('li')!.getAttribute('aria-current')).toBe('step');
    expect(screen.getByRole('progressbar', { name: 'Download' }).getAttribute('aria-valuenow')).toBe('50');
    fireEvent.click(screen.getByRole('button', { name: 'Pause' }));
    await waitFor(() => expect(call).toHaveBeenCalledWith('ai:localCancelInstall', { id: 'gemma3-4b' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(call).toHaveBeenCalledWith('ai:localCancelInstall', { id: 'gemma3-4b', discard: true }));
  });

  it('a dropped connection says to check it and resumes where it stopped', async () => {
    models = [view({ state: 'failed', received: GB, error: 'net::ERR_INTERNET_DISCONNECTED' })];
    mount();
    expect(await screen.findByText(/The connection dropped\. Check you are online, then resume/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Resume' }));
    await waitFor(() => expect(call).toHaveBeenCalledWith('ai:localInstall', { id: 'gemma3-4b' }));
  });

  it('too little space part-way says to free some up, with the way to Settings', async () => {
    models = [view({ state: 'failed', received: GB, error: 'Not enough free space: Gemma 3 4B needs 1500 MB more.' })];
    mount();
    expect(await screen.findByText(/not enough free space on this computer\. Free some up, then try again/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Settings → Local AI' }));
    expect(navigate).toHaveBeenCalledWith('/settings/local-ai');
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
  });

  it('Verifying, then Preparing AI while the model is loaded and tried; a model that will not run can be tested again or swapped', async () => {
    models = [view({ state: 'verifying', received: Math.round(2.5 * GB) })];
    const r = mount();
    expect((await screen.findByText('Verifying')).closest('li')!.getAttribute('aria-current')).toBe('step');
    r.unmount();
    models = [view({ state: 'installed', readiness: 'testing' })];
    const r2 = mount();
    expect((await screen.findByText('Preparing AI')).closest('li')!.getAttribute('aria-current')).toBe('step');
    expect(screen.getByText(/Loading the model and trying it/)).toBeTruthy();
    r2.unmount();
    models = [view({ state: 'installed', readiness: 'failed', readinessError: 'error loading model architecture' })];
    mount();
    expect(await screen.findByText(/downloaded but would not run on this computer/)).toBeTruthy();
    expect(screen.getByText('error loading model architecture')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Test again' }));
    await waitFor(() => expect(call).toHaveBeenCalledWith('ai:localTest', { id: 'gemma3-4b' }));
    fireEvent.click(screen.getByRole('button', { name: 'Choose another model' }));
    expect(navigate).toHaveBeenCalledWith('/settings/local-ai');
  });

  it('says "Your AI Assistant is ready to use" once, with Start Chatting, and nothing after', async () => {
    models = [view()];
    const r = mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Download and set up' }));
    r.unmount();
    // Later — the panel was closed meanwhile — the model downloaded, loaded and answered.
    models = [view({ state: 'installed', readiness: 'ready', isDefault: true })];
    const r2 = mount();
    expect(await screen.findByText('Your AI Assistant is ready to use')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Start chatting' }));
    expect(onStart).toHaveBeenCalled();
    r2.unmount();
    mount();
    await waitFor(() => expect(call).toHaveBeenCalledWith('ai:localModels', undefined));
    expect(screen.queryByText('Your AI Assistant is ready to use')).toBeNull();
    expect(screen.queryByText('Set up your AI Assistant')).toBeNull();
  });

  it('is not offered at all when a model on this computer already answers', async () => {
    models = [view({ state: 'installed', readiness: 'ready', isDefault: true }), view({}, { id: 'other', name: 'Other' })];
    mount();
    await waitFor(() => expect(call).toHaveBeenCalledWith('ai:localModels', undefined));
    expect(screen.queryByText('Set up your AI Assistant')).toBeNull();
  });
});
