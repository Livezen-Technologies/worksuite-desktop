import { useState, type ReactNode } from 'react';
import { app } from '../../../core/app-state';
import { text } from '../../../core/i18n';
import { useStore } from '../../../core/store';
import { timeLabel } from '../../../core/time';
import { Icon } from '../../../components/Icon';
import { LinkedText } from '../../../components/LinkedText';
import { Avatar, DATA_TEXT, cx } from '../../../components/ui';
import { UserAvatar } from '../../../components/UserAvatar';
import { RecordMessage } from '../cards/RecordMessage';
import { recordsIn, withoutRecordLines } from '../cards/recordLinks';
import { EmojiPicker } from '../parts';
import type { ChannelCaps } from './caps';
import { isFirst, isLast, type Position } from './grouping';
import { MessageLinkPreview, shortUrl } from './LinkPreview';
import { DeleteDialog, MessageToolbar, canReact, messageActionItems, type MessageHandlers } from './MessageActions';
import { MessageAttachments, type Look } from './MessageAttachment';
import { MessageMeta } from './MessageMeta';
import { MessageText } from './MessageText';
import type { KitMessage, KitRole } from './model';
import type { VoiceOf } from './VoiceMessage';

/**
 * One message's bubble (C-02, RDC-11; worksuite-desktop#229) — the same component for Team Chat and website chats.
 * Two looks: `page`, the conversation in its tab or window, and `drawer`, the chat drawer's compact bubbles with the
 * time inside. Who wrote it decides the colour: our side indigo, the other side white, the bot teal and labelled
 * "Name · bot", a note only staff see amber with a dashed edge. A run's corners tighten between its bubbles; the first
 * carries the avatar and name, the last the time. A quoted reply sits inside the bubble it answers with.
 */

/** What only a channel that has them draws: Team Chat's record cards and call cards. */
export interface KitRenderers {
  /** A record or share card's content; `named` when the records come from links in the text. */
  records?: (m: KitMessage, named: boolean) => ReactNode;
  /** A call's card; `compact` in the drawer. */
  call?: (m: KitMessage, compact: boolean) => ReactNode;
}

const NAME_COLOURS = ['#0B6770', '#23349E', '#9A4A06', '#6B3FB5', '#B42318', '#1F7A4D'];
/** A sender's colour in a group, the same every time. */
export function nameColour(name: string): string {
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) | 0;
  return NAME_COLOURS[Math.abs(h) % NAME_COLOURS.length]!;
}

/** The page look's corners: the tight one by the avatar, and between bubbles of one run. Written out for Tailwind. */
const CORNERS: Record<'left' | 'right', Record<Position, string>> = {
  left: { single: 'rounded-[4px_12px_12px_12px]', first: 'rounded-[4px_12px_12px_4px]', middle: 'rounded-[4px_12px_12px_4px]', last: 'rounded-[4px_12px_12px_12px]' },
  right: { single: 'rounded-[12px_4px_12px_12px]', first: 'rounded-[12px_4px_4px_12px]', middle: 'rounded-[12px_4px_4px_12px]', last: 'rounded-[12px_4px_12px_12px]' },
};

export const BOT_TONE = 'border border-teal-line bg-teal-bg text-ink dark:border-teal/50';
export const NOTE_TONE = 'border border-dashed border-amber bg-warning-bg text-warning-strong dark:bg-warning-bg dark:text-ink';
/** A colleague's reply on our side of a website chat (C-08): tinted with their name colour (`--c`), so whose is whose shows. */
export const COLLEAGUE_TONE = 'border border-[color:color-mix(in_srgb,var(--c)_28%,var(--color-surface))] bg-[color:color-mix(in_srgb,var(--c)_10%,var(--color-surface))] text-ink';

/** Written on our side by somebody else: a colleague in a website chat with several staff (C-08, TEAM-05). */
export function isColleague(m: Pick<KitMessage, 'own'> & { author: { role: KitRole } }): boolean {
  return m.own && m.author.role === 'staff';
}

