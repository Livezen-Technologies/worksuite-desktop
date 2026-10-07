// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as CoreApi from '../../../src/core/api';

vi.mock('../../../src/core/api', async (orig) => ({ ...(await orig<typeof CoreApi>()), apiGet: vi.fn(), apiGetMeta: vi.fn(), apiPost: vi.fn(), apiPut: vi.fn(), apiDelete: vi.fn() }));
vi.mock('../../../src/core/bridge', () => ({ call: vi.fn(async () => null), on: () => () => undefined, errorMessage: (e: unknown) => (e instanceof Error ? e.message : String(e)), isMac: false, hasDesktop: () => true }));

import { ApiError, apiGet, apiGetMeta, apiPost } from '../../../src/core/api';
import { app } from '../../../src/core/app-state';
import { call } from '../../../src/core/bridge';
import { TabProvider } from '../../../src/core/tab-context';
import { setRegional } from '../../../src/core/time';
import { MAX_TOASTS, dismiss, toast, toasts } from '../../../src/core/toasts';
import { Toasts } from '../../../src/app/overlays/Toasts';
import MailPage from '../../../src/modules/mail/MailPage';
import { mailKeys, removeItem } from '../../../src/modules/mail/api';
import { DELETE_BATCH, byFolder, reasonText } from '../../../src/modules/mail/listActions';
import { SyncLog } from '../../../src/modules/mail/SyncLog';
import type { Target } from '../../../src/modules/mail/MessageMenus';
import type { Mailbox, MessageRow } from '../../../src/modules/mail/types';

/**
 * worksuite-desktop#235 — deleting mail: "… was not changed: Message not found · Retry", the rows stayed,
 * four identical toasts stacked up, and Retry failed the same way.
 *
 * Now: the row goes at once and ONE "Deleted · Undo" says so (the next deletes join it); after the Undo window
 * one request per folder carries each message's whole identity (account, folder, UID, UIDVALIDITY, Message-ID)
 * through the change queue; a message already gone from the server stays gone without a word; a real failure
 * brings the row back with one grouped error, Retry and Details; and the app's toasts are one stack of at most
 * three, bottom-left, errors staying until closed.
 */

const NOW = new Date('2026-10-04T10:00:00Z');

const BOXES = [
  { id: 1, email: 'me@example.test', display_name: 'me', shared: false, unread: 5, in_unified: true, is_default: true, provider: 'imap', provider_label: 'IMAP', colour: 'blue', auth_state: 'ok' },
  { id: 2, email: 'me@contoso.test', display_name: 'me', shared: false, unread: 2, in_unified: true, provider: 'office365', provider_label: 'Microsoft 365', colour: 'indigo', auth_state: 'ok' },
];
const tag = (id: number) => ({ id, email: BOXES[id - 1]!.email, name: 'me', colour: BOXES[id - 1]!.colour });
const msg = (id: number, box: number, over: Partial<MessageRow> = {}) => ({
  id,
  from_name: `Sender ${id}`,
  from_email: `s${id}@example.org`,
  subject: `Subject ${id}`,
  preview: 'A line of the message',
  is_read: false,
  is_starred: false,
  has_attachment: false,
  created_at: '2026-10-04 09:30:00',
  mailbox: tag(box),
  uid_key: `${box}:${id}`,
  folder_slug: 'inbox',
  uidvalidity: 11,
  message_id: `<m${id}@example.test>`,
  ...over,
});

const ALL_COUNTS = {
  roles: {
    inbox: { count: 3, kind: 'unread', mailboxes: [] },
    drafts: { count: 0, kind: 'total', mailboxes: [] },
    outbox: { count: 0, kind: 'total', mailboxes: [] },
    archive: { count: 0, kind: 'unread', mailboxes: [{ id: 1, count: 0, folder: 'archive', source: 'flag', ambiguous: false }, { id: 2, count: 0, folder: 'archive', source: 'flag', ambiguous: false }] },
    sent: { count: null, kind: 'none', mailboxes: [] },
    snoozed: { count: 0, kind: 'total', mailboxes: [] },
    trash: { count: 1, kind: 'total', mailboxes: [] },
    junk: { count: 0, kind: 'total', mailboxes: [] },
  },
  unknown: [],
  partial: false,
};

