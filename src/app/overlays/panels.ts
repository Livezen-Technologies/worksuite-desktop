import { app } from '../../core/app-state';
import { tabsStore } from '../../core/tabs';
import { closeOverlay, openAssistant, ui } from '../../core/ui';

/** Settings › AI Assistant › Open the AI Assistant at start-up: done once per run of the app. */
let openedAtStart = false;

/**
 * Open the assistant at start-up, when the person switched that on — only when WorkSuite starts, not again at each
 * sign-in or unlock, which come back to a clean dashboard (worksuite-desktop#150). Whether it opened.
 */
export function openAssistantAtStart(): boolean {
  if (openedAtStart) return false;
  openedAtStart = true;
  const ai = app.get().prefs?.ai;
  if (!ai?.dockAtStart || ai.display === 'hidden' || ui.get().dock !== null) return false;
  openAssistant();
  return true;
}

/**
 * A menu belongs to the screen it was opened on (worksuite-desktop#150): another tab, or another page in this one,
 * closes it. Returns the unsubscribe.
 */
export function closeMenuOnRouteChange(): () => void {
  const where = () => {
    const s = tabsStore.get();
    return `${s.activeId ?? ''}\n${s.tabs.find((t) => t.id === s.activeId)?.route ?? ''}`;
  };
  let last = where();
  return tabsStore.subscribe(() => {
    const now = where();
    if (now === last) return;
    last = now;
    if (ui.get().overlay) closeOverlay();
  });
}
