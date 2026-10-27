import { useMemo, useState } from 'react';
import { toast } from '../../../core/toasts';
import { Icon } from '../../../components/Icon';
import { Button, cx, Empty, Modal, Spinner } from '../../../components/ui';
import { isNotOffered, NOT_OFFERED, phoneApi, useBoard, useExtensions, useLive, useQueueReport, useServers, useSummary, type AgentState, type Board, type Channel, type Extension, type LiveServer, type ReportQueue, type SuperviseMode } from '../api';
import { usePhoneAccess } from '../access';
import { clock, isoDay, prettyNumber } from '../lib/format';
import { Kpi, Mono, PageBody, PageHeader, Panel, Refused } from '../parts';
import { StatGrid } from '../../../components/StatCard';

/**
 * A01 · Live board (VOIP-RPT-04/05/06, WF-14). Queues, waiting callers, the longest wait, agents by state and the
 * calls in progress across every switch, refreshed every two seconds. Listen, whisper and barge need voip.supervise
 * and are written to the audit log (NFR-09); a supervisor can pause an agent with a reason.
 *
 * On a server without the supervisor board (`GET /api/voip/supervisor/board`), the board is built from what the
 * server already answers: the switch's live channels, today's queue figures with their live depth, and each
 * extension's presence — and says so.
 */
