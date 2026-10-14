import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { TASK_STATUS_LABEL, type ProjectsOutboxItem } from '@shared/projects';
import { app } from '../../core/app-state';
import { ApiError, apiGetMeta, apiPost, apiPut } from '../../core/api';
import { call, errorMessage, isMac } from '../../core/bridge';
import { useStore } from '../../core/store';
import { openRouteInWindow } from '../../core/tab-context';
import { toast } from '../../core/toasts';
import { Icon } from '../../components/Icon';
import { Select } from '../../components/Select';
import { Button, IconButton, Modal, cx } from '../../components/ui';
import { patchTask } from '../tasks/actions';
import { Attachments, Checklist, Conversation, Description, LockReason, Progress, Row, TaskEditorFrame, Tags, Title, When, aside, inputsOf, useSaving, type SendComment } from '../tasks/editor';
import { PeoplePanel, ReviewPanel, usePeople } from '../tasks/People';
import { TaskReminders } from '../tasks/Reminders';
import { API, qk, read, write, type TaskListResponse, type TaskStatus } from './api';
import { dqk, dread } from './delivery';
import { setTimerState, submit, useProjectTimer } from './desk';
import { LogTime } from './Dialogs';
import { ReasonDialog } from './TaskList';
import { Dependencies, GroupHead, MemberPick, PickDialog, ProjectFields, TaskTime } from './TaskModalParts';
import { NEEDS_CONNECTION, TYPE_LABEL, access as accessOf, fromProjectsRead, fromTasksRead, pendingFor, projectRouter, stepTask, taskLink, tasksStatusOf, useTaskOrder, type EditorData, type StatusValue } from './task-editor';
import { tk, treads } from './templates';

/**
 * A project task in the Tasks app's editor (Projects SRS v1.2 PRJ-TED-01..10, §14.2, WF-18, D06): a centred modal
 * over the board, the list, My work, Time, Milestones or a notification's link, in place of the old side panel.
 *
 * The frame and the parts are the Tasks app's (tasks/editor); this composition adds the project's own: Dependencies
 * and Time in the main column, the Project group in the side panel, the project's status vocabulary with a reason
 * for Blocked, and Complete/Reopen as completed / to do. Each change goes to the endpoint that owns its rule
 * (`projectRouter`); what the reader may not change is shown read-only with the reason. Offline it opens from the
 * copy kept on this computer: the status, a comment and logged time go to the outbox, the rest says it needs a
 * connection. J/K walk the tasks of the view behind without closing.
 */
