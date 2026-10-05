// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as CoreApi from '../../../src/core/api';

vi.mock('../../../src/core/api', async (orig) => ({ ...(await orig<typeof CoreApi>()), apiGet: vi.fn(), apiGetMeta: vi.fn(), apiPost: vi.fn(), apiPut: vi.fn(), apiDelete: vi.fn() }));
vi.mock('../../../src/core/bridge', () => ({ call: vi.fn(async () => null), on: () => () => undefined, errorMessage: (e: unknown) => (e instanceof Error ? e.message : String(e)), isMac: false, hasDesktop: () => true }));

import { ApiError, apiGet, apiGetMeta, apiPost } from '../../../src/core/api';
import { app } from '../../../src/core/app-state';
import { call } from '../../../src/core/bridge';
import { TabProvider } from '../../../src/core/tab-context';
import { setRegional } from '../../../src/core/time';
import { toasts } from '../../../src/core/toasts';
import {
  ERROR_MS, GESTURE_GAP_MS, HIGHLIGHT_MS, ListRefreshController, PULL_THRESHOLD, RESULT_MS, SETTLE_MS,
  checkedLabel, newRows, pullEnabled, pullPrefs, setPullEnabled, wheelPixels, type RefreshItem,
} from '../../../src/components/listRefresh';
import { FRESH_CLASS, isCheckKey, refreshWords, useListRefresh } from '../../../src/components/PullToRefresh';
import MailPage from '../../../src/modules/mail/MailPage';
import { MailSettings } from '../../../src/modules/mail/MailSettings';
import { bindings, commandFor, keyConflicts } from '../../../src/modules/mail/keymap';
import { syncRunner } from '../../../src/modules/mail/sync';
import type { MessageRow } from '../../../src/modules/mail/types';

/**
 * worksuite-desktop#236 — pull down at the top of a list to check for new mail, and a "↑ 3 new emails" pill.
 *
 * At the very top, scrolling up further (wheel, trackpad or touch) opens "↓ Pull to check for new mail", turns to
 * "↑ Release to check" past 64px and checks on release: the spinner and "Checking for new mail…", then "3 new",
 * "Up to date · checked just now" or "Couldn't check … · Retry". Only a gesture that began at the top counts, never
 * the tail of a flick; a check never runs twice at once. New mail arriving below the top shows a pill that scrolls
 * up and lights the new rows, and the rows being read stay where they are. "Checked 2 min ago" sits under the
 * header; ⌘R/F5 and a click on it check too. Mail, Team Chat, WhatsApp and Website chats share it.
 */

// ---- a scroller that jsdom lets us move ------------------------------------------------------------------------

/** jsdom keeps no scroll position and lays nothing out: rows are 50px tall, in order, under a 400px scroller. */
function makeScroller(keys: string[] = [], top = 0): HTMLDivElement {
  const el = document.createElement('div');
  let st = top;
  Object.defineProperty(el, 'scrollTop', { configurable: true, get: () => st, set: (v: number) => void (st = v) });
  Object.defineProperty(el, 'clientHeight', { configurable: true, value: 400 });
  el.getBoundingClientRect = () => ({ top: 0, bottom: 400, left: 0, right: 300, height: 400, width: 300, x: 0, y: 0, toJSON: () => ({}) });
  el.scrollTo = vi.fn((o?: ScrollToOptions | number) => {
    if (typeof o === 'object' && o.top !== undefined) st = o.top;
  }) as never;
  setRows(el, keys);
  document.body.appendChild(el);
  return el;
}

function setRows(el: HTMLElement, keys: string[]): void {
  el.replaceChildren(
    ...keys.map((k) => {
      const row = document.createElement('div');
      row.dataset.refreshKey = k;
      row.getBoundingClientRect = () => {
        const i = [...el.children].indexOf(row);
        const t = i * 50 - el.scrollTop;
        return { top: t, bottom: t + 50, left: 0, right: 300, height: 50, width: 300, x: 0, y: t, toJSON: () => ({}) };
      };
      return row;
    }),
  );
}

const items = (...keys: string[]): RefreshItem[] => keys.map((key) => ({ key }));

function controller(o: { check?: () => Promise<unknown> | unknown; pull?: boolean; el?: HTMLElement } = {}) {
  const c = new ListRefreshController();
  const check = vi.fn(o.check ?? (async () => undefined));
  c.configure({ check, pull: o.pull ?? true, errorText: (e) => `Couldn’t check ${e instanceof Error ? e.message : String(e)}` });
  const el = o.el ?? makeScroller();
  c.attach(el);
  return { c, check, el };
}

