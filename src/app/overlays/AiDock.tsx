import { useEffect } from 'react';
import type { Preferences } from '@shared/types';
import { app } from '../../core/app-state';
import { call, isMac } from '../../core/bridge';
import { t } from '../../core/i18n';
import { createStore, useStore } from '../../core/store';
import { navigate, tabsStore } from '../../core/tabs';
import { aiWidget, openOverlay, toggleDock, ui, useAiDisplay } from '../../core/ui';
import { Icon } from '../../components/Icon';
import { Button, cx, IconButton } from '../../components/ui';
import { Assist } from '../../modules/ai/Assist';
import { AskPanel } from '../../modules/ai/AskPanel';
import { Changes } from '../../modules/ai/Changes';
import { refForRoute } from '../../modules/ai/assistant';
import { answerPreview, assistantSession, type AskEngine, type AskPhase } from '../../modules/ai/session';
import { shortcutLabel } from '../../modules/ai/writer';
import { AI_ASSISTANT_ATTR, minimizeAssistant } from './aiMinimize';

export type AiDockView = 'ask' | 'write' | 'changes';

/** What Quick Ask handed over with "Open in WorkSuite": the text, its answer, and a counter so the dock starts afresh. */
export const aiDock = createStore<{ text: string; result: string | null; seq: number; view: AiDockView }>({ text: '', result: null, seq: 0, view: 'ask' });

export function openAiDockWith(text: string, result: string | null): void {
  aiDock.set((s) => ({ text, result, seq: s.seq + 1, view: 'write' }));
}

/** The changes the assistant proposed — where a notification about one, or Quick Ask, sends the person. */
export function openAiChanges(): void {
  aiDock.set({ view: 'changes' });
}

/** A task from the text: its first line as the title, in Tasks' new-task form. */
export function makeTask(text: string): void {
  const title = text.trim().split('\n')[0]!.slice(0, 200);
  navigate(`/tasks?new=1&title=${encodeURIComponent(title)}`);
}

export function askWorkSuite(text: string): void {
  openOverlay('search', text.trim().replace(/\s+/g, ' ').slice(0, 200));
}

/**
 * Switching the display mode moves an open assistant with it, conversation and all (it is one session);
 * Hidden puts it away.
 */
export function useAssistantFollowsDisplay(): void {
  const display = useAiDisplay();
  useEffect(() => {
    const docked = ui.get().dock === 'ai';
    const floating = aiWidget.get().open;
    if (display === 'widget') {
      if (docked) {
        ui.set({ dock: null });
        aiWidget.set({ open: true });
      }
    } else if (floating) {
      aiWidget.set({ open: false });
      if (display === 'drawer') ui.set({ dock: 'ai' });
    }
    if (display === 'hidden' && docked) ui.set({ dock: null });
  }, [display]);
}

/** A soft two-note chime, synthesised: an answer arrived while the assistant was closed or minimised. */
function chime(): void {
  try {
    const ctx = new AudioContext();
    const t0 = ctx.currentTime + 0.02;
    [
      [880, 0],
      [1320, 0.12],
    ].forEach(([hz, at]) => {
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t0 + at!);
      g.gain.linearRampToValueAtTime(0.08, t0 + at! + 0.02);
      g.gain.linearRampToValueAtTime(0, t0 + at! + 0.22);
      g.connect(ctx.destination);
      const o = ctx.createOscillator();
      o.frequency.value = hz!;
      o.connect(g);
      o.start(t0 + at!);
      o.stop(t0 + at! + 0.25);
    });
    setTimeout(() => void ctx.close().catch(() => undefined), 800);
  } catch {
    /* no audio here */
  }
}

/** Within a Do not disturb schedule (from–to, which may run past midnight); the same rule the desktop notifications use. */
function inDnd(from: string, to: string, now: Date): boolean {
  const minutes = (s: string) => {
    const [h, m] = s.split(':').map(Number);
    return (h ?? 0) * 60 + (m ?? 0);
  };
  const f = minutes(from);
  const t = minutes(to);
  const n = now.getHours() * 60 + now.getMinutes();
  if (f === t) return false;
  return f < t ? n >= f && n < t : n >= f || n < t;
}

