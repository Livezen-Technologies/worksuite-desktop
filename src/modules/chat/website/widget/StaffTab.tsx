import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useId, useState } from 'react';
import { ApiError } from '../../../../core/api';
import { errorMessage } from '../../../../core/bridge';
import { text } from '../../../../core/i18n';
import { toast } from '../../../../core/toasts';
import { Checkbox } from '../../../../components/Checkbox';
import { Icon } from '../../../../components/Icon';
import { Avatar, Button, ErrorNote, Modal, Spinner, Switch, cx, initials } from '../../../../components/ui';
import { Note, Pill, SettingRow } from '../../../account/parts';
import { assignStaff, nowOf, removeStaff, staffOf, type StaffMember } from './staff';

/**
 * Widget settings › Staff (S-04; WS-WCHAT X-UI-17, UX-SET-06; STF-01…03): who answers this widget — each person's
 * now-status, priority, whether they take voice calls and whether they are active or suspended — with a warning row for
 * anybody who lost "See website chats". "Add people" in the editor's header adds; Edit changes priority and suspends;
 * Remove takes somebody off. Every change is saved as it is made, as the list has always been on the web.
 */

const KEY = (id: number) => ['website', 'widget-staff', id];

/** The widget's staff, once the tab has been opened. Seeing it needs "Assign website chat staff". */
export function useStaffList(id: number, enabled: boolean) {
  return useQuery({ queryKey: KEY(id), queryFn: ({ signal }) => staffOf(id, signal), retry: false, enabled });
}

/** Whether the server refused the list: this person may not assign staff. */
export const staffForbidden = (e: unknown) => e instanceof ApiError && e.status === 403;

const NOW_TONE = { success: 'font-semibold text-success', warning: 'font-semibold text-warning', muted: 'text-ink-3' } as const;

