// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as CoreApi from '../../../src/core/api';

vi.mock('../../../src/core/api', async (orig) => ({ ...(await orig<typeof CoreApi>()), apiGet: vi.fn(), apiGetMeta: vi.fn(), apiPost: vi.fn(), apiPut: vi.fn(), apiDelete: vi.fn() }));
vi.mock('../../../src/core/bridge', () => ({ call: vi.fn(async () => null), on: () => () => undefined, errorMessage: (e: unknown) => (e instanceof Error ? e.message : String(e)), isMac: false, hasDesktop: () => true }));
vi.mock('../../../src/core/toasts', () => ({ toast: vi.fn() }));

import { ApiError, apiGet, apiPost } from '../../../src/core/api';
import { app } from '../../../src/core/app-state';
import { TabProvider } from '../../../src/core/tab-context';
import { setRegional } from '../../../src/core/time';
import { AdminProtection } from '../../../src/modules/mail/protection/admin/AdminProtection';
import { AdminQuarantineSide } from '../../../src/modules/mail/protection/admin/AdminQuarantine';
import { actionChoices, thresholdProblems } from '../../../src/modules/mail/protection/admin/Policies';
import type { AdminQuarantineItem, Verdict } from '../../../src/modules/mail/protection/types';

/**
 * Admin Center › Mail & Communication › Protection (ENH-MAIL-04 D21–D25) in the desktop's own Admin Center: shown to
 * whoever may see mail security; malware has no Release or Approve; a DMARC p=reject allow is refused in the server's
 * words; a policy never drops mail or delivers malware.
 */

const wrap = (route: string, node: ReactNode) =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <TabProvider tabId="t" route={route} active onGo={() => undefined}>
        {node}
      </TabProvider>
    </QueryClientProvider>,
  );
const as = (permissions: string[]) => app.set({ bootstrap: { permissions, user: { id: 1, name: 'Admin' } } as never, status: { network: 'ONLINE' } as never });

const item = (verdict: Verdict, state: AdminQuarantineItem['state'] = 'held', extra: Partial<AdminQuarantineItem> = {}): AdminQuarantineItem => ({
  id: 77,
  received_at: '2026-10-09 08:51:00',
  sender: 'finance@lankapaper-mills.co',
  sender_name: 'Lanka Paper Mills',
  recipient: 'nimal@livezentech.com',
  recipients: ['nimal@livezentech.com'],
  subject: 'New supplier bank details',
  verdict,
  score: 9.1,
  reasons: [{ code: 'lookalike', text: 'Looks like lankapapermills.lk, a known contact' }],
  attachments: [],
  size: 3000,
  path: 'gateway',
  state,
  expires_at: null,
  release: verdict === 'MALWARE' ? 'never' : 'request',
  request: state === 'requested' ? { state: 'pending', note: 'Our paper supplier', decided_at: null, decision_note: null } : null,
  account: null,
  headers_available: true,
  message_id_header: '<x@y>',
  policy: { id: 1, name: 'Standard', version: 7 },
  ...extra,
});

beforeEach(() => {
  setRegional({ timezone: 'UTC', locale: 'en-GB', timeFormat: '24' });
  vi.mocked(apiPost).mockReset().mockResolvedValue({} as never);
  vi.mocked(apiGet).mockReset().mockImplementation((async (path: string) => {
    if (path === '/api/admin/mail/quarantine/77') return { ...item('PHISH'), headers: 'Received: x', verdict_detail: { symbols: [], av: null } };
    if (path === '/api/admin/mail/protection/lists') return { entries: [] };
    throw new ApiError(404, path, null);
  }) as never);
});
afterEach(() => cleanup());

describe('Admin Center › Protection', () => {
  it('is in the Admin Center for whoever may see mail security, and says so to anybody else', async () => {
    as(['mail.security.view']);
    wrap('/settings/admin/mail/protection/lists', <AdminProtection />);
    const nav = screen.getByRole('navigation', { name: 'Admin sections' });
    expect(within(nav).getByRole('button', { name: 'Protection' }).getAttribute('aria-current')).toBe('page');
    expect(screen.getByRole('tab', { name: 'Allow & block lists' }).getAttribute('aria-selected')).toBe('true');
    cleanup();
    as(['chat.widget.manage']);
    wrap('/settings/admin/mail/protection', <AdminProtection />);
    expect(within(screen.getByRole('navigation', { name: 'Admin sections' })).queryByRole('button', { name: 'Protection' })).toBeNull();
    expect(screen.getByRole('alert').textContent).toContain('needs the View mail security permission');
  });

  it('refuses an allow for a DMARC p=reject domain in the server’s own words', async () => {
    as(['mail.security.view', 'mail.security.manage']);
    vi.mocked(apiPost).mockRejectedValue(new ApiError(422, 'paypal.com publishes DMARC p=reject. An allow entry would let forged PayPal mail through.', null) as never);
    wrap('/settings/admin/mail/protection/lists', <AdminProtection />);
    fireEvent.change(await screen.findByLabelText('Address, domain or IP'), { target: { value: 'paypal.com' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    const refusal = await screen.findByRole('alert');
    expect(refusal.textContent).toContain('Can’t allow paypal.com.');
    expect(refusal.textContent).toContain('publishes DMARC p=reject');
    expect(apiPost).toHaveBeenCalledWith('/api/admin/mail/protection/lists', { scope: 'org', kind: 'allow', value_type: 'domain', value: 'paypal.com', expires_at: null });
  });

  it('decides a release request — and never offers Release or Approve for malware', async () => {
    as(['mail.security.view', 'mail.quarantine.release']);
    wrap('/settings/admin/mail/protection/quarantine', <AdminQuarantineSide item={item('PHISH', 'requested')} />);
    expect(screen.getByText('“Our paper supplier”')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Approve and release' }));
    const dialog = await screen.findByRole('dialog', { name: 'Approve and release' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Approve and release' }));
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/api/admin/mail/quarantine/77/decide', { decision: 'approve' }));
    cleanup();
    wrap('/settings/admin/mail/protection/quarantine', <AdminQuarantineSide item={item('MALWARE', 'requested')} />);
    expect(screen.queryByRole('button', { name: /Release|Approve/ })).toBeNull();
    expect(screen.getByText('Malware can’t be released by anyone.')).toBeTruthy();
  });

  it('keeps policies honest: thresholds in order, no drop, malware never delivered', () => {
    expect(thresholdProblems({ junk: 6, quarantine: 10, reject: 15 })).toEqual([]);
    expect(thresholdProblems({ junk: 2, quarantine: 10, reject: 11 })).toEqual(['Junk must be 3 or more.', 'Refuse must be at least Quarantine + 2.']);
    for (const path of ['gateway', 'post', 'outbound'] as const) {
      expect(actionChoices('MALWARE', path)).not.toEqual(expect.arrayContaining(['deliver']));
      expect(actionChoices('MALWARE', path).some((a) => a === 'deliver' || a === 'tag' || a === 'junk')).toBe(false);
      expect(actionChoices('SPAM', path)).not.toContain('drop');
    }
  });
});
