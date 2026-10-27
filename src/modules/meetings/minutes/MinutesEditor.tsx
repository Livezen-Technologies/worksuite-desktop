import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { ApiError, apiDelete, apiGet, apiPost, apiPut } from '../../../core/api';
import { call, errorMessage, on } from '../../../core/bridge';
import { dateLabel, timeLabel } from '../../../core/time';
import { toast } from '../../../core/toasts';
import { Checkbox } from '../../../components/Checkbox';
import { Select } from '../../../components/Select';
import { Button, Chip, ErrorNote, Modal, Spinner, cx } from '../../../components/ui';
import { AiTextDialog } from '../../ai/AiTextDialog';
import { parseAction, parseMinutes } from '../../ai/textTools';
import { SECTIONS, SECTION_LABEL, type Conflict, type MinutesAccess, type MinutesAction, type MinutesView, type Section } from './api';
import { RichText, cleanHtml, htmlOf, plainText } from './RichText';

/**
 * Notes & Minutes (worksuite-desktop#80) — in the meeting while it is on (Meet's Notes tab) and in the meeting's
 * details after it: the meeting's title, date and people at the top, then Agenda, Discussion, Decisions and Action
 * items.
 *
 * Writing saves itself, section by section, and says so: Saving…, Saved, or Couldn't save with Retry. Several people
 * can write at once without losing each other's words: a section somebody else changed while you typed is not
 * overwritten — the section shows both, to keep both, use theirs or replace it with yours. A section nobody is
 * typing in follows the others' changes as they save them.
 *
 * Generate with AI drafts from what is written, the agenda and the meeting's chat (and transcript, when there is
 * one), into the editor where it can be changed. It never makes up decisions, owners or dates; an action it lists
 * without a person or a date stays without one. Action items become linked tasks only when somebody chooses them.
 */

type SaveState = 'saving' | 'saved' | 'error' | 'conflict';
interface Draft {
  html: string;
  /** The revision this draft was written on. */
  base: number;
}

const SAVE_AFTER = 1200;

