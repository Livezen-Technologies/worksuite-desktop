import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useId, useState } from 'react';
import { useTab } from '../../../core/tab-context';
import { Avatar, Button, cx, Empty, IconButton, Modal } from '../../../components/ui';
import { fetchCallCampaign, fetchCallLive, MK, setCallCampaignState, type CallAgent, type CallCampaign as Campaign } from '../api';
import type { Tone } from '../lib/consent';
import { clock, count, plural, share } from '../lib/format';
import { OUTCOMES } from '../lib/outcomes';
import { useMarketingOrg } from '../org';
import { Kpi, Loaded, Mono, Notice, PageBody, PageHeader, Panel, Row, Status, TD, TH, Table, useAction } from '../parts';
import { audienceLabel, callStatus, THR } from './CallCampaigns';

/**
 * DK10 · Call campaign, the supervisor's view (W10, PDF p46; MKT-CAL-01..08, MKT-CAL-15; AC-09, AC-12). What is in
 * the queue and claimed now (an idle claim goes back after 20 minutes), who was reached and who was interested
 * (handed to CRM), callbacks due as Tasks; the agents with their state and results (MKT-CAL-08), live from the
 * server's board every 10 s while the tab is in front (MKT-CAL-15, Target — without it, the campaign's own figures);
 * the ten outcomes; and the rules the queue was built with. Contacts held back for want of phone consent are counted
 * and explained (MKT-CON-03, AC-12). Start, pause, resume and finish follow the campaign's state.
 */
export default function CallCampaign({ id }: { id: number }) {
  const org = useMarketingOrg();
  const { go, active } = useTab();
  const q = useQuery({
    queryKey: MK.callCampaign(org, id),
    queryFn: ({ signal }) => fetchCallCampaign(id, signal),
    refetchInterval: (query) => (active && query.state.data?.status === 'running' ? 30_000 : false),
  });
  const c = q.data;
  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader
        crumb="Marketing / Call campaigns"
        title={c?.name ?? 'Call campaign'}
        sub={c ? subOf(c) : undefined}
        back={<IconButton icon="back" label="Call campaigns" onClick={() => go('/marketing/calls')} />}
        actions={c ? <Actions c={c} /> : null}
      />
      <PageBody>
        <Loaded q={q} what="This call campaign">
          {(campaign) => <Board c={campaign} />}
        </Loaded>
      </PageBody>
    </div>
  );
}

/** "Call campaign · running · 1,006 contacts · retries 3 × every 24 h". */
export function subOf(c: Campaign): string {
  const parts = [`Call campaign · ${callStatus(c.status).label.toLowerCase()}`, plural(c.contacts_count ?? 0, 'contact')];
  if (c.retries) parts.push(`retries ${c.retries.max_attempts} × every ${c.retries.delay_hours} h`);
  return parts.join(' · ');
}

/** "On call", "Wrap-up", "Idle 12 min", "Offline" (design DK10). */
export function agentStatus(a: Pick<CallAgent, 'status' | 'idle_minutes'>): { label: string; tone: Tone } {
  switch (a.status) {
    case 'on_call':
      return { label: 'On call', tone: 'success' };
    case 'wrap_up':
      return { label: 'Wrap-up', tone: 'indigo' };
    case 'idle':
      return typeof a.idle_minutes === 'number' ? { label: `Idle ${Math.round(a.idle_minutes)} min`, tone: 'warning' } : { label: 'Idle', tone: 'warning' };
    default:
      return { label: 'Offline', tone: 'muted' };
  }
}

/** "09:00–17:00 contact local". */
export function hoursLabel(h: Campaign['hours'] | null | undefined): string {
  if (!h) return '—';
  return `${h.from.slice(0, 5)}–${h.to.slice(0, 5)} ${h.contact_local ? 'contact local' : 'company time'}`;
}

type Move = 'start' | 'pause' | 'resume' | 'finish';

const DONE: Record<Move, string> = {
  start: 'Started. The queue is built and agents can claim from it.',
  pause: 'Paused. Nobody can claim until it resumes.',
  resume: 'Resumed. Agents can claim again.',
  finish: 'Finished. The queue is closed.',
};

