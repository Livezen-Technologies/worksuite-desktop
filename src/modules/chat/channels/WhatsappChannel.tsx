import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { call, errorMessage } from '../../../core/bridge';
import { useDraft } from '../../../core/drafts';
import { useTab, useTabTitle } from '../../../core/tab-context';
import { dateLabel, dayKey, listStamp, parseTs, timeLabel, todayInZone } from '../../../core/time';
import { toast } from '../../../core/toasts';
import { Icon } from '../../../components/Icon';
import { ResizeDivider, useResizableWidth } from '../../../components/ResizeDivider';
import { Select } from '../../../components/Select';
import { SidePanel } from '../../../components/SidePanel';
import { Avatar, Button, Empty, ErrorNote, Spinner, cx } from '../../../components/ui';
import { LIST_WIDTH, rememberWhatsapp } from './channels';
import { isConnected, messageText, preview, readWa, sendWa, useWaChats, useWaThread, WA_SCOPES, type WaAccount, type WaChat, type WaMessage, type WaScope } from './whatsapp';

/**
 * WhatsApp in Chat (worksuite-desktop#33): the conversations on the numbers shared with this person in the list, the
 * chosen one beside it, answered from here. A number that is not connected says so above the list, with the way to
 * link it again for whoever may.
 */
export function WhatsappChannel({ accounts, loading, error, retry, onConnect, onRelink }: {
  accounts: WaAccount[];
  loading: boolean;
  error: unknown;
  retry: () => void;
  onConnect: (() => void) | null;
  onRelink: (a: WaAccount) => void;
}) {
  const { query, go } = useTab();
  const selected = query.get('wa');
  const [account, setAccount] = useState(0);
  const [scope, setScope] = useState<WaScope>('all');
  const [q, setQ] = useState('');
  const chats = useWaChats({ account, scope, q }, accounts.length > 0);
  const rows = chats.data?.chats ?? [];
  const current = rows.find((c) => String(c.id) === selected);
  useTabTitle(current ? `WhatsApp · ${current.name}` : selected ? null : 'WhatsApp');
  const list = useResizableWidth('chat.list', LIST_WIDTH);
  const down = accounts.filter((a) => !isConnected(a));

  useEffect(() => rememberWhatsapp(selected), [selected]);

  const body = loading ? (
    <Spinner />
  ) : error ? (
    <div className="p-4"><ErrorNote error={error} onRetry={retry} /></div>
  ) : !accounts.length ? (
    <Empty
      icon="phone"
      title="No WhatsApp number yet"
      hint={onConnect ? 'Connect a number to answer customers from here.' : 'Ask whoever manages WhatsApp numbers to share one with you.'}
      action={onConnect ? <Button variant="primary" icon="plus" onClick={onConnect}>Connect a number</Button> : undefined}
    />
  ) : (
    <>
      {down.map((a) => (
        <div key={a.id} role="status" className="mx-3 mb-2 flex items-start gap-2 rounded-[8px] bg-warning-bg p-2.5 text-[12px] text-[#9A4A06] dark:text-warning">
          <Icon name="wifi-off" size={14} className="mt-px shrink-0" />
          <span className="min-w-0 flex-1">
            <b className="font-semibold">{a.name} is not connected.</b> {a.status_note ?? 'Messages to and from it wait until it is linked again.'}
          </span>
          {a.provider === 'web_js' && a.can_connect ? (
            <button type="button" onClick={() => onRelink(a)} className="shrink-0 font-bold underline">Link again</button>
          ) : (
            <button type="button" onClick={() => void call('app:openInBrowser', { path: '/whatsapp' })} className="shrink-0 font-bold underline">Open on the web</button>
          )}
        </div>
      ))}
      <div className="min-h-0 flex-1 overflow-y-auto pb-2 scroll-thin">
        {chats.isLoading ? <Spinner /> : chats.error ? <div className="p-4"><ErrorNote error={chats.error} onRetry={() => void chats.refetch()} /></div> : null}
        {chats.isSuccess && !rows.length ? (
          <Empty icon="phone" title={q.trim() ? 'Nothing matches' : scope === 'unread' ? 'Nothing unread' : scope === 'waiting' ? 'Nobody is waiting' : scope === 'mine' ? 'No conversations assigned to you' : 'No WhatsApp conversations yet'} hint={scope === 'all' && !q.trim() ? 'Messages to your numbers appear here.' : undefined} />
        ) : null}
        {rows.map((c) => (
          <ChatRow key={c.id} c={c} active={String(c.id) === selected} many={accounts.length > 1 && !account} onOpen={() => go(`/chat?channel=whatsapp&wa=${c.id}`)} />
        ))}
      </div>
    </>
  );

  return (
    <div className="flex h-full min-w-0 flex-1">
      <SidePanel id="chat" label="the conversations">
        <aside aria-label="WhatsApp conversations" className="relative flex shrink-0 flex-col border-r border-line bg-surface" style={{ width: list.width }}>
          <ResizeDivider state={list} label="Resize the conversation list" />
          <div className="flex flex-col gap-2 px-3 pt-3 pb-2">
            <div className="flex items-center gap-2">
              <b className="flex-1 truncate text-[15px] text-ink">WhatsApp</b>
              {accounts.length > 1 ? (
                <Select aria-label="Number" value={account} onChange={(e) => setAccount(Number(e.target.value))} className="h-7 max-w-[150px] rounded-[7px] border border-line bg-surface px-1.5 text-[12px] text-ink">
                  <option value={0}>All numbers</option>
                  {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                </Select>
              ) : null}
              <button type="button" aria-label="Open WhatsApp on the web" title="Broadcasts, templates and settings, on the web" onClick={() => void call('app:openInBrowser', { path: '/whatsapp' })} className="flex h-8 w-8 items-center justify-center rounded-[8px] border border-line text-ink-2 hover:bg-subtle">
                <Icon name="external" size={15} />
              </button>
            </div>
            {accounts.length ? (
              <>
                <label className="flex h-[34px] items-center gap-2 rounded-[8px] bg-ground px-2.5 text-ink-3">
                  <Icon name="search" size={14} />
                  <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search names, numbers and messages…" aria-label="Search WhatsApp" className="min-w-0 flex-1 bg-transparent text-[13px] text-ink outline-none" />
                </label>
                <div role="tablist" aria-label="Show" className="flex gap-1 text-[12px] font-semibold">
                  {WA_SCOPES.map((s) => (
                    <button key={s.id} type="button" role="tab" aria-selected={scope === s.id} onClick={() => setScope(s.id)} className={cx('shrink-0 rounded-full px-2.5 py-1', scope === s.id ? 'bg-ink text-surface' : 'border border-line text-ink hover:bg-subtle')}>
                      {s.label}
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
        {selected ? <WhatsappThread key={selected} id={selected} /> : <Empty icon="phone" title="Pick a conversation" hint={accounts.length ? 'Your WhatsApp conversations are in the list.' : undefined} />}
      </div>
    </div>
  );
}

function ChatRow({ c, active, many, onOpen }: { c: WaChat; active: boolean; many: boolean; onOpen: () => void }) {
  const waiting = c.waiting_minutes !== null && c.status !== 'resolved';
  return (
    <button type="button" onClick={onOpen} aria-current={active ? 'true' : undefined} className={cx('flex w-full items-center gap-2.5 px-3.5 py-[7px] text-left', active ? 'bg-selection' : 'hover:bg-subtle')}>
      <Avatar name={c.name} size={34} className={c.kind === 'group' ? '!rounded-[9px]' : ''} />
      <span className="min-w-0 flex-1">
        <span className="flex gap-1.5">
          <b className={cx('flex-1 truncate text-[13px] text-ink', !c.unread && 'font-semibold')}>{c.name}</b>
          <span className="shrink-0 text-[11px] text-ink-3">{c.last_message_at ? listStamp(c.last_message_at) : ''}</span>
        </span>
        <span className="block truncate text-[12px] text-ink-3">{many ? `${c.account_name} · ` : ''}{c.is_muted ? 'Muted · ' : ''}{preview(c)}</span>
      </span>
      {c.unread ? (
        <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-[10.5px] font-bold text-white">{c.unread}</span>
      ) : waiting ? (
        <span className={cx('rounded-full px-1.5 text-[10.5px] font-bold text-white', c.overdue ? 'bg-danger' : 'bg-badge')}>Waiting</span>
      ) : null}
    </button>
  );
}

function WhatsappThread({ id }: { id: string }) {
  const qc = useQueryClient();
  const thread = useWaThread(id);
  const scroller = useRef<HTMLDivElement>(null);
  const data = thread.data;
  const count = data?.messages.length ?? 0;
  const unread = data?.chat.unread ?? 0;

  // Reading a conversation reads it: the list, the toolbar badge and the customer's ticks follow. Not while the
  // window is in the background, where a message that arrives has not been seen.
  const visible = useVisible();
  useEffect(() => {
    if (!unread || !visible) return;
    void readWa(id)
      .then(() => qc.invalidateQueries({ queryKey: ['whatsapp'] }))
      .catch(() => undefined);
  }, [id, unread, visible, qc]);

  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [count]);

  if (thread.isLoading) return <Spinner />;
  if (thread.error || !data) return <div className="p-6"><ErrorNote error={thread.error} onRetry={() => void thread.refetch()} /></div>;
  const { chat } = data;
  const down = !isConnected(chat.account);
  const refusal = !data.can_send ? 'You can read this number’s conversations but not answer them.' : down ? `${chat.account.name} is not connected, so nothing can be sent until it is linked again.` : !chat.window.allowed ? `${chat.window.reason ?? 'Only an approved template can be sent now.'} Templates are sent from WhatsApp on the web.` : null;

  return (
    <section aria-label={`WhatsApp with ${chat.name}`} className="flex min-w-0 flex-1 flex-col">
      <header className="flex items-center gap-2.5 border-b border-line bg-surface px-4 py-2.5">
        <Avatar name={chat.name} size={34} />
        <span className="min-w-0 flex-1">
          <b className="block truncate text-[14px] text-ink">{chat.name}</b>
          <span className="block truncate text-[12px] text-ink-3">+{chat.wa_id} · on {chat.account.name}</span>
        </span>
        <Button size="sm" icon="external" onClick={() => void call('app:openInBrowser', { path: `/whatsapp?chat=${chat.id}` })}>Open on the web</Button>
      </header>
      <div ref={scroller} className="flex min-h-0 flex-1 flex-col gap-[9px] overflow-y-auto px-4 py-3 scroll-thin">
        {data.has_more ? <div className="self-center text-[11px] text-ink-3">Earlier messages are on the web.</div> : null}
        {!data.messages.length ? <Empty icon="phone" title="No messages yet" /> : null}
        {data.messages.map((m) => <Bubble key={m.id} m={m} />)}
      </div>
      <WhatsappComposer chatId={chat.id} name={chat.name} refusal={refusal} onSent={() => void qc.invalidateQueries({ queryKey: ['whatsapp'] })} />
    </section>
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

/** A message's time: the time today, the date and time before. */
function sentAt(stamp: string): string {
  return dayKey(parseTs(stamp)) === todayInZone() ? timeLabel(stamp) : `${dateLabel(stamp)}, ${timeLabel(stamp)}`;
}

const TICKS: Record<string, string> = { sent: 'Sent', delivered: 'Delivered', read: 'Read', failed: 'Not sent', queued: 'Sending', pending: 'Sending' };

function Bubble({ m }: { m: WaMessage }) {
  const ours = m.direction === 'out';
  return (
    <div className={cx('flex max-w-[75%] flex-col gap-0.5', ours ? 'items-end self-end' : 'items-start self-start')}>
      <div className={cx('px-3 py-2 text-[13px] whitespace-pre-wrap break-words text-ink', ours ? 'rounded-[12px_4px_12px_12px] bg-selection' : 'rounded-[4px_12px_12px_12px] border border-line bg-surface')}>
        {m.kind !== 'text' && m.kind !== 'template' ? <Icon name="paperclip" size={13} className="mr-1 inline text-ink-3" /> : null}
        {messageText(m)}
      </div>
      <span className={cx('text-[11px]', m.status === 'failed' ? 'font-semibold text-danger' : 'text-ink-3')}>
        {ours && m.sender_name ? `${m.sender_name} · ` : ''}
        {sentAt(m.sent_at ?? m.created_at)}
        {ours && m.status ? ` · ${TICKS[m.status] ?? m.status}` : ''}
        {m.status === 'failed' && m.error_text ? ` — ${m.error_text}` : ''}
      </span>
    </div>
  );
}

/** The reply box. What is typed is kept per conversation, so switching channel or conversation loses nothing. */
function WhatsappComposer({ chatId, name, refusal, onSent }: { chatId: number; name: string; refusal: string | null; onSent: () => void }) {
  const draft = useDraft<string>('whatsapp', `chat:${chatId}`, '');
  const [sending, setSending] = useState(false);
  const text = draft.value;

  const send = async () => {
    const body = text.trim();
    if (!body || sending || refusal) return;
    setSending(true);
    try {
      const r = await sendWa(chatId, body);
      if (r.ok === false) {
        toast('error', `Not sent. ${r.error ?? ''} Your message is kept.`.trim());
        onSent();
        return;
      }
      draft.setValue('');
      await draft.clear();
      onSent();
    } catch (e) {
      toast('error', `Not sent. ${errorMessage(e)} Your message is kept.`);
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
      {refusal ? <p role="status" className="mb-2 rounded-[8px] bg-subtle p-2 text-[12px] text-ink-2">{refusal}</p> : null}
      <div className="flex items-end gap-2">
        <textarea
          value={text}
          onChange={(e) => draft.setValue(e.target.value)}
          onKeyDown={onKeyDown}
          rows={Math.min(6, Math.max(1, text.split('\n').length))}
          maxLength={4000}
          placeholder={`Message ${name} on WhatsApp`}
          aria-label={`Message ${name} on WhatsApp`}
          className="min-h-[38px] flex-1 resize-none rounded-[10px] border border-line bg-ground px-3 py-2 text-[13px] text-ink outline-none focus:border-primary"
        />
        <Button variant="primary" icon="send" disabled={!text.trim() || !!refusal} loading={sending} onClick={() => void send()} aria-label="Send">
          Send
        </Button>
      </div>
    </div>
  );
}