let lists: Record<string, unknown[]> = {};
/** What the server answers each remove: by default every message trashed (or deleted, in the Trash). */
let answer: (body: Record<string, unknown>, path: string) => Record<string, unknown>;
let qc: QueryClient;

const ok = (body: Record<string, unknown>, path: string) => {
  const items = body.items as Array<{ uid: number }>;
  const status = path.endsWith('/restore') ? 'restored' : body.permanent ? 'deleted' : 'trashed';
  return { delivered: true, queued: false, id: null, status: 200, data: { results: items.map((i) => ({ folder: body.folder ?? 'inbox', uid: i.uid, status })) }, error: null, code: null };
};

function Page({ initial }: { initial: string }) {
  const [route, setRoute] = useState(initial);
  return (
    <TabProvider tabId="t" route={route} active onGo={setRoute}>
      <MailPage active tabId="t" route={route} />
    </TabProvider>
  );
}
const show = (initial = '/mail') => {
  qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.setQueryData(mailKeys.folders(2), { folders: [{ id: 1, name: 'Inbox', slug: 'inbox', type: 'system', total: 2, unread: 2 }, { id: 9, name: 'Deleted Items', slug: 'trash', type: 'system', total: 0, unread: 0 }] });
  return render(
    <QueryClientProvider client={qc}>
      <Page initial={initial} />
      <Toasts />
    </QueryClientProvider>,
  );
};

type Submitted = { entity: string; entityId: string | null; path: string; body: Record<string, unknown> };
const submitted = () => vi.mocked(call).mock.calls.filter(([c]) => c === 'offline:submit').map(([, i]) => i as Submitted);
const removes = () => submitted().filter((s) => s.path === '/api/mail/messages/remove');
const shown = () => toasts.get().items;
const timers = () => {
  vi.useRealTimers();
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
};
const wait = (ms: number) =>
  act(() => {
    vi.advanceTimersByTime(ms);
  });
const done = () => vi.useRealTimers();

const hoverDelete = (list: HTMLElement, subject: string) => fireEvent.click(within(within(list).getByRole('option', { name: new RegExp(subject) })).getByRole('button', { name: 'Delete' }));

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  setRegional({ timezone: 'UTC', locale: 'en-GB', timeFormat: '24' });
  window.localStorage.clear();
  toasts.set({ items: [] });
  lists = {
    inbox: [msg(701, 1, { subject: 'Invoice' }), msg(702, 2, { subject: 'Budget' }), msg(703, 2, { subject: 'Lunch?', folder_slug: 'label:Work' }), msg(704, 1, { subject: 'Minutes', is_read: true })],
    trash: [msg(801, 1, { subject: 'Old news', folder_slug: 'trash' })],
  };
  answer = ok;
  app.set({ status: { network: 'ONLINE' } as never, prefs: { mailCacheDays: 30, moduleNotifications: {}, badgeCount: true, theme: 'light' } as never, bootstrap: { user: { id: '9', name: 'Me', email: 'me@example.test' } } as never, apps: [] });
  vi.mocked(apiGet).mockReset().mockImplementation((async (path: string) => {
    if (path === '/api/mail/mailboxes') return { mailboxes: BOXES };
    if (path === '/api/mail/prefs') return { prefs: { firstRun: 'done', focused: false } };
    if (path === '/api/mail/views') return { mailboxes: BOXES.map((b) => ({ id: b.id, unread: b.unread, counted: true })), views: { unread: 3, starred: 0, today: 0, attachments: 0, drafts: 0, important: null, scheduled: 0 }, partial: false, unknown: [] };
    if (path === '/api/mail/views/all/counts') return ALL_COUNTS;
    if (path === '/api/mail/folders') return { folders: [{ id: 1, name: 'Inbox', slug: 'inbox', type: 'system', total: 2, unread: 2 }, { id: 9, name: 'Deleted Items', slug: 'trash', type: 'system', total: 0, unread: 0 }] };
    if (path === '/api/mail/sync/status') return { enabled: true, mailboxes: [], accounts: [], overall: { state: 'up_to_date', syncing: 0, total: 2, last_ok_at: null, failed: [], stale: [], stale_minutes: 60 } };
    throw new ApiError(404, path, null);
  }) as never);
  vi.mocked(apiGetMeta).mockReset().mockImplementation((async (path: string) => {
    const role = path.startsWith('/api/mail/views/all/') ? path.slice('/api/mail/views/all/'.length) : null;
    if (role) return { data: { messages: lists[role] ?? [], total: (lists[role] ?? []).length, has_more: false, unified: true, role }, offline: false, cachedAt: null };
    throw new ApiError(404, path, null);
  }) as never);
  vi.mocked(apiPost).mockReset().mockResolvedValue({} as never);
  vi.mocked(call).mockReset().mockImplementation((async (channel: string, input: Submitted) => {
    if (channel === 'offline:pending') return [];
    if (channel === 'offline:submit') return answer(input.body, input.path);
    return null;
  }) as never);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  for (const t of toasts.get().items) dismiss(t.id);
});

