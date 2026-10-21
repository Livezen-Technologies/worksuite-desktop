// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as CoreApi from '../../../src/core/api';

vi.mock('../../../src/core/bridge', () => ({ call: vi.fn(), on: () => () => undefined, hasDesktop: () => false, errorMessage: (e: unknown) => String(e), isMac: true }));
vi.mock('../../../src/core/api', async (orig) => ({ ...(await orig<typeof CoreApi>()), apiGet: vi.fn(), apiPost: vi.fn(), apiPut: vi.fn() }));
vi.mock('../../../src/core/tabs', async () => {
  const { createStore } = await import('../../../src/core/store');
  return { navigate: vi.fn(), tabsStore: createStore({ tabs: [], activeId: null }) };
});

import { apiGet, apiPost } from '../../../src/core/api';
import { call } from '../../../src/core/bridge';
import { ActionCard } from '../../../src/modules/ai/ActionCard';
import { AskPanel } from '../../../src/modules/ai/AskPanel';
import { refForRoute, type PendingAction } from '../../../src/modules/ai/assistant';

/**
 * The assistant on the desktop (WS-AI-SRS-001 FR-DSK-AI-01…04): the record a
 * tab shows is the only thing it reads from the tab, a selection travels only
 * with a question, and a card is confirmed through the main process — or, in
 * Quick Ask, not at all.
 */

const soon = (s: number) => new Date(Date.now() + s * 1000).toISOString();

function card(over: Partial<PendingAction> = {}): PendingAction {
  return {
    id: 7, slug: 'task_create', name: 'Create a task', risk: 'R1', status: 'awaiting_confirmation', version: 1,
    preview: { title: 'Create task: Send the quote', lines: ['Assigned to you'], warnings: [] },
    external_recipients: [], tainted: false, expires_at: soon(900), nonce: 'abcdef0123456789', arguments: {}, ...over,
  };
}

function wrap(ui: React.ReactNode) {
  return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>);
}

afterEach(() => cleanup());

describe('which record a tab gives the assistant', () => {
  it('is the one record the tab shows, as the web names it', () => {
    expect(refForRoute('/tasks?task=12')).toBe('task:12');
    expect(refForRoute('/notes?note=3&x=1')).toBe('note:3');
    expect(refForRoute('/chat?room=9')).toBe('chat_room:9');
    expect(refForRoute('/crm?deal=44')).toBe('crm_deal:44');
    expect(refForRoute('/files?file=5')).toBe('file:5');
  });

  it('is nothing for a list, a new-record form or anything that is not an id', () => {
    expect(refForRoute('/tasks')).toBeNull();
    expect(refForRoute('/tasks?new=1&title=x')).toBeNull();
    expect(refForRoute('/tasks?task=12;DROP')).toBeNull();
    expect(refForRoute('/mail?compose=1')).toBeNull();
    expect(refForRoute(null)).toBeNull();
  });
});

describe('the confirmation card', () => {
  beforeEach(() => vi.mocked(call).mockReset());

  it('confirms through the main process with the nonce it was shown', async () => {
    vi.mocked(call).mockResolvedValue(card({ status: 'succeeded', nonce: null }) as never);
    wrap(<ActionCard action={card()} />);

    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Confirm' })));

    expect(call).toHaveBeenCalledWith('ai:confirm', { id: 7, nonce: 'abcdef0123456789' });
    expect(apiPost).not.toHaveBeenCalledWith('/api/ai/pending/7/confirm', expect.anything());
    expect(screen.getAllByText('Done').length).toBeGreaterThan(0);
  });

  it('asks for the typed phrase and an authenticator code before a level 5 change (Q-01)', async () => {
    vi.mocked(call).mockResolvedValue(card({ status: 'succeeded', nonce: null }) as never);
    wrap(<ActionCard action={card({ level: 5, level_label: 'Delete', reversible: false, confirm: { step_up: true, phrase: 'DELETE' } })} />);

    const go = screen.getByRole('button', { name: 'Confirm' }) as HTMLButtonElement;
    expect(go.disabled).toBe(true);
    expect(screen.getByText('L5 · Delete')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Confirmation phrase'), { target: { value: 'delete ' } });
    expect(go.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Verification code'), { target: { value: '12 34 56' } });
    expect(go.disabled).toBe(false);
    await act(async () => fireEvent.click(go));
    expect(call).toHaveBeenCalledWith('ai:confirm', { id: 7, nonce: 'abcdef0123456789', phrase: 'delete ', stepUpCode: '123456' });
  });

  it('in Quick Ask, sends the person to the main window instead of confirming', () => {
    const elsewhere = vi.fn();
    wrap(<ActionCard action={card({ risk: 'R2', external_recipients: ['buyer@abc.lk'] })} elsewhere={elsewhere} />);

    expect(screen.queryByRole('button', { name: /Confirm/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Review in WorkSuite' }));
    expect(elsewhere).toHaveBeenCalled();
    expect(call).not.toHaveBeenCalled();
    expect(screen.getByText('buyer@abc.lk')).toBeTruthy();
  });
});

describe('asking', () => {
  beforeEach(() => {
    vi.mocked(apiGet).mockReset().mockResolvedValue({ enabled: true, reason: null } as never);
    vi.mocked(apiPost).mockReset().mockResolvedValue({ conversation_id: 4, ok: true, reply: 'It is due Friday.', error: null, sources: [], tool_runs: [] } as never);
    vi.mocked(call).mockReset().mockResolvedValue({ enabled: true, quickAsk: true, insert: true, localFiles: true, note: null } as never);
  });

  it('sends the tab\'s record, unless the person leaves it out', async () => {
    wrap(<AskPanel surface="assistant.panel" tabRef="task:12" tabTitle="Send the quote" />);

    fireEvent.change(screen.getByLabelText('Your question'), { target: { value: 'When is it due?' } });
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Send' })));
    expect(apiPost).toHaveBeenLastCalledWith('/api/ai/assist/chat', expect.objectContaining({ text: 'When is it due?', surface: 'assistant.panel', refs: ['task:12'] }));
    expect(await screen.findByText('It is due Friday.')).toBeTruthy();

    fireEvent.click(screen.getByLabelText(/Use this tab/));
    fireEvent.change(screen.getByLabelText('Your question'), { target: { value: 'And the next one?' } });
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Send' })));
    expect(apiPost).toHaveBeenLastCalledWith('/api/ai/assist/chat', expect.objectContaining({ refs: [], conversation_id: 4 }));
  });

  it('sends Quick Ask\'s selection with the first question only, and offers Insert once there is an answer', async () => {
    const run = vi.fn();
    wrap(<AskPanel surface="desktop.quick" selection="Kandy roof: LKR 240,000" insert={{ label: 'Insert into Word', run }} />);

    expect(screen.queryByRole('button', { name: 'Insert into Word' })).toBeNull();
    fireEvent.change(screen.getByLabelText('Your question'), { target: { value: 'Is this within budget?' } });
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Send' })));

    const body = vi.mocked(apiPost).mock.calls.at(-1)?.[1] as { text: string; surface: string };
    expect(body.surface).toBe('desktop.quick');
    expect(body.text).toContain('Kandy roof: LKR 240,000');

    fireEvent.click(await screen.findByRole('button', { name: 'Insert into Word' }));
    expect(run).toHaveBeenCalledWith('It is due Friday.');
  });
});
