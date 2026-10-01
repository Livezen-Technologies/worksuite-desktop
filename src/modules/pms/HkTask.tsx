import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Button, ErrorNote, Modal, Spinner } from '../../components/ui';
import { apiUrl } from '../../core/api';
import { app } from '../../core/app-state';
import { useStore } from '../../core/store';
import { toast } from '../../core/toasts';
import { ChooseFiles, Section } from '../garage/parts';
import { PageHead } from '../hr/parts';
import { day, errorText, K, MAX_PHOTO, MAX_PHOTOS, pGet, pPost, pUpload, stamp, type HkStaff, type HkTaskFull, type Restock } from './api';
import { ActionButtons, PersonPick, useActions } from './ops';
import { RestockDialog } from './Restock';
import { Facts, NoAccess, Refusal, StatusBadge, usePms, VipPill } from './parts';
import { Checkbox } from '../../components/Checkbox';

interface TaskView {
  task: HkTaskFull & { flags?: HkTaskFull['flags'] & { guest?: { name: string | null; vip_level: string | null; special_requirements?: string | null } | null } };
  history: Array<{ text: string; by: string | null; at: string }>;
  restocks: Restock[];
}

/**
 * One housekeeping task (§11.1–11.2, `/pms/housekeeping/tasks/<id>`): the
 * moves the server offers this person (start, pause, complete, inspect…,
 * each asking for what it needs), the checklist ticked as the work goes,
 * the room given to an attendant (`pms.housekeeping.manage`, the server's
 * own staff list), what went into the room, photos of the room (the
 * attendant's own task, one nobody has yet, or any for a supervisor, while
 * the task is open — `POST housekeeping-tasks/{id}/photos`), and the task's
 * history.
 */