/** The bubble's colours: our side, the other side, the bot, or a staff-only note. */
export function bubbleTone(m: Pick<KitMessage, 'own' | 'internal'> & { author: { role: KitRole } }, look: Look): string {
  if (m.internal) return NOTE_TONE;
  if (m.author.role === 'bot') return BOT_TONE;
  if (look === 'page' && isColleague(m)) return COLLEAGUE_TONE;
  if (look === 'drawer') return m.own ? 'bg-blue-bg dark:bg-primary-soft' : 'bg-surface dark:bg-well';
  return m.own ? 'bg-primary text-white' : 'border border-line bg-surface text-ink';
}

/** Link colour inside a bubble: pale on indigo, indigo elsewhere. */
function accentOf(m: KitMessage, look: Look): string {
  if (m.internal || m.author.role === 'bot') return 'text-primary';
  if (look === 'drawer') return m.own ? 'text-primary dark:text-info-ink' : 'text-primary';
  return m.own && !isColleague(m) ? 'text-white' : 'text-primary';
}

export function KitAvatar({ author, size }: { author: KitMessage['author']; size: number }) {
  const person = (author.role === 'staff' || author.role === 'self') && author.id !== null && author.id !== undefined;
  return person ? <UserAvatar userId={author.id} name={author.name} size={size} src={author.avatar} /> : <Avatar name={author.name} src={author.avatar} size={size} />;
}

/**
 * "Internal note — only staff see this" (TEAM-60); with its author, "INTERNAL NOTE · NUWAN · ONLY STAFF SEE THIS" as the
 * several-staff design labels it (C-08), the note naming who wrote it in place of the name above other bubbles.
 */
export function InternalLabel({ author }: { author?: string | null } = {}) {
  const first = author?.trim().split(/\s+/)[0];
  return (
    <span className={cx('flex items-center gap-1 font-bold text-warning-strong dark:text-warning', first ? 'text-[10px] tracking-[0.6px] uppercase' : 'text-[11px]')}>
      <Icon name="lock" size={10} /> {first ? text('Internal note · {name} · only staff see this', { name: first }) : text('Internal note — only staff see this')}
    </span>
  );
}

/** "Olema · bot" at the top of a bot's bubble (RDC-11: bot messages keep their style and label). */
function BotLabel({ name }: { name: string }) {
  return <b className="block text-[11px] font-bold text-teal-ink">{text('{name} · bot', { name })}</b>;
}

/** The message being answered, inside the answer's bubble. */
function ReplyQuote({ m, look, inside }: { m: KitMessage; look: Look; inside: boolean }) {
  if (m.replyRemoved && !m.reply) return <div className="mb-1 border-l-[3px] border-line px-2 py-1 text-[11.5px] text-ink-3 italic">{text('A removed message')}</div>;
  const q = m.reply;
  if (!q) return null;
  const onIndigo = inside && look === 'page' && m.own && !m.internal && !isColleague(m);
  if (look === 'drawer') {
    return (
      <div data-reply-quote className={cx('mb-1 rounded-[6px] border-l-[3px] border-primary bg-black/[.04] px-2 py-1 text-[11.5px] dark:bg-white/5', m.own && 'dark:border-indigo-bright')}>
        <b className={cx('block', accentOf(m, look))}>{q.author}</b>
        <span className="line-clamp-2 text-ink-2">{q.snippet}</span>
      </div>
    );
  }
  return (
    <div data-reply-quote title={`${q.author} · ${q.snippet}`} className={cx('mb-1.5 line-clamp-2 border-l-[3px] pl-2 text-[12px] leading-[1.4]', onIndigo ? 'border-white/50 text-white/85' : 'border-primary/60 text-ink-2', !inside && 'rounded-[6px] bg-selection py-1 pr-2')}>
      <b className={onIndigo ? 'text-white' : 'text-ink'}>{q.author}</b> · {q.snippet}
    </div>
  );
}

