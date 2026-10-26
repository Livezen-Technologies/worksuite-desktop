import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Icon } from '../../components/Icon';
import { Button, Card, ErrorNote, Modal, Spinner, cx } from '../../components/ui';
import { call } from '../../core/bridge';
import { toast } from '../../core/toasts';
import { at, eGet, ePost, errorText, K, money, nice, type When } from './api';
import { Header, Refusal, useEvent } from './parts';
import { StatCard, StatGrid, type StatTone } from '../../components/StatCard';

/**
 * Event 360 as the organiser reads it at the desk (EV-EVT-030, EV-RPT-001,
 * §16 "Live Event Mode"): the server's counts, each with what it counts
 * (EV-RPT: "every attendance metric states its population"), the capacity,
 * ticket money for financial viewers, and — while the event is live — the
 * operations view (`GET dashboard`). The emergency message on the event's
 * screens is here for those who may raise it (§11.5, typed confirmation).
 * Editing the event is the web's ("Open on the web").
 */

type Kpi = { value: unknown; means?: string } | null;

interface Overview {
  event: { id: number; name: string; status_label: string; display_label: string | null; start: When | null; end: When | null; venues?: Array<{ name: string }> | null; delivery_mode: string };
  tabs: string[];
  kpis: Record<string, Kpi>;
  capacity: { limit: number | null; taken: number };
}

interface Dashboard {
  mode: string;
  live: Record<string, unknown> | null;
}

interface Override {
  id: number;
  message: string;
  status: string;
  status_label: string;
  detail: string | null;
  requested_by: string | null;
  requested_at: When | null;
  version: number;
}

const KPI_ICON: Record<string, [string, StatTone]> = {
  registered: ['users', 'blue'],
  confirmed: ['badge-check', 'green'],
  pending: ['hourglass', 'amber'],
  waitlisted: ['list-todo', 'violet'],
  cancelled: ['ban', 'neutral'],
  checked_in: ['ticket', 'green'],
  inside: ['door', 'blue'],
  checked_out: ['logout', 'neutral'],
  sessions_today: ['calendar-clock', 'violet'],
  speakers: ['mic', 'cyan'],
  seats_left: ['concierge', 'cyan'],
};

const KPI_LABEL: Record<string, string> = {
  registered: 'Registered',
  confirmed: 'Confirmed',
  pending: 'Pending',
  waitlisted: 'Waitlisted',
  cancelled: 'Cancelled',
  checked_in: 'Checked in',
  inside: 'Inside now',
  checked_out: 'Checked out',
  sessions_today: 'Sessions today',
  speakers: 'Speakers',
  seats_left: 'Seats left',
};

function show(v: unknown): string {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'number' || typeof v === 'string') return String(v);
  if (typeof v === 'object' && 'value' in (v as object)) return show((v as { value: unknown }).value);
  if (Array.isArray(v)) return String(v.length);
  return '—';
}

