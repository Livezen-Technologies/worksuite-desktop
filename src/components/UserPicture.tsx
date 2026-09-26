import { useState } from 'react';
import { app } from '../core/app-state';
import { useStore } from '../core/store';
import { Avatar, cx } from './ui';

/**
 * A profile picture address from WorkSuite as one this window may load.
 *
 * Pictures arrive root-relative (`/avatars/{token}/256.webp`) and need no
 * sign-in, so they load straight from the server — the page's image policy
 * allows the server and nothing else, so anything pointing elsewhere is
 * dropped rather than broken. `/avatars/private` is the server saying "not
 * for you": initials, never a request.
 */
export function pictureUrl(path: string | null | undefined, origin: string | null | undefined): string | null {
  if (!path || !origin || path.startsWith('/avatars/private')) return null;
  try {
    const u = new URL(path, origin);
    return u.origin === new URL(origin).origin ? u.toString() : null;
  } catch {
    return null;
  }
}

/** Somebody's picture, or their initials when there is none or it does not load. */
export function UserPicture({ name, src, size = 32, className, presence, ring }: { name: string | null | undefined; src: string | null | undefined; size?: number; className?: string; presence?: 'online' | 'away' | 'offline' | null; ring?: string }) {
  const origin = useStore(app, (s) => s.auth?.server?.origin);
  const url = pictureUrl(src, origin);
  const [failed, setFailed] = useState<string | null>(null);
  if (!url || failed === url) return <Avatar name={name} size={size} className={cx(className, ring)} presence={presence} />;
  return (
    <span className={cx('relative inline-flex shrink-0 rounded-full', className)} style={{ width: size, height: size }} aria-hidden>
      <img src={url} alt="" draggable={false} onError={() => setFailed(url)} className={cx('h-full w-full rounded-full bg-subtle object-cover', ring)} />
      {presence ? (
        <span className={cx('absolute -right-0.5 -bottom-0.5 h-2.5 w-2.5 rounded-full border-2 border-surface', presence === 'online' ? 'bg-success' : presence === 'away' ? 'bg-warning' : 'bg-ink-3')} />
      ) : null}
    </span>
  );
}

/** The signed-in person: the session's latest copy, which a profile save refreshes. */
export function useMe() {
  return useStore(app, (s) => s.bootstrap?.user ?? s.auth?.user ?? null);
}