export function StaffTab({ id, widgetName, adding, setAdding }: { id: number; widgetName: string; adding: boolean; setAdding: (v: boolean) => void }) {
  const qc = useQueryClient();
  const q = useStaffList(id, true);
  const [editing, setEditing] = useState<StaffMember | null>(null);
  const [removing, setRemoving] = useState<StaffMember | null>(null);

  // Everything that counts or shows the staff: this list, the photos, the widgets list's count, who takes calls.
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: KEY(id) });
    void qc.invalidateQueries({ queryKey: ['website', 'widget-design', id] });
    void qc.invalidateQueries({ queryKey: ['website', 'widget-calls', id] });
    void qc.invalidateQueries({ queryKey: ['website', 'widgets'] });
  };

  if (q.isLoading) return <div className="flex flex-1 items-center justify-center"><Spinner /></div>;
  if (staffForbidden(q.error)) {
    return (
      <div className="flex max-w-[860px] flex-col gap-3">
        <Intro />
        <Note>Choosing who answers this widget needs the “Assign website chat staff” permission.</Note>
      </div>
    );
  }
  if (q.error || !q.data) return <div className="flex-1 p-6"><ErrorNote error={q.error} onRetry={() => void q.refetch()} /></div>;

  const staff = q.data.staff;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto pb-4 scroll-thin">
      <Intro />
      <div className="overflow-hidden rounded-[12px] border border-line bg-surface">
        <table aria-label="Widget staff" className="w-full table-fixed text-[13px]">
          <colgroup>
            <col style={{ width: '30.8%' }} />
            <col style={{ width: '17.9%' }} />
            <col style={{ width: '12.8%' }} />
            <col style={{ width: '12.8%' }} />
            <col style={{ width: '14.1%' }} />
            <col style={{ width: '11.6%' }} />
          </colgroup>
          <thead>
            <tr className="border-b border-line bg-subtle text-left text-[10.5px] font-bold tracking-[0.9px] text-ink-3">
              <th scope="col" className="py-2.5 pl-4 font-bold">PERSON</th>
              <th scope="col" className="font-bold">NOW</th>
              <th scope="col" className="font-bold">PRIORITY</th>
              <th scope="col" className="font-bold">VOICE CALLS</th>
              <th scope="col" className="font-bold">STATUS</th>
              <th scope="col" className="pr-4"><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            {staff.map((m) => {
              const now = nowOf(m);
              const lost = !m.permitted;
              return (
                <tr key={m.user_id} aria-label={m.name} className={cx('border-b border-line/70 last:border-b-0', lost && 'bg-danger-bg')}>
                  <td className="py-[11px] pl-4">
                    <span className="flex items-center gap-2.5">
                      {lost ? (
                        <span aria-hidden className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-subtle text-[11px] font-bold text-ink-3">
                          {initials(m.name)}
                        </span>
                      ) : (
                        <Avatar name={m.name} src={m.avatar ?? null} size={32} />
                      )}
                      <span className="min-w-0">
                        <b className="block truncate">{m.name}</b>
                        {lost ? (
                          <span className="block text-[12px] text-danger">Lost "See website chats" — skipped for notifications</span>
                        ) : m.role ? (
                          <span className="block truncate text-[12px] text-ink-3">{m.role}</span>
                        ) : null}
                      </span>
                    </span>
                  </td>
                  <td className={NOW_TONE[now.tone]}>{now.label}</td>
                  <td>{m.priority ? <Pill tone="indigo" className="h-5 px-2 text-[11px] font-bold">Priority</Pill> : <span className="text-ink-3">—</span>}</td>
                  <td>{m.voice ? <span aria-label="Takes voice calls">✓</span> : <span aria-label="No voice calls" className="text-ink-3">—</span>}</td>
                  <td>{m.is_active ? 'Active' : <Pill tone="grey" className="h-5 px-2 text-[11px] font-bold">Suspended</Pill>}</td>
                  <td className="pr-4">
                    {lost ? (
                      <button type="button" aria-label={text('Remove {name}', { name: m.name })} onClick={() => setRemoving(m)} className="text-[12.5px] font-semibold text-danger hover:underline">Remove</button>
                    ) : (
                      <button type="button" aria-label={text('Edit {name}', { name: m.name })} onClick={() => setEditing(m)} className="text-[12.5px] font-semibold text-primary hover:underline">Edit</button>
                    )}
                  </td>
                </tr>
              );
            })}
            {staff.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-4 text-ink-3">Nobody is added yet.</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
      <div role="note" className="flex items-center gap-2.5 rounded-[10px] bg-selection px-3.5 py-3 text-[12.5px] text-primary">
        <Icon name="info" size={16} />
        With nobody added, every person who can see website chats covers this widget.
      </div>

      {editing ? <EditPerson id={id} m={editing} onClose={() => setEditing(null)} onRemove={() => { setRemoving(editing); setEditing(null); }} onSaved={refresh} /> : null}
      {removing ? <RemovePerson id={id} m={removing} widgetName={widgetName} onClose={() => setRemoving(null)} onSaved={refresh} /> : null}
      {adding ? <AddPeople id={id} available={q.data.available} onClose={() => setAdding(false)} onSaved={refresh} /> : null}
    </div>
  );
}

function Intro() {
  return <p className="text-[12.5px] text-ink-2">Who answers this widget. Priority staff are rung first; suspended staff keep their history but get no chats. Everyone needs the "See website chats" permission.</p>;
}

function SwitchRow({ label, hint, checked, onChange }: { label: string; hint: string; checked: boolean; onChange: (v: boolean) => void }) {
  const hid = useId();
  return (
    <SettingRow label={label} hint={<span id={hid}>{hint}</span>}>
      <Switch label={label} describedBy={hid} checked={checked} onChange={onChange} />
    </SettingRow>
  );
}