export default function HkTask({ id }: { id: number }) {
  const pms = usePms();
  const qc = useQueryClient();
  const reads = pms.mayAny('pms.housekeeping.view', 'pms.housekeeping.manage');
  const manages = pms.may('pms.housekeeping.manage');
  const q = useQuery({ queryKey: K.hkTask(id), queryFn: ({ signal }) => pGet<TaskView>(`/housekeeping-tasks/${id}`, undefined, signal), enabled: reads && pms.online });
  const staff = useQuery({ queryKey: K.hkStaff(pms.property.id), queryFn: ({ signal }) => pGet<{ items: HkStaff[] }>(`/properties/${pms.property.id}/housekeeping/staff`, undefined, signal), enabled: manages && pms.online });
  const acts = useActions([K.hkTask(id), K.hkTasks(pms.property.id), K.live]);
  const [to, setTo] = useState<number | null>(null);
  const [restock, setRestock] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const me = useStore(app, (s) => Number(s.bootstrap?.user.id ?? 0));
  const t = q.data?.task;
  useEffect(() => {
    if (t) pms.adopt(t.property_id);
  }, [t, pms]);

  if (!reads) return <NoAccess what="Housekeeping tasks are shown to housekeeping." />;
  if (!pms.online) return <NoAccess what="A housekeeping task shows when WorkSuite is back: its state is the server’s." />;
  if (q.isLoading) return <Spinner />;
  if (q.error || !t) return <div className="p-6"><ErrorNote error={q.error ?? new Error('The task could not be loaded.')} onRetry={() => void q.refetch()} /></div>;
  const open = !['inspected', 'cancelled', 'completed'].includes(t.status);
  const working = ['in_progress', 'paused', 'assigned', 'pending'].includes(t.status);

  const tick = async (key: string, done: boolean) => {
    try {
      await pPost(`/housekeeping-tasks/${id}/checklist`, { checklist: { [key]: done } });
      void qc.invalidateQueries({ queryKey: K.hkTask(id) });
    } catch (e) {
      acts.setError(errorText(e, 'The checklist was not changed.'));
    }
  };
  /* Who may add a photo, as the server's `Housekeeping::mayWork`: a supervisor, or the attendant on their own task or one nobody has yet. */
  const works = manages || t.assigned_to === null || t.assigned_to === me;
  const photos = t.photos ?? [];
  const addPhoto = async (files: File[]) => {
    const f = files[0];
    if (!f) return;
    if (f.size > MAX_PHOTO) return acts.setError(`${f.name} is larger than 10 MB.`);
    setUploading(true);
    acts.setError(null);
    try {
      toast('success', (await pUpload(`/housekeeping-tasks/${id}/photos`, f, f.name, {})).message);
      void qc.invalidateQueries({ queryKey: K.hkTask(id) });
    } catch (e) {
      acts.setError(errorText(e, 'The photo was not kept.'));
    } finally {
      setUploading(false);
    }
  };
  const saveNote = async () => {
    try {
      const r = await pPost(`/housekeeping-tasks/${id}/checklist`, { notes: note ?? '' });
      toast('success', r.message);
      setNote(null);
      void qc.invalidateQueries({ queryKey: K.hkTask(id) });
    } catch (e) {
      acts.setError(errorText(e, 'The note was not kept.'));
    }
  };

  return (
    <div className="flex flex-col gap-4 px-6 py-5">
      <PageHead
        title={
          <span className="flex items-center gap-2">
            Room {t.room_number} · {t.task_type_label}
          </span>
        }
        sub={`${t.status_label} · ${t.priority_label} priority · ${day(t.business_date)}${t.assigned_name ? ` · ${t.assigned_name}` : ' · nobody yet'}`}
      >
        <Button variant="ghost" icon="back" onClick={() => pms.go('housekeeping')}>
          Housekeeping
        </Button>
        <ActionButtons options={t.options} primary={t.primary} busy={acts.busy} online={pms.online} onPick={(o) => acts.run(`/housekeeping-tasks/${id}`, o, t.version)} />
      </PageHead>
      {acts.error ? <Refusal text={acts.error} /> : null}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="flex flex-col gap-4">
          <Section title={`Checklist${t.checklist_open ? ` · ${t.checklist_open} open` : ''}`}>
            {t.checklist.length === 0 ? (
              <p className="m-0 text-[13px] text-ink-3">No checklist.</p>
            ) : (
              <ul className="m-0 flex list-none flex-col gap-1 p-0 text-[13px]">
                {t.checklist.map((c) => (
                  <li key={c.key}>
                    <label className="flex items-center gap-2">
                      <Checkbox checked={c.done} disabled={!working || !pms.online} onChange={(e) => void tick(c.key, e.target.checked)} />
                      {c.label}
                      {c.required === false ? <span className="text-[11.5px] text-ink-3">(optional)</span> : null}
                    </label>
                  </li>
                ))}
              </ul>
            )}
          </Section>
          <Section
            title={`Photos${photos.length ? ` · ${photos.length}` : ''}`}
            action={
              open && works && photos.length < MAX_PHOTOS ? (
                <ChooseFiles multiple={false} accept="image/jpeg,image/png,image/webp,image/heic" disabled={!pms.online || uploading} label="Add a photo…" onFiles={(f) => void addPhoto(f)} />
              ) : null
            }
          >
            {photos.length === 0 ? (
              <p className="m-0 text-[13px] text-ink-3">None.</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {photos.map((p) => (
                  <img key={p.id} src={apiUrl(p.url)} alt={`Room ${t.room_number}, photo`} className="size-24 rounded-[8px] border border-line object-cover" />
                ))}
              </div>
            )}
          </Section>
          <Section title="History">
            {q.data!.history.length === 0 ? (
              <p className="m-0 text-[13px] text-ink-3">Nothing yet.</p>
            ) : (
              <ul className="m-0 flex list-none flex-col gap-1 p-0 text-[12.5px] text-ink-2">
                {q.data!.history.map((h, i) => (
                  <li key={i}>
                    {stamp(h.at)} · {h.text}
                    {h.by ? ` · ${h.by}` : ''}
                  </li>
                ))}
              </ul>
            )}
          </Section>
        </div>
        <div className="flex flex-col gap-4">
          <Section title="Room">
            {t.room ? <div className="mb-2"><StatusBadge badge={t.room.badge} /></div> : null}
            <Facts
              rows={[
                ['Room status', t.room?.hk_status_label ?? '—'],
                ['Credits', String(t.credits)],
                ['Started', stamp(t.started_at)],
                ['Completed', stamp(t.completed_at)],
                ['Minutes', t.minutes !== null ? String(t.minutes) : '—'],
                ['Inspected', t.inspected_at ? `${stamp(t.inspected_at)}${t.inspection_result ? ` · ${t.inspection_result}` : ''}` : '—'],
                ['Notes', t.notes ?? '—'],
              ]}
            />
            {t.flags?.guest ? (
              <div className="mt-2 rounded-[8px] bg-subtle p-2 text-[12.5px]">
                <b>{t.flags.guest.name}</b> <VipPill level={t.flags.guest.vip_level} />
                {t.flags.guest.special_requirements ? <p className="m-0 text-ink-2">{t.flags.guest.special_requirements}</p> : null}
              </div>
            ) : null}
            <div className="mt-3 flex flex-wrap gap-1.5">
              {['in_progress', 'paused'].includes(t.status) ? (
                <Button size="sm" disabled={!pms.online} onClick={() => setNote(t.notes ?? '')}>
                  Note
                </Button>
              ) : null}
              <Button size="sm" icon="package" disabled={!pms.online} onClick={() => setRestock(true)}>
                Record restock
              </Button>
              <Button size="sm" variant="ghost" onClick={() => pms.open({ kind: 'room', id: t.room_id })}>
                The room
              </Button>
            </div>
          </Section>
          {manages && open ? (
            <Section title="Give to">
              <div className="flex gap-2">
                <div className="min-w-0 flex-1">
                  <PersonPick label="Attendant" value={to} onChange={setTo} people={(staff.data?.items ?? []).map((s) => ({ id: s.user_id, name: s.name, hint: `${s.tasks} rooms · ${s.credits} credits` }))} />
                </div>
                <Button disabled={!to || acts.busy || !pms.online} onClick={() => void acts.send(`/housekeeping-tasks/${id}`, 'assign', { assigned_to: to, version: t.version })}>
                  Assign
                </Button>
              </div>
            </Section>
          ) : null}
          <Section title="Restocked">
            {q.data!.restocks.length === 0 ? (
              <p className="m-0 text-[13px] text-ink-3">Nothing recorded.</p>
            ) : (
              <ul className="m-0 flex list-none flex-col gap-1 p-0 text-[13px]">
                {q.data!.restocks.map((r) => (
                  <li key={r.id}>
                    {r.product ?? r.code} × {r.quantity} <span className="text-[11.5px] text-ink-3">{r.kind_label}{r.chargeable ? ' · charged' : ''}</span>
                  </li>
                ))}
              </ul>
            )}
          </Section>
        </div>
      </div>
      {acts.dialog}
      {restock ? (
        <RestockDialog
          path={`/housekeeping-tasks/${id}/restocks`}
          room={t.room_number}
          onClose={() => setRestock(false)}
          onDone={() => {
            setRestock(false);
            void qc.invalidateQueries({ queryKey: K.hkTask(id) });
          }}
        />
      ) : null}
      {note !== null ? (
        <NoteDialog initial={note} onClose={() => setNote(null)} onChange={setNote} onSave={() => void saveNote()} />
      ) : null}
    </div>
  );
}

function NoteDialog({ initial, onChange, onClose, onSave }: { initial: string; onChange: (v: string) => void; onClose: () => void; onSave: () => void }) {
  return (
    <Modal
      title="Task note"
      onClose={onClose}
      width={420}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={onSave}>
            Save note
          </Button>
        </div>
      }
    >
      <textarea aria-label="Task notes" rows={3} defaultValue={initial} onChange={(e) => onChange(e.target.value)} className="w-full rounded-[8px] border border-line bg-surface px-2.5 py-2 text-[13px]" />
    </Modal>
  );
}
