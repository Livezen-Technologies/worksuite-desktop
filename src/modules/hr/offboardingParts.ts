/**
 * Offboarding's shapes (HrOffboarding, HrAdminSheet "Handover"), as the
 * server's `Offboarding::shape` writes them — every write returns the whole
 * case in this form. Stamps are UTC; `due_on` and the last working day are
 * the company's calendar days.
 */
export interface Who {
  id: number;
  name: string | null;
}

export type ItemSource = 'checklist' | 'manual' | 'asset' | 'advances' | 'loan' | 'handover' | 'work' | 'exit';

export interface OffItem {
  id: number;
  title: string;
  description: string | null;
  source: ItemSource;
  status: 'open' | 'done' | 'waived';
  status_label: string;
  due_on: string | null;
  overdue: boolean;
  mandatory: boolean;
  evidence_required: boolean;
  evidence: { document_id: number; filename: string | null } | null;
  note: string | null;
  waived_reason: string | null;
  done_by: Who | null;
  done_at: string | null;
  assignees: Who[];
  mine: boolean;
  may_complete: boolean;
  may_attach: boolean;
  may_waive: boolean;
  may_reopen: boolean;
  may_return_asset: boolean;
}

export interface OffDepartment {
  id: number;
  key: string;
  name: string;
  status: 'pending' | 'cleared';
  approvers: Who[];
  fallback: string | null;
  cleared_by: Who | null;
  cleared_at: string | null;
  note: string | null;
  progress: { mandatory: number; finished: number; percent: number; ready: boolean; cleared: boolean } | null;
  items: OffItem[];
  may_clear: boolean;
  may_add: boolean;
  may_reopen: boolean;
}

export type HandoverStatus = 'draft' | 'sent' | 'accepted' | 'returned';

export interface HandoverItem {
  id: number;
  section: string;
  section_label: string;
  title: string;
  details: string | null;
  reference: string | null;
  recipient: Who;
  written_by: Who | null;
  status: HandoverStatus;
  status_label: string;
  response: string | null;
  responded_at: string | null;
  sent_at: string | null;
  mine: boolean;
  may_edit: boolean;
  may_respond: boolean;
}

export interface Handover {
  id: number;
  status: 'empty' | 'open' | 'accepted';
  counts: Record<HandoverStatus, number>;
  items: HandoverItem[];
  may_write: boolean;
  may_send: boolean;
  sections: Record<string, string>;
  colleagues: Array<{ id: number; name: string }>;
}

export interface WorkKind {
  kind: string;
  label: string;
  count: number;
  items: Array<{ id: number; label: string; detail: string | null; link: string }>;
}

export interface ExitQuestion {
  id: number;
  prompt: string;
  kind: 'text' | 'long_text' | 'rating' | 'single' | 'multiple' | 'yes_no';
  options: string[];
  required: boolean;
  answer?: string | string[] | null;
}

export interface ExitInterview {
  id: number;
  status: 'open' | 'submitted';
  questionnaire: string | null;
  submitted_at: string | null;
  may_answer: boolean;
  recording: boolean;
  questions?: ExitQuestion[];
  hr_notes?: string | null;
  hr_notes_by?: string | null;
  hr_notes_at?: string | null;
  may_note?: boolean;
}

export interface LoginState {
  due_at: string | null;
  time: string;
  off_at: string | null;
  off_by: string | null;
  note: string | null;
  held: boolean;
  hold_reason: string | null;
  held_by: string | null;
  withdrawal: boolean;
  has_login: boolean;
  may_hold: boolean;
  may_release: boolean;
  may_switch: boolean;
}

export interface OffCase {
  id: number;
  org_id: number;
  employee: { id: number; name: string };
  resignation_id: number | null;
  last_working_date: string;
  status: 'open' | 'completed' | 'cancelled';
  status_label: string;
  template_name: string | null;
  completed_at: string | null;
  cancel_reason: string | null;
  progress: { percent: number; cleared: number; total: number };
  departments: OffDepartment[];
  blockers: string[];
  may_complete: boolean;
  runs: boolean;
  events?: Array<{ event: string; before: string | null; after: string | null; note: string | null; by: Who | null; at: string }>;
  handover?: Handover;
  work?: { kinds: WorkKind[]; colleagues: Array<{ id: number; name: string }> } | null;
  moved?: Array<{ kind: string; label: string | null; to: string | null; by: string | null; at: string }>;
  exit_interview?: ExitInterview | null;
  login?: LoginState;
}

export interface OffListItem {
  id: number;
  status: OffCase['status'];
  status_label: string;
  percent: number;
  cleared: number;
  departments: number;
  last_working_date: string;
  completed_at: string | null;
  employee: { id: number; name: string; no: string };
  company: string | null;
  template_name: string | null;
}

/** Items the server keeps in step with another module; they are never ticked by hand. */
export const FOLLOWS: Partial<Record<ItemSource, string>> = {
  asset: 'Follows Assets',
  advances: 'Follows Expenses',
  loan: 'Follows Payroll',
  handover: 'Follows the handover',
  work: 'Follows their open work',
  exit: 'Follows the exit interview',
};

export const EVENT_WORDS: Record<string, string> = {
  opened: 'Offboarding started',
  task_done: 'Done',
  task_added: 'Item added',
  task_waived: 'Waived',
  task_reopened: 'Put back to do',
  evidence_attached: 'Evidence attached',
  asset_returned: 'Return recorded',
  cleared: 'Signed off',
  clearance_reopened: 'Sign-off reopened',
  date_moved: 'Last working day moved',
  completed: 'Completed',
  cancelled: 'Cancelled',
  handover_item_added: 'Handover item written',
  handover_item_removed: 'Handover item removed',
  handover_sent: 'Handover sent',
  handover_accepted: 'Handover item accepted',
  handover_returned: 'Handover item returned',
  work_reassigned: 'Work moved',
  exit_interview: 'Exit interview submitted',
  login_held: 'Login held on',
  login_released: 'Login hold released',
  login_off: 'Login switched off',
  login_refused: 'Login could not be switched off',
};

/** A UTC stamp on the reader's clock: "30 Sep, 18:00". */
export function stamp(s: string | null | undefined): string {
  if (!s) return '—';
  const d = new Date(`${s.replace(' ', 'T')}Z`);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}
