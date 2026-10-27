import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/core/bridge', () => ({ call: vi.fn(async () => ({ ok: true })), on: () => () => undefined, errorMessage: (e: unknown) => String(e), isMac: false }));
vi.mock('../../../src/core/api', () => ({ apiGet: vi.fn(), apiPost: vi.fn(async () => ({})), apiPatch: vi.fn(async () => ({})), request: vi.fn() }));

import { apiGet, apiPost, request } from '../../../src/core/api';
import {
  confirmPrint,
  fetchProfiles,
  fetchQueue,
  fromMinor,
  has,
  isStepUpRequired,
  itemState,
  profileFor,
  reconcileBatch,
  requestReprint,
  startBatch,
  toAccess,
  toBatch,
  toHome,
  toProfile,
  type Profile,
  type QueueItem,
} from '../../../src/modules/cheque/api';

const get = vi.mocked(apiGet);
const post = vi.mocked(apiPost);
const req = vi.mocked(request);

const profile = (p: Partial<Profile>): Profile => ({ id: 1, device_id: 'dev', printer_name: 'P', tray: null, offset_x_mm: 0, offset_y_mm: 0, version_ids: [], restricted_accounts: null, active: true, ...p });
const item = (q: Partial<QueueItem>): QueueItem => ({ cheque_id: 1, cheque_number: '000101', payee_name: 'A', amount: '1.00', currency: 'LKR', bank_account_id: 5, bank_account: 'BOC', template_version_id: 3, ...q });

/**
 * Cheque Manager's normalisers (Cheque SRS v1.0): they only read what the server sent into one shape — they add
 * nothing up and move no leaf (audit D-G07).
 */
