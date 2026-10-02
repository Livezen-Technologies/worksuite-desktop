// @vitest-environment jsdom
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as CoreApi from '../../../src/core/api';
import type * as LocalAi from '../../../src/core/local-ai';

vi.mock('../../../src/core/bridge', () => ({ call: vi.fn(async (c: string) => (c === 'ai:rules' ? { enabled: true, localFiles: false } : null)), on: () => () => undefined, errorMessage: (e: unknown) => String(e), hasDesktop: () => true, isMac: false }));
vi.mock('../../../src/core/api', async (orig) => ({ ...(await orig<typeof CoreApi>()), apiGet: vi.fn(async () => ({ enabled: true, reason: null })), apiPost: vi.fn(), apiPut: vi.fn() }));
const local = vi.hoisted(() => ({ answers: [] as string[], asked: [] as unknown[] }));
vi.mock('../../../src/core/local-ai', async (orig) => ({
  ...(await orig<typeof LocalAi>()),
  useLocalModels: () => ({ isLoading: false, data: [{ isDefault: true, state: 'installed', readiness: 'ready', model: { name: 'Gemma' } }] }),
  askLocal: vi.fn((m: unknown) => {
    local.asked.push(m);
    return { done: Promise.resolve({ text: local.answers.shift() ?? 'OK.', cancelled: false, tokens: 1, ms: 1 }), cancel: () => undefined };
  }),
}));

import { ApiError, apiPost } from '../../../src/core/api';
import { app } from '../../../src/core/app-state';
import { askLocal } from '../../../src/core/local-ai';
import { tabsStore } from '../../../src/core/tabs';
import { AskPanel } from '../../../src/modules/ai/AskPanel';
import { GUIDES } from '../../../src/modules/ai/help/catalog';
import { findGuides, isHowTo, mayDo, moduleOf } from '../../../src/modules/ai/help/guides';
import { SupportDialog } from '../../../src/modules/ai/help/HelpUi';
import { ShowMeHost, startShowMe } from '../../../src/modules/ai/help/ShowMe';
import { createAskSession } from '../../../src/modules/ai/session';

describe('Help & Guide: telling instructions from actions (worksuite-desktop#54)', () => {
  it('reads how-to questions as requests for instructions, and imperatives as actions', () => {
    for (const q of ['How do I create an order?', 'how to share a file', 'Where is the PIN setting?', 'What are the steps to add a lead', 'Can I schedule a meeting from here?', 'Show me how to file an expense']) expect(isHowTo(q), q).toBe(true);
    for (const q of ['Create an order for Acme', 'Send the invoice to Ben', 'Schedule a meeting with Asha tomorrow at 3', 'Summarise my unread mail', 'What is 2+2?', 'Why was order SO-12 late?', '']) expect(isHowTo(q), q).toBe(false);
  });

  it('finds the guide a question is about, preferring the app the person is in', () => {
    expect(findGuides(GUIDES, 'How do I create an order?', null)[0]?.id).toBe('sales.order');
    expect(findGuides(GUIDES, 'how do I send an invoice', null)[0]?.id).toBe('billing.invoice');
    expect(findGuides(GUIDES, 'how can I share a folder with my team', 'files')[0]?.id).toBe('files.share');
    expect(findGuides(GUIDES, 'how do I set a PIN', null)[0]?.id).toBe('settings.pin');
    expect(findGuides(GUIDES, 'how do I fly a kite', null)).toEqual([]);
    expect(moduleOf('/sales?tab=orders')).toBe('sales');
  });

  it('says what permission a guide needs without refusing it', () => {
    const order = GUIDES.find((g) => g.id === 'sales.order')!;
    expect(mayDo(order, ['oms.view'])).toBe(false);
    expect(mayDo(order, ['inventory.sell'])).toBe(true);
    expect(mayDo(order, ['*'])).toBe(true);
    expect(mayDo(GUIDES.find((g) => g.id === 'tasks.create')!, [])).toBe(true);
  });

  it('every control a guide walks to is on a screen of this version', () => {
    const src = join(__dirname, '../../../src');
    const ids = new Set<string>();
    const walk = (dir: string) => {
      for (const n of readdirSync(dir)) {
        const p = join(dir, n);
        if (statSync(p).isDirectory()) walk(p);
        else if (p.endsWith('.tsx')) for (const m of readFileSync(p, 'utf8').matchAll(/data-guide="([a-z.-]+)"/g)) ids.add(m[1]!);
      }
    };
    walk(src);
    const targets = GUIDES.flatMap((g) => g.steps.map((s) => s.target).filter(Boolean));
    expect(targets.length).toBeGreaterThan(10);
    expect(targets.filter((t) => !ids.has(t!))).toEqual([]);
    expect(new Set(GUIDES.map((g) => g.id)).size).toBe(GUIDES.length);
  });
});

