// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as CoreApi from '../../../src/core/api';

vi.mock('../../../src/core/api', async (orig) => ({ ...(await orig<typeof CoreApi>()), apiGet: vi.fn(), apiGetMeta: vi.fn(), apiPost: vi.fn(), apiPut: vi.fn(), apiDelete: vi.fn() }));
vi.mock('../../../src/core/bridge', () => ({ call: vi.fn(async () => null), on: () => () => undefined, errorMessage: (e: unknown) => (e instanceof Error ? e.message : String(e)), isMac: false, hasDesktop: () => true }));
vi.mock('../../../src/core/toasts', () => ({ toast: vi.fn() }));

import { ApiError, apiGet, apiGetMeta, apiPost } from '../../../src/core/api';
import { app } from '../../../src/core/app-state';
import { call } from '../../../src/core/bridge';
import { TabProvider } from '../../../src/core/tab-context';
import { setRegional } from '../../../src/core/time';
import { toast } from '../../../src/core/toasts';
import MailPage, { listCommand } from '../../../src/modules/mail/MailPage';
import { bindings, commandFor } from '../../../src/modules/mail/keymap';
import { hoverIds, organiseIds, placeOf, statusIds } from '../../../src/modules/mail/listActions';
import type { Target } from '../../../src/modules/mail/MessageMenus';
import type { MessageRow } from '../../../src/modules/mail/types';

/**
 * worksuite-desktop#161 — the mail list's own actions: the right-click menu
 * on All Accounts › Inbox (the reporter's "Unified inbox"), hover buttons,
 * checkboxes and the selection toolbar, the keys, Undo, Retry, folder-aware
 * menus (Deleted Items, Junk) and actions going to each message's own account.
 */

const NOW = new Date('2026-10-04T10:00:00Z');

const BOXES = [
  { id: 1, email: 'me@example.test', display_name: 'me', shared: false, unread: 5, in_unified: true, is_default: true, provider: 'imap', provider_label: 'IMAP', colour: 'blue', auth_state: 'ok' },
  { id: 2, email: 'me@contoso.test', display_name: 'me', shared: false, unread: 2, in_unified: true, provider: 'office365', provider_label: 'Microsoft 365', colour: 'indigo', auth_state: 'ok' },
  { id: 3, email: 'me@gmail.test', display_name: 'me', shared: false, unread: 1, in_unified: true, provider: 'gmail', provider_label: 'Gmail', colour: 'red', auth_state: 'ok' },
];
const tag = (id: number) => ({ id, email: BOXES[id - 1]!.email, name: 'me', colour: BOXES[id - 1]!.colour });
const msg = (id: number, box: number, over: Partial<MessageRow> = {}) => ({ id, from_name: `Sender ${id}`, from_email: `s${id}@example.org`, subject: `Subject ${id}`, preview: 'A line of the message', is_read: false, is_starred: false, has_attachment: false, created_at: '2026-10-04 09:30:00', mailbox: tag(box), uid_key: `${box}:${id}`, folder_slug: 'inbox', ...over });
const BANK = { from_name: 'Sampath Bank', from_email: 'alerts@bank.example' };

const ALL_COUNTS = (archive2: string | null) => ({
  roles: {
    inbox: { count: 3, kind: 'unread', mailboxes: [] },
    drafts: { count: 0, kind: 'total', mailboxes: [] },
    outbox: { count: 0, kind: 'total', mailboxes: [] },
    archive: { count: 0, kind: 'unread', mailboxes: [{ id: 1, count: 0, folder: 'archive', source: 'flag', ambiguous: false }, { id: 2, count: 0, folder: archive2, source: null, ambiguous: false }, { id: 3, count: 0, folder: null, source: null, ambiguous: false }] },
    sent: { count: null, kind: 'none', mailboxes: [] },
    snoozed: { count: 0, kind: 'total', mailboxes: [] },
    trash: { count: 2, kind: 'total', mailboxes: [] },
    junk: { count: 1, kind: 'total', mailboxes: [] },
  },
  unknown: [],
  partial: false,
});

let lists: Record<string, unknown[]> = {};
let archive2: string | null = 'archive';
let submitResult: Record<string, unknown> = { delivered: true, queued: false, id: null, status: 200, data: null, error: null, code: null };

