import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { ApiError, apiDelete, apiGet, apiPost, apiPut } from '../../core/api';
import { errorMessage } from '../../core/bridge';
import { toast } from '../../core/toasts';
import { Icon } from '../../components/Icon';
import { Select } from '../../components/Select';
import { ErrorNote, Spinner, cx } from '../../components/ui';
import { btn, btnPrimary, btnSmall, Caps, Field, input, Sheet } from '../../components/PageKit';
import type { Pipeline, Stage } from './api';
import { isMissing, moveItem, stageProblems } from './logic';
import { stageColour } from './parts';
import { useCrmScope } from './scope';

/**
 * CRM settings › Pipelines and stages (W12, gap #6): the company's
 * pipelines — add, rename, make one the default, delete — and each one's
 * stages in order: name, kind (open, won, lost), probability and colour,
 * added, changed, moved up or down, or deleted. The server keeps the rules
 * (a stage holding deals cannot go: 409 `stage_in_use`; a pipeline keeps one
 * won and one lost stage: 422 `stages_required`; one default per company);
 * this screen says the same before it asks. Read-only without CRM settings.
 */
const KINDS: Array<[Stage['kind'], string]> = [
  ['open', 'Open'],
  ['won', 'Won'],
  ['lost', 'Lost'],
];
const COLOURS = ['slate', 'sky', 'blue', 'indigo', 'violet', 'amber', 'orange', 'emerald', 'teal', 'rose', 'red'];

function why(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.code === 'stage_in_use') return 'Deals are still in that stage. Move them to another stage first.';
    if (e.code === 'stages_required') return 'A pipeline keeps one Won and one Lost stage.';
    if (isMissing(e)) return 'This WorkSuite server cannot change pipelines from here yet.';
  }
  return errorMessage(e);
}

