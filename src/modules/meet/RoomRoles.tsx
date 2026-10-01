import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { apiGet, apiPut } from '../../core/api';
import { errorMessage } from '../../core/bridge';
import { dateLabel } from '../../core/time';
import { toast } from '../../core/toasts';
import { Select } from '../../components/Select';
import { Button, Modal, Spinner, Switch, TextField, cx } from '../../components/ui';
import { ROLE_LABEL, type MeetRole, type RoomActivity, type RoomSettings, type RoomSettingsView } from './api';
import { meet } from './session';

/**
 * Meeting roles and room settings (worksuite-desktop#82): the badge next to a
 * name, the room settings (while scheduling and in the meeting), the meeting's
 * activity, and leaving as the host. What a role may do is the server's to
 * decide — these screens only offer what it will allow.
 */

const BADGE: Record<MeetRole, string> = {
  host: 'bg-primary/15 text-primary',
  cohost: 'bg-[#E6F4EF] text-[#127A5B] dark:bg-[#123A2E] dark:text-[#7FD8B6]',
  presenter: 'bg-[#FFF4E0] text-[#9A5B00] dark:bg-[#3A2A10] dark:text-[#F6C77A]',
  participant: 'bg-subtle text-ink-3',
};

export function RoleBadge({ role, guest }: { role: MeetRole; guest?: boolean }) {
  return <span className={cx('rounded-full px-1.5 py-px text-[10.5px] font-bold', BADGE[role])}>{guest && role === 'participant' ? 'Guest' : ROLE_LABEL[role]}</span>;
}

/** The choices, in words, for each setting. */
const CHOICES: { [K in keyof RoomSettings]?: Array<{ value: RoomSettings[K]; label: string }> } = {
  access: [
    { value: 'anyone', label: 'Anyone with the link, guests too' },
    { value: 'signed_in', label: 'People signed in to WorkSuite' },
    { value: 'invited', label: 'Only the people invited' },
  ],
  present: [
    { value: 'everyone', label: 'Everyone' },
    { value: 'presenters', label: 'Host, co-hosts and presenters' },
  ],
  invite: [
    { value: 'everyone', label: 'Everyone in the meeting' },
    { value: 'hosts', label: 'Host and co-hosts' },
  ],
  chat: [
    { value: 'everyone', label: 'Everyone' },
    { value: 'hosts', label: 'Host and co-hosts only' },
    { value: 'off', label: 'Off' },
  ],
  record: [
    { value: 'host', label: 'The host' },
    { value: 'hosts', label: 'Host and co-hosts' },
  ],
  transcripts: [
    { value: 'participants', label: 'Everyone in the meeting' },
    { value: 'hosts', label: 'Host and co-hosts' },
  ],
};

const LABELS: Record<keyof RoomSettings, string> = {
  access: 'Who can join',
  waiting_room: 'Waiting room',
  join_before_host: 'Let people join before the host',
  present: 'Who can share their screen',
  invite: 'Who can invite people',
  chat: 'Who can chat',
  record: 'Who can record',
  transcripts: 'Who can see transcripts and minutes',
};

const HINTS: Partial<Record<keyof RoomSettings, string>> = {
  waiting_room: 'People wait until the host or a co-host admits them.',
  join_before_host: 'Off: everyone waits until the host or a co-host is in.',
};

/**
 * The room settings as fields. While scheduling, `value` is a draft; in the
 * meeting, each change is saved as it is made.
 */
