// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CampaignDetail, Options } from '../../../src/modules/marketing/types';
import type { Block } from '../../../src/modules/marketing/email-blocks';

/**
 * Marketing › WS-B on the desktop (SRS v2.0): the deliverability panel and its
 * one-click fixes, approval, version history, the deliverability page, and a
 * block's show/hide rule kept through a save — on the same endpoints as the
 * web. The rules are the server's (`marketing:governance-probe`).
 */
const net = vi.hoisted(() => ({ apiGet: vi.fn(), request: vi.fn(), call: vi.fn(), go: vi.fn(), navigate: vi.fn(), toast: vi.fn() }));

vi.mock('../../../src/core/bridge', () => ({ call: net.call, on: () => () => undefined, hasDesktop: () => true, errorMessage: (e: unknown) => String(e), isMac: false, platform: 'linux', registerDropped: vi.fn() }));
vi.mock('../../../src/core/api', () => ({
  apiGet: net.apiGet,
  request: net.request,
  ApiError: class extends Error {
    status = 422;
    data = null;
  },
}));
vi.mock('../../../src/core/tab-context', () => ({ useTab: () => ({ go: net.go, navigate: net.navigate, query: new URLSearchParams(), path: ['marketing'] }), useTabTitle: () => undefined }));
vi.mock('../../../src/core/toasts', () => ({ toast: net.toast }));

const { ApprovalBar, DeliverabilityPanel, VersionHistory } = await import('../../../src/modules/marketing/email-governance');
const { default: Deliverability } = await import('../../../src/modules/marketing/Deliverability');
const blocks = await import('../../../src/modules/marketing/email-blocks');

const campaign = {
  id: 7, org_id: 1, name: 'October', status: 'draft', status_label: 'Draft', updated_at: '2026-10-22 09:00:00', body_html: '', subject: 'Hello',
  can: { edit: true, launch: true, pause: true, create: true, results: true, templates: true },
} as unknown as CampaignDetail;

const panel = {
  score: 72, grade: 'fair', counts: { pass: 2, warn: 1, fail: 0 },
  checks: [
    { group: 'content', key: 'subject_length', status: 'warn', title: 'Subject: 72 characters', detail: 'Phones show about 40–60.', fix: { key: 'shorten_subject', label: 'Shorten' } },
    { group: 'compliance', key: 'unsubscribe', status: 'pass', title: 'Unsubscribe link and one-click header', detail: 'Always.', fix: null },
    { group: 'audience', key: 'risky', status: 'pass', title: '0 risky address(es)', detail: 'None.', fix: null },
  ],
  spam: { score: 1.5, threshold: 5 }, ai: false, editable: true, domain: null, seed_tests: [], seeds: [], can: { edit: true, launch: true },
  suggestions: [{ key: 'exclude_unengaged', label: 'Leave them out', why: '120 not engaged in 180 days', tone: 'warn', impact: '120 fewer recipients' }],
};

const client = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });
const shown = (ui: ReactNode) => render(<QueryClientProvider client={client()}>{ui}</QueryClientProvider>);

beforeEach(() => {
  net.apiGet.mockReset();
  net.request.mockReset();
  net.request.mockResolvedValue({ data: null, message: 'Done.' });
  net.toast.mockReset();
});
afterEach(cleanup);

describe('a block\'s show/hide rule (MKT-EDT-08)', () => {
  it('is written on its mark and read back', () => {
    const list: Block[] = [{ id: blocks.newId(), type: 'text', html: '<p>VIP</p>', rule: { mode: 'show', segment: 4 } }];
    const html = blocks.serializeBlocks(list);

    expect(html).toContain('data-block="text" data-show-segment="4"');
    expect(blocks.parseBlocks(html)[0]?.rule).toEqual({ mode: 'show', segment: 4 });
  });
});

