// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as CoreApi from '../../../src/core/api';
import type * as Bridge from '../../../src/core/bridge';

vi.mock('../../../src/core/api', async (orig) => ({ ...(await orig<typeof CoreApi>()), apiGet: vi.fn(), apiPost: vi.fn(), apiPut: vi.fn(), apiDelete: vi.fn() }));
vi.mock('../../../src/core/bridge', async (orig) => ({ ...(await orig<typeof Bridge>()), call: vi.fn() }));
vi.mock('../../../src/core/toasts', () => ({ toast: vi.fn() }));

window.matchMedia ??= ((query: string) => ({ matches: false, media: query, onchange: null, addEventListener: () => undefined, removeEventListener: () => undefined, addListener: () => undefined, removeListener: () => undefined, dispatchEvent: () => false })) as typeof window.matchMedia;

const { apiGet, apiPost, apiPut, apiDelete, ApiError } = await import('../../../src/core/api');
const { call } = await import('../../../src/core/bridge');
const { toast } = await import('../../../src/core/toasts');
const { app } = await import('../../../src/core/app-state');
const { CrmRail } = await import('../../../src/modules/crm/Rail');
const { default: FollowUps } = await import('../../../src/modules/crm/FollowUps');
const { default: Leads } = await import('../../../src/modules/crm/Leads');
const { default: Quotes } = await import('../../../src/modules/crm/Quotes');
const { default: Pipeline } = await import('../../../src/modules/crm/Pipeline');
const { PipelinesEditor } = await import('../../../src/modules/crm/Pipelines');
const { exportCrmCsv } = await import('../../../src/modules/crm/exportCsv');

/*
 * The CRM screens against payloads shaped as the server sends them, old and
 * new: the company scope on every list, Search the CRM opening the right
 * record, follow-ups on deals and accounts, the leads bulk bar, the board's
 * totals, quote accept/decline/invoice, the pipeline editor's refusals and
 * Export's fallback.
 */
const get = vi.mocked(apiGet);
const post = vi.mocked(apiPost);
const put = vi.mocked(apiPut);
const del = vi.mocked(apiDelete);

