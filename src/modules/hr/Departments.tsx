import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { app } from '../../core/app-state';
import { apiDelete, apiGet, apiPost, apiPut } from '../../core/api';
import { errorMessage } from '../../core/bridge';
import { useStore } from '../../core/store';
import { toast } from '../../core/toasts';
import { Select } from '../../components/Select';
import { ErrorNote, Spinner } from '../../components/ui';
import { pickable, type EmployeeRow } from './api';
import { ymd } from './dates';
import { btn, btnPrimary, btnSmall, Cell, Empty, Field, Initials, input, PageHead, Panel, row, Sheet, THead } from './parts';
import { can } from './Rail';
import { below, inTreeOrder, type Department } from './departmentTree';

/**
 * Departments (Directory's, shown in HR): the tree with each one's code,
 * manager and headcount, for this company and the ones no company was ever
 * set on. `directory.manage` adds, renames, moves and removes them; the
 * server refuses to delete one that still has people or sub-departments, and
 * says so.
 */
type Draft = { id: number | null; name: string; code: string; parent: string; manager: string };

export default function Departments() {
  const qc = useQueryClient();
  const perms = useStore(app, (s) => s.bootstrap?.permissions);
  const orgId = useStore(app, (s) => s.organizationId);
  const manage = can(perms, 'directory.manage');
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [removing, setRemoving] = useState<Department | null>(null);
  const q = useQuery({
    queryKey: ['hr', 'departments', orgId],
    queryFn: ({ signal }) => apiGet<Department[]>('/api/directory/departments', orgId ? { org: orgId } : undefined, signal),
  });
  const people = useQuery({ queryKey: ['hr', 'employees'], queryFn: ({ signal }) => apiGet<EmployeeRow[]>('/api/hr/employees', undefined, signal), enabled: draft !== null });
  const today = ymd(new Date());
  const managers = (people.data ?? []).filter((e) => e.user_id && pickable(e, today)).sort((a, b) => (a.name ?? '').localeCompare(b.name ?? ''));

  if (q.isLoading) return <Spinner />;
  if (q.error) return <ErrorNote error={q.error} onRetry={() => void q.refetch()} />;
  const list = q.data ?? [];
  const tree = inTreeOrder(list);
  const total = list.reduce((n, d) => n + d.members, 0);
  const refresh = () => void qc.invalidateQueries({ queryKey: ['hr', 'departments'] });

  const save = async () => {
    if (!draft || !draft.name.trim()) return;
    setBusy(true);
    const body = {
      name: draft.name.trim(),
      code: draft.code.trim() || null,
      parent_id: draft.parent ? Number(draft.parent) : null,
      manager_id: draft.manager ? Number(draft.manager) : null,
    };
    try {
      if (draft.id) await apiPut(`/api/directory/departments/${draft.id}`, body);
      else await apiPost('/api/directory/departments', { ...body, ...(orgId ? { org_id: Number(orgId) } : {}) });
      toast('success', draft.id ? 'Department saved.' : 'Department added.');
      setDraft(null);
      refresh();
    } catch (e) {
      toast('error', errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (d: Department) => {
    setBusy(true);
    try {
      await apiDelete(`/api/directory/departments/${d.id}`);
      toast('success', `“${d.name}” deleted.`);
      setRemoving(null);
      refresh();
    } catch (e) {
      toast('error', errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const edit = (d: Department) => setDraft({ id: d.id, name: d.name, code: d.code ?? '', parent: d.parent_id ? String(d.parent_id) : '', manager: d.manager_id ? String(d.manager_id) : '' });
  const blocked = draft?.id ? below(list, draft.id) : new Set<number>();

  return (
    <div className="flex flex-col gap-3.5">
      <PageHead title="Departments" sub={`${list.length} ${list.length === 1 ? 'department' : 'departments'} · ${total} ${total === 1 ? 'person' : 'people'} placed`}>
        {manage ? (
          <button type="button" className={btnPrimary} onClick={() => setDraft({ id: null, name: '', code: '', parent: '', manager: '' })}>
            Add department
          </button>
        ) : null}
      </PageHead>
      <Panel title="All departments" bodyClassName="flex flex-col">
        <THead cols={[['Department', null], ['Code', 90], ['Manager', 200], ['People', 70], ['', manage ? 120 : 0]]} />
        {tree.length ? (
          tree.map((d) => (
            <div key={d.id} className={row} data-department={d.id}>
              <Cell w={null}>
                <span className="flex min-w-0 items-center gap-2" style={{ paddingLeft: Math.min(d.depth, 6) * 18 }}>
                  {d.depth ? <span className="text-ink-3" aria-hidden>└</span> : null}
                  <b className="truncate">{d.name}</b>
                  {d.org_name ? <span className="truncate text-[12px] text-ink-3">{d.org_name}</span> : null}
                </span>
              </Cell>
              <Cell w={90} className="text-ink-2">{d.code ?? '—'}</Cell>
              <Cell w={200}>
                {d.manager_name ? (
                  <span className="flex min-w-0 items-center gap-2">
                    <Initials name={d.manager_name} size={24} />
                    <span className="truncate">{d.manager_name}</span>
                  </span>
                ) : (
                  <span className="text-ink-3">No manager</span>
                )}
              </Cell>
              <Cell w={70} className="tabular-nums">{d.members}</Cell>
              {manage ? (
                <span className="flex w-[120px] shrink-0 justify-end gap-1.5">
                  <button type="button" className={btnSmall} onClick={() => edit(d)} aria-label={`Edit ${d.name}`}>
                    Edit
                  </button>
                  <button type="button" className={btnSmall} onClick={() => setRemoving(d)} aria-label={`Delete ${d.name}`}>
                    Delete
                  </button>
                </span>
              ) : (
                <span className="w-0" />
              )}
            </div>
          ))
        ) : (
          <Empty text={manage ? 'No departments yet. Add the first one.' : 'No departments yet.'} />
        )}
      </Panel>

      {draft ? (
        <Sheet
          title={draft.id ? 'Edit department' : 'Add department'}
          onClose={() => setDraft(null)}
          footer={
            <>
              <button type="button" className={btn} onClick={() => setDraft(null)} disabled={busy}>
                Cancel
              </button>
              <button type="button" className={btnPrimary} onClick={() => void save()} disabled={busy || !draft.name.trim()}>
                {busy ? 'Saving…' : draft.id ? 'Save' : 'Add department'}
              </button>
            </>
          }
        >
          <Field label="Name">
            <input autoFocus className={input} value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} onKeyDown={(e) => e.key === 'Enter' && void save()} />
          </Field>
          <Field label="Code" hint="Optional: a short tag such as FIN or OPS.">
            <input className={input} value={draft.code} onChange={(e) => setDraft({ ...draft, code: e.target.value })} />
          </Field>
          <Field label="Part of">
            <Select<string> className={input} value={draft.parent} onChange={(e) => setDraft({ ...draft, parent: e.target.value })}>
              <option value="">— None (top level) —</option>
              {tree
                .filter((d) => !blocked.has(d.id))
                .map((d) => (
                  <option key={d.id} value={String(d.id)}>
                    {'  '.repeat(Math.min(d.depth, 6))}
                    {d.name}
                  </option>
                ))}
            </Select>
          </Field>
          <Field label="Manager" hint={people.isLoading ? 'Loading people…' : undefined}>
            <Select<string> className={input} value={draft.manager} onChange={(e) => setDraft({ ...draft, manager: e.target.value })}>
              <option value="">— No manager —</option>
              {managers.map((e) => (
                <option key={e.id} value={String(e.user_id)}>
                  {e.name}
                  {e.designation ? ` · ${e.designation}` : ''}
                </option>
              ))}
              {draft.manager && !managers.some((e) => String(e.user_id) === draft.manager) ? (
                <option value={draft.manager}>{list.find((d) => d.id === draft.id)?.manager_name ?? 'Current manager'}</option>
              ) : null}
            </Select>
          </Field>
        </Sheet>
      ) : null}

      {removing ? (
        <Sheet
          title="Delete department"
          onClose={() => setRemoving(null)}
          footer={
            <>
              <button type="button" className={btn} onClick={() => setRemoving(null)} disabled={busy}>
                Cancel
              </button>
              <button type="button" className={btnPrimary + ' !bg-danger hover:!opacity-90'} onClick={() => void remove(removing)} disabled={busy}>
                {busy ? 'Deleting…' : 'Delete'}
              </button>
            </>
          }
        >
          <p className="m-0 text-[13px] text-ink">
            Delete <b>{removing.name}</b>?{' '}
            {removing.members ? `It still has ${removing.members} ${removing.members === 1 ? 'person' : 'people'}; move them to another department first.` : 'Nobody is placed in it.'}
          </p>
        </Sheet>
      ) : null}
    </div>
  );
}