const tick = (ms: number) => act(() => void vi.advanceTimersByTime(ms));

describe('the pull: thresholds, debounce, flicks', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-05T09:00:00Z'));
  });
  afterEach(() => {
    vi.useRealTimers();
    document.body.replaceChildren();
  });

  it('opens with an upward wheel at the very top, arms past 64px and checks once the gesture lets go', async () => {
    const { c, check } = controller();
    c.wheel(-40);
    expect(c.get()).toMatchObject({ phase: 'pulling', pull: 20 });
    vi.advanceTimersByTime(30);
    c.wheel(-60);
    expect(c.get().phase).toBe('pulling');
    vi.advanceTimersByTime(30);
    c.wheel(-40);
    expect(c.get().pull).toBeGreaterThanOrEqual(PULL_THRESHOLD);
    expect(c.get().phase).toBe('armed');
    expect(check).not.toHaveBeenCalled();
    // The release: no wheel event for a moment.
    await vi.advanceTimersByTimeAsync(GESTURE_GAP_MS + 1);
    expect(check).toHaveBeenCalledTimes(1);
    expect(c.get().phase).toBe('checking');
  });

  it('closes without checking when let go short of the threshold, and pushing back down undoes the pull', async () => {
    const { c, check } = controller();
    c.wheel(-80);
    vi.advanceTimersByTime(20);
    c.wheel(30);
    expect(c.get().pull).toBe(10);
    await vi.advanceTimersByTimeAsync(GESTURE_GAP_MS + 1);
    expect(c.get()).toMatchObject({ phase: 'idle', pull: 0 });
    expect(check).not.toHaveBeenCalled();
  });

  it('ignores a flick that reaches the top from further down, momentum and all — and normal scrolling', async () => {
    const el = makeScroller([], 300);
    const { c, check } = controller({ el });
    // Scrolling up from 300px: the wheel events come while the list is still scrolled.
    c.wheel(-120);
    el.scrollTop = 0;
    // The momentum carries on at the top, with no pause: still the same gesture.
    for (let i = 0; i < 12; i++) {
      vi.advanceTimersByTime(16);
      c.wheel(-60);
    }
    expect(c.get().phase).toBe('idle');
    await vi.advanceTimersByTimeAsync(GESTURE_GAP_MS + 1);
    expect(check).not.toHaveBeenCalled();
    // Downward at the top, and sideways, are not pulls either.
    c.wheel(80);
    expect(c.get().phase).toBe('idle');
    vi.advanceTimersByTime(GESTURE_GAP_MS + 1);
    c.wheel(-200, true);
    expect(c.get().phase).toBe('idle');
    // A fresh gesture, begun at the top: that one is a pull.
    vi.advanceTimersByTime(GESTURE_GAP_MS + 1);
    c.wheel(-60);
    expect(c.get().phase).toBe('pulling');
  });

  it('a pull that scrolls the list on the way stops being one', () => {
    const el = makeScroller();
    const { c } = controller({ el });
    c.wheel(-60);
    expect(c.get().phase).toBe('pulling');
    el.scrollTop = 40;
    vi.advanceTimersByTime(16);
    c.wheel(-20);
    expect(c.get()).toMatchObject({ phase: 'idle', pull: 0 });
  });

  it('reads line and page wheel units as pixels', () => {
    expect(wheelPixels(-3, 1)).toBe(-48);
    expect(wheelPixels(-1, 2, 500)).toBe(-500);
    expect(wheelPixels(-40, 0)).toBe(-40);
  });

  it('pulls by touch from the top, and not from further down', async () => {
    const { c, check, el } = controller();
    c.touchStart(100);
    c.touchMove(160);
    expect(c.get()).toMatchObject({ phase: 'pulling', pull: 30 });
    c.touchMove(260);
    expect(c.get().phase).toBe('armed');
    c.touchEnd();
    await vi.advanceTimersByTimeAsync(0);
    expect(check).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(SETTLE_MS + RESULT_MS + 1);
    el.scrollTop = 120;
    c.touchStart(100);
    c.touchMove(300);
    c.touchEnd();
    expect(check).toHaveBeenCalledTimes(1);
  });

  it('never checks twice at once: a second request, or a pull, during a check does nothing', async () => {
    let finish: () => void = () => undefined;
    const { c, check } = controller({ check: () => new Promise<void>((r) => (finish = r)) });
    void c.checkNow();
    void c.checkNow();
    expect(check).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(GESTURE_GAP_MS + 1);
    c.wheel(-200);
    expect(c.get().phase).toBe('checking');
    await vi.advanceTimersByTimeAsync(GESTURE_GAP_MS + 1);
    expect(check).toHaveBeenCalledTimes(1);
    finish();
    await vi.advanceTimersByTimeAsync(SETTLE_MS + 1);
    expect(c.get().phase).toBe('current');
  });

  it('with the setting off, a pull does nothing — a check asked for still runs', async () => {
    const { c, check } = controller({ pull: false });
    c.wheel(-300);
    expect(c.get().phase).toBe('idle');
    void c.checkNow();
    await vi.advanceTimersByTimeAsync(SETTLE_MS + 1);
    expect(check).toHaveBeenCalledTimes(1);
  });
});

