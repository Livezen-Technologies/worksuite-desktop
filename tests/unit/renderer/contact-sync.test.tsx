// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as CoreApi from '../../../src/core/api';

/**
 * Contacts synced with Google, Outlook and iCloud (worksuite-desktop#175): the helpers the screens use, Accounts &
 * sync in Settings, the Accounts section of the sidebar, and merging possible duplicates with a choice per field.
 */
vi.mock('../../../src/core/api', async (orig) => ({ ...(await orig<typeof CoreApi>()), apiGet: vi.fn(), apiPost: vi.fn(), apiPut: vi.fn(), apiDelete: vi.fn() }));
vi.mock('../../../src/core/bridge', () => ({ call: vi.fn(async () => null), on: () => () => undefined, hasDesktop: () => false, errorMessage: (e: unknown) => (e instanceof Error ? e.message : String(e)), isMac: false, registerDropped: vi.fn() }));
vi.mock('../../../src/core/toasts', () => ({ toast: vi.fn() }));
vi.mock('../../../src/core/tab-context', () => ({ useTab: () => ({ query: new URLSearchParams(), path: ['settings', 'contacts'], go: vi.fn() }), useTabTitle: () => undefined }));

import { apiDelete, apiGet, apiPost } from '../../../src/core/api';
import { toast } from '../../../src/core/toasts';
import { phoneLabel, subLine } from '../../../src/modules/contacts/api';
import { Rail } from '../../../src/modules/contacts/Rail';
import { MergeDialog } from '../../../src/modules/contacts/TidyUp';
import { AccountsSettings } from '../../../src/modules/contacts/sync/AccountsSettings';
import { defaultChoices, differing, previewLine, statusLine, syncedWith, type DuplicatePair, type DuplicateSide, type SyncAccount } from '../../../src/modules/contacts/sync/api';

const side = (o: Partial<DuplicateSide>): DuplicateSide => ({
  id: 1, display_name: 'Nimal Perera', first_name: 'Nimal', last_name: 'Perera', type: 'customer', company: 'Dialog', job_title: 'Engineer', department: null,
  work_email: null, personal_email: null, mobile: '+94771234567', office_phone: null, home_phone: null, website: null, birthday: null, street: null, city: null,
  state: null, zip: null, country: null, customer_id: 'C-1', employee_id: null, vendor_id: null, tax_number: null, notes: null, extras: {}, updated_at: '2026-09-01 10:00:00', sources: [], ...o,
});

const account = (o: Partial<SyncAccount> = {}): SyncAccount => ({
  id: 3, provider: 'google', provider_label: 'Google', mode: 'server', email: 'amal@gmail.com', label: null, server_url: null, device_id: null, org_id: null,
  status: 'active', error: null, contact_count: 210, open_conflicts: 0, last_synced_at: null, next_sync_at: null, backoff_until: null,
  settings: { default_type: 'personal', conflicts: 'recent', on_local_delete: 'ask', export: 'all', interval: 15 }, created_at: null, ...o,
});

