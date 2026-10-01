// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as CoreApi from '../../../src/core/api';
import type * as LocalAi from '../../../src/core/local-ai';

vi.mock('../../../src/core/bridge', () => ({
  call: vi.fn(async (channel: string) => (channel === 'offline:getDraft' ? null : undefined)),
  on: () => () => undefined,
  errorMessage: (e: unknown) => String(e),
  hasDesktop: () => true,
  isMac: false,
  registerDropped: vi.fn(async () => []),
}));
vi.mock('../../../src/core/api', async (orig) => ({ ...(await orig<typeof CoreApi>()), apiGet: vi.fn(), apiPost: vi.fn(async () => ({})), request: vi.fn(async () => ({ data: {} })) }));
vi.mock('../../../src/core/toasts', () => ({ toast: vi.fn() }));
vi.mock('../../../src/core/app-state', async () => {
  const { createStore } = await import('../../../src/core/store');
  return { app: createStore({ apps: [], transfers: [], bootstrap: { permissions: [], user: { id: 7, name: 'Nimal' } }, auth: { server: { origin: 'https://app.worksuite.lk' } } }) };
});
const local = vi.hoisted(() => ({ ready: true, answers: [] as Array<string | Error> }));
vi.mock('../../../src/core/local-ai', async (orig) => ({
  ...(await orig<typeof LocalAi>()),
  useLocalModels: () => ({ isLoading: false, data: local.ready ? [{ isDefault: true, state: 'installed', readiness: 'ready' }] : [] }),
  askLocal: vi.fn(() => {
    const a = local.answers.shift() ?? '';
    return { done: a instanceof Error ? Promise.reject(a) : Promise.resolve({ text: a, cancelled: false, tokens: 1, ms: 1 }), cancel: () => undefined };
  }),
}));

import { ApiError, apiGet, apiPost } from '../../../src/core/api';
import { askLocal } from '../../../src/core/local-ai';
import { Composer } from '../../../src/modules/chat/Composer';
import { matchActions, parseSuggestions, suggestEngine, transcript, type Turn } from '../../../src/modules/chat/replies';

const saved = [
  { id: 1, shortcut: 'thanks', title: 'Thank you', body: 'Thank you, I will look into it today.' },
  { id: 2, shortcut: 'ooo', title: 'Out of office', body: 'I am out of the office until Monday.' },
];

describe('the "/" menu helpers (worksuite-desktop#32)', () => {
  it('finds the actions by their words', () => {
    expect(matchActions('').map((a) => a.key)).toEqual(['saved', 'suggest']);
    expect(matchActions('sug').map((a) => a.key)).toEqual(['suggest']);
    expect(matchActions('load').map((a) => a.key)).toEqual(['saved']);
    expect(matchActions('xyz')).toEqual([]);
  });

  it('reads three replies out of a model answer', () => {
    expect(parseSuggestions('1. Sure, on it.\n2. "Can we talk tomorrow?"\n3) Thanks!\n')).toEqual(['Sure, on it.', 'Can we talk tomorrow?', 'Thanks!']);
    expect(parseSuggestions('Here are some:\n- Yes\n- No\n- Maybe\n- Later')).toEqual(['Yes', 'No', 'Maybe']);
    expect(parseSuggestions('Just one idea.')).toEqual(['Just one idea.']);
    expect(parseSuggestions('')).toEqual([]);
  });

  it('keeps the newest messages, says whose is whose, and skips empty ones', () => {
    const turns: Turn[] = [
      { mine: false, name: 'Amaya', text: 'Is the report ready?' },
      { mine: true, name: 'Nimal', text: '' },
      { mine: true, name: 'Nimal', text: 'Almost.' },
    ];
    expect(transcript(turns)).toBe('Amaya: Is the report ready?\nNimal (me): Almost.');
    expect(transcript(turns, 1)).toBe('Nimal (me): Almost.');
  });

  it('uses the model on this computer first, then the workspace assistant when it offers replies', () => {
    const ready = [{ isDefault: true, state: 'installed', readiness: 'ready' }] as never;
    const writer = { available: true, actions: [{ key: 'reply', label: 'Reply', needs_text: true }], tones: [], languages: [] };
    expect(suggestEngine(ready, writer)).toBe('local');
    expect(suggestEngine([], writer)).toBe('server');
    expect(suggestEngine([], { ...writer, actions: [] })).toBeNull();
  });
});

function mount() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.setQueryData(['chat', 'messages', '12'], {
    pages: [{ messages: [{ id: 1, sender_id: 3, sender_name: 'Amaya', message: 'Can you send the report?', deleted: false }, { id: 2, sender_id: 7, sender_name: 'Nimal', message: 'Which one?', deleted: false }] }],
    pageParams: [null],
  });
  render(
    <QueryClientProvider client={qc}>
      <Composer roomId="12" roomName="Amaya" group={false} reply={null} onClearReply={() => undefined} />
    </QueryClientProvider>,
  );
  return screen.getByRole('textbox', { name: 'Message' }) as HTMLTextAreaElement;
}
const type = (box: HTMLTextAreaElement, value: string) => fireEvent.change(box, { target: { value, selectionStart: value.length } });
const sentMessages = () => vi.mocked(apiPost).mock.calls.filter(([p]) => String(p).includes('/messages'));

