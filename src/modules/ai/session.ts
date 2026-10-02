import { isTodaySales } from './intent';
import { todaySales, type SalesAccess } from './sales';
import { t } from '../../core/i18n';
import { askLocal } from '../../core/local-ai';
import { createStore, type Store } from '../../core/store';
import { ask, assistantProblem, pickFile, type AskTurn, type PendingAction, type Surface } from './assistant';
import { runLocalAgent, runTool, toolsSystem, type AiTool } from './tools';

export interface AskEntry {
  role: 'user' | 'assistant';
  text: string;
  error?: boolean;
  turn?: AskTurn;
  /** Answered by the model on this computer. */
  local?: boolean;
  /** Answered online, and why the model on this computer did not (worksuite-desktop#53). */
  fallback?: string;
  /** Online AI was needed and could not be used: offer Local AI's setup beside Try again. */
  needsSetup?: boolean;
  /** Help & Guide (worksuite-desktop#54): answered with this guide from the app, and others that also match. */
  guide?: string;
  others?: string[];
  /** A how-to question no guide covers: say so and offer the assistant anyway, or support. */
  noGuide?: boolean;
  /** The question a guide or noGuide entry answers. */
  question?: string;
  /** A failed or stopped answer: what to send again for Try again. */
  retry?: { full: string; opts: SendOptions };
  /** Stopped by the person before it finished: what had arrived by then, if anything. */
  stopped?: boolean;
  /** Local AI needs details the person has not given, and asks for them. */
  asks?: boolean;
}

/**
 * Where a question is (worksuite-desktop#110): one state for the drawer, the widget and its launcher.
 *
 *  · idle — nothing on its way.
 *  · thinking — asked; nothing has come back yet.
 *  · working — the answer is streaming in, or a WorkSuite function is running for it.
 *  · needsInput — the answer waits on the person: a change to confirm or cancel, or details it asked for. Nothing
 *    more happens until they respond.
 *  · complete — answered.
 *  · failed — no answer; Try again asks once more.
 */
export type AskPhase = 'idle' | 'thinking' | 'working' | 'needsInput' | 'complete' | 'failed';
export type AskEvent = 'send' | 'progress' | 'answer' | 'ask' | 'fail' | 'stop' | 'settled' | 'reset';

/** The one way a phase changes; an event that does not fit where the question is changes nothing. */
export function nextPhase(phase: AskPhase, event: AskEvent): AskPhase {
  const active = phase === 'thinking' || phase === 'working';
  switch (event) {
    case 'send':
      return active ? phase : 'thinking';
    case 'progress':
      return active ? 'working' : phase;
    case 'answer':
      return active ? 'complete' : phase;
    case 'ask':
      return active ? 'needsInput' : phase;
    case 'fail':
      return active ? 'failed' : phase;
    case 'stop':
      return active ? 'idle' : phase;
    case 'settled':
      return phase === 'needsInput' ? 'complete' : phase;
    case 'reset':
      return active ? phase : 'idle';
  }
}

/** Which answers: the model on this computer, or WorkSuite AI online; null before it is known. */
export type AskEngine = 'local' | 'online' | null;

/**
 * The status said beside the question box and on the launcher: where the answer is coming from, accurately — the
 * engine actually answering while a question is on its way, and the one the next question would go to otherwise.
 */
export function phaseLabel(phase: AskPhase, engine: AskEngine): string {
  switch (phase) {
    case 'thinking':
      return engine === 'local' ? t('ai.thinkingLocal') : engine === 'online' ? t('ai.thinkingOnline') : t('ai.thinking');
    case 'working':
      return engine === 'online' ? t('ai.workingOnline') : t('ai.workingLocal');
    case 'needsInput':
      return t('ai.needsInput');
    case 'complete':
      return t('ai.complete');
    case 'failed':
      return t('ai.failed');
    default:
      return engine === 'local' ? t('ai.readyLocal') : t('ai.readyOnline');
  }
}

