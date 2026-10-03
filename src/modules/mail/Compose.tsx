import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { apiPost, request } from '../../core/api';
import { call, errorMessage } from '../../core/bridge';
import { useDraft } from '../../core/drafts';
import { text } from '../../core/i18n';
import { addDays, bytes, timeLabel, todayInZone, wallToUtc } from '../../core/time';
import { toast } from '../../core/toasts';
import { Icon } from '../../components/Icon';
import { Menu, type MenuSection } from '../../components/Menu';
import { Select } from '../../components/Select';
import { DriveFilePicker, type DriveFileRow } from '../../components/DriveFilePicker';
import { Button, Chip, ErrorNote, FileBadge, Modal, Spinner, TextField, cx } from '../../components/ui';
import { AiTextDialog } from '../ai/AiTextDialog';
import { SuggestTimes } from './SuggestTimes';
import { createMeeting } from '../meet/api';
import { ComposeActions, quickPartsReason } from './editor/ComposeActions';
import { MailEditor } from './editor/MailEditor';
import { INLINE_MAX_BYTES, MESSAGE_MAX_BYTES, MESSAGE_WARN_BYTES, embeddedBytes } from './editor/images';
import { meetingLinkHtml } from './editor/insert';
import { MailMerge } from './MailMerge';
import { canOpen } from '../../core/access';
import { MAIL_TASKS, WRITING_TASKS, type TextTask } from '../ai/textTools';
import { sendMessage, useQuickParts, useSignatures, useTemplates } from './api';
import { chooseSignature as signatureFor, cleanComposeHtml, composeBody, composeText, migrateDraft, parseQuote, sendChecks, signatureBlock, splitSignature, textToComposeHtml, voteChoices, withVotePrompt, type ComposeDraft } from './composeHtml';
import { fillSignature, valuesFor, withEmbedded } from './signatures/signatureHtml';
import { MentionPopup } from './Mentions';
import { mailboxLetter } from './model';
import { sendAfterUndoWindow } from './outgoing';
import { AccountAvatar } from './parts';
import { RecipientField, addressOf } from './Recipients';
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
 */

type Attached = NonNullable<ComposeDraft['attachments']>[number];

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