function Reactions({ m, look, enabled, onReact }: { m: KitMessage; look: Look; enabled: boolean; onReact: (emoji: string) => void }) {
  const list = m.reactions ?? [];
  if (!list.length) return null;
  return (
    <div className={cx('flex flex-wrap gap-1', look === 'drawer' && cx('relative z-10', m.card ? 'mt-1' : '-mt-1.5', m.own ? 'mr-2' : 'ml-2'))}>
      {list.map((r) => (
        <button
          key={r.emoji}
          type="button"
          disabled={!enabled}
          onClick={() => onReact(r.emoji)}
          title={r.names?.join(', ')}
          aria-label={`${r.emoji} ${r.count}${r.mine ? ', yours — remove' : ''}`}
          className={
            look === 'drawer'
              ? cx('rounded-full bg-surface px-1.5 py-px text-[11.5px] font-semibold text-ink shadow-[0_1px_3px_rgb(var(--ws-shadow-rgb)/.18)]', r.mine && 'ring-1 ring-primary/40')
              : cx('rounded-full border px-2 py-px text-[11.5px]', r.mine ? 'border-info-line bg-selection dark:border-primary/40' : 'border-line bg-surface hover:bg-subtle')
          }
        >
          {r.emoji} {r.count}
        </button>
      ))}
    </div>
  );
}

/**
 * What a voice message in `m` is known by (#285): its key, the client id its sender's measurements wait under, whether
 * this person has played it, where playing is noted, and the other side's avatar for its microphone badge.
 */
function voiceOf(m: KitMessage, caps: ChannelCaps): VoiceOf {
  return {
    key: m.key,
    alias: m.chat?.client_message_id ?? null,
    listened: m.listened,
    listenedPath: caps.listenedPath ? caps.listenedPath.replace('{id}', String(m.id)) : null,
    avatar: m.own ? null : <KitAvatar author={m.author} size={30} />,
  };
}

/** Record links in the text, and the words a share card shows (its sharer's own note only). */
function useShownText(m: KitMessage): { named: boolean; shown: string | null } {
  const origin = useStore(app, (x) => x.auth?.server?.origin);
  const card = m.chat?.card;
  const named = !!m.chat && !m.deleted && !card && recordsIn(m.body, origin).length > 0;
  const words = named && m.body ? withoutRecordLines(m.body, origin) : m.body;
  return { named, shown: card?.kind === 'drive.share' ? (card.note ?? null) : words };
}

export interface BubbleProps {
  m: KitMessage;
  look: Look;
  position: Position;
  caps: ChannelCaps;
  handlers: MessageHandlers;
  renderers?: KitRenderers;
  /** The drawer names the other side's runs in a group conversation. */
  group?: boolean;
  /** A card right after another card of the same sender: sits closer, without a header. */
  cardContinuation?: boolean;
  /** The last card of such a run carries the time. */
  lastCard?: boolean;
}

export function MessageBubble(props: BubbleProps) {
  return props.look === 'drawer' ? <DrawerBubble {...props} /> : <PageBubble {...props} />;
}

function useBubbleState(m: KitMessage, h: MessageHandlers) {
  const [picker, setPicker] = useState(false);
  const [deleting, setDeleting] = useState<'everyone' | 'me' | null>(null);
  const react = (emoji: string) => {
    setPicker(false);
    h.onReact?.(m, emoji);
  };
  return { picker, setPicker, deleting, setDeleting, react };
}

