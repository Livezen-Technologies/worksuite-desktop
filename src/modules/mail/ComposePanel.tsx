import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { text } from '../../core/i18n';
import { Icon } from '../../components/Icon';
import { ResizeDivider, useResizableWidth, type ResizableWidth } from '../../components/ResizeDivider';
import { placeMenu } from '../../components/menuPlacement';
import { Spinner, cx } from '../../components/ui';
import type { Template } from './types';

/**
 * The composer's side panel (worksuite-desktop#213): Templates and Send
 * later beside the message. 300 px to begin with, 260–380 px by dragging its
 * edge (remembered on this computer), hidden with its ⇥ button, and never
 * wider than the room the message leaves it, so nothing in it is cut off.
 * When the composer is narrower than about 900 px it is not docked at all:
 * Template ▾ and Send ▾ open its sections as a popover instead.
 */

export const PANEL_DEFAULT = 300;
export const PANEL_MIN = 260;
export const PANEL_MAX = 380;
/** Below this composer width the panel is not docked. */
export const PANEL_NARROW = 900;
/** The least the message keeps beside a docked panel. */
export const FORM_MIN = 520;

const HIDDEN_KEY = 'ws.mail.composePanel.hidden';

/**
 * Where the panel goes for a composer `area` px wide: docked (and how wide),
 * or not (too narrow, or hidden). An area not laid out yet (0) counts as wide.
 */
export function panelLayout(area: number, stored: number, hidden: boolean): { docked: boolean; narrow: boolean; width: number } {
  const narrow = area > 0 && area < PANEL_NARROW;
  const clamped = Math.min(PANEL_MAX, Math.max(PANEL_MIN, stored));
  const width = area > 0 ? Math.max(0, Math.min(clamped, area - FORM_MIN)) : clamped;
  return { docked: !hidden && !narrow && width >= PANEL_MIN, narrow, width };
}

function readHidden(): boolean {
  try {
    return localStorage.getItem(HIDDEN_KEY) === '1';
  } catch {
    return false;
  }
}

function storeHidden(hidden: boolean): void {
  try {
    if (hidden) localStorage.setItem(HIDDEN_KEY, '1');
    else localStorage.removeItem(HIDDEN_KEY);
  } catch {
    // Only a convenience: the panel shows again next time.
  }
}

/** The width of `ref`, followed as it changes (0 until it is laid out). */
export function useWidth(ref: RefObject<HTMLElement | null>): number {
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const read = () => setWidth(el.clientWidth);
    read();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return width;
}

export type PanelSection = 'templates' | 'later';

export interface ComposePanelState {
  layout: ReturnType<typeof panelLayout>;
  resize: ResizableWidth;
  hidden: boolean;
  setHidden: (hidden: boolean) => void;
  /** A section opened as a popover, and the button it hangs from. */
  popover: { section: PanelSection; anchor: RefObject<HTMLElement | null> } | null;
  /** Show a section: in the docked panel when there is one, else as a popover at `anchor`. */
  reveal: (section: PanelSection, anchor: RefObject<HTMLElement | null>) => void;
  closePopover: () => void;
}

export function useComposePanel(area: RefObject<HTMLElement | null>): ComposePanelState {
  const areaWidth = useWidth(area);
  const resize = useResizableWidth('mail.composePanel', { defaultWidth: PANEL_DEFAULT, min: PANEL_MIN, max: PANEL_MAX });
  const [hidden, setHiddenState] = useState(readHidden);
  const [popover, setPopover] = useState<ComposePanelState['popover']>(null);
  const layout = panelLayout(areaWidth, resize.width, hidden);
  const setHidden = useCallback((h: boolean) => {
    storeHidden(h);
    setHiddenState(h);
    if (!h) setPopover(null);
  }, []);
  const reveal = (section: PanelSection, anchor: RefObject<HTMLElement | null>) => {
    if (layout.docked) {
      setPopover(null);
      const el = area.current?.querySelector<HTMLElement>(`[data-panel-section="${section}"]`);
      el?.scrollIntoView?.({ block: 'nearest' });
      el?.querySelector<HTMLElement>('input, button')?.focus();
      return;
    }
    setPopover({ section, anchor });
  };
  // Docked again (wider, or shown): no popover alongside it.
  return { layout, resize, hidden, setHidden, popover: layout.docked ? null : popover, reveal, closePopover: () => setPopover(null) };
}

