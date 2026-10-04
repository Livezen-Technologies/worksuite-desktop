// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as CoreApi from '../../../src/core/api';

/**
 * The account tag on the mail list (worksuite-desktop#227): the account's first name — or the address before the @ —
 * in a soft pill of the account's colour, instead of two letters of the domain; told apart when two would match;
 * where it shows set per account and for all of them; edited in Settings with a preview and Reset to default.
 */
vi.mock('../../../src/core/api', async (orig) => ({ ...(await orig<typeof CoreApi>()), apiGet: vi.fn(), apiPut: vi.fn(async (_p: string, body: unknown) => ({ prefs: body })) }));
vi.mock('../../../src/core/bridge', () => ({ call: vi.fn(async () => null), on: () => () => undefined, errorMessage: (e: unknown) => String(e), isMac: false }));
vi.mock('../../../src/core/toasts', () => ({ toast: vi.fn() }));

import { apiGet, apiPut } from '../../../src/core/api';
import { accountTags, clip, defaultTagLabel, tagShows } from '../../../src/modules/mail/accountTags';
import { AccountTagSettings } from '../../../src/modules/mail/AccountTagSettings';
import { MessageList, type ListRow, type MessageListProps } from '../../../src/modules/mail/MessageList';
import type { Mailbox, MailPrefs, MessageRow } from '../../../src/modules/mail/types';

const box = (over: Partial<Mailbox>): Mailbox => ({ id: 1, email: 'x@livezentech.com', display_name: null, shared: false, unread: 0, provider: 'imap', provider_label: 'Custom IMAP', ...over });
const BOXES = [
  box({ id: 1, email: 'hasarinda@livezentech.com', display_name: 'Hasarinda Perera', colour: 'blue' }),
  box({ id: 2, email: 'acc@livezentech.com', display_name: 'Accounts' }),
  box({ id: 3, email: 'hasarinda@gmail.com', display_name: 'Hasarinda', provider_label: 'Gmail', auth_type: 'oauth' }),
];

describe('the tag text and colour', () => {
  it('is the first name, or the address before the @ when there is no name or it names a role', () => {
    expect(defaultTagLabel({ email: 'hasarinda@livezentech.com', display_name: 'Hasarinda Perera' })).toBe('Hasarinda');
    expect(defaultTagLabel({ email: 'acc@livezentech.com', display_name: 'Accounts' })).toBe('Acc');
    expect(defaultTagLabel({ email: 'acc@livezentech.com', display_name: '' })).toBe('Acc');
    expect(defaultTagLabel({ email: 'john.smith@x.lk', display_name: 'john.smith@x.lk' })).toBe('John');
    expect(defaultTagLabel({ email: 'support@x.lk', display_name: 'Support Team' })).toBe('Support');
    expect(defaultTagLabel({ email: 'a@x.lk', display_name: 'Maximilianusz Kowalski' })).toBe('Maximilianu…');
    expect([...clip('Maximilianusz')].length).toBe(12);
  });

  it('tells two accounts with the same name apart, by domain letter or number, and gives each its own colour', () => {
    const tags = accountTags(BOXES, {});
    expect([1, 2, 3].map((id) => tags.get(id)!.label)).toEqual(['Hasarinda', 'Acc', 'Hasarinda G']);
    const same = accountTags([...BOXES, box({ id: 4, email: 'hasarinda@livezen.lk', display_name: 'Hasarinda' })], {});
    expect(same.get(4)!.label).toBe('Hasarinda 2');
    expect(new Set([1, 2, 3, 4].map((id) => same.get(id)!.colour)).size).toBe(4);
    expect(tags.get(1)!.colour).toBe('blue');
    expect(tags.get(3)!.title).toBe('hasarinda@gmail.com · Gmail · OAuth');
  });

  it('keeps the person’s own label and colour, and flags a label two accounts share', () => {
    const tags = accountTags(BOXES, { accountTags: { 2: { label: 'Hasarinda', colour: '#ff0000' } } });
    expect(tags.get(2)!.label).toBe('Hasarinda');
    expect(tags.get(2)!.colour).toBe('#ff0000');
    expect(tags.get(1)!.clash).toBe(true);
    expect(tags.get(2)!.clash).toBe(true);
  });

  it('shows in the combined views by default, everywhere or never when set, and not at all when turned off', () => {
    const t = accountTags(BOXES, { accountTags: { 2: { show: 'all' }, 3: { show: 'never' } } });
    expect([tagShows(t.get(1), 'name', true), tagShows(t.get(1), 'name', false)]).toEqual([true, false]);
    expect(tagShows(t.get(2), 'dot', false)).toBe(true);
    expect(tagShows(t.get(3), 'name', true)).toBe(false);
    expect(tagShows(t.get(1), 'off', true)).toBe(false);
  });
});

