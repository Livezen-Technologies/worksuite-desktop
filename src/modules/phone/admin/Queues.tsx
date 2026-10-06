import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { toast } from '../../../core/toasts';
import { Button, Chip, cx, Empty, IconButton, Spinner } from '../../../components/ui';
import { isNotOffered, NOT_OFFERED, phoneApi, PK, rowsOf, useExtensions, useQueues, useRingGroups, type Queue, type QueueAgent, type RingGroup } from '../api';
import { clock, talkTime } from '../lib/format';
import { ConfirmButton, Field, INPUT, Mono, NotOffered, PageBody, PageHeader, Panel } from '../parts';
import { useDepartments } from './lookups';
import { Checkbox } from '../../../components/Checkbox';

/**
 * A08 · Queues & ring groups (VOIP-IVR-03/04, G-03). Queues with their strategy, ring time, maximum wait and
 * callers, SLA, music on hold, overflow, wrap-up, position announcements and callback; their agents with penalty,
 * skill, today's load and state. Ring groups with their members, strategy, timeout and fallback.
 */
const STRATEGY: Record<Queue['strategy'], string> = {
  rrmemory: 'Round robin (memory)',
  leastrecent: 'Least recent',
  fewestcalls: 'Fewest calls',
  ringall: 'Ring all',
  random: 'Random',
  linear: 'In order',
};
const GROUP_STRATEGY: Record<RingGroup['strategy'], string> = { ringall: 'Ring all', hunt: 'Hunt (one by one)', memoryhunt: 'Memory hunt' };

type Pick = { kind: 'queue'; id: number | 'new' } | { kind: 'group'; id: number | 'new' } | null;

export default function Queues() {
  const qc = useQueryClient();
  const queues = useQueues();
  const groups = useRingGroups();
  const [pick, setPick] = useState<Pick>(null);
  const qs = rowsOf(queues.data);
  const gs = rowsOf(groups.data);
  const sel = pick ?? (qs[0] ? { kind: 'queue' as const, id: qs[0].id } : gs[0] ? { kind: 'group' as const, id: gs[0].id } : null);
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: PK.queues });
    void qc.invalidateQueries({ queryKey: PK.ringGroups });
  };
  if (queues.isLoading || groups.isLoading) return <Spinner />;
  const none = queues.data?.offered === false && groups.data?.offered === false;
  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader
        title="Queues & ring groups"
        actions={
          none ? null : (
            <>
              <Button icon="plus" disabled={groups.data?.offered === false} onClick={() => setPick({ kind: 'group', id: 'new' })}>
                New ring group
              </Button>
              <Button variant="primary" icon="plus" disabled={queues.data?.offered === false} onClick={() => setPick({ kind: 'queue', id: 'new' })}>
                New queue
              </Button>
            </>
          )
        }
      />
      {none ? (
        <NotOffered what="Editing queues and ring groups" detail="They still arrive from the switch by sync (G-03)." />
      ) : (
        <PageBody>
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-[300px_minmax(0,1fr)]">
            <Panel bodyClassName="px-0 py-2">
              {qs.length + gs.length === 0 ? <Empty icon="users" title="No queues or ring groups" /> : null}
              <ul>
                {qs.map((q) => (
                  <ListItem key={`q${q.id}`} active={sel?.kind === 'queue' && sel.id === q.id} onClick={() => setPick({ kind: 'queue', id: q.id })} number={q.number} name={q.name} sub={`${q.strategy} · ${q.agents?.length ?? 0} agents · SLA ${q.sla_seconds} s`} tag="Queue" disabled={!q.enabled} />
                ))}
                {gs.map((g) => (
                  <ListItem key={`g${g.id}`} active={sel?.kind === 'group' && sel.id === g.id} onClick={() => setPick({ kind: 'group', id: g.id })} number={g.number} name={g.name} sub={`${g.strategy} · ${g.members.split(/[,\s-]+/).filter(Boolean).length} members${g.fallback_to ? ` · ${g.timeout} s → ${g.fallback_to}` : ''}`} tag="Ring group" disabled={!g.enabled} />
                ))}
              </ul>
            </Panel>
            {sel?.kind === 'queue' ? (
              <QueueEditor key={String(sel.id)} queue={sel.id === 'new' ? null : (qs.find((q) => q.id === sel.id) ?? null)} onSaved={refresh} />
            ) : sel?.kind === 'group' ? (
              <GroupEditor key={String(sel.id)} group={sel.id === 'new' ? null : (gs.find((g) => g.id === sel.id) ?? null)} onSaved={refresh} />
            ) : (
              <Panel>
                <Empty icon="users" title="Choose a queue or ring group" />
              </Panel>
            )}
          </div>
        </PageBody>
      )}
    </div>
  );
}

