import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type ReactNode } from 'react';
import { SUPPORT_API, PRIORITY_LABEL, SLA_TARGET_LABEL, statusLabel, type Agent, type Meta, type SlaTarget, type SupportPriority, type SupportStatus, type ViewCount } from '@shared/support';
import type { WallDisplay } from '@shared/types';
import { ApiError, request } from '../../core/api';
import { call, isMac, on } from '../../core/bridge';
import { text } from '../../core/i18n';
import { parseTs } from '../../core/time';
import { useNow } from '../../core/use-now';
import { Button, Modal, Spinner, cx } from '../../components/ui';
import { K, agents as agentsOf, meta as metaOf, views as viewsOf } from './api';
import { useRealtimeLive } from './live';
import { shortSpan } from './parts';
import { StatCard, type StatTone } from '../../components/StatCard';

/**
 * The support wallboard on a second display (WS-SUPPORT-SRS-001 D-12; FR-RPT-01/02/03/06, FR-SLA-05/07, FR-ASN-06,
 * FR-NTF-04): the supervisor dashboard (`GET dashboard`, today) full screen on the display chosen, menu-less, in a
 * dark high-contrast theme readable across a room.
 *
 *  - KPIs: open, unassigned, overdue, due today, escalated, median first response today and SLA compliance today,
 *    resolved and CSAT today.
 *  - Queues: the desk's view counts (`GET views`).
 *  - Agents: each with their presence (`GET agents`, Chat's heartbeat) and open load against capacity, at risk and
 *    overdue, resolved today.
 *  - Needs attention: breached, at-risk and escalated tickets with the time to breach — red under 30 min.
 *  - SLA by priority: met against breached, per target.
 *
 * It refreshes on the desk's realtime hints (gathered for a couple of seconds, so a busy desk asks once) and every
 * 60 s whatever happens. Only for people who read the desk's reports (`support.reports`): anybody else is told why.
 * Esc (or Exit) closes it; ⌘⇧F / Ctrl+Shift+F in the inbox opens the display chooser.
 */

export interface Dashboard {
  period: { from: string; to: string };
  now: { open: number; unassigned: number; overdue: number; due_today: number; escalated: number };
  figures: { created: number; resolved: number; frt_median: number | null; resolution_median: number | null; sla_compliance: number | null; csat: number | null; csat_average: number | null; csat_responses: number };
  agents: Array<{ user_id: number; name: string; open: number; overdue: number; at_risk: number; resolved: number; csat: number | null; capacity: number | null; load: number | null }>;
  attention: Array<{ id: number; reference: string; subject: string; status: SupportStatus; priority: SupportPriority; sla_state: string | null; due: string | null; assignee: string | null; organization_id: number | null }>;
  sla_by_priority: Record<string, Record<string, { met: number; breached: number; compliance: number | null }>>;
}

/** The wallboard refreshes at least this often, live or not. */
export const WALL_POLL_MS = 60_000;
/** A burst of desk hints is gathered this long before the board asks again. */
export const WALL_HINT_MS = 2_000;

/** Today, as the server's `from`/`to` take it (this computer's date). */
export function today(now: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}

/** "14m", "2h 5m", "—": business minutes as the wall says them. */
export function minutesLabel(m: number | null | undefined): string {
  if (m === null || m === undefined || !Number.isFinite(m)) return '—';
  return shortSpan(m * 60_000);
}

/** How a ticket's time to breach looks: red under 30 minutes or past, amber under two hours. */
export function breachTone(due: string | null, now: number): 'red' | 'amber' | 'calm' | null {
  if (!due) return null;
  const left = parseTs(due).getTime() - now;
  if (!Number.isFinite(left)) return null;
  return left < 30 * 60_000 ? 'red' : left < 2 * 60 * 60_000 ? 'amber' : 'calm';
}

/** The dashboard, or why there is none: 403 is somebody without the desk's reports, 404/405 a server without them. */
async function dashboard(signal?: AbortSignal): Promise<Dashboard> {
  const d = today(new Date());
  return (await request<Dashboard>('GET', `${SUPPORT_API}/dashboard`, { query: { from: d, to: d }, signal })).data;
}

