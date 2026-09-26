import type { ReactNode } from 'react';
import { Icon } from '../../../components/Icon';
import { cx } from '../../../components/ui';

/**
 * The frame every shared item sits in (ChatShareCard): a module strip —
 * its icon on a tint, its name in its colour, the company on the right —
 * the item as this reader may see it, and one to three actions with a note
 * beside them. The same frame shows while it loads, when the reader cannot
 * open it, when it is gone, and when a meeting has ended.
 *
 * Colours come from the design ("Chat — shared items as cards"): each module
 * has an accent and a tint; the frame itself follows the theme.
 */
export type CardKind = 'folder' | 'file' | 'meet' | 'note' | 'task' | 'event' | 'link' | 'deal' | 'lead' | 'account' | 'invoice' | 'contact' | 'mail' | 'meeting';

export const KIND: Record<CardKind, { label: string; icon: string; acc: string; tint: string; tintLight: string }> = {
  folder: { label: 'Drive · Folder', icon: 'folder', acc: '#F0A43A', tint: '#2A2213', tintLight: '#FDF1DF' },
  file: { label: 'Drive · File', icon: 'file-text', acc: '#F0A43A', tint: '#2A2213', tintLight: '#FDF1DF' },
  meet: { label: 'Meet', icon: 'video', acc: '#34C38F', tint: '#12291F', tintLight: '#E3F6EE' },
  meeting: { label: 'Meeting', icon: 'calendar-clock', acc: '#34C38F', tint: '#12291F', tintLight: '#E3F6EE' },
  note: { label: 'Note', icon: 'notebook', acc: '#F5C451', tint: '#2A2613', tintLight: '#FDF6DC' },
  task: { label: 'Task', icon: 'tasks', acc: '#6C8CFF', tint: '#16203E', tintLight: '#E8EDFF' },
  event: { label: 'Calendar · Event', icon: 'calendar', acc: '#E0629B', tint: '#2A1624', tintLight: '#FCE7F1' },
  link: { label: 'Link', icon: 'link', acc: '#AFC0FF', tint: '#1B2542', tintLight: '#EEF1FB' },
  deal: { label: 'CRM · Deal', icon: 'handshake', acc: '#3FB7C8', tint: '#10262B', tintLight: '#E1F4F6' },
  lead: { label: 'CRM · Lead', icon: 'user-plus', acc: '#3FB7C8', tint: '#10262B', tintLight: '#E1F4F6' },
  account: { label: 'CRM · Account', icon: 'building', acc: '#3FB7C8', tint: '#10262B', tintLight: '#E1F4F6' },
  invoice: { label: 'Invoice', icon: 'receipt', acc: '#9B7CF6', tint: '#1F1836', tintLight: '#F1ECFE' },
  contact: { label: 'Contact', icon: 'contact', acc: '#4FC3A1', tint: '#11281F', tintLight: '#E3F6EE' },
  mail: { label: 'Mail · Thread', icon: 'mail', acc: '#6C8CFF', tint: '#16203E', tintLight: '#E8EDFF' },
};

export interface CardAction {
  label: string;
  onClick: () => void;
  tone?: 'primary' | 'go' | 'plain';
  disabled?: boolean;
}

export type CardState = 'ok' | 'loading' | 'noaccess' | 'deleted' | 'ended';

