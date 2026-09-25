import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { app } from '../../core/app-state';
import { ApiError, apiGet, apiGetMeta, apiPost, setDefaultMailbox, withMailbox } from '../../core/api';
import { call, errorMessage } from '../../core/bridge';
import { useDraft } from '../../core/drafts';
import { useStore } from '../../core/store';
import { useTab, useTabTitle } from '../../core/tab-context';
import { dateLabel, listStamp, timeLabel } from '../../core/time';
import { toast } from '../../core/toasts';
import { Icon } from '../../components/Icon';
import { Avatar, Button, Chip, Empty, ErrorNote, FileBadge, IconButton, Modal, OfflineNote, Spinner, TextField, cx } from '../../components/ui';
import { VirtualList } from '../../components/VirtualList';
import type { ModuleProps } from '../registry';
import { escapeHtml, mailFrameDoc, parseAddresses, sanitizeMailHtml, textToHtml } from './sanitize';

/**
 * Desktop Mail, three panes (UI-07, FR-COM-01, §4.14): accounts and folders,
 * the conversation list, and the message. READ_CACHE + DRAFTS: recent mail
 * reads offline within the cache window; composing saves a draft every
 * moment, and sending needs the server.
 */
interface Mailbox {
  id: number;
  email: string;
  display_name: string | null;
  shared: boolean;
  unread: number | null;
  in_unified?: boolean;
  is_default?: boolean;
  archived?: boolean;
}
interface Folder {
  id: number;
  name: string;
  slug: string;
  type: string;
  total: number;
  unread: number;
}
interface MessageRow {
  id: number;
  from_name: string;
  from_email: string;
  subject: string;
  preview: string;
  is_read: boolean;
  is_starred: boolean;
  has_attachment: boolean;
  folder_slug?: string;
  created_at: string;
  mailbox?: { id: number; email: string; name: string; colour: string };
  uid_key?: string;
}
interface MessageDetail {
  id: number;
  message_id: string;
  from_name: string;
  from_email: string;
  subject: string;
  to: string[];
  cc: string[];
  body_html: string;
  is_starred: boolean;
  attachments: Array<{ ref: string; name: string; mime: string; size: number }>;
  created_at: string;
}

type Filter = 'all' | 'unread' | 'flagged' | 'attachments';

