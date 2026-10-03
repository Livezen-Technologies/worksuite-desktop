import { useEffect, useRef, useState, type ClipboardEvent, type DragEvent, type KeyboardEvent } from 'react';
import { Icon } from '../../components/Icon';
import { cx } from '../../components/ui';
import { Markdown } from '../../components/Markdown';
import { useStickToBottom } from '../../components/useStickToBottom';
import { app } from '../../core/app-state';
import { LANGUAGES, t, useLanguage } from '../../core/i18n';
import { localReady, useLocalModels } from '../../core/local-ai';
import { useStore } from '../../core/store';
import { navigate, tabsStore } from '../../core/tabs';
import { ActionCard } from './ActionCard';
import { LocalSetup } from './LocalSetup';
import { useAssistant, useVision, type PendingAction, type Surface } from './assistant';
import { ComposerImages, ImageSteps, NoVisionCard, ReadCard, SentImages } from './ImageParts';
import { createAskSession, phaseLabel, type AskEntry, type AskSession, type ImageMode } from './session';
import { MAX_IMAGES, routeImages, stepLabel } from './vision';
import { effective, personalOff, toolAllowed, useLocalTools, useOrgAccess } from './tools';
import { guideFollowUp, intentContext, requestIntent } from './intent';
import { salesAccess } from './sales';
import { Checkbox } from '../../components/Checkbox';
import { GUIDES } from './help/catalog';
import { findGuides, guideText, isHowTo, moduleOf, suggestions, type Guide } from './help/guides';
import { GuideCard, guideById, HelpPanel, NoGuideCard, SupportDialog, type SupportKind } from './help/HelpUi';

/**
 * Ask the assistant (WS-AI-SRS-001 FR-DSK-AI-01/02/04): the server's own
 * assistant, with — only when the person leaves it on — the record the tab
 * beside it shows, and any file they pick from this computer. What it
 * proposes to change arrives as cards; nothing changes until one is
 * confirmed, and only in the main window.
 *
 * The conversation lives in a session (session.ts), not here: the drawer and
 * the floating widget pass the shared one, so either can close, minimise or
 * take over without losing it. Without one (Quick Ask) the panel keeps its
 * own, which ends with it.
 */
