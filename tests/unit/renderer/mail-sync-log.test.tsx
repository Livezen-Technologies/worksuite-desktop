// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as CoreApi from '../../../src/core/api';

vi.mock('../../../src/core/api', async (orig) => ({ ...(await orig<typeof CoreApi>()), apiGet: vi.fn(), apiGetMeta: vi.fn(), apiPost: vi.fn(), apiPut: vi.fn(), apiDelete: vi.fn() }));
vi.mock('../../../src/core/bridge', () => ({ call: vi.fn(async () => null), on: () => () => undefined, errorMessage: (e: unknown) => (e instanceof Error ? e.message : String(e)), isMac: false, hasDesktop: () => true }));
vi.mock('../../../src/core/toasts', () => ({ toast: vi.fn() }));

import { ApiError, apiGet } from '../../../src/core/api';
import { app } from '../../../src/core/app-state';
import { call } from '../../../src/core/bridge';
import { toast } from '../../../src/core/toasts';
import { AccountsSync, downloading, progressWords, sizeWords } from '../../../src/modules/mail/AccountsSync';
import { SyncLog, folderWord, logText, resultWord, took } from '../../../src/modules/mail/SyncLog';
import type { Mailbox, SyncAccount, SyncRun } from '../../../src/modules/mail/types';

/**
 * The sync log and the account's progress in Settings › Mail › Accounts
 * (worksuite-desktop#190): one row per run with its counts, each expandable
 * to every folder and its error, nothing cut off; Copy log and Export; and
 * "Headers 12 of 27 folders · Bodies 340 of 1,200" with what this computer
 * keeps, kept current.
 */

const BOX = { id: 4, email: 'sales@example.test', display_name: 'Sales', shared: false, unread: 3, in_unified: true, provider: 'imap', provider_label: 'IMAP', colour: 'teal', auth_state: 'ok' } as unknown as Mailbox;
const acct = (over: Partial<SyncAccount> = {}): SyncAccount => ({ mailbox: 4, email: BOX.email, name: 'Sales', included: true, paused: false, mode: 'interval', interval_min: 5, last_ok_at: '2026-10-03 08:00:00', last_attempt_at: '2026-10-03 08:05:00', last_result: 'partial', error_code: null, error: null, running: false, mirror: true, pushed: false, folders: 27, folders_done: 12, ...over });
const LONG = 'EXAMINE "Archive/2019/Projects/Very long folder name": NO [UNAVAILABLE] Mailbox is temporarily unavailable on the backend, please try again in a few minutes';
const RUNS: SyncRun[] = [
  {
    id: 12, started_by: 'auto', started_at: '2026-10-03 08:05:00', finished_at: '2026-10-03 08:05:31', duration_ms: 31_000, result: 'partial', folders: 15, folders_total: 16, added: 750, changed: 4, removed: 2, bodies: 20, errors: 1, error_code: null,
    error: '1 folder failed (Archive/2019: …); 3 folders still downloading',
    details: [
      { folder: 'INBOX', path: 'INBOX', role: 'inbox', status: 'ok', added: 500, changed: 4, removed: 2, ms: 9000 },
      { folder: 'Entwürfe', path: 'Entw&APw-rfe', role: null, status: 'pending', added: 250, changed: 0, removed: 0, ms: 12000 },
      { folder: 'Archive/2019', path: 'Archive/2019', role: null, status: 'error', added: 0, changed: 0, removed: 0, ms: 30000, error: LONG },
    ],
  },
  { id: 11, started_by: 'manual', started_at: '2026-10-03 08:00:00', finished_at: '2026-10-03 08:00:04', duration_ms: 4_200, result: 'ok', folders: 16, folders_total: 16, added: 0, changed: 0, removed: 0, bodies: 0, errors: 0, error_code: null, error: null, details: [{ folder: 'INBOX', path: 'INBOX', role: 'inbox', status: 'ok', added: 0, changed: 0, removed: 0, note: 'unchanged' }] },
  { id: 10, started_by: 'auto', started_at: '2026-10-03 07:59:00', finished_at: null, duration_ms: 60_000, result: 'running', folders: 3, folders_total: 16, added: 40, changed: 0, removed: 0, error_code: null, error: null },
];