function mount(route = '/sales?tab=orders') {
  tabsStore.set({ tabs: [{ id: 't1', route, title: 'x', pinned: false, organizationId: null, app: moduleOf(route)!, lastActive: 0, suspended: false, reloadKey: 0 }], activeId: 't1' } as never);
  const session = createAskSession();
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <AskPanel surface="assistant.panel" session={session} />
      <ShowMeHost />
    </QueryClientProvider>,
  );
  return session;
}
const ask = (q: string) => {
  fireEvent.change(screen.getByLabelText('Your question'), { target: { value: q } });
  fireEvent.click(screen.getByLabelText('Send'));
};

describe('Help & Guide in the assistant', () => {
  beforeEach(() => {
    local.answers = [];
    local.asked = [];
    vi.mocked(askLocal).mockClear();
    vi.mocked(apiPost).mockReset();
    app.set({ bootstrap: { permissions: ['oms.view'] } } as never);
  });
  afterEach(() => {
    cleanup();
    tabsStore.set({ tabs: [], activeId: null } as never);
  });

  it('answers "How do I create an order?" with the guide — no model asked, no refusal — and says the permission it needs', async () => {
    mount();
    ask('How do I create an order?');
    const card = await screen.findByRole('region', { name: 'Guide: Create a sales order' });
    expect(card.textContent).toContain('Click “New order” at the top of the rail');
    expect(card.textContent).toMatch(/doing it needs: Create orders \(inventory.sell\)/);
    expect(screen.getByRole('button', { name: 'Show me' })).toBeTruthy();
    expect(vi.mocked(askLocal)).not.toHaveBeenCalled();
    expect(vi.mocked(apiPost)).not.toHaveBeenCalled();
  });

  it('suggests guides for the app the person is in, and has a visible Help & Guide', async () => {
    mount('/crm?tab=leads');
    expect(screen.getByRole('button', { name: 'Add a CRM lead' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Help & Guide/ }));
    const panel = screen.getByRole('region', { name: 'Help & Guide' });
    expect(panel.textContent).toContain('Suggested here');
    fireEvent.change(screen.getByLabelText('Search the guides'), { target: { value: 'expense' } });
    fireEvent.click(screen.getByRole('button', { name: 'Submit an expense claim' }));
    expect(await screen.findByRole('region', { name: 'Guide: Submit an expense claim' })).toBeTruthy();
  });

  it('answers a follow-up from the guide being followed, on this computer first', async () => {
    mount();
    ask('How do I create an order?');
    await screen.findByRole('region', { name: 'Guide: Create a sales order' });
    local.answers.push('Choose it under “Warehouse”.');
    ask('And which warehouse should I pick?');
    expect(await screen.findByText('Choose it under “Warehouse”.')).toBeTruthy();
    const sent = (local.asked[0] as Array<{ content: string }>).at(-1)!.content;
    expect(sent).toContain('following this WorkSuite guide');
    expect(sent).toContain('Guide: Create a sales order');
    expect(sent).toContain('Question: And which warehouse should I pick?');
  });

  it('says when no guide covers it, offering the assistant anyway, Contact Support and Report an Issue', async () => {
    mount();
    ask('How do I fly a kite in WorkSuite?');
    const card = await screen.findByRole('region', { name: 'No guide for this' });
    expect(card.textContent).toMatch(/no guide for that in this version/);
    local.answers.push('In general: …');
    fireEvent.click(screen.getByRole('button', { name: 'Ask the assistant anyway' }));
    await waitFor(() => expect(local.asked.length).toBe(1));
    expect((local.asked[0] as Array<{ content: string }>).at(-1)!.content).toMatch(/They want instructions, not for you to do it/);
    fireEvent.click(screen.getByRole('button', { name: 'Contact Support' }));
    expect(await screen.findByRole('dialog', { name: 'Contact Support' })).toBeTruthy();
  });

  it('routes sales totals after an order guide to authorized data, and keeps later actions out of guide context', async () => {
    app.set({ organizationId: '7' });
    vi.mocked(apiPost).mockResolvedValue({ company: { id: 7, name: 'Acme' }, date: '2026-10-02', timezone: 'Asia/Colombo', basis: 'Gross issued invoices by invoice date.', totals: [{ currency: 'USD', total: '50.00', count: 1 }], records_url: '/billing?tab=inv&org=7&sales_date=2026-10-02' } as never);
    mount(); ask('How do I create an order?');
    await screen.findByRole('region', { name: 'Guide: Create a sales order' });
    ask('Can I know today’s total sales?');
    expect(await screen.findByText(/USD 50.00/)).toBeTruthy();
    expect(screen.getByRole('button', { name: /Supporting sales invoices/ })).toBeTruthy();
    expect(askLocal).not.toHaveBeenCalled();
    expect(screen.getAllByRole('region', { name: 'Guide: Create a sales order' })).toHaveLength(1);
    local.answers.push('Please provide the customer and order items.');
    ask('Create a sales order.');
    await screen.findByText('Please provide the customer and order items.');
    const sent = (local.asked[0] as Array<{ content: string }>).at(-1)!.content;
    expect(sent).toContain('Current intent: action'); expect(sent).not.toContain('following this WorkSuite guide');
  });

  it('records Was this helpful?', async () => {
    vi.mocked(apiPost).mockResolvedValue({} as never);
    mount();
    ask('how do I add a calendar event');
    await screen.findByRole('region', { name: 'Guide: Add a calendar event' });
    fireEvent.click(screen.getByRole('button', { name: 'Yes' }));
    expect(screen.getByText('Thanks for telling us.')).toBeTruthy();
    expect(vi.mocked(apiPost)).toHaveBeenCalledWith('/api/ai/help/feedback', expect.objectContaining({ guide: 'calendar.event', helpful: true }));
  });
});

