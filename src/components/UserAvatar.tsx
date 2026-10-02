import { useUserAvatar } from '../core/avatars';
import { Avatar } from './ui';

/**
 * A person's avatar with their current profile picture (worksuite-desktop#37), or their initials when they have none,
 * it fails to load, or they chose not to show it to this viewer. A picture they change reaches it without signing out.
 */
export function UserAvatar({ userId, src: _src, ...rest }: { userId: number | string | null | undefined } & Parameters<typeof Avatar>[0]) {
  const id = typeof userId === 'string' ? Number(userId) : userId;
  const src = useUserAvatar(Number.isSafeInteger(id) && (id ?? 0) > 0 ? id : null, rest.size ?? 32);
  return <Avatar key={id ?? 'unknown'} {...rest} src={src} />;
}
