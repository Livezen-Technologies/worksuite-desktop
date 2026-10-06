import { Icon } from '../../components/Icon';
import { cx } from '../../components/ui';
import { useRecordings, useStatus } from './api';
import { usePhoneAccess, type PhoneAccess } from './access';
import { usePhaseLabel, usePhoneState } from './softphone/client';

/**
 * The Phone's one navigation (design "Shell"): My phone · Supervise · Administer, each section shown only to those
 * who may use it (§8 "permission-shaped"). The chip on top is the phone's registration (W01 "Ext 1042 ·
 * Registered"); the foot names the switch.
 */
export type Section =
  | 'dial'
  | 'calls'
  | 'voicemail'
  | 'forwarding'
  | 'live'
  | 'reports'
  | 'recordings'
  | 'extensions'
  | 'servers'
  | 'trunks'
  | 'inbound'
  | 'queues'
  | 'dialplan'
  | 'settings';

type Item = { id: Section; label: string; icon: string; need?: keyof PhoneAccess };

const GROUPS: Array<{ head: string; need?: keyof PhoneAccess; items: Item[] }> = [
  {
    head: 'My phone',
    items: [
      { id: 'dial', label: 'Phone', icon: 'phone' },
      { id: 'calls', label: 'Calls', icon: 'history' },
      { id: 'voicemail', label: 'Voicemail', icon: 'voicemail' },
      { id: 'forwarding', label: 'Forwarding & DND', icon: 'phone-forwarded' },
    ],
  },
  {
    head: 'Supervise',
    need: 'supervisor',
    items: [
      { id: 'live', label: 'Live board', icon: 'radio' },
      { id: 'reports', label: 'Reports', icon: 'chart', need: 'reports' },
      { id: 'recordings', label: 'Recordings', icon: 'mic', need: 'reports' },
    ],
  },
  {
    head: 'Administer',
    need: 'manage',
    items: [
      { id: 'extensions', label: 'Extensions', icon: 'users' },
      { id: 'servers', label: 'PBX servers', icon: 'server' },
      { id: 'trunks', label: 'Trunks & routes', icon: 'route' },
      { id: 'inbound', label: 'Inbound & IVR', icon: 'git-branch' },
      { id: 'queues', label: 'Queues & groups', icon: 'users' },
      { id: 'dialplan', label: 'Dial plan', icon: 'hash' },
      { id: 'settings', label: 'Settings & sync', icon: 'sliders' },
    ],
  },
];

export const SECTIONS: readonly Section[] = GROUPS.flatMap((g) => g.items.map((i) => i.id));

/** The sections this person may open. */
export function visibleSections(a: PhoneAccess): Section[] {
  return GROUPS.filter((g) => !g.need || a[g.need]).flatMap((g) => g.items.filter((i) => !i.need || a[i.need]).map((i) => i.id));
}

const CHIP = {
  success: 'bg-success-bg text-success',
  warning: 'bg-warning-bg text-warning',
  danger: 'bg-danger-bg text-danger',
  muted: 'bg-subtle text-ink-2',
} as const;

export function PhoneNav({ section, onPick }: { section: Section; onPick: (s: Section) => void }) {
  const access = usePhoneAccess();
  const { text: chip, tone } = usePhaseLabel();
  const server = usePhoneState((s) => s.server);
  const status = useStatus();
  const vm = useRecordings({ kind: 'voicemail', per_page: 50 });
  const unheard = (vm.data?.recordings ?? []).filter((r) => !r.listened).length;
  const missed = usePhoneState((s) => s.missed.length);
  const foot = server ?? (status.data ? (status.data.pbx.ok ? 'Phone system online' : 'No PBX reachable') : '');

  return (
    <nav aria-label="Phone" className="flex w-[220px] shrink-0 flex-col overflow-hidden border-r border-line bg-[#FBFBFD] text-[13px] text-ink dark:bg-surface">
      <div className="flex flex-col gap-1.5 px-3 pt-3.5 pb-2">
        <b className="text-[15px]">Phone</b>
        <span className={cx('inline-flex w-fit max-w-full items-center gap-1.5 truncate rounded-full px-2 py-0.5 text-[11.5px] font-semibold', CHIP[tone])}>
          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-current" />
          <span className="truncate">{access.manage && chip === 'No extension' ? 'Administrator · voip.manage' : chip}</span>
        </span>
      </div>
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-2.5 pb-2 scroll-thin">
        {GROUPS.filter((g) => !g.need || access[g.need]).map((g) => (
          <div key={g.head} className="flex flex-col">
            <div className="mt-2.5 flex h-6 shrink-0 items-center px-2 text-[11px] font-bold tracking-[.3px] text-ink-3 uppercase">{g.head}</div>
            {g.items
              .filter((i) => !i.need || access[i.need])
              .map((it) => {
                const active = it.id === section;
                const badge = it.id === 'voicemail' ? unheard : it.id === 'calls' ? missed : 0;
                return (
                  <button
                    key={it.id}
                    type="button"
                    aria-current={active ? 'page' : undefined}
                    onClick={() => onPick(it.id)}
                    className={cx('relative flex h-8 shrink-0 items-center gap-2.5 rounded-[9px] pr-2 pl-2.5 text-left', active ? 'bg-[#EAEDFB] font-bold text-[#1B2A85] dark:bg-selection dark:text-primary' : 'font-medium text-ink hover:bg-subtle')}
                  >
                    <span className={cx('absolute top-[7px] bottom-[7px] left-0 w-[3px] rounded-r-[3px]', active ? 'bg-primary' : 'bg-transparent')} />
                    <Icon name={it.icon} size={16} className={cx('shrink-0', active ? 'text-primary' : 'text-ink-3')} />
                    <span className="min-w-0 flex-1 truncate">{it.label}</span>
                    {badge ? <span className="flex h-[18px] min-w-[18px] items-center justify-center rounded-[9px] bg-danger px-[5px] text-[10.5px] font-bold text-white tabular-nums">{badge > 99 ? '99+' : badge}</span> : null}
                  </button>
                );
              })}
          </div>
        ))}
      </div>
      {foot ? <div className="truncate border-t border-line px-3.5 py-2.5 text-[11.5px] text-ink-3">{foot}</div> : null}
    </nav>
  );
}
