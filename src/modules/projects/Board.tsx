import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import { TASK_STATUS_LABEL, type ProjectsOutboxItem } from '@shared/projects';
import { call, errorMessage, isMac } from '../../core/bridge';
import { prettyAccelerator } from '../../core/commands';
import { openRouteInWindow, useTab } from '../../core/tab-context';
import { toast } from '../../core/toasts';
import { Icon } from '../../components/Icon';
import { Button, ErrorNote, Kbd, Spinner, cx, initials } from '../../components/ui';
import { qk, read, type Task, type TaskStatus } from './api';
import { setTimerState, submit, togglePin, useProjectTimer } from './desk';
import { textFilter, type TaskViewPrefs } from './list';
import { activeSprint, boardKey, buildColumns, dueOf, isBlocked, lastChange, nextColumn, sprintDay, withPending, type BoardKey } from './logic';
import { Ref, fieldClass } from './parts';
import { boardRoute, type TaskDisplay } from './routes';
import { usePublishTaskOrder } from './task-editor';
import { TaskList, isSwitchKey } from './TaskList';

/**
 * A project's tasks in a tab — the board, or (PRJ-LST-01, D05) the same tasks as a list: the Board | List switch
 * beside the title (⌘⇧L / Ctrl+Shift+L) keeps the filter and the selected task, and each view keeps the other's
 * rules — a status change in the list is this board's move, outbox and all (TaskList.tsx).
 *
 * The board (PRJ-DSK-01, D01): "PRJ-0018 · Sprint 7 · day 4 of 9", the columns with their counts,
 * cards with their number, title, assignee, due or how late, blocked; and the keyboard — J/K down and up, ←/→ across
 * the columns, Shift+←/→ moves the card, Enter opens it, T starts its timer, L logs time, N a new task, ⌘F filter,
 * ⌘2 the timeline, ⌥⌘O this project in a window of its own.
 */