function Page({ initial }: { initial: string }) {
  const [route, setRoute] = useState(initial);
  return (
    <TabProvider tabId="t" route={route} active onGo={setRoute}>
      <span data-testid="route">{route}</span>
      <MailPage active tabId="t" route={route} />
    </TabProvider>
  );
}
const show = (initial = '/mail') =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <Page initial={initial} />
    </QueryClientProvider>,
  );

const submitted = () => vi.mocked(call).mock.calls.filter(([c]) => c === 'offline:submit').map(([, i]) => i as { entity: string; path: string; body: Record<string, unknown> });
const later = (ms = 5_000) => {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
  vi.useRealTimers();
};
// The Undo window, run on a fake clock (Date stays real from here: the list is already shown).
const timers = () => {
  vi.useRealTimers();
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
};

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  setRegional({ timezone: 'UTC', locale: 'en-GB', timeFormat: '24' });
  window.localStorage.clear();
  lists = {
    inbox: [msg(701, 1, { ...BANK, subject: 'Transaction alert 1' }), msg(702, 2, { ...BANK, subject: 'Transaction alert 2' }), msg(703, 3, { subject: 'Lunch?', is_starred: true }), msg(704, 2, { subject: 'Budget' })],
    trash: [msg(801, 1, { subject: 'Old news', folder_slug: 'trash' })],
    junk: [msg(901, 2, { subject: 'You won', folder_slug: 'spam' })],
  };
  archive2 = 'archive';
  submitResult = { delivered: true, queued: false, id: null, status: 200, data: null, error: null, code: null };
  app.set({ status: { network: 'ONLINE' } as never, prefs: { mailCacheDays: 30, moduleNotifications: {}, badgeCount: true, theme: 'light' } as never, bootstrap: { user: { id: '9', name: 'Me', email: 'me@example.test' } } as never, apps: [] });
  vi.mocked(apiGet).mockReset().mockImplementation((async (path: string) => {
    if (path === '/api/mail/mailboxes') return { mailboxes: BOXES };
    if (path === '/api/mail/prefs') return { prefs: { firstRun: 'done', focused: false } };
    if (path === '/api/mail/views') return { mailboxes: BOXES.map((b) => ({ id: b.id, unread: b.unread, counted: true })), views: { unread: 3, starred: 0, today: 0, attachments: 0, drafts: 0, important: null, scheduled: 0 }, partial: false, unknown: [] };
    if (path === '/api/mail/views/all/counts') return ALL_COUNTS(archive2);
    if (path === '/api/mail/folders') return { folders: [{ id: 1, name: 'Inbox', slug: 'inbox', type: 'system', total: 3, unread: 3 }, { id: 2, name: 'Receipts', slug: 'Receipts', type: 'user', total: 0, unread: 0 }] };
    if (path === '/api/mail/sync/status') return { enabled: true, mailboxes: [], accounts: [], overall: { state: 'up_to_date', syncing: 0, total: 3, last_ok_at: null, failed: [], stale: [], stale_minutes: 60 } };
    throw new ApiError(404, path, null);
  }) as never);
  vi.mocked(apiGetMeta).mockReset().mockImplementation((async (path: string) => {
    const role = path.startsWith('/api/mail/views/all/') ? path.slice('/api/mail/views/all/'.length) : null;
    if (role) return { data: { messages: lists[role] ?? [], total: (lists[role] ?? []).length, has_more: false, unified: true, role }, offline: false, cachedAt: null };
    throw new ApiError(404, path, null);
  }) as never);
  vi.mocked(apiPost).mockReset().mockResolvedValue({} as never);
  vi.mocked(toast).mockReset();
  vi.mocked(call).mockReset().mockImplementation((async (channel: string) => {
    if (channel === 'offline:pending') return [];
    if (channel === 'offline:submit') return submitResult;
    return null;
  }) as never);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('the right-click menu on All Accounts › Inbox (the reporter’s path)', () => {
  it('opens the WorkSuite menu, not nothing, with Respond, Organise, Status, Rules, Other and Select', async () => {
    show();
    const list = await screen.findByRole('listbox', { name: 'Messages' });
    fireEvent.contextMenu(await within(list).findByText('Transaction alert 2'));
    const menu = await screen.findByRole('menu', { name: 'Message actions' });
    const items = within(menu).getAllByRole('menuitem').map((m) => m.textContent ?? '');
    for (const want of ['Reply', 'Reply all', 'Forward', 'Archive', 'Delete', 'Move to folder…', 'Mark as junk', 'Mark as read', 'Star', 'Snooze', 'Flag', 'Categorize', 'Always move mail from this sender…', 'Block sender', 'Open in new window', 'Copy link', 'View original', 'Select all in this folder', 'Select all from this sender']) {
      expect(items.some((t) => t.startsWith(want))).toBe(true);
    }
    // Keys from the WorkSuite scheme beside the actions.
    expect(within(menu).getByRole('menuitem', { name: /^Archive/ }).textContent).toContain('E');
    expect(within(menu).getByRole('menuitem', { name: /^Delete/ }).textContent).toContain('Delete');
  });

  it('opens it on a list long enough to be drawn virtually (more than 150 rows)', async () => {
    lists.inbox = Array.from({ length: 200 }, (_, i) => msg(1000 + i, (i % 3) + 1, { subject: `Alert ${i}` }));
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(720);
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(600);
    show();
    const list = await screen.findByRole('listbox', { name: 'Messages' });
    fireEvent.contextMenu(await within(list).findByText('Alert 0'));
    expect(await screen.findByRole('menu', { name: 'Message actions' })).toBeTruthy();
    vi.restoreAllMocks();
  });

  it('archives from the menu into the message’s own account, after the Undo window', async () => {
    show();
    const list = await screen.findByRole('listbox', { name: 'Messages' });
    fireEvent.contextMenu(await within(list).findByText('Transaction alert 2'));
    const menu = await screen.findByRole('menu', { name: 'Message actions' });
    timers();
    fireEvent.click(within(menu).getByRole('menuitem', { name: /^Archive/ }));
    // Gone at once, with "Archived · Undo".
    expect(within(list).queryByText('Transaction alert 2')).toBeNull();
    expect(screen.getByText('Archived · “Transaction alert 2”')).toBeTruthy();
    expect(submitted()).toEqual([]);
    later();
    await waitFor(() => expect(submitted()).toEqual([expect.objectContaining({ entity: 'message.archive', path: '/api/mail/messages/702/action', body: { action: 'archive', folder: 'inbox', mailbox: '2' } })]));
  });

  it('replies all from the list: the message opens with the reply started', async () => {
    show();
    const list = await screen.findByRole('listbox', { name: 'Messages' });
    fireEvent.contextMenu(await within(list).findByText('Budget'));
    fireEvent.click(within(await screen.findByRole('menu', { name: 'Message actions' })).getByRole('menuitem', { name: /^Reply all/ }));
    await waitFor(() => expect(screen.getByTestId('route').textContent).toBe('/mail?msg=704&reply=all&mbx=2'));
  });

  it('acts on the row right-clicked, not on a selection it is not part of', async () => {
    show();
    const list = await screen.findByRole('listbox', { name: 'Messages' });
    fireEvent.click(await within(list).findByText('Transaction alert 1'), { ctrlKey: true });
    fireEvent.click(within(list).getByText('Lunch?'), { ctrlKey: true });
    expect(screen.getByRole('toolbar', { name: '2 selected' })).toBeTruthy();
    fireEvent.contextMenu(within(list).getByText('Budget'));
    const menu = await screen.findByRole('menu', { name: 'Message actions' });
    // One message: Reply is offered and Archive has no count.
    expect(within(menu).getByRole('menuitem', { name: /^Reply$/ })).toBeTruthy();
    expect(within(menu).getByRole('menuitem', { name: /^Archive/ }).textContent).not.toContain('Archive 2');
    expect(screen.queryByRole('toolbar', { name: '2 selected' })).toBeNull();
  });
});

