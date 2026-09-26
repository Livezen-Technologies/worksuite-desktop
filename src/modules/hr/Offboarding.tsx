import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { ApiError, apiDelete, apiGet, apiPost, apiPut, request } from '../../core/api';
import { errorMessage } from '../../core/bridge';
import { toast } from '../../core/toasts';
import { ErrorNote, Spinner, cx } from '../../components/ui';
import { dayLong, dayShort } from './dates';
import { ProgressBar } from './onboardingParts';
import { EVENT_WORDS, FOLLOWS, stamp, type ExitInterview, type HandoverItem, type OffCase, type OffDepartment, type OffItem, type OffListItem } from './offboardingParts';
import { btn, btnPrimary, Cell, Empty, Field, input, PageHead, Panel, row, Seg, Sheet, SidePanel, StatusChip, THead } from './parts';
import { Select } from '../../components/Select';

/**
 * Offboarding (HrOffboarding; the web's Offboarding): everyone leaving, and
 * one leaver's case — what each department still needs done and who signs it
 * off, their login's switch-off, the exit interview and the handover. Every
 * action follows the server's own flags on the case (`may_*`), because who
 * may tick, waive or sign off depends on the department, not a permission.
 * Each write answers with the whole case, which replaces what is shown.
 */
const BASE = '/api/hr/offboarding';
type Filter = 'open' | 'completed' | 'cancelled' | '';

export default function Offboarding({ openId, onOpen }: { openId: number | null; onOpen: (id: number | null) => void }) {
  const [filter, setFilter] = useState<Filter>('open');
  const list = useQuery({ queryKey: ['hr', 'offboarding', filter], queryFn: ({ signal }) => apiGet<{ items: OffListItem[]; counts: Record<string, number> }>(BASE, { status: filter }, signal), retry: false, enabled: !openId });
  if (openId) return <OffboardingCase key={openId} caseId={openId} onBack={() => onOpen(null)} />;
  const counts = list.data?.counts ?? {};
  const n = (k: string) => (counts[k] ? ` (${counts[k]})` : '');
  return (
    <div className="flex flex-col gap-3.5">
      <PageHead title="Offboarding" sub="Everyone leaving, and what is left before they go.">
        <Seg
          label="Offboarding"
          value={filter}
          onChange={setFilter}
          options={[
            { id: 'open', label: `Open${n('open')}` },
            { id: 'completed', label: `Completed${n('completed')}` },
            { id: 'cancelled', label: `Cancelled${n('cancelled')}` },
            { id: '', label: 'All' },
          ]}
        />
      </PageHead>
      {list.isLoading ? <Spinner /> : list.error ? <ErrorNote error={list.error} onRetry={() => void list.refetch()} /> : null}
      {list.data ? (
        <div className="overflow-hidden rounded-[12px] border border-line bg-surface">
          <THead cols={[['Employee', null], ['Last working day', 130], ['Departments', 110], ['Progress', 180], ['Status', 110], ['', 60]]} />
          {list.data.items.map((c) => (
            <div key={c.id} className={row}>
              <Cell w={null} className="font-semibold">
                {c.employee.name}
                <span className="ml-1.5 text-[11.5px] font-medium text-ink-3">{[c.employee.no, c.company].filter(Boolean).join(' · ')}</span>
              </Cell>
              <Cell w={130}>{dayLong(c.last_working_date)}</Cell>
              <Cell w={110}>
                {c.cleared} of {c.departments} signed off
              </Cell>
              <span className="flex w-[180px] shrink-0 items-center gap-2">
                <ProgressBar percent={c.percent} className="flex-1" />
                <b className="w-9 text-right text-[12px] tabular-nums">{c.percent}%</b>
              </span>
              <Cell w={110} className="!overflow-visible">
                <StatusChip>{c.status_label}</StatusChip>
              </Cell>
              <span className="w-[60px] shrink-0 text-right">
                <button type="button" className="text-[12.5px] font-bold text-primary hover:underline" onClick={() => onOpen(c.id)}>
                  Open
                </button>
              </span>
            </div>
          ))}
          {!list.data.items.length ? <Empty text={filter === 'open' ? 'Nobody is leaving right now.' : 'Nothing here.'} /> : null}
        </div>
      ) : null}
    </div>
  );
}