/** Presence of everyone on the board: each organization's people, asked once a minute (at most eight organizations). */
async function presence(meta: Meta | undefined): Promise<Map<number, Agent>> {
  const orgs = (meta?.organizations ?? []).slice(0, 8);
  const lists = await Promise.all((orgs.length ? orgs.map((o) => o.id) : [null]).map((id) => agentsOf({ organization: id }).catch(() => [] as Agent[])));
  const out = new Map<number, Agent>();
  for (const list of lists) for (const a of list) if (!out.has(a.id)) out.set(a.id, a);
  return out;
}

/** Whether the person may read the desk's reports anywhere (and so see the wallboard). */
export function mayReadReports(meta: Meta | undefined): boolean {
  return !!meta && (meta.can?.reports === true || (meta.organizations ?? []).some((o) => o.can?.reports === true));
}

const PRESENCE_DOT: Record<string, string> = { available: 'bg-[#22C55E]', busy: 'bg-[#F59E0B]', dnd: 'bg-[#EF4444]', away: 'bg-[#A3A3A3]', offline: 'bg-[#525252]' };
const PRESENCE_WORD: Record<string, string> = { available: 'Online', busy: 'Busy', dnd: 'Do not disturb', away: 'Away', offline: 'Offline' };
const TARGETS: SlaTarget[] = ['first_response', 'resolution'];

export function SupportWallWindow() {
  const qc = useQueryClient();
  const live = useRealtimeLive();
  const now = useNow(1_000);
  const metaQ = useQuery({ queryKey: K.meta, queryFn: ({ signal }) => metaOf(signal), staleTime: 5 * 60_000 });
  const dash = useQuery({ queryKey: K.dashboard, queryFn: ({ signal }) => dashboard(signal), refetchInterval: WALL_POLL_MS, retry: false });
  const viewsQ = useQuery({ queryKey: ['support', 'views', 'wall'], queryFn: () => viewsOf(), refetchInterval: WALL_POLL_MS, retry: false });
  const people = useQuery({ queryKey: ['support', 'wall', 'presence'], queryFn: () => presence(metaQ.data), enabled: !!metaQ.data, refetchInterval: WALL_POLL_MS });

  // The desk's hints: asked again once a burst has passed.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const off = on('realtime:event', (e) => {
      const t = (e as { type?: unknown } | null)?.type;
      if (typeof t !== 'string' || !t.startsWith('support.') || timer) return;
      timer = setTimeout(() => {
        timer = null;
        void qc.invalidateQueries({ queryKey: K.dashboard });
        void qc.invalidateQueries({ queryKey: ['support', 'views', 'wall'] });
        if (t === 'support.presence' || t === 'support.changed') void qc.invalidateQueries({ queryKey: ['support', 'wall', 'presence'] });
      }, WALL_HINT_MS);
    });
    return () => {
      off();
      if (timer) clearTimeout(timer);
    };
  }, [qc]);

  // Esc takes the wall down.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') void call('windows:close').catch(() => undefined);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const scope = (metaQ.data?.organizations ?? []).map((o) => o.name);
  const err = dash.error;
  return (
    <main aria-label={text('Support wallboard')} className="flex h-full flex-col gap-4 overflow-hidden bg-[#070B16] p-6 text-[#F8FAFC] select-none">
      <header className="flex items-center gap-4">
        <h1 className="text-[22px] font-extrabold">{text('Support wallboard')}</h1>
        <span className="text-[15px] text-[#CBD5E1]">{scope.length === 1 ? scope[0] : scope.length ? text('{n} organizations', { n: scope.length }) : null}</span>
        <span className={cx('ml-auto flex items-center gap-2 text-[14px] font-semibold', live ? 'text-[#4ADE80]' : 'text-[#FBBF24]')}>
          <span className={cx('h-2.5 w-2.5 rounded-full', live ? 'bg-[#22C55E]' : 'bg-[#F59E0B]')} />
          {live ? text('Live') : text('Every 60 s')}
        </span>
        <span className="font-mono text-[22px] font-bold tabular-nums" aria-label={text('Time')}>
          {now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
        </span>
        <button type="button" onClick={() => void call('windows:close').catch(() => undefined)} className="rounded-[8px] border border-[#334155] px-3 py-1.5 text-[13px] font-semibold text-[#E2E8F0] hover:bg-[#1E293B]">
          {text('Exit (Esc)')}
        </button>
      </header>
      {err instanceof ApiError && err.status === 403 ? (
        <Notice title={text('The wallboard shows the desk’s reports')} body={text('You need permission to read support reports (support.reports) in at least one organization. Ask your administrator for it.')} />
      ) : err instanceof ApiError && (err.status === 404 || err.status === 405) ? (
        <Notice title={text('Your WorkSuite server has no support dashboard yet')} body={text('Ask your administrator to update it.')} />
      ) : err ? (
        <Notice title={text('The dashboard could not be read')} body={err instanceof Error ? err.message : String(err)} />
      ) : !dash.data ? (
        <Spinner className="flex-1 text-[#CBD5E1]" />
      ) : (
        <Board d={dash.data} views={viewsQ.data?.views ?? []} people={people.data ?? new Map()} now={now.getTime()} />
      )}
    </main>
  );
}