function Actions({ c }: { c: Campaign }) {
  const org = useMarketingOrg();
  const qc = useQueryClient();
  const { go } = useTab();
  const [busy, run] = useAction();
  const [finishing, setFinishing] = useState(false);
  const titleId = useId();
  const script = c.script;
  const move = (to: Move) =>
    run(
      to,
      async () => {
        const next = await setCallCampaignState(c.id, to);
        qc.setQueryData<Campaign>(MK.callCampaign(org, c.id), (old) => (old ? { ...old, ...next } : old));
        void qc.invalidateQueries({ queryKey: MK.callCampaign(org, c.id) });
        void qc.invalidateQueries({ queryKey: MK.callCampaigns(org) });
        void qc.invalidateQueries({ queryKey: MK.queue(org) });
        void qc.invalidateQueries({ queryKey: MK.dashboard(org) });
      },
      DONE[to],
    );
  return (
    <>
      {script ? (
        <Button icon="file-text" onClick={() => go(`/marketing/scripts/${script.id}`)}>
          Edit script
        </Button>
      ) : null}
      <Button icon="users" onClick={() => go(`/marketing/calls/${c.id}/edit`)}>
        Agents
      </Button>
      {c.status === 'draft' ? (
        <Button variant="primary" icon="play" loading={busy === 'start'} disabled={busy !== null} onClick={() => void move('start')}>
          Start
        </Button>
      ) : null}
      {c.status === 'running' ? (
        <Button icon="pause" loading={busy === 'pause'} disabled={busy !== null} onClick={() => void move('pause')}>
          Pause
        </Button>
      ) : null}
      {c.status === 'paused' ? (
        <Button variant="primary" icon="play" loading={busy === 'resume'} disabled={busy !== null} onClick={() => void move('resume')}>
          Resume
        </Button>
      ) : null}
      {c.status === 'running' || c.status === 'paused' ? (
        <Button icon="stop" disabled={busy !== null} onClick={() => setFinishing(true)}>
          Finish
        </Button>
      ) : null}
      {finishing ? (
        <Modal
          title="Finish this call campaign?"
          labelledBy={titleId}
          width={440}
          onClose={() => setFinishing(false)}
          footer={
            <>
              <Button onClick={() => setFinishing(false)}>Cancel</Button>
              <Button variant="danger" loading={busy === 'finish'} onClick={() => void move('finish').then((ok) => ok && setFinishing(false))}>
                Finish campaign
              </Button>
            </>
          }
        >
          <p className="text-[13px] text-ink-2">
            {`Its queue closes: nobody can claim from it again, and the ${plural(c.in_queue ?? 0, 'contact')} still waiting won’t be called. Its results stay.`}
          </p>
        </Modal>
      ) : null}
    </>
  );
}

