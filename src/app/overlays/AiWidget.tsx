import { useEffect, useRef, type Ref } from 'react';
import { app } from '../../core/app-state';
import { t } from '../../core/i18n';
import { useStore } from '../../core/store';
import { Icon } from '../../components/Icon';
import { CountBadge, cx } from '../../components/ui';
import { aiWidget, openAssistant, ui, useAiDisplay } from '../../core/ui';
import { answerPreview, assistantSession, phaseLabel } from '../../modules/ai/session';
import { aiNotice, AssistantBody, unreadLabel, useAssistantActivity } from './AiDock';
import { AI_ASSISTANT_ATTR, aiMinimized, restoreAssistant } from './aiMinimize';

/** Spread on the assistant's own surfaces: a press on one is using the assistant, not carrying on with work (#126). */
const OWN = { [AI_ASSISTANT_ATTR]: '' };

/**
 * The floating AI widget (#61; Settings › AI Assistant › Display mode › Floating chat widget).
 *
 * A launcher in the bottom-right corner of the workspace — only the workspace: never over the sidebar, the tabs,
 * the status bar or a drawer — that opens the same Ask / Write / Changes as the drawer, on the same conversation.
 * Minimize and Close put it back to the launcher and lose nothing (the conversation is assistantSession's, not
 * this panel's): an answer on its way still lands, the launcher turns while it is coming and says where it is, and
 * one that arrives unseen is counted on it, with a preview beside it (worksuite-desktop#110, #126). Maximize fills
 * the workspace; it always keeps inside it. Escape minimises.
 *
 * With the drawer, the same floating button stands in the corner while the assistant is minimised (#126).
 */
