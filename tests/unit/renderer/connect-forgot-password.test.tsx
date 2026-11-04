// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as Bridge from '../../../src/core/bridge';

/** Forgot password inside the app: the address, the emailed code with a new password, then back to sign-in. */
const bridge = vi.hoisted(() => ({ call: vi.fn() }));
vi.mock('../../../src/core/bridge', async (orig) => ({ ...(await orig<typeof Bridge>()), call: bridge.call, on: () => () => undefined, hasDesktop: () => true }));

const { ForgotPassword } = await import('../../../src/app/connect/personal/ForgotPassword');
const ID = 'acc_abcdefghijklmnopqrst';

describe('ForgotPassword', () => {
  beforeEach(() => bridge.call.mockReset());
  afterEach(cleanup);

  it('sends a code, then sets the new password with it', async () => {
    bridge.call.mockResolvedValue({});
    const onBack = vi.fn();
    render(<ForgotPassword accountId={ID} prefill="nimali@example.com" onBack={onBack} />);
    fireEvent.click(screen.getByRole('button', { name: 'Send code' }));
    await waitFor(() => screen.getByLabelText('Code'));
    expect(bridge.call).toHaveBeenCalledWith('recover:send', { accountId: ID, email: 'nimali@example.com' });

    const change = () => screen.getByRole('button', { name: 'Change password' }) as HTMLButtonElement;
    fireEvent.change(screen.getByLabelText('Code'), { target: { value: '12a3456' } });
    fireEvent.change(screen.getByLabelText('New password'), { target: { value: 'a long new password' } });
    fireEvent.change(screen.getByLabelText('Confirm new password'), { target: { value: 'something else' } });
    expect(change().disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Confirm new password'), { target: { value: 'a long new password' } });
    expect(change().disabled).toBe(false);
    fireEvent.click(change());
    await waitFor(() => screen.getByText('Password changed'));
    expect(bridge.call).toHaveBeenCalledWith('recover:reset', { accountId: ID, email: 'nimali@example.com', code: '123456', password: 'a long new password' });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(onBack).toHaveBeenCalledWith(true);
  });

  it('shows the server’s reason for a wrong code and stays on the step', async () => {
    bridge.call.mockImplementation(async (ch: string) => {
      if (ch === 'recover:reset') throw new Error('That code is not right, or it has expired.');
      return {};
    });
    render(<ForgotPassword accountId={ID} prefill="nimali@example.com" onBack={() => undefined} />);
    fireEvent.click(screen.getByRole('button', { name: 'Send code' }));
    await waitFor(() => screen.getByLabelText('Code'));
    fireEvent.change(screen.getByLabelText('Code'), { target: { value: '000000' } });
    fireEvent.change(screen.getByLabelText('New password'), { target: { value: 'a long new password' } });
    fireEvent.change(screen.getByLabelText('Confirm new password'), { target: { value: 'a long new password' } });
    fireEvent.click(screen.getByRole('button', { name: 'Change password' }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/not right/));
    expect(screen.getByLabelText('Code')).toBeTruthy();
  });
});