export function AskPanel({
  surface,
  session: given,
  tabRef,
  tabTitle,
  selection,
  insert,
  onOpen,
  reviewElsewhere,
  autoFocus,
  onMinimize,
  onSent,
}: {
  surface: Surface;
  /** The conversation to show; a private one when none is given. */
  session?: AskSession;
  /** The record the active tab shows, as `task:12`, when it shows one. */
  tabRef?: string | null;
  tabTitle?: string | null;
  /** Quick Ask: the text selected when the shortcut was pressed. It travels only with a question. */
  selection?: string;
  insert?: { label: string; run: (text: string) => void };
  onOpen?: (question: string, answer: string | null) => void;
  /** Where a card is reviewed when it cannot be confirmed here (Quick Ask). */
  reviewElsewhere?: () => void;
  autoFocus?: boolean;
  /** The floating widget: Minimize while working puts it down to its launcher, the answer still on its way. */
  onMinimize?: () => void;
  /** A question went to the assistant (not one a guide answered): for Auto-minimize after sending. */
  onSent?: () => void;
}) {
  const { availability, rules } = useAssistant(surface);
  const [own] = useState(() => (given ? null : createAskSession()));
  const session = given ?? own!;
  const st = useStore(session.store, (s) => s);
  const { entries, text, busy, phase, engine, streaming, useTab, files, fileError, images, imageProblems, step, imageMode } = st;
  const set = session.store.set;
  const input = useRef<HTMLTextAreaElement>(null);
  // Local AI (WS-SRS-LAI): the model on this computer, when one is installed — also offline.
  const offline = useStore(app, (s) => s.status?.network === 'OFFLINE');
  const localModels = useLocalModels(surface === 'assistant.panel');
  const localModel = surface === 'assistant.panel' ? localReady(localModels.data) : null;
  // One assistant (worksuite-desktop#53): the model on this computer when it can answer, online AI when it cannot and
  // the person allows it — no choosing between them here.
  const local = !!localModel;
  const fallbackOn = useStore(app, (s) => s.prefs?.ai.onlineFallback ?? true);
  const enabled = availability.data ? availability.data.enabled : !availability.isError;
  const online = fallbackOn && !offline && enabled;
  // Images (worksuite-desktop#59): attached in the assistant beside the tabs; read on this computer, and looked at only
  // by an online model the server verified as reading images, when online fallback allows it.
  const imagesOn = surface === 'assistant.panel';
  const vision = useVision(imagesOn && online);
  const imageRoute = routeImages({
    fallbackOn,
    offline,
    enabled,
    vision: vision.data ?? (vision.isLoading ? { available: false, reason: 'WorkSuite is still checking whether an online model can read images. Try again in a moment.' } : undefined),
    localText: !!localModel,
  });
  const picker = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const onlineWhy = online
    ? null
    : !fallbackOn
      ? 'Online fallback is off in Settings › AI Assistant.'
      : offline
        ? 'You are offline, so online AI cannot help right now.'
        : (availability.data?.reason ?? 'Online AI is not switched on for you.');
  // Module Access (worksuite-desktop#51): what each assistant may use, the organization's ceiling and this person's choice.
  const accessPrefs = useStore(app, (s) => s.prefs?.ai.moduleAccess);
  const org = useOrgAccess(surface === 'assistant.panel' && !offline);
  const tools = useLocalTools(!!localModel && !offline);
  const localTools = local && !offline && !!tools.data?.length
    ? {
        tools: tools.data,
        allow: (t: Parameters<typeof toolAllowed>[0]) => toolAllowed(t, org.data, accessPrefs),
        off: (org.data?.modules ?? []).filter((m) => !effective(m, 'local', accessPrefs).read).map((m) => `${m.label} (${effective(m, 'local', accessPrefs).readWhy})`),
      }
    : undefined;
  // A private conversation ends with the panel, and a local answer with it; a shared one carries on.
  useEffect(() => (own ? () => own.cancel() : undefined), [own]);
  // Showing the conversation reads what arrived while it was hidden.
  useEffect(() => session.view(), [session]);

  // A new tab's record is used by default only when online AI would answer anyway: with a model on this computer,
  // including it is the person's choice, since the tab is read online (worksuite-desktop#53).
  useEffect(() => {
    if (session.store.get().tabRef !== (tabRef ?? null)) set({ useTab: !local, tabRef: tabRef ?? null });
  }, [tabRef, session, set, local]);
  // The model on this computer is found once the panel is open: from then on the tab is the person's choice.
  useEffect(() => {
    if (local) set({ useTab: false });
  }, [local, set]);
  // The conversation follows new messages and a streaming answer while the reader is at the end (worksuite-desktop#50).
  const { scroller, content, unseen, toEnd, reveal, onScroll } = useStickToBottom(`${entries.length}:${busy}:${streaming?.length ?? -1}`);
  // An answer that has just landed — or the latest one, when the panel opens — is read from its first line, never from
  // mid-sentence (worksuite-desktop#150). It is the conversation's last element once nothing is on its way.
  const settled = !busy && !streaming && entries.at(-1)?.role === 'assistant';
  useEffect(() => {
    if (settled) reveal(content.current?.lastElementChild);
  }, [entries.length, settled, reveal, content]);

  // Neither the model on this computer nor online AI can answer: say why, and how to get one.
  const off = !local && !online ? `No model on this computer can answer yet. ${onlineWhy}` : null;
  const refs = online ? [...(useTab && tabRef ? [tabRef] : []), ...files.map((f) => f.ref)] : [];
  // Where the next answer comes from: files and the tab are read online.
  const viaLocal = local && refs.length === 0;

  // Help & Guide (worksuite-desktop#54): the app the person is in, their language, and the support dialog.
  const screen = useStore(tabsStore, (s) => s.tabs.find((x) => x.id === s.activeId)?.route ?? null);
  const module = moduleOf(screen);
  const language = useLanguage();
  const [helpOpen, setHelpOpen] = useState(false);
  const [support, setSupport] = useState<{ kind: SupportKind; question?: string } | null>(null);
  const languageNote = language !== 'en' ? ` Answer in ${(LANGUAGES.find((l) => l.id === language)?.label ?? language).replace(/^.*\((.*)\)$/, '$1')}.` : '';
  const base = () => ({ surface, refs, local, online, onlineWhy, selection, localTools, moduleAccess: personalOff(accessPrefs, 'worksuite'), sales: salesAccess(local ? 'local' : 'worksuite', org.data, accessPrefs, !offline), imageRoute });
  const sendImages = (mode: ImageMode) => {
    toEnd();
    const sent = session.sendImages({ ...base(), context: languageNote ? languageNote.trim() : undefined }, mode);
    if (mode !== 'extract') onSent?.();
    return sent;
  };
  const addImages = (list: FileList | File[] | null | undefined) => {
    const all = [...(list ?? [])];
    if (all.length) void session.addImages(all);
  };
  const onPaste = (e: ClipboardEvent<HTMLTextAreaElement>) => {
    const pasted = [...e.clipboardData.files];
    if (!imagesOn || !pasted.length) return;
    // A screenshot is pasted as an image; text that comes with it (from a document) still pastes as text.
    if (!e.clipboardData.types.includes('text/plain')) e.preventDefault();
    addImages(pasted);
  };
  const dropping = (e: DragEvent) => imagesOn && e.dataTransfer.types.includes('Files');
  const onDragOver = (e: DragEvent<HTMLDivElement>) => {
    if (!dropping(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    setDragging(true);
  };
  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    if (!dropping(e)) return;
    e.preventDefault();
    setDragging(false);
    addImages(e.dataTransfer.files);
  };
  const openGuide = (g: Guide, question: string | null = null) => {
    toEnd();
    setHelpOpen(false);
    session.showGuide(question, g.id, guideText(g));
  };

  const send = () => {
    const q = text.trim();
    if (images.length && !busy) return sendImages('ask');
    if (!q || busy) return Promise.resolve();
    // Asking is looking at the answer: back to the end, following again, from wherever the reader had scrolled.
    toEnd();
    // How to do something, not a request to do it: the checked guide of this version answers, no model asked.
    if (isHowTo(q) && refs.length === 0) {
      const found = findGuides(GUIDES, q, module);
      if (found.length) {
        session.showGuide(q, found[0]!.id, guideText(found[0]!), found.slice(1).map((g) => g.id));
        return Promise.resolve();
      }
      session.noGuide(q);
      return Promise.resolve();
    }
    // A follow-up while a guide is open: answered from that guide, by the model here first.
    const recent = entries.at(-1);
    const candidate = recent?.role === 'assistant' ? guideById(recent.guide) : null;
    const lastGuide = guideFollowUp(q, candidate) ? candidate : null;
    const context = lastGuide
      ? `The person is following this WorkSuite guide and asks a follow-up question. Answer from the guide, use the names on screen exactly as written in “ ”, and say so if the guide does not cover it. Do not do anything for them.${languageNote}\n${guideText(lastGuide)}`
      : languageNote
        ? languageNote.trim()
        : undefined;
    const sent = session.send({ ...base(), context: [requestIntent(q) !== 'general' || entries.some(e => e.guide) ? intentContext(q) : undefined, context].filter(Boolean).join('\n') || undefined });
    onSent?.();
    return sent;
  };
  /** No guide covers it: the assistant explains in general terms, and is told this is not a request to act. */
  const askAnyway = (question: string) =>
    session.send(
      {
        ...base(),
        context: `The person is asking how to do something in WorkSuite. They want instructions, not for you to do it: explain the steps in general terms, name the permission it may need, and do not take any action. Say that these steps are not from a checked WorkSuite guide.${languageNote}`,
      },
      question,
    );
  const attach = () => session.attach();

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void send();
    }
  };

  // While a question is on its way, or its answer waits on the person, the status says so; otherwise where the next one goes.
  const active = busy || phase === 'needsInput';
  const lastAnswer = [...entries].reverse().find((x) => x.role === 'assistant' && !x.error)?.text ?? null;

  return (
    <div
      className={cx('relative flex min-h-0 flex-1 flex-col gap-3', dragging && 'rounded-[12px] outline-2 outline-offset-2 outline-primary outline-dashed')}
      onDragOver={onDragOver}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false);
      }}
      onDrop={onDrop}
    >
      {dragging ? (
        <p role="status" className="pointer-events-none absolute inset-x-0 top-2 z-10 mx-auto w-fit rounded-full bg-primary px-3 py-1 text-[12px] font-semibold text-white shadow-md">
          Drop images to attach them
        </p>
      ) : null}
      {off ? (
        <div role="status" className="space-y-2 rounded-[10px] bg-warning-bg px-3 py-2 text-[12.5px] text-[#7A4308] dark:text-warning">
          <p>{off}</p>
          <div className="flex flex-wrap gap-1.5">
            {surface === 'assistant.panel' ? (
              <button type="button" onClick={() => navigate('/settings/local-ai')} className="h-7 rounded-[7px] bg-surface px-2.5 font-semibold text-ink hover:bg-subtle">Set up Local AI</button>
            ) : null}
            {!fallbackOn ? (
              <button type="button" onClick={() => navigate('/settings/ai')} className="h-7 rounded-[7px] bg-surface px-2.5 font-semibold text-ink hover:bg-subtle">AI Assistant settings</button>
            ) : (
              <button type="button" onClick={() => void availability.refetch()} className="h-7 rounded-[7px] bg-surface px-2.5 font-semibold text-ink hover:bg-subtle">Try again</button>
            )}
          </div>
        </div>
      ) : null}

      <div className="relative flex min-h-0 flex-1 flex-col">
      <div ref={scroller} onScroll={onScroll} data-testid="ai-conversation" className="min-h-0 flex-1 overflow-y-auto overscroll-contain scroll-thin" aria-live="polite">
        <div ref={content} className="flex flex-col gap-3 pb-1">
        {/* First-use Local AI setup: offered until a model on this computer can answer, then "ready" once (worksuite-desktop#49/#55). */}
        {surface === 'assistant.panel' ? (
          <LocalSetup
            onStart={() => input.current?.focus()}
          />
        ) : null}
        {helpOpen ? <HelpPanel module={module} onOpenGuide={(g) => openGuide(g)} onSupport={(kind) => setSupport({ kind })} onClose={() => setHelpOpen(false)} /> : null}
        {entries.length === 0 && !off ? (
          <div className="space-y-2">
            <p className="text-[12.5px] text-ink-3">
              Ask about your work — tasks, mail, files, meetings, customers — or how to do something in WorkSuite. The assistant sees only what you can open, and changes nothing until you confirm it.
            </p>
            {!helpOpen ? (
              <div className="flex flex-wrap gap-1.5" aria-label="Suggested guides">
                {suggestions(GUIDES, module, 3).map((g) => (
                  <button key={g.id} type="button" onClick={() => openGuide(g)} className="rounded-full border border-line px-2.5 py-1 text-[12px] font-semibold text-ink hover:bg-subtle">
                    {g.title}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}
        {entries.map((e, i) => (
          e.guide && guideById(e.guide) ? (
            <GuideCard key={i} guide={guideById(e.guide)!} question={e.question} others={(e.others ?? []).map(guideById).filter((g): g is Guide => !!g)} onOpenGuide={(g) => openGuide(g)} onSupport={(kind, q) => setSupport({ kind, question: q })} />
          ) : e.noGuide ? (
            <NoGuideCard key={i} question={e.question ?? ''} onAsk={!busy && (local || online) ? () => void askAnyway(e.question ?? '') : undefined} onSupport={(kind, q) => setSupport({ kind, question: q })} />
          ) : (
            e.noVision ? (
              <NoVisionCard
                key={i}
                route={e.noVision}
                hasImages={images.length > 0}
                busy={busy}
                onExtract={() => void sendImages('extract')}
                onLocalText={() => void sendImages('localText')}
                onSettings={() => navigate('/settings/ai')}
                onSetup={surface === 'assistant.panel' ? () => navigate('/settings/local-ai') : undefined}
              />
            ) : (
              <Bubble key={i} e={e} elsewhere={reviewElsewhere} onRetry={e.retry && i === entries.length - 1 && !busy ? () => void session.retry() : undefined} onSetup={surface === 'assistant.panel' ? () => navigate('/settings/local-ai') : undefined} onSettle={session.settle} />
            )
          )
        ))}
        {/* A growing answer is not read out word by word: the whole one is, once it lands. */}
        {streaming ? (
          <div aria-live="off">
            <Bubble e={{ role: 'assistant', text: streaming, local: true }} />
          </div>
        ) : null}
        {/* From the moment the question goes until the answer starts to show; read out once, as it appears. */}
        {busy && !streaming && step && imageMode ? (
          <ImageSteps step={step} mode={imageMode} />
        ) : busy && !streaming ? (
          <p data-testid="ai-thinking" className="flex items-center gap-2 text-[13px] text-ink-2">
            <Icon name="sparkles" size={16} aria-hidden className="shrink-0 text-teal motion-safe:animate-pulse" />
            {t('ai.thinking')}
          </p>
        ) : null}
        </div>
      </div>
      {/* While it works the widget can go down to its launcher; the answer carries on and is waiting there. */}
      {busy && onMinimize ? (
        <div className="absolute right-0 bottom-2 left-0 flex justify-center">
          <button type="button" onClick={onMinimize} className="flex h-8 items-center gap-1.5 rounded-full border border-line bg-surface px-3 text-[12px] font-semibold text-ink shadow-md hover:bg-subtle">
            <Icon name="minus" size={14} /> {t('ai.minimizeWhileWorking')}
          </button>
        </div>
      ) : unseen ? (
        <button type="button" onClick={toEnd} className="absolute bottom-2 left-1/2 flex h-8 -translate-x-1/2 items-center gap-1.5 rounded-full border border-line bg-surface px-3 text-[12px] font-semibold text-ink shadow-md hover:bg-subtle">
          <Icon name="arrow-down" size={14} /> Jump to latest
        </button>
      ) : null}
      </div>

      {lastAnswer && (insert || onOpen) ? (
        <div className="flex flex-wrap gap-1.5">
          {insert ? (
            <button type="button" onClick={() => insert.run(lastAnswer)} className="h-8 rounded-[8px] bg-primary px-3 text-[12.5px] font-bold text-white hover:bg-primary-hover">
              {insert.label}
            </button>
          ) : null}
          {onOpen ? (
            <button type="button" onClick={() => onOpen(entries.find((x) => x.role === 'user')?.text ?? '', lastAnswer)} className="h-8 rounded-[8px] border border-line px-3 text-[12.5px] font-semibold text-ink hover:bg-subtle">
              Open in WorkSuite
            </button>
          ) : null}
        </div>
      ) : null}

      <div className="space-y-2 border-t border-line pt-3">
        {tabRef && online ? (
          <label className="flex items-center gap-2 text-[12px] text-ink-2">
            <Checkbox checked={useTab} onChange={(e) => set({ useTab: e.target.checked })} />
            <span className="truncate">Use this tab{tabTitle ? `: ${tabTitle}` : ''}</span>
          </label>
        ) : null}
        {files.length ? (
          <div className="flex flex-wrap gap-1">
            {files.map((f) => (
              <span key={f.ref} className="flex items-center gap-1 rounded-full bg-subtle px-2 py-0.5 text-[11.5px] text-ink-2">
                <Icon name="paperclip" size={12} />
                <span className="max-w-[160px] truncate">{f.name}</span>
                {f.via === 'drive' ? <span className="text-ink-3">(Drive)</span> : null}
                <button type="button" aria-label={`Leave out ${f.name}`} onClick={() => set((s) => ({ files: s.files.filter((x) => x.ref !== f.ref) }))}><Icon name="x" size={12} /></button>
              </span>
            ))}
          </div>
        ) : null}
        {fileError ? <p role="alert" className="text-[12px] text-danger">{fileError}</p> : null}
        <ComposerImages images={images} onRemove={(id) => session.removeImage(id)} disabled={busy} />
        {imageProblems.length ? (
          <div role="alert" className="flex items-start gap-1.5 rounded-[8px] bg-danger-bg px-2.5 py-1.5 text-[12px] text-danger">
            <Icon name="alert" size={14} className="mt-0.5 shrink-0" />
            <ul className="min-w-0 flex-1 space-y-0.5">
              {imageProblems.map((p, i) => (
                <li key={i}>{p}</li>
              ))}
            </ul>
            <button type="button" onClick={() => set({ imageProblems: [] })} aria-label="Dismiss" className="shrink-0 hover:text-ink"><Icon name="x" size={13} /></button>
          </div>
        ) : null}
        {/* The Chat composer's box: the field and its buttons in one bordered, focus-ringed frame. */}
        <div className={cx('relative flex items-end gap-1 rounded-[12px] border px-2 py-1.5 transition-colors', off ? 'border-line bg-subtle/60' : 'border-line bg-surface focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/15')}>
          {surface === 'assistant.panel' && rules?.localFiles && online ? (
            <button type="button" onClick={() => void attach()} disabled={busy || !!off} className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-[8px] text-ink-2 hover:bg-subtle hover:text-ink disabled:opacity-50" aria-label="Ask about a file from this computer" title="Ask about a file from this computer">
              <Icon name="paperclip" size={18} />
            </button>
          ) : null}
          {imagesOn ? (
            <>
              <input
                ref={picker}
                type="file"
                multiple
                accept="image/png,image/jpeg,image/webp,image/gif,image/bmp,.png,.jpg,.jpeg,.webp,.gif,.bmp"
                className="hidden"
                tabIndex={-1}
                aria-hidden
                onChange={(e) => {
                  addImages(e.target.files);
                  e.target.value = '';
                }}
              />
              <button
                type="button"
                onClick={() => picker.current?.click()}
                disabled={busy || images.length >= MAX_IMAGES}
                className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-[8px] text-ink-2 hover:bg-subtle hover:text-ink disabled:opacity-50"
                aria-label="Attach images"
                title={images.length >= MAX_IMAGES ? 'Up to 5 images can go with one message' : 'Attach images (or paste, or drop them here)'}
              >
                <Icon name="image" size={18} />
              </button>
            </>
          ) : null}
          <textarea
            ref={input}
            value={text}
            onChange={(e) => set({ text: e.target.value.slice(0, 4000) })}
            onKeyDown={onKey}
            onPaste={onPaste}
            rows={1}
            autoFocus={autoFocus}
            disabled={!!off}
            placeholder={images.length ? 'Ask about the image, or choose Extract Text' : selection ? 'Ask about the selected text' : 'Ask the assistant'}
            aria-label="Your question"
            className="bare-focus field-sizing-content max-h-40 min-h-[34px] min-w-0 flex-1 resize-none bg-transparent px-1 py-[7px] text-[13.5px] text-ink outline-none"
          />
          {busy ? (
            <button type="button" onClick={() => session.cancel()} className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-[9px] border border-line text-ink hover:bg-subtle" aria-label={t('ai.stop')} title={t('ai.stop')}>
              <Icon name="stop" size={14} />
            </button>
          ) : null}
          {images.length && !busy ? (
            <button type="button" onClick={() => void sendImages('extract')} className="flex h-[34px] shrink-0 items-center gap-1 rounded-[9px] border border-line px-2.5 text-[12.5px] font-semibold text-ink hover:bg-subtle" title="Read the text in the images, on this computer">
              <Icon name="scan" size={15} /> Extract Text
            </button>
          ) : null}
          <button type="button" onClick={() => void send()} disabled={busy || !text.trim() || !!off} className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-[9px] bg-primary text-white hover:bg-primary-hover disabled:bg-subtle disabled:text-ink-3" aria-label="Send" title="Send (Enter)">
            <Icon name="send" size={16} />
          </button>
        </div>
        <div className="flex items-center gap-2 px-1 text-[11px] text-ink-3">
          {/* Where the next answer comes from, said plainly — never a promise the mode cannot keep (worksuite-desktop#53). */}
          <span data-testid="ai-mode" className="min-w-0 flex-1" title={viaLocal ? (localTools ? 'Answered on this computer. The WorkSuite data it reads, and the changes it prepares, come from WorkSuite as you.' : 'Answered on this computer; your question stays here.') + (online ? ' If it cannot answer, online AI does.' : '') : 'Your question, and the files and tab you include, are sent to WorkSuite AI.'}>
            <Icon name={(active ? engine === 'local' : viaLocal) ? 'cpu' : 'sparkles'} size={11} className="mr-1 inline align-[-1px]" />
            {active ? (step ? stepLabel(step) : phaseLabel(phase, engine)) : `${phaseLabel('idle', viaLocal ? 'local' : 'online')}${viaLocal && localTools ? ' · WorkSuite data from the server' : ''} · Enter to send`}
          </span>
          <button type="button" onClick={() => setHelpOpen(!helpOpen)} aria-expanded={helpOpen} className="flex shrink-0 items-center gap-1 font-semibold text-ink-2 hover:text-ink">
            <Icon name="help" size={12} /> Help &amp; Guide
          </button>
          {given && entries.length > 0 && !busy ? (
            <button type="button" onClick={() => session.reset()} className="shrink-0 font-semibold text-ink-2 hover:text-ink">
              New conversation
            </button>
          ) : null}
        </div>
      </div>
      {support ? <SupportDialog kind={support.kind} question={support.question} screen={screen} onClose={() => setSupport(null)} /> : null}
    </div>
  );
}

function Bubble({ e, elsewhere, onRetry, onSetup, onSettle }: { e: AskEntry; elsewhere?: () => void; onRetry?: () => void; onSetup?: () => void; onSettle?: (a: PendingAction) => void }) {
  if (e.role === 'user') {
    const said = <p className="ml-8 self-end whitespace-pre-wrap rounded-[12px] bg-primary px-3 py-2 text-[13px] text-white selectable">{e.text}</p>;
    return e.images?.length ? (
      <div className="ml-8 flex flex-col items-end gap-1.5 self-end">
        <SentImages images={e.images} />
        {said}
      </div>
    ) : (
      said
    );
  }
  if (e.read) return <ReadCard reads={e.read} text={e.text} />;
  if (e.stopped) {
    return (
      <div className="space-y-1.5">
        <span className="inline-flex items-center gap-1 rounded-full bg-subtle px-2 py-0.5 text-[11px] text-ink-2">
          <Icon name="stop" size={10} /> {t('ai.stopped')}
        </span>
        {e.text !== t('ai.stopped') ? <Markdown text={e.text} className="text-[13.5px] leading-[1.55] text-ink selectable" /> : null}
        {onRetry ? (
          <button type="button" onClick={onRetry} className="flex h-8 items-center gap-1.5 rounded-[8px] border border-line px-3 text-[12.5px] font-semibold text-ink hover:bg-subtle">
            <Icon name="rotate-cw" size={14} /> {t('ai.retry')}
          </button>
        ) : null}
      </div>
    );
  }
  if (e.error) {
    return (
      <div className="space-y-1.5">
        <p role="alert" className="flex items-start gap-1.5 rounded-[10px] bg-danger-bg px-3 py-2 text-[12.5px] text-danger"><Icon name="alert" size={15} className="mt-0.5 shrink-0" />{e.text}</p>
        <div className="flex flex-wrap gap-1.5">
          {onRetry ? (
            <button type="button" onClick={onRetry} className="flex h-8 items-center gap-1.5 rounded-[8px] border border-line px-3 text-[12.5px] font-semibold text-ink hover:bg-subtle">
              <Icon name="rotate-cw" size={14} /> {t('ai.retry')}
            </button>
          ) : null}
          {e.needsSetup && onSetup ? (
            <button type="button" onClick={onSetup} className="flex h-8 items-center gap-1.5 rounded-[8px] border border-line px-3 text-[12.5px] font-semibold text-ink hover:bg-subtle">
              <Icon name="cpu" size={14} /> Set up Local AI
            </button>
          ) : null}
        </div>
      </div>
    );
  }
  const turn = e.turn;
  const records = (turn?.sources ?? []).filter((s) => s.kind === 'record');
  const cards = (turn?.pending_actions ?? []) as PendingAction[];
  return (
    <div className="space-y-2">
      {(turn?.tool_runs ?? []).length ? (
        <div className="flex flex-wrap gap-1">
          {turn!.tool_runs.map((r, i) => (
            <span key={i} title={r.error ?? undefined} className={cx('rounded-full px-2 py-0.5 text-[11px]', r.ok ? 'bg-subtle text-ink-2' : 'bg-warning-bg text-[#7A4308]')}>{r.label}</span>
          ))}
        </div>
      ) : null}
      {e.fromImageText ? (
        <span title="The model on this computer cannot see pictures: it answered from the text read in the image." className="inline-flex items-center gap-1 rounded-full bg-subtle px-2 py-0.5 text-[11px] text-ink-2">
          <Icon name="cpu" size={11} /> Processed locally · from the text in the image
        </span>
      ) : e.local ? (
        <span className="inline-flex items-center gap-1 rounded-full bg-subtle px-2 py-0.5 text-[11px] text-ink-2">
          <Icon name="cpu" size={11} /> Processed locally
        </span>
      ) : e.fallback ? (
        <span title={e.fallback} className="inline-flex items-center gap-1 rounded-full bg-subtle px-2 py-0.5 text-[11px] text-ink-2">
          <Icon name="sparkles" size={11} /> Used online AI · {e.fallback}
        </span>
      ) : null}
      {/* Answers come in Markdown: drawn, never shown as raw marks (worksuite-desktop#150). */}
      <Markdown text={e.text} className="text-[13.5px] leading-[1.55] text-ink selectable" />
      {records.length ? (
        <ul className="space-y-0.5 border-t border-line pt-1.5 text-[12px]">
          {records.map((s) => (
            <li key={`${s.n}-${s.title}`}>
              {s.url ? <button type="button" onClick={() => navigate(s.url!)} className="text-primary hover:underline">[{s.n}] {s.title}</button> : <span className="text-ink-3">[{s.n}] {s.title}</span>}
            </li>
          ))}
        </ul>
      ) : null}
      {cards.filter((c) => c.status !== 'superseded').map((c) => <ActionCard key={c.id} action={c} elsewhere={elsewhere} onChange={onSettle} />)}
    </div>
  );
}
