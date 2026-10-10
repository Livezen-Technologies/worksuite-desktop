import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { errorMessage } from '../../../core/bridge';
import { toast } from '../../../core/toasts';
import { Checkbox } from '../../../components/Checkbox';
import { Select } from '../../../components/Select';
import { Button, ErrorNote, Modal, Spinner, cx } from '../../../components/ui';
import { HEALTH, qk } from '../api';
import { useProjectCompany } from '../company';
import { gk, gov, govWrite, type ChangeRequestFull } from './gov-api';
import { CHANGE_STATUS, ConfirmDialog, Field, Mono, ProjectFilter, Tabs, Tone, WAITS, WebButton, areaClass, fmtDay, fmtStamp, inputClass, num, signed, useLiveProjects } from './gov-kit';

/**
 * W14 · Change requests (SRS p47, PRJ-GOV, PRJ-STS): every request in reach with Waiting / Approved / Rejected / All
 * and their counts (`/projects/changes[/<id>]`, and one project's at `/projects/<id>/changes`), Raise, and the
 * request itself — what approval does to the project (each figure before and after, and the health it would then
 * have), why, and the decision.
 *
 * Four eyes: whoever raised a request cannot decide it — the server says so per request (`can_decide`) and the screen
 * says it in words. Rejecting needs a note. An approved delay can move the baseline end date with it. The raiser may
 * withdraw a waiting request (`can_withdraw`). A decision is an approval: all of it needs WorkSuite and is disabled
 * offline (PRJ-DSK-04).
 */

type Tab = 'waiting' | 'approved' | 'rejected' | 'all';

const KIND: Record<string, string> = { scope: 'Scope', budget: 'Budget', timeline: 'Timeline', resource: 'Resource' };

/** "Scope + budget + timeline": the kind, then whatever else the figures move. */
export function kindWords(c: Pick<ChangeRequestFull, 'kind' | 'budget_delta' | 'days_delta'>): string {
  const parts = [KIND[c.kind] ?? c.kind];
  if (c.kind !== 'budget' && Number(c.budget_delta)) parts.push('budget');
  if (c.kind !== 'timeline' && c.days_delta) parts.push('timeline');
  return parts.join(' + ');
}

const isWaiting = (c: ChangeRequestFull) => c.status === 'submitted' || c.status === 'draft';
const inTab = (c: ChangeRequestFull, t: Tab) => t === 'all' || (t === 'waiting' ? isWaiting(c) : c.status === t);