describe('hover buttons, Undo and Retry', () => {
  it('shows Archive, Delete, Mark as read, Snooze and Star on each row; Undo brings the message back and sends nothing', async () => {
    show();
    const list = await screen.findByRole('listbox', { name: 'Messages' });
    await within(list).findByText('Budget');
    const row = within(list).getByRole('option', { name: /Budget/ });
    const actions = within(row).getByRole('group', { name: 'Actions for “Budget”' });
    expect(within(actions).getAllByRole('button').map((b) => b.getAttribute('aria-label'))).toEqual(['Archive', 'Delete', 'Mark as read', 'Snooze', 'Star']);
    // A starred one says Unstar, pressed.
    const lunch = within(within(list).getByRole('option', { name: /Lunch\?/ })).getByRole('button', { name: 'Unstar' });
    expect(lunch.getAttribute('aria-pressed')).toBe('true');

    timers();
    fireEvent.click(within(actions).getByRole('button', { name: 'Delete' }));
    expect(within(list).queryByText('Budget')).toBeNull();
    // One "Deleted · Undo" toast (worksuite-desktop#235).
    const deleted = vi.mocked(toast).mock.calls.find((c) => c[1] === 'Deleted')!;
    expect(deleted[2]).toEqual(expect.objectContaining({ label: 'Undo' }));
    act(() => deleted[2]!.run());
    expect(within(list).getByText('Budget')).toBeTruthy();
    later(10_000);
    expect(submitted()).toEqual([]);
  });

  it('snoozes from the hover button with the usual times', async () => {
    show();
    const list = await screen.findByRole('listbox', { name: 'Messages' });
    await within(list).findByText('Budget');
    fireEvent.click(within(within(list).getByRole('option', { name: /Budget/ })).getByRole('button', { name: 'Snooze' }));
    const menu = await screen.findByRole('menu', { name: 'Snooze' });
    fireEvent.click(within(menu).getByRole('menuitem', { name: /^Tomorrow/ }));
    await waitFor(() => expect(submitted()).toEqual([expect.objectContaining({ entity: 'state.snooze', body: expect.objectContaining({ action: 'snooze', items: [expect.objectContaining({ mailbox: 2, folder: 'inbox', uid: '704' })] }) })]));
  });

  it('marks read and stars at once, without opening the message', async () => {
    show();
    const list = await screen.findByRole('listbox', { name: 'Messages' });
    await within(list).findByText('Budget');
    const row = within(list).getByRole('option', { name: /Budget/ });
    fireEvent.click(within(row).getByRole('button', { name: 'Mark as read' }));
    fireEvent.click(within(row).getByRole('button', { name: 'Star' }));
    await waitFor(() => expect(submitted().map((s) => s.entity)).toEqual(['message.read', 'message.star']));
    expect(submitted()[0]!.body).toEqual({ action: 'read', folder: 'inbox', mailbox: '2' });
    expect(screen.getByTestId('route').textContent).toBe('/mail');
  });

  it('brings the message back with the reason and Retry when the server refuses', async () => {
    submitResult = { delivered: false, queued: false, id: null, status: 502, data: null, error: 'The mail server would not archive that message. Nothing was changed.', code: null };
    show();
    const list = await screen.findByRole('listbox', { name: 'Messages' });
    await within(list).findByText('Budget');
    timers();
    fireEvent.click(within(within(list).getByRole('option', { name: /Budget/ })).getByRole('button', { name: 'Archive' }));
    expect(within(list).queryByText('Budget')).toBeNull();
    later();
    expect(await within(list).findByText('Budget')).toBeTruthy();
    await waitFor(() => expect(toast).toHaveBeenCalledWith('error', '“Budget” was not changed: The mail server would not archive that message. Nothing was changed.', expect.objectContaining({ label: 'Retry' })));
    // Retry sends it again (the person already waited out the Undo once).
    submitResult = { delivered: true, queued: false, id: null, status: 200, data: null, error: null, code: null };
    const retry = vi.mocked(toast).mock.calls.find((c) => c[0] === 'error')![2]!;
    act(() => retry.run());
    await waitFor(() => expect(submitted().filter((s) => s.entity === 'message.archive')).toHaveLength(2));
  });

  it('queues offline and says so; the message waits in Waiting to send', async () => {
    submitResult = { delivered: false, queued: true, id: 'q1', status: null, data: null, error: null, code: null };
    show();
    const list = await screen.findByRole('listbox', { name: 'Messages' });
    await within(list).findByText('Budget');
    timers();
    fireEvent.click(within(within(list).getByRole('option', { name: /Budget/ })).getByRole('button', { name: 'Archive' }));
    later();
    await waitFor(() => expect(toast).toHaveBeenCalledWith('info', 'Offline — this happens when you reconnect. Undo it in Waiting to send.'));
  });

  it('asks once where an account with no Archive folder archives', async () => {
    archive2 = null;
    show();
    const list = await screen.findByRole('listbox', { name: 'Messages' });
    await within(list).findByText('Budget');
    await waitFor(() => expect(apiGet).toHaveBeenCalledWith('/api/mail/views/all/counts'));
    fireEvent.click(within(within(list).getByRole('option', { name: /Budget/ })).getByRole('button', { name: 'Archive' }));
    expect(await screen.findByRole('dialog', { name: 'Where should me@contoso.test archive?' })).toBeTruthy();
  });
});

