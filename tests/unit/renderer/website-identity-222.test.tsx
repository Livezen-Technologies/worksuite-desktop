// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as CoreApi from '../../../src/core/api';

/**
 * Returning visitors (worksuite-desktop#222), the agent's side: "Returning · 3rd visit" on the inbox row; the profile
 * in the details panel — how we know them, visits, devices, Previous chats with links, "Possible same person" with
 * Merge and Dismiss, merges with Unmerge, the linked contact with company and deals, Delete visitor data; the Merge
 * dialog with its preview and Undo; the right-click menu's Merge; and the widget's identity settings with the
 * developer guide.
 */
vi.mock('../../../src/core/api', async (orig) => ({
  ...(await orig<typeof CoreApi>()),
  apiGet: vi.fn(),
  apiPost: vi.fn(async () => ({})),
  apiPut: vi.fn(async () => ({})),
  apiDelete: vi.fn(async () => ({})),
  request: vi.fn(async () => ({ data: {} })),
}));
vi.mock('../../../src/core/bridge', () => ({ call: vi.fn(), on: () => () => undefined, errorMessage: (e: unknown) => (e instanceof Error ? e.message : String(e)), isMac: false, registerDropped: vi.fn() }));
vi.mock('../../../src/core/toasts', () => ({ toast: vi.fn() }));
const tab = { go: vi.fn() };
vi.mock('../../../src/core/tab-context', () => ({
  useTab: () => ({ query: new URLSearchParams(''), path: ['chat'], go: tab.go, active: true, openLink: vi.fn() }),
  useTabTitle: () => undefined,
}));

import { ApiError, apiDelete, apiGet, apiPost, apiPut } from '../../../src/core/api';
import { toast } from '../../../src/core/toasts';
import type { WebsiteRow } from '../../../src/modules/chat/website/api';
import { ConversationRow } from '../../../src/modules/chat/website/ConversationRow';
import { MergeDialog, ProfileCards } from '../../../src/modules/chat/website/IdentityCard';
import { ordinal, returningBadge, type VisitorProfile } from '../../../src/modules/chat/website/identity';
import { IdentitySection, identityProblem } from '../../../src/modules/chat/website/widget/IdentitySettings';
import { ConversationMenu } from '../../../src/modules/chat/ConversationMenu';

const W = '/api/chat/widget-admin';

const row = (over: Partial<WebsiteRow> = {}): WebsiteRow => ({
  id: 11, widget: 'TechHub', widget_id: 1, site: 'techubiz.com', online: true, inactive: false, label: 'Visitor E5C9', visitor_name: 'Kamal Perera', email: 'kamal@customer.lk',
  country: 'LK', browser: null, os: null, device: null, current_url: null, last_seen: null, status: 'open', is_offline: false, priority: 'normal',
  updated_at: '2026-10-05 09:00:00', agent: null, assigned_to: null, started_at: '2026-10-05 08:50:00', last_visitor_at: '2026-10-05 09:00:00', waiting_since: null,
  at_risk: false, awaiting_reply: false, rating: null, is_starred: false, tags: null, visitor_id: 7, visits: 3, identity: 'returning', ...over,
});

