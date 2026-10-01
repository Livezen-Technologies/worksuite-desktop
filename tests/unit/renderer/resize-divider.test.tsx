// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ResizeDivider, useResizableWidth } from '../../../src/components/ResizeDivider';

/**
 * The chat list's divider (worksuite-desktop#34): drag, keys, double-click, limits, and a width remembered on this
 * computer.
 */
function Panel({ max = 560 }: { max?: number | (() => number) }) {
  const list = useResizableWidth('test.list', { defaultWidth: 300, min: 240, max });
  return (
    <aside data-testid="panel" style={{ width: list.width }}>
      <ResizeDivider state={list} label="Resize the list" />
    </aside>
  );
}

const width = () => Number(screen.getByRole('separator').getAttribute('aria-valuenow'));
const stored = () => localStorage.getItem('ws.width.test.list');

// jsdom has no PointerEvent: without one the button and coordinates never reach the handler.
vi.stubGlobal('PointerEvent', class extends MouseEvent { pointerId = 1; });

beforeEach(() => localStorage.clear());
afterEach(cleanup);

describe('ResizeDivider', () => {
  it('opens at the default, with its limits announced', () => {
    render(<Panel />);
    const sep = screen.getByRole('separator', { name: 'Resize the list' });
    expect(width()).toBe(300);
    expect(sep.getAttribute('aria-valuemin')).toBe('240');
    expect(sep.getAttribute('aria-valuemax')).toBe('560');
    expect(sep.getAttribute('aria-orientation')).toBe('vertical');
    expect(sep.tabIndex).toBe(0);
    expect(sep.className).toContain('cursor-col-resize');
    expect(screen.getByTestId('panel').style.width).toBe('300px');
  });

  it('moves with the arrow keys, further with Shift, to the limits with Home and End', () => {
    render(<Panel />);
    const sep = screen.getByRole('separator');
    fireEvent.keyDown(sep, { key: 'ArrowRight' });
    expect(width()).toBe(316);
    fireEvent.keyDown(sep, { key: 'ArrowLeft', shiftKey: true });
    expect(width()).toBe(252);
    fireEvent.keyDown(sep, { key: 'ArrowLeft' });
    expect(width()).toBe(240); // not below the minimum
    fireEvent.keyDown(sep, { key: 'End' });
    expect(width()).toBe(560);
    fireEvent.keyDown(sep, { key: 'ArrowRight', shiftKey: true });
    expect(width()).toBe(560); // not above the maximum
    fireEvent.keyDown(sep, { key: 'Home' });
    expect(width()).toBe(240);
    expect(stored()).toBe('240');
  });

  it('follows a drag and stores the width when it ends', () => {
    render(<Panel />);
    const sep = screen.getByRole('separator');
    fireEvent.pointerDown(sep, { button: 0, clientX: 300, pointerId: 1 });
    expect(document.body.style.cursor).toBe('col-resize');
    fireEvent.pointerMove(sep, { clientX: 380, pointerId: 1 });
    expect(width()).toBe(380);
    expect(stored()).toBeNull(); // only once the drag ends
    fireEvent.pointerMove(sep, { clientX: 1200, pointerId: 1 });
    expect(width()).toBe(560);
    fireEvent.pointerMove(sep, { clientX: 420, pointerId: 1 });
    fireEvent.pointerUp(sep, { clientX: 420, pointerId: 1 });
    expect(width()).toBe(420);
    expect(stored()).toBe('420');
    expect(document.body.style.cursor).toBe('');
  });

  it('ignores a right-button press', () => {
    render(<Panel />);
    const sep = screen.getByRole('separator');
    fireEvent.pointerDown(sep, { button: 2, clientX: 300, pointerId: 1 });
    fireEvent.pointerMove(sep, { clientX: 400, pointerId: 1 });
    expect(width()).toBe(300);
  });

  it('goes back to the default on a double-click or Enter, and forgets the stored width', () => {
    render(<Panel />);
    const sep = screen.getByRole('separator');
    fireEvent.keyDown(sep, { key: 'End' });
    expect(stored()).toBe('560');
    fireEvent.doubleClick(sep);
    expect(width()).toBe(300);
    expect(stored()).toBeNull();
    fireEvent.keyDown(sep, { key: 'Home' });
    fireEvent.keyDown(sep, { key: 'Enter' });
    expect(width()).toBe(300);
    expect(stored()).toBeNull();
  });

  it('opens at the width remembered from last time, kept within the limits', () => {
    localStorage.setItem('ws.width.test.list', '444');
    render(<Panel />);
    expect(width()).toBe(444);
    cleanup();
    localStorage.setItem('ws.width.test.list', '9999');
    render(<Panel />);
    expect(width()).toBe(560);
    cleanup();
    localStorage.setItem('ws.width.test.list', 'nonsense');
    render(<Panel />);
    expect(width()).toBe(300);
  });

  it('narrows when the window leaves less room, and widens again when it grows', () => {
    let room = 560;
    localStorage.setItem('ws.width.test.list', '500');
    render(<Panel max={() => room} />);
    expect(width()).toBe(500);
    room = 400;
    act(() => void window.dispatchEvent(new Event('resize')));
    expect(width()).toBe(400);
    expect(screen.getByRole('separator').getAttribute('aria-valuemax')).toBe('400');
    room = 560;
    act(() => void window.dispatchEvent(new Event('resize')));
    expect(width()).toBe(500);
  });
});