describe('several selected', () => {
  it('ticks rows with their checkboxes; the toolbar archives all of them, each in its own account', async () => {
    show();
    const list = await screen.findByRole('listbox', { name: 'Messages' });
    await within(list).findByText('Budget');
    fireEvent.click(within(list).getByRole('checkbox', { name: 'Select “Transaction alert 1”' }));
    fireEvent.click(within(list).getByRole('checkbox', { name: 'Select “Lunch?”' }));
    const bar = screen.getByRole('toolbar', { name: '2 selected' });
    timers();
    // The bar says how many once; its buttons are the plain actions (worksuite-desktop#290).
    fireEvent.click(within(bar).getByRole('button', { name: 'Archive' }));
    expect(within(list).queryByText('Lunch?')).toBeNull();
    expect(within(list).queryByText('Transaction alert 1')).toBeNull();
    later();
    await waitFor(() => expect(submitted().map((s) => s.body)).toEqual([{ action: 'archive', folder: 'inbox', mailbox: '1' }, { action: 'archive', folder: 'inbox', mailbox: '3' }]));
  });

  it('selects all from this sender, and all in the folder', async () => {
    show();
    const list = await screen.findByRole('listbox', { name: 'Messages' });
    fireEvent.contextMenu(await within(list).findByText('Transaction alert 1'));
    fireEvent.click(within(await screen.findByRole('menu', { name: 'Message actions' })).getByRole('menuitem', { name: /Select all from this sender/ }));
    await screen.findByRole('toolbar', { name: '2 selected' });
    // Select all is the box over the list's lead column (worksuite-desktop#290), mixed while some are picked.
    const all = screen.getByRole('checkbox', { name: 'Select all' }) as HTMLInputElement;
    expect(all.indeterminate).toBe(true);
    fireEvent.click(all);
    expect(await screen.findByRole('toolbar', { name: '4 selected' })).toBeTruthy();
  });

  it('runs E and Delete on the selection, and Ctrl+A selects the folder', async () => {
    show();
    const list = await screen.findByRole('listbox', { name: 'Messages' });
    await within(list).findByText('Budget');
    fireEvent.keyDown(document.body, { key: 'a', code: 'KeyA', ctrlKey: true });
    expect(await screen.findByRole('toolbar', { name: '4 selected' })).toBeTruthy();
    fireEvent.click(within(list).getByRole('checkbox', { name: 'Select “Budget”' }));
    fireEvent.click(within(list).getByRole('checkbox', { name: 'Select “Lunch?”' }));
    fireEvent.click(within(list).getByRole('checkbox', { name: 'Select “Transaction alert 1”' }));
    timers();
    fireEvent.keyDown(within(list).getByRole('checkbox', { name: 'Select “Transaction alert 2”' }), { key: 'Backspace', code: 'Backspace' });
    expect(within(list).queryByText('Transaction alert 2')).toBeNull();
    later();
    // One request for the folder, with the message's identity (worksuite-desktop#235).
    await waitFor(() => expect(submitted()).toEqual([expect.objectContaining({ entity: 'message.trash', path: '/api/mail/messages/remove', body: { folder: 'inbox', mailbox: '2', items: [{ uid: 702 }] } })]));
  });
});