/** Post to the case and show the case it answers with. */
export function useCaseWriter(caseId: number, queryKey: readonly unknown[] = ['hr', 'offboarding-case', caseId]) {
  const qc = useQueryClient();
  return async (method: 'POST' | 'PUT' | 'DELETE', path: string, body?: unknown, done?: string): Promise<boolean> => {
    try {
      const c = method === 'POST' ? await apiPost<OffCase>(path, body ?? {}) : method === 'PUT' ? await apiPut<OffCase>(path, body ?? {}) : await apiDelete<OffCase>(path);
      if (c && typeof c === 'object' && 'departments' in c) qc.setQueryData(queryKey, c);
      else void qc.invalidateQueries({ queryKey });
      void qc.invalidateQueries({ queryKey: ['hr', 'offboarding'] });
      if (done) toast('success', done);
      return true;
    } catch (e) {
      toast('error', errorMessage(e));
      return false;
    }
  };
}

type Ask = { title: string; label: string; action: string; required: boolean; run: (text: string) => Promise<boolean> };

function OffboardingCase({ caseId, onBack }: { caseId: number; onBack: () => void }) {
  const key = ['hr', 'offboarding-case', caseId] as const;
  const q = useQuery({ queryKey: key, queryFn: ({ signal }) => apiGet<OffCase>(`${BASE}/${caseId}`, undefined, signal) });
  const write = useCaseWriter(caseId);
  const [ask, setAsk] = useState<Ask | null>(null);
  const [returning, setReturning] = useState<OffItem | null>(null);
  const [adding, setAdding] = useState(false);
  const [handover, setHandover] = useState(false);
  const [refused, setRefused] = useState<string | null>(null);
  const [attachTo, setAttachTo] = useState<OffItem | null>(null);
  const qc = useQueryClient();
  if (q.isLoading) return <Spinner />;
  if (q.error) return <ErrorNote error={q.error} onRetry={() => void q.refetch()} />;
  const c = q.data!;
  const open = c.status === 'open';

  const complete = async () => {
    try {
      const d = await apiPost<OffCase>(`${BASE}/${caseId}/complete`, {});
      qc.setQueryData(key, d);
      toast('success', 'Offboarding completed.');
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) setRefused(e.message);
      else toast('error', errorMessage(e));
    }
  };
  const attach = async (file: File, item: OffItem) => {
    try {
      const form = new FormData();
      form.append('file', file, file.name);
      const r = await request<OffCase>('POST', `${BASE}/items/${item.id}/evidence`, { body: form });
      qc.setQueryData(key, r.data);
      toast('success', 'Evidence attached.');
    } catch (e) {
      toast('error', errorMessage(e));
    }
  };
  const itemActions = (it: OffItem) => {
    const a: Array<{ label: string; run: () => void; tone?: string }> = [];
    if (it.status === 'open') {
      if (it.may_attach) a.push({ label: 'Attach', run: () => (setAttachTo(it), document.getElementById('offboarding-evidence')?.click()) });
      if (it.may_return_asset) a.push({ label: 'Record return', run: () => setReturning(it) });
      if (it.may_complete && !FOLLOWS[it.source]) a.push({ label: 'Done', run: () => void write('POST', `${BASE}/items/${it.id}/done`, {}, 'Done.') });
      if (it.may_waive) a.push({ label: 'Waive', run: () => setAsk({ title: `Waive · ${it.title}`, label: 'Why does it not apply?', action: 'Waive', required: true, run: (t) => write('POST', `${BASE}/items/${it.id}/waive`, { reason: t }, 'Waived.') }) });
    } else if (it.may_reopen) a.push({ label: 'Undo', run: () => void write('POST', `${BASE}/items/${it.id}/reopen`, {}, 'Put back to do.') });
    return a;
  };
  const deptAction = (d: OffDepartment) =>
    d.status === 'pending' && d.may_clear
      ? { label: 'Sign off', run: () => setAsk({ title: `Sign off · ${d.name}`, label: 'Note (optional)', action: 'Sign off', required: false, run: (t) => write('POST', `${BASE}/clearances/${d.id}/clear`, { note: t || null }, `${d.name} signed off.`) }) }
      : d.status === 'cleared' && d.may_reopen
        ? { label: 'Reopen', run: () => setAsk({ title: `Reopen · ${d.name}`, label: 'Why?', action: 'Reopen', required: true, run: (t) => write('POST', `${BASE}/clearances/${d.id}/reopen`, { reason: t }, `${d.name} reopened.`) }) }
        : null;
  const items = c.departments.flatMap((d) => d.items.map((it) => ({ it, d })));

  return (
    <div className="flex flex-col gap-3.5">
      <input
        id="offboarding-evidence"
        type="file"
        hidden
        aria-label="Choose evidence"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (f && attachTo) void attach(f, attachTo);
        }}
      />
      <PageHead
        title={`Offboarding · ${c.employee.name}`}
        sub={`Last working day ${dayLong(c.last_working_date)}${c.template_name ? ` · ${c.template_name}` : ''}${c.status !== 'open' ? ` · ${c.status_label}` : ''}`}
      >
        <button type="button" className="font-semibold text-primary hover:underline" onClick={onBack}>
          ← All leavers
        </button>
        {c.handover ? (
          <button type="button" className={btn} onClick={() => setHandover(true)}>
            Handover
          </button>
        ) : null}
        {open && c.runs ? (
          <button type="button" className={btnPrimary} title={c.may_complete ? undefined : c.blockers.join('\n')} onClick={() => void complete()}>
            Complete offboarding
          </button>
        ) : null}
      </PageHead>
      <div className="flex flex-wrap items-stretch gap-2.5">
        <div className="flex min-w-[150px] flex-col justify-center rounded-[12px] border border-line bg-surface px-3.5 py-2.5">
          <span className="text-[12px] text-ink-3">Overall progress</span>
          <b className="text-[21px] text-ink tabular-nums">{c.progress.percent}%</b>
        </div>
        {c.departments.map((d) => {
          const act = deptAction(d);
          const pct = d.progress?.percent ?? (d.status === 'cleared' ? 100 : 0);
          return (
            <div key={d.id} className="flex min-w-[170px] flex-1 flex-col gap-1.5 rounded-[12px] border border-line bg-surface px-3.5 py-2.5">
              <span className="flex items-center gap-2">
                <b className="min-w-0 flex-1 truncate text-ink">{d.name}</b>
                <span className="text-[12px] text-ink-3 tabular-nums">{pct}%</span>
              </span>
              <ProgressBar percent={pct} className={d.status === 'cleared' ? '[&>span]:!bg-[#1F7A4D]' : undefined} />
              <span className="flex items-center gap-2 text-[11.5px]">
                <span className="min-w-0 flex-1 truncate text-ink-3">{d.status === 'cleared' ? `Signed off${d.cleared_by?.name ? ` by ${d.cleared_by.name}` : ''}` : d.approvers.length ? d.approvers.map((a) => a.name).join(', ') : (d.fallback ?? 'HR')}</span>
                {act && open ? (
                  <button type="button" className="font-bold text-primary hover:underline" onClick={act.run}>
                    {act.label}
                  </button>
                ) : null}
              </span>
            </div>
          );
        })}
      </div>
      <div className="grid grid-cols-[1.35fr_1fr] gap-3">
        <Panel
          title="What has to be done"
          action={
            open && c.departments.some((d) => d.may_add) ? (
              <button type="button" className="font-semibold text-primary hover:underline" onClick={() => setAdding(true)}>
                + Add an item
              </button>
            ) : null
          }
        >
          {items.map(({ it, d }) => {
            const done = it.status !== 'open';
            return (
              <div key={it.id} className="flex items-start gap-2.5 border-b border-line/70 px-3.5 py-2.5 last:border-b-0">
                <span className={cx('mt-px flex h-[20px] w-[20px] shrink-0 items-center justify-center rounded-full text-[11px] font-bold', done ? 'bg-[#1F7A4D] text-white' : 'border-[1.5px] border-[#C9CFDD] dark:border-line')}>{done ? '✓' : ''}</span>
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className={cx('font-semibold', done ? 'text-ink-3 line-through' : 'text-ink')}>{it.title}</span>
                  <span className="text-[11.5px] text-ink-3">
                    {[d.name, it.due_on ? `Due ${dayShort(it.due_on)}` : null, it.evidence_required && !it.evidence ? 'Needs evidence' : null, FOLLOWS[it.source] ?? null, it.status === 'waived' && it.waived_reason ? `Waived: ${it.waived_reason}` : null, it.evidence?.filename ? `Evidence: ${it.evidence.filename}` : null].filter(Boolean).join(' · ')}
                  </span>
                </span>
                {it.overdue && !done ? <StatusChip>Overdue</StatusChip> : null}
                {it.mine && !done ? <StatusChip>For you</StatusChip> : null}
                {!it.mandatory ? <StatusChip className="!bg-subtle !text-ink-3">Optional</StatusChip> : null}
                {open ? (
                  <span className="flex shrink-0 gap-2.5 text-[12px] font-semibold">
                    {itemActions(it).map((a) => (
                      <button key={a.label} type="button" className="text-primary hover:underline" onClick={a.run}>
                        {a.label}
                      </button>
                    ))}
                  </span>
                ) : null}
              </div>
            );
          })}
          {!items.length ? <Empty text="Nothing on the checklist." /> : null}
        </Panel>
        <div className="flex flex-col gap-3">
          {open && c.runs && c.blockers.length ? (
            <Panel title={`Before it can be completed — ${c.blockers.length}`} bodyClassName="px-3.5 py-2">
              <ul className="m-0 flex list-disc flex-col gap-1 pl-4 text-[12.5px] text-ink-2">
                {c.blockers.map((b) => (
                  <li key={b}>{b}</li>
                ))}
              </ul>
            </Panel>
          ) : null}
          {c.login ? <LoginPanel c={c} write={write} onAsk={setAsk} /> : null}
          {c.exit_interview ? <ExitInterviewPanel caseId={caseId} ei={c.exit_interview} write={write} /> : null}
          {c.events?.length ? (
            <Panel title="Events" bodyClassName="flex flex-col gap-1 px-3.5 py-2.5 text-[12.5px] text-ink-2">
              {c.events.slice(0, 12).map((e, i) => (
                <span key={i}>
                  <b className="text-ink">{stamp(e.at)}</b> · {EVENT_WORDS[e.event] ?? e.event.replace(/_/g, ' ')}
                  {e.after && e.event !== 'opened' ? ` — ${e.after}` : ''}
                  {e.by?.name ? ` · ${e.by.name}` : ''}
                </span>
              ))}
            </Panel>
          ) : null}
        </div>
      </div>
      {ask ? <AskSheet ask={ask} onClose={() => setAsk(null)} /> : null}
      {returning ? <RecordReturn item={returning} onClose={() => setReturning(null)} onSave={async (condition, notes) => (await write('POST', `${BASE}/items/${returning.id}/return`, { condition, notes: notes || null }, 'Return recorded.')) && setReturning(null)} /> : null}
      {adding ? <AddItem c={c} onClose={() => setAdding(false)} onSave={async (body) => (await write('POST', `${BASE}/${caseId}/items`, body, 'Item added.')) && setAdding(false)} /> : null}
      {handover && c.handover ? (
        <SidePanel label="Handover" width={620} onClose={() => setHandover(false)} head={<b className="text-ink">Handover · {c.employee.name}</b>}>
          <HandoverPanel c={c} write={write} />
        </SidePanel>
      ) : null}
      {refused ? (
        <Sheet title="Not ready to complete" width={460} onClose={() => setRefused(null)} footer={<button type="button" className={btnPrimary} onClick={() => setRefused(null)}>OK</button>}>
          <div className="text-[12.5px] whitespace-pre-line text-ink-2">{refused}</div>
        </Sheet>
      ) : null}
    </div>
  );
}

