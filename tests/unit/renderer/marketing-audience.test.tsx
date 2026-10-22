// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ContactDetail, ContactRow, ImportPreview, Options } from '../../../src/modules/marketing/types';

/**
 * Marketing › Audience (DK02–DK05, DK12): what the screens send the server
 * when somebody acts — a bulk hand-over and a bulk suppression, a contact's
 * tabs, a segment's live count and sample, the rejected rows of an import,
 * and a suppression lifted only with a reason.
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

const { default: Contacts } = await import('../../../src/modules/marketing/Contacts');
const { default: ContactPage } = await import('../../../src/modules/marketing/ContactPage');
const { default: SegmentBuilder } = await import('../../../src/modules/marketing/SegmentBuilder');
const { default: Import } = await import('../../../src/modules/marketing/Import');
const { default: Consent } = await import('../../../src/modules/marketing/Consent');
const { default: Settings } = await import('../../../src/modules/marketing/Settings');

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

describe('Contacts (DK02)', () => {
  it('hands the chosen contacts over to CRM, and suppresses their numbers, in one request each', async () => {
    serve({ '/api/marketing/contacts': { items: [contact(1, 'Nimal Perera'), contact(2, 'Ayesha Fernando')], total: 2 } });
    wrap(<Contacts org="7" options={options} filter={{}} onFilter={vi.fn()} onOpen={vi.fn()} />);

    expect(await screen.findByText('Nimal Perera')).toBeTruthy();
    expect(screen.getAllByText('Subscribed').length).toBe(2);
    expect(screen.getByText('Showing 1–2 of 2')).toBeTruthy();

    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Nimal Perera' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Ayesha Fernando' }));
    const bar = screen.getByRole('region', { name: 'For the chosen contacts' });
    expect(within(bar).getByText('2 selected')).toBeTruthy();

    fireEvent.click(within(bar).getByRole('button', { name: 'Hand over to CRM' }));
    fireEvent.click(screen.getByRole('button', { name: 'Hand over' }));
    await waitFor(() => expect(net.request).toHaveBeenCalledWith('POST', '/api/marketing/contacts/bulk', { body: { action: 'convert', ids: [1, 2] } }));
    await waitFor(() => expect(screen.queryByRole('region', { name: 'For the chosen contacts' })).toBeNull());

    fireEvent.click(screen.getByRole('checkbox', { name: 'Select every contact on this page' }));
    fireEvent.click(within(screen.getByRole('region', { name: 'For the chosen contacts' })).getByRole('button', { name: 'Suppress' }));
    fireEvent.click(screen.getByRole('radio', { name: /Their number/ }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Suppress' }));
    await waitFor(() => expect(net.request).toHaveBeenCalledWith('POST', '/api/marketing/contacts/bulk', { body: { action: 'suppress', ids: [1, 2], value: 'phone' } }));
    expect(net.toast).toHaveBeenCalledWith('success', 'Done.');
  });
});

describe('A contact (DK03)', () => {
  const detail: ContactDetail = {
    ...contact(5, 'Nimal Perera'),
    phone: '+94 77 123 4521',
    source_detail: {}, custom: {}, lists: [{ id: 2, name: 'Vendors 2026', archived: false }],
    consent_history: [{ id: 41, channel: 'email', status: 'granted', source: 'import', source_label: 'Import', source_ref: 'vendors.csv row 118', note: null, by: 'Hasarinda S.', at: '2026-09-12 10:02:00' }],
    timeline: [{ id: 9, kind: 'email_opened', title: 'Opened “September newsletter”', meta: null, ref_type: null, ref_id: null, at: '2026-10-02 09:14:00', actor: null }],
    address_book: null, crm_lead: { id: 412, number: 'LD-00412', status: 'new' }, can: { edit: true, delete: false, convert: true, lists: true },
    topics: [],
  };
  const calls = { items: [{ id: 3, outcome: 'interested', outcome_label: 'Interested', notes: 'Wants website care quote', by: 'Sanduni', campaign: 'Vendor follow-up', at: '2026-09-30 15:40:00', follow_up_at: null }] };

  it('shows the timeline, the append-only ledger, campaigns (or that the server has none) and calls', async () => {
    serve({
      '/api/marketing/contacts/5': detail,
      '/api/marketing/contacts/5/campaigns': new net.ApiError(404, 'Not found.'),
      '/api/marketing/contacts/5/calls': calls,
    });
    wrap(<ContactPage id={5} options={options} onBack={vi.fn()} onOpen={vi.fn()} onCampaign={vi.fn()} />);

    expect(await screen.findByRole('heading', { name: 'Nimal Perera' })).toBeTruthy();
    expect(screen.getByText('Opened “September newsletter”')).toBeTruthy();
    expect(screen.getByText('LD-00412 · new')).toBeTruthy();

    fireEvent.click(screen.getByRole('tab', { name: 'Consent ledger' }));
    expect(screen.getByText('Append-only · entries are never edited')).toBeTruthy();
    expect(screen.getByText(/vendors\.csv row 118/)).toBeTruthy();
    // A ledger row offers nothing to change it with.
    const ledger = screen.getByRole('table');
    expect(within(ledger).queryAllByRole('button')).toHaveLength(0);

    fireEvent.click(screen.getByRole('tab', { name: 'Campaigns' }));
    expect(await screen.findByText(/does not list a contact.s campaigns yet/)).toBeTruthy();

    fireEvent.click(screen.getByRole('tab', { name: 'Calls' }));
    expect(await screen.findByText('Wants website care quote')).toBeTruthy();
  });

  it('records consent only with how it was given', async () => {
    serve({ '/api/marketing/contacts/5': detail });
    wrap(<ContactPage id={5} options={options} onBack={vi.fn()} onOpen={vi.fn()} onCampaign={vi.fn()} />);
    await screen.findByRole('heading', { name: 'Nimal Perera' });
    fireEvent.click(screen.getByRole('tab', { name: 'Consent ledger' }));
    const phone = screen.getByText('Calls', { selector: 'span' }).closest('li')!;
    fireEvent.click(within(phone).getByRole('button', { name: 'They agreed' }));
    const record = screen.getByRole('button', { name: 'Record consent' }) as HTMLButtonElement;
    expect(record.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText(/How they agreed/), { target: { value: 'Verbal on call #C-2291' } });
    fireEvent.click(record);
    await waitFor(() => expect(net.request).toHaveBeenCalledWith('POST', '/api/marketing/contacts/5/consent', { body: { channel: 'phone', status: 'granted', note: 'Verbal on call #C-2291', lawful_basis: 'consent', consent_wording: 'Verbal on call #C-2291' } }));
  });
});

describe('Segment builder (DK04)', () => {
  it('counts the rules as they are written and shows the first four matches', async () => {
    serve({ '/api/marketing/pulse': { queue: null, sending: [], contacts: 4812, drafts: 0 } });
    net.apiPost.mockResolvedValue({
      members: 612,
      sample: [
        { id: 1, name: 'Nimal Perera', company: 'Ceylon Agri Exports', last_open_at: '2026-10-02 09:00:00' },
        { id: 2, name: 'Saman Kumara', company: 'Lanka Pack', last_open_at: null },
      ],
    });
    wrap(<SegmentBuilder id={null} org="7" options={options} onBack={vi.fn()} onSaved={vi.fn()} onList={vi.fn()} />);

    expect(await screen.findByText('Preview · first 2 of 612', {}, { timeout: 3000 })).toBeTruthy();
    expect(net.apiPost).toHaveBeenCalledWith('/api/marketing/segments/preview', { org_id: 7, match: 'all', rules: [{ field: 'email_status', op: 'is', value: ['subscribed'] }] });
    expect(screen.getByText('Saman Kumara')).toBeTruthy();
    expect(screen.getByText('Never')).toBeTruthy();
    expect(screen.getByText('612')).toBeTruthy();
    expect(screen.getByText('1 of 20 rules · 2 fields available')).toBeTruthy();
    /* SEG-08 is built (WS-C): an unsaved segment is asked to be saved before it is scheduled. */
    expect(screen.getByText('Save the segment first.')).toBeTruthy();
  });
});

