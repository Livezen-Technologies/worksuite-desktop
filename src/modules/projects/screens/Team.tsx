import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent, type ReactNode } from 'react';
import { toast } from '../../../core/toasts';
import { Select } from '../../../components/Select';
import { Avatar, Button, Modal, cx } from '../../../components/ui';
import { qk } from '../api';
import { ROLE, errorText, fmtDay, hm, num, pk, preads, pwrites, usedFill, type FullDetail, type Member, type MemberRole, type WorkloadGrid } from '../portfolio';
import { Chip, ErrorLine, Failed, Field, Loading, Mono, Nothing, Panel, TD, TH, inputClass, needsConnection, useAsk } from './kit';

/**
 * W05 · A project's team, roles and capacity (PRJ-MEM): who is on it, at what role, capacity and rate, how loaded each
 * person is, a week-by-week load grid, adding someone, editing and removing members, and re-adding former members
 * (their logged time stays at their rate). Load is arithmetic — open estimate ÷ weekly capacity — and every cell prints
 * its percentage, so colour is never the only signal. Every change needs WorkSuite (disabled offline).
 */

const ROLES: MemberRole[] = ['lead', 'member', 'reviewer', 'observer'];

/** Heat cell colours: the number is in the cell too. */
function heatTone(p: number | null): string {
  if (p === null || p <= 0) return 'bg-ground text-ink-3';
  if (p > 100) return 'bg-danger-bg font-bold text-danger';
  if (p > 85) return 'bg-warning-bg text-warning-ink';
  if (p > 50) return 'bg-selection text-primary';
  return 'bg-subtle text-ink-2';
}