export function RoomSettingsFields({ value, onChange, disabled }: { value: RoomSettings; onChange: (patch: Partial<RoomSettings>) => void; disabled?: boolean }) {
  return (
    <div className="flex flex-col gap-2.5 text-[12.5px]">
      {(Object.keys(LABELS) as Array<keyof RoomSettings>).map((key) => {
        const v = value[key];
        if (typeof v === 'boolean') {
          return (
            <div key={key} className="flex items-start gap-2.5">
              <span className="flex min-w-0 flex-1 flex-col">
                <b className="text-ink">{LABELS[key]}</b>
                {HINTS[key] ? <span className="text-[11.5px] text-ink-3">{HINTS[key]}</span> : null}
              </span>
              <Switch checked={v} disabled={disabled} label={LABELS[key]} onChange={(on) => onChange({ [key]: on })} />
            </div>
          );
        }
        const options = (CHOICES[key] ?? []) as Array<{ value: string; label: string }>;
        return (
          <label key={key} className="flex flex-col gap-1">
            <b className="text-ink">{LABELS[key]}</b>
            <Select<string>
              value={v}
              disabled={disabled}
              aria-label={LABELS[key]}
              options={options}
              onValueChange={(next) => onChange({ [key]: next } as Partial<RoomSettings>)}
              className="h-9 rounded-[8px] border border-line bg-surface px-2 text-ink"
            />
          </label>
        );
      })}
    </div>
  );
}

/** The Settings tab in the meeting: room name, passcode, lock and the room settings; the activity for hosts and co-hosts. */
export function RoomSettingsPanel() {
  const uuid = meet.uuid;
  const q = useQuery({ queryKey: ['meet', uuid, 'settings'], queryFn: ({ signal }) => apiGet<RoomSettingsView>(`/api/meet/${uuid}/settings`, undefined, signal) });
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState<{ title?: string; passcode?: string }>({});
  if (q.isLoading) return <Spinner />;
  if (!q.data) return <p className="p-3.5 text-[12.5px] text-ink-3">{q.error ? errorMessage(q.error) : 'The room settings could not be read.'}</p>;
  const view = q.data;
  const edit = view.can_edit;

  const save = async (patch: Record<string, unknown>) => {
    setSaving(true);
    try {
      const next = await apiPut<RoomSettingsView>(`/api/meet/${uuid}/settings`, patch);
      q.refetch().catch(() => undefined);
      if (next) setDraft({});
      await meet.reload();
      toast('success', 'Room settings saved.');
    } catch (e) {
      toast('error', errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  const title = draft.title ?? view.title;
  const passcode = draft.passcode ?? view.passcode ?? '';
  return (
    <div className="flex flex-col gap-3.5 p-3.5 text-[12.5px]">
      {!edit ? <p className="rounded-[9px] bg-subtle px-2.5 py-2 text-ink-2">Only the host and co-hosts can change these.</p> : null}
      <TextField label="Room name" value={title} disabled={!edit} maxLength={150} onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))} onBlur={() => (edit && title.trim() && title !== view.title ? void save({ title }) : undefined)} />
      {edit ? (
        <TextField
          label="Passcode"
          hint="Letters and numbers, up to 12. Empty: no passcode."
          value={passcode}
          maxLength={12}
          onChange={(e) => setDraft((d) => ({ ...d, passcode: e.target.value.replace(/[^A-Za-z0-9]/g, '') }))}
          onBlur={() => (passcode !== (view.passcode ?? '') ? void save({ passcode }) : undefined)}
        />
      ) : (
        <p className="text-ink-2">{view.has_passcode ? 'This meeting has a passcode.' : 'No passcode.'}</p>
      )}
      <div className="flex items-start gap-2.5">
        <span className="flex min-w-0 flex-1 flex-col">
          <b className="text-ink">Lock the meeting</b>
          <span className="text-[11.5px] text-ink-3">No one new can join, even with the link.</span>
        </span>
        <Switch checked={view.locked} disabled={!edit || saving} label="Lock the meeting" onChange={(locked) => void save({ locked })} />
      </div>
      <RoomSettingsFields value={view.settings} disabled={!edit || saving} onChange={(patch) => void save(patch)} />
      {edit ? <ActivityList /> : null}
    </div>
  );
}