describe('remove at once, one "Deleted · Undo"', () => {
  it('takes the row out, moves the counts, says Deleted · Undo once, then sends one request with the whole identity', async () => {
    show();
    const list = await screen.findByRole('listbox', { name: 'Messages' });
    await within(list).findByText('Budget');
    timers();
    hoverDelete(list, 'Budget');
    expect(within(list).queryByText('Budget')).toBeNull();
    // The folder's numbers moved at once: one fewer in the Inbox (unread too), one more in Deleted Items.
    const folders = qc.getQueryData<{ folders: Array<{ slug: string; total: number; unread: number }> }>(mailKeys.folders(2))!.folders;
    expect(folders.find((f) => f.slug === 'inbox')).toMatchObject({ total: 1, unread: 1 });
    expect(folders.find((f) => f.slug === 'trash')).toMatchObject({ total: 1 });
    expect(shown()).toHaveLength(1);
    expect(shown()[0]).toMatchObject({ kind: 'info', text: 'Deleted', action: { label: 'Undo' } });
    expect(screen.getByRole('button', { name: 'Undo' })).toBeTruthy();
    // Nothing goes during the Undo window…
    expect(removes()).toEqual([]);
    wait(5_000);
    done();
    // …then one request, for the message's own account and folder, with UID, UIDVALIDITY and Message-ID.
    await waitFor(() => expect(removes()).toHaveLength(1));
    expect(removes()[0]).toMatchObject({ entity: 'message.trash', entityId: '2:inbox:702', body: { folder: 'inbox', mailbox: '2', items: [{ uid: 702, uidvalidity: 11, message_id: '<m702@example.test>' }] } });
    expect(shown().filter((t) => t.kind === 'error')).toEqual([]);
    expect(within(list).queryByText('Budget')).toBeNull();
  });

  it('Undo puts the row and the counts back and sends nothing', async () => {
    show();
    const list = await screen.findByRole('listbox', { name: 'Messages' });
    await within(list).findByText('Budget');
    timers();
    hoverDelete(list, 'Budget');
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(within(list).getByText('Budget')).toBeTruthy();
    expect(qc.getQueryData<{ folders: Array<{ slug: string; total: number }> }>(mailKeys.folders(2))!.folders.find((f) => f.slug === 'inbox')!.total).toBe(2);
    wait(10_000);
    done();
    expect(removes()).toEqual([]);
    expect(shown()).toEqual([]);
  });

  it('joins the deletes of the next few seconds into one toast, and its Undo brings back every one — from the server too', async () => {
    show();
    const list = await screen.findByRole('listbox', { name: 'Messages' });
    await within(list).findByText('Budget');
    timers();
    hoverDelete(list, 'Budget');
    wait(3_000);
    hoverDelete(list, 'Invoice');
    expect(shown()).toHaveLength(1);
    expect(shown()[0]!.text).toBe('2 messages deleted');
    // The first one's window ends and it goes; the toast still offers Undo for both.
    wait(2_000);
    done();
    await waitFor(() => expect(removes()).toHaveLength(1));
    // The group lasts as long as its last delete's window, not the first's.
    hoverDelete(list, 'Minutes');
    expect(shown().map((t) => t.text)).toEqual(['3 messages deleted']);
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(within(list).getByText('Budget')).toBeTruthy();
    expect(within(list).getByText('Invoice')).toBeTruthy();
    expect(within(list).getByText('Minutes')).toBeTruthy();
    // The one already in the Trash is moved back; the other never went.
    await waitFor(() => expect(submitted().filter((s) => s.path === '/api/mail/messages/restore')).toHaveLength(1));
    expect(submitted().find((s) => s.path === '/api/mail/messages/restore')!.body).toMatchObject({ mailbox: '2', items: [{ uid: 702, folder: 'inbox', message_id: '<m702@example.test>' }] });
    expect(removes()).toHaveLength(1);
  });
});