const profile = (over: Partial<VisitorProfile> = {}): VisitorProfile => ({
  profile: { id: 7, label: 'Visitor E5C9', name: 'Kamal Perera', email: 'kamal@customer.lk', phone: null, company: 'Acme Ltd', identity: 'signed', visits: 3, visit: '3rd', first_seen: '2026-09-01 10:00:00', last_seen: '2026-10-05 09:00:00' },
  devices: [
    { id: 7, label: 'Visitor E5C9', browser: 'Chrome', os: 'Windows', device: 'desktop', last_seen: '2026-10-05 09:00:00', first_seen: '2026-09-01 10:00:00', primary: true },
    { id: 8, label: 'Visitor 2B10', browser: 'Safari', os: 'iOS', device: 'mobile', last_seen: '2026-10-02 18:00:00', first_seen: '2026-10-02 18:00:00', primary: false },
  ],
  identifiers: [{ kind: 'user_id', value: 'u-42', verified: true, source: 'signed' }],
  chats: [
    { id: 11, status: 'open', started_at: '2026-10-05 08:50:00', closed_at: null, rating: null, closed_reason: null },
    { id: 4, status: 'closed', started_at: '2026-09-02 10:00:00', closed_at: '2026-09-02 10:20:00', rating: 5, closed_reason: 'agent' },
  ],
  suggestions: [{ visitor_id: 21, label: 'Visitor 7A21', name: null, email: 'kamal@customer.lk', reason: 'same email', chats: 1, last_seen: null }],
  merges: [{ id: 30, kind: 'signed', reason: 'Signed in as the same user', at: '2026-10-02 18:00:00', by: null, merged: { id: 8, label: 'Visitor 2B10', name: null }, undone_at: null, can_undo: true }],
  contact: { id: 50, name: 'Kamal Perera', company: 'Acme Ltd', job_title: 'IT manager', email: 'kamal@customer.lk', phone: null, deals: [{ id: 4, name: 'Annual licence', amount: 250000, currency: 'LKR', state: 'open' }] },
  contact_matches: [],
  can: { merge: true, link: true, erase: true },
  ...over,
});