function wrap(ui: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

function signIn(orgId: string | null, perms = ['crm.view', 'crm.manage', 'crm.settings']) {
  app.set({
    organizationId: orgId,
    bootstrap: { permissions: perms, organizations: [{ id: '2', name: 'CreativeFX' }, { id: '4', name: 'TechHubiz' }], user: { organizationName: 'CreativeFX' } } as never,
  });
}

const routes = (table: Record<string, unknown>) =>
  get.mockImplementation(async (path: string) => {
    for (const [k, v] of Object.entries(table)) if (path === k) return (typeof v === 'function' ? (v as () => unknown)() : v) as never;
    return {} as never;
  });

const OPTIONS = { kinds: { call: 'Phone call' }, outcomes: { contacted: 'Spoke to them' }, closing: [], priorities: { normal: 'Normal' }, reminders: { '30': '30 minutes before' }, statuses: {} };

beforeEach(() => {
  vi.clearAllMocks();
  signIn('2');
});
afterEach(() => cleanup());

describe('Search the CRM', () => {
  it('groups what the server found and opens the record picked, with the company scope', async () => {
    routes({ '/api/crm/search': { leads: [{ id: 4, label: 'Pradeep Wickramasinghe', sub: 'Holdings', type: 'lead' }], contacts: [{ id: 12, label: 'Nimal Perera', sub: 'Highland Traders', type: 'contact', account_id: 9 }], deals: [], accounts: [], quotes: [{ id: 3, label: 'QUO-0042', sub: 'Sent', type: 'quote' }] } });
    const onOpenHit = vi.fn();
    wrap(<CrmRail view="dash" onPick={() => undefined} onNewLead={() => undefined} onOpenHit={onOpenHit} counts={{ openDeals: 0, newLeads: 0, late: 0, tasksToday: 0, meetingsToday: 0 }} />);
    fireEvent.change(screen.getByLabelText('Search the CRM'), { target: { value: 'pe' } });
    expect(await screen.findByRole('group', { name: 'Contacts' })).toBeTruthy();
    expect(screen.getByRole('group', { name: 'Leads' })).toBeTruthy();
    expect(screen.getByRole('group', { name: 'Quotes' })).toBeTruthy();
    expect(get).toHaveBeenCalledWith('/api/crm/search', { q: 'pe', org_id: 2, org: 2 }, expect.anything());
    fireEvent.click(screen.getByText('Nimal Perera'));
    expect(onOpenHit).toHaveBeenCalledWith(expect.objectContaining({ type: 'contact', id: 12, account_id: 9 }));
  });
  it('shows the rail groups with Reports under Insight and the company showing', () => {
    routes({});
    wrap(<CrmRail view="reports" onPick={() => undefined} onNewLead={() => undefined} onOpenHit={() => undefined} counts={{ openDeals: 0, newLeads: 0, late: 0, tasksToday: 0, meetingsToday: 0 }} />);
    expect(screen.getByText('Insight')).toBeTruthy();
    expect(screen.getByText('Set up')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Reports' }).getAttribute('aria-current')).toBe('page');
    expect(screen.getByText('CreativeFX')).toBeTruthy();
  });
});

const fu = (over: Record<string, unknown>) => ({
  id: 1, org_id: 2, lead_id: null, lead: null, company: null, kind: 'call', kind_label: 'Phone call', subject: null, notes: null, assigned_to: 5, assignee: 'Amaya E.',
  due_at: '2026-10-14T08:00:00Z', timezone: 'Asia/Colombo', due_local: '2026-10-14 13:30:00', priority: 'high', status: 'scheduled', standing: 'overdue', late_minutes: 130,
  outcome: null, outcome_label: null, result_notes: null, cancel_reason: null, completed_at: null, next_id: null, previous_id: null, ...over,
});

describe('Follow-ups', () => {
  it('lists follow-ups on deals and accounts, opens the record and keeps the actions', async () => {
    routes({
      '/api/crm/followups': { items: [fu({ id: 1, subject: { type: 'deal', id: 7, label: 'Cold Room Upgrade' }, title: 'Confirm cold-room spec' }), fu({ id: 2, lead_id: 4, lead: 'Lahiru Madushanka', subject: 'Demo', standing: 'due', late_minutes: null })], counts: { overdue: 4, today: 7, upcoming: 19 }, can: { create: true, complete: true, view_all: true } },
      '/api/crm/followups/options': OPTIONS,
    });
    const onOpen = vi.fn();
    wrap(<FollowUps onOpen={onOpen} />);
    expect(await screen.findByText('Cold Room Upgrade')).toBeTruthy();
    expect(screen.getByText('2 h 10 m late')).toBeTruthy();
    expect(screen.getByText(/Confirm cold-room spec/)).toBeTruthy();
    expect(screen.getByRole('tab', { name: /Late\s*4/ })).toBeTruthy();
    expect(screen.getByRole('tab', { name: /To come\s*19/ })).toBeTruthy();
    expect(screen.getAllByRole('button', { name: 'How did it go?' })).toHaveLength(2);
    expect(screen.getAllByRole('button', { name: 'Call off' })).toHaveLength(2);
    expect(get).toHaveBeenCalledWith('/api/crm/followups', expect.objectContaining({ view: 'today', org_id: 2 }), expect.anything());
    fireEvent.click(screen.getByText('Cold Room Upgrade'));
    expect(onOpen).toHaveBeenCalledWith({ type: 'deal', id: 7, label: 'Cold Room Upgrade' });
    fireEvent.click(screen.getByText('Lahiru Madushanka'));
    expect(onOpen).toHaveBeenLastCalledWith({ type: 'lead', id: 4, label: 'Lahiru Madushanka' });
  });

  it('calls one off with a reason', async () => {
    routes({ '/api/crm/followups': { items: [fu({ lead_id: 4, lead: 'Lahiru' })], counts: { overdue: 1, today: 0, upcoming: 0 }, can: { create: true, complete: true, view_all: false } }, '/api/crm/followups/options': OPTIONS });
    post.mockResolvedValue({} as never);
    wrap(<FollowUps onOpen={() => undefined} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Call off' }));
    fireEvent.change(screen.getByLabelText('Why?'), { target: { value: 'They bought elsewhere' } });
    fireEvent.click(screen.getByRole('button', { name: 'OK' }));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/api/crm/followups/1/cancel', { reason: 'They bought elsewhere' }));
  });
});

describe('Schedule a follow-up on a deal', () => {
  const board = { pipeline: { id: 1 }, meta: { deals: 56, open_value: 84_100_000, weighted: 36_200_000 }, columns: [{ id: 10, name: 'New', kind: 'open', colour: 'slate', probability: 10, count: 1, total: 3_200_000, weighted: 320_000, deals: [{ id: 7, name: 'Cold Room Upgrade', account_name: 'Highland', amount: 3_200_000, currency: 'LKR', stage_id: 10, days_in_stage: 58, owner_name: 'Amaya', close_date: null, won_at: null }] }] };
  const deal = { deal: { id: 7, name: 'Cold Room Upgrade', account_name: 'Highland', owner_name: 'Amaya', amount: 3_200_000, currency: 'LKR', stage_id: 10, stage_name: 'New', stage_kind: 'open', probability: 10, days_in_stage: 58 }, timeline: [], quotes: [{ id: 3, quote_no: 'QUO-0042', status: 'sent', total: 10, currency: 'LKR' }] };

  it('shows the board’s totals from its meta, and schedules on the deal', async () => {
    routes({ '/api/crm/deals/board': board, '/api/crm/pipelines': { pipelines: [{ id: 1, name: 'Sales', is_default: true, stages: [] }] }, '/api/crm/deals/7': deal, '/api/crm/owners': { owners: [] }, '/api/crm/followups/options': OPTIONS });
    signIn('2', ['crm.view', 'crm.manage']);
    post.mockResolvedValue({} as never);
    const onOpenQuote = vi.fn();
    wrap(<Pipeline openId={7} onOpen={() => undefined} onOpenQuote={onOpenQuote} />);
    expect(await screen.findByText('56 deals · Open LKR 84M · Weighted LKR 36M')).toBeTruthy();
    expect(get).toHaveBeenCalledWith('/api/crm/deals/board', expect.objectContaining({ org_id: 2 }), expect.anything());
    fireEvent.click(await screen.findByText('QUO-0042'));
    expect(onOpenQuote).toHaveBeenCalledWith(3);
    fireEvent.click(screen.getByRole('button', { name: /Schedule a follow-up/ }));
    fireEvent.change(screen.getByLabelText('What for'), { target: { value: 'Confirm the spec' } });
    fireEvent.click(screen.getByRole('button', { name: 'Schedule' }));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/api/crm/deals/7/followups', expect.objectContaining({ kind: 'call', subject: 'Confirm the spec', reminders: [30] })));
  });

  it('says so when the server schedules on leads only', async () => {
    routes({ '/api/crm/deals/board': board, '/api/crm/pipelines': { pipelines: [] }, '/api/crm/deals/7': deal, '/api/crm/owners': { owners: [] }, '/api/crm/followups/options': OPTIONS });
    post.mockRejectedValue(new ApiError(404, 'Not found', null));
    wrap(<Pipeline openId={7} onOpen={() => undefined} onOpenQuote={() => undefined} />);
    fireEvent.click(await screen.findByRole('button', { name: /Schedule a follow-up/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Schedule' }));
    await waitFor(() => expect(toast).toHaveBeenCalledWith('error', 'This WorkSuite server schedules follow-ups on leads only, not on deals.'));
  });
});

describe('Leads', () => {
  const lead = (id: number, name: string) => ({ id, name, company: 'Holdings', email: `${id}@x.lk`, score: 80, rating: 'hot', status: 'new', owner_name: null, follow_up: 'none', next_followup_at: null, est_value: null, currency: 'LKR', created_at: '2026-10-01', last_activity_at: null, lead_no: `LD-${id}` });
  const page = { leads: [lead(1, 'Pradeep'), lead(2, 'Rasika')], meta: { total: 300, page: 1, per_page: 50, has_more: true, counts: { new: 60, no_followup: 41, unassigned: 12, overdue: 4 } } };

  it('asks for the company showing and shows the views’ counts and the StatusBar', async () => {
    routes({ '/api/crm/leads': page, '/api/crm/owners': { owners: [] } });
    wrap(<Leads openId={null} creating={false} onOpen={() => undefined} onNew={() => undefined} onCreated={() => undefined} onCloseNew={() => undefined} onOpenDeal={() => undefined} onOpenAccount={() => undefined} />);
    expect(await screen.findByText('2 of 300 leads · 60 new · 41 with no follow-up · 12 unassigned')).toBeTruthy();
    expect(screen.getByRole('tab', { name: /Nothing scheduled\s*41/ })).toBeTruthy();
    expect(screen.getByRole('tab', { name: /Late\s*4/ })).toBeTruthy();
    expect(get).toHaveBeenCalledWith('/api/crm/leads', expect.objectContaining({ org_id: 2, org: 2, page: 1 }), expect.anything());
  });

  it('deletes the chosen leads in one bulk request and says what was refused', async () => {
    routes({ '/api/crm/leads': page, '/api/crm/owners': { owners: [] } });
    post.mockResolvedValue({ results: [{ id: 1, ok: true }, { id: 2, ok: false, message: 'Converted leads are kept.' }], done: 1, refused: 1 } as never);
    wrap(<Leads openId={null} creating={false} onOpen={() => undefined} onNew={() => undefined} onCreated={() => undefined} onCloseNew={() => undefined} onOpenDeal={() => undefined} onOpenAccount={() => undefined} />);
    await screen.findByText('Rasika');
    fireEvent.click(screen.getByLabelText('Select all'));
    expect(screen.getByRole('toolbar', { name: 'With the chosen leads' }).textContent).toContain('2 selected');
    fireEvent.click(screen.getByRole('button', { name: /Delete/ }));
    fireEvent.click(screen.getAllByRole('button', { name: 'Delete' }).at(-1)!);
    await waitFor(() => expect(post).toHaveBeenCalledWith('/api/crm/leads/bulk', { ids: [1, 2], action: 'delete' }));
    await waitFor(() => expect(toast).toHaveBeenCalledWith('warning', '1 lead done · 1 refused — Converted leads are kept.'));
  });
});

describe('Quotes', () => {
  const quote = (over: Record<string, unknown>) => ({ quote: { id: 3, quote_no: 'QUO-0042', status: 'sent', account_id: 9, account: 'Nawaloka', deal_id: null, deal: null, owner: null, owner_id: null, currency: 'LKR', subtotal: 1000, discount: 0, tax: 0, total: 1000, issued_on: '2026-10-05', valid_until: '2026-12-07', sent_at: null, file_id: null, expired: false, lines: [{ product_id: null, description: 'PVC Banner', quantity: 10, unit_price: 100, discount_pct: 0, tax_rate: 0, line_total: 1000 }], ...over }, defaults: { currency: 'LKR', valid_days: 30 } });
  const open = () => wrap(<Quotes openId={3} creating={false} onOpen={() => undefined} onNew={() => undefined} onCloseNew={() => undefined} onOpenAccount={() => undefined} onOpenInvoice={() => undefined} />);

  it('draws the lines in fixed numeric columns with the totals block', async () => {
    routes({ '/api/crm/quotes/3': quote({}), '/api/crm/accounts': { accounts: [] }, '/api/crm/products': { products: [] } });
    open();
    expect(await screen.findByText('PVC Banner')).toBeTruthy();
    const heads = screen.getAllByRole('columnheader');
    expect(heads.map((h) => h.textContent)).toEqual(['Description', 'Qty', 'Rate', 'Disc %', 'Tax %', 'Amount']);
    expect((heads[1] as HTMLElement).style.width).toBe('72px');
    expect(screen.getByLabelText('Totals').textContent).toContain('Total LKR');
    expect(screen.getByRole('note').textContent).toContain('Use Revise');
  });

  it('marks a sent quote accepted, falling back to an edit on an older server', async () => {
    routes({ '/api/crm/quotes/3': quote({}), '/api/crm/accounts': { accounts: [] }, '/api/crm/products': { products: [] } });
    post.mockRejectedValueOnce(new ApiError(404, 'Not found', null));
    put.mockResolvedValue({} as never);
    open();
    fireEvent.click(await screen.findByRole('button', { name: /Mark accepted/ }));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/api/crm/quotes/3/accept', undefined));
    await waitFor(() => expect(put).toHaveBeenCalledWith('/api/crm/quotes/3', { status: 'accepted' }));
  });

  it('declines with a reason', async () => {
    routes({ '/api/crm/quotes/3': quote({}), '/api/crm/accounts': { accounts: [] }, '/api/crm/products': { products: [] } });
    post.mockResolvedValue({} as never);
    open();
    fireEvent.click(await screen.findByRole('button', { name: /Declined/ }));
    fireEvent.change(screen.getByLabelText('Why it was declined'), { target: { value: 'Too dear' } });
    fireEvent.click(screen.getByRole('button', { name: 'Mark declined' }));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/api/crm/quotes/3/decline', { reason: 'Too dear' }));
  });

  it('converts an accepted quote to an invoice, and stops offering it where Billing cannot', async () => {
    routes({ '/api/crm/quotes/3': quote({ status: 'accepted' }), '/api/crm/accounts': { accounts: [] }, '/api/crm/products': { products: [] } });
    post.mockRejectedValueOnce(new ApiError(501, 'Billing cannot', 'not_supported'));
    open();
    fireEvent.click(await screen.findByRole('button', { name: /Convert to invoice/ }));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/api/crm/quotes/3/invoice'));
    await waitFor(() => expect(screen.queryByRole('button', { name: /Convert to invoice/ })).toBeNull());
    expect(toast).toHaveBeenCalledWith('info', 'Billing on this server cannot make an invoice from a quote.');
  });

  it('opens the invoice a quote became', async () => {
    routes({ '/api/crm/quotes/3': quote({ status: 'accepted', invoice_id: 55, invoice_no: 'INV-0055' }), '/api/crm/accounts': { accounts: [] }, '/api/crm/products': { products: [] } });
    const onOpenInvoice = vi.fn();
    wrap(<Quotes openId={3} creating={false} onOpen={() => undefined} onNew={() => undefined} onCloseNew={() => undefined} onOpenAccount={() => undefined} onOpenInvoice={onOpenInvoice} />);
    fireEvent.click(await screen.findByRole('button', { name: /Invoice INV-0055/ }));
    expect(onOpenInvoice).toHaveBeenCalledWith(55);
    expect(screen.queryByRole('button', { name: /Convert to invoice/ })).toBeNull();
  });
});

describe('Pipelines and stages', () => {
  const pipelines = { pipelines: [{ id: 1, name: 'Sales', is_default: true, stages: [{ id: 10, name: 'New', kind: 'open', colour: 'slate', probability: 10, sort_order: 1 }, { id: 11, name: 'Won', kind: 'won', colour: 'emerald', probability: 100, sort_order: 2 }, { id: 12, name: 'Lost', kind: 'lost', colour: 'rose', probability: 0, sort_order: 3 }] }] };

  it('reorders stages and says why a stage holding deals cannot go', async () => {
    routes({ '/api/crm/pipelines': pipelines });
    post.mockResolvedValue({} as never);
    del.mockRejectedValue(new ApiError(409, 'In use', 'stage_in_use'));
    wrap(<PipelinesEditor canEdit />);
    fireEvent.click(await screen.findByRole('button', { name: 'Move New down' }));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/api/crm/pipelines/1/stages/reorder', { ids: [11, 10, 12] }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete New' }));
    await waitFor(() => expect(toast).toHaveBeenCalledWith('error', 'Deals are still in that stage. Move them to another stage first.'));
  });

  it('adds a stage and renames a stage on leaving the field', async () => {
    routes({ '/api/crm/pipelines': pipelines });
    post.mockResolvedValue({} as never);
    put.mockResolvedValue({} as never);
    wrap(<PipelinesEditor canEdit />);
    fireEvent.change(await screen.findByLabelText('New stage name'), { target: { value: 'Demo booked' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add stage' }));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/api/crm/pipelines/1/stages', { name: 'Demo booked', kind: 'open', probability: 50, colour: 'sky' }));
    const name = screen.getByLabelText('Stage New name');
    fireEvent.change(name, { target: { value: 'Fresh' } });
    fireEvent.blur(name);
    await waitFor(() => expect(put).toHaveBeenCalledWith('/api/crm/stages/10', expect.objectContaining({ name: 'Fresh', kind: 'open', probability: 10 })));
  });

  it('is read-only without CRM settings and warns about a pipeline missing its Lost stage', async () => {
    routes({ '/api/crm/pipelines': { pipelines: [{ ...pipelines.pipelines[0], stages: pipelines.pipelines[0]!.stages.slice(0, 2) }] } });
    wrap(<PipelinesEditor canEdit={false} />);
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toContain('A pipeline needs a Lost stage.');
    expect(screen.queryByLabelText('New stage name')).toBeNull();
  });
});

describe('Export', () => {
  it('saves the server’s CSV with the list’s filters', async () => {
    const fetchMock = vi.fn(async () => new Response('Name\nPradeep', { status: 200, headers: { 'content-type': 'text/csv' } }));
    vi.stubGlobal('fetch', fetchMock);
    vi.mocked(call).mockResolvedValue('/home/me/leads.csv' as never);
    await exportCrmCsv('/api/crm/leads/export', { status: 'new', org_id: 2 }, 'leads');
    const url = new URL(String((fetchMock.mock.calls[0] as unknown[])[0]));
    expect(url.pathname).toContain('/api/crm/leads/export');
    expect(Object.fromEntries(url.searchParams)).toEqual({ status: 'new', org_id: '2', format: 'csv' });
    expect(call).toHaveBeenCalledWith('files:saveText', { name: expect.stringMatching(/^leads-\d{4}-\d{2}-\d{2}\.csv$/), text: 'Name\nPradeep' });
    vi.unstubAllGlobals();
  });

  it('saves the rows on screen when the server has no export yet', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"status":"error"}', { status: 404, headers: { 'content-type': 'application/json' } })));
    vi.mocked(call).mockResolvedValue('/home/me/quotes.csv' as never);
    await exportCrmCsv('/api/crm/quotes/export', {}, 'quotes', () => [['Quote', 'Total'], ['QUO-0042', 1000]]);
    expect(call).toHaveBeenCalledWith('files:saveText', expect.objectContaining({ text: 'Quote,Total\nQUO-0042,1000' }));
    expect(toast).toHaveBeenCalledWith('success', expect.stringContaining('rows on screen'));
    vi.unstubAllGlobals();
  });

  it('says so when the server refuses the export', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"status":"error","message":"No"}', { status: 403, headers: { 'content-type': 'application/json' } })));
    await exportCrmCsv('/api/crm/accounts/export', {}, 'accounts', () => []);
    expect(call).not.toHaveBeenCalled();
    expect(toast).toHaveBeenCalledWith('error', 'You may not export from the CRM. Ask for CRM export.');
    vi.unstubAllGlobals();
  });
});