function Board({ c }: { c: Campaign }) {
  const org = useMarketingOrg();
  const { go, active } = useTab();
  const watching = c.status === 'running' || c.status === 'paused';
  const live = useQuery({
    queryKey: [...MK.callCampaign(org, c.id), 'live'],
    queryFn: ({ signal }) => fetchCallLive(c.id, signal),
    refetchInterval: (query) => (active && watching && query.state.data?.offered !== false ? 10_000 : false),
  });
  const board = live.data?.offered ? live.data.data : null;
  const agents = board?.agents ?? c.agents ?? [];
  const inQueue = board?.in_queue ?? c.in_queue;
  const claimed = board?.claimed_now ?? c.claimed_now;
  const release = c.claim_release_minutes || 20;
  const nobody = !agents.some((a) => a.can_call);

  const liveNote = board ? (
    watching ? (
      <span className="inline-flex items-center gap-1.5 text-success">
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-success" />
        Live · updates every 10 s
      </span>
    ) : (
      'From the live board'
    )
  ) : live.data?.offered === false ? (
    'Live status needs a newer Marketing module on the server'
  ) : live.error ? (
    'Live status could not be read; these are the campaign’s own figures.'
  ) : undefined;

  return (
    <div className="flex flex-col gap-4">
      {c.status === 'draft' ? (
        <Notice>Draft. Starting builds the queue from the audience: contacts without the consent the company requires, and do-not-call numbers, are left out and counted here.</Notice>
      ) : null}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        <Kpi label="In queue" value={count(inQueue)} />
        <Kpi label="Claimed now" value={count(claimed)} sub={`Released after ${release} min idle`} subTone="warning" />
        <Kpi label="Reached" value={count(c.reached)} sub={c.contacts_count ? `${share(c.reached, c.contacts_count)} of contacts` : undefined} />
        <Kpi label="Interested" value={count(c.interested)} sub="Handed to CRM" subTone="success" />
        <Kpi label="Callbacks due" value={count(c.callbacks_due)} sub="Created as Tasks" />
      </div>
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="flex min-w-0 flex-col gap-4">
          <Panel title="Agents" sub={liveNote}>
            {agents.length === 0 ? (
              <Empty
                icon="users"
                title="No agents assigned"
                hint="Assign people who hold marketing.call.make. Only they can claim from this queue."
                action={
                  <Button size="sm" icon="users" className="mt-1" onClick={() => go(`/marketing/calls/${c.id}/edit`)}>
                    Assign agents
                  </Button>
                }
              />
            ) : (
              <div className="flex flex-col gap-3">
                {nobody ? (
                  <Notice tone="warning">Nobody assigned holds marketing.call.make, so nobody can claim from this queue. Grant it to the call-agent role in Roles & permissions.</Notice>
                ) : null}
                <Table
                  label="Agents"
                  head={
                    <tr>
                      <th className={TH}>Agent</th>
                      <th className={TH}>Status</th>
                      <th className={THR}>Calls today</th>
                      <th className={THR}>Reached</th>
                      <th className={THR}>Interested</th>
                      <th className={THR}>Avg. talk</th>
                    </tr>
                  }
                >
                  {agents.map((a) => (
                    <AgentRow key={a.user_id} a={a} />
                  ))}
                </Table>
              </div>
            )}
          </Panel>
          <Panel title={`Outcomes · ${OUTCOMES.length} types`}>
            <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
              {OUTCOMES.map((o) => (
                <li key={o.id} className="flex min-w-0 flex-col gap-0.5 rounded-[10px] border border-line px-3 py-2">
                  <span className="truncate text-[11.5px] text-ink-3">{o.label}</span>
                  <Mono className="text-[18px] font-bold text-ink">{count(c.outcomes?.[o.id] ?? 0)}</Mono>
                </li>
              ))}
            </ul>
          </Panel>
        </div>
        <div className="flex min-w-0 flex-col gap-4">
          <Panel title="Rules">
            <Row label="Audience">{audienceLabel(c.audience)}</Row>
            <Row label="Requires phone consent">{c.requires_phone_consent ? 'Yes (setting)' : 'No (setting)'}</Row>
            <Row label="Excluded · no consent">
              <Mono>{count(c.excluded_no_consent ?? 0)}</Mono>
            </Row>
            {typeof c.excluded_dnc === 'number' ? (
              <Row label="Excluded · do not call">
                <Mono>{count(c.excluded_dnc)}</Mono>
              </Row>
            ) : null}
            <Row label="Calling hours">{hoursLabel(c.hours)}</Row>
            <Row label="Retry">{c.retries ? `No answer / busy · ${c.retries.max_attempts} × ${c.retries.delay_hours} h` : '—'}</Row>
            <Row label="Claiming">{`Atomic (CAS) · ${release}-min release`}</Row>
            <Row label="Script">{c.script ? `${c.script.name} (v${c.script.version})` : 'None'}</Row>
          </Panel>
          {(c.excluded_no_consent ?? 0) > 0 ? (
            <Notice
              tone="warning"
              action={
                <button type="button" className="shrink-0 font-semibold underline" onClick={() => go('/marketing/consent?tab=ledger')}>
                  Consent ledger
                </button>
              }
            >
              {`${count(c.excluded_no_consent)} of ${count(c.contacts_count)} contacts have no phone consent and are held back. Record a lawful basis or collect consent to release them.`}
            </Notice>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function AgentRow({ a }: { a: CallAgent }) {
  const st = agentStatus(a);
  return (
    <tr>
      <td className={TD}>
        <span className="flex min-w-0 items-center gap-2">
          <Avatar name={a.name} size={26} />
          <span className="min-w-0">
            <span className="block truncate font-semibold">{a.name}</span>
            {a.can_call === false ? <span className="block truncate text-[11px] text-warning">doesn’t hold marketing.call.make</span> : null}
          </span>
        </span>
      </td>
      <td className={TD}>
        <Status tone={st.tone}>{st.label}</Status>
      </td>
      <td className={cx(TD, 'text-right')}>
        <Mono>{count(a.calls_today)}</Mono>
      </td>
      <td className={cx(TD, 'text-right')}>
        <Mono>{count(a.reached)}</Mono>
      </td>
      <td className={cx(TD, 'text-right')}>
        <Mono>{count(a.interested)}</Mono>
      </td>
      <td className={cx(TD, 'text-right')}>
        <Mono>{typeof a.avg_seconds === 'number' ? clock(a.avg_seconds) : '—'}</Mono>
      </td>
    </tr>
  );
}
