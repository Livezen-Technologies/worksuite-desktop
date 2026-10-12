import type { ReactNode } from 'react';
import { PRIORITY_LABEL, SLA_TARGET_LABEL, SOURCE_LABEL, statusLabel, type Sla, type SlaTarget, type SupportPriority, type SupportSource, type SupportStatus, type TicketOrigin } from '@shared/support';
import { canOpenDesktopRoute, refuse } from '../../core/access';
import { parseTs } from '../../core/time';
import { navigate } from '../../core/tabs';
import { text } from '../../core/i18n';
import { Icon } from '../../components/Icon';
import { cx } from '../../components/ui';

/**
 * The desk's shared look (WS-SUPPORT-SRS-001 §19.2), the same on every support screen:
 *
 *  - a status always shows its words and its colour — New blue, Open amber, In progress indigo, Pending customer
 *    violet, Pending internal fuchsia, Escalated red, Resolved green, Closed slate;
 *  - only Urgent (solid red) and High (orange) priorities are coloured strongly;
 *  - an SLA chip is green (on time, met), amber (at risk), red (breached) or grey (paused), with the time left;
 *  - every list shows the channel's icon and the reference in monospace;
 *  - AI content carries a violet "AI" badge.
 *
 * Colours that are not the app's tokens come in pairs, light and dark, so each reads in both themes.
 */
export const STATUS_TONE: Record<SupportStatus, { chip: string; dot: string }> = {
  new: { chip: 'bg-[#E0EDFF] text-[#1D4ED8] dark:bg-[#15284F] dark:text-[#93C5FD]', dot: 'bg-[#2563EB]' },
  open: { chip: 'bg-[#FEF3C7] text-[#92400E] dark:bg-[#3A2A0A] dark:text-[#FCD34D]', dot: 'bg-[#D97706]' },
  in_progress: { chip: 'bg-[#E0E7FF] text-[#3730A3] dark:bg-[#1E1B4B] dark:text-[#A5B4FC]', dot: 'bg-[#4F46E5]' },
  pending_customer: { chip: 'bg-[#EDE9FE] text-[#5B21B6] dark:bg-[#2A1F4A] dark:text-[#C4B5FD]', dot: 'bg-[#7C3AED]' },
  pending_internal: { chip: 'bg-[#FAE8FF] text-[#86198F] dark:bg-[#3B0F3F] dark:text-[#F0ABFC]', dot: 'bg-[#C026D3]' },
  escalated: { chip: 'bg-[#FEE2E2] text-[#991B1B] dark:bg-[#3A1614] dark:text-[#FCA5A5]', dot: 'bg-[#DC2626]' },
  resolved: { chip: 'bg-[#DCFCE7] text-[#166534] dark:bg-[#12301F] dark:text-[#86EFAC]', dot: 'bg-[#16A34A]' },
  closed: { chip: 'bg-[#E2E8F0] text-[#334155] dark:bg-[#1E293B] dark:text-[#CBD5E1]', dot: 'bg-[#64748B]' },
};

const CHIP = 'inline-flex shrink-0 items-center gap-1 rounded-[6px] px-1.5 py-0.5 text-[11.5px] font-semibold whitespace-nowrap';

export function StatusChip({ status, className }: { status: SupportStatus; className?: string }) {
  const tone = STATUS_TONE[status] ?? STATUS_TONE.open;
  return <span className={cx(CHIP, tone.chip, className)}>{text(statusLabel(status))}</span>;
}

/** What a status dot means, said on hover (worksuite-desktop#333: the green dot by the reference had no explanation). */
export const STATUS_MEANING: Record<SupportStatus, string> = {
  new: 'Nobody has answered yet',
  open: 'Being worked on',
  in_progress: 'Somebody is working on it now',
  pending_customer: 'Waiting for the customer to reply',
  pending_internal: 'On hold, waiting on the team',
  escalated: 'Escalated for attention',
  resolved: 'Solved: waiting for the customer to confirm, or to close by itself',
  closed: 'Closed: a reply starts a follow-up',
};

/** The tooltip of a status dot: the status and what it means ("Status: Resolved — Solved: …"). */
export function statusDotTitle(status: SupportStatus): string {
  return text('Status: {status} — {meaning}', { status: text(statusLabel(status)), meaning: text(STATUS_MEANING[status] ?? '') });
}

