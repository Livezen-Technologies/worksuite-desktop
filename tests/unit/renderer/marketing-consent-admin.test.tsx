// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as CoreApi from '../../../src/core/api';

vi.mock('../../../src/core/api', async (orig) => ({ ...(await orig<typeof CoreApi>()), apiGet: vi.fn(), apiPost: vi.fn(), apiPut: vi.fn(), apiDelete: vi.fn() }));
vi.mock('../../../src/core/bridge', () => ({ call: vi.fn(), on: () => () => undefined, hasDesktop: () => false, errorMessage: (e: unknown) => String(e), isMac: false, registerDropped: vi.fn() }));
vi.mock('../../../src/core/toasts', () => ({ toast: vi.fn() }));
const tab = { route: '/marketing/consent', go: vi.fn(), navigate: vi.fn(), openLink: vi.fn() };
vi.mock('../../../src/core/tab-context', () => ({
  useTab: () => {
    const [path, qs = ''] = tab.route.split('?');
    return { query: new URLSearchParams(qs), path: path!.split('/').filter(Boolean), go: tab.go, navigate: tab.navigate, openInNewTab: vi.fn(), active: true, openLink: tab.openLink };
  },
  useTabTitle: () => undefined,
}));

import { ApiError, apiDelete, apiGet } from '../../../src/core/api';
import { app } from '../../../src/core/app-state';
import { toast } from '../../../src/core/toasts';
import type { MarketingSettings } from '../../../src/modules/marketing/api';
import { NOT_OFFERED } from '../../../src/modules/marketing/api';
import Automation, { stepLook } from '../../../src/modules/marketing/admin/Automation';
import Reports, { campaignRates, monthLabel } from '../../../src/modules/marketing/admin/Reports';
import Settings, { formOf, notKept, settingsPatch, validateCalls, validateSending } from '../../../src/modules/marketing/admin/Settings';
import Consent, { ledgerActor, ledgerChange, suppressionKeyError } from '../../../src/modules/marketing/consent/Consent';
import Topics, { footerLine } from '../../../src/modules/marketing/consent/Topics';

/**
 * Marketing's consent and admin screens (WS-MKT-SRS-001 DK12, DK13, DK14, P01; MKT-CON, MKT-SUP, MKT-SET, MKT-AUT,
 * MKT-ANL): the suppression list and the append-only ledger, removal that needs a reason, the preference-centre
 * preview built from real topics, the settings checks, and the honest planned states of automation and analytics.
 */
const wrap = (ui: ReactNode) => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>);
const notFound = () => new ApiError(404, 'The server answered 404.', null);
const page = <T,>(rows: T[]) => ({ data: rows, current_page: 1, last_page: 1, per_page: 50, total: rows.length });

const SUPPRESSIONS = [
  { id: 7, key: 'dilini@greenleaf.lk', type: 'email', reason: 'unsubscribe', source: 'One-click (RFC 8058)', since: '2026-09-23 08:12:00', scope: 'Livezen Technologies' },
  { id: 8, key: 'rizan@eastcoast.lk', type: 'email', reason: 'hard_bounce', source: 'SES bounce report', since: '2026-09-28 10:00:00', scope: 'Livezen Technologies' },
  { id: 9, key: '…4458 (last 9)', type: 'phone', reason: 'do_not_call', source: 'Call outcome · Sanduni K.', since: '2026-09-30 11:00:00', scope: 'Livezen Technologies' },
];

const LEDGER = [
  { id: 1, at: '2026-09-23 08:12:00', contact: { id: 41, name: 'Dilini Perera' }, channel: 'email', change: 'withdrawn', basis: 'preference_centre', evidence: 'One-click unsubscribe', actor: { kind: 'contact', name: null } },
  { id: 2, at: '2026-09-28 10:00:00', contact: { id: 42, name: 'Rizan Hameed' }, channel: 'email', change: 'bounced', basis: null, evidence: 'SES bounce report', actor: { kind: 'system', name: null } },
  { id: 3, at: '2026-09-30 11:00:00', contact: { id: 43, name: 'සඳුනි කුමාරි' }, channel: 'phone', change: 'granted', basis: 'verbal', evidence: 'On the call of 30 Sep', actor: { kind: 'user', name: 'Sanduni K.' } },
];

