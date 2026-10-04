import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { app } from '../../core/app-state';
import { apiGet, apiPost } from '../../core/api';
import { errorMessage } from '../../core/bridge';
import { text } from '../../core/i18n';
import { useStore } from '../../core/store';
import { toast } from '../../core/toasts';
import { Icon } from '../../components/Icon';
import { cx } from '../../components/ui';
import { UserAvatar } from '../../components/UserAvatar';

/** The statuses a person can choose; everybody sees it on their avatar, and website chats are routed by it (#230). */
export const STATUS_CHOICES: Array<{ id: string; label: string; dot: string; taking: string }> = [
  { id: 'available', label: 'Available', dot: 'bg-success', taking: 'Taking chats' },
  { id: 'busy', label: 'Busy', dot: 'bg-danger', taking: 'Busy · no new chats' },
  { id: 'dnd', label: 'Do not disturb', dot: 'bg-danger', taking: 'Do not disturb' },
  { id: 'away', label: 'Away', dot: 'bg-warning', taking: 'Away · no new chats' },
  { id: 'offline', label: 'Appear offline', dot: 'bg-line', taking: 'Not taking chats' },
];

/**
 * "Set your status", one control for every chat surface: under Chat's list, and at the foot of the Website Chats menu
 * (C-01), where it says whether I am taking chats and how many I have open. The presence heartbeat keeps it live.
 */
export function MyStatus({ variant = 'chat', open = 0 }: { variant?: 'chat' | 'website'; open?: number }) {
  const qc = useQueryClient();
  const user = useStore(app, (s) => s.auth?.user);
  const [menu, setMenu] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const me = useQuery({ queryKey: ['chat', 'presence', 'me'], queryFn: ({ signal }) => apiGet<{ status: string; choice: string }>('/api/chat/presence/me', undefined, signal), refetchInterval: 60_000, retry: false });
  const choice = STATUS_CHOICES.find((c) => c.id === (me.data?.choice ?? 'available')) ?? STATUS_CHOICES[0]!;
  // Away by itself (no input for a while) shows as away, whatever was chosen.
  const shown = me.data?.status === 'away' && choice.id === 'available' ? STATUS_CHOICES.find((c) => c.id === 'away')! : choice;
  useEffect(() => {
    if (!menu) return;
    const off = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setMenu(false);
    window.addEventListener('mousedown', off);
    return () => window.removeEventListener('mousedown', off);
  }, [menu]);
  const pick = async (id: string) => {
    setMenu(false);
    try {
      await apiPost('/api/chat/presence', { status: id, active: true });
      void qc.invalidateQueries({ queryKey: ['chat', 'presence'] });
      void qc.invalidateQueries({ queryKey: ['account', 'presence'] });
    } catch (e) {
      toast('error', errorMessage(e));
    }
  };
  const avatar = (size: number) => (
    <span className="relative shrink-0">
      <UserAvatar userId={user?.id} name={user?.name} size={size} />
      <span className={cx('absolute -right-px -bottom-px h-[10px] w-[10px] rounded-full border-2 border-surface', shown.dot)} />
    </span>
  );
  const list = (
    <div role="menu" aria-label={text('Your status')} className={cx('absolute z-30 w-52 rounded-[10px] border border-line bg-surface py-1 shadow-xl', variant === 'website' ? 'bottom-full left-0 mb-1' : 'top-9 left-0')}>
      {STATUS_CHOICES.map((c) => (
        <button key={c.id} type="button" role="menuitemradio" aria-checked={c.id === choice.id} onClick={() => void pick(c.id)} className="flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-[13px] text-ink hover:bg-subtle">
          <span className={cx('h-2.5 w-2.5 rounded-full', c.dot)} /> {text(c.label)}
          {c.id === choice.id ? <Icon name="check" size={14} className="ml-auto text-primary" /> : null}
        </button>
      ))}
    </div>
  );
  if (variant === 'website') {
    if (me.isError) return null;
    return (
      <div ref={ref} className="relative mt-auto pt-3">
        <button type="button" aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu(!menu)} className="flex w-full items-center gap-2 rounded-[10px] border border-line bg-surface px-2 py-1.5 text-left hover:bg-subtle">
          {avatar(28)}
          <span className="min-w-0 flex-1">
            <b className="block truncate text-[12.5px] text-ink">{text(shown.taking)}</b>
            <span className="block truncate text-[11.5px] text-ink-3">{text('{n} open · {status}', { n: open, status: text(shown.label) })}</span>
          </span>
          <Icon name="chevron-down" size={13} className="shrink-0 text-ink-3" />
        </button>
        {menu ? list : null}
      </div>
    );
  }
  return (
    <div ref={ref} className="relative flex flex-1 items-center gap-2">
      {avatar(32)}
      <button type="button" aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu(!menu)} className="h-[30px] flex-1 truncate rounded-[7px] border border-line px-2 text-left text-[12px] text-ink-2 hover:bg-subtle">
        Set your status · {choice.label}
      </button>
      {menu ? list : null}
    </div>
  );
}
