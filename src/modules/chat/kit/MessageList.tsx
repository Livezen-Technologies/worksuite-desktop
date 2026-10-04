import { useMemo, type ReactNode } from 'react';
import { dayKey, dayLabel, parseTs, timeLabel } from '../../../core/time';
import { text } from '../../../core/i18n';
import { Icon } from '../../../components/Icon';
import { cx } from '../../../components/ui';
import { AttachmentGallery, previewKind, type Attachment } from '../AttachmentViewer';
import type { ChannelCaps } from './caps';
import { GROUP_GAP_MS, groupMessages, isSlot, positionIn, type KitItem } from './grouping';
import type { MessageHandlers } from './MessageActions';
import { MessageBubble, type KitRenderers } from './MessageBubble';
import type { Look } from './MessageAttachment';
import type { KitMessage } from './model';

/**
 * The conversation's messages (C-02 "Conversation thread on the shared chat kit"; SRS RDC-11, LIVE-12;
 * worksuite-desktop#229): day dividers, runs of bubbles, notices, the visitor's page visits, and the pictures for the
 * preview's ‹ ›. Team Chat and website chats both draw through this, with their own caps and handlers.
 */

/** "Today", "Yesterday", or the date — the drawer's day pills. */
export function relativeDay(key: string): string {
  const today = dayKey(new Date());
  const d = new Date(`${key}T12:00:00`);
  const y = new Date(d);
  y.setDate(y.getDate() + 1);
  if (key === today) return 'Today';
  if (dayKey(y) === today) return 'Yesterday';
  return dayLabel(key, 'short');
}

export function DayDivider({ day, look }: { day: string; look: Look }) {
  return look === 'drawer' ? (
    <div data-day className="my-2.5 text-center">
      <span className="rounded-[8px] bg-surface px-2 py-[3px] text-[11px] font-bold text-ink-2 shadow-[0_1px_1px_rgb(var(--ws-shadow-rgb)/.08)]">{relativeDay(day)}</span>
    </div>
  ) : (
    <div data-day className="my-3 text-center">
      <span className="rounded-full bg-subtle px-2.5 py-[3px] text-[11.5px] font-semibold text-ink-3">{dayLabel(day, 'short')}</span>
    </div>
  );
}

/** A notice: "Nuwan joined the chat". One only staff see is the chat's event log (TEAM-63): amber, with a lock. */
export function SystemLine({ m, look }: { m: KitMessage; look: Look }) {
  const words = `${m.body ?? ''}${m.timed ? ` · ${timeLabel(m.at)}` : ''}`;
  // A voice call's line (V-03, VOICE-UI-02): a pill with the phone, green — red for one nobody answered or that dropped.
  if (m.tone && !m.internal) {
    return (
      <div data-system data-tone={m.tone} className="my-2 flex justify-center">
        <span
          className={cx(
            'flex items-center gap-1.5 rounded-[12px] border px-3 py-1.5 text-center text-[12px] font-semibold',
            m.tone === 'call' ? 'border-[#BFE3CC] bg-success-bg text-[#1F6B40] dark:border-success/40 dark:text-success' : 'border-[#F6C4B8] bg-danger-bg text-[#8C2A14] dark:border-danger/40 dark:text-danger',
          )}
        >
          <Icon name={m.tone === 'call' ? 'phone' : 'phone-off'} size={12} className="shrink-0" /> {words}
        </span>
      </div>
    );
  }
  if (m.internal) {
    return (
      <div data-system className="my-2 flex justify-center">
        <span className="flex items-center gap-1 text-center text-[11px] text-[#7A4308] dark:text-warning" title="Only staff see this">
          <Icon name="lock" size={10} /> {words}
        </span>
      </div>
    );
  }
  return look === 'drawer' ? (
    <div data-system className="my-2 text-center">
      <span className="rounded-[8px] bg-surface/80 px-2 py-0.5 text-[11.5px] text-ink-3">{words}</span>
    </div>
  ) : (
    <div data-system className="my-2 text-center text-[12px] text-ink-3">{words}</div>
  );
}

/** A page the visitor opened (RDC-11): "→ Opened /shop/x · 2 min"; a new visit says so first. */
export function ActivityEvent({ m }: { m: KitMessage }) {
  return (
    <div data-activity className="my-1.5 text-center text-[12px] text-ink-3" title={m.activity?.url ?? undefined}>
      {m.activity?.newVisit ? <span className="mr-1 font-semibold">{text('New visit')} ·</span> : null}
      {m.body}
    </div>
  );
}

/** "● ● ● Visitor 4F2A is typing…" — on the side of whoever types. */
export function TypingLine({ children, side = 'left' }: { children: ReactNode; side?: 'left' | 'right' }) {
  return (
    <div data-typing className={cx('mt-2 flex items-center gap-1.5 text-[12px] text-ink-3', side === 'right' ? 'justify-end' : 'pl-10')}>
      <span aria-hidden="true" className="flex gap-[3px]">
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-ink-2" />
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-ink-3 [animation-delay:150ms]" />
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-line [animation-delay:300ms]" />
      </span>
      <span>{children}</span>
    </div>
  );
}

/**
 * A message waiting in the outbox: dashed, with why it has not gone and what to do. `waiting` says when it will go.
 */