function wrap(node: ReactNode) {
  return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{node}</QueryClientProvider>);
}

describe('the sync log (#190)', () => {
  beforeEach(() => {
    app.set({ status: { network: 'ONLINE' } as never, prefs: { mailCacheDays: 30, moduleNotifications: {}, badgeCount: true, theme: 'light' } as never, bootstrap: { user: { id: '9', name: 'Me', email: 'me@example.test' } } as never, apps: [] });
    vi.mocked(apiGet).mockReset().mockImplementation((async (path: string) => {
      if (path === '/api/mail/mailboxes/4/sync-log') return { runs: RUNS, account: acct() };
      throw new ApiError(404, path, null);
    }) as never);
    vi.mocked(call).mockReset().mockResolvedValue('/home/me/WorkSuite sync log 4.txt' as never);
    vi.mocked(toast).mockReset();
  });
  afterEach(cleanup);

  it('shows one row per run with every count, and a result for each', async () => {
    wrap(<SyncLog box={BOX} account={acct()} onClose={() => undefined} onRepair={() => undefined} />);
    const dialog = await screen.findByRole('dialog', { name: 'Sync log · sales@example.test' });
    const table = await within(dialog).findByRole('table');
    expect(within(table).getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['Started', 'Took', 'Result', 'Folders', 'Added', 'Updated', 'Removed', 'Bodies', 'Errors', 'Details']);
    const first = within(table).getAllByRole('row')[1]!;
    const cells = within(first).getAllByRole('cell').map((c) => c.textContent);
    expect(cells.slice(1, 9)).toEqual(['31.0 s', 'Partial', '15 of 16', '+750', '4', '2', '20', '1']);
    expect(within(table).getByText('Success')).toBeTruthy();
    expect(within(table).getByText('Running')).toBeTruthy();
    // The run's reason is shown in full, not cut off.
    expect(within(table).getByText('1 folder failed (Archive/2019: …); 3 folders still downloading').className).toContain('whitespace-normal');
  });

  it('expands a run to each folder, with its error in full', async () => {
    wrap(<SyncLog box={BOX} account={acct()} onClose={() => undefined} onRepair={() => undefined} />);
    const dialog = await screen.findByRole('dialog');
    const toggles = await within(dialog).findAllByRole('button', { name: 'Details' });
    fireEvent.click(toggles[0]!);
    const folders = within(dialog).getByRole('list', { name: 'Folders in this run' });
    const items = within(folders).getAllByRole('listitem');
    expect(items).toHaveLength(3);
    expect(items[0]!.textContent).toContain('INBOX');
    expect(items[0]!.textContent).toContain('Synced');
    expect(items[1]!.textContent).toContain('Entwürfe');
    expect(items[1]!.textContent).toContain('More to download');
    expect(within(items[2]!).getByText(LONG).className).toContain('break-words');
    expect(within(dialog).getByRole('button', { name: 'Hide' }).getAttribute('aria-expanded')).toBe('true');
  });

  it('copies and exports the log with every folder', async () => {
    const writeText = vi.fn(async () => undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    wrap(<SyncLog box={BOX} account={acct()} onClose={() => undefined} onRepair={() => undefined} />);
    const dialog = await screen.findByRole('dialog');
    await within(dialog).findByRole('table');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Copy log for support' }));
    await waitFor(() => expect(writeText).toHaveBeenCalled());
    const copied = String((writeText.mock.calls[0] as unknown[])[0]);
    expect(copied).toContain('Archive/2019: Failed');
    expect(copied).toContain(LONG);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Export…' }));
    await waitFor(() => expect(call).toHaveBeenCalledWith('files:saveText', { name: 'WorkSuite sync log 4.txt', text: copied }));
    await waitFor(() => expect(toast).toHaveBeenCalledWith('success', 'Sync log saved.'));
  });

  it('words a run and its folders', () => {
    expect([resultWord('ok'), resultWord('partial'), resultWord('failed'), resultWord('running')]).toEqual(['Success', 'Partial', 'Failed', 'Running']);
    expect([took(4200), took(95_000), took(null)]).toEqual(['4.2 s', '1 min 35 s', '—']);
    expect(folderWord({ folder: 'x', path: 'x', role: null, status: 'not_reached', added: 0, changed: 0, removed: 0 })).toBe('Not reached in this run');
    const t = logText('a@example.test', RUNS).split('\n');
    expect(t[2]).toBe(['2026-10-03 08:05:00', '31.0 s', 'Partial', '15/16', '750', '4', '2', '20', '1', '1 folder failed (Archive/2019: …); 3 folders still downloading'].join('\t'));
    expect(t[3]).toBe('\tINBOX (inbox): Synced · +500 ~4 -2 · 9.0 s');
  });
});

describe('an account’s progress in Settings › Mail › Accounts (#190)', () => {
  afterEach(cleanup);

  it('says how far headers and bodies have got, and what this computer keeps', () => {
    expect(progressWords(acct(), { stored: 340, wanted: 1200, running: true, doneAt: null, error: null }, 18_200_000)).toBe('Headers 12 of 27 folders · Bodies 340 of 1,200 · 17.4 MB on this computer');
    expect(progressWords(acct({ folders_done: 27 }), { stored: 1200, wanted: 1200, running: false, doneAt: null, error: null }, 2048)).toBe('Headers: all 27 folders · Bodies 1,200 of 1,200 · 2 KB on this computer');
    expect(progressWords(null, undefined, undefined)).toBe('');
    expect(sizeWords(464 * 1024)).toBe('464 KB');
    expect(downloading({ total: 0, messages: 0, lists: 0, search: 0, other: 0, byMailbox: {}, bodies: { '4': { stored: 1, wanted: 2, running: true, doneAt: null, error: null } } })).toBe(true);
    expect(downloading(null)).toBe(false);
  });

  it('shows it on the account, with the shared Sync button and Partly synced for an incomplete account', async () => {
    app.set({ status: { network: 'ONLINE' } as never });
    vi.mocked(apiGet).mockReset().mockImplementation((async (path: string) => {
      if (path === '/api/mail/sync/status') return { enabled: true, mailboxes: [], accounts: [acct({ folders_done: 12 })], overall: { state: 'attention', syncing: 0, total: 1, last_ok_at: null, failed: [], stale: [], stale_minutes: 60 } };
      throw new ApiError(404, path, null);
    }) as never);
    vi.mocked(call).mockReset().mockImplementation((async (channel: string) => {
      if (channel === 'offline:mailStats') return { total: 18_200_000, messages: 18_000_000, lists: 200_000, search: 0, other: 0, byMailbox: { '4': { messages: 340, bytes: 18_200_000 } }, bodies: { '4': { stored: 340, wanted: 1200, running: true, doneAt: null, error: null } } };
      return null;
    }) as never);
    wrap(<AccountsSync boxes={[BOX]} prefs={{}} onPrefs={() => undefined} onRepair={() => undefined} />);
    const row = await screen.findByRole('listitem', { name: 'sales@example.test' });
    await waitFor(() => expect(within(row).getByLabelText('Progress').textContent).toBe('Headers 12 of 27 folders · Bodies 340 of 1,200 · 17.4 MB on this computer'));
    expect(within(row).getByText('Partly synced')).toBeTruthy();
    expect(within(row).getByRole('button', { name: /Sync/ })).toBeTruthy();
  });
});
