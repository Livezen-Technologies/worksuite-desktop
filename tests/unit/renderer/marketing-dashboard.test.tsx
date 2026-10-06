// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DashboardWide, Options } from '../../../src/modules/marketing/types';

/**
 * Marketing › Dashboard (DK01, MKT-DSH-01/02): the go-live readiness card with
 * who fixes what and where, the figures the server sent — and, from a server a
 * part behind, the figures it has without inventing the rest.
 */
const net = vi.hoisted(() => ({ apiGet: vi.fn(), apiPost: vi.fn(), request: vi.fn(), call: vi.fn(), go: vi.fn(), navigate: vi.fn(), toast: vi.fn() }));

vi.mock('../../../src/core/bridge', () => ({ call: net.call, on: () => () => undefined, hasDesktop: () => true, errorMessage: (e: unknown) => String(e), isMac: false, platform: 'linux' }));
vi.mock('../../../src/core/api', () => ({
  apiGet: net.apiGet, apiPost: net.apiPost, request: net.request, apiUrl: (p: string) => `app://bundle/__api${p}`,
  ApiError: class extends Error { constructor(readonly status: number, message: string) { super(message); } },
}));
vi.mock('../../../src/core/query', () => ({ queryClient: { invalidateQueries: vi.fn(async () => undefined) } }));
vi.mock('../../../src/core/tab-context', () => ({ useTab: () => ({ go: net.go, navigate: net.navigate, query: new URLSearchParams(), path: ['marketing'] }), useTabTitle: () => undefined }));
vi.mock('../../../src/core/toasts', () => ({ toast: net.toast }));

const { default: Dashboard } = await import('../../../src/modules/marketing/Dashboard');

const can = { dashboard: true, view: true, create: true, edit: true, delete: true, import: true, export: true, convert: true, lists: true, segments: true, suppression: true, settings: true, campaigns: true, campaign_create: true };
const options = {
  companies: [{ id: 7, name: 'Livezen Technologies', can, people: [] }],
  statuses: [], sources: [], channels: [], reasons: [], consent_sources: [], segment_fields: [], import_targets: [], import_existing: [], import_limits: { rows: 10000, bytes: 10485760 },
} as unknown as Options;

const older: DashboardWide = {
  days: 30,
  totals: { contacts: 4812, active: 4000, new: 212, qualified: 88, subscribed: 3970, crm_leads: 47, unsubscribes: 12, suppressed: 142 },
  growth: [],
  statuses: [{ key: 'new', label: 'New', contacts: 1200 }],
  sources: [{ key: 'import', label: 'Spreadsheet import', contacts: 3000 }],
  recent_imports: [],
};

const wide: DashboardWide = {
  ...older,
  readiness: {
    live: false, open: 2,
    items: [
      { key: 'mail_route', ok: false, title: 'No module route for marketing mail', detail: 'Mail infrastructure', owner: 'Ops', fix: { label: 'Fix', href: '/admin/mail-relay' } },
      { key: 'footer_address', ok: false, title: 'No postal address for the footer', detail: 'Marketing settings', owner: 'Admin', fix: { label: 'Fix', href: '/marketing?view=settings' } },
      { key: 'app_enabled', ok: true, title: 'Marketing app is switched on', detail: 'Admin Center › Apps', owner: 'Admin', fix: null },
    ],
  },
  email: { sent: 9000, delivered: 8900, human_open_rate: 31.4, bounce_rate: 5.2, bounce_guard: 5, weekly: [{ week: '2026-09-21', delivered: 1200, human_opens: 400 }, { week: '2026-09-28', delivered: 1800, human_opens: 500 }] },
  campaigns: {
    recent: [{ id: 12, org_id: 7, name: 'September newsletter', objective: null, status: 'sent', status_label: 'Sent', status_note: null, owner: null, subject: null, preheader: null, from_name: null, from_email: null, reply_to: null, audience: { lists: [], segments: [], exclude_lists: [], exclude_segments: [] }, track_opens: true, track_clicks: true, pace_per_hour: null, scheduled_at: null, started_at: null, finished_at: null, recipients: 3702, created_at: null, updated_at: null, stats: { recipients: 3702, sent: 3702, bounced: 2, opened: 1100, clicked: 144, unsubscribed: 3, human: 1000 } }],
    counts: { all: 1, sent: 1 },
  },
  calls: { in_queue: 214, claimed_now: 6, callbacks_today: 9, reached: 388, interested_to_crm: 47 },
  consent: { contacts: 4812, email_granted: 3970, phone_granted: 1214, email_suppressed: 142, do_not_call: 61 },
};