export default function Overview() {
  const { event, may, online } = useEvent();
  const o = useQuery({ queryKey: [...K.event(event.id), 'overview'], queryFn: ({ signal }) => eGet<Overview>(`/events/${event.id}/overview`, undefined, signal), enabled: online, refetchInterval: 60_000 });
  const d = useQuery({
    queryKey: [...K.live(event.id), 'dashboard'],
    queryFn: ({ signal }) => eGet<Dashboard>(`/events/${event.id}/dashboard`, { mode: 'auto' }, signal),
    enabled: online && may('events.report.view'),
    refetchInterval: 30_000,
    retry: false,
  });
  const data = o.data;
  const revenue = data?.kpis.ticket_revenue?.value;

  return (
    <div className="flex flex-col gap-4 pb-6">
      <Header
        title="Event 360"
        sub={data ? `${data.event.display_label ?? data.event.status_label} · ${at(data.event.start)}${data.event.end ? ` – ${at(data.event.end)}` : ''} · ${nice(data.event.delivery_mode)}` : event.name}
        actions={
          <Button size="sm" icon="external" onClick={() => void call('app:openInBrowser', { path: `/events/${event.id}` }).catch((e) => toast('error', errorText(e)))}>
            Open on the web
          </Button>
        }
      />
      <div className="flex flex-col gap-4 px-6">
        {!online ? <Refusal text="Event 360 is WorkSuite’s: it comes back with the line." /> : null}
        {o.isLoading ? <Spinner /> : null}
        {o.error ? <ErrorNote error={o.error} onRetry={() => void o.refetch()} /> : null}
        {data ? (
          <>
            <StatGrid min={180}>
              {Object.entries(KPI_LABEL).map(([k, label]) => {
                const kpi = data.kpis[k];
                if (!kpi) return null;
                const [icon, tone] = KPI_ICON[k] ?? ['chart', 'neutral'];
                return <StatCard key={k} title={kpi.means} label={label} value={kpi.value === null && k === 'seats_left' ? 'No limit' : show(kpi.value)} sub={kpi.means || undefined} icon={icon} tone={tone} />;
              })}
            </StatGrid>
            <Card title="Capacity">
              <p className="m-0 text-[13px] text-ink-2">
                {data.capacity.limit === null ? `${data.capacity.taken} seats taken; the event has no limit.` : `${data.capacity.taken} of ${data.capacity.limit} seats taken.`}
              </p>
            </Card>
            {Array.isArray(revenue) && revenue.length > 0 ? (
              <Card title="Ticket money (as Finance confirmed it)">
                <table className="w-full text-[13px]">
                  <thead>
                    <tr className="text-left text-[11px] text-ink-3">
                      <th className="py-1 font-semibold">Currency</th>
                      <th className="py-1 text-right font-semibold">Paid</th>
                      <th className="py-1 text-right font-semibold">Refunded</th>
                      <th className="py-1 text-right font-semibold">Net</th>
                      <th className="py-1 text-right font-semibold">Still owed</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(revenue as Array<Record<string, string>>).map((r) => (
                      <tr key={r.currency} className="border-t border-line tabular-nums">
                        <td className="py-1.5">{r.currency}</td>
                        <td className="py-1.5 text-right">{money(r.paid)}</td>
                        <td className="py-1.5 text-right">{money(r.refunded)}</td>
                        <td className="py-1.5 text-right font-semibold">{money(r.net)}</td>
                        <td className="py-1.5 text-right">{money(r.outstanding)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Card>
            ) : null}
          </>
        ) : null}
        {d.data?.live ? (
          <Card title="Live event">
            <StatGrid min={160}>
              {Object.entries(d.data.live)
                .filter(([, v]) => !Array.isArray(v))
                .map(([k, v]) => (
                  <StatCard
                    key={k}
                    size="sm"
                    title={typeof v === 'object' && v ? String((v as { means?: string }).means ?? '') : undefined}
                    label={nice(k)}
                    value={show(v)}
                    icon={KPI_ICON[k]?.[0] ?? 'activity'}
                    tone={KPI_ICON[k]?.[1] ?? 'blue'}
                  />
                ))}
            </StatGrid>
          </Card>
        ) : null}
        {may('events.screen.override') ? <Emergency /> : null}
      </div>
    </div>
  );
}

/**
 * The emergency message on the event's screens (§11.5, EV-SCR emergency
 * override): the word EMERGENCY typed to confirm, as the server asks; on
 * every screen of the event until cleared with a reason. Display Manager
 * delivery is the server's to report.
 */
function Emergency() {
  const { event, online } = useEvent();
  const qc = useQueryClient();
  const open = useQuery({
    queryKey: [...K.live(event.id), 'overrides'],
    queryFn: ({ signal }) => eGet<{ items: Override[] }>(`/events/${event.id}/screens/overrides`, { open: 1 }, signal),
    enabled: online,
    retry: false,
  });
  const [raise, setRaise] = useState(false);
  const [message, setMessage] = useState('');
  const [word, setWord] = useState('');
  const [clearing, setClearing] = useState<Override | null>(null);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const send = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await ePost(`/events/${event.id}/screens/override`, { message: message.trim(), targets: 'ALL', confirmation: word.trim(), confirm: word.trim().toUpperCase() === 'EMERGENCY' });
      toast('success', r.message);
      setRaise(false);
      setMessage('');
      setWord('');
      void qc.invalidateQueries({ queryKey: K.live(event.id) });
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  const clear = async () => {
    if (!clearing) return;
    setBusy(true);
    setError(null);
    try {
      const r = await ePost(`/screen-overrides/${clearing.id}/clear`, { reason: reason.trim(), version: clearing.version });
      toast('success', r.message);
      setClearing(null);
      setReason('');
      void qc.invalidateQueries({ queryKey: K.live(event.id) });
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  const items = open.data?.items ?? [];

  return (
    <Card
      title="Emergency message on screens"
      action={
        <Button size="sm" variant="danger" icon="warning" disabled={!online} onClick={() => setRaise(true)}>
          Put a message on every screen
        </Button>
      }
    >
      {items.length === 0 ? <p className="m-0 text-[13px] text-ink-3">No emergency message is on.</p> : null}
      <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
        {items.map((o) => (
          <li key={o.id} className={cx('flex items-center gap-3 rounded-[10px] border border-danger/40 bg-danger-bg px-3 py-2 text-[13px] text-danger')}>
            <Icon name="warning" size={16} />
            <span className="min-w-0 flex-1">
              <b className="block">{o.message}</b>
              <span className="text-[12px]">
                {o.status_label}
                {o.requested_by ? ` · ${o.requested_by}` : ''} · {at(o.requested_at)}
                {o.detail ? ` — ${o.detail}` : ''}
              </span>
            </span>
            <Button size="sm" onClick={() => setClearing(o)}>
              Clear
            </Button>
          </li>
        ))}
      </ul>
      {raise ? (
        <Modal
          title="Emergency message on every screen"
          onClose={() => setRaise(false)}
          width={480}
          footer={
            <>
              <Button onClick={() => setRaise(false)}>Cancel</Button>
              <Button variant="danger" loading={busy} disabled={!message.trim() || !word.trim()} onClick={() => void send()}>
                Show it now
              </Button>
            </>
          }
        >
          <div className="flex flex-col gap-3 text-[12.5px]">
            <label className="flex flex-col gap-1 font-semibold text-ink-2">
              Message
              <textarea autoFocus value={message} onChange={(e) => setMessage(e.target.value)} rows={3} maxLength={500} className="rounded-[8px] border border-line bg-surface px-2.5 py-1.5 text-[13px] font-normal text-ink outline-none focus:border-primary" />
            </label>
            <label className="flex flex-col gap-1 font-semibold text-ink-2">
              Type EMERGENCY to confirm
              <input value={word} onChange={(e) => setWord(e.target.value)} className="h-9 rounded-[8px] border border-line bg-surface px-2.5 text-[13px] font-normal text-ink outline-none focus:border-primary" />
            </label>
            {error ? <Refusal text={error} /> : null}
          </div>
        </Modal>
      ) : null}
      {clearing ? (
        <Modal
          title="Clear the emergency message"
          onClose={() => setClearing(null)}
          width={440}
          footer={
            <>
              <Button onClick={() => setClearing(null)}>Cancel</Button>
              <Button variant="primary" loading={busy} disabled={!reason.trim()} onClick={() => void clear()}>
                Clear
              </Button>
            </>
          }
        >
          <label className="flex flex-col gap-1 text-[12.5px] font-semibold text-ink-2">
            Why
            <input autoFocus value={reason} onChange={(e) => setReason(e.target.value)} className="h-9 rounded-[8px] border border-line bg-surface px-2.5 text-[13px] font-normal text-ink outline-none focus:border-primary" />
          </label>
          {error ? (
            <div className="mt-2">
              <Refusal text={error} />
            </div>
          ) : null}
        </Modal>
      ) : null}
    </Card>
  );
}
