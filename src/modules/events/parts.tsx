import { createContext, useContext, useState, type ReactNode } from 'react';
import { Icon } from '../../components/Icon';
import { cx } from '../../components/ui';
import { apiUrl } from '../../core/api';
import type { ScanView } from '@shared/event-desk';
import { at, type EventItem, type Options } from './api';
import type { EventView, Screen } from './routes';
import { StatCard, type StatTone } from '../../components/StatCard';

/** What every screen of an event shares: the event, the person's permissions in its company, the way round. */
export interface EventCtx {
  event: EventItem;
  options: Options;
  may: (perm: string) => boolean;
  mayAny: (...perms: string[]) => boolean;
  online: boolean;
  go: (view: EventView, list?: string | null) => void;
  open: (s: Screen) => void;
  openWindow: (view: EventView, title: string) => void;
}

export const EventContext = createContext<EventCtx | null>(null);

export function useEvent(): EventCtx {
  const e = useContext(EventContext);
  if (!e) throw new Error('useEvent outside EventsShell');
  return e;
}

/** The server's colour word → the desk's tone. Never colour alone: every result carries its words and an icon. */
export function toneOf(colour: string | null | undefined): 'success' | 'warning' | 'danger' | 'muted' {
  return colour === 'green' ? 'success' : colour === 'amber' ? 'warning' : colour === 'red' ? 'danger' : 'muted';
}

const TONE: Record<ReturnType<typeof toneOf>, { box: string; icon: string; text: string }> = {
  success: { box: 'border-success/40 bg-success-bg', icon: 'check-circle', text: 'text-success' },
  warning: { box: 'border-warning/40 bg-warning-bg', icon: 'warning', text: 'text-warning' },
  danger: { box: 'border-danger/40 bg-danger-bg', icon: 'x-circle', text: 'text-danger' },
  muted: { box: 'border-line bg-subtle', icon: 'info', text: 'text-ink-2' },
};

/** The headline of a scan: what happened, in the server's words ("Checked in" once recorded, else the verdict). */
export function headline(v: Pick<ScanView, 'done' | 'action' | 'label' | 'result'>): string {
  if (v.done && v.result === 'VALID') return v.action === 'CHECK_OUT' ? 'Checked out' : 'Checked in';
  return v.label;
}

/**
 * A scan's answer as the gate shows it (EV-CHK-002, EV-CHK-010, EV-POR-023):
 * the whole panel in the result's colour, its icon, the words, the attendee,
 * the ticket and where they are — readable from across the desk.
 */
export function ResultPanel({ view, local, message, children }: { view: ScanView; local: boolean; message?: string | null; children?: ReactNode }) {
  const tone = toneOf(view.colour);
  const t = TONE[tone];
  return (
    <section aria-live="assertive" aria-label="Scan result" className={cx('flex flex-col gap-3 rounded-[16px] border-2 p-5', t.box)}>
      <div className={cx('flex items-center gap-3', t.text)}>
        <Icon name={t.icon} size={40} strokeWidth={2.2} />
        <div className="min-w-0">
          <div className="text-[28px] leading-tight font-extrabold">{headline(view)}</div>
          <div className="text-[15px] font-semibold">{view.reason}</div>
        </div>
      </div>
      {view.warning ? (
        <div className="flex items-center gap-2 rounded-[10px] bg-warning-bg px-3 py-1.5 text-[13.5px] font-semibold text-warning">
          <Icon name="warning" size={16} /> {view.warning}
        </div>
      ) : null}
      {view.attendee || view.registration ? (
        <div className="grid grid-cols-[1fr_auto] items-start gap-4">
          <div className="min-w-0">
            <div className="truncate text-[24px] font-bold text-ink">{view.attendee?.name || view.registration?.number}</div>
            {view.attendee?.company || view.attendee?.job_title ? <div className="text-[15px] text-ink-2">{[view.attendee.job_title, view.attendee.company].filter(Boolean).join(' · ')}</div> : null}
            <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-[13.5px] text-ink-2">
              {view.ticket ? (
                <span>
                  <span className="text-ink-3">Ticket</span> <b className="text-ink">{view.ticket.name}</b>
                  {view.ticket.access_days?.length ? <span className="text-ink-3"> · days {view.ticket.access_days.join(', ')}</span> : null}
                </span>
              ) : null}
              {view.registration ? (
                <span>
                  <span className="text-ink-3">Number</span> <b className="font-mono text-ink">{view.registration.number}</b> · {view.registration.status_label}
                </span>
              ) : null}
              {view.presence ? (
                <span>
                  <span className="text-ink-3">Now</span> <b className="text-ink">{view.presence.state_label}</b>
                  {view.presence.entries > 0 ? ` · ${view.presence.entries} ${view.presence.entries === 1 ? 'entry' : 'entries'}` : ''}
                  {view.presence.last_in ? ` · last in ${at(view.presence.last_in)}` : ''}
                  {view.presence.last_gate ? ` at ${view.presence.last_gate.name}` : ''}
                </span>
              ) : null}
              {view.ticket?.allowed_gates?.length && view.result === 'ACCESS_DENIED' ? (
                <span>
                  <span className="text-ink-3">Admitted at</span> {view.ticket.allowed_gates.filter(Boolean).map((g) => g!.name).join(', ')}
                </span>
              ) : null}
            </div>
          </div>
          {view.attendee?.photo_file_id ? <Photo fileId={view.attendee.photo_file_id} name={view.attendee.name} /> : null}
        </div>
      ) : null}
      {local ? (
        <div className="flex items-center gap-2 text-[12.5px] font-medium text-ink-2">
          <Icon name="cloud-off" size={14} /> Answered by this computer from its offline copy{message ? ` — ${message}` : ''}
        </div>
      ) : message && message !== `${view.label}: ${view.reason}` ? (
        <div className="text-[12.5px] text-ink-2">{message}</div>
      ) : null}
      {children}
    </section>
  );
}

