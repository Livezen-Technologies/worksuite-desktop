import { useQuery } from '@tanstack/react-query';
import { useTab } from '../../../core/tab-context';
import { Button, cx, Empty } from '../../../components/ui';
import { fetchCallCampaigns, MK, type CallCampaign, type CallCampaignStatus } from '../api';
import type { Tone } from '../lib/consent';
import { count, share } from '../lib/format';
import { useMarketingOrg } from '../org';
import { Loaded, Mono, PageBody, PageHeader, Status, TD, TH, Table } from '../parts';

/**
 * Call campaigns (MKT-CAL-01/08; the list behind DK10, PDF p46). A list or segment turned into a shared queue that
 * agents claim from one contact at a time: each campaign with its state, audience, what is waiting, who was reached
 * and who was interested, and how many agents work it. A campaign whose agents all lack marketing.call.make says so
 * (B-5): it can run, but nobody can claim.
 */

/** Call campaign states: draft → running ⇄ paused → finished. */
export const CALL_STATUS: Record<CallCampaignStatus, { label: string; tone: Tone }> = {
  draft: { label: 'Draft', tone: 'muted' },
  running: { label: 'Running', tone: 'success' },
  paused: { label: 'Paused', tone: 'warning' },
  finished: { label: 'Finished', tone: 'indigo' },
};

export function callStatus(s: string | null | undefined): { label: string; tone: Tone } {
  return CALL_STATUS[(s ?? 'draft') as CallCampaignStatus] ?? { label: s ?? '—', tone: 'muted' };
}

/** "List · Vendors 2026", "Segment · Engaged vendors". */
export function audienceLabel(a: CallCampaign['audience'] | null | undefined): string {
  if (!a) return '—';
  return `${a.kind === 'segment' ? 'Segment' : 'List'} · ${a.name}`;
}

/** A right-aligned head cell for figures. */
export const THR = TH.replace('text-left', 'text-right');

export default function CallCampaigns() {
  const org = useMarketingOrg();
  const { go } = useTab();
  const q = useQuery({ queryKey: MK.callCampaigns(org), queryFn: ({ signal }) => fetchCallCampaigns(org, signal) });
  const create = () => go('/marketing/calls/new');
  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader
        crumb="Marketing / Calls"
        title="Call campaigns"
        sub="A list or segment turned into a shared queue: agents claim one contact at a time"
        actions={
          <Button variant="primary" icon="plus" onClick={create}>
            New call campaign
          </Button>
        }
      />
      <PageBody>
        <Loaded q={q} what="Call campaigns">
          {(rows) =>
            rows.length === 0 ? (
              <Empty
                icon="phone"
                title="No call campaigns yet"
                hint="Pick a list or segment, set calling hours and retries, attach a script and assign agents. Starting builds the queue they claim from."
                action={
                  <Button variant="primary" icon="plus" className="mt-2" onClick={create}>
                    New call campaign
                  </Button>
                }
              />
            ) : (
              <Table
                label="Call campaigns"
                head={
                  <tr>
                    <th className={TH}>Campaign</th>
                    <th className={TH}>Status</th>
                    <th className={TH}>Audience</th>
                    <th className={THR}>In queue</th>
                    <th className={THR}>Reached</th>
                    <th className={THR}>Interested</th>
                    <th className={THR}>Agents</th>
                  </tr>
                }
              >
                {rows.map((c) => (
                  <CampaignRow key={c.id} c={c} onOpen={() => go(`/marketing/calls/${c.id}`)} />
                ))}
              </Table>
            )
          }
        </Loaded>
      </PageBody>
    </div>
  );
}

function CampaignRow({ c, onOpen }: { c: CallCampaign; onOpen: () => void }) {
  const st = callStatus(c.status);
  const agents = c.agents ?? [];
  const nobody = agents.length > 0 && !agents.some((a) => a.can_call);
  return (
    <tr className="cursor-pointer hover:bg-subtle/60" onClick={onOpen}>
      <td className={TD}>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onOpen();
          }}
          className="max-w-[320px] truncate text-left font-semibold text-ink hover:text-primary hover:underline"
        >
          {c.name}
        </button>
        {c.script ? <span className="block max-w-[320px] truncate text-[11.5px] text-ink-3">{`Script · ${c.script.name} (v${c.script.version})`}</span> : null}
      </td>
      <td className={TD}>
        <Status tone={st.tone}>{st.label}</Status>
      </td>
      <td className={cx(TD, 'max-w-[240px] truncate')}>{audienceLabel(c.audience)}</td>
      <td className={cx(TD, 'text-right')}>
        <Mono>{count(c.in_queue)}</Mono>
      </td>
      <td className={cx(TD, 'text-right whitespace-nowrap')}>
        <Mono>{count(c.reached)}</Mono>
        {c.contacts_count ? <span className="ml-1.5 text-[11.5px] text-ink-3">{share(c.reached, c.contacts_count)}</span> : null}
      </td>
      <td className={cx(TD, 'text-right')}>
        <Mono>{count(c.interested)}</Mono>
      </td>
      <td className={cx(TD, 'text-right whitespace-nowrap')}>
        {nobody ? (
          <span className="mr-1.5" title="None of them holds marketing.call.make, so nobody can claim from this queue.">
            <Status tone="warning">Nobody can claim</Status>
          </span>
        ) : null}
        <Mono>{count(agents.length)}</Mono>
      </td>
    </tr>
  );
}
