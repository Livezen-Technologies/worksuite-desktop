// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AiModuleAccessPrefs } from '@shared/types';
import type * as CoreApi from '../../../src/core/api';

vi.mock('../../../src/core/bridge', () => ({ call: vi.fn(), on: () => () => undefined, errorMessage: (e: unknown) => String(e), hasDesktop: () => true, isMac: false }));
vi.mock('../../../src/core/api', async (orig) => ({ ...(await orig<typeof CoreApi>()), apiGet: vi.fn(), apiPost: vi.fn(), apiPut: vi.fn() }));
vi.mock('../../../src/core/toasts', () => ({ toast: vi.fn() }));

import { ApiError, apiGet, apiPut } from '../../../src/core/api';
import { ModuleAccess } from '../../../src/modules/ai/ModuleAccess';
import { effective, parseCall, personalOff, runLocalAgent, toolAllowed, toolsSystem, type AiTool, type OrgAccess, type OrgModule, type ToolRun } from '../../../src/modules/ai/tools';
import type { PendingAction } from '../../../src/modules/ai/assistant';

const none: AiModuleAccessPrefs = { worksuite: {}, local: {} };
const sales: OrgModule = { key: 'sales', label: 'Sales', supports: { read: true, write: true }, worksuite: { read: true, write: true }, local: { read: true, write: true } };
const crm: OrgModule = { key: 'crm', label: 'CRM', supports: { read: true, write: false }, worksuite: { read: true, write: false }, local: { read: false, write: false } };
const org: OrgAccess = { modules: [sales, crm], can_manage: false };

const todaySales: AiTool = { name: 'sales.today', module: 'sales', kind: 'read', label: "Today's sales", description: "Today's sales totals", parameters: { type: 'object', properties: {} } };
const newInvoice: AiTool = {
  name: 'billing.create_invoice',
  module: 'billing',
  kind: 'write',
  label: 'New invoice',
  description: 'Prepares an invoice for review',
  parameters: { type: 'object', properties: { customer: { type: 'string' }, amount: { type: 'number' } }, required: ['customer', 'amount'] },
};
const crmLeads: AiTool = { name: 'crm.leads', module: 'crm', kind: 'read', label: 'Leads', description: 'Open leads', parameters: {} };

describe('Module Access rules (worksuite-desktop#51)', () => {
  it('everything the organization allows is on until the person turns it off', () => {
    expect(effective(sales, 'local', none)).toEqual({ read: true, write: true, readWhy: null, writeWhy: null });
    const off = effective(sales, 'local', { worksuite: {}, local: { sales: { read: true, write: false } } });
    expect(off.write).toBe(false);
    expect(off.writeWhy).toMatch(/You turned changes in Sales off for Local AI/);
  });

  it('a person can never turn on what the organization or the module does not allow', () => {
    const e = effective(crm, 'local', { worksuite: {}, local: { crm: { read: true, write: true } } });
    expect(e.read).toBe(false);
    expect(e.readWhy).toMatch(/Your organization has turned reading in CRM off for Local AI/);
    expect(effective(crm, 'worksuite', none).writeWhy).toMatch(/CRM has no changes the assistant can make yet/);
    expect(effective({ ...sales, denied: 'You do not have access to Sales.' }, 'local', none).readWhy).toBe('You do not have access to Sales.');
  });

  it('tells WorkSuite AI only what the person switched off', () => {
    expect(personalOff(none, 'worksuite')).toBeUndefined();
    expect(personalOff({ worksuite: { sales: { read: true, write: false }, crm: { read: false, write: false } }, local: {} }, 'worksuite')).toEqual({ read: ['crm'], write: ['sales', 'crm'] });
  });

  it('checks a Local AI call against the module, with or without an organization setting', () => {
    expect(toolAllowed(todaySales, org, none)).toBeNull();
    expect(toolAllowed(crmLeads, org, none)).toMatch(/organization/);
    expect(toolAllowed(newInvoice, null, { worksuite: {}, local: { billing: { read: true, write: false } } })).toMatch(/You turned changes in Billing off/);
    expect(toolAllowed(newInvoice, null, none)).toBeNull();
  });
});