function wrap(node: ReactNode) {
  return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{node}</QueryClientProvider>);
}

beforeEach(() => Object.values(net).forEach((f) => f.mockReset()));
afterEach(cleanup);

describe('Marketing › Dashboard (DK01)', () => {
  it('lists what blocks going live, who owns it, and sends each Fix where it is fixed', async () => {
    net.apiGet.mockResolvedValue(wide);
    net.call.mockResolvedValue(true);
    const onGo = vi.fn();
    wrap(<Dashboard org="7" options={options} onGo={onGo} />);

    expect(await screen.findByText('Go-live readiness · 2 items open')).toBeTruthy();
    const checks = screen.getByRole('list', { name: 'Go-live checks' });
    expect(within(checks).getByText('No module route for marketing mail')).toBeTruthy();
    expect(within(checks).getByText('Mail infrastructure · Ops')).toBeTruthy();
    expect(within(checks).getByText('Marketing app is switched on')).toBeTruthy();

    // A web page of the server opens in the browser; Marketing's own opens in this tab.
    fireEvent.click(screen.getByRole('button', { name: 'Fix: No module route for marketing mail' }));
    expect(net.call).toHaveBeenCalledWith('app:openInBrowser', { path: '/admin/mail-relay' });
    fireEvent.click(screen.getByRole('button', { name: 'Fix: No postal address for the footer' }));
    expect(net.go).toHaveBeenCalledWith('/marketing?view=settings');
    expect(net.apiGet).toHaveBeenCalledWith('/api/marketing/dashboard', { org: '7', days: 30 }, expect.any(AbortSignal));
  });

  it('shows the figures the server sent, and each card leads somewhere', async () => {
    net.apiGet.mockResolvedValue(wide);
    const onGo = vi.fn();
    wrap(<Dashboard org="7" options={options} onGo={onGo} />);

    expect(await screen.findByText('4,812')).toBeTruthy();
    expect(screen.getByText('31.4%')).toBeTruthy();
    expect(screen.getByText('5.2%')).toBeTruthy();
    expect(screen.getByText('The guard pauses a campaign at 5%')).toBeTruthy();
    expect(screen.getByText('Email delivery · weekly')).toBeTruthy();
    expect(screen.getByText('214')).toBeTruthy();
    expect(screen.getByRole('meter', { name: 'Do-not-call' }).getAttribute('aria-valuenow')).toBe('61');

    // The opens column is the human one when the server counts it: 1,000 of 3,700 reached, not 1,100.
    expect(screen.getByText('27%')).toBeTruthy();
    expect(screen.queryByText('29.7%')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Open queue' }));
    expect(onGo).toHaveBeenCalledWith({ view: 'queue' });
    fireEvent.click(screen.getByRole('button', { name: 'September newsletter' }));
    expect(onGo).toHaveBeenCalledWith({ view: 'campaign', id: 12 });
    fireEvent.click(screen.getByRole('button', { name: /May be emailed/ }));
    expect(onGo).toHaveBeenCalledWith({ view: 'contacts', filter: { subscribed: 'yes' } });

    fireEvent.click(screen.getByRole('tab', { name: '7 days' }));
    await waitFor(() => expect(net.apiGet).toHaveBeenCalledWith('/api/marketing/dashboard', { org: '7', days: 7 }, expect.any(AbortSignal)));
  });

  it('from a server a part behind, shows what it has and leaves the rest off rather than at nought', async () => {
    net.apiGet.mockResolvedValue(older);
    wrap(<Dashboard org="7" options={options} onGo={vi.fn()} />);

    expect(await screen.findByText('4,812')).toBeTruthy();
    expect(screen.getByText('Qualified')).toBeTruthy();
    expect(screen.getByText('142')).toBeTruthy();
    expect(screen.queryByText(/Go-live readiness/)).toBeNull();
    expect(screen.queryByText('Human open rate')).toBeNull();
    expect(screen.queryByText('Email delivery · weekly')).toBeNull();
    expect(screen.queryByText('Calls')).toBeNull();
    expect(screen.getByText('No spreadsheet imported yet.')).toBeTruthy();
  });

  it('says so when every go-live check passes', async () => {
    net.apiGet.mockResolvedValue({ ...wide, readiness: { live: true, open: 0, items: wide.readiness!.items.map((i) => ({ ...i, ok: true, fix: null })) } });
    wrap(<Dashboard org="7" options={options} onGo={vi.fn()} />);
    expect(await screen.findByText('Ready to send: every go-live check passes.')).toBeTruthy();
  });
});
