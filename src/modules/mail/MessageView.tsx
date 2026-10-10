import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { canOpen } from '../../core/access';
import { apiGet, apiGetMeta, apiPost, withMailbox } from '../../core/api';
import { app } from '../../core/app-state';
import { call, errorMessage, on } from '../../core/bridge';
import { text } from '../../core/i18n';
import { isOfficeFile, openInOffice } from '../../core/open-document';
import { officeOpenKind } from '@shared/office-open';
import { OpenWithButton, openOfficeDoc, type OfficeDoc } from '../office/open-with';
import { useStore } from '../../core/store';
import { attachmentRisk } from '@shared/attachments';
import { ticketRoute } from '@shared/support';
import { useTab } from '../../core/tab-context';
import { bytes, dateLabel, dayKey, parseTs, timeLabel, todayInZone } from '../../core/time';
import { toast } from '../../core/toasts';
import { Icon } from '../../components/Icon';
import { Menu, type MenuItem, type MenuSection } from '../../components/Menu';
import { Avatar, Button, Chip, ErrorNote, FileBadge, Modal, Spinner, cx } from '../../components/ui';
import { AiTextDialog } from '../ai/AiTextDialog';
import { InviteCard, hasInvite } from './InviteCard';
import { WorkSuiteCard, openFromMail, workSuiteMailItem } from './WorkSuiteCard';
import { CollapsedHeader, MessageHeader, ownAddresses, useNarrow, type HeaderTool } from './MessageHeader';
import { findCrmRecord } from './quickSteps';
import type { TextTask } from '../ai/textTools';
import { openPdf } from '../pdf/open';
import { createTask } from '../tasks/actions';
import { createMeeting, invitation, openMeeting } from '../meet/api';
import { ConvertEmailSheet } from '../support/ConvertEmailSheet';
import { TicketChip, useConversionOffer } from '../support/ConvertSheet';
import { emailToConvert, markTicket } from './ticketLinks';
import { junkMessage, messageAction, moveMessage, setLabel, useFolders, useLabels, useMessageContext, type MessageActionName } from './api';
import { scanAttachment, useMessageProtection, protectionKeys } from './protection/api';
import { attachmentGate, bannerFor, protectionView, type AttachmentAccess } from './protection/verdicts';
import { VerdictBanner } from './protection/VerdictBanner';
import { LockedAttachment, ScanChip } from './protection/AttachmentChip';
import { registerReaderLinks, tagLinkFrames } from './protection/linkContext';
import { messageKey, seedMessage } from './localFirst';
import { authFailed, folderName, headerDensity, plainText, securityVerdict } from './model';
import { blockedImageUrls, escapeHtml, highlightText, mailFrameDoc, sanitizeMailHtml, withLoadedImages, withProxiedImages } from './sanitize';
import { readingBody, withSenderTheme } from './bodyLook';
import { linkPictures, parsePictureLink, plainBodyText } from './readable';
import { useAppColours } from './useAppColours';
import { MailImageViewer } from './ImageViewer';
import type { MailLinkClick } from '@shared/mail-files';
import { emailDomain, imageVerdict, isJunkFolder, ownDomains, readableName, trustedBy, withTrusted } from './images';
import { ImageNotice } from './ImageNotice';
import { attachmentKind } from '@shared/mail-media';
import { TeamBar, TeamWork } from './Team';
import { CategoryChip } from './parts';
import { TaskFromMessage, meetingRoute, messageLink } from './MessageTask';
import { AddContactDialog, parseSignature, type SignatureGuess } from './AddContact';
import { ImmersiveReader } from './ImmersiveReader';
import { AppsPane } from './AppsPane';
import { LinkRecordDialog, LinkedRecordChips, type LinkItem } from './recordLinks';
import { MarkerChips, RecallDialog, ReceiptBar, ReportDialog, SmimeChip, VoteBar, VoteTally, sendReceipt } from './MessageExtras';
import type { ComposeSeed, MailPrefs, Mailbox, MessageContext, MessageDetail, MessageRef, MessageRow } from './types';
import { identityQuery, lookupProblem, problemDetails, problemTitle, type MovedTo } from './messageLookup';

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
  /** Start a reply as soon as the message is here (a notification's Reply; the list's Reply all and Forward). */
  autoReply?: boolean | ComposeSeed['mode'];
  /** The message arrived: its tab can be named (a message opened from a link is not in the list). */
  onLoaded?: (subject: string, from: string) => void;
  /**
   * Where Archive puts it, from a combined view (DMO-ALL-11): the account's
   * own Archive ('default'), a folder chosen for an account without one, or
   * null when the person cancelled.
   */
  /** The Quick Steps gallery in the Classic command bar (DMO-QS, O-UI-02). */
  quickStepButtons?: Array<{ id: number; name: string; icon: string; run: () => void }>;
  /** Pin, Snooze, Flag, Categorize and Focused for this message (the list's right-click menu). */
  stateMenu?: () => MenuSection[];
  /** The row as the list knows it, with WorkSuite's states on it. */
  marks?: MessageRow | null;
  archiveTo?: (ref: MessageRef) => Promise<{ slug: string; name: string } | 'default' | null> | 'default';
  /** The server found the message somewhere else (moved, or renumbered): open it there (#209). */
  onRelocated?: (to: MessageRef, folderName: string | null) => void;
  /** The message is gone at the server: take it off the list (#209). */
  onMissing?: () => void;
  /** Settings › Mail › Accounts, for an account whose sign-in failed. */
  onFixAccount?: () => void;
  /** Ask the server for this folder's list again. */
  onRefreshFolder?: () => void;
  /** All Accounts or another view of several accounts: the header shows which account the message came to (#212). */
  combined?: boolean;
  /** The header's folder badge: open the folder the message is in (#212). */
  onOpenFolder?: (ref: MessageRef) => void;
  /** Delete as the list does (worksuite-desktop#235): gone at once, one "Deleted · Undo", batched, the full lookup. */
  onDelete?: () => void;
}

