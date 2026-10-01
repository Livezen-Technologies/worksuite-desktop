// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as CoreApi from '../../../src/core/api';

vi.mock('../../../src/core/api', async (orig) => ({ ...(await orig<typeof CoreApi>()), apiGet: vi.fn(), apiPost: vi.fn(), apiPut: vi.fn(), apiDelete: vi.fn() }));
vi.mock('../../../src/core/bridge', () => ({ call: vi.fn(async () => null), on: () => () => undefined, errorMessage: (e: unknown) => (e instanceof Error ? e.message : String(e)), isMac: false }));
vi.mock('../../../src/core/toasts', () => ({ toast: vi.fn() }));

import { apiGet, apiPost, apiPut } from '../../../src/core/api';
import { notificationAllowed } from '../../../shared/access';
import Announcements, { audienceLine, companiesLabel, statusLabel } from '../../../src/modules/hr/Announcements';

/** Publishing to several companies (worksuite-desktop#98), from HR's console. */
const COMPANIES = [{ id: 1, name: 'Livezen' }, { id: 2, name: 'Asterix' }, { id: 3, name: 'Obelix' }];
const ROWS = [
  { id: 5, title: 'Policy', company: 'Livezen, Asterix', org_id: null, companies: [COMPANIES[0], COMPANIES[1]], all_companies: false, category: 'general', priority: 'urgent', status: 'published', pinned: true, requires_ack: true, publish_at: null, published_at: '2026-09-30 09:00:00', expires_at: null },
  { id: 6, title: 'Draft note', company: 'Livezen', org_id: 1, companies: [COMPANIES[0]], category: 'general', priority: 'normal', status: 'draft', pinned: false, requires_ack: false, publish_at: null, published_at: null, expires_at: null },
];

function show() {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <Announcements />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.mocked(apiGet).mockReset().mockImplementation((async (path: string, params?: Record<string, unknown>) => {
    if (path === '/api/hr/context') return { organizations: COMPANIES, default: 1 };
    if (path === '/api/hr/announcements') return { items: params?.org === '2' ? [ROWS[0]] : ROWS };
    if (path === '/api/hr/announcements/5') return { ...ROWS[0], body: '<p>Read the policy.</p>' };
    if (path === '/api/hr/announcements/audience') {
      const ids = String(params?.org_ids) === 'all' ? [1, 2, 3] : String(params?.org_ids).split(',').map(Number);
      return { total: ids.length * 10 - (ids.length > 1 ? 2 : 0), companies: COMPANIES.filter((c) => ids.includes(c.id)).map((c) => ({ ...c, count: 10 })) };
    }
    throw new Error(path);
  }) as never);
  vi.mocked(apiPost).mockReset().mockResolvedValue({ id: 9 } as never);
  vi.mocked(apiPut).mockReset().mockResolvedValue({} as never);
});
afterEach(cleanup);

