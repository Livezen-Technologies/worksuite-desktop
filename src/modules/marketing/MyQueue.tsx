import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { useState } from 'react';
import { Icon } from '../../components/Icon';
import { Select } from '../../components/Select';
import { cx, Spinner } from '../../components/ui';
import { ApiError, apiGet } from '../../core/api';
import { app } from '../../core/app-state';
import { effectiveShortcuts, prettyAccelerator } from '../../core/commands';
import { text } from '../../core/i18n';
import { useStore } from '../../core/store';
import { useTab } from '../../core/tab-context';
import { parseTs } from '../../core/time';
import { useNow } from '../../core/use-now';
import { mayAny } from './api';
import type { Callback, QueueItem, QueueList } from './calls';
import { atLabel, CLAIM_COMMAND, dial, dialDigits, dueLabel, NEXT_CONTACT_GLOBAL, useCallCampaigns } from './calls-parts';
import { Workspace } from './calls-workspace';
import { btnPrimary, btnSmall, Card, Empty, PageHeader, Pill, Seg } from './parts';
import type { QueueTab } from './routes';
import { refusal, type Options } from './types';

/**
 * My call queue (MKT-DSK-01, MKT-CAL-03…12; the D01 and W11 / DK11 designs).
 *
 * - **Waiting** (D01): who is waiting for me, in the order Next contact would take them — without taking anybody —
 *   with their organisation, which attempt it would be, why they are here (new, a retry after no answer, a callback
 *   and what was promised) and when they are due. Next contact, or the global key from any other app, takes the first.
 * - **Callbacks**: the calls promised for a time, due now and later; each is a task for whoever makes it, and comes
 *   first in their queue when due. Call now rings the number; the workspace takes it.
 * - **Workspace** (W11): the contact in hand, the script, the outcome and the wrap-up (`calls-workspace.tsx`).
 *
 * The queue, the order and who may be called are the server's: `GET calls/queue/list` reads it, `GET calls/queue`
 * claims from it. A server a part behind has no list (404): then this says so, and Next contact still works.
 */
export default function MyQueue({ options, campaignId, tab, claim, onTab, onClaimed, onContact, onCampaign }: {
  options: Options;
  campaignId: number | null;
  tab: QueueTab;
  claim: string | null;
  onTab: (t: QueueTab) => void;
  onClaimed: () => void;
  onContact: (id: number) => void;
  onCampaign: (id: number | null) => void;
}) {
  const { go } = useTab();
  const overrides = useStore(app, (s) => s.prefs?.shortcuts);
  const here = effectiveShortcuts(overrides)[CLAIM_COMMAND];
  const campaigns = useCallCampaigns('');
  const list = useQuery({
    queryKey: ['marketing', 'calls', 'queue-list', campaignId ?? 'all'],
    queryFn: ({ signal }) => apiGet<QueueList>('/api/marketing/calls/queue/list', campaignId ? { campaign: campaignId } : undefined, signal),
    retry: false,
    refetchInterval: 30_000,
  });
  const mine = (campaigns.data?.items ?? []).filter((c) => c.mine && (c.status === 'active' || c.status === 'paused' || c.id === campaignId));
  const campaignName = campaignId ? (campaigns.data?.items.find((c) => c.id === campaignId)?.name ?? list.data?.items.find((i) => i.campaign_id === campaignId)?.campaign ?? null) : null;
  const waiting = list.data?.waiting ?? null;
  const callbacksToday = list.data?.callbacks_today ?? null;
  /** The workspace on one campaign, taking its next contact (a due callback comes first). */
  const work = (id: number) => go(`/marketing?view=queue&tab=work&call=${id}&claim=${Date.now()}`);

  const tabs = (
    <Seg
      label="My call queue"
      value={tab}
      onChange={onTab}
      options={[
        { id: 'queue', label: waiting !== null ? text('Waiting · {n}', { n: waiting.toLocaleString() }) : 'Waiting' },
        { id: 'callbacks', label: callbacksToday ? text('Callbacks · {n} today', { n: callbacksToday }) : 'Callbacks' },
        { id: 'work', label: 'Workspace' },
      ]}
    />
  );

  if (tab === 'work') {
    return <Workspace options={options} campaignId={campaignId} claim={claim} onClaimed={onClaimed} onTab={onTab} onContact={onContact} tabs={tabs} waiting={waiting} />;
  }

  const sub = [
    campaignName ?? 'All my call campaigns',
    waiting !== null ? text('{n} waiting', { n: waiting.toLocaleString() }) : null,
    text('{key} claims the next contact from any other app', { key: prettyAccelerator(NEXT_CONTACT_GLOBAL) }),
    here ? text('{key} here', { key: prettyAccelerator(here) }) : null,
  ].filter(Boolean).join(' · ');

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <PageHeader
        crumbs={['Calls']}
        title="My call queue"
        sub={sub}
        actions={
          <>
            {mine.length > 1 || campaignId ? (
              <Select
                value={campaignId ? String(campaignId) : ''}
                onValueChange={(v) => onCampaign(v ? Number(v) : null)}
                aria-label="Call campaign"
                className="min-w-[200px]"
                options={[{ value: '', label: 'All my call campaigns' }, ...mine.map((c) => ({ value: String(c.id), label: c.name }))]}
              />
            ) : null}
            <button type="button" className={btnPrimary} onClick={() => onTab('work')}>
              <Icon name="chevron-right" size={15} /> Next contact
            </button>
          </>
        }
      />
      {tabs}
      {tab === 'callbacks' ? <Callbacks options={options} onContact={onContact} onWork={work} /> : <Waiting list={list} campaignId={campaignId} onContact={onContact} onNext={() => onTab('work')} />}
    </div>
  );
}