describe('Cheque Manager api', () => {
  beforeEach(() => {
    get.mockReset();
    post.mockClear();
    req.mockReset();
  });

  it('writes minor units as a decimal string, without floating point', () => {
    expect(fromMinor(12545075)).toBe('125450.75');
    expect(fromMinor('5')).toBe('0.05');
    expect(fromMinor('-120')).toBe('-1.20');
    expect(fromMinor('999', 0)).toBe('999');
    expect(fromMinor('12.5')).toBeNull();
    expect(fromMinor(null)).toBeNull();
    // 2^53 + 1 would lose its last digit as a number.
    expect(fromMinor('9007199254740993')).toBe('90071992547409.93');
  });

  it("flattens the caller's permissions from every company", () => {
    const a = toAccess({ permissions: { 1: ['cheque.print'], 2: ['cheque.print', 'cheque.batch'] }, companies: [{ permissions: ['cheque.calibrate', 7] }] });
    expect(a.permissions.sort()).toEqual(['cheque.batch', 'cheque.calibrate', 'cheque.print']);
    expect(has(a, 'cheque.batch')).toBe(true);
    expect(has(undefined, 'cheque.batch')).toBe(false);
    expect(toAccess(null).permissions).toEqual([]);
  });

  it("reads the station's tiles and recent prints whatever the field names", () => {
    const h = toHome({
      kpis: { ready_to_print: 4, awaiting_approval: { count: '2' } },
      widgets: { recent_prints: [{ job_id: 9, number: '000102', payee: 'Ravi', status: 'PRINTED', printed_at: '2026-10-26T08:00:00Z', batch_id: 3 }, { payee_name: 'Nimal' }] },
      attention: [{ tone: 'amber', title: 'Book low', text: '3 leaves left' }],
    });
    expect(h.ready_to_print).toBe(4);
    expect(h.awaiting_approval).toBe(2);
    expect(h.received_pending).toBe(0);
    expect(h.recent_prints[0]).toEqual({ id: '9', cheque_number: '000102', payee_name: 'Ravi', result: 'printed', at: '2026-10-26T08:00:00Z', batch: true });
    expect(h.recent_prints[1]).toMatchObject({ id: '1', payee_name: 'Nimal', at: null, batch: false });
    expect(h.attention).toEqual([{ tone: 'amber', title: 'Book low', text: '3 leaves left' }]);
  });

  it('reads a printer profile, and its account restriction only when it names accounts', () => {
    const p = toProfile({ id: '4', device_id: 77, printer_name: 'Epson', offset_x_mm: '1.5', version_ids: [1, '2', 'x'], restricted: { bank_account_ids: ['5'] }, active: 0 });
    expect(p).toEqual({ id: 4, device_id: '77', printer_name: 'Epson', tray: null, offset_x_mm: 1.5, offset_y_mm: 0, version_ids: [1, 2], restricted_accounts: [5], active: false });
    expect(toProfile({ id: 1, restricted: { bank_account_ids: [] } }).restricted_accounts).toBeNull();
  });

  it("lists only this computer's active profiles, and none without a device", async () => {
    get.mockResolvedValueOnce({ items: [{ id: 1, device_id: 'me' }, { id: 2, device_id: 'other' }, { id: 3, device_id: 'me', active: false }] });
    expect((await fetchProfiles('me')).map((p) => p.id)).toEqual([1]);
    expect(await fetchProfiles(null)).toEqual([]);
    expect(get).toHaveBeenCalledTimes(1);
  });

  it('names each queued cheque\'s bank account, from the cheque, the account list, or its number', async () => {
    get.mockImplementation(async (path: string) =>
      path.endsWith('/cheques')
        ? { data: [{ id: 1, bank_account_id: 5, amount_minor: 1000, payee_name_snapshot: 'A' }, { id: 2, bank_account_id: 6, bank_account: { name: 'HNB' }, amount: '2.00' }, { id: 3, bank_account_id: 9 }] }
        : [{ id: 5, name: 'BOC' }],
    );
    const q = await fetchQueue();
    expect(q.map((x) => [x.cheque_id, x.bank_account, x.amount])).toEqual([
      [1, 'BOC', '10.00'],
      [2, 'HNB', '2.00'],
      [3, 'Account 9', ''],
    ]);
    expect(get).toHaveBeenCalledWith('/api/cheque/cheques', { status: 'APPROVED', per_page: 200 }, undefined);
  });

  it('still lists the queue when the bank accounts cannot be read', async () => {
    get.mockImplementation(async (path: string) => {
      if (path.endsWith('/bank-accounts')) throw new Error('forbidden');
      return [{ id: 1, bank_account_id: 5 }];
    });
    expect((await fetchQueue())[0]?.bank_account).toBe('Account 5');
  });

  it('picks a profile linked to the template version and not restricted away from the account', () => {
    const linked = profile({ id: 2, version_ids: [3] });
    const other = profile({ id: 3, version_ids: [8] });
    const restricted = profile({ id: 4, version_ids: [], restricted_accounts: [99] });
    expect(profileFor(item({}), [other, linked])?.id).toBe(2);
    expect(profileFor(item({}), [other, restricted])).toBeNull();
    expect(profileFor(item({ template_version_id: null }), [other])?.id).toBe(3);
    expect(profileFor(item({ bank_account_id: 99 }), [restricted])?.id).toBe(4);
  });

  it("places a leaf in the run; a job sent but not reported spooled is unknown (CHQ-BAT-05)", () => {
    expect(itemState('PRINTED', null)).toBe('confirmed');
    expect(itemState('approved', 'confirmed')).toBe('confirmed');
    expect(itemState('APPROVED', 'AWAITING_CONFIRMATION')).toBe('spooled');
    expect(itemState('APPROVED', 'SENT_TO_DEVICE')).toBe('unknown');
    expect(itemState('APPROVED', 'FAILED')).toBe('unknown');
    expect(itemState('APPROVED', 'QUEUED')).toBe('queued');
    expect(itemState('APPROVED', undefined)).toBe('waiting');
  });

  it('reads a batch, its run and what a reconciliation must name', () => {
    const b = toBatch({ id: 12, status: 'reconcile_required', run: [{ cheque_id: 1, leaf_id: '30', cheque_number: '000101', payee: 'A', amount_minor: 250, job: { id: 70, status: 'SENT_TO_DEVICE' } }, { cheque_id: 2, status: 'PRINTED' }], unsettled: [{ job_id: 70, leaf_id: 30, cheque_number: '000101', job_status: 'SENT_TO_DEVICE' }] });
    expect(b.reference).toBe('Batch 12');
    expect(b.status).toBe('RECONCILE_REQUIRED');
    expect(b.count).toBe(2);
    expect(b.items[0]).toEqual({ cheque_id: 1, leaf_id: 30, job_id: 70, cheque_number: '000101', payee_name: 'A', amount: '2.50', currency: '', state: 'unknown' });
    expect(b.items[1]?.state).toBe('confirmed');
    expect(b.unsettled).toEqual([{ job_id: 70, leaf_id: 30, cheque_number: '000101', job_status: 'SENT_TO_DEVICE' }]);
  });

  it('only the person confirms a leaf, with notes when they wrote some', async () => {
    await confirmPrint(70, 'spoiled');
    expect(post).toHaveBeenLastCalledWith('/api/cheque/print-jobs/70/confirm', { result: 'spoiled' });
    await confirmPrint(70, 'printed', 'Clean');
    expect(post).toHaveBeenLastCalledWith('/api/cheque/print-jobs/70/confirm', { result: 'printed', notes: 'Clean' });
    await reconcileBatch(12, [{ leaf_id: 30, outcome: 'blank' }]);
    expect(post).toHaveBeenLastCalledWith('/api/cheque/batches/12/reconcile', { leaves: [{ leaf_id: 30, outcome: 'blank' }] });
    await startBatch(12);
    expect(post).toHaveBeenLastCalledWith('/api/cheque/batches/12/start', {});
  });

  it('asks for a reprint with a step-up token only when there is one', async () => {
    req.mockResolvedValue({ data: { ok: true }, offline: false, cachedAt: null, message: null } as never);
    await requestReprint(1, 'Jammed');
    expect(req).toHaveBeenLastCalledWith('POST', '/api/cheque/cheques/1/reprint-request', { body: { reason: 'Jammed' }, headers: undefined });
    await requestReprint(1, 'Jammed', 'tok');
    expect(req).toHaveBeenLastCalledWith('POST', '/api/cheque/cheques/1/reprint-request', { body: { reason: 'Jammed' }, headers: { 'X-Step-Up': 'tok' } });
  });

  it('knows a step-up request when it sees one', () => {
    expect(isStepUpRequired({ status: 428, code: 'STEP_UP_REQUIRED' })).toBe(true);
    expect(isStepUpRequired({ status: 428, data: { code: 'STEP_UP_REQUIRED' }, code: 'X' })).toBe(true);
    expect(isStepUpRequired({ status: 428 })).toBe(true);
    expect(isStepUpRequired({ status: 428, code: 'OTHER' })).toBe(false);
    expect(isStepUpRequired({ status: 403, code: 'STEP_UP_REQUIRED' })).toBe(false);
  });
});
