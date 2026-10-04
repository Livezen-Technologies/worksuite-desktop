// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as CoreApi from '../../../src/core/api';

vi.mock('../../../src/core/api', async (orig) => ({ ...(await orig<typeof CoreApi>()), apiGet: vi.fn(), apiGetMeta: vi.fn(), apiPost: vi.fn(), apiPut: vi.fn(), apiDelete: vi.fn(), request: vi.fn() }));
vi.mock('../../../src/core/bridge', () => ({ call: vi.fn(async () => null), on: () => () => undefined, errorMessage: (e: unknown) => (e instanceof Error ? e.message : String(e)), isMac: false, hasDesktop: () => true }));
vi.mock('../../../src/core/toasts', () => ({ toast: vi.fn() }));

import { ApiError, apiGet, apiGetMeta, apiPost, request } from '../../../src/core/api';
import { call } from '../../../src/core/bridge';
import { toast } from '../../../src/core/toasts';
import { MailSidebar, type SidebarProps } from '../../../src/modules/mail/Sidebar';
import { moveTargets } from '../../../src/modules/mail/FolderDialogs';
import { isCoreFolder, isEmptyableFolder, mailKeys } from '../../../src/modules/mail/api';
import { forgetPrefetchFailures, PREFETCH_AHEAD, prefetchMessages, seedFromLocal, seedMessage } from '../../../src/modules/mail/localFirst';
import { syncSummary } from '../../../src/modules/mail/sync';
import { offlineMailSearch } from '../../../src/modules/mail/SearchView';
import type { Folder, Mailbox } from '../../../src/modules/mail/types';

/**
 * worksuite-desktop#162: a folder's (and an account's) right-click menu —
 * Sync, Status, Manage, Clean up, View, Offline, Info — with core folders
 * protected; and Mail shown from this computer first, then the server.
 */

const box: Mailbox = { id: 4, email: 'me@example.test', display_name: null, shared: false, unread: 3, is_default: true };
const folders: Folder[] = [
  { id: 1, name: 'Inbox', slug: 'inbox', type: 'system', total: 120, unread: 3 },
  { id: 2, name: 'Trash', slug: 'trash', type: 'system', total: 40, unread: 0 },
  { id: 3, name: 'Clients', slug: 'label:Clients', type: 'custom', total: 57, unread: 5 },
  { id: 4, name: 'Clients/Acme', slug: 'label:Clients/Acme', type: 'custom', total: 9, unread: 0 },
  { id: 5, name: 'Projects', slug: 'label:Projects', type: 'custom', total: 2, unread: 0 },
];

let submitted: Array<Record<string, unknown>> = [];
let submitAnswer: Record<string, unknown> = { delivered: true, queued: false, id: null, status: 200, data: null, error: null, code: null };

function props(over: Partial<SidebarProps> = {}): SidebarProps {
  return {
    boxes: [box],
    loading: false,
    counts: null,
    allCounts: null,
    local: { drafts: 0, outbox: 0 },
    place: { box: '4', view: null, folder: 'inbox', label: null },
    showLabels: false,
    active: true,
    summary: syncSummary(null, { offline: false }),
    accounts: [],
    running: new Set(),
    syncingAll: false,
    offline: false,
    pending: 0,
    cacheDays: 30,
    onCompose: vi.fn(),
    onSearch: vi.fn(),
    onAddMailbox: vi.fn(),
    onPick: vi.fn(),
    onSyncAll: vi.fn(),
    onSyncAccount: vi.fn(),
    onSettings: vi.fn(),
    favorites: [],
    onFavorites: vi.fn(),
    ...over,
  };
}

function show(over: Partial<SidebarProps> = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <MailSidebar {...props(over)} />
    </QueryClientProvider>,
  );
  return qc;
}

async function menuFor(name: RegExp) {
  const nav = await screen.findByRole('navigation', { name: 'Mail' });
  fireEvent.contextMenu(await within(nav).findByRole('button', { name }));
  return screen.findByRole('menu', { name: 'Folder actions' });
}