function wrap(ui: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

beforeEach(() => {
  vi.mocked(apiGet).mockReset();
  vi.mocked(apiPost).mockReset();
  vi.mocked(apiDelete).mockReset();
  vi.mocked(toast).mockReset();
});
afterEach(() => cleanup());

describe('what the screens say', () => {
  it('never repeats the name under it, and shows every number the same way', () => {
    expect(subLine({ display_name: 'Konnect BPO', job_title: null, company: 'Konnect BPO', email: 'info@konnect.lk' })).toBe('info@konnect.lk');
    expect(subLine({ display_name: 'Asha', job_title: 'Asha', company: null, email: null, phone: '0771234567' })).toBe('+94 77 123 4567');
    expect(subLine({ display_name: 'Asha', job_title: 'Lead', company: 'Dialog', email: null })).toBe('Lead · Dialog');
    for (const raw of ['0767793692', '+94 76 779 3692', '076-779-3692']) expect(phoneLabel(raw)).toBe('+94 76 779 3692');
    expect(phoneLabel('ext 12')).toBe('ext 12');
  });

  it('counts a first sync before it writes anything, and names where a contact is synced', () => {
    expect(previewLine({ found: 320, new: 210, matched: 95, duplicates: 15 })).toBe('320 found · 210 new · 95 match existing · 15 possible duplicates');
    expect(syncedWith([{ provider: 'google' }, { provider: 'icloud' }, { provider: 'google' }])).toBe('Synced with Google, iCloud');
    expect(statusLine({ status: 'backoff', error: null, backoff_until: null }).tone).toBe('warning');
    expect(statusLine({ status: 'error', error: 'Sign in to Google again', backoff_until: null })).toEqual({ text: 'Sign in to Google again', tone: 'danger' });
  });

  it('offers a choice only where the two disagree, defaulting to the kept one unless it is empty', () => {
    const a = side({ id: 1 });
    const b = side({ id: 2, job_title: 'Lead', work_email: 'n@dialog.lk', customer_id: null });
    expect(differing(a, b).map((f) => f.key)).toEqual(['job_title', 'work_email', 'customer_id']);
    const c = defaultChoices(a, b);
    expect([c.job_title, c.work_email, c.customer_id]).toEqual(['keep', 'other', 'keep']);
  });
});

describe('Settings › Contacts › Accounts & sync', () => {
  it('lists each account with its status and count, and disconnects keeping or removing its contacts', async () => {
    vi.mocked(apiGet).mockImplementation(async (path: string) => {
      if (path === '/api/contacts/sync/accounts') return [account(), account({ id: 4, provider: 'microsoft', provider_label: 'Outlook', email: 'amal@outlook.com', status: 'error', error: 'Sign in to Outlook again', contact_count: 1 })];
      return [];
    });
    vi.mocked(apiDelete).mockResolvedValue({ removed: 12, archived: 1, kept: 3 });
    wrap(<AccountsSettings />);

    const list = await screen.findByRole('list', { name: 'Connected accounts' });
    const rows = within(list).getAllByRole('listitem');
    expect(rows).toHaveLength(2);
    expect(rows[0]!.textContent).toContain('amal@gmail.com');
    expect(rows[0]!.textContent).toContain('Up to date');
    expect(rows[0]!.textContent).toContain('210 contacts');
    expect(rows[1]!.textContent).toContain('Sign in to Outlook again');

    fireEvent.click(within(rows[0]!).getByRole('button', { name: 'Disconnect' }));
    fireEvent.click(screen.getByLabelText(/Remove contacts that only came from this account/));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Disconnect' }));
    await waitFor(() => expect(apiDelete).toHaveBeenCalledWith('/api/contacts/sync/accounts/3?remove=1'));
    await waitFor(() => expect(toast).toHaveBeenCalledWith('success', expect.stringContaining('12 removed')));
  });

  it('the type new contacts get is the account’s setting, and never Customer unless chosen', async () => {
    vi.mocked(apiGet).mockResolvedValue([account()]);
    wrap(<AccountsSettings />);
    fireEvent.click(await screen.findByRole('button', { name: 'Settings' }));
    expect(screen.getByLabelText('Type for new contacts').textContent).toContain('Contact (no type)');
  });
});

describe('the sidebar', () => {
  it('has an Accounts section with counts that filters by source, and one Import and one Export', () => {
    const onPlace = vi.fn();
    const onExport = vi.fn();
    wrap(<Rail place={{ view: 'all' }} stats={undefined} groups={[]} accounts={[account(), account({ id: 9, provider: 'icloud', provider_label: 'iCloud', email: 'amal@icloud.com', contact_count: 40 })]} onPlace={onPlace} onNew={vi.fn()} onImport={vi.fn()} onExport={onExport} adding={false} setAdding={vi.fn()} />);
    const icloud = screen.getByRole('button', { name: /amal@icloud\.com/ });
    expect(icloud.textContent).toContain('40');
    fireEvent.click(icloud);
    expect(onPlace).toHaveBeenCalledWith({ account: 9 });
    expect(screen.getAllByRole('button', { name: /Import/ })).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: /Export/ }));
    fireEvent.click(screen.getByRole('menuitem', { name: /vCard/ }));
    expect(onExport).toHaveBeenCalledWith('vcf');
    expect(screen.getByRole('button', { name: /Tidy up/ })).toBeTruthy();
  });
});

describe('merging possible duplicates', () => {
  it('keeps one, takes the chosen fields from the other, and offers Undo', async () => {
    const pair: DuplicatePair = { a: side({ id: 1 }), b: side({ id: 2, display_name: 'Nimal P.', job_title: 'Lead', work_email: 'n@dialog.lk' }), reasons: ['Same phone number'] };
    vi.mocked(apiPost).mockResolvedValue({ merge_id: 5, keep_id: 1 });
    const onMerged = vi.fn();
    wrap(<MergeDialog pair={pair} onClose={vi.fn()} onMerged={onMerged} />);

    const table = screen.getByRole('table', { name: 'Fields to choose' });
    expect(within(table).getAllByRole('row').map((r) => r.querySelector('[role=rowheader]')?.textContent)).toEqual(['Name', 'Job title', 'Work email']);
    fireEvent.click(within(table).getByLabelText('Job title: Lead'));
    fireEvent.click(screen.getByRole('button', { name: 'Merge' }));

    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/api/contacts/merge', expect.objectContaining({ keep_id: 1, other_id: 2 })));
    const body = vi.mocked(apiPost).mock.calls[0]![1] as { choose: Record<string, string> };
    expect([body.choose.job_title, body.choose.work_email, body.choose.display_name]).toEqual(['other', 'other', 'keep']);
    expect(onMerged).toHaveBeenCalled();
    const [, text, action] = vi.mocked(toast).mock.calls[0]!;
    expect(text).toBe('Merged into Nimal Perera');
    expect(action?.label).toBe('Undo');
    vi.mocked(apiPost).mockResolvedValue({ keep_id: 1, restored_id: 2 });
    action!.run();
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/api/contacts/merges/5/undo'));
  });
});