/**
 * The attendee's photo for photo verification (EV-CHK-070). The server names
 * a Files record; the file's own download is what the desk can ask for, and
 * a person who may not read it sees the words instead of a broken picture.
 */
function Photo({ fileId, name }: { fileId: number; name: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return (
      <div className="grid size-[96px] place-items-center rounded-[12px] border border-line bg-surface p-2 text-center text-[11px] text-ink-3">
        <Icon name="user" size={22} />
        Photo on file, not readable here
      </div>
    );
  }
  return <img alt={`Photo of ${name}`} src={apiUrl(`/api/files/${fileId}/download`)} onError={() => setFailed(true)} className="size-[96px] rounded-[12px] border border-line object-cover" />;
}

/** A refusal in the server's own sentence, with what the screen may offer beside it. */
export function Refusal({ text, children }: { text: string; children?: ReactNode }) {
  return (
    <div role="alert" className="flex flex-col gap-2 rounded-[10px] border border-danger/30 bg-danger-bg px-3 py-2.5 text-[12.5px] text-danger">
      <span className="flex items-start gap-2">
        <Icon name="alert" size={15} className="mt-px shrink-0" />
        <span className="min-w-0 flex-1 font-medium">{text}</span>
      </span>
      {children}
    </div>
  );
}

export function Facts({ rows, className }: { rows: Array<[string, ReactNode]>; className?: string }) {
  return (
    <dl className={cx('m-0 grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1.5 text-[13px]', className)}>
      {rows.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-ink-3">{k}</dt>
          <dd className="m-0 min-w-0 text-ink">{v ?? '—'}</dd>
        </div>
      ))}
    </dl>
  );
}

export function NoAccess({ what }: { what: string }) {
  return (
    <div className="p-6">
      <div className="flex items-start gap-3 rounded-[12px] border border-line bg-surface p-5">
        <Icon name="lock" size={18} className="mt-0.5 text-ink-3" />
        <p className="m-0 text-[13px] text-ink-2">{what}</p>
      </div>
    </div>
  );
}

/** A big number with its words — the live counters (EV-POR-011). */
export function Counter({ label, value, hint, big, icon, tone }: { label: string; value: number | string | null | undefined; hint?: string; big?: boolean; icon?: string; tone?: StatTone }) {
  return <StatCard size={big ? 'lg' : 'md'} label={label} value={value ?? '—'} sub={hint} icon={icon} tone={tone} />;
}

export function Header({ title, sub, actions }: { title: ReactNode; sub?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-3 px-6 pt-5 pb-3">
      <div className="min-w-0">
        <h1 className="m-0 text-[20px] font-bold text-ink">{title}</h1>
        {sub ? <p className="mt-1 mb-0 text-[12.5px] text-ink-2">{sub}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  );
}

/** A key on the keyboard, as the desk's buttons name them. */
export function Key({ children }: { children: ReactNode }) {
  return <kbd className="rounded-[5px] border border-line bg-subtle px-1.5 py-0.5 font-mono text-[11px] font-semibold text-ink-2">{children}</kbd>;
}
