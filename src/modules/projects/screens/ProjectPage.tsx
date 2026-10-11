import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type ReactNode } from 'react';
import { call } from '../../../core/bridge';
import { useTab } from '../../../core/tab-context';
import { toast } from '../../../core/toasts';
import { Checkbox } from '../../../components/Checkbox';
import { Icon } from '../../../components/Icon';
import { Select } from '../../../components/Select';
import { Button, Modal, cx } from '../../../components/ui';
import { qk, type ProjectStatus } from '../api';
import { setTimerState, useProjectTimer } from '../desk';
import { openWeb } from '../parts';
import type { ProjectTab } from '../routes';
import {
  MILESTONE_STATE, MOVE_LABEL, PRIORITY, PROJECT_STATUS, RISK_LEVEL, daysLeftText, errorStatus, errorText, fmtDay, num, parseDay, pk, preads, projectPath, pwrites,
  shortMoney, usedTone, type FullDetail,
} from '../portfolio';
import { ActivityList } from './Activity';
import { Chip, ErrorLine, Failed, Field, HealthChip, Kpi, Loading, MenuButton, Mono, Nothing, PageHead, Panel, ProjectStatusChip, areaClass, inputClass, needsConnection, useAsk, withConfirm } from './kit';
import { ProjectTeam } from './Team';
import { SaveAsTemplate } from './SaveAsTemplate';

/**
 * W04 · One project (PRJ-STS, PRJ-BUD, PRJ-INT), natively: its header (status and health in words, Start timer, Edit,
 * Move to ▾ with the server's confirmations, More: re-baseline, mark or save as template, delete) and its sections as
 * routes — `/projects/{id}` Overview, `/board`, `/team`, `/activity`, `/files` and `/settings` (the project's own
 * settings: edit, status, baseline history, template). The module's other tabs (timeline, sprints, milestones, time,
 * budget, risks, changes) are their own screens.
 *
 * Moves the server needs confirmed — completing with open tasks, deleting a project that still has tasks — come back
 * as 409 with the reason; the reason is shown as asked, and only a yes retries with `force`. Every write needs WorkSuite
 * (disabled offline); what was read stays readable from the offline copy.
 */

/** The web's tabs, and this app's project Settings. */
const TABS: Array<[string, string]> = [
  ['overview', 'Overview'],
  ['board', 'Board'],
  ['timeline', 'Timeline'],
  ['sprints', 'Sprints'],
  ['milestones', 'Milestones'],
  ['team', 'Team'],
  ['time', 'Time'],
  ['budget', 'Budget'],
  ['risks', 'Risks'],
  ['changes', 'Changes'],
  ['files', 'Files'],
  ['activity', 'Activity'],
  ['settings', 'Settings'],
];

/** A project's sections as a row of tabs, each a route (the board shows it too). */
export function ProjectTabs({ projectId, tab, onGo }: { projectId: number; tab: string; onGo: (route: string) => void }) {
  return (
    <nav aria-label="Project sections" className="flex shrink-0 gap-0.5 overflow-x-auto border-b border-line bg-surface px-4 scroll-thin">
      {TABS.map(([k, label]) => {
        const on = k === tab;
        return (
          <button key={k} type="button" aria-current={on ? 'page' : undefined} onClick={() => onGo(projectPath(projectId, k))} className={cx('-mb-px h-8 shrink-0 border-b-2 px-2.5 text-[12.5px] whitespace-nowrap', on ? 'border-primary font-bold text-primary' : 'border-transparent font-semibold text-ink-2 hover:text-ink')}>
            {label}
          </button>
        );
      })}
    </nav>
  );
}

const daysBetween = (a: string | null, b: string | null): number | null => {
  const x = parseDay(a);
  const y = parseDay(b);
  return x && y ? Math.round((y.getTime() - x.getTime()) / 86_400_000) : null;
};