export function ChangesScreen({ id = null, projectId = null, offline, onOffline, onGo }: { id?: number | null; projectId?: number | null; offline: boolean; onOffline: (o: boolean) => void; onGo: (route: string) => void }) {
  useProjectCompany();
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>('waiting');
  const [localId, setLocalId] = useState<number | null>(null);
  const [projectFilter, setProjectFilter] = useState('');
  const [raising, setRaising] = useState(false);
  const pid = projectId ?? (Number(projectFilter) || null);
  // One list of everything in reach: the tabs filter it, so a request just decided stays open after it leaves "Waiting".
  const p = { status: 'all', project_id: pid };
  const q = useQuery({ queryKey: gk.changes(p), queryFn: ({ signal }) => gov.changes(p, { signal }) });
  const projects = useLiveProjects(!projectId);
  const fromCache = !!q.data?.offline;
  useEffect(() => onOffline(fromCache), [fromCache, onOffline]);
  const all = q.data?.data.changes ?? [];
  const shown = all.filter((c) => inTab(c, tab));
  const counts = q.data?.data.counts;
  const routeId = projectId ? localId : id;
  const selected = all.find((c) => c.id === routeId) ?? (routeId ? null : (shown[0] ?? null));
  const select = (cid: number) => (projectId ? setLocalId(cid) : onGo(`/projects/changes/${cid}`));
  const after = () => {
    for (const k of [['projects', 'changes'], ['projects', 'detail'], ['projects', 'budget'], ['projects', 'cost'], ['projects', 'dashboard'], ['projects', 'my-work'], qk.counts]) void qc.invalidateQueries({ queryKey: k });
  };

  return (
    <div className="flex min-h-0 flex-1">
      <aside className="flex min-h-0 w-[340px] shrink-0 flex-col border-e border-line">
        <div className="flex flex-col gap-2.5 border-b border-line px-4 py-3.5">
          <div className="flex items-center gap-2">
            <h1 className="flex-1 text-[18px] font-bold text-ink">Change requests</h1>
            <Button size="sm" variant="primary" icon="plus" disabled={offline} title={offline ? WAITS : undefined} onClick={() => setRaising(true)}>
              Raise
            </Button>
          </div>
          {projectId ? (
            <Button size="sm" icon="board" className="self-start" onClick={() => onGo(`/projects/${projectId}`)}>
              Board
            </Button>
          ) : (
            <ProjectFilter value={projectFilter} onChange={setProjectFilter} options={projects} />
          )}
          <Tabs<Tab>
            label="Status"
            value={tab}
            onChange={setTab}
            tabs={[
              { key: 'waiting', label: 'Waiting', count: counts?.waiting },
              { key: 'approved', label: 'Approved', count: counts?.approved },
              { key: 'rejected', label: 'Rejected', count: counts?.rejected },
              { key: 'all', label: 'All', count: counts?.all },
            ]}
          />
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto scroll-thin">
          {q.isLoading ? <Spinner /> : null}
          {q.error && !q.data ? (
            <div className="p-3">
              <ErrorNote error={q.error} onRetry={() => void q.refetch()} />
            </div>
          ) : null}
          {q.data && !shown.length ? <p className="px-4 py-6 text-center text-[12.5px] text-ink-3">No change requests here.</p> : null}
          {shown.length ? (
            <nav aria-label="Change requests">
              {shown.map((c) => {
                const on = c.id === selected?.id;
                const st = CHANGE_STATUS[c.status] ?? CHANGE_STATUS.draft!;
                return (
                  <button key={c.id} type="button" onClick={() => select(c.id)} aria-current={on ? 'true' : undefined} className={cx('flex w-full flex-col gap-0.5 border-b border-line/70 px-4 py-2.5 text-start hover:bg-subtle', on && 'bg-selection shadow-[inset_3px_0_0_var(--color-primary)]')}>
                    <span className="flex items-center gap-1.5">
                      <Mono className="text-[11.5px] text-ink-3">{c.number ?? '—'}</Mono>
                      <span className="rounded-[5px] bg-subtle px-1.5 text-[11px] font-semibold text-ink-2">{KIND[c.kind] ?? c.kind}</span>
                      <Tone tone={st.tone} className="ms-auto">
                        {st.label}
                      </Tone>
                    </span>
                    <b className="text-[13px] text-ink">{c.title}</b>
                    <span className="text-[11.5px] text-ink-3">
                      <Mono>{c.project_code}</Mono> · {c.requested_by ?? '—'}
                    </span>
                  </button>
                );
              })}
            </nav>
          ) : null}
        </div>
      </aside>
      <div className="min-w-0 flex-1 overflow-y-auto scroll-thin">
        {selected ? (
          <ChangeDetail key={selected.id} c={selected} offline={offline} onDone={after} />
        ) : routeId && q.data ? (
          <p className="px-5 py-4 text-ink-3">That change request is not in your reach any more.</p>
        ) : q.data ? (
          <p className="px-5 py-4 text-ink-3">Choose a change request.</p>
        ) : null}
      </div>
      {raising ? (
        <RaiseDialog
          projectId={pid}
          offline={offline}
          onClose={() => setRaising(false)}
          onSaved={(newId) => {
            setRaising(false);
            setTab('waiting');
            after();
            if (newId) select(newId);
          }}
        />
      ) : null}
    </div>
  );
}