export function AiWidget() {
  const display = useAiDisplay();
  const { open, maximized } = useStore(aiWidget, (s) => s);
  const { busy } = useAssistantActivity();
  const minimized = useStore(aiMinimized, (s) => s.on);
  const autoMinimize = useStore(app, (s) => s.prefs?.ai?.autoMinimize ?? false);
  const launcher = useRef<HTMLButtonElement>(null);
  // Back to the launcher by the keyboard or a button: the focus goes with it, not to the page underneath. Put down
  // automatically (the person carried on working), it stays wherever they are.
  const refocus = useRef(false);
  useEffect(() => {
    if (!open && refocus.current) {
      refocus.current = false;
      launcher.current?.focus();
    }
  }, [open]);

  // The drawer and Hidden have no launcher: the floating button only while the assistant is minimised, and an answer
  // that arrives unseen is still told, in the same corner.
  if (display !== 'widget') return minimized ? <AiBubble /> : <AiNotice />;
  const collapse = () => {
    refocus.current = true;
    aiWidget.set({ open: false });
  };

  if (!open) return <AiBubble always buttonRef={launcher} />;

  return (
    <section
      role="dialog"
      aria-label={t('ai.title')}
      {...OWN}
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
          {busy ? <span className="sr-only">{t('ai.thinking')}</span> : null}
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
 * The floating AI button (worksuite-desktop#110, #126): the widget's launcher, and — with the drawer — the assistant
 * while it is minimised. While a question is on its way a ring turns round it and its tooltip says Thinking…; under
 * reduced motion the ring stands still and a dot says it instead. Done, the motion stops and the answer waits,
 * counted, with its preview above. Needs your input and a failure are still marks, never a motion that asks for
 * attention. Stop processing sits beside it while it works. It never opens the assistant by itself.
 *
 * `always`: the widget's launcher, there whether or not anything is waiting. Otherwise it stands only while there is
 * something to wait for or to see.
 */
function AiBubble({ always, buttonRef }: { always?: boolean; buttonRef?: Ref<HTMLButtonElement> }) {
  const { busy, unread, phase, engine } = useAssistantActivity();
  const notice = useStore(aiNotice, (s) => s.kind);
  const failed = phase === 'failed';
  const waiting = phase === 'needsInput';
  if (!always && !busy && !waiting && !unread && !notice) return <AiNotice />;
  // Working, or waiting on the person: where it is. Done: how many answers wait unread, or that it failed.
  const state = busy || waiting ? phaseLabel(phase, engine) : unread ? (failed ? t('ai.failed') : unreadLabel(unread)) : null;
  const open = () => {
    // Something to see goes straight to the conversation and its latest answer; otherwise it opens as it was left.
    if (busy || waiting || unread || notice) restoreAssistant();
    else openAssistant();
  };
  return (
    <div {...OWN} className="pointer-events-none absolute right-4 bottom-4 z-20 flex flex-col items-end gap-2">
      <AiNotice />
      <div className="flex items-center gap-2">
        {busy ? (
          <button
            type="button"
            onClick={() => assistantSession.cancel()}
            aria-label={t('ai.stop')}
            title={t('ai.stop')}
            className="pointer-events-auto flex h-8 w-8 items-center justify-center rounded-full border border-line bg-surface text-ink shadow-[0_4px_12px_rgb(var(--ws-shadow-rgb)/.18)] hover:bg-subtle focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          >
            <Icon name="stop" size={12} />
          </button>
        ) : null}
        <button
          ref={buttonRef}
          type="button"
          onClick={open}
          aria-label={state ? `${t('ai.launcher')} — ${state}` : t('ai.launcher')}
          aria-expanded={false}
          title={busy ? t('ai.thinking') : (state ?? t('ai.launcher'))}
          data-testid="ai-bubble"
          data-state={busy ? 'thinking' : waiting ? 'needsInput' : failed && unread ? 'failed' : unread ? 'ready' : 'idle'}
          className="pointer-events-auto relative flex h-12 w-12 items-center justify-center rounded-full bg-navy text-teal-light shadow-[0_8px_20px_rgb(var(--ws-shadow-rgb)/.3)] transition-transform hover:scale-105 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
        >
          {/* Answering: a ring turns round the icon. With reduced motion it stands still, and the dot says it. */}
          {busy ? <span aria-hidden data-testid="ai-launcher-busy" className="absolute inset-0 rounded-full border-2 border-teal-light/25 border-t-teal-light motion-safe:animate-spin" /> : null}
          <Icon name="sparkles" size={20} className={cx(busy && 'motion-safe:animate-pulse')} />
          {busy ? <span aria-hidden data-testid="ai-launcher-still" className="absolute top-0.5 right-0.5 h-2.5 w-2.5 rounded-full border-2 border-navy bg-teal-light motion-reduce:block motion-safe:hidden" /> : null}
          {/* Waiting on the person, or failed: a still mark, never a motion that asks for attention. */}
          {!busy && waiting ? <span aria-hidden data-testid="ai-launcher-input" className="absolute -top-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-navy bg-warning" /> : null}
          {!busy && !waiting && failed && unread ? <span aria-hidden data-testid="ai-launcher-failed" className="absolute -top-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-navy bg-danger" /> : null}
          {!busy && !waiting && !failed && unread ? <CountBadge n={unread} className="absolute -top-1 -right-1" /> : null}
        </button>
      </div>
      <span role="status" className="sr-only">
        {state ?? ''}
      </span>
    </div>
  );
}

/**
 * The preview an unseen answer leaves (worksuite-desktop#110, #126): Your answer is ready / Needs your input / could not
 * answer, the answer's first lines, and the way to it — View Result (Open Assistant to answer what it asks, Try again
 * after a failure) and Dismiss. It never takes the keyboard's focus and never opens the assistant by itself: it is a
 * polite status, and the person chooses. Nothing shows while the notification settings say quiet
 * (useAssistantAlerts), nothing moves under reduced motion, and while WorkSuite is locked it says nothing of the answer.
 */
export function AiNotice() {
  const kind = useStore(aiNotice, (s) => s.kind);
  const display = useAiDisplay();
  const docked = useStore(ui, (s) => s.dock === 'ai');
  const floating = useStore(aiWidget, (s) => s.open);
  const minimized = useStore(aiMinimized, (s) => s.on);
  const locked = useStore(app, (s) => !!s.lock?.locked);
  const entries = useStore(assistantSession.store, (s) => s.entries);
  const shown = !!kind && !(display === 'widget' ? floating : docked);
  const title = kind === 'input' ? t('ai.needsInput') : kind === 'failed' ? t('ai.failed') : t('ai.complete');
  const preview = shown ? answerPreview(entries, locked) : '';
  const canRetry = kind === 'failed' && !!entries.at(-1)?.retry;
  // Above the floating button; with the drawer and no button, in the corner on its own.
  const alone = display !== 'widget' && !minimized;
  const action = 'h-7 shrink-0 rounded-[7px] px-2 text-[12px] font-semibold';
  return (
    <div role="status" aria-live="polite" {...OWN} className={cx('pointer-events-none', alone && 'absolute right-4 bottom-4 z-20')}>
      {shown ? (
        <div data-testid="ai-notice" className="pointer-events-auto flex w-[300px] max-w-[calc(100vw-2rem)] flex-col gap-1.5 rounded-[12px] border border-line bg-surface px-3 py-2.5 text-[12.5px] text-ink shadow-[0_8px_20px_rgb(var(--ws-shadow-rgb)/.18)] motion-safe:animate-[ws-fade-in_.14s_ease-out]">
          <div className="flex items-center gap-2">
            <Icon name={kind === 'ready' ? 'sparkles' : 'alert'} size={15} className={cx('shrink-0', kind === 'failed' ? 'text-danger' : kind === 'input' ? 'text-warning' : 'text-teal')} />
            <span className="min-w-0 flex-1 font-semibold">{title}</span>
          </div>
          {preview ? (
            <p data-testid="ai-notice-preview" className="line-clamp-3 text-[12px] leading-[1.45] text-ink-2">
              {preview}
            </p>
          ) : null}
          <div className="flex flex-wrap items-center justify-end gap-1">
            {canRetry ? (
              <button type="button" onClick={() => void assistantSession.retry()} className={cx(action, 'text-primary hover:bg-subtle')}>
                {t('ai.retry')}
              </button>
            ) : null}
            <button type="button" onClick={restoreAssistant} className={cx(action, 'text-primary hover:bg-subtle')}>
              {kind === 'input' ? t('ai.openAssistant') : t('ai.viewResult')}
            </button>
            <button type="button" onClick={() => aiNotice.set({ kind: null })} className={cx(action, 'text-ink-2 hover:bg-subtle hover:text-ink')}>
              {t('ai.dismiss')}
            </button>
          </div>
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