describe('Local AI calling module functions', () => {
  it('reads a function call out of the answer, and nothing else', () => {
    expect(parseCall('<call>{"name": "sales.today", "arguments": {}}</call>')).toEqual({ name: 'sales.today', arguments: {} });
    expect(parseCall('Sure.\n<call>{"name":"billing.create_invoice","arguments":{"customer":"Acme","amount":1200}}</call>')?.arguments).toEqual({ customer: 'Acme', amount: 1200 });
    expect(parseCall('Sales were good today.')).toBeNull();
    expect(parseCall('<call>{"name": "rm -rf"}</call>')).toBeNull();
    expect(parseCall('<call>not json</call>')).toBeNull();
  });

  it('tells the model the functions, what is off, and that changes are only proposed', () => {
    const s = toolsSystem([todaySales, newInvoice], ['CRM (off)'], 'Thu Oct 01 2026');
    expect(s).toContain('sales.today [reads]');
    expect(s).toContain('billing.create_invoice [prepares a change]');
    expect(s).toContain('customer: string; amount: number');
    expect(s).toContain('CRM (off)');
    expect(s).toMatch(/never that it is done/);
  });

  /** A scripted model: each call to `ask` answers with the next line. */
  const model = (answers: string[]) => {
    const seen: string[][] = [];
    return {
      seen,
      ask: (m: Array<{ role: string; content: string }>) => {
        seen.push(m.map((x) => x.content));
        return { done: Promise.resolve({ text: answers.shift() ?? '', cancelled: false }), cancel: () => undefined };
      },
    };
  };

  it('"How are today\'s sales?" runs the read function and answers from its data, with links', async () => {
    const m = model(['<call>{"name":"sales.today","arguments":{}}</call>', 'Today: 14 orders, Rs 182,000.']);
    const run = vi.fn(async (): Promise<ToolRun> => ({ ok: true, data: { orders: 14, total: 182000 }, links: [{ label: 'Sales today', url: '/sales?view=today' }] }));
    const r = await runLocalAgent({ messages: [{ role: 'user', content: "How are today's sales?" }], tools: [todaySales], allow: () => null, ask: m.ask, onText: () => undefined, onCancelSet: () => undefined, run });
    expect(run).toHaveBeenCalledWith('sales.today', {});
    expect(m.seen[1]!.at(-1)).toContain('"orders":14');
    expect(r.text).toBe('Today: 14 orders, Rs 182,000.');
    expect(r.tools).toEqual([{ name: 'sales.today', label: "Today's sales", ok: true, error: null }]);
    expect(r.sources).toEqual([{ n: 1, kind: 'record', title: 'Sales today', url: '/sales?view=today' }]);
  });

  it('"Create an invoice" asks for what is missing, then returns a draft to confirm — never applied by itself', async () => {
    const draft = { id: 9, preview: { title: 'Invoice for Acme — Rs 1,200', lines: ['Due in 30 days'], warnings: [] }, status: 'awaiting_confirmation' } as unknown as PendingAction;
    const m = model([
      '<call>{"name":"billing.create_invoice","arguments":{"customer":"Acme"}}</call>',
      'How much is the invoice for?',
    ]);
    const run = vi.fn(async (): Promise<ToolRun> => ({ ok: false, missing: [{ name: 'amount', label: 'Amount' }] }));
    const first = await runLocalAgent({ messages: [{ role: 'user', content: 'Create an invoice for Acme' }], tools: [newInvoice], allow: () => null, ask: m.ask, onText: () => undefined, onCancelSet: () => undefined, run });
    expect(m.seen[1]!.at(-1)).toMatch(/these details are needed: Amount/);
    expect(first.text).toBe('How much is the invoice for?');
    expect(first.actions).toEqual([]);

    const m2 = model(['<call>{"name":"billing.create_invoice","arguments":{"customer":"Acme","amount":1200}}</call>', 'The invoice is ready for you to review below.']);
    const second = await runLocalAgent({ messages: [{ role: 'user', content: '1200' }], tools: [newInvoice], allow: () => null, ask: m2.ask, onText: () => undefined, onCancelSet: () => undefined, run: async () => ({ ok: true, pending_action: draft }) });
    expect(m2.seen[1]!.at(-1)).toMatch(/ready for the person to review and confirm \(not applied yet\)/);
    expect(second.actions).toEqual([draft]);
  });

  it('a switched-off module, an unknown function, and no connection are explained, not run', async () => {
    const run = vi.fn();
    const m = model(['<call>{"name":"crm.leads","arguments":{}}</call>', 'CRM is turned off for Local AI.']);
    await runLocalAgent({ messages: [], tools: [crmLeads], allow: () => 'Your organization has turned reading in CRM off for Local AI.', ask: m.ask, onText: () => undefined, onCancelSet: () => undefined, run });
    expect(run).not.toHaveBeenCalled();
    expect(m.seen[1]!.at(-1)).toMatch(/refused — Your organization has turned reading in CRM off/);

    const m2 = model(['<call>{"name":"hr.salaries","arguments":{}}</call>', 'I cannot do that.']);
    await runLocalAgent({ messages: [], tools: [crmLeads], allow: () => null, ask: m2.ask, onText: () => undefined, onCancelSet: () => undefined, run });
    expect(m2.seen[1]!.at(-1)).toMatch(/not a WorkSuite function you can use/);

    const m3 = model(['<call>{"name":"sales.today","arguments":{}}</call>', 'You are offline.']);
    const r3 = await runLocalAgent({ messages: [], tools: [todaySales], allow: () => null, ask: m3.ask, onText: () => undefined, onCancelSet: () => undefined, run: async () => { throw new ApiError(0, 'unreachable', 'NETWORK_UNREACHABLE'); } });
    expect(m3.seen[1]!.at(-1)).toMatch(/needs a connection to WorkSuite/);
    expect(r3.tools[0]!.ok).toBe(false);
  });

  it('stops after a few calls rather than looping', async () => {
    const m = model(Array.from({ length: 10 }, () => '<call>{"name":"sales.today","arguments":{}}</call>'));
    const run = vi.fn(async (): Promise<ToolRun> => ({ ok: true, data: 1 }));
    const r = await runLocalAgent({ messages: [], tools: [todaySales], allow: () => null, ask: m.ask, onText: () => undefined, onCancelSet: () => undefined, run });
    expect(run).toHaveBeenCalledTimes(4);
    expect(r.text).toMatch(/could not finish this/);
  });
});

