// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LockState } from '@shared/ipc/contract';

vi.mock('../../../src/core/bridge', () => ({ call: vi.fn(), on: () => () => undefined, hasDesktop: () => true, errorMessage: (e: unknown) => (e instanceof Error ? e.message : String(e)), isMac: true, platform: 'darwin' }));

const { call } = await import('../../../src/core/bridge');
const { app } = await import('../../../src/core/app-state');
const { LockScreen } = await import('../../../src/app/screens/LockScreen');

const LOCK: LockState = { locked: true, reason: 'timeout', since: '2026-09-30T10:00:00Z', biometric: 'touch-id', pin: true, pinLength: 4, userName: 'Amal Perera', userEmail: 'amal@example.com', lockMinutes: 15 };

/** The unlock the main process answers, held until the test lets it go. */
function pending() {
  type Answer = { ok: boolean; message: string | null };
  let answer: (v: Answer) => void = () => undefined;
  const unlocking = (ch: string) => (ch === 'security:unlockPin' || ch === 'security:unlockPassword' ? new Promise<Answer>((r) => (answer = r)) : Promise.resolve(null));
  vi.mocked(call).mockImplementation(unlocking as unknown as typeof call);
  return (v: { ok: boolean; message: string | null }) => act(async () => answer(v));
}
const pinCalls = () => vi.mocked(call).mock.calls.filter(([ch]) => ch === 'security:unlockPin');
const field = () => screen.getByLabelText('PIN') as HTMLInputElement;
const type = (value: string) => fireEvent.change(field(), { target: { value } });

beforeEach(() => {
  vi.mocked(call).mockReset();
  app.set({ lock: LOCK });
});
afterEach(cleanup);

describe('the lock screen with a PIN (#74)', () => {
  it('has the PIN field focused as soon as it appears, masked', () => {
    render(<LockScreen />);
    expect(document.activeElement).toBe(field());
    expect(field().type).toBe('password');
    expect(field().maxLength).toBe(4);
  });

  it('checks the PIN on its last digit — no Unlock click — once, saying Unlocking… meanwhile', async () => {
    const answer = pending();
    render(<LockScreen />);
    for (const v of ['4', '48', '482']) type(v);
    expect(pinCalls()).toHaveLength(0);
    type('4821');
    expect(pinCalls()).toEqual([['security:unlockPin', { pin: '4821' }]]);
    const button = screen.getByRole('button', { name: 'Unlocking…' });
    expect(button).toHaveProperty('disabled', true);
    expect(field().readOnly).toBe(true);
    // Nothing more goes while it is being checked: not a keystroke, not Enter.
    type('48219');
    fireEvent.submit(field().form!);
    expect(pinCalls()).toHaveLength(1);
    await answer({ ok: true, message: null });
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('takes a pasted PIN, spaces and all', () => {
    pending();
    render(<LockScreen />);
    type(' 48 21 ');
    expect(pinCalls()).toEqual([['security:unlockPin', { pin: '4821' }]]);
  });

  it('says a wrong PIN is wrong in the main process’s words, empties the field and puts the cursor back', async () => {
    const answer = pending();
    render(<LockScreen />);
    type('4822');
    await answer({ ok: false, message: 'That PIN is not right (1 of 5).' });
    expect(screen.getByRole('alert').textContent).toBe('That PIN is not right (1 of 5).');
    expect(field().value).toBe('');
    expect(field().readOnly).toBe(false);
    expect(field().getAttribute('aria-invalid')).toBe('true');
    expect(document.activeElement).toBe(field());
    // And the next try goes too.
    type('4821');
    expect(pinCalls()).toHaveLength(2);
  });

  it('shows why when the check could not be made, and lets the person try again', async () => {
    vi.mocked(call).mockRejectedValueOnce(new Error('Too many requests; slow down.'));
    render(<LockScreen />);
    type('4821');
    await act(async () => undefined);
    expect(screen.getByRole('alert').textContent).toBe('Too many requests; slow down.');
    expect(field().value).toBe('');
    expect(document.activeElement).toBe(field());
  });

  it('waits for Unlock when the PIN’s length is not known yet (set before it was kept)', () => {
    pending();
    app.set({ lock: { ...LOCK, pinLength: null } });
    render(<LockScreen />);
    type('482159');
    expect(pinCalls()).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: 'Unlock' }));
    expect(pinCalls()).toEqual([['security:unlockPin', { pin: '482159' }]]);
  });

  it('keeps Touch ID, the password and Sign out on hand; a password is never sent on its own', () => {
    pending();
    render(<LockScreen />);
    expect(screen.getByRole('button', { name: /Use Touch ID/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Sign out instead' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Use password instead' }));
    const pw = screen.getByLabelText('WorkSuite password') as HTMLInputElement;
    expect(document.activeElement).toBe(pw);
    fireEvent.change(pw, { target: { value: '4821' } });
    expect(vi.mocked(call).mock.calls).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: 'Unlock' }));
    expect(vi.mocked(call).mock.calls).toEqual([['security:unlockPassword', { password: '4821' }]]);
  });
});
