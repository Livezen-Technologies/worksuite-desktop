import { useEffect, useRef, useState, type ReactNode } from 'react';
import { text } from '../../../core/i18n';
import { Icon } from '../../../components/Icon';
import { Menu, type MenuItem, type MenuSection } from '../../../components/Menu';
import { cx } from '../../../components/ui';
import { useOverflow } from './overflow';

/**
 * A row of grouped icon buttons (worksuite-desktop#188): 32 px buttons with
 * 18 px icons, a thin divider between groups, a tooltip with the name and
 * the shortcut, the accent background on what is on at the selection, and a
 * chevron on the ones that open a menu. What does not fit goes into ⋯ More,
 * worked out from the row's width as it changes.
 */

export interface ToolItem {
  id: string;
  label: string;
  icon?: string;
  /** Shown after the name in the tooltip. */
  keys?: string;
  /** On at the selection (aria-pressed). */
  active?: boolean;
  disabled?: boolean;
  /** Why it is disabled, in the tooltip and the More menu. */
  reason?: string;
  run?: () => void;
  /** Opens a menu (a chevron shows). */
  menu?: () => MenuSection[];
  /** Opens a panel under the row: reported as expanded. */
  expanded?: boolean;
  /** Words beside the icon (a font name, "Write with AI"). */
  caption?: string;
  /** The accent look (AI). */
  accent?: boolean;
  /** A small mark on the button (importance set, say). */
  badge?: ReactNode;
}

export interface ToolGroup {
  id: string;
  label: string;
  items: ToolItem[];
}

export function tooltip(item: Pick<ToolItem, 'label' | 'keys' | 'disabled' | 'reason'>): string {
  if (item.disabled && item.reason) return `${item.label} — ${item.reason}`;
  return item.keys ? `${item.label} (${item.keys})` : item.label;
}

/** A tool as a More-menu row: its menu becomes a submenu. */
function asMenuItem(t: ToolItem): MenuItem {
  return {
    id: t.id,
    label: t.label,
    icon: t.icon,
    shortcut: t.keys,
    checked: t.active ? true : undefined,
    disabled: t.disabled,
    reason: t.reason,
    ...(t.menu ? { submenu: t.menu() } : { onSelect: t.run }),
  };
}

/** Opens a tool's menu (or runs it) from outside — a shortcut; `n` changes for each request. */
export interface ToolRequest {
  id: string;
  n: number;
}

