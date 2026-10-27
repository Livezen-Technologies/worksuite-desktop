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
export type CardKind = 'folder' | 'file' | 'meet' | 'note' | 'task' | 'event' | 'link' | 'deal' | 'lead' | 'account' | 'invoice' | 'contact' | 'mail' | 'meeting' | 'page';

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
  // A page of an app (worksuite-desktop#266): drawn in that app's own icon and colour (`app`), this only a fallback.
  page: { label: 'Page', icon: 'link', acc: '#AFC0FF', tint: '#1B2542', tintLight: '#EEF1FB' },
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
  app,
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
  /** The module strip in an app's own icon and colour (a page's card), its tints mixed from that colour. */
  app?: { icon: string; colour: string };
  children?: ReactNode;
}) {
  const k = app ? { ...KIND[kind], icon: app.icon, acc: app.colour, tint: `color-mix(in srgb, ${app.colour} 24%, #131B33)`, tintLight: `color-mix(in srgb, ${app.colour} 12%, #FFFFFF)` } : KIND[kind];
  return (
    <div
      data-card={kind}
      className={cx(
        'w-full max-w-[400px] overflow-hidden rounded-[12px] border bg-surface text-left text-ink shadow-[0_6px_18px_rgb(var(--ws-shadow-rgb)/.12)] dark:bg-rail dark:text-ink dark:shadow-[0_8px_24px_rgba(0,0,0,.25)]',
        live ? 'border-green-bright/60 dark:border-success-line' : 'border-line dark:border-line',
      )}
    >
      <div className="flex items-center gap-2 border-b border-line px-3.5 py-2.5 dark:border-subtle">
        <span className="flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-[6px] [background:var(--tl)] dark:[background:var(--td)]" style={{ color: k.acc, ['--tl' as string]: k.tintLight, ['--td' as string]: k.tint }}>
          <Icon name={k.icon} size={13} />
        </span>
        <span className="text-[11px] font-extrabold tracking-[.8px] uppercase" style={{ color: k.acc }}>
          {label ?? k.label}
        </span>
        <span className="flex-1" />
        {org ? <span className="truncate text-[11.5px] text-ink-3 dark:text-slate">{org}</span> : null}
      </div>
      {state === 'loading' ? (
        <div className="flex gap-3.5 px-3.5 py-4" aria-busy="true" aria-label="Loading">
          <span className="h-14 w-14 shrink-0 animate-pulse rounded-[12px] bg-subtle dark:bg-subtle" />
          <span className="flex flex-1 flex-col gap-2">
            <span className="h-3 w-[70%] animate-pulse rounded-[4px] bg-subtle dark:bg-subtle" />
            <span className="h-2.5 w-[45%] animate-pulse rounded-[4px] bg-subtle/70 dark:bg-subtle" />
            <span className="h-2.5 w-[55%] animate-pulse rounded-[4px] bg-subtle/70 dark:bg-subtle" />
          </span>
        </div>
      ) : state !== 'ok' ? (
        <div className="flex items-center gap-3 px-3.5 py-4">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[12px] bg-subtle text-ink-3 dark:bg-subtle dark:text-slate">
            <Icon name={state === 'noaccess' ? 'lock' : state === 'deleted' ? 'trash' : 'video-off'} size={20} />
          </span>
          <span className="min-w-0">
            <b className="block text-[14px]">{gone?.title ?? (state === 'noaccess' ? 'You don’t have access' : state === 'deleted' ? 'This item was deleted' : 'This meeting has ended')}</b>
            <span className="block text-[12.5px] text-ink-3 dark:text-slate">{gone?.sub ?? (state === 'noaccess' ? `Ask the person who shared it to share this ${(label ?? k.label).split(' · ').pop()!.toLowerCase()} with you.` : state === 'deleted' ? 'It was removed and can’t be opened.' : '')}</span>
          </span>
        </div>
      ) : (
        children
      )}
      {actions.length || foot ? (
        <div className="flex items-center gap-1.5 border-t border-line bg-well px-3.5 py-2.5 dark:border-subtle dark:bg-rail">
          {actions.map((a) => (
            <button
              key={a.label}
              type="button"
              disabled={a.disabled}
              onClick={(e) => (e.stopPropagation(), a.onClick())}
              className={cx(
                'inline-flex h-8 items-center gap-1.5 rounded-[8px] px-3.5 text-[12.5px] font-bold whitespace-nowrap disabled:opacity-50',
                a.tone === 'go' ? 'bg-green text-white hover:bg-success' : a.tone === 'primary' ? 'bg-blue text-white hover:bg-brand-soft' : 'border border-line text-ink hover:bg-subtle dark:border-primary-soft dark:text-ink dark:hover:bg-subtle',
              )}
            >
              {a.label}
            </button>
          ))}
          <span className="flex-1" />
          {foot ? <span className="truncate text-[11.5px] text-ink-3 dark:text-slate">{foot}</span> : null}
        </div>
      ) : null}
    </div>
  );
}

/** A small rounded chip inside a card: status, due date, counts. */
export function Chip({ children, tone = 'plain' }: { children: ReactNode; tone?: 'plain' | 'blue' | 'green' | 'amber' | 'red' | 'pink' }) {
  const cls = {
    plain: 'bg-subtle text-ink-2 dark:bg-subtle dark:text-slate-ink',
    blue: 'bg-selection text-primary dark:bg-info-soft dark:text-info-ink',
    green: 'bg-success-bg text-success-ink',
    amber: 'bg-warning-bg text-warning-ink dark:text-amber',
    red: 'bg-danger-bg text-danger dark:text-danger-ink',
    pink: 'bg-rose-bg text-rose-ink',
  }[tone];
  return <span className={cx('inline-flex h-[22px] items-center gap-1 rounded-[11px] px-2 text-[11.5px] font-bold whitespace-nowrap', cls)}>{children}</span>;
}

/** Initials in a small round badge, for people on a card. */
export function Faces({ names, max = 3 }: { names: string[]; max?: number }) {
  const shown = names.slice(0, max);
  return (
    <span className="flex -space-x-1.5">
      {shown.map((n, i) => (
        <span key={i} title={n} className="flex h-6 w-6 items-center justify-center rounded-full border-2 border-surface bg-stage-4 text-[9.5px] font-extrabold text-white dark:border-subtle" style={{ background: FACE[i % FACE.length] }}>
          {n
            .split(/\s+/)
            .filter(Boolean)
            .slice(0, 2)
            .map((w) => w[0]!.toUpperCase())
            .join('')}
        </span>
      ))}
      {names.length > max ? <span className="flex h-6 items-center pl-2.5 text-[11px] font-bold text-ink-3 dark:text-slate">+{names.length - max}</span> : null}
    </span>
  );
}

const FACE = ['#1E6B4E', '#7C5CDB', '#B45309', '#0E7C86', '#23349E', '#9B2C2C'];
