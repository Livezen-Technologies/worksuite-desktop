// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LocalStatus, LocalView } from '@shared/local-workspace';

/** Local Profile (#141): first use, PIN, the profile chip, search, locked online features, restore preview and the login entry. */
const bridge = vi.hoisted(() => ({ call: vi.fn() }));
vi.mock('../../../src/core/bridge', () => ({ call: bridge.call, on: () => () => undefined, hasDesktop: () => true, errorMessage: (e: Error) => e.message, isMac: false, platform: 'linux', registerDropped: vi.fn() }));
import LocalWorkspacePage from '../../../src/modules/guest/LocalWorkspacePage';
import { LocalImportOffer } from '../../../src/modules/guest/LocalImportOffer';
import { Onboarding } from '../../../src/app/onboarding/Onboarding';
import { app } from '../../../src/core/app-state';

const PROFILE = { name: 'Nimal', picture: null, hasPin: false, createdAt: '2026-10-02T09:00:00Z' };
const note = (id: string, title: string, body: string) => ({ id, revision: 1, updatedAt: '2026-10-02T09:00:00Z', firedAt: null, kind: 'note' as const, title, body, completed: false, due: null, start: null, end: null, reminder: null });
let status: LocalStatus;
let view: LocalView;
let offer: { count: number; pinRequired: boolean; profileName: string | null };
beforeEach(() => {
  status = { profile: structuredClone(PROFILE), locked: false, language: 'en' };
  view = { items: [], meetingInput: '', meetingServer: '' };
  offer = { count: 2, pinRequired: false, profileName: 'Nimal' };
  bridge.call.mockReset();
  bridge.call.mockImplementation(async (ch: string, input?: Record<string, unknown>) => {
    if (ch === 'local:status') return structuredClone(status);
    if (ch === 'local:profile') { status.profile = { ...PROFILE, name: String(input?.name).trim(), hasPin: typeof input?.pin === 'string' }; return structuredClone(status.profile); }
    if (ch === 'local:unlock') return input?.pin === '4826' ? { unlocked: true, retryAfter: 0 } : { unlocked: false, retryAfter: 0 };
    if (ch === 'local:read') return structuredClone(view);
    if (ch === 'local:restorePreview') return { token: '4f29a1c0-7b3d-4e8a-9c21-5d6e7f809a1c', notes: 2, tasks: 1, events: 0, duplicates: 3, profileName: 'Old phone' };
    if (ch === 'local:restore') return { added: 3, skipped: 3 };
    if (ch === 'local:importOffer') return offer;
    if (ch === 'local:reviewImport') return { token: '4f29a1c0-7b3d-4e8a-9c21-5d6e7f809a1d', account: 'Nimal · https://example.test', organization: 'Acme', rows: [] };
    return undefined;
  });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
const channels = () => bridge.call.mock.calls.map(([ch]) => ch as string);

describe('Local Profile first use and PIN', () => {
  it('asks only for a display name (picture and PIN optional), with no email, server, picture gate or AI setup', async () => {
    status = { profile: null, locked: false, language: 'en' };
    render(<LocalWorkspacePage />);
    expect(await screen.findByText('Set up your Local Profile')).toBeTruthy();
    expect(screen.getByText(/No email, verification or account is needed/)).toBeTruthy();
    expect(screen.getByLabelText('Profile picture (optional)')).toBeTruthy();
    expect(screen.queryByLabelText(/email/i)).toBeNull();
    const create = screen.getByRole('button', { name: 'Create Local Profile' }) as HTMLButtonElement;
    expect(create.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText(/^Display name/), { target: { value: 'Nimal' } });
    expect(create.disabled).toBe(false);
    fireEvent.change(screen.getByLabelText(/^PIN/), { target: { value: '4826' } });
    expect(create.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText(/^Confirm PIN/), { target: { value: '4826' } });
    fireEvent.click(create);
    await waitFor(() => expect(bridge.call).toHaveBeenCalledWith('local:profile', { name: 'Nimal', picture: null, pin: '4826' }));
    expect((await screen.findByTestId('local-profile-chip')).textContent).toBe('Nimal · Local Profile · Saved on This Device');
    expect(channels().every((ch) => ch.startsWith('local:'))).toBe(true);
  });

  it('creates a profile without a PIN when none is entered', async () => {
    status = { profile: null, locked: false, language: 'en' };
    render(<LocalWorkspacePage />);
    fireEvent.change(await screen.findByLabelText(/^Display name/), { target: { value: 'Kavya' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create Local Profile' }));
    await waitFor(() => expect(bridge.call).toHaveBeenCalledWith('local:profile', { name: 'Kavya', picture: null, pin: null }));
  });

  it('asks for the PIN before showing any local data', async () => {
    status = { profile: { ...PROFILE, hasPin: true }, locked: true, language: 'en' };
    render(<LocalWorkspacePage />);
    expect(await screen.findByText('Enter the PIN for this Local Profile.')).toBeTruthy();
    expect(channels()).not.toContain('local:read');
    fireEvent.change(screen.getByLabelText(/^PIN/), { target: { value: '1357' } });
    fireEvent.click(screen.getByRole('button', { name: 'Unlock' }));
    expect(await screen.findByText('That PIN is not right.')).toBeTruthy();
    fireEvent.change(screen.getByLabelText(/^PIN/), { target: { value: '4826' } });
    fireEvent.click(screen.getByRole('button', { name: 'Unlock' }));
    expect(await screen.findByTestId('local-profile-chip')).toBeTruthy();
    await waitFor(() => expect(channels()).toContain('local:read'));
  });
});

describe('Local Profile workspace', () => {
  it('shows a separate connection indicator that follows the network', async () => {
    let online = true;
    vi.spyOn(navigator, 'onLine', 'get').mockImplementation(() => online);
    render(<LocalWorkspacePage />);
    const chip = await screen.findByTestId('local-profile-chip');
    expect(screen.getByText('Online · network available')).toBeTruthy();
    online = false; act(() => window.dispatchEvent(new Event('offline')));
    expect(screen.getByText('Offline · local tools work')).toBeTruthy();
    expect(chip.textContent).toBe('Nimal · Local Profile · Saved on This Device');
    expect(chip.contains(screen.getByText('Offline · local tools work'))).toBe(false);
  });

  it('searches local notes', async () => {
    view.items = [note('4f29a1c0-7b3d-4e8a-9c21-5d6e7f809a11', 'Café budget', 'Quarterly'), note('4f29a1c0-7b3d-4e8a-9c21-5d6e7f809a12', 'Shopping', 'milk and bread')];
    render(<LocalWorkspacePage />);
    expect(await screen.findByRole('button', { name: 'Shopping' })).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Search notes'), { target: { value: 'cafe' } });
    expect(screen.getByRole('button', { name: 'Café budget' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Shopping' })).toBeNull();
    fireEvent.change(screen.getByLabelText('Search notes'), { target: { value: 'nothing like this' } });
    expect(screen.getByText('No local items match your search.')).toBeTruthy();
  });

  it('marks online-only features as needing an account and never opens them', async () => {
    render(<LocalWorkspacePage />);
    await screen.findByTestId('local-profile-chip');
    expect(screen.getByText('Needs a WorkSuite account:')).toBeTruthy();
    for (const feature of ['Company records', 'Drive & Files', 'Shared workspaces', 'Chat']) {
      const button = screen.getByRole('button', { name: feature }) as HTMLButtonElement;
      expect(button.disabled).toBe(true);
      fireEvent.click(button);
    }
    expect(channels().every((ch) => ch.startsWith('local:'))).toBe(true);
  });

  it('previews a restore with counts and restores only after confirming', async () => {
    render(<LocalWorkspacePage />);
    await screen.findByTestId('local-profile-chip');
    fireEvent.click(screen.getByRole('button', { name: 'Backup & Data' }));
    fireEvent.click(screen.getByRole('button', { name: 'Restore backup' }));
    expect(await screen.findByText('This backup adds 2 notes, 1 tasks and 0 events.')).toBeTruthy();
    expect(screen.getByText(/3 identical items are already here and will be skipped/)).toBeTruthy();
    expect(channels()).not.toContain('local:restore');
    fireEvent.click(screen.getByRole('button', { name: 'Restore these items' }));
    await waitFor(() => expect(bridge.call).toHaveBeenCalledWith('local:restore', { token: '4f29a1c0-7b3d-4e8a-9c21-5d6e7f809a1c' }));
    expect(await screen.findByText('Restored 3 items; skipped 3 duplicates.')).toBeTruthy();
  });

  it('edits the profile name and PIN from the Profile tab', async () => {
    render(<LocalWorkspacePage />);
    await screen.findByTestId('local-profile-chip');
    fireEvent.click(screen.getByRole('button', { name: 'Profile' }));
    fireEvent.change(screen.getByLabelText(/^Display name/), { target: { value: 'Nimal P' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save profile' }));
    await waitFor(() => expect(bridge.call).toHaveBeenCalledWith('local:profile', { name: 'Nimal P', picture: null }));
    expect((await screen.findByTestId('local-profile-chip')).textContent).toContain('Nimal P · Local Profile');
  });

  it('offers Sign In / Create Account without uploading anything', async () => {
    render(<LocalWorkspacePage />);
    await screen.findByTestId('local-profile-chip');
    fireEvent.click(screen.getByRole('button', { name: 'Sign In / Create Account' }));
    await waitFor(() => expect(channels()).toContain('local:signIn'));
    expect(channels().some((ch) => ch === 'local:import' || ch === 'local:reviewImport')).toBe(false);
  });
});

describe('Local Profile entry and import', () => {
  it('offers Continue as Guest on the sign-in screen', async () => {
    render(<Onboarding auth={{ stage: 'signed-out', server: { origin: 'https://example.test' } } as never} />);
    fireEvent.click(screen.getByRole('button', { name: 'Continue as Guest' }));
    await waitFor(() => expect(channels()).toContain('local:open'));
  });

  it('asks for a protected profile’s PIN before reviewing an import, and uploads nothing until confirmed', async () => {
    app.set({ organizationId: '7' });
    offer = { count: 2, pinRequired: true, profileName: 'Nimal' };
    render(<LocalImportOffer />);
    expect(await screen.findByText(/2 items are saved in the Local Profile “Nimal” on this device/)).toBeTruthy();
    const review = screen.getByRole('button', { name: 'Review local import' }) as HTMLButtonElement;
    expect(review.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Local Profile PIN'), { target: { value: '4826' } });
    fireEvent.click(review);
    await waitFor(() => expect(bridge.call).toHaveBeenCalledWith('local:reviewImport', { pin: '4826' }));
    expect(await screen.findByText(/Destination: Nimal · https:\/\/example.test · Acme/)).toBeTruthy();
    expect(channels()).not.toContain('local:import');
  });
});
