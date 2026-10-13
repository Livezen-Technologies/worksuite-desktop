import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState, type DragEvent } from 'react';
import {
  REWRITE_LABEL,
  REWRITE_MODES,
  statusLabel,
  fromLegacyMessage,
  type MessageInput,
  type Message,
  type TicketShow,
  type Caps,
  type IdName,
  type MessageAnswer,
  type RewriteMode,
  type ServerDraft,
  type SupportStatus,
  type Ticket,
} from '@shared/support';
import { isMac } from '../../core/bridge';
import { useDraft } from '../../core/drafts';
import { text } from '../../core/i18n';
import { bytes, timeLabel } from '../../core/time';
import { toast } from '../../core/toasts';
import { Checkbox } from '../../components/Checkbox';
import { Icon } from '../../components/Icon';
import { Select } from '../../components/Select';
import { Avatar, Button, FileBadge, IconButton, Modal, cx } from '../../components/ui';
import { K, MAX_FILES, MAX_FILE_BYTES, addMessage, agents, aiRewrite, assistError, canned, errorText, newClientId, removeAttachment, renderCanned, saveServerDraft, serverDraft, uploadAttachment } from './api';
import { MailEditor } from '../mail/editor/MailEditor';
import { codeBlockHtml, inlineCodeHtml } from '../mail/editor/insert';
import { cleanReplyHtml, linkReplyUrls, placeRichCaret, replacePickerToken, replyHtml, replyText, richCaret } from './richReply';
import { AiBadge } from './parts';
import { mentionQuery, mentionedIds, parseCc, pastedName, slashQuery, spliceText } from './compose';

/**
 * The composer (FR-COM-01, D-01's inline reply and D-02's): a reply to the requester or an internal note, as two
 * explicit buttons, a note unless the agent chooses otherwise (§19.2 — what costs nothing when it goes wrong is the
 * default). ⌘↵ (Ctrl+Enter) sends.
 *
 *  - "/" at the start of a line offers the canned responses (FR-COM-05), filled in for this ticket by the server
 *    (`POST canned/{id}/render`) before they are put in.
 *  - "@" in a note offers the people who can work the ticket; whoever is still named when it is sent is mentioned
 *    (FR-COM-08), and the server tells them.
 *  - Files (FR-DSK-06, FR-COM-04): dropped on the composer, pasted (a screenshot becomes a named PNG with its
 *    picture) or chosen. Each goes up at once — the server checks its type and size and scans it (FR-SEC-06) — and
 *    waits there for the message that carries it; × takes it back. At most ten, 25 MB each.
 *  - A reply may copy others (CC), and a message may move the status once it is in ("Then: Pending customer"); a
 *    move the state machine refuses is reported beside the sent message (`status_refused`).
 *
 * What is typed — with its files, CC, status and mentions — is kept on this computer per ticket (`useDraft`,
 * encrypted, within a second), so a reply started in the inbox's reading pane carries on in the ticket's tab and
 * survives a restart (FR-CRT-10). The server keeps a copy too (`PUT tickets/{id}/draft`, a couple of seconds after
 * the typing stops), so a reply started on another device is offered here when this computer has none. A message goes
 * with a `client_id` kept until it is in: Send pressed again after a failure is the same message, never two. An
 * as-built server takes neither files, CC nor mentions: they are not offered there.
 *
 * The writing assistant (D-10, `POST ai/rewrite`) improves, shortens, changes the tone of or translates what is
 * typed; the result is shown with the violet AI badge and replaces the text only when the agent says so. The KB & AI
 * panel puts articles and suggested replies in through `insertRequest`. Nothing the assistant writes is sent without
 * the agent pressing Send.
 */
export type ComposerMode = 'reply' | 'note';

/** A file uploaded for the message and not sent yet: the server keeps it waiting, so the draft keeps its id. */
export interface DraftFile {
  id: number;
  name: string;
  size: number;
  mime: string | null;
}

export interface SupportDraft {
  body: string;
  html?: string;
  otherDrafts?: Partial<Record<ComposerMode, Omit<SupportDraft, 'mode' | 'otherDrafts'>>>;
  mode: ComposerMode;
  /** The status the ticket moves to once the message is in; null keeps it. */
  status?: SupportStatus | null;
  cc?: string[];
  files?: DraftFile[];
  /** The people picked with "@": mentioned if their name is still in the text when it is sent. */
  mentions?: Array<{ id: number; name: string }>;
}

export const EMPTY_DRAFT: SupportDraft = { body: '', mode: 'note' };

/** How long after the typing stops the draft is copied to the server. */
export const SERVER_DRAFT_MS = 2_000;

/**
 * Something to put into the composer from outside it (the KB & AI panel, D-10): a KB link or text at the caret, or a
 * suggested reply in place of what is there. A new `n` asks again.
 */
export interface InsertRequest {
  text: string;
  how: 'insert' | 'replace';
  /** Switch to writing this kind (a suggested reply is a reply). */
  mode?: ComposerMode;
  n: number;
}

/** `text` put into `body` at `at`, on a line of its own when it would run into what is there; where the caret goes. */
export function insertAt(body: string, at: number, text: string): { text: string; caret: number } {
  const pos = Math.max(0, Math.min(at, body.length));
  const before = pos > 0 && !/\s$/.test(body.slice(0, pos)) ? (text.includes('\n') ? '\n\n' : ' ') : '';
  const after = pos < body.length && !/^\s/.test(body.slice(pos)) ? ' ' : '';
  return spliceText(body, pos, pos, before + text + after);
}

/** Whether the person may write each kind here: a note needs notes and reply (§5.2), a reply needs reply. */
export function composerModes(can: Caps): { reply: boolean; note: boolean } {
  return {
    reply: can.reply === true,
    note: can.reply === true && can.notes === true,
  };
}

/** A file on its way up: kept here (not in the draft) until the server has it. */
interface Upload {
  key: string;
  file: File;
  name: string;
  preview: string | null;
  progress?: number;
  mode: ComposerMode;
  error: string | null;
}

