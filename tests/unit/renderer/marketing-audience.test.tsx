// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as CoreApi from '../../../src/core/api';

vi.mock('sip.js', () => ({
  Invitation: class {},
  Inviter: class {},
  Registerer: class {},
  RegistererState: {},
  SessionState: {},
  UserAgent: { makeURI: () => undefined },
}));
vi.mock('../../../src/core/api', async (orig) => ({ ...(await orig<typeof CoreApi>()), apiGet: vi.fn(), apiPost: vi.fn(), apiPut: vi.fn(), apiDelete: vi.fn() }));
vi.mock('../../../src/core/bridge', () => ({ call: vi.fn(), on: () => () => undefined, hasDesktop: () => false, errorMessage: (e: unknown) => String(e), isMac: false, registerDropped: vi.fn() }));
vi.mock('../../../src/core/toasts', () => ({ toast: vi.fn() }));
vi.mock('../../../src/modules/calls/tones', () => ({ playTone: vi.fn(() => ({ stop: vi.fn(), setVolume: vi.fn() })), playOnce: vi.fn(), ringVolume: () => 0.5 }));
const tab = { route: '/marketing', go: vi.fn(), openLink: vi.fn() };
vi.mock('../../../src/core/tab-context', () => ({
  useTab: () => {
    const [path, qs = ''] = tab.route.split('?');
    return { query: new URLSearchParams(qs), path: path!.split('/').filter(Boolean), go: tab.go, navigate: vi.fn(), openInNewTab: vi.fn(), active: true, openLink: tab.openLink };
  },
  useTabTitle: () => undefined,
}));

import { ApiError, apiGet, apiPost, apiPut } from '../../../src/core/api';
import { app } from '../../../src/core/app-state';
import { toast } from '../../../src/core/toasts';
import { NOT_OFFERED, type Contact } from '../../../src/modules/marketing/api';
import { maskPhone } from '../../../src/modules/marketing/lib/format';
import ContactDetail from '../../../src/modules/marketing/audience/ContactDetail';
import { ContactEditor, changesFor, displayName, matchedOn, parseTags, shownPhone, timeZones, updateFor } from '../../../src/modules/marketing/audience/ContactEditor';
import { phoneKey } from '../../../src/modules/marketing/lib/dedupe';
import Contacts from '../../../src/modules/marketing/audience/Contacts';
import Dashboard, { weekLabel, weeklySummary } from '../../../src/modules/marketing/audience/Dashboard';
import { campaignChip, campaignRoute } from '../../../src/modules/marketing/lib/consent';
import { coverage } from '../../../src/modules/marketing/audience/Lists';
import { websiteHost, websiteUrl } from '../../../src/modules/marketing/audience/Organisations';

/**
 * Marketing · Audience I (WS-MKT-SRS-001 DK01–DK03): the dashboard with its go-live readiness panel (offered, all
 * clear, or not offered — never invented), the contacts bulk bar, dedupe before a new contact is saved (WF-02), and
 * the contact page's do-not-call and CRM hand-over.
 */
function wrap(ui: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
  return client;
}

const notFound = () => new ApiError(404, 'The server answered 404.', null);

function contact(over: Partial<Contact> = {}): Contact {
  return {
    id: 1,
    name: 'Nimal Perera',
    first_name: 'Nimal',
    last_name: 'Perera',
    email: 'nimal@ceylonagri.lk',
    phone: '+94 77 312 4521',
    organisation_id: 4,
    organisation: 'Ceylon Agri Exports',
    job_title: null,
    tags: ['vendor'],
    owner: { id: 9, name: 'Hasarinda S.' },
    source: 'Import · vendors.csv',
    time_zone: 'Asia/Colombo',
    email_consent: 'subscribed',
    phone_consent: 'consented',
    email_suppressed: false,
    do_not_call: false,
    created_at: '2026-09-12 10:02:00',
    ...over,
  };
}

const campaign = (over: Record<string, unknown>) => ({ id: 1, name: 'x', status: 'draft', progress: null, recipients_count: 0, delivered_count: 0, human_opens: 0, clicks: 0, ...over });

const DASH = {
  contacts: { total: 4812, added_this_month: 212 },
  email_subscribed: { count: 3970, share: 82.5 },
  human_open_rate: 31.4,
  bounce_rate: 1.1,
  bounce_guard_threshold: 5,
  weekly: [
    { week: '2026-09-07', delivered: 3702, human_opens: 1103 },
    { week: '2026-09-14', delivered: 1126, human_opens: 408 },
  ],
  recent_campaigns: [
    campaign({ id: 11, name: 'October service update', status: 'sending', progress: 61.6, recipients_count: 1840 }),
    campaign({ id: 12, name: 'September newsletter', status: 'sent', recipients_count: 3702, delivered_count: 3702, human_opens: 1103, clicks: 144 }),
  ],
  calls: { in_queue: 214, claimed_now: 6, callbacks_due_today: 9, reached_30d: 388, interested_30d: 47 },
  consent: { email_recorded: 3970, phone_recorded: 1214, suppressed_email: 142, do_not_call: 61, total: 4812 },
  sending: null,
};

