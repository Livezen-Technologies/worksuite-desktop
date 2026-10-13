import type { AccountView } from '@shared/accounts';
import { avatarTone, cx, initials } from '../../components/ui';
import { inkOn, safeAccent, safeLogo } from './labels';

/**
 * An account's square badge: the server's logo when the desktop handed one over, else its initials on the server's
 * accent, else on the colour that always goes with the account (in either theme). Decorative: the name is beside it.
 */
export function AccountBadge({ account, size = 34, className }: { account: Pick<AccountView, 'id' | 'branding' | 'organizationName' | 'serverName' | 'kind' | 'user'>; size?: number; className?: string }) {
  const logo = safeLogo(account.branding?.logo);
  const accent = safeAccent(account.branding?.accent);
  const text = account.branding?.initials?.trim() || initials(account.kind === 'personal' ? (account.user?.name ?? 'Personal') : (account.organizationName ?? account.serverName));
  const radius = Math.round(size * 0.3);
  if (logo)
    return (
      <span aria-hidden className={cx('inline-flex shrink-0 items-center justify-center overflow-hidden border border-line bg-surface', className)} style={{ width: size, height: size, borderRadius: radius }}>
        <img src={logo} alt="" draggable={false} className="h-full w-full object-contain" />
      </span>
    );
  return (
    <span
      aria-hidden
      className={cx('inline-flex shrink-0 items-center justify-center font-extrabold', accent ? null : avatarTone(account.id), className)}
      style={{ width: size, height: size, borderRadius: radius, fontSize: Math.max(10, Math.round(size * 0.38)), ...(accent ? { background: accent, color: inkOn(accent) } : {}) }}
    >
      {text.slice(0, 2).toUpperCase()}
    </span>
  );
}
