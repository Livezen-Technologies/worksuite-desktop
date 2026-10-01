// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as Editor from '../../../src/modules/account/PictureEditor';

/**
 * Add your profile picture (#46): what the app shows instead of the workspace
 * while the server says this account must have a picture. Choose and crop it,
 * see it, and only then send it; Sign Out is the only other way on.
 */
const net = vi.hoisted(() => ({ call: vi.fn(), request: vi.fn(), apiGet: vi.fn() }));

vi.mock('../../../src/core/bridge', () => ({ call: net.call, on: () => () => undefined, hasDesktop: () => true, errorMessage: (e: unknown) => (e instanceof Error ? e.message : String(e)), isMac: false, platform: 'linux', registerDropped: vi.fn() }));
vi.mock('../../../src/core/api', () => ({ request: net.request, apiGet: net.apiGet, ApiError: class extends Error {} }));
// The crop editor draws on a canvas jsdom does not have; here it hands back what was "cropped", unsent.
vi.mock('../../../src/modules/account/PictureEditor', async (actual) => ({
  ...(await actual<typeof Editor>()),
  PictureEditor: ({ tab, onPick, onClose }: { tab: string; onPick: (b: Blob) => void; onClose: () => void }) => (
    <button type="button" onClick={() => (onPick(new Blob(['x'], { type: 'image/png' })), onClose())}>
      Use {tab}
    </button>
  ),
}));

const { AddPictureScreen } = await import('../../../src/app/screens/AddPictureScreen');

const LIMITS = { max_bytes: 5 * 1048576, extensions: ['jpg', 'png'], types: ['jpg', 'png'], min_side: 128 };
const answer = (can = { upload: true, avatar: false, edit: true, delete: true, skip_review: false }) => ({ items: [], limits: LIMITS, policy: { moderation: false, default_look: 'initials', required: true }, can });

function show(onDone = vi.fn()): { onDone: ReturnType<typeof vi.fn> } {
  const wrap = ({ children }: { children: ReactNode }) => <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{children}</QueryClientProvider>;
  render(<AddPictureScreen onDone={onDone} />, { wrapper: wrap });
  return { onDone };
}

const saveButton = () => screen.getByRole('button', { name: /Save and Continue|Try again|Saving/ }) as HTMLButtonElement;

beforeEach(() => {
  Object.values(net).forEach((f) => f.mockReset());
  net.apiGet.mockResolvedValue(answer());
  net.call.mockResolvedValue(undefined);
  URL.createObjectURL = vi.fn(() => 'blob:preview');
  URL.revokeObjectURL = vi.fn();
});
afterEach(cleanup);

describe('Add your profile picture (#46)', () => {
  it('asks for a picture, says what it may be, and cannot be skipped', async () => {
    show();
    expect(screen.getByText('Add your profile picture')).toBeTruthy();
    expect(screen.getByText('Please upload a profile picture to complete your profile and continue.')).toBeTruthy();
    expect(await screen.findByText('JPG or PNG, up to 5 MB, at least 128 × 128 pixels.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Upload Picture' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Sign Out' })).toBeTruthy();
    expect(saveButton().disabled).toBe(true);
    expect(screen.queryByRole('button', { name: /skip|later|close|cancel/i })).toBeNull();
  });

  it('shows the cropped picture, sends it only on Save and Continue, then refreshes the session and goes on', async () => {
    net.request.mockResolvedValue({ data: { avatar: '/avatars/abc/256.webp', pending: false } });
    const { onDone } = show();
    await screen.findByText(/JPG or PNG/);

    fireEvent.click(screen.getByRole('button', { name: 'Upload Picture' }));
    fireEvent.click(screen.getByRole('button', { name: 'Use photo' }));

    expect((await screen.findByAltText('Your new profile picture')).getAttribute('src')).toBe('blob:preview');
    expect(net.request).not.toHaveBeenCalled();

    fireEvent.click(saveButton());
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(net.request).toHaveBeenCalledWith('POST', '/api/users/me/pictures', { body: expect.any(FormData) });
    expect(net.call).toHaveBeenCalledWith('session:refresh');
  });

  it('says why sending failed, stays, and tries again', async () => {
    net.request.mockRejectedValueOnce(new Error('The picture is too small.'));
    const { onDone } = show();
    await screen.findByText(/JPG or PNG/);
    fireEvent.click(screen.getByRole('button', { name: 'Upload Picture' }));
    fireEvent.click(screen.getByRole('button', { name: 'Use photo' }));
    fireEvent.click(saveButton());

    expect(await screen.findByText('The picture is too small.')).toBeTruthy();
    expect(onDone).not.toHaveBeenCalled();

    net.request.mockResolvedValueOnce({ data: { avatar: null, pending: true } });
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
  });

  it('signs out without wiping this computer', () => {
    show();
    fireEvent.click(screen.getByRole('button', { name: 'Sign Out' }));
    expect(net.call).toHaveBeenCalledWith('auth:signOut', { wipe: false });
  });

  it('offers an avatar when uploads are off but avatars are allowed', async () => {
    net.apiGet.mockResolvedValue(answer({ upload: false, avatar: true, edit: true, delete: true, skip_review: false }));
    show();
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Upload Picture' })).toBeNull());
    expect(screen.getByRole('button', { name: 'Create an avatar instead' })).toBeTruthy();
  });
});
