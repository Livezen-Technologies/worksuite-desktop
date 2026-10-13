// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { run } from './accounts-fixtures';
import type * as Bridge from '../../../src/core/bridge';

/**
 * Screen 6 — Connect to your organization (WP4): an address or a work email, https only, Scan Server QR Code; a setup
 * link is read and its server named before anything connects; Continue starts the checks (screen 7).
 */
const bridge = vi.hoisted(() => ({ call: vi.fn() }));
vi.mock('../../../src/core/bridge', async (orig) => ({ ...(await orig<typeof Bridge>()), call: bridge.call, on: () => () => undefined, hasDesktop: () => true }));
vi.mock('../../../src/core/toasts', () => ({ toast: vi.fn() }));
vi.mock('jsqr', () => ({ default: vi.fn(() => null) }));

const { DesktopError } = await import('../../../src/core/bridge');
const { app } = await import('../../../src/core/app-state');
const { EnterpriseAddress, addressProblem, guessHost, isSetupLink } = await import('../../../src/app/connect/EnterpriseAddress');

const LINK = 'worksuite://setup?d=eyJ2IjoyfQ&s=c2ln';

beforeEach(() => {
  bridge.call.mockReset();
  bridge.call.mockImplementation(async (channel: string) => {
    if (channel === 'connect:start') return { runId: 'run_abcdefgh' };
    if (channel === 'connect:get') return run({ runId: 'run_abcdefgh', input: 'https://worksuite.livezentech.com', host: 'worksuite.livezentech.com' });
    if (channel === 'connect:parseSetup') return { payload: { v: 2, server_url: 'https://worksuite.livezentech.com', server_id: 'x', name: 'Livezen Technologies', exp: 9e9 } };
    return undefined;
  });
  app.set({ connect: null, auth: null, session: { mode: 'account', signingIn: false, moveOffer: false, adding: { step: 'enterprise' } } });
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: vi.fn(() => Promise.reject(new Error('no camera'))) } });
});
afterEach(() => cleanup());

const field = () => screen.getByLabelText('WorkSuite server') as HTMLInputElement;

describe('address rules', () => {
  it('takes https addresses, bare hosts, work emails and setup links; refuses plain http', () => {
    expect(addressProblem('https://worksuite.company.com')).toBeNull();
    expect(addressProblem('erp.company.lk')).toBeNull();
    expect(addressProblem('you@company.com')).toBeNull();
    expect(addressProblem(LINK)).toBeNull();
    expect(addressProblem('http://worksuite.company.com')).toMatch(/Only https/);
    expect(addressProblem('ftp://x.com')).toMatch(/Only https/);
    expect(addressProblem('')).toMatch(/Enter/);
    expect(addressProblem('you@company')).toMatch(/email/);
    expect(addressProblem('http://localhost:8920')).toBeNull();
    expect(isSetupLink(LINK)).toBe(true);
    expect(guessHost('you@company.com')).toBe('company.com');
    expect(guessHost('https://worksuite.abc.com/path')).toBe('worksuite.abc.com');
    expect(guessHost('worksuite.abc.com')).toBe('worksuite.abc.com');
  });
});

describe('EnterpriseAddress', () => {
  it('says only https is accepted, and refuses http before asking the desktop', () => {
    render(<EnterpriseAddress />);
    expect(screen.getByText(/Only https servers are accepted\./)).toBeTruthy();
    fireEvent.change(field(), { target: { value: 'http://worksuite.abc.com' } });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(screen.getByRole('alert').textContent).toMatch(/Only https servers are accepted/);
    expect(field().getAttribute('aria-invalid')).toBe('true');
    expect(bridge.call).not.toHaveBeenCalledWith('connect:start', expect.anything());
  });

  it('starts the checks and shows them at once, every step waiting', async () => {
    render(<EnterpriseAddress prefill="https://worksuite.livezentech.com" />);
    expect(field().value).toBe('https://worksuite.livezentech.com');
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    });
    expect(bridge.call).toHaveBeenCalledWith('connect:start', { input: 'https://worksuite.livezentech.com', target: 'enterprise' });
    const c = app.get().connect!;
    expect(c.runId).toBe('run_abcdefgh');
    expect(c.host).toBe('worksuite.livezentech.com');
    expect(c.steps).toHaveLength(7);
  });

  it('takes a work email', async () => {
    render(<EnterpriseAddress />);
    fireEvent.change(field(), { target: { value: 'you@livezentech.com' } });
    await act(async () => {
      fireEvent.submit(field().closest('form')!);
    });
    expect(bridge.call).toHaveBeenCalledWith('connect:start', { input: 'you@livezentech.com', target: 'enterprise' });
  });

  it('falls back to the old server step on a desktop without discovery', async () => {
    bridge.call.mockImplementation(async (channel: string) => {
      if (channel === 'connect:start') throw new DesktopError('UNSUPPORTED', 'not here');
      return undefined;
    });
    render(<EnterpriseAddress prefill="worksuite.abc.com" />);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    });
    expect(bridge.call).toHaveBeenCalledWith('auth:setServer', { url: 'worksuite.abc.com' });
    expect(app.get().session.adding).toBeNull();
  });

  it('shows what the desktop refused', async () => {
    bridge.call.mockImplementation(async (channel: string) => {
      if (channel === 'connect:start') throw new DesktopError('SERVER_ERROR' as never, 'Your organization allows only its own server.');
      return undefined;
    });
    render(<EnterpriseAddress prefill="worksuite.abc.com" />);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    });
    expect(screen.getByRole('alert').textContent).toBe('Your organization allows only its own server.');
  });

  it('reads a setup link first, names its server, and connects only on Continue', async () => {
    render(<EnterpriseAddress prefill={LINK} />);
    await waitFor(() => expect(screen.getByTestId('setup-summary').textContent).toContain('Livezen Technologies'));
    expect(screen.getByTestId('setup-summary').textContent).toContain('worksuite.livezentech.com');
    expect(bridge.call).toHaveBeenCalledWith('connect:parseSetup', { link: LINK });
    expect(bridge.call).not.toHaveBeenCalledWith('connect:start', expect.anything());
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    });
    expect(bridge.call).toHaveBeenCalledWith('connect:start', { input: LINK, target: 'enterprise' });
  });

  it('opens the QR scan, and a pasted setup link comes back to the field', async () => {
    render(<EnterpriseAddress />);
    fireEvent.click(screen.getByRole('button', { name: 'Scan Server QR Code' }));
    expect(screen.getByRole('dialog', { name: 'Scan setup QR' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'paste a setup link' }));
    fireEvent.change(screen.getByLabelText('Setup link'), { target: { value: LINK } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Use this link' }));
    });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(field().value).toBe(LINK);
    await waitFor(() => expect(screen.getByTestId('setup-summary')).toBeTruthy());
  });

  it('goes back to the startup selector', () => {
    render(<EnterpriseAddress />);
    fireEvent.click(screen.getByRole('button', { name: '← Back' }));
    expect(app.get().session.adding).toEqual({ step: 'choose' });
  });
});
