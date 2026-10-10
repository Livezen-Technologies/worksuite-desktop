import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useId, useState, type ReactNode } from 'react';
import { toast } from '../../../core/toasts';
import { Checkbox } from '../../../components/Checkbox';
import { Select } from '../../../components/Select';
import { Button, cx } from '../../../components/ui';
import { qk, statusLabel, type TaskStatus } from '../api';
import { BOARD_COLUMNS } from '../logic';
import { openWeb } from '../parts';
import { errorText, pk, preads, pwrites, usePermission, type AlertKey, type Category, type Settings } from '../portfolio';
import { Failed, Loading, Mono, Panel, inputClass, needsConnection, useAsk } from './kit';

/**
 * W17 · Projects module settings (PRJ-NTF, PRJ-BUD), natively: numbering, money, planning, time, the board's WIP limits,
 * which alerts the module sends, and project categories. The other sections in the design — User access, Permissions,
 * Organization, Notifications, Advanced — are the platform's own module-settings pages: they open on the web, so each
 * is edited in one place.
 *
 * Only `project.settings` holders may save (the endpoint enforces the same); anyone else who reaches it reads it.
 * Saving needs WorkSuite (disabled offline).
 */

const OTHER_TABS: Array<{ label: string; to: string }> = [
  { label: 'User access', to: '/module-settings?module=project&section=access' },
  { label: 'Permissions', to: '/permissions' },
  { label: 'Organization', to: '/module-settings?module=project&section=organization' },
  { label: 'Notifications', to: '/module-settings?module=project&section=notifications' },
  { label: 'Advanced', to: '/module-settings?module=project&section=advanced' },
];

const ALERTS: Array<{ key: AlertKey; label: string; to: string }> = [
  { key: 'task_assigned', label: 'Task assigned to you', to: 'assignee' },
  { key: 'task_overdue', label: 'Task overdue (daily)', to: 'assignee' },
  { key: 'milestone_due', label: 'Milestone due within 7 days', to: 'owner or manager' },
  { key: 'milestone_achieved', label: 'Milestone achieved', to: 'project team' },
  { key: 'budget_warn', label: 'Budget passes the warn line', to: 'manager' },
  { key: 'sprint_ending', label: 'Sprint ends tomorrow', to: 'manager' },
  { key: 'change_waiting', label: 'Change request waiting for you', to: 'approvers' },
  { key: 'change_decided', label: 'Change request decided', to: 'requester' },
  { key: 'time_sent_back', label: 'Time sent back', to: 'person who logged it' },
  { key: 'added_to_project', label: 'Added to a project', to: 'new member' },
];

const WEEKDAYS = [
  { n: 1, label: 'Mon' },
  { n: 2, label: 'Tue' },
  { n: 3, label: 'Wed' },
  { n: 4, label: 'Thu' },
  { n: 5, label: 'Fri' },
  { n: 6, label: 'Sat' },
  { n: 7, label: 'Sun' },
];

/** The six board columns of the web's settings (blocked and cancelled are states, not columns). */
const WIP_COLUMNS: TaskStatus[] = ['backlog', ...BOARD_COLUMNS];

/** What the next project code would be with this prefix and width — from the number `next_code` carries. */
export function previewCode(s: Pick<Settings, 'project_prefix' | 'number_pad' | 'next_code'>): string {
  const n = Number(/(\d+)\D*$/.exec(s.next_code ?? '')?.[1] ?? 1);
  return `${s.project_prefix}-${String(n).padStart(Math.max(1, s.number_pad || 1), '0')}`;
}

export function ModuleSettings({ offline, onOffline }: { offline: boolean; onOffline: (o: boolean) => void }) {
  const may = usePermission();
  const q = useQuery({ queryKey: pk.settings, queryFn: ({ signal }) => preads.settings({ signal }) });
  const fromCache = !!q.data?.offline;
  useEffect(() => onOffline(fromCache), [fromCache, onOffline]);
  const mayEdit = q.data?.data.can?.settings ?? may('project.settings');
  if (q.isLoading) return <Loading label="Loading settings" />;
  if (!q.data) return <Failed error={q.error} onRetry={() => void q.refetch()} />;
  return <Form key={JSON.stringify(q.data.data.settings)} initial={q.data.data.settings} mayEdit={mayEdit} offline={offline} />;
}

