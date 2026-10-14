// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Preferences } from '@shared/types';
import { accountsState, snapshot } from './accounts-fixtures';
import type * as Bridge from '../../../src/core/bridge';

/**
 * Screen 1 — the startup selector (Connection & Startup, WP4): Personal or Enterprise, ← → and Enter, Cloud's free
 * storage when online, and the footer's guest mode and Join a meeting.
 */
const bridge = vi.hoisted(() => ({ call: vi.fn() }));
vi.mock('../../../src/core/bridge', async (orig) => ({ ...(await orig<typeof Bridge>()), call: bridge.call, on: () => () => undefined, hasDesktop: () => true }));
vi.mock('../../../src/core/toasts', () => ({ toast: vi.fn() }));

const { app } = await import('../../../src/core/app-state');
const { StartupSelector, freePlanBytes } = await import('../../../src/app/connect/StartupSelector');

beforeEach(() => {
  bridge.call.mockReset();
  bridge.call.mockImplementation(async (channel: string) => {
    if (channel === 'cloud:plans') return [{ id: 'pro', name: 'Professional', storage_bytes: 100 * 1024 ** 3, price: '$5' }, { id: 'free', name: 'Free', storage_bytes: 5 * 1024 ** 3, price: null }];
    if (channel === 'guest:pending') return null;
    if (channel === 'local:enter') return { language: 'en', profile: null, locked: false };
    return undefined;
  });
  app.set({ prefs: { language: 'en' } as Preferences, status: snapshot(), auth: null, session: { mode: 'account', signingIn: false, moveOffer: false, adding: null } });
});
afterEach(() => cleanup());

describe('freePlanBytes', () => {
  it('takes the free plan, else the one without a price, else the smallest', () => {
    expect(freePlanBytes([{ id: 'pro', name: 'Pro', storage_bytes: 9, price: '$1' }, { id: 'free', name: 'Free', storage_bytes: 3 }])).toBe(3);
    expect(freePlanBytes([{ id: 'a', name: 'A', storage_bytes: 9, price: '$1' }, { id: 'b', name: 'B', storage_bytes: 7, price: null }])).toBe(7);
    expect(freePlanBytes([{ id: 'a', name: 'A', storage_bytes: 9, price: '$1' }, { id: 'b', name: 'B', storage_bytes: 4, price: '$2' }])).toBe(4);
    expect(freePlanBytes([])).toBeNull();
    expect(freePlanBytes(null)).toBeNull();
  });
});

describe('StartupSelector', () => {
  it('offers Personal and Enterprise, with the storage figure from Cloud when online', async () => {
    render(<StartupSelector accounts={accountsState()} />);
    expect(screen.getByRole('heading', { name: 'How would you like to use WorkSuite?' })).toBeTruthy();
    expect(screen.getByRole('radio', { name: 'Personal' }).getAttribute('aria-checked')).toBe('true');
    expect(screen.getByRole('radio', { name: 'Enterprise' }).getAttribute('aria-checked')).toBe('false');
    await waitFor(() => expect(screen.getByText('5 GB cloud storage')).toBeTruthy());
    expect(bridge.call).toHaveBeenCalledWith('cloud:plans');
  });

  it('says 2 GB and does not ask Cloud while offline', () => {
    app.set({ status: snapshot({ network: 'OFFLINE' }) });
    render(<StartupSelector accounts={accountsState()} />);
    expect(screen.getByText('2 GB cloud storage')).toBeTruthy();
    expect(bridge.call).not.toHaveBeenCalledWith('cloud:plans');
  });

  it('chooses with the arrow keys and continues with Enter', () => {
    render(<StartupSelector accounts={accountsState()} />);
    const personalCard = screen.getByRole('radio', { name: 'Personal' });
    expect(document.activeElement).toBe(personalCard);
    fireEvent.keyDown(personalCard, { key: 'ArrowRight' });
    const enterprise = screen.getByRole('radio', { name: 'Enterprise' });
    expect(enterprise.getAttribute('aria-checked')).toBe('true');
    expect(document.activeElement).toBe(enterprise);
    fireEvent.keyDown(enterprise, { key: 'Enter' });
    expect(app.get().session.adding).toEqual({ step: 'enterprise' });
    expect(bridge.call).toHaveBeenCalledWith('accounts:addStart', { kind: 'enterprise' });
    fireEvent.keyDown(enterprise, { key: 'ArrowLeft' });
    expect(screen.getByRole('radio', { name: 'Personal' }).getAttribute('aria-checked')).toBe('true');
  });

  it('continues from each card’s own button', () => {
    render(<StartupSelector accounts={accountsState()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Continue with Personal' }));
    expect(app.get().session.adding).toEqual({ step: 'personal' });
    fireEvent.click(screen.getByRole('button', { name: 'Connect to Enterprise' }));
    expect(app.get().session.adding).toEqual({ step: 'enterprise' });
  });

  it('keeps Personal out of reach when the organization turned it off', () => {
    render(<StartupSelector accounts={accountsState({ allowPersonal: false })} />);
    const card = screen.getByRole('radio', { name: 'Personal' });
    expect(card.getAttribute('aria-disabled')).toBe('true');
    expect(screen.getByRole('radio', { name: 'Enterprise' }).getAttribute('aria-checked')).toBe('true');
    fireEvent.keyDown(screen.getByRole('radio', { name: 'Enterprise' }), { key: 'ArrowLeft' });
    expect(card.getAttribute('aria-checked')).toBe('false');
    expect(screen.getByText('Turned off by your organization on this computer.')).toBeTruthy();
    expect(bridge.call).not.toHaveBeenCalledWith('cloud:plans');
  });

  it('opens guest mode from “Use without an account”', async () => {
    render(<StartupSelector accounts={accountsState()} />);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Use without an account' }));
    });
    expect(bridge.call).toHaveBeenCalledWith('local:enter');
    expect(app.get().session.mode).toBe('guest');
  });

  it('shows Join a meeting, and Back returns to the cards', () => {
    render(<StartupSelector accounts={accountsState()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Join a meeting' }));
    expect(screen.getByText('Join a Meeting')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByRole('radio', { name: 'Personal' })).toBeTruthy();
  });

  it('offers Cancel, not guest mode, when adding an account from inside the app', () => {
    app.set({ auth: { stage: 'ready', server: null, user: null, message: null, setupPending: false }, session: { mode: 'account', signingIn: false, moveOffer: false, adding: { step: 'choose' } } });
    render(<StartupSelector accounts={accountsState()} />);
    expect(screen.queryByRole('button', { name: 'Use without an account' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(app.get().session.adding).toBeNull();
    expect(bridge.call).toHaveBeenCalledWith('accounts:addCancel');
  });
});
