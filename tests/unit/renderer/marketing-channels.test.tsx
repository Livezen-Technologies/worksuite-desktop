// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Options } from '../../../src/modules/marketing/types';

/**
 * Marketing › WS-D on the desktop (SRS v2.0): WhatsApp & SMS campaigns with
 * the server's estimate, cross-campaign analytics, budgets with ROI, webhooks
 * with their secret shown once, and a call's CDR — on the web's endpoints.
 * The rules are the server's (`marketing:channels-probe`).
 */
const net = vi.hoisted(() => ({ apiGet: vi.fn(), request: vi.fn(), call: vi.fn(), go: vi.fn(), navigate: vi.fn(), toast: vi.fn() }));

vi.mock('../../../src/core/bridge', () => ({ call: net.call, on: () => () => undefined, hasDesktop: () => true, errorMessage: (e: unknown) => String(e), isMac: false, platform: 'linux', registerDropped: vi.fn() }));
vi.mock('../../../src/core/api', () => ({
  apiGet: net.apiGet,
  request: net.request,
  apiUrl: (p: string) => p,
  ApiError: class extends Error {
    status = 422;
    data = null;
  },
}));
vi.mock('../../../src/core/tab-context', () => ({ useTab: () => ({ go: net.go, navigate: net.navigate, query: new URLSearchParams(), path: ['marketing'] }), useTabTitle: () => undefined }));
vi.mock('../../../src/core/toasts', () => ({ toast: net.toast }));

const { default: Channels } = await import('../../../src/modules/marketing/Channels');
const { default: Analytics } = await import('../../../src/modules/marketing/Analytics');
const { Budgets } = await import('../../../src/modules/marketing/Planning');
const { default: Webhooks } = await import('../../../src/modules/marketing/Webhooks');
const { CallRecord } = await import('../../../src/modules/marketing/calls-record');

const options = { companies: [{ id: 1, name: 'Livezen', can: { channels: true, analytics: true, budgets: true, webhooks: true }, people: [] }] } as unknown as Options;
const shown = (ui: ReactNode) => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>);

const routes: Record<string, unknown> = {
  '/api/marketing/channels': { items: [{ id: 4, org_id: 1, channel: 'sms', name: 'Draft SMS', status: 'draft', stats: null }] },
  '/api/marketing/channels/4': {
    campaign: { id: 4, org_id: 1, channel: 'sms', name: 'Draft SMS', status: 'draft', status_note: null, stats: null },
    estimate: { named: 10, final: 6, left_out: 4, text: { encoding: 'GSM-7', characters: 120, segments: 1, per_segment: 160 }, preview: 'Hi Nimal', price: 2.5, currency: 'LKR', cost: 15, gateway: { driver: 'log', label: 'Test', problem: null, test: true } },
    can: { manage: true },
  },
  '/api/marketing/reports/overview': { group: 'period', rows: [{ key: '2026-W42', sent: 100, delivered: 95, opened: 40, clicked: 10, unsubscribed: 1, bounced: 5, calls: 20, connected: 8 }], totals: { sent: 100, delivered: 95, opened: 40, clicked: 10, unsubscribed: 1, bounced: 5, calls: 20, connected: 8 } },
  '/api/marketing/budgets': { items: [{ id: 1, org_id: 1, name: 'Q4 SMS', ref_type: 'channel', ref_id: 4, ref_name: 'Draft SMS', planned: 1000, cost: 500, remaining: 500, leads: 4, revenue: 1500, cost_per_lead: 125, roi: 200, currency: null }], totals: { planned: 1000, cost: 500, leads: 4, revenue: 1500, cost_per_lead: 125, roi: 200 }, ref_types: [] },
  '/api/marketing/webhooks': { items: [], events: [{ value: 'contact.unsubscribed', label: 'A contact unsubscribed' }] },
  '/api/marketing/calls/log/5/cdr': { linked: true, voip_call_id: 2, talk_seconds: 95, disposition: 'answered', started_at: null, recording: null, recording_note: 'Nobody recorded that the contact agreed to the call being recorded.', voip: true },
};

beforeEach(() => {
  net.apiGet.mockReset();
  net.apiGet.mockImplementation(async (path: string) => routes[path] ?? {});
  net.request.mockReset();
  net.request.mockResolvedValue({ data: null, message: 'Done.' });
  net.toast.mockReset();
});
afterEach(cleanup);

describe('WhatsApp & SMS', () => {
  it('opens a draft with the server\'s estimate and sends it after asking', async () => {
    shown(<Channels org="" options={options} />);
    fireEvent.click(await screen.findByRole('button', { name: /Draft SMS/ }));

    expect(await screen.findByText('Before it goes')).toBeTruthy();
    expect(screen.getByText('LKR 15.00')).toBeTruthy();
    expect(screen.getByText(/the test one/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Send now' }));
    await waitFor(() => expect(net.request).toHaveBeenCalledWith('POST', '/api/marketing/channels/4/launch', { body: undefined }));
  });
});

describe('Analytics, budgets, webhooks, calls', () => {
  it('shows results by period', async () => {
    shown(<Analytics org="" options={options} />);
    expect(await screen.findByText('2026-W42')).toBeTruthy();
    expect(screen.getByText('95.0%')).toBeTruthy();
  });

  it('shows the server\'s ROI', async () => {
    shown(<Budgets org="" options={options} />);
    expect(await screen.findByText('Q4 SMS')).toBeTruthy();
    expect(screen.getAllByText('200%').length).toBeGreaterThan(0);
  });

  it('adds a webhook and shows its secret once', async () => {
    net.request.mockResolvedValueOnce({ data: { id: 3, secret: 'whsec_desk' }, message: 'Added' });
    shown(<Webhooks org="" options={options} />);
    fireEvent.click(await screen.findByRole('button', { name: /Webhook/ }));
    fireEvent.change(screen.getByDisplayValue('https://'), { target: { value: 'https://hooks.example.com/x' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));

    expect(await screen.findByText('whsec_desk')).toBeTruthy();
    expect(net.request).toHaveBeenCalledWith('POST', '/api/marketing/webhooks', { body: { org_id: 1, name: '', url: 'https://hooks.example.com/x', events: ['contact.unsubscribed'] } });
  });

  it('reads a call\'s CDR on request', async () => {
    shown(<CallRecord callId={5} />);
    fireEvent.click(screen.getByRole('button', { name: /Talk time/ }));
    expect(await screen.findByText(/Talk time 1:35/)).toBeTruthy();
    expect(screen.getByText(/agreed to the call being recorded/)).toBeTruthy();
  });
});
