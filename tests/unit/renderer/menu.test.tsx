// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { useRef, useState } from 'react';
import { Menu, type MenuSection } from '../../../src/components/Menu';
import { setLanguage } from '../../../src/core/i18n';

const width = window.innerWidth;
afterEach(() => {
  cleanup();
  Object.defineProperty(window, 'innerWidth', { value: width, configurable: true });
  setLanguage('en');
  document.documentElement.dir = 'ltr';
});

function sections(on: { record: () => void; grid: () => void; lock?: () => void }): MenuSection[] {
  return [
    {
      id: 'tools',
      label: 'Meeting Tools',
      items: [
        { id: 'rec', icon: 'film', label: 'Start Recording', description: 'On the server', onSelect: on.record },
        {
          id: 'layout',
          icon: 'grid',
          label: 'Layout',
          submenu: [
            {
              id: 'l',
              items: [
                { id: 'auto', label: 'Auto', radio: true, checked: true, onSelect: vi.fn() },
                { id: 'grid', label: 'Grid', radio: true, checked: false, onSelect: on.grid },
              ],
            },
          ],
        },
      ],
    },
    {
      id: 'host',
      label: 'Host Controls',
      items: [
        { id: 'lock', icon: 'lock', label: 'Lock Meeting', disabled: !on.lock, reason: 'Only hosts can lock the meeting', onSelect: on.lock },
        { id: 'full', icon: 'fullscreen', label: 'Enter Full Screen', shortcut: 'F11', onSelect: vi.fn() },
      ],
    },
  ];
}

function Harness({ menu }: { menu: MenuSection[] }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  return (
    <div>
      <button type="button">Elsewhere</button>
      <button ref={ref} type="button" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}>
        More
      </button>
      {open ? <Menu sections={menu} label="More" anchor={ref} onClose={() => setOpen(false)} /> : null}
    </div>
  );
}

const key = (k: string) => fireEvent.keyDown(document.activeElement!, { key: k });
const description = (el: HTMLElement) => document.getElementById(el.getAttribute('aria-describedby') ?? '')?.textContent ?? '';
const focused = () => document.activeElement as HTMLElement;

function openMenu(menu: MenuSection[]) {
  render(<Harness menu={menu} />);
  fireEvent.click(screen.getByRole('button', { name: 'More' }));
  return screen.getByRole('menu', { name: 'More' });
}

