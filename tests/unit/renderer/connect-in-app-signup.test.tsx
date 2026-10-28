// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as Bridge from '../../../src/core/bridge';

/**
 * Creating an account inside the app (ENH-AUTH-01 §4): the details, the emailed code, and what the screen does when
 * the server refuses one of them.
 */
const bridge = vi.hoisted(() => ({ call: vi.fn() }));
vi.mock('../../../src/core/bridge', async (orig) => ({ ...(await orig<typeof Bridge>()), call: bridge.call, on: () => () => undefined, hasDesktop: () => true }));

const { InAppSignUp } = await import('../../../src/app/connect/personal/InAppSignUp');

const fill = () => {
  fireEvent.change(screen.getByLabelText('First name'), { target: { value: 'Nimali' } });
  fireEvent.change(screen.getByLabelText('Last name'), { target: { value: 'Perera' } });
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'nimali@example.com' } });
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'a-long-enough-password' } });
  fireEvent.change(screen.getByLabelText('Country'), { target: { value: 'LK' } });
};

beforeEach(() => {
  bridge.call.mockReset();
  bridge.call.mockImplementation(async (channel: string) => (channel === 'signup:start' ? { email: 'nimali@example.com', expiresIn: 3600 } : undefined));
});
afterEach(() => cleanup());

describe('in-app sign-up', () => {
  it('sends the details and then asks for the emailed code', async () => {
    render(<InAppSignUp accountId="acc_abcdefghijklmnopqrst" onBack={() => undefined} />);
    fill();
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    await waitFor(() => expect(screen.getByText('Check your email')).toBeTruthy());
    expect(bridge.call).toHaveBeenCalledWith('signup:start', expect.objectContaining({ email: 'nimali@example.com', country: 'LK', accountId: 'acc_abcdefghijklmnopqrst' }));
    expect(screen.getByText('nimali@example.com')).toBeTruthy();
  });

  it('will not send an incomplete form, or a password under eight characters', () => {
    render(<InAppSignUp accountId="acc_abcdefghijklmnopqrst" onBack={() => undefined} />);
    expect((screen.getByRole('button', { name: 'Continue' }) as HTMLButtonElement).disabled).toBe(true);
    fill();
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'short' } });
    expect((screen.getByRole('button', { name: 'Continue' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('shows the server’s own refusal and stays on the details', async () => {
    bridge.call.mockImplementation(async () => {
      throw new Error('Use an email address you will keep — throwaway addresses cannot be used.');
    });
    render(<InAppSignUp accountId="acc_abcdefghijklmnopqrst" onBack={() => undefined} />);
    fill();
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('throwaway addresses'));
    expect(screen.queryByText('Check your email')).toBeNull();
  });

  it('keeps the code box open after a wrong code, and clears it', async () => {
    render(<InAppSignUp accountId="acc_abcdefghijklmnopqrst" onBack={() => undefined} />);
    fill();
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    await waitFor(() => screen.getByLabelText('Code'));
    bridge.call.mockImplementation(async (channel: string) => {
      if (channel === 'signup:verify') throw new Error('That code is not right. 4 tries left.');
      return undefined;
    });
    fireEvent.change(screen.getByLabelText('Code'), { target: { value: '123456' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create my account' }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('4 tries left'));
    expect((screen.getByLabelText('Code') as HTMLInputElement).value).toBe('');
  });

  it('asks for another code', async () => {
    render(<InAppSignUp accountId="acc_abcdefghijklmnopqrst" onBack={() => undefined} />);
    fill();
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    await waitFor(() => screen.getByLabelText('Code'));
    fireEvent.click(screen.getByRole('button', { name: 'Send another code' }));
    await waitFor(() => expect(bridge.call).toHaveBeenCalledWith('signup:resend', { accountId: 'acc_abcdefghijklmnopqrst' }));
  });

  it('drops the sign-up in the main process when the screen goes', async () => {
    const { unmount } = render(<InAppSignUp accountId="acc_abcdefghijklmnopqrst" onBack={() => undefined} />);
    unmount();
    await waitFor(() => expect(bridge.call).toHaveBeenCalledWith('signup:cancel'));
  });

  it('only takes digits in the code box', async () => {
    render(<InAppSignUp accountId="acc_abcdefghijklmnopqrst" onBack={() => undefined} />);
    fill();
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    await waitFor(() => screen.getByLabelText('Code'));
    fireEvent.change(screen.getByLabelText('Code'), { target: { value: '12ab34' } });
    expect((screen.getByLabelText('Code') as HTMLInputElement).value).toBe('1234');
  });
});
