// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { useRef, useState } from 'react';
import { Menu, type MenuSection } from '../../../src/components/Menu';
import { ContextMenu } from '../../../src/components/ContextMenu';
import { AVOID_REACH, MENU_GAP, MENU_MARGIN, placeMenu } from '../../../src/components/menuPlacement';
import { SortMenu } from '../../../src/modules/mail/SortMenu';
import { viewMenuSections } from '../../../src/modules/mail/MessageList';

/**
 * worksuite-desktop#208: every dropdown, select and right-click menu opens
 * where it was asked — under its button, right edges lined up, 6px below,
 * flipped above when short of room, 8px inside the window, scrolling inside —
 * the chosen option never looks like the focused one, and the View menu is
 * short, consistent and keyboard-driven.
 */

const viewport = { width: 1200, height: 800 };
const W = { width: viewport.width, height: viewport.height };

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  Object.defineProperty(window, 'innerWidth', { value: 1024, configurable: true });
  Object.defineProperty(window, 'innerHeight', { value: 768, configurable: true });
});

function setWindow(w: number, h: number) {
  Object.defineProperty(window, 'innerWidth', { value: w, configurable: true });
  Object.defineProperty(window, 'innerHeight', { value: h, configurable: true });
}

/** Elements report the rectangle their inline style (or data-rect) gives them; the rest are 0×0. */
function layout(rects: Record<string, { left: number; top: number; width: number; height: number }>) {
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    const el = this as HTMLElement;
    const named = el.dataset?.rect ? rects[el.dataset.rect] : undefined;
    const r = named ?? (el.style?.position === 'fixed' && el.style.width === '1px' ? { left: parseFloat(el.style.left), top: parseFloat(el.style.top), width: 1, height: 1 } : { left: 0, top: 0, width: 0, height: 0 });
    return { ...r, x: r.left, y: r.top, right: r.left + r.width, bottom: r.top + r.height, toJSON: () => ({}) } as DOMRect;
  });
}

describe('one menu geometry (menuPlacement)', () => {
  const button = { left: 900, top: 60, width: 40, height: 32 };

  it('opens directly below its button, right edges aligned, 6px between', () => {
    const p = placeMenu({ trigger: button, menu: { width: 264, height: 300 }, viewport, prefer: 'bottom', align: 'end' });
    expect(MENU_GAP).toBe(6);
    expect(p.side).toBe('bottom');
    expect(p.top).toBe(60 + 32 + 6);
    expect(p.left + 264).toBe(940);
  });

  it('flips above the button when there is no room below', () => {
    const low = { ...button, top: 700 };
    const p = placeMenu({ trigger: low, menu: { width: 264, height: 300 }, viewport, prefer: 'bottom', align: 'end' });
    expect(p.side).toBe('top');
    expect(p.top + 300).toBe(700 - 6);
  });

  it('stays at least 8px inside the window', () => {
    expect(MENU_MARGIN).toBe(8);
    const edge = placeMenu({ trigger: { left: 4, top: 60, width: 30, height: 30 }, menu: { width: 264, height: 100 }, viewport, prefer: 'bottom', align: 'end' });
    expect(edge.left).toBe(8);
    const right = placeMenu({ trigger: { left: 1190, top: 60, width: 30, height: 30 }, menu: { width: 264, height: 100 }, viewport, prefer: 'bottom', align: 'start' });
    expect(right.left).toBe(1200 - 8 - 264);
  });

  it('is no taller than the room it has, and scrolls inside past that', () => {
    const p = placeMenu({ trigger: { left: 500, top: 380, width: 40, height: 32 }, menu: { width: 264, height: 2000 }, viewport, prefer: 'bottom', align: 'end' });
    expect(p.side).toBe('bottom');
    expect(p.maxHeight).toBe(800 - (380 + 32) - 6 - 8);
  });

  it('ignores an `avoid` area that is a whole panel header rather than the trigger’s own toolbar (the View menu’s bug)', () => {
    // The list header: title row, search box, tabs and chips — 150px below the button.
    const header = { left: 600, top: 48, width: 420, height: 200 };
    const p = placeMenu({ trigger: button, menu: { width: 264, height: 300 }, viewport, prefer: 'bottom', align: 'end', avoid: header });
    expect(p.top).toBe(98);
    // A toolbar the button sits in is still kept clear.
    const bar = { left: 600, top: 52, width: 420, height: 48 };
    expect(placeMenu({ trigger: button, menu: { width: 264, height: 300 }, viewport, prefer: 'bottom', align: 'end', avoid: bar }).top).toBe(52 + 48 + 6);
    expect(AVOID_REACH).toBeGreaterThanOrEqual(32);
  });
});

