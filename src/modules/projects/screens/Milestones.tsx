import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { errorMessage } from '../../../core/bridge';
import { useTab } from '../../../core/tab-context';
import { toast } from '../../../core/toasts';
import { Select } from '../../../components/Select';
import { Button, ErrorNote, Modal, Spinner, cx } from '../../../components/ui';
import { qk } from '../api';
import { useProjectCompany } from '../company';
import { INVOICE_STATE, MILESTONE_STATE, daysLeftText, dqk, dread, dwrite, fmtDay, num, statusOf, type Milestone, type MilestoneInvoiceResult } from '../delivery';
import { openWeb } from '../parts';
import { Chip, Confirm, Field, MoneyBasis, Mono, NEEDS_CONNECTION, PageHead, ProjectPick, Tabs, areaClass, inputClass, useLiveProjects, useMembers, useReportOffline } from './kit';

/**
 * W10 · Milestones & billing (PRJ-MIL), in the desktop. A milestone carries a due date, an owner, the tasks under it
 * and, when billable, an amount. Achieving it makes it "ready to invoice"; the panel on the right hands every ready
 * one to Billing ("Draft invoices in Billing"; a row's Raise invoice hands just that one) and then lists the drafts
 * as links into Billing, each "Draft #id" until Billing issues it with a number, and names anything Billing could
 * not take.
 *
 * Marking one achieved while tasks under it are open is allowed, never silently: the server answers 409, "Mark
 * achieved anyway?" names the open-task count and asks for a reason, and the retry sends force + reason.
 *
 * Every change needs WorkSuite: offline the list is the kept copy and the actions wait for a connection.
 */

type Tab = 'open' | 'overdue' | 'achieved' | 'missed' | 'all';

