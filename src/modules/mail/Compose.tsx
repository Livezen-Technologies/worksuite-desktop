import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { apiPost, request } from '../../core/api';
import { call, errorMessage } from '../../core/bridge';
import { flushDrafts, useDraft } from '../../core/drafts';
import { text } from '../../core/i18n';
import { addDays, bytes, timeLabel, todayInZone, wallToUtc } from '../../core/time';
import { toast } from '../../core/toasts';
import { Icon } from '../../components/Icon';
import type { MenuSection } from '../../components/Menu';
import { PrimaryActionButton } from '../../components/PrimaryAction';
import { Select } from '../../components/Select';
import { DriveFilePicker, type DriveFileRow } from '../../components/DriveFilePicker';
import { Button, ErrorNote, FileBadge, Modal, TextField, cx } from '../../components/ui';
import { AiTextDialog } from '../ai/AiTextDialog';
import { SuggestTimes } from './SuggestTimes';
import { createMeeting } from '../meet/api';
import { ComposeActions, composeActionGroups, quickPartsReason, type ComposeActionsProps } from './editor/ComposeActions';
import { ComposeSidePanel, PanelPopover, useComposePanel, useWidth } from './ComposePanel';
import { MailEditor } from './editor/MailEditor';
import { INLINE_MAX_BYTES, MESSAGE_MAX_BYTES, MESSAGE_WARN_BYTES, embeddedBytes } from './editor/images';
import { meetingLinkHtml } from './editor/insert';
import { MailMerge } from './MailMerge';
import { canOpen } from '../../core/access';
import { MAIL_TASKS, WRITING_TASKS, type TextTask } from '../ai/textTools';
import { messageAction, sendMessage, useQuickParts, useSignatures, useTemplates } from './api';
import { chooseSignature as signatureFor, cleanComposeHtml, composeBody, composeText, migrateDraft, parseQuote, sendChecks, signatureBlock, splitSignature, textToComposeHtml, voteChoices, withVotePrompt, type ComposeDraft } from './composeHtml';
import { fillSignature, valuesFor, withEmbedded } from './signatures/signatureHtml';
import { MentionPopup } from './Mentions';
import { mailboxLetter } from './model';
import { sendAfterUndoWindow } from './outgoing';
import { AccountAvatar, AccountTag } from './parts';
import { useAccountTags } from './useAccountTags';
import { RecipientField, addressOf, domainOf } from './Recipients';
import { unquote } from './quote';
import { escapeHtml, parseAddresses } from './sanitize';
import type { ComposeSeed, Mailbox, Signature, Template } from './types';

/**
 * Writing an email, in the page's own tab (UI-07): From, To, Cc and Bcc, the
 * subject, the message in Mail's own editor (editor/MailEditor: one row of
 * formatting tools, pictures inside the message, tables, more to insert —
 * worksuite-desktop#188) with AI writing tools, recipients as chips with
 * contact suggestions, a row of actions (attach from this computer, from
 * Files or as a cloud link, templates, signatures, Suggest times, Mail merge,
 * options), the quoted email in a collapsible block below it,
 * templates, and Send — now, with a few seconds to undo, or later, from the
 * server so this computer can be off. The draft is kept on this computer as
 * it is typed (FR-OFF-07) — cleaned HTML, with older plain-text drafts brought
 * forward; offline, Send queues the message and it goes when the connection
 * returns. It goes as HTML with a plain-text alternative.
 *
 * Laid out top to bottom (worksuite-desktop#213): the address rows and the
 * subject on one 64 px label column, the actions and formatting rows, the
 * message — which takes all the height left and scrolls inside, with the
 * quoted email below it — the attachments, and the footer: Send ▾ (send
 * later, send and archive, send as), the draft's state, Discard and Pop out.
 * Templates and Send later are in a side panel that can be resized and
 * hidden, and is a popover when the composer is narrow (ComposePanel).
 * Keys: Ctrl/⌘+Enter sends, Ctrl/⌘+Shift+D discards (after asking), Esc
 * puts the message aside with its draft saved.
 */

type Attached = NonNullable<ComposeDraft['attachments']>[number];
/** How Send was asked for: Send and archive archives the message replied to. */
type SendOpts = { archive?: boolean };

const tooManyPictures = () => text('The pictures inside this message are too big to send together. Send some as attachments instead (select a picture › Send as attachment instead).');

/** The draft's key on this computer: one per new message, one per message replied to. */
export function draftContext(seed: ComposeSeed): string {
  return seed.mode === 'new' ? 'compose:new' : `compose:${seed.mode}:${seed.inReplyTo ?? seed.subject ?? ''}`;
}

/** The moments "Send later" offers, on the reader's clock: tomorrow at 8, and Monday at 8. */
export function laterChoices(today = todayInZone()): Array<{ id: string; label: string; at: string; when: string }> {
  const tomorrow = addDays(today, 1);
  const dow = new Date(`${today}T12:00:00Z`).getUTCDay();
  const monday = addDays(today, ((8 - dow) % 7) || 7);
  const day = (ymd: string) => new Date(`${ymd}T12:00:00Z`).toLocaleDateString(undefined, { weekday: 'short', timeZone: 'UTC' });
  return [
    { id: 'tomorrow', label: text('Tomorrow morning'), at: wallToUtc(tomorrow, 8 * 60), when: `${day(tomorrow)} 08:00` },
    { id: 'monday', label: text('Monday morning'), at: wallToUtc(monday, 8 * 60), when: `${day(monday)} 08:00` },
  ];
}

const mac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/i.test(navigator.platform || navigator.userAgent || '');
const MOD = mac ? '⌘' : 'Ctrl+';
const ONE_ROW_KEY = 'ws.mail.composeOneRow';
/** From this composer width up, the actions can join the formatting row (when the person chose that). */
export const ONE_ROW_MIN = 1280;

function readOneRow(): boolean {
  try {
    return localStorage.getItem(ONE_ROW_KEY) === '1';
  } catch {
    return false;
  }
}

/** The address of the message being opened again in a window of its own: the same seed, so it finds the same draft. */
export function popOutRoute(seed: ComposeSeed): string {
  const q = new URLSearchParams({ compose: '1' });
  if (seed.mode !== 'new') q.set('mode', seed.mode);
  for (const k of ['to', 'cc', 'bcc', 'subject', 'body', 'quote'] as const) if (seed[k]) q.set(k, seed[k]!);
  if (seed.inReplyTo) q.set('irt', seed.inReplyTo);
  return `/mail?${q}`;
}