/** Edit: priority and active, saved together; Remove from here as well. */
function EditPerson({ id, m, onClose, onRemove, onSaved }: { id: number; m: StaffMember; onClose: () => void; onRemove: () => void; onSaved: () => void }) {
  const [priority, setPriority] = useState(m.priority);
  const [active, setActive] = useState(m.is_active);
  const [busy, setBusy] = useState(false);
  const tid = useId();
  const save = async () => {
    setBusy(true);
    try {
      await assignStaff(id, m.user_id, { priority, is_active: active });
      onSaved();
      toast('success', text('{name} saved', { name: m.name }));
      onClose();
    } catch (e) {
      toast('error', errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title={m.name}
      labelledBy={tid}
      onClose={onClose}
      width={460}
      footer={
        <>
          <Button variant="ghost" className="mr-auto text-danger" disabled={busy} onClick={onRemove}>Remove from this widget</Button>
          <Button disabled={busy} onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={busy} disabled={busy || (priority === m.priority && active === m.is_active)} onClick={() => void save()}>Save</Button>
        </>
      }
    >
      <SwitchRow label="Priority" hint="Rung first, and told when a chat on this widget is missed." checked={priority} onChange={setPriority} />
      <SwitchRow label="Active" hint="Off is suspended: they keep their history but get no chats." checked={active} onChange={setActive} />
    </Modal>
  );
}

function RemovePerson({ id, m, widgetName, onClose, onSaved }: { id: number; m: StaffMember; widgetName: string; onClose: () => void; onSaved: () => void }) {
  const [busy, setBusy] = useState(false);
  const tid = useId();
  const remove = async () => {
    setBusy(true);
    try {
      await removeStaff(id, m.user_id);
      onSaved();
      toast('success', text('{name} removed', { name: m.name }));
      onClose();
    } catch (e) {
      toast('error', errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title={text('Remove {name}?', { name: m.name })}
      labelledBy={tid}
      onClose={onClose}
      width={440}
      footer={
        <>
          <Button disabled={busy} onClick={onClose}>Cancel</Button>
          <Button variant="danger" loading={busy} disabled={busy} onClick={() => void remove()}>Remove</Button>
        </>
      }
    >
      <p className="text-[13px] text-ink-2">{text('They stop covering {widget}. Their permissions are not changed.', { widget: widgetName })}</p>
    </Modal>
  );
}

/** Add people: anybody who can see website chats and is not on the widget yet. */
function AddPeople({ id, available, onClose, onSaved }: { id: number; available: Array<{ id: number; name: string; email: string; role?: string | null }>; onClose: () => void; onSaved: () => void }) {
  const [chosen, setChosen] = useState<number[]>([]);
  const [busy, setBusy] = useState(false);
  const tid = useId();
  const add = async () => {
    setBusy(true);
    try {
      for (const u of chosen) await assignStaff(id, u, { is_active: true });
      onSaved();
      toast('success', chosen.length === 1 ? text('{name} added', { name: available.find((a) => a.id === chosen[0])?.name ?? '' }) : text('{n} people added', { n: chosen.length }));
      onClose();
    } catch (e) {
      // Whoever was added before the failure stays added: the list shows them.
      onSaved();
      toast('error', errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title="Add people"
      labelledBy={tid}
      onClose={onClose}
      width={480}
      footer={
        <>
          <Button disabled={busy} onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={busy} disabled={busy || chosen.length === 0} onClick={() => void add()}>
            {chosen.length > 1 ? text('Add {n} people', { n: chosen.length }) : 'Add'}
          </Button>
        </>
      }
    >
      {available.length === 0 ? (
        <p className="text-[13px] text-ink-3">Everybody who can see website chats is on this widget already.</p>
      ) : (
        <div className="flex flex-col gap-2">
          <p className="text-[12.5px] text-ink-3">Only people with the “See website chats” permission are listed.</p>
          <ul aria-label="People who can be added" className="flex flex-col divide-y divide-line rounded-[10px] border border-line">
            {available.map((u) => (
              <li key={u.id}>
                <label className="flex cursor-pointer items-center gap-3 px-3 py-2">
                  <Checkbox aria-label={u.name} checked={chosen.includes(u.id)} onChange={(e) => setChosen((c) => (e.target.checked ? [...c, u.id] : c.filter((x) => x !== u.id)))} />
                  <Avatar name={u.name} size={28} />
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate text-[13px] font-semibold text-ink">{u.name}</span>
                    <span className="truncate text-[12px] text-ink-3">{u.role || u.email}</span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Modal>
  );
}