export interface LaterChoice {
  id: string;
  label: string;
  when: string;
}

export interface PanelContentProps {
  templates: Template[];
  templatesLoading: boolean;
  onTemplate: (t: Template) => void;
  choices: LaterChoice[];
  later: string | null;
  onLater: (id: string | null) => void;
  pick: string;
  onPick: (v: string) => void;
  onSchedule: () => void;
  scheduling: boolean;
  canSchedule: boolean;
  offline: boolean;
}

function TemplatesSection({ templates, templatesLoading, onTemplate }: Pick<PanelContentProps, 'templates' | 'templatesLoading' | 'onTemplate'>) {
  const [query, setQuery] = useState('');
  const q = query.trim().toLowerCase();
  const list = templates.filter((t) => !q || t.name.toLowerCase().includes(q));
  return (
    <section data-panel-section="templates" aria-label={text('Templates')} className="flex min-w-0 flex-col gap-2.5">
      <h3 className="text-[13.5px] font-bold text-ink">{text('Templates')}</h3>
      <label className="flex h-9 min-w-0 items-center gap-2 rounded-[8px] border border-line bg-surface px-2.5 text-[13px] focus-within:border-primary">
        <Icon name="search" size={14} className="shrink-0 text-ink-3" />
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={text('Search templates')} aria-label={text('Search templates')} className="bare-focus min-w-0 flex-1 bg-transparent text-ink outline-none placeholder:text-ink-3" />
      </label>
      {templatesLoading ? <Spinner label="" /> : null}
      {!templatesLoading && list.length === 0 ? <p className="text-[12.5px] leading-snug break-words text-ink-3">{query ? text('No template matches.') : text('No templates yet. Make them in WorkSuite Mail on the web.')}</p> : null}
      <ul role="list" className="flex min-w-0 flex-col gap-1.5">
        {list.map((t) => (
          <li key={t.id} className="min-w-0">
            <button type="button" onClick={() => onTemplate(t)} className="w-full min-w-0 rounded-[8px] border border-line px-3 py-2 text-left hover:border-primary hover:bg-subtle">
              <span className="block truncate text-[13px] font-semibold text-ink">{t.name}</span>
              <span className="block truncate text-[12px] text-ink-3">{t.mine ? (t.shared ? text('Mine · shared') : text('Mine')) : text('Shared with you')}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function LaterSection(p: Omit<PanelContentProps, 'templates' | 'templatesLoading' | 'onTemplate'>) {
  const rows = [...p.choices, { id: 'pick', label: text('Pick a date and time'), when: '' }];
  return (
    <section data-panel-section="later" aria-label={text('Send later')} className="flex min-w-0 flex-col gap-2.5">
      <h3 className="text-[13.5px] font-bold text-ink">{text('Send later')}</h3>
      <div role="radiogroup" aria-label={text('Send later')} className="flex min-w-0 flex-col gap-1.5">
        {rows.map((c) => (
          <button key={c.id} type="button" role="radio" aria-checked={p.later === c.id} onClick={() => p.onLater(p.later === c.id ? null : c.id)} className={cx('flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-0.5 rounded-[8px] border px-3 py-2 text-left text-[13px]', p.later === c.id ? 'border-primary bg-selection' : 'border-line hover:bg-subtle')}>
            <span aria-hidden className={cx('inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2', p.later === c.id ? 'border-primary' : 'border-ink-3')}>{p.later === c.id ? <span className="h-2 w-2 rounded-full bg-primary" /> : null}</span>
            <span className="min-w-0 flex-1 text-ink">{c.label}</span>
            {c.when ? <span className="shrink-0 text-[12px] whitespace-nowrap text-ink-3">{c.when}</span> : null}
          </button>
        ))}
        {p.later === 'pick' ? <input type="datetime-local" aria-label={text('Date and time to send')} value={p.pick} min={new Date().toISOString().slice(0, 16)} onChange={(e) => p.onPick(e.target.value)} className="h-9 w-full min-w-0 rounded-[8px] border border-line bg-surface px-2 text-[13px] text-ink" /> : null}
      </div>
      <button
        type="button"
        onClick={p.onSchedule}
        disabled={!p.canSchedule || p.scheduling || p.offline}
        title={p.offline ? text('Scheduling needs WorkSuite.') : !p.later ? text('Choose when to send it.') : undefined}
        className="inline-flex h-8 items-center justify-center gap-1.5 rounded-[8px] bg-primary px-3 text-[13px] font-semibold text-[var(--ws-on-primary)] hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-50"
      >
        {p.scheduling ? <Icon name="spinner" size={14} className="animate-spin" /> : <Icon name="clock" size={14} />}
        {text('Schedule')}
      </button>
      <p className="text-[12px] leading-snug break-words text-ink-3">{text('Scheduled mail is sent by the WorkSuite server, so this computer can be off.')}</p>
    </section>
  );
}

/** The docked panel: its sections, the ⇥ button that hides it, and the divider on its edge. */
export function ComposeSidePanel({ state, ...content }: PanelContentProps & { state: ComposePanelState }) {
  return (
    <aside aria-label={text('Templates and send later')} data-compose-panel style={{ width: state.layout.width }} className="relative flex min-h-0 min-w-0 shrink-0 flex-col border-l border-line bg-surface">
      <ResizeDivider state={state.resize} side="left" label={text('Resize the side panel')} />
      <div className="flex h-10 shrink-0 items-center justify-end border-b border-line px-2">
        <button type="button" onClick={() => state.setHidden(true)} aria-label={text('Hide side panel')} title={text('Hide side panel')} className="inline-flex h-7 w-7 items-center justify-center rounded-[7px] text-ink-3 hover:bg-subtle hover:text-ink">
          <Icon name="panel-right-close" size={16} />
        </button>
      </div>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-5 overflow-x-hidden overflow-y-auto p-4 scroll-thin">
        <TemplatesSection templates={content.templates} templatesLoading={content.templatesLoading} onTemplate={content.onTemplate} />
        <LaterSection {...content} />
      </div>
    </aside>
  );
}

/** One section of the panel as a popover (the composer is narrow, or the panel hidden). */
export function PanelPopover({ state, ...content }: PanelContentProps & { state: ComposePanelState }) {
  const p = state.popover;
  if (!p) return null;
  return (
    <Popover anchor={p.anchor} label={p.section === 'templates' ? text('Templates') : text('Send later')} onClose={state.closePopover}>
      {p.section === 'templates' ? <TemplatesSection templates={content.templates} templatesLoading={content.templatesLoading} onTemplate={(t) => (content.onTemplate(t), state.closePopover())} /> : <LaterSection {...content} />}
    </Popover>
  );
}

/** A small floating panel at a button: placed like a menu (on screen, flipped when there is no room), closed by Esc or a click outside. */
export function Popover({ anchor, label, onClose, children, width = 300 }: { anchor: RefObject<HTMLElement | null>; label: string; onClose: () => void; children: ReactNode; width?: number }) {
  const box = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number; maxHeight: number; maxWidth: number } | null>(null);
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    // No button to hang from (it went into More meanwhile): near the top, in the middle.
    const a = anchor.current?.getBoundingClientRect() ?? { left: window.innerWidth / 2, top: 64, width: 0, height: 0 };
    const r = placeMenu({
      trigger: { left: a.left, top: a.top, width: a.width, height: a.height },
      menu: { width, height: el.scrollHeight || 320 },
      viewport: { width: window.innerWidth, height: window.innerHeight },
      prefer: 'bottom',
      align: 'start',
    });
    setPos({ left: r.left, top: r.top, maxHeight: r.maxHeight, maxWidth: r.maxWidth });
  }, [anchor, width]);
  useEffect(() => {
    const down = (e: PointerEvent) => {
      const t = e.target as Node;
      if (box.current?.contains(t) || anchor.current?.contains(t)) return;
      onClose();
    };
    document.addEventListener('pointerdown', down);
    return () => document.removeEventListener('pointerdown', down);
  }, [anchor, onClose]);
  return createPortal(
    <div
      ref={box}
      role="dialog"
      aria-label={label}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation();
          onClose();
          anchor.current?.focus();
        }
      }}
      style={{ position: 'fixed', left: pos?.left ?? 0, top: pos?.top ?? 0, width, maxWidth: pos?.maxWidth, maxHeight: pos?.maxHeight, visibility: pos ? 'visible' : 'hidden' }}
      className="z-50 flex flex-col overflow-x-hidden overflow-y-auto rounded-[12px] border border-line bg-surface p-4 shadow-xl scroll-thin"
    >
      {children}
    </div>,
    document.body,
  );
}