type Write = ReturnType<typeof useCaseWriter>;

/** Their login: when it switches off, and holding it on, releasing the hold, or switching it off now. */
function LoginPanel({ c, write, onAsk }: { c: OffCase; write: Write; onAsk: (a: Ask) => void }) {
  const l = c.login!;
  return (
    <Panel title="Their login" bodyClassName="flex flex-col gap-2 px-3.5 py-2.5 text-[12.5px]">
      <span className="text-ink-2">
        {!l.has_login
          ? 'No login is linked to this record.'
          : l.off_at
            ? `Switched off ${stamp(l.off_at)}${l.off_by ? ` by ${l.off_by}` : ''}.`
            : l.held
              ? `Held on${l.held_by ? ` by ${l.held_by}` : ''}${l.hold_reason ? ` — “${l.hold_reason}”` : ''}.`
              : l.due_at
                ? `Switches off ${stamp(l.due_at)}.`
                : `Switches off at ${l.time} on their last working day.`}
      </span>
      <div className="flex flex-wrap gap-2">
        {l.may_hold && !l.held && !l.off_at ? (
          <button type="button" className={btn} onClick={() => onAsk({ title: 'Hold their login on', label: 'Why?', action: 'Hold it on', required: true, run: (t) => write('POST', `${BASE}/${c.id}/login/hold`, { reason: t }, 'Held on.') })}>
            Hold it on
          </button>
        ) : null}
        {l.may_release && l.held ? (
          <button type="button" className={btn} onClick={() => void write('POST', `${BASE}/${c.id}/login/release`, {}, 'Hold released.')}>
            Release the hold
          </button>
        ) : null}
        {l.may_switch && !l.off_at ? (
          <button type="button" className={btn + ' !text-danger'} onClick={() => onAsk({ title: 'Switch their login off now?', label: 'Note (optional)', action: 'Switch off now', required: false, run: () => write('POST', `${BASE}/${c.id}/login/off`, {}, 'Login switched off.') })}>
            Switch off now
          </button>
        ) : null}
      </div>
    </Panel>
  );
}