describe('folder-aware actions', () => {
  it('offers Restore and Delete permanently in Deleted Items; deleting for good asks first', async () => {
    show('/mail?folder=trash');
    const list = await screen.findByRole('listbox', { name: 'Messages' });
    const row = await within(list).findByRole('option', { name: /Old news/ });
    expect(within(row).getAllByRole('button').map((b) => b.getAttribute('aria-label'))).toEqual(['Restore', 'Delete permanently', 'Mark as read']);
    fireEvent.contextMenu(within(list).getByText('Old news'));
    const menu = await screen.findByRole('menu', { name: 'Message actions' });
    expect(within(menu).queryByRole('menuitem', { name: /^Archive/ })).toBeNull();
    fireEvent.click(within(menu).getByRole('menuitem', { name: /^Delete permanently/ }));
    const ask = await screen.findByRole('dialog', { name: 'Delete this message permanently?' });
    fireEvent.click(within(ask).getByRole('button', { name: 'Delete permanently' }));
    await waitFor(() => expect(submitted()).toEqual([expect.objectContaining({ entity: 'message.trash', path: '/api/mail/messages/remove', body: { folder: 'trash', mailbox: '1', permanent: true, items: [{ uid: 801 }] } })]));
  });

  it('says Not junk in Junk Email, which moves it back to the Inbox', async () => {
    show('/mail?folder=spam');
    const list = await screen.findByRole('listbox', { name: 'Messages' });
    fireEvent.contextMenu(await within(list).findByText('You won'));
    const menu = await screen.findByRole('menu', { name: 'Message actions' });
    expect(within(menu).queryByRole('menuitem', { name: /Mark as junk/ })).toBeNull();
    timers();
    fireEvent.click(within(menu).getByRole('menuitem', { name: /^Not junk/ }));
    later();
    // Not junk teaches the filter (ENH-MAIL-04 MPR-UX-06): the protection call, through the change queue.
    await waitFor(() => expect(submitted()).toEqual([expect.objectContaining({ entity: 'message.inbox', path: '/api/mail/messages/901/not-junk', body: { folder: 'spam', mailbox: '2' } })]));
  });
});