/**
 * Whether the assistant may tell the person an answer arrived (worksuite-desktop#110): notifications on, the AI
 * Assistant not muted in them, not paused and not in Do not disturb. When it may not, the answer is still counted
 * on the launcher and the header button — quietly, with no notice and no sound.
 */
export function assistantMayNotify(prefs: Preferences | null | undefined, pausedUntil: string | null | undefined, now = new Date()): boolean {
  if (!prefs) return true;
  if (prefs.notificationsEnabled === false) return false;
  if (prefs.moduleNotifications?.ai === false || prefs.moduleNotifications?.['cat:ai'] === false) return false;
  if (pausedUntil && Date.parse(pausedUntil) > now.getTime()) return false;
  if (prefs.dndEnabled && inDnd(prefs.dndFrom, prefs.dndTo, now)) return false;
  return true;
}

/**
 * The notice beside the launcher (worksuite-desktop#110): an answer that arrived while the assistant was closed or
 * minimised. `ready` — Your answer is ready; `input` — it needs the person (a change to confirm, details asked for);
 * `failed` — it could not answer.
 */
export type AiNoticeKind = 'ready' | 'input' | 'failed';
export const aiNotice = createStore<{ kind: AiNoticeKind | null }>({ kind: null });

/**
 * For each answer that arrives while no panel shows the conversation: the notice, and Settings › AI Assistant ›
 * Sound's chime — both only as the notification settings allow. With WorkSuite's window behind other apps, a desktop
 * banner too (worksuite-desktop#126): the notification service shows it as the same settings, "What banners show"
 * and the app lock allow — while locked it never says what the answer is.
 */
export function useAssistantAlerts(): void {
  useEffect(
    () =>
      assistantSession.onUnseen(() => {
        const s = app.get();
        if (!assistantMayNotify(s.prefs, s.status?.notificationsPausedUntil)) return;
        const st = assistantSession.store.get();
        const kind: AiNoticeKind = st.phase === 'needsInput' ? 'input' : st.phase === 'failed' ? 'failed' : 'ready';
        aiNotice.set({ kind });
        if (s.prefs?.ai?.sound) chime();
        if (!document.hasFocus()) void call('ai:answerReady', { kind, preview: answerPreview(st.entries, !!s.lock?.locked).slice(0, 300) }).catch(() => undefined);
      }),
    [],
  );
  // Once the conversation shows, or another question goes, the notice has said what it had to.
  useEffect(
    () =>
      assistantSession.store.subscribe(() => {
        const st = assistantSession.store.get();
        if (aiNotice.get().kind && (st.viewers > 0 || st.busy)) aiNotice.set({ kind: null });
      }),
    [],
  );
}

/** Where the assistant is, and how many answers arrived unseen: for the header button and the launcher. */
export function useAssistantActivity(): { busy: boolean; unread: number; phase: AskPhase; engine: AskEngine } {
  const busy = useStore(assistantSession.store, (s) => s.busy);
  const unread = useStore(assistantSession.store, (s) => s.unread);
  const phase = useStore(assistantSession.store, (s) => s.phase);
  const engine = useStore(assistantSession.store, (s) => s.engine);
  return { busy, unread, phase, engine };
}

export function unreadLabel(n: number): string {
  return n === 1 ? t('ai.unreadOne') : t('ai.unreadMany', { n });
}

/**
 * The AI dock (Ctrl/Cmd+Shift+A; AI Assistant — Web + Desktop UIs; WS-AI-SRS-001
 * FR-DSK-AI-01): beside every tab.
 *
 *  · Ask — the server's assistant, given the record the active tab shows
 *    (and nothing from a tab that shows no one record), which the person can
 *    leave out; files from this computer only when they pick one.
 *  · Write — the writing assistant, on the text it is given and nothing else.
 *  · Changes — what the assistant proposed, waiting for a decision or done.
 */
