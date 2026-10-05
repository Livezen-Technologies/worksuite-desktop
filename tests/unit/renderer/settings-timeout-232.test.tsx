// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Preferences } from '../../../shared/types';
const bridge = vi.hoisted(() => ({ call: vi.fn() }));
vi.mock('../../../src/core/bridge', () => ({ call: bridge.call, hasDesktop: () => true, on: () => () => {}, isMac: false, errorMessage: (e: Error) => e.message }));
vi.mock('../../../src/core/tab-context', () => ({ useTab: () => ({ navigate: vi.fn() }), useTabTitle: () => {} }));
const { app } = await import('../../../src/core/app-state');
const { SecuritySection } = await import('../../../src/modules/settings/SettingsPage');
const { minutesInWords, timeoutMinutes } = await import('../../../src/modules/settings/CustomTimeout');
const { NumberField } = await import('../../../src/components/ui');
const { useStore } = await import('../../../src/core/store');

let prefs: Preferences;
beforeEach(() => {
  bridge.call.mockReset();
  prefs = { appLockEnabled: true, appLockMinutes: 600, lockOnSystemLock: true, lockOnSleep: true } as Preferences;
  app.set({ prefs, locks: [], bootstrap: null, lock: null });
  bridge.call.mockImplementation(async (_: string, patch?: Partial<Preferences>) => {
    prefs = { ...prefs, ...patch };
    return { preferences: prefs, locks: [] };
  });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

/** SecuritySection as Settings renders it: with the preferences the store holds. */
function Security() {
  const p = useStore(app, (s) => s.prefs)!;
  return <SecuritySection prefs={p} />;
}

const field = () => screen.getByRole('spinbutton', { name: 'Timeout in minutes' }) as HTMLInputElement;
const save = () => screen.getByRole('button', { name: /^Save/ }) as HTMLButtonElement;

describe('Settings › Security › Custom timeout (#232)', () => {
  it('is one row without a "Minutes" label: "min" inside the field, the hours in the help text', () => {
    render(<SecuritySection prefs={prefs} />);
    expect(screen.queryByText('Minutes')).toBeNull();
    expect(screen.getByText('Custom timeout')).toBeTruthy();
    const input = field();
    expect(input.value).toBe('600');
    expect(input.getAttribute('inputmode')).toBe('numeric');
    expect(input.getAttribute('aria-valuemin')).toBe('1');
    expect(input.getAttribute('aria-valuemax')).toBe('1440');
    expect(input.className).toContain('text-right');
    expect(input.className).toContain('tabular-nums');
    expect(input.parentElement?.className).toContain('h-10');
    expect(input.parentElement?.textContent).toBe('min');
    expect(save().className).toContain('!h-10');
    // The field and Save share one line, centred, 8px apart.
    expect(input.closest('form')?.className).toMatch(/items-center.*gap-2|gap-2.*items-center/);
    expect(screen.getByText('Whole minutes from 1 to 1440 · 10 hours')).toBeTruthy();
    expect(input.getAttribute('aria-describedby')).toBeTruthy();
  });

  it('updates the hours as the number changes', () => {
    render(<SecuritySection prefs={prefs} />);
    fireEvent.change(field(), { target: { value: '90' } });
    expect(screen.getByText('Whole minutes from 1 to 1440 · 1 h 30 min')).toBeTruthy();
    fireEvent.change(field(), { target: { value: '1440' } });
    expect(screen.getByText('Whole minutes from 1 to 1440 · 24 hours')).toBeTruthy();
    expect(minutesInWords(1)).toBe('1 minute');
    expect(minutesInWords(45)).toBe('45 minutes');
    expect(minutesInWords(60)).toBe('1 hour');
    expect(minutesInWords(600)).toBe('10 hours');
  });

  it('blocks values outside 1–1440 or not whole', () => {
    render(<SecuritySection prefs={prefs} />);
    for (const bad of ['0', '1441', '2.5', '', 'abc', '-3']) {
      fireEvent.change(field(), { target: { value: bad } });
      expect(field().getAttribute('aria-invalid')).toBe('true');
      expect(field().className).toContain('border-danger');
      expect(screen.getByText('Enter a whole number from 1 to 1440')).toBeTruthy();
      expect(save().disabled).toBe(true);
      fireEvent.submit(field().closest('form')!);
      fireEvent.blur(field());
    }
    expect(bridge.call).not.toHaveBeenCalled();
    expect(timeoutMinutes('1', 1440)).toBe(1);
    expect(timeoutMinutes('1440', 1440)).toBe(1440);
    expect(timeoutMinutes('1e2', 1440)).toBeNull();
    expect(timeoutMinutes('50', 30)).toBeNull();
  });

  it('follows an organization limit', () => {
    app.set({ bootstrap: { policy: { app_lock_max_minutes: 120 } } as never });
    render(<SecuritySection prefs={{ ...prefs, appLockMinutes: 90 }} />);
    expect(field().getAttribute('aria-valuemax')).toBe('120');
    fireEvent.change(field(), { target: { value: '121' } });
    expect(screen.getByText('Enter a whole number from 1 to 120')).toBeTruthy();
  });

  it('enables Save only on a change; Enter saves and "Saved ✓" shows for 2 seconds', async () => {
    render(<Security />);
    expect(save().disabled).toBe(true);
    fireEvent.change(field(), { target: { value: '600' } });
    expect(save().disabled).toBe(true);
    fireEvent.change(field(), { target: { value: '45' } });
    expect(save().disabled).toBe(false);
    vi.useFakeTimers({ shouldAdvanceTime: true });
    fireEvent.submit(field().closest('form')!);
    expect(bridge.call).toHaveBeenCalledWith('settings:set', { appLockMinutes: 45 });
    await waitFor(() => expect(save().textContent).toBe('Saved ✓'));
    expect(save().disabled).toBe(true);
    expect(screen.getByRole('status').textContent).toBe('Saved');
    // Leaving the field after saving does not send it again.
    fireEvent.blur(field());
    expect(bridge.call).toHaveBeenCalledTimes(1);
    await act(async () => void vi.advanceTimersByTime(2100));
    expect(save().textContent).toBe('Save');
  });

  it('saves a valid change when the field is left, as the neighbouring controls save as they change', async () => {
    render(<SecuritySection prefs={prefs} />);
    fireEvent.change(field(), { target: { value: '30' } });
    fireEvent.blur(field());
    expect(bridge.call).toHaveBeenCalledWith('settings:set', { appLockMinutes: 30 });
    await waitFor(() => expect(save().textContent).toBe('Saved ✓'));
  });

  it('keeps the number when saving fails', async () => {
    bridge.call.mockRejectedValueOnce(new Error('Offline'));
    render(<SecuritySection prefs={prefs} />);
    fireEvent.change(field(), { target: { value: '30' } });
    fireEvent.click(save());
    await waitFor(() => expect(save().disabled).toBe(false));
    expect(field().value).toBe('30');
    expect(save().textContent).toBe('Save');
  });

  it('steps with the arrow keys within 1–1440', () => {
    render(<SecuritySection prefs={{ ...prefs, appLockMinutes: 1439 }} />);
    fireEvent.keyDown(field(), { key: 'ArrowUp' });
    expect(field().value).toBe('1440');
    fireEvent.keyDown(field(), { key: 'ArrowUp' });
    expect(field().value).toBe('1440');
    fireEvent.change(field(), { target: { value: '1' } });
    fireEvent.keyDown(field(), { key: 'ArrowDown' });
    expect(field().value).toBe('1');
    fireEvent.keyDown(field(), { key: 'ArrowUp' });
    expect(field().value).toBe('2');
  });

  it('stacks the controls under the help text when the pane is narrow', () => {
    render(<SecuritySection prefs={prefs} />);
    const row = field().closest('form')!.parentElement!;
    expect(row.parentElement?.className).toContain('@container');
    expect(row.className).toMatch(/\bflex-col\b/);
    expect(row.className).toContain('items-start');
    expect(row.className).toMatch(/@\[\d+px\]:flex-row/);
  });

  it('only shows for a custom timeout', () => {
    render(<SecuritySection prefs={{ ...prefs, appLockMinutes: 15 }} />);
    expect(screen.queryByRole('spinbutton', { name: 'Timeout in minutes' })).toBeNull();
  });
});

describe('NumberField', () => {
  function Harness({ initial = '', step = 1, min, max }: { initial?: string; step?: number; min?: number; max?: number }) {
    const [v, setV] = useState(initial);
    return <NumberField aria-label="n" value={v} onValueChange={setV} step={step} min={min} max={max} unit="kg" />;
  }
  it('steps decimals without float noise and starts an empty field at its minimum', () => {
    render(<Harness initial="0.1" step={0.1} />);
    const input = screen.getByRole('spinbutton', { name: 'n' }) as HTMLInputElement;
    fireEvent.keyDown(input, { key: 'ArrowUp' });
    fireEvent.keyDown(input, { key: 'ArrowUp' });
    expect(input.value).toBe('0.3');
    expect(input.getAttribute('inputmode')).toBe('decimal');
    cleanup();
    render(<Harness min={5} max={10} />);
    const empty = screen.getByRole('spinbutton', { name: 'n' }) as HTMLInputElement;
    fireEvent.keyDown(empty, { key: 'ArrowUp' });
    expect(empty.value).toBe('5');
  });
  it('lets the caller handle a key first', () => {
    const onKeyDown = vi.fn((e: { preventDefault: () => void }) => e.preventDefault());
    render(<NumberField aria-label="n" value="3" onValueChange={vi.fn()} onKeyDown={onKeyDown} />);
    fireEvent.keyDown(screen.getByRole('spinbutton', { name: 'n' }), { key: 'ArrowUp' });
    expect(onKeyDown).toHaveBeenCalled();
  });
});