function PageBubble({ m, position, caps, handlers: h, renderers, cardContinuation = false, lastCard = true }: BubbleProps) {
  const own = m.own;
  const first = isFirst(position);
  const { picker, setPicker, deleting, setDeleting, react } = useBubbleState(m, h);
  const { named, shown } = useShownText(m);
  // Record messages give up their width in a narrow column.
  const carded = named || (!!m.chat?.card && !m.deleted);
  const items = messageActionItems(m, caps, h, 'page', setDeleting);
  const reactable = canReact(m, caps, h);
  // A note names its author in its label instead (C-08).
  const header = !cardContinuation && first && (!own || !!m.signed) && m.author.role !== 'bot' && !m.internal;
  const colleague = isColleague(m);
  const files = !m.deleted ? (m.files ?? []) : [];
  const accent = accentOf(m, 'page');
  const attachment = files.length ? <MessageAttachments files={files} at={m.at} look="page" own={own} voice={caps.voice || m.chat?.type === 'voice'} of={voiceOf(m, caps)} accent={accent} /> : null;
  // On hover, in the message's top-right corner: react, reply, star and the rest (worksuite-desktop#266).
  const actions = !m.deleted ? <MessageToolbar look="page" m={m} own={own} caps={caps} handlers={h} items={items} onMoreReactions={() => setPicker(true)} /> : null;
  const inBubble = !!shown && !m.deleted && !carded;
  const meta = carded ? null : own ? (isLast(position) || m.receipt || m.edited || m.starred ? <MessageMeta m={m} /> : null) : m.edited || m.starred ? <MessageMeta m={m} showTime={false} /> : null;
  return (
    <div className={cx('group relative flex gap-2.5', cardContinuation ? 'mt-1.5' : first ? 'mt-3' : 'mt-1', own && 'flex-row-reverse')}>
      {!own ? first && !cardContinuation ? <KitAvatar author={m.author} size={30} /> : <span aria-hidden="true" className="w-[30px] shrink-0" /> : null}
      <div data-bubble className={cx('relative flex min-w-0 flex-col gap-1', own ? 'items-end' : 'items-start', carded ? 'w-[400px] max-w-full' : 'max-w-[560px]')}>
        {!carded ? actions : null}
        {m.internal && first ? <InternalLabel author={m.signed ? m.author.name : null} /> : null}
        {header ? (
          // Each staff message named, with the colleague's photo; my own say "You" (C-08, TEAM-05).
          <span className="flex items-center gap-1.5 text-[12px]">
            {colleague ? <KitAvatar author={m.author} size={16} /> : null}
            <b className="text-ink">{m.signed && m.author.role === 'self' ? text('You') : m.author.name}</b> <span className="text-ink-3">{!carded ? timeLabel(m.at) : null}</span>
          </span>
        ) : null}
        {!inBubble && !m.deleted && !carded ? <ReplyQuote m={m} look="page" inside={false} /> : null}
        {m.urgent && !m.deleted ? <span className="text-[10.5px] font-bold tracking-[0.5px] text-danger uppercase">Urgent</span> : null}
        {inBubble ? (
          <div data-bubble-body style={colleague ? { ['--c' as string]: nameColour(m.author.name) } : undefined} className={cx('whitespace-pre-wrap break-words px-[13px] py-[9px] text-[13.5px] leading-[1.55] selectable', bubbleTone(m, 'page'), CORNERS[own ? 'right' : 'left'][position])}>
            {m.author.role === 'bot' ? <BotLabel name={m.author.name} /> : null}
            <ReplyQuote m={m} look="page" inside />
            <MessageText text={shown!} accent={accent} markdown={caps.markdown} />
          </div>
        ) : m.deleted ? (
          <div className="rounded-[12px] border border-line px-3 py-2 text-[12.5px] text-ink-3 italic">Message deleted</div>
        ) : null}
        {carded ? (
          <RecordMessage own={own} text={shown} actions={actions} footer={lastCard ? <MessageMeta m={m} inline /> : null}>
            {renderers?.records?.(m, named)}
            {attachment}
          </RecordMessage>
        ) : null}
        {!carded ? attachment : null}
        {inBubble && caps.linkPreviewPath ? <MessageLinkPreview body={shown} path={caps.linkPreviewPath} /> : null}
        <Reactions m={m} look="page" enabled={reactable} onReact={react} />
        {meta}
        {m.footer ? <span className="text-[11px] text-ink-3">{m.footer}</span> : null}
      </div>
      {picker ? <EmojiPicker className={cx('absolute top-8 z-30', own ? 'right-2' : 'left-10')} onPick={react} onClose={() => setPicker(false)} /> : null}
      {deleting ? <DeleteDialog m={m} scope={deleting} setScope={setDeleting} onDelete={(scope) => h.onDelete?.(m, scope)} /> : null}
    </div>
  );
}

