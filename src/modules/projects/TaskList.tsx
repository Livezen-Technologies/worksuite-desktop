import { useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react';
import { TASK_STATUSES, TASK_STATUS_LABEL } from '@shared/projects';
import { ApiError, apiDelete, apiPost, apiPut } from '../../core/api';
import { call, errorMessage, isMac } from '../../core/bridge';
import { toast } from '../../core/toasts';
import { Checkbox } from '../../components/Checkbox';
import { DateField } from '../../components/DateField';
import { Menu, type MenuItem } from '../../components/Menu';
import { Button, Modal, cx, initials } from '../../components/ui';
import { API, STATUS_TONE, write, type BulkResult, type BulkSet, type SprintLite, type Task, type TaskStatus } from './api';
import {
  BULK_MAX,
  CHIPS,
  CHIP_LABEL,
  CHUNK,
  COLUMN_LABEL,
  COLUMN_WIDTH,
  FIXED_COLUMNS,
  GROUPS,
  GROUP_LABEL,
  LIST_COLUMNS,
  PRIORITIES,
  PRIORITY_LABEL,
  bulkSummary,
  chipFilter,
  csvFileName,
  dueWords,
  groupTasks,
  isLate,
  listKey,
  loggedWords,
  nextSort,
  sortOf,
  sortTasks,
  toCsv,
  updatedWords,
  type ListItem,
  type Member,
  type QuickChip,
  type TaskViewPrefs,
} from './list';
import { isBlocked, nextColumn, type PendingMark } from './logic';
import { Ref } from './parts';

/**
 * A project's tasks as a list (PRJ-LST-01..10, D05): the same tasks, filter and keys as the board, as rows — grouped
 * (Status by default, in the board's order, with counts, points and the WIP warning; Completed collapsed), sorted by
 * any column (shift-click adds a key), with quick filters, a column chooser, inline Status (the board's move path and
 * outbox, a reason for Blocked), Assignee, Priority and Due, ticked rows changed together through `tasks/bulk`, and
 * the keyboard — J/K, Home/End, Enter, Space, ⇧←/→, T, L, N, ←/→ on a group header, Esc. A treegrid; rows are drawn
 * 150 at a time. Offline, status moves still queue; every other edit, and bulk, wait for a connection and say so.
 */

type Edit = { id: number; field: 'status' | 'assignee' | 'priority' } | { field: 'bulk-status' | 'bulk-assignee' | 'bulk-priority' | 'bulk-sprint' } | { field: 'group' | 'columns' };

const OFFLINE_EDIT = 'Waits for a connection — only a status change is kept offline';
const OFFLINE_BULK = 'Changing several tasks at once needs a connection';

export function TaskList({
  code,
  tasks,
  marks,
  statuses,
  wip,
  members,
  sprints,
  today,
  me,
  selected,
  active,
  offline,
  footer,
  truncated,
  prefs,
  runningTaskId,
  onPrefs,
  onSelect,
  onOpen,
  onMove,
  onStartTimer,
  onLogTime,
  onNewTask,
  onEscape,
  onChanged,
}: {
  code: string | null;
  /** The board's tasks, its text filter applied and queued moves shown where I put them. */
  tasks: Task[];
  marks: Map<number, PendingMark>;
  /** The board's columns, for ⇧←/→. */
  statuses: TaskStatus[];
  wip: Partial<Record<TaskStatus, number>> | undefined;
  members: Member[];
  sprints: SprintLite[];
  today: string;
  me: number;
  selected: number | null;
  active: boolean;
  offline: boolean;
  footer: ReactNode;
  truncated: { shown: number; total: number } | null;
  prefs: TaskViewPrefs;
  runningTaskId: number | null;
  onPrefs: (patch: Partial<TaskViewPrefs>) => void;
  onSelect: (id: number | null) => void;
  onOpen: (id: number) => void;
  /** The board's move: sent now or kept in the outbox. Resolves to whether it went (or was queued). */
  onMove: (t: Task, status: TaskStatus, blockedReason?: string) => Promise<boolean>;
  onStartTimer: (t: Task) => void;
  onLogTime: (t: Task) => void;
  onNewTask: (status: TaskStatus) => void;
  /** Esc with nothing ticked: the board's (it closes the filter). */
  onEscape: () => boolean;
  /** Something was written: read the tasks again. */
  onChanged: () => void;
}) {
  const [ticked, setTicked] = useState<Set<number>>(() => new Set());
  const [anchor, setAnchor] = useState<number | null>(null);
  const [focusGroup, setFocusGroup] = useState<string | null>(null);
  const [limit, setLimit] = useState(CHUNK);
  const [edit, setEdit] = useState<Edit | null>(null);
  const [ask, setAsk] = useState<
    | {
        kind: 'reason';
        title: string;
        required: boolean;
        run: (reason: string) => void;
      }
    | {
        kind: 'due';
        title: string;
        value: string | null;
        run: (due: string | null) => void;
      }
    | { kind: 'delete'; count: number; run: () => void }
    | null
  >(null);
  const [said, say] = useState('');
  const editAnchor = useRef<HTMLElement | null>(null);
  const more = useRef<HTMLDivElement | null>(null);

  const columns = prefs.columns;
  const collapsed = useMemo(() => new Set(prefs.collapsed), [prefs.collapsed]);
  const filtered = useMemo(() => chipFilter(tasks, prefs.chips, me, today), [tasks, prefs.chips, me, today]);
  const groups = useMemo(
    () =>
      groupTasks(sortTasks(filtered, prefs.sort), prefs.group, {
        wip,
        members,
      }),
    [filtered, prefs.sort, prefs.group, wip, members],
  );
  const overdue = useMemo(() => tasks.filter((t) => isLate(t, today)).length, [tasks, today]);
  const byId = useMemo(() => new Map(tasks.map((t) => [t.id, t])), [tasks]);
  const grouped = prefs.group !== 'none';
  const items: ListItem[] = useMemo(() => {
    const out: ListItem[] = [];
    for (const g of groups) {
      if (grouped) out.push({ type: 'group', key: g.key });
      if (!grouped || !collapsed.has(g.key)) for (const t of g.tasks) out.push({ type: 'row', id: t.id });
    }
    return out;
  }, [groups, grouped, collapsed]);
  const rowOrder = useMemo(() => items.flatMap((i) => (i.type === 'row' ? [i.id] : [])), [items]);
  const groupOf = useMemo(() => new Map(groups.flatMap((g) => g.tasks.map((t) => [t.id, g] as const))), [groups]);
  const at = focusGroup !== null ? items.findIndex((i) => i.type === 'group' && i.key === focusGroup) : selected !== null ? items.findIndex((i) => i.type === 'row' && i.id === selected) : -1;
  const tickedIds = [...ticked].filter((id) => byId.has(id));
  const template = `34px ${columns.map((c) => COLUMN_WIDTH[c]).join(' ')}`;

  const focusItem = (i: number) => {
    const it = items[i];
    if (!it) return;
    if (i >= limit) setLimit(i + CHUNK);
    if (it.type === 'group') setFocusGroup(it.key);
    else {
      setFocusGroup(null);
      onSelect(it.id);
    }
  };
  const toggleGroup = (key: string, open?: boolean) => {
    const isOpen = !collapsed.has(key);
    if (open === isOpen) return;
    onPrefs({
      collapsed: isOpen ? [...prefs.collapsed, key] : prefs.collapsed.filter((k) => k !== key),
    });
  };
  const tick = (id: number, range = false) => {
    setTicked((had) => {
      const next = new Set(had);
      if (range && anchor !== null && rowOrder.includes(anchor)) {
        const [a, b] = [rowOrder.indexOf(anchor), rowOrder.indexOf(id)].sort((x, y) => x - y);
        for (const r of rowOrder.slice(a!, b! + 1)) next.add(r);
      } else if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    if (!range) setAnchor(id);
  };

  // ── writes ──
  const move = async (t: Task, status: TaskStatus) => {
    if (t.status === status) return;
    const go = async (reason?: string) => {
      const ok = await onMove(t, status, reason);
      if (ok) say(`${t.task_number ?? t.title} moved to ${TASK_STATUS_LABEL[status]}${offline ? ', waiting to be sent' : ''}.`);
    };
    // Blocked needs a reason (PRJ-TSK-02), as on the board and the web.
    if (status === 'blocked')
      setAsk({
        kind: 'reason',
        title: `Why is ${t.task_number ?? t.title} blocked?`,
        required: true,
        run: (r) => void go(r),
      });
    else await go();
  };
  const update = async (
    t: Task,
    body: {
      assignee_id?: number | null;
      priority?: string;
      due_date?: string | null;
    },
    what: string,
  ) => {
    try {
      await write.updateTask(t.id, body);
      say(`${t.task_number ?? t.title}: ${what}.`);
    } catch (e) {
      toast('error', errorMessage(e));
    } finally {
      onChanged();
    }
  };

  /** One at a time, when the server has no `tasks/bulk` yet: the same single edits, the same answer. */
  const oneByOne = async (ids: number[], set: BulkSet | null): Promise<BulkResult> => {
    const r: BulkResult = { done: [], refused: [] };
    for (const id of ids) {
      try {
        if (!set) await apiDelete(`${API}/tasks/${id}`);
        else {
          const { status, blocked_reason, ...rest } = set;
          if (Object.keys(rest).length) await apiPut(`${API}/tasks/${id}`, rest);
          if (status)
            await apiPost(`${API}/tasks/${id}/move`, {
              status,
              ...(blocked_reason ? { blocked_reason } : {}),
            });
        }
        r.done.push(id);
      } catch (e) {
        r.refused.push({
          id,
          number: byId.get(id)?.task_number ?? null,
          reason: errorMessage(e),
        });
      }
    }
    return r;
  };
  const bulk = async (set: BulkSet | null, verb: string) => {
    const ids = tickedIds.slice(0, BULK_MAX);
    if (!ids.length || offline) return;
    let r: BulkResult;
    try {
      try {
        r = await write.bulk(set ? { ids, set } : { ids, delete: true });
      } catch (e) {
        if (!(e instanceof ApiError) || ![404, 405, 501].includes(e.status)) throw e;
        r = await oneByOne(ids, set);
      }
    } catch (e) {
      toast('error', errorMessage(e));
      return;
    }
    const done = Array.isArray(r?.done) ? r.done : [];
    const refused = Array.isArray(r?.refused)
      ? r.refused.map((x) => ({
          ...x,
          number: x.number ?? byId.get(x.id)?.task_number ?? null,
        }))
      : [];
    const text = bulkSummary({ done, refused }, verb);
    toast(refused.length ? 'warning' : 'success', `${text}.`);
    say(`${text}.`);
    // The refused stay ticked, to try again.
    setTicked(new Set(refused.map((x) => x.id)));
    onChanged();
  };
  const bulkStatus = (status: TaskStatus) => {
    if (status !== 'blocked') return void bulk({ status }, 'updated');
    setAsk({
      kind: 'reason',
      title: `Why are these ${tickedIds.length} tasks blocked?`,
      required: false,
      run: (reason) =>
        void bulk(
          {
            status,
            ...(reason.trim() ? { blocked_reason: reason.trim() } : {}),
          },
          'updated',
        ),
    });
  };

  const exportCsv = async () => {
    const rows = groups.flatMap((g) => g.tasks);
    try {
      const where = await call('files:saveText', {
        name: csvFileName(code, today),
        text: toCsv(rows, columns, today).slice(0, 8_000_000),
      });
      if (where) toast('success', `Saved ${rows.length} tasks to ${where}.`);
    } catch (e) {
      toast('error', errorMessage(e));
    }
  };

  // ── the keyboard (PRJ-LST-09), while this tab is in front and nothing is typed or asked ──
  const onKey = (e: KeyboardEvent) => {
    const target = e.target as HTMLElement | null;
    const typing = !!target && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName));
    if (document.querySelector('[role="dialog"], [role="menu"]') || typing || e.metaKey || e.ctrlKey || e.altKey) return;
    const take = () => {
      e.preventDefault();
      e.stopImmediatePropagation();
    };
    const k = e.key;
    const it = at >= 0 ? items[at] : undefined;
    const row = it?.type === 'row' ? byId.get(it.id) : undefined;
    if (e.shiftKey && (k === 'ArrowLeft' || k === 'ArrowRight')) {
      if (!row) return;
      take();
      const to = nextColumn(statuses, row.status, k === 'ArrowLeft' ? 'left' : 'right');
      if (to) void move(row, to);
      return;
    }
    const nav: Record<string, 'down' | 'up' | 'home' | 'end'> = {
      j: 'down',
      J: 'down',
      k: 'up',
      K: 'up',
      ArrowDown: 'down',
      ArrowUp: 'up',
      Home: 'home',
      End: 'end',
    };
    if (nav[k]) return (take(), focusItem(listKey(items, at, nav[k]!)));
    if (it?.type === 'group' && (k === 'ArrowLeft' || k === 'ArrowRight')) return (take(), toggleGroup(it.key, k === 'ArrowRight'));
    if (row && k === 'ArrowLeft' && grouped) {
      take();
      const g = groupOf.get(row.id);
      if (g) setFocusGroup(g.key);
      return;
    }
    if (k === 'Enter' && it) return (take(), it.type === 'group' ? toggleGroup(it.key) : onOpen(it.id));
    if (k === ' ' && row) return (take(), tick(row.id));
    if ((k === 't' || k === 'T') && row) return (take(), onStartTimer(row));
    if ((k === 'l' || k === 'L') && row) return (take(), onLogTime(row));
    if ((k === 'n' || k === 'N') && !offline) {
      take();
      const g = it?.type === 'group' ? groups.find((x) => x.key === it.key) : row ? groupOf.get(row.id) : undefined;
      return onNewTask(prefs.group === 'status' && g ? g.status : 'todo');
    }
    if (k === 'Escape') {
      if (tickedIds.length) return (take(), setTicked(new Set()));
      if (onEscape()) take();
    }
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

  // The focused row or header stays in view.
  useEffect(() => {
    const el = focusGroup !== null ? [...document.querySelectorAll<HTMLElement>('[data-group]')].find((g) => g.dataset.group === focusGroup) : selected ? document.querySelector(`[data-row="${selected}"]`) : null;
    el?.scrollIntoView?.({ block: 'nearest' });
  }, [focusGroup, selected]);

  // More rows as the list scrolls to its end (chunked beyond 150).
  useEffect(() => {
    const el = more.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver((seen) => seen.some((s) => s.isIntersecting) && setLimit((l) => l + CHUNK));
    io.observe(el);
    return () => io.disconnect();
  });

  // ── menus ──
  const statusItems = (current: TaskStatus | null, pick: (s: TaskStatus) => void): MenuItem[] =>
    TASK_STATUSES.map((s) => ({
      id: s,
      label: TASK_STATUS_LABEL[s],
      radio: true,
      checked: s === current,
      onSelect: () => pick(s),
    }));
  const memberItems = (current: number | null, pick: (id: number | null) => void): MenuItem[] => [
    {
      id: 'none',
      label: 'Unassigned',
      radio: true,
      checked: current === null,
      onSelect: () => pick(null),
    },
    ...members.map((m) => ({
      id: String(m.user_id),
      label: m.user_id === me ? `${m.name} (you)` : m.name,
      radio: true,
      checked: m.user_id === current,
      onSelect: () => pick(m.user_id),
    })),
  ];
  const priorityItems = (current: string | null, pick: (p: string) => void): MenuItem[] =>
    PRIORITIES.map((p) => ({
      id: p,
      label: PRIORITY_LABEL[p]!,
      radio: true,
      checked: p === current,
      onSelect: () => pick(p),
    }));
  const menu = (() => {
    if (!edit) return null;
    const t = 'id' in edit ? byId.get(edit.id) : undefined;
    let label = '';
    let list: MenuItem[] = [];
    if (edit.field === 'status' && t) [label, list] = [`Status of ${t.task_number ?? t.title}`, statusItems(t.status, (s) => void move(t, s))];
    else if (edit.field === 'assignee' && t)
      [label, list] = [
        `Assignee of ${t.task_number ?? t.title}`,
        memberItems(t.assignee_id, (id) => void update(t, { assignee_id: id }, id ? `assigned to ${members.find((m) => m.user_id === id)?.name ?? 'them'}` : 'unassigned')),
      ];
    else if (edit.field === 'priority' && t)
      [label, list] = [`Priority of ${t.task_number ?? t.title}`, priorityItems(t.priority, (p) => void update(t, { priority: p }, `priority ${PRIORITY_LABEL[p]}`))];
    else if (edit.field === 'bulk-status') [label, list] = ['Move to status', statusItems(null, bulkStatus)];
    else if (edit.field === 'bulk-assignee') [label, list] = ['Assign to', memberItems(-1, (id) => void bulk({ assignee_id: id }, 'updated'))];
    else if (edit.field === 'bulk-priority') [label, list] = ['Priority', priorityItems(null, (p) => void bulk({ priority: p }, 'updated'))];
    else if (edit.field === 'bulk-sprint')
      [label, list] = [
        'Sprint',
        [
          {
            id: 'none',
            label: 'No sprint',
            onSelect: () => void bulk({ sprint_id: null }, 'updated'),
          },
          ...sprints
            .filter((s) => s.status !== 'completed' && s.status !== 'cancelled')
            .map((s) => ({
              id: String(s.id),
              label: s.name,
              onSelect: () => void bulk({ sprint_id: s.id }, 'updated'),
            })),
        ],
      ];
    else if (edit.field === 'group')
      [label, list] = [
        'Group by',
        GROUPS.map((g) => ({
          id: g,
          label: GROUP_LABEL[g],
          radio: true,
          checked: prefs.group === g,
          onSelect: () => onPrefs({ group: g }),
        })),
      ];
    else if (edit.field === 'columns')
      [label, list] = [
        'Columns',
        LIST_COLUMNS.map((c) => {
          const fixed = FIXED_COLUMNS.includes(c);
          const on = columns.includes(c);
          return {
            id: c,
            label: c === 'points' ? 'Points' : COLUMN_LABEL[c],
            checked: on,
            disabled: fixed,
            reason: fixed ? 'Always shown' : undefined,
            onToggle: () =>
              onPrefs({
                columns: on ? columns.filter((x) => x !== c) : [...columns, c],
              }),
            onSelect: () =>
              onPrefs({
                columns: on ? columns.filter((x) => x !== c) : [...columns, c],
              }),
          };
        }),
      ];
    else return null;
    return <Menu sections={[{ id: 'm', items: list }]} label={label} anchor={editAnchor} prefer="bottom" align="start" width={230} onClose={() => setEdit(null)} />;
  })();
  const open = (e: ReactMouseEvent<HTMLElement>, next: Edit) => {
    e.stopPropagation();
    editAnchor.current = e.currentTarget;
    setEdit(next);
  };

  // ── drawing ──
  // Drawn 150 rows (and headers) at a time: each group with the rows that fit.
  const drawnGroups: Array<{ g: (typeof groups)[number]; isOpen: boolean; shown: Task[] }> = [];
  let drawn = 0;
  for (const g of groups) {
    if (drawn >= limit) break;
    const isOpen = !grouped || !collapsed.has(g.key);
    const shown = (isOpen ? g.tasks : []).slice(0, Math.max(0, limit - drawn - (grouped ? 1 : 0)));
    drawn += shown.length + (grouped ? 1 : 0);
    drawnGroups.push({ g, isOpen, shown });
  }
  const allTicked = rowOrder.length > 0 && rowOrder.every((id) => ticked.has(id));
  const someTicked = !allTicked && rowOrder.some((id) => ticked.has(id));
  const cellBtn = 'flex h-[26px] min-w-0 items-center gap-1 rounded-[6px] px-1 text-left hover:bg-subtle disabled:cursor-not-allowed disabled:hover:bg-transparent';

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-1.5 px-5 pb-2">
        {CHIPS.map((c) => {
          const on = prefs.chips.includes(c);
          return (
            <button
              key={c}
              type="button"
              aria-pressed={on}
              onClick={() =>
                onPrefs({
                  chips: on ? prefs.chips.filter((x) => x !== c) : [...prefs.chips, c as QuickChip],
                })
              }
              className={cx('h-7 rounded-full px-2.5 text-[12px] font-semibold', on ? 'bg-primary text-white' : 'bg-subtle text-ink-2 hover:text-ink')}
            >
              {CHIP_LABEL[c]}
              {c === 'overdue' && overdue ? ` ${overdue}` : ''}
            </button>
          );
        })}
        <span className="flex-1" />
        <span className="text-[12px] text-ink-3">Group by</span>
        <button
          type="button"
          aria-haspopup="menu"
          aria-label={`Group by ${GROUP_LABEL[prefs.group]}`}
          onClick={(e) => open(e, { field: 'group' })}
          className="h-7 rounded-[8px] border border-line bg-surface px-2.5 text-[12px] font-semibold text-ink hover:bg-subtle"
        >
          {GROUP_LABEL[prefs.group]} ▾
        </button>
        <button
          type="button"
          aria-haspopup="menu"
          onClick={(e) => open(e, { field: 'columns' })}
          className="h-7 rounded-[8px] border border-line bg-surface px-2.5 text-[12px] font-semibold text-ink hover:bg-subtle"
        >
          Columns ▾
        </button>
        <button
          type="button"
          onClick={() => void exportCsv()}
          aria-label="Export CSV"
          title="The rows and columns as shown, as a CSV file"
          className="h-7 rounded-[8px] border border-line bg-surface px-2.5 text-[12px] font-semibold text-ink hover:bg-subtle"
        >
          Export CSV
        </button>
      </div>
      {tickedIds.length ? (
        <div role="toolbar" aria-label="Change the ticked tasks" className="mx-5 mb-2 flex shrink-0 flex-wrap items-center gap-1.5 rounded-[10px] bg-ink px-3 py-1.5 text-[12px] text-surface">
          <b className="me-2">{tickedIds.length} selected</b>
          {(
            [
              ['bulk-status', 'Move to status'],
              ['bulk-assignee', 'Assign to'],
              ['bulk-priority', 'Priority'],
              ['bulk-sprint', 'Sprint'],
            ] as const
          ).map(([f, l]) => (
            <button
              key={f}
              type="button"
              aria-haspopup="menu"
              disabled={offline}
              title={offline ? OFFLINE_BULK : undefined}
              onClick={(e) => open(e, { field: f })}
              className="rounded-[6px] px-2 py-1 font-semibold hover:bg-white/10 disabled:opacity-50"
            >
              {l} ▾
            </button>
          ))}
          <button
            type="button"
            disabled={offline}
            title={offline ? OFFLINE_BULK : undefined}
            onClick={() =>
              setAsk({
                kind: 'due',
                title: `Due date for ${tickedIds.length} tasks`,
                value: null,
                run: (d) => void bulk({ due_date: d }, 'updated'),
              })
            }
            className="rounded-[6px] px-2 py-1 font-semibold hover:bg-white/10 disabled:opacity-50"
          >
            Due date ▾
          </button>
          <button
            type="button"
            disabled={offline}
            title={offline ? OFFLINE_BULK : undefined}
            onClick={() =>
              setAsk({
                kind: 'delete',
                count: tickedIds.length,
                run: () => void bulk(null, 'deleted'),
              })
            }
            className="rounded-[6px] px-2 py-1 font-semibold text-[#FCA5A5] hover:bg-white/10 disabled:opacity-50"
          >
            Delete
          </button>
          <span className="flex-1" />
          {offline ? <span className="text-[11.5px] opacity-80">{OFFLINE_BULK}</span> : null}
          {tickedIds.length > BULK_MAX ? <span className="text-[11.5px] opacity-80">The first {BULK_MAX} are changed at once</span> : null}
          <button type="button" onClick={() => setTicked(new Set())} className="rounded-[6px] px-2 py-1 opacity-80 hover:bg-white/10">
            Esc to clear
          </button>
        </div>
      ) : null}
      {truncated ? (
        <p className="px-5 pb-1.5 text-[12px] text-warning-ink">
          Showing {truncated.shown} of {truncated.total} tasks — the server sent part of this project. Filter to narrow it.
        </p>
      ) : null}
      <div
        role="treegrid"
        aria-label="Tasks"
        aria-multiselectable="true"
        aria-rowcount={items.length + 1}
        aria-keyshortcuts="J K Home End Enter Space Shift+ArrowLeft Shift+ArrowRight T L N Escape"
        className="mx-5 min-h-0 flex-1 overflow-auto rounded-[10px] border border-line scroll-thin"
      >
        <div
          role="row"
          aria-rowindex={1}
          className="sticky top-0 z-[1] grid h-9 items-center border-b border-line bg-subtle text-[12px] font-semibold text-ink-3"
          style={{ gridTemplateColumns: template }}
        >
          <span role="columnheader" className="flex justify-center">
            <Checkbox aria-label={allTicked ? 'Untick all' : 'Tick all shown'} checked={allTicked} indeterminate={someTicked} onChange={() => setTicked(allTicked ? new Set() : new Set(rowOrder))} />
          </span>
          {columns.map((c) => (
            <span key={c} role="columnheader" aria-sort={sortOf(prefs.sort, c)} className={cx('min-w-0 px-1.5', (c === 'points' || c === 'logged') && 'text-end')}>
              <button type="button" title="Sort — shift-click adds a key" onClick={(e) => onPrefs({ sort: nextSort(prefs.sort, c, e.shiftKey) })} className="truncate hover:text-ink">
                {COLUMN_LABEL[c]}
                {sortOf(prefs.sort, c) === 'ascending' ? ' ↑' : sortOf(prefs.sort, c) === 'descending' ? ' ↓' : ''}
                {prefs.sort.length > 1 && sortOf(prefs.sort, c) !== 'none' ? <sup>{prefs.sort.findIndex((s) => s.replace(/^-/, '') === c) + 1}</sup> : null}
              </button>
            </span>
          ))}
        </div>
        {items.length === 0 ? <p className="px-4 py-6 text-center text-[13px] text-ink-3">{tasks.length ? 'No task matches these filters.' : 'No tasks in this project yet.'}</p> : null}
        {drawnGroups.map(({ g, isOpen, shown }) => {
          const head = grouped ? (
            <div
              key={`g${g.key}`}
              role="row"
              aria-level={1}
              aria-expanded={isOpen}
              aria-selected={false}
              data-group={g.key}
              onClick={() => (setFocusGroup(g.key), toggleGroup(g.key))}
              className={cx(
                'flex h-8 cursor-pointer items-center gap-2 border-b border-line bg-ground px-3 text-[12.5px]',
                focusGroup === g.key && 'shadow-[inset_3px_0_0_var(--color-primary)] bg-selection',
              )}
            >
              <span role="gridcell" className="flex min-w-0 items-center gap-2">
                <span aria-hidden className="w-3 text-ink-3">
                  {isOpen ? '▾' : '▸'}
                </span>
                <b className="text-ink">{g.label}</b>
                <span className="text-ink-3">
                  {g.tasks.length}
                  {g.points ? ` · ${g.points} pts` : ''}
                  {g.note ? ` · ${g.note}` : ''}
                </span>
                {g.wip ? <span className="rounded-full bg-warning-bg px-2 py-px text-[11px] font-semibold text-warning-ink">{g.wip}</span> : null}
              </span>
            </div>
          ) : null;
          return [
            head,
            ...shown.map((t) => {
              const isSel = selected === t.id && focusGroup === null;
              const isTicked = ticked.has(t.id);
              const due = dueWords(t, today);
              const logged = loggedWords(t);
              const blocked = isBlocked(t);
              const mark = marks.get(t.id);
              const running = runningTaskId === t.id || t.timer_running;
              return (
                <div
                  key={t.id}
                  role="row"
                  aria-level={grouped ? 2 : 1}
                  aria-selected={isTicked}
                  aria-current={isSel ? 'true' : undefined}
                  aria-label={`${t.task_number ?? ''} ${t.title}${blocked ? ', blocked' : ''}${due.late ? `, ${due.label}` : ''}${mark ? `, ${mark}` : ''}`}
                  data-row={t.id}
                  onClick={(e) => (e.shiftKey ? tick(t.id, true) : (setFocusGroup(null), onSelect(t.id)))}
                  onDoubleClick={() => onOpen(t.id)}
                  className={cx(
                    'grid h-9 items-center border-b border-line/60 text-[12.5px]',
                    isSel ? 'bg-selection shadow-[inset_3px_0_0_var(--color-primary)]' : isTicked ? 'bg-selection/50' : 'bg-surface hover:bg-subtle/60',
                  )}
                  style={{ gridTemplateColumns: template }}
                >
                  <span role="gridcell" className="flex justify-center">
                    <Checkbox aria-label={`Tick ${t.task_number ?? t.title}`} checked={isTicked} onChange={() => undefined} onClick={(e) => tick(t.id, e.shiftKey)} />
                  </span>
                  {columns.map((c) => (
                    <span key={c} role="gridcell" className={cx('min-w-0 px-1.5', (c === 'points' || c === 'logged') && 'text-end')}>
                      {c === 'number' ? (
                        <Ref>{t.task_number ?? `#${t.id}`}</Ref>
                      ) : c === 'title' ? (
                        <span className="flex min-w-0 items-center gap-1.5">
                          {t.task_type === 'bug' ? <span className="shrink-0 rounded-[4px] bg-danger-bg px-1 text-[10px] font-bold text-danger">Bug</span> : null}
                          <b className={cx('truncate', t.status === 'completed' ? 'font-semibold text-ink-2' : 'text-ink')} title={t.title}>
                            {t.title}
                          </b>
                          {blocked ? (
                            <span className="shrink-0 truncate text-[11.5px] text-danger" title={t.blocked_reason ?? undefined}>
                              Blocked
                              {t.blocked_reason ? ` — ${t.blocked_reason}` : ''}
                            </span>
                          ) : null}
                          {mark ? (
                            <span
                              className={cx(
                                'shrink-0 rounded-full px-1.5 py-px text-[10.5px] font-semibold',
                                mark === 'Needs your choice' ? 'bg-danger-bg text-danger' : 'bg-warning-bg text-warning-ink',
                              )}
                            >
                              {mark}
                            </span>
                          ) : null}
                          {running ? <span className="shrink-0 text-[11px] font-semibold text-success">timer running</span> : null}
                        </span>
                      ) : c === 'status' ? (
                        <button
                          type="button"
                          aria-haspopup="menu"
                          aria-label={`Status: ${TASK_STATUS_LABEL[t.status]}. Change`}
                          onClick={(e) => open(e, { id: t.id, field: 'status' })}
                          className={cellBtn}
                        >
                          <span className={cx('rounded-full px-2 py-px text-[11px] font-semibold whitespace-nowrap', STATUS_TONE[t.status])}>{TASK_STATUS_LABEL[t.status]} ▾</span>
                        </button>
                      ) : c === 'assignee' ? (
                        <button
                          type="button"
                          aria-haspopup="menu"
                          aria-label={`Assignee: ${t.assignee ?? 'nobody'}. Change`}
                          disabled={offline}
                          title={offline ? OFFLINE_EDIT : undefined}
                          onClick={(e) => open(e, { id: t.id, field: 'assignee' })}
                          className={cx(cellBtn, 'w-full')}
                        >
                          {t.assignee ? (
                            <span className="flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full bg-selection text-[9px] font-bold text-primary">{initials(t.assignee)}</span>
                          ) : null}
                          <span className={cx('truncate', !t.assignee && 'text-ink-3')}>{t.assignee ?? 'Unassigned'}</span>
                        </button>
                      ) : c === 'priority' ? (
                        <button
                          type="button"
                          aria-haspopup="menu"
                          aria-label={`Priority: ${PRIORITY_LABEL[t.priority] ?? t.priority}. Change`}
                          disabled={offline}
                          title={offline ? OFFLINE_EDIT : undefined}
                          onClick={(e) => open(e, { id: t.id, field: 'priority' })}
                          className={cx(
                            cellBtn,
                            t.priority === 'critical' ? 'font-bold text-danger' : t.priority === 'high' ? 'font-semibold text-warning-ink' : t.priority === 'low' ? 'text-ink-3' : 'text-ink-2',
                          )}
                        >
                          {PRIORITY_LABEL[t.priority] ?? t.priority}
                        </button>
                      ) : c === 'due' ? (
                        <button
                          type="button"
                          aria-label={`Due: ${due.label || 'no date'}. Change`}
                          disabled={offline}
                          title={offline ? OFFLINE_EDIT : t.due_date?.slice(0, 10)}
                          onClick={(e) => (
                            e.stopPropagation(),
                            setAsk({
                              kind: 'due',
                              title: `Due date for ${t.task_number ?? t.title}`,
                              value: t.due_date?.slice(0, 10) ?? null,
                              run: (d) => void update(t, { due_date: d }, d ? `due ${d}` : 'no due date'),
                            })
                          )}
                          className={cx(cellBtn, due.late ? 'font-bold text-danger' : 'text-ink-2')}
                        >
                          {due.label || <span className="text-ink-3">—</span>}
                        </button>
                      ) : c === 'sprint' ? (
                        <span className="block truncate text-ink-2">{t.sprint ?? ''}</span>
                      ) : c === 'milestone' ? (
                        <span className="block truncate text-ink-2">{t.milestone ?? ''}</span>
                      ) : c === 'points' ? (
                        <span className="font-mono text-ink-2">{t.story_points ?? ''}</span>
                      ) : c === 'logged' ? (
                        <span className={cx('pe-1.5 font-mono', logged.over ? 'font-bold text-danger' : 'text-ink-2')} title={logged.over ? 'Over the estimate' : undefined}>
                          {logged.label}
                        </span>
                      ) : (
                        <span className="text-ink-3">{updatedWords(t.updated_at, today)}</span>
                      )}
                    </span>
                  ))}
                </div>
              );
            }),
          ];
        })}
        {drawn < items.length ? (
          <div ref={more} className="flex justify-center py-2">
            <Button size="sm" onClick={() => setLimit((l) => l + CHUNK)}>
              Show more ({items.length - drawn} left)
            </Button>
          </div>
        ) : null}
      </div>
      <div className="flex shrink-0 items-center gap-3 border-t border-line px-5 py-1.5 text-[11.5px] text-ink-3">
        <span className="min-w-0 flex-1 truncate">J / K move · Space select · ⇧←/→ change status · Enter open · T start timer · L log time · N new task here</span>
        <span className="shrink-0">
          {filtered.length} {filtered.length === 1 ? 'task' : 'tasks'} · {footer}
        </span>
      </div>
      <div role="status" aria-live="polite" className="sr-only">
        {said}
      </div>
      {menu}
      {ask?.kind === 'reason' ? <ReasonDialog title={ask.title} required={ask.required} onClose={() => setAsk(null)} onDone={(r) => (setAsk(null), ask.run(r))} /> : null}
      {ask?.kind === 'due' ? <DueDialog title={ask.title} value={ask.value} onClose={() => setAsk(null)} onDone={(d) => (setAsk(null), ask.run(d))} /> : null}
      {ask?.kind === 'delete' ? (
        <Modal
          title={`Delete ${ask.count} ${ask.count === 1 ? 'task' : 'tasks'}?`}
          onClose={() => setAsk(null)}
          width={420}
          footer={
            <>
              <Button onClick={() => setAsk(null)}>Cancel</Button>
              <Button variant="danger" onClick={() => (setAsk(null), ask.run())}>
                Delete
              </Button>
            </>
          }
        >
          <p className="text-[13px] text-ink-2">Each task is checked as if deleted on its own; any the server refuses stay ticked, with its reason.</p>
        </Modal>
      ) : null}
    </div>
  );
}

function ReasonDialog({ title, required, onClose, onDone }: { title: string; required: boolean; onClose: () => void; onDone: (reason: string) => void }) {
  const [v, setV] = useState('');
  const empty = required && !v.trim();
  return (
    <Modal
      title={title}
      onClose={onClose}
      width={440}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={empty} onClick={() => onDone(v.trim())}>
            Mark blocked
          </Button>
        </>
      }
    >
      <label className="flex flex-col gap-1 text-[12.5px] font-semibold text-ink-2">
        {required ? 'What it waits on' : 'What they wait on — tasks with a reason already keep theirs'}
        <input
          autoFocus
          value={v}
          maxLength={400}
          onChange={(e) => setV(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && !empty && onDone(v.trim())}
          className="h-[32px] rounded-[8px] border border-line bg-surface px-2.5 text-[13px] font-normal text-ink outline-none focus:border-primary"
        />
      </label>
    </Modal>
  );
}

function DueDialog({ title, value, onClose, onDone }: { title: string; value: string | null; onClose: () => void; onDone: (due: string | null) => void }) {
  const [v, setV] = useState(value ?? '');
  return (
    <Modal
      title={title}
      onClose={onClose}
      width={380}
      footer={
        <>
          <Button onClick={() => onDone(null)}>No due date</Button>
          <span className="flex-1" />
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={!v} onClick={() => onDone(v)}>
            Set
          </Button>
        </>
      }
    >
      <DateField aria-label="Due date" value={v} onChange={setV} />
    </Modal>
  );
}

/** ⌘⇧L / Ctrl+Shift+L: the board ⇄ list switch (L alone stays Log time). */
export function isSwitchKey(e: Pick<KeyboardEvent, 'metaKey' | 'ctrlKey' | 'shiftKey' | 'altKey' | 'code'>): boolean {
  return (isMac ? e.metaKey : e.ctrlKey) && e.shiftKey && !e.altKey && e.code === 'KeyL';
}
