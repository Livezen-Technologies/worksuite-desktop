import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { app } from '../../core/app-state';
import { apiGet, apiPost, apiPut } from '../../core/api';
import { errorMessage } from '../../core/bridge';
import { useStore } from '../../core/store';
import { toast } from '../../core/toasts';
import { ErrorNote, Spinner } from '../../components/ui';
import { EMPLOYMENT_TYPES, hasLeft, pickable, SETTABLE_STATUSES, type EmployeeDetail, type EmployeeRow } from './api';
import { dayLong, rangeLabel, ymd } from './dates';
import { btn, btnPrimary, Caps, Cell, Empty, Field, Facts, humanise, Initials, input, PageHead, row, Seg, Sheet, SidePanel, StatusChip, THead } from './parts';
import { can } from './Rail';
import { Select } from '../../components/Select';

/**
 * Directory (HrDirectory): everyone on file whose record I may open — the
 * server narrows the list to my reach — searchable by name or number. A row
 * opens a drawer with the employment facts, the login behind the record,
 * and this year's leave; "Open full profile" goes to the profile.
 */
type Show = 'current' | 'left' | 'all';

export default function Directory({ onOpen }: { onOpen: (id: number) => void }) {
  const perms = useStore(app, (s) => s.bootstrap?.permissions);
  const manage = can(perms, 'hr.manage');
  const [q, setQ] = useState('');
  const [show, setShow] = useState<Show>('current');
  const [picked, setPicked] = useState<number | null>(null);
  const [adding, setAdding] = useState(false);
  const list = useQuery({ queryKey: ['hr', 'employees'], queryFn: ({ signal }) => apiGet<EmployeeRow[]>('/api/hr/employees', undefined, signal) });
  const today = ymd(new Date());
  const rows = useMemo(() => {
    const t = q.trim().toLowerCase();
    return (list.data ?? []).filter((e) => {
      const left = hasLeft(e, today);
      if (show === 'current' && left) return false;
      if (show === 'left' && !left) return false;
      return !t || [e.name, e.employee_no, e.email, e.department, e.designation].some((v) => v?.toLowerCase().includes(t));
    });
  }, [list.data, q, show, today]);
  const all = list.data ?? [];
  const unlinked = all.filter((e) => !e.user_id && !hasLeft(e, today)).length;

  return (
    <div className="flex flex-col gap-3.5">
      <PageHead title="Directory" sub={list.data ? `${all.filter((e) => !hasLeft(e, today)).length} employees${unlinked ? ` · ${unlinked} not linked to a login` : ''}` : undefined}>
        {manage ? (
          <button type="button" className={btnPrimary} onClick={() => setAdding(true)}>
            Add employee
          </button>
        ) : null}
      </PageHead>
      <div className="flex items-center gap-2">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name or number" aria-label="Search name or number" className={input + ' !w-[320px]'} />
        <Seg
          label="Who"
          value={show}
          onChange={setShow}
          options={[
            { id: 'current', label: 'Current' },
            { id: 'left', label: 'Left' },
            { id: 'all', label: 'Everyone' },
          ]}
        />
      </div>
      {list.isLoading ? <Spinner /> : list.error ? <ErrorNote error={list.error} onRetry={() => void list.refetch()} /> : null}
      {list.data ? (
        <div className="overflow-hidden rounded-[12px] border border-line bg-surface">
          <THead cols={[['Employee', 260], ['Department', 130], ['Type', 100], ['Status', 110], ['Joined', 100], ['', null]]} />
          {rows.map((e) => (
            <div key={e.id} role="button" tabIndex={0} onClick={() => setPicked(e.id)} onKeyDown={(k) => k.key === 'Enter' && setPicked(e.id)} className={row + ' cursor-pointer hover:bg-ground'}>
              <span className="flex w-[260px] shrink-0 items-center gap-2">
                <Initials name={e.name ?? e.employee_no} size={28} />
                <span className="flex min-w-0 flex-col">
                  <b className="truncate text-ink">{e.name ?? 'No name on file'}</b>
                  <span className="truncate text-[11.5px] text-ink-3">
                    {e.employee_no}
                    {e.designation ? ` · ${e.designation}` : ''}
                    {!e.user_id ? ' · no login' : ''}
                  </span>
                </span>
              </span>
              <Cell w={130}>{e.department ?? '—'}</Cell>
              <Cell w={100}>{humanise(e.type)}</Cell>
              <Cell w={110} className="!overflow-visible">
                <StatusChip>{humanise(e.status)}</StatusChip>
              </Cell>
              <Cell w={100} className="text-ink-2">{e.joined_at ? dayLong(e.joined_at) : '—'}</Cell>
              <span className="min-w-0 flex-1 text-right">
                <button
                  type="button"
                  className="text-[12.5px] font-semibold text-primary hover:underline"
                  onClick={(ev) => {
                    ev.stopPropagation();
                    onOpen(e.id);
                  }}
                >
                  Open profile
                </button>
              </span>
            </div>
          ))}
          {!rows.length ? <Empty text={q ? 'Nobody matches.' : show === 'left' ? 'Nobody has left.' : 'Nobody on file yet.'} /> : null}
        </div>
      ) : null}
      {picked ? <EmployeeDrawer id={picked} manage={manage} canLink={manage || can(perms, 'hr.onboarding.manage')} onClose={() => setPicked(null)} onOpen={() => onOpen(picked)} /> : null}
      {adding ? <AddEmployee people={all} onClose={() => setAdding(false)} onDone={(id) => (setAdding(false), onOpen(id))} /> : null}
    </div>
  );
}

