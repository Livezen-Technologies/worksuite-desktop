/** Only the task reminder's own record and recipient-scoped delivery may be acted on. */
export function reminderAction(link: string | null | undefined, actions: unknown): { taskId: number; runId: number } | null {
  const match = /^\/tasks\?task=(\d+)$/.exec(link ?? '');
  if (!match) return null;
  let parsed = actions;
  if (typeof actions === 'string') {
    try {
      parsed = JSON.parse(actions);
    } catch {
      return null;
    }
  }
  if (!Array.isArray(parsed)) return null;
  const taskId = Number(match[1]);
  const snooze = parsed.find((a) => a && a.label === 'Snooze');
  const complete = parsed.find((a) => a && a.label === 'Mark Complete');
  return Number.isSafeInteger(taskId) && taskId > 0 && Number.isSafeInteger(snooze?.reminder_run) && snooze.reminder_run > 0 && complete?.task_id === taskId
    ? { taskId, runId: snooze.reminder_run }
    : null;
}