export function Compose({ seed, boxes, defaultBox, offline, onClose, onReopen }: { seed: ComposeSeed; boxes: Mailbox[]; defaultBox: string | null; offline: boolean; onClose: () => void; onReopen: (seed: ComposeSeed) => void }) {
  const context = draftContext(seed);
  const seedQuote = seed.quote ?? '';
  const draft = useDraft<ComposeDraft>('mail', context, { to: seed.to ?? '', cc: seed.cc ?? '', bcc: seed.bcc ?? '', subject: seed.subject ?? '', html: seed.body ? textToComposeHtml(seed.body) : '', quote: seedQuote, from: seed.mailbox ?? defaultBox ?? '', attachments: [], v: 2 });
  const [error, setError] = useState<string | null>(null);
  const [showCc, setShowCc] = useState(!!seed.cc);
  const [showBcc, setShowBcc] = useState(!!seed.bcc);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [uploading, setUploading] = useState<string[]>([]);
  const [later, setLater] = useState<string | null>(null);
  const [pick, setPick] = useState('');
  const [busy, setBusy] = useState(false);
  const [menu, setMenu] = useState(false);
  const [tplQuery, setTplQuery] = useState('');
  const [quoteOpen, setQuoteOpen] = useState(false);
  const [drive, setDrive] = useState(false);
  const tplSearch = useRef<HTMLInputElement>(null);
  const sendMenu = useRef<HTMLButtonElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
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
    setSavedAt(new Date().toISOString());
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
      setUploading((u) => [...u, file.name]);
      try {
        const form = new FormData();
        form.set('file', file, file.name);
        form.set('kind', 'attach');
        const r = await request<Attached>('POST', '/api/mail/upload', { body: form });
        set({ attachments: [...(latest.current.attachments ?? []), { token: r.data.token, name: r.data.name, size: r.data.size }] });
      } catch (e) {
        toast('error', errorMessage(e));
      } finally {
        setUploading((u) => u.filter((n) => n !== file.name));
      }
    }
  };

  /** Files from the Drive go as copies, staged on the server like an upload (the Drive's download permission decides). */
  const attachFromDrive = async (files: DriveFileRow[]) => {
    setDrive(false);
    for (const f of files) {
      setUploading((u) => [...u, f.name]);
      try {
        const r = await apiPost<Attached>('/api/mail/upload/from-drive', { file_id: Number(f.id) });
        set({ attachments: [...(latest.current.attachments ?? []), { token: r.token, name: r.name, size: r.size, source: 'drive' }] });
      } catch (e) {
        toast('error', text('“{name}” was not attached: {reason}', { name: f.name, reason: errorMessage(e) }));
      } finally {
        setUploading((u) => u.filter((n) => n !== f.name));
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
      mailbox: fromId || undefined,
      attachments: (d.attachments ?? []).map((a) => a.token),
      ...(d.options && Object.keys(d.options).length ? { options: d.options } : {}),
      ...(scheduleAt ? { schedule_at: scheduleAt } : {}),
    };
  };

  const [checks, setChecks] = useState<Array<'attachment' | 'subject'> | null>(null);
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
  const sendNow = (checked = false) => {
    setError(null);
    const d = latest.current;
    if (!parseAddresses(d.to).length) return setError(text('Add at least one recipient.'));
    if (embeddedBytes(d.html) > INLINE_MAX_BYTES) return setError(tooManyPictures());
    // Forgot the file? No subject? Asked once before it goes (DMO-CMP-16).
    const issues = checked ? [] : sendChecks(d, composeText(splitSignature(d.html)[0]));
    if (issues.length) return setChecks(issues);
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

  const quote = parseQuote(v.quote);
  const list = (templates.data?.templates ?? []).filter((t) => !tplQuery.trim() || t.name.toLowerCase().includes(tplQuery.trim().toLowerCase()));
  const sendSections: MenuSection[] = [
    {
      id: 'later',
      label: text('Send later'),
      items: [
        ...choices.map((c) => ({ id: c.id, label: c.label, description: c.when, icon: 'clock', disabled: offline, reason: text('Scheduling needs WorkSuite.'), onSelect: () => void sendLater(c.at) })),
        { id: 'pick', label: text('Pick a date and time'), icon: 'calendar', onSelect: () => setLater('pick') },
      ],
    },
  ];

  return (
    <div className="flex min-h-0 flex-1">
      <form
        aria-label={seed.mode === 'new' ? text('New email') : seed.mode === 'forward' ? text('Forward') : text('Reply')}
        // Writing an email: the AI launcher stays out of the send options and status bar (#153); Write with AI is in the toolbar.
        data-hide-ai-launcher
        className="flex min-w-0 flex-1 flex-col bg-surface"
        onSubmit={(e) => {
          e.preventDefault();
          sendNow();
        }}
        onKeyDown={(e) => {
          if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
            e.preventDefault();
            sendNow();
          }
        }}
      >
        <ComposeActions
          offline={offline}
          templates={templates.data?.templates ?? []}
          onTemplate={(t) => void applyTemplate(t)}
          onSaveTemplate={() => setSaveTpl(true)}
          quickParts={quickParts.data ?? []}
          quickPartsReason={quickPartsReason(quickParts.data, !!quickParts.isLoading, !!quickParts.error)}
          onQuickPart={(q) => setPending({ part: q.html })}
          signatures={signatures.data?.signatures ?? []}
          currentSignature={currentSignature}
          onSignature={chooseSignature}
          onAttachComputer={() => fileInput.current?.click()}
          onAttachFiles={() => setDrive(true)}
          onCloudLink={() => setCloud(true)}
          mailMerge={seed.mode === 'new'}
          onMailMerge={() => setMerging(payload())}
          suggestTimes={canOpen('calendar')}
          onSuggestTimes={() => setSuggesting(true)}
          options={optionSections}
          important={v.options?.importance === 'high'}
        />
        <Field label="From">
          {boxes.length > 1 ? (
            <Select aria-label="From" value={fromId} onValueChange={(x) => set({ from: String(x) })} options={boxes.map((b) => ({ value: String(b.id), label: b.display_name && b.display_name !== b.email ? `${b.display_name} <${b.email}>` : b.email }))} className="h-8 max-w-[360px]" />
          ) : from ? (
            <span className="flex items-center gap-2 text-[13.5px] font-semibold text-ink">
              <AccountAvatar letter={mailboxLetter(from)} colour={from.colour} size={20} />
              {from.email}
            </span>
          ) : null}
          {from ? <Chip tone="indigo">{from.account_type === 'local_mailbox' ? text('WorkSuite Local') : from.shared ? text('Shared') : (from.provider_label ?? '')}</Chip> : null}
        </Field>
        <Field label="To">
          <RecipientField label="To" value={v.to} onChange={(to) => set({ to })} names={v.names ?? {}} onName={named} placeholder="name@company.com, …" autoFocus={!v.to} />
          {!showCc ? (
            <button type="button" onClick={() => setShowCc(true)} className="text-[13px] font-semibold text-primary hover:underline">
              Cc
            </button>
          ) : null}
          {!showBcc ? (
            <button type="button" onClick={() => setShowBcc(true)} className="text-[13px] font-semibold text-primary hover:underline">
              Bcc
            </button>
          ) : null}
        </Field>
        {showCc ? (
          <Field label="Cc">
            <RecipientField label="Cc" value={v.cc} onChange={(cc) => set({ cc })} names={v.names ?? {}} onName={named} />
          </Field>
        ) : null}
        {showBcc ? (
          <Field label="Bcc">
            <RecipientField label="Bcc" value={v.bcc} onChange={(bcc) => set({ bcc })} names={v.names ?? {}} onName={named} />
          </Field>
        ) : null}
        <Field label="Subject">
          <input aria-label="Subject" value={v.subject} onChange={(e) => set({ subject: e.target.value })} className="bare-focus min-w-0 flex-1 bg-transparent text-[14px] font-bold text-ink outline-none" />
        </Field>
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
        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto bg-ground/40 px-4 py-3 scroll-thin">
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
            minHeight={240}
            className="shrink-0 shadow-sm"
          />
          <input ref={fileInput} type="file" multiple hidden aria-hidden onChange={(e) => void attach(e.target.files ? [...e.target.files] : []).then(() => (e.target.value = ''))} />
          {(v.attachments?.length ?? 0) > 0 || uploading.length ? (
            <ul role="list" aria-label="Attachments" className="flex shrink-0 flex-wrap gap-2">
              {(v.attachments ?? []).map((a) => (
                <li key={a.token} className="flex items-center gap-2.5 rounded-[10px] border border-line bg-surface px-3 py-2">
                  <FileBadge name={a.name} size={30} />
                  <span>
                    <span className="block max-w-[200px] truncate text-[13px] font-semibold text-ink">{a.name}</span>
                    <span className="block text-[11.5px] text-ink-3">{a.source === 'drive' ? text('{size} · from Files', { size: bytes(a.size) }) : text('{size} · from this computer', { size: bytes(a.size) })}</span>
                  </span>
                  <button type="button" onClick={() => set({ attachments: (v.attachments ?? []).filter((x) => x.token !== a.token) })} aria-label={text('Remove {name}', { name: a.name })} className="text-ink-3 hover:text-danger">
                    <Icon name="x" size={14} />
                  </button>
                </li>
              ))}
              {uploading.map((n) => (
                <li key={n} className="flex items-center gap-2 rounded-[10px] border border-dashed border-line px-3 py-2 text-[12.5px] text-ink-3">
                  <Icon name="spinner" size={14} className="animate-spin" /> {text('Uploading {name}…', { name: n })}
                </li>
              ))}
            </ul>
          ) : null}
          {v.quote.trim() ? (
            <section aria-label={text('Quoted email')} className="shrink-0 rounded-[10px] border border-dashed border-line bg-surface">
              <div className="flex items-center gap-2 px-3 py-1.5">
                <button type="button" aria-expanded={quoteOpen} onClick={() => setQuoteOpen(!quoteOpen)} className="flex min-w-0 flex-1 items-center gap-1.5 rounded-[6px] py-1 text-left text-[12.5px] font-semibold text-ink-2 hover:text-ink">
                  <Icon name={quoteOpen ? 'chevron-down' : 'chevron-right'} size={14} />
                  <span className="truncate">{quote.attribution || (seed.mode === 'forward' ? text('Forwarded email') : text('Quoted email'))}</span>
                </button>
                <span className="hidden shrink-0 text-[11.5px] text-ink-3 sm:inline">{text('AI works on what you wrote; the quoted email is left as it is.')}</span>
                <button type="button" onClick={() => set({ quote: '' })} className="shrink-0 rounded-[6px] px-2 py-1 text-[12px] font-semibold text-ink-3 hover:bg-subtle hover:text-danger">
                  {text('Remove quoted email')}
                </button>
              </div>
              {quoteOpen ? (
                <blockquote className="selectable mx-3 mb-3 max-h-[320px] overflow-y-auto border-l-[3px] border-line pl-3 text-[13px] leading-[1.55] whitespace-pre-wrap text-ink-2 scroll-thin">{quote.lines.join('\n')}</blockquote>
              ) : null}
            </section>
          ) : null}
        </div>
        {totalBytes > MESSAGE_WARN_BYTES ? (
          <p role="status" className={cx('mx-4 mt-2 rounded-[8px] px-3 py-2 text-[12.5px]', totalBytes > MESSAGE_MAX_BYTES ? 'bg-danger-bg text-danger' : 'bg-warning-bg text-warning')}>
            {text('This message is {size} with its pictures and attachments — most mail servers refuse messages over 25 MB. Send big files as a cloud link instead.', { size: bytes(totalBytes) })}
          </p>
        ) : null}
        {error ? <div className="px-4 pt-2"><ErrorNote error={error} /></div> : null}
        <div className="flex h-[60px] shrink-0 items-center gap-2.5 border-t border-line px-4">
          <SendSplit menuRef={sendMenu} disabled={uploading.length > 0} onMenu={() => setMenu(true)} />
          <button type="button" onClick={() => void sendLater(laterAt)} disabled={busy || !later || uploading.length > 0} className={SECONDARY}>
            {busy ? <Icon name="spinner" size={15} className="animate-spin-slow" /> : null}
            {text('Send later…')}
          </button>
          <span className="min-w-0 flex-1 truncate text-[12px] text-ink-3">
            {draft.restored && !savedAt ? text('Draft restored from this computer') : savedAt ? text('Draft saved on this computer · {time}', { time: timeLabel(savedAt) }) : text('Saved on this computer as you type')}
          </span>
          <button
            type="button"
            onClick={async () => {
              await draft.clear();
              onClose();
            }}
            aria-label={text('Discard draft')}
            className="h-[34px] shrink-0 rounded-[8px] px-2.5 text-[13.5px] font-semibold text-danger hover:bg-danger-bg"
          >
            Discard
          </button>
        </div>
      </form>
      <aside aria-label="Templates and send later" className="flex w-[300px] shrink-0 flex-col gap-3 overflow-y-auto border-l border-line bg-surface p-4 scroll-thin">
        <h3 className="text-[14px] font-bold text-ink">Templates</h3>
        <label className="flex h-9 items-center gap-2 rounded-[8px] border border-line px-2.5 text-[13px]">
          <Icon name="search" size={14} className="text-ink-3" />
          <input ref={tplSearch} value={tplQuery} onChange={(e) => setTplQuery(e.target.value)} placeholder="Search templates" aria-label="Search templates" className="bare-focus min-w-0 flex-1 bg-transparent text-ink outline-none placeholder:text-ink-3" />
        </label>
        {templates.isLoading ? <Spinner label="" /> : null}
        {!templates.isLoading && list.length === 0 ? <p className="text-[12.5px] text-ink-3">{tplQuery ? text('No template matches.') : text('No templates yet. Make them in WorkSuite Mail on the web.')}</p> : null}
        <ul role="list" className="flex flex-col gap-2">
          {list.map((t) => (
            <li key={t.id}>
              <button type="button" onClick={() => void applyTemplate(t)} className="w-full rounded-[10px] border border-line px-3 py-2 text-left hover:border-primary hover:bg-subtle">
                <span className="block truncate text-[13px] font-bold text-ink">{t.name}</span>
                <span className="block text-[12px] text-ink-3">{t.mine ? (t.shared ? text('Mine · shared') : text('Mine')) : text('Shared with you')}</span>
              </button>
            </li>
          ))}
        </ul>
        <h3 className="mt-2 text-[14px] font-bold text-ink">Send later</h3>
        <div role="radiogroup" aria-label="Send later" className="flex flex-col gap-2">
          {[...choices, { id: 'pick', label: text('Pick a date and time'), at: '', when: '' }].map((c) => (
            <button key={c.id} type="button" role="radio" aria-checked={later === c.id} onClick={() => setLater(later === c.id ? null : c.id)} className={cx('flex items-center gap-2.5 rounded-[10px] border px-3 py-2 text-left text-[13px]', later === c.id ? 'border-primary bg-selection' : 'border-line hover:bg-subtle')}>
              <span aria-hidden className={cx('inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2', later === c.id ? 'border-primary' : 'border-ink-3')}>{later === c.id ? <span className="h-2 w-2 rounded-full bg-primary" /> : null}</span>
              <span className="flex-1 text-ink">{c.label}</span>
              {c.when ? <span className="text-[12px] text-ink-3">{c.when}</span> : null}
            </button>
          ))}
          {later === 'pick' ? <input type="datetime-local" aria-label="Date and time to send" value={pick} min={new Date().toISOString().slice(0, 16)} onChange={(e) => setPick(e.target.value)} className="h-9 rounded-[8px] border border-line bg-surface px-2 text-[13px] text-ink" /> : null}
        </div>
        <p className="text-[12px] text-ink-3">Scheduled mail is sent by the WorkSuite server, so this computer can be off.</p>
      </aside>
      {drive ? <DriveFilePicker title={text('Attach from Files')} confirmLabel={text('Attach')} onChoose={(files) => void attachFromDrive(files)} onClose={() => setDrive(false)} /> : null}
      {menu ? <Menu sections={sendSections} label={text('Send later')} anchor={sendMenu} prefer="top" align="start" onClose={() => setMenu(false)} /> : null}
      {cloud ? <DriveFilePicker title={text('Share a link to a file')} confirmLabel={text('Insert link')} onChoose={(files) => void cloudLink(files)} onClose={() => setCloud(false)} /> : null}
      {saveTpl ? <SaveTemplate subject={v.subject} html={mine} onClose={() => setSaveTpl(false)} onSaved={() => void templates.refetch?.()} /> : null}
      <MentionPopup editor={editorEl} onMention={mentioned} />
      {voteDialog ? <CustomVote initial={v.options?.vote ?? []} onSave={(choices) => (setPending({ options: { vote: choices.length ? choices : undefined } }), setVoteDialog(false))} onClose={() => setVoteDialog(false)} /> : null}
      {checks ? (
        <Modal
          title={checks.includes('attachment') ? text('Did you mean to attach a file?') : text('Send without a subject?')}
          labelledBy="mail-send-check"
          width={420}
          onClose={() => setChecks(null)}
          footer={
            <>
              <Button onClick={() => setChecks(null)}>{checks.includes('attachment') ? text('Attach a file') : text('Add a subject')}</Button>
              <Button variant="primary" onClick={() => (setChecks(null), sendNow(true))}>
                {text('Send anyway')}
              </Button>
            </>
          }
        >
          <ul className="flex list-disc flex-col gap-1 p-5 pl-9 text-[13.5px] text-ink">
            {checks.includes('attachment') ? <li>{text('Your message mentions an attachment, but nothing is attached.')}</li> : null}
            {checks.includes('subject') ? <li>{text('There is no subject.')}</li> : null}
          </ul>
        </Modal>
      ) : null}
    </div>
  );
}

