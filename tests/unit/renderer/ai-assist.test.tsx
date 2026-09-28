// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as CoreApi from '../../../src/core/api';

vi.mock('../../../src/core/bridge', () => ({ call: vi.fn(), on: () => () => undefined, errorMessage: (e: unknown) => String(e), isMac: true }));
vi.mock('../../../src/core/api', async (orig) => ({ ...(await orig<typeof CoreApi>()), apiGet: vi.fn(), apiPost: vi.fn() }));

import { ApiError, apiGet, apiPost } from '../../../src/core/api';
import { Assist } from '../../../src/modules/ai/Assist';
import { offeredActions, resultLabel, shortcutLabel, writerProblem } from '../../../src/modules/ai/writer';

const INFO = {
  available: true,
  actions: ['grammar', 'improve', 'professional', 'shorten', 'expand', 'tone', 'translate', 'reply'].map((key) => ({ key, label: key, needs_text: true })),
  tones: ['Friendly'],
  languages: ['English', 'Sinhala', 'Tamil'],
};

describe('the writing assistant on the desktop', () => {
  it('offers what the server has, in the desktop order', () => {
    expect(offeredActions(INFO).map((a) => a.key)).toEqual(['translate', 'improve', 'shorten', 'professional', 'grammar']);
    expect(offeredActions({ ...INFO, actions: [{ key: 'grammar', label: 'Fix grammar', needs_text: true }] }).map((a) => a.label)).toEqual(['Fix grammar']);
  });
  it('names shortcuts, results and problems plainly', () => {
    expect(shortcutLabel('Alt+Space', true)).toBe('⌥Space');
    expect(shortcutLabel('Control+Alt+Space', false)).toBe('Ctrl+Alt+Space');
    expect(shortcutLabel('CommandOrControl+Shift+Space', true)).toBe('⌘⇧Space');
    expect(resultLabel('translate', 'Sinhala')).toBe('SINHALA');
    expect(resultLabel('improve', 'Sinhala')).toBe('REWRITE');
    expect(writerProblem(new ApiError(503, 'x', null))).toBe('No AI connection is configured for this workspace yet.');
    expect(writerProblem(new ApiError(403, 'x', null))).toBe("Your account doesn't have the writing assistant.");
  });
});

describe('Assist (Quick Ask and the dock)', () => {
  beforeEach(() => {
    vi.mocked(apiGet).mockResolvedValue(INFO as never);
    vi.mocked(apiPost).mockReset();
  });
  afterEach(() => cleanup());

  function mount(over: Partial<Parameters<typeof Assist>[0]> = {}) {
    const onTask = vi.fn();
    const onSearch = vi.fn();
    const onOpen = vi.fn();
    const insert = vi.fn();
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <Assist text="Your website goes live on 15 October." onText={() => undefined} language="Sinhala" onTask={onTask} onSearch={onSearch} onOpen={onOpen} insert={{ label: 'Insert into Pages', run: insert }} {...over} />
      </QueryClientProvider>,
    );
    return { onTask, onSearch, onOpen, insert };
  }

  it('translates into the chosen language and shows the answer with Insert, Copy and Open in WorkSuite', async () => {
    vi.mocked(apiPost).mockResolvedValueOnce({ text: 'ඔබගේ වෙබ් අඩවිය ඔක්තෝබර් 15 වන දින සජීවී වේ.' } as never);
    const { insert, onOpen } = mount();
    await act(async () => {
      fireEvent.click(await screen.findByRole('button', { name: /Translate/ }));
    });
    expect(apiPost).toHaveBeenCalledWith('/api/ai/write', { action: 'translate', text: 'Your website goes live on 15 October.', language: 'Sinhala' });
    expect(screen.getByText('SINHALA')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Insert into Pages' }));
    expect(insert).toHaveBeenCalledWith('ඔබගේ වෙබ් අඩවිය ඔක්තෝබර් 15 වන දින සජීවී වේ.');
    fireEvent.click(screen.getByRole('button', { name: 'Open in WorkSuite' }));
    expect(onOpen).toHaveBeenCalledWith('Your website goes live on 15 October.', 'ඔබගේ වෙබ් අඩවිය ඔක්තෝබර් 15 වන දින සජීවී වේ.');
  });

  it('rewrites without a language, and shows the server’s reason when it cannot', async () => {
    vi.mocked(apiPost).mockRejectedValueOnce(new ApiError(502, 'You have used your hourly allowance.', null));
    mount();
    await act(async () => {
      fireEvent.click(await screen.findByRole('button', { name: 'Rewrite' }));
    });
    expect(apiPost).toHaveBeenCalledWith('/api/ai/write', { action: 'improve', text: 'Your website goes live on 15 October.' });
    expect(screen.getByRole('alert').textContent).toBe('You have used your hourly allowance.');
  });

  it('makes a task or asks WorkSuite with the text, calling no model', async () => {
    const { onTask, onSearch } = mount();
    fireEvent.click(await screen.findByRole('button', { name: /Make a task/ }));
    fireEvent.click(screen.getByRole('button', { name: /Ask WorkSuite/ }));
    expect(onTask).toHaveBeenCalledWith('Your website goes live on 15 October.');
    expect(onSearch).toHaveBeenCalledWith('Your website goes live on 15 October.');
    expect(apiPost).not.toHaveBeenCalled();
  });

  it('says when the workspace has no AI connection, and offers nothing that would fail', async () => {
    vi.mocked(apiGet).mockResolvedValue({ ...INFO, available: false } as never);
    mount();
    await screen.findByText('No AI connection is configured for this workspace yet.');
    expect((screen.getByRole('button', { name: 'Rewrite' }) as HTMLButtonElement).disabled).toBe(true);
  });
});
