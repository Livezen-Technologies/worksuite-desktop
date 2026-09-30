// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as CoreApi from '../../../src/core/api';
import type * as Assistant from '../../../src/modules/ai/assistant';
import type { AskTurn } from '../../../src/modules/ai/assistant';

vi.mock('../../../src/core/bridge', () => ({ call: vi.fn(async () => null), on: () => () => undefined, hasDesktop: () => false, errorMessage: (e: unknown) => String(e), isMac: true, platform: 'darwin' }));
vi.mock('../../../src/core/api', async (orig) => ({ ...(await orig<typeof CoreApi>()), apiGet: vi.fn(async () => ({ enabled: true, reason: null })), apiPost: vi.fn(), apiPut: vi.fn() }));
vi.mock('../../../src/modules/ai/assistant', async (orig) => ({ ...(await orig<typeof Assistant>()), ask: vi.fn() }));

const { ask } = await import('../../../src/modules/ai/assistant');
const { AskPanel } = await import('../../../src/modules/ai/AskPanel');
const { createAskSession } = await import('../../../src/modules/ai/session');

const turn = (reply: string): AskTurn => ({ ok: true, reply, conversation_id: 4, tool_runs: [], sources: [], pending_actions: [] }) as unknown as AskTurn;
const thinking = () => screen.queryByTestId('ai-thinking');

let session = createAskSession();
beforeEach(() => {
  vi.mocked(ask).mockReset();
  session = createAskSession();
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <AskPanel surface="assistant.panel" session={session} />
    </QueryClientProvider>,
  );
});
afterEach(cleanup);

async function askIt(q: string) {
  fireEvent.change(screen.getByLabelText('Your question'), { target: { value: q } });
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Send' })));
}

describe('Thinking… while the assistant prepares its answer (#43)', () => {
  it('shows the moment the question goes, below it, with the sparkle pulsing — and goes when the answer lands', async () => {
    let answer: (t: AskTurn) => void = () => undefined;
    vi.mocked(ask).mockImplementationOnce(() => new Promise<AskTurn>((r) => (answer = r)));
    await askIt('What is due today?');
    const row = thinking()!;
    expect(row.textContent).toBe('Thinking…');
    expect(screen.queryByText(/Looking into it/)).toBeNull();
    // After the question, among the answers (not a bubble of its own on the right).
    expect(screen.getByText('What is due today?').compareDocumentPosition(row) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // It pulses only where motion is welcome: the class is motion-safe, so reduced motion shows the icon still.
    expect(row.querySelector('svg')!.getAttribute('class')).toContain('motion-safe:animate-pulse');
    // Read out once, as it appears, in the conversation's polite region; its words never change.
    expect(row.closest('[aria-live="polite"]')).toBeTruthy();
    await act(async () => answer(turn('Two tasks are due.')));
    expect(thinking()).toBeNull();
    expect(screen.getByText('Two tasks are due.')).toBeTruthy();
  });

  it('gives way to an answer as soon as it starts to show, which is not read out word by word', () => {
    act(() => session.store.set({ busy: true, streaming: null }));
    expect(thinking()).toBeTruthy();
    act(() => session.store.set({ streaming: 'Two tas' }));
    expect(thinking()).toBeNull();
    expect(screen.getByText('Two tas').closest('[aria-live="off"]')).toBeTruthy();
    // Stopped (or done): nothing is left spinning.
    act(() => session.store.set({ busy: false, streaming: null }));
    expect(thinking()).toBeNull();
  });

  it('says what went wrong and offers Try again, which asks the same question once more in its place', async () => {
    vi.mocked(ask).mockRejectedValueOnce(new Error('The server answered 502.'));
    await askIt('What is due today?');
    expect(thinking()).toBeNull();
    expect(screen.getByRole('alert').textContent).toContain('502');
    vi.mocked(ask).mockResolvedValueOnce(turn('Two tasks are due.'));
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Try again' })));
    expect(vi.mocked(ask).mock.calls.map(([q]) => q)).toEqual(['What is due today?', 'What is due today?']);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getAllByText('What is due today?')).toHaveLength(1);
    expect(screen.getByText('Two tasks are due.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
  });

  it('offers Try again on the last failure only', async () => {
    vi.mocked(ask).mockRejectedValueOnce(new Error('The server answered 502.'));
    await askIt('First?');
    vi.mocked(ask).mockResolvedValueOnce(turn('Fine now.'));
    await askIt('Second?');
    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
  });
});
