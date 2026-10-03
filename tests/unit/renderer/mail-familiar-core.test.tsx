// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as CoreApi from '../../../src/core/api';

vi.mock('../../../src/core/api', async (orig) => ({ ...(await orig<typeof CoreApi>()), apiGet: vi.fn(), apiGetMeta: vi.fn(), apiPost: vi.fn(), apiPut: vi.fn(), apiDelete: vi.fn() }));
vi.mock('../../../src/core/bridge', () => ({ call: vi.fn(async () => null), on: () => () => undefined, errorMessage: (e: unknown) => (e instanceof Error ? e.message : String(e)), isMac: false, hasDesktop: () => true }));
vi.mock('../../../src/core/toasts', () => ({ toast: vi.fn() }));

import { ApiError, apiGet, apiGetMeta, apiPut } from '../../../src/core/api';
import { app } from '../../../src/core/app-state';
import { call } from '../../../src/core/bridge';
import { TabProvider } from '../../../src/core/tab-context';
import { setRegional } from '../../../src/core/time';
import MailPage from '../../../src/modules/mail/MailPage';
import { bindings, commandFor, keyConflicts, keyLabel, keyOf } from '../../../src/modules/mail/keymap';
import { folderViewPatch, withFolderView } from '../../../src/modules/mail/model';
import { highlightText } from '../../../src/modules/mail/sanitize';
import { classifyFocus, flagChoices, otherBanner, pinnedFirst, snoozeChoices, withStates, type MessageStates } from '../../../src/modules/mail/states';
import type { MessageRow } from '../../../src/modules/mail/types';
import { FirstRunOffers } from '../../../src/modules/mail/FirstRun';

/**
 * ENH-MAIL-03 P1 — familiar core: Focused Inbox (DMO-INB-01…03), pin and
 * snooze (DMO-INB-05/06), flags with dates (DMO-TSK-01), categories
 * (DMO-INB-07), per-folder view memory (DMO-INB-16), keyboard schemes and the
 * shortcut sheet (DMO-KEY-01/02, AC-DMO-11), favourites (DMO-NAV-01), go to
 * folder (DMO-NAV-05) and find in message (DMO-SRC-06).
 */