describe('the result: N new, Up to date, or an error with Retry', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-05T09:00:00Z'));
  });
  afterEach(() => {
    vi.useRealTimers();
    document.body.replaceChildren();
  });

  it('counts the rows the check brought, says "N new" for a moment, then closes', async () => {
    const el = makeScroller(['a', 'b']);
    const c = new ListRefreshController();
    c.attach(el);
    c.sync(items('a', 'b'), 'inbox', true);
    c.configure({
      pull: true,
      errorText: String,
      check: async () => {
        // The new rows land while the check answers.
        setRows(el, ['x', 'y', 'z', 'a', 'b']);
        c.sync(items('x', 'y', 'z', 'a', 'b'), 'inbox', true);
      },
    });
    const p = c.checkNow();
    await vi.advanceTimersByTimeAsync(SETTLE_MS + 1);
    await p;
    expect(c.get()).toMatchObject({ phase: 'new', added: 3 });
    expect([...c.get().fresh]).toEqual(['x', 'y', 'z']);
    await vi.advanceTimersByTimeAsync(RESULT_MS + 1);
    expect(c.get().phase).toBe('idle');
    // The highlight fades a little later.
    await vi.advanceTimersByTimeAsync(HIGHLIGHT_MS);
    expect(c.get().fresh.size).toBe(0);
  });

  it('says Up to date when nothing came, and keeps when it checked', async () => {
    const { c } = controller();
    const p = c.checkNow();
    await vi.advanceTimersByTimeAsync(SETTLE_MS + 1);
    await p;
    expect(c.get()).toMatchObject({ phase: 'current', added: 0 });
    expect(c.get().checkedAt).toBeGreaterThanOrEqual(Date.parse('2026-10-05T09:00:00Z'));
  });

  it('shows the error with Retry while the list stays usable, and closes on its own', async () => {
    let fail = true;
    const { c, check } = controller({
      check: async () => {
        if (fail) throw new Error('hasarinda@example.test');
      },
    });
    await c.checkNow();
    expect(c.get()).toMatchObject({ phase: 'error', error: 'Couldn’t check hasarinda@example.test' });
    // Retry is another check.
    fail = false;
    const p = c.checkNow();
    await vi.advanceTimersByTimeAsync(SETTLE_MS + 1);
    await p;
    expect(check).toHaveBeenCalledTimes(2);
    expect(c.get().phase).toBe('current');
    fail = true;
    await c.checkNow();
    await vi.advanceTimersByTimeAsync(ERROR_MS + 1);
    expect(c.get().phase).toBe('idle');
  });
});