export function MinutesEditor({ meetingId, compact, material }: { meetingId: number; compact?: boolean; material?: () => Promise<string> }) {
  const qc = useQueryClient();
  const key = ['meetings', meetingId, 'minutes'];
  const q = useQuery({ queryKey: key, queryFn: ({ signal }) => apiGet<MinutesView>(`/api/meetings/${meetingId}/minutes`, undefined, signal) });
  const [drafts, setDrafts] = useState<Partial<Record<Section, Draft>>>({});
  const [state, setState] = useState<Partial<Record<Section, SaveState>>>({});
  const [conflicts, setConflicts] = useState<Partial<Record<Section, Conflict>>>({});
  const [drafting, setDrafting] = useState<string | null>(null);
  const [gathering, setGathering] = useState(false);
  const [sharing, setSharing] = useState(false);
  const timers = useRef<Partial<Record<Section, ReturnType<typeof setTimeout>>>>({});
  const latest = useRef<Partial<Record<Section, Draft>>>({});

  // Others' saves reach this screen as they happen.
  useEffect(
    () =>
      on<{ type?: string; meeting_id?: number }>('realtime:event', (e) => {
        if (e?.type === 'meeting.minutes' && Number(e.meeting_id) === meetingId) void qc.invalidateQueries({ queryKey: ['meetings', meetingId, 'minutes'] });
      }),
    [qc, meetingId],
  );
  // Leaving with something still to save: save it now.
  useEffect(() => {
    const pending = timers.current;
    const drafted = latest.current;
    return () => {
      for (const s of SECTIONS) {
        if (pending[s]) {
          clearTimeout(pending[s]);
          const d = drafted[s];
          if (d) void apiPut(`/api/meetings/${meetingId}/minutes/sections/${s}`, { html: d.html, base_rev: d.base }).catch(() => undefined);
        }
      }
    };
  }, [meetingId]);

  if (q.isLoading) return <Spinner />;
  if (q.error || !q.data) return <ErrorNote error={q.error} onRetry={() => void q.refetch()} />;
  const v = q.data;
  const final = !!v.finalised_at;
  const editable = v.can.edit && !final;

  const setDraft = (s: Section, d: Draft | null) => {
    if (d) latest.current[s] = d;
    else delete latest.current[s];
    setDrafts((x) => {
      const next = { ...x };
      if (d) next[s] = d;
      else delete next[s];
      return next;
    });
  };
  const mark = (s: Section, st: SaveState | null) =>
    setState((x) => {
      const next = { ...x };
      if (st) next[s] = st;
      else delete next[s];
      return next;
    });

  const save = async (s: Section) => {
    clearTimeout(timers.current[s]);
    delete timers.current[s];
    const d = latest.current[s];
    if (!d) return;
    mark(s, 'saving');
    try {
      const r = await apiPut<{ rev: number; html: string; edited: MinutesView['edited'][Section] }>(`/api/meetings/${meetingId}/minutes/sections/${s}`, { html: cleanHtml(d.html), base_rev: d.base });
      qc.setQueryData<MinutesView>(key, (old) => (old ? { ...old, sections: { ...old.sections, [s]: r.html }, revs: { ...old.revs, [s]: r.rev }, edited: { ...old.edited, [s]: r.edited } } : old));
      const now = latest.current[s];
      // Typed on while it saved: the rest goes on the new revision.
      if (now && now.html !== d.html) setDraft(s, { html: now.html, base: r.rev });
      else setDraft(s, null);
      mark(s, 'saved');
    } catch (e) {
      const c = e instanceof ApiError && e.status === 409 ? (e.data as Conflict | null) : null;
      if (c?.conflict) {
        setConflicts((x) => ({ ...x, [s]: c }));
        mark(s, 'conflict');
      } else mark(s, 'error');
    }
  };

  const change = (s: Section, html: string) => {
    const base = latest.current[s]?.base ?? v.revs[s];
    setDraft(s, { html, base });
    clearTimeout(timers.current[s]);
    timers.current[s] = setTimeout(() => void save(s), SAVE_AFTER);
  };

  /** Put a conflict right: both texts, theirs, or mine over theirs — each a choice somebody makes. */
  const resolve = (s: Section, how: 'both' | 'theirs' | 'mine') => {
    const c = conflicts[s];
    const mine = latest.current[s];
    if (!c) return;
    setConflicts((x) => {
      const next = { ...x };
      delete next[s];
      return next;
    });
    qc.setQueryData<MinutesView>(key, (old) => (old ? { ...old, sections: { ...old.sections, [s]: c.html }, revs: { ...old.revs, [s]: c.rev }, edited: { ...old.edited, [s]: c.edited } } : old));
    if (how === 'theirs' || !mine) {
      setDraft(s, null);
      mark(s, null);
      return;
    }
    setDraft(s, { html: how === 'both' ? `${c.html}${c.html && mine.html ? '<p><em>Also written at the same time:</em></p>' : ''}${mine.html}` : mine.html, base: c.rev });
    void save(s);
  };

  const states = Object.values(state);
  const status = states.includes('conflict')
    ? { text: 'Needs your check', tone: 'text-warning' }
    : states.includes('error')
      ? { text: 'Couldn’t save', tone: 'text-danger' }
      : states.includes('saving') || Object.keys(drafts).length
        ? { text: 'Saving…', tone: 'text-ink-3' }
        : states.includes('saved')
          ? { text: 'Saved', tone: 'text-success' }
          : null;
  const retry = () => SECTIONS.filter((s) => state[s] === 'error').forEach((s) => void save(s));

  const htmlOfSection = (s: Section) => drafts[s]?.html ?? v.sections[s];

  const generate = async () => {
    setGathering(true);
    let extra = '';
    try {
      extra = material ? await material() : '';
    } catch {
      // What is written is still enough to draft from.
    } finally {
      setGathering(false);
    }
    setDrafting(minutesSource(v, htmlOfSection, extra));
  };
  const applyDraft = async (text: string) => {
    const m = parseMinutes(text);
    const put = (s: Section, html: string) => {
      if (!html) return;
      const now = htmlOfSection(s);
      // People's words stay: a section already written gets the draft under it, to keep or cut.
      change(s, now.trim() ? `${now}<p><em>Drafted with AI:</em></p>${html}` : html);
    };
    put('agenda', htmlOf(m.agenda));
    put('discussion', htmlOf(m.summary.split(/\n\s*\n/), false));
    put('decisions', htmlOf(m.decisions));
    const known = new Set(v.actions.map((a) => a.title.trim().toLowerCase()));
    let added = 0;
    for (const line of m.actions) {
      const a = parseAction(line);
      if (!a.title || known.has(a.title.toLowerCase())) continue;
      // An owner only when the draft names somebody on the meeting; otherwise nobody — never a guess.
      const owner = a.owner ? (v.people.find((p) => p.user_id && p.name.trim().toLowerCase() === a.owner!.toLowerCase()) ?? null) : null;
      await apiPost(`/api/meetings/${meetingId}/actions`, { title: a.title.slice(0, 255), assignee_id: owner?.user_id ?? undefined, due_date: a.due ?? undefined, priority: 'normal', status: 'open' }).catch(() => undefined);
      added++;
    }
    if (added) void qc.invalidateQueries({ queryKey: key });
    toast('info', `The draft is in the minutes${added ? ` with ${added} action item${added === 1 ? '' : 's'} to review` : ''}. Check it — it saves as you edit.`);
  };

  const copy = () => void navigator.clipboard.writeText(minutesText(v, htmlOfSection)).then(() => toast('success', 'Minutes copied.'));
  const exportAs = (format: 'pdf' | 'docx') =>
    void call('transfers:download', { minutesExport: { meeting: meetingId, format }, name: `${v.meeting.title.replace(/[\\/:*?"<>|]/g, '-').slice(0, 180)} — minutes.${format}` }).catch((e) => toast('error', errorMessage(e)));

  const finalise = async (reopen: boolean) => {
    for (const s of SECTIONS) if (latest.current[s]) await save(s);
    try {
      const next = await apiPost<MinutesView>(`/api/meetings/${meetingId}/minutes/finalise`, { reopen });
      qc.setQueryData(key, next);
      toast('success', reopen ? 'Minutes reopened for editing.' : 'Minutes finalised.');
    } catch (e) {
      toast('error', errorMessage(e));
    }
  };

  const sections = SECTIONS.map((s) => {
    const c = conflicts[s];
    const ed = v.edited[s];
    return (
      <section key={s} className={cx('flex flex-col gap-1.5', !compact && 'rounded-[12px] border border-line bg-surface p-3')}>
        <div className="flex items-center gap-2">
          <b className="flex-1 text-ink">{SECTION_LABEL[s]}</b>
          {state[s] === 'saving' ? <Chip>Saving</Chip> : state[s] === 'error' ? <Chip tone="danger">Not saved</Chip> : null}
          {ed ? <span className="text-[11px] text-ink-3">Last changed by {ed.name || 'someone'} · {timeLabel(ed.at)}</span> : null}
        </div>
        {c ? (
          <div role="alert" className="flex flex-col gap-1.5 rounded-[9px] border border-warning-line bg-warning-bg p-2.5 text-[12.5px] dark:bg-warning-bg">
            <span className="font-semibold text-warning-strong dark:text-warning">
              {c.edited?.name ?? 'Somebody'} changed {SECTION_LABEL[s]} meanwhile. Nothing has been overwritten.
            </span>
            <div className="flex flex-wrap gap-1.5">
              <Button size="sm" variant="primary" onClick={() => resolve(s, 'both')}>
                Keep both
              </Button>
              <Button size="sm" onClick={() => resolve(s, 'theirs')}>
                Use theirs
              </Button>
              <Button size="sm" onClick={() => resolve(s, 'mine')}>
                Replace with mine
              </Button>
            </div>
          </div>
        ) : null}
        <RichText label={SECTION_LABEL[s]} value={htmlOfSection(s)} disabled={!editable} onChange={(html) => change(s, html)} placeholder={editable ? PLACEHOLDER[s] : 'Nothing written.'} />
      </section>
    );
  });
  const side = (
    <>
      {editable && !compact ? (
        <section className="flex flex-col gap-1.5 rounded-[12px] border border-line bg-surface p-3 text-[12.5px]">
          <div className="flex items-center gap-2">
            <b className="flex-1 text-ink">AI draft</b>
            <Chip tone="indigo">Preview first</Chip>
          </div>
          <span className="text-ink-2">From the agenda, what is written, the chat and the transcript. It never invents decisions, owners or dates.</span>
          <Button size="sm" icon="sparkles" loading={gathering} onClick={() => void generate()} className="self-start">
            Draft the minutes
          </Button>
        </section>
      ) : null}
      <div className={cx(!compact && 'rounded-[12px] border border-line bg-surface p-3')}>
        <ActionItems v={v} editable={editable} />
      </div>
      {v.can.manage ? (
        <div className={cx(!compact && 'rounded-[12px] border border-line bg-surface p-3')}>
          <AccessSettings meetingId={meetingId} access={v.access} />
        </div>
      ) : null}
    </>
  );

  return (
    <div className={cx('flex flex-col gap-3 text-[13px]', compact && 'p-3.5')}>
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex min-w-0 flex-1 flex-col">
          <h2 className="truncate text-[15px] font-bold text-ink">{v.meeting.title}</h2>
          <span className="text-[12px] text-ink-3">{v.meeting.when || `${dateLabel(v.meeting.start_at)} ${timeLabel(v.meeting.start_at)}`}</span>
        </div>
      </div>
      <p className="text-[12px] text-ink-2">
        <b className="text-ink">Participants:</b> {v.people.map((p) => p.name).filter(Boolean).join(', ') || '—'}
      </p>
      <div className="flex flex-wrap items-center gap-1.5">
        {final ? <Chip tone="success">Final · {dateLabel(v.finalised_at!)}</Chip> : <Chip tone="warning">Draft</Chip>}
        {status ? (
          <span className={cx('text-[12px] font-semibold', status.tone)} role="status" aria-live="polite">
            {status.text}
            {status.text === 'Couldn’t save' ? (
              <button type="button" onClick={retry} className="ml-1.5 text-primary underline">
                Retry
              </button>
            ) : null}
          </span>
        ) : null}
        <span className="flex-1" />
        {editable ? (
          <Button size="sm" icon="sparkles" loading={gathering} onClick={() => void generate()} title="Draft from what is written, the agenda and the meeting's chat or transcript">
            Generate with AI
          </Button>
        ) : null}
        <Button size="sm" icon="copy" onClick={copy}>
          Copy
        </Button>
        <span className="ml-1 text-[11.5px] text-ink-3">Export</span>
        <Button size="sm" icon="download" onClick={() => exportAs('pdf')}>
          PDF
        </Button>
        <Button size="sm" icon="download" onClick={() => exportAs('docx')}>
          Word
        </Button>
        {v.can.manage ? (
          final ? (
            <>
              <Button size="sm" onClick={() => void finalise(true)}>
                Reopen
              </Button>
              <Button size="sm" variant="primary" icon="send" onClick={() => setSharing(true)}>
                Share…
              </Button>
            </>
          ) : (
            <Button size="sm" variant="primary" onClick={() => void finalise(false)}>
              Finalise
            </Button>
          )
        ) : null}
      </div>
      {!v.can.edit ? <p className="rounded-[9px] bg-subtle px-2.5 py-2 text-[12.5px] text-ink-2">You can read these minutes. The organiser decides who edits them.</p> : null}
      {final && v.can.edit ? <p className="rounded-[9px] bg-subtle px-2.5 py-2 text-[12.5px] text-ink-2">These minutes are final.{v.can.manage ? ' Reopen them to change anything.' : ''}</p> : null}

      {compact ? (
        <>
          {sections}
          {side}
        </>
      ) : (
        // D03: the sections, and beside them the AI draft, the action items and who may see and edit.
        <div className="flex items-start gap-4">
          <div className="flex min-w-0 flex-[2] flex-col gap-3">{sections}</div>
          <aside className="flex min-w-0 flex-1 flex-col gap-3">{side}</aside>
        </div>
      )}

      {drafting !== null ? (
        <AiTextDialog title="Generate minutes" task="minutes" input={() => drafting} actions={[{ label: 'Use in the minutes', primary: true, run: (t) => applyDraft(t) }]} onClose={() => setDrafting(null)} />
      ) : null}
      {sharing ? <ShareMinutesDialog v={v} onClose={() => setSharing(false)} /> : null}
    </div>
  );
}