describe('Settings › AI Assistant › Module Access', () => {
  const mount = (prefs: AiModuleAccessPrefs, onChange = vi.fn()) => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <ModuleAccess prefs={prefs} onChange={onChange} />
      </QueryClientProvider>,
    );
    return onChange;
  };
  beforeEach(() => {
    vi.mocked(apiGet).mockReset();
    vi.mocked(apiPut).mockReset();
  });
  afterEach(() => cleanup());

  it('lists the modules with Read and Change toggles for both assistants; a change applies at once', async () => {
    vi.mocked(apiGet).mockResolvedValue(org as never);
    const onChange = mount(none);
    const box = await screen.findByRole('checkbox', { name: 'Sales: Create or update with Local AI' });
    expect((box as HTMLInputElement).checked).toBe(true);
    fireEvent.click(box);
    expect(onChange).toHaveBeenCalledWith({ worksuite: {}, local: { sales: { read: true, write: false } } });
    // Reading off takes changes with it.
    fireEvent.click(screen.getByRole('checkbox', { name: 'Sales: Read data with WorkSuite AI' }));
    expect(onChange).toHaveBeenLastCalledWith({ worksuite: { sales: { read: false, write: false } }, local: {} });
  });

  it('shows what the organization turned off as off and locked, with the reason', async () => {
    vi.mocked(apiGet).mockResolvedValue(org as never);
    mount(none);
    const box = (await screen.findByRole('checkbox', { name: 'CRM: Read data with Local AI' })) as HTMLInputElement;
    expect(box.checked).toBe(false);
    expect(box.disabled).toBe(true);
    expect(box.closest('td')!.getAttribute('title')).toMatch(/Your organization has turned reading in CRM off/);
    expect((screen.getByRole('checkbox', { name: 'CRM: Create or update with WorkSuite AI' }) as HTMLInputElement).disabled).toBe(true);
  });

  it('only administrators see "For everyone", and their change is saved for the organization', async () => {
    vi.mocked(apiGet).mockResolvedValue({ ...org, can_manage: true } as never);
    vi.mocked(apiPut).mockImplementation(async (_p: string, body?: unknown) => ({ ...org, can_manage: true, modules: (body as { modules: OrgModule[] }).modules.map((x) => ({ ...org.modules.find((m) => m.key === x.key)!, ...x })) }) as never);
    mount(none);
    fireEvent.click(await screen.findByRole('radio', { name: 'For everyone' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'CRM: Read data with Local AI' }));
    await waitFor(() => expect(vi.mocked(apiPut)).toHaveBeenCalledWith('/api/ai/module-access', { modules: [
      { key: 'sales', worksuite: sales.worksuite, local: sales.local },
      { key: 'crm', worksuite: crm.worksuite, local: { read: true, write: false } },
    ] }));
  });

  it('without the organization setting on the server: no "For everyone", and the choices are kept for later', async () => {
    vi.mocked(apiGet).mockRejectedValue(new ApiError(404, 'Not found', 'NOT_FOUND'));
    mount(none);
    expect(await screen.findByText(/does not offer module functions to the assistants yet/)).toBeTruthy();
    expect(screen.queryByRole('radio', { name: 'For everyone' })).toBeNull();
    expect(screen.getByRole('checkbox', { name: 'Invoices: Create or update with Local AI' })).toBeTruthy();
  });
});
