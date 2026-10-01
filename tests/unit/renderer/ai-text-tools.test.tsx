// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as CoreApi from '../../../src/core/api';
import type * as LocalAi from '../../../src/core/local-ai';

vi.mock('../../../src/core/bridge', () => ({ call: vi.fn(async () => null), on: () => () => undefined, errorMessage: (e: unknown) => String(e), hasDesktop: () => true, isMac: false }));
vi.mock('../../../src/core/api', async (orig) => ({ ...(await orig<typeof CoreApi>()), apiGet: vi.fn(), apiPost: vi.fn() }));
const local = vi.hoisted(() => ({ ready: true, answers: [] as Array<string | Error> }));
vi.mock('../../../src/core/local-ai', async (orig) => ({
  ...(await orig<typeof LocalAi>()),
  useLocalModels: () => ({ isLoading: false, data: local.ready ? [{ isDefault: true, state: 'installed', readiness: 'ready' }] : [] }),
  askLocal: vi.fn((_m: unknown, onText: (t: string) => void) => {
    const a = local.answers.shift() ?? '';
    if (typeof a === 'string') onText(a);
    return { done: a instanceof Error ? Promise.reject(a) : Promise.resolve({ text: a, cancelled: false, tokens: 1, ms: 1 }), cancel: () => undefined };
  }),
}));

import { apiGet, apiPost } from '../../../src/core/api';
import { askLocal } from '../../../src/core/local-ai';
import { AiTextDialog } from '../../../src/modules/ai/AiTextDialog';
import { cleanAnswer, localPrompt, onlineText, parseMinutes, runText } from '../../../src/modules/ai/textTools';
import { joinQuote, splitQuote, unquote } from '../../../src/modules/mail/MailPage';
import { minutesMaterial } from '../../../src/modules/meetings/MeetingDetail';
import type { Detail } from '../../../src/modules/meetings/api';

describe('AI text tools: local first, online when it must (worksuite-desktop#53)', () => {
  beforeEach(() => {
    local.answers = [];
    vi.mocked(apiPost).mockReset();
    vi.mocked(askLocal).mockClear();
  });

  it('asks the model on this computer with the tool\'s instruction, and never goes online when it answers', async () => {
    local.answers.push('Here is the rewritten text:\n\nThanks — I will send it today.');
    const online = vi.fn();
    const r = await runText('improve', 'thx will send it tday', { local: true, online: true, onlineFn: online }).done;
    expect(r).toEqual({ text: 'Thanks — I will send it today.', engine: 'local' });
    expect(online).not.toHaveBeenCalled();
    expect(localPrompt('grammar', 'x')[0]!.content).toMatch(/Correct the spelling, grammar and punctuation/);
  });

  it('falls back online when the local model fails and fallback is allowed', async () => {
    local.answers.push(new Error('The model stopped.'));
    const online = vi.fn(async () => 'From online AI.');
    expect(await runText('summarize', 'Asha: hi', { local: true, online: true, onlineFn: online }).done).toEqual({ text: 'From online AI.', engine: 'online' });
  });

  it('does not send anything online when fallback is off, and says so', async () => {
    local.answers.push(new Error('The model stopped.'));
    const online = vi.fn();
    await expect(runText('reply', 'Asha: hi', { local: true, online: false, onlineFn: online }).done).rejects.toThrow(/Online fallback is not available, so nothing was sent/);
    expect(online).not.toHaveBeenCalled();
    await expect(runText('reply', '   ', { local: true, online: true }).done).rejects.toThrow('There is nothing to work on yet.');
  });

  it('online, uses the writing assistant\'s own action when the server has it, the AI Assistant otherwise', async () => {
    vi.mocked(apiPost).mockResolvedValueOnce({ text: 'Shorter.' } as never);
    const writer = { available: true, actions: [{ key: 'shorten', label: 'Shorten', needs_text: true }], tones: [], languages: [] };
    expect(await onlineText('shorten', 'A long text.', writer)).toBe('Shorter.');
    expect(vi.mocked(apiPost)).toHaveBeenLastCalledWith('/api/ai/write', expect.objectContaining({ action: 'shorten', text: 'A long text.' }));
    vi.mocked(apiPost).mockResolvedValueOnce({ ok: true, reply: '- Agreed the budget', conversation_id: 1, error: null, sources: [], tool_runs: [] } as never);
    expect(await onlineText('summarize', 'Asha: budget ok?', writer)).toBe('- Agreed the budget');
    expect(vi.mocked(apiPost)).toHaveBeenLastCalledWith('/api/ai/assist/chat', expect.objectContaining({ text: expect.stringContaining('Summarise the conversation') }));
  });

  it('reads drafted minutes into summary, decisions and actions', () => {
    const m = parseMinutes('SUMMARY:\nWe reviewed Q3.\n\nDECISIONS:\n- Budget approved\n- Hire one designer\nACTIONS:\n- Asha: send the plan by Friday\n- None');
    expect(m).toEqual({ summary: 'We reviewed Q3.', decisions: ['Budget approved', 'Hire one designer'], actions: ['Asha: send the plan by Friday'] });
    expect(parseMinutes('Just a paragraph.')).toEqual({ summary: 'Just a paragraph.', decisions: [], actions: [] });
    expect(parseMinutes('**SUMMARY:** Quick sync.\n**DECISIONS:**\n- None\n**ACTIONS:**\n1. Ben to call Acme').actions).toEqual(['Ben to call Acme']);
    expect(cleanAnswer('"Sure, see you then."')).toBe('Sure, see you then.');
  });
});

