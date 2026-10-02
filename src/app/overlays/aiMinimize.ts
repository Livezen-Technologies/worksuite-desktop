import { useEffect } from 'react';
import { app } from '../../core/app-state';
import { tabsStore } from '../../core/tabs';
import { aiDisplay, aiMinimized, aiWidget, openAssistant, putAssistantAway, ui } from '../../core/ui';
import { assistantSession } from '../../modules/ai/session';
import { aiDock, aiNotice } from './AiDock';

/**
 * Minimised, not closed (worksuite-desktop#126): the assistant was put down while a question was on its way, or with
 * its answer still to be seen. In widget mode that is the launcher, which is always there; with the drawer (or
 * Hidden) the same floating button stands in the workspace's corner until the answer has been seen or put away.
 * Nothing here ever opens the assistant by itself.
 */
export { aiMinimized } from '../../core/ui';

/** Marks the assistant's own surfaces (the widget, the drawer, its floating button and notice). */
export const AI_ASSISTANT_ATTR = 'data-ai-assistant';
/** Marks the workspace: a press there, outside the assistant, is the person carrying on with their work. */
export const AI_WORKSPACE_ATTR = 'data-ai-workspace';

const inside = (el: EventTarget | Element | null | undefined, attr: string): boolean => el instanceof Element && !!el.closest(`[${attr}]`);

/** Whether the assistant is open where the person keeps it. */
export function assistantOpen(): boolean {
  return aiDisplay() === 'widget' ? aiWidget.get().open : ui.get().dock === 'ai';
}

/**
 * Down to the floating button: the conversation, the question being written, its attachments and the answer on its
 * way all stay in the session. The keyboard's focus is left where it is — never moved to the button.
 */
export function minimizeAssistant(): void {
  if (aiDisplay() === 'widget') {
    aiWidget.set({ open: false });
    return;
  }
  putAssistantAway();
  aiMinimized.set({ on: true });
}

/** Back to the conversation and its latest answer: the button, View Result, or the banner. */
export function restoreAssistant(): void {
  aiNotice.set({ kind: null });
  aiDock.set({ view: 'ask' });
  aiMinimized.set({ on: false });
  openAssistant();
}

/** The person is using the assistant: the keyboard's focus is in it (typing, or a button of its own). */
export function interactingWithAssistant(doc: Document = document): boolean {
  return inside(doc.activeElement, AI_ASSISTANT_ATTR);
}

/** Settings › AI Assistant › Auto-minimize when I continue working, on unless switched off. */
export function autoMinimizeOn(): boolean {
  return app.get().prefs?.ai?.autoMinimizeWhenWorking ?? true;
}

/** Whether carrying on with work now puts the assistant down: the setting on, a question on its way, the assistant open. */
export function mayAutoMinimize(): boolean {
  return autoMinimizeOn() && assistantSession.store.get().busy && assistantOpen();
}

/** How recently a press outside the assistant still counts as what switched the tab (a click on the tab strip, the sidebar). */
const PRESS_WINDOW_MS = 1000;

/**
 * Auto-minimize when the person carries on working (worksuite-desktop#126), while a question is on its way:
 *
 *  · another tab, or another module in this one — unless the keyboard is in the assistant (a shortcut pressed while
 *    typing in it, or a link in its answer), and the switch did not come from a press outside it;
 *  · a press in the workspace outside the assistant — put down once the press is over, so a drawer closing never
 *    moves what was being clicked.
 *
 * Never while the person is typing in or clicking the assistant, and never when the setting is off.
 */
export function useAutoMinimize(): void {
  useEffect(() => {
    let pressedOutside = 0;
    const onDown = (e: PointerEvent) => {
      if (inside(e.target, AI_ASSISTANT_ATTR)) {
        pressedOutside = 0;
        return;
      }
      pressedOutside = Date.now();
      if (!inside(e.target, AI_WORKSPACE_ATTR) || !mayAutoMinimize()) return;
      const later = () => {
        window.removeEventListener('pointerup', later, true);
        window.removeEventListener('pointercancel', later, true);
        setTimeout(() => {
          if (mayAutoMinimize()) minimizeAssistant();
        }, 0);
      };
      window.addEventListener('pointerup', later, true);
      window.addEventListener('pointercancel', later, true);
    };
    document.addEventListener('pointerdown', onDown, true);

    const where = () => {
      const s = tabsStore.get();
      return { id: s.activeId, app: s.tabs.find((t) => t.id === s.activeId)?.app ?? null };
    };
    let last = where();
    const offTabs = tabsStore.subscribe(() => {
      const now = where();
      const moved = now.id !== last.id || now.app !== last.app;
      last = now;
      if (!moved || !mayAutoMinimize()) return;
      const byPress = pressedOutside > 0 && Date.now() - pressedOutside < PRESS_WINDOW_MS;
      if (!byPress && interactingWithAssistant()) return;
      minimizeAssistant();
    });

    // Opened again by any way (the header button, the shortcut): no longer minimised.
    const offUi = ui.subscribe(() => {
      if (ui.get().dock === 'ai' && aiMinimized.get().on) aiMinimized.set({ on: false });
    });
    return () => {
      document.removeEventListener('pointerdown', onDown, true);
      offTabs();
      offUi();
    };
  }, []);
}
