import { useEffect, useState } from 'react';
import { app } from '../../core/app-state';
import { useStore } from '../../core/store';
import { navigate } from '../../core/tabs';
import { closeOverlay } from '../../core/ui';
import { leaveGuestMode, startSignIn } from '../../core/session';
import { text } from '../../core/i18n';
import { Popover } from '../../app/overlays/Popover';
import { Icon } from '../../components/Icon';
import { UserPicture } from '../../components/UserPicture';
import { cx } from '../../components/ui';

/** Whether this computer has a network (guest mode has no server to ask). */
export function useOnline(): boolean {
  const [online, setOnline] = useState(() => navigator.onLine);
  useEffect(() => {
    const change = () => setOnline(navigator.onLine);
    window.addEventListener('online', change);
    window.addEventListener('offline', change);
    return () => {
      window.removeEventListener('online', change);
      window.removeEventListener('offline', change);
    };
  }, []);
  return online;
}

/** "Hasarinda · Local profile · Saved on this device" (#149). */
export function guestIdentity(name: string): string {
  return `${name} · ${text('Local profile')} · ${text('Saved on this device')}`;
}

/**
 * The avatar menu in guest mode (#149): who this is — a Local Profile saved on this device — and whether the
 * computer is online; signing in, the data's backup and the profile are in Settings, as for an account.
 */
export function GuestProfileMenu() {
  const profile = useStore(app, (s) => s.local?.profile ?? null);
  const online = useOnline();
  const go = (route: string) => (closeOverlay(), navigate(route));
  const name = profile?.name ?? '';
  return (
    <Popover label={text('Local profile')} width={320} className="rounded-[18px] border border-line shadow-[0_24px_60px_rgb(var(--ws-shadow-rgb)/.22)]">
      <div className="flex items-center gap-3 bg-[linear-gradient(180deg,#F3F5FE,var(--color-surface))] p-4 dark:bg-[linear-gradient(180deg,var(--color-selection),var(--color-surface))]">
        <span className="relative">
          <UserPicture name={name} src={profile?.picture} size={52} className="!bg-primary text-[17px] !text-white" />
          <span className={cx('absolute right-0 bottom-0 h-3.5 w-3.5 rounded-full border-[2.5px] border-surface', online ? 'bg-success' : 'bg-ink-3')} />
        </span>
        <span className="flex min-w-0 flex-col">
          <b className="truncate text-[14.5px] text-ink" data-testid="local-profile-chip" title={guestIdentity(name)}>
            {name}
          </b>
          <span className="truncate text-[12px] text-ink-3">
            {text('Local profile')} · {text('Saved on this device')}
          </span>
        </span>
      </div>
      <div className="px-3 pb-2.5">
        <div role="status" className="flex h-[38px] w-full items-center gap-2.5 rounded-[10px] border border-line bg-surface px-3 text-[13px] font-semibold text-ink">
          <span className={cx('h-[9px] w-[9px] shrink-0 rounded-full', online ? 'bg-success' : 'bg-ink-3')} />
          <span className="min-w-0 flex-1 truncate">{online ? text('Online · network available') : text('Offline · local tools work')}</span>
        </div>
      </div>
      <div className="flex flex-col border-t border-line px-2 py-1">
        <Row icon="log-in" label={text('Sign in / Create account')} onClick={() => (closeOverlay(), startSignIn())} strong />
        <Row icon="download" label={text('Backup & export data')} onClick={() => go('/settings/local-data')} />
        <Row icon="user" label={text('Profile')} onClick={() => go('/settings/local-profile')} />
      </div>
      <div className="flex flex-col border-t border-line px-2 py-1">
        <Row icon="settings" label={text('Settings for this computer')} onClick={() => go('/settings')} />
        <Row icon="help" label={text('Help & diagnostics')} onClick={() => go('/diagnostics')} />
      </div>
      <div className="border-t border-line px-2 pt-1 pb-2">
        <Row icon="logout" label={text('Close Local Profile')} onClick={() => (closeOverlay(), void leaveGuestMode())} />
      </div>
    </Popover>
  );
}

function Row({ icon, label, onClick, strong }: { icon: string; label: string; onClick: () => void; strong?: boolean }) {
  return (
    <button type="button" onClick={onClick} className={cx('flex h-9 items-center gap-[11px] rounded-[9px] px-2.5 text-left text-[13px] text-ink hover:bg-subtle', strong ? 'font-bold text-primary' : 'font-medium')}>
      <Icon name={icon} size={17} className={cx('shrink-0', strong ? 'text-primary' : 'text-ink-2')} />
      <span className="min-w-0 flex-1 truncate">{label}</span>
    </button>
  );
}
