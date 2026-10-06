/**
 * Words and colours for every state the module shows (WS-SMM-SRS-001 §13): posts, per-account targets, account
 * connections, inbox threads, campaigns and publish attempts. One table, so a status reads the same on every screen.
 */

export type Tone = 'info' | 'success' | 'warning' | 'danger' | 'muted' | 'violet' | 'teal';

export const TONE_CLASS: Record<Tone, string> = {
  info: 'bg-selection text-primary',
  success: 'bg-success-bg text-success',
  warning: 'bg-warning-bg text-warning',
  danger: 'bg-danger-bg text-danger',
  muted: 'bg-subtle text-ink-2',
  violet: 'bg-[#F3E8FF] text-[#6B21A8] dark:bg-[#2E1D4A] dark:text-[#D2B4FE]',
  teal: 'bg-teal/10 text-teal',
};

/** A solid dot or bar in the tone (calendar chips, the legend). */
export const TONE_SOLID: Record<Tone, string> = {
  info: 'bg-primary',
  success: 'bg-success',
  warning: 'bg-warning',
  danger: 'bg-danger',
  muted: 'bg-ink-3',
  violet: 'bg-[#7C3AED]',
  teal: 'bg-teal',
};

export type PostStatus =
  | 'draft'
  | 'in_review'
  | 'approved'
  | 'scheduled'
  | 'queued'
  | 'held'
  | 'publishing'
  | 'published'
  | 'partly_published'
  | 'failed'
  | 'cancelled'
  | 'rejected';

export const POST_STATUS: Record<PostStatus, { label: string; tone: Tone }> = {
  draft: { label: 'Draft', tone: 'muted' },
  in_review: { label: 'In review', tone: 'warning' },
  approved: { label: 'Approved', tone: 'success' },
  scheduled: { label: 'Scheduled', tone: 'info' },
  queued: { label: 'Queued', tone: 'teal' },
  held: { label: 'Held', tone: 'warning' },
  publishing: { label: 'Publishing', tone: 'info' },
  published: { label: 'Published', tone: 'success' },
  partly_published: { label: 'Partly published', tone: 'warning' },
  failed: { label: 'Failed', tone: 'danger' },
  cancelled: { label: 'Cancelled', tone: 'muted' },
  rejected: { label: 'Rejected', tone: 'danger' },
};

export type TargetStatus =
  | 'pending'
  | 'scheduled'
  | 'queued'
  | 'held'
  | 'publishing'
  | 'retrying'
  | 'published'
  | 'published_with_warnings'
  | 'published_private'
  | 'failed'
  | 'reminder_due'
  | 'published_manual'
  | 'missed'
  | 'cancelled';

export const TARGET_STATUS: Record<TargetStatus, { label: string; tone: Tone }> = {
  pending: { label: 'Pending', tone: 'muted' },
  scheduled: { label: 'Scheduled', tone: 'info' },
  queued: { label: 'Queued', tone: 'teal' },
  held: { label: 'Held', tone: 'warning' },
  publishing: { label: 'Publishing', tone: 'info' },
  retrying: { label: 'Retrying', tone: 'warning' },
  published: { label: 'Published', tone: 'success' },
  published_with_warnings: { label: 'Published with warnings', tone: 'warning' },
  published_private: { label: 'Published as private', tone: 'warning' },
  failed: { label: 'Failed', tone: 'danger' },
  reminder_due: { label: 'Manual reminder', tone: 'violet' },
  published_manual: { label: 'Posted by hand', tone: 'success' },
  missed: { label: 'Missed', tone: 'danger' },
  cancelled: { label: 'Cancelled', tone: 'muted' },
};

export type AccountStatus = 'pending' | 'connected' | 'expiring' | 'needs_reconnect' | 'limited' | 'disconnected' | 'error';

export const ACCOUNT_STATUS: Record<AccountStatus, { label: string; tone: Tone }> = {
  pending: { label: 'Connecting', tone: 'muted' },
  connected: { label: 'Connected', tone: 'success' },
  expiring: { label: 'Expiring', tone: 'warning' },
  needs_reconnect: { label: 'Needs reconnect', tone: 'danger' },
  limited: { label: 'Limited', tone: 'warning' },
  disconnected: { label: 'Disconnected', tone: 'muted' },
  error: { label: 'Error', tone: 'danger' },
};

/** "Expires in 3 days" for an expiring account, else the status word. */
export function accountStatusLabel(status: AccountStatus, expiresAt: string | null | undefined, now = Date.now()): string {
  if (status === 'expiring' && expiresAt) {
    const days = Math.ceil((Date.parse(expiresAt.includes('T') ? expiresAt : `${expiresAt.replace(' ', 'T')}Z`) - now) / 86_400_000);
    if (Number.isFinite(days)) return days <= 0 ? 'Expires today' : days === 1 ? 'Expires tomorrow' : `Expires in ${days} days`;
  }
  return ACCOUNT_STATUS[status]?.label ?? status;
}

