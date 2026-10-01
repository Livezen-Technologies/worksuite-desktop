// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LocalAIEvent, LocalModelView } from '@shared/local-ai';

const listeners = new Map<string, Set<(p: unknown) => void>>();
const emit = (channel: string, p: unknown) => listeners.get(channel)?.forEach((cb) => cb(p));
const MODEL: LocalModelView = {
  model: {
    id: 'qwen3-4b', version: '1', name: 'Qwen3 4B', family: 'qwen3', purpose: 'chat', url: 'https://cdn.worksuite.test/q.gguf', sha256: 'a'.repeat(64), bytes: 2_500_000_000,
    quantization: 'Q4_K_M', contextLength: 32768, minMemoryBytes: 4e9, tiers: ['good'], recommendedFor: ['good'], license: { id: 'Apache-2.0', name: 'Apache 2.0', url: 'https://www.apache.org/licenses/LICENSE-2.0' }, languages: [], toolCalling: false,
  },
  state: 'installed', received: 0, error: null, fits: true, recommended: true, isDefault: true, readiness: 'ready', readinessError: null,
};
let asked: { id: string; messages: { role: string; content: string }[] } | null = null;
const call = vi.fn(async (channel: string, input?: unknown) => {
  if (channel === 'ai:localModels') return [MODEL];
  if (channel === 'ai:localAsk') asked = input as typeof asked;
  if (channel === 'ai:rules') return { enabled: true, localFiles: false };
  return null;
});
vi.mock('../../../src/core/bridge', () => ({
  call: (c: string, i?: unknown) => call(c, i),
  on: (c: string, cb: (p: unknown) => void) => {
    if (!listeners.has(c)) listeners.set(c, new Set());
    listeners.get(c)!.add(cb);
    return () => listeners.get(c)!.delete(cb);
  },
  hasDesktop: () => true,
  errorMessage: (e: unknown) => String(e),
  isMac: true,
  platform: 'darwin',
}));

const { askLocal, localReady } = await import('../../../src/core/local-ai');
const { AskPanel } = await import('../../../src/modules/ai/AskPanel');

afterEach(() => {
  cleanup();
  asked = null;
});

describe('Local AI in the windows', () => {
  it('streams an answer for its own request id only, and resolves on done', async () => {
    const seen: string[] = [];
    const r = askLocal([{ role: 'user', content: 'hi' }], (t) => seen.push(t));
    await waitFor(() => expect(asked).not.toBeNull());
    const id = asked!.id;
    emit('ai:localEvent', { id: 'someone-else', type: 'chunk', text: 'nope' } satisfies LocalAIEvent);
    emit('ai:localEvent', { id, type: 'chunk', text: 'Hel' } satisfies LocalAIEvent);
    emit('ai:localEvent', { id, type: 'chunk', text: 'lo' } satisfies LocalAIEvent);
    emit('ai:localEvent', { id, type: 'done', text: 'Hello', tokens: 2, ms: 10, cancelled: false } satisfies LocalAIEvent);
    await expect(r.done).resolves.toMatchObject({ text: 'Hello', cancelled: false });
    expect(seen).toEqual(['Hel', 'Hello']);
    r.cancel();
    expect(call).toHaveBeenCalledWith('ai:localCancel', { id });
  });

  it('rejects with the runtime\'s sentence on an error', async () => {
    const r = askLocal([{ role: 'user', content: 'hi' }], () => undefined);
    await waitFor(() => expect(asked).not.toBeNull());
    emit('ai:localEvent', { id: asked!.id, type: 'error', message: 'No model is installed on this computer.' } satisfies LocalAIEvent);
    await expect(r.done).rejects.toThrow('No model is installed');
  });

  it('counts only an installed default chat model as ready', () => {
    expect(localReady([MODEL])?.model.id).toBe('qwen3-4b');
    expect(localReady([{ ...MODEL, isDefault: false }])).toBeNull();
    expect(localReady([{ ...MODEL, state: 'downloading' }])).toBeNull();
  });

  it('answers on this computer by default, with no mode to choose and wording that says so (worksuite-desktop#53)', async () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <AskPanel surface="assistant.panel" />
      </QueryClientProvider>,
    );
    await waitFor(() => expect(screen.getByTestId('ai-mode').textContent).toContain('Processing locally'));
    expect(screen.queryByRole('radio')).toBeNull();
    expect(screen.queryByRole('radiogroup')).toBeNull();
    expect(screen.queryByText(/nothing is sent/)).toBeNull();
    fireEvent.change(screen.getByLabelText('Your question'), { target: { value: 'What is 2+2?' } });
    fireEvent.click(screen.getByLabelText('Send'));
    await waitFor(() => expect(asked).not.toBeNull());
    expect(asked!.messages[0]?.role).toBe('system');
    expect(asked!.messages.at(-1)).toEqual({ role: 'user', content: 'What is 2+2?' });
    act(() => emit('ai:localEvent', { id: asked!.id, type: 'chunk', text: 'Four.' } satisfies LocalAIEvent));
    expect(await screen.findByText('Four.')).toBeTruthy();
    expect(screen.getByLabelText('Stop')).toBeTruthy();
    act(() => emit('ai:localEvent', { id: asked!.id, type: 'done', text: 'Four.', tokens: 2, ms: 5, cancelled: false } satisfies LocalAIEvent));
    await waitFor(() => expect(screen.queryByLabelText('Stop')).toBeNull());
    expect(screen.getByText('Processed locally')).toBeTruthy();
  });
});
