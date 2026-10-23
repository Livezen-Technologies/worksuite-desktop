// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LocalModelView } from '@shared/local-ai';

vi.mock('../../../src/core/bridge', () => ({ call: vi.fn(), on: () => () => undefined, hasDesktop: () => true, errorMessage: (e: unknown) => String(e), isMac: true }));
vi.mock('../../../src/core/tabs', async () => {
  const { createStore } = await import('../../../src/core/store');
  return { navigate: vi.fn(), tabsStore: createStore({ tabs: [], activeId: null }) };
});

import { call } from '../../../src/core/bridge';
import { navigate } from '../../../src/core/tabs';
import { LocalAiPill } from '../../../src/modules/ai/LocalAiPill';

/**
 * "Local AI ready" in the sidebar (boards D01, D02, D04, D05, D06). The strip
 * promises answers without a connection, so the whole point of these is that
 * it cannot make that promise on a computer that would quietly go online
 * instead: a model that is downloading, that lost its readiness check, or that
 * is not the chosen one is not a ready Local AI, however much of it is on
 * disk.
 */

function view(over: Partial<LocalModelView> = {}): LocalModelView {
  return {
    model: { id: 'gemma3-4b', version: '1', name: 'Gemma 3 4B', family: 'gemma3', purpose: 'chat', url: 'https://x/m.gguf', sha256: 'a'.repeat(64), bytes: 2_900_000_000, quantization: 'Q4_K_M', contextLength: 8192, minMemoryBytes: 8_000_000_000, tiers: ['strong'], recommendedFor: [], license: { id: 'gemma', name: 'Gemma Terms', url: 'https://x' }, languages: [], toolCalling: true },
    state: 'installed', received: 2_900_000_000, error: null, fits: true, recommended: true, isDefault: true,
    readiness: 'ready', readinessError: null, bytesPerSecond: null, ...over,
  } as LocalModelView;
}

function wrap(models: LocalModelView[]) {
  vi.mocked(call).mockResolvedValue(models as never);
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <LocalAiPill collapsed={false} />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.mocked(call).mockReset();
});

describe('the sidebar’s Local AI strip', () => {
  it('names the model that answers, and opens Local AI’s settings', async () => {
    wrap([view()]);

    expect(await screen.findByText('Local AI ready')).toBeTruthy();
    expect(screen.getByText('Gemma 3 4B · works offline')).toBeTruthy();
    screen.getByRole('button').click();
    expect(navigate).toHaveBeenCalledWith('/settings/local-ai');
  });

  it('says nothing while no model on this computer can answer', async () => {
    const cases: Array<Partial<LocalModelView>> = [
      { state: 'downloading', received: 10 },
      { readiness: 'failed', readinessError: 'It would not load.' },
      { readiness: 'testing' },
      { isDefault: false },
    ];
    for (const over of cases) {
      const { unmount } = wrap([view(over)]);
      // Nothing to find, so the absence has to be given a chance to appear first.
      await new Promise((r) => setTimeout(r, 0));
      expect(screen.queryByText('Local AI ready')).toBeNull();
      unmount();
      cleanup();
    }
  });

  it('is left out at icon width, where the model’s name would not fit', () => {
    vi.mocked(call).mockResolvedValue([view()] as never);
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <LocalAiPill collapsed />
      </QueryClientProvider>,
    );
    expect(screen.queryByRole('button')).toBeNull();
    // Collapsed, it does not even ask: a line nobody can see is not worth a model listing.
    expect(call).not.toHaveBeenCalled();
  });
});