export function MilestonesScreen({ projectId, offline, onOffline }: { projectId: number | null; offline: boolean; onOffline: (o: boolean) => void }) {
  const qc = useQueryClient();
  const { openLink } = useTab();
  useProjectCompany();
  const [tab, setTab] = useState<Tab>('open');
  const [filter, setFilter] = useState<number | null>(null);
  const [editing, setEditing] = useState<Milestone | 'new' | null>(null);
  const [deleting, setDeleting] = useState<Milestone | null>(null);
  const [anyway, setAnyway] = useState<{ m: Milestone; message: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [billingMsg, setBillingMsg] = useState<string | null>(null);
  const [drafted, setDrafted] = useState<MilestoneInvoiceResult | null>(null);

  const pid = projectId ?? filter;
  const params = { status: tab, project_id: pid };
  const q = useQuery({ queryKey: dqk.milestones(params), queryFn: ({ signal }) => dread.milestones(params, { signal }) });
  useReportOffline(!!q.data?.offline, onOffline);
  const d = q.data?.data;
  const can = d?.can;
  const manage = !!can?.manage;
  const off = offline ? NEEDS_CONNECTION : undefined;

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['projects', 'milestones'] });
    void qc.invalidateQueries({ queryKey: ['projects', 'detail'] });
    void qc.invalidateQueries({ queryKey: qk.counts });
    void qc.invalidateQueries({ queryKey: qk.dashboard });
  };

  const achieve = async (m: Milestone, reason?: string) => {
    setBusy(`achieve:${m.id}`);
    try {
      await dwrite.milestoneStatus(m.id, reason ? { status: 'achieved', force: true, reason } : { status: 'achieved' });
      setAnyway(null);
      toast('success', `“${m.name}” marked achieved.`);
      refresh();
    } catch (e) {
      // 409: tasks are still open. Ask, with the count, rather than refuse.
      if (statusOf(e) === 409 && !reason) setAnyway({ m, message: errorMessage(e) });
      else toast('error', errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  const invoice = async (ids?: number[]) => {
    setBusy('invoice');
    try {
      const r = await dwrite.invoiceMilestones(ids);
      setBillingMsg(null);
      const made = r?.invoices ?? [];
      setDrafted({ invoices: made, count: r?.count ?? made.length, skipped: r?.skipped ?? [] });
      toast('success', `${made.length} draft invoice${made.length === 1 ? '' : 's'} created in Billing.`);
      refresh();
    } catch (e) {
      // Billing may be off, the person may lack its permission, or a project may have no client: its words.
      const msg = errorMessage(e) || 'Billing could not take these milestones.';
      setDrafted(null);
      setBillingMsg(msg);
      toast('error', msg);
    } finally {
      setBusy(null);
    }
  };

  const remove = async (m: Milestone) => {
    setBusy(`delete:${m.id}`);
    try {
      await dwrite.deleteMilestone(m.id);
      toast('success', 'Milestone deleted.');
      setDeleting(null);
      refresh();
    } catch (e) {
      toast('error', errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  const invoiceLink = (id: number, number: string | null, paid = false) => (
    <button type="button" onClick={() => openLink(`/billing?invoice=${id}`)} className="font-mono text-[11.5px] font-semibold text-primary hover:underline">
      {number ?? `Draft #${id}`}
      {paid ? ' · paid' : ''}
    </button>
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHead
        title="Milestones"
        actions={
          <>
            {!projectId ? <ProjectPick value={filter} onChange={setFilter} /> : null}
            {manage ? (
              <Button size="sm" variant="primary" icon="plus" disabled={offline} title={off} onClick={() => setEditing('new')}>
                New milestone
              </Button>
            ) : null}
            <Button size="sm" icon="external" onClick={() => openWeb(projectId ? `/projects/${projectId}/milestones` : '/projects/milestones')}>
              Open on the web
            </Button>
          </>
        }
      >
        <Tabs<Tab>
          label="Status"
          value={tab}
          onChange={setTab}
          tabs={[
            { key: 'open', label: 'Open', count: d?.counts.open },
            { key: 'overdue', label: 'Overdue', count: d?.counts.overdue },
            { key: 'achieved', label: 'Achieved', count: d?.counts.achieved },
            { key: 'missed', label: 'Missed', count: d?.counts.missed },
            { key: 'all', label: 'All', count: d?.counts.all },
          ]}
        />
      </PageHead>
      <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_300px] gap-3.5 overflow-y-auto px-5 py-4 scroll-thin">
        <section className="self-start overflow-hidden rounded-[12px] border border-line bg-surface">
          {q.isLoading ? <Spinner /> : null}
          {q.error && !d ? <ErrorNote error={q.error} onRetry={() => void q.refetch()} /> : null}
          {d && !d.milestones.length ? <p className="px-4 py-6 text-center text-ink-3">No milestones here.</p> : null}
          {d?.milestones.length ? (
            <div className="overflow-x-auto scroll-thin">
              <table className="w-full min-w-[820px] border-collapse text-[12.5px]">
                <thead className="bg-subtle text-left text-[11.5px] font-semibold text-ink-2">
                  <tr>
                    <th className="px-3 py-2">Milestone</th>
                    <th className="px-2 py-2">Owner</th>
                    <th className="px-2 py-2">Due</th>
                    <th className="w-32 px-2 py-2">Tasks</th>
                    <th className="px-2 py-2 text-right">Bills</th>
                    <th className="px-2 py-2">Invoice</th>
                    <th className="px-2 py-2">Status</th>
                    <th className="px-3 py-2">
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {d.milestones.map((m) => {
                    const state = m.status === 'open' && m.overdue ? 'overdue' : m.status;
                    const chip = MILESTONE_STATE[state] ?? { label: state, tone: 'bg-subtle text-ink-2' };
                    const left = m.status === 'achieved' ? { text: `Achieved ${fmtDay(m.achieved_at)}`, late: false } : m.status === 'open' ? daysLeftText(m.days) : { text: '', late: false };
                    const pct = m.tasks ? Math.round((m.tasks_done / m.tasks) * 100) : 0;
                    const billable = Number(m.bill_amount) > 0;
                    return (
                      <tr key={m.id} className="border-t border-line/60 align-middle">
                        <td className="px-3 py-2">
                          <b className="text-ink">{m.name}</b>
                          {!projectId ? (
                            <div className="text-[11.5px] text-ink-3">
                              <Mono>{m.project_code}</Mono> · {m.project}
                            </div>
                          ) : null}
                          {m.achieved_note ? <div className="text-[11.5px] text-warning-ink">Achieved with open tasks: {m.achieved_note}</div> : null}
                        </td>
                        <td className="px-2 py-2 text-ink-2">{m.owner ?? '—'}</td>
                        <td className="px-2 py-2 text-ink">
                          {fmtDay(m.due_date)}
                          {left.text ? <div className={cx('text-[11px]', left.late ? 'font-semibold text-danger' : 'text-ink-3')}>{left.text}</div> : null}
                        </td>
                        <td className="px-2 py-2">
                          <div className="flex items-center gap-1.5">
                            <div role="progressbar" aria-label={`${m.tasks_done} of ${m.tasks} tasks done`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} className="h-1.5 flex-1 overflow-hidden rounded-full bg-subtle">
                              <div className={cx('h-full', m.status === 'achieved' ? 'bg-success' : state === 'overdue' ? 'bg-danger' : 'bg-primary')} style={{ width: `${pct}%` }} />
                            </div>
                            <Mono className="text-[11.5px] text-ink-2">
                              {m.tasks_done}/{m.tasks}
                            </Mono>
                          </div>
                        </td>
                        <td className="px-2 py-2 text-right">
                          <Mono className="text-ink">{billable ? `${m.currency !== d.ready.currency ? `${m.currency} ` : ''}${num(m.bill_amount)}` : '—'}</Mono>
                        </td>
                        <td className="px-2 py-2 text-[12px] text-ink-2">{m.invoice_id ? invoiceLink(m.invoice_id, m.invoice_number, m.invoice_paid) : m.invoice_number ? `${m.invoice_number}${m.invoice_paid ? ' · paid' : ''}` : (INVOICE_STATE[m.invoice_status] ?? '—')}</td>
                        <td className="px-2 py-2">
                          <Chip tone={chip.tone}>{chip.label}</Chip>
                        </td>
                        <td className="px-3 py-2 text-right">
                          {manage ? (
                            <div className="flex flex-wrap justify-end gap-1">
                              {m.status === 'open' ? (
                                <Button size="sm" disabled={offline || !!busy} title={off} loading={busy === `achieve:${m.id}`} onClick={() => void achieve(m)}>
                                  Mark achieved
                                </Button>
                              ) : null}
                              {m.invoice_status === 'ready' ? (
                                <Button size="sm" disabled={offline || !!busy} title={off} onClick={() => void invoice([m.id])}>
                                  Raise invoice
                                </Button>
                              ) : null}
                              <Button size="sm" variant="ghost" aria-label={`Edit ${m.name}`} disabled={offline} title={off} onClick={() => setEditing(m)}>
                                Edit
                              </Button>
                              <Button size="sm" variant="ghost" aria-label={`Delete ${m.name}`} className="text-danger" disabled={offline} title={off} onClick={() => setDeleting(m)}>
                                Delete
                              </Button>
                            </div>
                          ) : null}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : null}
        </section>
        <aside aria-label="Billing" className="flex flex-col gap-3.5">
          <section className="flex flex-col gap-2 rounded-[12px] border border-line bg-surface p-4">
            <h2 className="text-[14px] font-bold text-ink">Ready to invoice</h2>
            <Mono className="text-[24px] font-bold text-ink">{d ? `${d.ready.currency} ${num(d.ready.total)}` : '—'}</Mono>
            {d ? <MoneyBasis currency={d.ready.currency} /> : null}
            <p className="text-[12.5px] text-ink-3">
              {d?.ready.count ?? 0} achieved milestone{d?.ready.count === 1 ? '' : 's'} with a billing amount and no invoice yet.
            </p>
            {billingMsg ? (
              <p role="alert" className="text-[12.5px] text-danger">
                {billingMsg}
              </p>
            ) : null}
            {drafted ? (
              <div aria-live="polite" className="flex flex-col gap-1.5 rounded-[8px] bg-subtle p-2.5 text-[12.5px]">
                {drafted.invoices.length ? (
                  <>
                    <p className="text-ink-2">
                      {drafted.count} milestone{drafted.count === 1 ? '' : 's'} drafted in Billing — add tax and issue them there:
                    </p>
                    <ul className="flex flex-wrap gap-1.5">
                      {drafted.invoices.map((i) => (
                        <li key={i.id}>{invoiceLink(i.id, i.number)}</li>
                      ))}
                    </ul>
                  </>
                ) : null}
                {drafted.skipped.length ? (
                  <ul aria-label="Not drafted" className="list-disc ps-4 text-warning-ink">
                    {drafted.skipped.map((s) => (
                      <li key={s}>{s}</li>
                    ))}
                  </ul>
                ) : null}
              </div>
            ) : null}
            {manage ? (
              <Button variant="primary" disabled={!d?.ready.count || !!busy || offline} title={off} loading={busy === 'invoice'} onClick={() => void invoice(undefined)}>
                Draft invoices in Billing
              </Button>
            ) : null}
            {offline && manage ? <p className="text-[12px] text-warning-ink">Billing hand-offs wait for a connection.</p> : null}
          </section>
          {anyway ? <AchieveAnyway key={anyway.m.id} m={anyway.m} message={anyway.message} busy={busy === `achieve:${anyway.m.id}`} offline={offline} onCancel={() => setAnyway(null)} onConfirm={(reason) => void achieve(anyway.m, reason)} /> : null}
        </aside>
      </div>
      {editing ? <MilestoneDialog m={editing === 'new' ? null : editing} projectId={projectId ?? filter} onClose={() => setEditing(null)} onSaved={() => (setEditing(null), refresh())} /> : null}
      {deleting ? <Confirm title="Delete milestone" message={`Delete “${deleting.name}”? Its tasks stay, without a milestone.`} confirmLabel="Delete" danger busy={busy === `delete:${deleting.id}`} onClose={() => setDeleting(null)} onConfirm={() => void remove(deleting)} /> : null}
    </div>
  );
}

/** "Mark achieved anyway?": the open-task count, a required reason, then a forced retry. */
function AchieveAnyway({ m, message, busy, offline, onCancel, onConfirm }: { m: Milestone; message: string; busy: boolean; offline: boolean; onCancel: () => void; onConfirm: (reason: string) => void }) {
  const [reason, setReason] = useState('');
  const open = Math.max(0, m.tasks - m.tasks_done);
  return (
    <section aria-label="Mark achieved anyway?" className="flex flex-col gap-2.5 rounded-[12px] border border-warning bg-surface p-4">
      <h2 className="text-[14px] font-bold text-ink">Mark achieved anyway?</h2>
      <p className="text-[12.5px] text-ink-2">
        “{m.name}” still has{' '}
        <b>
          {open} open task{open === 1 ? '' : 's'}
        </b>
        . Marking it achieved posts to the team’s stream and makes it ready to invoice.
      </p>
      {message ? <p className="text-[11.5px] text-ink-3">{message}</p> : null}
      <Field label="Reason (kept on the record)">
        <input autoFocus value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} placeholder="Client accepted with known issues" className={inputClass} />
      </Field>
      <div className="flex justify-end gap-2">
        <Button size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button size="sm" variant="primary" disabled={!reason.trim() || offline} loading={busy} onClick={() => onConfirm(reason.trim())}>
          Mark achieved
        </Button>
      </div>
    </section>
  );
}

function MilestoneDialog({ m, projectId, onClose, onSaved }: { m: Milestone | null; projectId: number | null; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({
    project_id: m?.project_id ?? projectId ?? null,
    name: m?.name ?? '',
    owner_id: m?.owner_id ?? null,
    due_date: m?.due_date?.slice(0, 10) ?? '',
    bill_amount: Number(m?.bill_amount) ? m!.bill_amount : '',
    description: m?.description ?? '',
  });
  const [busy, setBusy] = useState(false);
  const projects = useLiveProjects(!m);
  const members = useMembers(f.project_id);
  const amountOk = !f.bill_amount || /^\d+(\.\d+)?$/.test(f.bill_amount.replace(/,/g, ''));
  const ok = !!f.name.trim() && !!f.project_id && amountOk;
  const save = async () => {
    if (!ok) return;
    setBusy(true);
    try {
      const body = { name: f.name.trim(), owner_id: f.owner_id, due_date: f.due_date || null, bill_amount: f.bill_amount.replace(/,/g, '') || '0', description: f.description.trim() || null };
      if (m) await dwrite.updateMilestone(m.id, body);
      else await dwrite.createMilestone({ ...body, project_id: f.project_id });
      toast('success', m ? 'Milestone saved.' : 'Milestone added.');
      onSaved();
    } catch (e) {
      toast('error', errorMessage(e));
      setBusy(false);
    }
  };
  return (
    <Modal
      title={m ? 'Edit milestone' : 'New milestone'}
      onClose={onClose}
      width={500}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={busy} disabled={!ok} onClick={() => void save()}>
            {m ? 'Save' : 'Add milestone'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        {!m && !projectId ? (
          <Field label="Project">
            <Select<number | ''> aria-label="Project" value={f.project_id ?? ''} onValueChange={(v) => setF((x) => ({ ...x, project_id: v === '' ? null : v, owner_id: null }))} options={[{ value: '', label: 'Choose a project…' }, ...projects]} className={inputClass} />
          </Field>
        ) : null}
        <Field label="Name">
          <input autoFocus value={f.name} maxLength={200} onChange={(e) => setF((x) => ({ ...x, name: e.target.value }))} className={inputClass} />
        </Field>
        <div className="grid grid-cols-2 gap-2.5">
          <Field label="Owner" hint="A member of the project">
            <Select<number | ''> aria-label="Owner" disabled={!f.project_id} value={f.owner_id ?? ''} onValueChange={(v) => setF((x) => ({ ...x, owner_id: v === '' ? null : v }))} options={[{ value: '', label: 'No owner' }, ...members]} className={inputClass} />
          </Field>
          <Field label="Due date">
            <input type="date" value={f.due_date} onChange={(e) => setF((x) => ({ ...x, due_date: e.target.value }))} className={inputClass} />
          </Field>
        </div>
        <Field label="Bill amount" hint="Leave empty if this milestone is not billed">
          <input inputMode="decimal" value={f.bill_amount} onChange={(e) => setF((x) => ({ ...x, bill_amount: e.target.value }))} placeholder="0" aria-invalid={!amountOk} className={cx(inputClass, !amountOk && 'border-danger')} />
        </Field>
        <Field label="Description">
          <textarea rows={3} value={f.description} onChange={(e) => setF((x) => ({ ...x, description: e.target.value }))} className={areaClass} />
        </Field>
      </div>
    </Modal>
  );
}
