import { MeetingInviteActions } from './MeetingInviteActions';
import { TaskReminderActions } from './TaskReminderActions';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { errorMessage } from '../../core/bridge';
import { relative } from '../../core/time';
import { toast } from '../../core/toasts';
import { Icon } from '../../components/Icon';
import { cx } from '../../components/ui';
import { act, appOf, K, openNotice, quickActions, snoozeChoices, snoozedLabel, type Notice } from './api';
import { Checkbox } from '../../components/Checkbox';

/**
 * One notification, as the drawer and the centre list it (NotifDrawer): its
 * app, what happened, how long ago, the button its link allows, and — on
 * hover — read/unread, snooze and dismiss. Dismissing and snoozing can be
 * undone from the toast they leave.
 */
export function NotifRow({ n, labels, selected, onSelect, checked, onCheck, onOpened }: {
  n: Notice;
  labels?: Record<string, string>;
  /** The centre's preview shows this one. */
  selected?: boolean;
  /** Given: a click selects (the centre); otherwise a click opens it (the drawer). */
  onSelect?: () => void;
  checked?: boolean;
  onCheck?: (on: boolean) => void;
  /** After it was opened (the drawer closes itself). */
  onOpened?: () => void;
}) {
  const qc = useQueryClient();
  const [snoozing, setSnoozing] = useState(false);
  const a = appOf(n.category, labels);
  const refresh = () => void qc.invalidateQueries({ queryKey: K.all });

  const run = async (fn: () => Promise<unknown>, done?: string, undo?: () => Promise<unknown>) => {
    try {
      await fn();
      refresh();
      if (done) toast('info', done, undo ? { label: 'Undo', run: () => void undo().then(refresh, (e) => toast('error', errorMessage(e))) } : undefined);
    } catch (e) {
      toast('error', errorMessage(e));
    }
  };
  const open = () => {
    if (!n.read) void act(n.id, 'read').then(refresh, () => undefined);
    openNotice(n);
    onOpened?.();
  };

  return (
    <div
      data-notice={n.id}
      data-category={n.category ?? ''}
      className={cx(
        'group relative flex gap-3 rounded-[12px] py-3 pr-4 pl-[22px] text-left',
        selected ? 'bg-selection dark:bg-[#1A2549]' : n.read ? 'hover:bg-subtle dark:hover:bg-[#141D38]' : 'bg-[#F4F6FD] hover:bg-subtle dark:bg-[#131C36] dark:hover:bg-[#162042]',
      )}
    >
      {onCheck ? (
        <Checkbox
          aria-label={`Select “${n.title}”`}
          checked={!!checked}
          onChange={(e) => onCheck(e.target.checked)}
          className={cx('absolute top-[13px] left-[6px] z-10', checked ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 focus:opacity-100')}
        />
      ) : null}
      {!n.read && !checked ? <span className={cx('absolute top-[25px] left-2 h-[7px] w-[7px] rounded-full bg-primary dark:bg-[#6C8CFF]', onCheck && 'group-hover:opacity-0')} aria-label="Unread" /> : null}
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[11px] [background:var(--tl)] dark:[background:var(--td)]" style={{ color: a.acc, ['--tl' as string]: a.tintLight, ['--td' as string]: a.tint }}>
        <Icon name={a.icon} size={17} />
      </span>
      <button type="button" onClick={onSelect ?? open} className="absolute inset-0 rounded-[12px]" aria-label={`${onSelect ? 'Show' : 'Open'} “${n.title}”`} />
      <div className="pointer-events-none relative min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <div className={cx('min-w-0 flex-1 text-[13.5px] leading-[1.35] text-ink dark:text-[#F2F4FB]', n.read ? 'font-medium' : 'font-bold')}>{n.title}</div>
          <span className="shrink-0 text-[11.5px] whitespace-nowrap text-ink-3 dark:text-[#8D96B8]">{relative(n.created_at)}</span>
        </div>
        {n.body ? <div className="mt-0.5 line-clamp-2 text-[12.5px] leading-[1.45] text-ink-2 dark:text-[#AAB2CF]">{n.body}</div> : null}
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {quickActions(n).map((q) => (
            <button
              key={q.label}
              type="button"
              onClick={open}
              className={cx(
                'pointer-events-auto inline-flex h-7 items-center rounded-[7px] px-2.5 text-[12px] font-bold whitespace-nowrap',
                q.primary ? 'bg-[#5B6CF0] text-white hover:bg-[#4E5FE0]' : 'border border-line text-ink hover:bg-subtle dark:border-[#2D3A66] dark:text-[#E8EBF7] dark:hover:bg-[#1A2442]',
              )}
            >
              {q.label}
            </button>
          ))}
          <TaskReminderActions notice={n} />
          <MeetingInviteActions notice={n} />
          {n.count > 1 ? <span className="rounded-full bg-subtle px-2 py-0.5 text-[11px] font-bold text-ink-2 dark:bg-[#1B2542] dark:text-[#C9CFE6]">{n.count} alike</span> : null}
          {n.snoozed_until && !n.archived ? <span className="text-[11.5px] font-semibold text-warning">Snoozed</span> : null}
          <span className="flex-1" />
          <span className="text-[11.5px] text-ink-3 dark:text-[#6B7496]">{a.short}</span>
        </div>
      </div>
      <div className={cx('absolute top-2 right-2.5 z-10 flex gap-0.5 rounded-[8px] bg-surface p-0.5 shadow-[0_0_0_1px_var(--ws-edge)] dark:bg-[#1A2442] dark:shadow-none', snoozing ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 focus-within:opacity-100')}>
        <Hover icon={n.read ? 'mail' : 'check'} label={n.read ? 'Mark as unread' : 'Mark as read'} onClick={() => void run(() => act(n.id, n.read ? 'unread' : 'read'))} />
        {!n.archived ? (
          <span className="relative">
            <Hover icon="snooze" label="Snooze" onClick={() => setSnoozing(!snoozing)} pressed={snoozing} />
            {snoozing ? (
              <SnoozeMenu
                onClose={() => setSnoozing(false)}
                onPick={(m) => {
                  setSnoozing(false);
                  void run(() => act(n.id, 'snooze', m), snoozedLabel(m), () => act(n.id, 'unsnooze'));
                }}
              />
            ) : null}
          </span>
        ) : null}
        {n.archived ? (
          <Hover icon="undo" label="Move back to the inbox" onClick={() => void run(() => act(n.id, 'unarchive'), 'Back in the inbox')} />
        ) : (
          <Hover icon="x" label="Dismiss" onClick={() => void run(() => act(n.id, 'archive'), 'Dismissed', () => act(n.id, 'unarchive'))} />
        )}
      </div>
    </div>
  );
}

function Hover({ icon, label, onClick, pressed }: { icon: string; label: string; onClick: () => void; pressed?: boolean }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={pressed}
      onClick={(e) => (e.stopPropagation(), onClick())}
      className={cx('flex h-[26px] w-[26px] items-center justify-center rounded-[6px] text-ink-2 hover:bg-subtle hover:text-ink dark:text-[#C9CFE6] dark:hover:bg-[#26315A]', pressed && 'bg-subtle dark:bg-[#26315A]')}
    >
      <Icon name={icon} size={14} />
    </button>
  );
}

export function SnoozeMenu({ onPick, onClose, align = 'right', up }: { onPick: (minutes: number) => void; onClose: () => void; align?: 'left' | 'right'; up?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.querySelector<HTMLButtonElement>('button')?.focus();
    const onDown = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && onClose();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && (e.stopPropagation(), onClose());
    const t = setTimeout(() => window.addEventListener('mousedown', onDown), 0);
    window.addEventListener('keydown', onKey, true);
    return () => {
      clearTimeout(t);
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [onClose]);
  return (
    <div ref={ref} role="menu" aria-label="Snooze until" className={cx('absolute z-30 w-[170px]', up ? 'bottom-9' : 'top-8', 'rounded-[10px] border border-line bg-surface p-1 shadow-[0_12px_30px_rgb(var(--ws-shadow-rgb)/.22)] dark:border-[#2D3A66] dark:bg-[#16203E]', align === 'right' ? 'right-0' : 'left-0')}>
      <div className="px-2 pt-1 pb-1 text-[10.5px] font-extrabold tracking-[.7px] text-ink-3 dark:text-[#8D96B8]">SNOOZE UNTIL</div>
      {snoozeChoices().map((c) => (
        <button key={c.label} type="button" role="menuitem" onClick={(e) => (e.stopPropagation(), onPick(c.minutes))} className="flex h-8 w-full items-center rounded-[7px] px-2 text-left text-[12.5px] font-semibold text-ink outline-none hover:bg-subtle focus:bg-subtle dark:text-[#E8EBF7] dark:hover:bg-[#1A2442] dark:focus:bg-[#1A2442]">
          {c.label}
        </button>
      ))}
    </div>
  );
}