describe('menus in the page', () => {
  function Dropdown({ sections, width = 264 }: { sections: MenuSection[]; width?: number }) {
    const [open, setOpen] = useState(false);
    const ref = useRef<HTMLButtonElement>(null);
    return (
      <>
        <button ref={ref} data-rect="view" type="button" aria-haspopup="menu" onClick={() => setOpen(!open)}>
          View
        </button>
        {open ? <Menu sections={sections} label="View" anchor={ref} prefer="bottom" align="end" width={width} onClose={() => setOpen(false)} /> : null}
      </>
    );
  }

  it('draws the dropdown under its own button, right-aligned, 6px below — not over the list', () => {
    setWindow(W.width, W.height);
    layout({ view: { left: 900, top: 60, width: 40, height: 32 } });
    render(<Dropdown sections={[{ id: 's', items: [{ id: 'a', label: 'A', onSelect: vi.fn() }] }]} />);
    fireEvent.click(screen.getByRole('button', { name: 'View' }));
    const panel = screen.getByRole('menu', { name: 'View' }).parentElement!;
    expect(panel.style.top).toBe('98px');
    expect(parseFloat(panel.style.left) + 264).toBe(940);
    expect(panel.className).toContain('overflow-y-auto');
    expect(panel.style.maxHeight).toBe(`${800 - 92 - 6 - 8}px`);
  });

  it('opens a right-click menu at the pointer, and flips it up near the bottom', () => {
    setWindow(W.width, W.height);
    layout({});
    const { unmount } = render(<ContextMenu x={300} y={200} label="Message" sections={[{ id: 's', items: [{ id: 'a', label: 'Open', onSelect: vi.fn() }] }]} onClose={vi.fn()} />);
    const panel = screen.getByRole('menu', { name: 'Message' }).parentElement!;
    expect(panel.style.left).toBe('300px');
    expect(panel.style.top).toBe('201px');
    unmount();
    // Near the bottom of the window the menu ends at the pointer instead.
    vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockReturnValue(120);
    render(<ContextMenu x={300} y={790} label="Message" sections={[{ id: 's', items: [{ id: 'a', label: 'Open', onSelect: vi.fn() }] }]} onClose={vi.fn()} />);
    const up = screen.getByRole('menu', { name: 'Message' }).parentElement!;
    expect(up.dataset.side).toBe('top');
    expect(up.style.top).toBe(`${790 - 120}px`);
  });

  it('opens the sort menu by the same geometry: under its button, right edges lined up', () => {
    setWindow(W.width, W.height);
    layout({ sort: { left: 900, top: 60, width: 40, height: 32 } });
    function Sort() {
      const ref = useRef<HTMLButtonElement>(null);
      return (
        <>
          <button ref={ref} data-rect="sort" type="button">
            Sort
          </button>
          <SortMenu anchor={ref} prefs={{}} conversations={false} onPrefs={vi.fn()} onConversations={vi.fn()} onClose={vi.fn()} />
        </>
      );
    }
    render(<Sort />);
    const menu = screen.getByRole('menu', { name: 'Sort and group' });
    expect(menu.style.top).toBe('98px');
    expect(parseFloat(menu.style.left) + 260).toBe(940);
  });
});

describe('selected is not focused', () => {
  const sections: MenuSection[] = [
    {
      id: 'density',
      label: 'Density',
      items: [
        { id: 'classic', label: 'Classic', radio: true, checked: false, onSelect: vi.fn() },
        { id: 'compact', label: 'Compact', radio: true, checked: true, onSelect: vi.fn() },
      ],
    },
  ];

  function Harness() {
    const [open, setOpen] = useState(false);
    const ref = useRef<HTMLButtonElement>(null);
    return (
      <>
        <button ref={ref} type="button" onClick={() => setOpen(true)}>
          View
        </button>
        {open ? <Menu sections={sections} label="View" anchor={ref} prefer="bottom" align="end" onClose={() => setOpen(false)} /> : null}
      </>
    );
  }

  it('shows the chosen option with a tick and accent text, and focus and hover as a light background only', () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'View' }));
    const classic = screen.getByRole('menuitemradio', { name: 'Classic' });
    const compact = screen.getByRole('menuitemradio', { name: 'Compact' });
    // The chosen one: tick, accent text; never the selection background.
    expect(compact.className).toContain('text-primary');
    expect(compact.querySelector('svg')).not.toBeNull();
    expect(compact.className).not.toMatch(/(^|\s)(focus:)?bg-selection/);
    // Not chosen: no tick, plain text; focus is the light background.
    expect(classic.className).not.toContain('text-primary');
    expect(classic.querySelector('svg')).toBeNull();
    for (const el of [classic, compact]) {
      expect(el.className).toContain('focus:bg-subtle');
      expect(el.className).toContain('hover:bg-subtle');
    }
    // Opening focuses the chosen option, so the highlight and the tick are on the same row.
    expect(document.activeElement).toBe(compact);
  });

  it('draws the sort menu’s chosen sort the same way', () => {
    function Sort() {
      const ref = useRef<HTMLButtonElement>(null);
      return (
        <>
          <button ref={ref} type="button">
            Sort
          </button>
          <SortMenu anchor={ref} prefs={{ sort: 'date' }} conversations={false} onPrefs={vi.fn()} onConversations={vi.fn()} onClose={vi.fn()} />
        </>
      );
    }
    render(<Sort />);
    const menu = screen.getByRole('menu', { name: 'Sort and group' });
    const date = within(within(menu).getByRole('group', { name: 'Sort by' })).getByRole('menuitemradio', { name: 'Date' });
    const sender = within(within(menu).getByRole('group', { name: 'Sort by' })).getByRole('menuitemradio', { name: 'Sender' });
    expect(date.className).toContain('text-primary');
    expect(date.className).not.toMatch(/(^|\s)bg-selection/);
    expect(sender.className).toContain('focus:bg-subtle');
  });
});