function wrap(ui: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

let current = profile();

beforeEach(() => {
  current = profile();
  vi.mocked(apiGet).mockImplementation((async (path: string) => {
    if (path === `${W}/visitors/7/profile`) return current;
    if (path === `${W}/conversations`) return { conversations: [row({ id: 12, visitor_id: 33, visitor_name: 'Kamal (phone)', email: 'kamal@gmail.com' })], can: { view: true, reply: true, manage: true } };
    if (path === `${W}/widgets/1/identity`) return { settings: { reopen_window_days: 7, device_continuation: 'off', auto_link_contacts: true, cookie_days: 365, retention_days: 0, has_secret: true }, secret: 'abc123secret', can_manage: true, mail: true };
    if (path === `${W}/agents`) return { agents: [] };
    throw new ApiError(404, 'Not found', null);
  }) as never);
  vi.mocked(apiPost).mockImplementation((async (path: string, body?: Record<string, unknown>) => {
    if (path === `${W}/visitors/7/merge` && body?.preview) return { preview: { keep: { id: 7, label: 'Visitor E5C9', name: 'Kamal Perera' }, merge: { id: Number(body.other_id), label: 'Visitor 7A21', name: null }, name: 'Kamal Perera', chats_moving: 1, chats_total: 3, closes: { id: 9, started_at: '2026-10-04 10:00:00' } } };
    if (path === `${W}/visitors/7/merge`) return { merge_id: 31, visitor_id: 7 };
    return {};
  }) as never);
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('the inbox row (#222)', () => {
  it('says "Returning · 3rd visit" for somebody who has been here before, and nothing on a first visit', () => {
    expect(ordinal(1)).toBe('1st');
    expect(ordinal(2)).toBe('2nd');
    expect(ordinal(3)).toBe('3rd');
    expect(ordinal(11)).toBe('11th');
    expect(ordinal(22)).toBe('22nd');
    expect(returningBadge({ visits: 3, identity: 'returning' })).toBe('Returning · 3rd visit');
    expect(returningBadge({ visits: 1, identity: 'new' })).toBeNull();
    expect(returningBadge({})).toBeNull();

    wrap(<ConversationRow r={row()} me={3} myName="Nuwan" active={false} onOpen={() => undefined} onMenu={() => undefined} />);
    expect(screen.getByText('Returning · 3rd visit')).toBeTruthy();
    cleanup();
    wrap(<ConversationRow r={row({ visits: 1 })} me={3} myName="Nuwan" active={false} onOpen={() => undefined} onMenu={() => undefined} />);
    expect(screen.queryByText(/Returning/)).toBeNull();
  });
});

describe('the profile in the details panel (#222)', () => {
  it('shows how we know them, visits, devices, the contact with its deals, and previous chats that open', async () => {
    wrap(<ProfileCards visitorId={7} conversationId={11} legacy={<div>Old list</div>} />);
    const who = await screen.findByLabelText('Who this is');
    expect(within(who).getByText('Signed in')).toBeTruthy();
    expect(within(who).getByText('3 · this is the 3rd')).toBeTruthy();
    expect(within(who).getByText('2 devices')).toBeTruthy();
    expect(within(who).getByText('Safari · iOS')).toBeTruthy();
    expect(screen.queryByText('Old list')).toBeNull();

    expect(screen.getByText('IT manager · Acme Ltd')).toBeTruthy();
    expect(within(screen.getByLabelText('Deals')).getByText('Annual licence')).toBeTruthy();

    expect(screen.getByText('Previous chats · 1')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /rated 5\/5/ }));
    expect(tab.go).toHaveBeenCalledWith('/chat?view=website&section=inbox&website=4');
  });

  it('keeps the older Previous chats list on a server without profiles', async () => {
    vi.mocked(apiGet).mockRejectedValue(new ApiError(404, 'Not found', null));
    wrap(<ProfileCards visitorId={7} conversationId={11} legacy={<div>Old list</div>} />);
    await waitFor(() => expect(apiGet).toHaveBeenCalled());
    expect(screen.getByText('Old list')).toBeTruthy();
  });

  it('suggests a possible same person, with Merge and Dismiss, and never merges by itself', async () => {
    wrap(<ProfileCards visitorId={7} conversationId={11} legacy={null} />);
    const card = await screen.findByRole('group', { name: 'Possible same person' });
    expect(card.textContent).toContain('Possible same person as Visitor 7A21 (same email)');
    expect(apiPost).not.toHaveBeenCalled();

    fireEvent.click(within(card).getByRole('button', { name: 'Dismiss' }));
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith(`${W}/visitors/7/dismiss`, { other_id: 21 }));

    fireEvent.click(within(card).getByRole('button', { name: 'Merge' }));
    const dialog = await screen.findByRole('dialog');
    await within(dialog).findByRole('region', { name: 'What merging does' });
    expect(dialog.textContent).toContain('Shown as Kamal Perera, with 3 chats.');
    expect(dialog.textContent).toContain('Both have a chat going');
    expect(apiPost).not.toHaveBeenCalledWith(`${W}/visitors/7/merge`, { other_id: 21 });

    fireEvent.click(within(dialog).getByRole('button', { name: 'Merge' }));
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith(`${W}/visitors/7/merge`, { other_id: 21 }));
    const [, message, undo] = vi.mocked(toast).mock.calls.find((c) => c[1] === 'Visitors merged.')!;
    expect(message).toBe('Visitors merged.');
    undo!.run();
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith(`${W}/visitor-merges/31/undo`, {}));
  });

  it('unmerges a merge, and deletes the visitor\'s data only after saying what goes', async () => {
    wrap(<ProfileCards visitorId={7} conversationId={11} legacy={null} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Unmerge' }));
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith(`${W}/visitor-merges/30/undo`, {}));

    fireEvent.click(screen.getByRole('button', { name: 'Delete visitor data' }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog.textContent).toContain('Kamal Perera, their 2 devices and their 2 chats — every message and file — are deleted for good.');
    expect(apiDelete).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete everything' }));
    await waitFor(() => expect(apiDelete).toHaveBeenCalledWith(`${W}/visitors/7/data`));
  });

  it('offers no Merge, Unmerge or Delete to somebody who may not', async () => {
    current = profile({ can: { merge: false, link: false, erase: false } });
    wrap(<ProfileCards visitorId={7} conversationId={11} legacy={null} />);
    await screen.findByLabelText('Who this is');
    expect(screen.queryByRole('button', { name: 'Merge' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Unmerge' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Delete visitor data' })).toBeNull();
  });

  it('links a contact their email matches', async () => {
    current = profile({ contact: null, contact_matches: [{ id: 51, name: 'K. Perera', company: 'Acme Ltd' }] });
    wrap(<ProfileCards visitorId={7} conversationId={11} legacy={null} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Link' }));
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith(`${W}/visitors/7/contact`, { contact_id: 51 }));
  });
});