function Notice({ title, body }: { title: string; body: string }) {
  return (
    <div role="alert" className="m-auto max-w-[640px] rounded-[16px] border border-[#334155] bg-[#0F172A] p-8 text-center">
      <p className="text-[24px] font-bold">{title}</p>
      <p className="mt-2 text-[16px] text-[#CBD5E1]">{body}</p>
    </div>
  );
}

/** A wallboard figure: the shared StatCard at wallboard size, drawn in the dark theme whatever the app's is. */
function Kpi({ label, value, hint, tone = 'plain', icon }: { label: string; value: string | number; hint?: string; tone?: 'plain' | 'red' | 'amber' | 'green' | StatTone; icon?: string }) {
  return <StatCard size="lg" label={label} value={value} sub={hint} icon={icon} tone={tone === 'plain' ? 'neutral' : tone} />;
}

function Panel({ title, children, className }: { title: string; children: ReactNode; className?: string }) {
  return (
    <section aria-label={title} className={cx('flex min-h-0 flex-col rounded-[14px] border border-[#1E293B] bg-[#0F172A] p-4', className)}>
      <h2 className="mb-2 text-[14px] font-bold tracking-[.6px] text-[#94A3B8] uppercase">{title}</h2>
      {children}
    </section>
  );
}

const QUEUES = ['unassigned', 'overdue', 'escalated', 'pending', 'mine', 'live'];

