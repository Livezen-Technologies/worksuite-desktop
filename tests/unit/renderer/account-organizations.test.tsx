// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as Bridge from '../../../src/core/bridge';

/** My account › Organizations: invitations waiting for a Personal account, joined or declined from the app. */
const bridge = vi.hoisted(() => ({ call: vi.fn() }));
vi.mock('../../../src/core/bridge', async (orig) => ({ ...(await orig<typeof Bridge>()), call: bridge.call, on: () => () => undefined, hasDesktop: () => true }));
vi.mock('../../../src/core/toasts', () => ({ toast: vi.fn() }));

const { default: Organizations } = await import('../../../src/modules/account/Organizations');

describe('Organizations', () => {
  let list: { invitations: unknown[]; joinable: unknown[] };
  beforeEach(() => {
    list = { invitations: [{ id: '7', organization: 'Acme Ltd', role: 'MEMBER', invitedBy: 'Kamal', expiresAt: null }], joinable: [] };
    bridge.call.mockReset();
    bridge.call.mockImplementation(async (ch: string) => {
      if (ch === 'cloud:invitations') return list;
      if (ch === 'cloud:acceptInvitation') {
        list = { invitations: [], joinable: [] };
        return { id: '42', name: 'Acme Ltd' };
      }
      return undefined;
    });
  });
  afterEach(cleanup);

  it('lists an invitation and joins it', async () => {
    render(<Organizations />);
    await waitFor(() => screen.getByText('Acme Ltd'));
    expect(screen.getByText(/invited by Kamal/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Join Acme Ltd' }));
    await waitFor(() => expect(bridge.call).toHaveBeenCalledWith('cloud:acceptInvitation', { id: '7' }));
    await waitFor(() => screen.getByText(/No invitations right now/));
  });

  it('declines an invitation', async () => {
    render(<Organizations />);
    await waitFor(() => screen.getByText('Acme Ltd'));
    fireEvent.click(screen.getByRole('button', { name: 'Decline' }));
    await waitFor(() => expect(bridge.call).toHaveBeenCalledWith('cloud:declineInvitation', { id: '7' }));
  });
});