export function ProjectPage({ projectId, tab, offline, onGo, onOpenTask, onOffline }: { projectId: number; tab: ProjectTab; offline: boolean; onGo: (route: string) => void; onOpenTask: (taskId: number) => void; onOffline: (o: boolean) => void }) {
  const q = useQuery({ queryKey: pk.full(projectId), queryFn: ({ signal }) => preads.full(projectId, { signal }) });
  const fromCache = !!q.data?.offline;
  useEffect(() => onOffline(fromCache), [fromCache, onOffline]);
  if (q.isLoading) return <Loading label="Loading the project" />;
  if (!q.data) {
    const s = errorStatus(q.error);
    if (s === 404 || s === 403)
      return (
        <Nothing
          text="This project was not found, or it is not one of yours."
          action={
            <Button size="sm" onClick={() => onGo('/projects/all')}>
              All projects
            </Button>
          }
        />
      );
    return <Failed error={q.error} onRetry={() => void q.refetch()} />;
  }
  const d = q.data.data;
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <Header d={d} offline={offline} onGo={onGo} />
      <ProjectTabs projectId={projectId} tab={tab} onGo={onGo} />
      <div className="min-h-0 flex-1 overflow-y-auto scroll-thin">
        {tab === 'overview' ? (
          <Overview d={d} onGo={onGo} />
        ) : tab === 'team' ? (
          <ProjectTeam detail={d} offline={offline} />
        ) : tab === 'settings' ? (
          <ProjectSettings key={JSON.stringify(d.project)} d={d} offline={offline} onGo={onGo} />
        ) : tab === 'activity' ? (
          <ActivityList projectId={projectId} embedded onGo={onGo} onOpenTask={onOpenTask} />
        ) : (
          <Files d={d} />
        )}
      </div>
    </div>
  );
}

// ── header ─────────────────────────────────────────────────────────────────

function Header({ d, offline, onGo }: { d: FullDetail; offline: boolean; onGo: (route: string) => void }) {
  const qc = useQueryClient();
  const timer = useProjectTimer();
  const { confirm, dialog } = useAsk();
  const [rebaselining, setRebaselining] = useState(false);
  const [saving, setSaving] = useState(false);
  const p = d.project;
  const can = d.can ?? {};
  const refresh = () => void qc.invalidateQueries({ queryKey: qk.all });
  const offlineTitle = (what: string) => (offline ? needsConnection(what) : undefined);

  const moveTo = async (s: ProjectStatus) => {
    const label = PROJECT_STATUS[s]?.label ?? s;
    try {
      const done = await withConfirm((force) => pwrites.setStatus(p.id, s, force), confirm, `Move ${p.code} to ${label}?`, `Move to ${label}`);
      if (done) {
        toast('success', `${p.code} is now ${label.toLowerCase()}`);
        refresh();
      }
    } catch (e) {
      toast('error', errorText(e, 'The status could not be changed.'));
    }
  };

  const startTimer = async () => {
    try {
      const input = { taskId: null, projectId: p.id, billable: p.is_billable };
      setTimerState(timer.running ? await call('projects:timerSwitch', input) : await call('projects:timerStart', input));
      toast('success', `Timer started on ${p.code}`);
    } catch (e) {
      toast('error', errorText(e, 'The timer could not be started.'));
    }
  };

  const toggleTemplate = async () => {
    try {
      await pwrites.setTemplate(p.id, !p.is_template);
      toast('success', p.is_template ? `${p.code} is no longer a template` : `${p.code} is now a template`);
      refresh();
    } catch (e) {
      toast('error', errorText(e, 'That could not be changed.'));
    }
  };

  const remove = async () => {
    if (!(await confirm({ title: `Delete ${p.code}?`, message: `“${p.name}” and its board, milestones and plan are removed. Logged time and costs stay in the records.`, confirmLabel: 'Delete project', danger: true }))) return;
    try {
      const done = await withConfirm((force) => pwrites.remove(p.id, force), confirm, `Delete ${p.code} anyway?`, 'Delete anyway');
      if (done) {
        toast('success', `${p.code} deleted`);
        refresh();
        onGo('/projects/all');
      }
    } catch (e) {
      toast('error', errorText(e, 'The project could not be deleted.'));
    }
  };

  const more = can.manage
    ? [
        { label: 'Re-baseline…', onSelect: () => setRebaselining(true) },
        { label: p.is_template ? 'Unmark as template' : 'Mark as template', onSelect: () => void toggleTemplate() },
        { label: 'Save as template…', onSelect: () => setSaving(true) },
        { label: 'Delete project…', onSelect: () => void remove(), danger: true },
      ]
    : [];

  const crumb = (
    <>
      <button type="button" onClick={() => onGo('/projects/all')} className="font-sans text-primary hover:underline">
        All projects
      </button>
      {' › '}
      {p.code}
      {p.org_name ? ` · ${p.org_name}` : ''}
      {p.client ? ` · ${p.client}` : ''}
      {p.category ? ` · ${p.category}` : ''}
    </>
  );

  return (
    <PageHead
      crumb={crumb}
      title={p.name}
      chips={
        <>
          <ProjectStatusChip status={p.status} />
          {d.health?.status && d.health.status !== 'closed' ? <HealthChip health={d.health.status} /> : null}
          {p.is_template ? <Chip>Template</Chip> : null}
          {d.template ? <Chip tone="bg-subtle text-ink-3">{`From ${d.template.name}${d.template.version ? ` v${d.template.version}` : ''}`}</Chip> : null}
        </>
      }
      actions={
        <>
          {can.time ? (
            <Button size="sm" icon="play" disabled={offline} title={offlineTitle('Starting a timer')} onClick={() => void startTimer()}>
              Start timer
            </Button>
          ) : null}
          {can.manage ? (
            <Button size="sm" icon="compose" disabled={offline} title={offlineTitle('Editing a project')} onClick={() => onGo(projectPath(p.id, 'settings'))}>
              Edit
            </Button>
          ) : null}
          {can.manage && d.next_statuses?.length ? (
            <MenuButton label="Move to ▾" ariaLabel="Move to another status" disabled={offline} title={offlineTitle('Moving a project')} items={d.next_statuses.map((s) => ({ label: MOVE_LABEL[s] ?? PROJECT_STATUS[s]?.label ?? s, onSelect: () => void moveTo(s) }))} />
          ) : null}
          {more.length ? <MenuButton icon="more" ariaLabel="More actions" disabled={offline} title={offlineTitle('This')} items={more} /> : null}
          <Button size="sm" variant="ghost" icon="external" onClick={() => openWeb(projectPath(p.id))}>
            Open on the web
          </Button>
          {rebaselining ? <Rebaseline d={d} offline={offline} onClose={() => setRebaselining(false)} onDone={refresh} /> : null}
          {saving ? <SaveAsTemplate d={d} onClose={() => setSaving(false)} onDone={() => (setSaving(false), refresh())} /> : null}
          {dialog}
        </>
      }
    />
  );
}