let uploadSeq = 0;

function TicketComposer({
  ticket,
  can,
  compact = false,
  transitions = [],
  legacy = false,
  hidden = false,
  focusRequest,
  insertRequest,
  onSent,
  onTyping,
  className,
}: {
  ticket: Pick<Ticket, 'id' | 'reference' | 'requester' | 'version' | 'status'> & { organization?: IdName | null };
  can: Caps;
  /** The reading pane's denser form. */
  compact?: boolean;
  /** The moves the ticket allows (`transitions`): what "Then:" offers. */
  transitions?: SupportStatus[];
  /** An as-built server: no files, CC or mentions. */
  legacy?: boolean;
  /** Out of sight while the tab shows another view, and kept: the draft and the files going up stay. */
  hidden?: boolean;
  /** The R and N keys: focus the composer in that mode. A new `n` asks again. `canned`: with the "/" picker open (⌘K). */
  focusRequest?: { mode: ComposerMode; n: number; canned?: boolean } | null;
  /** Text from the KB & AI panel (D-10). */
  insertRequest?: InsertRequest | null;
  onSent?: (answer: MessageAnswer) => void;
  /** Typing started or stopped, and in which mode: the collision bar's "typing a note…" (FR-COM-11). */
  onTyping?: (mode: ComposerMode | null) => void;
  className?: string;
}) {
  const qc = useQueryClient();
  const draft = useDraft<SupportDraft>('support', `ticket:${ticket.id}`, EMPTY_DRAFT);
  const modes = composerModes(can);
  const d = draft.value;
  const mode: ComposerMode = d.mode === 'reply' && modes.reply ? 'reply' : modes.note ? 'note' : 'reply';
  const extras = !legacy;
  const [expanded, setExpanded] = useState(false);
  const [shortcuts, setShortcuts] = useState(false);
  const warningAsNote = useRef(false);
  const [attachmentWarning, setAttachmentWarning] = useState(false);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [scheduleAt, setScheduleAt] = useState('');
  const scheduleRequested = useRef<string | undefined>(undefined);
  const [failed, setFailed] = useState(false);
  const sendGate = useRef(false);
  const retrySend = useRef<(input: MessageInput) => void>(() => undefined);
  useEffect(() => {
    const retry = (event: Event) => {
      const detail = (event as CustomEvent<{ ticketId: number; input: MessageInput }>).detail;
      if (detail?.ticketId === ticket.id) retrySend.current(detail.input);
    };
    window.addEventListener('support:retry-message', retry);
    return () => window.removeEventListener('support:retry-message', retry);
  }, [ticket.id]);
  const insertHtml = useRef<((html: string) => void) | null>(null);
  const [editorBusy, setEditorBusy] = useState(false);
  const [sending, setSending] = useState(false);
  const [caret, setCaret] = useState(0);
  const [pick, setPick] = useState(0);
  const [dismissed, setDismissed] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const cancelledUploads = useRef(new Set<string>());
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [previews, setPreviews] = useState<Record<number, string>>({});
  const [ccOpen, setCcOpen] = useState(false);
  const [ccText, setCcText] = useState('');
  // "Track this email" (#335): on follows the desk's setting; off is said for this one reply.
  const [track, setTrack] = useState(true);
  const box = useRef<HTMLDivElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const clientId = useRef<string | null>(null);
  const typingSaid = useRef<ComposerMode | null>(null);
  // The draft as last set, read by what finishes later (an upload, a canned response): two at once both count.
  const latest = useRef(d);
  useEffect(() => {
    latest.current = draft.value;
  });
  const update = (patch: Partial<SupportDraft>) => {
    const next = { ...latest.current, ...patch };
    latest.current = next;
    draft.setValue(next);
  };

  const switchMode = (nextMode: ComposerMode) => {
    if (editorBusy) return;
    const now = latest.current;
    if (nextMode === now.mode) return;
    const { mode: oldMode, otherDrafts = {}, ...content } = now;
    const saved = otherDrafts[nextMode];
    const remaining = { ...otherDrafts };
    delete remaining[nextMode];
    update({
      body: '',
      html: '',
      files: [],
      cc: [],
      mentions: [],
      status: null,
      ...saved,
      mode: nextMode,
      otherDrafts: { ...remaining, [oldMode]: content },
    });
    scheduleRequested.current = undefined;
    setCcText('');
    clientId.current = null;
    setRewrite(null);
    setFailed(false);
  };
  const files = extras ? (d.files ?? []) : [];
  const ccSaved = extras ? (d.cc ?? []) : [];
  const typed = d.body.trim() !== '';
  const slash = slashQuery(d.body, caret);
  const mention = mode === 'note' && extras ? mentionQuery(d.body, caret) : null;
  const picking = slash && dismissed !== `/${slash.start}` ? 'canned' : mention && dismissed !== `@${mention.start}` ? 'mention' : null;
  const cannedQ = useQuery({
    queryKey: K.canned(slash?.word ?? ''),
    queryFn: () => canned(slash?.word ?? ''),
    enabled: picking === 'canned',
    staleTime: 60_000,
  });
  const people = useQuery({
    queryKey: K.agents(`ticket:${ticket.id}`),
    queryFn: () => agents({ ticket_id: ticket.id }),
    enabled: picking === 'mention',
    staleTime: 60_000,
  });
  const choices =
    picking === 'canned'
      ? (cannedQ.data ?? []).slice(0, 8).map((c) => ({
          key: `c${c.id}`,
          label: c.title,
          hint: c.shortcut ? `/${c.shortcut}` : c.body.slice(0, 80),
          canned: c,
          person: null,
        }))
      : picking === 'mention' && mention
        ? (people.data ?? [])
            .filter((p) => !mention.word || p.name.toLowerCase().includes(mention.word.toLowerCase()))
            .slice(0, 8)
            .map((p) => ({
              key: `p${p.id}`,
              label: p.name,
              hint: p.presence === 'available' ? text('Online') : text(p.presence.charAt(0).toUpperCase() + p.presence.slice(1)),
              canned: null,
              person: p,
            }))
        : [];
  const highlighted = Math.min(pick, Math.max(0, choices.length - 1));
  const pickerId = `support-pick-${ticket.id}`;

  // R / N: focus here, in that mode — and the palette's "Insert canned response…", with "/" typed.
  const startCanned = useRef<() => void>(() => undefined);
  useEffect(() => {
    if (!focusRequest) return;
    switchMode(focusRequest.mode);
    box.current?.focus();
    if (focusRequest.canned) setTimeout(() => startCanned.current(), 0);
    // Only a new request moves the focus: the draft changing must not.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusRequest?.n]);

  /** Focus back in the text, the caret after what was put in (once React has drawn the new text). */
  const placeCaret = (at: number) =>
    setTimeout(() => {
      const el = box.current;
      if (!el) return;
      placeRichCaret(el, at);
    }, 0);

  // The KB & AI panel's text: at the caret, or in place of what is there; the focus comes here to review it.
  useEffect(() => {
    if (!insertRequest) return;
    const want = insertRequest.mode && (insertRequest.mode === 'reply' ? modes.reply : modes.note) ? insertRequest.mode : undefined;
    if (want) switchMode(want);
    const now = latest.current.body;
    const r = insertRequest.how === 'replace' || !now.trim() ? { text: insertRequest.text, caret: insertRequest.text.length } : insertAt(now, richCaret(box.current), insertRequest.text);
    clientId.current = null;
    update({ body: r.text, html: replyHtml(r.text) });
    setCaret(r.caret);
    placeCaret(r.caret);
    // Only a new request puts text in.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [insertRequest?.n]);

  // My draft on the server (FR-CRT-10): offered when this computer has none, and kept in step after typing stops.
  // `synced` is what the server holds; null until it has answered (nothing is written over what it has unseen).
  const synced = useRef<string | null>(null);
  const [offered, setOffered] = useState<ServerDraft | null>(null);
  useEffect(() => {
    synced.current = null;
    setOffered(null);
    if (legacy) return;
    let alive = true;
    const ac = new AbortController();
    serverDraft(ticket.id, ac.signal).then(
      (sd) => {
        if (!alive) return;
        synced.current = sd?.body ?? '';
        if (sd?.body.trim()) setOffered(sd);
      },
      () => undefined,
    );
    return () => {
      alive = false;
      ac.abort();
    };
  }, [ticket.id, legacy]);
  // Taken once this computer's own draft has been looked for: a draft kept here wins.
  useEffect(() => {
    if (!offered || !draft.loaded) return;
    setOffered(null);
    const here = latest.current;
    if (here.body.trim() || here.files?.length) return;
    update({
      body: offered.body,
      html: offered.body_html ?? undefined,
      mode: offered.mode === 'reply' ? 'reply' : 'note',
      ...(offered.cc?.length ? { cc: offered.cc } : {}),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [offered, draft.loaded]);
  useEffect(() => {
    if (legacy || synced.current === null || `${d.body}\0${d.html ?? ''}` === synced.current) return;
    const body = d.body;
    const timer = setTimeout(() => {
      synced.current = `${body}\0${latest.current.html ?? ''}`;
      void saveServerDraft(ticket.id, {
        mode,
        body,
        body_html: latest.current.html,
        cc: mode === 'reply' ? latest.current.cc : undefined,
      }).catch(() => {
        // Kept on this computer either way; the next change tries again.
        synced.current = null;
      });
    }, SERVER_DRAFT_MS);
    return () => clearTimeout(timer);
  }, [d.body, d.html, mode, legacy, ticket.id]);

  // The writing assistant's suggestion, shown above the text until it replaces it or is set aside.
  const [rewrite, setRewrite] = useState<{
    mode: RewriteMode;
    phase: 'working' | 'done' | 'error';
    text: string;
  } | null>(null);
  const runRewrite = (m: RewriteMode) => {
    const body = latest.current.body.trim();
    if (!body) return;
    setRewrite({ mode: m, phase: 'working', text: '' });
    aiRewrite(body, m, ticket.organization?.id ?? null).then(
      (r) => setRewrite((x) => (x?.mode === m ? { mode: m, phase: 'done', text: r.text } : x)),
      (e: unknown) => setRewrite((x) => (x?.mode === m ? { mode: m, phase: 'error', text: assistError(e) } : x)),
    );
  };

  // Typing started, stopped, or changed kind: told once each time, not on every key.
  useEffect(() => {
    const now = typed ? mode : null;
    if (typingSaid.current === now) return;
    typingSaid.current = now;
    onTyping?.(now);
  }, [typed, mode, onTyping]);

  // The pictures of files not sent go with the composer.
  const pictures = useRef(new Set<string>());
  useEffect(() => {
    const all = pictures.current;
    return () => all.forEach((p) => URL.revokeObjectURL(p));
  }, []);
  const forget = (p: string | null | undefined) => {
    if (!p) return;
    URL.revokeObjectURL(p);
    pictures.current.delete(p);
  };

  if (!modes.reply && !modes.note) {
    return (
      <p hidden={hidden} className={cx('border-t border-line bg-surface px-4 py-3 text-[12.5px] text-ink-3', className)}>
        {text('You can read this ticket but not reply to it.')}
      </p>
    );
  }

  const setBody = (body: string, at?: number) => {
    clientId.current = null;
    update({ body, html: replyHtml(body) });
    if (at !== undefined) setCaret(at);
  };

  const choose = async (i: number) => {
    const c = choices[i];
    const q = picking === 'canned' ? slash : mention;
    if (!c || !q) return;
    // What is replaced: the "/word" or "@word" as it was when it was chosen — wherever it now is not, the end.
    const token = `${picking === 'canned' ? '/' : '@'}${q.word}`;
    let insert = '';
    if (c.canned) {
      insert = c.canned.body;
      try {
        insert = await renderCanned(c.canned.id, ticket.id);
      } catch {
        // Put in as written: the placeholders show, and the agent sees what to fill in.
      }
    } else if (c.person) {
      insert = `@${c.person.name} `;
      update({
        mentions: [...(latest.current.mentions ?? []).filter((m) => m.id !== c.person!.id), { id: c.person.id, name: c.person.name }],
      });
    }
    const now = latest.current.body;
    const there = now.slice(q.start, q.start + token.length) === token;
    const r = there ? spliceText(now, q.start, q.start + token.length, insert) : spliceText(now, now.length, now.length, insert);
    const html = replacePickerToken(replyHtml(now, latest.current.html), token, insert);
    update({ body: replyText(html), html });
    setCaret(r.caret);
    placeCaret(r.caret);
    setPick(0);
  };

  const upload = async (key: string, f: File, name: string, preview: string | null, uploadMode: ComposerMode) => {
    try {
      const a = await uploadAttachment(ticket.id, f, name, (fraction) => setUploads((list) => list.map((item) => (item.key === key ? { ...item, progress: fraction } : item))));
      setUploads((u) => u.filter((x) => x.key !== key));
      if (cancelledUploads.current.has(key)) {
        void removeAttachment(a.id).catch(() => undefined);
        return;
      }
      if (preview) setPreviews((p) => ({ ...p, [a.id]: preview }));
      const file = { id: a.id, name: a.name, size: a.size, mime: a.mime };
      if (latest.current.mode === uploadMode) update({ files: [...(latest.current.files ?? []), file] });
      else {
        const saved = latest.current.otherDrafts?.[uploadMode] ?? { body: '' };
        update({
          otherDrafts: {
            ...latest.current.otherDrafts,
            [uploadMode]: { ...saved, files: [...(saved.files ?? []), file] },
          },
        });
      }
    } catch (e) {
      setUploads((u) => u.map((x) => (x.key === key ? { ...x, error: errorText(e, text('It could not be attached.')) } : x)));
    }
  };
  const addFiles = (list: File[], pasted = false) => {
    if (!extras || !list.length) return;
    let room = MAX_FILES - files.length - uploads.length;
    for (const f of list) {
      const name = pasted ? pastedName(f, new Date()) : f.name || text('file');
      if (room <= 0) {
        toast('warning', text('At most {n} files a message.', { n: MAX_FILES }));
        break;
      }
      if (f.size > MAX_FILE_BYTES) {
        toast('error', text('{name} is larger than 25 MB.', { name }));
        continue;
      }
      room -= 1;
      const key = `u${++uploadSeq}`;
      const preview = f.type.startsWith('image/') && typeof URL.createObjectURL === 'function' ? URL.createObjectURL(f) : null;
      if (preview) pictures.current.add(preview);
      setUploads((u) => [...u, { key, file: f, name, preview, error: null, mode }]);
      void upload(key, f, name, preview, mode);
    }
  };
  const retry = (u: Upload) => {
    setUploads((list) => list.map((x) => (x.key === u.key ? { ...x, error: null } : x)));
    void upload(u.key, u.file, u.name, u.preview, u.mode);
  };
  const dropUpload = (u: Upload) => {
    cancelledUploads.current.add(u.key);
    forget(u.preview);
    setUploads((list) => list.filter((x) => x.key !== u.key));
  };
  const dropFile = (f: DraftFile) => {
    update({
      files: (latest.current.files ?? []).filter((x) => x.id !== f.id),
    });
    forget(previews[f.id]);
    // Taken back at the server too. One never sent is its uploader's alone either way.
    void removeAttachment(f.id).catch(() => undefined);
  };

  /** "/" where the caret is, at the start of a line: the canned responses' picker opens. */
  startCanned.current = () => {
    const el = box.current;
    const body = latest.current.body;
    const at = richCaret(el);
    const prefix = at === 0 || body[at - 1] === '\n' ? '/' : '\n/';
    const r = spliceText(body, at, at, prefix);
    setBody(r.text, r.caret);
    setDismissed(null);
    placeCaret(r.caret);
  };

  const ccTyped = parseCc(ccText);
  const cc = [...ccSaved, ...ccTyped.emails.filter((e) => !ccSaved.some((x) => x.toLowerCase() === e.toLowerCase()))];
  const keepCc = () => {
    if (ccTyped.emails.length) update({ cc });
    setCcText(ccTyped.bad.join(' '));
  };
  const moves = transitions.filter((s) => s !== ticket.status);
  // A move chosen earlier that the ticket no longer allows (somebody changed its status) is not made.
  const then = d.status && moves.includes(d.status) ? d.status : null;
  const uploading = uploads.some((u) => !u.error);
  const canSend = typed && !uploading && !editorBusy && !sending && (mode === 'note' || ccTyped.bad.length === 0);

  const send = async (confirmed = false, asNote = false, at?: string, retryInput?: MessageInput) => {
    const body = retryInput?.body ?? latest.current.body.trim();
    if ((!retryInput && !canSend) || !body || sendGate.current) return;
    if (legacy && /<img\b/i.test(latest.current.html ?? '')) {
      toast('error', text('Inline images need a newer Helpdesk server.'));
      return;
    }
    if (at) scheduleRequested.current = at;
    if (!retryInput && !confirmed && /\battach(?:ed|ment|ments)?\b/i.test(body) && !files.length && !/<img\b/i.test(latest.current.html ?? '')) {
      warningAsNote.current = asNote;
      setAttachmentWarning(true);
      return;
    }
    sendGate.current = true;
    const sentDraft = latest.current;
    setSending(true);
    setFailed(false);
    clientId.current ??= newClientId();
    const internal = retryInput?.internal ?? (asNote || mode === 'note');
    const mentions = internal && extras ? mentionedIds(body, latest.current.mentions ?? []) : [];
    const input: MessageInput = retryInput ?? {
      body,
      ...(!legacy && latest.current.html ? { body_html: cleanReplyHtml(latest.current.html) } : {}),
      internal,
      client_id: clientId.current,
      ...(scheduleRequested.current && !internal ? { send_at: scheduleRequested.current } : {}),
      ...(files.length ? { attachments: files.map((f) => f.id) } : {}),
      ...(!internal && cc.length ? { cc } : {}),
      ...(mentions.length ? { mentions } : {}),
      ...(then ? { status: then } : {}),
      ...(!internal && !legacy && !track ? { track: false } : {}),
    };
    const paint = (message: Message) =>
      qc.setQueryData<TicketShow>(K.ticket(ticket.id), (show) =>
        show
          ? {
              ...show,
              messages: [...show.messages.filter((m) => m.client_id !== input.client_id), message],
            }
          : show,
      );
    const optimistic: Message = {
      ...fromLegacyMessage({
        id: -Date.now(),
        body,
        is_internal: internal,
        from: 'staff',
        author_id: null,
      }),
      body_html: input.body_html ?? null,
      client_id: input.client_id ?? null,
      created_at: new Date().toISOString(),
      local_status: 'sending',
      local_ticket_id: ticket.id,
      retry_input: input,
    };
    paint(optimistic);
    try {
      const r = await addMessage(ticket.id, input);
      paint({
        ...r.message,
        body_html: r.message.body_html ?? input.body_html ?? null,
        client_id: input.client_id ?? null,
      });
      clientId.current = null;
      scheduleRequested.current = undefined;
      setTrack(true);

      // Emptied, then cleared: nothing of it is kept on this computer.
      if (latest.current === sentDraft && (!retryInput || (retryInput.body === sentDraft.body && (retryInput.body_html ?? '') === (sentDraft.html ?? '')))) {
        latest.current = {
          body: '',
          html: '',
          mode,
          otherDrafts: sentDraft.otherDrafts,
        };
        Object.values(previews).forEach(forget);
        setPreviews({});
        setCcText('');
        setCcOpen(false);
      }
      // Sending clears the server's copy too.
      if (synced.current !== null) synced.current = '';
      setRewrite(null);
      draft.setValue(latest.current);
      if (!latest.current.body && !Object.values(latest.current.otherDrafts ?? {}).some((saved) => saved?.body || saved?.files?.length)) await draft.clear();
      // Queued offline: the outbox has said so (api.ts), and sends it when WorkSuite is back.
      if (r.queued) void qc.invalidateQueries({ queryKey: ['offline', 'pending'] });
      else if (r.status_refused)
        toast(
          'warning',
          text('Sent, but the status did not change: {why}', {
            why: r.status_refused.message,
          }),
        );
      else toast('success', internal ? text('Note added to {ref}.', { ref: ticket.reference }) : text('Reply sent on {ref}.', { ref: ticket.reference }));
      void qc.invalidateQueries({ queryKey: K.ticket(ticket.id) });
      void qc.invalidateQueries({ queryKey: K.lists });
      void qc.invalidateQueries({ queryKey: ['support', 'views'] });
      onSent?.(r);
    } catch (e) {
      paint({ ...optimistic, local_status: 'failed' });
      setFailed(true);
      toast('error', errorText(e, text('The message was not sent. It is still here; try again.')));
    } finally {
      sendGate.current = false;
      setSending(false);
    }
  };

  retrySend.current = (input) => {
    void send(true, input.internal, undefined, input);
  };

  const onDrag = (e: DragEvent) => {
    if (!extras || !e.dataTransfer.types.includes('Files')) return;
    e.preventDefault();
    if (!dragging) setDragging(true);
  };
  const to = ticket.requester.name || ticket.requester.email || text('the requester');
  const sendKeys = isMac ? '⌘↵' : 'Ctrl+Enter';
  const total = files.reduce((n, f) => n + f.size, 0) + uploads.reduce((n, u) => n + u.file.size, 0);

  return (
    <div
      data-support-composer
      data-hide-ai-launcher
      role={expanded ? 'dialog' : undefined}
      aria-label={expanded ? text('Expanded ticket reply') : undefined}
      hidden={hidden}
      onDragEnter={onDrag}
      onDragOver={onDrag}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false);
      }}
      onDrop={(e) => {
        if (!extras || !e.dataTransfer.types.includes('Files')) return;
        setDragging(false);
        if ((e.target as Element).closest('[contenteditable]')) return;
        e.preventDefault();
        setDragging(false);
        addFiles(Array.from(e.dataTransfer.files));
      }}
      className={cx('flex shrink-0 flex-col border-t border-line bg-surface', expanded ? 'fixed inset-4 z-40 overflow-y-auto rounded-xl border shadow-xl' : 'relative', compact ? 'gap-1.5 px-3 py-2' : 'gap-2 px-4 py-3', className)}
    >
      {dragging ? (
        <div role="status" className="pointer-events-none absolute inset-1 z-20 flex flex-col items-center justify-center gap-1 rounded-[10px] border-2 border-dashed border-primary bg-selection/90 text-[13px] font-semibold text-primary">
          <Icon name="upload" size={22} />
          {text('Drop files to attach to {ref}', { ref: ticket.reference })}
        </div>
      ) : null}
      <div className="flex min-w-0 items-center gap-2">
        <div role="radiogroup" aria-label={text('Write a')} className="inline-flex shrink-0 rounded-[8px] bg-subtle p-0.5">
          {modes.reply ? (
            <button
              type="button"
              role="radio"
              aria-checked={mode === 'reply'}
              onClick={() => switchMode('reply')}
              className={cx('h-6 rounded-[6px] px-2.5 text-[12px] font-semibold', mode === 'reply' ? 'bg-surface text-ink shadow-sm' : 'text-ink-3 hover:text-ink')}
            >
              {text('Reply to requester')}
            </button>
          ) : null}
          {modes.note ? (
            <button
              type="button"
              role="radio"
              aria-checked={mode === 'note'}
              onClick={() => switchMode('note')}
              className={cx('h-6 rounded-[6px] px-2.5 text-[12px] font-semibold', mode === 'note' ? 'bg-warning-bg text-warning-ink shadow-sm' : 'text-ink-3 hover:text-ink')}
            >
              {text('Internal note')}
            </button>
          ) : null}
        </div>
        <span className="min-w-0 truncate text-[11.5px] text-ink-3">
          {mode === 'reply'
            ? [
                ticket.requester.email
                  ? text('To {who} <{email}>', {
                      who: to,
                      email: ticket.requester.email,
                    })
                  : text('To {who}', { who: to }),
                cc.length ? text('CC {list}', { list: cc.join(', ') }) : null,
              ]
                .filter(Boolean)
                .join(' · ')
            : text('Only your team can see this')}
        </span>
        {extras && mode === 'reply' && !ccOpen ? (
          <button type="button" onClick={() => setCcOpen(true)} className="shrink-0 text-[11.5px] font-semibold text-primary hover:underline">
            {text('CC')}
          </button>
        ) : null}
        {mode === 'reply' && !legacy && ticket.requester.email ? (
          <label className="flex shrink-0 items-center gap-1 text-[11.5px] text-ink-3" title={text('Delivered, opened and clicked on this reply. Open and click tracking isn’t always accurate.')}>
            <Checkbox checked={track} onChange={(e) => setTrack(e.target.checked)} />
            {text('Track this email')}
          </label>
        ) : null}
        {draft.savedAt && (typed || files.length) ? <span className="ml-auto shrink-0 text-[11px] text-ink-3">{text('Draft saved {time}', { time: timeLabel(draft.savedAt) })}</span> : null}
      </div>
      {extras && mode === 'reply' && (ccOpen || ccSaved.length > 0) ? (
        <div className="flex flex-wrap items-center gap-1.5 text-[12px]">
          <span className="font-semibold text-ink-3">{text('CC')}</span>
          {ccSaved.map((e) => (
            <span key={e} className="inline-flex items-center gap-1 rounded-full bg-subtle py-0.5 pr-1 pl-2 text-ink-2">
              {e}
              <button
                type="button"
                aria-label={text('Remove {email}', { email: e })}
                onClick={() =>
                  update({
                    cc: (latest.current.cc ?? []).filter((x) => x !== e),
                  })
                }
                className="rounded-full p-0.5 hover:bg-line"
              >
                <Icon name="x" size={11} />
              </button>
            </span>
          ))}
          <input
            value={ccText}
            onChange={(e) => setCcText(e.target.value)}
            onBlur={keepCc}
            onKeyDown={(e) => {
              if ((e.key === 'Enter' || e.key === ',') && ccTyped.emails.length) {
                e.preventDefault();
                keepCc();
              }
            }}
            aria-label={text('CC addresses')}
            aria-invalid={ccTyped.bad.length ? true : undefined}
            placeholder={text('name@company.com')}
            className={cx('h-6 min-w-[160px] flex-1 rounded-[6px] border bg-surface px-2 text-[12px] text-ink outline-none', ccTyped.bad.length ? 'border-danger' : 'border-line focus:border-primary')}
          />
          {ccTyped.bad.length ? <span className="text-danger">{text('Not an address: {list}', { list: ccTyped.bad.join(', ') })}</span> : null}
        </div>
      ) : null}
      {rewrite ? (
        <section aria-label={text('Writing assistant')} className="flex flex-col gap-1.5 rounded-[8px] border border-[#DDD6FE] bg-[#F5F3FF] px-3 py-2 text-[12.5px] dark:border-[#3B2F63] dark:bg-[#1A1530]">
          <div className="flex items-center gap-1.5 text-[11.5px] font-semibold text-ink-2">
            <AiBadge />
            {text(REWRITE_LABEL[rewrite.mode])}
            <span className="ml-auto font-normal text-ink-3">{text('Not sent until you send it')}</span>
          </div>
          {rewrite.phase === 'working' ? (
            <p role="status" className="text-ink-3">
              {text('Writing…')}
            </p>
          ) : rewrite.phase === 'error' ? (
            <p role="alert" className="text-danger">
              {rewrite.text}
            </p>
          ) : (
            <p className="max-h-[160px] overflow-y-auto whitespace-pre-wrap text-ink selectable scroll-thin">{rewrite.text}</p>
          )}
          <div className="flex justify-end gap-1.5">
            <Button size="sm" variant="ghost" onClick={() => setRewrite(null)}>
              {rewrite.phase === 'done' ? text('Discard') : text('Close')}
            </Button>
            {rewrite.phase === 'done' ? (
              <Button
                size="sm"
                variant="primary"
                onClick={() => {
                  setBody(rewrite.text, rewrite.text.length);
                  placeCaret(rewrite.text.length);
                  setRewrite(null);
                }}
              >
                {text('Replace my text')}
              </Button>
            ) : null}
          </div>
        </section>
      ) : null}
      <div className="relative">
        <IconButton icon={expanded ? 'minimize' : 'maximize'} label={expanded ? text('Collapse editor') : text('Expand editor')} onClick={() => setExpanded((x) => !x)} className="absolute right-2 -top-8" />
        <div
          className={cx(
            'rounded-[8px] border [&_[contenteditable]]:px-3 [&_[contenteditable]]:py-2 [&_[contenteditable]]:text-[13px]',
            mode === 'note' ? 'border-[#F6D7B0] bg-[#FFFBF3] dark:border-[#5A3B14] dark:bg-[#21180B]' : 'border-line bg-surface',
          )}
          onSelect={() => setCaret(richCaret(box.current))}
          onKeyUp={() => setCaret(richCaret(box.current))}
          onKeyDownCapture={(e) => {
            if (!(e.target instanceof Element) || !e.target.closest('[contenteditable]') || e.nativeEvent.isComposing) return;
            if (picking && choices.length) {
              if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                e.preventDefault();
                setPick((p) => (e.key === 'ArrowDown' ? (p + 1) % choices.length : (p - 1 + choices.length) % choices.length));
                return;
              }
              if (e.key === 'Enter' || e.key === 'Tab') {
                e.preventDefault();
                void choose(highlighted);
                return;
              }
            }
            if (picking && e.key === 'Escape') {
              e.preventDefault();
              e.stopPropagation();
              setDismissed(picking === 'canned' ? `/${slash!.start}` : `@${mention!.start}`);
              return;
            }
            if (e.key === 'Enter' && (isMac ? e.metaKey : e.ctrlKey)) {
              e.preventDefault();
              void send();
            }
          }}
        >
          <MailEditor
            value={replyHtml(d.body, d.html)}
            clean={linkReplyUrls}
            onBusyChange={setEditorBusy}
            onChange={(html) => {
              clientId.current = null;
              update({ html, body: replyText(html) });
              setCaret(richCaret(box.current));
            }}
            editorRef={box}
            insertRef={insertHtml}
            label={mode === 'reply' ? text('Reply to {who}', { who: to }) : text('Internal note')}
            placeholder={mode === 'reply' ? text('Reply… (/ for saved replies)') : text('Write a note… (@ to mention)')}
            variant="support"
            minHeight={expanded ? 320 : 96}
            className={cx('!bg-transparent [&_[contenteditable]]:max-h-[40vh] [&_[contenteditable]]:overflow-y-auto', expanded && '[&_[contenteditable]]:max-h-none')}
            onFiles={extras ? addFiles : undefined}
            aiSections={
              extras
                ? [
                    {
                      id: 'rewrite',
                      items: REWRITE_MODES.map((m) => ({
                        id: m,
                        label: text(REWRITE_LABEL[m]),
                        disabled: !typed || rewrite?.phase === 'working',
                        onSelect: () => runRewrite(m),
                      })),
                    },
                  ]
                : undefined
            }
            extraGroups={[
              {
                id: 'support-insert',
                label: text('Insert'),
                items: [
                  {
                    id: 'support-code',
                    label: text('Inline code'),
                    icon: 'code',
                    run: () => insertHtml.current?.(inlineCodeHtml(window.getSelection()?.toString() ?? '')),
                  },
                  {
                    id: 'support-code-block',
                    label: text('Code block'),
                    icon: 'square-code',
                    run: () => insertHtml.current?.(codeBlockHtml(window.getSelection()?.toString() ?? '')),
                  },
                  {
                    id: 'support-quote',
                    label: text('Quote'),
                    icon: 'quote',
                    run: () => {
                      document.execCommand('formatBlock', false, 'blockquote');
                      if (box.current)
                        update({
                          html: cleanReplyHtml(box.current.innerHTML),
                          body: replyText(box.current.innerHTML),
                        });
                    },
                  },
                  ...(extras
                    ? [
                        {
                          id: 'support-attach',
                          label: text('Attach'),
                          icon: 'paperclip',
                          run: () => fileInput.current?.click(),
                        },
                      ]
                    : []),
                ],
              },
            ]}
          />
        </div>
        {picking ? (
          <div
            id={pickerId}
            role="listbox"
            aria-label={picking === 'canned' ? text('Canned responses') : text('People to mention')}
            className="absolute bottom-full left-0 z-30 mb-1 max-h-[260px] w-[340px] max-w-full overflow-y-auto rounded-[10px] border border-line bg-surface py-1 shadow-xl scroll-thin"
          >
            {choices.length ? (
              choices.map((c, i) => (
                <div
                  key={c.key}
                  id={`${pickerId}-${i}`}
                  role="option"
                  aria-selected={i === highlighted}
                  tabIndex={-1}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => void choose(i)}
                  className={cx('flex w-full cursor-pointer items-center gap-2 px-3 py-1.5 text-left text-[12.5px]', i === highlighted ? 'bg-selection' : 'hover:bg-subtle')}
                >
                  {c.person ? <Avatar name={c.person.name} size={20} /> : <Icon name="file-text" size={14} className="text-ink-3" />}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold text-ink">{c.label}</span>
                    <span className="block truncate text-[11px] text-ink-3">{c.hint}</span>
                  </span>
                </div>
              ))
            ) : (
              <p className="px-3 py-2 text-[12px] text-ink-3">
                {picking === 'canned' ? (cannedQ.isLoading ? text('Looking…') : text('No canned response matches.')) : people.isLoading ? text('Looking…') : text('Nobody by that name works this ticket.')}
              </p>
            )}
          </div>
        ) : null}
      </div>
      {files.length || uploads.length ? (
        <div className="flex flex-col gap-1">
          <ul aria-label={text('Files to send')} className="flex flex-wrap gap-1.5">
            {files.map((f) => (
              <li key={f.id} className="flex max-w-[260px] items-center gap-2 rounded-[8px] border border-line bg-surface py-1 pr-1 pl-1.5 text-[12px]">
                {previews[f.id] ? <img src={previews[f.id]} alt="" className="h-7 w-7 rounded-[5px] object-cover" /> : <FileBadge name={f.name} size={28} />}
                <span className="min-w-0">
                  <span className="block truncate font-semibold text-ink">{f.name}</span>
                  <span className="block text-[11px] text-ink-3">{bytes(f.size)}</span>
                </span>
                <button type="button" aria-label={text('Remove {name}', { name: f.name })} onClick={() => dropFile(f)} className="rounded-[6px] p-1 text-ink-3 hover:bg-subtle hover:text-ink">
                  <Icon name="x" size={13} />
                </button>
              </li>
            ))}
            {uploads.map((u) => (
              <li key={u.key} className={cx('flex max-w-[280px] items-center gap-2 rounded-[8px] border py-1 pr-1 pl-1.5 text-[12px]', u.error ? 'border-danger/50 bg-danger-bg' : 'border-line bg-surface')}>
                {u.preview ? <img src={u.preview} alt="" className="h-7 w-7 rounded-[5px] object-cover" /> : <FileBadge name={u.name} size={28} />}
                <span className="min-w-0">
                  <span className="block truncate font-semibold text-ink">{u.name}</span>
                  <span className={cx('block truncate text-[11px]', u.error ? 'text-danger' : 'text-ink-3')}>{u.error ?? text('Uploading and scanning…')}</span>
                </span>
                {!u.error && u.progress !== undefined ? <progress aria-label={text('Uploading {name}', { name: u.name })} value={u.progress} max={1} className="w-16" /> : null}
                {u.error ? (
                  <button type="button" aria-label={text('Try {name} again', { name: u.name })} onClick={() => retry(u)} className="rounded-[6px] p-1 text-ink-3 hover:bg-subtle hover:text-ink">
                    <Icon name="refresh" size={13} />
                  </button>
                ) : (
                  <Icon name="spinner" size={13} className="animate-spin-slow text-ink-3" />
                )}
                <button type="button" aria-label={text('Remove {name}', { name: u.name })} onClick={() => dropUpload(u)} className="rounded-[6px] p-1 text-ink-3 hover:bg-subtle hover:text-ink">
                  <Icon name="x" size={13} />
                </button>
              </li>
            ))}
          </ul>
          <span className="text-[11px] text-ink-3">{text('{n} files · {size} · max 25 MB each · scanned before sending', { n: files.length + uploads.length, size: bytes(total) })}</span>
        </div>
      ) : null}
      <div className="flex min-w-0 flex-wrap items-center gap-1.5">
        {extras ? (
          <>
            <input
              ref={fileInput}
              type="file"
              multiple
              hidden
              aria-label={text('Files to attach')}
              onChange={(e) => {
                addFiles(Array.from(e.target.files ?? []));
                e.target.value = '';
              }}
            />
            {compact ? (
              <IconButton icon="paperclip" size={15} label={text('Attach files')} onClick={() => fileInput.current?.click()} className="h-7 w-7" />
            ) : (
              <Button size="sm" variant="ghost" icon="paperclip" onClick={() => fileInput.current?.click()}>
                {text('Attach')}
              </Button>
            )}
          </>
        ) : null}
        <Button size="sm" variant="ghost" title={text('Canned responses: type / at the start of a line')} onClick={() => startCanned.current()}>
          <span className="font-mono">/</span> {text('canned')}
        </Button>
        {extras ? (
          <Select<string>
            className={cx('h-7 text-[12px]', 'min-w-[170px] shrink-0')}
            aria-label={text('Writing assistant')}
            value=""
            disabled={!typed || rewrite?.phase === 'working'}
            onValueChange={(v) => {
              if (v) runRewrite(v as RewriteMode);
            }}
            options={[
              { value: '', label: text('AI rewrite…') },
              ...REWRITE_MODES.map((m) => ({
                value: m,
                label: text(REWRITE_LABEL[m]),
              })),
            ]}
          />
        ) : null}
        <IconButton icon="help-circle" label={text('Reply shortcuts')} onClick={() => setShortcuts((x) => !x)} />
        {shortcuts ? (
          <span role="status" className="text-[11px] text-ink-3">
            {text('R reply · N note · {keys} send', { keys: sendKeys })}
          </span>
        ) : null}
        <span className="ml-auto" />
        {moves.length ? (
          <Select<string>
            className={cx('h-7 text-[12px]', compact ? 'max-w-[150px] min-w-[120px]' : 'min-w-[170px]')}
            aria-label={text('Status after sending')}
            value={then ?? ''}
            onValueChange={(v) => update({ status: (v || null) as SupportStatus | null })}
            options={[
              {
                value: '',
                label: text('Keep {status}', {
                  status: text(statusLabel(ticket.status)),
                }),
              },
              ...moves.map((s) => ({
                value: s,
                label: text('Then: {status}', { status: text(statusLabel(s)) }),
              })),
            ]}
          />
        ) : null}
        <Button
          variant={mode === 'note' ? 'secondary' : 'primary'}
          size="sm"
          icon="send"
          loading={sending}
          disabled={!canSend}
          title={uploading ? text('Waiting for the files to finish uploading') : sendKeys}
          onClick={() => void send()}
          aria-keyshortcuts={isMac ? 'Meta+Enter' : 'Control+Enter'}
        >
          {failed ? text('Retry') : mode === 'note' ? text('Add note') : text('Send')}
        </Button>
        {!legacy && mode === 'reply' ? (
          <Select<string>
            aria-label={text('More send options')}
            className="h-7 w-[70px] shrink-0"
            value=""
            disabled={!canSend}
            options={[{ value: '', label: text('Send ▾') }, { value: 'later', label: text('Send later') }, ...(modes.note ? [{ value: 'note', label: text('Send as note') }] : [])]}
            onValueChange={(choice) => {
              if (choice === 'later') setScheduleOpen(true);
              else if (choice === 'note') void send(false, true);
            }}
          />
        ) : null}
      </div>
      {scheduleOpen ? (
        <Modal title={text('Send later')} onClose={() => setScheduleOpen(false)}>
          <label className="flex flex-col gap-2">
            {text('Send at')}
            <input aria-label={text('Send at')} type="datetime-local" value={scheduleAt} onChange={(event) => setScheduleAt(event.target.value)} />
          </label>
          <Button
            disabled={!scheduleAt || !Number.isFinite(new Date(scheduleAt).getTime()) || new Date(scheduleAt).getTime() <= Date.now()}
            onClick={() => {
              const at = new Date(scheduleAt).toISOString();
              setScheduleOpen(false);
              void send(false, false, at);
            }}
          >
            {text('Schedule reply')}
          </Button>
        </Modal>
      ) : null}
      {attachmentWarning ? (
        <Modal title={text('Did you forget an attachment?')} onClose={() => setAttachmentWarning(false)}>
          <p>{text('Your reply mentions an attachment, but no file is attached.')}</p>
          <div className="mt-3 flex gap-2">
            <Button
              onClick={() => {
                setAttachmentWarning(false);
                fileInput.current?.click();
              }}
            >
              {text('Attach a file')}
            </Button>
            <Button
              onClick={() => {
                setAttachmentWarning(false);
                void send(true, warningAsNote.current);
              }}
            >
              {text('Send anyway')}
            </Button>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}

export function Composer(props: Parameters<typeof TicketComposer>[0]) {
  return <TicketComposer key={props.ticket.id} {...props} />;
}
