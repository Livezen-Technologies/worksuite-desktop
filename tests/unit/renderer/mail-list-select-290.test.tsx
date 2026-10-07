// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as CoreApi from '../../../src/core/api';

vi.mock('../../../src/core/api', async (orig) => ({ ...(await orig<typeof CoreApi>()), apiGet: vi.fn(), apiGetMeta: vi.fn(), apiPost: vi.fn(), apiPut: vi.fn(), apiDelete: vi.fn() }));
vi.mock('../../../src/core/bridge', () => ({ call: vi.fn(async () => null), on: () => () => undefined, errorMessage: (e: unknown) => (e instanceof Error ? e.message : String(e)), isMac: false, hasDesktop: () => true }));
vi.mock('../../../src/core/toasts', () => ({ toast: vi.fn() }));
vi.mock('../../../src/modules/calls/tones', () => ({ playTone: vi.fn(() => ({ stop: vi.fn(), setVolume: vi.fn() })), playOnce: vi.fn() }));

import { ApiError, apiGet, apiGetMeta, apiPost } from '../../../src/core/api';
import { app } from '../../../src/core/app-state';
import { call } from '../../../src/core/bridge';
import { TabProvider } from '../../../src/core/tab-context';
import { setRegional } from '../../../src/core/time';
import { RowLead } from '../../../src/components/RowLead';
import { CheckboxMark } from '../../../src/components/Checkbox';
import { pickOf, useListSelection } from '../../../src/components/useListSelection';
import MailPage from '../../../src/modules/mail/MailPage';
import type { MessageRow } from '../../../src/modules/mail/types';
import type { WebsiteRow } from '../../../src/modules/chat/website/api';
import { WebsiteTable } from '../../../src/modules/chat/website/WebsiteTable';

/**
 * worksuite-desktop#290 — the mail list's lead column: the unread dot, or the checkbox in its place (never both), the
 * app's 16px checkbox centred on the sender's line with an even 12px on the left; once one is ticked every row shows
 * its box; Select all (none, some, all), Shift-click ranges, Ctrl/⌘-click, Esc; the bar "N selected · Archive · Delete
 * · Move · Mark read · ⋯ · Clear"; and the same lead in the other lists.
 */

const NOW = new Date('2026-10-04T10:00:00Z');
const BOXES = [
  { id: 1, email: 'me@example.test', display_name: 'me', shared: false, unread: 2, in_unified: true, is_default: true, provider: 'imap', provider_label: 'IMAP', colour: 'blue', auth_state: 'ok' },
  { id: 2, email: 'me@contoso.test', display_name: 'me', shared: false, unread: 1, in_unified: true, provider: 'office365', provider_label: 'Microsoft 365', colour: 'indigo', auth_state: 'ok' },
];
const tag = (id: number) => ({ id, email: BOXES[id - 1]!.email, name: 'me', colour: BOXES[id - 1]!.colour });
/** Newest first: one a minute before the last. */
const msg = (id: number, box: number, minutes: number, over: Partial<MessageRow> = {}) => ({
  id, from_name: `Sender ${id}`, from_email: `s${id}@example.org`, subject: `Subject ${id}`, preview: 'A line of the message', is_read: false, is_starred: false, has_attachment: false,
  created_at: new Date(NOW.getTime() - minutes * 60_000).toISOString().slice(0, 19).replace('T', ' '), mailbox: tag(box), uid_key: `${box}:${id}`, folder_slug: 'inbox', ...over,
});

let inbox: unknown[] = [];

function Page({ initial }: { initial: string }) {
  const [route, setRoute] = useState(initial);
  return (
    <TabProvider tabId="t" route={route} active onGo={setRoute}>
      <span data-testid="route">{route}</span>
      <MailPage active tabId="t" route={route} />
    </TabProvider>
  );
}
const wrap = (ui: ReactNode) => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>);
const show = (initial = '/mail') => wrap(<Page initial={initial} />);