describe('the "/" menu in the chat composer (worksuite-desktop#32)', () => {
  beforeEach(() => {
    vi.mocked(apiGet).mockReset();
    vi.mocked(apiGet).mockImplementation(async (path: string) => (path === '/api/chat/saved-replies' ? { replies: saved } : {}) as never);
    vi.mocked(apiPost).mockClear();
    vi.mocked(askLocal).mockClear();
    local.ready = true;
    local.answers = [];
  });
  afterEach(() => cleanup());

  it('"/" shows both actions above the box; Esc closes it', () => {
    const box = mount();
    type(box, '/');
    const menu = screen.getByRole('listbox', { name: 'Quick actions' });
    expect([...menu.querySelectorAll('[role="option"] b')].map((b) => b.textContent)).toEqual(['Load saved replies', 'Suggest reply']);
    fireEvent.keyDown(box, { key: 'Escape' });
    expect(screen.queryByRole('listbox', { name: 'Quick actions' })).toBeNull();
  });

  it('Load saved replies: search, then Enter puts the reply in the box without sending it', async () => {
    const box = mount();
    type(box, 'Hi /');
    fireEvent.keyDown(box, { key: 'Enter' });
    const search = await screen.findByRole('textbox', { name: 'Search saved replies' });
    await screen.findByText('Out of office');
    fireEvent.change(search, { target: { value: 'office' } });
    expect(screen.queryByText('Thank you')).toBeNull();
    fireEvent.keyDown(search, { key: 'Enter' });
    expect(box.value).toBe('Hi I am out of the office until Monday.');
    expect(screen.queryByRole('listbox', { name: 'Saved replies' })).toBeNull();
    expect(sentMessages()).toEqual([]);
    expect(vi.mocked(apiGet)).toHaveBeenCalledWith('/api/chat/saved-replies', undefined, expect.anything());
  });

  it('Load saved replies: an empty state when the server has none, or has no such list yet', async () => {
    vi.mocked(apiGet).mockImplementation(async () => {
      throw new ApiError(404, 'Not found', 'NOT_FOUND');
    });
    const box = mount();
    type(box, '/load');
    fireEvent.keyDown(box, { key: 'Enter' });
    expect(await screen.findByText('No saved replies yet')).toBeTruthy();
    expect(screen.getByText(/not set up on your WorkSuite server yet/)).toBeTruthy();
  });

  it('Suggest reply: thinks, shows the ideas, and a click inserts one to edit', async () => {
    local.answers = ['1. Sure, sending it now.\n2. The monthly one?\n3. Give me ten minutes.'];
    const box = mount();
    type(box, '/sug');
    fireEvent.keyDown(box, { key: 'Enter' });
    expect(screen.getByRole('status').textContent).toMatch(/Thinking of replies/);
    const idea = await screen.findByRole('option', { name: 'The monthly one?' });
    // The model was given the conversation, with whose message is whose.
    const asked = vi.mocked(askLocal).mock.calls[0]![0];
    expect(asked[1]!.content).toContain('Amaya: Can you send the report?\nNimal (me): Which one?');
    fireEvent.click(idea);
    expect(box.value).toBe('The monthly one?');
    expect(sentMessages()).toEqual([]);
  });

  it('Suggest reply: says what went wrong, and Retry asks again', async () => {
    local.answers = [new Error('The model stopped.'), '1. Yes.\n2. No.'];
    const box = mount();
    type(box, '/suggest');
    fireEvent.keyDown(box, { key: 'Enter' });
    expect((await screen.findByRole('alert')).textContent).toContain('The model stopped.');
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Retry' })));
    await waitFor(() => expect(screen.getByRole('option', { name: 'Yes.' })).toBeTruthy());
  });

  it('Suggest reply: with no AI anywhere it says how to get one', async () => {
    local.ready = false;
    vi.mocked(apiGet).mockImplementation(async (path: string) => (path === '/api/ai/write/actions' ? { available: false, actions: [], tones: [], languages: [] } : {}) as never);
    const box = mount();
    type(box, '/suggest');
    fireEvent.keyDown(box, { key: 'Enter' });
    expect((await screen.findByRole('alert')).textContent).toMatch(/Set up Local AI/);
  });

  it('a "/" that matches nothing leaves the box alone', () => {
    const box = mount();
    type(box, 'see /usr');
    expect(screen.queryByRole('listbox', { name: 'Quick actions' })).toBeNull();
    fireEvent.keyDown(box, { key: 'ArrowDown' });
    expect(box.value).toBe('see /usr');
  });
});
