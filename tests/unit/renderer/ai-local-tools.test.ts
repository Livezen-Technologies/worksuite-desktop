import { describe, expect, it, vi } from 'vitest';
import type * as CoreApi from '../../../src/core/api';

vi.mock('../../../src/core/bridge', () => ({ call: vi.fn(), on: () => () => undefined, errorMessage: (e: unknown) => String(e), hasDesktop: () => true }));
vi.mock('../../../src/core/api', async (orig) => ({ ...(await orig<typeof CoreApi>()), apiGet: vi.fn(), apiPost: vi.fn(), apiPut: vi.fn() }));
const answers = vi.hoisted(() => [] as string[]);
vi.mock('../../../src/core/local-ai', () => ({
  askLocal: vi.fn(() => ({ done: Promise.resolve({ text: answers.shift() ?? '', cancelled: false, tokens: 1, ms: 1 }), cancel: () => undefined })),
}));

import { apiGet, apiPost } from '../../../src/core/api';
import { createAskSession } from '../../../src/modules/ai/session';
import { effective, fetchLocalTools, LOCAL_READS_ONLY, toolAllowed, type AiTool, type OrgAccess } from '../../../src/modules/ai/tools';

const tool: AiTool = { name: 'billing.create_invoice', module: 'billing', kind: 'write', label: 'New invoice', description: 'Prepares an invoice', parameters: {} };

describe('the assistant session with Local AI and module functions (worksuite-desktop#51)', () => {
  it('runs the function on WorkSuite, as the person, and lands its draft as a card to confirm', async () => {
    answers.push('<call>{"name":"billing.create_invoice","arguments":{"customer":"Acme","amount":1200}}</call>', 'The invoice for Acme is ready — review it below.');
    const draft = { id: 31, status: 'awaiting_confirmation', preview: { title: 'Invoice for Acme', lines: [], warnings: [] } };
    vi.mocked(apiPost).mockResolvedValue({ ok: true, pending_action: draft, links: [{ label: 'Acme', url: '/billing?customer=4' }] } as never);
    const s = createAskSession();
    s.store.set({ text: 'Create an invoice for Acme, Rs 1,200' });
    await s.send({ surface: 'assistant.panel', refs: [], local: true, online: false, localTools: { tools: [tool], allow: () => null, off: [] } });
    expect(vi.mocked(apiPost)).toHaveBeenCalledWith('/api/ai/tools/billing.create_invoice/run', { arguments: { customer: 'Acme', amount: 1200 }, engine: 'local' });
    const answer = s.store.get().entries.at(-1)!;
    expect(answer.local).toBe(true);
    expect(answer.text).toBe('The invoice for Acme is ready — review it below.');
    expect(answer.turn?.pending_actions).toEqual([draft]);
    expect(answer.turn?.sources[0]).toMatchObject({ title: 'Acme', url: '/billing?customer=4' });
    expect(s.store.get().busy).toBe(false);
  });

  it('sends WorkSuite AI the modules the person switched off', async () => {
    vi.mocked(apiPost).mockResolvedValue({ conversation_id: 1, ok: true, reply: 'Hi', error: null, sources: [], tool_runs: [] } as never);
    const s = createAskSession();
    s.store.set({ text: 'Hello' });
    await s.send({ surface: 'assistant.panel', refs: [], local: false, online: true, moduleAccess: { read: ['crm'], write: ['crm', 'sales'] } });
    expect(vi.mocked(apiPost)).toHaveBeenLastCalledWith('/api/ai/assist/chat', expect.objectContaining({ module_access: { off_read: ['crm'], off_write: ['crm', 'sales'] } }));
  });
});

describe('Local AI reads only unless the server allows changes (G-01, Q-03)', () => {
  const org = (local_writes?: boolean): OrgAccess => ({
    can_manage: false,
    local_writes,
    modules: [{ key: 'billing', label: 'Invoices', supports: { read: true, write: true }, worksuite: { read: true, write: true }, local: { read: true, write: true } }],
  });
  const read: AiTool = { ...tool, name: 'billing.invoices', kind: 'read' };

  it('refuses a change from Local AI while local_writes is off, and allows reads', () => {
    expect(toolAllowed(tool, org(false), undefined)).toBe(LOCAL_READS_ONLY);
    expect(toolAllowed(read, org(false), undefined)).toBeNull();
    expect(effective(org(false).modules[0]!, 'worksuite', undefined, false).write).toBe(true);
  });

  it('allows a change when the server switched local writes on', () => {
    expect(toolAllowed(tool, org(true), undefined)).toBeNull();
  });

  it('tells the model only of reads unless the server says local_writes', async () => {
    vi.mocked(apiGet).mockResolvedValueOnce({ tools: [tool, read], engine: 'local', local_writes: false } as never);
    const tools = await fetchLocalTools();
    expect(tools.map((t) => t.name)).toEqual(['billing.invoices']);
  });
});