function DrawerBubble({ m, position, caps, handlers: h, renderers, group = false, cardContinuation = false, lastCard = true }: BubbleProps) {
  const own = m.own;
  const first = isFirst(position);
  const { picker, setPicker, deleting, setDeleting, react } = useBubbleState(m, h);
  const { named, shown } = useShownText(m);
  const card = m.chat?.card;
  const files = !m.deleted ? (m.files ?? []) : [];
  const media = files.length > 0;
  const carded = named || (!!card && !m.deleted);
  const accent = accentOf(m, 'drawer');
  const items = messageActionItems(m, caps, h, 'drawer', setDeleting);
  const attachment = media ? <MessageAttachments files={files} at={m.at} look="drawer" own={own} voice={caps.voice || m.chat?.type === 'voice'} of={voiceOf(m, caps)} accent={accent} /> : null;
  const actions = !m.deleted ? <MessageToolbar m={m} own={own} caps={caps} handlers={h} items={items} onMoreReactions={() => setPicker(true)} /> : null;
  const padded = media || !!card;
  const named_ = ((group && !own) || !!m.signed) && first && m.author.role !== 'bot';
  return (
    <div className={cx('group relative flex', own ? 'justify-end' : 'justify-start', cardContinuation ? 'mt-1.5' : first ? 'mt-2.5' : 'mt-1')}>
      <div data-bubble className={cx('relative flex min-w-0 flex-col', own ? 'items-end' : 'items-start', carded ? 'w-[400px] max-w-full' : 'max-w-[84%]')}>
        {!carded ? actions : null}
        {m.internal && first ? <InternalLabel /> : null}
        <div className={carded ? 'w-full text-ink' : cx('min-w-[64px] rounded-[10px] text-[13px] leading-[1.45] text-ink shadow-[0_1px_1px_rgb(var(--ws-shadow-rgb)/.1)]', bubbleTone(m, 'drawer'), media ? 'p-1' : 'px-2.5 py-1.5')}>
          {named_ ? (
            <b className={cx('block text-[11.5px]', DATA_TEXT, padded && 'px-1.5 pt-0.5')} style={{ ['--c' as string]: nameColour(m.author.name) }}>
              {m.author.name}
            </b>
          ) : null}
          {m.author.role === 'bot' ? <BotLabel name={m.author.name} /> : null}
          {m.reply || m.replyRemoved ? (
            <div className={cx(padded && 'mx-0.5')}>
              <ReplyQuote m={m} look="drawer" inside />
            </div>
          ) : null}
          {m.urgent && !m.deleted ? <span className={cx('block text-[10px] font-bold tracking-[0.5px] text-danger uppercase', padded && 'px-1.5')}>Urgent</span> : null}
          {m.deleted ? (
            <div className="flex flex-wrap items-end">
              <span className="text-ink-3 italic">Message deleted</span>
              <MessageMeta m={m} inline />
            </div>
          ) : carded ? (
            <RecordMessage own={own} text={shown} actions={actions} footer={lastCard ? <MessageMeta m={m} inline /> : null}>
              {renderers?.records?.(m, named)}
              {attachment}
            </RecordMessage>
          ) : (
            <>
              {attachment}
              <div className={cx('flex flex-wrap items-end gap-x-2', (padded || named) && 'px-1.5 pb-0.5')}>
                {shown ? (
                  <span className={cx('min-w-0 whitespace-pre-wrap break-words selectable', (padded || named) && 'pt-1')}>
                    <LinkedText text={shown} className={accent} display={shortUrl} />
                  </span>
                ) : null}
                <MessageMeta m={m} inline />
              </div>
            </>
          )}
        </div>
        <Reactions m={{ ...m, card: carded }} look="drawer" enabled={canReact(m, caps, h)} onReact={react} />
        {m.footer ? <span className="mt-0.5 text-[11px] text-ink-3">{m.footer}</span> : null}
        {picker ? <EmojiPicker className={cx('absolute top-6 z-30', own ? 'right-0' : 'left-0')} onPick={react} onClose={() => setPicker(false)} /> : null}
      </div>
      {deleting ? <DeleteDialog m={m} scope={deleting} setScope={setDeleting} onDelete={(scope) => h.onDelete?.(m, scope)} /> : null}
    </div>
  );
}
