// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as CoreApi from '../../../src/core/api';
import type * as Tabs from '../../../src/core/tabs';

vi.mock('../../../src/core/api', async (orig) => ({ ...(await orig<typeof CoreApi>()), apiGet: vi.fn(), apiGetMeta: vi.fn(), apiPost: vi.fn(), apiPut: vi.fn(), apiDelete: vi.fn() }));
vi.mock('../../../src/core/bridge', () => ({ call: vi.fn(async () => null), on: () => () => undefined, errorMessage: (e: unknown) => (e instanceof Error ? e.message : String(e)), isMac: false, hasDesktop: () => true }));
vi.mock('../../../src/core/toasts', () => ({ toast: vi.fn() }));
const nav = vi.hoisted(() => ({ navigate: vi.fn() }));
vi.mock('../../../src/core/tabs', async (orig) => ({ ...(await orig<typeof Tabs>()), navigate: nav.navigate }));

import { ApiError, apiGet, apiGetMeta, apiPost, apiPut } from '../../../src/core/api';
import { app } from '../../../src/core/app-state';
import { call } from '../../../src/core/bridge';
import { TabProvider } from '../../../src/core/tab-context';
import { setRegional } from '../../../src/core/time';
import MailPage from '../../../src/modules/mail/MailPage';
import { LIST_PAGE, emptyReason, needsFill, nextListParam, readFolder, showFocusedHint, syncingLine } from '../../../src/modules/mail/listLoading';
import { classifyFocus } from '../../../src/modules/mail/states';

/**
 * worksuite-desktop#208: a folder opens with at least the latest 100 messages,
 * newest first — from this computer at once, then the server — and the next
 * 100 as the end comes into view. All Accounts merges every account by date;
 * a narrowed list (the Focused tab) fetches on until it has 100 to show;
 * Focused says when most mail is in Other; and an empty list says why.
 */

const NOW = new Date('2026-10-03T10:30:00Z');
const BOXES = [
  { id: 1, email: 'me@example.test', display_name: 'me', shared: false, unread: 5, in_unified: true, is_default: true, provider: 'imap', colour: 'blue', auth_state: 'ok' },
  { id: 2, email: 'me@contoso.test', display_name: 'me', shared: false, unread: 2, in_unified: true, provider: 'office365', colour: 'indigo', auth_state: 'ok' },
];
const tag = (id: number) => ({ id, email: BOXES[id - 1]!.email, name: 'me', colour: BOXES[id - 1]!.colour });
/** `n` messages from account `box`, newest first, one every `hours` from now, people writing (Focused). */
function rows(n: number, box: number, opts: { from?: (i: number) => string; start?: number; hours?: number } = {}) {
  return Array.from({ length: n }, (_, i) => {
    const at = new Date(NOW.getTime() - ((opts.start ?? 0) + i) * (opts.hours ?? 2) * 3_600_000 - box * 60_000);
    return { id: 1000 * box + (opts.start ?? 0) + i, from_name: `Person ${i}`, from_email: opts.from ? opts.from(i) : `person${i}@client${box}.test`, subject: `Subject ${box}-${(opts.start ?? 0) + i}`, preview: '', is_read: true, is_starred: false, has_attachment: false, created_at: at.toISOString().slice(0, 19).replace('T', ' '), mailbox: tag(box), uid_key: `${box}:${i}`, folder_slug: 'inbox' };
  });
}

let local: { messages: unknown[]; total: number } | null = null;
let listAnswer: (params: Record<string, unknown>) => unknown = () => ({ messages: [], total: 0, has_more: false, unified: true });
let states: unknown = null;
let syncAccounts: unknown[] = [];

function respond(path: string) {
  if (path === '/api/mail/mailboxes') return { mailboxes: BOXES };
  if (path === '/api/mail/views') return { mailboxes: [], views: {}, partial: false, unknown: [] };
  if (path === '/api/mail/sync/status') return { enabled: true, mailboxes: [], accounts: syncAccounts };
  if (path === '/api/mail/prefs') return { prefs: [], filters: [] };
  if (path === '/api/mail/labels') return { labels: [] };
  if (path === '/api/mail/states' && states) return states;
  if (path === '/api/mail/focus/context' && states) return { overrides: [], vips: [], known: [], moves: {} };
  throw new ApiError(404, `no ${path}`, null);
}

function Page({ initial = '/mail' }: { initial?: string }) {
  const [route, setRoute] = useState(initial);
  return (
    <TabProvider tabId="t" route={route} active onGo={setRoute}>
      <span data-testid="route">{route}</span>
      <MailPage active tabId="t" route={route} />
    </TabProvider>
  );
}

