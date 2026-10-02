import { useEffect, useRef } from 'react';
import { app } from '../../core/app-state';
import { t } from '../../core/i18n';
import { useStore } from '../../core/store';
import { Icon } from '../../components/Icon';
import { CountBadge, cx } from '../../components/ui';
import { aiWidget, openAssistant, ui, useAiDisplay } from '../../core/ui';
import { phaseLabel } from '../../modules/ai/session';
import { aiDock, aiNotice, AssistantBody, unreadLabel, useAssistantActivity } from './AiDock';

/**
 * The floating AI widget (#61; Settings › AI Assistant › Display mode › Floating chat widget).
 *
 * A launcher in the bottom-right corner of the workspace — only the workspace: never over the sidebar, the tabs,
 * the status bar or a drawer — that opens the same Ask / Write / Changes as the drawer, on the same conversation.
 * Minimize and Close put it back to the launcher and lose nothing (the conversation is assistantSession's, not
 * this panel's): an answer on its way still lands, the launcher turns while it is coming and says where it is, and
 * one that arrives unseen is counted on it, with a notice beside it (worksuite-desktop#110). Maximize fills the
 * workspace; it always keeps inside it. Escape minimises.
 */
export function AiWidget() {
  const display = useAiDisplay();
  const { open, maximized } = useStore(aiWidget, (s) => s);
  const { busy, unread, phase, engine } = useAssistantActivity();
  const autoMinimize = useStore(app, (s) => s.prefs?.ai?.autoMinimize ?? false);
  const launcher = useRef<HTMLButtonElement>(null);
  // Back to the launcher by the keyboard or a button: the focus goes with it, not to the page underneath.
  const refocus = useRef(false);
  useEffect(() => {
    if (!open && refocus.current) {
      refocus.current = false;
      launcher.current?.focus();
    }
  }, [open]);

  // The drawer and Hidden have no launcher, but an answer that arrives unseen is still told, in the same corner.
  if (display !== 'widget') return display === 'drawer' || display === 'hidden' ? <AiNotice /> : null;
  const collapse = () => {
    refocus.current = true;
    aiWidget.set({ open: false });
  };

  if (!open) {
    // Working, or waiting on the person: where it is. Done: how many answers wait unread.
    const state = busy || phase === 'needsInput' ? phaseLabel(phase, engine) : unread ? unreadLabel(unread) : null;
    return (
      <div className="pointer-events-none absolute right-4 bottom-4 z-20 flex flex-col items-end gap-2">
        <AiNotice />
        <button
          ref={launcher}
          type="button"
          onClick={() => aiWidget.set({ open: true })}
          aria-label={state ? `${t('ai.launcher')} — ${state}` : t('ai.launcher')}
          aria-expanded={false}
          title={state ?? t('ai.launcher')}
          className="pointer-events-auto relative flex h-12 w-12 items-center justify-center rounded-full bg-navy text-teal-light shadow-[0_8px_20px_rgb(var(--ws-shadow-rgb)/.3)] transition-transform hover:scale-105 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
        >
          {/* Answering: a ring turns round the icon. With reduced motion it stands still, and the dot says it. */}
          {busy ? <span aria-hidden data-testid="ai-launcher-busy" className="absolute inset-0 rounded-full border-2 border-teal-light/25 border-t-teal-light motion-safe:animate-spin" /> : null}
          <Icon name="sparkles" size={20} className={cx(busy && 'motion-safe:animate-pulse')} />
          {busy ? <span aria-hidden data-testid="ai-launcher-still" className="absolute top-0.5 right-0.5 h-2.5 w-2.5 rounded-full border-2 border-navy bg-teal-light motion-reduce:block motion-safe:hidden" /> : null}
          {/* Waiting on the person: a still mark, never a motion that asks for attention. */}
          {!busy && phase === 'needsInput' ? <span aria-hidden data-testid="ai-launcher-input" className="absolute -top-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-navy bg-warning" /> : null}
          {!busy && phase !== 'needsInput' && unread ? <CountBadge n={unread} className="absolute -top-1 -right-1" /> : null}
        </button>
        <span role="status" className="sr-only">
          {state ?? ''}
        </span>
      </div>
    );
  }

  return (
    <section
      role="dialog"
      aria-label={t('ai.title')}
      onKeyDown={(e) => {
        if (e.key === 'Escape' && !e.defaultPrevented) {
          e.stopPropagation();
          collapse();
        }
      }}
      className={cx(
        'absolute z-20 flex flex-col overflow-hidden rounded-[16px] border border-line bg-surface shadow-[0_18px_48px_rgb(var(--ws-shadow-rgb)/.28)] motion-safe:animate-[ws-fade-in_.14s_ease-out]',
        maximized ? 'inset-3' : 'right-4 bottom-4 h-[min(600px,calc(100%-2rem))] w-[min(400px,calc(100%-2rem))]',
      )}
    >
      <header className="flex items-center gap-1 border-b border-line py-2 pr-2 pl-4">
        <div className="flex min-w-0 flex-1 items-center gap-2 text-[14.5px] font-bold text-ink">
          <Icon name="sparkles" size={17} className={cx('text-teal', busy && 'motion-safe:animate-pulse')} />
          <span className="truncate">{t('ai.title')}</span>
          {busy ? <span className="sr-only">{phaseLabel(phase, engine)}</span> : null}
        </div>
        <WidgetButton icon="minus" label={t('ai.minimize')} onClick={collapse} />
        <WidgetButton icon={maximized ? 'minimize' : 'maximize'} label={maximized ? t('ai.restore') : t('ai.maximize')} onClick={() => aiWidget.set({ maximized: !maximized })} />
        <WidgetButton icon="x" label={t('ai.close')} onClick={collapse} />
      </header>
      {/* Settings › AI Assistant › Auto-minimize after sending: down to the launcher once a question goes. */}
      <AssistantBody autoFocus onMinimize={collapse} onSent={autoMinimize ? collapse : undefined} />
    </section>
  );
}