export function PendingBubble({ label, failed, error, waiting, onRetry, onDiscard, look = 'page' }: { label: string; failed: boolean; error?: string | null; waiting: string; onRetry: () => void; onDiscard?: () => void; look?: Look }) {
  return (
    <div data-pending className="mt-3 flex flex-col items-end gap-1">
      <div className={cx('max-w-[520px] border border-dashed border-[#8C9AD3] bg-[#DDE3F7] text-ink dark:bg-selection', look === 'drawer' ? 'max-w-[84%] rounded-[10px] px-2.5 py-1.5 text-[13px]' : 'rounded-[12px_4px_12px_12px] px-[13px] py-[9px] text-[13.5px]')}>{label}</div>
      <span className="text-[11.5px] font-semibold text-[#9A4A06] dark:text-warning">
        {failed ? (
          <>
            Not sent — {error ?? 'the server refused it'} ·{' '}
            <button type="button" className="underline" onClick={onRetry}>
              Retry
            </button>
            {onDiscard ? (
              <>
                {' '}
                ·{' '}
                <button type="button" className="underline" onClick={onDiscard}>
                  Discard
                </button>
              </>
            ) : null}
          </>
        ) : (
          waiting
        )}
      </span>
    </div>
  );
}

const isCardMessage = (x: KitItem | undefined): x is KitMessage => !!x && !isSlot(x) && x.kind === 'text' && !!x.card;

/** Two cards in a row from one sender on one day sit together under one header (worksuite-desktop#164). */
function cardNeighbours(items: KitItem[], i: number): { cardContinuation: boolean; lastCard: boolean } {
  const m = items[i] as KitMessage;
  if (!isCardMessage(m)) return { cardContinuation: false, lastCard: true };
  const same = (x: KitItem | undefined) => isCardMessage(x) && String(x.author.id ?? x.author.name) === String(m.author.id ?? m.author.name) && dayKey(parseTs(x.at)) === dayKey(parseTs(m.at));
  return { cardContinuation: same(items[i - 1]), lastCard: !same(items[i + 1]) };
}

/** Several picture-only messages in a run become one bubble with a grid (C-02), where the channel allows it. */
function mergePictures(messages: KitMessage[]): KitMessage[] {
  const pictureOnly = (m: KitMessage) => !m.deleted && !m.body && !m.reply && !m.reactions?.length && !m.card && (m.files?.length ?? 0) > 0 && m.files!.every((f) => previewKind(f) === 'image');
  const out: KitMessage[] = [];
  for (const m of messages) {
    const prev = out[out.length - 1];
    if (prev && pictureOnly(prev) && pictureOnly(m)) {
      // The run's last picture carries the time, ticks and actions; the grid opens any of them.
      out[out.length - 1] = { ...m, key: `${prev.key}+${m.key}`, files: [...(prev.files ?? []), ...(m.files ?? [])] };
    } else out.push(m);
  }
  return out;
}

export function MessageGroup({ children }: { children: ReactNode }) {
  return <div data-message-group>{children}</div>;
}

export interface MessageListProps {
  items: KitItem[];
  caps: ChannelCaps;
  look: Look;
  handlers: MessageHandlers;
  renderers?: KitRenderers;
  /** A group conversation: the drawer names the other side's runs. */
  group?: boolean;
  gapMs?: number;
  /** The pictures for ‹ › in the preview; by default those in `items`. */
  gallery?: Attachment[];
}

export function MessageList({ items, caps, look, handlers, renderers, group = false, gapMs = GROUP_GAP_MS, gallery }: MessageListProps) {
  const rows = useMemo(() => groupMessages(items, { gapMs }), [items, gapMs]);
  const pictures = useMemo(
    () => gallery ?? items.flatMap((m) => (isSlot(m) || m.deleted ? [] : (m.files ?? []).filter((f) => previewKind(f) === 'image'))),
    [gallery, items],
  );
  const index = useMemo(() => new Map(items.map((x, i) => [x.key, i])), [items]);
  return (
    <AttachmentGallery.Provider value={pictures}>
      {rows.map((row) => {
        if (row.type === 'day') return <DayDivider key={row.key} day={row.day} look={look} />;
        if (row.type === 'slot') return <div key={row.key}>{row.slot.node}</div>;
        if (row.type === 'line') {
          const m = row.message;
          return (
            <div key={row.key} id={m.kind === 'activity' ? undefined : `msg-${m.id}`}>
              {m.kind === 'activity' ? <ActivityEvent m={m} /> : m.kind === 'call' && renderers?.call ? renderers.call(m, look === 'drawer') : <SystemLine m={m} look={look} />}
            </div>
          );
        }
        const messages = caps.gridImages ? mergePictures(row.messages) : row.messages;
        return (
          <MessageGroup key={row.key}>
            {messages.map((m, i) => {
              const at = index.get(m.key) ?? index.get(m.key.split('+').pop()!) ?? -1;
              const { cardContinuation, lastCard } = at >= 0 ? cardNeighbours(items, at) : { cardContinuation: false, lastCard: true };
              return (
                <div key={m.key} id={`msg-${m.id}`}>
                  <MessageBubble m={m} look={look} position={positionIn(messages.length, i)} caps={caps} handlers={handlers} renderers={renderers} group={group} cardContinuation={cardContinuation} lastCard={lastCard} />
                </div>
              );
            })}
          </MessageGroup>
        );
      })}
    </AttachmentGallery.Provider>
  );
}
