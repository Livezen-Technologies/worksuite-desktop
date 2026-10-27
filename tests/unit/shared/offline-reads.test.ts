import { describe, expect, it } from 'vitest';
import { offlineReadModule, offlineReadOwner, OFFLINE_READ_MODULES } from '../../../shared/offline-reads';
import { moduleFor, REJECTED } from '../../../src/modules/registry';

/**
 * Read-only offline for Finance, Expenses, Marketing, Cheque Manager and Recruitment (audit D-G14): which GET answers
 * the main process keeps in the encrypted cache, and that secrets and one-time answers never are.
 */
describe('offline read caches (D-G14)', () => {
  it('keeps the lists, dashboards and records each module reads', () => {
    expect(offlineReadModule('/api/finance/dashboard?company=3')).toBe('finance');
    expect(offlineReadModule('/api/finance/journals/41')).toBe('finance');
    expect(offlineReadModule('/api/finance/overview/cash-flow')).toBe('finance');
    expect(offlineReadModule('/api/expense/claims/12')).toBe('expenses');
    expect(offlineReadModule('/api/expense/approvals')).toBe('expenses');
    expect(offlineReadModule('/api/marketing/campaigns/9')).toBe('marketing');
    expect(offlineReadModule('/api/marketing/contacts/77')).toBe('marketing');
    expect(offlineReadModule('/api/cheque/cheques?status=APPROVED')).toBe('cheque');
    expect(offlineReadModule('/api/cheque/batches/5')).toBe('cheque');
    expect(offlineReadModule('/api/recruitment/jobs/4/pipeline')).toBe('recruitment');
    expect(offlineReadModule('/api/recruitment/interviews/8/kit')).toBe('recruitment');
  });

  it('never keeps a secret or a one-time answer', () => {
    for (const path of [
      '/api/finance/export/shares',
      '/api/finance/export/trial-balance/share',
      '/api/expense/claims/12/receipt',
      '/api/expense/cards',
      '/api/expense/card-transactions/3',
      '/api/marketing/webhooks',
      '/api/marketing/channels/setup',
      '/api/marketing/imports/2',
      '/api/cheque/cheques/7/pre-print-checks',
      '/api/cheque/template-versions/3/calibration-sheet',
      '/api/recruitment/candidates/5/documents/2',
      '/api/recruitment/candidates/5/files',
    ])
      expect(offlineReadModule(path), path).toBeNull();
  });

  it('keeps nothing of another module, and knows whose writes to refuse', () => {
    expect(offlineReadModule('/api/hr/leave')).toBeNull();
    expect(offlineReadModule('/api/financeX/dashboard')).toBeNull();
    expect(offlineReadOwner('/api/finance/journals')?.module).toBe('finance');
    expect(offlineReadOwner('/api/expense/claims/3/submit')?.module).toBe('expenses');
    expect(offlineReadOwner('/api/tasks')).toBeNull();
  });

  it('each module declares READ_CACHE over its prefix; Board declares its vault', () => {
    for (const m of OFFLINE_READ_MODULES) {
      const entry = moduleFor(m.module)!;
      expect(entry.manifest.offline.mode, m.module).toBe('READ_CACHE');
      expect(entry.manifest.offline.cache).toContain(m.prefix);
    }
    expect(REJECTED).toEqual([]);
    const board = moduleFor('board')!;
    expect(board.manifest.offline.mode).toBe('PARTIAL_WRITE');
  });
});