export interface ViewControls {
  act: (action: 'archive' | 'trash' | 'spam' | 'star' | 'unread' | 'read') => void;
  /** Open the Move menu, or the find-in-message bar (DMO-SRC-06). */
  menu: (which: 'move' | 'find') => void;
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
  const [linking, setLinking] = useState(false);
  // Report phishing or junk, recall (ENH-MAIL-03 DMO-SEC-02, DMO-CMP-10), and Convert to ticket (#298).
  const [extra, setExtra] = useState<'phishing' | 'junk' | 'recall' | 'task' | 'ticket' | null>(null);
  // Convert to ticket: for somebody with Support, where the server converts email and lets them (#298).
  const supportApp = canOpen('support');
  const ticketOffer = useConversionOffer('email', supportApp);
  const [contactGuess, setContactGuess] = useState<SignatureGuess | null>(null);
  const [receiptAnswered, setReceiptAnswered] = useState<string | null>(null);
  const [menu, setMenu] = useState<'top' | 'bottom' | 'move' | 'label' | 'translate' | 'states' | null>(null);
  const statesBtn = useRef<HTMLButtonElement>(null);
  // Find in this message (DMO-SRC-06): matches are highlighted in the body.
  const [find, setFind] = useState<string | null>(null);
  const topMore = useRef<HTMLButtonElement>(null);
  const bottomMore = useRef<HTMLButtonElement>(null);
  const moveBtn = useRef<HTMLButtonElement>(null);
  const labelBtn = useRef<HTMLButtonElement>(null);
  const translateBtn = useRef<HTMLButtonElement>(null);
  // The header (#212): narrow under 560px of pane; a 48px bar once scrolled away.
  const [narrow, measureColumn] = useNarrow(560);
  // The toolbar too tight for the folder's name beside its buttons: just ← (#287).
  const [tightBar, measureBar] = useNarrow(720);
  const scroller = useRef<HTMLDivElement>(null);
  const headerBox = useRef<HTMLDivElement>(null);
  const [collapsed, setCollapsed] = useState(false);
  const onReaderScroll = () => {
    const top = scroller.current?.scrollTop ?? 0;
    const tall = headerBox.current?.offsetHeight ?? 0;
    setCollapsed(top > Math.max(16, tall - 48));
  };
  const toTop = () => {
    const el = scroller.current;
    if (!el) return;
    if (typeof el.scrollTo === 'function') el.scrollTo({ top: 0 });
    else el.scrollTop = 0;
    setCollapsed(false);
  };
  const me =useStore(app, (s) => s.bootstrap?.user ?? null);
  const origin = useStore(app, (s) => s.auth?.server?.origin ?? '');
  // The app's colours, light and dark, read again when the theme or the colour profile changes (#287).
  const colours = useAppColours();
  // Mark as read (DMO-INB-12): when opened (the server does it), after N seconds, when moving on, or never.
  const markRead = p.prefs.markRead ?? 'open';
  // Retry runs the whole lookup at the server — by Message-ID in this folder, then the account's others — not the same request (#209).
  const locate = useRef(false);
  const q = useQuery({
    queryKey: messageKey(ref),
    queryFn: ({ signal }) =>
      apiGetMeta<MessageDetail & { moved?: MovedTo | null }>(`/api/mail/messages/${ref.uid}`, withMailbox({ folder: ref.folder, ...identityQuery(ref, locate.current), ...(markRead !== 'open' ? { peek: 1 } : {}) }, ref.mailbox), signal),
  });
  const retryLookup = () => {
    locate.current = true;
    void q.refetch();
  };
  const networkOffline = useStore(app, (s) => s.status?.network === 'OFFLINE');
  // Found somewhere else: the reader follows it there, and the list drops the old row (#209).
  const moved = (q.data?.data as { moved?: MovedTo | null } | undefined)?.moved ?? null;
  const onRelocated = p.onRelocated;
  useEffect(() => {
    if (!moved) return;
    const to: MessageRef = { ...ref, uid: String(moved.uid), folder: moved.folder };
    qc.setQueryData(messageKey(to), q.data);
    onRelocated?.(to, moved.name ?? null);
    // Once per answer that says it moved.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [moved?.folder, moved?.uid]);
  const problem = q.error ? lookupProblem(q.error, networkOffline || p.offline) : null;
  const onMissing = p.onMissing;
  useEffect(() => {
    if (problem === 'gone') onMissing?.();
  }, [problem, onMissing]);
  // Opened or fetched ahead before: shown from this computer at once, while the server is asked (worksuite-desktop#162).
  const refKey = `${ref.mailbox ?? ''}:${ref.folder}:${ref.uid}`;
  // eslint-disable-next-line react-hooks/exhaustive-deps -- the message is named by refKey; the object is new each render
  useEffect(() => void seedMessage(qc, ref, markRead !== 'open'), [qc, refKey, markRead]);
  const m = q.data?.data;
  const clean = useMemo(() => (m ? sanitizeMailHtml(m.body_html) : null), [m]);
  // Plain text (DMO-RD-09): asked for on this message, or always for this sender.
  const plainSenders = p.prefs.plainTextSenders ?? [];
  const [plainAsked, setPlainAsked] = useState<boolean | null>(null);
  const plainSender = !!m && plainSenders.includes(m.from_email.toLowerCase());
  const plainOn = plainAsked ?? plainSender;
  const plainBody = useMemo(() => (clean ? plainText(clean.html) : ''), [clean]);
  const [immersive, setImmersive] = useState(false);
  /*
   * Read comfortably, and dark when the app is (#287): plain text as paragraphs with its links, quoted replies and
   * long signatures folded, and the look decided for this email — Settings › Mail › Appearance & reading › Show emails
   * in dark mode, or the sender's ☀ / 🌙 in the header.
   */
  const bodySetting = p.prefs.bodyTheme ?? 'auto';
  const senderTheme = (m && p.prefs.bodyThemeSenders?.[m.from_email.toLowerCase()]) || null;
  const reading = useMemo(
    () =>
      m && clean
        ? readingBody({ raw: m.body_html, html: clean.html, styles: clean.styles, remoteImages: clean.remoteImages, plain: plainOn ? plainBody : plainBodyText(clean.html), appDark: colours.appDark, setting: bodySetting, sender: senderTheme, light: colours.light, dark: colours.dark })
        : null,
    [m, clean, plainOn, plainBody, colours, bodySetting, senderTheme],
  );
  const found = useMemo(() => highlightText(reading?.html ?? '', find ?? ''), [reading, find]);
  const context = useMessageContext(ref, m?.from_email ?? null, !!m && !p.offline);
  /*
   * Mail protection (ENH-MAIL-04): the message's verdict, its banner and each attachment's scan. Offline, a message
   * this computer has no verdict for shows Checking with its files locked until online; a clean verdict kept here
   * keeps working (MPR-UX-07). A server without the protection service: nothing changes.
   */
  const prot = useMessageProtection(ref, !!m);
  const offlineNow = p.offline || networkOffline;
  const pv = protectionView(prot.data, { offline: offlineNow, failed: !!prot.error });
  // Asked and not answered yet, online: no banner (it would flicker), but nothing opens before the answer either.
  const protPending = prot.isPending && !offlineNow;
  /*
   * Pictures from the web (DMO-SEC-07, DMO-RD-02, #163): Settings › Mail › Images & media decides — Always, Ask,
   * Only from trusted senders, Never — and they never load on their own in Junk or in mail that failed its
   * authentication checks. Allowed pictures come through WorkSuite's image proxy into the local mail store, so
   * they show at once next time and offline; tracking pixels were removed when the body was cleaned.
   */
  const [picturesAsked, setPicturesAsked] = useState(false);
  const boxEmails = p.boxes.map((b) => b.email).join(',');
  const own = useMemo(() => ownDomains([...boxEmails.split(','), me?.email]), [boxEmails, me?.email]);
  const verdict = imageVerdict({
    mode: p.prefs.remoteImages ?? 'ask',
    remote: clean?.blockedImages ?? 0,
    trusted: m ? trustedBy(m.from_email, p.prefs, own) : null,
    // Junk, Phish and Spoof keep their pictures blocked, whatever the setting (MPR-UX-03).
    junk: isJunkFolder(ref.folder) || !!pv.protection?.images_blocked,
    authFailed: authFailed(context.data?.security),
    pending: !p.offline && !context.isFetched,
    asked: picturesAsked,
  });
  const imageUrls = useMemo(() => (clean ? blockedImageUrls(clean) : []), [clean]);
  const pictures = useQuery({
    queryKey: ['mail', 'images', ref.mailbox, ref.folder, ref.uid, p.offline],
    queryFn: async () => {
      try {
        const r = await call('mail:images', { urls: imageUrls, mailbox: ref.mailbox ?? null, fetch: !p.offline });
        return { enabled: r.enabled, images: r.images, links: {} as Record<string, string> };
      } catch {
        // Not in the desktop shell (a test, an older shell): the signed proxy links, straight from the server.
        const r = await apiPost<{ enabled: boolean; links: Record<string, string> }>('/api/mail/image-links', { urls: imageUrls });
        return { enabled: r.enabled, images: {} as Record<string, string>, links: r.links ?? {} };
      }
    },
    enabled: verdict.load && imageUrls.length > 0,
    staleTime: 30 * 60_000,
  });
  const shownHtml = useMemo(() => {
    if (plainOn || !clean || !pictures.data?.enabled) return found.html;
    const kept = withLoadedImages(found.html, clean.remoteImages, pictures.data.images);
    return origin ? withProxiedImages(kept, clean.remoteImages, pictures.data.links, origin) : kept;
  }, [pictures.data, found.html, origin, clean, plainOn]);
  // Pictures shown in the body open in the image viewer (#287): the frame hands a click back by this reader's id.
  const [frameId] = useState(() => (globalThis.crypto?.randomUUID?.() ?? `${Math.random()}${Date.now()}`).replace(/[^a-z0-9]/gi, '').slice(0, 16));
  const framed = useMemo(() => {
    const f = linkPictures(shownHtml, frameId, origin);
    // Each link names this reader, so the click-time check knows its message (P-UI-12).
    return { ...f, html: tagLinkFrames(f.html, frameId) };
  }, [shownHtml, frameId, origin]);
  // Links in Junk, Phish and Spoof mail are shown as text: every click stops on the warning first (MPR-UX-04).
  const linksAsText = !!pv.protection?.links_as_text;
  const linkVerdict = pv.protection?.verdict ?? null;
  useEffect(() => registerReaderLinks(frameId, { message: ref.uid, linksAsText, verdict: linkVerdict }), [frameId, ref.uid, linksAsText, linkVerdict]);
  const [viewing, setViewing] = useState<number | null>(null);
  useEffect(
    () =>
      on<MailLinkClick>('mail:link', (link) => {
        const hit = parsePictureLink(link.url);
        if (hit && hit.frame === frameId) setViewing(hit.index);
      }),
    [frameId],
  );
  const folders = useFolders(Number(ref.mailbox ?? 0), !!ref.mailbox && menu === 'move');
  const labels = useLabels(p.localStore && menu === 'label');
  // Opening a message reads it: the list's dot and the counts follow.
  useEffect(() => {
    if (q.isSuccess && !q.data.offline && !q.data.local && !q.data.peeked) {
      void qc.invalidateQueries({ queryKey: ['mail', 'messages'] });
      void qc.invalidateQueries({ queryKey: ['mail', 'views'] });
    }
  }, [q.isSuccess, q.data?.offline, q.data?.local, q.data?.peeked, qc]);
  const unreadNow = !!m && m.is_read === false;
  const subjectNow = m?.subject ?? '';
  // Fetched ahead (peek), then opened with "mark as read when opened": the server has not marked it, so this does.
  const peekedUnread = unreadNow && markRead === 'open' && !!q.data?.peeked && !q.data.local;
  const markedOnOpen = useRef<string | null>(null);
  useEffect(() => {
    if (!peekedUnread || markedOnOpen.current === refKey) return;
    markedOnOpen.current = refKey;
    void messageAction(ref, 'read', subjectNow)
      .then(() => {
        void qc.invalidateQueries({ queryKey: ['mail', 'messages'] });
        void qc.invalidateQueries({ queryKey: ['mail', 'views'] });
      })
      .catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per message (refKey), not per render
  }, [peekedUnread, refKey, subjectNow, qc]);
  const delay = Math.max(0, Math.min(30, p.prefs.markReadDelay ?? 5));
  useEffect(() => {
    if (!unreadNow || (markRead !== 'delay' && markRead !== 'change')) return;
    const read = () => void messageAction(ref, 'read', subjectNow).then(() => qc.invalidateQueries({ queryKey: ['mail', 'messages'] })).catch(() => undefined);
    if (markRead === 'delay') {
      const t = setTimeout(read, delay * 1000);
      return () => clearTimeout(t);
    }
    // When the selection changes: on leaving this message.
    return read;
  }, [unreadNow, markRead, delay, ref, subjectNow, qc]);

  const zoom = p.prefs.zoom ?? 100;
  const act = async (action: MessageActionName) => {
    if (!m) return;
    if (action === 'trash' && p.onDelete) return p.onDelete();
    if (action === 'archive' && p.archiveTo) {
      // A combined view archives into the message's own account (WF-DO14); an account with no Archive folder asks once.
      const asked = p.archiveTo(ref);
      const to = asked instanceof Promise ? await asked : asked;
      if (to === null) return;
      if (to !== 'default') return void move(to.slug, to.name);
    }
    // Junk and Not junk teach the filter (MPR-UX-06, MPR-TRN): the protection calls, the plain move on an older server.
    if (action === 'spam' || (action === 'inbox' && isJunkFolder(ref.folder))) return markJunk(action === 'spam' ? 'junk' : 'not_junk');
    try {
      const outcome = await messageAction(ref, action, m.subject);
      void qc.invalidateQueries({ queryKey: ['mail'] });
      void qc.invalidateQueries({ queryKey: ['offline'] });
      const leaves = action === 'archive' || action === 'trash' || action === 'inbox';
      if (outcome === 'queued') toast('info', text('Offline — this happens when you reconnect. Undo it in Waiting to send.'));
      else toast('success', action === 'archive' ? text('Archived.') : action === 'trash' ? text('Moved to Trash.') : action === 'unread' ? text('Marked as unread.') : text('Done.'));
      if (leaves || action === 'unread') p.onGone();
    } catch (e) {
      toast('error', errorMessage(e));
    }
  };
  const markJunk = async (kind: 'junk' | 'not_junk') => {
    if (!m) return;
    try {
      const r = await junkMessage(ref, kind, m.subject);
      void qc.invalidateQueries({ queryKey: ['mail'] });
      void qc.invalidateQueries({ queryKey: ['offline'] });
      const trust = () =>
        void apiPost('/api/mail/protection/lists/me', { kind: 'allow', value: m.from_email.toLowerCase() })
          .then(() => toast('success', text('{email} is on your safe senders. Viruses and phishing are still checked.', { email: m.from_email })))
          .catch((e) => toast('error', errorMessage(e)));
      if (r.outcome === 'queued') toast('info', text('Offline — this happens when you reconnect. Undo it in Waiting to send.'));
      else if (kind === 'not_junk' && r.offerTrust) toast('success', text('Moved to the Inbox.'), { label: text('Always trust sender'), run: trust });
      else toast('success', kind === 'junk' ? text('Moved to Junk. The filter learns from it.') : text('Moved to the Inbox.'));
      p.onGone();
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
    const html = `<h2 style="font-family:sans-serif">${escapeHtml(m.subject)}</h2><p style="font-family:sans-serif;color:#555">${escapeHtml(text('From'))} ${escapeHtml(m.from_name)} &lt;${escapeHtml(m.from_email)}&gt;<br>${escapeHtml(text('To'))} ${escapeHtml(m.to.join(', '))}<br>${escapeHtml(dateLabel(m.created_at))} ${escapeHtml(timeLabel(m.created_at))}</p><hr>${sanitizeMailHtml(m.body_html, { safeLinks: false }).html}`;
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
    p.onReply({ mode, to: others.join(', '), cc: mode === 'reply_all' ? m.cc.join(', ') : undefined, subject: re(m.subject), quote, inReplyTo: m.message_id, mailbox: ref.mailbox, source: ref });
  };
  const addContact = async () => {
    if (!m) return;
    const c = context.data?.sender;
    if (c?.contact_id) return navigate(`/contacts?open=${c.contact_id}`);
    // Filled from the signature, for review (DMO-PPL-04).
    setContactGuess(parseSignature(clean ? plainText(clean.html) : '', m.from_name, m.from_email));
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
      const r = await apiPost<{ id: number }>('/api/notes', { title: m.subject || text('Email'), body: `<p><b>${escapeHtml(m.from_name || m.from_email)}</b> &lt;${escapeHtml(m.from_email)}&gt; · ${escapeHtml(dateLabel(m.created_at))}</p><hr>${sanitizeMailHtml(m.body_html, { safeLinks: false }).html}` });
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
  /** A direct chat with a colleague, from the people card. */
  const chatWith = async (userId: number) => {
    try {
      const r = await apiPost<{ room_id: number }>('/api/chat/rooms/direct', { user_id: userId });
      navigate(`/chat?room=${r.room_id}`);
    } catch (e) {
      toast('error', errorMessage(e));
    }
  };
  /** The sender's lead or account in CRM, from the people card (#212). */
  const viewInCrm = async () => {
    if (!m) return;
    try {
      const found = await findCrmRecord(m.from_email);
      if (found) navigate(found.kind === 'lead' ? `/crm?lead=${found.record.id}` : `/crm?account=${found.record.id}`);
      else toast('info', text('{email} is not a lead or account in CRM.', { email: m.from_email }));
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
    onControls?.({ act: (a) => void act(a === 'star' && m?.is_starred ? 'unstar' : a), reply, menu: (w) => (w === 'move' ? setMenu('move') : setFind((f) => f ?? '')) });
    return () => onControls?.(null);
  });
  const { onLoaded } = p;
  useEffect(() => {
    if (m) onLoaded?.(m.subject, m.from_name || m.from_email);
  }, [m, onLoaded]);
  // A read-receipt request answered by the person's setting (DMO-CMP-11): always — sent once per message on this computer.
  const receiptTo = context.data?.markers?.read_receipt_to ?? null;
  const receiptsPref = p.prefs.readReceipts ?? 'ask';
  useEffect(() => {
    if (!m || !receiptTo || receiptsPref !== 'always' || ref.folder === 'sent' || p.offline) return;
    const key = `mail-receipt:${m.message_id}`;
    try {
      if (sessionStorage.getItem(key)) return;
      sessionStorage.setItem(key, '1');
    } catch {
      return;
    }
    void sendReceipt(receiptTo, m.subject, ref.mailbox ?? null).catch(() => undefined);
  }, [m, receiptTo, receiptsPref, ref.folder, ref.mailbox, p.offline]);
  const replied = useRef(false);
  useEffect(() => {
    if (p.autoReply && m && clean && !replied.current) {
      replied.current = true;
      reply(p.autoReply === true ? 'reply' : p.autoReply);
    }
  });

  if (q.isLoading) return <MessagePending row={p.marks ?? null} />;
  if (q.error && problem)
    return <MessageProblem problem={problem} error={q.error} msgRef={ref} row={p.marks ?? null} retrying={q.isFetching} onRetry={retryLookup} onFixAccount={p.onFixAccount} onRefreshFolder={p.onRefreshFolder} />;
  if (!m || !clean) return null;

  const fromCache = !!q.data?.offline;
  // The ticket this email became (#298): its chip opens it, and the actions say View ticket instead of Convert.
  const ticket = m.support_ticket ?? null;
  const openTicket = supportApp && ticket ? () => navigate(ticketRoute(ticket.id)) : undefined;
  const ticketItem = (): MenuItem | null =>
    ticket && openTicket
      ? { id: 'ticket', label: text('View ticket {ref}', { ref: ticket.reference }), icon: 'life-buoy', onSelect: openTicket }
      : !ticket && ticketOffer === 'yes'
        ? { id: 'ticket', label: text('Convert to ticket…'), description: text('A Support ticket from this email'), icon: 'life-buoy', disabled: p.offline, reason: text('Available when you are back online.'), onSelect: () => setExtra('ticket') }
        : null;
  const linkItem: LinkItem = { mailbox: ref.mailbox ? Number(ref.mailbox) : 0, folder: ref.folder, uid: String(ref.uid), subject: m.subject, from_name: m.from_name ?? undefined, from_email: m.from_email, received_at: m.created_at, ...(m.message_id ? { message_id: m.message_id } : {}) };
  // ☀ View in light / 🌙 View in dark (#287): while the app is dark, or this email is; remembered for the sender.
  const bodyDark = !!reading && reading.look.scheme !== 'light';
  const bodySwitch =
    reading && (colours.appDark || bodyDark)
      ? { dark: bodyDark, onToggle: () => p.onPrefs({ bodyThemeSenders: withSenderTheme(p.prefs.bodyThemeSenders, m.from_email, bodyDark ? 'light' : 'dark', reading.automatic) }) }
      : undefined;
  const security = securityVerdict(context.data?.security);
  // The verdict banner (P-UI-10) and what each attachment may do (P-UI-11).
  const banner = pv.protection && !pv.unavailable && (!protPending || offlineNow) ? bannerFor(pv.protection, { name: m.from_name || null, email: m.from_email }) : null;
  const gate = pv.unavailable ? null : attachmentGate(pv.protection, m.attachments, pv.waitingOnline);
  const scannable = gate ? m.attachments.flatMap((a) => (gate.get(a.ref)?.status === 'unscanned' ? [{ ref: a.ref, access: gate.get(a.ref)! }] : [])) : [];
  const inJunk = isJunkFolder(ref.folder);
  const outsider = senderNotice(m.from_email, p.account?.email ?? null, context.data ?? null);
  // A WorkSuite notification email's item (#170): a card above the body, and Open in WorkSuite by Reply — verified mail only.
  const wsMail = workSuiteMailItem(m.from_email, context.data);
  const folderChip = folderName(m && ref.folder.startsWith('label:') ? ref.folder.slice(6) : ref.folder === 'inbox' ? text('Inbox') : ref.folder.charAt(0).toUpperCase() + ref.folder.slice(1));
  // D13 (the reader's More) and D14 (the action bar's More).
  const moreItems = (where: 'top' | 'bottom'): MenuSection[] => {
    const keep: MenuItem[] = [];
    if (canOpen('calendar')) keep.push({ id: 'meeting', label: text('Reply with meeting'), description: text('A Calendar event with everyone on this email'), icon: 'calendar', disabled: p.offline, onSelect: () => navigate(meetingRoute(m, p.account?.email ?? null, messageLink(ref))) });
    if (canOpen('tasks')) keep.push({ id: 'task', label: text('Create task…'), description: text('With assignee, list and due date'), icon: 'list-todo', onSelect: () => setExtra('task') });
    const toTicket = ticketItem();
    if (toTicket) keep.push(toTicket);
    if (where === 'bottom' && canOpen('tasks')) keep.push({ id: 'remind', label: text('Remind me about this'), description: text('A task for tomorrow'), icon: 'bell', onSelect: () => void remind() });
    if (canOpen('tenders') || canOpen('crm')) keep.push({ id: 'link-record', label: text('Link to tender, customer or deal…'), icon: 'link', disabled: p.offline, reason: text('Available when you are back online.'), onSelect: () => setLinking(true) });
    if (canOpen('notes')) keep.push({ id: 'note', label: text('Save as note'), icon: 'file-text', onSelect: () => void saveNote() });
    // Reading (DMO-RD-04, DMO-RD-09).
    keep.push({ id: 'immersive', label: text('Immersive reader'), icon: 'book-open', onSelect: () => setImmersive(true) });
    keep.push({ id: 'plain', label: plainOn ? text('Show as HTML') : text('Show as plain text'), icon: 'file-text', onSelect: () => setPlainAsked(!plainOn) });
    keep.push({
      id: 'plain-sender',
      label: plainSender ? text('Stop showing plain text from {email}', { email: m.from_email }) : text('Always show plain text from {email}', { email: m.from_email }),
      icon: 'file-text',
      onSelect: () => {
        const me = m.from_email.toLowerCase();
        p.onPrefs({ plainTextSenders: plainSender ? plainSenders.filter((x) => x !== me) : [...plainSenders.filter((x) => x !== me), me].slice(-500) });
        setPlainAsked(null);
      },
    });
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
      {
        id: 'report',
        items: [
          { id: 'phishing', label: text('Report phishing'), icon: 'shield-alert', danger: true, disabled: p.offline || !ref.mailbox, reason: p.offline ? text('Available when you are back online.') : text('Only mail from a connected mailbox can be reported.'), onSelect: () => setExtra('phishing') },
          { id: 'junk', label: text('Report junk'), icon: 'spam', disabled: p.offline || !ref.mailbox || ref.folder === 'spam', reason: p.offline ? text('Available when you are back online.') : text('Only mail from a connected mailbox can be reported.'), onSelect: () => setExtra('junk') },
          ...(ref.folder === 'sent' ? [{ id: 'recall', label: text('Recall this message…'), icon: 'undo', disabled: p.offline || !m.message_id, reason: text('Available when you are back online.'), onSelect: () => setExtra('recall') }] : []),
        ],
      },
    ];
  };
  // The header's ⋯ (#212): what used to be its six buttons, and the rest of what is done to one email.
  const offlineReason = text('Available when you are back online.');
  const headerIcons = p.prefs.headerIcons === 'more';
  const headerMore: MenuSection[] = [
    {
      id: 'follow',
      label: text('Follow up'),
      items: [
        ...(canOpen('tasks') ? [{ id: 'remind', label: text('Remind me about this'), description: text('A task for tomorrow'), icon: 'bell', onSelect: () => void remind() }] : []),
        ...(p.stateMenu ? [{ id: 'flag', label: text('Flag, pin or snooze…'), icon: 'flag', onSelect: () => setMenu('states') }] : []),
        ...(p.localStore ? [{ id: 'important', label: m.is_important ? text('Not important') : text('Mark important'), icon: 'flag', onSelect: () => void act(m.is_important ? 'unimportant' : 'important') }] : []),
        ...[ticketItem()].filter((x): x is MenuItem => x !== null),
      ],
    },
    {
      id: 'sender',
      label: text('Sender'),
      items: [
        { id: 'contact', label: context.data?.sender?.contact_id ? text('Open sender in Contacts') : text('Add sender to contacts'), icon: 'user-plus', disabled: !canOpen('contacts') || p.offline, reason: p.offline ? offlineReason : text('Contacts is not available.'), onSelect: () => void addContact() },
        { id: 'meeting', label: text('Create meeting with sender'), icon: 'video', disabled: !canOpen('meet') || p.offline, reason: p.offline ? offlineReason : text('Meet is not available.'), onSelect: () => void startMeeting() },
        { id: 'new-email', label: text('New email to sender'), icon: 'compose', onSelect: () => p.onReply({ mode: 'new', to: m.from_email, mailbox: ref.mailbox }) },
      ],
    },
    {
      id: 'copy',
      label: text('Copy'),
      items: [
        { id: 'copy-link', label: text('Copy link'), icon: 'link', disabled: !origin, onSelect: copyLink },
        { id: 'copy-address', label: text('Copy sender address'), icon: 'copy', onSelect: () => copy(m.from_email, text('Address copied.')) },
        { id: 'copy-subject', label: text('Copy subject'), icon: 'copy', onSelect: () => copy(m.subject, text('Subject copied.')) },
      ],
    },
    {
      id: 'original',
      items: [
        { id: 'source', label: text('View source'), icon: 'code', disabled: p.offline, reason: offlineReason, onSelect: () => setSource(true) },
        { id: 'print', label: text('Print'), icon: 'printer', shortcut: 'Ctrl P', onSelect: print },
        { id: 'eml', label: text('Download .eml'), icon: 'download', disabled: p.offline, reason: offlineReason, onSelect: downloadOriginal },
      ],
    },
    {
      id: 'layout',
      items: [{ id: 'header-icons', label: text('Show more buttons in the header'), checked: headerIcons, onSelect: () => p.onPrefs({ headerIcons: headerIcons ? 'few' : 'more' }) }],
    },
  ];
  const extraTools: HeaderTool[] = headerIcons
    ? [
        ...(canOpen('tasks') ? [{ id: 'remind', icon: 'bell', label: text('Remind me about this'), onClick: () => void remind() }] : []),
        ...(canOpen('contacts') ? [{ id: 'contact', icon: 'user-plus', label: context.data?.sender?.contact_id ? text('Open sender in Contacts') : text('Add sender to contacts'), onClick: () => void addContact(), disabled: p.offline }] : []),
        ...(canOpen('meet') ? [{ id: 'meeting', icon: 'video', label: text('Create meeting with sender'), onClick: () => void startMeeting(), disabled: p.offline }] : []),
        { id: 'source', icon: 'code', label: text('View source'), onClick: () => setSource(true), disabled: p.offline },
        { id: 'print', icon: 'printer', label: text('Print this email'), onClick: print },
      ]
    : [];
  const headerChips = (
    <>
      <MarkerChips markers={context.data?.markers} />
      {context.data?.markers?.smime === 'signed' && !p.offline ? <SmimeChip msgRef={ref} from={m.from_email} mailbox={ref.mailbox ?? null} /> : null}
      {context.data?.markers?.smime === 'encrypted' ? <Chip tone="warning">{text('Encrypted (S/MIME)')}</Chip> : null}
      {p.marks?.pinned ? (
        <Chip tone="indigo">
          <Icon name="pin" size={12} />
          {text('Pinned')}
        </Chip>
      ) : null}
      {p.marks?.flag ? (
        <Chip tone={p.marks.flag.completed_at ? 'success' : 'danger'}>
          <Icon name={p.marks.flag.completed_at ? 'check' : 'flag'} size={12} />
          {p.marks.flag.completed_at ? text('Flag complete') : p.marks.flag.due_at ? text('Due {when}', { when: whenLabel(p.marks.flag.due_at) }) : text('Flagged')}
        </Chip>
      ) : null}
      {p.marks?.categories?.map((c) => <CategoryChip key={c.id} name={c.name} colour={c.colour} />)}
      {m.labels?.map((l) => <Chip key={l.id}>{l.name}</Chip>)}
      {canOpen('tenders') || canOpen('crm') ? <LinkedRecordChips item={linkItem} navigate={navigate} offline={p.offline} /> : null}
      {ticket ? <TicketChip ticket={ticket} onOpen={openTicket} /> : null}
    </>
  );
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
      <div ref={measureBar} role="toolbar" aria-label="Message" className="flex h-11 shrink-0 items-center gap-0.5 border-b border-line px-3">
        {/* "← All Accounts · Inbox" on one line, cut short with … as the pane narrows; tight, just ← with the name as its tooltip (#287). */}
        <button
          type="button"
          onClick={p.onBack}
          data-breadcrumb={tightBar ? 'icon' : 'label'}
          aria-label={text('Back to {folder}', { folder: p.backLabel })}
          title={text('Back to {folder} (Esc)', { folder: p.backLabel })}
          className={cx('mr-2 inline-flex h-8 items-center gap-1.5 whitespace-nowrap rounded-[8px] px-2 text-[13px] font-semibold text-ink hover:bg-subtle', tightBar ? 'shrink-0' : 'min-w-[44px] max-w-[260px] shrink')}
        >
          <Icon name="back" size={16} className="shrink-0" />
          {tightBar ? null : <span className="min-w-0 truncate">{p.backLabel}</span>}
        </button>
        <Tool icon="archive" label="Archive (E)" onClick={() => void act('archive')} />
        <Tool icon="mail" label="Mark as unread (U)" onClick={() => void act('unread')} />
        <Tool icon="trash" label="Delete (#)" onClick={() => void act('trash')} />
        {inJunk ? <Tool icon="inbox" label={text('Not junk (!)')} onClick={() => void markJunk('not_junk')} /> : <Tool icon="spam" label={text('Junk (!)')} onClick={() => void markJunk('junk')} />}
        <Tool ref={moveBtn} icon="folder-input" label="Move to (V)" onClick={() => setMenu('move')} disabled={!ref.mailbox && !p.localStore} />
        {p.localStore ? <Tool ref={labelBtn} icon="tag" label="Label" onClick={() => setMenu('label')} /> : null}
        {p.stateMenu ? <Tool ref={statesBtn} icon="snooze" label={text('Pin, snooze, flag or categorize')} onClick={() => setMenu('states')} /> : null}
        <Tool icon="printer" label="Print" onClick={print} />
        <Tool icon="download" label="Download original (.eml)" onClick={downloadOriginal} disabled={p.offline} />
        <Tool ref={topMore} icon="more" label="More" onClick={() => setMenu('top')} />
        <Tool icon={p.prefs.appsPane ? 'panel-right-close' : 'panel-right-open'} label={p.prefs.appsPane ? text('Hide the Apps pane') : text('Apps: CRM, tasks, helpdesk and notes for this message')} onClick={() => p.onPrefs({ appsPane: !p.prefs.appsPane })} active={!!p.prefs.appsPane} />
        <span className="flex-1" />
        <Tool icon="zoom-out" label="Zoom out" onClick={() => p.onPrefs({ zoom: Math.max(75, zoom - 10) })} disabled={zoom <= 75} />
        <Tool icon="zoom-in" label="Zoom in" onClick={() => p.onPrefs({ zoom: Math.min(200, zoom + 10) })} disabled={zoom >= 200} />
        <Tool icon={p.focus ? 'fullscreen-exit' : 'fullscreen'} label={p.focus ? 'Show the list' : 'Read full width'} onClick={p.onFocus} active={p.focus} />
        <Tool icon={p.prefs.pane === 'bottom' ? 'layout-strip' : 'layout-side'} label={p.prefs.pane === 'bottom' ? 'Reading pane below — put it on the right' : 'Reading pane on the right — put it below'} onClick={() => p.onPrefs({ pane: p.prefs.pane === 'bottom' ? 'right' : 'bottom' })} active />
        <Tool icon="chevron-left" label="Previous (K)" onClick={() => p.onPrev?.()} disabled={!p.onPrev} />
        <Tool icon="chevron-right" label="Next (J)" onClick={() => p.onNext?.()} disabled={!p.onNext} />
      </div>
      {p.prefs.commandBar === 'classic' ? (
        <ClassicBar
          groups={[
            { id: 'new', label: text('New'), items: [{ id: 'new', icon: 'compose', label: text('New email'), run: () => p.onReply({ mode: 'new' }) }] },
            { id: 'delete', label: text('Delete'), items: [{ id: 'trash', icon: 'trash', label: text('Delete'), run: () => void act('trash') }, { id: 'archive', icon: 'archive', label: text('Archive'), run: () => void act('archive') }, inJunk ? { id: 'notjunk', icon: 'inbox', label: text('Not junk'), run: () => void markJunk('not_junk') } : { id: 'spam', icon: 'spam', label: text('Junk'), run: () => void markJunk('junk') }] },
            { id: 'respond', label: text('Respond'), items: [{ id: 'reply', icon: 'reply', label: text('Reply'), run: () => reply('reply') }, { id: 'all', icon: 'reply-all', label: text('Reply all'), run: () => reply('reply_all') }, { id: 'fwd', icon: 'forward', label: text('Forward'), run: () => reply('forward') }] },
            ...(p.quickStepButtons?.length ? [{ id: 'qs', label: text('Quick Steps'), items: p.quickStepButtons.slice(0, 6).map((q) => ({ id: `qs${q.id}`, icon: q.icon, label: q.name, run: q.run })) }] : []),
            { id: 'move', label: text('Move'), items: [{ id: 'move', icon: 'folder-input', label: text('Move to'), run: () => setMenu('move'), disabled: !ref.mailbox && !p.localStore }] },
            ...(p.stateMenu ? [{ id: 'tags', label: text('Tags'), items: [{ id: 'tags', icon: 'tag', label: text('Flag, pin, snooze'), run: () => setMenu('states'), ref: statesBtn }] }] : []),
            { id: 'find', label: text('Find'), items: [{ id: 'find', icon: 'search', label: text('Find in message'), run: () => setFind((f) => f ?? '') }] },
          ]}
        />
      ) : null}
      <div className="flex min-h-0 flex-1">
      <div ref={measureColumn} className="flex min-h-0 min-w-0 flex-1 flex-col">
        <div ref={scroller} data-reader-scroll onScroll={onReaderScroll} className="relative min-h-0 flex-1 overflow-y-auto scroll-thin">
        <div className="sticky top-0 z-10 h-0">{collapsed ? <CollapsedHeader m={m} context={context.data ?? null} onTop={toTop} /> : null}</div>
        <div ref={headerBox}>
          <MessageHeader
            m={m}
            context={context.data ?? null}
            density={headerDensity(p.prefs.view)}
            narrow={narrow}
            security={security}
            external={outsider.external}
            folderLabel={folderChip}
            onOpenFolder={p.onOpenFolder ? () => p.onOpenFolder?.(ref) : undefined}
            account={p.account}
            combined={!!p.combined}
            mine={ownAddresses(p.boxes, p.account, me?.email)}
            fromCache={fromCache}
            chips={headerChips}
            person={{
              email: () => p.onReply({ mode: 'new', to: m.from_email, mailbox: ref.mailbox }),
              meet: canOpen('meet') && !p.offline ? () => void startMeeting() : undefined,
              addContact: canOpen('contacts') && !p.offline ? () => void addContact() : undefined,
              chat: canOpen('chat') && !p.offline ? (id) => void chatWith(id) : undefined,
              crm: canOpen('crm') && !p.offline ? () => void viewInCrm() : undefined,
            }}
            onCopyAddress={() => copy(m.from_email, text('Address copied.'))}
            onStar={() => void act(m.is_starred ? 'unstar' : 'star')}
            bodyTheme={bodySwitch}
            extraTools={extraTools}
            moreSections={headerMore}
          />
        </div>
        {banner && pv.protection ? (
          <VerdictBanner
            model={banner}
            protection={pv.protection}
            msgRef={ref}
            from={{ name: m.from_name || null, email: m.from_email }}
            subject={m.subject}
            offline={offlineNow}
            scannable={scannable}
            onHeaders={() => setSource(true)}
            onReportPhish={() => setExtra('phishing')}
            onGone={p.onGone}
            cachedNote={pv.fromCache && pv.waitingOnline ? text('Saved on this computer — checked again when you are back online.') : null}
          />
        ) : null}
        {security?.state === 'fail' && banner?.kind !== 'phish' && banner?.kind !== 'spoof' ? (
          <div role="alert" data-auth-warning className="mx-5 mt-3 flex items-start gap-2 rounded-[8px] border border-line bg-danger-bg px-3 py-2 text-[12.5px] text-danger">
            <Icon name="shield-alert" size={15} className="mt-px shrink-0" />
            <span>
              <span className="font-semibold">{text('This email failed its sender checks ({checks}).', { checks: security.checks })}</span>{' '}
              {text('It may not really be from {email}. Do not open its links or attachments, or reply with anything private, unless you expected it.', { email: m.from_email })}
            </span>
          </div>
        ) : null}
        {outsider.rare ? (
          <p role="note" className="mx-6 mt-3 rounded-[8px] bg-subtle px-3 py-1.5 text-[12.5px] text-ink-2">
            {text('You don’t often get email from {email}.', { email: m.from_email })}
          </p>
        ) : null}
        {context.data?.markers?.smime === 'encrypted' ? (
          <p role="note" className="mx-6 mt-3 rounded-[8px] bg-warning-bg px-3 py-1.5 text-[12.5px] text-warning">{text('This message is encrypted with S/MIME. WorkSuite keeps no private keys, so it cannot be opened here — open it in the mail app that holds your certificate.')}</p>
        ) : null}
        {context.data?.markers?.vote.length && ref.folder !== 'sent' ? (
          <VoteBar msgRef={ref} choices={context.data.markers.vote} subject={m.subject} onReply={(choice) => p.onReply({ mode: 'reply', to: m.from_email, subject: `${choice}: ${m.subject}`, body: choice, inReplyTo: m.message_id, mailbox: ref.mailbox })} />
        ) : null}
        {ref.folder === 'sent' && m.message_id && !p.offline ? <VoteTally messageId={m.message_id} /> : null}
        {receiptTo && receiptsPref === 'ask' && ref.folder !== 'sent' && receiptAnswered !== m.message_id && !p.offline ? (
          <ReceiptBar to={receiptTo} subject={m.subject} mailbox={ref.mailbox ?? null} onAnswered={() => setReceiptAnswered(m.message_id)} />
        ) : null}
        {m.team && ref.mailbox ? <TeamBar msgRef={ref} m={m} me={me ? Number(me.id) : null} /> : null}
        <div className="flex shrink-0 flex-wrap items-center gap-2 px-6 pt-4">
          <AiChip label="Summarise" onClick={() => setAi({ task: 'summarize', title: text('Summary of this email') })} />
          <AiChip label="Action items" onClick={() => setAi({ task: 'actions', title: text('Action items in this email') })} />
          <AiChip ref={translateBtn} label="Translate" onClick={() => setMenu('translate')} />
        </div>
        {!plainOn ? (
          <ImageNotice
            verdict={verdict}
            sender={m.from_email.toLowerCase()}
            trackers={clean.trackers}
            proxyOff={!!pictures.data && !pictures.data.enabled}
            offline={p.offline}
            onShow={() => setPicturesAsked(true)}
            onTrustSender={() => p.onPrefs({ imageSenders: withTrusted(p.prefs.imageSenders, m.from_email.toLowerCase()) })}
            onTrustDomain={() => p.onPrefs({ imageDomains: withTrusted(p.prefs.imageDomains, emailDomain(m.from_email)) })}
            onSettings={() => navigate('/settings/mail?tab=media')}
          />
        ) : null}
        {find !== null ? (
          <div role="search" aria-label={text('Find in message')} className="mx-5 mt-3 flex items-center gap-2 rounded-[8px] border border-line bg-subtle px-2 py-1 text-[12.5px]">
            <Icon name="search" size={13} className="text-ink-3" />
            <input autoFocus value={find} onChange={(e) => setFind(e.target.value)} onKeyDown={(e) => (e.key === 'Escape' ? setFind(null) : undefined)} aria-label={text('Find in message')} placeholder={text('Find in message')} className="bare-focus min-w-0 flex-1 bg-transparent text-ink outline-none" />
            <span aria-live="polite" className="text-ink-3">{find.trim().length > 1 ? text('{n} found', { n: found.count }) : ''}</span>
            <button type="button" aria-label={text('Close')} onClick={() => setFind(null)} className="text-ink-3 hover:text-ink"><Icon name="x" size={13} /></button>
          </div>
        ) : null}
        {hasInvite(m) ? <InviteCard msgRef={ref} offline={p.offline} /> : null}
        {wsMail ? <WorkSuiteCard mail={wsMail} offline={p.offline} /> : null}
        {/*
          The body fills the pane under the 48px bar once the header has scrolled away (#212). The frame is drawn in the
          pane's colour; a light email in the dark theme (or a dark one in the light theme) sits on a card inside it (#287).
        */}
        <div className="h-[calc(100%-48px)] min-h-[240px] px-5 pt-3 pb-2">
          {reading ? (
            <iframe
              title={text('Message')}
              sandbox="allow-popups allow-popups-to-escape-sandbox"
              srcDoc={mailFrameDoc(framed.html, zoom, reading.frame)}
              data-body-kind={reading.kind}
              data-body-scheme={reading.look.scheme}
              data-body-fallback={reading.look.fallback ? 'true' : undefined}
              style={{ colorScheme: reading.look.scheme === 'light' ? 'light' : 'dark' }}
              className="block h-full w-full border-0 bg-surface"
            />
          ) : null}
        </div>
        </div>
        {m.attachments.length ? <Attachments m={m} msgRef={ref} offline={p.offline} gate={gate} pending={protPending && !pv.unavailable} /> : null}
        {m.team && ref.mailbox && m.conversation_key ? <TeamWork msgRef={ref} m={m} account={p.account} offline={p.offline} /> : null}
      </div>
      {p.prefs.appsPane ? (
        <AppsPane
          m={m}
          link={messageLink(ref)}
          context={context.data}
          offline={p.offline}
          navigate={navigate}
          onCreateTask={() => setExtra('task')}
          onSaveNote={() => void saveNote()}
          onConvertTicket={() => setExtra('ticket')}
          onClose={() => p.onPrefs({ appsPane: false })}
        />
      ) : null}
      </div>
      <ActionBar style={toolbarStyle} junk={inJunk ? 'not_junk' : 'junk'} onJunk={(k) => void markJunk(k)} onReply={reply} onArchive={() => void act('archive')} onDelete={() => void act('trash')} moreRef={bottomMore} onMore={() => setMenu('bottom')} onMove={() => setMenu('move')} onUnread={() => void act('unread')} onStar={() => void act(m.is_starred ? 'unstar' : 'star')} starred={m.is_starred} canMove={!!ref.mailbox || p.localStore} onOpenInWorkSuite={wsMail?.verified ? () => openFromMail(wsMail.link, 'open', undefined) : undefined} />
      {menu === 'top' ? <Menu sections={moreItems('top')} label={text('More')} anchor={topMore} prefer="bottom" align="end" onClose={() => setMenu(null)} /> : null}
      {menu === 'bottom' ? <Menu sections={moreItems('bottom')} label={text('More')} anchor={bottomMore} prefer="top" align="end" onClose={() => setMenu(null)} /> : null}
      {menu === 'move' ? <Menu sections={moveSections} label={text('Move to')} anchor={moveBtn} prefer="bottom" align="start" onClose={() => setMenu(null)} /> : null}
      {menu === 'label' ? <Menu sections={labelSections} label={text('Label')} anchor={labelBtn} prefer="bottom" align="start" onClose={() => setMenu(null)} /> : null}
      {menu === 'states' && p.stateMenu ? <Menu sections={p.stateMenu()} label={text('Pin, snooze, flag or categorize')} anchor={statesBtn} prefer="bottom" align="start" width={260} onClose={() => setMenu(null)} /> : null}
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
      {extra === 'phishing' || extra === 'junk' ? (
        <ReportDialog kind={extra} msgRef={ref} from={m.from_email} subject={m.subject} canBlock={!!ref.mailbox} onDone={() => (setExtra(null), p.onGone())} onClose={() => setExtra(null)} />
      ) : null}
      {extra === 'recall' && m.message_id ? (
        <RecallDialog
          messageId={m.message_id}
          onReplace={() => p.onReply({ mode: 'new', to: m.to.join(', '), cc: m.cc.length ? m.cc.join(', ') : undefined, subject: m.subject, body: plainText(clean.html), mailbox: ref.mailbox })}
          onClose={() => setExtra(null)}
        />
      ) : null}
      {contactGuess ? (
        <AddContactDialog
          guess={contactGuess}
          email={m.from_email}
          onSaved={() => {
            setContactGuess(null);
            void qc.invalidateQueries({ queryKey: ['mail', 'context'] });
          }}
          onClose={() => setContactGuess(null)}
        />
      ) : null}
      {viewing !== null && framed.pictures[viewing] ? <MailImageViewer pictures={framed.pictures} start={viewing} onClose={() => setViewing(null)} /> : null}
      {immersive ? <ImmersiveReader subject={m.subject} from={m.from_name ? `${m.from_name} <${m.from_email}>` : m.from_email} plain={plainBody} prefs={p.prefs.immersive ?? {}} onPrefs={(v) => p.onPrefs({ immersive: v })} onClose={() => setImmersive(false)} /> : null}
      {extra === 'task' ? <TaskFromMessage message={m} msgRef={ref} onClose={() => setExtra(null)} /> : null}
      {extra === 'ticket' ? <ConvertEmailSheet email={emailToConvert(ref, m, context.data?.sender?.company)} onClose={() => setExtra(null)} onDone={(t) => markTicket(qc, ref, t)} /> : null}
      {linking ? <LinkRecordDialog items={[linkItem]} onClose={() => setLinking(false)} /> : null}
    </article>
  );
}

/** The route that opens one message on its own (a window, a tab). */
/**
 * External sender tag and first-time sender hint (ENH-MAIL-03 DMO-SEC-01):
 * external when the sender's domain is not the mailbox's and the sender is
 * not a colleague; rare when there is at most this one message from them.
 * Nothing is claimed until the context has answered.
 */
export function senderNotice(from: string, mailbox: string | null, ctx: Pick<MessageContext, 'sender' | 'history'> | null): { external: boolean; rare: boolean } {
  if (!ctx) return { external: false, rare: false };
  const domain = (a: string | null) => (a ?? '').toLowerCase().split('@')[1] ?? '';
  const external = !!mailbox && !!domain(from) && domain(from) !== domain(mailbox) && !ctx.sender?.is_colleague;
  const rare = !!ctx.history && ctx.history.total <= 1 && from.toLowerCase() !== (mailbox ?? '').toLowerCase();
  return { external, rare };
}

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

/**
 * The Classic command bar (DMO-SHL-03): grouped, labelled buttons — New,
 * Delete, Respond, Move, Tags, Find — under the Simplified one-row toolbar.
 */
export function ClassicBar({ groups }: { groups: Array<{ id: string; label: string; items: Array<{ id: string; icon: string; label: string; run: () => void; disabled?: boolean; ref?: React.Ref<HTMLButtonElement> }> }> }) {
  return (
    <div role="toolbar" aria-label={text('Commands')} className="flex shrink-0 items-stretch gap-0 overflow-x-auto border-b border-line bg-subtle px-2 py-1 scroll-thin">
      {groups.map((g) => (
        <div key={g.id} role="group" aria-label={g.label} className="flex flex-col items-center border-r border-line px-2 last:border-r-0">
          <div className="flex items-center gap-0.5">
            {g.items.map((it) => (
              <button key={it.id} ref={it.ref} type="button" onClick={it.run} disabled={it.disabled} className="flex h-12 min-w-[52px] flex-col items-center justify-center gap-0.5 rounded-[8px] px-1.5 text-[11.5px] font-semibold text-ink hover:bg-surface disabled:opacity-40">
                <Icon name={it.icon} size={17} />
                <span className="whitespace-nowrap">{it.label}</span>
              </button>
            ))}
          </div>
          <span className="text-[10.5px] text-ink-3">{g.label}</span>
        </div>
      ))}
    </div>
  );
}

const AiChip = ({ ref, label, onClick }: { ref?: React.Ref<HTMLButtonElement>; label: string; onClick: () => void }) => (
  <button ref={ref} type="button" onClick={onClick} className="inline-flex h-8 items-center gap-1.5 rounded-[8px] border border-line bg-selection px-3 text-[12.5px] font-semibold text-primary hover:border-primary">
    <Icon name="sparkles" size={14} />
    {label}
  </button>
);

function ActionBar({ style, junk, onJunk, onReply, onArchive, onDelete, onMove, onUnread, onStar, starred, onMore, moreRef, canMove, onOpenInWorkSuite }: { style: NonNullable<MailPrefs['toolbar']>; junk: 'junk' | 'not_junk'; onJunk: (kind: 'junk' | 'not_junk') => void; onReply: (mode: ComposeSeed['mode']) => void; onArchive: () => void; onDelete: () => void; onMove: () => void; onUnread: () => void; onStar: () => void; starred: boolean; onMore: () => void; moreRef: React.Ref<HTMLButtonElement>; canMove: boolean; onOpenInWorkSuite?: () => void }) {
  const labelled = style === 'docked';
  const btn = (icon: string, label: string, run: () => void, show = true, extra?: string): ReactNode =>
    show ? (
      <button type="button" onClick={run} aria-label={label} title={label} className={cx('inline-flex h-9 shrink-0 items-center gap-1.5 rounded-[8px] px-2.5 text-[13.5px] font-semibold text-ink hover:bg-subtle', extra)}>
        <Icon name={icon} size={16} className={icon === 'star' && starred ? 'fill-current text-warning' : undefined} />
        {labelled && ['reply-all', 'forward', 'archive', 'trash', 'spam', 'inbox'].includes(icon) ? <span>{label}</span> : null}
      </button>
    ) : null;
  const reply = (
    <Button variant="primary" icon="reply" onClick={() => onReply('reply')} title={text('Reply (R)')}>
      Reply
    </Button>
  );
  const openItem = onOpenInWorkSuite ? (
    <Button icon="external" onClick={onOpenInWorkSuite} title={text('Open in WorkSuite')}>
      {text('Open in WorkSuite')}
    </Button>
  ) : null;
  // Junk and Not junk in the action bar too (MPR-UX-06).
  const junkBtn = junk === 'junk' ? btn('spam', text('Junk'), () => onJunk('junk')) : btn('inbox', text('Not junk'), () => onJunk('not_junk'));
  const more = (
    <button ref={moreRef} type="button" onClick={onMore} aria-label="More actions" title="More actions" className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-[8px] text-ink-2 hover:bg-subtle">
      <Icon name="more" size={17} />
    </button>
  );
  if (style === 'floating') {
    return (
      <div className="pointer-events-none relative h-0">
        <div role="toolbar" aria-label="Reply and actions" data-ai-launcher-lift className="pointer-events-auto absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-0.5 rounded-full border border-line bg-surface px-1.5 py-1 shadow-[0_6px_24px_rgb(var(--ws-shadow-rgb)/0.16)]">
          {reply}
          {openItem}
          {btn('reply-all', text('Reply all'), () => onReply('reply_all'))}
          {btn('forward', text('Forward'), () => onReply('forward'))}
          {btn('archive', text('Archive'), onArchive)}
          {btn('trash', text('Delete'), onDelete)}
          {junkBtn}
          {btn('folder-input', text('Move to'), onMove, canMove)}
          {btn('star', starred ? text('Unstar') : text('Star'), onStar)}
          {more}
        </div>
      </div>
    );
  }
  // The floating AI button stands above this bar, never over its buttons (data-ai-launcher-lift, AiWidget; #287).
  return (
    <div role="toolbar" aria-label="Reply and actions" data-ai-launcher-lift className="flex h-[54px] shrink-0 items-center gap-0.5 border-t border-line px-3">
      {reply}
      {openItem}
      {btn('reply-all', text('Reply all'), () => onReply('reply_all'))}
      {btn('forward', text('Forward'), () => onReply('forward'))}
      {style !== 'minimal' ? (
        <>
          <span className="mx-1.5 h-5 w-px bg-line" />
          {btn('archive', text('Archive'), onArchive)}
          {btn('trash', text('Delete'), onDelete)}
          {junkBtn}
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

/** What the organisation blocks on top of the built-in list (DMO-SEC-04); none from an older server. */
function useSecurityPolicy() {
  return useQuery({
    queryKey: ['mail', 'security-policy'],
    queryFn: async () => {
      try {
        return await apiGet<{ blocked_extensions: string[]; security_mailbox: boolean }>('/api/mail/security/policy');
      } catch {
        return { blocked_extensions: [], security_mailbox: false };
      }
    },
    staleTime: 30 * 60_000,
  });
}

/**
 * The message's attachments (#163): real attachments only — pictures inside the body are in the body — each
 * under a readable name, with a thumbnail or its file type, its size, and Open, Download and Save to Files.
 * One kept on this computer (downloaded ahead by Settings › Mail › Images & media, or opened before) opens at
 * once, also offline.
 */
function Attachments({ m, msgRef, offline, gate, pending }: { m: MessageDetail; msgRef: MessageRef; offline: boolean; gate: Map<string, AttachmentAccess> | null; pending: boolean }) {
  const { uid, folder, mailbox } = msgRef;
  const qc = useQueryClient();
  const policy = useSecurityPolicy();
  const extra = policy.data?.blocked_extensions ?? [];
  const items = useMemo(() => m.attachments.map((a, i) => ({ ...a, name: readableName(a.name, a.mime, i + 1) })), [m.attachments]);
  /*
   * Only a scanned file is opened, previewed, downloaded, saved to Files or dragged out (MPR-UX-02). While the verdict
   * is being asked for, nothing opens; with no protection service at the server (gate null) the app works as before.
   */
  const openable = (ref: string) => !pending && (!gate || !!gate.get(ref)?.open);
  const allowed = items.filter((a) => openable(a.ref));
  const [scanning, setScanning] = useState<string | null>(null);
  const scan = async (ref: string) => {
    setScanning(ref);
    try {
      const r = await scanAttachment(msgRef, ref);
      if (r.status === 'blocked') toast('error', r.reason ?? (r.threat ? text('A virus was found: {threat}', { threat: r.threat }) : text('Blocked by your organisation')));
      else if (r.status === 'unscanned') toast('info', r.reason ?? text('It could not be checked. It stays locked.'));
      void qc.invalidateQueries({ queryKey: protectionKeys.message(msgRef) });
    } catch (e) {
      toast('error', errorMessage(e));
    } finally {
      setScanning(null);
    }
  };
  const kept = useQuery({
    queryKey: ['mail', 'kept-attachments', mailbox ?? null, folder, uid, allowed.map((a) => a.ref).join(','), offline],
    queryFn: async () => {
      try {
        // Only files that may be opened are fetched ahead or looked for here: a locked one never lands on this computer from the reader.
        return new Set(await call('mail:keptAttachments', { uid: String(uid), folder, mailbox: mailbox ?? null, items: allowed.slice(0, 50).map((a) => ({ ref: a.ref, name: a.name, mime: a.mime || '', size: Math.max(0, Math.round(a.size || 0)) })), auto: !offline }));
      } catch {
        return new Set<string>();
      }
    },
    enabled: allowed.length > 0,
    staleTime: 60_000,
  });
  const keptRefs = [...(kept.data ?? [])].join(',');
  const thumbs = useQuery({
    queryKey: ['mail', 'attachment-thumbs', mailbox ?? null, folder, uid, keptRefs],
    queryFn: async () => {
      const pics = items.filter((a) => openable(a.ref) && kept.data?.has(a.ref) && attachmentKind(a.name, a.mime) === 'images' && a.size <= 3 * 1024 * 1024).slice(0, 12);
      const out: Record<string, string> = {};
      if (!pics.length) return out;
      const path = (a: { ref: string }) => `/api/mail/messages/${uid}/attachments/${encodeURIComponent(a.ref)}?${new URLSearchParams({ folder, ...(mailbox ? { mailbox: String(mailbox) } : {}), local: '1' }).toString()}`;
      try {
        const hits = await call('offline:peek', { paths: pics.map(path) });
        pics.forEach((a, i) => {
          const type = (a.mime || '').toLowerCase();
          const hit = hits[i];
          if (hit && THUMB_TYPES.test(type)) out[a.ref] = `data:${type};base64,${hit.body}`;
        });
      } catch {
        // No thumbnail: the file type's badge.
      }
      return out;
    },
    enabled: keptRefs !== '',
    staleTime: 5 * 60_000,
  });
  /** "Save to Files" (MAIL-RD-03): the server copies it into the person's Files; nothing goes through this computer. */
  const save = async (a: MessageDetail['attachments'][number]) => {
    try {
      await apiPost(`/api/mail/messages/${uid}/attachments/${encodeURIComponent(a.ref)}/save`, mailbox ? { mailbox } : {}, { folder, mime: a.mime || 'application/octet-stream', ...(mailbox ? { mailbox } : {}) });
      toast('success', text('{name} is in your Files.', { name: a.name }));
    } catch (e) {
      toast('error', errorMessage(e));
    }
  };
  const download = (a: MessageDetail['attachments'][number], open: boolean) =>
    call('transfers:download', { mail: { uid, ref: a.ref, folder, mailbox }, name: a.name, ...(open ? { open: true } : {}) })
      .then(() => toast('info', open ? text('Opening {name}…', { name: a.name }) : text('Downloading {name}…', { name: a.name })))
      .catch((e) => toast('error', errorMessage(e)));
  const iconButton = 'inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-[8px] text-ink-2 hover:bg-subtle';
  /** An attachment as "Open with" takes it (#322): not in Drive, so WorkSuite Office asks to save it there first. */
  const officeDoc = (a: MessageDetail['attachments'][number]): OfficeDoc => {
    const path = `/api/mail/messages/${uid}/attachments/${encodeURIComponent(a.ref)}?${new URLSearchParams({ folder, dl: '1', ...(mailbox ? { mailbox } : {}) })}`;
    return {
      name: a.name,
      apiPath: path,
      builtinOk: isOfficeFile(a.name),
      openBuiltin: () => openInOffice({ kind: 'api', name: a.name, path }),
      openSystem: () => void download(a, true),
      // The server copies it into My files (MAIL-RD-03): nothing goes through this computer.
      saveToDrive: async () => {
        const r = await apiPost<{ id?: number; file_id?: number } | null>(`/api/mail/messages/${uid}/attachments/${encodeURIComponent(a.ref)}/save`, mailbox ? { mailbox } : {}, { folder, mime: a.mime || 'application/octet-stream', ...(mailbox ? { mailbox } : {}) });
        return Number(r?.id ?? r?.file_id ?? 0) || null;
      },
    };
  };
  return (
    <div className="flex max-h-[30%] shrink-0 flex-col gap-2 overflow-y-auto border-t border-line px-6 py-3 scroll-thin" aria-label={text('Attachments')}>
      {items.map((a) => {
        const size = bytes(a.size);
        const risk = attachmentRisk(a.name, extra);
        const here = !!kept.data?.has(a.ref);
        const thumb = thumbs.data?.[a.ref];
        const badge = thumb ? <img src={thumb} alt="" className="h-9 w-9 shrink-0 rounded-[6px] object-cover" /> : <FileBadge name={a.name} />;
        const access = gate?.get(a.ref) ?? null;
        // Blocked, being checked, or not scanned: shown, never opened (P-UI-11).
        if (access && !access.open) return <LockedAttachment key={a.ref} name={a.name} size={size} access={access} offline={offline} scanning={scanning === a.ref} onScan={() => void scan(a.ref)} />;
        if (pending) return <LockedAttachment key={a.ref} name={a.name} size={size} access={{ status: 'checking', open: false, reason: text('Being checked for viruses'), threat: null, waitingOnline: false }} offline={offline} />;
        if (risk === 'blocked') {
          return (
            <div key={a.ref} className="flex w-full max-w-[520px] items-center gap-3 rounded-[10px] border border-line bg-subtle px-3 py-2 text-[13px]" title={text('WorkSuite blocks this kind of attachment: it can run as a program on your computer.')}>
              <FileBadge name={a.name} />
              <span className="min-w-0">
                <span className="block truncate font-semibold text-ink-2">{a.name}</span>
                <span className="flex items-center gap-1 text-[11.5px] text-danger">
                  <Icon name="lock" size={11} />
                  {text('Blocked — it could run as a program')}
                </span>
              </span>
            </div>
          );
        }
        if (offline && !here) {
          return (
            <div key={a.ref} className="flex items-center gap-3 rounded-[10px] border border-dashed border-line px-3 py-2.5 text-[13px]">
              {badge}
              <span className="min-w-0 truncate">
                <span className="font-semibold text-ink">{a.name}</span>
                <span className="text-ink-3"> · {size} · {text('not downloaded — available when you’re back online')}</span>
              </span>
            </div>
          );
        }
        // Kept here while offline: opened from this computer as a file (PDF Studio and the editors read from the server).
        const local = offline && here;
        return (
          <div key={a.ref} className="flex w-full max-w-[600px] items-center gap-1">
            <button
              type="button"
              draggable
              onClick={() =>
                // A PDF opens in PDF Studio, preview only (PDF-OPEN-004); a Word, Excel or PowerPoint file in a
                // WorkSuite DOC / Sheet / Slides tab; a file with macros is saved, never opened elsewhere (DMO-SEC-04);
                // anything else downloads and opens.
                risk === 'macro'
                  ? void call('transfers:download', { mail: { uid, ref: a.ref, folder, mailbox }, name: a.name })
                      .then(() => toast('info', text('{name} has macros: it is saved, not opened. Open it only if you trust the sender.', { name: a.name })))
                      .catch((e) => toast('error', errorMessage(e)))
                  : !local && isPdf(a)
                    ? openPdf({ kind: 'mail', uid: String(uid), ref: a.ref, folder, mailbox: mailbox ?? null, name: a.name }, a.name)
                    : !local && officeOpenKind(a.name)
                      ? // Where Settings › Files says (#322): a WorkSuite DOC / Sheet / Slides tab, WorkSuite Office, or the app here.
                        void openOfficeDoc(officeDoc(a))
                      : void download(a, true)
              }
              className="flex min-w-0 flex-1 items-center gap-3 rounded-[10px] border border-line px-3 py-2 text-left hover:bg-subtle"
              title={isPdf(a) && !local ? text('Open in PDF Studio') : text('Open')}
            >
              {badge}
              <span className="min-w-0">
                <span className="flex min-w-0 items-center gap-2">
                  <span className="truncate text-[13px] font-semibold text-ink">{a.name}</span>
                  {access ? <ScanChip access={access} /> : null}
                </span>
                <span className="block text-[11.5px] text-ink-3">
                  {size} · {risk === 'macro' ? text('has macros — save only') : text('open')}
                  {here ? ` · ${text('on this computer')}` : ''}
                </span>
              </span>
            </button>
            {risk !== 'macro' && !local ? <OpenWithButton doc={officeDoc(a)} className={iconButton} /> : null}
            {risk !== 'macro' ? (
              <button type="button" onClick={() => void download(a, false)} aria-label={text('Download {name}', { name: a.name })} title={text('Download')} className={iconButton}>
                <Icon name="download" size={16} />
              </button>
            ) : null}
            {canOpen('files') && !offline ? (
              <button type="button" onClick={() => void save(a)} aria-label={text('Save {name} to Files', { name: a.name })} title={text('Save to Files')} className={iconButton}>
                <Icon name="folder-input" size={16} />
              </button>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

/** Picture attachments shown as thumbnails from the local store: bitmaps only, never SVG. */
const THUMB_TYPES = /^image\/(png|jpe?g|gif|webp|bmp)$/;

/** The original as the server holds it, headers and all — read-only text, never rendered. */
export function SourceDialog({ msgRef, onClose }: { msgRef: MessageRef; onClose: () => void }) {
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

/** The header a list row already has, shown while the body downloads or when only it is here (#209). */
function SavedHeader({ row }: { row: MessageRow }) {
  return (
    <div data-saved-header className="flex items-start gap-3">
      <Avatar name={row.from_name || row.from_email} size={36} />
      <div className="min-w-0 flex-1">
        <h2 className="truncate text-[17px] font-bold text-ink selectable">{row.subject || text('(no subject)')}</h2>
        <p className="truncate text-[13px] text-ink-2">
          {row.from_name || row.from_email}
          {row.from_name && row.from_email ? <span className="text-ink-3"> &lt;{row.from_email}&gt;</span> : null}
        </p>
        <p className="text-[12px] text-ink-3">{whenLabel(row.created_at)}</p>
        {row.preview ? <p className="mt-2 text-[13px] text-ink-2">{row.preview}</p> : null}
        {row.has_attachment ? (
          <p className="mt-1 flex items-center gap-1 text-[12px] text-ink-3">
            <Icon name="paperclip" size={13} />
            {text('Has attachments')}
          </p>
        ) : null}
      </div>
    </div>
  );
}

/**
 * Downloading: the saved header at once, the body as a placeholder until it arrives. After two seconds it says it is
 * waiting for a free connection (#228): the server queues an open for up to ten seconds while the account syncs.
 */
function MessagePending({ row }: { row: MessageRow | null }) {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setSlow(true), 2_000);
    return () => clearTimeout(t);
  }, []);
  if (!row) return <Spinner />;
  return (
    <div className="p-6" role="status" aria-label={text('Downloading…')}>
      <SavedHeader row={row} />
      <div className="mt-5 flex flex-col gap-2" aria-hidden>
        <span className="h-3 w-11/12 animate-pulse rounded bg-subtle motion-reduce:animate-none" />
        <span className="h-3 w-4/5 animate-pulse rounded bg-subtle motion-reduce:animate-none" />
        <span className="h-3 w-2/3 animate-pulse rounded bg-subtle motion-reduce:animate-none" />
      </div>
      <p className="mt-3 text-[12.5px] text-ink-3">{slow ? text('Waiting for a free connection…') : text('Downloading…')}</p>
    </div>
  );
}

/** Why a message did not open, each case with its own way forward (#209). */
function MessageProblem({ problem, error, msgRef, row, retrying, onRetry, onFixAccount, onRefreshFolder }: { problem: ReturnType<typeof lookupProblem>; error: unknown; msgRef: MessageRef; row: MessageRow | null; retrying: boolean; onRetry: () => void; onFixAccount?: () => void; onRefreshFolder?: () => void }) {
  const [open, setOpen] = useState(false);
  const details = problemDetails(error, msgRef);
  const tone = problem === 'offline' ? 'border-[var(--ws-note-line)] bg-[var(--ws-note-bg)] text-ink' : 'border-line bg-danger-bg text-danger';
  return (
    <div className="p-6" data-message-problem={problem}>
      {row && (problem === 'offline' || problem === 'signin') ? (
        <div className="mb-4">
          <SavedHeader row={row} />
        </div>
      ) : null}
      <div role="alert" className={cx('flex flex-col gap-2 rounded-[10px] border px-3 py-2.5 text-[13px]', tone)}>
        <span className="flex items-center gap-2 font-semibold">
          <Icon name={problem === 'offline' ? 'wifi-off' : 'alert'} size={15} />
          {problemTitle(problem)}
        </span>
        {problem === 'gone' ? <span className="text-[12.5px] text-ink-2">{text('It is no longer in this folder or any other folder of the account. It has been taken off the list.')}</span> : null}
        {problem === 'busy' ? <span className="text-[12.5px] text-ink-2">{text('The account is busy syncing. Retry in a moment.')}</span> : null}
        {problem === 'resync' ? <span className="text-[12.5px] text-ink-2">{text('Refresh the folder in a minute and open it again.')}</span> : null}
        <span className="flex flex-wrap items-center gap-2">
          {problem === 'signin' && onFixAccount ? <Button size="sm" variant="primary" onClick={onFixAccount}>{text('Fix account')}</Button> : null}
          {(problem === 'gone' || problem === 'resync') && onRefreshFolder ? <Button size="sm" variant="primary" onClick={onRefreshFolder}>{text('Refresh folder')}</Button> : null}
          {problem !== 'gone' ? (
            <Button size="sm" variant="secondary" onClick={onRetry} disabled={retrying}>
              {retrying ? text('Looking for it…') : text('Retry')}
            </Button>
          ) : null}
          {problem === 'server' ? (
            <>
              <Button size="sm" variant="secondary" onClick={() => void navigator.clipboard?.writeText(details).then(() => toast('success', text('Copied')), () => toast('error', text('Could not copy.')))}>
                {text('Copy')}
              </Button>
              <button type="button" aria-expanded={open} onClick={() => setOpen(!open)} className="text-[12.5px] font-semibold underline">
                {open ? text('Hide technical details') : text('Technical details')}
              </button>
            </>
          ) : null}
        </span>
        {problem === 'server' && open ? <pre data-technical-details className="overflow-auto rounded-[6px] bg-surface p-2 font-mono text-[11.5px] whitespace-pre-wrap text-ink selectable">{details}</pre> : null}
      </div>
    </div>
  );
}
