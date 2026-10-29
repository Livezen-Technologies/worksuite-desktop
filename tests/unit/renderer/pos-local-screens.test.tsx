// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as Bridge from '../../../src/core/bridge';

/*
 * The screens an offline till needs that the server-backed POS has no equivalent for: setting the till up,
 * signing in to it, and opening the register. Selling itself is the module's own Register screen.
 */
const bridge = vi.hoisted(() => ({ call: vi.fn() }));
vi.mock('../../../src/core/bridge', async (orig) => ({ ...(await orig<typeof Bridge>()), call: bridge.call, on: () => () => undefined, hasDesktop: () => true }));

const { FirstRun } = await import('../../../src/modules/pos/local/FirstRun');
const { SignIn } = await import('../../../src/modules/pos/local/SignIn');
const { RegisterClosed } = await import('../../../src/modules/pos/local/RegisterClosed');
const { screenFor, parseMoney, money } = await import('../../../src/modules/pos/local/state');

const state = (over: Record<string, unknown> = {}) => ({ empty: false, signedIn: { id: 'posu_1', username: 'sunil', displayName: 'Sunil', role: 'owner', suspended: false, createdAt: '', lastSignInAt: null, lockedUntil: null }, mustChangePassword: false, permissions: ['sell', 'open_register'], ...over }) as never;

beforeEach(() => bridge.call.mockReset());
afterEach(() => cleanup());

describe('which screen the till is on', () => {
  it('follows what the main process says, and nothing else', () => {
    expect(screenFor(null, false)).toBe('loading');
    expect(screenFor(state({ empty: true, signedIn: null }), false)).toBe('first-run');
    expect(screenFor(state({ signedIn: null }), false)).toBe('sign-in');
    expect(screenFor(state({ mustChangePassword: true }), true)).toBe('change-password');
    expect(screenFor(state(), false)).toBe('closed');
    expect(screenFor(state(), true)).toBe('selling');
  });
});

describe('money a person types', () => {
  it('takes what a shop types and refuses what it cannot be', () => {
    expect(parseMoney('10')).toBe(1000);
    expect(parseMoney('10.5')).toBe(1050);
    expect(parseMoney('10.55')).toBe(1055);
    expect(parseMoney('')).toBeNull();
    expect(parseMoney('10.555')).toBeNull();
    expect(parseMoney('abc')).toBeNull();
  });

  it('writes it back the way a receipt reads', () => {
    expect(money(1150)).toBe('11.50');
    expect(money(100000)).toBe('1,000.00');
    expect(money(-250)).toBe('-2.50');
  });
});

describe('setting the till up', () => {
  it('will not open until the passwords match and are long enough', () => {
    render(<FirstRun onDone={() => undefined} />);
    const open = () => screen.getByRole('button', { name: 'Open the till' }) as HTMLButtonElement;
    expect(open().disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'sunil' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'till-of-the-day' } });
    expect(open().disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Password again'), { target: { value: 'till-of-the-day' } });
    expect(open().disabled).toBe(false);
  });

  it('makes the first person the owner', async () => {
    bridge.call.mockResolvedValue({});
    render(<FirstRun onDone={() => undefined} />);
    fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'Sunil' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'till-of-the-day' } });
    fireEvent.change(screen.getByLabelText('Password again'), { target: { value: 'till-of-the-day' } });
    fireEvent.click(screen.getByRole('button', { name: 'Open the till' }));
    await waitFor(() => expect(bridge.call).toHaveBeenCalledWith('posLocal:addUser', expect.objectContaining({ username: 'sunil', role: 'owner' })));
  });
});

describe('signing in', () => {
  it('says how long a held account is held, rather than repeating “wrong”', async () => {
    const until = new Date(Date.now() + 5 * 60_000).toISOString();
    bridge.call.mockResolvedValue({ refused: 'locked', lockedUntil: until });
    render(<SignIn onDone={() => undefined} />);
    fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'sunil' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'whatever' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/Too many wrong passwords/));
  });

  it('clears the password after a refusal', async () => {
    bridge.call.mockResolvedValue({ refused: 'wrong' });
    render(<SignIn onDone={() => undefined} />);
    fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'sunil' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'nope' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    expect((screen.getByLabelText('Password') as HTMLInputElement).value).toBe('');
  });
});

describe('opening the register', () => {
  it('opens with what was counted, in cents', async () => {
    bridge.call.mockResolvedValue({});
    render(<RegisterClosed state={state()} onDone={() => undefined} />);
    fireEvent.change(screen.getByLabelText('Cash in the drawer'), { target: { value: '100.00' } });
    fireEvent.click(screen.getByRole('button', { name: 'Open the register' }));
    await waitFor(() => expect(bridge.call).toHaveBeenCalledWith('posLocal:openRegister', { float: 10_000 }));
  });

  it('will not let somebody open it who may not', () => {
    render(<RegisterClosed state={state({ permissions: ['sell'] })} onDone={() => undefined} />);
    expect((screen.getByRole('button', { name: 'Open the register' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/has to start the day/)).toBeTruthy();
  });
});
