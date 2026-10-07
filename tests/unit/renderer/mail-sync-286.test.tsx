// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as CoreApi from '../../../src/core/api';

vi.mock('../../../src/core/api', async (orig) => ({ ...(await orig<typeof CoreApi>()), apiGet: vi.fn(), apiGetMeta: vi.fn(), apiPost: vi.fn(), apiPut: vi.fn(), apiDelete: vi.fn() }));
vi.mock('../../../src/core/bridge', () => ({ call: vi.fn(async () => null), on: () => () => undefined, errorMessage: (e: unknown) => (e instanceof Error ? e.message : String(e)), isMac: false, hasDesktop: () => true }));
vi.mock('../../../src/core/toasts', () => ({ toast: vi.fn() }));

import { ApiError, apiGet, apiPut } from '../../../src/core/api';
import { app } from '../../../src/core/app-state';
import { setRegional } from '../../../src/core/time';
import { AccountsSync, attemptWords, progressWords } from '../../../src/modules/mail/AccountsSync';
import { syncingLine as listSyncingLine } from '../../../src/modules/mail/listLoading';
import { StatusBar } from '../../../src/modules/mail/StatusBar';
import { SyncFolders, choiceFor, folderStateWord } from '../../../src/modules/mail/SyncFolders';
import { SyncLog, folderGroups, folderWord, logText, resultWord, syncingLine } from '../../../src/modules/mail/SyncLog';
import { accountState, etaWords, firstSyncLine, syncRunner, syncSummary } from '../../../src/modules/mail/sync';
import type { Mailbox, SyncAccount, SyncFolder, SyncRun, SyncStatus } from '../../../src/modules/mail/types';

/**
 * A first sync that finishes (worksuite-desktop#286): "First sync · headers
 * 12 of 21 folders · started 1:20 · about 4 min left" while it runs, the log
 * grouping folders by their real state, Settings › Mail › Accounts › Folders
 * to sync a skipped folder — and no "Syncing…" once it is done (#287). An
 * older server's answers show as before.
 */

const NOW = new Date('2026-10-07T01:31:00Z');
const BOX = { id: 4, email: 'office@example.test', display_name: 'Office', shared: false, unread: 3, in_unified: true, provider: 'imap', provider_label: 'Exchange', colour: 'teal', auth_state: 'ok' } as unknown as Mailbox;
const FIRST = { started_at: '2026-10-07 01:20:00', folders: 21, folders_done: 12, have: 6000, want: 9000, eta_seconds: 240 };
const acct = (over: Partial<SyncAccount> = {}): SyncAccount => ({ mailbox: 4, email: BOX.email, name: 'Office', included: true, paused: false, mode: 'interval', interval_min: 5, last_ok_at: null, last_attempt_at: '2026-10-07 01:31:00', last_result: 'partial', error_code: null, error: null, running: true, mirror: true, pushed: false, folders: 21, folders_done: 12, folders_skipped: 6, complete: false, messages: 6000, first_sync: FIRST, ...over });
const status = (accounts: SyncAccount[]): SyncStatus => ({ enabled: true, mailboxes: [], accounts, overall: { state: 'syncing', syncing: 1, total: accounts.length, last_ok_at: null, failed: [], stale: [], stale_minutes: 60 } });