function ChangeDetail({ c, offline, onDone }: { c: ChangeRequestFull; offline: boolean; onDone: () => void }) {
  const [note, setNote] = useState('');
  const [noteError, setNoteError] = useState<string | null>(null);
  const [moveBaseline, setMoveBaseline] = useState(c.kind === 'timeline' || c.days_delta > 0);
  const [busy, setBusy] = useState<'approve' | 'reject' | 'withdraw' | null>(null);
  const [confirmWithdraw, setConfirmWithdraw] = useState(false);
  const noteRef = useRef<HTMLTextAreaElement>(null);
  const waiting = isWaiting(c);
  const st = CHANGE_STATUS[c.status] ?? CHANGE_STATUS.draft!;

  const decide = async (decision: 'approve' | 'reject') => {
    if (decision === 'reject' && !note.trim()) {
      setNoteError('Write a note to the requester to say why it is rejected.');
      noteRef.current?.focus();
      return;
    }
    setBusy(decision);
    try {
      const r = await govWrite.decideChange(c.id, { decision, note: note.trim() || undefined, ...(decision === 'approve' && c.days_delta ? { move_baseline: moveBaseline } : {}) });
      toast('success', r.message && r.message !== 'OK' ? r.message : decision === 'approve' ? 'Change approved and applied' : 'Change rejected');
      onDone();
    } catch (e) {
      toast('error', errorMessage(e));
    } finally {
      setBusy(null);
    }
  };
  const withdraw = async () => {
    setBusy('withdraw');
    try {
      const r = await govWrite.withdrawChange(c.id);
      toast('success', r.message && r.message !== 'OK' ? r.message : 'Request withdrawn');
      onDone();
    } catch (e) {
      toast('error', errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  const healthLine = (() => {
    const parts: string[] = [];
    if (c.after_used_percent !== null && c.after_used_percent !== undefined) parts.push(`Budget after approval is ${Math.round(c.after_used_percent)}% used`);
    if (c.health_now && c.health_after) {
      const a = HEALTH[c.health_now]?.label ?? c.health_now;
      const b = HEALTH[c.health_after]?.label ?? c.health_after;
      parts.push(a === b ? `the health check stays “${a}”` : `the health check will move from “${a}” to “${b}”`);
    }
    return parts.length ? `${parts.join('; ')}.` : null;
  })();
  const heading = waiting ? 'What approval does to the project' : c.status === 'approved' ? 'What approval did to the project' : 'What approval would have done';
  const before = c.before;
  const later = c.after;
  const impact = [
    { label: `Budget (${c.currency})`, from: before ? num(before.budget) : null, to: later ? num(later.budget) : signed(c.budget_delta), delta: Number(c.budget_delta) ? signed(c.budget_delta) : 'no change' },
    { label: 'End date', from: before ? fmtDay(before.end_date) : null, to: later ? fmtDay(later.end_date) : c.days_delta ? `${signed(c.days_delta)} d` : '—', delta: c.days_delta ? `${signed(c.days_delta)} days` : 'no change' },
    { label: 'Estimated hours', from: before ? num(before.hours) : null, to: later ? num(later.hours) : signed(c.hours_delta), delta: Number(c.hours_delta) ? `${signed(c.hours_delta)} h` : 'no change' },
  ];
  const card = 'flex flex-col gap-2.5 rounded-[12px] border border-line bg-surface p-4';

  return (
    <div className="flex max-w-[860px] flex-col gap-3.5 px-5 py-4 text-[13px]">
      <div className="flex flex-col gap-1">
        <span className="truncate text-[12px] text-ink-3">
          <Mono>{c.number ?? '—'}</Mono> · {c.project_code} {c.project} · raised by {c.requested_by ?? 'someone'}, {fmtStamp(c.created_at)}
        </span>
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-[19px] font-bold text-ink">{c.title}</h2>
          <Tone tone={st.tone}>{st.label}</Tone>
          <Tone tone="bg-subtle text-ink-2">{kindWords(c)}</Tone>
          <span className="ms-auto">
            <WebButton path={`/projects/changes/${c.id}`} />
          </span>
        </div>
      </div>

      <section className={card}>
        <h3 className="text-[14.5px] font-bold text-ink">{heading}</h3>
        <div className="grid gap-3 sm:grid-cols-3">
          {impact.map((i) => (
            <div key={i.label} className="flex flex-col gap-1 rounded-[10px] border border-line p-3">
              <span className="text-[11.5px] text-ink-3">{i.label}</span>
              <span className="flex flex-wrap items-baseline gap-2 font-mono">
                {i.from !== null && i.from !== i.to ? (
                  <>
                    <span className="sr-only">from </span>
                    <s className="text-[13px] text-ink-3">{i.from}</s>
                    <span className="sr-only"> to </span>
                  </>
                ) : null}
                <span className="text-[19px] font-bold text-ink">{i.to}</span>
              </span>
              <span className={cx('text-[11.5px] font-semibold', i.delta === 'no change' ? 'text-ink-3' : 'text-warning-ink')}>{i.delta}</span>
            </div>
          ))}
        </div>
        {waiting && c.can_decide && c.days_delta !== 0 ? (
          <label className="flex items-start gap-2 text-ink">
            <Checkbox checked={moveBaseline} onChange={(e) => setMoveBaseline(e.target.checked)} />
            Move the baseline end date with this change, so the project is not flagged as slipped for an agreed delay
          </label>
        ) : null}
        {!waiting && c.moved_baseline ? <span className="text-[12px] text-ink-2">The baseline end date moved with this change.</span> : null}
        {healthLine && waiting ? <span className="text-[12px] text-ink-3">{healthLine}</span> : null}
      </section>

      <section className={card}>
        <h3 className="text-[14.5px] font-bold text-ink">Why</h3>
        <p className="whitespace-pre-line leading-relaxed text-ink-2">{c.description || 'No reason given.'}</p>
      </section>

      <section className={card}>
        <h3 className="text-[14.5px] font-bold text-ink">Decision</h3>
        {!waiting ? (
          <p className="text-ink-2">
            {st.label}
            {c.decided_by ? ` by ${c.decided_by}` : ''}
            {c.decided_at ? `, ${fmtDay(c.decided_at)}` : ''}.
            {c.decision_note ? <span className="mt-1 block whitespace-pre-line text-ink-3">“{c.decision_note}”</span> : null}
          </p>
        ) : c.can_decide ? (
          <>
            <Field label="Note to the requester (required to reject)">
              <textarea
                ref={noteRef}
                rows={3}
                value={note}
                onChange={(e) => (setNote(e.target.value), setNoteError(null))}
                aria-invalid={!!noteError}
                aria-describedby={noteError ? `note-err-${c.id}` : undefined}
                className={areaClass}
              />
            </Field>
            {noteError ? (
              <p id={`note-err-${c.id}`} role="alert" className="text-[12px] text-danger">
                {noteError}
              </p>
            ) : null}
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[12px] text-ink-3">You did not raise this request, so you can decide it.</span>
              <div className="ms-auto flex gap-2">
                <Button variant="danger" loading={busy === 'reject'} disabled={offline || !!busy} title={offline ? 'Decisions wait for a connection' : undefined} onClick={() => void decide('reject')}>
                  Reject
                </Button>
                <Button variant="success" loading={busy === 'approve'} disabled={offline || !!busy} title={offline ? 'Decisions wait for a connection' : undefined} onClick={() => void decide('approve')}>
                  Approve and apply
                </Button>
              </div>
            </div>
            {offline ? <p className="text-[12px] text-warning-ink">Change-request decisions wait for a connection.</p> : null}
          </>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[12px] text-ink-3">{c.is_mine ? 'You raised this request, so someone else decides it.' : 'Waiting for someone who can approve change requests on this project.'}</span>
            {c.can_withdraw ? (
              <Button className="ms-auto" loading={busy === 'withdraw'} disabled={offline || !!busy} title={offline ? WAITS : undefined} onClick={() => setConfirmWithdraw(true)}>
                Withdraw
              </Button>
            ) : null}
          </div>
        )}
      </section>
      {confirmWithdraw ? <ConfirmDialog title="Withdraw request" body={`Withdraw ${c.number ?? 'this request'}? It will not be decided.`} action="Withdraw" onClose={() => setConfirmWithdraw(false)} onYes={() => void withdraw()} /> : null}
    </div>
  );
}

function RaiseDialog({ projectId, offline, onClose, onSaved }: { projectId: number | null; offline: boolean; onClose: () => void; onSaved: (id?: number) => void }) {
  const projects = useLiveProjects(!projectId);
  const [f, setF] = useState({ project_id: String(projectId ?? ''), kind: 'scope', title: '', description: '', budget_delta: '', days_delta: '', hours_delta: '' });
  const set = (k: keyof typeof f, v: string) => setF((x) => ({ ...x, [k]: v }));
  const [busy, setBusy] = useState(false);
  const valid = !!f.title.trim() && !!f.project_id;
  const save = async () => {
    if (!valid || offline) return;
    setBusy(true);
    try {
      const r = await govWrite.createChange({
        project_id: Number(f.project_id),
        kind: f.kind,
        title: f.title.trim(),
        description: f.description.trim(),
        budget_delta: f.budget_delta.replace(/,/g, '') || '0',
        days_delta: Number(f.days_delta) || 0,
        hours_delta: Number(f.hours_delta) || 0,
      });
      toast('success', r.message && r.message !== 'OK' ? r.message : 'Change request submitted');
      onSaved(r.data?.id ? Number(r.data.id) : undefined);
    } catch (e) {
      toast('error', errorMessage(e));
      setBusy(false);
    }
  };
  return (
    <Modal
      title="Raise a change request"
      onClose={onClose}
      width={560}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={busy} disabled={!valid || offline} title={offline ? WAITS : undefined} onClick={() => void save()}>
            Submit for approval
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        {!projectId ? (
          <Field label="Project" required>
            <Select aria-label="Project" value={f.project_id} onValueChange={(v) => set('project_id', v)} options={[{ value: '', label: 'Choose a project…' }, ...projects]} className={inputClass} />
          </Field>
        ) : null}
        <Field label="Kind">
          <Select aria-label="Kind" value={f.kind} onValueChange={(v) => set('kind', v)} options={Object.entries(KIND).map(([value, label]) => ({ value, label }))} className={inputClass} />
        </Field>
        <Field label="Title" required>
          <input autoFocus value={f.title} onChange={(e) => set('title', e.target.value)} placeholder="What is changing" className={inputClass} />
        </Field>
        <Field label="Why" hint="The person deciding reads this first">
          <textarea rows={3} value={f.description} onChange={(e) => set('description', e.target.value)} className={areaClass} />
        </Field>
        <div className="grid grid-cols-3 gap-3">
          <Field label="Budget change" hint="Negative gives budget back">
            <input inputMode="decimal" value={f.budget_delta} onChange={(e) => set('budget_delta', e.target.value)} placeholder="0" className={cx(inputClass, 'font-mono')} />
          </Field>
          <Field label="Days added" hint="To the end date">
            <input inputMode="numeric" value={f.days_delta} onChange={(e) => set('days_delta', e.target.value)} placeholder="0" className={cx(inputClass, 'font-mono')} />
          </Field>
          <Field label="Hours added" hint="To the estimate">
            <input inputMode="decimal" value={f.hours_delta} onChange={(e) => set('hours_delta', e.target.value)} placeholder="0" className={cx(inputClass, 'font-mono')} />
          </Field>
        </div>
        {offline ? <p className="text-[12px] text-warning-ink">Raising a change request waits for a connection.</p> : null}
      </div>
    </Modal>
  );
}