export default function MailPage({ active }: ModuleProps) {
  const { query, go, route } = useTab();
  const box = query.get('box') ?? 'unified';
  const folder = query.get('folder') ?? 'inbox';
  const msg = query.get('msg');
  const msgBox = query.get('mbx');
  const [filter, setFilter] = useState<Filter>('all');
  const [compose, setCompose] = useState<ComposeSeed | null>(null);
  const [composeRoute, setComposeRoute] = useState<string | null>(null);
  if (query.get('compose') === '1' && composeRoute !== route) {
    setComposeRoute(route);
    setCompose({ mode: 'new' });
  }
  const cacheDays = useStore(app, (s) => s.prefs?.mailCacheDays ?? 30);
  useTabTitle(msg ? 'Mail · Message' : 'Mail');

  const mailboxes = useQuery({ queryKey: ['mail', 'mailboxes'], queryFn: () => apiGet<{ mailboxes: Mailbox[] }>('/api/mail/mailboxes'), staleTime: 5 * 60_000 });
  const boxes = (mailboxes.data?.mailboxes ?? []).filter((m) => !m.archived);
  const defaultBox = boxes.find((m) => m.is_default) ?? boxes[0];
  useEffect(() => setDefaultMailbox(defaultBox ? String(defaultBox.id) : null), [defaultBox]);
  const unified = box === 'unified' && boxes.length > 1;
  const effectiveBox = unified ? null : box === 'unified' ? (defaultBox ? String(defaultBox.id) : null) : box;

  const list = useInfiniteQuery({
    queryKey: ['mail', 'messages', unified ? 'unified' : effectiveBox, folder],
    initialPageParam: 1,
    queryFn: ({ pageParam, signal }) =>
      apiGetMeta<{ messages: MessageRow[]; has_more: boolean; total: number }>(
        '/api/mail/messages',
        unified ? { unified: 1, folder, page: pageParam, per_page: 50 } : withMailbox({ folder, page: pageParam, per_page: 50 }, effectiveBox),
        signal,
      ),
    getNextPageParam: (last, pages) => (last.data.has_more ? pages.length + 1 : undefined),
    enabled: mailboxes.isSuccess || mailboxes.isError,
  });
  const rows = useMemo(() => {
    const all = (list.data?.pages ?? []).flatMap((p) => p.data.messages);
    return all.filter((m) => (filter === 'unread' ? !m.is_read : filter === 'flagged' ? m.is_starred : filter === 'attachments' ? m.has_attachment : true));
  }, [list.data, filter]);
  const offline = list.data?.pages.some((p) => p.offline) ? list.data.pages[0]?.cachedAt ?? null : null;
  const unreadCount = unified ? boxes.filter((b) => !b.shared).reduce((n, b) => n + (b.unread ?? 0), 0) : null;

  const select = (m: MessageRow) => {
    const p = new URLSearchParams({ box, folder, msg: String(m.id) });
    const mb = m.mailbox?.id ?? effectiveBox;
    if (mb) p.set('mbx', String(mb));
    go(`/mail?${p}`);
  };

  return (
    <div className="flex h-full">
      <FolderPane boxes={boxes} box={box} folder={folder} onCompose={() => setCompose({ mode: 'new' })} onPick={(b, f) => go(`/mail?box=${b}&folder=${f}`)} cacheDays={cacheDays} loading={mailboxes.isLoading} active={active} unifiedUnread={unreadCount} />
      <div className="flex w-[380px] shrink-0 flex-col border-r border-line bg-surface">
        <div className="px-4 pt-4 pb-2">
          <div className="flex items-baseline justify-between">
            <h1 className="text-[18px] font-bold text-ink">{unified ? 'Combined inbox' : folder.charAt(0).toUpperCase() + folder.slice(1)}</h1>
            {list.data?.pages[0] ? <span className="text-[12.5px] text-ink-3">{list.data.pages[0].data.total} messages</span> : null}
          </div>
          <div className="mt-3 flex gap-1.5">
            {(['all', 'unread', 'flagged', 'attachments'] as const).map((f) => (
              <button key={f} type="button" onClick={() => setFilter(f)} className={cx('rounded-full border px-3 py-1 text-[12.5px] font-semibold capitalize', filter === f ? 'border-ink bg-ink text-surface' : 'border-line text-ink-2 hover:bg-subtle')}>
                {f}
              </button>
            ))}
          </div>
          {offline ? <div className="mt-2"><OfflineNote cachedAt={offline} /></div> : null}
        </div>
        <div className="min-h-0 flex-1">
          {list.isLoading ? <Spinner /> : list.error ? <div className="p-4"><ErrorNote error={list.error} onRetry={() => void list.refetch()} /></div> : rows.length === 0 ? <Empty icon="inbox" title="Nothing here" /> : null}
          {rows.length > 0 ? (
            <VirtualList
              items={rows}
              estimate={96}
              getKey={(m) => m.uid_key ?? `${m.mailbox?.id ?? ''}:${m.id}`}
              onEndReached={() => list.hasNextPage && !list.isFetchingNextPage && void list.fetchNextPage()}
              render={(m) => {
                const selected = String(m.id) === msg && (!m.mailbox || String(m.mailbox.id) === msgBox);
                return (
                  <button type="button" onClick={() => select(m)} className={cx('flex w-full flex-col gap-0.5 border-b border-line px-4 py-3 text-left', selected ? 'bg-selection' : 'hover:bg-subtle')}>
                    <span className="flex items-center gap-2">
                      <span className={cx('h-2 w-2 shrink-0 rounded-full', m.is_read ? 'bg-transparent' : 'bg-primary')} />
                      <span className={cx('min-w-0 flex-1 truncate text-[13.5px]', m.is_read ? 'text-ink-2' : 'font-bold text-ink')}>{m.from_name || m.from_email}</span>
                      {m.has_attachment ? <Icon name="paperclip" size={13} className="text-ink-3" /> : null}
                      {m.is_starred ? <Icon name="flag" size={13} className="text-warning" /> : null}
                      <span className="shrink-0 text-[12px] text-ink-3">{listStamp(m.created_at)}</span>
                    </span>
                    <span className={cx('truncate pl-4 text-[13px]', m.is_read ? 'text-ink-2' : 'font-semibold text-ink')}>{m.subject || '(no subject)'}</span>
                    <span className="truncate pl-4 text-[12.5px] text-ink-3">{m.preview}</span>
                    {m.mailbox && unified ? (
                      <span className="pl-4 pt-0.5">
                        <Chip tone="indigo">{m.mailbox.name}</Chip>
                      </span>
                    ) : null}
                  </button>
                );
              }}
            />
          ) : null}
          {list.isFetchingNextPage ? <Spinner label="Loading more…" /> : null}
        </div>
      </div>
      <div className="flex min-w-0 flex-1 flex-col bg-surface">
        {msg ? <MessageView uid={msg} folder={folder} mailbox={msgBox} onReply={(seed) => setCompose(seed)} onGone={() => go(`/mail?box=${box}&folder=${folder}`)} /> : <Empty icon="mail" title="Select a message" hint="Choose a message from the list to read it here." />}
      </div>
      {compose ? <Compose seed={compose} boxes={boxes} defaultBox={msgBox ?? effectiveBox ?? (defaultBox ? String(defaultBox.id) : null)} onClose={() => setCompose(null)} /> : null}
    </div>
  );
}

