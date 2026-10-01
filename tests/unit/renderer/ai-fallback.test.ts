import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as CoreApi from '../../../src/core/api';

vi.mock('../../../src/core/bridge', () => ({ call: vi.fn(), on: () => () => undefined, errorMessage: (e: unknown) => String(e), hasDesktop: () => true }));
vi.mock('../../../src/core/api', async (orig) => ({ ...(await orig<typeof CoreApi>()), apiGet: vi.fn(), apiPost: vi.fn(), apiPut: vi.fn() }));
const answers = vi.hoisted(() => [] as Array<string | Error>);
vi.mock('../../../src/core/local-ai', () => ({
  askLocal: vi.fn(() => {
    const a = answers.shift() ?? '';
    return { done: a instanceof Error ? Promise.reject(a) : Promise.resolve({ text: a, cancelled: false, tokens: 1, ms: 1 }), cancel: () => undefined };
  }),
}));

import { apiPost } from '../../../src/core/api';
import { askLocal } from '../../../src/core/local-ai';
import { carriedOver, createAskSession, type AskEntry, type SendOptions } from '../../../src/modules/ai/session';
import type { AiTool } from '../../../src/modules/ai/tools';

const ONLINE = { conversation_id: 9, ok: true, reply: 'From online AI.', error: null, sources: [], tool_runs: [] };
const base: SendOptions = { surface: 'assistant.panel', refs: [], local: true, online: true, onlineWhy: null };
const chats = () => vi.mocked(apiPost).mock.calls.filter(([p]) => p === '/api/ai/assist/chat');

async function ask(s: ReturnType<typeof createAskSession>, text: string, opts: Partial<SendOptions> = {}) {
  s.store.set({ text });
  await s.send({ ...base, ...opts });
  return s.store.get().entries.at(-1)!;
}

describe('one assistant: this computer first, online when it must (worksuite-desktop#53)', () => {
  beforeEach(() => {
    answers.length = 0;
    vi.mocked(apiPost).mockReset();
    vi.mocked(askLocal).mockClear();
  });

  it('answers on this computer when it can, and never goes online then', async () => {
    answers.push('Paris.');
    const a = await ask(createAskSession(), 'Capital of France?');
    expect(a).toMatchObject({ text: 'Paris.', local: true });
    expect(chats()).toEqual([]);
  });

  it('falls back online when the local model fails, keeping what was said on this computer', async () => {
    vi.mocked(apiPost).mockResolvedValue(ONLINE as never);
    const s = createAskSession();
    answers.push('Hi Nimal.');
    await ask(s, 'My name is Nimal.');
    answers.push(new Error('The model stopped answering.'));
    const a = await ask(s, 'What is my name?');
    expect(a).toMatchObject({ text: 'From online AI.', fallback: 'The model on this computer could not answer, so online AI did.' });
    expect(a.local).toBeUndefined();
    const sent = (chats()[0]![1] as { text: string }).text;
    expect(sent).toBe('Earlier in this conversation:\nMe: My name is Nimal.\nAssistant: Hi Nimal.\n\nWhat is my name?');
    expect(s.store.get().conversationId).toBe(9);

    // Once online AI has the conversation, only what came after its last answer is carried again.
    answers.push('Blue.');
    await ask(s, 'Favourite colour? Say blue.');
    answers.push(new Error('stopped'));
    await ask(s, 'And again?');
    expect((chats()[1]![1] as { text: string }).text).toBe('Earlier in this conversation:\nMe: Favourite colour? Say blue.\nAssistant: Blue.\n\nAnd again?');
  });

  it('with online fallback off, says why instead of going online', async () => {
    answers.push(new Error('The model stopped answering.'));
    const a = await ask(createAskSession(), 'Hello', { online: false, onlineWhy: 'Online fallback is off in Settings › AI Assistant.' });
    expect(a).toMatchObject({ error: true, text: 'The model stopped answering. Online fallback is off in Settings › AI Assistant.' });
    expect(a.retry).toBeTruthy();
    expect(chats()).toEqual([]);
  });

  it('does not repeat online what already ran in WorkSuite before the local model failed', async () => {
    const tool: AiTool = { name: 'tasks.create', module: 'tasks', kind: 'write', label: 'New task', description: 'Prepares a task', parameters: {} };
    vi.mocked(apiPost).mockResolvedValue({ ok: true, pending_action: { id: 4, preview: { title: 'Task', lines: [], warnings: [] } } } as never);
    answers.push('<call>{"name":"tasks.create","arguments":{"title":"Call Acme"}}</call>', new Error('The model stopped answering.'));
    const a = await ask(createAskSession(), 'Make a task to call Acme', { localTools: { tools: [tool], allow: () => null, off: [] } });
    expect(a.error).toBe(true);
    expect(a.text).toMatch(/not repeated online/);
    expect(chats()).toEqual([]);
  });

  it('a module that is off is an answer on this computer, not a reason to go online', async () => {
    const tool: AiTool = { name: 'crm.leads', module: 'crm', kind: 'read', label: 'Leads', description: 'Leads', parameters: {} };
    answers.push('<call>{"name":"crm.leads","arguments":{}}</call>', 'CRM is turned off for Local AI.');
    const a = await ask(createAskSession(), 'My leads?', { localTools: { tools: [tool], allow: () => 'You turned CRM off for Local AI.', off: [] } });
    expect(a).toMatchObject({ local: true, text: 'CRM is turned off for Local AI.' });
    expect(chats()).toEqual([]);
  });

  it('files and the tab go to online AI, which says so', async () => {
    vi.mocked(apiPost).mockResolvedValue(ONLINE as never);
    const a = await ask(createAskSession(), 'Summarise this task', { refs: ['task:12'] });
    expect(vi.mocked(askLocal)).not.toHaveBeenCalled();
    expect(a.fallback).toBe('Files and this tab are read by WorkSuite AI, online.');
    expect(chats()[0]![1]).toMatchObject({ refs: ['task:12'] });
  });

  it('with no local model and no online AI, explains and offers Local AI\'s setup', async () => {
    const a = await ask(createAskSession(), 'Hello', { local: false, online: false, onlineWhy: 'You are offline, so online AI cannot help right now.' });
    expect(a).toMatchObject({ error: true, needsSetup: true, text: 'No model on this computer can answer yet. You are offline, so online AI cannot help right now.' });
  });

  it('with no local model, online AI answers as before', async () => {
    vi.mocked(apiPost).mockResolvedValue(ONLINE as never);
    const a = await ask(createAskSession(), 'Hello', { local: false });
    expect(a).toMatchObject({ text: 'From online AI.' });
    expect(a.fallback).toBeUndefined();
  });

  it('carries over only what came after online AI last answered', () => {
    const e = (role: 'user' | 'assistant', text: string, extra: Partial<AskEntry> = {}): AskEntry => ({ role, text, ...extra });
    expect(carriedOver([])).toBe('');
    expect(carriedOver([e('user', 'a'), e('assistant', 'b')])).toBe(''); // online AI already has its own answers
    expect(carriedOver([e('user', 'a'), e('assistant', 'b'), e('user', 'c'), e('assistant', 'd', { local: true })])).toBe('Earlier in this conversation:\nMe: c\nAssistant: d\n\n');
    expect(carriedOver([e('user', 'a'), e('assistant', 'b', { local: true }), e('user', 'x', { error: true })])).toContain('Assistant: b');
  });
});