export function ProjectTeam({ detail, offline }: { detail: FullDetail; offline: boolean }) {
  const qc = useQueryClient();
  const projectId = detail.project.id;
  const { confirm, dialog } = useAsk();
  const [editing, setEditing] = useState<Member | null>(null);
  const work = useQuery({ queryKey: pk.workload(projectId), queryFn: ({ signal }) => preads.workload(projectId, { signal }) });
  const can = detail.can ?? {};
  const currency = detail.project.currency;
  const refresh = () => void qc.invalidateQueries({ queryKey: qk.all });
  const offlineTitle = (what: string) => (offline ? needsConnection(what) : undefined);

  const remove = async (m: Member) => {
    if (!(await confirm({ title: `Remove ${m.name}?`, message: 'They come off the project and its task pickers. Time they logged stays on the project at their rate.', confirmLabel: 'Remove', danger: true }))) return;
    try {
      await pwrites.removeMember(projectId, m.id);
      toast('success', `${m.name} removed`);
      refresh();
    } catch (e) {
      toast('error', errorText(e, 'They could not be removed.'));
    }
  };

  const readd = async (id: number, name: string) => {
    try {
      await pwrites.readdMember(projectId, id);
      toast('success', `${name} is back on the project`);
      refresh();
    } catch (e) {
      toast('error', errorText(e, 'They could not be re-added.'));
    }
  };

  return (
    <div className="grid grid-cols-[minmax(0,1fr)_300px] items-start gap-3.5 px-5 py-3.5">
      <div className="flex min-w-0 flex-col gap-3.5">
        <Panel className="overflow-hidden">
          <div className="overflow-x-auto scroll-thin">
            <table className="w-full min-w-[720px] border-collapse">
              <caption className="sr-only">Members of {detail.project.name}</caption>
              <thead className="bg-ground">
                <tr>
                  <th scope="col" className={TH}>Person</th>
                  <th scope="col" className={TH}>Role</th>
                  <th scope="col" className={cx(TH, 'text-end')}>Capacity / wk</th>
                  <th scope="col" className={cx(TH, 'text-end')}>Rate ({currency}/h)</th>
                  <th scope="col" className={cx(TH, 'text-end')}>Open tasks</th>
                  <th scope="col" className={cx(TH, 'text-end')}>Open estimate</th>
                  <th scope="col" className={cx(TH, 'w-36')}>Load</th>
                  <th scope="col" className={TH}>
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {detail.members.map((m) => {
                  const role = ROLE[m.role] ?? ROLE.member!;
                  const cap = Number(m.capacity_hours);
                  const rate = Number(m.hourly_rate);
                  return (
                    <tr key={m.id} className="border-t border-line/70">
                      <td className={TD}>
                        <div className="flex items-center gap-2">
                          <Avatar name={m.name} size={26} />
                          <span className="min-w-0">
                            <span className="block font-semibold text-ink">{m.name}</span>
                            <span className="block truncate text-[11px] text-ink-3">{m.email}</span>
                          </span>
                        </div>
                      </td>
                      <td className={TD}>
                        <Chip tone={role.tone}>{role.label}</Chip>
                      </td>
                      <td className={cx(TD, 'text-end font-mono')}>{cap > 0 ? `${num(cap)} h` : '—'}</td>
                      <td className={cx(TD, 'text-end font-mono')}>{rate > 0 ? num(rate) : '—'}</td>
                      <td className={cx(TD, 'text-end font-mono')}>{m.open_tasks}</td>
                      <td className={cx(TD, 'text-end font-mono')}>{num(m.open_estimate_hours)} h</td>
                      <td className={TD}>
                        <Load pct={m.load_percent} />
                      </td>
                      <td className={cx(TD, 'text-end whitespace-nowrap')}>
                        {can.manage ? (
                          <span className="flex justify-end gap-1.5">
                            <Button size="sm" aria-label={`Edit ${m.name}`} disabled={offline} title={offlineTitle('Editing a member')} onClick={() => setEditing(m)}>
                              Edit
                            </Button>
                            {m.role !== 'manager' ? (
                              <Button size="sm" variant="danger" aria-label={`Remove ${m.name}`} disabled={offline} title={offlineTitle('Removing a member')} onClick={() => void remove(m)}>
                                Remove
                              </Button>
                            ) : null}
                          </span>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {detail.members.length === 0 ? <Nothing text="Nobody is on this project yet." /> : null}
        </Panel>
        <Panel title="Load by week" sub="estimated hours of tasks due that week ÷ capacity">
          <div className="p-3">{work.isLoading ? <Loading /> : !work.data ? <Failed error={work.error} onRetry={() => void work.refetch()} /> : <Heat grid={work.data.data} />}</div>
        </Panel>
      </div>
      <aside className="flex flex-col gap-3.5">
        {can.manage ? <AddSomeone detail={detail} offline={offline} onDone={refresh} /> : null}
        {(detail.former_members ?? []).length > 0 ? (
          <Panel title="Former members">
            <div className="flex flex-col gap-2.5 px-3.5 py-3 text-[12.5px]">
              {detail.former_members.map((f) => (
                <div key={f.id} className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 text-ink">
                    {f.name}
                    <span className="block text-[11px] text-ink-3">
                      {ROLE[f.role]?.label ?? f.role} · left {fmtDay(f.left_at)} · {hm(f.minutes)} logged
                    </span>
                  </span>
                  {can.manage ? (
                    <Button size="sm" aria-label={`Re-add ${f.name}`} disabled={offline} title={offlineTitle('Re-adding a member')} onClick={() => void readd(f.id, f.name)}>
                      Re-add
                    </Button>
                  ) : null}
                </div>
              ))}
              <p className="text-[11px] text-ink-3">Time they logged stays on the project at their rate.</p>
            </div>
          </Panel>
        ) : null}
      </aside>
      {editing ? <EditMember projectId={projectId} m={editing} currency={currency} offline={offline} onClose={() => setEditing(null)} onDone={refresh} /> : null}
      {dialog}
    </div>
  );
}

function Load({ pct }: { pct: number | null }) {
  if (pct === null) return <span className="text-ink-3">—</span>;
  return (
    <span className="flex items-center gap-1.5">
      <span aria-hidden="true" className="h-[7px] flex-1 overflow-hidden rounded-full bg-subtle">
        <span className={cx('block h-full rounded-full', usedFill(pct))} style={{ width: `${Math.min(100, Math.max(0, pct))}%` }} />
      </span>
      <Mono className={cx('w-11 text-end text-[11px]', pct > 100 ? 'font-bold text-danger' : 'text-ink-2')}>
        {Math.round(pct)}%{pct > 100 ? <span className="sr-only"> overloaded</span> : null}
      </Mono>
    </span>
  );
}

function EditMember({ projectId, m, currency, offline, onClose, onDone }: { projectId: number; m: Member; currency: string; offline: boolean; onClose: () => void; onDone: () => void }) {
  const [role, setRole] = useState<string>(m.role);
  const [cap, setCap] = useState(String(Number(m.capacity_hours) || ''));
  const [rate, setRate] = useState(Number(m.hourly_rate) ? String(Number(m.hourly_rate)) : '');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    setErr('');
    try {
      await pwrites.updateMember(projectId, m.id, { role, capacity_hours: cap.trim() || '0', hourly_rate: rate.trim() });
      toast('success', `${m.name} updated`);
      onDone();
      onClose();
    } catch (e) {
      setErr(errorText(e, 'The change could not be saved.'));
      setBusy(false);
    }
  };
  return (
    <Modal
      title={`Edit ${m.name}`}
      onClose={onClose}
      width={420}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={busy} disabled={offline} title={offline ? needsConnection('Saving') : undefined} onClick={() => void save()}>
            Save
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <p className="text-[12px] text-ink-3">{m.email}</p>
        <Field label="Role">
          <Select aria-label="Role" value={role} disabled={m.role === 'manager'} onChange={(e) => setRole(e.target.value)} options={(m.role === 'manager' ? (['manager'] as MemberRole[]) : ROLES).map((r) => ({ value: r, label: ROLE[r]!.label }))} className={inputClass} />
        </Field>
        <Field label="Hours a week on this project">
          <input value={cap} onChange={(e) => setCap(e.target.value)} inputMode="decimal" className={cx(inputClass, 'font-mono')} />
        </Field>
        <Field label={`Hourly rate (${currency})`} hint="Blank = the project rate. Time already logged keeps the rate it was logged at.">
          <input value={rate} onChange={(e) => setRate(e.target.value)} inputMode="decimal" className={cx(inputClass, 'font-mono')} />
        </Field>
        {err ? <ErrorLine>{err}</ErrorLine> : null}
      </div>
    </Modal>
  );
}

function AddSomeone({ detail, offline, onDone }: { detail: FullDetail; offline: boolean; onDone: () => void }) {
  // Only people who work for the project's company may join it (G-01) — the server's own rule.
  const org = detail.project.org_id;
  const people = useQuery({ queryKey: pk.people(org), queryFn: ({ signal }) => preads.people(org, { signal }) });
  const [user, setUser] = useState('');
  const [role, setRole] = useState<MemberRole>('member');
  const [cap, setCap] = useState('');
  const [rate, setRate] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const taken = new Set(detail.members.map((m) => m.user_id));
  const choices = (people.data?.data.people ?? []).filter((p) => !taken.has(p.id));
  const projectRate = Number(detail.project.hourly_rate);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!user) return setErr('Choose who to add.');
    setBusy(true);
    setErr('');
    try {
      await pwrites.addMember(detail.project.id, { user_id: Number(user), role, capacity_hours: cap.trim() || '0', hourly_rate: rate.trim() });
      toast('success', `${choices.find((p) => p.id === Number(user))?.name ?? 'They'} added to the project`);
      setUser('');
      setCap('');
      setRate('');
      onDone();
    } catch (e2) {
      setErr(errorText(e2, 'They could not be added.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Panel title="Add someone">
      <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-2.5 px-3.5 py-3">
        <Field label="Person">
          <Select aria-label="Person" searchable value={user} onChange={(e) => setUser(e.target.value)} placeholder={people.isLoading ? 'Loading people…' : 'Choose a person…'} options={choices.map((p) => ({ value: String(p.id), label: `${p.name}${p.employee_no ? ` · ${p.employee_no}` : ''}` }))} className={inputClass} />
        </Field>
        <Field label="Role">
          <Select aria-label="Role" value={role} onChange={(e) => setRole(e.target.value as MemberRole)} options={ROLES.map((r) => ({ value: r, label: ROLE[r]!.label }))} className={inputClass} />
        </Field>
        <Field label="Hours a week on this project">
          <input value={cap} onChange={(e) => setCap(e.target.value)} inputMode="decimal" placeholder="20" className={cx(inputClass, 'font-mono')} />
        </Field>
        <Field label={`Hourly rate (${detail.project.currency})`} hint="blank = project rate">
          <input value={rate} onChange={(e) => setRate(e.target.value)} inputMode="decimal" placeholder={projectRate > 0 ? num(projectRate, 2) : ''} className={cx(inputClass, 'font-mono')} />
        </Field>
        {err ? <ErrorLine>{err}</ErrorLine> : null}
        <Button type="submit" variant="primary" loading={busy} disabled={offline} title={offline ? needsConnection('Adding someone') : undefined}>
          Add to project
        </Button>
      </form>
    </Panel>
  );
}

function Heat({ grid }: { grid: WorkloadGrid }) {
  if (!grid.people?.length) return <Nothing text="No one has capacity or open work in these weeks." />;
  const head = (children: ReactNode, k: string) => (
    <th key={k} scope="col" className="px-1 py-1 text-center text-[11px] font-normal text-ink-3">
      {children}
    </th>
  );
  return (
    <div className="overflow-x-auto scroll-thin">
      <table className="w-full min-w-[520px] border-separate border-spacing-1 text-[11px]">
        <caption className="sr-only">Load by week, as a percentage of capacity</caption>
        <thead>
          <tr>
            <th scope="col" className="w-36">
              <span className="sr-only">Person</span>
            </th>
            {grid.weeks.map((w) => head(fmtDay(w), w))}
          </tr>
        </thead>
        <tbody>
          {grid.people.map((p) => (
            <tr key={p.user_id}>
              <th scope="row" className="px-1 py-1.5 text-start text-[12px] font-normal whitespace-nowrap text-ink-2">
                {p.name}
              </th>
              {p.cells.map((c, i) => (
                <td key={grid.weeks[i] ?? i} title={`${num(c.hours, 1)} h of ${num(c.capacity, 1)} h`} className={cx('rounded-[6px] py-1.5 text-center font-mono', heatTone(c.percent))}>
                  {c.percent ? `${Math.round(c.percent)}%` : '—'}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