const PLACEHOLDER: Record<Section, string> = {
  agenda: 'What the meeting covers…',
  discussion: 'Points raised, as the meeting goes…',
  decisions: 'What was agreed…',
};

/** Everything the minutes are drafted from. */
export function minutesSource(v: MinutesView, html: (s: Section) => string, extra: string): string {
  return [
    `Meeting: ${v.meeting.title}`,
    `When: ${v.meeting.when}`,
    `People: ${v.people.map((p) => p.name).filter(Boolean).join(', ')}`,
    ...SECTIONS.map((s) => (plainText(html(s)) ? `${SECTION_LABEL[s]} so far:\n${plainText(html(s))}` : '')),
    v.actions.length ? `Action items so far:\n${v.actions.map((a) => `- ${a.title}${a.assignee ? ` | ${a.assignee}` : ''}${a.due_date ? ` | ${a.due_date}` : ''}`).join('\n')}` : '',
    extra,
  ]
    .filter(Boolean)
    .join('\n\n');
}

/** The minutes as text, for the clipboard. */
export function minutesText(v: MinutesView, html: (s: Section) => string): string {
  return [
    v.meeting.title,
    v.meeting.when,
    `Participants: ${v.people.map((p) => p.name).filter(Boolean).join(', ')}`,
    ...SECTIONS.map((s) => (plainText(html(s)) ? `${SECTION_LABEL[s].toUpperCase()}\n${plainText(html(s))}` : '')),
    v.actions.length ? `ACTION ITEMS\n${v.actions.map((a) => `- ${a.title}${a.assignee ? ` — ${a.assignee}` : ''}${a.due_date ? ` — due ${a.due_date}` : ''}`).join('\n')}` : '',
  ]
    .filter(Boolean)
    .join('\n\n');
}