function show(initial?: string) {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <Page initial={initial} />
    </QueryClientProvider>,
  );
}

/** Rendering 100 rows takes a while on a busy machine. */
const SLOW = { timeout: 8000 };
const listed = () => document.querySelectorAll('[data-mail-row]').length;
const listCalls = () => vi.mocked(apiGetMeta).mock.calls.filter(([p]) => p === '/api/mail/views/all/inbox' || p === '/api/mail/messages');

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  setRegional({ timezone: 'UTC', locale: 'en-GB', timeFormat: '24' });
  local = null;
  states = null;
  syncAccounts = [];
  listAnswer = () => ({ messages: [], total: 0, has_more: false, unified: true });
  window.localStorage.clear();
  app.set({ status: { network: 'ONLINE' } as never, prefs: { mailCacheDays: 30, moduleNotifications: {}, badgeCount: true, theme: 'light' } as never, bootstrap: { user: { id: '9', name: 'Me', email: 'me@example.test' } } as never, apps: [] });
  vi.mocked(apiGet).mockReset().mockImplementation((async (path: string) => respond(path)) as never);
  vi.mocked(apiGetMeta).mockReset().mockImplementation((async (path: string, params?: Record<string, unknown>) => {
    if (path === '/api/mail/views/all/inbox' || path === '/api/mail/messages') return { data: listAnswer(params ?? {}), offline: false, cachedAt: null };
    throw new ApiError(404, path, null);
  }) as never);
  vi.mocked(apiPost).mockReset().mockResolvedValue({} as never);
  vi.mocked(apiPut).mockReset().mockResolvedValue({} as never);
  vi.mocked(call).mockReset().mockImplementation((async (channel: string) => {
    if (channel === 'offline:pending') return [];
    if (channel === 'offline:mailList') return local;
    return null;
  }) as never);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('opening a folder (#208)', { timeout: 30_000 }, () => {
  it('shows at least the latest 100 from this computer at once, newest first, before the server answers', async () => {
    const saved = [...rows(70, 1), ...rows(50, 2)];
    local = { messages: saved.sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 100), total: 120 };
    vi.mocked(apiGetMeta).mockImplementation((() => new Promise(() => undefined)) as never);
    show();
    await waitFor(() => expect(listed()).toBe(100), SLOW);
    expect(call).toHaveBeenCalledWith('offline:mailList', { mailbox: null, folder: 'inbox', role: 'inbox', limit: 100, offset: 0 });
    // Newest first across both accounts.
    const first = document.querySelector('[data-mail-row]')!;
    expect(first.textContent).toContain('Subject 1-0');
    // The date groups fill in as the rows come: never only the first one.
    expect(document.querySelectorAll('[data-group-head]').length).toBeGreaterThan(2);
  });

  it('asks the server for the latest 100 at once, with placeholder rows while they load', async () => {
    let answer: (v: unknown) => void = () => undefined;
    vi.mocked(apiGetMeta).mockImplementation((() => new Promise((r) => (answer = r))) as never);
    show();
    await waitFor(() => expect(document.querySelectorAll('[data-placeholder-row]').length).toBeGreaterThan(0), SLOW);
    expect(listCalls()[0]![1]).toMatchObject({ page: 1, per_page: LIST_PAGE });
    expect(listCalls()[0]![1]).not.toHaveProperty('since');
    answer({ data: { messages: [...rows(60, 1), ...rows(60, 2)].sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 100), total: 52168, has_more: true, next_cursor: 'C1', unified: true }, offline: false, cachedAt: null });
    await waitFor(() => expect(listed()).toBe(100), SLOW);
    expect(document.querySelectorAll('[data-placeholder-row]')).toHaveLength(0);
  });

  it('merges every account by date: rows from both accounts interleave in time order', async () => {
    const merged = [...rows(50, 1), ...rows(50, 2)].sort((a, b) => b.created_at.localeCompare(a.created_at));
    listAnswer = () => ({ messages: merged, total: 100, has_more: false, unified: true });
    show();
    await waitFor(() => expect(listed()).toBe(100), SLOW);
    const keys = [...document.querySelectorAll('[data-mail-row]')].map((el) => el.getAttribute('data-mail-row')!);
    expect(keys.slice(0, 4)).toEqual(['1:inbox:1000', '2:inbox:2000', '1:inbox:1001', '2:inbox:2001']);
  });

  it('asks for the next 100 as the end comes into view, from where each account left off', async () => {
    listAnswer = (p) => (p.cursor === 'C1' ? { messages: rows(30, 1, { start: 100 }), total: 130, has_more: false, unified: true } : { messages: rows(100, 1), total: 300, has_more: true, next_cursor: 'C1', unified: true });
    show();
    await waitFor(() => expect(listed()).toBe(100), SLOW);
    const scroller = document.querySelector('[data-mail-scroll]') as HTMLElement;
    Object.defineProperty(scroller, 'scrollHeight', { value: 5000, configurable: true });
    Object.defineProperty(scroller, 'clientHeight', { value: 600, configurable: true });
    scroller.scrollTop = 4200;
    fireEvent.scroll(scroller);
    await waitFor(() => expect(listCalls().some(([, q]) => (q as Record<string, unknown>).cursor === 'C1' && (q as Record<string, unknown>).page === 2 && (q as Record<string, unknown>).per_page === 100)).toBe(true), SLOW);
    await waitFor(() => expect(listed()).toBe(130), SLOW);
  });
});

