import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState, type ChangeEvent, type KeyboardEvent } from 'react';
import { call, errorMessage } from '../../../core/bridge';
import { useDraft } from '../../../core/drafts';
import { text } from '../../../core/i18n';
import { useTab, useTabTitle } from '../../../core/tab-context';
import { dateLabel, dayKey, listStamp, parseTs, timeLabel, todayInZone } from '../../../core/time';
import { toast } from '../../../core/toasts';
import { Icon } from '../../../components/Icon';
import { ResizeDivider, useResizableWidth } from '../../../components/ResizeDivider';
import { Select } from '../../../components/Select';
import { SidePanel } from '../../../components/SidePanel';
import { Avatar, Button, Empty, ErrorNote, Spinner, cx } from '../../../components/ui';
import { openChatAttachment, previewKind, type Attachment } from '../AttachmentViewer';
import { mediaUrl } from '../types';
import { LIST_WIDTH, rememberMeta } from './channels';
import {
  ACCEPT, accountLabel, isMetaConnected, metaAttachment, metaFileRefusal, metaMessageText, metaPreview, PLATFORM_ICON, PLATFORM_LABEL, readMeta, refusalText, sendErrorText, sendMeta, sendMetaFiles,
  useMetaConversations, useMetaThread, type MetaAccount, type MetaConversation, type MetaMessage, type MetaPlatform,
} from './meta';

/**
 * Messenger or Instagram in Chat (worksuite-desktop#36): the conversations on the Pages or Instagram accounts shared
 * with this person in the list — each saying which channel and which account it is on — the chosen one beside it,
 * answered from here with text and files within what the platform allows. When a reply cannot be sent (the messaging
 * window has closed, the account is not connected, this person may only read it) the composer says why instead.
 * An account that is not connected says so above the list, with Reconnect for whoever may; the gear opens the
 * channel's settings. There are no calls on either platform here.
 */
