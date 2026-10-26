import { describe, expect, it } from 'vitest';
import { fromMinor, itemState, toAccess, toBatch } from '../../../src/modules/cheque/api';

describe('Cheque Manager reads the server', () => {
  it('reads amounts, permissions and a batch’s run as the server sends them', () => {
    expect(fromMinor(12545075)).toBe('125450.75');
    expect(fromMinor('5')).toBe('0.05');
    expect(fromMinor(-150)).toBe('-1.50');
    expect(toAccess({ permissions: { 1: ['cheque.print'], 2: ['cheque.view'] } }).permissions.sort()).toEqual(['cheque.print', 'cheque.view']);
    expect(itemState('APPROVED', 'AWAITING_CONFIRMATION')).toBe('spooled');
    expect(itemState('APPROVED', 'SENT_TO_DEVICE')).toBe('unknown');
    expect(itemState('PRINTED', 'CONFIRMED')).toBe('confirmed');
    expect(itemState('APPROVED', null)).toBe('waiting');
    // Batches::detail
    const b = toBatch({
      id: 14, status: 'RECONCILE_REQUIRED', profile_id: 5, message: 'Job 3 failed: paper jam',
      run: [
        { cheque_id: 1, cheque_number: '004928', status: 'PRINTED', payee: 'Serendib Office Supplies', amount: '38200.00', currency: 'LKR', job: { id: 2, status: 'CONFIRMED' } },
        { cheque_id: 2, cheque_number: '004929', status: 'APPROVED', payee: 'Matara Builders', amount: '265000.00', currency: 'LKR', job: { id: 3, status: 'FAILED' } },
      ],
      unsettled: [{ job_id: 3, leaf_id: 51, cheque_number: '004929', job_status: 'FAILED' }],
    });
    expect(b).toMatchObject({ reference: 'Batch 14', status: 'RECONCILE_REQUIRED', unsettled: [{ leaf_id: 51 }], items: [{ state: 'confirmed' }, { cheque_number: '004929', payee_name: 'Matara Builders', amount: '265000.00', state: 'unknown', job_id: 3 }] });
  });
});