describe('Import (DK05)', () => {
  it('sends the same file and mapping to fetch the rejected rows, and offers to save them', async () => {
    serve({});
    const preview: ImportPreview = {
      file_name: 'vendors.csv', org_id: 7, columns: ['Name', 'Email'], mapping: ['full_name', 'email'], rows: 3,
      counts: { rows: 3, new: 1, existing: 1, duplicates: 0, refused: 1, invalid_emails: 1, invalid_phones: 0, suppressed: 0, missing_consent: 3 },
      sample: [
        { line: 2, label: 'Nimal Perera', email: 'nimal@ceylonagri.lk', phone: null, company: null, outcome: 'existing', flags: [], why: null, match: 'email_key' },
        { line: 3, label: 'Ravi', email: 'ravi@@mail', phone: null, company: null, outcome: 'refused', flags: ['invalid_email'], why: 'bad email', match: null },
      ],
    };
    net.request.mockResolvedValue({ data: preview, message: null, offline: false, cachedAt: null });
    const fetch = vi.fn(async () => new Response('line,name,email,phone,reason\n3,Ravi,ravi@@mail,,bad email\n', { status: 200, headers: { 'content-type': 'text/csv' } }));
    vi.stubGlobal('fetch', fetch);
    net.call.mockResolvedValue({ name: 'vendors-rejected.csv' });
    wrap(<Import org="7" options={options} />);

    const file = new File(['Name,Email\nNimal,nimal@ceylonagri.lk\n'], 'vendors.csv', { type: 'text/csv' });
    fireEvent.change(screen.getByLabelText('Spreadsheet'), { target: { files: [file] } });
    await waitFor(() => expect(net.request).toHaveBeenCalledWith('POST', '/api/marketing/imports/preview', { body: expect.any(FormData) }));
    expect(await screen.findByText('Map columns', { selector: 'h2' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /Continue/ }));
    expect(screen.getByText('Rejected rows')).toBeTruthy();
    expect(screen.getByText('Rejected · bad email')).toBeTruthy();
    expect(screen.getByText('email_key')).toBeTruthy();
    expect(screen.getByText(/This file has/)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /Download rejected rows/ }));
    await waitFor(() => expect(net.call).toHaveBeenCalledWith('office:saveCopy', { name: 'vendors-rejected.csv', bytes: expect.any(Uint8Array) }));
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('app://bundle/__api/api/marketing/imports/rejected');
    expect(init.method).toBe('POST');
    const body = init.body as FormData;
    expect(body.get('org_id')).toBe('7');
    expect(body.get('mapping')).toBe(JSON.stringify(['full_name', 'email']));
    expect((body.get('file') as File).name).toBe('vendors.csv');
  });
});