const ITEMS = [
  { code: 'B-1', title: 'Marketing app is switched off for all companies', owner: 'Admin', area: 'Admin Center › Apps', open: true, fix: '/admin/apps' },
  { code: 'B-2', title: 'marketing:send cron is not installed on production', owner: 'Ops', area: 'cron.d', open: false, fix: null },
  { code: 'B-5', title: 'Nobody holds marketing.call.make — call queue cannot be worked', owner: 'Admin', area: 'Roles & permissions', open: true, fix: '/marketing/settings' },
];

let readiness: 'offered' | 'clear' | 'none' = 'offered';

beforeEach(() => {
  readiness = 'offered';
  tab.route = '/marketing';
  tab.go.mockReset();
  tab.openLink.mockReset();
  vi.mocked(toast).mockReset();
  vi.mocked(apiPost).mockReset();
  vi.mocked(apiPut).mockReset();
  vi.mocked(apiGet).mockReset();
  vi.mocked(apiGet).mockImplementation((async (path: string) => {
    switch (path) {
      case '/api/marketing/dashboard':
        return DASH;
      case '/api/marketing/readiness':
        if (readiness === 'none') throw notFound();
        return readiness === 'clear' ? { open: 0, items: ITEMS.map((i) => ({ ...i, open: false })) } : { open: 2, items: ITEMS };
      case '/api/marketing/contacts':
        return { data: [contact(), contact({ id: 2, name: 'Kasun Jayawardena', first_name: 'Kasun', last_name: 'Jayawardena', email: null, email_consent: 'unknown', phone_masked: true })], current_page: 1, last_page: 1, per_page: 50, total: 2 };
      case '/api/marketing/lists':
        return { data: [{ id: 3, name: 'Vendors 2026', description: null, members_count: 1006, email_subscribed_count: 214, created_at: null }] };
      case '/api/marketing/segments':
        return [];
      case '/api/marketing/sources':
        return ['Import · vendors.csv', 'Web form'];
      case '/api/marketing/tags':
        return ['vendor', 'lead'];
      case '/api/marketing/contacts/1':
        return contact({ do_not_call: true, job_title: 'Procurement Manager', lists: [{ id: 3, name: 'Vendors 2026' }], crm_lead: null });
      case '/api/marketing/contacts/1/timeline':
        return [{ id: 't1', kind: 'open', title: 'Opened “September newsletter”', detail: 'Human open · Gmail', at: '2026-10-02 09:14:00', actor: null }];
      case '/api/marketing/contacts/98':
        throw new ApiError(404, 'The route api/marketing/contacts/98 could not be found.', null);
      case '/api/marketing/contacts/1/consent':
        return [{ id: 1, at: '2026-09-30 15:40:00', channel: 'phone', change: 'granted', basis: 'verbal', evidence: 'call #C-2291', actor: { kind: 'user', name: 'Sanduni K.' } }];
      default:
        throw notFound();
    }
  }) as never);
  app.set({ organizationId: '1', apps: [], bootstrap: { organizations: [{ id: '1', name: 'Livezen Technologies' }], permissions: [] } as never });
});

afterEach(() => cleanup());