describe('new rows, the pill and keeping the place', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-05T09:00:00Z'));
  });
  afterEach(() => {
    vi.useRealTimers();
    document.body.replaceChildren();
  });

  it('new rows are unknown ones above the rows already there, or rows whose stamp moved on — never the next page', () => {
    const known = new Map<string, string | number | null>([['a', null], ['b', null], ['r1', '2026-10-05 08:00:00']]);
    expect(newRows(items('x', 'a', 'b'), known)).toEqual(['x']);
    expect(newRows(items('a', 'b', 'p1', 'p2'), known)).toEqual([]);
    expect(newRows([{ key: 'r1', stamp: '2026-10-05 09:00:00' }, { key: 'a' }], known)).toEqual(['r1']);
    expect(newRows([{ key: 'r1', stamp: '2026-10-05 07:00:00' }], known)).toEqual([]);
    // The first rows of a list are not new; nor are rows back after a filter or an Undo.
    const c = new ListRefreshController();
    c.attach(makeScroller());
    c.sync(items('a', 'b'), 'v', false);
    c.sync(items('a', 'b'), 'v', true);
    expect(c.get().fresh.size).toBe(0);
    c.sync(items('b'), 'v', true);
    c.sync(items('a', 'b'), 'v', true);
    expect(c.get().fresh.size).toBe(0);
    // Another folder starts over.
    c.sync(items('q', 'r'), 'other', true);
    expect(c.get().fresh.size).toBe(0);
  });

  it('at the top, new rows come in lit; further down they wait behind the pill and the rows in view stay put', () => {
    const el = makeScroller(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j']);
    const c = new ListRefreshController();
    c.attach(el);
    c.sync(items('a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'), 'inbox', true);
    // Reading further down: "c" is at the top of the view.
    el.scrollTop = 100;
    el.dispatchEvent(new Event('scroll'));
    expect(c.get().atTop).toBe(false);
    setRows(el, ['x', 'y', 'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j']);
    c.sync(items('x', 'y', 'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'), 'inbox', true);
    // Two rows (100px) came above the view: it moved by as much, so "c" is still where it was.
    expect(el.scrollTop).toBe(200);
    expect(c.get().unseen).toBe(2);
    expect(c.get().fresh.size).toBe(0);
    // The pill: to the top, smoothly, with the new rows lit.
    c.showNew(true);
    expect(el.scrollTo).toHaveBeenCalledWith({ top: 0, behavior: 'smooth' });
    expect(c.get().unseen).toBe(0);
    expect([...c.get().fresh].sort()).toEqual(['x', 'y']);
  });

  it('the pill goes once the new rows are scrolled to, or at the top', () => {
    const el = makeScroller(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j']);
    const c = new ListRefreshController();
    c.attach(el);
    c.sync(items('a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'), 'inbox', true);
    el.scrollTop = 300;
    el.dispatchEvent(new Event('scroll'));
    setRows(el, ['x', 'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j']);
    c.sync(items('x', 'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'), 'inbox', true);
    expect(c.get().unseen).toBe(1);
    // Scrolled up until "x" is in view: seen.
    el.scrollTop = 20;
    el.dispatchEvent(new Event('scroll'));
    expect(c.get().unseen).toBe(0);
    // And at the top, any still waiting count as seen.
    el.scrollTop = 300;
    el.dispatchEvent(new Event('scroll'));
    setRows(el, ['w', 'x', 'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j']);
    c.sync(items('w', 'x', 'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'), 'inbox', true);
    expect(c.get().unseen).toBe(1);
    el.scrollTop = 0;
    el.dispatchEvent(new Event('scroll'));
    expect(c.get()).toMatchObject({ unseen: 0, atTop: true });
  });
});

// ---- the shared component ---------------------------------------------------------------------------------------

