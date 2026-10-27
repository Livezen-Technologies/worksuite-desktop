import { type ChatDrawerMode, type Preferences, type AiDisplay, QUICK_ASK_SHORTCUTS } from '@shared/types';
import { Select } from '../../../components/Select';
import { updatePrefs } from '../../../core/app-state';
import { toast } from '../../../core/toasts';
import { errorMessage, call, isMac } from '../../../core/bridge';
import { useWriter, writerProblem, shortcutLabel } from '../../ai/writer';
import { useQuery } from '@tanstack/react-query';
import { Switch } from '../../../components/ui';
import { t, text } from '../../../core/i18n';
import { ModuleAccess } from '../../ai/ModuleAccess';
import { H, Row } from './parts';

/** Settings › Chat and AI Assistant. */

const DRAWER_HINT: Record<ChatDrawerMode, string> = {
  docked: 'Beside the page, under the tabs. The page makes room for it, so nothing is hidden underneath.',
  floating: 'Over the page, which dims behind it. A click on the page or Esc closes it.',
};

/**
 * Settings › Chat (worksuite-desktop#264): how the chat drawer from the title bar opens on this computer — the same
 * choice as the button in the drawer's header. A window narrower than 1,200px floats it whatever is chosen here.
 */
export function ChatSection({ prefs }: { prefs: Preferences }) {
  const mode = prefs.chatDrawer ?? 'docked';
  return (
    <>
      <H title="Chat" hint="How Chat opens over your work on this computer." />
      <Row label="Chat drawer opens as" hint={`${DRAWER_HINT[mode]} In a window narrower than 1,200 px it always floats.`}>
        <Select<ChatDrawerMode>
          label="Chat drawer opens as"
          value={mode}
          options={[
            { value: 'docked', label: 'Docked (default)' },
            { value: 'floating', label: 'Floating' },
          ]}
          onValueChange={(v) => void updatePrefs({ chatDrawer: v }).catch((e) => toast('error', errorMessage(e)))}
        />
      </Row>
    </>
  );
}

const DISPLAY_HINT: Record<AiDisplay, string> = {
  drawer: 'The AI button in the header opens the assistant beside your tabs.',
  widget: 'An Ask AI button in the bottom-right corner opens the assistant over your work. Minimize it and the conversation keeps going.',
  hidden: 'No button anywhere. The keyboard shortcut and the command palette still open it.',
};

/**
 * Settings › AI Assistant (AI Assistant — Web + Desktop UIs, page 3): how the
 * assistant works on this computer. It sees only what it is given, and never
 * sends anything without the person.
 */