const NOW = new Date('2026-10-05T10:00:00Z'); // a Monday
const row = (id: number, over: Partial<MessageRow> = {}): MessageRow => ({ id, from_name: `Sender ${id}`, from_email: `s${id}@example.org`, subject: `Subject ${id}`, preview: '', is_read: true, is_starred: false, has_attachment: false, created_at: '2026-10-05 09:00:00', folder_slug: 'inbox', ...over });

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  setRegional({ timezone: 'UTC', locale: 'en-GB', timeFormat: '24' });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('states on the list', () => {
  const states: MessageStates = {
    pins: { '4:inbox:2': '2026-10-04 08:00:00' },
    snoozed: { '4:inbox:3': '2026-10-06 08:00:00' },
    returned: { '4:inbox:4': '2026-10-05 09:30:00' },
    flags: { '4:inbox:1': { mailbox: 4, folder: 'inbox', uid: '1', start_at: null, due_at: '2026-10-06 17:00:00', reminder_at: null, completed_at: null, task_id: 9, subject: '', from_name: '', from_email: '' } },
    focus: { '4:inbox:5': 'other' },
    categories: { 'mail:4:inbox:1': [7] },
  };
  const keyOf = (m: MessageRow) => `4:inbox:${m.id}`;

  it('hides snoozed mail, puts returned and pinned mail first, and adds flags and categories by name (AC-DMO-02/03)', () => {
    const rows = withStates([row(1), row(2), row(3), row(4, { is_read: false }), row(5)], states, keyOf, [{ id: 7, name: 'Finance', colour: 'emerald', shortcut: 2, org: false, label_id: null }]);
    expect(rows.map((r) => r.id)).toEqual([1, 2, 4, 5]);
    expect(pinnedFirst(rows).map((r) => r.id)).toEqual([4, 2, 1, 5]);
    const flagged = rows.find((r) => r.id === 1)!;
    expect(flagged.flag?.due_at).toBe('2026-10-06 17:00:00');
    expect(flagged.categories).toEqual([expect.objectContaining({ name: 'Finance' })]);
    expect(rows.find((r) => r.id === 5)!.focus).toBe('other');
  });

  it('sorts mail into Focused and Other: moved by hand, overrides, VIPs, known senders, past moves, bulk senders (WF-DO01, AC-DMO-01)', () => {
    const ctx = { overrides: [{ sender: '@deals.example', target: 'other' as const }, { sender: 'boss@deals.example', target: 'focused' as const }], vips: ['ceo@example.org'], known: ['colleague@example.org'], moves: { 'often@example.org': { focused: 0, other: 3 } } };
    expect(classifyFocus({ from_email: 'news@shop.example' }, ctx)).toEqual({ focus: 'other', why: 'bulk' });
    expect(classifyFocus({ from_email: 'noreply@github.example' }, ctx).focus).toBe('other');
    expect(classifyFocus({ from_email: 'promo@deals.example' }, ctx)).toEqual({ focus: 'other', why: 'override' });
    expect(classifyFocus({ from_email: 'boss@deals.example' }, ctx).focus).toBe('focused');
    expect(classifyFocus({ from_email: 'ceo@example.org' }, ctx).why).toBe('vip');
    expect(classifyFocus({ from_email: 'colleague@example.org' }, ctx).why).toBe('known');
    expect(classifyFocus({ from_email: 'often@example.org' }, ctx)).toEqual({ focus: 'other', why: 'moves' });
    expect(classifyFocus({ from_email: 'news@shop.example', focus: 'focused' }, ctx).focus).toBe('focused');
    // Unknown and unsure: Focused (fail open).
    expect(classifyFocus({ from_email: 'person@new.example' }, null)).toEqual({ focus: 'focused', why: 'default' });
    expect(otherBanner([row(1, { is_read: false, from_email: 'news@a.example', from_name: 'Daraz' }), row(2, { is_read: false, from_email: 'noreply@b.example', from_name: 'LinkedIn' }), row(3, { is_read: true, from_email: 'news@c.example' })], ctx)).toBe('2 new in Other: Daraz, LinkedIn');
  });

  it('offers snooze and flag times on the reader’s clock', () => {
    const snooze = snoozeChoices(NOW, '2026-10-05');
    expect(snooze.map((c) => c.id)).toEqual(['later', 'tomorrow', 'weekend', 'next-week']);
    expect(snooze[0]!.at).toBe('2026-10-05T13:00:00.000Z');
    expect(snooze[1]!.at).toBe('2026-10-06T08:00:00.000Z');
    expect(snooze[2]!.at).toBe('2026-10-10T08:00:00.000Z');
    expect(snooze[3]!.at).toBe('2026-10-12T08:00:00.000Z');
    const flags = flagChoices('2026-10-05');
    expect(flags.map((f) => f.id)).toEqual(['today', 'tomorrow', 'week', 'next-week', 'none']);
    expect(flags[1]!.dates.due_at).toBe('2026-10-06T17:00:00.000Z');
    expect(flags[2]!.dates.due_at).toBe('2026-10-09T17:00:00.000Z');
    expect(flags[4]!.dates).toEqual({ start_at: null, due_at: null, reminder_at: null });
  });
});

