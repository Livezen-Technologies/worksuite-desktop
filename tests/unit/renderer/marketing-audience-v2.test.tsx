// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CompanyDetail, ContactRow, DuplicateGroup, MarketingList, Options } from '../../../src/modules/marketing/types';

/**
 * Marketing SRS v2.0 stream A on the desktop: the duplicate report and its
 * merge, merge undo, custom fields, an organisation's page, reach per channel
 * on a list, and a background import's progress and cancel.
 */
const net = vi.hoisted(() => {
  class ApiError extends Error {
    constructor(readonly status: number, message: string, readonly code: string | null = null, readonly data: unknown = null) {
      super(message);
    }
  }
  return { ApiError, apiGet: vi.fn(), apiPost: vi.fn(), request: vi.fn(), call: vi.fn(), go: vi.fn(), navigate: vi.fn(), toast: vi.fn() };
});

vi.mock('../../../src/core/bridge', () => ({ call: net.call, on: () => () => undefined, hasDesktop: () => true, errorMessage: (e: unknown) => String(e), isMac: false, platform: 'linux' }));
vi.mock('../../../src/core/api', () => ({ apiGet: net.apiGet, apiPost: net.apiPost, request: net.request, apiUrl: (p: string) => `app://bundle/__api${p}`, ApiError: net.ApiError }));
vi.mock('../../../src/core/query', () => ({ queryClient: { invalidateQueries: vi.fn(async () => undefined) } }));
vi.mock('../../../src/core/tab-context', () => ({ useTab: () => ({ go: net.go, navigate: net.navigate, query: new URLSearchParams(), path: ['marketing'] }), useTabTitle: () => undefined }));
vi.mock('../../../src/core/toasts', () => ({ toast: net.toast }));
// Another screen's file: the Consent screen only needs it to exist.
vi.mock('../../../src/modules/marketing/Topics', () => ({ default: () => <p>Topics</p> }));

const { default: DataQuality } = await import('../../../src/modules/marketing/DataQuality');
const { default: CompanyPage } = await import('../../../src/modules/marketing/CompanyPage');
const { default: Lists } = await import('../../../src/modules/marketing/Lists');
const { Background } = await import('../../../src/modules/marketing/Import');

const can = { dashboard: true, view: true, create: true, edit: true, delete: true, import: true, export: true, convert: true, lists: true, segments: true, suppression: true, settings: true };
const options = {
  companies: [{ id: 7, name: 'Livezen Technologies', can, people: [{ id: 3, name: 'Hasarinda S.' }] }],
  statuses: [{ value: 'new', label: 'New' }],
  sources: [{ value: 'import', label: 'Spreadsheet import' }],
  channels: [{ value: 'email', label: 'Email' }, { value: 'phone', label: 'Phone' }],
  reasons: [{ value: 'unsubscribed', label: 'Unsubscribed' }, { value: 'manual', label: 'Suppressed by hand' }],
  consent_sources: [],
  segment_fields: [
    { key: 'tag', label: 'Tag', type: 'text', ops: [{ key: 'includes', label: 'includes', bare: false }], choices: null },
    { key: 'email_status', label: 'Email consent', type: 'choice', ops: [{ key: 'is', label: 'is', bare: false }], choices: [{ value: 'subscribed', label: 'subscribed' }] },
  ],
  import_targets: [{ value: 'full_name', label: 'Full name' }, { value: 'email', label: 'Email' }],
  import_existing: [{ value: 'fill', label: 'Fill in what is empty' }],
  import_limits: { rows: 10000, bytes: 10485760 },
} as unknown as Options;

const contact = (id: number, name: string, over: Partial<ContactRow> = {}): ContactRow => ({
  id, org_id: 7, name, first_name: null, last_name: null, email: `${name.split(' ')[0]!.toLowerCase()}@ceylonagri.lk`, phone: '077 *** 4521', whatsapp: null, job_title: null,
  company: { id: 4, name: 'Ceylon Agri Exports' }, country: 'LK', country_name: 'Sri Lanka', city: null, industry: null, language: null, status: 'new', status_label: 'New',
  source: 'import', source_label: 'Import · vendors.csv', owner: null, score: 0, tags: ['vendor'], consent: { email: 'granted', phone: null, whatsapp: null }, suppressed: [],
  crm_lead_id: null, in_address_book: false, last_contacted_at: null, next_follow_up_at: null, created_at: null, updated_at: null,
  last_activity: { title: 'Opened “September newsletter”', at: null }, phone_masked: true, ...over,
});

function wrap(node: ReactNode) {
  return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{node}</QueryClientProvider>);
}