export function CardFrame({
  kind,
  label,
  org,
  state = 'ok',
  gone,
  actions = [],
  foot,
  live,
  children,
}: {
  kind: CardKind;
  /** Overrides the module strip's words ("Meet · scheduled"). */
  label?: string;
  org?: string | null;
  state?: CardState;
  /** What to say when the item cannot be shown. */
  gone?: { title: string; sub: string };
  actions?: CardAction[];
  foot?: ReactNode;
  /** A meeting going on now: the frame is edged in green. */
  live?: boolean;
  children?: ReactNode;
}) {
  const k = KIND[kind];
  return (
    <div
      data-card={kind}
      className={cx(
        'w-[440px] max-w-full overflow-hidden rounded-[14px] border bg-surface text-left text-ink shadow-[0_6px_18px_rgb(var(--ws-shadow-rgb)/.12)] dark:bg-[#131B33] dark:text-[#E8EBF7] dark:shadow-[0_8px_24px_rgba(0,0,0,.25)]',
        live ? 'border-[#34C38F]/60 dark:border-[#1F6B4E]' : 'border-line dark:border-[#26315A]',
      )}
    >
      <div className="flex items-center gap-2 border-b border-line px-3.5 py-2.5 dark:border-[#1E2848]">
        <span className="flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-[6px] [background:var(--tl)] dark:[background:var(--td)]" style={{ color: k.acc, ['--tl' as string]: k.tintLight, ['--td' as string]: k.tint }}>
          <Icon name={k.icon} size={13} />
        </span>
        <span className="text-[11px] font-extrabold tracking-[.8px] uppercase" style={{ color: k.acc }}>
          {label ?? k.label}
        </span>
        <span className="flex-1" />
        {org ? <span className="truncate text-[11.5px] text-ink-3 dark:text-[#8D96B8]">{org}</span> : null}
      </div>
      {state === 'loading' ? (
        <div className="flex gap-3.5 px-3.5 py-4" aria-busy="true" aria-label="Loading">
          <span className="h-14 w-14 shrink-0 animate-pulse rounded-[12px] bg-subtle dark:bg-[#1B2542]" />
          <span className="flex flex-1 flex-col gap-2">
            <span className="h-3 w-[70%] animate-pulse rounded-[4px] bg-subtle dark:bg-[#1B2542]" />
            <span className="h-2.5 w-[45%] animate-pulse rounded-[4px] bg-subtle/70 dark:bg-[#172039]" />
            <span className="h-2.5 w-[55%] animate-pulse rounded-[4px] bg-subtle/70 dark:bg-[#172039]" />
          </span>
        </div>
      ) : state !== 'ok' ? (
        <div className="flex items-center gap-3 px-3.5 py-4">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[12px] bg-subtle text-ink-3 dark:bg-[#1B2542] dark:text-[#8D96B8]">
            <Icon name={state === 'noaccess' ? 'lock' : state === 'deleted' ? 'trash' : 'video-off'} size={20} />
          </span>
          <span className="min-w-0">
            <b className="block text-[14px]">{gone?.title ?? (state === 'noaccess' ? 'You don’t have access' : state === 'deleted' ? 'This item was deleted' : 'This meeting has ended')}</b>
            <span className="block text-[12.5px] text-ink-3 dark:text-[#8D96B8]">{gone?.sub ?? (state === 'noaccess' ? `Ask the person who shared it to share this ${(label ?? k.label).split(' · ').pop()!.toLowerCase()} with you.` : state === 'deleted' ? 'It was removed and can’t be opened.' : '')}</span>
          </span>
        </div>
      ) : (
        children
      )}
      {actions.length || foot ? (
        <div className="flex items-center gap-1.5 border-t border-line bg-well px-3.5 py-2.5 dark:border-[#1E2848] dark:bg-[#10172C]">
          {actions.map((a) => (
            <button
              key={a.label}
              type="button"
              disabled={a.disabled}
              onClick={(e) => (e.stopPropagation(), a.onClick())}
              className={cx(
                'inline-flex h-8 items-center gap-1.5 rounded-[8px] px-3.5 text-[12.5px] font-bold whitespace-nowrap disabled:opacity-50',
                a.tone === 'go' ? 'bg-[#1F9D6B] text-white hover:bg-[#1A8A5E]' : a.tone === 'primary' ? 'bg-[#5B6CF0] text-white hover:bg-[#4E5FE0]' : 'border border-line text-ink hover:bg-subtle dark:border-[#2D3A66] dark:text-[#E8EBF7] dark:hover:bg-[#1A2442]',
              )}
            >
              {a.label}
            </button>
          ))}
          <span className="flex-1" />
          {foot ? <span className="truncate text-[11.5px] text-ink-3 dark:text-[#8D96B8]">{foot}</span> : null}
        </div>
      ) : null}
    </div>
  );
}

/** A small rounded chip inside a card: status, due date, counts. */
export function Chip({ children, tone = 'plain' }: { children: ReactNode; tone?: 'plain' | 'blue' | 'green' | 'amber' | 'red' | 'pink' }) {
  const cls = {
    plain: 'bg-subtle text-ink-2 dark:bg-[#1B2542] dark:text-[#C9CFE6]',
    blue: 'bg-selection text-primary dark:bg-[#16203E] dark:text-[#AFC0FF]',
    green: 'bg-[#E3F6EE] text-[#0B6B4A] dark:bg-[#12291F] dark:text-[#6FE0B0]',
    amber: 'bg-[#FFF4E0] text-[#9A4A06] dark:bg-[#2A2213] dark:text-[#F5C451]',
    red: 'bg-[#FCE9E4] text-[#B42318] dark:bg-[#2B1515] dark:text-[#FF8A7A]',
    pink: 'bg-[#FCE7F1] text-[#9D174D] dark:bg-[#2A1624] dark:text-[#FFB3D4]',
  }[tone];
  return <span className={cx('inline-flex h-[22px] items-center gap-1 rounded-[11px] px-2 text-[11.5px] font-bold whitespace-nowrap', cls)}>{children}</span>;
}

/** Initials in a small round badge, for people on a card. */
export function Faces({ names, max = 3 }: { names: string[]; max?: number }) {
  const shown = names.slice(0, max);
  return (
    <span className="flex -space-x-1.5">
      {shown.map((n, i) => (
        <span key={i} title={n} className="flex h-6 w-6 items-center justify-center rounded-full border-2 border-surface bg-[#2F4A7A] text-[9.5px] font-extrabold text-white dark:border-[#131B33]" style={{ background: FACE[i % FACE.length] }}>
          {n
            .split(/\s+/)
            .filter(Boolean)
            .slice(0, 2)
            .map((w) => w[0]!.toUpperCase())
            .join('')}
        </span>
      ))}
      {names.length > max ? <span className="flex h-6 items-center pl-2.5 text-[11px] font-bold text-ink-3 dark:text-[#8D96B8]">+{names.length - max}</span> : null}
    </span>
  );
}

const FACE = ['#1E6B4E', '#7C5CDB', '#B45309', '#0E7C86', '#23349E', '#9B2C2C'];