describe('keyboard schemes (DMO-KEY-01/02, AC-DMO-11)', () => {
  const ev = (key: string, mods: Partial<KeyboardEvent> = {}) => ({ key, code: /^\d$/.test(key) ? `Digit${key}` : `Key${key.toUpperCase()}`, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, ...mods }) as KeyboardEvent;

  it('maps the Outlook scheme the way Outlook users expect', () => {
    const map = bindings('outlook');
    const run = (e: KeyboardEvent) => commandFor(map, keyOf(e, false)!, null).id;
    expect(run(ev('r', { ctrlKey: true }))).toBe('reply');
    expect(run(ev('R', { ctrlKey: true, shiftKey: true }))).toBe('replyAll');
    expect(run(ev('q', { ctrlKey: true }))).toBe('read');
    expect(run(ev('Insert'))).toBe('flag');
    expect(run(ev('V', { ctrlKey: true, shiftKey: true }))).toBe('move');
    expect(run(ev('e', { ctrlKey: true }))).toBe('search');
    expect(run(ev('F9'))).toBe('syncAll');
    expect(run(ev('f', { ctrlKey: true }))).toBe('forward');
    expect(run(ev('F4'))).toBe('findInMessage');
    // ⌘ is Ctrl on macOS.
    expect(commandFor(map, keyOf(ev('r', { metaKey: true }), true)!, null).id).toBe('reply');
  });

  it('runs two-key sequences, symbols typed with Shift, and the person’s own keys', () => {
    const map = bindings('worksuite', { archive: 'Y' });
    const first = commandFor(map, 'G', null);
    expect(first).toEqual({ id: null, pending: 'G' });
    expect(commandFor(map, 'C', first.pending)).toEqual({ id: 'goCalendar', pending: null });
    expect(commandFor(map, keyOf(ev('#', { shiftKey: true }), false)!, null).id).toBe('delete');
    expect(commandFor(map, keyOf(ev('?', { shiftKey: true }), false)!, null).id).toBe('shortcuts');
    expect(commandFor(map, 'Y', null).id).toBe('archive');
    expect(commandFor(map, 'E', null).id).toBeNull();
  });

  it('flags keys used twice or taken by the app', () => {
    const clashes = keyConflicts(bindings('worksuite', { pin: 'E' }));
    expect(clashes.find((c) => c.key === 'E')?.commands.sort()).toEqual(['archive', 'pin']);
    // Outlook's Ctrl+N is also the app's New.
    expect(keyConflicts(bindings('outlook')).find((c) => c.key === 'Mod+N')?.shell).toBe('new');
    expect(keyLabel('Mod+Shift+R', true)).toBe('⌘⇧R');
    expect(keyLabel('Mod+Shift+R', false)).toBe('Ctrl+Shift+R');
  });
});

describe('view memory and find in message', () => {
  it('remembers view settings per folder, or for all folders (DMO-INB-16)', () => {
    const prefs = { view: 'compact' as const, folderViews: { '4:inbox': { view: 'super' as const } } };
    expect(withFolderView(prefs, '4:inbox').view).toBe('super');
    expect(withFolderView(prefs, '4:sent').view).toBe('compact');
    expect(folderViewPatch(prefs, '4:sent', { pane: 'bottom', tabs: false })).toEqual({ tabs: false, folderViews: { '4:inbox': { view: 'super' }, '4:sent': { pane: 'bottom' } } });
    expect(folderViewPatch(prefs, '4:inbox', { applyToAll: true })).toEqual({ view: 'super', folderViews: {} });
  });

  it('highlights matches in text only, never in markup (DMO-SRC-06)', () => {
    const r = highlightText('<p title="invoice">The Invoice is <b>invoice</b>d</p>', 'invoice');
    expect(r.count).toBe(2);
    expect(r.html).toContain('title="invoice"');
    expect(r.html).toContain('<mark>Invoice</mark>');
    expect(highlightText('<p>x</p>', 'x').count).toBe(0);
  });
});

// ---- the screen -----------------------------------------------------------------------------------

