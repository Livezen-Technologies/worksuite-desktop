import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState, type ChangeEvent, type KeyboardEvent } from 'react';
import { call, errorMessage } from '../../../core/bridge';
import { useDraft } from '../../../core/drafts';
import { text as l10n } from '../../../core/i18n';
import { useTab, useTabTitle } from '../../../core/tab-context';
import { dateLabel, dayKey, listStamp, parseTs, timeLabel, todayInZone } from '../../../core/time';
import { toast } from '../../../core/toasts';
import { Icon } from '../../../components/Icon';
import { ResizeDivider, useResizableWidth } from '../../../components/ResizeDivider';
import { Select } from '../../../components/Select';
import { SidePanel } from '../../../components/SidePanel';
import { Avatar, Button, Empty, ErrorNote, Modal, Spinner, cx } from '../../../components/ui';
import { openChatAttachment, previewKind, type Attachment } from '../AttachmentViewer';
import { mediaUrl } from '../types';
import { useChatSavedReplies, type Turn } from '../replies';
import { inSlashMenu, SlashMenu, type SlashMenuHandle } from '../SlashMenu';
import { savedReplyQuery } from '../website/profile';
import { LIST_WIDTH, rememberWhatsapp } from './channels';
import {
  fileRefusal, isConnected, messageText, preview, readWa, sendWa, sendWaFiles, sendWaTemplate, startWa, useWaChats, useWaSettings, useWaTemplates, useWaThread, waAttachment, waLimits, WA_SCOPES,
  type WaAccount, type WaChat, type WaMessage, type WaScope, type WaTemplate,
} from './whatsapp';

/**
 * WhatsApp in Chat (worksuite-desktop#33, #35): the conversations on the numbers shared with this person in the list,
 * the chosen one beside it, answered from here — text, files and, once the 24-hour window has closed, an approved
 * template. A number that is not connected says so above the list, with the way to link it again for whoever may;
 * the gear opens the channel's settings. `?to=<number>` (Contacts, the web's links) starts a conversation with it.
 */
export function WhatsappChannel({ accounts, loading, error, retry, onConnect, onRelink, onSettings }: {
  accounts: WaAccount[];
  loading: boolean;
  error: unknown;
  retry: () => void;
  onConnect: (() => void) | null;
  onRelink: (a: WaAccount) => void;
  onSettings?: () => void;
}) {
  const { query, go } = useTab();
  const selected = query.get('wa');
  const to = query.get('to');
  const [starting, setStarting] = useState(false);
  const senders = accounts.filter((a) => a.can_send !== false && isConnected(a));
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
              {onSettings ? (
                <button type="button" aria-label={l10n('WhatsApp settings')} title={l10n('WhatsApp settings')} onClick={onSettings} className="flex h-8 w-8 items-center justify-center rounded-[8px] border border-line text-ink-2 hover:bg-subtle">
                  <Icon name="settings" size={15} />
                </button>
              ) : null}
              {senders.length ? (
                <button type="button" aria-label={l10n('New WhatsApp conversation')} title={l10n('New WhatsApp conversation')} onClick={() => setStarting(true)} className="flex h-8 w-8 items-center justify-center rounded-[8px] bg-primary text-white hover:bg-primary-hover">
                  <Icon name="plus" size={17} />
                </button>
              ) : null}
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
      {(starting || (to && !selected)) && !loading ? (
        <StartConversation
          accounts={senders}
          phone={starting ? '' : (to ?? '')}
          onClose={() => {
            setStarting(false);
            if (to) go('/chat?channel=whatsapp');
          }}
          onStarted={(id) => {
            setStarting(false);
            go(`/chat?channel=whatsapp&wa=${id}`);
          }}
        />
      ) : null}
    </div>
  );
}