describe('Mail: what the AI works on', () => {
  it('keeps the quoted email out of what it rewrites, and puts it back after', () => {
    const quote = '\n\nOn 1 Oct Asha wrote:\n> Can you send the plan?\n> Thanks';
    expect(splitQuote(`Sure${quote}`, quote)).toEqual(['Sure', quote]);
    expect(splitQuote('Sure\n\nOn 2 Oct Ben wrote:\n> hi')).toEqual(['Sure', '\n\nOn 2 Oct Ben wrote:\n> hi']);
    expect(joinQuote('Sure, attached.  ', quote)).toBe(`Sure, attached.${quote}`);
    expect(unquote(quote)).toBe('On 1 Oct Asha wrote:\nCan you send the plan?\nThanks');
  });
});

describe('Meetings: what minutes are drafted from', () => {
  it('the meeting, who came, the agenda with its notes, what is written, and the chat', () => {
    const d = {
      meeting: { title: 'Q3 review', start_at: '2026-10-01T09:00:00Z', description: 'Plan Q4' },
      participants: [{ name: 'Asha', attendance: 'present' }, { name: 'Ben', attendance: 'absent' }],
      agenda: [{ title: 'Budget', presenter: 'Asha', notes: 'Approved at 1.2M' }],
      action_items: [{ title: 'Send plan', assignee: 'Asha' }],
    } as unknown as Detail;
    const text = minutesMaterial(d, { summary: '', decisions: 'Budget approved', notes: '' }, 'Ben: I will join late');
    expect(text).toContain('Meeting: Q3 review');
    expect(text).toContain('Participants: Asha');
    expect(text).toContain('1. Budget (Asha)\n   Notes: Approved at 1.2M');
    expect(text).toContain('Decisions noted so far:\nBudget approved');
    expect(text).toContain('Actions already recorded:\n- Send plan (Asha)');
    expect(text).toContain("The meeting's chat:\nBen: I will join late");
  });
});

describe('the AI result dialog', () => {
  beforeEach(() => {
    local.answers = [];
    local.ready = true;
    vi.mocked(apiGet).mockReset();
    vi.mocked(apiGet).mockResolvedValue({ enabled: true, reason: null, available: false, actions: [], tones: [], languages: [] } as never);
  });
  afterEach(cleanup);
  const mount = (run = vi.fn()) => {
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <AiTextDialog title="Improve writing" task="improve" input={() => 'thx'} actions={[{ label: 'Replace my message', primary: true, run }]} onClose={() => undefined} />
      </QueryClientProvider>,
    );
    return run;
  };

  it('says it is processing locally, shows the result to change, and uses it only when asked', async () => {
    local.answers.push('Thank you!');
    const run = mount();
    expect(screen.getByTestId('ai-where').textContent).toContain('Processing locally');
    const box = (await screen.findByDisplayValue('Thank you!')) as HTMLTextAreaElement;
    expect(run).not.toHaveBeenCalled();
    fireEvent.change(box, { target: { value: 'Thank you so much!' } });
    fireEvent.click(screen.getByRole('button', { name: 'Replace my message' }));
    await waitFor(() => expect(run).toHaveBeenCalledWith('Thank you so much!'));
  });

  it('shows the error with Try again, which asks again', async () => {
    local.answers.push(new Error('The model stopped.'), 'Thanks!');
    vi.mocked(apiGet).mockResolvedValue({ enabled: false, reason: 'Off', available: false, actions: [], tones: [], languages: [] } as never);
    mount();
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(/The model stopped/);
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByDisplayValue('Thanks!')).toBeTruthy();
  });
});