/**
 * The notice an unseen answer leaves (worksuite-desktop#110): Your answer is ready / Needs your input / could not
 * answer, with the way to it. It never takes the keyboard's focus and never opens the assistant by itself: it is a
 * polite status, and the person chooses View reply or Open Assistant, or puts it away. Nothing shows while the
 * notification settings say quiet (useAssistantAlerts), and nothing moves under reduced motion.
 */
export function AiNotice() {
  const kind = useStore(aiNotice, (s) => s.kind);
  const display = useAiDisplay();
  const docked = useStore(ui, (s) => s.dock === 'ai');
  const floating = useStore(aiWidget, (s) => s.open);
  const shown = !!kind && !(display === 'widget' ? floating : docked);
  const text = kind === 'input' ? t('ai.needsInput') : kind === 'failed' ? t('ai.failed') : t('ai.complete');
  const go = () => {
    aiNotice.set({ kind: null });
    aiDock.set({ view: 'ask' });
    openAssistant();
  };
  // In widget mode it sits above the launcher; otherwise in the same corner on its own.
  const alone = display !== 'widget';
  return (
    <div role="status" aria-live="polite" className={cx('pointer-events-none', alone && 'absolute right-4 bottom-4 z-20')}>
      {shown ? (
        <div data-testid="ai-notice" className="pointer-events-auto flex max-w-[280px] items-center gap-2 rounded-[12px] border border-line bg-surface py-2 pr-1.5 pl-3 text-[12.5px] text-ink shadow-[0_8px_20px_rgb(var(--ws-shadow-rgb)/.18)] motion-safe:animate-[ws-fade-in_.14s_ease-out]">
          <Icon name={kind === 'ready' ? 'sparkles' : 'alert'} size={15} className={cx('shrink-0', kind === 'failed' ? 'text-danger' : kind === 'input' ? 'text-warning' : 'text-teal')} />
          <span className="min-w-0 flex-1 font-semibold">{text}</span>
          <button type="button" onClick={go} className="h-7 shrink-0 rounded-[7px] px-2 font-semibold text-primary hover:bg-subtle">
            {kind === 'ready' ? t('ai.viewReply') : t('ai.openAssistant')}
          </button>
          <button type="button" onClick={() => aiNotice.set({ kind: null })} aria-label={t('ai.dismiss')} title={t('ai.dismiss')} className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[7px] text-ink-3 hover:bg-subtle hover:text-ink">
            <Icon name="x" size={13} />
          </button>
        </div>
      ) : null}
    </div>
  );
}

function WidgetButton({ icon, label, onClick }: { icon: string; label: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} aria-label={label} title={label} className="flex h-8 w-8 items-center justify-center rounded-[8px] text-ink-2 hover:bg-subtle hover:text-ink focus-visible:outline-2 focus-visible:outline-primary">
      <Icon name={icon} size={16} />
    </button>
  );
}
