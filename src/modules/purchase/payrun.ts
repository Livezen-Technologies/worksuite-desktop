import { purchaseExportName, type PurchaseExport } from '@shared/purchase';
import type { PaymentRun } from './api';

/**
 * Payment runs (SRS-PUR-001 G-20), kept out of the screen so they can be tested: a proposal of the bills due by a date
 * → approval by somebody other than whoever proposed it → the bank file (CSV, or ISO 20022 pain.001 XML), saved on
 * this computer → marked paid, which records the payments and sets them against the bills through the usual path.
 */

export const RUN_LABEL: Record<string, string> = {
  proposed: 'Proposed',
  draft: 'Proposed',
  pending: 'Waiting on approval',
  approved: 'Approved',
  exported: 'Bank file made',
  paid: 'Paid',
  cancelled: 'Cancelled',
};

export const runTone = (s: string): 'grey' | 'amber' | 'blue' | 'green' =>
  s === 'paid' ? 'green' : s === 'approved' || s === 'exported' ? 'blue' : s === 'cancelled' ? 'grey' : 'amber';

export interface RunActions {
  approve: boolean;
  /** The bank file: only once approved. */
  export: boolean;
  markPaid: boolean;
  /** Why a step is not offered, when that is not obvious. */
  note: string | null;
}

/** What may be done to a run now: `pay` holds `payables.pay`; `approve` an approve permission; offline nothing. */
export function runActions(run: Pick<PaymentRun, 'status' | 'mine'>, c: { pay: boolean; approve: boolean; offline: boolean }): RunActions {
  const s = run.status;
  const proposed = s === 'proposed' || s === 'draft' || s === 'pending';
  const approved = s === 'approved' || s === 'exported';
  if (c.offline) return { approve: false, export: false, markPaid: false, note: proposed || approved ? 'This waits for the connection.' : null };
  return {
    approve: proposed && c.approve && run.mine !== true,
    export: approved && c.pay,
    markPaid: approved && c.pay,
    note: proposed && c.approve && run.mine === true ? 'You proposed this run, so someone else approves it.' : proposed && !c.approve ? 'Waiting on approval.' : null,
  };
}

export type BankFormat = 'csv' | 'pain001';

/**
 * The download that saves a run's bank file on this computer (`transfers:download {purchaseExport}`): the main process
 * builds `/api/purchase/payment-runs/{id}/export?format=…` itself. Null before the run is approved — the server would
 * refuse it, and a bank file of an unapproved run must not leave the building.
 */
export function runExportRequest(run: Pick<PaymentRun, 'id' | 'reference' | 'status'>, format: BankFormat): { purchaseExport: PurchaseExport; name: string } | null {
  if (run.status !== 'approved' && run.status !== 'exported' && run.status !== 'paid') return null;
  const purchaseExport: PurchaseExport = { what: 'payment-run', run: run.id, format };
  return { purchaseExport, name: purchaseExportName(purchaseExport, run.reference || `run-${run.id}`) };
}
