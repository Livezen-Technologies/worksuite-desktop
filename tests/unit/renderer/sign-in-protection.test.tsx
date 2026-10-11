// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthState, SignInGate } from '@shared/types';
import type * as CoreApi from '../../../src/core/api';

/**
 * The desktop sign-in's protection states (worksuite-desktop#301) and the screens around them: the CAPTCHA, the wait
 * with its countdown, the locked account with "Email me an unblock link", a new computer's emailed code (resend,
 * expiry, tries left, remember), two-factor on a new computer, the remembered devices in My account › Security, and
 * "Ask for access" when an app was not given (the server's commit 703fc97e).
 */
Element.prototype.scrollIntoView ??= vi.fn();
const bridge = vi.hoisted(() => ({ call: vi.fn() }));
vi.mock('../../../src/core/bridge', () => ({
  call: bridge.call,
  on: () => () => undefined,
  hasDesktop: () => true,
  errorMessage: (e: unknown) => (e instanceof Error ? e.message : String(e)),
  isMac: false,
  isE2E: false,
  platform: 'linux',
  registerDropped: vi.fn(),
}));
const net = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), del: vi.fn() }));
vi.mock('../../../src/core/api', async (orig) => ({
  ...(await orig<typeof CoreApi>()),
  apiGet: (...a: unknown[]) => net.get(...a),
  apiPost: (...a: unknown[]) => net.post(...a),
  apiDelete: (...a: unknown[]) => net.del(...a),
}));

const { app } = await import('../../../src/core/app-state');
const { toasts } = await import('../../../src/core/toasts');
const { refuse } = await import('../../../src/core/access');
const { accessRequest } = await import('../../../src/core/access-request');
const { ApiError } = await import('../../../src/core/api');
const { Onboarding } = await import('../../../src/app/onboarding/Onboarding');
const { clock, gateFor, maskEmail, minutesLabel } = await import('../../../src/app/onboarding/SignInProtection');
const { AccessRequestDialog } = await import('../../../src/app/overlays/AccessRequestDialog');
const Security = (await import('../../../src/modules/account/Security')).default;

const SERVER = { origin: 'https://ws.example', name: 'WS', api: 'core', minimumVersion: null, locked: false, passkey: null } as AuthState['server'];
const state = (patch: Partial<AuthState> = {}): AuthState => ({ stage: 'signed-out', server: SERVER, user: null, message: null, setupPending: false, ...patch });
const wrap = (node: ReactNode) => <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{node}</QueryClientProvider>;
const calls = (channel: string) => bridge.call.mock.calls.filter(([c]) => c === channel).map(([, input]) => input as unknown);

const typeEmail = (email: string) => fireEvent.change(screen.getByLabelText('Email'), { target: { value: email } });