describe('Menu', () => {
  it('groups items under headings with separators, roles and the state on the right', () => {
    const menu = openMenu(sections({ record: vi.fn(), grid: vi.fn() }));
    const groups = within(menu).getAllByRole('group');
    expect(groups.map((g) => g.getAttribute('aria-labelledby') && document.getElementById(g.getAttribute('aria-labelledby')!)?.textContent)).toEqual(['Meeting Tools', 'Host Controls']);
    expect(within(menu).getAllByRole('separator')).toHaveLength(1);
    const rec = within(menu).getByRole('menuitem', { name: /Start Recording/ });
    expect(description(rec)).toBe('On the server');
    expect(within(menu).getByRole('menuitem', { name: /Layout/ }).getAttribute('aria-haspopup')).toBe('menu');
    expect(within(menu).getByRole('menuitem', { name: /Enter Full Screen/ }).textContent).toContain('F11');
  });

  it('keeps an unavailable item in view, says why, and does nothing when chosen', () => {
    const menu = openMenu(sections({ record: vi.fn(), grid: vi.fn() }));
    const lock = within(menu).getByRole('menuitem', { name: /Lock Meeting/ });
    expect(lock.getAttribute('aria-disabled')).toBe('true');
    expect(description(lock)).toBe('Only hosts can lock the meeting');
    fireEvent.click(lock);
    expect(screen.getByRole('menu', { name: 'More' })).toBeTruthy();
  });

  it('focuses the first item, moves with the arrows (wrapping), Home, End and typeahead', () => {
    openMenu(sections({ record: vi.fn(), grid: vi.fn() }));
    expect(focused().textContent).toContain('Start Recording');
    key('ArrowDown');
    expect(focused().textContent).toContain('Layout');
    key('End');
    expect(focused().textContent).toContain('Enter Full Screen');
    key('ArrowDown');
    expect(focused().textContent).toContain('Start Recording');
    key('ArrowUp');
    expect(focused().textContent).toContain('Enter Full Screen');
    key('Home');
    expect(focused().textContent).toContain('Start Recording');
    key('l');
    expect(focused().textContent).toContain('Layout');
    key('l');
    expect(focused().textContent).toContain('Lock Meeting');
  });

  it('opens a submenu with ArrowRight, closes it with ArrowLeft or Escape back on its item, and chooses with Enter', () => {
    const grid = vi.fn();
    openMenu(sections({ record: vi.fn(), grid }));
    key('ArrowDown');
    key('ArrowRight');
    const sub = screen.getByRole('menu', { name: 'Layout' });
    expect(screen.getByRole('menuitem', { name: /Layout/ }).getAttribute('aria-expanded')).toBe('true');
    expect(focused().textContent).toContain('Auto');
    expect(within(sub).getByRole('menuitemradio', { name: 'Auto' }).getAttribute('aria-checked')).toBe('true');
    key('ArrowLeft');
    expect(screen.queryByRole('menu', { name: 'Layout' })).toBeNull();
    expect(focused().textContent).toContain('Layout');
    key('Enter');
    expect(focused().textContent).toContain('Auto');
    key('Escape');
    expect(screen.queryByRole('menu', { name: 'Layout' })).toBeNull();
    expect(screen.getByRole('menu', { name: 'More' })).toBeTruthy();
    key(' ');
    key('ArrowDown');
    key('Enter');
    expect(grid).toHaveBeenCalledOnce();
    expect(screen.queryByRole('menu')).toBeNull();
    expect(focused().textContent).toContain('More');
  });

  it('opens a submenu by hovering its item and closes it on hovering another', () => {
    openMenu(sections({ record: vi.fn(), grid: vi.fn() }));
    fireEvent.mouseEnter(screen.getByRole('menuitem', { name: /Layout/ }));
    expect(screen.getByRole('menu', { name: 'Layout' })).toBeTruthy();
    // Hovering opens it without taking focus into it.
    expect(focused().textContent).toContain('Layout');
    fireEvent.mouseEnter(screen.getByRole('menuitem', { name: /Start Recording/ }));
    expect(screen.queryByRole('menu', { name: 'Layout' })).toBeNull();
  });

  it('mirrors the submenu arrows right to left', () => {
    document.documentElement.dir = 'rtl';
    openMenu(sections({ record: vi.fn(), grid: vi.fn() }));
    key('ArrowDown');
    key('ArrowRight');
    expect(screen.queryByRole('menu', { name: 'Layout' })).toBeNull();
    key('ArrowLeft');
    expect(screen.getByRole('menu', { name: 'Layout' })).toBeTruthy();
    key('ArrowRight');
    expect(screen.queryByRole('menu', { name: 'Layout' })).toBeNull();
  });

  it('closes on Escape and gives focus back to the button', () => {
    openMenu(sections({ record: vi.fn(), grid: vi.fn() }));
    key('Escape');
    expect(screen.queryByRole('menu')).toBeNull();
    expect(focused()).toBe(screen.getByRole('button', { name: 'More' }));
    expect(screen.getByRole('button', { name: 'More' }).getAttribute('aria-expanded')).toBe('false');
  });

  it('closes on Tab, back on the button', () => {
    openMenu(sections({ record: vi.fn(), grid: vi.fn() }));
    key('Tab');
    expect(screen.queryByRole('menu')).toBeNull();
    expect(focused()).toBe(screen.getByRole('button', { name: 'More' }));
  });

  it('closes on a click outside, but not on a click inside', () => {
    openMenu(sections({ record: vi.fn(), grid: vi.fn() }));
    fireEvent.mouseDown(screen.getByRole('menuitem', { name: /Layout/ }));
    expect(screen.getByRole('menu', { name: 'More' })).toBeTruthy();
    fireEvent.mouseDown(screen.getByRole('button', { name: 'Elsewhere' }));
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('runs the action after closing and handing focus back (a dialog it opens returns there)', () => {
    const order: string[] = [];
    const record = vi.fn(() => order.push(`record:${(document.activeElement as HTMLElement).textContent}`));
    openMenu(sections({ record, grid: vi.fn() }));
    fireEvent.click(screen.getByRole('menuitem', { name: /Start Recording/ }));
    expect(order).toEqual(['record:More']);
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('caps its height to the room and scrolls inside', () => {
    openMenu(sections({ record: vi.fn(), grid: vi.fn() }));
    const panel = screen.getByRole('menu', { name: 'More' }).parentElement!;
    expect(panel.className).toContain('overflow-y-auto');
    expect(panel.style.maxHeight).not.toBe('');
    expect(panel.style.visibility).toBe('visible');
  });

  it('is a bottom sheet in a narrow window, with submenus drilling in and a Back row', () => {
    Object.defineProperty(window, 'innerWidth', { value: 420, configurable: true });
    const grid = vi.fn();
    openMenu(sections({ record: vi.fn(), grid }));
    const sheet = document.querySelector('[data-menu-sheet]')!;
    expect(sheet).not.toBeNull();
    expect(sheet.className).toContain('bottom-0');
    expect(within(sheet as HTMLElement).getByRole('menu', { name: 'More' })).toBeTruthy();
    expect(focused().textContent).toContain('Start Recording');
    fireEvent.click(screen.getByRole('menuitem', { name: /Layout/ }));
    expect(screen.getByRole('menu', { name: 'Layout' })).toBeTruthy();
    expect(screen.queryByRole('menu', { name: 'More' })).toBeNull();
    expect(focused().textContent).toContain('Auto');
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByRole('menu', { name: 'More' })).toBeTruthy();
    expect(focused().textContent).toContain('Layout');
    key('Enter');
    key('Escape');
    expect(screen.getByRole('menu', { name: 'More' })).toBeTruthy();
    key('Escape');
    expect(screen.queryByRole('menu')).toBeNull();
    expect(focused()).toBe(screen.getByRole('button', { name: 'More' }));
  });

  it('switches to the sheet when the window is narrowed while open', () => {
    openMenu(sections({ record: vi.fn(), grid: vi.fn() }));
    expect(document.querySelector('[data-menu-sheet]')).toBeNull();
    act(() => {
      Object.defineProperty(window, 'innerWidth', { value: 500, configurable: true });
      window.dispatchEvent(new Event('resize'));
    });
    expect(document.querySelector('[data-menu-sheet]')).not.toBeNull();
  });

  it('wraps long translated labels instead of running out of the menu', () => {
    setLanguage('ta');
    const long = 'கூட்டத்தின் பதிவை இந்தக் கணினியில் தொடங்கி பின்னர் உங்கள் இயக்ககத்தில் பதிவேற்று';
    openMenu([{ id: 's', label: 'கூட்டக் கருவிகள்', items: [{ id: 'a', label: long, description: long, shortcut: 'F11', onSelect: vi.fn() }] }]);
    const item = screen.getByRole('menuitem', { name: long });
    const labelBox = item.querySelector('span.flex-1')!;
    expect(labelBox.className).toContain('min-w-0');
    expect(labelBox.className).toContain('[overflow-wrap:anywhere]');
    expect(item.querySelector('kbd')!.className).toContain('shrink-0');
  });
});
