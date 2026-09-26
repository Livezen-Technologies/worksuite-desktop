import { useRef, useState, type ReactNode } from 'react';
import { cx } from '../../../components/ui';
import type { Rect } from './layout';
import { callUi } from './state';

export interface PanelTab {
  id: string;
  label: string;
  badge?: number;
  content: ReactNode;
}

/**
 * CallSidePanel: Chat, People, Board, Files, Info — one panel with tabs,
 * beside the stage rather than over it, so a shared screen is never covered
 * on a desktop-sized window. Drag its left edge to make it wider or narrower
 * (320–600 px, remembered). In a narrow window there is no room beside the
 * stage, so it lies over the call instead; the call carries on underneath.
 *
 * Every tab stays mounted while the panel is open: switching tabs keeps the
 * chat's scroll and what is being typed, and nothing here touches the call.
 */
export function CallSidePanel({ tabs, active, rect, docked, width }: { tabs: PanelTab[]; active: string; rect: Rect; docked: boolean; width: number }) {
  const [live, setLive] = useState<number | null>(null);
  const start = useRef<{ x: number; w: number } | null>(null);
  const shown = tabs.find((t) => t.id === active) ?? tabs[0];
  if (!shown) return null;

  return (
    <aside
      aria-label="Call panel"
      className={cx('no-drag absolute z-[30] flex flex-col bg-surface text-ink', docked ? 'border-l border-line' : 'shadow-[-12px_0_40px_rgba(0,0,0,.45)]')}
      style={{ left: docked ? rect.x - ((live ?? width) - width) : rect.x, top: rect.y, width: docked ? (live ?? width) : rect.width, height: rect.height }}
    >
      {docked ? (
        <span
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize the panel"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === 'ArrowLeft') callUi.set({ panelWidth: width + 20 });
            if (e.key === 'ArrowRight') callUi.set({ panelWidth: width - 20 });
          }}
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId);
            start.current = { x: e.clientX, w: width };
            setLive(width);
          }}
          onPointerMove={(e) => {
            const s = start.current;
            if (s) setLive(Math.max(320, Math.min(600, s.w + (s.x - e.clientX))));
          }}
          onPointerUp={() => {
            if (live !== null) callUi.set({ panelWidth: live });
            start.current = null;
            setLive(null);
          }}
          className="absolute top-0 bottom-0 -left-1 z-10 w-2 cursor-col-resize hover:bg-primary/30 focus-visible:bg-primary/40"
        />
      ) : null}
      <div role="tablist" aria-label="Panel" className="flex shrink-0 items-center border-b border-line px-2">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={t.id === shown.id}
            onClick={() => callUi.set({ panelTab: t.id })}
            className={cx('relative h-[42px] px-2.5 text-[12.5px]', t.id === shown.id ? 'font-bold text-primary shadow-[inset_0_-2px_0_var(--color-primary)]' : 'font-medium text-ink-2 hover:text-ink')}
          >
            {t.label}
            {t.badge ? <span className="ml-1 rounded-full bg-[#E0522F] px-1.5 text-[10.5px] font-bold text-white">{t.badge}</span> : null}
          </button>
        ))}
        <span className="flex-1" />
        <button type="button" aria-label="Close the panel" onClick={() => callUi.set({ panelOpen: false })} className="flex h-8 w-8 items-center justify-center rounded-[8px] text-[16px] text-ink-2 hover:bg-subtle hover:text-ink">
          ×
        </button>
      </div>
      {tabs.map((t) => (
        <div key={t.id} role="tabpanel" hidden={t.id !== shown.id} className="min-h-0 flex-1 overflow-y-auto scroll-thin">
          {t.content}
        </div>
      ))}
    </aside>
  );
}