const BOX = { id: 4, email: 'me@example.test', display_name: 'me', shared: false, unread: 2, in_unified: true, is_default: true, provider: 'office365', provider_label: 'Microsoft 365', colour: 'blue', auth_state: 'ok' };
const ROWS = [
  row(11, { from_name: 'Colleague', from_email: 'colleague@example.org', subject: 'Budget review', is_read: false }),
  row(12, { from_name: 'Daraz', from_email: 'news@daraz.example', subject: 'Weekly deals', is_read: false }),
  row(13, { from_name: 'Pinned person', from_email: 'pin@example.org', subject: 'Pinned one', created_at: '2026-09-01 09:00:00' }),
];
let prefs: Record<string, unknown> = {};

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

describe('the Mail screen (P1)', () => {
  beforeEach(() => {
    prefs = { firstRun: 'done' };
    window.localStorage.clear();
    app.set({ status: { network: 'ONLINE' } as never, prefs: { mailCacheDays: 30, moduleNotifications: {}, badgeCount: true, theme: 'light' } as never, bootstrap: { user: { id: '9', name: 'Me', email: 'me@example.test' } } as never, apps: [] });
    vi.mocked(apiGet).mockReset().mockImplementation((async (path: string) => {
      if (path === '/api/mail/mailboxes') return { mailboxes: [BOX] };
      if (path === '/api/mail/prefs') return { prefs };
      if (path === '/api/mail/states') return { pins: { '4:inbox:13': '2026-10-01 08:00:00' }, snoozed: {}, returned: {}, flags: {}, focus: {}, categories: { 'mail:4:inbox:11': [3] } };
      if (path === '/api/categories') return { categories: [{ id: 3, name: 'Finance', colour: 'emerald', shortcut: 1, org: false, label_id: null }] };
      if (path === '/api/mail/focus/context') return { overrides: [], vips: [], known: ['colleague@example.org'], moves: {} };
      if (path === '/api/mail/folders') return { folders: [{ id: 1, name: 'Inbox', slug: 'inbox', type: 'system', total: 3, unread: 2 }, { id: 2, name: 'Clients', slug: 'label:Clients', type: 'custom', total: 1, unread: 0 }] };
      if (path === '/api/mail/sync/status') return { enabled: true, mailboxes: [], accounts: [] };
      throw new ApiError(404, path, null);
    }) as never);
    vi.mocked(apiGetMeta).mockReset().mockImplementation((async (path: string) => {
      if (path === '/api/mail/messages') return { data: { messages: ROWS, total: 3, has_more: false }, offline: false, cachedAt: null };
      if (path === '/api/mail/messages/11') return { data: { ...ROWS[0], message_id: '<b@x>', to: ['me@example.test'], cc: [], body_html: '<p>The budget and the other budget</p>', attachments: [] }, offline: false, cachedAt: null };
      throw new ApiError(404, path, null);
    }) as never);
    vi.mocked(apiPut).mockReset().mockResolvedValue({} as never);
    vi.mocked(call).mockReset().mockImplementation((async (channel: string) => {
      if (channel === 'offline:pending') return [];
      if (channel === 'offline:submit') return { delivered: true, queued: false, id: null, status: 200, data: null, error: null, code: null };
      return null;
    }) as never);
  });

  it('splits the inbox into Focused and Other with a line about new Other mail, pins on top (AC-DMO-01, AC-DMO-03)', async () => {
    show();
    const tabs = await screen.findByRole('tablist', { name: 'Focused Inbox' });
    const list = screen.getByRole('listbox', { name: 'Messages' });
    await within(list).findByText('Colleague');
    expect(within(list).queryByText('Daraz')).toBeNull();
    expect(screen.getByText('1 new in Other: Daraz')).toBeTruthy();
    // Pinned first, with its own heading; a category shows its name.
    const options = within(list).getAllByRole('option');
    expect(options[0]!.textContent).toContain('Pinned one');
    expect(within(list).getByText('Pinned')).toBeTruthy();
    expect(within(list).getByTitle('Finance')).toBeTruthy();
    fireEvent.click(within(tabs).getByRole('tab', { name: /Other/ }));
    await within(list).findByText('Daraz');
    expect(within(list).queryByText('Colleague')).toBeNull();
  });

  it('pins, flags and moves to Other from the right-click menu through the offline queue', async () => {
    show();
    const list = await screen.findByRole('listbox', { name: 'Messages' });
    fireEvent.contextMenu(await within(list).findByText('Colleague'));
    const menu = await screen.findByRole('menu', { name: 'Message actions' });
    fireEvent.click(within(menu).getByRole('menuitem', { name: /Pin to top/ }));
    await waitFor(() => expect(call).toHaveBeenCalledWith('offline:submit', expect.objectContaining({ entity: 'state.pin', path: '/api/mail/states', body: expect.objectContaining({ action: 'pin', items: [expect.objectContaining({ mailbox: 4, folder: 'inbox', uid: '11', subject: 'Budget review' })] }), queueIfOffline: true })));

    fireEvent.contextMenu(within(list).getByText('Colleague'));
    const again = await screen.findByRole('menu', { name: 'Message actions' });
    fireEvent.click(within(again).getByRole('menuitem', { name: /Always move to Other/ }));
    await waitFor(() => expect(call).toHaveBeenCalledWith('offline:submit', expect.objectContaining({ entity: 'state.focus', body: expect.objectContaining({ target: 'other', always: true }) })));
  });

  it('selects several with Ctrl-click and acts on all of them (DMO-INB-15)', async () => {
    show();
    const list = await screen.findByRole('listbox', { name: 'Messages' });
    fireEvent.click(await within(list).findByText('Colleague'), { ctrlKey: true });
    fireEvent.click(within(list).getByText('Pinned person'), { ctrlKey: true });
    const pane = await screen.findByRole('region', { name: '2 selected' });
    fireEvent.click(within(pane).getByRole('button', { name: 'Mark read' }));
    await waitFor(() => expect(vi.mocked(call).mock.calls.filter(([c, i]) => c === 'offline:submit' && (i as { entity: string }).entity === 'message.read')).toHaveLength(2));
  });

  it('uses the Outlook scheme: Ctrl+R replies, ? does nothing special, Ctrl+/ shows the sheet (AC-DMO-11)', async () => {
    prefs = { firstRun: 'done', keyScheme: 'outlook' };
    show('/mail?msg=11&mbx=4');
    await screen.findByRole('heading', { name: 'Budget review' });
    fireEvent.keyDown(document.body, { key: 'r', code: 'KeyR', ctrlKey: true });
    expect(await screen.findByRole('form', { name: /Reply|Re: Budget review/ })).toBeTruthy();
  });

  it('opens the shortcut sheet with ?, switches scheme there and rebinds a key', async () => {
    show();
    await screen.findByRole('listbox', { name: 'Messages' });
    fireEvent.keyDown(document.body, { key: '?', code: 'Slash', shiftKey: true });
    const sheet = await screen.findByRole('dialog', { name: 'Keyboard shortcuts' });
    fireEvent.click(within(sheet).getByRole('radio', { name: 'Outlook' }));
    await waitFor(() => expect(apiPut).toHaveBeenCalledWith('/api/mail/prefs', { keyScheme: 'outlook' }));
  });

  it('finds words in the open message (DMO-SRC-06)', async () => {
    show('/mail?msg=11&mbx=4');
    await screen.findByRole('heading', { name: 'Budget review' });
    fireEvent.keyDown(document.body, { key: 'f', code: 'KeyF', ctrlKey: true });
    const find = await screen.findByRole('search', { name: 'Find in message' });
    fireEvent.change(within(find).getByRole('textbox'), { target: { value: 'budget' } });
    expect(within(find).getByText('2 found')).toBeTruthy();
    expect(screen.getByTitle('Message').getAttribute('srcdoc')).toContain('<mark>budget</mark>');
  });

  it('adds a folder to Favorites from its menu, and goes to a folder by typing (DMO-NAV-01, NAV-05)', async () => {
    show();
    const nav = await screen.findByRole('navigation', { name: 'Mail' });
    fireEvent.contextMenu(await within(nav).findByRole('button', { name: /^Clients/ }));
    const menu = await screen.findByRole('menu', { name: 'Folder actions' });
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Add to Favorites' }));
    await waitFor(() => expect(apiPut).toHaveBeenCalledWith('/api/mail/prefs', { favorites: ['4:label:Clients|Clients'] }));

    fireEvent.keyDown(document.body, { key: 'g', code: 'KeyG' });
    fireEvent.keyDown(document.body, { key: 'f', code: 'KeyF' });
    const dialog = await screen.findByRole('dialog', { name: 'Go to folder' });
    fireEvent.change(within(dialog).getByRole('combobox'), { target: { value: 'clie' } });
    fireEvent.keyDown(within(dialog).getByRole('combobox'), { key: 'Enter' });
    await waitFor(() => expect(screen.getByTestId('route').textContent).toBe('/mail?box=4&folder=label%3AClients'));
  });

  it('asks a first-time user whether they come from Outlook, and sets things up like Outlook (WF-DO12)', async () => {
    prefs = {};
    show();
    const welcome = await screen.findByRole('region', { name: 'Welcome to WorkSuite Mail' });
    fireEvent.click(within(welcome).getByRole('button', { name: 'Yes, set it up like Outlook' }));
    await waitFor(() => expect(apiPut).toHaveBeenCalledWith('/api/mail/prefs', expect.objectContaining({ firstRun: 'outlook', keyScheme: 'outlook', commandBar: 'classic', focused: true })));
    // Then the setup banner (#187): what was done, Import email first, the rest second, and a dismiss icon.
    const offers = await screen.findByRole('region', { name: 'Outlook shortcuts are on' });
    expect(within(offers).getByText('Finish setting up Mail')).toBeTruthy();
    const importBtn = within(offers).getByRole('button', { name: 'Import email' });
    expect(importBtn.getAttribute('title')).toMatch(/\.pst or \.mbox/);
    expect(within(offers).getByRole('button', { name: 'Add signature' })).toBeTruthy();
    expect(within(offers).getByRole('button', { name: 'Make default mail app' })).toBeTruthy();
    expect(within(offers).queryByRole('button', { name: 'Close' })).toBeNull();
    fireEvent.click(within(offers).getByRole('button', { name: 'Dismiss' }));
    // Dismissing is saved, so it does not come back after navigation or restart.
    await waitFor(() => expect(apiPut).toHaveBeenCalledWith('/api/mail/prefs', expect.objectContaining({ firstRun: 'done' })));
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Outlook shortcuts are on' })).toBeNull());
  });
});

describe('the setup banner on a narrow window (#187)', () => {
  it('moves Add signature and Make default mail app into More', async () => {
    const rect = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ width: 480, height: 80, top: 0, left: 0, right: 480, bottom: 80, x: 0, y: 0, toJSON: () => ({}) } as DOMRect);
    try {
      render(
        <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
          <FirstRunOffers onImport={() => undefined} onSignatures={() => undefined} onDone={() => undefined} />
        </QueryClientProvider>,
      );
      const offers = screen.getByRole('region', { name: 'Outlook shortcuts are on' });
      expect(within(offers).queryByRole('button', { name: 'Add signature' })).toBeNull();
      fireEvent.click(within(offers).getByRole('button', { name: 'More' }));
      const menu = await screen.findByRole('menu', { name: 'More setup actions' });
      expect(within(menu).getByRole('menuitem', { name: 'Add signature' })).toBeTruthy();
      expect(within(menu).getByRole('menuitem', { name: 'Make default mail app' })).toBeTruthy();
    } finally {
      rect.mockRestore();
    }
  });
});