const folder = (name: string, over: Partial<SyncRun['details'] extends Array<infer F> | undefined ? F : never> = {}) => ({ folder: name, path: name, role: null, status: 'ok', added: 0, changed: 0, removed: 0, ms: 300, state: 'up_to_date', ...over });
const RUNS: SyncRun[] = [
  {
    id: 31, started_by: 'auto', started_at: '2026-10-07 01:31:00', finished_at: '2026-10-07 01:31:15', duration_ms: 15_000, result: 'partial', phase: 'first_sync', folders: 16, folders_total: 16, added: 520, changed: 0, removed: 0, bodies: 0, errors: 1, error_code: null,
    error: '1 folder failed (Archive/2019: NO [UNAVAILABLE]); First sync: 12 of 16 folders done; continuing',
    details: [
      folder('INBOX', { role: 'inbox', note: 'unchanged' }),
      folder('Sent Items', { role: 'sent' }),
      folder('Projects/P01', { status: 'pending', state: 'downloading', added: 250, have: 250, want: 300 }),
      folder('Projects/P02', { status: 'pending', state: 'downloading', added: 270, have: 520, want: 1200 }),
      folder('Projects/P03', { status: 'pending', state: 'waiting', have: 0, want: 300 }),
      folder('Archive/2019', { status: 'error', state: 'error', error: 'EXAMINE "Archive/2019": NO [UNAVAILABLE] try again later' }),
      folder('Calendar', { status: 'skipped', state: 'skipped', reason: 'not_mail', kind: 'calendar', ms: 0 }),
      folder('Notes', { status: 'skipped', state: 'skipped', reason: 'not_mail', kind: 'notes', ms: 0 }),
    ],
  },
  { id: 30, started_by: 'auto', started_at: '2026-10-07 01:30:30', finished_at: '2026-10-07 01:30:50', duration_ms: 20_000, result: 'partial', phase: 'first_sync', folders: 16, folders_total: 16, added: 1250, changed: 0, removed: 0, bodies: 0, errors: 0, error_code: null, error: 'First sync: 10 of 16 folders done; continuing', details: [folder('INBOX')] },
  { id: 29, started_by: 'auto', started_at: '2026-10-06 23:00:00', finished_at: '2026-10-06 23:00:03', duration_ms: 3_000, result: 'ok', phase: 'update', folders: 16, folders_total: 16, added: 0, changed: 0, removed: 0, bodies: 0, errors: 0, error_code: null, error: null, details: [folder('INBOX')] },
];

const FOLDERS: SyncFolder[] = [
  { path: 'INBOX', name: 'Inbox', role: 'inbox', kind: null, sync: true, choice: null, state: 'up_to_date', have: 840, want: 840, total: 5200, reason: null },
  { path: 'Calendar', name: 'Calendar', role: null, kind: 'calendar', sync: false, choice: null, state: 'skipped', have: 0, want: null, total: 312, reason: 'not_mail' },
  { path: 'Clients', name: 'Clients', role: null, kind: null, sync: true, choice: null, state: 'downloading', have: 250, want: 1200, total: 4000, reason: null },
  { path: 'Notes', name: 'Notes', role: null, kind: 'notes', sync: true, choice: true, state: 'waiting', have: 0, want: null, total: 12, reason: null },
  { path: 'Spam', name: 'Spam', role: 'junk', kind: null, sync: true, choice: null, state: 'error', have: 0, want: null, total: 3, reason: 'NO [UNAVAILABLE]' },
];