/** An answer that waits on the person: a change to confirm, or details asked for. */
export function waitsOnPerson(entry: AskEntry | undefined): boolean {
  if (!entry || entry.role !== 'assistant' || entry.error) return false;
  return !!entry.asks || (entry.turn?.pending_actions ?? []).some((a) => a.status === 'awaiting_confirmation');
}

export interface AskFile {
  ref: string;
  name: string;
  via: 'upload' | 'drive';
}

export interface AskState {
  entries: AskEntry[];
  conversationId: number | null;
  /** The question being written. */
  text: string;
  /** Thinking or working: a question is on its way. Kept with `phase`, which says more. */
  busy: boolean;
  phase: AskPhase;
  /** Who is answering the question on its way, or answered the last one. */
  engine: AskEngine;
  /** A local answer as it grows; null when none is streaming. */
  streaming: string | null;
  useTab: boolean;
  /** The tab record `useTab` was last reset for: a new record turns it back on. */
  tabRef: string | null;
  files: AskFile[];
  fileError: string | null;
  /** Answers that arrived while no panel showed the conversation. */
  unread: number;
  /** Panels showing the conversation now (the drawer, the widget). */
  viewers: number;
}

/**
 * How a question is answered (worksuite-desktop#53): one assistant, the model on this computer first.
 * `local` — that model can answer now. `online` — WorkSuite AI may be used: the person allows online fallback, there
 * is a connection, and the assistant is switched on for them; `onlineWhy` says why not when it may not.
 */
export interface SendOptions {
  surface: Surface;
  refs: string[];
  local: boolean;
  online: boolean;
  onlineWhy?: string | null;
  /** Quick Ask: the text selected in the other app, sent with the first question only. */
  selection?: string;
  /** Local AI with module functions (worksuite-desktop#51): what it may call, and why a call is refused. */
  localTools?: { tools: AiTool[]; allow: (t: AiTool) => string | null; off: string[] };
  /** WorkSuite AI: the modules this person switched off (Settings › AI Assistant › Module Access). */
  moduleAccess?: { read: string[]; write: string[] };
  /** Said to the model before the question: the guide being followed, that instructions are wanted, the language. */
  context?: string;
  /** Reporting reads use the same authorized server query for both engines. */
  sales?: SalesAccess;
  /** The latest request, separate from guide/selection context, also retained for retries. */
  request?: string;
}

const LOCAL_SYSTEM = 'You are WorkSuite\'s assistant, running on this computer. Answer clearly and briefly. You cannot see the person\'s WorkSuite data or change anything right now (WorkSuite\'s module functions need a connection, and the modules turned on in Settings › AI Assistant › Module Access); say so when a question needs it.';

const fresh = (): AskState => ({ entries: [], conversationId: null, text: '', busy: false, phase: 'idle', engine: null, streaming: null, useTab: true, tabRef: null, files: [], fileError: null, unread: 0, viewers: 0 });

/** Thrown when the model on this computer did not answer; `acted` when a WorkSuite function already ran. */
class LocalFailed extends Error {
  constructor(message: string, readonly acted: boolean) {
    super(message);
  }
}

/**
 * What online AI is given of an exchange it was not part of: the turns answered on this computer since its last
 * answer, so a switch keeps the conversation (worksuite-desktop#53).
 */
export function carriedOver(before: AskEntry[]): string {
  let i = before.length;
  while (i > 0 && !(before[i - 1]!.role === 'assistant' && !before[i - 1]!.local && !before[i - 1]!.error)) i--;
  const lines = before.slice(i).filter((e) => !e.error && e.text.trim()).slice(-12).map((e) => `${e.role === 'user' ? 'Me' : 'Assistant'}: ${e.text.trim().slice(0, 1500)}`);
  return lines.length ? `Earlier in this conversation:\n${lines.join('\n')}\n\n` : '';
}

/**
 * One conversation with the assistant, kept outside any panel: the drawer and the floating widget show the same
 * one, and closing, minimising or switching between them loses nothing — not the messages, the question being
 * written, the files picked, nor an answer on its way, which lands here whether or not a panel is open.
 */