export function PipelinesEditor({ canEdit }: { canEdit: boolean }) {
  const qc = useQueryClient();
  const scope = useCrmScope();
  const q = useQuery({ queryKey: ['crm', 'pipelines', scope.orgId ?? 0], queryFn: ({ signal }) => apiGet<{ pipelines: Pipeline[] }>('/api/crm/pipelines', scope.params, signal), staleTime: 0 });
  const [chosen, setChosen] = useState<number | null>(null);
  const [naming, setNaming] = useState<{ id: number | null; name: string } | null>(null);
  const [removing, setRemoving] = useState<Pipeline | null>(null);
  const [busy, setBusy] = useState(false);
  const list = q.data?.pipelines ?? [];
  const p = list.find((x) => x.id === chosen) ?? list.find((x) => x.is_default) ?? list[0] ?? null;
  const stages = [...(p?.stages ?? [])].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
  const problems = stageProblems(stages);
  const refresh = () => void qc.invalidateQueries({ queryKey: ['crm'] });
  const run = async (fn: () => Promise<unknown>, done: string) => {
    setBusy(true);
    try {
      await fn();
      toast('success', done);
      refresh();
      return true;
    } catch (e) {
      toast('error', why(e));
      return false;
    } finally {
      setBusy(false);
    }
  };
  const saveStage = (s: Stage, patch: Partial<Stage>) => void run(() => apiPut(`/api/crm/stages/${s.id}`, { name: s.name, kind: s.kind, probability: s.probability, colour: s.colour, ...patch }), 'Stage saved.');
  const reorder = (i: number, dir: -1 | 1) => p && void run(() => apiPost(`/api/crm/pipelines/${p.id}/stages/reorder`, { ids: moveItem(stages, i, dir).map((s) => s.id) }), 'Order saved.');

  return (
    <section className="flex flex-col gap-3" aria-label="Pipelines and stages">
      <Caps>Pipelines and stages</Caps>
      {q.isLoading ? <Spinner /> : q.error ? <ErrorNote error={q.error} onRetry={() => void q.refetch()} /> : null}
      {q.data ? (
        <div className="flex flex-wrap items-center gap-2">
          {list.map((x) => (
            <button key={x.id} type="button" aria-pressed={p?.id === x.id} onClick={() => setChosen(x.id)} className={cx('h-[30px] rounded-full px-3 text-[12.5px] font-semibold', p?.id === x.id ? 'bg-primary text-white' : 'border border-line bg-surface text-ink hover:bg-subtle')}>
              {x.name}
              {x.is_default ? <span className="ml-1.5 text-[11px] opacity-75">default</span> : null}
            </button>
          ))}
          {canEdit ? (
            <button type="button" className={btnSmall} onClick={() => setNaming({ id: null, name: '' })}>
              <Icon name="plus" size={13} /> New pipeline
            </button>
          ) : null}
        </div>
      ) : null}
      {p ? (
        <div className="flex flex-col overflow-x-auto rounded-[10px] border border-line">
          <div className="flex flex-wrap items-center gap-2 border-b border-line bg-well/60 px-3 py-2">
            <b className="min-w-0 flex-1 truncate text-ink">{p.name}</b>
            {canEdit ? (
              <>
                <button type="button" className={btnSmall} disabled={busy} onClick={() => setNaming({ id: p.id, name: p.name })}>
                  Rename
                </button>
                {!p.is_default ? (
                  <button type="button" className={btnSmall} disabled={busy} onClick={() => void run(() => apiPut(`/api/crm/pipelines/${p.id}`, { name: p.name, is_default: true }), `${p.name} is the default now.`)}>
                    Make default
                  </button>
                ) : null}
                <button type="button" className={cx(btnSmall, 'text-danger')} disabled={busy || p.is_default} title={p.is_default ? 'Make another pipeline the default first' : undefined} onClick={() => setRemoving(p)}>
                  Delete
                </button>
              </>
            ) : null}
          </div>
          {/* The stage table keeps its columns on a narrow (or scaled-up) window and scrolls sideways instead of clipping its buttons. */}
          <div className="flex min-w-[600px] flex-col">
          <div className="flex items-center gap-2 border-b border-line px-3 py-1.5 text-[11px] font-bold tracking-[.4px] text-ink-3 uppercase">
            <span className="w-4 shrink-0" />
            <span className="min-w-0 flex-1">Stage</span>
            <span className="w-[110px] shrink-0">Kind</span>
            <span className="w-[90px] shrink-0 text-right">Probability</span>
            <span className="w-[120px] shrink-0">Colour</span>
            {canEdit ? <span className="w-[96px] shrink-0" /> : null}
          </div>
          {stages.map((s, i) => (
            <StageRow key={s.id} s={s} canEdit={canEdit} busy={busy} first={i === 0} last={i === stages.length - 1} onSave={(patch) => saveStage(s, patch)} onUp={() => reorder(i, -1)} onDown={() => reorder(i, 1)} onDelete={() => void run(() => apiDelete(`/api/crm/stages/${s.id}`), 'Stage deleted.')} />
          ))}
          {canEdit ? <AddStage busy={busy} onAdd={(s) => run(() => apiPost(`/api/crm/pipelines/${p.id}/stages`, s), 'Stage added.')} /> : null}
          </div>
        </div>
      ) : q.data ? (
        <p className="m-0 text-[12.5px] text-ink-3">No pipeline yet.</p>
      ) : null}
      {problems.length && p ? (
        <p role="alert" className="m-0 text-[12px] text-danger">
          {problems.join(' ')}
        </p>
      ) : null}
      {naming ? (
        <Sheet
          title={naming.id ? 'Rename the pipeline' : 'New pipeline'}
          width={420}
          onClose={() => setNaming(null)}
          footer={
            <>
              <button type="button" className={btn} onClick={() => setNaming(null)}>
                Cancel
              </button>
              <button
                type="button"
                className={btnPrimary}
                disabled={busy || !naming.name.trim()}
                onClick={() =>
                  void run(
                    () => (naming.id ? apiPut(`/api/crm/pipelines/${naming.id}`, { name: naming.name.trim() }) : apiPost('/api/crm/pipelines', { name: naming.name.trim(), ...(scope.orgId ? { org_id: scope.orgId } : {}) })),
                    naming.id ? 'Renamed.' : 'Pipeline added — it starts with the usual stages.',
                  ).then((ok) => ok && setNaming(null))
                }
              >
                {naming.id ? 'Rename' : 'Add pipeline'}
              </button>
            </>
          }
        >
          <input autoFocus aria-label="Pipeline name" value={naming.name} onChange={(e) => setNaming({ ...naming, name: e.target.value })} placeholder="Projects" className={input} maxLength={100} />
        </Sheet>
      ) : null}
      {removing ? (
        <Sheet
          title={`Delete ${removing.name}?`}
          width={420}
          onClose={() => setRemoving(null)}
          footer={
            <>
              <button type="button" className={btn} onClick={() => setRemoving(null)}>
                Cancel
              </button>
              <button type="button" className={cx(btnPrimary, 'bg-danger hover:bg-danger')} disabled={busy} onClick={() => void run(() => apiDelete(`/api/crm/pipelines/${removing.id}`), 'Pipeline deleted.').then((ok) => ok && (setRemoving(null), setChosen(null)))}>
                Delete
              </button>
            </>
          }
        >
          <p className="m-0 text-[13px] text-ink-2">A pipeline with deals in it is kept: the server refuses, and says so.</p>
        </Sheet>
      ) : null}
    </section>
  );
}

