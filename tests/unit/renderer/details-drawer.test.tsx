// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The shared details drawer (worksuite-desktop#334) — a ticket's details and a website chat's visitor panel: ⌘⇧I /
 * Ctrl+Shift+I and the header button show and hide it, remembered per person; its edge resizes it by drag or arrow
 * keys, between its limits, remembered per person; its sections fold one by one.
 */
vi.mock('../../../src/core/bridge', () => ({ call: vi.fn(), on: () => () => undefined, errorMessage: (e: unknown) => String(e), isMac: false }));

const { app } = await import('../../../src/core/app-state');
const { DetailsDrawer, DrawerSection, DrawerToggle, clampDrawerWidth, drawerChoiceKey, drawerWidthKey, isDrawerShortcut, useDrawer } = await import('../../../src/components/DetailsDrawer');

const signIn = (id: string) =>
  app.set({ auth: { stage: 'ready', server: null, user: { id, name: 'Ayesha', email: 'a@x', avatar: null, timezone: null, locale: null, organizationId: null, organizationName: null, timeFormat: null, weekStart: null }, message: null, setupPending: false } } as never);

function Harness({ active = true, wideAt = 0, legacyKey }: { active?: boolean; wideAt?: number; legacyKey?: string }) {
  const d = useDrawer('demo', { active, wideAt, legacyKey });
  return (
    <div className="relative">
      <DrawerToggle drawer={d} label="the demo details" />
      <DetailsDrawer drawer={d} title="Demo details" label="the demo details">
        <DrawerSection drawer="demo" id="alpha" title="Alpha">
          <p>Alpha body</p>
        </DrawerSection>
      </DetailsDrawer>
    </div>
  );
}

const wide = (w: number) => Object.defineProperty(window, 'innerWidth', { configurable: true, value: w });
const panel = () => screen.queryByRole('complementary', { name: 'Demo details' });
const shortcut = () => fireEvent.keyDown(window, { key: 'I', ctrlKey: true, shiftKey: true });

beforeEach(() => {
  localStorage.clear();
  wide(1440);
  signIn('7');
});
afterEach(() => cleanup());

describe('showing and hiding', () => {
  it('Ctrl+Shift+I toggles it, the header button says whether it is open, and the choice is kept for this person', () => {
    const { unmount } = render(<Harness />);
    expect(panel()).toBeTruthy();
    const header = screen.getAllByRole('button', { name: 'Hide the demo details' })[0]!;
    expect(header.getAttribute('aria-expanded')).toBe('true');
    expect(header.getAttribute('aria-controls')).toBe(panel()!.id);
    expect(header.getAttribute('aria-keyshortcuts')).toBe('Control+Shift+I');
    shortcut();
    expect(panel()).toBeNull();
    expect(localStorage.getItem(drawerChoiceKey('demo', '7'))).toBe('closed');
    // Its strip and the header button both bring it back.
    const shows = screen.getAllByRole('button', { name: 'Show the demo details' });
    expect(shows).toHaveLength(2);
    expect(shows.every((b) => b.getAttribute('aria-expanded') === 'false')).toBe(true);
    unmount();
    // Opened again later: still hidden for this person …
    const again = render(<Harness />);
    expect(panel()).toBeNull();
    again.unmount();
    // … but not for somebody else signed in on this computer.
    signIn('8');
    render(<Harness />);
    expect(panel()).toBeTruthy();
  });

  it('answers the shortcut only while its tab is in front, and only the exact chord', () => {
    render(<Harness active={false} />);
    shortcut();
    expect(panel()).toBeTruthy();
    expect(isDrawerShortcut({ key: 'I', code: 'KeyI', ctrlKey: true, shiftKey: true, metaKey: false, altKey: false }, false)).toBe(true);
    expect(isDrawerShortcut({ key: 'I', code: 'KeyI', ctrlKey: true, shiftKey: true, metaKey: false, altKey: true }, false)).toBe(false);
    expect(isDrawerShortcut({ key: 'i', code: 'KeyI', ctrlKey: false, shiftKey: true, metaKey: true, altKey: false }, true)).toBe(true);
    expect(isDrawerShortcut({ key: 'i', code: 'KeyI', ctrlKey: true, shiftKey: true, metaKey: false, altKey: false }, true)).toBe(false);
  });

  it('takes a choice made before choices were per person', () => {
    localStorage.setItem('ws.panel.demo', '0');
    render(<Harness legacyKey="ws.panel.demo" />);
    expect(panel()).toBeNull();
  });

  it('on a narrow window opens over the content only when asked, and Esc closes it', () => {
    wide(1000);
    render(<Harness wideAt={1280} />);
    expect(panel()).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Show the demo details' }));
    expect(panel()).toBeTruthy();
    expect(document.querySelector('[data-drawer-scrim]')).toBeTruthy();
    fireEvent.keyDown(panel()!, { key: 'Escape' });
    expect(panel()).toBeNull();
    // Nothing kept: a narrow window asks each time.
    expect(localStorage.getItem(drawerChoiceKey('demo', '7'))).toBeNull();
  });
});

describe('its width', () => {
  const width = () => Number(panel()!.style.width.replace('px', ''));
  const edge = () => screen.getByRole('separator', { name: 'Resize the demo details' });

  it('moves with the arrow keys on its edge, kept between its limits and for this person', () => {
    render(<Harness />);
    expect(width()).toBe(320);
    expect(edge().getAttribute('aria-valuemin')).toBe('280');
    expect(edge().getAttribute('aria-valuemax')).toBe('520');
    // The edge is on the left: ← makes it wider, → narrower; Shift for bigger steps.
    fireEvent.keyDown(edge(), { key: 'ArrowLeft' });
    expect(width()).toBe(336);
    fireEvent.keyDown(edge(), { key: 'ArrowRight', shiftKey: true });
    expect(width()).toBe(280);
    fireEvent.keyDown(edge(), { key: 'ArrowRight' });
    expect(width()).toBe(280);
    fireEvent.keyDown(edge(), { key: 'End' });
    expect(width()).toBe(520);
    fireEvent.keyDown(edge(), { key: 'ArrowLeft', shiftKey: true });
    expect(width()).toBe(520);
    expect(localStorage.getItem(drawerWidthKey('demo', '7'))).toBe('520');
  });

  it('leaves the content its room in a narrow window, and a stored width out of range is clamped', () => {
    localStorage.setItem(drawerWidthKey('demo', '7'), '2000');
    render(<Harness />);
    expect(width()).toBe(520);
    act(() => {
      wide(900);
      window.dispatchEvent(new Event('resize'));
    });
    expect(width()).toBe(340);
    expect(edge().getAttribute('aria-valuemax')).toBe('340');
    expect(clampDrawerWidth(100, 1440)).toBe(280);
    expect(clampDrawerWidth(400, 1440)).toBe(400);
    expect(clampDrawerWidth(900, 1440)).toBe(520);
    expect(clampDrawerWidth(900, 700)).toBe(280);
  });
});

describe('its sections', () => {
  it('fold one by one with aria-expanded, remembered for this person', () => {
    const { unmount } = render(<Harness />);
    const alpha = screen.getByRole('region', { name: 'Alpha' });
    const head = within(alpha).getByRole('button', { name: 'Alpha' });
    expect(head.getAttribute('aria-expanded')).toBe('true');
    fireEvent.click(head);
    expect(head.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByText('Alpha body')).toBeNull();
    unmount();
    render(<Harness />);
    expect(within(screen.getByRole('region', { name: 'Alpha' })).getByRole('button', { name: 'Alpha' }).getAttribute('aria-expanded')).toBe('false');
  });
});
