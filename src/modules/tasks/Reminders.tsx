import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { apiDelete, apiGet, apiPost, apiPut } from '../../core/api';
import { app } from '../../core/app-state';
import { errorMessage } from '../../core/bridge';
import { useStore } from '../../core/store';
import { navigate } from '../../core/tabs';
import { currentZone, wallToUtc } from '../../core/time';
import { Button } from '../../components/ui';
import { Select } from '../../components/Select';
import { Checkbox } from '../../components/Checkbox';
import type { Task } from './api';

export interface ReminderDraft {
  offset_minutes: number | null;
  custom_at?: string;
  recipients: number[];
}
interface Reminder extends ReminderDraft {
  id: number;
  timezone: string;
  scheduled_at: string | null;
  can_edit: boolean;
}
interface Recipient {
  id: number;
  name: string;
}
const choices = [
  [0, 'At due time'],
  [15, '15 minutes before'],
  [60, '1 hour before'],
  [1440, '1 day before'],
] as const;
const input = 'h-8 w-full rounded border border-line bg-surface px-2 text-ink';
export function schedulePreview(draft: ReminderDraft, due: string | null, zone = currentZone()): string | null {
  const value = draft.offset_minutes === null ? draft.custom_at : due;
  if (!value) return null;
  try {
    let utc: string;
    if (/Z$|[+-]\d\d:\d\d$/.test(value)) utc = value;
    else {
      const [date, time = '09:00'] = value.split('T');
      const [h, m] = time.split(':').map(Number);
      utc = wallToUtc(date ?? '', (h ?? 0) * 60 + (m ?? 0), zone);
    }
    return new Date(new Date(utc).getTime() - (draft.offset_minutes ?? 0) * 60_000).toISOString();
  } catch {
    return null;
  }
}
function stamp(value: string, zone: string): string {
  return new Intl.DateTimeFormat(undefined, { timeZone: zone, dateStyle: 'medium', timeStyle: 'short' }).format(
    new Date(value.includes('T') ? value : value.replace(' ', 'T') + 'Z'),
  );
}
function localInput(value: string, zone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: zone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(value.replace(' ', 'T') + 'Z'));
  const get = (key: string) => parts.find((p) => p.type === key)?.value;
  return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}`;
}
export function ReminderDeliveryHint() {
  const prefs = useStore(app, (s) => s.prefs);
  const paused = useStore(app, (s) => s.status?.notificationsPausedUntil);
  const off =
    prefs &&
    (!prefs.notificationsEnabled || !prefs.backgroundServices.notifications || prefs.moduleNotifications.tasks === false || prefs.moduleNotifications['cat:projects'] === false);
  return (
    <div className="text-xs text-ink-3">
      {off
        ? 'Desktop reminders are disabled. '
        : paused || prefs?.dndEnabled
          ? 'Desktop banners may be silenced by Do Not Disturb. '
          : 'Reminders use your in-app and desktop notification preferences. '}
      <button type="button" className="text-primary underline" onClick={() => navigate('/notifications/settings')}>
        Notification settings
      </button>
      <span className="block">Your system notification settings also control banners.</span>
    </div>
  );
}
export function ReminderDrafts({
  value,
  onChange,
  due,
  recipients,
  zone = currentZone(),
  limit = 20,
}: {
  value: ReminderDraft[];
  onChange: (v: ReminderDraft[]) => void;
  due: string | null;
  recipients: Recipient[];
  zone?: string;
  limit?: number;
}) {
  const change = (i: number, patch: Partial<ReminderDraft>) => onChange(value.map((r, n) => (n === i ? { ...r, ...patch } : r)));
  return (
    <div className="flex flex-col gap-2" aria-label="Task reminders">
      <b>Reminders</b>
      {value.map((r, i) => {
        const scheduled = schedulePreview(r, due, zone);
        return (
          <div key={i} className="flex flex-col gap-2 rounded border border-line p-2">
            <div className="flex gap-2">
              <Select
                aria-label={`Reminder ${i + 1} time`}
                className={input}
                value={r.offset_minutes ?? 'custom'}
                onChange={(e) => change(i, { offset_minutes: e.target.value === 'custom' ? null : Number(e.target.value) })}
              >
                {choices.map(([offset, title]) => (
                  <option key={offset} value={offset} disabled={!due}>
                    {title}
                  </option>
                ))}
                <option value="custom">Custom date/time</option>
              </Select>
              <Button size="sm" aria-label={`Remove reminder ${i + 1}`} onClick={() => onChange(value.filter((_, n) => n !== i))}>
                Remove
              </Button>
            </div>
            {r.offset_minutes === null ? (
              <label className="text-xs">
                Custom reminder ({zone})
                <input
                  aria-label={`Reminder ${i + 1} custom time`}
                  type="datetime-local"
                  className={input}
                  value={r.custom_at ?? ''}
                  onChange={(e) => change(i, { custom_at: e.target.value })}
                />
              </label>
            ) : null}
            <span className="text-xs text-ink-3">
              {scheduled ? `Scheduled: ${stamp(scheduled, zone)} (${zone})` : 'Choose a reminder time.'}
              {r.offset_minutes !== null && due && !due.includes('T') ? ' Date-only tasks use 9:00 AM.' : ''}
            </span>
            <fieldset className="flex flex-wrap gap-2">
              <legend className="text-xs">Notify</legend>
              {recipients.map((person) => (
                <label key={person.id} className="flex items-center gap-1 text-xs">
                  <Checkbox
                    checked={r.recipients.includes(person.id)}
                    onChange={(e) => change(i, { recipients: e.target.checked ? [...r.recipients, person.id] : r.recipients.filter((id) => id !== person.id) })}
                  />
                  {person.name}
                </label>
              ))}
            </fieldset>
          </div>
        );
      })}
      <Button
        size="sm"
        disabled={value.length >= limit || !recipients.length}
        onClick={() => onChange([...value, { offset_minutes: due ? 0 : null, recipients: [recipients[0]!.id] }])}
      >
        Add reminder
      </Button>
      <ReminderDeliveryHint />
    </div>
  );
}
export function TaskReminders({ task }: { task: Task }) {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['tasks', 'reminders', task.id, task.due_date, task.due_at, task.status, task.assignee_id],
    queryFn: ({ signal }) => apiGet<{ reminders: Reminder[]; recipients: Recipient[]; timezone: string }>(`/api/tasks/${task.id}/reminders`, undefined, signal),
  });
  const [drafts, setDrafts] = useState<ReminderDraft[]>([]);
  const [editing, setEditing] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const zone = q.data?.timezone ?? currentZone();
  const refresh = () => qc.invalidateQueries({ queryKey: ['tasks', 'reminders', task.id] });
  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      if (editing) await apiPut(`/api/tasks/${task.id}/reminders/${editing}`, drafts[0]);
      else for (const draft of drafts) await apiPost(`/api/tasks/${task.id}/reminders`, draft);
      setDrafts([]);
      setEditing(null);
      await refresh();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const remove = async (id: number) => {
    setBusy(true);
    setError(null);
    try {
      await apiDelete(`/api/tasks/${task.id}/reminders/${id}`);
      await refresh();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="flex flex-col gap-2 border-t border-line pt-2.5">
      {(q.data?.reminders ?? []).map((r) => (
        <div key={r.id} className="rounded border border-line p-2 text-xs">
          <b>{r.offset_minutes === null ? 'Custom reminder' : choices.find(([offset]) => offset === r.offset_minutes)?.[1]}</b>
          <div>{r.scheduled_at ? `${stamp(r.scheduled_at, zone)} (${zone})` : 'Paused — task complete or due date removed'}</div>
          <div>Notify: {r.recipients.map((id) => q.data?.recipients.find((p) => Number(p.id) === id)?.name ?? `User ${id}`).join(', ')}</div>
          {r.can_edit ? (
            <div className="mt-1 flex gap-1">
              <Button
                size="sm"
                disabled={busy}
                onClick={() => {
                  setEditing(r.id);
                  setDrafts([{ offset_minutes: r.offset_minutes, ...(r.custom_at ? { custom_at: localInput(r.custom_at, zone) } : {}), recipients: r.recipients }]);
                }}
              >
                Edit
              </Button>
              <Button size="sm" disabled={busy} onClick={() => void remove(r.id)}>
                Remove
              </Button>
            </div>
          ) : null}
        </div>
      ))}
      {q.error ? (
        <div role="alert" className="text-xs text-error">
          {errorMessage(q.error)}
        </div>
      ) : null}
      {error ? (
        <div role="alert" className="text-xs text-error">
          {error}
        </div>
      ) : null}
      {task.status !== 'done' && task.status !== 'cancelled' ? (
        <ReminderDrafts
          value={drafts}
          onChange={setDrafts}
          due={task.due_at ?? task.due_date}
          recipients={(q.data?.recipients ?? []).map((p) => ({ ...p, id: Number(p.id) }))}
          zone={zone}
          limit={1}
        />
      ) : (
        <ReminderDeliveryHint />
      )}
      {drafts.length ? (
        <div className="flex gap-1">
          <Button size="sm" variant="primary" loading={busy} onClick={() => void save()}>
            Save reminder{drafts.length > 1 ? 's' : ''}
          </Button>
          <Button
            size="sm"
            disabled={busy}
            onClick={() => {
              setDrafts([]);
              setEditing(null);
            }}
          >
            Cancel
          </Button>
        </div>
      ) : null}
    </section>
  );
}