describe('Show me', () => {
  afterEach(cleanup);

  it('highlights each step\'s control without touching it, and ends with Done or Esc', async () => {
    const clicked = vi.fn();
    render(
      <>
        <button type="button" data-guide="tasks.new-task" onClick={clicked}>New task</button>
        <ShowMeHost />
      </>,
    );
    Object.defineProperty(screen.getByText('New task'), 'getBoundingClientRect', { value: () => ({ left: 10, top: 10, right: 110, bottom: 48, width: 100, height: 38 }) });
    act(() => startShowMe(GUIDES.find((g) => g.id === 'tasks.create')!));
    const card = await screen.findByRole('dialog', { name: 'Show me: Create a task' });
    expect(card.textContent).toContain('1 of 5');
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    await waitFor(() => expect(card.textContent).toContain('Click “New task” in the rail'));
    expect(card.textContent).not.toMatch(/not on screen/);
    expect(clicked).not.toHaveBeenCalled();
    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByTestId('show-me')).toBeNull());
  });
});

describe('Contact Support', () => {
  afterEach(cleanup);
  beforeEach(() => {
    vi.mocked(apiPost).mockReset();
    app.set({ info: { version: '0.2.72', platform: 'darwin', osVersion: '15.1', channel: 'stable' } } as never);
  });

  it('shows exactly what is sent, lets parts be left out, and sends only on Send', async () => {
    vi.mocked(apiPost).mockResolvedValue({ reference: 'S-12' } as never);
    render(<SupportDialog kind="support" question="How do I merge two customers?" screen="/crm?tab=accounts" onClose={() => undefined} />);
    expect(screen.getByText('Exactly what will be sent').closest('details')!.textContent).toContain('Screen: /crm?tab=accounts');
    fireEvent.click(screen.getByRole('checkbox', { name: /The screen you are on/ }));
    expect(screen.getByText('Exactly what will be sent').closest('details')!.textContent).not.toContain('Screen:');
    expect(vi.mocked(apiPost)).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(vi.mocked(apiPost)).toHaveBeenCalledWith('/api/desktop/support', expect.objectContaining({ kind: 'support', details: expect.objectContaining({ screen: null, version: '0.2.72' }) })));
  });

  it('on a server without support requests, offers the text to copy and Diagnostics', async () => {
    vi.mocked(apiPost).mockRejectedValue(new ApiError(404, 'Not found', 'NOT_FOUND'));
    render(<SupportDialog kind="issue" screen={null} onClose={() => undefined} />);
    fireEvent.change(screen.getByLabelText(/What happened/), { target: { value: 'The order list is empty.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/does not take support requests from the desktop yet/);
    expect(screen.getByRole('button', { name: 'Copy the details' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Open Diagnostics' })).toBeTruthy();
  });
});