function FolderPane({ boxes, box, folder, onCompose, onPick, cacheDays, loading, active, unifiedUnread }: { boxes: Mailbox[]; box: string; folder: string; onCompose: () => void; onPick: (box: string, folder: string) => void; cacheDays: number; loading: boolean; active: boolean; unifiedUnread: number | null }) {
  const [open, setOpen] = useState<string | null>(null);
  const expanded = open ?? (box !== 'unified' ? box : boxes[0] ? String(boxes[0].id) : null);
  return (
    <div className="flex w-[250px] shrink-0 flex-col border-r border-line bg-surface">
      <div className="p-4">
        <Button variant="primary" size="lg" icon="plus" className="w-full" onClick={onCompose}>
          Compose
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-3 scroll-thin">
        {boxes.length > 1 ? (
          <FolderRow label="Combined inbox" count={unifiedUnread ?? 0} active={box === 'unified' && folder === 'inbox'} onClick={() => onPick('unified', 'inbox')} strong />
        ) : null}
        {loading ? <Spinner /> : null}
        {boxes.map((b) => (
          <MailboxFolders key={b.id} box={b} expanded={expanded === String(b.id)} onToggle={() => setOpen(expanded === String(b.id) ? '' : String(b.id))} current={box === String(b.id) || (boxes.length === 1 && box === 'unified') ? folder : null} onPick={(f) => onPick(String(b.id), f)} active={active} />
        ))}
        {!loading && boxes.length === 0 ? <p className="p-2 text-[12.5px] text-ink-3">No mailbox is connected to your account. Connect one in WorkSuite Mail on the web.</p> : null}
      </div>
      <div className="m-3 rounded-[10px] bg-subtle p-3 text-[12px] leading-snug text-ink-2">
        {cacheDays === 0 ? 'Offline cache: message headers only' : `Offline cache: last ${cacheDays} days`}
        <br />
        Messages you open are kept for reading offline.
      </div>
    </div>
  );
}