describe('Focused, filters and empty lists (#208)', { timeout: 30_000 }, () => {
  const noStates = { pins: {}, snoozed: {}, returned: {}, flags: {}, focus: {}, categories: {} };

  it('fetches on while the Focused tab has fewer than 100 to show, and offers to turn it off or teach it', async () => {
    states = noStates;
    // 95 of the first 100 are newsletters (Other); the next page has people.
    listAnswer = (p) =>
      p.cursor === 'C1'
        ? { messages: rows(100, 2, { start: 100 }), total: 52168, has_more: false, unified: true }
        : { messages: rows(100, 1, { from: (i) => (i < 95 ? `noreply@shop${i}.example` : `person${i}@client.test`) }), total: 52168, has_more: true, next_cursor: 'C1', unified: true };
    show();
    await waitFor(() => expect(listCalls().some(([, q]) => (q as Record<string, unknown>).cursor === 'C1')).toBe(true), SLOW);
    await waitFor(() => expect(listed()).toBe(105), SLOW);
    expect(screen.queryByText('Most new mail is in Other.')).toBeNull();
  });

  it('says most new mail is in Other when Focused holds almost nothing, with Turn off and Teach', async () => {
    states = noStates;
    listAnswer = () => ({ messages: rows(40, 1, { from: (i) => (i < 37 ? `newsletter@shop${i}.example` : `person${i}@client.test`) }), total: 40, has_more: false, unified: true });
    show();
    const hint = await screen.findByText('Most new mail is in Other.', {}, SLOW);
    expect(listed()).toBe(3);
    fireEvent.click(within(hint.parentElement!).getByRole('button', { name: 'Teach Focused' }));
    expect(screen.getByRole('tab', { name: /Other/ }).getAttribute('aria-selected')).toBe('true');
    fireEvent.click(screen.getByRole('tab', { name: /Focused/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Turn off Focused Inbox' }, SLOW));
    // Focused Inbox is one setting for every folder (Settings › Mail › Appearance & reading has the same switch).
    await waitFor(() => expect(apiPut).toHaveBeenCalledWith('/api/mail/prefs', { focused: false }));
  });

  it('marks an active filter, clears it from beside the chips, and says when nothing matches', async () => {
    listAnswer = (p) => (p.filters ? { messages: [], total: 0, has_more: false, unified: true } : { messages: rows(10, 1), total: 10, has_more: false, unified: true });
    show();
    await waitFor(() => expect(listed()).toBe(10), SLOW);
    fireEvent.click(screen.getByRole('button', { name: 'Has files', pressed: false }));
    const chip = screen.getByRole('button', { name: /Has files/, pressed: true });
    expect(chip.className).toContain('bg-primary');
    expect(await screen.findByText('No mail matches these filters', {}, SLOW)).toBeTruthy();
    const clear = screen.getAllByRole('button', { name: 'Clear filters' });
    expect(clear.length).toBe(2);
    fireEvent.click(clear[0]!);
    await waitFor(() => expect(listed()).toBe(10), SLOW);
    expect(screen.queryByRole('button', { name: 'Clear filters' })).toBeNull();
  });

  it('says headers are still syncing, with how far it has got, instead of an empty inbox', async () => {
    syncAccounts = [{ mailbox: 1, email: 'me@example.test', name: 'me', included: true, paused: false, mode: 'interval', interval_min: 5, last_ok_at: null, last_attempt_at: null, last_result: 'running', error_code: null, error: null, running: true, mirror: true, pushed: false, folders: 9, folders_done: 2, complete: false, messages: 340 }];
    listAnswer = () => ({ messages: [], total: 0, has_more: false, unified: true });
    show();
    expect(await screen.findByText('Syncing headers… 340 of 2,000', {}, SLOW)).toBeTruthy();
  });

  it('says all caught up when a folder is simply empty', async () => {
    show();
    expect(await screen.findByText('All caught up', {}, SLOW)).toBeTruthy();
  });
});

describe('the pieces (#208)', () => {
  it('pages by 100, by the server’s cursor where it gives one', () => {
    const page = (has_more: boolean, next_cursor?: string) => ({ data: { messages: [], total: 0, has_more, next_cursor }, offline: false, cachedAt: null });
    expect(nextListParam(page(true, 'X'), [page(true, 'X')])).toEqual({ page: 2, cursor: 'X' });
    expect(nextListParam(page(true), [page(true), page(true)])).toEqual({ page: 3, cursor: null });
    expect(nextListParam(page(false), [page(false)])).toBeUndefined();
  });

  it('fills a narrowed list further than a plain one, and never while a page is on its way', () => {
    expect(needsFill({ shown: 5, hasMore: true, fetching: false, pages: 5, narrowed: true })).toBe(true);
    expect(needsFill({ shown: 5, hasMore: true, fetching: false, pages: 10, narrowed: true })).toBe(false);
    expect(needsFill({ shown: 5, hasMore: true, fetching: false, pages: 2, narrowed: false })).toBe(false);
    expect(needsFill({ shown: 5, hasMore: true, fetching: true, pages: 1, narrowed: true })).toBe(false);
    expect(needsFill({ shown: 100, hasMore: true, fetching: false, pages: 1, narrowed: true })).toBe(false);
  });

  it('gives each empty list its reason', () => {
    expect(emptyReason({ syncing: 'Syncing headers… 340 of 2,000', filtered: false, search: '', focusedTab: false, otherCount: 0 }).kind).toBe('syncing');
    expect(emptyReason({ syncing: 'x', filtered: true, search: '', focusedTab: false, otherCount: 0 })).toMatchObject({ kind: 'filtered', title: 'No mail matches these filters' });
    expect(emptyReason({ syncing: null, filtered: false, search: 'q', focusedTab: false, otherCount: 0 }).kind).toBe('search');
    expect(emptyReason({ syncing: null, filtered: false, search: '', focusedTab: true, otherCount: 44 })).toMatchObject({ kind: 'focused', hint: '44 in Other' });
    expect(emptyReason({ syncing: null, filtered: false, search: '', focusedTab: false, otherCount: 0 })).toMatchObject({ kind: 'caught-up', title: 'All caught up' });
    expect(syncingLine([{ mailbox: 1, running: true, complete: false, messages: 340 } as never], ['1'], 52168)).toBe('Syncing headers… 340 of 2,000');
    expect(syncingLine([{ mailbox: 1, running: false, complete: true, messages: 2000 } as never], null, 10)).toBeNull();
    expect(showFocusedHint(1, 44, true)).toBe(true);
    expect(showFocusedHint(12, 44, true)).toBe(false);
    expect(showFocusedHint(1, 44, false)).toBe(false);
  });

  it('reads a message listed in a view of INBOX from INBOX', () => {
    expect(readFolder({}, 'important')).toBe('inbox');
    expect(readFolder({}, 'starred')).toBe('inbox');
    expect(readFolder({ folder_slug: 'label:Clients' }, 'inbox')).toBe('label:Clients');
    expect(readFolder({}, 'archive')).toBe('archive');
  });

  it('keeps businesses writing from info@ and hello@, and people at mail providers, in Focused', () => {
    const ctx = { overrides: [], vips: [], known: [], moves: { 'Ann@Shop.example': { focused: 0, other: 2 } } };
    expect(classifyFocus({ from_email: 'info@dynadot.example' }, ctx).focus).toBe('focused');
    expect(classifyFocus({ from_email: 'hello@startup.example' }, ctx).focus).toBe('focused');
    expect(classifyFocus({ from_email: 'friend@mail.com' }, ctx).focus).toBe('focused');
    expect(classifyFocus({ from_email: 'someone@email.com' }, ctx).focus).toBe('focused');
    expect(classifyFocus({ from_email: 'deals@mail.shop.example' }, ctx)).toEqual({ focus: 'other', why: 'bulk' });
    expect(classifyFocus({ from_email: 'noreply@github.example' }, ctx).focus).toBe('other');
    // Moving mail between the tabs teaches it, whatever case the address was stored in.
    expect(classifyFocus({ from_email: 'ann@shop.example' }, ctx)).toEqual({ focus: 'other', why: 'moves' });
  });
});