beforeEach(() => {
  bridge.call.mockReset();
  bridge.call.mockImplementation(async (channel: string) => {
    if (channel === 'guest:pending') return null;
    if (channel === 'auth:requestUnblock') return { message: 'If this account can be unblocked by email, a link is on its way.' };
    if (channel === 'auth:sessionId') return { sid: null };
    return state();
  });
  net.get.mockReset();
  net.post.mockReset();
  net.del.mockReset();
  toasts.set({ items: [] });
  accessRequest.set({ ask: null });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('helpers', () => {
  it('counts down, names waits, masks the address, and applies a gate only to its own address', () => {
    expect(clock(899_100)).toBe('15:00');
    expect(clock(3_725_000)).toBe('1:02:05');
    expect(clock(-5)).toBe('0:00');
    expect(minutesLabel(15)).toBe('15 minutes');
    expect(minutesLabel(60)).toBe('1 hour');
    expect(minutesLabel(300)).toBe('5 hours');
    expect(minutesLabel(90)).toBe('1 hour 30 minutes');
    expect(maskEmail('hasarinda@example.com')).toBe('ha*****da@example.com');
    const wait: SignInGate = { kind: 'restricted', email: 'Ann@x.lk', until: 2_000, total: null, failures: null, nextWait: null, blockAfter: null, message: '' };
    expect(gateFor(wait, 'ann@x.lk', 1_000)).toBe(wait);
    expect(gateFor(wait, 'bob@x.lk', 1_000)).toBeNull();
    expect(gateFor(wait, 'ann@x.lk', 3_000)).toBeNull();
  });
});

describe('the sign-in screen', () => {
  it('a wait: the time left counts down live, what comes next is said, and the form comes back when it is over', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const until = Date.now() + 15 * 60_000;
    const gate: SignInGate = { kind: 'restricted', email: 'ann@x.lk', until, total: 900, failures: 5, nextWait: 60, blockAfter: 10, message: 'Too many attempts.' };
    render(wrap(<Onboarding auth={state({ gate, user: { email: 'ann@x.lk' } as AuthState['user'] })} />));
    expect(screen.getByRole('heading', { name: 'Too many attempts' })).toBeTruthy();
    expect(screen.getByRole('timer').textContent).toBe('15:00');
    expect(screen.getByText('Another wrong password makes you wait 1 hour.')).toBeTruthy();
    expect(screen.getByText('The account is blocked after 10 failed attempts.')).toBeTruthy();
    expect(screen.queryByLabelText('Password')).toBeNull();

    await act(async () => void vi.advanceTimersByTime(61_000));
    expect(screen.getByRole('timer').textContent).toBe('13:59');

    await act(async () => void vi.advanceTimersByTime(14 * 60_000));
    await waitFor(() => expect(calls('auth:clearGate').length).toBeGreaterThan(0));
    expect(screen.getByLabelText('Password')).toBeTruthy();
  });

  it('a wait that ends in a block says so', () => {
    const gate: SignInGate = { kind: 'restricted', email: 'ann@x.lk', until: Date.now() + 60_000, total: null, failures: 9, nextWait: 0, blockAfter: 10, message: '' };
    render(wrap(<Onboarding auth={state({ gate, user: { email: 'ann@x.lk' } as AuthState['user'] })} />));
    expect(screen.getByText(/One more wrong password blocks the account/)).toBeTruthy();
  });

  it('a locked account: what the server said, and the emailed unblock link on request', async () => {
    const gate: SignInGate = {
      kind: 'blocked',
      email: 'ann@x.lk',
      reference: 'LCK-2026-0007',
      failures: 10,
      blockedAt: '2026-10-10T09:00:00+00:00',
      lastPlace: 'Colombo, LK',
      lastBrowser: 'Chrome on Windows',
      selfUnblock: true,
      linkHours: 24,
      message: 'Blocked.',
    };
    render(wrap(<Onboarding auth={state({ gate, user: { email: 'ann@x.lk' } as AuthState['user'] })} />));
    expect(screen.getByRole('heading', { name: 'Your account is locked' })).toBeTruthy();
    expect(screen.getByText('LCK-2026-0007')).toBeTruthy();
    expect(screen.getByText('Colombo, LK (approximate) · Chrome on Windows')).toBeTruthy();
    expect(screen.getByText(/works once, for 24 hours/)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Email me an unblock link' }));
    expect((await screen.findByRole('status')).textContent).toContain('a link is on its way');
    expect(calls('auth:requestUnblock')).toEqual([{ email: 'ann@x.lk' }]);
    expect((screen.getByRole('button', { name: 'Email me an unblock link' }) as HTMLButtonElement).disabled).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: 'Use a different account' }));
    expect(calls('auth:clearGate').length).toBe(1);
  });

  it('a locked account whose company does not allow the emailed link sends people to the administrator', () => {
    const gate: SignInGate = { kind: 'blocked', email: 'ann@x.lk', reference: null, failures: null, blockedAt: null, lastPlace: null, lastBrowser: null, selfUnblock: false, linkHours: null, message: '' };
    render(wrap(<Onboarding auth={state({ gate, user: { email: 'ann@x.lk' } as AuthState['user'] })} />));
    expect(screen.queryByRole('button', { name: 'Email me an unblock link' })).toBeNull();
    expect(screen.getByText(/Ask your administrator to unblock it/)).toBeTruthy();
  });

  it('a CAPTCHA: Sign in waits for it, it opens in its own window, and once solved the sign-in can go', async () => {
    const gate: SignInGate = { kind: 'captcha', email: 'ann@x.lk', provider: 'turnstile', solved: false, message: 'That email and password don’t match. After several failed attempts, confirm you are not a robot before trying again.' };
    const { rerender } = render(wrap(<Onboarding auth={state({ gate, user: { email: 'ann@x.lk' } as AuthState['user'] })} />));
    fireEvent.change(screen.getByLabelText(/^Password/), { target: { value: 'pw' } });
    expect(screen.getByText(gate.message)).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Sign in' }) as HTMLButtonElement).disabled).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: 'Confirm you’re not a robot' }));
    await waitFor(() => expect(calls('auth:solveCaptcha').length).toBe(1));

    rerender(wrap(<Onboarding auth={state({ gate: { ...gate, solved: true }, user: { email: 'ann@x.lk' } as AuthState['user'] })} />));
    expect(screen.getByText('Verified. Sign in now.')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'pw' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    await waitFor(() => expect(calls('auth:signIn')).toEqual([{ email: 'ann@x.lk', password: 'pw' }]));
  });

  it('a gate for another address does not stand in front of this one', () => {
    const gate: SignInGate = { kind: 'blocked', email: 'bob@x.lk', reference: null, failures: null, blockedAt: null, lastPlace: null, lastBrowser: null, selfUnblock: true, linkHours: 24, message: '' };
    render(wrap(<Onboarding auth={state({ gate, user: { email: 'bob@x.lk' } as AuthState['user'] })} />));
    expect(screen.getByRole('heading', { name: 'Your account is locked' })).toBeTruthy();
    cleanup();
    render(wrap(<Onboarding auth={state({ gate })} />));
    typeEmail('ann@x.lk');
    expect(screen.getByLabelText('Password')).toBeTruthy();
  });
});