const list = () => screen.getByRole('listbox', { name: 'Messages' });
const rowOf = (subject: string) => within(list()).getByRole('option', { name: new RegExp(subject) });
const boxOf = (subject: string) => within(list()).getByRole('checkbox', { name: `Select “${subject}”` }) as HTMLInputElement;
const dots = () => list().querySelectorAll('[data-unread-dot]');
const selectAll = () => screen.getByRole('checkbox', { name: 'Select all' }) as HTMLInputElement;
const bar = (n: number) => screen.queryByRole('toolbar', { name: `${n} selected` });
const route = () => screen.getByTestId('route').textContent;
const ready = async () => {
  show();
  await within(await screen.findByRole('listbox', { name: 'Messages' })).findByText('Budget');
};

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  setRegional({ timezone: 'UTC', locale: 'en-GB', timeFormat: '24' });
  window.localStorage.clear();
  // Newest first: Budget, Lunch?, Minutes, Invoice — two unread, two read; Invoice is in the second account.
  inbox = [
    msg(701, 1, 1, { subject: 'Budget' }),
    msg(702, 1, 2, { subject: 'Lunch?', is_read: true }),
    msg(703, 1, 3, { subject: 'Minutes' }),
    msg(704, 2, 4, { subject: 'Invoice', is_read: true }),
  ];
  app.set({ status: { network: 'ONLINE' } as never, prefs: { mailCacheDays: 30, moduleNotifications: {}, badgeCount: true, theme: 'light' } as never, bootstrap: { user: { id: '9', name: 'Me', email: 'me@example.test' } } as never, apps: [] });
  vi.mocked(apiGet).mockReset().mockImplementation((async (path: string) => {
    if (path === '/api/mail/mailboxes') return { mailboxes: BOXES };
    if (path === '/api/mail/prefs') return { prefs: { firstRun: 'done', focused: false } };
    if (path === '/api/mail/views') return { mailboxes: BOXES.map((b) => ({ id: b.id, unread: b.unread, counted: true })), views: { unread: 2, starred: 0, today: 0, attachments: 0, drafts: 0, important: null, scheduled: 0 }, partial: false, unknown: [] };
    if (path === '/api/mail/sync/status') return { enabled: true, mailboxes: [], accounts: [], overall: { state: 'up_to_date', syncing: 0, total: 2, last_ok_at: null, failed: [], stale: [], stale_minutes: 60 } };
    throw new ApiError(404, path, null);
  }) as never);
  vi.mocked(apiGetMeta).mockReset().mockImplementation((async (path: string) => {
    if (path === '/api/mail/views/all/inbox') return { data: { messages: inbox, total: inbox.length, has_more: false, unified: true, role: 'inbox' }, offline: false, cachedAt: null };
    throw new ApiError(404, path, null);
  }) as never);
  vi.mocked(apiPost).mockReset().mockResolvedValue({} as never);
  vi.mocked(call).mockReset().mockImplementation((async (channel: string) => (channel === 'offline:pending' ? [] : null)) as never);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('the lead column: the unread dot, or the checkbox in its place', () => {
  it('shows the 8px accent dot on unread rows while nothing is picked, and nothing on read ones', async () => {
    await ready();
    const dot = rowOf('Budget').querySelector('[data-unread-dot]')!;
    expect(dot).toBeTruthy();
    expect(dot.className).toContain('h-2 w-2 rounded-full bg-primary');
    expect(rowOf('Minutes').querySelector('[data-unread-dot]')).toBeTruthy();
    expect(rowOf('Lunch?').querySelector('[data-unread-dot]')).toBeNull();
    expect(rowOf('Invoice').querySelector('[data-unread-dot]')).toBeNull();
    // The box waits in the dot's spot, unseen until the row is under the mouse — when the dot gives way to it.
    const check = rowOf('Budget').querySelector('[data-row-check]')!;
    expect(check.className).toContain('opacity-0');
    expect(check.className).toContain('group-hover:opacity-100');
    expect(dot.className).toContain('group-hover:invisible');
    expect(rowOf('Budget').className).toContain('group');
    // Both live in the one lead column of the row.
    const lead = rowOf('Budget').querySelector('[data-row-lead]')!;
    expect(lead.contains(dot) && lead.contains(check)).toBe(true);
    expect(rowOf('Budget').querySelectorAll('[data-row-lead]')).toHaveLength(1);
  });

  it('once one is ticked every row shows its checkbox and no row shows a dot, until the selection is cleared', async () => {
    await ready();
    fireEvent.click(boxOf('Lunch?'));
    expect(bar(1)).toBeTruthy();
    expect(dots()).toHaveLength(0);
    for (const s of ['Budget', 'Lunch?', 'Minutes', 'Invoice']) {
      expect(rowOf(s).querySelector('[data-row-check]')!.className).not.toContain('opacity-0');
    }
    expect(boxOf('Lunch?').checked).toBe(true);
    expect(boxOf('Budget').checked).toBe(false);
    fireEvent.click(boxOf('Lunch?'));
    expect(bar(1)).toBeNull();
    expect(dots()).toHaveLength(2);
  });

  it('keeps an unread row bold, on the selected background, while it is picked', async () => {
    await ready();
    fireEvent.click(boxOf('Budget'));
    const row = rowOf('Budget');
    expect(row.getAttribute('aria-selected')).toBe('true');
    expect(row.className).toContain('bg-selection');
    expect(within(row).getByText('Sender 701').className).toContain('font-bold');
    expect(within(row).getByText('Budget').className).toContain('font-bold');
    expect(within(rowOf('Lunch?')).getByText('Sender 702').className).not.toContain('font-bold');
  });

  it('draws the app’s 16px checkbox in a 32px square, in a 28px column 12px from the list’s edge', async () => {
    await ready();
    const box = boxOf('Budget');
    expect(box.className).toContain('ws-checkbox');
    expect(box.getAttribute('data-size')).toBeNull();
    expect(box.closest('[data-row-check]')!.className).toContain('h-8 w-8');
    expect(box.closest('[data-row-lead]')!.className).toContain('w-7');
    expect(rowOf('Budget').className).toContain('pl-3');
    // The look itself: 16×16, a 4px corner, a 1.5px muted border, the accent when ticked, and a ring for the keyboard only.
    const css = readFileSync(join(__dirname, '../../../src/styles.css'), 'utf8');
    const rule = css.slice(css.indexOf('  .ws-checkbox {'), css.indexOf('}', css.indexOf('  .ws-checkbox {')));
    expect(rule).toContain('width: 16px;');
    expect(rule).toContain('height: 16px;');
    expect(rule).toContain('border: 1.5px solid var(--ws-cb-border);');
    expect(rule).toContain('border-radius: 4px;');
    expect(css).toMatch(/\.ws-checkbox:checked,\s*\.ws-checkbox:indeterminate,[^{]*\{\s*border-color: var\(--ws-cb-accent\);\s*background-color: var\(--ws-cb-accent\);/);
    expect(css).toMatch(/\.ws-checkbox:focus-visible \{\s*outline: 2px solid var\(--ws-focus\);/);
    expect(css).not.toMatch(/\.ws-checkbox:focus\s*\{/);
  });
});

describe('picking', () => {
  it('ticking a box does not open the message; a click elsewhere on the row does', async () => {
    await ready();
    fireEvent.click(boxOf('Budget'));
    expect(route()).toBe('/mail');
    // The square around the box takes the click too, and keeps it from the row.
    fireEvent.click(rowOf('Minutes').querySelector('[data-row-check]')!);
    expect(bar(2)).toBeTruthy();
    expect(route()).toBe('/mail');
    fireEvent.click(within(rowOf('Invoice')).getByText('Invoice'));
    await waitFor(() => expect(route()).toBe('/mail?msg=704&mbx=2'));
    // Opening a message lets the selection go.
    expect(bar(2)).toBeNull();
  });

  it('Ctrl- and ⌘-click tick and untick single rows without opening them', async () => {
    await ready();
    fireEvent.click(within(rowOf('Budget')).getByText('Budget'), { ctrlKey: true });
    fireEvent.click(within(rowOf('Minutes')).getByText('Minutes'), { metaKey: true });
    expect(bar(2)).toBeTruthy();
    expect(boxOf('Budget').checked && boxOf('Minutes').checked).toBe(true);
    fireEvent.click(within(rowOf('Budget')).getByText('Budget'), { metaKey: true });
    expect(bar(1)).toBeTruthy();
    expect(boxOf('Budget').checked).toBe(false);
    expect(route()).toBe('/mail');
  });

  it('Shift-click picks the range from the last row ticked — on the row or on its box', async () => {
    await ready();
    fireEvent.click(boxOf('Budget'));
    fireEvent.click(within(rowOf('Minutes')).getByText('Minutes'), { shiftKey: true });
    expect(bar(3)).toBeTruthy();
    expect([boxOf('Budget'), boxOf('Lunch?'), boxOf('Minutes')].every((b) => b.checked)).toBe(true);
    expect(boxOf('Invoice').checked).toBe(false);
    fireEvent.click(boxOf('Invoice'), { shiftKey: true });
    expect(bar(4)).toBeTruthy();
    expect(route()).toBe('/mail');
  });

  it('Shift-click after opening a message picks the run from the open one', async () => {
    await ready();
    fireEvent.click(within(rowOf('Lunch?')).getByText('Lunch?'));
    await waitFor(() => expect(route()).toContain('msg=702'));
    fireEvent.click(within(rowOf('Invoice')).getByText('Invoice'), { shiftKey: true });
    expect(bar(3)).toBeTruthy();
    expect([boxOf('Lunch?'), boxOf('Minutes'), boxOf('Invoice')].every((b) => b.checked)).toBe(true);
    expect(boxOf('Budget').checked).toBe(false);
  });

  it('Esc clears the selection, from the page or from a row’s box', async () => {
    await ready();
    fireEvent.click(boxOf('Budget'));
    fireEvent.click(boxOf('Lunch?'));
    expect(bar(2)).toBeTruthy();
    fireEvent.keyDown(document.body, { key: 'Escape', code: 'Escape' });
    expect(bar(2)).toBeNull();
    expect(dots()).toHaveLength(2);
    fireEvent.click(boxOf('Minutes'));
    fireEvent.keyDown(boxOf('Minutes'), { key: 'Escape', code: 'Escape' });
    expect(bar(1)).toBeNull();
  });

  it('Select all over the list is clear, mixed or ticked, and ticks or clears every row', async () => {
    await ready();
    const all = selectAll();
    // In the rows' lead column: 28px, pulled to the same 12px from the edge.
    expect(all.closest('span')!.className).toContain('w-7');
    expect(all.checked).toBe(false);
    expect(all.indeterminate).toBe(false);
    fireEvent.click(boxOf('Minutes'));
    expect(all.checked).toBe(false);
    expect(all.indeterminate).toBe(true);
    fireEvent.click(all);
    expect(bar(4)).toBeTruthy();
    expect(all.checked).toBe(true);
    expect(all.indeterminate).toBe(false);
    fireEvent.click(all);
    expect(bar(4)).toBeNull();
    expect(all.checked).toBe(false);
    expect(all.indeterminate).toBe(false);
    expect(dots()).toHaveLength(2);
  });
});

describe('the selection’s bar', () => {
  it('says how many and offers Archive, Delete, Move, Mark read, More and Clear', async () => {
    await ready();
    fireEvent.click(boxOf('Budget'));
    fireEvent.click(boxOf('Minutes'));
    const b = bar(2)!;
    expect(within(b).getByText('2 selected')).toBeTruthy();
    expect(within(b).getAllByRole('button').map((x) => x.getAttribute('aria-label') ?? x.textContent)).toEqual(['Archive', 'Delete', 'Move', 'Mark read', 'More actions', 'Clear selection']);
    expect(within(b).getByRole('button', { name: 'Clear selection' }).textContent).toBe('Clear');
    // Both in one account: Move is offered.
    expect((within(b).getByRole('button', { name: 'Move' }) as HTMLButtonElement).disabled).toBe(false);
    // Read ones say Mark unread.
    fireEvent.click(boxOf('Budget'));
    fireEvent.click(boxOf('Minutes'));
    fireEvent.click(boxOf('Lunch?'));
    expect(within(bar(1)!).getByRole('button', { name: 'Mark unread' })).toBeTruthy();
    fireEvent.click(within(bar(1)!).getByRole('button', { name: 'Clear selection' }));
    expect(bar(1)).toBeNull();
  });

  it('moves one account’s mail at a time, as the menu does', async () => {
    await ready();
    fireEvent.click(boxOf('Budget'));
    fireEvent.click(boxOf('Invoice'));
    const move = within(bar(2)!).getByRole('button', { name: 'Move' }) as HTMLButtonElement;
    expect(move.disabled).toBe(true);
    expect(move.title).toBe('Pick messages from one account to move them together.');
  });

  it('marks the selection read from the bar, each in its own account, and opens nothing', async () => {
    await ready();
    fireEvent.click(boxOf('Budget'));
    fireEvent.click(boxOf('Minutes'));
    fireEvent.click(within(bar(2)!).getByRole('button', { name: 'Mark read' }));
    await waitFor(() => expect(vi.mocked(call).mock.calls.filter(([c]) => c === 'offline:submit').map(([, i]) => (i as { entity: string }).entity)).toEqual(['message.read', 'message.read']));
    expect(route()).toBe('/mail');
  });
});

describe('RowLead, the one lead every list shares', () => {
  it('shows the dot, or the box — never both — and hands Shift on as a range', () => {
    const onPick = vi.fn();
    const openRow = vi.fn();
    const { rerender } = render(
      <div className="group" onClick={openRow}>
        <RowLead unread onPick={onPick} label="Select “A”" />
      </div>,
    );
    expect(document.querySelector('[data-unread-dot]')!.getAttribute('aria-hidden')).toBe('true');
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select “A”' }), { shiftKey: true });
    expect(onPick).toHaveBeenLastCalledWith('range');
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select “A”' }), { metaKey: true });
    expect(onPick).toHaveBeenLastCalledWith('toggle');
    expect(openRow).not.toHaveBeenCalled();
    rerender(
      <div className="group" onClick={openRow}>
        <RowLead unread checked selecting onPick={onPick} label="Select “A”" />
      </div>,
    );
    expect(document.querySelector('[data-unread-dot]')).toBeNull();
    expect((screen.getByRole('checkbox', { name: 'Select “A”' }) as HTMLInputElement).checked).toBe(true);
  });

  it('draws a mark, not a second control, for a row that is itself the button that picks', () => {
    render(
      <button type="button">
        <RowLead unread dotLabel="Marked unread" />
        Kasun
      </button>,
    );
    expect(screen.getByRole('img', { name: 'Marked unread' })).toBeTruthy();
    expect(screen.queryByRole('checkbox')).toBeNull();
    cleanup();
    render(
      <button type="button">
        <RowLead unread dotLabel="Marked unread" checked selecting />
        Kasun
      </button>,
    );
    expect(screen.queryByRole('img', { name: 'Marked unread' })).toBeNull();
    const mark = document.querySelector('.ws-checkbox')!;
    expect(mark.tagName).toBe('SPAN');
    expect(mark.getAttribute('data-state')).toBe('checked');
    expect(mark.getAttribute('aria-hidden')).toBe('true');
    cleanup();
    render(<CheckboxMark indeterminate />);
    expect(document.querySelector('.ws-checkbox')!.getAttribute('data-state')).toBe('mixed');
  });

  it('is the lead of the Website chats table: a box on every row, ticked without opening the chat', async () => {
    const onOpen = vi.fn();
    const row = (id: number, name: string): WebsiteRow => ({
      id, widget: 'TechHub', widget_id: 1, site: 'techubiz.com', online: true, inactive: false, label: `Visitor ${id}`, visitor_name: name, email: null, country: null, browser: null, os: null, device: null,
      current_url: null, last_seen: null, status: 'open', is_offline: false, priority: 'normal', updated_at: NOW.toISOString(), agent: null, assigned_to: null, started_at: null, last_visitor_at: null,
      waiting_since: null, at_risk: false, awaiting_reply: false, rating: null, is_starred: false, tags: null,
    });
    wrap(<WebsiteTable title="Live chats" subtitle="Visitors still on the site" filters={null} rows={[row(1, 'Anne'), row(2, 'Kasun')]} me={5} myName="Me" ringing={new Map()} typing={new Set()} active onOpen={onOpen} onMenu={vi.fn()} />);
    const grid = screen.getByRole('grid', { name: 'Live chats' });
    const anne = within(grid).getByRole('checkbox', { name: 'Select Anne' });
    expect(anne.closest('[data-row-lead]')).toBeTruthy();
    expect(anne.closest('[data-row-check]')!.className).not.toContain('opacity-0');
    expect(grid.querySelectorAll('[data-row-lead]')).toHaveLength(2);
    fireEvent.click(anne);
    expect(onOpen).not.toHaveBeenCalled();
    expect((within(grid).getByRole('checkbox', { name: 'Select all' }) as HTMLInputElement).indeterminate).toBe(true);
  });
});

describe('useListSelection', () => {
  it('toggles, adds ranges from the anchor or the open row, and is none, some or all', () => {
    const { result } = renderHook(() => useListSelection(['a', 'b', 'c', 'd']));
    expect(result.current.state).toBe('none');
    act(() => result.current.pick('c', 'range', 'a'));
    expect([...result.current.selected]).toEqual(['a', 'b', 'c']);
    expect(result.current.state).toBe('some');
    act(() => result.current.pick('b', 'toggle'));
    expect([...result.current.selected].sort()).toEqual(['a', 'c']);
    act(() => result.current.pick('d', 'range'));
    expect([...result.current.selected].sort()).toEqual(['a', 'b', 'c', 'd']);
    expect(result.current.state).toBe('all');
    act(() => result.current.toggleAll());
    expect(result.current.state).toBe('none');
    act(() => result.current.toggleAll());
    expect(result.current.state).toBe('all');
    let cleared = false;
    act(() => {
      cleared = result.current.escape({ key: 'Escape' });
    });
    expect(cleared).toBe(true);
    expect(result.current.selecting).toBe(false);
    expect(result.current.escape({ key: 'Escape' })).toBe(false);
  });

  it('reads the keys held: Ctrl/⌘ toggles, Shift picks a range, a plain click picks nothing', () => {
    expect(pickOf({ ctrlKey: true })).toBe('toggle');
    expect(pickOf({ metaKey: true, shiftKey: true })).toBe('toggle');
    expect(pickOf({ shiftKey: true })).toBe('range');
    expect(pickOf({})).toBeNull();
  });
});