function EmployeeDrawer({ id, manage, canLink, onClose, onOpen }: { id: number; manage: boolean; canLink: boolean; onClose: () => void; onOpen: () => void }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['hr', 'employee', id], queryFn: ({ signal }) => apiGet<EmployeeDetail>(`/api/hr/employees/${id}`, undefined, signal) });
  const e = q.data;
  const year = new Date().getFullYear();

  return (
    <SidePanel
      label="Employee"
      onClose={onClose}
      head={
        e ? (
          <>
            <Initials name={e.name ?? e.employee_no} size={42} />
            <span className="flex min-w-0 flex-col">
              <b className="truncate text-[15px] text-ink">{e.name ?? 'No name on file'}</b>
              <span className="truncate text-[12px] text-ink-3">{[e.employee_no, e.designation].filter(Boolean).join(' · ')}</span>
            </span>
          </>
        ) : (
          <b className="text-ink">Employee</b>
        )
      }
    >
      {q.isLoading ? <Spinner /> : q.error ? <ErrorNote error={q.error} onRetry={() => void q.refetch()} /> : null}
      {e ? (
        <>
          <button type="button" className="self-start font-bold text-primary hover:underline" onClick={onOpen}>
            Open full profile
          </button>
          <div>
            <Caps>Employment</Caps>
            <Facts
              rows={[
                ['Status', <StatusChip key="s">{humanise(e.status)}</StatusChip>],
                ['Type', humanise(e.type)],
                ['Department', e.department],
                ['Reports to', e.manager_name],
                ['Joined', e.joined_at ? dayLong(e.joined_at) : null],
                ['Confirmed', e.confirmed_at ? dayLong(e.confirmed_at) : null],
                ...(e.exit_at ? ([['Left', dayLong(e.exit_at)]] as Array<[string, string]>) : []),
              ]}
            />
          </div>
          <LoginLink employee={e} manage={manage} canLink={canLink} onDone={() => void qc.invalidateQueries({ queryKey: ['hr'] })} />
          <div>
            <Caps>Leave balance {year}</Caps>
            {e.balances.length ? (
              <Facts rows={e.balances.map((b) => [b.type, b.entitled > 0 ? `${b.available} of ${b.entitled + (b.carried_in || 0)} available` : b.taken > 0 ? `${b.taken} taken` : 'Unpaid'])} />
            ) : (
              <span className="text-ink-3">No leave types yet.</span>
            )}
          </div>
          <div>
            <Caps>Leave history</Caps>
            {e.leave.length ? (
              e.leave.map((l) => (
                <div key={String(l.id)} className="flex items-center gap-2.5 py-[5px]">
                  <span className="w-[120px] shrink-0 truncate text-ink-3">{l.type_name ?? 'Leave'}</span>
                  <span className="min-w-0 flex-1 truncate font-semibold text-ink">
                    {rangeLabel(l.starts_on, l.ends_on)} · {Number(l.days)} {Number(l.days) === 1 ? 'day' : 'days'}
                  </span>
                  <StatusChip>{humanise(l.status)}</StatusChip>
                </div>
              ))
            ) : (
              <span className="text-ink-3">No leave recorded.</span>
            )}
          </div>
        </>
      ) : null}
    </SidePanel>
  );
}

