import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState, type RefObject } from 'react';
import { useTab } from '../../core/tab-context';
import { Icon } from '../../components/Icon';
import { Menu, type MenuItem, type MenuSection } from '../../components/Menu';
import { cx } from '../../components/ui';
import { useExtensions, useForwards, useMe } from './api';
import { atLabel, awayForwardTo, awayHint, CALL_STATUS, CALL_STATUSES, DND_LENGTHS, dndEnd, statusLabel, type CallStatus } from './lib/callstatus';
import { usePhoneState } from './softphone/client';
import { chooseCallStatus, linkCallStatus, useCallStatus, type CallStatusView } from './status';

/**
 * The status in the Phone's header (worksuite-desktop#288): a compact pill — the status's dot, its name, and when a
 * Do not disturb for a while ends ("Do not disturb · until 3:30 PM", on the person's clock) — that opens the shared
 * `Menu` under it, aligned to its right edge and flipped above when there is no room. It is a button styled like the
 * header's other buttons: a click leaves no ring (the app's `:focus-visible` ring is for the keyboard), and focus put
 * back on it after a choice made with the pointer draws none either (`data-pointer-focus`, see styles.css).
 *
 * The menu: Available, Busy, Do not disturb and Away, each with its dot and what it does to a call, the chosen one
 * ticked; Do not disturb for… (30 minutes, 1 hour, 2 hours, until tomorrow, until turned off, each with when it
 * ends); whether calls share the WorkSuite status with Chat and Website chats or have their own; and Call settings
 * (forwarding, voicemail, the devices that ring) at its foot. Up and Down move, Right or Enter opens Do not disturb
 * for…, Enter chooses, Escape closes and puts focus back on the pill.
 */
const WORKSUITE_LABEL: Record<string, string> = { available: 'Available', busy: 'Busy', dnd: 'Do not disturb', away: 'Away', offline: 'Appear offline' };

const MENU_WIDTH = 320;

function Dot({ status }: { status: CallStatus }) {
  return (
    <span aria-hidden="true" data-status-dot={status} className="flex w-4 shrink-0 justify-center">
      <span className={cx('h-2.5 w-2.5 rounded-full', CALL_STATUS[status].dot)} />
    </span>
  );
}