describe('bulk delete: one request per folder', () => {
  it('sends a UID set per account and folder, with one toast', async () => {
    show();
    const list = await screen.findByRole('listbox', { name: 'Messages' });
    await within(list).findByText('Budget');
    for (const s of ['Invoice', 'Budget', 'Lunch\\?', 'Minutes']) fireEvent.click(within(list).getByRole('checkbox', { name: new RegExp(`Select “${s}”`) }));
    const bar = screen.getByRole('toolbar', { name: '4 selected' });
    timers();
    // The bar names the count once, in "4 selected"; its buttons are the plain actions (worksuite-desktop#290).
    fireEvent.click(within(bar).getByRole('button', { name: 'Delete' }));
    expect(shown()).toHaveLength(1);
    expect(shown()[0]!.text).toBe('4 messages deleted');
    wait(5_000);
    done();
    await waitFor(() => expect(removes()).toHaveLength(3));
    // A combined view sends each message to its real account and folder.
    expect(removes().map((r) => [r.body.mailbox, r.body.folder, (r.body.items as Array<{ uid: number }>).map((i) => i.uid)])).toEqual([
      ['1', 'inbox', [701, 704]],
      ['2', 'inbox', [702]],
      ['2', 'label:Work', [703]],
    ]);
  });

  it('groups by account and folder in pieces the server takes', () => {
    const t = (id: number, mailbox: string, folder: string): Target => ({ row: msg(id, Number(mailbox)) as MessageRow, mailbox, folder });
    const many = Array.from({ length: DELETE_BATCH + 2 }, (_, i) => t(i + 1, '1', 'inbox'));
    const groups = byFolder([...many, t(9, '2', 'inbox')]);
    expect(groups.map((g) => g.length)).toEqual([DELETE_BATCH, 2, 1]);
    expect(removeItem({ id: 5, uidvalidity: 3, message_id: null, message_id_hash: 'a'.repeat(40) })).toEqual({ uid: 5, uidvalidity: 3, mid_hash: 'a'.repeat(40) });
  });
});