export function AiSection({ prefs }: { prefs: Preferences }) {
  const a = prefs.ai;
  const set = (patch: Partial<Preferences['ai']>) => void updatePrefs({ ai: { ...a, ...patch } });
  const writer = useWriter();
  const held = useQuery({ queryKey: ['quickask', 'shortcut', a.quickAsk, a.shortcut], queryFn: () => call('quickask:context').then((c) => c.shortcut), retry: false });
  const languages = writer.data?.languages?.length ? writer.data.languages : [a.language];
  const taken = a.quickAsk && held.isSuccess && held.data === null;
  return (
    <>
      <H title="AI Assistant" hint="How the assistant works on this computer. It only sees what you give it and never sends anything without you." />
      {writer.isError || (writer.data && !writer.data.available) ? (
        <p className="mb-2 rounded-[10px] bg-warning-bg px-3 py-2 text-[13px] text-warning-strong dark:text-warning">{writer.isError ? writerProblem(writer.error) : 'No AI connection is configured for this workspace yet.'}</p>
      ) : null}
      <Row label="Display mode" hint={DISPLAY_HINT[a.display]}>
        <Select<AiDisplay>
          label="Display mode"
          value={a.display}
          options={[
            { value: 'drawer', label: 'Header icon & drawer' },
            { value: 'widget', label: 'Floating chat widget' },
            { value: 'hidden', label: 'Hidden' },
          ]}
          onValueChange={(v) => set({ display: v })}
        />
      </Row>
      <Row
        label="Allow online fallback"
        hint={
          a.onlineFallback
            ? 'The assistant answers on this computer when a model is installed. When it cannot (no model, a failure, or files and tabs, which only WorkSuite AI reads), WorkSuite AI answers instead, and your question and the content it needs are sent to it. Your permissions and Module Access apply either way.'
            : 'Only the model on this computer answers, and nothing you ask leaves it. Without one, or for files and tabs, the assistant says it cannot help.'
        }
      >
        <span data-guide="settings.online-fallback" className="inline-flex">
          <Switch label="Allow online fallback" checked={a.onlineFallback ?? true} onChange={(v) => set({ onlineFallback: v })} />
        </span>
      </Row>
      {a.display !== 'hidden' ? (
        <Row label={t('ai.autoMinimizeWorking')} hint={text('While the assistant is thinking, switching tabs, opening another app or clicking your work outside it puts it down to its floating button. The answer keeps coming, and the button tells you when it is ready. It stays open while you are typing in it.')}>
          <Switch label={t('ai.autoMinimizeWorking')} checked={a.autoMinimizeWhenWorking ?? true} onChange={(v) => set({ autoMinimizeWhenWorking: v })} />
        </Row>
      ) : null}
      {a.display === 'widget' ? (
        <Row label="Auto-minimize after sending" hint="The widget goes down to its button once you send a question. The answer keeps coming, and the button tells you when it is ready.">
          <Switch label="Auto-minimize after sending" checked={a.autoMinimize ?? false} onChange={(v) => set({ autoMinimize: v })} />
        </Row>
      ) : null}
      <Row label="Sound for new answers" hint="A short chime when an answer arrives while the assistant is closed or minimized. Off while notifications are off, paused or in Do not disturb.">
        <Switch label="Sound for new answers" checked={a.sound} onChange={(v) => set({ sound: v })} />
      </Row>
      <Row label="Quick Ask" hint="Opens over any app with the text you have selected there. The selection is read only when you press the shortcut.">
        <Switch label="Quick Ask" checked={a.quickAsk} onChange={(v) => set({ quickAsk: v })} />
      </Row>
      {a.quickAsk ? (
        <Row label="Quick Ask shortcut" hint={taken ? 'Another app already uses this shortcut. Choose another.' : undefined}>
          <Select
            label="Quick Ask shortcut"
            value={a.shortcut}
            options={QUICK_ASK_SHORTCUTS.map((k) => ({ value: k, label: shortcutLabel(k, isMac) }))}
            onValueChange={(v) => set({ shortcut: v })}
          />
        </Row>
      ) : null}
      <Row label="Insert results into other apps" hint="Pastes only when you click Insert, into the app Quick Ask was opened over.">
        <Switch label="Insert results into other apps" checked={a.insert} onChange={(v) => set({ insert: v })} />
      </Row>
      {a.display !== 'hidden' ? (
        <Row label="Open the AI Assistant at start-up" hint={a.display === 'widget' ? 'Open the floating widget when WorkSuite starts.' : 'Show the assistant beside every tab.'}>
          <Switch label="Open the AI Assistant at start-up" checked={a.dockAtStart} onChange={(v) => set({ dockAtStart: v })} />
        </Row>
      ) : null}
      <Row label="Language for translations" hint="Where Translate goes unless you choose another.">
        <Select label="Language for translations" value={a.language} options={languages.map((l) => ({ value: l, label: l }))} onValueChange={(v) => set({ language: v })} />
      </Row>
      {isMac ? (
        <p className="mt-4 text-[12.5px] text-ink-3">To read your selection in other apps, and to insert into them, WorkSuite needs System Settings › Privacy &amp; Security › Accessibility. Without it Quick Ask uses what you copied last.</p>
      ) : null}
      <p className="mt-2 text-[12.5px] text-ink-3">Files from this computer, summaries of WorkSuite files and actions waiting for your confirmation arrive when the assistant's desktop service does.</p>
      <ModuleAccess prefs={a.moduleAccess ?? { worksuite: {}, local: {} }} onChange={(moduleAccess) => set({ moduleAccess })} />
    </>
  );
}
