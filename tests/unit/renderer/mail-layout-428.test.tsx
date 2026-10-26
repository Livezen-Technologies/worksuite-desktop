// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type * as CoreApi from '../../../src/core/api';

/**
 * worksuite-desktop#428: the mail list's filter chips stay on one row inside the list — what does not fit goes into
 * "More filters" — the sort control keeps its own line, nothing in the list header reaches into the reading pane,
 * and a date band's label and count keep their sides.
 */
vi.mock('../../../src/core/api', async (orig) => ({ ...(await orig<typeof CoreApi>()), apiGet: vi.fn(), apiPut: vi.fn() }));
vi.mock('../../../src/core/bridge', () => ({ call: vi.fn(async () => null), on: () => () => undefined, errorMessage: (e: unknown) => String(e), isMac: false }));
vi.mock('../../../src/core/toasts', () => ({ toast: vi.fn() }));

import { FilterChips, moreLabel, splitChips } from '../../../src/modules/mail/FilterChips';
import { fitCount } from '../../../src/modules/mail/editor/overflow';
import { MessageList, type ListRow, type MessageListProps } from '../../../src/modules/mail/MessageList';
import { CHIPS, type ChipId } from '../../../src/modules/mail/model';
import type { MessageRow } from '../../../src/modules/mail/types';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

/** Every chip 80 px wide, the filter row `row` px: what a narrow list gives it. */
function widths(row: number) {
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockImplementation(function (this: HTMLElement) {
    return this.dataset.ov ? 80 : 0;
  });
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(function (this: HTMLElement) {
    return this.hasAttribute('data-filter-row') ? row : 0;
  });
}

describe('the overflow logic', () => {
  it('keeps every chip when they fit and moves the rest, from the end, into More filters', () => {
    const on = (id: string) => id === 'week';
    expect(splitChips(CHIPS, 4, on)).toEqual({ shown: CHIPS, hidden: [], hiddenOn: 0 });
    const two = splitChips(CHIPS, 2, on);
    expect(two.shown.map((c) => c.id)).toEqual(['unread', 'attachments']);
    expect(two.hidden.map((c) => c.id)).toEqual(['starred', 'week']);
    expect(two.hiddenOn).toBe(1);
    expect(splitChips(CHIPS, -1, on).shown).toEqual([]);
    expect(splitChips(CHIPS, 9, on).hidden).toEqual([]);
  });

  it('counts the room for the More filters button only when something does not fit', () => {
    expect(fitCount([80, 80, 80, 80], 338, 112, 6)).toBe(4);
    expect(fitCount([80, 80, 80, 80], 300, 112, 6)).toBe(2);
    expect(fitCount([80, 80, 80, 80], 120, 112, 6)).toBe(0);
  });

  it('says how many hidden filters are on', () => {
    expect(moreLabel(0)).toBe('More filters');
    expect(moreLabel(2)).toBe('More filters (2)');
  });
});

function Chips() {
  const [on, setOn] = useState<string[]>([]);
  return <FilterChips chips={CHIPS} label="Quick filters" isOn={(id) => on.includes(id)} onToggle={(id) => setOn(on.includes(id) ? on.filter((x) => x !== id) : [...on, id])} />;
}

describe('the chip row', () => {
  it('shows every chip, on one row, when there is room', () => {
    widths(600);
    render(<Chips />);
    const row = screen.getByRole('group', { name: 'Quick filters' });
    expect(row.className).toContain('flex-nowrap');
    expect(row.className).toContain('min-w-0');
    expect(row.className).toContain('overflow-hidden');
    expect(within(row).getAllByRole('button').map((b) => b.textContent)).toEqual(['Unread', 'Has files', 'Starred', 'Last 7 days']);
  });

  it('moves what does not fit into More filters, which turns them on and off and says how many are on', () => {
    widths(300);
    render(<Chips />);
    const row = screen.getByRole('group', { name: 'Quick filters' });
    expect(within(row).getAllByRole('button').map((b) => b.textContent)).toEqual(['Unread', 'Has files', 'More filters']);
    fireEvent.click(within(row).getByRole('button', { name: 'More filters' }));
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: /Last 7 days/ }));
    expect(screen.getByRole('button', { name: 'More filters (1)' })).toBeTruthy();
  });
});

const row = (id: number): MessageRow => ({ id, from_name: 'Nimal Silva', from_email: 'nimal@x.lk', subject: `Invoice ${id}`, preview: '', is_read: false, is_starred: false, has_attachment: false, created_at: '2026-09-04 09:00:00' }) as MessageRow;
const noop = () => undefined;
function list(over: Partial<MessageListProps> = {}) {
  const items: ListRow[] = [row(1), row(2)].map((r) => ({ row: r, key: String(r.id), queued: null }));
  const props: MessageListProps = {
    title: 'Inbox', groups: [{ key: 'sep', label: 'September 2026 — a very long band label that must truncate', rows: items.map((i) => i.row), items }], total: 2, loading: false, error: null, onRetry: noop,
    selectedKey: null, onOpen: noop, onStar: noop, prefs: { view: 'compact' }, onPrefs: noop, conversations: null, onConversations: noop, chips: [] as ChipId[], onChips: noop,
    search: '', onSearch: noop, onSearchAll: noop, unified: false, boxes: [], offline: false, offlineDays: 0, refreshing: false, onRefresh: noop,
    hasMore: false, loadingMore: false, onMore: noop, ...over,
  };
  return render(<QueryClientProvider client={new QueryClient()}><MessageList {...props} /></QueryClientProvider>);
}

describe('the message list', () => {
  it('keeps its header inside the list pane, with the sort control on its own line', () => {
    const { container } = list();
    const pane = container.querySelector('[data-mail-list-pane]')!;
    expect(pane.className).toMatch(/\bmin-w-0\b/);
    expect(pane.className).toContain('isolate');
    const head = container.querySelector('[data-mail-list-head]')!;
    expect(head.className).toContain('overflow-hidden');
    expect(head.className).toContain('[contain:layout_paint]');
    const sort = container.querySelector('[data-sort-chip]')!;
    expect(sort.closest('[role="group"]')).toBeNull();
    expect(sort.textContent).toMatch(/Date/);
  });

  it('keeps a band label at the start, truncated, and its count at the end, never clipped', () => {
    const { container } = list();
    const head = container.querySelector('[data-group-head="sep"]')!;
    const [label, count] = Array.from(head.children) as HTMLElement[];
    expect(label!.className).toContain('truncate');
    expect(label!.className).toContain('min-w-0');
    expect(count!.textContent).toBe('2');
    expect(count!.className).toContain('shrink-0');
  });
});