describe('the announcements console (#98)', () => {
  it('lists companies, withdrawn as Withdrawn, and filters by company', async () => {
    show();
    expect(await screen.findByText('Livezen and Asterix')).toBeTruthy();
    expect(statusLabel('cancelled')).toBe('Withdrawn');
    expect(companiesLabel({ company: 'x', companies: COMPANIES })).toBe('3 companies');
    expect(companiesLabel({ company: 'x', all_companies: true })).toBe('All companies');
    fireEvent.click(screen.getByLabelText('Filter by company'));
    fireEvent.click(await screen.findByRole('option', { name: 'Asterix' }));
    await waitFor(() => expect(screen.queryByText('Draft note')).toBeNull());
    expect(vi.mocked(apiGet)).toHaveBeenCalledWith('/api/hr/announcements', { org: '2' }, expect.anything());
  });

  it('chooses companies with search, chips, Select All and Clear; at least one is required; the audience is said', async () => {
    show();
    fireEvent.click(await screen.findByRole('button', { name: 'New announcement' }));
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Holiday' } });
    fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'Closed Monday.' } });
    expect(await screen.findByText('1 selected')).toBeTruthy();
    expect(await screen.findByText('Reaches 10 people in 1 company.')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
    expect(screen.getByText('Choose at least one company.')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Publish Announcement' }) as HTMLButtonElement).disabled).toBe(true);

    fireEvent.change(screen.getByLabelText('Search companies'), { target: { value: 'ast' } });
    const list = screen.getByRole('listbox', { name: 'Companies' });
    expect(within(list).queryByText('Livezen')).toBeNull();
    fireEvent.click(within(list).getByLabelText('Asterix'));
    fireEvent.change(screen.getByLabelText('Search companies'), { target: { value: '' } });
    fireEvent.click(within(screen.getByRole('listbox', { name: 'Companies' })).getByLabelText('Obelix'));
    expect(screen.getByText('2 selected')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Remove Asterix' })).toBeTruthy();
    expect(await screen.findByText('Reaches 18 people in 2 companies.')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Save Draft' }));
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/api/hr/announcements', expect.objectContaining({ title: 'Holiday', org_ids: [2, 3], body: '<p>Closed Monday.</p>' })));
    expect(apiPost).not.toHaveBeenCalledWith('/api/hr/announcements/9/publish', {});
  });

  it('Select All publishes to all permitted companies, after saying who it reaches', async () => {
    show();
    fireEvent.click(await screen.findByRole('button', { name: 'New announcement' }));
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Everyone' } });
    fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'Hello.' } });
    fireEvent.click(await screen.findByRole('button', { name: 'Select All' }));
    expect(within(screen.getByRole('dialog', { name: 'New announcement' })).getByText('All companies')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Publish Announcement' }));
    const ask = await screen.findByRole('alertdialog', { name: 'Publish now?' });
    expect(await within(ask).findByText('Publish to 28 people in 3 companies?')).toBeTruthy();
    fireEvent.click(within(ask).getByRole('button', { name: 'Publish now' }));
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/api/hr/announcements/9/publish', {}));
    expect(apiPost).toHaveBeenCalledWith('/api/hr/announcements', expect.objectContaining({ org_ids: 'all' }));
  });

  it('edits a published one without touching its message unless changed, and withdraws it', async () => {
    show();
    const policy = (await screen.findByText('Policy')).closest('div')!;
    fireEvent.click(within(policy).getByRole('button', { name: 'Edit' }));
    expect(((await screen.findByLabelText('Message')) as HTMLTextAreaElement).value).toBe('Read the policy.');
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Policy v2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(apiPut).toHaveBeenCalled());
    const [path, body] = vi.mocked(apiPut).mock.calls[0]!;
    expect(path).toBe('/api/hr/announcements/5');
    expect(body).toMatchObject({ title: 'Policy v2', org_ids: [1, 2] });
    expect(body).not.toHaveProperty('body');

    fireEvent.click(within((await screen.findByText('Policy')).closest('div')!).getByRole('button', { name: 'Withdraw' }));
    await waitFor(() => expect(screen.getAllByRole('button', { name: 'Withdraw' })).toHaveLength(2));
    fireEvent.click(screen.getAllByRole('button', { name: 'Withdraw' }).at(-1)!);
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/api/hr/announcements/5/withdraw', {}));
  });

  it('an announcement notification is shown to people without the HR app', () => {
    const visible = new Set(['home', 'chat']);
    expect(notificationAllowed({ category: 'hr', module: 'hr', link: '/announcements?open=5' }, visible)).toBe(true);
    expect(notificationAllowed({ category: 'hr', module: 'hr', link: '/hr?tab=approvals' }, visible)).toBe(false);
  });

  it('says the audience in words', () => {
    expect(audienceLine({ total: 1, companies: [{ id: 1, name: 'A', count: 1 }] })).toBe('1 person in 1 company');
    expect(audienceLine({ total: 1280, companies: [{ id: 1, name: 'A', count: 1 }, { id: 2, name: 'B', count: 1 }] })).toBe('1,280 people in 2 companies');
  });
});
