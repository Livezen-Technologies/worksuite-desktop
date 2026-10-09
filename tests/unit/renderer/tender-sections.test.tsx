// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as Work from '../../../src/modules/tenders/work';

/** Checklist sections: picked from those already there or made new, renamed on every line, or deleted. */
vi.mock('../../../src/core/bridge', () => ({ call: vi.fn(), on: () => () => undefined, errorMessage: (e: unknown) => (e instanceof Error ? e.message : String(e)), isMac: false, registerDropped: vi.fn() }));
vi.mock('../../../src/core/toasts', () => ({ toast: vi.fn() }));
vi.mock('../../../src/modules/tenders/work', async (orig) => ({ ...(await orig<typeof Work>()), updateLine: vi.fn(async () => ({})), bulkLines: vi.fn(async () => ({})) }));

import { SectionPicker, SectionSheet } from '../../../src/modules/tenders/Checklist';
import { bulkLines, updateLine, type Line } from '../../../src/modules/tenders/work';

const line = (id: number, section: string | null): Line => ({
  id, section, label: `Line ${id}`, detail: null, mandatory: true, status: 'missing' as Line['status'], owner_id: null, owner_name: null, reviewer_name: null,
  reviewed_at: null, rejection_reason: null, issued_on: null, expires_on: null, note: null, library: false, settled: false, why_not: null, files: [],
});

beforeEach(() => { vi.mocked(updateLine).mockClear(); vi.mocked(bulkLines).mockClear(); });
afterEach(() => cleanup());

function Picker({ start = '', sections }: { start?: string; sections: string[] }) {
  const [v, setV] = useState(start);
  return <><SectionPicker value={v} sections={sections} onChange={setV} /><output>{v}</output></>;
}
const pick = async (text: string) => {
  fireEvent.click(screen.getByRole('combobox', { name: 'Section' }));
  fireEvent.click(await screen.findByRole('option', { name: text }));
};

describe('picking a section', () => {
  it('offers the sections already there, and a new one by name', async () => {
    render(<Picker sections={['A. Bid forms', 'B. Eligibility']} />);
    await pick('B. Eligibility');
    expect(document.querySelector('output')!.textContent).toBe('B. Eligibility');
    await pick('New section…');
    fireEvent.change(screen.getByLabelText('New section name'), { target: { value: 'C. Technical' } });
    expect(document.querySelector('output')!.textContent).toBe('C. Technical');
    fireEvent.click(screen.getByRole('button', { name: 'Pick one' }));
    expect(screen.getByRole('combobox', { name: 'Section' })).toBeTruthy();
  });
});

describe('a section', () => {
  const lines = [line(1, 'A. Bid forms'), line(2, 'A. Bid forms')];

  it('is renamed on every line in it, or merged into one that exists', async () => {
    const done = vi.fn();
    render(<SectionSheet tenderId={40} name="A. Bid forms" mode="rename" lines={lines} taken={['A. Bid forms', 'B. Eligibility']} onClose={done} onSaved={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('Section name'), { target: { value: 'B. Eligibility' } });
    fireEvent.click(screen.getByRole('button', { name: 'Merge' }));
    await waitFor(() => expect(done).toHaveBeenCalled());
    expect(vi.mocked(updateLine).mock.calls).toEqual([[1, { section: 'B. Eligibility' }], [2, { section: 'B. Eligibility' }]]);
  });

  it('is deleted keeping its lines, or with them', async () => {
    const done = vi.fn();
    render(<SectionSheet tenderId={40} name="A. Bid forms" mode="delete" lines={lines} taken={[]} onClose={done} onSaved={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Keep the 2 lines, without a section' }));
    await waitFor(() => expect(done).toHaveBeenCalledTimes(1));
    expect(vi.mocked(updateLine).mock.calls).toEqual([[1, { section: '' }], [2, { section: '' }]]);
    cleanup();
    render(<SectionSheet tenderId={40} name="A. Bid forms" mode="delete" lines={lines} taken={[]} onClose={done} onSaved={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Delete the section and its 2 lines' }));
    await waitFor(() => expect(done).toHaveBeenCalledTimes(2));
    expect(bulkLines).toHaveBeenCalledWith(40, 'remove', [1, 2]);
  });
});