function ActionItems({ v, editable }: { v: MinutesView; editable: boolean }) {
  const qc = useQueryClient();
  const id = v.meeting.id;
  const [title, setTitle] = useState('');
  const [picked, setPicked] = useState<number[]>([]);
  const [busy, setBusy] = useState(false);
  const refresh = () => void qc.invalidateQueries({ queryKey: ['meetings', id, 'minutes'] });
  const people = v.people.filter((p) => p.user_id);
  const update = async (a: MinutesAction, patch: Partial<MinutesAction>) => {
    const next = { ...a, ...patch };
    try {
      await apiPut(`/api/meetings/${id}/actions/${a.id}`, { title: next.title, detail: next.detail, assignee_id: next.assignee_id, due_date: next.due_date, priority: next.priority, status: next.status });
    } catch (e) {
      toast('error', errorMessage(e));
    }
    refresh();
  };
  const tasks = async () => {
    setBusy(true);
    let made = 0;
    for (const actionId of picked) {
      try {
        await apiPost(`/api/meetings/${id}/actions/${actionId}/task`);
        made++;
      } catch (e) {
        toast('error', errorMessage(e));
      }
    }
    setBusy(false);
    setPicked([]);
    if (made) toast('success', `${made} task${made === 1 ? '' : 's'} created, linked to this meeting.`);
    refresh();
  };
  return (
    <section className="flex flex-col gap-1.5">
      <b className="text-ink">Action items</b>
      {!v.actions.length ? <p className="text-ink-3">No action items yet.</p> : null}
      {v.actions.map((a) => (
        <div key={a.id} className="flex flex-wrap items-center gap-2 rounded-[9px] border border-line px-2.5 py-1.5">
          <Checkbox aria-label={`Reviewed: ${a.title}`} disabled={!editable || !!a.task_id} checked={!!a.task_id || picked.includes(a.id)} onChange={() => setPicked(picked.includes(a.id) ? picked.filter((x) => x !== a.id) : [...picked, a.id])} />
          <span className={cx('min-w-0 flex-1 text-ink', a.status === 'done' && 'line-through opacity-60')}>{a.title}</span>
          <Select<string>
            aria-label={`Owner of ${a.title}`}
            disabled={!editable}
            value={a.assignee_id ? String(a.assignee_id) : ''}
            options={[{ value: '', label: 'No owner yet' }, ...people.map((p) => ({ value: String(p.user_id), label: p.name }))]}
            onValueChange={(x) => void update(a, { assignee_id: x ? Number(x) : null })}
            className="h-8 w-40 rounded-[7px] border border-line bg-surface px-2 text-[12px] text-ink"
          />
          <input type="date" aria-label={`Due date of ${a.title}`} disabled={!editable} value={a.due_date ?? ''} onChange={(e) => void update(a, { due_date: e.target.value || null })} className="h-8 rounded-[7px] border border-line bg-surface px-2 text-[12px] text-ink" />
          {a.task_id ? <Chip tone="success">Task made</Chip> : null}
          {editable && !a.task_id ? (
            <button type="button" aria-label={`Remove ${a.title}`} onClick={() => void apiDelete(`/api/meetings/${id}/actions/${a.id}`).then(refresh, (e) => toast('error', errorMessage(e)))} className="text-ink-3 hover:text-danger">
              ×
            </button>
          ) : null}
        </div>
      ))}
      {editable ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const t = title.trim();
            if (!t) return;
            setTitle('');
            void apiPost(`/api/meetings/${id}/actions`, { title: t.slice(0, 255), priority: 'normal', status: 'open' }).then(refresh, (err) => toast('error', errorMessage(err)));
          }}
        >
          <input value={title} onChange={(e) => setTitle(e.target.value)} aria-label="Add an action item" placeholder="Add an action item, then press Enter" className="h-9 w-full rounded-[8px] border border-dashed border-line bg-surface px-2.5 text-ink outline-none focus:border-primary" />
        </form>
      ) : null}
      {editable && v.actions.some((a) => !a.task_id) ? (
        <div className="flex items-center gap-2">
          <span className="text-[12px] text-ink-3">Tick the items you have reviewed, then make them tasks.</span>
          <span className="flex-1" />
          <Button size="sm" loading={busy} disabled={!picked.length} onClick={() => void tasks()}>
            Create {picked.length || ''} linked task{picked.length === 1 ? '' : 's'}
          </Button>
        </div>
      ) : null}
    </section>
  );
}

