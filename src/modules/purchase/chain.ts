import { apiPost } from '../../core/api';
import { decisionBody, decisionPath, PURCHASE_API, type ApprovalDoc } from '@shared/purchase';

/**
 * The approval chain of a purchase document (SRS-PUR-001 G-01, G-14): Purchasing's own `purchase_approvals`, built by
 * `buildChain()` from the approval threshold and levels when the document is submitted, decided step by step through
 * `decide()`. The server is the judge — above the threshold every step must approve, one person cannot approve two
 * steps, and whoever raised a document cannot approve it — so this only reads its answer and offers what it allows.
 *
 * Kept out of the screens so it can be tested: what the chain says, which buttons it offers, and what a refusal means.
 */

export type StepDecision = 'pending' | 'approved' | 'rejected' | 'skipped';

export interface ApprovalStep {
  step: number;
  label: string;
  permission: string | null;
  approver: string | null;
  decided_by: string | null;
  decision: StepDecision;
  decided_at: string | null;
  note: string | null;
}

export interface ApprovalState {
  /** Whether this document needs approval at all (below the threshold it does not). */
  required: boolean;
  status: 'none' | 'pending' | 'approved' | 'rejected';
  steps: ApprovalStep[];
  /** The server's answer: may I decide the step that is waiting. */
  canApprove: boolean;
  /** I raised this document. */
  mine: boolean;
}

const LEVEL_LABEL: Record<string, string> = { buyer: 'Buyer', department: 'Department', budget: 'Budget', finance: 'Finance', director: 'Director' };

const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v : null);
const decisionOf = (v: unknown): StepDecision => (v === 'approved' || v === 'rejected' || v === 'skipped' ? v : 'pending');

function statusOf(steps: ApprovalStep[]): ApprovalState['status'] {
  if (!steps.length) return 'none';
  if (steps.some((s) => s.decision === 'rejected')) return 'rejected';
  if (steps.some((s) => s.decision === 'pending')) return 'pending';
  return 'approved';
}

/**
 * The chain as the document's show sends it: `approval {required, status, steps, can_approve, mine}` from the
 * purchasing build, or the bare `approvals` list (and `may_approve`) from a server before it — where `canDecide` (the
 * person's approve permission) stands in for `can_approve`.
 */
export function approvalOf(d: { approval?: unknown; approvals?: unknown; may_approve?: boolean } | null | undefined, canDecide: boolean): ApprovalState {
  const a = d?.approval && typeof d.approval === 'object' ? (d.approval as Record<string, unknown>) : null;
  if (a) {
    const steps = (Array.isArray(a.steps) ? a.steps : []).map((raw, i): ApprovalStep => {
      const s = (raw ?? {}) as Record<string, unknown>;
      return {
        step: Number(s.step ?? i + 1),
        label: str(s.label) ?? LEVEL_LABEL[String(s.level ?? '')] ?? `Step ${i + 1}`,
        permission: str(s.permission),
        approver: str(s.approver),
        decided_by: str(s.decided_by) ?? str(s.decided_by_name),
        decision: decisionOf(s.decision ?? s.status),
        decided_at: str(s.decided_at),
        note: str(s.note),
      };
    });
    // `not_required` and `not_submitted` (the server's words) are "nothing in the chain yet" here.
    const st = str(a.status);
    const status = st === 'pending' || st === 'approved' || st === 'rejected' ? st : st === 'not_required' || st === 'not_submitted' ? 'none' : statusOf(steps);
    return { required: a.required !== false && (a.required === true || steps.length > 0), status, steps, canApprove: a.can_approve === true && status === 'pending', mine: a.mine === true };
  }
  const steps = (Array.isArray(d?.approvals) ? d.approvals : []).map((raw, i): ApprovalStep => {
    const s = (raw ?? {}) as Record<string, unknown>;
    return {
      step: Number(s.step ?? i + 1),
      label: LEVEL_LABEL[String(s.level ?? '')] ?? str(s.level) ?? `Step ${i + 1}`,
      permission: null,
      approver: null,
      decided_by: str(s.decided_by_name),
      decision: decisionOf(s.status),
      decided_at: str(s.decided_at),
      note: str(s.note),
    };
  });
  const status = statusOf(steps);
  return { required: steps.length > 0, status, steps, canApprove: canDecide && d?.may_approve !== false && status === 'pending', mine: d?.may_approve === false };
}

/** The step waiting for a decision now. */
export const currentStep = (a: ApprovalState): ApprovalStep | null => a.steps.find((s) => s.decision === 'pending') ?? null;