function List({ check, rows, list = 'mail' as const }: { check: () => Promise<unknown>; rows: string[]; list?: 'mail' | 'chat' }) {
  const r = useListRefresh({ list, check, items: rows.map((key) => ({ key })), view: 'inbox', words: refreshWords(list === 'mail' ? 'mail' : 'messages'), errorText: () => 'Couldn’t check hasarinda@example.test' });
  return (
    <div>
      <header>{r.checked}</header>
      <div className="relative">
        {r.indicator}
        {r.pill}
        <div ref={r.attach} data-testid="scroller" tabIndex={0} onKeyDown={r.onKeyDown}>
          {rows.map((k) => (
            <div key={k} {...r.rowProps(k)} className={r.freshClass(k)}>
              {k}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function Harness({ check, list }: { check: () => Promise<unknown>; list?: 'mail' | 'chat' }) {
  const [rows, setRows] = useState(['a', 'b']);
  return (
    <>
      <button type="button" onClick={() => setRows((r) => ['n1', 'n2', 'n3', ...r])}>
        arrive
      </button>
      <List check={check} rows={rows} list={list} />
    </>
  );
}

const scrollerOf = () => {
  const el = screen.getByTestId('scroller');
  let st = 0;
  Object.defineProperty(el, 'scrollTop', { configurable: true, get: () => st, set: (v: number) => void (st = v) });
  return el;
};
const indicator = () => document.querySelector('[data-pull-indicator]') as HTMLElement;
const status = () => document.querySelector('[data-pull-status]') as HTMLElement;

describe('the indicator, the words and the live region', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-05T09:00:00Z'));
    localStorage.clear();
    pullPrefs.set({ off: {} });
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    Reflect.deleteProperty(window, 'matchMedia');
  });

  it('↓ Pull, ↑ Release with the arrow turned, the spinner and Checking…, then "3 new", announced politely', async () => {
    let arrive: () => void = () => undefined;
    const check = vi.fn(async () => arrive());
    render(<Harness check={check} />);
    arrive = () => fireEvent.click(screen.getByRole('button', { name: 'arrive' }));
    const el = scrollerOf();
    expect(status().getAttribute('aria-live')).toBe('polite');
    fireEvent.wheel(el, { deltaY: -60 });
    expect(indicator().dataset.pullIndicator).toBe('pulling');
    expect(indicator().textContent).toContain('Pull to check for new mail');
    expect(indicator().style.height).toBe('30px');
    tick(20);
    fireEvent.wheel(el, { deltaY: -100 });
    expect(indicator().textContent).toContain('Release to check');
    expect(indicator().querySelector('svg')!.getAttribute('class')).toContain('rotate-180');
    await act(async () => void (await vi.advanceTimersByTimeAsync(GESTURE_GAP_MS + 1)));
    expect(check).toHaveBeenCalledTimes(1);
    await act(async () => void (await vi.advanceTimersByTimeAsync(SETTLE_MS + 1)));
    expect(indicator().textContent).toContain('3 new');
    expect(status().textContent).toBe('3 new');
    // The new rows slide in, marked.
    const fresh = [...document.querySelectorAll('[data-fresh]')].map((n) => n.textContent);
    expect(fresh).toEqual(['n1', 'n2', 'n3']);
    expect(document.querySelector('[data-refresh-key="n1"]')!.className).toBe(FRESH_CLASS);
    expect(FRESH_CLASS).toContain('motion-safe:animate-');
    await act(async () => void (await vi.advanceTimersByTimeAsync(RESULT_MS + 1)));
    expect(indicator().dataset.pullIndicator).toBe('idle');
    expect(indicator().style.height).toBe('0px');
  });

  it('Checking… during a check; "Up to date · checked just now" after one that brought nothing', async () => {
    let finish: () => void = () => undefined;
    render(<List check={() => new Promise<void>((r) => (finish = r))} rows={['a']} />);
    fireEvent.click(screen.getByRole('button', { name: 'Check now' }));
    expect(indicator().textContent).toContain('Checking for new mail…');
    expect(status().textContent).toBe('Checking for new mail…');
    expect(screen.getByRole('button', { name: 'Checking…' }).getAttribute('aria-busy')).toBe('true');
    await act(async () => {
      finish();
      await vi.advanceTimersByTimeAsync(SETTLE_MS + 1);
    });
    expect(indicator().textContent).toContain('Up to date · checked just now');
    // "Checked just now" under the header, counting on as time passes.
    expect(screen.getByRole('button', { name: 'Checked just now' })).toBeTruthy();
    await act(async () => void (await vi.advanceTimersByTimeAsync(2 * 60_000)));
    expect(screen.getByRole('button', { name: 'Checked 2 min ago' })).toBeTruthy();
  });

  it('the error, with Retry, and the rows still there', async () => {
    const check = vi.fn(async () => {
      throw new Error('no');
    });
    render(<List check={check} rows={['a', 'b']} />);
    fireEvent.keyDown(screen.getByTestId('scroller'), { key: 'F5' });
    await act(async () => void (await vi.advanceTimersByTimeAsync(0)));
    expect(indicator().textContent).toContain('Couldn’t check hasarinda@example.test');
    expect(status().textContent).toBe('Couldn’t check hasarinda@example.test');
    expect(screen.getByText('a')).toBeTruthy();
    fireEvent.click(within(indicator()).getByRole('button', { name: 'Retry' }));
    await act(async () => void (await vi.advanceTimersByTimeAsync(0)));
    expect(check).toHaveBeenCalledTimes(2);
    fireEvent.click(within(indicator()).getByRole('button', { name: 'Close' }));
    expect(indicator().dataset.pullIndicator).toBe('idle');
  });

  it('F5 and ⌘R / Ctrl+R on the list check; other keys do not', async () => {
    const check = vi.fn(async () => undefined);
    render(<List check={check} rows={['a']} />);
    const el = screen.getByTestId('scroller');
    fireEvent.keyDown(el, { key: 'r', ctrlKey: true, shiftKey: true });
    fireEvent.keyDown(el, { key: 'r' });
    expect(check).not.toHaveBeenCalled();
    fireEvent.keyDown(el, { key: 'r', ctrlKey: true });
    expect(check).toHaveBeenCalledTimes(1);
    expect(isCheckKey({ key: 'r', metaKey: true, ctrlKey: false, shiftKey: false, altKey: false }, true)).toBe(true);
    expect(isCheckKey({ key: 'r', metaKey: false, ctrlKey: true, shiftKey: false, altKey: false }, true)).toBe(false);
    expect(isCheckKey({ key: 'F5', metaKey: false, ctrlKey: false, shiftKey: false, altKey: false })).toBe(true);
  });

  it('the pill: "↑ 3 new emails" while scrolled down, to the top on a click, gone at the top', async () => {
    render(<Harness check={async () => undefined} />);
    const el = scrollerOf();
    el.scrollTo = vi.fn() as never;
    el.scrollTop = 200;
    fireEvent.scroll(el);
    fireEvent.click(screen.getByRole('button', { name: 'arrive' }));
    const pill = screen.getByRole('button', { name: '3 new emails: go to the top' });
    expect(pill.textContent).toContain('3 new emails');
    fireEvent.click(pill);
    expect(el.scrollTo).toHaveBeenCalledWith({ top: 0, behavior: 'smooth' });
    expect(screen.queryByRole('button', { name: /new emails: go to the top/ })).toBeNull();
    expect([...document.querySelectorAll('[data-fresh]')].map((n) => n.textContent)).toEqual(['n1', 'n2', 'n3']);
  });

  it('the chat lists say it their way', () => {
    const w = refreshWords('messages');
    expect(w.pull).toBe('Pull to check for new messages');
    expect(w.checking).toBe('Checking for new messages…');
    expect(w.pill(1)).toBe('1 new conversation');
    expect(w.pill(4)).toBe('4 new conversations');
    expect(refreshWords('mail').pill(1)).toBe('1 new email');
  });

  it('with reduced motion: no slide, no bounce — the line keeps one height and only its words change', () => {
    window.matchMedia = ((q: string) => ({ matches: q.includes('reduce'), media: q, addEventListener: () => undefined, removeEventListener: () => undefined })) as never;
    render(<List check={async () => undefined} rows={['a']} />);
    const el = scrollerOf();
    fireEvent.wheel(el, { deltaY: -40 });
    expect(indicator().textContent).toContain('Pull to check for new mail');
    expect(indicator().style.height).toBe('36px');
    expect(indicator().className).not.toContain('transition');
    tick(20);
    fireEvent.wheel(el, { deltaY: -200 });
    expect(indicator().textContent).toContain('Release to check');
    expect(indicator().style.height).toBe('36px');
  });

  it('"Checked…" reads in words', () => {
    const now = Date.parse('2026-10-05T09:00:00Z');
    expect(checkedLabel(null, now)).toBe('Check now');
    expect(checkedLabel(now - 10_000, now)).toBe('Checked just now');
    expect(checkedLabel(now - 120_000, now)).toBe('Checked 2 min ago');
    expect(checkedLabel(now - 3 * 3_600_000, now)).toBe('Checked 3 h ago');
  });
});

describe('the setting: Mail › Appearance & reading › Pull to refresh', () => {
  beforeEach(() => {
    localStorage.clear();
    pullPrefs.set({ off: {} });
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('is on by default, kept on this computer, and turning it off stops the pull only', async () => {
    expect(pullEnabled('mail')).toBe(true);
    setPullEnabled('mail', false);
    expect(pullEnabled('mail')).toBe(false);
    expect(JSON.parse(localStorage.getItem('ws.pullToRefresh')!)).toEqual({ mail: false });
    // The chat lists keep theirs.
    expect(pullEnabled('chat')).toBe(true);
    vi.useFakeTimers();
    const check = vi.fn(async () => undefined);
    render(<List check={check} rows={['a']} />);
    const el = scrollerOf();
    fireEvent.wheel(el, { deltaY: -300 });
    expect(indicator().dataset.pullIndicator).toBe('idle');
    fireEvent.keyDown(el, { key: 'F5' });
    expect(check).toHaveBeenCalledTimes(1);
    setPullEnabled('mail', true);
    expect(localStorage.getItem('ws.pullToRefresh')).toBe('{}');
  });

  it('is a switch in Settings › Mail › Appearance & reading', async () => {
    vi.mocked(apiGet).mockReset().mockImplementation((async (path: string) => {
      if (path === '/api/mail/prefs') return { prefs: {} };
      if (path === '/api/mail/mailboxes') return { mailboxes: [] };
      throw new ApiError(404, path, null);
    }) as never);
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MailSettings query={new URLSearchParams('tab=layout')} />
      </QueryClientProvider>,
    );
    const sw = await screen.findByRole('switch', { name: 'Pull to refresh' });
    expect(sw.getAttribute('aria-checked')).toBe('true');
    fireEvent.click(sw);
    expect(sw.getAttribute('aria-checked')).toBe('false');
    expect(pullEnabled('mail')).toBe(false);
  });
});

// ---- Mail ------------------------------------------------------------------------------------------------------

describe('Mail: the keys', () => {
  it('F5 checks in every scheme; ⌘R / Ctrl+R too, except in Outlook’s, where it is Reply', () => {
    expect(bindings('worksuite').checkMail).toEqual(['F5', 'Mod+R']);
    expect(bindings('gmail').checkMail).toEqual(['F5', 'Mod+R']);
    expect(bindings('outlook').checkMail).toEqual(['F5']);
    expect(commandFor(bindings('outlook'), 'Mod+R', null).id).toBe('reply');
    expect(commandFor(bindings('worksuite'), 'Mod+R', null).id).toBe('checkMail');
    for (const s of ['worksuite', 'outlook', 'gmail'] as const) expect(keyConflicts(bindings(s)).filter((c) => c.key === 'F5' || c.key === 'Mod+R')).toEqual([]);
  });
});

const BOXES = [
  { id: 1, email: 'me@example.test', display_name: 'me', shared: false, unread: 1, in_unified: true, is_default: true, provider: 'imap', provider_label: 'IMAP', colour: 'blue', auth_state: 'ok' },
  { id: 2, email: 'hasarinda@contoso.test', display_name: 'Hasarinda', shared: false, unread: 1, in_unified: true, provider: 'office365', provider_label: 'Microsoft 365', colour: 'indigo', auth_state: 'ok' },
];
const tag = (id: number) => ({ id, email: BOXES[id - 1]!.email, name: 'me', colour: BOXES[id - 1]!.colour });
const msg = (id: number, box: number, over: Partial<MessageRow> = {}) => ({
  id, from_name: `Sender ${id}`, from_email: `s${id}@example.org`, subject: `Subject ${id}`, preview: 'A line', is_read: false, is_starred: false, has_attachment: false,
  created_at: '2026-10-05 08:30:00', mailbox: tag(box), uid_key: `${box}:${id}`, folder_slug: 'inbox', uidvalidity: 11, message_id: `<m${id}@example.test>`, ...over,
});
const ALL_COUNTS = {
  roles: Object.fromEntries(['inbox', 'drafts', 'outbox', 'archive', 'sent', 'snoozed', 'trash', 'junk'].map((r) => [r, { count: 0, kind: 'total', mailboxes: [] }])),
  unknown: [],
  partial: false,
};

let inbox: unknown[] = [];

function MailRoute({ initial }: { initial: string }) {
  const [route, setRoute] = useState(initial);
  return (
    <TabProvider tabId="t" route={route} active onGo={setRoute}>
      <MailPage active tabId="t" route={route} />
    </TabProvider>
  );
}
const showMail = (initial = '/mail') =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MailRoute initial={initial} />
    </QueryClientProvider>,
  );
const folderSyncs = () => vi.mocked(apiPost).mock.calls.filter(([p]) => p === '/api/mail/folder-ops/sync').map(([, b]) => b);

describe('Mail: checking the view on screen', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-05T09:00:00Z'));
    setRegional({ timezone: 'UTC', locale: 'en-GB', timeFormat: '24' });
    localStorage.clear();
    pullPrefs.set({ off: {} });
    toasts.set({ items: [] });
    syncRunner.set({ running: new Set(), all: false, errors: {} });
    inbox = [msg(701, 1, { subject: 'Invoice' }), msg(702, 2, { subject: 'Budget' })];
    app.set({ status: { network: 'ONLINE' } as never, prefs: { mailCacheDays: 30, moduleNotifications: {}, badgeCount: true, theme: 'light' } as never, bootstrap: { user: { id: '9', name: 'Me', email: 'me@example.test' } } as never, apps: [] });
    vi.mocked(apiGet).mockReset().mockImplementation((async (path: string) => {
      if (path === '/api/mail/mailboxes') return { mailboxes: BOXES };
      if (path === '/api/mail/prefs') return { prefs: { firstRun: 'done', focused: false } };
      if (path === '/api/mail/views') return { mailboxes: BOXES.map((b) => ({ id: b.id, unread: b.unread, counted: true })), views: { unread: 2, starred: 0, today: 0, attachments: 0, drafts: 0, important: null, scheduled: 0 }, partial: false, unknown: [] };
      if (path === '/api/mail/views/all/counts') return ALL_COUNTS;
      if (path === '/api/mail/sync/status') return { enabled: true, mailboxes: [], accounts: [], overall: { state: 'up_to_date', syncing: 0, total: 2, last_ok_at: null, failed: [], stale: [], stale_minutes: 60 } };
      throw new ApiError(404, path, null);
    }) as never);
    vi.mocked(apiGetMeta).mockReset().mockImplementation((async (path: string, q?: Record<string, unknown>) => {
      if (path === '/api/mail/views/all/inbox') return { data: { messages: inbox, total: inbox.length, has_more: false, unified: true, role: 'inbox' }, offline: false, cachedAt: null };
      if (path === '/api/mail/messages' && q?.folder === 'inbox') return { data: { messages: inbox.filter((m) => (m as { mailbox: { id: number } }).mailbox.id === 2), total: 1, has_more: false }, offline: false, cachedAt: null };
      throw new ApiError(404, path, null);
    }) as never);
    vi.mocked(apiPost).mockReset().mockResolvedValue({} as never);
    vi.mocked(call).mockReset().mockImplementation((async (channel: string) => (channel === 'offline:pending' ? [] : null)) as never);
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('F5 in All Accounts syncs each account’s Inbox first, then the new mail comes in at the top, lit, with "1 new"', async () => {
    showMail();
    const list = await screen.findByRole('listbox', { name: 'Messages' });
    await within(list).findByText('Budget');
    expect(screen.getByRole('button', { name: 'Check now' })).toBeTruthy();
    inbox = [msg(703, 2, { subject: 'Fresh news', created_at: '2026-10-05 08:59:00' }), ...inbox];
    fireEvent.keyDown(window, { key: 'F5' });
    await waitFor(() => expect(indicator().textContent).toContain('1 new'));
    expect(folderSyncs()).toEqual([{ mailbox: 1, folder: 'inbox' }, { mailbox: 2, folder: 'inbox' }]);
    expect(within(list).getByText('Fresh news')).toBeTruthy();
    const fresh = list.querySelector('[data-fresh]') as HTMLElement;
    expect(fresh.getAttribute('data-refresh-key')).toBe('2:inbox:703');
    expect(screen.getByRole('button', { name: 'Checked just now' })).toBeTruthy();
  });

  it('an account’s Inbox, checked with "Checked…": only that account; a failure names it, with Retry', async () => {
    showMail('/mail?box=2');
    const list = await screen.findByRole('listbox', { name: 'Messages' });
    await within(list).findByText('Budget');
    vi.mocked(apiPost).mockImplementation((async (path: string) => {
      if (path === '/api/mail/folder-ops/sync') throw new ApiError(503, 'The mail server could not be reached.', null);
      return {};
    }) as never);
    fireEvent.click(screen.getByRole('button', { name: 'Check now' }));
    await waitFor(() => expect(indicator().textContent).toContain('Couldn’t check hasarinda@contoso.test'));
    expect(folderSyncs()).toEqual([{ mailbox: 2, folder: 'inbox' }]);
    // The list is still there to use.
    expect(within(list).getByText('Budget')).toBeTruthy();
    vi.mocked(apiPost).mockResolvedValue({} as never);
    fireEvent.click(within(indicator()).getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(indicator().textContent).toContain('Up to date · checked just now'));
    expect(folderSyncs()).toHaveLength(2);
  });

  it('a pull at the top of the mail list checks too', async () => {
    vi.useRealTimers();
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'], shouldAdvanceTime: true });
    showMail();
    const list = await screen.findByRole('listbox', { name: 'Messages' });
    await within(list).findByText('Budget');
    const scroller = list.querySelector('[data-mail-scroll]') as HTMLElement;
    fireEvent.wheel(scroller, { deltaY: -100 });
    tick(20);
    fireEvent.wheel(scroller, { deltaY: -100 });
    expect(indicator().textContent).toContain('Release to check');
    tick(GESTURE_GAP_MS + 1);
    await waitFor(() => expect(folderSyncs()).toHaveLength(2));
  });
});