/**
 * The exit interview: the leaver answers it (the questions come with the
 * case only for them and for HR who may see answers); HR keeps private notes.
 */
export function ExitInterviewPanel({ caseId, ei, write }: { caseId: number; ei: ExitInterview; write: Write }) {
  const [answers, setAnswers] = useState<Record<number, string | string[]>>(() => Object.fromEntries((ei.questions ?? []).map((q) => [q.id, q.answer ?? (q.kind === 'multiple' ? [] : '')])));
  const [notes, setNotes] = useState(ei.hr_notes ?? '');
  const answering = ei.may_answer && ei.status === 'open';
  const show = (v: string | string[] | null | undefined) => (Array.isArray(v) ? v.join(', ') : v || '—');
  return (
    <Panel title="Exit interview" sub={ei.questionnaire ?? undefined} bodyClassName="flex flex-col gap-2 px-3.5 py-2.5 text-[12.5px]">
      {ei.status === 'submitted' ? <span className="text-ink-3">Submitted {stamp(ei.submitted_at)}.</span> : !answering ? <span className="text-ink-3">Not answered yet.</span> : null}
      {(ei.questions ?? []).map((q) =>
        answering ? (
          <Field key={q.id} label={`${q.prompt}${q.required ? ' *' : ''}`}>
            {q.kind === 'long_text' ? (
              <textarea aria-label={q.prompt} value={String(answers[q.id] ?? '')} onChange={(e) => setAnswers((p) => ({ ...p, [q.id]: e.target.value }))} className={input + ' !h-[60px] resize-none py-2'} />
            ) : q.kind === 'rating' ? (
              <div className="flex gap-1.5">
                {[1, 2, 3, 4, 5].map((n) => (
                  <button key={n} type="button" aria-pressed={String(answers[q.id]) === String(n)} onClick={() => setAnswers((p) => ({ ...p, [q.id]: String(n) }))} className={cx('h-8 w-8 rounded-[8px] border font-bold', String(answers[q.id]) === String(n) ? 'border-primary bg-selection text-primary' : 'border-line text-ink-2')}>
                    {n}
                  </button>
                ))}
              </div>
            ) : q.kind === 'yes_no' || q.kind === 'single' ? (
              <Select aria-label={q.prompt} value={String(answers[q.id] ?? '')} onChange={(e) => setAnswers((p) => ({ ...p, [q.id]: e.target.value }))} className={input}>
                <option value="">Choose…</option>
                {(q.kind === 'yes_no' ? ['yes', 'no'] : q.options).map((o) => (
                  <option key={o} value={o}>
                    {q.kind === 'yes_no' ? (o === 'yes' ? 'Yes' : 'No') : o}
                  </option>
                ))}
              </Select>
            ) : q.kind === 'multiple' ? (
              <div className="flex flex-wrap gap-x-3 gap-y-1 font-medium">
                {q.options.map((o) => {
                  const cur = (answers[q.id] as string[]) ?? [];
                  return (
                    <label key={o} className="flex items-center gap-1.5">
                      <input type="checkbox" checked={cur.includes(o)} onChange={(e) => setAnswers((p) => ({ ...p, [q.id]: e.target.checked ? [...cur, o] : cur.filter((x) => x !== o) }))} className="accent-primary" />
                      {o}
                    </label>
                  );
                })}
              </div>
            ) : (
              <input aria-label={q.prompt} value={String(answers[q.id] ?? '')} onChange={(e) => setAnswers((p) => ({ ...p, [q.id]: e.target.value }))} className={input} />
            )}
          </Field>
        ) : (
          <span key={q.id} className="text-ink-2">
            {q.prompt} <b className="text-ink">{q.kind === 'rating' && q.answer ? `${show(q.answer)} / 5` : q.kind === 'yes_no' ? (q.answer === 'yes' ? 'Yes' : q.answer === 'no' ? 'No' : '—') : show(q.answer)}</b>
          </span>
        ),
      )}
      {answering ? (
        <button type="button" className={btnPrimary + ' self-end'} onClick={() => void write('POST', `${BASE}/${caseId}/exit-interview`, { answers }, 'Thank you — your answers were sent.')}>
          Send my answers
        </button>
      ) : null}
      {ei.may_note ? (
        <>
          <Field label="HR's private notes" hint={ei.hr_notes_by ? `Last written by ${ei.hr_notes_by}, ${stamp(ei.hr_notes_at)}` : 'Never shown to the leaver.'}>
            <textarea aria-label="HR's private notes" value={notes} onChange={(e) => setNotes(e.target.value)} className={input + ' !h-[60px] resize-none py-2'} />
          </Field>
          <button type="button" className={btn + ' self-start'} disabled={notes === (ei.hr_notes ?? '')} onClick={() => void write('PUT', `${BASE}/${caseId}/exit-interview/notes`, { notes }, 'Notes saved.')}>
            Save notes
          </button>
        </>
      ) : null}
    </Panel>
  );
}