describe('already gone, and real failures', () => {
  it('a message no longer on the server stays gone, with no error', async () => {
    answer = (body) => ({ delivered: true, queued: false, id: null, status: 200, data: { results: (body.items as Array<{ uid: number }>).map((i) => ({ folder: 'inbox', uid: i.uid, status: 'gone' })) }, error: null, code: null });
    show();
    const list = await screen.findByRole('listbox', { name: 'Messages' });
    await within(list).findByText('Budget');
    timers();
    hoverDelete(list, 'Budget');
    wait(5_000);
    done();
    await waitFor(() => expect(removes()).toHaveLength(1));
    await act(async () => undefined);
    expect(within(list).queryByText('Budget')).toBeNull();
    expect(shown().filter((t) => t.kind === 'error')).toEqual([]);
  });

  it('a refusal brings the row back with one error, Retry and Details; Retry runs the full lookup again at once', async () => {
    answer = (body) => ({ delivered: true, queued: false, id: null, status: 200, data: { results: (body.items as Array<{ uid: number }>).map((i) => ({ folder: 'inbox', uid: i.uid, status: 'failed', reason: 'permission', response: 'NO [NOPERM] Permission denied' })) }, error: null, code: null });
    show();
    const list = await screen.findByRole('listbox', { name: 'Messages' });
    await within(list).findByText('Budget');
    timers();
    hoverDelete(list, 'Budget');
    wait(5_000);
    done();
    expect(await within(list).findByText('Budget')).toBeTruthy();
    await waitFor(() => expect(shown().filter((t) => t.kind === 'error')).toHaveLength(1));
    const err = shown().find((t) => t.kind === 'error')!;
    expect(err.text).toBe(`“Budget” couldn’t be deleted: ${reasonText('permission')}`);
    expect(err.sticky).toBe(true);
    expect([err.action!.label, ...(err.actions ?? []).map((a) => a.label)]).toEqual(['Retry', 'Details']);

    // Details: what was asked and what the server said.
    fireEvent.click(screen.getByRole('button', { name: 'Details' }));
    const dialog = await screen.findByRole('dialog', { name: 'Couldn’t be deleted' });
    expect(within(dialog).getByText(/NOPERM/)).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }));

    answer = ok;
    act(() => err.action!.run());
    expect(within(list).queryByText('Budget')).toBeNull();
    await waitFor(() => expect(removes()).toHaveLength(2));
    expect(removes()[1]!.body).toMatchObject({ mailbox: '2', folder: 'inbox', items: [{ uid: 702, uidvalidity: 11, message_id: '<m702@example.test>' }] });
    await waitFor(() => expect(shown().filter((t) => t.kind === 'error')).toEqual([]));
  });

  it('a mailbox that cannot be reached is a connection failure, grouped: "2 couldn’t be deleted"', async () => {
    answer = () => ({ delivered: false, queued: false, id: null, status: 503, data: { status: 'error', message: 'Timed out waiting for a connection to the mail server. Try again.', errors: { code: 'mail_busy', reason: 'connection' } }, error: 'Timed out waiting for a connection to the mail server. Try again.', code: 'SERVER_ERROR' });
    show();
    const list = await screen.findByRole('listbox', { name: 'Messages' });
    await within(list).findByText('Budget');
    for (const s of ['Invoice', 'Minutes']) fireEvent.click(within(list).getByRole('checkbox', { name: new RegExp(`Select “${s}”`) }));
    timers();
    fireEvent.click(within(screen.getByRole('toolbar', { name: '2 selected' })).getByRole('button', { name: 'Delete' }));
    wait(5_000);
    done();
    await waitFor(() => expect(shown().filter((t) => t.kind === 'error')).toHaveLength(1));
    expect(shown().find((t) => t.kind === 'error')!.text).toBe('2 couldn’t be deleted');
    expect(within(list).getByText('Invoice')).toBeTruthy();
    expect(within(list).getByText('Minutes')).toBeTruthy();
    // Never the old "Message not found" or "was not changed".
    expect(shown().some((t) => /not found|was not changed/.test(t.text))).toBe(false);
  });
});

describe('in Deleted Items', () => {
  it('deletes for good only after asking, with permanent set', async () => {
    show('/mail?folder=trash');
    const list = await screen.findByRole('listbox', { name: 'Messages' });
    const row = await within(list).findByRole('option', { name: /Old news/ });
    fireEvent.click(within(row).getByRole('button', { name: 'Delete permanently' }));
    const ask = await screen.findByRole('dialog', { name: 'Delete this message permanently?' });
    expect(removes()).toEqual([]);
    fireEvent.click(within(ask).getByRole('button', { name: 'Delete permanently' }));
    await waitFor(() => expect(removes()).toHaveLength(1));
    expect(removes()[0]!.body).toMatchObject({ folder: 'trash', mailbox: '1', permanent: true, items: [{ uid: 801 }] });
    expect(shown().find((t) => t.kind === 'info')!.text).toBe('Deleted permanently');
  });
});