/** `keep`: which tools show (the signature editor's smaller set, worksuite-desktop#166). */
export function ToolbarRow({ groups, label, size = 'md', className, end, request, keep }: { groups: ToolGroup[]; label: string; size?: 'md' | 'sm'; className?: string; end?: ReactNode; request?: ToolRequest | null; keep?: (id: string) => boolean }) {
  const row = useRef<HTMLDivElement>(null);
  const anchor = useRef<HTMLElement | null>(null);
  const moreBtn = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState<string | null>(null);
  const shown = groups.map((g) => ({ ...g, items: g.items.filter((i) => i && (!keep || keep(i.id))) })).filter((g) => g.items.length);
  // The row as a flat list: dividers between groups count as items.
  const flat: Array<{ key: string; group: ToolGroup; item?: ToolItem }> = [];
  shown.forEach((g, i) => {
    if (i) flat.push({ key: `sep-${g.id}`, group: g });
    for (const it of g.items) flat.push({ key: it.id, group: g, item: it });
  });
  const fit = useOverflow(
    row,
    flat.map((f) => f.key),
    { moreWidth: size === 'md' ? 36 : 32 },
  );
  const hidden = flat.slice(fit).filter((f) => f.item);
  const moreSections: MenuSection[] = [];
  for (const f of hidden) {
    let s = moreSections.find((x) => x.id === f.group.id);
    if (!s) {
      s = { id: f.group.id, label: f.group.label, items: [] };
      moreSections.push(s);
    }
    s.items.push(asMenuItem(f.item!));
  }
  const openItem = flat.find((f) => f.item?.id === open)?.item;
  const latest = useRef(flat);
  useEffect(() => {
    latest.current = flat;
  });
  useEffect(() => {
    if (!request) return;
    const item = latest.current.find((f) => f.item?.id === request.id)?.item;
    if (!item || item.disabled) return;
    if (!item.menu) return item.run?.();
    const btn = row.current?.querySelector<HTMLElement>(`[data-ov="${request.id}"]`);
    // Overflowed into More: the menu opens from the More button.
    anchor.current = btn && !btn.hidden ? btn : moreBtn.current;
    setOpen(request.id);
  }, [request]);
  const h = size === 'md' ? 'h-8 min-w-8' : 'h-7 min-w-7';

  return (
    <div role="toolbar" aria-label={label} className={cx('flex min-w-0 items-center', className)}>
      <div ref={row} data-ov-row className="flex min-w-0 flex-1 items-center gap-0.5 overflow-hidden">
        {flat.map((f, i) => {
          const visible = i < fit;
          if (!f.item) return <span key={f.key} data-ov={f.key} aria-hidden className={cx('mx-1 h-5 w-px shrink-0 bg-line', !visible && 'hidden')} />;
          const t = f.item;
          return (
            <button
              key={f.key}
              data-ov={f.key}
              type="button"
              aria-label={t.label}
              title={tooltip(t)}
              aria-pressed={t.active === undefined || t.menu ? undefined : t.active}
              aria-haspopup={t.menu ? 'menu' : undefined}
              aria-expanded={t.menu ? open === t.id : t.expanded}
              aria-disabled={t.disabled || undefined}
              hidden={!visible}
              onMouseDown={(e) => e.preventDefault()}
              onClick={(e) => {
                if (t.disabled) return;
                if (t.menu) {
                  anchor.current = e.currentTarget;
                  setOpen(open === t.id ? null : t.id);
                } else t.run?.();
              }}
              className={cx(
                'relative inline-flex shrink-0 items-center justify-center gap-1 rounded-[7px] px-1.5 text-[12.5px] font-semibold transition-colors',
                h,
                t.disabled ? 'cursor-not-allowed text-ink-3 opacity-50' : t.accent ? 'text-primary hover:bg-selection' : 'text-ink-2 hover:bg-subtle hover:text-ink',
                !t.disabled && (t.active || t.expanded || open === t.id) && 'bg-selection text-primary',
                !visible && 'hidden',
              )}
            >
              {t.icon ? <Icon name={t.icon} size={size === 'md' ? 18 : 16} /> : null}
              {t.caption ? <span className="max-w-[110px] truncate">{t.caption}</span> : null}
              {t.badge}
              {t.menu ? <Icon name="chevron-down" size={12} className="-ml-0.5 text-ink-3" /> : null}
            </button>
          );
        })}
      </div>
      {hidden.length ? (
        <button
          ref={moreBtn}
          type="button"
          aria-label={text('More tools')}
          title={text('More tools')}
          aria-haspopup="menu"
          aria-expanded={open === '__more'}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => setOpen(open === '__more' ? null : '__more')}
          className={cx('inline-flex shrink-0 items-center justify-center rounded-[7px] text-ink-2 hover:bg-subtle hover:text-ink', h, open === '__more' && 'bg-selection text-primary')}
        >
          <Icon name="more" size={size === 'md' ? 18 : 16} />
        </button>
      ) : null}
      {end}
      {open === '__more' ? <Menu label={text('More tools')} anchor={moreBtn} prefer="bottom" align="end" sections={moreSections} onClose={() => setOpen(null)} /> : null}
      {openItem?.menu ? <Menu label={openItem.label} anchor={anchor} prefer="bottom" align="start" sections={openItem.menu()} onClose={() => setOpen(null)} /> : null}
    </div>
  );
}
