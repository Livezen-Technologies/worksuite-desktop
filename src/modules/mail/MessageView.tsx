import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { canOpen } from '../../core/access';
import { apiGet, apiGetMeta, apiPost, withMailbox } from '../../core/api';
import { app } from '../../core/app-state';
import { call, errorMessage } from '../../core/bridge';
import { text } from '../../core/i18n';
import { isOfficeFile, openInOffice } from '../../core/open-document';
import { useStore } from '../../core/store';
import { useTab } from '../../core/tab-context';
import { dateLabel, dayKey, parseTs, timeLabel, todayInZone } from '../../core/time';
import { toast } from '../../core/toasts';
import { Icon } from '../../components/Icon';
import { Menu, type MenuItem, type MenuSection } from '../../components/Menu';
import { Avatar, Button, Chip, ErrorNote, FileBadge, Modal, Spinner, cx } from '../../components/ui';
import { AiTextDialog } from '../ai/AiTextDialog';
import type { TextTask } from '../ai/textTools';
import { openPdf } from '../pdf/open';
import { createTask } from '../tasks/actions';
import { createMeeting, invitation, openMeeting } from '../meet/api';
import { messageAction, moveMessage, setLabel, useFolders, useLabels, useMessageContext, type MessageActionName } from './api';
import { folderName, plainText, securityVerdict } from './model';
import { escapeHtml, isDesignedMail, mailFrameDoc, sanitizeMailHtml } from './sanitize';
import { TeamBar, TeamWork } from './Team';
import type { ComposeSeed, MailPrefs, Mailbox, MessageDetail, MessageRef } from './types';

/** A PDF attachment, by its type or its name. */
const isPdf = (a: { name: string; mime: string }) => a.mime === 'application/pdf' || /\.pdf$/i.test(a.name);

export interface MessageViewProps {
  msgRef: MessageRef;
  /** The folder the list shows, for "← Inbox". */
  backLabel: string;
  onBack: () => void;
  onReply: (seed: ComposeSeed) => void;
  /** The message left the list (archived, deleted, moved). */
  onGone: () => void;
  onPrev: (() => void) | null;
  onNext: (() => void) | null;
  prefs: MailPrefs;
  onPrefs: (patch: Partial<MailPrefs>) => void;
  focus: boolean;
  onFocus: () => void;
  boxes: Mailbox[];
  /** WorkSuite's own store is the mail (no mailbox connected): labels and importance live there. */
  localStore: boolean;
  offline: boolean;
  /** The message's account, as the tabs and chips name it. */
  account: Mailbox | null;
  /** What the page's keyboard shortcuts call on the open message. */
  onControls?: (c: ViewControls | null) => void;
  /** Start a reply as soon as the message is here (a notification's Reply). */
  autoReply?: boolean;
  /** The message arrived: its tab can be named (a message opened from a link is not in the list). */
  onLoaded?: (subject: string, from: string) => void;
  /**
   * Where Archive puts it, from a combined view (DMO-ALL-11): the account's
   * own Archive ('default'), a folder chosen for an account without one, or
   * null when the person cancelled.
   */
  archiveTo?: (ref: MessageRef) => Promise<{ slug: string; name: string } | 'default' | null> | 'default';
}

export interface ViewControls {
  act: (action: 'archive' | 'trash' | 'spam' | 'star' | 'unread') => void;
  reply: (mode: ComposeSeed['mode']) => void;
}

const re = (s: string) => (/^re:/i.test(s) ? s : `Re: ${s}`);

/** "Today at 10:58", or the date and time. */
export function whenLabel(stamp: string): string {
  const d = parseTs(stamp);
  if (Number.isNaN(d.getTime())) return '';
  return dayKey(d) === todayInZone() ? text('Today at {time}', { time: timeLabel(stamp) }) : `${dateLabel(stamp)} · ${timeLabel(stamp)}`;
}

