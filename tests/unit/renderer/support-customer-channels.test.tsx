// @vitest-environment jsdom
import { cleanup, fireEvent, render, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as CoreApi from '../../../src/core/api';
import { msg, serveWith } from './support-fixtures';

/**
 * The customer channels in the desktop thread (worksuite-desktop#336): a requester's message says "via Form",
 * "via Email", "via Portal" or "via Website chat"; a reply from an "Unverified sender" is held for review with Release
 * and Discard; an email reply cut down to what the customer wrote offers "Show original"; and the calls behind them.
 */
vi.mock('../../../src/core/api', async (orig) => ({ ...(await orig<typeof CoreApi>()), request: vi.fn() }));
vi.mock('../../../src/core/bridge', () => ({ call: vi.fn(async () => undefined), on: () => () => undefined, hasDesktop: () => true, errorMessage: (e: unknown) => String(e), isMac: false, platform: 'linux', registerDropped: vi.fn() }));
vi.mock('../../../src/core/toasts', () => ({ toast: vi.fn() }));
vi.mock('../../../src/core/tab-context', () => ({ openWebLink: vi.fn(), useTab: () => ({}), useTabTitle: () => undefined }));

const { request } = await import('../../../src/core/api');
const { Thread, VIA_CHANNELS, channelBadge } = await import('../../../src/modules/support/Thread');
const { discardHeld, heldReplies, releaseHeld, revokeTicketLinks, resetApiFamily } = await import('../../../src/modules/support/api');

const row = (id: number) => document.querySelector<HTMLElement>(`[data-message="${id}"]`)!;

const thread = [
  msg(1, { channel: 'form', via: 'Form', body: 'The download link says expired.' }),
  msg(2, { channel: 'portal', via: 'Portal', body: 'Still expired.', created_at: '2026-10-04T10:12:00+05:30' }),
  msg(3, { channel: 'email', via: 'Email', body: 'Works now.', has_original: true, created_at: '2026-10-04T11:12:00+05:30' }),
  msg(4, { channel: 'email', internal: true, held: 'unverified', held_from: 'kasun@customer.lk', author_name: 'Kasun', body: 'It is the HP on floor 2.', created_at: '2026-10-04T12:12:00+05:30' }),
  msg(5, { channel: 'chat', body: 'Hi', created_at: '2026-10-04T13:12:00+05:30' }),
  msg(6, { channel: 'phone', body: 'Called about it', created_at: '2026-10-04T14:12:00+05:30' }),
];

let log: ReturnType<typeof serveWith>;
beforeEach(() => {
  resetApiFamily();
  log = serveWith(request, {
    'GET /api/support/v1/meta': {},
    'GET /api/support/v1/tickets/7/messages/3/original': { id: 3, original: 'Works now.\n\n-- \nChamari\n\nOn Tue … wrote:\n> Try again', cut: true },
    'GET /api/support/v1/held': { held: [{ message_id: 4, ticket_id: 7, reference: 'TKT-000123', subject: 'Printer', from: 'kasun@customer.lk', name: 'Kasun', excerpt: 'It is the HP on floor 2.', created_at: null }] },
    'POST /api/support/v1/tickets/7/messages/4/release': { message: null },
    'POST /api/support/v1/tickets/7/messages/4/discard': { message: null },
    'POST /api/support/v1/tickets/7/access/revoke': {},
  });
});
afterEach(() => cleanup());

describe('the customer channels in the thread (#336)', () => {
  it('says how each requester message came: "via" a customer channel, a call by its name', () => {
    render(<Thread messages={thread as never} ticketId={7} />);
    const badge = (id: number) => row(id).querySelector('[data-channel]')?.textContent;
    expect([badge(1), badge(2), badge(3), badge(5), badge(6)]).toEqual(['via Form', 'via Portal', 'via Email', 'via Website chat', 'Phone']);
    expect(channelBadge('staff', 'email')).toBe('Email');
    expect([...VIA_CHANNELS]).toEqual(expect.arrayContaining(['form', 'email', 'portal', 'chat']));
  });

  it('holds an unverified sender’s reply as a note, with Release and Discard for the tab to act on', () => {
    const onHeld = vi.fn();
    render(<Thread messages={thread as never} ticketId={7} onHeld={onHeld} />);
    const held = row(4);
    expect(held.dataset.internal).toBe('true');
    expect(within(held).getByText('Unverified sender')).toBeTruthy();
    expect(within(held).getByText(/kasun@customer.lk is not the requester/)).toBeTruthy();
    fireEvent.click(within(held).getByRole('button', { name: 'Release' }));
    fireEvent.click(within(held).getByRole('button', { name: 'Discard' }));
    expect(onHeld.mock.calls.map(([m, a]) => [m.id, a])).toEqual([[4, 'release'], [4, 'discard']]);
  });

  it('only says so where nothing can act on it, and marks a reply already decided', () => {
    render(<Thread messages={[...thread.slice(0, 3), { ...thread[3], held: 'released', internal: false }] as never} />);
    expect(within(row(4)).queryByRole('button', { name: 'Release' })).toBeNull();
    expect(within(row(4)).getByText(/Released from review/)).toBeTruthy();
    expect(within(row(3)).queryByRole('button', { name: 'Show original' })).toBeNull();
  });

  it('shows the original email when asked', async () => {
    render(<Thread messages={thread as never} ticketId={7} />);
    fireEvent.click(within(row(3)).getByRole('button', { name: 'Show original' }));
    await waitFor(() => expect(row(3).querySelector('[data-original]')?.textContent).toContain('On Tue … wrote:'));
    expect(log.some((c) => c.method === 'GET' && c.path === '/api/support/v1/tickets/7/messages/3/original')).toBe(true);
    fireEvent.click(within(row(3)).getByRole('button', { name: 'Hide original' }));
    expect(row(3).querySelector('[data-original]')).toBeNull();
  });

  it('calls the review, release, discard and revoke endpoints', async () => {
    expect((await heldReplies()).map((h) => h.reference)).toEqual(['TKT-000123']);
    await releaseHeld(7, 4);
    await discardHeld(7, 4);
    await revokeTicketLinks(7);
    expect(log.filter((c) => c.method === 'POST').map((c) => c.path)).toEqual([
      '/api/support/v1/tickets/7/messages/4/release',
      '/api/support/v1/tickets/7/messages/4/discard',
      '/api/support/v1/tickets/7/access/revoke',
    ]);
  });
});