/** The login behind a record: link one (logins with no employee record), or unlink. */
function LoginLink({ employee, manage, canLink, onDone }: { employee: EmployeeDetail; manage: boolean; canLink: boolean; onDone: () => void }) {
  const [user, setUser] = useState('');
  const [busy, setBusy] = useState(false);
  const logins = useQuery({
    queryKey: ['hr', 'linkable'],
    queryFn: ({ signal }) => apiGet<Array<{ id: number; name: string | null; email: string }>>('/api/hr/linkable', undefined, signal),
    enabled: canLink && !employee.user_id,
  });
  const save = async (userId: number | null) => {
    setBusy(true);
    try {
      await apiPut(`/api/hr/employees/${employee.id}`, { user_id: userId });
      toast('success', userId ? 'Linked.' : 'Unlinked.');
      setUser('');
      onDone();
    } catch (e) {
      toast('error', errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  if (!employee.user_id && !canLink) return null;
  return (
    <div>
      <Caps>Login</Caps>
      {employee.user_id ? (
        <div className="flex items-center gap-2">
          <span className="min-w-0 flex-1 truncate font-semibold text-ink">{employee.email ?? 'Linked'}</span>
          {manage ? (
            <button type="button" disabled={busy} className={btn} onClick={() => void save(null)}>
              Unlink
            </button>
          ) : null}
        </div>
      ) : (
        <>
          <div className="flex gap-1.5">
            <Select aria-label="Choose a login" value={user} onChange={(e) => setUser(e.target.value)} className={input}>
              <option value="">{logins.isLoading ? 'Loading logins…' : 'Choose a login…'}</option>
              {(logins.data ?? []).map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name ? `${u.name} · ${u.email}` : u.email}
                </option>
              ))}
            </Select>
            <button type="button" disabled={!user || busy || !manage} className={btnPrimary} onClick={() => void save(Number(user))}>
              Link
            </button>
          </div>
          <div className="mt-1.5 text-[11.5px] leading-[1.45] text-ink-3">Linking gives this employee record a sign-in identity. Each login can back at most one employee.</div>
        </>
      )}
    </div>
  );
}

/**
 * A bare employee record (the web's "Add employee"): a number (blank takes
 * the next one), optionally a login, the kind of employment and a manager.
 * A new hire with details and steps is Onboarding's job.
 */
function AddEmployee({ people, onClose, onDone }: { people: EmployeeRow[]; onClose: () => void; onDone: (id: number) => void }) {
  const [no, setNo] = useState('');
  const [user, setUser] = useState('');
  const [type, setType] = useState<string>('permanent');
  const [status, setStatus] = useState<string>('probation');
  const [manager, setManager] = useState('');
  const [joined, setJoined] = useState('');
  const [busy, setBusy] = useState(false);
  const logins = useQuery({ queryKey: ['hr', 'linkable'], queryFn: ({ signal }) => apiGet<Array<{ id: number; name: string | null; email: string }>>('/api/hr/linkable', undefined, signal) });
  const today = ymd(new Date());
  const save = async () => {
    setBusy(true);
    try {
      const r = await apiPost<{ id: number; employee_no: string }>('/api/hr/employees', {
        employee_no: no.trim() || undefined,
        user_id: user ? Number(user) : undefined,
        type,
        status,
        manager_id: manager ? Number(manager) : undefined,
        joined_at: joined || undefined,
      });
      toast('success', `Employee ${r.employee_no} added.`);
      onDone(r.id);
    } catch (e) {
      toast('error', errorMessage(e));
      setBusy(false);
    }
  };
  return (
    <Sheet
      title="Add employee"
      onClose={onClose}
      footer={
        <>
          <button type="button" className={btn} onClick={onClose}>
            Cancel
          </button>
          <button type="button" disabled={busy} className={btnPrimary} onClick={() => void save()}>
            {busy ? 'Adding…' : 'Add employee'}
          </button>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-2.5">
        <Field label="Employee number" hint="Leave blank for the next number.">
          <input aria-label="Employee number" value={no} onChange={(e) => setNo(e.target.value)} className={input} />
        </Field>
        <Field label="Joined">
          <input type="date" aria-label="Joined" value={joined} onChange={(e) => setJoined(e.target.value)} className={input} />
        </Field>
        <Field label="Employment type">
          <Select aria-label="Employment type" value={type} onChange={(e) => setType(e.target.value)} className={input}>
            {EMPLOYMENT_TYPES.map((t) => (
              <option key={t} value={t}>
                {humanise(t)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Status">
          <Select aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value)} className={input}>
            {SETTABLE_STATUSES.map((t) => (
              <option key={t} value={t}>
                {humanise(t)}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <Field label="Login" hint="Optional. Only logins with no employee record are listed.">
        <Select aria-label="Login" value={user} onChange={(e) => setUser(e.target.value)} className={input}>
          <option value="">No login yet</option>
          {(logins.data ?? []).map((u) => (
            <option key={u.id} value={u.id}>
              {u.name ? `${u.name} · ${u.email}` : u.email}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Reports to">
        <Select aria-label="Reports to" value={manager} onChange={(e) => setManager(e.target.value)} className={input}>
          <option value="">Nobody</option>
          {people
            .filter((p) => pickable(p, today))
            .map((p) => (
              <option key={p.id} value={p.id}>
                {p.name ?? p.employee_no} · {p.employee_no}
              </option>
            ))}
        </Select>
      </Field>
      <span className="text-[11.5px] text-ink-3">A record becomes Active when an onboarding is completed; until then it stays in the status chosen here.</span>
    </Sheet>
  );
}
