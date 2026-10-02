// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as CoreApi from '../../../src/core/api';
import type * as Tabs from '../../../src/core/tabs';

vi.mock('../../../src/core/api', async (orig) => ({ ...(await orig<typeof CoreApi>()), apiGet: vi.fn(), apiGetMeta: vi.fn(), apiPost: vi.fn(), apiPut: vi.fn(), apiDelete: vi.fn() }));
vi.mock('../../../src/core/bridge', () => ({ call: vi.fn(async () => null), on: () => () => undefined, errorMessage: (e: unknown) => (e instanceof Error ? e.message : String(e)), isMac: false, hasDesktop: () => true }));
vi.mock('../../../src/core/toasts', () => ({ toast: vi.fn() }));
const nav = vi.hoisted(() => ({ navigate: vi.fn() }));
vi.mock('../../../src/core/tabs', async (orig) => ({ ...(await orig<typeof Tabs>()), navigate: nav.navigate }));

import { ApiError, apiDelete, apiGet, apiGetMeta, apiPost, apiPut } from '../../../src/core/api';
import { app } from '../../../src/core/app-state';
import { call } from '../../../src/core/bridge';
import { TabProvider } from '../../../src/core/tab-context';
import { setRegional } from '../../../src/core/time';
import MailPage, { composeSeedFromQuery, teamRowShown } from '../../../src/modules/mail/MailPage';
import { MailSettings, copyWords, mailSettingsTab, offlineWords, storeParts } from '../../../src/modules/mail/MailSettings';
import { accountsFor, folderProgress, importActions, sinceFor, stageWords, timeLeft } from '../../../src/modules/mail/imports';
import { filterWords, senderRule } from '../../../src/modules/mail/MailRules';
import { isDesignedMail, mailFrameDoc } from '../../../src/modules/mail/sanitize';
import { parseQuery, relevance, sortResults, timeRange, withoutOperator } from '../../../src/modules/mail/SearchView';
import { snoozeChoices, viewersWords } from '../../../src/modules/mail/Team';
import type { MessageRow } from '../../../src/modules/mail/types';

/**
 * The Mail module against the Mail SRS v2.2 and the desktop designs: Import
 * my old mail (D08), working a shared mailbox together (D06), search's
 * chips, files and Best match (D07), storage and accounts on this computer
 * (D04, D09), reading options (D10), and the message's More menus (D13, D14).
 */

const NOW = new Date('2026-10-02T10:30:00Z');
const BOXES = [
  { id: 1, email: 'me@example.test', display_name: 'me', shared: false, unread: 5, in_unified: true, is_default: true, provider: 'local', provider_label: 'WorkSuite Local', account_type: 'local_mailbox', colour: 'blue', auth_state: 'ok', copy: { copy_mode: 'recent', stored_bytes: 2_000_000, window_months: 12, opens_from_copy: 0.986 } },
  { id: 3, email: 'sales@example.test', display_name: 'Sales', shared: true, unread: null, in_unified: true, colour: 'teal', auth_state: 'ok' },
];
const TEAM = { assignee_id: 9, assignee_name: 'Me', status: 'open', notes: 2, snoozed_until: null };
const SHARED_DETAIL = {
  id: 201,
  message_id: '<q@x>',
  conversation_key: 'q@x',
  from_name: 'Ishara',
  from_email: 'ishara@customer.test',
  subject: 'Support packages',
  to: ['sales@example.test'],
  cc: [],
  body_html: '<p>Can you share your support packages?</p>',
  attachments: [{ ref: '2', name: 'Brief.pdf', mime: 'application/pdf', size: 4000 }],
  is_starred: false,
  created_at: '2026-10-02 10:12:00',
  team: TEAM,
};
let routes: Record<string, unknown> = {};