describe('helpers', () => {
  it('opens a campaign where its state says (draft · scheduled · the rest)', () => {
    expect(campaignRoute({ id: 5, status: 'draft' })).toBe('/marketing/campaigns/5/content');
    expect(campaignRoute({ id: 5, status: 'scheduled' })).toBe('/marketing/campaigns/5/review');
    expect(campaignRoute({ id: 5, status: 'sending' })).toBe('/marketing/campaigns/5/report');
    expect(campaignRoute({ id: 5, status: 'sent' })).toBe('/marketing/campaigns/5/report');
  });

  it('labels a send in progress with how far it has got', () => {
    expect(campaignChip({ status: 'sending', progress: 61.6 })).toEqual({ label: 'Sending · 62%', tone: 'indigo' });
    expect(campaignChip({ status: 'sending', progress: null }).label).toBe('Sending');
    expect(campaignChip({ status: 'paused', progress: 40 }).label).toBe('Paused');
  });

  it('names weeks and says the chart in words', () => {
    // en-GB abbreviates September "Sept" in current ICU, as the module's own `day()` does.
    expect(weekLabel('2026-09-07')).toMatch(/^7 Sept?$/);
    expect(weekLabel('W36')).toBe('W36');
    expect(weeklySummary([])).toBe('No email delivered in the last 30 days.');
    expect(weeklySummary(DASH.weekly)).toMatch(/week of 7 Sept?: 3,702 delivered, 1,103 human opens/);
  });

  it('reads tags as typed, any script kept, without repeats', () => {
    expect(parseTags(' vendor, Tenders ,VENDOR,,  ශ්‍රී ලංකා ,  தமிழ் ')).toEqual(['vendor', 'Tenders', 'ශ්‍රී ලංකා', 'தமிழ்']);
    expect(parseTags('')).toEqual([]);
  });

  it('names the dedupe key and the phone key (last 9 digits)', () => {
    expect(matchedOn('email_key')).toBe('email key');
    expect(matchedOn('phone_key')).toBe('phone key (last 9 digits)');
    expect(matchedOn('name_org')).toBe('name at organisation');
    expect(phoneKey('+94 77 312 4521')).toBe(phoneKey('0773124521'));
  });

  it('shows a contact by name and masks the phone where the role says so', () => {
    expect(displayName(contact({ name: '', first_name: null, last_name: null }))).toBe('nimal@ceylonagri.lk');
    expect(shownPhone(contact())).toBe('+94 77 312 4521');
    const masked = shownPhone(contact({ phone_masked: true }));
    expect(masked).toBe(maskPhone('+94 77 312 4521'));
    expect(masked).toMatch(/\*\*\* 4521$/);
    expect(shownPhone(contact({ phone_masked: true, phone: '+94 77 *** 4521' }))).toBe('+94 77 *** 4521');
    expect(shownPhone(contact({ phone: null }))).toBeNull();
  });

  it('lists what updating a matched record would change, and nothing else (WF-02 step 5)', () => {
    const existing = contact({ job_title: null, email_consent: 'unknown' });
    const changes = changesFor(existing, {
      first_name: 'Nimal',
      email: 'NIMAL@ceylonagri.lk',
      phone: '0773124521',
      job_title: 'Procurement Manager',
      tags: ['Vendor', 'Tenders'],
      source: 'Manual',
      consent: { email: { state: 'subscribed', basis: 'consent' }, phone: { state: 'unknown', basis: 'unknown' } },
    });
    expect(changes.map((c) => c.field)).toEqual(['job_title', 'tags', 'email_consent']);
    expect(changes.find((c) => c.field === 'tags')?.to).toBe('vendor, Tenders');
    const body = updateFor(existing, { job_title: 'Procurement Manager', tags: ['Tenders'], consent: { email: { state: 'subscribed', basis: 'consent' } } }, changes);
    expect(body).toMatchObject({ first_name: 'Nimal', email: 'nimal@ceylonagri.lk', phone: '+94 77 312 4521', job_title: 'Procurement Manager', tags: ['vendor', 'Tenders'], source: 'Import · vendors.csv', owner_id: 9, organisation_id: 4 });
    expect(body.consent).toEqual({ email: { state: 'subscribed', basis: 'consent' } });
    // A masked number is never written back.
    expect('phone' in updateFor(contact({ phone_masked: true }), {}, [])).toBe(false);
  });

  it('knows the time zones, UTC first', () => {
    const zones = timeZones();
    expect(zones[0]).toBe('UTC');
    expect(zones).toContain('Asia/Colombo');
  });

  it('measures list consent coverage only when the server says', () => {
    expect(coverage({ members_count: 1006, email_subscribed_count: 214 })).toBeCloseTo(21.27, 1);
    expect(coverage({ members_count: 0, email_subscribed_count: 0 })).toBe(0);
    expect(coverage({ members_count: 10, email_subscribed_count: null })).toBeNull();
  });

  it('opens an organisation website only when it is one', () => {
    expect(websiteUrl('ceylonagri.lk')).toBe('https://ceylonagri.lk/');
    expect(websiteUrl('http://www.srilogix.lk/about')).toBe('http://www.srilogix.lk/about');
    expect(websiteUrl('not a site')).toBeNull();
    expect(websiteHost('https://www.harbourline.com/')).toBe('harbourline.com');
  });
});

