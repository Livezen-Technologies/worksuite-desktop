/**
 * Recruitment's notifications on the desktop (WorkSuite docs/recruitment/API.md, category `recruitment`): which
 * screen each `recruitment.*` key opens. The server's own link wins only when no screen of ours fits the key.
 */
export const RECRUITMENT_SCREENS: Readonly<Record<string, string>> = {
  'recruitment.interview_scheduled': 'today',
  'recruitment.interview_changed': 'today',
  'recruitment.evaluation_due': 'cards',
  'recruitment.evaluation_overdue': 'cards',
  'recruitment.offer_waiting': 'appr',
  'recruitment.requisition_waiting': 'appr',
  'recruitment.application_received': 'review',
};

const id = (v: unknown): number | null => (typeof v === 'number' && Number.isInteger(v) && v > 0 ? v : typeof v === 'string' && /^\d{1,12}$/.test(v) ? Number(v) : null);

/** The desktop link for a recruitment notification, or null when the key is not one of ours. */
export function recruitmentNoticeLink(event: string | null | undefined, data?: unknown): string | null {
  const tab = event ? RECRUITMENT_SCREENS[event] : undefined;
  if (!tab) return null;
  const d = (data && typeof data === 'object' ? data : {}) as Record<string, unknown>;
  const interview = id(d.interview_id);
  const job = id(d.job_id);
  if (tab === 'cards' && interview) return `/recruitment?tab=cards&interview=${interview}`;
  if ((tab === 'review') && job) return `/recruitment?tab=review&job=${job}`;
  return `/recruitment?tab=${tab}`;
}