function ListItem({ active, onClick, number, name, sub, tag, disabled }: { active: boolean; onClick: () => void; number: string; name: string; sub: string; tag: string; disabled: boolean }) {
  return (
    <li>
      <button type="button" onClick={onClick} className={cx('flex w-full items-start gap-2 px-4 py-2.5 text-left hover:bg-subtle', active && 'bg-selection', disabled && 'opacity-55')}>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-semibold">
            <Mono>{number}</Mono> {name}
          </span>
          <span className="block truncate text-[11.5px] text-ink-3">{sub}</span>
        </span>
        <Chip tone={tag === 'Queue' ? 'indigo' : 'muted'}>{tag}</Chip>
      </button>
    </li>
  );
}

function QueueEditor({ queue, onSaved }: { queue: Queue | null; onSaved: () => void }) {
  const departments = useDepartments();
  const exts = useExtensions();
  const [f, setF] = useState<Partial<Queue>>(() => queue ?? { name: '', number: '', strategy: 'rrmemory', timeout: 20, max_wait: 300, max_callers: 0, sla_seconds: 30, announce_position: true, music_class: 'default', overflow_to: null, wrapup_seconds: 30, callback_after: null, record: false, enabled: true });
  const [saving, setSaving] = useState(false);
  const [adding, setAdding] = useState('');
  const set = (p: Partial<Queue>) => setF((x) => ({ ...x, ...p }));
  const agents: QueueAgent[] = queue?.agents ?? [];
  const save = async (extra: Partial<Queue> = {}) => {
    setSaving(true);
    try {
      await phoneApi.saveQueue(queue?.id ?? null, { ...f, ...extra });
      toast('success', 'Saved. Apply the configuration to make it live.');
      onSaved();
    } catch (e) {
      toast(isNotOffered(e) ? 'info' : 'error', isNotOffered(e) ? NOT_OFFERED : (e as Error).message);
    } finally {
      setSaving(false);
    }
  };
  const agentAct = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
      onSaved();
    } catch (e) {
      toast(isNotOffered(e) ? 'info' : 'error', isNotOffered(e) ? NOT_OFFERED : (e as Error).message);
    }
  };
  const num = (k: keyof Queue, v: string) => set({ [k]: Number(v.replace(/\D/g, '')) || 0 } as Partial<Queue>);
  return (
    <Panel
      title={queue ? `${queue.name} · ${queue.number}` : 'New queue'}
      sub={[f.department ?? departments.data?.find((d) => d.id === f.department_id)?.name, queue?.server_id ? null : null].filter(Boolean).join(' · ') || undefined}
      bodyClassName="flex flex-col gap-4"
    >
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Field label="Name">
          <input value={f.name ?? ''} onChange={(e) => set({ name: e.target.value })} aria-label="Queue name" className={INPUT} />
        </Field>
        <Field label="Number">
          <input value={f.number ?? ''} onChange={(e) => set({ number: e.target.value.replace(/\D/g, '') })} aria-label="Queue number" className={cx(INPUT, 'font-mono')} />
        </Field>
        <Field label="Strategy">
          <select aria-label="Strategy" value={f.strategy} onChange={(e) => set({ strategy: e.target.value as Queue['strategy'] })} className={INPUT}>
            {Object.entries(STRATEGY).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Department">
          <select aria-label="Department" value={f.department_id ?? ''} onChange={(e) => set({ department_id: e.target.value ? Number(e.target.value) : null })} className={INPUT}>
            <option value="">None</option>
            {(departments.data ?? []).map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Ring each agent (s)">
          <input value={String(f.timeout ?? '')} onChange={(e) => num('timeout', e.target.value)} aria-label="Ring each agent" className={INPUT} />
        </Field>
        <Field label="Max wait (s)">
          <input value={String(f.max_wait ?? '')} onChange={(e) => num('max_wait', e.target.value)} aria-label="Max wait" className={INPUT} />
        </Field>
        <Field label="Max callers (0 = unlimited)">
          <input value={String(f.max_callers ?? '')} onChange={(e) => num('max_callers', e.target.value)} aria-label="Max callers" className={INPUT} />
        </Field>
        <Field label="SLA target (answer within s)">
          <input value={String(f.sla_seconds ?? '')} onChange={(e) => num('sla_seconds', e.target.value)} aria-label="SLA target" className={INPUT} />
        </Field>
        <Field label="Music on hold">
          <input value={f.music_class ?? ''} onChange={(e) => set({ music_class: e.target.value || null })} aria-label="Music on hold" className={INPUT} />
        </Field>
        <Field label="When full or timed out">
          <input value={f.overflow_to ?? ''} onChange={(e) => set({ overflow_to: e.target.value || null })} placeholder="Voicemail 610, or an extension" aria-label="Overflow" className={cx(INPUT, 'font-mono')} />
        </Field>
        <Field label="Wrap-up time (s)">
          <input value={String(f.wrapup_seconds ?? '')} onChange={(e) => num('wrapup_seconds', e.target.value)} aria-label="Wrap-up time" className={INPUT} />
        </Field>
      </div>
      <div className="flex flex-wrap gap-4 text-[12.5px]">
        <label className="flex items-center gap-1.5">
          <Checkbox checked={!!f.announce_position} onChange={(e) => set({ announce_position: e.target.checked })} /> Announce position
        </label>
        <label className="flex items-center gap-1.5">
          <Checkbox checked={!!f.callback_after} onChange={(e) => set({ callback_after: e.target.checked ? 120 : null })} /> Offer callback after 2 min
        </label>
        <label className="flex items-center gap-1.5">
          <Checkbox checked={!!f.record} onChange={(e) => set({ record: e.target.checked })} /> Record all calls
        </label>
      </div>
      {queue ? (
        <div className="rounded-[10px] border border-line">
          <div className="flex items-center justify-between border-b border-line px-3 py-2">
            <b className="text-[13px]">Agents · {agents.length}</b>
            <span className="flex gap-1.5">
              <select aria-label="Add an agent" value={adding} onChange={(e) => setAdding(e.target.value)} className={cx(INPUT, 'h-8 w-[200px]')}>
                <option value="">Add an agent…</option>
                {(exts.data ?? [])
                  .filter((e) => e.enabled && !agents.some((a) => a.extension_id === e.id))
                  .map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.extension} · {e.user_name ?? e.name}
                    </option>
                  ))}
              </select>
              <Button size="sm" disabled={!adding} onClick={() => void agentAct(() => phoneApi.addQueueAgent(queue.id, { extension_id: Number(adding) })).then(() => setAdding(''))}>
                Add agents
              </Button>
            </span>
          </div>
          {agents.length ? (
            <ul>
              {agents.map((a) => (
                <li key={a.id} className="grid grid-cols-[minmax(0,1.3fr)_90px_minmax(0,1fr)_minmax(0,1fr)_90px_auto] items-center gap-2 border-b border-line px-3 py-2 text-[12.5px] last:border-b-0">
                  <span className="truncate">
                    <b>{a.name ?? `Ext ${a.extension}`}</b> <Mono className="text-ink-3">{a.extension}</Mono>
                  </span>
                  <label className="flex items-center gap-1 text-ink-3">
                    Penalty
                    <input defaultValue={String(a.penalty)} onBlur={(e) => Number(e.target.value) !== a.penalty && void agentAct(() => phoneApi.updateQueueAgent(queue.id, a.id, { penalty: Number(e.target.value) || 0 }))} aria-label={`Penalty for ${a.name ?? a.extension}`} className={cx(INPUT, 'h-7 w-10 px-1.5')} />
                  </label>
                  <input defaultValue={a.skill ?? ''} placeholder="Skill" onBlur={(e) => e.target.value !== (a.skill ?? '') && void agentAct(() => phoneApi.updateQueueAgent(queue.id, a.id, { skill: e.target.value || null }))} aria-label={`Skill for ${a.name ?? a.extension}`} className={cx(INPUT, 'h-7')} />
                  <span className="text-ink-3">{a.calls_today !== undefined ? `${a.calls_today} calls · ${talkTime(a.talk_today ?? 0)}` : '—'}</span>
                  <Chip tone={a.paused ? 'warning' : a.state === 'on_call' ? 'danger' : 'success'}>{a.paused ? 'Paused' : a.state === 'on_call' ? 'On call' : 'Available'}</Chip>
                  <span className="flex">
                    <IconButton icon={a.paused ? 'play' : 'pause'} label={a.paused ? 'Unpause' : 'Pause'} onClick={() => void agentAct(() => phoneApi.updateQueueAgent(queue.id, a.id, { paused: !a.paused }))} />
                    <IconButton icon="x" label="Remove from queue" onClick={() => void agentAct(() => phoneApi.removeQueueAgent(queue.id, a.id))} />
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="px-3 py-3 text-[12px] text-ink-3">No agents yet.</p>
          )}
        </div>
      ) : null}
      <div className="flex justify-end gap-2">
        {queue ? (
          queue.enabled ? (
            <ConfirmButton label="Disable queue" confirm="Disable queue" onConfirm={() => void save({ enabled: false })} />
          ) : (
            <Button onClick={() => void save({ enabled: true })}>Enable queue</Button>
          )
        ) : null}
        {queue ? <ConfirmButton label="Delete" confirm="Delete queue" variant="secondary" onConfirm={() => void phoneApi.deleteQueue(queue.id).then(onSaved, (e: Error) => toast('error', e.message))} /> : null}
        <Button variant="primary" loading={saving} disabled={!f.name?.trim() || !f.number} onClick={() => void save()}>
          {queue ? 'Save changes' : 'Create queue'}
        </Button>
      </div>
      {queue ? <p className="text-[11.5px] text-ink-3">Callers wait at most {clock(f.max_wait ?? 0)}; then they go to {f.overflow_to ?? 'the end of the dial plan'}.</p> : null}
    </Panel>
  );
}

function GroupEditor({ group, onSaved }: { group: RingGroup | null; onSaved: () => void }) {
  const exts = useExtensions();
  const [f, setF] = useState<Partial<RingGroup>>(() => group ?? { name: '', number: '', strategy: 'ringall', members: '', timeout: 25, fallback_to: null, enabled: true });
  const [saving, setSaving] = useState(false);
  const set = (p: Partial<RingGroup>) => setF((x) => ({ ...x, ...p }));
  const members = (f.members ?? '').split(/[,\s-]+/).filter(Boolean);
  const toggle = (ext: string) => set({ members: (members.includes(ext) ? members.filter((m) => m !== ext) : [...members, ext]).join('-') });
  const save = async () => {
    setSaving(true);
    try {
      await phoneApi.saveRingGroup(group?.id ?? null, f);
      toast('success', 'Saved. Apply the configuration to make it live.');
      onSaved();
    } catch (e) {
      toast(isNotOffered(e) ? 'info' : 'error', isNotOffered(e) ? NOT_OFFERED : (e as Error).message);
    } finally {
      setSaving(false);
    }
  };
  return (
    <Panel title={group ? `${group.name} · ${group.number}` : 'New ring group'} bodyClassName="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Field label="Name">
          <input value={f.name ?? ''} onChange={(e) => set({ name: e.target.value })} aria-label="Group name" className={INPUT} />
        </Field>
        <Field label="Number">
          <input value={f.number ?? ''} onChange={(e) => set({ number: e.target.value.replace(/\D/g, '') })} aria-label="Group number" className={cx(INPUT, 'font-mono')} />
        </Field>
        <Field label="Strategy">
          <select aria-label="Strategy" value={f.strategy} onChange={(e) => set({ strategy: e.target.value as RingGroup['strategy'] })} className={INPUT}>
            {Object.entries(GROUP_STRATEGY).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Ring for (s)">
          <input value={String(f.timeout ?? '')} onChange={(e) => set({ timeout: Number(e.target.value.replace(/\D/g, '')) || 0 })} aria-label="Ring for" className={INPUT} />
        </Field>
        <Field label="Then" className="col-span-2">
          <input value={f.fallback_to ?? ''} onChange={(e) => set({ fallback_to: e.target.value || null })} placeholder="Voicemail, an extension or a queue" aria-label="Fallback" className={cx(INPUT, 'font-mono')} />
        </Field>
      </div>
      <div>
        <div className="mb-1.5 text-[12px] font-semibold text-ink-2">Members · {members.length}</div>
        <div className="flex flex-wrap gap-1.5">
          {(exts.data ?? [])
            .filter((e) => e.enabled)
            .map((e) => (
              <button key={e.id} type="button" aria-pressed={members.includes(e.extension)} onClick={() => toggle(e.extension)} className={cx('rounded-full border px-2.5 py-1 text-[12px]', members.includes(e.extension) ? 'border-primary bg-selection font-semibold text-primary' : 'border-line text-ink-2 hover:bg-subtle')}>
                {e.extension} · {e.user_name ?? e.name}
              </button>
            ))}
          {members
            .filter((m) => !(exts.data ?? []).some((e) => e.extension === m))
            .map((m) => (
              <button key={m} type="button" onClick={() => toggle(m)} className="rounded-full border border-warning/40 bg-warning-bg px-2.5 py-1 text-[12px] text-warning">
                {m} (outside or unknown)
              </button>
            ))}
        </div>
      </div>
      <div className="flex justify-end gap-2">
        {group ? <ConfirmButton label="Delete" confirm="Delete ring group" variant="secondary" onConfirm={() => void phoneApi.deleteRingGroup(group.id).then(onSaved, (e: Error) => toast('error', e.message))} /> : null}
        <Button variant="primary" loading={saving} disabled={!f.name?.trim() || !f.number || !members.length} onClick={() => void save()}>
          {group ? 'Save changes' : 'Create ring group'}
        </Button>
      </div>
    </Panel>
  );
}
