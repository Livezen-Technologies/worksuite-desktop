// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AllergyGate } from '../../../src/modules/salon/CheckIn';
import { STATEMENT, type Allergy } from '../../../src/modules/salon/api';

afterEach(() => cleanup());

const ppd: Allergy = { id: 1, substance: 'PPD', reaction: 'Swelling of the scalp', severity: 'severe', withdrawn_at: null };

function gate(over: Partial<Parameters<typeof AllergyGate>[0]> = {}) {
  const onConfirm = vi.fn();
  render(
    <AllergyGate
      title="Amaya has an allergy on file"
      sub="Read before checking in"
      allergies={[ppd]}
      patchTests={[]}
      missing={[]}
      statement={STATEMENT}
      gate={null}
      busy={false}
      confirmLabel="Check in Amaya"
      onConfirm={onConfirm}
      onClose={() => undefined}
      {...over}
    />,
  );
  return onConfirm;
}

describe('the allergy is read out before check-in (SAFE-02)', () => {
  it('shows what is on file and holds Check in until the statement is ticked', () => {
    const onConfirm = gate();

    expect(screen.getByText('PPD')).toBeTruthy();
    expect(screen.getByText('— Swelling of the scalp')).toBeTruthy();
    const confirm = screen.getByRole('button', { name: /Check in Amaya/ }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);

    fireEvent.click(screen.getByRole('checkbox'));
    expect(confirm.disabled).toBe(false);
    fireEvent.click(confirm);

    expect(onConfirm).toHaveBeenCalledWith({ ack: true, statement: STATEMENT });
  });

  it('asks why when a service needs a patch test there is none of', () => {
    const onConfirm = gate({ allergies: [], missing: ['Root colour'] });
    const confirm = screen.getByRole('button', { name: /Check in Amaya/ }) as HTMLButtonElement;

    expect(screen.getByText(/Root colour needs a valid patch test/)).toBeTruthy();
    expect(confirm.disabled).toBe(true);

    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Tested at her last salon last week' } });
    fireEvent.click(confirm);

    expect(onConfirm).toHaveBeenCalledWith({ patch_override: 'Tested at her last salon last week' });
  });

  it('says what the server found when it refused', () => {
    gate({ gate: { ok: false, code: 'ack_required', message: 'This client has severe PPD on file.', allergies: [ppd], missing_patch: [] } });

    expect(screen.getByText('This client has severe PPD on file.')).toBeTruthy();
  });
});