describe('which actions, where', () => {
  const t = (folder: string, over: Partial<MessageRow> = {}): Target => ({ row: { ...msg(1, 1), ...over } as MessageRow, mailbox: '1', folder });

  it('maps each folder to its actions', () => {
    expect(organiseIds([t('inbox')])).toEqual(['archive', 'delete', 'move', 'junk']);
    expect(organiseIds([t('trash')])).toEqual(['restore', 'deleteForever', 'move']);
    expect(organiseIds([t('spam')])).toEqual(['notJunk', 'delete', 'move']);
    expect(placeOf([t('inbox'), t('trash')])).toBe('other');
    expect(statusIds([t('inbox', { is_read: true, is_starred: true })])).toEqual(['unread', 'unstar']);
    expect(hoverIds(t('archive', { is_read: true }))).toEqual(['junk', 'delete', 'unread', 'snooze', 'star']);
  });

  it('runs the keys as list actions: Delete in Deleted Items is for good, ! in Junk is Not junk', () => {
    expect(listCommand('delete', [t('trash')], false)).toBe('deleteForever');
    expect(listCommand('delete', [t('inbox')], false)).toBe('delete');
    expect(listCommand('spam', [t('spam')], false)).toBe('notJunk');
    expect(listCommand('archive', [t('trash')], false)).toBe('none');
    expect(listCommand('flag', [t('inbox', { is_starred: true })], false)).toBe('unstar');
    // Read and unread on the open message stay with the reader (its mark-as-read rules).
    expect(listCommand('unread', [t('inbox')], false)).toBeNull();
    expect(listCommand('unread', [t('inbox')], true)).toBe('unread');
  });

  it('binds E, Delete, Backspace, U, S, R, F and Ctrl+A in the WorkSuite scheme; Outlook keeps Backspace for Archive', () => {
    const ws = bindings('worksuite');
    const id = (k: string) => commandFor(ws, k, null).id;
    expect([id('E'), id('Delete'), id('Backspace'), id('U'), id('S'), id('R'), id('F'), id('Mod+A')]).toEqual(['archive', 'delete', 'delete', 'unread', 'flag', 'reply', 'forward', 'selectAll']);
    expect(commandFor(bindings('outlook'), 'Backspace', null).id).toBe('archive');
  });
});