describe('a new computer’s emailed code', () => {
  const step = (patch: Partial<NonNullable<AuthState['deviceCode']>> = {}) => ({
    emailHint: 'an*@x.lk',
    sent: true,
    message: null,
    expiresAt: Date.now() + 10 * 60_000,
    resendAt: Date.now() + 60_000,
    attemptsLeft: 5,
    ...patch,
  });

  it('says where the code went, how long it lasts and the tries left, and sends it with "remember" when typed', async () => {
    render(wrap(<Onboarding auth={state({ stage: 'device-code', deviceCode: step() })} />));
    expect(screen.getByRole('heading', { name: 'Verify this computer' })).toBeTruthy();
    expect(screen.getByText('an*@x.lk')).toBeTruthy();
    expect(screen.getByText(/Expires in (10:00|9:59)/)).toBeTruthy();
    expect(screen.getByText('5 tries left')).toBeTruthy();
    expect((screen.getByRole('button', { name: /Send another code in/ }) as HTMLButtonElement).disabled).toBe(true);

    fireEvent.change(screen.getByLabelText('Code'), { target: { value: '12 34 56' } });
    await waitFor(() => expect(calls('auth:verifyDevice')).toEqual([{ code: '123456', remember: true }]));
  });

  it('can leave the computer unremembered', async () => {
    render(wrap(<Onboarding auth={state({ stage: 'device-code', deviceCode: step() })} />));
    fireEvent.click(screen.getByLabelText(/Remember this computer/));
    fireEvent.change(screen.getByLabelText('Code'), { target: { value: '654321' } });
    await waitFor(() => expect(calls('auth:verifyDevice')).toEqual([{ code: '654321', remember: false }]));
  });

  it('a wrong code says what the server said, with the tries left', async () => {
    bridge.call.mockImplementation(async (channel: string) => {
      if (channel === 'auth:verifyDevice') throw new Error('That code is not right. Check the email and try again. 4 tries left.');
      return channel === 'guest:pending' ? null : state();
    });
    render(wrap(<Onboarding auth={state({ stage: 'device-code', deviceCode: step() })} />));
    fireEvent.change(screen.getByLabelText('Code'), { target: { value: '000000' } });
    expect(await screen.findByText('That code is not right. Check the email and try again. 4 tries left.')).toBeTruthy();
    expect((screen.getByLabelText(/^Code/) as HTMLInputElement).value).toBe('');
  });

  it('another code once the minute is up', async () => {
    bridge.call.mockImplementation(async (channel: string) => {
      if (channel === 'auth:resendDevice') return state({ stage: 'device-code', deviceCode: step({ message: 'We sent you a new code.' }) });
      return channel === 'guest:pending' ? null : state();
    });
    render(wrap(<Onboarding auth={state({ stage: 'device-code', deviceCode: step({ resendAt: Date.now() - 1 }) })} />));
    fireEvent.click(screen.getByRole('button', { name: 'Send another code' }));
    expect(await screen.findByText('We sent you a new code.')).toBeTruthy();
    expect(calls('auth:resendDevice').length).toBe(1);
  });

  it('an expired code cannot be typed, and a code that could not be sent says why', () => {
    render(wrap(<Onboarding auth={state({ stage: 'device-code', deviceCode: step({ expiresAt: Date.now() - 1, sent: false, message: 'This server cannot send email.' }) })} />));
    expect(screen.getByText('This code has expired. Ask for a new one.')).toBeTruthy();
    expect((screen.getByLabelText('Code') as HTMLInputElement).disabled).toBe(true);
    expect(screen.getByText('This server cannot send email.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Use a different account' }));
    expect(calls('auth:cancelMfa').length).toBe(1);
  });
});