describe('merging from the header or the menu (#222)', () => {
  it('finds the other visitor by name or email, previews, and merges', async () => {
    wrap(<MergeDialog keepId={7} keepName="Kamal Perera" onClose={() => undefined} />);
    fireEvent.change(await screen.findByLabelText('Find a visitor'), { target: { value: 'kamal' } });
    fireEvent.click(await screen.findByRole('option', { name: /Kamal \(phone\)/ }));
    await screen.findByRole('region', { name: 'What merging does' });
    expect(apiPost).toHaveBeenCalledWith(`${W}/visitors/7/merge`, { other_id: 33, preview: true });
    fireEvent.click(screen.getByRole('button', { name: 'Merge' }));
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith(`${W}/visitors/7/merge`, { other_id: 33 }));
  });

  it('puts "Merge with another visitor…" on the right-click menu', async () => {
    wrap(<ConversationMenu x={10} y={10} target={{ kind: 'website', row: row() }} onClose={() => undefined} />);
    fireEvent.click(await screen.findByRole('menuitem', { name: /Merge with another visitor/ }));
    expect((await screen.findByRole('dialog')).textContent).toContain('Merge visitors');
  });
});

describe('the widget\'s identity settings and developer guide (#222)', () => {
  it('holds each setting to its range, saves only when changed, and shows the secret and the code to sign with', async () => {
    expect(identityProblem({ reopen_window_days: 91, device_continuation: 'off', auto_link_contacts: true, cookie_days: 365, retention_days: 0 })).toBe('Enter a reopen window of 0 to 90 days.');
    expect(identityProblem({ reopen_window_days: 7, device_continuation: 'off', auto_link_contacts: true, cookie_days: 365, retention_days: 3 })).toMatch(/7 to 3650/);
    expect(identityProblem({ reopen_window_days: 7, device_continuation: 'off', auto_link_contacts: true, cookie_days: 365, retention_days: 30 })).toBeNull();

    wrap(<IdentitySection widgetId={1} />);
    const days = await screen.findByLabelText(/^Reopen a closed chat for \(days\)/);
    expect(screen.getByRole('button', { name: 'Save' }).hasAttribute('disabled')).toBe(true);
    expect(screen.getByLabelText('Identify secret').textContent).toBe('abc123secret');
    expect(screen.getByLabelText('Sign the user id').textContent).toContain("hash_hmac('sha256'");
    expect(screen.getByLabelText('Sign the user id').textContent).not.toContain('abc123secret');
    expect(screen.getByLabelText('Identify on the page').textContent).toContain('WorkSuiteChat.identify(');

    fireEvent.change(days, { target: { value: '120' } });
    expect(screen.getByRole('alert').textContent).toBe('Enter a reopen window of 0 to 90 days.');
    fireEvent.change(days, { target: { value: '14' } });
    fireEvent.click(screen.getByRole('radio', { name: 'With a code by email' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(apiPut).toHaveBeenCalledWith(`${W}/widgets/1/identity`, { reopen_window_days: 14, device_continuation: 'email_code', auto_link_contacts: true, cookie_days: 365, retention_days: 0 }));
  });

  it('shows nothing on a server without returning visitors', async () => {
    vi.mocked(apiGet).mockRejectedValue(new ApiError(404, 'Not found', null));
    const { container } = wrap(<IdentitySection widgetId={1} />);
    await waitFor(() => expect(apiGet).toHaveBeenCalled());
    expect(container.textContent).toBe('');
  });
});