describe('the app’s toasts', () => {
  it('counts the same toast instead of stacking copies, keeps at most three, errors until closed', () => {
    timers();
    for (let i = 0; i < 4; i++) toast('error', '“Budget” was not changed: Message not found');
    expect(shown()).toHaveLength(1);
    expect(shown()[0]!.count).toBe(4);
    toast('info', 'One');
    toast('success', 'Two');
    toast('warning', 'Three');
    expect(shown()).toHaveLength(MAX_TOASTS);
    expect(shown().map((t) => t.text)).toEqual(['One', 'Two', 'Three']);
    // Info closes by itself; an error stays.
    toast('error', 'Stays');
    const id = shown().at(-1)!.id;
    wait(60_000);
    expect(shown().map((t) => t.id)).toEqual([id]);
    dismiss(id);
    done();
  });

  it('replaces a keyed toast in place', () => {
    toast('info', 'Deleted', undefined, 5000, { key: 'k' });
    toast('info', '2 messages deleted', undefined, 5000, { key: 'k' });
    expect(shown().map((t) => t.text)).toEqual(['2 messages deleted']);
  });

  it('sits bottom-centre over the content, right of the apps rail, above the status bar and clear of the reading pane’s actions (#259)', () => {
    const nav = document.createElement('nav');
    nav.setAttribute('aria-label', 'Apps');
    nav.getBoundingClientRect = () => ({ right: 64, left: 0, top: 0, bottom: 800, width: 64, height: 800, x: 0, y: 0, toJSON: () => null });
    document.body.appendChild(nav);
    render(<Toasts />);
    act(() => toast('info', 'Deleted'));
    const stack = document.querySelector('[data-toast-stack]') as HTMLElement;
    expect(stack.style.left).toBe(`${(64 + window.innerWidth) / 2}px`);
    expect(stack.className).toContain('-translate-x-1/2');
    // The reading pane's floating Reply · Archive · Delete ends about 84px up; the stack starts above it.
    expect(stack.className).toContain('bottom-[96px]');
    nav.remove();
  });
});

describe('the sync log', () => {
  it('lists each failed delete under Fetch errors with account, folder, UID, UIDVALIDITY, Message-ID and the server’s answer', async () => {
    vi.mocked(apiGet).mockImplementation((async (path: string) => {
      if (path === '/api/mail/mailboxes/2/sync-log')
        return {
          runs: [],
          account: null,
          fetch_errors: [{ kind: 'act_permission', label: 'Action refused: no permission', messages: 1, hits: 1, last_at: '2026-10-04 09:59:00', items: [{ folder: 'inbox', uid: 702, uidvalidity: 11, message_id: '<m702@example.test>', response: 'NO [NOPERM] Permission denied', hits: 1, last_at: '2026-10-04 09:59:00' }] }],
        };
      throw new ApiError(404, path, null);
    }) as never);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <SyncLog box={BOXES[1] as unknown as Mailbox} account={null} onClose={() => undefined} onRepair={() => undefined} />
      </QueryClientProvider>,
    );
    fireEvent.click(await screen.findByRole('tab', { name: 'Fetch errors · 1' }));
    const line = within(screen.getByRole('list', { name: 'Emails' })).getByRole('listitem');
    expect(line.textContent).toContain('inbox · UID 702 · UIDVALIDITY 11 · Message-ID <m702@example.test>');
    expect(line.textContent).toContain('Server: NO [NOPERM] Permission denied');
    expect(screen.getByText(/Action refused: no permission/)).toBeTruthy();
  });
});