export function MessageView(p: MessageViewProps) {
  const { msgRef: ref } = p;
  const qc = useQueryClient();
  const { openInWindow, navigate } = useTab();
  const [ai, setAi] = useState<{ task: TextTask; title: string; lang?: string } | null>(null);
  const [source, setSource] = useState(false);
  const [menu, setMenu] = useState<'top' | 'bottom' | 'move' | 'label' | 'translate' | null>(null);
  const topMore = useRef<HTMLButtonElement>(null);
  const bottomMore = useRef<HTMLButtonElement>(null);
  const moveBtn = useRef<HTMLButtonElement>(null);
  const labelBtn = useRef<HTMLButtonElement>(null);
  const translateBtn = useRef<HTMLButtonElement>(null);
  const me = useStore(app, (s) => s.bootstrap?.user ?? null);
  const origin = useStore(app, (s) => s.auth?.server?.origin ?? '');
  const darkTheme = useStore(app, (s) => s.resolvedTheme === 'dark');
  const q = useQuery({
    queryKey: ['mail', 'message', ref.mailbox, ref.folder, ref.uid],
    queryFn: ({ signal }) => apiGetMeta<MessageDetail>(`/api/mail/messages/${ref.uid}`, withMailbox({ folder: ref.folder }, ref.mailbox), signal),
  });
  const m = q.data?.data;
  const clean = useMemo(() => (m ? sanitizeMailHtml(m.body_html) : null), [m]);
  const context = useMessageContext(ref, m?.from_email ?? null, !!m && !p.offline);
  const folders = useFolders(Number(ref.mailbox ?? 0), !!ref.mailbox && menu === 'move');
  const labels = useLabels(p.localStore && menu === 'label');
  // Opening a message reads it: the list's dot and the counts follow.
  useEffect(() => {
    if (q.isSuccess && !q.data.offline) {
      void qc.invalidateQueries({ queryKey: ['mail', 'messages'] });
      void qc.invalidateQueries({ queryKey: ['mail', 'views'] });
    }
  }, [q.isSuccess, q.data?.offline, qc]);

  const zoom = p.prefs.zoom ?? 100;
  const act = async (action: MessageActionName) => {
    if (!m) return;
    if (action === 'archive' && p.archiveTo) {
      // A combined view archives into the message's own account (WF-DO14); an account with no Archive folder asks once.
      const asked = p.archiveTo(ref);
      const to = asked instanceof Promise ? await asked : asked;
      if (to === null) return;
      if (to !== 'default') return void move(to.slug, to.name);
    }
    try {
      const outcome = await messageAction(ref, action, m.subject);
      void qc.invalidateQueries({ queryKey: ['mail'] });
      void qc.invalidateQueries({ queryKey: ['offline'] });
      const leaves = action === 'archive' || action === 'trash' || action === 'spam' || action === 'inbox';
      if (outcome === 'queued') toast('info', text('Offline — this happens when you reconnect. Undo it in Waiting to send.'));
      else toast('success', action === 'archive' ? text('Archived.') : action === 'trash' ? text('Moved to Trash.') : action === 'spam' ? text('Reported as spam.') : action === 'unread' ? text('Marked as unread.') : text('Done.'));
      if (leaves || action === 'unread') p.onGone();
    } catch (e) {
      toast('error', errorMessage(e));
    }
  };
  const move = async (slug: string, name: string) => {
    if (!m) return;
    try {
      const outcome = slug === 'archive' || slug === 'spam' || slug === 'inbox' || slug === 'trash' ? await messageAction(ref, slug, m.subject) : await moveMessage(ref, slug, name, m.subject);
      void qc.invalidateQueries({ queryKey: ['mail'] });
      void qc.invalidateQueries({ queryKey: ['offline'] });
      toast(outcome === 'queued' ? 'info' : 'success', outcome === 'queued' ? text('Offline — the move happens when you reconnect.') : text('Moved to {folder}.', { folder: name }));
      p.onGone();
    } catch (e) {
      toast('error', errorMessage(e));
    }
  };
  const print = () => {
    if (!m || !clean) return;
    const html = `<h2 style="font-family:sans-serif">${escapeHtml(m.subject)}</h2><p style="font-family:sans-serif;color:#555">${escapeHtml(text('From'))} ${escapeHtml(m.from_name)} &lt;${escapeHtml(m.from_email)}&gt;<br>${escapeHtml(text('To'))} ${escapeHtml(m.to.join(', '))}<br>${escapeHtml(dateLabel(m.created_at))} ${escapeHtml(timeLabel(m.created_at))}</p><hr>${clean.html}`;
    void call('print:print', { html, title: m.subject || text('Email') }).catch((e) => toast('error', errorMessage(e)));
  };
  const downloadOriginal = () =>
    void call('transfers:download', { mailSource: { uid: ref.uid, folder: ref.folder, mailbox: ref.mailbox }, name: `${(m?.subject || 'message').replace(/[^\w .-]+/g, '').slice(0, 60).trim() || 'message'}.eml` })
      .then(() => toast('info', text('Downloading the original…')))
      .catch((e) => toast('error', errorMessage(e)));
  const copy = (value: string, done: string) => void navigator.clipboard.writeText(value).then(() => toast('success', done), () => toast('error', text('Could not copy.')));
  const quote = m && clean ? `\n\nOn ${dateLabel(m.created_at)} ${m.from_name || m.from_email} wrote:\n> ${plainText(clean.html).split('\n').slice(0, 40).join('\n> ')}` : '';
  const reply = (mode: ComposeSeed['mode']) => {
    if (!m) return;
    if (mode === 'forward') return p.onReply({ mode, subject: /^fwd?:/i.test(m.subject) ? m.subject : `Fwd: ${m.subject}`, quote, mailbox: ref.mailbox });
    const others = mode === 'reply_all' ? [m.from_email, ...m.to].filter((a, i, all) => a && all.indexOf(a) === i && a.toLowerCase() !== (p.account?.email ?? '').toLowerCase()) : [m.from_email];
    p.onReply({ mode, to: others.join(', '), cc: mode === 'reply_all' ? m.cc.join(', ') : undefined, subject: re(m.subject), quote, inReplyTo: m.message_id, mailbox: ref.mailbox });
  };
  const addContact = async () => {
    if (!m) return;
    const c = context.data?.sender;
    if (c?.contact_id) return navigate(`/contacts?open=${c.contact_id}`);
    try {
      await apiPost('/api/contacts', { display_name: m.from_name || m.from_email, work_email: m.from_email });
      void qc.invalidateQueries({ queryKey: ['mail', 'context'] });
      toast('success', text('{name} is in your contacts.', { name: m.from_name || m.from_email }));
    } catch (e) {
      toast('error', errorMessage(e));
    }
  };
  const block = async () => {
    if (!m) return;
    try {
      await apiPost('/api/mail/rules/sender', { email: m.from_email, action: 'block', ...(ref.mailbox ? { mailbox: ref.mailbox } : {}) });
      toast('success', text('Mail from {email} now goes to Spam.', { email: m.from_email }));
    } catch (e) {
      toast('error', errorMessage(e));
    }
  };
  const saveNote = async () => {
    if (!m || !clean) return;
    try {
      const r = await apiPost<{ id: number }>('/api/notes', { title: m.subject || text('Email'), body: `<p><b>${escapeHtml(m.from_name || m.from_email)}</b> &lt;${escapeHtml(m.from_email)}&gt; · ${escapeHtml(dateLabel(m.created_at))}</p><hr>${clean.html}` });
      toast('success', text('Saved as a note.'));
      if (r?.id) navigate(`/notes?note=${r.id}`);
    } catch (e) {
      toast('error', errorMessage(e));
    }
  };
  /** A link to this message that re-opens it for anyone with access (MAIL-RD-07): the web's own address for it. */
  const copyLink = () => {
    const q = new URLSearchParams({ msg: ref.uid, folder: ref.folder });
    if (ref.mailbox) q.set('mailbox', ref.mailbox);
    copy(`${origin}/mail?${q}`, text('Link copied.'));
  };
  /** The whole message into Files as a .eml (D13): an ordinary file of yours, apart from the mail. */
  const saveToFiles = async () => {
    if (!m) return;
    try {
      const r = await apiPost<{ id: number; name: string }>(`/api/mail/messages/${ref.uid}/save`, { folder: ref.folder, subject: m.subject, ...(ref.mailbox ? { mailbox: ref.mailbox } : {}) }, { folder: ref.folder });
      toast('success', text('Saved to Files as {name}.', { name: r?.name ?? '.eml' }));
    } catch (e) {
      toast('error', errorMessage(e));
    }
  };
  /** A meeting with the sender now: a colleague is rung; anybody else gets the invitation in a reply to send. */
  const startMeeting = async () => {
    if (!m) return;
    try {
      const meeting = await createMeeting({ title: text('Meeting · {subject}', { subject: m.subject || m.from_name || m.from_email }).slice(0, 190) });
      const colleague = context.data?.sender?.user_id ?? null;
      if (colleague) await apiPost(`/api/meet/${meeting.uuid}/ring`, { user_ids: [colleague] }).catch(() => undefined);
      await openMeeting(meeting.uuid, meeting.title);
      if (!colleague) {
        p.onReply({ mode: 'reply', to: m.from_email, subject: re(m.subject), body: invitation(meeting, me?.name ?? null), inReplyTo: m.message_id, mailbox: ref.mailbox });
        toast('info', text('The meeting is open. Send the invitation in the reply.'));
      } else toast('success', text('The meeting is open; {name} is being called.', { name: m.from_name || m.from_email }));
    } catch (e) {
      toast('error', errorMessage(e));
    }
  };
  const remind = async () => {
    if (!m) return;
    const tomorrow = new Date(Date.parse(`${todayInZone()}T12:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
    try {
      const r = await createTask({ title: text('Follow up: {subject}', { subject: m.subject || text('(no subject)') }).slice(0, 190), due_date: tomorrow, description: text('Email from {sender} <{email}>', { sender: m.from_name || m.from_email, email: m.from_email }) });
      toast('success', r.queued ? text('Offline — the reminder is added when you reconnect.') : text('A task reminds you tomorrow.'));
    } catch (e) {
      toast('error', errorMessage(e));
    }
  };

  // The page's shortcuts act on this message.
  const { onControls } = p;
  useEffect(() => {
    onControls?.({ act: (a) => void act(a === 'star' && m?.is_starred ? 'unstar' : a), reply });
    return () => onControls?.(null);
  });
  const { onLoaded } = p;
  useEffect(() => {
    if (m) onLoaded?.(m.subject, m.from_name || m.from_email);
  }, [m, onLoaded]);
  const replied = useRef(false);
  useEffect(() => {
    if (p.autoReply && m && clean && !replied.current) {
      replied.current = true;
      reply('reply');
    }
  });

  if (q.isLoading) return <Spinner />;
  if (q.error) return <div className="p-6"><ErrorNote error={q.error} onRetry={() => void q.refetch()} /></div>;
  if (!m || !clean) return null;

  const fromCache = !!q.data?.offline;
  // Dark email content (Settings › Reading) in the dark theme — but a designed email keeps its light card (D10).
  const darkBody = darkTheme && p.prefs.darkBody === true && !isDesignedMail(clean.html);
  const security = securityVerdict(context.data?.security);
  const folderChip = folderName(m && ref.folder.startsWith('label:') ? ref.folder.slice(6) : ref.folder === 'inbox' ? text('Inbox') : ref.folder.charAt(0).toUpperCase() + ref.folder.slice(1));
  // D13 (the reader's More) and D14 (the action bar's More).
  const moreItems = (where: 'top' | 'bottom'): MenuSection[] => {
    const keep: MenuItem[] = [];
    if (where === 'bottom' && canOpen('tasks')) keep.push({ id: 'remind', label: text('Remind me about this'), description: text('A task for tomorrow'), icon: 'bell', onSelect: () => void remind() });
    if (canOpen('notes')) keep.push({ id: 'note', label: text('Save as note'), icon: 'file-text', onSelect: () => void saveNote() });
    keep.push({ id: 'link', label: where === 'top' ? text('Copy link to email') : text('Copy link to this message'), icon: 'link', disabled: !origin, onSelect: copyLink });
    const copyItems: MenuItem[] = [
      { id: 'copy-sender', label: text('Copy sender address'), icon: 'copy', onSelect: () => copy(m.from_email, text('Address copied.')) },
      { id: 'window', label: text('Open in new window'), icon: 'app-window', shortcut: 'Shift ↵', onSelect: () => openInWindow(windowRoute(ref), m.subject) },
    ];
    const original: MenuItem[] = [
      { id: 'source', label: text('View original'), icon: 'external', disabled: p.offline, reason: text('Available when you are back online.'), onSelect: () => setSource(true) },
      { id: 'eml', label: text('Download original (.eml)'), icon: 'upload', disabled: p.offline, reason: text('Available when you are back online.'), onSelect: downloadOriginal },
      ...(where === 'top' && canOpen('files') ? [{ id: 'files', label: text('Save to Files'), icon: 'folder-input', disabled: p.offline || p.localStore, reason: p.offline ? text('Available when you are back online.') : text('Only mail from a connected mailbox is kept as an email file.'), onSelect: () => void saveToFiles() }] : []),
      ...(where === 'bottom' ? [{ id: 'print', label: text('Print'), icon: 'printer', shortcut: 'Ctrl P', onSelect: print }] : []),
    ];
    return [
      { id: 'keep', items: where === 'top' ? [...keep, ...copyItems] : keep },
      ...(where === 'bottom' ? [{ id: 'copy', items: copyItems }] : []),
      { id: 'original', items: original },
      {
        id: 'sender',
        items: [
          { id: 'contact', label: context.data?.sender?.contact_id ? text('Open sender in Contacts') : text('Add sender to contacts'), icon: 'user-plus', disabled: !canOpen('contacts') || p.offline, reason: text('Contacts is not available.'), onSelect: () => void addContact() },
          ...(where === 'top' ? [{ id: 'block', label: text('Block sender'), icon: 'warning', danger: true, disabled: p.offline, reason: text('Available when you are back online.'), onSelect: () => void block() }] : []),
        ],
      },
    ];
  };
  const moveSections: MenuSection[] = [
    {
      id: 'system',
      items: [
        { id: 'inbox', label: text('Inbox'), icon: 'inbox', disabled: ref.folder === 'inbox', onSelect: () => void move('inbox', text('Inbox')) },
        { id: 'archive', label: text('Archive'), icon: 'archive', disabled: ref.folder === 'archive', onSelect: () => void move('archive', text('Archive')) },
        { id: 'spam', label: text('Spam'), icon: 'spam', disabled: ref.folder === 'spam', onSelect: () => void move('spam', text('Spam')) },
      ],
    },
    {
      id: 'custom',
      label: text('Folders'),
      items: (folders.data?.folders ?? [])
        .filter((f) => f.slug.startsWith('label:') && f.slug !== ref.folder)
        .map((f) => ({ id: f.slug, label: folderName(f.name), icon: 'folder', onSelect: () => void move(f.slug, folderName(f.name)) })),
    },
  ];
  const labelSections: MenuSection[] = [
    {
      id: 'labels',
      label: text('Labels'),
      items: (labels.data?.labels ?? []).map((l) => {
        const on = !!m.labels?.some((x) => x.id === l.id);
        return {
          id: String(l.id),
          label: l.name,
          checked: on,
          onSelect: () =>
            void setLabel(ref.uid, l.id, !on)
              .then(() => qc.invalidateQueries({ queryKey: ['mail'] }))
              .catch((e) => toast('error', errorMessage(e))),
        };
      }),
    },
  ];
  const translate: MenuSection[] = [
    {
      id: 'to',
      label: text('Translate into'),
      items: ['English', 'Sinhala', 'Tamil'].map((l) => ({ id: l, label: text(l), onSelect: () => setAi({ task: 'translate', title: text('Translated into {language}', { language: text(l) }), lang: l }) })),
    },
  ];
  const toolbarStyle = p.prefs.toolbar ?? 'docked';

  return (
    <article aria-label={m.subject || text('(no subject)')} className="flex h-full min-h-0 flex-col bg-surface">
      <div role="toolbar" aria-label="Message" className="flex h-11 shrink-0 items-center gap-0.5 border-b border-line px-3">
        <button type="button" onClick={p.onBack} className="mr-2 inline-flex h-8 items-center gap-1.5 rounded-[8px] px-2 text-[13px] font-semibold text-ink hover:bg-subtle" title={text('Back to {folder} (Esc)', { folder: p.backLabel })}>
          <Icon name="back" size={16} />
          {p.backLabel}
        </button>
        <Tool icon="archive" label="Archive (E)" onClick={() => void act('archive')} />
        <Tool icon="mail" label="Mark as unread (U)" onClick={() => void act('unread')} />
        <Tool icon="trash" label="Delete (#)" onClick={() => void act('trash')} />
        <Tool icon="spam" label="Report spam (!)" onClick={() => void act('spam')} disabled={ref.folder === 'spam'} />
        <Tool ref={moveBtn} icon="folder-input" label="Move to (V)" onClick={() => setMenu('move')} disabled={!ref.mailbox && !p.localStore} />
        {p.localStore ? <Tool ref={labelBtn} icon="tag" label="Label" onClick={() => setMenu('label')} /> : null}
        <Tool icon="printer" label="Print" onClick={print} />
        <Tool icon="download" label="Download original (.eml)" onClick={downloadOriginal} disabled={p.offline} />
        <Tool ref={topMore} icon="more" label="More" onClick={() => setMenu('top')} />
        <span className="flex-1" />
        <Tool icon="zoom-out" label="Zoom out" onClick={() => p.onPrefs({ zoom: Math.max(75, zoom - 10) })} disabled={zoom <= 75} />
        <Tool icon="zoom-in" label="Zoom in" onClick={() => p.onPrefs({ zoom: Math.min(200, zoom + 10) })} disabled={zoom >= 200} />
        <Tool icon={p.focus ? 'fullscreen-exit' : 'fullscreen'} label={p.focus ? 'Show the list' : 'Read full width'} onClick={p.onFocus} active={p.focus} />
        <Tool icon={p.prefs.pane === 'bottom' ? 'layout-strip' : 'layout-side'} label={p.prefs.pane === 'bottom' ? 'Reading pane below — put it on the right' : 'Reading pane on the right — put it below'} onClick={() => p.onPrefs({ pane: p.prefs.pane === 'bottom' ? 'right' : 'bottom' })} active />
        <Tool icon="chevron-left" label="Previous (K)" onClick={() => p.onPrev?.()} disabled={!p.onPrev} />
        <Tool icon="chevron-right" label="Next (J)" onClick={() => p.onNext?.()} disabled={!p.onNext} />
      </div>
      <div className="flex min-h-0 flex-1 flex-col">
        <header className="max-h-[45%] shrink-0 overflow-y-auto border-b border-line px-6 pt-4 pb-4 scroll-thin">
          <h2 className="text-[21px] font-bold leading-tight text-ink selectable">{m.subject || text('(no subject)')}</h2>
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <Chip className="border border-line bg-surface">
              <Icon name="inbox" size={12} />
              {folderChip}
            </Chip>
            {security ? (
              <span title={security.title}>
                <Chip tone={security.tone}>
                  <Icon name={security.tone === 'success' ? 'shield-check' : 'shield-alert'} size={12} />
                  {security.label}
                </Chip>
              </span>
            ) : null}
            {p.account ? <Chip tone="indigo">{p.account.account_type === 'local_mailbox' ? text('WorkSuite Local') : p.account.shared ? p.account.email : p.account.provider_label ?? p.account.email}</Chip> : null}
            {m.labels?.map((l) => <Chip key={l.id}>{l.name}</Chip>)}
          </div>
          <div className="mt-3 flex items-start gap-3">
            <Avatar name={m.from_name || m.from_email} size={42} />
            <div className="min-w-0 flex-1 text-[13.5px]">
              <div className="truncate font-bold text-ink selectable">{m.from_name || m.from_email}</div>
              <div className="truncate text-ink-2 selectable">{m.from_email}</div>
              <div className="truncate text-[12.5px] text-ink-3 selectable">
                {text('to {list}', { list: m.to.join(', ') })}
                {m.cc.length ? ` · ${text('cc {list}', { list: m.cc.join(', ') })}` : ''}
              </div>
              {fromCache ? (
                <div className="mt-0.5 text-[12px] font-semibold text-success">
                  <Icon name="check" size={12} className="mr-1 inline" />
                  Saved on this computer
                </div>
              ) : null}
            </div>
            <div className="flex shrink-0 flex-col items-end gap-1.5">
              <div className="flex items-center gap-0.5">
                <Tool icon="star" label={m.is_starred ? 'Unstar (S)' : 'Star (S)'} onClick={() => void act(m.is_starred ? 'unstar' : 'star')} active={m.is_starred} fill={m.is_starred} />
                {p.localStore ? <Tool icon="flag" label={m.is_important ? 'Not important' : 'Mark important'} onClick={() => void act(m.is_important ? 'unimportant' : 'important')} active={!!m.is_important} /> : null}
                {canOpen('tasks') ? <Tool icon="bell" label="Remind me about this" onClick={() => void remind()} /> : null}
                <Tool icon="code" label="View original" onClick={() => setSource(true)} disabled={p.offline} />
              </div>
              <span className="text-[12.5px] text-ink-3">{whenLabel(m.created_at)}</span>
              <div className="flex items-center gap-0.5">
                {canOpen('contacts') ? <Tool icon="user-plus" label={context.data?.sender?.contact_id ? 'Open sender in Contacts' : 'Add sender to contacts'} onClick={() => void addContact()} disabled={p.offline} /> : null}
                {canOpen('meet') ? <Tool icon="video" label="Start a meeting with sender" onClick={() => void startMeeting()} disabled={p.offline} /> : null}
                <Tool icon="copy" label="Copy sender address" onClick={() => copy(m.from_email, text('Address copied.'))} />
              </div>
            </div>
          </div>
        </header>
        {m.team && ref.mailbox ? <TeamBar msgRef={ref} m={m} me={me ? Number(me.id) : null} /> : null}
        <div className="flex shrink-0 flex-wrap items-center gap-2 px-6 pt-4">
          <AiChip label="Summarise" onClick={() => setAi({ task: 'summarize', title: text('Summary of this email') })} />
          <AiChip label="Action items" onClick={() => setAi({ task: 'actions', title: text('Action items in this email') })} />
          <AiChip ref={translateBtn} label="Translate" onClick={() => setMenu('translate')} />
          {clean.blockedImages > 0 ? <span className="text-[12px] text-ink-3">{text(clean.blockedImages === 1 ? '1 remote image was blocked to protect your privacy.' : '{n} remote images were blocked to protect your privacy.', { n: clean.blockedImages })}</span> : null}
        </div>
        <iframe title={text('Message')} sandbox="allow-popups allow-popups-to-escape-sandbox" srcDoc={mailFrameDoc(clean.html, zoom, darkBody)} className={cx('mx-5 mt-3 min-h-[120px] flex-1 rounded-[8px] border-0', darkBody ? 'bg-surface' : 'bg-white', darkTheme && !darkBody && 'p-2')} />
        {m.attachments.length ? <Attachments m={m} msgRef={ref} offline={p.offline} /> : null}
        {m.team && ref.mailbox && m.conversation_key ? <TeamWork msgRef={ref} m={m} account={p.account} offline={p.offline} /> : null}
      </div>
      <ActionBar style={toolbarStyle} onReply={reply} onArchive={() => void act('archive')} onDelete={() => void act('trash')} moreRef={bottomMore} onMore={() => setMenu('bottom')} onMove={() => setMenu('move')} onUnread={() => void act('unread')} onStar={() => void act(m.is_starred ? 'unstar' : 'star')} starred={m.is_starred} canMove={!!ref.mailbox || p.localStore} />
      {menu === 'top' ? <Menu sections={moreItems('top')} label={text('More')} anchor={topMore} prefer="bottom" align="end" onClose={() => setMenu(null)} /> : null}
      {menu === 'bottom' ? <Menu sections={moreItems('bottom')} label={text('More')} anchor={bottomMore} prefer="top" align="end" onClose={() => setMenu(null)} /> : null}
      {menu === 'move' ? <Menu sections={moveSections} label={text('Move to')} anchor={moveBtn} prefer="bottom" align="start" onClose={() => setMenu(null)} /> : null}
      {menu === 'label' ? <Menu sections={labelSections} label={text('Label')} anchor={labelBtn} prefer="bottom" align="start" onClose={() => setMenu(null)} /> : null}
      {menu === 'translate' ? <Menu sections={translate} label={text('Translate')} anchor={translateBtn} prefer="bottom" align="start" width={220} onClose={() => setMenu(null)} /> : null}
      {ai ? (
        <AiTextDialog
          title={ai.title}
          task={ai.task}
          input={() => {
            const body = `From: ${m.from_name} <${m.from_email}>\nTo: ${m.to.join(', ')}\nSubject: ${m.subject}\nDate: ${dateLabel(m.created_at)}\n\n${plainText(clean.html)}`;
            return ai.task === 'translate' ? `${ai.lang ?? 'English'}\n${body}` : body;
          }}
          actions={[{ label: text('Copy'), icon: 'copy', primary: true, run: (t) => void navigator.clipboard.writeText(t).then(() => toast('success', text('Copied.'))) }]}
          onClose={() => setAi(null)}
        />
      ) : null}
      {source ? <SourceDialog msgRef={ref} onClose={() => setSource(false)} /> : null}
    </article>
  );
}

/** The route that opens one message on its own (a window, a tab). */
export function windowRoute(ref: MessageRef): string {
  const q = new URLSearchParams({ folder: ref.folder, msg: ref.uid });
  if (ref.mailbox) {
    q.set('mbx', ref.mailbox);
    q.set('box', ref.mailbox);
  }
  return `/mail?${q}`;
}

const Tool = ({ ref, icon, label, onClick, disabled, active, fill }: { ref?: React.Ref<HTMLButtonElement>; icon: string; label: string; onClick: () => void; disabled?: boolean; active?: boolean; fill?: boolean }) => (
  <button ref={ref} type="button" onClick={onClick} disabled={disabled} aria-label={label} title={label} aria-pressed={active} className={cx('inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-[8px] hover:bg-subtle disabled:opacity-40 disabled:hover:bg-transparent', active ? (fill ? 'text-warning' : 'bg-selection text-primary') : 'text-ink-2')}>
    <Icon name={icon} size={17} className={fill ? 'fill-current' : undefined} />
  </button>
);

const AiChip = ({ ref, label, onClick }: { ref?: React.Ref<HTMLButtonElement>; label: string; onClick: () => void }) => (
  <button ref={ref} type="button" onClick={onClick} className="inline-flex h-8 items-center gap-1.5 rounded-[8px] border border-line bg-selection px-3 text-[12.5px] font-semibold text-primary hover:border-primary">
    <Icon name="sparkles" size={14} />
    {label}
  </button>
);

function ActionBar({ style, onReply, onArchive, onDelete, onMove, onUnread, onStar, starred, onMore, moreRef, canMove }: { style: NonNullable<MailPrefs['toolbar']>; onReply: (mode: ComposeSeed['mode']) => void; onArchive: () => void; onDelete: () => void; onMove: () => void; onUnread: () => void; onStar: () => void; starred: boolean; onMore: () => void; moreRef: React.Ref<HTMLButtonElement>; canMove: boolean }) {
  const labelled = style === 'docked';
  const btn = (icon: string, label: string, run: () => void, show = true, extra?: string): ReactNode =>
    show ? (
      <button type="button" onClick={run} aria-label={label} title={label} className={cx('inline-flex h-9 shrink-0 items-center gap-1.5 rounded-[8px] px-2.5 text-[13.5px] font-semibold text-ink hover:bg-subtle', extra)}>
        <Icon name={icon} size={16} className={icon === 'star' && starred ? 'fill-current text-warning' : undefined} />
        {labelled && ['reply-all', 'forward', 'archive', 'trash'].includes(icon) ? <span>{label}</span> : null}
      </button>
    ) : null;
  const reply = (
    <Button variant="primary" icon="reply" onClick={() => onReply('reply')} title={text('Reply (R)')}>
      Reply
    </Button>
  );
  const more = (
    <button ref={moreRef} type="button" onClick={onMore} aria-label="More actions" title="More actions" className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-[8px] text-ink-2 hover:bg-subtle">
      <Icon name="more" size={17} />
    </button>
  );
  if (style === 'floating') {
    return (
      <div className="pointer-events-none relative h-0">
        <div role="toolbar" aria-label="Reply and actions" className="pointer-events-auto absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-0.5 rounded-full border border-line bg-surface px-1.5 py-1 shadow-[0_6px_24px_rgb(var(--ws-shadow-rgb)/0.16)]">
          {reply}
          {btn('reply-all', text('Reply all'), () => onReply('reply_all'))}
          {btn('forward', text('Forward'), () => onReply('forward'))}
          {btn('archive', text('Archive'), onArchive)}
          {btn('trash', text('Delete'), onDelete)}
          {btn('folder-input', text('Move to'), onMove, canMove)}
          {btn('star', starred ? text('Unstar') : text('Star'), onStar)}
          {more}
        </div>
      </div>
    );
  }
  return (
    <div role="toolbar" aria-label="Reply and actions" className="flex h-[54px] shrink-0 items-center gap-0.5 border-t border-line px-3">
      {reply}
      {btn('reply-all', text('Reply all'), () => onReply('reply_all'))}
      {btn('forward', text('Forward'), () => onReply('forward'))}
      {style !== 'minimal' ? (
        <>
          <span className="mx-1.5 h-5 w-px bg-line" />
          {btn('archive', text('Archive'), onArchive)}
          {btn('trash', text('Delete'), onDelete)}
          {btn('folder-input', text('Move to'), onMove, canMove)}
          {btn('mail', text('Mark as unread'), onUnread)}
          {btn('star', starred ? text('Unstar') : text('Star'), onStar)}
        </>
      ) : null}
      <span className="flex-1" />
      {more}
    </div>
  );
}

function Attachments({ m, msgRef, offline }: { m: MessageDetail; msgRef: MessageRef; offline: boolean }) {
  const { uid, folder, mailbox } = msgRef;
  /** "Save to Files" (MAIL-RD-03): the server copies it into the person's Files; nothing goes through this computer. */
  const save = async (a: MessageDetail['attachments'][number]) => {
    try {
      await apiPost(`/api/mail/messages/${uid}/attachments/${encodeURIComponent(a.ref)}/save`, mailbox ? { mailbox } : {}, { folder, mime: a.mime || 'application/octet-stream', ...(mailbox ? { mailbox } : {}) });
      toast('success', text('{name} is in your Files.', { name: a.name }));
    } catch (e) {
      toast('error', errorMessage(e));
    }
  };
  return (
    <div className="flex max-h-[30%] shrink-0 flex-col gap-2 overflow-y-auto border-t border-line px-6 py-3 scroll-thin">
      {m.attachments.map((a) => {
        const size = `${Math.max(1, Math.round(a.size / 1024))} KB`;
        if (offline) {
          return (
            <div key={a.ref} className="flex items-center gap-3 rounded-[10px] border border-dashed border-line px-3 py-2.5 text-[13px]">
              <FileBadge name={a.name} />
              <span className="min-w-0 truncate">
                <span className="font-semibold text-ink">{a.name}</span>
                <span className="text-ink-3"> · {size} · {text('not downloaded — available when you’re back online')}</span>
              </span>
            </div>
          );
        }
        return (
          <div key={a.ref} className="flex w-full max-w-[560px] items-center gap-1">
          <button
            type="button"
            draggable
            onClick={() =>
              // A PDF opens in PDF Studio, preview only (PDF-OPEN-004); a Word, Excel or PowerPoint file in a
              // WorkSuite DOC / Sheet / Slides tab; anything else downloads and opens.
              isPdf(a)
                ? openPdf({ kind: 'mail', uid: String(uid), ref: a.ref, folder, mailbox: mailbox ?? null, name: a.name }, a.name)
                : isOfficeFile(a.name)
                  ? openInOffice({ kind: 'api', name: a.name, path: `/api/mail/messages/${uid}/attachments/${encodeURIComponent(a.ref)}?${new URLSearchParams({ folder, dl: '1', ...(mailbox ? { mailbox } : {}) })}` })
                  : void call('transfers:download', { mail: { uid, ref: a.ref, folder, mailbox }, name: a.name, open: true })
                      .then(() => toast('info', text('Downloading {name}…', { name: a.name })))
                      .catch((e) => toast('error', errorMessage(e)))
            }
            className="flex w-full max-w-[520px] items-center gap-3 rounded-[10px] border border-line px-3 py-2 text-left hover:bg-subtle"
            title={isPdf(a) ? text('Open in PDF Studio') : text('Download and open')}
          >
            <FileBadge name={a.name} />
            <span className="min-w-0">
              <span className="block truncate text-[13px] font-semibold text-ink">{a.name}</span>
              <span className="block text-[11.5px] text-ink-3">
                {size} · {isPdf(a) ? text('open') : text('download')}
              </span>
            </span>
          </button>
          {canOpen('files') ? (
            <button type="button" onClick={() => void save(a)} aria-label={text('Save {name} to Files', { name: a.name })} title={text('Save to Files')} className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-[8px] text-ink-2 hover:bg-subtle">
              <Icon name="folder-input" size={16} />
            </button>
          ) : null}
          </div>
        );
      })}
    </div>
  );
}

/** The original as the server holds it, headers and all — read-only text, never rendered. */
function SourceDialog({ msgRef, onClose }: { msgRef: MessageRef; onClose: () => void }) {
  const q = useQuery({
    queryKey: ['mail', 'source', msgRef.mailbox, msgRef.folder, msgRef.uid],
    queryFn: () => apiGet<{ source: string }>(`/api/mail/messages/${msgRef.uid}/source`, withMailbox({ folder: msgRef.folder }, msgRef.mailbox)),
    retry: false,
  });
  return (
    <Modal title={text('Original message')} labelledBy="mail-source-title" width={860} onClose={onClose} footer={<Button onClick={onClose}>Close</Button>}>
      <div className="p-4">
        {q.isLoading ? <Spinner /> : q.error ? <ErrorNote error={q.error} /> : <pre className="max-h-[60vh] overflow-auto rounded-[8px] bg-subtle p-3 font-mono text-[12px] leading-relaxed whitespace-pre-wrap text-ink selectable">{q.data?.source}</pre>}
      </div>
    </Modal>
  );
}
