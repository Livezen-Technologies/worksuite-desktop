import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { reminderAction } from '@shared/task-reminders';
import { apiPatch, apiPost } from '../../core/api';
import { errorMessage } from '../../core/bridge';
import { toast } from '../../core/toasts';
import { Button } from '../../components/ui';
import { act, K, type Notice } from './api';

export function TaskReminderActions({ notice }: { notice: Notice }) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const action = notice.event === 'task.reminder' ? reminderAction(notice.link, notice.actions) : null;
  if (!action) return null;
  const run = async (snooze: boolean) => {
    if (busy) return;
    setBusy(true);
    try {
      if (snooze) await apiPost(`/api/task-reminder-runs/${action.runId}/snooze`, { minutes: 15 });
      else await apiPatch(`/api/tasks/${action.taskId}`, { field: 'status', value: 'done' });
      await act(notice.id, 'read');
      await Promise.all([qc.invalidateQueries({ queryKey: K.all }), qc.invalidateQueries({ queryKey: ['tasks'] })]);
      toast('info', snooze ? 'Reminder snoozed for 15 minutes.' : 'Task completed.');
    } catch (e) {
      toast('error', errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <span className="pointer-events-auto flex flex-wrap gap-1">
      <Button size="sm" disabled={busy} onClick={() => void run(true)}>
        Snooze 15 min
      </Button>
      <Button size="sm" disabled={busy} onClick={() => void run(false)}>
        Mark Complete
      </Button>
    </span>
  );
}
