import { useStore } from '../../core/store';
import { dismiss, toasts, type Toast } from '../../core/toasts';
import { Icon } from '../../components/Icon';
import { cx } from '../../components/ui';

/** Where the stack sits: right of the apps rail, so it never covers the rail or a reading pane's actions. */
function railRight(): number {
  if (typeof document === 'undefined') return 0;
  const nav = document.querySelector('nav[aria-label="Apps"]');
  return nav ? Math.max(0, Math.round(nav.getBoundingClientRect().right)) : 0;
}

/**
 * One stack of at most three, bottom-left above the status bars (worksuite-desktop#235): bottom-centre sat over
 * the reading pane's Reply · Archive · Delete. Errors stay until closed; the rest close by themselves.
 */
export function Toasts() {
  const items = useStore(toasts, (s) => s.items);
  // Measured as the stack renders (the rail is 64px collapsed, 220px open).
  const left = items.length ? railRight() : 0;
  return (
    <div
      data-toast-stack
      className="pointer-events-none fixed bottom-[64px] z-[60] flex max-w-[calc(100vw-32px)] flex-col items-start gap-2"
      style={{ left: left + 16 }}
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
    <div data-native-overlay data-toast={t.kind} className="animate-in pointer-events-auto flex min-w-[280px] max-w-[440px] items-center gap-3 rounded-[10px] bg-navy px-4 py-2.5 text-[13px] text-white shadow-xl">
      <Icon name={t.kind === 'error' ? 'alert' : t.kind === 'warning' ? 'warning' : t.kind === 'success' ? 'check-circle' : 'info'} size={17} className={cx(t.kind === 'error' ? 'text-[#F07167]' : t.kind === 'warning' ? 'text-[#F0A04B]' : t.kind === 'success' ? 'text-[#43B581]' : 'text-teal-light')} />
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
