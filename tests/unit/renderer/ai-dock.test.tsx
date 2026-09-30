// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type * as CoreApi from '../../../src/core/api';

vi.mock('../../../src/core/bridge', () => ({ call: vi.fn(async () => null), on: () => () => undefined, hasDesktop: () => false, errorMessage: (e: unknown) => String(e), isMac: true, platform: 'darwin' }));
vi.mock('../../../src/core/api', async (orig) => ({ ...(await orig<typeof CoreApi>()), apiGet: vi.fn(async () => ({ items: [], actions: [] })), apiPost: vi.fn(), apiPut: vi.fn() }));

const { AiDock } = await import('../../../src/app/overlays/AiDock');

afterEach(cleanup);

describe('the AI Assistant dock', () => {
  it('switches between Ask, Write and Changes', () => {
    render(<QueryClientProvider client={new QueryClient()}><AiDock /></QueryClientProvider>);
    const tab = (name: string) => screen.getByRole('tab', { name });
    expect(tab('Ask').getAttribute('aria-selected')).toBe('true');
    fireEvent.click(tab('Write'));
    expect(tab('Write').getAttribute('aria-selected')).toBe('true');
    expect(screen.getByText('Sees only what you give it. Never sends on its own.')).toBeTruthy();
    fireEvent.click(tab('Changes'));
    expect(tab('Changes').getAttribute('aria-selected')).toBe('true');
    fireEvent.click(tab('Ask'));
    expect(tab('Ask').getAttribute('aria-selected')).toBe('true');
  });
});
