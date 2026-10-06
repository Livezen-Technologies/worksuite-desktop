// @vitest-environment jsdom
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { contentSpan, Toasts } from '../../../src/app/overlays/Toasts';
import { dismiss, toast, toasts } from '../../../src/core/toasts';

/**
 * Where toasts appear (worksuite-desktop#259, #263): bottom-centre above the status bar, over the content — never
 * over the sidebar, a module's own menu (the website chats menu with its "Taking chats" card at the foot) or
 * anything else you navigate with, and not under a drawer docked on the right.
 */
function box(el: HTMLElement, left: number, right: number): HTMLElement {
  el.getBoundingClientRect = () => ({ left, right, width: right - left, top: 0, bottom: 800, height: right > left ? 800 : 0, x: left, y: 0, toJSON: () => null });
  document.body.appendChild(el);
  return el;
}
function panel(left: number, right: number, id: string): HTMLElement {
  const el = document.createElement('div');
  el.setAttribute('data-side-panel', id);
  return box(el, left, right);
}

afterEach(() => {
  for (const t of toasts.get().items) dismiss(t.id);
  cleanup();
  document.body.innerHTML = '';
});

describe('the toast stack', () => {
  it('centres over the content: right of the rail and the module menu, left of a right panel and the drawer', () => {
    const rail = document.createElement('nav');
    rail.setAttribute('aria-label', 'Apps');
    box(rail, 0, 220);
    const work = document.createElement('div');
    work.setAttribute('data-ai-workspace', '');
    box(work, 220, 1180); // the AI drawer is docked right of 1180
    panel(220, 480, 'website-chats'); // its "Taking chats · 2 open" card sits at its foot
    panel(0, 0, 'mail'); // a tab in the background: no size
    panel(900, 1180, 'website-visitor'); // the visitor details on the right
    expect(contentSpan()).toEqual({ left: 480, right: 900 });

    render(<Toasts />);
    act(() => toast('info', 'Saved.'));
    const stack = document.querySelector('[data-toast-stack]') as HTMLElement;
    expect(stack.style.left).toBe('690px');
    expect(stack.style.width).toBe('388px');
    expect(stack.className).toContain('-translate-x-1/2');
    expect(stack.className).toContain('bottom-[96px]');
    // Never wider than the content, so it cannot reach over the menu.
    const row = stack.querySelector('[data-toast]') as HTMLElement;
    expect(row.className).toContain('max-w-[min(440px,100%)]');
    expect(row.className).toContain('min-w-[min(280px,100%)]');
  });

  it('with no module menu, centres between the rail and the window’s edge', () => {
    const rail = document.createElement('nav');
    rail.setAttribute('aria-label', 'Apps');
    box(rail, 0, 64);
    expect(contentSpan()).toEqual({ left: 64, right: window.innerWidth });
  });
});