/** Why a contact is in the queue, as the D01 list says it. */
function reasonOf(i: QueueItem): string {
  if (i.reason === 'callback') return i.note ? `“${i.note}”` : 'Callback';
  if (i.reason === 'retry') return text('Retry · {why}', { why: (i.last_outcome_label ?? 'no answer').toLowerCase() });
  return 'New';
}

/** The D01 list: who is waiting for me, without taking anybody. */
function Waiting({ list, campaignId, onContact, onNext }: { list: UseQueryResult<QueueList>; campaignId: number | null; onContact: (id: number) => void; onNext: () => void }) {
  if (list.isLoading) return <Spinner />;
  if (list.isError) {
    const missing = list.error instanceof ApiError && list.error.status === 404;
    return (
      <Card>
        <p className="m-0 text-[13px] text-ink-2">{missing ? 'This server does not list the queue yet. Next contact takes whoever is next for you.' : refusal(list.error, 'The queue could not be loaded.')}</p>
        <button type="button" className={cx(btnPrimary, 'mt-3')} onClick={onNext}>
          <Icon name="chevron-right" size={15} /> Next contact
        </button>
      </Card>
    );
  }
  const items = list.data?.items ?? [];
  if (items.length === 0) {
    return (
      <Card>
        <Empty text="Nobody is waiting for you. A retry or a callback comes back here when it is due." />
      </Card>
    );
  }
  const several = !campaignId && new Set(items.map((i) => i.campaign_id)).size > 1;
  return (
    <div className="overflow-x-auto rounded-[10px] border border-line bg-surface">
      <table className="w-full min-w-[560px] border-collapse text-[13.5px]">
        <thead>
          <tr className="bg-ground text-left text-[11.5px] font-semibold tracking-[.04em] text-ink-3 uppercase">
            <th scope="col" className="px-3.5 py-2.5">Contact</th>
            <th scope="col" className="px-3.5 py-2.5">Organisation</th>
            <th scope="col" className="px-3.5 py-2.5">Attempt</th>
            <th scope="col" className="px-3.5 py-2.5">Reason</th>
            <th scope="col" className="px-3.5 py-2.5">Due</th>
          </tr>
        </thead>
        <tbody>
          {items.map((i) => (
            <tr key={i.queue_id} className="border-t border-line/70">
              <td className="px-3.5 py-2.5">
                <span className="flex flex-wrap items-center gap-2">
                  <button type="button" onClick={() => onContact(i.contact_id)} className="text-left font-semibold text-ink hover:underline">
                    {i.name}
                  </button>
                  {list.data?.held === i.queue_id ? <Pill tone="blue">In your hands</Pill> : null}
                </span>
                {several ? <span className="block text-[11.5px] text-ink-3">{i.campaign}</span> : null}
              </td>
              <td className="px-3.5 py-2.5 text-ink-2">{i.company ?? '—'}</td>
              <td className="px-3.5 py-2.5 whitespace-nowrap text-ink-2 tabular-nums">{i.reason === 'callback' ? 'Callback' : `${i.attempts + 1} / ${i.max_attempts}`}</td>
              <td className="max-w-[260px] truncate px-3.5 py-2.5 text-ink-2" title={reasonOf(i)}>
                {reasonOf(i)}
              </td>
              <td className="px-3.5 py-2.5 whitespace-nowrap text-ink-2">{dueLabel(i.due_at)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** The calls promised for a time: due now, then later. Each is a WorkSuite task for whoever makes it. */
function Callbacks({ options, onContact, onWork }: { options: Options; onContact: (id: number) => void; onWork: (campaign: number) => void }) {
  const runs = mayAny(options, 'call_manage');
  const [whose, setWhose] = useState<'mine' | 'all'>('mine');
  const all = whose === 'all';
  const q = useQuery({
    queryKey: ['marketing', 'calls', 'callbacks', all],
    queryFn: ({ signal }) => apiGet<{ items: Callback[]; all: boolean }>('/api/marketing/calls/callbacks', all ? { all: 1 } : undefined, signal),
    retry: false,
    refetchInterval: 60_000,
  });
  const now = useNow(30_000).getTime();
  const items = q.data?.items ?? [];
  const due = items.filter((c) => parseTs(c.at).getTime() <= now);
  const later = items.filter((c) => parseTs(c.at).getTime() > now);

  const rows = (list: Callback[], dueNow: boolean) => (
    <ul className="m-0 flex list-none flex-col p-0">
      {list.map((c) => (
        <li key={c.queue_id} className="flex flex-wrap items-center gap-3 border-b border-line/70 px-4 py-2.5 last:border-b-0">
          <div className="min-w-0 flex-1">
            <button type="button" onClick={() => onContact(c.contact_id)} className="text-left text-[13.5px] font-semibold text-ink hover:underline">
              {c.name}
            </button>
            <span className="text-[12.5px] text-ink-3"> · {[c.phone ?? 'No number', c.campaign, all ? c.assignee?.name : null].filter(Boolean).join(' · ')}</span>
            {c.notes ? <span className="block truncate text-[12.5px] text-ink-2">“{c.notes}”</span> : null}
          </div>
          <span className={cx('text-[12.5px] whitespace-nowrap tabular-nums', dueNow ? 'font-bold text-warning-ink dark:text-warning' : 'text-ink-2')}>{atLabel(c.at)}</span>
          <div className="flex gap-1.5">
            <button type="button" className={cx(btnSmall, 'gap-1.5')} onClick={() => void dial(c.phone)} disabled={!dialDigits(c.phone)}>
              <Icon name="phone" size={14} /> Call now
            </button>
            {!all ? (
              <button type="button" className={btnSmall} onClick={() => onWork(c.campaign_id)}>
                Open in workspace
              </button>
            ) : null}
          </div>
        </li>
      ))}
    </ul>
  );

  return (
    <div className="flex flex-col gap-3">
      {runs ? (
        <Seg
          label="Whose callbacks"
          value={whose}
          onChange={setWhose}
          options={[
            { id: 'mine', label: 'Mine' },
            { id: 'all', label: 'Everybody’s' },
          ]}
        />
      ) : null}
      {q.isLoading ? (
        <Spinner />
      ) : q.isError ? (
        <Card>
          <Empty text={refusal(q.error, 'Callbacks could not be loaded.')} />
        </Card>
      ) : (
        <>
          <Card title={text('Due now — {n}', { n: due.length })} padded={false}>
            {due.length ? rows(due, true) : <Empty text="Nothing is due." />}
          </Card>
          <Card title={text('Later — {n}', { n: later.length })} padded={false}>
            {later.length ? rows(later, false) : <Empty text="Nothing later." />}
          </Card>
        </>
      )}
    </div>
  );
}