/** Answers GETs by path, as the server would. */
function serve(routes: Record<string, unknown>) {
  net.apiGet.mockImplementation(async (path: string) => {
    const hit = routes[path];
    if (hit instanceof Error) throw hit;
    if (hit === undefined) return { items: [], total: 0 };
    return hit;
  });
}

beforeEach(() => {
  Object.values(net).forEach((f) => typeof f === 'function' && 'mockReset' in f && f.mockReset());
  net.request.mockResolvedValue({ data: null, message: 'Done.', offline: false, cachedAt: null });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});


describe('Data quality', () => {
  it('lists duplicates and merges them, keeping the field chosen from the other contact', async () => {
    const group: DuplicateGroup = { org_id: 7, match: 'email', key: 'nimal@ceylonagri.lk', contacts: [contact(1, 'Nimal Perera', { city: 'Colombo' }), contact(2, 'Nimal P', { city: 'Kandy' })] };
    serve({ '/api/marketing/contacts/duplicates': { groups: [group] } });
    wrap(<DataQuality org="7" options={options} tab="duplicates" onTab={vi.fn()} onContact={vi.fn()} />);

    expect(await screen.findByText('Same email: nimal@ceylonagri.lk')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Merge…' }));
    fireEvent.click(screen.getByText('Kandy'));
    fireEvent.click(screen.getByRole('button', { name: 'Merge 2' }));
    await waitFor(() => expect(net.request).toHaveBeenCalledWith('POST', '/api/marketing/contacts/merge', { body: { survivor_id: 1, ids: [2], pick: { city: 2 } } }));
  });

  it('undoes a merge still within its 30 days', async () => {
    serve({ '/api/marketing/contacts/merges': { items: [{ id: 5, org_id: 7, survivor_id: 1, survivor: 'Nimal Perera', merged: [{ id: 2, name: 'Nimal P' }], by: null, merged_at: null, undo_until: null, undone_at: null, can_undo: true }] } });
    wrap(<DataQuality org="7" options={options} tab="merges" onTab={vi.fn()} onContact={vi.fn()} />);

    fireEvent.click(await screen.findByRole('button', { name: /Undo/ }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Undo merge' }));
    await waitFor(() => expect(net.request).toHaveBeenCalledWith('POST', '/api/marketing/contacts/merges/5/undo', { body: undefined }));
  });
});

describe('Reach and organisations', () => {
  it('shows a list\'s total and who each channel may reach', async () => {
    const list: MarketingList = { id: 4, org_id: 7, name: 'Vendors 2026', description: null, owner: null, members: 10, subscribed: 6, reachable: { email: 6, call: 8, whatsapp: 2 }, archived: false, created_at: null, updated_at: null };
    serve({ '/api/marketing/lists': { items: [list] } });
    wrap(<Lists org="7" options={options} onContacts={vi.fn()} />);

    const reach = await screen.findByLabelText('Vendors 2026: reachable by channel');
    expect(within(reach).getByText('Calls').nextSibling?.textContent).toBe('8');
  });

  it('shows an organisation with its people, reach and merged timeline', async () => {
    const co: CompanyDetail = { id: 4, org_id: 7, name: 'Ceylon Agri Exports', domain: null, industry: null, country: 'LK', country_name: 'Sri Lanka', city: null, phone: null, website: null, owner: null, client_id: null, created_at: null,
      contacts_count: 1, contacts: [contact(1, 'Nimal Perera')], reachable: { email: 1, call: 0, whatsapp: 0 },
      timeline: [{ id: 1, kind: 'note', title: 'Met at the expo', meta: null, ref_type: null, ref_id: null, at: null, actor: null, contact: { id: 1, name: 'Nimal Perera' } }] };
    serve({ '/api/marketing/companies/4': co });
    const open = vi.fn();
    wrap(<CompanyPage id={4} onBack={vi.fn()} onOpenContact={open} onContacts={vi.fn()} />);

    expect(await screen.findByText('Met at the expo')).toBeTruthy();
    expect(screen.getByText('May be called')).toBeTruthy();
    fireEvent.click(screen.getAllByRole('button', { name: /Nimal Perera/ })[0]!);
    expect(open).toHaveBeenCalledWith(1);
  });

  it('follows a background import and cancels it', async () => {
    serve({ '/api/marketing/imports/9': { id: 9, org_id: 7, file_name: 'big.csv', status: 'running', rows: 5000, rows_done: 1000, percent: 20, created: 900, updated: 100, cancel_requested: false, error: null } });
    wrap(<Background id={9} onEnd={vi.fn()} />);

    expect(await screen.findByText(/1,000 of 5,000 rows/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(net.request).toHaveBeenCalledWith('POST', '/api/marketing/imports/9/cancel', { body: undefined }));
  });
});