function wrap(node: ReactNode) {
  return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{node}</QueryClientProvider>);
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  setRegional({ timezone: 'UTC', locale: 'en-GB', timeFormat: '24' });
  syncRunner.set({ running: new Set(), all: false, errors: {} });
  app.set({ status: { network: 'ONLINE' } as never, prefs: { mailCacheDays: 30, moduleNotifications: {}, badgeCount: true, theme: 'light' } as never, bootstrap: { user: { id: '9', name: 'Me', email: 'me@example.test' } } as never, apps: [] });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('the first sync, while it runs (#286)', () => {
  it('says how far it has got, when it began and how long is left', () => {
    expect(firstSyncLine(acct())).toBe('First sync · headers 12 of 21 folders · started 1:20 · about 4 min left');
    expect(firstSyncLine(acct({ first_sync: { ...FIRST, eta_seconds: null } }))).toBe('First sync · headers 12 of 21 folders · started 1:20');
    expect(firstSyncLine(acct({ first_sync: null }))).toBeNull();
    expect(firstSyncLine(acct({ first_sync: undefined }))).toBeNull();
    expect([etaWords(30), etaWords(240), etaWords(4200), etaWords(7200), etaWords(null)]).toEqual(['less than a minute left', 'about 4 min left', 'about 1 h 10 min left', 'about 2 h left', null]);

    // The same line wherever the account shows: its row, Settings' last attempt, the log's header.
    expect(accountState(acct()).label).toBe('First sync · headers 12 of 21 folders · about 4 min left');
    expect(attemptWords(acct()).label).toBe('First sync · headers 12 of 21 folders · started 1:20 · about 4 min left');
    expect(syncingLine(acct())).toBe('First sync · headers 12 of 21 folders · started 1:20 · about 4 min left');
    expect(progressWords(acct(), undefined, undefined)).toBe('Headers 12 of 21 folders · 6 not synced');

    // An older server: as before.
    const old = acct({ first_sync: undefined, folders_skipped: undefined, folders: 27, folders_done: 2 });
    expect(accountState(old).label).toBe('Syncing 2 of 27 folders…');
    expect(attemptWords(old).label).toBe('In progress · 2 of 27 folders');
  });

  it('is the status bar’s line, and the list’s headers count is the server’s', () => {
    const s = syncSummary(status([acct()]), { offline: false });
    expect([s.state, s.headline]).toEqual(['syncing', 'First sync · headers 12 of 21 folders · about 4 min left']);
    render(<StatusBar summary={s} sync={status([acct()])} waiting={0} zoom={100} localBytes={null} />);
    expect(screen.getByRole('status', { name: 'Mail status' }).textContent).toContain('First sync · headers 12 of 21 folders · about 4 min left');
    expect(listSyncingLine([acct()], ['4'], 52_000)).toBe('Syncing headers… 6,000 of 9,000');

    // Two accounts syncing: the count, as before.
    expect(syncSummary(status([acct(), acct({ mailbox: 5, first_sync: null })]), { offline: false }).headline).toBe('Syncing 2 of 2 accounts…');
  });
});

describe('once it is done, nothing says "Syncing" (#287)', () => {
  it('drops the status bar’s and the list’s syncing lines when the run is complete', () => {
    const done = acct({ running: false, last_result: 'ok', last_ok_at: '2026-10-07 01:30:00', folders_done: 21, complete: true, first_sync: null, messages: 2707 });
    const s = syncSummary(status([done]), { offline: false });
    expect(s.state).toBe('up_to_date');
    render(<StatusBar summary={s} sync={status([done])} waiting={0} zoom={100} localBytes={null} />);
    expect(screen.getByRole('status', { name: 'Mail status' }).textContent).not.toMatch(/Syncing/);
    expect(listSyncingLine([done], ['4'], 2707)).toBeNull();

    // The server's first sync is over even if a folder is still failing: no "Syncing headers…" for ever.
    expect(listSyncingLine([acct({ running: true, complete: false, first_sync: null })], ['4'], 2707)).toBeNull();
    // An older server whose count has reached the end: never "2,707 of 2,707".
    expect(listSyncingLine([{ mailbox: 4, running: true, complete: false, messages: 2707 } as never], ['4'], 2707)).toBeNull();
    expect(listSyncingLine([{ mailbox: 4, running: true, complete: false, messages: 340 } as never], ['4'], 2707)).toBe('Syncing headers… 340 of 2,000');
  });
});