function AccessSettings({ meetingId, access }: { meetingId: number; access: MinutesAccess }) {
  const qc = useQueryClient();
  const save = async (patch: Partial<MinutesAccess>) => {
    try {
      await apiPut(`/api/meetings/${meetingId}/minutes/access`, patch);
      void qc.invalidateQueries({ queryKey: ['meetings', meetingId, 'minutes'] });
      toast('success', 'Saved.');
    } catch (e) {
      toast('error', errorMessage(e));
    }
  };
  const field = 'h-9 rounded-[8px] border border-line bg-surface px-2 text-[12.5px] text-ink';
  return (
    <section className="flex flex-col gap-2.5">
      <label className="flex flex-col gap-1 text-[12.5px] font-semibold text-ink">
        Who can see the minutes
        <Select<MinutesAccess['view']>
          value={access.view}
          options={[
            { value: 'participants', label: 'Everyone in the meeting' },
            { value: 'editors', label: 'Only the people who can edit' },
          ]}
          onValueChange={(view) => void save({ view })}
          className={field}
        />
      </label>
      <label className="flex flex-col gap-1 text-[12.5px] font-semibold text-ink">
        Who can edit them
        <Select<MinutesAccess['edit']>
          value={access.edit}
          options={[
            { value: 'hosts', label: 'Organiser and host' },
            { value: 'chosen', label: 'People given “Edit minutes”' },
            { value: 'participants', label: 'Everyone in the meeting' },
          ]}
          onValueChange={(edit) => void save({ edit })}
          className={field}
        />
      </label>
    </section>
  );
}