function Form({ initial, mayEdit, offline }: { initial: Settings; mayEdit: boolean; offline: boolean }) {
  const qc = useQueryClient();
  const [s, setS] = useState<Settings>({ ...initial, working_days: initial.working_days ?? [], wip_limits: initial.wip_limits ?? {}, alerts: initial.alerts ?? {} });
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => setS((p) => ({ ...p, [k]: v }));
  const dirty = JSON.stringify(s) !== JSON.stringify({ ...initial, working_days: initial.working_days ?? [], wip_limits: initial.wip_limits ?? {}, alerts: initial.alerts ?? {} });
  const ro = !mayEdit;

  const save = async () => {
    setBusy(true);
    try {
      // holiday_calendar and next_code are read-only: they come from HR and from the numbering, and are not sent back.
      await pwrites.saveSettings({
        project_prefix: s.project_prefix.trim(),
        task_prefix: s.task_prefix.trim(),
        change_prefix: s.change_prefix.trim(),
        number_pad: Number(s.number_pad),
        default_currency: s.default_currency.trim().toUpperCase(),
        reporting_currency: s.reporting_currency.trim().toUpperCase(),
        budget_warn_percent: Number(s.budget_warn_percent),
        working_hours_per_day: Number(s.working_hours_per_day),
        working_days: [...s.working_days].sort((a, b) => a - b),
        time_approvers: s.time_approvers,
        max_entry_hours: Number(s.max_entry_hours),
        wip_limits: s.wip_limits,
        alerts: s.alerts,
      });
      toast('success', 'Settings saved');
      await qc.invalidateQueries({ queryKey: qk.all });
    } catch (e) {
      toast('error', errorText(e, 'The settings could not be saved.'));
    } finally {
      setBusy(false);
    }
  };
  const numIn = (k: keyof Settings) => (e: React.ChangeEvent<HTMLInputElement>) => set(k, (e.target.value === '' ? '' : Number(e.target.value)) as never);
  const mono = cx(inputClass, 'font-mono');

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="shrink-0 border-b border-line bg-surface px-5 pt-3.5">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-[20px] font-bold text-ink">Projects settings</h1>
          {mayEdit ? (
            <Button size="sm" variant="primary" className="ms-auto" loading={busy} disabled={!dirty || offline} title={offline ? needsConnection('Saving settings') : undefined} onClick={() => void save()}>
              Save
            </Button>
          ) : (
            <span className="ms-auto text-[12px] text-ink-3">Read only: changing these needs the Projects settings permission.</span>
          )}
        </div>
        <nav aria-label="Settings sections" className="mt-2 flex gap-0.5 overflow-x-auto">
          <span aria-current="page" className="-mb-px border-b-2 border-primary px-2.5 py-1.5 text-[12.5px] font-bold whitespace-nowrap text-primary">
            General
          </span>
          {OTHER_TABS.map((t) => (
            <button key={t.label} type="button" onClick={() => openWeb(t.to)} title="Opens on the web" className="-mb-px border-b-2 border-transparent px-2.5 py-1.5 text-[12.5px] font-semibold whitespace-nowrap text-ink-2 hover:text-ink">
              {t.label}
            </button>
          ))}
        </nav>
      </header>
      <div className="grid min-h-0 flex-1 content-start gap-3.5 overflow-y-auto px-5 py-3.5 scroll-thin lg:grid-cols-2">
        <Group title="Numbering">
          <Row label="Project code prefix" hint={<>Next: <Mono>{previewCode(s)}</Mono>. Existing codes are not renumbered.</>}>
            {(id) => <input id={id} value={s.project_prefix} maxLength={10} disabled={ro} onChange={(e) => set('project_prefix', e.target.value)} className={mono} />}
          </Row>
          <Row label="Task number prefix">{(id) => <input id={id} value={s.task_prefix} maxLength={10} disabled={ro} onChange={(e) => set('task_prefix', e.target.value)} className={mono} />}</Row>
          <Row label="Change request prefix">{(id) => <input id={id} value={s.change_prefix} maxLength={10} disabled={ro} onChange={(e) => set('change_prefix', e.target.value)} className={mono} />}</Row>
          <Row label="Digits in the running number" hint="Widening does not re-pad codes already issued.">
            {(id) => <input id={id} type="number" min={1} max={10} value={s.number_pad} disabled={ro} onChange={numIn('number_pad')} className={mono} />}
          </Row>
        </Group>
        <Group title="Money">
          <Row label="Default currency" hint="For projects that do not name their own.">
            {(id) => <input id={id} value={s.default_currency} maxLength={3} disabled={ro} onChange={(e) => set('default_currency', e.target.value)} className={cx(mono, 'uppercase')} />}
          </Row>
          <Row label="Reporting currency" hint="Portfolio totals convert each project at the day’s rate.">
            {(id) => (
              <span className="flex items-center gap-2">
                <input id={id} value={s.reporting_currency} maxLength={3} disabled={ro} onChange={(e) => set('reporting_currency', e.target.value)} className={cx(mono, 'w-24 uppercase')} />
                <span className="text-[12px] text-ink-3">Finance rates</span>
              </span>
            )}
          </Row>
          <Row label="Warn the manager at" hint="Re-arms when the budget is raised.">
            {(id) => (
              <span className="flex items-center gap-2">
                <input id={id} type="number" min={1} max={100} value={s.budget_warn_percent} disabled={ro} onChange={numIn('budget_warn_percent')} className={cx(mono, 'w-24')} />
                <span className="text-[12px] text-ink-3">% of budget</span>
              </span>
            )}
          </Row>
        </Group>
        <Group title="Planning">
          <Row label="Working hours in a day" hint="Turns estimates into days on the timeline.">
            {(id) => <input id={id} type="number" min={1} max={24} step="0.5" value={s.working_hours_per_day} disabled={ro} onChange={numIn('working_hours_per_day')} className={cx(mono, 'w-24')} />}
          </Row>
          <fieldset className="grid gap-2 sm:grid-cols-[200px_minmax(0,1fr)]">
            <legend className="sr-only">Working days</legend>
            <span aria-hidden="true" className="pt-1.5 text-[12.5px] font-semibold text-ink">
              Working days
            </span>
            <span className="flex flex-col gap-1">
              <span className="flex flex-wrap gap-x-3 gap-y-1.5 pt-1.5">
                {WEEKDAYS.map((d) => (
                  <label key={d.n} className="flex items-center gap-1.5 text-[12.5px] text-ink">
                    <Checkbox disabled={ro} checked={s.working_days.includes(d.n)} onChange={(e) => set('working_days', e.target.checked ? [...s.working_days, d.n] : s.working_days.filter((x) => x !== d.n))} />
                    {d.label}
                  </label>
                ))}
              </span>
              <span className="text-[11.5px] text-ink-3">The timeline skips the rest.</span>
            </span>
          </fieldset>
          <Row label="Holiday calendar" hint="From HR.">
            {(id) => (
              <output id={id} className={cx(inputClass, 'flex items-center bg-ground text-ink-2')}>
                {s.holiday_calendar ?? 'None set in HR'}
              </output>
            )}
          </Row>
        </Group>
        <Group title="Time">
          <Row label="Who approves time" hint="Never the person who logged it.">
            {(id) => (
              <Select
                id={id}
                aria-label="Who approves time"
                value={s.time_approvers}
                disabled={ro}
                onChange={(e) => set('time_approvers', e.target.value as Settings['time_approvers'])}
                options={[
                  { value: 'manager_and_leads', label: 'Project manager and leads' },
                  { value: 'manager_only', label: 'Project manager only' },
                ]}
                className={inputClass}
              />
            )}
          </Row>
          <Row label="Lock time after">
            {(id) => (
              <output id={id} className={cx(inputClass, 'flex items-center bg-ground text-ink-2')}>
                Approval, HR submission or invoicing
              </output>
            )}
          </Row>
          <Row label="Longest single entry">
            {(id) => (
              <span className="flex items-center gap-2">
                <input id={id} type="number" min={1} max={24} value={s.max_entry_hours} disabled={ro} onChange={numIn('max_entry_hours')} className={cx(mono, 'w-24')} />
                <span className="text-[12px] text-ink-3">hours</span>
              </span>
            )}
          </Row>
        </Group>
        <Group title="Board · WIP limits" sub="The most cards a column should hold. Empty means no limit.">
          <div className="grid grid-cols-3 gap-2.5">
            {WIP_COLUMNS.map((col) => (
              <label key={col} className="flex flex-col gap-1 text-[12.5px]">
                <span className="font-semibold text-ink">{statusLabel(col)}</span>
                <input
                  type="number"
                  min={1}
                  disabled={ro}
                  placeholder="No limit"
                  value={s.wip_limits[col] ?? ''}
                  onChange={(e) => {
                    const v = Number(e.target.value);
                    const next = { ...s.wip_limits };
                    if (e.target.value === '' || !(v > 0)) delete next[col];
                    else next[col] = v;
                    set('wip_limits', next);
                  }}
                  className={mono}
                />
              </label>
            ))}
          </div>
        </Group>
        <Categories mayEdit={mayEdit} offline={offline} />
        <Panel className="gap-2 px-3.5 py-3 lg:col-span-2">
          <div className="flex flex-wrap items-baseline gap-x-2.5">
            <h2 className="text-[14px] font-bold text-ink">Alerts this module sends</h2>
            <span className="text-[11.5px] text-ink-3">each one can be switched off per person on the Notifications screen</span>
          </div>
          <div className="grid gap-x-6 sm:grid-cols-2">
            {ALERTS.map((a) => (
              <label key={a.key} className="flex items-center gap-2.5 border-t border-line/70 py-1.5 text-[12.5px] text-ink">
                <Checkbox disabled={ro} checked={s.alerts[a.key] ?? false} onChange={(e) => set('alerts', { ...s.alerts, [a.key]: e.target.checked })} />
                <span className="flex-1">{a.label}</span>
                <span className="text-[11px] text-ink-3">{a.to}</span>
              </label>
            ))}
          </div>
        </Panel>
      </div>
    </div>
  );
}