export function MetaChannel({ platform, accounts, loading, error, retry, onConnect, onReconnect, onSettings }: {
  platform: MetaPlatform;
  /** This platform's accounts. */
  accounts: MetaAccount[];
  loading: boolean;
  error: unknown;
  retry: () => void;
  onConnect: (() => void) | null;
  onReconnect: (a: MetaAccount) => void;
  onSettings: () => void;
}) {
  const { query, go } = useTab();
  const selected = query.get('mc');
  const label = PLATFORM_LABEL[platform];
  const [account, setAccount] = useState(0);
  const [unread, setUnread] = useState(false);
  const [q, setQ] = useState('');
  const list = useMetaConversations({ platform, account, unread, q }, accounts.length > 0);
  const rows = list.data?.conversations ?? [];
  const current = rows.find((c) => String(c.id) === selected);
  useTabTitle(current ? `${label} · ${current.name}` : selected ? null : label);
  const width = useResizableWidth('chat.list', LIST_WIDTH);
  const down = accounts.filter((a) => !isMetaConnected(a));

  useEffect(() => rememberMeta(platform, selected), [platform, selected]);

  const body = loading ? (
    <Spinner />
  ) : error ? (
    <div className="p-4"><ErrorNote error={error} onRetry={retry} /></div>
  ) : !accounts.length ? (
    <Empty
      icon={PLATFORM_ICON[platform]}
      title={platform === 'messenger' ? text('No Facebook Page yet') : text('No Instagram account yet')}
      hint={onConnect ? text('Connect one to answer its messages from here.') : text('Ask whoever manages your Pages to share one with you.')}
      action={onConnect ? <Button variant="primary" icon="plus" onClick={onConnect}>{platform === 'messenger' ? text('Connect a Page') : text('Connect Instagram')}</Button> : undefined}
    />
  ) : (
    <>
      {down.map((a) => (
        <div key={a.id} role="status" className="mx-3 mb-2 flex items-start gap-2 rounded-[8px] bg-warning-bg p-2.5 text-[12px] text-warning-ink">
          <Icon name="wifi-off" size={14} className="mt-px shrink-0" />
          <span className="min-w-0 flex-1">
            <b className="font-semibold">{text('{name} is not connected.', { name: a.name })}</b> {a.status_note ?? text('Messages to it are not arriving here.')}
          </span>
          {a.can_connect ? (
            <button type="button" onClick={() => onReconnect(a)} className="shrink-0 font-bold underline">{text('Reconnect')}</button>
          ) : null}
        </div>
      ))}
      <div className="min-h-0 flex-1 overflow-y-auto pb-2 scroll-thin">
        {list.isLoading ? <Spinner /> : list.error ? <div className="p-4"><ErrorNote error={list.error} onRetry={() => void list.refetch()} /></div> : null}
        {list.isSuccess && !rows.length ? (
          <Empty icon={PLATFORM_ICON[platform]} title={q.trim() ? text('Nothing matches') : unread ? text('Nothing unread') : text('No conversations yet')} hint={!unread && !q.trim() ? text('Messages people send your accounts appear here.') : undefined} />
        ) : null}
        {rows.map((c) => (
          <ConversationRow key={c.id} c={c} active={String(c.id) === selected} onOpen={() => go(`/chat?channel=${platform}&mc=${c.id}`)} />
        ))}
      </div>
    </>
  );

  return (
    <div className="flex h-full min-w-0 flex-1">
      <SidePanel id="chat" label="the conversations">
        <aside aria-label={text('{platform} conversations', { platform: label })} className="relative flex shrink-0 flex-col border-r border-line bg-surface" style={{ width: width.width }}>
          <ResizeDivider state={width} label="Resize the conversation list" />
          <div className="flex flex-col gap-2 px-3 pt-3 pb-2">
            <div className="flex items-center gap-2">
              <b className="flex-1 truncate text-[15px] text-ink">{label}</b>
              {accounts.length > 1 ? (
                <Select aria-label={text('Account')} value={account} onChange={(e) => setAccount(Number(e.target.value))} className="h-7 max-w-[150px] rounded-[7px] border border-line bg-surface px-1.5 text-[12px] text-ink">
                  <option value={0}>{text('All accounts')}</option>
                  {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                </Select>
              ) : null}
              <button type="button" aria-label={text('{platform} settings', { platform: label })} title={text('{platform} settings', { platform: label })} onClick={onSettings} className="flex h-8 w-8 items-center justify-center rounded-[8px] border border-line text-ink-2 hover:bg-subtle">
                <Icon name="settings" size={15} />
              </button>
            </div>
            {accounts.length ? (
              <>
                <label className="flex h-[34px] items-center gap-2 rounded-[8px] bg-ground px-2.5 text-ink-3">
                  <Icon name="search" size={14} />
                  <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={text('Search names and messages…')} aria-label={text('Search {platform}', { platform: label })} className="min-w-0 flex-1 bg-transparent text-[13px] text-ink outline-none" />
                </label>
                <div role="tablist" aria-label={text('Show')} className="flex gap-1 text-[12px] font-semibold">
                  {([[false, 'All'], [true, 'Unread']] as const).map(([on, name]) => (
                    <button key={name} type="button" role="tab" aria-selected={unread === on} onClick={() => setUnread(on)} className={cx('shrink-0 rounded-full px-2.5 py-1', unread === on ? 'bg-ink text-surface' : 'border border-line text-ink hover:bg-subtle')}>
                      {text(name)}
                    </button>
                  ))}
                </div>
              </>
            ) : null}
          </div>
          {body}
        </aside>
      </SidePanel>
      <div className="flex min-w-0 flex-1 bg-ground">
        {selected ? <MetaThreadView key={selected} id={selected} onReconnect={onReconnect} /> : <Empty icon={PLATFORM_ICON[platform]} title={text('Pick a conversation')} hint={accounts.length ? text('Your {platform} conversations are in the list.', { platform: label }) : undefined} />}
      </div>
    </div>
  );
}

function ConversationRow({ c, active, onOpen }: { c: MetaConversation; active: boolean; onOpen: () => void }) {
  return (
    <button type="button" onClick={onOpen} aria-current={active ? 'true' : undefined} className={cx('flex w-full items-center gap-2.5 px-3.5 py-[7px] text-left', active ? 'bg-selection' : 'hover:bg-subtle')}>
      <Avatar name={c.name} size={34} />
      <span className="min-w-0 flex-1">
        <span className="flex gap-1.5">
          <b className={cx('flex-1 truncate text-[13px] text-ink', !c.unread && 'font-semibold')}>{c.name}</b>
          <span className="shrink-0 text-[11px] text-ink-3">{c.last_message_at ? listStamp(c.last_message_at) : ''}</span>
        </span>
        <span className="block truncate text-[12px] text-ink-3">{metaPreview(c)}</span>
        <span className="flex items-center gap-1 truncate text-[11px] text-ink-3">
          <Icon name={PLATFORM_ICON[c.platform]} size={11} className="shrink-0" />
          <span className="truncate">{accountLabel(c.platform, c.account_name)}</span>
        </span>
      </span>
      {c.unread ? <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-[10.5px] font-bold text-white">{c.unread}</span> : null}
    </button>
  );
}

/** Whether the window is in front, kept current. */
function useVisible(): boolean {
  const [visible, setVisible] = useState(() => document.visibilityState === 'visible');
  useEffect(() => {
    const on = () => setVisible(document.visibilityState === 'visible');
    document.addEventListener('visibilitychange', on);
    return () => document.removeEventListener('visibilitychange', on);
  }, []);
  return visible;
}

function MetaThreadView({ id, onReconnect }: { id: string; onReconnect: (a: MetaAccount) => void }) {
  const qc = useQueryClient();
  const thread = useMetaThread(id);
  const scroller = useRef<HTMLDivElement>(null);
  const data = thread.data;
  const count = data?.messages.length ?? 0;
  const unread = data?.conversation.unread ?? 0;
  const visible = useVisible();

  // Reading a conversation reads it: the list and the toolbar badge follow. Not while the window is in the background.
  useEffect(() => {
    if (!unread || !visible) return;
    void readMeta(id)
      .then(() => qc.invalidateQueries({ queryKey: ['meta'] }))
      .catch(() => undefined);
  }, [id, unread, visible, qc]);

  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [count]);

  if (thread.isLoading) return <Spinner />;
  if (thread.error || !data) return <div className="p-6"><ErrorNote error={thread.error} onRetry={() => void thread.refetch()} /></div>;
  const c = data.conversation;
  const label = PLATFORM_LABEL[c.platform];
  const refusal = c.window.allowed ? null : refusalText(c.window, c.platform, c.account.name);
  const gallery: Attachment[] = data.messages.flatMap((m) => metaAttachment(m) ?? []);

  return (
    <section aria-label={text('{platform} with {name}', { platform: label, name: c.name })} className="flex min-w-0 flex-1 flex-col">
      <header className="flex items-center gap-2.5 border-b border-line bg-surface px-4 py-2.5">
        <Avatar name={c.name} size={34} />
        <span className="min-w-0 flex-1">
          <b className="block truncate text-[14px] text-ink">{c.name}</b>
          <span className="flex items-center gap-1 truncate text-[12px] text-ink-3">
            <Icon name={PLATFORM_ICON[c.platform]} size={12} className="shrink-0" />
            <span className="truncate">{[c.username ? `@${c.username}` : null, text('{platform} · on {account}', { platform: label, account: c.account.name })].filter(Boolean).join(' · ')}</span>
          </span>
        </span>
        {!isMetaConnected(c.account) ? <span className="rounded-full bg-warning-bg px-2 py-px text-[11px] font-semibold text-warning-ink">{text('Not connected')}</span> : null}
      </header>
      <div ref={scroller} className="flex min-h-0 flex-1 flex-col gap-[9px] overflow-y-auto px-4 py-3 scroll-thin">
        {data.has_more ? <div className="self-center text-[11px] text-ink-3">{text('Only the latest 100 messages are shown.')}</div> : null}
        {!data.messages.length ? <Empty icon={PLATFORM_ICON[c.platform]} title={text('No messages yet')} /> : null}
        {data.messages.map((m) => <Bubble key={m.id} m={m} gallery={gallery} />)}
      </div>
      <MetaComposer
        conversationId={c.id}
        platform={c.platform}
        name={c.name}
        refusal={refusal}
        humanAgent={c.window.allowed && c.window.code === 'human_agent' ? c.window.reason : null}
        reconnect={c.window.code === 'not_connected' && c.account.can_connect ? () => onReconnect(c.account) : null}
        onSent={() => void qc.invalidateQueries({ queryKey: ['meta'] })}
      />
    </section>
  );
}

/** A message's time: the time today, the date and time before. */
function sentAt(stamp: string): string {
  return dayKey(parseTs(stamp)) === todayInZone() ? timeLabel(stamp) : `${dateLabel(stamp)}, ${timeLabel(stamp)}`;
}

const TICKS: Record<string, string> = { sent: 'Sent', delivered: 'Delivered', read: 'Seen', failed: 'Not sent', sending: 'Sending' };

const linkOut = (url: string) => void call('app:openInBrowser', { path: url });

function Bubble({ m, gallery }: { m: MetaMessage; gallery: Attachment[] }) {
  const ours = m.direction === 'out';
  const file = metaAttachment(m);
  const shown = file && previewKind(file) === 'image';
  return (
    <div className={cx('flex max-w-[75%] flex-col gap-0.5', ours ? 'items-end self-end' : 'items-start self-start')}>
      <div className={cx('px-3 py-2 text-[13px] whitespace-pre-wrap break-words text-ink', ours ? 'rounded-[12px_4px_12px_12px] bg-selection' : 'rounded-[4px_12px_12px_12px] border border-line bg-surface', m.kind === 'deleted' && 'italic text-ink-3')}>
        {shown ? (
          <button type="button" aria-label={`${text('Open')} ${file.filename}`} onClick={() => openChatAttachment(file, linkOut, gallery)} className="block overflow-hidden rounded-[8px]">
            <img src={mediaUrl(file.url) ?? undefined} alt={file.filename} loading="lazy" className="max-h-[240px] max-w-[280px] object-cover" />
          </button>
        ) : file ? (
          <button type="button" aria-label={`${text('Open')} ${file.filename}`} onClick={() => openChatAttachment(file, linkOut, gallery)} className="flex max-w-full items-center gap-2 rounded-[8px] border border-line bg-surface px-2.5 py-2 text-left hover:bg-subtle">
            <Icon name={m.kind === 'video' ? 'film' : m.kind === 'audio' ? 'music' : 'file-text'} size={16} className="shrink-0 text-ink-3" />
            <span className="min-w-0 truncate font-semibold">{file.filename}</span>
          </button>
        ) : (
          <>
            {m.kind !== 'text' && m.kind !== 'deleted' ? <Icon name="paperclip" size={13} className="mr-1 inline text-ink-3" /> : null}
            {metaMessageText(m)}
            {m.kind === 'share' && m.body ? <span className="block truncate text-[11.5px] text-ink-3">{m.body}</span> : null}
            {m.media_note ? <span className="block text-[11.5px] text-ink-3">{m.media_note}</span> : null}
          </>
        )}
      </div>
      <span className={cx('text-[11px]', m.status === 'failed' ? 'font-semibold text-danger' : 'text-ink-3')}>
        {ours && m.sender_name ? `${m.sender_name} · ` : ''}
        {sentAt(m.sent_at ?? m.created_at)}
        {ours && m.status ? ` · ${text(TICKS[m.status] ?? m.status)}` : ''}
        {ours && m.tag === 'HUMAN_AGENT' ? ` · ${text('Human Agent')}` : ''}
        {m.status === 'failed' && (m.error_text || m.error_code) ? ` — ${sendErrorText(m.error_code, m.error_text)}` : ''}
      </span>
    </div>
  );
}

/**
 * The reply box: what is typed is kept per conversation. Files from this computer go out first and the words after
 * them, within what the platform carries. Closed, with the reason, when nothing can be sent.
 */
function MetaComposer({ conversationId, platform, name, refusal, humanAgent, reconnect, onSent }: {
  conversationId: number;
  platform: MetaPlatform;
  name: string;
  refusal: string | null;
  humanAgent: string | null;
  reconnect: (() => void) | null;
  onSent: () => void;
}) {
  const draft = useDraft<string>('meta', `conversation:${conversationId}`, '');
  const [sending, setSending] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const picker = useRef<HTMLInputElement>(null);
  const value = draft.value;
  const label = PLATFORM_LABEL[platform];

  const choose = (e: ChangeEvent<HTMLInputElement>) => {
    const picked = [...(e.target.files ?? [])];
    e.target.value = '';
    const refused = picked.map((f) => metaFileRefusal(platform, f)).filter((r): r is string => !!r);
    if (refused.length) toast('error', refused.join(' '));
    setFiles((now) => [...now, ...picked.filter((f) => !metaFileRefusal(platform, f))].slice(0, 10));
  };

  const send = async () => {
    const body = value.trim();
    if ((!body && !files.length) || sending || refusal) return;
    setSending(true);
    try {
      if (files.length) {
        const r = await sendMetaFiles(conversationId, files, body);
        if (r.failed > 0) {
          const first = r.results.find((x) => !x.ok);
          toast('error', `${r.sent ? text('{sent} sent, {failed} not sent.', { sent: r.sent, failed: r.failed }) : text('Not sent.')} ${first ? `${first.name ? `${first.name}: ` : ''}${sendErrorText(first.code, first.error)}` : ''}`.trim());
          setFiles((now) => now.filter((f) => r.results.some((x) => !x.ok && x.name === f.name)));
          onSent();
          return;
        }
        setFiles([]);
      } else {
        const r = await sendMeta(conversationId, body);
        if (!r.ok) {
          toast('error', `${sendErrorText(r.code, r.error)} ${text('Your message is kept.')}`);
          onSent();
          return;
        }
      }
      draft.setValue('');
      await draft.clear();
      onSent();
    } catch (e) {
      toast('error', `${text('Not sent.')} ${errorMessage(e)} ${text('Your message is kept.')}`);
    } finally {
      setSending(false);
    }
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void send();
    }
  };

  return (
    <div className="border-t border-line bg-surface px-4 py-3">
      {refusal ? (
        <p role="status" className="mb-2 flex flex-wrap items-center gap-2 rounded-[8px] bg-subtle p-2 text-[12px] text-ink-2">
          <Icon name="info" size={14} className="shrink-0 text-ink-3" />
          <span className="min-w-0 flex-1">{refusal}</span>
          {reconnect ? <Button size="sm" icon="refresh" onClick={reconnect}>{text('Reconnect')}</Button> : null}
        </p>
      ) : humanAgent ? (
        <p role="status" className="mb-2 flex items-center gap-2 rounded-[8px] bg-subtle p-2 text-[12px] text-ink-2">
          <Icon name="clock" size={14} className="shrink-0 text-ink-3" />
          <span className="min-w-0 flex-1">{humanAgent}</span>
        </p>
      ) : null}
      {files.length ? (
        <ul aria-label={text('Files to send')} className="mb-2 flex flex-wrap gap-1.5">
          {files.map((f, i) => (
            <li key={`${f.name}-${i}`} className="flex max-w-[220px] items-center gap-1.5 rounded-[8px] border border-line bg-ground px-2 py-1 text-[12px] text-ink">
              <Icon name="paperclip" size={12} className="shrink-0 text-ink-3" />
              <span className="min-w-0 truncate">{f.name}</span>
              <button type="button" aria-label={`${text('Remove')} ${f.name}`} onClick={() => setFiles((now) => now.filter((_, j) => j !== i))} className="shrink-0 text-ink-3 hover:text-ink">
                <Icon name="x" size={12} />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <div className="flex items-end gap-2">
        <input ref={picker} type="file" multiple hidden accept={ACCEPT[platform]} onChange={choose} aria-hidden tabIndex={-1} />
        <button type="button" aria-label={text('Attach files')} title={text('Attach files')} disabled={!!refusal} onClick={() => picker.current?.click()} className="flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-[10px] border border-line text-ink-2 hover:bg-subtle disabled:opacity-50">
          <Icon name="paperclip" size={16} />
        </button>
        <textarea
          value={value}
          onChange={(e) => draft.setValue(e.target.value)}
          onKeyDown={onKeyDown}
          disabled={!!refusal}
          rows={Math.min(6, Math.max(1, value.split('\n').length))}
          maxLength={2000}
          placeholder={refusal ? text('Replies are closed') : files.length ? text('Add a message') : text('Message {name} on {platform}', { name, platform: label })}
          aria-label={text('Message {name} on {platform}', { name, platform: label })}
          className="min-h-[38px] flex-1 resize-none rounded-[10px] border border-line bg-ground px-3 py-2 text-[13px] text-ink outline-none focus:border-primary disabled:opacity-60"
        />
        <Button variant="primary" icon="send" disabled={(!value.trim() && !files.length) || !!refusal} loading={sending} onClick={() => void send()} aria-label={text('Send')}>
          {text('Send')}
        </Button>
      </div>
    </div>
  );
}