const SETTINGS: MarketingSettings = {
  sending: {
    route: 'marketing',
    routes: [
      { id: 'marketing', label: 'Marketing route · CoreMailInfrastructureService' },
      { id: 'transactional', label: 'Transactional route', transactional: true },
    ],
    hourly_pace: 1200,
    relay_priority: 8,
    bounce_guard_percent: 5,
    max_test_recipients: 5,
    default_time_zone: 'Asia/Colombo',
    postal_address: 'Livezen Technologies, Colombo 03, Sri Lanka',
  },
  calls: { hours_from: '09:00:00', hours_to: '18:00:00', contact_local: true, max_attempts: 3, retry_delay_hours: 24, claim_release_minutes: 20 },
  consent: { require_phone_consent: true, double_opt_in: false, held_back: 792 },
  policies: { detect_machine_opens: true, one_click_unsubscribe: true, notify_owner: true },
  can_edit: true,
};

const TOPICS = [
  { id: 1, name: 'Services news', description: 'Care packages, new services', subscribers_count: 1204, public: true },
  { id: 2, name: 'Internal tests', description: null, subscribers_count: 3, public: false },
];

const CAMPAIGN = {
  id: 12,
  name: 'September newsletter',
  status: 'sent',
  topic: { id: 1, name: 'Services news' },
  lists: [],
  segments: [],
  audience_label: 'Customers (list)',
  started_at: '2026-09-28 04:30:00',
  scheduled_at: null,
  finished_at: '2026-09-28 07:36:00',
  recipients_count: 3702,
  sent_count: 3702,
  delivered_count: 3661,
  human_opens: 1091,
  clicks: 143,
  unsubscribes: 12,
  bounces: 41,
  bounce_rate: 1.1,
  progress: null,
  paused_reason: null,
};

let topics: unknown[] = TOPICS;

