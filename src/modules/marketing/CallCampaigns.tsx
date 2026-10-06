import { useState } from 'react';
import { Icon } from '../../components/Icon';
import { Select } from '../../components/Select';
import { cx, Spinner } from '../../components/ui';
import { toast } from '../../core/toasts';
import { mayAny, refreshMarketing, send } from './api';
import type { CallStatus } from './calls';
import { CALL_PILL, FieldError, useCallCampaigns } from './calls-parts';
import { btn, btnPrimary, btnSmall, Card, Empty, Field, input, n, PageHeader, Pill, Seg, Sheet } from './parts';
import { companiesWhere, fieldErrors, refusal, type Options } from './types';

/**
 * Call campaigns (MKT-CAL-01, W10's list): who to ring, how it is going, and — for the campaigns I am an agent on —
 * a way into my queue. Whoever runs call campaigns in a company starts a new one here; it opens as a draft to set up
 * (audience, script, hours, retries, agents) before calling starts.
 *
 * The queue leaves out anybody on the do-not-call list, and anybody without phone consent where the company requires
 * it: the server decides who is callable, and the figures here are its.
 */
type StatusFilter = '' | CallStatus;

const FILTERS: Array<{ id: StatusFilter; label: string }> = [
  { id: '', label: 'All' },
  { id: 'active', label: 'Calling' },
  { id: 'draft', label: 'Drafts' },
  { id: 'paused', label: 'Paused' },
  { id: 'completed', label: 'Finished' },
];

export default function CallCampaigns({ org, options, onOpen, onQueue }: { org: string; options: Options; onOpen: (id: number) => void; onQueue: (id: number) => void }) {
  const [status, setStatus] = useState<StatusFilter>('');
  const q = useCallCampaigns(org, status);
  const where = companiesWhere(options, 'call_manage');
  const agent = mayAny(options, 'call_make');
  const [creating, setCreating] = useState(false);
  const items = q.data?.items ?? [];
  const many = options.companies.length > 1;

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <PageHeader
        crumbs={['Calls']}
        title="Call campaigns"
        sub="Who to ring, with what script, and how it is going. The queue leaves out anybody who may not be called."
        actions={
          where.length > 0 ? (
            <button type="button" className={btnPrimary} onClick={() => setCreating(true)}>
              <Icon name="plus" size={15} /> New call campaign
            </button>
          ) : null
        }
      />
      <Seg label="Status" value={status} onChange={setStatus} options={FILTERS} />
      {q.isLoading ? (
        <Spinner />
      ) : q.isError ? (
        <Card>
          <Empty text={refusal(q.error, 'Call campaigns could not be loaded.')} />
        </Card>
      ) : items.length === 0 ? (
        <Card>
          <Empty text={status ? 'No call campaign in this state.' : 'No call campaigns yet. One takes a list or a segment, and gives the agents you choose a queue to work.'} />
        </Card>
      ) : (
        <div className="overflow-x-auto rounded-[12px] border border-line bg-surface">
          <table className="w-full min-w-[640px] border-collapse text-[13px]">
            <thead>
              <tr className="bg-ground text-left text-[11px] font-bold tracking-[.4px] text-ink-3 uppercase">
                <th scope="col" className="px-3.5 py-2">Campaign</th>
                <th scope="col" className="px-3.5 py-2">Status</th>
                <th scope="col" className="px-3.5 py-2 text-right">Waiting</th>
                <th scope="col" className="px-3.5 py-2 text-right">Calls</th>
                <th scope="col" className="px-3.5 py-2 text-right">Reached</th>
                <th scope="col" className="px-3.5 py-2">Mine</th>
                <th scope="col" className="px-3.5 py-2">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {items.map((c) => (
                <tr key={c.id} className="border-t border-line/70 hover:bg-subtle/60">
                  <td className="max-w-[320px] px-3.5 py-2.5">
                    <button type="button" onClick={() => onOpen(c.id)} className="block max-w-full truncate text-left font-bold text-ink hover:underline">
                      {c.name}
                    </button>
                    <span className="block truncate text-[12px] text-ink-3">
                      {[many ? options.companies.find((co) => co.id === c.org_id)?.name : null, c.objective].filter(Boolean).join(' · ') || `${n(c.queued)} queued`}
                    </span>
                  </td>
                  <td className="px-3.5 py-2.5">
                    <Pill tone={CALL_PILL[c.status]}>{c.status_label}</Pill>
                  </td>
                  <td className="px-3.5 py-2.5 text-right tabular-nums">{n(c.waiting ?? 0)}</td>
                  <td className="px-3.5 py-2.5 text-right tabular-nums">{n(c.calls ?? 0)}</td>
                  <td className="px-3.5 py-2.5 text-right tabular-nums">{n(c.connected ?? 0)}</td>
                  <td className="px-3.5 py-2.5">{c.mine ? <Pill tone="blue">You call</Pill> : <span className="text-ink-3">—</span>}</td>
                  <td className="px-3.5 py-2.5 text-right">
                    {c.mine && agent && (c.status === 'active' || c.status === 'paused') ? (
                      <button type="button" className={cx(btnSmall, 'gap-1.5')} onClick={() => onQueue(c.id)} disabled={c.status !== 'active'} title={c.status === 'paused' ? 'Paused: nobody is called until it resumes.' : undefined}>
                        <Icon name="phone" size={14} /> Open queue
                      </button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {creating ? <NewCallCampaign options={options} onClose={() => setCreating(false)} onCreated={onOpen} /> : null}
    </div>
  );
}

/** A new call campaign: a name and its company. It opens as a draft, to set up before calling starts. */
function NewCallCampaign({ options, onClose, onCreated }: { options: Options; onClose: () => void; onCreated: (id: number) => void }) {
  const where = companiesWhere(options, 'call_manage');
  const [name, setName] = useState('');
  const [org, setOrg] = useState(String(where[0]?.id ?? ''));
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  async function create() {
    setBusy(true);
    setErrors({});
    try {
      const r = await send<{ id?: number; campaign?: { id: number } }>('POST', '/api/marketing/calls/campaigns', { name, org_id: Number(org) });
      toast('success', r.message ?? 'Call campaign created');
      void refreshMarketing();
      onClose();
      const id = r.data?.id ?? r.data?.campaign?.id;
      if (id) onCreated(id);
    } catch (e) {
      setErrors(fieldErrors(e));
      toast('error', refusal(e, 'The campaign could not be created.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet
      title="New call campaign"
      onClose={onClose}
      footer={
        <>
          <button type="button" className={btn} onClick={onClose}>
            Cancel
          </button>
          <button type="button" className={btnPrimary} onClick={() => void create()} disabled={busy || !name.trim() || !org}>
            Create draft
          </button>
        </>
      }
    >
      <Field label="Name" hint="The audience, script, hours, retries and agents are set on the draft.">
        <input className={input} value={name} onChange={(e) => setName(e.target.value)} placeholder="Vendor follow-up calls" autoFocus onKeyDown={(e) => e.key === 'Enter' && name.trim() && void create()} />
        <FieldError text={errors.name} />
      </Field>
      {where.length > 1 ? (
        <Field label="Company">
          <Select value={org} onValueChange={setOrg} options={where.map((c) => ({ value: String(c.id), label: c.name }))} aria-label="Company" />
        </Field>
      ) : null}
    </Sheet>
  );
}
