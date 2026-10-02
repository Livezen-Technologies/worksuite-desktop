import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { apiPost, request } from '../../core/api';
import { call, errorMessage } from '../../core/bridge';
import { useDraft } from '../../core/drafts';
import { text } from '../../core/i18n';
import { addDays, bytes, timeLabel, todayInZone, wallToUtc } from '../../core/time';
import { toast } from '../../core/toasts';
import { Icon } from '../../components/Icon';
import { Menu, type MenuSection } from '../../components/Menu';
import { Select } from '../../components/Select';
import { Button, Chip, ErrorNote, FileBadge, Spinner, cx } from '../../components/ui';
import { AiMenuButton } from '../ai/AiMenuButton';
import { AiTextDialog } from '../ai/AiTextDialog';
import { WRITING_TASKS, type TextTask } from '../ai/textTools';
import { sendMessage, useSignatures, useTemplates } from './api';
import { mailboxLetter, plainText } from './model';
import { sendAfterUndoWindow } from './outgoing';
import { AccountAvatar } from './parts';
import { joinQuote, splitQuote, unquote } from './quote';
import { parseAddresses, textToHtml } from './sanitize';
import type { ComposeSeed, Mailbox, Template } from './types';

/**
 * Writing an email, in the page's own tab (UI-07): From, To, Cc and Bcc, the
 * subject, the message with AI writing tools, attachments from this computer,
 * templates, and Send — now, with a few seconds to undo, or later, from the
 * server so this computer can be off. The draft is kept on this computer as
 * it is typed (FR-OFF-07); offline, Send queues the message and it goes when
 * the connection returns.
 */

interface Attached {
  token: string;
  name: string;
  size: number;
}