describe('Consent & suppression (DK12)', () => {
  it('lifts a suppression only with a reason, and sends that reason', async () => {
    serve({
      '/api/marketing/suppressions': {
        items: [{ id: 9, org_id: 7, channel: 'email', value: 'dilini@greenleaf.lk', reason: 'unsubscribed', reason_label: 'Unsubscribed', contact: null, note: 'One-click (RFC 8058)', by: null, created_at: '2026-09-23 10:00:00' }],
        total: 1,
      },
    });
    wrap(<Consent org="7" options={options} tab="suppression" onTab={vi.fn()} onContact={vi.fn()} />);

    fireEvent.click(await screen.findByRole('button', { name: 'Lift the suppression on dilini@greenleaf.lk' }));
    const lift = screen.getByRole('button', { name: 'Lift it' }) as HTMLButtonElement;
    expect(lift.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText(/Why it is lifted/), { target: { value: 'ok' } });
    expect(lift.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText(/Why it is lifted/), { target: { value: 'They wrote asking to hear from us again' } });
    expect(lift.disabled).toBe(false);
    fireEvent.click(lift);
    await waitFor(() => expect(net.request).toHaveBeenCalledWith('DELETE', '/api/marketing/suppressions/9', { body: { reason: 'They wrote asking to hear from us again' } }));
  });
});

describe('Settings (DK13)', () => {
  const field = (key: string, label: string, type: string, section: string, extra: Record<string, unknown> = {}) => ({ key, label, type, section, default: null, help: null, options: null, min: null, max: null, placeholder: null, ...extra });
  const settings = {
    spec: {
      general: [
        field('marketing_footer_address', 'Postal address in the email footer', 'text', 'Email campaigns'),
        field('marketing_pace_per_hour', 'Campaign emails sent an hour, at most', 'int', 'Sending'),
        field('marketing_bounce_pause_percent', 'Pause a campaign when this share bounce (%)', 'int', 'Sending'),
        field('marketing_calls_need_consent', 'Call only people who gave phone consent', 'bool', 'Consent'),
      ],
    },
    general: {
      marketing_footer_address: { value: '12 Galle Road, Colombo 3', stored: true, inherited: false },
      marketing_pace_per_hour: { value: '1200', stored: false, inherited: true },
      marketing_bounce_pause_percent: { value: '5', stored: false, inherited: true },
      marketing_calls_need_consent: { value: '0', stored: false, inherited: true },
    },
    advanced: {},
    can_edit: true,
  };
  const withSending = { ...options, sending: { route: 'module', route_label: 'Marketing route · CoreMailInfrastructureService', priority: 8, pace: 1200, bounce_guard: 5, test_limit: 5 } } as Options;

  it('shows the route as a fact and saves only what changed, for the one company', async () => {
    serve({ '/api/module-settings/marketing': settings });
    wrap(<Settings org="7" options={withSending} section="sending" onSection={vi.fn()} />);

    expect(await screen.findByText('Marketing route · CoreMailInfrastructureService')).toBeTruthy();
    expect(net.apiGet).toHaveBeenCalledWith('/api/module-settings/marketing', { org: '7' }, expect.any(AbortSignal));
    // The footer address is General's; the consent switch is Consent's.
    expect(screen.queryByText('Postal address in the email footer')).toBeNull();
    expect(screen.queryByText('Call only people who gave phone consent')).toBeNull();

    const save = screen.getByRole('button', { name: /Save changes/ }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText(/Campaign emails sent an hour/), { target: { value: '900' } });
    expect(save.disabled).toBe(false);
    fireEvent.click(save);
    await waitFor(() => expect(net.request).toHaveBeenCalledWith('PUT', '/api/module-settings/marketing/general?org=7', { body: { marketing_pace_per_hour: '900' } }));
  });

  it('sends User access to the browser and Notifications to the desktop’s own settings', async () => {
    serve({ '/api/module-settings/marketing': settings });
    net.call.mockResolvedValue(true);
    const { rerender } = wrap(<Settings org="7" options={withSending} section="access" onSection={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /Open in browser/ }));
    expect(net.call).toHaveBeenCalledWith('app:openInBrowser', { path: '/marketing?view=settings' });

    rerender(
      <QueryClientProvider client={new QueryClient()}>
        <Settings org="7" options={withSending} section="notifications" onSection={vi.fn()} />
      </QueryClientProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: /Open Settings › Notifications/ }));
    expect(net.navigate).toHaveBeenCalledWith('/settings/notifications');
  });
});