function respond(path: string, params?: Record<string, unknown>) {
  if (path in routes) return typeof routes[path] === 'function' ? (routes[path] as (p?: Record<string, unknown>) => unknown)(params) : routes[path];
  if (path === '/api/mail/mailboxes') return { mailboxes: BOXES };
  if (path === '/api/mail/views') return { mailboxes: [], views: { unread: 0, starred: 0, today: 0, attachments: 0, drafts: 0, important: null, scheduled: 0 }, partial: false, unknown: [] };
  if (path === '/api/mail/folders') return { folders: [] };
  if (path === '/api/mail/sync/status') return { enabled: true, mailboxes: BOXES.map((b) => ({ mailbox: b.id, status: 'live', serving: true, lag_seconds: 12, pushed: true, problem: null })) };
  if (path === '/api/mail/prefs') return { prefs: [] };
  if (path === '/api/mail/labels') return { labels: [] };
  if (path === '/api/mail/signatures') return { signatures: [] };
  if (path === '/api/mail/templates') return { templates: [] };
  if (path.endsWith('/context')) return { sender: { email: 'ishara@customer.test', name: null, contact_id: null, user_id: null, is_colleague: false, company: null }, security: { available: false } };
  if (path === '/api/mail/messages/team/notes') return { notes: [{ id: 5, user_id: 4, name: 'Samali Perera', mine: false, body: 'Send the PDF with the discount.', created_at: '2026-10-02 10:20:00' }] };
  if (path === '/api/mail/messages/team/assignees') return { users: [{ id: 4, name: 'Samali Perera' }] };
  throw new ApiError(404, `no ${path}`, null);
}

const wrap = (node: ReactNode) => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{node}</QueryClientProvider>);

