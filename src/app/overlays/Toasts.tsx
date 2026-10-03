import { useStore } from '../../core/store';
import { dismiss, toasts } from '../../core/toasts';
import { Icon } from '../../components/Icon';
import { cx } from '../../components/ui';

export function Toasts() {
  const items = useStore(toasts, (s) => s.items);
  return (
    <div className="pointer-events-none fixed bottom-10 left-1/2 z-[60] flex -translate-x-1/2 flex-col items-center gap-2" aria-live="polite" role="status">
      {items.map((t) => (
        <div data-native-overlay key={t.id} className="animate-in pointer-events-auto flex min-w-[280px] max-w-[520px] items-center gap-3 rounded-[10px] bg-navy px-4 py-2.5 text-[13px] text-white shadow-xl">
          <Icon name={t.kind === 'error' ? 'alert' : t.kind === 'warning' ? 'warning' : t.kind === 'success' ? 'check-circle' : 'info'} size={17} className={cx(t.kind === 'error' ? 'text-[#F07167]' : t.kind === 'warning' ? 'text-[#F0A04B]' : t.kind === 'success' ? 'text-[#43B581]' : 'text-teal-light')} />
          <span className="flex-1">{t.text}</span>
          {t.action ? (
            <button type="button" className="font-semibold text-teal-light hover:underline" onClick={() => (t.action!.run(), dismiss(t.id))}>
              {t.action.label}
            </button>
          ) : null}
          <button type="button" aria-label="Dismiss" className="text-white/60 hover:text-white" onClick={() => dismiss(t.id)}>
            <Icon name="x" size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}