function Board({ d, views, people, now }: { d: Dashboard; views: ViewCount[]; people: Map<number, Agent>; now: number }) {
  const f = d.figures;
  const sla = f.sla_compliance;
  const queues = QUEUES.map((k) => views.find((v) => v.key === k)).filter((v): v is ViewCount => !!v && v.count !== null);
  const priorities = (['urgent', 'high', 'normal', 'low'] as const).filter((p) => d.sla_by_priority?.[p]);
  return (
    <>
      <div data-theme="dark" className="grid grid-cols-8 gap-3">
        <Kpi icon="ticket" tone="blue" label={text('Open')} value={d.now.open} />
        <Kpi icon="user-x" label={text('Unassigned')} value={d.now.unassigned} tone={d.now.unassigned ? 'amber' : 'plain'} />
        <Kpi icon="alert" label={text('Overdue')} value={d.now.overdue} tone={d.now.overdue ? 'red' : 'plain'} />
        <Kpi icon="calendar-clock" tone="violet" label={text('Due today')} value={d.now.due_today} />
        <Kpi icon="siren" label={text('Escalated')} value={d.now.escalated} tone={d.now.escalated ? 'red' : 'plain'} />
        <Kpi icon="reply" tone="cyan" label={text('First response')} value={minutesLabel(f.frt_median)} hint={text('median today')} />
        <Kpi icon="gauge" label={text('SLA today')} value={sla === null ? '—' : `${sla}%`} tone={sla === null ? 'plain' : sla >= 95 ? 'green' : sla >= 85 ? 'amber' : 'red'} />
        <Kpi icon="check-circle" tone="green" label={text('Resolved today')} value={f.resolved} hint={f.csat !== null ? text('CSAT {n}%', { n: f.csat }) : undefined} />
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-[1fr_1.4fr_1.4fr] gap-3">
        <div className="flex min-h-0 flex-col gap-3">
          <Panel title={text('Queues')}>
            <ul className="flex flex-col gap-1.5 text-[17px]">
              {queues.map((v) => (
                <li key={v.key} className="flex items-center justify-between">
                  <span>{text(v.label)}</span>
                  <b className={cx('tabular-nums', v.key === 'overdue' && v.count ? 'text-[#F87171]' : v.key === 'unassigned' && v.count ? 'text-[#FBBF24]' : '')}>{v.count}</b>
                </li>
              ))}
            </ul>
          </Panel>
          <Panel title={text('SLA by priority')} className="flex-1">
            <ul aria-label={text('SLA by priority')} className="flex flex-col gap-2">
              {priorities.map((p) => (
                <li key={p}>
                  <p className="text-[15px] font-semibold">{text(PRIORITY_LABEL[p])}</p>
                  {TARGETS.map((t) => {
                    const o = d.sla_by_priority[p]?.[t];
                    if (!o) return null;
                    const pct = o.compliance ?? 0;
                    return (
                      <div key={t} className="flex items-center gap-2 text-[13px] text-[#CBD5E1]">
                        <span className="w-[110px] shrink-0">{text(SLA_TARGET_LABEL[t])}</span>
                        <span className="h-3 flex-1 overflow-hidden rounded-full bg-[#1E293B]" role="meter" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={`${PRIORITY_LABEL[p]} ${SLA_TARGET_LABEL[t]}`}>
                          <span className={cx('block h-full', pct >= 95 ? 'bg-[#22C55E]' : pct >= 85 ? 'bg-[#F59E0B]' : 'bg-[#EF4444]')} style={{ width: `${Math.max(0, Math.min(100, pct))}%` }} />
                        </span>
                        <span className="w-[48px] text-right tabular-nums">{o.compliance === null ? '—' : `${o.compliance}%`}</span>
                      </div>
                    );
                  })}
                </li>
              ))}
              {!priorities.length ? <li className="text-[14px] text-[#94A3B8]">{text('No SLA targets met or missed today.')}</li> : null}
            </ul>
          </Panel>
        </div>
        <Panel title={text('Agents')}>
          <ul aria-label={text('Agents')} className="flex min-h-0 flex-col gap-2 overflow-hidden">
            {d.agents.map((a) => {
              const p = people.get(a.user_id)?.presence ?? 'offline';
              const load = a.capacity ? Math.min(100, Math.round((a.open / a.capacity) * 100)) : null;
              return (
                <li key={a.user_id} className="flex items-center gap-3">
                  <span className={cx('h-3 w-3 shrink-0 rounded-full', PRESENCE_DOT[p] ?? PRESENCE_DOT.offline)} role="img" aria-label={text(PRESENCE_WORD[p] ?? p)} title={text(PRESENCE_WORD[p] ?? p)} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[17px] font-semibold">{a.name}</span>
                    <span className="block text-[13px] text-[#94A3B8]">
                      {[text(PRESENCE_WORD[p] ?? p), a.at_risk ? text('{n} at risk', { n: a.at_risk }) : null, a.overdue ? text('{n} overdue', { n: a.overdue }) : null, text('{n} resolved', { n: a.resolved })].filter(Boolean).join(' · ')}
                    </span>
                  </span>
                  <span className="w-[120px] shrink-0">
                    <span className="block text-right text-[17px] font-bold tabular-nums">{a.capacity ? `${a.open} / ${a.capacity}` : a.open}</span>
                    {load !== null ? (
                      <span className="mt-1 block h-1.5 overflow-hidden rounded-full bg-[#1E293B]">
                        <span className={cx('block h-full', load >= 100 ? 'bg-[#EF4444]' : load >= 80 ? 'bg-[#F59E0B]' : 'bg-[#3B82F6]')} style={{ width: `${load}%` }} />
                      </span>
                    ) : null}
                  </span>
                </li>
              );
            })}
            {!d.agents.length ? <li className="text-[14px] text-[#94A3B8]">{text('Nobody has open tickets.')}</li> : null}
          </ul>
        </Panel>
        <Panel title={text('Needs attention')}>
          <ul aria-label={text('Needs attention')} className="flex min-h-0 flex-col gap-2 overflow-hidden">
            {d.attention.map((t) => {
              const tone = breachTone(t.due, now);
              const left = t.due ? parseTs(t.due).getTime() - now : null;
              return (
                <li key={t.id} className="flex items-center gap-3 border-b border-[#1E293B] pb-2 last:border-b-0">
                  <span className="min-w-0 flex-1">
                    <span className="block text-[13px] text-[#94A3B8]">
                      <span className="font-mono">{t.reference}</span> · {t.assignee ?? text('Unassigned')} · {text(statusLabel(t.status))}
                    </span>
                    <span className="block truncate text-[17px] font-semibold">{t.subject}</span>
                  </span>
                  {t.priority === 'urgent' || t.priority === 'high' ? <span className={cx('shrink-0 rounded-[6px] px-2 py-0.5 text-[12px] font-bold', t.priority === 'urgent' ? 'bg-[#DC2626] text-white' : 'bg-[#7C2D12] text-[#FDBA74]')}>{text(PRIORITY_LABEL[t.priority])}</span> : null}
                  <span className={cx('w-[96px] shrink-0 text-right font-mono text-[20px] font-bold tabular-nums', tone === 'red' ? 'text-[#F87171]' : tone === 'amber' ? 'text-[#FBBF24]' : 'text-[#E2E8F0]')}>
                    {left === null || !Number.isFinite(left) ? (t.sla_state === 'breached' ? text('Breached') : '—') : left < 0 ? `−${shortSpan(left)}` : shortSpan(left)}
                  </span>
                </li>
              );
            })}
            {!d.attention.length ? <li className="text-[16px] text-[#4ADE80]">{text('Nothing at risk.')}</li> : null}
          </ul>
        </Panel>
      </div>
    </>
  );
}