describe('the View menu', () => {
  const onPrefs = vi.fn();
  const onConversations = vi.fn();
  const onViewSettings = vi.fn();
  const sections = () => viewMenuSections({ prefs: { view: 'compact', pane: 'right' }, onPrefs, conversations: false, onConversations, onViewSettings });

  it('is short: density, the reading pane as one segmented row, conversations, and a link to the rest', () => {
    const s = sections();
    expect(s.map((x) => x.id)).toEqual(['density', 'pane', 'conversations', 'more']);
    expect(s.find((x) => x.id === 'pane')).toMatchObject({ segmented: true });
    expect(s.find((x) => x.id === 'pane')!.items.map((i) => i.label)).toEqual(['Right', 'Below', 'Hidden']);
    // The action bar lives in Settings › Mail › Appearance & reading now.
    expect(s.some((x) => x.id === 'toolbar')).toBe(false);
    // Icons on every option or on none: none.
    expect(s.flatMap((x) => x.items).filter((i) => i.icon)).toHaveLength(0);
  });

  function ViewMenu() {
    const [open, setOpen] = useState(false);
    const ref = useRef<HTMLButtonElement>(null);
    return (
      <>
        <button ref={ref} type="button" onClick={() => setOpen(!open)}>
          Layout and density
        </button>
        {open ? <Menu sections={sections()} label="Layout and density" anchor={ref} prefer="bottom" align="end" width={264} onClose={() => setOpen(false)} /> : null}
      </>
    );
  }

  it('moves with the arrows, chooses with Enter, and Esc closes it with focus back on the button', () => {
    render(<ViewMenu />);
    const button = screen.getByRole('button', { name: 'Layout and density' });
    fireEvent.click(button);
    expect((document.activeElement as HTMLElement).textContent).toContain('Compact');
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' });
    expect((document.activeElement as HTMLElement).textContent).toContain('Super compact');
    fireEvent.keyDown(document.activeElement!, { key: 'Enter' });
    expect(onPrefs).toHaveBeenCalledWith({ view: 'super' });
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(button);

    fireEvent.click(button);
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(button);
  });

  it('walks the segmented reading pane with Left and Right, and opens Settings from its link', () => {
    render(<ViewMenu />);
    fireEvent.click(screen.getByRole('button', { name: 'Layout and density' }));
    const right = screen.getByRole('menuitemradio', { name: 'Right' });
    expect(right.getAttribute('aria-checked')).toBe('true');
    expect(right.className).toContain('text-primary');
    right.focus();
    fireEvent.keyDown(right, { key: 'ArrowRight' });
    expect(document.activeElement).toBe(screen.getByRole('menuitemradio', { name: 'Below' }));
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowLeft' });
    expect(document.activeElement).toBe(right);
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowLeft' });
    expect(document.activeElement).toBe(screen.getByRole('menuitemradio', { name: 'Hidden' }));
    fireEvent.keyDown(document.activeElement!, { key: 'Enter' });
    expect(onPrefs).toHaveBeenCalledWith({ pane: 'hidden' });
    fireEvent.click(screen.getByRole('button', { name: 'Layout and density' }));
    fireEvent.click(screen.getByRole('menuitem', { name: /More view settings/ }));
    expect(onViewSettings).toHaveBeenCalled();
  });
});