const message = (id: number, mailbox: number): MessageRow => ({
  id, from_name: 'Nimal Silva', from_email: 'nimal@x.lk', subject: `Invoice ${id}`, preview: '', is_read: false, is_starred: false, has_attachment: false,
  created_at: '2026-10-04 09:00:00', mailbox: { id: mailbox, email: BOXES[mailbox - 1]!.email, name: BOXES[mailbox - 1]!.email, colour: '' },
});
const noop = () => undefined;
function list(over: Partial<MessageListProps>) {
  const items: ListRow[] = [message(11, 1), message(12, 2)].map((row) => ({ row, key: String(row.id), queued: null }));
  const props: MessageListProps = {
    title: 'All Accounts', groups: [{ key: 'all', label: '', rows: items.map((i) => i.row), items }], total: 2, loading: false, error: null, onRetry: noop,
    selectedKey: null, onOpen: noop, onStar: noop, prefs: { view: 'compact' }, onPrefs: noop, conversations: null, onConversations: noop, chips: [], onChips: noop,
    search: '', onSearch: noop, onSearchAll: noop, unified: true, boxes: BOXES, offline: false, offlineDays: 0, refreshing: false, onRefresh: noop,
    hasMore: false, loadingMore: false, onMore: noop, ...over,
  };
  return render(<QueryClientProvider client={new QueryClient()}><MessageList {...props} /></QueryClientProvider>);
}

afterEach(() => cleanup());

describe('on the list', () => {
  it('draws the name tag on each row of the combined list, with the address and kind in its tooltip', () => {
    list({});
    const row = screen.getByText('Invoice 11').closest('[role="option"]') as HTMLElement;
    const tag = within(row).getByText('Hasarinda').parentElement!;
    expect(tag.getAttribute('title')).toBe('hasarinda@livezentech.com · Custom IMAP');
    expect(tag.className).toContain('bg-[var(--tag-bg)]');
    expect(within(screen.getByText('Invoice 12').closest('[role="option"]') as HTMLElement).getByText('Acc')).toBeTruthy();
    expect(screen.queryByText('LI')).toBeNull();
  });

  it('draws the dot alone, or nothing, as Mail › Appearance & reading says', () => {
    list({ prefs: { view: 'compact', accountTag: 'dot' } });
    expect(screen.getByRole('img', { name: 'Hasarinda' }).getAttribute('title')).toBe('hasarinda@livezentech.com · Custom IMAP');
    cleanup();
    list({ prefs: { view: 'compact', accountTag: 'off' } });
    expect(screen.queryByText('Hasarinda')).toBeNull();
  });

  it('shows it in one account’s own folders only when that account is set to All views', () => {
    list({ unified: false, mailboxId: 1, prefs: { view: 'compact', accountTags: { 1: { show: 'all' } } } });
    expect(screen.getAllByText('Hasarinda').length).toBeGreaterThan(0);
    cleanup();
    list({ unified: false, mailboxId: 1 });
    expect(screen.queryByText('Hasarinda')).toBeNull();
  });
});

describe('Settings › Mail › Accounts › an account', () => {
  let prefs: MailPrefs = {};
  beforeEach(() => {
    prefs = {};
    vi.mocked(apiGet).mockReset().mockImplementation((async (path: string) => {
      if (path === '/api/mail/mailboxes') return { mailboxes: BOXES };
      if (path === '/api/mail/prefs') return { prefs };
      throw new Error(`unexpected ${path}`);
    }) as never);
    vi.mocked(apiPut).mockClear();
  });
  const wrap = (ui: ReactNode) => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>);

  it('edits the label with a live preview, picks a colour and where it shows, and resets to default', async () => {
    wrap(<AccountTagSettings box={BOXES[0]!} />);
    const label = await screen.findByRole('textbox');
    expect(label.getAttribute('placeholder')).toBe('Hasarinda');
    expect(label.getAttribute('maxLength')).toBe('12');
    fireEvent.change(label, { target: { value: 'Hasa' } });
    expect(within(screen.getByLabelText('Preview')).getByText('Hasa')).toBeTruthy();
    fireEvent.blur(label);
    await waitFor(() => expect(apiPut).toHaveBeenLastCalledWith('/api/mail/prefs', { accountTags: { 1: { label: 'Hasa' } } }));

    fireEvent.click(screen.getByRole('radio', { name: 'Rose' }));
    await waitFor(() => expect(apiPut).toHaveBeenLastCalledWith('/api/mail/prefs', { accountTags: { 1: { label: 'Hasa', colour: 'rose' } } }));
    fireEvent.click(screen.getByRole('radio', { name: 'All views' }));
    await waitFor(() => expect(apiPut).toHaveBeenLastCalledWith('/api/mail/prefs', { accountTags: { 1: { label: 'Hasa', colour: 'rose', show: 'all' } } }));

    fireEvent.click(screen.getByRole('button', { name: 'Reset to default' }));
    await waitFor(() => expect(apiPut).toHaveBeenLastCalledWith('/api/mail/prefs', { accountTags: {} }));
  });

  it('says when an account is told apart automatically, and suggests renaming it', async () => {
    wrap(<AccountTagSettings box={BOXES[2]!} />);
    expect((await screen.findByRole('note')).textContent).toBe('Shown as “Hasarinda G”: another account has the same name. Rename one here.');
  });
});
