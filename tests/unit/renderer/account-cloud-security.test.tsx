// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as Bridge from '../../../src/core/bridge';

/** My account › Security on a personal account: Cloud's two-step verification, every change behind the password. */
const bridge = vi.hoisted(() => ({ call: vi.fn() }));
vi.mock('../../../src/core/bridge', async (orig) => ({ ...(await orig<typeof Bridge>()), call: bridge.call, on: () => () => undefined, hasDesktop: () => true }));
vi.mock('../../../src/core/toasts', () => ({ toast: vi.fn() }));

const { default: CloudSecurity } = await import('../../../src/modules/account/CloudSecurity');

describe('CloudSecurity', () => {
  beforeEach(() => {
    bridge.call.mockReset();
    bridge.call.mockImplementation(async (ch: string) => {
      if (ch === 'cloud:twoStep') return { enabled: false, enabledAt: null, recoveryCodesLeft: 0 };
      if (ch === 'cloud:twoStepStart') return { secret: 'JBSWY3DPEHPK3PXP', uri: 'otpauth://totp/WorkSuite%20Cloud:ann?secret=JBSWY3DPEHPK3PXP' };
      if (ch === 'cloud:twoStepConfirm') return { enabled: true, enabledAt: '2026-11-04T12:00:00Z', recoveryCodesLeft: 10, recoveryCodes: ['aaaa-bbbb', 'cccc-dddd'] };
      return undefined;
    });
  });
  afterEach(cleanup);

  it('asks for the password, shows the key to scan, and the recovery codes once it is on', async () => {
    render(<CloudSecurity />);
    fireEvent.click(await screen.findByRole('button', { name: 'Turn on two-step verification' }));
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'my password' } });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    await waitFor(() => expect(bridge.call).toHaveBeenCalledWith('cloud:twoStepStart', { password: 'my password' }));
    expect(await screen.findByText('JBSWY3DPEHPK3PXP')).toBeTruthy();
  });
});
