import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { useCanOpen } from '../../../core/access';
import { call, errorMessage } from '../../../core/bridge';
import { navigate } from '../../../core/tabs';
import { usePhoneIndex, type PhoneIndex } from '../../contacts/phones';
import type { ReplyTarget } from '../Thread';
import { useDraft } from '../../../core/drafts';
import { Checkbox } from '../../../components/Checkbox';
import { Composer } from '../Composer';
import { text as l10n } from '../../../core/i18n';
import { useTab, useTabTitle } from '../../../core/tab-context';
import { dateLabel, dayKey, listStamp, parseTs, timeLabel, todayInZone } from '../../../core/time';
import { toast } from '../../../core/toasts';
import { Icon } from '../../../components/Icon';
import { ResizeDivider, useResizableWidth } from '../../../components/ResizeDivider';
import { Select } from '../../../components/Select';
import { SidePanel } from '../../../components/SidePanel';
import { Button, Empty, ErrorNote, Modal, Spinner, cx } from '../../../components/ui';
import { openChatAttachment, previewKind, type Attachment } from '../AttachmentViewer';
import { mediaUrl } from '../types';
import { LIST_WIDTH, rememberWhatsapp } from './channels';
import { fullName, previewParts, whoIs, whoSent, withMentionNames, type WaWho } from './wa-names';
import { AddToContacts, ContactPanel, LinkToContact, WaAvatar, contactRoute, waContactMenuItems } from './WaContact';
import {
  fileRefusal, isConnected, isConnecting, messageText, readWa, sendWa, sendWaFiles, sendWaTemplate, startWa, useWaChats, useWaSettings, useWaTemplates, useWaThread, waAttachment, waLimits, WA_SCOPES,
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
  // Names come from Contacts, kept here and re-read whenever a contact changes (#176).
  const index = usePhoneIndex(useCanOpen('contacts') && accounts.length > 0).data;
  const [picks, pick] = usePicks();
  const [action, setAction] = useState<{ kind: 'add' | 'link'; who: WaWho } | null>(null);
  const [menu, setMenu] = useState<{ who: WaWho; x: number; y: number } | null>(null);
  const current = rows.find((c) => String(c.id) === selected);
  useTabTitle(current ? `WhatsApp · ${fullName(whoIs(current, index, picks[current.id]))}` : selected ? null : 'WhatsApp');
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
            {isConnecting(a) ? (
              <><b className="font-semibold">{a.name} is connecting.</b> {a.status_note || 'Messages arrive as soon as the session is up.'}</>
            ) : (
              <><b className="font-semibold">{a.name} is not connected.</b> {a.status_note ?? 'Messages to and from it wait until it is linked again.'}</>
            )}
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
        {rows.map((c) => {
          const who = whoIs(c, index, picks[c.id]);
          return <ChatRow key={c.id} c={c} who={who} active={String(c.id) === selected} many={accounts.length > 1 && !account} onOpen={() => go(`/chat?channel=whatsapp&wa=${c.id}`)} onMenu={(x, y) => setMenu({ who, x, y })} />;
        })}
      </div>
    </>
  );

  return (
    <div className="relative flex h-full min-w-0 flex-1">
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
        {selected ? <WhatsappThread key={selected} id={selected} onRelink={onRelink} index={index} picked={picks[Number(selected)] ?? null} onPick={(c) => pick(Number(selected), c)} onAction={(kind, who) => setAction({ kind, who })} /> : <Empty icon="phone" title="Pick a conversation" hint={accounts.length ? 'Your WhatsApp conversations are in the list.' : undefined} />}
      </div>
      {menu ? <RowMenu menu={menu} onClose={() => setMenu(null)} onAction={(kind, who) => setAction({ kind, who })} /> : null}
      {action?.kind === 'add' ? <AddToContacts who={action.who} onClose={() => setAction(null)} /> : null}
      {action?.kind === 'link' ? <LinkToContact who={action.who} onClose={() => setAction(null)} /> : null}
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

/** The contact chosen for a number several contacts share, per conversation, remembered on this computer. */
function usePicks(): [Record<number, number>, (chat: number, contact: number) => void] {
  const [picks, setPicks] = useState<Record<number, number>>(() => {
    try {
      return JSON.parse(localStorage.getItem(PICKS) ?? '{}') as Record<number, number>;
    } catch {
      return {};
    }
  });
  const pick = (chat: number, contact: number) =>
    setPicks((p) => {
      const next = { ...p, [chat]: contact };
      try {
        localStorage.setItem(PICKS, JSON.stringify(next));
      } catch {
        // A convenience: the best match is shown instead.
      }
      return next;
    });
  return [picks, pick];
}

const PICKS = 'ws.chat.whatsapp.picks';

/**
 * A conversation's right-click menu: "Add to contacts" and "Link to existing contact" for a number in nobody's
 * contacts, "Open contact" for one that is (#176). Chat's shared list menu (#183) can take the same items from
 * `waContactMenuItems()`.
 */
function RowMenu({ menu, onClose, onAction }: { menu: { who: WaWho; x: number; y: number }; onClose: () => void; onAction: (kind: 'add' | 'link', who: WaWho) => void }) {
  const items = waContactMenuItems(menu.who, { add: () => onAction('add', menu.who), link: () => onAction('link', menu.who), open: (id) => navigate(contactRoute(id)) });
  if (!items.length) return null;
  return (
    <>
      <div className="fixed inset-0 z-40" onMouseDown={onClose} onContextMenu={(e) => (e.preventDefault(), onClose())} />
      <div role="menu" aria-label={menu.who.name} onKeyDown={(e) => e.key === 'Escape' && onClose()} className="fixed z-50 flex w-[220px] flex-col rounded-[10px] border border-line bg-surface p-1.5 shadow-[0_12px_32px_rgb(var(--ws-shadow-rgb)/.16)]" style={{ left: Math.min(menu.x, window.innerWidth - 230), top: Math.min(menu.y, window.innerHeight - 100) }}>
        {items.map((it, i) => (
          <button key={it.id} type="button" role="menuitem" autoFocus={i === 0} onClick={() => (onClose(), it.onSelect?.())} className="flex h-[32px] items-center gap-2.5 rounded-[7px] px-2.5 text-left text-[12.5px] font-semibold text-ink hover:bg-ground">
            {it.icon ? <Icon name={it.icon} size={14} className="text-ink-2" /> : null}
            {it.label}
          </button>
        ))}
      </div>
    </>
  );
}

function ChatRow({ c, who, active, many, onOpen, onMenu }: { c: WaChat; who: WaWho; active: boolean; many: boolean; onOpen: () => void; onMenu: (x: number, y: number) => void }) {
  const waiting = c.waiting_minutes !== null && c.status !== 'resolved';
  const p = previewParts(c);
  // A photo reads as a picture and its caption, not the word "Photo" (#176).
  const lead = `${many ? `${c.account_name} · ` : ''}${c.is_muted ? 'Muted · ' : ''}${p.you ? 'You: ' : ''}`;
  return (
    <button
      type="button"
      onClick={onOpen}
      onContextMenu={(e) => {
        e.preventDefault();
        onMenu(e.clientX, e.clientY);
      }}
      aria-current={active ? 'true' : undefined}
      className={cx('flex w-full items-center gap-2.5 px-3.5 py-[7px] text-left', active ? 'bg-selection' : 'hover:bg-subtle')}
    >
      <WaAvatar who={who} size={34} />
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline gap-1.5">
          <span className="flex min-w-0 flex-1 items-baseline gap-1 truncate">
            <b className={cx('truncate text-[13px] text-ink', !c.unread && 'font-semibold')}>{who.name}</b>
            {who.source === 'contact' && who.subtitle ? <span className="truncate text-[11.5px] text-ink-3">· {who.subtitle}</span> : null}
            {who.candidates.length > 1 ? <span title={who.candidates.map((x) => x.name).join(', ')} className="shrink-0 rounded-full bg-subtle px-1.5 text-[10.5px] font-semibold text-ink-2">{who.candidates.length} contacts</span> : null}
          </span>
          <span className="shrink-0 text-[11px] text-ink-3">{c.last_message_at ? listStamp(c.last_message_at) : ''}</span>
        </span>
        <span className="flex min-w-0 items-center gap-1 text-[12px] text-ink-3">
          {p.icon ? (
            <>
              {lead ? <span className="shrink-0">{lead}</span> : null}
              <Icon name={p.icon} size={12} className="shrink-0" />
              <span className="truncate">{p.text}</span>
            </>
          ) : (
            <span className="truncate">{lead}{p.text}</span>
          )}
        </span>
      </span>
      {c.unread ? (
        <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-[10.5px] font-bold text-white">{c.unread}</span>
      ) : waiting ? (
        <span className={cx('rounded-full px-1.5 text-[10.5px] font-bold text-white', c.overdue ? 'bg-danger' : 'bg-badge')}>Waiting</span>
      ) : null}
    </button>
  );
}

function WhatsappThread({ id, onRelink, index, picked, onPick, onAction }: { id: string; onRelink: (a: WaAccount) => void; index: PhoneIndex | undefined; picked: number | null; onPick: (contact: number) => void; onAction: (kind: 'add' | 'link', who: WaWho) => void }) {
  const qc = useQueryClient();
  const thread = useWaThread(id);
  const [reply, setReply] = useState<ReplyTarget | null>(null);
  const [panel, setPanel] = useState(false);
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
  const who = whoIs(chat, index, picked);
  const group = who.group;
  const down = !isConnected(chat.account);
  // Text and files need the 24-hour window; an approved template does not (the rule WhatsApp enforces, and the server).
  const blocked = !data.can_send ? 'You can read this number’s conversations but not answer them.' : down ? (isConnecting(chat.account) ? `${chat.account.name} is connecting. Messages can be sent once it is up.` : `${chat.account.name} is not connected, so nothing can be sent until it is linked again.`) : null;
  const refusal = blocked ?? (!chat.window.allowed ? `${chat.window.reason ?? 'Only an approved template can be sent now.'} ${l10n('Send an approved template instead.')}` : null);
  // Security-code notices and other empty markers are not messages anybody wrote.
  const shown = data.messages.filter((m) => !(m.kind === 'text' && !(m.body ?? '').trim() && !m.file_id && !(m.caption ?? '').trim()));
  const gallery: Attachment[] = shown.flatMap((m) => waAttachment(m) ?? []);
  // What goes under the name: the company or "Not in contacts" · the number (a group: its size) · the number it is on.
  const under = [group ? who.subtitle : who.source === 'contact' ? who.subtitle : who.source === 'number' ? null : who.subtitle, group ? null : who.source === 'number' ? who.subtitle : who.phoneDisplay, `on ${chat.account.name}`].filter(Boolean).join(' · ');

  return (
    <div className="flex min-w-0 flex-1">
      <section aria-label={`WhatsApp with ${who.name}`} className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center gap-2.5 border-b border-line bg-surface px-4 py-2.5">
          <button type="button" aria-label={`About ${who.name}`} aria-expanded={panel} onClick={() => setPanel(!panel)} className="flex min-w-0 flex-1 items-center gap-2.5 rounded-[8px] text-left hover:opacity-90">
            <WaAvatar who={who} size={34} />
            <span className="min-w-0 flex-1">
              <b className="flex items-center gap-1.5 truncate text-[14px] text-ink">
                <span className="truncate">{who.name}</span>
                {who.candidates.length > 1 ? <span className="shrink-0 rounded-full bg-subtle px-1.5 text-[10.5px] font-semibold text-ink-2">{who.candidates.length} contacts</span> : null}
              </b>
              <span className="block truncate text-[12px] text-ink-3">{under}</span>
            </span>
          </button>
          {!group && !who.contact && who.e164 ? (
            <>
              <Button size="sm" icon="user-plus" onClick={() => onAction('add', who)}>Add to contacts</Button>
              <Button size="sm" icon="link" onClick={() => onAction('link', who)}>Link to contact</Button>
            </>
          ) : null}
          <Button size="sm" icon="external" onClick={() => void call('app:openInBrowser', { path: `/whatsapp?chat=${chat.id}` })}>Open on the web</Button>
        </header>
        <div ref={scroller} className="flex min-h-0 flex-1 flex-col gap-[9px] overflow-y-auto px-4 py-3 scroll-thin">
          {data.has_more ? <div className="self-center text-[11px] text-ink-3">Earlier messages are on the web.</div> : null}
          {!shown.length ? <Empty icon="phone" title="No messages yet" /> : null}
          {shown.map((m) => {
            const author = group && m.direction === 'in' ? whoSent(m, index) : null;
            return <Bubble key={m.id} m={m} author={author?.name ?? null} index={index} gallery={gallery} onReply={() => setReply({ id: m.id, sender_name: m.direction === 'out' ? (m.sender_name ?? 'You') : (author?.name ?? who.name), snippet: messageText(m).slice(0, 120) })} />;
          })}
        </div>
        <WhatsappComposer chatId={chat.id} accountId={chat.account_id} name={who.name} messages={shown} reply={reply} onClearReply={() => setReply(null)} reconnect={down ? () => onRelink(chat.account) : undefined} refusal={refusal} templates={!blocked} onSent={() => void qc.invalidateQueries({ queryKey: ['whatsapp'] })} />
      </section>
      {panel ? <ContactPanel who={who} chatId={chat.id} onClose={() => setPanel(false)} onPick={onPick} onAdd={() => onAction('add', who)} onLink={() => onAction('link', who)} /> : null}
    </div>
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

/** A message whose file was not kept (history imports leave pictures on the phone): its kind, by icon. */
const MEDIA_ICON: Record<string, string> = { image: 'image', video: 'video', audio: 'mic', document: 'file-text', sticker: 'image', location: 'map-pin', contacts: 'contact' };

const linkOut = (url: string) => void call('app:openInBrowser', { path: url });

/** A message: its words, and its attachment — a picture shown, anything else by its name — opened in the shared preview. */
function Bubble({ m, author, index, gallery, onReply }: { m: WaMessage; author: string | null; index: PhoneIndex | undefined; gallery: Attachment[]; onReply: () => void }) {
  const ours = m.direction === 'out';
  const file = waAttachment(m);
  return (
    <div className={cx('flex max-w-[75%] flex-col gap-0.5', ours ? 'items-end self-end' : 'items-start self-start')}>
      {author ? <span className="px-1 text-[11.5px] font-semibold text-primary">{author}</span> : null}
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
          <Icon name={MEDIA_ICON[m.kind] ?? 'paperclip'} size={13} className="mr-1 inline text-ink-3" />
        ) : null}
        {withMentionNames(file ? (m.caption ?? '') : messageText(m), index)}
        {!file && m.media_note ? <span className="block text-[11.5px] text-ink-3">{m.media_note}</span> : null}
      </div>
      <span className={cx('text-[11px]', m.status === 'failed' ? 'font-semibold text-danger' : 'text-ink-3')}>
        <button type="button" aria-label="Reply to message" onClick={onReply} className="mr-2 text-primary hover:underline">Reply</button>
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
function WhatsappComposer({ chatId, accountId, name, messages, reply, onClearReply, reconnect, refusal, templates, onSent }: { chatId: number; accountId: number; name: string; messages: WaMessage[]; reply: ReplyTarget | null; onClearReply: () => void; reconnect?: () => void; refusal: string | null; templates: boolean; onSent: () => void }) {
  const [picking, setPicking] = useState(false);
  const blockedDraft = useDraft<boolean>('whatsapp', `blocked-drafting:${chatId}`, true);
  const settings = useWaSettings(true);
  const limits = waLimits(settings.data?.settings);
  return <>
    <Composer roomId={`whatsapp:${chatId}`} roomName={name} group={false} reply={reply} onClearReply={onClearReply} channel={{
      inputLabel: `Message ${name} on WhatsApp`, draftModule: 'whatsapp', draftContext: `chat:${chatId}`, refusal, allowBlockedDraft: blockedDraft.value, maxLength: 4000, maxCaptionLength: reply ? Math.max(1, 900 - reply.sender_name.length - reply.snippet.length - 5) : 900, voice: limits.kinds.audio,
      attachChoices: [...(limits.kinds.document ? ['document' as const] : []), ...(limits.kinds.image ? ['image' as const, 'camera' as const] : []), ...(limits.kinds.video ? ['video' as const] : []), ...(limits.kinds.audio ? ['audio' as const, 'voice' as const] : []), 'drive'],
      context: () => messages.map((m) => ({ mine: m.direction === 'out', name: m.direction === 'out' ? (m.sender_name ?? 'Me') : name, text: messageText(m) })),
      refuseFile: (f) => fileRefusal(f, limits),
      notice: refusal ? <p role="status" className="flex flex-wrap items-center gap-2 rounded-[8px] bg-subtle p-2 text-[12px] text-ink-2"><span className="min-w-0 flex-1">{refusal}</span><span>Your draft is kept.</span><label className="flex items-center gap-1"><Checkbox checked={blockedDraft.value} onChange={(e) => blockedDraft.setValue(e.target.checked)} />Allow drafting while blocked</label>{reconnect ? <Button size="sm" onClick={reconnect}>Link again</Button> : null}{templates ? <Button size="sm" icon="file-text" onClick={() => setPicking(true)}>{l10n('Send a template')}</Button> : null}</p> : null,
      send: async (text, files) => {
        if (refusal) return false;
        if (files.length) {
          const r = await sendWaFiles(chatId, files, reply ? `> ${reply.sender_name}: ${reply.snippet}\n${text}` : text, files[0]?.name.startsWith('Voice message.') ?? false);
          onSent();
          if (r.failed) { toast('error', `${r.sent} sent, ${r.failed} refused. ${r.results.find((x) => !x.ok)?.error ?? ''}`); return false; }
        } else {
          const r = await sendWa(chatId, text, messages.find((m) => m.id === reply?.id)?.external_id ?? undefined);
          if (r.ok === false) { toast('error', `Not sent. ${r.error ?? ''} Your message is kept.`.trim()); return false; }
          onSent();
        }
        return true;
      },
    }} />
    {picking ? <TemplatePicker chatId={chatId} accountId={accountId} onClose={() => setPicking(false)} onSent={() => (setPicking(false), onSent())} /> : null}
  </>;
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
