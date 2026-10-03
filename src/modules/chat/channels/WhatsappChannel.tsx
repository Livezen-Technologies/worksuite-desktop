import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { useCanOpen } from '../../../core/access';
import { call, errorMessage, isMac } from '../../../core/bridge';
import { navigate } from '../../../core/tabs';
import { usePhoneIndex, type PhoneIndex } from '../../contacts/phones';
import type { ReplyTarget } from '../Thread';
import { useDraft } from '../../../core/drafts';
import { Checkbox } from '../../../components/Checkbox';
import { Composer } from '../Composer';
import { text as l10n } from '../../../core/i18n';
import { useTab, useTabTitle } from '../../../core/tab-context';
import { conversationStamp, dateLabel, dayKey, parseTs, timeLabel, todayInZone } from '../../../core/time';
import { useStore } from '../../../core/store';
import { toast } from '../../../core/toasts';
import { Icon } from '../../../components/Icon';
import { ResizeDivider, useResizableWidth } from '../../../components/ResizeDivider';
import { Select } from '../../../components/Select';
import { SidePanel } from '../../../components/SidePanel';
import { Button, Empty, ErrorNote, Modal, Spinner, cx } from '../../../components/ui';
import { openChatAttachment, previewKind, type Attachment } from '../AttachmentViewer';
import { mediaUrl } from '../types';
import { ConversationMenu } from '../ConversationMenu';
import { LIST_WIDTH, badgeText, rememberWhatsapp } from './channels';
import { LinkPhone } from './LinkPhone';
import { fullName, previewParts, whoIs, whoSent, withMentionNames, type WaWho } from './wa-names';
import { AddToContacts, ContactPanel, LinkToContact, WaAvatar, contactRoute, waContactMenuItems } from './WaContact';
import {
  fileRefusal, isConnected, isConnecting, messageText, readWa, sendWa, sendWaFiles, sendWaTemplate, startWa, useWaChats, useWaSettings, useWaTemplates, useWaThread, waAttachment, waLimits, waNumber, WA_SCOPES,
  type WaAccount, type WaChat, type WaMessage, type WaScope, type WaTemplate,
} from './whatsapp';

/**
 * WhatsApp in Chat (worksuite-desktop#33, #35): the conversations on the numbers shared with this person in the list,
 * the chosen one beside it, answered from here — text, files and, once the 24-hour window has closed, an approved
 * template. A number that is not connected says so above the list, with the way to link it again for whoever may —
 * its QR code opens in the pane beside the list (#155) — and its conversations are dimmed until it is; the gear opens
 * the channel's settings. `?to=<number>` (Contacts, the web's links) starts a conversation with it, and `?new=1`
 * (⌘N / Ctrl+N) asks for the number first.
 */
