// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as CoreApi from '../../../src/core/api';

/**
 * Profile pictures in Chat (worksuite-desktop#37): looked up in one batch, shown in place of the initials, back to the
 * initials when there is none or it fails, and updated when the person changes theirs, without signing out.
 */
const realtime: Array<(e: unknown) => void> = [];
vi.mock('../../../src/core/api', async (orig) => ({ ...(await orig<typeof CoreApi>()), apiGet: vi.fn() }));
vi.mock('../../../src/core/bridge', () => ({ call: vi.fn(), on: (_ch: string, cb: (e: unknown) => void) => (realtime.push(cb), () => undefined), errorMessage: String, isMac: false }));
vi.mock('../../../src/core/app-state', async () => {
  const { createStore } = await import('../../../src/core/store');
  return { app: createStore({ apps: [], auth: { server: { origin: 'https://app.worksuite.lk' }, user: { id: 1, name: 'Me' } } }) };
});

import { apiGet } from '../../../src/core/api';
import { app } from '../../../src/core/app-state';
import { avatarSrc, resetAvatars } from '../../../src/core/avatars';
import { UserAvatar } from '../../../src/components/UserAvatar';
import { Avatar } from '../../../src/components/ui';

const lookups = vi.mocked(apiGet);
const img = (c: HTMLElement) => c.querySelector('img');

beforeEach(() => {
  resetAvatars();
  lookups.mockReset();
  Object.defineProperty(window, 'devicePixelRatio', { value: 2, configurable: true });
});
afterEach(cleanup);

describe('picture addresses', () => {
  it('asks for the size the screen needs, on the signed-in server', () => {
    expect(avatarSrc('/avatars/abc123/256.webp', 30)).toBe('https://app.worksuite.lk/avatars/abc123/64.webp');
    expect(avatarSrc('/avatars/abc123/256.webp', 56)).toBe('https://app.worksuite.lk/avatars/abc123/128.webp');
    expect(avatarSrc('/avatars/abc123/64.webp', 200)).toBe('https://app.worksuite.lk/avatars/abc123/512.webp');
  });

  it('uses nothing but an address of the form the server hands out', () => {
    expect(avatarSrc('/avatars/private', 32)).toBeNull();
    expect(avatarSrc('https://evil.example/x.webp', 32)).toBeNull();
    expect(avatarSrc('/avatars/../../etc/256.webp', 32)).toBeNull();
    expect(avatarSrc(null, 32)).toBeNull();
  });
});

