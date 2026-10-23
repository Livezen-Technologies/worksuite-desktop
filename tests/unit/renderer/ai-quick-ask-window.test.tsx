// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { QuickAskContext } from '@shared/types';
import type * as CoreApi from '../../../src/core/api';

vi.mock('../../../src/core/bridge', () => ({ call: vi.fn(), on: () => () => undefined, hasDesktop: () => true, errorMessage: (e: unknown) => String(e), isMac: true }));
vi.mock('../../../src/core/api', async (orig) => ({ ...(await orig<typeof CoreApi>()), apiGet: vi.fn(), apiPost: vi.fn(), apiPut: vi.fn() }));
vi.mock('../../../src/core/tabs', async () => {
  const { createStore } = await import('../../../src/core/store');
  return { navigate: vi.fn(), tabsStore: createStore({ tabs: [], activeId: null }) };
});

import { apiGet, apiPost } from '../../../src/core/api';
import { call } from '../../../src/core/bridge';
import { QuickAskWindow } from '../../../src/app/QuickAskWindow';

/**
 * Quick Ask over another app (board D03). What matters here is that the window
 * never promises something about the wrong text: it writes back only when
 * clicked, and it says "replace" only when there really was a selection to
 * replace — opened with what was copied last, there is nothing highlighted and
 * the text lands at the caret instead.
 */

const ctx = (over: Partial<QuickAskContext & { shortcut: string | null }> = {}) => ({
  text: 'We will install the new network in two weeks.', source: 'selection', app: 'Word', canInsert: true, note: null, shortcut: 'Alt+Space', ...over,
});

function mount(c: ReturnType<typeof ctx>) {
  vi.mocked(call).mockImplementation(((channel: string) => (channel === 'quickask:context' ? Promise.resolve(c) : Promise.resolve(null))) as never);
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <QuickAskWindow />
    </QueryClientProvider>,
  );
}

const settle = () => act(async () => { await Promise.resolve(); });

beforeEach(() => {
  vi.mocked(apiGet).mockReset().mockResolvedValue({ enabled: true, reason: null } as never);
  vi.mocked(apiPost).mockReset();
});
afterEach(() => {
  cleanup();
  vi.mocked(call).mockReset();
});

/** An answer, so the button that writes it back appears. */
async function answer(question: string) {
  vi.mocked(apiPost).mockResolvedValue({ conversation_id: 1, ok: true, reply: 'Shorter, and clearer.', error: null, sources: [], tool_runs: [] } as never);
  fireEvent.change(screen.getByLabelText('Your question'), { target: { value: question } });
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Send' })));
}

describe('Quick Ask’s write-back', () => {
  it('offers to replace the selection, naming the app it came from', async () => {
    mount(ctx());
    await settle();
    await answer('Make this shorter');

    const button = await screen.findByRole('button', { name: 'Replace selection in Word' });
    fireEvent.click(button);
    expect(call).toHaveBeenCalledWith('quickask:insert', { text: 'Shorter, and clearer.' });
    expect(screen.getByText(/The selection was read when you pressed/)).toBeTruthy();
    expect(screen.getByText(/Nothing is written back until you click/)).toBeTruthy();
  });

  it('says "insert", not "replace", when there was no selection to replace', async () => {
    mount(ctx({ source: 'clipboard', app: null, text: 'something copied earlier' }));
    await settle();
    await answer('Make this shorter');

    expect(await screen.findByRole('button', { name: 'Insert into the app' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Replace selection/ })).toBeNull();
    expect(screen.getByText(/Only what you type or paste here is sent/)).toBeTruthy();
  });

  it('promises nothing about writing back when it cannot write back', async () => {
    mount(ctx({ canInsert: false }));
    await settle();
    await answer('Make this shorter');

    expect(screen.queryByText(/Nothing is written back until you click/)).toBeNull();
    expect(screen.queryByRole('button', { name: /Replace selection|Insert into/ })).toBeNull();
  });
});
