import { useStore } from '../../core/store';
import { dismiss, toasts, type Toast } from '../../core/toasts';
import { Icon } from '../../components/Icon';
import { cx } from '../../components/ui';

/**
 * Where the content is (worksuite-desktop#259, #263): right of the apps rail and of a module's own left panel — its
 * menu, folders or conversations, with what sits at their foot, like the website chats menu's "Taking chats" card —
 * and left of a right-hand panel or the AI or chat drawer (the workspace, `data-ai-workspace`, stops at a drawer).
 * Measured as the stack renders: the rail is 64px collapsed, 220px open, and panels can be hidden.
 */
export function contentSpan(): { left: number; right: number } {
  if (typeof document === 'undefined') return { left: 0, right: 0 };
  const rail = document.querySelector('nav[aria-label="Apps"]')?.getBoundingClientRect();
  const work = document.querySelector('[data-ai-workspace]')?.getBoundingClientRect();
  let left = Math.max(rail?.right ?? 0, work?.width ? work.left : 0);
  let right = work?.width ? work.right : document.documentElement.clientWidth || window.innerWidth;
  for (const el of document.querySelectorAll('[data-side-panel]')) {
    const r = el.getBoundingClientRect();
    // A background tab's panel has no size; one outside the content is not in the way.
    if (!r.width || r.right <= left || r.left >= right) continue;
    if (r.left <= left + 1) left = r.right;
    else if (r.right >= right - 1) right = r.left;
  }
  return { left: Math.round(left), right: Math.round(Math.max(left, right)) };
}

/**
 * One stack of at most three (worksuite-desktop#235), bottom-centre over the content and above the status bar
 * (#259, #263): never over the sidebar, a module's menu or anything else you navigate with, and high enough to
 * clear a pane's floating actions at its foot (the reading pane's Reply · Archive · Delete). Errors stay until
 * closed; the rest close by themselves.
 */
export function Toasts() {
  const items = useStore(toasts, (s) => s.items);
  const span = items.length ? contentSpan() : { left: 0, right: 0 };
  return (
    <div
      data-toast-stack
      className="pointer-events-none fixed bottom-[96px] z-[60] flex -translate-x-1/2 flex-col items-center gap-2"
      style={{ left: (span.left + span.right) / 2, width: Math.max(0, span.right - span.left - 32) || undefined }}
      aria-live="polite"
      role="status"
    >
      {items.map((t) => (
        <ToastRow key={t.id} t={t} />
      ))}
    </div>
  );
}

function ToastRow({ t }: { t: Toast }) {
  const buttons = [...(t.action ? [t.action] : []), ...(t.actions ?? [])];
  return (
    <div data-native-overlay data-toast={t.kind} className="animate-in pointer-events-auto flex max-w-[min(440px,100%)] min-w-[min(280px,100%)] items-center gap-3 rounded-[10px] bg-navy px-4 py-2.5 text-[13px] text-white shadow-xl">
      <Icon name={t.kind === 'error' ? 'alert' : t.kind === 'warning' ? 'warning' : t.kind === 'success' ? 'check-circle' : 'info'} size={17} className={cx(t.kind === 'error' ? 'text-stage-red' : t.kind === 'warning' ? 'text-stage-amber' : t.kind === 'success' ? 'text-stage-green' : 'text-teal-light')} />
      <span className="flex-1">
        {t.text}
        {t.count && t.count > 1 ? <span className="ml-1.5 rounded-full bg-white/15 px-1.5 text-[11px] font-semibold">×{t.count}</span> : null}
      </span>
      {buttons.map((b, i) => (
        <button key={`${b.label}-${i}`} type="button" className="shrink-0 font-semibold text-teal-light hover:underline" onClick={() => (b.run(), dismiss(t.id))}>
          {b.label}
        </button>
      ))}
      <button type="button" aria-label="Dismiss" className="shrink-0 text-white/60 hover:text-white" onClick={() => dismiss(t.id)}>
        <Icon name="x" size={14} />
      </button>
    </div>
  );
}
