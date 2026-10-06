import { useQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { SLA_TARGET_LABEL, isLive, statusLabel, type Attachment, type SlaTarget, type TicketFull, type TicketLink, type TicketShow } from '@shared/support';
import { call, errorMessage } from '../../core/bridge';
import { text } from '../../core/i18n';
import { bytes, parseTs, stampDayLabel } from '../../core/time';
import { toast } from '../../core/toasts';
import { Icon } from '../../components/Icon';
import { Avatar, Button, FileBadge, cx } from '../../components/ui';
import { K, listTickets } from './api';
import { openAttachment } from './files';
import { STATUS_TONE, shortSpan } from './parts';

/**
 * The ticket tab's side (D-02): the SLA's timers as the server keeps them (FR-SLA-07), the requester with their
 * other tickets (FR-WSP-07), the files on the ticket (opened with the system's application, FR-DSK-06), what it is
 * linked to (FR-TKT-05), and remote support (FR-WSP-08).
 */
export function SideSection({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) {
  return (
    <section aria-label={title} className="flex flex-col gap-1.5 border-t border-line pt-3">
      <h3 className="flex items-center justify-between text-[11px] font-bold tracking-[.4px] text-ink-3 uppercase">
        <span>{title}</span>
        {action}
      </h3>
      {children}
    </section>
  );
}

export type SlaTone = 'ok' | 'risk' | 'breach' | 'paused' | 'none';

const TARGETS: SlaTarget[] = ['first_response', 'next_response', 'resolution'];

/**
 * The three timers, as the server computed them — never worked out here (§12, FR-SLA-07). `sla_timers` gives each
 * target's due time and state; the one that matters now is at risk when the ticket's SLA says so. A first response
 * already given is met, with how long it took. A target the server has no timer for reads "—".
 *
 * A server from before the timers (or a ticket from before its desk was recalculated) gives only the target that
 * matters now: that one is shown, and the first response once it was given.
 */
export function slaRows(t: Pick<TicketFull, 'sla' | 'sla_timers' | 'first_response_at' | 'opened_at' | 'created_at' | 'resolved_at'>, now: number): Array<{ target: SlaTarget; value: string; tone: SlaTone }> {
  const opened = t.opened_at ?? t.created_at;
  const took = (at: string | null | undefined) => (at && opened ? shortSpan(parseTs(at).getTime() - parseTs(opened).getTime()) : null);
  const left = (due: string | null | undefined): number | null => {
    const ms = due ? parseTs(due).getTime() : NaN;
    return Number.isFinite(ms) ? ms - now : null;
  };
  const running = (target: SlaTarget, due: string | null | undefined): { value: string; tone: SlaTone } => {
    const l = left(due);
    if (l === null) return { value: '—', tone: 'none' };
    if (l < 0) return { value: text('{time} overdue', { time: shortSpan(l) }), tone: 'breach' };
    return { value: text('{time} left', { time: shortSpan(l) }), tone: t.sla.target === target && t.sla.state === 'at_risk' ? 'risk' : 'ok' };
  };
  const timers = t.sla_timers ?? [];
  return TARGETS.map((target) => {
    const timer = timers.find((x) => x.target === target);
    if (timer) {
      if (timer.state === 'met') {
        const time = target === 'first_response' ? took(t.first_response_at) : null;
        return { target, value: time ? text('Met · {time}', { time }) : text('Met'), tone: 'ok' as const };
      }
      if (timer.state === 'paused') return { target, value: text('Paused'), tone: 'paused' as const };
      if (timer.state === 'breached' && timer.at) return { target, value: text('Breached'), tone: 'breach' as const };
      return { target, ...running(target, timer.due_at) };
    }
    if (target === 'first_response' && t.first_response_at) {
      const time = took(t.first_response_at);
      return { target, value: time ? text('Met · {time}', { time }) : text('Met'), tone: 'ok' as const };
    }
    if (target === 'resolution' && t.resolved_at) return { target, value: text('Resolved {when}', { when: stampDayLabel(t.resolved_at, 'short') }), tone: 'ok' as const };
    // No timers from this server: the target that matters now, from the ticket's SLA.
    if (timers.length || t.sla.target !== target || !t.sla.state || t.sla.state === 'none') return { target, value: '—', tone: 'none' as const };
    if (t.sla.state === 'paused') return { target, value: text('Paused'), tone: 'paused' as const };
    if (t.sla.state === 'met') return { target, value: text('Met'), tone: 'ok' as const };
    return { target, ...running(target, t.sla.due_at) };
  });
}

const TONE: Record<SlaTone, string> = { ok: 'text-success', risk: 'text-warning-ink font-semibold', breach: 'text-danger font-bold', paused: 'text-ink-3', none: 'text-ink-3' };

export function SlaPanel({ t, now }: { t: TicketFull; now: number }) {
  const rows = slaRows(t, now);
  const none = rows.every((r) => r.tone === 'none');
  return (
    <SideSection title={text('SLA')}>
      {none ? (
        <p className="text-[12px] text-ink-3">{t.sla.state === 'none' ? text('No SLA policy applies to this ticket.') : text('No timers on this ticket yet.')}</p>
      ) : (
        <dl className="flex flex-col gap-1 text-[12.5px]">
          {rows.map((r) => (
            <div key={r.target} className="flex items-center justify-between gap-2">
              <dt className="text-ink-2">{text(SLA_TARGET_LABEL[r.target])}</dt>
              <dd className={cx('tabular-nums', TONE[r.tone])}>{r.value}</dd>
            </div>
          ))}
        </dl>
      )}
      {t.sla.state === 'paused' && t.sla.paused_ms ? <p className="text-[11.5px] text-ink-3">{text('Paused while waiting ({time} so far).', { time: shortSpan(t.sla.paused_ms) })}</p> : null}
    </SideSection>
  );
}

/** Opens what the system has for a link (mail, a call): nothing when it has none. */
function openOutside(url: string): void {
  void call('app:openExternal', { url }).catch(() => undefined);
}

/**
 * The requester, and their other tickets on this desk: those with the same email address, among the tickets I may
 * see. A requester who is a CRM contact opens there (in the contacts app, as the person may).
 */
export function RequesterPanel({ t, onOpen, onOpenLink }: { t: TicketFull; onOpen: (id: number) => void; onOpenLink: (link: string) => void }) {
  const r = t.requester;
  const email = r.email?.trim() ?? '';
  const others = useQuery({
    queryKey: K.requester(email),
    queryFn: ({ signal }) => listTickets({ view: 'all', q: email, limit: 50 }, signal),
    enabled: email !== '',
    staleTime: 60_000,
  });
  const theirs = (others.data?.items ?? []).filter((x) => x.id !== t.id && x.requester.email?.toLowerCase() === email.toLowerCase());
  const open = theirs.filter((x) => isLive(x.status));
  const kind = r.kind === 'customer' ? text('Registered customer') : r.kind === 'contact' ? text('Contact') : text('Guest');
  const phone = r.phone?.replace(/[^+\d]/g, '') ?? '';
  return (
    <SideSection
      title={text('Requester')}
      action={
        r.contact_id ? (
          <button type="button" onClick={() => onOpenLink(`/contacts?open=${r.contact_id}`)} className="font-semibold tracking-normal text-primary normal-case hover:underline">
            {text('Contact')}
          </button>
        ) : null
      }
    >
      <div className="flex items-center gap-2">
        <Avatar name={r.name ?? r.email} size={30} />
        <div className="min-w-0">
          <div className="truncate text-[13px] font-semibold text-ink">{r.name || r.email || text('Unknown requester')}</div>
          <div className="truncate text-[11.5px] text-ink-3">{kind}</div>
        </div>
      </div>
      <div className="flex flex-col gap-0.5 text-[12px]">
        {email ? (
          <a
            href={`mailto:${email}`}
            onClick={(e) => {
              e.preventDefault();
              openOutside(`mailto:${email}`);
            }}
            className="truncate text-primary hover:underline"
          >
            {email}
          </a>
        ) : null}
        {r.phone ? (
          <a
            href={`tel:${phone}`}
            onClick={(e) => {
              e.preventDefault();
              if (phone) openOutside(`tel:${phone}`);
            }}
            className="truncate text-ink-2 hover:underline"
          >
            {r.phone}
          </a>
        ) : null}
      </div>
      {email && others.isSuccess ? (
        <div className="text-[12px] text-ink-2">
          {theirs.length ? text('{n} other tickets · {open} open', { n: theirs.length, open: open.length }) : text('No other tickets')}
          {open.length ? (
            <ul aria-label={text('Their open tickets')} className="mt-1 flex flex-col gap-0.5">
              {open.slice(0, 4).map((x) => (
                <li key={x.id}>
                  <button type="button" onClick={() => onOpen(x.id)} className="flex w-full min-w-0 items-center gap-1.5 text-left hover:underline">
                    <span className={cx('h-1.5 w-1.5 shrink-0 rounded-full', STATUS_TONE[x.status]?.dot)} title={text(statusLabel(x.status))} />
                    <span className="shrink-0 font-mono text-[11px]">{x.reference}</span>
                    <span className="min-w-0 truncate text-ink-3">{x.subject}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </SideSection>
  );
}

export function FilesPanel({ files, onAll }: { files: Attachment[]; onAll?: () => void }) {
  if (!files.length) return null;
  return (
    <SideSection
      title={text('Files on this ticket')}
      action={
        files.length > 4 && onAll ? (
          <button type="button" onClick={onAll} className="font-semibold tracking-normal text-primary normal-case hover:underline">
            {text('All {n}', { n: files.length })}
          </button>
        ) : null
      }
    >
      <ul className="flex flex-col gap-1">
        {files.slice(0, 4).map((a) => (
          <li key={a.id}>
            <FileRow a={a} />
          </li>
        ))}
      </ul>
    </SideSection>
  );
}

/**
 * A file on the ticket, opened on this computer with the application the system has for it (FR-DSK-06): the
 * download manager fetches it, and its transfers panel can show it in Finder or Explorer.
 */
export function FileRow({ a }: { a: Attachment }) {
  return (
    <button type="button" onClick={() => void openAttachment(a)} title={text('Open {name}', { name: a.name })} className="flex w-full min-w-0 items-center gap-2 rounded-[8px] px-1 py-1 text-left hover:bg-subtle">
      <FileBadge name={a.name} size={26} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[12.5px] font-semibold text-ink">{a.name}</span>
        <span className="block truncate text-[11px] text-ink-3">
          {[bytes(a.size), a.scan_status === 'unscanned' ? text('not scanned') : null, !a.public ? text('internal') : null, a.created_at ? stampDayLabel(a.created_at, 'short') : null].filter(Boolean).join(' · ')}
        </span>
      </span>
      <Icon name="external" size={13} className="shrink-0 text-ink-3" />
    </button>
  );
}

export function RelatedPanel({ links, onOpen }: { links: TicketLink[]; onOpen: (l: TicketLink) => void }) {
  if (!links.length) return null;
  return (
    <SideSection title={text('Related')}>
      <ul className="flex flex-col gap-0.5">
        {links.slice(0, 6).map((l) => (
          <li key={l.id}>
            <LinkRow l={l} onOpen={onOpen} />
          </li>
        ))}
      </ul>
    </SideSection>
  );
}

const RELATION: Record<string, string> = { related: 'Related', duplicate: 'Possible duplicate', follow_up: 'Follow-up', merged: 'Merged', origin: 'Split from' };

/** What a link points at, in words: "Ticket", "Website chat", "Invoice"… */
export function linkKind(l: Pick<TicketLink, 'module' | 'entity'>): string {
  if (l.entity === 'ticket') return text('Ticket');
  if (l.module === 'communication') return text('Website chat');
  return text(l.entity.replace(/_/g, ' ').replace(/^crm /, '').replace(/^./, (c) => c.toUpperCase()));
}

/** One link: its title and what it is — or, for something the person cannot open, only that it is there. */
export function LinkRow({ l, onOpen }: { l: TicketLink; onOpen: (l: TicketLink) => void }) {
  const what = linkKind(l);
  if (!l.visible) {
    return (
      <span className="flex items-center gap-2 px-1 py-1 text-[12px] text-ink-3">
        <Icon name="lock" size={12} /> {text('{what} you cannot open', { what })}
      </span>
    );
  }
  return (
    <button type="button" disabled={!l.link} onClick={() => onOpen(l)} className="flex w-full min-w-0 items-center gap-2 rounded-[8px] px-1 py-1 text-left hover:bg-subtle disabled:hover:bg-transparent">
      {l.entity === 'ticket' && l.status ? <span className={cx('h-1.5 w-1.5 shrink-0 rounded-full', STATUS_TONE[l.status as keyof typeof STATUS_TONE]?.dot)} title={text(statusLabel(l.status))} /> : null}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[12.5px] font-semibold text-ink">{l.label ?? what}</span>
        <span className="block truncate text-[11px] text-ink-3">{[what, text(RELATION[l.relation] ?? l.relation), l.detail].filter(Boolean).join(' · ')}</span>
      </span>
    </button>
  );
}

/** "1482667019" as RustDesk shows it: "1 482 667 019". A custom ID is left as it is. */
export function groupedId(id: string): string {
  return /^\d{7,}$/.test(id) ? id.replace(/\B(?=(\d{3})+(?!\d))/g, ' ') : id;
}

/**
 * Hands the requester's machine to the RustDesk client installed here (FR-WSP-08, WF-13): `rustdesk://connect/<id>`,
 * the only form the main process opens. No password ever goes in the link — the customer reads theirs out.
 */
export function connectRustDesk(uri: string | null | undefined): void {
  if (!uri) return;
  void call('app:openExternal', { url: uri }).then(
    (ok) => {
      if (!ok) toast('error', text('RustDesk could not be opened. Is it installed on this computer?'));
    },
    (e: unknown) => toast('error', errorMessage(e)),
  );
}

/** Remote support: the requester's RustDesk ID and Connect. Nothing without an ID. */
export function RemotePanel({ show }: { show: TicketShow }) {
  const t = show.ticket;
  if (!t.rustdesk_id) return null;
  const copyConfig = () => {
    const s = show.remote_desk?.config_string;
    if (!s) return;
    void navigator.clipboard?.writeText(s).then(
      () => toast('success', text('Server settings copied. Paste them into RustDesk’s Import server config.')),
      () => toast('error', text('The settings could not be copied.')),
    );
  };
  return (
    <SideSection title={text('Remote support')}>
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1">
          <span className="block text-[11px] text-ink-3">RustDesk</span>
          <span className="block truncate font-mono text-[13px] font-semibold text-ink">{groupedId(t.rustdesk_id)}</span>
        </span>
        <Button size="sm" variant="primary" icon="monitor" disabled={!t.rustdesk_uri} onClick={() => connectRustDesk(t.rustdesk_uri)}>
          {text('Connect')}
        </Button>
      </div>
      {show.remote_desk ? (
        <p className="text-[11px] text-ink-3">
          {text('Through {server}.', { server: show.remote_desk.id_server })}{' '}
          {show.remote_desk.config_string ? (
            <button type="button" onClick={copyConfig} className="font-semibold text-primary hover:underline">
              {text('Copy server settings')}
            </button>
          ) : null}
        </p>
      ) : null}
    </SideSection>
  );
}
