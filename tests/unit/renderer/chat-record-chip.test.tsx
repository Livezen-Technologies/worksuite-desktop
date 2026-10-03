// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type * as CoreApi from '../../../src/core/api';

vi.mock('../../../src/core/bridge', () => ({
  call: vi.fn(async () => null),
  on: () => () => undefined,
  errorMessage: (e: unknown) => String(e),
  hasDesktop: () => true,
  isMac: false,
  registerDropped: vi.fn(async () => []),
}));
vi.mock('../../../src/core/api', async (orig) => ({ ...(await orig<typeof CoreApi>()), apiGet: vi.fn(async () => ({})), apiPost: vi.fn(async () => ({})), request: vi.fn(async () => ({ data: {} })) }));
vi.mock('../../../src/core/toasts', () => ({ toast: vi.fn() }));
vi.mock('../../../src/core/app-state', async () => {
  const { createStore } = await import('../../../src/core/store');
  return { app: createStore({ apps: [], transfers: [], bootstrap: { permissions: [], user: { id: 7, name: 'Nimal' } }, auth: { server: { origin: 'https://app.worksuite.lk' } } }) };
});

import { Composer } from '../../../src/modules/chat/Composer';

afterEach(cleanup);

describe('the open record in the chat drawer (worksuite-desktop#164)', () => {
  it('is a small chip inside the message box, not a card over the conversation', () => {
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <Composer roomId="12" roomName="Amaya" group={false} reply={null} onClearReply={() => undefined} look="pill" inside={<div data-record-chip>Deal 42 is open</div>} />
      </QueryClientProvider>,
    );

    const chip = screen.getByText('Deal 42 is open');
    const box = (screen.getByRole('textbox', { name: 'Message' }) as HTMLElement).closest('.rounded-\\[22px\\]');
    expect(box).toBeTruthy();
    expect(box!.contains(chip)).toBe(true);
  });
});