function Group({ title, sub, children }: { title: string; sub?: string; children: ReactNode }) {
  return (
    <Panel className="gap-2.5 px-3.5 py-3">
      <div>
        <h2 className="text-[14px] font-bold text-ink">{title}</h2>
        {sub ? <p className="text-[11.5px] text-ink-3">{sub}</p> : null}
      </div>
      {children}
    </Panel>
  );
}

/** Label left, control right. */
function Row({ label, hint, children }: { label: string; hint?: ReactNode; children: (id: string) => ReactNode }) {
  const id = useId();
  return (
    <div className="grid items-start gap-x-2.5 gap-y-1 sm:grid-cols-[200px_minmax(0,1fr)]">
      <label htmlFor={id} className="text-[12.5px] font-semibold text-ink sm:pt-1.5">
        {label}
      </label>
      <span className="flex flex-col gap-1">
        {children(id)}
        {hint ? <span className="text-[11.5px] text-ink-3">{hint}</span> : null}
      </span>
    </div>
  );
}

function Categories({ mayEdit, offline }: { mayEdit: boolean; offline: boolean }) {
  const qc = useQueryClient();
  const { prompt, dialog } = useAsk();
  const q = useQuery({ queryKey: pk.categories, queryFn: ({ signal }) => preads.categories({ signal }) });
  const rows = q.data?.data.categories ?? [];
  const refresh = () => qc.invalidateQueries({ queryKey: pk.categories });
  const edit = mayEdit && !offline;

  const add = async () => {
    const name = await prompt({ title: 'Add category', confirmLabel: 'Add', input: { label: 'Name', value: '', required: true } });
    if (!name?.trim()) return;
    try {
      await pwrites.createCategory({ name: name.trim() });
      toast('success', 'Category added');
      await refresh();
    } catch (e) {
      toast('error', errorText(e));
    }
  };
  const rename = async (c: Category) => {
    const name = await prompt({ title: `Rename ${c.name}`, confirmLabel: 'Rename', input: { label: 'Name', value: c.name, required: true } });
    if (!name?.trim() || name.trim() === c.name) return;
    try {
      await pwrites.updateCategory(c.id, { name: name.trim() });
      await refresh();
    } catch (e) {
      toast('error', errorText(e));
    }
  };
  const colour = async (c: Category, color: string) => {
    try {
      await pwrites.updateCategory(c.id, { color });
      await refresh();
    } catch (e) {
      toast('error', errorText(e));
    }
  };

  return (
    <Panel className="gap-2 px-3.5 py-3">
      <div className="flex items-center gap-2">
        <h2 className="text-[14px] font-bold text-ink">Categories</h2>
        {mayEdit ? (
          <Button size="sm" icon="plus" className="ms-auto" disabled={offline} title={offline ? needsConnection('Adding a category') : undefined} onClick={() => void add()}>
            Add category
          </Button>
        ) : null}
      </div>
      {q.isLoading ? (
        <Loading />
      ) : !q.data ? (
        <Failed error={q.error} onRetry={() => void q.refetch()} />
      ) : rows.length === 0 ? (
        <p className="text-[12.5px] text-ink-3">No categories yet.</p>
      ) : (
        <ul className="flex flex-col">
          {rows.map((c) => (
            <li key={c.id} className="flex items-center gap-2.5 border-t border-line/70 py-1.5 text-[12.5px] first:border-t-0">
              {edit ? <ColourInput name={c.name} value={c.color ?? '#64748b'} onSave={(v) => void colour(c, v)} /> : <span aria-hidden="true" className="h-3 w-3 shrink-0 rounded-full" style={{ background: c.color ?? '#64748b' }} />}
              <span className="min-w-0 flex-1 truncate font-semibold text-ink">
                {c.name}
                {c.status === 'archived' ? <span className="font-normal text-ink-3"> · archived</span> : null}
              </span>
              <span className="text-[11.5px] text-ink-3">
                <Mono>{c.projects}</Mono> project{c.projects === 1 ? '' : 's'}
              </span>
              {mayEdit ? (
                <Button size="sm" variant="ghost" aria-label={`Rename ${c.name}`} disabled={offline} onClick={() => void rename(c)}>
                  Rename
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {dialog}
    </Panel>
  );
}

/** A colour picker that saves once, when the person is done, not on every step of a drag. */
function ColourInput({ name, value, onSave }: { name: string; value: string; onSave: (v: string) => void }) {
  const [v, setV] = useState(value);
  return (
    <input
      type="color"
      aria-label={`Colour of ${name}`}
      value={v}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => {
        if (v !== value) onSave(v);
      }}
      className="h-6 w-6 shrink-0 cursor-pointer rounded-[5px] border border-line bg-surface p-0"
    />
  );
}