export interface AskSession {
  store: Store<AskState>;
  /** Asks the question in the box — or `question`, when given (Ask the assistant anyway). */
  send(opts: SendOptions, question?: string): Promise<void>;
  /** A how-to question answered with a guide from the app, no model asked (worksuite-desktop#54). */
  showGuide(question: string | null, guide: string, text: string, others?: string[]): void;
  /** A how-to question no guide covers. */
  noGuide(question: string): void;
  /** Asks the question whose answer failed, or was stopped, again in its place. */
  retry(): Promise<void>;
  /**
   * Stop processing: a local answer stops where it is; for one from online AI, the app stops waiting (the server
   * cannot be called back, but nothing it proposed is applied unless it is confirmed on its card).
   */
  cancel(): void;
  /** A card in the conversation was confirmed, cancelled or changed: the answer stops waiting once none is open. */
  settle(action: PendingAction): void;
  attach(): Promise<void>;
  /** A new conversation — only between answers. */
  reset(): void;
  /** A panel shows the conversation: what arrived meanwhile is read. Returns the function that says it closed. */
  view(): () => void;
  /** Called with each answer that arrives while no panel shows the conversation. */
  onUnseen(fn: (entry: AskEntry) => void): () => void;
}

export function createAskSession(): AskSession {
  const store = createStore<AskState>(fresh());
  let running: { cancel(): void } | null = null;
  /** Stops the question on its way, if there is one. */
  let stopCurrent: (() => void) | null = null;
  const unseen = new Set<(entry: AskEntry) => void>();

  const move = (event: AskEvent, patch: Partial<AskState> = {}) =>
    store.set((s) => {
      const phase = nextPhase(s.phase, event);
      return { ...patch, phase, busy: phase === 'thinking' || phase === 'working' };
    });

  const answered = (entry: AskEntry) => {
    const hidden = store.get().viewers === 0;
    // The phase is settled before anyone hears of the answer, so a notice says what it is.
    move(entry.error ? 'fail' : waitsOnPerson(entry) ? 'ask' : 'answer');
    store.set((s) => ({ entries: [...s.entries, entry], unread: hidden ? s.unread + 1 : s.unread }));
    if (hidden) for (const fn of unseen) fn(entry);
  };

  /** The model on this computer: an answer entry, or LocalFailed. `live` is false once the person stopped it. */
  const runLocal = async (full: string, opts: SendOptions, before: AskEntry[], live: () => boolean): Promise<AskEntry> => {
    // The whole conversation, whichever answered each turn.
    const history = before.filter((x) => !x.error).map((x) => ({ role: x.role, content: x.text }));
    store.set({ streaming: '' });
    // Text arriving is the answer being written: working, no longer only thinking.
    const onText = (text: string) => {
      if (live()) move('progress', { streaming: text });
    };
    const lt = opts.localTools;
    let acted = false;
    try {
      if (lt?.tools.length) {
        // With WorkSuite's module functions: the model decides, WorkSuite runs them as the person.
        const system = toolsSystem(lt.tools, lt.off, new Date().toDateString());
        const a = await runLocalAgent({
          messages: [{ role: 'system', content: system }, ...history, { role: 'user', content: full }],
          tools: lt.tools,
          allow: lt.allow,
          ask: (m, onText) => askLocal(m, onText),
          onText,
          // A step that starts after Stop (a function was running then) is stopped at once.
          onCancelSet: (c) => (live() ? (running = { cancel: c }) : c()),
          run: (name, args) => {
            acted = true;
            // A WorkSuite function running for the answer is work, too.
            if (live()) move('progress');
            return runTool(name, args);
          },
        });
        const turn: AskTurn = { conversation_id: null, ok: true, reply: a.text, error: null, sources: a.sources, tool_runs: a.tools, pending_actions: a.actions };
        if (!a.text && !a.cancelled && !a.tools.length) throw new Error('The model on this computer gave no answer.');
        return { role: 'assistant', text: a.text || (a.cancelled ? t('ai.stopped') : ''), local: true, turn, asks: a.asked && !a.cancelled ? true : undefined };
      }
      const r = askLocal([{ role: 'system', content: LOCAL_SYSTEM }, ...history, { role: 'user', content: full }], onText);
      running = r;
      const a = await r.done;
      if (!a.text.trim() && !a.cancelled) throw new Error('The model on this computer gave no answer.');
      return { role: 'assistant', text: a.text.trim() || t('ai.stopped'), local: true };
    } catch (err) {
      throw new LocalFailed(assistantProblem(err), acted);
    } finally {
      if (live()) {
        running = null;
        store.set({ streaming: null });
      }
    }
  };

  /**
   * One answer to `full`, with the conversation before it (`before`) as it stood (worksuite-desktop#53): the model on
   * this computer when it can, online AI when it cannot and the person allows it. Never both for one question once a
   * WorkSuite function has run, so nothing is done twice; a module that is off or a missing permission is an answer,
   * not a failure, and is never a reason to go online.
   *
   * It runs here, not in a panel (worksuite-desktop#110): closing or minimising the widget, or changing modules, does
   * not stop it. Stop processing does, at once: whatever comes back after that is not shown.
   */
  const run = async (full: string, opts: SendOptions, before: AskEntry[]) => {
    const retry = { full, opts };
    let live = true;
    const STOPPED = Symbol('stopped');
    let halt: () => void = () => undefined;
    const halted = new Promise<typeof STOPPED>((r) => (halt = () => r(STOPPED)));
    const until = <T,>(p: Promise<T>) => Promise.race([p, halted]);
    const stop = () => {
      if (!live) return;
      live = false;
      const s = store.get();
      const partial = s.streaming?.trim();
      running?.cancel();
      running = null;
      // What had arrived stays, marked as stopped, with Try again; the person stopped it, so it is not counted unread.
      move('stop', { streaming: null, entries: [...s.entries, { role: 'assistant', text: partial || t('ai.stopped'), stopped: true, local: s.engine === 'local' || undefined, retry }] });
      halt();
    };
    stopCurrent = stop;
    const finish = (entry: AskEntry) => {
      if (live) answered(entry);
    };
    move('send', { engine: null });
    try {
      if (isTodaySales(opts.request ?? full)) {
        const report = await until(todaySales(opts.sales));
        if (report === STOPPED) return;
        finish({ role: 'assistant', text: report.text, turn: { conversation_id: null, ok: true, reply: report.text, error: null, sources: report.sources, tool_runs: [] } });
        return;
      }
      // Files and the tab beside it are read by WorkSuite AI; the model on this computer cannot see them.
      const needsServer = opts.refs.length > 0;
      let why: string;
      if (opts.local && !needsServer) {
        store.set({ engine: 'local' });
        try {
          const entry = await until(runLocal(full, opts, before, () => live));
          if (entry === STOPPED) return;
          finish(entry);
          return;
        } catch (err) {
          if (!live) return;
          const f = err as LocalFailed;
          if (f.acted || !opts.online) {
            finish({ role: 'assistant', text: f.acted ? `${f.message} Part of it may already have run in WorkSuite, so it was not repeated online. Check before trying again.` : `${f.message}${opts.onlineWhy ? ` ${opts.onlineWhy}` : ''}`, error: true, local: true, retry });
            return;
          }
          why = 'The model on this computer could not answer, so online AI did.';
        }
      } else if (needsServer) {
        why = 'Files and this tab are read by WorkSuite AI, online.';
      } else {
        why = 'No model on this computer can answer yet, so online AI did.';
      }
      if (!opts.online) {
        const reason = needsServer ? 'Files and this tab can only be read by WorkSuite AI, online.' : 'No model on this computer can answer yet.';
        finish({ role: 'assistant', text: `${reason} ${opts.onlineWhy ?? 'Online AI is not available.'}`, error: true, needsSetup: !opts.local, retry });
        return;
      }
      store.set({ engine: 'online' });
      // What was said on this computer goes along, the first time online AI answers after it.
      const context = carriedOver(before);
      const answer = await until(ask(context + full, { surface: opts.surface, refs: opts.refs, conversationId: store.get().conversationId, moduleAccess: opts.moduleAccess }));
      if (answer === STOPPED) return;
      store.set({ conversationId: answer.conversation_id });
      finish(answer.ok ? { role: 'assistant', text: answer.reply ?? '', turn: answer, fallback: opts.local || needsServer ? why : undefined } : { role: 'assistant', text: answer.error ?? 'The assistant could not answer just now.', error: true, retry });
    } catch (err) {
      finish({ role: 'assistant', text: assistantProblem(err), error: true, retry });
    } finally {
      // Whatever ended it, nothing is left thinking.
      if (live) move('fail');
      live = false;
      // A stopped question can end after the next one began: only its own Stop is put away.
      if (stopCurrent === stop) stopCurrent = null;
    }
  };

  const send = async (opts: SendOptions, question?: string) => {
    const s = store.get();
    const q = (question ?? s.text).trim();
    if (!q || s.busy) return;
    const { selection } = opts;
    // A selection from another app goes with the question, fenced, as material to work on.
    const asked = selection && selection.trim() && s.entries.length === 0 ? `${q}\n\nThe text I selected:\n"""\n${selection.trim().slice(0, 6000)}\n"""` : q;
    const full = opts.context ? `${opts.context}\n\nQuestion: ${asked}` : asked;
    store.set({ text: question === undefined ? '' : s.text, entries: [...s.entries, { role: 'user', text: q }] });
    await run(full, { ...opts, request: q }, s.entries);
  };

  // The guide's own text is the entry's text: what a follow-up question is answered from, here or online.
  const showGuide = (question: string | null, guide: string, text: string, others: string[] = []) => {
    store.set((s) => ({
      text: question ? '' : s.text,
      entries: [...s.entries, ...(question ? [{ role: 'user' as const, text: question }] : []), { role: 'assistant' as const, text, guide, others, question: question ?? undefined }],
    }));
  };
  const noGuide = (question: string) => {
    store.set((s) => ({ text: '', entries: [...s.entries, { role: 'user', text: question }, { role: 'assistant', text: '', noGuide: true, question }] }));
  };

  const retry = async () => {
    const s = store.get();
    const failed = s.entries.at(-1);
    if (s.busy || !(failed?.error || failed?.stopped) || !failed.retry) return;
    const entries = s.entries.slice(0, -1);
    store.set({ entries });
    // The question stays where it was; the conversation before it is everything up to it.
    await run(failed.retry.full, failed.retry.opts, entries.slice(0, -1));
  };

  const settle = (action: PendingAction) => {
    // The card's new state is kept with the answer, so the conversation shows it when it is opened again.
    const entries = store.get().entries.map((e) =>
      e.turn?.pending_actions?.some((a) => a.id === action.id) ? { ...e, turn: { ...e.turn, pending_actions: e.turn.pending_actions.map((a) => (a.id === action.id ? action : a)) } } : e,
    );
    store.set({ entries });
    if (!waitsOnPerson(entries.at(-1))) move('settled');
  };

  return {
    store,
    send,
    showGuide,
    noGuide,
    retry,
    cancel: () => stopCurrent?.(),
    settle,
    async attach() {
      store.set({ fileError: null });
      try {
        const f = await pickFile();
        if (f) store.set((s) => ({ files: [...s.files.filter((x) => x.ref !== f.ref), f] }));
      } catch (e) {
        store.set({ fileError: assistantProblem(e) });
      }
    },
    reset() {
      if (store.get().busy) return;
      store.set((s) => ({ ...fresh(), viewers: s.viewers, tabRef: s.tabRef }));
    },
    view() {
      store.set((s) => ({ viewers: s.viewers + 1, unread: 0 }));
      let open = true;
      return () => {
        if (!open) return;
        open = false;
        store.set((s) => ({ viewers: Math.max(0, s.viewers - 1) }));
      };
    },
    onUnseen(fn) {
      unseen.add(fn);
      return () => unseen.delete(fn);
    },
  };
}

/** The assistant beside the tabs: one conversation, whether it shows in the drawer or the floating widget. */
export const assistantSession = createAskSession();