export function WhatsappChannel({ accounts, loading, error, retry, onConnect, onSettings }: {
  accounts: WaAccount[];
  loading: boolean;
  error: unknown;
  retry: () => void;
  onConnect: (() => void) | null;
  onSettings?: () => void;
}) {
  const { query, go } = useTab();
  const selected = query.get('wa');
  const to = query.get('to');
  const fresh = query.get('new') === '1';
  const [starting, setStarting] = useState(false);
  const senders = accounts.filter((a) => a.can_send !== false && isConnected(a));
  // The number chosen on the channel rail or in the header (#155); one no longer shared reads as all of them.
  const chosen = useStore(waNumber, (s) => s.id);
  const account = accounts.some((a) => a.id === chosen) ? chosen : 0;
  const [scope, setScope] = useState<WaScope>('all');
  const [q, setQ] = useState('');
  const chats = useWaChats({ account, scope, q }, accounts.length > 0);
  const rows = chats.data?.chats ?? [];
  // Names come from Contacts, kept here and re-read whenever a contact changes (#176).
  const index = usePhoneIndex(useCanOpen('contacts') && accounts.length > 0).data;
  const [picks, pick] = usePicks();
  const [action, setAction] = useState<{ kind: 'add' | 'link'; who: WaWho } | null>(null);
  // The conversation menu at the mouse (worksuite-desktop#183).
  const [menu, setMenu] = useState<{ who: WaWho; c: WaChat; x: number; y: number } | null>(null);
  // The number whose QR code is open beside the list (#155).
  const [linking, setLinking] = useState<WaAccount | null>(null);
  const current = rows.find((c) => String(c.id) === selected);
  useTabTitle(current ? `WhatsApp · ${fullName(whoIs(current, index, picks[current.id]))}` : selected ? null : 'WhatsApp');
  const list = useResizableWidth('chat.list', LIST_WIDTH);
  const down = accounts.filter((a) => !isConnected(a));
  const byId = new Map(accounts.map((a) => [a.id, a]));

  useEffect(() => rememberWhatsapp(selected), [selected]);

  // ⌘N / Ctrl+N in WhatsApp starts a WhatsApp conversation (`?new=1`); closing it leaves the route as it was. With no
  // number that can send, there is nothing to start and the request is simply dropped.
  const canStart = senders.length > 0;
  const withoutNew = () => {
    const rest = new URLSearchParams(query);
    rest.delete('new');
    return `/chat?${rest.toString()}`;
  };
  useEffect(() => {
    if (!fresh || loading || canStart) return;
    const rest = new URLSearchParams(query);
    rest.delete('new');
    go(`/chat?${rest.toString()}`);
  }, [fresh, loading, canStart, query, go]);

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
        <div key={a.id} role="status" className="mx-3 mb-2 flex items-start gap-2 rounded-[8px] bg-warning-bg p-2.5 text-[12px] text-warning-ink">
          <Icon name="wifi-off" size={14} className="mt-px shrink-0" />
          <span className="min-w-0 flex-1">
            {isConnecting(a) ? (
              <><b className="font-semibold">{a.name} is connecting.</b> {a.status_note || 'Messages arrive as soon as the session is up.'}</>
            ) : (
              <><b className="font-semibold">{a.name} is not connected.</b> {a.status_note ?? 'Messages to and from it wait until it is linked again.'}</>
            )}
          </span>
          {relinkable(a) ? (
            <Button size="sm" onClick={() => setLinking(a)}>Link again</Button>
          ) : (
            <Button size="sm" icon="external" onClick={() => void call('app:openInBrowser', { path: '/whatsapp' })}>Open on the web</Button>
          )}
        </div>
      ))}
      <div className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto px-1.5 pb-2 scroll-thin">
        {chats.isLoading ? <Spinner /> : chats.error && !chats.data ? <div className="p-4"><ErrorNote error={chats.error} onRetry={() => void chats.refetch()} /></div> : null}
        {chats.isSuccess && !rows.length ? (
          <Empty icon="phone" title={q.trim() ? 'Nothing matches' : scope === 'unread' ? 'Nothing unread' : scope === 'waiting' ? 'Nobody is waiting' : scope === 'mine' ? 'No conversations assigned to you' : 'No WhatsApp conversations yet'} hint={scope === 'all' && !q.trim() ? 'Messages to your numbers appear here.' : undefined} />
        ) : null}
        {rows.map((c) => {
          const who = whoIs(c, index, picks[c.id]);
          const on = byId.get(c.account_id);
          // A conversation on a number that is down cannot be answered until it is up again: dimmed, and said why.
          const blocked = on && !isConnected(on) ? `Can’t reply until ${on.name} is ${isConnecting(on) ? 'connected' : 'linked'}.` : null;
          return <ChatRow key={c.id} c={c} who={who} active={String(c.id) === selected} many={accounts.length > 1 && !account} blocked={blocked} onOpen={() => go(`/chat?channel=whatsapp&wa=${c.id}`)} onMenu={(x, y) => setMenu({ who, c, x, y })} />;
        })}
      </div>
    </>
  );

  // Beside the list: the QR code being scanned, the conversation, or — with nothing open — a number to link again,
  // else where to start.
  const idle = !selected ? down.find((a) => relinkable(a) && !isConnecting(a)) : undefined;
  const pane = linking ? (
    <LinkPane key={linking.id} account={linking} onDone={() => setLinking(null)} />
  ) : selected ? (
    <WhatsappThread key={selected} id={selected} onRelink={(a) => (relinkable(a) ? setLinking(a) : void call('app:openInBrowser', { path: '/whatsapp' }))} index={index} picked={picks[Number(selected)] ?? null} onPick={(c) => pick(Number(selected), c)} onAction={(kind, who) => setAction({ kind, who })} />
  ) : idle ? (
    <ReconnectCard account={idle} onLink={() => setLinking(idle)} />
  ) : (
    <PickCard canStart={canStart} hasNumbers={accounts.length > 0} />
  );

  return (
    <div className="relative flex h-full min-w-0 flex-1">
      <SidePanel id="chat" label="the conversations">
        <aside aria-label="WhatsApp conversations" className="relative flex shrink-0 flex-col border-r border-line bg-surface" style={{ width: list.width }}>
          <ResizeDivider state={list} label="Resize the conversation list" />
          <div className="flex flex-col gap-2 px-3 pt-3 pb-2">
            <div className="flex items-center gap-2">
              <b className="flex-1 truncate text-[15px] text-ink">WhatsApp</b>{chats.isFetching && chats.data ? <span role="status" className="text-[11px] text-ink-3">Updating…</span> : null}
              {accounts.length > 1 ? (
                <Select aria-label="Number" value={account} onChange={(e) => waNumber.set({ id: Number(e.target.value) })} className="h-7 max-w-[150px] rounded-[7px] border border-line bg-surface px-1.5 text-[12px] text-ink">
                  <option value={0}>All numbers</option>
                  {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                </Select>
              ) : null}
              {onSettings ? (
                <button type="button" aria-label={l10n('WhatsApp settings')} title={l10n('WhatsApp settings')} onClick={onSettings} className="flex h-8 w-8 items-center justify-center rounded-[8px] border border-line text-ink-2 outline-none hover:bg-subtle focus-visible:ring-2 focus-visible:ring-primary">
                  <Icon name="settings" size={15} />
                </button>
              ) : null}
              {canStart ? (
                <button type="button" aria-label={l10n('New WhatsApp conversation')} title={`${l10n('New WhatsApp conversation')} (${NEW_KEY})`} onClick={() => setStarting(true)} className="flex h-8 w-8 items-center justify-center rounded-[8px] bg-primary text-white outline-none hover:bg-primary-hover focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1">
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
                    <button key={s.id} type="button" role="tab" aria-selected={scope === s.id} onClick={() => setScope(s.id)} className={cx('shrink-0 rounded-full px-2.5 py-1 outline-none focus-visible:ring-2 focus-visible:ring-primary', scope === s.id ? 'bg-ink text-surface' : 'border border-line text-ink hover:bg-subtle')}>
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
      <div className="flex min-w-0 flex-1 bg-ground">{pane}</div>
      {menu ? (
        <ConversationMenu
          x={menu.x}
          y={menu.y}
          target={{ kind: 'whatsapp', chat: menu.c, contactItems: waContactMenuItems(menu.who, { add: () => setAction({ kind: 'add', who: menu.who }), link: () => setAction({ kind: 'link', who: menu.who }), open: (id) => navigate(contactRoute(id)) }) }}
          onClose={() => setMenu(null)}
        />
      ) : null}
      {action?.kind === 'add' ? <AddToContacts who={action.who} onClose={() => setAction(null)} /> : null}
      {action?.kind === 'link' ? <LinkToContact who={action.who} onClose={() => setAction(null)} /> : null}
      {(starting || (fresh && canStart) || (to && !selected)) && !loading ? (
        <StartConversation
          accounts={senders}
          phone={starting || fresh ? '' : (to ?? '')}
          onClose={() => {
            setStarting(false);
            if (to) go('/chat?channel=whatsapp');
            else if (fresh) go(withoutNew());
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

/** A number this app can link again by QR code, for somebody who may: a WhatsApp Web number. */
const relinkable = (a: Pick<WaAccount, 'provider' | 'can_connect'>) => a.provider === 'web_js' && a.can_connect !== false;

/** The shortcut that starts a conversation, as this computer writes it. */
const NEW_KEY = isMac ? '⌘N' : 'Ctrl+N';

/** Nothing open: a light card, and how to start a conversation when one can be started. */
function PickCard({ canStart, hasNumbers }: { canStart: boolean; hasNumbers: boolean }) {
  return (
    <div className="flex flex-1 items-center justify-center p-6">
      <div className="flex max-w-[320px] flex-col items-center gap-2 rounded-[12px] border border-line/70 bg-surface/60 px-8 py-7 text-center">
        <span className="flex h-10 w-10 items-center justify-center rounded-full bg-subtle text-ink-3"><Icon name="phone" size={18} /></span>
        <b className="text-[14px] font-semibold text-ink">Pick a conversation</b>
        {canStart ? (
          <span className="text-[12.5px] text-ink-3">Press <kbd className="rounded-[4px] border border-line bg-surface px-1 font-sans text-[11.5px] text-ink-2">{NEW_KEY}</kbd> to start a new chat.</span>
        ) : hasNumbers ? (
          <span className="text-[12.5px] text-ink-3">Your WhatsApp conversations are in the list.</span>
        ) : null}
      </div>
    </div>
  );
}

/** Nothing open and a number is down: linking it again is the thing to do, said where the conversation would be. */
function ReconnectCard({ account, onLink }: { account: WaAccount; onLink: () => void }) {
  return (
    <section aria-label={`Reconnect ${account.name}`} className="flex flex-1 items-center justify-center p-6">
      <div className="flex max-w-[360px] flex-col items-center gap-2.5 rounded-[12px] border border-line bg-surface px-8 py-7 text-center">
        <span className="flex h-10 w-10 items-center justify-center rounded-full bg-warning-bg text-warning-ink"><Icon name="wifi-off" size={18} /></span>
        <b className="text-[14px] font-semibold text-ink">{account.name} is not connected</b>
        <span className="text-[12.5px] text-ink-3">{account.status_note ?? 'Scan a QR code with the phone that owns the number to link it again.'}</span>
        <Button variant="primary" size="sm" icon="link" onClick={onLink}>Show the QR code</Button>
      </div>
    </section>
  );
}

/** A number's QR code beside the list (#155): once scanned the number is up, and the pane goes back to what it showed. */
function LinkPane({ account, onDone }: { account: WaAccount; onDone: () => void }) {
  return (
    <section aria-label={`Link ${account.name}`} className="flex min-w-0 flex-1 flex-col overflow-y-auto scroll-thin">
      <header className="flex items-center gap-2.5 border-b border-line bg-surface px-4 py-2.5">
        <Icon name="link" size={16} className="text-ink-3" />
        <b className="min-w-0 flex-1 truncate text-[14px] text-ink">Link {account.name} to WhatsApp</b>
        <Button size="sm" onClick={onDone}>{l10n('Cancel')}</Button>
      </header>
      <div className="mx-auto w-full max-w-[420px] p-6">
        <LinkPhone
          accountId={account.id}
          onLinked={() => {
            toast('success', `${account.name} is connected.`);
            onDone();
          }}
        />
      </div>
    </section>
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
 * A conversation in the list (#155): its picture, the name and the last message, and in one right-hand column on
 * every row the time with, under it, the unread count — or, with nothing unread, a soft "Waiting" pill; with both, the
 * count and a small waiting dot whose tooltip says how long. The number it is on leads the preview only while all
 * numbers are shown. A row on a number that is down is dimmed, its tooltip saying why.
 */
function ChatRow({ c, who, active, many, blocked, onOpen, onMenu }: { c: WaChat; who: WaWho; active: boolean; many: boolean; blocked: string | null; onOpen: () => void; onMenu: (x: number, y: number) => void }) {
  const waiting = c.waiting_minutes !== null && c.status !== 'resolved';
  const waitingFor = waiting ? `Waiting ${waitedFor(c.waiting_minutes ?? 0)}${c.overdue ? ' · overdue' : ''}` : '';
  const p = previewParts(c);
  // A photo reads as a picture and its caption, not the word "Photo" (#176).
  const lead = `${c.is_muted ? 'Muted · ' : ''}${p.you ? 'You: ' : ''}`;
  return (
    <button
      type="button"
      onClick={onOpen}
      onContextMenu={(e) => {
        e.preventDefault();
        onMenu(e.clientX, e.clientY);
      }}
      title={blocked ?? undefined}
      aria-current={active ? 'true' : undefined}
      data-blocked={blocked ? 'true' : undefined}
      className={cx(
        'flex min-h-[64px] w-full shrink-0 items-center gap-2.5 rounded-[8px] px-2.5 py-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-inset',
        active ? 'bg-selection shadow-[inset_3px_0_0_var(--color-primary)]' : 'hover:bg-subtle',
        blocked && 'opacity-60',
      )}
    >
      <WaAvatar who={who} size={40} />
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex min-w-0 items-center gap-1">
          {who.group ? <Icon name="users" size={12} className="shrink-0 text-ink-3" label="Group" /> : null}
          <b className={cx('truncate text-[13px] text-ink', !c.unread && 'font-semibold')}>{who.name}</b>
          {who.source === 'contact' && who.subtitle ? <span className="truncate text-[11.5px] text-ink-3">· {who.subtitle}</span> : null}
          {who.candidates.length > 1 ? <span title={who.candidates.map((x) => x.name).join(', ')} className="shrink-0 rounded-full bg-subtle px-1.5 text-[10.5px] font-semibold text-ink-2">{who.candidates.length} contacts</span> : null}
        </span>
        <span className="flex min-w-0 items-center gap-1 text-[12px] text-ink-3">
          {many ? <span data-channel className="shrink-0 font-semibold text-ink-2">{c.account_name} ·</span> : null}
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
      <span data-meta className="flex w-[52px] shrink-0 flex-col items-end justify-center gap-1 self-stretch">
        <span className={cx('text-[11px] whitespace-nowrap', c.unread ? 'font-semibold text-primary' : 'text-ink-3')}>{conversationStamp(c.last_message_at)}</span>
        <span className="flex h-[18px] items-center gap-1">
          {c.unread && waiting ? <span data-waiting-dot title={waitingFor} className={cx('h-2 w-2 rounded-full', c.overdue ? 'bg-danger' : 'bg-warning')} /> : null}
          {c.unread ? (
            <span data-unread className="flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-primary px-1.5 text-[10.5px] font-bold text-white">{badgeText(c.unread)}</span>
          ) : waiting ? (
            <span title={waitingFor} className={cx('rounded-full px-1.5 py-px text-[10px] font-semibold', c.overdue ? 'bg-danger-bg text-danger' : 'bg-warning-bg text-warning-ink')}>Waiting</span>
          ) : null}
        </span>
      </span>
    </button>
  );
}

/** How long somebody has waited, in words: "45 min", "3 h", "2 d". */
function waitedFor(minutes: number): string {
  if (minutes < 60) return `${Math.max(1, Math.round(minutes))} min`;
  if (minutes < 60 * 24) return `${Math.round(minutes / 60)} h`;
  return `${Math.round(minutes / 60 / 24)} d`;
}

function WhatsappThread({ id, onRelink, index, picked, onPick, onAction }: { id: string; onRelink: (a: WaAccount) => void; index: PhoneIndex | undefined; picked: number | null; onPick: (contact: number) => void; onAction: (kind: 'add' | 'link', who: WaWho) => void }) {
  const qc = useQueryClient();
  const thread = useWaThread(id);
  const [reply, setReply] = useState<ReplyTarget | null>(null);
  const [panel, setPanel] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const data = thread.data;
  const count = data?.messages.length ?? 0;
  const firstScroll = useRef(true);
  const atBottom = useRef(true);
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
    if (el && (firstScroll.current || atBottom.current)) { el.scrollTop = el.scrollHeight; firstScroll.current = false; }
  }, [count]);

  if (thread.isLoading) return <Spinner />;
  if (!data) return <div className="p-6"><ErrorNote error={thread.error} onRetry={() => void thread.refetch()} /></div>;
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
        <div ref={scroller} onScroll={() => { const el = scroller.current; if (el) atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80; }} className="flex min-h-0 flex-1 flex-col gap-[9px] overflow-y-auto px-4 py-3 scroll-thin">
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
