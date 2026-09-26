import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Icon } from '../../components/Icon';
import { cx } from '../../components/ui';

export type MenuItem =
  | { sep: true }
  | { label: string; hint?: string; icon?: string; tag?: { text: string; tone: string }; danger?: boolean; strong?: boolean; disabled?: boolean; run: () => void };

/**
 * A menu at a point (right-click) or under a button: arrow keys move, Enter
 * picks, Esc or a click elsewhere closes. It stays inside the window.
 */
export function PopMenu({ at, items, label, onClose, width = 280, head }: { at: { x: number; y: number }; items: MenuItem[]; label: string; onClose: () => void; width?: number; head?: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState(at);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setPos({ x: Math.max(8, Math.min(at.x, window.innerWidth - r.width - 8)), y: Math.max(8, Math.min(at.y, window.innerHeight - r.height - 8)) });
    el.querySelector<HTMLButtonElement>('button[role="menuitem"]:not(:disabled)')?.focus();
  }, [at]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
      e.preventDefault();
      const list = [...(ref.current?.querySelectorAll<HTMLButtonElement>('button[role="menuitem"]:not(:disabled)') ?? [])];
      const i = list.indexOf(document.activeElement as HTMLButtonElement);
      list[(i + (e.key === 'ArrowDown' ? 1 : -1) + list.length) % list.length]?.focus();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  return (
    <>
      <div className="no-drag fixed inset-0 z-40" onMouseDown={onClose} onContextMenu={(e) => (e.preventDefault(), onClose())} />
      <div ref={ref} role="menu" aria-label={label} className="no-drag fixed z-50 flex max-h-[calc(100vh-16px)] flex-col overflow-y-auto rounded-[12px] border border-line bg-surface p-1.5 text-[13px] shadow-[0_18px_44px_rgb(var(--ws-shadow-rgb)/.25)] scroll-thin" style={{ left: pos.x, top: pos.y, width }}>
        {head}
        {items.map((m, i) =>
          'sep' in m ? (
            <div key={`s${i}`} className="mx-1.5 my-1 h-px shrink-0 bg-line" />
          ) : (
            <button
              key={m.label}
              type="button"
              role="menuitem"
              disabled={m.disabled}
              onClick={() => {
                onClose();
                m.run();
              }}
              className={cx('flex min-h-[30px] shrink-0 items-center gap-2 rounded-[7px] px-2.5 text-left outline-none hover:bg-ground focus:bg-selection disabled:opacity-45', m.danger ? 'text-danger' : 'text-ink', m.strong && 'font-semibold')}
            >
              {m.tag ? <span className={cx('flex h-6 w-6 shrink-0 items-center justify-center rounded-[6px] text-[8.5px] font-bold', m.tag.tone)}>{m.tag.text}</span> : m.icon ? <Icon name={m.icon} size={15} className={m.danger ? '' : 'text-ink-2'} /> : null}
              <span className="flex-1">{m.label}</span>
              {m.hint ? <span className="text-[11px] text-ink-3">{m.hint}</span> : null}
            </button>
          ),
        )}
      </div>
    </>
  );
}

/** Where a menu opened from a button should sit: under it, right-aligned when asked. */
export function below(el: HTMLElement, align: 'left' | 'right' = 'left', width = 280): { x: number; y: number } {
  const r = el.getBoundingClientRect();
  return { x: align === 'right' ? r.right - width : r.left, y: r.bottom + 4 };
}