function MailboxFolders({ box, expanded, onToggle, current, onPick, active }: { box: Mailbox; expanded: boolean; onToggle: () => void; current: string | null; onPick: (slug: string) => void; active: boolean }) {
  const folders = useQuery({
    queryKey: ['mail', 'folders', box.id],
    queryFn: () => apiGet<{ folders: Folder[] }>('/api/mail/folders', { mailbox: box.id }),
    enabled: expanded && active,
    staleTime: 60_000,
  });
  return (
    <div className="mt-3">
      <button type="button" onClick={onToggle} className="flex w-full items-center gap-1 px-2 py-1 text-left text-[11.5px] font-bold uppercase tracking-wide text-ink-3 hover:text-ink">
        <Icon name={expanded ? 'chevron-down' : 'chevron-right'} size={13} />
        <span className="truncate">{box.shared ? `Shared · ${box.email}` : box.email}</span>
      </button>
      {expanded ? (
        <div className="mt-1 flex flex-col">
          {folders.isLoading ? <Spinner label="" /> : null}
          {folders.error ? <p className="px-2 text-[12px] text-danger">{errorMessage(folders.error)}</p> : null}
          {(folders.data?.folders ?? []).map((f) => (
            <FolderRow key={f.slug} label={f.name} count={f.slug === 'sent' || f.slug === 'trash' ? 0 : f.unread} muted={f.slug === 'drafts' ? f.total : undefined} active={current === f.slug} onClick={() => onPick(f.slug)} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function FolderRow({ label, count, muted, active, onClick, strong }: { label: string; count: number; muted?: number; active: boolean; onClick: () => void; strong?: boolean }) {
  return (
    <button type="button" onClick={onClick} className={cx('flex h-9 w-full items-center justify-between rounded-[8px] px-3 text-left text-[13.5px]', active ? 'bg-selection font-bold text-primary' : 'text-ink hover:bg-subtle', strong && !active && 'font-semibold')}>
      <span className="truncate">{label}</span>
      {count ? <span className={cx('text-[12.5px] font-semibold tabular', active ? 'text-primary' : 'text-ink-2')}>{count}</span> : muted ? <span className="text-[12.5px] text-ink-3">{muted}</span> : null}
    </button>
  );
}

interface ComposeSeed {
  mode: 'new' | 'reply' | 'reply_all' | 'forward';
  to?: string;
  cc?: string;
  subject?: string;
  quote?: string;
  inReplyTo?: string;
  mailbox?: string | null;
}

function MessageView({ uid, folder, mailbox, onReply, onGone }: { uid: string; folder: string; mailbox: string | null; onReply: (s: ComposeSeed) => void; onGone: () => void }) {
  const qc = useQueryClient();
  const { openInWindow, route } = useTab();
  const q = useQuery({
    queryKey: ['mail', 'message', mailbox, folder, uid],
    queryFn: ({ signal }) => apiGetMeta<MessageDetail>(`/api/mail/messages/${uid}`, withMailbox({ folder }, mailbox), signal),
  });
  const m = q.data?.data;
  const clean = useMemo(() => (m ? sanitizeMailHtml(m.body_html) : null), [m]);
  useEffect(() => {
    if (q.isSuccess) void qc.invalidateQueries({ queryKey: ['mail', 'messages'] });
  }, [q.isSuccess, qc]);

  const act = async (action: 'archive' | 'trash' | 'unread' | 'star' | 'unstar') => {
    try {
      await apiPost(`/api/mail/messages/${uid}/action`, { action, folder }, withMailbox({}, mailbox));
      void qc.invalidateQueries({ queryKey: ['mail'] });
      if (action === 'archive' || action === 'trash' || action === 'unread') onGone();
      toast('success', action === 'archive' ? 'Archived.' : action === 'trash' ? 'Moved to Trash.' : action === 'unread' ? 'Marked as unread.' : 'Updated.');
    } catch (e) {
      toast('error', e instanceof ApiError && e.offline ? 'You are offline. Try again when you reconnect.' : errorMessage(e));
    }
  };
  const print = () => {
    if (!m || !clean) return;
    const html = `<h2 style="font-family:sans-serif">${escapeHtml(m.subject)}</h2><p style="font-family:sans-serif;color:#555">From ${escapeHtml(m.from_name)} &lt;${escapeHtml(m.from_email)}&gt;<br>To ${escapeHtml(m.to.join(', '))}<br>${escapeHtml(dateLabel(m.created_at))} ${escapeHtml(timeLabel(m.created_at))}</p><hr>${clean.html}`;
    void call('print:print', { html, title: m.subject || 'Email' }).catch((e) => toast('error', errorMessage(e)));
  };
  const quote = m ? `\n\nOn ${dateLabel(m.created_at)} ${m.from_name || m.from_email} wrote:\n> ${new DOMParser().parseFromString(clean?.html ?? '', 'text/html').body.textContent?.trim().split('\n').slice(0, 40).join('\n> ') ?? ''}` : '';
  const re = (s: string) => (/^re:/i.test(s) ? s : `Re: ${s}`);

  if (q.isLoading) return <Spinner />;
  if (q.error) return <div className="p-6"><ErrorNote error={q.error} onRetry={() => void q.refetch()} /></div>;
  if (!m || !clean) return null;
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-line px-5 py-2.5">
        <Button onClick={() => onReply({ mode: 'reply', to: m.from_email, subject: re(m.subject), quote, inReplyTo: m.message_id, mailbox })}>Reply</Button>
        <Button onClick={() => onReply({ mode: 'reply_all', to: [m.from_email, ...m.to].join(', '), cc: m.cc.join(', '), subject: re(m.subject), quote, inReplyTo: m.message_id, mailbox })}>Reply all</Button>
        <Button onClick={() => onReply({ mode: 'forward', subject: /^fwd?:/i.test(m.subject) ? m.subject : `Fwd: ${m.subject}`, quote, mailbox })}>Forward</Button>
        <div className="flex-1" />
        {q.data?.offline ? <OfflineNote cachedAt={q.data.cachedAt} /> : null}
        <IconButton icon={m.is_starred ? 'flag' : 'flag'} label={m.is_starred ? 'Remove flag' : 'Flag'} active={m.is_starred} onClick={() => void act(m.is_starred ? 'unstar' : 'star')} />
        <IconButton icon="mail" label="Mark as unread" onClick={() => void act('unread')} />
        <IconButton icon="printer" label="Print" onClick={print} />
        <IconButton icon="external" label="Open in new window" onClick={() => openInWindow(route, m.subject)} />
        <IconButton icon="archive" label="Archive" onClick={() => void act('archive')} />
        <IconButton icon="trash" label="Delete" onClick={() => void act('trash')} />
      </div>
      <div className="px-7 pt-5">
        <h2 className="text-[22px] font-bold text-ink selectable">{m.subject || '(no subject)'}</h2>
        <div className="mt-4 flex items-center gap-3">
          <Avatar name={m.from_name || m.from_email} size={40} />
          <div className="min-w-0 text-[13.5px]">
            <div className="selectable">
              <span className="font-bold text-ink">{m.from_name}</span> <span className="text-ink-3">&lt;{m.from_email}&gt;</span>
            </div>
            <div className="truncate text-[12.5px] text-ink-3 selectable">
              to {m.to.join(', ')}
              {m.cc.length ? ` · cc ${m.cc.join(', ')}` : ''} · {listStamp(m.created_at)}
            </div>
          </div>
        </div>
        {clean.blockedImages > 0 ? <div className="mt-3 rounded-[8px] bg-subtle px-3 py-1.5 text-[12px] text-ink-2">{clean.blockedImages} remote image{clean.blockedImages === 1 ? ' was' : 's were'} blocked to protect your privacy.</div> : null}
      </div>
      <iframe title="Message" sandbox="allow-popups allow-popups-to-escape-sandbox" srcDoc={mailFrameDoc(clean.html)} className="mx-5 mt-3 min-h-0 flex-1 rounded-[8px] border-0 bg-white" />
      {m.attachments.length ? (
        <div className="flex flex-wrap gap-2 border-t border-line px-6 py-3">
          {m.attachments.map((a) => (
            <button
              key={a.ref}
              type="button"
              draggable
              onClick={() =>
                void call('transfers:download', { mail: { uid, ref: a.ref, folder, mailbox }, name: a.name, open: true })
                  .then(() => toast('info', `Downloading ${a.name}…`))
                  .catch((e) => toast('error', errorMessage(e)))
              }
              className="flex items-center gap-3 rounded-[10px] border border-line px-3 py-2 text-left hover:bg-subtle"
              title="Download and open"
            >
              <FileBadge name={a.name} />
              <span>
                <span className="block max-w-[220px] truncate text-[13px] font-semibold text-ink">{a.name}</span>
                <span className="block text-[11.5px] text-ink-3">{Math.max(1, Math.round(a.size / 1024))} KB · download</span>
              </span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function Compose({ seed, boxes, defaultBox, onClose }: { seed: ComposeSeed; boxes: Mailbox[]; defaultBox: string | null; onClose: () => void }) {
  const context = seed.mode === 'new' ? 'compose:new' : `compose:${seed.mode}:${seed.inReplyTo ?? seed.subject ?? ''}`;
  const draft = useDraft('mail', context, { to: seed.to ?? '', cc: seed.cc ?? '', bcc: '', subject: seed.subject ?? '', body: seed.quote ?? '', from: seed.mailbox ?? defaultBox ?? '' });
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showCc, setShowCc] = useState(!!seed.cc);
  const v = draft.value;
  const set = (patch: Partial<typeof v>) => draft.setValue({ ...v, ...patch });
  const send = async () => {
    setSending(true);
    setError(null);
    try {
      await apiPost('/api/mail/send', {
        to: parseAddresses(v.to),
        cc: parseAddresses(v.cc),
        bcc: parseAddresses(v.bcc),
        subject: v.subject,
        body_html: textToHtml(v.body),
        in_reply_to: seed.inReplyTo,
        reply_mode: seed.mode === 'new' ? undefined : seed.mode,
        mailbox: v.from || undefined,
      });
      await draft.clear();
      toast('success', 'Sent.');
      onClose();
    } catch (e) {
      setError(e instanceof ApiError && e.offline ? 'You are offline. Your message is saved as a draft; send it when you reconnect.' : errorMessage(e));
    } finally {
      setSending(false);
    }
  };
  return (
    <Modal
      title={seed.mode === 'new' ? 'New message' : seed.mode === 'forward' ? 'Forward' : 'Reply'}
      width={720}
      onClose={onClose}
      footer={
        <>
          <span className="mr-auto text-[12px] text-ink-3">{draft.restored ? 'Draft restored · ' : ''}Saved as you type</span>
          <Button
            onClick={async () => {
              await draft.clear();
              onClose();
            }}
          >
            Discard
          </Button>
          <Button variant="primary" icon="send" loading={sending} disabled={!v.to.trim()} onClick={() => void send()}>
            Send
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3 p-5">
        {boxes.length > 1 ? (
          <label className="flex items-center gap-3 text-[13px]">
            <span className="w-14 text-ink-3">From</span>
            <select value={v.from} onChange={(e) => set({ from: e.target.value })} className="h-9 flex-1 rounded-[8px] border border-line bg-surface px-2" aria-label="From">
              {boxes.map((b) => (
                <option key={b.id} value={String(b.id)}>
                  {b.display_name ? `${b.display_name} <${b.email}>` : b.email}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <div className="flex items-end gap-2">
          <TextField className="flex-1" label="To" value={v.to} onChange={(e) => set({ to: e.target.value })} placeholder="name@company.com, …" autoFocus={!v.to} />
          {!showCc ? (
            <Button size="sm" variant="ghost" onClick={() => setShowCc(true)}>
              Cc/Bcc
            </Button>
          ) : null}
        </div>
        {showCc ? (
          <div className="grid grid-cols-2 gap-3">
            <TextField label="Cc" value={v.cc} onChange={(e) => set({ cc: e.target.value })} />
            <TextField label="Bcc" value={v.bcc} onChange={(e) => set({ bcc: e.target.value })} />
          </div>
        ) : null}
        <TextField label="Subject" value={v.subject} onChange={(e) => set({ subject: e.target.value })} />
        <textarea value={v.body} onChange={(e) => set({ body: e.target.value })} aria-label="Message" rows={14} autoFocus={!!v.to} className="min-h-[260px] rounded-[8px] border border-line bg-surface p-3 text-[13.5px] leading-relaxed text-ink outline-none focus:border-primary" />
        {error ? <ErrorNote error={error} /> : null}
        <p className="text-[12px] text-ink-3">Attachments and formatting are available in WorkSuite Mail on the web; the desktop composer sends plain text for now.</p>
      </div>
    </Modal>
  );
}