// ── overview ───────────────────────────────────────────────────────────────

function Overview({ d, onGo }: { d: FullDetail; onGo: (route: string) => void }) {
  const { openLink } = useTab();
  const p = d.project;
  const b = d.budget;
  const cur = b?.currency || p.currency;
  const pr = d.progress ?? { total: 0, done: 0, overdue: 0, blocked: 0, progress: 0 };
  const slip = daysBetween(p.baseline_end_date, p.end_date);
  const late = (slip !== null && slip > 0) || (p.days_left !== null && p.days_left < 0 && p.status !== 'completed');
  const endsSub = p.baseline_end_date && slip !== null ? `baseline ${fmtDay(p.baseline_end_date)}${slip ? ` · ${slip > 0 ? '+' : '−'}${Math.abs(slip)} d` : ' · on baseline'}` : daysLeftText(p.days_left).text || 'no baseline set';
  const health = d.health?.status;
  const warn = health === 'at_risk' || health === 'watch';
  const members = d.members ?? [];
  const roles = new Set(members.map((m) => m.role)).size;
  const openRisks = (d.risks ?? []).filter((r) => r.status === 'open' || r.status === 'mitigating').sort((x, y) => y.score - x.score);
  const milestones = d.milestones ?? [];
  const linked: Array<{ k: string; v: string; go: () => void }> = [];
  const l = d.linked;
  if (l?.drive_files) linked.push({ k: 'Drive', v: `${l.drive_files} file${l.drive_files === 1 ? '' : 's'}`, go: () => onGo(projectPath(p.id, 'files')) });
  if (l?.expense_count) linked.push({ k: 'Expenses', v: `${l.expense_count} claim${l.expense_count === 1 ? '' : 's'} · ${shortMoney(l.expense_total, cur)}`, go: () => openLink('/expenses') });
  if (l?.asset_count) linked.push({ k: 'Assets', v: `${l.asset_count} asset${l.asset_count === 1 ? '' : 's'} on loan`, go: () => openLink('/assets') });
  if (l?.next_event) linked.push({ k: 'Calendar', v: `${l.next_event.title} · ${fmtDay(l.next_event.at)}`, go: () => openLink('/calendar') });
  if (l?.tender) linked.push({ k: 'Tender', v: `${l.tender.code}${l.tender.status ? ` (${l.tender.status})` : ''}`, go: () => openLink('/tenders') });

  const details: Array<[string, ReactNode]> = [
    ['Manager', p.manager ?? '—'],
    ['Client', p.client ?? '—'],
    ['Company', p.org_name ?? '—'],
    ['Priority', PRIORITY[p.priority]?.label ?? p.priority],
    ['Dates', p.start_date || p.end_date ? `${fmtDay(p.start_date)} – ${fmtDay(p.end_date, { year: true })}` : '—'],
    ['Billing', p.is_billable ? `Billable · ${p.currency} ${num(p.hourly_rate)} / h default` : 'Not billable'],
    ['Team', `${members.length} ${members.length === 1 ? 'person' : 'people'} · ${roles} role${roles === 1 ? '' : 's'}`],
  ];
  const link = (label: string, go: () => void) => (
    <button type="button" onClick={go} className="text-[12px] font-semibold text-primary hover:underline">
      {label}
    </button>
  );

  return (
    <div className="grid grid-cols-[minmax(0,1fr)_300px] items-start gap-3.5 px-5 py-3.5">
      <div className="flex min-w-0 flex-col gap-3.5">
        <section aria-label="Figures" className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-2.5">
          <Kpi label="Progress" value={`${Math.round(pr.progress)}%`} sub="weighted by estimate" />
          <Kpi label="Tasks" value={`${pr.done} / ${pr.total}`} sub={`${pr.overdue} overdue · ${pr.blocked} blocked`} />
          <Kpi label="Hours logged" value={num(d.time?.hours)} sub={`of ${num(d.time?.estimate_hours || p.estimated_hours)} estimated`} />
          <Kpi label="Ends" value={fmtDay(p.end_date)} sub={endsSub} tone={late ? 'text-danger' : 'text-ink'} />
          {b ? <Kpi label="Budget used" value={`${Math.round(b.used_percent)}%`} sub={`${shortMoney(b.spent, cur)} of ${shortMoney(b.budget)}${b.over ? ' · over' : ''}`} tone={usedTone(b.used_percent, b.warn_percent)} /> : null}
        </section>

        {warn ? (
          <section aria-label={health === 'at_risk' ? 'Why this project is at risk' : 'Why this project is on watch'} className={cx('flex flex-col gap-1.5 rounded-[12px] px-3.5 py-2.5', health === 'at_risk' ? 'bg-danger-bg text-danger' : 'bg-warning-bg text-warning-ink')}>
            <div className="flex flex-wrap items-center gap-2">
              <Icon name="warning" size={16} />
              <h2 className="text-[13.5px] font-bold">{health === 'at_risk' ? 'Why this project is at risk' : 'Why this project is on watch'}</h2>
              <span className="ms-auto text-[11px]">Arithmetic, not a prediction{b ? ` · warn line ${b.warn_percent}%` : ''}</span>
            </div>
            <ul className="flex flex-col gap-0.5 text-[12.5px]">
              {(d.health.reasons.length ? d.health.reasons : ['No single reason recorded.']).map((r) => (
                <li key={r} className="flex gap-2">
                  <span aria-hidden="true">•</span>
                  <span>{r}</span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {b ? <BudgetCard d={d} onDetail={() => onGo(projectPath(p.id, 'budget'))} /> : null}

        <Panel title="Milestones" action={link(`All ${milestones.length}`, () => onGo(projectPath(p.id, 'milestones')))}>
          <div className="px-3.5 pb-1.5">
            {milestones.length === 0 ? <p className="py-3 text-[12.5px] text-ink-3">No milestones yet.</p> : null}
            {milestones.slice(0, 4).map((m) => {
              const st = MILESTONE_STATE[m.overdue && m.status === 'open' ? 'overdue' : m.status] ?? MILESTONE_STATE.open!;
              const fill = m.status === 'achieved' ? 'bg-success' : m.status === 'missed' || m.overdue ? 'bg-danger' : 'bg-primary';
              return (
                <div key={m.id} className="grid grid-cols-[10px_minmax(0,1fr)_70px_150px_100px] items-center gap-2.5 border-t border-line/70 py-2 text-[12.5px] first:border-t-0">
                  <span aria-hidden="true" className={cx('h-2.5 w-2.5 rounded-full', fill)} />
                  <span className="truncate font-semibold text-ink">{m.name}</span>
                  <span className="text-ink-3">{fmtDay(m.due_date)}</span>
                  <span className="flex items-center gap-1.5">
                    <span aria-hidden="true" className="h-1.5 flex-1 overflow-hidden rounded-full bg-subtle">
                      <span className={cx('block h-full', fill)} style={{ width: `${Math.max(0, Math.min(100, m.progress))}%` }} />
                    </span>
                    <Mono className="text-[11px] text-ink-2">
                      {m.tasks_done}/{m.tasks}
                      <span className="sr-only"> tasks done</span>
                    </Mono>
                  </span>
                  <span>
                    <Chip tone={st.tone}>{st.label}</Chip>
                  </span>
                </div>
              );
            })}
          </div>
        </Panel>
      </div>

      <aside className="flex flex-col gap-3.5">
        <Panel title="Details">
          <dl className="flex flex-col gap-1.5 px-3.5 py-2.5 text-[12.5px]">
            {details.map(([k, v]) => (
              <div key={k} className="flex gap-2">
                <dt className="w-20 shrink-0 text-ink-3">{k}</dt>
                <dd className="min-w-0 font-semibold text-ink">{v}</dd>
              </div>
            ))}
          </dl>
        </Panel>
        <Panel title="Open risks" action={link('Register', () => onGo(projectPath(p.id, 'risks')))}>
          <ul className="flex flex-col gap-2 px-3.5 py-2.5 text-[12px]">
            {openRisks.length === 0 ? <li className="text-ink-3">No open risks.</li> : null}
            {openRisks.slice(0, 5).map((r) => {
              const lv = RISK_LEVEL[r.level] ?? RISK_LEVEL.low!;
              return (
                <li key={r.id} className="flex items-center gap-2">
                  <span title={`${lv.label} risk, score ${r.score}`} className={cx('w-7 shrink-0 rounded-[6px] py-0.5 text-center font-mono text-[11px] font-bold', lv.tone)}>
                    {r.score}
                  </span>
                  <span className="min-w-0 flex-1 text-ink">{r.title}</span>
                  <span className="text-[11px] text-ink-3">{lv.label}</span>
                </li>
              );
            })}
          </ul>
        </Panel>
        <Panel title="Linked">
          <div className="flex flex-col gap-1.5 px-3.5 py-2.5 text-[12px]">
            {linked.length === 0 ? <p className="text-ink-3">Nothing linked yet.</p> : null}
            {linked.map((x) => (
              <button key={x.k} type="button" onClick={x.go} className="flex gap-2 text-start text-primary hover:underline">
                <span className="w-16 shrink-0 text-ink-3">{x.k}</span>
                <span className="min-w-0">{x.v}</span>
              </button>
            ))}
          </div>
        </Panel>
      </aside>
    </div>
  );
}

function BudgetCard({ d, onDetail }: { d: FullDetail; onDetail: () => void }) {
  const b = d.budget;
  const cur = b.currency || d.project.currency;
  const budget = Number(b.budget) || 0;
  const labour = Number(b.labour) || 0;
  const expenses = Number(b.expenses) || 0;
  const spent = Number(b.spent) || labour + expenses;
  const scale = Math.max(budget, spent, 1);
  const overBy = spent - budget;
  return (
    <Panel
      title="Budget vs actual"
      sub={`${cur} · time at member rates + expense claims charged here`}
      action={
        <button type="button" onClick={onDetail} className="text-[12px] font-semibold text-primary hover:underline">
          Detail
        </button>
      }
    >
      <div className="flex flex-col gap-2.5 px-3.5 py-2.5">
        <div role="img" aria-label={`Labour ${num(labour)}, expenses ${num(expenses)}, budget ${num(budget)} ${cur}`} className="relative flex h-[20px] overflow-hidden rounded-[8px] bg-subtle">
          <div className="bg-primary" style={{ width: `${(labour / scale) * 100}%` }} />
          <div className="bg-warning" style={{ width: `${(expenses / scale) * 100}%` }} />
          {budget > 0 && spent > budget ? <div aria-hidden="true" className="absolute inset-y-0 w-0.5 bg-ink" style={{ left: `${(budget / scale) * 100}%` }} /> : null}
        </div>
        <div className="flex flex-wrap gap-x-5 gap-y-1 text-[12px] text-ink-2">
          <span className="flex items-center gap-1.5">
            <span aria-hidden="true" className="h-2.5 w-2.5 rounded-[3px] bg-primary" />
            Labour <b className="font-mono">{num(labour)}</b>
          </span>
          <span className="flex items-center gap-1.5">
            <span aria-hidden="true" className="h-2.5 w-2.5 rounded-[3px] bg-warning" />
            Expenses <b className="font-mono">{num(expenses)}</b> ({b.expense_count} claim{b.expense_count === 1 ? '' : 's'})
          </span>
          <span>
            Budget <b className="font-mono">{num(budget)}</b>
          </span>
          {budget > 0 && overBy > 0 ? (
            <span className="font-semibold text-danger">
              Over by <span className="font-mono">{num(overBy)}</span> · {Math.round(b.used_percent)}%
            </span>
          ) : (
            <span>
              Remaining <b className="font-mono">{num(b.remaining)}</b> · {Math.round(b.used_percent)}% used
            </span>
          )}
        </div>
      </div>
    </Panel>
  );
}

function Files({ d }: { d: FullDetail }) {
  const { openLink } = useTab();
  const n = d.linked?.drive_files ?? null;
  return (
    <div className="px-5 py-3.5">
      <Panel title="Files" sub="Drive files and folders linked to this project">
        <div className="flex flex-col items-start gap-2.5 px-3.5 py-3 text-[12.5px] text-ink-2">
          {n === null ? (
            <p>Drive is not available here, so linked files cannot be counted.</p>
          ) : (
            <p>
              <Mono className="font-bold">{n}</Mono> file{n === 1 ? ' is' : 's are'} linked to {d.project.code} in Drive. Everyone who can see the project can view them.
            </p>
          )}
          <p className="text-ink-3">Link a file from Drive with “Linked records” on the file, choosing this project.</p>
          <Button size="sm" icon="folder" onClick={() => openLink('/files')}>
            Open Drive
          </Button>
        </div>
      </Panel>
    </div>
  );
}

// ── the project's settings: edit, status, baselines, template ──────────────

function ProjectSettings({ d, offline, onGo }: { d: FullDetail; offline: boolean; onGo: (route: string) => void }) {
  const qc = useQueryClient();
  const p = d.project;
  const can = d.can ?? {};
  const money = !!can.budget;
  const ro = !can.manage;
  // The project's own company's clients and people (G-01), whatever the selector says.
  const org = p.org_id;
  const clients = useQuery({ queryKey: pk.clients({ org }), queryFn: ({ signal }) => preads.clients({ org }, { signal }) });
  const cats = useQuery({ queryKey: pk.categories, queryFn: ({ signal }) => preads.categories({ signal }) });
  const people = useQuery({ queryKey: pk.people(org), queryFn: ({ signal }) => preads.people(org, { signal }) });
  const [f, setF] = useState<Record<string, string>>({
    name: p.name,
    client_id: p.client_id ? String(p.client_id) : '',
    category_id: p.category_id ? String(p.category_id) : '',
    manager_id: p.manager_id ? String(p.manager_id) : '',
    priority: p.priority,
    start_date: p.start_date ?? '',
    end_date: p.end_date ?? '',
    estimated_hours: String(Number(p.estimated_hours) || ''),
    budget: String(Number(p.budget) || ''),
    currency: p.currency,
    hourly_rate: String(Number(p.hourly_rate) || ''),
    description: p.description ?? '',
  });
  const [billable, setBillable] = useState(p.is_billable);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [rebaselining, setRebaselining] = useState(false);
  const set = (k: string, v: string) => setF((x) => ({ ...x, [k]: v }));

  const save = async () => {
    if (!f.name?.trim()) return setErr('A project name is required.');
    setBusy(true);
    setErr('');
    try {
      // The update replaces the record, so every field is sent — money as it was when it may not be changed here.
      await pwrites.update(p.id, {
        ...f,
        name: f.name.trim(),
        is_billable: billable,
        client_id: f.client_id || null,
        category_id: f.category_id || null,
        manager_id: f.manager_id || null,
        start_date: f.start_date || null,
        end_date: f.end_date || null,
        budget: money ? f.budget || '0' : p.budget,
        currency: money ? f.currency : p.currency,
        hourly_rate: money ? f.hourly_rate || '0' : p.hourly_rate,
      });
      toast('success', `${p.code} saved`);
      await qc.invalidateQueries({ queryKey: qk.all });
    } catch (e) {
      setErr(errorText(e, 'The project could not be saved.'));
    } finally {
      setBusy(false);
    }
  };

  const sel = (k: string, label: string, opts: Array<{ value: string; label: string }>, empty: string, current?: string | null) => {
    const all = f[k] && !opts.some((o) => o.value === f[k]) ? [...opts, { value: f[k]!, label: current ?? `#${f[k]}` }] : opts;
    return <Select aria-label={label} value={f[k] ?? ''} disabled={ro} onChange={(e) => set(k, e.target.value)} options={[{ value: '', label: empty }, ...all]} className={inputClass} />;
  };
  const baselines = d.baselines ?? [];

  return (
    <div className="grid grid-cols-[minmax(0,1fr)_320px] items-start gap-3.5 px-5 py-3.5">
      <Panel
        title={`Edit ${p.code}`}
        sub={ro ? 'Read only: changing a project needs the Projects manage permission.' : undefined}
        action={
          ro ? null : (
            <Button size="sm" variant="primary" loading={busy} disabled={offline} title={offline ? needsConnection('Saving a project') : undefined} onClick={() => void save()}>
              Save
            </Button>
          )
        }
      >
        <form onSubmit={(e) => (e.preventDefault(), void save())} className="grid grid-cols-2 gap-3 px-3.5 py-3">
          <Field label="Name" required className="col-span-2">
            <input value={f.name ?? ''} disabled={ro} onChange={(e) => set('name', e.target.value)} className={inputClass} />
          </Field>
          <Field label="Client">{sel('client_id', 'Client', (clients.data?.data.clients ?? []).map((c) => ({ value: String(c.id), label: c.name })), 'No client', p.client)}</Field>
          <Field label="Category">{sel('category_id', 'Category', (cats.data?.data.categories ?? []).map((c) => ({ value: String(c.id), label: c.name })), 'None', p.category)}</Field>
          <Field label="Manager">{sel('manager_id', 'Manager', (people.data?.data.people ?? []).map((x) => ({ value: String(x.id), label: x.name })), 'Unassigned', p.manager)}</Field>
          <Field label="Priority">
            <Select aria-label="Priority" value={f.priority ?? 'medium'} disabled={ro} onChange={(e) => set('priority', e.target.value)} options={Object.entries(PRIORITY).map(([value, v]) => ({ value, label: v.label }))} className={inputClass} />
          </Field>
          <Field label="Starts">
            <input type="date" value={f.start_date ?? ''} disabled={ro} onChange={(e) => set('start_date', e.target.value)} className={inputClass} />
          </Field>
          <Field label="Ends" hint={p.baseline_end_date ? `Baseline ${fmtDay(p.baseline_end_date, { year: true })} stays as agreed — re-baseline to move it.` : undefined}>
            <input type="date" value={f.end_date ?? ''} disabled={ro} onChange={(e) => set('end_date', e.target.value)} className={inputClass} />
          </Field>
          <Field label="Estimated hours">
            <input value={f.estimated_hours ?? ''} disabled={ro} inputMode="decimal" onChange={(e) => set('estimated_hours', e.target.value)} className={cx(inputClass, 'font-mono')} />
          </Field>
          <label className="flex items-center gap-2 self-end pb-2 text-[13px] font-semibold text-ink">
            <Checkbox checked={billable} disabled={ro} onChange={(e) => setBillable(e.target.checked)} />
            Billable to the client
          </label>
          <Field label="Budget" className="col-span-2" hint={money ? (p.status === 'active' ? 'Budget changes on an active project go through a change request.' : undefined) : 'Only people who manage budgets can change the budget, currency or rate.'}>
            <span className="grid grid-cols-[minmax(0,1fr)_6rem] gap-2">
              <input aria-label="Budget amount" value={f.budget ?? ''} disabled={ro || !money} inputMode="decimal" onChange={(e) => set('budget', e.target.value)} className={cx(inputClass, 'font-mono')} />
              <input aria-label="Currency" value={f.currency ?? ''} disabled={ro || !money} onChange={(e) => set('currency', e.target.value.toUpperCase().slice(0, 3))} className={cx(inputClass, 'font-mono uppercase')} />
            </span>
          </Field>
          <Field label={`Default hourly rate (${f.currency || p.currency})`}>
            <input value={f.hourly_rate ?? ''} disabled={ro || !money} inputMode="decimal" onChange={(e) => set('hourly_rate', e.target.value)} className={cx(inputClass, 'font-mono')} />
          </Field>
          <Field label="Description" className="col-span-2">
            <textarea value={f.description ?? ''} disabled={ro} rows={3} onChange={(e) => set('description', e.target.value)} className={areaClass} />
          </Field>
          {err ? (
            <div className="col-span-2">
              <ErrorLine>{err}</ErrorLine>
            </div>
          ) : null}
        </form>
      </Panel>

      <aside className="flex flex-col gap-3.5">
        <Panel title="Status">
          <div className="flex flex-col gap-2 px-3.5 py-2.5 text-[12.5px]">
            <span className="flex items-center gap-2 text-ink-2">
              Now <ProjectStatusChip status={p.status} />
            </span>
            {can.manage && d.next_statuses?.length ? (
              <span className="text-ink-3">Use “Move to ▾” above; a move the server needs confirmed asks first.</span>
            ) : (
              <span className="text-ink-3">No moves from here.</span>
            )}
          </div>
        </Panel>
        <Panel
          title="Baseline"
          sub="what was agreed, and every time it moved"
          action={
            can.manage ? (
              <Button size="sm" disabled={offline} title={offline ? needsConnection('Re-baselining') : undefined} onClick={() => setRebaselining(true)}>
                Re-baseline…
              </Button>
            ) : null
          }
        >
          <div className="flex flex-col gap-2 px-3.5 py-2.5 text-[12.5px]">
            <span className="text-ink-2">
              Ends <b className="text-ink">{fmtDay(p.baseline_end_date, { year: true })}</b>
            </span>
            {baselines.length === 0 ? (
              <span className="text-ink-3">Never moved.</span>
            ) : (
              <ol aria-label="Baseline history" className="flex flex-col gap-2">
                {baselines.map((x, i) => (
                  <li key={`${x.set_at}${i}`} className="border-t border-line/70 pt-1.5 first:border-t-0 first:pt-0">
                    <div className="flex flex-wrap items-baseline gap-x-1.5">
                      <b className="text-ink">{fmtDay(x.end_date, { year: true })}</b>
                      {x.budget !== null ? <Mono className="text-[11px] text-ink-2">{shortMoney(x.budget, p.currency)}</Mono> : null}
                      {x.hours !== null ? <Mono className="text-[11px] text-ink-2">{num(x.hours)} h</Mono> : null}
                      {x.change_number ? <Mono className="text-[11px] text-primary">{x.change_number}</Mono> : null}
                    </div>
                    {x.reason ? <div className="text-ink-2">{x.reason}</div> : null}
                    <div className="text-[11px] text-ink-3">
                      {x.set_by ?? 'Someone'} · {fmtDay(x.set_at, { year: true })}
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </div>
        </Panel>
        <Panel title="Template">
          <div className="flex flex-col gap-2 px-3.5 py-2.5 text-[12.5px] text-ink-2">
            <span>{p.is_template ? 'This project is a template: New project offers it.' : 'Not a template.'}</span>
            <button type="button" onClick={() => onGo('/projects/templates')} className="self-start text-[12px] font-semibold text-primary hover:underline">
              All templates
            </button>
            <span className="text-[11.5px] text-ink-3">Mark as template, Save as template and Delete project are under More (…) above.</span>
          </div>
        </Panel>
      </aside>
      {rebaselining ? <Rebaseline d={d} offline={offline} onClose={() => setRebaselining(false)} onDone={() => void qc.invalidateQueries({ queryKey: qk.all })} /> : null}
    </div>
  );
}

function Rebaseline({ d, offline, onClose, onDone }: { d: FullDetail; offline: boolean; onClose: () => void; onDone: () => void }) {
  const p = d.project;
  const [reason, setReason] = useState('');
  const [end, setEnd] = useState(p.end_date ?? '');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const save = async () => {
    if (!reason.trim()) return setErr('Say why the baseline is moving — it is kept with the old one.');
    setBusy(true);
    setErr('');
    try {
      await pwrites.rebaseline(p.id, { reason: reason.trim(), end_date: end || null });
      toast('success', `${p.code} re-baselined`);
      onDone();
      onClose();
    } catch (e) {
      setErr(errorText(e, 'The baseline could not be moved.'));
      setBusy(false);
    }
  };
  return (
    <Modal
      title="Re-baseline"
      onClose={onClose}
      width={460}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={busy} disabled={offline} title={offline ? needsConnection('Re-baselining') : undefined} onClick={() => void save()}>
            Re-baseline
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3 text-[13px]">
        <p className="text-[12px] text-ink-3">
          {p.code} · {p.name}
        </p>
        <p className="text-ink-2">
          The current baseline ends <b>{fmtDay(p.baseline_end_date, { year: true })}</b>. The old baseline stays in the history with your reason.
        </p>
        <Field label="New baseline end">
          <input type="date" value={end} onChange={(e) => setEnd(e.target.value)} className={inputClass} />
        </Field>
        <Field label="Reason" required>
          <textarea autoFocus value={reason} rows={3} onChange={(e) => setReason(e.target.value)} className={areaClass} />
        </Field>
        {err ? <ErrorLine>{err}</ErrorLine> : null}
      </div>
    </Modal>
  );
}