/** Where the document is in its chain, in words: "Approval 2/3". */
export function chainWords(a: ApprovalState): string | null {
  if (a.status !== 'pending' || !a.steps.length) return null;
  const done = a.steps.filter((s) => s.decision === 'approved').length;
  return `Approval ${done + 1}/${a.steps.length}`;
}

export interface ApprovalActions {
  submit: boolean;
  approve: boolean;
  reject: boolean;
  /** Why nothing can be decided here, when the document waits on somebody else. */
  note: string | null;
}

/**
 * What may be done to the chain now. `raise`: may submit this kind of document; `approve`: holds an approve permission;
 * `offline`: every decision waits for the connection.
 */
export function approvalActions(a: ApprovalState, docStatus: string, c: { raise: boolean; approve: boolean; offline: boolean }): ApprovalActions {
  // A request waits as `pending` until it is submitted; orders and returns as drafts (a rejection sends them back).
  const open = ['draft', 'rejected', 'returned'].includes(docStatus) || (docStatus === 'pending' && a.status === 'none');
  const submit = c.raise && !c.offline && open && a.status !== 'pending';
  const decide = c.approve && a.status === 'pending' && a.canApprove && !c.offline;
  let note: string | null = null;
  if (a.status === 'pending' && !a.canApprove) {
    const s = currentStep(a);
    const who = s ? `Waiting on ${s.label}${s.approver ? ` · ${s.approver}` : ''}` : 'Waiting on approval';
    note = a.mine ? 'You raised this, so someone else approves it.' : who.endsWith('.') ? who : `${who}.`;
  } else if (a.status === 'pending' && a.canApprove && c.offline) note = 'Your decision waits for the connection.';
  return { submit, approve: decide, reject: decide, note };
}

// ── refusals ─────────────────────────────────────────────────────────────

export type RefusalCode = 'approval_required' | 'self_approval' | 'same_approver' | 'not_approver' | 'already_decided' | 'possible_duplicate' | 'not_sent' | 'budget_exceeded';

const REFUSALS: Record<RefusalCode, string> = {
  approval_required: 'This needs approval first. Submit it; it can go on once every step has approved it.',
  self_approval: 'You raised this, so someone else has to approve it.',
  same_approver: 'You approved an earlier step, so someone else has to approve this one.',
  not_approver: 'This step is not yours to decide.',
  not_sent: 'Nothing was sent: no channel delivered it, and the order is unchanged. Check the address, or mark it sent if it went another way.',
  already_decided: 'Somebody has already decided this step. The chain has been refreshed to show where it stands.',
  possible_duplicate: 'This looks like an order already raised. Check the possible duplicates, then save again to confirm.',
  budget_exceeded: 'This goes over the budget left for it, and Purchasing is set to stop that.',
};

/** The server's refusal code, from the answer's `code` or its data. */
export function refusalCode(e: unknown): RefusalCode | null {
  const x = e as { code?: unknown; data?: unknown; message?: unknown } | null;
  const data = x?.data && typeof x.data === 'object' ? (x.data as Record<string, unknown>) : null;
  const candidates = [x?.code, data?.code, data?.error, data?.reason];
  for (const c of candidates) if (typeof c === 'string' && c in REFUSALS) return c as RefusalCode;
  const msg = typeof x?.message === 'string' ? x.message : '';
  return (Object.keys(REFUSALS) as RefusalCode[]).find((k) => msg.includes(k)) ?? null;
}

/** A refusal in words: ours for the codes the purchasing build names, else the server's own sentence. */
export function refusalText(e: unknown): string {
  const code = refusalCode(e);
  if (code) return REFUSALS[code];
  return e instanceof Error && e.message ? e.message : 'WorkSuite refused it.';
}

// ── the calls ────────────────────────────────────────────────────────────

const SEG: Record<Exclude<ApprovalDoc, 'bill'>, string> = { order: 'orders', request: 'requests', return: 'returns' };

/** Submit for approval: the server builds the chain from the threshold and levels (`buildChain()`). */
export function submitForApproval(doc: ApprovalDoc, id: number) {
  return apiPost<{ approval?: unknown; status?: string }>(doc === 'bill' ? `/api/inventory/bills/${id}/submit` : `${PURCHASE_API}/${SEG[doc]}/${id}/submit`, {});
}

/** Approve or reject my step (`decide()`); a rejection carries its reason. */
export function decide(doc: ApprovalDoc, id: number, decision: 'approve' | 'reject', o: { note?: string | null; step?: number | null } = {}) {
  return apiPost<{ approval?: unknown; status?: string }>(decisionPath(doc, id, decision), decisionBody(doc, decision, o));
}