/** Share the final minutes with the people chosen — nobody is sent them without being chosen. */
function ShareMinutesDialog({ v, onClose }: { v: MinutesView; onClose: () => void }) {
  const qc = useQueryClient();
  const [picked, setPicked] = useState<number[]>([]);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const all = v.people.filter((p) => p.email);
  const send = async () => {
    setBusy(true);
    try {
      const r = await apiPost<{ email: number; inapp: number }>(`/api/meetings/${v.meeting.id}/minutes/share`, { participant_ids: picked, note: note.trim() || undefined });
      toast('success', `Minutes shared with ${picked.length} ${picked.length === 1 ? 'person' : 'people'}${r?.email ? ` · ${r.email} email${r.email === 1 ? '' : 's'}` : ''}.`);
      void qc.invalidateQueries({ queryKey: ['meetings', v.meeting.id, 'minutes'] });
      onClose();
    } catch (e) {
      toast('error', errorMessage(e));
      setBusy(false);
    }
  };
  return (
    <Modal
      title="Share the minutes"
      onClose={onClose}
      width={460}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={busy} disabled={!picked.length} onClick={() => void send()}>
            Share with {picked.length || 'nobody yet'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-2 text-[13px]">
        <label className="flex items-center gap-2 font-semibold text-ink">
          <Checkbox checked={picked.length === all.length && all.length > 0} indeterminate={picked.length > 0 && picked.length < all.length} onChange={() => setPicked(picked.length === all.length ? [] : all.map((p) => p.id))} />
          Everyone in the meeting
        </label>
        <div className="flex max-h-[38vh] flex-col gap-1 overflow-y-auto scroll-thin">
          {all.map((p) => (
            <label key={p.id} className="flex items-center gap-2 rounded-[7px] px-1 py-1 hover:bg-subtle">
              <Checkbox checked={picked.includes(p.id)} onChange={() => setPicked(picked.includes(p.id) ? picked.filter((x) => x !== p.id) : [...picked, p.id])} />
              <span className="flex-1 text-ink">{p.name}</span>
              <span className="text-[11.5px] text-ink-3">{p.email}</span>
            </label>
          ))}
        </div>
        <label className="flex flex-col gap-1 font-semibold text-ink">
          Message <span className="font-normal text-ink-3">Optional, above the minutes.</span>
          <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} className="rounded-[8px] border border-line bg-surface px-2.5 py-2 font-normal text-ink outline-none focus:border-primary" />
        </label>
        {v.shared_at ? <p className="text-[12px] text-ink-3">Last shared {dateLabel(v.shared_at)}.</p> : null}
      </div>
    </Modal>
  );
}