/** The status as a dot, for a row where the chip would crowd it; the words are its label, the tooltip says what it means. */
export function StatusDot({ status, className }: { status: SupportStatus; className?: string }) {
  const tone = STATUS_TONE[status] ?? STATUS_TONE.open;
  return <span role="img" aria-label={text(statusLabel(status))} title={statusDotTitle(status)} className={cx('inline-block h-2 w-2 shrink-0 cursor-help rounded-full', tone.dot, className)} />;
}

export function PriorityChip({ priority, quiet = false, className }: { priority: SupportPriority; /** Normal and Low not shown at all. */ quiet?: boolean; className?: string }) {
  if (quiet && (priority === 'normal' || priority === 'low')) return null;
  const tone =
    priority === 'urgent'
      ? 'bg-[#DC2626] text-white dark:bg-[#E5484D]'
      : priority === 'high'
        ? 'bg-[#FFEDD5] text-[#C2410C] dark:bg-[#3B1D0A] dark:text-[#FDBA74]'
        : 'bg-subtle text-ink-3';
  return <span className={cx(CHIP, tone, className)}>{text(PRIORITY_LABEL[priority] ?? priority)}</span>;
}

/** "18m", "3h 20m", "1d 4h": a span of time as the chips say it. */
export function shortSpan(ms: number): string {
  const m = Math.max(0, Math.round(Math.abs(ms) / 60_000));
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return m % 60 ? `${h}h ${m % 60}m` : `${h}h`;
  const d = Math.floor(h / 24);
  return h % 24 ? `${d}d ${h % 24}h` : `${d}d`;
}

const SLA_SHORT: Record<SlaTarget, string> = { first_response: 'FRT', next_response: 'Next', resolution: 'Res' };

/** The SLA chip's tone and words, or null when the server has not computed a state or no policy applies (no chip rather than a guess). */
export function slaLook(sla: Sla | null | undefined, now: number, long = false): { tone: string; label: string; title: string } | null {
  if (!sla?.state || sla.state === 'none') return null;
  const target = sla.target ? (long ? text(SLA_TARGET_LABEL[sla.target]) : text(SLA_SHORT[sla.target])) : text('SLA');
  const due = sla.due_at ? parseTs(sla.due_at).getTime() : NaN;
  const left = Number.isFinite(due) ? due - now : null;
  const tone =
    sla.state === 'breached'
      ? 'bg-danger-bg text-danger'
      : sla.state === 'at_risk'
        ? 'bg-warning-bg text-warning-ink'
        : sla.state === 'paused'
          ? 'bg-subtle text-ink-3'
          : 'bg-success-bg text-success';
  let label: string;
  if (sla.state === 'paused') label = text('Paused');
  else if (sla.state === 'met') label = text('{target} met', { target });
  else if (left === null) label = target;
  else if (left < 0) label = text('{target} overdue {time}', { target, time: shortSpan(left) });
  else label = `${target} ${shortSpan(left)}`;
  const title = sla.state === 'paused' ? text('SLA paused while waiting on the requester') : sla.target ? text('{target} target', { target: text(SLA_TARGET_LABEL[sla.target]) }) : text('SLA');
  return { tone, label, title };
}

export function SlaChip({ sla, now, long = false, className }: { sla: Sla | null | undefined; now: number; long?: boolean; className?: string }) {
  const look = slaLook(sla, now, long);
  if (!look) return null;
  return (
    <span title={look.title} className={cx(CHIP, look.tone, className)}>
      <Icon name={sla?.state === 'paused' ? 'pause' : 'clock'} size={11} />
      {look.label}
    </span>
  );
}

const SOURCE_ICON: Record<string, string> = {
  manual: 'pen',
  email: 'mail',
  chat: 'message-circle',
  widget_offline: 'globe',
  form: 'file-text',
  portal: 'globe',
  whatsapp: 'phone',
  phone: 'phone',
  walk_in: 'door',
  api: 'code',
  module: 'box',
  desktop: 'monitor',
};

/** A channel's icon, by the name the API gives it (a ticket's `source`, a message's `channel`). */
export function channelIcon(source: string): string {
  return SOURCE_ICON[source] ?? 'life-buoy';
}

