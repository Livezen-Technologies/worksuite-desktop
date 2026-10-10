import { Icon } from '../../components/Icon';
import { cx, Kbd } from '../../components/ui';
import { prettyAccelerator } from '../../core/commands';
import type { NavCounts, Project } from './api';
import { togglePin } from './desk';
import { HealthDot } from './parts';
import type { ProjectsView } from './routes';

/**
 * The Projects app's left pane (D01): Projects and New, the project switcher (⌘P), the views with what waits in
 * them, the pinned projects (kept on this computer, and kept for offline) and the recent ones.
 */
export function Rail({ view, counts, projects, pins, recent, canCreate, onGo, onJump, onNew }: {
  view: ProjectsView;
  counts: NavCounts | null;
  projects: Map<number, Project>;
  pins: number[];
  recent: number[];
  canCreate: boolean;
  onGo: (route: string) => void;
  onJump: () => void;
  onNew: () => void;
}) {
  const row = (active: boolean) => cx('flex h-[30px] w-full items-center gap-2 rounded-[7px] px-2 text-left text-[13px]', active ? 'bg-selection font-bold text-primary' : 'text-ink hover:bg-subtle');
  const current = view.kind === 'board' ? view.projectId : null;
  const viewRow = (route: string, label: string, active: boolean, icon: string, count?: number) => (
    <button key={route} type="button" aria-current={active ? 'page' : undefined} onClick={() => onGo(route)} className={row(active)}>
      <Icon name={icon} size={14} className={active ? 'text-primary' : 'text-ink-3'} />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {count ? <span className="text-[11.5px] font-bold text-ink-2">{count}</span> : null}
    </button>
  );
  const projectRow = (id: number, pinned: boolean) => {
    const p = projects.get(id);
    const open = p && p.tasks !== undefined ? Math.max(0, (p.tasks ?? 0) - (p.tasks_done ?? 0)) : null;
    const name = p?.name ?? `Project ${id}`;
    return (
      <div key={`${pinned ? 'p' : 'r'}${id}`} className="group relative">
        <button type="button" aria-current={current === id ? 'page' : undefined} onClick={() => onGo(`/projects/${id}`)} className={row(current === id)} title={p ? `${p.code} · ${p.name}` : name}>
          <HealthDot health={p?.health} />
          <span className="min-w-0 flex-1 truncate">{name}</span>
          {pinned && open ? <span className="text-[11.5px] font-semibold text-ink-3 group-hover:invisible">{open}</span> : null}
        </button>
        <button
          type="button"
          aria-label={pinned ? `Unpin ${name}` : `Pin ${name}`}
          title={pinned ? 'Unpin' : 'Pin — keeps its board for offline'}
          onClick={() => togglePin(id)}
          className="invisible absolute top-[5px] right-1 flex h-5 w-5 items-center justify-center rounded-[5px] text-ink-3 group-hover:visible hover:bg-surface hover:text-ink focus:visible"
        >
          <Icon name={pinned ? 'pin-off' : 'pin'} size={12} />
        </button>
      </div>
    );
  };
  const recentShown = recent.filter((id) => !pins.includes(id)).slice(0, 5);
  const head = (label: string) => <div className="mx-2 mt-3 mb-0.5 text-[10.5px] font-bold tracking-[0.6px] text-ink-3">{label}</div>;

  return (
    <nav aria-label="Projects" className="flex w-[232px] shrink-0 flex-col gap-px overflow-y-auto border-r border-line bg-surface px-2.5 py-3.5 scroll-thin">
      <div className="mb-2 flex items-center gap-2 px-1">
        <h1 className="flex-1 text-[16px] font-bold text-ink">Projects</h1>
        <button
          type="button"
          onClick={onNew}
          disabled={!canCreate}
          aria-label="New project"
          title={canCreate ? 'New project — opens on the web' : 'New project needs a connection'}
          className="flex h-7 w-7 items-center justify-center rounded-[8px] bg-primary text-white hover:bg-primary-hover disabled:opacity-50"
        >
          <Icon name="plus" size={15} />
        </button>
      </div>
      <button type="button" onClick={onJump} aria-keyshortcuts="Meta+P Control+P" className="mb-1 flex h-[32px] items-center gap-2 rounded-[8px] border border-line bg-ground px-2.5 text-left text-[12.5px] text-ink-3 hover:border-primary/50">
        <Icon name="search" size={14} />
        <span className="flex-1">Jump to project</span>
        <Kbd tone="key">{prettyAccelerator('Mod+P')}</Kbd>
      </button>
      {head('VIEWS')}
      {viewRow('/projects', 'Dashboard', view.kind === 'dashboard', 'grid')}
      {viewRow('/projects/my-work', 'My work', view.kind === 'my-work', 'list-todo', counts?.my_work)}
      {viewRow('/projects/time', 'Time & approvals', view.kind === 'time', 'clock', counts?.time_waiting)}
      {/* ── governance (W12–W15) ── */}
      {head('GOVERNANCE')}
      {viewRow('/projects/budget', 'Budget & cost', view.kind === 'budget' && !view.projectId, 'banknote')}
      {viewRow('/projects/risks', 'Risks', view.kind === 'risks' && !view.projectId, 'warning', counts?.risks_open)}
      {viewRow('/projects/changes', 'Change requests', view.kind === 'changes' && !view.projectId, 'git-branch', counts?.changes_waiting)}
      {viewRow('/projects/reports', 'Reports', view.kind === 'reports', 'chart')}
      {head('PINNED')}
      {pins.length ? pins.map((id) => projectRow(id, true)) : <span className="px-2 py-1 text-[12px] text-ink-3">Pin a project to keep it here, and offline.</span>}
      {current && !pins.includes(current) && !recentShown.includes(current) ? projectRow(current, false) : null}
      {recentShown.length ? head('RECENT') : null}
      {recentShown.map((id) => projectRow(id, false))}
    </nav>
  );
}