/** The footer's word on the draft: calm, never an error. */
export function draftStatus(s: { saving: boolean; savedAt: string | null; restored: boolean; edited: boolean }): string {
  if (s.saving) return text('Saving…');
  if (s.savedAt && s.edited) return text('Draft saved {time}', { time: timeLabel(s.savedAt) });
  if (s.restored) return text('Restored from this computer');
  return '';
}

export function Compose({ seed, boxes, defaultBox, offline, onClose, onReopen, onMinimise, onPopOut }: { seed: ComposeSeed; boxes: Mailbox[]; defaultBox: string | null; offline: boolean; onClose: () => void; onReopen: (seed: ComposeSeed) => void; onMinimise?: () => void; onPopOut?: (route: string, title: string) => void }) {
  const context = draftContext(seed);
  const seedQuote = seed.quote ?? '';
  const draft = useDraft<ComposeDraft>('mail', context, { to: seed.to ?? '', cc: seed.cc ?? '', bcc: seed.bcc ?? '', subject: seed.subject ?? '', html: seed.body ? textToComposeHtml(seed.body) : '', quote: seedQuote, from: seed.mailbox ?? defaultBox ?? '', attachments: [], v: 2 });
  const [error, setError] = useState<string | null>(null);
  const [showCc, setShowCc] = useState<boolean | 'opened'>(!!seed.cc);
  const [showBcc, setShowBcc] = useState<boolean | 'opened'>(!!seed.bcc);
  const [edited, setEdited] = useState(false);
  const [uploading, setUploading] = useState<Array<{ id: string; name: string; size: number }>>([]);
  const [later, setLater] = useState<string | null>(null);
  const [pick, setPick] = useState('');
  const [busy, setBusy] = useState(false);
  const [quoteOpen, setQuoteOpen] = useState(false);
  const [drive, setDrive] = useState(false);
  const [discarding, setDiscarding] = useState(false);
  const [oneRow, setOneRowState] = useState(readOneRow);
  const area = useRef<HTMLDivElement>(null);
  const form = useRef<HTMLFormElement>(null);
  const sendWrap = useRef<HTMLDivElement>(null);
  const actionsRow = useRef<HTMLDivElement>(null);
  const templateAnchor = useRef<HTMLElement | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const panel = useComposePanel(area);
  const formWidth = useWidth(form);
  const merged = oneRow && formWidth >= ONE_ROW_MIN;
  const setOneRow = (on: boolean) => {
    try {
      if (on) localStorage.setItem(ONE_ROW_KEY, '1');
      else localStorage.removeItem(ONE_ROW_KEY);
    } catch {
      // A view preference only.
    }
    setOneRowState(on);
  };
  // A draft saved by an older version (plain text with the quote inside) comes back as rich text and a separate quote.
  const v = useMemo(() => migrateDraft(draft.value, seedQuote), [draft.value, seedQuote]);
  // The draft as of the last change, for handlers that run before the next render (an upload finishing, Send right after a chip).
  const latest = useRef(v);
  useLayoutEffect(() => {
    latest.current = v;
  }, [v]);
  const set = (patch: Partial<ComposeDraft>) => {
    draft.setValue({ ...latest.current, ...patch });
    latest.current = { ...latest.current, ...patch };
    setEdited(true);
  };
  // The names behind chosen addresses, so a chip reads "Nimal Perera" rather than the address (kept with the draft).
  const named = (email: string, name: string) => set({ names: { ...(latest.current.names ?? {}), [email.toLowerCase()]: name } });
  // @mentions (DMO-CMP-14): the person goes on To, once.
  const editorEl = useRef<HTMLDivElement | null>(null);
  const mentioned = (p: { name: string; email: string }) => {
    const to = parseAddresses(latest.current.to);
    if (!to.some((a) => a.toLowerCase() === p.email.toLowerCase())) set({ to: [...to, p.email].join(', '), names: { ...(latest.current.names ?? {}), [p.email.toLowerCase()]: p.name } });
  };
  const templates = useTemplates(true);
  const quickParts = useQuickParts(true);
  const [voteDialog, setVoteDialog] = useState(false);
  const [suggesting, setSuggesting] = useState(false);
  const [cloud, setCloud] = useState(false);
  const [saveTpl, setSaveTpl] = useState(false);
  // Mail merge works on the message as it is when opened (DMO-CMP-18).
  const [merging, setMerging] = useState<ReturnType<typeof payload> | null>(null);
  // A choice from the Options and Quick Parts menus, put into the draft right after (menus hand over data, not the draft's ref).
  const [pending, setPending] = useState<{ options?: NonNullable<ComposeDraft['options']>; part?: string } | null>(null);
  const signatures = useSignatures(true);
  // The mailbox it goes from: the draft's, else the one the page names, else the first (the list may arrive after the composer opens).
  const from = boxes.find((b) => String(b.id) === v.from) ?? boxes.find((b) => String(b.id) === defaultBox) ?? boxes.find((b) => b.is_default) ?? boxes[0] ?? null;
  const fromId = from ? String(from.id) : v.from;
  const accountTagList = useAccountTags();
  const fromTag = from ? accountTagList.tags.get(from.id) : undefined;
  // What the person wrote, and the signature below it: AI and templates work on the first and keep the second.
  const [mine, signature] = splitSignature(v.html);
  const own = composeText(mine);

  // A signature as it goes into this message: its fields filled for the From account and the profile
  // (worksuite-desktop#166; an older server fills them itself), and, in embedded mode, its pictures inside.
  const sigList = signatures.data?.signatures ?? [];
  const sigValues = signatures.data?.values ? valuesFor(signatures.data.values, from) : null;
  const blockOf = (s: Signature | null) => (s ? signatureBlock(withEmbedded(sigValues ? fillSignature(s.html, sigValues) : (s.filled ?? s.html), s.embedded)) : '');
  const same = (a: string, b: string) => cleanComposeHtml(a) === cleanComposeHtml(b);

  // The default signature goes in once, below the message, on a message that has none yet.
  // The account's own signature for new mail or for replies (DMO-CMP-06), and where it goes.
  const choice = signatureFor(sigList, signatures.data?.settings, fromId || null, seed.mode);
  const sig = choice.signature;
  // The signature the composer put in itself: changing From switches it; one chosen or edited by hand stays.
  const autoSig = useRef<string | null>(null);
  useEffect(() => {
    if (!sig || v.signed || draft.restored || own.trim() || signature) return;
    const block = blockOf(sig);
    autoSig.current = block;
    draft.setValue({ ...v, signed: true, html: `${mine}${block}` });
    // Only when the signature arrives.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig?.id]);
  const lastFrom = useRef(fromId);
  useEffect(() => {
    if (lastFrom.current === fromId) return;
    lastFrom.current = fromId;
    if (autoSig.current === null || !signatures.data) return;
    const [mineNow, sigNow] = splitSignature(latest.current.html);
    if (!same(sigNow, autoSig.current)) return;
    const next = blockOf(sig);
    autoSig.current = next;
    set({ html: `${mineNow}${next}`, signed: true });
    // When the From account changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fromId]);

  // AI writing tools (worksuite-desktop#53) work on what the person wrote — never on the signature or the quoted email.
  const [ai, setAi] = useState<{ task: TextTask; title: string } | null>(null);
  const original = v.quote ? unquote(v.quote) : '';
  const aiItems = [
    ...(original && seed.mode !== 'forward' ? [{ label: text('Draft a reply'), icon: 'reply', run: () => setAi({ task: 'reply', title: text('Draft a reply') }) }] : []),
    ...WRITING_TASKS.map((w) => ({ label: w.label, disabled: !own.trim(), run: () => setAi({ task: w.task, title: w.label }) })),
    ...MAIL_TASKS.map((w) => ({ label: w.label, disabled: !own.trim(), run: () => setAi({ task: w.task, title: w.label }) })),
  ];
  const choices = useMemo(() => laterChoices(), []);
  const laterAt = later === 'pick' ? (pick ? new Date(pick).toISOString() : null) : (choices.find((c) => c.id === later)?.at ?? null);

  const attach = async (files: File[]) => {
    if (!files.length) return;
    if (offline) {
      toast('error', text('Attaching needs WorkSuite.'));
      return;
    }
    for (const file of files) {
      if (file.size > 25 * 1024 * 1024) {
        toast('error', text('{name} is over the 25 MB limit.', { name: file.name }));
        continue;
      }
      const id = `${file.name}-${Math.random().toString(36).slice(2)}`;
      setUploading((u) => [...u, { id, name: file.name, size: file.size }]);
      try {
        const form = new FormData();
        form.set('file', file, file.name);
        form.set('kind', 'attach');
        const r = await request<Attached>('POST', '/api/mail/upload', { body: form });
        set({ attachments: [...(latest.current.attachments ?? []), { token: r.data.token, name: r.data.name, size: r.data.size }] });
      } catch (e) {
        toast('error', errorMessage(e));
      } finally {
        setUploading((u) => u.filter((n) => n.id !== id));
      }
    }
  };

  /** Files from the Drive go as copies, staged on the server like an upload (the Drive's download permission decides). */
  const attachFromDrive = async (files: DriveFileRow[]) => {
    setDrive(false);
    for (const f of files) {
      const id = `drive-${f.id}-${Math.random().toString(36).slice(2)}`;
      setUploading((u) => [...u, { id, name: f.name, size: Number(f.size) || 0 }]);
      try {
        const r = await apiPost<Attached>('/api/mail/upload/from-drive', { file_id: Number(f.id) });
        set({ attachments: [...(latest.current.attachments ?? []), { token: r.token, name: r.name, size: r.size, source: 'drive' }] });
      } catch (e) {
        toast('error', text('“{name}” was not attached: {reason}', { name: f.name, reason: errorMessage(e) }));
      } finally {
        setUploading((u) => u.filter((n) => n.id !== id));
      }
    }
  };

  /** A link to a file in Files instead of a copy: a public share link, put into the message above the signature. */
  const cloudLink = async (files: DriveFileRow[]) => {
    setCloud(false);
    for (const f of files) {
      try {
        const r = await apiPost<{ url: string }>('/api/shares', { file_id: Number(f.id), visibility: 'public' });
        setPending({ part: `<div><a href="${escapeHtml(r.url)}">${escapeHtml(f.name)}</a></div>` });
      } catch (e) {
        toast('error', text('No link was made for “{name}”: {reason}', { name: f.name, reason: errorMessage(e) }));
      }
    }
  };

  /** A signature chosen from the Signature menu replaces the one in the message (or takes it out). */
  const chooseSignature = (s: Signature | null) => {
    const [mineNow] = splitSignature(latest.current.html);
    autoSig.current = null;
    set({ html: `${mineNow}${blockOf(s)}`, signed: true });
  };
  const currentSignature = signature ? String(sigList.find((s) => same(blockOf(s), signature))?.id ?? 'custom') : '';

  // The meeting link in the Insert menu: a WorkSuite Meet meeting for later, named after the subject.
  const meetingLink = canOpen('meet')
    ? async () => {
        const m = await createMeeting({ title: latest.current.subject || text('Meeting'), later: true });
        return meetingLinkHtml(m.join_url, m.join_url, text('Join with WorkSuite Meet:'));
      }
    : undefined;

  const aiSections: MenuSection[] = [{ id: 'ai', items: aiItems.map((a, i) => ({ id: `ai-${i}`, label: a.label, icon: 'icon' in a ? a.icon : undefined, disabled: 'disabled' in a ? a.disabled : false, reason: text('Write something first.'), onSelect: a.run })) }];

  // Pictures inside the message and attachments together: most servers refuse a message over 25 MB.
  const totalBytes = embeddedBytes(v.html) + (v.attachments ?? []).reduce((n, a) => n + (a.size || 0), 0);

  // Read at the moment of sending: an address committed by the same keystroke is in it.
  const payload = (scheduleAt?: string) => {
    const d = latest.current;
    const votes = voteChoices(d.options?.vote);
    const body = withVotePrompt(composeBody(d.html, d.quote, choice.placement), votes, text('Vote by replying with one of: {choices}.', { choices: votes.join(', ') }));
    return {
      to: parseAddresses(d.to),
      cc: parseAddresses(d.cc),
      bcc: parseAddresses(d.bcc),
      subject: d.subject,
      body_html: body.html,
      body_text: body.text,
      in_reply_to: seed.inReplyTo,
      reply_mode: seed.mode === 'new' ? undefined : seed.mode,
      // A From chosen by the same click (Send as…) is in the draft before the next render.
      mailbox: (boxes.some((b) => String(b.id) === d.from) ? d.from : fromId) || undefined,
      attachments: (d.attachments ?? []).map((a) => a.token),
      ...(d.options && Object.keys(d.options).length ? { options: d.options } : {}),
      ...(scheduleAt ? { schedule_at: scheduleAt } : {}),
    };
  };

  const [checks, setChecks] = useState<{ issues: Array<'attachment' | 'subject'>; opts: SendOpts } | null>(null);
  useEffect(() => {
    if (!pending) return;
    const d = latest.current;
    if (pending.options) set({ options: { ...d.options, ...pending.options } });
    if (pending.part) {
      const [mineNow, sigNow] = splitSignature(d.html);
      set({ html: `${mineNow}${composeText(mineNow).trim() ? '<div><br></div>' : ''}${cleanComposeHtml(pending.part)}${sigNow}` });
    }
    setPending(null);
    // Only when a choice arrives.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending]);
  const sendNow = (checked = false, opts: SendOpts = {}) => {
    setError(null);
    const d = latest.current;
    if (!parseAddresses(d.to).length) return setError(text('Add at least one recipient.'));
    if (embeddedBytes(d.html) > INLINE_MAX_BYTES) return setError(tooManyPictures());
    // Forgot the file? No subject? Asked once before it goes (DMO-CMP-16); quoted text does not count (#213).
    const issues = checked ? [] : sendChecks(d, composeText(splitSignature(d.html)[0]));
    if (issues.length) return setChecks({ issues, opts });
    const source = opts.archive ? seed.source : undefined;
    const body = payload();
    const subject = d.subject || text('(no subject)');
    const toList = parseAddresses(d.to).join(', ');
    // The window to take it back; the composer closes now and the draft stays until it has gone.
    sendAfterUndoWindow(
      subject,
      async () => {
        try {
          const outcome = await sendMessage(body, text('Send “{subject}” to {to}', { subject, to: toList }));
          await call('offline:deleteDraft', { module: 'mail', context }).catch(() => undefined);
          // Send and archive: the message replied to goes to the archive once the reply has gone.
          if (source) await messageAction(source, 'archive', seed.subject ?? '').catch((e) => toast('error', errorMessage(e)));
          toast(outcome === 'queued' ? 'info' : 'success', outcome === 'queued' ? text('Offline — “{subject}” sends when you reconnect.', { subject }) : text('Sent.'));
        } catch (e) {
          toast('error', text('“{subject}” was not sent: {reason} It is still in your drafts.', { subject, reason: errorMessage(e) }));
          onReopen(seed);
        }
      },
      () => onReopen(seed),
    );
    onClose();
  };

  const sendLater = async (at: string | null) => {
    setError(null);
    if (!at) return setError(text('Choose when to send it.'));
    if (!parseAddresses(latest.current.to).length) return setError(text('Add at least one recipient.'));
    if (embeddedBytes(latest.current.html) > INLINE_MAX_BYTES) return setError(tooManyPictures());
    if (offline) return setError(text('Scheduling needs WorkSuite: try again when you are back online.'));
    setBusy(true);
    try {
      await apiPost('/api/mail/send', payload(at));
      await draft.clear();
      toast('success', text('Scheduled for {time}.', { time: new Date(at).toLocaleString(undefined, { weekday: 'short', hour: '2-digit', minute: '2-digit' }) }));
      onClose();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const applyTemplate = async (t: Template) => {
    try {
      const r = await apiPost<{ subject?: string; body_html?: string }>('/api/mail/templates/render', { subject: t.subject ?? '', body_html: t.body_html, to: parseAddresses(v.to) });
      // The template keeps its formatting; it goes after what is written, above the signature.
      const body = cleanComposeHtml(r.body_html ?? t.body_html);
      set({ subject: v.subject.trim() ? v.subject : (r.subject ?? t.subject ?? ''), html: `${mine}${own.trim() ? '<div><br></div>' : ''}${body}${signature}` });
    } catch (e) {
      toast('error', errorMessage(e));
    }
  };

  // A Quick Step's "Reply with template": the template goes in once, when it has loaded.
  const templated = useRef(false);
  const seedTemplate = seed.templateId ? (templates.data?.templates ?? []).find((t) => t.id === seed.templateId) : undefined;
  const applyRef = useRef(applyTemplate);
  useEffect(() => {
    applyRef.current = applyTemplate;
  });
  useEffect(() => {
    if (!seedTemplate || templated.current || draft.restored) return;
    templated.current = true;
    void applyRef.current(seedTemplate);
  }, [seedTemplate, draft.restored]);

  /** Message options (DMO-CMP-10/11/12/13), and the S/MIME choices this composer does not have yet. */
  const optionSections = (): MenuSection[] => [
    { id: 'importance', label: text('Importance'), items: (['high', 'normal', 'low'] as const).map((l) => ({ id: l, label: l === 'high' ? text('High') : l === 'low' ? text('Low') : text('Normal'), radio: true, checked: (latest.current.options?.importance ?? 'normal') === l, onSelect: () => setPending({ options: { importance: l === 'normal' ? undefined : l } }) })) },
    { id: 'sensitivity', label: text('Sensitivity'), items: (['normal', 'personal', 'private', 'confidential'] as const).map((l) => ({ id: l, label: { normal: text('Normal'), personal: text('Personal'), private: text('Private'), confidential: text('Confidential') }[l], radio: true, checked: (latest.current.options?.sensitivity ?? 'normal') === l, onSelect: () => setPending({ options: { sensitivity: l === 'normal' ? undefined : l } }) })) },
    {
      id: 'vote',
      label: text('Voting buttons'),
      items: [
        ...([['none', text('None')], ['approve', text('Approve; Reject')], ['yesno', text('Yes; No')], ['yesnomaybe', text('Yes; No; Maybe')]] as const).map(([id, label]) => ({
          id: `vote-${id}`,
          label,
          radio: true,
          checked: id === 'none' ? !latest.current.options?.vote?.length : (latest.current.options?.vote ?? []).join('; ') === VOTE_PRESETS[id].join('; '),
          onSelect: () => setPending({ options: { vote: id === 'none' ? undefined : [...VOTE_PRESETS[id]] } }),
        })),
        { id: 'vote-custom', label: text('Your own choices…'), description: text('Counted in WorkSuite for recipients on this server; anyone else replies with a choice.'), onSelect: () => setVoteDialog(true) },
      ],
    },
    {
      id: 'receipts',
      label: text('Receipts'),
      items: [
        { id: 'read', label: text('Request a read receipt'), checked: !!latest.current.options?.read_receipt, description: text('Many mail apps ask the reader first, or never send one.'), onSelect: () => setPending({ options: { read_receipt: !latest.current.options?.read_receipt } }) },
        { id: 'delivery', label: text('Request a delivery receipt'), checked: !!latest.current.options?.delivery_receipt, onSelect: () => setPending({ options: { delivery_receipt: !latest.current.options?.delivery_receipt } }) },
      ],
    },
    {
      id: 'security',
      label: text('Security'),
      items: [
        { id: 'smime-sign', label: text('Sign (S/MIME)'), icon: 'shield-check', disabled: true, reason: text('Sending signed or encrypted mail is not available yet. Signed mail you receive is checked.') },
        { id: 'smime-encrypt', label: text('Encrypt (S/MIME)'), icon: 'lock', disabled: true, reason: text('Sending signed or encrypted mail is not available yet. Signed mail you receive is checked.') },
      ],
    },
  ];

  // The composer's own view choices, after the message options.
  const viewSection = (): MenuSection => ({
    id: 'view',
    label: text('View'),
    items: [
      { id: 'one-row', label: text('Actions and formatting in one row on wide screens'), checked: oneRow, onSelect: () => setOneRow(!oneRow) },
      ...(panel.hidden ? [{ id: 'show-panel', label: text('Show side panel'), icon: 'panel-right-open', onSelect: () => panel.setHidden(false) }] : []),
    ],
  });

  const quote = parseQuote(v.quote);
  const ownDomains = [...new Set(boxes.map((b) => domainOf(b.email)).filter(Boolean))];
  const replying = seed.mode === 'reply' || seed.mode === 'reply_all';
  const boxLabel = (b: Mailbox) => (b.display_name && b.display_name !== b.email ? `${b.display_name} <${b.email}>` : b.email);
  const boxKind = (b: Mailbox) => (b.account_type === 'local_mailbox' ? text('WorkSuite Local') : b.shared ? text('Shared') : (b.provider_label ?? ''));
  const pickLater = () => {
    setLater('pick');
    panel.reveal('later', sendWrap);
  };
  const sendSections: MenuSection[] = [
    {
      id: 'later',
      label: text('Send later'),
      items: [
        ...choices.map((c) => ({ id: c.id, label: c.label, description: c.when, icon: 'clock', disabled: offline, reason: text('Scheduling needs WorkSuite.'), onSelect: () => void sendLater(c.at) })),
        { id: 'pick', label: text('Pick a date and time'), icon: 'calendar', disabled: offline, reason: text('Scheduling needs WorkSuite.'), onSelect: pickLater },
      ],
    },
    ...(replying && seed.source ? [{ id: 'and', items: [{ id: 'send-archive', label: text('Send and archive'), icon: 'archive', onSelect: () => sendNow(false, { archive: true }) }] }] : []),
    ...(boxes.length > 1
      ? [
          {
            id: 'as',
            items: [
              {
                id: 'send-as',
                label: text('Send as…'),
                icon: 'user',
                submenu: [{ id: 'identities', items: boxes.map((b) => ({ id: `as-${b.id}`, label: b.display_name || b.email, description: b.email, radio: true, checked: String(b.id) === fromId, onSelect: () => (set({ from: String(b.id) }), sendNow()) })) }],
              },
            ],
          },
        ]
      : []),
  ];

  const actionProps: ComposeActionsProps = {
    offline,
    templates: templates.data?.templates ?? [],
    onTemplate: (t) => void applyTemplate(t),
    onSaveTemplate: () => setSaveTpl(true),
    quickParts: quickParts.data ?? [],
    quickPartsReason: quickPartsReason(quickParts.data, !!quickParts.isLoading, !!quickParts.error),
    onQuickPart: (q) => setPending({ part: q.html }),
    signatures: signatures.data?.signatures ?? [],
    currentSignature,
    onSignature: chooseSignature,
    onAttachComputer: () => fileInput.current?.click(),
    onAttachFiles: () => setDrive(true),
    onCloudLink: () => setCloud(true),
    mailMerge: seed.mode === 'new',
    onMailMerge: () => setMerging(payload()),
    suggestTimes: canOpen('calendar'),
    onSuggestTimes: () => setSuggesting(true),
    options: () => [...optionSections(), viewSection()],
    important: v.options?.importance === 'high',
    onBrowseTemplates: () => {
      // From the Template button when it shows, else the row (it is in More, or the actions are in the formatting row).
      templateAnchor.current = actionsRow.current?.querySelector<HTMLElement>('[data-ov="template"]:not([hidden])') ?? actionsRow.current ?? form.current;
      panel.reveal('templates', templateAnchor);
    },
  };

  /** Put the message aside: minimised to its tab when the page has one, else closed — the draft is saved either way. */
  const putAside = () => {
    void flushDrafts();
    if (onMinimise) onMinimise();
    else onClose();
  };
  const discard = async () => {
    setDiscarding(false);
    await draft.clear();
    onClose();
  };
  /** Opens the message in a window of its own (where the page offers it): the draft is written first, and the new window finds it by the same seed. */
  const popOut = () => {
    if (!onPopOut) return;
    void flushDrafts().then(() => {
      onPopOut(popOutRoute(seed), latest.current.subject || (seed.mode === 'new' ? text('New email') : text('Reply')));
      onClose();
    });
  };

  const panelContent = {
    templates: templates.data?.templates ?? [],
    templatesLoading: !!templates.isLoading,
    onTemplate: (t: Template) => void applyTemplate(t),
    choices,
    later,
    onLater: setLater,
    pick,
    onPick: setPick,
    onSchedule: () => void sendLater(laterAt),
    scheduling: busy,
    canSchedule: !!later && uploading.length === 0,
    offline,
  };

  const status = draftStatus({ saving: draft.saving, savedAt: draft.savedAt, restored: draft.restored, edited });

  return (
    <div
      ref={area}
      data-compose
      className="flex min-h-0 min-w-0 flex-1 overflow-hidden"
      onKeyDown={(e) => {
        const t = e.target as HTMLElement;
        // Keys inside a menu, a dialog or a list of suggestions are theirs.
        if (e.defaultPrevented || (typeof t.closest === 'function' && t.closest('[role="menu"], [role="dialog"], [role="listbox"]'))) return;
        const mod = e.ctrlKey || e.metaKey;
        if (mod && !e.shiftKey && !e.altKey && e.key === 'Enter') {
          e.preventDefault();
          sendNow();
        } else if (mod && e.shiftKey && !e.altKey && (e.key === 'D' || e.key === 'd')) {
          e.preventDefault();
          e.stopPropagation();
          setDiscarding(true);
        } else if (e.key === 'Escape' && !mod && !e.shiftKey && !e.altKey) {
          e.preventDefault();
          e.stopPropagation();
          putAside();
        }
      }}
    >
      <form
        ref={form}
        aria-label={seed.mode === 'new' ? text('New email') : seed.mode === 'forward' ? text('Forward') : text('Reply')}
        // Writing an email: the AI launcher stays out of the send options and status bar (#153); Write with AI is in the toolbar.
        data-hide-ai-launcher
        className="flex min-h-0 min-w-0 flex-1 flex-col bg-surface"
        onSubmit={(e) => {
          e.preventDefault();
          sendNow();
        }}
        // Leaving a field writes the draft now rather than after the pause (the save itself is useDraft's).
        onBlur={() => void flushDrafts()}
      >
        <div data-compose-header className="shrink-0">
          <Field label={text('From')}>
            {from ? <AccountAvatar letter={mailboxLetter(from)} colour={from.colour} size={22} /> : null}
            {boxes.length > 1 ? (
              <Select aria-label={text('From')} value={fromId} onValueChange={(x) => set({ from: String(x) })} options={boxes.map((b) => ({ value: String(b.id), label: boxLabel(b), hint: [accountTagList.tags.get(b.id)?.label, boxKind(b)].filter(Boolean).join(' · ') || undefined }))} className="h-8 max-w-[420px] min-w-0" />
            ) : from ? (
              <span className="min-w-0 truncate text-[13.5px] text-ink">
                {from.display_name && from.display_name !== from.email ? (
                  <>
                    <span className="font-semibold">{from.display_name}</span> <span className="text-ink-2">{`<${from.email}>`}</span>
                  </>
                ) : (
                  <span className="font-semibold">{from.email}</span>
                )}
              </span>
            ) : null}
            {/* The account's tag, as on the list's rows (#227). */}
            {fromTag && fromTag.show !== 'never' && accountTagList.mode !== 'off' ? <AccountTag tag={fromTag} mode={accountTagList.mode} /> : null}
          </Field>
          <Field label={text('To')}>
            <RecipientField label="To" value={v.to} onChange={(to) => set({ to })} names={v.names ?? {}} onName={named} placeholder={text('Add recipients')} autoFocus={!v.to} internal={ownDomains} />
            {!showCc ? (
              <button type="button" onClick={() => setShowCc('opened')} className="h-7 shrink-0 rounded-[6px] px-1.5 text-[13px] font-semibold text-primary hover:bg-subtle">
                Cc
              </button>
            ) : null}
            {!showBcc ? (
              <button type="button" onClick={() => setShowBcc('opened')} className="h-7 shrink-0 rounded-[6px] px-1.5 text-[13px] font-semibold text-primary hover:bg-subtle">
                Bcc
              </button>
            ) : null}
          </Field>
          {showCc ? (
            <Field label="Cc">
              <RecipientField label="Cc" value={v.cc} onChange={(cc) => set({ cc })} names={v.names ?? {}} onName={named} placeholder={text('Add recipients')} autoFocus={showCc === 'opened'} internal={ownDomains} />
            </Field>
          ) : null}
          {showBcc ? (
            <Field label="Bcc">
              <RecipientField label="Bcc" value={v.bcc} onChange={(bcc) => set({ bcc })} names={v.names ?? {}} onName={named} placeholder={text('Add recipients')} autoFocus={showBcc === 'opened'} internal={ownDomains} />
            </Field>
          ) : null}
          <Field label={text('Subject')}>
            <input aria-label="Subject" value={v.subject} placeholder={text('Add a subject')} onChange={(e) => set({ subject: e.target.value })} className="bare-focus h-9 min-w-0 flex-1 bg-transparent text-[14px] font-semibold text-ink outline-none placeholder:font-normal placeholder:text-ink-3" />
          </Field>
        </div>
        {merged ? null : (
          <div ref={actionsRow} className="shrink-0">
            <ComposeActions
              {...actionProps}
              end={
                panel.hidden && !panel.layout.narrow ? (
                  <button type="button" onClick={() => panel.setHidden(false)} aria-label={text('Show side panel')} title={text('Show side panel')} className="ml-1 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-[7px] text-ink-2 hover:bg-subtle hover:text-ink">
                    <Icon name="panel-right-open" size={16} />
                  </button>
                ) : null
              }
            />
          </div>
        )}
        {merging ? (
          <MailMerge
            message={{ subject: merging.subject, html: merging.body_html, text: merging.body_text }}
            onSendOne={async (row, m) => {
              await sendMessage({ ...merging, to: [row.email], cc: [], bcc: [], subject: m.subject, body_html: m.html, body_text: m.text, in_reply_to: undefined, reply_mode: undefined }, text('Send “{subject}” to {to}', { subject: m.subject, to: row.email }));
            }}
            onClose={() => setMerging(null)}
          />
        ) : null}
        {suggesting ? <SuggestTimes recipients={[...parseAddresses(v.to ?? ''), ...parseAddresses(v.cc ?? '')].map(addressOf).filter((a) => a.includes('@'))} subject={v.subject} onInsert={(html) => setPending({ part: html })} onClose={() => setSuggesting(false)} /> : null}
        {ai ? (
          <AiTextDialog
            title={ai.title}
            task={ai.task}
            input={() => (ai.task === 'reply' ? `Subject: ${v.subject}\n\nThe email I am replying to:\n${original}${own.trim() ? `\n\nWhat I want to say (my notes):\n${own.trim()}` : ''}` : own.trim())}
            actions={
              ai.task === 'coach'
                ? [{ label: text('Copy'), icon: 'copy', primary: true, run: (t) => void navigator.clipboard.writeText(t).then(() => toast('success', text('Copied.'))) }]
                : [{ label: own.trim() ? text('Replace my text') : text('Use this'), primary: true, run: (t) => set({ html: `${textToComposeHtml(t)}${signature}` }) }]
            }
            onClose={() => setAi(null)}
          />
        ) : null}
        <MailEditor
          value={v.html}
          onChange={(html) => set({ html })}
          clean={cleanComposeHtml}
          editorRef={editorEl}
          label={text('Message')}
          placeholder={text('Write your message…')}
          onFiles={(files) => void attach(files)}
          onAttachInstead={(file) => void attach([file])}
          aiSections={aiSections}
          mergeFields={seed.mode === 'new'}
          onMeetingLink={meetingLink}
          offline={offline}
          autoFocus={!!v.to}
          minHeight={160}
          fill
          leadingGroups={merged ? () => composeActionGroups(actionProps) : undefined}
          below={
            v.quote.trim() ? (
              <section aria-label={text('Quoted email')} className="mx-5 mb-4 shrink-0 rounded-[10px] border border-dashed border-line bg-surface">
                <div className="flex flex-wrap items-center gap-2 px-3 py-1.5">
                  <button type="button" aria-expanded={quoteOpen} onClick={() => setQuoteOpen(!quoteOpen)} className="flex min-w-0 flex-1 items-center gap-1.5 rounded-[6px] py-1 text-left text-[12.5px] font-semibold text-ink-2 hover:text-ink">
                    <Icon name={quoteOpen ? 'chevron-down' : 'chevron-right'} size={14} />
                    <span className="truncate">{quote.attribution || (seed.mode === 'forward' ? text('Forwarded email') : text('Quoted email'))}</span>
                  </button>
                  <span className="hidden shrink-0 text-[11.5px] text-ink-3 sm:inline">{text('AI works on what you wrote; the quoted email is left as it is.')}</span>
                  <button type="button" onClick={() => set({ quote: '' })} className="shrink-0 rounded-[6px] px-2 py-1 text-[12px] font-semibold text-ink-3 hover:bg-subtle hover:text-danger">
                    {text('Remove quoted email')}
                  </button>
                </div>
                {quoteOpen ? <blockquote className="selectable mx-3 mb-3 border-l-[3px] border-line pl-3 text-[13px] leading-[1.55] whitespace-pre-wrap text-ink-2">{quote.lines.join('\n')}</blockquote> : null}
              </section>
            ) : null
          }
        />
        <input ref={fileInput} type="file" multiple hidden aria-hidden onChange={(e) => void attach(e.target.files ? [...e.target.files] : []).then(() => (e.target.value = ''))} />
        {totalBytes > MESSAGE_WARN_BYTES ? (
          <p role="status" className={cx('mx-4 mt-2 shrink-0 rounded-[8px] px-3 py-2 text-[12.5px]', totalBytes > MESSAGE_MAX_BYTES ? 'bg-danger-bg text-danger' : 'bg-warning-bg text-warning')}>
            {text('This message is {size} with its pictures and attachments — most mail servers refuse messages over 25 MB. Send big files as a cloud link instead.', { size: bytes(totalBytes) })}
          </p>
        ) : null}
        {error ? <div className="shrink-0 px-4 pt-2"><ErrorNote error={error} /></div> : null}
        {(v.attachments?.length ?? 0) > 0 || uploading.length ? (
          <ul role="list" aria-label={text('Attachments')} className="flex max-h-[96px] shrink-0 flex-wrap gap-2 overflow-y-auto border-t border-line px-4 py-2 scroll-thin">
            {(v.attachments ?? []).map((a) => (
              <li key={a.token} data-attachment className="flex h-9 max-w-[280px] min-w-0 items-center gap-2 rounded-[8px] border border-line bg-surface pr-1 pl-2">
                <FileBadge name={a.name} size={22} />
                <span className="min-w-0 truncate text-[12.5px] font-semibold text-ink" title={a.name}>{a.name}</span>
                <span className="shrink-0 text-[11.5px] text-ink-3">{a.source === 'drive' ? text('{size} · from Files', { size: bytes(a.size) }) : bytes(a.size)}</span>
                <button type="button" onClick={() => set({ attachments: (latest.current.attachments ?? []).filter((x) => x.token !== a.token) })} aria-label={text('Remove {name}', { name: a.name })} className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-ink-3 hover:bg-subtle hover:text-danger">
                  <Icon name="x" size={13} />
                </button>
              </li>
            ))}
            {uploading.map((u) => (
              <li key={u.id} data-uploading className="relative flex h-9 max-w-[280px] min-w-0 items-center gap-2 overflow-hidden rounded-[8px] border border-dashed border-line pr-2 pl-2 text-[12.5px] text-ink-2">
                <FileBadge name={u.name} size={22} />
                <span className="min-w-0 truncate" title={u.name}>{u.name}</span>
                {u.size ? <span className="shrink-0 text-[11.5px] text-ink-3">{bytes(u.size)}</span> : null}
                <span className="sr-only">{text('Uploading {name}…', { name: u.name })}</span>
                <span role="progressbar" aria-label={text('Uploading {name}', { name: u.name })} className="absolute inset-x-0 bottom-0 h-[2px] overflow-hidden bg-subtle">
                  <span className="block h-full w-1/3 animate-pulse bg-primary" />
                </span>
              </li>
            ))}
          </ul>
        ) : null}
        <div data-compose-footer className="flex h-14 shrink-0 items-center gap-3 border-t border-line px-4">
          <div ref={sendWrap} role="group" aria-label={text('Send options')} data-testid="send-split" className="shrink-0">
            <PrimaryActionButton label={text('Send')} icon="send" shortcut={`${MOD}Enter`} hint={text('Send — you have {n} seconds to undo', { n: 8 })} onClick={() => sendNow()} menu={sendSections} menuLabel={text('Send options')} disabled={uploading.length > 0} />
          </div>
          <span role="status" aria-live="polite" data-draft-status className="min-w-0 flex-1 truncate text-[12px] text-ink-3">
            {status}
          </span>
          <button type="button" onClick={() => setDiscarding(true)} aria-label={text('Discard draft')} title={text('Discard draft ({keys})', { keys: `${MOD}${mac ? '⇧' : 'Shift+'}D` })} aria-keyshortcuts={mac ? 'Meta+Shift+D' : 'Control+Shift+D'} className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-[8px] px-2.5 text-[13px] font-semibold text-ink-2 hover:bg-subtle hover:text-danger">
            <Icon name="trash" size={15} />
            <span>{text('Discard')}</span>
          </button>
          {onPopOut ? (
            <button type="button" onClick={popOut} aria-label={text('Pop out')} title={text('Open in a new window')} className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-[8px] text-ink-2 hover:bg-subtle hover:text-ink">
              <Icon name="external" size={15} />
            </button>
          ) : null}
        </div>
      </form>
      {panel.layout.docked ? <ComposeSidePanel state={panel} {...panelContent} /> : null}
      <PanelPopover state={panel} {...panelContent} />
      {drive ? <DriveFilePicker title={text('Attach from Files')} confirmLabel={text('Attach')} onChoose={(files) => void attachFromDrive(files)} onClose={() => setDrive(false)} /> : null}
      {cloud ? <DriveFilePicker title={text('Share a link to a file')} confirmLabel={text('Insert link')} onChoose={(files) => void cloudLink(files)} onClose={() => setCloud(false)} /> : null}
      {saveTpl ? <SaveTemplate subject={v.subject} html={mine} onClose={() => setSaveTpl(false)} onSaved={() => void templates.refetch?.()} /> : null}
      <MentionPopup editor={editorEl} onMention={mentioned} />
      {voteDialog ? <CustomVote initial={v.options?.vote ?? []} onSave={(choices) => (setPending({ options: { vote: choices.length ? choices : undefined } }), setVoteDialog(false))} onClose={() => setVoteDialog(false)} /> : null}
      {discarding ? (
        <Modal
          title={text('Discard this draft?')}
          labelledBy="mail-discard"
          width={400}
          onClose={() => setDiscarding(false)}
          footer={
            <>
              <Button onClick={() => setDiscarding(false)}>{text('Keep writing')}</Button>
              <Button variant="danger" onClick={() => void discard()}>
                {text('Discard')}
              </Button>
            </>
          }
        >
          <p className="p-5 text-[13.5px] text-ink">{text('The message and its attachments are removed from this computer. This cannot be undone.')}</p>
        </Modal>
      ) : null}
      {checks ? (
        <Modal
          title={checks.issues.includes('attachment') ? text('Did you mean to attach a file?') : text('Send without a subject?')}
          labelledBy="mail-send-check"
          width={420}
          onClose={() => setChecks(null)}
          footer={
            <>
              <Button onClick={() => setChecks(null)}>{checks.issues.includes('attachment') ? text('Attach a file') : text('Add a subject')}</Button>
              <Button variant="primary" onClick={() => (setChecks(null), sendNow(true, checks.opts))}>
                {text('Send anyway')}
              </Button>
            </>
          }
        >
          <ul className="flex list-disc flex-col gap-1 p-5 pl-9 text-[13.5px] text-ink">
            {checks.issues.includes('attachment') ? <li>{text('Your message mentions an attachment, but nothing is attached.')}</li> : null}
            {checks.issues.includes('subject') ? <li>{text('There is no subject.')}</li> : null}
          </ul>
        </Modal>
      ) : null}
    </div>
  );
}

/** One header row (worksuite-desktop#213): a 64 px label column, the field, a 1 px divider that turns to the accent line while the field has focus. */
function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div data-field-row className="flex min-h-[44px] items-center border-b border-line px-4 transition-shadow focus-within:border-primary focus-within:shadow-[inset_0_-1px_0_var(--color-primary)]">
      <span className="w-16 shrink-0 text-[13px] text-ink-3">{label}</span>
      <span className="flex min-w-0 flex-1 items-center gap-2">{children}</span>
    </div>
  );
}

/** The voting buttons offered in the options menu (DMO-CMP-12). */
const VOTE_PRESETS = { approve: ['Approve', 'Reject'], yesno: ['Yes', 'No'], yesnomaybe: ['Yes', 'No', 'Maybe'] } as const satisfies Record<string, readonly string[]>;

/** Voting buttons in the sender's own words: two to six choices. */
function CustomVote({ initial, onSave, onClose }: { initial: string[]; onSave: (choices: string[]) => void; onClose: () => void }) {
  const [value, setValue] = useState(initial.join('; '));
  const choices = voteChoices(value.split(/[;\n]/));
  return (
    <Modal
      title={text('Your own voting buttons')}
      labelledBy="mail-vote-title"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={() => onSave(choices)} disabled={value.trim() !== '' && choices.length < 2}>
            Use these
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-2 p-4 text-[13px]">
        <TextField label={text('Choices, separated by ;')} value={value} onChange={(e) => setValue(e.target.value)} placeholder={text('Monday; Tuesday; Wednesday')} autoFocus />
        <p className="text-[12px] text-ink-3">{text('Two to six choices. Recipients on this WorkSuite server vote with a button; anyone else replies with their choice.')}</p>
      </div>
    </Modal>
  );
}

/** The message as a template of one's own (the server cleans it again). */
function SaveTemplate({ subject, html, onClose, onSaved }: { subject: string; html: string; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(subject);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await apiPost('/api/mail/templates', { name: name.trim(), subject, body_html: cleanComposeHtml(html) });
      toast('success', text('Template saved.'));
      onSaved();
      onClose();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title={text('Save as template')}
      labelledBy="mail-save-template"
      width={420}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{text('Cancel')}</Button>
          <Button variant="primary" loading={busy} disabled={!name.trim()} onClick={() => void save()}>
            {text('Save template')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-2 p-4">
        <TextField label={text('Template name')} value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        <p className="text-[12px] text-ink-3">{text('The subject and what you wrote are saved; the signature and the quoted email are not.')}</p>
        {error ? <ErrorNote error={error} /> : null}
      </div>
    </Modal>
  );
}
