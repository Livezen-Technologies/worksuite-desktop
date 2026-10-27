import { useState } from 'react';
import { call } from '../../core/bridge';
import { Icon } from '../../components/Icon';
import { cx } from '../../components/ui';
import { useMe, UserPicture } from '../../components/UserPicture';
import { useMfa, usePasskeys, useSignIns, type Section } from './api';
import { usePersonal } from './Storage';

/**
 * The My account rail (AcctRail): who you are, the sections, how well the
 * account is protected, and Sign out. Security carries a count when there are
 * failed sign-ins on your address this week — the one thing here that may
 * need you to act.
 */
const ITEMS: Array<{ id: Section; label: string; icon: string } | { head: string }> = [
  { head: 'My account' },
  { id: 'profile', label: 'My profile', icon: 'user' },
  { id: 'general', label: 'General', icon: 'id-card' },
  { id: 'preferences', label: 'Preferences', icon: 'sliders' },
  { id: 'notifications', label: 'Notifications', icon: 'bell' },
  { id: 'security', label: 'Security', icon: 'lock' },
  { id: 'pictures', label: 'Profile pictures', icon: 'image' },
  { head: 'Access' },
  { id: 'access', label: 'My access', icon: 'key' },
  // WorkSuite Cloud's storage (Connection & Startup screen 12): a Personal account's only.
  { id: 'storage', label: 'Storage', icon: 'cloud' },
];

export function AccountRail({ section, onPick }: { section: Section; onPick: (s: Section) => void }) {
  const me = useMe();
  const mfa = useMfa();
  const passkeys = usePasskeys();
  const signIns = useSignIns();
  const [confirm, setConfirm] = useState(false);
  const failed = signIns.data?.failed_7d ?? 0;
  const keys = (passkeys.data?.passkeys ?? []).filter((p) => p.active).length;
  const on = !!mfa.data?.enabled;
  const known = mfa.data !== undefined;
  const protectedWell = on || keys > 0;
  const personal = usePersonal();

  return (
    <nav aria-label="My account" className="flex w-[220px] shrink-0 flex-col overflow-hidden border-r border-line bg-rail text-[13px] text-ink dark:bg-surface">
      <div className="flex items-center gap-2.5 px-3 pt-3.5 pb-2.5">
        <UserPicture name={me?.name} src={me?.avatar} size={36} className="!bg-primary !text-white" />
        <span className="flex min-w-0 flex-col">
          <b className="truncate text-[13.5px]">{me?.name}</b>
          <span className="truncate text-[11.5px] text-ink-3">{me?.email}</span>
        </span>
      </div>
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-2.5 scroll-thin">
        {ITEMS.filter((it) => !('id' in it) || it.id !== 'storage' || personal).map((it) => {
          if ('head' in it) {
            return (
              <div key={it.head} className="mt-2.5 flex h-6 shrink-0 items-center px-2 text-[11px] font-bold tracking-[.3px] text-ink-3">
                {it.head}
              </div>
            );
          }
          const active = it.id === section;
          const badge = it.id === 'security' && failed > 0 ? failed : 0;
          return (
            <button
              key={it.id}
              type="button"
              aria-current={active ? 'page' : undefined}
              onClick={() => onPick(it.id)}
              className={cx('relative flex h-8 shrink-0 items-center gap-2.5 rounded-[9px] pr-2 pl-2.5 text-left', active ? 'bg-info-bg font-bold text-info-ink dark:bg-selection dark:text-primary' : 'font-medium text-ink hover:bg-subtle')}
            >
              <span className={cx('absolute top-[7px] bottom-[7px] left-0 w-[3px] rounded-r-[3px]', active ? 'bg-primary' : 'bg-transparent')} />
              <Icon name={it.icon} size={16} className={cx('shrink-0', active ? 'text-primary' : 'text-ink-3')} />
              <span className="min-w-0 flex-1 truncate">{it.label}</span>
              {badge ? (
                <span title={`${badge} failed sign-in${badge === 1 ? '' : 's'} this week`} className="flex h-[18px] min-w-[18px] items-center justify-center rounded-[9px] bg-warning-bg px-[5px] text-[10.5px] font-bold text-warning-ink tabular-nums dark:bg-warning-bg dark:text-warning">
                  {badge}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
      {known ? (
        <button type="button" onClick={() => onPick('security')} className="m-2.5 flex flex-col gap-2 rounded-[12px] border border-line bg-surface p-3 text-left hover:border-primary/40">
          <span className={cx('flex items-center gap-2 text-[12px] font-bold', protectedWell ? 'text-success dark:text-success' : 'text-warning-ink dark:text-warning')}>
            <Icon name={protectedWell ? 'shield-check' : 'shield-alert'} size={15} />
            {protectedWell ? 'Account protected' : 'Only a password protects you'}
          </span>
          <span className="text-[11.5px] leading-[1.45] text-ink-3">
            {protectedWell
              ? `${on ? 'Two-factor is on' : 'Two-factor is off'}${keys ? ` and you have ${keys} passkey${keys === 1 ? '' : 's'}` : ''}.`
              : 'Turn on two-factor so a stolen password is not enough to get in.'}
          </span>
        </button>
      ) : (
        <span className="flex-1" />
      )}
      {confirm ? (
        <div className="mx-2.5 mb-3 rounded-[10px] bg-subtle p-2.5 text-[12px] text-ink-2">
          Sign out of WorkSuite on this computer? Drafts stay saved for when you come back.
          <div className="mt-2 flex gap-2">
            <button type="button" onClick={() => void call('auth:signOut', { wipe: false })} className="h-7 rounded-[7px] bg-danger px-2.5 text-[12px] font-semibold text-white">
              Sign out
            </button>
            <button type="button" onClick={() => setConfirm(false)} className="h-7 rounded-[7px] border border-line bg-surface px-2.5 text-[12px] font-semibold text-ink">
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button type="button" onClick={() => setConfirm(true)} className="mx-2.5 mb-3 flex h-[34px] items-center gap-2.5 rounded-[10px] px-2.5 text-[12.5px] font-semibold text-danger hover:bg-danger-bg dark:text-danger">
          <Icon name="logout" size={16} /> Sign out
        </button>
      )}
    </nav>
  );
}