describe('the sync log groups folders by their real state (#286)', () => {
  beforeEach(() => {
    vi.mocked(apiGet).mockReset().mockImplementation((async (path: string) => {
      if (path === '/api/mail/mailboxes/4/sync-log') return { runs: RUNS, account: acct() };
      throw new ApiError(404, path, null);
    }) as never);
  });

  it('says First sync for a batch of it, and Partial when a folder failed', async () => {
    expect([resultWord('partial', 'first_sync', 0), resultWord('partial', 'first_sync', 1), resultWord('partial', null, 0), resultWord('ok', 'first_sync', 0)]).toEqual(['First sync', 'Partial', 'Partial', 'Success']);
    wrap(<SyncLog box={BOX} account={acct()} onClose={() => undefined} onRepair={() => undefined} />);
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('First sync · headers 12 of 21 folders · started 1:20 · about 4 min left')).toBeTruthy();
    const runs = within(await within(dialog).findByRole('table')).getAllByRole('row').filter((r) => r.getAttribute('aria-label')?.startsWith('Run started'));
    expect(runs.map((r) => within(r).getAllByRole('cell')[2]!.textContent)).toEqual(['Partial', 'First sync', 'Success']);
  });

  it('shows errors, downloading and waiting folders, with up to date and skipped folded away', async () => {
    wrap(<SyncLog box={BOX} account={acct()} onClose={() => undefined} onRepair={() => undefined} />);
    const dialog = await screen.findByRole('dialog');
    fireEvent.click((await within(dialog).findAllByRole('button', { name: 'Details' }))[0]!);

    expect(within(dialog).queryByRole('list', { name: 'Folders in this run' })).toBeNull();
    expect(within(dialog).getAllByRole('region').map((g) => g.getAttribute('aria-label'))).toEqual(['Errors', 'Downloading', 'Waiting', 'Up to date', 'Skipped']);
    const errors = within(within(dialog).getByRole('list', { name: 'Folders · Errors' })).getAllByRole('listitem');
    expect(errors[0]!.textContent).toContain('EXAMINE "Archive/2019": NO [UNAVAILABLE] try again later');
    const downloading = within(within(dialog).getByRole('list', { name: 'Folders · Downloading' })).getAllByRole('listitem');
    expect(downloading.map((li) => li.textContent)).toEqual([expect.stringContaining('Downloading 250 of 300'), expect.stringContaining('Downloading 520 of 1,200')]);
    expect(downloading[0]!.textContent).toContain('+250');
    expect(within(dialog).getByRole('list', { name: 'Folders · Waiting' }).textContent).toContain('Waiting for its turn');

    // Folded: a count, opened on a click.
    expect(within(dialog).queryByRole('list', { name: 'Folders · Up to date' })).toBeNull();
    const upToDate = within(dialog).getByRole('button', { name: 'Up to date · 2' });
    expect(upToDate.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(upToDate);
    expect(within(within(dialog).getByRole('list', { name: 'Folders · Up to date' })).getAllByRole('listitem')).toHaveLength(2);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Skipped · 2' }));
    expect(within(dialog).getByRole('list', { name: 'Folders · Skipped' }).textContent).toContain('Skipped (not a mail folder)');
  });

  it('words each state, and copies them for support', () => {
    expect(folderWord(folder('x', { state: 'up_to_date' }) as never)).toBe('Up to date');
    expect(folderWord(folder('x', { state: 'downloading', have: 1200, want: 2000 }) as never)).toBe('Downloading 1,200 of 2,000');
    expect(folderWord(folder('x', { state: 'downloading', have: 10, want: null }) as never)).toBe('Downloading');
    expect(folderWord(folder('x', { state: 'skipped', status: 'skipped', reason: 'off' }) as never)).toBe('Skipped (turned off)');
    expect(folderWord(folder('x', { state: undefined, status: 'pending' }) as never)).toBe('More to download');
    expect(folderGroups([folder('x', { state: undefined }) as never])).toBeNull();
    const t = logText(BOX.email, RUNS);
    expect(t).toContain('\tProjects/P02: Downloading 520 of 1,200 · +270 ~0 -0 · 0.3 s');
    expect(t).toContain('\tCalendar: Skipped (not a mail folder) · +0 ~0 -0 · 0.0 s');
    expect(t.split('\n').find((l) => l.startsWith('2026-10-07 01:30:30'))).toMatch(/^2026-10-07 01:30:30\t20\.0 s\tFirst sync\t/);
  });
});

