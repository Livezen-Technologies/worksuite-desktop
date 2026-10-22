// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { DEFAULT_BUTTON_LAYOUT, parseButtonLayout } from '@shared/window-controls';

/**
 * The window's own buttons on Linux (worksuite-desktop#409): GNOME's button layout read from gsettings, the title
 * bar's minimise / maximise-restore / close, and where the system's drawn-over controls still need room.
 */
const bridge = vi.hoisted(() => ({
  call: vi.fn(async (channel: string): Promise<unknown> => (channel === 'windows:state' ? { maximized: false, buttonLayout: { side: 'right', buttons: ['minimize', 'maximize', 'close'] } } : undefined)),
  listeners: new Map<string, (v: unknown) => void>(),
}));
vi.mock('../../../src/core/bridge', () => ({
  call: bridge.call,
  on: (channel: string, fn: (v: unknown) => void) => {
    bridge.listeners.set(channel, fn);
    return () => bridge.listeners.delete(channel);
  },
  isMac: false,
  platform: 'linux',
}));

const { useWindowButtons, WindowControls } = await import('../../../src/components/WindowControls');
const { insetFor } = await import('../../../src/core/window-chrome');

afterEach(() => {
  cleanup();
  bridge.call.mockClear();
});

describe('GNOME button layout (#409)', () => {
  it('reads the gsettings value, quoted as it prints it', () => {
    expect(parseButtonLayout("'appmenu:minimize,maximize,close'\n")).toEqual({ side: 'right', buttons: ['minimize', 'maximize', 'close'] });
    expect(parseButtonLayout("'close,minimize,maximize:'")).toEqual({ side: 'left', buttons: ['close', 'minimize', 'maximize'] });
    // Zorin OS and stock GNOME ship close only; other entries are skipped.
    expect(parseButtonLayout("'appmenu:close'")).toEqual({ side: 'right', buttons: ['close'] });
    expect(parseButtonLayout("'icon,menu:spacer,minimize,close'")).toEqual({ side: 'right', buttons: ['minimize', 'close'] });
  });

  it('falls back to minimise, maximise, close on the right, and honours buttons turned off', () => {
    expect(parseButtonLayout('')).toEqual(DEFAULT_BUTTON_LAYOUT);
    expect(parseButtonLayout(null)).toEqual(DEFAULT_BUTTON_LAYOUT);
    expect(parseButtonLayout('No such schema “org.gnome.desktop.wm.preferences”')).toEqual(DEFAULT_BUTTON_LAYOUT);
    expect(parseButtonLayout("':'")).toEqual({ side: 'right', buttons: [] });
  });
});

describe('the title bar\'s window buttons (#409)', () => {
  function Bar() {
    const { layout, maximized } = useWindowButtons();
    return layout ? <WindowControls layout={layout} maximized={maximized} /> : null;
  }

  it('draws them in order, out of the drag region, and maximises, restores, minimises and closes', async () => {
    render(<Bar />);
    const group = await screen.findByTestId('window-controls');
    expect(group.className).toContain('no-drag');
    expect([...group.querySelectorAll('button')].map((b) => b.getAttribute('aria-label'))).toEqual(['Minimize', 'Maximize', 'Close']);
    for (const b of group.querySelectorAll('button')) {
      expect(b.className).toContain('shrink-0');
      expect((b as HTMLElement).style.width).toBe('32px');
    }

    fireEvent.click(screen.getByLabelText('Maximize'));
    expect(bridge.call).toHaveBeenCalledWith('windows:toggleMaximize');
    act(() => bridge.listeners.get('window:maximized')?.(true));
    fireEvent.click(screen.getByLabelText('Restore'));
    fireEvent.click(screen.getByLabelText('Minimize'));
    fireEvent.click(screen.getByLabelText('Close'));
    expect(bridge.call).toHaveBeenCalledWith('windows:minimize');
    expect(bridge.call).toHaveBeenCalledWith('windows:close');
  });

  it('draws nothing where the system draws them, or the desktop shows none', async () => {
    bridge.call.mockImplementationOnce(async () => ({ maximized: false }));
    const { container } = render(<Bar />);
    await act(async () => undefined);
    expect(container.innerHTML).toBe('');
    render(<WindowControls layout={{ side: 'right', buttons: [] }} maximized={false} />);
    expect(screen.queryByTestId('window-controls')).toBeNull();
  });

  it('keeps room for drawn-over controls on Windows, none on Linux or macOS', () => {
    expect(insetFor('win32')).toBe(150);
    expect(insetFor('linux')).toBe(0);
    expect(insetFor('darwin')).toBe(0);
    expect(insetFor('browser')).toBe(150);
  });
});