describe('the deliverability panel', () => {
  it('shows the score and the checks, and applies a suggestion through the server', async () => {
    net.apiGet.mockResolvedValue(panel);
    const onChanged = vi.fn(async () => undefined);
    shown(<DeliverabilityPanel campaign={campaign} dirty={false} onChanged={onChanged} />);

    expect((await screen.findByRole('meter', { name: 'Deliverability score' })).getAttribute('aria-valuenow')).toBe('72');
    expect(screen.getByText('Subject: 72 characters')).toBeTruthy();
    fireEvent.click(within(screen.getByText('Leave them out').closest('li') as HTMLElement).getByRole('button', { name: 'Apply' }));

    await waitFor(() => expect(net.request).toHaveBeenCalledWith('POST', '/api/marketing/campaigns/7/deliverability/fix', { body: { fix: 'exclude_unengaged', at: undefined } }));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
  });
});

describe('approval (MKT-EML-05)', () => {
  it('sends a change back with the approver\'s note', async () => {
    net.apiGet.mockResolvedValue({ required: true, status: 'pending', label: 'Waiting for approval', note: null, decided_at: null, can_request: false, can_decide: true, own: false, history: [] });
    shown(<ApprovalBar campaign={campaign} dirty={false} onChanged={async () => undefined} />);

    fireEvent.click(await screen.findByRole('button', { name: 'Ask for changes' }));
    const send = screen.getByRole('button', { name: 'Send back' });
    expect((send as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Add the price' } });
    fireEvent.click(send);

    await waitFor(() => expect(net.request).toHaveBeenCalledWith('POST', '/api/marketing/campaigns/7/approval/reject', { body: { note: 'Add the price' } }));
  });
});

describe('version history (MKT-EDT-06)', () => {
  it('compares an older version and restores it', async () => {
    net.apiGet.mockImplementation(async (path: string) => (path.endsWith('/versions')
      ? { keep: 20, items: [{ id: 5, version: 2, note: null, by: 'Mia', created_at: null, subject: 'Now', changed: [] }, { id: 4, version: 1, note: 'Created', by: 'Mia', created_at: null, subject: 'Then', changed: ['Subject'] }] }
      : { version: 1, created_at: null, fields: [{ field: 'subject', label: 'Subject', then: 'Then', now: 'Now' }] }));
    shown(<VersionHistory campaign={campaign} onClose={() => undefined} onRestored={async () => undefined} />);

    fireEvent.click(await screen.findByRole('button', { name: /Version 1/ }));
    expect(await screen.findByText('Then')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Restore this version' }));

    await waitFor(() => expect(net.request).toHaveBeenCalledWith('POST', '/api/marketing/campaigns/7/versions/4/restore', { body: undefined }));
  });
});

describe('the deliverability page (MKT-DLV-01/03)', () => {
  it('shows each domain with its DNS, rates and warm-up', async () => {
    net.apiGet.mockResolvedValue({
      org_id: 1, seeds: ['seed@gmail.com'], can: { manage: true }, warmup_default: { start_cap: 50, growth_percent: 40, max_cap: 50000 },
      limits: { bounce_warn: 2, bounce_fail: 5, complaint_warn: 0.1, complaint_fail: 0.3 },
      items: [{
        domain: 'news.example', may_send: true, reason: null, spf: 'valid', dkim: 'valid', dmarc: 'warning', checked_at: null,
        stats: { sent: 500, bounce_rate: 1.2, complaint_rate: 0, open_rate: 30 }, health: 'warning', advice: ['Publish a DMARC record'],
        warmup: { id: 1, domain: 'news.example', status: 'active', start_cap: 50, growth_percent: 40, max_cap: 50000, started_on: '2026-10-21', cap_today: 70, used_today: 5, days_to_max: 20, schedule: [{ date: '2026-10-22', cap: 70 }] },
      }],
    });
    const options = { companies: [{ id: 1, name: 'Acme', can: { campaigns: true }, people: [] }] } as unknown as Options;
    shown(<Deliverability org="" options={options} />);

    expect(await screen.findByText('news.example')).toBeTruthy();
    expect(screen.getByText('Needs attention')).toBeTruthy();
    expect(screen.getByText(/5 of 70 today/)).toBeTruthy();
    expect(screen.getByText('Publish a DMARC record')).toBeTruthy();
    expect(net.apiGet).toHaveBeenCalledWith('/api/marketing/deliverability/domains', { org_id: '1' }, expect.anything());
  });
});