describe('Settings › Mail › Accounts › Folders (#286)', () => {
  beforeEach(() => {
    vi.mocked(apiGet).mockReset().mockImplementation((async (path: string) => {
      if (path === '/api/mail/mailboxes/4/sync-folders') return { mailbox: 4, folders: FOLDERS, can_choose: true };
      if (path === '/api/mail/sync/status') return status([acct()]);
      throw new ApiError(404, path, null);
    }) as never);
    vi.mocked(apiPut).mockReset().mockImplementation((async (_path: string, body: { path: string; sync: boolean | null }) => ({ mailbox: 4, folders: FOLDERS.map((f) => (f.path === body.path ? { ...f, sync: body.sync ?? f.kind === null, choice: body.sync, state: body.sync === false || (body.sync === null && f.kind !== null) ? 'skipped' : 'waiting' } : f)) })) as never);
  });

  it('lists every folder with its state, and syncs a skipped one or stops syncing another', async () => {
    wrap(<SyncFolders box={BOX} onClose={() => undefined} />);
    const list = await screen.findByRole('list', { name: 'Folders' });
    const row = (name: string) => within(list).getByRole('listitem', { name });
    expect(row('Calendar').textContent).toContain('Skipped (not a mail folder)');
    expect(row('Clients').textContent).toContain('Downloading 250 of 1,200');
    expect(row('Notes').textContent).toContain('Waiting for its turn');
    expect(row('Spam').textContent).toContain('Error — NO [UNAVAILABLE]');
    expect((within(row('Inbox')).getByRole('switch', { name: 'Sync Inbox' }) as HTMLButtonElement).disabled).toBe(true);

    fireEvent.click(within(row('Calendar')).getByRole('switch', { name: 'Sync Calendar' }));
    await waitFor(() => expect(apiPut).toHaveBeenCalledWith('/api/mail/mailboxes/4/sync-folders', { path: 'Calendar', sync: true }));
    await waitFor(() => expect(within(row('Calendar')).getByRole('switch').getAttribute('aria-checked')).toBe('true'));

    fireEvent.click(within(row('Clients')).getByRole('switch', { name: 'Sync Clients' }));
    await waitFor(() => expect(apiPut).toHaveBeenCalledWith('/api/mail/mailboxes/4/sync-folders', { path: 'Clients', sync: false }));
  });

  it('goes back to deciding by kind when a choice is undone', () => {
    expect([choiceFor({ kind: 'notes' }, true), choiceFor({ kind: 'notes' }, false), choiceFor({ kind: null }, false), choiceFor({ kind: null }, true)]).toEqual([true, null, false, null]);
    expect(folderStateWord({ state: 'skipped', have: 0, want: null, reason: 'off' })).toBe('Skipped (turned off)');
  });

  it('opens from the account in Settings, which says First sync while it runs', async () => {
    wrap(<AccountsSync boxes={[BOX]} prefs={{}} onPrefs={() => undefined} onRepair={() => undefined} />);
    const row = await screen.findByRole('listitem', { name: 'office@example.test' });
    await waitFor(() => expect(within(row).getByText('First sync')).toBeTruthy());
    expect(within(row).getByText('First sync · headers 12 of 21 folders · started 1:20 · about 4 min left')).toBeTruthy();
    expect(within(row).getByText('Never')).toBeTruthy();
    fireEvent.click(within(row).getByRole('button', { name: 'Folders' }));
    expect(await screen.findByRole('dialog', { name: 'Folders · office@example.test' })).toBeTruthy();
  });

  it('offers no Folders button for an older server', async () => {
    vi.mocked(apiGet).mockImplementation((async (path: string) => {
      if (path === '/api/mail/sync/status') return status([acct({ first_sync: undefined, folders_skipped: undefined })]);
      throw new ApiError(404, path, null);
    }) as never);
    wrap(<AccountsSync boxes={[BOX]} prefs={{}} onPrefs={() => undefined} onRepair={() => undefined} />);
    const row = await screen.findByRole('listitem', { name: 'office@example.test' });
    await waitFor(() => expect(within(row).getByText('Syncing…')).toBeTruthy());
    expect(within(row).queryByRole('button', { name: 'Folders' })).toBeNull();
  });
});