describe('DK01 dashboard', () => {
  it('shows the KPIs and the open go-live items, each with its fix (MKT-DSH-01/02)', async () => {
    wrap(<Dashboard />);
    expect(await screen.findByText('4,812')).toBeTruthy();
    expect(screen.getByText('Audience, email and call activity for Livezen Technologies · last 30 days')).toBeTruthy();
    expect(screen.getByText('+212 this month')).toBeTruthy();
    expect(screen.getByText('82.5% of contacts')).toBeTruthy();
    expect(screen.getByText('31.4%')).toBeTruthy();
    expect(screen.getByText('1.1%')).toBeTruthy();
    expect(screen.getByText('Guard pauses at 5%')).toBeTruthy();
    expect(screen.getByText('Sending · 62%')).toBeTruthy();
    expect(screen.getByText('29.8%')).toBeTruthy();
    expect(screen.getByRole('img', { name: /week of 7 Sept?: 3,702 delivered/ })).toBeTruthy();

    expect(await screen.findByText('Go-live readiness · 2 items open')).toBeTruthy();
    expect(screen.getByText('Sending stays blocked until the red items are cleared. Owners are notified when each one changes.')).toBeTruthy();
    expect(screen.queryByText('marketing:send cron is not installed on production')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Fix: Marketing app is switched off for all companies' }));
    expect(tab.openLink).toHaveBeenCalledWith('/admin/apps');
    fireEvent.click(screen.getByRole('button', { name: 'Fix: Nobody holds marketing.call.make — call queue cannot be worked' }));
    expect(tab.go).toHaveBeenCalledWith('/marketing/settings');

    fireEvent.click(screen.getByRole('button', { name: 'September newsletter' }));
    expect(tab.go).toHaveBeenCalledWith('/marketing/campaigns/12/report');
  });

  it('says ready to send when every item is cleared', async () => {
    readiness = 'clear';
    wrap(<Dashboard />);
    expect(await screen.findByText('Ready to send · every go-live item is cleared')).toBeTruthy();
    expect(screen.queryByText(/Go-live readiness ·/)).toBeNull();
  });

  it('shows no readiness panel, and no invented blockers, when the server does not offer it', async () => {
    readiness = 'none';
    const client = wrap(<Dashboard />);
    expect(await screen.findByText('4,812')).toBeTruthy();
    await waitFor(() => expect(client.getQueryData(['marketing', 'readiness', '1'])).toEqual({ offered: false, message: NOT_OFFERED }));
    expect(screen.queryByText(/Go-live readiness/)).toBeNull();
    expect(screen.queryByText(/Ready to send/)).toBeNull();
    expect(screen.queryByText('Marketing app is switched off for all companies')).toBeNull();
  });
});

describe('DK02 contacts', () => {
  it('shows the bulk bar once a row is ticked, and suppresses the selection (MKT-AUD-05)', async () => {
    tab.route = '/marketing/contacts';
    vi.mocked(apiPost).mockResolvedValue({ affected: 1 } as never);
    wrap(<Contacts />);
    const box = await screen.findByRole('checkbox', { name: 'Select Nimal Perera' });
    // Kasun has no email and a masked phone: the masked number is what shows.
    expect(screen.getByText(maskPhone('+94 77 312 4521'))).toBeTruthy();
    expect(screen.queryByRole('group', { name: 'Bulk actions' })).toBeNull();
    fireEvent.click(box);
    const bar = await screen.findByRole('group', { name: 'Bulk actions' });
    expect(within(bar).getByText('1 selected')).toBeTruthy();
    for (const name of ['Add to list', 'Tag', 'Hand over to CRM', 'Suppress', 'More']) expect(within(bar).getByRole('button', { name })).toBeTruthy();

    fireEvent.click(within(bar).getByRole('button', { name: 'Suppress' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Suppress email' }));
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/api/marketing/contacts/bulk', { action: 'suppress_email', ids: [1] }, { org: '1' }));
    await waitFor(() => expect(toast).toHaveBeenCalledWith('success', 'Email suppressed for 1 contact.'));
    await waitFor(() => expect(screen.queryByRole('group', { name: 'Bulk actions' })).toBeNull());
  });

  it('opens Add contact for ?new=1 and clears the route when it closes', async () => {
    tab.route = '/marketing/contacts?new=1';
    wrap(<Contacts />);
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Add contact', { selector: 'h2' })).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(tab.go).toHaveBeenCalledWith('/marketing/contacts');
  });
});

describe('WF-02 add a contact', () => {
  const fill = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });

  it('shows the match and updates the existing record instead of creating a duplicate', async () => {
    const existing = contact({ id: 7, job_title: null });
    vi.mocked(apiPost).mockImplementation((async (path: string) => {
      if (path === '/api/marketing/contacts/match') return { key: 'email_key', contact: existing };
      throw new Error(`unexpected POST ${path}`);
    }) as never);
    vi.mocked(apiPut).mockResolvedValue({ ...existing, job_title: 'Procurement Manager' } as never);
    const onSaved = vi.fn();
    wrap(<ContactEditor onClose={vi.fn()} onSaved={onSaved} />);
    fill('First name', 'Nimal');
    fill('Email', 'NIMAL@ceylonagri.lk');
    fill('Job title', 'Procurement Manager');
    fireEvent.click(screen.getByRole('button', { name: 'Add contact' }));

    expect(await screen.findByText('Already in Marketing — matched on email key.')).toBeTruthy();
    expect(screen.getByText('What would change')).toBeTruthy();
    expect(screen.getByText('Procurement Manager')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Back' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Update existing' }));

    await waitFor(() => expect(apiPut).toHaveBeenCalledWith('/api/marketing/contacts/7', expect.objectContaining({ job_title: 'Procurement Manager', email: 'nimal@ceylonagri.lk', tags: ['vendor'] })));
    expect(apiPost).not.toHaveBeenCalledWith('/api/marketing/contacts', expect.anything(), expect.anything());
    expect(apiPost).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({ id: 7 })));
  });

  it('creates the contact, first consent unknown, when nothing matches', async () => {
    const created = contact({ id: 31, name: 'Ayesha Fernando', email: 'ayesha.f@harbourline.com', email_consent: 'unknown' });
    vi.mocked(apiPost).mockImplementation((async (path: string) => {
      if (path === '/api/marketing/contacts/match') return { key: null, contact: null };
      if (path === '/api/marketing/contacts') return created;
      throw new Error(`unexpected POST ${path}`);
    }) as never);
    const onSaved = vi.fn();
    wrap(<ContactEditor onClose={vi.fn()} onSaved={onSaved} />);
    expect((screen.getByRole('button', { name: 'Add contact' }) as HTMLButtonElement).disabled).toBe(true);
    fill('Email', 'ayesha.f@harbourline.com');
    fireEvent.click(screen.getByRole('button', { name: 'Add contact' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(created));
    expect(apiPost).toHaveBeenCalledWith('/api/marketing/contacts', expect.objectContaining({ email: 'ayesha.f@harbourline.com', source: 'Manual', consent: { email: { state: 'unknown', basis: 'unknown', evidence: null } } }), { org: '1' });
    expect(apiPut).not.toHaveBeenCalled();
    expect(toast).toHaveBeenCalledWith('success', 'Ayesha Fernando added.');
  });

  it('says a suppressed contact is saved but cannot be added to sends', async () => {
    vi.mocked(apiPost).mockImplementation((async (path: string) => (path === '/api/marketing/contacts/match' ? { key: null, contact: null } : contact({ id: 32, email_suppressed: true }))) as never);
    wrap(<ContactEditor onClose={vi.fn()} onSaved={vi.fn()} />);
    fill('Email', 'nimal@ceylonagri.lk');
    fireEvent.click(screen.getByRole('button', { name: 'Add contact' }));
    await waitFor(() => expect(toast).toHaveBeenCalledWith('warning', expect.stringContaining('cannot be added to sends')));
  });
});