beforeEach(() => {
  submitted = [];
  submitAnswer = { delivered: true, queued: false, id: null, status: 200, data: null, error: null, code: null };
  window.localStorage.clear();
  vi.mocked(apiGet).mockReset();
  vi.mocked(apiPost).mockReset();
  vi.mocked(apiGetMeta).mockReset();
  vi.mocked(toast).mockReset();
  vi.mocked(apiGet).mockImplementation(async (path: string) => {
    if (path === '/api/mail/folders') return { folders };
    if (path === '/api/mail/folder-ops/properties') return { folder: 'label:Clients', account: box.email, messages: 57, unread: 5, bytes: 3 * 1024 * 1024, bytes_partial: false, synced_at: '2026-10-03T09:00:00Z', source: 'mirror' };
    return {};
  });
  vi.mocked(call).mockImplementation((async (channel: string, input: Record<string, unknown>) => {
    if (channel === 'offline:submit') {
      submitted.push(input);
      return submitAnswer;
    }
    return null;
  }) as never);
});
afterEach(() => cleanup());

describe('a folder’s right-click menu', () => {
  it('offers Sync, Status, Manage, View, Offline and Info for a folder of yours', async () => {
    show();
    const menu = await menuFor(/^Clients\s*\d*$/);
    for (const name of ['Sync this folder now', 'Mark all as read', 'New subfolder…', 'Rename…', 'Move to…', 'Delete folder…', 'Show unread count', 'Show total count', 'Keep this folder on this computer', 'Properties', 'Add to Favorites']) {
      expect(within(menu).getByText(name)).toBeTruthy();
    }
    for (const section of ['Sync', 'Status', 'Manage', 'View', 'Offline', 'Info']) expect(within(menu).getByText(section)).toBeTruthy();
    // Only Deleted Items and Junk are emptied.
    expect(within(menu).queryByRole('menuitem', { name: /Empty folder/ })).toBeNull();
  });

  it('protects core folders from rename, move and delete', async () => {
    show();
    const menu = await menuFor(/^Inbox/);
    for (const name of [/^Rename…/, /^Move to…/, /^Delete folder…/]) expect(within(menu).getByRole('menuitem', { name }).getAttribute('aria-disabled')).toBe('true');
    expect(within(menu).getByRole('menuitem', { name: /^Mark all as read/ }).getAttribute('aria-disabled')).not.toBe('true');
    expect(isCoreFolder('inbox') && isCoreFolder('label:[Gmail]/All Mail') && isCoreFolder('label:Sent Items')).toBe(true);
    expect(isCoreFolder('label:Clients')).toBe(false);
    expect(isEmptyableFolder('trash') && isEmptyableFolder('spam') && !isEmptyableFolder('label:Clients')).toBe(true);
  });

  it('marks everything read at once, through the queue, and puts the count back when the server refuses', async () => {
    const qc = show();
    // Offline: queued, and shown at once.
    submitAnswer = { delivered: false, queued: true, id: 'q1', status: null, data: null, error: null, code: null };
    let menu = await menuFor(/^Clients\s*\d*$/);
    fireEvent.click(within(menu).getByRole('menuitem', { name: /^Mark all as read/ }));
    await waitFor(() => expect(submitted).toHaveLength(1));
    expect(submitted[0]).toMatchObject({ module: 'mail', method: 'POST', queueIfOffline: true, entity: 'folder.read-all', path: '/api/mail/folder-ops/read-all', body: { mailbox: 4, folder: 'label:Clients' } });
    expect(qc.getQueryData<{ folders: Folder[] }>(mailKeys.folders(4))!.folders.find((f) => f.slug === 'label:Clients')!.unread).toBe(0);

    // Refused: the folder's count comes back as it was.
    qc.setQueryData(mailKeys.folders(4), { folders });
    submitAnswer = { delivered: false, queued: false, id: null, status: 409, data: null, error: 'The mail server did not mark them read', code: null };
    menu = await menuFor(/^Clients\s*\d*$/);
    fireEvent.click(within(menu).getByRole('menuitem', { name: /^Mark all as read/ }));
    await waitFor(() => expect(toast).toHaveBeenCalledWith('error', 'The mail server did not mark them read'));
    expect(qc.getQueryData<{ folders: Folder[] }>(mailKeys.folders(4))!.folders.find((f) => f.slug === 'label:Clients')!.unread).toBe(5);
  });

  it('renames, makes a subfolder and moves a folder by its slug', async () => {
    show();
    fireEvent.click(within(await menuFor(/^Clients\s*\d*$/)).getByRole('menuitem', { name: /^Rename…/ }));
    let dialog = await screen.findByRole('dialog', { name: 'Rename Clients' });
    fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: 'Customers' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Rename' }));
    await waitFor(() => expect(submitted.at(-1)).toMatchObject({ path: '/api/mail/folder-ops/rename', body: { mailbox: 4, folder: 'label:Clients', name: 'Customers' }, label: 'Rename Clients to Customers' }));

    fireEvent.click(within(await menuFor(/^Clients\s*\d*$/)).getByRole('menuitem', { name: /^New subfolder…/ }));
    dialog = await screen.findByRole('dialog', { name: 'New folder in Clients' });
    fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: 'Globex' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create' }));
    await waitFor(() => expect(submitted.at(-1)).toMatchObject({ path: '/api/mail/folder-ops/create', body: { mailbox: 4, folder: 'label:Clients', name: 'Globex', parent: 'label:Clients' } }));

    fireEvent.click(within(await menuFor(/^Clients\s*\d*$/)).getByRole('menuitem', { name: /^Move to…/ }));
    dialog = await screen.findByRole('dialog', { name: 'Move Clients to…' });
    // Not into itself, nor into its own subfolder.
    expect(within(dialog).queryByRole('option', { name: 'Clients/Acme' })).toBeNull();
    fireEvent.click(within(dialog).getByRole('option', { name: 'Projects' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Move' }));
    await waitFor(() => expect(submitted.at(-1)).toMatchObject({ path: '/api/mail/folder-ops/move', body: { mailbox: 4, folder: 'label:Clients', parent: 'label:Projects' } }));
  });

  it('asks before deleting a folder, and empties Deleted Items a batch at a time', async () => {
    show();
    fireEvent.click(within(await menuFor(/^Clients\s*\d*$/)).getByRole('menuitem', { name: /^Delete folder…/ }));
    let dialog = await screen.findByRole('dialog', { name: 'Delete Clients?' });
    expect(within(dialog).getByText(/cannot be undone/)).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete folder' }));
    await waitFor(() => expect(submitted.at(-1)).toMatchObject({ path: '/api/mail/folder-ops/delete', body: { mailbox: 4, folder: 'label:Clients', confirm: true } }));

    vi.mocked(apiPost).mockResolvedValueOnce({ deleted: 200, remaining: 40, total: 240 }).mockResolvedValueOnce({ deleted: 40, remaining: 0, total: 40 });
    const menu = await menuFor(/^Trash/);
    fireEvent.click(within(menu).getByRole('menuitem', { name: /^Empty folder…/ }));
    dialog = await screen.findByRole('dialog', { name: 'Empty Trash?' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Empty folder' }));
    await waitFor(() => expect(toast).toHaveBeenCalledWith('success', '240 messages permanently deleted.'));
    expect(apiPost).toHaveBeenCalledTimes(2);
    expect(apiPost).toHaveBeenCalledWith('/api/mail/folder-ops/empty', { mailbox: 4, folder: 'trash' });
  });

  it('shows a folder’s total instead of its unread when asked, and remembers it', async () => {
    show();
    const nav = await screen.findByRole('navigation', { name: 'Mail' });
    const row = await within(nav).findByRole('button', { name: /^Clients\s*\d*$/ });
    expect(row.textContent).toContain('5');
    fireEvent.click(within(await menuFor(/^Clients\s*\d*$/)).getByRole('menuitemradio', { name: /^Show total count/ }));
    await waitFor(() => expect(within(nav).getByRole('button', { name: /^Clients\s*\d*$/ }).textContent).toContain('57'));
    expect(JSON.parse(window.localStorage.getItem('ws.mail.counts')!)).toEqual({ '4:label:Clients': 'total' });
  });

  it('shows size, counts, last sync and account in Properties', async () => {
    show();
    fireEvent.click(within(await menuFor(/^Clients\s*\d*$/)).getByRole('menuitem', { name: /^Properties/ }));
    const dialog = await screen.findByRole('dialog', { name: /Clients — properties/ });
    await waitFor(() => expect(within(dialog).getByText('3.0 MB')).toBeTruthy());
    expect(within(dialog).getByText(box.email)).toBeTruthy();
    expect(within(dialog).getByText('57')).toBeTruthy();
    expect(within(dialog).getByText('Last synced')).toBeTruthy();
  });

  it('has an account menu on the account’s own row', async () => {
    const onSettings = vi.fn();
    show({ onSettings });
    const nav = await screen.findByRole('navigation', { name: 'Mail' });
    fireEvent.contextMenu(within(nav).getByRole('button', { name: /^me@example\.test/ }));
    const menu = await screen.findByRole('menu', { name: 'Folder actions' });
    for (const name of [/^Sync me@example\.test/, /^Mark all in Inbox as read/, /^New folder…/, /^Account settings…/]) expect(within(menu).getByRole('menuitem', { name })).toBeTruthy();
    fireEvent.click(within(menu).getByRole('menuitem', { name: /^Mark all in Inbox as read/ }));
    await waitFor(() => expect(submitted.at(-1)).toMatchObject({ path: '/api/mail/folder-ops/read-all', body: { mailbox: 4, folder: 'inbox' } }));
  });

  it('offers no folder actions while offline that cannot wait', async () => {
    show({ offline: true });
    const menu = await menuFor(/^Trash/);
    expect(within(menu).getByRole('menuitem', { name: /Sync this folder now/ }).getAttribute('aria-disabled')).toBe('true');
    expect(within(menu).getByRole('menuitem', { name: /Empty folder…/ }).getAttribute('aria-disabled')).toBe('true');
    // Changes that can wait still go to the queue.
    const folderMenu = await menuFor(/^Clients\s*\d*$/);
    expect(within(folderMenu).getByRole('menuitem', { name: /^Mark all as read/ }).getAttribute('aria-disabled')).not.toBe('true');
    expect(within(folderMenu).getByRole('menuitem', { name: /^Rename…/ }).getAttribute('aria-disabled')).not.toBe('true');
  });
});

describe('where a folder can be moved', () => {
  it('is the top, Inbox or another folder of yours — never itself, its own subfolders or where it already is', () => {
    expect(moveTargets(folders, 'label:Clients').map((t) => t.slug)).toEqual(['inbox', 'label:Projects']);
    expect(moveTargets(folders, 'label:Clients/Acme').map((t) => t.slug)).toEqual(['', 'inbox', 'label:Projects']);
  });
});

describe('cached first, then fresh', () => {
  const saved = (data: unknown) => ({ body: JSON.stringify({ status: 'success', data }), cachedAt: '2026-10-03T08:00:00.000Z' });

  it('shows a saved answer at once, marked stale so the server is still asked, and never over a live one', async () => {
    vi.mocked(call).mockImplementation((async (channel: string, input: { paths: string[] }) => (channel === 'offline:peek' ? input.paths.map(() => saved({ folders })) : null)) as never);
    const qc = new QueryClient();
    expect(await seedFromLocal(qc, mailKeys.folders(4), { path: '/api/mail/folders', query: { mailbox: 4 } }, (r) => r.data)).toBe(true);
    expect(call).toHaveBeenCalledWith('offline:peek', { paths: ['/api/mail/folders?mailbox=4'] });
    expect(qc.getQueryData(mailKeys.folders(4))).toEqual({ folders });
    expect(qc.getQueryState(mailKeys.folders(4))!.dataUpdatedAt).toBe(0);

    qc.setQueryData(mailKeys.folders(5), { folders: [] });
    expect(await seedFromLocal(qc, mailKeys.folders(5), { path: '/api/mail/folders', query: { mailbox: 5 } }, (r) => r.data)).toBe(false);
    expect(qc.getQueryData(mailKeys.folders(5))).toEqual({ folders: [] });
  });

  it('opens a message from this computer, as opened or as fetched ahead', async () => {
    vi.mocked(call).mockImplementation((async (channel: string, input: { paths: string[] }) => (channel === 'offline:peek' ? input.paths.map((p) => (p.includes('peek=1') ? saved({ id: 9, subject: 'Ahead' }) : null)) : null)) as never);
    const qc = new QueryClient();
    const ref = { uid: '9', folder: 'inbox', mailbox: '4' };
    expect(await seedMessage(qc, ref, false)).toBe(true);
    expect(qc.getQueryData(['mail', 'message', '4', 'inbox', '9'])).toMatchObject({ data: { subject: 'Ahead' }, local: true, peeked: true });
  });

  it('fetches the next few messages ahead without marking them read, skipping ones already here', async () => {
    forgetPrefetchFailures();
    vi.mocked(request).mockReset().mockResolvedValue({ data: { id: 1 }, offline: false, cachedAt: null });
    const qc = new QueryClient();
    qc.setQueryData(['mail', 'message', '4', 'inbox', '2'], { data: { id: 2 } });
    prefetchMessages(qc, [1, 2, 3, 4, 5].map((n) => ({ uid: String(n), folder: 'inbox', mailbox: '4' })));
    await waitFor(() => expect(request).toHaveBeenCalledTimes(PREFETCH_AHEAD - 1));
    // In the background: the server never gives it the connection kept for what a person opens (#228).
    expect(request).toHaveBeenCalledWith('GET', '/api/mail/messages/1', { query: { folder: 'inbox', peek: 1, mailbox: '4' }, signal: expect.anything(), headers: { 'X-Mail-Priority': 'background' } });
    expect(vi.mocked(request).mock.calls.map((c) => c[1])).not.toContain('/api/mail/messages/2');
    await waitFor(() => expect(qc.getQueryData(['mail', 'message', '4', 'inbox', '1'])).toMatchObject({ peeked: true }));
  });

  it('never fetches ahead a row without a server ID, and a failed one waits before the next try (#228)', async () => {
    forgetPrefetchFailures();
    vi.mocked(request).mockReset().mockRejectedValue(new ApiError(503, 'Waiting for a free connection.', null, { code: 'mail_busy' }));
    const qc = new QueryClient();
    prefetchMessages(qc, [{ uid: '0', folder: 'inbox', mailbox: '4' }, { uid: '7', folder: 'inbox', mailbox: '4' }], 1_000);
    await waitFor(() => expect(request).toHaveBeenCalledTimes(1));
    expect(vi.mocked(request).mock.calls[0]![1]).toBe('/api/mail/messages/7');
    await waitFor(() => expect(qc.getQueryState(['mail', 'message', '4', 'inbox', '7'])?.status).toBe('error'));
    await new Promise((r) => setTimeout(r, 0));
    qc.removeQueries();
    prefetchMessages(qc, [{ uid: '7', folder: 'inbox', mailbox: '4' }], 20_000);
    prefetchMessages(qc, [{ uid: '7', folder: 'inbox', mailbox: '4' }], 32_000);
    await waitFor(() => expect(request).toHaveBeenCalledTimes(2));
  });
});

describe('search, offline', () => {
  it('searches the mail kept on this computer, with each result’s account', async () => {
    vi.mocked(call).mockImplementation((async (channel: string) => (channel === 'offline:mailSearch' ? [{ id: 1, subject: 'Budget', mailbox: { id: 4 }, folder_slug: 'inbox' }, { id: 2, subject: 'Budget too', mailbox: { id: 9 }, folder_slug: 'inbox' }] : null)) as never);
    const all = await offlineMailSearch('budget', [box], null);
    expect(call).toHaveBeenCalledWith('offline:mailSearch', { q: 'budget' });
    expect(all).toHaveLength(2);
    expect(all[0]!.mailbox).toEqual({ id: 4, email: box.email, name: box.email, colour: '' });
    expect((await offlineMailSearch('budget', [box], '4')).map((m) => m.id)).toEqual([1]);
  });
});
