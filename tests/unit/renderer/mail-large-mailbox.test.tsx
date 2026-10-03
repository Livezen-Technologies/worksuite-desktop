// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { VirtualList } from '../../../src/components/VirtualList';
import { applyFilters, groupRows, sortRows } from '../../../src/modules/mail/model';
import type { MessageRow } from '../../../src/modules/mail/types';

/**
 * worksuite-desktop#162, performance on a very large Inbox — a synthetic
 * 90,000-message folder, not a real account (no 90k mailbox was measured):
 * the list renders only what is on screen, and filtering, sorting and
 * grouping what is loaded stay well inside an interaction. The budgets are
 * generous on purpose; they catch an accidental O(n²), not a few percent.
 */
const N = 90_000;

function synthetic(n: number): MessageRow[] {
  const out: MessageRow[] = new Array(n);
  const start = Date.UTC(2026, 9, 3, 12, 0, 0);
  for (let i = 0; i < n; i++) {
    const at = new Date(start - i * 7 * 60_000).toISOString().replace('T', ' ').slice(0, 19);
    out[i] = { id: n - i, from_name: `Sender ${i % 977}`, from_email: `s${i % 977}@example.org`, subject: `Subject ${i}`, preview: 'Preview text of the message', is_read: i % 9 !== 0, is_starred: i % 50 === 0, has_attachment: i % 7 === 0, created_at: at, folder_slug: 'inbox' };
  }
  return out;
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('a 90,000-message folder (synthetic)', () => {
  const rows = synthetic(N);

  it('renders only the rows on screen', () => {
    // jsdom has no layout: give the scroller a 720px viewport.
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(720);
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(600);
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ width: 600, height: 720, top: 0, left: 0, right: 600, bottom: 720, x: 0, y: 0, toJSON: () => ({}) } as DOMRect);
    const t0 = performance.now();
    const { container } = render(<VirtualList items={rows} estimate={52} getKey={(r) => r.id} render={(r) => <div data-testid="row">{r.subject}</div>} />);
    const ms = performance.now() - t0;
    const shown = container.querySelectorAll('[data-testid="row"]').length;
    expect(shown).toBeGreaterThan(0);
    expect(shown).toBeLessThan(60);
    // The scroll area is as tall as all of them (rows measured on screen count at their measured height).
    expect(parseInt((container.firstElementChild!.firstElementChild as HTMLElement).style.height, 10)).toBeGreaterThanOrEqual(N * 52);
    expect(ms).toBeLessThan(1500);
  });

  it('filters, sorts and groups them inside an interaction', () => {
    const t0 = performance.now();
    const unread = applyFilters(rows, ['unread']);
    const sorted = sortRows(rows, 'sender', 'asc');
    const groups = groupRows(rows, 'date', '2026-10-03');
    const ms = performance.now() - t0;
    expect(unread.length).toBe(rows.filter((r) => !r.is_read).length);
    expect(sorted).toHaveLength(N);
    expect(groups.reduce((n, g) => n + g.rows.length, 0)).toBe(N);
    expect(ms).toBeLessThan(3000);
  });
});