/**
 * The handover (HrAdminSheet "Handover"): what the leaver passes on and to
 * whom — written as drafts, sent together, then accepted or returned by each
 * recipient — and their open work, moved to a colleague in one go.
 */
export function HandoverPanel({ c, write }: { c: OffCase; write: Write }) {
  const h = c.handover!;
  const qc = useQueryClient();
  const [editing, setEditing] = useState<HandoverItem | 'new' | null>(null);
  const [picked, setPicked] = useState<Record<string, boolean>>({});
  const [to, setTo] = useState('');
  const drafts = h.items.filter((i) => i.status === 'draft').length;
  const work = c.work?.kinds.flatMap((k) => k.items.map((i) => ({ ...i, kind: k.kind, kindLabel: k.label }))) ?? [];
  const chosen = work.filter((w) => picked[`${w.kind}:${w.id}`]);
  const move = async () => {
    try {
      const r = await apiPost<OffCase & { results?: { done: unknown[]; failed: Array<{ label: string; why: string }> } }>(`${BASE}/${c.id}/work`, { to: Number(to), items: chosen.map((w) => ({ kind: w.kind, id: w.id })) });
      const failed = r.results?.failed ?? [];
      if (failed.length) toast('error', failed.map((f) => `${f.label}: ${f.why}`).join('; '));
      else toast('success', `Moved ${chosen.length}.`);
      setPicked({});
      void qc.invalidateQueries({ queryKey: ['hr'] });
    } catch (e) {
      toast('error', errorMessage(e));
    }
  };
  return (
    <div className="flex flex-col gap-3">
      <Panel
        title={`Handover · ${h.items.length} ${h.items.length === 1 ? 'item' : 'items'}`}
        action={
          <span className="flex gap-2">
            {h.may_write ? (
              <button type="button" className={btn + ' !h-[30px]'} onClick={() => setEditing('new')}>
                Add an item
              </button>
            ) : null}
            {h.may_send && drafts ? (
              <button type="button" className={btnPrimary + ' !h-[30px]'} onClick={() => void write('POST', `${BASE}/${c.id}/handover/send`, {}, 'Handover sent.')}>
                Send {drafts} {drafts === 1 ? 'item' : 'items'}
              </button>
            ) : null}
          </span>
        }
      >
        {h.items.map((i) => (
          <div key={i.id} className="flex items-center gap-2.5 border-b border-line/70 px-3.5 py-2.5 last:border-b-0">
            <span className="flex min-w-0 flex-1 flex-col">
              <b className="truncate text-ink">{i.title}</b>
              <span className="truncate text-[11.5px] text-ink-3">
                {i.section_label} · to {i.recipient.name ?? 'someone'}
                {i.reference ? ` · ${i.reference}` : ''}
                {i.response ? ` · “${i.response}”` : ''}
              </span>
            </span>
            <StatusChip>{i.status_label}</StatusChip>
            {i.may_edit ? (
              <>
                <button type="button" className="text-[12px] font-semibold text-primary hover:underline" onClick={() => setEditing(i)}>
                  Edit
                </button>
                <button type="button" className="text-[12px] font-semibold text-danger hover:underline" onClick={() => void write('DELETE', `${BASE}/handover/${i.id}`, undefined, 'Removed.')}>
                  Remove
                </button>
              </>
            ) : null}
          </div>
        ))}
        {!h.items.length ? <Empty text="Nothing written yet." /> : null}
      </Panel>
      {c.work && work.length ? (
        <Panel title={`Their open work — ${work.length}`} bodyClassName="flex flex-col gap-1 px-3.5 py-2.5">
          {work.map((w) => (
            <label key={`${w.kind}:${w.id}`} className="flex items-center gap-2 text-[12.5px] text-ink">
              <input type="checkbox" checked={!!picked[`${w.kind}:${w.id}`]} onChange={(e) => setPicked((p) => ({ ...p, [`${w.kind}:${w.id}`]: e.target.checked }))} className="accent-primary" />
              <span className="truncate">
                {w.kindLabel} · {w.label}
                {w.detail ? <span className="text-ink-3"> · {w.detail}</span> : null}
              </span>
            </label>
          ))}
          <div className="mt-1.5 flex gap-2">
            <Select aria-label="Move to" value={to} onChange={(e) => setTo(e.target.value)} className={input}>
              <option value="">Move to…</option>
              {c.work.colleagues.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
            <button type="button" disabled={!to || !chosen.length} className={btn} onClick={() => void move()}>
              Move {chosen.length || ''}
            </button>
          </div>
        </Panel>
      ) : null}
      {c.moved?.length ? (
        <Panel title="Moved already" bodyClassName="flex flex-col gap-0.5 px-3.5 py-2.5 text-[12px] text-ink-2">
          {c.moved.map((m, i) => (
            <span key={i}>
              {m.label ?? m.kind} → {m.to ?? 'someone'}
              {m.by ? ` · ${m.by}` : ''} · {stamp(m.at)}
            </span>
          ))}
        </Panel>
      ) : null}
      {editing ? (
        <HandoverItemSheet
          h={h}
          item={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSave={async (body) => (await (editing === 'new' ? write('POST', `${BASE}/${c.id}/handover`, body, 'Written. Send it when the handover is ready.') : write('PUT', `${BASE}/handover/${editing.id}`, body, 'Saved.'))) && setEditing(null)}
        />
      ) : null}
    </div>
  );
}

function HandoverItemSheet({ h, item, onClose, onSave }: { h: NonNullable<OffCase['handover']>; item: HandoverItem | null; onClose: () => void; onSave: (body: Record<string, unknown>) => Promise<unknown> }) {
  const [section, setSection] = useState(item?.section ?? Object.keys(h.sections)[0] ?? 'notes');
  const [title, setTitle] = useState(item?.title ?? '');
  const [details, setDetails] = useState(item?.details ?? '');
  const [reference, setReference] = useState(item?.reference ?? '');
  const [recipient, setRecipient] = useState(item ? String(item.recipient.id) : '');
  return (
    <Sheet
      title={item ? 'Edit handover item' : 'Add a handover item'}
      onClose={onClose}
      footer={
        <>
          <button type="button" className={btn} onClick={onClose}>
            Cancel
          </button>
          <button type="button" disabled={!title.trim() || !recipient} className={btnPrimary} onClick={() => void onSave({ section, title: title.trim(), details: details.trim() || null, reference: reference.trim() || null, recipient_id: Number(recipient) })}>
            Save
          </button>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-2.5">
        <Field label="What it is">
          <Select aria-label="What it is" value={section} onChange={(e) => setSection(e.target.value)} className={input}>
            {Object.entries(h.sections).map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="To">
          <Select aria-label="To" value={recipient} onChange={(e) => setRecipient(e.target.value)} className={input}>
            <option value="">Choose a colleague…</option>
            {h.colleagues.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <Field label="Title">
        <input aria-label="Title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Garage job cards JC-1180 to JC-1192" className={input} />
      </Field>
      <Field label="Details" hint="Credentials are hidden from everyone but the recipient.">
        <textarea aria-label="Details" value={details} onChange={(e) => setDetails(e.target.value)} className={input + ' !h-[70px] resize-none py-2'} />
      </Field>
      <Field label="Where it is">
        <input aria-label="Where it is" value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Drive › Garage › Job cards" className={input} />
      </Field>
    </Sheet>
  );
}

function AskSheet({ ask, onClose }: { ask: Ask; onClose: () => void }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <Sheet
      title={ask.title}
      width={420}
      onClose={onClose}
      footer={
        <>
          <button type="button" className={btn} onClick={onClose}>
            Cancel
          </button>
          <button type="button" disabled={busy || (ask.required && !text.trim())} className={btnPrimary} onClick={() => (setBusy(true), void ask.run(text.trim()).then((ok) => (ok ? onClose() : setBusy(false))))}>
            {ask.action}
          </button>
        </>
      }
    >
      <Field label={ask.label}>
        <input aria-label={ask.label} value={text} onChange={(e) => setText(e.target.value)} className={input} autoFocus />
      </Field>
    </Sheet>
  );
}

function RecordReturn({ item, onClose, onSave }: { item: OffItem; onClose: () => void; onSave: (condition: string, notes: string) => Promise<unknown> }) {
  const [condition, setCondition] = useState('good');
  const [notes, setNotes] = useState('');
  return (
    <Sheet
      title="Record return"
      width={420}
      onClose={onClose}
      footer={
        <>
          <button type="button" className={btn} onClick={onClose}>
            Cancel
          </button>
          <button type="button" className={btnPrimary} onClick={() => void onSave(condition, notes.trim())}>
            Record return
          </button>
        </>
      }
    >
      <span className="font-semibold text-ink-2">{item.title}</span>
      <Field label="Condition">
        <Select aria-label="Condition" value={condition} onChange={(e) => setCondition(e.target.value)} className={input}>
          {['good', 'fair', 'poor', 'damaged'].map((c) => (
            <option key={c} value={c}>
              {c[0]!.toUpperCase() + c.slice(1)}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Notes">
        <input aria-label="Notes" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Charger missing" className={input} />
      </Field>
    </Sheet>
  );
}

function AddItem({ c, onClose, onSave }: { c: OffCase; onClose: () => void; onSave: (body: Record<string, unknown>) => Promise<unknown> }) {
  const depts = c.departments.filter((d) => d.may_add);
  const [dept, setDept] = useState(depts[0]?.key ?? '');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [due, setDue] = useState('');
  const [mandatory, setMandatory] = useState(true);
  const [evidence, setEvidence] = useState(false);
  return (
    <Sheet
      title="Add an item"
      onClose={onClose}
      footer={
        <>
          <button type="button" className={btn} onClick={onClose}>
            Cancel
          </button>
          <button type="button" disabled={!title.trim() || !dept} className={btnPrimary} onClick={() => void onSave({ dept_key: dept, title: title.trim(), description: description.trim() || null, due_on: due || null, mandatory, evidence_required: evidence })}>
            Add
          </button>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-2.5">
        <Field label="Department">
          <Select aria-label="Department" value={dept} onChange={(e) => setDept(e.target.value)} className={input}>
            {depts.map((d) => (
              <option key={d.key} value={d.key}>
                {d.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Due">
          <input type="date" aria-label="Due" value={due} onChange={(e) => setDue(e.target.value)} className={input} />
        </Field>
      </div>
      <Field label="What has to be done">
        <input aria-label="What has to be done" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Return garage toolkit" className={input} />
      </Field>
      <Field label="Details">
        <input aria-label="Details" value={description} onChange={(e) => setDescription(e.target.value)} className={input} />
      </Field>
      <label className="flex items-center gap-2 text-[12.5px] text-ink">
        <input type="checkbox" checked={mandatory} onChange={(e) => setMandatory(e.target.checked)} className="accent-primary" /> Must be done before sign-off
      </label>
      <label className="flex items-center gap-2 text-[12.5px] text-ink">
        <input type="checkbox" checked={evidence} onChange={(e) => setEvidence(e.target.checked)} className="accent-primary" /> Needs evidence attached
      </label>
    </Sheet>
  );
}