export function AiDock() {
  return (
    <aside {...{ [AI_ASSISTANT_ATTR]: '' }} className="flex w-[360px] shrink-0 flex-col border-l border-line bg-surface" aria-label={t('ai.title')}>
      <div className="flex items-center justify-between border-b border-line px-4 py-3">
        <div className="flex items-center gap-2 text-[14.5px] font-bold text-ink">
          <Icon name="sparkles" size={17} className="text-teal" /> {t('ai.title')}
        </div>
        <IconButton icon="x" label={t('ai.close')} onClick={() => toggleDock('ai')} />
      </div>
      {/* Minimize while working: the drawer closes to the floating button, the answer still on its way (#126). */}
      <AssistantBody onMinimize={minimizeAssistant} />
    </aside>
  );
}

/** What the drawer and the widget both show: Ask, Write and Changes, on the one conversation. */
export function AssistantBody({ autoFocus, onMinimize, onSent }: { autoFocus?: boolean; onMinimize?: () => void; onSent?: () => void }) {
  const hasAi = useStore(app, (s) => s.apps.some((a) => a.id === 'ai'));
  const language = useStore(app, (s) => s.prefs?.ai?.language ?? 'English');
  const quickAsk = useStore(app, (s) => (s.prefs?.ai?.quickAsk ? s.prefs.ai.shortcut : null));
  const d = useStore(aiDock, (s) => s);
  const active = useStore(tabsStore, (s) => s.tabs.find((t) => t.id === s.activeId) ?? null);
  const tabRef = refForRoute(active?.route);
  const view = (v: AiDockView, label: string) => (
    <button type="button" role="tab" aria-selected={d.view === v} onClick={() => aiDock.set({ view: v })}
      className={cx('flex-1 rounded-[8px] px-2 py-1.5 text-[12.5px] font-semibold', d.view === v ? 'bg-surface text-ink shadow-sm' : 'text-ink-3 hover:text-ink')}>
      {label}
    </button>
  );
  return (
    <>
      <div role="tablist" aria-label="What the assistant does" className="mx-4 mt-3 flex gap-1 rounded-[10px] bg-subtle p-1">
        {view('ask', 'Ask')}
        {view('write', 'Write')}
        {view('changes', 'Changes')}
      </div>
      {d.view === 'ask' ? (
        <div className="flex min-h-0 flex-1 flex-col p-4">
          <AskPanel surface="assistant.panel" session={assistantSession} tabRef={tabRef} tabTitle={active?.title ?? null} autoFocus={autoFocus} onMinimize={onMinimize} onSent={onSent} />
        </div>
      ) : d.view === 'changes' ? (
        <div className="flex min-h-0 flex-1 flex-col p-4">
          <Changes />
        </div>
      ) : (
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto p-4 scroll-thin">
        <Assist
          key={d.seq}
          text={d.text}
          onText={(text) => aiDock.set({ text })}
          seed={d.result}
          language={language}
          label="TEXT"
          placeholder="Type or paste what to translate, rewrite or shorten"
          onTask={makeTask}
          onSearch={askWorkSuite}
        />
        {quickAsk ? (
          <p className="mt-4 rounded-[10px] bg-subtle px-3 py-2 text-[12px] text-ink-2">
            In any other app, select text and press <b>{shortcutLabel(quickAsk, isMac)}</b> for Quick Ask.
          </p>
        ) : null}
        {hasAi ? (
          <div className="mt-3">
            <Button variant="ghost" icon="external" onClick={() => void call('app:openInBrowser', { path: '/ai' })}>
              Assistants and knowledge in your browser
            </Button>
          </div>
        ) : null}
      </div>
      )}
      <p className="border-t border-line px-4 py-2 text-[11.5px] text-ink-3">
        {d.view === 'write' ? 'Sees only what you give it. Never sends on its own.' : 'Reads only what you can open. Changes nothing until you confirm.'}
      </p>
    </>
  );
}