export default function LiveBoard() {
  const access = usePhoneAccess();
  const servers = useServers(access.manage);
  const [server, setServer] = useState<number | null>(null);
  const [wall, setWall] = useState(false);
  const board = useBoard(server);
  const offered = board.data?.offered ?? null;
  return (
    <div className={cx('flex h-full min-h-0 flex-col', wall && 'fixed inset-0 z-50 bg-ground')}>
      <PageHeader
        title="Live board"
        sub={
          <span className="inline-flex items-center gap-1.5 text-success">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-success" />
            Live · updates every 2 s
          </span>
        }
        actions={
          <>
            {servers.data && servers.data.servers.length > 1 ? (
              <label className="flex items-center gap-1.5 text-[12.5px] text-ink-3">
                Server
                <select aria-label="Server" value={server ?? ''} onChange={(e) => setServer(e.target.value ? Number(e.target.value) : null)} className="h-8 rounded-[8px] border border-line bg-surface px-2 text-[12.5px] text-ink">
                  <option value="">All PBX ({servers.data.servers.length})</option>
                  {servers.data.servers.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            <Button icon={wall ? 'fullscreen-exit' : 'tv'} onClick={() => setWall(!wall)}>
              {wall ? 'Leave wallboard' : 'Wallboard mode'}
            </Button>
          </>
        }
      />
      <PageBody>
        {board.isLoading ? <Spinner /> : board.error ? <Refused error={board.error} onRetry={() => void board.refetch()} /> : offered === false ? <Derived wall={wall} /> : board.data?.offered ? <BoardView b={board.data.data} wall={wall} canSupervise={access.supervise} /> : null}
      </PageBody>
    </div>
  );
}

const STATE: Record<AgentState, { label: string; dot: string; card: string }> = {
  free: { label: 'Free', dot: 'bg-success', card: 'border-success/25 bg-success-bg' },
  on_call: { label: 'On call', dot: 'bg-danger', card: 'border-danger/25 bg-danger-bg' },
  ringing: { label: 'Ringing', dot: 'bg-warning', card: 'border-warning/30 bg-warning-bg' },
  wrapup: { label: 'Wrap-up', dot: 'bg-primary', card: 'border-primary/25 bg-selection' },
  paused: { label: 'Paused', dot: 'bg-ink-3', card: 'border-line bg-subtle' },
  offline: { label: 'Offline', dot: 'bg-ink-3/40', card: 'border-line bg-surface' },
};

function BoardView({ b, wall, canSupervise }: { b: Board; wall: boolean; canSupervise: boolean }) {
  const t = b.totals;
  return (
    <div className="flex flex-col gap-4">
      <StatGrid min={wall ? 200 : 180}>
        <Kpi icon="phone-call" tone="blue" label="Calls now" value={t.calls_now} sub={`${t.external} external · ${t.internal} internal`} />
        <Kpi icon="hourglass" label="Waiting" value={t.waiting} tone={t.waiting ? 'warning' : undefined} sub={`across ${b.queues.length} queues`} />
        <Kpi icon="timer" label="Longest wait" value={clock(t.longest_wait)} tone={t.longest_wait > 60 ? 'danger' : undefined} />
        <Kpi icon="headphones" tone="green" label="Agents free" value={`${t.agents_free} / ${t.agents_total}`} sub={`${t.agents_paused} paused`} />
        <Kpi icon="phone-incoming" label="Answered today" value={t.answered_today} tone="success" sub={t.answer_rate !== null ? `${t.answer_rate}% answer rate` : undefined} />
        <Kpi icon="phone-missed" label="Abandoned" value={t.abandoned_today} sub={t.avg_abandon_wait !== null ? `avg ${clock(t.avg_abandon_wait)} before hang-up` : undefined} />
      </StatGrid>
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="flex flex-col gap-4">
          <Panel title="Queues now">
            {b.queues.length ? (
              <div className="flex flex-col">
                {b.queues.map((q) => (
                  <QueueRow key={q.id} name={`${q.name} · ${q.number}`} sub={`${q.strategy} · ${q.agents} agents`} waiting={q.waiting} longest={q.longest_wait} free={q.free} logged={q.logged_in} sla={q.sla_rate} slaSeconds={q.sla_seconds} />
                ))}
              </div>
            ) : (
              <Empty icon="users" title="No queues" />
            )}
          </Panel>
          <Panel title={`Calls in progress · ${b.calls.length}`}>
            {b.calls.length ? (
              <ul className="flex flex-col">
                {b.calls.map((c) => (
                  <CallRow key={c.channel} channel={c.channel} seconds={c.started_seconds} who={c.agent ? `${c.agent}${c.extension ? ` (${c.extension})` : ''}` : (c.extension ?? '—')} other={c.other} queue={c.queue ?? c.direction} canSupervise={canSupervise} />
                ))}
              </ul>
            ) : (
              <Empty icon="phone" title="No calls right now" />
            )}
          </Panel>
        </div>
        <Panel
          title="Agents"
          action={
            <span className="flex flex-wrap gap-2 text-[11px] text-ink-3">
              {(['free', 'on_call', 'ringing', 'wrapup', 'paused'] as AgentState[]).map((s) => (
                <span key={s} className="flex items-center gap-1">
                  <span className={cx('h-2 w-2 rounded-full', STATE[s].dot)} />
                  {STATE[s].label}
                </span>
              ))}
            </span>
          }
        >
          <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
            {b.agents.map((a) => (
              <AgentCard key={a.extension_id} extensionId={a.extension_id} name={a.name} extension={a.extension} state={a.state} detail={`${STATE[a.state].label}${a.since_seconds ? ` · ${clock(a.since_seconds)}` : ''}${a.detail ? ` · ${a.detail}` : ''}`} canPause={canSupervise} />
            ))}
          </div>
          <SupervisionNote />
        </Panel>
      </div>
    </div>
  );
}

function QueueRow({ name, sub, waiting, longest, free, logged, sla, slaSeconds }: { name: string; sub: string; waiting: number; longest: number; free: number | null; logged: number | null; sla: number | null; slaSeconds: number }) {
  return (
    <div className="grid grid-cols-[minmax(0,1.4fr)_60px_70px_70px_minmax(0,1fr)] items-center gap-3 border-b border-line py-2.5 text-[12.5px] last:border-b-0">
      <span className="min-w-0">
        <b className="block truncate">{name}</b>
        <span className="block truncate text-[11px] text-ink-3">{sub}</span>
      </span>
      <span>
        <Mono className={cx('block text-[16px] font-bold', waiting ? 'text-warning' : 'text-ink')}>{waiting}</Mono>
        <span className="text-[10.5px] text-ink-3">waiting</span>
      </span>
      <span>
        <Mono className={cx('block text-[16px] font-bold', longest > 60 ? 'text-danger' : 'text-ink')}>{longest ? clock(longest) : '—'}</Mono>
        <span className="text-[10.5px] text-ink-3">longest</span>
      </span>
      <span>
        <Mono className="block text-[16px] font-bold">{free === null || logged === null ? '—' : `${free} / ${logged}`}</Mono>
        <span className="text-[10.5px] text-ink-3">free / in</span>
      </span>
      <span className="min-w-0">
        {sla === null ? (
          <span className="text-[11px] text-ink-3">SLA not measured</span>
        ) : (
          <>
            <span className="block h-1.5 overflow-hidden rounded-full bg-subtle">
              <span className={cx('block h-full rounded-full', sla >= 80 ? 'bg-success' : sla >= 60 ? 'bg-warning' : 'bg-danger')} style={{ width: `${Math.min(100, sla)}%` }} />
            </span>
            <span className="text-[10.5px] text-ink-3">
              SLA {sla}% answered ≤ {slaSeconds} s
            </span>
          </>
        )}
      </span>
    </div>
  );
}

function CallRow({ channel, seconds, who, other, queue, canSupervise }: { channel: string; seconds: number; who: string; other: string; queue: string | null; canSupervise: boolean }) {
  const [busy, setBusy] = useState<SuperviseMode | null>(null);
  const go = async (mode: SuperviseMode) => {
    setBusy(mode);
    try {
      const r = await phoneApi.supervise(channel, mode);
      toast(r.ok ? 'success' : 'error', r.message || (r.ok ? `${mode} started — your phone rings.` : 'The switch refused.'));
    } catch (e) {
      toast(isNotOffered(e) ? 'info' : 'error', isNotOffered(e) ? NOT_OFFERED : (e as Error).message);
    } finally {
      setBusy(null);
    }
  };
  return (
    <li className="flex items-center gap-3 border-b border-line py-2 text-[12.5px] last:border-b-0">
      <Mono className="w-12 shrink-0 text-ink-2">{clock(seconds)}</Mono>
      <span className="min-w-0 flex-1 truncate">
        <b>{who}</b> ↔ {prettyNumber(other) || other || '—'}
      </span>
      <span className="w-20 shrink-0 truncate text-[11.5px] text-ink-3">{queue ?? ''}</span>
      {canSupervise ? (
        <span className="flex shrink-0 gap-1">
          <Button size="sm" loading={busy === 'listen'} onClick={() => void go('listen')}>
            Listen
          </Button>
          <Button size="sm" loading={busy === 'whisper'} onClick={() => void go('whisper')}>
            Whisper
          </Button>
          <Button size="sm" variant="danger" loading={busy === 'barge'} onClick={() => void go('barge')}>
            Barge
          </Button>
        </span>
      ) : null}
    </li>
  );
}

function AgentCard({ extensionId, name, extension, state, detail, canPause }: { extensionId: number; name: string; extension: string; state: AgentState; detail: string; canPause: boolean }) {
  const [asking, setAsking] = useState(false);
  const [reason, setReason] = useState('Training');
  const set = async (paused: boolean) => {
    setAsking(false);
    try {
      const r = await phoneApi.pauseAgent(null, extensionId, paused, paused ? reason.trim() || undefined : undefined);
      toast(r.ok ? 'success' : 'error', r.message ?? (paused ? `${name} paused in every queue.` : `${name} is back in their queues.`));
    } catch (e) {
      toast(isNotOffered(e) ? 'info' : 'error', isNotOffered(e) ? NOT_OFFERED : (e as Error).message);
    }
  };
  return (
    <div className={cx('flex flex-col gap-0.5 rounded-[10px] border px-2.5 py-2', STATE[state].card)}>
      <div className="flex items-center gap-1.5 text-[12.5px]">
        <span className={cx('h-2 w-2 shrink-0 rounded-full', STATE[state].dot)} />
        <b className="min-w-0 flex-1 truncate">{name}</b>
        <Mono className="text-[11px] text-ink-3">{extension}</Mono>
      </div>
      <span className="truncate text-[11px] text-ink-2">{detail}</span>
      {canPause && state !== 'offline' ? (
        <button type="button" className="mt-0.5 w-fit text-[11px] font-semibold text-primary" onClick={() => (state === 'paused' ? void set(false) : setAsking(true))}>
          {state === 'paused' ? 'Unpause' : 'Pause'}
        </button>
      ) : null}
      {asking ? (
        <Modal
          title={`Pause ${name}`}
          width={400}
          onClose={() => setAsking(false)}
          footer={
            <>
              <Button onClick={() => setAsking(false)}>Cancel</Button>
              <Button variant="primary" onClick={() => void set(true)}>
                Pause in every queue
              </Button>
            </>
          }
        >
          <label className="flex flex-col gap-1 text-[12.5px]">
            <span className="font-semibold text-ink-2">Reason (shown in reports)</span>
            <input value={reason} onChange={(e) => setReason(e.target.value)} autoFocus aria-label="Reason" className="h-9 rounded-[8px] border border-line bg-surface px-3 text-[13px] outline-none focus:border-primary" />
          </label>
        </Modal>
      ) : null}
    </div>
  );
}

function SupervisionNote() {
  return (
    <p className="mt-3 flex items-start gap-1.5 rounded-[8px] bg-subtle px-3 py-2 text-[11.5px] text-ink-3">
      <Icon name="info" size={13} className="mt-px shrink-0" />
      Listen, whisper and barge need the voip.supervise permission and are logged in the audit trail. Agents see a banner when a supervisor is listening if your policy requires it.
    </p>
  );
}

/* ------------------------------------------------------------------------ *
 * Without the supervisor board: what the server already answers
 * ------------------------------------------------------------------------ */

/** Calls in progress from the switch's channels: one per linked call, the WorkSuite side named. */
export function callsFromChannels(servers: LiveServer[], exts: Extension[]): Array<{ channel: string; seconds: number; who: string; other: string; internal: boolean; extension: string | null }> {
  const byExt = new Map(exts.map((e) => [e.extension, e]));
  const groups = new Map<string, Channel[]>();
  for (const s of servers) for (const c of s.channels) {
    const key = c.linkedid || c.uniqueid || c.channel;
    groups.set(key, [...(groups.get(key) ?? []), c]);
  }
  const out: Array<{ channel: string; seconds: number; who: string; other: string; internal: boolean; extension: string | null }> = [];
  for (const chans of groups.values()) {
    const ours = chans.find((c) => /^PJSIP\/(\d{2,8})-/.test(c.channel)) ?? chans[0]!;
    const ext = /^PJSIP\/(\d{2,8})-/.exec(ours.channel)?.[1] ?? null;
    const e = ext ? byExt.get(ext) : undefined;
    const internalOther = chans.filter((c) => c !== ours).some((c) => /^PJSIP\/(\d{2,8})-/.test(c.channel) && byExt.has(/^PJSIP\/(\d{2,8})-/.exec(c.channel)?.[1] ?? ''));
    const other = ours.connected && ours.connected !== ext ? ours.connected : ours.caller && ours.caller !== ext ? ours.caller : (chans.find((c) => c !== ours)?.caller ?? '');
    out.push({ channel: ours.channel, seconds: Math.max(...chans.map((c) => c.duration || 0)), who: e ? `${e.user_name ?? e.name}${ext ? ` (${ext})` : ''}` : (ext ?? ours.caller_name ?? ours.caller), other, internal: internalOther, extension: ext });
  }
  return out.sort((a, b) => b.seconds - a.seconds);
}

/** An agent's state from presence and whether a channel is up on their extension. */
export function agentState(e: Extension, talking: Set<string>): AgentState {
  if (talking.has(e.extension)) return 'on_call';
  if (e.presence === 'offline') return 'offline';
  if (e.presence === 'dnd' || e.presence === 'away' || e.presence === 'in_meeting') return 'paused';
  if (e.presence === 'busy') return 'on_call';
  return 'free';
}

function Derived({ wall }: { wall: boolean }) {
  const access = usePhoneAccess();
  const live = useLive(true);
  const exts = useExtensions();
  const today = isoDay(new Date());
  const range = useMemo(() => ({ from: today, to: today }), [today]);
  const summary = useSummary(range, access.reports);
  const queues = useQueueReport(range, access.reports);
  if (live.isLoading || exts.isLoading) return <Spinner />;
  if (live.error) return <Refused error={live.error} onRetry={() => void live.refetch()} />;
  const servers = live.data ?? [];
  const calls = callsFromChannels(servers, exts.data ?? []);
  const talking = new Set(calls.map((c) => c.extension).filter((x): x is string => !!x));
  const agents = (exts.data ?? []).filter((e) => e.enabled && e.user_id !== null);
  const states = agents.map((e) => ({ e, s: agentState(e, talking) }));
  const q: ReportQueue[] = queues.data ?? [];
  const waiting = q.reduce((s, x) => s + (x.live?.waiting ?? 0), 0);
  const longest = Math.max(0, ...q.map((x) => x.live?.holdtime ?? 0));
  const down = servers.filter((s) => !s.ok);
  const t = summary.data?.totals;
  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-[10px] border border-line bg-surface px-3.5 py-2 text-[12px] text-ink-3">
        {NOT_OFFERED} This board is built from the switch’s live channels, today’s queue figures and each extension’s presence; listen, whisper, barge and pausing agents need the newer server.
      </div>
      {down.length ? (
        <div className="rounded-[10px] border border-warning/30 bg-warning-bg px-3.5 py-2 text-[12.5px] text-warning-ink dark:text-warning">
          {down.map((s) => `${s.server}: ${s.message ?? 'not reachable'}`).join(' · ')}
        </div>
      ) : null}
      <StatGrid min={wall ? 200 : 180}>
        <Kpi icon="phone-call" tone="blue" label="Calls now" value={calls.length} sub={`${calls.filter((c) => !c.internal).length} external · ${calls.filter((c) => c.internal).length} internal`} />
        <Kpi icon="hourglass" label="Waiting" value={q.length ? waiting : null} tone={waiting ? 'warning' : undefined} sub={q.length ? `across ${q.length} queues` : undefined} />
        <Kpi icon="timer" tone="violet" label="Longest wait" value={q.length ? clock(longest) : null} />
        <Kpi icon="headphones" tone="green" label="Agents free" value={`${states.filter((x) => x.s === 'free').length} / ${agents.length}`} sub={`${states.filter((x) => x.s === 'paused').length} away or DND`} />
        <Kpi icon="phone-incoming" label="Answered today" value={t ? t.answered : null} tone="success" sub={t?.answer_rate !== null && t?.answer_rate !== undefined ? `${t.answer_rate}% answer rate` : undefined} />
        <Kpi icon="phone-missed" label="Unanswered today" value={t ? t.unanswered : null} />
      </StatGrid>
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <div className="flex flex-col gap-4">
          <Panel title="Queues now">
            {q.length ? (
              q.map((x) => <QueueRow key={x.number} name={`${x.name} · ${x.number}`} sub={`${x.calls} calls today`} waiting={x.live?.waiting ?? 0} longest={x.live?.holdtime ?? 0} free={null} logged={x.live?.members ?? null} sla={x.sla_rate} slaSeconds={x.sla_seconds} />)
            ) : (
              <Empty icon="users" title="No queue figures" hint={access.reports ? 'No queues have taken calls today.' : 'Queue figures need voip.reports.'} />
            )}
          </Panel>
          <Panel title={`Calls in progress · ${calls.length}`}>
            {calls.length ? (
              <ul>
                {calls.map((c) => (
                  <CallRow key={c.channel} channel={c.channel} seconds={c.seconds} who={c.who} other={c.other} queue={c.internal ? 'internal' : null} canSupervise={access.supervise} />
                ))}
              </ul>
            ) : (
              <Empty icon="phone" title="No calls right now" />
            )}
          </Panel>
        </div>
        <Panel title="Agents">
          <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
            {states.map(({ e, s }) => (
              <AgentCard key={e.id} extensionId={e.id} name={e.user_name ?? e.name} extension={e.extension} state={s} detail={STATE[s].label} canPause={access.supervise} />
            ))}
          </div>
          <SupervisionNote />
        </Panel>
      </div>
    </div>
  );
}