describe('DK03 contact', () => {
  it('holds Call back for a do-not-call number and hands over to CRM (MKT-CRM-01/02)', async () => {
    tab.route = '/marketing/contacts/1';
    vi.mocked(apiPost).mockResolvedValue({ lead_id: 412, lead_number: 'LD-00412', created: true } as never);
    wrap(<ContactDetail id={1} />);
    expect(await screen.findByRole('heading', { level: 1, name: 'Nimal Perera' })).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Call (on the do-not-call list)' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText('On the do-not-call list')).toBeTruthy();
    expect(await screen.findByText('Opened “September newsletter”')).toBeTruthy();
    expect(screen.getByText('Append-only · entries are never edited')).toBeTruthy();
    expect(await screen.findByText(/C-2291/)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Hand over to CRM' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Hand over' }));
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/api/marketing/contacts/1/handover', { notes: null, owner_id: null }));
    await waitFor(() => expect(toast).toHaveBeenCalledWith('success', 'Handed over as lead LD-00412.'));
  });

  it('tells a contact that is not there from a server without the route', async () => {
    tab.route = '/marketing/contacts/99';
    wrap(<ContactDetail id={99} />);
    expect(await screen.findByText('This contact isn’t here')).toBeTruthy();
    cleanup();
    tab.route = '/marketing/contacts/98';
    wrap(<ContactDetail id={98} />);
    expect(await screen.findByText('This contact isn’t offered by this WorkSuite server yet')).toBeTruthy();
  });
});