export function StatusMenu() {
  const view = useCallStatus();
  const anchor = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  // A choice made with the pointer puts focus back on the pill without a ring; a key brings the ring back.
  const [quiet, setQuiet] = useState(false);
  useEffect(() => {
    if (!quiet) return;
    const loud = () => setQuiet(false);
    document.addEventListener('keydown', loud, true);
    return () => document.removeEventListener('keydown', loud, true);
  }, [quiet]);
  const label = statusLabel(view, view.now);
  const scope = view.linked ? 'Your WorkSuite status, for Chat, Website chats and calls' : view.canLink && view.workSuite ? `For calls only. Your WorkSuite status is ${WORKSUITE_LABEL[view.workSuite] ?? view.workSuite}.` : undefined;
  return (
    <>
      <button
        ref={anchor}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Status: ${label}`}
        title={scope}
        data-call-status={view.status}
        data-pointer-focus={quiet ? '' : undefined}
        onPointerDown={() => setQuiet(true)}
        onBlur={() => !open && setQuiet(false)}
        onClick={() => setOpen((v) => !v)}
        className={cx(
          'no-drag inline-flex h-8 min-w-0 max-w-[320px] items-center gap-2 rounded-[8px] border border-line bg-surface px-3 text-[13px] font-semibold whitespace-nowrap text-ink transition-colors hover:bg-subtle',
          open && 'bg-subtle',
        )}
      >
        <span aria-hidden="true" className={cx('h-2 w-2 shrink-0 rounded-full', CALL_STATUS[view.status].dot)} />
        <span className="min-w-0 truncate">{label}</span>
        <Icon name="chevron-down" size={13} className={cx('shrink-0 text-ink-3 transition-transform motion-reduce:transition-none', open && 'rotate-180')} />
      </button>
      {open ? <StatusMenuList anchor={anchor} view={view} onClose={(how) => (setOpen(false), setQuiet(how === 'pointer'))} /> : null}
    </>
  );
}

/** The menu on its own: the statuses, Do not disturb for…, sharing the WorkSuite status, and Call settings. */
export function StatusMenuList({ anchor, view, onClose }: { anchor: RefObject<HTMLElement | null>; view: CallStatusView; onClose: (how: 'pointer' | 'keyboard') => void }) {
  const qc = useQueryClient();
  const { go } = useTab();
  // Where Away sends calls: the switch's word when it gives one, else the person's "When busy" rule to a number.
  const ext = usePhoneState((s) => s.extension);
  const exts = useExtensions();
  const mine = exts.data?.find((e) => e.extension === ext) ?? null;
  const rules = useForwards(mine?.id ?? null, !!mine);
  const me = useMe();
  const forward = awayForwardTo(rules.data, mine?.id ?? null, me.data?.offered ? me.data.data.away_forward_to : null);
  // Whether the last thing done in the menu was with a key: focus goes back to the pill with a ring then.
  const keyed = useRef(false);
  useEffect(() => {
    const k = () => (keyed.current = true);
    const p = () => (keyed.current = false);
    document.addEventListener('keydown', k, true);
    document.addEventListener('pointerdown', p, true);
    return () => {
      document.removeEventListener('keydown', k, true);
      document.removeEventListener('pointerdown', p, true);
    };
  }, []);

  const pick = (status: CallStatus, until: number | null = null) => void chooseCallStatus(qc, status, until);

  const statuses: MenuItem[] = CALL_STATUSES.map((id) => ({
    id: `status-${id}`,
    label: CALL_STATUS[id].label,
    description: id === 'away' ? awayHint(forward) : CALL_STATUS[id].hint,
    leading: <Dot status={id} />,
    radio: true,
    checked: view.status === id,
    onSelect: () => pick(id),
  }));

  const dndFor: MenuItem = {
    id: 'dnd-for',
    label: 'Do not disturb for…',
    icon: 'moon',
    description: view.until ? `On until ${atLabel(view.until, view.now)}` : undefined,
    submenu: [
      {
        id: 'lengths',
        items: DND_LENGTHS.map((d) => {
          const end = dndEnd(d.id, view.now);
          return {
            id: `dnd-${d.id}`,
            label: d.label,
            meta: end ? atLabel(end, view.now) : undefined,
            metaLabel: end ? `Ends ${atLabel(end, view.now)}` : undefined,
            // Measured from the moment it is chosen, not from when the menu opened.
            onSelect: () => pick('dnd', dndEnd(d.id, Date.now())),
          };
        }),
      },
    ],
  };

  const share: MenuItem[] = view.canLink
    ? [
        {
          id: 'link',
          label: 'Same status for Chat and Website chats',
          description: view.linked ? 'Changing it here changes it everywhere' : `Calls have their own. Your WorkSuite status is ${WORKSUITE_LABEL[view.workSuite ?? ''] ?? view.workSuite}`,
          checked: view.linked,
          onSelect: () => void linkCallStatus(qc, !view.linked),
        },
      ]
    : [];

  const sections: MenuSection[] = [
    { id: 'statuses', label: view.linked ? 'Chat, Website chats and calls' : view.canLink ? 'Calls only' : undefined, items: statuses },
    { id: 'dnd', items: [dndFor] },
    { id: 'share', items: share },
  ];

  return (
    <Menu
      label="Status"
      anchor={anchor}
      prefer="bottom"
      align="end"
      width={MENU_WIDTH}
      sections={sections}
      footer={[{ id: 'call-settings', label: 'Call settings', icon: 'settings', onSelect: () => go('/phone/forwarding') }]}
      onClose={() => onClose(keyed.current ? 'keyboard' : 'pointer')}
    />
  );
}