function Page({ initial }: { initial: string }) {
  const [route, setRoute] = useState(initial);
  return (
    <TabProvider tabId="t" route={route} active onGo={setRoute}>
      <MailPage active tabId="t" route={route} />
    </TabProvider>
  );
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  setRegional({ timezone: 'UTC', locale: 'en-GB', timeFormat: '24' });
  routes = {};
  app.set({ status: { network: 'ONLINE' } as never, prefs: { mailCacheDays: 30, moduleNotifications: {}, badgeCount: true, theme: 'light', mailtoHandler: false, mailCacheDaysByMailbox: {} } as never, bootstrap: { user: { id: '9', name: 'Me', email: 'me@example.test' } } as never, apps: [], auth: { server: { origin: 'https://ws.example.test' } } as never });
  vi.mocked(apiGet).mockReset().mockImplementation((async (path: string, params?: Record<string, unknown>) => respond(path, params)) as never);
  vi.mocked(apiGetMeta).mockReset().mockImplementation((async (path: string) => {
    if (path === '/api/mail/messages') return { data: { messages: [], total: 0, has_more: false, team: true }, offline: false, cachedAt: null };
    if (path === '/api/mail/messages/201') return { data: SHARED_DETAIL, offline: false, cachedAt: null };
    throw new ApiError(404, path, null);
  }) as never);
  vi.mocked(apiPost).mockReset().mockResolvedValue({} as never);
  vi.mocked(apiPut).mockReset().mockResolvedValue({} as never);
  vi.mocked(apiDelete).mockReset().mockResolvedValue({} as never);
  vi.mocked(call).mockReset().mockImplementation((async (channel: string, input?: unknown) => {
    if (channel === 'offline:pending') return [];
    if (channel === 'offline:mailStats') return { total: 300_000_000, messages: 200_000_000, lists: 60_000_000, search: 30_000_000, other: 10_000_000, byMailbox: { '1': { messages: 1284, bytes: 164_000_000 } }, limitBytes: 2 * 1024 ** 3 };
    if (channel === 'settings:set') return { preferences: { ...app.get().prefs, ...(input as object) }, locks: [] };
    return null;
  }) as never);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('Import my old mail (D08)', () => {
  const OPTIONS = { accounts: [{ id: 2, email: 'old@gmail.com', name: 'Old', oauth: true }], destinations: [{ id: 1, email: 'me@example.test', name: 'Me' }], presets: [{ key: 'gmail', label: 'Gmail', note: 'Use a Google app password.', needs_host: false }, { key: 'imap', label: 'IMAP', note: 'Your server.', needs_host: true }], accounts_allowed: true, zoho_regions: ['com', 'eu'] };

  it('checks the old account before anything is kept, then starts the import into a WorkSuite mailbox', async () => {
    routes['/api/mail/imports'] = { imports: [] };
    routes['/api/mail/imports/options'] = OPTIONS;
    vi.mocked(apiPost).mockImplementation((async (path: string) => (path === '/api/mail/imports/check' ? { total: 1234, folders: [{ name: 'INBOX', messages: 1200, skip_reason: null }, { name: 'Spam', messages: null, skip_reason: 'junk' }] } : {})) as never);
    wrap(<MailSettings query={new URLSearchParams('tab=import')} />);
    expect(await screen.findByRole('heading', { name: 'Import my old mail' })).toBeTruthy();
    // Zoho and cPanel are not allowed by this organization: offered but disabled.
    expect(((await screen.findByRole('radio', { name: /Zoho Mail/ })) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('radio', { name: /Google/ }));
    expect(screen.getByRole('button', { name: 'Start import' }).hasAttribute('disabled')).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Check the account' }));
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/api/mail/imports/check', { source: { connection_id: 2 } }));
    expect(await screen.findByText('Signed in · 1,234 messages in 2 folders')).toBeTruthy();
    expect(screen.getByText('Skipped · junk')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Start import' }));
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/api/mail/imports', expect.objectContaining({ source: { connection_id: 2 }, destination_connection_id: 1, since: '', own_folder: true, skip_labels: false, keep_syncing: false })));
  });

  it('follows a running import: progress, the numbers, each folder, and Pause', async () => {
    const running = { id: 4, kind: 'self', name: 'Import from old@gmail.com', source_type: 'gmail', stage: 'copying', started_at: '2026-10-02 10:05:00', finished_at: null, found: 29_998, copied: 18_406, skipped: 312, failed: 0, bytes: 6_000_000_000, percent: 62, mailboxes: [{ id: 1, source: 'old@gmail.com', destination: 'me@example.test', state: 'copying', error: null, found: 29_998, copied: 18_406, skipped: 312, failed: 0 }] };
    routes['/api/mail/imports'] = { imports: [running] };
    routes['/api/mail/imports/4'] = { ...running, folders: [{ mailbox_id: 1, source: 'INBOX', destination: 'Imported/Inbox', skip_reason: null, found: 100, copied: 100, skipped: 0, failed: 0, done: true }, { mailbox_id: 1, source: 'Clients/CreativeFX', destination: 'Clients/CreativeFX', skip_reason: null, found: 100, copied: 71, skipped: 0, failed: 0, done: false }], not_copied: [], events: [] };
    wrap(<MailSettings query={new URLSearchParams('tab=import&id=4')} />);
    expect(await screen.findByText('old@gmail.com → me@example.test')).toBeTruthy();
    expect(screen.getByText('Importing · 62%')).toBeTruthy();
    expect(screen.getByText('18,406')).toBeTruthy();
    expect(screen.getByText('11,280')).toBeTruthy();
    expect(await screen.findByText('Imported › Inbox')).toBeTruthy();
    expect(screen.getByText('71%')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Pause' }));
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/api/mail/imports/4/pause'));
  });

  it('decides the screen’s small things from the server’s answers', () => {
    expect(sinceFor('all', '2026-10-02')).toBe('');
    expect(sinceFor('3y', '2026-10-02')).toBe('2023-10-02');
    expect(importActions('copying')).toEqual(['pause', 'cancel']);
    expect(importActions('needs_attention')).toEqual(['resume', 'cancel']);
    expect(importActions('done')).toEqual([]);
    expect(stageWords('paused', 40).label).toBe('Paused · 40%');
    expect(folderProgress({ mailbox_id: 1, source: 'x', destination: null, skip_reason: 'junk', found: 0, copied: 0, skipped: 0, failed: 0, done: false }).label).toBe('—');
    expect(folderProgress({ mailbox_id: 1, source: 'x', destination: 'x', skip_reason: null, found: 10, copied: 0, skipped: 0, failed: 0, done: false }).label).toBe('Waiting');
    // 18,718 done in 25 min; 11,280 left at that pace is about 15 min.
    expect(timeLeft({ found: 29_998, copied: 18_406, skipped: 312, failed: 0, started_at: '2026-10-02 10:05:00', stage: 'copying' }, NOW.getTime())).toBe('~15 min');
    expect(timeLeft({ found: 10, copied: 1, skipped: 0, failed: 0, started_at: '2026-10-02 10:05:00', stage: 'copying' }, NOW.getTime())).toBeNull();
    expect(accountsFor('microsoft', [{ id: 1, email: 'a@contoso.test', name: 'a', oauth: true }, { id: 2, email: 'b@gmail.com', name: 'b', oauth: true }, { id: 3, email: 'c@x.test', name: 'c', oauth: false }]).map((a) => a.id)).toEqual([1]);
  });

  it('sends an import’s notification link to the import screen', async () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <Page initial="/mail/imports?id=4" />
      </QueryClientProvider>,
    );
    await waitFor(() => expect(nav.navigate).toHaveBeenCalledWith('/settings/mail?tab=import&id=4'));
  });
});

describe('a shared mailbox worked as a team (D06)', () => {
  it('shows the team’s notes, adds one, snoozes the conversation and says who else is viewing', async () => {
    vi.mocked(apiPost).mockImplementation((async (path: string) => (path === '/api/mail/messages/team/viewing' ? { viewers: [{ id: 4, name: 'Kasun' }] } : {})) as never);
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <Page initial="/mail?box=3&msg=201&mbx=3" />
      </QueryClientProvider>,
    );
    expect(await screen.findByText('Send the PDF with the discount.')).toBeTruthy();
    expect(screen.getByText('Internal notes · only the team sees these')).toBeTruthy();
    expect(await screen.findByText('Kasun is viewing this conversation')).toBeTruthy();
    expect(apiPost).toHaveBeenCalledWith('/api/mail/messages/team/viewing', { mailbox: '3', conversation_key: 'q@x', open: true });

    fireEvent.click(screen.getByRole('radio', { name: 'Internal note' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Internal note for the team' }), { target: { value: 'I will take it.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add note' }));
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/api/mail/messages/team/notes', expect.objectContaining({ mailbox: '3', conversation_key: 'q@x', body: 'I will take it.' })));

    fireEvent.click(screen.getByRole('button', { name: 'Snooze' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: /Tomorrow morning/ }));
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/api/mail/messages/team/snooze', expect.objectContaining({ mailbox: '3', conversation_key: 'q@x', until: '2026-10-03T08:00:00.000Z' })));
  });

  it('keeps snoozed conversations out of the queue until they wake', () => {
    const row = (team: Partial<NonNullable<MessageRow['team']>>) => ({ id: 1, team: { assignee_id: null, assignee_name: null, status: 'open', ...team } }) as MessageRow;
    const later = '2026-10-02 18:00:00';
    expect(teamRowShown(row({ snoozed_until: later }), 'open', 'all', 9, NOW.getTime())).toBe(false);
    expect(teamRowShown(row({ snoozed_until: later }), 'open', 'snoozed', 9, NOW.getTime())).toBe(true);
    expect(teamRowShown(row({ snoozed_until: '2026-10-02 08:00:00' }), 'open', 'all', 9, NOW.getTime())).toBe(true);
    expect(teamRowShown(row({ assignee_id: 9 }), 'open', 'mine', 9)).toBe(true);
    expect(teamRowShown(row({ assignee_id: 9 }), 'open', 'nobody', 9)).toBe(false);
    expect(teamRowShown(row({ status: 'answered' }), 'open', 'all', 9)).toBe(false);
  });

  it('words the viewers and the snooze times', () => {
    expect(viewersWords([])).toBeNull();
    expect(viewersWords(['Kasun', 'Samali'])).toBe('Kasun and Samali are viewing this conversation');
    expect(viewersWords(['Kasun', 'Samali', 'Nadee'])).toBe('Kasun and 2 others are viewing this conversation');
    const c = snoozeChoices(NOW, '2026-10-02');
    expect(c.map((x) => x.id)).toEqual(['later', 'tomorrow', 'monday']);
    expect(c[2]!.at).toBe('2026-10-05T08:00:00.000Z');
  });
});

describe('the message’s menus (D13, D14)', () => {
  it('copies a link to the message, saves it and its attachment to Files', async () => {
    const writeText = vi.fn(async () => undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    app.set({ apps: [{ id: 'files' }, { id: 'meet' }] as never });
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <Page initial="/mail?box=3&msg=201&mbx=3" />
      </QueryClientProvider>,
    );
    fireEvent.click(await screen.findByRole('button', { name: 'More' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Copy link to email' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('https://ws.example.test/mail?msg=201&folder=inbox&mailbox=3'));
    fireEvent.click(screen.getByRole('button', { name: 'More' }));
    const save = await screen.findByRole('menuitem', { name: 'Save to Files' });
    fireEvent.click(save);
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/api/mail/messages/201/save', { folder: 'inbox', subject: 'Support packages', mailbox: '3' }, { folder: 'inbox' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save Brief.pdf to Files' }));
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/api/mail/messages/201/attachments/2/save', { mailbox: '3' }, { folder: 'inbox', mime: 'application/pdf', mailbox: '3' }));
  });
});

describe('search (D07)', () => {
  const r = (id: number, subject: string, extra: Partial<MessageRow> = {}) => ({ id, subject, from_name: 'Nimal', from_email: 'nimal@sfcl.lk', preview: '', is_read: true, is_starred: false, has_attachment: false, created_at: `2026-09-${String(10 + id).padStart(2, '0')} 10:00:00`, ...extra }) as MessageRow;

  it('ranks Best match by the subject first, newest among equals', () => {
    const rows = [r(1, 'Pre-bid minutes', { preview: 'the BOQ template' }), r(2, 'BOQ rev 3'), r(3, 'Hosting BOQ draft')];
    expect(sortResults(rows, 'best', 'BOQ').map((x) => x.id)).toEqual([3, 2, 1]);
    expect(sortResults(rows, 'oldest', 'BOQ').map((x) => x.id)).toEqual([1, 2, 3]);
    expect(relevance(r(4, 'x', { attachments: [{ ref: '1', name: 'BOQ.xlsx', mime: '', size: 1 }] }), 'boq')).toBe(1);
  });

  it('reads folder and label operators, and a chip replaces its own', () => {
    const p = parseQuery('BOQ in:sent label:"Finance" from:sfcl.lk');
    expect(p).toMatchObject({ words: 'BOQ', folder: 'sent', label: 'finance', from: 'sfcl.lk' });
    expect(withoutOperator('BOQ after:2026-01-01 from:x', ['before', 'after'])).toBe('BOQ from:x');
    expect(timeRange('week', '2026-10-02')).toBe('after:2026-09-25');
    expect(timeRange('older', '2026-10-02')).toBe('before:2025-10-02');
  });
});

describe('settings › mail on this computer (D04, D09, D10)', () => {
  it('shows each account’s offline count, mailto: links and the app-password note', async () => {
    wrap(<MailSettings />);
    expect(await screen.findByText('Pushed instantly · 1,284 offline')).toBeTruthy();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Open mailto: links in WorkSuite' }));
    await waitFor(() => expect(call).toHaveBeenCalledWith('settings:set', { mailtoHandler: true }));
    fireEvent.click(screen.getByRole('button', { name: 'Mail app passwords' }));
    expect(await screen.findByRole('dialog', { name: 'Mail app passwords' })).toBeTruthy();
  });

  it('breaks down what this computer keeps, against the limit, and keeps a mailbox for its own period', async () => {
    wrap(<MailSettings query={new URLSearchParams('tab=storage')} />);
    expect(await screen.findByText(/of 2.0 GB limit/)).toBeTruthy();
    expect(screen.getByText('Set by your admin')).toBeTruthy();
    expect(screen.getByText('98.6%')).toBeTruthy();
    expect(screen.getByText(/Recent mail · last 12 months/)).toBeTruthy();
    fireEvent.click(screen.getByRole('combobox', { name: 'Keep me@example.test on this computer' }));
    fireEvent.click(await screen.findByRole('option', { name: '7 days' }));
    await waitFor(() => expect(call).toHaveBeenCalledWith('settings:set', { mailCacheDaysByMailbox: { '1': 7 } }));
  });

  it('keeps the reading options with the account', async () => {
    wrap(<MailSettings query={new URLSearchParams('tab=layout')} />);
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Dark mode for email content too' }));
    await waitFor(() => expect(apiPut).toHaveBeenCalledWith('/api/mail/prefs', { darkBody: true }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Show message previews in the list' }));
    await waitFor(() => expect(apiPut).toHaveBeenCalledWith('/api/mail/prefs', { previews: false }));
  });

  it('words storage and tabs', () => {
    expect(mailSettingsTab('import')).toBe('import');
    expect(mailSettingsTab('nonsense')).toBe('accounts');
    expect(offlineWords('Pushed instantly', 0)).toBe('Pushed instantly');
    expect(copyWords('headers', 12)).toMatch(/Headers only/);
    const parts = storeParts({ total: 400, messages: 200, lists: 100, search: 50, other: 50, byMailbox: {}, limitBytes: 1000 });
    expect(parts.map((p) => p.percent)).toEqual([20, 10, 5, 5]);
  });
});

describe('dark mode for email content (D10)', () => {
  it('keeps a designed email on a light card and plain words dark, sanitized either way', () => {
    expect(isDesignedMail('<table bgcolor="#003366"><tr><td>Sale</td></tr></table>')).toBe(true);
    expect(isDesignedMail('<p style="color:#333">Hello</p>')).toBe(true);
    expect(isDesignedMail('<p>Hello</p><blockquote>earlier</blockquote>')).toBe(false);
    expect(mailFrameDoc('<p>x</p>', 100, true)).toContain('background:#171E33');
    expect(mailFrameDoc('<p>x</p>', 100, false)).toContain('background:#fff');
  });
});

describe('rules and mailto: (MAIL-RUL, UI-DSK-04)', () => {
  it('tells sender rules from filters, and words a filter', () => {
    const f = { name: 'Blocked: spam@x.test', field: 'from' as const, op: 'contains' as const, value: 'spam@x.test', action: 'fileinto' as const, action_arg: 'Junk', stop: true, enabled: true };
    expect(senderRule(f)).toEqual({ kind: 'blocked', email: 'spam@x.test' });
    expect(senderRule({ ...f, name: 'Clients' })).toBeNull();
    expect(filterWords({ ...f, name: null, value: 'sfcl.lk', action_arg: 'Clients' })).toBe('From contains “sfcl.lk” → move to Clients');
  });

  it('prefills a new message from a mailto: route, keeping only real addresses', () => {
    expect(composeSeedFromQuery(new URLSearchParams('compose=1&to=a@b.lk, nope&cc=c@d.lk&subject=Hi%0Athere&body=Hello'))).toEqual({ mode: 'new', to: 'a@b.lk', cc: 'c@d.lk', subject: 'Hi there', quote: 'Hello' });
    expect(composeSeedFromQuery(new URLSearchParams('compose=1'))).toEqual({ mode: 'new' });
  });
});