/** A conversation with a number, on one of your numbers: the server finds the one there is, or starts it. */
function StartConversation({ accounts, phone, onClose, onStarted }: { accounts: WaAccount[]; phone: string; onClose: () => void; onStarted: (id: number) => void }) {
  const [number, setNumber] = useState(phone);
  const [from, setFrom] = useState(() => (accounts.find((a) => a.is_default) ?? accounts[0])?.id ?? 0);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const digits = number.replace(/\D+/g, '');
  const usable = digits.length >= 8 && from > 0 && !busy;
  const start = async () => {
    if (!usable) return;
    setBusy(true);
    setProblem(null);
    try {
      const r = await startWa(from, digits);
      onStarted(r.chat_id);
    } catch (e) {
      setProblem(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title={l10n('New WhatsApp conversation')}
      onClose={onClose}
      width={420}
      footer={
        <>
          <Button onClick={onClose}>{l10n('Cancel')}</Button>
          {accounts.length ? <Button variant="primary" disabled={!usable} loading={busy} onClick={() => void start()}>{l10n('Start')}</Button> : null}
        </>
      }
    >
      {!accounts.length ? (
        <p className="text-[12.5px] text-ink-2">{l10n('None of your WhatsApp numbers can send now. Connect one, or ask for one to be shared with you.')}</p>
      ) : (
        <form
          className="flex flex-col gap-3 text-[12.5px]"
          onSubmit={(e) => {
            e.preventDefault();
            void start();
          }}
        >
          <label className="flex flex-col gap-1 font-semibold text-ink">
            {l10n('Phone number')}
            <input autoFocus value={number} onChange={(e) => setNumber(e.target.value)} inputMode="tel" placeholder="+94 77 123 4567" className="h-[34px] rounded-[8px] border border-line bg-surface px-2.5 text-[13px] font-medium outline-none focus:border-primary" />
            <span className="font-normal text-ink-3">{l10n('With the country code. Until they write back, only an approved template reaches them.')}</span>
          </label>
          {accounts.length > 1 ? (
            <label className="flex flex-col gap-1 font-semibold text-ink">
              {l10n('Send from')}
              <Select value={from} onChange={(e) => setFrom(Number(e.target.value))} className="h-[34px] rounded-[8px] border border-line bg-surface px-2 text-[13px] font-medium">
                {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </Select>
            </label>
          ) : null}
          {problem ? <p role="alert" className="rounded-[8px] bg-danger-bg p-2.5 text-danger">{problem}</p> : null}
        </form>
      )}
    </Modal>
  );
}

function ChatRow({ c, active, many, onOpen }: { c: WaChat; active: boolean; many: boolean; onOpen: () => void }) {
  const waiting = c.waiting_minutes !== null && c.status !== 'resolved';
  return (
    <button type="button" onClick={onOpen} aria-current={active ? 'true' : undefined} className={cx('flex w-full items-center gap-2.5 px-3.5 py-[7px] text-left', active ? 'bg-selection' : 'hover:bg-subtle')}>
      <Avatar name={c.name} size={34} src={mediaUrl(c.avatar_url)} className={c.kind === 'group' ? '!rounded-[9px]' : ''} />
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
  // Text and files need the 24-hour window; an approved template does not (the rule WhatsApp enforces, and the server).
  const blocked = !data.can_send ? 'You can read this number’s conversations but not answer them.' : down ? `${chat.account.name} is not connected, so nothing can be sent until it is linked again.` : null;
  const refusal = blocked ?? (!chat.window.allowed ? `${chat.window.reason ?? 'Only an approved template can be sent now.'} ${l10n('Send an approved template instead.')}` : null);
  const gallery: Attachment[] = data.messages.flatMap((m) => waAttachment(m) ?? []);

  return (
    <section aria-label={`WhatsApp with ${chat.name}`} className="flex min-w-0 flex-1 flex-col">
      <header className="flex items-center gap-2.5 border-b border-line bg-surface px-4 py-2.5">
        <Avatar name={chat.name} size={34} src={mediaUrl(chat.avatar_url)} />
        <span className="min-w-0 flex-1">
          <b className="block truncate text-[14px] text-ink">{chat.name}</b>
          <span className="block truncate text-[12px] text-ink-3">+{chat.wa_id} · on {chat.account.name}</span>
        </span>
        <Button size="sm" icon="external" onClick={() => void call('app:openInBrowser', { path: `/whatsapp?chat=${chat.id}` })}>Open on the web</Button>
      </header>
      <div ref={scroller} className="flex min-h-0 flex-1 flex-col gap-[9px] overflow-y-auto px-4 py-3 scroll-thin">
        {data.has_more ? <div className="self-center text-[11px] text-ink-3">Earlier messages are on the web.</div> : null}
        {!data.messages.length ? <Empty icon="phone" title="No messages yet" /> : null}
        {data.messages.map((m) => <Bubble key={m.id} m={m} gallery={gallery} />)}
      </div>
      <WhatsappComposer chatId={chat.id} accountId={chat.account_id} name={chat.name} messages={data.messages} refusal={refusal} templates={!blocked} onSent={() => void qc.invalidateQueries({ queryKey: ['whatsapp'] })} />
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

const linkOut = (url: string) => void call('app:openInBrowser', { path: url });

/** A message: its words, and its attachment — a picture shown, anything else by its name — opened in the shared preview. */
function Bubble({ m, gallery }: { m: WaMessage; gallery: Attachment[] }) {
  const ours = m.direction === 'out';
  const file = waAttachment(m);
  return (
    <div className={cx('flex max-w-[75%] flex-col gap-0.5', ours ? 'items-end self-end' : 'items-start self-start')}>
      <div className={cx('px-3 py-2 text-[13px] whitespace-pre-wrap break-words text-ink', ours ? 'rounded-[12px_4px_12px_12px] bg-selection' : 'rounded-[4px_12px_12px_12px] border border-line bg-surface')}>
        {file && previewKind(file) === 'image' ? (
          <button type="button" aria-label={`${l10n('Open')} ${file.filename}`} onClick={() => openChatAttachment(file, linkOut, gallery)} className="mb-1 block overflow-hidden rounded-[8px]">
            <img src={mediaUrl(file.url) ?? undefined} alt={file.filename} loading="lazy" className="max-h-[240px] max-w-[280px] object-cover" />
          </button>
        ) : file ? (
          <button type="button" aria-label={`${l10n('Open')} ${file.filename}`} onClick={() => openChatAttachment(file, linkOut, gallery)} className="mb-1 flex max-w-full items-center gap-2 rounded-[8px] border border-line bg-surface px-2.5 py-2 text-left hover:bg-subtle">
            <Icon name="file-text" size={16} className="shrink-0 text-ink-3" />
            <span className="min-w-0 truncate font-semibold">{file.filename}</span>
          </button>
        ) : m.kind !== 'text' && m.kind !== 'template' ? (
          <Icon name="paperclip" size={13} className="mr-1 inline text-ink-3" />
        ) : null}
        {file ? (m.caption ?? '') : messageText(m)}
        {!file && m.media_note ? <span className="block text-[11.5px] text-ink-3">{m.media_note}</span> : null}
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

/**
 * The reply box. What is typed is kept per conversation, so switching channel or conversation loses nothing. Files
 * from this computer go with the words as their caption, within what the workspace allows; once the 24-hour window
 * has closed, an approved template is what can be sent (`templates`: this person may send on the number).
 */
function WhatsappComposer({ chatId, accountId, name, messages, refusal, templates, onSent }: { chatId: number; accountId: number; name: string; messages: WaMessage[]; refusal: string | null; templates: boolean; onSent: () => void }) {
  const draft = useDraft<string>('whatsapp', `chat:${chatId}`, '');
  const [sending, setSending] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const [picking, setPicking] = useState(false);
  const text = draft.value;
  const settings = useWaSettings(true);
  const limits = waLimits(settings.data?.settings);
  const picker = useRef<HTMLInputElement>(null);
  // The "/" menu (worksuite-desktop#32): saved replies and suggestions, into the box, never sent by themselves.
  const [slash, setSlash] = useState<{ start: number; word: string } | null>(null);
  const slashMenu = useRef<SlashMenuHandle>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const replies = useChatSavedReplies(slash !== null);
  const conversation = (): Turn[] => messages.map((m) => ({ mine: m.direction === 'out', name: m.direction === 'out' ? (m.sender_name ?? 'Me') : name, text: messageText(m) }));
  const insertSlash = (body: string) => {
    const start = slash?.start ?? text.length;
    const end = slash ? slash.start + 1 + slash.word.length : start;
    draft.setValue(`${text.slice(0, start)}${body}${text.slice(end)}`);
    setSlash(null);
    requestAnimationFrame(() => {
      input.current?.focus();
      input.current?.setSelectionRange(start + body.length, start + body.length);
    });
  };

  const choose = (e: ChangeEvent<HTMLInputElement>) => {
    const picked = [...(e.target.files ?? [])];
    e.target.value = '';
    const refused = picked.map((f) => fileRefusal(f, limits)).filter((r): r is string => !!r);
    if (refused.length) toast('error', refused.join(' '));
    setFiles((now) => [...now, ...picked.filter((f) => !fileRefusal(f, limits))].slice(0, 10));
  };

  const send = async () => {
    const body = text.trim();
    if ((!body && !files.length) || sending || refusal) return;
    setSending(true);
    try {
      if (files.length) {
        const r = await sendWaFiles(chatId, files, body);
        if (r.failed > 0) {
          const first = r.results.find((x) => !x.ok);
          toast('error', `${r.sent ? `${r.sent} sent, ${r.failed} refused.` : 'Not sent.'} ${first?.error ? `${first.name}: ${first.error}` : ''}`.trim());
          setFiles((now) => now.filter((f) => r.results.some((x) => !x.ok && x.name === f.name)));
          onSent();
          return;
        }
        setFiles([]);
      } else {
        const r = await sendWa(chatId, body);
        if (r.ok === false) {
          toast('error', `Not sent. ${r.error ?? ''} Your message is kept.`.trim());
          onSent();
          return;
        }
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
    if (slash && slashMenu.current?.onKey(e)) return;
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void send();
    }
  };
  const anyKind = Object.values(limits.kinds).some(Boolean);

  return (
    <div className="border-t border-line bg-surface px-4 py-3">
      {refusal ? (
        <p role="status" className="mb-2 flex flex-wrap items-center gap-2 rounded-[8px] bg-subtle p-2 text-[12px] text-ink-2">
          <span className="min-w-0 flex-1">{refusal}</span>
          {templates ? <Button size="sm" icon="file-text" onClick={() => setPicking(true)}>{l10n('Send a template')}</Button> : null}
        </p>
      ) : null}
      {files.length ? (
        <ul aria-label={l10n('Files to send')} className="mb-2 flex flex-wrap gap-1.5">
          {files.map((f, i) => (
            <li key={`${f.name}-${i}`} className="flex max-w-[220px] items-center gap-1.5 rounded-[8px] border border-line bg-ground px-2 py-1 text-[12px] text-ink">
              <Icon name="paperclip" size={12} className="shrink-0 text-ink-3" />
              <span className="min-w-0 truncate">{f.name}</span>
              <button type="button" aria-label={`${l10n('Remove')} ${f.name}`} onClick={() => setFiles((now) => now.filter((_, j) => j !== i))} className="shrink-0 text-ink-3 hover:text-ink">
                <Icon name="x" size={12} />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <div className="relative flex items-end gap-2">
        {slash ? (
          <SlashMenu
            ref={slashMenu}
            word={slash.word}
            replies={replies}
            context={conversation}
            onInsert={insertSlash}
            onClose={() => (setSlash(null), input.current?.focus())}
          />
        ) : null}
        {anyKind ? (
          <>
            <input ref={picker} type="file" multiple hidden onChange={choose} aria-hidden tabIndex={-1} />
            <button type="button" aria-label={l10n('Attach files')} title={l10n('Attach files')} disabled={!!refusal} onClick={() => picker.current?.click()} className="flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-[10px] border border-line text-ink-2 hover:bg-subtle disabled:opacity-50">
              <Icon name="paperclip" size={16} />
            </button>
          </>
        ) : null}
        <textarea
          ref={input}
          value={text}
          onChange={(e) => {
            draft.setValue(e.target.value);
            setSlash(savedReplyQuery(e.target.value, e.target.selectionStart ?? e.target.value.length));
          }}
          onBlur={(e) => !inSlashMenu(e.relatedTarget) && setSlash(null)}
          onKeyDown={onKeyDown}
          rows={Math.min(6, Math.max(1, text.split('\n').length))}
          maxLength={4000}
          placeholder={files.length ? l10n('Add a caption') : `Message ${name} on WhatsApp · / for replies`}
          aria-label={`Message ${name} on WhatsApp`}
          className="min-h-[38px] flex-1 resize-none rounded-[10px] border border-line bg-ground px-3 py-2 text-[13px] text-ink outline-none focus:border-primary"
        />
        <Button variant="primary" icon="send" disabled={(!text.trim() && !files.length) || !!refusal} loading={sending} onClick={() => void send()} aria-label="Send">
          Send
        </Button>
      </div>
      {picking ? <TemplatePicker chatId={chatId} accountId={accountId} onClose={() => setPicking(false)} onSent={() => (setPicking(false), onSent())} /> : null}
    </div>
  );
}

/** Sending an approved template: the ones this number may use, each placeholder filled in, the result seen first. */
function TemplatePicker({ chatId, accountId, onClose, onSent }: { chatId: number; accountId: number; onClose: () => void; onSent: () => void }) {
  const list = useWaTemplates(accountId, true);
  const [chosen, setChosen] = useState<WaTemplate | null>(null);
  const [values, setValues] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState(false);
  const filled = chosen ? chosen.body.replace(/\{\{(\d+)\}\}/g, (all, n: string) => values[Number(n)] || all) : '';
  const ready = !!chosen && chosen.slots.every((n) => (values[n] ?? '').trim() !== '') && !busy;
  const send = async () => {
    if (!chosen || !ready) return;
    setBusy(true);
    try {
      const r = await sendWaTemplate(chatId, chosen.id, chosen.slots.map((n) => values[n]!.trim()));
      if (r.ok === false) toast('error', `Not sent. ${r.error ?? ''}`.trim());
      else onSent();
    } catch (e) {
      toast('error', `Not sent. ${errorMessage(e)}`);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title={l10n('Send a template')}
      onClose={onClose}
      width={480}
      footer={
        <>
          <Button onClick={chosen ? () => setChosen(null) : onClose}>{chosen ? l10n('Back') : l10n('Cancel')}</Button>
          {chosen ? <Button variant="primary" icon="send" disabled={!ready} loading={busy} onClick={() => void send()}>{l10n('Send')}</Button> : null}
        </>
      }
    >
      {list.isLoading ? <Spinner /> : list.error ? <ErrorNote error={list.error} onRetry={() => void list.refetch()} /> : null}
      {list.isSuccess && !chosen ? (
        list.data.length ? (
          <ul className="flex flex-col gap-1.5" aria-label={l10n('Templates')}>
            {list.data.map((t) => (
              <li key={t.id}>
                <button type="button" onClick={() => (setChosen(t), setValues({}))} className="flex w-full flex-col rounded-[10px] border border-line px-3 py-2 text-left hover:bg-subtle">
                  <b className="text-[13px] text-ink">{t.name}</b>
                  <span className="line-clamp-2 text-[12px] text-ink-3">{t.body}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[12.5px] text-ink-2">{l10n('There is no approved template for this number yet. Templates are added on the web.')}</p>
        )
      ) : null}
      {chosen ? (
        <div className="flex flex-col gap-3 text-[12.5px]">
          {chosen.slots.map((n) => (
            <label key={n} className="flex flex-col gap-1 font-semibold text-ink">
              {`{{${n}}}`}
              <input value={values[n] ?? ''} onChange={(e) => setValues({ ...values, [n]: e.target.value })} className="h-[34px] rounded-[8px] border border-line bg-surface px-2.5 text-[13px] font-medium outline-none focus:border-primary" />
            </label>
          ))}
          <p aria-label={l10n('Preview')} className="rounded-[10px] bg-selection p-3 text-[13px] whitespace-pre-wrap text-ink">{filled}</p>
        </div>
      ) : null}
    </Modal>
  );
}