export function Board({ projectId, display = 'board', prefs, onDisplay, onPrefs, selected, today, me, active, pinned, offline, outbox, onOpen, onSelect, onNewTask, onLogTime, onOffline }: {
  projectId: number;
  /** Cards in columns or rows (PRJ-LST-01). */
  display?: TaskDisplay;
  /** The list's remembered layout (PRJ-LST-02). */
  prefs?: TaskViewPrefs;
  onDisplay?: (d: TaskDisplay) => void;
  onPrefs?: (patch: Partial<TaskViewPrefs>) => void;
  selected: number | null;
  today: string;
  me: number;
  active: boolean;
  pinned: boolean;
  offline: boolean;
  outbox: ProjectsOutboxItem[];
  onOpen: (taskId: number) => void;
  onSelect: (taskId: number | null) => void;
  onNewTask: (status: TaskStatus) => void;
  onLogTime: (t: Task) => void;
  /** Whether the board came from the copy kept offline. */
  onOffline: (offline: boolean) => void;
}) {
  const qc = useQueryClient();
  const { go } = useTab();
  const detail = useQuery({ queryKey: qk.detail(projectId), queryFn: ({ signal }) => read.detail(projectId, { signal }) });
  const list = useQuery({ queryKey: qk.tasks(projectId), queryFn: ({ signal }) => read.tasks(projectId, { signal }), refetchInterval: 30_000 });
  const timer = useProjectTimer();
  const [filter, setFilter] = useState<string | null>(null);
  const filterRef = useRef<HTMLInputElement>(null);
  const dragging = useRef<Task | null>(null);
  const [over, setOver] = useState<TaskStatus | null>(null);
  const project = detail.data?.data.project ?? null;
  const fromCache = !!list.data?.offline || !!detail.data?.offline;

  useEffect(() => onOffline(fromCache), [fromCache, onOffline]);

  const { tasks, marks } = useMemo(() => withPending(list.data?.data.tasks ?? [], outbox), [list.data, outbox]);
  const shown = useMemo(() => textFilter(tasks, filter), [tasks, filter]);
  const columns = useMemo(() => buildColumns(shown), [shown]);
  const isList = display === 'list' && !!prefs;
  const wip = list.data?.data.wip_limits;
  const ids = columns.map((c) => c.tasks.map((t) => t.id));
  const byId = useMemo(() => new Map(tasks.map((t) => [t.id, t])), [tasks]);
  const sel = selected !== null && byId.has(selected) ? selected : null;
  const sprint = activeSprint(detail.data?.data.sprints, today);
  const day = sprint ? sprintDay(sprint, today) : null;
  const changed = lastChange(tasks);
  // J/K in the task modal walk the cards column by column (PRJ-TED-09); the list says its own order.
  usePublishTaskOrder(isList ? null : ids.flat());

  const refresh = () => void qc.invalidateQueries({ queryKey: qk.tasks(projectId) });
  /** A card moved — dragged, ⇧←/→, or a status picked in the list: one path, one outbox entry (acceptance #14). */
  const move = async (t: Task, status: TaskStatus, blockedReason?: string): Promise<boolean> => {
    if (t.status === status) return false;
    // Shown in its new column at once; the server has the last word. A poll already on its way is stopped first, or it
    // lands after this with the old status and the card jumps back until the next one (#430).
    await qc.cancelQueries({ queryKey: qk.tasks(projectId), exact: true });
    qc.setQueryData(qk.tasks(projectId), (old: typeof list.data) =>
      old ? { ...old, data: { ...old.data, tasks: old.data.tasks.map((x) => (x.id === t.id ? { ...x, status, ...(blockedReason ? { blocked_reason: blockedReason } : {}) } : x)) } } : old,
    );
    try {
      const r = await submit({ kind: 'move', taskId: t.id, status, ...(blockedReason ? { blockedReason } : {}), baseUpdatedAt: t.updated_at, label: `Move ${t.task_number ?? t.title} to ${TASK_STATUS_LABEL[status]}` });
      if (r.error && !r.queued) throw new Error(r.error);
      return true;
    } catch (e) {
      toast('error', errorMessage(e));
      return false;
    } finally {
      refresh();
    }
  };
  const startTimer = async (t: Task) => {
    try {
      setTimerState(timer.running ? await call('projects:timerSwitch', { taskId: t.id, projectId: t.project_id ?? projectId }) : await call('projects:timerStart', { taskId: t.id, projectId: t.project_id ?? projectId }));
      toast('success', `Timer started on ${t.task_number ?? t.title}.`);
    } catch (e) {
      toast('error', errorMessage(e));
    }
  };
  // The window keeps the view (PRJ-LST-01).
  const newWindow = () => openRouteInWindow(boardRoute(projectId, null, display), project ? `${project.code} · ${project.name}` : 'Project');
  const switchTo = (d: TaskDisplay) => d !== display && onDisplay?.(d);
  // DELIVERY: the timeline is drawn here now.
  const timeline = () => go(`/projects/${projectId}/timeline`);
  const toggleFilter = (show?: boolean) => {
    setFilter((f) => (show ?? f === null ? (f ?? '') : null));
    setTimeout(() => filterRef.current?.focus(), 0);
  };

  // The board's keys, while this tab is in front and nothing is being typed or asked. Caught before the shell's
  // (⌘2 is "tab 2" there), and only these.
  const onKey = (e: KeyboardEvent) => {
    const target = e.target as HTMLElement | null;
    const typing = !!target && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName));
    if (document.querySelector('[role="dialog"]')) return;
    const mod = isMac ? e.metaKey : e.ctrlKey;
    const take = () => {
      e.preventDefault();
      e.stopImmediatePropagation();
    };
    if (mod && !e.altKey && !e.shiftKey && e.code === 'KeyF') return (take(), toggleFilter(true));
    if (mod && !e.altKey && !e.shiftKey && e.code === 'Digit2') return (take(), timeline());
    if (mod && e.altKey && !e.shiftKey && e.code === 'KeyO') return (take(), newWindow());
    if (onDisplay && isSwitchKey(e)) return (take(), switchTo(display === 'list' ? 'board' : 'list'));
    // The list has its own keys (TaskList.tsx).
    if (typing || mod || e.altKey || isList) return;
    const k = e.key;
    const nav: Record<string, BoardKey> = { j: 'down', J: 'down', k: 'up', K: 'up', ArrowDown: 'down', ArrowUp: 'up', ArrowLeft: 'left', ArrowRight: 'right' };
    if (e.shiftKey && (k === 'ArrowLeft' || k === 'ArrowRight') && sel) {
      const t = byId.get(sel)!;
      const to = nextColumn(columns.map((c) => c.status), t.status, k === 'ArrowLeft' ? 'left' : 'right');
      take();
      if (to) void move(t, to);
      return;
    }
    if (nav[k]) {
      take();
      onSelect(boardKey(ids, sel, nav[k]!));
      return;
    }
    if (k === 'Enter' && sel) return (take(), onOpen(sel));
    if ((k === 't' || k === 'T') && sel) return (take(), void startTimer(byId.get(sel)!));
    if ((k === 'l' || k === 'L') && sel) return (take(), onLogTime(byId.get(sel)!));
    if ((k === 'n' || k === 'N') && !offline) return (take(), onNewTask(sel ? (byId.get(sel)!.status as TaskStatus) : 'todo'));
    if (k === 'Escape' && filter !== null) return (take(), setFilter(null));
  };
  const keys = useRef(onKey);
  useEffect(() => {
    keys.current = onKey;
  });
  useEffect(() => {
    if (!active) return;
    const listen = (e: KeyboardEvent) => keys.current(e);
    window.addEventListener('keydown', listen, true);
    return () => window.removeEventListener('keydown', listen, true);
  }, [active]);

  // The selected card stays in view.
  useEffect(() => {
    if (sel) document.querySelector(`[data-card="${sel}"]`)?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [sel]);

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-2 px-5 pt-3.5 pb-2.5">
        <div className="flex min-w-0 flex-col">
          <span className="truncate font-mono text-[11.5px] text-ink-3">
            {[project?.code, sprint?.name, day ? `day ${day.day} of ${day.of}` : null].filter(Boolean).join(' · ') || ' '}
          </span>
          <h1 className="truncate text-[19px] font-bold text-ink">{project ? `${project.name} — ${isList ? 'List' : 'Board'}` : isList ? 'List' : 'Board'}</h1>
        </div>
        {onDisplay ? (
          <div className="flex items-center gap-1.5">
            <div role="group" aria-label="View" className="flex h-[30px] items-center rounded-[8px] border border-line bg-subtle p-0.5">
              {(['board', 'list'] as const).map((d) => (
                <button key={d} type="button" aria-pressed={display === d} onClick={() => switchTo(d)} className={cx('h-[24px] rounded-[6px] px-2.5 text-[12.5px] font-semibold', display === d ? 'bg-surface text-primary shadow-sm' : 'text-ink-2 hover:text-ink')}>
                  {d === 'board' ? 'Board' : 'List'}
                </button>
              ))}
            </div>
            <Kbd tone="key">{prettyAccelerator('Mod+Shift+L')}</Kbd>
          </div>
        ) : null}
        <span className="flex-1" />
        {filter !== null ? (
          <input
            ref={filterRef}
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            onKeyDown={(e) => e.key === 'Escape' && (e.stopPropagation(), setFilter(null))}
            aria-label={isList ? 'Filter tasks' : 'Filter cards'}
            placeholder={isList ? 'Filter tasks…' : 'Filter cards…'}
            className={cx(fieldClass, 'w-[180px]')}
          />
        ) : null}
        <button type="button" onClick={() => togglePin(projectId)} aria-pressed={pinned} title={pinned ? 'Unpin' : 'Pin — keeps this board for offline'} className={cx('flex h-[30px] w-[30px] items-center justify-center rounded-[8px] border border-line hover:bg-subtle', pinned ? 'text-primary' : 'text-ink-3')}>
          <Icon name={pinned ? 'pin' : 'pin-off'} size={14} />
        </button>
        <Action label="New task" keys="N" onClick={() => onNewTask('todo')} disabled={offline} title={offline ? 'Creating a task needs a connection' : undefined} />
        <Action label="Filter" keys={prettyAccelerator('Mod+F')} onClick={() => toggleFilter()} />
        <Action label="Timeline" keys={prettyAccelerator('Mod+2')} onClick={timeline} title="Opens the project’s timeline" />
        <Action label="New window" keys={prettyAccelerator('Mod+Alt+O')} onClick={newWindow} title="This project in a window of its own" />
      </div>
      {list.isLoading ? <Spinner /> : null}
      {list.error && !list.data ? (
        <div className="px-5">
          <ErrorNote error={list.error} onRetry={() => void list.refetch()} />
        </div>
      ) : null}
      {list.data && isList && prefs && onPrefs ? (
        <TaskList
          code={project?.code ?? null}
          tasks={shown}
          marks={marks}
          statuses={columns.map((c) => c.status)}
          wip={wip}
          members={detail.data?.data.members ?? []}
          sprints={detail.data?.data.sprints ?? []}
          today={today}
          me={me}
          selected={sel}
          active={active}
          offline={offline}
          footer={`${pinned ? 'Cached for offline' : 'Pin to keep offline'}${changed ? ` · last change ${new Date(changed).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })}` : ''}`}
          truncated={list.data.data.truncated && list.data.data.total ? { shown: tasks.length, total: list.data.data.total } : null}
          prefs={prefs}
          runningTaskId={timer.running?.taskId ?? null}
          onPrefs={onPrefs}
          onSelect={onSelect}
          onOpen={onOpen}
          onMove={move}
          onStartTimer={(t) => void startTimer(t)}
          onLogTime={onLogTime}
          onNewTask={onNewTask}
          onEscape={() => (filter !== null ? (setFilter(null), true) : false)}
          onChanged={refresh}
        />
      ) : list.data ? (
        <div role="grid" aria-label="Board" aria-keyshortcuts="J K ArrowLeft ArrowRight Enter T L N" className="grid min-h-0 flex-1 auto-cols-[minmax(200px,1fr)] grid-flow-col gap-2.5 overflow-x-auto px-5 pb-2 scroll-thin">
          {columns.map((c) => (
            <section
              key={c.status}
              role="row"
              aria-label={`${TASK_STATUS_LABEL[c.status]}, ${c.tasks.length}`}
              onDragOver={(e) => {
                if (!dragging.current) return;
                e.preventDefault();
                if (over !== c.status) setOver(c.status);
              }}
              onDragLeave={(e) => e.currentTarget === e.target && setOver(null)}
              onDrop={(e) => {
                e.preventDefault();
                const t = dragging.current;
                dragging.current = null;
                setOver(null);
                if (t) void move(t, c.status);
              }}
              className={cx('flex min-h-0 flex-col gap-2 rounded-[12px] bg-[#EEF1F6] p-2 dark:bg-subtle', over === c.status && 'ring-2 ring-primary/40')}
            >
              <div className="flex items-center gap-1.5 px-1 pt-0.5">
                <b className="flex-1 text-[12.5px] text-ink">{TASK_STATUS_LABEL[c.status]}</b>
                {wip?.[c.status] && c.tasks.length > wip[c.status]! ? <span className="rounded-full bg-warning-bg px-1.5 py-px text-[10.5px] font-semibold text-warning-ink">WIP {c.tasks.length} of {wip[c.status]}</span> : null}
                <span className="text-[11.5px] text-ink-3">{c.tasks.length}</span>
              </div>
              <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto scroll-thin">
                {c.tasks.map((t) => {
                  const due = dueOf(t, today);
                  const blocked = isBlocked(t);
                  const mark = marks.get(t.id);
                  const running = timer.running?.taskId === t.id || t.timer_running;
                  const isSel = sel === t.id;
                  return (
                    <button
                      key={t.id}
                      type="button"
                      role="gridcell"
                      data-card={t.id}
                      aria-selected={isSel}
                      aria-label={`${t.task_number ?? ''} ${t.title}${blocked ? ', blocked' : ''}${due.late ? `, ${due.label}` : ''}${mark ? `, ${mark}` : ''}`}
                      draggable
                      onDragStart={(e) => {
                        e.dataTransfer.effectAllowed = 'move';
                        e.dataTransfer.setData('text/plain', t.title);
                        dragging.current = t;
                      }}
                      onDragEnd={() => {
                        dragging.current = null;
                        setOver(null);
                      }}
                      onClick={() => onSelect(t.id)}
                      onDoubleClick={() => onOpen(t.id)}
                      className={cx(
                        'flex flex-col gap-1 rounded-[9px] border bg-surface p-2 text-left',
                        isSel ? 'border-primary ring-1 ring-primary' : mark ? 'border-dashed border-warning' : 'border-line hover:border-[#B8C1DA] dark:hover:border-ink-3',
                      )}
                    >
                      <span className="flex items-center gap-1.5">
                        <Ref>{t.task_number ?? `#${t.id}`}</Ref>
                        {t.task_type === 'bug' ? <span className="rounded-[4px] bg-danger-bg px-1 text-[10px] font-bold text-danger">Bug</span> : null}
                        <span className="flex-1" />
                        {mark ? <span className={cx('rounded-full px-1.5 py-px text-[10.5px] font-semibold', mark === 'Needs your choice' ? 'bg-danger-bg text-danger' : 'bg-warning-bg text-warning-ink')}>{mark}</span> : null}
                      </span>
                      <b className={cx('text-[12.5px] leading-[1.35]', t.status === 'completed' ? 'text-ink-2' : 'text-ink')}>{t.title}</b>
                      <span className="flex items-center gap-1 text-[11px] text-ink-3">
                        {blocked ? <b className="text-danger">Blocked</b> : null}
                        {blocked && due.label ? <span className="text-danger">·</span> : null}
                        {t.assignee && !blocked ? <span title={t.assignee_id === me ? 'You' : t.assignee}>{initials(t.assignee)}</span> : null}
                        {t.assignee && !blocked && due.label ? <span>·</span> : null}
                        {t.status === 'completed' && t.completed_at ? <span>Done {t.completed_at.slice(8, 10)}</span> : due.label ? <span className={cx(due.late && 'font-bold text-danger')}>{due.label}</span> : null}
                        {running ? <span className="ml-auto flex items-center gap-1 font-semibold text-success"><span className="h-1.5 w-1.5 rounded-full bg-success" />timer running</span> : null}
                      </span>
                    </button>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      ) : null}
      {isList ? null : (
        <div className="flex shrink-0 items-center gap-3 border-t border-line px-5 py-1.5 text-[11.5px] text-ink-3">
          <span className="min-w-0 flex-1 truncate">J / K move · ←/→ change column · ⇧←/→ move card · Enter open · T start timer · L log time</span>
          <span className="shrink-0">
            {pinned ? 'Cached for offline' : 'Pin to keep offline'}
            {changed ? ` · last change ${new Date(changed).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })}` : ''}
          </span>
        </div>
      )}
      {!list.data && !list.isLoading && !list.error ? <Button onClick={() => void list.refetch()}>Load the board</Button> : null}
    </div>
  );
}

function Action({ label, keys, onClick, disabled = false, title }: { label: string; keys: string; onClick: () => void; disabled?: boolean; title?: string }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} title={title} aria-keyshortcuts={keys} className="flex h-[30px] items-center gap-2 rounded-[8px] border border-line bg-surface px-2.5 text-[12.5px] font-semibold text-ink hover:bg-subtle disabled:opacity-50">
      {label}
      <Kbd tone="key">{keys}</Kbd>
    </button>
  );
}