describe('two-factor on a new computer', () => {
  it('says the code verifies the computer too, and remembers it unless told not to', async () => {
    render(wrap(<Onboarding auth={state({ stage: 'mfa', mfaNewDevice: true })} />));
    expect(screen.getByText(/the code verifies it too/)).toBeTruthy();
    fireEvent.click(screen.getByLabelText('Remember this computer'));
    fireEvent.change(screen.getByLabelText('Code'), { target: { value: '123456' } });
    await waitFor(() => expect(calls('auth:verifyMfa')).toEqual([{ code: '123456', remember: false }]));
  });

  it('on a known computer, just the code', async () => {
    render(wrap(<Onboarding auth={state({ stage: 'mfa', mfaNewDevice: false })} />));
    expect(screen.queryByLabelText('Remember this computer')).toBeNull();
    fireEvent.change(screen.getByLabelText('Code'), { target: { value: '123456' } });
    await waitFor(() => expect(calls('auth:verifyMfa')).toEqual([{ code: '123456' }]));
  });
});

describe('remembered devices (My account › Security)', () => {
  const devices = [
    { id: 4, label: 'WorkSuite Desktop on Windows', platform: 'Windows', browser: '', last_ip: '203.0.113.9', last_seen_at: '2026-10-10T08:00:00Z', expires_at: '2026-11-09T08:00:00Z', created_at: '2026-10-01T08:00:00Z', current: true },
    { id: 9, label: '', platform: 'macOS', browser: 'Safari', last_ip: '198.51.100.2', last_seen_at: '2026-10-08T08:00:00Z', expires_at: '2026-11-07T08:00:00Z', created_at: '2026-10-08T08:00:00Z', current: false },
  ];
  const answer = (rows: unknown) => (path: string) => {
    if (path === '/api/auth/mfa') return Promise.resolve({ enabled: false, backup_codes: 0 });
    if (path === '/api/auth/passkeys') return Promise.resolve({ passkeys: [], policy: { enabled: false } });
    if (path === '/api/auth/sessions') return Promise.resolve([]);
    if (path === '/api/auth/sign-ins') return Promise.reject(new ApiError(404, 'Not found', null));
    if (path === '/api/auth/devices') return typeof rows === 'function' ? (rows as () => Promise<unknown>)() : Promise.resolve(rows);
    return Promise.resolve(null);
  };

  it('lists them, marks this computer, and removes one or all', async () => {
    net.get.mockImplementation(answer(devices));
    net.del.mockResolvedValue({ removed: 1 });
    render(wrap(<Security />));
    const list = await screen.findByLabelText('Remembered devices');
    expect(within(list).getByText('WorkSuite Desktop on Windows')).toBeTruthy();
    expect(within(list).getByText('This computer')).toBeTruthy();
    expect(within(list).getByText('Safari on macOS')).toBeTruthy();

    fireEvent.click(within(list).getByRole('button', { name: 'Remove Safari on macOS' }));
    await waitFor(() => expect(net.del).toHaveBeenCalledWith('/api/auth/devices/9'));

    fireEvent.click(screen.getByRole('button', { name: 'Remove all' }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Remove all' }));
    await waitFor(() => expect(net.del).toHaveBeenCalledWith('/api/auth/devices'));
  });

  it('is not shown by a server without them', async () => {
    net.get.mockImplementation(answer(() => Promise.reject(new ApiError(404, 'Not found', null))));
    render(wrap(<Security />));
    expect(await screen.findByText('Active sessions')).toBeTruthy();
    await waitFor(() => expect(net.get).toHaveBeenCalledWith('/api/auth/devices', undefined, expect.anything()));
    expect(screen.queryByText('Remembered devices')).toBeNull();
  });
});

describe('ask for access', () => {
  it('a refusal for an app the server gives by name offers to ask for it, and the request goes to the administrators', async () => {
    app.set({ session: { mode: 'account', signingIn: false, moveOffer: false } });
    refuse('crm');
    const t = toasts.get().items.at(-1);
    expect(t?.text).toBe("You don't have access to this.");
    expect(t?.action?.label).toBe('Ask for access');
    act(() => t!.action!.run());
    expect(accessRequest.get().ask).toMatchObject({ slug: 'crm', label: 'CRM' });

    net.get.mockResolvedValue({ app: { slug: 'crm', name: 'CRM' }, email: 'ann@x.lk', roles: ['Employee'], company: 'Livezen', pending: null });
    net.post.mockResolvedValue({ reference: 'REQ-ABC123', again: false });
    render(wrap(<AccessRequestDialog />));
    expect(await screen.findByText('ann@x.lk')).toBeTruthy();
    expect(screen.getByText('Employee')).toBeTruthy();
    expect(screen.getByText('Livezen')).toBeTruthy();
    expect(net.get).toHaveBeenCalledWith('/api/access/context', { app: 'crm' }, expect.anything());

    fireEvent.change(screen.getByLabelText('Why you need it (optional)'), { target: { value: 'I follow up leads.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Ask for access' }));
    expect(await screen.findByText('REQ-ABC123')).toBeTruthy();
    expect(screen.getByText(/Request sent to your administrators/)).toBeTruthy();
    expect(net.post).toHaveBeenCalledWith('/api/access/requests', { app: 'crm', reason: 'I follow up leads.', path: undefined });
  });

  it('a request already waiting is shown instead of sending another', async () => {
    accessRequest.set({ ask: { slug: 'crm', label: 'CRM' } });
    net.get.mockResolvedValue({ app: { slug: 'crm', name: 'CRM' }, email: 'ann@x.lk', roles: [], company: null, pending: { reference: 'REQ-OLD001', created_at: '2026-10-10T08:00:00Z' } });
    render(wrap(<AccessRequestDialog />));
    expect(await screen.findByText('REQ-OLD001')).toBeTruthy();
    expect(screen.getByText(/already with your administrators/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Ask for access' })).toBeNull();
  });

  it('nothing to ask for when the app is not given by name', () => {
    refuse('/settings');
    expect(toasts.get().items.at(-1)?.action).toBeUndefined();
  });
});