function StageRow({ s, canEdit, busy, first, last, onSave, onUp, onDown, onDelete }: { s: Stage; canEdit: boolean; busy: boolean; first: boolean; last: boolean; onSave: (patch: Partial<Stage>) => void; onUp: () => void; onDown: () => void; onDelete: () => void }) {
  const [name, setName] = useState(s.name);
  const [prob, setProb] = useState(String(s.probability));
  return (
    <div data-stage-row={s.id} className="flex items-center gap-2 border-b border-line/60 px-3 py-1.5 text-[13px] last:border-b-0">
      <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: stageColour(s.colour) }} />
      {canEdit ? (
        <>
          <input aria-label={`Stage ${s.name} name`} value={name} onChange={(e) => setName(e.target.value)} onBlur={() => name.trim() && name.trim() !== s.name && onSave({ name: name.trim() })} className={cx(input, 'min-w-0 flex-1')} maxLength={60} />
          <span className="w-[110px] shrink-0">
            <Select label={`Stage ${s.name} kind`} value={s.kind} onValueChange={(v) => v !== s.kind && onSave({ kind: v as Stage['kind'], probability: v === 'won' ? 100 : v === 'lost' ? 0 : s.probability })} options={KINDS.map(([v, l]) => ({ value: v, label: l }))} />
          </span>
          <input aria-label={`Stage ${s.name} probability`} type="number" min={0} max={100} value={prob} onChange={(e) => setProb(e.target.value)} onBlur={() => Number(prob) !== s.probability && Number(prob) >= 0 && Number(prob) <= 100 && onSave({ probability: Number(prob) })} className={cx(input, 'w-[90px] shrink-0 text-right tabular-nums')} />
          <span className="w-[120px] shrink-0">
            <Select label={`Stage ${s.name} colour`} value={s.colour} onValueChange={(v) => v !== s.colour && onSave({ colour: v })} options={[...new Set([...COLOURS, s.colour])].map((c) => ({ value: c, label: c }))} />
          </span>
          <span className="flex w-[96px] shrink-0 justify-end gap-1">
            <button type="button" aria-label={`Move ${s.name} up`} disabled={busy || first} onClick={onUp} className="flex h-7 w-7 items-center justify-center rounded-[6px] text-ink-3 hover:bg-subtle disabled:opacity-40">
              <Icon name="arrow-up" size={14} />
            </button>
            <button type="button" aria-label={`Move ${s.name} down`} disabled={busy || last} onClick={onDown} className="flex h-7 w-7 items-center justify-center rounded-[6px] text-ink-3 hover:bg-subtle disabled:opacity-40">
              <Icon name="arrow-down" size={14} />
            </button>
            <button type="button" aria-label={`Delete ${s.name}`} disabled={busy} onClick={onDelete} className="flex h-7 w-7 items-center justify-center rounded-[6px] text-ink-3 hover:bg-subtle hover:text-danger disabled:opacity-40">
              <Icon name="trash" size={14} />
            </button>
          </span>
        </>
      ) : (
        <>
          <span className="min-w-0 flex-1 truncate font-semibold text-ink">{s.name}</span>
          <span className="w-[110px] shrink-0 text-ink-2 capitalize">{s.kind}</span>
          <span className="w-[90px] shrink-0 text-right text-ink-2 tabular-nums">{s.probability}%</span>
          <span className="w-[120px] shrink-0 text-ink-2">{s.colour}</span>
        </>
      )}
    </div>
  );
}

function AddStage({ busy, onAdd }: { busy: boolean; onAdd: (s: { name: string; kind: Stage['kind']; probability: number; colour: string }) => Promise<boolean> }) {
  const [name, setName] = useState('');
  const [kind, setKind] = useState<Stage['kind']>('open');
  const [prob, setProb] = useState('50');
  const add = async () => {
    if (!name.trim()) return;
    if (await onAdd({ name: name.trim(), kind, probability: kind === 'won' ? 100 : kind === 'lost' ? 0 : Math.max(0, Math.min(100, Number(prob) || 0)), colour: kind === 'won' ? 'emerald' : kind === 'lost' ? 'rose' : 'sky' })) {
      setName('');
      setProb('50');
    }
  };
  return (
    <div className="flex items-end gap-2 bg-well/40 px-3 py-2">
      <Field label="New stage" className="min-w-0 flex-1">
        <input aria-label="New stage name" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void add()} placeholder="Demo booked" className={input} maxLength={60} />
      </Field>
      <span className="w-[110px] shrink-0">
        <Select label="New stage kind" value={kind} onValueChange={(v) => setKind(v as Stage['kind'])} options={KINDS.map(([v, l]) => ({ value: v, label: l }))} />
      </span>
      <input aria-label="New stage probability" type="number" min={0} max={100} value={kind === 'open' ? prob : kind === 'won' ? '100' : '0'} disabled={kind !== 'open'} onChange={(e) => setProb(e.target.value)} className={cx(input, 'w-[90px] shrink-0 text-right tabular-nums')} />
      <button type="button" className={btnPrimary} disabled={busy || !name.trim()} onClick={() => void add()}>
        Add stage
      </button>
    </div>
  );
}