/** Accounts someone has to act on (the Overview banner, the rail's badge). */
export function needsAttention(status: AccountStatus): boolean {
  return status === 'expiring' || status === 'needs_reconnect' || status === 'error' || status === 'limited';
}

export type ThreadStatus = 'new' | 'assigned' | 'replied' | 'open' | 'closed' | 'spam' | 'hidden';

export const THREAD_STATUS: Record<ThreadStatus, { label: string; tone: Tone }> = {
  new: { label: 'New', tone: 'info' },
  assigned: { label: 'Assigned', tone: 'teal' },
  replied: { label: 'Replied', tone: 'success' },
  open: { label: 'Open', tone: 'info' },
  closed: { label: 'Closed', tone: 'muted' },
  spam: { label: 'Spam', tone: 'danger' },
  hidden: { label: 'Hidden', tone: 'muted' },
};

export type CampaignStatus = 'draft' | 'planned' | 'running' | 'ended' | 'archived';

export const CAMPAIGN_STATUS: Record<CampaignStatus, { label: string; tone: Tone }> = {
  draft: { label: 'Draft', tone: 'muted' },
  planned: { label: 'Planned', tone: 'warning' },
  running: { label: 'Running', tone: 'info' },
  ended: { label: 'Ended', tone: 'success' },
  archived: { label: 'Archived', tone: 'muted' },
};

export type AttemptOutcome = 'published' | 'published_with_warnings' | 'published_private' | 'failed' | 'retrying' | 'manual_reminder' | 'held';

export const ATTEMPT_OUTCOME: Record<AttemptOutcome, { label: string; tone: Tone }> = {
  published: { label: 'Published', tone: 'success' },
  published_with_warnings: { label: 'Published with warnings', tone: 'warning' },
  published_private: { label: 'Published as private', tone: 'warning' },
  failed: { label: 'Failed', tone: 'danger' },
  retrying: { label: 'Retrying', tone: 'warning' },
  manual_reminder: { label: 'Manual reminder', tone: 'violet' },
  held: { label: 'Held', tone: 'warning' },
};

/** Provider error classes (§16 mapError, WF-06) in plain words, and the one action that fixes each. */
export type ErrorClass = 'rate_limited' | 'temporary' | 'auth_revoked' | 'permission_missing' | 'media_rejected' | 'policy_rejected' | 'duplicate' | 'not_supported' | 'unknown';

export const ERROR_CLASS: Record<ErrorClass, { label: string; permanent: boolean; action: 'reconnect_retry' | 'edit_media' | 'retry' | 'edit' | null }> = {
  rate_limited: { label: 'The network limited how fast we may post; it is tried again.', permanent: false, action: 'retry' },
  temporary: { label: 'The network did not answer in time; it is tried again.', permanent: false, action: 'retry' },
  auth_revoked: { label: 'Access to the account was revoked or has expired.', permanent: true, action: 'reconnect_retry' },
  permission_missing: { label: 'The account did not grant the permission this needs.', permanent: true, action: 'reconnect_retry' },
  media_rejected: { label: 'The network refused the media.', permanent: true, action: 'edit_media' },
  policy_rejected: { label: 'The network refused the post under its policies.', permanent: true, action: 'edit' },
  duplicate: { label: 'The network says this was already posted.', permanent: true, action: null },
  not_supported: { label: 'The network’s API cannot publish this.', permanent: true, action: 'edit' },
  unknown: { label: 'The network gave an error WorkSuite does not recognise.', permanent: true, action: 'retry' },
};

/** Calendar colours by status (W03 legend): scheduled, in queue, in review, draft, published, failed. */
export type CalendarBucket = 'scheduled' | 'queued' | 'in_review' | 'draft' | 'published' | 'failed';

export const CALENDAR_BUCKETS: Array<{ id: CalendarBucket; label: string; tone: Tone }> = [
  { id: 'scheduled', label: 'Scheduled', tone: 'info' },
  { id: 'queued', label: 'In queue', tone: 'teal' },
  { id: 'in_review', label: 'In review', tone: 'warning' },
  { id: 'draft', label: 'Draft', tone: 'muted' },
  { id: 'published', label: 'Published', tone: 'success' },
  { id: 'failed', label: 'Failed', tone: 'danger' },
];

export function calendarBucket(status: PostStatus): CalendarBucket {
  switch (status) {
    case 'queued':
      return 'queued';
    case 'in_review':
      return 'in_review';
    case 'draft':
    case 'cancelled':
    case 'rejected':
      return 'draft';
    case 'published':
    case 'partly_published':
      return 'published';
    case 'failed':
    case 'held':
      return 'failed';
    default:
      return 'scheduled';
  }
}

/** A post that is already out (or going out) cannot be moved on the calendar (WF-08). */
export function canReschedule(status: PostStatus): boolean {
  return !['publishing', 'published', 'partly_published', 'cancelled', 'rejected'].includes(status);
}