/** A channel's name, in words: "Email", "Phone", "Walk-in"… */
export function channelLabel(source: string): string {
  return text(SOURCE_LABEL[source as SupportSource] ?? source.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase()));
}

/** Where the ticket came from, as an icon with its name (FR-CRT-06). */
export function ChannelIcon({ source, size = 13, className }: { source: SupportSource | string | null | undefined; size?: number; className?: string }) {
  const s = source ?? 'manual';
  const label = channelLabel(s);
  return (
    <span role="img" aria-label={label} title={label} className={cx('inline-flex shrink-0 text-ink-3', className)}>
      <Icon name={channelIcon(s)} size={size} />
    </span>
  );
}

/** Where a ticket's origin opens in the app (#298): the email in Mail, the website chat in Chat; null when nowhere. */
export function originRoute(origin: TicketOrigin | null | undefined): string | null {
  if (origin?.type === 'email') {
    if (!origin.mail_message_id) return null;
    // The message's own mailbox and folder, as Mail's reminders link to it (`mbx`, `mf`): a uid alone is only a guess.
    const q = new URLSearchParams({ msg: String(origin.mail_message_id) });
    if (origin.mailbox_id) q.set('mbx', String(origin.mailbox_id));
    if (origin.folder) q.set('mf', origin.folder);
    return `/mail?${q.toString()}`;
  }
  if (origin?.type === 'chat') return origin.conversation_id ? `/chat?view=website&website=${origin.conversation_id}` : null;
  return null;
}

/** Opens a ticket's origin in its app, as the person may (the email in Mail, the chat in Chat), or says no. */
export function openOrigin(route: string): void {
  if (!canOpenDesktopRoute(route)) return refuse(route);
  navigate(route);
}

/**
 * "From email" or "From web chat" in a ticket's header (#298), when the server says what it was raised from: a link
 * to that email or chat where there is one to open, else the words alone.
 */
export function OriginLink({ origin, onOpen = openOrigin, className }: { origin: TicketOrigin | null | undefined; onOpen?: (route: string) => void; className?: string }) {
  if (origin?.type !== 'email' && origin?.type !== 'chat') return null;
  const label = origin.type === 'email' ? text('From email') : text('From web chat');
  const route = originRoute(origin);
  const look = cx('inline-flex shrink-0 items-center gap-1 text-[12px]', className);
  const icon = <Icon name={origin.type === 'email' ? 'mail' : 'message-circle'} size={12} />;
  if (!route) {
    return (
      <span data-origin={origin.type} className={cx(look, 'text-ink-3')}>
        {icon}
        {label}
      </span>
    );
  }
  return (
    <button type="button" data-origin={origin.type} onClick={() => onOpen(route)} title={origin.type === 'email' ? text('Open the email in Mail') : text('Open the chat')} className={cx(look, 'font-semibold text-primary hover:underline')}>
      {icon}
      {label}
    </button>
  );
}

const PRESENCE: Record<string, string> = { available: 'Online', busy: 'Busy', away: 'Away', dnd: 'Do not disturb', offline: 'Offline' };

/** An agent's presence, in words ("Online", "Away"…). */
export function presenceLabel(presence: string): string {
  return text(PRESENCE[presence] ?? presence);
}

/** A ticket's reference, in monospace (§19.2). */
export function Reference({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cx('font-mono text-[11.5px] tracking-[.2px] text-ink-2', className)}>{children}</span>;
}

/** AI content's mark: violet, and never sent without an agent's action (AC-17). */
export function AiBadge({ className }: { className?: string }) {
  return <span className={cx('inline-flex items-center rounded-[5px] bg-[#EDE9FE] px-1 text-[10px] font-bold text-[#6D28D9] dark:bg-[#2A1F4A] dark:text-[#C4B5FD]', className)}>AI</span>;
}

/**
 * "Saman Kumara · Guest" (§19.2: the requester's company, or Guest). The API names the requester's company by id
 * only, so a known requester reads as what they are to the desk — a registered customer or a CRM contact.
 */
export function requesterLine(r: { name: string | null; email: string | null; kind: string }): string {
  const who = r.name || r.email || text('Unknown requester');
  const what = r.kind === 'customer' ? text('Registered customer') : r.kind === 'contact' ? text('Contact') : text('Guest');
  return `${who} · ${what}`;
}