/* ── opening it (from the inbox) ─────────────────────────────────────────── */

/** The display chooser (⌘⇧F / Ctrl+Shift+F in the inbox): which screen the wallboard goes full screen on. */
export function WallboardChooser({ onClose }: { onClose: () => void }) {
  const [info, setInfo] = useState<{ displays: WallDisplay[]; open: boolean } | null>(null);
  const [picked, setPicked] = useState<number | null>(null);
  useEffect(() => {
    call('support:displays').then(
      (r) => {
        setInfo(r);
        setPicked(r.displays[1]?.id ?? r.displays[0]?.id ?? null);
      },
      () => setInfo({ displays: [], open: false }),
    );
  }, []);
  const open = () => {
    void call('support:wall', { displayId: picked }).catch(() => undefined);
    onClose();
  };
  return (
    <Modal
      title={text('Wallboard')}
      labelledBy="support-wall-title"
      onClose={onClose}
      width={460}
      footer={
        <>
          {info?.open ? (
            <Button className="mr-auto" onClick={() => (void call('support:wallClose').catch(() => undefined), onClose())}>
              {text('Close the wallboard')}
            </Button>
          ) : null}
          <Button onClick={onClose}>{text('Cancel')}</Button>
          <Button variant="primary" icon="tv" disabled={!info} onClick={open}>
            {text('Show')}
          </Button>
        </>
      }
    >
      <p className="mb-2 text-[12.5px] text-ink-3">{text('The desk’s dashboard, full screen and live, on the display you choose. Esc on it closes it.')}</p>
      {!info ? (
        <Spinner />
      ) : (
        <div role="radiogroup" aria-label={text('Show on')} className="flex flex-wrap gap-2">
          {info.displays.map((d) => (
            <button key={d.id} type="button" role="radio" aria-checked={picked === d.id} onClick={() => setPicked(d.id)} className={cx('min-w-[140px] flex-1 rounded-[10px] px-2.5 py-2 text-left text-[12px]', picked === d.id ? 'border-2 border-primary bg-selection' : 'border border-line hover:bg-subtle')}>
              <span className={cx('block font-semibold', picked === d.id ? 'text-primary' : 'text-ink')}>{d.display}</span>
              <span className="block truncate text-ink-3">{d.detail}</span>
            </button>
          ))}
        </div>
      )}
      <p className="mt-2 text-[11.5px] text-ink-3">{isMac ? '⌘⇧F' : 'Ctrl+Shift+F'}</p>
    </Modal>
  );
}