beforeEach(() => {
  tab.route = '/marketing/consent';
  tab.go.mockReset();
  tab.navigate.mockReset();
  topics = TOPICS;
  vi.mocked(toast).mockReset();
  vi.mocked(apiDelete).mockReset();
  vi.mocked(apiGet).mockReset();
  vi.mocked(apiGet).mockImplementation((async (path: string, query?: Record<string, unknown>) => {
    switch (path) {
      case '/api/marketing/suppressions':
        return query?.reason === 'do_not_call' ? page(SUPPRESSIONS.filter((s) => s.reason === 'do_not_call')) : page(SUPPRESSIONS);
      case '/api/marketing/consent-ledger':
        return page(LEDGER);
      case '/api/marketing/settings':
        return SETTINGS;
      case '/api/marketing/topics':
        return topics;
      case '/api/marketing/campaigns':
        return page([CAMPAIGN]);
      case '/api/access/module/Marketing':
        return {
          permissions: [
            { slug: 'marketing.view', name: 'View Marketing', held: true },
            { slug: 'marketing.call.make', name: 'Make calls', held: false },
          ],
          why: null,
        };
      default:
        throw notFound();
    }
  }) as never);
  app.set({ organizationId: '1', bootstrap: { permissions: [], organizations: [{ id: '1', name: 'Livezen Technologies' }] } as never });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('Consent & suppression (DK12)', () => {
  it('lists the suppression rows of a page, with the tab counts', async () => {
    wrap(<Consent />);
    expect(await screen.findByText('dilini@greenleaf.lk')).toBeTruthy();
    const table = screen.getByRole('table', { name: 'Suppression list' });
    expect(within(table).getByText('rizan@eastcoast.lk')).toBeTruthy();
    expect(within(table).getByText('Hard bounce')).toBeTruthy();
    expect(within(table).getByText('…4458 (last 9)')).toBeTruthy();
    expect(await screen.findByRole('tab', { name: 'Suppression list (3)' })).toBeTruthy();
    expect(await screen.findByRole('tab', { name: 'Do-not-call (1)' })).toBeTruthy();
    // Double opt-in is planned while the server does not report it on (MKT-CON-09).
    expect(screen.getByText(/Double opt-in for web sign-ups is planned/)).toBeTruthy();
  });

  it('shows the ledger append-only: no edit or delete on any row (AC-13)', async () => {
    tab.route = '/marketing/consent?tab=ledger';
    wrap(<Consent />);
    const table = await screen.findByRole('table', { name: 'Consent ledger' });
    const [, preference, bounce, call] = within(table).getAllByRole('row');
    expect(within(preference!).getByText('Withdrawn')).toBeTruthy();
    expect(within(preference!).getByText('Contact')).toBeTruthy();
    expect(within(bounce!).getByText('System')).toBeTruthy();
    expect(within(call!).getByText('Sanduni K.')).toBeTruthy();
    expect(within(call!).getByText('Verbal, on a call')).toBeTruthy();
    const buttons = within(table).queryAllByRole('button');
    expect(buttons.map((b) => b.textContent)).toEqual(['Dilini Perera', 'Rizan Hameed', 'සඳුනි කුමාරි']);
    expect(within(table).queryByRole('button', { name: /edit|delete|remove|correct/i })).toBeNull();
    expect(screen.getByText('Append-only · entries are never edited')).toBeTruthy();
    fireEvent.click(within(table).getByRole('button', { name: 'Dilini Perera' }));
    expect(tab.go).toHaveBeenCalledWith('/marketing/contacts/41');
  });

  it('needs a reason before a removal is sent, and says plainly when the server does not offer it (MKT-SUP-05)', async () => {
    vi.mocked(apiDelete).mockRejectedValue(notFound());
    wrap(<Consent />);
    fireEvent.click(await screen.findByRole('button', { name: 'Remove the suppression of dilini@greenleaf.lk' }));
    const confirm = screen.getByRole('button', { name: 'Remove suppression' }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    fireEvent.click(confirm);
    fireEvent.change(screen.getByLabelText(/^Reason/), { target: { value: '   ' } });
    expect(confirm.disabled).toBe(true);
    expect(apiDelete).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText(/^Reason/), { target: { value: 'Asked again in writing' } });
    expect(confirm.disabled).toBe(false);
    fireEvent.click(confirm);
    await waitFor(() => expect(apiDelete).toHaveBeenCalledWith('/api/marketing/suppressions/7', { reason: 'Asked again in writing' }));
    expect(await screen.findByText(/does not offer it yet, so nothing was changed/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Remove suppression' })).toBeNull();
  });

  it('says when this server does not offer the ledger export (MKT-CON-07)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ message: 'Not found.' }), { status: 404, headers: { 'content-type': 'application/json' } })));
    wrap(<Consent />);
    fireEvent.click(screen.getByRole('button', { name: 'Export ledger' }));
    await waitFor(() => expect(toast).toHaveBeenCalledWith('info', NOT_OFFERED));
  });

  it('checks a key before it is suppressed, and labels ledger changes and actors', () => {
    expect(suppressionKeyError('email', '')).toBeNull();
    expect(suppressionKeyError('email', 'info@ceylonagri.lk')).toBeNull();
    expect(suppressionKeyError('email', 'info@')).toMatch(/email address/);
    expect(suppressionKeyError('phone', '+94 77 123 4567')).toBeNull();
    expect(suppressionKeyError('phone', '4567')).toMatch(/last 9 digits/);
    expect(ledgerChange('opt_in')).toEqual({ label: 'Opt-in', tone: 'success' });
    expect(ledgerChange('withdrawn').tone).toBe('danger');
    expect(ledgerChange('pending').tone).toBe('violet');
    expect(ledgerChange('re_permission')).toEqual({ label: 're permission', tone: 'muted' });
    expect(ledgerActor({ kind: 'contact', name: 'n@x.lk' })).toBe('Contact');
    expect(ledgerActor({ kind: 'system', name: 'SES' })).toBe('System');
    expect(ledgerActor({ kind: 'user', name: 'Hasarinda S.' })).toBe('Hasarinda S.');
  });
});

describe('Topics & preferences (P01)', () => {
  it('builds the preference-centre preview only from the topics shown there', async () => {
    tab.route = '/marketing/topics';
    wrap(<Topics />);
    const table = await screen.findByRole('table', { name: 'Topics' });
    expect(within(table).getByText('Internal tests')).toBeTruthy();
    const preview = screen.getByRole('heading', { name: 'Your email preferences' }).parentElement!;
    expect(within(preview).getByText('Services news')).toBeTruthy();
    expect(within(preview).getByText('Care packages, new services')).toBeTruthy();
    expect(within(preview).queryByText('Internal tests')).toBeNull();
    expect(within(preview).getByText('Save preferences')).toBeTruthy();
    // The postal address of the fixture starts with the company's name: named once.
    expect(await screen.findByText('Livezen Technologies, Colombo 03, Sri Lanka')).toBeTruthy();
    expect(screen.queryByText(/Livezen Technologies · Livezen Technologies/)).toBeNull();
  });

  it('names the company once in the preview’s foot', () => {
    expect(footerLine('Livezen Technologies', 'Livezen Technologies, 12 Galle Road, Colombo 03')).toBe('Livezen Technologies, 12 Galle Road, Colombo 03');
    expect(footerLine('Livezen Technologies', '12 Galle Road, Colombo 03')).toBe('Livezen Technologies · 12 Galle Road, Colombo 03');
    expect(footerLine('Livezen Technologies', '  ')).toBe('Livezen Technologies');
    expect(footerLine(null, '12 Galle Road')).toBe('12 Galle Road');
    expect(footerLine(null, null)).toBeNull();
  });

  it('draws no sample topics when none is shown', async () => {
    topics = [{ ...TOPICS[1] }];
    tab.route = '/marketing/topics';
    wrap(<Topics />);
    const preview = (await screen.findByRole('heading', { name: 'Your email preferences' })).parentElement!;
    expect(within(preview).getByText(/No topic is shown in the preference centre yet/)).toBeTruthy();
    expect(within(preview).queryByText('Save preferences')).toBeNull();
    expect(within(preview).getByText('Unsubscribe from all')).toBeTruthy();
  });
});

describe('Settings (DK13)', () => {
  it('rejects a relay priority of transactional mail and a bounce guard of 0 (MKT-SET-02)', () => {
    const ok = { route: 'marketing', hourly_pace: 1200, relay_priority: 8, bounce_guard_percent: 5, max_test_recipients: 5 };
    expect(validateSending(ok, SETTINGS.sending.routes)).toEqual({});
    expect(validateSending({ ...ok, relay_priority: 3 })).toHaveProperty('relay_priority');
    expect(validateSending({ ...ok, bounce_guard_percent: 0 })).toHaveProperty('bounce_guard_percent');
    expect(Object.keys(validateSending({ ...ok, relay_priority: '3', bounce_guard_percent: '0' })).sort()).toEqual(['bounce_guard_percent', 'relay_priority']);
    expect(validateSending({ ...ok, relay_priority: 10, bounce_guard_percent: 21 })).toMatchObject({ relay_priority: expect.any(String), bounce_guard_percent: expect.any(String) });
    expect(validateSending({ ...ok, hourly_pace: '0', max_test_recipients: 6 })).toMatchObject({ hourly_pace: expect.any(String), max_test_recipients: expect.any(String) });
    expect(validateSending({ ...ok, bounce_guard_percent: '2.5' })).toEqual({});
    expect(validateSending({ ...ok, route: 'transactional' }, SETTINGS.sending.routes)).toHaveProperty('route');
    expect(validateSending({ ...ok, postal_address: ' ' })).toHaveProperty('postal_address');
    expect(validateSending({ ...ok, postal_address: undefined })).toEqual({});
  });

  it('checks calling hours, and sends only what changed', () => {
    const calls = { hours_from: '09:00', hours_to: '18:00', max_attempts: 3, retry_delay_hours: 24, claim_release_minutes: 20 };
    expect(validateCalls(calls)).toEqual({});
    expect(validateCalls({ ...calls, hours_to: '08:00' })).toHaveProperty('hours_to');
    expect(validateCalls({ ...calls, max_attempts: '0', hours_from: '25:00' })).toMatchObject({ max_attempts: expect.any(String), hours_from: expect.any(String) });

    const f = formOf(SETTINGS);
    expect(f.hours_from).toBe('09:00');
    expect(settingsPatch(SETTINGS, f)).toEqual({});
    expect(settingsPatch(SETTINGS, { ...f, relay_priority: '7', double_opt_in: true, hours_to: '17:30' })).toEqual({ sending: { relay_priority: 7 }, calls: { hours_to: '17:30' }, consent: { double_opt_in: true } });
    expect(notKept({ consent: { double_opt_in: true }, sending: { relay_priority: 7 } }, { ...SETTINGS, sending: { ...SETTINGS.sending, relay_priority: 7 } })).toEqual(['double opt-in']);
    expect(notKept({ calls: { hours_to: '17:30' } }, { ...SETTINGS, calls: { ...SETTINGS.calls, hours_to: '17:30:00' } })).toEqual([]);
    expect(notKept({ sending: { relay_priority: 7 } }, { message: 'Saved.' })).toEqual([]);
  });

  it('keeps Save off until something changed, and while a number is out of range', async () => {
    tab.route = '/marketing/settings/sending';
    wrap(<Settings tab="sending" />);
    const priority = (await screen.findByLabelText(/^Relay priority/)) as HTMLInputElement;
    expect(priority.value).toBe('8');
    const save = screen.getByRole('button', { name: 'Save changes' }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    expect(screen.getByText('Standard WorkSuite module settings · applies to Livezen Technologies')).toBeTruthy();
    expect(screen.getByText('792 contacts without phone consent held back')).toBeTruthy();
    fireEvent.change(priority, { target: { value: '3' } });
    expect(screen.getByText('From 6 to 9: 1–5 is kept for transactional mail.')).toBeTruthy();
    expect(save.disabled).toBe(true);
    fireEvent.change(priority, { target: { value: '7' } });
    expect(save.disabled).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Discard' }));
    expect(priority.value).toBe('8');
    expect(save.disabled).toBe(true);
  });

  it('lists my Marketing permissions and singles out marketing.call.make (B-5)', async () => {
    wrap(<Settings tab="user-access" />);
    const row = (await screen.findByText('Make calls')).closest('li')!;
    expect(row.getAttribute('data-permission')).toBe('marketing.call.make');
    expect(within(row).getByText('Go-live blocker')).toBeTruthy();
    expect(within(row).getByText('Not granted')).toBeTruthy();
    expect(screen.getByText(/of 2 Marketing permissions/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Roles in Admin Center' }));
    expect(tab.openLink).toHaveBeenCalledWith('/admin/roles');
  });

  it('draws the role model with the call permission singled out', () => {
    wrap(<Settings tab="permissions" />);
    const table = screen.getByRole('table', { name: 'Who can do what' });
    const call = within(table).getByText('marketing.call.make').closest('tr')!;
    expect(within(call).getByText('Go-live blocker')).toBeTruthy();
    expect(within(call).getAllByText('Optional')).toHaveLength(2);
  });

  it('marks double opt-in planned while the server reports it off, and lets it be asked for (MKT-CON-09)', async () => {
    wrap(<Settings tab="consent" />);
    const toggle = await screen.findByRole('switch', { name: 'Double opt-in for web sign-ups' });
    expect(toggle.getAttribute('aria-checked')).toBe('false');
    expect(screen.getByText('Planned')).toBeTruthy();
    expect(screen.getByText('792 contacts without phone consent held back from call queues')).toBeTruthy();
    const save = screen.getByRole('button', { name: 'Save changes' }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    fireEvent.click(toggle);
    expect(save.disabled).toBe(false);
  });
});

describe('Automation (DK14)', () => {
  it('shows the planned state, with Activate held back, when the server has no journeys (MKT-AUT, phase 4)', async () => {
    tab.route = '/marketing/automation';
    wrap(<Automation />);
    expect(await screen.findByText('Planned · phase 4')).toBeTruthy();
    expect(screen.getByText('Event-driven journeys across email, WhatsApp, SMS and calls — not in the current code')).toBeTruthy();
    expect(screen.getAllByText(/Example of a planned journey — nothing runs/).length).toBeGreaterThan(0);
    const activate = screen.getByRole('button', { name: 'Activate' });
    expect(activate.getAttribute('aria-disabled')).toBe('true');
    expect(activate.getAttribute('title')).toBe('Planned for phase 4');
    expect(screen.getByRole('button', { name: 'Test with a contact' }).getAttribute('aria-disabled')).toBe('true');
    expect(screen.getByText('Hand over to CRM', { selector: 'b' })).toBeTruthy();
    expect(stepLook('send_whatsapp').icon).toBe('message-circle');
    expect(stepLook('wait_until').icon).toBe('clock');
    expect(stepLook('list_join').icon).toBe('zap');
  });
});

describe('Reports (MKT-TRK-03, MKT-ANL-01)', () => {
  it('lists campaign reports with their rates, and says cross-campaign analytics are planned', async () => {
    tab.route = '/marketing/reports';
    wrap(<Reports />);
    const table = await screen.findByRole('table', { name: 'Campaign reports' });
    expect(within(table).getByText('98.9%')).toBeTruthy();
    expect(within(table).getByText('29.8%')).toBeTruthy();
    expect(within(table).getByText('3.9%')).toBeTruthy();
    expect(within(table).getByText('1.1%')).toBeTruthy();
    fireEvent.click(within(table).getByRole('button', { name: 'September newsletter' }));
    expect(tab.go).toHaveBeenCalledTimes(1);
    expect(tab.go).toHaveBeenCalledWith('/marketing/campaigns/12/report');
    expect(await screen.findByText(/Cross-campaign analytics by period, topic, list and channel, and a cohort of new contacts, are planned \(phase 3\)/)).toBeTruthy();
    expect(campaignRates({ sent_count: 0, delivered_count: 0, human_opens: 0, clicks: 0, bounces: 0, bounce_rate: null })).toEqual({ delivered: '—', opens: '—', clicks: '—', bounces: '—' });
    expect(monthLabel('2026-09')).toMatch(/^Sept? 2026$/);
    expect(monthLabel('soon')).toBe('soon');
  });
});