export function ProjectTaskModal({ id, offline: appOffline, outbox, onClose, onOpen, onMoved }: {
  id: number;
  offline: boolean;
  outbox: ProjectsOutboxItem[];
  onClose: () => void;
  /** Another task over the same view (J/K, Duplicate); with its project when it moved (Move to another project). */
  onOpen: (id: number, projectId?: number | null) => void;
  /** Something changed that the views behind count (a move, a deletion). */
  onMoved: () => void;
}) {
  const qc = useQueryClient();
  const me = Number(useStore(app, (s) => s.auth?.user?.id) ?? 0);
  const origin = useStore(app, (s) => s.auth?.server?.origin ?? '');
  const q = useQuery({
    queryKey: ['projects', 'task-editor', id],
    queryFn: ({ signal }) => readEditor(id, me, signal),
    retry: (n, e) => !(e instanceof ApiError && (e.status === 404 || e.status === 403)) && n < 1,
  });
  const data = q.data?.data ?? null;
  const offline = appOffline || !!q.data?.offline;
  const pid = data?.project.id ?? 0;
  const hasOptions = !!data?.project.options;
  const detail = useQuery({ queryKey: qk.detail(pid), queryFn: ({ signal }) => read.detail(pid, { signal }), enabled: !!pid && !hasOptions, staleTime: 60_000 });
  const tasks = useQuery({ queryKey: qk.tasks(pid), queryFn: ({ signal }) => read.tasks(pid, { signal }), enabled: !!pid, staleTime: 30_000 });
  const milestoneParams = { status: 'all', project_id: pid };
  const milestones = useQuery({ queryKey: dqk.milestones(milestoneParams), queryFn: ({ signal }) => dread.milestones(milestoneParams, { signal }), enabled: !!pid && !offline && !hasOptions, staleTime: 60_000 });
  const people = usePeople(id);
  const timer = useProjectTimer();
  const order = useTaskOrder();
  const [menu, setMenu] = useState(false);
  const [ask, setAsk] = useState<null | 'blocked' | 'log' | 'delete' | 'parent' | 'move' | 'template'>(null);
  const [emoji, setEmoji] = useState(false);

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['projects', 'task-editor', id] });
    if (pid) void qc.invalidateQueries({ queryKey: qk.tasks(pid) });
    void qc.invalidateQueries({ queryKey: qk.myWork });
    // The Tasks app shows the same task.
    void qc.invalidateQueries({ queryKey: ['tasks'] });
  };
  const saver = useSaving(refresh);
  const pending = pendingFor(outbox, id);
  const status: TaskStatus = pending.status ?? data?.project.status ?? 'todo';
  const can = (field: string) => (data ? accessOf(data, field, offline) : { ok: false, reason: null });
  const number = data?.project.task_number ?? `#${id}`;
  const mine = timer.running?.taskId === id;
  const link = data ? taskLink(origin, pid, id) : '';

  const save = (field: string, value: unknown, label: string) => {
    if (!data) return Promise.resolve(false);
    const router = projectRouter({ id, number: data.project.task_number, title: data.task.title, updatedAt: data.project.updated_at }, data.source);
    return saver.run(() => patchTask(data.task, field, value, label, router));
  };
  /** A status change: Blocked asks why first (PRJ-TED-05); the card moves on the board at once. */
  const setStatus = async (next: TaskStatus, reason?: string) => {
    if (!data || next === status) return;
    if (next === 'blocked' && reason === undefined) return setAsk('blocked');
    const value: StatusValue = next === 'blocked' ? { status: next, blocked_reason: reason ?? null } : next;
    if (pid)
      qc.setQueryData(qk.tasks(pid), (old: { data: TaskListResponse } | undefined) =>
        old ? { ...old, data: { ...old.data, tasks: old.data.tasks.map((x) => (x.id === id ? { ...x, status: next, ...(reason ? { blocked_reason: reason } : {}) } : x)) } } : old,
      );
    const ok = await save('status', value, `${next === 'completed' ? 'Complete' : next === 'todo' && status === 'completed' ? 'Reopen' : 'Status of'} “${data.task.title}”`);
    if (ok) onMoved();
  };
  // Complete / Reopen: completed and to do — never the Tasks app's done (PRJ-TED-05).
  const done = status === 'completed' || status === 'cancelled';
  const complete = () => void setStatus(done ? 'todo' : 'completed');

  const copyLink = () => {
    if (!link) return;
    void navigator.clipboard?.writeText(link).then(() => toast('success', 'Link copied.'), () => toast('error', 'The link could not be copied.'));
  };
  const ownWindow = () => pid && openRouteInWindow(`/projects/${pid}/tasks/${id}`, `${number} · ${data?.task.title ?? 'Task'}`);
  const timerToggle = async () => {
    if (!data) return;
    if (!mine && offline) return toast('info', `Starting a timer: ${NEEDS_CONNECTION.toLowerCase()}.`);
    try {
      setTimerState(mine ? await call('projects:timerStop', {}) : timer.running ? await call('projects:timerSwitch', { taskId: id, projectId: pid || null }) : await call('projects:timerStart', { taskId: id, projectId: pid || null }));
    } catch (e) {
      toast('error', errorMessage(e));
    }
  };
  const step = (dir: 1 | -1) => {
    const next = stepTask(order, id, dir);
    if (next) onOpen(next);
  };

  // The modal's keys (PRJ-TED-09), while no dialog of its own is over it. Esc is the frame's.
  const onKey = (e: KeyboardEvent) => {
    if (document.querySelector('[role="dialog"][aria-modal="true"]')) return;
    const target = e.target as HTMLElement | null;
    const typing = !!target && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName));
    const mod = isMac ? e.metaKey : e.ctrlKey;
    const take = () => {
      e.preventDefault();
      e.stopImmediatePropagation();
    };
    if (mod && !e.altKey && !e.shiftKey && e.code === 'KeyL') return (take(), copyLink());
    if (mod && e.altKey && !e.shiftKey && e.code === 'KeyO') return (take(), ownWindow());
    if (mod && !e.altKey && e.key === 'Enter' && !typing) return can('status').ok ? (take(), complete()) : undefined;
    if (typing || mod || e.altKey) return;
    const k = e.key.toLowerCase();
    if (k === 't') return (take(), void timerToggle());
    if (k === 'l') return (take(), setAsk('log'));
    if (k === 'j') return (take(), step(1));
    if (k === 'k') return (take(), step(-1));
  };
  const keys = useRef(onKey);
  useEffect(() => {
    keys.current = onKey;
  });
  useEffect(() => {
    const listen = (e: KeyboardEvent) => keys.current(e);
    window.addEventListener('keydown', listen, true);
    return () => window.removeEventListener('keydown', listen, true);
  }, []);

  // A comment: the Tasks app's own (mentions, files) while online; the outbox's offline, or on an older server.
  const sendComment: SendComment | undefined =
    offline || data?.source === 'projects'
      ? async (html) => {
          const r = await submit({ kind: 'comment', taskId: id, body: html.slice(0, 10_000), label: `Comment on ${number}` });
          if (r.error && !r.queued) throw new Error(r.error);
          if (r.queued) toast('info', 'Offline — the comment is kept and sent when you reconnect.');
          return { commentId: (r.data as { id?: number } | null)?.id ?? null, queued: r.queued };
        }
      : undefined;

  const t = data?.task ?? null;
  const p = data?.project ?? null;
  // The pickers' choices: those the server sent with the task (Project 2.5), else the project's own reads.
  const members = p?.options?.members ?? detail.data?.data.members ?? [];
  const sprintChoices = p?.options?.sprints ?? detail.data?.data.sprints ?? [];
  const milestoneChoices = p?.options?.milestones ?? milestones.data?.data.milestones ?? [];
  const projectTasks = tasks.data?.data.tasks ?? [];
  const menuItem = (label: string, run: () => void, opts: { danger?: boolean; needs?: string } = {}) => {
    const off = offline ? NEEDS_CONNECTION : opts.needs && !can(opts.needs).ok ? 'You may not do this on this task' : null;
    return (
      <button key={label} type="button" role="menuitem" disabled={!!off} title={off ?? undefined} className={cx('block w-full px-3 py-1.5 text-left enabled:hover:bg-subtle disabled:text-ink-3', opts.danger && 'text-danger')} onClick={() => (setMenu(false), run())}>
        {label}
      </button>
    );
  };

  return (
    <LockReason.Provider value={offline ? NEEDS_CONNECTION : null}>
      <TaskEditorFrame
        label="Project task"
        maxWidth={1180}
        crumb={
          <>
            <span className="truncate text-ink-3">{p ? `${[p.code, p.name].filter(Boolean).join(' · ')} ›` : 'Projects ›'}</span>
            <span className="shrink-0 font-mono text-[12px] text-ink-3">{number}</span>
            {p ? <span className={cx('shrink-0 rounded-[5px] px-1.5 py-px text-[11px] font-bold', p.task_type === 'bug' ? 'bg-danger-bg text-danger' : 'bg-subtle text-ink-2')}>{TYPE_LABEL[p.task_type]}</span> : null}
          </>
        }
        saving={t ? saver.saving : null}
        saved={saver.saved}
        loading={q.isLoading}
        error={q.error}
        onRetry={() => void q.refetch()}
        onClose={onClose}
        banner={
          offline || pending.waiting.length || pending.choices.length ? (
            <div role="status" className="flex shrink-0 flex-col gap-0.5 border-b border-warning/30 bg-warning-bg px-5 py-2 text-[12.5px] text-warning-ink">
              {offline ? (
                <span className="flex items-center gap-2">
                  <Icon name="cloud-off" size={14} className="shrink-0" />
                  <span>
                    <b>Offline — from the copy kept on this computer.</b> Status, comments and logged time are kept and sent when you reconnect; everything else needs a connection.
                  </span>
                </span>
              ) : null}
              {pending.waiting.map((w, i) => (
                <span key={`w${i}`}>Waiting to send: {w}</span>
              ))}
              {pending.choices.map((c) => (
                <span key={c.id} className="font-semibold text-danger">
                  Needs your choice: {c.label}
                  {c.message ? ` — ${c.message}` : ''} <span className="font-normal">(in the outbox)</span>
                </span>
              ))}
            </div>
          ) : null
        }
        actions={
          <>
            <Button size="sm" aria-keyshortcuts={isMac ? 'Meta+L' : 'Control+L'} disabled={!t} onClick={copyLink}>
              Copy link
            </Button>
            <IconButton icon="app-window" label={`Open in a window of its own (${isMac ? '⌥⌘O' : 'Ctrl+Alt+O'})`} disabled={!t} size={15} onClick={() => ownWindow()} className="h-8 w-8" />
            {t ? (
              <span className="relative">
                <Button size="sm" aria-label="More actions" aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu(!menu)}>
                  ⋯
                </Button>
                {menu ? (
                  <div role="menu" className="absolute top-9 right-0 z-30 w-56 rounded-[10px] border border-line bg-surface py-1 shadow-xl" onMouseLeave={() => setMenu(false)}>
                    {menuItem('Duplicate', () => void duplicate(), { needs: 'task_type' })}
                    {menuItem('Convert to sub-task of…', () => setAsk('parent'), { needs: 'parent_id' })}
                    {menuItem('Move to another project…', () => setAsk('move'), { needs: 'task_type' })}
                    {menuItem('Save as template task', () => setAsk('template'))}
                    {menuItem('Archive', () => void archive(), { needs: 'task_type' })}
                    {menuItem('Delete…', () => setAsk('delete'), { danger: true, needs: 'task_type' })}
                  </div>
                ) : null}
              </span>
            ) : null}
            {t ? (
              done ? (
                <Button size="sm" disabled={!can('status').ok} title={can('status').reason ?? undefined} onClick={complete}>
                  Reopen
                </Button>
              ) : (
                <button type="button" disabled={!can('status').ok} title={can('status').reason ?? `Complete (${isMac ? '⌘↩' : 'Ctrl+Enter'})`} onClick={complete} className="h-8 rounded-[7px] bg-success px-3 font-bold text-white enabled:hover:opacity-90 disabled:opacity-50">
                  Complete
                </button>
              )
            ) : null}
          </>
        }
        main={
          t && p && data ? (
            <>
              <Title key={`t${t.id}`} value={t.title} editable={can('title').ok} onSave={(v) => void save('title', v, `Rename to “${v}”`)} />
              <Description key={`d${t.id}${t.updated_at}`} task={t} editable={can('description').ok} onSave={(html) => void save('description', html, `Describe “${t.title}”`)} />
              <Checklist task={t} editable={can('checklist').ok} onChanged={refresh} />
              <Dependencies data={data} tasks={projectTasks} access={can('dependencies')} onChanged={refresh} />
              <TaskTime data={data} running={mine} startedAt={mine ? (timer.running?.startedAt ?? null) : null} offline={offline} onTimer={() => void timerToggle()} onLog={() => setAsk('log')} />
              <Attachments task={t} editable={can('description').ok} />
              <Conversation task={t} me={me} people={people.data} emoji={emoji} setEmoji={setEmoji} onChanged={refresh} send={sendComment} mayComment={data.fields.comment ?? true} attach={!offline} />
            </>
          ) : null
        }
        side={
          t && p && data ? (
            <>
              <Row label="Status">
                <Select aria-label="Status" disabled={!can('status').ok} title={can('status').reason ?? undefined} value={status} onChange={(e) => void setStatus(e.target.value as TaskStatus)} className={aside}>
                  {(p.statuses.some((s) => s.id === status) ? p.statuses : [...p.statuses, { id: status, label: TASK_STATUS_LABEL[status] }]).map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.label}
                    </option>
                  ))}
                </Select>
              </Row>
              <Row label="Priority">
                <Select aria-label="Priority" disabled={!can('priority').ok} title={can('priority').reason ?? undefined} value={p.priority} onChange={(e) => void save('priority', e.target.value, `Priority of “${t.title}”`)} className={aside}>
                  {(p.priorities.some((x) => x.id === p.priority) ? p.priorities : [...p.priorities, { id: p.priority, label: p.priority }]).map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.label}
                    </option>
                  ))}
                </Select>
              </Row>
              <Row label="Assignee">
                <MemberPick label="Assignee" value={p.assignee_id} name={p.assignee} members={members} access={can('assignee_id')} onPick={(v) => void save('assignee_id', v, `Assign “${t.title}”`)} />
              </Row>
              <Row label="Reviewer">
                <MemberPick label="Reviewer" value={p.reviewer_id} name={p.reviewer} members={members} access={can('reviewer_id')} onPick={(v) => void save('reviewer_id', v, `Reviewer of “${t.title}”`)} />
              </Row>
              <Row label="Start">
                <When key={`s${t.start_at}${t.start_date}`} value={inputsOf(t.start_date, t.start_at)} disabled={!can('start_date').ok} label="Start" onChange={(v) => void save('start_date', v, `Start of “${t.title}”`)} />
              </Row>
              <Row label="Due">
                <When key={`u${t.due_at}${t.due_date}`} value={inputsOf(t.due_date, t.due_at)} disabled={!can('due_date').ok} label="Due" onChange={(v) => void save('due_date', v, `Due date of “${t.title}”`)} />
              </Row>
              <fieldset disabled={offline} title={offline ? NEEDS_CONNECTION : undefined} className="contents">
                <TaskReminders task={t} />
              </fieldset>
              <ProjectFields data={data} status={status} sprints={sprintChoices} milestones={milestoneChoices} tasks={projectTasks} access={can} save={(f, v, l) => void save(f, v, l)} />
              <GroupHead>More</GroupHead>
              <Row label="Tags">
                <Tags key={`g${t.tags.join()}`} value={t.tags} disabled={!can('tags').ok} onChange={(v) => void save('tags', v, `Tags of “${t.title}”`)} />
              </Row>
              <Progress task={{ ...t, status: tasksStatusOf(status) }} editable={can('progress').ok} onSave={(v) => void save('progress', v, `Progress of “${t.title}”`)} />
              <Row label="Company">
                <span className="min-w-0 truncate text-[12.5px] text-ink-2" title="From the project">
                  {p.company ? `${p.company} (from project)` : '—'}
                </span>
              </Row>
              <fieldset disabled={offline} title={offline ? NEEDS_CONNECTION : undefined} className="contents">
                <PeoplePanel task={t} me={me} people={people.data} refresh={() => (void people.refetch(), refresh())} />
                <ReviewPanel task={t} me={me} people={people.data} refresh={() => (void people.refetch(), refresh())} />
              </fieldset>
            </>
          ) : null
        }
      >
        {ask === 'blocked' && t ? (
          <ReasonDialog title={`Why is ${number} blocked?`} required initial={p?.blocked_reason ?? ''} onClose={() => setAsk(null)} onDone={(r) => (setAsk(null), void setStatus('blocked', r))} />
        ) : null}
        {ask === 'log' && t && p ? <LogTime task={{ id, task_number: p.task_number, title: t.title, project_id: pid || null, is_billable: p.is_billable }} project={pid ? { id: pid, code: p.code } : null} onClose={() => (setAsk(null), refresh())} /> : null}
        {ask === 'parent' && t ? (
          <PickDialog
            title={`Make ${number} a sub-task of…`}
            label="Parent task"
            confirm="Convert"
            options={projectTasks.filter((x) => x.id !== id).map((x) => ({ value: x.id, label: `${x.task_number ?? `#${x.id}`} · ${x.title}` }))}
            onPick={async (parent) => {
              // The server refuses a parent that would make a loop, naming the tasks; the dialog says so.
              await apiPut(`${API}/tasks/${id}`, { parent_id: parent });
              setAsk(null);
              toast('success', `${number} is a sub-task now.`);
              refresh();
            }}
            onClose={() => setAsk(null)}
          />
        ) : null}
        {ask === 'template' && t ? <TemplateDialog taskId={id} number={number} onClose={() => setAsk(null)} /> : null}
        {ask === 'move' && t ? <MoveDialog taskId={id} number={number} projectId={pid} onClose={() => setAsk(null)} onMoved={(to) => (setAsk(null), refresh(), onMoved(), onOpen(id, to))} /> : null}
        {ask === 'delete' && t ? (
          <Modal
            title={`Delete ${number}?`}
            onClose={() => setAsk(null)}
            width={420}
            footer={
              <>
                <Button onClick={() => setAsk(null)}>Keep it</Button>
                <Button variant="danger" onClick={() => void write.deleteTask(id).then(() => (toast('success', `${number} deleted.`), refresh(), onMoved(), onClose()), (e) => toast('error', errorMessage(e)))}>
                  Delete
                </Button>
              </>
            }
          >
            <p className="text-[13px] text-ink-2">“{t.title}” goes from the project for everybody, with its checklist and comments.</p>
          </Modal>
        ) : null}
      </TaskEditorFrame>
    </LockReason.Provider>
  );

  async function duplicate() {
    if (!t || !p || !pid) return;
    try {
      // The server's copy (Project 2.5): board fields, description, tags and checklist; else a plain new task.
      const r = await apiPost<{ id: number; task_number: string | null }>(`${API}/tasks/${id}/duplicate`).catch((e: unknown) => {
        if (e instanceof ApiError && (e.status === 404 || e.status === 405)) return write.createTask({ project_id: pid, title: `Copy of ${t.title}`, status: 'todo', task_type: p.task_type, priority: p.priority, assignee_id: p.assignee_id, due_date: t.due_date });
        throw e;
      });
      toast('success', `Duplicated as ${r.task_number ?? 'a new task'}.`);
      refresh();
      onOpen(Number(r.id));
    } catch (e) {
      toast('error', errorMessage(e));
    }
  }
  async function archive() {
    try {
      await apiPut(`/api/tasks/${id}`, { archived: true });
      toast('success', `${number} archived.`);
      refresh();
      onMoved();
      onClose();
    } catch (e) {
      toast('error', errorMessage(e));
    }
  }
}

/** Move to another project…: the projects in reach; time stays with this project, sprint, milestone and dependencies are cleared. */
function MoveDialog({ taskId, number, projectId, onClose, onMoved }: { taskId: number; number: string; projectId: number; onClose: () => void; onMoved: (to: number) => void }) {
  const list = useQuery({ queryKey: qk.list, queryFn: ({ signal }) => read.list({ signal }), staleTime: 60_000 });
  const options = (list.data?.data.projects ?? []).filter((x) => x.id !== projectId).map((x) => ({ value: x.id, label: `${x.code} · ${x.name}` }));
  return (
    <PickDialog
      title={`Move ${number} to another project`}
      label="Project"
      confirm="Move"
      options={options}
      onPick={async (to) => {
        try {
          await apiPost(`${API}/tasks/${taskId}/move-project`, { project_id: to });
        } catch (e) {
          if (e instanceof ApiError && (e.status === 404 || e.status === 405)) throw new Error('This WorkSuite server cannot move a task to another project yet.');
          throw e;
        }
        toast('success', `${number} moved. Its sprint, milestone and dependencies were cleared; its time stays with the old project.`);
        onMoved(to);
      }}
      onClose={onClose}
    />
  );
}

/**
 * Save as template task (PRJ-TED-07): the task goes to the end of a library template this person may change, as a
 * new version of it (POST tasks/{id}/save-as-template {template_id}).
 */
function TemplateDialog({ taskId, number, onClose }: { taskId: number; number: string; onClose: () => void }) {
  const lib = useQuery({ queryKey: tk.library({}), queryFn: ({ signal }) => treads.library({}, { signal }), staleTime: 60_000 });
  const options = (lib.data?.data.templates ?? []).filter((x) => x.editable && x.id !== null && x.status === 'active').map((x) => ({ value: x.id as number, label: x.name }));
  return (
    <PickDialog
      title={`Save ${number} as a template task`}
      label="Template"
      confirm="Save to template"
      options={options}
      onPick={async (templateId) => {
        await apiPost(`${API}/tasks/${taskId}/save-as-template`, { template_id: templateId });
        toast('success', `${number} added to “${options.find((o) => o.value === templateId)?.label ?? 'the template'}”.`);
        onClose();
      }}
      onClose={onClose}
    />
  );
}

/** One read for the modal (§14.2): the Tasks read with its project block, else the Projects read (an older server). */
async function readEditor(id: number, me: number, signal?: AbortSignal): Promise<{ data: EditorData; offline: boolean }> {
  let first: unknown = null;
  try {
    const r = await apiGetMeta<unknown>(`/api/tasks/${id}`, undefined, signal);
    const d = fromTasksRead(r.data);
    if (d) return { data: d, offline: r.offline };
    // The Tasks read without a project block: its fields with the Projects read's project side.
    const p = await read.task(id, { signal });
    const fromP = fromProjectsRead(p.data, me);
    const tasksRow = r.data as EditorData['task'];
    return {
      data: { ...fromP, task: { ...tasksRow, status: tasksStatusOf(fromP.project.status), tags: Array.isArray(tasksRow.tags) ? tasksRow.tags : fromP.task.tags }, fields: { ...fromP.fields, ...(tasksRow.can_edit ?? {}) }, source: 'tasks' },
      offline: r.offline || p.offline,
    };
  } catch (e) {
    if (signal?.aborted) throw e;
    first = e;
  }
  try {
    const p = await read.task(id, { signal });
    return { data: fromProjectsRead(p.data, me), offline: p.offline };
  } catch (e) {
    throw e instanceof ApiError && e.status === 404 ? e : (first ?? e);
  }
}