/*
 * The bottom bar's buttons, kept local and plain until the shared
 * primary/secondary button styles land: both halves of Send are one control —
 * the same height, one rounded outline, a hairline between them.
 */
const PRIMARY_HALF = 'inline-flex h-full items-center justify-center gap-1.5 bg-primary text-[13.5px] font-bold text-[var(--ws-on-primary)] transition-colors hover:bg-primary-hover focus-visible:relative focus-visible:z-10 disabled:cursor-not-allowed disabled:opacity-60';
const SECONDARY = 'inline-flex h-[38px] shrink-0 items-center gap-1.5 rounded-[9px] border border-line bg-surface px-3.5 text-[13.5px] font-semibold text-ink transition-colors hover:bg-subtle disabled:cursor-not-allowed disabled:opacity-50';

export function SendSplit({ menuRef, disabled, onMenu }: { menuRef: React.RefObject<HTMLButtonElement | null>; disabled?: boolean; onMenu: () => void }) {
  return (
    <div role="group" aria-label={text('Send options')} data-testid="send-split" className="inline-flex h-[38px] shrink-0 items-stretch overflow-hidden rounded-[9px] shadow-sm">
      <button type="submit" disabled={disabled} title={text('Send (Ctrl+Enter) — you have {n} seconds to undo', { n: 8 })} className={cx(PRIMARY_HALF, 'px-[18px]')}>
        <Icon name="send" size={15} />
        {text('Send')}
      </button>
      <span aria-hidden className="w-px bg-[var(--ws-on-primary)] opacity-25" />
      <button ref={menuRef} type="button" onClick={onMenu} aria-label={text('Send later options')} aria-haspopup="menu" title={text('Send later options')} className={cx(PRIMARY_HALF, 'w-8')}>
        <Icon name="chevron-down" size={15} />
      </button>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-h-[44px] items-center gap-3 border-b border-line px-4">
      <span className="w-14 shrink-0 text-[13px] text-ink-3">{label}</span>
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