function ActivityList() {
  const uuid = meet.uuid;
  const q = useQuery({ queryKey: ['meet', uuid, 'activity', meet.snapshot()], queryFn: ({ signal }) => apiGet<{ activity: RoomActivity[] }>(`/api/meet/${uuid}/activity`, undefined, signal), staleTime: 5_000 });
  const rows = q.data?.activity ?? [];
  return (
    <div className="flex flex-col gap-1.5 border-t border-line pt-3">
      <b className="text-ink">Meeting activity</b>
      {q.isLoading ? <Spinner /> : null}
      {!q.isLoading && !rows.length ? <p className="text-ink-3">No role or settings changes yet.</p> : null}
      {rows.slice(0, 30).map((r) => (
        <p key={r.id} className="text-ink-2">
          <b className="text-ink">{r.by?.name ?? 'Someone'}</b> {r.description.charAt(0).toLowerCase() + r.description.slice(1)}
          <span className="text-ink-3"> · {dateLabel(r.at)}</span>
        </p>
      ))}
    </div>
  );
}

/** Make somebody the host, after saying what it means. */
export function TransferHostDialog({ person, onClose }: { person: { id: number; name: string }; onClose: () => void }) {
  const [busy, setBusy] = useState(false);
  return (
    <Modal
      title={`Make ${person.name} the host?`}
      onClose={onClose}
      width={420}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={busy} onClick={() => (setBusy(true), void meet.transferHost(person.id).then((ok) => (ok ? onClose() : setBusy(false))))}>
            Make host
          </Button>
        </>
      }
    >
      <p className="text-[13px] text-ink-2">
        {person.name} will run the meeting: ending it for everyone, naming co-hosts and handing the host role on. You stay on as a co-host, and the new host can change that.
      </p>
    </Modal>
  );
}

/**
 * Leaving as the host: the meeting goes on with a new host — a co-host who is
 * here, or the person chosen — or ends for everyone.
 */
export function HostLeaveDialog({ onClose, onEndAll }: { onClose: () => void; onEndAll: () => void }) {
  const [busy, setBusy] = useState(false);
  const [candidates, setCandidates] = useState<Array<{ id: number; name: string }> | null>(null);
  const [pick, setPick] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const cohostsHere = meet.people.filter((p) => p.role === 'cohost');

  const leave = async (userId?: number) => {
    setBusy(true);
    setError(null);
    const r = await meet.leaveAsHost(userId);
    setBusy(false);
    if (r.left) return onClose();
    if (r.error) setError(r.error);
    else {
      setCandidates(r.candidates);
      setPick(r.candidates[0]?.id ?? null);
    }
  };

  const choosing = candidates !== null;
  return (
    <Modal
      title="Leave the meeting?"
      onClose={onClose}
      width={460}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="danger" onClick={() => (onClose(), onEndAll())}>
            End for everyone
          </Button>
          <Button variant="primary" loading={busy} disabled={choosing && !pick} onClick={() => void leave(choosing ? (pick ?? undefined) : undefined)}>
            {choosing ? 'Make host and leave' : 'Leave'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-2.5 text-[13px] text-ink-2">
        {!choosing ? (
          <p>
            {cohostsHere.length
              ? `The meeting goes on, and ${cohostsHere[0]!.name} becomes the host.`
              : 'The meeting goes on. A co-host becomes the host; with none, you choose who.'}
          </p>
        ) : candidates.length ? (
          <>
            <p>There is no co-host to take over. Choose who runs the meeting after you leave.</p>
            <Select<number> aria-label="New host" value={pick ?? candidates[0]!.id} options={candidates.map((c) => ({ value: c.id, label: c.name }))} onValueChange={setPick} className="h-9 rounded-[8px] border border-line bg-surface px-2 text-ink" />
          </>
        ) : (
          <p>No one signed in to WorkSuite is in the meeting to take over. End it for everyone, or stay.</p>
        )}
        {error ? <p className="text-danger" role="alert">{error}</p> : null}
      </div>
    </Modal>
  );
}