describe('avatars with pictures', () => {
  it('looks up everybody on screen in one request, and shows their pictures', async () => {
    lookups.mockResolvedValue({ avatars: { '7': '/avatars/tok7/256.webp', '8': null } } as never);
    const { container } = render(
      <div>
        <span data-testid="a"><UserAvatar userId={7} name="Nimal Perera" size={34} /></span>
        <span data-testid="b"><UserAvatar userId={8} name="Kasun Silva" size={34} /></span>
        <span data-testid="c"><UserAvatar userId={7} name="Nimal Perera" size={30} /></span>
      </div>,
    );
    await waitFor(() => expect(container.querySelectorAll('img')).toHaveLength(2));
    expect(lookups).toHaveBeenCalledTimes(1);
    expect(lookups).toHaveBeenCalledWith('/api/users/avatars', { ids: '7,8' });
    const [a, , c] = [...container.querySelectorAll('[data-testid]')] as HTMLElement[];
    expect(img(a!)!.getAttribute('src')).toBe('https://app.worksuite.lk/avatars/tok7/128.webp');
    expect(img(c!)!.getAttribute('src')).toBe('https://app.worksuite.lk/avatars/tok7/64.webp');
    // No picture: the initials, on the colour that name always has.
    const b = container.querySelector('[data-testid="b"]') as HTMLElement;
    expect(img(b)).toBeNull();
    expect(b.textContent).toBe('KS');
  });

  it('keeps the initials under a picture, and shows them again if it fails to load', async () => {
    lookups.mockResolvedValue({ avatars: { '7': '/avatars/tok7/256.webp' } } as never);
    const { container } = render(<UserAvatar userId={7} name="Nimal Perera" size={34} />);
    await waitFor(() => expect(img(container)).not.toBeNull());
    expect(container.textContent).toBe('NP');
    fireEvent.error(img(container)!);
    expect(img(container)).toBeNull();
    expect(container.textContent).toBe('NP');
  });

  it('follows a changed picture without signing out', async () => {
    lookups.mockResolvedValue({ avatars: { '7': '/avatars/old/256.webp' } } as never);
    const { container } = render(<UserAvatar userId={7} name="Nimal Perera" size={34} />);
    await waitFor(() => expect(img(container)?.getAttribute('src')).toContain('/avatars/old/'));
    act(() => realtime.forEach((cb) => cb({ type: 'profile.updated', user_id: 7, avatar: '/avatars/new/256.webp' })));
    expect(img(container)!.getAttribute('src')).toBe('https://app.worksuite.lk/avatars/new/128.webp');
    // Removed: back to the initials.
    act(() => realtime.forEach((cb) => cb({ type: 'profile.updated', user_id: 7, avatar: null })));
    expect(img(container)).toBeNull();
    expect(lookups).toHaveBeenCalledTimes(1);
  });

  it('asks again when the new picture is one only some people may see', async () => {
    lookups.mockResolvedValueOnce({ avatars: { '7': '/avatars/old/256.webp' } } as never).mockResolvedValueOnce({ avatars: { '7': null } } as never);
    const { container } = render(<UserAvatar userId={7} name="Nimal Perera" size={34} />);
    await waitFor(() => expect(img(container)).not.toBeNull());
    act(() => realtime.forEach((cb) => cb({ type: 'profile.updated', user_id: 7, avatar: '/avatars/private' })));
    await waitFor(() => expect(lookups).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(img(container)).toBeNull());
  });

  it('forgets what it learned when somebody else signs in', async () => {
    lookups.mockResolvedValue({ avatars: { '7': '/avatars/tok7/256.webp' } } as never);
    const first = render(<UserAvatar userId={7} name="Nimal Perera" size={34} />);
    await waitFor(() => expect(img(first.container)).not.toBeNull());
    first.unmount();
    app.set({ auth: { server: { origin: 'https://app.worksuite.lk' }, user: { id: 2, name: 'Other' } } } as never);
    lookups.mockResolvedValue({ avatars: { '7': null } } as never);
    const second = render(<UserAvatar userId={7} name="Nimal Perera" size={34} />);
    expect(img(second.container)).toBeNull();
    await waitFor(() => expect(lookups).toHaveBeenCalledTimes(2));
  });

  it('a group asks for nobody and keeps its own shape', () => {
    const { container } = render(<UserAvatar userId={null} name="Design team" size={34} className="!rounded-[9px]" />);
    expect(lookups).not.toHaveBeenCalled();
    expect(img(container)).toBeNull();
    expect((container.firstChild as HTMLElement).className).toContain('!rounded-[9px]');
  });

  it('shows the initials when the lookup fails', async () => {
    lookups.mockRejectedValue(new Error('offline'));
    const { container } = render(<UserAvatar userId={9} name="Ruwan Fernando" size={34} />);
    await waitFor(() => expect(lookups).toHaveBeenCalled());
    expect(img(container)).toBeNull();
    expect(container.textContent).toBe('RF');
  });

  it('a plain Avatar takes a picture too, round and filling its circle', () => {
    const { container } = render(<Avatar name="Nimal Perera" size={34} src="https://app.worksuite.lk/media/abc" />);
    const el = img(container)!;
    expect(el.className).toContain('object-cover');
    expect(el.className).toContain('rounded-[inherit]');
    expect((container.firstChild as HTMLElement).className).toContain('rounded-full');
  });
});