interface DraftValue {
  to: string;
  cc: string;
  bcc: string;
  subject: string;
  body: string;
  from: string;
  attachments?: Attached[];
  signed?: boolean;
}

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
  const draft = useDraft<DraftValue>('mail', context, { to: seed.to ?? '', cc: seed.cc ?? '', bcc: '', subject: seed.subject ?? '', body: seed.quote ?? '', from: seed.mailbox ?? defaultBox ?? '', attachments: [] });
  const [error, setError] = useState<string | null>(null);
  const [showCc, setShowCc] = useState(!!seed.cc);
  const [showBcc, setShowBcc] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [uploading, setUploading] = useState<string[]>([]);
  const [later, setLater] = useState<string | null>(null);
  const [pick, setPick] = useState('');
  const [busy, setBusy] = useState(false);
  const [menu, setMenu] = useState(false);
  const [tplQuery, setTplQuery] = useState('');
  const sendMenu = useRef<HTMLButtonElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const v = draft.value;
  const set = (patch: Partial<DraftValue>) => {
    draft.setValue({ ...v, ...patch });
    setSavedAt(new Date().toISOString());
  };
  const templates = useTemplates(true);
  const signatures = useSignatures(true);
  const from = boxes.find((b) => String(b.id) === v.from) ?? boxes[0] ?? null;

  // The default signature goes in once, above the quoted email, on a message that has none yet.
  const sig = signatures.data?.signatures.find((s) => s.is_default) ?? null;
  useEffect(() => {
    if (!sig || v.signed || draft.restored) return;
    const [own, quoted] = splitQuote(v.body, seed.quote);
    if (own.trim()) return;
    draft.setValue({ ...v, signed: true, body: `\n\n-- \n${plainText(sig.html)}${quoted ? `\n${quoted}` : ''}` });
    // Only when the signature arrives.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig?.id]);

  // AI writing tools (worksuite-desktop#53) work on what the person wrote, never on the quoted email below it.
  const [ai, setAi] = useState<{ task: TextTask; title: string } | null>(null);
  const [own, quoted] = splitQuote(v.body, seed.quote);
  const original = seed.quote ? unquote(seed.quote) : '';
  const aiItems = [
    ...(original && seed.mode !== 'forward' ? [{ label: text('Draft a reply'), icon: 'reply', run: () => setAi({ task: 'reply', title: text('Draft a reply') }) }] : []),
    ...WRITING_TASKS.map((w) => ({ label: w.label, disabled: !own.trim(), run: () => setAi({ task: w.task, title: w.label }) })),
  ];
  const choices = useMemo(() => laterChoices(), []);
  const laterAt = later === 'pick' ? (pick ? new Date(pick).toISOString() : null) : (choices.find((c) => c.id === later)?.at ?? null);

  const attach = async (files: FileList | null) => {
    if (!files?.length) return;
    for (const file of [...files]) {
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
        draft.setValue({ ...draft.value, attachments: [...(draft.value.attachments ?? []), { token: r.data.token, name: r.data.name, size: r.data.size }] });
      } catch (e) {
        toast('error', errorMessage(e));
      } finally {
        setUploading((u) => u.filter((n) => n !== file.name));
      }
    }
  };

  const payload = (scheduleAt?: string) => ({
    to: parseAddresses(v.to),
    cc: parseAddresses(v.cc),
    bcc: parseAddresses(v.bcc),
    subject: v.subject,
    body_html: textToHtml(v.body),
    in_reply_to: seed.inReplyTo,
    reply_mode: seed.mode === 'new' ? undefined : seed.mode,
    mailbox: v.from || undefined,
    attachments: (v.attachments ?? []).map((a) => a.token),
    ...(scheduleAt ? { schedule_at: scheduleAt } : {}),
  });

  const sendNow = () => {
    setError(null);
    if (!parseAddresses(v.to).length) return setError(text('Add at least one recipient.'));
    const body = payload();
    const subject = v.subject || text('(no subject)');
    const toList = parseAddresses(v.to).join(', ');
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
    if (!parseAddresses(v.to).length) return setError(text('Add at least one recipient.'));
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
      const body = plainText(r.body_html ?? t.body_html);
      set({ subject: v.subject.trim() ? v.subject : (r.subject ?? t.subject ?? ''), body: joinQuote(`${own.trimEnd()}${own.trim() ? '\n\n' : ''}${body}\n`, quoted) });
    } catch (e) {
      toast('error', errorMessage(e));
    }
  };

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
        <Field label="From">
          {boxes.length > 1 ? (
            <Select aria-label="From" value={v.from} onValueChange={(x) => set({ from: String(x) })} options={boxes.map((b) => ({ value: String(b.id), label: b.display_name && b.display_name !== b.email ? `${b.display_name} <${b.email}>` : b.email }))} className="h-8 max-w-[360px]" />
          ) : from ? (
            <span className="flex items-center gap-2 text-[13.5px] font-semibold text-ink">
              <AccountAvatar letter={mailboxLetter(from)} colour={from.colour} size={20} />
              {from.email}
            </span>
          ) : null}
          {from ? <Chip tone="indigo">{from.account_type === 'local_mailbox' ? text('WorkSuite Local') : from.shared ? text('Shared') : (from.provider_label ?? '')}</Chip> : null}
        </Field>
        <Field label="To">
          <input aria-label="To" value={v.to} onChange={(e) => set({ to: e.target.value })} placeholder="name@company.com, …" autoFocus={!v.to} className="bare-focus min-w-0 flex-1 bg-transparent text-[13.5px] text-ink outline-none placeholder:text-ink-3" />
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
            <input aria-label="Cc" value={v.cc} onChange={(e) => set({ cc: e.target.value })} className="bare-focus min-w-0 flex-1 bg-transparent text-[13.5px] text-ink outline-none" />
          </Field>
        ) : null}
        {showBcc ? (
          <Field label="Bcc">
            <input aria-label="Bcc" value={v.bcc} onChange={(e) => set({ bcc: e.target.value })} className="bare-focus min-w-0 flex-1 bg-transparent text-[13.5px] text-ink outline-none" />
          </Field>
        ) : null}
        <Field label="Subject">
          <input aria-label="Subject" value={v.subject} onChange={(e) => set({ subject: e.target.value })} className="bare-focus min-w-0 flex-1 bg-transparent text-[14px] font-bold text-ink outline-none" />
        </Field>
        <div className="flex items-center gap-2 border-b border-line px-4 py-2">
          <AiMenuButton items={aiItems} label={text('Write with AI')} />
          <Button size="sm" icon="paperclip" onClick={() => fileInput.current?.click()} disabled={offline} title={offline ? text('Attaching needs WorkSuite.') : text('Attach from this computer')}>
            Attach
          </Button>
          <input ref={fileInput} type="file" multiple hidden aria-hidden onChange={(e) => void attach(e.target.files).then(() => (e.target.value = ''))} />
          <span className="truncate text-[11.5px] text-ink-3">{own.trim() ? text('AI works on what you wrote; the quoted email is left as it is.') : original ? text('Draft a reply from the email below, or write and then improve it.') : text('Write something, then improve it.')}</span>
        </div>
        {ai ? (
          <AiTextDialog
            title={ai.title}
            task={ai.task}
            input={() => (ai.task === 'reply' ? `Subject: ${v.subject}\n\nThe email I am replying to:\n${original}${own.trim() ? `\n\nWhat I want to say (my notes):\n${own.trim()}` : ''}` : own.trim())}
            actions={[{ label: own.trim() ? text('Replace my text') : text('Use this'), primary: true, run: (t) => set({ body: joinQuote(t, quoted) }) }]}
            onClose={() => setAi(null)}
          />
        ) : null}
        <textarea value={v.body} onChange={(e) => set({ body: e.target.value })} aria-label="Message" autoFocus={!!v.to} className="bare-focus min-h-[160px] flex-1 resize-none bg-surface px-5 py-4 text-[14px] leading-relaxed text-ink outline-none" />
        {(v.attachments?.length ?? 0) > 0 || uploading.length ? (
          <ul role="list" aria-label="Attachments" className="flex flex-wrap gap-2 border-t border-line px-4 py-3">
            {(v.attachments ?? []).map((a) => (
              <li key={a.token} className="flex items-center gap-2.5 rounded-[10px] border border-line px-3 py-2">
                <FileBadge name={a.name} size={30} />
                <span>
                  <span className="block max-w-[200px] truncate text-[13px] font-semibold text-ink">{a.name}</span>
                  <span className="block text-[11.5px] text-ink-3">{text('{size} · from this computer', { size: bytes(a.size) })}</span>
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
        {error ? <div className="px-4 pb-2"><ErrorNote error={error} /></div> : null}
        <div className="flex h-[58px] shrink-0 items-center gap-2 border-t border-line px-4">
          <div className="flex">
            <Button type="submit" variant="primary" icon="send" className="rounded-r-none" disabled={uploading.length > 0} title={text('Send (Ctrl+Enter) — you have {n} seconds to undo', { n: 8 })}>
              Send
            </Button>
            <button ref={sendMenu} type="button" onClick={() => setMenu(true)} aria-label="Send later options" aria-haspopup="menu" className="inline-flex h-9 items-center rounded-r-[8px] border-l border-white/25 bg-primary px-2 text-[var(--ws-on-primary)] hover:bg-primary-hover">
              <Icon name="chevron-down" size={14} />
            </button>
          </div>
          <Button onClick={() => void sendLater(laterAt)} loading={busy} disabled={!later || uploading.length > 0}>
            Send later…
          </Button>
          <span className="min-w-0 flex-1 truncate text-[12px] text-ink-3">
            {draft.restored && !savedAt ? text('Draft restored from this computer') : savedAt ? text('Draft saved on this computer · {time}', { time: timeLabel(savedAt) }) : text('Saved on this computer as you type')}
          </span>
          <button
            type="button"
            onClick={async () => {
              await draft.clear();
              onClose();
            }}
            className="h-9 rounded-[8px] px-3 text-[13.5px] font-semibold text-danger hover:bg-danger-bg"
          >
            Discard
          </button>
        </div>
      </form>
      <aside aria-label="Templates and send later" className="flex w-[290px] shrink-0 flex-col gap-3 overflow-y-auto border-l border-line bg-surface p-4 scroll-thin">
        <h3 className="text-[14px] font-bold text-ink">Templates</h3>
        <label className="flex h-9 items-center gap-2 rounded-[8px] border border-line px-2.5 text-[13px]">
          <Icon name="search" size={14} className="text-ink-3" />
          <input value={tplQuery} onChange={(e) => setTplQuery(e.target.value)} placeholder="Search templates" aria-label="Search templates" className="bare-focus min-w-0 flex-1 bg-transparent text-ink outline-none placeholder:text-ink-3" />
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
      {menu ? <Menu sections={sendSections} label={text('Send later')} anchor={sendMenu} prefer="top" align="start" onClose={() => setMenu(false)} /> : null}
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
